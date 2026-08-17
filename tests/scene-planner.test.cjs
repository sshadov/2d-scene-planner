const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "scene-planner-prototype", "app.js"), "utf8");
const adapterSource = fs.readFileSync(path.join(root, "scene-planner-prototype", "designer-adapter.js"), "utf8");
const indexSource = fs.readFileSync(path.join(root, "scene-planner-prototype", "index.html"), "utf8");

class ElementStub {
  constructor(value = "") { this.value = value; this.hidden = false; this.checked = false; this.disabled = false; this.textContent = ""; this.children = []; this._listeners = {}; this.dataset = {}; this.style = {}; this.className = ""; this.classList = { add: (...names) => { this.className += ` ${names.join(" ")}`; } }; }
  addEventListener(name, handler) { this._listeners[name] = handler; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  querySelector(selector) { return this.children.find(child => child?.className?.split?.(" ").includes(selector.replace(".", ""))) || new ElementStub(); }
  click() { this._listeners.click?.({ preventDefault() {}, stopPropagation() {} }); }
  setAttribute() {}
  setPointerCapture() {}
  releasePointerCapture() {}
  hasPointerCapture() { return false; }
  getBoundingClientRect() { return { width: 1200, height: 800, left: 0, top: 0 }; }
  getContext() { return new Proxy({}, { get: (target, property) => target[property] || (() => {}), set: (target, property, value) => { target[property] = value; return true; } }); }
}

function createHarness(saved, storageKey = "disguise-scene-generator-state-v5") {
  const initialValues = { "#room-width": "20", "#room-depth": "12", "#stage-width": "12", "#stage-depth": "8", "#stage-height": "0.8", "#measure-from-stage": "", "#snap-mode": "grid-1" };
  const elements = new Map(); const elementFor = selector => { if (!elements.has(selector)) elements.set(selector, new ElementStub(initialValues[selector] || "")); return elements.get(selector); };
  const updateMode = new ElementStub("update"); updateMode.checked = true; const cleanMode = new ElementStub("clean"); const storage = new Map(); if (saved) storage.set(storageKey, JSON.stringify(saved));
  const document = {
    querySelector(selector) { if (selector === "input[name=sync-mode]:checked") return updateMode.checked ? updateMode : cleanMode; return elementFor(selector); },
    querySelectorAll(selector) { if (selector === "input[name=sync-mode]") return [updateMode, cleanMode]; if (selector === "#standard-checklist input:checked") return []; return []; },
    createElement(tag) { return new ElementStub(tag === "input" ? "" : ""); }, createTextNode(text) { return new ElementStub(text); }
  };
  const context = { console, document, location: { hostname: "127.0.0.1", port: "4173", origin: "http://127.0.0.1:4173" }, localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) }, crypto: { randomUUID: () => `test-${storage.size}-${Math.random()}` }, Blob: class {}, URL: { createObjectURL: () => "blob:test", revokeObjectURL() {} }, addEventListener() {}, confirm: () => false };
  context.window = context; context.globalThis = context; vm.createContext(context); vm.runInContext(appSource, context, { filename: "app.js" }); return context.scenePlannerDebug;
}
function sceneObject(type, pluginId, position = { x: 1, y: 2, z: 3 }) {
  const object = { id: 1, pluginId, type, name: `${type} test`, transform: { position, rotation: { x: 10, y: 20, z: 30 } } };
  if (["screen", "surface"].includes(type)) { object.geometry = { width: 4, height: 2 }; object.transform.rotation.x = 0; object.transform.rotation.z = 0; }
  if (type === "projector") object.lookAt = { x: 0, y: 0.8, z: 0 };
  if (["screen", "surface", "projector"].includes(type)) object.media = { resolutionX: 1920, resolutionY: 1200, ...(type === "screen" ? { pixelsPerInch: 10 } : {}) };
  return object;
}
function resultFor(payload, id = "designer-id") { return { designerId: id, path: `objects/test/${id}.apx`, readback: JSON.parse(JSON.stringify({ transform: payload.transform, ...(payload.lookAt ? { lookAt: payload.lookAt } : {}), ...(payload.geometry ? { geometry: payload.geometry } : {}) })) }; }

(async () => {
  const core = createHarness(); assert.equal(core.state.objects.find(object => object.type === "projector")?.transform.position.y, 2.5); assert.equal(core.state.objects.find(object => object.type === "light")?.transform.position.y, 3); assert.equal(core.newObject("camera").transform.position.y, 1.6); assert.equal(core.newObject("screen").media.resolutionY, 1200); assert.equal(core.newObject("screen").media.pixelsPerInch, 10); assert.equal("pixelsPerInch" in core.newObject("surface").media, false); const screen = sceneObject("screen", "plugin-screen", { x: 3, y: 0, z: -5 }); const payload = core.objectPayload(screen);
  assert.equal(core.finite("1,5", 9), 1.5); assert.equal(core.finite("1.5", 9), 1.5); assert.equal(core.finite("", 9), 9);
  assert.deepEqual(JSON.parse(JSON.stringify(payload)), { pluginId: "plugin-screen", type: "screen", name: "screen test", transform: { position: { x: 3, y: 0, z: -5 }, rotation: { x: 0, y: 20, z: 0 } }, geometry: { width: 4, height: 2 }, media: { resolutionX: 1920, resolutionY: 1200, pixelsPerInch: 10 } });
  assert.equal(core.validateReadback(payload, resultFor(payload)), true); const wrappedRotation = resultFor(payload); wrappedRotation.readback.transform.rotation.y = -340; assert.equal(core.validateReadback(payload, wrappedRotation), true);
  assert.throws(() => core.validateReadback(payload, { readback: { transform: { position: { x: 3, y: .002, z: -5 }, rotation: { x: 0, y: 20, z: 0 } }, geometry: { width: 4, height: 2 } } }), /не пройдена/);

  assert.match(adapterSource, /assign\("offset", Vec\(pos\["x"\], pos\["y"\] \+ geometry\["height"\] \/ 2\.0, pos\["z"\]\)\)/);
  assert.match(adapterSource, /assign\("scale", Vec\(geometry\["width"\], geometry\["height"\], 0\.1\)\)/); assert.match(adapterSource, /assign\("configPosition", position_value\)/); assert.match(adapterSource, /assign\("configLookAt"/); assert.doesNotMatch(adapterSource, /obj\.configRotation/); assert.doesNotMatch(adapterSource, /assign\("offset", position_value\)/); assert.match(adapterSource, /typeClasses = .*camera: "Camera"/); assert.match(adapterSource, /assign\("offset", Vec\(pos\["x"\], pos\["y"\], pos\["z"\]\)\)/); assert.match(adapterSource, /"readback": readback\(obj, kind\)/);
  assert.match(indexSource, /id="stage-height"/); assert.match(indexSource, /id="measure-from-stage"/); assert.doesNotMatch(indexSource, /Верх сцены/); assert.match(indexSource, /app\.js\?v=8/); assert.match(indexSource, /designer-adapter\.js\?v=8/); assert.doesNotMatch(appSource, /Look at Z/); assert.doesNotMatch(appSource, /Наклон X/);
  assert.deepEqual(JSON.parse(JSON.stringify(core.fieldSections(core.newObject("camera")).map(section => section.fields?.map(field => field[1]) || []))), [["transform.position.x", "transform.position.z", "transform.position.y"], ["transform.rotation.y"]]);

  const migratedV5Harness = createHarness({ version: 5, room: { width: 20, depth: 12 }, stage: { centerX: 3, centerZ: -2, floorY: 1.1, width: 10, depth: 6, height: 0.6 }, nextId: 2, objects: [{ id: 1, pluginId: "old-screen", type: "screen", name: "Old", transform: { position: { x: 4, y: 1.5, z: -2 }, rotation: { x: 7, y: 35, z: 9 } }, geometry: { width: 4, height: 2 } }] }); const migratedV5 = migratedV5Harness.state.objects[0];
  assert.deepEqual(JSON.parse(JSON.stringify(migratedV5Harness.state.stage)), { centerX: 3, centerZ: -2, floorY: 0.5, width: 10, depth: 6, height: 0.6, measureFromStage: false });
  assert.deepEqual(JSON.parse(JSON.stringify(migratedV5.transform)), { position: { x: 4, y: 1.5, z: -2 }, rotation: { x: 0, y: 35, z: 0 } });
  const migratedV7Harness = createHarness({ version: 7, room: { width: 20, depth: 12 }, stage: { centerX: 0, centerZ: 0, floorY: 0.4, width: 10, depth: 6, height: 0.6, measureFromStage: true }, objects: [{ id: 1, pluginId: "v7-screen", type: "screen", name: "LED-экран 1", transform: { position: { x: 0, y: 1, z: 0 }, rotation: { x: 0, y: 0, z: 0 } }, geometry: { width: 4, height: 2 }, media: { resolutionX: 1920, resolutionY: 1080, pixelPitchMm: 2.54 } }] }, "disguise-scene-generator-state-v7");
  assert.equal(migratedV7Harness.state.stage.floorY, .4); assert.equal(migratedV7Harness.state.objects[0].media.pixelsPerInch, 10);
  const migratedV2 = createHarness({ room: { width: 20, depth: 12, height: 6 }, nextId: 2, objects: [{ id: 1, pluginId: "old", type: "camera", name: "Old", x: 4, y: 9, z: 2.5, rotation: 135 }] }, "disguise-scene-generator-state-v2").state.objects[0];
  assert.deepEqual(JSON.parse(JSON.stringify(migratedV2.transform.position)), { x: -6, y: 2.5, z: 3 }); assert.deepEqual(JSON.parse(JSON.stringify(migratedV2.transform.rotation)), { x: 0, y: 135, z: 0 });

  core.state.room = { width: 20, depth: 12 }; core.state.stage = { centerX: 10, centerZ: -5, floorY: .8, width: 12, depth: 8, height: .8 }; const frame = { left: 100, top: 50, scale: 10 }; assert.deepEqual(JSON.parse(JSON.stringify(core.toScreen(10, -5, frame))), { x: 300, y: 160 }); assert.deepEqual(JSON.parse(JSON.stringify(core.toWorld(300, 160, frame))), { x: 10, z: -5 }); assert.deepEqual(JSON.parse(JSON.stringify(core.stageBounds())), { minX: 4, maxX: 16, minZ: -9, maxZ: -1 });

  const standard = JSON.parse(fs.readFileSync(path.join(root, "fixtures", "standard-scene.json"), "utf8")); const mock = JSON.parse(fs.readFileSync(path.join(root, "fixtures", "mock-api-inspection.json"), "utf8")); core.state.objects = [sceneObject("surface", "surface-plan"), sceneObject("screen", "new-screen")]; core.state.sync.objects = {};
  const adoptionDiff = await core.makeDiff({ inspectScene: async () => ({ objects: [...standard.objects, mock.objects[1]], floorY: 0 }) }, "update"); assert.equal(adoptionDiff.adopt.length, 1); assert.equal(adoptionDiff.adopt[0].object.type, "surface"); assert.equal(adoptionDiff.create.length, 1); assert.equal(adoptionDiff.preserve.length, 1);
  const current = sceneObject("screen", "managed-screen", { x: 1, y: 1.5, z: 3 }); const previousPayload = core.objectPayload(current); previousPayload.transform.position.y = 0; core.state.objects = [current]; core.state.sync.objects = { "managed-screen": { designerId: "managed-uid", lastExported: "old", payload: previousPayload } }; const inspection = { objects: [{ id: "managed-uid", type: "screen", path: "objects/ledscreen/dsg-managed-screen.apx", managed: true }], floorY: 0 };
  const updateDiff = await core.makeDiff({ inspectScene: async () => inspection }, "update"); assert.deepEqual(JSON.parse(JSON.stringify(updateDiff.update[0].changed)), { transform: { position: { y: 1.5 } } }); const updateCalls = []; updateDiff.adapter = { updateObject: async (...args) => { updateCalls.push(args); return resultFor(core.objectPayload(current), "managed-uid"); } }; await core.syncToDesigner(updateDiff); assert.deepEqual(JSON.parse(JSON.stringify(updateCalls[0].slice(0, 4))), ["managed-uid", { transform: { position: { y: 1.5 } } }, "objects/ledscreen/dsg-managed-screen.apx", "screen"]);
  const unchangedDiff = await core.makeDiff({ inspectScene: async () => inspection }, "update"); assert.equal(unchangedDiff.unchanged.length, 1); assert.equal(unchangedDiff.create.length, 0);
  const targetSurface = sceneObject("surface", "target-surface", { x: 4, y: 1, z: -2 }); targetSurface.geometry.height = 3; const linkedProjector = sceneObject("projector", "linked-projector", { x: 0, y: 2.5, z: 5 }); linkedProjector.targetSurfacePluginId = targetSurface.pluginId; core.state.objects = [targetSurface, linkedProjector]; assert.deepEqual(JSON.parse(JSON.stringify(core.objectPayload(linkedProjector).lookAt)), { x: 4, y: 2.5, z: -2 });
  const schema = JSON.parse(fs.readFileSync(path.join(root, "schemas", "scene.schema.json"), "utf8")); assert.equal(schema.properties.version.const, 8); assert.deepEqual(schema.properties.room.required, ["width", "depth"]); assert.deepEqual(schema.properties.stage.required, ["centerX", "centerZ", "floorY", "width", "depth", "height", "measureFromStage"]); assert.equal(core.newObject("projector").lookAt.y, core.state.stage.floorY + core.state.stage.height);
  core.state.objects = [sceneObject("screen", "screen-2"), sceneObject("screen", "screen-3")]; core.state.objects[0].name = "LED-экран 2"; core.state.objects[1].name = "LED-экран 3"; assert.equal(core.newObject("screen").name, "LED-экран 4");
  console.log("scene-planner v8 tests: ok");
})().catch(error => { console.error(error); process.exitCode = 1; });
