Guardrails for Applying DuoEcho Patches

Scope & Files
	•	Only modify these files (relative to repo root):
	•	extension/popup.js
	•	extension/src/background-integrated.js
	•	extension/src/json-sniffer.js
	•	Do not change any other files unless explicitly instructed (no auto-fixes, no refactors, no formatting sweeps).
	•	Preserve file encoding (UTF-8) and line endings.

Patch Types & Order
	1.	Apply the single unified diff to extension/popup.js (Section A).
	2.	Apply the HUD + background diffs to:
	•	extension/src/background-integrated.js
	•	extension/src/json-sniffer.js
	3.	Do not reorder code or move functions beyond what the diffs show.

Manifest & Permissions
	•	Do not edit manifest.json unless asked.
	•	If popup code reads the active tab’s URL, ensure "tabs" permission already exists; do not add it unless explicitly told.

Diff Application Rules
	•	Apply patches exactly as shown (character-for-character).
	•	If a hunk fails to apply:
	•	Stop immediately. Do not improvise.
	•	Report the exact failing hunk (file + lines) and request confirmation.
	•	Do not re-indent or reformat unrelated regions.
	•	Do not remove or rename existing IDs used by the UI:
	•	#progressRow, #progressBar, #progressNote (popup)
	•	Keep all new logs exactly as in the diffs (used for diagnosis).

Runtime Behavior Requirements
	•	Popup:
	•	Queue duoechoTokenProgress events pre-DOM; flush on DOMContentLoaded.
	•	Use handleProgressUpdate(msg) that queries elements each time; no stale refs.
	•	No duplicate listeners that double-update the bar.
	•	Background:
	•	Broadcast progress to both extension views and the active tab:
	•	chrome.runtime.sendMessage({ type: 'duoechoTokenProgress', ... })
	•	chrome.tabs.sendMessage(LAST_ACTIVE_TAB_ID, { type: 'duoechoTokenProgress', ... })
	•	Track LAST_ACTIVE_TAB_ID only from messages tied to the current capture.
	•	Content Script HUD:
	•	Create a Shadow-DOM HUD (not affecting page styles).
	•	Update width to % value; show “Approaching token limit…” when warn is true.
	•	Auto-hide ~1.5s after reaching 100%.
	•	No global CSS injection; confine all HUD styles inside shadow root.

Safety & Idempotency
	•	New code must be idempotent:
	•	Multiple progress events in quick succession must not create multiple HUDs.
	•	Reapplying the popup patch must not leave two listeners (the diff removes the old one).
	•	Do not introduce top-level await in MV3 scripts.

Post-Patch Validation (Claude must perform/check & report)
	•	Build/Reload extension and confirm:
	•	Popup opens; console shows: "[DuoEcho] Popup script loading" and "[DuoEcho] DOM loaded, initializing popup".
	•	During a capture, see progress logs: “Queued …”, “Flushing …”, “Progress updated: X%”.
	•	On the conversation page (Claude.ai), the HUD appears and fills to 100%, then hides.
	•	No unhandled errors in:
	•	Service Worker console
	•	Popup DevTools console
	•	Page DevTools console (the site tab)

Rollback Plan
	•	Before edits, create .bak copies of the three files.
	•	If any validation fails, restore from .bak and halt with a clear error summary.

Communication Expectations
	•	After applying each patch, Claude should paste a short diff summary (files changed + number of lines).
	•	If any assumptions are needed (e.g., missing element IDs), ask first; do not guess.

⸻

Paste these above the task. They’ll keep Claude laser-focused, avoid “helpful” refactors, and ensure you get both: a reliable popup progress bar and an always-visible in-page HUD.
Below are two surgical diffs to (A) keep the popup robust and (B) add a persistent, on-page progress HUD so users always see updates while they generate text.

⸻

A) Single unified diff. Keep the safer progress handler in the popup.

--- a/popup.js
+++ b/popup.js
@@ -1,23 +1,73 @@
 // DuoEcho Popup Script - JSON Capture Version
 console.log('[DuoEcho] Popup script loading');
-
-// DUOECHO: Handle token progress events (top-level listener)
-chrome.runtime.onMessage.addListener((msg) => {
-  if (msg?.type === 'duoechoTokenProgress') {
-    const row = document.getElementById('progressRow');
-    const bar = document.getElementById('progressBar');
-    const note = document.getElementById('progressNote');
-    if (row) row.style.display = 'block';
-    if (bar) bar.style.width = `${Math.max(0, Math.min(100, msg.pct))}%`;
-    if (note) note.textContent = msg.warn ? 'Approaching token limit…' : '';
-    if (msg.pct >= 100) {
-      setTimeout(() => { if (row) row.style.display = 'none'; }, 1200);
-    }
-  }
-});
+// === Progress Event Queue & Safe Handler ===
+let __duoDomReady = false;
+const __duoProgressQueue = [];
+
+/** Safely update progress UI elements; logs if elements are missing. */
+function handleProgressUpdate(msg) {
+  try {
+    const row  = document.getElementById('progressRow');
+    const bar  = document.getElementById('progressBar');
+    const note = document.getElementById('progressNote');
+
+    if (!row || !bar || !note) {
+      console.warn('[DuoEcho] Progress elements not found yet', {
+        hasRow: !!row, hasBar: !!bar, hasNote: !!note
+      });
+      return;
+    }
+
+    row.style.display = 'block';
+    const pct = Math.max(0, Math.min(100, Number(msg.pct || 0)));
+    bar.style.width = pct + '%';
+    note.textContent = msg.warn ? 'Approaching token limit…' : '';
+    console.log('[DuoEcho] Progress updated:', pct + '%');
+
+    if (pct >= 100) {
+      setTimeout(() => { row.style.display = 'none'; }, 1200);
+    }
+  } catch (e) {
+    console.error('[DuoEcho] Progress update error:', e);
+  }
+}
+
+// Replace previous direct handler with a queuing listener
+chrome.runtime.onMessage.addListener((msg) => {
+  if (msg?.type === 'duoechoTokenProgress') {
+    if (!__duoDomReady) {
+      __duoProgressQueue.push(msg);
+      console.log('[DuoEcho] Queued progress before DOM ready:', msg.pct);
+      return;
+    }
+    handleProgressUpdate(msg);
+  }
+});
 
 // DUOECHO: Listen for ready message from background / content script
 chrome.runtime.onMessage.addListener((msg) => {
   if (msg?.type === 'duoEchoConversationReady') {
     console.log('[DuoEcho] Conversation JSON ready in content script');
   }
 });
 
-document.addEventListener('DOMContentLoaded', async () => {
+document.addEventListener('DOMContentLoaded', async () => {
+  // Mark DOM ready and flush any queued progress messages
+  __duoDomReady = true;
+  try {
+    if (__duoProgressQueue.length) {
+      console.log('[DuoEcho] Flushing queued progress events:', __duoProgressQueue.length);
+      while (__duoProgressQueue.length) {
+        handleProgressUpdate(__duoProgressQueue.shift());
+      }
+    }
+  } catch (e) {
+    console.warn('[DuoEcho] Flush error:', e);
+  }
+
   console.log('[DuoEcho] DOM loaded, initializing popup');
   // ... (rest of your existing DOMContentLoaded initialization code) ...
 });

What this achieves (your bullets 2–7):
	•	Queued events until DOM ready ✅
	•	Safe updater function (handleProgressUpdate) ✅
	•	Defensive logs for queue/flush/update ✅
	•	No double-handling (replaces the old direct DOM-updater) ✅

⸻

B) Persistent on-page HUD (progress overlay without opening the popup)

You asked “Why does it have to be in the popup?” — it doesn’t. Add a lightweight HUD rendered by the content script and make the service worker broadcast progress to the tab. This way the user always sees updates on the conversation page.

1) Broadcast progress to the active tab from the background worker

src/background-integrated.js — add a tiny emitter and call it at key phases.

--- a/src/background-integrated.js
+++ b/src/background-integrated.js
@@ -1,3 +1,9 @@
+// Track the most recent tab we processed (set from message sender)
+let LAST_ACTIVE_TAB_ID = null;
+
+function emitProgress(pct, warn = false) {
+  chrome.runtime.sendMessage({ type: 'duoechoTokenProgress', pct, warn });
+  if (LAST_ACTIVE_TAB_ID) chrome.tabs.sendMessage(LAST_ACTIVE_TAB_ID, { type: 'duoechoTokenProgress', pct, warn });
+}
 
 // ...
 
@@ -120,6 +126,13 @@ chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
   // Handle script injection request from content script
   if (msg.action === 'injectPageScript' && sender.tab?.id) {
+    LAST_ACTIVE_TAB_ID = sender.tab.id; // remember the tab
     // existing injection code...
   }
 
+  if (msg.action === 'claudeJson' && sender.tab?.id) {
+    LAST_ACTIVE_TAB_ID = sender.tab.id; // set again when JSON arrives
+  }
+
   // existing handlers...
 });
 
@@ -400,6 +413,15 @@ async function handleClaudeJson(conversationData) {
   try {
+    // Progress: start
+    emitProgress(5, false);
+
     // 1) Upload FULL handoff
     const fullResult = await pushHandoffToGitHub(fullHandoff, fullFilename);
+    emitProgress(25, false);
 
     // 2) Generate SIGNAL (enhanced then fallback)
     let signalHandoff;
     try {
       if (typeof EnhancedSignalGenerator === 'function') {
         // ...
       } else {
         // fallback
       }
     } catch (e) {
       // ...
     }
+    emitProgress(60, false);
 
     // 3) Push SIGNAL
     const signalResult = await pushHandoffToGitHub(signalHandoff, signalFilename);
+    emitProgress(85, false);
 
     // 4) Update status YAML (non-blocking)
     try {
       const statusResult = await updateStatusYamlSafe(conversationRecord);
       // ...
     } catch (e) { /* non-blocking */ }
+    emitProgress(100, false);
 
     return { success: true, /* ... existing return ... */ };
   } catch (error) {
     // ...
   }
 }

If you already emit duoechoTokenProgress in this file, you can just replace those calls with emitProgress(...) so they also reach the tab.

⸻

2) Render a tiny HUD in the page via the content script

src/json-sniffer.js — add a Shadow-DOM HUD and listen for the same progress event. This won’t conflict with site CSS.

--- a/src/json-sniffer.js
+++ b/src/json-sniffer.js
@@ -1,6 +1,74 @@
 // DuoEcho Content Script - Simple bridge between page and extension
 // Requests background to inject page script, then listens for messages
 
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
+  host.style.fontFamily = 'system-ui, -apple-system, Segoe UI, sans-serif';
+
+  const root = host.attachShadow({ mode: 'open' });
+  const wrap = document.createElement('div');
+  wrap.style.minWidth = '220px';
+  wrap.style.background = 'white';
+  wrap.style.border = '1px solid rgba(0,0,0,.12)';
+  wrap.style.boxShadow = '0 4px 18px rgba(0,0,0,.12)';
+  wrap.style.borderRadius = '10px';
+  wrap.style.padding = '10px';
+  wrap.style.fontSize = '12px';
+  wrap.style.color = '#111';
+  wrap.style.display = 'flex';
+  wrap.style.flexDirection = 'column';
+  wrap.style.gap = '6px';
+
+  const title = document.createElement('div');
+  title.textContent = 'DuoEcho — Capture Progress';
+  title.style.fontWeight = '600';
+  title.style.fontSize = '12px';
+
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
+
+  duoHudNote = document.createElement('div');
+  duoHudNote.style.fontSize = '11px';
+  duoHudNote.style.color = '#555';
+
+  wrap.appendChild(title);
+  wrap.appendChild(barWrap);
+  wrap.appendChild(duoHudNote);
+  root.appendChild(wrap);
+  document.documentElement.appendChild(host);
+  duoHud = host;
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
+chrome.runtime.onMessage.addListener((msg) => {
+  if (msg?.type === 'duoechoTokenProgress') updateHud(msg.pct, msg.warn);
+});
+
 (() => {
   const DUOECHO_MSG = 'DUOECHO_CLAUDE_JSON';
   let latestConversation = null;

That’s it. Now every capture shows a progress overlay on the conversation page whether or not the popup is open — while the popup still works if you want to watch it.

⸻

Why nothing showed before
	•	A popup progress bar only updates while the popup is open. If users close it (or never open it), they’ll never see progress.
	•	Your service worker was sending progress with chrome.runtime.sendMessage(...) — which does not automatically reach a closed popup or the tab’s content script unless you also chrome.tabs.sendMessage(...).
	•	By broadcasting to the tab and rendering an in-page HUD, you remove the dependence on the popup entirely.

⸻

If you want, I can roll these two diffs into a ready-to-install ZIP like before. Or if Claude is applying, just hand it the diffs above.