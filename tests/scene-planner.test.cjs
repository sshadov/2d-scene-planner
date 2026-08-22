const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "plugin", "app.js"), "utf8");
const adapterSource = fs.readFileSync(path.join(root, "plugin", "designer-adapter.js"), "utf8");
const indexSource = fs.readFileSync(path.join(root, "plugin", "index.html"), "utf8");
const stylesSource = fs.readFileSync(path.join(root, "plugin", "styles.css"), "utf8");
const packageSource = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const pluginManifest = JSON.parse(fs.readFileSync(path.join(root, "plugin", "d3plugin.json"), "utf8"));
const readmeSource = fs.readFileSync(path.join(root, "README.md"), "utf8");

class ElementStub {
  constructor(value = "") { this.value = value; this.hidden = false; this.checked = false; this.disabled = false; this.textContent = ""; this.children = []; this._listeners = {}; this.dataset = {}; this.style = {}; this.className = ""; this.widthWrites = 0; this.heightWrites = 0; this._width = 0; this._height = 0; Object.defineProperty(this, "width", { get: () => this._width, set: next => { this._width = next; this.widthWrites += 1; } }); Object.defineProperty(this, "height", { get: () => this._height, set: next => { this._height = next; this.heightWrites += 1; } }); this.classList = { add: (...names) => { const classes = new Set(this.className.split(/\s+/).filter(Boolean)); names.forEach(name => classes.add(name)); this.className = [...classes].join(" "); }, remove: (...names) => { const removed = new Set(names); this.className = this.className.split(/\s+/).filter(name => name && !removed.has(name)).join(" "); }, contains: name => this.className.split(/\s+/).includes(name) }; }
  addEventListener(name, handler) { const previous = this._listeners[name]; this._listeners[name] = previous ? event => { previous(event); handler(event); } : handler; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  querySelector() { return new ElementStub(); }
  click() { this.onclick?.({ preventDefault() {}, stopPropagation() {} }); this._listeners.click?.({ preventDefault() {}, stopPropagation() {} }); }
  setAttribute() {}
  setPointerCapture() {}
  releasePointerCapture() {}
  hasPointerCapture() { return false; }
  getBoundingClientRect() { return { width: 1200, height: 800, left: 0, top: 0 }; }
  getContext() { return new Proxy({}, { get: (target, property) => target[property] || (() => {}), set: (target, property, value) => { target[property] = value; return true; } }); }
}

function createHarness(saved, storageKey = "disguise-scene-generator-state-v5", locationOptions = {}) {
  const initialValues = { "#stage-width": "20", "#stage-depth": "12", "#snap-mode": "grid-1" };
  const elements = new Map(); const elementFor = selector => { if (!elements.has(selector)) elements.set(selector, new ElementStub(initialValues[selector] || "")); return elements.get(selector); };
  const updateMode = new ElementStub("update"); updateMode.checked = true; const cleanMode = new ElementStub("clean"); const storage = new Map(); if (saved) storage.set(storageKey, JSON.stringify(saved));
  const descendants = node => [node, ...(node.children || []).flatMap(descendants)];
  const document = { activeElement: null, querySelector(selector) { if (selector === "input[name=sync-mode]:checked") return updateMode.checked ? updateMode : cleanMode; return elementFor(selector); }, querySelectorAll(selector) { if (selector === "input[name=sync-mode]") return [updateMode, cleanMode]; if (selector === "#standard-checklist input:checked") return []; if (selector === "#active-object-strip input[data-field]") return descendants(elementFor("#active-object-strip")).filter(child => child?.dataset?.field); return []; }, createElement() { const node = new ElementStub(); node.focus = () => { document.activeElement = node; }; node.blur = () => { if (document.activeElement === node) document.activeElement = null; }; node.select = () => {}; node.scrollIntoView = () => {}; return node; }, createTextNode(text) { return new ElementStub(text); } };
  let clipboardText = "";
  const windowListeners = {};
  const context = { console, document, location: { hostname: locationOptions.hostname || "127.0.0.1", port: locationOptions.port ?? "4173", origin: locationOptions.origin || "http://127.0.0.1:4173" }, localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) }, navigator: { clipboard: { async writeText(value) { clipboardText = String(value); } } }, crypto: { randomUUID: () => `test-${storage.size}-${Math.random()}` }, Blob: class {}, URL: { createObjectURL: () => "blob:test", revokeObjectURL() {} }, addEventListener(name, handler) { windowListeners[name] = handler; }, confirm: () => false, setTimeout, clearTimeout, disguiseSceneAdapter: locationOptions.adapter };
  context.window = context; context.globalThis = context; vm.createContext(context); vm.runInContext(appSource, context, { filename: "app.js" }); context.scenePlannerDebug.__elements = elements; context.scenePlannerDebug.__context = context; context.scenePlannerDebug.__windowListeners = windowListeners; context.scenePlannerDebug.__clipboardText = () => clipboardText; return context.scenePlannerDebug;
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
  const core = createHarness();
  assert.doesNotMatch(appSource, /function\s+(?:saveHistory|applyHistory|snapshot|restore)\b|\b(?:saveHistory|applyHistory)\s*\(/, "Undo/Redo implementation must be removed");
  assert.doesNotMatch(appSource, /state\.(?:history|future)\b/, "Undo/Redo state must be removed");
  assert.doesNotMatch(indexSource, /id="(?:undo|redo)-button"/, "Undo/Redo controls must be removed");
  assert.doesNotMatch(stylesSource, /\.overlay-left\b/, "Undo/Redo-only styling must be removed");
  assert.match(appSource, /\["screen", "dmxScreen", "surface", "projector"\]\.includes\(object\.type\) && object\.media/);
  const hostedStorage = { version: 11, stage: { width: 99, depth: 88 }, objects: [sceneObject("camera", "local-storage-camera")], selectedId: 1, selectedIds: [1], history: ["old"], future: ["old"], liveEnabled: true, sync: { objects: { old: { designerId: "old" } }, deleted: { old: {} } }, lastHeights: { camera: 9 } };
  const hostedAdapter = { inspectScene: async () => ({ objects: [], floorY: 0 }), createObject() {}, updateObject() {}, activeTransportStatus: async () => ({ known: true, running: false, transports: ["Stop"] }), saveAllResources: async () => ({ saved: 0 }), liveStart: async () => {}, getLiveState: () => ({ socket: "open" }), liveSync() {} };
  const hostedStorageHarness = createHarness(hostedStorage, "disguise-scene-generator-state-v11", { hostname: "designer", port: "", adapter: hostedAdapter });
  assert.deepEqual(JSON.parse(JSON.stringify(hostedStorageHarness.state.objects)), []); assert.deepEqual(JSON.parse(JSON.stringify(hostedStorageHarness.state.sync)), { objects: {}, lastSyncAt: null }); assert.equal(hostedStorageHarness.state.liveEnabled, false); assert.deepEqual(JSON.parse(JSON.stringify(hostedStorageHarness.state.lastHeights)), {});
  const standaloneStorageHarness = createHarness(hostedStorage, "disguise-scene-generator-state-v11", { adapter: hostedAdapter });
  assert.deepEqual(JSON.parse(JSON.stringify(standaloneStorageHarness.state.objects.map(item => item.pluginId))), ["local-storage-camera"], "standalone preview must restore local state even when the adapter script is installed");
  const designerObject = { id: "designer-a", pluginId: "designer-a", managed: true, type: "camera", path: "objects/camera/designer-a.apx", description: "Designer A", transform: { position: { x: 1, y: 1.5, z: 2 }, rotation: { x: 0, y: 0, z: 0 } } };
  const staleMembership = createHarness();
  staleMembership.state.objects = [sceneObject("camera", "stale-local")];
  await staleMembership.importDesignerScene({ inspectScene: async () => ({ objects: [designerObject], floorY: 0 }) }, { preserveLocal: true });
  assert.deepEqual(JSON.parse(JSON.stringify(staleMembership.state.objects.map(item => item.pluginId))), ["designer-a"]);
  const liveFootprint = createHarness();
  liveFootprint.state.stage = { width: 20, depth: 12 };
  await liveFootprint.importDesignerScene({ inspectScene: async () => ({ objects: [], floorY: 0, stageFootprint: { width: 32, depth: 18 } }) }, { preserveLocal: true });
  assert.deepEqual(JSON.parse(JSON.stringify(liveFootprint.state.stage)), { width: 20, depth: 12 }, "LIVE membership refresh must not replace Planner scene dimensions with Designer floor_size");
  const pendingCase = createHarness();
  const pendingCreate = sceneObject("camera", "pending-create");
  pendingCase.state.objects = [sceneObject("camera", "stale-local"), pendingCreate];
  let resolvePendingCreate;
  pendingCase.__context.disguiseSceneAdapter = { inspectScene() {}, updateObject() {}, createObject() { return new Promise(resolve => { resolvePendingCreate = resolve; }); } };
  const pendingOperation = pendingCase.createDesignerObject(pendingCreate);
  await pendingCase.importDesignerScene({ inspectScene: async () => ({ objects: [designerObject], floorY: 0 }) }, { preserveLocal: true });
  assert.deepEqual(JSON.parse(JSON.stringify(pendingCase.state.objects.map(item => item.pluginId).sort())), ["designer-a", "pending-create"]);
  resolvePendingCreate(resultFor(pendingCase.objectPayload(pendingCreate), "pending-designer"));
  await pendingOperation;
  const pendingRace = createHarness();
  const racingCreate = sceneObject("camera", "pending-race"); racingCreate.name = "Camera 12";
  pendingRace.state.objects = [racingCreate];
  let resolveRacingCreate;
  pendingRace.__context.disguiseSceneAdapter = { inspectScene() {}, updateObject() {}, createObject() { return new Promise(resolve => { resolveRacingCreate = resolve; }); } };
  const racingOperation = pendingRace.createDesignerObject(racingCreate);
  await pendingRace.importDesignerScene({ inspectScene: async () => ({ objects: [{ id: "pending-race-uid", type: "camera", path: "objects/camera/camera 12.apx", description: "Camera 12", transform: { position: { x: 1, y: 1.5, z: 2 }, rotation: { x: 0, y: 0, z: 0 } } }], floorY: 0 }) });
  assert.deepEqual(JSON.parse(JSON.stringify(pendingRace.state.objects.map(item => item.pluginId).sort())), ["designer-pending-race-uid", "pending-race"], "an in-flight create is kept separate until its exact UID/path is returned");
  resolveRacingCreate(resultFor(pendingRace.objectPayload(racingCreate), "pending-race-uid"));
  await racingOperation;
  assert.deepEqual(JSON.parse(JSON.stringify(pendingRace.state.objects.map(item => item.pluginId))), ["pending-race"], "create response must remove the temporary inspected duplicate by returned UID/path");
  const renamedPendingRace = createHarness();
  const renamedCreate = sceneObject("camera", "pending-renamed"); renamedCreate.name = "Camera 12";
  renamedPendingRace.state.objects = [renamedCreate];
  let resolveRenamedCreate;
  renamedPendingRace.__context.disguiseSceneAdapter = { inspectScene() {}, updateObject() {}, createObject() { return new Promise(resolve => { resolveRenamedCreate = resolve; }); } };
  const renamedOperation = renamedPendingRace.createDesignerObject(renamedCreate);
  await renamedPendingRace.importDesignerScene({ inspectScene: async () => ({ objects: [{ id: "renamed-uid", type: "camera", path: "objects/camera/camera 13.apx", description: "Camera 13", transform: { position: { x: 1, y: 1.5, z: 2 }, rotation: { x: 0, y: 0, z: 0 } } }], floorY: 0 }) });
  resolveRenamedCreate({ ...resultFor(renamedPendingRace.objectPayload(renamedCreate), "renamed-uid"), path: "objects/camera/camera 13.apx", name: "Camera 13", ownedPaths: ["objects/camera/camera 13.apx", "objects/camera/camera 13 (perspective).apx", "objects/perspectiveprojectionobject/camera 13 (perspective).apx"] });
  await renamedOperation;
  assert.deepEqual(JSON.parse(JSON.stringify(renamedPendingRace.state.objects.map(item => item.pluginId))), ["pending-renamed"], "name changes must not leave a duplicate after create completion");
  const createDeleteRace = createHarness();
  const racingDeleteObject = sceneObject("camera", "create-delete-race");
  createDeleteRace.state.objects = [racingDeleteObject];
  let resolveCreateDelete;
  const raceDeletes = [];
  createDeleteRace.__context.disguiseSceneAdapter = {
    inspectScene() {}, updateObject() {},
    createObject() { return new Promise(resolve => { resolveCreateDelete = resolve; }); },
    async deleteManagedObjects(request) { raceDeletes.push(JSON.parse(JSON.stringify(request))); return { deleted: ["race-uid"], skipped: [], resourceDeleteFailed: [], resourcesDeleted: ["objects/camera/race.apx"] }; }
  };
  const createDeleteCreatePromise = createDeleteRace.createDesignerObject(racingDeleteObject);
  const createDeletePromise = createDeleteRace.deleteObject(racingDeleteObject.id, { deleteFromDesigner: true, deleteFromDeviceList: true });
  resolveCreateDelete({ ...resultFor(createDeleteRace.objectPayload(racingDeleteObject), "race-uid"), path: "objects/camera/race.apx", ownedPaths: ["objects/camera/race.apx", "objects/camera/race (perspective).apx", "objects/perspectiveprojectionobject/race (perspective).apx"] });
  await Promise.all([createDeleteCreatePromise, createDeletePromise]);
  assert.deepEqual(raceDeletes, [[{ id: "race-uid", path: "objects/camera/race.apx", owned: true, ownedPaths: ["objects/camera/race.apx", "objects/camera/race (perspective).apx", "objects/perspectiveprojectionobject/race (perspective).apx"], removeResource: true }]], "Delete must wait for the exact identity returned by an in-flight Create");
  assert.equal(createDeleteRace.state.objects.length, 0);
  assert.equal(createDeleteRace.state.sync.objects["create-delete-race"], undefined);

  const incompleteImport = createHarness();
  const retainedObject = sceneObject("camera", "retained-complete-scene");
  incompleteImport.state.objects = [retainedObject];
  incompleteImport.state.stage = { width: 31, depth: 17 };
  incompleteImport.state.sync.objects = { [retainedObject.pluginId]: { designerId: "retained-uid", path: "objects/camera/retained.apx" } };
  const beforeIncompleteImport = JSON.parse(JSON.stringify({ objects: incompleteImport.state.objects, stage: incompleteImport.state.stage, sync: incompleteImport.state.sync.objects }));
  const incompleteResult = await incompleteImport.importDesignerScene({ inspectScene: async () => ({ complete: false, errors: [{ type: "camera", id: "broken", message: "scan failed" }], warnings: [], objects: [designerObject], floorY: 42 }) });
  assert.equal(incompleteResult.complete, false);
  assert.deepEqual(JSON.parse(JSON.stringify({ objects: incompleteImport.state.objects, stage: incompleteImport.state.stage, sync: incompleteImport.state.sync.objects })), beforeIncompleteImport, "Incomplete inspection must preserve the last complete scene");
  assert.ok(incompleteImport.plannerLogEntries.some(entry => entry.level === "error" && /scan failed/.test(entry.message)));

  const degradedCreate = createHarness();
  const degradedCamera = sceneObject("camera", "degraded-camera");
  degradedCreate.state.objects = [degradedCamera];
  let degradedCalls = 0;
  degradedCreate.__context.disguiseSceneAdapter = { inspectScene() {}, updateObject() {}, async createObject(payload) { degradedCalls += 1; return { ...resultFor(payload, "degraded-uid"), path: "objects/camera/degraded.apx", ownedPaths: [] }; } };
  const degradedRecord = await degradedCreate.createDesignerObject(degradedCamera);
  assert.equal(degradedRecord.designerId, "degraded-uid");
  assert.equal(degradedRecord.creationState, "degraded");
  assert.ok(degradedRecord.degradedReasons.some(reason => /ownership/i.test(reason)));
  await degradedCreate.createDesignerObject(degradedCamera);
  assert.equal(degradedCalls, 1, "A remotely created degraded record must never be created twice");
  const startupHarness = createHarness(undefined, "disguise-scene-generator-state-v11", { hostname: "designer", port: "" });
  const startupCalls = [];
  startupHarness.__context.disguiseSceneAdapter = {
    inspectScene: async () => { startupCalls.push("import"); return { objects: [designerObject], floorY: 0 }; }, createObject() {}, updateObject() {},
    activeTransportStatus: async () => ({ known: true, running: false, transports: ["Stop"] }),
    saveAllResources: async () => { startupCalls.push("save"); return { saved: 1 }; },
    liveStart: async () => { startupCalls.push("live"); }, getLiveState: () => ({ socket: "open" }), liveSync() {}
  };
  await startupHarness.runStartupGate();
  assert.deepEqual(startupCalls, ["import", "live"], "Startup must inspect Designer without writing every project resource");
  const unsafeStartup = createHarness(undefined, "disguise-scene-generator-state-v11", { hostname: "designer", port: "" });
  const unsafeCalls = [];
  unsafeStartup.__context.disguiseSceneAdapter = {
    inspectScene: async () => { unsafeCalls.push("import"); return { objects: [designerObject], floorY: 0 }; }, createObject() { unsafeCalls.push("create"); }, updateObject() {},
    activeTransportStatus: async () => ({ known: true, running: true, transports: ["Play"] }),
    saveAllResources: async () => { unsafeCalls.push("save"); }, liveStart: async () => { unsafeCalls.push("live"); }, getLiveState: () => ({ socket: "open" }), liveSync() {}
  };
  await unsafeStartup.runStartupGate();
  assert.equal(unsafeStartup.__elements.get("#startup-warning").hidden, false);
  assert.deepEqual(unsafeCalls, []);
  unsafeStartup.__elements.get("#startup-close").click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(unsafeCalls, []);
  unsafeStartup.addObjectAt("camera", 1, 1);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(unsafeCalls, [], "Close must leave Designer mutations blocked");
  assert.equal(unsafeStartup.__elements.get("#startup-warning").hidden, false, "Close must not expose an interactive Planner when the window cannot close");
  await unsafeStartup.runStartupGate();
  unsafeStartup.__elements.get("#startup-accept").click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(unsafeCalls, ["import", "live"]);
  const importFailure = createHarness(undefined, "disguise-scene-generator-state-v11", { hostname: "designer", port: "" });
  const importFailureCalls = []; let importAttempts = 0;
  importFailure.__context.disguiseSceneAdapter = {
    inspectScene: async () => { importFailureCalls.push("import"); importAttempts += 1; if (importAttempts === 1) throw new Error("inspection failed"); return { objects: [designerObject], floorY: 0 }; }, createObject() {}, updateObject() {},
    activeTransportStatus: async () => ({ known: true, running: false, transports: ["Stop"] }),
    saveAllResources: async () => { importFailureCalls.push("save"); }, liveStart: async () => { importFailureCalls.push("live"); }, getLiveState: () => ({ socket: "open" }), liveSync() {}
  };
  await importFailure.runStartupGate();
  assert.deepEqual(importFailureCalls, ["import"], "LIVE must not start before a successful authoritative import");
  assert.equal(importFailure.__elements.get("#startup-warning").hidden, false, "failed import must keep a retry gate visible");
  importFailure.__elements.get("#startup-accept").click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(importFailureCalls, ["import", "import", "live"]);
  const incompleteStartup = createHarness(undefined, "disguise-scene-generator-state-v11", { hostname: "designer", port: "" });
  const incompleteStartupCalls = [];
  incompleteStartup.__context.disguiseSceneAdapter = {
    inspectScene: async () => { incompleteStartupCalls.push("import"); return { complete: false, errors: [{ collection: "cameras", id: "broken", type: "Camera", message: "startup scan failed" }], warnings: [], objects: [designerObject], floorY: 0 }; }, createObject() {}, updateObject() {},
    activeTransportStatus: async () => ({ known: true, running: false, transports: ["Stop"] }),
    saveAllResources: async () => { incompleteStartupCalls.push("save"); }, liveStart: async () => { incompleteStartupCalls.push("live"); }, getLiveState: () => ({ socket: "open", wanted: true }), liveSync() {}
  };
  await incompleteStartup.runStartupGate();
  assert.deepEqual(incompleteStartupCalls, ["import"]);
  assert.equal(incompleteStartup.__elements.get("#startup-warning").hidden, false);
  assert.deepEqual(JSON.parse(JSON.stringify(incompleteStartup.state.objects)), [], "Incomplete startup inspection must not install a partial scene");
  const diagnosticsHarness = createHarness({ version: 11, stage: { width: 20, depth: 12 }, objects: [], sync: { objects: {}, deleted: {}, errors: { deviceList: "old cleanup failure" } } }, "disguise-scene-generator-state-v11");
  assert.equal("errors" in diagnosticsHarness.state.sync, false, "runtime errors must not be persisted or gate current operations");
  diagnosticsHarness.plannerLogEntries.push(
    { at: "2026-08-21T01:00:00.000Z", level: "error", subsystem: "Planner", message: "planner-a" },
    { at: "2026-08-21T01:00:03.000Z", level: "info", subsystem: "Planner", message: "planner-d" },
    ...Array.from({ length: 80 }, (_, index) => ({ at: "2026-08-21T01:01:" + String(index).padStart(2, "0") + ".000Z", level: "info", subsystem: "Planner", message: "planner-extra-" + index }))
  );
  let diagnosticsListener;
  diagnosticsHarness.__context.disguiseSceneAdapter = {
    inspectScene() {},
    createObject() {},
    updateObject() {},
    getOperationLogs: () => [{ at: "2026-08-21T01:00:01.000Z", event: "response", message: "api-b" }, { at: "2026-08-21T01:00:00.000Z", event: "response", message: "api-tie" }],
    getLiveLogs: () => [{ at: "2026-08-21T01:00:02.000Z", event: "message", message: "live-c" }, { at: "2026-08-21T01:00:00.000Z", event: "message", message: "live-tie" }],
    setDiagnosticsListener(listener) { diagnosticsListener = listener; }
  };
  diagnosticsHarness.attachDiagnostics(diagnosticsHarness.__context.disguiseSceneAdapter);
  diagnosticsListener({ source: "api", entry: { at: "2026-08-21T01:02:00.000Z", event: "response", message: "api-arrived-first" } });
  diagnosticsListener({ source: "live", entry: { at: "2026-08-21T01:02:00.000Z", event: "message", message: "live-arrived-second" } });
  const chronological = diagnosticsHarness.diagnosticsLogs();
  assert.deepEqual(JSON.parse(JSON.stringify(chronological.slice(0, 6).map(entry => entry.message))), ["planner-a", "api-tie", "live-tie", "api-b", "live-c", "planner-d"]);
  assert.deepEqual(JSON.parse(JSON.stringify(chronological.slice(0, 6).map(entry => entry.source))), ["planner", "api", "live", "api", "live", "planner"]);
  assert.equal(chronological[0].raw.message, "planner-a");
  assert.deepEqual(JSON.parse(JSON.stringify(chronological.slice(-2).map(entry => entry.message))), ["api-arrived-first", "live-arrived-second"], "equal-timestamp events retain append order");
  const diagnosticRows = diagnosticsHarness.__elements.get("#diagnostics-output").children;
  assert.ok(diagnosticRows.length > 80, "Diagnostics UI must retain the complete merged stream");
  assert.deepEqual(diagnosticRows.slice(0, 6).map(row => row.textContent.match(/planner-a|api-tie|live-tie|api-b|live-c|planner-d/)?.[0]), ["planner-a", "api-tie", "live-tie", "api-b", "live-c", "planner-d"]);
  assert.match(diagnosticRows[0].className, /diagnostic-error/);
  assert.match(diagnosticRows[3].className, /diagnostic-info/);
  await diagnosticsHarness.copyDiagnostics();
  assert.deepEqual(JSON.parse(diagnosticsHarness.__clipboardText()).map(entry => entry.message).slice(0, 6), ["planner-a", "api-tie", "live-tie", "api-b", "live-c", "planner-d"]);
  assert.equal(JSON.parse(diagnosticsHarness.__clipboardText()).length, diagnosticRows.length, "visible and copied diagnostics use the same complete stream");
  assert.equal(core.state.objects.length, 0); assert.deepEqual(JSON.parse(JSON.stringify(core.state.stage)), { width: 20, depth: 12 }); assert.equal(core.newObject("projector").transform.position.y, 3); assert.equal(core.newObject("camera").transform.position.y, 1.5); assert.equal(core.newObject("screen").transform.position.y, 0); assert.equal(core.newObject("projector").lookAt.y, 0); assert.equal(core.newObject("screen").media.pixelsPerInch, 10); assert.equal("pixelsPerInch" in core.newObject("surface").media, false); assert.equal(core.newObject("dmxScreen").geometry.width, 4); assert.equal(core.newObject("dmxLight").transform.position.y, 5);
  const screen = sceneObject("screen", "plugin-screen", { x: 3, y: 0, z: -5 }); const payload = core.objectPayload(screen); assert.equal(core.finite("1,5", 9), 1.5); assert.equal(core.finite("", 9), 9); assert.equal(core.formatValue(4), "4"); assert.equal(core.formatValue(1.5), "1,5");
  const horizontalSurface = sceneObject("surface", "horizontal-surface", { x: 0, y: 0, z: 0 }); horizontalSurface.geometry = { width: 4, height: 2 }; const horizontalProjector = sceneObject("projector", "horizontal-projector", { x: 0, y: 1, z: -12 }); horizontalProjector.lookAt = { x: 0, y: 1, z: 0 }; horizontalProjector.optics = { throwRatio: 1.5, fieldOfView: 40, lookDistance: 1 }; horizontalProjector.targetSurfacePluginId = horizontalSurface.pluginId; core.state.objects = [horizontalSurface, horizontalProjector]; assert.deepEqual(JSON.parse(JSON.stringify(core.projectorGeometry(horizontalProjector))), { direction: { x: 0, y: 0, z: 1 }, distance: 12, projectedWidth: 4, throwRatio: 3, fieldOfView: 18.925, roll: 0 });
  horizontalProjector.optics.lookDistance = 12; assert.equal(core.projectorAutoThrowRatio(horizontalProjector), 3); delete horizontalProjector.targetSurfacePluginId; assert.equal(core.projectorAutoThrowRatio(horizontalProjector), null); horizontalProjector.targetSurfacePluginId = horizontalSurface.pluginId;
  horizontalProjector.projectorRoll = 87; assert.equal(core.projectorRotationZValue(horizontalProjector), 0);
  const verticalSurface = sceneObject("surface", "vertical-surface", { x: 0, y: 0, z: 0 }); verticalSurface.geometry = { width: 2, height: 4 }; const verticalProjector = sceneObject("projector", "vertical-projector", { x: 0, y: 2, z: -12 }); verticalProjector.lookAt = { x: 0, y: 2, z: 0 }; verticalProjector.media = { resolutionX: 1920, resolutionY: 1080 }; verticalProjector.optics = { throwRatio: 1.5, fieldOfView: 40, lookDistance: 1 }; verticalProjector.targetSurfacePluginId = verticalSurface.pluginId; core.state.objects = [verticalSurface, verticalProjector]; assert.deepEqual(JSON.parse(JSON.stringify(core.projectorGeometry(verticalProjector))), { direction: { x: 0, y: 0, z: 1 }, distance: 12, projectedWidth: 4, throwRatio: 3, fieldOfView: 18.925, roll: 0 }); assert.equal(core.projectorRotationZValue(verticalProjector), 90);
  const designerResolutionScreen = sceneObject("screen", "designer-resolution"); designerResolutionScreen.media = { inputMode: "pitch", resolutionX: 1920, resolutionY: 1080, pixelsPerInch: 10, pixelPitchMm: 2.54 }; core.setPath(designerResolutionScreen, "media.resolutionX", 3840); core.setPath(designerResolutionScreen, "media.resolutionY", 2160); assert.equal(designerResolutionScreen.media.resolutionX, 3840); assert.equal(designerResolutionScreen.media.resolutionY, 2160); assert.equal(core.fieldSections(designerResolutionScreen).find(section => section.title === "LED data").fields[2][2], "FAIL", "incompatible Designer resolution must be reported without rewriting either axis");
  core.state.sync.objects[verticalSurface.pluginId] = { designerId: "surface-uid", path: "objects/screen2/vertical.apx" }; const boundPayload = core.objectPayload(verticalProjector); assert.deepEqual(JSON.parse(JSON.stringify(boundPayload.targetSurface)), { pluginId: "vertical-surface", designerId: "surface-uid", path: "objects/screen2/vertical.apx", name: "surface test" }); assert.deepEqual(JSON.parse(JSON.stringify(boundPayload.media)), { resolutionX: 1920, resolutionY: 1080 }); assert.equal(boundPayload.projectorRoll, 0);
  const retainedLookAt = JSON.parse(JSON.stringify(verticalProjector.lookAt)); assert.equal(core.setProjectorLookDistance(verticalProjector, 6), false); assert.deepEqual(JSON.parse(JSON.stringify(verticalProjector.lookAt)), retainedLookAt); assert.equal(verticalProjector.optics.lookDistance, 1);
  const latestValueHarness = createHarness(); const latestSurface = sceneObject("surface", "latest-surface", { x: 0, y: -1, z: 0 }); latestSurface.geometry = { width: 8, height: 4 }; const latestProjector = sceneObject("projector", "projector-1", { x: 0, y: 3, z: -12 }); latestProjector.lookAt = { x: 0, y: 1, z: 0 }; latestProjector.optics = { throwRatio: 1.5, fieldOfView: 40, lookDistance: 1 }; latestProjector.targetSurfacePluginId = latestSurface.pluginId; latestValueHarness.state.objects = [latestSurface, latestProjector]; latestValueHarness.state.sync.objects = { "projector-1": { designerId: "projector-uid", path: "objects/projector/projector.apx" } }; const latestWrites = []; const latestRotationWrites = []; latestValueHarness.__context.disguiseSceneAdapter = { inspectScene() {}, createObject() {}, updateObject() {}, liveSetProjectorProjection(pluginId, position, lookAt, throwRatio) { latestWrites.push({ pluginId, position: JSON.parse(JSON.stringify(position)), lookAt: JSON.parse(JSON.stringify(lookAt)), throwRatio }); return true; }, updateProjectorRotationZ(id, value, path) { latestRotationWrites.push({ id, value, path }); return Promise.resolve({ readback: { projectorRoll: value } }); } }; latestValueHarness.state.liveEnabled = true; assert.equal(latestValueHarness.projectorAutoThrowRatio(latestProjector), 1.521); latestValueHarness.queueProjectorProjection(latestProjector, "test"); latestProjector.transform.position.x = 3; await new Promise(resolve => setTimeout(resolve, 60)); assert.deepEqual(JSON.parse(JSON.stringify(latestWrites.at(-1))), { pluginId: "projector-1", position: { x: 3, y: 3, z: -12 }, lookAt: { x: 0, y: 1, z: 0 }, throwRatio: 1.566 }); await new Promise(resolve => setTimeout(resolve, 500)); assert.equal(latestRotationWrites.at(-1).value, 0);
  const echoHarness = createHarness(); const echoSurface = sceneObject("surface", "echo-surface", { x: 0, y: -1, z: 0 }); echoSurface.geometry = { width: 8, height: 4 }; const echoProjector = sceneObject("projector", "echo-projector", { x: 0, y: 3, z: -12 }); echoProjector.lookAt = { x: 0, y: 1, z: 0 }; echoProjector.optics = { throwRatio: 1.5, fieldOfView: 40, lookDistance: 1 }; echoProjector.targetSurfacePluginId = echoSurface.pluginId; echoHarness.state.objects = [echoSurface, echoProjector]; echoHarness.state.sync.objects = { "echo-projector": { designerId: "echo-projector-uid", path: "objects/projector/echo.apx" } }; const echoWrites = []; const echoRotations = []; echoHarness.__context.disguiseSceneAdapter = { inspectScene() {}, createObject() {}, updateObject() {}, liveSetProjectorProjection(pluginId, position, lookAt, throwRatio) { echoWrites.push({ pluginId, position, lookAt, throwRatio }); setTimeout(() => { echoHarness.applyLiveValue({ pluginId, field: "transform.position", value: position, echoed: true }); echoHarness.applyLiveValue({ pluginId, field: "lookAt", value: lookAt, echoed: true }); }, 0); return true; }, updateProjectorRotationZ(id, value) { echoRotations.push({ id, value }); return Promise.resolve({ readback: { projectorRoll: value } }); } }; echoHarness.queueProjectorProjection(echoProjector, "echo-test"); await new Promise(resolve => setTimeout(resolve, 620)); echoHarness.cancelProjectorWork(echoProjector.pluginId); assert.equal(echoWrites.length, 2, "own LIVE echoes must not restart cadence or postpone the final flush"); assert.deepEqual(JSON.parse(JSON.stringify(echoRotations)), [{ id: "echo-projector-uid", value: 0 }]);
  const initialReadbackHarness = createHarness(); const initialSurface = sceneObject("surface", "initial-surface", { x: 0, y: -1, z: 0 }); initialSurface.geometry = { width: 8, height: 4 }; const initialProjector = sceneObject("projector", "initial-projector", { x: 0, y: 3, z: -8 }); initialProjector.targetSurfacePluginId = initialSurface.pluginId; initialReadbackHarness.state.objects = [initialSurface, initialProjector]; const initialWrites = []; initialReadbackHarness.__context.disguiseSceneAdapter = { inspectScene() {}, createObject() {}, updateObject() {}, liveSetProjectorProjection(...args) { initialWrites.push(args); return true; } }; initialReadbackHarness.applyLiveValue({ pluginId: "initial-projector", field: "transform.position", value: { x: 1, y: 3, z: -8 }, initial: true }); initialReadbackHarness.applyLiveValue({ pluginId: "initial-projector", field: "lookAt", value: { x: 1, y: 1, z: 0 }, initial: true }); initialReadbackHarness.applyLiveValue({ pluginId: "initial-projector", field: "optics.lookDistance", value: 9, initial: true }); initialReadbackHarness.applyLiveValue({ pluginId: "initial-projector", field: "optics.fieldOfView", value: 28, initial: true }); await new Promise(resolve => setTimeout(resolve, 60)); assert.deepEqual(initialWrites, []);
  const cancellationHarness = createHarness(); const unboundProjector = sceneObject("projector", "cancel-projector", { x: 2, y: 3, z: -9 }); cancellationHarness.state.objects = [unboundProjector]; const cancelledWrites = []; cancellationHarness.__context.disguiseSceneAdapter = { inspectScene() {}, createObject() {}, updateObject() {}, liveSetProjectorProjection(...args) { cancelledWrites.push(args); return true; } }; cancellationHarness.queueProjectorProjection(unboundProjector, "cancel-test"); cancellationHarness.cancelProjectorWork(unboundProjector.pluginId); await new Promise(resolve => setTimeout(resolve, 60)); assert.deepEqual(cancelledWrites, []);
  const modeFreeProjector = core.newObject("projector"); assert.equal("throwRatioAuto" in modeFreeProjector.optics, false); assert.equal("rotationZMode" in modeFreeProjector, false); const importedModeFreeProjector = core.importedObject({ id: "import-mode-free", type: "projector", description: "Imported projector", transform: { position: { x: 0, y: 3, z: -8 }, rotation: { x: 0, y: 0, z: 0 } }, lookAt: { x: 0, y: 1, z: 0 }, optics: { throwRatio: 1.5, fieldOfView: 40, lookDistance: 8 } }, 0); assert.equal("throwRatioAuto" in importedModeFreeProjector.optics, false); assert.equal("rotationZMode" in importedModeFreeProjector, false);
  const projectorOpticsFields = core.fieldSections(horizontalProjector).find(section => section.title === "Optics").fields; assert.equal(projectorOpticsFields.find(field => field[1] === "optics.throwRatio")[5].readOnly, true); assert.equal(projectorOpticsFields.find(field => field[1] === "optics.fieldOfView")[5].readOnly, true); assert.equal(projectorOpticsFields.find(field => field[1] === "optics.lookDistance")[5].readOnly, true);
  assert.deepEqual(JSON.parse(JSON.stringify(core.fieldSections(horizontalProjector).find(section => section.title === "Resolution").fields.map(field => field[1]))), ["media.resolutionX", "media.resolutionY"]);
  assert.deepEqual(JSON.parse(JSON.stringify(payload)), { pluginId: "plugin-screen", type: "screen", name: "screen test", transform: { position: { x: 3, y: 0, z: -5 }, rotation: { x: 0, y: 20, z: 0 } }, geometry: { width: 4, height: 2 }, media: { resolutionX: 1920, resolutionY: 1200, pixelsPerInch: 10 } }); assert.equal(core.validateReadback(payload, resultFor(payload)), true); assert.equal(core.validateReadback(payload, { readback: { transform: { position: { x: 3, y: 0.0000042, z: -5 }, rotation: { x: 0, y: 20, z: 0 } }, geometry: { width: 4, height: 2 } } }), true); assert.equal(core.validateReadback(payload, { readback: { transform: { position: { x: 3, y: 0.0009, z: -5 }, rotation: { x: 0, y: 20, z: 0 } }, geometry: { width: 4, height: 2 } } }), true); assert.throws(() => core.validateReadback(payload, { readback: { transform: { position: { x: 3, y: .0011, z: -5 }, rotation: { x: 0, y: 20, z: 0 } }, geometry: { width: 4, height: 2 } } }), /не пройдена/);
  assert.match(adapterSource, /assign\("offset", Vec\(pos\["x"\], pos\["y"\] \+ geometry\["height"\] \/ 2\.0, pos\["z"\]\)/); assert.match(adapterSource, /assign\("scale", Vec\(geometry\["width"\], geometry\["height"\], 0\.1\)\)/); assert.match(adapterSource, /assign\("configPosition", position_value\)/); assert.match(adapterSource, /assign\("configLookAt"/); assert.match(adapterSource, /configThrowRatio/); assert.match(adapterSource, /configLookDistance/); assert.match(adapterSource, /fieldOfView/); assert.doesNotMatch(adapterSource, /config_rotation = getattr\(obj, "configRotation"/); assert.match(adapterSource, /projectorReadbackProbe/); assert.match(adapterSource, /configPosition\/configLookAt/); assert.match(adapterSource, /stage\.children/); assert.match(adapterSource, /stageId/); assert.match(adapterSource, /scene_path = "objects\/object\/dsg-scene-cube\.apx"/); assert.match(adapterSource, /LookAtManipulable/); assert.match(adapterSource, /needsMesh/); assert.match(adapterSource, /DmxScreen/); assert.match(adapterSource, /FixtureGroup/); assert.match(adapterSource, /dmxScreens/); assert.match(adapterSource, /dmxLights/); assert.match(adapterSource, /resourcePath\(payload\)/); assert.match(adapterSource, /desired_path = folder/); assert.match(adapterSource, /obj\.rename\(Path\(desired_path\)\)/); assert.match(adapterSource, /resourceManager\.remove\(resource_path\)/); assert.match(adapterSource, /deleteManagedScript/); assert.match(adapterSource, /liveUpdate: true/); assert.match(adapterSource, /LIVE_PATH = "\/api\/session\/liveupdate"/); assert.match(adapterSource, /sourcePath = String\(record\?\.path/); assert.match(adapterSource, /BigInt\(String\(designerId\)/); assert.match(adapterSource, /getByUID\(0x\$\{uid\.toString\(16\)\}\)/); assert.match(adapterSource, /subscribe: \{ object, properties \}/); assert.match(adapterSource, /const collections = \["ledScreens", "dmxScreens", "dmxLights", "surfaces", "projectors", "cameras"\]/); assert.match(adapterSource, /set: changes/); assert.match(adapterSource, /binding\.initialized/); assert.match(adapterSource, /binding\.remote = change\.value/); assert.match(adapterSource, /liveResetSubscriptionIds/); assert.match(adapterSource, /resubscribing/); assert.match(adapterSource, /liveLog\("subscribed"/); assert.match(adapterSource, /pluginId: binding\?\.pluginId/); assert.doesNotMatch(adapterSource, /field === "transform\.position\.y" && \["screen", "surface"\]/); assert.match(adapterSource, /add\("transform\.position\.y", "object\.offset\.y", value => Number\(value\) \+ Number\(payload\.geometry\?\.height \|\| 0\) \/ 2/); assert.match(adapterSource, /getLiveLogs/); assert.doesNotMatch(adapterSource, /stage\.floor_size\s*=/); assert.doesNotMatch(adapterSource, /posRelativeOrGlobal/); assert.doesNotMatch(adapterSource, /rotRelativeOrGlobal/); assert.doesNotMatch(adapterSource, /triangle\.a\s*=/); assert.doesNotMatch(adapterSource, /triangle\.b\s*=/); assert.doesNotMatch(adapterSource, /triangle\.c\s*=/); assert.match(adapterSource, /typeClasses = .*camera: "Camera"/); assert.match(adapterSource, /existing resource class conflict/); assert.match(adapterSource, /raise RuntimeError/);
  assert.doesNotMatch(indexSource, /id="stage-enabled"/); assert.doesNotMatch(indexSource, /id="stage-center-x"/); assert.doesNotMatch(indexSource, /id="stage-center-z"/); assert.ok(indexSource.includes('id="scene-width"')); assert.ok(indexSource.includes('id="scene-depth"')); assert.doesNotMatch(indexSource, /Synchronize|Clear plan/); assert.doesNotMatch(indexSource, /id="live-toggle"/); assert.doesNotMatch(appSource, /#live-toggle/); assert.match(indexSource, /id="startup-warning"/); assert.match(indexSource, /I accept responsibility/); assert.doesNotMatch(indexSource, /id="objects-toggle"/); assert.doesNotMatch(indexSource, /id="clear-scene-button"/); assert.doesNotMatch(indexSource, /id="live-log-button"|id="live-log-panel"|id="live-log-output"/); assert.match(indexSource, /data-create-type="dmxScreen"/); assert.match(indexSource, /data-create-type="dmxLight"/); assert.equal(packageSource.version, "0.23.0"); assert.match(indexSource, /styles\.css\?v=0.23\.0/); assert.match(indexSource, /designer-adapter\.js\?v=0.23\.0/); assert.match(indexSource, /app\.js\?v=0.23\.0/); assert.match(indexSource, /title>2D Scene Planner v0.23.0 for Disguise Designer/); assert.doesNotMatch(indexSource, /status-error-chip|status-errors/); assert.doesNotMatch(stylesSource, /status-error-chip|live-log-panel|live-log-button/); assert.doesNotMatch(indexSource, /id="diagnostics-panel"|id="diagnostics-export-button"/); assert.doesNotMatch(indexSource, /data-add-type=/); assert.doesNotMatch(indexSource, /id="reset-button"/); assert.match(indexSource, /id="snap-mode" aria-label="Magnet"/); assert.doesNotMatch(indexSource, /id="align-x"|id="align-z"/);
  assert.deepEqual(JSON.parse(JSON.stringify(core.fieldSections(core.newObject("camera")).map(section => section.fields?.map(field => field[1]) || []))), [["transform.position.x", "transform.position.z", "transform.position.y"], ["transform.rotation.y"]]);
  assert.equal(core.nextDimensionField(core.newObject("screen"), "geometry.width"), "geometry.height"); assert.equal(core.nextDimensionField(core.newObject("screen"), "geometry.height"), "transform.position.y"); assert.equal(core.nextDimensionField(core.newObject("screen"), "transform.position.y"), null); assert.equal(core.nextDimensionField(core.newObject("projector"), "geometry.width"), null);
  assert.equal(core.initialObjectFocusPath(core.newObject("screen")), "geometry.width"); assert.equal(core.initialObjectFocusPath(core.newObject("projector")), "transform.position.y");
  const camera = core.newObject("camera"); core.setObjectHeight(camera, 2.2); assert.equal(core.newObject("camera").transform.position.y, 2.2); const projector = core.newObject("projector"); const aimBeforeMove = { ...projector.lookAt }; const beforeProjectorMove = core.objectPayload(projector); core.setObjectPlanPosition(projector, 2, -3); assert.deepEqual(JSON.parse(JSON.stringify(projector.lookAt)), aimBeforeMove); assert.deepEqual(JSON.parse(JSON.stringify(core.changedValue(beforeProjectorMove, core.objectPayload(projector)))), { transform: { position: { x: 2, z: -3 } } }); const beforeLookAtMove = core.objectPayload(projector); projector.lookAt.x = 4; assert.deepEqual(JSON.parse(JSON.stringify(core.changedValue(beforeLookAtMove, core.objectPayload(projector)))), { lookAt: { x: 4 } }); assert.ok(core.fieldSections(projector).some(section => section.targetSurface)); assert.deepEqual(JSON.parse(JSON.stringify(core.fieldSections(projector).find(section => section.title === "Optics").fields.map(field => field[1]))), ["optics.throwRatio", "optics.fieldOfView", "optics.lookDistance", "derived.projectedPixelSizeMm"]);
  assert.match(appSource, /pending: true/); assert.match(appSource, /distance < 4/); assert.doesNotMatch(appSource, /state\.dragging\.kind === "object" && state\.dragging\.ctrlKey/); assert.match(appSource, /focusActiveField\(path/); assert.match(appSource, /activeFieldRefs\.set\(path, input\)/); assert.match(appSource, /stopImmediatePropagation/); assert.match(appSource, /addEventListener\("keyup"/); assert.doesNotMatch(appSource, /ensureLiveObjects/); assert.match(appSource, /scheduleLiveSceneImport/); assert.match(appSource, /deleteManagedObjects/); assert.match(appSource, /STANDALONE_PREVIEW/); assert.doesNotMatch(appSource, /liveValueQueue/); assert.doesNotMatch(appSource, /livePendingValues/);
  assert.match(appSource, /logPlannerAction\("duplicate"/); assert.match(appSource, /logPlannerAction\("delete"/); assert.match(appSource, /logPlannerAction\("create"/);
  assert.match(appSource, /context-delete-imported/); assert.match(indexSource, /Imported from Designer/); assert.match(indexSource, /> Delete from Device list</); assert.match(appSource, /deleteFromDeviceList/); assert.match(appSource, /confirm-delete-device-list/); assert.doesNotMatch(appSource, /suppressImportedDeleteWarning/); assert.doesNotMatch(indexSource, /Copy diagnostics/); assert.match(appSource, /navigator\.clipboard\.writeText/); assert.match(appSource, /document\.execCommand\("copy"\)/); assert.doesNotMatch(appSource, /link\.download|createObjectURL/);
  assert.match(appSource, /previousSelectedPluginId/); assert.match(appSource, /activeFieldPath = document\.activeElement/); assert.match(appSource, /const wanted = Boolean\(liveState\?\.wanted\)/); assert.match(appSource, /state\.objects\.splice\(Math\.min\(index, state\.objects\.length\)/);
  assert.match(appSource, /event\.code === "KeyC"/); assert.match(appSource, /event\.code === "KeyV"/); assert.match(appSource, /state\.dragging\.kind === "lookAt"/); assert.match(appSource, /ctx\.fillRect\(-r, -r, r \* 2, r \* 2\)/); assert.match(appSource, /rotationHandleGeometry|drawRotationHandle|hitTestRotationHandle/); assert.match(appSource, /targetSurfacePluginId/);
  for (const action of ["align-left", "align-center-x", "align-right", "align-top", "align-center-z", "align-bottom"]) assert.match(indexSource, new RegExp(`data-action="${action}"`));
  assert.match(appSource, /const ZOOM_MIN = \.1/); assert.match(appSource, /const ZOOM_MAX = 3/); assert.match(appSource, /kind: "pan"/); assert.match(appSource, /input\.addEventListener\("contextmenu"/); assert.match(appSource, /toggleObjectSelection/);
  assert.match(appSource, /window\.addEventListener\("copy"/); assert.match(appSource, /window\.addEventListener\("paste"/);
  const heightHarness = createHarness(); const heightScreen = heightHarness.newObject("screen"); heightHarness.state.stage = { width: 12, depth: 8 }; heightScreen.transform.position.y = 1; assert.equal(heightHarness.objectHeightValue(heightScreen), 1); heightHarness.setObjectHeight(heightScreen, -3); assert.equal(heightScreen.transform.position.y, -3); assert.equal(heightHarness.objectHeightValue(heightScreen), -3);
  const migrated = createHarness({ version: 5, room: { width: 20, depth: 12 }, stage: { centerX: 3, centerZ: -2, floorY: 1.1, width: 10, depth: 6, height: 0.6 }, nextId: 2, objects: [{ id: 1, pluginId: "old-screen", type: "screen", name: "Old", transform: { position: { x: 4, y: 1.5, z: -2 }, rotation: { x: 7, y: 35, z: 9 } }, geometry: { width: 4, height: 2 } }] }); assert.deepEqual(JSON.parse(JSON.stringify(migrated.state.stage)), { width: 20, depth: 12 });
  core.state.stage = { width: 20, depth: 12 }; const frame = { left: 100, top: 50, scale: 10 }; assert.deepEqual(JSON.parse(JSON.stringify(core.toScreen(10, -5, frame))), { x: 300, y: 160 }); assert.deepEqual(JSON.parse(JSON.stringify(core.stageBounds())), { minX: -10, maxX: 10, minZ: -6, maxZ: 6 });
  const schema = JSON.parse(fs.readFileSync(path.join(root, "schemas", "scene.schema.json"), "utf8")); assert.deepEqual(schema.required, ["version", "units", "coordinateSystem", "stage", "objects"]); assert.ok(schema.$defs.stageObject.properties.type.enum.includes("designer"));
  core.state.stage = { width: 20, depth: 12 }; core.state.objects = [sceneObject("screen", "hit-screen", { x: 0, y: 0, z: 0 })]; assert.equal(core.hitTest(600, 400).pluginId, "hit-screen"); assert.equal(core.hitTest(600, 410), undefined);
  core.state.objects = [];
  const inspection = { objects: [{ id: "uid-1", type: "projector", path: "objects/projector/dsg-p-1.apx", description: "Front projector", transform: { position: { x: 3, y: 2.5, z: -5 }, rotation: { x: 12, y: 34, z: 56 } }, lookAt: { x: 0, y: 1, z: 0 }, className: "Projector", collection: "projectors", managed: true, pluginId: "p-1" }, { id: "uid-2", type: "designer", path: "objects/prop/manual.apx", description: "Manual prop", transform: { position: { x: 1, y: 0, z: 2 }, rotation: { x: 0, y: 0, z: 0 } }, className: "Prop", collection: "children" }], floorY: 0, floorPosition: { x: 0, y: 0, z: 0 }, stageFootprint: { width: 24, depth: 14 }, sceneCube: { designerId: "cube", path: "objects/object/dsg-scene-cube.apx" } };
  await core.importDesignerScene({ inspectScene: async () => inspection }); assert.equal(core.state.objects.length, 2); assert.equal(core.state.objects[0].name, "Front projector"); assert.deepEqual(JSON.parse(JSON.stringify(core.state.objects[0].transform.rotation)), { x: 0, y: 0, z: 0 }); assert.equal(core.state.objects[1].type, "designer"); assert.equal(core.state.stage.width, 24); assert.equal("sceneCube" in core.state.sync, false);
  const bindingImportHarness = createHarness(); await bindingImportHarness.importDesignerScene({ inspectScene: async () => ({ objects: [{ id: "surface-import-uid", type: "surface", path: "objects/screen2/imported surface.apx", description: "Imported Surface", transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } }, geometry: { width: 4, height: 2 } }, { id: "projector-import-uid", type: "projector", path: "objects/projector/imported projector.apx", description: "Imported Projector", transform: { position: { x: 0, y: 3, z: -8 }, rotation: { x: 0, y: 0, z: 0 } }, lookAt: { x: 0, y: 1, z: 0 }, screens: [{ designerId: "surface-import-uid", path: "objects/screen2/imported surface.apx" }] }], floorY: 0 }) }); const importedBoundProjector = bindingImportHarness.state.objects.find(object => object.type === "projector"); const importedBoundSurface = bindingImportHarness.state.objects.find(object => object.type === "surface"); assert.equal(importedBoundProjector.targetSurfacePluginId, importedBoundSurface.pluginId);
  const noCubeHarness = createHarness({ version: 5, room: { width: 20, depth: 12 }, stage: { width: 12, depth: 8 }, objects: [sceneObject("screen", "local-only")] }); await noCubeHarness.importDesignerScene({ inspectScene: async () => ({ objects: [], floorY: 0, stageFootprint: { width: 20, depth: 12 }, sceneCube: null }) }); assert.equal(noCubeHarness.state.objects.length, 0); assert.equal(noCubeHarness.state.stage.width, 20);
  const current = sceneObject("screen", "managed-screen", { x: 1, y: 1.5, z: 3 }); const previousPayload = core.objectPayload(current); previousPayload.transform.position.y = 0; core.state.objects = [current]; core.state.sync.objects = { "managed-screen": { designerId: "managed-uid", lastExported: "old", payload: previousPayload } }; const managedInspection = { objects: [{ id: "managed-uid", type: "screen", path: "objects/ledscreen/dsg-managed-screen.apx", managed: true }], floorY: 0 }; const diff = await core.makeDiff({ inspectScene: async () => managedInspection }, "update"); assert.deepEqual(JSON.parse(JSON.stringify(diff.update[0].changed)), { name: "screen test", transform: { position: { y: 1.5 } } });
  const missingDiff = await core.makeDiff({ inspectScene: async () => ({ objects: [], floorY: 0 }) }, "update"); assert.equal(missingDiff.create.length, 0); assert.equal(missingDiff.missing.length, 1);
  const nameHarness = createHarness(); nameHarness.state.objects = [nameHarness.newObject("screen"), nameHarness.newObject("screen")]; nameHarness.state.objects[0].name = "LED Screen 2"; nameHarness.state.objects[1].name = "LED Screen 3"; assert.equal(nameHarness.newObject("screen").name, "LED Screen 4");
  const clipboardHarness = createHarness(); const copiedScreen = clipboardHarness.newObject("screen"); const copiedCamera = clipboardHarness.newObject("camera"); clipboardHarness.state.objects = [copiedScreen, copiedCamera]; clipboardHarness.state.selectedId = copiedScreen.id; clipboardHarness.state.selectedIds = new Set([copiedScreen.id, copiedCamera.id]); assert.equal(clipboardHarness.copySelectedObjects(), true); assert.equal(clipboardHarness.pasteCopiedObjects(), true); assert.equal(clipboardHarness.state.objects.length, 4); assert.equal(new Set(clipboardHarness.state.objects.map(object => object.pluginId)).size, 4);
  const deleteHarness = createHarness(); const importedScreen = sceneObject("screen", "designer-manual"); deleteHarness.state.objects = [importedScreen]; deleteHarness.state.sync.objects = { "designer-manual": { designerId: "manual-uid", path: "objects/ledscreen/1.apx", imported: true, owned: false } }; let deleteCalls = 0; deleteHarness.__context.disguiseSceneAdapter = { inspectScene() {}, createObject() {}, updateObject() {}, async deleteDesignerObjects() { deleteCalls += 1; return { deleted: ["manual-uid"], skipped: [] }; } }; await deleteHarness.deleteObject(importedScreen.id, { deleteFromDesigner: true }); assert.equal(deleteCalls, 1); assert.equal(deleteHarness.state.objects.length, 0); assert.equal(deleteHarness.state.sync.objects["designer-manual"], undefined);
  const importedDeleteHarness = createHarness(); const importedProjector = sceneObject("projector", "imported-projector"); importedDeleteHarness.state.objects = [importedProjector]; importedDeleteHarness.state.sync.objects = { "imported-projector": { designerId: "imported-uid", path: "objects/projector/imported.apx", imported: true, owned: false } }; let importedDeleteRequest; importedDeleteHarness.__context.disguiseSceneAdapter = { inspectScene() {}, createObject() {}, updateObject() {}, async deleteDesignerObjects(request) { importedDeleteRequest = request; return { deleted: ["imported-uid"], skipped: [] }; } }; await importedDeleteHarness.deleteObject(importedProjector.id, { deleteFromDesigner: true }); assert.deepEqual(JSON.parse(JSON.stringify(importedDeleteRequest)), [{ id: "imported-uid", path: "objects/projector/imported.apx", removeResource: false }]); assert.equal(importedDeleteHarness.state.objects.length, 0);
  const ownedDeleteHarness = createHarness(); const ownedProjector = sceneObject("projector", "owned-projector"); ownedDeleteHarness.state.objects = [ownedProjector]; ownedDeleteHarness.state.sync.objects = { "owned-projector": { designerId: "projector-uid", path: "objects/projector/projector 2.apx", owned: true, ownedPaths: ["objects/projector/projector 2.apx", "objects/projectorconfig/projector 2_config0.apx"] } }; let deleteRequest; ownedDeleteHarness.__context.disguiseSceneAdapter = { inspectScene() {}, createObject() {}, updateObject() {}, async deleteManagedObjects(request) { deleteRequest = request; return { deleted: ["projector-uid"], skipped: [] }; } }; await ownedDeleteHarness.deleteObject(ownedProjector.id, { deleteFromDesigner: true }); assert.deepEqual(JSON.parse(JSON.stringify(deleteRequest)), [{ id: "projector-uid", path: "objects/projector/projector 2.apx", owned: true, ownedPaths: ["objects/projector/projector 2.apx", "objects/projectorconfig/projector 2_config0.apx"], removeResource: false }]);
  const cleanupFailureHarness = createHarness(); const cleanupProjector = sceneObject("projector", "cleanup-projector"); cleanupFailureHarness.state.objects = [cleanupProjector]; cleanupFailureHarness.state.sync.objects = { "cleanup-projector": { designerId: "cleanup-uid", path: "objects/projector/cleanup.apx", owned: true, ownedPaths: ["objects/projector/cleanup.apx", "objects/projectorconfig/cleanup_config0.apx"] } }; cleanupFailureHarness.__context.disguiseSceneAdapter = { inspectScene() {}, createObject() {}, updateObject() {}, async deleteManagedObjects() { return { deleted: ["cleanup-uid"], resourcesDeleted: [], resourceDeleteFailed: ["cleanup-uid"], skipped: ["resource delete cleanup-uid: busy"], cleanupPhases: [{ id: "cleanup-uid", phase: "stage-detach", status: "ok", path: "objects/projector/cleanup.apx" }, { id: "cleanup-uid", phase: "auxiliary-remove", status: "failed", path: "objects/projectorconfig/cleanup_config0.apx", error: "busy" }] }; } }; await cleanupFailureHarness.deleteObject(cleanupProjector.id, { deleteFromDesigner: true, deleteFromDeviceList: true }); assert.equal(cleanupFailureHarness.state.objects.length, 0); assert.equal("errors" in cleanupFailureHarness.state.sync, false); assert.match(cleanupFailureHarness.__elements.get("#adapter-status").textContent, /Device list cleanup failed/); const cleanupLogs = cleanupFailureHarness.plannerLogEntries.filter(entry => entry.objectName === cleanupProjector.name); assert.ok(cleanupLogs.some(entry => entry.phase === "stage-detach" && entry.level === "info")); assert.ok(cleanupLogs.some(entry => entry.phase === "auxiliary-remove" && entry.level === "error" && /busy/.test(entry.message))); assert.ok(cleanupLogs.some(entry => entry.phase === "device-list" && entry.level === "error" && /busy/.test(entry.message)));
  const cleanupRetry = sceneObject("screen", "cleanup-retry"); cleanupFailureHarness.state.objects = [cleanupRetry]; cleanupFailureHarness.state.sync.objects[cleanupRetry.pluginId] = { designerId: "retry-uid", path: "objects/ledscreen/retry.apx", owned: true, ownedPaths: ["objects/ledscreen/retry.apx"] }; cleanupFailureHarness.__context.disguiseSceneAdapter.deleteManagedObjects = async () => ({ deleted: ["retry-uid"], resourcesDeleted: ["objects/ledscreen/retry.apx"], resourceDeleteFailed: [], skipped: [], cleanupPhases: [{ id: "retry-uid", phase: "main-resource-remove", status: "ok", path: "objects/ledscreen/retry.apx" }] }); await cleanupFailureHarness.deleteObject(cleanupRetry.id, { deleteFromDesigner: true, deleteFromDeviceList: true }); assert.ok(cleanupFailureHarness.plannerLogEntries.some(entry => entry.phase === "device-list" && entry.level === "error" && /busy/.test(entry.message)), "historical errors remain visible after a later success"); assert.equal("errors" in cleanupFailureHarness.state.sync, false);
  const dmxDeleteHarness = createHarness(); const dmxDeleteObject = sceneObject("dmxLight", "dmx-stage-only"); dmxDeleteHarness.state.objects = [dmxDeleteObject]; dmxDeleteHarness.state.sync.objects = { [dmxDeleteObject.pluginId]: { designerId: "dmx-stage-only-uid", path: "objects/fixturegroup/dmx stage only.apx", owned: true, ownedPaths: ["objects/fixturegroup/dmx stage only.apx"] } }; const dmxDeleteRequests = []; dmxDeleteHarness.__context.disguiseSceneAdapter = { inspectScene() {}, createObject() {}, updateObject() {}, async deleteManagedObjects(request) { dmxDeleteRequests.push(JSON.parse(JSON.stringify(request))); return { deleted: ["dmx-stage-only-uid"], skipped: [], resourceDeleteFailed: [] }; } }; await dmxDeleteHarness.deleteObject(dmxDeleteObject.id, { deleteFromDesigner: true, deleteFromDeviceList: true }); assert.deepEqual(dmxDeleteRequests, [[{ id: "dmx-stage-only-uid", path: "objects/fixturegroup/dmx stage only.apx", owned: true, ownedPaths: ["objects/fixturegroup/dmx stage only.apx"], removeResource: false }]], "DMX Light deletion must remain Stage-only even when an old caller requests Device List deletion");
  const liveHarness = createHarness(); const liveOnly = sceneObject("screen", "live-only"); liveHarness.state.objects = [liveOnly]; liveHarness.state.liveEnabled = true; let liveCreateCalls = 0; let liveInspectCalls = 0; let liveSendCalls = 0; liveHarness.__context.disguiseSceneAdapter = { inspectScene() { liveInspectCalls += 1; return { objects: [] }; }, createObject() { liveCreateCalls += 1; }, updateObject() {}, liveSync() { liveSendCalls += 1; return true; } }; await liveHarness.runLiveSync(); assert.equal(liveCreateCalls, 0); assert.equal(liveInspectCalls, 0); assert.equal(liveSendCalls, 1);
  const createHarnessOnce = createHarness(); const createdScreen = sceneObject("screen", "created-screen"); createHarnessOnce.state.objects = [createdScreen]; let explicitCreateCalls = 0; const createdScreenResult = resultFor(createHarnessOnce.objectPayload(createdScreen), "created-uid"); createdScreenResult.path = "objects/ledscreen/created.apx"; createdScreenResult.ownedPaths = [createdScreenResult.path, "objects/directprojection/created_directprojection.apx"]; createHarnessOnce.__context.disguiseSceneAdapter = { inspectScene() {}, updateObject() {}, async createObject() { explicitCreateCalls += 1; return createdScreenResult; } }; await createHarnessOnce.createDesignerObject(createdScreen); await createHarnessOnce.createDesignerObject(createdScreen); assert.equal(explicitCreateCalls, 1); assert.equal(createHarnessOnce.state.sync.objects[createdScreen.pluginId].designerId, "created-uid");
  const delayedStageHarness = createHarness(); const delayedCamera = sceneObject("camera", "delayed-camera"); const delayedLight = sceneObject("dmxLight", "delayed-light"); delayedStageHarness.state.objects = [delayedCamera, delayedLight]; delayedStageHarness.state.sync.objects = { "delayed-camera": { pluginId: "delayed-camera", designerId: "camera-uid", path: "objects/camera/camera 2.apx", owned: true, ownedPaths: ["objects/camera/camera 2.apx"] }, "delayed-light": { pluginId: "delayed-light", designerId: "light-uid", path: "objects/fixturegroup/dmx light 2.apx", owned: true, ownedPaths: ["objects/fixturegroup/dmx light 2.apx"] } }; await delayedStageHarness.importDesignerScene({ inspectScene: async () => ({ objects: [], floorY: 0 }) }, { preserveLocal: true }); assert.deepEqual(JSON.parse(JSON.stringify(delayedStageHarness.state.objects.map(object => object.pluginId).sort())), []); assert.equal(delayedStageHarness.state.sync.objects["delayed-camera"], undefined); assert.equal(delayedStageHarness.state.sync.objects["delayed-light"], undefined);
  const surfaceHighlightHarness = createHarness(); const highlightedSurface = sceneObject("surface", "highlighted-surface"); surfaceHighlightHarness.state.objects = [highlightedSurface]; surfaceHighlightHarness.selectObject(highlightedSurface); assert.equal(surfaceHighlightHarness.state.highlightObjectId, highlightedSurface.id);
  const freePlacementHarness = createHarness(); freePlacementHarness.state.stage = { width: 20, depth: 12 }; const outsideCamera = freePlacementHarness.addObjectAt("camera", 13, -9); assert.deepEqual(JSON.parse(JSON.stringify(outsideCamera.transform.position)), { x: 13, y: 1.5, z: -9 }); const outsideProjector = freePlacementHarness.addObjectAt("projector", -14, 8); freePlacementHarness.updateProjectorTargetPlacement({ x: 15, z: -10 }); assert.deepEqual(JSON.parse(JSON.stringify(outsideProjector.lookAt)), { x: 15, y: 0, z: -10 }); freePlacementHarness.cancelProjectorTargetPlacement();
  const freeDragHarness = createHarness(); const draggedCamera = sceneObject("camera", "drag-camera", { x: 0, y: 1.5, z: 0 }); freeDragHarness.state.objects = [draggedCamera]; freeDragHarness.selectObject(draggedCamera); const freeDragCanvas = freeDragHarness.__elements.get("#scene-canvas"); freeDragCanvas._listeners.pointerdown({ button: 0, clientX: 600, clientY: 400, pointerId: 1 }); freeDragCanvas._listeners.pointermove({ clientX: 1300, clientY: 400 }); assert.ok(draggedCamera.transform.position.x > 10);
  const groupDragHarness = createHarness(); const groupCameraA = sceneObject("camera", "group-a", { x: 0, y: 1.5, z: 0 }); const groupCameraB = sceneObject("camera", "group-b", { x: 2, y: 1.5, z: 0 }); groupCameraB.id = 2; groupDragHarness.state.objects = [groupCameraA, groupCameraB]; groupDragHarness.state.selectedId = groupCameraA.id; groupDragHarness.state.selectedIds = new Set([groupCameraA.id, groupCameraB.id]); const groupDragCanvas = groupDragHarness.__elements.get("#scene-canvas"); groupDragCanvas._listeners.pointerdown({ button: 0, clientX: 600, clientY: 400, pointerId: 2 }); groupDragCanvas._listeners.pointermove({ clientX: 1300, clientY: 400 }); assert.ok(groupCameraA.transform.position.x > 10); assert.ok(groupCameraB.transform.position.x > 12);
  const rotationHarness = createHarness(); const rotatedCamera = sceneObject("camera", "rotation-camera", { x: 0, y: 1.5, z: 0 }); rotatedCamera.transform.rotation.y = 0; rotationHarness.state.objects = [rotatedCamera]; rotationHarness.selectObject(rotatedCamera); const rotationHandle = rotationHarness.rotationHandleGeometry(rotatedCamera); assert.equal(rotationHarness.hitTestRotationHandle(rotationHandle.x, rotationHandle.y)?.pluginId, rotatedCamera.pluginId); const rotationCanvas = rotationHarness.__elements.get("#scene-canvas"); rotationCanvas._listeners.pointerdown({ button: 0, clientX: rotationHandle.x, clientY: rotationHandle.y, pointerId: 9 }); rotationCanvas._listeners.pointermove({ clientX: 700, clientY: 400 }); assert.equal(rotatedCamera.transform.rotation.y, 90, "Dragging the 2D rotation handle to the right must set yaw to 90 degrees"); rotationCanvas._listeners.pointerup({ pointerId: 9 });
  rotatedCamera.transform.rotation.y = 37;
  const offsetHandle = rotationHarness.rotationHandleGeometry(rotatedCamera);
  rotationCanvas._listeners.pointerdown({ button: 0, clientX: offsetHandle.x + 10, clientY: offsetHandle.y, pointerId: 10 });
  rotationCanvas._listeners.pointermove({ clientX: offsetHandle.x + 15, clientY: offsetHandle.y });
  assert.ok(rotatedCamera.transform.rotation.y > 37 && rotatedCamera.transform.rotation.y < 45, "Grabbing the edge of the rotation handle must apply pointer delta without a first-move yaw jump");
  rotationCanvas._listeners.pointerup({ pointerId: 10 });
  rotationHarness.alignObjectToStage(rotatedCamera, "align-left"); assert.equal(rotatedCamera.transform.position.x, -10);
  rotationHarness.alignObjectToStage(rotatedCamera, "align-center-x"); assert.equal(rotatedCamera.transform.position.x, 0);
  rotationHarness.alignObjectToStage(rotatedCamera, "align-right"); assert.equal(rotatedCamera.transform.position.x, 10);
  rotationHarness.alignObjectToStage(rotatedCamera, "align-top"); assert.equal(rotatedCamera.transform.position.z, 6);
  rotationHarness.alignObjectToStage(rotatedCamera, "align-center-z"); assert.equal(rotatedCamera.transform.position.z, 0);
  rotationHarness.alignObjectToStage(rotatedCamera, "align-bottom"); assert.equal(rotatedCamera.transform.position.z, -6);
  const alignedSurface = sceneObject("surface", "aligned-surface", { x: 0, y: 0, z: 0 });
  alignedSurface.geometry = { width: 4, height: 2 };
  alignedSurface.transform.rotation.y = 30;
  rotationHarness.state.objects = [alignedSurface];
  rotationHarness.alignObjectToStage(alignedSurface, "align-left"); assert.equal(alignedSurface.transform.position.x, -8.243, "Left alignment must place the rotated visible edge on the Stage edge");
  rotationHarness.alignObjectToStage(alignedSurface, "align-right"); assert.equal(alignedSurface.transform.position.x, 8.243, "Right alignment must place the rotated visible edge on the Stage edge");
  rotationHarness.alignObjectToStage(alignedSurface, "align-top"); assert.equal(alignedSurface.transform.position.z, 4.957, "Top alignment must account for the rotated visible extent");
  rotationHarness.alignObjectToStage(alignedSurface, "align-bottom"); assert.equal(alignedSurface.transform.position.z, -4.957, "Bottom alignment must account for the rotated visible extent");
  const planarHandleHarness = createHarness();
  const planarHandleDistances = [];
  for (const width of [1, 5, 20]) {
    const planar = sceneObject("surface", `planar-handle-${width}`, { x: 0, y: 0, z: 0 });
    planar.geometry = { width, height: 2 };
    planar.transform.rotation.y = 45;
    planarHandleHarness.state.objects = [planar];
    planarHandleHarness.selectObject(planar);
    const handle = planarHandleHarness.rotationHandleGeometry(planar);
    planarHandleDistances.push(Math.hypot(handle.x - handle.centre.x, handle.y - handle.centre.y));
  }
  assert.ok(Math.max(...planarHandleDistances) - Math.min(...planarHandleDistances) < 0.001, "Planar rotation handle distance must stay visually constant as width changes");
  const autoDefaultProjector = createHarness().newObject("projector");
  assert.equal(autoDefaultProjector.optics.autoThrowRatio, true, "New projectors must default to automatic throw ratio");
  const legacyProjector = createHarness().importedObject({ id: "legacy-auto", type: "projector", description: "Legacy projector", transform: { position: { x: 0, y: 3, z: -8 }, rotation: { x: 0, y: 0, z: 0 } }, lookAt: { x: 0, y: 1, z: 0 }, optics: { throwRatio: 1.5, fieldOfView: 40, lookDistance: 8 } }, 0);
  assert.equal(legacyProjector.optics.autoThrowRatio, true, "Imported projectors without the new flag must remain automatic");
  const manualSurface = sceneObject("surface", "manual-surface", { x: 0, y: 0, z: 0 }); manualSurface.geometry = { width: 4, height: 2 };
  const manualProjector = sceneObject("projector", "manual-projector", { x: 0, y: 1, z: -12 }); manualProjector.lookAt = { x: 0, y: 1, z: 0 }; manualProjector.optics = { throwRatio: 2.25, fieldOfView: 40, lookDistance: 12, autoThrowRatio: false }; manualProjector.targetSurfacePluginId = manualSurface.pluginId;
  const autoHarness = createHarness(); autoHarness.state.objects = [manualSurface, manualProjector];
  autoHarness.recalculateProjectorGeometry(manualProjector); assert.equal(manualProjector.optics.throwRatio, 2.25, "Manual throw ratio must survive geometry recalculation"); assert.equal(autoHarness.projectorGeometry(manualProjector).throwRatio, 2.25, "Planner preview must use the manual throw ratio");
  const manualOptics = autoHarness.fieldSections(manualProjector).find(section => section.title === "Optics"); assert.equal(manualOptics.autoThrowRatio, true); assert.equal(manualOptics.fields.find(field => field[1] === "optics.throwRatio")[5].readOnly, false, "Manual throw ratio must be editable");
  const manualWrites = []; autoHarness.state.sync.objects = { [manualProjector.pluginId]: { designerId: "manual-projector-uid", path: "objects/projector/manual.apx" } }; autoHarness.__context.disguiseSceneAdapter = { inspectScene() {}, createObject() {}, updateObject() {}, liveSetProjectorProjection(pluginId, position, lookAt, throwRatio) { manualWrites.push({ pluginId, throwRatio }); return true; } }; autoHarness.state.liveEnabled = true; await autoHarness.commitFieldChange(manualProjector, "optics.throwRatio"); await new Promise(resolve => setTimeout(resolve, 60)); assert.equal(manualWrites.at(-1).throwRatio, 2.25, "Manual throw ratio must use the existing projector LIVE path");
  manualProjector.optics.autoThrowRatio = true; autoHarness.recalculateProjectorGeometry(manualProjector); assert.equal(manualProjector.optics.throwRatio, 3, "Re-enabling Auto must recalculate throw ratio immediately");
  assert.doesNotMatch(indexSource, /id="diagnostics-panel"/, "Diagnostics must not be part of the user-facing planner UI");
  assert.equal(pluginManifest.name, "2D Scene Planner");
  assert.match(indexSource, /title>2D Scene Planner v0\.23\.0/);
  assert.match(indexSource, /disguise-plugin-window-size" content="900,900"/, "Planner must start at the current minimum width while preserving its launch height");
  assert.match(indexSource, /disguise-plugin-window-min-size" content="900,620"/);
  assert.match(indexSource, /disguise-plugin-window-resizable" content="true"/);
  assert.match(indexSource, /id="info-product-name">2D Scene Planner<\/strong>/);
  assert.match(readmeSource, /^# 2D Scene Planner/m);
  assert.match(readmeSource, /third-party plugin for quickly building simple stage layouts directly inside Designer/i);
  assert.equal(packageSource.description, "Third-party 2D scene planning plugin for Disguise Designer");
  assert.match(indexSource, /id="info-button"/, "Scene header must expose the Info button");
  assert.match(indexSource, /id="info-popover"/, "Info button must open a dedicated popover");
  assert.match(indexSource, /2D Scene Planner/);
  assert.match(indexSource, /drag[\s\S]*move[\s\S]*rotation handle[\s\S]*rotate[\s\S]*wheel\/arrow/i);
  assert.doesNotMatch(indexSource, /Shift\s*[—-]\s*larger step/i, "Info popup must not advertise the removed Shift shortcut");
  assert.match(indexSource, /<a[^>]+href="https:\/\/t\.me\/shadov"[^>]*>t\.me\/shadov<\/a>/i, "Info popup must include the contact link");
  const lookAtDragHarness = createHarness(); const draggedProjector = sceneObject("projector", "drag-look-at", { x: -3, y: 3, z: 0 }); draggedProjector.lookAt = { x: 0, y: 0, z: 0 }; draggedProjector.optics = { throwRatio: 1.5, fieldOfView: 40, lookDistance: 4.243 }; lookAtDragHarness.state.objects = [draggedProjector]; const baselineDragPayload = lookAtDragHarness.objectPayload(draggedProjector); lookAtDragHarness.state.sync.objects = { "drag-look-at": { designerId: "drag-projector-uid", path: "objects/projector/drag.apx", payload: baselineDragPayload } }; const geometryWrites = []; const subscriptionEntries = []; lookAtDragHarness.__context.disguiseSceneAdapter = { inspectScene() {}, createObject() {}, updateObject() { throw new Error("drag must not use Python update"); }, liveSync(entries) { subscriptionEntries.push(...entries); return true; }, liveSetProjectorProjection(pluginId, position, lookAt, throwRatio) { geometryWrites.push({ pluginId, position, lookAt, throwRatio }); return true; } }; lookAtDragHarness.state.liveEnabled = true; lookAtDragHarness.selectObject(draggedProjector); const lookAtCanvas = lookAtDragHarness.__elements.get("#scene-canvas"); lookAtCanvas._listeners.pointerdown({ button: 0, clientX: 600, clientY: 400, pointerId: 3 }); lookAtCanvas._listeners.pointermove({ clientX: 1300, clientY: 400 }); assert.ok(draggedProjector.lookAt.x > 10); await new Promise(resolve => setTimeout(resolve, 60)); lookAtCanvas._listeners.pointerup({ pointerId: 3 }); await new Promise(resolve => setTimeout(resolve, 10)); assert.ok(geometryWrites.length >= 1); assert.equal(geometryWrites.at(-1).pluginId, "drag-look-at"); assert.deepEqual(JSON.parse(JSON.stringify(geometryWrites.at(-1).position)), JSON.parse(JSON.stringify(draggedProjector.transform.position))); assert.deepEqual(JSON.parse(JSON.stringify(geometryWrites.at(-1).lookAt)), JSON.parse(JSON.stringify(draggedProjector.lookAt))); assert.ok(subscriptionEntries.every(entry => entry.subscribeOnly === true));
  const fieldCommitHarness = createHarness(); const fieldSurface = sceneObject("surface", "field-surface"); const fieldProjector = sceneObject("projector", "field-projector", { x: 0, y: 3, z: -8 }); fieldProjector.optics = { throwRatio: 2, fieldOfView: 30, lookDistance: 8 }; fieldProjector.targetSurfacePluginId = fieldSurface.pluginId; fieldCommitHarness.state.objects = [fieldSurface, fieldProjector]; fieldCommitHarness.state.sync.objects = { "field-surface": { designerId: "field-surface-uid", path: "objects/screen2/field.apx" }, "field-projector": { designerId: "field-projector-uid", path: "objects/projector/field.apx" } }; const fieldUpdates = []; fieldCommitHarness.__context.disguiseSceneAdapter = { inspectScene() {}, createObject() {}, async updateObject(id, changed) { fieldUpdates.push({ id, changed }); return { readback: { transform: changed.transform, ...(changed.geometry ? { geometry: changed.geometry } : {}), ...(changed.lookAt ? { lookAt: changed.lookAt } : {}), ...(changed.optics ? { optics: changed.optics } : {}) } }; } }; await fieldCommitHarness.commitFieldChange(fieldSurface, "geometry.width"); assert.deepEqual(fieldUpdates.map(update => update.id), ["field-surface-uid"]); await fieldCommitHarness.commitFieldChange(fieldProjector, "optics.lookDistance"); assert.equal(fieldUpdates.length, 1);
  const enterCommitHarness = createHarness(); const enterProjector = enterCommitHarness.addObjectAt("projector", 0, -8); enterProjector.pluginId = "enter-projector"; enterProjector.optics = { throwRatio: 2, fieldOfView: 30, lookDistance: 8 }; enterCommitHarness.state.sync.objects = { "enter-projector": { designerId: "enter-projector-uid", path: "objects/projector/enter.apx" } }; const enterUpdates = []; enterCommitHarness.__context.disguiseSceneAdapter = { inspectScene() {}, createObject() {}, async updateObject(id, changed) { enterUpdates.push({ id, changed }); return {}; } }; const enterInput = enterCommitHarness.__context.document.querySelectorAll("#active-object-strip input[data-field]").find(input => input.dataset.field === "transform.position.y"); enterInput.value = "4"; enterInput._listeners.keydown({ key: "Enter", preventDefault() {}, stopPropagation() {} }); enterInput._listeners.change({}); await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(enterUpdates.length, 0);
  const enterEvents = []; const enterEvent = phase => ({ key: "Enter", preventDefault() { enterEvents.push(`${phase}:default`); }, stopPropagation() { enterEvents.push(`${phase}:propagation`); }, stopImmediatePropagation() { enterEvents.push(`${phase}:immediate`); } }); enterCommitHarness.__windowListeners.keyup(enterEvent("keyup")); assert.deepEqual(enterEvents, ["keyup:default", "keyup:propagation", "keyup:immediate"], "Enter release must not escape the plugin after the input loses focus and trigger Designer transport shortcuts");
  const arrowCommitHarness = createHarness(); const arrowProjector = arrowCommitHarness.addObjectAt("projector", 0, -8); arrowProjector.pluginId = "arrow-projector"; arrowProjector.optics = { throwRatio: 2, fieldOfView: 30, lookDistance: 8 }; arrowCommitHarness.state.sync.objects = { "arrow-projector": { designerId: "arrow-projector-uid", path: "objects/projector/arrow.apx" } }; const arrowUpdates = []; arrowCommitHarness.__context.disguiseSceneAdapter = { inspectScene() {}, createObject() {}, async updateObject(id, changed) { arrowUpdates.push({ id, changed }); return {}; } }; const arrowInput = arrowCommitHarness.__context.document.querySelectorAll("#active-object-strip input[data-field]").find(input => input.dataset.field === "transform.position.y"); arrowInput._listeners.keydown({ key: "ArrowUp", shiftKey: false, preventDefault() {}, stopPropagation() {} }); await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(arrowUpdates.length, 0);
  const settledInputHarness = createHarness();
  const settledScreen = settledInputHarness.addObjectAt("screen", 0, 0, true);
  settledScreen.transform.position.y = 1;
  settledInputHarness.state.sync.objects = { [settledScreen.pluginId]: { designerId: "settled-screen-uid", path: "objects/ledscreen/settled.apx" } };
  const settledUpdates = []; const settledLive = [];
  settledInputHarness.__context.disguiseSceneAdapter = {
    inspectScene() {}, createObject() {},
    async updateObject(id, changed) { settledUpdates.push({ id, changed: JSON.parse(JSON.stringify(changed)) }); return { readback: { transform: changed.transform, geometry: changed.geometry, media: changed.media } }; },
    liveSync(entries) { settledLive.push(JSON.parse(JSON.stringify(entries))); return true; }
  };
  settledInputHarness.state.liveEnabled = true;
  const settledHeightInput = settledInputHarness.__context.document.querySelectorAll("#active-object-strip input[data-field]").find(input => input.dataset.field === "geometry.height");
  for (let index = 0; index < 40; index += 1) settledHeightInput._listeners.wheel({ deltaY: -1, shiftKey: false, preventDefault() {} });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(settledUpdates.length, 0, "Wheel ticks must never start Python updates while input is active");
  assert.ok(settledLive.length > 0, "Wheel ticks must update Designer through LIVE immediately");
  assert.equal(settledScreen.geometry.height, 6);
  assert.equal(settledScreen.transform.position.y, 1, "Changing screen height must preserve the bottom edge");
  await new Promise(resolve => setTimeout(resolve, 520));
  assert.equal(settledUpdates.length, 1, "Forty wheel ticks must settle into one Python update");
  assert.equal(settledUpdates[0].changed.geometry.height, 6);
  assert.equal(settledUpdates[0].changed.transform.position.y, 1);
  const settledPositionInput = settledInputHarness.__context.document.querySelectorAll("#active-object-strip input[data-field]").find(input => input.dataset.field === "transform.position.x");
  settledPositionInput._listeners.keydown({ key: "ArrowUp", shiftKey: false, preventDefault() {} });
  settledPositionInput._listeners.keydown({ key: "ArrowUp", shiftKey: false, preventDefault() {} });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(settledUpdates.length, 1, "Arrow keys must use LIVE without an immediate Python update");
  await new Promise(resolve => setTimeout(resolve, 520));
  assert.equal(settledUpdates.length, 2, "Repeated arrow keys must settle into one additional Python update");
  assert.equal(settledUpdates[1].changed.transform.position.x, .2);
  const immediateCommitInput = settledInputHarness.__context.document.querySelectorAll("#active-object-strip input[data-field]").find(input => input.dataset.field === "geometry.width");
  immediateCommitInput._listeners.wheel({ deltaY: -1, shiftKey: false, preventDefault() {} });
  immediateCommitInput._listeners.change({});
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(settledUpdates.length, 3, "Enter/blur finalization must commit immediately");
  await new Promise(resolve => setTimeout(resolve, 520));
  assert.equal(settledUpdates.length, 3, "Immediate finalization must cancel the pending delayed commit");
  const deletePendingHarness = createHarness();
  const deletePendingScreen = deletePendingHarness.addObjectAt("screen", 0, 0, true);
  const deletePendingUpdates = [];
  deletePendingHarness.state.sync.objects = { [deletePendingScreen.pluginId]: { designerId: "delete-pending-uid", path: "objects/ledscreen/delete-pending.apx" } };
  deletePendingHarness.__context.disguiseSceneAdapter = { inspectScene() {}, createObject() {}, async updateObject(id, changed) { deletePendingUpdates.push({ id, changed }); return {}; }, async deleteDesignerObjects() { return { deleted: ["delete-pending-uid"], skipped: [] }; } };
  const deletePendingInput = deletePendingHarness.__context.document.querySelectorAll("#active-object-strip input[data-field]").find(input => input.dataset.field === "geometry.width");
  deletePendingInput._listeners.wheel({ deltaY: -1, shiftKey: false, preventDefault() {} });
  await deletePendingHarness.deleteObject(deletePendingScreen.id, { deleteFromDesigner: true });
  await new Promise(resolve => setTimeout(resolve, 520));
  assert.equal(deletePendingUpdates.length, 0, "Deleting an object must cancel its pending field commit");
  const projectorResolutionHarness = createHarness();
  const resolutionProjector = sceneObject("projector", "resolution-projector", { x: 0, y: 2, z: -12 });
  resolutionProjector.optics = { throwRatio: 1.5, fieldOfView: 40, lookDistance: 12 };
  const resolutionSurface = sceneObject("surface", "resolution-surface", { x: 0, y: 0, z: 0 });
  resolutionSurface.geometry = { width: 2, height: 4 };
  resolutionProjector.targetSurfacePluginId = resolutionSurface.pluginId;
  projectorResolutionHarness.state.objects = [resolutionProjector, resolutionSurface];
  projectorResolutionHarness.state.sync.objects = { [resolutionProjector.pluginId]: { designerId: "resolution-projector-uid", path: "objects/projector/resolution.apx" } };
  const projectorResolutionUpdates = [];
  projectorResolutionHarness.__context.disguiseSceneAdapter = { inspectScene() {}, createObject() {}, async updateObject(id, changed) { projectorResolutionUpdates.push({ id, changed: JSON.parse(JSON.stringify(changed)) }); return { readback: { transform: resolutionProjector.transform, lookAt: resolutionProjector.lookAt, media: changed.media, optics: resolutionProjector.optics, projectorRoll: resolutionProjector.projectorRoll } }; }, liveSetProjectorProjection() { return true; } };
  projectorResolutionHarness.setPath(resolutionProjector, "media.resolutionX", 1080);
  projectorResolutionHarness.setPath(resolutionProjector, "media.resolutionY", 1920);
  assert.equal(resolutionProjector.optics.throwRatio, 3, "Portrait projector resolution must recalculate bound throw ratio locally");
  await projectorResolutionHarness.commitFieldChange(resolutionProjector, "media.resolutionX");
  assert.deepEqual(JSON.parse(JSON.stringify(projectorResolutionUpdates)), [{ id: "resolution-projector-uid", changed: { media: { resolutionX: 1080, resolutionY: 1920 } } }], "Projector resolution must use one direct media update, not the Position/Look At queue");
  assert.throws(() => projectorResolutionHarness.validateReadback(projectorResolutionHarness.objectPayload(resolutionProjector), { readback: { transform: resolutionProjector.transform, lookAt: resolutionProjector.lookAt, media: { resolutionX: 1920, resolutionY: 1080 } } }), /media\.resolutionX/, "Projector resolution must participate in readback validation");
  const bindingHarness = createHarness(); const bindingSurface = sceneObject("surface", "binding-surface"); const bindingProjector = sceneObject("projector", "binding-projector"); bindingProjector.targetSurfacePluginId = bindingSurface.pluginId; bindingHarness.state.objects = [bindingSurface, bindingProjector]; bindingHarness.state.sync.objects = { "binding-surface": { designerId: "binding-surface-uid", path: "objects/screen2/binding.apx" }, "binding-projector": { designerId: "binding-projector-uid", path: "objects/projector/binding.apx" } }; const bindingWrites = []; bindingHarness.__context.disguiseSceneAdapter = { inspectScene() {}, createObject() {}, async updateObject(id, changed) { bindingWrites.push({ id, changed }); return {}; }, liveSetProjectorProjection() { return true; } }; await bindingHarness.commitProjectorBinding(bindingProjector); assert.deepEqual(JSON.parse(JSON.stringify(bindingWrites)), [{ id: "binding-projector-uid", changed: { targetSurface: { pluginId: "binding-surface", designerId: "binding-surface-uid", path: "objects/screen2/binding.apx", name: "surface test" } } }]);
  const pendingSurfaceHarness = createHarness(); const pendingSurface = sceneObject("surface", "pending-surface"); const pendingProjector = sceneObject("projector", "pending-projector"); pendingProjector.targetSurfacePluginId = pendingSurface.pluginId; pendingSurfaceHarness.state.objects = [pendingSurface, pendingProjector]; pendingSurfaceHarness.state.sync.objects = { "pending-projector": { designerId: "pending-projector-uid", path: "objects/projector/pending.apx" } }; const pendingCalls = []; pendingSurfaceHarness.__context.disguiseSceneAdapter = { inspectScene() {}, async createObject(payload) { pendingCalls.push({ action: "create", pluginId: payload.pluginId }); return { designerId: "pending-surface-uid", path: "objects/screen2/pending.apx", ownedPaths: ["objects/screen2/pending.apx", "objects/directprojection/pending.apx"], readback: { transform: payload.transform, geometry: payload.geometry } }; }, async updateObject(id, changed) { pendingCalls.push({ action: "update", id, targetSurface: changed.targetSurface }); return {}; }, liveSetProjectorProjection() { return true; } }; await pendingSurfaceHarness.commitProjectorBinding(pendingProjector); assert.deepEqual(JSON.parse(JSON.stringify(pendingCalls)), [{ action: "create", pluginId: "pending-surface" }, { action: "update", id: "pending-projector-uid", targetSurface: { pluginId: "pending-surface", designerId: "pending-surface-uid", path: "objects/screen2/pending.apx", name: "surface test" } }]);
  const orderedCreateHarness = createHarness(); const orderedSurface = sceneObject("surface", "ordered-surface"); const orderedProjector = sceneObject("projector", "ordered-projector"); orderedProjector.targetSurfacePluginId = orderedSurface.pluginId; orderedProjector.optics = { throwRatio: 2, fieldOfView: 30, lookDistance: 5 }; orderedCreateHarness.state.objects = [orderedSurface, orderedProjector]; const orderedCreates = []; orderedCreateHarness.__context.disguiseSceneAdapter = { inspectScene() {}, updateObject() {}, async createObject(payload) { orderedCreates.push({ pluginId: payload.pluginId, targetSurface: payload.targetSurface }); if (payload.type === "surface") return { designerId: "ordered-surface-uid", path: "objects/screen2/ordered.apx", ownedPaths: ["objects/screen2/ordered.apx", "objects/directprojection/ordered.apx"], readback: { transform: payload.transform, geometry: payload.geometry } }; return { designerId: "ordered-projector-uid", path: "objects/projector/ordered.apx", ownedPaths: ["objects/projector/ordered.apx", "objects/projectorconfig/ordered.apx"], readback: { transform: payload.transform, lookAt: payload.lookAt, optics: payload.optics } }; } }; await orderedCreateHarness.createDesignerObject(orderedProjector); assert.deepEqual(JSON.parse(JSON.stringify(orderedCreates)), [{ pluginId: "ordered-surface" }, { pluginId: "ordered-projector", targetSurface: { pluginId: "ordered-surface", designerId: "ordered-surface-uid", path: "objects/screen2/ordered.apx", name: "surface test" } }]);
  const syncOrderHarness = createHarness(); const syncSurface = sceneObject("surface", "sync-surface"); const syncProjector = sceneObject("projector", "sync-projector"); syncProjector.targetSurfacePluginId = syncSurface.pluginId; syncProjector.optics = { throwRatio: 2, fieldOfView: 30, lookDistance: 5 }; syncOrderHarness.state.objects = [syncProjector, syncSurface]; const syncCreates = []; const syncAdapter = { inspectScene() {}, updateObject() {}, async createObject(payload) { syncCreates.push({ pluginId: payload.pluginId, targetSurface: payload.targetSurface }); if (payload.type === "surface") return { designerId: "sync-surface-uid", path: "objects/screen2/sync.apx", ownedPaths: ["objects/screen2/sync.apx", "objects/directprojection/sync.apx"], readback: { transform: payload.transform, geometry: payload.geometry } }; return { designerId: "sync-projector-uid", path: "objects/projector/sync.apx", ownedPaths: ["objects/projector/sync.apx", "objects/projectorconfig/sync.apx"], readback: { transform: payload.transform, lookAt: payload.lookAt, optics: payload.optics } }; } }; const syncDiff = await syncOrderHarness.makeDiff({ ...syncAdapter, inspectScene: async () => ({ objects: [] }) }); await syncOrderHarness.syncToDesigner(syncDiff); assert.deepEqual(JSON.parse(JSON.stringify(syncCreates)), [{ pluginId: "sync-surface" }, { pluginId: "sync-projector", targetSurface: { pluginId: "sync-surface", designerId: "sync-surface-uid", path: "objects/screen2/sync.apx", name: "surface test" } }]);
  const focusHarness = createHarness(); focusHarness.__context.disguiseSceneAdapter = { inspectScene() {}, updateObject() {}, async createObject(payload) { await new Promise(resolve => setTimeout(resolve, 0)); const result = resultFor(payload, "focus-uid"); result.path = "objects/ledscreen/focus.apx"; result.ownedPaths = [result.path, "objects/directprojection/focus (direct).apx"]; return result; } }; const focusScreen = focusHarness.addObjectAt("screen", 0, 0, true); await new Promise(resolve => setTimeout(resolve, 10)); assert.equal(focusHarness.__context.document.activeElement?.dataset?.field, "geometry.width"); assert.ok(focusHarness.__context.document.querySelectorAll("#active-object-strip input[data-field]").includes(focusHarness.__context.document.activeElement)); assert.equal(focusHarness.state.objects.find(object => object.pluginId === focusScreen.pluginId)?.id, focusScreen.id);
  const liveFocusHarness = createHarness();
  const liveFocusScreen = liveFocusHarness.addObjectAt("screen", 0, 0, true);
  await new Promise(resolve => setTimeout(resolve, 10));
  const resolutionXInput = liveFocusHarness.__context.document.querySelectorAll("#active-object-strip input[data-field]").find(input => input.dataset.field === "media.resolutionX");
  const resolutionYInput = liveFocusHarness.__context.document.querySelectorAll("#active-object-strip input[data-field]").find(input => input.dataset.field === "media.resolutionY");
  resolutionXInput.focus();
  let resolveLiveInspection;
  const liveFocusImport = liveFocusHarness.importDesignerScene({ inspectScene: () => new Promise(resolve => { resolveLiveInspection = resolve; }) }, { preserveLocal: true });
  resolutionYInput.focus();
  resolveLiveInspection({ objects: [{ id: "live-focus-uid", pluginId: liveFocusScreen.pluginId, type: "screen", path: "objects/ledscreen/live focus.apx", description: liveFocusScreen.name, transform: liveFocusScreen.transform, geometry: liveFocusScreen.geometry, media: liveFocusScreen.media }], floorY: 0, stageFootprint: { width: 20, depth: 12 } });
  await liveFocusImport;
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(liveFocusHarness.__context.document.activeElement?.dataset?.field, "media.resolutionY", "Async LIVE refresh must restore the field active when its response is applied");
  const actionCreateHarness = createHarness(); const actionSource = actionCreateHarness.newObject("screen"); actionCreateHarness.state.objects = [actionSource]; actionCreateHarness.selectObject(actionSource); let actionCreateCalls = 0; actionCreateHarness.__context.disguiseSceneAdapter = { inspectScene() {}, updateObject() {}, async createObject(payload) { actionCreateCalls += 1; const result = resultFor(payload, `action-${actionCreateCalls}`); result.path = `objects/ledscreen/action-${actionCreateCalls}.apx`; result.ownedPaths = [result.path, `objects/directprojection/action-${actionCreateCalls}.apx`]; return result; } }; actionCreateHarness.duplicateObject(actionSource.id); await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(actionCreateCalls, 1); actionCreateHarness.duplicateObject(actionSource.id, "x"); await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(actionCreateCalls, 2); actionCreateHarness.selectObject(actionSource); assert.equal(actionCreateHarness.copySelectedObjects(), true); assert.equal(actionCreateHarness.pasteCopiedObjects(), true); await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(actionCreateCalls, 3);
  const createFailureHarness = createHarness(); const failedScreen = sceneObject("screen", "failed-screen"); createFailureHarness.state.objects = [failedScreen]; let failedCreateCalls = 0; createFailureHarness.__context.disguiseSceneAdapter = { inspectScene() {}, updateObject() {}, async createObject() { failedCreateCalls += 1; throw new Error("Designer refused create"); } }; await createFailureHarness.createDesignerObject(failedScreen); assert.equal(createFailureHarness.state.sync.objects[failedScreen.pluginId], undefined); await createFailureHarness.createDesignerObject(failedScreen); assert.equal(failedCreateCalls, 2, "A transport/remote failure before identity must remain retryable"); assert.equal("errors" in createFailureHarness.state.sync, false); assert.ok(createFailureHarness.plannerLogEntries.some(entry => entry.level === "error" && entry.objectName === failedScreen.name && /Designer refused create/.test(entry.message)));
  const renameHarness = createHarness(); const renamedScreen = sceneObject("screen", "rename-screen"); renameHarness.state.objects = [renamedScreen]; renameHarness.state.sync.objects = { "rename-screen": { designerId: "rename-uid", path: "objects/ledscreen/screen test.apx", owned: true, ownedPaths: ["objects/ledscreen/screen test.apx"] } }; renameHarness.__context.disguiseSceneAdapter = { inspectScene() {}, createObject() {}, async updateObject() { throw new Error("Resource name already exists in Designer Resource list"); } }; await renameHarness.commitObjectName(renamedScreen, { value: "Occupied" }); assert.equal(renamedScreen.name, "screen test"); assert.equal("errors" in renameHarness.state.sync, false); assert.ok(renameHarness.plannerLogEntries.some(entry => entry.level === "error" && entry.objectName === renamedScreen.name && /Resource name already exists in Designer Resource list/.test(entry.message)));
  const placementHarness = createHarness(); let projectorCreateCalls = 0; placementHarness.__context.disguiseSceneAdapter = { inspectScene() {}, updateObject() {}, async createObject(payload) { projectorCreateCalls += 1; const result = resultFor(payload, "projector-uid"); result.path = "objects/projector/projector test.apx"; result.ownedPaths = [result.path, "objects/projectorconfig/projector test_config0.apx"]; return result; } }; const placedProjector = placementHarness.addObjectAt("projector", 1, 2); await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(projectorCreateCalls, 0); assert.equal(placementHarness.projectorPlacement().objectId, placedProjector.id); assert.equal(placementHarness.pendingFocusPath(), null); placementHarness.updateProjectorTargetPlacement({ x: 4, z: -3 }); assert.deepEqual(JSON.parse(JSON.stringify(placedProjector.lookAt)), { x: 4, y: 0, z: -3 }); placementHarness.commitProjectorTargetPlacement({ x: 5, z: -4 }); await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(projectorCreateCalls, 1); assert.equal(placementHarness.projectorPlacement(), null); assert.deepEqual(JSON.parse(JSON.stringify(placedProjector.lookAt)), { x: 5, y: 0, z: -4 }); assert.equal(placementHarness.__context.document.activeElement?.dataset?.field, "transform.position.y");
  const cancelledPlacementHarness = createHarness(); cancelledPlacementHarness.addObjectAt("projector", 1, 2); cancelledPlacementHarness.cancelProjectorTargetPlacement(); assert.equal(cancelledPlacementHarness.projectorPlacement(), null);
  const ownershipHarness = createHarness(); ownershipHarness.state.sync.objects = { "owned-camera": { pluginId: "owned-camera", designerId: "camera-uid", path: "objects/camera/camera 2.apx", owned: true, ownedPaths: ["objects/camera/camera 2.apx", "objects/camera/camera 2 (perspective).apx", "objects/perspectiveprojectionobject/camera 2 (perspective).apx"] } }; ownershipHarness.state.objects = [sceneObject("camera", "owned-camera")]; await ownershipHarness.importDesignerScene({ inspectScene: async () => ({ objects: [{ id: "camera-uid", type: "camera", path: "objects/camera/camera 2.apx", description: "Camera 2", transform: { position: { x: 1, y: 1.5, z: 2 }, rotation: { x: 0, y: 0, z: 0 } } }], floorY: 0 }) }, { preserveLocal: true }); assert.equal(ownershipHarness.state.sync.objects["owned-camera"].owned, true);
  const incompleteOwnershipHarness = createHarness(); incompleteOwnershipHarness.state.sync.objects = { "legacy-camera": { pluginId: "legacy-camera", designerId: "legacy-uid", path: "objects/camera/legacy.apx", owned: true } }; incompleteOwnershipHarness.state.objects = [sceneObject("camera", "legacy-camera")]; await incompleteOwnershipHarness.importDesignerScene({ inspectScene: async () => ({ objects: [{ id: "legacy-uid", type: "camera", path: "objects/camera/legacy.apx", description: "Legacy", transform: { position: { x: 0, y: 1.5, z: 0 }, rotation: { x: 0, y: 0, z: 0 } } }], floorY: 0 }) }); assert.equal(incompleteOwnershipHarness.state.sync.objects["legacy-camera"].owned, false);
  assert.throws(() => core.validatedOwnedPaths({ path: "objects/camera/c.apx" }, "camera"), /ownership metadata/); assert.deepEqual(JSON.parse(JSON.stringify(core.validatedOwnedPaths({ path: "objects/projector/p.apx", ownedPaths: ["objects/projector/p.apx", "objects/projectorconfig/p_config0.apx"] }, "projector"))), ["objects/projector/p.apx", "objects/projectorconfig/p_config0.apx"]);
  assert.deepEqual(JSON.parse(JSON.stringify(core.validatedOwnedPaths({ path: "objects/fixturegroup/dmx light 4.apx", ownedPaths: ["objects/fixturegroup/dmx light 4.apx", "objects/directprojection/dmx light 4_directprojection.apx"] }, "dmxLight"))), ["objects/fixturegroup/dmx light 4.apx", "objects/directprojection/dmx light 4_directprojection.apx"]);
  assert.match(stylesSource, /external-override[^}]*#(?:d64545|e05252|ff[0-6][0-6][0-6])/i);
  assert.deepEqual(JSON.parse(JSON.stringify(core.renamedOwnedPaths({ path: "objects/projector/projector 2.apx", ownedPaths: ["objects/projector/projector 2.apx", "objects/projectorconfig/projector 2_config0.apx"] }, "objects/projector/front.apx"))), ["objects/projector/front.apx", "objects/projectorconfig/projector 2_config0.apx"]);

  const cadenceHarness = createHarness();
  const cadenceSurface = sceneObject("surface", "cadence-surface", { x: 0, y: -1, z: 0 });
  cadenceSurface.geometry = { width: 8, height: 4 };
  const cadenceProjector = sceneObject("projector", "cadence-projector", { x: 0, y: 3, z: -12 });
  cadenceProjector.lookAt = { x: 0, y: 1, z: 0 };
  cadenceProjector.optics = { throwRatio: 1.5, fieldOfView: 40, lookDistance: 1 };
  cadenceProjector.targetSurfacePluginId = cadenceSurface.pluginId;
  cadenceHarness.state.objects = [cadenceSurface, cadenceProjector];
  cadenceHarness.state.sync.objects = { "cadence-projector": { designerId: "cadence-uid", path: "objects/projector/cadence.apx" } };
  const cadenceWrites = [];
  const cadenceRotations = [];
  cadenceHarness.__context.disguiseSceneAdapter = {
    inspectScene() {}, createObject() {}, updateObject() {},
    liveSetProjectorProjection(pluginId, position, lookAt, throwRatio) {
      cadenceWrites.push({ at: Date.now(), pluginId, position: JSON.parse(JSON.stringify(position)), lookAt: JSON.parse(JSON.stringify(lookAt)), throwRatio });
      return true;
    },
    updateProjectorRotationZ(id, value) { cadenceRotations.push({ id, value }); return Promise.resolve({ readback: { projectorRoll: value } }); }
  };
  cadenceHarness.queueProjectorProjection(cadenceProjector, "cadence-test");
  await new Promise(resolve => setTimeout(resolve, 10));
  cadenceProjector.transform.position.x = 1; cadenceHarness.queueProjectorProjection(cadenceProjector, "cadence-test");
  await new Promise(resolve => setTimeout(resolve, 10));
  cadenceProjector.transform.position.x = 2; cadenceHarness.queueProjectorProjection(cadenceProjector, "cadence-test");
  await new Promise(resolve => setTimeout(resolve, 10));
  cadenceProjector.transform.position.x = 3; cadenceHarness.queueProjectorProjection(cadenceProjector, "cadence-test");
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(cadenceWrites.length, 2, "rapid projector queues must coalesce into one cadence write");
  assert.ok(cadenceWrites[1].at - cadenceWrites[0].at >= 35, "cadence writes must be spaced approximately 40 ms apart");
  assert.deepEqual(cadenceWrites[1].position, { x: 3, y: 3, z: -12 });
  await new Promise(resolve => setTimeout(resolve, 470));
  assert.equal(cadenceWrites.length, 3, "the final fresh value must be resent after movement stops");
  assert.deepEqual(cadenceWrites[2].position, { x: 3, y: 3, z: -12 });
  assert.deepEqual(cadenceRotations, [{ id: "cadence-uid", value: 0 }]);
  cadenceHarness.cancelProjectorWork(cadenceProjector.pluginId);

  const externalHarness = createHarness();
  const externalSurface = sceneObject("surface", "external-surface", { x: 0, y: -1, z: 0 });
  externalSurface.geometry = { width: 8, height: 4 };
  const externalProjector = sceneObject("projector", "external-projector", { x: 0, y: 3, z: -8 });
  externalProjector.lookAt = { x: 0, y: 1, z: 0 };
  externalProjector.optics = { throwRatio: 1.5, fieldOfView: 40, lookDistance: 8 };
  externalHarness.state.objects = [externalSurface, externalProjector];
  const externalWrites = [];
  externalHarness.__context.disguiseSceneAdapter = {
    inspectScene() {}, createObject() {}, updateObject() {},
    liveSetProjectorProjection(pluginId, position, lookAt, throwRatio) {
      externalWrites.push({ pluginId, position: JSON.parse(JSON.stringify(position)), lookAt: JSON.parse(JSON.stringify(lookAt)), throwRatio });
      return true;
    }
  };
  externalHarness.applyLiveValue({ pluginId: "external-projector", field: "transform.position", value: { x: 1, y: 3, z: -8 }, initial: true });
  externalHarness.applyLiveValue({ pluginId: "external-projector", field: "lookAt", value: { x: 1, y: 1, z: 0 }, initial: true });
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.deepEqual(externalWrites, [], "initial Designer values must not write back");
  externalHarness.applyLiveValue({ pluginId: "external-projector", field: "transform.position", value: { x: 2, y: 3, z: -8 } });
  externalHarness.applyLiveValue({ pluginId: "external-projector", field: "lookAt", value: { x: 2, y: 1, z: 0 } });
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(externalWrites.length, 1, "non-initial Position and Look At must queue current projection values");
  assert.deepEqual(externalWrites[0].position, { x: 2, y: 3, z: -8 });
  assert.deepEqual(externalWrites[0].lookAt, { x: 2, y: 1, z: 0 });
  externalHarness.applyLiveValue({ pluginId: "external-projector", field: "optics.lookDistance", value: 9 });
  externalHarness.applyLiveValue({ pluginId: "external-projector", field: "optics.fieldOfView", value: 28 });
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(externalWrites.length, 1, "Look Distance and FOV readbacks must never queue writes");
  externalProjector.targetSurfacePluginId = externalSurface.pluginId;
  externalHarness.applyLiveValue({ pluginId: "external-surface", field: "geometry.width", value: 10 });
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(externalWrites.length, 2, "Surface geometry must queue each bound projector");
  assert.equal(externalWrites[1].throwRatio, 0.849);
  externalHarness.cancelProjectorWork(externalProjector.pluginId);

  assert.doesNotMatch(appSource, /makeMediaModeControl|mediaMode/, "LED data must not render a mode selector");
  const ledHarness = createHarness();
  const led = ledHarness.newObject("screen");
  led.geometry = { width: 4, height: 2 };
  led.media = { resolutionX: 1920, resolutionY: 1200, pixelsPerInch: 10, pixelPitchMm: 2.54 };
  const ledData = () => ledHarness.fieldSections(led).find(section => section.title === "LED data");
  assert.deepEqual(JSON.parse(JSON.stringify(ledData().fields.map(field => field.slice(0, 5)))), [["Resolution X", "media.resolutionX", 1920, 1, "px"], ["Resolution Y", "media.resolutionY", 1200, 1, "px"], ["Pixel density", "media.pixelsPerInch", "FAIL", .1, "ppi"], ["Pixel size", "media.pixelPitchMm", "FAIL", .001, "mm"]]);
  assert.equal(ledData().fields[2][5].invalid, true);
  assert.equal(ledData().fields[3][5].invalid, true);
  ledHarness.setPath(led, "media.pixelsPerInch", 10);
  assert.equal(led.media.resolutionX, 1575);
  assert.equal(led.media.resolutionY, 787);
  assert.equal(ledData().fields[2][2], 9.998);
  assert.equal(ledData().fields[3][2], 2.54);
  ledHarness.setPath(led, "media.pixelPitchMm", 2.54);
  assert.equal(led.media.pixelsPerInch, 10);
  assert.equal(led.media.resolutionX, 1575);
  assert.equal(led.media.resolutionY, 787);
  ledHarness.setPath(led, "geometry.width", 8);
  assert.equal(led.media.resolutionX, 1575, "physical size changes must not rewrite manual resolution");
  assert.equal(led.media.resolutionY, 787);
  assert.equal(ledData().fields[2][2], "FAIL");
  ledHarness.setPath(led, "media.resolutionX", 1920);
  assert.equal(led.media.resolutionY, 787, "manual Resolution X must not rewrite Resolution Y");
  assert.equal(ledData().fields[2][2], "FAIL", "incompatible manual resolution must be reported, not corrected");
  assert.equal(ledData().fields[3][2], "FAIL");
  ledHarness.setPath(led, "media.pixelsPerInch", 20);
  assert.equal(led.media.resolutionX, 6299);
  assert.equal(led.media.resolutionY, 1575);
  assert.notEqual(ledData().fields[2][2], "FAIL");
  const projectorPixelHarness = createHarness();
  const projectorSurface = projectorPixelHarness.newObject("surface");
  projectorSurface.geometry = { width: 4, height: 2 };
  const projectorPixels = projectorPixelHarness.newObject("projector");
  projectorPixels.media = { resolutionX: 1920, resolutionY: 1080 };
  projectorPixels.transform.position = { x: 0, y: 3, z: -12 };
  projectorPixels.lookAt = { x: 0, y: 1, z: 0 };
  projectorPixels.targetSurfacePluginId = projectorSurface.pluginId;
  projectorPixelHarness.state.objects = [projectorSurface, projectorPixels];
  assert.equal(projectorPixelHarness.projectorProjectedPixelSizeMm(projectorPixels), 2.083);
  projectorSurface.geometry = { width: 8, height: 4 };
  assert.equal(projectorPixelHarness.projectorProjectedPixelSizeMm(projectorPixels), 4.167);
  projectorPixels.media.resolutionX = 3840;
  projectorPixels.media.resolutionY = 2160;
  assert.equal(projectorPixelHarness.projectorProjectedPixelSizeMm(projectorPixels), 2.083);
  const portraitSurface = projectorPixelHarness.newObject("surface");
  portraitSurface.pluginId = "portrait-pixel-surface";
  portraitSurface.geometry = { width: 2, height: 4 };
  projectorPixels.targetSurfacePluginId = portraitSurface.pluginId;
  projectorPixelHarness.state.objects.push(portraitSurface);
  projectorPixels.media.resolutionX = 1920;
  projectorPixels.media.resolutionY = 1080;
  const opticsFields = projectorPixelHarness.fieldSections(projectorPixels).find(section => section.title === "Optics").fields;
  const projectedPixelField = opticsFields.find(field => field[1] === "derived.projectedPixelSizeMm");
  assert.equal(projectedPixelField[0], "Projected pixel size");
  assert.equal(projectedPixelField[4], "mm");
  assert.equal(projectedPixelField[5].readOnly, true);
  assert.equal(projectorPixelHarness.projectorProjectedPixelSizeMm(projectorPixels), 2.083);
  assert.equal(projectorPixelHarness.formatValue(2.083, .001), "2,083");
  delete projectorPixels.targetSurfacePluginId;
  projectorPixels.transform.position = { x: 0, y: 0, z: -12 };
  projectorPixels.lookAt = { x: 0, y: 0, z: 0 };
  projectorPixels.optics.throwRatio = 1.5;
  assert.equal(projectorPixelHarness.projectorProjectedPixelSizeMm(projectorPixels), 4.167, "unbound projected width must use distance / throw ratio");
  projectorPixels.transform.position.z = -6;
  assert.equal(projectorPixelHarness.projectorProjectedPixelSizeMm(projectorPixels), 2.083);
  projectorPixels.optics.throwRatio = 3;
  assert.equal(projectorPixelHarness.projectorProjectedPixelSizeMm(projectorPixels), 1.042);

  console.log("stage-planner v11 tests: ok");
})().catch(error => { console.error(error); process.exitCode = 1; });
