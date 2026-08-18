# Roadmap and Technical Debt

## v10.4 completed

- Stage checkbox and managed Designer cube are implemented through `d3.Object` mesh geometry copied from a supported Designer helper topology.
- Startup import now treats the open Designer project as authoritative and filters internal/non-physical helpers.
- Projector readback preserves Designer optical rotation; scene-relative height uses `floorY`.
- Stage movement is numeric-only and projector target surfaces are highlighted on the plan.
- Look At selection previews surface highlights before commit; missing Designer objects are not resurrected; resource names are synchronized without `dsg-` paths.

## Confirmed user requests not fully implemented

- Presets: save the current plan with a name, load it later, duplicate it, import/export it, and delete it.
- Partial synchronization: one failed camera/light/projector must not stop the other object operations. Each failed object needs `Повторить` and `Принять Designer` actions.
- Designer cleanup mode: make the meaning of `Очистить сцену` explicit. The local planner clear button is implemented; a separate confirmed command is still needed for deleting selected recognized default objects in the open Designer scene.
- External edits: inspect changed or deleted Designer objects and offer `Принять Designer` or `Повторить`, without overwriting unrelated manual changes.
- LIVE transport: add reconnect/backoff and richer media-property bindings to the implemented WebSocket `ws://<director>/api/session/liveupdate` adapter.
- Fast alignment tools: equal distance from an edge, equal spacing between objects, center alignment, distribute, and dimension-aware snapping need a dedicated interaction pass.
- Device detail: projector lens/throw-ratio/lens-shift binding, camera sensor/FOV/frustum, podium anchors, and screen cabinet/module presets are not part of the current model.

## Next product functions

- Preset manager: save, name, import, duplicate, and delete plans.
- Editable object names and non-planar physical dimensions.
- Podium object and resolved vertical anchors using podium geometry.
- Projector lens presets, throw ratio, lens offset, and projector-to-lens binding.
- Camera sensor/lens presets, field of view, target, and frustum visualization.
- LED cabinet/module presets and automatic screen assembly.
- Distribution, dimension-aware edge snapping, grouping, duplication, and multi-selection.
- Room walls, stage origin, audience area, truss, and scenic models.

## Integration work

- Verify concrete Designer resource classes and collection mutation on supported Designer versions.
- Add transaction/rollback when the API exposes a supported transaction boundary.
- Persist a stronger project/stage fingerprint when Designer exposes one.
- Reconcile mappings when Designer objects are renamed, moved, or deleted externally.
- Replace name heuristics for defaults with versioned known-default signatures.

## Engineering

- Extract pure scene/diff functions into testable modules.
- Add browser-level drag and modal tests alongside the coordinate/diff unit suite.
- Add browser-level pointer tests for click-without-drag and Ctrl-drag duplication.
- Add integration test harness around mock Python API fixtures.
- Add preset schema migrations and explicit import validation.
- Add accessible inline errors instead of browser `confirm` when the cleanup flow is redesigned.
