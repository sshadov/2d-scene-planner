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
  getContext() {
    return new Proxy({}, { get: (target, property) => target[property] || (() => {}), set: (target, property, value) => { target[property] = value; return true; } });
  }
}

function createHarness(savedV2) {
  const initialValues = {
    "#room-width": "20", "#room-depth": "12", "#room-height": "6",
    "#screen-count": "3", "#surface-count": "2", "#camera-count": "2", "#projector-count": "1", "#light-count": "4",
    "#object-x": "0", "#object-y": "0", "#object-z": "0", "#object-rx": "0", "#object-ry": "0", "#object-rz": "0",
    "#object-height-from": "floor", "#object-height-to": "bottom"
  };
  const elements = new Map();
  const elementFor = selector => {
    if (!elements.has(selector)) elements.set(selector, new ElementStub(initialValues[selector] || ""));
    return elements.get(selector);
  };
  const updateMode = new ElementStub("update"); updateMode.checked = true;
  const cleanMode = new ElementStub("clean");
  const storage = new Map();
  if (savedV2) storage.set("disguise-scene-generator-state-v2", JSON.stringify(savedV2));
  const document = {
    querySelector(selector) {
      if (selector === "input[name=sync-mode]:checked") return updateMode.checked ? updateMode : cleanMode;
      return elementFor(selector);
    },
    querySelectorAll(selector) {
      if (selector === "input[name=sync-mode]") return [updateMode, cleanMode];
      if (selector === "#standard-checklist input:checked") return [];
      return [];
    },
    createElement() { return new ElementStub(); }
  };
  const context = {
    console, document, location: { hostname: "127.0.0.1", port: "4173", origin: "http://127.0.0.1:4173" },
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
    crypto: { randomUUID: () => `test-${storage.size}-${Math.random()}` },
    Blob: class {}, URL: { createObjectURL: () => "blob:test", revokeObjectURL() {} },
    addEventListener() {}, confirm: () => false
  };
  context.window = context; context.globalThis = context;
  vm.createContext(context); vm.runInContext(appSource, context, { filename: "app.js" });
  return context.scenePlannerDebug;
}

function sceneObject(type, pluginId, position = { x: 1, y: 2, z: 3 }) {
  return { id: 1, pluginId, type, name: `${type} test`, position, rotation: { x: 10, y: 20, z: 30 }, verticalRef: { from: "floor", to: "bottom" } };
}

(async () => {
  const core = createHarness();
  const screen = sceneObject("screen", "plugin-screen");
  const payload = core.objectPayload(screen);
  assert.deepEqual(JSON.parse(JSON.stringify(payload.position)), { x: 1, y: 2, z: 3 });
  assert.deepEqual(JSON.parse(JSON.stringify(payload.rotation)), { x: 10, y: 20, z: 30 });
  assert.deepEqual(JSON.parse(JSON.stringify(payload.dimensions)), { width: 3.4, thickness: 0.1, height: 0.38, radius: 0 });
  assert.match(adapterSource, /obj\.offset = Vec\(pos\["x"\], pos\["y"\], pos\["z"\]\)/);
  assert.match(adapterSource, /obj\.scale = Vec\(dims\["width"\], dims\["thickness"\], dims\["height"\]\)/);

  const migrated = createHarness({
    room: { width: 20, depth: 12, height: 6 }, nextId: 2,
    objects: [{ id: 1, pluginId: "old", type: "camera", name: "Old", x: 4, y: 9, z: 2.5, rotation: 135 }]
  }).state.objects[0];
  assert.deepEqual(JSON.parse(JSON.stringify(migrated.position)), { x: -6, y: 2.5, z: 3 });
  assert.deepEqual(JSON.parse(JSON.stringify(migrated.rotation)), { x: 0, y: 135, z: 0 });

  const frame = { left: 100, top: 50, scale: 10 };
  assert.deepEqual(JSON.parse(JSON.stringify(core.toScreen(0, 0, frame))), { x: 200, y: 110 });
  assert.deepEqual(JSON.parse(JSON.stringify(core.toWorld(200, 110, frame))), { x: 0, z: 0 });
  const generatedX = core.state.objects.filter(object => object.type === "screen").map(object => object.position.x);
  assert.ok(generatedX.some(value => value < 0));
  assert.ok(generatedX.some(value => value > 0));

  const standard = JSON.parse(fs.readFileSync(path.join(root, "fixtures", "standard-scene.json"), "utf8"));
  const mock = JSON.parse(fs.readFileSync(path.join(root, "fixtures", "mock-api-inspection.json"), "utf8"));
  core.state.objects = [sceneObject("surface", "surface-plan"), sceneObject("screen", "new-screen")];
  core.state.sync.objects = {};
  const adoptionDiff = await core.makeDiff({ inspectScene: async () => ({ objects: [...standard.objects, mock.objects[1]], floorY: 0 }) }, "update");
  assert.equal(adoptionDiff.adopt.length, 1);
  assert.equal(adoptionDiff.adopt[0].object.type, "surface");
  assert.equal(adoptionDiff.create.length, 1);
  assert.equal(adoptionDiff.preserve.length, 1);
  assert.equal(adoptionDiff.preserve[0].id, "manual-camera-uid");

  const current = sceneObject("screen", "managed-screen", { x: 1, y: 4, z: 3 });
  const previousPayload = core.objectPayload(current); previousPayload.position.y = 0;
  core.state.objects = [current];
  core.state.sync.objects = { "managed-screen": { designerId: "managed-uid", lastExported: "old", payload: previousPayload } };
  const updateDiff = await core.makeDiff({ inspectScene: async () => ({ objects: [{ id: "managed-uid", type: "screen", path: "objects/screen/dsg-managed-screen.apx", managed: true }], floorY: 0 }) }, "update");
  assert.deepEqual(JSON.parse(JSON.stringify(updateDiff.update[0].changed)), { position: { y: 4 } });

  const updateCalls = [];
  updateDiff.adapter = { updateObject: async (...args) => updateCalls.push(args) };
  await core.syncToDesigner(updateDiff);
  assert.deepEqual(JSON.parse(JSON.stringify(updateCalls)), [["managed-uid", { position: { y: 4 } }, "objects/screen/dsg-managed-screen.apx"]]);

  core.state.sync.objects["managed-screen"].designerId = "stale-uid";
  core.state.sync.objects["managed-screen"].path = "objects/screen/dsg-managed-screen.apx";
  const pathDiff = await core.makeDiff({ inspectScene: async () => ({ objects: [{ id: "fresh-uid", type: "screen", path: "objects/screen/dsg-managed-screen.apx", managed: true }], floorY: 0 }) }, "update");
  assert.equal(pathDiff.unchanged.length, 1);
  assert.equal(pathDiff.unchanged[0].designerId, "fresh-uid");
  assert.equal(pathDiff.create.length, 0);

  core.state.sync.objects["managed-screen"].designerId = "managed-uid";
  const unchangedDiff = await core.makeDiff({ inspectScene: async () => ({ objects: [{ id: "managed-uid", type: "screen", path: "objects/screen/dsg-managed-screen.apx", managed: true }], floorY: 0 }) }, "update");
  assert.equal(unchangedDiff.unchanged.length, 1);
  assert.equal(unchangedDiff.create.length, 0);

  console.log("scene-planner tests: ok");
})().catch(error => { console.error(error); process.exitCode = 1; });
