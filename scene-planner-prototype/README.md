# Disguise Scene Planner

Scene Planner is an embedded Disguise Designer plugin for planning supported scene equipment in a top X/Z view and keeping mapped Designer resources synchronized.

The fixed left panel contains Scene width/depth, grouped objects, and the selected object's properties. The remaining window is the 2D plan. Undo/redo overlay the top-left of the plan; Magnet and zoom overlay the top-right. Objects are added from the empty-canvas context menu. The supported types are LED Screen, DMX Screen, Projection Surface, DMX Light, Projector, and Camera.

Camera, projector, and light direction can be changed after placement. Projector direction is represented by `configLookAt`, not body rotation. Default install heights are Camera `1.5 m`, DMX Light `5 m`, Projector `3 m`, and planar objects `0 m`; each type remembers its last edited height.

LIVE uses the official WebSocket endpoint `ws://<director>/api/session/liveupdate` with `subscribe`, `valuesChanged`, `set`, and `unsubscribe`. It only exchanges values for objects with a confirmed Designer UID and passively observes Stage collection changes; reconnect and synchronization never create resources. Add/Duplicate/Paste and committed Projector placement use one explicit Python Execution API create operation. Rename checks the destination Resource-list path and uses `Resource.rename`; a collision restores the previous Planner name. Delete resolves the exact typed Stage instance, calls `remove(instance)` on its owning typed collection, saves and verifies that collection without replacing its `ArrayBox`, and leaves the Device/Resource list entry by default. The single Delete confirmation includes an optional `Delete from Device list` checkbox for explicit package cleanup; imported objects are marked with a separate `Imported from Designer` line. Designer rejects browser downloads, so scene JSON and diagnostics are copied to the clipboard.

Projectors use public `Projector.configPosition`, `Projector.configLookAt`, and `Projector.configThrowRatio`. Each local geometry change sends `configPosition` and `configLookAt` together through LIVE. Designer owns read-only Look Distance and field of view. Auto optics with a bound Projection Surface sends only Throw Ratio; the final rotation mode may narrowly write `configRotation.z` while preserving its X/Y values. Designer body `rotation` is not imported into the Planner contract. The adapter exposes a read-only `projectorReadbackProbe` for release validation.

When a Projector is added, its temporary Look At point follows the cursor. The primary click commits Look At and then focuses Projector height; Designer creation is deferred until that commit. Designer numeric readback is accepted within `0.001 m`, and a returned UID/path is stored before validation so a readback error cannot create a duplicate on retry.

The internal model still stores Scene dimensions under the legacy `stage` key, and inspection uses Designer's technical `stage.children` collection. Neither represents an additional user-facing Stage object.

## Install And Verify

Place this directory under the Designer project's `plugins/scene-planner-prototype` folder with `d3plugin.json` at its root, or deploy the tracked source with:

```powershell
.\scripts\deploy-plugin.ps1 -ProjectPath 'D:\Disguise\Projects\start'
npm run release-check
```

The complete embedded Designer smoke checklist is in the repository root `TESTING.md`.
