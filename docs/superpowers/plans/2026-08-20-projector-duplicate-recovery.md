# Projector Duplicate Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent repeat Projector creation, restore mouse-first Look At placement, and make previously imported Planner objects explicitly removable from Designer.

**Architecture:** Treat a successful Designer create response as the identity boundary: persist UID, path, and validated ownership before numeric readback. Readback remains a quality gate with a `0.001 m` tolerance, but can never erase identity or trigger another create. Imported deletion uses the exact selected UID/path and discovers only that resource's actual dependencies after the Stage reference has been removed and saved.

**Tech Stack:** Plain JavaScript, generated Designer Python API scripts, Node.js contract tests, Python Execution API, Live Update WebSocket.

**Spec:** `docs/superpowers/specs/2026-08-19-composite-device-lifecycle-design.md`

## Global Constraints

- Readback tolerance is exactly `0.001 m`.
- A returned Designer UID/path must be persisted before readback validation.
- No readback failure may cause a second create request.
- Resource removal occurs only after typed Stage detachment and successful `stage.save()`.
- Imported deletion requires explicit UI confirmation and exact UID/path matching.
- A newly added Projector is not created in Designer until its Look At point is committed.

---

### Task 1: Protect creation identity

**Files:** `scene-planner-prototype/app.js`, `tests/scene-planner.test.cjs`

- [x] Add failing boundary tests for readback drift below and above `0.001 m`.
- [x] Add a failing two-pass LIVE test proving a returned UID survives readback failure.
- [x] Persist UID/path/ownership before validation and verify the second pass does not call create.

### Task 2: Restore Projector target placement

**Files:** `scene-planner-prototype/app.js`, `tests/scene-planner.test.cjs`

- [x] Add a failing test for temporary Look At placement and deferred height focus.
- [x] Update Look At from pointer movement without scheduling LIVE.
- [x] Commit on primary click, schedule one sync, and focus `transform.position.y`.

### Task 3: Delete exact imported resources

**Files:** `scene-planner-prototype/app.js`, `scene-planner-prototype/designer-adapter.js`, `tests/lifecycle-release.test.cjs`, `tests/scene-planner.test.cjs`

- [x] Add a failing exact UID/path deletion contract.
- [x] Route confirmed imported deletion through dependency discovery and two-phase Stage/resource removal.
- [x] Keep incomplete ownership records protected from managed physical deletion.

### Task 4: Release validation

**Files:** `package.json`, `scene-planner-prototype/index.html`, `CHANGELOG.md`, `ERROR_LOG.md`, `TESTING.md`, `scene-planner-prototype/README.md`

- [x] Bump release and cache-buster versions.
- [x] Run `npm run release-check`.
- [x] Deploy to `D:\Disguise\Projects\scenegen2` and run disposable composite smoke tests.
- [ ] Manually verify add Projector, commit Look At, change its Surface, and confirm no duplicate appears in the embedded Designer window.
