/**
 * OBS WebSocket Client
 * Verantwortung:
 * - Verbindungsaufbau + Reconnect
 * - OBS Request/Response Handling
 * - Szenen laden und Move-Filter anlegen
 */
(function initObsClient(scope) {
  const ADM = scope.ADM || (scope.ADM = {});
  const OBS_RECONNECT_DELAY_MS = 2000;
  const OBS_MAX_AUTO_RETRIES = 5;
  const OBS_HEARTBEAT_MS = 15000;
  const OBS_REACHABILITY_TIMEOUT_MS = 1200;

  let obsSocket = null;
  let obsConnecting = false;
  let obsIdentified = false;
  let obsVerified = false;
  let obsHeartbeatTimer = null;
  let obsRequestCounter = 0;
  let obsRetryTimer = null;
  let obsRetryAttempts = 0;
  let obsRetryExhausted = false;
  const obsPendingRequests = new Map();
  const obsStatus = {
    state: "unknown",
    url: "",
    lastChangeTs: 0,
    lastError: "",
    attempts: 0,
    exhausted: false
  };
  let lastObsConnectionLog = "";

  function isObsDebugEnabled() {
    return true;
  }

  function debugObs(message, data) {
    if (!isObsDebugEnabled()) return;
    try { ADM.logger?.info?.("obs", message, data); } catch {}
  }

  function debugObsWarn(message, data) {
    if (!isObsDebugEnabled()) return;
    try { ADM.logger?.warn?.("obs", message, data); } catch {}
  }

  function logObsConnectionState(state, url, data) {
    const normalizedState = String(state || "").trim().toLowerCase();
    const normalizedUrl = String(url || "").trim() || "unknown";
    const key = `${normalizedState}:${normalizedUrl}`;
    if (!normalizedState || lastObsConnectionLog === key) return;
    lastObsConnectionLog = key;
    if (normalizedState === "connected") {
      debugObs(`OBS connected (${normalizedUrl})`, data);
      return;
    }
    if (normalizedState === "disconnected") {
      debugObsWarn(`OBS disconnected (${normalizedUrl})`, data);
    }
  }

  function setObsStatus(next) {
    const prevState = obsStatus.state;
    obsStatus.state = String(next?.state || obsStatus.state || "unknown");
    obsStatus.url = String(next?.url ?? obsStatus.url ?? "");
    obsStatus.lastError = String(next?.lastError ?? obsStatus.lastError ?? "");
    obsStatus.attempts = Number.isFinite(next?.attempts) ? next.attempts : obsRetryAttempts;
    obsStatus.exhausted = typeof next?.exhausted === "boolean" ? next.exhausted : obsRetryExhausted;
    obsStatus.lastChangeTs = Date.now();
    try {
      if (!shouldUseObsConnection(ADM.getSettings?.())) return;
      const u = obsStatus.url;
      if (obsStatus.state === "connected" && prevState !== "connected") {
        ADM.workerModuleStatusLog?.obs?.(true, u);
      } else if (
        obsStatus.state === "disconnected" &&
        (prevState === "connected" || prevState === "connecting")
      ) {
        ADM.workerModuleStatusLog?.obs?.(false, u);
      }
    } catch {
      // ignore
    }
  }

  function getObsStatus() {
    return { ...obsStatus };
  }

  function clearObsRetryTimer() {
    if (!obsRetryTimer) return;
    clearTimeout(obsRetryTimer);
    obsRetryTimer = null;
  }

  function clearObsHeartbeatTimer() {
    if (!obsHeartbeatTimer) return;
    clearInterval(obsHeartbeatTimer);
    obsHeartbeatTimer = null;
  }

  function clearObsPendingRequests(errorMessage = "obs_connection_closed") {
    for (const pending of obsPendingRequests.values()) {
      try { clearTimeout(pending.timer); } catch {}
      try { pending.reject?.(new Error(errorMessage)); } catch {}
    }
    obsPendingRequests.clear();
  }

  function resetObsRetryState() {
    obsRetryAttempts = 0;
    obsRetryExhausted = false;
  }

  async function buildObsAuthentication(password, salt, challenge) {
    const secret = await ADM.sha256Base64?.(`${password}${salt}`);
    return ADM.sha256Base64?.(`${secret}${challenge}`);
  }

  function shouldUseObsConnection(settings = ADM.getSettings()) {
    if (settings?.obsEnabled === false) return false;
    const installed = new Set((Array.isArray(settings?.installedModules) ? settings.installedModules : [])
      .map((item) => String(item || "").trim().toLowerCase())
      .filter(Boolean));
    return installed.has("effects") || installed.has("overlay") || installed.has("obszoom");
  }

  function toHttpProbeUrl(rawUrl) {
    const value = String(rawUrl || "").trim();
    if (!value) return "";
    try {
      const parsed = new URL(value);
      const protocol = parsed.protocol === "wss:" ? "https:" : "http:";
      return `${protocol}//${parsed.host}/`;
    } catch {
      return "";
    }
  }

  async function canReachObsEndpoint(url, timeoutMs = OBS_REACHABILITY_TIMEOUT_MS) {
    const probeUrl = toHttpProbeUrl(url);
    if (!probeUrl) return false;
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timeout = setTimeout(() => {
      try { controller?.abort(); } catch {}
    }, Math.max(300, Number(timeoutMs) || OBS_REACHABILITY_TIMEOUT_MS));
    try {
      await fetch(probeUrl, {
        method: "GET",
        mode: "no-cors",
        cache: "no-store",
        signal: controller?.signal
      });
      return true;
    } catch {
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }

  function stopObsConnection(reason = "manual") {
    clearObsRetryTimer();
    clearObsHeartbeatTimer();
    obsConnecting = false;
    obsIdentified = false;
    obsVerified = false;
    if (obsSocket) {
      try {
        obsSocket.onopen = null;
        obsSocket.onmessage = null;
        obsSocket.onclose = null;
        obsSocket.onerror = null;
        obsSocket.close();
      } catch {}
      obsSocket = null;
    }
    clearObsPendingRequests(reason || "obs_connection_stopped");
    if (reason === "manual" || reason === "disabled") resetObsRetryState();
    setObsStatus({ state: "disconnected", lastError: reason });
    if (reason !== "manual" && reason !== "disabled") {
      logObsConnectionState("disconnected", obsStatus.url, { reason });
    }
  }

  function nextObsRequestId() {
    obsRequestCounter += 1;
    return `obs-${Date.now()}-${obsRequestCounter}`;
  }

  function sendObsRequest(requestType, requestData = {}) {
    if (!obsSocket || obsSocket.readyState !== WebSocket.OPEN || !obsIdentified) return false;
    try {
      const requestId = nextObsRequestId();
      obsSocket.send(JSON.stringify({
        op: 6,
        d: {
          requestType,
          requestId,
          requestData
        }
      }));
      return requestId;
    } catch {
      return false;
    }
  }

  function sendObsRequestAwait(requestType, requestData = {}, timeoutMs = 4000) {
    return new Promise((resolve, reject) => {
      const requestId = sendObsRequest(requestType, requestData);
      if (!requestId) {
        reject(new Error("obs_request_not_sent"));
        return;
      }
      const timer = setTimeout(() => {
        obsPendingRequests.delete(requestId);
        reject(new Error("obs_request_timeout"));
      }, Math.max(250, Number(timeoutMs) || 4000));
      obsPendingRequests.set(requestId, { resolve, reject, timer, requestType });
    });
  }

  function cloneJsonValue(value) {
    if (value === null || value === undefined) return value;
    return JSON.parse(JSON.stringify(value));
  }

  function mergeFilterSettings(defaults, actual) {
    if (Array.isArray(defaults)) {
      return Array.isArray(actual) ? cloneJsonValue(actual) : cloneJsonValue(defaults);
    }
    if (!defaults || typeof defaults !== "object") {
      return actual === undefined ? cloneJsonValue(defaults) : cloneJsonValue(actual);
    }
    const result = {};
    const keys = new Set([
      ...Object.keys(defaults || {}),
      ...Object.keys(actual && typeof actual === "object" ? actual : {})
    ]);
    for (const key of keys) {
      const defaultValue = defaults?.[key];
      const actualValue = actual?.[key];
      if (
        defaultValue &&
        typeof defaultValue === "object" &&
        !Array.isArray(defaultValue) &&
        actualValue &&
        typeof actualValue === "object" &&
        !Array.isArray(actualValue)
      ) {
        result[key] = mergeFilterSettings(defaultValue, actualValue);
      } else if (actualValue !== undefined) {
        result[key] = cloneJsonValue(actualValue);
      } else {
        result[key] = cloneJsonValue(defaultValue);
      }
    }
    return result;
  }

  function getDesiredMoveFilterNames(options = {}) {
    const names = ["Main", "Bull", "DBull", "Miss"];
    const includeSingles = options?.includeSingles !== false;
    const includeDoubles = options?.includeDoubles !== false;
    const includeTriples = options?.includeTriples !== false;
    if (includeSingles) {
      for (let i = 1; i <= 20; i += 1) names.push(`S${String(i).padStart(2, "0")}`);
    }
    if (includeTriples) {
      for (let i = 1; i <= 20; i += 1) names.push(`T${String(i).padStart(2, "0")}`);
    }
    if (includeDoubles) {
      for (let i = 1; i <= 20; i += 1) names.push(`D${String(i).padStart(2, "0")}`);
    }
    return names;
  }

  function getMoveFilterGroup(filterName) {
    const normalized = String(filterName || "").trim();
    if (!normalized) return "";
    if (/^(main|bull|dbull|miss)$/i.test(normalized)) return "base";
    if (/^s(?:0?[1-9]|1\d|20)$/i.test(normalized)) return "single";
    if (/^d(?:0?[1-9]|1\d|20)$/i.test(normalized)) return "double";
    if (/^t(?:0?[1-9]|1\d|20)$/i.test(normalized)) return "triple";
    return "";
  }

  function isManagedMoveFilter(filter, options = {}) {
    const filterName = String(filter?.filterName || "").trim();
    const group = getMoveFilterGroup(filterName);
    if (!group) return false;
    if (group === "base") return options?.includeBase === true;
    if (group === "single" && options?.includeSingles === false) return false;
    if (group === "double" && options?.includeDoubles === false) return false;
    if (group === "triple" && options?.includeTriples === false) return false;
    const filterKind = String(filter?.filterKind || "").trim().toLowerCase();
    return !filterKind || filterKind === "move_source_filter";
  }

  async function getObsScenes() {
    const connected = await ensureObsConnection();
    if (!connected) throw new Error("obs_not_connected");
    const response = await sendObsRequestAwait("GetSceneList", {}, 5000);
    const scenes = Array.isArray(response?.responseData?.scenes) ? response.responseData.scenes : [];
    const names = scenes
      .map((item) => String(item?.sceneName || "").trim())
      .filter(Boolean);
    debugObs("OBS scenes loaded", { count: names.length });
    return names;
  }

  async function getObsSourceFilters(sourceName) {
    const targetSource = String(sourceName || "").trim();
    if (!targetSource) throw new Error("missing_source_name");
    const connected = await ensureObsConnection();
    if (!connected) throw new Error("obs_not_connected");
    const response = await sendObsRequestAwait("GetSourceFilterList", { sourceName: targetSource }, 5000);
    return Array.isArray(response?.responseData?.filters) ? response.responseData.filters : [];
  }

  async function getObsSourceFilter(sourceName, filterName) {
    const targetSource = String(sourceName || "").trim();
    const targetFilter = String(filterName || "").trim();
    if (!targetSource) throw new Error("missing_source_name");
    if (!targetFilter) throw new Error("missing_filter_name");
    const connected = await ensureObsConnection();
    if (!connected) throw new Error("obs_not_connected");
    const response = await sendObsRequestAwait("GetSourceFilter", {
      sourceName: targetSource,
      filterName: targetFilter
    }, 5000);
    return response?.responseData || {};
  }

  async function setObsSourceFilterEnabled(sourceName, filterName, filterEnabled) {
    const targetSource = String(sourceName || "").trim();
    const targetFilter = String(filterName || "").trim();
    if (!targetSource) throw new Error("missing_source_name");
    if (!targetFilter) throw new Error("missing_filter_name");
    const connected = await ensureObsConnection();
    if (!connected) throw new Error("obs_not_connected");
    await sendObsRequestAwait("SetSourceFilterEnabled", {
      sourceName: targetSource,
      filterName: targetFilter,
      filterEnabled: !!filterEnabled
    }, 5000);
    return true;
  }

  async function getObsSceneSources(sceneName) {
    const targetScene = String(sceneName || "").trim();
    if (!targetScene) throw new Error("missing_scene_name");
    const connected = await ensureObsConnection();
    if (!connected) throw new Error("obs_not_connected");
    const response = await sendObsRequestAwait("GetSceneItemList", { sceneName: targetScene }, 5000);
    const sceneItems = Array.isArray(response?.responseData?.sceneItems) ? response.responseData.sceneItems : [];
    const names = [];
    const seen = new Set();
    for (const item of sceneItems) {
      const sourceName = String(item?.sourceName || "").trim();
      if (!sourceName || seen.has(sourceName)) continue;
      seen.add(sourceName);
      names.push(sourceName);
    }
    debugObs("OBS scene sources loaded", { sceneName: targetScene, count: names.length });
    return names;
  }

  async function getObsSceneItems(sceneName) {
    const targetScene = String(sceneName || "").trim();
    if (!targetScene) throw new Error("missing_scene_name");
    const connected = await ensureObsConnection();
    if (!connected) throw new Error("obs_not_connected");
    const response = await sendObsRequestAwait("GetSceneItemList", { sceneName: targetScene }, 5000);
    return Array.isArray(response?.responseData?.sceneItems) ? response.responseData.sceneItems : [];
  }

  async function getObsSceneItemId(sceneName, sourceName) {
    const want = String(sourceName || "").trim();
    if (!want) throw new Error("missing_source_name");
    const items = await getObsSceneItems(sceneName);
    for (const it of items) {
      if (String(it?.sourceName || "").trim() !== want) continue;
      const id = Number(it?.sceneItemId);
      if (Number.isFinite(id) && id >= 0) return id;
    }
    throw new Error("scene_item_not_found");
  }

  async function getObsSceneItemTransform(sceneName, sceneItemId) {
    const scene = String(sceneName || "").trim();
    const id = Number(sceneItemId);
    if (!scene) throw new Error("missing_scene_name");
    if (!Number.isFinite(id) || id < 0) throw new Error("missing_scene_item_id");
    const connected = await ensureObsConnection();
    if (!connected) throw new Error("obs_not_connected");
    const response = await sendObsRequestAwait(
      "GetSceneItemTransform",
      { sceneName: scene, sceneItemId: id },
      5000
    );
    return response?.responseData?.sceneItemTransform && typeof response.responseData.sceneItemTransform === "object"
      ? response.responseData.sceneItemTransform
      : null;
  }

  async function getObsVideoBaseResolution() {
    const connected = await ensureObsConnection();
    if (!connected) throw new Error("obs_not_connected");
    const response = await sendObsRequestAwait("GetVideoSettings", {}, 5000);
    const bw = Number(response?.responseData?.baseWidth);
    const bh = Number(response?.responseData?.baseHeight);
    const baseWidth = Number.isFinite(bw) && bw >= 8 ? Math.min(4096, Math.trunc(bw)) : 1920;
    const baseHeight = Number.isFinite(bh) && bh >= 8 ? Math.min(4096, Math.trunc(bh)) : 1080;
    return { baseWidth, baseHeight };
  }

  /**
   * Linksoberer Eckpunkt des Szenen-Items (axis-aligned, Rotation 0) — gleiche Logik wie OBS `add_alignment`.
   * @param {Record<string, unknown>} tr
   * @returns {{ left: number, top: number, width: number, height: number }}
   */
  function sceneItemAxisAlignedTopLeft(tr) {
    const w = Number(tr?.width);
    const h = Number(tr?.height);
    const posX = Number(tr?.positionX);
    const posY = Number(tr?.positionY);
    const align = Number(tr?.alignment) || 0;
    const LEFT = 1;
    const RIGHT = 2;
    const TOP = 4;
    const BOTTOM = 8;
    const width = Number.isFinite(w) && w > 0 ? w : 1;
    const height = Number.isFinite(h) && h > 0 ? h : 1;
    const px = Number.isFinite(posX) ? posX : 0;
    const py = Number.isFinite(posY) ? posY : 0;
    let left = px;
    let top = py;
    if ((align & RIGHT) !== 0 && (align & LEFT) === 0) left -= width;
    else if ((align & LEFT) === 0 && (align & RIGHT) === 0) left -= width / 2;
    if ((align & BOTTOM) !== 0 && (align & TOP) === 0) top -= height;
    else if ((align & TOP) === 0 && (align & BOTTOM) === 0) top -= height / 2;
    return { left, top, width, height };
  }

  /**
   * Für Kalibrierung: Rechteck der Ziel-Quelle auf dem Programm-Canvas (Pixel) + Crop/Quellengröße.
   * `canvasWidth`/`canvasHeight` = Pixelgröße des PGM-Screenshots (typisch = Basis-Auflösung).
   */
  async function getObsZoomCalibPlacement(opts = {}) {
    const sceneName = String(opts?.sceneName || "").trim();
    const targetSourceName = String(opts?.targetSourceName || "").trim();
    const canvasW = Math.max(1, Math.trunc(Number(opts?.canvasWidth) || 0));
    const canvasH = Math.max(1, Math.trunc(Number(opts?.canvasHeight) || 0));
    if (!sceneName) throw new Error("missing_scene_name");
    if (!targetSourceName) throw new Error("missing_source_name");

    const { baseWidth, baseHeight } = await getObsVideoBaseResolution();
    const sx = canvasW / baseWidth;
    const sy = canvasH / baseHeight;
    const sceneItemId = await getObsSceneItemId(sceneName, targetSourceName);
    const tr = await getObsSceneItemTransform(sceneName, sceneItemId);
    if (!tr || typeof tr !== "object") throw new Error("scene_item_transform_unavailable");
    const rotation = Number(tr.rotation) || 0;
    const box = sceneItemAxisAlignedTopLeft(tr);
    const rect = {
      left: box.left * sx,
      top: box.top * sy,
      width: box.width * sx,
      height: box.height * sy
    };
    const sourceWidth = Number(tr.sourceWidth) || 1920;
    const sourceHeight = Number(tr.sourceHeight) || 1080;
    return {
      ok: true,
      baseWidth,
      baseHeight,
      sceneName,
      targetSourceName,
      rect,
      sourceWidth,
      sourceHeight,
      cropLeft: Number(tr.cropLeft) || 0,
      cropRight: Number(tr.cropRight) || 0,
      cropTop: Number(tr.cropTop) || 0,
      cropBottom: Number(tr.cropBottom) || 0,
      rotation,
      rotationUnsupported: Math.abs(rotation) > 0.5
    };
  }

  /**
   * Screenshot einer OBS-Quelle (WebSocket 5: GetSourceScreenshot).
   * @returns {{ imageData: string, sourceName: string }}
   */
  async function getObsSourceScreenshot(sourceName, options = {}) {
    const sn = String(sourceName || "").trim();
    if (!sn) throw new Error("missing_source_name");
    const connected = await ensureObsConnection();
    if (!connected) throw new Error("obs_not_connected");
    const fmtRaw = String(options.imageFormat || "png").trim().toLowerCase();
    const imageFormat = fmtRaw === "jpg" || fmtRaw === "jpeg" ? "jpeg" : "png";
    const iw = Number(options.imageWidth);
    const ih = Number(options.imageHeight);
    const requestData = {
      sourceName: sn,
      imageFormat
    };
    const fp = String(options.imageFilePath || "").trim();
    if (fp) requestData.imageFilePath = fp;
    if (Number.isFinite(iw) && iw > 0) requestData.imageWidth = Math.min(1920, Math.max(64, Math.trunc(iw)));
    if (Number.isFinite(ih) && ih > 0) requestData.imageHeight = Math.min(1080, Math.max(36, Math.trunc(ih)));
    const q = Number(options.imageCompressionQuality);
    if (Number.isFinite(q)) requestData.imageCompressionQuality = Math.max(-1, Math.min(100, Math.trunc(q)));

    const response = await sendObsRequestAwait("GetSourceScreenshot", requestData, 12000);
    const imageData = String(response?.responseData?.imageData || "").trim();
    if (!imageData) throw new Error("obs_screenshot_empty");
    return { imageData, sourceName: sn };
  }

  /**
   * Screenshot der **aktuellen Programm-Szene** (Canvas / PGM) — keine einzelne Quelle.
   * Nutzt GetCurrentProgramScene + GetSourceScreenshot (Szenen sind in OBS „Sources“).
   */
  async function getObsProgramCanvasScreenshot(options = {}) {
    const connected = await ensureObsConnection();
    if (!connected) throw new Error("obs_not_connected");
    let sceneName = "";
    try {
      const cur = await sendObsRequestAwait("GetCurrentProgramScene", {}, 5000);
      sceneName = String(
        cur?.responseData?.sceneName || cur?.responseData?.currentProgramSceneName || ""
      ).trim();
    } catch {
      sceneName = "";
    }
    const fb = String(options?.fallbackSceneName || "").trim();
    if (!sceneName && fb) sceneName = fb;
    if (!sceneName) throw new Error("program_scene_unknown");

    const fmtRaw = String(options.imageFormat || "png").trim().toLowerCase();
    const imageFormat = fmtRaw === "jpg" || fmtRaw === "jpeg" ? "jpeg" : "png";
    const iw = Number(options.imageWidth);
    const ih = Number(options.imageHeight);
    const requestData = {
      sourceName: sceneName,
      imageFormat
    };
    if (Number.isFinite(iw) && iw > 0) requestData.imageWidth = Math.min(4096, Math.max(8, Math.trunc(iw)));
    if (Number.isFinite(ih) && ih > 0) requestData.imageHeight = Math.min(4096, Math.max(8, Math.trunc(ih)));
    const q = Number(options.imageCompressionQuality);
    if (Number.isFinite(q)) requestData.imageCompressionQuality = Math.max(-1, Math.min(100, Math.trunc(q)));

    const response = await sendObsRequestAwait("GetSourceScreenshot", requestData, 12000);
    const imageData = String(response?.responseData?.imageData || "").trim();
    if (!imageData) throw new Error("obs_screenshot_empty");
    return { imageData, sceneName };
  }

  /**
   * Move-Filter-Zieltransform aus Klick (0–1) + Zoom-Stärke ableiten und nach OBS schreiben.
   * Legacy: `points` Record<filterName, { nx, ny }>.
   * Canvas-Modus: `canvasMode` + optional `canvasPoint` — gleicher Klick/Zoom für alle Move-Filter laut getDesiredMoveFilterNames.
   */
  async function applyObsZoomCalibration(payload = {}) {
    const sceneName = String(payload?.sceneName || "").trim();
    const targetSourceName = String(payload?.targetSourceName || "").trim();
    const points = payload?.points && typeof payload.points === "object" ? payload.points : {};
    const canvasMode = !!payload?.canvasMode;
    const canvasPoint =
      payload?.canvasPoint && typeof payload.canvasPoint === "object" ? payload.canvasPoint : null;
    const hasCanvasPoint =
      !!canvasPoint &&
      Number.isFinite(Number(canvasPoint.nx)) &&
      Number.isFinite(Number(canvasPoint.ny));
    const strength = Math.max(1, Math.min(2000, Number(payload?.strength) || 150));
    const zoomPercent = Math.max(50, Math.min(400, Number(payload?.zoomPercent) || 100));
    if (!sceneName) throw new Error("missing_scene_name");
    if (!targetSourceName) throw new Error("missing_source_name");

    const filterOpts = {
      includeBase: true,
      includeSingles: payload?.includeSingles !== false,
      includeDoubles: payload?.includeDoubles !== false,
      includeTriples: payload?.includeTriples !== false
    };

    let filterNames = [];
    if (canvasMode) {
      filterNames = getDesiredMoveFilterNames(filterOpts);
    } else {
      filterNames = Object.keys(points).filter((k) => {
        const p = points[k];
        return (
          p &&
          typeof p === "object" &&
          Number.isFinite(Number(p.nx)) &&
          Number.isFinite(Number(p.ny))
        );
      });
    }
    if (!filterNames.length) throw new Error("no_calibration_points");

    const sceneItemId = await getObsSceneItemId(sceneName, targetSourceName);
    const tr = await getObsSceneItemTransform(sceneName, sceneItemId);
    if (!tr || typeof tr !== "object") throw new Error("scene_item_transform_unavailable");

    const tw = Number(tr.width);
    const th = Number(tr.height);
    const w = Number.isFinite(tw) && tw > 1 ? tw : 1920;
    const h = Number.isFinite(th) && th > 1 ? th : 1080;
    const baseX = Number(tr.positionX);
    const baseY = Number(tr.positionY);
    const bx = Number.isFinite(baseX) ? baseX : 0;
    const by = Number.isFinite(baseY) ? baseY : 0;
    const k = strength / 150;
    const zoomMul = zoomPercent / 100;

    const baseSx = Number(tr.scaleX);
    const baseSy = Number(tr.scaleY);
    const sx0 = Number.isFinite(baseSx) && baseSx > 0 ? baseSx : 100;
    const sy0 = Number.isFinite(baseSy) && baseSy > 0 ? baseSy : 100;
    const newSx = sx0 * zoomMul;
    const newSy = sy0 * zoomMul;

    const updatePos = canvasMode ? hasCanvasPoint : true;
    let nx = 0.5;
    let ny = 0.5;
    if (updatePos) {
      if (canvasMode && hasCanvasPoint) {
        nx = Math.max(0, Math.min(1, Number(canvasPoint.nx)));
        ny = Math.max(0, Math.min(1, Number(canvasPoint.ny)));
      }
    }

    let applied = 0;
    const errors = [];
    for (const filterName of filterNames) {
      let pNx = nx;
      let pNy = ny;
      if (!canvasMode) {
        const p = points[filterName];
        if (!p || typeof p !== "object") continue;
        pNx = Math.max(0, Math.min(1, Number(p.nx)));
        pNy = Math.max(0, Math.min(1, Number(p.ny)));
      }
      const newX = bx + (0.5 - pNx) * w * k;
      const newY = by + (0.5 - pNy) * h * k;
      try {
        const detail = await getObsSourceFilter(sceneName, filterName);
        const prev =
          detail?.filterSettings && typeof detail.filterSettings === "object"
            ? cloneJsonValue(detail.filterSettings)
            : {};
        const prevPos = prev.pos && typeof prev.pos === "object" ? prev.pos : {};
        const prevScale = prev.scale && typeof prev.scale === "object" ? prev.scale : {};
        const next = {
          ...prev,
          transform: true,
          scale: {
            ...prevScale,
            x: newSx,
            y: newSy,
            x_sign: "=",
            y_sign: "="
          }
        };
        if (updatePos) {
          next.pos = {
            ...prevPos,
            x: newX,
            y: newY,
            x_sign: "=",
            y_sign: "="
          };
        }
        await sendObsRequestAwait(
          "SetSourceFilterSettings",
          {
            sourceName: sceneName,
            filterName: String(filterName).trim(),
            filterSettings: next,
            overlay: true
          },
          5000
        );
        applied += 1;
      } catch (error) {
        errors.push({ filterName, error: String(error?.message || error || "unknown_error") });
      }
    }

    debugObs("OBS zoom calibration applied", { sceneName, targetSourceName, applied, errors: errors.length });
    return { sceneName, targetSourceName, applied, errors };
  }

  /**
   * Ziel-`pos`/`scale` fuer Move-Filter aus aktuellem Szenen-Item (gleiche Formel wie
   * `applyObsZoomCalibration` bei Mittelpunkt 0.5/0.5, Staerke 150, Zoom 100%).
   * So kann `transform: true` bleiben, ohne dass OBS-Defaults die Quelle verschieben.
   * @param {Record<string, unknown>} tr `GetSceneItemTransform`
   * @returns {{ transform: boolean, pos: Record<string, unknown>, scale: Record<string, unknown> } | null}
   */
  function buildMoveFilterSnapFromSceneItemTransform(tr) {
    if (!tr || typeof tr !== "object") return null;
    const tw = Number(tr.width);
    const th = Number(tr.height);
    const w = Number.isFinite(tw) && tw > 1 ? tw : 1920;
    const h = Number.isFinite(th) && th > 1 ? th : 1080;
    const baseX = Number(tr.positionX);
    const baseY = Number(tr.positionY);
    const bx = Number.isFinite(baseX) ? baseX : 0;
    const by = Number.isFinite(baseY) ? baseY : 0;
    const baseSx = Number(tr.scaleX);
    const baseSy = Number(tr.scaleY);
    const sx0 = Number.isFinite(baseSx) && baseSx > 0 ? baseSx : 100;
    const sy0 = Number.isFinite(baseSy) && baseSy > 0 ? baseSy : 100;
    const strength = 150;
    const k = strength / 150;
    const zoomMul = 1;
    const newSx = sx0 * zoomMul;
    const newSy = sy0 * zoomMul;
    const nx = 0.5;
    const ny = 0.5;
    const newX = bx + (0.5 - nx) * w * k;
    const newY = by + (0.5 - ny) * h * k;
    return {
      transform: true,
      pos: { x: newX, y: newY, x_sign: "=", y_sign: "=" },
      scale: { x: newSx, y: newSy, x_sign: "=", y_sign: "=" }
    };
  }

  async function getObsInputDetails(inputName) {
    const targetInput = String(inputName || "").trim();
    if (!targetInput) return null;
    const connected = await ensureObsConnection();
    if (!connected) throw new Error("obs_not_connected");
    try {
      const response = await sendObsRequestAwait("GetInputSettings", { inputName: targetInput }, 5000);
      return {
        inputName: targetInput,
        inputKind: String(response?.responseData?.inputKind || "").trim(),
        inputSettings: response?.responseData?.inputSettings && typeof response.responseData.inputSettings === "object"
          ? cloneJsonValue(response.responseData.inputSettings)
          : {}
      };
    } catch {
      return null;
    }
  }

  async function createObsMoveFilters(sceneName, sourceName, options = {}) {
    const targetScene = String(sceneName || "").trim();
    const targetSource = String(sourceName || "").trim();
    if (!targetScene) throw new Error("missing_scene_name");
    if (!targetSource) throw new Error("missing_source_name");
    const connected = await ensureObsConnection();
    if (!connected) throw new Error("obs_not_connected");
    const mode = String(options?.mode || "upsert").trim().toLowerCase();
    const duration = Math.max(0, Number(options?.duration) || 0);
    const easing = Number.isFinite(Number(options?.easing)) ? Number(options.easing) : 3;
    const easingFunction = Number.isFinite(Number(options?.easingFunction)) ? Number(options.easingFunction) : 2;

    const existingResponse = await sendObsRequestAwait("GetSourceFilterList", { sourceName: targetScene }, 5000);
    const existingFilters = Array.isArray(existingResponse?.responseData?.filters) ? existingResponse.responseData.filters : [];
    const existingByName = new Map();
    for (const filter of existingFilters) {
      const filterName = String(filter?.filterName || "").trim();
      if (!filterName) continue;
      existingByName.set(filterName, filter);
    }

    const desiredNames = getDesiredMoveFilterNames(options);

    let created = 0;
    let updated = 0;
    const errors = [];
    const nextFilterSettings = {
      source: targetSource,
      custom_duration: true,
      duration,
      easing_match: easing,
      easing_function_match: easingFunction
    };

    let snapFromScene = null;
    try {
      const sceneItemId = await getObsSceneItemId(targetScene, targetSource);
      const tr = await getObsSceneItemTransform(targetScene, sceneItemId);
      snapFromScene = buildMoveFilterSnapFromSceneItemTransform(tr);
    } catch (err) {
      debugObs("OBS move filter create: scene item transform skipped", {
        sceneName: targetScene,
        sourceName: targetSource,
        error: String(err?.message || err || "unknown")
      });
    }
    /** Mit Snap: `transform: true` + pos/scale = aktuelle Quelle (wie „Get Transform“). Ohne Snap: kein Ziel → `transform: false` gegen OBS-Default-Sprung. */
    const createFilterSettings = snapFromScene
      ? { ...nextFilterSettings, ...snapFromScene }
      : { ...nextFilterSettings, transform: false };

    for (const filterName of desiredNames) {
      try {
        if (existingByName.has(filterName)) {
          if (mode === "create") continue;
          let mergedSettings = nextFilterSettings;
          try {
            const detail = await sendObsRequestAwait(
              "GetSourceFilter",
              { sourceName: targetScene, filterName },
              5000
            );
            let prev =
              detail?.responseData?.filterSettings && typeof detail.responseData.filterSettings === "object"
                ? cloneJsonValue(detail.responseData.filterSettings)
                : {};
            if (!prev || typeof prev !== "object" || !Object.keys(prev).length) {
              const listItem = existingByName.get(filterName);
              const fromList =
                listItem?.filterSettings && typeof listItem.filterSettings === "object"
                  ? cloneJsonValue(listItem.filterSettings)
                  : {};
              if (fromList && typeof fromList === "object" && Object.keys(fromList).length) prev = fromList;
            }
            mergedSettings = mergeFilterSettings(prev, nextFilterSettings);
          } catch (_) {
            mergedSettings = nextFilterSettings;
          }
          await sendObsRequestAwait("SetSourceFilterSettings", {
            sourceName: targetScene,
            filterName,
            filterSettings: mergedSettings,
            overlay: true
          }, 5000);
          updated += 1;
        } else {
          if (mode === "update") continue;
          await sendObsRequestAwait("CreateSourceFilter", {
            sourceName: targetScene,
            filterName,
            filterKind: "move_source_filter",
            filterSettings: createFilterSettings
          }, 5000);
          created += 1;
        }
      } catch (error) {
        errors.push({ filterName, error: String(error?.message || error || "unknown_error") });
      }
    }

    debugObs("OBS move filters created", {
      sceneName: targetScene,
      sourceName: targetSource,
      created,
      updated,
      errors: errors.length
    });
    return {
      sceneName: targetScene,
      sourceName: targetSource,
      created,
      updated,
      errors
    };
  }

  function getObsMoveFilterNameList(options = {}) {
    return getDesiredMoveFilterNames(options);
  }

  async function deleteObsMoveFilters(sceneName, options = {}) {
    const targetScene = String(sceneName || "").trim();
    if (!targetScene) throw new Error("missing_scene_name");
    const connected = await ensureObsConnection();
    if (!connected) throw new Error("obs_not_connected");

    const existingResponse = await sendObsRequestAwait("GetSourceFilterList", { sourceName: targetScene }, 5000);
    const existingFilters = Array.isArray(existingResponse?.responseData?.filters) ? existingResponse.responseData.filters : [];
    const matchingFilters = existingFilters.filter((filter) => isManagedMoveFilter(filter, options));

    let deleted = 0;
    const errors = [];
    for (const filter of matchingFilters) {
      const filterName = String(filter?.filterName || "").trim();
      if (!filterName) continue;
      try {
        await sendObsRequestAwait("RemoveSourceFilter", {
          sourceName: targetScene,
          filterName
        }, 5000);
        deleted += 1;
      } catch (error) {
        errors.push({ filterName, error: String(error?.message || error || "unknown_error") });
      }
    }

    debugObs("OBS move filters deleted", {
      sceneName: targetScene,
      requestedSingles: options?.includeSingles !== false,
      requestedDoubles: options?.includeDoubles !== false,
      requestedTriples: options?.includeTriples !== false,
      matchingFilters: matchingFilters.map((item) => String(item?.filterName || "").trim()),
      deleted,
      errors: errors.length
    });
    return {
      sceneName: targetScene,
      deleted,
      errors
    };
  }

  async function getObsMoveFilterBackup(sceneName) {
    const targetScene = String(sceneName || "").trim();
    if (!targetScene) throw new Error("missing_scene_name");
    const connected = await ensureObsConnection();
    if (!connected) throw new Error("obs_not_connected");

    let defaultFilterSettings = {};
    try {
      const defaultsResponse = await sendObsRequestAwait("GetSourceFilterDefaultSettings", {
        filterKind: "move_source_filter"
      }, 5000);
      defaultFilterSettings = defaultsResponse?.responseData?.defaultFilterSettings
        && typeof defaultsResponse.responseData.defaultFilterSettings === "object"
        ? defaultsResponse.responseData.defaultFilterSettings
        : {};
    } catch {}

    const response = await sendObsRequestAwait("GetSourceFilterList", { sourceName: targetScene }, 5000);
    const sceneItems = await getObsSceneItems(targetScene);
    const filterList = (Array.isArray(response?.responseData?.filters) ? response.responseData.filters : [])
      .filter((item) => isManagedMoveFilter(item, {
        includeBase: true,
        includeSingles: true,
        includeDoubles: true,
        includeTriples: true
      }))
      .sort((a, b) => {
        const aIndex = Number(a?.filterIndex ?? -1);
        const bIndex = Number(b?.filterIndex ?? -1);
        const hasAIndex = Number.isFinite(aIndex) && aIndex >= 0;
        const hasBIndex = Number.isFinite(bIndex) && bIndex >= 0;
        if (hasAIndex && hasBIndex && aIndex !== bIndex) return aIndex - bIndex;
        if (hasAIndex !== hasBIndex) return hasAIndex ? -1 : 1;
        const aName = String(a?.filterName || "").trim();
        const bName = String(b?.filterName || "").trim();
        return aName.localeCompare(bName, undefined, { numeric: true, sensitivity: "base" });
      });

    const filters = [];
    for (const listItem of filterList) {
      const filterName = String(listItem?.filterName || "").trim();
      if (!filterName) continue;
      try {
        const detail = await sendObsRequestAwait("GetSourceFilter", {
          sourceName: targetScene,
          filterName
        }, 5000);
        const rawFilterSettings = detail?.responseData?.filterSettings && typeof detail.responseData.filterSettings === "object"
          ? cloneJsonValue(detail.responseData.filterSettings)
          : (listItem?.filterSettings && typeof listItem.filterSettings === "object"
              ? cloneJsonValue(listItem.filterSettings)
              : {});
        filters.push({
          ...listItem,
          ...(detail?.responseData || {}),
          filterName,
          filterKind: String(detail?.responseData?.filterKind || listItem?.filterKind || "").trim(),
          filterIndex: Number(detail?.responseData?.filterIndex ?? listItem?.filterIndex ?? -1),
          filterEnabled: typeof detail?.responseData?.filterEnabled === "boolean"
            ? !!detail.responseData.filterEnabled
            : !!listItem?.filterEnabled,
          rawFilterSettings,
          filterSettings: mergeFilterSettings(defaultFilterSettings, rawFilterSettings)
        });
      } catch (error) {
        const rawFilterSettings = listItem?.filterSettings && typeof listItem.filterSettings === "object"
          ? cloneJsonValue(listItem.filterSettings)
          : {};
        filters.push({
          ...listItem,
          filterName,
          filterKind: String(listItem?.filterKind || "").trim(),
          filterIndex: Number(listItem?.filterIndex ?? -1),
          filterEnabled: !!listItem?.filterEnabled,
          rawFilterSettings,
          filterSettings: mergeFilterSettings(defaultFilterSettings, rawFilterSettings),
          backupError: String(error?.message || error || "obs_get_source_filter_failed")
        });
      }
    }

    const sourceNames = Array.from(new Set(
      filters
        .map((item) => String(item?.filterSettings?.source || "").trim())
        .filter(Boolean)
    ));
    const sources = [];
    for (const sourceName of sourceNames) {
      const sceneItem = sceneItems.find((item) => String(item?.sourceName || "").trim() === sourceName) || null;
      const input = await getObsInputDetails(sourceName);
      sources.push({
        sourceName,
        sceneItemId: Number(sceneItem?.sceneItemId ?? -1),
        sceneItemIndex: Number(sceneItem?.sceneItemIndex ?? -1),
        sceneItemEnabled: typeof sceneItem?.sceneItemEnabled === "boolean" ? !!sceneItem.sceneItemEnabled : true,
        sourceType: String(sceneItem?.sourceType || "").trim(),
        isGroup: sceneItem?.isGroup === true,
        inputKind: String(input?.inputKind || "").trim(),
        inputSettings: input?.inputSettings && typeof input.inputSettings === "object"
          ? cloneJsonValue(input.inputSettings)
          : {}
      });
    }
    sources.sort((a, b) => {
      const aIndex = Number(a?.sceneItemIndex ?? -1);
      const bIndex = Number(b?.sceneItemIndex ?? -1);
      const hasAIndex = Number.isFinite(aIndex) && aIndex >= 0;
      const hasBIndex = Number.isFinite(bIndex) && bIndex >= 0;
      if (hasAIndex && hasBIndex && aIndex !== bIndex) return aIndex - bIndex;
      if (hasAIndex !== hasBIndex) return hasAIndex ? -1 : 1;
      return String(a?.sourceName || "").localeCompare(String(b?.sourceName || ""), undefined, { numeric: true, sensitivity: "base" });
    });

    debugObs("OBS move filter backup loaded", { sceneName: targetScene, count: filters.length });
    return {
      sceneName: targetScene,
      exportedAt: new Date().toISOString(),
      sources,
      filters
    };
  }

  /**
   * Kompaktes JSON nur mit Move-Filter-Einstellungen (ohne Quellen-Snapshot) — Save im Popup.
   * @returns {Promise<{ type: string, schemaVersion: number, sceneName: string, exportedAt: string, filters: object[] }>}
   */
  async function exportObsMoveFilterSettings(sceneName) {
    const full = await getObsMoveFilterBackup(sceneName);
    const filters = (Array.isArray(full.filters) ? full.filters : []).map((f) => ({
      filterName: String(f?.filterName || "").trim(),
      filterKind: String(f?.filterKind || "move_source_filter").trim() || "move_source_filter",
      filterEnabled: typeof f?.filterEnabled === "boolean" ? !!f.filterEnabled : true,
      filterSettings:
        f?.filterSettings && typeof f.filterSettings === "object" ? cloneJsonValue(f.filterSettings) : {}
    }));
    return {
      type: "obszoom-move-filter-settings",
      schemaVersion: 1,
      sceneName: String(full.sceneName || sceneName || "").trim(),
      exportedAt: String(full.exportedAt || new Date().toISOString()),
      filters
    };
  }

  /**
   * Wendet `filterSettings` aus Save-JSON auf bestehende Filter der Szene an (keine neuen Quellen/Szenen).
   * Akzeptiert auch volle Backups (`obszoom-move-filter-backup`), nutzt dann nur `filters`.
   */
  async function importObsMoveFilterSettings(doc) {
    const sceneName = String(doc?.sceneName || "").trim();
    const filtersIn = Array.isArray(doc?.filters) ? doc.filters : [];
    if (!sceneName) throw new Error("missing_scene_name");
    if (!filtersIn.length) throw new Error("missing_filters");
    const connected = await ensureObsConnection();
    if (!connected) throw new Error("obs_not_connected");

    const listRes = await sendObsRequestAwait("GetSourceFilterList", { sourceName: sceneName }, 5000);
    const existing = new Set(
      (Array.isArray(listRes?.responseData?.filters) ? listRes.responseData.filters : [])
        .map((x) => String(x?.filterName || "").trim())
        .filter(Boolean)
    );

    let applied = 0;
    const errors = [];
    for (const f of filtersIn) {
      const filterName = String(f?.filterName || "").trim();
      if (!filterName) continue;
      if (!existing.has(filterName)) {
        errors.push({ filterName, error: "filter_not_on_scene" });
        continue;
      }
      const raw =
        f?.rawFilterSettings && typeof f.rawFilterSettings === "object"
          ? f.rawFilterSettings
          : f?.filterSettings && typeof f.filterSettings === "object"
            ? f.filterSettings
            : {};
      const filterSettings = cloneJsonValue(raw);
      try {
        await sendObsRequestAwait(
          "SetSourceFilterSettings",
          { sourceName: sceneName, filterName, filterSettings, overlay: true },
          5000
        );
        if (typeof f?.filterEnabled === "boolean") {
          await sendObsRequestAwait(
            "SetSourceFilterEnabled",
            { sourceName: sceneName, filterName, filterEnabled: !!f.filterEnabled },
            5000
          );
        }
        applied += 1;
      } catch (error) {
        errors.push({ filterName, error: String(error?.message || error || "unknown_error") });
      }
    }
    debugObs("OBS move filter settings import", { sceneName, applied, errors: errors.length });
    return { sceneName, applied, errors };
  }

  async function importObsMoveFilterBackup(backup) {
    const sceneName = String(backup?.sceneName || "").trim();
    if (!sceneName) throw new Error("missing_scene_name");
    const filters = Array.isArray(backup?.filters) ? backup.filters : [];
    const sources = Array.isArray(backup?.sources) ? backup.sources : [];
    const connected = await ensureObsConnection();
    if (!connected) throw new Error("obs_not_connected");

    const scenes = await getObsScenes();
    const sceneNames = new Set(scenes.map((item) => String(item || "").trim()).filter(Boolean));
    if (!scenes.includes(sceneName)) {
      await sendObsRequestAwait("CreateScene", { sceneName }, 5000);
      sceneNames.add(sceneName);
    }

    const inputListResponse = await sendObsRequestAwait("GetInputList", {}, 5000);
    const existingInputNames = new Set(
      (Array.isArray(inputListResponse?.responseData?.inputs) ? inputListResponse.responseData.inputs : [])
        .map((item) => String(item?.inputName || "").trim())
        .filter(Boolean)
    );

    const sceneItemsBefore = await getObsSceneItems(sceneName);
    const sceneItemsBySource = new Map();
    for (const item of sceneItemsBefore) {
      const sourceName = String(item?.sourceName || "").trim();
      if (!sourceName || sceneItemsBySource.has(sourceName)) continue;
      sceneItemsBySource.set(sourceName, item);
    }

    let createdScene = !scenes.includes(sceneName) ? 1 : 0;
    let createdSources = 0;
    let updatedSources = 0;
    let createdFilters = 0;
    let updatedFilters = 0;
    const errors = [];

    for (const source of sources) {
      const sourceName = String(source?.sourceName || "").trim();
      if (!sourceName) continue;
      const inputKind = String(source?.inputKind || "").trim();
      const inputSettings = source?.inputSettings && typeof source.inputSettings === "object"
        ? cloneJsonValue(source.inputSettings)
        : {};
      try {
        const sourceExistsAsInput = existingInputNames.has(sourceName);
        const sourceExistsAsScene = sceneNames.has(sourceName);
        const sceneItemExists = sceneItemsBySource.has(sourceName);

        if (!sourceExistsAsInput && !sourceExistsAsScene) {
          if (!inputKind) throw new Error("missing_input_kind");
          await sendObsRequestAwait("CreateInput", {
            sceneName,
            inputName: sourceName,
            inputKind,
            inputSettings,
            sceneItemEnabled: source?.sceneItemEnabled !== false
          }, 5000);
          existingInputNames.add(sourceName);
          createdSources += 1;
        } else {
          if (sourceExistsAsInput && inputKind) {
            await sendObsRequestAwait("SetInputSettings", {
              inputName: sourceName,
              inputSettings,
              overlay: false
            }, 5000);
            updatedSources += 1;
          }
          if (!sceneItemExists) {
            await sendObsRequestAwait("CreateSceneItem", {
              sceneName,
              sourceName
            }, 5000);
          }
        }
      } catch (error) {
        errors.push({ scope: "source", sourceName, error: String(error?.message || error || "unknown_error") });
      }
    }

    const sceneItemsAfter = await getObsSceneItems(sceneName);
    const sceneItemsAfterBySource = new Map();
    for (const item of sceneItemsAfter) {
      const sourceName = String(item?.sourceName || "").trim();
      if (!sourceName || sceneItemsAfterBySource.has(sourceName)) continue;
      sceneItemsAfterBySource.set(sourceName, item);
    }

    for (const source of sources) {
      const sourceName = String(source?.sourceName || "").trim();
      if (!sourceName) continue;
      const sceneItem = sceneItemsAfterBySource.get(sourceName);
      const sceneItemId = Number(sceneItem?.sceneItemId ?? -1);
      if (!Number.isFinite(sceneItemId) || sceneItemId < 0) continue;
      try {
        if (typeof source?.sceneItemEnabled === "boolean") {
          await sendObsRequestAwait("SetSceneItemEnabled", {
            sceneName,
            sceneItemId,
            sceneItemEnabled: !!source.sceneItemEnabled
          }, 5000);
        }
        const sceneItemIndex = Number(source?.sceneItemIndex ?? -1);
        if (Number.isFinite(sceneItemIndex) && sceneItemIndex >= 0) {
          await sendObsRequestAwait("SetSceneItemIndex", {
            sceneName,
            sceneItemId,
            sceneItemIndex
          }, 5000);
        }
      } catch (error) {
        errors.push({ scope: "sceneItem", sourceName, error: String(error?.message || error || "unknown_error") });
      }
    }

    const existingFilterResponse = await sendObsRequestAwait("GetSourceFilterList", { sourceName: sceneName }, 5000);
    const existingFiltersByName = new Map();
    for (const item of (Array.isArray(existingFilterResponse?.responseData?.filters) ? existingFilterResponse.responseData.filters : [])) {
      const filterName = String(item?.filterName || "").trim();
      if (!filterName) continue;
      existingFiltersByName.set(filterName, item);
    }

    for (const filter of filters) {
      const filterName = String(filter?.filterName || "").trim();
      if (!filterName) continue;
      const filterSettings = filter?.rawFilterSettings && typeof filter.rawFilterSettings === "object"
        ? cloneJsonValue(filter.rawFilterSettings)
        : (filter?.filterSettings && typeof filter.filterSettings === "object"
            ? cloneJsonValue(filter.filterSettings)
            : {});
      try {
        if (existingFiltersByName.has(filterName)) {
          await sendObsRequestAwait("SetSourceFilterSettings", {
            sourceName: sceneName,
            filterName,
            filterSettings,
            overlay: false
          }, 5000);
          updatedFilters += 1;
        } else {
          await sendObsRequestAwait("CreateSourceFilter", {
            sourceName: sceneName,
            filterName,
            filterKind: String(filter?.filterKind || "move_source_filter").trim() || "move_source_filter",
            filterSettings
          }, 5000);
          createdFilters += 1;
        }
        if (typeof filter?.filterEnabled === "boolean") {
          await sendObsRequestAwait("SetSourceFilterEnabled", {
            sourceName: sceneName,
            filterName,
            filterEnabled: !!filter.filterEnabled
          }, 5000);
        }
      } catch (error) {
        errors.push({ scope: "filter", filterName, error: String(error?.message || error || "unknown_error") });
      }
    }

    const filtersSortedByIndex = [...filters]
      .map((filter) => ({
        filterName: String(filter?.filterName || "").trim(),
        filterIndex: Number(filter?.filterIndex ?? -1)
      }))
      .filter((filter) => filter.filterName && Number.isFinite(filter.filterIndex) && filter.filterIndex >= 0)
      .sort((a, b) => a.filterIndex - b.filterIndex);

    for (const filter of filtersSortedByIndex) {
      try {
        await sendObsRequestAwait("SetSourceFilterIndex", {
          sourceName: sceneName,
          filterName: filter.filterName,
          filterIndex: filter.filterIndex
        }, 5000);
      } catch (error) {
        errors.push({ scope: "filterOrder", filterName: filter.filterName, error: String(error?.message || error || "unknown_error") });
      }
    }

    debugObs("OBS move filter backup imported", {
      sceneName,
      createdScene,
      createdSources,
      updatedSources,
      createdFilters,
      updatedFilters,
      importedSources: sources.length,
      importedFilters: filters.length,
      errors: errors.length
    });
    return {
      sceneName,
      createdScene,
      createdSources,
      updatedSources,
      createdFilters,
      updatedFilters,
      errors
    };
  }

  function startObsHeartbeat(url) {
    clearObsHeartbeatTimer();
    obsHeartbeatTimer = setInterval(() => {
      if (!obsSocket || obsSocket.readyState !== WebSocket.OPEN || !obsIdentified) return;
      const sent = sendObsRequest("GetVersion");
      if (!sent) {
        setObsStatus({ state: "disconnected", url, lastError: "heartbeat_failed" });
      }
    }, OBS_HEARTBEAT_MS);
  }

  function scheduleObsRetry(reason = "unknown") {
    if (!shouldUseObsConnection()) return;
    if (obsRetryTimer) return;
    if (obsRetryAttempts >= OBS_MAX_AUTO_RETRIES) {
      obsRetryExhausted = true;
      setObsStatus({ state: "disconnected", lastError: reason, exhausted: true });
      debugObsWarn(`OBS reconnect exhausted (${String(reason)})`, {
        attempts: obsRetryAttempts,
        url: obsStatus.url
      });
      return;
    }
    obsRetryTimer = setTimeout(() => {
      obsRetryTimer = null;
      void ensureObsConnection();
    }, OBS_RECONNECT_DELAY_MS);
    debugObsWarn(`OBS reconnect scheduled (${String(reason)})`, {
      delayMs: OBS_RECONNECT_DELAY_MS,
      url: obsStatus.url
    });
  }

  async function ensureObsConnection(force = false) {
    const settings = ADM.getSettings();
    const url = String(settings?.obsUrl || "").trim();
    const password = String(settings?.obsPassword || "");
    if (!shouldUseObsConnection(settings)) {
      stopObsConnection("disabled");
      return false;
    }
    if (force) resetObsRetryState();
    if (obsRetryExhausted && !force) return false;
    if (obsSocket && obsIdentified && obsSocket.readyState === WebSocket.OPEN) {
      if (obsVerified) {
        setObsStatus({ state: "connected", url, lastError: "" });
        return true;
      }
      return false;
    }
    if (obsConnecting) return false;

    obsConnecting = true;
    obsIdentified = false;
    obsVerified = false;
    obsRetryAttempts += 1;
    obsRetryExhausted = false;
    setObsStatus({ state: "connecting", url, lastError: "" });
    debugObs(`OBS connecting (${url})`, { attempt: obsRetryAttempts });
    const endpointReachable = await canReachObsEndpoint(url);
    if (!endpointReachable) {
      obsConnecting = false;
      setObsStatus({ state: "disconnected", url, lastError: "connect_failed" });
      debugObsWarn(`OBS endpoint unreachable (${url})`, { attempt: obsRetryAttempts });
      scheduleObsRetry("connect_failed");
      return false;
    }
    return new Promise((resolve) => {
      let settled = false;

      function finish(ok) {
        if (settled) return;
        settled = true;
        resolve(!!ok);
      }

      try {
        obsSocket = new WebSocket(url, "obswebsocket.json");
      } catch (e) {
        obsConnecting = false;
        setObsStatus({ state: "disconnected", url, lastError: "connect_failed" });
        debugObsWarn(`OBS websocket failed (${url})`, { error: String(e?.message || e) });
        scheduleObsRetry("connect_failed");
        finish(false);
        return;
      }

      obsSocket.onopen = () => {
        obsIdentified = false;
        obsVerified = false;
        setObsStatus({ state: "connecting", url, lastError: "" });
        debugObs(`OBS ws open (${url})`, {});
      };

      obsSocket.onmessage = async (event) => {
        let data = null;
        try {
          data = JSON.parse(String(event?.data || ""));
        } catch {
          return;
        }

        if (Number(data?.op) === 0 || String(data?.messageType || "") === "Hello") {
          const hello = data?.d || {};
          const identify = {
            op: 1,
            d: {
              rpcVersion: Number(hello?.rpcVersion || 1)
            }
          };
          const legacyIdentify = {
            messageType: "Identify",
            rpcVersion: Number(hello?.rpcVersion || data?.rpcVersion || 1)
          };
          const auth = hello?.authentication || data?.authentication;
          if (auth?.salt && auth?.challenge) {
            if (!password) {
              stopObsConnection("auth_required");
              scheduleObsRetry("auth_required");
              finish(false);
              return;
            }
            try {
              const authentication = await buildObsAuthentication(password, auth.salt, auth.challenge);
              identify.d.authentication = authentication;
              legacyIdentify.authentication = authentication;
            } catch {
              stopObsConnection("auth_failed");
              scheduleObsRetry("auth_failed");
              finish(false);
              return;
            }
          }
          try {
            obsSocket?.send(JSON.stringify(Number(data?.op) === 0 ? identify : legacyIdentify));
          } catch {
            stopObsConnection("identify_failed");
            scheduleObsRetry("identify_failed");
            finish(false);
          }
          return;
        }

        if (Number(data?.op) === 2 || String(data?.messageType || "") === "Identified") {
          obsIdentified = true;
          resetObsRetryState();
          clearObsRetryTimer();
          setObsStatus({ state: "connecting", url, lastError: "" });
          sendObsRequest("GetVersion");
          startObsHeartbeat(url);
          return;
        }

        if (Number(data?.op) === 7 && data?.d?.requestType === "GetVersion") {
          const ok = !!data?.d?.requestStatus?.result;
          if (ok) {
            obsVerified = true;
            obsConnecting = false;
            setObsStatus({ state: "connected", url, lastError: "" });
            logObsConnectionState("connected", url);
            finish(true);
          } else {
            obsVerified = false;
            setObsStatus({ state: "disconnected", url, lastError: "request_failed" });
            logObsConnectionState("disconnected", url, { reason: "request_failed" });
            finish(false);
          }
        }

        if (Number(data?.op) === 7) {
          const requestId = String(data?.d?.requestId || "").trim();
          const pending = requestId ? obsPendingRequests.get(requestId) : null;
          if (pending) {
            obsPendingRequests.delete(requestId);
            try { clearTimeout(pending.timer); } catch {}
            const ok = !!data?.d?.requestStatus?.result;
            if (ok) pending.resolve(data?.d || {});
            else pending.reject(new Error(String(data?.d?.requestStatus?.comment || data?.d?.requestStatus?.code || "obs_request_failed")));
            return;
          }
        }
      };

      obsSocket.onerror = () => {
        if (obsIdentified) {
          obsVerified = false;
          setObsStatus({ state: "disconnected", url, lastError: "socket_error" });
        }
      };

      obsSocket.onclose = () => {
        const shouldRetry = shouldUseObsConnection();
        const wasIdentified = obsIdentified;
        obsSocket = null;
        clearObsPendingRequests(wasIdentified ? "socket_closed" : "connect_failed");
        clearObsHeartbeatTimer();
        obsConnecting = false;
        obsIdentified = false;
        obsVerified = false;
        setObsStatus({ state: "disconnected", url, lastError: wasIdentified ? "socket_closed" : "connect_failed" });
        logObsConnectionState("disconnected", url, { reason: wasIdentified ? "socket_closed" : "connect_failed" });
        if (shouldRetry) scheduleObsRetry(wasIdentified ? "socket_closed" : "connect_failed");
        finish(false);
      };
    });
  }

  ADM.sendObsRequest = sendObsRequest;
  ADM.sendObsRequestAwait = sendObsRequestAwait;
  ADM.getObsStatus = getObsStatus;
  ADM.getObsScenes = getObsScenes;
  ADM.getObsSourceFilters = getObsSourceFilters;
  ADM.getObsSourceFilter = getObsSourceFilter;
  ADM.setObsSourceFilterEnabled = setObsSourceFilterEnabled;
  ADM.getObsSceneSources = getObsSceneSources;
  ADM.createObsMoveFilters = createObsMoveFilters;
  ADM.deleteObsMoveFilters = deleteObsMoveFilters;
  ADM.getObsMoveFilterBackup = getObsMoveFilterBackup;
  ADM.exportObsMoveFilterSettings = exportObsMoveFilterSettings;
  ADM.importObsMoveFilterSettings = importObsMoveFilterSettings;
  ADM.importObsMoveFilterBackup = importObsMoveFilterBackup;
  ADM.getObsMoveFilterNameList = getObsMoveFilterNameList;
  ADM.getObsSceneItems = getObsSceneItems;
  ADM.getObsSceneItemTransform = getObsSceneItemTransform;
  ADM.getObsSourceScreenshot = getObsSourceScreenshot;
  ADM.getObsProgramCanvasScreenshot = getObsProgramCanvasScreenshot;
  ADM.getObsVideoBaseResolution = getObsVideoBaseResolution;
  ADM.getObsZoomCalibPlacement = getObsZoomCalibPlacement;
  ADM.applyObsZoomCalibration = applyObsZoomCalibration;
  ADM.refreshObsConnection = () => {
    if (shouldUseObsConnection()) return ensureObsConnection();
    stopObsConnection("disabled");
    return Promise.resolve(false);
  };
  ADM.retryObsConnection = () => ensureObsConnection(true);
})(self);
