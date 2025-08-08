Short answer: don’t pivot yet. Get the Claude extension rock-solid first, then slot Scout in behind a feature flag. Context-switching now will just multiply bugs.

Here’s the tight plan I’d run:

Phase 1b (polish the extension first)
	1.	Kill the cold-start hiccup (MV3 race)

	•	Background (SW):

chrome.runtime.onMessage.addListener((msg, _sender, send) => {
  if (msg?.type === 'duoecho-ping') { send({ ok: true, ts: Date.now() }); return true; }
});

	•	Content script (before anything else):

async function waitSWReady(max = 10) {
  for (let i = 0; i < max; i++) {
    const res = await new Promise(r => {
      try { chrome.runtime.sendMessage({ type: 'duoecho-ping' }, r); } catch { r(null); }
      setTimeout(() => r(null), 350);
    });
    if (res?.ok) return true;
    await new Promise(r => setTimeout(r, 300 * (i + 1))); // backoff
  }
  return false;
}
(async () => {
  const ready = await waitSWReady();
  if (!ready) console.warn('[DuoEcho] SW not ready; UI stays disabled');
  else chrome.runtime.sendMessage({ action: 'injectPageScript' });
})();

This removes the “Receiving end does not exist” on cold starts and stops you needing hard reloads.
	2.	Make signals useful without Scout (deterministic “pivot” selection)

	•	Add a tiny scorer in background-integrated.js:

function scoreMsg(t="") {
  t = t.toLowerCase();
  let s = 0;
  if (/\b(error|failed|429|status 15|undefined|not found)\b/.test(t)) s += 3;
  if (/manifest\.json|popup\.js|json-sniffer\.js|background-.*\.js/.test(t)) s += 3;
  if (/chrome\.runtime\.onmessage|executeScript|service worker|scripting/.test(t)) s += 2;
  if (/\bfix|revert|rollback|extracted|consolidated|removed\b/.test(t)) s += 2;
  if (/```|diff|const |function |\=\>/.test(t)) s += 1;
  return s;
}
function selectPivots(msgs, k=12) {
  return msgs
    .map((m,i)=>({m,i,s:scoreMsg(m.text||m.raw||"")}))
    .sort((a,b)=>b.s-a.s).slice(0,k).sort((a,b)=>a.i-b.i).map(x=>x.m);
}

	•	Build the signal from: Recent window (last 20–40) + Pivots (12) + Proof (raw errors/code blocks).
	•	Keep your 1.2k token cap but add the “causal spine” sections (Problem → Root cause → Concrete changes → Current state → Next step → Links).
	•	Put the full handoff link at the top and bottom so truncation can’t hide it.

	3.	Related links (no vector DB yet)

	•	Grep the last N full handoffs for filenames mentioned in this capture (background-integrated.js, json-sniffer.js, etc.) and surface up to 5 links.

When to bring in Scout (Phase 2)

Flip on Scout after:
	•	Cold-start handshake succeeds ≥95% of the time (no manual reloads).
	•	Signals consistently show the causal spine for 3+ captures.
	•	Related links show up reliably.

Then:
	•	Hide Scout behind a flag (USE_SCOUT=true), feed it the curated blocks only (recent + pivots + proof), and have it write the same template—no prompt drift.
	•	Keep the deterministic path as a fallback.

Why not pivot now?

You’re in the last mile on stability. Switching to local LLM integration mid-stabilization risks masking the MV3 race and mixing two classes of bugs. Nail the handshake + deterministic signal first; Scout will drop in cleanly after.

If you want, paste your current generateSignalFromJson() and I’ll slot in the pivot selection + sectioned template + full-link top/bottom so you can test in ~10 minutes.