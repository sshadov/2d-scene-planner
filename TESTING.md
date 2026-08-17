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

1. Select an object and note its position on canvas.
2. Change `Y`; the canvas position must not move.
3. Change `Z`; the object must move along plan depth.
4. Drag the object; only `X/Z` may change.
5. Set `Rx/Ry/Rz`, export, and inspect the payload order.
6. For a screen/surface verify Designer scale is width/thickness/height.

## Safe synchronization scenarios

1. Empty scene: all planner objects are `create`.
2. `fixtures/standard-scene.json`: matching defaults are `adopt/update` in update mode.
3. Manual object: it is counted under protected objects and receives no API call.
4. Second export without planner edits: all mapped objects are unchanged.
5. Change one coordinate: exactly one update is sent with the changed axis.
6. Delete a planner object: its Designer counterpart remains as an orphan.
7. Clean mode: defaults appear in the checklist; deletion requires checkboxes and browser confirmation.
8. Reload the page: plugin-to-Designer mappings are restored from local persistence.

