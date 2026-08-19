# Composite Designer Device Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace bare Camera/Projector creation with validated, transactional Designer resource graphs while preserving simple-display and Live Update behavior.

**Architecture:** Keep `designer-adapter.js` as the adapter boundary, but generate separate Python builders for simple displays/DMX lights, cameras, and projectors. Builders share path/class conflict checks, health validation, Stage attachment, and reverse-order rollback; deletion detaches typed Stage references before removing package resources.

**Tech Stack:** Plain JavaScript source generation, Designer Python API (`d3.pyi`), Node.js tests, HTTP Execution API, WebSocket Live Update.

**Spec:** `docs/superpowers/specs/2026-08-19-composite-device-lifecycle-design.md`

## Global Constraints

- Never report a bare `Camera` or bare `Projector` as a successful creation.
- Keep one Live Update WebSocket and do not change its wire protocol.
- Never mutate or delete the user's manually created `1`, `2`, or `3` sample resources.
- Use typed Stage collections; Stage removal precedes package removal.
- Existing wrong-class conflicts must return a clear error and must not be passed to `loadOrCreate`.
- Designer remains authoritative for projector derived rotation, look distance, and field of view.
- Every production change follows a failing-test-first cycle.

---

### Task 1: Define failing generated-script contracts

**Files:** `tests/lifecycle-release.test.cjs`, `tests/scene-planner.test.cjs`

- [ ] **Step 1: Add red assertions.** Assert that camera scripts contain `PerspectiveProjection`, `PerspectiveProjectionObject`, `projection_object.projection = projection`, `obj.add(projection_object)`, `obj.isBad`, and `rollback`; projector scripts contain `ProjectorConfig`, `obj.config`, and health/rollback checks; simple scripts contain `createSimpleDisplay` and no projection child; delete scripts contain typed collection removal and Stage-save-before-resource-remove ordering.
- [ ] **Step 2: Run `node tests/lifecycle-release.test.cjs` and `node tests/scene-planner.test.cjs`.** Confirm failure is caused by the current single bare-resource branch.
- [ ] **Step 3: Commit red tests:** `git add tests/lifecycle-release.test.cjs tests/scene-planner.test.cjs; git commit -m "test: define composite Designer device contract"`.

### Task 2: Centralize conflict, health, rollback, and simple creation

**Files:** `scene-planner-prototype/designer-adapter.js`, `tests/lifecycle-release.test.cjs`

**Interfaces:** Produce generated Python helpers `resource_class(path)`, `allocate_path(folder, base_name, expected_class)`, `assert_healthy(resource, label)`, `rollback(created_paths, stage, attached, collection)`, and `createSimpleDisplay(payload)`.

- [ ] **Step 1: Implement the minimal helpers after the red test.** `resource_class` loads with `Resource` and returns `type(...).__name__`; `allocate_path` checks both `resourceManager.exists(Path(path))` and `package.findAllBeginsWith`; mismatched explicit classes raise `RuntimeError("existing resource class conflict: ...")` before `loadOrCreate`.
- [ ] **Step 2: Implement health/rollback.** `assert_healthy` rejects `isBad`, `isIncomplete`, or `isInError`; rollback removes only paths created in this operation, detaches the typed collection item, saves Stage, and processes paths in reverse order.
- [ ] **Step 3: Move current screen, DMX screen, surface, and DMX light transform assignments into `createSimpleDisplay` without changing their public readback shape.
- [ ] **Step 4: Run `node tests/lifecycle-release.test.cjs` and `node tests/scene-planner.test.cjs`; commit green work with `git commit -m "refactor: centralize Designer lifecycle helpers"`.

### Task 3: Create a valid composite Camera

**Files:** `scene-planner-prototype/designer-adapter.js`, `tests/lifecycle-release.test.cjs`

- [ ] **Step 1: Add a focused red assertion for named camera, projection, and projection-object paths plus `stage.cameras.append` and child-count validation; run the focused test and confirm failure.
- [ ] **Step 2: Implement generated `createCamera(payload)`: construct `Camera()`, `PerspectiveProjection()`, and `PerspectiveProjectionObject()`; assign unique paths under `objects/camera/` and `objects/perspectiveprojectionobject/`; set `projection_object.projection = projection`; call `camera.add(projection_object)`; assign `offset`/`rotation`; save all resources; append to `stage.cameras`; save Stage; assert health and exactly one projection child; return existing readback.
- [ ] **Step 3: On every exception call Task 2 rollback, retaining existing resources. Run `node tests/lifecycle-release.test.cjs` and `npm test`; commit `feat: create valid composite Designer cameras`.

### Task 4: Create a valid composite Projector

**Files:** `scene-planner-prototype/designer-adapter.js`, `tests/lifecycle-release.test.cjs`, `tests/projector-contract.test.cjs`

- [ ] **Step 1: Add red assertions for `ProjectorConfig()` and `objects/projectorconfig/`; assert the create script does not write inherited body `offset`, `rotation`, or `configRotation`; run focused tests and confirm failure.
- [ ] **Step 2: Implement generated `createProjector(payload)`: construct `Projector()` and `ProjectorConfig()`; assign unique paths; set `obj.config = config`; write only `configPosition`, `configLookAt`, and `configThrowRatio`; save config/object; append to `stage.projectors`; save Stage; assert both resources healthy; return Designer optical readback.
- [ ] **Step 3: Add rollback on all failures. Run `node tests/lifecycle-release.test.cjs`, `node tests/projector-contract.test.cjs`, and `npm test`; commit `feat: create valid composite Designer projectors`.

### Task 5: Harden two-phase deletion and conflicts

**Files:** `scene-planner-prototype/designer-adapter.js`, `tests/lifecycle-release.test.cjs`, `ERROR_LOG.md`

- [ ] **Step 1: Add red ordering assertions for `typed_collection`, Stage save, and auxiliary `resource_paths`; run the focused test and confirm failure.
- [ ] **Step 2: Resolve each target by UID/path, remove it from its exact typed Stage collection, save Stage once, then remove the main and recorded auxiliary resources. Preserve standard samples and scene cube. Do not rely on package removal alone.
- [ ] **Step 3: Add `ERR-051` documenting bare composite resources, missing Device-list entries, native projector crashes, and the two-phase fix.
- [ ] **Step 4: Run `npm test` and `git diff --check`; commit `fix: detach Stage devices before removing resources`.

### Task 6: Validate against `scenegen2`

**Files:** `scripts/diagnose-composite-devices.py` (diagnostic only), `TESTING.md`

- [ ] **Step 1: Create a diagnostic script using the Designer Execution API that creates only `dsg-smoke-*` camera/projector/DMX-Light resources, checks typed collection membership and health, checks the camera child and projector config, then deletes typed references before package resources.
- [ ] **Step 2: Run it against active `scenegen2` and stop on any native exception. Verify no `dsg-smoke-*` paths remain and the manual `1`, `2`, `3` samples are unchanged.
- [ ] **Step 3: Document the command and expected checks in `TESTING.md`.
- [ ] **Step 4: Run `npm test`, `git diff --check`, and `git status --short`; confirm only intended files remain.
