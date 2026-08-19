# Disguise Scene Planner

Scene Planner is an embedded Disguise Designer plugin for planning supported scene equipment in a top X/Z view and keeping mapped Designer resources synchronized.

The fixed left panel contains Scene width/depth, grouped objects, and the selected object's properties. The remaining window is the 2D plan. Undo/redo overlay the top-left of the plan; Magnet and zoom overlay the top-right. Objects are added from the empty-canvas context menu. The supported types are LED Screen, DMX Screen, Projection Surface, DMX Light, Projector, and Camera.

Camera, projector, and light direction can be changed after placement. Projector direction is represented by `configLookAt`, not body rotation. Default install heights are Camera `1.5 m`, DMX Light `5 m`, Projector `3 m`, and planar objects `0 m`; each type remembers its last edited height.

LIVE uses the official WebSocket endpoint `ws://<director>/api/session/liveupdate` with `subscribe`, `valuesChanged`, `set`, and `unsubscribe`. The Director is discovered through `?director=` or `window.DISGUISE_DIRECTOR`. Transient disconnects retain LIVE intent and trigger backoff reconnect/resubscribe. Resource creation, rename, and deletion use the Python Execution API; `object.description` is read-only in LIVE and names are changed with `Resource.rename`.

Projectors use only `Projector.configPosition` and `Projector.configLookAt`. Designer body `rotation` and `configRotation` are not imported into the Planner contract. The adapter exposes a read-only `projectorReadbackProbe` for release validation.

The internal model still stores Scene dimensions under the legacy `stage` key, and inspection uses Designer's technical `stage.children` collection. Neither represents an additional user-facing Stage object.

## Install And Verify

Place this directory under the Designer project's `plugins/scene-planner-prototype` folder with `d3plugin.json` at its root, or deploy the tracked source with:

```powershell
.\scripts\deploy-plugin.ps1 -ProjectPath 'D:\Disguise\Projects\start'
npm run release-check
```

The complete embedded Designer smoke checklist is in the repository root `TESTING.md`.
