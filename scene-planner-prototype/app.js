(() => {
  const VERSION = 11;
  const STORAGE_KEY = "disguise-scene-generator-state-v11";
  const ZOOM_MIN = .1;
  const ZOOM_MAX = 3;
  const STANDALONE_PREVIEW = ["127.0.0.1", "localhost"].includes(location.hostname) && String(location.port) === "4173";
  const PLANAR_TYPES = new Set(["screen", "dmxScreen", "surface"]);
  const GROUP_ORDER = ["screen", "dmxScreen", "surface", "projector", "dmxLight", "camera", "designer"];
  const defaults = {
    stage: { width: 20, depth: 12 },
  };
  const typeConfig = {
    screen: { label: "LED Screen", group: "LED Screens", color: "#3dd9d4", geometry: { width: 4, height: 2 }, media: { inputMode: "resolution", resolutionX: 1920, resolutionY: 1200, pixelsPerInch: 10, pixelPitchMm: 2.54 } },
    dmxScreen: { label: "DMX Screen", group: "DMX Screens", color: "#62d7a7", geometry: { width: 4, height: 2 }, media: { resolutionX: 1920, resolutionY: 1200 } },
    projector: { label: "Projector", group: "Projectors", color: "#c084fc", radius: 0.38, defaultHeight: 3, media: { resolutionX: 1920, resolutionY: 1080 } },
    dmxLight: { label: "DMX Light", group: "DMX Lights", color: "#f8c84d", radius: 0.23, defaultHeight: 5 },
    surface: { label: "Projection Surface", group: "Projection Surfaces", color: "#4e9cff", geometry: { width: 3, height: 2 }, media: { resolutionX: 1920, resolutionY: 1200 } },
    camera: { label: "Camera", group: "Cameras", color: "#ff7d62", radius: 0.36, defaultHeight: 1.5 },
    designer: { label: "Designer Object", group: "Other Designer Objects", color: "#9aa7b4", radius: 0.3, defaultHeight: 0 }
  };
  const stageInputs = {
    width: document.querySelector("#scene-width") || document.querySelector("#stage-width"), depth: document.querySelector("#scene-depth") || document.querySelector("#stage-depth")
  };
  const canvas = document.querySelector("#scene-canvas");
  const ctx = canvas.getContext("2d");
  const objectGroups = document.querySelector("#object-groups");
  const activeObjectStrip = document.querySelector("#active-object-strip");
  const emptyHint = document.querySelector("#empty-hint");
  const canvasContextMenu = document.querySelector("#canvas-context-menu");
  const state = {
    stage: { ...defaults.stage }, objects: [], selectedId: null, selectedIds: new Set(), highlightObjectId: null, showSurfaceLabels: false, zoom: 1, liveEnabled: false,
    history: [], future: [], dragging: null, placingProjectorId: null, guides: [], pan: { x: 0, y: 0 },
    sync: { objects: {}, lastSyncAt: null, errors: {} },
    lastHeights: {}
  };
  let nextId = 1;
  let contextObjectId = null;
  let contextWorldPoint = null;
  let appReady = false;
  let liveSyncTimer = null;
  let liveSyncInFlight = false;
  let liveSyncQueued = false;
  let activeFieldRefs = new Map();
  let liveIntent = 0;
  let liveSceneImportTimer = null;
  let clipboardObjects = [];

  const clone = value => JSON.parse(JSON.stringify(value));
  const vector = value => ({ x: finite(value?.x, 0), y: finite(value?.y, 0), z: finite(value?.z, 0) });
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const normalizeYaw = value => Number(((((finite(value) + 180) % 360) + 360) % 360 - 180).toFixed(3));
  function finite(value, fallback = 0) {
    const normalized = typeof value === "string" ? value.trim().replace(",", ".") : value;
    if (normalized === "" || normalized === null || normalized === undefined) return fallback;
    const parsed = Number(normalized); return Number.isFinite(parsed) ? parsed : fallback;
  }
  function makeId() { return globalThis.crypto?.randomUUID?.() || `dsg-${Date.now()}-${Math.random().toString(16).slice(2)}`; }
  function stageBounds() { return { minX: -state.stage.width / 2, maxX: state.stage.width / 2, minZ: -state.stage.depth / 2, maxZ: state.stage.depth / 2 }; }
  // Object heights use the Designer floor mark, not a Stage height.
  function stageFloorY() { return 0; }
  function targetSurface(object) { return object?.targetSurfacePluginId ? state.objects.find(item => item.type === "surface" && item.pluginId === object.targetSurfacePluginId) : null; }
  function effectiveLookAt(object) {
    const surface = targetSurface(object);
    if (surface) return { x: surface.transform.position.x, y: surface.transform.position.y + surface.geometry.height / 2, z: surface.transform.position.z };
    return vector(object?.lookAt);
  }
  function lookAtFromRotation(position, rotation) {
    const yaw = finite(rotation?.y); return { x: position.x + Math.sin(yaw * Math.PI / 180), y: position.y, z: position.z + Math.cos(yaw * Math.PI / 180) };
  }
  function formatValue(value, step = .1) { let numeric = finite(value); if (Math.abs(numeric) < .0000005) numeric = 0; if (Number.isInteger(numeric)) return String(numeric); const digits = step >= 1 ? 0 : step >= .1 ? 1 : 2; return numeric.toFixed(digits).replace(".", ","); }
  function modelSnapshot() { return { version: VERSION, stage: state.stage, objects: state.objects, sync: state.sync, liveEnabled: state.liveEnabled, lastHeights: state.lastHeights }; }
  function snapshot() { return JSON.stringify(modelSnapshot()); }
  function persist(schedule = true) { localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...modelSnapshot(), nextId })); if (schedule) scheduleLiveSync(); }
  function saveHistory() { state.history.push(snapshot()); if (state.history.length > 40) state.history.shift(); state.future = []; }

  function normalizedStage(saved = {}, legacyRoom = {}, sourceVersion = VERSION) {
    const hasSavedStage = saved && typeof saved === "object" && Object.keys(saved).length > 0;
    const migratedRoom = sourceVersion < 11 && Number.isFinite(Number(legacyRoom.width)) && Number.isFinite(Number(legacyRoom.depth));
    const width = migratedRoom ? legacyRoom.width : (hasSavedStage && Number.isFinite(Number(saved.width)) ? saved.width : legacyRoom.width);
    const depth = migratedRoom ? legacyRoom.depth : (hasSavedStage && Number.isFinite(Number(saved.depth)) ? saved.depth : legacyRoom.depth);
    return {
      width: Math.max(2, finite(width, defaults.stage.width)),
      depth: Math.max(2, finite(depth, defaults.stage.depth))
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
        x: finite(oldPosition.x) - (legacyOrigin ? state.stage.width / 2 : 0), y: finite(oldPosition.y), z: finite(oldPosition.z) - (legacyOrigin ? state.stage.depth / 2 : 0)
      } : { x: finite(object.x) - state.stage.width / 2, y: finite(object.z), z: finite(object.y) - state.stage.depth / 2 };
      rotation = object.rotation && typeof object.rotation === "object" ? vector(object.rotation) : { x: 0, y: finite(object.rotation), z: 0 };
    }
    const rawType = object.type || "surface"; const aliases = { light: "dmxLight", dmx_light: "dmxLight", dmxscreen: "dmxScreen", dmx_screen: "dmxScreen" }; const normalizedType = aliases[rawType] || rawType; const type = typeConfig[normalizedType] ? normalizedType : "designer"; const config = typeConfig[type];
    if (PLANAR_TYPES.has(type)) { rotation.x = 0; rotation.z = 0; }
    const normalized = { id: Number(object.id) || index + 1, pluginId: object.pluginId || makeId(), type, name: object.name || `${config.label} ${index + 1}`, transform: { position, rotation } };
    if (config.geometry) normalized.geometry = {
      width: Math.max(.1, finite(object.geometry?.width ?? object.dimensions?.width, config.geometry.width)),
      height: Math.max(.1, finite(object.geometry?.height ?? object.dimensions?.height, config.geometry.height))
    };
    if (config.media) normalized.media = {
      resolutionX: Math.max(1, Math.round(finite(object.media?.resolutionX, config.media.resolutionX))),
      resolutionY: Math.max(1, Math.round(finite(object.media?.resolutionY, config.media.resolutionY))),
      ...(type === "screen" ? {
        inputMode: ["resolution", "ppi", "pitch"].includes(object.media?.inputMode) ? object.media.inputMode : "resolution",
        pixelsPerInch: Math.max(.1, finite(object.media?.pixelsPerInch, object.media?.pixelPitchMm ? 25.4 / finite(object.media.pixelPitchMm, 2.54) : config.media.pixelsPerInch)),
        pixelPitchMm: Math.max(.01, finite(object.media?.pixelPitchMm, object.media?.pixelsPerInch ? 25.4 / finite(object.media.pixelsPerInch, 10) : config.media.pixelPitchMm))
      } : {})
    };
    if (type === "projector") {
      normalized.lookAt = vector(object.lookAt || lookAtFromRotation(position, rotation));
      normalized.transform.rotation = { x: 0, y: 0, z: 0 };
      if (object.targetSurfacePluginId) normalized.targetSurfacePluginId = String(object.targetSurfacePluginId);
    }
    if (object.designer) normalized.designer = object.designer;
    return normalized;
  }
  function loadPersisted() {
    try {
      // Legacy v2-v10 saves may contain `room`; v11 persists only Stage.
      const keys = [STORAGE_KEY, "disguise-scene-generator-state-v10", "disguise-scene-generator-state-v9", "disguise-scene-generator-state-v8", "disguise-scene-generator-state-v7", "disguise-scene-generator-state-v6", "disguise-scene-generator-state-v5", "disguise-scene-generator-state-v4", "disguise-scene-generator-state-v3", "disguise-scene-generator-state-v2"];
      const saved = JSON.parse(keys.map(key => localStorage.getItem(key)).find(Boolean) || "null"); if (!saved) return false;
      const sourceVersion = Number(saved.version) || (saved.objects?.some(object => object.position) ? 3 : 2);
      state.stage = normalizedStage(saved.stage, saved.room || {}, sourceVersion);
      state.objects = Array.isArray(saved.objects) ? saved.objects.map((object, index) => normalizeObject(object, index, sourceVersion)) : [];
      state.sync = { objects: {}, lastSyncAt: null, errors: {}, ...(saved.sync || {}) }; state.liveEnabled = Boolean(saved.liveEnabled);
      state.lastHeights = { ...(saved.lastHeights || {}) };
      nextId = Math.max(Number(saved.nextId) || 1, ...state.objects.map(object => (Number(object.id) || 0) + 1), 1);
      state.selectedId = state.objects[0]?.id ?? null; state.selectedIds = new Set(state.selectedId ? [state.selectedId] : []); persist(); return true;
    } catch (error) { console.warn("Не удалось загрузить локальный план", error); return false; }
  }
  function restore(json) {
    const saved = JSON.parse(json); const sourceVersion = Number(saved.version) || VERSION;
    state.stage = normalizedStage(saved.stage, saved.room || {}, sourceVersion); state.objects = saved.objects.map((object, index) => normalizeObject(object, index, sourceVersion)); state.sync = { objects: {}, lastSyncAt: null, errors: {}, ...(saved.sync || {}) }; state.liveEnabled = Boolean(saved.liveEnabled); state.lastHeights = { ...(saved.lastHeights || {}) }; state.selectedId = null; state.selectedIds = new Set(); state.placingProjectorId = null;
    syncStaticInputs(); persist(); render();
  }
  function applyHistory(direction) { const source = direction === "undo" ? state.history : state.future; if (!source.length) return; const target = direction === "undo" ? state.future : state.history; target.push(snapshot()); restore(source.pop()); }

  function nextObjectName(type) {
    const label = typeConfig[type].label; const numbers = state.objects.filter(object => object.type === type).map(object => Number(String(object.name).match(/(\d+)$/)?.[1] || 0));
    return `${label} ${Math.max(0, ...numbers) + 1}`;
  }
  function newObject(type, x = 0, z = 0, rotation = {}) {
    const config = typeConfig[type]; const object = {
      id: nextId++, pluginId: makeId(), type, name: nextObjectName(type),
      transform: {
        position: { x: Number(x.toFixed(3)), y: Number((PLANAR_TYPES.has(type) ? stageFloorY() : (state.lastHeights[type] ?? config.defaultHeight ?? stageFloorY())).toFixed(3)), z: Number(z.toFixed(3)) },
        rotation: { x: PLANAR_TYPES.has(type) || type === "projector" ? 0 : finite(rotation.x), y: PLANAR_TYPES.has(type) || type === "projector" ? 0 : finite(rotation.y), z: PLANAR_TYPES.has(type) || type === "projector" ? 0 : finite(rotation.z) }
      }
    };
    if (config.geometry) object.geometry = clone(config.geometry); if (config.media) object.media = clone(config.media);
    if (type === "projector") object.lookAt = { x: 0, y: stageFloorY(), z: 0 };
    return object;
  }
  function syncStaticInputs() {
    Object.entries(state.stage).forEach(([key, value]) => { if (stageInputs[key] && typeof value !== "boolean") stageInputs[key].value = formatValue(value); });
  }
  function syncModelsFromInputs() {
    state.stage.width = clamp(finite(stageInputs.width.value, state.stage.width), 2, 100); state.stage.depth = clamp(finite(stageInputs.depth.value, state.stage.depth), 2, 100);
    syncStaticInputs();
  }
  function defaultFieldValue(object, path) {
    const config = typeConfig[object.type] || {};
    if (path === "transform.position.x" || path === "transform.position.z" || path === "transform.rotation.x" || path === "transform.rotation.y" || path === "transform.rotation.z") return 0;
    if (path === "transform.position.y") return config.defaultHeight ?? 0;
    if (path.startsWith("geometry.") && config.geometry) return config.geometry[path.slice("geometry." )];
    if (path.startsWith("media.") && config.media) return config.media[path.slice("media." )];
    return undefined;
  }
  function selectInputText(input) { const select = () => input.select?.(); input.addEventListener("focus", select); input.addEventListener("pointerup", event => { if (document.activeElement === input) { event.preventDefault(); select(); } }); }
  function bindNumericInput(input, getter, setter, step = .1, defaultValue = undefined) {
    input.dataset.step = step; input.classList.add("wheel-input"); selectInputText(input);
    input.addEventListener("keydown", event => {
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      event.preventDefault(); saveHistory(); const direction = event.key === "ArrowUp" ? 1 : -1; const multiplier = event.shiftKey ? 10 : 1;
      setter(Number((getter() + direction * step * multiplier).toFixed(3))); input.value = formatValue(getter(), step); persist(); render();
    });
    input.addEventListener("input", () => {
      const parsed = finite(input.value, Number.NaN); if (!Number.isFinite(parsed)) return;
      setter(parsed); persist(); drawScene();
    });
    input.addEventListener("change", () => { saveHistory(); setter(finite(input.value, getter())); input.value = formatValue(getter(), step); persist(); render(); });
    input.addEventListener("contextmenu", event => {
      const fallback = typeof defaultValue === "function" ? defaultValue() : defaultValue;
      if (!Number.isFinite(Number(fallback))) return;
      event.preventDefault(); saveHistory(); setter(Number(fallback)); input.value = formatValue(getter(), step); persist(); render();
    });
    input.addEventListener("wheel", event => {
      event.preventDefault(); saveHistory(); const direction = event.deltaY < 0 ? 1 : -1; const multiplier = event.shiftKey ? 10 : 1;
      setter(Number((getter() + direction * step * multiplier).toFixed(3))); input.value = formatValue(getter(), step); persist(); render();
    }, { passive: false });
  }
  function setupStaticInputs() {
    ["width", "depth"].forEach(key => bindNumericInput(stageInputs[key], () => state.stage[key], value => { state.stage[key] = clamp(value, 2, 100); }, .1, defaults.stage[key]));
  }

  function sizing(resizeCanvas = true) {
    const rect = canvas.getBoundingClientRect(); const dpr = window.devicePixelRatio || 1;
    if (resizeCanvas) { const width = Math.max(1, Math.floor(rect.width * dpr)); const height = Math.max(1, Math.floor(rect.height * dpr)); if (canvas.width !== width) canvas.width = width; if (canvas.height !== height) canvas.height = height; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }
    const padding = 62; const base = Math.min((rect.width - padding * 2) / state.stage.width, (rect.height - padding * 2) / state.stage.depth); const scale = Math.max(4, base * state.zoom); const stageWidth = state.stage.width * scale; const stageDepth = state.stage.depth * scale;
    return { rect, scale, left: (rect.width - stageWidth) / 2 + state.pan.x, top: (rect.height - stageDepth) / 2 + state.pan.y, stageWidth, stageDepth };
  }
  function toScreen(x, z, frame) { const bounds = stageBounds(); return { x: frame.left + (x - bounds.minX) * frame.scale, y: frame.top + (bounds.maxZ - z) * frame.scale }; }
  function toWorld(x, y, frame) { const bounds = stageBounds(); return { x: bounds.minX + (x - frame.left) / frame.scale, z: bounds.maxZ - (y - frame.top) / frame.scale }; }
  function drawGrid(frame) {
    const bounds = stageBounds(); ctx.fillStyle = "#10161c"; ctx.fillRect(0, 0, frame.rect.width, frame.rect.height); ctx.save(); ctx.beginPath(); ctx.rect(frame.left, frame.top, frame.stageWidth, frame.stageDepth); ctx.clip(); ctx.fillStyle = "rgba(78,156,255,.06)"; ctx.fillRect(frame.left, frame.top, frame.stageWidth, frame.stageDepth); ctx.strokeStyle = "rgba(157,169,183,.1)"; ctx.lineWidth = 1;
    for (let x = Math.ceil(bounds.minX); x <= bounds.maxX; x += 1) { const p = toScreen(x, bounds.minZ, frame); ctx.beginPath(); ctx.moveTo(p.x, frame.top); ctx.lineTo(p.x, frame.top + frame.stageDepth); ctx.stroke(); }
    for (let z = Math.ceil(bounds.minZ); z <= bounds.maxZ; z += 1) { const p = toScreen(bounds.minX, z, frame); ctx.beginPath(); ctx.moveTo(frame.left, p.y); ctx.lineTo(frame.left + frame.stageWidth, p.y); ctx.stroke(); }
    state.guides.forEach(guide => { ctx.strokeStyle = "rgba(248,200,77,.75)"; ctx.setLineDash([5, 4]); ctx.beginPath(); if (guide.axis === "x") { const p = toScreen(guide.value, 0, frame); ctx.moveTo(p.x, frame.top); ctx.lineTo(p.x, frame.top + frame.stageDepth); } else { const p = toScreen(0, guide.value, frame); ctx.moveTo(frame.left, p.y); ctx.lineTo(frame.left + frame.stageWidth, p.y); } ctx.stroke(); ctx.setLineDash([]); });
    ctx.restore(); ctx.strokeStyle = "#92a0ae"; ctx.lineWidth = 2; ctx.strokeRect(frame.left, frame.top, frame.stageWidth, frame.stageDepth);
  }
  function directionAngle(object) {
    const position = object.transform.position;
    if (object.type === "projector" && object.lookAt) { const target = effectiveLookAt(object); return Math.atan2(target.x - position.x, target.z - position.z); }
    return finite(object.transform.rotation.y) * Math.PI / 180;
  }
  function drawDirection(config, frame, object, length, spread) {
    const start = Math.max(7, (config.radius || .3) * frame.scale);
    ctx.save(); ctx.rotate(directionAngle(object)); ctx.globalAlpha = .25; ctx.beginPath(); ctx.moveTo(0, -start); ctx.lineTo(-spread * frame.scale, -length * frame.scale); ctx.lineTo(spread * frame.scale, -length * frame.scale); ctx.closePath(); ctx.fillStyle = config.color; ctx.fill(); ctx.restore(); ctx.globalAlpha = 1;
  }
  function drawObject(object, frame) {
    const position = toScreen(object.transform.position.x, object.transform.position.z, frame); const config = typeConfig[object.type]; const selected = state.selectedIds.has(object.id) || object.id === state.selectedId; const highlighted = object.id === state.highlightObjectId;
    ctx.save(); ctx.translate(position.x, position.y); if (PLANAR_TYPES.has(object.type)) ctx.rotate(object.transform.rotation.y * Math.PI / 180); ctx.fillStyle = config.color; ctx.strokeStyle = selected ? "#fff" : config.color; ctx.lineWidth = selected ? 2.5 : 1.2;
    if (PLANAR_TYPES.has(object.type)) { const w = object.geometry.width * frame.scale; const t = Math.max(5, .1 * frame.scale); if (["surface", "dmxScreen"].includes(object.type)) ctx.globalAlpha = .42; ctx.fillRect(-w / 2, -t / 2, w, t); ctx.globalAlpha = 1; ctx.strokeRect(-w / 2, -t / 2, w, t); }
    if (object.type === "projector") { drawDirection(config, frame, object, 4, 1.8); const r = config.radius * frame.scale; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.fillStyle = "#10161c"; ctx.beginPath(); ctx.arc(0, -r * .25, Math.max(2, r * .28), 0, Math.PI * 2); ctx.fill(); }
    if (object.type === "dmxLight") { drawDirection(config, frame, object, 3, 1.1); const r = Math.max(5, config.radius * frame.scale); ctx.fillRect(-r, -r, r * 2, r * 2); ctx.strokeRect(-r, -r, r * 2, r * 2); }
    if (object.type === "camera") { drawDirection(config, frame, object, 3, 1.4); const r = config.radius * frame.scale; ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(-r * .75, r * .8); ctx.lineTo(r * .75, r * .8); ctx.closePath(); ctx.fill(); ctx.stroke(); }
    ctx.restore(); const showLabel = selected || highlighted || (state.showSurfaceLabels && object.type === "surface"); if (showLabel) { ctx.fillStyle = highlighted ? "#f8c84d" : selected ? "#fff" : "#8eb7ff"; ctx.font = `${highlighted ? "600 " : ""}12px Inter,sans-serif`; ctx.textAlign = "center"; ctx.fillText(object.name, position.x, position.y - 16); if (highlighted) { ctx.strokeStyle = "rgba(248,200,77,.85)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(position.x, position.y, Math.max(10, (object.geometry?.width || .3) * frame.scale / 2 + 6), 0, Math.PI * 2); ctx.stroke(); } }
  }
  function drawProjectorTarget(object, frame) {
    const source = toScreen(object.transform.position.x, object.transform.position.z, frame); const target = effectiveLookAt(object); const point = toScreen(target.x, target.z, frame); const selected = state.selectedIds.has(object.id) || object.id === state.selectedId;
    const radius = Math.max(7, (typeConfig.projector.radius || .3) * frame.scale); const distance = Math.hypot(point.x - source.x, point.y - source.y); const start = distance > radius ? { x: source.x + (point.x - source.x) * radius / distance, y: source.y + (point.y - source.y) * radius / distance } : source;
    ctx.save(); ctx.strokeStyle = selected ? "rgba(192,132,252,.95)" : "rgba(192,132,252,.38)"; ctx.lineWidth = selected ? 1.5 : 1; ctx.setLineDash([5, 5]); ctx.beginPath(); ctx.moveTo(start.x, start.y); ctx.lineTo(point.x, point.y); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = targetSurface(object) ? "#4e9cff" : "#10161c"; ctx.strokeStyle = "#c084fc"; ctx.lineWidth = selected ? 2.5 : 1.5; ctx.beginPath(); ctx.arc(point.x, point.y, selected ? 7 : 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.beginPath(); ctx.moveTo(point.x - 10, point.y); ctx.lineTo(point.x + 10, point.y); ctx.moveTo(point.x, point.y - 10); ctx.lineTo(point.x, point.y + 10); ctx.stroke(); ctx.restore();
  }
  function rotateHandleGeometry(object, frame) {
    const rotatable = PLANAR_TYPES.has(object.type) || ["projector", "camera", "dmxLight"].includes(object.type);
    if (!rotatable) return null;
    const centre = toScreen(object.transform.position.x, object.transform.position.z, frame);
    const angle = object.type === "projector" ? directionAngle(object) : finite(object.transform.rotation.y) * Math.PI / 180;
    const radius = PLANAR_TYPES.has(object.type) ? object.geometry.width * frame.scale / 2 : Math.max(12, (typeConfig[object.type].radius || .3) * frame.scale * 1.8);
    const corner = { x: radius, y: 0 }; const handle = { x: radius + 17, y: -17 };
    const transform = point => ({ x: centre.x + Math.cos(angle) * point.x - Math.sin(angle) * point.y, y: centre.y + Math.sin(angle) * point.x + Math.cos(angle) * point.y });
    return { centre, corner: transform(corner), handle: transform(handle), handleAngleOffset: 0 };
  }
  function drawRotateHandle(object, frame) {
    const geometry = rotateHandleGeometry(object, frame); if (!geometry) return; ctx.save(); ctx.strokeStyle = "#eef2f6"; ctx.fillStyle = "#17202a"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(geometry.corner.x, geometry.corner.y); ctx.lineTo(geometry.handle.x, geometry.handle.y); ctx.stroke(); ctx.beginPath(); ctx.arc(geometry.handle.x, geometry.handle.y, 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.fillStyle = "#3dd9d4"; ctx.beginPath(); ctx.arc(geometry.handle.x, geometry.handle.y, 2.2, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }
  function drawScene() { const frame = sizing(); drawGrid(frame); state.objects.filter(object => object.type === "projector").forEach(object => drawProjectorTarget(object, frame)); state.objects.forEach(object => drawObject(object, frame)); const selected = selectedObject(); if (selected) drawRotateHandle(selected, frame); emptyHint.hidden = state.objects.length > 0; document.querySelector("#zoom-reset").textContent = `${Math.round(state.zoom * 100)}%`; document.querySelector("#scene-summary").textContent = `Stage ${formatValue(state.stage.width)} × ${formatValue(state.stage.depth)} m`; }
  function selectedObject() { return state.objects.find(object => object.id === state.selectedId); }
  function selectObject(object, allOfType = false) { state.selectedId = object?.id ?? null; state.selectedIds = object ? new Set((allOfType ? state.objects.filter(item => item.type === object.type) : [object]).map(item => item.id)) : new Set(); state.highlightObjectId = object?.type === "projector" ? targetSurface(object)?.id || null : null; }
  function toggleObjectSelection(object) {
    if (!object) return;
    const ids = new Set(state.selectedIds);
    if (ids.has(object.id) && ids.size > 1) { ids.delete(object.id); state.selectedId = [...ids][0] ?? null; } else { ids.add(object.id); state.selectedId = object.id; }
    state.selectedIds = ids; const selected = selectedObject(); state.highlightObjectId = selected?.type === "projector" ? targetSurface(selected)?.id || null : null;
  }
  function objectRadius(object, frame) { return PLANAR_TYPES.has(object.type) ? object.geometry.width * frame.scale / 2 : Math.max(12, (typeConfig[object.type].radius || .3) * frame.scale * 1.8); }
  function hitTest(clientX, clientY) { const rect = canvas.getBoundingClientRect(); const frame = sizing(false); const point = { x: clientX - rect.left, y: clientY - rect.top }; return [...state.objects].reverse().find(object => { const centre = toScreen(object.transform.position.x, object.transform.position.z, frame); const dx = point.x - centre.x; const dy = point.y - centre.y; if (!PLANAR_TYPES.has(object.type)) return Math.hypot(dx, dy) < objectRadius(object, frame); const angle = -object.transform.rotation.y * Math.PI / 180; const localX = dx * Math.cos(angle) - dy * Math.sin(angle); const localY = dx * Math.sin(angle) + dy * Math.cos(angle); const halfWidth = object.geometry.width * frame.scale / 2; const halfThickness = Math.max(5, .1 * frame.scale) / 2; return Math.abs(localX) <= halfWidth && Math.abs(localY) <= halfThickness; }); }
  function hitTestProjectorTarget(clientX, clientY) { const rect = canvas.getBoundingClientRect(); const frame = sizing(false); const point = { x: clientX - rect.left, y: clientY - rect.top }; return [...state.objects].reverse().find(object => { if (object.type !== "projector") return false; const target = effectiveLookAt(object); const p = toScreen(target.x, target.z, frame); return Math.hypot(point.x - p.x, point.y - p.y) <= 12; }); }
  function hitTestRotateHandle(clientX, clientY) { const object = selectedObject(); if (!object) return null; const rect = canvas.getBoundingClientRect(); const geometry = rotateHandleGeometry(object, sizing(false)); if (!geometry) return null; return Math.hypot(clientX - rect.left - geometry.handle.x, clientY - rect.top - geometry.handle.y) <= 12 ? object : null; }
  function snapCoordinate(axis, value, object, ignoredIds = null) {
    const mode = document.querySelector("#snap-mode").value; let result = value; if (mode === "grid-1") result = Math.round(result); if (mode === "grid-01") result = Math.round(result * 10) / 10;
    const stage = stageBounds(); const center = 0; const min = axis === "x" ? stage.minX : stage.minZ; const max = axis === "x" ? stage.maxX : stage.maxZ;
    const candidates = [{ value: center }, { value: min }, { value: max }]; state.objects.filter(item => item.id !== object.id && !ignoredIds?.has(item.id) && item.type === object.type).forEach(item => { const other = item.transform.position[axis]; candidates.push({ value: other }, { value: center * 2 - other }); });
    const nearest = candidates.map(candidate => ({ ...candidate, distance: Math.abs(candidate.value - result) })).sort((a, b) => a.distance - b.distance)[0]; if (nearest && nearest.distance <= .16) { result = nearest.value; state.guides.push({ axis, value: result }); }
    return result;
  }

  function element(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; }
  function objectHeightValue(object) { return object.transform.position.y; }
  function setObjectHeight(object, value) { const height = finite(value, NaN); if (!Number.isFinite(height)) return false; object.transform.position.y = height; if (!PLANAR_TYPES.has(object.type)) state.lastHeights[object.type] = object.transform.position.y; return true; }
  function syncScreenMedia(object, changedPath = "") {
    if (object.type !== "screen") return; const media = object.media; const widthInches = Math.max(.001, object.geometry.width * 39.37007874); const heightInches = Math.max(.001, object.geometry.height * 39.37007874);
    if (media.inputMode === "resolution") { media.pixelsPerInch = Number((media.resolutionX / widthInches).toFixed(3)); media.pixelPitchMm = Number((25.4 / media.pixelsPerInch).toFixed(3)); return; }
    if (media.inputMode === "pitch" || changedPath === "media.pixelPitchMm") { media.pixelPitchMm = Math.max(.01, finite(media.pixelPitchMm, 2.6)); media.pixelsPerInch = Number((25.4 / media.pixelPitchMm).toFixed(3)); }
    else { media.pixelsPerInch = Math.max(.1, finite(media.pixelsPerInch, 10)); media.pixelPitchMm = Number((25.4 / media.pixelsPerInch).toFixed(3)); }
    media.resolutionX = Math.max(1, Math.round(widthInches * media.pixelsPerInch)); media.resolutionY = Math.max(1, Math.round(heightInches * media.pixelsPerInch));
  }
  function setScreenInputMode(object, mode) { if (object.type !== "screen" || !["resolution", "ppi", "pitch"].includes(mode)) return; object.media.inputMode = mode; syncScreenMedia(object); }
  function fieldSections(object) {
    const position = [["X", "transform.position.x", object.transform.position.x, .1, "m"], ["Z", "transform.position.z", object.transform.position.z, .1, "m"], ["Position Y", "transform.position.y", objectHeightValue(object), .1, "m"]];
    if (object.type === "screen") { const mode = object.media.inputMode || "resolution"; const mediaFields = mode === "resolution" ? [["X", "media.resolutionX", object.media.resolutionX, 1, "px"], ["Y", "media.resolutionY", object.media.resolutionY, 1, "px"]] : mode === "ppi" ? [["PPI", "media.pixelsPerInch", object.media.pixelsPerInch, .1, "ppi"]] : [["Pixel pitch", "media.pixelPitchMm", object.media.pixelPitchMm, .1, "mm"]]; return [{ title: "Size", fields: [["Width", "geometry.width", object.geometry.width, .1, "m"], ["Height", "geometry.height", object.geometry.height, .1, "m"]] }, { title: "Position", fields: [...position, ["Yaw", "transform.rotation.y", object.transform.rotation.y, 1, "°"]] }, { title: "LED data", mediaMode: true, fields: mediaFields }]; }
    if (["dmxScreen", "surface"].includes(object.type)) return [{ title: "Size", fields: [["Width", "geometry.width", object.geometry.width, .1, "m"], ["Height", "geometry.height", object.geometry.height, .1, "m"]] }, { title: "Position", fields: [...position, ["Yaw", "transform.rotation.y", object.transform.rotation.y, 1, "°"]] }, { title: "Resolution", fields: [["X", "media.resolutionX", object.media.resolutionX, 1, "px"], ["Y", "media.resolutionY", object.media.resolutionY, 1, "px"]] }];
    if (object.type === "projector") return [{ title: "Lens position", fields: position }, { title: "Look At", targetSurface: true }, { title: "Resolution", fields: [["X", "media.resolutionX", object.media.resolutionX, 1, "px"], ["Y", "media.resolutionY", object.media.resolutionY, 1, "px"]] }];
    return [{ title: "Position", fields: position }, { title: object.type === "camera" ? "Camera direction" : object.type === "dmxLight" ? "DMX light direction" : "Rotation", fields: [["Yaw", "transform.rotation.y", object.transform.rotation.y, 1, "°"]] }];
  }
  function getPath(object, path) { return path.split(".").reduce((value, key) => value[key], object); }
  function getFieldValue(object, path) { return path === "transform.position.y" ? objectHeightValue(object) : getPath(object, path); }
  function setPath(object, path, value) {
    if (path === "transform.position.y") { setObjectHeight(object, value); return; }
    const keys = path.split("."); const last = keys.pop(); const target = keys.reduce((current, key) => current[key] ||= {}, object); let next = Number(value.toFixed(3)); if (path.startsWith("media.resolution")) next = Math.max(1, Math.round(value)); if (path.startsWith("geometry.")) next = Math.max(.1, next); if (path === "media.pixelsPerInch") next = Math.max(.1, next); if (path === "media.pixelPitchMm") next = Math.max(.01, next); target[last] = next;
    if (PLANAR_TYPES.has(object.type)) { object.transform.rotation.x = 0; object.transform.rotation.z = 0; } if (object.type === "screen" && (path.startsWith("media.") || path.startsWith("geometry."))) syncScreenMedia(object, path);
  }
  function focusActiveField(path, attempt = 0) { const input = activeFieldRefs.get(path); if (!input) { if (attempt < 5) setTimeout(() => focusActiveField(path, attempt + 1), 0); return false; } input.focus?.({ preventScroll: true }); input.select?.(); if (document.activeElement !== input && attempt < 5) { const retry = () => focusActiveField(path, attempt + 1); if (globalThis.requestAnimationFrame) globalThis.requestAnimationFrame(retry); else setTimeout(retry, 0); } return true; }
  function nextDimensionField(object, path) { if (!PLANAR_TYPES.has(object.type)) return null; const order = ["geometry.width", "geometry.height", "transform.position.y"]; const index = order.indexOf(path); return index >= 0 ? order[index + 1] || null : null; }
  function makeObjectField(object, definition) { const [labelText, path, value, step, unit] = definition; const label = element("label", "object-field"); label.append(element("span", "object-field-label", labelText)); const shell = element("span", "input-shell"); const input = document.createElement("input"); input.type = "text"; input.inputMode = "decimal"; input.value = formatValue(value, step); input.dataset.field = path; input.setAttribute("aria-label", `${object.name}: ${labelText}`); activeFieldRefs.set(path, input); shell.append(input, element("i", "", unit)); label.append(shell); bindNumericInput(input, () => getFieldValue(object, path), next => setPath(object, path, next), step, () => defaultFieldValue(object, path)); input.addEventListener("keydown", event => { if (event.key !== "Enter") return; event.preventDefault(); event.stopPropagation(); setPath(object, path, finite(input.value, getFieldValue(object, path))); persist(); input.value = formatValue(getFieldValue(object, path), step); const nextPath = nextDimensionField(object, path); if (nextPath) { refreshActiveValues(); globalThis.requestAnimationFrame?.(() => focusActiveField(nextPath)); setTimeout(() => focusActiveField(nextPath), 25); } else input.blur?.(); }); return label; }
  function previewTargetSurface(pluginId) { state.highlightObjectId = pluginId ? state.objects.find(item => item.type === "surface" && item.pluginId === pluginId)?.id || null : null; drawScene(); renderObjectGroups(); }
  function makeTargetSurfaceField(object) { const label = element("label", "object-field object-select-field wide"); label.append(element("span", "object-field-label", "Look At")); const select = document.createElement("select"); select.setAttribute("aria-label", `${object.name}: Look At`); const target = effectiveLookAt(object); const manual = document.createElement("option"); manual.value = ""; manual.textContent = `Point (${formatValue(target.x)}, ${formatValue(target.z)})`; select.append(manual); state.objects.filter(item => item.type === "surface").forEach(surface => { const option = document.createElement("option"); option.value = surface.pluginId; option.textContent = surface.name; select.append(option); }); const committedTarget = () => targetSurface(object)?.pluginId || ""; select.value = committedTarget(); const showLabels = () => { state.showSurfaceLabels = true; drawScene(); }; select.addEventListener("focus", showLabels); select.addEventListener("pointerdown", showLabels); select.addEventListener("input", () => previewTargetSurface(select.value)); select.addEventListener("change", () => { saveHistory(); const currentTarget = effectiveLookAt(object); if (select.value) { object.targetSurfacePluginId = select.value; object.lookAt = effectiveLookAt(object); } else { delete object.targetSurfacePluginId; object.lookAt = currentTarget; } previewTargetSurface(select.value); persist(); render(); }); select.addEventListener("blur", () => { state.showSurfaceLabels = false; previewTargetSurface(committedTarget()); }); label.append(select); return label; }
  function makeMediaModeControl(object) { const control = element("div", "media-mode"); [["resolution", "Resolution"], ["ppi", "PPI"], ["pitch", "Pixel pitch"]].forEach(([mode, label]) => { const button = element("button", object.media.inputMode === mode ? "active" : "", label); button.type = "button"; button.addEventListener("click", () => { if (object.media.inputMode === mode) return; saveHistory(); setScreenInputMode(object, mode); persist(); render(); }); control.append(button); }); return control; }
  function makePropertySection(object, definition) { const section = element("section", "active-property-section"); section.append(element("h3", "active-property-title", definition.title)); const grid = element("div", "active-property-grid"); if (definition.mediaMode) grid.append(makeMediaModeControl(object)); if (definition.targetSurface) grid.append(makeTargetSurfaceField(object)); else definition.fields.forEach(field => grid.append(makeObjectField(object, field))); section.append(grid); return section; }
  function objectSyncStatus(object) { if (state.sync.errors?.[object.pluginId]) return "error"; const record = state.sync.objects?.[object.pluginId]; return record?.lastExported === canonical(objectPayload(object)) ? "synced" : "changed"; }
  function renderObjectGroups() { objectGroups.replaceChildren(); document.querySelector("#object-count").textContent = String(state.objects.length); GROUP_ORDER.forEach(type => { const config = typeConfig[type]; const objects = state.objects.filter(object => object.type === type); if (!objects.length) return; const group = element("section", "object-group"); const heading = element("div", "object-group-heading"); const swatch = element("span", "group-swatch"); swatch.style.background = config.color; heading.append(swatch, document.createTextNode(config.group), element("b", "group-count", String(objects.length))); group.append(heading); const list = element("div", "object-list"); objects.forEach(object => { const entry = element("button", `object-entry${state.selectedIds.has(object.id) || object.id === state.selectedId ? " selected" : ""}`); entry.type = "button"; entry.setAttribute("aria-label", `Select ${object.name}`); entry.append(element("i", `object-status ${objectSyncStatus(object)}`), element("i", `object-icon icon-${object.type.toLowerCase()}`), element("span", "object-name", object.name)); entry.addEventListener("click", event => { if (event.shiftKey || event.ctrlKey || event.metaKey) toggleObjectSelection(object); else selectObject(object); persist(); render(); }); entry.addEventListener("contextmenu", event => { event.preventDefault(); openCanvasContextMenu(event, object); }); list.append(entry); }); group.append(list); objectGroups.append(group); }); }
  function commitObjectName(object, input) { const nextName = input.value.trim(); if (nextName) { saveHistory(); object.name = nextName; persist(); } render(); }
  function renderActiveInspector() { activeFieldRefs = new Map(); activeObjectStrip.replaceChildren(); const object = selectedObject(); if (!object) { activeObjectStrip.append(element("div", "active-empty", "No object selected")); return; } const identity = element("div", "active-identity"); identity.append(element("span", "", typeConfig[object.type]?.label || "Designer Object")); const name = element("strong", "editable-object-name", object.name); name.title = "Click to rename"; name.addEventListener("click", () => { const input = document.createElement("input"); input.className = "object-name-input"; input.value = object.name; input.select?.(); input.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); commitObjectName(object, input); } if (event.key === "Escape") render(); }); input.addEventListener("blur", () => commitObjectName(object, input)); identity.replaceChildren(identity.children[0], input); input.focus?.(); input.select?.(); }); identity.append(name); activeObjectStrip.append(identity); fieldSections(object).forEach(definition => activeObjectStrip.append(makePropertySection(object, definition))); }
  function refreshActiveValues() { const object = selectedObject(); if (!object) return; document.querySelectorAll("#active-object-strip input[data-field]").forEach(input => { if (document.activeElement === input) return; const step = finite(input.dataset.step, .1); input.value = formatValue(getFieldValue(object, input.dataset.field), step); }); }
  function renderStatus() { const currentIds = new Set(state.objects.map(object => object.pluginId)); const statuses = state.objects.map(objectSyncStatus); const synced = statuses.filter(status => status === "synced").length; const changed = statuses.filter(status => status === "changed").length; const errors = Object.keys(state.sync.errors || {}).filter(id => currentIds.has(id)).length; document.querySelector("#status-synced").textContent = synced; document.querySelector("#status-changed").textContent = changed; document.querySelector("#status-errors").textContent = errors; document.querySelector("#status-error-chip").hidden = errors === 0; document.querySelector("#live-toggle").checked = Boolean(state.liveEnabled); }
  function render() { syncStaticInputs(); drawScene(); renderObjectGroups(); renderActiveInspector(); renderStatus(); }
  function addObjectAt(type, x = 0, z = 0, focusDimensions = false) { syncModelsFromInputs(); saveHistory(); const bounds = stageBounds(); const object = newObject(type, clamp(x, bounds.minX, bounds.maxX), clamp(z, bounds.minZ, bounds.maxZ)); state.objects.push(object); selectObject(object); if (type === "projector") state.placingProjectorId = object.id; persist(); render(); setTimeout(() => focusActiveField("transform.position.y"), 0); return object; }
  function addObject(type) { return addObjectAt(type); }
  function duplicateObject(id, mirrorAxis = null, options = {}) { const source = state.objects.find(object => object.id === id); if (!source) return null; if (options.history !== false) saveHistory(); const copy = clone(source); copy.id = nextId++; copy.pluginId = makeId(); copy.name = nextObjectName(source.type); delete copy.designer; if (mirrorAxis === "x") { copy.transform.position.x = Number((-source.transform.position.x).toFixed(3)); copy.transform.rotation.y = normalizeYaw(-source.transform.rotation.y); } else if (mirrorAxis === "z") { copy.transform.position.z = Number((-source.transform.position.z).toFixed(3)); copy.transform.rotation.y = normalizeYaw(180 - source.transform.rotation.y); } else if (options.offset !== false) copy.transform.position.x = Number((source.transform.position.x + .5).toFixed(3)); if (source.type === "projector" && mirrorAxis) { const target = effectiveLookAt(source); copy.lookAt = { ...target, [mirrorAxis]: Number((-target[mirrorAxis]).toFixed(3)) }; delete copy.targetSurfacePluginId; } state.objects.push(copy); selectObject(copy); if (options.persist !== false) persist(); if (options.render !== false) render(); return copy; }
  function copySelectedObjects() { const selected = state.objects.filter(object => state.selectedIds.has(object.id) || object.id === state.selectedId); if (!selected.length) return false; clipboardObjects = selected.map(object => clone(object)); return true; }
  function pasteCopiedObjects() { if (!clipboardObjects.length) return false; saveHistory(); const pasted = clipboardObjects.map(source => { const copy = clone(source); copy.id = nextId++; copy.pluginId = makeId(); copy.name = nextObjectName(copy.type); delete copy.designer; copy.transform.position.x = Number((copy.transform.position.x + .5).toFixed(3)); return copy; }); state.objects.push(...pasted); selectObject(pasted[pasted.length - 1]); persist(); render(); return true; }
  function rotateObject90(id) { const object = state.objects.find(item => item.id === id); if (!object) return; saveHistory(); if (object.type === "projector") { const target = effectiveLookAt(object); const dx = target.x - object.transform.position.x; const dz = target.z - object.transform.position.z; object.lookAt = { x: Number((object.transform.position.x + dz).toFixed(3)), y: target.y, z: Number((object.transform.position.z - dx).toFixed(3)) }; delete object.targetSurfacePluginId; } else object.transform.rotation.y = normalizeYaw(object.transform.rotation.y + 90); persist(); render(); }
  function bindProjectorToSurface(projector, surface) { if (!projector || projector.type !== "projector" || !surface) return; saveHistory(); projector.targetSurfacePluginId = surface.pluginId; projector.lookAt = effectiveLookAt(projector); previewTargetSurface(surface.pluginId); persist(); render(); }
  function positionContextMenu(event, height = 300) { const width = 220; canvasContextMenu.style.left = `${Math.max(6, Math.min(event.clientX, (window.innerWidth || 1280) - width - 6))}px`; canvasContextMenu.style.top = `${Math.max(6, Math.min(event.clientY, (window.innerHeight || 720) - height - 6))}px`; canvasContextMenu.hidden = false; }
  function closeCanvasContextMenu() { if (!canvasContextMenu) return; canvasContextMenu.hidden = true; document.querySelector("#surface-context-list").hidden = true; document.querySelector("#context-delete-confirm").hidden = true; state.showSurfaceLabels = false; contextObjectId = null; contextWorldPoint = null; }
  function openCanvasCreateMenu(event, point) { contextObjectId = null; contextWorldPoint = point; document.querySelector("#empty-context-actions").hidden = false; document.querySelector("#object-context-actions").hidden = true; positionContextMenu(event, 190); }
  function openCanvasContextMenu(event, object) { if (!canvasContextMenu || !object) return; contextObjectId = object.id; contextWorldPoint = null; selectObject(object); render(); document.querySelector("#empty-context-actions").hidden = true; document.querySelector("#object-context-actions").hidden = false; const bindButton = document.querySelector("#context-bind-surface"); const surfaceList = document.querySelector("#surface-context-list"); const surfaces = state.objects.filter(item => item.type === "surface"); bindButton.hidden = object.type !== "projector" || !surfaces.length; surfaceList.hidden = true; surfaceList.replaceChildren(); if (object.type === "projector") { state.showSurfaceLabels = true; drawScene(); } surfaces.forEach(surface => { const button = element("button", "", surface.name); button.type = "button"; button.addEventListener("pointerenter", () => previewTargetSurface(surface.pluginId)); button.addEventListener("pointerleave", () => previewTargetSurface(targetSurface(object)?.pluginId || null)); button.addEventListener("click", () => { bindProjectorToSurface(object, surface); closeCanvasContextMenu(); }); surfaceList.append(button); }); document.querySelector("#context-delete-confirm").hidden = true; positionContextMenu(event); }
  async function deleteObject(id) {
    const index = state.objects.findIndex(object => object.id === id); if (index < 0) return;
    saveHistory(); const removed = state.objects[index]; const record = state.sync.objects?.[removed.pluginId];
    const detachedTargets = new Map(state.objects.filter(item => item.targetSurfacePluginId === removed.pluginId).map(projector => [projector.id, effectiveLookAt(projector)]));
    state.objects.splice(index, 1); state.selectedIds.delete(id); if (state.selectedId === id) selectObject(state.objects[index] || state.objects[index - 1] || null);
    state.objects.forEach(projector => { const target = detachedTargets.get(projector.id); if (!target) return; projector.lookAt = target; delete projector.targetSurfacePluginId; }); persist(); render();
    if (!record?.designerId || !getAdapter()?.deleteManagedObjects) return;
    try {
      const result = await getAdapter().deleteManagedObjects([record.designerId]);
      if (!result?.deleted?.map(String).includes(String(record.designerId))) throw new Error(result?.skipped?.join("; ") || "Designer did not confirm deletion");
      delete state.sync.objects[removed.pluginId]; persist(false); renderStatus();
    } catch (error) {
      state.sync.errors[removed.pluginId] = `Delete failed: ${error.message || error}`; persist(false); renderObjectGroups();
    }
  }

  function canonical(value) { if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`; return JSON.stringify(value); }
  function changedValue(previous, current) { if (previous && current && typeof previous === "object" && typeof current === "object" && !Array.isArray(previous) && !Array.isArray(current)) { const result = {}; Object.keys(current).forEach(key => { const change = changedValue(previous[key], current[key]); if (change !== undefined) result[key] = change; }); return Object.keys(result).length ? result : undefined; } return canonical(previous) === canonical(current) ? undefined : current; }
  function objectPayload(object) { const payload = { pluginId: object.pluginId, type: object.type, name: object.name, transform: clone(object.transform) }; if (object.lookAt) payload.lookAt = clone(effectiveLookAt(object)); if (object.geometry) payload.geometry = clone(object.geometry); if (object.media) payload.media = clone(object.media); return payload; }
  // Designer stores numeric fields as float32 in several resource types. Keep
  // this tolerance at machine-noise scale: real measurement differences still
  // fail validation, while values such as 8.842000007629395 match 8.842.
  function validateReadback(expected, result, tolerance = 1e-6) {
    const actual = result?.readback; if (!actual) throw new Error("Designer не вернул координаты объекта для проверки"); const mismatches = [];
    const compare = (path, wanted, got) => { if (!Number.isFinite(Number(got)) || Math.abs(Number(wanted) - Number(got)) > tolerance) mismatches.push(`${path}: ожидалось ${wanted}, получено ${got}`); };
    const compareAngle = (path, wanted, got) => { const difference = Math.abs((((Number(wanted) - Number(got)) % 360) + 540) % 360 - 180); if (!Number.isFinite(Number(got)) || difference > tolerance) mismatches.push(`${path}: ожидалось ${wanted}, получено ${got}`); };
    ["x", "y", "z"].forEach(axis => compare(`position.${axis}`, expected.transform.position[axis], actual.transform?.position?.[axis])); if (expected.type !== "projector") ["x", "y", "z"].forEach(axis => compareAngle(`rotation.${axis}`, expected.transform.rotation[axis], actual.transform?.rotation?.[axis])); if (expected.lookAt) ["x", "y", "z"].forEach(axis => compare(`lookAt.${axis}`, expected.lookAt[axis], actual.lookAt?.[axis])); if (expected.geometry) { compare("geometry.width", expected.geometry.width, actual.geometry?.width); compare("geometry.height", expected.geometry.height, actual.geometry?.height); }
    if (mismatches.length) throw new Error(`Проверка координат Designer не пройдена: ${mismatches.join("; ")}`); return true;
  }
  function getAdapter() { const adapter = globalThis.disguiseSceneAdapter; return adapter && ["inspectScene", "createObject", "updateObject"].every(method => typeof adapter[method] === "function") ? adapter : null; }
  function environmentKey() { return canonical({ stage: state.stage }); }
  async function syncEnvironmentIfChanged(adapter) { if (typeof adapter?.syncEnvironment !== "function") return false; const key = environmentKey(); if (state.sync.environment === key) return false; const adapterStage = { ...state.stage, enabled: true, height: 0 }; await adapter.syncEnvironment({ stage: adapterStage }); state.sync.environment = key; persist(false); return true; }
  function typeOfSceneObject(item) { return item.type || ({ ledScreens: "screen", dmxScreens: "dmxScreen", surfaces: "surface", dmxLights: "dmxLight", cameras: "camera", projectors: "projector" }[item.collection]); }
  function isStandardCandidate(item) { return Boolean(item.standard || /(^|[\\/ _-])(surface|projector|camera|screen|light)[ _-]?1(?:\.|$)/i.test(`${item.path || ""} ${item.description || ""} ${item.name || ""}`)); }
  async function makeDiff(adapter, mode = "update") {
    const designerScene = adapter ? await adapter.inspectScene() : null; const inspected = designerScene?.objects || []; const records = state.sync.objects || {}; const byId = new Map(inspected.map(item => [String(item.id || item.uid), item])); const usedIds = new Set(); const currentIds = new Set(state.objects.map(object => object.pluginId));
    const diff = { create: [], update: [], adopt: [], unchanged: [], missing: [], orphans: [], preserve: [], standardCandidates: inspected.filter(isStandardCandidate), designerCount: inspected.length, inspectionWarnings: designerScene?.warnings || [], adapter, mode, floorY: designerScene?.floorY ?? 0 };
    for (const object of state.objects) {
      const payload = objectPayload(object); const serialized = canonical(payload); let record = records[object.pluginId]; let designerId = record?.designerId; let designerObject = designerId ? byId.get(String(designerId)) : null;
      if (!designerObject && record?.path) designerObject = inspected.find(item => String(item.path || "") === String(record.path)); if (!designerObject) designerObject = inspected.find(item => (item.managed && String(item.pluginId || "") === object.pluginId) || String(item.path || "").includes(`dsg-${object.pluginId}`)); if (designerObject) { designerId = String(designerObject.id || designerObject.uid); record = { ...(record || {}), designerId, path: designerObject.path }; }
      if (designerId && designerObject) { usedIds.add(String(designerId)); const changed = changedValue(record?.payload || {}, payload) || {}; if (/\/dsg-/i.test(String(designerObject.path || "")) && payload.name) changed.name = payload.name; if (record?.lastExported === serialized && !changed.name) diff.unchanged.push({ object, payload, designerId, designerPath: designerObject.path }); else diff.update.push({ object, payload, serialized, designerId, designerPath: designerObject.path, changed }); continue; }
      if (record?.designerId || record?.path) { diff.missing.push({ object, payload, record }); continue; }
      const candidate = diff.standardCandidates.find(item => !usedIds.has(String(item.id)) && typeOfSceneObject(item) === object.type); if (mode === "update" && candidate) { usedIds.add(String(candidate.id)); diff.adopt.push({ object, payload, serialized, designerId: String(candidate.id), candidate }); } else diff.create.push({ object, payload, serialized });
    }
    Object.entries(records).forEach(([pluginId, record]) => { if (!currentIds.has(pluginId) && record?.designerId) diff.orphans.push({ pluginId, designerId: record.designerId, name: record.name || pluginId }); }); diff.preserve = inspected.filter(item => !usedIds.has(String(item.id)) && !isStandardCandidate(item)); diff.standardCandidates = inspected.filter(item => isStandardCandidate(item) && !usedIds.has(String(item.id))); return diff;
  }
  function setDiffText(diff) { document.querySelector("#diff-create").textContent = diff.create.length; document.querySelector("#diff-update").textContent = diff.update.length + diff.adopt.length; document.querySelector("#diff-unchanged").textContent = diff.unchanged.length; document.querySelector("#diff-missing").textContent = diff.missing.length; document.querySelector("#diff-preserve").textContent = diff.preserve.length; document.querySelector("#diff-orphans").textContent = diff.orphans.length; document.querySelector("#diff-delete").textContent = diff.standardCandidates.length; }
  function renderStandardChecklist(diff) { const list = document.querySelector("#standard-checklist"); list.replaceChildren(); if (!diff?.standardCandidates?.length) { list.textContent = "No recognized default objects."; return; } diff.standardCandidates.forEach(item => { const label = element("label", "check-row"); const checkbox = document.createElement("input"); checkbox.type = "checkbox"; checkbox.value = String(item.id); label.append(checkbox, element("span", "", item.description || item.name || item.path || item.id)); list.append(label); }); }
  async function syncToDesigner(diff) {
    const records = state.sync.objects || {};
    await syncEnvironmentIfChanged(diff.adapter);
    for (const item of [...diff.create, ...diff.adopt]) { try { const result = item.designerId ? await diff.adapter.updateObject(item.designerId, item.payload, item.candidate?.path, item.object.type) : await diff.adapter.createObject(item.payload); validateReadback(item.payload, result); item.designerId = result?.designerId || result?.id || item.designerId; item.designerPath = result?.path || item.candidate?.path; } catch (error) { throw new Error(`${item.designerId ? "Update" : "Create"} "${item.object.name}": ${error.message || error}`); } records[item.object.pluginId] = { pluginId: item.object.pluginId, designerId: item.designerId || `dsg:${item.object.pluginId}`, path: item.designerPath, type: item.object.type, name: item.object.name, lastExported: item.serialized, payload: item.payload, adopted: Boolean(item.candidate) }; state.sync.objects = records; persist(false); }
    for (const item of diff.update) { try { const result = await diff.adapter.updateObject(item.designerId, item.changed, item.designerPath || records[item.object.pluginId]?.path, item.object.type); validateReadback(item.payload, result); item.designerPath = result?.path || item.designerPath; } catch (error) { throw new Error(`Update "${item.object.name}": ${error.message || error}`); } records[item.object.pluginId] = { ...(records[item.object.pluginId] || {}), pluginId: item.object.pluginId, designerId: item.designerId, path: item.designerPath || records[item.object.pluginId]?.path, type: item.object.type, name: item.object.name, lastExported: item.serialized, payload: item.payload }; state.sync.objects = records; persist(false); }
    state.sync.lastSyncAt = new Date().toISOString(); delete state.sync.errors.live; persist(false);
  }
  function renderLiveLog() { const output = document.querySelector("#live-log-output"); const logs = getAdapter()?.getLiveLogs?.() || []; if (output) output.textContent = logs.length ? logs.map(entry => JSON.stringify(entry)).join("\n") : "No LIVE events yet."; }
  function liveStatus(update) {
    const status = document.querySelector("#adapter-status");
    if (!update) return;
    if (update.status === "open") status.textContent = "LIVE: WebSocket connected";
    else if (update.status === "recovering") status.textContent = `LIVE: restoring subscriptions · ${update.detail || "retrying"}`;
    else if (update.status === "closed") status.textContent = `LIVE: ${update.detail || "WebSocket closed"}`;
    else if (update.status === "error") status.textContent = `LIVE: WebSocket error · ${update.detail || "unknown error"}`;
    renderLiveLog();
  }
  function applyLiveValue(change) {
    const object = state.objects.find(item => item.pluginId === change.pluginId); if (!object) return;
    if (change.field === "name") object.name = String(change.value || object.name);
    else if (change.field.includes("resolution") || change.field.includes("geometry") || change.field.startsWith("lookAt.") || change.field.startsWith("transform.")) setPath(object, change.field, finite(change.value, getFieldValue(object, change.field)));
    const record = state.sync.objects?.[object.pluginId];
    if (record) { record.payload = objectPayload(object); record.lastExported = canonical(record.payload); }
    persist(false); render();
  }
  function scheduleLiveSceneImport() {
    if (!state.liveEnabled) return;
    clearTimeout(liveSceneImportTimer);
    liveSceneImportTimer = setTimeout(async () => {
      liveSceneImportTimer = null;
      const adapter = getAdapter();
      if (!adapter) return;
      try { await importDesignerScene(adapter, { preserveLocal: true }); document.querySelector("#adapter-status").textContent = "LIVE: Designer object list updated"; }
      catch (error) { state.sync.errors.live = error.message || String(error); persist(false); liveStatus({ status: "error", detail: error.message || String(error) }); }
    }, 120);
  }
  async function ensureLiveObjects(adapter) {
    const records = state.sync.objects || {};
    const supported = new Set(["screen", "dmxScreen", "surface", "dmxLight", "projector", "camera"]);
    for (const object of state.objects) {
      if (!supported.has(object.type)) continue;
      const existing = records[object.pluginId];
      if (existing?.designerId) continue;
      const payload = objectPayload(object);
      const result = await adapter.createObject(payload);
      validateReadback(payload, result);
      records[object.pluginId] = { pluginId: object.pluginId, designerId: result?.designerId || result?.id, path: result?.path, type: object.type, name: object.name, lastExported: canonical(payload), payload, liveCreated: true };
    }
    state.sync.objects = records;
    persist(false);
  }
  async function runLiveSync() {
    if (liveSyncInFlight || !state.liveEnabled) return;
    const adapter = getAdapter(); if (!adapter?.liveSync) return;
    liveSyncInFlight = true; liveSyncQueued = false;
    try {
      await ensureLiveObjects(adapter);
      adapter.liveSync(state.objects.map(object => ({ payload: objectPayload(object), record: state.sync.objects?.[object.pluginId] })));
      document.querySelector("#adapter-status").textContent = "LIVE: changes sent over WebSocket";
    } catch (error) {
      state.sync.errors.live = error.message || String(error); persist(false); liveStatus({ status: "error", detail: error.message || String(error) });
    } finally {
      liveSyncInFlight = false;
      if (liveSyncQueued) scheduleLiveSync();
    }
  }
  function scheduleLiveSync(delay = 150) {
    if (!appReady || !state.liveEnabled) return;
    if (liveSyncInFlight) { liveSyncQueued = true; return; }
    clearTimeout(liveSyncTimer); liveSyncTimer = setTimeout(() => { liveSyncTimer = null; runLiveSync(); }, delay);
  }
  async function startLive() {
    const adapter = getAdapter(); if (!adapter?.liveStart) throw new Error("WebSocket Live Update is not available");
    const intent = ++liveIntent;
    await adapter.liveStart({ onStatus: liveStatus, onValuesChanged: applyLiveValue, onSceneChanged: scheduleLiveSceneImport });
    if (intent !== liveIntent) { adapter.liveStop?.(); return; }
    state.liveEnabled = true; persist(false); renderStatus(); scheduleLiveSync(0);
  }
  function stopLive() { liveIntent += 1; state.liveEnabled = false; clearTimeout(liveSyncTimer); liveSyncTimer = null; clearTimeout(liveSceneImportTimer); liveSceneImportTimer = null; persist(false); getAdapter()?.liveStop?.(); renderStatus(); }
  function importedObject(item, index) {
    const knownType = ["screen", "dmxScreen", "surface", "projector", "dmxLight", "camera"].includes(item.type) ? item.type : "designer";
    const existingRecord = Object.values(state.sync.objects || {}).find(record => String(record.designerId || "") === String(item.id || item.uid));
    const existing = state.objects.find(object => object.pluginId === item.pluginId) || (existingRecord ? state.objects.find(object => object.pluginId === existingRecord.pluginId) : null);
    const pluginId = existing?.pluginId || item.pluginId || `designer-${String(item.id || item.uid).replace(/[^a-zA-Z0-9_-]/g, "-")}`;
    const pathName = String(item.path || "").split(/[\\/]/).pop()?.replace(/\.apx$/i, "").replace(/^dsg-(?:dsg-)?/i, "");
    const readablePathName = pathName && !/^\d{10,}[-_]/.test(pathName) && !/^[a-f0-9-]{24,}$/i.test(pathName) ? pathName : null;
    const name = existing?.name || item.name || (item.description && !/^dsg-(?:dsg-)?/i.test(item.description) ? item.description : readablePathName) || `${typeConfig[knownType].label} ${index + 1}`;
    const object = { id: existing?.id || nextId++, pluginId, type: knownType, name, transform: item.transform || { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } } };
    if (item.geometry && typeConfig[knownType].geometry) object.geometry = { width: finite(item.geometry.width, typeConfig[knownType].geometry.width), height: finite(item.geometry.height, typeConfig[knownType].geometry.height) };
    if (typeConfig[knownType].media) object.media = { resolutionX: Math.max(1, Math.round(finite(item.media?.resolutionX, typeConfig[knownType].media.resolutionX))), resolutionY: Math.max(1, Math.round(finite(item.media?.resolutionY, typeConfig[knownType].media.resolutionY))), ...(knownType === "screen" ? { inputMode: existing?.media?.inputMode || "resolution", pixelsPerInch: finite(item.media?.pixelsPerInch, existing?.media?.pixelsPerInch || typeConfig.screen.media.pixelsPerInch), pixelPitchMm: finite(item.media?.pixelPitchMm, existing?.media?.pixelPitchMm || typeConfig.screen.media.pixelPitchMm) } : {}) };
    if (knownType === "projector") {
      object.lookAt = item.lookAt || lookAtFromRotation(object.transform.position, object.transform.rotation);
      object.transform.rotation = { x: 0, y: 0, z: 0 };
    }
    object.designer = { designerId: String(item.id || item.uid || ""), path: item.path, className: item.className, collection: item.collection };
    return object;
  }
  async function importDesignerScene(adapter, options = {}) {
    const inspection = await adapter.inspectScene();
    adapter.configureLiveScene?.(inspection.stageId);
    if (inspection.stageFootprint) { state.stage.width = Math.max(2, finite(inspection.stageFootprint.width, state.stage.width)); state.stage.depth = Math.max(2, finite(inspection.stageFootprint.depth, state.stage.depth)); }
    const imported = (inspection.objects || []).map(importedObject);
    const importedPluginIds = new Set(imported.map(object => object.pluginId));
    const localOnly = options.preserveLocal ? state.objects.filter(object => !state.sync.objects?.[object.pluginId]?.designerId && !importedPluginIds.has(object.pluginId)) : [];
    // Designer is authoritative at startup. Local storage supplies mappings and UI preferences only.
    state.objects = [...imported, ...localOnly]; state.selectedId = state.objects[0]?.id ?? null; state.selectedIds = new Set(state.selectedId ? [state.selectedId] : []); state.highlightObjectId = null;
    // Designer is authoritative at startup, including whether a managed Stage
    // cube exists. Local storage keeps mappings and UI preferences only.
    const importedRecords = Object.fromEntries(imported.map(object => [object.pluginId, { pluginId: object.pluginId, designerId: object.designer?.designerId, path: object.designer?.path, type: object.type, name: object.name, lastExported: canonical(objectPayload(object)), payload: objectPayload(object), imported: true }]));
    state.sync.objects = { ...(options.preserveLocal ? state.sync.objects : {}), ...importedRecords };
    state.sync.environment = environmentKey(); state.sync.lastSyncAt = new Date().toISOString(); persist(false); render();
  }
  function exportSceneJson() { const output = { version: VERSION, units: "metres", coordinateSystem: "Designer world XYZ; top view X/Z; Stage centred at world origin", stage: state.stage, objects: state.objects.map(({ id, ...object }) => object.type === "projector" ? { ...object, lookAt: effectiveLookAt(object) } : object) }; const blob = new Blob([JSON.stringify(output, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = "disguise-stage-plan.json"; link.click(); URL.revokeObjectURL(url); }

  document.querySelector("#json-button")?.addEventListener("click", exportSceneJson); document.querySelector("#live-log-button")?.addEventListener("click", () => { renderLiveLog(); document.querySelector("#live-log-panel").open = true; }); document.querySelector("#live-toggle")?.addEventListener("change", async event => { const toggle = event.target; if (STANDALONE_PREVIEW) { toggle.checked = false; toggle.disabled = true; document.querySelector("#adapter-status").textContent = "LIVE disabled in standalone preview · use the Designer plugin window"; return; } if (!toggle.checked) { stopLive(); document.querySelector("#adapter-status").textContent = "LIVE off"; return; } toggle.disabled = true; try { await startLive(); } catch (error) { state.liveEnabled = false; toggle.checked = false; persist(false); document.querySelector("#adapter-status").textContent = `LIVE unavailable · ${error.message || error}`; } finally { toggle.disabled = false; renderStatus(); } });
  document.querySelector("#undo-button")?.addEventListener("click", () => applyHistory("undo")); document.querySelector("#redo-button")?.addEventListener("click", () => applyHistory("redo")); document.querySelector("#zoom-in")?.addEventListener("click", () => { state.zoom = clamp(state.zoom + .1, ZOOM_MIN, ZOOM_MAX); drawScene(); }); document.querySelector("#zoom-out")?.addEventListener("click", () => { state.zoom = clamp(state.zoom - .1, ZOOM_MIN, ZOOM_MAX); drawScene(); });
  const resetView = () => { state.zoom = 1; state.pan = { x: 0, y: 0 }; drawScene(); };
  document.querySelector("#zoom-reset").addEventListener("click", resetView); document.querySelector("#zoom-reset").addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); resetView(); } });
  window.addEventListener("keydown", event => {
    const modifier = event.ctrlKey || event.metaKey; if (!modifier || event.altKey) return;
    const target = event.target; if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
    const key = event.code === "KeyC" ? "c" : event.code === "KeyV" ? "v" : event.key.toLowerCase();
    if (key === "c") { if (copySelectedObjects()) event.preventDefault(); }
    else if (key === "v") { if (pasteCopiedObjects()) event.preventDefault(); }
  });
  window.addEventListener("copy", event => { if (copySelectedObjects()) event.preventDefault(); });
  window.addEventListener("paste", event => { if (pasteCopiedObjects()) event.preventDefault(); });
  canvas.addEventListener("pointerdown", event => {
    if (event.button !== 0) return;
    closeCanvasContextMenu();
    const rect = canvas.getBoundingClientRect();
    const point = toWorld(event.clientX - rect.left, event.clientY - rect.top, sizing(false));
    if (state.placingProjectorId) {
      const projector = state.objects.find(item => item.id === state.placingProjectorId);
      const bounds = stageBounds();
      if (projector) { projector.lookAt.x = clamp(point.x, bounds.minX, bounds.maxX); projector.lookAt.z = clamp(point.z, bounds.minZ, bounds.maxZ); }
      state.placingProjectorId = null;
      persist();
      render();
      return;
    }
    const rotateOwner = hitTestRotateHandle(event.clientX, event.clientY);
    const targetOwner = rotateOwner ? null : hitTestProjectorTarget(event.clientX, event.clientY);
    let object = rotateOwner || targetOwner || hitTest(event.clientX, event.clientY);
    if (!object) {
      selectObject(null); state.dragging = { kind: "pan", pending: true, startClientX: event.clientX, startClientY: event.clientY, startPanX: state.pan.x, startPanY: state.pan.y };
      canvas.setPointerCapture?.(event.pointerId); render(); return;
    }
    if (rotateOwner || targetOwner) selectObject(object);
    else if (event.shiftKey) toggleObjectSelection(object);
    else if (state.selectedIds.size > 1 && state.selectedIds.has(object.id)) state.selectedId = object.id;
    else selectObject(object);
    if (!object) return;
    if (rotateOwner) {
      const geometry = rotateHandleGeometry(object, sizing(false));
      const pointerAngle = geometry ? Math.atan2(event.clientX - rect.left - geometry.centre.x, geometry.centre.y - (event.clientY - rect.top)) * 180 / Math.PI : finite(object.transform.rotation.y);
      state.dragging = { kind: "rotate", id: object.id, pending: true, startClientX: event.clientX, startClientY: event.clientY, startPointerAngle: pointerAngle, startYaw: object.type === "projector" ? normalizeYaw(directionAngle(object) * 180 / Math.PI) : finite(object.transform.rotation.y) };
    }
    else if (targetOwner) {
      const target = effectiveLookAt(object);
      state.dragging = { kind: "lookAt", id: object.id, pending: true, startClientX: event.clientX, startClientY: event.clientY, offsetX: target.x - point.x, offsetZ: target.z - point.z };
    } else if (state.selectedIds.size > 1 && state.selectedIds.has(object.id)) {
      state.dragging = {
        kind: "group", id: object.id, pending: true, ctrlKey: false, startPoint: point, startClientX: event.clientX, startClientY: event.clientY,
        positions: state.objects.filter(item => state.selectedIds.has(item.id)).map(item => ({ id: item.id, x: item.transform.position.x, z: item.transform.position.z }))
      };
    } else state.dragging = { kind: "object", id: object.id, pending: true, ctrlKey: event.ctrlKey || event.metaKey, startPoint: point, startClientX: event.clientX, startClientY: event.clientY, offsetX: object.transform.position.x - point.x, offsetZ: object.transform.position.z - point.z };
    canvas.setPointerCapture?.(event.pointerId);
    render();
  });
  canvas.addEventListener("pointermove", event => {
    if (!state.placingProjectorId && !state.dragging) return;
    const rect = canvas.getBoundingClientRect();
    const point = toWorld(event.clientX - rect.left, event.clientY - rect.top, sizing(false));
    if (state.placingProjectorId) {
      const projector = state.objects.find(item => item.id === state.placingProjectorId);
      const bounds = stageBounds();
      if (projector) { projector.lookAt.x = clamp(point.x, bounds.minX, bounds.maxX); projector.lookAt.z = clamp(point.z, bounds.minZ, bounds.maxZ); drawScene(); refreshActiveValues(); }
      return;
    }
    if (!state.dragging) return;
    if (state.dragging.pending) {
      const distance = Math.hypot(event.clientX - state.dragging.startClientX, event.clientY - state.dragging.startClientY);
      if (distance < 4) return;
      state.dragging.pending = false;
      if (state.dragging.kind !== "pan") saveHistory();
      if (state.dragging.kind === "object" && state.dragging.ctrlKey) {
        const source = state.objects.find(item => item.id === state.dragging.id);
        const copy = source && duplicateObject(source.id, null, { offset: false, history: false, persist: false, render: false });
        if (!copy) return;
        state.dragging.id = copy.id;
        state.dragging.offsetX = copy.transform.position.x - point.x;
        state.dragging.offsetZ = copy.transform.position.z - point.z;
      }
    }
    if (state.dragging.kind === "pan") {
      state.pan.x = state.dragging.startPanX + event.clientX - state.dragging.startClientX;
      state.pan.y = state.dragging.startPanY + event.clientY - state.dragging.startClientY;
      drawScene(); return;
    }
    const object = state.objects.find(item => item.id === state.dragging.id);
    if (!object) return;
    if (state.dragging.kind === "rotate") {
      const geometry = rotateHandleGeometry(object, sizing(false)); if (!geometry) return;
      const pointerAngle = Math.atan2(event.clientX - rect.left - geometry.centre.x, geometry.centre.y - (event.clientY - rect.top)) * 180 / Math.PI;
      const yaw = normalizeYaw(state.dragging.startYaw + normalizeYaw(pointerAngle - state.dragging.startPointerAngle));
      if (object.type === "projector") {
        const target = effectiveLookAt(object); const distance = Math.max(.5, Math.hypot(target.x - object.transform.position.x, target.z - object.transform.position.z));
        object.lookAt.x = Number((object.transform.position.x + Math.sin(yaw * Math.PI / 180) * distance).toFixed(3)); object.lookAt.z = Number((object.transform.position.z + Math.cos(yaw * Math.PI / 180) * distance).toFixed(3)); delete object.targetSurfacePluginId;
      } else object.transform.rotation.y = yaw;
      drawScene(); refreshActiveValues(); return;
    }
    if (state.dragging.kind === "lookAt" && !state.dragging.started) { delete object.targetSurfacePluginId; object.lookAt = effectiveLookAt(object); state.dragging.started = true; }
    const bounds = stageBounds();
    state.guides = [];
    if (state.dragging.kind === "group") {
      const primaryStart = state.dragging.positions.find(position => position.id === object.id);
      if (!primaryStart) return;
      const ignoredIds = new Set(state.dragging.positions.map(position => position.id));
      const targetX = snapCoordinate("x", primaryStart.x + point.x - state.dragging.startPoint.x, object, ignoredIds);
      const targetZ = snapCoordinate("z", primaryStart.z + point.z - state.dragging.startPoint.z, object, ignoredIds);
      const minDx = Math.max(...state.dragging.positions.map(position => bounds.minX - position.x));
      const maxDx = Math.min(...state.dragging.positions.map(position => bounds.maxX - position.x));
      const minDz = Math.max(...state.dragging.positions.map(position => bounds.minZ - position.z));
      const maxDz = Math.min(...state.dragging.positions.map(position => bounds.maxZ - position.z));
      const dx = clamp(targetX - primaryStart.x, minDx, maxDx);
      const dz = clamp(targetZ - primaryStart.z, minDz, maxDz);
      state.dragging.positions.forEach(position => { const item = state.objects.find(candidate => candidate.id === position.id); if (item) { item.transform.position.x = Number((position.x + dx).toFixed(3)); item.transform.position.z = Number((position.z + dz).toFixed(3)); } });
    } else if (state.dragging.kind === "lookAt") {
      object.lookAt.x = Number(clamp(point.x + state.dragging.offsetX, bounds.minX, bounds.maxX).toFixed(3));
      object.lookAt.z = Number(clamp(point.z + state.dragging.offsetZ, bounds.minZ, bounds.maxZ).toFixed(3));
    } else {
      const x = Number(clamp(snapCoordinate("x", point.x + state.dragging.offsetX, object), bounds.minX, bounds.maxX).toFixed(3));
      const z = Number(clamp(snapCoordinate("z", point.z + state.dragging.offsetZ, object), bounds.minZ, bounds.maxZ).toFixed(3));
      object.transform.position.x = x; object.transform.position.z = z;
    }
    drawScene();
    refreshActiveValues();
  });
  function clearDragState(event, commit = true) { const pointerId = event?.pointerId; state.dragging = null; state.guides = []; if (commit) persist(); render(); if (pointerId !== undefined && canvas.hasPointerCapture?.(pointerId)) canvas.releasePointerCapture(pointerId); }
  canvas.addEventListener("pointerup", event => clearDragState(event)); canvas.addEventListener("pointercancel", event => clearDragState(event)); canvas.addEventListener("lostpointercapture", event => { if (state.dragging) clearDragState(event); }); window.addEventListener("lostpointercapture", event => { if (state.dragging) clearDragState(event); }); window.addEventListener("blur", () => { if (state.dragging) clearDragState(undefined, false); }); document.addEventListener?.("visibilitychange", () => { if (document.hidden && state.dragging) clearDragState(undefined, false); }); window.addEventListener("resize", drawScene);
  canvas.addEventListener("wheel", event => { event.preventDefault(); state.zoom = clamp(state.zoom + (event.deltaY < 0 ? .1 : -.1), ZOOM_MIN, ZOOM_MAX); drawScene(); }, { passive: false });
  canvas.addEventListener("contextmenu", event => { event.preventDefault(); const object = hitTestProjectorTarget(event.clientX, event.clientY) || hitTest(event.clientX, event.clientY); if (object) openCanvasContextMenu(event, object); else { const rect = canvas.getBoundingClientRect(); openCanvasCreateMenu(event, toWorld(event.clientX - rect.left, event.clientY - rect.top, sizing(false))); } });
  document.querySelectorAll("[data-create-type]").forEach(button => button.addEventListener("click", () => { const point = contextWorldPoint; const type = button.dataset.createType; closeCanvasContextMenu(); if (point) addObjectAt(type, point.x, point.z, true); }));
  document.querySelectorAll("#canvas-context-menu [data-action]").forEach(button => button.addEventListener("click", () => { const id = contextObjectId; const action = button.dataset.action; if (!id) return; if (action === "bind-surface") { const list = document.querySelector("#surface-context-list"); list.hidden = !list.hidden; return; } if (action === "delete") { document.querySelector("#context-delete-confirm").hidden = false; return; } closeCanvasContextMenu(); if (action === "rotate-90") rotateObject90(id); else duplicateObject(id, action === "mirror-x" ? "x" : action === "mirror-z" ? "z" : null); })); document.querySelector("#context-delete-yes").addEventListener("click", () => { const id = contextObjectId; closeCanvasContextMenu(); if (id) deleteObject(id); }); document.querySelector("#context-delete-no").addEventListener("click", () => { document.querySelector("#context-delete-confirm").hidden = true; });
  window.addEventListener("pointerdown", event => { if (!canvasContextMenu?.hidden && !canvasContextMenu.contains?.(event.target)) closeCanvasContextMenu(); });

  setupStaticInputs(); if (!loadPersisted()) { syncStaticInputs(); render(); } else { syncStaticInputs(); render(); }
  if (typeof ResizeObserver === "function") new ResizeObserver(() => drawScene()).observe(document.querySelector("#canvas-wrap"));
  const adapter = getAdapter(); const adapterStatus = document.querySelector("#adapter-status");
  const finishStartup = async () => { if (adapter) { try { await importDesignerScene(adapter); adapterStatus.textContent = "Designer scene imported"; } catch (error) { adapterStatus.textContent = `Designer import failed · ${error.message || error}`; } } const liveToggle = document.querySelector("#live-toggle"); if (STANDALONE_PREVIEW) { state.liveEnabled = false; liveToggle.checked = false; liveToggle.disabled = true; adapterStatus.textContent = "LIVE disabled in standalone preview · use the Designer plugin window"; persist(false); } else if (!adapter?.capabilities?.liveUpdate) { state.liveEnabled = false; liveToggle.checked = false; liveToggle.disabled = true; adapterStatus.textContent = adapter ? "LIVE unavailable · WebSocket adapter is not available" : "Designer API unavailable · JSON available"; persist(false); } else { liveToggle.disabled = false; appReady = true; if (state.liveEnabled) { try { await startLive(); } catch (error) { state.liveEnabled = false; liveToggle.checked = false; adapterStatus.textContent = `LIVE unavailable · ${error.message || error}`; persist(false); } } } appReady = true; renderStatus(); };
  if (!adapter) { state.liveEnabled = false; adapterStatus.textContent = "Designer API unavailable · JSON available"; finishStartup(); }
  else {
    adapterStatus.textContent = "Checking Designer API…";
    Promise.resolve(adapter.sessionStatus?.()).then(() => { adapterStatus.textContent = "Designer API available"; finishStartup(); }).catch(() => { adapterStatus.textContent = "Designer API unavailable · JSON available"; finishStartup(); });
  }
  globalThis.scenePlannerDebug = { state, makeDiff, syncToDesigner, objectPayload, validateReadback, canonical, changedValue, normalizeObject, stageBounds, stageFloorY, toScreen, toWorld, snapCoordinate, typeConfig, finite, formatValue, objectHeightValue, setObjectHeight, newObject, fieldSections, nextDimensionField, effectiveLookAt, addObjectAt, selectObject, previewTargetSurface, duplicateObject, copySelectedObjects, pasteCopiedObjects, rotateObject90, normalizeYaw, rotateHandleGeometry, hitTest, syncScreenMedia, setScreenInputMode, importDesignerScene, importedObject };
})();
