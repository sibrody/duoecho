/* DuoEcho Popup Guardrails — single-init */
(() => {
  if (window.__DUOECHO_POPUP_INIT__) {
    console.debug('[DuoEcho][POP] duplicate init');
    return;
  }
  window.__DUOECHO_POPUP_INIT__ = true;
})();

// DuoEcho Popup Script - JSON Capture Version
console.log('[POP] DuoEcho popup ready');

// Warm-up ping to ensure SW is ready before any operations
async function swReady(retries = 8) {
  for (let i = 0; i < retries; i++) {
    const ok = await new Promise(res => {
      try {
        chrome.runtime.sendMessage({ type: 'duoEchoPing' }, r => res(!!(r && r.pong)));
      } catch { res(false); }
    });
    if (ok) return true;
    await new Promise(r => setTimeout(r, 200 + i * 100));
  }
  return false;
}

// === Progress Event Queue & Safe Handler ===
let __duoDomReady = false;
const __duoProgressQueue = [];

/** Safely update progress UI elements; logs if elements are missing. */
function handleProgressUpdate(msg) {
  try {
    const row = document.getElementById('progressRow');
    const bar = document.getElementById('progressBar');
    const note = document.getElementById('progressNote');

    if (!row || !bar || !note) {
      console.warn('[DuoEcho] Progress elements not found yet', { hasRow: !!row, hasBar: !!bar, hasNote: !!note });
      return;
    }

    row.style.display = 'block';
    const pct = Math.max(0, Math.min(100, Number(msg.pct || 0)));
    bar.style.width = pct + '%';
    note.textContent = msg.warn ? 'Approaching token limit…' : '';
    console.log('[DuoEcho] Progress updated:', pct + '%');

    if (pct >= 100) {
      setTimeout(() => { row.style.display = 'none'; }, 1200);
    }
  } catch (e) {
    console.error('[DuoEcho] Progress update error:', e);
  }
}

// Replace previous direct handler with a queuing listener
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'duoechoTokenProgress') {
    if (!__duoDomReady) {
      __duoProgressQueue.push(msg);
      console.log('[DuoEcho] Queued progress before DOM ready:', msg.pct);
      return;
    }
    handleProgressUpdate(msg);
  }
});



// DUOECHO: (replaced by safe queuing handler)
// Wait for DOM to be ready
document.addEventListener('DOMContentLoaded', async () => {
  __duoDomReady = true;
  try {
    if (__duoProgressQueue.length) {
      console.log('[DuoEcho] Flushing queued progress events:', __duoProgressQueue.length);
      while (__duoProgressQueue.length) handleProgressUpdate(__duoProgressQueue.shift());
    }
  } catch (e) { console.warn('[DuoEcho] Flush error:', e); }

  console.log('[DuoEcho] DOM loaded, initializing popup');
  
  // Get all our elements
  const captureBtn = document.getElementById('captureBtn');
  const resetBtn = document.getElementById('resetBtn');
  const syncBtn = document.getElementById('syncBtn');
  const settingsBtn = document.getElementById('settingsBtn');
  const statusEl = document.getElementById('status');
  const infoEl = document.getElementById('info');
  const githubStatusEl = document.getElementById('githubStatus');
  
  // Track capture state globally
  let hasCaptured = false;       // module-local, not global
  let pendingMsgCount = 0;       // remember last ready count
  let debounceTimer = null;
  
  // Check current tab
  const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
  console.log('[DuoEcho] Current tab:', tab.url);
  
  // Handle Claude.ai pages
  if (tab.url && tab.url.includes('claude.ai')) {
    console.log('[DuoEcho] On Claude.ai - showing capture button');
    
    // Update status
    statusEl.innerHTML = `
      <div style="color: #10a37f; font-weight: bold;">
        ✅ Claude.ai Detected
      </div>
      <div style="font-size: 12px; color: #666; margin-top: 8px;">
        Navigate to a conversation, then click Capture Now.
      </div>
    `;
    
    // Show capture button immediately when on Claude
    captureBtn.style.display = 'block';
    resetBtn.style.display = 'block'; // Show reset button too
    captureBtn.disabled = false;
    captureBtn.title = 'Click to capture current conversation';
    captureBtn.textContent = '📸 Capture Now';
    
    // Store tab for later use
    window.currentTab = tab;
    
    // Wire capture button click
    captureBtn.addEventListener('click', async () => {
      // Reset progress bar
      const progressRow = document.getElementById('progressRow');
      const progressBar = document.getElementById('progressBar');
      const progressNote = document.getElementById('progressNote');
      if (progressRow) progressRow.style.display = 'block';
      if (progressBar) progressBar.style.width = '0%';
      if (progressNote) progressNote.textContent = '';
      
      // Debounce to prevent spam clicking
      if (debounceTimer) {
        console.log('[DuoEcho] Debounced click ignored');
        return;
      }
      
      console.log('[DuoEcho] Capture button clicked');
      
      captureBtn.disabled = true;
      captureBtn.textContent = '⏳ Capturing…';
      
      // Check if this is a force capture
      const force = captureBtn.dataset.force === 'true';
      
      // Send message to content script
      chrome.tabs.sendMessage(tab.id, {
        action: 'manualCapture',
        force: force
      }, (resp) => {
        if (chrome.runtime.lastError) {
          console.error('[DuoEcho] Chrome error:', chrome.runtime.lastError.message);
          captureBtn.textContent = '❌ Failed';
          
          // Show error details
          infoEl.innerHTML = `
            <div style="padding: 8px; background: #fee; border-radius: 6px; color: #c00; font-size: 12px;">
              ${chrome.runtime.lastError.message}
            </div>
          `;
        } else {
          console.log('[DuoEcho] Reply from tab:', resp);
          
          if (resp?.ok) {
            hasCaptured = true;
            captureBtn.textContent = '✅ Captured!';
            delete captureBtn.dataset.force; // Reset force flag
            infoEl.innerHTML = `
              <div style="padding: 8px; background: #d4f4dd; border-radius: 6px; color: #166534; font-size: 12px;">
                Conversation captured and sent to GitHub
              </div>
            `;
          } else if (resp?.skipped && resp?.reason === 'duplicate') {
            // Offer force recapture option
            captureBtn.textContent = '🔄 Force Recapture';
            captureBtn.dataset.force = 'true';
            captureBtn.title = 'This conversation was already captured. Click to force recapture.';
            infoEl.innerHTML = `
              <div style="padding: 8px; background: #fff3cd; border-radius: 6px; color: #856404; font-size: 12px;">
                Already captured. Click "Force Recapture" to capture again.
              </div>
            `;
          } else {
            captureBtn.textContent = '❌ Failed';
            infoEl.innerHTML = `
              <div style="padding: 8px; background: #fee; border-radius: 6px; color: #c00; font-size: 12px;">
                ${resp?.err || 'Unknown error'}
              </div>
            `;
          }
        }
        
        // Reset button after delay with proper state
        debounceTimer = setTimeout(() => {
          captureBtn.disabled = false;
          if (!resp?.skipped) {
            captureBtn.textContent = hasCaptured ? '🔄 Capture Again' : '📸 Capture Now';
            captureBtn.title = hasCaptured ? 'Click to capture this conversation again' : 'Click to capture current conversation';
          }
          debounceTimer = null;
        }, 1500);
      });
    });
    
    // Wire reset button click
    resetBtn.addEventListener('click', async () => {
      console.log('[DuoEcho] Reset button clicked');
      
      // Send reset message to content script
      chrome.tabs.sendMessage(tab.id, {
        action: 'resetCapture'
      }, (resp) => {
        if (chrome.runtime.lastError) {
          console.error('[DuoEcho] Reset error:', chrome.runtime.lastError.message);
        } else {
          console.log('[DuoEcho] Reset response:', resp);
          
          // Reset UI state
          hasCaptured = false;
          captureBtn.textContent = '📸 Capture Now';
          captureBtn.title = 'Click to capture current conversation';
          delete captureBtn.dataset.force;
          
          // Show reset confirmation
          infoEl.innerHTML = `
            <div style="padding: 8px; background: #e5e7eb; border-radius: 6px; color: #374151; font-size: 12px;">
              ✅ Capture state reset
            </div>
          `;
          
          // Clear info after delay
          setTimeout(() => {
            infoEl.innerHTML = '';
          }, 2000);
        }
      });
    });
    
    // Check for recent captures
    loadRecentCaptures();
    
  } else if (tab.url && (tab.url.includes('chat.openai.com') || tab.url.includes('lovable.dev'))) {
    // Other AI platforms
    statusEl.innerHTML = `
      <div style="color: #f59e0b;">
        ⚠️ ${tab.url.includes('chat.openai.com') ? 'ChatGPT' : 'Lovable'} Detected
      </div>
      <div style="font-size: 12px; color: #666; margin-top: 8px;">
        JSON capture coming soon for this platform.
      </div>
    `;
  } else {
    // Not on supported platform
    statusEl.innerHTML = `
      <div style="color: #999;">
        💤 Not on a supported AI platform
      </div>
      <div style="font-size: 12px; color: #666; margin-top: 8px;">
        Navigate to Claude.ai to start capturing.
      </div>
    `;
  }
  
  // Wire settings button (always visible)
  if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
      console.log('[DuoEcho] Opening settings');
      chrome.runtime.openOptionsPage();
    });
  }
  
  // Load GitHub status
  loadGitHubStatus();
});

// Helper function to load recent captures
async function loadRecentCaptures() {
  chrome.storage.local.get(null, (items) => {
    const conversations = Object.keys(items)
      .filter(key => key.startsWith('conversation_'))
      .map(key => items[key]);
    
    if (conversations.length > 0) {
      const latest = conversations.sort((a, b) => 
        new Date(b.captured_at) - new Date(a.captured_at)
      )[0];
      
      const messageCount = latest.json?.messages?.length || 0;
      const project = latest.json?.metadata?.project || 'Unknown';
      
      const infoEl = document.getElementById('info');
      if (infoEl) {
        infoEl.innerHTML = `
          <div style="padding: 12px; background: #f5f5f5; border-radius: 8px;">
            <div style="font-weight: bold; margin-bottom: 4px;">📊 Latest Capture</div>
            <div style="font-size: 13px; color: #666;">
              Project: ${project}<br>
              Messages: ${messageCount}<br>
              Synced: ${latest.synced ? '✅ Yes' : '⏳ Pending'}
            </div>
          </div>
        `;
      }
    }
  });
}

// Helper function to load GitHub status
async function loadGitHubStatus() {
  chrome.storage.local.get(['githubToken', 'lastGitHubSync'], (result) => {
    const githubStatusEl = document.getElementById('githubStatus');
    if (!githubStatusEl) return;
    
    if (result.githubToken) {
      githubStatusEl.innerHTML = `
        <div style="color: #10a37f; font-size: 12px;">
          🔗 GitHub Connected
          ${result.lastGitHubSync ? `<br>Last sync: ${new Date(result.lastGitHubSync.timestamp).toLocaleTimeString()}` : ''}
        </div>
      `;
    } else {
      githubStatusEl.innerHTML = `
        <div style="color: #f59e0b; font-size: 12px;">
          ⚠️ GitHub not configured
          <br><a href="#" id="configureGitHub" style="color: #3b82f6;">Configure →</a>
        </div>
      `;
      
      // Wire configure link
      setTimeout(() => {
        const configLink = document.getElementById('configureGitHub');
        if (configLink) {
          configLink.addEventListener('click', (e) => {
            e.preventDefault();
            chrome.runtime.openOptionsPage();
          });
        }
      }, 100);
    }
  });
}

// Listen for updates from background and content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('[DuoEcho] Popup received message:', request);
  
  // Handle ready notification from content script - reset capture state for new conversation
  if (request.type === 'duoEchoConversationReady') {
    const captureBtn = document.getElementById('captureBtn');
    
    // Reset capture state when new conversation detected
    if (window.currentConversationId !== request.conversationId) {
      console.log('[DuoEcho] New conversation detected, resetting capture state');
      hasCaptured = false;       // reset on new convo
      window.currentConversationId = request.conversationId;
    }
    
    if (captureBtn && !captureBtn.disabled) {  // Only update if not already processing
      // Update button text with conversation info
      const title = request.title || 'Untitled';
      const shortTitle = title.length > 25 ? title.slice(0, 22) + '...' : title;
      
      pendingMsgCount = request.count;
      captureBtn.textContent = `📸 "${shortTitle}" (${pendingMsgCount} msgs)`;
      captureBtn.title = `Capture: ${title}\n${request.count} messages\nConversation ID: ${request.conversationId || 'unknown'}`;
      
      console.log('[DuoEcho] Updated button with conversation info');
    }
  }
  
  // Handle capture complete notification
  if (request.action === 'captureComplete') {
    const infoEl = document.getElementById('info');
    if (infoEl) {
      infoEl.innerHTML = `
        <div style="padding: 12px; background: #d4f4dd; border-radius: 8px; color: #166534;">
          ✅ Captured: ${request.messageCount} messages
          <br>📁 Files: ${request.files?.map(f => f.name).join(', ')}
        </div>
      `;
    }
  }

});

// Initialize popup when DOM is ready
document.addEventListener('DOMContentLoaded', async () => {
  const ok = await swReady();
  console.log('[POP] SW ready?', ok);
  // Only enable "Capture" UI once ok === true
  const captureBtn = document.getElementById('captureBtn');
  if (captureBtn && !ok) {
    captureBtn.disabled = true;
    captureBtn.textContent = '⏳ Starting...';
    captureBtn.title = 'Waiting for service worker to be ready';
  } else if (captureBtn && ok) {
    // SW is ready, enable capture UI
    captureBtn.disabled = false;
  }
});
