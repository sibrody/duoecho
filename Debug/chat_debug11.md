Now fix the signal quality by restoring the smarter selector from the “chat_debug8” era (pinned Current State / Next Step + recent-window + decision weighting), while keeping the token-progress hooks you added later.

Here’s a surgical, paste-ready patch:

1) Add missing helpers (place above generateSignalFromJson)
js
Copy
function cleanExcerpt(s = '', maxChars = 300) {
  const t = String(s || '')
    .replace(/```[\s\S]*?```/g, '[code]')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > maxChars ? t.slice(0, maxChars - 1) + '…' : t;
}

function lastAssistantText(msgs = []) {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m && m.role !== 'user' && (m.text || '').trim()) return m.text;
  }
  return '';
}

function lastUserAction(msgs = [], lookback = 25) {
  const start = Math.max(0, msgs.length - lookback);
  for (let i = msgs.length - 1; i >= start; i--) {
    const m = msgs[i];
    if (!m || m.role !== 'user') continue;
    const t = m.text || '';
    if (/\b(next|do|implement|fix|refactor|rename|add|remove|hook|inject|test|ship|release)\b/i.test(t)) {
      return t;
    }
  }
  return '';
}

function extractRecentAndDecisions(msgs = [], recentCount = 18) {
  if (!msgs.length) return { recent: [], decisionLines: [] };
  const recent = msgs.slice(-recentCount);

  // Earlier items that look like decisions / errors
  const early = msgs
    .slice(0, Math.max(0, msgs.length - recentCount))
    .filter(m => hasDecisionMarkers(m.text) || hasErrorMarkers(m.text));

  // Preference: latest first, cap ~24
  const decisionLines = [...early, ...recent]
    .filter(m => hasDecisionMarkers(m.text) || hasErrorMarkers(m.text))
    .slice(-24)
    .reverse();

  return { recent, decisionLines };
}

function formatMessagesAsBullets(items = [], perItemMaxChars = 220, maxItems = 12) {
  const out = [];
  for (const m of items) {
    const txt = (m?.text || '').replace(/\s+/g, ' ').trim();
    if (!txt) continue;
    out.push(`- ${cleanExcerpt(txt, perItemMaxChars)}`);
    if (out.length >= maxItems) break;
  }
  return out.join('\n');
}

2) Here’s a drop-in generateSignalFromJson that does those, and still uses your existing helpers (takeClean, pickMessages, hasDecisionMarkers, hasErrorMarkers, tryAppendProgress, duoechoEmitProgress). Paste this over your current function body.

js
Copy
// Generate deterministic signal handoff from JSON (polished)
function generateSignalFromJson(json, fullUrl = null, verbose = true) {
  const msgs = Array.isArray(json.messages) ? json.messages : [];
  const title = json?.name || 'Untitled';
  const count = msgs.length;
  const ts = new Date().toISOString();
  const link = fullUrl || json.metadata?.full_github_url || json.full_github_url || '<missing>';

  const used = { value: 0 };
  let out = '';

  // ---- pin correct top content ----
  // last assistant text (for Current State)
  let lastAssistant = '';
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m && m.role !== 'user' && (m.text || '').trim()) { lastAssistant = m.text; break; }
  }
  // last actionable user line (for Next Step)
  const ACTION_RX = /\b(next|do|implement|fix|refactor|rename|add|remove|hook|inject|test|ship|release|polish)\b/i;
  let lastAction = '';
  for (let i = msgs.length - 1, seen = 0; i >= 0 && seen < 25; i--, seen++) {
    const m = msgs[i];
    if (m?.role === 'user' && ACTION_RX.test(m.text || '')) { lastAction = m.text; break; }
  }

  out = tryAppendProgress(out, `# ${title} — Signal Handoff\n\n`, used);
  out = tryAppendProgress(out, `**Current State:** ${takeClean(lastAssistant || '(unknown)', 300)}\n`, used);
  out = tryAppendProgress(out, `**Next Step:** ${takeClean(lastAction || 'Continue the most recent open fix or polish task.', 300)}\n\n`, used);
  out = tryAppendProgress(out, `**Full details:** ${link}\n`, used);
  out = tryAppendProgress(out, `**Generated:** ${ts} | **Messages:** ${count}\n\n`, used);

  // ---- choose content (recency + decision weighting) ----
  const chosen = pickMessages(msgs); // your last-30% + early decisions/errors

  // simple recency-preserving dedup
  const norm = s => (s || '').replace(/\s+/g, ' ').trim();
  const unique = arr => {
    const seen = new Set(); const outArr = [];
    for (const t of arr) { const k = norm(t); if (!k || seen.has(k)) continue; seen.add(k); outArr.push(t); }
    return outArr;
  };

  // Key Decisions
  const decisions = unique(chosen.filter(m => hasDecisionMarkers(m.text)).map(m => m.text));
  if (decisions.length) {
    let block = '## Key Decisions\n';
    for (const d of decisions.slice(0, 5)) block += `- ${takeClean(d, 220)}\n`;
    out = tryAppendProgress(out, block + '\n', used);
  }

  // Errors & Fixes
  const errs = unique(chosen.filter(m => hasErrorMarkers(m.text)).map(m => m.text));
  if (errs.length) {
    let block = '## Errors & Fixes\n';
    for (const e of errs.slice(0, 5)) block += `- ${takeClean(e, 220)}\n`;
    out = tryAppendProgress(out, block + '\n', used);
  }

  // Code Changes (code blocks or file mentions)
  const codey = unique(
    chosen.map(m => m.text || '')
      .filter(t => /```|src\/|\.js|\.ts|manifest\.json|popup\.js/.test(t))
  );
  if (codey.length) {
    let block = '## Code Changes\n';
    for (const t of codey.slice(0, 3)) {
      const snippet = t.match(/```[\s\S]*?```/g)?.[0] || t;
      block += takeClean(snippet, 240) + '\n\n';
    }
    out = tryAppendProgress(out, block, used);
  }

  // Next steps (section, even if pinned above)
  out = tryAppendProgress(out, '## Next Steps\n- Review the pinned **Next Step** and proceed.\n\n', used);

  // footer (we reserved tokens in tryAppendProgress)
  out += `---\nFull details: ${link}\n`;

  duoechoEmitProgress(100, false);
  return out;
}
Tiny checklist so you don’t get bit by “works but stale” again:

Keep one set of helpers/constants only:

takeClean, pickMessages, hasDecisionMarkers, hasErrorMarkers

tryAppendProgress, duoechoEmitProgress

SIGNAL_TOKEN_LIMIT, FOOTER_RESERVE_TOKENS

Ensure pickMessages returns recency-first (yours does if it’s [...recent, ...early]).

3) Quick sanity log (optional)
Right before building the sections (inside the function), add:

js
Copy
console.log('[DuoEcho] signal/debug', {
  total: msgs.length,
  recent: recent?.length,
  decisions: decisionLines?.length
});
If decisions stays near 0 on a highly technical chat, widen DECISION_RX (you already include filenames + status15 which is good).

4) Tiny “self-test” log (so you can see what the selector picked)
Add this just before you assemble the sections inside generateSignalFromJson:

js
Copy
console.log('[DuoEcho] signal/debug totals', {
  total: msgs.length,
  recentCount: extractRecentAndDecisions(msgs, 18).recent.length,
  decisionCount: extractRecentAndDecisions(msgs, 18).decisionLines.length
});
If decisionCount is ~0 on a clearly technical chat, your selector isn’t seeing markers → we tweak DECISION_RX and/or include code-block detection (/```/).

5) Sanity for the popup progress
Quick confirm you didn’t lose the UI hook:

js
Copy
// popup.js
chrome.runtime.onMessage.addListener((m) => {
  if (m?.type === 'duoechoTokenProgress') {
    const el = document.getElementById('tokenProgress');
    if (el) {
      el.style.width = `${m.pct}%`;
      el.classList.toggle('warn', !!m.warn);
    }
  }
});
(And the tiny <div id="tokenProgress"> exists.)