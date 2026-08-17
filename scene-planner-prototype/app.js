(() => {
  const VERSION = 6;
  const STORAGE_KEY = "disguise-scene-generator-state-v6";
  const PLANAR_TYPES = new Set(["screen", "surface"]);
  const GROUP_ORDER = ["screen", "projector", "light", "surface", "camera"];
  const defaults = {
    room: { width: 20, depth: 12 },
    stage: { centerX: 0, centerZ: 0, floorY: 0.8, width: 12, depth: 8, height: 0.8 },
    counts: { screen: 3, projector: 1, light: 4, surface: 0, camera: 0 }
  };
  const typeConfig = {
    screen: { label: "LED-экран", group: "LED-экраны", color: "#3dd9d4", geometry: { width: 4, height: 2 }, media: { resolutionX: 1920, resolutionY: 1080, pixelPitchMm: 2.6 } },
    projector: { label: "Проектор", group: "Проекторы", color: "#c084fc", radius: 0.38, defaultHeight: 2.5, media: { resolutionX: 1920, resolutionY: 1080 } },
    light: { label: "Световой прибор", group: "Световые приборы", color: "#f8c84d", radius: 0.23, defaultHeight: 3 },
    surface: { label: "Поверхность", group: "Поверхности", color: "#4e9cff", geometry: { width: 3, height: 2 } },
    camera: { label: "Камера", group: "Камеры", color: "#ff7d62", radius: 0.36, defaultHeight: 1.6 }
  };
  const roomInputs = {
    width: document.querySelector("#room-width"), depth: document.querySelector("#room-depth")
  };
  const stageInputs = {
    width: document.querySelector("#stage-width"), depth: document.querySelector("#stage-depth"), height: document.querySelector("#stage-height"),
    centerX: document.querySelector("#stage-center-x"), centerZ: document.querySelector("#stage-center-z"), floorY: document.querySelector("#stage-floor-y")
  };
  const canvas = document.querySelector("#scene-canvas");
  const ctx = canvas.getContext("2d");
  const objectGroups = document.querySelector("#object-groups");
  const emptyHint = document.querySelector("#empty-hint");
  const state = {
    room: { ...defaults.room }, stage: { ...defaults.stage }, objects: [], selectedId: null, zoom: 1,
    history: [], future: [], dragging: null, guides: [], openGroups: new Set(), expandedIds: new Set(), scrub: null,
    sync: { objects: {}, designerScene: null, lastSyncAt: null }
  };
  let nextId = 1;

  const clone = value => JSON.parse(JSON.stringify(value));
  const vector = value => ({ x: finite(value?.x, 0), y: finite(value?.y, 0), z: finite(value?.z, 0) });
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  function finite(value, fallback = 0) {
    const normalized = typeof value === "string" ? value.trim().replace(",", ".") : value;
    if (normalized === "" || normalized === null || normalized === undefined) return fallback;
    const parsed = Number(normalized); return Number.isFinite(parsed) ? parsed : fallback;
  }
  function makeId() { return globalThis.crypto?.randomUUID?.() || `dsg-${Date.now()}-${Math.random().toString(16).slice(2)}`; }
  function roomBounds() { return { minX: -state.room.width / 2, maxX: state.room.width / 2, minZ: -state.room.depth / 2, maxZ: state.room.depth / 2 }; }
  function stageBounds() { return { minX: state.stage.centerX - state.stage.width / 2, maxX: state.stage.centerX + state.stage.width / 2, minZ: state.stage.centerZ - state.stage.depth / 2, maxZ: state.stage.centerZ + state.stage.depth / 2 }; }
  function formatValue(value, step = .1) { const digits = step >= 1 ? 0 : step >= .1 ? 1 : 2; return finite(value).toFixed(digits).replace(".", ","); }
  function modelSnapshot() { return { version: VERSION, room: state.room, stage: state.stage, objects: state.objects, sync: state.sync }; }
  function snapshot() { return JSON.stringify(modelSnapshot()); }
  function persist() { localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...modelSnapshot(), nextId })); }
  function saveHistory() { state.history.push(snapshot()); if (state.history.length > 40) state.history.shift(); state.future = []; }

  function normalizedRoom(room = {}) { return { width: Math.max(2, finite(room.width, defaults.room.width)), depth: Math.max(2, finite(room.depth, defaults.room.depth)) }; }
  function normalizedStage(saved = {}, room = {}, sourceVersion = VERSION) {
    if (sourceVersion >= 5 && saved && typeof saved === "object" && Object.keys(saved).length) return {
      centerX: finite(saved.centerX), centerZ: finite(saved.centerZ), floorY: finite(saved.floorY, defaults.stage.floorY),
      width: Math.max(.5, finite(saved.width, defaults.stage.width)), depth: Math.max(.5, finite(saved.depth, defaults.stage.depth)), height: Math.max(0, finite(saved.height, defaults.stage.height))
    };
    return {
      centerX: finite(room.centerX), centerZ: finite(room.centerZ), floorY: finite(room.floorY, defaults.stage.floorY),
      width: Math.min(finite(room.width, defaults.room.width), defaults.stage.width), depth: Math.min(finite(room.depth, defaults.room.depth), defaults.stage.depth), height: defaults.stage.height
    };
  }
  function normalizeObject(object, index, sourceVersion = VERSION) {
    let position;
    let rotation;
    if (sourceVersion >= 5 && object.transform) {
      position = vector(object.transform.position); rotation = vector(object.transform.rotation);
    } else {
      const oldPosition = object.position; const legacyOrigin = sourceVersion < 4;
      position = oldPosition ? {
        x: finite(oldPosition.x) - (legacyOrigin ? state.room.width / 2 : 0), y: finite(oldPosition.y), z: finite(oldPosition.z) - (legacyOrigin ? state.room.depth / 2 : 0)
      } : { x: finite(object.x) - state.room.width / 2, y: finite(object.z), z: finite(object.y) - state.room.depth / 2 };
      rotation = object.rotation && typeof object.rotation === "object" ? vector(object.rotation) : { x: 0, y: finite(object.rotation), z: 0 };
    }
    const type = object.type || "surface"; const config = typeConfig[type];
    if (PLANAR_TYPES.has(type)) { rotation.x = 0; rotation.z = 0; }
    const normalized = { id: Number(object.id) || index + 1, pluginId: object.pluginId || makeId(), type, name: object.name || `${config.label} ${index + 1}`, transform: { position, rotation } };
    if (config.geometry) normalized.geometry = {
      width: Math.max(.1, finite(object.geometry?.width ?? object.dimensions?.width, config.geometry.width)),
      height: Math.max(.1, finite(object.geometry?.height ?? object.dimensions?.height, config.geometry.height))
    };
    if (config.media) normalized.media = {
      resolutionX: Math.max(1, Math.round(finite(object.media?.resolutionX, config.media.resolutionX))),
      resolutionY: Math.max(1, Math.round(finite(object.media?.resolutionY, config.media.resolutionY))),
      ...(type === "screen" ? { pixelPitchMm: Math.max(.1, finite(object.media?.pixelPitchMm, config.media.pixelPitchMm)) } : {})
    };
    if (object.designer) normalized.designer = object.designer;
    return normalized;
  }
  function loadPersisted() {
    try {
      const keys = [STORAGE_KEY, "disguise-scene-generator-state-v5", "disguise-scene-generator-state-v4", "disguise-scene-generator-state-v3", "disguise-scene-generator-state-v2"];
      const saved = JSON.parse(keys.map(key => localStorage.getItem(key)).find(Boolean) || "null"); if (!saved) return false;
      const sourceVersion = Number(saved.version) || (saved.objects?.some(object => object.position) ? 3 : 2);
      state.room = normalizedRoom(saved.room); state.stage = normalizedStage(saved.stage, saved.room || {}, sourceVersion);
      state.objects = Array.isArray(saved.objects) ? saved.objects.map((object, index) => normalizeObject(object, index, sourceVersion)) : [];
      state.sync = { objects: {}, designerScene: null, lastSyncAt: null, ...(saved.sync || {}) };
      nextId = Math.max(Number(saved.nextId) || 1, ...state.objects.map(object => (Number(object.id) || 0) + 1), 1);
      state.selectedId = state.objects[0]?.id ?? null; persist(); return true;
    } catch (error) { console.warn("Не удалось загрузить локальный план", error); return false; }
  }
  function restore(json) {
    const saved = JSON.parse(json); const sourceVersion = Number(saved.version) || VERSION;
    state.room = normalizedRoom(saved.room); state.stage = normalizedStage(saved.stage, saved.room || {}, sourceVersion); state.objects = saved.objects.map((object, index) => normalizeObject(object, index, sourceVersion)); state.sync = saved.sync || state.sync; state.selectedId = null;
    syncStaticInputs(); persist(); render();
  }
  function applyHistory(direction) { const source = direction === "undo" ? state.history : state.future; if (!source.length) return; const target = direction === "undo" ? state.future : state.history; target.push(snapshot()); restore(source.pop()); }

  function newObject(type, x = state.stage.centerX, z = state.stage.centerZ, rotation = {}) {
    const config = typeConfig[type]; const object = {
      id: nextId++, pluginId: makeId(), type, name: `${config.label} ${state.objects.filter(item => item.type === type).length + 1}`,
      transform: {
        position: { x: Number(x.toFixed(3)), y: Number((PLANAR_TYPES.has(type) ? state.stage.floorY : (config.defaultHeight ?? state.stage.floorY)).toFixed(3)), z: Number(z.toFixed(3)) },
        rotation: { x: PLANAR_TYPES.has(type) ? 0 : finite(rotation.x), y: finite(rotation.y), z: PLANAR_TYPES.has(type) ? 0 : finite(rotation.z) }
      }
    };
    if (config.geometry) object.geometry = clone(config.geometry); if (config.media) object.media = clone(config.media); return object;
  }
  function generate() {
    syncModelsFromInputs(); saveHistory(); state.objects = []; const bounds = stageBounds(); const counts = defaults.counts; const margin = .6;
    for (let i = 0; i < counts.screen; i++) state.objects.push(newObject("screen", bounds.minX + state.stage.width * ((i + 1) / (counts.screen + 1)), bounds.minZ + margin));
    for (let i = 0; i < counts.projector; i++) state.objects.push(newObject("projector", state.stage.centerX, bounds.maxZ - margin, { y: 180 }));
    for (let i = 0; i < counts.light; i++) { const columns = 2; state.objects.push(newObject("light", bounds.minX + state.stage.width * ((i % columns + 1) / (columns + 1)), bounds.minZ + state.stage.depth * ((Math.floor(i / columns) + 1) / 3), { x: -45, y: 0 })); }
    for (let i = 0; i < counts.surface; i++) state.objects.push(newObject("surface", bounds.minX + margin, state.stage.centerZ, { y: 90 }));
    for (let i = 0; i < counts.camera; i++) state.objects.push(newObject("camera", state.stage.centerX, bounds.maxZ - margin, { y: 180 }));
    state.selectedId = state.objects[0]?.id ?? null; state.openGroups = new Set(); state.expandedIds = new Set(); persist(); render();
  }

  function syncStaticInputs() {
    Object.entries(state.room).forEach(([key, value]) => { if (roomInputs[key]) roomInputs[key].value = formatValue(value); });
    Object.entries(state.stage).forEach(([key, value]) => { if (stageInputs[key]) stageInputs[key].value = formatValue(value); });
  }
  function syncModelsFromInputs() {
    state.room.width = clamp(finite(roomInputs.width.value, state.room.width), 2, 100); state.room.depth = clamp(finite(roomInputs.depth.value, state.room.depth), 2, 100);
    state.stage.width = clamp(finite(stageInputs.width.value, state.stage.width), .5, 100); state.stage.depth = clamp(finite(stageInputs.depth.value, state.stage.depth), .5, 100); state.stage.height = clamp(finite(stageInputs.height.value, state.stage.height), 0, 20);
    state.stage.centerX = finite(stageInputs.centerX.value, state.stage.centerX); state.stage.centerZ = finite(stageInputs.centerZ.value, state.stage.centerZ); state.stage.floorY = finite(stageInputs.floorY.value, state.stage.floorY); syncStaticInputs();
  }
  function bindScrub(input, getter, setter, step = .1) {
    input.dataset.step = step; input.classList.add("scrub-input");
    input.addEventListener("input", () => {
      const parsed = finite(input.value, Number.NaN); if (!Number.isFinite(parsed)) return;
      setter(parsed); persist(); drawScene();
    });
    input.addEventListener("change", () => { saveHistory(); setter(finite(input.value, getter())); input.value = formatValue(getter(), step); persist(); render(); });
    input.addEventListener("pointerdown", event => { if (event.button !== 0) return; state.scrub = { input, pointerId: event.pointerId, startX: event.clientX, startValue: getter(), step, moved: false }; saveHistory(); input.setPointerCapture?.(event.pointerId); });
    input.addEventListener("pointermove", event => { const scrub = state.scrub; if (!scrub || scrub.input !== input || scrub.pointerId !== event.pointerId) return; const dx = event.clientX - scrub.startX; if (Math.abs(dx) < 4) return; scrub.moved = true; setter(scrub.startValue + Math.round(dx / 8) * scrub.step); input.value = formatValue(getter(), step); drawScene(); });
    const finish = event => { const scrub = state.scrub; if (!scrub || scrub.input !== input || scrub.pointerId !== event.pointerId) return; state.scrub = null; persist(); if (input.hasPointerCapture?.(event.pointerId)) input.releasePointerCapture(event.pointerId); render(); };
    input.addEventListener("pointerup", finish); input.addEventListener("pointercancel", finish);
  }
  function setupStaticInputs() {
    Object.entries(roomInputs).forEach(([key, input]) => bindScrub(input, () => state.room[key], value => { state.room[key] = clamp(value, 2, 100); }, .1));
    Object.entries(stageInputs).forEach(([key, input]) => bindScrub(input, () => state.stage[key], value => { state.stage[key] = ["width", "depth"].includes(key) ? clamp(value, .5, 100) : key === "height" ? clamp(value, 0, 20) : value; }, .1));
  }

  function sizing() {
    const rect = canvas.getBoundingClientRect(); const dpr = window.devicePixelRatio || 1; canvas.width = Math.max(1, Math.floor(rect.width * dpr)); canvas.height = Math.max(1, Math.floor(rect.height * dpr)); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const padding = 62; const base = Math.min((rect.width - padding * 2) / state.room.width, (rect.height - padding * 2) / state.room.depth); const scale = Math.max(4, base * state.zoom); const roomWidth = state.room.width * scale; const roomHeight = state.room.depth * scale;
    return { rect, scale, left: (rect.width - roomWidth) / 2, top: (rect.height - roomHeight) / 2, roomWidth, roomHeight };
  }
  function toScreen(x, z, frame) { const bounds = roomBounds(); return { x: frame.left + (x - bounds.minX) * frame.scale, y: frame.top + (bounds.maxZ - z) * frame.scale }; }
  function toWorld(x, y, frame) { const bounds = roomBounds(); return { x: bounds.minX + (x - frame.left) / frame.scale, z: bounds.maxZ - (y - frame.top) / frame.scale }; }
  function drawGrid(frame) {
    const bounds = roomBounds(); ctx.fillStyle = "#10161c"; ctx.fillRect(0, 0, frame.rect.width, frame.rect.height); ctx.save(); ctx.beginPath(); ctx.rect(frame.left, frame.top, frame.roomWidth, frame.roomHeight); ctx.clip(); ctx.strokeStyle = "rgba(157,169,183,.1)"; ctx.lineWidth = 1;
    for (let x = Math.ceil(bounds.minX); x <= bounds.maxX; x += 1) { const p = toScreen(x, bounds.minZ, frame); ctx.beginPath(); ctx.moveTo(p.x, frame.top); ctx.lineTo(p.x, frame.top + frame.roomHeight); ctx.stroke(); }
    for (let z = Math.ceil(bounds.minZ); z <= bounds.maxZ; z += 1) { const p = toScreen(bounds.minX, z, frame); ctx.beginPath(); ctx.moveTo(frame.left, p.y); ctx.lineTo(frame.left + frame.roomWidth, p.y); ctx.stroke(); }
    const stage = stageBounds(); const a = toScreen(stage.minX, stage.maxZ, frame); const b = toScreen(stage.maxX, stage.minZ, frame); ctx.fillStyle = "rgba(78,156,255,.07)"; ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y); ctx.strokeStyle = "rgba(78,156,255,.55)"; ctx.lineWidth = 1.5; ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
    state.guides.forEach(guide => { ctx.strokeStyle = "rgba(248,200,77,.75)"; ctx.setLineDash([5, 4]); ctx.beginPath(); if (guide.axis === "x") { const p = toScreen(guide.value, 0, frame); ctx.moveTo(p.x, frame.top); ctx.lineTo(p.x, frame.top + frame.roomHeight); } else { const p = toScreen(0, guide.value, frame); ctx.moveTo(frame.left, p.y); ctx.lineTo(frame.left + frame.roomWidth, p.y); } ctx.stroke(); ctx.setLineDash([]); });
    ctx.restore(); ctx.strokeStyle = "#92a0ae"; ctx.lineWidth = 2; ctx.strokeRect(frame.left, frame.top, frame.roomWidth, frame.roomHeight);
  }
  function drawDirection(config, frame, length, spread) { ctx.globalAlpha = .25; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(length * frame.scale, -spread * frame.scale); ctx.lineTo(length * frame.scale, spread * frame.scale); ctx.closePath(); ctx.fillStyle = config.color; ctx.fill(); ctx.globalAlpha = 1; }
  function drawObject(object, frame) {
    const position = toScreen(object.transform.position.x, object.transform.position.z, frame); const config = typeConfig[object.type]; const selected = object.id === state.selectedId;
    ctx.save(); ctx.translate(position.x, position.y); ctx.rotate(-object.transform.rotation.y * Math.PI / 180); ctx.fillStyle = config.color; ctx.strokeStyle = selected ? "#fff" : config.color; ctx.lineWidth = selected ? 2.5 : 1.2;
    if (PLANAR_TYPES.has(object.type)) { const w = object.geometry.width * frame.scale; const t = Math.max(5, .1 * frame.scale); if (object.type === "surface") ctx.globalAlpha = .42; ctx.fillRect(-w / 2, -t / 2, w, t); ctx.globalAlpha = 1; ctx.strokeRect(-w / 2, -t / 2, w, t); }
    if (object.type === "projector") { drawDirection(config, frame, 4, 1.8); const r = config.radius * frame.scale; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.fillStyle = "#10161c"; ctx.beginPath(); ctx.arc(frame.scale * .25, 0, Math.max(2, r * .28), 0, Math.PI * 2); ctx.fill(); }
    if (object.type === "light") { drawDirection(config, frame, 3, 1.1); const r = Math.max(5, config.radius * frame.scale); ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.fillStyle = "#10161c"; ctx.beginPath(); ctx.arc(0, 0, Math.max(2, r * .32), 0, Math.PI * 2); ctx.fill(); }
    if (object.type === "camera") { drawDirection(config, frame, 3, 1.4); const r = config.radius * frame.scale; ctx.beginPath(); ctx.moveTo(r, 0); ctx.lineTo(-r * .8, -r * .75); ctx.lineTo(-r * .8, r * .75); ctx.closePath(); ctx.fill(); ctx.stroke(); }
    ctx.restore(); if (selected) { ctx.fillStyle = "#fff"; ctx.font = "12px Inter,sans-serif"; ctx.textAlign = "center"; ctx.fillText(object.name, position.x, position.y - 16); }
  }
  function drawScene() { const frame = sizing(); drawGrid(frame); state.objects.forEach(object => drawObject(object, frame)); emptyHint.hidden = state.objects.length > 0; document.querySelector("#zoom-level").textContent = `${Math.round(state.zoom * 100)}%`; document.querySelector("#scene-summary").textContent = `Помещение ${state.room.width.toFixed(1)} × ${state.room.depth.toFixed(1)} м · сцена ${state.stage.width.toFixed(1)} × ${state.stage.depth.toFixed(1)} × ${state.stage.height.toFixed(1)} м`; }
  function selectedObject() { return state.objects.find(object => object.id === state.selectedId); }
  function objectRadius(object, frame) { return PLANAR_TYPES.has(object.type) ? object.geometry.width * frame.scale / 2 : Math.max(12, (typeConfig[object.type].radius || .3) * frame.scale * 1.8); }
  function hitTest(clientX, clientY) { const rect = canvas.getBoundingClientRect(); const frame = sizing(); const point = { x: clientX - rect.left, y: clientY - rect.top }; return [...state.objects].reverse().find(object => { const p = toScreen(object.transform.position.x, object.transform.position.z, frame); return Math.hypot(point.x - p.x, point.y - p.y) < objectRadius(object, frame) + 7; }); }
  function snapCoordinate(axis, value, object) {
    const mode = document.querySelector("#snap-mode").value; let result = value; if (mode === "grid-1") result = Math.round(result); if (mode === "grid-01") result = Math.round(result * 10) / 10;
    const stage = stageBounds(); const center = axis === "x" ? state.stage.centerX : state.stage.centerZ; const min = axis === "x" ? stage.minX : stage.minZ; const max = axis === "x" ? stage.maxX : stage.maxZ;
    const candidates = [{ value: center }, { value: min }, { value: max }]; state.objects.filter(item => item.id !== object.id && item.type === object.type).forEach(item => { const other = item.transform.position[axis]; candidates.push({ value: other }, { value: center * 2 - other }); });
    const nearest = candidates.map(candidate => ({ ...candidate, distance: Math.abs(candidate.value - result) })).sort((a, b) => a.distance - b.distance)[0]; if (nearest && nearest.distance <= .16) { result = nearest.value; state.guides.push({ axis, value: result }); }
    return result;
  }

  function element(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; }
  function fieldDefinition(object) {
    const fields = [];
    if (object.geometry) fields.push(["Ширина", "geometry.width", object.geometry.width, .1, "м"], ["Высота", "geometry.height", object.geometry.height, .1, "м"]);
    fields.push(["X", "transform.position.x", object.transform.position.x, .1, "м"], [PLANAR_TYPES.has(object.type) ? "Y нижнего края" : ["projector", "camera"].includes(object.type) ? "Y объектива" : "Y", "transform.position.y", object.transform.position.y, .1, "м"], ["Z", "transform.position.z", object.transform.position.z, .1, "м"]);
    if (PLANAR_TYPES.has(object.type)) fields.push(["Поворот по плану", "transform.rotation.y", object.transform.rotation.y, .1, "°"]); else fields.push(["Наклон X", "transform.rotation.x", object.transform.rotation.x, .1, "°"], ["Направление Y", "transform.rotation.y", object.transform.rotation.y, .1, "°"], ["Наклон Z", "transform.rotation.z", object.transform.rotation.z, .1, "°"]);
    if (object.media) fields.push(["Разрешение X", "media.resolutionX", object.media.resolutionX, 1, "px"], ["Разрешение Y", "media.resolutionY", object.media.resolutionY, 1, "px"]); if (object.type === "screen") fields.push(["Шаг пикселя", "media.pixelPitchMm", object.media.pixelPitchMm, .1, "мм"]);
    return fields;
  }
  function getPath(object, path) { return path.split(".").reduce((value, key) => value[key], object); }
  function setPath(object, path, value) { const keys = path.split("."); const last = keys.pop(); const target = keys.reduce((current, key) => current[key], object); target[last] = path.startsWith("media.resolution") ? Math.max(1, Math.round(value)) : Number(value.toFixed(3)); if (PLANAR_TYPES.has(object.type)) { object.transform.rotation.x = 0; object.transform.rotation.z = 0; } }
  function makeObjectField(object, definition) {
    const [labelText, path, value, step, unit] = definition; const label = element("label", "object-field"); label.append(element("span", "object-field-label", labelText)); const shell = element("span", "input-shell"); const input = document.createElement("input"); input.type = "text"; input.inputMode = "decimal"; input.value = formatValue(value, step); input.dataset.field = path; input.setAttribute("aria-label", `${object.name}: ${labelText}`); shell.append(input, element("i", "input-unit", unit)); label.append(shell);
    bindScrub(input, () => getPath(object, path), next => setPath(object, path, next), step); return label;
  }
  function renderObjectGroups() {
    objectGroups.replaceChildren();
    GROUP_ORDER.forEach(type => {
      const config = typeConfig[type]; const objects = state.objects.filter(object => object.type === type); const group = element("details", "object-group"); group.open = state.openGroups.has(type); group.addEventListener("toggle", () => group.open ? state.openGroups.add(type) : state.openGroups.delete(type));
      const summary = element("summary", "object-group-summary"); const title = element("span", "group-title"); title.append(element("span", "group-swatch"), document.createTextNode(config.group), element("b", "group-count", String(objects.length))); title.querySelector(".group-swatch").style.background = config.color; const add = element("button", "group-add", "+"); add.type = "button"; add.title = `Добавить: ${config.label}`; add.setAttribute("aria-label", `Добавить ${config.label}`); add.addEventListener("click", event => { event.preventDefault(); event.stopPropagation(); addObject(type); }); summary.append(title, add); group.append(summary);
      const list = element("div", "object-list"); objects.forEach(object => {
        const entry = element("details", "object-entry"); entry.open = state.expandedIds.has(object.id); if (object.id === state.selectedId) entry.classList.add("selected"); entry.addEventListener("toggle", () => entry.open ? state.expandedIds.add(object.id) : state.expandedIds.delete(object.id));
        const objectSummary = element("summary", "object-summary"); const name = element("span", "object-name", object.name); const remove = element("button", "object-remove", "×"); remove.type = "button"; remove.title = "Удалить объект"; remove.setAttribute("aria-label", `Удалить ${object.name}`); remove.addEventListener("click", event => { event.preventDefault(); event.stopPropagation(); deleteObject(object.id); }); objectSummary.append(name, remove); objectSummary.addEventListener("click", () => { state.selectedId = object.id; }); entry.append(objectSummary);
        const body = element("div", "object-properties"); fieldDefinition(object).forEach(definition => body.append(makeObjectField(object, definition))); entry.append(body); list.append(entry);
      }); group.append(list); objectGroups.append(group);
    });
  }
  function render() { syncStaticInputs(); drawScene(); renderObjectGroups(); }
  function addObject(type) { syncModelsFromInputs(); saveHistory(); const object = newObject(type); state.objects.push(object); state.selectedId = object.id; state.openGroups.add(type); state.expandedIds.add(object.id); persist(); render(); }
  function deleteObject(id) { const index = state.objects.findIndex(object => object.id === id); if (index < 0) return; saveHistory(); state.objects.splice(index, 1); state.expandedIds.delete(id); if (state.selectedId === id) state.selectedId = null; persist(); render(); }

  function canonical(value) { if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`; return JSON.stringify(value); }
  function changedValue(previous, current) { if (previous && current && typeof previous === "object" && typeof current === "object" && !Array.isArray(previous) && !Array.isArray(current)) { const result = {}; Object.keys(current).forEach(key => { const change = changedValue(previous[key], current[key]); if (change !== undefined) result[key] = change; }); return Object.keys(result).length ? result : undefined; } return canonical(previous) === canonical(current) ? undefined : current; }
  function objectPayload(object) { const payload = { pluginId: object.pluginId, type: object.type, name: object.name, transform: clone(object.transform) }; if (object.geometry) payload.geometry = clone(object.geometry); if (object.media) payload.media = clone(object.media); return payload; }
  function validateReadback(expected, result, tolerance = .001) {
    const actual = result?.readback; if (!actual) throw new Error("Designer не вернул координаты объекта для проверки"); const mismatches = [];
    const compare = (path, wanted, got) => { if (!Number.isFinite(Number(got)) || Math.abs(Number(wanted) - Number(got)) > tolerance) mismatches.push(`${path}: ожидалось ${wanted}, получено ${got}`); };
    const compareAngle = (path, wanted, got) => { const difference = Math.abs((((Number(wanted) - Number(got)) % 360) + 540) % 360 - 180); if (!Number.isFinite(Number(got)) || difference > tolerance) mismatches.push(`${path}: ожидалось ${wanted}, получено ${got}`); };
    ["x", "y", "z"].forEach(axis => compare(`position.${axis}`, expected.transform.position[axis], actual.transform?.position?.[axis])); ["x", "y", "z"].forEach(axis => compareAngle(`rotation.${axis}`, expected.transform.rotation[axis], actual.transform?.rotation?.[axis])); if (expected.geometry) { compare("geometry.width", expected.geometry.width, actual.geometry?.width); compare("geometry.height", expected.geometry.height, actual.geometry?.height); }
    if (mismatches.length) throw new Error(`Проверка координат Designer не пройдена: ${mismatches.join("; ")}`); return true;
  }
  function getAdapter() { const adapter = globalThis.disguiseSceneAdapter; return adapter && ["inspectScene", "createObject", "updateObject"].every(method => typeof adapter[method] === "function") ? adapter : null; }
  function typeOfSceneObject(item) { return item.type || ({ ledScreens: "screen", surfaces: "surface", cameras: "camera", projectors: "projector", lights: "light" }[item.collection]); }
  function isStandardCandidate(item) { return Boolean(item.standard || /(^|[\\/ _-])(surface|projector|camera|screen|light)[ _-]?1(?:\.|$)/i.test(`${item.path || ""} ${item.description || ""} ${item.name || ""}`)); }
  async function makeDiff(adapter, mode = "update") {
    const designerScene = adapter ? await adapter.inspectScene() : null; const inspected = designerScene?.objects || []; const records = state.sync.objects || {}; const byId = new Map(inspected.map(item => [String(item.id || item.uid), item])); const usedIds = new Set(); const currentIds = new Set(state.objects.map(object => object.pluginId));
    const diff = { create: [], update: [], adopt: [], unchanged: [], orphans: [], preserve: [], standardCandidates: inspected.filter(isStandardCandidate), designerCount: inspected.length, inspectionWarnings: designerScene?.warnings || [], adapter, mode, floorY: designerScene?.floorY ?? 0 };
    for (const object of state.objects) {
      const payload = objectPayload(object); const serialized = canonical(payload); let record = records[object.pluginId]; let designerId = record?.designerId; let designerObject = designerId ? byId.get(String(designerId)) : null;
      if (!designerObject && record?.path) designerObject = inspected.find(item => String(item.path || "") === String(record.path)); if (!designerObject) designerObject = inspected.find(item => (item.managed && String(item.pluginId || "") === object.pluginId) || String(item.path || "").includes(`dsg-${object.pluginId}`)); if (designerObject) { designerId = String(designerObject.id || designerObject.uid); record = { ...(record || {}), designerId, path: designerObject.path }; }
      if (designerId && designerObject) { usedIds.add(String(designerId)); if (record?.lastExported === serialized) diff.unchanged.push({ object, payload, designerId, designerPath: designerObject.path }); else diff.update.push({ object, payload, serialized, designerId, designerPath: designerObject.path, changed: changedValue(record?.payload || {}, payload) || {} }); continue; }
      const candidate = diff.standardCandidates.find(item => !usedIds.has(String(item.id)) && typeOfSceneObject(item) === object.type); if (mode === "update" && candidate) { usedIds.add(String(candidate.id)); diff.adopt.push({ object, payload, serialized, designerId: String(candidate.id), candidate }); } else diff.create.push({ object, payload, serialized });
    }
    Object.entries(records).forEach(([pluginId, record]) => { if (!currentIds.has(pluginId) && record?.designerId) diff.orphans.push({ pluginId, designerId: record.designerId, name: record.name || pluginId }); }); diff.preserve = inspected.filter(item => !usedIds.has(String(item.id)) && !isStandardCandidate(item)); diff.standardCandidates = inspected.filter(item => isStandardCandidate(item) && !usedIds.has(String(item.id))); return diff;
  }
  function setDiffText(diff) { document.querySelector("#diff-create").textContent = diff.create.length; document.querySelector("#diff-update").textContent = diff.update.length + diff.adopt.length; document.querySelector("#diff-unchanged").textContent = diff.unchanged.length; document.querySelector("#diff-preserve").textContent = diff.preserve.length; document.querySelector("#diff-orphans").textContent = diff.orphans.length; document.querySelector("#diff-delete").textContent = diff.standardCandidates.length; }
  function renderStandardChecklist(diff) { const list = document.querySelector("#standard-checklist"); list.replaceChildren(); if (!diff?.standardCandidates?.length) { list.textContent = "Нет узнаваемых стандартных объектов."; return; } diff.standardCandidates.forEach(item => { const label = element("label", "check-row"); const checkbox = document.createElement("input"); checkbox.type = "checkbox"; checkbox.value = String(item.id); label.append(checkbox, element("span", "", item.description || item.name || item.path || item.id)); list.append(label); }); }
  async function openSyncDialog() {
    const adapter = getAdapter(); const modal = document.querySelector("#sync-modal"); const message = document.querySelector("#sync-message"); const warning = document.querySelector("#sync-warning"); const confirm = document.querySelector("#confirm-sync"); const mode = document.querySelector("input[name=sync-mode]:checked")?.value || "update"; let diff;
    try { diff = await makeDiff(adapter, mode); } catch (error) { setDiffText({ create: [], update: [], adopt: [], unchanged: [], orphans: [], preserve: [], standardCandidates: [] }); modal.hidden = false; modal._diff = null; message.textContent = "Designer API не отвечает. Экспорт в проект не выполнен."; warning.textContent = error.message || String(error); warning.hidden = false; confirm.disabled = true; return; }
    setDiffText(diff); renderStandardChecklist(diff); modal.hidden = false; modal._diff = diff; if (!adapter) { message.textContent = "Прямое подключение к Designer пока не найдено."; warning.textContent = "Для обмена планом используйте «Экспорт JSON»."; warning.hidden = false; confirm.disabled = true; return; }
    message.textContent = diff.designerCount ? `В текущей сцене обнаружено ${diff.designerCount} объект(ов). Ручные объекты (${diff.preserve.length}) останутся без изменений.` : "Текущая сцена пуста. Будут созданы только объекты этого плана."; const warnings = [diff.standardCandidates.length ? `Узнаваемые стандартные объекты: ${diff.standardCandidates.length}.` : "Из Designer ничего автоматически удаляться не будет."]; if (diff.inspectionWarnings.length) warnings.push(`Пропущено повреждённых ссылок: ${diff.inspectionWarnings.length}.`); warning.textContent = warnings.join(" "); warning.hidden = false; confirm.disabled = adapter.capabilities?.liveUpdate !== true;
  }
  async function syncToDesigner(diff) {
    const records = state.sync.objects || {};
    for (const item of [...diff.create, ...diff.adopt]) { try { const result = item.designerId ? await diff.adapter.updateObject(item.designerId, item.payload, item.candidate?.path, item.object.type) : await diff.adapter.createObject(item.payload); validateReadback(item.payload, result); item.designerId = result?.designerId || result?.id || item.designerId; item.designerPath = result?.path || item.candidate?.path; } catch (error) { throw new Error(`${item.designerId ? "Обновление" : "Создание"} «${item.object.name}»: ${error.message || error}`); } records[item.object.pluginId] = { pluginId: item.object.pluginId, designerId: item.designerId || `dsg:${item.object.pluginId}`, path: item.designerPath, type: item.object.type, name: item.object.name, lastExported: item.serialized, payload: item.payload, adopted: Boolean(item.candidate) }; state.sync.objects = records; persist(); }
    for (const item of diff.update) { try { const result = await diff.adapter.updateObject(item.designerId, item.changed, item.designerPath || records[item.object.pluginId]?.path, item.object.type); validateReadback(item.payload, result); item.designerPath = result?.path || item.designerPath; } catch (error) { throw new Error(`Обновление «${item.object.name}»: ${error.message || error}`); } records[item.object.pluginId] = { ...(records[item.object.pluginId] || {}), pluginId: item.object.pluginId, designerId: item.designerId, path: item.designerPath || records[item.object.pluginId]?.path, type: item.object.type, name: item.object.name, lastExported: item.serialized, payload: item.payload }; state.sync.objects = records; persist(); }
    state.sync.designerScene = { inspectedAt: new Date().toISOString(), objectCount: diff.designerCount, floorY: diff.floorY }; state.sync.lastSyncAt = new Date().toISOString(); persist();
  }
  async function confirmSync() { const modal = document.querySelector("#sync-modal"); const diff = modal._diff; if (!diff?.adapter) return; const button = document.querySelector("#confirm-sync"); button.disabled = true; button.textContent = "Синхронизация…"; try { await syncToDesigner(diff); modal.hidden = true; document.querySelector("#adapter-status").textContent = `Designer API: координаты проверены · ${new Date().toLocaleTimeString()}`; } catch (error) { document.querySelector("#sync-warning").textContent = `Синхронизация остановлена: ${error.message || error}`; document.querySelector("#sync-warning").hidden = false; } finally { button.disabled = false; button.textContent = "Экспортировать изменения"; } }
  async function deleteSelectedStandards() { const modal = document.querySelector("#sync-modal"); const diff = modal._diff; const ids = [...document.querySelectorAll("#standard-checklist input:checked")].map(input => input.value); if (!diff?.adapter || !ids.length || typeof diff.adapter.deleteObjects !== "function") return; if (!window.confirm(`Удалить ${ids.length} выбранных стандартных объектов?`)) return; try { await diff.adapter.deleteObjects(ids); modal.hidden = true; } catch (error) { document.querySelector("#sync-warning").textContent = `Очистка остановлена: ${error.message || error}`; } }
  function exportSceneJson() { const output = { version: VERSION, units: "metres", coordinateSystem: "Designer world XYZ; top view X/Z; no room-relative transform", room: state.room, stage: state.stage, objects: state.objects.map(({ id, ...object }) => object) }; const blob = new Blob([JSON.stringify(output, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = "disguise-scene-plan.json"; link.click(); URL.revokeObjectURL(url); }

  document.querySelector("#reset-button").addEventListener("click", generate); document.querySelector("#export-button").addEventListener("click", openSyncDialog); document.querySelector("#json-button").addEventListener("click", exportSceneJson); document.querySelector("#confirm-sync").addEventListener("click", confirmSync); document.querySelector("#delete-standards").addEventListener("click", deleteSelectedStandards); document.querySelectorAll("input[name=sync-mode]").forEach(input => input.addEventListener("change", () => { if (!document.querySelector("#sync-modal").hidden) openSyncDialog(); })); ["#close-sync", "#cancel-sync"].forEach(selector => document.querySelector(selector).addEventListener("click", () => { document.querySelector("#sync-modal").hidden = true; }));
  document.querySelector("#undo-button").addEventListener("click", () => applyHistory("undo")); document.querySelector("#redo-button").addEventListener("click", () => applyHistory("redo")); document.querySelector("#zoom-in").addEventListener("click", () => { state.zoom = clamp(state.zoom + .15, .5, 2); drawScene(); }); document.querySelector("#zoom-out").addEventListener("click", () => { state.zoom = clamp(state.zoom - .15, .5, 2); drawScene(); });
  document.querySelector("#align-x").addEventListener("click", () => { const object = selectedObject(); if (!object) return; saveHistory(); object.transform.position.x = state.stage.centerX; persist(); render(); }); document.querySelector("#align-z").addEventListener("click", () => { const object = selectedObject(); if (!object) return; saveHistory(); object.transform.position.z = state.stage.centerZ; persist(); render(); });
  canvas.addEventListener("pointerdown", event => { const object = hitTest(event.clientX, event.clientY); state.selectedId = object?.id ?? null; if (object) { const rect = canvas.getBoundingClientRect(); const point = toWorld(event.clientX - rect.left, event.clientY - rect.top, sizing()); saveHistory(); state.dragging = { id: object.id, offsetX: object.transform.position.x - point.x, offsetZ: object.transform.position.z - point.z }; canvas.setPointerCapture(event.pointerId); state.openGroups.add(object.type); } render(); });
  canvas.addEventListener("pointermove", event => { if (!state.dragging) return; const rect = canvas.getBoundingClientRect(); const point = toWorld(event.clientX - rect.left, event.clientY - rect.top, sizing()); const object = state.objects.find(item => item.id === state.dragging.id); if (!object) return; const bounds = roomBounds(); state.guides = []; object.transform.position.x = Number(clamp(snapCoordinate("x", point.x + state.dragging.offsetX, object), bounds.minX, bounds.maxX).toFixed(3)); object.transform.position.z = Number(clamp(snapCoordinate("z", point.z + state.dragging.offsetZ, object), bounds.minZ, bounds.maxZ).toFixed(3)); drawScene(); });
  canvas.addEventListener("pointerup", event => { state.dragging = null; state.guides = []; persist(); render(); if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId); }); canvas.addEventListener("pointercancel", () => { state.dragging = null; state.guides = []; persist(); render(); }); window.addEventListener("resize", drawScene);

  setupStaticInputs(); if (!loadPersisted()) generate(); else { syncStaticInputs(); render(); } const adapter = getAdapter(); document.querySelector("#adapter-status").textContent = adapter ? `Designer API: ${adapter.capabilities?.source || "адаптер найден"}` : "Designer API: не подключён · JSON доступен";
  globalThis.scenePlannerDebug = { state, makeDiff, syncToDesigner, objectPayload, validateReadback, canonical, changedValue, normalizeObject, roomBounds, stageBounds, toScreen, toWorld, snapCoordinate, typeConfig, finite, newObject };
})();
