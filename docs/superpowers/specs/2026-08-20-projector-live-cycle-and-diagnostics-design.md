# Projector LIVE Cycle And Diagnostics Design

## Goal

Make projector synchronization deterministic inside Designer, expose one readable current-session diagnostic stream, isolate DMX Light Device-list deletion, and show one canonical product version.

## Authority

- Projector Position and Look At are bidirectional geometry inputs.
- Designer is authoritative for Look Distance and Field of View.
- Throw Ratio is Planner-authoritative when Auto is enabled and bidirectional when Auto is disabled.
- Projector Rotation Z follows `designer`, `rounded`, or a fixed `0`, `90`, `180`, or `270` degree mode.
- The Planner no longer maintains a separate standalone optical model.

## Projector Cycle

Every local Position or Look At change sends both values together through LIVE. Incoming Position or Look At from Designer starts the same cycle. The Planner coalesces rapid movement and waits for Designer's resulting Look Distance. With Auto Throw Ratio enabled and a bound Surface available, it calculates Throw Ratio from that Designer Look Distance and the projected Surface width, sends only Throw Ratio, waits for Designer Field of View, and finally applies Rotation Z policy.

Each Projector has one revisioned cycle. A newer geometry change cancels derived work from an older cycle. Own LIVE echoes confirm writes but do not start another cycle. No Python operation may rewrite Position, Look At, Look Distance, Throw Ratio, and Rotation together.

## Throw Ratio

Auto is enabled by default. It is dormant without a bound Projection Surface because no projection width exists. Surface size and Projector resolution changes restart the Auto cycle. While Auto is enabled, an external Throw Ratio change flashes the field once and is replaced after a short debounce by the calculated value. Own echoes do not flash. Disabling Auto makes Throw Ratio editable and sends only that value; Field of View remains Designer readback. Look Distance is read-only.

## Rotation Z

- `designer`: accept Designer Rotation Z and never write it.
- `rounded`: after optics settle, round Designer Rotation Z to the nearest quarter turn.
- fixed modes: write the selected quarter turn after optics settle.

Only `configRotation.z` may be written. X and Y remain untouched. `rounded` is the default.

## Surface Binding

Binding uses `Projector.addScreen(Screen2)` and unbinding uses `Projector.removeScreen(Screen2)`. The operation verifies both inverse views: the Surface is present in `Projector.screens` and the Projector is present in `Screen2.projectors`. The Planner never replaces either collection.

## Diagnostics And Errors

A persistent collapsible `Diagnostics` panel sits immediately above raw `LIVE diagnostics`. It shows timestamped, severity-coloured rows with subsystem, object, phase, and message. Projector cycle phases and DMX deletion phases are recorded explicitly. Raw protocol entries remain available below and both streams are included by Copy diagnostics.

The red error indicator represents only unresolved errors from the current runtime session. Transient errors are not persisted in local storage. A later success for the same operation scope resolves its active error. Historical log entries remain visible without keeping the indicator red.

## DMX Light

FixtureGroup creation is outside this change. Device-list removal is instrumented phase by phase and fixed independently from normal Stage removal. No destructive automatic Designer probe is allowed; final verification is manual in a disposable project.

## Versioning

`package.json` is the canonical product version. The window title and static asset cache keys use that value, beginning with `0.21.0`. State schema version `11` remains internal and is never displayed as the product version.

