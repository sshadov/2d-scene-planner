const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const diagnosticPath = path.join(root, "scripts", "diagnose-composite-devices.py");
assert.equal(fs.existsSync(diagnosticPath), true, "composite smoke diagnostic must exist");

const result = spawnSync("python", [diagnosticPath, "--dry-run"], { cwd: root, encoding: "utf8" });
assert.equal(result.status, 0, result.stderr);
const plan = JSON.parse(result.stdout);
assert.equal(plan.prefix, "dsg-smoke-");
assert.deepEqual(plan.kinds, ["dmxLight", "camera", "projector"]);
assert.deepEqual(plan.names, ["dsg-smoke-dmx-light", "dsg-smoke-camera", "dsg-smoke-projector"]);
assert.equal(plan.createSource, "debugScripts.createScript");
assert.equal(plan.deleteSource, "debugScripts.deleteManagedScript");
assert.equal(plan.cleanupInFinally, true);
assert.equal(plan.verifyNoResidue, true);
assert.equal(plan.verifyManualBaseline, true);
assert.equal(plan.stableCleanupSeconds, 1.5);

const generated = spawnSync("python", ["-c", [
  "import importlib.util",
  `spec=importlib.util.spec_from_file_location('diagnostic', ${JSON.stringify(diagnosticPath)})`,
  "module=importlib.util.module_from_spec(spec)",
  "spec.loader.exec_module(module)",
  "print(module.probe_script())",
  "print(module.emergency_cleanup_script())"
].join(";")], { cwd: root, encoding: "utf8" });
assert.equal(generated.status, 0, generated.stderr);
assert.match(generated.stdout, /def is_smoke_path\(path\):/);
assert.match(generated.stdout, /startswith\(prefix\)/);
assert.doesNotMatch(generated.stdout, /if prefix in path\.lower\(\)/);
assert.match(generated.stdout, /getattr\(stage, "children"/);
assert.match(generated.stdout, /stageChildrenSmoke/);
assert.match(generated.stdout, /projectionBad/);
assert.match(generated.stdout, /projectionIncomplete/);
assert.match(generated.stdout, /projectionError/);
assert.match(generated.stdout, /collection\.remove\(candidate\)/);
assert.doesNotMatch(generated.stdout, /candidate\.remove\(\)/);

console.log("composite Designer diagnostic contract test: ok");
