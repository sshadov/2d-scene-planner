# Changelog

## 0.17.1 - 2026-08-19

- Tolerated only `1e-6` float32 representation noise in Designer readback validation.
- Compared LIVE numeric baselines with the same machine epsilon to stop repeated `set` feedback for quantized values.
- Bumped the deployed plugin cache version to `v10.25`.

## 0.17.0 - 2026-08-18

- Implemented the official Live Update WebSocket transport with `subscribe`, `valuesChanged`, and `set` messages for mapped object names and scalar transforms.
- Kept Python HTTP synchronization for explicit create/update/inspect/delete operations; LIVE no longer uses polling.
- Made dimension focus use direct input references and verified `Width -> Height -> Position Y` in the browser.
- Reset session-scoped subscription ids after reconnects and automatically resubscribe after an `invalid id` response.
- Added the runtime version next to the Disguise title so cached plugin copies are immediately visible.
- Sent the first LIVE subscription immediately after connection and exposed the WebSocket close code/reason in the status line.
- Delayed LIVE `set` messages until Designer has delivered initial `valuesChanged` values, avoiding the Starter `1007 ACCESS_VIOLATION` close.
- Batched incoming LIVE values into one animation-frame render so screens do not visibly jump through partial intermediate states.
- Guarded LIVE startup/shutdown with an intent token so a late connection result cannot re-enable a mode the user just turned off.
- Added an authority guard for local Planner writes and disabled LIVE in the standalone `127.0.0.1:4173` preview so it cannot compete with the embedded Designer plugin.
- Reverted the experimental LIVE value queue and authority guard after identifying the duplicate-browser client as the source-of-truth problem. The protocol-required initial `valuesChanged` gate remains enabled so Starter does not receive `set` before subscription values are initialized.
- Added an in-app LIVE diagnostics panel showing the protocol event ring buffer and close/error details.
- Adopted Designer's `valuesChanged` readback as the LIVE baseline to prevent repeated `set` loops caused by numeric quantization; diagnostics now include returned values.
- Added object and field labels to LIVE subscription/value diagnostics instead of reporting opaque subscription IDs alone.
- Fixed screen/surface LIVE Y conversion so lower-edge Y is converted to Designer center `offset.y` exactly once instead of adding half-height on every update.
- Bound LIVE subscriptions to stable Designer resources with `getByUID(0x...)`; generated type/name expressions could resolve to a detached value instead of the object attached to the Stage.
- Added bidirectional object lifecycle for `LED Screen`, `DMX Screen`, `Projection Surface`, `DMX Light`, `Projector`, and `Camera`: LIVE creates Planner objects, watches Stage collections, imports Designer additions, and confirms deletions. MR Sets and Skeletons remain ignored.
- Bumped the deployed plugin cache version to `v10.24` for the bidirectional lifecycle build.

## 0.16.0 - 2026-08-18

- Disabled the misleading LIVE toggle until the official WebSocket Live Update transport is implemented; manual Python HTTP synchronization remains available.
- Camera inspection now uses only `Camera.offset` and `Camera.rotation`.
- Standard-resource deletion now calls `resourceManager.remove(path)` and saves the resource for deletion instead of only detaching a collection entry.
- Added regression coverage for the transport capability, camera contract, and resource removal call.

## 0.15.0 - 2026-08-18

- Look At surface selection now previews the target surface highlight before the choice is committed, including context-menu hover.
- Objects deleted in Designer are reported as missing and are never recreated automatically by LIVE.
- Designer resource names now follow planner names without the `dsg-` prefix; legacy managed paths are renamed on update.
- Removed the unsafe `stage.floor_size` write that caused Free Designer Starter `Field` errors; reordered Stage controls to dimensions before position.
- Refined the dark Disguise-style visual tokens and active-plan accent.

## 0.14.0 - 2026-08-18

- Fixed the managed Stage cube by reusing Designer's valid cube topology instead of undocumented Triangle field assignments.
- Stage movement is numeric only, and an empty local store no longer generates preset equipment before importing the open Designer project.
- Startup inspection now ignores internal/non-physical Designer helpers while retaining physical generic objects and supported equipment.
- Selecting a projector Look At surface highlights that surface on the X/Z plan.

## 0.13.0 - 2026-08-18

- Switched the planner UI to English Designer-facing names and kept object names editable in the active property strip.
- Made Scene optional; enabled Scene writes the Designer floor and maintains a real managed cube mesh.
- Imported all current Designer children and typed entities on startup, including unknown classes as protected `designer` objects.
- Removed projector normalization, fixed scene-relative height to use `floorY`, and made readback validation strict.
- Disabled manual Synchronize while LIVE is enabled and bumped runtime cache keys to `10.3`.

## 0.12.0 - 2026-08-18

- Исправлен порядок ввода: экран и поверхность переводят фокус `Ширина → Высота → Высота от пола/сцены` по Enter.
- Клик по числу выделяет весь текст; целые значения отображаются без лишнего десятичного знака; высота сохраняется как подписанная мировая координата.
- Добавлены мета-теги размера окна Designer и обновлена версия runtime-ресурсов до `10.2`.
- LIVE теперь работает выборочно с задержкой 200 мс только после подтверждённой базовой синхронизации.
- Ошибки чтения сцены и записи объектов показываются отдельно и в окне, и в строке состояния.
- Добавлена отдельная кнопка «Очистить сцену» с подтверждением; она очищает только планировщик и не удаляет объекты из Designer.

## 0.11.1 - 2026-08-18

- Fixed the 2D plan disappearing when the pointer merely entered or moved across the canvas.
- Made pointer hit-testing and context-menu coordinate lookup use side-effect-free canvas geometry measurements.
- Bumped embedded asset URLs to `10.1` so Designer cannot reuse the faulty cached script.

## 0.11.0 - 2026-08-17

- Replaced the expandable property sidebar with a compact grouped object list and one fixed active-object strip above the plan.
- Added top-level object creation buttons, compact room/stage dimensions, a LIVE preview toggle, and synchronization counters.
- Removed horizontal numeric scrubbing; numeric fields now support direct typing, arrow keys, and mouse-wheel steps.
- Added wheel zoom over the free plan and kept the external screen/surface rotation handle.
- Reduced projector controls to physical lens position, visible Look At target/surface, and resolution; no projector rotation is exposed.
- Added LED input modes for resolution, PPI, or millimetre pixel pitch with automatic conversion of the hidden values.
- Expanded the context menu with 90-degree rotation, surface binding, and inline-confirmed deletion while retaining mirrored duplication.
- Added empty-plan right-click creation at the clicked world coordinate. New screens/surfaces focus width then height; new projectors enter cursor-follow Look At placement.
- Added Ctrl-drag duplication and Shift-click same-type selection with relative-position-preserving group drag.
- Added v10 persistence/schema migration and browser interaction coverage without changing the Designer export adapter.

## 0.10.0 - 2026-08-17

- Added an external corner rotation handle for LED screens and projection surfaces.
- Added right-click duplication plus mirrored copies across the stage X and Z centre planes.
- Kept duplicate identities independent by assigning new plugin IDs and clearing Designer mappings.
- Mirrored projector Look At targets together with projector positions and detached mirrored copies from surface bindings.
- Fixed rotation-handle angle calculation so the first pointer movement cannot make the object jump to an unrelated yaw.
- Added v9 persistence, schema, browser interaction checks, and mirror/rotation regression coverage.

## 0.9.0 - 2026-08-17

- Rebuilt object inspectors as compact titled rows to stop the sidebar from expanding the canvas.
- Kept room dimensions and all stage dimensions plus the relative-height checkbox on compact rows.
- Changed LED density metadata from millimetre pitch to PPI and removed density from projection surfaces.
- Reduced projector, light, and camera controls to the requested position and horizontal direction fields.
- Added visible draggable projector Look At markers and surface-centre targeting.
- Added v8 migration that preserves v7 stage-floor semantics and converts legacy LED pixel pitch to PPI.

## 0.8.0 - 2026-08-17

- Added stage-relative height display without changing saved world Y.
- Kept room and stage sections permanently visible and removed the unused stage-top field.
- Restored keyboard ArrowUp/ArrowDown editing while retaining manual decimal input and mouse scrubbing.
- Added inline delete confirmation beside each object remove button.
- Fixed object numbering after deletion so a new LED screen cannot duplicate an existing number.
- Replaced `VirtualCamera` creation with concrete `Camera` resources and readable `dsg-camera-N` paths.
- Replaced projector Euler export with `configLookAt` and corrected top-view direction cones.
- Restored the accidentally removed stage-height input and versioned all v7 runtime assets.
- Added resolution and pixel-pitch planning fields to projection surfaces.
- Added a real Designer session probe and request timeouts so an offline API is reported honestly.

## 0.7.0 - 2026-08-17

- Added the v6 room/stage model and grouped Scene-style object sidebar.
- Added per-type `+` controls, collapsed object inspectors, and automatic expansion for newly added objects.
- Added decimal comma/dot input, live numeric updates, and horizontal `0.1` scrubbing.
- Added screen resolution/pixel pitch and projector resolution fields.
- Added visible projector, light, and camera direction cones plus grid/centre/edge/symmetry snapping.
- Preserved the pointer offset during drag so selection no longer jumps an object under the cursor.
- Stopped double-transforming projectors: `configPosition/configLookAt` are written without body mirroring.
- Fixed native number inputs clearing comma-formatted room/stage dimensions.
- Preserved v5 stage metadata during v7 migration and kept generated equipment heights absolute.

## 0.6.0 - 2026-08-17

- Added the v5 `transform`/`geometry` scene model and absolute room frame coordinates.
- Made screen and surface `Y` mean bottom edge; fixed scale to width/height/thickness.
- Added projector config transforms, camera relative/global transforms, and type-specific scene inspection.
- Added post-write coordinate readback with a `0.001` tolerance.
- Removed ambiguous vertical reference controls and added editable per-object screen dimensions.
- Added v2-v4 migration into the v5 local storage and JSON schema.
- Versioned runtime asset URLs so Designer cannot mix cached v4 JavaScript/CSS with v5 HTML.

## 0.5.0 - 2026-08-17

- Aligned Designer resource paths with Python class names.
- Added the documented `markDirty`/`save` lifecycle around resource mutations.
- Removed assignment to read-only resource descriptions and added field-level Python errors.

## 0.4.2 - 2026-08-17

- Added a verified deployment command for copying the tracked plugin into an active Designer project.
- Documented that the standalone server and Designer's embedded plugin use separate file copies.

## 0.4.1 - 2026-08-17

- Made Designer inspection tolerate dangling collection references left after object deletion.
- Reported skipped references in the export dialog and recreated missing managed objects instead of updating stale mappings.

## 0.4.2 - 2026-08-18

- Added a pointer-movement threshold so selecting an off-grid object does not snap or move it.
- Deferred Ctrl duplication until an actual drag begins; Ctrl-click alone only selects.
- Made planar dimension entry advance `Width → Height → Position Y` after Enter, including delayed focus after the inspector refresh.

## 0.4.0 - 2026-08-17

- Centred room coordinates on the Designer origin and migrated v2/v3 browser state to v4.
- Added negative `X/Z` plan bounds, centre axes, centred generation, and origin placement for new objects.
- Made repeat synchronization recover managed resources by UID or path and persist mappings after each successful operation.
- Added object-level errors and Designer HTTP response bodies for failed Python operations.

## 0.3.0 - 2026-08-17

- Replaced ambiguous plan coordinates with native Designer `X/Y/Z`.
- Changed the top view to `X/Z` and dragging to `X/Z` only.
- Added `Rx/Ry/Rz`, vertical reference metadata, and v2 localStorage migration.
- Corrected screen/surface scale to width/thickness/height.
- Added update/clean export modes, standard-object adoption, protected manual objects, and confirmed default cleanup.
- Added durable project documentation, JSON Schema, fixtures, and local Git history.

## 0.2.0

- Added stable plugin IDs, local persistence, JSON export, and initial create/update diff.

## 0.1.0

- Added the standalone room planner and fixed 1 m canvas grid.
