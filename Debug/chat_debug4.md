Here’s a copy-paste prompt you can feed to Claude. It’s surgical: add an 80% token-budget warning, reserve space for the “Full details” link, and prevent mid-sentence truncation — without touching injection, listeners, filenames, or uploads.

⸻

Claude — Patch Request (strict scope, no drift)

You are patching a Chrome MV3 extension.
Do not change: manifest, injection code, listeners, filenames, upload/GitHub logic, or any other files.
Only edit: src/background-integrated.js, inside generateSignalFromJson(json) and add tiny helpers.
Goal: token-aware signal generation with an 80% “budget reached” note and guaranteed space for the Full-details link; keep our top “pinned” block.

Acceptance criteria
	1.	Signal shows a one-time note when ~80% of token budget is reached.
	2.	Full details link appears both near the top and at the bottom, never truncated.
	3.	No mid-sentence truncation; if a section can’t fit cleanly, omit it.
	4.	Keep existing section builders and freshness rules (recent-first + decision markers).
	5.	No changes to injection, message listeners, filenames, or upload code.

⸻

Implement exactly this

A. Add constants + tiny estimator (near the top or above generateSignalFromJson)

// --- Signal token budgeting (no external tokenizer) ---
const SIGNAL_TOKEN_LIMIT = 1200;   // target ~1.2k tokens
const SIGNAL_WARN_AT     = 0.80;   // warn once at 80%

// crude token estimator: ~4 chars ≈ 1 token (ignores fenced code to avoid overcount)
function estTokens(s = '') {
  const noCode = String(s).replace(/```[\s\S]*?```/g, ' ');
  return Math.ceil(noCode.length / 4);
}

// small helper to ensure we end at a sentence boundary
function trimToSentenceBoundary(txt = '') {
  const t = String(txt).trim();
  const i = Math.max(t.lastIndexOf('. '), t.lastIndexOf('! '), t.lastIndexOf('? '));
  return i > 0 ? t.slice(0, i + 1) : t;
}

B. In generateSignalFromJson(json) — add token accounting & guards
(Keep your existing extraction/builders; just wrap appends with tryAppend and reserve room for footer.)

function generateSignalFromJson(json) {
  // --- your existing prep (title, counts, builders, freshness filtering) stays ---

  const title = json.metadata?.title || json.name || 'Untitled';
  const msgCount = json.metadata?.total_messages ?? json.messages?.length ?? 0;
  const fullLink = buildFullLinkExactlyLikeBefore(json); // <-- existing builder
  const footer   = `\n**Full details:** ${fullLink}\n`;
  const footerReserve = estTokens(footer) + 8; // guarantee space for footer

  let out = '';
  let used = 0;
  let warned = false;
  let nearLimit = false;

  function maybeWarn() {
    if (!warned && used / SIGNAL_TOKEN_LIMIT >= SIGNAL_WARN_AT) {
      warned = true;
      const note = `\n> **Note:** ~80% of signal budget reached — older/less critical items omitted. See **Full details** for complete context.\n`;
      out += note;
      used += estTokens(note);
    }
  }

  function tryAppend(chunk) {
    const block = trimToSentenceBoundary(chunk);
    const need = estTokens(block);
    if (used + need + footerReserve > SIGNAL_TOKEN_LIMIT) {
      nearLimit = true;
      return false;
    }
    out += block;
    used += need;
    maybeWarn();
    return true;
  }

  // --- TOP PIN (always) ---
  const currentState = cleanExcerpt(extractCurrentState(json.messages), 200); // your existing extractor
  const nextStep     = cleanExcerpt(extractNextStep(json.messages), 140);    // your existing extractor
  const header =
`# ${title} – Signal Handoff

**Current State:** ${currentState}
**Next Step:** ${nextStep}

**Full details:** ${fullLink}
**Generated:** ${new Date().toISOString()} | **Messages:** ${msgCount}
`;
  tryAppend(header);

  // --- body sections (reuse your existing builders) ---
  const sections = [];

  const decisions = buildDecisionsBullets(json);     // "## Key Decisions\n- ..."
  if (decisions && decisions.length > 120) sections.push('\n' + decisions + '\n');

  const errors = buildErrorsFixedBullets(json);
  if (errors && errors.length > 120) sections.push('\n' + errors + '\n');

  const code = buildCodeChangesBullets(json);
  if (code && code.length > 120) sections.push('\n' + code + '\n');

  const next = buildNextStepsDetailed(json);
  if (next && next.length > 120) sections.push('\n' + next + '\n');

  const related = buildRelatedLinks(json, { max: 5 }); // optional; return "" if N/A
  if (related && related.length > 60) sections.push('\n' + related + '\n');

  for (const section of sections) {
    if (!tryAppend(section)) break;
  }

  // --- always append footer; if needed, trim last lines to make room (never drop link) ---
  if (used + estTokens(footer) > SIGNAL_TOKEN_LIMIT) {
    const parts = out.split('\n');
    while (parts.length && used + estTokens(footer) > SIGNAL_TOKEN_LIMIT) {
      const last = parts.pop();
      used -= estTokens(last + '\n');
    }
    out = parts.join('\n');
  }
  out += footer;

  if (nearLimit) console.log('[DuoEcho] Signal hit near-limit; some items omitted.');

  return out;
}

C. Keep freshness & completeness logic as-is
	•	Keep your “recent-weighted + decision-marker” selection in the builders/filters.
	•	Keep your completeness guards (if a section would be fragmentary, omit it).

D. Do not modify anything else
	•	No edits to chrome.scripting.executeScript, content scripts, listeners, filenames, upload paths, or manifest.

⸻

Quick test checklist
	1.	Generate a long signal (>1200-tokens worth of content available).
	2.	Verify Full details link appears near top and bottom.
	3.	Confirm a one-time 80% note shows before the end when budget is tight.
	4.	Ensure no mid-sentence truncation (sections either whole or omitted).
	5.	Console shows: [DuoEcho] Signal hit near-limit; some items omitted. when applicable.

If any unit fails, print the final token estimate (used) and footerReserve to debug, but do not change architecture.

End of patch request.