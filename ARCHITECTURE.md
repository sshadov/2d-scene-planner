# Architecture

## Components

`scene-planner-prototype/index.html` and `styles.css` provide the embedded Designer-oriented UI. `app.js` owns the Scene model, canvas, gestures, persistence, diff, and LIVE workflow. `designer-adapter.js` is the only layer that calls Designer HTTP endpoints, creates Python scripts, or opens the Live Update WebSocket.

The UI has two persistent columns: a fixed-width left panel containing Scene dimensions, object groups, and the selected object's properties; and a 2D canvas that consumes the remaining width. Magnet and zoom sit at top-right. There is no Undo/Redo, user-facing Stage toggle, Scene height, Clear Plan command, or separate Objects drawer.

## Scene Model

```text
stage: { width, depth }  # persisted legacy/internal key; labelled Scene in UI
object:
  pluginId
  type, name
  transform:
    position: { x, y, z }
    rotation: { x, y, z }
  geometry: { width, height }  # planar objects only
  media: { inputMode, resolutionX, resolutionY, pixelsPerInch, pixelPitchMm }
  lookAt: { x, y, z }  # projector only
  targetSurfacePluginId  # optional
sync.objects[pluginId]:
  designerId, path
  lastExported, payload
  adopted
```

Scene width and depth define only the centred X/Z planning bounds. Object Y is an absolute Designer world coordinate. Default install heights are Camera `1.5 m`, DMX Light `5 m`, Projector `3 m`, and planar objects `0 m`; the last edited height is remembered separately by type. Adding an object focuses its height field.

For LED screens, DMX screens, and projection surfaces, planner position is the bottom centre. The adapter writes `offset = Vec(X, Y + height/2, Z)`, `scale = Vec(width, height, 0.1)`, yaw through `rotation`, and pixel dimensions through inherited `Display.resolution: Vec2`. Cameras use `Camera.offset/rotation`; DMX lights use `FixtureGroup.offset/rotation`.

Projectors treat public `Projector.configPosition` and `Projector.configLookAt` as the only bidirectional geometry inputs. Direction is a rounded manual Look At point or an exact `Screen2` binding identified by Designer UID/path; binding changes use only `Projector.removeScreen()` and `Projector.addScreen()`. Each local geometry change sends the latest Position and Look At together through LIVE, at most once per 40 ms, with one final resend 500 ms after movement stops. A bound Surface also receives the calculated Throw Ratio; Look Distance and Field of View are read-only readbacks. The final delayed Python update forces only `configRotation.z` to 0 or 90 degrees and preserves X/Y. Newer geometry changes cancel older scheduled work. No Python operation rewrites the complete projector configuration.

Bound Surface creation is ordered before Projector creation, including full-scene sync, so the Projector payload always carries the real Designer UID/path. A committed Surface transform or geometry edit is likewise written and read back before its bound Projectors are recalculated and finalized.

## Interaction

Right-clicking empty canvas space creates one of the six supported types at that X/Z coordinate. Camera and DMX light use top-view direction icons; projectors expose a draggable Look At marker and no rotation handle. Pointerup, pointercancel, lost capture, window blur, and document visibility changes clear drag state. Ctrl-drag duplication is intentionally unsupported in the embedded Designer window; Ctrl+C/Ctrl+V use the planner's internal clipboard instead. Shift/Ctrl-click supports multi-selection and group drag.

Numeric inputs accept comma or dot decimals. Right-click restores the field default where one exists. Empty-canvas left drag pans; zoom is limited to `10-300%`, and clicking the zoom value restores `100%` and the initial view.

## Designer Lifecycle

Startup inspection reads supported typed collections and the technical Designer `stage.children` collection, deduplicates by UID, and ignores internal/non-physical helpers. `stage.children` is an API identifier, not a user-facing model.

In a hosted Designer window, the last complete inspection is authoritative for object membership; persisted browser objects, selection, LIVE state, and remembered heights are not restored. Per-object scan failures return `complete:false`, are logged, and cannot replace the current Planner scene or enable startup LIVE. Benign ignored helpers remain warnings. Only explicit creates whose Python request is still pending survive an inspection, and an inspected matching resource reuses that Planner identity. Startup is read-only: it checks active transport state, requires a successful import, and only then enables LIVE. It never saves project resources or sends a transport command. A stopped transport proceeds automatically; running or unknown transport state keeps a blocking responsibility warning visible until accepted. Standalone preview restores its local browser state and never enables Designer integration.

Creation, adoption, and rename are explicit Python Execution API operations. A user Add/Duplicate/Paste action issues exactly one create operation; Projector creation waits until Look At placement is committed. Create/Delete is serialized per Planner object, so an immediate Delete waits for the exact UID/path returned by Create. LIVE reconnect, value synchronization, Stage collection events, and startup import never create resources. The matching typed Stage list is checked for same-type name collisions before creation, while the ResourceManager package is checked for path collisions. Mutations call `markDirty`, successful resources call `save`, and rename uses `Resource.rename(Path(...))`. Confirmed deletion resolves the exact object and owning typed Stage collection, calls `remove(object)`, saves and verifies only that collection, and leaves the Device/Resource list entry unless `removeResource` is enabled. Physical deletion removes the main Resource for Planner and imported objects alike. Planner auxiliary paths are optional hints and are removed only after exact type/owner validation; imported dependencies are never traversed. Typed Stage collections are mutated in place and are never replaced because Designer exposes them internally as `ArrayBox` values.

The single Diagnostics panel merges Planner, Python API, and LIVE entries into one timestamp-ordered current-session stream and is the sole copy source. Errors remain historical entries and do not gate later operations. Product version `0.23.0` is canonical in `package.json`, the window title, and all static asset cache keys; persisted scene schema remains version `11`.

## LIVE State Machine

LIVE discovers the Director from `?director=` or `window.DISGUISE_DIRECTOR`, then connects to `/api/session/liveupdate`. Each binding tracks `remote`, `desired`, `dirty`, `inFlight`, `initialized`, and `writable`. A set is emitted only for initialized writable dirty bindings without an in-flight write. `object.description` is subscribed as read-only metadata; names are changed only by the Python `Resource.rename` lifecycle.

Removed bindings are unsubscribed. Connection loss keeps the user's LIVE intent enabled and performs backoff reconnect plus resubscribe. A set error clears `inFlight`, preserves `dirty`, and is recorded in diagnostics. Creation/deletion remains on the Python API; collection subscriptions trigger passive scene import only.

## Persistence

Browser state uses `disguise-scene-generator-state-v11`. v2-v10 keys and `room` data are migration inputs only. JSON export remains a future interchange capability and is not the authoritative project store.
