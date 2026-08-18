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
10. Load a v6 screen with `Y=0`; v10 must preserve its object world Y and convert the old stage-top floor reference correctly.
11. Load a v7 plan with base `floorY=0.4`; v10 must keep `0.4` rather than subtracting stage height again.

## Physical UI and numeric input scenarios

1. Reload the page: the left rail contains grouped object names only; no object parameters appear inside it.
2. Press each top `+` command: exactly one object is added, selected, and shown in the fixed active-object strip.
3. Enter `1,5` and `1.5` in a coordinate field; both must store `1.5`.
4. Temporarily clear a field; the model must retain its previous value rather than writing zero.
5. Scroll over a metric or density field; each wheel event changes it by `0.1`. Scroll over an angle; it changes by `1°`. Horizontal pointer movement over an input must do nothing.
6. Add an object after entering comma-formatted room/stage values; the room/stage dimensions must remain unchanged.
7. For an LED screen, switch between `Разрешение`, `PPI`, and `Шаг`; only the selected mode is visible and hidden values recalculate. For a projection surface, verify only size, position/yaw, and resolution. For a projector, verify only lens position, target/surface, and resolution with no rotation input.
8. Toggle "Отсчитывать высоту объектов от сцены": a screen at world Y `0.8` displays `0` when stage top is `0.8`, then returns to `0.8` when unchecked.
9. Select every object type; the canvas bounding-box height must not change.
10. Verify the active strip stays one fixed-height horizontal row and scrolls horizontally when the host window is narrow.
11. Verify lights and cameras expose no tilt field, only position and horizontal direction/rotation.
12. Link a projector to a surface and move the surface; the projector target marker and exported Look At must follow its centre.
13. Switch the projector to `Ручная точка на плане` and drag the marker; only Look At X/Z change.
14. Scroll over empty canvas; zoom changes by 10% and object coordinates remain unchanged.
15. Enable LIVE and verify a WebSocket connection to `ws://127.0.0.1/api/session/liveupdate`; no HTTP polling loop is started. If the host has no WebSocket runtime, LIVE must revert to off with a clear error and manual Synchronize must remain available.

## Direct manipulation scenarios

Before these scenarios, verify the numeric workflow: screen/surface `Ширина -> Высота -> Высота от пола/сцены` advances on Enter, clicking an input selects all text, `4` displays as `4`, `1.5` as `1,5`, and negative world heights remain negative. LIVE should connect through the official WebSocket when the host supports it; manual synchronization remains available.

The `Очистить сцену` button requires confirmation, removes planner objects and keeps their Designer mappings as orphans; it must never call Designer deletion automatically.

1. Right-click empty plan space and choose each equipment type; every object must be created at the clicked world X/Z.
2. Create a screen or surface this way; width receives keyboard focus, and Enter commits it and moves focus to height.
3. Create a projector; its visible Look At point must follow the cursor until the next left click fixes the target.
4. Select an LED screen or projection surface; its rotation handle must appear outside the top-right corner with a connector line.
5. Press the handle without moving it; yaw must not jump. Drag it to `30°`; X/Z, height, dimensions, and resolution must remain unchanged.
6. Ctrl-drag an object; an independent copy starts at the same coordinate and follows the pointer while the original remains in place.
7. Shift-click one object; all objects of that type must highlight. Drag any highlighted member; all selected objects retain their relative X/Z offsets and remain inside the room.
8. Right-click an object; the menu must show duplicate, 90-degree rotation, mirror X/Z, and confirmed deletion. A projector with available surfaces also shows surface binding.
9. Plain context-menu duplicate adds `0.5 m` on X and receives a new readable name, plugin ID, and empty Designer mapping.
10. Mirror a screen at `X=-6`, `Z=-3`, yaw `30°` around a stage centred at zero. X mirror must produce `(6,-3,-30°)`; Z mirror must produce `(-6,3,150°)`.
11. Mirror a projector with a manual Look At point; position and target must mirror together. A projector linked to a surface must become an independent manual-target copy.
12. Use Undo after every command; the original object and selection must be restored without leaving duplicate sync records.

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

## Current v10.8 checks

1. Reload the planner with an open Designer project. The room floor size/position and supported physical objects in typed collections or `stage.children` must appear in the 2D model. `internal/*`, `LookAtManipulable`, `Puck`, and other non-physical helpers must not appear.
2. Toggle `Stage`. When checked, a managed `dsg-scene-cube.apx` appears in Designer with stage dimensions and is visible. When unchecked, no automatic deletion occurs. Change Stage `X/Z` fields and verify the cube moves; dragging the Stage outline does nothing.
3. Set stage `floorY=1` and an object world `Y=1`. With `Y relative to Scene` enabled it displays `0`; entering `-3` stores world `Y=-2`. Turning the checkbox off shows `-2`.
4. Import a projector with non-zero Designer `configRotation`; the 2D model preserves it, while the projector inspector still exposes only position, Look At, and resolution.
5. Enable LIVE and confirm the status reports a WebSocket connection. If the host rejects WebSocket, confirm LIVE returns to off with the error visible and `Synchronize` remains enabled.
6. A narrow screen or surface is selectable only inside its rendered rectangle/thickness. A click 10 CSS pixels outside is not a hit.
7. Change an object name in the active property strip, reload, and verify the local name remains associated with the stored Designer UID/path.
8. Verify strict readback: a `0.0001` coordinate mismatch is reported rather than accepted by tolerance.
9. Select a projector, choose a named surface in `Look At surface`, and verify that the surface name and outline are highlighted on the plan.
10. Open the Look At selector and move through surfaces before committing; the corresponding surface name and outline must preview immediately, then revert on blur if no choice was committed.
11. Delete a mapped object in Designer while it remains in the planner. The next inspection must show `Missing in Designer: 1`, send no create call, and leave the planner object untouched.
12. Rename a planner object to `surface1`, synchronize, and verify the Designer resource description/path is `surface1`, not `dsg-*`.
13. Synchronize with a changed Stage and verify no `stage.floor_size =` script is sent; `stage.floor_pos` succeeds without the Starter `Field` exception.
14. Run the confirmed default deletion flow and verify the adapter calls `saveOnDelete()` and `resourceManager.remove(path)`; collection detachment alone is not sufficient.
15. Inspect a concrete `Camera` and verify readback uses `offset/rotation` only.
