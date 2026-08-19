const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const adapterSource = fs.readFileSync(path.join(root, "scene-planner-prototype", "designer-adapter.js"), "utf8");

class MockWebSocket {
  static instances = [];
  constructor(url) { this.url = url; this.readyState = 0; this.sent = []; MockWebSocket.instances.push(this); }
  send(raw) { this.sent.push(JSON.parse(raw)); }
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
      subscriptions.push({ id: subscriptionId, objectPath: message.subscribe.object, propertyPath: property, writable: !property.startsWith("object.ledScreens") });
      if (!property.startsWith("object.")) continue;
      const value = property === "object.description" ? "old" : property.endsWith(".x") ? 0 : property.endsWith(".y") ? (property.includes("scale") ? 2 : 0) : property.endsWith(".z") ? 0 : 0;
      values.push({ id: subscriptionId, value });
    }
  }
  socket.message({ subscriptions });
  return values.filter(change => subscriptions.find(item => item.id === change.id)?.writable);
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
  adapter.liveSync([{ payload, record: { designerId: "16", path: "objects/ledscreen/screen.apx" } }]);
  const startPromise = adapter.liveStart({ onStatus() {}, onValuesChanged() {}, onSceneChanged() {} });
  const first = MockWebSocket.instances[0];
  assert.equal(first.url, "ws://director.example/api/session/liveupdate");
  first.open();
  await startPromise;
  const initialValues = valuesForSubscriptions(first);
  first.message({ valuesChanged: initialValues });
  const stateAfterInitial = adapter.getLiveState();
  assert.ok(stateAfterInitial.bindings.every(binding => binding.initialized));
  assert.ok(stateAfterInitial.bindings.some(binding => binding.dirty && binding.inFlight !== undefined));
  const setCount = first.sent.filter(item => item.set).length;
  assert.ok(setCount >= 1);
  const pending = first.sent.filter(item => item.set).flatMap(item => item.set);
  first.message({ valuesChanged: pending.map(change => ({ id: change.id, value: change.value })) });
  assert.equal(first.sent.filter(item => item.set).length, setCount);
  const converged = adapter.getLiveState().bindings.filter(binding => binding.id !== null);
  assert.ok(converged.every(binding => !binding.dirty && binding.inFlight === undefined));
  adapter.liveSync([]);
  assert.ok(first.sent.some(item => item.unsubscribe?.ids?.length || item.unsubscribe?.id));
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
