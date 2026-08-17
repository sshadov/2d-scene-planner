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

For local Designer discovery, place the contents of `scene-planner-prototype` in the open Designer project's `Plugins/DisguiseScenePlanner` folder, keeping `d3plugin.json` at the plugin root. Restart or refresh plugin discovery after file changes.

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
2. Move the independent stage centre to `X=4, Z=-2`; existing object coordinates must not change.
3. Set a screen to width `4`, height `2`, `X=3`, bottom `Y=0`, `Z=-5`, yaw `0`.
4. Export and verify Designer `offset=(3,1,-5)`, `scale=(4,2,0.1)`, `rotation=(0,0,0)`; readback bottom is `Y=0`.
5. Set screen bottom `Y=1.5`; it must occupy the vertical range `1.5..3.5`.
6. Change `Y`; the canvas position must not move. Click the object away from its centre; coordinates must not change. Drag it; only absolute `X/Z` may change and the original cursor offset must be preserved.
7. Set a projector to `(3,2.5,-5)` and verify only `configPosition/configRotation` are written and read back. Its body `offset/rotation` are not mirrored.
8. Verify a camera uses `posRelativeOrGlobal/rotRelativeOrGlobal`, and a light uses `offset/rotation`.
9. Verify projector, camera, and light direction cones follow `Ry` in the top view.
10. Force a readback difference above `0.001`; sync must stop and display the mismatched field.
11. Load a v5 screen with `Y=0`; v6 must preserve it as bottom-edge `Y=0`.

## Sidebar and numeric input scenarios

1. Reload the page: all type groups and object properties start collapsed.
2. Press a group `+`: exactly one object is added, its group opens, and the new object's properties open.
3. Enter `1,5` and `1.5` in a coordinate field; both must store `1.5`.
4. Temporarily clear a field; the model must retain its previous value rather than writing zero.
5. Hold the primary mouse button over a numeric field and move horizontally; every 8 px changes the value by `0.1 m` for metric fields.
6. Add an object after entering comma-formatted room/stage values; the room/stage dimensions must remain unchanged.
7. For an LED screen, verify width, height, resolution X/Y, and pixel pitch are editable. For a projector, verify resolution X/Y is editable.

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
