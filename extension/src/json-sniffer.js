// DuoEcho Content Script - Simple bridge between page and extension
// Requests background to inject page script, then listens for messages

(() => {
  const DUOECHO_MSG = 'DUOECHO_CLAUDE_JSON';
  let latestConversation = null;
  let lastConversationId = null;         // simplest possible duplicate check
  let lastConversationHash = null;       // (MD5/SHA-1 helper you already had)
  
  // DIAGNOSTIC: Verify content script injection
  console.log('[CS] DuoEcho json-sniffer.js loaded @', window.location.href);
  
  // DIAGNOSTIC: Test CS → SW message immediately
  chrome.runtime.sendMessage({ type: 'duoEchoPing' }, resp => {
    console.log('[CS] ping resp:', resp, chrome.runtime.lastError);
  });
  
  console.log('[CS] DuoEcho content script starting...');
  
  // Warm-up ping to ensure SW is ready before injection
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
  
  // Helper to create a simple hash of conversation for comparison
  function createConversationHash(conv) {
    if (!conv) return null;
    // Hash based on conversation ID, message count and last message
    const lastMsg = conv.messages?.[conv.messages.length - 1];
    return `${conv.conversation_id}-${conv.messages?.length}-${lastMsg?.id}`;
  }
  
  // Step 1: Warm up SW then inject the page script
  (async () => {
    const ok = await swReady();
    if (!ok) {
      console.warn('[CS] SW not ready after retries; postponing inject');
      return;
    }
    chrome.runtime.sendMessage({ action: 'injectPageScript' }, r => {
      console.log('[CS] inject result:', r, chrome.runtime.lastError);
    });
  })();
  
  // Step 2: Listen for captured data from page context
  window.addEventListener('message', (event) => {
    // Validate message
    if (event.source !== window || !event.data || event.data.type !== DUOECHO_MSG) {
      return;
    }
    
    console.log('[DuoEcho] Content script received conversation with', 
                event.data.payload?.messages?.length, 'messages');
    
    // Buffer the conversation
    latestConversation = event.data.payload;
    
    // Tell the extension (including the popup) we have fresh data
    console.log('[DuoEcho] Sending ready message to background...');
    chrome.runtime.sendMessage({
      type: 'duoEchoConversationReady',
      count: event.data.payload.messages?.length || 0,
      title: event.data.payload.name || 'Untitled',
      conversationId: event.data.payload.conversation_id
    }, () => {
      if (chrome.runtime.lastError) {
        console.error('[DuoEcho] Failed to send to background:', chrome.runtime.lastError);
      } else {
        console.log('[DuoEcho] ✅ Ready message sent to background successfully!');
      }
    });
  });
  
  // Step 3: Handle requests from popup AND token progress
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('[CS] Content script received:', request.action || request.type);
    
    // Handle token progress for HUD
    if (request?.type === 'duoechoTokenProgress' && typeof request.pct === 'number') {
      try {
        // Forward to HUD if it exists
        if (window.duoechoUpdateBadge) {
          window.duoechoUpdateBadge(Math.min(100, Math.max(0, request.pct)));
        }
      } catch (err) {
        console.debug('[CS] HUD update error (harmless):', err);
      }
      return; // Don't call sendResponse for progress events
    }
    
    // Handle ping
    if (request.action === 'ping') {
      sendResponse({ success: true, hasData: !!latestConversation });
      return;
    }
    
    // Handle manual capture - check for duplicates but allow force override
    if (request.action === 'manualCapture') {
      if (!latestConversation) {
        console.log('[DuoEcho] No conversation buffered yet');
        sendResponse({ ok: false, err: 'No conversation captured yet. Navigate to a conversation first.' });
        return;
      }
      
      const id = latestConversation.conversation_id;
      const hash = createConversationHash(latestConversation);
      const isDuplicate = (id === lastConversationId && hash === lastConversationHash);
      
      // Check for duplicate unless force flag is set
      if (!request.force && isDuplicate) {
        console.info('[DuoEcho] Duplicate capture detected');
        sendResponse({ ok: false, skipped: true, reason: 'duplicate' });
        return;
      }
      
      // Update tracking (capture proceeding)
      lastConversationId = id;
      lastConversationHash = hash;
      
      console.log('[DuoEcho] Sending buffered conversation to background...', request.force ? '(FORCED)' : '');
      
      // Send to background
      chrome.runtime.sendMessage(
        { 
          action: 'claudeJson', 
          payload: latestConversation
        },
        (response) => {
          if (chrome.runtime.lastError) {
            console.error('[DuoEcho] Error sending to background:', chrome.runtime.lastError);
            sendResponse({ ok: false, err: 'Failed to send to background' });
          } else {
            console.log('[DuoEcho] Background responded:', response);
            sendResponse({ ok: true });
          }
        }
      );
      
      return true; // Keep port open for async reply
    }
    
    // Handle capture reset
    if (request.action === 'resetCapture') {
      console.log('[DuoEcho] Resetting capture state');
      lastConversationId = null;
      lastConversationHash = null;
      sendResponse({ reset: true });
      return;
    }
  });
  
  console.log('[CS] DuoEcho content script ready');
})();

// ---- DuoEcho HUD (token progress badge) ------------------------------
(() => {
  const LIMIT = 1200; // keep in sync with SIGNAL_TOKEN_LIMIT
  let el;

  function ensureBadge() {
    if (el) return el;
    el = document.createElement('div');
    el.id = 'duoecho-hud';
    el.style.cssText = `
      position: fixed; top: 10px; right: 10px; z-index: 2147483647;
      font: 12px/1.2 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
      background: rgba(0,0,0,.75); color:#fff; padding:6px 8px; border-radius:8px;
      box-shadow: 0 2px 8px rgba(0,0,0,.3); pointer-events:none;
    `;
    el.textContent = 'DuoEcho: 0% • 1200 left';
    document.documentElement.appendChild(el);
    return el;
  }

  function updateBadge(pct) {
    ensureBadge();
    const left = Math.max(0, LIMIT - Math.round((pct/100)*LIMIT));
    el.textContent = `DuoEcho: ${pct}% • ${left} left`;
    el.style.background = pct >= 80 ? 'rgba(180,60,0,.9)' : 'rgba(0,0,0,.75)';
  }

  // Expose update function globally for the main message listener
  window.duoechoUpdateBadge = updateBadge;

  // optional: hide after a while
  // setTimeout(() => el && el.remove(), 60000);
})();
