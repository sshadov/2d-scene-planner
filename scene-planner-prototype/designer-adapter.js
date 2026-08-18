(() => {
  const localTest = ["127.0.0.1", "localhost"].includes(window.location.hostname) && window.location.port;
  const API_ORIGIN = window.DISGUISE_API_ORIGIN || (localTest ? "http://127.0.0.1" : window.location.origin);
  const EXECUTE_PATH = "/api/session/python/execute";
  const STATUS_PATH = "/api/session/status/session";
  const LIVE_PATH = "/api/session/liveupdate";
  const LIVE_URL = `${API_ORIGIN.replace(/^http/i, "ws")}${LIVE_PATH}`;
  const typeCollections = { screen: "ledScreens", surface: "surfaces", camera: "cameras", projector: "projectors", light: "lights", designer: "displays" };
  const typeClasses = { screen: "LedScreen", surface: "Screen2", camera: "Camera", projector: "Projector", light: "Light" };
  const typeResourceFolders = { screen: "ledscreen", surface: "screen2", camera: "camera", projector: "projector", light: "light" };
  const collectionTypes = Object.fromEntries(Object.entries(typeCollections).map(([type, collection]) => [collection, type]));
  let liveSocket = null;
  let liveConnectPromise = null;
  let liveBindings = new Map();
  let livePendingSubscriptions = new Set();
  let liveOnStatus = () => {};
  let liveOnValuesChanged = () => {};

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
return json.dumps({"roomFloor": {"width": float(floor_size.x), "depth": float(floor_size.y)} if floor_size is not None else {"width": float(${Number(environment.room.width)}), "depth": float(${Number(environment.room.depth)})}, "floorY": float(stage.floor_pos.y), "sceneEnabled": scene_enabled, "sceneCube": {"designerId": str(scene_obj.uid), "path": scene_path} if scene_obj is not None else None})`;
  }

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
        # Preserve the actual Designer optical rotation when the build exposes it.
        config_rotation = getattr(obj, "configRotation", None)
        if config_rotation is None:
            config_rotation = getattr(obj, "rotation", None)
        return {"transform": {"position": vec_data(obj.configPosition), "rotation": vec_data(config_rotation) if config_rotation is not None else {"x": 0.0, "y": 0.0, "z": 0.0}}, "lookAt": vec_data(obj.configLookAt)}
    if kind == "camera":
        return {"transform": {"position": vec_data(obj.offset), "rotation": vec_data(obj.rotation)}}
    position = getattr(obj, "offset", None)
    rotation = getattr(obj, "rotation", None)
    if position is None:
        return {"transform": {"position": {"x": 0.0, "y": 0.0, "z": 0.0}, "rotation": {"x": 0.0, "y": 0.0, "z": 0.0}}}
    return {"transform": {"position": vec_data(position), "rotation": vec_data(rotation) if rotation is not None else {"x": 0.0, "y": 0.0, "z": 0.0}}}`;
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
seen_ids = set()
class_types = {"LedScreen": "screen", "Screen2": "surface", "Camera": "camera", "Projector": "projector", "Light": "light"}
supported_classes = set(["LedScreen", "Screen2", "Camera", "Projector", "Light", "Object", "ObjectBox", "Prop"])
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
                "transform": data["transform"], "geometry": data.get("geometry"), "lookAt": data.get("lookAt")
            })
        except Exception as error:
            warnings.append(collection_name + ": " + str(error))
floor = getattr(stage, "floor_pos", None)
floor_y = float(floor.y) if floor is not None else 0.0
floor_size = getattr(stage, "floor_size", None)
return json.dumps({"objects": objects, "floorY": floor_y, "floorPosition": vec_data(floor) if floor is not None else {"x": 0.0, "y": 0.0, "z": 0.0}, "roomFloor": {"width": float(floor_size.x), "depth": float(floor_size.y)} if floor_size is not None else None, "warnings": warnings, "sceneCube": scene_cube})`;
  }
  function createScript(payload) {
    return `import json
payload = json.loads(${payloadText(payload)})
stage = state.stage
kind = payload["type"]
object_path = ${quote(resourcePath(payload))}
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
    assign("configPosition", position_value)
    look_at = payload.get("lookAt", {"x": pos["x"], "y": pos["y"], "z": pos["z"]})
    assign("configLookAt", Vec(look_at["x"], look_at["y"], look_at["z"]))
elif kind == "camera":
    assign("offset", Vec(pos["x"], pos["y"], pos["z"]))
    assign("rotation", Vec(rot["x"], rot["y"], rot["z"]))
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
import re
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
        try:
            assign("path", desired_path)
            object_path = desired_path
        except Exception as error:
            raise RuntimeError("Cannot rename Designer resource to {}: {}".format(desired_path, error))
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
    if position_change:
        value = Vec(position_change.get("x", current_pos.x), position_change.get("y", current_pos.y), position_change.get("z", current_pos.z))
        assign("configPosition", value)
    look_change = changed.get("lookAt", {})
    if look_change:
        current_look = obj.configLookAt
        value = Vec(look_change.get("x", current_look.x), look_change.get("y", current_look.y), look_change.get("z", current_look.z))
        assign("configLookAt", value)
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
return json.dumps({"designerId": str(obj.uid), "path": object_path, "readback": readback(obj, kind)})`;
  }
  function deleteScript(designerIds) {
    return `import json
import re
target_ids = set(json.loads(${payloadText(designerIds.map(String))}))
stage = state.stage
deleted = []
skipped = []
for collection_name in ${quote([...new Set([...Object.values(typeCollections), "children"])])}:
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
        resource_path = str(getattr(candidate, "path", ""))
        if not resource_path:
            skipped.append(candidate_id)
            continue
        try:
            candidate.saveOnDelete()
            resourceManager.remove(resource_path)
            try:
                collection.remove(candidate)
            except Exception:
                pass
            deleted.append(candidate_id)
        except Exception as error:
            warnings = "delete " + candidate_id + ": " + str(error)
            skipped.append(warnings)
return json.dumps({"deleted": deleted, "skipped": skipped})`;
  }

  function liveDescriptorKey(pluginId, field) { return `${pluginId}:${field}`; }
  function liveObjectPath(designerId) { return `getByUID(${quote(String(designerId))})`; }
  function liveFieldValue(payload, field) {
    if (field === "name") return payload.name;
    if (field === "transform.position.y" && ["screen", "surface"].includes(payload.type)) return Number(payload.transform.position.y) + Number(payload.geometry?.height || 0) / 2;
    return field.split(".").reduce((value, key) => value?.[key], payload);
  }
  function liveDefinitions(payload) {
    const type = payload.type;
    const definitions = [{ field: "name", property: "object.description", encode: value => String(value ?? ""), decode: value => String(value ?? "") }];
    const add = (field, property, encode = value => value, decode = value => value) => definitions.push({ field, property, encode, decode });
    const transformPrefix = type === "projector" ? "configPosition" : "offset";
    ["x", "y", "z"].forEach(axis => add(`transform.position.${axis}`, `object.${transformPrefix}.${axis}`));
    if (["screen", "surface"].includes(type)) {
      add("geometry.width", "object.scale.x"); add("geometry.height", "object.scale.y", value => value, value => value);
      add("transform.position.y", "object.offset.y", value => Number(value) + Number(payload.geometry?.height || 0) / 2, value => Number(value) - Number(payload.geometry?.height || 0) / 2);
      add("transform.rotation.y", "object.rotation.y");
    } else if (type === "projector") {
      ["x", "y", "z"].forEach(axis => add(`lookAt.${axis}`, `object.configLookAt.${axis}`));
    } else {
      ["x", "y", "z"].forEach(axis => add(`transform.rotation.${axis}`, `object.rotation.${axis}`));
    }
    return definitions;
  }
  function liveSend(message) {
    if (!liveSocket || liveSocket.readyState !== 1) return false;
    try { liveSocket.send(JSON.stringify(message)); return true; } catch (error) { liveOnStatus({ status: "error", detail: error.message || String(error) }); return false; }
  }
  function liveFlushSets() {
    const changes = [];
    for (const binding of liveBindings.values()) {
      if (binding.id === null || binding.value === undefined) continue;
      if (binding.lastSent !== undefined && JSON.stringify(binding.lastSent) === JSON.stringify(binding.value)) continue;
      changes.push({ id: binding.id, value: binding.value });
      binding.lastSent = binding.value;
    }
    if (changes.length) liveSend({ set: changes });
  }
  function liveHandleMessage(raw) {
    let message;
    try { message = JSON.parse(typeof raw === "string" ? raw : raw?.data || "{}"); } catch { return; }
    if (Array.isArray(message.subscriptions)) {
      message.subscriptions.forEach(subscription => {
        const binding = [...liveBindings.values()].find(candidate => candidate.id === subscription.id || (candidate.objectPath === subscription.objectPath && candidate.propertyPath === subscription.propertyPath));
        if (!binding) return;
        binding.id = subscription.id;
        livePendingSubscriptions.delete(`${binding.objectPath}|${binding.propertyPath}`);
      });
      liveFlushSets();
    }
    if (Array.isArray(message.valuesChanged)) message.valuesChanged.forEach(change => {
      const binding = [...liveBindings.values()].find(candidate => candidate.id === change.id);
      if (!binding) return;
      binding.lastSent = change.value;
      liveOnValuesChanged({ pluginId: binding.pluginId, field: binding.field, value: binding.decode(change.value), property: binding.propertyPath });
    });
    if (message.error) liveOnStatus({ status: "error", detail: typeof message.error === "string" ? message.error : JSON.stringify(message.error) });
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
    const nextBindings = new Map();
    entries.forEach(entry => {
      const payload = entry?.payload || entry;
      const designerId = entry?.record?.designerId || entry?.designerId;
      if (!payload?.pluginId || !designerId) return;
      const objectPath = liveObjectPath(designerId);
      liveDefinitions(payload).forEach(definition => {
        const key = liveDescriptorKey(payload.pluginId, definition.field);
        const previous = liveBindings.get(key);
        nextBindings.set(key, { ...(previous || {}), ...definition, key, pluginId: payload.pluginId, objectPath, propertyPath: definition.property, id: previous?.id ?? null, value: definition.encode(liveFieldValue(payload, definition.field)) });
      });
    });
    liveBindings = nextBindings;
    liveSubscribeBindings();
    liveFlushSets();
  }
  function liveStart(callbacks = {}) {
    liveOnStatus = callbacks.onStatus || (() => {}); liveOnValuesChanged = callbacks.onValuesChanged || (() => {});
    if (liveSocket?.readyState === 1) return Promise.resolve();
    if (liveConnectPromise) return liveConnectPromise;
    if (typeof WebSocket !== "function") return Promise.reject(new Error("WebSocket is not available in this plugin window"));
    liveConnectPromise = new Promise((resolve, reject) => {
      let opened = false;
      const socket = new WebSocket(LIVE_URL); liveSocket = socket;
      socket.onopen = () => { opened = true; liveConnectPromise = null; liveOnStatus({ status: "open", detail: LIVE_URL }); liveSubscribeBindings(); liveFlushSets(); resolve(); };
      socket.onmessage = event => liveHandleMessage(event.data);
      socket.onerror = () => { const error = new Error(`Live Update WebSocket connection failed: ${LIVE_URL}`); liveOnStatus({ status: "error", detail: error.message }); if (!opened) { liveConnectPromise = null; reject(error); } };
      socket.onclose = () => { liveSocket = null; livePendingSubscriptions.clear(); liveConnectPromise = null; liveOnStatus({ status: "closed", detail: "Live Update connection closed" }); };
    });
    return liveConnectPromise;
  }
  function liveStop() { if (liveSocket) { try { liveSocket.close(); } catch {} } liveSocket = null; liveConnectPromise = null; livePendingSubscriptions.clear(); liveBindings = new Map(); liveOnStatus({ status: "closed", detail: "Live Update disabled" }); }

  window.disguiseSceneAdapter = {
    capabilities: { liveUpdate: true, liveTransport: "websocket", httpSync: true, selectiveDelete: true, readback: true, source: "Designer Python API + Live Update WebSocket", apiOrigin: API_ORIGIN, liveUrl: LIVE_URL },
    sessionStatus,
    syncEnvironment: environment => execute(environmentScript(environment)),
    inspectScene: () => execute(inspectScript()),
    createObject: payload => execute(createScript(payload)),
    updateObject: (designerId, changed, designerPath, kind) => execute(updateScript(designerId, changed, designerPath, kind)),
    deleteObjects: designerIds => execute(deleteScript(designerIds)),
    liveStart,
    liveStop,
    liveSync,
    debugScripts: { inspectScript, createScript, updateScript }
  };
})();
