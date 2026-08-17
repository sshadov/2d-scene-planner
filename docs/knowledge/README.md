# Designer API Knowledge

Official sources:

- [Plugin introduction](https://developer.disguise.one/plugins/introduction/)
- [Disguise developer portal](https://developer.disguise.one/)

Verified/used conclusions for this project:

- Local project plugins are discovered from the project `Plugins` folder and use `d3plugin.json`.
- Session status is available at `GET /api/session/status/session` when the local Designer API is running.
- Python execution uses `POST /api/session/python/execute` with JSON `{ "script": "return 1" }`.
- Python exposes the current stage as `state.stage`.
- Relevant stage collections are `ledScreens`, `surfaces`, `cameras`, `projectors`, and `lights`.
- Used object properties are `offset`, `rotation`, `scale`, `uid`, `path`, and `description`.
- `stage.floor_pos` is a `Vec`; this project uses `stage.floor_pos.y` as the floor vertical reference.

Open questions that must be verified against the installed Designer version:

- Exact resource classes available for every object type.
- Whether every stage collection supports `append` and `remove` identically.
- Whether a transaction or undo boundary can wrap several Python operations.
- Whether custom metadata can be attached to every resource; until then `dsg-*` paths plus local UID mappings are used.

When a conclusion changes, update this file, `DECISIONS.md`, and `ERROR_LOG.md` in the same commit as the code change.
