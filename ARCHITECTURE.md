# Architecture

## Components

`scene-planner-prototype/index.html` and `styles.css` provide the English Designer-oriented UI. `app.js` owns the scene model, 2D canvas, local persistence, diff, and synchronization workflow. `designer-adapter.js` is the only layer that creates Python scripts or calls Designer HTTP endpoints. It creates resources in class-named folders, marks them dirty before mutation, and saves them after successful changes.

## Scene model

```text
room: { width, depth }
stage: { enabled, centerX, centerZ, floorY, width, depth, height, measureFromStage }
object:
  pluginId
  type, name
  transform:
    position: { x, y, z }
    rotation: { x, y, z }
  geometry: { width, height }  # screen/surface only
  media: { inputMode, resolutionX, resolutionY, pixelsPerInch, pixelPitchMm }  # density fields are LED-only
  lookAt: { x, y, z }  # projector only
  targetSurfacePluginId  # optional projector-to-surface relation
sync.objects[pluginId]:
  designerId, path
  lastExported, payload
  adopted
```

Designer coordinates are authoritative:

| Planner value | Designer | Top view |
| --- | --- | --- |
| `position.x` | `Vec.x` width | horizontal |
| `position.y` | `Vec.y` vertical | not projected |
| `position.z` | `Vec.z` depth | vertical canvas axis |

The room is a viewport frame centred on world `X=0, Z=0` and never changes object coordinates. Its bounds are `-width/2 ... +width/2` and `-depth/2 ... +depth/2`. The stage is a separate positioned rectangle. Stage position is edited numerically; it is deliberately not a draggable canvas object. The grid interval is always 1 m and shows absolute Designer values.

Dragging updates `transform.position.x/z` only. The saved numeric `Y` is always absolute. `floorY` is the hidden Designer floor/base reference; the top of the stage is `floorY + height`. With `measureFromStage` enabled, object Y fields display and accept offsets from that top without changing the saved world coordinate.

For screens and surfaces, position is the bottom centre. The adapter writes `offset = Vec(X, Y + height/2, Z)`, `scale = Vec(width, height, 0.1)`, and `rotation = Vec(0, yaw, 0)`. Resolution and LED PPI are planning metadata until a matching Designer media property is explicitly mapped. Projectors use `configPosition/configLookAt`; setting inherited body transforms or `configRotation` changes the optical configuration unexpectedly. A projector may target a surface by stable plugin ID; its exported Look At is then recomputed from the surface centre. Cameras use the concrete `Camera` class with `offset/rotation`. Lights use `offset/rotation`.

The top toolbar creates objects at the stage centre. Right-clicking empty plan space opens the same equipment choices and creates at that world X/Z. New screens and surfaces focus width, then move to height on Enter. New projectors enter a temporary cursor-follow target-placement state until the next primary click. The left rail groups and selects objects but contains no property inspectors. A fixed strip above the plan shows only the selected object's physical values, so changing object type cannot resize the canvas. Numeric fields accept comma or dot, keyboard arrows, and wheel changes (`0.1` for metres/density and `1°` for angles); the old horizontal pointer scrubbing is removed. Wheel input over the free canvas controls zoom.

Projectors expose lens position and a target marker/surface relation, never user-facing Euler rotation. Dragging a manual marker edits Look At X/Z; selecting a surface locks the marker to that surface centre. LED screens show one source mode at a time: resolution, PPI, or millimetre pitch. The model recalculates the hidden companion values after edits. Dragging objects preserves the pointer offset and optional snapping can use the 1 m grid, 0.1 m grid, stage centre/edges, same-type coordinates, and mirrored distances. Ctrl-drag first creates an independent copy without offset and then moves it. Shift-click selects the complete same-type set; group drag applies one clamped delta so relative positions stay unchanged. Selected screens and surfaces expose an external rotation handle that changes yaw only. The context menu supports duplication, 90-degree rotation/direction change, projector surface binding, mirrored copies, and confirmed deletion.

Every successful create/update returns a type-specific readback. The planner compares position, rotation, and planar geometry strictly, without a tolerance, before recording the sync version.

## Synchronization

### Numeric workflow and LIVE

For screens and surfaces, Enter advances measured values in the order `width -> height -> height above floor/stage`. Numeric focus selects the complete value and integer formatting omits a decimal suffix. Height is a signed world coordinate and may be below the floor or stage; the relative mode displays the signed offset without changing it. The persisted LIVE flag is accepted only after `sync.lastSyncAt` exists; changes are sent as a 200 ms debounced selective diff while explicit export remains the recovery path.

```text
planner state -> inspect Designer -> classify -> diff -> confirm -> selective API calls -> save mappings
```

- Managed: a `dsg-*` path or a stored UID mapping.
- Standard: a recognized default name/path such as `surface 1` or `projector 1`.
- Manual: everything else.

Update mode may adopt a same-type standard object and update it in place. Clean mode creates a new managed set and exposes remaining standards in the deletion checklist. Orphans are reported but never automatically deleted.

The adapter repeats the default/managed check before deletion. Repeat sync resolves a managed object by Designer UID, saved resource path, or its `dsg-*` path. Dangling references left in Designer stage collections after deletion are skipped and reported as inspection warnings; a managed object absent from the valid inspection result is recreated. API errors stop the operation and include the failing planner object plus the Designer HTTP response; the UI never reports a false successful sync. Startup probes `/api/session/status/session` with a short timeout, while create/update calls have a longer timeout.

## Persistence

Browser state uses localStorage key `disguise-scene-generator-state-v10`. It is runtime state, not project history. Durable knowledge lives in Git, Markdown, schema, and fixtures. The v2-v9 keys are read only as migration sources. `sync.objects` stores every imported UID/path mapping and `sync.sceneCube` stores the managed Scene cube mapping.

## Current v10.4 Contract

The UI is English and uses Designer-facing type names. `stage.enabled` is derived from the inspected managed Stage cube at startup, so an empty local store does not create preset equipment or overwrite the open Designer project. When enabled, `syncEnvironment` writes `stage.floor_size` and `stage.floor_pos`, and maintains the managed real cube `objects/object/dsg-scene-cube.apx`. Its geometry reuses the valid 8-vertex/12-triangle topology of Designer's built-in `LookAtManipulable` helper; the plugin changes only vertex positions because the current API does not expose a supported `Triangle` constructor. Stage-relative object height is `position.y - stage.floorY`, never an offset from stage height.

Startup inspection reads typed collections and `stage.children`, deduplicates by Designer UID, imports only physical user objects (`Object`/`Prop` with `needsMesh`) plus supported equipment, and ignores `internal/*` and non-physical Designer helpers. Projector config rotation is read as Designer data and is never normalized or exposed as a user input. Selecting a projector target surface highlights that surface's name and outline on the plan. Strict readback comparison uses no tolerance. The Synchronize button is disabled while LIVE is enabled.
