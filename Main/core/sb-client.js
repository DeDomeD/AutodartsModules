/**
 * Streamer.bot WebSocket Client
 * Verantwortung:
 * - Verbindungsaufbau + Reconnect/Queue
 * - Action-Ausloesung ueber `fireActionByKey`
 * - Verbindungs-Schnelltest (`connectOnceForTest`) fuer Popup
 */
(function initSBClient(scope) {
  const ADM = scope.ADM || (scope.ADM = {});
  const SB_ICON_URL = chrome.runtime.getURL("Modules/overlay/streamerbot-logo.png");
  const SB_ICON_LOG_STYLE =
    `background: url("${SB_ICON_URL}") no-repeat left center / 14px 14px; ` +
    "padding-left: 18px; line-height: 14px;";

  let sbSocket = null;
  let sbConnecting = false;
  let sbHandshakeDone = false;
  let sbAuthRequestId = "";
  const actionQueue = [];
  let reconnectTimer = null;
  const RECONNECT_DELAY_MS = 2000;
  const MAX_AUTO_RETRIES = 5;
  const SB_REACHABILITY_TIMEOUT_MS = 1200;
  let sbOutageActive = false;
  let sbRetryAttempts = 0;
  let sbRetryExhausted = false;
  const sbStatus = {
    state: "unknown",
    url: "",
    lastChangeTs: 0,
    lastError: "",
    attempts: 0,
    exhausted: false
  };
  const sbMessageListeners = new Set();
  const sbCustomEventSubscriptions = new Set();

  /** Gleiche SB-Aktion (z. B. T20) oft 2x durch Custom+Default oder doppelte Custom-Regeln — einen kurzen Schutz. */
  let lastSbFireDedupeSig = "";
  let lastSbFireDedupeAt = 0;
  const SB_FIRE_DEBOUNCE_MS = 260;
  /** Gleicher finaler Action-Name (Named Turn vs. Key): 260ms reichen bei zwei State-Ticks nicht. */
  let lastSbActionNameDedupe = "";
  let lastSbActionNameDedupeAt = 0;
  const SB_SAME_ACTION_NAME_MS = 950;

  function setSBStatus(next) {
    const prevState = sbStatus.state;
    sbStatus.state = String(next?.state || sbStatus.state || "unknown");
    sbStatus.url = String(next?.url ?? sbStatus.url ?? "");
    sbStatus.lastError = String(next?.lastError ?? sbStatus.lastError ?? "");
    sbStatus.attempts = Number.isFinite(next?.attempts) ? next.attempts : sbRetryAttempts;
    sbStatus.exhausted = typeof next?.exhausted === "boolean" ? next.exhausted : sbRetryExhausted;
    sbStatus.lastChangeTs = Date.now();
    try {
      if (!shouldUseStreamerbot(ADM.getSettings?.())) return;
      const u = sbStatus.url;
      if (sbStatus.state === "connected" && prevState !== "connected") {
        ADM.workerModuleStatusLog?.streamerbot?.(true, u);
      } else if (
        sbStatus.state === "disconnected" &&
        (prevState === "connected" || prevState === "connecting")
      ) {
        ADM.workerModuleStatusLog?.streamerbot?.(false, u);
      }
    } catch {
      // ignore
    }
  }

  function getSBStatus() {
    return { ...sbStatus };
  }

  function makeId() {
    return "adm-" + Date.now() + "-" + Math.floor(Math.random() * 999999);
  }

  function makeSubscriptionKey(source, type) {
    return `${String(source || "").trim()}:${String(type || "").trim()}`;
  }

  function clearReconnectTimer() {
    if (!reconnectTimer) return;
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  function base64EncodeBytes(bytes) {
    let binary = "";
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode(...chunk);
    }
    return btoa(binary);
  }

  async function sha256Base64(text) {
    const data = new TextEncoder().encode(String(text || ""));
    const digest = await crypto.subtle.digest("SHA-256", data);
    return base64EncodeBytes(new Uint8Array(digest));
  }

  async function buildStreamerbotAuthentication(password, salt, challenge) {
    const secret = await sha256Base64(`${password}${salt}`);
    return sha256Base64(`${secret}${challenge}`);
  }

  function normalizeInstalledModules(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.map((item) => String(item || "").trim().toLowerCase()).filter(Boolean);
  }

  function shouldUseStreamerbot(settings = ADM.getSettings()) {
    if (settings?.sbEnabled === false) return false;
    const installed = new Set(normalizeInstalledModules(settings?.installedModules));
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

  async function canReachSBEndpoint(url, timeoutMs = SB_REACHABILITY_TIMEOUT_MS) {
    const probeUrl = toHttpProbeUrl(url);
    if (!probeUrl) return false;
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timeout = setTimeout(() => {
      try { controller?.abort(); } catch {}
    }, Math.max(300, Number(timeoutMs) || SB_REACHABILITY_TIMEOUT_MS));
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

  function resetRetryState() {
    sbRetryAttempts = 0;
    sbRetryExhausted = false;
  }

  function flushActionQueue() {
    while (actionQueue.length > 0) {
      const item = actionQueue.shift();
      sendDoActionNow(item.actionName, item.args);
    }
  }

  function markSBConnected(url) {
    resetRetryState();
    sbHandshakeDone = true;
    sbAuthRequestId = "";
    setSBStatus({ state: "connected", url, lastError: "" });
    try {
      ADM.logger?.info?.("sb", "streamerbot connected", { url, queued: actionQueue.length });
    } catch {}
    sbConnecting = false;
    sbOutageActive = false;
    clearReconnectTimer();
    sendSubscriptionRequest();
    flushActionQueue();
  }

  function disconnectSBConnection(reason = "manual") {
    clearReconnectTimer();
    sbConnecting = false;
    sbHandshakeDone = false;
    sbAuthRequestId = "";
    actionQueue.length = 0;
    if (sbSocket) {
      try {
        sbSocket.onopen = null;
        sbSocket.onmessage = null;
        sbSocket.onclose = null;
        sbSocket.onerror = null;
        sbSocket.close();
      } catch {}
      sbSocket = null;
    }
    sbOutageActive = false;
    if (reason === "manual" || reason === "disabled") resetRetryState();
    setSBStatus({ state: "disconnected", lastError: reason });
  }

  function notifySBMessageListeners(message) {
    for (const listener of Array.from(sbMessageListeners)) {
      try { listener(message); } catch {}
    }
  }

  /**
   * Streamer.bot WebSocket: einmalige Action-Liste (GetActions).
   * @returns {Promise<{ ok: boolean, actions?: Array<{ name?: string }>, error?: string }>}
   */
  function requestGetActions(timeoutMs = 4000) {
    return new Promise((resolve) => {
      if (!shouldUseStreamerbot()) {
        resolve({ ok: false, error: "disabled" });
        return;
      }
      if (!sbSocket || sbSocket.readyState !== WebSocket.OPEN || !sbHandshakeDone) {
        ensureSBConnection();
        resolve({ ok: false, error: "not_connected" });
        return;
      }
      const id = makeId();
      let done = false;
      const ms = Math.max(800, Number(timeoutMs) || 4000);
      const timer = setTimeout(() => finish({ ok: false, error: "timeout" }), ms);
      const unsub = subscribeSBMessages((data) => {
        if (String(data?.id || "") !== id) return;
        const st = String(data?.status || "").toLowerCase();
        if (st === "ok") {
          const actions = Array.isArray(data?.actions) ? data.actions : [];
          finish({ ok: true, actions });
        } else {
          finish({ ok: false, error: String(data?.error || data?.message || "get_actions_failed") });
        }
      });
      function finish(result) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try { unsub(); } catch {}
        resolve(result);
      }
      try {
        sbSocket.send(JSON.stringify({ request: "GetActions", id }));
      } catch (e) {
        finish({ ok: false, error: String(e?.message || e) });
      }
    });
  }

  function buildSubscriptionEventsObject() {
    const events = {};
    for (const key of sbCustomEventSubscriptions) {
      const splitIndex = key.indexOf(":");
      if (splitIndex < 0) continue;
      const source = key.slice(0, splitIndex);
      const type = key.slice(splitIndex + 1);
      if (!source || !type) continue;
      if (!Array.isArray(events[source])) events[source] = [];
      if (!events[source].includes(type)) events[source].push(type);
    }
    return events;
  }

  function sendSubscriptionRequest() {
    if (!sbSocket || sbSocket.readyState !== WebSocket.OPEN || !sbHandshakeDone) return false;
    const events = buildSubscriptionEventsObject();
    if (!Object.keys(events).length) return true;
    try {
      sbSocket.send(JSON.stringify({
        request: "Subscribe",
        id: makeId(),
        events
      }));
      return true;
    } catch {
      return false;
    }
  }

  function scheduleReconnect(reason = "unknown") {
    if (!shouldUseStreamerbot()) return;
    if (reconnectTimer) return;
    if (sbRetryAttempts >= MAX_AUTO_RETRIES) {
      sbRetryExhausted = true;
      setSBStatus({ state: "disconnected", lastError: reason, exhausted: true });
      return;
    }
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      ensureSBConnection();
    }, RECONNECT_DELAY_MS);
    try { ADM.logger?.warn?.("sb", "reconnect scheduled", { reason, delayMs: RECONNECT_DELAY_MS }); } catch {}
  }

  async function ensureSBConnection() {
    const settings = ADM.getSettings();
    const url = String(settings?.sbUrl || "").trim();
    const password = String(settings?.sbPassword || "");

    if (!shouldUseStreamerbot(settings)) {
      disconnectSBConnection("disabled");
      return;
    }

    if (sbSocket && (sbSocket.readyState === WebSocket.OPEN || sbSocket.readyState === WebSocket.CONNECTING)) return;
    if (sbConnecting) return;

    sbConnecting = true;
    sbHandshakeDone = false;
    sbAuthRequestId = "";
    clearReconnectTimer();
    sbRetryAttempts += 1;
    sbRetryExhausted = false;
    setSBStatus({ state: "connecting", url, lastError: "" });
    try { ADM.logger?.info?.("sb", "connecting to streamerbot", { url }); } catch {}
    const endpointReachable = await canReachSBEndpoint(url);
    if (!endpointReachable) {
      setSBStatus({ state: "disconnected", url, lastError: "connect_failed" });
      sbConnecting = false;
      sbSocket = null;
      scheduleReconnect("connect_failed");
      return;
    }

    try {
      sbSocket = new WebSocket(url);
    } catch (e) {
      setSBStatus({ state: "disconnected", url, lastError: String(e?.message || e) });
      try { ADM.logger?.error?.("errors", "failed to create streamerbot ws", { error: String(e?.message || e), url }); } catch {}
      sbConnecting = false;
      sbSocket = null;
      scheduleReconnect("create_failed");
      return;
    }

    sbSocket.onopen = () => {
      setSBStatus({ state: "connecting", url, lastError: "" });
      try { ADM.logger?.info?.("sb", "streamerbot ws open", { queued: actionQueue.length }); } catch {}
    };

    sbSocket.onmessage = async (event) => {
      let data = null;
      try {
        data = JSON.parse(String(event?.data || ""));
      } catch {
        return;
      }

      if (String(data?.request || "") === "Hello") {
        const auth = data?.authentication;
        if (!auth?.salt || !auth?.challenge) {
          markSBConnected(url);
          return;
        }
        if (!password) {
          setSBStatus({ state: "disconnected", url, lastError: "auth_required" });
          try { sbSocket?.close(); } catch {}
          return;
        }
        try {
          sbAuthRequestId = makeId();
          const authentication = await buildStreamerbotAuthentication(password, auth.salt, auth.challenge);
          sbSocket?.send(JSON.stringify({
            request: "Authenticate",
            id: sbAuthRequestId,
            authentication
          }));
        } catch (error) {
          setSBStatus({ state: "disconnected", url, lastError: String(error?.message || error) });
          try { sbSocket?.close(); } catch {}
        }
        return;
      }

      if (sbAuthRequestId && String(data?.id || "") === sbAuthRequestId) {
        if (String(data?.status || "").toLowerCase() === "ok") {
          markSBConnected(url);
          return;
        }
        setSBStatus({ state: "disconnected", url, lastError: String(data?.error || "auth_failed") });
        try { sbSocket?.close(); } catch {}
        return;
      }

      notifySBMessageListeners(data);
    };

    sbSocket.onerror = (e) => {
      setSBStatus({ state: "disconnected", url, lastError: String(e?.message || e) });
      try { ADM.logger?.error?.("errors", "streamerbot ws error", { error: String(e?.message || e) }); } catch {}
    };

    sbSocket.onclose = () => {
      setSBStatus({ state: "disconnected", url, lastError: "" });
      try { ADM.logger?.warn?.("sb", "streamerbot ws closed", {}); } catch {}
      sbConnecting = false;
      sbHandshakeDone = false;
      sbSocket = null;
      scheduleReconnect("ws_close");
    };
  }

  function logAction(key, actionName, args) {
    const settings = ADM.getSettings();
    const normalizedKey = String(key || "").trim().toLowerCase();
    const actionLabel = formatActionNameLabel(actionName, settings.actionPrefix);
    try {
      ADM.logger?.info?.("actions", "sb doAction", { key: normalizedKey, action: actionLabel });
    } catch {}
  }

  function formatActionNameLabel(actionName, prefix) {
    const full = String(actionName || "").trim();
    const normalizedPrefix = String(prefix || "").trim();
    if (!normalizedPrefix) return full;
    const withSpace = `${normalizedPrefix} `;
    if (full.startsWith(withSpace)) return full.slice(withSpace.length).trim();
    if (full.startsWith(normalizedPrefix)) return full.slice(normalizedPrefix.length).trim();
    return full;
  }

  /** Wie OBS-Zoom-Zeile: blaue [ADM]-Bubble, grauer Text, Action-Name pink. */
  const MIRROR_STYLE_ADM_BLUE =
    "background:#2563eb;color:#f8fafc;padding:2px 7px;border-radius:8px;font-weight:700;font-size:11px";
  const MIRROR_STYLE_SB_ACTION_MID = "color:#94a3b8;font-weight:500;font-size:12px";
  const MIRROR_STYLE_SB_ACTION_NAME = "color:#ec4899;font-weight:700;font-size:12px";

  function pushMirrorSbActionSummary(actionName) {
    const settings = ADM.getSettings?.() || {};
    const label = formatActionNameLabel(actionName, settings.actionPrefix);
    const safe = String(label || "").trim();
    if (!safe) return;
    const tail = [
      { css: MIRROR_STYLE_ADM_BLUE, text: "[ADM]" },
      { css: MIRROR_STYLE_SB_ACTION_MID, text: " SB Action " },
      { css: MIRROR_STYLE_SB_ACTION_NAME, text: safe }
    ];
    try {
      if (typeof ADM.triggerWorkerLog?.pushMirrorSegmentsWithSerial === "function") {
        ADM.triggerWorkerLog.pushMirrorSegmentsWithSerial(tail, "SB");
      } else {
        ADM.workerMirrorLog?.pushEntry?.({ category: "SB", segments: tail });
      }
    } catch {
      // ignore
    }
  }

  function sendDoActionNow(actionName, args = {}) {
    if (!sbSocket || sbSocket.readyState !== WebSocket.OPEN || !sbHandshakeDone) {
      actionQueue.push({ actionName, args });
      try { ADM.logger?.warn?.("actions", "action queued (ws not ready)", { actionName, queued: actionQueue.length }); } catch {}
      ensureSBConnection();
      return;
    }

    const payload = {
      request: "DoAction",
      id: makeId(),
      action: { name: actionName },
      args
    };

    try {
      sbSocket.send(JSON.stringify(payload));
      pushMirrorSbActionSummary(actionName);
      try { ADM.logger?.info?.("actions", "action sent", { actionName }); } catch {}
    } catch (e) {
      console.error("[ADM] send failed, re-queue:", e);
      try { ADM.logger?.error?.("errors", "action send failed", { actionName, error: String(e?.message || e) }); } catch {}
      actionQueue.push({ actionName, args });
    }
  }

  function shouldSkipDuplicateActionName(actionName) {
    const n = String(actionName || "").trim();
    if (!n) return false;
    const t = Date.now();
    if (n === lastSbActionNameDedupe && t - lastSbActionNameDedupeAt < SB_SAME_ACTION_NAME_MS) {
      return true;
    }
    lastSbActionNameDedupe = n;
    lastSbActionNameDedupeAt = t;
    return false;
  }

  function fireActionByKey(key, args = {}) {
    const settings = ADM.getSettings();
    const suffix = settings.actions?.[key];
    try {
      if (args?.__skipExternalModules !== true) {
        ADM.wled?.handleActionTrigger?.(key, args);
      }
    } catch {}
    if (!suffix) return;
    if (!shouldUseStreamerbot(settings)) return;

    const actionName = settings.actionPrefix + suffix;
    if (/(?:\bturn\b|\bzug\b)/i.test(actionName) && shouldSkipDuplicateActionName(actionName)) return;
    const dedupeSig = `${String(key || "").toLowerCase()}|${actionName}`;
    const dedupeNow = Date.now();
    if (
      dedupeSig === lastSbFireDedupeSig &&
      dedupeNow - lastSbFireDedupeAt < SB_FIRE_DEBOUNCE_MS
    ) {
      return;
    }
    lastSbFireDedupeSig = dedupeSig;
    lastSbFireDedupeAt = dedupeNow;

    logAction(key, actionName, args);
    try {
      ADM.logger?.info?.("actions", "action triggered", {
        key,
        actionName,
        effect: args?.effect ?? null
      });
    } catch {}

    ensureSBConnection();

    if (!sbSocket || sbSocket.readyState !== WebSocket.OPEN || !sbHandshakeDone) {
      actionQueue.push({ actionName, args });
      return;
    }

    sendDoActionNow(actionName, args);
  }

  /**
   * Streamer.bot: Action-Suffix ist bereits der finale Name (wie in actions-Map), z. B. "Bot Level 9 Turn".
   * Prefix wird wie bei fireActionByKey vorangestellt.
   */
  function fireActionBySuffix(suffix, args = {}) {
    const settings = ADM.getSettings();
    const clean = String(suffix || "").trim();
    if (!clean) return;
    if (!shouldUseStreamerbot(settings)) return;

    const actionName = settings.actionPrefix + clean;
    if (shouldSkipDuplicateActionName(actionName)) return;
    const dedupeSig = `suffix|${actionName}`;
    const dedupeNow = Date.now();
    if (
      dedupeSig === lastSbFireDedupeSig &&
      dedupeNow - lastSbFireDedupeAt < SB_FIRE_DEBOUNCE_MS
    ) {
      return;
    }
    lastSbFireDedupeSig = dedupeSig;
    lastSbFireDedupeAt = dedupeNow;

    logAction("named_turn", actionName, args);
    try {
      ADM.logger?.info?.("actions", "action triggered", {
        key: "named_turn",
        actionName,
        effect: args?.effect ?? null
      });
    } catch {}

    ensureSBConnection();

    if (!sbSocket || sbSocket.readyState !== WebSocket.OPEN || !sbHandshakeDone) {
      actionQueue.push({ actionName, args });
      return;
    }

    sendDoActionNow(actionName, args);
  }

  function connectOnceForTest(url, password = "", timeoutMs = 1200) {
    return new Promise((resolve) => {
      let done = false;
      try {
        const ws = new WebSocket(url);
        let authRequestId = "";
        const timer = setTimeout(() => {
          if (done) return;
          done = true;
          try { ws.close(); } catch {}
          resolve(false);
        }, timeoutMs);

        function finish(ok) {
          if (done) return;
          done = true;
          clearTimeout(timer);
          try { ws.close(); } catch {}
          resolve(!!ok);
        }

        ws.onopen = () => {};
        ws.onmessage = async (event) => {
          let data = null;
          try {
            data = JSON.parse(String(event?.data || ""));
          } catch {
            return;
          }

          if (String(data?.request || "") === "Hello") {
            const auth = data?.authentication;
            if (!auth?.salt || !auth?.challenge) {
              finish(true);
              return;
            }
            if (!password) {
              finish(false);
              return;
            }
            try {
              authRequestId = makeId();
              const authentication = await buildStreamerbotAuthentication(password, auth.salt, auth.challenge);
              ws.send(JSON.stringify({
                request: "Authenticate",
                id: authRequestId,
                authentication
              }));
            } catch {
              finish(false);
            }
            return;
          }

          if (authRequestId && String(data?.id || "") === authRequestId) {
            finish(String(data?.status || "").toLowerCase() === "ok");
          }
        };
        ws.onerror = () => finish(false);
      } catch {
        resolve(false);
      }
    });
  }

  function subscribeSBMessages(listener) {
    if (typeof listener !== "function") return () => {};
    sbMessageListeners.add(listener);
    return () => {
      sbMessageListeners.delete(listener);
    };
  }

  function subscribeCustomEvent(source, type) {
    const eventSource = String(source || "").trim();
    const eventType = String(type || "").trim();
    if (!eventSource || !eventType) return false;
    sbCustomEventSubscriptions.add(makeSubscriptionKey(eventSource, eventType));
    sendSubscriptionRequest();
    return true;
  }

  ADM.fireActionByKey = fireActionByKey;
  ADM.fireActionBySuffix = fireActionBySuffix;
  ADM.connectOnceForTest = connectOnceForTest;
  ADM.ensureSBConnection = ensureSBConnection;
  ADM.subscribeSBMessages = subscribeSBMessages;
  ADM.subscribeSBCustomEvent = subscribeCustomEvent;
  ADM.disconnectSBConnection = disconnectSBConnection;
  ADM.retrySBConnection = () => {
    resetRetryState();
    clearReconnectTimer();
    if (sbSocket) {
      try {
        sbSocket.onopen = null;
        sbSocket.onmessage = null;
        sbSocket.onclose = null;
        sbSocket.onerror = null;
        sbSocket.close();
      } catch {}
      sbSocket = null;
    }
    sbConnecting = false;
    sbHandshakeDone = false;
    ensureSBConnection();
  };
  ADM.refreshRuntimeConnections = () => {
    if (shouldUseStreamerbot()) ensureSBConnection();
    else disconnectSBConnection("disabled");
    try { ADM.refreshObsConnection?.(); } catch {}
  };
  ADM.getSBStatus = getSBStatus;
  ADM.requestGetActions = requestGetActions;
  ADM.sha256Base64 = sha256Base64;
})(self);
