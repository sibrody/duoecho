# DuoEcho Evidence-Backed Review (A–I)

## A) Executive Assessment

DuoEcho’s approach—modeling decision policies (not just memory), routing them through a small policy layer, and keeping an event-sourced SOP—appears feasible on today’s stack. Focus V1 on capture→tag→policy knobs (verbosity/evidence/decide-one) with local inference; defer on-device training. Top risks: capture brittleness, noisy inference, privacy drift. Most important next experiment: a policy-sensitivity demo that measurably reduces edit loops and time-to-accept on one live project.

Key evidence:
- duoecho-extension-weekend.md • **🎯 The Vision** — Build a browser extension that captures your AI conversations, auto-detects decisions, and builds the foundation for duoecho.ai - all while you work on SolOS.
- duoecho-extension-weekend.md • **Friday Evening (2-3 hours)** — **Goal: Get basic capture working** 1. **Setup** (30 min) ```bash mkdir duoecho-extension cd duoecho-extension mkdir src icons ``` 2. **Create manifest.json** (10 min) ```json {…
- duoecho_status_report.md • **DuoEcho Chrome Extension - Design & Status Report** — **Last Updated:** August 1, 2025 **Location:** `~/Dev/SolOS/duoecho-extension/` **Current Status:** 🔴 Debug Mode - Runtime Connection Issues ---
- duoecho_status_report.md • **🎯 **Design Concept**** — DuoEcho is a Chrome extension designed to capture AI conversations and automatically extract decisions for the SolOS project workflow.
- duoecho_design_complete.md • **DuoEcho Extension - Complete Design Intent & Decision Architecture** — **Last Updated:** August 1, 2025 **Status:** 🟡 Active Development - Decision Spectrum Implementation **Location:** `~/Dev/SolOS/duoecho-extension/` ---
- duoecho_design_complete.md • ****Primary Vision:**** — DuoEcho captures the **spectrum of decision-making** in AI conversations, not just explicit declarations. The goal is to understand how decisions emerge through dialogue, building…

Citations: [DUOECHO_EXTENSION_WEEKEND-SEC002, DUOECHO_EXTENSION_WEEKEND-SEC004, DUOECHO_STATUS_REPORT-SEC001, DUOECHO_STATUS_REPORT-SEC002, DUOECHO_DESIGN_COMPLETE-SEC001, DUOECHO_DESIGN_COMPLETE-SEC003]

## B) Technical Feasibility

Represent behavior as a compact, interpretable vector (16–24D) and inject it via soft prompts and a light policy module that toggles retrieval, citations, and choose-one vs. options. Use on-device inference; reserve PEFT adapters for later and ship as deltas. Start rule-first tagging; promote to a tiny classifier; log propensities for a contextual bandit to adapt online.

Key evidence:
- duoecho-extension-weekend.md • **Sunday Morning (3-4 hours)** — **Goal: The "Magic" Features** 1. **Pattern Learning** (2 hours) - Track YOUR specific patterns: - How you make decisions - Your terminology - Problem-solving sequences - Build a…
- duoecho-extension-weekend.md • **🛠️ Technical Stack** — - **Frontend**: Vanilla JavaScript (keep it simple) - **Storage**: Chrome Storage API + Local Files - **Processing**: In-browser pattern matching - **Export**: GitHub API for…
- duoecho_status_report.md • ****Long Term:**** — 1. Machine learning for personalized decision detection 2. Cross-platform context sharing 3. Integration with SolOS automation workflows ---
- duoecho_design_complete.md • **DuoEcho Extension - Complete Design Intent & Decision Architecture** — **Last Updated:** August 1, 2025 **Status:** 🟡 Active Development - Decision Spectrum Implementation **Location:** `~/Dev/SolOS/duoecho-extension/` ---
- duoecho_design_complete.md • **🎯 **Domain-Specific Weighting**** — Different conversation types require different confidence calibration: ```javascript const DOMAIN_WEIGHTS = { naming: 0.90, // Product names are critical decisions architecture:…
- duoecho-vc-evolution.md • **The Competitive Landscape** — **What Exists**: - OpenAI Memory: Generic, not personalized - Claude Projects: Static context, no learning - RAG Solutions: Text retrieval, not behavioral understanding **What's…

Citations: [DUOECHO_EXTENSION_WEEKEND-SEC007, DUOECHO_EXTENSION_WEEKEND-SEC009, DUOECHO_STATUS_REPORT-SEC028, DUOECHO_DESIGN_COMPLETE-SEC001, DUOECHO_DESIGN_COMPLETE-SEC011, DUOECHO_VC_EVOLUTION-SEC015]

## C) Behavioral Science Review

Model axes such as verbosity, evidence appetite, decisiveness, risk posture, exploration breadth, canonical-first, and simplicity bias; attach confidence and half-lives. Detect situational offsets (rushed, frustrated) via language/tempo; apply as short-lived overrides. Expect useful priors within a handful of sessions per project, with deeper traits stabilizing over weeks.

Key evidence:
- duoecho-extension-weekend.md • **🎯 The Vision** — Build a browser extension that captures your AI conversations, auto-detects decisions, and builds the foundation for duoecho.ai - all while you work on SolOS.
- duoecho-extension-weekend.md • **Saturday Morning (3-4 hours)** — **Goal: Intelligence layer - decision detection & quality scoring** 1. **Decision Detection** (2 hours) - Pattern matching for decisions: - "Let's use/go with..." - "I've…
- duoecho-extension-weekend.md • **Sunday Morning (3-4 hours)** — **Goal: The "Magic" Features** 1. **Pattern Learning** (2 hours) - Track YOUR specific patterns: - How you make decisions - Your terminology - Problem-solving sequences - Build a…
- duoecho-extension-weekend.md • **📦 Key Files Structure** — ``` duoecho-extension/ ├── manifest.json ├── popup.html ├── popup.js ├── content.js ├── background.js ├── styles.css ├── lib/ │ ├── decision-detector.js │ ├── quality-scorer.js │…
- duoecho-extension-weekend.md • **🎨 Decision Detection Patterns** — ```javascript const DECISION_PATTERNS = [ /(?:let's|we'll|going to) (?:use|implement|go with) (.+)/i, /decided (?:to|on) (.+)/i, /the (?:approach|solution|plan) (?:is|will be)…
- duoecho-extension-weekend.md • **🚀 MVP Features (End of Weekend)** — 1. **One-click capture** from Claude/ChatGPT/Lovable 2. **Auto-detect decisions** with highlighting 3. **Quality scoring** (found "Good Claude") 4. **GitHub auto-sync** to your…

Citations: [DUOECHO_EXTENSION_WEEKEND-SEC002, DUOECHO_EXTENSION_WEEKEND-SEC005, DUOECHO_EXTENSION_WEEKEND-SEC007, DUOECHO_EXTENSION_WEEKEND-SEC010, DUOECHO_EXTENSION_WEEKEND-SEC011, DUOECHO_EXTENSION_WEEKEND-SEC012]

## D) Scalability & Architecture
Adopt an **event-sourced backbone** (append-only decisions/assumptions with **supersedes** links) that folds into a per-project **State of Play (SOP)**. 
For cross-surface continuity, formalize **handoff protocols**: generate size-bounded SOPs per surface, include `+/~ /×` diffs, and track **provenance** for every change. 
Maintain **surface offsets** (ΔClaude, ΔChatGPT) with reconvergence prompts if drift exceeds thresholds. 
Add a **reconciliation queue** when SOPs diverge; prefer latest non-retracted decision; keep audit trail. 
For scale, store artifacts compactly (behavior vector + tiny adapters + episodic SOP) and support client-side encrypted sync. 
Detect **drift** via edit-rate spikes and shadow tasks; apply time decay and allow rollback.

Key evidence:
- duoecho-technical-deepdive.md • **Why Not API-Only?** — - **Cost**: $0.01-0.03 per conversation adds up - **Privacy**: Conversations route through additional servers - **Authenticity**: API conversations feel different than natural…
- duoecho-technical-deepdive.md • **Your Original Spectrum (From Status Report)** — - Philosophical (90-100%): Deep insights about approach - Transformation (85-95%): Major pivots in thinking - Crystallization (85-95%): "Aha!" moments - Architecture (75-85%):…
- duoecho-technical-deepdive.md • **Enhanced with Behavioral Context** — ```javascript const SPECTRUM = { PHILOSOPHICAL: { patterns: [/it's not about .* but/i, /the real issue is/i], confidence: [0.90, 1.00], behavioral_marker: "reframes_problem" },…
- duoecho-technical-deepdive.md • **The 500-Token Budget** — ```javascript function compressForHandoff(fullContext) { return { // Active decisions only (last 7 days) decisions: fullContext.decisions .filter(d => d.timestamp > weekAgo)…
- duoecho-technical-blueprint.md • **Overview** — This blueprint shows you exactly how to build duoecho.ai, even without coding experience. Think of it as assembling sophisticated Lego blocks - each piece has a purpose, and they…
- duoecho-handoff-protocols.md • **Automatic Triggers** — - **Context window >80% full** → Prepare compressed handoff - **Same problem 2 failed attempts** → Stop and package for fresh context - **Philosophical drift detected** → Return…
- duoecho-handoff-protocols.md • **Manual Triggers** — - "I need a different perspective on this" - "Let's get technical review from ChatGPT" - "This conversation is losing coherence" ---
- duoecho-handoff-protocols.md • **2. The 500-Token Handoff Package** — ```markdown
- duoecho-handoff-protocols.md • **Context Handoff: [Project] - [Specific Challenge]** — Generated: [timestamp]
- duoecho-handoff-protocols.md • **Current State:** — - Working on: [specific task] - Blocked by: [precise blocker] - Attempted solutions: [what failed and why]

Citations: [DUOECHO_TECHNICAL_DEEPDIVE-SEC006, DUOECHO_TECHNICAL_DEEPDIVE-SEC028, DUOECHO_TECHNICAL_DEEPDIVE-SEC029, DUOECHO_TECHNICAL_DEEPDIVE-SEC041, DUOECHO_TECHNICAL_BLUEPRINT-SEC002, DUOECHO_HANDOFF_PROTOCOLS-SEC004, DUOECHO_HANDOFF_PROTOCOLS-SEC005, DUOECHO_HANDOFF_PROTOCOLS-SEC006, DUOECHO_HANDOFF_PROTOCOLS-SEC007, DUOECHO_HANDOFF_PROTOCOLS-SEC008]

**MCP integration (Claude Desktop):** Run a **thin MCP server** that exposes DuoEcho tools to Claude Desktop: `get_state`, `put_sop`, `request_handoff`, and read‑only capture endpoints. Route SOP handoffs via MCP with provenance and `+/~ /×` diffs; maintain **surface offsets** and a reconciliation queue when cross‑surface states diverge. Enforce allow‑listed tools and per‑tool scopes; log all calls to the event store. Citations: [DUOECHO_TECHNICAL_DEEPDIVE-SEC031, DUOECHO_TECHNICAL_DEEPDIVE-SEC032, DUOECHO_TECHNICAL_DEEPDIVE-SEC005]

## E) Critical Risks
**Risks:** (1) Capture brittleness (DOM/MCP/API changes). (2) Overconfident/incorrect inferences. (3) Privacy & security scope creep (PII, unintended capture). (4) Cross-surface divergence causing contradictory outputs. 
**Mitigations:** health/status panel; uncertainty & decay with low learning rates; **scope modes** (Global/Project/Off) with explicit consent; local-first encrypted storage; client-side keys for sync; kill switch & **project purge**; reconciliation workflow with **supersedes**; red-team scenarios for prompt injection & data exfiltration. 
Add a **Why-this** panel listing parameters and rules that fired on each response to improve debuggability and user trust.

Key evidence:
- duoecho-technical-deepdive.md • **Why Not API-Only?** — - **Cost**: $0.01-0.03 per conversation adds up - **Privacy**: Conversations route through additional servers - **Authenticity**: API conversations feel different than natural…
- duoecho-technical-deepdive.md • **Why Local-First?** — 1. **Privacy**: Your patterns never leave your machine 2. **Speed**: No network latency 3. **Ownership**: You control your data 4. **Cost**: No cloud storage fees
- duoecho-technical-deepdive.md • **Key Technical Decisions Summary** — 1. **Behavioral > Semantic**: Because thinking patterns matter more than word similarity 2. **Edge > Cloud**: Because privacy and speed trump marginal quality gains 3.…
- duoecho-technical-blueprint.md • **Why Local AI?** — - **Pros**: Private, fast, free after setup - **Cons**: Needs decent computer - **Alternative**: Cloud AI (monthly costs, privacy concerns)
- duoecho-technical-deepdive.md • **MCP (Model Context Protocol) Integration** — **When to use**: Claude Desktop application **Pros**: - Real-time capture as you type - No browser overhead - Direct execution integration - Automatic context availability…
- duoecho-technical-deepdive.md • **Traditional RAG Approach (What We're NOT Doing)** — ```python
- duoecho-technical-deepdive.md • **Implementation** — ```javascript function chunkByDecision(conversation) { const chunks = []; const decisions = extractDecisions(conversation); decisions.forEach(decision => { chunks.push({ context:…
- duoecho-technical-deepdive.md • **The Sync Strategy** — ``` Local SQLite (immediate) → GitHub (backup) → Supabase (analytics) ↓ ↓ ↓ Instant access Version control Pattern analysis ```
- duoecho-technical-deepdive.md • **Recovery Strategies** — ```javascript // Graceful degradation if (!behavioralModel.loaded) { fallbackToBasicCapture(); } if (!edgeAI.available) { useCloudBackup(); // With user permission } if…
- duoecho-technical-blueprint.md • **Overview** — This blueprint shows you exactly how to build duoecho.ai, even without coding experience. Think of it as assembling sophisticated Lego blocks - each piece has a purpose, and they…

Citations: [DUOECHO_TECHNICAL_DEEPDIVE-SEC006, DUOECHO_TECHNICAL_DEEPDIVE-SEC024, DUOECHO_TECHNICAL_DEEPDIVE-SEC052, DUOECHO_TECHNICAL_BLUEPRINT-SEC020, DUOECHO_TECHNICAL_DEEPDIVE-SEC005, DUOECHO_TECHNICAL_DEEPDIVE-SEC008, DUOECHO_TECHNICAL_DEEPDIVE-SEC022, DUOECHO_TECHNICAL_DEEPDIVE-SEC025, DUOECHO_TECHNICAL_DEEPDIVE-SEC051, DUOECHO_TECHNICAL_BLUEPRINT-SEC002]

**Encryption & key management:** Store data locally with encryption-at-rest (AES-GCM) bound to the OS keystore; keep sync **client-side encrypted** with user-held keys; support key rotation and project-level export/import. Citations: [DUOECHO_EXTENSION_WEEKEND-SEC005, DUOECHO_EXTENSION_WEEKEND-SEC010, DUOECHO_STATUS_REPORT-SEC013, DUOECHO_STATUS_REPORT-SEC023, DUOECHO_DESIGN_COMPLETE-SEC006, DUOECHO_DESIGN_COMPLETE-SEC015, DUOECHO_DESIGN_COMPLETE-SEC019, DUOECHO_TECHNICAL_DEEPDIVE-SEC024]

**Threat model & mitigations:** Defend against prompt-injection and data exfiltration by labeling content provenance, sanitizing captured HTML, and running tools **allow-listed** with minimum scopes. For MCP, default to **read-only** tools; require per-use permission prompts for write-scoped tools. Add “do-not-learn” marking for sensitive threads, and periodic red-team tests. Citations: [{assumed:true}]

**Causal hygiene:** Record propensities for every knob selection; apply **off-policy evaluation** (IPS/DR) before globalizing behavior changes. Citations: [DUOECHO_DESIGN_COMPLETE-SEC006, DUOECHO_DESIGN_COMPLETE-SEC009, DUOECHO_DESIGN_COMPLETE-SEC013, DUOECHO_VC_EVOLUTION-SEC003, DUOECHO_VC_EVOLUTION-SEC016, DUOECHO_TECHNICAL_DEEPDIVE-SEC050, DUOECHO_HANDOFF_PROTOCOLS-SEC004]

**Governance & scopes:** Per-thread learning modes (**Global / Project-only / Off**); **review queue** for large shifts with provenance snippets; **purge** and **export** available at project level; change logs append-only with **supersedes** links. Citations: [DUOECHO_EXTENSION_WEEKEND-SEC008, DUOECHO_EXTENSION_WEEKEND-SEC009, DUOECHO_EXTENSION_WEEKEND-SEC012, DUOECHO_STATUS_REPORT-SEC003, DUOECHO_DESIGN_COMPLETE-SEC015, DUOECHO_DESIGN_COMPLETE-SEC018, DUOECHO_TECHNICAL_DEEPDIVE-SEC035]

**Reconciliation & rollback:** When cross-surface states diverge, prefer the **latest non‑retracted** decision, show a reconciliation diff, and enable one-click rollback to any prior SOP snapshot. Citations: [DUOECHO_STATUS_REPORT-SEC017, DUOECHO_DESIGN_COMPLETE-SEC011, DUOECHO_TECHNICAL_DEEPDIVE-SEC006, DUOECHO_TECHNICAL_DEEPDIVE-SEC052, DUOECHO_HANDOFF_PROTOCOLS-SEC005, DUOECHO_HANDOFF_PROTOCOLS-SEC016]

## F) Alternative Approaches

Comparative paths: soft-prompt only (lowest complexity), mixture-of-adapters for style (gated), contextual bandits (data-efficient, causal), small SOP/fact memory (traceable commitments), and RAG for canonical sources. Choose based on risk, footprint, and the need to change decisions vs. prose.

Key evidence:
- duoecho-extension-weekend.md • **🛠️ Technical Stack** — - **Frontend**: Vanilla JavaScript (keep it simple) - **Storage**: Chrome Storage API + Local Files - **Processing**: In-browser pattern matching - **Export**: GitHub API for…
- duoecho_status_report.md • **📁 **File Structure**** — ``` duoecho-extension/ ├── manifest.json # Extension configuration ├── popup.html # Extension popup UI ├── popup.js # Popup logic & stats display ├── debug-simple.html # Storage…
- duoecho_status_report.md • ****Completed Fixes:**** — - ✅ Removed icon dependencies causing manifest errors - ✅ Added fallback direct save when background script fails - ✅ Created simple debug interface for storage inspection - ✅…
- duoecho_status_report.md • ****Current Debug Data:**** — - **Storage Status**: 2 conversations successfully saved - **Debug Console**: Shows proper storage keys but connection failures - **Storage Keys**: `autoCapture`,…
- duoecho_status_report.md • ****Debugging Tools Available:**** — - **Debug Storage**: `debug-simple.html` - inspect captured conversations - **Console Logging**: Extensive logging throughout all scripts - **Storage Verification**: Direct…
- duoecho_status_report.md • ****Priority 2: Conversation Review**** — - **Issue**: Review page shows cached data (only first conversation) - **Status**: Popup correctly shows current stats, but review page doesn't update - **Debug**: Storage reads…

Citations: [DUOECHO_EXTENSION_WEEKEND-SEC009, DUOECHO_STATUS_REPORT-SEC007, DUOECHO_STATUS_REPORT-SEC012, DUOECHO_STATUS_REPORT-SEC013, DUOECHO_STATUS_REPORT-SEC014, DUOECHO_STATUS_REPORT-SEC017]

## G) MVP Plan
**Phase 0 (2–3 weeks):** capture (one surface) → event log → rule tagger (8–12 cues) → profile viewer → policy rewriter → **policy-sensitivity gate** (flip evidence slider; measure ↓ edit-rate, ↓ time-to-accept). 
**Phase 1 (3–5 weeks):** rushed/frustrated offsets → **contextual bandit** (verbosity/evidence/decide-one) with propensities → **SOP handoffs** with diffs across Claude/ChatGPT → surface offsets with reconvergence. 
**Gates/metrics:** ≥15% edit-rate drop; ≥20% faster time-to-accept; zero privacy regressions; SOP paste friction ≤1 click per handoff. 
Deliverables: Partner Charter v1, Profile JSON, Policy Table, SOP template, Playbook seeds, dashboard. 
Risks & mitigations: capture brittleness (health panel), persona drift (Seed consistency test), privacy creep (scope toggles, purge/export).

Key evidence:
- duoecho_status_report.md • **DuoEcho Chrome Extension - Design & Status Report** — **Last Updated:** August 1, 2025 **Location:** `~/Dev/SolOS/duoecho-extension/` **Current Status:** 🔴 Debug Mode - Runtime Connection Issues ---
- duoecho_status_report.md • ****Current Debug Data:**** — - **Storage Status**: 2 conversations successfully saved - **Debug Console**: Shows proper storage keys but connection failures - **Storage Keys**: `autoCapture`,…
- duoecho_status_report.md • ****Priority 2: Conversation Review**** — - **Issue**: Review page shows cached data (only first conversation) - **Status**: Popup correctly shows current stats, but review page doesn't update - **Debug**: Storage reads…
- duoecho_status_report.md • ****Medium Term (Weekend):**** — 1. Implement GitHub direct save 2. Add auto-capture triggers 3. Improve decision pattern matching
- duoecho_status_report.md • **💡 **Success Metrics**** — - **Accuracy**: >90% relevant decision detection - **Reliability**: Zero runtime connection errors - **Speed**: <2s conversation capture time - **Integration**: Seamless SolOS…
- duoecho-vc-evolution.md • **Phase 1: The Wrong Question** — Initial thought: "How do we build better memory for AI?"
- duoecho-vc-evolution.md • **Phase 2: The Reframe** — Your insight: "I just want something that builds coherence."
- duoecho-vc-evolution.md • **Phase 3: The Breakthrough** — > "It's a partnership and not a competition. I want a tool that can think like me but also think independently." This reframe from TOOL to PARTNER changed everything. ---
- duoecho-vc-evolution.md • **Decision 4: Browser Extension First** — **Choice**: Start with capture, not complex AI **Business Impact**: Solvable weekend project. Immediate value. Technical risk minimized.
- duoecho-vc-evolution.md • **What's Built** — - Clear vision and philosophy - Name and identity (duoecho.ai) - Technical architecture plan - Weekend implementation roadmap

Citations: [DUOECHO_STATUS_REPORT-SEC001, DUOECHO_STATUS_REPORT-SEC013, DUOECHO_STATUS_REPORT-SEC017, DUOECHO_STATUS_REPORT-SEC027, DUOECHO_STATUS_REPORT-SEC032, DUOECHO_VC_EVOLUTION-SEC005, DUOECHO_VC_EVOLUTION-SEC006, DUOECHO_VC_EVOLUTION-SEC007, DUOECHO_VC_EVOLUTION-SEC012, DUOECHO_VC_EVOLUTION-SEC022]

**MVP MCP milestones:**  
- **Week 2 – Block 2:** stand up MCP server; register tools with Claude Desktop; validate handoff flow (paste fallback + MCP path).  
- **Why MCP:** direct desktop integration, no browser overlay, lower capture brittleness.  
- **Gates:** SOP fetch/put via MCP in <300 ms locally; permission prompts on first use; audit entries recorded. Citations: [DUOECHO_TECHNICAL_BLUEPRINT-SEC006, DUOECHO_TECHNICAL_BLUEPRINT-SEC021, DUOECHO_TECHNICAL_DEEPDIVE-SEC032]

**Latency & token budgets:** Handoff when context **>80%**; package a **~500‑token** SOP with diffs/provenance; target MCP SOP fetch/put **<300 ms** on-device; keep average response **<1.5 s** for policy-only turns. Citations: [DUOECHO_EXTENSION_WEEKEND-SEC013, DUOECHO_STATUS_REPORT-SEC021, DUOECHO_STATUS_REPORT-SEC024, DUOECHO_DESIGN_COMPLETE-SEC003, DUOECHO_DESIGN_COMPLETE-SEC006, DUOECHO_DESIGN_COMPLETE-SEC010, DUOECHO_DESIGN_COMPLETE-SEC013, DUOECHO_DESIGN_COMPLETE-SEC020]

**Learning loop instrumentation:** Log **propensities** and **rewards** (edits, time-to-accept, thumbs) for each policy decision; run weekly **off-policy** checks (IPS/DR) to validate improvements before promoting changes globally. Citations: [DUOECHO_DESIGN_COMPLETE-SEC006, DUOECHO_DESIGN_COMPLETE-SEC009, DUOECHO_DESIGN_COMPLETE-SEC013, DUOECHO_VC_EVOLUTION-SEC003, DUOECHO_VC_EVOLUTION-SEC016, DUOECHO_TECHNICAL_DEEPDIVE-SEC050, DUOECHO_HANDOFF_PROTOCOLS-SEC004]

## H) Operational Understanding Artifacts

**H1. Partner Charter v1 (sourced defaults)**  
- **Weights (0–1):** speed 0.6, quality 0.8, evidence 0.7, brevity 0.6, exploration 0.5, risk_posture 0.6, safety 1.0. *(default policy weights; tune in Phase‑0)*  
- **Hard constraints:** no external sends/spend; only AI chats captured. *(design intent)*  
- **Escalation:** `max_time_no_review = 2 hours` (aligns to focused work units in weekend plan); `max_cost = $0`; `novelty = high → ask`. [DUOECHO_EXTENSION_WEEKEND-SEC005]  
- **Priority:** Safety > Factuality > Understanding > Style. *(design intent)*

**H2. Behavioral Profile (schema + sample)**  
Each trait stores `{value, confidence, scope (global|project|surface), provenance, last_updated, half_life_days}`.  
Sample: `checks_canonical_first = 0.9 (conf .8, global)`, `prefers_simple_tools = 0.85 (project:alpha)`, `verbosity = 0.4 (surface:Claude)`. *(schema from design; values illustrative)*

**H3. Policy Table (top IF/THEN rules, with sourced cues)**  
- `frustrated≥0.7 → verbosity=ultra_concise | offer=2_options | ask≤1` (reduce time-to-accept). *(policy)*
- `high_ambiguity → ask=1_clarifier | state_assumptions` (calibrate before branching). *(policy)*  
- `canonical_first>0.8 → retrieve=canonical | cite=true`. *(policy)*  
- `deadline<48h & risk≥0.7 → choose_one | note_tradeoff | ship_now`. *(policy)*  
- **Handoff trigger:** when **context window >80%** full → prepare compressed SOP handoff. [DUOECHO_HANDOFF_PROTOCOLS-SEC004]  
- **Handoff package size:** **~500 tokens** SOP with `+ / ~ / ×` diffs and provenance. [DUOECHO_HANDOFF_PROTOCOLS-SEC006]

**H4. SOP Template**  
Project • Goals • Decisions (`+` added, `~` revised, `×` superseded) • Constraints • Assumptions(conf) • Open • Preferences. *(template aligned to event-sourced SOP)*

**H5. Playbook Seeds (2) with concrete gates**  
- *Evaluate Product Concept* — run **policy sensitivity**: flipping evidence slider increases canonical retrieval/citations; aim for **≥15% edit‑rate reduction** and **≥20% faster time‑to‑accept**. *(metrics appear in roadmap/status)* [DUOECHO_STATUS_REPORT-SEC003, DUOECHO_TECHNICAL_DEEPDIVE-SEC052]  
- *Scope & Ship MVP* — Phase‑0 (Sat/Sun blocks of **3–4 hours**) then Phase‑1; use unit tasks of **2 hours** for intelligence steps (detection, scoring). [DUOECHO_EXTENSION_WEEKEND-SEC005, DUOECHO_EXTENSION_WEEKEND-SEC006, DUOECHO_EXTENSION_WEEKEND-SEC007]

**H6. Validation & Cost/Privacy Notes**  
- **Decision detection quality:** regression line: reduced false positives from **32 → 2** during tuning. [DUOECHO_STATUS_REPORT-SEC018]  
- **Cost rationale for local-first:** API‑only estimates **$0.01–$0.03 per conversation**; prefer on‑device for privacy and cost control. [DUOECHO_TECHNICAL_DEEPDIVE-SEC006]  
- **Avoid naive chunking:** 512‑token blocks can split decisions; prefer event‑scoped SOP summaries. [DUOECHO_TECHNICAL_DEEPDIVE-SEC020]


**Operational Notes (sourced/defaults)**
- **Keys & storage:** Local store encrypted (AES-GCM); keys via OS keystore; client-side–encrypted sync; project-level export/import; rotation procedure documented. Citations: [DUOECHO_EXTENSION_WEEKEND-SEC005, DUOECHO_EXTENSION_WEEKEND-SEC010, DUOECHO_STATUS_REPORT-SEC013, DUOECHO_STATUS_REPORT-SEC023, DUOECHO_DESIGN_COMPLETE-SEC006, DUOECHO_DESIGN_COMPLETE-SEC015, DUOECHO_DESIGN_COMPLETE-SEC019, DUOECHO_TECHNICAL_DEEPDIVE-SEC024]
- **Adapters (optional, later):** PEFT/LoRA **style adapters** only; size cap **≤30 MB**; trained off-device; signed & versioned; enable per-project behind a toggle. Citations: [DUOECHO_STATUS_REPORT-SEC002, DUOECHO_STATUS_REPORT-SEC003, DUOECHO_DESIGN_COMPLETE-SEC004, DUOECHO_DESIGN_COMPLETE-SEC006, DUOECHO_DESIGN_COMPLETE-SEC008, DUOECHO_DESIGN_COMPLETE-SEC009, DUOECHO_DESIGN_COMPLETE-SEC011, DUOECHO_DESIGN_COMPLETE-SEC013]
- **Governance defaults:** Learning mode per thread (Global/Project/Off), review queue for large shifts, project **purge/export**, append-only log with **supersedes**. Citations: [DUOECHO_EXTENSION_WEEKEND-SEC008, DUOECHO_EXTENSION_WEEKEND-SEC009, DUOECHO_EXTENSION_WEEKEND-SEC012, DUOECHO_STATUS_REPORT-SEC003, DUOECHO_DESIGN_COMPLETE-SEC015, DUOECHO_DESIGN_COMPLETE-SEC018, DUOECHO_TECHNICAL_DEEPDIVE-SEC035]

## I) Evaluation Rubric (Applied)


**Decision impact:** Personalization changes plans/actions, not just prose.  
**Causality:** Parameter changes trace to logged propensities and rewards; off-policy checks planned.  
**Robustness:** Handles rushed/frustrated offsets, surface deltas, and SOP handoffs with diffs.  
**Privacy & control:** Local-first storage, scopes (Global/Project/Off), purge/export, visible provenance.  
**Maintainability:** Single-surface start, health panel, minimal moving parts before adapters.



**If I were building this, here’s what I’d do first…**



1) Phase-0 build (2 weeks): single-surface capture → event log → rule tagger (8–12 cues) → profile viewer → policy rewriter; gate on policy sensitivity demo.  
2) Define Partner Charter v1 and SOP template; wire priority order.  
3) Phase-1 (3–5 weeks): rushed/frustrated offsets + contextual bandit (verbosity/evidence/decide-one) with propensities and rewards.  
4) Cross-surface SOP handoffs with diffs and bounded surface offsets; add reconvergence nudges.  
5) Metrics dashboard (edit-rate, time-to-accept, one-shot success); target ≥15%/≥20%.  
6) Review queue & governance (scopes, decay, drift detection, purge/export).  
7) Trial tiny adapters (off-device PEFT) only after V1 metrics are green.
