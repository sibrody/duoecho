Popup bar shows, HUD doesn’t. That almost always means the content script isn’t receiving messages (not injected, wrong domain match) or the SW isn’t sending to the tab (only runtime.sendMessage). Here’s the fastest fix path + tiny diffs.

### Part 1

⸻

Minimal diffs to make the HUD actually show

1) Inject the content script on both Claude + ChatGPT

extension/manifest.json – add a second content script block (or add a second matches entry).

--- a/extension/manifest.json
+++ b/extension/manifest.json
@@ -... +... @@
   "content_scripts": [
     {
       "matches": [
         "https://claude.ai/*"
       ],
       "js": [
         "src/json-sniffer.js"
       ],
       "run_at": "document_start"
     },
+    {
+      "matches": [
+        "https://chat.openai.com/*"
+      ],
+      "js": [
+        "src/json-sniffer.js"
+      ],
+      "run_at": "document_start"
+    }
   ],

If you only capture on Claude, you can skip this. But if you’re testing on ChatGPT, this is required.

2) Make sure the SW sends progress to the tab

extension/src/background-integrated.js – add a helper and call it (keeps your existing runtime messages; now also pings the active tab).

--- a/extension/src/background-integrated.js
+++ b/extension/src/background-integrated.js
@@ -1,3 +1,18 @@
+// Track the most recent active tab for the capture
+let LAST_ACTIVE_TAB_ID = null;
+function emitToViews(msg) {
+  try { chrome.runtime.sendMessage(msg); } catch {}
+  if (LAST_ACTIVE_TAB_ID) {
+    try { chrome.tabs.sendMessage(LAST_ACTIVE_TAB_ID, msg); } catch {}
+  }
+}
+
+function emitProgress(pct, warn = false) {
+  emitToViews({ type: 'duoechoTokenProgress', pct, warn });
+}
@@
 chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
+  // Remember the tab that initiated capture/injection
+  if (sender?.tab?.id) LAST_ACTIVE_TAB_ID = sender.tab.id;
@@
   if (msg.action === 'injectPageScript' && sender.tab?.id) {
-    // existing injection code...
+    LAST_ACTIVE_TAB_ID = sender.tab.id;
+    // existing injection code...
   }
@@
   if (msg.action === 'claudeJson' && sender.tab?.id) {
+    LAST_ACTIVE_TAB_ID = sender.tab.id;
     // existing JSON handling...
   }
 });
@@
 // During your capture flow, replace current progress emits with:
-// chrome.runtime.sendMessage({ type: 'duoechoTokenProgress', pct, warn })
+emitProgress(5, false);
 // ...work...
+emitProgress(25, false);
 // ...work...
+emitProgress(60, false);
 // ...work...
+emitProgress(85, false);
 // ...complete...
+emitProgress(100, false);

(If you already send duoechoTokenProgress, just route them through emitProgress so they also reach the tab.)

3) Content script HUD: add a tiny “I’m alive” log + keep the listener

extension/src/json-sniffer.js – make sure the listener is top-level, and add a log in ensureHud() so you can confirm it runs.

--- a/extension/src/json-sniffer.js
+++ b/extension/src/json-sniffer.js
@@ -1,6 +1,7 @@
 // DuoEcho Content Script - Simple bridge between page and extension
 // Requests background to inject page script, then listens for messages
 
+console.log('[DuoEcho CS] json-sniffer.js loaded @', window.location.href);
 // === In-page Progress HUD (Shadow DOM) ===
 let duoHud, duoHudBar, duoHudNote, duoHudHideTimer;
 function ensureHud() {
@@
+  console.log('[DuoEcho CS] HUD created');
   return duoHud;
 }
@@
 chrome.runtime.onMessage.addListener((msg) => {
   if (msg?.type === 'duoechoTokenProgress') updateHud(msg.pct, msg.warn);
 });

Now, when you capture, you should see the HUD on the page even with the popup closed.

⸻

“Remaining tokens” HUD vs progress

Right now the HUD shows progress % and “Approaching token limit…” when warn is true. If you specifically want remaining token count displayed, add a budget event:

Background: send budget info during generation

--- a/extension/src/background-integrated.js
+++ b/extension/src/background-integrated.js
@@
+function emitBudget(used, limit) {
+  emitToViews({ type: 'duoechoTokenBudget', used, limit, remaining: Math.max(0, limit - used) });
+}
@@
 // Wherever you maintain a running token counter (e.g., used.value)
-emitProgress(60, false);
+emitProgress(60, false);
+emitBudget(used.value || 0, SIGNAL_TOKEN_LIMIT);

Content script: display remaining tokens

--- a/extension/src/json-sniffer.js
+++ b/extension/src/json-sniffer.js
@@
 function updateHud(pct, warn) {
   ensureHud();
   const p = Math.max(0, Math.min(100, Number(pct || 0)));
   duoHudBar.style.width = p + '%';
-  duoHudNote.textContent = warn ? 'Approaching token limit…' : (p >= 100 ? 'Done' : 'Working…');
+  if (!duoHudNote.dataset.hasBudget) {
+    duoHudNote.textContent = warn ? 'Approaching token limit…' : (p >= 100 ? 'Done' : 'Working…');
+  }
   if (duoHudHideTimer) clearTimeout(duoHudHideTimer);
   if (p >= 100) duoHudHideTimer = setTimeout(() => duoHud?.remove(), 1500);
 }
 
 chrome.runtime.onMessage.addListener((msg) => {
   if (msg?.type === 'duoechoTokenProgress') updateHud(msg.pct, msg.warn);
+  if (msg?.type === 'duoechoTokenBudget') {
+    ensureHud();
+    duoHudNote.dataset.hasBudget = '1';
+    const { used = 0, limit = 0, remaining = 0 } = msg;
+    duoHudNote.textContent = `Tokens: ${used}/${limit} (remaining ${remaining})`;
+  }
 });

If your generator doesn’t expose a running used count, emit at key checkpoints (e.g., after full handoff, after signal generation) as a first pass. You can refine to per-chunk later.

⸻

Recap
	•	HUD missing = content script not injected on your test site or SW not sending to the tab.
	•	Add the content_scripts match for the site you’re on and send with tabs.sendMessage (via emitToViews shown above).
	•	Optional: add token budget events to show exact remaining tokens in the HUD.

### Part 2

Thanks for the logs—super helpful. Two key takeaways:
	•	Your content script is definitely running (json-sniffer.js fires etc.).
	•	The HUD only appears when the content script receives duoechoTokenProgress. Your logs don’t show any HUD logs, which means the tab isn’t receiving progress messages (i.e., the SW is likely not tabs.sendMessage-ing), or you haven’t added the HUD listener code yet.

Also, FYI that DevTools error:

chrome.runtime.sendMessage(...)  -> Cannot read properties of undefined (reading 'sendMessage')

happens because you ran it in the page context. To test extension APIs, switch the DevTools context to the content script (dropdown near the console prompt) or use the “isolated world” for json-sniffer.js.

Alright, let’s make this airtight with two micro-patches: one to prove the HUD renders, and one to prove the SW is emitting to the tab.

⸻

1) Content script: HUD + listener + quick test

Add (or confirm) the HUD code and a temporary test tick so you can see the HUD immediately, independent of progress events.

extension/src/json-sniffer.js

@@
-// DuoEcho Content Script - Simple bridge between page and extension
-// Requests background to inject page script, then listens for messages
+// DuoEcho Content Script - Simple bridge between page and extension
+// Requests background to inject page script, then listens for messages
+console.log('[DuoEcho CS] json-sniffer.js loaded @', window.location.href);
+
+// === In-page Progress HUD (Shadow DOM) ===
+let duoHud, duoHudBar, duoHudNote, duoHudHideTimer;
+function ensureHud() {
+  if (duoHud) return duoHud;
+  const host = document.createElement('duo-echo-hud');
+  host.style.all = 'initial';
+  host.style.position = 'fixed';
+  host.style.right = '14px';
+  host.style.bottom = '14px';
+  host.style.zIndex = '2147483647';
+  const root = host.attachShadow({ mode: 'open' });
+  const wrap = document.createElement('div');
+  wrap.style.minWidth = '220px';
+  wrap.style.background = 'white';
+  wrap.style.border = '1px solid rgba(0,0,0,.12)';
+  wrap.style.boxShadow = '0 4px 18px rgba(0,0,0,.12)';
+  wrap.style.borderRadius = '10px';
+  wrap.style.padding = '10px';
+  wrap.style.fontFamily = 'system-ui, -apple-system, Segoe UI, sans-serif';
+  wrap.style.fontSize = '12px';
+  wrap.style.color = '#111';
+  wrap.style.display = 'flex';
+  wrap.style.flexDirection = 'column';
+  wrap.style.gap = '6px';
+  const title = document.createElement('div');
+  title.textContent = 'DuoEcho — Capture Progress';
+  title.style.fontWeight = '600';
+  title.style.fontSize = '12px';
+  const barWrap = document.createElement('div');
+  barWrap.style.position = 'relative';
+  barWrap.style.height = '8px';
+  barWrap.style.background = '#eee';
+  barWrap.style.borderRadius = '999px';
+  duoHudBar = document.createElement('div');
+  duoHudBar.style.height = '100%';
+  duoHudBar.style.width = '0%';
+  duoHudBar.style.borderRadius = '999px';
+  duoHudBar.style.background = '#4f46e5';
+  barWrap.appendChild(duoHudBar);
+  duoHudNote = document.createElement('div');
+  duoHudNote.style.fontSize = '11px';
+  duoHudNote.style.color = '#555';
+  wrap.appendChild(title);
+  wrap.appendChild(barWrap);
+  wrap.appendChild(duoHudNote);
+  root.appendChild(wrap);
+  document.documentElement.appendChild(host);
+  duoHud = host;
+  console.log('[DuoEcho CS] HUD created');
+  return duoHud;
+}
+
+function updateHud(pct, warn) {
+  ensureHud();
+  const p = Math.max(0, Math.min(100, Number(pct || 0)));
+  duoHudBar.style.width = p + '%';
+  duoHudNote.textContent = warn ? 'Approaching token limit…' : (p >= 100 ? 'Done' : 'Working…');
+  if (duoHudHideTimer) clearTimeout(duoHudHideTimer);
+  if (p >= 100) duoHudHideTimer = setTimeout(() => duoHud?.remove(), 1500);
+}
+
+// Listen for background progress in the tab
+chrome.runtime.onMessage.addListener((msg) => {
+  if (msg?.type === 'duoechoTokenProgress') {
+    console.log('[DuoEcho CS] Progress event ->', msg.pct, msg.warn);
+    updateHud(msg.pct, msg.warn);
+  }
+});
+
+// TEMP: sanity tick so you can see HUD immediately on page load
+setTimeout(() => { try { updateHud(8, false); } catch (e) {} }, 600);

After reloading the extension and refreshing the Claude page, you should immediately see the HUD appear ~0.6s after load and a console line [DuoEcho CS] HUD created. If you don’t see that log, the HUD code isn’t present or this file didn’t rebuild.

⸻

2) Background: actually send progress to the tab

Even if runtime.sendMessage is firing (popup sees progress), the tab won’t see anything without tabs.sendMessage(...).

extension/src/background-integrated.js

@@
+// Remember the tab where capture is happening and broadcast to views
+let LAST_ACTIVE_TAB_ID = null;
+function emitToViews(msg) {
+  try { chrome.runtime.sendMessage(msg); } catch (e) { console.warn('runtime.sendMessage failed', e); }
+  if (LAST_ACTIVE_TAB_ID) {
+    chrome.tabs.sendMessage(LAST_ACTIVE_TAB_ID, msg, () => {
+      const err = chrome.runtime.lastError;
+      if (err) console.warn('tabs.sendMessage error:', err.message);
+    });
+  }
+}
+
+function emitProgress(pct, warn = false) {
+  emitToViews({ type: 'duoechoTokenProgress', pct, warn });
+}
@@
 chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
+  if (sender?.tab?.id) LAST_ACTIVE_TAB_ID = sender.tab.id; // track tab
@@
   if (msg.action === 'injectPageScript' && sender.tab?.id) {
+    LAST_ACTIVE_TAB_ID = sender.tab.id;
     // existing injection code...
   }
@@
   if (msg.action === 'claudeJson' && sender.tab?.id) {
+    LAST_ACTIVE_TAB_ID = sender.tab.id;
     // existing JSON handling...
   }
@@
 });
@@
 // During capture flow (pick a few meaningful milestones):
-// chrome.runtime.sendMessage({ type: 'duoechoTokenProgress', pct, warn })
+emitProgress(5, false);   // start
 // ... after full handoff upload:
+emitProgress(25, false);
 // ... after signal generation:
+emitProgress(60, false);
 // ... after signal upload:
+emitProgress(85, false);
 // ... done:
+emitProgress(100, false);

Reload the extension, start a capture, and watch the Claude tab console:
	•	You should see [DuoEcho CS] Progress event -> X logs and the HUD bar move.

⸻

If HUD still doesn’t show
	•	Make sure you’re testing on a URL that matches your content_scripts.matches. If you’re also using ChatGPT, you must add a second content-script block for https://chat.openai.com/*.
	•	In the Claude tab console, click the context dropdown and select the content script (isolated world). You should see your [DuoEcho CS] logs there.
	•	If you don’t see tabs.sendMessage logs in the SW, add:

console.log('emitProgress ->', pct, 'tab', LAST_ACTIVE_TAB_ID);

to verify a tab ID is being tracked (should be set via the sender.tab cases above).

Once those two diffs are in and you see the [DuoEcho CS] HUD created log, the HUD will show and update even if the popup is closed.