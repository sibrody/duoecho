# 1) Fix the “Receiving end does not exist” (MV3 race)

This is your content script pinging before the SW is listening. Add a **retrying handshake** before any real messages.

### In `src/json-sniffer.js` (top of file)

```js
// ---- SW handshake with retries (MV3 cold-start guard)
async function duoechoEnsureSWReady(retries = 10) {
  const delay = (ms) => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < retries; i++) {
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'duoEchoPing' });
      if (resp && resp.pong) return true;
    } catch (e) {
      // ignore and retry
    }
    await delay(200 + i * 150); // small backoff
  }
  console.warn('[DuoEcho CS] SW not ready after retries');
  return false;
}

// Call this once the page is actually ready:
(async () => {
  if (document.readyState === 'loading') {
    await new Promise(r => document.addEventListener('DOMContentLoaded', r, { once: true }));
  }
  await duoechoEnsureSWReady();
  // ... now do your normal startup / inject request / capture logic
})();
```

### In `src/background-integrated.js` (very top)

Make sure your listener is **registered immediately** (you already have this, but double-check):

```js
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'duoEchoPing') {
    sendResponse({ pong: true, time: Date.now() });
    return true;
  }
  // ...rest of your handler
});
```

### Optional (even smoother): relax how early your CS runs

Right now your manifest uses `run_at: "document_start"`. For Claude’s heavy SPA, that’s often too early. Either:

* change to `document_idle`, **or**
* keep `document_start` but don’t **send any messages** until after the handshake above completes.

---

## Why this fixes it

In MV3, the service worker sleeps. First message *usually* wakes it, but not always in time for your very first send. The retry handshake + waiting for DOM readiness removes that race without any offscreen hacks or keep-alive nonsense.

Yep—that’s the right console. Those lines mean your **service worker is alive and logging**. 🎉

Now, to kill the cold-start “Receiving end does not exist” once and for all, add a tiny **warm-up ping** before anything tries to talk to the SW.

# Minimal fixes (surgical)

## 2) Warm up the SW in `popup.js`

At the top (or on DOMContentLoaded), add:

```js
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

document.addEventListener('DOMContentLoaded', async () => {
  const ok = await swReady();
  console.log('[DuoEcho POPUP] SW ready?', ok);
  // only enable “Capture” UI once ok === true
});
```

## 2) Warm up before inject in `json-sniffer.js`

Right before you call `chrome.runtime.sendMessage({ action: 'injectPageScript', ... })`, add the same readiness check:

```js
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

(async () => {
  const ok = await swReady();
  if (!ok) {
    console.warn('[DuoEcho CS] SW not ready after retries; postponing inject');
    return;
  }
  chrome.runtime.sendMessage({ action: 'injectPageScript' }, r => {
    console.log('[DuoEcho CS] inject result:', r, chrome.runtime.lastError);
  });
})();
```

That’s it. This prevents the first message from hitting a sleeping worker.

