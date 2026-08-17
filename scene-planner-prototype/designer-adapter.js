(() => {
  const localTest = ["127.0.0.1", "localhost"].includes(window.location.hostname) && window.location.port;
  const API_ORIGIN = window.DISGUISE_API_ORIGIN || (localTest ? "http://127.0.0.1" : window.location.origin);
  const EXECUTE_PATH = "/api/session/python/execute";
  const STATUS_PATH = "/api/session/status/session";
  const typeCollections = { screen: "ledScreens", surface: "surfaces", camera: "cameras", projector: "projectors", light: "lights" };
  const typeClasses = { screen: "LedScreen", surface: "Screen2", camera: "VirtualCamera", projector: "Projector", light: "Light" };
  const typeResourceFolders = { screen: "ledscreen", surface: "screen2", camera: "virtualcamera", projector: "projector", light: "light" };
  const collectionTypes = Object.fromEntries(Object.entries(typeCollections).map(([type, collection]) => [collection, type]));

  function quote(value) { return JSON.stringify(value); }
  function payloadText(payload) { return quote(JSON.stringify(payload)); }
  function parseReturnValue(value) {
    if (typeof value !== "string") return value;
    try { const parsed = JSON.parse(value); return typeof parsed === "string" ? JSON.parse(parsed) : parsed; } catch { return value; }
  }
  async function execute(script) {
    let response;
    try { response = await fetch(`${API_ORIGIN}${EXECUTE_PATH}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ script }) }); }
    catch (error) { throw new Error(`Нет соединения с Designer API по адресу ${API_ORIGIN}. Проверьте, что Designer запущен, а v2rayN обходит localhost. ${error.message || error}`); }
    const responseText = await response.text();
    if (!response.ok) throw new Error(`Designer API HTTP ${response.status}: ${responseText.slice(0, 800) || "пустой ответ"}`);
    let body;
    try { body = JSON.parse(responseText); } catch { throw new Error(`Designer API вернул не-JSON ответ: ${responseText.slice(0, 800)}`); }
    if (body.status && body.status.code !== 0) throw new Error(body.status.message || "Designer отклонил Python-команду");
    return parseReturnValue(body.returnValue);
  }
  async function sessionStatus() { const response = await fetch(`${API_ORIGIN}${STATUS_PATH}`); if (!response.ok) throw new Error(`Designer session status: HTTP ${response.status}`); return response.json(); }

  function readbackHelpers() {
    return `def vec_data(value):
    return {"x": float(value.x), "y": float(value.y), "z": float(value.z)}
def readback(obj, kind):
    if kind in ["screen", "surface"]:
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
        return {"transform": {"position": vec_data(obj.configPosition), "rotation": vec_data(obj.configRotation)}}
    if kind == "camera":
        return {"transform": {"position": vec_data(obj.posRelativeOrGlobal), "rotation": vec_data(obj.rotRelativeOrGlobal)}}
    return {"transform": {"position": vec_data(obj.offset), "rotation": vec_data(obj.rotation)}}`;
  }
  function assignHelpers() {
    return `def assign(field, value):
    try:
        setattr(obj, field, value)
    except Exception as error:
        raise RuntimeError("Cannot set {} on {} at {}: {}".format(field, type(obj).__name__, object_path, error))`;
  }
  function inspectScript() {
    return `import json
import re
stage = state.stage
objects = []
warnings = []
collection_types = ${quote(collectionTypes)}
${readbackHelpers()}
for collection_name in ${quote(Object.values(typeCollections))}:
    collection = getattr(stage, collection_name, [])
    for obj in collection:
        try:
            uid = str(getattr(obj, "uid", ""))
            if not uid:
                warnings.append(collection_name + ": empty object reference")
                continue
            path = str(getattr(obj, "path", ""))
            description = str(getattr(obj, "description", ""))
            text = (path + " " + description).lower()
            match = re.search(r"dsg-(.+?)\\.apx", path, re.IGNORECASE)
            standard = bool(re.search(r"(^|[/\\\\ _-])(surface|projector|camera|screen|light)[ _-]?1(?:\\.|$)", text))
            kind = collection_types[collection_name]
            objects.append({
                "id": uid, "path": path, "description": description, "collection": collection_name, "type": kind,
                "managed": "dsg-" in path.lower(), "pluginId": match.group(1) if match else None, "standard": standard,
                "transform": readback(obj, kind)["transform"], "geometry": readback(obj, kind).get("geometry")
            })
        except Exception as error:
            warnings.append(collection_name + ": " + str(error))
floor = getattr(stage, "floor_pos", None)
floor_y = float(floor.y) if floor is not None else 0.0
return json.dumps({"objects": objects, "floorY": floor_y, "warnings": warnings})`;
  }
  function createScript(payload) {
    return `import json
payload = json.loads(${payloadText(payload)})
stage = state.stage
kind = payload["type"]
object_path = "objects/" + ${quote(typeResourceFolders[payload.type])} + "/dsg-" + payload["pluginId"] + ".apx"
obj = resourceManager.loadOrCreate(object_path, ${typeClasses[payload.type]})
transform = payload["transform"]
pos = transform["position"]
rot = transform["rotation"]
markDirty(obj)
${assignHelpers()}
if kind in ["screen", "surface"]:
    geometry = payload["geometry"]
    assign("offset", Vec(pos["x"], pos["y"] + geometry["height"] / 2.0, pos["z"]))
    assign("scale", Vec(geometry["width"], geometry["height"], 0.1))
    assign("rotation", Vec(0.0, rot["y"], 0.0))
elif kind == "projector":
    position_value = Vec(pos["x"], pos["y"], pos["z"])
    rotation_value = Vec(rot["x"], rot["y"], rot["z"])
    assign("configPosition", position_value)
    assign("configRotation", rotation_value)
    assign("offset", position_value)
    assign("rotation", rotation_value)
elif kind == "camera":
    assign("posRelativeOrGlobal", Vec(pos["x"], pos["y"], pos["z"]))
    assign("rotRelativeOrGlobal", Vec(rot["x"], rot["y"], rot["z"]))
else:
    assign("offset", Vec(pos["x"], pos["y"], pos["z"]))
    assign("rotation", Vec(rot["x"], rot["y"], rot["z"]))
collection = getattr(stage, ${quote(typeCollections[payload.type])})
if obj not in collection:
    collection.append(obj)
obj.save()
${readbackHelpers()}
return json.dumps({"designerId": str(obj.uid), "path": object_path, "readback": readback(obj, kind)})`;
  }
  function updateScript(designerId, changed, designerPath, kind) {
    return `import json
target_id = ${quote(String(designerId))}
target_path = ${quote(String(designerPath || ""))}
kind = ${quote(kind)}
changed = json.loads(${payloadText(changed)})
stage = state.stage
obj = None
for collection_name in ${quote(Object.values(typeCollections))}:
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
transform_change = changed.get("transform", {})
position_change = transform_change.get("position", {})
rotation_change = transform_change.get("rotation", {})
if kind in ["screen", "surface"]:
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
    current_rot = obj.configRotation
    if position_change:
        value = Vec(position_change.get("x", current_pos.x), position_change.get("y", current_pos.y), position_change.get("z", current_pos.z))
        assign("configPosition", value)
        assign("offset", value)
    if rotation_change:
        value = Vec(rotation_change.get("x", current_rot.x), rotation_change.get("y", current_rot.y), rotation_change.get("z", current_rot.z))
        assign("configRotation", value)
        assign("rotation", value)
elif kind == "camera":
    current_pos = obj.posRelativeOrGlobal
    current_rot = obj.rotRelativeOrGlobal
    if position_change:
        assign("posRelativeOrGlobal", Vec(position_change.get("x", current_pos.x), position_change.get("y", current_pos.y), position_change.get("z", current_pos.z)))
    if rotation_change:
        assign("rotRelativeOrGlobal", Vec(rotation_change.get("x", current_rot.x), rotation_change.get("y", current_rot.y), rotation_change.get("z", current_rot.z)))
else:
    current_pos = obj.offset
    current_rot = obj.rotation
    if position_change:
        assign("offset", Vec(position_change.get("x", current_pos.x), position_change.get("y", current_pos.y), position_change.get("z", current_pos.z)))
    if rotation_change:
        assign("rotation", Vec(rotation_change.get("x", current_rot.x), rotation_change.get("y", current_rot.y), rotation_change.get("z", current_rot.z)))
obj.save()
${readbackHelpers()}
return json.dumps({"designerId": str(obj.uid), "path": object_path, "readback": readback(obj, kind)})`;
  }
  function deleteScript(designerIds) {
    return `import json
import re
target_ids = set(json.loads(${payloadText(designerIds.map(String))}))
stage = state.stage
deleted = []
skipped = []
for collection_name in ${quote(Object.values(typeCollections))}:
    collection = getattr(stage, collection_name, [])
    for candidate in list(collection):
        try:
            candidate_id = str(getattr(candidate, "uid", ""))
        except Exception:
            continue
        if candidate_id not in target_ids:
            continue
        path = str(getattr(candidate, "path", ""))
        description = str(getattr(candidate, "description", ""))
        text = (path + " " + description).lower()
        standard = bool(re.search(r"(^|[/\\\\ _-])(surface|projector|camera|screen|light)[ _-]?1(?:\\.|$)", text))
        if "dsg-" in path.lower() or not standard:
            skipped.append(candidate_id)
            continue
        collection.remove(candidate)
        deleted.append(candidate_id)
return json.dumps({"deleted": deleted, "skipped": skipped})`;
  }

  window.disguiseSceneAdapter = {
    capabilities: { liveUpdate: true, selectiveDelete: true, readback: true, source: "Designer Python API", apiOrigin: API_ORIGIN },
    sessionStatus,
    inspectScene: () => execute(inspectScript()),
    createObject: payload => execute(createScript(payload)),
    updateObject: (designerId, changed, designerPath, kind) => execute(updateScript(designerId, changed, designerPath, kind)),
    deleteObjects: designerIds => execute(deleteScript(designerIds)),
    debugScripts: { inspectScript, createScript, updateScript }
  };
})();
