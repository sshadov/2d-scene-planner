# Architecture

## Components

`scene-planner-prototype/index.html` and `styles.css` provide the Russian UI. `app.js` owns the scene model, 2D canvas, local persistence, diff, and synchronization workflow. `designer-adapter.js` is the only layer that creates Python scripts or calls Designer HTTP endpoints. It creates resources in class-named folders, marks them dirty before mutation, and saves them after successful changes.

## Scene model

```text
room: { width, depth }
stage: { centerX, centerZ, floorY, width, depth, height, measureFromStage }
object:
  pluginId
  type, name
  transform:
    position: { x, y, z }
    rotation: { x, y, z }
  geometry: { width, height }  # screen/surface only
  media: { resolutionX, resolutionY, pixelsPerInch }  # PPI is LED-only
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

The room is a viewport frame centred on world `X=0, Z=0` and never changes object coordinates. Its bounds are `-width/2 ... +width/2` and `-depth/2 ... +depth/2`. The stage is a separate positioned rectangle. The grid interval is always 1 m and shows absolute Designer values.

Dragging updates `transform.position.x/z` only. The saved numeric `Y` is always absolute. `floorY` is the hidden Designer floor/base reference; the top of the stage is `floorY + height`. With `measureFromStage` enabled, object Y fields display and accept offsets from that top without changing the saved world coordinate.

For screens and surfaces, position is the bottom centre. The adapter writes `offset = Vec(X, Y + height/2, Z)`, `scale = Vec(width, height, 0.1)`, and `rotation = Vec(0, yaw, 0)`. Resolution and LED PPI are planning metadata until a matching Designer media property is explicitly mapped. Projectors use `configPosition/configLookAt`; setting inherited body transforms or `configRotation` changes the optical configuration unexpectedly. A projector may target a surface by stable plugin ID; its exported Look At is then recomputed from the surface centre. Cameras use the concrete `Camera` class with `offset/rotation`. Lights use `offset/rotation`.

The sidebar groups objects by type. New objects open automatically; existing groups start collapsed. Each inspector uses compact titled rows so fields that belong together share one line. The application shell is fixed to the viewport; only the sidebar scrolls, so opening an inspector cannot resize the canvas. Numeric fields accept comma or dot, update the model while typing, and support horizontal pointer scrubbing in `0.1` steps. Projectors show a target marker and dashed source-to-target line in the X/Z view. Dragging a manual marker edits Look At X/Z; selecting a surface locks the marker to that surface centre. Dragging objects preserves the pointer offset and optional snapping can use the 1 m grid, 0.1 m grid, stage centre/edges, same-type coordinates, and mirrored distances.

Every successful create/update returns a type-specific readback. The planner compares position, rotation, and planar geometry to the requested values with a `0.001` metre/degree tolerance before recording the sync version.

## Synchronization

```text
planner state -> inspect Designer -> classify -> diff -> confirm -> selective API calls -> save mappings
```

- Managed: a `dsg-*` path or a stored UID mapping.
- Standard: a recognized default name/path such as `surface 1` or `projector 1`.
- Manual: everything else.

Update mode may adopt a same-type standard object and update it in place. Clean mode creates a new managed set and exposes remaining standards in the deletion checklist. Orphans are reported but never automatically deleted.

The adapter repeats the default/managed check before deletion. Repeat sync resolves a managed object by Designer UID, saved resource path, or its `dsg-*` path. Dangling references left in Designer stage collections after deletion are skipped and reported as inspection warnings; a managed object absent from the valid inspection result is recreated. API errors stop the operation and include the failing planner object plus the Designer HTTP response; the UI never reports a false successful sync. Startup probes `/api/session/status/session` with a short timeout, while create/update calls have a longer timeout.

## Persistence

Browser state uses localStorage key `disguise-scene-generator-state-v8`. It is runtime state, not project history. Durable knowledge lives in Git, Markdown, schema, and fixtures. The v2-v7 keys are read only as migration sources.
