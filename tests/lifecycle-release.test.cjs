const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const adapterSource = fs.readFileSync(path.join(root, "scene-planner-prototype", "designer-adapter.js"), "utf8");
const context = {
  console,
  location: { hostname: "127.0.0.1", port: "", search: "", origin: "http://127.0.0.1" },
  crypto: { randomUUID: () => "test-id" },
  AbortController,
  setTimeout,
  clearTimeout
};
context.window = context;
context.globalThis = context;
vm.createContext(context);
vm.runInContext(adapterSource, context, { filename: "designer-adapter.js" });
const scripts = context.disguiseSceneAdapter.debugScripts;

const update = scripts.updateScript("uid-1", { name: "surface renamed" }, "objects/screen2/old.apx", "surface");
assert.match(update, /from d3 import Path/);
assert.match(update, /obj\.rename\(Path\(desired_path\)\)/);
assert.doesNotMatch(update, /assign\("path", desired_path\)/);
assert.match(update, /markDirty\(obj\)/);
assert.match(update, /obj\.save\(\)/);

const create = scripts.createScript({ pluginId: "dmx-light-2", type: "dmxLight", name: "DMX Light 2", transform: { position: { x: 1, y: 5, z: 2 }, rotation: { x: 0, y: 0, z: 0 } } });
assert.match(create, /resourceManager\.exists\(Path\(path\)\)/);
assert.match(create, /resourceManager\.package\.findAllBeginsWith/);
assert.match(create, /while resource_path_taken\(candidate\)/);
assert.match(create, /expected_class_name/);
assert.match(create, /resourceManager\.loadOrCreate\(Path\(object_path\), expected_type\)/);
assert.match(create, /append_typed\(obj, collection\)/);
assert.match(create, /"name": resolved_name/);

const cameraCreate = scripts.createScript({ pluginId: "camera-2", type: "camera", name: "Camera 2", transform: { position: { x: 1, y: 1.5, z: 2 }, rotation: { x: 0, y: 180, z: 0 } } });
assert.match(cameraCreate, /PerspectiveProjectionObject/);
assert.match(cameraCreate, /PerspectiveProjection/);
assert.match(cameraCreate, /projection_object\.projection = projection/);
assert.match(cameraCreate, /obj\.add\(projection_object\)/);
assert.match(cameraCreate, /isBad/);
assert.match(cameraCreate, /bool\(resource\.isBad\)/);
assert.match(cameraCreate, /collection\.remove\(attached\)/);
assert.doesNotMatch(cameraCreate, /attached\.remove\(\)/);
assert.match(cameraCreate, /attached_in_collection = False/);
assert.match(cameraCreate, /if attached_in_collection:/);
assert.ok(cameraCreate.indexOf("if attached_in_collection:") < cameraCreate.indexOf("collection.remove(attached)"));
assert.match(cameraCreate, /rollback/);
assert.match(cameraCreate, /created_resource\.saveOnDelete\(\)/);
assert.doesNotMatch(cameraCreate, /from create_error/);
assert.match(cameraCreate, /if errors: return errors/);
assert.ok(cameraCreate.indexOf("if errors: return errors") < cameraCreate.indexOf("for path in reversed(rollback_paths)"));
assert.ok(cameraCreate.indexOf("created_resource.saveOnDelete()") < cameraCreate.indexOf("resourceManager.remove(path)"));
const cameraBody = cameraCreate.slice(cameraCreate.indexOf("from d3 import Camera"));
assert.ok(cameraBody.indexOf("obj.path = Path(object_path)") < cameraBody.indexOf("created_paths.append(object_path)"));
assert.ok(cameraBody.indexOf("created_paths.append(object_path)") < cameraBody.indexOf("projection.path = Path(projection_path)"));
assert.ok(cameraBody.indexOf("created_paths.append(projection_path)") < cameraBody.indexOf("projection_object.path = Path(projection_object_path)"));
assert.match(cameraCreate, /assert_typed_membership\(stage, "cameras", obj\)/);
assert.match(cameraCreate, /projection_path != expected_projection_path/);
assert.match(cameraCreate, /owned_paths = owned_resource_paths\(obj, created_paths\)/);
assert.match(cameraCreate, /"ownedPaths": owned_paths/);

const projectorCreate = scripts.createScript({ pluginId: "projector-2", type: "projector", name: "Projector 2", transform: { position: { x: 1, y: 3, z: 2 }, rotation: { x: 0, y: 0, z: 0 } }, lookAt: { x: 0, y: 1, z: 0 }, optics: { throwRatio: 1.5, lookDistance: 3.1 }, targetSurface: { designerId: "surface-uid", path: "objects/screen2/surface.apx", name: "Surface" }, projectorRoll: 90 });
assert.match(projectorCreate, /ProjectorConfig/);
assert.match(projectorCreate, /obj\.config/);
assert.match(projectorCreate, /isBad/);
assert.match(projectorCreate, /bool\(resource\.isInError\)/);
assert.match(projectorCreate, /rollback/);
assert.match(projectorCreate, /assert_typed_membership\(stage, "projectors", obj\)/);
assert.match(projectorCreate, /owned_paths = owned_resource_paths\(obj, created_paths\)/);
assert.match(projectorCreate, /"ownedPaths": owned_paths/);
assert.match(projectorCreate, /Screen2/);
assert.match(projectorCreate, /obj\.removeScreen\(screen\)/);
assert.match(projectorCreate, /obj\.addScreen\(target_screen\)/);
assert.doesNotMatch(projectorCreate, /obj\.screens\s*=/);
assert.doesNotMatch(projectorCreate, /obj\.configLookDistance\s*=/);
assert.match(projectorCreate, /obj\.configRotation = Vec\(current_rotation\.x, current_rotation\.y, float\(payload\.get\("projectorRoll", 0\.0\)\)\)/);
assert.ok(projectorCreate.indexOf("obj.configPosition") < projectorCreate.indexOf("obj.configLookAt"));
assert.ok(projectorCreate.indexOf("obj.configLookAt") < projectorCreate.indexOf("obj.configThrowRatio"));
assert.ok(projectorCreate.indexOf("obj.configThrowRatio") < projectorCreate.indexOf("obj.removeScreen(screen)"));
assert.ok(projectorCreate.indexOf("obj.addScreen(target_screen)") < projectorCreate.indexOf("obj.configRotation = Vec"));
assert.ok(projectorCreate.indexOf("obj.configRotation = Vec") < projectorCreate.lastIndexOf("obj.save()"));

const projectorUpdate = scripts.updateScript("projector-uid", { transform: { position: { x: 2, y: 3, z: 4 } }, lookAt: { x: 0, y: 1, z: 0 }, optics: { throwRatio: 2.5, lookDistance: 5.2 }, targetSurface: { designerId: "surface-uid", path: "objects/screen2/surface.apx" }, projectorRoll: 90 }, "objects/projector/projector.apx", "projector");
assert.match(projectorUpdate, /obj\.removeScreen\(screen\)/);
assert.match(projectorUpdate, /obj\.addScreen\(target_screen\)/);
assert.doesNotMatch(projectorUpdate, /assign\("configLookDistance"/);
assert.ok(projectorUpdate.indexOf('assign("configThrowRatio"') < projectorUpdate.indexOf("obj.removeScreen(screen)"));
assert.ok(projectorUpdate.indexOf("obj.addScreen(target_screen)") < projectorUpdate.indexOf('assign("configRotation"'));
assert.ok(projectorUpdate.indexOf('assign("configRotation"') < projectorUpdate.lastIndexOf("obj.save()"));

const simpleCreate = scripts.createScript({ pluginId: "screen-2", type: "screen", name: "LED Screen 2", transform: { position: { x: 1, y: 0, z: 2 }, rotation: { x: 0, y: 0, z: 0 } }, geometry: { width: 4, height: 2 } });
assert.match(simpleCreate, /createSimpleDisplay/);
assert.doesNotMatch(simpleCreate, /projection_object/);
assert.match(simpleCreate, /findResourcesPointingToThis\(DirectProjection\)/);
assert.match(simpleCreate, /assert_typed_membership\(stage, "ledScreens", obj\)/);
assert.match(simpleCreate, /return obj, resolved_name, object_path, owned_resource_paths\(obj, created_paths\)/);
assert.match(simpleCreate, /"ownedPaths": owned_paths/);
assert.ok(simpleCreate.indexOf("append_typed(obj, collection)") < simpleCreate.lastIndexOf('assign("rotation", Vec(0.0, yaw, 0.0))'));
assert.ok(simpleCreate.lastIndexOf('assign("rotation", Vec(0.0, yaw, 0.0))') < simpleCreate.lastIndexOf("obj.save()"));

const screenYawUpdate = scripts.updateScript("screen-yaw-uid", { transform: { rotation: { y: 45 } } }, "objects/ledscreen/yaw.apx", "screen");
assert.ok(screenYawUpdate.indexOf('assign("rotation", Vec(0.0, yaw, 0.0))') < screenYawUpdate.lastIndexOf("obj.save()"));
assert.ok(screenYawUpdate.lastIndexOf("obj.save()") < screenYawUpdate.lastIndexOf("stage.save()"));

const rename = scripts.updateScript("uid-1", { name: "DMX Light 2" }, "objects/dmxlight/dmx light 1.apx", "dmxLight");
assert.match(rename, /resourceManager\.exists\(Path\(desired_path\)\)/);
assert.match(rename, /resourceManager\.package\.findAllBeginsWith/);
assert.match(rename, /Resource name already exists in Designer Resource list/);
assert.match(rename, /"name": str\(getattr\(obj, "description", ""\)\)/);

const manualRemove = scripts.deleteManagedScript([{ id: "manual-uid", path: "objects/camera/cam1.apx", owned: false }]);
assert.match(manualRemove, /requested = json\.loads\("\[\]"\)/);

const importedRemove = scripts.deleteScript([{ id: "imported-uid", path: "objects/projector/imported.apx" }]);
assert.match(importedRemove, /candidate_id not in target_ids/);
assert.match(importedRemove, /path not in target_paths/);
assert.match(importedRemove, /target_pairs/);
assert.match(importedRemove, /\(candidate_id, candidate_path\) not in target_pairs/);
assert.match(importedRemove, /owned_resource_paths\(candidate, allowed_paths\)/);
assert.match(importedRemove, /remove_resource/);
assert.ok(importedRemove.indexOf("stage.save()") < importedRemove.indexOf("resourceManager.remove(Path(path))"));

const remove = scripts.deleteManagedScript([{ id: "uid-1", path: "objects/projector/projector-1.apx", owned: true, ownedPaths: ["objects/projector/projector-1.apx", "objects/projectorconfig/projector-1_config0.apx"] }]);
assert.doesNotMatch(remove, /requested = json\.loads\("\[\]"\)/);
assert.doesNotMatch(remove, /candidate\.saveOnDelete\(\)/);
assert.match(remove, /resourceManager\.remove\(Path\(path\)\)/);
assert.match(remove, /path == "objects\/object\/dsg-scene-cube\.apx"/);
assert.match(remove, /pending = \[\]/);
assert.match(remove, /for candidate in collection:/);
assert.doesNotMatch(remove, /list\(collection\)/);
assert.match(remove, /collection\.remove\(candidate\)/);
assert.match(remove, /resourceManager\.load\(Path\(resource_path\), Resource\)/);
assert.match(remove, /target_paths/);
assert.match(remove, /stage\.save\(\)/);
assert.doesNotMatch(remove, /candidate\.remove\(\)/);
assert.ok(remove.indexOf("collection.remove(candidate)") < remove.indexOf("resourceManager.remove(Path(path))"));
assert.match(remove, /DirectProjection/);
assert.match(remove, /findResourcesPointingToThis/);
assert.match(remove, /request_owned_paths/);
assert.match(remove, /dependency_paths = \[path for path in owned_paths/);
assert.ok(remove.indexOf("stage.save()") < remove.indexOf("resourceManager.remove(Path(path))"));
assert.match(remove, /collection\.remove\(candidate\)/);
assert.doesNotMatch(remove, /setattr\(stage, collection_name, \[/);
assert.doesNotMatch(remove, /def set_stage_collection/);
assert.doesNotMatch(remove, /stage\.(ledScreens|dmxScreens|surfaces|dmxLights|cameras|projectors)\s*=/);
assert.match(remove, /removeResource/);
assert.match(remove, /resource_delete_failed = \[\]/);
assert.match(remove, /resource_delete_failed\.append\(candidate_id\)/);
assert.match(remove, /"resourceDeleteFailed": resource_delete_failed/);
assert.doesNotMatch(remove, /remove_resources = any/);
assert.match(remove, /remove_resource = bool\(request_by_id/);
assert.match(remove, /findResourcesPointingToThis\(Resource\)/);
assert.match(remove, /type\(reference\) is DirectProjection/);
assert.match(remove, /unexpected inbound reference/);
assert.match(remove, /resourceManager\.exists\(Path\(path\)\)/);
assert.match(remove, /resource_path_failures/);
assert.match(remove, /if dependency_failed:/);
assert.doesNotMatch(remove, /candidate\.saveOnDelete\(\)/);
assert.match(remove, /stage_contains/);
assert.doesNotMatch(remove, /collection_names \+ \["children"\]/);
assert.ok(remove.indexOf("stage.save()") < remove.indexOf("stage_contains"));
assert.match(remove, /cleanup_phases = \[\]/);
assert.match(remove, /"phase": "stage-detach"/);
assert.match(remove, /"phase": "stage-save"/);
assert.match(remove, /"phase": "stage-readback"/);
assert.match(remove, /"phase": "dependency-inspection", "status": "ok"/);
assert.match(remove, /"phase": "dependency-remove"/);
assert.match(remove, /"phase": "main-resource-remove"/);
assert.match(remove, /verification_failures = \[\]/);
const resourceExistsBlock = remove.slice(remove.indexOf("def resource_exists(path):"), remove.indexOf("deleted = []"));
assert.match(resourceExistsBlock, /exists_result = resourceManager\.exists\(Path\(path\)\)/);
assert.ok(resourceExistsBlock.indexOf("exists_result = resourceManager.exists(Path(path))") < resourceExistsBlock.indexOf("verification_succeeded = True"));
assert.ok(resourceExistsBlock.indexOf("verification_succeeded = True") < resourceExistsBlock.indexOf("if exists_result: return True"));
assert.match(remove, /resourceManager\.exists: /);
assert.match(remove, /package enumeration: /);
assert.match(remove, /cannot verify resource absence/);
assert.match(remove, /"cleanupPhases": cleanup_phases/);
assert.match(adapterSource, /operationLogEntries/);
assert.match(adapterSource, /operationLog\("request"/);
assert.match(adapterSource, /operationLog\("response"/);
assert.match(adapterSource, /operationLog\("error"/);
assert.match(adapterSource, /getOperationLogs/);
assert.match(adapterSource, /action: meta\.action/);
assert.match(adapterSource, /stage_name_taken/);
assert.match(adapterSource, /resolved_name = allocate_name/);
assert.match(adapterSource, /activeTransportStatus/);
assert.match(adapterSource, /saveAllResources/);
assert.match(adapterSource, /\/api\/session\/transport\/activetransport/);
assert.match(adapterSource, /resourceManager\.saveAll\(\)/);
assert.match(adapterSource, /match = re\.match/);
assert.match(adapterSource, /while stage_name_taken\(collection, resolved\) or resource_path_taken/);

function runFixtureGroupDelete({ ownedPaths, directProjectionPaths = [], inspectionError = null }) {
  const cleanup = scripts.deleteManagedScript([{
    id: "fixture-1",
    path: "objects/fixturegroup/light.apx",
    owned: true,
    ownedPaths,
    removeResource: true
  }]);
  const fixtureCase = JSON.stringify({ directProjectionPaths, inspectionError });
  const runner = `
import json
import sys
import types

fixture_case = json.loads(${JSON.stringify(fixtureCase)})

class Path(str):
    pass

class Resource:
    pass

class DirectProjection(Resource):
    def __init__(self, projection_path, screens):
        self.path = projection_path
        self.screens = screens

class FixtureGroup(Resource):
    def __init__(self):
        self.uid = "fixture-1"
        self.path = "objects/fixturegroup/light.apx"
        self.children = []
        self.config = None

    def findResourcesPointingToThis(self, resource_type):
        if fixture_case["inspectionError"]:
            raise RuntimeError(fixture_case["inspectionError"])
        return [DirectProjection(projection_path, [self]) for projection_path in fixture_case["directProjectionPaths"]]

class Stage:
    def __init__(self, fixture):
        self.dmxLights = [fixture]

    def save(self):
        pass

class Package:
    def findAllBeginsWith(self, folder):
        return []

class ResourceManager:
    def __init__(self, fixture):
        self.fixture = fixture
        self.removed = []
        self.package = Package()

    def load(self, resource_path, resource_type):
        if str(resource_path) == self.fixture.path:
            return self.fixture
        raise RuntimeError("unexpected resource load")

    def remove(self, resource_path):
        self.removed.append(str(resource_path))

    def exists(self, resource_path):
        return False

d3 = types.ModuleType("d3")
d3.Path = Path
d3.Resource = Resource
d3.DirectProjection = DirectProjection
sys.modules["d3"] = d3

fixture = FixtureGroup()
state = types.SimpleNamespace(stage=Stage(fixture))
resourceManager = ResourceManager(fixture)

def run():
${cleanup.split("\n").map(line => `    ${line}`).join("\n")}

print(json.dumps({"result": json.loads(run()), "removed": resourceManager.removed}))
`;
  return JSON.parse(execFileSync("python", ["-c", runner], { encoding: "utf8" }));
}

function assertFixtureGroupPhysicalCleanupBlocked(outcome, failureText) {
  assert.deepEqual(outcome.result.deleted, ["fixture-1"]);
  assert.deepEqual(outcome.result.resourceDeleteFailed, ["fixture-1"]);
  assert.deepEqual(outcome.removed, []);
  assert.ok(outcome.result.cleanupPhases.some(phase => phase.phase === "stage-detach" && phase.status === "ok"));
  assert.ok(outcome.result.cleanupPhases.some(phase => phase.phase === "dependency-inspection" && phase.status === "failed" && phase.error.includes(failureText)));
}

assertFixtureGroupPhysicalCleanupBlocked(runFixtureGroupDelete({
  ownedPaths: [],
  directProjectionPaths: ["objects/directprojection/light-direct.apx"]
}), "ownership metadata");

assertFixtureGroupPhysicalCleanupBlocked(runFixtureGroupDelete({
  ownedPaths: ["objects/fixturegroup/light.apx", "objects/directprojection/persisted.apx"],
  directProjectionPaths: ["objects/directprojection/extra.apx"]
}), "outside ownership");

assertFixtureGroupPhysicalCleanupBlocked(runFixtureGroupDelete({
  ownedPaths: ["objects/fixturegroup/light.apx", "objects/directprojection/persisted.apx"],
  directProjectionPaths: []
}), "missing from inspection");

assertFixtureGroupPhysicalCleanupBlocked(runFixtureGroupDelete({
  ownedPaths: ["objects/fixturegroup/light.apx", "objects/directprojection/light-direct.apx"],
  inspectionError: "inspection unavailable"
}), "inbound reference inspection");

async function verifyTransportAndSaveAdapter() {
  const adapter = context.disguiseSceneAdapter;
  for (const [transport, running] of [["Stop", false], ["Play", true], ["PlaySection", true], ["Loop", true]]) {
    context.fetch = async url => ({ ok: true, status: 200, json: async () => ({ activeTransport: transport }), text: async () => "" });
    assert.deepEqual(JSON.parse(JSON.stringify(await adapter.activeTransportStatus())), { known: true, running, transports: [transport] });
  }
  context.console = { error() {}, info() {} };
  context.fetch = async url => ({ ok: true, status: 200, json: async () => ({}), text: async () => "" });
  assert.deepEqual(JSON.parse(JSON.stringify(await adapter.activeTransportStatus())), { known: false, running: false, transports: [] });
  context.fetch = async () => { throw new Error("transport unavailable"); };
  assert.deepEqual(JSON.parse(JSON.stringify(await adapter.activeTransportStatus())), { known: false, running: false, transports: [] });
  let saveRequest;
  context.fetch = async (url, options) => { saveRequest = { url, options }; return { ok: true, status: 200, text: async () => JSON.stringify({ returnValue: JSON.stringify({ saved: 3 }) }) }; };
  assert.deepEqual(JSON.parse(JSON.stringify(await adapter.saveAllResources())), { saved: 3 });
  assert.match(saveRequest.url, /\/api\/session\/python\/execute$/);
  assert.match(JSON.parse(saveRequest.options.body).script, /saved = resourceManager\.saveAll\(\)/);
}

verifyTransportAndSaveAdapter().then(() => console.log("lifecycle release contract test: ok")).catch(error => { console.error(error); process.exitCode = 1; });
