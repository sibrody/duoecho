(() => {
  try {
    console.log('[PAGE] DuoEcho ✨ Page hooks installing...');
    if (window.__duoechoHooksInstalled) {
      console.log('[PAGE] Hooks already installed, skipping');
      return;
    }
    window.__duoechoHooksInstalled = true;

    const DUOECHO_MSG = 'DUOECHO_CLAUDE_JSON';

    function postConversation(json) {
      if (!json || !json.chat_messages) return;
      const standardized = {
        conversation_id: json.uuid,
        name: json.name || 'Untitled',
        messages: (json.chat_messages || []).map(msg => ({
          id: msg.uuid,
          role: msg.sender === 'human' ? 'user' : 'assistant',
          text: msg.text || (msg.content && msg.content[0] && msg.content[0].text) || '',
          created_at: msg.created_at
        })),
        metadata: {
          model: json.model,
          project: (json.project && json.project.name) || 'DuoEcho',
          created_at: json.created_at,
          updated_at: json.updated_at,
          total_messages: (json.chat_messages || []).length,
          generated_at: Date.now()
        }
      };
      window.postMessage({ type: DUOECHO_MSG, payload: standardized }, '*');
      window.duoEchoConversation = standardized;
      console.log('[DuoEcho] Exposed on window.duoEchoConversation');
    }

    // Hook fetch
    const _fetch = window.fetch;
    window.fetch = async function(...args) {
      const res = await _fetch.apply(this, args);
      try {
        const url = res.url || (args[0] && args[0].toString()) || '';
        if (url.includes('/api/')) console.log('[DuoEcho] API call:', url);
        if (url.includes('/chat_conversations/') && url.includes('tree=True')) {
          const j = await res.clone().json();
          console.log('[DuoEcho] Found conversation endpoint!');
          console.log('[DuoEcho] Captured', (j.chat_messages || []).length, 'messages');
          postConversation(j);
        }
      } catch (e) {}
      return res;
    };

    // Hook XHR (defensive)
    const _open = XMLHttpRequest.prototype.open;
    const _send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function(method, url, ...rest) {
      this.__duoUrl = url;
      return _open.call(this, method, url, ...rest);
    };
    XMLHttpRequest.prototype.send = function(body) {
      this.addEventListener('load', function() {
        try {
          const url = this.__duoUrl || this.responseURL || '';
          if (url.includes('/chat_conversations/') && url.includes('tree=True')) {
            const j = JSON.parse(this.responseText);
            console.log('[DuoEcho] Captured', (j.chat_messages || []).length, 'messages');
            postConversation(j);
          }
        } catch (e) {}
      });
      return _send.call(this, body);
    };

    console.log('[DuoEcho] ✅ Page hooks installed successfully');
  } catch (e) {
    console.error('[DuoEcho] Hook install error', e);
  }
})();