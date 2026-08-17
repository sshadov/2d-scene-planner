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
