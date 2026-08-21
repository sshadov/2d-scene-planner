const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const adapterSource = fs.readFileSync(path.join(root, "scene-planner-prototype", "designer-adapter.js"), "utf8");
const context = { console, location: { hostname: "127.0.0.1", port: "", search: "", origin: "http://127.0.0.1" }, crypto: { randomUUID: () => "test-id" }, AbortController, setTimeout, clearTimeout };
context.window = context; context.globalThis = context; vm.createContext(context); vm.runInContext(adapterSource, context, { filename: "designer-adapter.js" });
const adapter = context.disguiseSceneAdapter;
const scripts = adapter.debugScripts;

const update = scripts.updateScript("uid-1", { name: "surface renamed" }, "objects/screen2/old.apx", "surface");
assert.match(update, /obj\.rename\(Path\(desired_path\)\)/); assert.match(update, /markDirty\(obj\)/); assert.match(update, /obj\.save\(\)/); assert.doesNotMatch(update, /assign\("path", desired_path\)/);
assert.ok(update.includes("safe_name = re.sub(r'[\\\\/:*?\"<>|]'"), "rename script must compile when the name sanitizer contains a double quote");
const create = scripts.createScript({ pluginId: "dmx-light-2", type: "dmxLight", name: "DMX Light 2", transform: { position: { x: 1, y: 5, z: 2 }, rotation: { x: 0, y: 0, z: 0 } } });
assert.match(create, /resourceManager\.loadOrCreate\(Path\(object_path\), expected_type\)/); assert.match(create, /append_typed\(obj, collection\)/); assert.match(create, /assert_typed_membership/); assert.match(create, /"ownedPaths": owned_paths/); assert.match(create, /"name": resolved_name/);
for (const type of ["screen", "dmxScreen", "surface"]) {
  const resolutionCreate = scripts.createScript({ pluginId: `${type}-resolution`, type, name: `${type} resolution`, transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } }, geometry: { width: 4, height: 2 }, media: { resolutionX: 1920, resolutionY: 1080 } });
  assert.match(resolutionCreate, /Vec2\(int\(media\["resolutionX"\]\), int\(media\["resolutionY"\]\)\)/);
  assert.match(resolutionCreate, /"media": \{"resolutionX": int\(resolution.x\), "resolutionY": int\(resolution.y\)\}/);
  const resolutionUpdate = scripts.updateScript(`${type}-uid`, { media: { resolutionX: 1280, resolutionY: 720 } }, `objects/${type}/${type}.apx`, type);
  assert.match(resolutionUpdate, /assign\("resolution", Vec2\(int\(media_change/);
}
const cameraCreate = scripts.createScript({ pluginId: "camera-2", type: "camera", name: "Camera 2", transform: { position: { x: 1, y: 1.5, z: 2 }, rotation: { x: 0, y: 180, z: 0 } } });
assert.match(cameraCreate, /PerspectiveProjectionObject/); assert.match(cameraCreate, /PerspectiveProjection/); assert.match(cameraCreate, /collection\.remove\(attached\)/); assert.match(cameraCreate, /created_resource\.saveOnDelete\(\)/); assert.ok(cameraCreate.indexOf("if errors: return errors") < cameraCreate.indexOf("for path in reversed(rollback_paths)"));
const rename = scripts.updateScript("uid-1", { name: "DMX Light 2" }, "objects/dmxlight/dmx light 1.apx", "dmxLight");
assert.match(rename, /Resource name already exists in Designer Resource list/); assert.match(rename, /resourceManager\.package\.findAllBeginsWith/);
const importedDelete = scripts.deleteScript([{ id: "imported-uid", path: "objects/camera/imported.apx", owned: false, removeResource: true }]);
const managedDelete = scripts.deleteManagedScript([{ id: "managed-uid", path: "objects/camera/managed.apx", owned: true, ownedPaths: [], removeResource: true }]);
for (const generated of [importedDelete, managedDelete]) { assert.match(generated, /getattr\(stage, collection_name\)\.remove\(candidate\)/); assert.match(generated, /stage\.save\(\)/); assert.match(generated, /stage_contains/); assert.match(generated, /resourceManager\.remove\(Path\(candidate_path\)\)/); assert.ok(generated.indexOf("stage.save()") < generated.indexOf("resourceManager.remove(Path(candidate_path))")); assert.doesNotMatch(generated, /findResourcesPointingToThis/); }
assert.match(importedDelete, /if not bool\(item\.get\("owned"\)\): return \[\]/); assert.match(managedDelete, /sole_target/); assert.match(managedDelete, /type or owner identity mismatch/);
assert.match(adapterSource, /operationLogEntries/); assert.match(adapterSource, /operationLog\("request"/); assert.match(adapterSource, /operationLog\("response"/); assert.match(adapterSource, /operationLog\("error"/); assert.match(adapterSource, /activeTransportStatus/); assert.match(adapterSource, /resourceManager\.saveAll\(\)/);
const inspection = scripts.inspectScript(); assert.match(inspection, /warnings = \[\]/); assert.match(inspection, /errors = \[\]/); assert.match(inspection, /"complete": len\(errors\) == 0/); assert.match(inspection, /ignored Designer helper/); assert.match(inspection, /errors\.append\(\{"collection": collection_name/);

async function verifyTransportAndSaveAdapter() {
  for (const [playmode, running] of [["stop", false], ["play", true], ["playsection", true], ["loop", true]]) {
    let request;
    context.fetch = async (url, options) => { request = { url, options }; return { ok: true, status: 200, json: async () => ({ status: { code: 0, message: "" }, result: [{ uid: "transport-1", name: "Transport 1", playmode, engaged: true }] }), text: async () => "" }; };
    assert.deepEqual(JSON.parse(JSON.stringify(await adapter.activeTransportStatus())), { known: true, running, transports: [playmode] });
    assert.match(request.url, /\/api\/session\/transport\/activetransport$/);
    assert.equal(request.options?.method, undefined, "transport safety check must remain a read-only GET");
  }
  context.console = { error() {}, info() {} }; context.fetch = async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => "" }); assert.deepEqual(JSON.parse(JSON.stringify(await adapter.activeTransportStatus())), { known: false, running: false, transports: [] }); context.fetch = async () => { throw new Error("transport unavailable"); }; assert.deepEqual(JSON.parse(JSON.stringify(await adapter.activeTransportStatus())), { known: false, running: false, transports: [] });
  let saveRequest; context.fetch = async (url, options) => { saveRequest = { url, options }; return { ok: true, status: 200, text: async () => JSON.stringify({ returnValue: JSON.stringify({ saved: 3 }) }) }; }; assert.deepEqual(JSON.parse(JSON.stringify(await adapter.saveAllResources())), { saved: 3 }); assert.match(saveRequest.url, /\/api\/session\/python\/execute$/); assert.match(JSON.parse(saveRequest.options.body).script, /saved = resourceManager\.saveAll\(\)/);
}
verifyTransportAndSaveAdapter().then(() => console.log("lifecycle release contract test: ok")).catch(error => { console.error(error); process.exitCode = 1; });
