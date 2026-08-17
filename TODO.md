# Roadmap and Technical Debt

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
- Add integration test harness around mock Python API fixtures.
- Add preset schema migrations and explicit import validation.
- Add accessible inline errors instead of browser `confirm` when the cleanup flow is redesigned.
