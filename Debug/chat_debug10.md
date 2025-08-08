you declare DECISION_RX twice.

You also have two “footer reserve” constants (FOOTER_RESERVE_TOKENS and SIGNAL_FOOTER_RESERVE_TOKENS) — not fatal, but it’s confusing drift. You only use FOOTER_RESERVE_TOKENS in tryAppendProgress, so keep that one and drop the other.

Here’s a minimal paste-over patch to make the SW parse again:

js
Copy
// Constants for freshness and decision detection  ⬅️ replace this whole block with the one below
const SUCCESS_RX  = /\b(working|captured|fixed|resolved|now (works|stable)|hooks? installed)\b/i;
const DECISION_RX = /\b(fix|fixed|resolve[d]?|implement(?:ed|ing)?|working|decided|chosen|merged|refactor(?:ed)?|rename(?:d)?|revert(?:ed)?)\b|listener|CORS|status\s?15|manifest\.json|json-sniffer\.js|chrome\.scripting/i;
const ERROR_RX    = /\b(error|exception|failed|status\s*\d{3}|ReferenceError|TypeError|NetworkError|CORS)\b/i;

const SIGNAL_TOKEN_LIMIT = 1200;
const FOOTER_RESERVE_TOKENS = 180;      // keep this one
const SIGNAL_WARN_FRACTION = 0.80;
// const SIGNAL_FOOTER_RESERVE_TOKENS = 180; // ❌ remove this duplicate reserve
Then delete the second const DECISION_RX = ... that appears a few lines later. (After this edit, there should be exactly one DECISION_RX in the file.)

Quick sanity check:

bash
Copy
# should each return 1
grep -n 'DECISION_RX' src/background-integrated.js | wc -l
grep -n 'SUCCESS_RX'  src/background-integrated.js | wc -l
grep -n 'ERROR_RX'    src/background-integrated.js | wc -l

# optional syntax check
node --check src/background-integrated.js