(() => {
  const localTest = ["127.0.0.1", "localhost"].includes(window.location.hostname) && window.location.port;
  const API_ORIGIN = window.DISGUISE_API_ORIGIN || (localTest ? "http://127.0.0.1" : window.location.origin);
  const EXECUTE_PATH = "/api/session/python/execute";
  const STATUS_PATH = "/api/session/status/session";
  const typeCollections = { screen: "ledScreens", surface: "surfaces", camera: "cameras", projector: "projectors", light: "lights" };
  const typeClasses = { screen: "LedScreen", surface: "Screen2", camera: "VirtualCamera", projector: "Projector", light: "Light" };
  const collectionTypes = Object.fromEntries(Object.entries(typeCollections).map(([type, collection]) => [collection, type]));

  function quote(value) { return JSON.stringify(value); }
  function payloadText(payload) { return quote(JSON.stringify(payload)); }
  function parseReturnValue(value) {
    if (typeof value !== "string") return value;
    try { const parsed = JSON.parse(value); return typeof parsed === "string" ? JSON.parse(parsed) : parsed; } catch { return value; }
  }
  async function execute(script) {
    let response;
    try {
      response = await fetch(`${API_ORIGIN}${EXECUTE_PATH}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ script }) });
    } catch (error) {
      throw new Error(`Нет соединения с Designer API по адресу ${API_ORIGIN}. Проверьте, что Designer запущен, а v2rayN обходит localhost. ${error.message || error}`);
    }
    if (!response.ok) throw new Error(`Designer API ответил HTTP ${response.status}`);
    const body = await response.json();
    if (body.status && body.status.code !== 0) throw new Error(body.status.message || "Designer отклонил Python-команду");
    return parseReturnValue(body.returnValue);
  }
  async function sessionStatus() {
    const response = await fetch(`${API_ORIGIN}${STATUS_PATH}`);
    if (!response.ok) throw new Error(`Designer session status: HTTP ${response.status}`);
    return response.json();
  }
  function inspectScript() {
    return `import json
import re
stage = state.stage
objects = []
collection_types = ${quote(collectionTypes)}
for collection_name in ${quote(Object.values(typeCollections))}:
    collection = getattr(stage, collection_name, [])
    for obj in collection:
        path = str(getattr(obj, "path", ""))
        description = str(getattr(obj, "description", ""))
        text = (path + " " + description).lower()
        match = re.search(r"dsg-(.+?)\\.apx", path, re.IGNORECASE)
        standard = bool(re.search(r"(^|[/\\\\ _-])(surface|projector|camera|screen|light)[ _-]?1(?:\\.|$)", text))
        objects.append({
            "id": str(obj.uid),
            "path": path,
            "description": description,
            "collection": collection_name,
            "type": collection_types[collection_name],
            "managed": "dsg-" in path.lower(),
            "pluginId": match.group(1) if match else None,
            "standard": standard
        })
floor = getattr(stage, "floor_pos", None)
floor_y = float(floor.y) if floor is not None else 0.0
return json.dumps({"objects": objects, "floorY": floor_y})`;
  }
  function createScript(payload) {
    return `import json
payload = json.loads(${payloadText(payload)})
stage = state.stage
kind = payload["type"]
path = "objects/" + kind + "/dsg-" + payload["pluginId"] + ".apx"
obj = resourceManager.loadOrCreate(path, ${typeClasses[payload.type]})
pos = payload["position"]
rot = payload["rotation"]
obj.offset = Vec(pos["x"], pos["y"], pos["z"])
obj.rotation = Vec(rot["x"], rot["y"], rot["z"])
if kind in ["screen", "surface"]:
    dims = payload["dimensions"]
    obj.scale = Vec(dims["width"], dims["thickness"], dims["height"])
try:
    obj.description = payload["name"]
except Exception:
    pass
collection = getattr(stage, ${quote(typeCollections[payload.type])})
if obj not in collection:
    collection.append(obj)
return json.dumps({"designerId": str(obj.uid), "path": path})`;
  }
  function updateScript(designerId, changed) {
    return `import json
target_id = ${quote(String(designerId))}
changed = json.loads(${payloadText(changed)})
stage = state.stage
obj = None
for collection_name in ${quote(Object.values(typeCollections))}:
    for candidate in getattr(stage, collection_name, []):
        if str(candidate.uid) == target_id:
            obj = candidate
            break
    if obj is not None:
        break
if obj is None:
    raise ValueError("Объект Designer с uid не найден: " + target_id)
if "position" in changed:
    pos = changed["position"]
    current = obj.offset
    obj.offset = Vec(pos.get("x", current.x), pos.get("y", current.y), pos.get("z", current.z))
if "rotation" in changed:
    rot = changed["rotation"]
    current = obj.rotation
    obj.rotation = Vec(rot.get("x", current.x), rot.get("y", current.y), rot.get("z", current.z))
if "dimensions" in changed:
    dims = changed["dimensions"]
    current = obj.scale
    width = dims.get("width", current.x)
    thickness = dims.get("thickness", current.y)
    height = dims.get("height", current.z)
    if width and height:
        obj.scale = Vec(width, thickness, height)
if "name" in changed:
    try:
        obj.description = changed["name"]
    except Exception:
        pass
return json.dumps({"designerId": target_id, "path": str(getattr(obj, "path", ""))})`;
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
        candidate_id = str(candidate.uid)
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
    capabilities: { liveUpdate: true, selectiveDelete: true, source: "Designer Python API", apiOrigin: API_ORIGIN },
    sessionStatus,
    inspectScene: () => execute(inspectScript()),
    createObject: payload => execute(createScript(payload)),
    updateObject: (designerId, changed) => execute(updateScript(designerId, changed)),
    deleteObjects: designerIds => execute(deleteScript(designerIds))
  };
})();
