# Architecture Decisions

## ADR-001: Native Designer coordinates

- Date: 2026-08-17
- Status: accepted

The saved scene model uses Designer coordinates without axis remapping: `X` is width, `Y` is vertical height, and `Z` is depth. The room is centred on the Designer origin, so its plan bounds are `-width/2 ... +width/2` and `-depth/2 ... +depth/2`. The top view projects `X/Z`. Dragging changes only `X` and `Z`; the inspector changes `Y` and `Rx/Ry/Rz` numerically.

Existing v2 browser data is migrated once: old plan `x - width/2 -> X`, old plan `y - depth/2 -> Z`, and old height `z -> Y`. Existing v3 `X/Z` values are shifted by the same half-room offset because v3 still used a corner origin. The former single plan rotation becomes Designer `Ry`.

## ADR-002: Ownership and safe synchronization

- Date: 2026-08-17
- Status: accepted

An object is managed only when its `dsg-*` path or stored Designer UID proves ownership. Known default objects such as `surface 1` and `projector 1` may be adopted in update mode. Everything else is manual and protected.

Objects removed from the planner are not removed from Designer. Standard objects can be deleted only from a checklist, through a separate button and a second confirmation. The adapter repeats the ownership/default check before removal.

## ADR-003: Local API origin

- Date: 2026-08-17
- Status: accepted

For local development the UI runs on `http://127.0.0.1:4173` and the Designer API is addressed explicitly as `http://127.0.0.1`. This avoids the observed `.local` hostname/proxy path. Production plugin hosting can override the address with `window.DISGUISE_API_ORIGIN`.

## ADR-004: Local-first project memory

- Date: 2026-08-17
- Status: accepted

Git at the workspace root is the durable history. Markdown documents, JSON Schema, and fixtures are versioned. Browser `localStorage`, proxy settings, caches, secrets, and generated output are never committed.

## ADR-005: Repeat synchronization identity

- Date: 2026-08-17
- Status: accepted

A stored Designer UID is preferred but is not assumed to remain sufficient across reloads. Repeat sync may recover the same managed resource by its saved path or stable `dsg-<pluginId>.apx` path. Mappings are persisted after every successful create/update operation so a later failure cannot erase the identity of objects that were already written.

## ADR-006: Deleted Designer references are non-fatal

- Date: 2026-08-17
- Status: accepted

Scene inspection treats an entry that no longer exposes a valid `uid/path` as a dangling Designer reference. It records a warning and continues inspecting the remaining collections. If a planner-managed object is absent from the valid result, normal diff logic classifies it as `create`; stale local mappings never force an update call to a deleted resource.

## ADR-007: Source and deployed plugin are separate artifacts

- Date: 2026-08-17
- Status: accepted

The tracked source under `scene-planner-prototype` is authoritative. Designer loads a copied plugin from the active project's `plugins` directory and does not inherit changes from the standalone development server. Deployment uses `scripts/deploy-plugin.ps1`, verifies every copied file by SHA-256, and requires the embedded plugin window to be reopened.

## ADR-008: Follow Designer resource mutation lifecycle

- Date: 2026-08-17
- Status: accepted

Designer resources are created under folders derived from their Python class names (`ledscreen`, `screen2`, `camera`, `projector`, `light`). Before changing transform properties the adapter calls `markDirty(obj)`, and after mutation it calls `obj.save()`. Property assignment is wrapped so failures identify the exact field, runtime class, and resource path. Read-only `Resource.description` is not assigned.

## ADR-009: v5 world transforms and type-specific Designer properties

- Date: 2026-08-17
- Status: superseded by ADR-010 and ADR-012

The room is a movable world-space frame (`centerX`, `centerZ`, `floorY`) and never acts as a hidden coordinate origin. Objects store `transform.position/rotation`; screens and surfaces also store editable `geometry.width/height` and use a fixed `0.1 m` thickness.

This decision records the v5 contract. Its projector and camera fields are historical; the current contract is defined by ADR-010 and ADR-012. Screen/surface `Y` remains the bottom edge, converted only in the adapter to a centre pivot. A write is accepted as synchronized only after type-specific readback matches within `0.001` metre/degree.

## ADR-010: v6 event-building model and projector optical transform

- Date: 2026-08-17
- Status: accepted

The room stores only width/depth around the Designer world origin. The stage is an independent positioned footprint with width/depth/height and a top elevation. Objects are edited in grouped, collapsed type collections; screens add resolution and pixel pitch, projectors add resolution, and directional objects expose position plus `Rx/Ry/Rz`.

Projector `configPosition/configLookAt` are the sole authoritative writes. The adapter must not write inherited body `offset/rotation` or `configRotation`, because Designer recalculates the projector optical configuration. Light position/direction continue through `offset/rotation`, which are the writable transform properties exposed by the current Python stubs.

All numeric controls are text-backed decimal inputs so both comma and dot are valid. Empty or incomplete text never becomes zero. A click selects without changing coordinates; a drag preserves the original pointer offset and then applies the selected snapping policy.

## ADR-011: Preserve v5 stage data during migration

- Date: 2026-08-17
- Status: accepted

Version 5 already stored a separate `stage` object. The v7 loader preserves it when present, converts the old stage-top `floorY` to a floor/base reference, and uses the legacy room fallback only for v2-v4 saves. This avoids silently moving existing stage bounds or vertical reference during a routine plugin update.

## ADR-012: Concrete camera resources and human-readable resource paths

- Date: 2026-08-17
- Status: accepted

The planner creates Designer `Camera` resources, not `VirtualCamera` resources. Camera transforms use inherited `offset/rotation`. Generated resource paths use stable human-readable names such as `dsg-camera-1.apx`; local `pluginId -> designerId/path` remains the ownership source and names are never the only identity.

Projectors expose a world `lookAt` point. The adapter converts it to `configLookAt`, while the 2D view derives its cone from the vector between position and target.
