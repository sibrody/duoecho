// DuoEcho Background Service Worker - Enhanced with Status YAML + Deterministic Links
console.log('🚀 DuoEcho background service starting');

// Register IMMEDIATELY
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  return handleMessage(msg, sender, sendResponse); // keep channel if needed
});

// Hoisted function (use a function declaration, NOT const/arrow)
function handleMessage(msg, sender, sendResponse) {
  console.log('Background received message:', msg.action || msg.type);
  
  // Handle ping immediately
  if (msg?.type === 'duoecho-ping') {
    sendResponse({ ok: true });
    return true;
  }
  
  // Health check ping/pong
  if (msg.ping === 'duoecho') {
    console.log('🏓 Responding to ping');
    sendResponse({ pong: true, time: Date.now() });
    return true;
  }
  
  // Diagnostic ping
  if (msg.type === 'duoEchoPing') {
    console.log('[DuoEcho SW] received ping from CS', sender);
    sendResponse({ pong: true });
    return true;
  }
  
  // Relay ready message from content script to popup
  if (msg?.type === 'duoEchoConversationReady') {
    console.log('Background: Relaying ready message to all extension views');
    chrome.runtime.sendMessage(msg);
    sendResponse({ success: true });
    return true;
  }
  
  // Handle script injection request from content script
  if (msg.action === 'injectPageScript' && sender.tab?.id) {
    console.log('Injecting page script into tab:', sender.tab.id);
    chrome.scripting.executeScript({
      target: { tabId: sender.tab.id, allFrames: false },
      world: 'MAIN',
      files: ['src/sniffer-injected.js']
    }).then(() => {
      console.log('Injection OK');
      // ✅ respond with both fields so any caller is happy
      sendResponse({ success: true, ok: true });
    }).catch(err => {
      console.error('Injection failed:', err);
      sendResponse({ success: false, ok: false, error: String(err) });
    });
    return true; // keep channel open for async sendResponse
  }
  
  // Handle JSON from clean status-driven system
  if (msg.action === 'claudeJson') {
    handleClaudeJson(msg.payload)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  
  return false;
}

// Constants for freshness and decision detection
const SUCCESS_RX  = /\b(working|captured|fixed|resolved|now (works|stable)|hooks? installed)\b/i;
const DECISION_RX = /\b(fix|fixed|resolve[d]?|implement(?:ed|ing)?|working|decided|chosen|merged|refactor(?:ed)?|rename(?:d)?|revert(?:ed)?)\b|listener|CORS|status\s?15|manifest\.json|json-sniffer\.js|chrome\.scripting/i;
const ERROR_RX    = /\b(error|exception|failed|status\s*\d{3}|ReferenceError|TypeError|NetworkError|CORS)\b/i;

const SIGNAL_TOKEN_LIMIT = 1200;
const FOOTER_RESERVE_TOKENS = 180;
const SIGNAL_WARN_FRACTION = 0.80;

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

// DUOECHO: progress emitter (safe no-op if popup not open)
function duoechoEmitProgress(pct, warn = false) {
  const p = Math.max(0, Math.min(100, Math.round(Number(pct) || 0)));
  try {
    chrome.runtime.sendMessage({ type: 'duoechoTokenProgress', pct: p, warn: !!warn });
  } catch {/* no-op */}
}

// DUOECHO: guarded append that tracks tokens and emits progress
function tryAppendProgress(out, chunk, usedTokensRef) {
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

  // --- Tail safety net: always include the last few lines ---
  function tailLines(msgs, n = 8) {
    const tail = msgs.slice(-n);
    return tail.map(m => {
      const who = m.role === 'user' ? 'U' : 'A';
      const t = (m.text || '').replace(/```[\s\S]*?```/g, '[code]').replace(/\s+/g, ' ').trim();
      return `- ${who}: ${takeClean(t, 60)}`;
    }).join('\n');
  }

  const tail = tailLines(msgs, 8);
  out = tryAppendProgress(out, `## Tail (last 8 msgs)\n${tail}\n\n`, used);

  // footer (we reserved tokens in tryAppendProgress)
  out += `---\nFull details: ${link}\n`;

  duoechoEmitProgress(100, false);
  return out;
}

// GitHub Configuration
const GITHUB_CONFIG = {
  owner: 'sibrody',
  repo: 'duoecho',
  branch: 'main',
  folder: 'handoffs'
};

// =====================================
// CORE UTILITY FUNCTIONS
// =====================================

// A) Deterministic slug function for consistent naming
function toSlug(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Token budget management for signal footer
function truncateToTokenBudget(body, maxTokens = 1200, footerReserve = 150) {
  const CHAR_TO_TOKEN_RATIO = 4;
  const maxChars = (maxTokens - footerReserve) * CHAR_TO_TOKEN_RATIO;
  
  if (body.length <= maxChars) return body;
  
  // Find good truncation point (end of sentence or section)
  let truncateAt = maxChars;
  const candidates = [
    body.lastIndexOf('\n\n', maxChars),
    body.lastIndexOf('. ', maxChars),
    body.lastIndexOf('\n', maxChars)
  ];
  
  for (const candidate of candidates) {
    if (candidate > maxChars * 0.8) { // Don't truncate too aggressively
      truncateAt = candidate;
      break;
    }
  }
  
  return body.substring(0, truncateAt) + '\n\n[...truncated to preserve footer...]';
}

// Simple YAML parser/writer (no dependencies)
function parseSimpleYaml(yamlText) {
  const result = { conversations: [] };
  const lines = yamlText.split('\n');
  let currentConversation = null;
  let currentSection = null;
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    
    if (trimmed === 'conversations:') {
      currentSection = 'conversations';
      continue;
    }
    
    if (trimmed.startsWith('- conversation_id:')) {
      if (currentConversation) {
        result.conversations.push(currentConversation);
      }
      currentConversation = {
        conversation_id: trimmed.split(':', 2)[1]?.trim().replace(/['"]/g, ''),
        files: {},
        links: {},
        phase_flags: { phase1: {} },
        notes: []
      };
      continue;
    }
    
    if (currentConversation && trimmed.includes(':')) {
      const [key, ...valueParts] = trimmed.split(':');
      const value = valueParts.join(':').trim().replace(/['"]/g, '');
      const cleanKey = key.trim();
      
      if (cleanKey === 'title_slug') currentConversation.title_slug = value;
      else if (cleanKey === 'started_at') currentConversation.started_at = value;
      else if (cleanKey === 'generated_at') currentConversation.generated_at = value;
      else if (cleanKey === 'message_count') currentConversation.message_count = parseInt(value);
      else if (cleanKey === 'signal') currentConversation.files.signal = value;
      else if (cleanKey === 'full') currentConversation.files.full = value;
      else if (cleanKey === 'repo_signal') currentConversation.links.repo_signal = value;
      else if (cleanKey === 'repo_full') currentConversation.links.repo_full = value;
      else if (cleanKey === 'signal_template') currentConversation.phase_flags.phase1.signal_template = value === 'true';
      else if (cleanKey === 'token_budget') currentConversation.phase_flags.phase1.token_budget = parseInt(value);
      else if (cleanKey === 'full_link_in_signal') currentConversation.phase_flags.phase1.full_link_in_signal = value === 'true';
    }
  }
  
  if (currentConversation) {
    result.conversations.push(currentConversation);
  }
  
  return result;
}

function generateSimpleYaml(data) {
  let yaml = 'conversations:\n';
  
  for (const conv of data.conversations) {
    yaml += `  - conversation_id: "${conv.conversation_id}"\n`;
    yaml += `    title_slug: "${conv.title_slug}"\n`;
    yaml += `    started_at: "${conv.started_at}"\n`;
    yaml += `    generated_at: "${conv.generated_at}"\n`;
    yaml += `    message_count: ${conv.message_count}\n`;
    yaml += `    files:\n`;
    yaml += `      signal: "${conv.files.signal}"\n`;
    yaml += `      full: "${conv.files.full}"\n`;
    yaml += `    links:\n`;
    yaml += `      repo_signal: "${conv.links.repo_signal}"\n`;
    yaml += `      repo_full: "${conv.links.repo_full}"\n`;
    yaml += `    phase_flags:\n`;
    yaml += `      phase1:\n`;
    yaml += `        signal_template: ${conv.phase_flags.phase1.signal_template}\n`;
    yaml += `        token_budget: ${conv.phase_flags.phase1.token_budget}\n`;
    yaml += `        full_link_in_signal: ${conv.phase_flags.phase1.full_link_in_signal}\n`;
    if (conv.notes && conv.notes.length > 0) {
      yaml += `    notes: ${JSON.stringify(conv.notes)}\n`;
    } else {
      yaml += `    notes: []\n`;
    }
  }
  
  return yaml;
}

// Get current conversation status from YAML (with cache busting)
async function getConversationStatus(conversationId, titleSlug) {
  try {
    const token = await getGitHubToken();
    if (!token) return null;
    
    const statusPath = `${GITHUB_CONFIG.folder}/handoff-status.yml`;
    
    // Use new GitHub API helpers to avoid CORS
    const files = await listDir({
      owner: GITHUB_CONFIG.owner,
      repo: GITHUB_CONFIG.repo,
      dir: GITHUB_CONFIG.folder,
      ref: GITHUB_CONFIG.branch,
      token: token
    });
    
    const statusFile = files.find(f => f.name === 'handoff-status.yml');
    if (!statusFile || !statusFile.download_url) return null;
    
    const response = await fetch(statusFile.download_url);
    if (!response.ok) return null;
    
    const yamlContent = await response.text();
    const statusData = parseSimpleYaml(yamlContent);
    
    // Pick right record (by ID first, then newest by title_slug)
    return pickConversationStatus(statusData, { id: conversationId, title_slug: titleSlug });
    
  } catch (error) {
    console.warn('Could not fetch conversation status:', error);
    return null;
  }
}

// Pick the right conversation record (exact ID match, then newest by slug)
function pickConversationStatus(yml, convo) {
  const all = (yml.conversations || []);
  
  // 1) Exact match by conversation_id
  let candidates = all.filter(c => c.conversation_id === convo.id);
  
  // 2) Fallback: same title_slug, use most recent generated_at
  if (!candidates.length) {
    candidates = all.filter(c => c.title_slug === convo.title_slug);
  }
  
  // Sort by generated_at desc (newest first)
  candidates.sort((a, b) => new Date(b.generated_at) - new Date(a.generated_at));
  
  return candidates[0] || null;
}

// C) Find related conversations with same title slug
async function findRelatedConversations(titleSlug, excludeTs, daysBack = 10) {
  try {
    const token = await getGitHubToken();
    if (!token) return [];
    
    const cutoffDate = new Date(Date.now() - (daysBack * 24 * 60 * 60 * 1000));
    const apiUrl = `https://api.github.com/repos/${GITHUB_CONFIG.owner}/${GITHUB_CONFIG.repo}/contents/${GITHUB_CONFIG.folder}`;
    
    // Use new listDir helper to avoid CORS
    const files = await listDir({
      owner: GITHUB_CONFIG.owner,
      repo: GITHUB_CONFIG.repo,
      dir: GITHUB_CONFIG.folder,
      ref: GITHUB_CONFIG.branch,
      token: token
    });
    const related = [];
    
    for (const file of files) {
      // Look for files with same title slug, different timestamp
      const match = file.name.match(/duoecho-(full|signal)-(.*)-([\d{8}T\d{6}Z]{15})\.md$/);
      if (match && match[2] === titleSlug && match[3] !== excludeTs) {
        const fileDate = new Date(match[3].replace(/(\d{8})T(\d{2})(\d{2})(\d{2})/, 
          '$1T$2:$3:$4Z'));
        
        if (fileDate >= cutoffDate) {
          related.push({
            filename: file.name,
            type: match[1],
            timestamp: match[3],
            date: fileDate,
            url: `https://github.com/${GITHUB_CONFIG.owner}/${GITHUB_CONFIG.repo}/blob/${GITHUB_CONFIG.branch}/${GITHUB_CONFIG.folder}/${file.name}`
          });
        }
      }
    }
    
    // Sort by date (newest first) and return up to 5 full files only
    return related
      .filter(r => r.type === 'full')
      .sort((a, b) => b.date - a.date)
      .slice(0, 5)
      .map(r => r.url);
    
  } catch (error) {
    console.warn('Could not fetch related conversations:', error);
    return [];
  }
}

// =====================================
// GITHUB API FUNCTIONS
// =====================================

// --- Signal token budgeting (no external tokenizer) ---
// NOTE: SIGNAL_TOKEN_LIMIT and SIGNAL_WARN_FRACTION already defined above
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

// GitHub API helpers with proper headers and SHA handling
function ghHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
    // DO NOT add Cache-Control / Pragma here
  };
}

async function getFileSha({ owner, repo, path, branch, token }) {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`;
  const res = await fetch(url, { headers: ghHeaders(token) });
  if (res.status === 404) return null;              // file does not exist yet
  if (!res.ok) throw new Error(`getFileSha ${res.status}`);
  const json = await res.json();
  return json.sha;                                  // current blob sha
}

async function putFile({ owner, repo, path, branch, message, contentBase64, token }) {
  const headers = { ...ghHeaders(token), 'Content-Type': 'application/json' };

  // decide create vs update
  let sha = await getFileSha({ owner, repo, path, branch, token });
  let body = { message, content: contentBase64, branch };
  if (sha) body.sha = sha;

  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`;
  let res = await fetch(url, { method: 'PUT', headers, body: JSON.stringify(body) });

  // handle 409 conflict by refetching sha once and retrying
  if (res.status === 409) {
    const latest = await getFileSha({ owner, repo, path, branch, token });
    if (!latest) throw new Error('409: file missing unexpectedly');
    body.sha = latest;
    res = await fetch(url, { method: 'PUT', headers, body: JSON.stringify(body) });
  }

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GitHub PUT failed ${res.status}: ${err}`);
  }
  return res.json(); // contains content.html_url, etc.
}

function pickGithubUrl(uploadResp, owner, repo, branch, path) {
  return (
    uploadResp?.content?.html_url ||
    uploadResp?.html_url ||
    `https://github.com/${owner}/${repo}/blob/${branch}/${path}`
  );
}

async function listDir({ owner, repo, dir, ref, token }) {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(dir)}?ref=${encodeURIComponent(ref)}`;
  const res = await fetch(url, { headers: ghHeaders(token) });
  if (!res.ok) throw new Error(`listDir ${res.status}`);
  return res.json(); // array of entries
}

// NOTE: Old generateSignalFromJson function removed - using new chat_debug8.md implementation above

// =====================================
// GITHUB API FUNCTIONS (UPDATED)
// =====================================

async function getGitHubToken() {
  const result = await chrome.storage.local.get(['githubToken']);
  return result.githubToken;
}

// Push handoff to GitHub - FIXED VERSION
async function pushHandoffToGitHub(content, filename) {
  try {
    const token = await getGitHubToken();
    
    if (!token) {
      console.error('No GitHub token found');
      return { success: false, error: 'No GitHub token configured' };
    }
    
    // Use new GitHub API helpers
    const filePath = `${GITHUB_CONFIG.folder}/${filename}`;
    const base64Content = btoa(unescape(encodeURIComponent(content)));
    
    console.log('📤 Pushing to GitHub:', { filename, filePath });
    
    const uploadResp = await putFile({
      owner: GITHUB_CONFIG.owner,
      repo: GITHUB_CONFIG.repo,
      path: filePath,
      branch: GITHUB_CONFIG.branch,
      message: `Add handoff: ${filename}`,
      contentBase64: base64Content,
      token: token
    });
    
    const realUrl = pickGithubUrl(uploadResp, GITHUB_CONFIG.owner, GITHUB_CONFIG.repo, GITHUB_CONFIG.branch, filePath);
    
    console.log('✅ Successfully pushed to GitHub:', realUrl);
    console.log('🔍 GitHub API response:', {
      path: uploadResp.content?.path,
      name: uploadResp.content?.name,
      html_url: uploadResp.content?.html_url,
      download_url: uploadResp.content?.download_url
    });
    
    return {
      success: true,
      url: realUrl,
      download_url: uploadResp.content?.download_url,
      path: uploadResp.content?.path,
      sha: uploadResp.content?.sha,
      name: uploadResp.content?.name
    };
  } catch (error) {
    console.error('Error pushing to GitHub:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// D) Update or create handoff-status.yml with conflict-safe handling
async function updateStatusYamlSafe(conversationRecord) {
  try {
    const token = await getGitHubToken();
    if (!token) return { success: false, error: 'No GitHub token' };
    
    const statusPath = `${GITHUB_CONFIG.folder}/handoff-status.yml`;
    
    // Try to get existing status file with proper SHA handling
    let existingData = { conversations: [] };
    let sha = await getFileSha({
      owner: GITHUB_CONFIG.owner,
      repo: GITHUB_CONFIG.repo, 
      path: statusPath,
      branch: GITHUB_CONFIG.branch,
      token: token
    });
    
    if (sha) {
      try {
        const files = await listDir({
          owner: GITHUB_CONFIG.owner,
          repo: GITHUB_CONFIG.repo,
          dir: GITHUB_CONFIG.folder,
          ref: GITHUB_CONFIG.branch,
          token: token
        });
        
        const statusFile = files.find(f => f.name === 'handoff-status.yml');
        if (statusFile && statusFile.download_url) {
          const response = await fetch(statusFile.download_url);
          const yamlContent = await response.text();
          existingData = parseSimpleYaml(yamlContent);
          console.log('📋 Existing status file loaded with', existingData.conversations.length, 'conversations');
        }
      } catch (e) {
        console.log('📋 Could not load existing status, creating new');
      }
    }
    
    // Upsert the conversation record
    const existingIndex = existingData.conversations.findIndex(
      c => c.conversation_id === conversationRecord.conversation_id || 
           (c.title_slug === conversationRecord.title_slug && 
            c.generated_at === conversationRecord.generated_at)
    );
    
    if (existingIndex >= 0) {
      existingData.conversations[existingIndex] = conversationRecord;
      console.log('📝 Updated existing conversation record');
    } else {
      existingData.conversations.push(conversationRecord);
      console.log('📝 Added new conversation record');
    }
    
    // Generate updated YAML
    const yamlContent = generateSimpleYaml(existingData);
    const base64Content = btoa(unescape(encodeURIComponent(yamlContent)));
    
    // Use conflict-safe putFile
    const uploadResp = await putFile({
      owner: GITHUB_CONFIG.owner,
      repo: GITHUB_CONFIG.repo,
      path: statusPath,
      branch: GITHUB_CONFIG.branch,
      message: sha ? 'Update handoff status' : 'Create handoff status file',
      contentBase64: base64Content,
      token: token
    });
    
    console.log('✅ Status YAML updated successfully');
    return { success: true };
    
  } catch (error) {
    console.error('❌ Error updating status YAML:', error);
    return { success: false, error: error.message };
  }
}

// Legacy updateStatusYaml function for compatibility
async function updateStatusYaml(conversationRecord) {
  try {
    const token = await getGitHubToken();
    if (!token) return { success: false, error: 'No GitHub token' };
    
    const statusPath = `${GITHUB_CONFIG.folder}/handoff-status.yml`;
    const apiUrl = `https://api.github.com/repos/${GITHUB_CONFIG.owner}/${GITHUB_CONFIG.repo}/contents/${statusPath}`;
    
    // Try to get existing status file
    let existingData = { conversations: [] };
    let sha = null;
    
    try {
      const getResponse = await fetch(apiUrl, {
        headers: {
          'Authorization': `token ${token}`,
          'Accept': 'application/vnd.github+json'
        }
      });
      
      if (getResponse.ok) {
        const fileData = await getResponse.json();
        sha = fileData.sha;
        const yamlContent = atob(fileData.content);
        existingData = parseSimpleYaml(yamlContent);
        console.log('📋 Existing status file loaded with', existingData.conversations.length, 'conversations');
      }
    } catch (e) {
      console.log('📋 Creating new status file');
    }
    
    // Upsert the conversation record
    const existingIndex = existingData.conversations.findIndex(
      c => c.conversation_id === conversationRecord.conversation_id || 
           (c.title_slug === conversationRecord.title_slug && 
            c.generated_at === conversationRecord.generated_at)
    );
    
    if (existingIndex >= 0) {
      existingData.conversations[existingIndex] = conversationRecord;
      console.log('📝 Updated existing conversation record');
    } else {
      existingData.conversations.push(conversationRecord);
      console.log('📝 Added new conversation record');
    }
    
    // Generate updated YAML
    const yamlContent = generateSimpleYaml(existingData);
    const base64Content = btoa(unescape(encodeURIComponent(yamlContent)));
    
    // Push to GitHub
    const body = {
      message: sha ? 'Update handoff status' : 'Create handoff status file',
      content: base64Content,
      branch: GITHUB_CONFIG.branch
    };
    
    if (sha) body.sha = sha;
    
    const response = await fetch(apiUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    
    if (response.ok) {
      console.log('✅ Status YAML updated successfully');
      return { success: true };
    } else {
      console.error('❌ Failed to update status YAML:', response.status);
      return { success: false, error: `GitHub error: ${response.status}` };
    }
    
  } catch (error) {
    console.error('❌ Error updating status YAML:', error);
    return { success: false, error: error.message };
  }
}

// =====================================
// ENHANCED SIGNAL GENERATOR (1200-1500 tokens)
// =====================================

class EnhancedSignalGenerator {
  constructor() {
    this.TOKEN_LIMIT = 1400; // Increased for better context
    this.FOOTER_RESERVE = 150;
    this.CHAR_TO_TOKEN_RATIO = 3;
  }

  async generate(messages, metadata = {}, titleSlug = '', timestamp = '', statusFlags = null) {
    const signals = this.extractSignals(messages);
    const type = this.detectType(signals);
    
    // Build structured signal handoff (without footer first)
    let handoff = `# ${metadata.project || 'DuoEcho'} - ${type} Signal\n\n`;
    handoff += `**Generated**: ${new Date().toISOString()}\n`;
    handoff += `**Model**: ${metadata.model || 'unknown'}\n`;
    handoff += `**Messages**: ${messages.length}\n\n`;
    
    // B) Structured sections with token budget management + status awareness
    const structuredContent = this.buildStructuredContent(signals, type, true, statusFlags);
    const bodyWithoutFooter = handoff + structuredContent;
    
    // Truncate to preserve footer space
    const truncatedBody = truncateToTokenBudget(
      bodyWithoutFooter, 
      this.TOKEN_LIMIT, 
      this.FOOTER_RESERVE
    );
    
    // C) Get related conversations
    const relatedLinks = await findRelatedConversations(titleSlug, timestamp);
    
    // B) Build guaranteed footer (cannot be truncated)
    const repoUrlToFull = `https://github.com/${GITHUB_CONFIG.owner}/${GITHUB_CONFIG.repo}/blob/${GITHUB_CONFIG.branch}/${GITHUB_CONFIG.folder}/duoecho-full-${titleSlug}-${timestamp}.md`;
    
    let footer = '\n---\n\n';
    footer += `**Full conversation & details**:\n${repoUrlToFull}\n\n`;
    
    if (relatedLinks.length > 0) {
      footer += `**Related recent handoffs**:\n`;
      relatedLinks.forEach(link => {
        footer += `- ${link}\n`;
      });
    } else {
      footer += `**Related recent handoffs**:\nNone found\n`;
    }
    
    const finalHandoff = truncatedBody + footer;
    
    return {
      handoff: finalHandoff,
      type,
      signals,
      tokenEstimate: Math.ceil(finalHandoff.length / this.CHAR_TO_TOKEN_RATIO),
      relatedCount: relatedLinks.length,
      repoUrlToFull
    };
  }
  
  buildStructuredContent(signals, type, verbose, statusFlags = null) {
    let content = '';
    
    // Check if Phase 1 is complete (guard against regression)
    const phase1Complete = statusFlags?.phase1?.signal_template && 
                          (statusFlags?.phase1?.token_budget ?? 0) >= 1200 &&
                          statusFlags?.phase1?.full_link_in_signal;
    
    // Key Decisions
    const decisions = signals.filter(s => s.type === 'decision').slice(0, 3);
    if (decisions.length > 0) {
      content += `## Key Decisions\n`;
      decisions.forEach(d => {
        content += `- ${verbose ? d.text : d.text.substring(0, 200)}\n`;
      });
      content += '\n';
    }
    
    // Errors & Gotchas
    const errors = signals.filter(s => s.type === 'error').slice(0, 2);
    if (errors.length > 0) {
      content += `## Errors & Gotchas\n`;
      errors.forEach(e => {
        content += `- ${verbose ? e.text : e.text.substring(0, 200)}\n`;
      });
      content += '\n';
    }
    
    // Code Changes
    const code = signals.filter(s => s.type === 'code').slice(0, 3);
    if (code.length > 0) {
      content += `## Code Changes\n`;
      code.forEach(c => {
        content += `- ${c.text}\n`;
      });
      content += '\n';
    }
    
    // Next Steps (guard against Phase 1 recommendations)
    const nexts = signals.filter(s => s.type === 'next').slice(0, 3);
    if (nexts.length > 0) {
      content += `## Next Steps\n`;
      nexts.forEach(n => {
        const text = verbose ? n.text : n.text.substring(0, 200);
        // Filter out completed Phase 1 recommendations
        if (!phase1Complete || !this.isPhase1Recommendation(text)) {
          content += `- ${text}\n`;
        }
      });
      content += '\n';
    }
    
    // Add status awareness note if Phase 1 complete
    if (phase1Complete) {
      content += `## Status\n- ✅ Phase 1 items (signal template, token budget 1400, full links) are complete\n\n`;
    }
    
    return content;
  }
  
  // Check if a recommendation is a completed Phase 1 item
  isPhase1Recommendation(text) {
    const phase1Patterns = [
      /signal.*template/i,
      /token.*budget.*1200/i,
      /full.*link/i,
      /signal.*footer/i,
      /structured.*section/i
    ];
    
    return phase1Patterns.some(pattern => pattern.test(text));
  }

  extractSignals(messages) {
    const signals = [];
    
    messages.forEach((msg, idx) => {
      const text = msg.text || msg.content || '';
      if (!text.trim()) return;
      
      // Error signals
      if (/error|exception|failed|not working|broken/i.test(text)) {
        signals.push({
          type: 'error',
          text: this.extractSentence(text, /error|exception|failed|broken/i),
          weight: 5,
          index: idx,
          role: msg.role
        });
      }
      
      // Fix/solution signals
      if (/fix(ed|ing)?|solved|solution|works now|resolved/i.test(text)) {
        signals.push({
          type: 'fix',
          text: this.extractSentence(text, /fix|solved|works|resolved/i),
          weight: 5,
          index: idx,
          role: msg.role
        });
      }
      
      // Decision signals
      if (/decided|let's go with|we should|agreed|yes.*exactly|option [ABC]/i.test(text)) {
        signals.push({
          type: 'decision',
          text: this.extractSentence(text, /decided|let's|should|agreed|option/i),
          weight: 4,
          index: idx,
          role: msg.role
        });
      }
      
      // Next step signals
      if (/next step|todo|need to|should now|then we|implement/i.test(text)) {
        signals.push({
          type: 'next',
          text: this.extractSentence(text, /next|todo|need to|implement/i),
          weight: 3,
          index: idx,
          role: msg.role
        });
      }
      
      // Code signals
      if (/```|function\s|class\s|const\s|import\s/i.test(text)) {
        const codeDesc = this.extractCodeDescription(text);
        signals.push({
          type: 'code',
          text: codeDesc,
          weight: 2,
          index: idx,
          role: msg.role
        });
      }
    });
    
    return this.dedupeSignals(signals);
  }
  
  extractSentence(text, pattern) {
    const sentences = text.split(/[.!?]\s+/);
    const matched = sentences.find(s => pattern.test(s));
    if (matched) {
      return matched.trim().substring(0, 500); // Increased for verbose mode
    }
    
    // Fallback: extract around the match
    const match = text.match(pattern);
    if (match) {
      const start = Math.max(0, match.index - 50);
      const end = Math.min(text.length, match.index + 300);
      return '...' + text.substring(start, end).trim() + '...';
    }
    return text.substring(0, 500);
  }
  
  extractCodeDescription(text) {
    const funcMatch = text.match(/function\s+(\w+)/i);
    const classMatch = text.match(/class\s+(\w+)/i);
    const fileMatch = text.match(/([\w-]+\.(js|jsx|ts|tsx|py|md))/i);
    
    if (funcMatch) return `Function: ${funcMatch[1]}`;
    if (classMatch) return `Class: ${classMatch[1]}`;
    if (fileMatch) return `File: ${fileMatch[1]}`;
    return 'Code implementation';
  }
  
  dedupeSignals(signals) {
    const seen = new Set();
    const unique = [];
    
    signals.forEach(sig => {
      const key = `${sig.type}:${sig.text.substring(0, 50)}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(sig);
      }
    });
    
    return unique.sort((a, b) => b.weight - a.weight);
  }
  
  detectType(signals) {
    const types = signals.map(s => s.type);
    
    if (types.includes('error') || types.includes('fix')) {
      return 'Debug';
    }
    if (types.filter(t => t === 'decision').length >= 2) {
      return 'Architecture';
    }
    if (types.filter(t => t === 'code').length >= 2) {
      return 'Implementation';
    }
    return 'General';
  }
}

// =====================================
// CONVERSATION PROCESSING
// =====================================

// Generate full handoff markdown
function generateFullHandoff(conversationData) {
  const now = new Date().toISOString();
  const conversationStart = conversationData.messages[0]?.created_at || now;
  
  let markdown = `# ${conversationData.metadata?.project || 'DuoEcho'} - "${conversationData.name}" - Full Handoff\n\n`;
  
  // YAML-style header with metadata
  markdown += `**Conversation Start**: ${conversationStart}\n`;
  markdown += `**Handoff Generated**: ${now}\n`;
  markdown += `**Chat Title**: ${conversationData.name}\n`;
  markdown += `**Model**: ${conversationData.metadata?.model || 'unknown'}\n`;
  markdown += `**Project**: ${conversationData.metadata?.project || 'DuoEcho'}\n`;
  markdown += `**Total Messages**: ${conversationData.messages?.length || 0}\n\n`;
  
  markdown += `## Conversation\n\n`;
  
  // Add all messages
  conversationData.messages.forEach((msg, index) => {
    const role = msg.role === 'user' ? 'Human' : 'Assistant';
    const timestamp = msg.created_at ? new Date(msg.created_at).toLocaleTimeString() : '';
    
    markdown += `### **${role}**${timestamp ? ` (${timestamp})` : ''}\n\n`;
    markdown += `${msg.text || msg.content || ''}\n\n`;
    markdown += `---\n\n`;
  });
  
  return markdown;
}

// Main conversation processing function with deterministic linking
async function handleClaudeJson(conversationData) {
  try {
    console.log('🎯 Processing Claude conversation:', {
      id: conversationData.conversation_id,
      name: conversationData.name,
      messages: conversationData.messages?.length,
      project: conversationData.metadata?.project
    });
    
    // === FILENAMES & PATHS FIRST (fix TDZ bug) ===
    const title = (conversationData.name || 'untitled').trim();
    const titleSlug = toSlug(title);
    const generatedAt = conversationData.metadata?.generated_at || Date.now();
    const ts = new Date(generatedAt).toISOString().replace(/[:.]/g, '');
    
    const dir = GITHUB_CONFIG.folder;
    const fullFilename = `duoecho-full-${titleSlug}-${ts}.md`;
    const signalFilename = `duoecho-signal-${titleSlug}-${ts}.md`;
    
    const fullPath = `${dir}/${fullFilename}`;
    const signalPath = `${dir}/${signalFilename}`;
    
    console.log('📝 Deterministic naming:', { titleSlug, ts, fullFilename, signalFilename });
    
    // Single source of truth: create phase_flags in memory first
    const conversationRecord = {
      conversation_id: conversationData.conversation_id || `${titleSlug}-${ts}`,
      title_slug: titleSlug,
      started_at: conversationData.messages[0]?.created_at || new Date().toISOString(),
      generated_at: new Date().toISOString(),
      message_count: conversationData.messages?.length || 0,
      files: {
        signal: signalFilename,
        full: fullFilename
      },
      links: {
        repo_signal: `https://github.com/${GITHUB_CONFIG.owner}/${GITHUB_CONFIG.repo}/blob/${GITHUB_CONFIG.branch}/${signalPath}`,
        repo_full: `https://github.com/${GITHUB_CONFIG.owner}/${GITHUB_CONFIG.repo}/blob/${GITHUB_CONFIG.branch}/${fullPath}`
      },
      phase_flags: {
        phase1: {
          signal_template: true,
          token_budget: 1400,
          full_link_in_signal: true
        }
      },
      notes: []
    };
    
    // Create full handoff markdown
    const fullHandoff = generateFullHandoff(conversationData);
    
    // Upload FULL first, then get real link
    const fullResult = await pushHandoffToGitHub(fullHandoff, fullFilename);
    
    // Prefer the URL GitHub returns; fall back to blob URL
    const realFullUrl = fullResult?.url || 
      `https://github.com/${GITHUB_CONFIG.owner}/${GITHUB_CONFIG.repo}/blob/${GITHUB_CONFIG.branch}/${fullPath}`;
    
    // Now generate the SIGNAL (with enhanced generator + fallback)
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
    
    console.log('📁 Final filenames:', { fullFilename, signalFilename });
    
    // Push both files to GitHub
    const results = [];
    
    // Full handoff (already uploaded above)
    results.push({ type: 'full', filename: fullFilename, ...fullResult });
    
    // Push signal handoff
    const signalResult = await pushHandoffToGitHub(signalHandoff, signalFilename);
    results.push({ type: 'signal', filename: signalFilename, ...signalResult });
    
    // D) Update status YAML with conflict-safe handling
    try {
      const statusResult = await updateStatusYamlSafe(conversationRecord);
      console.log('Status YAML update result:', statusResult.success);
    } catch (statusError) {
      console.warn('Status YAML update failed (non-blocking):', statusError.message);
    }
    
    console.log('✅ Enhanced handoff system complete (conflict-safe):', {
      full: fullFilename,
      signal: signalFilename,
      signalTokens: estTokens(signalHandoff),
      relatedFound: 0, // Will be added back later
      phase1Complete: true
    });
    
    return {
      success: true,
      results,
      files: {
        full: fullFilename,
        signal: signalFilename
      },
      tokenEstimate: estTokens(signalHandoff),
      relatedCount: 0, // Will be restored later
      statusYaml: true,
      deterministic: { titleSlug, ts },
      phase1Complete: true
    };
    
  } catch (error) {
    console.error('❌ Error processing Claude JSON:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// =====================================
// MESSAGE LISTENERS & LEGACY FUNCTIONS
// =====================================

// Save local backup when GitHub sync fails
async function saveLocalBackup(content, filename) {
  try {
    const result = await chrome.storage.local.get(['localBackups']);
    const backups = result.localBackups || [];
    
    backups.push({
      filename,
      content,
      timestamp: new Date().toISOString(),
      synced: false
    });
    
    // Keep only last 10 backups
    if (backups.length > 10) {
      backups.shift();
    }
    
    await chrome.storage.local.set({ localBackups: backups });
    console.log('💾 Saved local backup:', filename);
  } catch (error) {
    console.error('Error saving local backup:', error);
  }
}

// Legacy sync function for backward compatibility
async function syncHandoffToGitHub(markdownContent, project = 'general', customFilename = null) {
  try {
    let filename = customFilename;
    
    if (!filename) {
      const now = new Date();
      const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, -5);
      filename = `${project}-handoff-${timestamp}.md`;
    }
    
    console.log('📤 Legacy sync to GitHub:', { filename, project });
    
    const result = await pushHandoffToGitHub(markdownContent, filename);
    
    if (result.success) {
      await chrome.storage.local.set({
        lastGitHubSync: {
          status: 'success',
          timestamp: new Date().toISOString(),
          filename: filename,
          url: result.url
        }
      });
    } else {
      await saveLocalBackup(markdownContent, filename);
    }
    
    return result;
  } catch (error) {
    console.error('❌ Legacy sync error:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

console.log('✅ Clean Status-Driven DuoEcho Background Service Ready - v1.3');
