# Lifecycle hardening implementation plan

## Scope and invariants

- Keep Designer authoritative at startup and during LIVE imports.
- Serialize Create and Delete per `pluginId`: a Delete requested during Create waits for the exact returned UID/path and then performs the requested Designer operation.
- Stage-only Delete removes the exact object from its typed Stage collection, saves Stage, and verifies absence.
- Device List Delete additionally removes the exact main Resource for both Planner-created and imported objects.
- Ownership is only a hint for validated Planner-created auxiliary cleanup. Missing ownership metadata never blocks Stage detach or main Resource removal.
- Imported objects never trigger automatic dependency traversal. FixtureGroup DirectProjection cleanup is optional and only allowed for a validated, named, single-target projection owned by the deleted FixtureGroup.
- Remove Undo/Redo completely. Keep copy/paste.
- Incomplete Designer inspection never replaces the last complete Planner scene.
- LIVE uses one connecting/reconnecting/open lifecycle and always subscribes objects after readiness.
- Resolution is exposed only where a documented or probed Designer property is confirmed. Otherwise controls are hidden and the missing probe is documented.
- A Create that returned UID/path is `created` even if ownership/readback is degraded. Only pre-identity transport/remote failure is `failed`.
- Do not change projector Position / Look At / Look Distance / Throw Ratio / FOV / Rotation behavior.

## Test-first sequence

1. Add a deferred-Create regression and run `node tests/scene-planner.test.cjs` to prove Delete currently loses the remote object.
2. Replace dangerous delete traversal expectations with owned/imported x Stage-only/Device-list behavioral cases, incomplete ownership, and FixtureGroup sole/shared/unrelated dependency cases. Run `node tests/lifecycle-release.test.cjs` RED then GREEN.
3. Add DOM/source assertions for complete Undo/Redo removal, then remove state, handlers, call sites, markup, CSS, docs, and obsolete expectations.
4. Add incomplete-inspection startup/LIVE import tests; return `complete/errors` from inspection and reject partial imports.
5. Add MockWebSocket initial failure -> reconnect -> subscription coverage; fix readiness scheduling and visible connection state.
6. Confirm resolution properties from repository docs/probe artifacts. Implement only confirmed round trips or hide controls and document the exact probe.
7. Add created/degraded versus true failed Create tests and implement explicit record state without duplicate retries.

## Verification

- Focused tests after every RED/GREEN step.
- `npm run release-check`
- `python scripts/diagnose-composite-devices.py --dry-run`
- `git diff --check`
- Confirm no deployment or edits under `D:\Disguise\Projects\scenegen4`.
- Commit all lifecycle-hardening changes as one commit after `0c6f4f4`.
