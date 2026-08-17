(() => {
  const VERSION = 5;
  const STORAGE_KEY = "disguise-scene-generator-state-v5";
  const PLANAR_TYPES = new Set(["screen", "surface"]);
  const defaults = {
    room: { centerX: 0, centerZ: 0, floorY: 0, width: 20, depth: 12, height: 6 },
    counts: { screen: 3, surface: 2, camera: 2, projector: 1, light: 4 }
  };
  const typeConfig = {
    screen: { label: "LED-экран", color: "#3dd9d4", geometry: { width: 4, height: 2 }, radius: 0 },
    surface: { label: "Поверхность", color: "#4e9cff", geometry: { width: 3, height: 2 }, radius: 0 },
    camera: { label: "Камера", color: "#ff7d62", radius: 0.36, defaultHeight: 1.6 },
    projector: { label: "Проектор", color: "#c084fc", radius: 0.38, defaultHeight: 2.5 },
    light: { label: "Световой прибор", color: "#f8c84d", radius: 0.23, defaultHeight: 3 }
  };
  const inputs = {
    width: document.querySelector("#room-width"), depth: document.querySelector("#room-depth"), height: document.querySelector("#room-height"),
    centerX: document.querySelector("#room-center-x"), centerZ: document.querySelector("#room-center-z"), floorY: document.querySelector("#room-floor-y"),
    screen: document.querySelector("#screen-count"), surface: document.querySelector("#surface-count"), camera: document.querySelector("#camera-count"), projector: document.querySelector("#projector-count"), light: document.querySelector("#light-count")
  };
  const objectInputs = {
    geometryWidth: document.querySelector("#object-width"), geometryHeight: document.querySelector("#object-height"),
    x: document.querySelector("#object-x"), y: document.querySelector("#object-y"), z: document.querySelector("#object-z"),
    rx: document.querySelector("#object-rx"), ry: document.querySelector("#object-ry"), rz: document.querySelector("#object-rz")
  };
  const canvas = document.querySelector("#scene-canvas");
  const ctx = canvas.getContext("2d");
  const emptyHint = document.querySelector("#empty-hint");
  const selectionPanel = document.querySelector("#selection-panel");
  const selectionTitle = document.querySelector("#selection-title");
  const state = {
    room: { ...defaults.room }, objects: [], selectedId: null, zoom: 1, history: [], future: [], dragging: null,
    sync: { objects: {}, designerScene: null, lastSyncAt: null }
  };
  let nextId = 1;

  const clone = value => JSON.parse(JSON.stringify(value));
  const vector = value => ({ x: Number(value?.x) || 0, y: Number(value?.y) || 0, z: Number(value?.z) || 0 });
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  function numberValue(input, fallback) { const value = Number(input?.value); return Number.isFinite(value) ? value : fallback; }
  function makeId() { return globalThis.crypto?.randomUUID?.() || `dsg-${Date.now()}-${Math.random().toString(16).slice(2)}`; }
  function roomBounds() { return { minX: state.room.centerX - state.room.width / 2, maxX: state.room.centerX + state.room.width / 2, minZ: state.room.centerZ - state.room.depth / 2, maxZ: state.room.centerZ + state.room.depth / 2 }; }
  function counts() { return Object.fromEntries(Object.keys(defaults.counts).map(type => [type, clamp(Math.round(numberValue(inputs[type], 0)), 0, type === "light" ? 40 : 20)])); }
  function syncRoomFromInputs() {
    state.room.width = clamp(numberValue(inputs.width, defaults.room.width), 2, 100);
    state.room.depth = clamp(numberValue(inputs.depth, defaults.room.depth), 2, 100);
    state.room.height = clamp(numberValue(inputs.height, defaults.room.height), 2, 40);
    state.room.centerX = numberValue(inputs.centerX, defaults.room.centerX);
    state.room.centerZ = numberValue(inputs.centerZ, defaults.room.centerZ);
    state.room.floorY = numberValue(inputs.floorY, defaults.room.floorY);
    Object.entries(state.room).forEach(([key, value]) => { if (inputs[key]) inputs[key].value = value; });
  }
  function normalizedRoom(room = {}, sourceVersion = VERSION) {
    return {
      ...defaults.room, ...room,
      centerX: sourceVersion >= VERSION ? Number(room.centerX) || 0 : 0,
      centerZ: sourceVersion >= VERSION ? Number(room.centerZ) || 0 : 0,
      floorY: sourceVersion >= VERSION ? Number(room.floorY) || 0 : 0
    };
  }
  function normalizeObject(object, index, sourceVersion = VERSION) {
    let position;
    let rotation;
    if (sourceVersion >= VERSION && object.transform) {
      position = vector(object.transform.position);
      rotation = vector(object.transform.rotation);
    } else {
      const oldPosition = object.position;
      const legacyOrigin = sourceVersion < 4;
      position = oldPosition ? {
        x: (Number(oldPosition.x) || 0) - (legacyOrigin ? state.room.width / 2 : 0),
        y: Number(oldPosition.y) || 0,
        z: (Number(oldPosition.z) || 0) - (legacyOrigin ? state.room.depth / 2 : 0)
      } : {
        x: (Number(object.x) || 0) - state.room.width / 2,
        y: Number(object.z) || 0,
        z: (Number(object.y) || 0) - state.room.depth / 2
      };
      const oldRotation = Number(object.rotation) || 0;
      rotation = object.rotation && typeof object.rotation === "object" ? vector(object.rotation) : { x: 0, y: oldRotation, z: 0 };
    }
    const type = object.type || "surface";
    if (PLANAR_TYPES.has(type)) { rotation.x = 0; rotation.z = 0; }
    const normalized = {
      id: Number(object.id) || index + 1,
      pluginId: object.pluginId || makeId(),
      type,
      name: object.name || `${typeConfig[type]?.label || "Объект"} ${index + 1}`,
      transform: { position, rotation }
    };
    if (PLANAR_TYPES.has(type)) normalized.geometry = {
      width: Math.max(0.1, Number(object.geometry?.width ?? object.dimensions?.width ?? typeConfig[type].geometry.width) || typeConfig[type].geometry.width),
      height: Math.max(0.1, Number(object.geometry?.height ?? object.dimensions?.height ?? typeConfig[type].geometry.height) || typeConfig[type].geometry.height)
    };
    if (object.designer) normalized.designer = object.designer;
    return normalized;
  }
  function snapshot() { return JSON.stringify({ version: VERSION, room: state.room, objects: state.objects, sync: state.sync }); }
  function persist() { localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: VERSION, room: state.room, objects: state.objects, sync: state.sync, nextId })); }
  function loadPersisted() {
    try {
      const keys = [STORAGE_KEY, "disguise-scene-generator-state-v4", "disguise-scene-generator-state-v3", "disguise-scene-generator-state-v2"];
      const saved = JSON.parse(keys.map(key => localStorage.getItem(key)).find(Boolean) || "null");
      if (!saved) return false;
      const sourceVersion = Number(saved.version) || (saved.objects?.some(object => object.position) ? 3 : 2);
      state.room = normalizedRoom(saved.room, sourceVersion);
      state.objects = Array.isArray(saved.objects) ? saved.objects.map((object, index) => normalizeObject(object, index, sourceVersion)) : [];
      state.sync = { objects: {}, designerScene: null, lastSyncAt: null, ...(saved.sync || {}) };
      nextId = Math.max(Number(saved.nextId) || 1, ...state.objects.map(object => (Number(object.id) || 0) + 1), 1);
      state.selectedId = state.objects[0]?.id ?? null;
      Object.entries(state.room).forEach(([key, value]) => { if (inputs[key]) inputs[key].value = value; });
      persist(); return true;
    } catch (error) { console.warn("Не удалось загрузить локальный план", error); return false; }
  }
  function saveHistory() { state.history.push(snapshot()); if (state.history.length > 30) state.history.shift(); state.future = []; }
  function restore(json) {
    const data = JSON.parse(json); const sourceVersion = Number(data.version) || VERSION;
    state.room = normalizedRoom(data.room, sourceVersion); state.objects = data.objects.map((object, index) => normalizeObject(object, index, sourceVersion)); state.sync = data.sync || state.sync; state.selectedId = null;
    Object.entries(state.room).forEach(([key, value]) => { if (inputs[key]) inputs[key].value = value; }); persist(); render();
  }
  function applyHistory(direction) { const source = direction === "undo" ? state.history : state.future; if (!source.length) return; const target = direction === "undo" ? state.future : state.history; target.push(snapshot()); restore(source.pop()); }
  function newObject(type, x, z, rotation = {}) {
    const object = {
      id: nextId++, pluginId: makeId(), type, name: `${typeConfig[type].label} ${state.objects.filter(item => item.type === type).length + 1}`,
      transform: {
        position: { x: Number(x.toFixed(2)), y: Number((state.room.floorY + (typeConfig[type].defaultHeight || 0)).toFixed(2)), z: Number(z.toFixed(2)) },
        rotation: { x: PLANAR_TYPES.has(type) ? 0 : Number(rotation.x) || 0, y: Number(rotation.y) || 0, z: PLANAR_TYPES.has(type) ? 0 : Number(rotation.z) || 0 }
      }
    };
    if (PLANAR_TYPES.has(type)) object.geometry = clone(typeConfig[type].geometry);
    return object;
  }
  function generate() {
    syncRoomFromInputs(); saveHistory(); state.objects = [];
    const requested = counts(); const margin = 0.8; const bounds = roomBounds(); const screenSpacing = state.room.width / (requested.screen + 1);
    for (let i = 0; i < requested.screen; i++) state.objects.push(newObject("screen", bounds.minX + screenSpacing * (i + 1), bounds.minZ + margin));
    const surfaceSpacing = state.room.depth / (requested.surface + 1);
    for (let i = 0; i < requested.surface; i++) state.objects.push(newObject("surface", bounds.minX + margin, bounds.minZ + surfaceSpacing * (i + 1), { y: 90 }));
    for (let i = 0; i < requested.camera; i++) state.objects.push(newObject("camera", state.room.centerX + state.room.width * (-.2 + (i % 3) * .2), bounds.maxZ - margin - Math.floor(i / 3) * 1.1, { y: 180 }));
    for (let i = 0; i < requested.projector; i++) state.objects.push(newObject("projector", state.room.centerX + state.room.width * .22, bounds.maxZ - margin, { y: 180 }));
    for (let i = 0; i < requested.light; i++) { const columns = Math.max(1, Math.ceil(Math.sqrt(requested.light))); state.objects.push(newObject("light", bounds.minX + state.room.width * ((i % columns + 1) / (columns + 1)), bounds.minZ + state.room.depth * ((Math.floor(i / columns) + 1) / (Math.ceil(requested.light / columns) + 1)))); }
    state.selectedId = state.objects[0]?.id ?? null; persist(); render();
  }
  function sizing() {
    const rect = canvas.getBoundingClientRect(); const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(rect.width * dpr)); canvas.height = Math.max(1, Math.floor(rect.height * dpr)); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const padding = 62; const base = Math.min((rect.width - padding * 2) / state.room.width, (rect.height - padding * 2) / state.room.depth); const scale = Math.max(4, base * state.zoom); const roomWidth = state.room.width * scale; const roomHeight = state.room.depth * scale;
    return { rect, scale, left: (rect.width - roomWidth) / 2, top: (rect.height - roomHeight) / 2, roomWidth, roomHeight };
  }
  function toScreen(x, z, frame) { const bounds = roomBounds(); return { x: frame.left + (x - bounds.minX) * frame.scale, y: frame.top + (bounds.maxZ - z) * frame.scale }; }
  function toWorld(x, y, frame) { const bounds = roomBounds(); return { x: bounds.minX + (x - frame.left) / frame.scale, z: bounds.maxZ - (y - frame.top) / frame.scale }; }
  function drawGrid(frame) {
    const bounds = roomBounds(); ctx.fillStyle = "#10161c"; ctx.fillRect(0, 0, frame.rect.width, frame.rect.height); ctx.save(); ctx.beginPath(); ctx.rect(frame.left, frame.top, frame.roomWidth, frame.roomHeight); ctx.clip(); ctx.strokeStyle = "rgba(157, 169, 183, .12)"; ctx.lineWidth = 1;
    for (let x = Math.ceil(bounds.minX); x <= bounds.maxX; x += 1) { const point = toScreen(x, bounds.minZ, frame); ctx.beginPath(); ctx.moveTo(point.x, frame.top); ctx.lineTo(point.x, frame.top + frame.roomHeight); ctx.stroke(); }
    for (let z = Math.ceil(bounds.minZ); z <= bounds.maxZ; z += 1) { const point = toScreen(bounds.minX, z, frame); ctx.beginPath(); ctx.moveTo(frame.left, point.y); ctx.lineTo(frame.left + frame.roomWidth, point.y); ctx.stroke(); }
    if (bounds.minX <= 0 && bounds.maxX >= 0) { const origin = toScreen(0, bounds.minZ, frame); ctx.strokeStyle = "rgba(61, 217, 212, .48)"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(origin.x, frame.top); ctx.lineTo(origin.x, frame.top + frame.roomHeight); ctx.stroke(); }
    if (bounds.minZ <= 0 && bounds.maxZ >= 0) { const origin = toScreen(bounds.minX, 0, frame); ctx.strokeStyle = "rgba(61, 217, 212, .48)"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(frame.left, origin.y); ctx.lineTo(frame.left + frame.roomWidth, origin.y); ctx.stroke(); }
    ctx.restore(); ctx.strokeStyle = "#92a0ae"; ctx.lineWidth = 2; ctx.strokeRect(frame.left, frame.top, frame.roomWidth, frame.roomHeight); ctx.fillStyle = "#9da9b7"; ctx.font = "12px Inter, sans-serif"; ctx.textAlign = "center"; ctx.fillText(`${bounds.minX.toFixed(1)} … ${bounds.maxX.toFixed(1)} м · X`, frame.left + frame.roomWidth / 2, frame.top + frame.roomHeight + 23); ctx.save(); ctx.translate(frame.left - 24, frame.top + frame.roomHeight / 2); ctx.rotate(-Math.PI / 2); ctx.fillText(`${bounds.minZ.toFixed(1)} … ${bounds.maxZ.toFixed(1)} м · Z`, 0, 0); ctx.restore();
  }
  function drawObject(object, frame) {
    const position = toScreen(object.transform.position.x, object.transform.position.z, frame); const config = typeConfig[object.type]; const selected = object.id === state.selectedId;
    ctx.save(); ctx.translate(position.x, position.y); ctx.rotate(-object.transform.rotation.y * Math.PI / 180); ctx.fillStyle = config.color; ctx.strokeStyle = selected ? "#ffffff" : config.color; ctx.lineWidth = selected ? 2.5 : 1.2;
    if (PLANAR_TYPES.has(object.type)) { const w = object.geometry.width * frame.scale; const t = Math.max(5, .1 * frame.scale); if (object.type === "surface") ctx.globalAlpha = .42; ctx.fillRect(-w / 2, -t / 2, w, t); ctx.globalAlpha = 1; ctx.strokeRect(-w / 2, -t / 2, w, t); }
    if (object.type === "camera") { const r = config.radius * frame.scale; ctx.beginPath(); ctx.moveTo(r, 0); ctx.lineTo(-r * .8, -r * .75); ctx.lineTo(-r * .8, r * .75); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.globalAlpha = .25; ctx.beginPath(); ctx.moveTo(r, 0); ctx.lineTo(r + frame.scale * 3, -frame.scale * 1.4); ctx.lineTo(r + frame.scale * 3, frame.scale * 1.4); ctx.closePath(); ctx.fill(); }
    if (object.type === "projector") { const r = config.radius * frame.scale; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.globalAlpha = .3; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(frame.scale * 4, -frame.scale * 1.8); ctx.lineTo(frame.scale * 4, frame.scale * 1.8); ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1; ctx.fillStyle = "#10161c"; ctx.beginPath(); ctx.arc(frame.scale * .25, 0, Math.max(2, r * .28), 0, Math.PI * 2); ctx.fill(); }
    if (object.type === "light") { const r = Math.max(4, config.radius * frame.scale); ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = "#10161c"; ctx.beginPath(); ctx.arc(0, 0, Math.max(2, r * .34), 0, Math.PI * 2); ctx.fill(); }
    ctx.restore(); if (selected) { ctx.fillStyle = "#ffffff"; ctx.font = "12px Inter, sans-serif"; ctx.textAlign = "center"; ctx.fillText(object.name, position.x, position.y - 16); }
  }
  function render() { const frame = sizing(); drawGrid(frame); state.objects.forEach(object => drawObject(object, frame)); emptyHint.hidden = state.objects.length > 0; document.querySelector("#zoom-level").textContent = `${Math.round(state.zoom * 100)}%`; document.querySelector("#scene-summary").textContent = `Помещение ${state.room.width.toFixed(1)} × ${state.room.depth.toFixed(1)} × ${state.room.height.toFixed(1)} м · центр X ${state.room.centerX.toFixed(1)}, Z ${state.room.centerZ.toFixed(1)} · вид X/Z`; syncSelectionPanel(); }
  function selectedObject() { return state.objects.find(object => object.id === state.selectedId); }
  function syncSelectionPanel() {
    const object = selectedObject(); selectionPanel.hidden = !object; if (!object) return; const planar = PLANAR_TYPES.has(object.type); selectionTitle.textContent = object.name;
    ["x", "y", "z"].forEach(axis => { objectInputs[axis].value = object.transform.position[axis].toFixed(2); }); ["rx", "ry", "rz"].forEach(field => { objectInputs[field].value = object.transform.rotation[field.slice(1)].toFixed(1); });
    document.querySelector("#object-width-field").hidden = !planar; document.querySelector("#object-height-field").hidden = !planar; document.querySelector("#object-rx-field").hidden = planar; document.querySelector("#object-rz-field").hidden = planar;
    document.querySelector("#object-y-label").textContent = planar ? "Y нижнего края" : (object.type === "camera" || object.type === "projector") ? "Y объектива" : "Y"; document.querySelector("#object-ry-label").textContent = planar ? "Поворот по плану" : "Ry";
    if (planar) { objectInputs.geometryWidth.value = object.geometry.width.toFixed(2); objectInputs.geometryHeight.value = object.geometry.height.toFixed(2); }
  }
  function hitTest(clientX, clientY) { const rect = canvas.getBoundingClientRect(); const frame = sizing(); const point = { x: clientX - rect.left, y: clientY - rect.top }; return [...state.objects].reverse().find(object => { const p = toScreen(object.transform.position.x, object.transform.position.z, frame); const config = typeConfig[object.type]; const radius = PLANAR_TYPES.has(object.type) ? object.geometry.width * frame.scale / 2 : Math.max(12, config.radius * frame.scale * 1.8); return Math.hypot(point.x - p.x, point.y - p.y) < radius + 7; }); }
  function updateSelected(field) {
    const object = selectedObject(); if (!object) return; saveHistory();
    if (field === "geometryWidth" || field === "geometryHeight") { const key = field === "geometryWidth" ? "width" : "height"; object.geometry[key] = Number(Math.max(.1, numberValue(objectInputs[field], object.geometry[key])).toFixed(3)); }
    else if (["x", "y", "z"].includes(field)) object.transform.position[field] = Number(numberValue(objectInputs[field], object.transform.position[field]).toFixed(3));
    else { const axis = field.slice(1); object.transform.rotation[axis] = PLANAR_TYPES.has(object.type) && axis !== "y" ? 0 : Number(numberValue(objectInputs[field], object.transform.rotation[axis]).toFixed(3)); }
    persist(); render();
  }
  function canonical(value) { if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`; return JSON.stringify(value); }
  function changedValue(previous, current) { if (previous && current && typeof previous === "object" && typeof current === "object" && !Array.isArray(previous) && !Array.isArray(current)) { const result = {}; Object.keys(current).forEach(key => { const change = changedValue(previous[key], current[key]); if (change !== undefined) result[key] = change; }); return Object.keys(result).length ? result : undefined; } return canonical(previous) === canonical(current) ? undefined : current; }
  function objectPayload(object) { const payload = { pluginId: object.pluginId, type: object.type, name: object.name, transform: clone(object.transform) }; if (PLANAR_TYPES.has(object.type)) payload.geometry = clone(object.geometry); return payload; }
  function validateReadback(expected, result, tolerance = .001) {
    const actual = result?.readback; if (!actual) throw new Error("Designer не вернул координаты объекта для проверки"); const mismatches = [];
    const compare = (path, wanted, got) => { if (!Number.isFinite(Number(got)) || Math.abs(Number(wanted) - Number(got)) > tolerance) mismatches.push(`${path}: ожидалось ${wanted}, получено ${got}`); };
    const compareAngle = (path, wanted, got) => { const difference = Math.abs((((Number(wanted) - Number(got)) % 360) + 540) % 360 - 180); if (!Number.isFinite(Number(got)) || difference > tolerance) mismatches.push(`${path}: ожидалось ${wanted}, получено ${got}`); };
    ["x", "y", "z"].forEach(axis => compare(`position.${axis}`, expected.transform.position[axis], actual.transform?.position?.[axis])); ["x", "y", "z"].forEach(axis => compareAngle(`rotation.${axis}`, expected.transform.rotation[axis], actual.transform?.rotation?.[axis]));
    if (expected.geometry) { compare("geometry.width", expected.geometry.width, actual.geometry?.width); compare("geometry.height", expected.geometry.height, actual.geometry?.height); }
    if (mismatches.length) throw new Error(`Проверка координат Designer не пройдена: ${mismatches.join("; ")}`); return true;
  }
  function getAdapter() { const adapter = globalThis.disguiseSceneAdapter; return adapter && ["inspectScene", "createObject", "updateObject"].every(method => typeof adapter[method] === "function") ? adapter : null; }
  function typeOfSceneObject(item) { return item.type || ({ ledScreens: "screen", surfaces: "surface", cameras: "camera", projectors: "projector", lights: "light" }[item.collection]); }
  function isStandardCandidate(item) { return Boolean(item.standard || /(^|[\\/ _-])(surface|projector|camera|screen|light)[ _-]?1(?:\.|$)/i.test(`${item.path || ""} ${item.description || ""} ${item.name || ""}`)); }
  async function makeDiff(adapter, mode = "update") {
    const designerScene = adapter ? await adapter.inspectScene() : null; const inspected = designerScene?.objects || []; const records = state.sync.objects || {}; const byId = new Map(inspected.map(item => [String(item.id || item.uid), item])); const usedIds = new Set(); const currentIds = new Set(state.objects.map(object => object.pluginId));
    const diff = { create: [], update: [], adopt: [], unchanged: [], orphans: [], preserve: [], standardCandidates: inspected.filter(isStandardCandidate), deletionCandidates: inspected.filter(isStandardCandidate), designerCount: inspected.length, inspectionWarnings: designerScene?.warnings || [], adapter, mode, floorY: designerScene?.floorY ?? 0 };
    for (const object of state.objects) {
      const payload = objectPayload(object); const serialized = canonical(payload); let record = records[object.pluginId]; let designerId = record?.designerId; let designerObject = designerId ? byId.get(String(designerId)) : null;
      if (!designerObject && record?.path) designerObject = inspected.find(item => String(item.path || "") === String(record.path)); if (!designerObject) designerObject = inspected.find(item => (item.managed && String(item.pluginId || "") === object.pluginId) || String(item.path || "").includes(`dsg-${object.pluginId}`)); if (designerObject) { designerId = String(designerObject.id || designerObject.uid); record = { ...(record || {}), designerId, path: designerObject.path }; }
      if (designerId && designerObject) { usedIds.add(String(designerId)); if (record?.lastExported === serialized) diff.unchanged.push({ object, payload, designerId, designerPath: designerObject.path }); else diff.update.push({ object, payload, serialized, designerId, designerPath: designerObject.path, changed: changedValue(record?.payload || {}, payload) || {} }); continue; }
      const candidate = diff.standardCandidates.find(item => !usedIds.has(String(item.id)) && typeOfSceneObject(item) === object.type); if (mode === "update" && candidate) { usedIds.add(String(candidate.id)); diff.adopt.push({ object, payload, serialized, designerId: String(candidate.id), candidate }); } else diff.create.push({ object, payload, serialized });
    }
    Object.entries(records).forEach(([pluginId, record]) => { if (!currentIds.has(pluginId) && record?.designerId) diff.orphans.push({ pluginId, designerId: record.designerId, name: record.name || pluginId }); }); diff.preserve = inspected.filter(item => !usedIds.has(String(item.id)) && !isStandardCandidate(item)); diff.standardCandidates = inspected.filter(item => isStandardCandidate(item) && !usedIds.has(String(item.id))); return diff;
  }
  function setDiffText(diff) { document.querySelector("#diff-create").textContent = diff.create.length; document.querySelector("#diff-update").textContent = diff.update.length + diff.adopt.length; document.querySelector("#diff-unchanged").textContent = diff.unchanged.length; document.querySelector("#diff-preserve").textContent = diff.preserve.length; document.querySelector("#diff-orphans").textContent = diff.orphans.length; document.querySelector("#diff-delete").textContent = diff.standardCandidates.length; }
  function renderStandardChecklist(diff) { const list = document.querySelector("#standard-checklist"); list.replaceChildren(); if (!diff?.standardCandidates?.length) { list.textContent = "Нет узнаваемых стандартных объектов."; return; } diff.standardCandidates.forEach(item => { const label = document.createElement("label"); label.className = "check-row"; const checkbox = document.createElement("input"); checkbox.type = "checkbox"; checkbox.value = String(item.id); const name = document.createElement("span"); name.textContent = item.description || item.name || item.path || item.id; label.append(checkbox, name); list.append(label); }); }
  async function openSyncDialog() {
    const adapter = getAdapter(); const modal = document.querySelector("#sync-modal"); const message = document.querySelector("#sync-message"); const warning = document.querySelector("#sync-warning"); const confirm = document.querySelector("#confirm-sync"); const mode = document.querySelector("input[name=sync-mode]:checked")?.value || "update"; let diff;
    try { diff = await makeDiff(adapter, mode); } catch (error) { setDiffText({ create: [], update: [], adopt: [], unchanged: [], orphans: [], preserve: [], standardCandidates: [] }); modal.hidden = false; modal._diff = null; message.textContent = "Designer API не отвечает. Экспорт в проект не выполнен."; warning.textContent = error.message || String(error); warning.hidden = false; confirm.disabled = true; return; }
    setDiffText(diff); renderStandardChecklist(diff); modal.hidden = false; modal._diff = diff; if (!adapter) { message.textContent = "Прямое подключение к Designer пока не найдено. Экспорт в проект не выполнен."; warning.textContent = "Для обмена планом используйте «Экспорт JSON»."; warning.hidden = false; confirm.disabled = true; return; }
    message.textContent = diff.designerCount ? `В текущей сцене обнаружено ${diff.designerCount} объект(ов). Ручные объекты (${diff.preserve.length}) останутся без изменений.` : "Текущая сцена пуста. Будут созданы только объекты этого плана."; const warningParts = [diff.standardCandidates.length ? `Узнаваемые стандартные объекты: ${diff.standardCandidates.length}. Их можно отдельно удалить или принять на месте.` : "Из Designer ничего автоматически удаляться не будет."]; if (diff.inspectionWarnings.length) warningParts.push(`Пропущено повреждённых ссылок Designer: ${diff.inspectionWarnings.length}.`); warning.textContent = warningParts.join(" "); warning.hidden = false; confirm.disabled = adapter.capabilities?.liveUpdate !== true; if (confirm.disabled) message.textContent += " Live-update не поддерживается подключённым адаптером.";
  }
  async function syncToDesigner(diff) {
    const records = state.sync.objects || {};
    for (const item of [...diff.create, ...diff.adopt]) {
      try { const result = item.designerId ? await diff.adapter.updateObject(item.designerId, item.payload, item.candidate?.path, item.object.type) : await diff.adapter.createObject(item.payload); validateReadback(item.payload, result); item.designerId = result?.designerId || result?.id || item.designerId; item.designerPath = result?.path || item.candidate?.path; } catch (error) { throw new Error(`${item.designerId ? "Обновление" : "Создание"} «${item.object.name}»: ${error.message || error}`); }
      records[item.object.pluginId] = { pluginId: item.object.pluginId, designerId: item.designerId || `dsg:${item.object.pluginId}`, path: item.designerPath, type: item.object.type, name: item.object.name, lastExported: item.serialized, payload: item.payload, adopted: Boolean(item.candidate) }; state.sync.objects = records; persist();
    }
    for (const item of diff.update) {
      try { const result = await diff.adapter.updateObject(item.designerId, item.changed, item.designerPath || records[item.object.pluginId]?.path, item.object.type); validateReadback(item.payload, result); item.designerPath = result?.path || item.designerPath; } catch (error) { throw new Error(`Обновление «${item.object.name}»: ${error.message || error}`); }
      records[item.object.pluginId] = { ...(records[item.object.pluginId] || {}), pluginId: item.object.pluginId, designerId: item.designerId, path: item.designerPath || records[item.object.pluginId]?.path, type: item.object.type, name: item.object.name, lastExported: item.serialized, payload: item.payload }; state.sync.objects = records; persist();
    }
    state.sync.objects = records; state.sync.designerScene = { inspectedAt: new Date().toISOString(), objectCount: diff.designerCount, floorY: diff.floorY }; state.sync.lastSyncAt = new Date().toISOString(); persist();
  }
  async function deleteSelectedStandards() { const modal = document.querySelector("#sync-modal"); const diff = modal._diff; const ids = [...document.querySelectorAll("#standard-checklist input:checked")].map(input => input.value); if (!diff?.adapter || !ids.length || typeof diff.adapter.deleteObjects !== "function") return; if (!window.confirm(`Удалить ${ids.length} выбранных стандартных объектов? Ручные и плагиновые объекты защищены.`)) return; const button = document.querySelector("#delete-standards"); button.disabled = true; try { await diff.adapter.deleteObjects(ids); document.querySelector("#adapter-status").textContent = `Designer API: удалено стандартных объектов ${ids.length}`; modal.hidden = true; } catch (error) { document.querySelector("#sync-warning").textContent = `Очистка остановлена: ${error.message || error}`; document.querySelector("#sync-warning").hidden = false; } finally { button.disabled = false; } }
  function exportSceneJson() { const output = { version: VERSION, units: "metres", coordinateSystem: "Designer world XYZ; top view X/Z; no room-relative transform", room: state.room, objects: state.objects.map(({ id, ...object }) => object) }; const blob = new Blob([JSON.stringify(output, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = "disguise-scene-plan.json"; link.click(); URL.revokeObjectURL(url); }
  async function confirmSync() { const modal = document.querySelector("#sync-modal"); const diff = modal._diff; if (!diff?.adapter) return; const button = document.querySelector("#confirm-sync"); button.disabled = true; button.textContent = "Синхронизация…"; try { await syncToDesigner(diff); modal.hidden = true; document.querySelector("#adapter-status").textContent = `Designer API: координаты проверены · ${new Date().toLocaleTimeString()}`; } catch (error) { document.querySelector("#sync-warning").textContent = `Синхронизация остановлена: ${error.message || error}`; document.querySelector("#sync-warning").hidden = false; } finally { button.disabled = false; button.textContent = "Экспортировать изменения"; } }
  function addObject(type) { syncRoomFromInputs(); saveHistory(); const object = newObject(type, state.room.centerX, state.room.centerZ); state.objects.push(object); state.selectedId = object.id; persist(); render(); }
  function resetInputs() { Object.entries(defaults.room).forEach(([key, value]) => { if (inputs[key]) inputs[key].value = value; }); Object.entries(defaults.counts).forEach(([key, value]) => { if (inputs[key]) inputs[key].value = value; }); generate(); }

  document.querySelector("#reset-button").addEventListener("click", resetInputs); document.querySelector("#export-button").addEventListener("click", openSyncDialog); document.querySelector("#json-button").addEventListener("click", exportSceneJson); document.querySelector("#add-object-button").addEventListener("click", () => addObject(document.querySelector("#add-object-type").value)); document.querySelector("#confirm-sync").addEventListener("click", confirmSync); document.querySelector("#delete-standards").addEventListener("click", deleteSelectedStandards); document.querySelectorAll("input[name=sync-mode]").forEach(input => input.addEventListener("change", () => { if (!document.querySelector("#sync-modal").hidden) openSyncDialog(); }));
  ["#close-sync", "#cancel-sync"].forEach(selector => document.querySelector(selector).addEventListener("click", () => { document.querySelector("#sync-modal").hidden = true; })); document.querySelector("#undo-button").addEventListener("click", () => applyHistory("undo")); document.querySelector("#redo-button").addEventListener("click", () => applyHistory("redo")); document.querySelector("#zoom-in").addEventListener("click", () => { state.zoom = clamp(Number((state.zoom + .15).toFixed(2)), .5, 2); render(); }); document.querySelector("#zoom-out").addEventListener("click", () => { state.zoom = clamp(Number((state.zoom - .15).toFixed(2)), .5, 2); render(); });
  document.querySelector("#delete-button").addEventListener("click", () => { const index = state.objects.findIndex(object => object.id === state.selectedId); if (index < 0) return; saveHistory(); state.objects.splice(index, 1); state.selectedId = null; persist(); render(); }); Object.keys(objectInputs).forEach(field => objectInputs[field].addEventListener("change", () => updateSelected(field))); [inputs.width, inputs.depth, inputs.height, inputs.centerX, inputs.centerZ, inputs.floorY].forEach(input => input.addEventListener("change", () => { syncRoomFromInputs(); persist(); render(); }));
  canvas.addEventListener("pointerdown", event => { const object = hitTest(event.clientX, event.clientY); state.selectedId = object?.id ?? null; if (object) { saveHistory(); state.dragging = object.id; canvas.setPointerCapture(event.pointerId); } render(); }); canvas.addEventListener("pointermove", event => { if (!state.dragging) return; const rect = canvas.getBoundingClientRect(); const point = toWorld(event.clientX - rect.left, event.clientY - rect.top, sizing()); const object = state.objects.find(item => item.id === state.dragging); if (!object) return; const bounds = roomBounds(); object.transform.position.x = Number(clamp(point.x, bounds.minX, bounds.maxX).toFixed(3)); object.transform.position.z = Number(clamp(point.z, bounds.minZ, bounds.maxZ).toFixed(3)); render(); }); canvas.addEventListener("pointerup", event => { state.dragging = null; persist(); if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId); }); canvas.addEventListener("pointercancel", () => { state.dragging = null; persist(); }); window.addEventListener("resize", render);

  if (!loadPersisted()) generate(); else render(); const adapter = getAdapter(); document.querySelector("#adapter-status").textContent = adapter ? `Designer API: ${adapter.capabilities?.source || "адаптер найден"}` : "Designer API: не подключён · JSON доступен";
  globalThis.scenePlannerDebug = { state, makeDiff, syncToDesigner, objectPayload, validateReadback, canonical, changedValue, normalizeObject, normalizedRoom, roomBounds, toScreen, toWorld, typeConfig };
})();
