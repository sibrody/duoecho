# State of Play (SOP) — DuoEcho
_Generated: 2025-08-02_

## Goals
- Build AI that learns individual thinking patterns through conversation analysis
- Solve the "42 chat amnesia" problem with behavioral coherence, not memory
- Create personal AI partners that grow with users over time

## Decisions (recent)
- --Name--: duoecho.ai (lowercase, no variants) - Aug 2
- --Architecture--: Behavioral embeddings > RAG - Aug 2
- --MVP--: Browser extension → MCP → Edge AI - Aug 2
- --Philosophy--: Partnership not tool, coherence not memory - Aug 2
- --Tech Stack--: Llama 3.2 local + browser extension + MCP - Aug 2
- ~~Build from scratch~~ → Fix existing extension line 462 error - Aug 2
- --Domain--: No bundling (.com, .net unnecessary) - Aug 2

## Constraints
- Local-first privacy; AI chats only; no external sends/spend without review.

## Assumptions (confidence)
- Behavioral embeddings guide decisions (0.8)
- Edge inference sufficient for v1 (0.7)

## Open Questions / Next Actions
- Confirm MCP tool scopes and latency budgets.
- Define evaluation gates for policy sensitivity (edit-rate/time-to-accept).

## Preferences (salient)
- Tone: Direct, intellectually engaged, zero fluff. Treat as competent partner, not student.
- Verbosity: Short by default. Expand only when introducing new concepts or philosophical shifts.