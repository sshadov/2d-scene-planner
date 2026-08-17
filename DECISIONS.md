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
