# Changelog

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
