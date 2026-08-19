# Composite Device Lifecycle Design

**Date:** 2026-08-19  
**Status:** Proposed  
**Scope:** Designer resource creation, validation, and deletion for Planner-supported devices

## Goal

Make Planner-created devices follow the same public Designer Python API lifecycle as manually created devices, without creating bare camera/projector resources or leaving stale Stage references.

## Confirmed Designer Contracts

- `LED Screen`, `DMX Screen`, and `Projection Surface` use typed Stage collections and are created as their public resource classes. Designer may maintain an internal `DirectProjection` resource for displays; the display resource remains the public lifecycle identity.
- `DMX Light` is a `FixtureGroup` in `stage.dmxLights`. The manually created sample `objects/fixturegroup/3.apx` is healthy with no child objects; Designer maintains a separate direct projection resource. A resource path/class conflict must be reported instead of passing an existing wrong-class path to `loadOrCreate`.
- A healthy concrete `Camera` is a named `Camera` with a `PerspectiveProjectionObject` child whose `projection` points to a named `PerspectiveProjection`. The child is attached with `camera.add(projection_object)`. The camera also has Designer-managed mesh, render settings, and calibration references.
- A healthy `Projector` owns a named `ProjectorConfig` resource. `configPosition`, `configLookAt`, and `configThrowRatio` are the Planner's writable optical contract; Designer derives rotation, look distance, and field of view.
- A Stage deletion is two-phase: remove the exact object from its typed Stage collection/hierarchy and persist the Stage, then remove the named package resources. Removing only a package resource can leave a stale Stage reference.

## Architecture

The adapter will keep one public `createObject` entry point but dispatch creation to explicit per-class builders:

1. `createSimpleDisplay` for LED Screen, DMX Screen, Projection Surface, and DMX Light. It validates the requested path/class, loads or creates the public resource, assigns Planner fields, appends to the typed Stage collection, and verifies typed-collection membership and resource health.
2. `createCamera` for concrete cameras. It creates the named camera, projection, and projection-object resources, attaches the projection object to the camera, assigns transforms, appends to `stage.cameras`, and verifies the child graph before returning.
3. `createProjector` for projectors. It creates the named projector and its `ProjectorConfig`, applies the public config fields, appends to `stage.projectors`, and verifies the config reference and resource health before returning.

Each builder records every newly created path and whether the Stage collection was modified. On any exception or failed health check it rolls back in reverse order. Existing resources are never removed by rollback.

## Naming And Conflicts

Planner names remain labels, not identities. The adapter checks both `resourceManager.exists(Path(path))` and the package list. If the path exists with the expected class, it may be reused only for an explicit adopt/update flow; a create flow must allocate a managed unique path. If the path exists with another class, the adapter must not call `loadOrCreate` with a conflicting expected type and must return a clear Resource-list conflict error.

## Testing Strategy

- Add source-level tests that assert generated scripts contain separate simple/camera/projector builders, camera child attachment, projector config creation, health checks, and reverse-order rollback.
- Add a protocol test for wrong-class path conflicts.
- Add a Designer smoke script used only against `scenegen2`: create one temporary camera, one temporary projector, and one temporary DMX Light; verify typed collection membership, `isBad`, `isIncomplete`, required child/config resources, then delete by typed collection first and verify no package or Stage residue.
- Existing unit and protocol tests must remain green.

## Non-Goals

- No new WebSocket connection or changes to the Live Update wire protocol.
- No automatic deletion or mutation of the user's manually created `1`, `2`, or `3` samples.
- No lens calibration or exact optical simulation; Designer remains authoritative for derived projector values.
