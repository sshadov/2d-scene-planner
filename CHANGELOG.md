# Changelog

## 0.9.0 - 2026-08-17

- Rebuilt object inspectors as compact titled rows to stop the sidebar from expanding the canvas.
- Kept room dimensions and all stage dimensions plus the relative-height checkbox on compact rows.
- Changed LED density metadata from millimetre pitch to PPI and removed density from projection surfaces.
- Reduced projector, light, and camera controls to the requested position and horizontal direction fields.
- Added visible draggable projector Look At markers and surface-centre targeting.
- Added v8 migration that preserves v7 stage-floor semantics and converts legacy LED pixel pitch to PPI.

## 0.8.0 - 2026-08-17

- Added stage-relative height display without changing saved world Y.
- Kept room and stage sections permanently visible and removed the unused stage-top field.
- Restored keyboard ArrowUp/ArrowDown editing while retaining manual decimal input and mouse scrubbing.
- Added inline delete confirmation beside each object remove button.
- Fixed object numbering after deletion so a new LED screen cannot duplicate an existing number.
- Replaced `VirtualCamera` creation with concrete `Camera` resources and readable `dsg-camera-N` paths.
- Replaced projector Euler export with `configLookAt` and corrected top-view direction cones.
- Restored the accidentally removed stage-height input and versioned all v7 runtime assets.
- Added resolution and pixel-pitch planning fields to projection surfaces.
- Added a real Designer session probe and request timeouts so an offline API is reported honestly.

## 0.7.0 - 2026-08-17

- Added the v6 room/stage model and grouped Scene-style object sidebar.
- Added per-type `+` controls, collapsed object inspectors, and automatic expansion for newly added objects.
- Added decimal comma/dot input, live numeric updates, and horizontal `0.1` scrubbing.
- Added screen resolution/pixel pitch and projector resolution fields.
- Added visible projector, light, and camera direction cones plus grid/centre/edge/symmetry snapping.
- Preserved the pointer offset during drag so selection no longer jumps an object under the cursor.
- Stopped double-transforming projectors: `configPosition/configLookAt` are written without body mirroring.
- Fixed native number inputs clearing comma-formatted room/stage dimensions.
- Preserved v5 stage metadata during v7 migration and kept generated equipment heights absolute.

## 0.6.0 - 2026-08-17

- Added the v5 `transform`/`geometry` scene model and absolute room frame coordinates.
- Made screen and surface `Y` mean bottom edge; fixed scale to width/height/thickness.
- Added projector config transforms, camera relative/global transforms, and type-specific scene inspection.
- Added post-write coordinate readback with a `0.001` tolerance.
- Removed ambiguous vertical reference controls and added editable per-object screen dimensions.
- Added v2-v4 migration into the v5 local storage and JSON schema.
- Versioned runtime asset URLs so Designer cannot mix cached v4 JavaScript/CSS with v5 HTML.

## 0.5.0 - 2026-08-17

- Aligned Designer resource paths with Python class names.
- Added the documented `markDirty`/`save` lifecycle around resource mutations.
- Removed assignment to read-only resource descriptions and added field-level Python errors.

## 0.4.2 - 2026-08-17

- Added a verified deployment command for copying the tracked plugin into an active Designer project.
- Documented that the standalone server and Designer's embedded plugin use separate file copies.

## 0.4.1 - 2026-08-17

- Made Designer inspection tolerate dangling collection references left after object deletion.
- Reported skipped references in the export dialog and recreated missing managed objects instead of updating stale mappings.

## 0.4.0 - 2026-08-17

- Centred room coordinates on the Designer origin and migrated v2/v3 browser state to v4.
- Added negative `X/Z` plan bounds, centre axes, centred generation, and origin placement for new objects.
- Made repeat synchronization recover managed resources by UID or path and persist mappings after each successful operation.
- Added object-level errors and Designer HTTP response bodies for failed Python operations.

## 0.3.0 - 2026-08-17

- Replaced ambiguous plan coordinates with native Designer `X/Y/Z`.
- Changed the top view to `X/Z` and dragging to `X/Z` only.
- Added `Rx/Ry/Rz`, vertical reference metadata, and v2 localStorage migration.
- Corrected screen/surface scale to width/thickness/height.
- Added update/clean export modes, standard-object adoption, protected manual objects, and confirmed default cleanup.
- Added durable project documentation, JSON Schema, fixtures, and local Git history.

## 0.2.0

- Added stable plugin IDs, local persistence, JSON export, and initial create/update diff.

## 0.1.0

- Added the standalone room planner and fixed 1 m canvas grid.
