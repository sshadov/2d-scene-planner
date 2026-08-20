# Stage Sync And Projector Geometry Design

## Goal

Make explicit Planner actions deterministic in Designer while keeping the Planner useful as a standalone scene calculator.

## Lifecycle

- Add, duplicate, paste, rename, and delete remain explicit operations. LIVE never creates or deletes resources.
- A successful create binding remains in Planner during delayed or intermediate Stage notifications. Passive import merges confirmed Designer objects by UID/path and never drops a bound object from a single incomplete inspection.
- Camera and DMX Light creation must return only after the object is present in its owning typed Stage collection. A later inspection reconciles the confirmed UID without producing a second local object.
- DMX Light package deletion must remove every owned reference in a Designer-safe order. The implementation must be validated separately from Camera and Projector cleanup and must not leave `FixtureGroup`, `DirectProjection`, fixture instances, TrackPlayer targets, or typed Stage entries pointing at removed resources.

## Interaction

- Selecting a Projection Surface in the left object list shows the same yellow outline used by Projector `Bind to surface` preview.
- Initial field focus survives object-list rendering and passive Designer imports. Screen entry order is Width, Height, Position Y.
- Object, group, Projector, and Look At dragging are not clamped to Scene bounds. Scene width/depth describe the planning reference grid, not a movement boundary.
- Screen yaw is committed through a Designer update that forces the saved transform to be re-evaluated; the visible result must not require a manual `+1/-1` edit.

## Projector Geometry

- Planner owns a pure geometry calculation usable without Designer. Position and Look At determine geometric distance. Bound Surface dimensions and Projector resolution determine projected width and orientation.
- `throwRatio = geometricDistance / projectedWidth`, where projected width follows the agreed horizontal/vertical-screen aspect formula.
- Look distance is editable. Changing it moves Look At along the current 3D direction vector. Moving Position, Look At, or the bound Surface recalculates geometric distance and throw ratio.
- Field of view is calculated locally as `2 * atan(projectedWidth / (2 * distance))`, then replaced by Designer readback when Designer returns a valid authoritative value.
- Binding a Projector to a Projection Surface updates both Planner `targetSurfacePluginId` and Designer `Projector.screens`. Unbinding clears the Designer list.
- After a completed Position or Look At change, the adapter applies final `configRotation.z`: `0` degrees for a horizontal Surface and `90` degrees for a vertical Surface. No final roll write happens during pointer movement.
- LIVE subscribes to position, Look At, throw ratio, field of view, look distance, rotation, and screens. Writable values are sent only after an explicit local change; incoming Designer values update Planner without echo.

## Error Handling And Verification

- Device-list cleanup errors stay associated with the failed device instead of being cleared by an unrelated successful deletion.
- Every behavior change starts with a failing regression test. The release gate remains `npm run release-check` plus the composite-device dry run.
- Real Designer smoke testing is split by type so a DMX Light failure cannot contaminate Camera or Projector evidence.
