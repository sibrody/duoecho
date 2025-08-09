Totally. Drop these tiny “seatbelts” at the **top** of each file so we don’t relive the duplicate-loads / drift / cold-start goat rodeo.

# A) Background (service worker) — put at **very top** of `src/background-integrated.js`

```js
/* DuoEcho SW Guardrails — v1.1.x
   - Single-load guard
   - Version pin + drift warning
   - Strict patch surface for Claude (only edit inside PATCHABLE blocks)
*/
'use strict';
(() => {
  const G = globalThis; // service worker global (no window)

  // prevent duplicate loads
  if (G.__DUOECHO_SW_LOADED__) {
    console.warn('[DuoEcho][SW] duplicate load, ignoring');
    return; // bail out early
  }
  G.__DUOECHO_SW_LOADED__ = true;

  // pin current SW version (adjust when you intentionally rev)
  const VERSION = '1.1.0';
  if (G.__DUOECHO_SW_VERSION__ && G.__DUOECHO_SW_VERSION__ !== VERSION) {
    console.warn('[DuoEcho][SW] version drift:', G.__DUOECHO_SW_VERSION__, '->', VERSION);
  }
  G.__DUOECHO_SW_VERSION__ = VERSION;

  // editable regions only (Claude: DO NOT touch outside PATCHABLE blocks)
  G.__DUOECHO_PATCHABLE__ = Object.freeze({
    // allow edits to these named functions / blocks only:
    allow: [
      'generateSignalFromJson',   // signal builder
      'tryAppendProgress',        // token progress
      'gh*',                      // GitHub helpers
      'badge*'                    // badge helpers
    ]
  });

  // tiny assert helper you can sprinkle where needed
  G.__DE_ASSERT = (name, cond) => { if (!cond) console.warn('[DuoEcho][ASSERT]', name); };
})();
```

# B) Content script — put at **very top** of `src/json-sniffer.js`

```js
/* DuoEcho CS Guardrails — single-init + domain fence */
(() => {
  if (window.__DUOECHO_CS_LOADED__) {
    console.debug('[DuoEcho][CS] duplicate load, ignoring');
    return;
  }
  window.__DUOECHO_CS_LOADED__ = true;

  // only run on the sites we expect (belt & suspenders vs manifest)
  const ok = /^https:\/\/(claude\.ai|chat\.openai\.com)\//.test(location.href);
  if (!ok) {
    console.debug('[DuoEcho][CS] domain fence blocked init:', location.href);
    return;
  }
})();
```

# C) Injected page script — put at **very top** of `src/sniffer-injected.js`

```js
/* DuoEcho Injected Hooks — single-install */
(() => {
  if (window.__duoechoHooksInstalled) {
    console.debug('[DuoEcho][INJ] hooks already installed');
    return;
  }
  window.__duoechoHooksInstalled = true;
})();
```

# D) Popup — put at **very top** of `popup.js`

```js
/* DuoEcho Popup Guardrails — single-init */
(() => {
  if (window.__DUOECHO_POPUP_INIT__) {
    console.debug('[DuoEcho][POP] duplicate init');
    return;
  }
  window.__DUOECHO_POPUP_INIT__ = true;
})();
```

# E) Optional: “Do not edit” sentinels (make Claude behave)

Sprinkle these comment markers around the parts you *allow* to be edited. Everything else is read-only.

```js
// ==== PATCHABLE: generateSignalFromJson (BEGIN) ====
// ...the function body Claude may touch...
// ==== PATCHABLE: generateSignalFromJson (END) ====
```

# F) Quick verify (takes 60 seconds)

* Reload the extension → open **SW console**: you should see **only one** line like `DuoEcho SW v1.1.0...`. Reload again: no duplicate init messages.
* Open Claude tab → **content script** console shows one “loaded” line, not two.
* Trigger capture twice → no “Receiving end…” flareups due to double listeners.

These guards don’t change behavior; they just stop duplicate execution, warn on version drift, and fence off what Claude is allowed to edit. If you want, I can also give you a tiny preflight that warns if any of the **forbidden** top-level constants (e.g., `DECISION_RX`) were redeclared—but the above will already prevent most of that pain.
