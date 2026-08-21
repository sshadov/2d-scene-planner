# Final-State LIVE Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Scene Planner `0.22.0` with latest-value projector synchronization, Designer-authoritative membership, guarded automatic LIVE startup, one diagnostic stream, and a simple FixtureGroup deletion path.

**Architecture:** Replace projector acknowledgement phases with a per-projector cadence/final timer scheduler. Keep Designer typed Stage collections and LIVE subscriptions as the source of scene membership, but preserve only explicit creates while their HTTP operation is pending. Isolate FixtureGroup physical removal from composite dependency cleanup.

**Tech Stack:** Browser JavaScript, Canvas 2D, Disguise Python Execution API, Disguise Live Update WebSocket, Node.js contract tests, PowerShell deployment.

**Spec:** `docs/superpowers/specs/2026-08-21-final-state-live-sync-design.md`

## Global Constraints

- Product version is exactly `0.22.0`; state schema version `11` remains internal.
- Projector cadence is at most one send every `40 ms`; the final resend occurs `500 ms` after the last change.
- Bound Projectors send current Position, Look At, and calculated Throw Ratio together; unbound Projectors send only Position and Look At.
- Look Distance and Field of View never trigger writes.
- Rotation Z is written only after the final delay and is exactly `0` or `90` based on Surface orientation.
- Do not add projector controls, acknowledgement/revision gates, periodic resource verification, or automatic creation from reconciliation.
- No external Designer project is mutated by automated tests.

---

### Task 1: Replace The Projector Acknowledgement Cycle

**Files:**
- Modify: `scene-planner-prototype/app.js`
- Modify: `scene-planner-prototype/designer-adapter.js`
- Modify: `tests/scene-planner.test.cjs`
- Modify: `tests/live-state-machine.test.cjs`
- Modify: `tests/projector-contract.test.cjs`

**Interfaces:**
- Consumes: `effectiveLookAt()`, `projectorProjectedWidth()`, `projectorsAffectedBy()`, adapter LIVE bindings, and `updateProjectorRotationZ()`.
- Produces: `queueProjectorProjection(object, source)`, `flushProjectorProjection(object, source, final)`, `cancelProjectorWork(pluginId)`, and adapter `liveSetProjectorProjection(pluginId, position, lookAt, throwRatio?)`.

- [ ] **Step 1: Write failing behavior tests**

Add real harness cases with hand-derived values:

```js
// Position (0,3,-12), Look At (0,1,0), horizontal 8x4 Surface.
// distance = sqrt(148), projected width = 8, ratio = 1.521.
assert.equal(core.projectorAutoThrowRatio(projector), 1.521);

// Rapid moves coalesce to fresh values; final write and roll use final state.
assert.deepEqual(writes.at(-1), {
  pluginId: "projector-1",
  position: { x: 3, y: 3, z: -12 },
  lookAt: { x: 0, y: 1, z: 0 },
  throwRatio: 1.568
});
assert.equal(rotationWrites.at(-1).value, 0);
```

Cover no Surface, vertical Surface producing `90`, cancellation, incoming Position/Look At, and Surface geometry. Assert incoming Look Distance/FOV make zero writes.

- [ ] **Step 2: Run focused tests and verify failure**

```powershell
node tests/scene-planner.test.cjs
node tests/live-state-machine.test.cjs
node tests/projector-contract.test.cjs
```

Expected: missing atomic setter and obsolete Look Distance/FOV sequencing failures.

- [ ] **Step 3: Implement the atomic adapter write**

Make Throw Ratio writable; keep FOV, Look Distance, and roll read-only. Add and export:

```js
function liveSetProjectorProjection(pluginId, position, lookAt, throwRatio) {
  const values = { "transform.position": position, lookAt };
  if (Number.isFinite(Number(throwRatio))) values["optics.throwRatio"] = Number(throwRatio);
  return liveSetProjectorFields(pluginId, values);
}
```

- [ ] **Step 4: Implement cadence and final resend**

Replace cycle maps with:

```js
const PROJECTOR_LIVE_INTERVAL_MS = 40;
const PROJECTOR_FINAL_DELAY_MS = 500;
const projectorPending = new Map();
```

Records hold `lastSentAt`, `cadenceTimer`, `finalTimer`, and `generation`. Each flush locates current state by `pluginId`. Bound Projectors calculate direct Position-to-Look-At distance, Throw Ratio, and display-only FOV:

```js
const fov = 2 * Math.atan(projectedWidth / (2 * throwDistance)) * 180 / Math.PI;
```

Final flush repeats current values and then invokes narrow Rotation Z if generation remains current. Remove Auto/manual modes, phase handlers, correction flash, and FOV-triggered rotation.

- [ ] **Step 5: Route relevant mutations to the queue**

Queue after local Projector/Surface movement, committed fields, binding completion, and non-initial Designer Position/Look At/Surface changes. Initial subscription values only update the model. Cancellation clears timers and invalidates generation.

- [ ] **Step 6: Run focused and complete tests**

```powershell
node tests/scene-planner.test.cjs
node tests/live-state-machine.test.cjs
node tests/projector-contract.test.cjs
npm test
```

Expected: all exit `0` and no old phase assertion remains.

- [ ] **Step 7: Commit**

```powershell
git add scene-planner-prototype/app.js scene-planner-prototype/designer-adapter.js tests/scene-planner.test.cjs tests/live-state-machine.test.cjs tests/projector-contract.test.cjs
git commit -m "fix: simplify projector live synchronization"
```

---

### Task 2: Make Startup And Stage Membership Designer-Authoritative

**Files:**
- Modify: `scene-planner-prototype/index.html`
- Modify: `scene-planner-prototype/styles.css`
- Modify: `scene-planner-prototype/app.js`
- Modify: `scene-planner-prototype/designer-adapter.js`
- Modify: `tests/scene-planner.test.cjs`
- Modify: `tests/lifecycle-release.test.cjs`

**Interfaces:**
- Consumes: `pendingDesignerCreates`, `importDesignerScene()`, `/api/session/transport/activetransport`, and `resourceManager.saveAll()`.
- Produces: adapter `activeTransportStatus()`, adapter `saveAllResources()`, and startup `runStartupGate()`.

- [ ] **Step 1: Write failing startup and reconciliation tests**

```js
assert.deepEqual(core.state.objects.map(item => item.pluginId), ["designer-a"]);
assert.deepEqual(pendingCase.state.objects.map(item => item.pluginId).sort(), ["designer-a", "pending-create"]);
```

Test `Stop`, `Play`, `PlaySection`, `Loop`, malformed transport response, and failed request. Assert no import/save/LIVE before acceptance and no mutation after `Close`.

- [ ] **Step 2: Run focused tests and verify failure**

```powershell
node tests/scene-planner.test.cjs
node tests/lifecycle-release.test.cjs
```

Expected: stale local membership remains and adapter methods are absent.

- [ ] **Step 3: Add transport and save adapter operations**

GET `/api/session/transport/activetransport`; `Play`, `PlaySection`, and `Loop` mean running. Request/schema failure returns `{ known: false, running: false, transports: [] }` and logs the error.

Execute best-effort save with:

```python
saved = resourceManager.saveAll()
return json.dumps({"saved": int(saved)})
```

- [ ] **Step 4: Add blocking startup warning and automatic LIVE**

Add one modal with `I accept responsibility` and `Close`. Show it for running or unknown transport. Remove the LIVE checkbox. After stopped status or acceptance: save, fresh import, automatic LIVE start. Standalone preview stays non-LIVE.

- [ ] **Step 5: Reset hosted startup state and reconcile membership**

Inside Designer do not restore objects, selections, history, sync/deleted records, last heights, or LIVE state from localStorage. Runtime reconciliation replaces membership with Designer inspection plus only objects currently in `pendingDesignerCreates`.

- [ ] **Step 6: Fix same-type sequential names**

Parse `^(.*?)(?:\s+(\d+))$` and increment the numeric suffix until both the typed Stage collection and package path are free. `Projector 6` advances to the first free `Projector N`, never `Projector 6 2`; other types do not collide.

- [ ] **Step 7: Run tests and commit**

```powershell
node tests/scene-planner.test.cjs
node tests/lifecycle-release.test.cjs
npm test
git add scene-planner-prototype/index.html scene-planner-prototype/styles.css scene-planner-prototype/app.js scene-planner-prototype/designer-adapter.js tests/scene-planner.test.cjs tests/lifecycle-release.test.cjs
git commit -m "feat: make Designer authoritative at startup"
```

---

### Task 3: Consolidate Diagnostics And Remove Active Error UI

**Files:**
- Modify: `scene-planner-prototype/index.html`
- Modify: `scene-planner-prototype/styles.css`
- Modify: `scene-planner-prototype/app.js`
- Modify: `scene-planner-prototype/designer-adapter.js`
- Modify: `tests/scene-planner.test.cjs`

**Interfaces:**
- Consumes: Planner, adapter operation, and adapter LIVE log arrays.
- Produces: one chronological `diagnosticsLogs()`, renderer, and copy source.

- [ ] **Step 1: Write a failing chronological diagnostics test**

Interleave fixed timestamps and assert rendered/copied order `planner-a`, `api-b`, `live-c`, `planner-d`. Assert no red chip, LIVE log button/panel, or active-error counter. Error then success leaves both entries visible.

- [ ] **Step 2: Verify failure**

```powershell
node tests/scene-planner.test.cjs
```

- [ ] **Step 3: Implement one append-only stream**

Merge and timestamp-sort all three sources. Normalize display metadata while retaining each raw object. Copy the same complete array. Adapter appends notify the app with one callback or dispatched event so messages appear immediately.

Remove `state.sync.errors`, active-error functions, red chip, status counts, second panel, and CSS. Errors log and update connection text but never gate operations.

- [ ] **Step 4: Run tests and commit**

```powershell
node tests/scene-planner.test.cjs
npm test
git add scene-planner-prototype/index.html scene-planner-prototype/styles.css scene-planner-prototype/app.js scene-planner-prototype/designer-adapter.js tests/scene-planner.test.cjs
git commit -m "refactor: consolidate runtime diagnostics"
```

---

### Task 4: Simplify FixtureGroup Device-List Removal

**Files:**
- Modify: `scene-planner-prototype/designer-adapter.js`
- Modify: `tests/lifecycle-release.test.cjs`
- Modify: `tests/scene-planner.test.cjs`

**Interfaces:**
- Consumes: exact UID resolution and `removeResource` in `stageDeleteScript()`.
- Produces: FixtureGroup Stage detach/save and optional single main-resource removal.

- [ ] **Step 1: Write failing named/unnamed behavior tests**

```js
assert.deepEqual(named.stageDmxLights, []);
assert.deepEqual(named.removedPaths, ["objects/fixturegroup/dmx light 1.apx"]);
assert.equal(named.directProjectionInspectionCalls, 0);
assert.deepEqual(unnamed.removedPaths, []);
assert.match(unnamed.result.skipped.join("\n"), /unnamed/i);
```

Also assert unchecked deletion is Stage-only and Stage-save failure performs no resource removal.

- [ ] **Step 2: Run lifecycle test and verify failure**

```powershell
node tests/lifecycle-release.test.cjs
```

- [ ] **Step 3: Implement FixtureGroup-specific removal**

Capture `resource_path` before detach. After successful `stage.save()`:

```python
if remove_resource and resource_path:
    resourceManager.remove(Path(resource_path))
elif remove_resource:
    skipped.append("resource delete " + candidate_id + ": unnamed FixtureGroup")
```

FixtureGroup must not call ownership discovery, inbound-reference enumeration, `saveOnDelete()`, package probes, or dependency removal. Other types retain existing behavior.

- [ ] **Step 4: Run tests and commit**

```powershell
node tests/lifecycle-release.test.cjs
node tests/scene-planner.test.cjs
npm test
git add scene-planner-prototype/designer-adapter.js tests/lifecycle-release.test.cjs tests/scene-planner.test.cjs
git commit -m "fix: simplify DMX light resource deletion"
```

---

### Task 5: Release, Documentation, And Deployment

**Files:**
- Modify: `package.json`
- Modify: `scene-planner-prototype/index.html`
- Modify: `ARCHITECTURE.md`
- Modify: `docs/knowledge/README.md`
- Modify: `docs/knowledge/disguise-sources.md`
- Modify: `tests/scene-planner.test.cjs`

**Interfaces:**
- Consumes: Tasks 1-4.
- Produces: canonical `0.22.0` installed in `D:\Disguise\Projects\scenegen4\plugins\scene-planner-prototype`.

- [ ] **Step 1: Update release metadata**

Set package version, title, stylesheet query, and script queries to `0.22.0`; update exact release assertions.

- [ ] **Step 2: Update architecture and knowledge**

Document final-state projection, guarded automatic LIVE, authoritative membership, one diagnostics stream, and simple FixtureGroup lifecycle. Remove obsolete cycle and manual DirectProjection cleanup claims.

- [ ] **Step 3: Run complete verification**

```powershell
npm run release-check
python scripts/diagnose-composite-devices.py --dry-run
git status --short
```

Expected: checks exit `0`; status contains only intended release files.

- [ ] **Step 4: Commit release**

```powershell
git add package.json scene-planner-prototype/index.html ARCHITECTURE.md docs/knowledge/README.md docs/knowledge/disguise-sources.md tests/scene-planner.test.cjs
git commit -m "release: prepare scene planner 0.22.0"
```

- [ ] **Step 5: Deploy and verify hashes**

```powershell
pwsh -NoProfile -File scripts/deploy-plugin.ps1 -ProjectPath D:\Disguise\Projects\scenegen4
```

Compare SHA-256 for `index.html`, `styles.css`, `app.js`, and `designer-adapter.js` between worktree and installed plugin. Installed title must be `Disguise Scene Planner v0.22.0`.

- [ ] **Step 6: Record manual disposable-project checks**

The user checks: stopped-timeline startup, fresh import and automatic LIVE, moving bound Projector/Surface, beam/final values, Designer-side deletion propagation, named DMX deletion with and without Device-list option, and restart without stale Planner state. Automated work does not trigger physical Designer deletion.
