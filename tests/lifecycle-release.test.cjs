const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const adapterSource = fs.readFileSync(path.join(root, "scene-planner-prototype", "designer-adapter.js"), "utf8");
const context = {
  console,
  location: { hostname: "127.0.0.1", port: "", search: "", origin: "http://127.0.0.1" },
  crypto: { randomUUID: () => "test-id" },
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
assert.match(create, /while resource_path_taken\(object_path\)/);
assert.match(create, /resourceManager\.loadOrCreate\(Path\(object_path\), expected_type\)/);
assert.match(create, /if not present:/);
assert.match(create, /"name": resolved_name/);

const rename = scripts.updateScript("uid-1", { name: "DMX Light 2" }, "objects/dmxlight/dmx light 1.apx", "dmxLight");
assert.match(rename, /resourceManager\.exists\(Path\(desired_path\)\)/);
assert.match(rename, /resourceManager\.package\.findAllBeginsWith/);
assert.match(rename, /Resource name already exists in Designer Resource list/);
assert.match(rename, /"name": str\(getattr\(obj, "description", ""\)\)/);

const remove = scripts.deleteManagedScript([{ id: "uid-1", path: "objects/projector/projector-1.apx" }]);
assert.match(remove, /candidate\.saveOnDelete\(\)/);
assert.match(remove, /resourceManager\.remove\(path\)/);
assert.match(remove, /path == "objects\/object\/dsg-scene-cube\.apx"/);
assert.match(remove, /pending = \[\]/);
assert.match(remove, /for candidate in collection:/);
assert.doesNotMatch(remove, /list\(collection\)/);
assert.doesNotMatch(remove, /collection\.remove\(candidate\)/);
assert.match(remove, /resourceManager\.load\(Path\(resource_path\), Resource\)/);
assert.match(remove, /target_paths/);
assert.match(remove, /candidate\.isInActiveStage\(\)/);
assert.match(remove, /candidate\.remove\(\)/);
assert.match(remove, /stage\.save\(\)/);
assert.ok(remove.indexOf("candidate.remove()") < remove.indexOf("resourceManager.remove(path)"));

console.log("lifecycle release contract test: ok");
