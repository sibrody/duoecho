Got it — here’s the lowest-risk, easiest path: two tiny patches + a safe wiring change with a fallback. Paste these exactly and you’re done.

Patch A — Make injection “success” line up (super low risk)

A1) Service worker: reply with success: true (keep ok too)

File: src/background-integrated.js
Find the injectPageScript handler where you call chrome.scripting.executeScript(...). Replace its .then/.catch with:

}).then(() => {
  console.log('Injection OK');
  // ✅ respond with both fields so any caller is happy
  sendResponse({ success: true, ok: true });
}).catch(err => {
  console.error('Injection failed:', err);
  sendResponse({ success: false, ok: false, error: String(err) });
});

(Leave everything else as-is.)

A2) Content script: accept success || ok

File: src/json-sniffer.js
Find the callback after chrome.runtime.sendMessage({ action: 'injectPageScript' }, ...) and replace the body with:

if (chrome.runtime.lastError) {
  console.error('[DuoEcho] Failed to request injection:', chrome.runtime.lastError);
} else if (response && (response.success || response.ok)) {
  console.log('[DuoEcho] Page script injection requested successfully');
} else {
  console.error('[DuoEcho] Injection failed:', response?.error);
}

That removes the “Injection failed: undefined” noise and keeps behavior identical.

⸻

Patch B — Use the new generator, but fall back if missing (low risk)

File: src/background-integrated.js
Inside your handleClaudeJson(...), find the line that builds the signal handoff. It likely looks like:

const signalHandoff = generateSignalFromJson(conversationData, realFullUrl);

Replace it with this safe block:

let signalHandoff;
try {
  // Try the new smarter generator if it exists
  if (typeof EnhancedSignalGenerator === 'function') {
    // Optional status/YAML lookup if you already have a helper:
    let statusFlags = null;
    try {
      if (typeof getConversationStatus === 'function') {
        const status = await getConversationStatus(
          conversationData.conversation_id,
          titleSlug
        );
        statusFlags = status?.phase_flags || null;
      }
    } catch (e) {
      console.warn('Status YAML read failed (non-fatal):', e);
    }

    const gen = new EnhancedSignalGenerator({
      tokenLimit: 1500,               // 1.2–1.5k as discussed
      keepFooterReserve: 180,         // never lose the full-link/footer
      relatedMax: 5,                  // up to 5 related links
      weightRecentFrac: 0.30,         // last 30% gets heavy weight
      decisionRegex:
        /\b(decided|chose|switched?|implemented|reverted|rolled back|consolidated|renamed|extracted|split out|moved to|fixed|resolved|working)\b/i
    });

    const { handoff } = await gen.generate(
      conversationData.messages,
      conversationData.metadata,
      titleSlug,
      ts,
      statusFlags
    );
    signalHandoff = handoff;
  } else {
    // Fallback: keep the old path to avoid breaking anything
    signalHandoff = generateSignalFromJson(conversationData, realFullUrl);
  }
} catch (e) {
  console.warn('Enhanced generator failed, falling back:', e);
  signalHandoff = generateSignalFromJson(conversationData, realFullUrl);
}

	•	If your EnhancedSignalGenerator is in the file, it’s used.
	•	If not (or it errors), you automatically fall back to the old generator.
	•	No other code paths change, so risk is minimal.

⸻

Quick smoke test (2 mins)
	1.	Reload extension in chrome://extensions.
	2.	Open a Claude conversation, click Capture.
	3.	In the page console you should see:
	•	✨ Page hooks installing... → ✅ Page hooks installed successfully
	•	Page script injection requested successfully
	4.	Confirm new signal shows the pinned Current State / Next Step, recent-weighted content, footer link intact.

⸻

If you want to be extra safe, do Patch A first (verify injection logs look clean), then Patch B (verify signal content improves). Both are reversible in seconds.