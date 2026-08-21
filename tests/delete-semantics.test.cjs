const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const adapterSource = fs.readFileSync(path.join(root, "scene-planner-prototype", "designer-adapter.js"), "utf8");
const context = { console, location: { hostname: "127.0.0.1", port: "", search: "", origin: "http://127.0.0.1" }, crypto: { randomUUID: () => "test-id" }, AbortController, setTimeout, clearTimeout };
context.window = context;
context.globalThis = context;
vm.createContext(context);
vm.runInContext(adapterSource, context, { filename: "designer-adapter.js" });

function runDelete({ className = "FixtureGroup", collectionName = "dmxLights", owned = false, removeResource = false, ownedPaths, projections = [], saveFails = false }) {
  const script = context.disguiseSceneAdapter.debugScripts.deleteManagedScript([{ id: "main-uid", path: `objects/${className.toLowerCase()}/main.apx`, owned, ...(ownedPaths === undefined ? {} : { ownedPaths }), removeResource }]);
  const setup = JSON.stringify({ className, collectionName, projections, saveFails });
  const runner = `
import json, sys, types
case = json.loads(${JSON.stringify(setup)})
class Path(str): pass
class Resource: pass
class DirectProjection(Resource):
    def __init__(self, path, targets): self.path, self.screens = path, targets
classes = {name: type(name, (Resource,), {}) for name in ["LedScreen", "DmxScreen", "Screen2", "FixtureGroup", "Camera", "Projector", "ProjectorConfig", "PerspectiveProjection", "PerspectiveProjectionObject"]}
Main = classes[case["className"]]
main = Main(); main.uid = "main-uid"; main.path = "objects/" + case["className"].lower() + "/main.apx"; main.children = []; main.config = None
other = Main(); other.uid = "other-uid"; other.path = "objects/" + case["className"].lower() + "/other.apx"; other.children = []; other.config = None
projection_resources = {}
for item in case["projections"]:
    targets = [main if uid == "main-uid" else other for uid in item["targets"]]
    projection_resources[item["path"]] = DirectProjection(item["path"], targets)
def inbound(resource_type): return list(projection_resources.values())
main.findResourcesPointingToThis = inbound
class Stage:
    def __init__(self):
        for name in ["ledScreens", "dmxScreens", "surfaces", "dmxLights", "cameras", "projectors"]: setattr(self, name, [])
        getattr(self, case["collectionName"]).extend([main, other])
    def save(self):
        if case["saveFails"]: raise RuntimeError("stage save failed")
class Package:
    def findAllBeginsWith(self, folder): return []
class Manager:
    def __init__(self): self.removed = []; self.package = Package()
    def load(self, resource_path, resource_type):
        value = str(resource_path)
        if value == main.path: return main
        if value == other.path: return other
        if value in projection_resources: return projection_resources[value]
        raise RuntimeError("unknown path " + value)
    def remove(self, resource_path): self.removed.append(str(resource_path))
    def exists(self, resource_path): return str(resource_path) not in self.removed
d3 = types.ModuleType("d3")
d3.Path, d3.Resource, d3.DirectProjection = Path, Resource, DirectProjection
sys.modules["d3"] = d3
state = types.SimpleNamespace(stage=Stage())
resourceManager = Manager()
def run():
${script.split("\n").map(line => `    ${line}`).join("\n")}
result = json.loads(run())
remaining = [str(item.uid) for item in getattr(state.stage, case["collectionName"])]
print(json.dumps({"result": result, "remaining": remaining, "removed": resourceManager.removed}))
`;
  return JSON.parse(execFileSync("python", ["-c", runner], { encoding: "utf8" }));
}

for (const [className, collectionName] of [["LedScreen", "ledScreens"], ["DmxScreen", "dmxScreens"], ["Screen2", "surfaces"], ["FixtureGroup", "dmxLights"], ["Camera", "cameras"], ["Projector", "projectors"]]) {
  const stageOnly = runDelete({ className, collectionName, owned: false, removeResource: false });
  assert.deepEqual(stageOnly.remaining, ["other-uid"]);
  assert.deepEqual(stageOnly.result.deleted, ["main-uid"]);
  assert.deepEqual(stageOnly.removed, [], `${className} Stage-only delete must not touch Device List`);

  const importedPhysical = runDelete({ className, collectionName, owned: false, removeResource: true });
  assert.deepEqual(importedPhysical.remaining, ["other-uid"]);
  assert.deepEqual(importedPhysical.removed, [`objects/${className.toLowerCase()}/main.apx`], `${className} imported Device List delete must remove only the main Resource`);
}

const incompleteOwnership = runDelete({ owned: true, removeResource: true, ownedPaths: [] });
assert.deepEqual(incompleteOwnership.removed, ["objects/fixturegroup/main.apx"], "Incomplete ownership must not block main Resource deletion");

const solePath = "objects/directprojection/main direct.apx";
const soleProjection = runDelete({ owned: true, removeResource: true, ownedPaths: ["objects/fixturegroup/main.apx", solePath], projections: [{ path: solePath, targets: ["main-uid"] }] });
assert.deepEqual(soleProjection.removed, [solePath, "objects/fixturegroup/main.apx"]);

const sharedPath = "objects/directprojection/shared.apx";
const sharedProjection = runDelete({ owned: true, removeResource: true, ownedPaths: ["objects/fixturegroup/main.apx", sharedPath], projections: [{ path: sharedPath, targets: ["main-uid", "other-uid"] }] });
assert.deepEqual(sharedProjection.removed, ["objects/fixturegroup/main.apx"], "Shared DirectProjection must survive");

const unrelatedPath = "objects/directprojection/unrelated.apx";
const unrelatedProjection = runDelete({ owned: true, removeResource: true, ownedPaths: ["objects/fixturegroup/main.apx", unrelatedPath], projections: [{ path: unrelatedPath, targets: ["other-uid"] }] });
assert.deepEqual(unrelatedProjection.removed, ["objects/fixturegroup/main.apx"], "Unrelated DirectProjection must survive");

const failedSave = runDelete({ owned: false, removeResource: true, saveFails: true });
assert.deepEqual(failedSave.removed, [], "Resource deletion must not run after Stage save failure");
assert.deepEqual(failedSave.result.deleted, []);

console.log("delete semantics test: ok");
