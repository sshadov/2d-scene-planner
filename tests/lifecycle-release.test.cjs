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

const remove = scripts.deleteManagedScript(["uid-1"]);
assert.match(remove, /candidate\.saveOnDelete\(\)/);
assert.match(remove, /resourceManager\.remove\(path\)/);
assert.match(remove, /path == "objects\/object\/dsg-scene-cube\.apx"/);

console.log("lifecycle release contract test: ok");
