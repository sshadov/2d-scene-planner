# Disguise Scene Planner

## Purpose

The project helps a video engineer create the first usable layout of an event in minutes, then safely synchronize it with the currently open Disguise Designer stage.

## Users

- Video engineers preparing LED, projection, camera, and lighting layouts.
- Operators who know Designer but do not write Python or plugin code.
- Developers extending scene presets and Designer integration.

## Product boundaries

The planner owns only objects identified by a stable plugin ID or explicitly adopted known defaults. It never silently edits or deletes manual Designer objects. In this version, "new scene" means a clean object set in the current `stage`, not a new Designer project.

The current object set is LED screens, surfaces, cameras, projectors, and lights. LED screens carry physical size, resolution, and PPI; projection surfaces carry size and resolution; projectors carry position, target, and resolution. Projector lens models, parent-child constraints, podium geometry, calibration, and content routing are future work.

## Definition of done for the current milestone

- A 1 m top-view grid uses Designer `X/Z` axes.
- Room width/depth and stage width/depth/height are independent.
- Objects are grouped by type with per-group add controls and collapsed inspectors.
- Numeric controls accept comma/dot and support horizontal `0.1` scrubbing.
- Selecting on the plan preserves position; dragging preserves the pointer offset and offers basic alignment snapping.
- Inspector and JSON preserve absolute Designer `X/Y/Z`, planar yaw, projector Look At, and type-specific rotations.
- Screens/surfaces use bottom-centre anchors with editable width/height and fixed thickness.
- Existing v2-v4 local plans migrate without losing plan depth or height.
- Export inspects the current Designer stage and shows a diff before changes.
- Managed/default/manual objects are classified; manual objects remain untouched.
- Standard deletion requires selection plus explicit confirmation.
- Repeated export does not create duplicates and changes only modified fields.
- Create/update reads coordinates back from Designer and rejects a mismatch over `0.001`.
- Projectors use a target point (`Look At`) and concrete cameras use the `Camera` resource class.
- Object deletion requires an inline confirmation before changing the local plan.
- Opening object controls must not resize or move the top-view canvas.
- A projector target is visible on the plan and may follow a selected projection surface centre.
- Setup and tests can be followed from `TESTING.md`.
