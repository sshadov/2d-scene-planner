# Designer API Knowledge

Official sources:

- [Plugin introduction](https://developer.disguise.one/plugins/introduction/)
- [Disguise developer portal](https://developer.disguise.one/)
- [Python environment](https://developer.disguise.one/python-api/environment/)
- [Resource guide](https://developer.disguise.one/python-api/guides/resources/)
- [Stage guide](https://developer.disguise.one/python-api/guides/stage/)
- [Live Update API](https://developer.disguise.one/api/session/liveupdate/)
- [Python type stubs](https://developer.disguise.one/assets/d3.pyi)

Verified/used conclusions for this project:

- Local project plugins are discovered from the project `Plugins` folder and use `d3plugin.json`.
- Session status is available at `GET /api/session/status/session` when the local Designer API is running.
- Python execution uses `POST /api/session/python/execute` with JSON `{ "script": "return 1" }`.
- Python exposes the current stage as `state.stage`.
- Relevant stage collections are `ledScreens`, `surfaces`, `cameras`, `projectors`, and `lights`.
- Used transform properties are `offset/rotation/scale`, projector `configPosition/configLookAt`, and concrete camera `offset/rotation`.
- Projector config and body transforms are not interchangeable: writing inherited `offset/rotation` after `configPosition/configRotation` changes the optical config again. Projectors therefore write config fields only.
- `Projector.configLookAt` is writable in the current `d3.pyi` and is the preferred target-point contract for this planner.
- `Camera` inherits `Object`; `VirtualCamera` is a distinct subclass and is not created by this planner.
- `stage.floor_pos` is a `Vec`; this project uses `stage.floor_pos.y` as the floor vertical reference.
- Python execution errors are offset by 10 wrapper lines; Designer line 24 refers to approximately line 14 of the submitted script.
- Official Live Update is a WebSocket at `ws://<director>/api/session/liveupdate` using `subscribe`, `valuesChanged`, and `set`; repeated Python HTTP calls are not Live Update and are disabled in the planner until a dedicated adapter exists.
- Resource deletion uses `resourceManager.remove(resource.path)` with the resource deletion-save lifecycle; detaching a stage collection alone is insufficient.
- Resources are marked with `markDirty(resource)` before mutation and saved with `resource.save()` afterwards.
- Resource folders follow lower-case Python class names: `ledscreen`, `screen2`, `camera`, `projector`, and `light`.
- `Object.offset`, `Object.rotation`, and `Object.scale` have setters in the r34 type stubs. `Resource.description` does not expose a setter, so the adapter does not assign it.
- Screen/surface planner coordinates use a bottom-centre anchor; their Designer centre pivot and scale are converted at the adapter boundary and converted back during inspection.
- Create/update returns a type-specific readback. Local sync state is advanced only when it matches the requested transform and geometry within `0.001`.

Open questions that must be verified against the installed Designer version:

- Exact resource classes available for every object type.
- Whether every stage collection supports `append` and `remove` identically.
- Whether a transaction or undo boundary can wrap several Python operations.
- Whether custom metadata can be attached to every resource; local UID/path mappings remain the ownership source even though visible resource names no longer use a `dsg-*` prefix.

When a conclusion changes, update this file, `DECISIONS.md`, and `ERROR_LOG.md` in the same commit as the code change.
