You don’t have a “length” problem—you have a signal routing problem. Fix that, and 500 tokens becomes realistic most of the time.

Recommendation

Adopt an A+B hybrid:
	1.	Canonical Full Handoff (lossless) — always generated and archived (file, gist, or storage).
	2.	Smart 500-token Handoff (use-case aware) — generated from the same source via extractive rules + token-aware compaction.

This gives you a durable source of truth and something you can paste into a new chat without losing the plot.

⸻

Core design: from conversation → signals → typed compressor → budgeter

1) Normalize & signalize (one pass)

Extract just the pieces that matter, once. Everything downstream consumes this.

type Msg = { role: 'user'|'assistant'|'system'; text: string; ts?: number };
type Signal = {
  type: 'problem'|'hypothesis'|'fix'|'decision'|'next'|'error'|'code'|'note';
  text: string;
  weight: number;        // importance 1..5
  ts?: number;
  meta?: Record<string, any>;
};

function toSignals(messages: Msg[]): Signal[] {
  const sigs: Signal[] = [];
  for (const m of messages) {
    const t = m.text.trim();

    // crude but effective patterning; refine over time
    if (/error|exception|traceback|stack/i.test(t)) {
      sigs.push({ type: 'error', text: t, weight: 4, ts: m.ts });
    }
    if (/\bfix(ed|es|ing)?\b|\bresolved\b|\bsolution\b/i.test(t)) {
      sigs.push({ type: 'fix', text: t, weight: 5, ts: m.ts });
    }
    if (/\b(decide(d)?|we chose|we’ll go with|trade-?off|pros|cons)\b/i.test(t)) {
      sigs.push({ type: 'decision', text: t, weight: 4, ts: m.ts });
    }
    if (/\bnext step|todo|follow[- ]?up|pending\b/i.test(t)) {
      sigs.push({ type: 'next', text: t, weight: 4, ts: m.ts });
    }
    if (/^```/.test(t) || /function\s+\w+|class\s+\w+|const\s+\w+\s*=/.test(t)) {
      sigs.push({ type: 'code', text: t, weight: 3, ts: m.ts });
    }
    // fallback: latest user ask / latest assistant answer
    if (m.role === 'user')  sigs.push({ type: 'problem', text: t, weight: 3, ts: m.ts });
    if (m.role === 'assistant') sigs.push({ type: 'note', text: t, weight: 2, ts: m.ts });
  }
  return dedupeSignals(sigs);
}

function dedupeSignals(sigs: Signal[]): Signal[] {
  const seen = new Set<string>();
  const out: Signal[] = [];
  for (const s of sigs) {
    const k = `${s.type}:${s.text.slice(0, 200)}`;
    if (!seen.has(k)) { seen.add(k); out.push(s); }
  }
  return out.sort((a,b) => (a.ts??0) - (b.ts??0));
}

2) Detect conversation type

Lightweight heuristics beat ML here and are explainable.

type ConvType = 'debugging'|'architecture'|'implementation'|'general';

function detectType(sigs: Signal[]): ConvType {
  const errors = sigs.filter(s => s.type === 'error').length;
  const fixes  = sigs.filter(s => s.type === 'fix').length;
  const decs   = sigs.filter(s => s.type === 'decision').length;
  const codes  = sigs.filter(s => s.type === 'code').length;

  if (errors >= 2 || fixes >= 1) return 'debugging';
  if (decs >= 2 && codes <= 1)   return 'architecture';
  if (codes >= 2 && decs <= 1)   return 'implementation';
  return 'general';
}

3) Type-specific compression

Each type has a canonical outline. We extract, not paraphrase, wherever possible.

type Outline = { title: string; sections: { h: string; items: string[] }[] };

function compressDebug(sigs: Signal[]): Outline {
  const lastProblem = lastOf(sigs.filter(s => s.type === 'problem' || s.type === 'error'));
  const fixes       = uniqTop(sigs.filter(s => s.type === 'fix'), 3);
  const nexts       = uniqTop(sigs.filter(s => s.type === 'next'), 3);
  const decisions   = uniqTop(sigs.filter(s => s.type === 'decision'), 2);

  return {
    title: 'DuoEcho Debug Handoff',
    sections: [
      { h: 'Problem',     items: pickSentences(lastProblem?.text, 2) },
      { h: 'What Worked', items: fixes.flatMap(f => pickSentences(f.text, 2)) },
      { h: 'Decision(s)', items: decisions.flatMap(d => pickSentences(d.text, 2)) },
      { h: 'Next',        items: nexts.flatMap(n => bulletize(n.text, 1)) }
    ]
  };
}

function compressArchitecture(sigs: Signal[]): Outline {
  const decisions = uniqTop(sigs.filter(s => s.type === 'decision'), 5);
  const nexts = uniqTop(sigs.filter(s => s.type === 'next'), 3);
  return {
    title: 'DuoEcho Architecture Handoff',
    sections: [
      { h: 'Question / Goal', items: guessQuestion(sigs) },
      { h: 'Options & Trade-offs', items: decisions.map(d => normalizeDecision(d.text)) },
      { h: 'Decision', items: decisions.slice(0,1).map(d => d.text) },
      { h: 'Next', items: nexts.map(n => n.text) }
    ]
  };
}

function compressImplementation(sigs: Signal[]): Outline {
  const code = sigs.filter(s => s.type === 'code');
  const nexts = uniqTop(sigs.filter(s => s.type === 'next'), 3);
  return {
    title: 'DuoEcho Build Handoff',
    sections: [
      { h: 'Built', items: summarizeCodeBlocks(code, 3) }, // signatures, filenames, counts
      { h: 'Notes', items: uniqTop(sigs.filter(s => s.type === 'note'), 3).map(n => firstLine(n.text)) },
      { h: 'Next',  items: nexts.map(n => n.text) }
    ]
  };
}

function compressGeneral(sigs: Signal[]): Outline {
  const lastProblem = lastOf(sigs.filter(s => s.type === 'problem'));
  const lastAnswer  = lastOf(sigs.filter(s => s.type === 'note' || s.type === 'fix'));
  return {
    title: 'DuoEcho Handoff',
    sections: [
      { h: 'Context', items: pickSentences(lastProblem?.text, 3) },
      { h: 'Latest Answer', items: pickSentences(lastAnswer?.text, 3) },
      { h: 'Next', items: uniqTop(sigs.filter(s => s.type === 'next'), 3).map(n => n.text) }
    ]
  };
}

Key idea: We keep code blocks out of the 500-token body by default and replace them with compact signatures + hashes + a pointer to the full handoff.

function summarizeCodeBlocks(codeSigs: Signal[], max = 3): string[] {
  return codeSigs.slice(-max).map(c => {
    const sigs = extractFunctionSignatures(c.text).slice(0,4);
    const lines = c.text.split('\n').length;
    const hash = simpleHash(c.text).slice(0,8);
    return `Code (${lines} lines, #${hash}): ${sigs.join(' · ')}`;
  });
}

function extractFunctionSignatures(code: string): string[] {
  const sigs: string[] = [];
  const rx = /\b(function\s+\w+\s*$begin:math:text$[^)]*$end:math:text$)|(\w+\s*=\s*$begin:math:text$[^)]*$end:math:text$\s*=>)|(\bclass\s+\w+)/g;
  let m;
  while ((m = rx.exec(code)) && sigs.length < 6) {
    sigs.push((m[1]||m[2]||m[3]).replace(/\s+/g,' ').trim());
  }
  return sigs.length ? sigs : [firstLine(code).slice(0,80)];
}

4) Token-aware budgeter (preserve boundaries)

Never cut mid-sentence or inside code. Budget section-by-section.

// rough estimator: ~4 chars per token (safe-ish for English + code)
const estTokens = (s: string) => Math.ceil(s.length / 4);

function renderOutline(out: Outline, opts: { tokenBudget: number; linkToFull?: string }): string {
  const parts: string[] = [`# ${out.title}`];
  if (opts.linkToFull) parts.push(`Full details: ${opts.linkToFull}`);

  let spent = estTokens(parts.join('\n\n'));
  for (const sec of out.sections) {
    const header = `\n\n**${sec.h}**\n`;
    const hCost = estTokens(header);
    if (spent + hCost > opts.tokenBudget) break;

    parts.push(header.trim());
    spent += hCost;

    for (const item of sec.items) {
      const bullet = `- ${truncateAtSentence(item, opts.tokenBudget - spent)}`;
      const cost = estTokens(bullet);
      if (spent + cost > opts.tokenBudget) break;
      parts.push(bullet);
      spent += cost;
    }
  }
  return parts.join('\n');
}

function truncateAtSentence(text: string, remainingTokens: number): string {
  // keep whole sentences under budget; otherwise take a clean clause
  const sentences = text.replace(/\s+/g,' ').match(/[^.!?]+[.!?]/g) || [text];
  let out = '';
  for (const s of sentences) {
    const next = (out ? out + ' ' : '') + s.trim();
    if (estTokens(next) <= Math.max(remainingTokens - 4, 0)) out = next; else break;
  }
  return out || sentences[0].slice(0, Math.max(remainingTokens*4 - 1, 0)) + '…';
}

5) Putting it together

export function generateHandoff(messages: Msg[], opts: { fullStore: (s: string)=>string, tokenBudget?: number }){
  const sigs = toSignals(messages);
  const convType = detectType(sigs);

  // 1) full (lossless): include full messages + code blocks
  const full = renderFullMarkdown(messages);                   // your existing verbose template
  const fullUrlOrId = opts.fullStore(full);                    // returns a URL or ID

  // 2) smart compressed
  const outline = ({
    debugging:      compressDebug,
    architecture:   compressArchitecture,
    implementation: compressImplementation,
    general:        compressGeneral,
  }[convType])(sigs);

  const quick = renderOutline(outline, {
    tokenBudget: opts.tokenBudget ?? 500,
    linkToFull: fullUrlOrId
  });

  return { type: convType, quick, fullRef: fullUrlOrId };
}


⸻

Why this works
	•	No mid-sentence truncation. The budgeter trims at sentence boundaries.
	•	No broken code blocks. Code is summarized with signatures and a hash; the full code lives in the full artifact.
	•	Use-case relevance. Debugging/architecture/implementation each get a purpose-built outline.
	•	Deterministic + cheap. It’s all regex/heuristics; fast in a service worker.
	•	Auditable. The quick handoff links to a canonical artifact with content hashes so you can reconcile exactly what was compressed.

⸻

Practical heuristics (starting set)

Debugging
	•	Keep: last error (1–2 sentences), the working fix (1–2 sentences), decisions (≤2), next steps (≤3 bullets).
	•	Drop: repeated error prints, early failed attempts, stack traces (replace by “trace present, see full #hash”).

Architecture
	•	Keep: the question, 2–3 options with one-line pros/cons, the chosen decision with one-line rationale, next steps.
	•	Drop: deep impl details, long code.

Implementation
	•	Keep: what shipped (module/function names), how it behaves (1 sentence each), next steps.
	•	Summarize code as signatures + LOC + hash.

⸻

Token budget reality
	•	500 tokens is workable for most “carry-forward” summaries if you compress by structure, not by characters.
	•	Use different budgets per type if needed: e.g., debugging (400–600), architecture (300–500), implementation (400–700). Make it configurable.

⸻

Additional tips
	•	Avoid paraphrase when extract works. Ranking sentences from the dialog and reusing them preserves fidelity and reduces hallucination.
	•	Stamp versions + hashes. Include a handoffId, fullHash, and generatedAt in both artifacts.
	•	Guardrails in UI. If you cross 500 tokens after formatting, auto re-fit once (don’t ask the user).

⸻

Example output (debugging, ~100–150 tokens)

# DuoEcho Debug Handoff
Full details: https://…/handoff/ab12cd34

**Problem**
- Extraction mixed console/UI with messages; wrong selectors (`.font-claude-message`) and noisy DOM.

**What Worked**
- Limited scope to message bubbles; removed `[role=status]`, hidden nodes; used `innerText` for prose and fenced `textContent` for code.

**Decision(s)**
- Keep full artifact w/ code; quick handoff summarizes signatures + hashes.

**Next**
- Run e2e on Claude + ChatGPT
- Add incognito/regular storage parity check
- Ship v0.9.3


⸻

If you want, I can adapt these snippets to your existing content-working.js handoff generator (namespacing, exports, and tests) and wire the full artifact store to your current GitHub/Gist flow.