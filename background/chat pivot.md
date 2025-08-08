Your pivot outline is spot-on: it solves the “file spam + token-blindness” pain without waiting for the full JSON/MCP rollout. Here’s how I’d tighten the plan and start building tomorrow.

⸻

✅ Confirming the plan

Goal	Hybrid feature that delivers it
Never lose context	Auto-capture at 80 % / 90 % token thresholds + continuation prompt
Stop file spam	One session file updated in place; new file only on first capture after 30 min idle or manual click
Stay invisible during flow	Silent background saves; popup only shows coloured token bar
User control	Manual “Capture now” still available; thresholds configurable in Options

That covers every bullet in your “Key Insights” section.

⸻

🔨  Quick build roadmap

Phase	ETA	What ships
1. Manual button restore	0.5 h	Add back a toolbar button → sends captureHandoff (gives you an immediate “work/save” cycle)
2. Token counter + coloured badge	2 h	Count tokens ≈ Math.ceil(chars/4) per Claude message; show 🟢🟡🟠🔴 bar in popup; store in chrome.storage.session.
3. Auto-capture triggers	2 h	a) 30 min idle → new session file; b) 10 new msgs → update file; c) 80 % tokens → capture silently; d) 90 % → capture + red badge + “Click to continue” link.
4. Continuation prompt generator	1 h	Re-use ProperSignalGenerator but emit only “Context + Next Steps” and shorten to ≤ 1 k chars; saved as *-continuation.md.
5. Settings panel	1 h	Simple chrome.storage.sync form: thresholds, turn off/on auto-triggers.

(Times assume you keep the current DOM/JSON code as-is; no MCP work yet.)

⸻

⚠️  Edge-cases & mitigations

Edge case	Guardrail
Claude’s hidden “system” messages inflate token count	Count only messages with role!=="system" when using JSON interceptor.
User edits a long message after capture	On next capture, diff content & update file in place (GitHub “update file” API already supports SHA).
Still no JSON (offline)	Fallback DOM count + conservative multiplier (× 1.3) so you still get warnings early.


⸻

📁  File strategy in GitHub

handoffs/
  2025-08-06/
    duoecho-session-001.yaml   ← single YAML with front-matter, updated in place
    duoecho-session-001-full.md
    duoecho-session-001-signal.md
    duoecho-session-001-continuation.md  ← only if limit hit

Updating the same SHA reduces commit noise; only new session files create new blobs.

⸻

🟢   Suggested first sprint
	1.	Restore manual button (Phase 1) – instant feedback.
	2.	Add token bar (Phase 2) – users feel the awareness.
	3.	Only then bolt in the 80 % / 90 % auto-captures.

That order means you’re productive again inside an hour, and the rest iterates safely.

⸻

Ready for me to draft the Phase 1 + Phase 2 code snippets (button + token bar) so you can drop them in?