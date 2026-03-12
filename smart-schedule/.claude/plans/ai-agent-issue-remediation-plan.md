# Plan: AI Agent Issue Remediation

## Summary
Fix the concrete runtime, security, and quality issues found in the AI stack while preserving current UX and endpoint contracts.

## Confirmed Decisions
1. Scan execution remains synchronous.
2. Scan endpoint should not fail due to generic request timeout.
3. Keep draft-based control model (no direct AI mutation to live planning data).

## Scope
This plan addresses the seven identified gaps:
1. Chat prompt duplication
2. Scan timeout behavior
3. Agents SDK migration / true session continuity
4. Prompt reset non-transactional risk
5. Tool least-privilege for chat
6. Drag/drop rule-depth validation gap
7. Permission mapping drift risk

## Workstream 1: Fix Chat Prompt Duplication
## Goal
Ensure each user turn is sent exactly once to the model.

## Changes
1. In chat flow, avoid double-including the current user message.
2. Choose one approach and enforce it consistently:
   - Approach A: Persist user message after model call, keep `prompt` append behavior.
   - Approach B: Keep persistence before call, but do not append `newMessage` if history already includes it.
3. Add regression test for one-turn and multi-turn prompts.

## Acceptance Criteria
1. For a single send, model input contains one copy of the user turn.
2. For N sends, each turn appears once in model transcript.
3. Token usage decreases versus current duplicate behavior.

## Workstream 2: Remove Scan Timeout Constraint
## Goal
Prevent `/ai/scan` from failing due to global timeout middleware.

## Changes
1. Exempt `/ai/scan` from timeout middleware (similar to `/ai/chat`).
2. Keep scan route synchronous.
3. Add explicit scan progress logging and final status response guard.
4. Add upper safety bound via configurable scan-specific watchdog log only (no forced HTTP timeout).

## Acceptance Criteria
1. Long scan (>30s) completes successfully with 201 response.
2. No 504 returned for valid long-running scans.
3. Scheduler-triggered scans unaffected.

## Workstream 3: Migrate Runtime to Agents SDK
## Goal
Replace hand-rolled direct model orchestration with Agents SDK while preserving API behavior.

## Changes
1. Add adapter layer `docker/ai-agent/src/agent/runner.ts`.
2. Route `/ai/chat` and `/ai/scan` through adapter.
3. Preserve SSE shape (`session`, `message`, `status`, `done`, `error`).
4. Implement true run/session continuity semantics via SDK state.
5. Keep existing DB chat history for auditability.

## Acceptance Criteria
1. No direct runtime use of `@anthropic-ai/sdk` in active request path.
2. Chat resume works without replay-only fallback.
3. Existing frontend hooks require no contract changes.

## Workstream 4: Make Prompt Reset Transactional
## Goal
Avoid partial failure state when resetting prompt sections.

## Changes
1. Replace delete+insert sequence with transactional operation.
2. Use DB RPC transaction or server-side transaction wrapper.
3. Return old sections if reset fails.

## Acceptance Criteria
1. Failed reset never leaves site without prompt sections.
2. Successful reset atomically replaces all sections.

## Workstream 5: Enforce Tool Least-Privilege by Context
## Goal
Restrict chat tool surface to required capabilities only.

## Changes
1. Split tool registry by context:
   - Chat: read tools + `create_draft`
   - Scan: read tools + `create_draft` + scan lifecycle tooling
2. Remove `update_scan_status` from interactive chat path.
3. Add tool allowlist tests.

## Acceptance Criteria
1. Chat cannot invoke scan-status mutation tool.
2. Scan pipeline still updates status/report correctly.

## Workstream 6: Deepen Drag/Move Validation with Deterministic Rules
## Goal
Apply full planning constraints to move/reschedule suggestions.

## Changes
1. Integrate deterministic rule engine into drop-target validity and scoring.
2. Include substitution, colour transition, max/day, block windows, WOM/WOP logic.
3. Surface reason codes in UI for invalid or risky targets.

## Acceptance Criteria
1. Invalid targets are blocked for full rule set, not only basic capacity/block checks.
2. UI shows deterministic reason breakdown per candidate target.

## Workstream 7: Remove Permission Drift Risk
## Goal
Avoid hardcoded role-permission mismatch between AI service and platform RBAC.

## Changes
1. Replace static role map with claim-driven permission set or DB-backed permission lookup.
2. Keep site-scope enforcement as second check.
3. Add parity test against canonical permission source.

## Acceptance Criteria
1. AI service authorization results match canonical RBAC source.
2. Role changes do not require code redeploy to be effective.

## Verification Matrix
1. Unit tests: chat message construction, tool context scoping, rule validation.
2. Integration tests: `/ai/chat` SSE sequence, `/ai/scan` long-run completion, draft workflow.
3. Security tests: off-domain prompt handling, forbidden tool invocation rejection.
4. Regression tests: prompt reset failure safety, permission parity.

## Implementation Order
1. Workstream 1
2. Workstream 2
3. Workstream 5
4. Workstream 4
5. Workstream 7
6. Workstream 3
7. Workstream 6

## Notes
This sequence fixes correctness and production reliability first, then migrates orchestration, then expands deterministic optimization depth.

## South Solar Plot: Comprehensive Fix List
1. Eliminate chat turn duplication so each user message is sent to the model once.
2. Exempt `/ai/scan` from generic request timeout while keeping it synchronous.
3. Add scan watchdog logging and correlation IDs for long-running scans.
4. Migrate runtime orchestration from direct Anthropic SDK calls to Agents SDK adapter.
5. Preserve existing `/ai/chat` and `/ai/scan` API contracts during migration.
6. Implement true provider-native session/run continuity semantics (not replay-only).
7. Keep DB chat history as audit trail and fallback context source.
8. Make prompt reset atomic (transactional delete+insert or replace strategy).
9. Add rollback-safe behavior for prompt reset failures.
10. Split tool allowlists by context (chat vs scan).
11. Remove `update_scan_status` access from interactive chat context.
12. Keep draft creation as the only AI write operation in chat.
13. Add explicit tests for forbidden tool invocation in chat context.
14. Build deterministic placement scoring engine (`score_placement`).
15. Build deterministic best-move engine (`find_best_move`).
16. Build deterministic simulation engine (`simulate_move`).
17. Build deterministic schedule health engine (`score_health`).
18. Wire deterministic engines into UI move/reschedule validation.
19. Show deterministic reason codes for invalid targets in resource timeline.
20. Add deterministic score breakdowns for suggested moves.
21. Expand move validation to include substitution rules and colour-transition constraints.
22. Expand move validation to include capacity/day limits, resource blocks, WOM/WOP constraints.
23. Replace hardcoded AI-service role-permission map with canonical permission source.
24. Add parity tests ensuring AI-service authorization matches platform RBAC.
25. Remove vendor/model references from end-user UI labels and text.
26. Enforce planning-only behavioral guardrails in system prompt sections.
27. Add adversarial prompt tests for prompt-injection and off-domain request refusal.
28. Ensure no internet/search capability is exposed to planning assistant runtime.
29. Add structured logs for `run_id`, `session_id`, `tool_call_id`, and scan lifecycle.
30. Add integration tests for `/ai/chat` SSE sequence and `/ai/scan` long-run completion.
31. Add regression tests for prompt reset failure safety and chat turn deduplication.
32. Add end-to-end test for full draft lifecycle: create -> approve -> apply.
33. Validate scheduler and manual scan paths remain compatible after SDK migration.
34. Add release checklist and rollback plan for AI-agent deployment changes.
