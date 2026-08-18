# Architecture Decisions

## ADR-016: Guided dimension entry and confirmed LIVE baseline

- Date: 2026-08-18
- Status: accepted

For screens and surfaces, Enter follows the physical-paper workflow `width -> height -> height above floor/stage`. Inputs remain text-editable and select their entire content on focus/click so a measured value can be replaced immediately. Height is a signed world coordinate; stage-relative mode displays the signed offset and never clamps it.

The official Live Update contract is a WebSocket at `/api/session/liveupdate` with `subscribe`, `valuesChanged`, and `set` messages. The planner does not claim support for that transport until object/property subscriptions are implemented; the current UI keeps LIVE disabled and uses explicit Python HTTP synchronization.

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

Scene inspection treats an entry that no longer exposes a valid `uid/path` as a dangling Designer reference. It records a warning and continues inspecting the remaining collections. If a planner-managed object is absent from the valid result, diff logic classifies it as `missing` and never recreates it automatically; stale local mappings never force an update call to a deleted resource.

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

Projector `configPosition/configLookAt` are the sole authoritative writes. The adapter must not write inherited body `offset/rotation` or `configRotation`, because Designer recalculates the projector optical configuration. Any existing `configRotation` is read back and retained as adapter data, but is not normalized or exposed to the user. Light position/direction continue through `offset/rotation`, which are the writable transform properties exposed by the current Python stubs.

All numeric controls are text-backed decimal inputs so both comma and dot are valid. Empty or incomplete text never becomes zero. A click selects without changing coordinates; a drag preserves the original pointer offset and then applies the selected snapping policy.

## ADR-011: Preserve v5 stage data during migration

- Date: 2026-08-17
- Status: accepted

Version 5 already stored a separate `stage` object. The v7 loader preserves it when present, converts the old stage-top `floorY` to a floor/base reference, and uses the legacy room fallback only for v2-v4 saves. This avoids silently moving existing stage bounds or vertical reference during a routine plugin update.

## ADR-012: Concrete camera resources and human-readable resource paths

- Date: 2026-08-17
- Status: accepted

The planner creates Designer `Camera` resources, not `VirtualCamera` resources. Camera transforms use inherited `offset/rotation`. Generated resource paths use lowercase human-readable planner names such as `camera-1.apx`; local `pluginId -> designerId/path` remains the ownership source and names are never the only identity.

Projectors expose a world `lookAt` point. The adapter converts it to `configLookAt`, while the 2D view derives its cone from the vector between position and target.

## ADR-013: Compact inspectors and surface-linked projector targets

- Date: 2026-08-17
- Status: accepted

Object properties are rendered as titled horizontal rows rather than one label/value row per property. The desktop application shell is fixed to the viewport and only the sidebar scrolls, so expanding controls cannot change the canvas dimensions.

The visible projector marker is the editable Look At source of truth. Manual markers store world X/Y/Z and may be dragged in X/Z. A projector may instead store `targetSurfacePluginId`; export then derives Look At from the current centre of that surface. Lights and cameras expose only position plus horizontal `Ry` until a proven vertical aiming contract is introduced.

LED density is stored as `pixelsPerInch`. Projection surfaces have resolution metadata but no density field. v8 converts legacy LED `pixelPitchMm` using `25.4 / pixelPitchMm` and preserves the v7 stage base elevation unchanged.

## ADR-014: Direct rotation and mirrored duplication

- Date: 2026-08-17
- Status: accepted

Selected screens and projection surfaces expose a rotation handle outside their top-right plan corner. The handle edits only world yaw (`transform.rotation.y`); position, height, geometry, and media metadata remain unchanged. The pointer angle is measured from the object centre and corrected by the handle's local corner offset so grabbing the handle does not introduce an initial rotation jump.

The canvas context menu creates either a plain copy or a mirrored copy around the stage centre planes. X mirroring maps `x` to `2 * stage.centerX - x` and negates yaw. Z mirroring maps `z` to `2 * stage.centerZ - z` and maps yaw to `180 - yaw`, normalized to `[-180, 180)`. Projector Look At points follow the same mirror and mirrored projectors drop any surface binding because a mirrored target is an independent world-space point. Every duplicate receives a new local ID, plugin ID, readable name, and no Designer mapping.

## ADR-015: Physical-intent UI and adapter boundary

- Date: 2026-08-17
- Status: accepted

The planner interface exposes physical event-building intent, not Designer implementation fields. A projector has lens position and a world/surface target; its body/config rotations remain adapter-owned and are never normalized during import. Screens and surfaces expose physical dimensions, bottom-centre position, and plan yaw. Cameras and lights expose position and horizontal direction.

Object properties live in one fixed horizontal strip above the X/Z plan. The left rail is selection-only and cannot expand with object parameters. Metric and density inputs use `0.1` wheel steps, angles use `1°`, direct typing remains available, and wheel events over the free canvas control zoom. LIVE is disabled until the official WebSocket Live Update adapter is implemented; explicit synchronization remains HTTP/Python.

LED input provenance is stored as `media.inputMode`: `resolution`, `ppi`, or `pitch`. Only the selected mode is shown. The other density/resolution values are recalculated so exports and later adapters can consume a complete physical description without forcing all values into the operator workflow.

Creation is spatial and mouse-first: right-clicking empty plan space opens an equipment menu and creates the chosen object at that world X/Z. Screen and surface creation starts a width-then-height keyboard sequence. Projector creation starts a temporary target-placement mode in which the visible Look At point follows the cursor until the next primary click. Ctrl-drag creates an independent copy at the original position and immediately moves it; Shift-click selects every object of the same type, and dragging any member preserves all relative X/Z offsets.

Canvas geometry queries are side-effect free. Pointer hover, hit-testing, coordinate conversion, and context-menu placement may read the CSS bounds and compute a frame but must not assign `canvas.width` or `canvas.height`. Only an actual draw pass may resize the backing buffer and must repaint immediately afterward.

## ADR-017: Current Designer scene is the initial 2D model

- Date: 2026-08-18
- Status: accepted

On startup the adapter inspects every typed collection and `stage.children`. The returned Designer UID, path, class, and display name become the local object's identity and label. Unknown classes are represented as `designer` objects rather than being silently discarded. Projector rotations are imported as read; the planner never normalizes or rewrites them merely because a projector was inspected.

## ADR-018: Optional Scene and Designer floor

- Date: 2026-08-18
- Status: accepted

`stage.enabled` is independent from room dimensions. When enabled, the adapter updates only the safe `stage.floor_pos` field and maintains one managed `d3.Object` cube at `objects/object/dsg-scene-cube.apx`; `stage.floor_size` is planner metadata because Free Designer Starter rejects that write. The cube is built from a real 8-vertex/12-triangle mesh. Turning Stage off does not delete Designer content; deletion remains an explicit future operation. Object-relative height is measured from `stage.floorY`, never from the stage height.

## ADR-019: Strict readback and manual synchronization gate

- Date: 2026-08-18
- Status: accepted

Readback validation has no configured tolerance. A mismatch is reported instead of being rounded away. Manual `Synchronize` remains available; LIVE is disabled until a real WebSocket adapter exists.

## ADR-020: Designer-facing English names

- Date: 2026-08-18
- Status: accepted

Visible type labels and controls use English names matching Designer classes (`LED Screen`, `Surface`, `Projector`, `Light`, `Camera`). Imported Designer descriptions remain the source label, and the selected name in the property strip is editable without using a name as the ownership key.

## ADR-021: Stage geometry and helper filtering

- Date: 2026-08-18
- Status: accepted

The Stage is optional. Its position is changed only through numeric `X/Z` fields; the plan never treats the Stage boundary as a draggable canvas object. On startup the open Designer project is authoritative: no generated presets are inserted, and Stage is enabled only when the managed `dsg-scene-cube.apx` is found.

The current Designer Python API exposes `Mesh.verts` and `Mesh.triangles` but does not expose a supported `Triangle` constructor or index setters. The managed cube therefore copies the valid topology from the built-in `LookAtManipulable` helper and replaces vertex positions before `updateMesh()`.

Inspection ignores internal paths and non-physical helper resources. It keeps supported typed equipment and generic `Object`/`Prop` resources only when `needsMesh` is true. A projector's selected Look At surface is highlighted on the 2D plan so the relationship is visible without exposing Designer implementation rotations.

## ADR-022: Designer names and non-resurrecting deletes

- Date: 2026-08-18
- Status: accepted

Designer resource filenames are derived from the editable planner name (`objects/<type>/<name>.apx`) rather than an implementation prefix. Existing managed `dsg-*` resources are renamed on the next update through the supported `Resource.path` setter. Stable UID/path mappings remain internal and are never shown as the object name.

If a mapped Designer object is missing during inspection, the planner reports `Missing in Designer` and does not classify it as `create`. This prevents LIVE from recreating an object the operator deliberately removed in Designer; recreation must be an explicit future command.

The adapter never writes `stage.floor_size` because Free Designer Starter dispatches a broken `Screen2Editor` callback for that field. Room dimensions remain planner metadata while Stage dimensions are represented by the managed internal cube. `stage.floor_pos` is updated only when the environment actually changes.

## ADR-023: Official Live Update boundary

- Date: 2026-08-18
- Status: accepted

The planner will not label debounced Python HTTP calls as LIVE. Official Live Update is the WebSocket endpoint `/api/session/liveupdate`, whose protocol uses `subscribe`, `valuesChanged`, and `set`. Until subscriptions for the planner's resource paths and writable properties are implemented and verified, the LIVE control is disabled while explicit HTTP synchronization remains available.

Confirmed default deletion uses the ResourceManager lifecycle: `resource.saveOnDelete()` followed by `resourceManager.remove(resource.path)`. Removing an item from a Stage collection alone is not considered deletion.

## ADR-024: Pointer gesture threshold and dimension focus

- Date: 2026-08-18
- Status: accepted

Selection and movement are separate gestures. A canvas pointerdown selects an object and creates a pending drag; coordinates are changed only after 4 px of movement. This protects off-grid objects from accidental snap-to-grid changes. Ctrl duplication is also deferred until that threshold, so Ctrl-click remains a selection gesture.

For screens and surfaces, Enter follows the physical setup order `geometry.width`, `geometry.height`, then `transform.position.y`. The next field is focused on the next task after the inspector has processed the current value.

## ADR-025: Official WebSocket Live Update transport

- Date: 2026-08-18
- Status: accepted

LIVE now uses the documented `ws://<director>/api/session/liveupdate` endpoint. The adapter subscribes to Designer resource expressions such as `ledscreen:led_screen_1` and maps the returned subscription IDs to planner fields. Local changes send `set` messages after a short debounce; Designer `valuesChanged` messages update the local plan without triggering an HTTP export loop. If the plugin host does not expose `WebSocket` or the endpoint rejects the connection, LIVE returns to off and explicit Python HTTP synchronization remains available.

Subscription ids are session-scoped. The adapter therefore invalidates all ids on socket close and recovers from an `invalid id` error by resubscribing before sending further sets.
