Here’s a copy-paste prompt you can feed to Claude for the final polish pass. It’s explicit about what to change, where to change it, what not to touch, and how we’ll test it.

⸻

You are operating on the DuoEcho Chrome extension. This is a 45-minute surgical polish—not a refactor.

Scope (do only this)
	•	File to edit: src/background-integrated.js
	•	Function to modify: generateSignalFromJson(json) (and tiny helpers placed in the same file)
	•	Do NOT touch: injection code, message listeners, manifest, file naming, GitHub upload logic, content script(s), service worker boot code.

Goal

Make the signal reliably useful for “resume work now” by:
	1.	pinning a Now/Next block at the top (with full link),
	2.	improving freshness so recent, decisive content wins,
	3.	preventing fragment-y sections with hard completeness guards,
	4.	adding up to 5 related handoffs (if discoverable),
	5.	putting the Full details link BOTH top and bottom so truncation can’t hide it.

Exact output format (markdown)

At the top of the signal, render this block exactly:

# {title} – Signal Handoff

**Current State:** {current_state_<=200chars}
**Next Step:** {next_step_<=140chars}

**Full details:** {full_handoff_link}
**Generated:** {iso_timestamp} | **Messages:** {count}

Then sections in this order (omit any section that fails completeness checks):

## Key Decisions (top 3)
- …

## Errors Fixed (top 2)
- …

## Code Changes
- …

## Next Steps (detailed)
- …

## Related (last 14 days, up to 5)
- …

And again at the very bottom:

**Full details:** {full_handoff_link}

Freshness & selection rules

Inside generateSignalFromJson(json):
	1.	Define windows:

	•	recent = last 30% of messages (by index)
	•	earlyCandidates = messages before that which match decision markers OR contain code blocks

	2.	Decision markers (use these regex constants):

const SUCCESS_RX  = /\b(working|captured|fixed|resolved|now (works|stable)|hooks? installed)\b/i;
const DECISION_RX = /\b(decided|chose|switch(?:ed)? to|implemented|reverted|rolled back|consolidated|renamed)\b/i;

function hasDecisionMarkers(t='') {
  return DECISION_RX.test(t) || /```/.test(t);
}

	3.	Candidate set = recent ∪ earlyCandidates.
After selection, sort candidates chronologically before building sections so the narrative reads forward.

Pin block extraction (helpers)

Add these 3 helpers inside the same file (top-level or right above generateSignalFromJson):

function cleanExcerpt(s = '', n = 200) {
  const t = String(s).replace(/\s+/g, ' ').trim();
  if (t.length <= n) return t;
  const cut = t.slice(0, n);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '));
  return (end > 80 ? cut.slice(0, end + 1) : cut) + ' …';
}

function extractCurrentState(msgs) {
  const assistants = msgs.filter(m => m.role === 'assistant').slice(-12).reverse();
  const hit = assistants.find(m => SUCCESS_RX.test(m.text));
  if (hit) return cleanExcerpt(hit.text, 200);
  const backup = assistants.find(m => /state|now|status|working|failing|error|stable/i.test(m.text));
  return backup ? cleanExcerpt(backup.text, 200) : 'Unknown — see Errors section.';
}

function extractNextStep(msgs) {
  const imperative = /^\s*(fix|add|update|remove|retry|capture|tag|rename|link|commit|test|verify|bump)\b/i;
  const lastUser = [...msgs].reverse().find(m => m.role === 'user' && imperative.test(m.text));
  if (lastUser) return cleanExcerpt(lastUser.text, 140);
  const lastAssist = [...msgs].reverse().find(m => m.role === 'assistant' && /\b(next|then|do this|proceed)\b/i.test(m.text));
  return lastAssist ? cleanExcerpt(lastAssist.text, 140) : 'Confirm capture works, then proceed with the next queued task.';
}

In generateSignalFromJson(json):
	•	const currentState = extractCurrentState(json.messages);
	•	const nextStep = extractNextStep(json.messages);
	•	const fullLink = existingFunctionThatBuildsFullLink(json);
(Use the existing link builder you already use for the full handoff path; do not invent a new one.)

Section budgets & completeness guards

Per section hard limits (by characters, not tokens):
	•	Decisions: 350–450
	•	Errors fixed: 300–400
	•	Code changes: 300–400
	•	Next steps (detailed): 200–250

Rules:
	•	Build bullets from the candidate set (recent-first priority, then decisive early items).
	•	Never cut mid-sentence. If you can’t end on . ! ? within the budget, backtrack to the previous sentence boundary.
	•	If a section ends up <120 chars OR contains no sentence end, omit the section (“better nothing than fragments”).

Related links (optional, up to 5)

If you already have a way to list prior handoffs (e.g., you keep a list in memory or can infer by predictable filenames in the same repo path):
	•	Filter to same project/title slug, last 14 days, newest first.
	•	Render max 5 as single-line bullets: - {Title} — {short date} — {link}
	•	If you don’t have an easy way, omit the section for now (don’t add network calls or new deps).

Deterministic fallback

If anything fails, still render:
	•	the top pin block (Current State / Next Step / link / meta),
	•	and a “Recent Highlights” list from the last 10 messages (1–2 bullets max), trimmed with cleanExcerpt.

Don’t change / safety rails
	•	Do NOT alter message passing, injection, or service worker startup.
	•	Do NOT rename files or adjust upload paths.
	•	Do NOT add dependencies or fetch remote data.
	•	Do NOT implement Scout or any LLM here. This is deterministic-only.
	•	Keep the existing filename format and verbose signal setting as-is.

Acceptance criteria (must all pass)
	1.	The top pin block appears with Current State, Next Step, Full details (link), Generated, Messages — and the same Full details link appears again at the bottom.
	2.	Reading only the signal, I can answer: What’s the status now? What should I do next? Where’s the full context?
	3.	No section shows mid-sentence fragments; any weak/incomplete section is omitted.
	4.	The content clearly favors the last 30% of the conversation, with decisive earlier items mixed in.
	5.	No stale advice contradicts the last assistant/user turns.
	6.	Files still save and upload exactly like before.

Quick test plan (you run this after implementing)
	•	Generate a signal from a long Claude conversation with real errors → fixes → validation.
	•	Verify top block shows a believable Current State and actionable Next Step.
	•	Confirm both Full details links work (top & bottom).
	•	Check that “Key Decisions” and “Errors Fixed” read in forward time order and are not fragments.
	•	Create one short conversation with no clear decisions → verify sections are omitted instead of showing garbage.
	•	Optional: if related links are available, ensure ≤5 from last 14 days; otherwise section is omitted.

Proceed with these changes only in src/background-integrated.js. Reply with the exact diff for generateSignalFromJson and any helpers you added, and list any constants you introduced. Do not change anything else.