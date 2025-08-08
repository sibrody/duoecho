Short answer: the code I just gave you is the exact payload Claude should apply; the prompt is the wrapper that tells Claude where to place it, what not to touch, and how to verify. Use the prompt below verbatim—it’s built to prevent drift and make Claude do surgical, testable edits.

⸻

Claude — Final Patch Request (strict scope, no drift)

You will apply three minimal changes to improve DuoEcho’s signal quality and add a visible token-progress bar. Do not modify anything outside the lines I specify. If something is missing (e.g., function name differs), stop and ask.

Repo / Paths
	•	Local working tree: ~/Dev/duoecho/extension
	•	Files to edit only:
	•	src/background-integrated.js
	•	popup.js
	•	Do NOT touch: manifest.json, src/sniffer-injected.js, GitHub client/upload logic, file-naming/link functions.

Goals
	1.	Better selection: last-30% recency weighting + “decision/error marker” early messages.
	2.	Token progress events: emit progress while building the signal, warn at ≥80%.
	3.	Popup status bar: tiny progress bar that reacts to those events.
	4.	Keep footer space so the full-link never gets truncated.

⸻

Patch 1 — Selection helpers (top of background script)

File: src/background-integrated.js
Location: Near the top, with your other constants/helpers. Insert once.

// DUOECHO: ---- signal helpers (selection + cleanliness) ----
const SIGNAL_TOKEN_LIMIT = 1200;
const FOOTER_RESERVE_TOKENS = 120; // keep room for footer / link
const DECISION_RX = /\b(fix|fixed|resolve[d]?|implement(ed|ing)?|working|decided|chosen|merged|refactor(ed)?|rename(d)?|revert(ed)?)\b/i;
const ERROR_RX = /\b(error|exception|failed|status\s*\d{3}|ReferenceError|TypeError|NetworkError|CORS)\b/i;

function estTokens(s='') { return Math.ceil((s || '').length / 4); }
function hasDecisionMarkers(t='') { return DECISION_RX.test(t) || /```/.test(t); }
function hasErrorMarkers(t='') { return ERROR_RX.test(t); }
function sentenceSplit(t='') { return (t || '').split(/(?<=[.!?])\s+/).filter(Boolean); }
function takeClean(text, maxTokens) {
  const sentences = sentenceSplit(text);
  let out = '', used = 0;
  for (const s of sentences) {
    const add = estTokens(s + ' ');
    if (used + add > maxTokens) break;
    out += s + ' ';
    used += add;
  }
  return out.trim();
}

// DUOECHO: pick messages = last 30% + earlier decisions/errors
function pickMessages(all) {
  const n = all.length;
  if (!n) return [];
  const recentStart = Math.floor(n * 0.7);
  const recent = all.slice(recentStart);
  const early = all.slice(0, recentStart).filter(m => hasDecisionMarkers(m.text) || hasErrorMarkers(m.text));
  return [...recent, ...early];
}

Change in your generator: wherever you currently choose messages, replace that with:

const chosen = pickMessages(json.messages || []);


⸻

Patch 2 — Emit progress + guarded append (background)

File: src/background-integrated.js
Location: Helpers section (same area as above).

// DUOECHO: progress emitter (safe no-op if popup not open)
function duoechoEmitProgress(pct, warn=false) {
  try { chrome.runtime.sendMessage({ type: 'duoechoTokenProgress', pct, warn }); } catch {}
}

// DUOECHO: guarded append that tracks tokens and emits progress
function tryAppend(out, chunk, usedTokensRef) {
  if (!chunk) return out;
  const tokens = estTokens(chunk);
  const budget = SIGNAL_TOKEN_LIMIT - FOOTER_RESERVE_TOKENS;
  if (usedTokensRef.value + tokens > budget) return out; // preserve footer space
  usedTokensRef.value += tokens;
  const pct = Math.min(99, Math.floor((usedTokensRef.value / SIGNAL_TOKEN_LIMIT) * 100));
  const warn = usedTokensRef.value >= Math.floor(SIGNAL_TOKEN_LIMIT * 0.8);
  duoechoEmitProgress(pct, warn);
  return out + chunk;
}


⸻

Patch 3 — Minimal generator body (use the helpers above)

File: src/background-integrated.js
Location: Inside your existing generateSignalFromJson(json) (or equivalent single place that builds the signal text). Do not touch your filename/link code—keep your current makeFullLink(...), titleSlug, ts variables, etc. Paste this as the body that builds the markdown and returns it:

// DUOECHO: BEGIN minimal generator body (keep your filename/link logic elsewhere)
const messages = Array.isArray(json.messages) ? json.messages : [];
const title = json?.name || 'Untitled';
const count = messages.length;
const isoTimestamp = new Date().toISOString();

const fullLink = (typeof makeFullLink === 'function')
  ? makeFullLink(titleSlug || 'duoecho', ts || Date.now())
  : '[full handoff link missing]';

function cleanExcerpt(t, limit=300){ return takeClean((t||'').replace(/\s+/g,' ').trim(), Math.ceil(limit/4)*4); }
function extractCurrentState(msgs) {
  const lastA = [...msgs].reverse().find(m => m.role === 'assistant' && m.text);
  const lastU = [...msgs].reverse().find(m => m.role === 'user' && m.text);
  const pick = lastA?.text || lastU?.text || '';
  return cleanExcerpt(pick, 260) || '—';
}
function extractNextStep(msgs) {
  const lastU = [...msgs].reverse().find(m => m.role === 'user' && m.text);
  if (lastU) {
    const t = lastU.text;
    const hasAsk = /\b(next|todo|plan|do this|continue|finish|polish|fix)\b/i.test(t);
    if (hasAsk) return cleanExcerpt(t, 200);
  }
  return 'Continue with the most recent open fix or polish task.';
}

let used = { value: 0 };
let out = '';

out = tryAppend(out, `# ${title} — Signal Handoff\n\n`, used);
out = tryAppend(out, `**Current State**: ${extractCurrentState(messages)}\n`, used);
out = tryAppend(out, `**Next Step**: ${extractNextStep(messages)}\n\n`, used);
out = tryAppend(out, `**Full details**: ${fullLink}\n`, used);
out = tryAppend(out, `**Generated**: ${isoTimestamp} | **Messages**: ${count}\n\n`, used);

const chosen = pickMessages(messages);

// Key Decisions
const decisions = chosen.filter(m => hasDecisionMarkers(m.text)).map(m => m.text);
let decBlock = '';
if (decisions.length) {
  decBlock += '## Key Decisions (top 3)\n';
  for (const d of decisions.slice(0, 3)) decBlock += `- ${takeClean(d, 120)}\n`;
  decBlock += '\n';
}
out = tryAppend(out, decBlock, used);

// Errors Fixed
const errs = chosen.filter(m => hasErrorMarkers(m.text)).map(m => m.text);
let errBlock = '';
if (errs.length) {
  errBlock += '## Errors Fixed (top 2)\n';
  for (const e of errs.slice(0, 2)) errBlock += `- ${takeClean(e, 120)}\n`;
  errBlock += '\n';
}
out = tryAppend(out, errBlock, used);

// Code Changes (naive heuristic)
const codey = chosen
  .map(m => m.text || '')
  .filter(t => /```/.test(t) || /\b(src\/|\.js|\.ts|\.json|manifest\.json|popup\.js)\b/.test(t));
let codeBlock = '';
if (codey.length) {
  codeBlock += '## Code Changes\n';
  for (const t of codey.slice(0, 3)) {
    const trimmed = t.match(/```[\s\S]*?```/g)?.[0] || t;
    codeBlock += takeClean(trimmed, 220) + '\n\n';
  }
}
out = tryAppend(out, codeBlock, used);

// Next Steps
let nextBlock = '## Next Steps\n';
nextBlock += `- ${extractNextStep(messages)}\n\n`;
out = tryAppend(out, nextBlock, used);

// footer (always fits due to reserve)
out += `---\nFull details: ${fullLink}\n`;

// final 100%
duoechoEmitProgress(100, false);

return out;
// DUOECHO: END minimal generator body

If your generator is a class (e.g., EnhancedSignalGenerator), adapt the body accordingly but keep the helpers and calls identical.

⸻

Patch 4 — Popup progress bar (UI)

File: popup.js
Location: After your DOMContentLoaded handler is fine.

// DUOECHO: progress UI (created on the fly so no HTML edits needed)
function ensureProgressUI() {
  if (document.getElementById('duoechoProgress')) return;
  const wrap = document.createElement('div');
  wrap.id = 'duoechoProgress';
  wrap.style.cssText = 'margin:8px 0 4px 0;height:6px;background:#eee;border-radius:4px;overflow:hidden;position:relative;';

  const bar = document.createElement('div');
  bar.id = 'duoechoProgressBar';
  bar.style.cssText = 'height:100%;width:0%;background:#4a90e2;transition:width .15s ease';

  const warn = document.createElement('div');
  warn.id = 'duoechoTokenWarn';
  warn.style.cssText = 'margin-top:4px;font-size:11px;color:#b26b00;display:none;';
  warn.textContent = 'Token budget ≥80% — reserving space for footer';

  wrap.appendChild(bar);
  document.body.prepend(wrap);
  document.body.insertBefore(warn, wrap.nextSibling);
}
ensureProgressUI();

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'duoechoTokenProgress') {
    ensureProgressUI();
    const bar = document.getElementById('duoechoProgressBar');
    const warn = document.getElementById('duoechoTokenWarn');
    if (bar) bar.style.width = Math.max(0, Math.min(100, msg.pct || 0)) + '%';
    if (warn) warn.style.display = msg.warn ? 'block' : 'none';
  }
});


⸻

Verification (Claude must run/describe results)

Static checks (paste outputs):

grep -n "pickMessages" src/background-integrated.js
grep -n "duoechoEmitProgress" src/background-integrated.js
grep -n "tryAppend" src/background-integrated.js
grep -n "duoechoTokenProgress" popup.js

Manual test checklist:
	1.	Reload extension → open Claude tab → open popup.
	2.	Click Capture Now on an active conversation.
	3.	Watch popup bar move; at ~80% a small warning line appears.
	4.	Verify generated signal includes:
	•	“Current State” + “Next Step” at top,
	•	“Full details” link at top and bottom,
	•	Sections present but not truncated mid-sentence.
	5.	Confirm footer link is intact (not cut off).

Constraints
	•	No other edits. If function names differ (e.g., class method instead of generateSignalFromJson), stop and ask before proceeding.
	•	If any snippet already exists, make it idempotent (don’t duplicate).
	•	If a linter/prettier changes formatting, keep semantic diff minimal.

Deliverables
	•	Unified diffs for each file,
	•	Console logs showing progress events,
	•	One commit on a new branch polish/signal-progress-guard,
	•	Commit msg: feat(signal): recency+decision selection, token progress, footer reserve,
	•	Short note confirming tests passed.

⸻

This is intentionally surgical. Apply exactly these patches; do not refactor, rename, or move other logic. If any ambiguity, ask before changing anything.

No extra commentary. Keep changes as small as possible.