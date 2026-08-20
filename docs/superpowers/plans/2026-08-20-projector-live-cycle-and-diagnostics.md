# Projector LIVE Cycle And Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace full projector configuration rewrites with a revisioned LIVE cycle, add readable current-session diagnostics, isolate DMX Device-list deletion, and unify the visible version.

**Architecture:** `app.js` owns projector intent and the diagnostics view; `designer-adapter.js` owns LIVE bindings and narrow Python operations. Projector geometry, derived optics, rotation finalization, and Surface binding are separate operations with explicit log phases.

**Tech Stack:** Browser JavaScript, Canvas UI, Disguise Python Execution API, Disguise LIVE WebSocket API, Node.js assertion tests.

**Spec:** `docs/superpowers/specs/2026-08-20-projector-live-cycle-and-diagnostics-design.md`

## Global Constraints

- Position and Look At are the only bidirectional Projector geometry inputs.
- Look Distance and Field of View are Designer read-only values.
- Never replace Designer typed collections.
- Never run destructive automatic Designer probes.
- Product version is `0.21.0`; state schema remains `11`.

---

### Task 1: Current-Session Diagnostics

**Files:**
- Modify: `scene-planner-prototype/app.js`
- Modify: `scene-planner-prototype/index.html`
- Modify: `scene-planner-prototype/styles.css`
- Test: `tests/scene-planner.test.cjs`

**Interfaces:**
- Produces: `plannerLog(level, subsystem, message, details)`, `setActiveError(scope, message, details)`, and `resolveActiveError(scope)`.

- [ ] Add failing tests that persisted errors are discarded on load, active errors alone drive `#status-error-chip`, and structured diagnostic rows render severity, subsystem, object, and phase.
- [ ] Run `node tests/scene-planner.test.cjs` and confirm the new assertions fail because runtime diagnostics do not exist.
- [ ] Implement the in-memory log, scoped active errors, persistent panel above raw LIVE diagnostics, and combined clipboard export.
- [ ] Run `node tests/scene-planner.test.cjs` and confirm it passes.
- [ ] Commit diagnostics as one independently testable change.

### Task 2: Revisioned Projector LIVE Cycle

**Files:**
- Modify: `scene-planner-prototype/app.js`
- Modify: `scene-planner-prototype/designer-adapter.js`
- Test: `tests/projector-contract.test.cjs`
- Test: `tests/live-state-machine.test.cjs`
- Test: `tests/scene-planner.test.cjs`

**Interfaces:**
- Consumes: Task 1 diagnostic and active-error functions.
- Produces: one LIVE geometry write containing Position and Look At, Designer readback callbacks, and per-Projector revision state.

- [ ] Add failing tests proving geometry writes contain Position and Look At but not Look Distance, Throw Ratio, FOV, or Rotation.
- [ ] Add failing tests proving a newer geometry revision cancels old derived work and own echoes do not restart a cycle.
- [ ] Run the three focused tests and verify the expected failures.
- [ ] Remove full Python configuration commits from movement and numeric geometry edits; implement coalesced revisioned LIVE geometry cycles.
- [ ] Run the focused tests and confirm they pass.
- [ ] Commit the Projector transport change.

### Task 3: Auto Optics, Rotation Z, And Surface Inverse Verification

**Files:**
- Modify: `scene-planner-prototype/app.js`
- Modify: `scene-planner-prototype/designer-adapter.js`
- Modify: `scene-planner-prototype/styles.css`
- Test: `tests/projector-contract.test.cjs`
- Test: `tests/live-state-machine.test.cjs`
- Test: `tests/scene-planner.test.cjs`

**Interfaces:**
- Consumes: Task 2 Projector revision state and Designer Look Distance/FOV events.
- Produces: `optics.throwRatioAuto`, `rotationZMode`, narrow Throw Ratio and Rotation Z writes, and inverse binding readback.

- [ ] Add literal failing tests for Auto Throw Ratio using Designer Look Distance, dormant Auto without a Surface, Surface-size recalculation, manual mode, external override debounce, and `designer`/`rounded`/fixed rotation modes.
- [ ] Add a failing generated-script test that binding verifies both `Projector.screens` and `Screen2.projectors` without assigning either collection.
- [ ] Run focused tests and verify expected failures.
- [ ] Implement Auto UI/state, narrow derived writes, rotation finalization, and bidirectional binding verification.
- [ ] Run focused tests and confirm they pass.
- [ ] Commit the optics and binding change.

### Task 4: DMX Device-List Deletion And Version

**Files:**
- Modify: `scene-planner-prototype/designer-adapter.js`
- Modify: `scene-planner-prototype/app.js`
- Modify: `scene-planner-prototype/index.html`
- Modify: `package.json`
- Modify: `tests/lifecycle-release.test.cjs`
- Modify: `tests/scene-planner.test.cjs`
- Modify: `ARCHITECTURE.md`
- Modify: `DECISIONS.md`
- Modify: `ERROR_LOG.md`
- Modify: `TESTING.md`

**Interfaces:**
- Consumes: Task 1 phase logging.
- Produces: phase-specific FixtureGroup cleanup result and canonical product version display.

- [ ] Add a failing cleanup contract test for FixtureGroup Stage detach, Stage save, dependency inspection, `saveOnDelete`, resource removal, and phase-specific failure reporting.
- [ ] Add failing UI assertions for `v0.21.0` title and cache keys.
- [ ] Run lifecycle and scene tests and verify expected failures.
- [ ] Implement the narrow FixtureGroup cleanup correction without changing FixtureGroup creation; update version and documentation.
- [ ] Run `npm run release-check` and the composite dry-run diagnostic.
- [ ] Deploy to `D:\Disguise\Projects\scenegen4\plugins\scene-planner-prototype`, verify file hashes, and commit the release candidate.

