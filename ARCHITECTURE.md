# Architecture

## Components

`scene-planner-prototype/index.html` and `styles.css` provide the Russian UI. `app.js` owns the scene model, 2D canvas, local persistence, diff, and synchronization workflow. `designer-adapter.js` is the only layer that creates Python scripts or calls Designer HTTP endpoints. It creates resources in class-named folders, marks them dirty before mutation, and saves them after successful changes.

## Scene model

```text
room: { centerX, centerZ, floorY, width, depth, height }
object:
  pluginId
  type, name
  transform:
    position: { x, y, z }
    rotation: { x, y, z }
  geometry: { width, height }  # screen/surface only
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

The room is a viewport frame and never changes object coordinates. Its bounds are `centerX +/- width/2` and `centerZ +/- depth/2`. The grid interval is always 1 m and its labels show absolute Designer values.

Dragging updates `transform.position.x/z` only. The numeric `Y` is always absolute. `floorY` initializes generated heights but is not an object-relative transform.

For screens and surfaces, position is the bottom centre. The adapter writes `offset = Vec(X, Y + height/2, Z)`, `scale = Vec(width, height, 0.1)`, and `rotation = Vec(0, yaw, 0)`. Projectors use `configPosition/configRotation` and mirror them to the body transform. Cameras use `posRelativeOrGlobal/rotRelativeOrGlobal`. Lights use `offset/rotation`.

Every successful create/update returns a type-specific readback. The planner compares position, rotation, and planar geometry to the requested values with a `0.001` metre/degree tolerance before recording the sync version.

## Synchronization

```text
planner state -> inspect Designer -> classify -> diff -> confirm -> selective API calls -> save mappings
```

- Managed: a `dsg-*` path or a stored UID mapping.
- Standard: a recognized default name/path such as `surface 1` or `projector 1`.
- Manual: everything else.

Update mode may adopt a same-type standard object and update it in place. Clean mode creates a new managed set and exposes remaining standards in the deletion checklist. Orphans are reported but never automatically deleted.

The adapter repeats the default/managed check before deletion. Repeat sync resolves a managed object by Designer UID, saved resource path, or its `dsg-*` path. Dangling references left in Designer stage collections after deletion are skipped and reported as inspection warnings; a managed object absent from the valid inspection result is recreated. API errors stop the operation and include the failing planner object plus the Designer HTTP response; the UI never reports a false successful sync.

## Persistence

Browser state uses localStorage key `disguise-scene-generator-state-v5`. It is runtime state, not project history. Durable knowledge lives in Git, Markdown, schema, and fixtures. The v2-v4 keys are read only as migration sources.
