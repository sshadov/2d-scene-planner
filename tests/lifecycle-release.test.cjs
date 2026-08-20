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

const projectorCreate = scripts.createScript({ pluginId: "projector-2", type: "projector", name: "Projector 2", transform: { position: { x: 1, y: 3, z: 2 }, rotation: { x: 0, y: 0, z: 0 } }, lookAt: { x: 0, y: 1, z: 0 }, optics: { throwRatio: 1.5 } });
assert.match(projectorCreate, /ProjectorConfig/);
assert.match(projectorCreate, /obj\.config/);
assert.match(projectorCreate, /isBad/);
assert.match(projectorCreate, /bool\(resource\.isInError\)/);
assert.match(projectorCreate, /rollback/);
assert.match(projectorCreate, /assert_typed_membership\(stage, "projectors", obj\)/);
assert.match(projectorCreate, /owned_paths = owned_resource_paths\(obj, created_paths\)/);
assert.match(projectorCreate, /"ownedPaths": owned_paths/);

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
assert.match(importedRemove, /owned_resource_paths\(candidate\)/);
assert.match(importedRemove, /remove_resources/);
assert.ok(importedRemove.indexOf("stage.save()") < importedRemove.indexOf("resourceManager.remove(path)"));

const remove = scripts.deleteManagedScript([{ id: "uid-1", path: "objects/projector/projector-1.apx", owned: true, ownedPaths: ["objects/projector/projector-1.apx", "objects/projectorconfig/projector-1_config0.apx"] }]);
assert.doesNotMatch(remove, /requested = json\.loads\("\[\]"\)/);
assert.match(remove, /candidate\.saveOnDelete\(\)/);
assert.match(remove, /resourceManager\.remove\(path\)/);
assert.match(remove, /path == "objects\/object\/dsg-scene-cube\.apx"/);
assert.match(remove, /pending = \[\]/);
assert.match(remove, /for candidate in collection:/);
assert.doesNotMatch(remove, /list\(collection\)/);
assert.match(remove, /collection\.remove\(candidate\)/);
assert.match(remove, /resourceManager\.load\(Path\(resource_path\), Resource\)/);
assert.match(remove, /target_paths/);
assert.match(remove, /stage\.save\(\)/);
assert.doesNotMatch(remove, /candidate\.remove\(\)/);
assert.ok(remove.indexOf("collection.remove(candidate)") < remove.indexOf("resourceManager.remove(path)"));
assert.match(remove, /DirectProjection/);
assert.match(remove, /findResourcesPointingToThis/);
assert.match(remove, /allowed_owned_paths/);
assert.match(remove, /paths_to_remove = \[path for path in owned_paths if path in allowed_owned_paths\]/);
assert.ok(remove.indexOf("stage.save()") < remove.indexOf("resourceManager.remove(path)"));
assert.match(remove, /collection\.remove\(candidate\)/);
assert.doesNotMatch(remove, /setattr\(stage, collection_name, \[/);
assert.doesNotMatch(remove, /def set_stage_collection/);
assert.doesNotMatch(remove, /stage\.(ledScreens|dmxScreens|surfaces|dmxLights|cameras|projectors)\s*=/);
assert.match(remove, /removeResource/);
assert.match(remove, /resource_delete_failed = \[\]/);
assert.match(remove, /resource_delete_failed\.append\(candidate_id\)/);
assert.match(remove, /"resourceDeleteFailed": resource_delete_failed/);
assert.match(remove, /stage_contains/);
assert.doesNotMatch(remove, /collection_names \+ \["children"\]/);
assert.ok(remove.indexOf("stage.save()") < remove.indexOf("stage_contains"));
assert.match(adapterSource, /operationLogEntries/);
assert.match(adapterSource, /operationLog\("request"/);
assert.match(adapterSource, /operationLog\("response"/);
assert.match(adapterSource, /operationLog\("error"/);
assert.match(adapterSource, /getOperationLogs/);
assert.match(adapterSource, /action: meta\.action/);
assert.match(adapterSource, /stage_name_taken/);
assert.match(adapterSource, /resolved_name = allocate_name/);

console.log("lifecycle release contract test: ok");
