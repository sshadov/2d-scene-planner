# Disguise Scene Planner

Scene Planner is an embedded Disguise Designer plugin for planning supported scene equipment in a top X/Z view and keeping mapped Designer resources synchronized.

The fixed left panel contains Scene width/depth, grouped objects, and the selected object's properties. The remaining window is the 2D plan. Magnet and zoom overlay the top-right. Objects are added from the empty-canvas context menu. The supported types are LED Screen, DMX Screen, Projection Surface, DMX Light, Projector, and Camera.

Camera, projector, and light direction can be changed after placement. Projector direction is represented by `configLookAt`, not body rotation. Default install heights are Camera `1.5 m`, DMX Light `5 m`, Projector `3 m`, and planar objects `0 m`; each type remembers its last edited height.

LIVE uses the official WebSocket endpoint `ws://<director>/api/session/liveupdate` with `subscribe`, `valuesChanged`, `set`, and `unsubscribe`. It only exchanges values for objects with a confirmed Designer UID and passively observes Stage collection changes; reconnect and synchronization never create resources. Add/Duplicate/Paste and committed Projector placement use one explicit Python Execution API create operation. Rename checks the destination Resource-list path and uses `Resource.rename`; a collision restores the previous Planner name. Delete resolves the exact typed Stage instance, calls `remove(instance)` on its owning typed collection, saves and verifies that collection without replacing its `ArrayBox`, and leaves the Device/Resource list entry by default. The single Delete confirmation includes an optional `Delete from Device list` checkbox for explicit package cleanup; imported objects are marked with a separate `Imported from Designer` line. Designer rejects browser downloads, so scene JSON and diagnostics are copied to the clipboard.

Hosted startup treats the current Designer Stage as authoritative, blocks automatic LIVE until transport safety is accepted when needed, and requires a complete scene import. The transport check is read-only: Planner never stops playback or saves all project resources during startup. The single Diagnostics panel shows Planner, Python API, and LIVE events in chronological order. Resolution is synchronized through the inherited `Display.resolution` property for LED Screen, DMX Screen, Surface, and Projector.

Projectors use public `Projector.configPosition`, `Projector.configLookAt`, and `Projector.configThrowRatio`. Each local geometry change sends the latest Position and Look At together through LIVE, at most every 40 ms, with a final resend after movement stops. A bound Projection Surface also sends the calculated Throw Ratio; Designer owns read-only Look Distance and Field of View. The final delayed rotation update forces only `configRotation.z` to 0 or 90 degrees while preserving X/Y. Designer body `rotation` is not imported into the Planner contract. The adapter exposes a read-only `projectorReadbackProbe` for release validation.

When a Projector is added, its temporary Look At point follows the cursor. The primary click commits Look At and then focuses Projector height; Designer creation is deferred until that commit. Designer numeric readback is accepted within `0.001 m`, and a returned UID/path is stored before validation so a readback error cannot create a duplicate on retry.

The internal model still stores Scene dimensions under the legacy `stage` key, and inspection uses Designer's technical `stage.children` collection. Neither represents an additional user-facing Stage object.

## Install And Verify

Place this directory under the Designer project's `plugins/scene-planner-prototype` folder with `d3plugin.json` at its root, or deploy the tracked source with:

```powershell
.\scripts\deploy-plugin.ps1 -ProjectPath 'D:\Disguise\Projects\start'
npm run release-check
```

The complete embedded Designer smoke checklist is in the repository root `TESTING.md`.
