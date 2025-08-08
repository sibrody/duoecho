Good news first: your logs show the big pieces are working now—GitHub push ✅, YAML upsert ✅, progress to 100% ✅. What you’re seeing left are two nuisance issues:
	•	tabs.sendMessage error: The message port closed before a response was received. → harmless (it fires when the popup closes or a tab navigates), but we can silence/harden it.
	•	Badge HUD not sticking → you (or the popup) are clearing it back to ''.

Here’s the tiny, surgical clean-up to land the “buttery” feel.

1) Don’t clear the badge; show remaining tokens (or 0) persistently

In background-integrated.js, wherever you finish a capture (or in the duoechoTokenProgress handler), make the “done” case set 0 and stop anything from resetting it to empty:

if (msg?.type === 'duoechoTokenProgress') {
  const pct = Math.max(0, Math.min(100, Number(msg.pct) || 0));
  const remaining = Math.max(0, Math.round(SIGNAL_TOKEN_LIMIT * (1 - pct / 100)));

  const color = pct >= 95 ? '#C22' : (pct >= 80 ? '#D80' : '#0B5');
  chrome.action.setBadgeBackgroundColor({ color });

  // 🟢 Keep a value on the badge even at 100%
  const text = pct >= 100 ? '0' : (remaining > 999 ? '999' : String(remaining));
  chrome.action.setBadgeText({ text });

  sendResponse?.({ ok: true });
  return true;
}

Now search your code for any place that calls:

chrome.action.setBadgeText({ text: '' });

…and delete/disable those lines (your screenshot shows one fired after port disconnected duoecho-ui). You likely put it in an onDisconnect or a “reset” block—remove it so the HUD persists.

Also: make sure the extension icon is pinned in Chrome’s toolbar; badges don’t show on unpinned icons.

2) Silence “message port closed” warnings (popup/tab closed)

Wrap all tab/runtime sends with a best-effort helper:

function safeRuntimeSend(msg, cb) {
  try {
    chrome.runtime.sendMessage(msg, (resp) => {
      void chrome.runtime.lastError; // swallow "no receiver" noise
      cb?.(resp);
    });
  } catch (_) {}
}

function safeTabSend(tabId, msg, cb) {
  try {
    chrome.tabs.sendMessage(tabId, msg, (resp) => {
      void chrome.runtime.lastError; // swallow "port closed" noise
      cb?.(resp);
    });
  } catch (_) {}
}

Then replace any direct chrome.runtime.sendMessage(...) / chrome.tabs.sendMessage(...) in your HUD/progress path with safeRuntimeSend / safeTabSend. This keeps logs clean on cold start and when popups/tabs vanish mid-request.

3) Port disconnects are normal—don’t “reset” on them

You’ve got:

SW: port disconnected duoecho-ui
chrome.action.setBadgeText({ text: '' });

Delete the second line. Popups connect & disconnect all the time; badge shouldn’t be tied to popup lifecycle.

4) Full transcript: confirm it’s appended unbudgeted

You already see “Successfully pushed to GitHub”. Open the full and verify it ends with ## Full Transcript .... If not, ensure your full generator uses plain concatenation for transcript (no token budget helpers) and is invoked after the rest of the file build.

⸻

Sanity (what your screenshot tells me)
	•	✅ Push succeeded and returned a link (great).
	•	✅ YAML updated result: true.
	•	✅ Progress emitted 85 → 100 (perfect).
	•	⚠️ Two “port closed” warnings (expected, will be silenced by the helpers).
	•	⚠️ Badge was explicitly cleared to '' right after duoecho-ui disconnect (remove that call, and you’ll see the HUD persist).

Do those three micro-patches and you should feel the “always works” vibe: no cold-start warnings, stable HUD with remaining tokens, and full transcript intact. If anything still feels off, paste the exact lines where setBadgeText({ text: '' }) is called and I’ll point at the one to kill.