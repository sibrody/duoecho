// DuoEcho Background Service Worker - Fixed version
(() => {
  if (globalThis.__duoechoBannerShown) return;
  globalThis.__duoechoBannerShown = true;

  const VERSION = '1.1.0';
  const BUILD = 'v1.1-stable';   // or env/commit short SHA
  const TS = new Date().toISOString();
  const DEV = true; // Gate with env flag so prod can go quiet
  
  if (!DEV) {
    const originalLog = console.log;
    console.log = () => {};
    // Keep error/warn for debugging
  }

  // collapsed group keeps logs tidy
  console.groupCollapsed(`🚀 DuoEcho SW v${VERSION} (${BUILD}) — ${TS}`);
  console.log('Cold-start:', chrome.runtime?.id);
  console.log('Handoffs dir:', 'handoffs/');
  console.log('Repo:', 'github.com/sibrody/duoecho');
  console.groupEnd();
})();

console.log('[SW] DuoEcho background service started');

// Safe message sending wrapper to silence "message port closed" errors
function safeTabSendMessage(tabId, msg) {
  try {
    chrome.tabs.sendMessage(tabId, msg, () => {
      const e = chrome.runtime.lastError;
      if (e) console.debug('[SW] tabs.sendMessage (harmless):', e.message);
    });
  } catch (err) {
    console.debug('[SW] tabs.sendMessage throw (harmless):', String(err));
  }
}

function safeRuntimeSendMessage(msg) {
  try {
    chrome.runtime.sendMessage(msg, () => {
      const e = chrome.runtime.lastError;
      if (e) console.debug('[SW] runtime.sendMessage (harmless):', e.message);
    });
  } catch (err) {
    console.debug('[SW] runtime.sendMessage throw (harmless):', String(err));
  }
}

// GitHub Configuration
const GITHUB_CONFIG = {
  owner: 'sibrody',
  repo: 'duoecho',
  branch: 'main',
  folder: 'handoffs'
};

// DIAGNOSTIC: Add ping handler for CS testing
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'duoEchoPing') {
    console.log('[SW] received ping from CS', sender);
    sendResponse({ pong: true });
    return;
  }
  
  // Continue with existing handlers below...
});

// Push handoff to GitHub - THIS IS THE ONLY VERSION
async function pushHandoffToGitHub(content, filename) {
  try {
    // Get GitHub token from LOCAL storage
    const result = await chrome.storage.local.get(['githubToken']);
    const token = result.githubToken;
    
    if (!token) {
      console.error('No GitHub token found');
      return { success: false, error: 'No GitHub token configured' };
    }
    
    // Create the file path
    const filePath = `${GITHUB_CONFIG.folder}/${filename}`;
    
    // GitHub API endpoint
    const apiUrl = `https://api.github.com/repos/${GITHUB_CONFIG.owner}/${GITHUB_CONFIG.repo}/contents/${filePath}`;
    
    console.log('📤 Pushing to GitHub:', { filename, filePath });
    
    // First, try to get the file to see if it exists
    let sha = null;
    try {
      const getResponse = await fetch(apiUrl, {
        method: 'GET',
        headers: {
          'Authorization': `token ${token}`,
          'Accept': 'application/vnd.github+json'
        }
      });
      
      if (getResponse.ok) {
        const existingFile = await getResponse.json();
        sha = existingFile.sha;
        console.log('File exists, will update with SHA:', sha);
      }
    } catch (e) {
      console.log('File does not exist yet, will create new');
    }
    
    // Base64 encode the content
    const base64Content = btoa(unescape(encodeURIComponent(content)));
    
    // Create or update file via GitHub API
    const body = {
      message: sha ? `Update handoff: ${filename}` : `Add handoff: ${filename}`,
      content: base64Content,
      branch: GITHUB_CONFIG.branch
    };
    
    // Include SHA if updating existing file
    if (sha) {
      body.sha = sha;
    }
    
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
      const data = await response.json();
      console.log('✅ Successfully pushed to GitHub:', data.content?.html_url);
      console.log('🔍 GitHub API response:', {
        path: data.content?.path,
        name: data.content?.name,
        html_url: data.content?.html_url,
        download_url: data.content?.download_url
      });
      return {
        success: true,
        url: data.content?.html_url || data.content?.download_url,
        path: data.content?.path,
        sha: data.content?.sha,
        name: data.content?.name
      };
    } else {
      const error = await response.text();
      console.error('GitHub API error:', error);
      return {
        success: false,
        error: `GitHub API error: ${response.status}`
      };
    }
  } catch (error) {
    console.error('Error pushing to GitHub:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

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

// Main sync function - USES CUSTOM FILENAME
async function syncHandoffToGitHub(markdownContent, project = 'general', customFilename = null) {
  try {
    // ALWAYS use the provided filename if given
    let filename = customFilename;
    
    // Only generate a filename if none provided
    if (!filename) {
      const now = new Date();
      const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, -5);
      filename = `${project}-handoff-${timestamp}.md`;
    }
    
    console.log('📤 Syncing handoff to GitHub:', {
      finalFilename: filename,
      project: project,
      customFilename: customFilename,
      wasGenerated: !customFilename
    });
    
    // Push to GitHub
    const result = await pushHandoffToGitHub(markdownContent, filename);
    
    if (result.success) {
      // Save sync status
      await chrome.storage.local.set({
        lastGitHubSync: {
          status: 'success',
          timestamp: new Date().toISOString(),
          filename: filename,
          url: result.url
        }
      });
    } else {
      // Save local backup on failure
      await saveLocalBackup(markdownContent, filename);
    }
    
    return result;
  } catch (error) {
    console.error('❌ Sync error:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// Convert JSON to markdown with enhanced metadata
function jsonToMarkdown(json) {
  const title = json.name || 'Untitled';
  const conversationStart = json.metadata.created_at ? new Date(json.metadata.created_at).toISOString() : 'Unknown';
  const handoffGenerated = new Date().toISOString();
  
  let markdown = `# DuoEcho - "${title}" - Full Handoff\n\n`;
  markdown += `**Conversation Start**: ${conversationStart}\n`;
  markdown += `**Handoff Generated**: ${handoffGenerated}\n`;
  markdown += `**Chat Title**: ${title}\n`;
  markdown += `**Model**: ${json.metadata.model}\n`;
  markdown += `**Project**: ${json.metadata.project}\n`;
  markdown += `**Total Messages**: ${json.messages.length}\n\n`;
  markdown += `## Conversation\n\n`;
  
  json.messages.forEach(msg => {
    const role = msg.role === 'user' ? '**Human**' : '**Assistant**';
    const time = new Date(msg.created_at).toLocaleTimeString();
    markdown += `### ${role} (${time})\n\n`;
    markdown += `${msg.text}\n\n`;
    markdown += `---\n\n`;
  });
  
  return markdown;
}

// Generate signal handoff from JSON with enhanced metadata (verbose by default)
function generateSignalFromJson(json, verbose = true) {
  const title = json.name || 'Untitled';
  const conversationStart = json.metadata.created_at ? new Date(json.metadata.created_at).toISOString() : 'Unknown';
  const handoffGenerated = new Date().toISOString();
  
  const lastMessages = json.messages.slice(-10);
  const decisions = [];
  const errors = [];
  
  // Extract key signals with verbose-aware length
  const maxLen = verbose ? 800 : 200; // Much longer excerpts in verbose mode
  
  lastMessages.forEach(msg => {
    const text = msg.text.toLowerCase();
    if (text.includes('error') || text.includes('failed')) {
      errors.push(msg.text.substring(0, maxLen));
    }
    if (text.includes('let\'s') || text.includes('should') || text.includes('will')) {
      decisions.push(msg.text.substring(0, maxLen));
    }
  });
  
  let signal = `# DuoEcho - "${title}" - Signal Handoff\n\n`;
  signal += `**Conversation Start**: ${conversationStart}\n`;
  signal += `**Handoff Generated**: ${handoffGenerated}\n`;
  signal += `**Chat Title**: ${title}\n`;
  signal += `**Messages**: ${json.messages.length}\n\n`;
  
  if (decisions.length > 0) {
    signal += `## Decisions\n`;
    decisions.forEach(d => signal += `- ${d}...\n`);
    signal += `\n`;
  }
  
  if (errors.length > 0) {
    signal += `## Issues\n`;
    errors.forEach(e => signal += `- ${e}...\n`);
    signal += `\n`;
  }
  
  const lastUser = [...json.messages].reverse().find(m => m.role === 'user');
  if (lastUser) {
    const userInputLen = verbose ? 1200 : 500; // More context in verbose mode
    signal += `## Last User Input\n${lastUser.text.substring(0, userInputLen)}\n\n`;
  }
  
  // Add verbose indicator
  if (verbose) {
    signal += `\n---\n*Generated in verbose mode - more context preserved*\n`;
  }
  
  return signal;
}

// Handle Claude JSON from json-sniffer
async function handleClaudeJson(json) {
  try {
    console.log('🎯 Processing conversation:', json.name);
    
    // Generate both versions (signal now verbose by default)
    const fullMarkdown = jsonToMarkdown(json);
    const signalMarkdown = generateSignalFromJson(json);
    
    // Create filenames with chat title and timestamp
    const title = json.name || 'untitled';
    const safeTitle = title.toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')  // Replace non-alphanumeric with hyphens
      .replace(/^-+|-+$/g, '')      // Remove leading/trailing hyphens
      .slice(0, 60);                // Limit length
    
    const timestamp = Date.now();
    const project = 'duoecho';  // Always use duoecho for our captures
    
    const fullFilename = `${project}-full-${safeTitle}-${timestamp}.md`;
    const signalFilename = `${project}-signal-${safeTitle}-${timestamp}.md`;
    
    console.log('📝 Generated files:', { fullFilename, signalFilename });
    
    // Sync both to GitHub
    const results = [];
    
    // Sync full version
    const fullResult = await syncHandoffToGitHub(fullMarkdown, project, fullFilename);
    results.push({ type: 'full', ...fullResult });
    
    // Sync signal version
    const signalResult = await syncHandoffToGitHub(signalMarkdown, project, signalFilename);
    results.push({ type: 'signal', ...signalResult });
    
    // Store JSON locally for future processing
    await chrome.storage.local.set({
      [`conversation_${json.conversation_id}`]: {
        json: json,
        captured_at: new Date().toISOString(),
        synced: results.every(r => r.success)
      }
    });
    
    return {
      success: true,
      message: 'JSON processed and synced',
      files: [
        { name: fullFilename, url: fullResult.url },
        { name: signalFilename, url: signalResult.url }
      ],
      messageCount: json.messages.length
    };
  } catch (error) {
    console.error('❌ Error processing JSON:', error);
    throw error;
  }
}

// Message listener
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Background received message:', request.action || request.type);
  
  // 🔌 Health check ping/pong
  if (request.ping === 'duoecho') {
    console.log('🏓 Responding to ping');
    sendResponse({ pong: true, time: Date.now() });
    return; // Stop processing, we're done
  }
  
  // Relay ready message from content script to popup
  if (request?.type === 'duoEchoConversationReady') {
    console.log('Background: Relaying ready message to all extension views');
    console.log('Message contains:', {
      title: request.title,
      count: request.count,
      conversationId: request.conversationId
    });
    // Fan-out to every open extension view (popup, options, etc.)
    safeRuntimeSendMessage(request);
    sendResponse({ success: true }); // ✅ FIXED: Respond to content script
    return;
  }
  
  // Handle script injection request from content script
  if (request.action === 'injectPageScript' && sender.tab) {
    console.log('Injecting page script into tab:', sender.tab.id);
    
    chrome.scripting.executeScript({
      target: { tabId: sender.tab.id, allFrames: false },
      world: 'MAIN',
      func: () => {
        console.log('[DuoEcho] ✨ Page hooks installing...');
        
        // Check if already installed
        if (window.__duoechoHooksInstalled) {
          console.log('[DuoEcho] Hooks already installed, skipping');
          return;
        }
        window.__duoechoHooksInstalled = true;
        
        const DUOECHO_MSG = 'DUOECHO_CLAUDE_JSON';
        
        function maybeEmit(resp) {
          try {
            const url = resp.url || resp.responseURL || '';
            
            // Log ALL fetch URLs to find the right endpoint
            if (url.includes('/api/')) {
              console.log('[DuoEcho] API call:', url);
            }
            
            // Check for conversation data
            if (url.includes('/chat_conversations/') && url.includes('tree=True')) {
              console.log('[DuoEcho] Found conversation endpoint!');
              
              resp.clone().json().then(json => {
                if (json.chat_messages) {
                  console.log('[DuoEcho] Captured', json.chat_messages.length, 'messages');
                  
                  // Convert to standard format
                  const standardized = {
                    conversation_id: json.uuid,
                    name: json.name || 'Untitled',
                    messages: json.chat_messages.map(msg => ({
                      id: msg.uuid,
                      role: msg.sender === 'human' ? 'user' : 'assistant',
                      text: msg.text || msg.content?.[0]?.text || '',
                      created_at: msg.created_at
                    })),
                    metadata: {
                      model: json.model,
                      project: json.project?.name || 'DuoEcho',
                      created_at: json.created_at,
                      updated_at: json.updated_at,
                      total_messages: json.chat_messages.length
                    }
                  };
                  
                  window.postMessage({ type: DUOECHO_MSG, payload: standardized }, '*');
                  
                  // ALSO expose on window for DevTools inspection
                  window.duoEchoConversation = standardized;
                  console.log('[DuoEcho] Exposed on window.duoEchoConversation');
                }
              }).catch(() => { /* non-json */ });
            }
          } catch (_) { }
        }
        
        // Hook fetch
        const origFetch = window.fetch;
        window.fetch = (...args) => origFetch(...args).then(resp => {
          resp.url = args[0]?.url || args[0]; // Store URL on response
          maybeEmit(resp);
          return resp;
        });
        
        // Hook XHR
        const origOpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function(method, url, ...rest) {
          this._url = url;
          return origOpen.apply(this, [method, url, ...rest]);
        };
        
        const origSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.send = function(...args) {
          this.addEventListener('load', () => {
            this.url = this._url;
            maybeEmit(this);
          });
          return origSend.apply(this, args);
        };
        
        console.log('[DuoEcho] ✅ Page hooks installed successfully');
      }
    }, (result) => {
      if (chrome.runtime.lastError) {
        console.error('Failed to inject:', chrome.runtime.lastError);
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
      } else {
        console.log('Injection result:', result);
        sendResponse({ success: true });
      }
    });
    
    return true; // Will respond asynchronously
  }
  
  // Handle JSON from json-sniffer
  if (request.action === 'claudeJson') {
    handleClaudeJson(request.payload)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Async response
  }
  
  // Handle multiple file sync
  if (request.action === 'syncMultipleToGitHub') {
    console.log('📤 Processing multiple GitHub sync request');
    
    if (!request.files || !Array.isArray(request.files)) {
      sendResponse({
        success: false,
        error: 'No files array provided'
      });
      return true;
    }
    
    // Sync all files sequentially
    (async () => {
      const results = [];
      
      for (const file of request.files) {
        try {
          console.log(`💾 Syncing file:`, {
            filename: file.filename,
            project: file.project,
            contentLength: file.markdown?.length
          });
          
          // USE THE CUSTOM FILENAME!
          const result = await pushHandoffToGitHub(
            file.markdown, 
            file.filename  // Push directly with filename
          );
          
          results.push({ 
            requestedFilename: file.filename,
            actualPath: result.path,
            ...result 
          });
          
          console.log(`🌐 Result for ${file.filename}:`, {
            requestedFilename: file.filename,
            actualUrl: result.url,
            actualPath: result.path
          });
          
          // Add small delay between files to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (error) {
          console.error(`Error syncing ${file.filename}:`, error);
          results.push({ 
            filename: file.filename, 
            success: false, 
            error: error.message 
          });
        }
      }
      
      // Return combined results
      const response = {
        success: results.every(r => r.success),
        results: results,
        message: `Synced ${results.filter(r => r.success).length} of ${results.length} files`,
        urls: results.filter(r => r.success && r.url).map(r => ({ 
          requestedFilename: r.requestedFilename,
          actualFilename: r.path ? r.path.split('/').pop() : r.requestedFilename,
          url: r.url 
        }))
      };
      
      console.log('Multi-sync complete:', response);
      sendResponse(response);
    })();
    
    return true; // Keep channel open for async response
  }
  
  return true;
});

// =====================================
// SIGNAL GENERATION & HANDOFF PROCESSING
// =====================================

// Enhanced Signal Generator with 1200 token limit and full file links
class EnhancedSignalGenerator {
  constructor() {
    this.TOKEN_LIMIT = 1200; // ✨ INCREASED from 800
    this.CHAR_TO_TOKEN_RATIO = 3;
  }

  generate(messages, metadata = {}, verbose = true) {
    const signals = this.extractSignals(messages);
    const type = this.detectType(signals);
    
    // Build structured signal handoff
    let handoff = `# ${metadata.project || 'DuoEcho'} - ${type} Signal\n\n`;
    handoff += `**Generated**: ${new Date().toISOString()}\n`;
    handoff += `**Model**: ${metadata.model || 'unknown'}\n`;
    handoff += `**Messages**: ${messages.length}\n\n`;
    
    // 🎯 STRUCTURED SECTIONS (Option 5)
    handoff += this.buildStructuredContent(signals, type, verbose);
    
    return {
      handoff,
      type,
      signals,
      tokenEstimate: Math.ceil(handoff.length / this.CHAR_TO_TOKEN_RATIO)
    };
  }
  
  buildStructuredContent(signals, type, verbose) {
    let content = '';
    
    // Key Decisions
    const decisions = signals.filter(s => s.type === 'decision').slice(0, 3);
    if (decisions.length > 0) {
      content += `## Key Decisions\n`;
      decisions.forEach(d => {
        content += `- ${verbose ? d.text : d.text.substring(0, 150)}\n`;
      });
      content += '\n';
    }
    
    // Errors & Gotchas
    const errors = signals.filter(s => s.type === 'error').slice(0, 2);
    if (errors.length > 0) {
      content += `## Errors & Gotchas\n`;
      errors.forEach(e => {
        content += `- ${verbose ? e.text : e.text.substring(0, 150)}\n`;
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
    
    // Next Steps
    const nexts = signals.filter(s => s.type === 'next').slice(0, 3);
    if (nexts.length > 0) {
      content += `## Next Steps\n`;
      nexts.forEach(n => {
        content += `- ${verbose ? n.text : n.text.substring(0, 150)}\n`;
      });
      content += '\n';
    }
    
    return content;
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
      return matched.trim().substring(0, 400); // ✨ INCREASED from 300
    }
    
    // Fallback: extract around the match
    const match = text.match(pattern);
    if (match) {
      const start = Math.max(0, match.index - 50);
      const end = Math.min(text.length, match.index + 200); // ✨ INCREASED
      return '...' + text.substring(start, end).trim() + '...';
    }
    return text.substring(0, 400); // ✨ INCREASED
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

// Handle Claude JSON from content script
async function handleClaudeJson(conversationData) {
  try {
    console.log('🎯 Processing Claude conversation:', {
      id: conversationData.conversation_id,
      name: conversationData.name,
      messages: conversationData.messages?.length,
      project: conversationData.metadata?.project
    });
    
    // Generate timestamp
    const timestamp = Date.now();
    const safeTitle = (conversationData.name || 'untitled')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, 40);
    
    const project = conversationData.metadata?.project?.toLowerCase() || 'duoecho';
    
    // Create both handoffs
    const fullHandoff = generateFullHandoff(conversationData);
    const signalGenerator = new EnhancedSignalGenerator();
    const signalResult = signalGenerator.generate(
      conversationData.messages, 
      conversationData.metadata,
      true // verbose = true
    );
    
    // Generate filenames
    const fullFilename = `${project}-full-${safeTitle}-${timestamp}.md`;
    const signalFilename = `${project}-signal-${safeTitle}-${timestamp}.md`;
    
    // 🥇 ADD FULL FILE LINK TO SIGNAL (Option 3 - ESSENTIAL)
    const signalWithLink = signalResult.handoff + 
      `\n\n---\n🔗 **Full details**: https://github.com/sibrody/duoecho/blob/main/handoffs/${fullFilename}`;
    
    // Push both files to GitHub
    const results = [];
    
    // Push full handoff
    const fullResult = await pushHandoffToGitHub(fullHandoff, fullFilename);
    results.push({ type: 'full', filename: fullFilename, ...fullResult });
    
    // Push signal handoff with link
    const signalResult2 = await pushHandoffToGitHub(signalWithLink, signalFilename);
    results.push({ type: 'signal', filename: signalFilename, ...signalResult2 });
    
    console.log('✅ Both handoffs created:', {
      full: fullFilename,
      signal: signalFilename,
      signalTokens: signalResult.tokenEstimate
    });
    
    return {
      success: true,
      results,
      files: {
        full: fullFilename,
        signal: signalFilename
      },
      tokenEstimate: signalResult.tokenEstimate
    };
    
  } catch (error) {
    console.error('❌ Error processing Claude JSON:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

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

// SW lifecycle logging - helps when chasing cold start
chrome.runtime.onInstalled.addListener((details) => {
  console.log('[SW] onInstalled:', details.reason);
});

chrome.runtime.onStartup.addListener(() => {
  console.log('[SW] onStartup: Browser restart');
});

chrome.runtime.onSuspend.addListener(() => {
  console.log('[SW] onSuspend: About to unload');
});

console.log('[SW] ✅ Background service ready');
