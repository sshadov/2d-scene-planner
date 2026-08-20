# Stage Sync And Projector Geometry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make device lifecycle, Stage reconciliation, field focus, free placement, screen yaw, and projector geometry deterministic.

**Architecture:** Keep lifecycle in `designer-adapter.js`, local model/interaction in `app.js`, and use explicit UID/path bindings as the merge key. Add pure projector geometry helpers to `app.js`; the adapter only translates those values to documented Designer properties and reads confirmed values back.

**Tech Stack:** JavaScript, embedded Designer Python scripts, official Live Update WebSocket, Node contract tests.

**Spec:** `docs/superpowers/specs/2026-08-20-stage-sync-and-projector-geometry-design.md`

## Global Constraints

- LIVE never creates or deletes resources.
- Typed Stage collections are mutated in place; never replace an `ArrayBox` property.
- Scene bounds never clamp pointer movement.
- Projector Surface binding uses public `Projector.screens`/`addScreen`.
- Every production change follows a red-green test cycle.

---

### Task 1: Stable Explicit Creation And Import

**Files:** `scene-planner-prototype/app.js`, `scene-planner-prototype/designer-adapter.js`, `tests/scene-planner.test.cjs`, `tests/lifecycle-release.test.cjs`

**Interfaces:** Preserve confirmed `sync.objects[pluginId]` records by exact UID/path during passive import; return complete typed-membership readback from create.

- [ ] Add failing tests for an intermediate empty Stage snapshot after successful Camera/DMX Light creation.
- [ ] Verify the tests fail because the bound Planner objects disappear.
- [ ] Merge confirmed bindings during passive import without creating resources or retaining truly deleted unbound objects.
- [ ] Verify focused lifecycle and scene-planner tests pass.

### Task 2: Safe DMX Light Resource Cleanup

**Files:** `scene-planner-prototype/designer-adapter.js`, `scripts/diagnose-composite-devices.py`, `tests/lifecycle-release.test.cjs`, `tests/diagnose-composite-devices.test.cjs`

**Interfaces:** Detach exact FixtureGroup from `stage.dmxLights`, save/verify Stage, remove owned DirectProjection/dependencies before the main package resource, and report per-path failures.

- [ ] Add a failing generated-script test for DMX-specific dependency ordering and residue verification.
- [ ] Verify it fails against the generic cleanup order.
- [ ] Implement FixtureGroup cleanup using only documented/discovered owned references.
- [ ] Run dry-run diagnostics and lifecycle tests.

### Task 3: Focus, Selection Highlight, And Free Drag

**Files:** `scene-planner-prototype/app.js`, `tests/scene-planner.test.cjs`

**Interfaces:** `selectObject()` highlights selected Surfaces; pointer movement accepts finite world coordinates outside Stage bounds; pending focus belongs to a pluginId/path pair.

- [ ] Add failing tests for Surface outline state, unclamped object/group/Look At movement, and focus preservation.
- [ ] Implement minimal selection, drag, and focus changes.
- [ ] Run scene-planner tests and local UI inspection.

### Task 4: Screen Yaw Commit

**Files:** `scene-planner-prototype/designer-adapter.js`, `tests/lifecycle-release.test.cjs`

**Interfaces:** Screen create/update saves the final rotation after typed Stage attachment and returns matching readback.

- [ ] Add a failing contract test that detects the missing post-attachment yaw commit.
- [ ] Implement the final dirty/save/readback sequence without changing the requested yaw.
- [ ] Run lifecycle and readback tests.

### Task 5: Standalone Projector Geometry

**Files:** `scene-planner-prototype/app.js`, `tests/scene-planner.test.cjs`

**Interfaces:** Pure helpers calculate 3D direction, distance, projected width, throw ratio, field of view, and `0/90` roll. Editing look distance updates Look At along the existing vector.

- [ ] Add literal geometry fixtures for horizontal and vertical Surfaces.
- [ ] Verify failures for stale distance/ratio/FOV and non-editable look distance.
- [ ] Implement pure calculations and recalculate dependents on Position, Look At, Surface dimensions, Surface binding, and Projector resolution changes.
- [ ] Run scene-planner tests.

### Task 6: Designer Projector Contract And LIVE

**Files:** `scene-planner-prototype/designer-adapter.js`, `tests/projector-contract.test.cjs`, `tests/live-state-machine.test.cjs`, `tests/lifecycle-release.test.cjs`

**Interfaces:** Python updates `Projector.screens`, `configPosition`, `configLookAt`, `configLookDistance`, `configThrowRatio`, then final `configRotation.z`; LIVE reads all derived values and sends only writable explicit changes.

- [ ] Add failing HTTP/generated-script and WebSocket protocol tests for Surface binding, look-distance readback/write, FOV readback, and final roll.
- [ ] Implement the explicit update and readback order.
- [ ] Verify no echo or automatic creation occurs.
- [ ] Run projector, LIVE, lifecycle, and full tests.

### Task 7: Documentation, Review, And Deployment

**Files:** `ARCHITECTURE.md`, `DECISIONS.md`, `ERROR_LOG.md`, `TESTING.md`, `docs/knowledge/disguise-sources.md`, `scene-planner-prototype/index.html`

**Interfaces:** Cache-buster identifies the deployed files; documentation matches tested behavior.

- [ ] Update documentation and cache-busters.
- [ ] Run `npm run release-check` and `python scripts/diagnose-composite-devices.py --dry-run`.
- [ ] Request final code review and fix actionable findings.
- [ ] Deploy to `D:\Disguise\Projects\scenegen4` and verify SHA-256 hashes.
- [ ] Commit the completed implementation.
