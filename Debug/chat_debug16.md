# DuoEcho — Patch Request (strict scope, no drift)

**Goal (smallest set of changes):**

1. Fix MV3 cold-start race (buttery startup).
2. Add **badge HUD** showing **remaining tokens** in real time.
3. Make the **Full** handoff a **true full transcript** (no truncation).
4. Do not change filenames, APIs, or architecture. Only touch the lines/files below.

**Files to edit (and only these):**

* `extension/src/json-sniffer.js`
* `extension/popup.js`
* `extension/src/background-integrated.js`
* `extension/manifest.json` (only to ensure the `action` key exists)

---

## 1) json-sniffer.js — await SW readiness before first message

**Add at very top (before anything else):**

```js
// DUOECHO: wait for background SW to be ready before first message
async function awaitBackgroundReady(maxTries = 15, delay = 150) {
  for (let i = 0; i < maxTries; i++) {
    try {
      const resp = await new Promise((res, rej) => {
        chrome.runtime.sendMessage({ type: 'duoecho-ping' }, (r) => {
          if (chrome.runtime.lastError) return rej(chrome.runtime.lastError);
          res(r);
        });
      });
      if (resp && (resp.ok || resp.pong)) return true;
    } catch {}
    await new Promise(r => setTimeout(r, delay * (i < 6 ? 1 : 2)));
  }
  return false;
}
```

**Find the first place you send the initial message** (e.g. `injectPageScript`) and wrap it:

```js
// Before: chrome.runtime.sendMessage({ action: 'injectPageScript' });
(async () => {
  const ok = await awaitBackgroundReady();
  if (!ok) console.warn('[DuoEcho CS] Background not ready after retries.');
  chrome.runtime.sendMessage({ action: 'injectPageScript' });
})();
```

**If you have a manual capture path**, also ensure it calls `awaitBackgroundReady()` before `sendMessage`.

---

## 2) popup.js — keep SW alive + wait-ready gate

**At top-level:**

```js
let port;
function ensurePort() {
  if (port) return;
  port = chrome.runtime.connect({ name: 'duoecho-ui' });
  port.onDisconnect.addListener(() => { port = null; });
}

async function waitReady(tries = 20, delay = 120) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await chrome.runtime.sendMessage({ type: 'duoecho-ping' });
      if (r && (r.ok || r.pong)) return true;
    } catch {}
    await new Promise(r => setTimeout(r, delay));
  }
  return false;
}
```

**On DOM load, open the port and only then enable UI:**

```js
document.addEventListener('DOMContentLoaded', async () => {
  ensurePort();
  const ready = await waitReady();
  // TODO: enable your “Capture” button ONLY if ready === true
});
```

---

## 3) background-integrated.js — add port handler + badge HUD + full transcript helper

### 3a) Keep SW alive when popup connects (near top, after your onMessage listener is declared):

```js
chrome.runtime.onConnect.addListener((p) => {
  console.log('SW: port connected', p.name);
  p.onDisconnect.addListener(() => console.log('SW: port disconnected', p.name));
});
```

### 3b) Badge HUD for token **remaining**

* Make sure you have **one** token limit constant (you already have `SIGNAL_TOKEN_LIMIT = 1200`).
* Add a runtime message handler that updates the badge when signal generation emits progress.

**Add near your other constants (don’t duplicate existing ones):**

```js
// HUD badge colors
const BADGE_OK    = '#0B5';      // green-ish
const BADGE_WARN  = '#D80';      // amber
const BADGE_ALERT = '#C22';      // red
```

**Handle progress messages inside your existing onMessage handler** (where you route by `msg.type`). Add this branch; don’t duplicate existing cases:

```js
if (msg?.type === 'duoechoTokenProgress') {
  // msg.pct is 0..100, compute remaining tokens approximately
  const pct = Math.max(0, Math.min(100, Number(msg.pct) || 0));
  const remaining = Math.max(0, Math.round(SIGNAL_TOKEN_LIMIT * (1 - pct / 100)));
  const text = remaining > 999 ? '999' : String(remaining); // badge text is tiny

  // color thresholds
  const color = pct >= 95 ? BADGE_ALERT : (msg.warn ? BADGE_WARN : BADGE_OK);

  try { chrome.action.setBadgeBackgroundColor({ color }); } catch {}
  try { chrome.action.setBadgeText({ text }); } catch {}
  sendResponse?.({ ok: true });
  return true;
}
```

**Optional reset after finish (e.g., set empty badge at 100%):** in your code that emits final `duoechoEmitProgress(100)`, you can also send one more message if you want to clear the badge; or keep the remaining at “0” until next run — your call.

### 3c) Ensure the emitter is called during signal build

You already have:

```js
function duoechoEmitProgress(pct, warn=false) {
  try { chrome.runtime.sendMessage({ type: 'duoechoTokenProgress', pct, warn }); } catch {}
}
```

And your guarded appender:

```js
function tryAppendProgress(out, chunk, usedTokensRef) {
  if (!chunk) return out;
  const tokens = estTokens(chunk);
  const budget = SIGNAL_TOKEN_LIMIT - FOOTER_RESERVE_TOKENS;
  if (usedTokensRef.value + tokens > budget) return out;
  usedTokensRef.value += tokens;
  const pct = Math.min(99, Math.floor((usedTokensRef.value / SIGNAL_TOKEN_LIMIT) * 100));
  const warn = usedTokensRef.value >= Math.floor(SIGNAL_TOKEN_LIMIT * 0.8);
  duoechoEmitProgress(pct, warn);
  return out + chunk;
}
```

**Do not change these names.** Just confirm they exist and that your `generateSignalFromJson()` calls `tryAppendProgress` for each section. That’s what drives the HUD.

### 3d) True full transcript (no truncation)

Add a helper and **call it** inside your `generateFullHandoff()` (or whatever builds the full file). No token checks here — this is “full”.

**Add helper near other formatters:**

````js
function formatFullTranscript(json) {
  const msgs = Array.isArray(json.messages) ? json.messages : [];
  const lines = [];
  lines.push('## Full Transcript');
  lines.push('');
  for (const m of msgs) {
    const role = m.role || (m.sender === 'human' ? 'user' : 'assistant');
    const when = m.created_at ? ` _(${m.created_at})_` : '';
    const text = (m.text || m.content?.[0]?.text || '').trim();
    if (!text) continue;
    lines.push(`**${role}**${when}`);
    // preserve code fences if present
    lines.push(text.includes('```') ? text : text.replace(/\r?\n/g, '\n\n'));
    lines.push(''); // blank line between messages
  }
  return lines.join('\n');
}
````

**Inside your full handoff generator** (where you build the Markdown body), after your header/metadata sections, append the transcript:

```js
// Pseudocode inside generateFullHandoff():
let body = '';
// ... existing metadata, decisions, etc ...
body += '\n';
body += formatFullTranscript(json);   // <-- ALWAYS include at the end
return body;
```

> Important: **Do not** apply token budgeting to the full file. If you have any `tryAppendProgress` in the “full” path, replace with plain concatenation so nothing gets dropped.

---

## 4) manifest.json — ensure the badge is allowed

Make sure you have an `action` block so Chrome shows a badge:

```json
{
  "action": {
    "default_title": "DuoEcho"
  }
}
```

Do **not** change anything else in the manifest (you already fixed web\_accessible\_resources earlier).

---

## Test plan (do in order)

1. **Reload** the extension in `chrome://extensions`.
2. **Open popup** → it should connect a Port; UI stays disabled until “ready” ping returns.
3. Open a Claude conversation tab; the content script should **await background** and then request injection (no more “Receiving end does not exist”).
4. Run a capture → watch the **badge** show a number (remaining tokens), dropping as the signal builds.
5. Confirm the **Full** Markdown now contains a **“## Full Transcript”** section with **every message** (roles, timestamps, code blocks preserved).
6. Confirm the **signal** still writes and the badge clears (or shows “0”) when done.

---

## Guardrails

* **No refactors.** Don’t rename functions, don’t move files, don’t change filenames.
* Only add the exact snippets above at the described locations.
* If a constant already exists, **do not re-declare** it.
* If a case for `msg.type === 'duoechoTokenProgress'` already exists, **merge logic**, don’t duplicate.

When done, reply with:

* The exact diffs per file (minimal context).
* One screenshot or paste of “Full Transcript” tail (last 3 messages) to prove it’s complete.
* A one-line confirmation that cold-start jitter is gone (“first capture works without reload”).
