# Final-State LIVE Sync Design

## Goal

Replace the projector acknowledgement state machine with latest-value synchronization, make Designer authoritative at startup and for Stage membership, simplify DMX Light resource removal, and expose one chronological diagnostic stream. The release version is `0.22.0`.

## Product Principle

Scene Planner is a preparation tool for laying out a starting scene quickly. Intermediate states during rapid movement may be transient. The current Planner values after movement stops must be sent again and become the final Designer values. The implementation must not add revision validation, readback gates, projector controls, or confirmation chains.

## Projector Authority

- Position and Look At are bidirectional between Planner and Designer.
- A selected Projection Surface makes Planner authoritative for Throw Ratio and Rotation Z.
- Without a selected Projection Surface, Planner sends only Position and Look At and does not calculate or write Throw Ratio or Rotation Z.
- Look Distance and Field of View are read-only Designer values. They are displayed when received but never drive synchronization.
- The existing Auto checkbox, Rotation Z selector, manual Throw Ratio mode, FOV-triggered rotation, Throw Ratio correction flash, and revisioned projector cycle are removed.

## Projector LIVE Flow

Any local change to Projector Position, Look At, or its selected Surface position or geometry queues the affected Projector. Incoming Designer changes to the same values update the Planner model and use the same calculation path.

At most once every `40 ms`, the queue takes a fresh snapshot of the current Position and Look At. If a Surface is selected, it also calculates Throw Ratio and sends Position, Look At, and Throw Ratio in one LIVE Update `set` message. If no Surface is selected, the message contains only Position and Look At. There is no waiting for echoes or derived Designer values.

Every change resets a final timer. `500 ms` after the last change, Planner takes another fresh snapshot and repeats the LIVE write. If a Surface is selected, the final operation then writes Rotation Z through the existing narrow Python operation. A new change invalidates an older pending final timer and any stale Rotation Z result.

Closing, deleting, or replacing a Projector cancels its cadence and final timers. LIVE reconnect remains an internal transport concern; the latest Planner values are resubscribed and the next queued/final write supplies the current state.

## Projection Math And Beam

Throw distance is calculated directly from current Position and effective Look At:

```text
throwDistance = distance(position, lookAt)
```

The projected width remains:

```text
projectorAspect = screenHeight > screenWidth
    ? projectorHeightPx / projectorWidthPx
    : projectorWidthPx / projectorHeightPx

projectedWidth = max(screenWidth, screenHeight * projectorAspect)
throwRatio = throwDistance / projectedWidth
```

The local beam updates immediately from the same geometry, without waiting for Designer Field of View. Planner may derive a display-only field of view as `2 * atan(projectedWidth / (2 * throwDistance))`; Designer's later Field of View readback replaces the displayed numeric value but does not trigger another write.

After the final write, Rotation Z is `90` degrees when `screenHeight > screenWidth`; otherwise it is `0` degrees. No other Rotation Z modes remain.

## Surface Binding And Deletion

Selecting or clearing Direction continues to update the Projector/Surface relationship in Designer. Manually moving Look At clears Direction before sending the manual target.

Deleting a Surface does not proactively unbind any Projector. Designer is allowed to retain a Projector reference to a missing Surface. Planner removes only the selected object and performs the requested Stage/resource deletion.

## Designer-Authoritative Scene

Inside Designer, startup ignores persisted Planner objects, synchronization records, history, previous LIVE state, and last-used heights. Planner first passes the startup safety gate, performs a best-effort `resourceManager.saveAll()`, inspects Designer, and constructs the scene from that inspection. A save failure is logged and does not block startup.

Stage typed-collection subscriptions remain the trigger for runtime reconciliation. A fresh Designer inspection replaces Planner membership, so an object deleted directly from Designer disappears from Planner. The only temporary exception is an object whose explicit Planner create operation is still in flight; this prevents a Stage notification racing the create response from removing the new local item. No periodic lifecycle verification or automatic resource creation is added.

## Startup Safety Gate

Planner queries the documented session endpoint `/api/session/transport/activetransport`. `Play`, `PlaySection`, and `Loop` mean the timeline is running. If any active transport is running, Planner shows a blocking warning that real-time Scene Planner synchronization is intended for event preparation, not live operation. The actions are `I accept responsibility` and `Close`.

If transport state cannot be determined, the same warning appears on every launch. No scene import, autosave, WebSocket connection, or real-time mutation starts before acceptance. If transport state is available and stopped, startup proceeds automatically.

The user-facing LIVE toggle is removed. After the gate, LIVE connects automatically and reconnects internally. Connection state remains visible as text.

## Diagnostics

The red error exclamation mark, active-error lifecycle, LIVE log button, and second raw LIVE diagnostics panel are removed. One collapsible Diagnostics panel remains.

It shows all Planner events, Python API requests and responses, LIVE socket events, LIVE messages, and errors in chronological order. Entries are appended for the current runtime session and are not hidden when a later operation succeeds. Copy diagnostics copies this same stream. Diagnostic recording never blocks or retries a product operation.

## DMX Light Device-List Removal

A DMX Light is the `FixtureGroup` resource held by `state.stage.dmxLights`. Its optional physical deletion uses a type-specific two-step lifecycle:

1. Resolve the exact FixtureGroup and capture `str(light.path)` before detaching it.
2. Call `state.stage.dmxLights.remove(light)` and save Stage.
3. Only when `Delete from Device list` is selected and the captured path is non-empty, call `resourceManager.remove(Path(path))` for that FixtureGroup resource.

The DMX Light path does not inspect ownership metadata, enumerate inbound references, delete `DirectProjection` manually, call `saveOnDelete()`, or perform package-absence probes. Those operations are removed from the FixtureGroup branch because they exceed the documented Stage/member plus named-Resource lifecycle and have been the failure boundary in live testing.

An empty path means the FixtureGroup is unnamed and has no independent `.apx` entry to remove. Planner detaches it from Stage, skips `resourceManager.remove()`, and records that fact in Diagnostics. It does not guess or delete an unknown containing parent.

Other composite resources retain their existing resource-specific deletion behavior in this release. Normal deletion without the Device-list option remains Stage-only for every type.

## Naming

Before creating an object, Designer inspection supplies the occupied names for that same object type. A trailing numeric suffix is incremented until the first free sequential name is found. For example, after `Projector 6`, the next available name is `Projector 7` or the first later free number, never `Projector 6 2`. Different object types may share the same numeric suffix.

## Verification

Automated tests cover the `40 ms` cadence, `500 ms` final flush, bound and unbound Projectors, local beam calculation, stale timer cancellation, Designer-originated changes, authoritative Stage deletion, startup state reset, safety gate outcomes, single diagnostics stream, sequential naming, and the named/unnamed FixtureGroup deletion branches.

The release check must pass before deployment. Deployment targets `D:\Disguise\Projects\scenegen4\plugins\scene-planner-prototype`, verifies installed hashes, and is followed by a short manual test in the disposable `scenegen4` project. Physical Device-list deletion remains user-triggered only; no automated test mutates a running Designer project.
