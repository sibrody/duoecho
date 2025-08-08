Two separate things going on:

# Why the signal still misses the last key bit

Your generator can still “optimize away” the very end of the convo. Easiest, low-risk fix: **append a tiny “Tail (last N)” section** that *always* includes the last few messages, regardless of scoring.

Drop this **near the end of `generateSignalFromJson` (right before the footer)**:

````js
// --- Tail safety net: always include the last few lines ---
function tailLines(msgs, n = 8) {
  const tail = msgs.slice(-n);
  return tail.map(m => {
    const who = m.role === 'user' ? 'U' : 'A';
    const t = (m.text || '').replace(/```[\s\S]*?```/g, '[code]').replace(/\s+/g, ' ').trim();
    return `- ${who}: ${takeClean(t, 60)}`;
  }).join('\n');
}

// …inside generateSignalFromJson, after Next Steps and before footer:
const tail = tailLines(messages, 8);
out = tryAppendProgress(out, `## Tail (last 8 msgs)\n${tail}\n\n`, used);
````

That guarantees the “review chat\_debug7 next” type of thing is never lost.

# Why you don’t see the progress bar

Background **is** emitting `duoechoTokenProgress`, but your popup likely isn’t listening/rendering. You need a tiny UI + listener. This doesn’t touch the manifest.

## 1) Add minimal HTML (popup.html)

Put this somewhere near the top/bottom of the popup:

```html
<div id="progressRow" style="display:none;margin-top:8px;">
  <div style="font-size:12px;margin-bottom:4px;">Signal progress</div>
  <div style="width:100%;height:6px;background:#eee;border-radius:3px;overflow:hidden;">
    <div id="progressBar" style="height:100%;width:0%;background:#4a90e2;"></div>
  </div>
  <div id="progressNote" style="font-size:11px;color:#777;margin-top:4px;"></div>
</div>
```

## 2) Add the listener (popup.js)

At the top-level of `popup.js` (not inside a click handler), add:

```js
const row = document.getElementById('progressRow');
const bar = document.getElementById('progressBar');
const note = document.getElementById('progressNote');

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'duoechoTokenProgress') {
    row.style.display = 'block';
    bar.style.width = `${Math.max(0, Math.min(100, msg.pct))}%`;
    note.textContent = msg.warn ? 'Approaching token limit…' : '';
    if (msg.pct >= 100) {
      setTimeout(() => { row.style.display = 'none'; }, 1200);
    }
  }
});
```

And when the user clicks Capture, reset the bar so it starts fresh:

```js
document.getElementById('captureBtn')?.addEventListener('click', () => {
  if (row) { row.style.display = 'block'; }
  if (bar) { bar.style.width = '0%'; }
  if (note) { note.textContent = ''; }
  // your existing capture logic continues…
});
```

# 3) Two tweaks you can stack with the tail (both minimal risk):

* **Pin last user intent** harder:
  In your `extractNextStep`/`lastUserAction`, scan the last 12–15 messages first; if none match, then fall back. This forces the pinned “Next Step” to be from the end.

* **Raise section ceilings slightly**:
  If you’re using `takeClean(..., 120)` per bullet, consider 140–160 for Decisions and 80–100 for Errors, then shave Code Changes to keep within budget. The tail is cheap—\~120–160 tokens total.

# 4) Two tiny polish tweaks:

* Clamp and normalize the percent (so you never “overfill” the bar).
* (Optional) throttle if you emit super frequently.

```js
function duoechoEmitProgress(pct, warn = false) {
  const p = Math.max(0, Math.min(100, Math.round(Number(pct) || 0)));
  try {
    chrome.runtime.sendMessage({ type: 'duoechoTokenProgress', pct: p, warn: !!warn });
  } catch {/* no-op */}
}
```

Reminder: you’ll only see it if the popup is open and listening with
`chrome.runtime.onMessage.addListener(({type,pct,warn}) => { ... })`.




