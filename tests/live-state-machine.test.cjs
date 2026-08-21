const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const adapterSource = fs.readFileSync(path.join(root, "scene-planner-prototype", "designer-adapter.js"), "utf8");

class MockWebSocket {
  static instances = [];
  constructor(url) { this.url = url; this.readyState = 0; this.sent = []; MockWebSocket.instances.push(this); }
  send(raw) { if (this.throwOnSend) { this.throwOnSend = false; throw new Error("mock send failure"); } this.sent.push(JSON.parse(raw)); }
  open() { this.readyState = 1; this.onopen?.(); }
  message(value) { this.onmessage?.({ data: JSON.stringify(value) }); }
  close() { this.readyState = 3; this.onclose?.({ code: 1000, reason: "mock close" }); }
}

function valuesForSubscriptions(socket) {
  const values = [];
  const subscriptions = [];
  let id = 100;
  for (const message of socket.sent.filter(item => item.subscribe)) {
    for (const property of message.subscribe.properties) {
      const subscriptionId = id++;
      subscriptions.push({ id: subscriptionId, objectPath: message.subscribe.object, propertyPath: property, writable: property !== "object.description" && !property.startsWith("object.ledScreens") });
      if (!property.startsWith("object.")) continue;
      const value = property === "object.description" ? "old" : ["object.configPosition", "object.configLookAt"].includes(property) ? { x: 0, y: 0, z: 0 } : property.endsWith(".x") ? 0 : property.endsWith(".y") ? (property.includes("scale") ? 2 : 0) : property.endsWith(".z") ? 0 : 0;
      values.push({ id: subscriptionId, value });
    }
  }
  socket.message({ subscriptions });
  return values;
}

(async () => {
  const context = {
    console,
    location: { hostname: "plugin-host", port: "", search: "?director=director.example", origin: "http://plugin-host" },
    crypto: { randomUUID: () => "test-id" },
    setTimeout,
    clearTimeout,
    URLSearchParams,
    WebSocket: MockWebSocket
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(adapterSource, context, { filename: "designer-adapter.js" });
  const adapter = context.disguiseSceneAdapter;
  assert.equal(adapter.capabilities.liveUrl, "ws://director.example/api/session/liveupdate");
  adapter.configureLiveScene("32");
  const payload = { pluginId: "screen-1", type: "screen", name: "screen", transform: { position: { x: 1, y: 0, z: 2 }, rotation: { x: 0, y: 0, z: 0 } }, geometry: { width: 4, height: 2 } };
  const projectorPayload = { pluginId: "projector-1", type: "projector", name: "projector", transform: { position: { x: -3, y: 3, z: -5 }, rotation: { x: 0, y: 0, z: 0 } }, lookAt: { x: 2, y: 0, z: 4 } };
  adapter.liveSync([{ payload, record: { designerId: "16", path: "objects/ledscreen/screen.apx" } }, { payload: projectorPayload, record: { designerId: "17", path: "objects/projector/projector.apx" }, subscribeOnly: true }]);
  const statuses = [];
  const startPromise = adapter.liveStart({ onStatus(status) { statuses.push(status); }, onValuesChanged() {}, onSceneChanged() {} });
  const first = MockWebSocket.instances[0];
  assert.equal(first.url, "ws://director.example/api/session/liveupdate");
  first.open();
  await startPromise;
  const initialValues = valuesForSubscriptions(first);
  first.message({ valuesChanged: initialValues });
  const stateAfterInitial = adapter.getLiveState();
  const projectorSubscriptions = first.sent.filter(item => item.subscribe?.object === "getByUID(0x11)").flatMap(item => item.subscribe.properties);
  assert.deepEqual(projectorSubscriptions, ["object.description", "object.configPosition", "object.configLookAt", "object.configThrowRatio", "object.fieldOfView", "object.configLookDistance", "object.configRotation.z"]);
  assert.equal(stateAfterInitial.bindings.find(binding => binding.field === "optics.lookDistance").writable, false);
  assert.equal(stateAfterInitial.bindings.find(binding => binding.field === "optics.fieldOfView").writable, false);
  assert.ok(projectorSubscriptions.every(property => property !== "object.screens"));
  assert.ok(projectorSubscriptions.every(property => property !== "object.configRotation"));
  assert.ok(projectorSubscriptions.includes("object.configRotation.z"));
  assert.ok(projectorSubscriptions.every(property => !/config(?:Position|LookAt)\.[xyz]$/.test(property)));
  assert.ok(stateAfterInitial.bindings.every(binding => binding.initialized));
  const nameBinding = stateAfterInitial.bindings.find(binding => binding.field === "name");
  assert.equal(nameBinding.writable, false);
  assert.equal(nameBinding.dirty, false);
  assert.equal(nameBinding.inFlight, undefined);
  assert.ok(stateAfterInitial.bindings.some(binding => binding.field !== "name" && binding.dirty && binding.inFlight !== undefined));
  const setCount = first.sent.filter(item => item.set).length;
  assert.ok(setCount >= 1);
  const pending = first.sent.filter(item => item.set).flatMap(item => item.set);
  const descriptionSubscription = first.sent.filter(item => item.subscribe).flatMap(item => item.subscribe.properties.map(property => ({ property })) ).find(item => item.property === "object.description");
  assert.ok(descriptionSubscription);
  const descriptionId = first.sent.length ? (() => {
    const subscriptions = [];
    let id = 100;
    for (const message of first.sent.filter(item => item.subscribe)) for (const property of message.subscribe.properties) { subscriptions.push({ id: id++, property }); }
    return subscriptions.find(item => item.property === "object.description")?.id;
  })() : null;
  assert.ok(pending.every(change => change.id !== descriptionId));
  assert.ok(pending.every(change => change.property !== "object.description"));
  first.message({ valuesChanged: pending.map(change => ({ id: change.id, value: change.value })) });
  assert.equal(first.sent.filter(item => item.set).length, setCount);
  const converged = adapter.getLiveState().bindings.filter(binding => binding.id !== null);
  assert.ok(converged.every(binding => !binding.dirty && binding.inFlight === undefined));
  const setsBeforeGeometry = first.sent.filter(item => item.set).length;
  assert.equal(adapter.liveSetProjectorGeometry("projector-1", { x: 5, y: 3, z: -7 }, { x: 1, y: 2, z: 4 }), true);
  const geometrySet = first.sent.filter(item => item.set).slice(setsBeforeGeometry).flatMap(item => item.set);
  const geometryBindingIds = new Set(adapter.getLiveState().bindings.filter(binding => ["transform.position", "lookAt"].includes(binding.field)).map(binding => binding.id));
  assert.equal(geometrySet.length, 2);
  assert.ok(geometrySet.every(change => geometryBindingIds.has(change.id)));
  assert.deepEqual(JSON.parse(JSON.stringify(geometrySet.map(change => change.value))), [{ x: 5, y: 3, z: -7 }, { x: 1, y: 2, z: 4 }]);
  first.message({ valuesChanged: geometrySet.map(change => ({ id: change.id, value: change.value })) });
  const setsBeforeProjection = first.sent.filter(item => item.set).length;
  assert.equal(adapter.liveSetProjectorProjection("projector-1", { x: 3, y: 3, z: -12 }, { x: 0, y: 1, z: 0 }, 1.568), true);
  const projectionSet = first.sent.filter(item => item.set).slice(setsBeforeProjection).flatMap(item => item.set);
  const projectionBindingIds = new Set(adapter.getLiveState().bindings.filter(binding => ["transform.position", "lookAt", "optics.throwRatio"].includes(binding.field)).map(binding => binding.id));
  assert.equal(projectionSet.length, 3);
  assert.ok(projectionSet.every(change => projectionBindingIds.has(change.id)));
  assert.deepEqual(JSON.parse(JSON.stringify(projectionSet.map(change => change.value))), [{ x: 3, y: 3, z: -12 }, { x: 0, y: 1, z: 0 }, 1.568]);
  first.message({ valuesChanged: projectionSet.map(change => ({ id: change.id, value: change.value })) });
  first.throwOnSend = true;
  assert.equal(adapter.liveSetProjectorGeometry("projector-1", { x: 6, y: 3, z: -7 }, { x: 1, y: 2, z: 5 }), false);
  const failedGeometry = adapter.getLiveState().bindings.filter(binding => ["transform.position", "lookAt"].includes(binding.field));
  assert.ok(failedGeometry.every(binding => binding.dirty && binding.inFlight === undefined));
  assert.equal(adapter.liveSetProjectorGeometry("projector-1", { x: 6, y: 3, z: -7 }, { x: 1, y: 2, z: 5 }), true);
  const writableBinding = adapter.getLiveState().bindings.find(binding => binding.writable && binding.id !== null);
  assert.ok(writableBinding);
  adapter.liveSync([{ payload: { ...payload, transform: { ...payload.transform, position: { ...payload.transform.position, x: 9 } } }, record: { designerId: "16", path: "objects/ledscreen/screen.apx" } }]);
  assert.ok(adapter.getLiveState().bindings.find(binding => binding.field === "transform.position.x").inFlight !== undefined);
  first.message({ error: "property is not writable" });
  const afterError = adapter.getLiveState().bindings.find(binding => binding.field === "transform.position.x");
  assert.equal(afterError.inFlight, undefined);
  assert.equal(afterError.dirty, true);
  assert.ok(adapter.getLiveLogs().some(entry => entry.event === "set-error"));
  assert.ok(statuses.some(status => status.status === "error"));
  adapter.liveSync([]);
  assert.ok(first.sent.some(item => item.unsubscribe?.ids?.length || item.unsubscribe?.id));
  const statusCount = statuses.length;
  first.message({ error: `Change detected for id ${writableBinding.id}, but subscribed value is unavailable.` });
  assert.equal(statuses.length, statusCount);
  assert.ok(adapter.getLiveLogs().some(entry => entry.event === "stale-subscription" && entry.id === writableBinding.id));
  first.close();
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.ok(MockWebSocket.instances.length >= 2);
  const second = MockWebSocket.instances[1];
  second.open();
  assert.ok(second.sent.some(item => item.subscribe));
  adapter.liveStop();
  assert.equal(adapter.getLiveState().wanted, false);
  console.log("live state machine protocol test: ok");
})().catch(error => { console.error(error); process.exitCode = 1; });
