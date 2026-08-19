# Testing

## Automated Release Gate

From the repository root run:

```powershell
npm run release-check
```

This checks JavaScript syntax, the planner model/UI contract, projector protocol contract, LIVE state machine, resource lifecycle, and whitespace errors.

## Local UI

```powershell
py -m http.server 4173 --directory scene-planner-prototype
```

Open `http://127.0.0.1:4173/`. The standalone host is for UI and gesture checks; Designer API and embedded-host behavior must also be tested inside Designer.

Verify:

1. The left panel stays fixed-width and contains Scene width/depth, grouped objects, and selected-object properties.
2. Resizing the window changes only the 2D area. No Objects toggle, Clear Plan, X/Z centre buttons, logo strip, or bottom status strip appears.
3. Undo/redo overlay top-left; Magnet and zoom overlay top-right. Zoom stays within `10-300%`; clicking its value restores `100%` and the initial pan.
4. Left-drag on empty canvas pans. Right-click on an input restores its defined default.
5. Right-click empty canvas and create all six supported types at the clicked X/Z coordinate.
6. New objects focus Height. Initial heights are Camera `1.5`, DMX Light `5`, Projector `3`, and planar types `0`; a second object of the same type reuses that type's last edited height.
7. Camera and DMX light show top-view direction icons and numeric Yaw controls. Projectors show a draggable Look At marker and no rotation handle.
8. A manual projector target is displayed as rounded coordinates in the Look At selector. Target dragging changes X/Z and only clears a surface binding after drag actually starts.
9. Ctrl-drag does not duplicate in the embedded Designer host. Use the object context menu or planner Ctrl+C/Ctrl+V clipboard instead. Pointerup, pointercancel, lost capture, window blur, and tab hiding leave no stale drag state.
10. Ctrl+C/Ctrl+V uses the internal object clipboard. Shift/Ctrl-click multi-selection keeps relative offsets during group drag.

## Designer Installation

Deploy the tracked source and verify hashes:

```powershell
.\scripts\deploy-plugin.ps1 -ProjectPath 'D:\Disguise\Projects\start'
```

Close and reopen the plugin window. Confirm the title contains the current version and repeat the embedded-host interaction checks; browser preview alone is not sufficient.

## Designer API Smoke

With Designer and a disposable project open:

```powershell
Invoke-RestMethod 'http://127.0.0.1/api/session/status/session'
$body = @{ script = 'return 1' } | ConvertTo-Json
Invoke-RestMethod 'http://127.0.0.1/api/session/python/execute' -Method Post -ContentType 'application/json' -Body $body
```

Both calls must succeed. Proxy software must bypass localhost, the Director hostname, and the relevant private-network range.

## Coordinate And Projector Contract

1. A `20 x 12 m` Scene has bounds `X=-10..10`, `Z=-6..6` around world origin.
2. A screen with width `4`, height `2`, position `(3,0,-5)`, yaw `0` writes Designer `offset=(3,1,-5)`, `scale=(4,2,0.1)`, `rotation=(0,0,0)`.
3. Changing object Y does not move its top-view position.
4. A projector at `(3,2.5,-5)` looking at `(0,0.8,0)` writes and reads `configPosition/configLookAt`. Body `offset/rotation` and `configRotation` are not part of the Planner contract.
5. Run `node tests/projector-contract.test.cjs`, then run the adapter's read-only `projectorReadbackProbe` against a real disposable Designer projector. The probe must not mutate the resource.
6. Treat `configThrowRatio` and `configLensShift` as a separate compatibility probe. Do not expose distortion, skew, or warp fields without a verified Designer-version contract.

## LIVE/WebSocket Smoke

1. Open the plugin with a valid `?director=<host>` and enable LIVE. Confirm connection to `ws://<director>/api/session/liveupdate`.
2. Confirm initial subscriptions complete before any `set` is sent.
3. Move one mapped object in Planner; only changed writable scalar fields are sent. `object.description` may be subscribed for readback but must never appear in a `set` payload.
4. Move the object in Designer; Planner updates without echoing the remote value back as a new local write.
5. Close the socket. LIVE remains enabled, displays reconnecting status, reconnects with backoff, and resubscribes.
6. Remove a mapped object from the binding set and confirm `unsubscribe` is sent.
7. Force a set error. Diagnostics must retain the error; the binding clears `inFlight` and remains `dirty` for recovery.
8. Create/delete supported objects in Designer and confirm technical collection subscriptions reconcile the Scene without loops or duplicate resources.

## Resource Lifecycle

Use disposable resources only.

1. Repeat create/update with the same planner object and verify no duplicate Designer resource appears after retry/timeout.
2. Rename through Planner and confirm the adapter calls `Resource.rename(Path(...))`, updates the stored path, and does not write `Resource.description`.
3. Delete a selected managed/default resource and confirm the Stage reference disappears first, then `saveOnDelete()` plus `resourceManager.remove(path)` remove the Resource list entry.
4. Create an object whose requested name already exists in the Resource list; confirm the next numeric name is used and shown in the Planner.
5. Rename an object to an existing Resource list name; confirm the rename is rejected, the Planner name is restored, and the error identifies the Designer Resource list.
6. A deleted mapped object must not be recreated automatically by the next inspection or LIVE event.
7. Manual/unowned Designer objects remain protected.
8. Startup inspection deduplicates typed collections and technical `stage.children` entries by UID and ignores internal helpers, MR Sets, and Skeletons.

## Release Evidence

Before packaging or submitting to Disguise, retain:

- the clean commit hash;
- `npm run release-check` output;
- deployed source/hash verification;
- one embedded Designer interaction smoke result;
- one real LIVE handshake/reconnect result;
- one real projector configPosition/configLookAt readback result;
- supported Designer version and contact/install notes.
