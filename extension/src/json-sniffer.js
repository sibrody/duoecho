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
  
  // Helper to create a simple hash of conversation for comparison
  function createConversationHash(conv) {
    if (!conv) return null;
    // Hash based on conversation ID, message count and last message
    const lastMsg = conv.messages?.[conv.messages.length - 1];
    return `${conv.conversation_id}-${conv.messages?.length}-${lastMsg?.id}`;
  }
  
  // Step 1: Request background to inject the page script
  chrome.runtime.sendMessage({ action: 'injectPageScript' }, (response) => {
    if (chrome.runtime.lastError) {
      console.error('[DuoEcho] Failed to request injection:', chrome.runtime.lastError);
    } else if (response && (response.success || response.ok)) {
      console.log('[DuoEcho] Page script injection requested successfully');
    } else {
      console.error('[DuoEcho] Injection failed:', response?.error);
    }
  });
  
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
  
  // Step 3: Handle requests from popup
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('[DuoEcho] Content script received:', request.action);
    
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
  
  console.log('[DuoEcho] Content script ready');
})();
