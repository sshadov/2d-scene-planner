# Disguise Scene Planner

## Purpose

The project helps a video engineer create the first usable layout of an event in minutes, then safely synchronize it with the currently open Disguise Designer stage.

## Users

- Video engineers preparing LED, projection, camera, and lighting layouts.
- Operators who know Designer but do not write Python or plugin code.
- Developers extending scene presets and Designer integration.

## Product boundaries

The planner owns only objects identified by a stable plugin ID or explicitly adopted known defaults. It never silently edits or deletes manual Designer objects. In this version, "new scene" means a clean object set in the current `stage`, not a new Designer project.

The current object set is LED screens, surfaces, cameras, projectors, and lights. LED screens carry physical size plus one chosen resolution/density input mode; projection surfaces carry size and resolution; projectors carry lens position, target, and resolution. Designer offsets, body Euler rotations, config rotations, parent-child constraints, lens models, podium geometry, calibration, and content routing do not belong in the operator UI.

## Definition of done for the current milestone

- A 1 m top-view grid uses Designer `X/Z` axes.
- Room width/depth and stage width/depth/height are independent.
- Objects are created from one top toolbar and selected from a compact grouped rail.
- Right-clicking empty plan space creates the chosen equipment at that coordinate; screen size entry continues width-to-height and projector creation continues directly into visible target placement.
- Only the active object's physical parameters appear in a fixed strip above the plan.
- Numeric controls accept comma/dot, arrow keys, and wheel changes; horizontal scrubbing is absent.
- Selecting on the plan preserves position; dragging preserves the pointer offset and offers basic alignment snapping.
- Ctrl-drag duplicates in place and moves the copy; Shift-click selects and moves all objects of the same type without changing their relative spacing.
- The UI and JSON preserve absolute world `X/Y/Z`, planar yaw where physically meaningful, and projector Look At without exposing Designer config rotation.
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
- Selected screens and surfaces rotate from an external corner handle without changing position.
- Right-click duplication supports independent plain, X-mirrored, and Z-mirrored copies.
- LED screens show resolution, PPI, or pixel-pitch mode rather than all density inputs at once.
- The LIVE control defaults off and remains non-transmitting until the dedicated LiveUpdate milestone.
- Setup and tests can be followed from `TESTING.md`.
