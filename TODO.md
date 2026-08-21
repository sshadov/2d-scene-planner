# Roadmap and Technical Debt

## Current backlog - 2026-08-22

### P0 Designer regressions

- Remove the startup-wide `resourceManager.saveAll()` call. It attempts to write `internal/gui/stickymanager.json` while the Planner `Widget` is open and produces `Access to object of type 'Widget' is not allowed`. Startup must remain read-only until the user performs an explicit scene operation; object and Stage operations keep their scoped saves.
- Fix numeric wheel and `ArrowUp`/`ArrowDown` editing for every object type. Each tick must update local state and the UI immediately, send the latest value through LIVE without the current 150 ms debounce, and never start a Python `commitFieldChange()`. Cancel the previous pending final commit on every tick, then send exactly one Python commit with the current settled state 500 ms after the last tick. Enter/blur must cancel the pending timer and commit once immediately; deleting an object must cancel its pending commits. Add deterministic tests proving that 40 rapid ticks produce one final Python commit, stale or out-of-order HTTP/LIVE readback cannot roll back the latest value, and changing screen height does not move its bottom edge.
- Investigate and eliminate the r34.0.3 Display creation error `ProjectorEditor.handleStageDisplaysChanged -> Access to object of type 'ArrayBox' is not allowed`. Reproduce LED Screen, DMX Screen, and Surface separately in a disposable project; correlate the Planner operation ID with Designer console time; verify the official Stage creation contract or an exact-version probe before changing `loadOrCreate`/typed-collection behavior. Successful creation must not leave a Designer console exception.
- Synchronize Designer-side resolution changes back into Planner for LED Screen, DMX Screen, and Surface. Changing `Display.resolution.x/y` in Designer must update the corresponding Planner fields without a restart. Confirm the exact LIVE property subscription/readback contract with an exact-version probe before implementation if the installed API does not expose it clearly.

### P1 Interaction

- Restore the rotation handle on the 2D scene for the selected object. Screens/surfaces rotate around Designer Y; cameras and DMX lights update yaw; Projector rotation must move Look At around Position rather than write unrelated body rotation.
- Add one compact row of six icon-only alignment commands to the right-click context menu: plan-horizontal left/centre/right and plan-vertical top/centre/bottom. The plan vertical axis is Designer Z. Edge alignment must account for the rotated object's visible bounds; centre alignment uses the Stage centre. Use clear alignment icons and tooltips, with no text buttons.

### P1 Projector model

- Restore Projector resolution X/Y in the inspector and in create/update/readback/import. This is a supported public contract: `Projector` inherits `Display.resolution`, and official documentation explicitly uses `projector.resolution = Vec2(3840, 2160)`. Projector resolution must feed aspect-ratio and throw-ratio calculations.
- Fix FOV calculation for portrait/vertical bound screens. Validate it independently from throw ratio and verify the resulting Designer value and 2D beam against equivalent landscape and portrait fixtures. Do not calculate when no surface is bound.
- Fix throw-ratio calculation for portrait/vertical bound screens. Validate the exact orientation-aware projected-width and projector-aspect formula independently from FOV. Do not calculate when no surface is bound.
- Rotate Projector roll to 90 degrees only for portrait bound screens and validate the final orientation separately from the FOV and throw-ratio fixes.

### P1 Deletion policy

- Remove `Delete from Device list` for DMX Light. DMX Light deletion from Planner must detach the exact `FixtureGroup` from `stage.dmxLights` only; neither owned nor imported DMX Lights may invoke main-resource or auxiliary Device List removal from this UI.

## v10.4 completed

- Stage checkbox and managed Designer cube are implemented through `d3.Object` mesh geometry copied from a supported Designer helper topology.
- Startup import now treats the open Designer project as authoritative and filters internal/non-physical helpers.
- Projector readback accepts Designer-derived Look At, rotation, look distance, and field of view; the Planner writes only the public config contract. Scene-relative height uses `floorY`.
- Stage movement is numeric-only and projector target surfaces are highlighted on the plan.
- Look At selection previews surface highlights before commit; missing Designer objects are not resurrected; resource names are synchronized without `dsg-` paths.

## Confirmed user requests not fully implemented

- Presets: save the current plan with a name, load it later, duplicate it, import/export it, and delete it.
- Partial synchronization: one failed camera/light/projector must not stop the other object operations. Each failed object needs `Повторить` and `Принять Designer` actions.
- Designer cleanup mode: make the meaning of explicit deletion of selected recognized default objects in the open Designer scene clear in the UI and documentation.
- External edits: inspect changed or deleted Designer objects and offer `Принять Designer` or `Повторить`, without overwriting unrelated manual changes.
- LIVE media coverage: add richer media-property bindings only where the installed Designer exposes a verified writable contract.
- Fast alignment tools: equal distance from an edge, equal spacing between objects, center alignment, distribute, and dimension-aware snapping need a dedicated interaction pass.
- Device detail: projector lens-shift binding, camera sensor/FOV/frustum, podium anchors, and screen cabinet/module presets are not part of the current model. Throw ratio and Designer-derived field of view are already supported.

## Next product functions

- Preset manager: save, name, import, duplicate, and delete plans.
- Editable object names and non-planar physical dimensions.
- Podium object and resolved vertical anchors using podium geometry.
- Projector lens presets, throw ratio, lens offset, and projector-to-lens binding.
- Camera sensor/lens presets, field of view, target, and frustum visualization.
- LED cabinet/module presets and automatic screen assembly.
- Distribution, dimension-aware edge snapping, grouping, duplication, and multi-selection.
- Stage walls, origin, audience area, truss, and scenic models.

## Integration work

- Verify concrete Designer resource classes and collection mutation on supported Designer versions.
- Add transaction/rollback when the API exposes a supported transaction boundary.
- Persist a stronger project/stage fingerprint when Designer exposes one.
- Reconcile mappings when Designer objects are renamed, moved, or deleted externally.
- Replace name heuristics for defaults with versioned known-default signatures.

## Engineering

- Extract pure scene/diff functions into testable modules.
- Add browser-level drag and modal tests alongside the coordinate/diff unit suite.
- Add browser-level pointer tests for click-without-drag, target dragging, and the no-Ctrl-drag duplication contract.
- Add integration test harness around mock Python API fixtures.
- Add preset schema migrations and explicit import validation.
- Add accessible inline errors instead of browser `confirm` when the cleanup flow is redesigned.
