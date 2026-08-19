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
    history: [], future: [], dragging: null, guides: [], pan: { x: 0, y: 0 },
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
  let pendingFocusPath = null;
  let projectorTargetPlacement = null;

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
      normalized.optics = {
        throwRatio: Math.max(.1, finite(object.optics?.throwRatio, 1.5)),
        fieldOfView: Math.max(.1, finite(object.optics?.fieldOfView, 40)),
        lookDistance: Math.max(.1, finite(object.optics?.lookDistance, Math.hypot(normalized.lookAt.x - position.x, normalized.lookAt.y - position.y, normalized.lookAt.z - position.z)))
      };
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
    state.stage = normalizedStage(saved.stage, saved.room || {}, sourceVersion); state.objects = saved.objects.map((object, index) => normalizeObject(object, index, sourceVersion)); state.sync = { objects: {}, lastSyncAt: null, errors: {}, ...(saved.sync || {}) }; state.liveEnabled = Boolean(saved.liveEnabled); state.lastHeights = { ...(saved.lastHeights || {}) }; state.selectedId = null; state.selectedIds = new Set();
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
    if (type === "projector") {
      object.lookAt = { x: 0, y: stageFloorY(), z: 0 };
      object.optics = { throwRatio: 1.5, fieldOfView: 40, lookDistance: Math.hypot(x, stageFloorY() - object.transform.position.y, z) || 1.5 };
    }
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
    if (path === "projector.yaw") return 0;
    if (path === "optics.throwRatio") return 1.5;
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
  function projectorYaw(object) { return normalizeYaw(directionAngle(object) * 180 / Math.PI); }
  function setProjectorYaw(object, value) {
    const target = effectiveLookAt(object); const position = object.transform.position;
    const distance = Math.max(.5, Math.hypot(target.x - position.x, target.z - position.z)); const yaw = normalizeYaw(value) * Math.PI / 180;
    object.lookAt = { x: Number((position.x + Math.sin(yaw) * distance).toFixed(3)), y: target.y, z: Number((position.z + Math.cos(yaw) * distance).toFixed(3)) };
  }
  function setObjectPlanPosition(object, x, z) {
    object.transform.position.x = x; object.transform.position.z = z;
    // Designer recalculates projector lookAt, rotation, and look distance after
    // a configPosition change. Keep the local target untouched until LIVE reads
    // those authoritative values back.
  }
  function projectorScreen(object) { return targetSurface(object); }
  function projectorProjectedWidth(object) {
    const screen = projectorScreen(object);
    if (!screen?.geometry) return Math.max(.1, finite(object.optics?.projectedWidth, 1));
    const screenWidth = Math.max(.1, finite(screen.geometry.width, 1));
    const screenHeight = Math.max(.1, finite(screen.geometry.height, 1));
    const projectorWidthPx = Math.max(1, finite(object.media?.resolutionX, 1920));
    const projectorHeightPx = Math.max(1, finite(object.media?.resolutionY, 1080));
    const projectorAspect = screenHeight > screenWidth ? projectorHeightPx / projectorWidthPx : projectorWidthPx / projectorHeightPx;
    return Math.max(screenWidth, screenHeight * projectorAspect);
  }
  function projectorThrowRatio(object) {
    const screen = projectorScreen(object);
    if (!screen) return Math.max(.1, finite(object.optics?.throwRatio, 1.5));
    const position = object.transform.position; const target = effectiveLookAt(object);
    const distance = Math.max(.1, Math.hypot(target.x - position.x, target.y - position.y, target.z - position.z));
    return Number((distance / projectorProjectedWidth(object)).toFixed(3));
  }
  function projectorBeam(object) {
    const position = object.transform.position; const target = effectiveLookAt(object);
    const distance = Math.max(.1, Math.hypot(target.x - position.x, target.y - position.y, target.z - position.z));
    const fieldOfView = Math.max(.1, finite(object.optics?.fieldOfView, 2 * Math.atan(projectorProjectedWidth(object) / (2 * distance)) * 180 / Math.PI));
    return { distance, fieldOfView, halfWidth: distance * Math.tan(fieldOfView * Math.PI / 360) };
  }
  function drawDirection(config, frame, object, length, spread) {
    const start = Math.max(7, (config.radius || .3) * frame.scale);
    ctx.save(); ctx.rotate(directionAngle(object)); ctx.globalAlpha = .25; ctx.beginPath(); ctx.moveTo(0, -start); ctx.lineTo(-spread * frame.scale, -length * frame.scale); ctx.lineTo(spread * frame.scale, -length * frame.scale); ctx.closePath(); ctx.fillStyle = config.color; ctx.fill(); ctx.restore(); ctx.globalAlpha = 1;
  }
  function drawProjectorBeam(config, frame, object) {
    const beam = projectorBeam(object); const direction = directionAngle(object); const target = effectiveLookAt(object);
    const source = toScreen(object.transform.position.x, object.transform.position.z, frame); const endpoint = toScreen(target.x, target.z, frame);
    const planDistance = Math.max(7, Math.hypot(endpoint.x - source.x, endpoint.y - source.y));
    const spread = Math.max(2, beam.halfWidth * frame.scale);
    ctx.save(); ctx.translate(0, 0); ctx.rotate(direction); ctx.globalAlpha = .22; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-spread, -planDistance); ctx.lineTo(spread, -planDistance); ctx.closePath(); ctx.fillStyle = config.color; ctx.fill(); ctx.restore(); ctx.globalAlpha = 1;
  }
  function drawObject(object, frame) {
    const position = toScreen(object.transform.position.x, object.transform.position.z, frame); const config = typeConfig[object.type]; const selected = state.selectedIds.has(object.id) || object.id === state.selectedId; const highlighted = object.id === state.highlightObjectId;
    ctx.save(); ctx.translate(position.x, position.y); if (PLANAR_TYPES.has(object.type)) ctx.rotate(object.transform.rotation.y * Math.PI / 180); ctx.fillStyle = config.color; ctx.strokeStyle = selected ? "#fff" : config.color; ctx.lineWidth = selected ? 2.5 : 1.2;
    if (PLANAR_TYPES.has(object.type)) { const w = object.geometry.width * frame.scale; const t = Math.max(5, .1 * frame.scale); if (["surface", "dmxScreen"].includes(object.type)) ctx.globalAlpha = .42; ctx.fillRect(-w / 2, -t / 2, w, t); ctx.globalAlpha = 1; ctx.strokeRect(-w / 2, -t / 2, w, t); }
    if (object.type === "projector") { drawProjectorBeam(config, frame, object); const r = config.radius * frame.scale; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.fillStyle = "#10161c"; ctx.beginPath(); ctx.arc(0, -r * .25, Math.max(2, r * .28), 0, Math.PI * 2); ctx.fill(); }
    if (object.type === "dmxLight") { drawDirection(config, frame, object, 3, 1.1); const r = Math.max(5, config.radius * frame.scale); ctx.fillRect(-r, -r, r * 2, r * 2); ctx.strokeRect(-r, -r, r * 2, r * 2); }
    if (object.type === "camera") { drawDirection(config, frame, object, 3, 1.4); const r = config.radius * frame.scale; ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(-r * .75, r * .8); ctx.lineTo(r * .75, r * .8); ctx.closePath(); ctx.fill(); ctx.stroke(); }
    ctx.restore(); const showLabel = selected || highlighted || (state.showSurfaceLabels && object.type === "surface"); if (showLabel) { ctx.fillStyle = highlighted ? "#f8c84d" : selected ? "#fff" : "#8eb7ff"; ctx.font = `${highlighted ? "600 " : ""}12px Inter,sans-serif`; ctx.textAlign = "center"; ctx.fillText(object.name, position.x, position.y - 16); if (highlighted) { ctx.strokeStyle = "rgba(248,200,77,.85)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(position.x, position.y, Math.max(10, (object.geometry?.width || .3) * frame.scale / 2 + 6), 0, Math.PI * 2); ctx.stroke(); } }
  }
  function drawProjectorTarget(object, frame) {
    const source = toScreen(object.transform.position.x, object.transform.position.z, frame); const target = effectiveLookAt(object); const point = toScreen(target.x, target.z, frame); const selected = state.selectedIds.has(object.id) || object.id === state.selectedId;
    const radius = Math.max(7, (typeConfig.projector.radius || .3) * frame.scale); const distance = Math.hypot(point.x - source.x, point.y - source.y); const start = distance > radius ? { x: source.x + (point.x - source.x) * radius / distance, y: source.y + (point.y - source.y) * radius / distance } : source;
    ctx.save(); ctx.strokeStyle = selected ? "rgba(192,132,252,.95)" : "rgba(192,132,252,.38)"; ctx.lineWidth = selected ? 1.5 : 1; ctx.setLineDash([5, 5]); ctx.beginPath(); ctx.moveTo(start.x, start.y); ctx.lineTo(point.x, point.y); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = "#10161c"; ctx.strokeStyle = "#c084fc"; ctx.lineWidth = selected ? 2.5 : 1.5; ctx.beginPath(); ctx.arc(point.x, point.y, selected ? 7 : 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.beginPath(); ctx.moveTo(point.x - 10, point.y); ctx.lineTo(point.x + 10, point.y); ctx.moveTo(point.x, point.y - 10); ctx.lineTo(point.x, point.y + 10); ctx.stroke(); ctx.restore();
  }
  function drawScene() { const frame = sizing(); drawGrid(frame); state.objects.filter(object => object.type === "projector").forEach(object => drawProjectorTarget(object, frame)); state.objects.forEach(object => drawObject(object, frame)); emptyHint.hidden = state.objects.length > 0; document.querySelector("#zoom-reset").textContent = `${Math.round(state.zoom * 100)}%`; document.querySelector("#scene-summary").textContent = `Stage ${formatValue(state.stage.width)} × ${formatValue(state.stage.depth)} m`; }
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
    if (object.type === "projector") return [{ title: "Lens position", fields: position }, { title: "Direction", targetSurface: true, fields: [] }, { title: "Optics", fields: [["Throw ratio", "optics.throwRatio", projectorThrowRatio(object), .01, "x"], ["Field of view", "optics.fieldOfView", object.optics.fieldOfView, .1, "°", { readOnly: true }], ["Look distance", "optics.lookDistance", object.optics.lookDistance, .1, "m", { readOnly: true }]] }, { title: "Resolution", fields: [["X", "media.resolutionX", object.media.resolutionX, 1, "px"], ["Y", "media.resolutionY", object.media.resolutionY, 1, "px"]] }];
    return [{ title: "Position", fields: position }, { title: object.type === "camera" ? "Camera direction" : object.type === "dmxLight" ? "DMX light direction" : "Rotation", fields: [["Yaw", "transform.rotation.y", object.transform.rotation.y, 1, "°"]] }];
  }
  function getPath(object, path) { return path.split(".").reduce((value, key) => value[key], object); }
  function getFieldValue(object, path) { return path === "transform.position.y" ? objectHeightValue(object) : path === "projector.yaw" ? projectorYaw(object) : getPath(object, path); }
  function setPath(object, path, value) {
    if (path === "projector.yaw") { setProjectorYaw(object, value); return; }
    if (path === "transform.position.y") { setObjectHeight(object, value); return; }
    if (object.type === "projector" && (path === "transform.position.x" || path === "transform.position.z")) {
      const x = path.endsWith(".x") ? Number(value.toFixed(3)) : object.transform.position.x;
      const z = path.endsWith(".z") ? Number(value.toFixed(3)) : object.transform.position.z;
      setObjectPlanPosition(object, x, z); return;
    }
    const keys = path.split("."); const last = keys.pop(); const target = keys.reduce((current, key) => current[key] ||= {}, object); let next = Number(value.toFixed(3)); if (path.startsWith("media.resolution")) next = Math.max(1, Math.round(value)); if (path.startsWith("geometry.") || path === "optics.throwRatio") next = Math.max(.1, next); if (path === "media.pixelsPerInch") next = Math.max(.1, next); if (path === "media.pixelPitchMm") next = Math.max(.01, next); target[last] = next;
    if (PLANAR_TYPES.has(object.type)) { object.transform.rotation.x = 0; object.transform.rotation.z = 0; } if (object.type === "screen" && (path.startsWith("media.") || path.startsWith("geometry."))) syncScreenMedia(object, path);
  }
  function focusActiveField(path, attempt = 0) { const input = activeFieldRefs.get(path) || [...document.querySelectorAll("#active-object-strip input[data-field]")].find(candidate => candidate.dataset.field === path); if (!input) { if (attempt < 30 && pendingFocusPath === path) setTimeout(() => focusActiveField(path, attempt + 1), 25); return false; } input.focus?.({ preventScroll: true }); input.select?.(); input.scrollIntoView?.({ block: "nearest", inline: "nearest" }); if (document.activeElement === input) { pendingFocusPath = null; return true; } if (attempt < 30 && pendingFocusPath === path) setTimeout(() => focusActiveField(path, attempt + 1), 25); return false; }
  function nextDimensionField(object, path) { if (!PLANAR_TYPES.has(object.type)) return null; const order = ["geometry.width", "geometry.height", "transform.position.y"]; const index = order.indexOf(path); return index >= 0 ? order[index + 1] || null : null; }
  function initialObjectFocusPath(object) { return PLANAR_TYPES.has(object.type) ? "geometry.width" : "transform.position.y"; }
  function makeObjectField(object, definition) { const [labelText, path, value, step, unit, options = {}] = definition; const label = element("label", "object-field"); label.append(element("span", "object-field-label", labelText)); const shell = element("span", "input-shell"); const input = document.createElement("input"); input.type = "text"; input.inputMode = "decimal"; input.value = formatValue(value, step); input.dataset.field = path; input.setAttribute("aria-label", `${object.name}: ${labelText}`); if (options.readOnly) { input.readOnly = true; input.classList.add("readonly"); } activeFieldRefs.set(path, input); shell.append(input, element("i", "", unit)); label.append(shell); if (options.readOnly) return label; bindNumericInput(input, () => getFieldValue(object, path), next => setPath(object, path, next), step, () => defaultFieldValue(object, path)); input.addEventListener("keydown", event => { if (event.key !== "Enter") return; event.preventDefault(); event.stopPropagation(); setPath(object, path, finite(input.value, getFieldValue(object, path))); persist(); const nextPath = nextDimensionField(object, path); if (nextPath) { pendingFocusPath = nextPath; refreshActiveValues(); requestAnimationFrame(() => focusActiveField(nextPath)); setTimeout(() => focusActiveField(nextPath), 20); } else { input.value = formatValue(getFieldValue(object, path), step); input.blur?.(); } }); return label; }
  function previewTargetSurface(pluginId) { state.highlightObjectId = pluginId ? state.objects.find(item => item.type === "surface" && item.pluginId === pluginId)?.id || null : null; drawScene(); renderObjectGroups(); }
  function makeTargetSurfaceField(object) { const label = element("label", "object-field object-select-field wide"); label.append(element("span", "object-field-label", "Direction")); const select = document.createElement("select"); select.setAttribute("aria-label", `${object.name}: Direction`); const target = effectiveLookAt(object); const manual = document.createElement("option"); manual.value = ""; manual.textContent = `Point (${formatValue(target.x)}, ${formatValue(target.y)}, ${formatValue(target.z)})`; select.append(manual); state.objects.filter(item => item.type === "surface").forEach(surface => { const option = document.createElement("option"); option.value = surface.pluginId; option.textContent = surface.name; select.append(option); }); const committedTarget = () => targetSurface(object)?.pluginId || ""; select.value = committedTarget(); const showLabels = () => { state.showSurfaceLabels = true; drawScene(); }; select.addEventListener("focus", showLabels); select.addEventListener("pointerdown", showLabels); select.addEventListener("input", () => previewTargetSurface(select.value)); select.addEventListener("change", () => { saveHistory(); const currentTarget = effectiveLookAt(object); if (select.value) { object.targetSurfacePluginId = select.value; object.lookAt = effectiveLookAt(object); object.optics.throwRatio = projectorThrowRatio(object); } else { delete object.targetSurfacePluginId; object.lookAt = currentTarget; } previewTargetSurface(select.value); persist(); render(); }); select.addEventListener("blur", () => { state.showSurfaceLabels = false; previewTargetSurface(committedTarget()); }); label.append(select); return label; }
  function makeMediaModeControl(object) { const control = element("div", "media-mode"); [["resolution", "Resolution"], ["ppi", "PPI"], ["pitch", "Pixel pitch"]].forEach(([mode, label]) => { const button = element("button", object.media.inputMode === mode ? "active" : "", label); button.type = "button"; button.addEventListener("click", () => { if (object.media.inputMode === mode) return; saveHistory(); setScreenInputMode(object, mode); persist(); render(); }); control.append(button); }); return control; }
  function makePropertySection(object, definition) { const section = element("section", "active-property-section"); section.append(element("h3", "active-property-title", definition.title)); const grid = element("div", "active-property-grid"); if (definition.mediaMode) grid.append(makeMediaModeControl(object)); if (definition.targetSurface) grid.append(makeTargetSurfaceField(object)); else definition.fields.forEach(field => grid.append(makeObjectField(object, field))); section.append(grid); return section; }
  function objectSyncStatus(object) { if (state.sync.errors?.[object.pluginId]) return "error"; const record = state.sync.objects?.[object.pluginId]; return record?.lastExported === canonical(objectPayload(object)) ? "synced" : "changed"; }
  function renderObjectGroups() { objectGroups.replaceChildren(); document.querySelector("#object-count").textContent = String(state.objects.length); GROUP_ORDER.forEach(type => { const config = typeConfig[type]; const objects = state.objects.filter(object => object.type === type); if (!objects.length) return; const group = element("section", "object-group"); const heading = element("div", "object-group-heading"); const swatch = element("span", "group-swatch"); swatch.style.background = config.color; heading.append(swatch, document.createTextNode(config.group), element("b", "group-count", String(objects.length))); group.append(heading); const list = element("div", "object-list"); objects.forEach(object => { const entry = element("button", `object-entry${state.selectedIds.has(object.id) || object.id === state.selectedId ? " selected" : ""}`); entry.type = "button"; entry.setAttribute("aria-label", `Select ${object.name}`); entry.append(element("i", `object-status ${objectSyncStatus(object)}`), element("i", `object-icon icon-${object.type.toLowerCase()}`), element("span", "object-name", object.name)); entry.addEventListener("click", event => { if (event.shiftKey || event.ctrlKey || event.metaKey) toggleObjectSelection(object); else selectObject(object); persist(); render(); }); entry.addEventListener("contextmenu", event => { event.preventDefault(); openCanvasContextMenu(event, object); }); list.append(entry); }); group.append(list); objectGroups.append(group); }); }
  async function commitObjectName(object, input) {
    const nextName = input.value.trim();
    if (!nextName || nextName === object.name) { render(); return; }
    const previousName = object.name;
    saveHistory(); object.name = nextName; persist(false); render();
    const record = state.sync.objects?.[object.pluginId];
    const adapter = getAdapter();
    if (!record?.designerId || !adapter?.updateObject) return;
    try {
      const result = await adapter.updateObject(record.designerId, { name: nextName }, record.path, object.type);
      object.name = result?.name || nextName;
      const nextPath = result?.path || record.path;
      record.ownedPaths = renamedOwnedPaths(record, nextPath);
      record.path = nextPath;
      record.name = object.name;
      record.payload = objectPayload(object);
      record.lastExported = canonical(record.payload);
      delete state.sync.errors[object.pluginId];
      persist(false); render();
    } catch (error) {
      object.name = previousName;
      state.sync.errors[object.pluginId] = `Rename failed: ${error.message || error}`;
      persist(false); render();
      document.querySelector("#adapter-status").textContent = `Rename failed · ${error.message || error}`;
    }
  }
  function renderActiveInspector() { activeFieldRefs = new Map(); activeObjectStrip.replaceChildren(); const object = selectedObject(); if (!object) { activeObjectStrip.append(element("div", "active-empty", "No object selected")); pendingFocusPath = null; return; } const identity = element("div", "active-identity"); identity.append(element("span", "", typeConfig[object.type]?.label || "Designer Object")); const name = document.createElement("strong"); name.className = "editable-object-name"; name.textContent = object.name; name.title = "Click to rename"; name.addEventListener("click", () => { const input = document.createElement("input"); input.className = "object-name-input"; input.value = object.name; input.select?.(); input.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); commitObjectName(object, input); } if (event.key === "Escape") render(); }); input.addEventListener("blur", () => commitObjectName(object, input)); identity.replaceChildren(identity.children[0], input); input.focus?.(); input.select?.(); }); identity.append(name); activeObjectStrip.append(identity); fieldSections(object).forEach(definition => activeObjectStrip.append(makePropertySection(object, definition))); const focusPath = pendingFocusPath; if (focusPath) setTimeout(() => focusActiveField(focusPath), 0); }
  function refreshActiveValues() { const object = selectedObject(); if (!object) return; document.querySelectorAll("#active-object-strip input[data-field]").forEach(input => { if (document.activeElement === input) return; const step = finite(input.dataset.step, .1); input.value = formatValue(getFieldValue(object, input.dataset.field), step); }); }
  function renderStatus() { const currentIds = new Set(state.objects.map(object => object.pluginId)); const statuses = state.objects.map(objectSyncStatus); const synced = statuses.filter(status => status === "synced").length; const changed = statuses.filter(status => status === "changed").length; const errors = Object.keys(state.sync.errors || {}).filter(id => currentIds.has(id)).length; document.querySelector("#status-synced").textContent = synced; document.querySelector("#status-changed").textContent = changed; document.querySelector("#status-errors").textContent = errors; document.querySelector("#status-error-chip").hidden = errors === 0; document.querySelector("#live-toggle").checked = Boolean(state.liveEnabled); }
  function render() { syncStaticInputs(); drawScene(); renderObjectGroups(); renderActiveInspector(); renderStatus(); }
  function updateProjectorTargetPlacement(point) {
    if (!projectorTargetPlacement || !point) return false;
    const object = state.objects.find(item => item.id === projectorTargetPlacement.objectId && item.type === "projector");
    if (!object) { projectorTargetPlacement = null; return false; }
    const bounds = stageBounds();
    object.lookAt.x = Number(clamp(point.x, bounds.minX, bounds.maxX).toFixed(3));
    object.lookAt.z = Number(clamp(point.z, bounds.minZ, bounds.maxZ).toFixed(3));
    delete object.targetSurfacePluginId;
    drawScene();
    refreshActiveValues();
    return true;
  }
  function commitProjectorTargetPlacement(point) {
    if (!projectorTargetPlacement) return false;
    if (point) updateProjectorTargetPlacement(point);
    projectorTargetPlacement = null;
    pendingFocusPath = "transform.position.y";
    persist();
    render();
    return true;
  }
  function cancelProjectorTargetPlacement() {
    if (!projectorTargetPlacement) return false;
    projectorTargetPlacement = null;
    render();
    return true;
  }
  function logPlannerAction(event, object, details = {}) {
    const record = object ? state.sync.objects?.[object.pluginId] : null;
    globalThis.disguiseSceneAdapter?.recordOperation?.(event, {
      source: "planner",
      pluginId: object?.pluginId || null,
      type: object?.type || null,
      name: object?.name || null,
      designerId: record?.designerId || null,
      path: record?.path || null,
      ...details
    });
  }
  function addObjectAt(type, x = 0, z = 0, focusDimensions = false) { syncModelsFromInputs(); saveHistory(); const bounds = stageBounds(); const object = newObject(type, clamp(x, bounds.minX, bounds.maxX), clamp(z, bounds.minZ, bounds.maxZ)); state.objects.push(object); logPlannerAction("create", object, { phase: "local", x: object.transform.position.x, z: object.transform.position.z }); selectObject(object); if (type === "projector") { projectorTargetPlacement = { objectId: object.id }; pendingFocusPath = null; persist(false); } else { pendingFocusPath = initialObjectFocusPath(object); persist(); } render(); return object; }
  function addObject(type) { return addObjectAt(type); }
  function duplicateObject(id, mirrorAxis = null, options = {}) { const source = state.objects.find(object => object.id === id); if (!source) return null; if (options.history !== false) saveHistory(); const copy = clone(source); copy.id = nextId++; copy.pluginId = makeId(); copy.name = nextObjectName(source.type); delete copy.designer; if (mirrorAxis === "x") { copy.transform.position.x = Number((-source.transform.position.x).toFixed(3)); copy.transform.rotation.y = normalizeYaw(-source.transform.rotation.y); } else if (mirrorAxis === "z") { copy.transform.position.z = Number((-source.transform.position.z).toFixed(3)); copy.transform.rotation.y = normalizeYaw(180 - source.transform.rotation.y); } else if (options.offset !== false) copy.transform.position.x = Number((source.transform.position.x + .5).toFixed(3)); if (source.type === "projector" && mirrorAxis) { const target = effectiveLookAt(source); copy.lookAt = { ...target, [mirrorAxis]: Number((-target[mirrorAxis]).toFixed(3)) }; } state.objects.push(copy); logPlannerAction("duplicate", copy, { phase: "local", sourcePluginId: source.pluginId, mirrorAxis }); selectObject(copy); if (options.persist !== false) persist(); if (options.render !== false) render(); return copy; }
  function copySelectedObjects() { const selected = state.objects.filter(object => state.selectedIds.has(object.id) || object.id === state.selectedId); if (!selected.length) return false; clipboardObjects = selected.map(object => clone(object)); return true; }
  function pasteCopiedObjects() { if (!clipboardObjects.length) return false; saveHistory(); const pasted = clipboardObjects.map(source => { const copy = clone(source); copy.id = nextId++; copy.pluginId = makeId(); copy.name = nextObjectName(copy.type); delete copy.designer; copy.transform.position.x = Number((copy.transform.position.x + .5).toFixed(3)); logPlannerAction("duplicate", copy, { phase: "local", method: "paste", sourcePluginId: source.pluginId }); return copy; }); state.objects.push(...pasted); selectObject(pasted[pasted.length - 1]); persist(); render(); return true; }
  function rotateObject90(id) { const object = state.objects.find(item => item.id === id); if (!object || object.type === "projector") return; saveHistory(); object.transform.rotation.y = normalizeYaw(object.transform.rotation.y + 90); persist(); render(); }
  function positionContextMenu(event, height = 300) { const width = 220; canvasContextMenu.style.left = `${Math.max(6, Math.min(event.clientX, (window.innerWidth || 1280) - width - 6))}px`; canvasContextMenu.style.top = `${Math.max(6, Math.min(event.clientY, (window.innerHeight || 720) - height - 6))}px`; canvasContextMenu.hidden = false; }
  function closeCanvasContextMenu() { if (!canvasContextMenu) return; canvasContextMenu.hidden = true; document.querySelector("#surface-context-list").hidden = true; document.querySelector("#context-delete-confirm").hidden = true; state.showSurfaceLabels = false; contextObjectId = null; contextWorldPoint = null; }
  function openCanvasCreateMenu(event, point) { contextObjectId = null; contextWorldPoint = point; document.querySelector("#empty-context-actions").hidden = false; document.querySelector("#object-context-actions").hidden = true; positionContextMenu(event, 190); }
  function openCanvasContextMenu(event, object) { if (!canvasContextMenu || !object) return; contextObjectId = object.id; contextWorldPoint = null; selectObject(object); render(); document.querySelector("#empty-context-actions").hidden = true; document.querySelector("#object-context-actions").hidden = false; const bindButton = document.querySelector("#context-bind-surface"); const rotateButton = document.querySelector('#object-context-actions [data-action="rotate-90"]'); const surfaceList = document.querySelector("#surface-context-list"); const surfaces = state.objects.filter(item => item.type === "surface"); bindButton.hidden = object.type !== "projector" || !surfaces.length; if (rotateButton) rotateButton.hidden = object.type === "projector"; surfaceList.hidden = true; surfaceList.replaceChildren(); if (object.type === "projector") { state.showSurfaceLabels = true; drawScene(); } surfaces.forEach(surface => { const button = element("button", "", surface.name); button.type = "button"; button.addEventListener("pointerenter", () => previewTargetSurface(surface.pluginId)); button.addEventListener("pointerleave", () => previewTargetSurface(targetSurface(object)?.pluginId || null)); button.addEventListener("click", () => { saveHistory(); object.targetSurfacePluginId = surface.pluginId; object.lookAt = effectiveLookAt(object); object.optics.throwRatio = projectorThrowRatio(object); persist(); render(); closeCanvasContextMenu(); }); surfaceList.append(button); }); document.querySelector("#context-delete-confirm").hidden = true; positionContextMenu(event); }
  async function deleteObject(id, options = {}) {
    const index = state.objects.findIndex(object => object.id === id); if (index < 0) return;
    saveHistory(); const removed = state.objects[index]; const record = state.sync.objects?.[removed.pluginId];
    logPlannerAction("delete", removed, { phase: "requested", owned: Boolean(record?.owned), deleteImportedFromDesigner: Boolean(options.deleteImportedFromDesigner) });
    const detachedTargets = new Map(state.objects.filter(item => item.type === "projector" && item.targetSurfacePluginId === removed.pluginId).map(projector => [projector.id, { target: effectiveLookAt(projector), surfacePluginId: projector.targetSurfacePluginId }]));
    state.objects.splice(index, 1); state.selectedIds.delete(id); detachedTargets.forEach((target, projectorId) => { const projector = state.objects.find(item => item.id === projectorId); if (projector) { projector.lookAt = target; delete projector.targetSurfacePluginId; } }); if (state.selectedId === id) selectObject(state.objects[index] || state.objects[index - 1] || null);
    persist(); render();
    if (!record?.designerId) return;
    const adapter = getAdapter();
    if (!record.owned && !options.deleteImportedFromDesigner) { delete state.sync.objects[removed.pluginId]; persist(false); renderStatus(); return; }
    if (record.owned && !adapter?.deleteManagedObjects) return;
    if (!record.owned && !adapter?.deleteDesignerObjects) return;
    try {
      let result;
      if (record.owned) {
        if (!Array.isArray(record.ownedPaths) || !record.ownedPaths.length) throw new Error("Designer ownership metadata is incomplete; refusing physical deletion");
        result = await adapter.deleteManagedObjects([{ id: record.designerId, path: record.path, owned: true, ownedPaths: record.ownedPaths }]);
      } else {
        result = await adapter.deleteDesignerObjects([{ id: record.designerId, path: record.path }]);
      }
      if (!result?.deleted?.map(String).includes(String(record.designerId))) throw new Error(result?.skipped?.join("; ") || "Designer did not confirm deletion");
      delete state.sync.objects[removed.pluginId]; persist(false); renderStatus();
    } catch (error) {
      state.objects.splice(Math.min(index, state.objects.length), 0, removed);
      detachedTargets.forEach((binding, projectorId) => { const projector = state.objects.find(item => item.id === projectorId); if (projector) { projector.lookAt = binding.target; projector.targetSurfacePluginId = binding.surfacePluginId; } });
      selectObject(removed);
      state.sync.errors[removed.pluginId] = `Delete failed: ${error.message || error}`; persist(false); renderObjectGroups();
    }
  }

  function canonical(value) { if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`; return JSON.stringify(value); }
  function changedValue(previous, current) { if (previous && current && typeof previous === "object" && typeof current === "object" && !Array.isArray(previous) && !Array.isArray(current)) { const result = {}; Object.keys(current).forEach(key => { const change = changedValue(previous[key], current[key]); if (change !== undefined) result[key] = change; }); return Object.keys(result).length ? result : undefined; } return canonical(previous) === canonical(current) ? undefined : current; }
  function objectPayload(object) { const payload = { pluginId: object.pluginId, type: object.type, name: object.name, transform: clone(object.transform) }; if (object.lookAt) payload.lookAt = clone(effectiveLookAt(object)); if (object.geometry) payload.geometry = clone(object.geometry); if (object.media) payload.media = clone(object.media); if (object.optics) payload.optics = clone(object.optics); return payload; }
  // Designer stores numeric fields as float32 and derives projector values.
  // One millimetre accepts harmless readback drift without hiding layout errors.
  function validateReadback(expected, result, tolerance = 0.001) {
    const actual = result?.readback; if (!actual) throw new Error("Designer не вернул координаты объекта для проверки"); const mismatches = [];
    const compare = (path, wanted, got) => { if (!Number.isFinite(Number(got)) || Math.abs(Number(wanted) - Number(got)) > tolerance) mismatches.push(`${path}: ожидалось ${wanted}, получено ${got}`); };
    const compareAngle = (path, wanted, got) => { const difference = Math.abs((((Number(wanted) - Number(got)) % 360) + 540) % 360 - 180); if (!Number.isFinite(Number(got)) || difference > tolerance) mismatches.push(`${path}: ожидалось ${wanted}, получено ${got}`); };
    ["x", "y", "z"].forEach(axis => compare(`position.${axis}`, expected.transform.position[axis], actual.transform?.position?.[axis])); if (expected.type !== "projector") ["x", "y", "z"].forEach(axis => compareAngle(`rotation.${axis}`, expected.transform.rotation[axis], actual.transform?.rotation?.[axis])); if (expected.lookAt) ["x", "y", "z"].forEach(axis => compare(`lookAt.${axis}`, expected.lookAt[axis], actual.lookAt?.[axis])); if (expected.geometry) { compare("geometry.width", expected.geometry.width, actual.geometry?.width); compare("geometry.height", expected.geometry.height, actual.geometry?.height); } if (expected.optics?.throwRatio !== undefined && actual.optics?.throwRatio !== undefined) compare("optics.throwRatio", expected.optics.throwRatio, actual.optics.throwRatio);
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
  function persistCreatedRecord(records, object, payload, result, options = {}) {
    const designerId = result?.designerId || result?.id || options.designerId;
    const path = result?.path || options.path;
    if (!designerId || !path) throw new Error("Designer did not return the created object's UID and path");
    if (result?.name) { object.name = result.name; payload.name = result.name; }
    let ownedPaths = [];
    let ownershipError = null;
    if (options.owned) {
      try { ownedPaths = validatedOwnedPaths(result, object.type); }
      catch (error) { ownershipError = error; }
    }
    const record = {
      pluginId: object.pluginId, designerId, path, type: object.type, name: object.name,
      lastExported: canonical(payload), payload, readbackValid: options.readbackValid ?? null, adopted: Boolean(options.adopted),
      liveCreated: Boolean(options.liveCreated), owned: Boolean(options.owned && !ownershipError), ownedPaths
    };
    records[object.pluginId] = record;
    state.sync.objects = records;
    persist(false);
    if (ownershipError) throw ownershipError;
    return record;
  }
  async function syncToDesigner(diff) {
    const records = state.sync.objects || {};
    await syncEnvironmentIfChanged(diff.adapter);
    for (const item of [...diff.create, ...diff.adopt]) {
      const owned = !item.designerId;
      const operation = owned ? "Create" : "Update";
      let result;
      try {
        logPlannerAction(owned ? "create" : "update", item.object, { phase: "designer-sync", designerId: item.designerId || null, path: item.candidate?.path || null, adopted: Boolean(item.candidate) });
        result = owned ? await diff.adapter.createObject(item.payload) : await diff.adapter.updateObject(item.designerId, item.payload, item.candidate?.path, item.object.type);
        const record = persistCreatedRecord(records, item.object, item.payload, result, { owned, adopted: Boolean(item.candidate), designerId: item.designerId, path: item.candidate?.path });
        item.designerId = record.designerId;
        item.designerPath = record.path;
        item.serialized = record.lastExported;
        try { validateReadback(item.payload, result); record.readbackValid = true; persist(false); }
        catch (validationError) { record.readbackValid = false; record.lastExported = null; persist(false); throw validationError; }
      } catch (error) {
        throw new Error(`${operation} "${item.object.name}": ${error.message || error}`);
      }
    }
    for (const item of diff.update) { const previousRecord = records[item.object.pluginId] || {}; try { logPlannerAction("update", item.object, { phase: "designer-sync", designerId: item.designerId, path: item.designerPath || previousRecord.path }); const result = await diff.adapter.updateObject(item.designerId, item.changed, item.designerPath || previousRecord.path, item.object.type); validateReadback(item.payload, result); if (result?.name) { item.object.name = result.name; item.payload.name = result.name; item.serialized = canonical(item.payload); } item.designerPath = result?.path || item.designerPath; } catch (error) { throw new Error(`Update "${item.object.name}": ${error.message || error}`); } const nextPath = item.designerPath || previousRecord.path; records[item.object.pluginId] = { ...previousRecord, pluginId: item.object.pluginId, designerId: item.designerId, path: nextPath, ownedPaths: renamedOwnedPaths(previousRecord, nextPath), type: item.object.type, name: item.object.name, lastExported: item.serialized, payload: item.payload }; state.sync.objects = records; persist(false); }
    state.sync.lastSyncAt = new Date().toISOString(); delete state.sync.errors.live; persist(false);
  }
  function diagnosticsLogs() { const adapter = getAdapter(); return [...(adapter?.getOperationLogs?.() || []), ...(adapter?.getLiveLogs?.() || [])].sort((left, right) => String(left.at || "").localeCompare(String(right.at || ""))); }
  function renderLiveLog() { const output = document.querySelector("#live-log-output"); const logs = diagnosticsLogs(); if (output) output.textContent = logs.length ? logs.map(entry => JSON.stringify(entry)).join("\n") : "No diagnostics events yet."; }
  function exportDiagnostics() { const blob = new Blob([JSON.stringify(diagnosticsLogs(), null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `disguise-scene-diagnostics-${new Date().toISOString().replace(/[:.]/g, "-")}.json`; link.click(); URL.revokeObjectURL(url); }
  function liveStatus(update) {
    const status = document.querySelector("#adapter-status");
    if (!update) return;
    const liveState = getAdapter()?.getLiveState?.();
    const socketOpen = liveState?.socket === "open";
    const wanted = Boolean(liveState?.wanted);
    if (update.status === "open") {
      state.liveEnabled = true;
      status.textContent = "LIVE: WebSocket connected";
    } else if (update.status === "reconnecting") {
      state.liveEnabled = wanted;
      status.textContent = `LIVE: reconnecting · ${update.detail || "waiting for Designer"}`;
    } else if (update.status === "recovering") {
      status.textContent = `LIVE: restoring subscriptions · ${update.detail || "retrying"}`;
    } else if (update.status === "closed") {
      state.liveEnabled = wanted;
      status.textContent = `LIVE: ${update.detail || "WebSocket closed"}`;
    } else if (update.status === "error") {
      if (!socketOpen) state.liveEnabled = wanted;
      status.textContent = `LIVE: WebSocket error · ${update.detail || "unknown error"}`;
    }
    if (update.status !== "open" && (update.status !== "error" || !socketOpen)) persist(false);
    renderStatus();
    renderLiveLog();
  }
  function applyLiveValue(change) {
    const object = state.objects.find(item => item.pluginId === change.pluginId); if (!object) return;
    if (change.field === "name") object.name = String(change.value || object.name);
    else if (change.field === "transform.position" && change.value && typeof change.value === "object") object.transform.position = vector(change.value);
    else if (change.field === "lookAt" && change.value && typeof change.value === "object") { object.lookAt = vector(change.value); if (targetSurface(object)) delete object.targetSurfacePluginId; }
    else if (change.field.startsWith("optics.")) setPath(object, change.field, finite(change.value, getFieldValue(object, change.field)));
    else if (change.field.includes("resolution") || change.field.includes("geometry") || change.field.startsWith("lookAt.") || change.field.startsWith("transform.")) setPath(object, change.field, finite(change.value, getFieldValue(object, change.field)));
    const record = state.sync.objects?.[object.pluginId];
    if (record) { record.payload = objectPayload(object); record.lastExported = canonical(record.payload); }
    persist(false); drawScene(); renderObjectGroups(); refreshActiveValues(); renderStatus();
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
      const payload = objectPayload(object);
      if (existing?.designerId) {
        if (existing.readbackValid === false) {
          const result = await adapter.updateObject(existing.designerId, payload, existing.path, object.type);
          validateReadback(payload, result);
          existing.payload = payload; existing.lastExported = canonical(payload); existing.readbackValid = true; persist(false);
        }
        continue;
      }
      const result = await adapter.createObject(payload);
      const record = persistCreatedRecord(records, object, payload, result, { owned: true, liveCreated: true });
      try { validateReadback(payload, result); record.readbackValid = true; persist(false); }
      catch (validationError) { record.readbackValid = false; record.lastExported = null; persist(false); throw validationError; }
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
      const sent = adapter.liveSync(state.objects.map(object => ({ payload: objectPayload(object), record: state.sync.objects?.[object.pluginId] })));
      if (sent === false) throw new Error("Live Update WebSocket is not open");
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
    const liveState = adapter.getLiveState?.();
    if (liveState && liveState.socket !== "open") throw new Error("Live Update WebSocket did not open");
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
      object.optics = { throwRatio: Math.max(.1, finite(item.optics?.throwRatio, existing?.optics?.throwRatio || 1.5)), fieldOfView: Math.max(.1, finite(item.optics?.fieldOfView, existing?.optics?.fieldOfView || 40)), lookDistance: Math.max(.1, finite(item.optics?.lookDistance, existing?.optics?.lookDistance || Math.hypot(object.lookAt.x - object.transform.position.x, object.lookAt.y - object.transform.position.y, object.lookAt.z - object.transform.position.z))) };
      if (existing?.targetSurfacePluginId) object.targetSurfacePluginId = existing.targetSurfacePluginId;
    }
    object.designer = { designerId: String(item.id || item.uid || ""), path: item.path, className: item.className, collection: item.collection };
    return object;
  }
  async function importDesignerScene(adapter, options = {}) {
    const previousSelectedPluginId = state.objects.find(object => object.id === state.selectedId)?.pluginId || null;
    const previousSelectedPluginIds = new Set(state.objects.filter(object => state.selectedIds.has(object.id)).map(object => object.pluginId));
    const activeFieldPath = document.activeElement?.dataset?.field || null;
    const inspection = await adapter.inspectScene();
    adapter.configureLiveScene?.(inspection.stageId);
    if (inspection.stageFootprint) { state.stage.width = Math.max(2, finite(inspection.stageFootprint.width, state.stage.width)); state.stage.depth = Math.max(2, finite(inspection.stageFootprint.depth, state.stage.depth)); }
    const imported = (inspection.objects || []).map(importedObject);
    const importedPluginIds = new Set(imported.map(object => object.pluginId));
    const localOnly = options.preserveLocal ? state.objects.filter(object => !state.sync.objects?.[object.pluginId]?.designerId && !importedPluginIds.has(object.pluginId)) : [];
    // Designer is authoritative at startup. Local storage supplies mappings and UI preferences only.
    state.objects = [...imported, ...localOnly];
    const selected = state.objects.find(object => object.pluginId === previousSelectedPluginId) || state.objects[0] || null;
    state.selectedId = selected?.id ?? null;
    const selectedIds = [...previousSelectedPluginIds].map(pluginId => state.objects.find(object => object.pluginId === pluginId)?.id).filter(Boolean);
    state.selectedIds = new Set(selectedIds.length ? selectedIds : (selected ? [selected.id] : []));
    state.highlightObjectId = selected?.type === "projector" ? targetSurface(selected)?.id || null : null;
    pendingFocusPath = selected && selected.pluginId === previousSelectedPluginId ? activeFieldPath : null;
    // Designer is authoritative at startup, including whether a managed Stage
    // cube exists. Local storage keeps mappings and UI preferences only.
    const importedRecords = Object.fromEntries(imported.map(object => { const previous = state.sync.objects?.[object.pluginId]; const sameResource = previous && (String(previous.designerId || "") === String(object.designer?.designerId || "") || String(previous.path || "") === String(object.designer?.path || "")); const hasOwnership = Array.isArray(previous?.ownedPaths) && previous.ownedPaths.length > 0; const owned = Boolean(sameResource && previous.owned && hasOwnership); return [object.pluginId, { pluginId: object.pluginId, designerId: object.designer?.designerId, path: object.designer?.path, type: object.type, name: object.name, lastExported: canonical(objectPayload(object)), payload: objectPayload(object), imported: true, owned, ownedPaths: owned ? previous.ownedPaths : [] }]; }));
    state.sync.objects = { ...(options.preserveLocal ? state.sync.objects : {}), ...importedRecords };
    state.sync.environment = environmentKey(); state.sync.lastSyncAt = new Date().toISOString(); persist(false); render();
  }
  function exportSceneJson() { const output = { version: VERSION, units: "metres", coordinateSystem: "Designer world XYZ; top view X/Z; Stage centred at world origin", stage: state.stage, objects: state.objects.map(({ id, ...object }) => object.type === "projector" ? { ...object, lookAt: effectiveLookAt(object) } : object) }; const blob = new Blob([JSON.stringify(output, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = "disguise-stage-plan.json"; link.click(); URL.revokeObjectURL(url); }

  document.querySelector("#json-button")?.addEventListener("click", exportSceneJson); document.querySelector("#live-log-button")?.addEventListener("click", () => { renderLiveLog(); document.querySelector("#live-log-panel").open = true; }); document.querySelector("#diagnostics-export-button")?.addEventListener("click", exportDiagnostics); document.querySelector("#live-toggle")?.addEventListener("change", async event => { const toggle = event.target; if (STANDALONE_PREVIEW) { toggle.checked = false; toggle.disabled = true; document.querySelector("#adapter-status").textContent = "LIVE disabled in standalone preview · use the Designer plugin window"; return; } if (!toggle.checked) { stopLive(); document.querySelector("#adapter-status").textContent = "LIVE off"; return; } toggle.disabled = true; try { await startLive(); } catch (error) { state.liveEnabled = false; toggle.checked = false; persist(false); document.querySelector("#adapter-status").textContent = `LIVE unavailable · ${error.message || error}`; } finally { toggle.disabled = false; renderStatus(); } });
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
  window.addEventListener("copy", event => { const target = event.target; const selection = String(globalThis.getSelection?.() || ""); if (selection || target && ["INPUT", "TEXTAREA"].includes(target.tagName)) return; if (copySelectedObjects()) event.preventDefault(); });
  window.addEventListener("paste", event => { const target = event.target; if (target && ["INPUT", "TEXTAREA"].includes(target.tagName)) return; if (pasteCopiedObjects()) event.preventDefault(); });
  canvas.addEventListener("pointerdown", event => {
    if (event.button !== 0) return;
    closeCanvasContextMenu();
    const rect = canvas.getBoundingClientRect();
    const point = toWorld(event.clientX - rect.left, event.clientY - rect.top, sizing(false));
    if (projectorTargetPlacement) { commitProjectorTargetPlacement(point); return; }
    const targetOwner = hitTestProjectorTarget(event.clientX, event.clientY);
    let object = targetOwner || hitTest(event.clientX, event.clientY);
    if (!object) {
      selectObject(null); state.dragging = { kind: "pan", pending: true, startClientX: event.clientX, startClientY: event.clientY, startPanX: state.pan.x, startPanY: state.pan.y };
      canvas.setPointerCapture?.(event.pointerId); render(); return;
    }
    if (targetOwner) selectObject(object);
    else if (event.shiftKey) toggleObjectSelection(object);
    else if (state.selectedIds.size > 1 && state.selectedIds.has(object.id)) state.selectedId = object.id;
    else selectObject(object);
    if (!object) return;
    if (targetOwner) {
      const target = effectiveLookAt(object);
      state.dragging = { kind: "lookAt", id: object.id, pending: true, startClientX: event.clientX, startClientY: event.clientY, offsetX: target.x - point.x, offsetZ: target.z - point.z };
    } else if (state.selectedIds.size > 1 && state.selectedIds.has(object.id)) {
      state.dragging = {
        kind: "group", id: object.id, pending: true, startPoint: point, startClientX: event.clientX, startClientY: event.clientY,
        positions: state.objects.filter(item => state.selectedIds.has(item.id)).map(item => ({ id: item.id, x: item.transform.position.x, z: item.transform.position.z }))
      };
    } else state.dragging = { kind: "object", id: object.id, pending: true, startPoint: point, startClientX: event.clientX, startClientY: event.clientY, offsetX: object.transform.position.x - point.x, offsetZ: object.transform.position.z - point.z };
    canvas.setPointerCapture?.(event.pointerId);
    render();
  });
  canvas.addEventListener("pointermove", event => {
    if (projectorTargetPlacement) {
      const rect = canvas.getBoundingClientRect();
      updateProjectorTargetPlacement(toWorld(event.clientX - rect.left, event.clientY - rect.top, sizing(false)));
      return;
    }
    if (!state.dragging) return;
    const rect = canvas.getBoundingClientRect();
    const point = toWorld(event.clientX - rect.left, event.clientY - rect.top, sizing(false));
    if (!state.dragging) return;
    if (state.dragging.pending) {
      const distance = Math.hypot(event.clientX - state.dragging.startClientX, event.clientY - state.dragging.startClientY);
      if (distance < 4) return;
      state.dragging.pending = false;
      if (state.dragging.kind !== "pan") saveHistory();
    }
    if (state.dragging.kind === "pan") {
      state.pan.x = state.dragging.startPanX + event.clientX - state.dragging.startClientX;
      state.pan.y = state.dragging.startPanY + event.clientY - state.dragging.startClientY;
      drawScene(); return;
    }
    const object = state.objects.find(item => item.id === state.dragging.id);
    if (!object) return;
    if (state.dragging.kind === "lookAt" && !state.dragging.started) { object.lookAt = effectiveLookAt(object); delete object.targetSurfacePluginId; state.dragging.started = true; }
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
      state.dragging.positions.forEach(position => { const item = state.objects.find(candidate => candidate.id === position.id); if (item) setObjectPlanPosition(item, Number((position.x + dx).toFixed(3)), Number((position.z + dz).toFixed(3))); });
    } else if (state.dragging.kind === "lookAt") {
      object.lookAt.x = Number(clamp(point.x + state.dragging.offsetX, bounds.minX, bounds.maxX).toFixed(3));
      object.lookAt.z = Number(clamp(point.z + state.dragging.offsetZ, bounds.minZ, bounds.maxZ).toFixed(3));
    } else {
      const x = Number(clamp(snapCoordinate("x", point.x + state.dragging.offsetX, object), bounds.minX, bounds.maxX).toFixed(3));
      const z = Number(clamp(snapCoordinate("z", point.z + state.dragging.offsetZ, object), bounds.minZ, bounds.maxZ).toFixed(3));
      setObjectPlanPosition(object, x, z);
    }
    drawScene();
    refreshActiveValues();
  });
  function clearDragState(event, commit = true) { const pointerId = event?.pointerId; state.dragging = null; state.guides = []; if (commit) persist(); render(); if (pointerId !== undefined && canvas.hasPointerCapture?.(pointerId)) canvas.releasePointerCapture(pointerId); }
  canvas.addEventListener("pointerup", event => clearDragState(event)); canvas.addEventListener("pointercancel", event => { cancelProjectorTargetPlacement(); clearDragState(event, false); }); canvas.addEventListener("lostpointercapture", event => { if (state.dragging) clearDragState(event); }); window.addEventListener("lostpointercapture", event => { if (state.dragging) clearDragState(event); }); window.addEventListener("blur", () => { cancelProjectorTargetPlacement(); if (state.dragging) clearDragState(undefined, false); }); document.addEventListener?.("visibilitychange", () => { if (document.hidden) { cancelProjectorTargetPlacement(); if (state.dragging) clearDragState(undefined, false); } }); window.addEventListener("resize", drawScene);
  canvas.addEventListener("wheel", event => { event.preventDefault(); state.zoom = clamp(state.zoom + (event.deltaY < 0 ? .1 : -.1), ZOOM_MIN, ZOOM_MAX); drawScene(); }, { passive: false });
  canvas.addEventListener("contextmenu", event => { event.preventDefault(); const object = hitTestProjectorTarget(event.clientX, event.clientY) || hitTest(event.clientX, event.clientY); if (object) openCanvasContextMenu(event, object); else { const rect = canvas.getBoundingClientRect(); openCanvasCreateMenu(event, toWorld(event.clientX - rect.left, event.clientY - rect.top, sizing(false))); } });
  document.querySelectorAll("[data-create-type]").forEach(button => button.addEventListener("click", () => { const point = contextWorldPoint; const type = button.dataset.createType; closeCanvasContextMenu(); if (point) addObjectAt(type, point.x, point.z, true); }));
  document.querySelectorAll("#canvas-context-menu [data-action]").forEach(button => button.addEventListener("click", () => { const id = contextObjectId; const action = button.dataset.action; if (!id) return; if (action === "bind-surface") { const list = document.querySelector("#surface-context-list"); list.hidden = !list.hidden; return; } if (action === "delete") { const object = state.objects.find(item => item.id === id); const record = object ? state.sync.objects?.[object.pluginId] : null; document.querySelector("#context-delete-confirm span").textContent = record?.designerId ? "Delete from Designer?" : "Delete object?"; document.querySelector("#context-delete-confirm").hidden = false; return; } closeCanvasContextMenu(); if (action === "rotate-90") rotateObject90(id); else duplicateObject(id, action === "mirror-x" ? "x" : action === "mirror-z" ? "z" : null); })); document.querySelector("#context-delete-yes").addEventListener("click", () => { const id = contextObjectId; const object = state.objects.find(item => item.id === id); const record = object ? state.sync.objects?.[object.pluginId] : null; closeCanvasContextMenu(); if (id) deleteObject(id, { deleteImportedFromDesigner: Boolean(record?.designerId && !record.owned) }); }); document.querySelector("#context-delete-no").addEventListener("click", () => { document.querySelector("#context-delete-confirm").hidden = true; });
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
  function renamedOwnedPaths(record, nextPath) { const paths = Array.isArray(record?.ownedPaths) ? record.ownedPaths : []; return paths.map(path => String(path) === String(record?.path) ? nextPath : path); }
  function validatedOwnedPaths(result, type) {
    const paths = [...new Set((Array.isArray(result?.ownedPaths) ? result.ownedPaths : []).map(String).filter(Boolean))];
    const mainPath = String(result?.path || "");
    const ownedResourceFolders = { screen: "ledscreen", dmxScreen: "dmxscreen", surface: "screen2", dmxLight: "fixturegroup" };
    const requiredFolders = type === "camera" ? ["objects/camera/", "objects/perspectiveprojectionobject/"] : type === "projector" ? ["objects/projector/", "objects/projectorconfig/"] : [`objects/${ownedResourceFolders[type] || ""}/`, "objects/directprojection/"];
    if (!mainPath || !paths.includes(mainPath) || requiredFolders.some(folder => !folder || !paths.some(path => path.startsWith(folder)))) throw new Error(`Designer ownership metadata is incomplete for ${type}`);
    if (type === "camera" && paths.filter(path => path.startsWith("objects/camera/")).length < 2) throw new Error("Designer ownership metadata is incomplete for camera");
    return paths;
  }
  globalThis.scenePlannerDebug = { state, makeDiff, syncToDesigner, ensureLiveObjects, deleteObject, renamedOwnedPaths, validatedOwnedPaths, objectPayload, validateReadback, canonical, changedValue, normalizeObject, stageBounds, stageFloorY, toScreen, toWorld, snapCoordinate, typeConfig, finite, formatValue, objectHeightValue, setObjectHeight, newObject, fieldSections, nextDimensionField, initialObjectFocusPath, effectiveLookAt, projectorYaw, setProjectorYaw, setObjectPlanPosition, addObjectAt, selectObject, duplicateObject, copySelectedObjects, pasteCopiedObjects, rotateObject90, normalizeYaw, hitTest, syncScreenMedia, setScreenInputMode, importDesignerScene, importedObject, updateProjectorTargetPlacement, commitProjectorTargetPlacement, cancelProjectorTargetPlacement, projectorPlacement: () => projectorTargetPlacement, pendingFocusPath: () => pendingFocusPath };
})();
