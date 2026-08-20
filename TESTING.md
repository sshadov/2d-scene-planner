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
6. New planar objects focus Width; Camera and DMX Light focus Height. A new Projector first moves its Look At point with the cursor, commits it on primary click, and then focuses Height. Initial heights are Camera `1.5`, DMX Light `5`, Projector `3`, and planar types `0`; a second object of the same type reuses that type's last edited height.
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

### Correlating Designer errors

The `LIVE log` button opens a combined diagnostics stream. It includes local Planner actions (`create`, `duplicate`, `delete`), Python API request/response/error records with an `opId`, and Live Update WebSocket messages sorted by timestamp.

For an intermittent Designer error:

1. Open `LIVE log` and clear the existing entries by reloading the plugin window.
2. Perform one action only: add a DMX device, duplicate a projector, or delete one object.
3. Note the Designer error timestamp and find the nearest preceding `request`/`response` or `error` entry with the same UID/path.
4. Repeat the same action once more if the first run is clean; do not combine duplicate, rename, and delete in one trial.

This distinguishes a Planner/API operation from a later asynchronous Stage notification and avoids relying on the order in which Designer's Preferences UI happens to refresh.

1. Open the plugin with a valid `?director=<host>` and enable LIVE. Confirm connection to `ws://<director>/api/session/liveupdate`.
2. Confirm initial subscriptions complete before any `set` is sent.
3. Move one mapped object in Planner; only changed writable scalar fields are sent. `object.description` may be subscribed for readback but must never appear in a `set` payload.
4. Move the object in Designer; Planner updates without echoing the remote value back as a new local write.
5. Close the socket. LIVE remains enabled, displays reconnecting status, reconnects with backoff, and resubscribes.
6. Remove a mapped object from the binding set and confirm `unsubscribe` is sent.
7. Force a set error. Diagnostics must retain the error; the binding clears `inFlight` and remains `dirty` for recovery.
8. Create/delete supported objects in Designer and confirm technical collection subscriptions reconcile the Scene without loops or duplicate resources.
9. Create a Projector, commit Look At, mirror-copy it, and change the copy's Surface. Confirm exactly one new Designer Projector exists and later edits do not issue another create.

## Resource Lifecycle

Use disposable resources only.

1. Repeat create/update with the same planner object and verify no duplicate Designer resource appears after retry/timeout.
2. Rename through Planner and confirm the adapter calls `Resource.rename(Path(...))`, updates the stored path, and does not write `Resource.description`.
3. Delete a selected managed/default resource and confirm the Stage reference disappears first while the Device/Resource list entry remains by default. Repeat with `Delete from Device list` checked and confirm `saveOnDelete()` plus `resourceManager.remove(path)` remove only the owned package resources.
4. Create an object whose requested name already exists in the Resource list; confirm the next numeric name is used and shown in the Planner.
5. Rename an object to an existing Resource list name; confirm the rename is rejected, the Planner name is restored, and the error identifies the Designer Resource list.
6. A deleted mapped object must not be recreated automatically by the next inspection or LIVE event.
7. Imported/manual Designer objects are physically removed only through the explicit `Delete from Designer?` confirmation. Confirm the request uses the exact selected UID/path and removes the typed Stage reference before discovered dependencies.
8. Startup inspection deduplicates typed collections and technical `stage.children` entries by UID and ignores internal helpers, MR Sets, and Skeletons.
9. Delete an imported object once, wait for LIVE reconciliation, and confirm its UID is absent from every typed Stage collection and does not reappear in Planner. The Delete dialog shows a separate `Imported from Designer` line above the unchanged `Delete object?` prompt.
10. Delete a Planner-owned object, press Planner Undo, and confirm LIVE recreates it in Designer when its old UID/path is absent.

### Composite Device Smoke

With the disposable `scenegen2` project active, run:

```powershell
python scripts/diagnose-composite-devices.py --dry-run
python scripts/diagnose-composite-devices.py --kind all
```

The live command uses `debugScripts.createScript` and `debugScripts.deleteManagedScript` from the tracked adapter. It creates only `dsg-smoke-*` resources and checks:

1. DMX Light is a healthy `FixtureGroup` in `stage.dmxLights`.
2. Camera is healthy and owns one healthy `PerspectiveProjectionObject` linked to a named `PerspectiveProjection`.
3. Projector and its named `ProjectorConfig` are healthy; Designer returns derived field of view and look distance.
4. Cleanup calls `Object.remove()` on the exact instance resolved from the typed Stage collection before the main, child/config, and `DirectProjection` package resources. It never assigns a Python list to a typed Stage property.
5. Cleanup is restricted to the explicit `ownedPaths` returned by creation; imported/manual resources are never accepted by managed deletion.
6. No `dsg-smoke-*` typed Stage entry, `stage.children` entry, or package resource reappears during the cleanup stability window, and the UIDs/classes of manual `1`, `2`, `3`, `cam1`, `projector 1`, and `surface 1` resources are unchanged.

Run one kind at a time with `--kind dmxLight`, `--kind camera`, or `--kind projector` when isolating a Designer failure. Do not run this against a production project.

## Release Evidence

Before packaging or submitting to Disguise, retain:

- the clean commit hash;
- `npm run release-check` output;
- deployed source/hash verification;
- one embedded Designer interaction smoke result;
- one real LIVE handshake/reconnect result;
- one real projector configPosition/configLookAt readback result;
- supported Designer version and contact/install notes.
