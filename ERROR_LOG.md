# Error Log

## ERR-058: Projector configuration and Surface binding diverged

- Date: 2026-08-20
- Symptom: Planner throw ratio/look distance/beam did not follow projector or Surface changes; Surface selection was not reflected in Designer; projector roll drifted by several degrees; old projectors could emit `NaN` Look Distance over LIVE.
- Root cause: payloads contained only a Look At point, the adapter never changed `Projector.screens`, Look Distance was marked read-only in LIVE, and no ordered final configuration transaction existed after interaction.
- Fix: calculate complete geometry locally; carry exact Surface UID/path; create a bound Surface before its Projector; use `removeScreen/addScreen`; send only Position or Look At during drag; make Look Distance writable; derive missing distance from Position/Look At; finalize roll as literal `0/90°`; and apply Designer readback.
- Regression coverage: scene-planner geometry/order/finalization tests, generated Python lifecycle assertions, Projector probe contract, and LIVE writable/read-only protocol tests.

## ERR-052: Valid Projector readback caused repeated creation

- Date: 2026-08-20
- Symptom: changing the Surface of a copied Projector created another Projector, and later actions continued creating more copies.
- Evidence: Designer returned `configLookAt.x=10.000001907348633` for requested `10` and `z=9.399995803833008` for requested `9.4`; the Planner used a `0.000001 m` tolerance and threw before storing the returned UID.
- Cause: numeric readback validation incorrectly controlled whether a successfully created Designer resource was remembered.
- Fix: use a `0.001 m` readback tolerance and persist UID, path, and validated ownership immediately after the create response, before coordinate validation. A validation error remains visible but cannot cause another create.
- Regression test: float drift below `0.001 m` passes, drift above it fails, and a failed readback followed by another LIVE pass calls `createObject()` only once.

## ERR-010: Numeric workflow lost focus and LIVE was only a mock

- Date: 2026-08-18
- Symptom: Enter after screen width did not advance reliably, values kept a trailing `.0`, and LIVE could be enabled without transmitting changes.
- Cause: focus transfer happened across a rerender and the old LIVE handler explicitly reported that sending was disabled.
- Fix: preserve the active strip during the width/height transition, select all text on focus/pointer-up, keep signed world Y and signed stage-relative offsets, add window metadata/cache-busting, and gate debounced LIVE on `sync.lastSyncAt`.
- Regression test: harness assertions cover the `width -> height -> height` chain, integer formatting, numeric selection listeners, baseline gating, and `10.2` assets.

## ERR-001: Depth was sent as vertical position

- Date: 2026-08-17
- Symptom: moving an object vertically in the inspector changed its depth in Designer, and plan depth appeared on the wrong Designer axis.
- Evidence: the v2 model stored plan depth in `object.y` and height in `object.z`, then sent `Vec(x, y, z)` directly.
- Cause: UI plan axes and Designer native axes were treated as the same unnamed tuple.
- Fix: store `position: {x, y, z}` in native Designer order and render only `position.x/position.z` in the top view. Migrate v2 values explicitly.
- Regression test: edit `Y` and verify canvas position is unchanged; drag on canvas and verify `Y` is unchanged; exported payload preserves `X/Y/Z` order.

## ERR-002: Screen/surface dimensions were reordered

- Date: 2026-08-17
- Symptom: screen height or depth was interpreted incorrectly in Designer.
- Evidence: the adapter used `Vec(width, height, 0.1)`.
- Cause: no named thickness dimension existed in the planner model.
- Fix: dimensions now contain `width`, `thickness`, and `height`; Designer receives `Vec(width, thickness, height)`.
- Regression test: inspect generated Python and a created surface; scale axes must be width/thickness/height.

## ERR-003: `.local` Designer address returned 502 with v2rayN

- Date: 2026-08-17
- Symptom: `shadov-mbnb.local` returned HTTP 502 while the Designer service was reachable through loopback.
- Evidence: the hostname resolved to `192.168.1.100`; direct `127.0.0.1` session and Python endpoints returned HTTP 200 while Designer was running.
- Cause: the `.local` request entered the proxy/network route instead of the local Designer service.
- Fix: local UI and API use explicit `127.0.0.1`; testing documentation requires direct rules for loopback and private networks.
- Regression test: call both Designer endpoints through `127.0.0.1` with v2rayN enabled.

## ERR-004: Existing default scene objects could become duplicates

- Date: 2026-08-17
- Symptom: exporting into the Starter default scene could create plugin objects next to `surface 1` and `projector 1`.
- Evidence: the previous diff knew only stored plugin mappings and treated every unmapped planner object as new.
- Cause: scene inspection did not classify standard, managed, and manual objects.
- Fix: update mode adopts a same-type recognized standard object; clean mode lists defaults for separately confirmed removal. Manual objects are never candidates.
- Regression test: use the standard-scene fixture and verify adopt/update counts, no duplicate create for adopted types, and protected manual objects.

## ERR-005: Room coordinates used a corner origin

- Date: 2026-08-17
- Symptom: axes were named `X/Y/Z`, but exported objects appeared offset into one quadrant of the Designer scene.
- Evidence: generated values were constrained to `X = 0 ... width` and `Z = 0 ... depth`, while the Designer room origin is expected at its centre.
- Cause: the axis-order correction did not also correct the planner's spatial origin.
- Fix: use centred bounds `X = -width/2 ... +width/2` and `Z = -depth/2 ... +depth/2`; migrate v2/v3 saves to v4 by subtracting half the room dimensions.
- Regression test: `toScreen(0, 0)` maps to the room centre, `toWorld(room centre)` returns zero, and generated screens span negative and positive `X`.

## ERR-006: Repeat export HTTP 500 lacked actionable diagnostics

- Date: 2026-08-17
- Symptom: the first export succeeded and the next stopped with only `HTTP 500`.
- Evidence: the adapter discarded the response body, and repeat lookup depended primarily on the previously returned UID.
- Cause: the actual Designer Python exception was hidden; resource identity recovery was too narrow for a reloaded or stale UID.
- Fix: include the Designer response body and failing object name in errors, resolve managed resources by UID or saved/stable path, pass the path to update scripts, and persist each completed mapping immediately.
- Regression test: a stale UID plus matching saved path resolves to the existing object, sends its path to `updateObject`, and produces no duplicate create.

## ERR-007: Deleted stage entries could abort inspection

- Date: 2026-08-17
- Symptom: export returned HTTP 500 after many objects had been deleted from the Designer scene.
- Evidence: inspection read `obj.uid` directly for every entry in each stage collection; deleted or invalid references were not isolated.
- Cause: one dangling Designer reference could raise inside Python and abort the complete scene inspection.
- Fix: inspect each entry inside its own exception boundary, skip empty/invalid references with warnings, and make update/delete lookup skip the same invalid entries.
- Regression test: an inspection with a warning and no valid managed object classifies its planner counterpart as `create`, not `update`.

## ERR-008: Designer loaded a stale plugin copy

- Date: 2026-08-17
- Symptom: the standalone page contained the latest diagnostics, but the embedded Designer plugin still showed a bare `HTTP 500` and old button labels.
- Evidence: `D:\Disguise\Projects\start\plugins\scene-planner-prototype\designer-adapter.js` was 3741 bytes while the tracked adapter was 7929 bytes; the embedded UI text matched the old copy.
- Cause: source changes were served on port 4173 but were not deployed into the active Designer project's plugin directory.
- Fix: deploy all runtime files to the active project and verify source/target SHA-256 hashes; provide a repeatable deployment script.
- Regression test: run the deployment script, verify all hashes match, then reopen the embedded plugin and check for the current `Экспортировать изменения` label and detailed API errors.

## ERR-009: New LED resource rejected direct mutation

- Date: 2026-08-17
- Symptom: creating `LED-экран 1` returned HTTP 500 with `AttributeError: can't set attribute` from the wrapped Designer Python script.
- Evidence: the detailed response identified Designer's `userScript` line 24. Official environment docs specify a 10-line wrapper offset; resource docs require dirty/save lifecycle and class-derived resource folders.
- Cause: resources were created in planner-type folders such as `objects/screen` and mutated without `markDirty`; the adapter also attempted to write read-only `Resource.description`.
- Fix: use `objects/ledscreen`, `objects/screen2`, and `objects/virtualcamera`; call `markDirty` before transform updates and `save` afterwards; report the exact failing field/class/path.
- Regression test: generated Python must use official class folders, `markDirty(obj)`, named-field assignment, and `obj.save()`.

## ERR-010: Plan coordinates did not describe the physical object anchors

- Date: 2026-08-17
- Symptom: projectors appeared away from their 2D positions, and screens could extend below the entered height.
- Evidence: all types were written through generic `offset/rotation`; screen `Y` was sent as a centre pivot and screen dimensions were assigned to the wrong physical axes.
- Cause: the planner had one generic transform contract although Designer exposes different authoritative properties for screens, projectors, and cameras.
- Fix: v5 stores absolute world transforms with type-specific anchor semantics. Screens convert bottom-edge `Y` to centre pivot and use `scale=(width,height,0.1)`; projectors use config transforms; cameras use relative/global transforms. Every write is read back and checked.
- Regression test: verify a `4x2 m` screen at bottom `Y=0` reads back at bottom `0`, projector config fields match without body mirroring, camera relative/global transform matches, and a mismatch over `0.001` stops synchronization.

## ERR-011: Browser mixed v5 HTML with cached v4 runtime files

- Date: 2026-08-17
- Symptom: new v5 fields were visible but old selection behavior remained, and the debug scene model was absent.
- Evidence: the loaded stylesheet contained only the old modal `[hidden]` rule although the tracked stylesheet had the new global rule.
- Cause: static `styles.css`, `app.js`, and `designer-adapter.js` URLs did not change between deployments.
- Fix: version all runtime asset URLs with `?v=5`; retain the global `[hidden]` rule so type-specific fields cannot be made visible by `.field { display:grid }`.
- Regression test: reload after deployment, verify `window.scenePlannerDebug` exists, screen `Rx/Rz` are hidden, and projector geometry fields are hidden.

## ERR-012: Projector config transform was applied twice

- Date: 2026-08-17
- Symptom: projectors exported away from their X/Y/Z planner positions and could show unexplained values below the expected height.
- Evidence: create/update first assigned `configPosition/configRotation`, then assigned the same values to inherited `offset/rotation`; readback of the config fields no longer matched the requested transform.
- Cause: Designer derives the projector optical configuration relative to its body. Mutating both coordinate layers transformed the projector twice.
- Fix: initially removed body mirroring; v7 further replaced `configRotation` with the explicit `configLookAt` target contract.
- Regression test: generated projector Python contains `configPosition/configLookAt` and no body or config-rotation assignment; a projector at `(3,2.5,-5)` reads back at exactly that position and target.

## ERR-013: Decimal comma collapsed room and stage sizes

- Date: 2026-08-17
- Symptom: after adding an object, a `20 × 12 m` room became `2 × 2 m` and the stage dropped to minimum dimensions.
- Evidence: the UI formatted `20` as `20,0` inside `input[type=number]`; Chromium rejected the comma and exposed an empty value. `Number("")` then produced zero before clamping.
- Cause: native number inputs and the Russian decimal format used incompatible parsing rules, and the fallback parser treated empty text as a valid zero.
- Fix: use text inputs with `inputmode=decimal`, parse comma/dot explicitly, treat blank/incomplete text as invalid, and update valid values live.
- Regression test: both `1,5` and `1.5` parse as `1.5`, blank text preserves the fallback, and adding an object does not change room/stage dimensions.

## ERR-014: v5 stage metadata was dropped during v6 migration

- Date: 2026-08-17
- Symptom: opening a v5 plan could restore its objects but reset the stage footprint and elevation to defaults.
- Evidence: the v6 migration branch read legacy room fields even when a v5 save already contained a separate `stage` object.
- Cause: v5 was the first version with a separate stage, but migration was keyed only on `sourceVersion < 6`.
- Fix: preserve a non-empty saved stage for all source versions from v5 onward; only v2-v4 fall back to legacy room fields.
- Regression test: a v5 stage with top `floorY=1.1` and height `0.6` migrates to base `floorY=0.5` while object world coordinates remain unchanged.

## ERR-015: Projector Euler update failed readback

- Date: 2026-08-17
- Symptom: synchronization stopped on a projector position mismatch; deleting projectors allowed the rest of the scene to export.
- Evidence: the installed r34 stubs expose writable `configLookAt` alongside `configPosition/configRotation`, while the planner tried to control orientation through Euler config rotation.
- Cause: projector calibration orientation is target-based and Designer may recompute config values when Euler rotation changes, so a strict round-trip of the planner's generic rotation contract is not stable.
- Fix: projectors now store a world Look At point, write `configPosition/configLookAt`, ignore generic rotation in validation, and read both values back.
- Regression test: adapter source contains `configLookAt` create/update/readback, contains no `assign("configRotation", rotation_value)`, and projector readback validates position plus target.

## ERR-016: Wrong camera class and unreadable resource names

- Date: 2026-08-17
- Symptom: exported cameras were `VirtualCamera`, faced incorrectly, and Designer displayed UUID-like resource names.
- Evidence: the adapter mapped planner cameras to `VirtualCamera`, `virtualcamera`, and relative/global fields; resource paths were `dsg-<uuid>.apx`.
- Cause: the generic virtual-camera implementation was chosen before the required Designer object type and naming contract were established.
- Fix: create `Camera` in `objects/camera`, use `offset/rotation`, and generate readable stable paths such as `dsg-camera-1.apx`.
- Regression test: generated adapter source maps camera to `Camera`/`camera`, contains camera offset/rotation writes, and does not create `VirtualCamera`.

## ERR-017: Deleting an object could duplicate its display number

- Date: 2026-08-17
- Symptom: after deleting LED screen 1 from a list containing 2 and 3, the next screen was also named 3.
- Evidence: naming used current object count plus one rather than existing numeric suffixes.
- Cause: count-based numbering assumes no gaps and cannot distinguish remaining names.
- Fix: the next name uses the maximum existing suffix plus one; local deletion now requires an inline confirmation beside the cross button.
- Regression test: with screens 2 and 3 present, the next generated name is screen 4, and clicking the cross alone does not delete it.

## ERR-018: Missing stage height stopped the whole interface

- Date: 2026-08-17
- Symptom: after reloading v7, all object groups and the plan appeared to disappear.
- Evidence: the browser reported `Cannot read properties of null (reading 'dataset')` while binding `#stage-height`; the HTML no longer contained that required input.
- Cause: the height label was removed together with the obsolete advanced stage-position controls.
- Fix: restore the stage height input, bump all runtime asset query versions to v7, and keep migration fallback to the v6 local state.
- Regression test: the HTML must contain `stage-height`, `measure-from-stage`, and v7 script URLs; the complete app harness must initialize without a missing element.

## ERR-019: Adapter presence was mistaken for a live Designer session

- Date: 2026-08-17
- Symptom: the footer showed `Designer Python API` even when the local Designer endpoint was unavailable.
- Cause: the UI checked only whether the browser adapter object was loaded, not whether `/api/session/status/session` answered.
- Fix: probe the session endpoint at startup and distinguish `Designer доступен` from `Designer не отвечает · JSON доступен`.
- Regression test: with the endpoint unavailable, the export dialog remains disabled and the footer reports the offline state.

## ERR-020: Scene-relative height used scene size as an offset

- Date: 2026-08-18
- Symptom: switching `Y relative to Scene` changed world `Y=0` to a negative value when the scene had non-zero height.
- Cause: the UI used `floorY + scene.height` as the reference even though height is a position, not a size.
- Fix: relative height now uses `stage.floorY`; scene height only defines cube dimensions.
- Regression test: world `Y=stage.floorY` displays relative `0`, and signed values remain signed.

## ERR-021: Startup inspection missed non-typed Designer entities

- Date: 2026-08-18
- Symptom: reopening the planner did not recreate the full current Designer scene in the 2D model.
- Cause: inspection only walked typed collections and ignored `stage.children`.
- Fix: inspect and deduplicate all typed collections plus `stage.children`; unknown classes become `designer` objects.
- Regression test: a `Prop` in `children` is imported with its Designer name, UID, and path.

## ERR-022: Managed Scene cube was not attached to the stage

- Date: 2026-08-18
- Symptom: environment sync returned success but no visible cube appeared in Designer.
- Cause: `stage.children.append(obj)` did not attach an `Object` to the stage in the current API.
- Fix: use `stage.add(obj)` and build a real cube mesh before saving `dsg-scene-cube.apx`.
- Regression test: the live Designer object has 8 vertices, 12 triangles, and the requested world offset.

## ERR-023: Cached 10.2 runtime hid the new interface

- Date: 2026-08-18
- Symptom: the browser continued showing the removed Russian add toolbar and old controls after source edits.
- Cause: HTML, CSS, and JavaScript asset URLs retained the same cache key.
- Fix: bump runtime resources to `10.3` and reload the local page with a fresh query key.
- Regression test: index source contains `10.3`, no top `data-add-type` toolbar, and the Scene/Object/Clear controls.

## ERR-020: Expanding object controls moved the plan

- Date: 2026-08-17
- Symptom: opening several object inspectors increased the page height and made the right-hand plan jump or move away.
- Cause: the application shell used only `min-height`, so tall sidebar content expanded the shared grid instead of scrolling independently.
- Fix: lock the desktop shell to the viewport, give the sidebar its own scroll container, and group related inputs into compact horizontal rows.
- Regression test: canvas height is identical before and after expanding an LED inspector; fields in each titled section share the same top coordinate.

## ERR-021: Projector Look At was invisible and hard to control

- Date: 2026-08-17
- Symptom: numeric Look At coordinates did not show where the projector was aimed, and users could not target a projection surface directly.
- Cause: Look At existed only as three inspector inputs without a plan marker or scene-object relation.
- Fix: draw a target cross and dashed line, allow the cross to be dragged in X/Z, and add a surface selector that derives the target from the selected surface centre.
- Regression test: a projector linked to a surface at `(4,1,-2)` with height `3` exports Look At `(4,2.5,-2)`; the inspector contains no raw Look At Z field.

## ERR-022: Rotation handle jumped on first movement

- Date: 2026-08-17
- Symptom: grabbing the new external rotation handle could immediately rotate a screen by an unrelated large angle before the pointer had meaningfully moved.
- Evidence: the stored handle base angle used absolute canvas coordinates (`atan2(handle.y, handle.x)`), while pointer movement used a vector relative to the object's centre.
- Cause: angles measured from different origins were subtracted from each other.
- Fix: store the handle's local corner-vector angle and subtract it from the pointer angle measured around the object centre.
- Regression test: evaluating the handle at its rendered position reproduces the object's existing yaw within `0.001°`; a browser drag to `30°` changes only yaw and preserves X/Z.

## ERR-023: Designer implementation details dominated the planner workflow

- Date: 2026-08-17
- Symptom: building a simple measured scene required expanding many object inspectors and reasoning about rotation/config fields that belong to Designer rather than to the physical event.
- Evidence: the left rail contained all fields for every expanded object, numeric values used drag scrubbing, and screen resolution plus density were shown simultaneously.
- Cause: the UI was structured around the internal scene object representation instead of the operator's paper measurements and mouse workflow.
- Fix: make the left rail selection-only, put the active object's physical values in one fixed strip, remove projector rotation from the UI, replace scrubbing with wheel steps, show only the selected LED data mode, and make creation spatial through the empty-plan context menu. Screen dimensions continue width-to-height on Enter; projectors place their visible target immediately; Ctrl-drag copies and Shift-click creates a movable same-type selection.
- Regression test: selecting a projector exposes only X/Z/height, target, and resolution; changing selection does not resize the canvas; PPI wheel input changes by `0.1` and recalculates resolution; no horizontal scrub state exists; all five equipment types exist in the empty-plan menu; positional creation, target-placement state, stationary duplication, and same-type selection are covered by the harness.

## ERR-024: Pointer hover erased the 2D plan

- Date: 2026-08-18
- Symptom: moving the mouse into or across the 2D plan made the complete drawing disappear.
- Evidence: `pointermove` called `sizing()` before checking whether a drag or projector-target placement was active; `sizing()` assigned `canvas.width/height`, which clears the backing buffer by browser definition.
- Cause: a geometry-measurement helper also performed destructive canvas resizing, so a read-only pointer event erased the frame and returned without repainting it.
- Fix: idle pointer movement now returns before any geometry work; hit-tests and coordinate conversions call `sizing(false)`; only draw passes resize the backing buffer, and only when its pixel dimensions changed.
- Regression test: the pointermove handler must guard idle movement before sizing, and all hit-test/context-menu coordinate paths must use non-resizing frame measurements.

## ERR-025: Managed Stage cube used unsupported Triangle mutation

- Date: 2026-08-18
- Symptom: Designer contained `objects/object/dsg-scene-cube.apx`, but the cube did not render and its mesh dimensions reverted to stale defaults.
- Cause: the adapter copied a floor mesh and assigned undocumented `Triangle.a/b/c` fields. The wrapped Designer API does not persist those fields.
- Fix: copy the valid 8-vertex/12-triangle topology from the built-in `LookAtManipulable` helper, update only `Vert.pos`, call `updateMesh()`, set the Stage offset, and save.
- Regression test: the environment script contains the helper-mesh lookup and no `triangle.a`, `triangle.b`, or `triangle.c` assignments.

## ERR-026: Designer object was resurrected and names drifted

- Date: 2026-08-18
- Symptom: deleting an object in Designer made LIVE recreate it; planner names such as `surface1` appeared in Designer as `dsg-dsg-....apx`.
- Cause: a stored mapping with a missing Designer UID fell through to the normal `create` branch, and resource paths were generated from plugin IDs instead of editable names.
- Fix: classify missing mapped objects separately and never recreate them automatically; generate new resource paths from the planner name and rename legacy `dsg-*` resources through `Resource.path`.
- Regression test: a missing mapping yields `missing: 1, create: 0`; path rename returns a matching `description`.

## ERR-027: Free Designer Starter rejected stage.floor_size writes

- Date: 2026-08-18
- Symptom: Designer repeatedly logged `Access to object of type 'Field' is not allowed` from `Screen2Editor.handleStageDisplaysChanged` after plugin sync.
- Cause: the plugin wrote `stage.floor_size`, which triggers a Starter callback that receives a protected Field proxy.
- Fix: stop writing `stage.floor_size`; keep room size in the planner and only update `stage.floor_pos` when the environment changes.
- Regression test: generated environment Python contains no `stage.floor_size =` assignment and direct `floor_pos` update returns HTTP 200.

## ERR-028: HTTP polling was labelled as Live Update

- Date: 2026-08-18
- Symptom: the `LIVE` switch started a 200 ms timer that reran Python HTTP export while the adapter advertised `liveUpdate: true`.
- Cause: the official WebSocket `/api/session/liveupdate` protocol with `subscribe`/`valuesChanged`/`set` had not been implemented.
- Fix: disable LIVE and expose `liveUpdate: false`, `liveTransport: "websocket-required"`, and `httpSync: true`. Manual synchronization remains explicit.
- Regression test: the adapter capability is false and the checkbox is disabled in the initial HTML.

## ERR-029: Resource deletion only detached collection entries

- Date: 2026-08-18
- Symptom: deleting a standard object removed it from a Stage collection but could leave its `.apx` resource in the project.
- Cause: the adapter called `collection.remove(candidate)` without using the ResourceManager lifecycle.
- Historical fix: call `candidate.saveOnDelete()` followed by `resourceManager.remove(candidate.path)`, then detach any remaining collection reference. This ordering is superseded by ERR-054/ERR-058: named resources are removed only after Stage detach/save/readback and are not preceded by `saveOnDelete()`.
- Regression test: delete script contains both lifecycle calls.

## ERR-030: Camera readback used a legacy alternative contract

- Date: 2026-08-18
- Symptom: camera readback could use `posRelativeOrGlobal/rotRelativeOrGlobal`, producing inconsistent coordinates across Designer versions.
- Cause: an old VirtualCamera-compatible branch remained in the generic reader.
- Fix: concrete `Camera` inspection now reads only `offset/rotation`, matching create/update.
- Regression test: adapter source contains no `posRelativeOrGlobal` or `rotRelativeOrGlobal` branch.

## ERR-031: Selection click moved off-grid objects

- Date: 2026-08-18
- Symptom: clicking an object that was between grid lines could move it onto the grid before the user had dragged it.
- Cause: the canvas entered the drag path on `pointerdown`; a tiny pointer move during a click ran snap-to-grid.
- Fix: object and group drags remain pending until the pointer moves at least 4 px. A pending pointerup is selection only.
- Regression test: source and unit checks cover the pending state and movement threshold.

## ERR-032: Ctrl duplication happened before movement

- Date: 2026-08-18
- Symptom: Ctrl-click could duplicate an object even when the user intended only to select it.
- Cause: duplication ran during `pointerdown`, before a drag was established.
- Fix: duplicate only when a pending object drag crosses the movement threshold, then move the new copy.
- Regression test: duplicate supports deferred history/render and the drag path contains the Ctrl branch.

## ERR-033: Dimension Enter focus was timing-sensitive

- Date: 2026-08-18
- Symptom: pressing Enter after a planar object's width did not reliably move focus to height and then position Y.
- Cause: focus was requested while the key event and inspector refresh were still in progress.
- Fix: use one explicit planar focus sequence and defer the next focus request to the next task.
- Regression test: `nextDimensionField` covers all three transitions and the key handler uses deferred focus.

## ERR-034: LIVE had no official transport

- Date: 2026-08-18
- Symptom: the LIVE control was disabled because the previous implementation had no WebSocket transport.
- Cause: HTTP polling had been removed to avoid misrepresenting the official API, but no `subscribe`/`set` client existed yet.
- Fix: add a WebSocket adapter for `/api/session/liveupdate`, scalar transform subscriptions, `valuesChanged` readback, and debounced `set` writes. HTTP remains explicit-only.
- Regression test: adapter source contains the endpoint, subscribe, valuesChanged, and set protocol; browser focus and status checks run against the deployed page.

## ERR-035: LIVE reused stale subscription ids after reconnect

- Date: 2026-08-18
- Symptom: after a WebSocket reconnect, Designer returned `invalid id` while applying changes; LIVE appeared to work only intermittently.
- Cause: subscription ids are scoped to one WebSocket session, but the adapter retained ids from the closed socket and sent `set` messages before resubscribing.
- Fix: clear every binding id and last-sent value on close; when Designer reports an invalid subscription id, clear the bindings and resubscribe automatically on the current socket.
- Regression test: adapter source covers id reset on close and the invalid-id recovery branch.

## ERR-036: Cached plugin copy obscured WebSocket diagnostics

- Date: 2026-08-18
- Symptom: the browser could still show an older `v10.8` page while the deployed source had newer WebSocket recovery logic.
- Cause: the plugin header did not expose its loaded runtime version, making stale Designer/browser copies indistinguishable.
- Fix: display `v10.10` beside the Disguise title and bump all asset cache keys to `10.10`.
- Regression test: the HTML test asserts both the visible version and cache-busted script URL.

## ERR-037: First LIVE subscription was delayed

- Date: 2026-08-18
- Symptom: a newly opened WebSocket could close before the first debounced planner sync, making LIVE appear not to connect.
- Cause: the initial subscription was scheduled with the normal 150 ms change debounce.
- Fix: the initial LIVE sync runs immediately after `onopen`; later local changes retain the short debounce. Close status now includes the WebSocket code and reason.
- Regression test: syntax/unit checks pass and the deployed endpoint accepts the immediate subscription sequence.

## ERR-038: LIVE set raced initial subscription values

- Date: 2026-08-19
- Symptom: the socket closed with `1007 ACCESS_VIOLATION: read at 0x38` immediately after LIVE was enabled.
- Cause: `set` was sent as soon as subscription IDs arrived, before the initial `valuesChanged` notification completed.
- Fix: each binding is marked `initialized` only after its first `valuesChanged`; `set` is suppressed until then.
- Regression test: adapter source checks the initialized guard and the deployed Designer endpoint accepts the subscription/value sequence.

## ERR-039: LIVE values rendered one property at a time

- Date: 2026-08-19
- Symptom: screens appeared to jump in the 2D plan when LIVE was enabled, although Designer readback coordinates remained stable.
- Cause: each `valuesChanged` property immediately called `render()`, so a multi-property update showed transient geometry/position combinations.
- Fix: queue values by object and field, apply the batch, and render once per animation frame.
- Regression test: app source contains the live value queue and single flush renderer.

## ERR-040: LIVE startup raced a manual toggle

- Date: 2026-08-19
- Symptom: after reopening a page with LIVE persisted on, quickly turning it off could leave a late connection result active or close a replacement socket.
- Cause: `startLive()` always enabled the state after its asynchronous connection promise resolved, even when a newer stop/start intent had superseded it.
- Fix: sequence LIVE start/stop operations with an intent token and invalidate stale results.
- Regression test: app source contains the intent guard around `liveStart()` and invalidation in `stopLive()`.

## ERR-041: Planner and Designer fought over LIVE values

- Date: 2026-08-19
- Symptom: screens oscillated after enabling LIVE even though final Designer readback was stable.
- Cause: the planner accepted intermediate `valuesChanged` notifications for its own pending `set` writes and could send them back.
- Fix: local Planner writes remain authoritative until Designer echoes the requested value; unrelated external Designer edits still flow back into the plan.
- Regression test: adapter exposes `onSet` and the app tracks `livePendingValues` before applying incoming updates.

## ERR-042: Standalone browser became a second LIVE client

- Date: 2026-08-19
- Symptom: screens oscillated when the local preview browser and embedded Designer plugin were open together.
- Cause: both windows subscribed to the same Designer resources and issued competing `set` commands.
- Fix: standalone `127.0.0.1:4173` is now read-only for LIVE; only the embedded Designer plugin can enable WebSocket transport. Manual inspection and Synchronize remain available in the preview.
- Regression test: startup source checks the standalone preview guard and visible runtime version.

## ERR-043: Experimental LIVE convergence guards obscured the source-of-truth bug

- Date: 2026-08-19
- Symptom: screens still moved unpredictably after batching values and suppressing echoed writes.
- Cause: the actual conflict was a second LIVE client in the standalone browser, not only message ordering.
- Fix: remove the temporary batching and authority layers; keep the standalone LIVE guard. The separate protocol-required initial-value gate is retained because removing it reproduces `1007 ACCESS_VIOLATION` in Free Designer Starter. Add a protocol ring-buffer log for direct diagnosis.
- Regression test: source checks confirm the batching/authority layers are absent, `binding.initialized` guards the first `set`, and `getLiveLogs()` is present.

## ERR-044: Code 1007 needed an accessible protocol trace

- Date: 2026-08-19
- Symptom: the user saw only `code 1007` and could not inspect which WebSocket message preceded the close.
- Cause: logs existed only in the browser console and were not visible in the Designer plugin UI.
- Fix: add a LIVE diagnostics panel backed by the adapter ring buffer, including connect, subscribe, valuesChanged, set, error, and close events.
- Regression test: HTML includes `live-log-button` and `live-log-output`; adapter exposes `getLiveLogs()`.

## ERR-045: LIVE re-sent one quantized value indefinitely

- Date: 2026-08-19
- Symptom: after a successful handshake, the same `set` (for example `id: 289`) was emitted after every `valuesChanged` message.
- Cause: Designer rounded the numeric readback, but the adapter kept the pre-rounding local value as the desired baseline and compared it byte-for-byte.
- Fix: update the binding baseline from each incoming `valuesChanged` value before flushing pending sets; include returned values plus object/field labels in the diagnostics panel.
- Regression test: adapter source checks the `binding.value = change.value` baseline assignment.

## ERR-046: Screens and surfaces rose by half their height on every LIVE change

- Date: 2026-08-19
- Symptom: any scene edit raised the LED screen by `3 m`, Surface 1 by `2.5 m`, and Surface 2 by `2.55 m` on every LIVE cycle.
- Evidence: the increments exactly matched half of each object's Designer `scale.y` (`6/2`, `5/2`, and `5.1/2`).
- Cause: `liveFieldValue()` added half-height to the planner's lower-edge Y, then the field encoder added half-height again when producing Designer `offset.y`.
- Fix: keep `liveFieldValue()` in planner coordinates and perform the lower-edge-to-center conversion only in the screen/surface Y encoder.
- Regression test: adapter source must not contain a screen/surface Y conversion in `liveFieldValue()`; the encoder remains responsible for the single conversion.

## ERR-047: Surface 1 acknowledged LIVE changes but did not move in the Stage

- Date: 2026-08-19
- Symptom: `screen2:surface_1` echoed changed `offset` values through `valuesChanged`, while the visible Stage surface did not move.
- Evidence: a reversible test set the generated-name subscription from `-8` to `-7.9`, but Python still read `state.stage.surfaces[0].offset.x == -9.533178...`. The official `getByUID(0xb62bf40299529c0f)` expression started at the same `-9.533178...`, changed both WebSocket and Python readback to `-9.433178...`, and restored successfully.
- Cause: the adapter ignored the stored Designer UID and guessed an object expression from the resource filename, replacing spaces with underscores. That expression could resolve to a different value/resource.
- Fix: build LIVE object expressions from the exact Designer UID using a hexadecimal `getByUID(0x...)` call; keep the name/path expression only as a fallback for invalid legacy IDs.
- Regression test: adapter source checks UID conversion through `BigInt` and `getByUID`, while the Designer integration test verifies WebSocket and Python readback address the same resource.

## ERR-050: Lifecycle rename used an unsupported path setter

- Date: 2026-08-19
- Symptom: a planner rename could mutate the in-memory `path` field without invoking Designer's resource lifecycle.
- Cause: the adapter assigned `path` directly instead of using the official resource rename operation.
- Fix: import `Path`, call `obj.rename(Path(desired_path))`, then save and persist the returned path. The deletion note from this investigation is superseded by ERR-054/ERR-058.
- Regression test: `tests/lifecycle-release.test.cjs` checks generated update/delete scripts and the release package command.

## ERR-049: Float32 readback caused false LIVE errors and repeated writes

- Date: 2026-08-19
- Symptom: LIVE rejected values such as `-0.985` vs `-0.9850000143051147` and repeatedly sent the same coordinate after Designer returned its float32 representation.
- Cause: readback validation and LIVE baseline comparison used exact numeric equality.
- Fix: use a `1e-6` machine epsilon for validation and recursive LIVE value comparison. This does not round or alter planner values and still rejects meaningful differences.
- Regression test: `scene-planner` tests cover float32-noise acceptance, meaningful mismatch rejection, and cache version `v10.25`.

## ERR-048: New objects did not cross the Planner/Designer boundary

- Date: 2026-08-19
- Symptom: an object created after LIVE startup appeared only on the side where it was created.
- Cause: Live Update `set` can modify subscribed properties but cannot create resources, and the adapter subscribed only to existing object fields; Stage collection changes were not observed.
- Fix: create missing Planner objects through the Python resource API before binding their UID, subscribe to Stage equipment collections for Designer-side additions/deletions, and run a debounced scene reconciliation. Explicit Planner deletion calls `resourceManager.remove(path)` after confirmation.
- Regression test: the current Designer watcher observed `dmxScreens` collection events for a temporary create/delete probe; DmxScreen and FixtureGroup create/readback/delete probes completed successfully.
- Note: after `resourceManager.remove(path)`, Designer can retain a stale typed object in the generic `stage.children` hierarchy until refresh. Inspection now trusts typed collections for supported equipment and ignores typed-class entries encountered through `children`.

## ERR-051: Bare composite devices destabilized Designer lifecycle

- Date: 2026-08-19
- Symptom: cameras were absent from the Device list, projectors could trigger native render access violations, and deleting/recreating devices left stale resources or duplicate entries.
- Cause: a bare `Camera` or `Projector` resource was treated as a complete device. Camera projection children and projector config resources were not created or validated, and package resources could be removed before Stage references were detached.
- Fix: create cameras with a named `PerspectiveProjection` and `PerspectiveProjectionObject`, create projectors with a named `ProjectorConfig`, validate public health flags and typed Stage membership, rollback only resources created by the operation, and save Stage before removing main or auxiliary resources.
- Additional root cause: `Object.remove()` only removes an object from its parent hierarchy; for top-level equipment it did not persist removal from `stage.dmxLights`, `stage.cameras`, or `stage.projectors`. Deleting the package then left a bad Stage reference. Simple displays also receive a separate auto-created `DirectProjection`, which must be removed with the device.
- Fix detail: filter the exact UID through the public typed Stage-list setter, save Stage, discover the device's sole-screen `DirectProjection`, then remove auxiliary and main resources. The installed runtime exposes `isBad`, `isIncomplete`, and `isInError` as boolean attributes even though this `d3.pyi` version annotates them as methods.
- Ownership guard: creation returns every main/auxiliary `ownedPath`; sync persists that list and managed deletion rejects imported/unowned records. Auxiliary cleanup is intersected with the persisted list so a manually replaced or shared config/projection is not deleted accidentally.
- Runtime compatibility: Designer's embedded Python rejected exception chaining (`raise ... from ...`) even though local Python 3 accepts it. Generated lifecycle scripts use syntax verified in the installed Designer runtime.
- Diagnostic detail: Designer can publish a failed create's package paths after an initially clean probe. Smoke cleanup now requires repeated clean probes across a stability window rather than trusting one immediate snapshot.
- Regression test: generated lifecycle contracts, Python syntax checks, and `scripts/diagnose-composite-devices.py` cover composite builders, conflict detection, health/rollback paths, typed-list deletion, DirectProjection cleanup, and unchanged manual-resource baselines.

## ERR-052: Every Planner action created another DMX Light

- Date: 2026-08-20
- Symptom: `DMX Light 4` was created successfully in Designer, but remained unsynchronized in Planner; each later click or edit created another numbered copy and blocked `Camera 2` from reaching Designer.
- Cause: `app.js` ownership validation referenced `typeResourceFolders`, a private constant defined only in `designer-adapter.js`. The resulting `ReferenceError` happened after resource creation but before the Planner stored the Designer UID and owned paths.
- Fix: validate simple-device ownership with an app-local folder contract matching the adapter (`FixtureGroup` uses `objects/fixturegroup/`), then persist the creation record normally.
- Regression test: `tests/scene-planner.test.cjs` executes DMX Light ownership validation with the real `FixtureGroup` and `DirectProjection` path shape and fails if cross-file globals are required.

## ERR-053: Designer reported `Access to object of type 'ArrayBox' is not allowed`

- Date: 2026-08-20
- Symptom: `ProjectorEditor.handleStageDisplaysChanged` failed during `Stage::checkRemoveScreens` after a create, duplicate, or delete operation. The error could disappear after opening a device Preferences dialog because Designer rebuilt its editor state.
- Cause: replacing a typed Stage collection such as `stage.projectors` with a normal Python list. Designer expects its `ArrayBox`-backed collection to remain intact; the next editor notification then received an unsupported container.
- Superseded fix attempt: `candidate.remove()` avoided collection replacement but only detached hierarchy state, so the object returned during reconciliation. ERR-054 and ERR-057 record the final typed-collection mutation path.
- Diagnostics: the `LIVE log` panel merges Planner actions, Python API requests/responses/errors, and WebSocket events by timestamp. Every API operation has an `opId` plus object UID/path/type, so a Designer console timestamp can be matched to the preceding operation.
- Regression test: `tests/lifecycle-release.test.cjs` rejects collection replacement and requires `collection.remove(candidate)` before `resourceManager.remove(path)`; `tests/scene-planner.test.cjs` requires Planner action logging.

## ERR-054: Delete detached the 3D object but left a bad Stage entry

- Date: 2026-08-20
- Symptom: an object disappeared from the 3D view, then returned after the next Planner action; Designer marked the Stage entry as bad and later creates produced duplicate names.
- Cause: `Object.remove()` alone does not persistently remove top-level equipment from Designer's typed Stage list in the installed build. The old generic collection assignment also triggered the `ArrayBox` editor error.
- Superseded fixes: assigning a filtered list through an explicit typed property caused ERR-057, while `candidate.remove()` only detached hierarchy state and the object returned on the next import. The current path resolves the exact Stage instance, calls `collection.remove(candidate)` on its owning typed collection, saves Stage, and confirms the UID is absent from that same owning collection. A stale hierarchy reference in `stage.children` is not top-level Stage membership and cannot fail the deletion.
- Resource policy: normal Delete leaves the Device/Resource list entry. The confirmation dialog has one optional `Delete from Device list` checkbox; only when checked are validated owned dependencies and the main resource removed with `resourceManager.remove(Path(...))`. `saveOnDelete()` is not a prerequisite for deleting a named resource according to the official Resources guide.
- Name policy: creation checks names in the matching typed Stage list. `Projector 1` and `Screen 1` are independent; a duplicate projector becomes `Projector 2` before resource creation.
- Import policy: successful deletes store a UID/path tombstone so startup and LIVE scene imports do not restore the removed object. LIVE itself never creates resources.

## ERR-055: Designer rejected diagnostics download

- Date: 2026-08-20
- Symptom: `Export diagnostics` failed with `Attempt to download unknown file type .json`.
- Cause: the embedded Designer plugin window rejects the browser `download` operation itself; changing `.json` to `.txt` did not resolve it.
- Fix: remove browser downloads from the plugin window. `Copy diagnostics` and `Copy JSON` copy the same formatted JSON to the clipboard, with an `execCommand("copy")` fallback for the embedded Chromium.

## ERR-056: Planner Undo restored only the local object

- Date: 2026-08-20
- Symptom: after deleting an object in Planner, Undo restored it in Planner but it did not return to Designer. The reverse operation, Designer `Ctrl+Z`, was visible to Planner.
- Cause: Planner history restored the old `designerId` even though the corresponding Designer resource had already been deleted. LIVE then attempted an update against a dead UID.
- Current policy: Planner Undo restores local history only. It does not recreate a deleted Designer resource unless a separate explicit create operation is requested and implemented.

## ERR-057: Explicit typed Stage setters still corrupted ArrayBox callbacks

- Date: 2026-08-20
- Symptom: deleting LED screens or projectors produced `Access to object of type 'ArrayBox' is not allowed` in `ProjectorEditor.handleStageDisplaysChanged`, with `SetField:ledScreens` or `SetField:projectors` and `set_stage_collection` in the trace.
- Cause: assigning a normal Python list through `stage.ledScreens = retained` or another typed setter still replaces the value observed by Designer's GUI callback. Avoiding generic `setattr` was not sufficient.
- Fix: never assign typed Stage collections during deletion. Resolve the exact object by UID/path, invoke `remove(object)` on its owning typed collection, save Stage, and confirm the UID is absent before reporting success or touching Device-list resources. `Object.remove()` is insufficient for top-level Stage membership.

## ERR-058: DMX Device-list deletion failed without a useful phase

- Date: 2026-08-20
- Symptom: Stage removal could succeed while optional FixtureGroup package cleanup failed, leaving one red indicator with no clear failing resource or operation.
- Cause: the generated delete script returned coarse `skipped` strings and Planner stored a single global `deviceList` error. A later unrelated success could hide the original failure.
- Fix: return structured `stage-detach`, `stage-save`, `stage-readback`, `dependency-inspection`, `dependency-remove`, and `main-resource-remove` results. Diagnostics records each result with the object and path. Active cleanup errors are scoped by resource path. Dependency ambiguity or failure blocks main-resource deletion.
- Regression test: lifecycle contracts require every phase and exact `DirectProjection` validation; Planner tests require severity-coloured phase rows and per-path active errors.
