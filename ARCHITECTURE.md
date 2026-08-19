# Architecture

## Components

`scene-planner-prototype/index.html` and `styles.css` provide the English Designer-oriented UI. `app.js` owns the Stage model, 2D canvas, local persistence, diff, and LIVE workflow. `designer-adapter.js` is the only layer that creates Python scripts or calls Designer HTTP endpoints. It creates resources in class-named folders, marks them dirty before mutation, and saves them after successful changes.

## Scene model

```text
stage: { width, depth }
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

The Stage is the only plan boundary, centred on world `X=0, Z=0`; it never changes object coordinates. Its bounds are `-width/2 ... +width/2` and `-depth/2 ... +depth/2`. The grid interval is always 1 m and shows absolute Designer values.

Dragging updates `transform.position.x/z` only. The saved numeric `Y` is always absolute. Stage dimensions do not define object height.

For LED screens, DMX screens, and projection surfaces, position is the bottom centre. The adapter writes `offset = Vec(X, Y + height/2, Z)`, `scale = Vec(width, height, 0.1)`, and `rotation = Vec(0, yaw, 0)`. Resolution and LED PPI are planning metadata until a matching Designer media property is explicitly mapped. Projectors use only `configPosition/configLookAt`; inherited body transforms, `rotation`, and `configRotation` are deliberately excluded from the Planner contract. Projector readback returns a zero UI rotation plus the two config vectors, so Designer's calculated optical rotation cannot overwrite user coordinates. A projector may target a surface by stable plugin ID; its exported Look At is then recomputed from the surface centre. Cameras use the concrete `Camera` class with `offset/rotation`. DMX lights use the concrete `FixtureGroup` class with `offset/rotation`.

The top toolbar creates objects at the stage centre. Right-clicking empty plan space opens the same equipment choices and creates at that world X/Z. New screens and surfaces focus width, then move to height on Enter. New projectors enter a temporary cursor-follow target-placement state until the next primary click. The left rail groups and selects objects but contains no property inspectors. A fixed strip above the plan shows only the selected object's physical values, so changing object type cannot resize the canvas. Numeric fields accept comma or dot, keyboard arrows, and wheel changes (`0.1` for metres/density and `1°` for angles); the old horizontal pointer scrubbing is removed. Wheel input over the free canvas controls zoom.

Projectors expose a target marker/surface relation and share the external rotation handle with cameras and DMX lights. Dragging a manual marker edits Look At X/Z; selecting a surface locks the marker to that surface centre. LED screens show one source mode at a time: resolution, PPI, or millimetre pitch. The model recalculates the hidden companion values after edits. Dragging objects preserves the pointer offset and optional snapping can use the 1 m grid, 0.1 m grid, Stage edges, same-type coordinates, and mirrored distances. Ctrl-drag and Ctrl+C/Ctrl+V create independent copies. Shift-click selects the complete same-type set; group drag applies one clamped delta so relative positions stay unchanged. The context menu supports duplication, 90-degree rotation/direction change, projector surface binding, mirrored copies, and confirmed deletion.

Every successful create/update returns a type-specific readback. The planner compares position, rotation, and planar geometry strictly, without a tolerance, before recording the sync version.

## Synchronization

### Numeric workflow and LIVE

For screens and surfaces, Enter advances measured values in the order `width -> height -> position Y`. Numeric focus selects the complete value and integer formatting omits a decimal suffix. Height is a signed world coordinate. The official Live Update transport is a WebSocket with `subscribe`/`valuesChanged`/`set`. Object properties are addressed with `getByUID(0x...)` expressions. It updates writable scalar transforms for mapped objects; creation/deletion uses explicit Python resource operations, and Stage collection subscriptions trigger import/reconciliation for objects created or deleted in Designer.

```text
planner state -> inspect Designer -> classify -> diff -> confirm -> selective API calls -> save mappings
```

- Managed: a `dsg-*` path or a stored UID mapping.
- Standard: a recognized default name/path such as `surface 1` or `projector 1`.
- Manual: everything else.

Update mode may adopt a same-type standard object and update it in place. Clean mode creates a new managed set and exposes remaining standards in the deletion checklist. Orphans are reported but never automatically deleted. A mapped object missing from Designer is reported as missing in the internal diff; LIVE never recreates a Designer object that was deleted, while a new Planner object without a Designer UID is created once through the resource API.

The adapter repeats the default/managed check before deletion and removes selected resources through `resourceManager.remove(path)` after `saveOnDelete()`. Repeat sync resolves a managed object by Designer UID, saved resource path, or its legacy `dsg-*` path. Dangling typed references left in Designer stage collections after deletion are ignored in favour of typed collection truth. API errors stop the operation and include the failing planner object plus the Designer HTTP response; the UI never reports a false successful sync. Startup probes `/api/session/status/session` with a short timeout, while create/update calls have a longer timeout.

## Persistence

Browser state uses localStorage key `disguise-scene-generator-state-v11`. It is runtime state, not project history. Durable knowledge lives in Git, Markdown, schema, and fixtures. The v2-v10 keys are read only as migration sources. `sync.objects` stores every imported UID/path mapping; the old managed cube mapping remains adapter metadata only.

## Current v11 Contract

The UI is English and uses Designer-facing type names. Stage owns only width and depth and is centred at the world origin. Internal adapter calls still receive a compatibility environment object so existing Python/HTTP behavior and UID mappings remain unchanged; the user-facing export-apply workflow is removed. Default install heights are Camera 1.5 m, DMX Light 5 m, Projector 3 m, and planar objects 0 m. The next object of each class reuses that class's last edited height.

Startup inspection reads typed collections and `stage.children`, deduplicates by Designer UID, imports only physical user objects (`Object`/`Prop` with `needsMesh`) plus supported equipment, and ignores `internal/*`, MR Sets, Skeletons, and non-physical Designer helpers. Selecting or previewing a projector target surface highlights that surface's name and outline on the plan. Strict readback comparison uses no tolerance. LIVE discovers the Director from `?director=`, stores remote/desired binding state, and reconnects/resubscribes with backoff without falling back to HTTP polling or disabling itself on a transient socket error.
