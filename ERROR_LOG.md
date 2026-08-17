# Error Log

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
