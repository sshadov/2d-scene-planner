# Disguise Sources And Reusable Patterns

Research snapshot: 2026-08-19. These notes record what was checked and where the relevant examples live.

## Official Documentation

- [Developer portal](https://developer.disguise.one/) is the index for Designer API, Python API, plugin development, distribution, and data formats.
- [Plugin useful links](https://developer.disguise.one/plugins/useful-links/) links the four official repositories below.
- [Plugin configuration](https://developer.disguise.one/plugins/configuration/) documents `d3plugin.json`, the plugin UI URL, session requirements, and configuration metadata.
- [Designer API introduction](https://developer.disguise.one/api/introduction/) documents the HTTP API surface and links to Sessions and Live Update.
- [Live Update](https://developer.disguise.one/api/session/liveupdate/) is the WebSocket protocol used for subscriptions, value changes, writes, and unsubscription.

## Official Repositories

### `disguise-one/vue-liveupdate`

Repository: <https://github.com/disguise-one/vue-liveupdate>

Important files:

- `README.md` describes the intended one-connection-per-page model.
- `src/composables/useLiveUpdate.js` builds `ws://<director>/api/session/liveupdate` and exposes `subscribe`, `autoSubscribe`, `set`, `unsubscribe`, reconnect, and subscription freeze/thaw.
- `tests/useLiveUpdate.test.js` and `tests/mockLiveUpdateServer.js` are protocol examples with a mock WebSocket server.

Reusable conclusions:

- Subscribe to simple properties with `autoSubscribe`, and use explicit name-to-path mappings for complex properties such as `object.scale.x`.
- A subscription may include `updateFrequencyMs`; the library default is 50 ms.
- A single composable should be shared by the page instead of opening one WebSocket per component.
- Reconnection resubscribes active bindings. `freeze()` unsubscribes temporarily and `thaw()` subscribes again.
- A computed setter emits a Live Update `set` message containing subscription IDs; values arrive through `valuesChanged`.

Our adapter follows the same wire protocol, but keeps explicit binding state and readback because the planner is framework-free and must distinguish desired, remote, dirty, and in-flight values.

### `disguise-one/Designer_Plugin-Live_Update`

Repository: <https://github.com/disguise-one/Designer_Plugin-Live_Update>

Important files:

- `src/App.vue` wires one `useLiveUpdate` instance into the whole tester.
- `src/components/SubscriptionManager.vue` owns a list of object expressions.
- `src/components/PropertySubscription.vue` and `PropertyInput.vue` demonstrate dynamic property subscriptions and writes.
- `src/liveupdate_tester.py` uses `Expression.evaluateFromString` and `rlcompleter` to provide Designer-side property autocomplete.

This is a diagnostic/test plugin, not a scene-planning abstraction. It is useful for checking property paths and Live Update behaviour in a real Designer session.

### `disguise-one/python-plugin`

Repository: <https://github.com/disguise-one/python-plugin>

Important files:

- `README.md` explains `DesignerPlugin`, `d3plugin.json`, DNS-SD publication, and the Client and Functional APIs.
- `src/designer_plugin/designer_plugin.py` registers and closes the plugin's DNS-SD service.
- `src/designer_plugin/d3sdk/session.py` implements `D3Session`/`D3AsyncSession` with `rpc`, `execute`, and module registration.
- `src/designer_plugin/d3sdk/client.py` implements the higher-level `D3PluginClient` pattern.

Reusable conclusions:

- `d3plugin.json` is the normal plugin metadata entry point. `requiresSession` controls whether Designer opens the plugin in a session context.
- The package publishes the local plugin through DNS-SD; this is how a running plugin can be discoverable without hard-coding a URL.
- Designer's remote Python execution is Python 2.7 at runtime. The SDK can accept modern authoring syntax but conversion is not unlimited, so submitted scripts should remain conservative.
- `execute()` returns status and logs; `rpc()` returns the remote value. This is a cleaner boundary than scattering HTTP response parsing through UI code.
- `designer-plugin-pystub`/the local `d3.pyi` are type hints only; stub objects exist in Designer and cannot be instantiated locally.

### `disguise-one/designer-pythonapi`

Repository: <https://github.com/disguise-one/designer-pythonapi>

Important files:

- `README.md` documents the `PythonApiClient` and the Vite loader.
- `src/apiClient.ts` is the HTTP client for registration and execution.
- `src/vite-loader.ts` transforms `.py` modules and generates JavaScript/type definitions.
- `python_support/parse.py` contains the Python-to-JavaScript support layer.

This library is most useful for a TypeScript/Vite plugin that wants generated Python bindings. Our current plain HTML/JavaScript plugin deliberately keeps the adapter local, so adopting the loader would be a larger build-system change, not a required correctness fix.

## Local API Contract Evidence

The authoritative local stub is `D:\Disguise\Vibecode\d3.pyi`.

`class Projector` currently declares writable:

- `configPosition: Vec`
- `configLookAt: Vec`
- `configThrowRatio: float`
- `configLookDistance: float`
- `configLensShift: Vec2`

It also declares read-only `fieldOfView: float`. `class ProjectorConfig` exposes public `throwRatio`, `lookDistance`, `lensShift`, and `fieldOfView`, while underscore fields such as `_throw_ratio` and `_look_distance` are implementation details and are not a plugin contract.

The installed Designer help file `C:\Program Files\d3 Production Suite\build\msvc\d3dlls\help.txt` describes Look distance as the distance from projector to its Look At point, throw ratio as distance from lens to image divided by image width, and lens shift as the projector lens shift.

Therefore the safe Planner boundary for the optical extension is:

```text
write:  Projector.configThrowRatio
read:   Projector.fieldOfView, Projector.configLookDistance
write:  Projector.configPosition / Projector.configLookAt
```

Do not write body `offset`, body `rotation`, `configRotation`, or private `ProjectorConfig._*` fields for this feature. The exact Live Update property paths must still be smoke-tested against the installed Designer build before release.

## Implications For This Plugin

### Composite Stage Devices (verified in Designer 2026-08-19)

`resourceManager.loadOrCreate(Path("objects/camera/name.apx"), Camera)` creates only a bare `Camera`. It is not equivalent to Designer's Add Camera operation. A healthy built-in camera has a child `PerspectiveProjectionObject` (`objects/perspectiveprojectionobject/name (perspective).apx`) whose `projection` points to a named `PerspectiveProjection` (`objects/camera/name (perspective).apx`); the camera also receives the normal mesh/render-settings and calibration resources. The public construction sequence tested against the installed Designer is `Camera()` + `PerspectiveProjection()` + `PerspectiveProjectionObject()` + `projectionObject.projection = projection` + `camera.add(projectionObject)`, followed by assigning paths, saving, and appending the camera to `stage.cameras`.

`Projector` likewise owns a separate `ProjectorConfig` resource (`objects/projectorconfig/...`) and must not be treated as a standalone resource just because `loadOrCreate(..., Projector)` returns an object. Creating incomplete camera/projector graphs can leave objects absent from Designer's device list or crash native rendering. Until a complete public construction/duplication path is validated, automatic creation of these composite devices must be considered unsupported rather than falling back to a bare resource.

Runtime validation against the installed 2026 build found API details not captured accurately by static assumptions. `Resource.isBad`, `isIncomplete`, and `isInError` are boolean attributes at runtime although the supplied `d3.pyi` declares methods. For deletion, resolve the exact instance from the typed Stage collection and call its documented `Object.remove()` before saving and verifying Stage. Do not assign filtered Python lists to `stage.dmxLights`, `stage.cameras`, `stage.projectors`, or the other typed properties: Designer's GUI callbacks receive an internal `ArrayBox` and fail. LED/DMX/surface devices receive a separate `DirectProjection`; discover sole-screen references with `findResourcesPointingToThis(DirectProjection)` and remove them during owned-resource cleanup.

Ownership cannot be inferred later from a human-readable resource name. A create operation must return and persist the exact main, config, child, projection-object, and generated `DirectProjection` paths it created. Normal deletion removes the Stage/3D reference only. Device/Resource list deletion is optional and must require the explicit confirmation; managed deletion intersects discovered auxiliaries with the persisted ownership list. Imported/adopted Designer resources are unowned and are never physically deleted unless the user explicitly checks the Device list option. If legacy sync data lacks the complete ownership list, refuse physical deletion rather than guessing. When a main resource is renamed, replace its old main path in the ownership list while leaving auxiliary paths unchanged.

The installed Designer runtime also uses an older embedded Python grammar than the local development interpreter: `raise ... from ...` is rejected. Compile checks against desktop Python are useful but do not replace executing generated scripts in Designer.

When deleting any stage device, remove the exact object from its typed Stage property and hierarchy first, save the parent Stage, and read back every supported collection to verify the UID is absent. Only the explicit Device list option may then remove named package resources. Removing the package file alone can leave a stale Stage reference.

- Keep one official Live Update WebSocket and explicit binding state; do not add a second socket for optics.
- Projector movement should change only the position binding. Designer remains the authority for the resulting Look At, rotation, and look distance.
- Look At dragging should change only the Look At binding. The next Designer `valuesChanged` message supplies derived optical values.
- Surface binding is a UI convenience: it stores a target surface identity and derives the target point from that surface. It must not introduce a second Designer transform contract.
- Throw-ratio UI should be labelled as an approximate planning value. The Planner can calculate it from projector-to-screen distance and the requested projected width, send `configThrowRatio`, and draw a provisional cone from the returned field of view. It must not claim calibration accuracy.
