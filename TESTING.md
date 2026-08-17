# Testing

## Local UI

From the repository root:

```powershell
py -m http.server 4173 --directory scene-planner-prototype
```

Open `http://127.0.0.1:4173/`. If port 4173 is already used by this project, reuse the running server.

Static checks:

```powershell
node --check scene-planner-prototype/app.js
node --check scene-planner-prototype/designer-adapter.js
Get-Content -Raw scene-planner-prototype/d3plugin.json | ConvertFrom-Json
Get-Content -Raw schemas/scene.schema.json | ConvertFrom-Json
```

## Designer plugin placement

For local Designer discovery, place the contents of `scene-planner-prototype` in the open Designer project's `plugins/scene-planner-prototype` folder, keeping `d3plugin.json` at the plugin root. Restart or refresh plugin discovery after file changes.

For the current project layout, deploy the tracked source with hash verification:

```powershell
.\scripts\deploy-plugin.ps1 -ProjectPath 'D:\Disguise\Projects\start'
```

Close and reopen the plugin window after deployment. A page served from `127.0.0.1:4173` and the plugin embedded in Designer are separate copies; refreshing one does not update the other.

The standalone server is useful for UI work. Actual API behavior must also be tested from the Designer plugin host because cross-origin policy can differ.

## Designer API smoke test

Start Designer and open a project, then run:

```powershell
Invoke-RestMethod 'http://127.0.0.1/api/session/status/session'

$body = @{ script = 'return 1' } | ConvertTo-Json
Invoke-RestMethod 'http://127.0.0.1/api/session/python/execute' -Method Post -ContentType 'application/json' -Body $body
```

An HTTP 200 and a successful return value prove that the local session and Python endpoints are available. If they fail, the UI remains usable and JSON export still works, but live synchronization must be treated as unavailable.

## Free Designer Starter

Do not infer plugin support only from the license name. Test the two endpoints above in the actual installed version. When both are available, run the safe scene scenarios below. If plugin discovery is unavailable but the endpoints work, use the standalone UI for development and verify the final host integration in a supported Designer environment.

## v2rayN

Use direct/bypass rules for:

```text
127.0.0.1
localhost
*.local
192.168.0.0/16
10.0.0.0/8
172.16.0.0/12
```

The supported local test addresses are UI `http://127.0.0.1:4173/` and Designer API `http://127.0.0.1/`. Do not use a machine `.local` hostname while diagnosing the 502 path.

## Coordinate scenarios

1. With a `20 × 12 m` room, verify its bounds are `X=-10..10`, `Z=-6..6` and the world origin is at the centre.
2. Set a screen to width `4`, height `2`, `X=3`, bottom `Y=0`, `Z=-5`, yaw `0`.
3. Export and verify Designer `offset=(3,1,-5)`, `scale=(4,2,0.1)`, `rotation=(0,0,0)`; readback bottom is `Y=0`.
4. Set screen bottom `Y=1.5`; it must occupy the vertical range `1.5..3.5`.
5. Change `Y`; the canvas position must not move. Click the object away from its centre; coordinates must not change. Drag it; only absolute `X/Z` may change and the original cursor offset must be preserved.
6. Set a projector to `(3,2.5,-5)` with Look At `(0,0.8,0)` and verify `configPosition/configLookAt` are written and read back. Its body `offset/rotation` and `configRotation` are not changed.
7. Verify a camera resource is class `Camera` and uses `offset/rotation`; a light also uses `offset/rotation`.
8. Verify the projector cone and target marker follow its Look At point and camera/light cones follow `Ry` in the top view.
9. Force a readback difference above `0.001`; sync must stop and display the mismatched field.
10. Load a v6 screen with `Y=0`; v9 must preserve its object world Y and convert the old stage-top floor reference correctly.
11. Load a v7 plan with base `floorY=0.4`; v9 must keep `0.4` rather than subtracting stage height again.

## Sidebar and numeric input scenarios

1. Reload the page: all type groups and object properties start collapsed.
2. Press a group `+`: exactly one object is added, its group opens, and the new object's properties open.
3. Enter `1,5` and `1.5` in a coordinate field; both must store `1.5`.
4. Temporarily clear a field; the model must retain its previous value rather than writing zero.
5. Hold the primary mouse button over a numeric field and move horizontally; every 8 px changes the value by `0.1 m` for metric fields.
6. Add an object after entering comma-formatted room/stage values; the room/stage dimensions must remain unchanged.
7. For an LED screen, verify width, height, resolution X/Y, and PPI are editable. For a projection surface, verify the same fields except PPI. For a projector, verify resolution X/Y is editable.
8. Toggle "Отсчитывать высоту объектов от сцены": a screen at world Y `0.8` displays `0` when stage top is `0.8`, then returns to `0.8` when unchecked.
9. Expand and collapse an object inspector; the canvas bounding-box height must not change.
10. Verify the `Размер`, `Положение`, and `Разрешение` section fields share one horizontal row whenever they fit.
11. Verify lights and cameras expose no tilt field, only position and horizontal direction/rotation.
12. Link a projector to a surface and move the surface; the projector target marker and exported Look At must follow its centre.
13. Switch the projector to `Ручная точка на плане` and drag the marker; only Look At X/Z change.

## Direct manipulation scenarios

1. Select an LED screen or projection surface; its rotation handle must appear outside the top-right corner with a connector line.
2. Press the handle without moving it; yaw must not jump. Drag it to `30°`; X/Z, height, dimensions, and resolution must remain unchanged.
3. Right-click an object; the menu must show plain duplicate, mirror by X, and mirror by Z commands.
4. Plain duplicate adds `0.5 m` on X and receives a new readable name, plugin ID, and empty Designer mapping.
5. Mirror a screen at `X=-6`, `Z=-3`, yaw `30°` around a stage centred at zero. X mirror must produce `(6,-3,-30°)`; Z mirror must produce `(-6,3,150°)`.
6. Mirror a projector with a manual Look At point; position and target must mirror together. A projector linked to a surface must become an independent manual-target copy.
7. Use Undo after every command; the original object and selection must be restored without leaving duplicate sync records.

## Safe synchronization scenarios

1. Empty scene: all planner objects are `create`.
2. `fixtures/standard-scene.json`: matching defaults are `adopt/update` in update mode.
3. Manual object: it is counted under protected objects and receives no API call.
4. Second export without planner edits: all mapped objects are unchanged.
5. Change one coordinate: exactly one update is sent with the changed axis.
6. Delete a planner object: its Designer counterpart remains as an orphan.
7. Clean mode: defaults appear in the checklist; deletion requires checkboxes and browser confirmation.
8. Reload the page: plugin-to-Designer mappings are restored from local persistence.
9. Replace a stored UID with a stale value while retaining its path: repeat export must recover the existing object by path and must not create a duplicate.
10. Force a Designer Python error: the modal must show the failing object name and the HTTP response body instead of a bare `500`.
11. After every successful write, verify the status says that coordinates were checked.
