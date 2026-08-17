# Architecture

## Components

`scene-planner-prototype/index.html` and `styles.css` provide the Russian UI. `app.js` owns the scene model, 2D canvas, local persistence, diff, and synchronization workflow. `designer-adapter.js` is the only layer that creates Python scripts or calls Designer HTTP endpoints.

## Scene model

```text
room: { width, depth, height }
object:
  pluginId
  type, name
  position: { x, y, z }
  rotation: { x, y, z }
  verticalRef: { from, to }
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

The room is centred on the Designer world origin. Its plan bounds are `X = -width/2 ... +width/2` and `Z = -depth/2 ... +depth/2`; `X=0, Z=0` is the visual centre of the 2D plan. The grid interval is always 1 m.

Dragging updates `position.x` and `position.z` only. `stage.floor_pos.y` is recorded during inspection. Absolute `position.y` remains the saved truth even when `verticalRef` describes floor/podium and bottom/center/top intent.

Screen and surface scale is `Vec(width, thickness, height)`. Plan yaw is Designer `rotation.y`; the inspector also exposes `rotation.x` and `rotation.z`.

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

Browser state uses localStorage key `disguise-scene-generator-state-v4`. It is runtime state, not project history. Durable knowledge lives in Git, Markdown, schema, and fixtures. The v2 and v3 localStorage keys are read only as migration sources.
