# Glossary

- **Designer**: Disguise Designer application hosting the current project and stage.
- **Stage**: `state.stage`, the current collection root used by the Python API.
- **Planner object**: an object in the local scene model with a stable `pluginId`.
- **Managed object**: a Designer object proven to belong to this planner by `dsg-*` path or stored UID.
- **Adopted object**: a recognized default Designer object that the planner updates in place and then maps to a `pluginId`.
- **Manual object**: an object without planner ownership or a known default signature; always protected.
- **Standard object**: a recognized Designer starter/default object such as `surface 1` or `projector 1`.
- **Orphan**: a formerly mapped Designer object no longer present in the planner; reported but not deleted.
- **Plugin ID**: stable planner-side UUID used across edits and exports.
- **Designer UID**: object identifier returned by Designer and stored in the sync table.
- **X/Y/Z**: Designer position axes: width, vertical height, and depth.
- **Rx/Ry/Rz**: rotations around Designer X, Y, and Z axes.
- **Top view**: 2D projection of X/Z; Y is intentionally invisible.
- **Vertical reference**: intent metadata describing floor/podium and bottom/center/top while absolute Designer Y remains authoritative.
- **Diff**: classified operations computed before synchronization.

