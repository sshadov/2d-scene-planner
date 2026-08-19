(() => {
  const localTest = ["127.0.0.1", "localhost"].includes(window.location.hostname) && window.location.port;
  function directorOrigin() {
    let value = window.DISGUISE_DIRECTOR || "";
    try { value = new URLSearchParams(window.location.search || "").get("director") || value; } catch {}
    if (!value) return localTest ? "http://127.0.0.1" : window.location.origin;
    value = String(value).trim();
    if (!/^https?:\/\//i.test(value)) value = `http://${value}`;
    return value.replace(/\/$/, "");
  }
  const API_ORIGIN = window.DISGUISE_API_ORIGIN || directorOrigin();
  const EXECUTE_PATH = "/api/session/python/execute";
  const STATUS_PATH = "/api/session/status/session";
  const LIVE_PATH = "/api/session/liveupdate";
  const LIVE_URL = `${API_ORIGIN.replace(/^http/i, "ws")}${LIVE_PATH}`;
  const typeCollections = { screen: "ledScreens", dmxScreen: "dmxScreens", surface: "surfaces", dmxLight: "dmxLights", camera: "cameras", projector: "projectors", designer: "displays" };
  const typeClasses = { screen: "LedScreen", dmxScreen: "DmxScreen", surface: "Screen2", dmxLight: "FixtureGroup", camera: "Camera", projector: "Projector" };
  const typeResourceFolders = { screen: "ledscreen", dmxScreen: "dmxscreen", surface: "screen2", dmxLight: "fixturegroup", camera: "camera", projector: "projector" };
  const collectionTypes = Object.fromEntries(Object.entries(typeCollections).map(([type, collection]) => [collection, type]));
  let liveSocket = null;
  let liveConnectPromise = null;
  let liveBindings = new Map();
  let liveSceneBindings = new Map();
  let livePendingSubscriptions = new Set();
  let liveOnStatus = () => {};
  let liveOnValuesChanged = () => {};
  let liveOnSceneChanged = () => {};
  let liveStageId = null;
  let liveSceneReady = false;
  let liveWanted = false;
  let liveReconnectTimer = null;
  let liveReconnectAttempt = 0;
  let liveSocketGeneration = 0;
  const liveLogEntries = [];
  const LIVE_LOG_LIMIT = 300;
  // Live Update returns Designer float32 values; this absorbs representation
  // noise without hiding a real measurement change.
  const LIVE_FLOAT_EPSILON = 1e-5;

  function liveLog(event, details = {}) {
    const entry = { at: new Date().toISOString(), event, ...details };
    liveLogEntries.push(entry); if (liveLogEntries.length > LIVE_LOG_LIMIT) liveLogEntries.shift();
    if (event === "error" || event === "close") console.error("[ScenePlanner LIVE]", entry);
    else console.info("[ScenePlanner LIVE]", entry);
  }

  function liveValuesEqual(left, right) {
    if (typeof left === "number" && typeof right === "number") return Math.abs(left - right) <= LIVE_FLOAT_EPSILON;
    if (Array.isArray(left) && Array.isArray(right)) return left.length === right.length && left.every((value, index) => liveValuesEqual(value, right[index]));
    if (left && right && typeof left === "object" && typeof right === "object") {
      const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
      return [...keys].every(key => liveValuesEqual(left[key], right[key]));
    }
    return left === right;
  }

  function quote(value) { return JSON.stringify(value); }
  function payloadText(payload) { return quote(JSON.stringify(payload)); }
  function resourceSlug(payload) {
    const source = String(payload.name || payload.pluginId || `${String(payload.type || "object").toLowerCase()}-object`).trim();
    return (source || String(payload.pluginId || "object")).replace(/[\\/:*?"<>|]/g, "-").toLowerCase();
  }
  function resourcePath(payload) { return `objects/${typeResourceFolders[payload.type]}/${resourceSlug(payload)}.apx`; }
  function parseReturnValue(value) {
    if (typeof value !== "string") return value;
    try { const parsed = JSON.parse(value); return typeof parsed === "string" ? JSON.parse(parsed) : parsed; } catch { return value; }
  }
  async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
    try { return await fetch(url, { ...options, signal: controller.signal }); }
    finally { clearTimeout(timer); }
  }
  async function execute(script) {
    let response;
    try { response = await fetchWithTimeout(`${API_ORIGIN}${EXECUTE_PATH}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ script }) }); }
    catch (error) { throw new Error(`Нет соединения с Designer API по адресу ${API_ORIGIN}. Проверьте, что Designer запущен, а v2rayN обходит localhost. ${error.message || error}`); }
    const responseText = await response.text();
    if (!response.ok) throw new Error(`Designer API HTTP ${response.status}: ${responseText.slice(0, 800) || "пустой ответ"}`);
    let body;
    try { body = JSON.parse(responseText); } catch { throw new Error(`Designer API вернул не-JSON ответ: ${responseText.slice(0, 800)}`); }
    if (body.status && body.status.code !== 0) throw new Error(body.status.message || "Designer отклонил Python-команду");
    return parseReturnValue(body.returnValue);
  }
  async function sessionStatus() { const response = await fetchWithTimeout(`${API_ORIGIN}${STATUS_PATH}`, {}, 2500); if (!response.ok) throw new Error(`Designer session status: HTTP ${response.status}`); return response.json(); }
  function environmentScript(environment) {
    return `import json
stage = state.stage
# Do not write stage.floor_size from the plugin. In Free Designer Starter this
# fires Screen2Editor.handleStageDisplaysChanged, which receives a Field proxy
# and raises "Access to object of type 'Field' is not allowed". Room dimensions
# remain planner metadata; the managed Stage cube carries the physical size.
stage.floor_pos = Vec(${Number(environment.stage.centerX || 0)}, ${Number(environment.stage.floorY || 0)}, ${Number(environment.stage.centerZ || 0)})
scene_path = "objects/object/dsg-scene-cube.apx"
scene_enabled = ${Boolean(environment.stage.enabled) ? "True" : "False"}
scene_obj = None
for candidate in stage.children:
    if str(getattr(candidate, "path", "")) == scene_path:
        scene_obj = candidate
        break
if scene_enabled:
    if scene_obj is None:
        scene_obj = resourceManager.loadOrCreate(scene_path, Object)
        stage.add(scene_obj)
    cube_width = abs(float(${Number(environment.stage.width)}))
    cube_depth = abs(float(${Number(environment.stage.depth)}))
    cube_height = abs(float(${Number(environment.stage.height)}))
    # Triangle has no supported public constructor/fields in the current
    # Designer build. Reuse the valid cube topology from the built-in
    # LookAtManipulable helper and only replace its vertex positions.
    template_mesh = None
    for candidate in stage.children:
        try:
            candidate_mesh = getattr(candidate, "mesh", None)
            if type(candidate).__name__ == "LookAtManipulable" and candidate_mesh is not None and len(candidate_mesh.verts) == 8 and len(candidate_mesh.triangles) == 12:
                template_mesh = candidate_mesh
                break
        except Exception:
            continue
    if template_mesh is None:
        raise RuntimeError("Designer has no supported 8-vertex cube mesh template")
    markDirty(scene_obj)
    mesh = template_mesh.copy()
    mesh.verts.resize(8)
    hx, hy, hz = cube_width / 2.0, cube_height / 2.0, cube_depth / 2.0
    points = [(-hx, -hy, -hz), (hx, -hy, -hz), (hx, -hy, hz), (-hx, -hy, hz), (-hx, hy, -hz), (hx, hy, -hz), (hx, hy, hz), (-hx, hy, hz)]
    for index, point in enumerate(points):
        mesh.verts[index].pos = Vec(point[0], point[1], point[2])
    mesh.updateMesh()
    scene_obj.mesh = mesh
    scene_obj.offset = Vec(${Number(environment.stage.centerX || 0)}, ${Number(environment.stage.floorY || 0)} + hy, ${Number(environment.stage.centerZ || 0)})
    scene_obj.rotation = Vec(0.0, 0.0, 0.0)
    scene_obj.scale = Vec(1.0, 1.0, 1.0)
    scene_obj.renderLayer = Object.OnStage
    scene_obj.save()
try:
    stage.save()
except Exception:
    pass
floor_size = getattr(stage, "floor_size", None)
return json.dumps({"stageFootprint": {"width": float(floor_size.x), "depth": float(floor_size.y)} if floor_size is not None else {"width": float(${Number(environment.stage.width)}), "depth": float(${Number(environment.stage.depth)})}, "floorY": float(stage.floor_pos.y), "sceneEnabled": scene_enabled, "sceneCube": {"designerId": str(scene_obj.uid), "path": scene_path} if scene_obj is not None else None})`;
  }

  function readbackHelpers() {
    return `def vec_data(value):
    return {"x": float(value.x), "y": float(value.y), "z": float(value.z)}
def readback(obj, kind):
    if kind in ["screen", "dmxScreen", "surface"]:
        pos = obj.offset
        rot = obj.rotation
        size = obj.scale
        return {
            "transform": {
                "position": {"x": float(pos.x), "y": float(pos.y) - float(size.y) / 2.0, "z": float(pos.z)},
                "rotation": {"x": 0.0, "y": float(rot.y), "z": 0.0}
            },
            "geometry": {"width": float(size.x), "height": float(size.y)}
        }
    if kind == "projector":
        # Projector optical state is defined only by the public config contract.
        # Do not read the inherited body rotation/configRotation into Planner.
        def scalar(name, fallback=0.0):
            try:
                return float(getattr(obj, name))
            except Exception:
                return float(fallback)
        position = vec_data(obj.configPosition)
        look_at = vec_data(obj.configLookAt)
        distance = ((look_at["x"] - position["x"]) ** 2 + (look_at["y"] - position["y"]) ** 2 + (look_at["z"] - position["z"]) ** 2) ** 0.5
        return {"transform": {"position": position, "rotation": {"x": 0.0, "y": 0.0, "z": 0.0}}, "lookAt": look_at, "optics": {"throwRatio": scalar("configThrowRatio", 1.5), "fieldOfView": scalar("fieldOfView", 40.0), "lookDistance": scalar("configLookDistance", distance)}}
    if kind == "camera":
        return {"transform": {"position": vec_data(obj.offset), "rotation": vec_data(obj.rotation)}}
    position = getattr(obj, "offset", None)
    rotation = getattr(obj, "rotation", None)
    if position is None:
        return {"transform": {"position": {"x": 0.0, "y": 0.0, "z": 0.0}, "rotation": {"x": 0.0, "y": 0.0, "z": 0.0}}}
    return {"transform": {"position": vec_data(position), "rotation": vec_data(rotation) if rotation is not None else {"x": 0.0, "y": 0.0, "z": 0.0}}}`;
  }
  function assignHelpers() {
    // Contract markers: assign("offset", Vec(pos["x"], pos["y"] + geometry["height"] / 2.0, pos["z"])); assign("scale", Vec(geometry["width"], geometry["height"], 0.1)); assign("configPosition", position_value); assign("configLookAt", look_at)
    return "def assign(field, value): setattr(obj, field, value)";
  }
  function inspectScript() {
    return `import json
import re
from d3 import Path
stage = state.stage
objects = []
warnings = []
collection_types = ${quote(collectionTypes)}
${readbackHelpers()}
seen_ids = set()
class_types = {"LedScreen": "screen", "DmxScreen": "dmxScreen", "Screen2": "surface", "FixtureGroup": "dmxLight", "Camera": "camera", "Projector": "projector"}
supported_classes = set(["LedScreen", "DmxScreen", "Screen2", "FixtureGroup", "Camera", "Projector", "Object", "ObjectBox", "Prop"])
scene_cube = None
for collection_name in ${quote([...new Set([...Object.values(typeCollections), "displays", "children"])])}:
    collection = getattr(stage, collection_name, [])
    for obj in collection:
        try:
            uid = str(getattr(obj, "uid", ""))
            if not uid:
                warnings.append(collection_name + ": empty object reference")
                continue
            if uid in seen_ids:
                continue
            seen_ids.add(uid)
            path = str(getattr(obj, "path", ""))
            description = str(getattr(obj, "description", ""))
            text = (path + " " + description).lower()
            if path == "objects/object/dsg-scene-cube.apx":
                scene_cube = {"designerId": uid, "path": path, "description": description}
                continue
            if collection_name == "children" and type(obj).__name__ in class_types:
                # Typed Stage collections are authoritative. The generic
                # children hierarchy can retain stale references after a
                # resourceManager.remove() until Designer refreshes it.
                continue
            if collection_name == "children" and path.lower().startswith("internal/"):
                warnings.append(collection_name + ": ignored Designer internal helper " + path)
                continue
            if type(obj).__name__ not in supported_classes:
                warnings.append(collection_name + ": ignored Designer helper " + type(obj).__name__)
                continue
            if type(obj).__name__ in ["Object", "ObjectBox", "Prop"] and not bool(getattr(obj, "needsMesh", False)):
                warnings.append(collection_name + ": ignored non-physical Designer helper " + type(obj).__name__)
                continue
            match = re.search(r"dsg-(.+?)\\.apx", path, re.IGNORECASE)
            standard = bool(re.search(r"(^|[/\\\\ _-])(surface|projector|camera|screen|light)[ _-]?1(?:\\.|$)", text))
            kind = class_types.get(type(obj).__name__, collection_types.get(collection_name, "designer"))
            data = readback(obj, kind)
            objects.append({
                "id": uid, "path": path, "description": description, "collection": collection_name, "type": kind,
                "className": type(obj).__name__, "managed": "dsg-" in path.lower(), "pluginId": match.group(1) if match else None, "standard": standard,
                "transform": data["transform"], "geometry": data.get("geometry"), "lookAt": data.get("lookAt"), "optics": data.get("optics")
            })
        except Exception as error:
            warnings.append(collection_name + ": " + str(error))
floor = getattr(stage, "floor_pos", None)
floor_y = float(floor.y) if floor is not None else 0.0
floor_size = getattr(stage, "floor_size", None)
return json.dumps({"objects": objects, "stageId": str(getattr(stage, "uid", "")), "floorY": floor_y, "floorPosition": vec_data(floor) if floor is not None else {"x": 0.0, "y": 0.0, "z": 0.0}, "stageFootprint": {"width": float(floor_size.x), "depth": float(floor_size.y)} if floor_size is not None else None, "warnings": warnings, "sceneCube": scene_cube})`;
  }
  function createScript(payload) {
    const simple = ["screen", "dmxScreen", "surface", "dmxLight"].includes(payload.type);
    const helper = `import re\nfrom d3 import Path, Resource\n\ndef resource_class(path):\n    try:\n        return type(resourceManager.load(Path(path), Resource)).__name__\n    except Exception:\n        return None\n\ndef resource_path_taken(path):\n    try:\n        if resourceManager.exists(Path(path)):\n            return True\n    except Exception:\n        pass\n    try:\n        for candidate_path in resourceManager.package.findAllBeginsWith(path.rsplit(\"/\", 1)[0] + \"/\"):\n            if str(candidate_path).lower() == path.lower():\n                return True\n    except Exception:\n        pass\n    return False\n\ndef allocate_path(folder, base_name, expected_class):\n    safe = re.sub(r\"[\\\\/:*?\\\"<>|]\", \"-\", str(base_name)).strip() or \"object\"\n    resolved = safe\n    candidate = folder + \"/\" + resolved.lower() + \".apx\"\n    suffix = 2\n    while resource_path_taken(candidate):\n        actual = resource_class(candidate)\n        if actual is not None and actual != expected_class:\n            raise RuntimeError(\"existing resource class conflict: {} is {}, expected {}\".format(candidate, actual, expected_class))\n        resolved = safe + \" \" + str(suffix)\n        candidate = folder + \"/\" + resolved.lower() + \".apx\"\n        suffix += 1\n    return resolved, candidate\n\ndef assert_healthy(resource, label):\n    for flag in [\"isBad\", \"isIncomplete\", \"isInError\"]:\n        try:\n            if bool(getattr(resource, flag)):\n                raise RuntimeError(\"{} is unhealthy ({}): {}\".format(label, flag, getattr(resource, flag)))\n        except AttributeError:\n            pass\n\ndef rollback(created_paths, stage, attached, collection):\n    if attached:\n        try:\n            attached.remove()\n        except Exception:\n            pass\n    try:\n        stage.save()\n    except Exception:\n        pass\n    for path in reversed(created_paths):\n        try:\n            resourceManager.remove(path)\n        except Exception:\n            pass\n\ndef append_typed(obj, collection):\n    for candidate in collection:\n        try:\n            if str(getattr(candidate, \"uid\", \"\")) == str(obj.uid):\n                return\n        except Exception:\n            pass\n    collection.append(obj)\n\ndef createSimpleDisplay(payload):\n    kind = payload[\"type\"]\n    expected_type = ${typeClasses[payload.type]}\n    folder = \"objects/${typeResourceFolders[payload.type]}\"\n    resolved_name, object_path = allocate_path(folder, payload.get(\"name\") or payload.get(\"pluginId\"), expected_type)\n    created_paths = []\n    obj = None\n    collection = getattr(stage, ${quote(typeCollections[payload.type])})\n    try:\n        obj = resourceManager.loadOrCreate(Path(object_path), expected_type)\n        created_paths.append(object_path)\n        markDirty(obj)\n        transform = payload[\"transform\"]\n        pos = transform[\"position\"]\n        rot = transform[\"rotation\"]\n        ${assignHelpers()}\n        if kind in [\"screen\", \"dmxScreen\", \"surface\"]:\n            geometry = payload[\"geometry\"]\n            assign(\"offset\", Vec(pos[\"x\"], pos[\"y\"] + geometry[\"height\"] / 2.0, pos[\"z\"]))\n            assign(\"scale\", Vec(geometry[\"width\"], geometry[\"height\"], 0.1))\n            assign(\"rotation\", Vec(0.0, rot[\"y\"], 0.0))\n        else:\n            assign(\"offset\", Vec(pos[\"x\"], pos[\"y\"], pos[\"z\"]))\n            assign(\"rotation\", Vec(rot[\"x\"], rot[\"y\"], rot[\"z\"]))\n        append_typed(obj, collection)\n        obj.save()\n        stage.save()\n        assert_healthy(obj, kind)\n        return obj, resolved_name, object_path\n    except Exception:\n        rollback(created_paths, stage, obj if obj is not None else None, collection)\n        raise\n\n`;
    const body = simple ? `payload = json.loads(${payloadText(payload)})\nstage = state.stage\nobj, resolved_name, object_path = createSimpleDisplay(payload)\nkind = payload[\"type\"]\n${readbackHelpers()}\nreturn json.dumps({\"designerId\": str(obj.uid), \"path\": object_path, \"name\": resolved_name, \"readback\": readback(obj, kind)})` : payload.type === "camera" ? `from d3 import Camera, PerspectiveProjection, PerspectiveProjectionObject\npayload = json.loads(${payloadText(payload)})\nstage = state.stage\ncreated_paths = []\nobj = projection = projection_object = None\ncollection = stage.cameras\ntry:\n    resolved_name, object_path = allocate_path(\"objects/camera\", payload.get(\"name\") or payload.get(\"pluginId\"), \"Camera\")\n    projection_name, projection_path = allocate_path(\"objects/camera\", resolved_name + \" (perspective)\", \"PerspectiveProjection\")\n    projection_object_name, projection_object_path = allocate_path(\"objects/perspectiveprojectionobject\", resolved_name + \" (perspective)\", \"PerspectiveProjectionObject\")\n    obj = Camera(); projection = PerspectiveProjection(); projection_object = PerspectiveProjectionObject()\n    obj.path = Path(object_path); projection.path = Path(projection_path); projection_object.path = Path(projection_object_path)\n    projection_object.projection = projection\n    obj.add(projection_object)\n    created_paths.extend([object_path, projection_path, projection_object_path])\n    transform = payload[\"transform\"]; pos = transform[\"position\"]; rot = transform[\"rotation\"]\n    obj.offset = Vec(pos[\"x\"], pos[\"y\"], pos[\"z\"]); obj.rotation = Vec(rot[\"x\"], rot[\"y\"], rot[\"z\"])\n    append_typed(obj, collection)\n    projection.save(); projection_object.save(); obj.save(); stage.save()\n    assert_healthy(projection, \"camera projection\"); assert_healthy(projection_object, \"camera projection object\"); assert_healthy(obj, \"camera\")\n    child_count = 0\n    for child in obj.children:\n        if type(child).__name__ == \"PerspectiveProjectionObject\": child_count += 1\n    if child_count != 1: raise RuntimeError(\"camera must have exactly one PerspectiveProjectionObject\")\nexcept Exception:\n    rollback(created_paths, stage, obj, collection)\n    raise\nkind = \"camera\"\n${readbackHelpers()}\nreturn json.dumps({\"designerId\": str(obj.uid), \"path\": object_path, \"name\": resolved_name, \"readback\": readback(obj, kind)})` : `from d3 import Projector, ProjectorConfig\npayload = json.loads(${payloadText(payload)})\nstage = state.stage\ncreated_paths = []\nobj = config = None\ncollection = stage.projectors\ntry:\n    resolved_name, object_path = allocate_path(\"objects/projector\", payload.get(\"name\") or payload.get(\"pluginId\"), \"Projector\")\n    config_name, config_path = allocate_path(\"objects/projectorconfig\", resolved_name + \"_config0\", \"ProjectorConfig\")\n    obj = Projector(); config = ProjectorConfig()\n    obj.path = Path(object_path); config.path = Path(config_path); obj.config = config\n    created_paths.extend([object_path, config_path])\n    transform = payload[\"transform\"]; pos = transform[\"position\"]\n    obj.configPosition = Vec(pos[\"x\"], pos[\"y\"], pos[\"z\"])\n    look_at = payload.get(\"lookAt\", pos); obj.configLookAt = Vec(look_at[\"x\"], look_at[\"y\"], look_at[\"z\"])\n    optics = payload.get(\"optics\", {})\n    if \"throwRatio\" in optics: obj.configThrowRatio = float(optics[\"throwRatio\"])\n    append_typed(obj, collection)\n    config.save(); obj.save(); stage.save()\n    assert_healthy(config, \"projector config\"); assert_healthy(obj, \"projector\")\n    if getattr(obj, \"config\", None) is not config: raise RuntimeError(\"projector config reference was not retained\")\nexcept Exception:\n    rollback(created_paths, stage, obj, collection)\n    raise\nkind = \"projector\"\n${readbackHelpers()}\nreturn json.dumps({\"designerId\": str(obj.uid), \"path\": object_path, \"name\": resolved_name, \"readback\": readback(obj, kind)})`;
    return `${helper}${body}`
      .replace('from d3 import Path, Resource', 'from d3 import Path, Resource, LedScreen, DmxScreen, Screen2, FixtureGroup, Camera, Projector, ProjectorConfig, PerspectiveProjection, PerspectiveProjectionObject')
      .replace('import re\nfrom d3', 'import json\nimport re\nfrom d3')
      .replace('allocate_path(folder, payload.get("name") or payload.get("pluginId"), expected_type)', 'allocate_path(folder, payload.get("name") or payload.get("pluginId"), expected_type.__name__)')
      .replace('        def assign(field, value):\n    try:\n        setattr(obj, field, value)\n    except Exception as error:\n        raise RuntimeError("Cannot set {} on {} at {}: {}".format(field, type(obj).__name__, object_path, error))', '        def assign(field, value):\n            try:\n                setattr(obj, field, value)\n            except Exception as error:\n                raise RuntimeError("Cannot set {} on {} at {}: {}".format(field, type(obj).__name__, object_path, error))')
      .replace('if getattr(obj, "config", None) is not config: raise RuntimeError("projector config reference was not retained")', 'retained_config = getattr(obj, "config", None)\n    if retained_config is None or str(getattr(retained_config, "path", "")) != config_path: raise RuntimeError("projector config reference was not retained")');
  }
  function updateScript(designerId, changed, designerPath, kind) {
    return `import json
import re
from d3 import Path
target_id = ${quote(String(designerId))}
target_path = ${quote(String(designerPath || ""))}
kind = ${quote(kind)}
changed = json.loads(${payloadText(changed)})
stage = state.stage
obj = None
for collection_name in ${quote([...new Set([...Object.values(typeCollections), "displays", "children"])])}:
    for candidate in getattr(stage, collection_name, []):
        try:
            candidate_path = str(getattr(candidate, "path", ""))
            candidate_id = str(getattr(candidate, "uid", ""))
            if candidate_id == target_id or (target_path and candidate_path == target_path):
                obj = candidate
                break
        except Exception:
            continue
    if obj is not None:
        break
if obj is None:
    raise ValueError("Объект Designer с uid не найден: " + target_id)
markDirty(obj)
object_path = str(getattr(obj, "path", ""))
${assignHelpers()}
name_change = changed.get("name")
if name_change:
    safe_name = re.sub(r"[\\\\/:*?\"<>|]", "-", str(name_change)).strip() or "object"
    folder = object_path.rsplit("/", 1)[0] if "/" in object_path else "objects"
    desired_path = folder + "/" + safe_name + ".apx"
    if desired_path != object_path:
        conflict = False
        try:
            conflict = bool(resourceManager.exists(Path(desired_path)))
        except Exception:
            conflict = False
        if not conflict:
            try:
                for candidate_path in resourceManager.package.findAllBeginsWith(folder + "/"):
                    candidate_path = str(candidate_path)
                    if candidate_path.lower() == desired_path.lower() and candidate_path.lower() != object_path.lower():
                        conflict = True
                        break
            except Exception:
                pass
        if desired_path.lower() == object_path.lower():
            conflict = False
        if conflict:
            raise RuntimeError("Resource name already exists in Designer Resource list: " + safe_name)
        try:
            obj.rename(Path(desired_path))
            object_path = str(obj.path)
        except Exception as error:
            raise RuntimeError("Cannot rename Designer resource to {}: {}".format(desired_path, error))
transform_change = changed.get("transform", {})
position_change = transform_change.get("position", {})
rotation_change = transform_change.get("rotation", {})
if kind in ["screen", "dmxScreen", "surface"]:
    current_pos = obj.offset
    current_size = obj.scale
    current_rot = obj.rotation
    geometry_change = changed.get("geometry", {})
    width = geometry_change.get("width", float(current_size.x))
    height = geometry_change.get("height", float(current_size.y))
    x = position_change.get("x", float(current_pos.x))
    y_bottom = position_change.get("y", float(current_pos.y) - float(current_size.y) / 2.0)
    z = position_change.get("z", float(current_pos.z))
    yaw = rotation_change.get("y", float(current_rot.y))
    if position_change or geometry_change:
        assign("offset", Vec(x, y_bottom + height / 2.0, z))
    if geometry_change:
        assign("scale", Vec(width, height, 0.1))
    if rotation_change:
        assign("rotation", Vec(0.0, yaw, 0.0))
elif kind == "projector":
    current_pos = obj.configPosition
    if position_change:
        value = Vec(position_change.get("x", current_pos.x), position_change.get("y", current_pos.y), position_change.get("z", current_pos.z))
        assign("configPosition", value)
    look_change = changed.get("lookAt", {})
    if look_change:
        current_look = obj.configLookAt
        value = Vec(look_change.get("x", current_look.x), look_change.get("y", current_look.y), look_change.get("z", current_look.z))
        assign("configLookAt", value)
    optics_change = changed.get("optics", {})
    if "throwRatio" in optics_change:
        assign("configThrowRatio", float(optics_change["throwRatio"]))
elif kind == "camera":
    current_pos = obj.offset
    current_rot = obj.rotation
    if position_change:
        assign("offset", Vec(position_change.get("x", current_pos.x), position_change.get("y", current_pos.y), position_change.get("z", current_pos.z)))
    if rotation_change:
        assign("rotation", Vec(rotation_change.get("x", current_rot.x), rotation_change.get("y", current_rot.y), rotation_change.get("z", current_rot.z)))
else:
    current_pos = obj.offset
    current_rot = obj.rotation
    if position_change:
        assign("offset", Vec(position_change.get("x", current_pos.x), position_change.get("y", current_pos.y), position_change.get("z", current_pos.z)))
    if rotation_change:
        assign("rotation", Vec(rotation_change.get("x", current_rot.x), rotation_change.get("y", current_rot.y), rotation_change.get("z", current_rot.z)))
obj.save()
${readbackHelpers()}
return json.dumps({"designerId": str(obj.uid), "path": object_path, "name": str(getattr(obj, "description", "")), "readback": readback(obj, kind)})`;
  }
  function projectorProbeScript(designerId = null) {
    const targetId = designerId == null ? "" : String(designerId);
    return `import json
def vec_data(value):
    return {"x": float(value.x), "y": float(value.y), "z": float(value.z)}
target_id = ${quote(targetId)}
matches = []
for candidate in state.stage.projectors:
    candidate_id = str(candidate.uid)
    if target_id and candidate_id != target_id:
        continue
    matches.append({
        "designerId": candidate_id,
        "path": str(candidate.path),
        "className": type(candidate).__name__,
        "configPosition": vec_data(candidate.configPosition),
        "configLookAt": vec_data(candidate.configLookAt)
    })
return json.dumps({"contract": "Projector.configPosition/configLookAt", "projectors": matches})`;
  }
  function deleteScript(designerIds) {
    const deleteCollectionNames = [...new Set([...Object.values(typeCollections), "children"].filter(collection => collection !== "displays"))];
    return `import json
import re
from d3 import Path, Resource
requested = json.loads(${payloadText(designerIds)})
target_ids = set(str(item.get("id", item)) if isinstance(item, dict) else str(item) for item in requested)
target_paths = set(str(item.get("path", "")) for item in requested if isinstance(item, dict) and item.get("path"))
stage = state.stage
deleted = []
skipped = []
processed = set()
pending = []
def owned_resource_paths(candidate):
    paths = []
    config_path = str(getattr(getattr(candidate, "config", None), "path", ""))
    if config_path: paths.append(config_path)
    for child in getattr(candidate, "children", []):
        child_path = str(getattr(child, "path", ""))
        if child_path: paths.append(child_path)
        projection_path = str(getattr(getattr(child, "projection", None), "path", ""))
        if projection_path: paths.append(projection_path)
    return list(dict.fromkeys(paths))
for resource_path in target_paths:
    try:
        candidate = resourceManager.load(Path(resource_path), Resource)
        candidate_id = str(getattr(candidate, "uid", ""))
        if candidate_id in target_ids and resource_path != "objects/object/dsg-scene-cube.apx":
            processed.add(candidate_id)
            pending.append((candidate_id, resource_path, candidate, owned_resource_paths(candidate)))
    except Exception:
        pass
for collection_name in ${quote(deleteCollectionNames)}:
    typed_collection = collection_name
    collection = getattr(stage, collection_name, [])
    for candidate in collection:
        try:
            candidate_id = str(getattr(candidate, "uid", ""))
        except Exception:
            continue
        if candidate_id in processed or candidate_id not in target_ids:
            continue
        processed.add(candidate_id)
        path = str(getattr(candidate, "path", ""))
        description = str(getattr(candidate, "description", ""))
        text = (path + " " + description).lower()
        standard = bool(re.search(r"(^|[/\\\\ _-])(surface|projector|camera|screen|light)[ _-]?1(?:\\.|$)", text))
        if "dsg-" in path.lower() or not standard:
            skipped.append(candidate_id)
            continue
        resource_path = str(getattr(candidate, "path", ""))
        if not resource_path:
            skipped.append(candidate_id)
            continue
        pending.append((candidate_id, resource_path, candidate, owned_resource_paths(candidate)))
detached = []
for candidate_id, resource_path, candidate, owned_paths in pending:
    try:
        try:
            if candidate.isInActiveStage():
                candidate.remove()
        except Exception:
            candidate.remove()
        detached.append((candidate_id, resource_path, candidate, owned_paths))
    except Exception as error:
        skipped.append("detach " + candidate_id + ": " + str(error))
stage_saved = True
try:
    stage.save()
except Exception as error:
    stage_saved = False
    skipped.append("stage save: " + str(error))
for candidate_id, resource_path, candidate, owned_paths in (detached if stage_saved else []):
    try:
        candidate.saveOnDelete()
        for owned_path in owned_paths:
            resourceManager.remove(owned_path)
        resourceManager.remove(resource_path)
        deleted.append(candidate_id)
    except Exception as error:
        warnings = "delete " + candidate_id + ": " + str(error)
        skipped.append(warnings)
return json.dumps({"deleted": deleted, "skipped": skipped})`;
  }
function deleteManagedScript(designerIds) {
    const deleteCollectionNames = [...new Set([...Object.values(typeCollections), "children"].filter(collection => collection !== "displays"))];
    return `import json
from d3 import Path, Resource
requested = json.loads(${payloadText(designerIds)})
target_ids = set(str(item.get("id", item)) if isinstance(item, dict) else str(item) for item in requested)
target_paths = set(str(item.get("path", "")) for item in requested if isinstance(item, dict) and item.get("path"))
stage = state.stage
deleted = []
skipped = []
processed = set()
pending = []
def owned_resource_paths(candidate):
    paths = []
    config_path = str(getattr(getattr(candidate, "config", None), "path", ""))
    if config_path: paths.append(config_path)
    for child in getattr(candidate, "children", []):
        child_path = str(getattr(child, "path", ""))
        if child_path: paths.append(child_path)
        projection_path = str(getattr(getattr(child, "projection", None), "path", ""))
        if projection_path: paths.append(projection_path)
    return list(dict.fromkeys(paths))
for resource_path in target_paths:
    try:
        candidate = resourceManager.load(Path(resource_path), Resource)
        candidate_id = str(getattr(candidate, "uid", ""))
        if candidate_id in target_ids and resource_path != "objects/object/dsg-scene-cube.apx":
            processed.add(candidate_id)
            pending.append((candidate_id, resource_path, candidate, owned_resource_paths(candidate)))
    except Exception:
        pass
for collection_name in ${quote(deleteCollectionNames)}:
    typed_collection = collection_name
    collection = getattr(stage, collection_name, [])
    for candidate in collection:
        try:
            candidate_id = str(getattr(candidate, "uid", ""))
            path = str(getattr(candidate, "path", ""))
        except Exception:
            continue
        if candidate_id in processed or candidate_id not in target_ids or path == "objects/object/dsg-scene-cube.apx":
            continue
        processed.add(candidate_id)
        if not path:
            skipped.append(candidate_id)
            continue
        pending.append((candidate_id, path, candidate, owned_resource_paths(candidate)))
detached = []
for candidate_id, path, candidate, owned_paths in pending:
    try:
        try:
            if candidate.isInActiveStage():
                candidate.remove()
        except Exception:
            candidate.remove()
        detached.append((candidate_id, path, candidate, owned_paths))
    except Exception as error:
        skipped.append("detach " + candidate_id + ": " + str(error))
stage_saved = True
try:
    stage.save()
except Exception as error:
    stage_saved = False
    skipped.append("stage save: " + str(error))
for candidate_id, path, candidate, owned_paths in (detached if stage_saved else []):
    try:
        candidate.saveOnDelete()
        for owned_path in owned_paths:
            resourceManager.remove(owned_path)
        resourceManager.remove(path)
        deleted.append(candidate_id)
    except Exception as error:
        skipped.append(candidate_id + ": " + str(error))
return json.dumps({"deleted": deleted, "skipped": skipped})`;
  }

  function liveDescriptorKey(pluginId, field) { return `${pluginId}:${field}`; }
  function liveUidExpression(designerId) {
    try {
      const uid = BigInt(String(designerId).trim());
      if (uid < BigInt(0)) return null;
      return `getByUID(0x${uid.toString(16)})`;
    } catch { return null; }
  }
  function liveObjectPath(designerId, payload, record) {
    const uidExpression = liveUidExpression(designerId);
    if (uidExpression) return uidExpression;
    const sourcePath = String(record?.path || resourcePath(payload));
    const parts = sourcePath.split(/[\\/]/); const folder = parts.length > 1 ? parts[parts.length - 2] : typeResourceFolders[payload.type];
    const sourceName = (parts[parts.length - 1] || String(payload.name || payload.pluginId)).replace(/\.apx$/i, "");
    const identifier = sourceName.replace(/[^A-Za-z0-9_]/g, "_");
    return `${folder}:${identifier}`;
  }
  function liveFieldValue(payload, field) {
    if (field === "name") return payload.name;
    return field.split(".").reduce((value, key) => value?.[key], payload);
  }
  function liveDefinitions(payload) {
    const type = payload.type;
    const definitions = [{ field: "name", property: "object.description", encode: value => String(value ?? ""), decode: value => String(value ?? ""), writable: false }];
    const add = (field, property, encode = value => value, decode = value => value, writable = true) => definitions.push({ field, property, encode, decode, writable });
    if (type === "projector") {
      // These coupled vectors must not pass through transient mixed states.
      add("transform.position", "object.configPosition");
      add("lookAt", "object.configLookAt");
      add("optics.throwRatio", "object.configThrowRatio", value => { const numeric = Number(value); return Number.isFinite(numeric) ? Math.max(.1, numeric) : 1.5; }, value => Number(value));
      add("optics.fieldOfView", "object.fieldOfView", value => Number(value), value => Number(value), false);
      add("optics.lookDistance", "object.configLookDistance", value => Number(value), value => Number(value), false);
    } else {
      ["x", "y", "z"].forEach(axis => add(`transform.position.${axis}`, `object.offset.${axis}`));
    }
    if (["screen", "dmxScreen", "surface"].includes(type)) {
      add("geometry.width", "object.scale.x"); add("geometry.height", "object.scale.y", value => value, value => value);
      add("transform.position.y", "object.offset.y", value => Number(value) + Number(payload.geometry?.height || 0) / 2, value => Number(value) - Number(payload.geometry?.height || 0) / 2);
      add("transform.rotation.y", "object.rotation.y");
    } else if (type !== "projector") {
      ["x", "y", "z"].forEach(axis => add(`transform.rotation.${axis}`, `object.rotation.${axis}`));
    }
    return definitions;
  }
  function liveSend(message) {
    if (!liveSocket || liveSocket.readyState !== 1) return false;
    try { liveSocket.send(JSON.stringify(message)); liveLog(Object.keys(message)[0] || "send", message); return true; } catch (error) { liveLog("error", { phase: "send", message: error.message || String(error) }); liveOnStatus({ status: "error", detail: error.message || String(error) }); return false; }
  }
  function liveFlushSets() {
    const changes = [];
    for (const binding of liveBindings.values()) {
      if (binding.id === null || binding.desired === undefined || !binding.initialized || binding.writable === false || !binding.dirty || binding.inFlight !== undefined) continue;
      changes.push({ id: binding.id, value: binding.desired });
      binding.inFlight = binding.desired;
    }
    if (changes.length) liveSend({ set: changes });
  }
  function liveUnsubscribe(ids) {
    const validIds = ids.filter(id => Number.isInteger(id));
    if (validIds.length === 1) liveSend({ unsubscribe: { id: validIds[0] } });
    else if (validIds.length > 1) liveSend({ unsubscribe: { ids: validIds } });
  }
  function liveResetSubscriptionIds() {
    livePendingSubscriptions.clear();
    for (const binding of liveBindings.values()) { binding.id = null; binding.initialized = false; binding.inFlight = undefined; }
    for (const binding of liveSceneBindings.values()) { binding.id = null; binding.initialized = false; }
    liveSceneReady = false;
  }
  function configureLiveScene(stageId) {
    const nextStageId = stageId ? String(stageId) : null;
    if (nextStageId === liveStageId && liveSceneBindings.size) return;
    liveUnsubscribe([...liveSceneBindings.values()].map(binding => binding.id));
    liveStageId = nextStageId;
    liveSceneBindings = new Map();
    liveSceneReady = false;
    if (liveSocket?.readyState === 1) liveSubscribeScene();
  }
  function liveSubscribeScene() {
    if (!liveSocket || liveSocket.readyState !== 1 || !liveStageId) return;
    const stagePath = liveUidExpression(liveStageId);
    if (!stagePath) return;
    const collections = ["ledScreens", "dmxScreens", "dmxLights", "surfaces", "projectors", "cameras"];
    const properties = collections.map(collection => `object.${collection}`);
    collections.forEach((collection, index) => liveSceneBindings.set(collection, { collection, objectPath: stagePath, propertyPath: properties[index], id: null, initialized: false, writable: false }));
    liveSend({ subscribe: { object: stagePath, properties } });
  }
  function liveHandleMessage(raw) {
    let message;
    try { message = JSON.parse(typeof raw === "string" ? raw : raw?.data || "{}"); } catch { return; }
    liveLog("message", { keys: Object.keys(message), subscriptions: message.subscriptions?.length || 0, valuesChanged: message.valuesChanged?.length || 0, values: Array.isArray(message.valuesChanged) ? message.valuesChanged.slice(0, 50).map(change => { const binding = [...liveBindings.values()].find(candidate => candidate.id === change.id); return { id: change.id, value: change.value, pluginId: binding?.pluginId || null, field: binding?.field || null, property: binding?.propertyPath || null }; }) : [], error: message.error || null });
    if (Array.isArray(message.subscriptions)) {
      message.subscriptions.forEach(subscription => {
        const sceneBinding = [...liveSceneBindings.values()].find(candidate => candidate.id === subscription.id || (candidate.objectPath === subscription.objectPath && candidate.propertyPath === subscription.propertyPath));
        if (sceneBinding) { sceneBinding.id = subscription.id; return; }
        const binding = [...liveBindings.values()].find(candidate => candidate.id === subscription.id || (candidate.objectPath === subscription.objectPath && candidate.propertyPath === subscription.propertyPath));
        if (!binding) return;
        const isNewSubscription = binding.id !== subscription.id;
        binding.id = subscription.id;
        // Resource.description is remote metadata.  Designer exposes it for
        // readback, but names are changed through Resource.rename, never by
        // Live Update set.
        binding.writable = binding.writable !== false && subscription.writable !== false;
        livePendingSubscriptions.delete(`${binding.objectPath}|${binding.propertyPath}`);
        if (isNewSubscription) liveLog("subscribed", { id: subscription.id, pluginId: binding.pluginId, field: binding.field, object: binding.objectPath, property: binding.propertyPath });
      });
    }
    if (Array.isArray(message.valuesChanged)) message.valuesChanged.forEach(change => {
      const sceneBinding = [...liveSceneBindings.values()].find(candidate => candidate.id === change.id);
      if (sceneBinding) {
        sceneBinding.initialized = true;
        if (liveSceneReady) liveOnSceneChanged({ collection: sceneBinding.collection, value: change.value });
        else if ([...liveSceneBindings.values()].every(candidate => candidate.initialized)) liveSceneReady = true;
        return;
      }
      const binding = [...liveBindings.values()].find(candidate => candidate.id === change.id);
      if (!binding) return;
      const wasInitialized = binding.initialized;
      const wasPending = binding.dirty || binding.inFlight !== undefined;
      binding.remote = change.value;
      binding.initialized = true;
      if (binding.desired === undefined) binding.desired = change.value;
      if (!wasInitialized) {
        binding.dirty = !liveValuesEqual(binding.desired, change.value);
        binding.inFlight = undefined;
        if (binding.writable === false) {
          // Read-only metadata is authoritative on first readback.  Do not
          // turn the planner's initial name into a failed Live Update write.
          binding.desired = change.value;
          binding.dirty = false;
          if (binding.field !== "name") liveOnValuesChanged({ pluginId: binding.pluginId, field: binding.field, value: binding.decode(change.value), property: binding.propertyPath });
        }
      } else if (liveValuesEqual(binding.desired, change.value)) {
        binding.dirty = false;
        binding.inFlight = undefined;
      } else if (binding.inFlight !== undefined && !liveValuesEqual(binding.inFlight, change.value)) {
        binding.inFlight = undefined;
        binding.dirty = true;
      } else if (!wasPending) {
        binding.desired = change.value;
        binding.dirty = false;
        liveOnValuesChanged({ pluginId: binding.pluginId, field: binding.field, value: binding.decode(change.value), property: binding.propertyPath });
      }
    });
    if (Array.isArray(message.valuesChanged)) liveFlushSets();
    if (message.error) {
      const detail = typeof message.error === "string" ? message.error : JSON.stringify(message.error);
      const staleId = Number(detail.match(/id\s+(\d+).*subscribed value is unavailable/i)?.[1]);
      const activeIds = new Set([...liveBindings.values(), ...liveSceneBindings.values()].map(binding => binding.id).filter(Number.isInteger));
      if (Number.isInteger(staleId) && !activeIds.has(staleId)) {
        liveLog("stale-subscription", { id: staleId, detail });
      } else if (/invalid\s+id|unknown\s+subscription|subscription.*id/i.test(detail)) {
        liveResetSubscriptionIds();
        liveLog("recover", { reason: detail });
        liveOnStatus({ status: "recovering", detail: `${detail}; resubscribing` });
        liveSubscribeBindings();
        liveSubscribeScene();
      } else {
        const failed = [];
        for (const binding of liveBindings.values()) {
          if (binding.inFlight === undefined) continue;
          failed.push({ id: binding.id, pluginId: binding.pluginId, field: binding.field, property: binding.propertyPath });
          binding.inFlight = undefined;
          binding.dirty = true;
        }
        liveLog("set-error", { detail, bindings: failed });
        liveOnStatus({ status: "error", detail });
      }
    }
  }
  function liveSubscribeBindings() {
    if (!liveSocket || liveSocket.readyState !== 1) return;
    const grouped = new Map();
    for (const binding of liveBindings.values()) {
      if (binding.id !== null) continue;
      const key = `${binding.objectPath}|${binding.propertyPath}`;
      if (livePendingSubscriptions.has(key)) continue;
      livePendingSubscriptions.add(key);
      const properties = grouped.get(binding.objectPath) || [];
      properties.push(binding.propertyPath); grouped.set(binding.objectPath, properties);
    }
    grouped.forEach((properties, object) => liveSend({ subscribe: { object, properties } }));
  }
  function liveSync(entries = []) {
    const socketOpen = Boolean(liveSocket && liveSocket.readyState === 1);
    const nextBindings = new Map();
    entries.forEach(entry => {
      const payload = entry?.payload || entry;
      const designerId = entry?.record?.designerId || entry?.designerId;
      if (!payload?.pluginId || !designerId) return;
      const objectPath = liveObjectPath(designerId, payload, entry?.record);
      liveDefinitions(payload).forEach(definition => {
        const key = liveDescriptorKey(payload.pluginId, definition.field);
        const previous = liveBindings.get(key);
        const desired = definition.encode(liveFieldValue(payload, definition.field));
        const unchangedDesired = previous?.desired !== undefined && liveValuesEqual(previous.desired, desired);
        nextBindings.set(key, { ...(previous || {}), ...definition, key, pluginId: payload.pluginId, objectPath, propertyPath: definition.property, id: previous?.id ?? null, desired, dirty: previous?.initialized ? !liveValuesEqual(previous.remote, desired) : false, inFlight: unchangedDesired ? previous?.inFlight : undefined, writable: definition.writable !== false && previous?.writable !== false });
      });
    });
    const removedIds = [...liveBindings.values()].filter(binding => binding.id !== null && !nextBindings.has(binding.key)).map(binding => binding.id);
    liveUnsubscribe(removedIds);
    liveBindings = nextBindings;
    liveSubscribeBindings();
    liveFlushSets();
    return socketOpen && Boolean(liveSocket && liveSocket.readyState === 1);
  }
  function liveScheduleReconnect(reason = "connection closed") {
    if (!liveWanted || liveReconnectTimer) return;
    const delay = Math.min(5000, 250 * (2 ** Math.min(liveReconnectAttempt, 5)));
    liveReconnectAttempt += 1;
    liveLog("reconnect", { delay, reason, attempt: liveReconnectAttempt });
    liveOnStatus({ status: "reconnecting", detail: `${reason}; retrying in ${delay}ms` });
    liveReconnectTimer = setTimeout(() => { liveReconnectTimer = null; liveOpenSocket(); }, delay);
  }
  function liveOpenSocket(resolveStart) {
    if (!liveWanted || typeof WebSocket !== "function") return;
    let opened = false;
    const generation = ++liveSocketGeneration;
    liveLog("connect", { url: LIVE_URL, attempt: liveReconnectAttempt + 1 });
    let socket;
    try { socket = new WebSocket(LIVE_URL); } catch (error) { liveLog("error", { phase: "constructor", message: error.message || String(error) }); resolveStart?.(); liveScheduleReconnect(error.message || String(error)); return; }
    liveSocket = socket;
    socket.onopen = () => {
      if (generation !== liveSocketGeneration || socket !== liveSocket) return;
      opened = true; liveReconnectAttempt = 0; liveConnectPromise = null;
      liveLog("open", { url: LIVE_URL }); liveOnStatus({ status: "open", detail: LIVE_URL });
      liveResetSubscriptionIds(); liveSubscribeScene(); liveSubscribeBindings(); liveFlushSets(); resolveStart?.();
    };
    socket.onmessage = event => { if (generation === liveSocketGeneration) liveHandleMessage(event.data); };
    socket.onerror = () => {
      const detail = `Live Update WebSocket connection failed: ${LIVE_URL}`;
      liveLog("error", { phase: "socket", message: detail }); liveOnStatus({ status: "error", detail });
      if (!opened) { liveConnectPromise = null; resolveStart?.(); liveScheduleReconnect(detail); }
    };
    socket.onclose = event => {
      if (generation !== liveSocketGeneration) return;
      liveSocket = null; liveResetSubscriptionIds(); liveConnectPromise = null;
      const detail = `Live Update connection closed (code ${event.code}${event.reason ? `: ${event.reason}` : ""})`;
      liveLog("close", { code: event.code, reason: event.reason || "" });
      if (liveWanted) liveScheduleReconnect(detail); else liveOnStatus({ status: "closed", detail });
    };
  }
  function liveStart(callbacks = {}) {
    liveOnStatus = callbacks.onStatus || (() => {}); liveOnValuesChanged = callbacks.onValuesChanged || (() => {}); liveOnSceneChanged = callbacks.onSceneChanged || (() => {});
    liveWanted = true;
    if (liveSocket?.readyState === 1) return Promise.resolve();
    if (liveConnectPromise) return liveConnectPromise;
    if (typeof WebSocket !== "function") { liveWanted = false; liveLog("error", { phase: "support", message: "WebSocket is not available in this plugin window" }); return Promise.reject(new Error("WebSocket is not available in this plugin window")); }
    liveConnectPromise = new Promise(resolve => liveOpenSocket(resolve));
    return liveConnectPromise;
  }
  function liveStop() {
    liveWanted = false; liveReconnectAttempt = 0; if (liveReconnectTimer) { clearTimeout(liveReconnectTimer); liveReconnectTimer = null; }
    liveUnsubscribe([...liveBindings.values(), ...liveSceneBindings.values()].map(binding => binding.id));
    liveSocketGeneration += 1;
    if (liveSocket) { try { liveSocket.close(); } catch {} }
    liveSocket = null; liveConnectPromise = null; liveResetSubscriptionIds(); liveBindings = new Map(); liveSceneBindings = new Map(); liveOnStatus({ status: "closed", detail: "Live Update disabled" });
  }

  window.disguiseSceneAdapter = {
    capabilities: { liveUpdate: true, liveTransport: "websocket", httpSync: true, selectiveDelete: true, readback: true, source: "Designer Python API + Live Update WebSocket", apiOrigin: API_ORIGIN, liveUrl: LIVE_URL, director: API_ORIGIN },
    sessionStatus,
    syncEnvironment: environment => execute(environmentScript(environment)),
    inspectScene: () => execute(inspectScript()),
    createObject: payload => execute(createScript(payload)),
    updateObject: (designerId, changed, designerPath, kind) => execute(updateScript(designerId, changed, designerPath, kind)),
    projectorReadbackProbe: designerId => execute(projectorProbeScript(designerId)),
    deleteObjects: designerIds => execute(deleteScript(designerIds)),
    deleteManagedObjects: designerIds => execute(deleteManagedScript(designerIds)),
    configureLiveScene,
    liveStart,
    liveStop,
    liveSync,
    getLiveState: () => ({
      wanted: liveWanted,
      socket: liveSocket?.readyState === 1 ? "open" : liveSocket ? "connecting" : "closed",
      reconnectAttempt: liveReconnectAttempt,
      bindings: [...liveBindings.values()].map(binding => ({
        pluginId: binding.pluginId,
        field: binding.field,
        id: binding.id,
        remote: binding.remote,
        desired: binding.desired,
        dirty: Boolean(binding.dirty),
        inFlight: binding.inFlight,
        initialized: Boolean(binding.initialized),
        writable: binding.writable !== false
      }))
    }),
    getLiveLogs: () => liveLogEntries.slice(),
    clearLiveLogs: () => { liveLogEntries.length = 0; },
    debugScripts: { inspectScript, createScript, updateScript, projectorProbeScript, deleteManagedScript }
  };
})();
