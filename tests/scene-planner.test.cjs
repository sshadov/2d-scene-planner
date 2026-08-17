const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "scene-planner-prototype", "app.js"), "utf8");
const adapterSource = fs.readFileSync(path.join(root, "scene-planner-prototype", "designer-adapter.js"), "utf8");

class ElementStub {
  constructor(value = "") { this.value = value; this.hidden = false; this.checked = false; this.disabled = false; this.textContent = ""; this._listeners = {}; }
  addEventListener(name, handler) { this._listeners[name] = handler; }
  append() {}
  replaceChildren() {}
  click() {}
  setPointerCapture() {}
  releasePointerCapture() {}
  hasPointerCapture() { return false; }
  getBoundingClientRect() { return { width: 1200, height: 800, left: 0, top: 0 }; }
  getContext() { return new Proxy({}, { get: (target, property) => target[property] || (() => {}), set: (target, property, value) => { target[property] = value; return true; } }); }
}

function createHarness(saved, storageKey = "disguise-scene-generator-state-v4") {
  const initialValues = {
    "#room-width": "20", "#room-depth": "12", "#room-height": "6", "#room-center-x": "0", "#room-center-z": "0", "#room-floor-y": "0",
    "#screen-count": "3", "#surface-count": "2", "#camera-count": "2", "#projector-count": "1", "#light-count": "4",
    "#object-width": "4", "#object-height": "2", "#object-x": "0", "#object-y": "0", "#object-z": "0", "#object-rx": "0", "#object-ry": "0", "#object-rz": "0"
  };
  const elements = new Map();
  const elementFor = selector => { if (!elements.has(selector)) elements.set(selector, new ElementStub(initialValues[selector] || "")); return elements.get(selector); };
  const updateMode = new ElementStub("update"); updateMode.checked = true;
  const cleanMode = new ElementStub("clean");
  const storage = new Map();
  if (saved) storage.set(storageKey, JSON.stringify(saved));
  const document = {
    querySelector(selector) { if (selector === "input[name=sync-mode]:checked") return updateMode.checked ? updateMode : cleanMode; return elementFor(selector); },
    querySelectorAll(selector) { if (selector === "input[name=sync-mode]") return [updateMode, cleanMode]; if (selector === "#standard-checklist input:checked") return []; return []; },
    createElement() { return new ElementStub(); }
  };
  const context = {
    console, document, location: { hostname: "127.0.0.1", port: "4173", origin: "http://127.0.0.1:4173" },
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
    crypto: { randomUUID: () => `test-${storage.size}-${Math.random()}` }, Blob: class {}, URL: { createObjectURL: () => "blob:test", revokeObjectURL() {} }, addEventListener() {}, confirm: () => false
  };
  context.window = context; context.globalThis = context;
  vm.createContext(context); vm.runInContext(appSource, context, { filename: "app.js" });
  return context.scenePlannerDebug;
}

function sceneObject(type, pluginId, position = { x: 1, y: 2, z: 3 }) {
  const object = { id: 1, pluginId, type, name: `${type} test`, transform: { position, rotation: { x: 10, y: 20, z: 30 } } };
  if (["screen", "surface"].includes(type)) { object.geometry = { width: 4, height: 2 }; object.transform.rotation.x = 0; object.transform.rotation.z = 0; }
  return object;
}
function resultFor(payload, id = "designer-id") { return { designerId: id, path: `objects/test/${id}.apx`, readback: JSON.parse(JSON.stringify({ transform: payload.transform, ...(payload.geometry ? { geometry: payload.geometry } : {}) })) }; }

(async () => {
  const core = createHarness();
  const screen = sceneObject("screen", "plugin-screen", { x: 3, y: 0, z: -5 });
  const payload = core.objectPayload(screen);
  assert.deepEqual(JSON.parse(JSON.stringify(payload)), {
    pluginId: "plugin-screen", type: "screen", name: "screen test",
    transform: { position: { x: 3, y: 0, z: -5 }, rotation: { x: 0, y: 20, z: 0 } },
    geometry: { width: 4, height: 2 }
  });
  assert.equal(core.validateReadback(payload, resultFor(payload)), true);
  const wrappedRotation = resultFor(payload); wrappedRotation.readback.transform.rotation.y = -340;
  assert.equal(core.validateReadback(payload, wrappedRotation), true);
  assert.throws(() => core.validateReadback(payload, { readback: { transform: { position: { x: 3, y: 0.002, z: -5 }, rotation: { x: 0, y: 20, z: 0 } }, geometry: { width: 4, height: 2 } } }), /не пройдена/);

  assert.match(adapterSource, /pos\["y"\] \+ geometry\["height"\] \/ 2\.0/);
  assert.match(adapterSource, /assign\("scale", Vec\(geometry\["width"\], geometry\["height"\], 0\.1\)\)/);
  assert.match(adapterSource, /assign\("configPosition", position_value\)/);
  assert.match(adapterSource, /assign\("configRotation", rotation_value\)/);
  assert.match(adapterSource, /assign\("posRelativeOrGlobal"/);
  assert.match(adapterSource, /assign\("rotRelativeOrGlobal"/);
  assert.match(adapterSource, /"y": float\(pos\.y\) - float\(size\.y\) \/ 2\.0/);
  assert.match(adapterSource, /"readback": readback\(obj, kind\)/);

  const migratedV4 = createHarness({
    version: 4, room: { width: 20, depth: 12, height: 6 }, nextId: 2,
    objects: [{ id: 1, pluginId: "old-screen", type: "screen", name: "Old", position: { x: 4, y: 1.5, z: -2 }, rotation: { x: 7, y: 35, z: 9 } }]
  }).state.objects[0];
  assert.deepEqual(JSON.parse(JSON.stringify(migratedV4.transform)), { position: { x: 4, y: 1.5, z: -2 }, rotation: { x: 0, y: 35, z: 0 } });
  assert.deepEqual(JSON.parse(JSON.stringify(migratedV4.geometry)), { width: 4, height: 2 });

  const migratedV2 = createHarness({ room: { width: 20, depth: 12, height: 6 }, nextId: 2, objects: [{ id: 1, pluginId: "old", type: "camera", name: "Old", x: 4, y: 9, z: 2.5, rotation: 135 }] }, "disguise-scene-generator-state-v2").state.objects[0];
  assert.deepEqual(JSON.parse(JSON.stringify(migratedV2.transform.position)), { x: -6, y: 2.5, z: 3 });
  assert.deepEqual(JSON.parse(JSON.stringify(migratedV2.transform.rotation)), { x: 0, y: 135, z: 0 });

  core.state.room.centerX = 10; core.state.room.centerZ = -5;
  const frame = { left: 100, top: 50, scale: 10 };
  assert.deepEqual(JSON.parse(JSON.stringify(core.toScreen(10, -5, frame))), { x: 200, y: 110 });
  assert.deepEqual(JSON.parse(JSON.stringify(core.toWorld(200, 110, frame))), { x: 10, z: -5 });
  assert.deepEqual(JSON.parse(JSON.stringify(core.roomBounds())), { minX: 0, maxX: 20, minZ: -11, maxZ: 1 });

  const standard = JSON.parse(fs.readFileSync(path.join(root, "fixtures", "standard-scene.json"), "utf8"));
  const mock = JSON.parse(fs.readFileSync(path.join(root, "fixtures", "mock-api-inspection.json"), "utf8"));
  core.state.objects = [sceneObject("surface", "surface-plan"), sceneObject("screen", "new-screen")]; core.state.sync.objects = {};
  const adoptionDiff = await core.makeDiff({ inspectScene: async () => ({ objects: [...standard.objects, mock.objects[1]], floorY: 0 }) }, "update");
  assert.equal(adoptionDiff.adopt.length, 1); assert.equal(adoptionDiff.adopt[0].object.type, "surface"); assert.equal(adoptionDiff.create.length, 1); assert.equal(adoptionDiff.preserve.length, 1);

  const current = sceneObject("screen", "managed-screen", { x: 1, y: 1.5, z: 3 });
  const previousPayload = core.objectPayload(current); previousPayload.transform.position.y = 0;
  core.state.objects = [current]; core.state.sync.objects = { "managed-screen": { designerId: "managed-uid", lastExported: "old", payload: previousPayload } };
  const inspection = { objects: [{ id: "managed-uid", type: "screen", path: "objects/ledscreen/dsg-managed-screen.apx", managed: true }], floorY: 0 };
  const updateDiff = await core.makeDiff({ inspectScene: async () => inspection }, "update");
  assert.deepEqual(JSON.parse(JSON.stringify(updateDiff.update[0].changed)), { transform: { position: { y: 1.5 } } });
  const updateCalls = [];
  updateDiff.adapter = { updateObject: async (...args) => { updateCalls.push(args); return resultFor(current && core.objectPayload(current), "managed-uid"); } };
  await core.syncToDesigner(updateDiff);
  assert.deepEqual(JSON.parse(JSON.stringify(updateCalls[0].slice(0, 4))), ["managed-uid", { transform: { position: { y: 1.5 } } }, "objects/ledscreen/dsg-managed-screen.apx", "screen"]);

  const unchangedDiff = await core.makeDiff({ inspectScene: async () => inspection }, "update");
  assert.equal(unchangedDiff.unchanged.length, 1); assert.equal(unchangedDiff.create.length, 0);

  const schema = JSON.parse(fs.readFileSync(path.join(root, "schemas", "scene.schema.json"), "utf8"));
  assert.equal(schema.properties.version.const, 5);
  assert.deepEqual(schema.properties.room.required, ["centerX", "centerZ", "floorY", "width", "depth", "height"]);
  console.log("scene-planner v5 tests: ok");
})().catch(error => { console.error(error); process.exitCode = 1; });
