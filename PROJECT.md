# Disguise Scene Planner

## Purpose

The project helps a video engineer create the first usable layout of an event in minutes, then safely synchronize it with the currently open Disguise Designer stage.

## Users

- Video engineers preparing LED, projection, camera, and lighting layouts.
- Operators who know Designer but do not write Python or plugin code.
- Developers extending scene presets and Designer integration.

## Product boundaries

The planner owns only objects identified by a stable plugin ID or explicitly adopted known defaults. It never silently edits or deletes manual Designer objects. In this version, "new scene" means a clean object set in the current `stage`, not a new Designer project.

The current object set is LED screens, surfaces, cameras, projectors, and lights. Projector lenses, parent-child constraints, podium geometry, calibration, and content routing are future work.

## Definition of done for the current milestone

- A 1 m top-view grid uses Designer `X/Z` axes.
- Inspector and JSON preserve `X/Y/Z` and `Rx/Ry/Rz`.
- Existing v2 local plans migrate without losing plan depth or height.
- Export inspects the current Designer stage and shows a diff before changes.
- Managed/default/manual objects are classified; manual objects remain untouched.
- Standard deletion requires selection plus explicit confirmation.
- Repeated export does not create duplicates and changes only modified fields.
- Setup and tests can be followed from `TESTING.md`.

