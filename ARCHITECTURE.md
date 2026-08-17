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

The adapter repeats the default/managed check before deletion. API errors stop the operation and remain visible; the UI never reports a false successful sync.

## Persistence

Browser state uses localStorage key `disguise-scene-generator-state-v3`. It is runtime state, not project history. Durable knowledge lives in Git, Markdown, schema, and fixtures. The v2 localStorage key is read only as a migration source.

