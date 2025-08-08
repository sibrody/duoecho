You’re accidentally mixing your own debug logs into the payload you treat as “messages,” and you’re also extracting from the wrong DOM nodes (containers that include UI chrome rather than the message body). That’s why you see lines like:

3074-497f59a4a5eac061.js:4 Found 16 assistant message elements

Those are console line-number suffixes, not chat content. In your current extraction, either:
	•	You push console.log strings into the same array you later serialize as messages, or
	•	You read text from a parent container that includes hidden status/ARIA/log content—so your innerText picks up UI and dev-output text instead of just the message body, or
	•	You use a “debug buffer” (overridden console.log) and concatenate it into the final handoff string.

Below is a drop-in, defensive extraction that (a) scopes to message bubbles only, (b) never uses your logs as data, and (c) filters out scripts/hidden/UI nodes. I’ve also included a clean handoff generator that only uses the extracted roles and text.

⸻

Replace your extractor with this

// content-working.js

/**
 * Returns clean, visible text from a node (paragraphs, lists, blockquotes),
 * and preserves code blocks exactly.
 */
function getVisibleTextFromMessage(messageRoot) {
  if (!messageRoot) return '';

  // 1) Remove obviously non-content nodes
  const junkSelectors = [
    'script', 'style', 'noscript',
    'svg', 'button', 'input', 'textarea',
    '[aria-hidden="true"]', '[hidden]', '[role="status"]', '[role="progressbar"]'
  ];
  junkSelectors.forEach(sel => {
    messageRoot.querySelectorAll(sel).forEach(n => n.remove());
  });

  // 2) Collect code blocks separately so we don’t lose formatting
  const blocks = [];
  messageRoot.querySelectorAll('pre, code').forEach(codeLike => {
    // If <pre><code>…</code></pre>, read from the deepest code element.
    const codeNode = codeLike.matches('pre') && codeLike.querySelector('code') ? codeLike.querySelector('code') : codeLike;
    const codeText = (codeNode.textContent || '').trim();
    if (codeText) {
      // Mark with a fence so the handoff keeps structure
      blocks.push({ kind: 'code', text: codeText });
      // Remove from DOM clone to avoid duplication in normal text extraction
      codeLike.remove();
    }
  });

  // 3) Now extract human-readable text from paragraphs and lists only
  const textParts = [];
  const textSelectors = [
    'p', 'li', 'blockquote'
  ];
  messageRoot.querySelectorAll(textSelectors.join(',')).forEach(el => {
    // innerText respects CSS visibility and inserts reasonable line breaks
    const t = (el.innerText || '').trim();
    if (t) textParts.push(t);
  });

  // 4) Join plain text parts, then re-append code blocks in order of appearance
  const body = textParts.join('\n\n').trim();
  const code = blocks.map(b => '```\n' + b.text + '\n```').join('\n\n');
  return [body, code].filter(Boolean).join('\n\n').trim();
}

/**
 * Robust query helpers for Claude.ai (adjust selectors if Claude changes).
 * Based on your notes:
 *  - user: .font-user-message with p.whitespace-pre-wrap
 *  - assistant: .font-claude-message with p.whitespace-normal
 *
 * We scope to the *message bubble content*, not outer list containers.
 */
function queryClaudeMessageBubbles() {
  // Try the most specific first; fall back to broader classes
  const assistantSel = '.font-claude-message';
  const userSel = '.font-user-message';

  const nodes = Array.from(document.querySelectorAll(`${userSel}, ${assistantSel}`));
  return nodes.map(node => {
    const isAssistant = node.matches(assistantSel);
    const isUser = node.matches(userSel);

    // Claude often nests the real content inside; prefer paragraphs region if present.
    // We clone the node to safely remove junk without altering the page.
    const clone = node.cloneNode(true);

    // Prefer paragraph containers by whitespace class (your observation)
    const paragraphRegion =
      clone.querySelector('p.whitespace-pre-wrap, p.whitespace-normal') ||
      clone;

    return {
      role: isAssistant ? 'assistant' : (isUser ? 'user' : 'unknown'),
      root: paragraphRegion
    };
  }).filter(m => m.role !== 'unknown');
}

/**
 * MAIN: extract Claude messages as [{role, text}]
 */
export function extractClaudeMessages() {
  try {
    const bubbles = queryClaudeMessageBubbles();

    // IMPORTANT: Do not mix logs and data. Only collect structured results.
    const messages = bubbles.map(({ role, root }) => {
      const text = getVisibleTextFromMessage(root);
      return { role, text };
    }).filter(m => m.text); // drop empties

    // Optional: de-dupe consecutive identical messages (Claude sometimes repeats while streaming)
    const deduped = [];
    for (const m of messages) {
      const prev = deduped[deduped.length - 1];
      if (!prev || prev.role !== m.role || prev.text !== m.text) deduped.push(m);
    }

    return deduped;
  } catch (err) {
    // Log to console only; never push logs into message results.
    console.warn('[DuoEcho] extractClaudeMessages failed:', err);
    return [];
  }
}

Why this fixes your issues
	•	No console logs in output: all logs stay in DevTools; we never append logs to the returned array.
	•	No UI chrome / status text: we remove [role="status"], hidden nodes, and common non-content elements before reading.
	•	Correct text vs code: paragraphs/lists use innerText (human readable), while code uses textContent and is wrapped in fenced blocks.
	•	No truncation “…”: DevTools truncation is only a display issue—because we’re not serializing console output, that ellipsis disappears. For DOM text, innerText won’t synthesize “…” unless it’s literal in the DOM.

⸻

Replace your handoff generator with this

export function generateHandoff(messages) {
  // messages: [{role: 'user'|'assistant', text: string}]
  const lastUser = [...messages].reverse().find(m => m.role === 'user');
  const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant');

  const summary = [
    `**Total Messages Captured**: ${messages.length}`,
    lastUser ? `**Last User Input**:\n${lastUser.text}` : `**Last User Input**: (none)`,
    lastAssistant ? `**Last Assistant Response**:\n${lastAssistant.text}` : `**Last Assistant Response**: (none)`,
  ].join('\n\n');

  return {
    summary,
    messages // keep structured for downstream use
  };
}

Key change: This function now consumes only the structured extractor output. It doesn’t touch any debug buffer, and it never concatenates console.log strings.

⸻

If you still see UI/garbage in the text

Claude’s DOM evolves. Harden the selector and visibility rules:
	1.	Gate by visibility (ignore offscreen/virtualized clones):

function isVisible(el) {
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}
// Before using a node:
if (!isVisible(node)) continue;


	2.	Scope to the content region only. If Claude wraps messages in a semantic container (e.g., [data-testid="message-content"] or article), swap the query in queryClaudeMessageBubbles() to target that inner container.
	3.	Strip UI artifacts by role. Expand junkSelectors if you discover new UI fragments (copy buttons, toolbars, “regenerate” chips, etc.).

⸻

Optional: Add a test harness (content script console)

(function testExtraction() {
  try {
    const msgs = extractClaudeMessages();
    console.table(
      msgs.map((m, i) => ({ i, role: m.role, preview: (m.text || '').slice(0, 120) }))
    );
  } catch (e) {
    console.error('Extraction test failed:', e);
  }
})();

This shows you that you’re only seeing role/text pairs, not your diagnostic strings.

⸻

Common pitfalls this avoids
	•	Mixing logs with data: Never push log strings into arrays you later serialize.
	•	Using outer containers: Outer chat nodes often include ARIA/live regions and toolbars; always drill to the paragraph/markdown container.
	•	Relying on textContent only: Great for code; too raw for prose. Use innerText for human-facing text.
	•	Ellipsis from DevTools, not DOM: If you copy from the console output itself, DevTools truncates long lines visually; you inadvertently captured that. The extractor above never reads DevTools output.

⸻

If you paste your current extractClaudeMessages and generateHandoff I can annotate the exact lines to remove/replace—but in most cases, swapping in the snippets above fixes the “console output as content” and “truncated …” issues immediately.