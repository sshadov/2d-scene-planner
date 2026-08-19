# Architecture

## Components

`scene-planner-prototype/index.html` and `styles.css` provide the embedded Designer-oriented UI. `app.js` owns the Scene model, canvas, gestures, persistence, diff, and LIVE workflow. `designer-adapter.js` is the only layer that calls Designer HTTP endpoints, creates Python scripts, or opens the Live Update WebSocket.

The UI has two persistent columns: a fixed-width left panel containing Scene dimensions, object groups, and the selected object's properties; and a 2D canvas that consumes the remaining width. Undo/redo sit over the canvas at top-left. Magnet and zoom sit at top-right. There is no user-facing Stage toggle, Scene height, Clear Plan command, or separate Objects drawer.

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

For LED screens, DMX screens, and projection surfaces, planner position is the bottom centre. The adapter writes `offset = Vec(X, Y + height/2, Z)`, `scale = Vec(width, height, 0.1)`, and yaw through `rotation`. Cameras use `Camera.offset/rotation`; DMX lights use `FixtureGroup.offset/rotation`.

Projectors use only `Projector.configPosition` and `Projector.configLookAt`. Inherited body transforms, `rotation`, and `configRotation` are excluded from the Planner contract. The projector rotation handle changes the Look At vector while preserving its X/Z distance. Manual target dragging edits Look At X/Z; a bound surface supplies its centre. Readback exposes zero hidden UI rotation plus the two config vectors.

## Interaction

Right-clicking empty canvas space creates one of the six supported types at that X/Z coordinate. Camera, projector, and DMX light use top-view direction icons and rotation handles. Ctrl-drag duplicates once based on the modifier captured at `pointerdown`; pointerup, pointercancel, lost capture, window blur, and document visibility changes clear drag state. Ctrl+C/Ctrl+V use the planner's internal clipboard. Shift/Ctrl-click supports multi-selection and group drag.

Numeric inputs accept comma or dot decimals. Right-click restores the field default where one exists. Empty-canvas left drag pans; zoom is limited to `10-300%`, and clicking the zoom value restores `100%` and the initial view.

## Designer Lifecycle

Startup inspection reads supported typed collections and the technical Designer `stage.children` collection, deduplicates by UID, and ignores internal/non-physical helpers. `stage.children` is an API identifier, not a user-facing model.

Creation, adoption, rename, and deletion are explicit Python Execution API operations. Mutations call `markDirty`, successful resources call `save`, rename uses `Resource.rename(Path(...))`, and confirmed deletion uses `saveOnDelete()` plus `resourceManager.remove(path)`. Reconciliation resolves resources by UID, stored path, or legacy managed path and must not recreate a mapped object deleted in Designer.

## LIVE State Machine

LIVE discovers the Director from `?director=` or `window.DISGUISE_DIRECTOR`, then connects to `/api/session/liveupdate`. Each binding tracks `remote`, `desired`, `dirty`, `inFlight`, `initialized`, and `writable`. A set is emitted only for initialized writable dirty bindings without an in-flight write. `object.description` is subscribed as read-only metadata; names are changed only by the Python `Resource.rename` lifecycle.

Removed bindings are unsubscribed. Connection loss keeps the user's LIVE intent enabled and performs backoff reconnect plus resubscribe. A set error clears `inFlight`, preserves `dirty`, and is recorded in diagnostics. Creation/deletion remains on the Python API; collection subscriptions trigger reconciliation.

## Persistence

Browser state uses `disguise-scene-generator-state-v11`. v2-v10 keys and `room` data are migration inputs only. JSON export remains a future interchange capability and is not the authoritative project store.
