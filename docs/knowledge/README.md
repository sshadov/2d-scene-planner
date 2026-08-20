# Designer API Knowledge

Official sources:

- [Plugin introduction](https://developer.disguise.one/plugins/introduction/)
- [Disguise developer portal](https://developer.disguise.one/)
- [Python environment](https://developer.disguise.one/python-api/environment/)
- [Resource guide](https://developer.disguise.one/python-api/guides/resources/)
- [Stage guide](https://developer.disguise.one/python-api/guides/stage/)
- [Live Update API](https://developer.disguise.one/api/session/liveupdate/)
- [Python type stubs](https://developer.disguise.one/assets/d3.pyi)
- [Disguise source and example research](./disguise-sources.md)

Verified/used conclusions for this project:

- Local project plugins are discovered from the project `Plugins` folder and use `d3plugin.json`.
- Session status is available at `GET /api/session/status/session` when the local Designer API is running.
- Python execution uses `POST /api/session/python/execute` with JSON `{ "script": "return 1" }`.
- Python exposes the current stage as `state.stage`.
- Relevant stage collections are `ledScreens`, `surfaces`, `cameras`, `projectors`, and `lights`.
- Used transform properties are `offset/rotation/scale`, projector `configPosition/configLookAt`, and concrete camera `offset/rotation`.
- Projector config and body transforms are not interchangeable: writing inherited `offset/rotation` after `configPosition/configRotation` changes the optical config again. Projectors therefore write public config fields only.
- `Projector.configLookAt`, `configPosition`, `configThrowRatio`, `configLookDistance`, `screens`, `addScreen/removeScreen`, and `configRotation` are declared by the current local `d3.pyi`; `Projector.fieldOfView` is read-only. The Planner writes the simple optical values through LIVE, binds surfaces through Python, and uses `configRotation` only for final automatic `.z` roll.
- Projector LIVE bindings use complete `configPosition` and `configLookAt` vectors to avoid transient invalid component combinations. Moving a projector leaves its local Look At untouched until Designer sends the authoritative derived values back.
- `Camera` inherits `Object`; `VirtualCamera` is a distinct subclass and is not created by this planner.
- `stage.floor_pos` is a `Vec`; this project uses `stage.floor_pos.y` as the floor vertical reference.
- Python execution errors are offset by 10 wrapper lines; Designer line 24 refers to approximately line 14 of the submitted script.
- Official Live Update is enabled through a WebSocket at `ws://<director>/api/session/liveupdate` using `subscribe`, `valuesChanged`, and `set`; Python HTTP remains for explicit create/update/inspect/delete operations only.
- Stage deletion and package deletion are separate. Resolve the exact instance and call `remove(instance)` on its owning typed Stage collection, save Stage, and verify the UID is gone. Do not use `Object.remove()` for top-level Stage membership, and never replace a typed collection with a Python list: Designer GUI callbacks expose it as an `ArrayBox`. Keep the Device/Resource list entry by default; only an explicit `removeResource` confirmation may call `resourceManager.remove(resource.path)` for owned resources. Do not call `saveOnDelete()` immediately before deleting that same named resource.
- Planner Undo restores local history only; it does not recreate a deleted Designer resource unless an explicit create operation is implemented.
- Resource names live in the `ResourceManager` package list; Stage only holds scene references. Check both `resourceManager.exists(Path(...))` and package paths before creation and rename, and report conflicts instead of passing a wrong-class resource to `loadOrCreate`.
- Resources are marked with `markDirty(resource)` before mutation and saved with `resource.save()` afterwards.
- Resource folders follow Designer package conventions used by the concrete class: `ledscreen`, `dmxscreen`, `screen2`, `fixturegroup`, `camera`, `projector`, and `projectorconfig`.
- `Object.offset`, `Object.rotation`, and `Object.scale` have setters in the r34 type stubs. `Resource.description` does not expose a setter, so the adapter does not assign it.
- Screen/surface planner coordinates use a bottom-centre anchor; their Designer centre pivot and scale are converted at the adapter boundary and converted back during inspection.
- Create/update returns a type-specific readback. Local sync state is advanced only when it matches the requested transform and geometry within `0.001`.

Open questions that must be verified against the installed Designer version:

- Exact resource classes available for every object type.
- Whether every stage collection supports `append` and `remove` identically.
- Whether a transaction or undo boundary can wrap several Python operations.
- Whether custom metadata can be attached to every resource; local UID/path mappings remain the ownership source even though visible resource names no longer use a `dsg-*` prefix.

When a conclusion changes, update this file, `DECISIONS.md`, and `ERROR_LOG.md` in the same commit as the code change.
