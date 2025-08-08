Here you go — copy-paste this into Claude exactly as-is.

⸻

DuoEcho — Patch Request (STRICT SCOPE, NO DRIFT)

You are patching a single file to fix the signal quality by implementing a deterministic “Recent-Window + Pinned Top + Guardrails” generator.

Do not change (hard limits)
	•	❌ Do NOT modify manifest.json
	•	❌ Do NOT modify src/json-sniffer.js or src/sniffer-injected.js
	•	❌ Do NOT touch any GitHub API code (uploads, headers, SHA logic)
	•	❌ Do NOT rename files or functions
	•	❌ Do NOT add new deps, storage, or YAML logic
	•	❌ Do NOT reorder background listeners or injection logic

Files you MAY edit
	•	✅ ~/Dev/duoecho/extension/src/background-integrated.js (only)

⸻

Goal (what to implement)
	1.	Pinned Top Block (always first):

**Current State**: <clean excerpt from last assistant message (~250–300 chars, end on sentence)>
**Next Step**: <actionable ask from the last ~15 user msgs if present; else empty string>

Then standard header lines (full link, timestamps, msg count), then the rest of the sections.
	2.	Recent-window selection:

	•	Use the last 12–20 messages as the main body.
	•	From earlier messages include only lines that match decision markers:
	•	/(fix|fixed|resolve|resolved|implemented|working|decided|chose|refactor|listener|CORS|status\s?15|manifest\.json|json-sniffer\.js|chrome\.scripting)/i

	3.	Guardrails:

	•	Never cut mid-sentence: truncate on . ! ? boundaries.
	•	Include whole code fences (...) or skip them entirely. No partial fences.
	•	Token limit = 1200, warn at 80%, reserve 180 tokens for the footer so it never gets truncated.

	4.	Footer must always render:

	•	“Full details: ”
	•	“Generated:  | Messages: ”
	•	“Freshness: based on capture at <generated_at ISO>”

⸻

Exact changes (implement precisely)

In src/background-integrated.js:

A) Add/ensure these constants near the top of the file (or near other constants):

const SIGNAL_TOKEN_LIMIT = 1200;
const SIGNAL_WARN_FRACTION = 0.80;
const SIGNAL_FOOTER_RESERVE_TOKENS = 180;

const DECISION_RX = /(fix|fixed|resolve|resolved|implemented|working|decided|chose|refactor|listener|CORS|status\s?15|manifest\.json|json-sniffer\.js|chrome\.scripting)/i;

function approxTokens(s) {
  // fast & conservative: ~4 chars per token
  return Math.ceil((s || '').length / 4);
}

B) Add helpers (pure functions, no side effects):

function sentenceSafeTruncate(text, maxChars) {
  if (!text) return '';
  if (text.length <= maxChars) return text;
  const slice = text.slice(0, maxChars);
  const lastPunct = Math.max(slice.lastIndexOf('.'), slice.lastIndexOf('!'), slice.lastIndexOf('?'));
  return (lastPunct > 50 ? slice.slice(0, lastPunct + 1) : slice.trim()) + '…';
}

function cleanExcerpt(s, maxChars = 300) {
  if (!s) return '';
  // strip obvious UI noise
  const t = s.replace(/\s+/g, ' ').replace(/^[#>\-\*\s]+/g, '').trim();
  return sentenceSafeTruncate(t, maxChars);
}

function lastAssistantText(msgs) {
  for (let i = msgs.length - 1; i >= 0; i--) {
    if ((msgs[i].role || '').toLowerCase() === 'assistant') {
      const t = msgs[i].text || '';
      if (t.trim()) return t;
    }
  }
  return '';
}

function lastUserAction(msgs, lookback = 15) {
  const start = Math.max(0, msgs.length - lookback);
  for (let i = msgs.length - 1; i >= start; i--) {
    const m = msgs[i];
    if ((m.role || '').toLowerCase() === 'user') {
      const txt = (m.text || '').trim();
      if (txt) return sentenceSafeTruncate(txt, 300);
    }
  }
  return '';
}

function extractRecentAndDecisions(msgs, recentCount = 18) {
  const recent = msgs.slice(-recentCount);
  const early = msgs.slice(0, Math.max(0, msgs.length - recentCount));
  const decisionLines = [];
  for (const m of early) {
    const t = (m.text || '').trim();
    if (t && DECISION_RX.test(t)) decisionLines.push(t);
  }
  return { recent, decisionLines };
}

function formatMessagesAsBullets(msgs, perItemMax = 280) {
  const out = [];
  for (const m of msgs) {
    const label = (m.role || 'assistant').toLowerCase() === 'user' ? 'User' : 'Assistant';
    const line = cleanExcerpt(m.text || '', perItemMax);
    if (line) out.push(`- **${label}:** ${line}`);
  }
  return out.join('\n');
}

function tryAppend(buf, section, tokensUsedRef) {
  const tks = approxTokens(section);
  const budgetLeft = SIGNAL_TOKEN_LIMIT - tokensUsedRef.value - SIGNAL_FOOTER_RESERVE_TOKENS;
  if (tks <= budgetLeft) {
    buf.push(section);
    tokensUsedRef.value += tks;
    return true;
  }
  return false;
}

function maybeWarn(tokensUsedRef, warnings) {
  const frac = tokensUsedRef.value / SIGNAL_TOKEN_LIMIT;
  if (frac >= SIGNAL_WARN_FRACTION) warnings.push(`⚠️ Signal is ${Math.round(frac * 100)}% of token budget.`);
}

C) Patch (or re-implement) generateSignalFromJson(json) ONLY
	•	If the function was deleted, recreate it with the following behavior.
	•	If it exists, replace its body to follow this exact flow:

function generateSignalFromJson(json) {
  const msgs = json.messages || [];
  const tokensUsedRef = { value: 0 };
  const warnings = [];
  const sections = [];

  // 1) Pinned top
  const csRaw = lastAssistantText(msgs);
  const nsRaw = lastUserAction(msgs, 15);
  const pinned = [
    `**Current State**: ${cleanExcerpt(csRaw, 300)}`,
    nsRaw ? `**Next Step**: ${cleanExcerpt(nsRaw, 300)}` : `**Next Step**: (none captured)`
  ].join('\n');
  tryAppend(sections, pinned + '\n', tokensUsedRef);

  // 2) Body selection
  const { recent, decisionLines } = extractRecentAndDecisions(msgs, 18);
  const body = [
    '## Highlights (recent)',
    formatMessagesAsBullets(recent, 260),
    decisionLines.length ? '\n## Decisions (earlier, key markers)\n' + decisionLines.map(l => `- ${sentenceSafeTruncate(l, 300)}`).join('\n') : ''
  ].join('\n');

  tryAppend(sections, '\n' + body + '\n', tokensUsedRef);
  maybeWarn(tokensUsedRef, warnings);

  // 3) Footer (always)
  const fullLink = json.metadata?.full_github_url || json.full_github_url || '<missing>';
  const generatedAt = new Date(json.metadata?.generated_at || Date.now()).toISOString();
  const footer = [
    '\n---',
    `Full details: ${fullLink}`,
    `Generated: ${generatedAt} | Messages: ${msgs.length}`,
    `Freshness: based on capture at ${generatedAt}`,
    warnings.length ? warnings.map(w => `> ${w}`).join('\n') : ''
  ].join('\n');

  // Ensure footer always fits (we reserved budget)
  sections.push(footer);
  return sections.join('\n');
}

Important: If other code calls generateSignalFromJson(json, verbose) with 2 args, keep the signature backward-compatible (verbose is ignored). Do not remove the function; keep its name identical.

⸻

Acceptance criteria (must pass)
	•	Top block renders first with Current State and Next Step populated from the tail of the conversation.
	•	Body content uses last ~18 msgs plus earlier decision markers only.
	•	No mid-sentence truncation; no partial code fences.
	•	Token budget 1200, warn at 80%, and footer is never truncated (reserve 180 tokens).
	•	Footer includes full link, timestamp, message count, freshness.
	•	No regressions: no changes to upload logic, no “Cannot access ‘fullFilename’ before initialization” errors, no injection changes.
	•	File compiles; service worker registers; no syntax errors in console.

Quick verification (run locally / sanity checks)
	•	Search in background-integrated.js:
	•	SIGNAL_TOKEN_LIMIT, SIGNAL_WARN_FRACTION, SIGNAL_FOOTER_RESERVE_TOKENS
	•	generateSignalFromJson
	•	sentenceSafeTruncate, cleanExcerpt, extractRecentAndDecisions, tryAppend, maybeWarn
	•	Trigger a capture on a long Claude chat:
	•	Confirm pinned top shows last assistant/user intent.
	•	Confirm footer always present and correct.
	•	Confirm the content feels recent, not stale.

Commit message

feat(signal): deterministic recent-window + pinned top + guardrails (token cap, footer reserve)

End of patch.