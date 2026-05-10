(function initWledEngine(scope) {
  const ADM = scope.ADM || (scope.ADM = {});

  /**
   * 2 Spieler: nach Leggewinn (`gameshot*`) / Spielstart wieder Preset 1 (Slot 0),
   * danach abwechselnd pro `player_turn`. Nicht im Bull-Off; Zwei-Spieler-Erkennung: `participantCount === 2`
   * oder fehlender Count mit genau zwei `playerScores` im Player-Turn-Payload.
   */
  const wledPlayerTurnAlternateState = { matchId: "", slotForNextTurn: 0 };

  function ensureWledAlternateMatch(matchId) {
    const m = String(matchId ?? "").trim() || "_";
    if (m !== wledPlayerTurnAlternateState.matchId) {
      wledPlayerTurnAlternateState.matchId = m;
      wledPlayerTurnAlternateState.slotForNextTurn = 0;
    }
  }

  function resetWledPlayerTurnAlternateAfterLeg(matchId) {
    ensureWledAlternateMatch(matchId);
    wledPlayerTurnAlternateState.slotForNextTurn = 0;
  }

  function consumeWledPlayerTurnAlternateSlot(matchId) {
    ensureWledAlternateMatch(matchId);
    const idx = wledPlayerTurnAlternateState.slotForNextTurn === 0 ? 0 : 1;
    wledPlayerTurnAlternateState.slotForNextTurn = idx === 0 ? 1 : 0;
    return idx;
  }

  function isWledAlternateTwoPlayerContext(args) {
    const a = args && typeof args === "object" ? args : {};
    const pc = Number(a.participantCount);
    if (Number.isFinite(pc) && pc === 2) return true;
    const ps = a.playerScores;
    if (!Array.isArray(ps) || ps.length !== 2) return false;
    if (!Number.isFinite(pc) || pc <= 0) return true;
    return false;
  }

  function normalizeEndpoint(raw) {
    let endpoint = String(raw || "").trim();
    if (!endpoint) return "";
    if (!/^https?:\/\//i.test(endpoint)) endpoint = `http://${endpoint}`;
    return endpoint.replace(/\/+$/, "");
  }

  function parsePresetId(value) {
    const n = parseInt(String(value || "").trim(), 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  function normalizeTriggerKey(value) {
    return ADM.admTriggerKeys.normalizeTriggerKey(value);
  }

  function normalizeWledSegmentToken(raw) {
    let s = String(raw || "").trim().toLowerCase().replace(/\s+/g, "");
    if (!s) return "";
    if (s === "d25" || s === "dbull" || s === "doublebull") s = "bull";
    return s;
  }

  function isWorkerSegmentDispatchKey(k) {
    const key = normalizeTriggerKey(k);
    if (key === "outside" || key === "bull" || key === "dbull") return true;
    return /^[sdt](?:[1-9]|1[0-9]|20|25)$/.test(key);
  }

  function parseChainTripleFromItem(item) {
    const raw = item?.chainTriple ?? item?.chain_triple;
    if (Array.isArray(raw)) {
      return raw
        .map((x) => normalizeWledSegmentToken(String(x || "")))
        .filter(Boolean);
    }
    return [];
  }

  function parseWledEffects(raw) {
    try {
      const arr = JSON.parse(String(raw || "[]"));
      if (!Array.isArray(arr)) return [];
      return arr
        .filter((item) => item && typeof item === "object")
        .map((item) => {
          const presetTargets = Array.isArray(item.presetTargets)
            ? item.presetTargets
            : (item.controllerId && item.presetId
              ? [{
                  controllerId: String(item.controllerId || item.controller || "").trim(),
                  presetId: String(item.presetId || "").trim(),
                  presetName: String(item.presetName || "").trim(),
                  controllerName: String(item.controllerName || "").trim()
                }]
              : []);
          let trigger = String(item?.trigger || "").trim();
          const playerFilter = String(item?.playerFilter || "").trim();
          /** Legacy: Namensfilter galt auf „throw“ — jetzt pro Visit („player_turn“). */
          if (normalizeTriggerKey(trigger) === "throw" && playerFilter) {
            trigger = "player_turn";
          }
          const chainTriple = parseChainTripleFromItem(item);
          const out = {
            ...item,
            trigger,
            presetTargets,
            advancedJson: String(item?.advancedJson || "").trim(),
            playerFilter,
            chainTriple: chainTriple.length === 3 ? chainTriple : []
          };
          delete out.playerTurnIndex;
          return out;
        });
    } catch {
      return [];
    }
  }

  function triggerMatchesRule(rule, emittedKey, payload = {}) {
    return ADM.admTriggerKeys.triggerMatchesRule(rule, emittedKey, payload);
  }

  function normalizePlayerFilterCompare(value) {
    let v = String(value || "").trim().toLowerCase();
    try {
      v = v.normalize("NFKD").replace(/\p{M}/gu, "");
    } catch (_) {}
    return v.replace(/\s+/g, " ");
  }

  function collectPayloadPlayerHaystack(args) {
    const parts = [];
    const a = args && typeof args === "object" ? args : {};
    const push = (x) => {
      const t = String(x ?? "").trim();
      if (t) parts.push(t);
    };
    push(a.playerName);
    push(a.__admVisitMeta?.throwerDisplayName);
    push(a.winnerName);
    if (Array.isArray(a.playerNames)) {
      for (const p of a.playerNames) push(typeof p === "string" ? p : p?.name);
    }
    if (Array.isArray(a.players)) {
      for (const p of a.players) {
        if (typeof p === "string") push(p);
        else push(p?.name || p?.displayName || p?.userName);
      }
    }
    const wi = a.winner;
    if (Number.isInteger(wi) && wi >= 0 && Array.isArray(a.playerNames) && wi < a.playerNames.length) {
      const p = a.playerNames[wi];
      push(typeof p === "string" ? p : p?.name);
    }
    return normalizePlayerFilterCompare(parts.join(" "));
  }

  function wledPlayerFilterMatches(filter, args, triggerRule) {
    const f = normalizePlayerFilterCompare(filter);
    if (!f) return true;
    /** Namensfilter nur am Visit-Start (einmal pro Zug), nicht bei jedem Wurf. */
    const tr = normalizeTriggerKey(triggerRule);
    if (tr !== "player_turn" && tr !== "player_turn_alternate") return true;
    const hay = collectPayloadPlayerHaystack(args);
    return !!hay && hay.includes(f);
  }

  function formatWledTriggerHuman(trigger) {
    const t = normalizeTriggerKey(trigger);
    if (!t) return "—";
    if (t === "player_turn") return "Player :";
    if (t === "player_turn_alternate") return "Player Wechsel:";
    if (t === "chain_visit") return "Kette:";
    const combo = t.match(/^(gameshot|matchshot)\+(.+)$/);
    if (combo) {
      const head = combo[1] === "gameshot" ? "Leggew." : "Match";
      return `${head}+${combo[2].toUpperCase()}`;
    }
    const seg = t.match(/^([sdt])(\d+)$/);
    if (seg) return `${seg[1].toUpperCase()}${seg[2]}`;
    if (t === "bull" || t === "double" || t === "triple" || t === "outside") return t.toUpperCase();
    return t;
  }

  function formatWledPresetSummary(targets) {
    const list = Array.isArray(targets) ? targets : [];
    if (!list.length) return "";
    return list
      .map((x) => {
        const pn = String(x?.presetName || "").trim();
        const pid = String(x?.presetId || "").trim();
        const cn = String(x?.controllerName || "").trim();
        const p = pn || (pid ? `Preset ${pid}` : "?");
        return cn ? `${p} (${cn})` : p;
      })
      .join(", ");
  }

  function parseControllers(raw) {
    try {
      const arr = JSON.parse(String(raw || "[]"));
      if (!Array.isArray(arr)) return [];
      return arr
        .filter((item) => item && typeof item === "object")
        .map((item, index) => ({
          id: String(item.id || `ctrl_${index + 1}`).trim(),
          endpoint: String(item.endpoint || "").trim()
        }))
        .filter((item) => !!item.id);
    } catch {
      return [];
    }
  }

  function normalizePresetCollection(raw) {
    if (!raw) return [];

    if (Array.isArray(raw)) {
      return raw
        .map((item, index) => {
          const parsedId = parsePresetId(item?.id ?? item?.ps ?? item?.presetId ?? index + 1);
          if (parsedId === null) return null;
          const name = String(item?.n || item?.name || item?.label || "").trim() || `Preset ${parsedId}`;
          return { id: String(parsedId), name };
        })
        .filter(Boolean)
        .sort((a, b) => Number(a.id) - Number(b.id));
    }

    if (typeof raw === "object") {
      return Object.entries(raw)
        .map(([id, data]) => {
          const parsedId = parsePresetId(id);
          if (parsedId === null) return null;
          const name = String(data?.n || data?.name || data?.label || "").trim() || `Preset ${parsedId}`;
          return { id: String(parsedId), name };
        })
        .filter(Boolean)
        .sort((a, b) => Number(a.id) - Number(b.id));
    }

    return [];
  }

  async function fetchJson(url, init) {
    const res = await fetch(url, {
      cache: "no-store",
      ...init
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async function fetchPresets(endpoint) {
    const normalized = normalizeEndpoint(endpoint);
    if (!normalized) throw new Error("Missing WLED endpoint");

    const candidates = [
      `${normalized}/presets.json`,
      `${normalized}/json`,
      `${normalized}/json/presets`,
      `${normalized}/json/presets.json`
    ];

    let lastError = null;
    for (const url of candidates) {
      try {
        const payload = await fetchJson(url);
        const presets = normalizePresetCollection(
          payload?.presets ??
          payload?.ps ??
          payload?.playlist ??
          payload
        );
        if (presets.length) return presets;
      } catch (e) {
        lastError = e;
      }
    }

    if (lastError) throw lastError;
    return [];
  }

  async function triggerPreset(endpoint, presetId) {
    const normalized = normalizeEndpoint(endpoint);
    const parsedPresetId = parsePresetId(presetId);
    if (!normalized) throw new Error("Missing WLED endpoint");
    if (parsedPresetId === null) throw new Error("Invalid preset id");

    const res = await fetch(`${normalized}/json/state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ps: parsedPresetId })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return true;
  }

  function parseAdvancedJsonPayload(raw) {
    const src = String(raw || "").trim();
    if (!src) return null;
    const parsed = JSON.parse(src);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Advanced Json must be a JSON object");
    }
    return parsed;
  }

  async function triggerJsonState(endpoint, payload) {
    const normalized = normalizeEndpoint(endpoint);
    if (!normalized) throw new Error("Missing WLED endpoint");
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("Invalid Advanced Json payload");
    }
    const res = await fetch(`${normalized}/json/state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return true;
  }

  function getControllerEndpoint(settings, controllerId) {
    const controllers = parseControllers(settings?.wledControllersJson);
    const match = controllers.find((item) => item.id === controllerId);
    return normalizeEndpoint(match?.endpoint);
  }

  async function triggerTargets(targets, settings = null, advancedJson = "") {
    const currentSettings = settings || (ADM.getSettings?.() || {});
    const safeTargets = Array.isArray(targets) ? targets : [];
    const advancedPayload = parseAdvancedJsonPayload(advancedJson);
    const processedControllers = new Set();
    await Promise.allSettled(safeTargets.map(async (target) => {
      const controllerId = String(target?.controllerId || "").trim();
      const presetId = String(target?.presetId || "").trim();
      const endpoint = getControllerEndpoint(currentSettings, controllerId);
      if (!endpoint) return;
      if (presetId) {
        await triggerPreset(endpoint, presetId);
      }
      if (advancedPayload && !processedControllers.has(controllerId)) {
        processedControllers.add(controllerId);
        await triggerJsonState(endpoint, advancedPayload);
      }
    }));
  }

  function chainVisitMultisetEqual(want, got) {
    if (!Array.isArray(want) || !Array.isArray(got) || want.length !== 3 || got.length !== 3) return false;
    const a = want.map((x) => normalizeWledSegmentToken(x)).filter(Boolean).sort();
    const b = got.map((x) => normalizeWledSegmentToken(x)).filter(Boolean).sort();
    if (a.length !== 3 || b.length !== 3) return false;
    return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
  }

  async function fireChainVisitEffectsIfMatched(effects, key, args, settings) {
    const meta = args?.__admVisitMeta;
    if (!meta || meta.skipped || meta.dartIndexInVisit !== 3) return;
    if (!isWorkerSegmentDispatchKey(key)) return;
    const peek = ADM.admThrowVisitTracker?.peekVisitSlotTriggerKeys;
    if (typeof peek !== "function") return;
    const live = peek();
    if (!live || live.length !== 3) return;
    const chainItems = effects.filter((item) => (
      item.enabled !== false &&
      normalizeTriggerKey(item.trigger) === "chain_visit" &&
      Array.isArray(item.chainTriple) &&
      item.chainTriple.length === 3
    ));
    await Promise.allSettled(chainItems.map(async (item) => {
      if (!chainVisitMultisetEqual(item.chainTriple, live)) return;
      try {
        const targets = Array.isArray(item.presetTargets) ? item.presetTargets : [];
        await triggerTargets(targets, settings, item.advancedJson || "");
        const tripleHuman = item.chainTriple.map((x) => String(x || "").toUpperCase()).join(" ");
        ADM.triggerWorkerLog?.printAdmWledEffectLine?.({
          effectName: String(item.name || "").trim() || "WLED",
          triggerUnit: `Kette: ${tripleHuman}`.trim(),
          presetSummary: formatWledPresetSummary(targets)
        });
        ADM.logger?.info?.("wled", "chain_visit preset triggered", {
          trigger: key,
          chainTriple: item.chainTriple,
          live,
          name: item.name
        });
      } catch (e) {
        ADM.logger?.error?.("errors", "wled chain_visit trigger failed", {
          error: String(e?.message || e)
        });
      }
    }));
  }

  /** PixelIt: POST /api/screen. WLED: JSON `seg[].i` (Einzel-LEDs, Segment muss die Matrix abdecken). */
  const wledMatrixHostChains = new Map();
  const wledMatrixJsonChains = new Map();

  function wledMatrixHostKey(url) {
    const n = normalizeEndpoint(url);
    return n || "";
  }

  function enqueueWledMatrixTask(hostNorm, task) {
    if (!hostNorm) return Promise.resolve();
    const prev = wledMatrixHostChains.get(hostNorm) || Promise.resolve();
    const next = prev.then(() => task()).catch(() => {});
    wledMatrixHostChains.set(hostNorm, next);
    return next;
  }

  const wledMatrixLastSendByHost = new Map();
  const wledMatrixLastJsonByHost = new Map();

  const WLED_MATRIX_LED_MAX_LAYOUT = 2048;
  const WLED_MATRIX_DIM_MAX_LAYOUT = 128;

  function wledMatrixClampWh(w0, h0) {
    let w = Math.max(1, Math.min(WLED_MATRIX_DIM_MAX_LAYOUT, Math.trunc(Number(w0)) || 16));
    let h = Math.max(1, Math.min(WLED_MATRIX_DIM_MAX_LAYOUT, Math.trunc(Number(h0)) || 16));
    while (w * h > WLED_MATRIX_LED_MAX_LAYOUT && h > 1) h -= 1;
    while (w * h > WLED_MATRIX_LED_MAX_LAYOUT && w > 1) w -= 1;
    return { w, h };
  }

  function wledMatrixNormalizeDisplayEntry(raw, ctrls) {
    const cid = String(raw?.controllerId || "").trim() || String(ctrls[0]?.id || "").trim();
    const wh = wledMatrixClampWh(raw?.w, raw?.h);
    const serpentine = raw?.serpentine === true;
    const orient = String(raw?.orientation || "horizontal").toLowerCase() === "vertical" ? "vertical" : "horizontal";
    const scanMode = orient === "vertical" ? "cols" : "rows";
    const segmentId = Math.max(0, Math.min(31, Math.trunc(Number(raw?.segmentId) || 0)));
    const id =
      String(raw?.id || "").trim() ||
      `m_${Date.now()}_${Math.floor(Math.random() * 99999)}`;
    return {
      id,
      controllerId: cid,
      segmentId,
      w: wh.w,
      h: wh.h,
      serpentine,
      orientation: orient,
      scanMode
    };
  }

  function wledMatrixLegacyDisplays(settings) {
    const ctrls = parseControllers(settings?.wledControllersJson);
    const wh = wledMatrixClampWh(settings.wledMatrixWledWidth, settings.wledMatrixWledHeight);
    const cid = String(settings.wledMatrixWledControllerId0 || "").trim() || String(ctrls[0]?.id || "").trim();
    const segId = Math.max(0, Math.min(31, Math.trunc(Number(settings.wledMatrixWledSegmentId) || 0)));
    const orient =
      String(settings.wledMatrixWledScanMode || "rows").toLowerCase() === "cols" ? "vertical" : "horizontal";
    return [
      wledMatrixNormalizeDisplayEntry(
        {
          id: "legacy",
          controllerId: cid,
          segmentId: segId,
          w: wh.w,
          h: wh.h,
          serpentine: settings.wledMatrixWledSerpentine === true,
          orientation: orient
        },
        ctrls
      )
    ];
  }

  function wledMatrixParseDisplays(settings) {
    const ctrls = parseControllers(settings?.wledControllersJson);
    let arr = null;
    try {
      const raw = String(settings?.wledMatrixWledDisplaysJson || "").trim();
      if (raw) {
        const j = JSON.parse(raw);
        if (Array.isArray(j) && j.length) {
          arr = j.map((x) => wledMatrixNormalizeDisplayEntry(x, ctrls));
        }
      }
    } catch {
      arr = null;
    }
    if (!arr || !arr.length) return wledMatrixLegacyDisplays(settings);
    return arr;
  }

  function wledMatrixGetDisplayLayout(settings, playerIndex0) {
    const displays = wledMatrixParseDisplays(settings);
    const pi = Number(playerIndex0) === 1 ? 1 : 0;
    const d = displays[pi] || displays[0];
    return {
      segId: d.segmentId,
      w: d.w,
      h: d.h,
      serpentine: d.serpentine,
      scanMode: d.scanMode,
      controllerId: String(d.controllerId || "").trim()
    };
  }

  function wledMatrixGetControllerIdForPlayer(settings, playerIndex0) {
    return wledMatrixGetDisplayLayout(settings, playerIndex0).controllerId;
  }

  async function postWledMatrixScreen(settings, baseUrl, body) {
    const base = normalizeEndpoint(baseUrl);
    if (!base || !body || typeof body !== "object") return;
    const minGap = Math.max(0, Math.min(60000, Number(settings.wledMatrixMinIntervalMs) || 400));
    const hostK = wledMatrixHostKey(base);
    return enqueueWledMatrixTask(hostK, async () => {
      const now = Date.now();
      const last = wledMatrixLastSendByHost.get(hostK) || 0;
      const wait = last + minGap - now;
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      const res = await fetch(`${base}/api/screen`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      wledMatrixLastSendByHost.set(hostK, Date.now());
    });
  }

  function wledMatrixNormalizeHex6(raw) {
    let s = String(raw || "").trim().replace(/^#/, "");
    if (s.length === 3) {
      s = s.split("").map((c) => c + c).join("");
    }
    if (!/^[0-9a-fA-F]{6}$/.test(s)) return "FFFFFF";
    return s.toUpperCase();
  }

  /** `rows` = Zeilen-Serpentine (klassisch). `cols` = WLED 2D „Orientation: Vertical“ + Serpentine (Spalten). */
  function wledMatrixNormalizeScanMode(raw) {
    return String(raw || "rows").toLowerCase() === "cols" ? "cols" : "rows";
  }

  function wledMatrixXYToLinearIndex(x, y, w, h, serpentine, scanMode) {
    const sm = wledMatrixNormalizeScanMode(scanMode);
    if (x < 0 || y < 0 || x >= w || y >= h) return -1;
    if (sm === "cols") {
      if (serpentine && (x & 1)) return x * h + (h - 1 - y);
      return x * h + y;
    }
    if (serpentine && (y & 1)) return y * w + (w - 1 - x);
    return y * w + x;
  }

  function wledMatrixLinearIndexToXY(n, w, h, serpentine, scanMode) {
    const sm = wledMatrixNormalizeScanMode(scanMode);
    const nn = Math.trunc(Number(n));
    if (!Number.isFinite(nn) || nn < 0 || nn >= w * h) return null;
    if (sm === "cols") {
      const x = Math.trunc(nn / h);
      const rest = nn - x * h;
      const y = serpentine && (x & 1) ? h - 1 - rest : rest;
      return { x, y };
    }
    const y = Math.trunc(nn / w);
    const rest = nn - y * w;
    const x = serpentine && (y & 1) ? w - 1 - rest : rest;
    return { x, y };
  }

  /** x01: immer gleiche Zifferngroesse wie bei drei Stellen — sonst werden 1–2 Stellen viel zu gross. */
  const WLED_MATRIX_SCORE_SLOT_COUNT = 3;

  /**
   * Block-Ziffern 5×7 (MSB = links), „1“ nur 3 Spalten breit — wie uebliche LED-Matrix-Lesung (z. B. „501“).
   * Jede Zeile `rows[r]` nutzt nur die untersten `w` Bits.
   */
  const WLED_MATRIX_DIGIT57 = {
    "0": { w: 5, rows: [14, 17, 17, 17, 17, 17, 14] },
    "1": { w: 3, rows: [2, 2, 2, 2, 2, 2, 2] },
    "2": { w: 5, rows: [31, 1, 31, 16, 31, 0, 0] },
    "3": { w: 5, rows: [31, 1, 7, 1, 31, 1, 31] },
    "4": { w: 5, rows: [17, 17, 31, 1, 1, 0, 0] },
    "5": { w: 5, rows: [31, 16, 30, 1, 31, 0, 0] },
    "6": { w: 5, rows: [14, 16, 31, 17, 31, 0, 0] },
    "7": { w: 5, rows: [31, 1, 2, 4, 8, 16, 0] },
    "8": { w: 5, rows: [31, 17, 17, 31, 17, 17, 31] },
    "9": { w: 5, rows: [31, 17, 31, 1, 31, 0, 0] }
  };

  /**
   * Unter ~18px Kantenlaenge liefert Canvas-Text praktisch nur verwischte Blobs (z. B. 16×16).
   * WLED „Scrolling Text“ laeuft intern als Effekt auf dem Geraet — hier: klare 3×5-Bitmap-Ziffern.
   */
  function wledMatrixPreferBitmapOverVector(w, h) {
    const a = Math.trunc(Number(w)) || 0;
    const b = Math.trunc(Number(h)) || 0;
    if (a < 1 || b < 1) return true;
    if (Math.min(a, b) <= 18) return true;
    if (a * b <= 360) return true;
    return false;
  }

  /**
   * Wie PixelIt `/api/screen` mit `bigFont` + `centerText`: Text auf w×h rendern → LED-Map.
   * OffscreenCanvas im Service Worker; sonst Fallback-Bitmap-Ziffern.
   * @param {object} [opts] `scoreDigitSlots`: true = Schriftgroesse an drei Stellen ausrichten (Punkte).
   */
  function wledMatrixRasterizeLikePixelIt(displayText, layout, fgHex, opts) {
    const { w, h, serpentine, scanMode } = layout;
    const o = opts && typeof opts === "object" ? opts : {};
    const scoreSlots = o.scoreDigitSlots === true;
    const hex = wledMatrixNormalizeHex6(fgHex);
    const color = `#${hex}`;
    const str = String(displayText ?? "").trim();
    if (!str || w < 1 || h < 1) return null;
    if (typeof OffscreenCanvas === "undefined") return null;
    try {
      const canvas = new OffscreenCanvas(w, h);
      const ctx = canvas.getContext("2d", { alpha: true, willReadFrequently: true });
      if (!ctx) return null;
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = color;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.imageSmoothingEnabled = false;
      const pad = 1;
      const len = str.length || 1;
      const layoutSlots = scoreSlots ? WLED_MATRIX_SCORE_SLOT_COUNT : len;
      const widthProbe = scoreSlots ? "888" : str;
      let maxFs = Math.min(h - pad * 2, Math.floor((w - pad * 2) / (layoutSlots * 0.55)));
      if (layoutSlots >= 3) maxFs = Math.min(maxFs, Math.floor((w - pad * 2) / (layoutSlots * 0.64)));
      maxFs = Math.min(maxFs, h - pad * 2);
      let chosen = Math.max(5, Math.min(maxFs, 96));
      for (let fs = maxFs; fs >= 5; fs -= 1) {
        ctx.font = `bold ${fs}px "Segoe UI",Roboto,Ubuntu,"Helvetica Neue",sans-serif`;
        const mA = ctx.measureText(str);
        const mP = ctx.measureText(widthProbe);
        const tw = scoreSlots ? Math.max(mA.width, mP.width) : mA.width;
        const th = fs;
        if (tw <= w - pad * 2 && th <= h - pad * 2) {
          chosen = fs;
          break;
        }
      }
      ctx.font = `bold ${chosen}px "Segoe UI",Roboto,Ubuntu,"Helvetica Neue",sans-serif`;
      if (scoreSlots && chosen >= 6) {
        const lw = Math.max(1, Math.min(3, Math.round(chosen / 10)));
        ctx.lineWidth = lw;
        ctx.lineJoin = "round";
        ctx.strokeStyle = "#000000";
        ctx.strokeText(str, w / 2, h / 2);
      }
      ctx.fillStyle = color;
      ctx.fillText(str, w / 2, h / 2);
      const img = ctx.getImageData(0, 0, w, h);
      const cells = new Map();
      for (let y = 0; y < h; y += 1) {
        for (let x = 0; x < w; x += 1) {
          const p = (y * w + x) * 4;
          const a = img.data[p + 3];
          const lum =
            img.data[p] * 0.299 + img.data[p + 1] * 0.587 + img.data[p + 2] * 0.114;
          /* Hintergrund: schwarz, Alpha 255 — mit AND wuerden alle Pixel „aktiv“ (ganze Matrix weiß). */
          if (a < 12) continue;
          if (lum < 52) continue;
          const idx = wledMatrixXYToLinearIndex(x, y, w, h, serpentine, scanMode);
          if (idx >= 0 && idx < w * h) cells.set(idx, hex);
        }
      }
      return cells.size > 0 ? cells : null;
    } catch {
      return null;
    }
  }

  function wledMatrixResolveCellsForScoreText(scoreText, layout, fgHex) {
    const { w, h } = layout;
    const raw = String(scoreText ?? "").replace(/[^0-9]/g, "").slice(0, 3) || "0";
    const cells57 = wledMatrixCollectCellsForDigits57(raw, layout, fgHex);
    if (cells57 && cells57.size > 0) return cells57;
    if (!wledMatrixPreferBitmapOverVector(w, h)) {
      const raster = wledMatrixRasterizeLikePixelIt(raw, layout, fgHex, { scoreDigitSlots: true });
      if (raster && raster.size > 0) return raster;
    }
    return wledMatrixCollectCellsForDigits(raw, layout, fgHex);
  }

  function wledMatrixResolveCellsForArrow(layout, fgHex) {
    const { w, h } = layout;
    if (!wledMatrixPreferBitmapOverVector(w, h)) {
      const raster = wledMatrixRasterizeLikePixelIt("\u2192", layout, fgHex);
      if (raster && raster.size > 0) return raster;
    }
    return wledMatrixCollectCellsForArrow(layout, fgHex);
  }

  const WLED_MATRIX_DIGIT35 = {
    0: [7, 5, 5, 5, 7],
    /* Schmale „1“ nur mittlere Spalte — die alte [2,6,2,2,7]-Form frisst Nachbarziffern (z. B. 147). */
    1: [1, 1, 1, 1, 1],
    2: [7, 1, 7, 4, 7],
    3: [7, 1, 7, 1, 7],
    4: [5, 5, 7, 1, 1],
    5: [7, 4, 7, 1, 7],
    6: [7, 4, 7, 5, 7],
    7: [7, 1, 1, 1, 1],
    8: [7, 5, 7, 5, 7],
    9: [7, 5, 7, 1, 7]
  };

  /** Nach rechts zeigende Fuellflaeche (Zug-Pfeil), hoeher/breiter als das alte 5×5-Kreuz. */
  function wledMatrixDartArrowRelativeCells() {
    const gh = 7;
    const gw = 10;
    const pts = [];
    const mid = (gh - 1) / 2;
    for (let y = 0; y < gh; y += 1) {
      const edge = Math.abs(y - mid);
      for (let x = Math.ceil(edge); x < gw; x += 1) pts.push([x, y]);
    }
    return { pts, gw, gh };
  }

  function wledMatrixComputeDigitLayout(strLen, w, h) {
    const dw = 3;
    const dh = 5;
    const maxScale = Math.min(8, Math.floor(h / dh), Math.floor(w / dw));
    for (let scale = maxScale; scale >= 1; scale -= 1) {
      const th = dh * scale;
      if (th > h) continue;
      const gapPrimary = Math.max(1, Math.floor(scale / 2));
      const gapsToTry = scale <= 1 ? [0, 1] : [gapPrimary];
      for (const gap of gapsToTry) {
        const tw = strLen * dw * scale + (strLen - 1) * gap;
        if (tw <= w && th <= h) return { scale, gap, cellW: dw * scale, cellH: dh * scale };
      }
    }
    return { scale: 1, gap: 1, cellW: 3, cellH: 5 };
  }

  function wledMatrixCollectCellsForDigits57(text, layout, fgHex) {
    const { w, h, serpentine, scanMode } = layout;
    const fg = wledMatrixNormalizeHex6(fgHex);
    const str = String(text || "").replace(/[^0-9]/g, "").slice(0, 3);
    if (!str) return null;
    const gapOrder = [1, 0];
    for (let gi = 0; gi < gapOrder.length; gi += 1) {
      const gap = gapOrder[gi];
      let unitW = 0;
      for (let i = 0; i < str.length; i += 1) {
        const g = WLED_MATRIX_DIGIT57[str[i]];
        if (!g) return null;
        unitW += g.w + (i > 0 ? gap : 0);
      }
      const maxScale = Math.min(12, Math.floor(h / 7), Math.floor(w / Math.max(1, unitW)));
      for (let scale = maxScale; scale >= 1; scale -= 1) {
        const drawW = unitW * scale;
        const drawH = 7 * scale;
        if (drawW > w || drawH > h) continue;
        const cells = new Map();
        const ox = Math.max(0, Math.floor((w - drawW) / 2));
        const oy = Math.max(0, Math.floor((h - drawH) / 2));
        let left = ox;
        for (let k = 0; k < str.length; k += 1) {
          const g = WLED_MATRIX_DIGIT57[str[k]];
          if (!g) return null;
          const gw = g.w;
          for (let r = 0; r < 7; r += 1) {
            const rowBits = g.rows[r] || 0;
            for (let c = 0; c < gw; c += 1) {
              if (((rowBits >> (gw - 1 - c)) & 1) === 0) continue;
              for (let sy = 0; sy < scale; sy += 1) {
                for (let sx = 0; sx < scale; sx += 1) {
                  const px = left + c * scale + sx;
                  const py = oy + r * scale + sy;
                  if (px < 0 || py < 0 || px >= w || py >= h) continue;
                  const idx = wledMatrixXYToLinearIndex(px, py, w, h, serpentine, scanMode);
                  if (idx >= 0 && idx < w * h) cells.set(idx, fg);
                }
              }
            }
          }
          left += (gw + gap) * scale;
        }
        if (cells.size > 0) return cells;
      }
    }
    return null;
  }

  function wledMatrixCollectCellsForDigits(text, layout, fgHex) {
    const { w, h, serpentine, scanMode } = layout;
    const fg = wledMatrixNormalizeHex6(fgHex);
    const cells = new Map();
    const s = String(text || "").replace(/[^0-9]/g, "").slice(0, 3);
    const str = s || "0";
    const digitW = 3;
    const digitH = 5;
    const { scale, gap, cellW, cellH } = wledMatrixComputeDigitLayout(WLED_MATRIX_SCORE_SLOT_COUNT, w, h);
    const drawW = str.length * cellW + (str.length - 1) * gap;
    const drawH = cellH;
    const ox = Math.max(0, Math.floor((w - drawW) / 2));
    const oy = Math.max(0, Math.floor((h - drawH) / 2));
    let left = ox;
    for (let k = 0; k < str.length; k += 1) {
      const ch = str[k];
      const rows = WLED_MATRIX_DIGIT35[ch];
      if (!rows) {
        left += cellW + gap;
        continue;
      }
      for (let r = 0; r < digitH; r += 1) {
        for (let c = 0; c < digitW; c += 1) {
          if (((rows[r] >> (digitW - 1 - c)) & 1) === 0) continue;
          for (let sy = 0; sy < scale; sy += 1) {
            for (let sx = 0; sx < scale; sx += 1) {
              const px = left + c * scale + sx;
              const py = oy + r * scale + sy;
              if (px < 0 || py < 0 || px >= w || py >= h) continue;
              const idx = wledMatrixXYToLinearIndex(px, py, w, h, serpentine, scanMode);
              if (idx >= 0 && idx < w * h) cells.set(idx, fg);
            }
          }
        }
      }
      left += cellW + gap;
    }
    return cells;
  }

  function wledMatrixCollectCellsForArrow(layout, fgHex) {
    const { w, h, serpentine, scanMode } = layout;
    const fg = wledMatrixNormalizeHex6(fgHex);
    const cells = new Map();
    const { pts, gw, gh } = wledMatrixDartArrowRelativeCells();
    const maxScale = Math.min(8, Math.floor(w / gw), Math.floor(h / gh));
    const scale = Math.max(1, maxScale);
    const drawW = gw * scale;
    const drawH = gh * scale;
    const ox = Math.max(0, Math.floor((w - drawW) / 2));
    const oy = Math.max(0, Math.floor((h - drawH) / 2));
    for (const [dx, dy] of pts) {
      for (let sy = 0; sy < scale; sy += 1) {
        for (let sx = 0; sx < scale; sx += 1) {
          const px = ox + dx * scale + sx;
          const py = oy + dy * scale + sy;
          if (px < 0 || py < 0 || px >= w || py >= h) continue;
          const idx = wledMatrixXYToLinearIndex(px, py, w, h, serpentine, scanMode);
          if (idx >= 0 && idx < w * h) cells.set(idx, fg);
        }
      }
    }
    return cells;
  }

  /**
   * WLED seg[].i: [clearStart, clearLen, fillHex, absIdx, hex, ...]
   * clearStart/clearLen = Bereich der zuerst mit fillHex ueberschrieben wird; Paare nutzen absolute LED-Indizes im Segment.
   */
  function wledMatrixBuildSegI(clearStart, clearLen, cells) {
    const cs = Math.max(0, Math.trunc(Number(clearStart)) || 0);
    const cl = Math.max(1, Math.min(8192, Math.trunc(Number(clearLen)) || 1));
    const i = [cs, cl, "000000"];
    cells.forEach((hex, idx) => {
      const n = Math.trunc(Number(idx));
      if (!Number.isFinite(n) || n < 0 || n >= cl) return;
      i.push(cs + n, wledMatrixNormalizeHex6(hex));
    });
    return i;
  }

  async function wledMatrixSendSegJsonThrottled(settings, endpoint, payload) {
    const minGap = Math.max(0, Math.min(60000, Number(settings.wledMatrixMinIntervalMs) || 400));
    const hostK = `${wledMatrixHostKey(endpoint)}|json`;
    const now = Date.now();
    const last = wledMatrixLastJsonByHost.get(hostK) || 0;
    const wait = last + minGap - now;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    await triggerJsonState(endpoint, payload);
    wledMatrixLastJsonByHost.set(hostK, Date.now());
  }

  function wledMatrixQueueJson(settings, controllerId, asyncFn) {
    const endpoint = getControllerEndpoint(settings, String(controllerId || "").trim());
    if (!endpoint) return Promise.resolve();
    const hostK = `${wledMatrixHostKey(endpoint)}|json`;
    const prev = wledMatrixJsonChains.get(hostK) || Promise.resolve();
    const next = prev.then(() => asyncFn(endpoint)).catch(() => {});
    wledMatrixJsonChains.set(hostK, next);
    return next;
  }

  /**
   * Ein WLED-Segment pro Matrix-Eintrag (Spieler 1 / 2 aus `wledMatrixWledDisplaysJson`).
   */
  function wledMatrixBuildSegUpdatePayload(settings, cells, transition, playerIndex0) {
    const pi = Number(playerIndex0) === 1 ? 1 : 0;
    const layout = wledMatrixGetDisplayLayout(settings, pi);
    const { segId, w, h } = layout;
    const clearLen = w * h;
    const iArr = wledMatrixBuildSegI(0, clearLen, cells);
    return { on: true, transition, seg: [{ id: segId, i: iArr }] };
  }

  /** 0 = Matrix 1, 1 = Matrix 2 — gelbe [ADM]-Zeile im Worker-Mirror (Kategorie WLED). */
  function mirrorLogWledMatrixScore(playerIndex0, scoreText) {
    try {
      const pi = Math.trunc(Number(playerIndex0));
      if (!Number.isFinite(pi) || pi < 0 || pi > 1) return;
      const s = String(scoreText ?? "").trim() || "—";
      ADM.triggerWorkerLog?.printAdmWledMatrixLine?.({ matrixNo: pi + 1, score: s });
    } catch {
      // ignore
    }
  }

  function wledMatrixPostDigits(settings, controllerId, scoreText, withFade, playerIndex0) {
    const pi = Number(playerIndex0) === 1 ? 1 : 0;
    void wledMatrixQueueJson(settings, controllerId, async (endpoint) => {
      const layout = wledMatrixGetDisplayLayout(settings, pi);
      const { w, h } = layout;
      const total = w * h;
      if (total < 1 || total > 8192) return;
      const fg = settings.wledMatrixWledFgHex || "#FFFFFF";
      const cells = wledMatrixResolveCellsForScoreText(scoreText, layout, fg);
      const transition = withFade ? 12 : 0;
      const payload = wledMatrixBuildSegUpdatePayload(settings, cells, transition, pi);
      await wledMatrixSendSegJsonThrottled(settings, endpoint, payload);
    });
  }

  function readWledMatrixPlayerScores(args) {
    if (!args || typeof args !== "object") return null;
    if (!Array.isArray(args.playerScores) || !args.playerScores.length) return null;
    return args.playerScores.map((x) => (Number.isFinite(Number(x)) ? Math.trunc(Number(x)) : null));
  }

  function buildWledMatrixScoreBody(text, withFade) {
    const s = String(text ?? "").trim().slice(0, 32);
    if (!s) return null;
    const out = {
      text: {
        textString: s,
        bigFont: true,
        scrollText: false,
        scrollTextDelay: 40,
        centerText: true,
        position: { x: 8, y: 1 },
        hexColor: "#FFFFFF"
      }
    };
    if (withFade) {
      out.switchAnimation = { aktiv: true, animation: "fade" };
    }
    return out;
  }

  function buildWledMatrixArrowBody() {
    return {
      switchAnimation: {
        aktiv: true,
        animation: "coloredBarWipe"
      },
      text: {
        textString: "\u2192",
        bigFont: true,
        scrollText: true,
        scrollTextDelay: 22,
        centerText: true,
        position: { x: 8, y: 1 },
        hexColor: "#00E5FF"
      }
    };
  }

  const WLED_MATRIX_SCORE_KEYS = new Set([
    "throw",
    "gameshot",
    "matchshot",
    "x01_game_start",
    "gameon",
    "busted",
    "player_turn",
    "180",
    "140",
    "range_100_139"
  ]);

  function scheduleWledMatrixFollowTrigger(key, args, settings) {
    const showScores = settings.wledMatrixShowScores === true;
    const showTurn = settings.wledMatrixShowPlayerTurn === true;
    if (!showScores && !showTurn) return;
    const mode = String(settings.wledMatrixOutput || "pixelit").toLowerCase() === "wled_leds" ? "wled_leds" : "pixelit";

    const u0 = String(settings.wledMatrixPlayer0Url || "").trim();
    const u1 = String(settings.wledMatrixPlayer1Url || "").trim();
    const cid0 = wledMatrixGetControllerIdForPlayer(settings, 0);
    const cid1 = wledMatrixGetControllerIdForPlayer(settings, 1);
    const ep0 = getControllerEndpoint(settings, cid0);
    const ep1 = getControllerEndpoint(settings, cid1);

    const hasDest = mode === "wled_leds" ? !!(ep0 || ep1) : !!(u0 || u1);
    if (!hasDest) return;
    if (!WLED_MATRIX_SCORE_KEYS.has(key)) return;

    const scores = readWledMatrixPlayerScores(args);
    const activePiRaw = args?.playerIndex ?? args?.player;
    const activePi = Number.isFinite(Number(activePiRaw)) ? Math.trunc(Number(activePiRaw)) : null;

    const pushScore = (pi, withFade) => {
      if (!showScores || !scores || pi < 0 || pi > 1 || pi >= scores.length) return;
      const v = scores[pi];
      if (v == null || !Number.isFinite(v)) return;
      const scoreStr = String(Math.trunc(v));
      if (mode === "wled_leds") {
        const cid = pi === 0 ? cid0 : cid1;
        const ep = pi === 0 ? ep0 : ep1;
        if (!cid || !ep) return;
        mirrorLogWledMatrixScore(pi, scoreStr);
        wledMatrixPostDigits(settings, cid, scoreStr, withFade, pi);
        return;
      }
      const url = pi === 0 ? u0 : u1;
      if (!url) return;
      const body = buildWledMatrixScoreBody(scoreStr, withFade);
      if (!body) return;
      mirrorLogWledMatrixScore(pi, scoreStr);
      void postWledMatrixScreen(settings, url, body);
    };

    if (key === "player_turn") {
      const remFromArgs =
        args?.remainingScore != null && Number.isFinite(Number(args.remainingScore))
          ? Math.trunc(Number(args.remainingScore))
          : null;
      const remFromScores =
        showScores && scores && activePi != null && activePi >= 0 && activePi < scores.length
          && scores[activePi] != null && Number.isFinite(scores[activePi])
          ? scores[activePi]
          : null;
      const rem = remFromArgs != null ? remFromArgs : remFromScores;
      const turnUrl =
        activePi != null && activePi >= 0 && activePi <= 1 ? (activePi === 0 ? u0 : u1) : "";
      const turnCid =
        activePi != null && activePi >= 0 && activePi <= 1 ? (activePi === 0 ? cid0 : cid1) : "";
      const turnEp =
        activePi != null && activePi >= 0 && activePi <= 1 ? (activePi === 0 ? ep0 : ep1) : "";

      if (showScores && scores) {
        if (showTurn && activePi != null && activePi >= 0 && activePi <= 1) {
          const inactive = activePi === 0 ? 1 : 0;
          if (inactive >= 0 && inactive <= 1 && inactive < scores.length) {
            pushScore(inactive, true);
          }
        } else {
          pushScore(0, true);
          pushScore(1, true);
        }
      }

      if (showTurn && rem != null && Number.isFinite(rem)) {
        const arrowMs = Math.max(120, Math.min(5000, Number(settings.wledMatrixArrowMs) || 600));
        if (mode === "wled_leds" && turnEp && turnCid) {
          const turnPi =
            activePi != null && activePi >= 0 && activePi <= 1 ? activePi : 0;
          void wledMatrixQueueJson(settings, turnCid, async (endpoint) => {
            const layout = wledMatrixGetDisplayLayout(settings, turnPi);
            const { w, h } = layout;
            const total = w * h;
            if (total < 1 || total > 8192) return;
            const fgA = settings.wledMatrixWledArrowHex || "#00E5FF";
            const cellsA = wledMatrixResolveCellsForArrow(layout, fgA);
            await wledMatrixSendSegJsonThrottled(
              settings,
              endpoint,
              wledMatrixBuildSegUpdatePayload(settings, cellsA, 0, turnPi)
            );
            await new Promise((r) => setTimeout(r, arrowMs));
            const fg = settings.wledMatrixWledFgHex || "#FFFFFF";
            const cells = wledMatrixResolveCellsForScoreText(String(rem), layout, fg);
            await wledMatrixSendSegJsonThrottled(
              settings,
              endpoint,
              wledMatrixBuildSegUpdatePayload(settings, cells, 12, turnPi)
            );
            if (activePi != null && activePi >= 0 && activePi <= 1) {
              mirrorLogWledMatrixScore(activePi, String(rem));
            }
          });
        } else if (turnUrl) {
          void enqueueWledMatrixTask(wledMatrixHostKey(turnUrl), async () => {
            await postWledMatrixScreen(settings, turnUrl, buildWledMatrixArrowBody());
            await new Promise((r) => setTimeout(r, arrowMs));
            await postWledMatrixScreen(settings, turnUrl, buildWledMatrixScoreBody(String(rem), true));
            if (activePi != null && activePi >= 0 && activePi <= 1) {
              mirrorLogWledMatrixScore(activePi, String(rem));
            }
          });
        }
      }
      return;
    }

    if (
      showScores &&
      scores &&
      (key === "throw" ||
        key === "gameshot" ||
        key === "matchshot" ||
        key === "busted" ||
        key === "x01_game_start" ||
        key === "gameon" ||
        key === "180" ||
        key === "140" ||
        key === "range_100_139")
    ) {
      pushScore(0, key !== "throw");
      pushScore(1, key !== "throw");
    }
  }

  async function handleActionTrigger(actionKey, args = {}) {
    const settings = ADM.getSettings?.() || {};
    const keyPre = normalizeTriggerKey(actionKey);
    if (keyPre) {
      try {
        scheduleWledMatrixFollowTrigger(keyPre, args, settings);
      } catch (e) {
        ADM.logger?.error?.("errors", "wled matrix follow failed", { error: String(e?.message || e) });
      }
    }
    if (!settings.wledEnabled) return;

    const key = normalizeTriggerKey(actionKey);
    if (!key) return;

    if (key === "gameshot" || key.startsWith("gameshot+")) {
      resetWledPlayerTurnAlternateAfterLeg(args?.matchId);
    }
    if (key === "x01_game_start") {
      resetWledPlayerTurnAlternateAfterLeg(args?.matchId);
    }

    const effects = parseWledEffects(settings.wledEffectsJson);
    await fireChainVisitEffectsIfMatched(effects, key, args, settings);

    const matching = effects.filter((item) => (
      item.enabled !== false &&
      normalizeTriggerKey(item.trigger) !== "chain_visit" &&
      triggerMatchesRule(item.trigger, key, args) &&
      wledPlayerFilterMatches(item.playerFilter, args, item.trigger)
    ));
    if (!matching.length) return;

    function wledAlternateEffectIsValid(item) {
      return normalizeTriggerKey(item.trigger) === "player_turn_alternate" &&
        Array.isArray(item.presetTargets) &&
        item.presetTargets.length === 2;
    }

    let playerTurnSharedAltSlot = null;
    if (
      key === "player_turn" &&
      !args?.isBullOffPhase &&
      isWledAlternateTwoPlayerContext(args) &&
      matching.some(wledAlternateEffectIsValid)
    ) {
      playerTurnSharedAltSlot = consumeWledPlayerTurnAlternateSlot(args?.matchId);
    }

    await Promise.allSettled(matching.map(async (item) => {
      try {
        const rule = normalizeTriggerKey(item.trigger);
        let targets = Array.isArray(item.presetTargets) ? item.presetTargets : [];
        let altSlot = null;
        if (rule === "player_turn_alternate") {
          if (key !== "player_turn") return;
          if (args?.isBullOffPhase) return;
          if (!isWledAlternateTwoPlayerContext(args)) return;
          if (targets.length !== 2) return;
          if (playerTurnSharedAltSlot === null) return;
          altSlot = playerTurnSharedAltSlot;
          targets = [targets[altSlot]];
        }
        await triggerTargets(targets, settings, item.advancedJson || "");
        const trigHuman = formatWledTriggerHuman(item.trigger);
        let filterNote =
          item.playerFilter && normalizeTriggerKey(item.trigger) === "player_turn"
            ? ` @${normalizePlayerFilterCompare(item.playerFilter)}`
            : "";
        if (rule === "player_turn_alternate" && altSlot != null) {
          filterNote = ` #${altSlot + 1}`;
        }
        ADM.triggerWorkerLog?.printAdmWledEffectLine?.({
          effectName: String(item.name || "").trim() || "WLED",
          triggerUnit: `${trigHuman}${filterNote}`.trim(),
          presetSummary: formatWledPresetSummary(targets)
        });
        ADM.logger?.info?.("wled", "preset triggered", {
          trigger: key,
          targets,
          advancedJson: !!item.advancedJson,
          name: item.name,
          effect: args?.effect ?? null
        });
      } catch (e) {
        ADM.logger?.error?.("errors", "wled preset trigger failed", {
          trigger: key,
          targets: item.presetTargets,
          error: String(e?.message || e)
        });
      }
    }));
  }

  /**
   * WLED serialisiert in /json/state nur aktive Segmente; Slots ohne LEDs fehlen.
   * Zusaetzlich kann `seg` als Objekt ({ "0": {...}, "1": {...} }) vorkommen.
   */
  function wledExtractSegObjectsFromStateJson(j) {
    if (!j || typeof j !== "object") return [];
    const raw = j.seg ?? j.state?.seg;
    if (Array.isArray(raw)) {
      return raw.filter((x) => x && typeof x === "object");
    }
    if (raw && typeof raw === "object") {
      return Object.keys(raw)
        .filter((k) => /^\d+$/.test(k))
        .sort((a, b) => Number(a) - Number(b))
        .map((k) => {
          const v = raw[k];
          const kn = Number(k);
          if (v && typeof v === "object") {
            const idNum = Math.trunc(Number(v.id));
            return {
              ...v,
              id: Number.isFinite(idNum) && idNum >= 0 && idNum <= 31 ? idNum : kn
            };
          }
          return { id: kn };
        });
    }
    return [];
  }

  function wledSplitStateAndInfoFromJson(j) {
    if (!j || typeof j !== "object") return { state: null, info: null };
    if (j.state && typeof j.state === "object") {
      return {
        state: j.state,
        info: j.info && typeof j.info === "object" ? j.info : null
      };
    }
    return {
      state: j,
      info: j.info && typeof j.info === "object" ? j.info : null
    };
  }

  function wledReadMaxSegFromInfo(infoJson) {
    if (!infoJson || typeof infoJson !== "object") return null;
    const leds = infoJson.leds;
    if (!leds || typeof leds !== "object") return null;
    const n = Math.trunc(Number(leds.maxseg ?? leds.maxSeg ?? leds.max_segs));
    if (!Number.isFinite(n) || n < 1) return null;
    return Math.min(32, n);
  }

  function wledIsGenericSegmentLabel(s) {
    return /^Segment \d+$/i.test(String(s || "").trim());
  }

  function wledSegNameFromObject(o) {
    return String(o?.n ?? o?.name ?? o?.nm ?? "").trim();
  }

  /** Objekt aehnlich WLED seg[]: id + typische Felder, damit wir nicht fremde `{id,n}` erwischen. */
  function wledLooksLikeWledSegmentObject(o) {
    if (!o || typeof o !== "object" || Array.isArray(o)) return false;
    const id = Math.trunc(Number(o.id));
    if (!Number.isFinite(id) || id < 0 || id > 31) return false;
    return (
      o.start !== undefined ||
      o.stop !== undefined ||
      o.len !== undefined ||
      o.fx !== undefined ||
      o.col !== undefined ||
      o.sel !== undefined ||
      o.grp !== undefined ||
      o.spc !== undefined ||
      typeof o.bri === "number" ||
      o.on === true ||
      o.on === false ||
      o.rev === true ||
      o.rev === false
    );
  }

  function wledMergeSegmentLabelsDeep(root, byId) {
    if (!root || typeof root !== "object") return;
    const seen = new WeakSet();
    const walk = (node, depth) => {
      if (depth > 28 || node == null) return;
      if (typeof node === "string") {
        const t = node.trim();
        if (t.startsWith("{") && t.endsWith("}")) {
          try {
            walk(JSON.parse(t), depth + 1);
          } catch {
            /* ignore */
          }
        }
        return;
      }
      if (typeof node !== "object") return;
      if (seen.has(node)) return;
      seen.add(node);
      if (wledLooksLikeWledSegmentObject(node)) {
        const id = Math.max(0, Math.min(31, Math.trunc(Number(node.id))));
        const nm = wledSegNameFromObject(node);
        if (nm) {
          const prev = byId.get(id);
          if (!wledIsGenericSegmentLabel(nm)) {
            byId.set(id, nm);
          } else if (prev == null || wledIsGenericSegmentLabel(prev)) {
            byId.set(id, nm);
          }
        }
      }
      if (Array.isArray(node)) {
        for (let i = 0; i < node.length; i += 1) walk(node[i], depth + 1);
        return;
      }
      const keys = Object.keys(node);
      for (let i = 0; i < keys.length; i += 1) walk(node[keys[i]], depth + 1);
    };
    walk(root, 0);
  }

  function wledBuildSegmentPickerList(stateJson, cfgJson, presetJson) {
    const segObjs = wledExtractSegObjectsFromStateJson(stateJson);
    const byId = new Map();
    /** In /json/state gelistete Segmente (aktiv) — immer anzeigen. */
    const activeIds = new Set();
    segObjs.forEach((seg, si) => {
      let id = Math.trunc(Number(seg?.id));
      if (!Number.isFinite(id) || id < 0 || id > 31) id = si;
      id = Math.max(0, Math.min(31, id));
      activeIds.add(id);
      const label = wledSegNameFromObject(seg) || `Segment ${id}`;
      byId.set(id, label);
    });
    if (stateJson && typeof stateJson === "object") {
      wledMergeSegmentLabelsDeep(stateJson, byId);
    }
    if (cfgJson && typeof cfgJson === "object") {
      wledMergeSegmentLabelsDeep(cfgJson, byId);
    }
    if (presetJson && typeof presetJson === "object") {
      wledMergeSegmentLabelsDeep(presetJson, byId);
    }
    const relevant = new Set(activeIds);
    byId.forEach((label, id) => {
      if (!wledIsGenericSegmentLabel(label)) relevant.add(id);
    });
    if (relevant.size === 0) relevant.add(0);
    const out = [...relevant].map((id) => ({
      id,
      label: byId.get(id) || `Segment ${id}`
    }));
    out.sort((a, b) => {
      const cmp = a.label.localeCompare(b.label, "de", { sensitivity: "base", numeric: true });
      if (cmp !== 0) return cmp;
      return a.id - b.id;
    });
    return out;
  }

  async function fetchJsonStateProbe(rawEndpoint) {
    const ep = normalizeEndpoint(rawEndpoint);
    if (!ep) return { ok: false, error: "Missing endpoint" };
    try {
      const [resState, resInfo, resCfg, resPreset] = await Promise.all([
        fetch(`${ep}/json/state`, { cache: "no-store" }),
        fetch(`${ep}/json/info`, { cache: "no-store" }),
        fetch(`${ep}/json/cfg`, { cache: "no-store" }),
        fetch(`${ep}/presets.json`, { cache: "no-store" })
      ]);
      const text = await resState.text();
      let root = null;
      try {
        root = JSON.parse(text);
      } catch (_) {
        root = null;
      }
      const { state: stateFromSplit, info: embeddedFromState } = wledSplitStateAndInfoFromJson(root);
      const stateJson = stateFromSplit;
      let infoJson = null;
      try {
        const ti = await resInfo.text();
        infoJson = JSON.parse(ti);
      } catch (_) {
        infoJson = null;
      }
      if (!infoJson || typeof infoJson !== "object") {
        infoJson = embeddedFromState;
      }
      let cfgJson = null;
      try {
        const tc = await resCfg.text();
        cfgJson = JSON.parse(tc);
      } catch (_) {
        cfgJson = null;
      }
      if (!resCfg.ok) cfgJson = null;
      let presetJson = null;
      try {
        const tp = await resPreset.text();
        presetJson = JSON.parse(tp);
      } catch (_) {
        presetJson = null;
      }
      if (!resPreset.ok) presetJson = null;
      let info = null;
      let segments = null;
      if (stateJson && typeof stateJson === "object") {
        const fromInfo = infoJson && typeof infoJson === "object" ? infoJson : null;
        info = {
          name: fromInfo?.name ?? embeddedFromState?.name ?? null,
          ver: fromInfo?.ver ?? embeddedFromState?.ver ?? null,
          leds: fromInfo?.leds?.count ?? embeddedFromState?.leds?.count ?? null,
          maxseg: wledReadMaxSegFromInfo(fromInfo) ?? wledReadMaxSegFromInfo(embeddedFromState)
        };
        segments = wledBuildSegmentPickerList(stateJson, cfgJson, presetJson);
      } else if (infoJson && typeof infoJson === "object") {
        info = {
          name: infoJson?.name ?? null,
          ver: infoJson?.ver ?? null,
          leds: infoJson?.leds?.count ?? null,
          maxseg: wledReadMaxSegFromInfo(infoJson)
        };
        segments = wledBuildSegmentPickerList(null, cfgJson, presetJson);
      }
      return {
        ok: resState.ok,
        status: resState.status,
        preview: text.slice(0, 500),
        info,
        segments
      };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  }

  /**
   * Popup-Tests: Matrix-Zahl/Pfeil oder PixelIt-Screen (liest aktuelle Matrix-Settings).
   */
  async function runWledMatrixTest(payload = {}) {
    const settings = ADM.getSettings?.() || {};
    const mode = String(settings.wledMatrixOutput || "pixelit").toLowerCase() === "wled_leds" ? "wled_leds" : "pixelit";
    const kind = String(payload?.kind || "digits").toLowerCase() === "arrow" ? "arrow" : "digits";
    const pi = Number(payload?.playerIndex) === 1 ? 1 : 0;
    const rawTxt = String(payload?.text ?? "180").trim() || "180";
    const txt = rawTxt.replace(/[^0-9]/g, "").slice(0, 3) || "0";

    if (mode === "pixelit") {
      const u0 = String(settings.wledMatrixPlayer0Url || "").trim();
      const u1 = String(settings.wledMatrixPlayer1Url || "").trim();
      const url = pi === 1 ? u1 : u0;
      if (!url) return { ok: false, error: "Missing PixelIt base URL for this player" };
      const body = kind === "arrow" ? buildWledMatrixArrowBody() : buildWledMatrixScoreBody(txt, true);
      if (!body) return { ok: false, error: "Empty screen body" };
      await postWledMatrixScreen(settings, url, body);
      if (kind !== "arrow") mirrorLogWledMatrixScore(pi, txt);
      return { ok: true, mode: "pixelit", kind };
    }

    const cid = wledMatrixGetControllerIdForPlayer(settings, pi);
    const endpoint = getControllerEndpoint(settings, cid);
    if (!endpoint) return { ok: false, error: "Missing WLED controller endpoint" };

    await wledMatrixQueueJson(settings, cid, async (ep2) => {
      const layout = wledMatrixGetDisplayLayout(settings, pi);
      const { w, h } = layout;
      const total = w * h;
      if (total < 1 || total > 8192) return;
      if (kind === "arrow") {
        const fgA = settings.wledMatrixWledArrowHex || "#00E5FF";
        const cellsA = wledMatrixResolveCellsForArrow(layout, fgA);
        await wledMatrixSendSegJsonThrottled(
          settings,
          ep2,
          wledMatrixBuildSegUpdatePayload(settings, cellsA, 0, pi)
        );
        return;
      }
      const fg = settings.wledMatrixWledFgHex || "#FFFFFF";
      const cells = wledMatrixResolveCellsForScoreText(txt, layout, fg);
      await wledMatrixSendSegJsonThrottled(
        settings,
        ep2,
        wledMatrixBuildSegUpdatePayload(settings, cells, 12, pi)
      );
      if (kind !== "arrow") mirrorLogWledMatrixScore(pi, txt);
    });
    return { ok: true, mode: "wled_leds", kind };
  }

  ADM.wled = {
    normalizeEndpoint,
    fetchPresets,
    triggerPreset,
    triggerJsonState,
    triggerTargets,
    handleActionTrigger,
    fetchJsonStateProbe,
    runWledMatrixTest
  };
})(self);
