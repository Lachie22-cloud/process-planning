# Plan: Intelligent Scheduling Optimization (Agents SDK + Deterministic Engine)

## Status
Ready for implementation

## Summary
Build a production-grade planning assistant by combining:
1. Deterministic scheduling optimization (source of truth)
2. Agents SDK orchestration (tool-using assistant)
3. Draft-only mutation workflow with strict approval controls

This replaces the current hand-rolled model loop with an Agents SDK runtime and makes schedule quality logic fully programmatic and testable.

## Locked Decisions (from product direction)
- Credential scope: per-site only
- Credential types: API key or auth token
- Default model behavior: high-reasoning mode, not user-configurable for now
- Branding: user-facing UI must refer to "Process Planning Agent", not vendor/model names
- Internet access: disabled for planner agent
- Wiki: plain text/markdown in DB (no separate file upload required)
- Session behavior: shared per user for each site, no concurrency limit for now
- Side chat: advisory + draft creation only, not direct live mutation

## Current Reality (verified in main)
- Chat continuity currently works by replaying stored message history, not true SDK resume
- Backend currently uses direct Anthropic SDK calls
- Draft approval/apply workflow exists and is usable
- Wiki, scheduled tasks, and AI config pages exist
- Deterministic health/placement/simulation engines are not implemented yet

## Problem Statement
The current AI path can chat and create drafts, but optimization quality is constrained because the system lacks deterministic placement/health tools and still relies on LLM reasoning for logic that should be algorithmic.

## Target Architecture

### A) Deterministic Optimization Layer (authoritative)
Implement pure functions/services to compute:
- `score_placement(batchId, targetResourceId, targetDate)`
- `find_best_move(batchId, constraints?)`
- `simulate_move(batchId, targetResourceId, targetDate)`
- `score_health(weekRange|viewRange)`

Rules to include (minimum set):
- Min/max capacity
- Max batches per day
- Resource block windows
- Substitution permissions
- Colour transition penalties/bonuses
- WOM/WOP availability constraints
- Bulk/resource-specific restrictions

### B) Agent Orchestration Layer (Agents SDK)
Replace custom loop with Agents SDK runner:
- Tool-calling loop managed by SDK
- Run/session state persisted to existing chat tables
- Streaming responses preserved in UI
- Retry/backoff and tool error propagation standardized

### C) Draft Governance Layer
- Agent write capability limited to `create_draft` only
- Draft apply remains explicit approve -> apply flow
- Optional future auto-approve only for low-risk deterministic criteria

## Required Workstreams

## Workstream 1: Agents SDK Migration
### Deliverables
- Introduce SDK adapter in `docker/ai-agent/src/agent/`
- Replace direct SDK usage in `spawner.ts` with adapter call
- Preserve existing `/ai/chat` and `/ai/scan` API contracts
- Remove dead/legacy runtime paths that are no longer used

### Acceptance Criteria
- No direct `@anthropic-ai/sdk` runtime calls remain in request path
- Chat streaming still works in UI with tool status updates
- Historical sessions still load and continue correctly
- Existing permissions and auth checks unchanged

### Verification
- `rg "@anthropic-ai/sdk|messages\.create|messages\.stream" smart-schedule/docker/ai-agent/src`
- Integration test: POST `/ai/chat` returns SSE stream with `message` + `done`
- Integration test: POST `/ai/scan` creates scan row and report

## Workstream 2: Deterministic Scoring Engine
### Deliverables
- New module: `src/lib/utils/placement-scoring.ts`
- New module: `src/lib/utils/health-scoring.ts`
- Shared schema for score explanations and issue types
- Unit tests with fixed fixtures

### Acceptance Criteria
- Same input schedule always returns identical scores
- Hard violations always return invalid/blocked placement
- `simulate_move` returns before/after health delta deterministically
- Test coverage for primary rule categories

### Verification
- `npm test` includes deterministic scoring test suite
- Snapshot/fixture tests pass for known schedules
- Engine output consumed by both UI and agent tools

## Workstream 3: Tool Surface Upgrade
### Deliverables
- Add tools: `score_placement`, `find_best_move`, `simulate_move`, `score_health`
- Keep existing read tools and `create_draft`
- Restrict write tools available in chat context to `create_draft` only

### Acceptance Criteria
- Agent can answer optimization questions using deterministic tool outputs
- Tool responses include machine-readable fields and human-readable reason codes
- No tool exists for direct batch/resource mutation

### Verification
- Tool contract tests for schema, validation, and site scoping
- Negative tests: out-of-site IDs are rejected

## Workstream 4: UX for Verifiable Planning Decisions
### Deliverables
- Move/Reschedule interaction with gradient efficiency overlay
- Health bar with deterministic score and issue counts
- "Run Analysis" action that uses deterministic engine + agent summary
- Draft review panel enriched with "why this is better" deltas

### Acceptance Criteria
- Planner can click a batch and see ranked move options with score breakdown
- Every suggested change references explicit deterministic reason codes
- Health score updates when schedule changes

### Verification
- E2E test: move batch -> health score recalculates
- E2E test: run analysis -> draft created -> approve -> apply

## Workstream 5: Security and Guardrails Hardening
### Deliverables
- Prompt policy: planning-only role, explicit refusal of off-domain requests
- Disable internet/search tool access for planning agent
- Keep site/user scoping strict in every tool call
- Remove vendor naming from end-user UI labels

### Acceptance Criteria
- Off-domain prompts get bounded refusal + redirect to planning tasks
- Agent cannot execute non-planning actions even under prompt injection attempts
- UI labels read as Process Planning Agent (no vendor/model names)

### Verification
- Red-team prompt tests stored as fixtures
- UI snapshot check for settings/chat labels

## Workstream 6: Operational Reliability
### Deliverables
- Structured logs for run_id/session_id/tool_call_id
- Metrics for tool latency, draft creation rates, scan success/failure
- Scheduler observability for task execution and misfires

### Acceptance Criteria
- Each chat/scan run is traceable end-to-end
- Failed tool calls surface actionable errors

### Verification
- Log assertions in integration tests
- Dashboard/metrics endpoint sanity checks

## Definition of Done
- Agents SDK is the active orchestration path
- Deterministic scoring tools are implemented and used by the agent
- Draft-only writes are enforced and tested
- Health + move UX uses deterministic outputs
- Security guardrails pass adversarial prompt tests
- Product wording uses Process Planning Agent naming throughout UI

## Implementation Sequence
1. Workstream 2 (deterministic engine)
2. Workstream 3 (tool upgrade)
3. Workstream 1 (Agents SDK migration)
4. Workstream 4 (UX integration)
5. Workstream 5 (security hardening)
6. Workstream 6 (ops/observability)

## Risks and Mitigations
- Risk: SDK migration changes chat behavior
  - Mitigation: preserve route contracts and add golden SSE tests
- Risk: scoring engine complexity drifts from user-configured rules
  - Mitigation: read weights/rules from DB, avoid hardcoded constants
- Risk: hallucinated recommendations
  - Mitigation: require deterministic reason codes for every recommendation
