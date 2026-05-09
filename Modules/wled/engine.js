(function initWledEngine(scope) {
  const ADM = scope.ADM || (scope.ADM = {});

  /**
   * 2 Spieler: nach Leggewinn (`gameshot*`) / Spielstart wieder Preset 1 (Slot 0),
   * danach abwechselnd pro `player_turn`. Nicht im Bull-Off; nur wenn `participantCount === 2`.
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

  function wledMatrixXYToIndex(x, y, w, serpentine) {
    let xi = x;
    if (serpentine && (y & 1)) xi = w - 1 - x;
    return y * w + xi;
  }

  const WLED_MATRIX_DIGIT35 = {
    0: [7, 5, 5, 5, 7],
    1: [2, 6, 2, 2, 7],
    2: [7, 1, 7, 4, 7],
    3: [7, 1, 7, 1, 7],
    4: [5, 5, 7, 1, 1],
    5: [7, 4, 7, 1, 7],
    6: [7, 4, 7, 5, 7],
    7: [7, 1, 1, 1, 1],
    8: [7, 5, 7, 5, 7],
    9: [7, 5, 7, 1, 7]
  };

  const WLED_MATRIX_ARROW55 = [
    [2, 0], [1, 1], [2, 1], [3, 1],
    [0, 2], [1, 2], [2, 2], [3, 2], [4, 2],
    [1, 3], [2, 3], [3, 3],
    [2, 4]
  ];

  function wledMatrixCollectCellsForDigits(text, w, h, serpentine, fgHex) {
    const fg = wledMatrixNormalizeHex6(fgHex);
    const cells = new Map();
    const s = String(text || "").replace(/\D/g, "").slice(0, 3);
    const str = s || "0";
    const digitW = 3;
    const digitH = 5;
    const gap = 1;
    const totalW = str.length * digitW + (str.length - 1) * gap;
    const ox = Math.max(0, Math.floor((w - totalW) / 2));
    const oy = Math.max(0, Math.floor((h - digitH) / 2));
    let cx = ox;
    for (let k = 0; k < str.length; k += 1) {
      const ch = str[k];
      const rows = WLED_MATRIX_DIGIT35[ch];
      if (!rows) {
        cx += digitW + gap;
        continue;
      }
      for (let r = 0; r < digitH; r += 1) {
        for (let c = 0; c < digitW; c += 1) {
          if (((rows[r] >> (digitW - 1 - c)) & 1) === 0) continue;
          const px = cx + c;
          const py = oy + r;
          if (px < 0 || py < 0 || px >= w || py >= h) continue;
          const idx = wledMatrixXYToIndex(px, py, w, serpentine);
          if (idx >= 0 && idx < w * h) cells.set(idx, fg);
        }
      }
      cx += digitW + gap;
    }
    return cells;
  }

  function wledMatrixCollectCellsForArrow(w, h, serpentine, fgHex) {
    const fg = wledMatrixNormalizeHex6(fgHex);
    const cells = new Map();
    const gw = 5;
    const gh = 5;
    const ox = Math.max(0, Math.floor((w - gw) / 2));
    const oy = Math.max(0, Math.floor((h - gh) / 2));
    for (const [dx, dy] of WLED_MATRIX_ARROW55) {
      const px = ox + dx;
      const py = oy + dy;
      if (px < 0 || py < 0 || px >= w || py >= h) continue;
      const idx = wledMatrixXYToIndex(px, py, w, serpentine);
      if (idx >= 0 && idx < w * h) cells.set(idx, fg);
    }
    return cells;
  }

  function wledMatrixBuildSegI(totalLeds, cells) {
    const i = [0, totalLeds, "000000"];
    cells.forEach((hex, idx) => {
      const n = Number(idx);
      if (!Number.isFinite(n) || n < 0 || n >= totalLeds) return;
      i.push(Math.trunc(n), wledMatrixNormalizeHex6(hex));
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

  function wledMatrixReadLayout(settings) {
    const segId = Math.max(0, Math.min(31, Math.trunc(Number(settings.wledMatrixWledSegmentId) || 0)));
    const w = Math.max(1, Math.min(32, Math.trunc(Number(settings.wledMatrixWledWidth) || 16)));
    const h = Math.max(1, Math.min(32, Math.trunc(Number(settings.wledMatrixWledHeight) || 16)));
    const serpentine = settings.wledMatrixWledSerpentine === true;
    return { segId, w, h, serpentine };
  }

  function wledMatrixResolveControllerIds(settings) {
    const ctrls = parseControllers(settings?.wledControllersJson);
    const id0 = String(settings.wledMatrixWledControllerId0 || "").trim();
    const id1 = String(settings.wledMatrixWledControllerId1 || "").trim();
    const cid0 = id0 || String(ctrls[0]?.id || "").trim();
    const cid1 = id1 || String(ctrls[1]?.id || ctrls[0]?.id || "").trim();
    return { cid0, cid1, ctrls };
  }

  function wledMatrixPostDigits(settings, controllerId, scoreText, withFade) {
    void wledMatrixQueueJson(settings, controllerId, async (endpoint) => {
      const { segId, w, h, serpentine } = wledMatrixReadLayout(settings);
      const total = w * h;
      if (total < 1 || total > 512) return;
      const fg = settings.wledMatrixWledFgHex || "#FFFFFF";
      const cells = wledMatrixCollectCellsForDigits(scoreText, w, h, serpentine, fg);
      const iArr = wledMatrixBuildSegI(total, cells);
      const transition = withFade ? 12 : 0;
      await wledMatrixSendSegJsonThrottled(settings, endpoint, {
        on: true,
        transition,
        seg: [{ id: segId, i: iArr }]
      });
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
    "player_turn"
  ]);

  function scheduleWledMatrixFollowTrigger(key, args, settings) {
    const showScores = settings.wledMatrixShowScores === true;
    const showTurn = settings.wledMatrixShowPlayerTurn === true;
    if (!showScores && !showTurn) return;
    const mode = String(settings.wledMatrixOutput || "pixelit").toLowerCase() === "wled_leds" ? "wled_leds" : "pixelit";

    const u0 = String(settings.wledMatrixPlayer0Url || "").trim();
    const u1 = String(settings.wledMatrixPlayer1Url || "").trim();
    const { cid0, cid1 } = wledMatrixResolveControllerIds(settings);
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
      if (mode === "wled_leds") {
        const cid = pi === 0 ? cid0 : cid1;
        const ep = pi === 0 ? ep0 : ep1;
        if (!cid || !ep) return;
        wledMatrixPostDigits(settings, cid, String(Math.trunc(v)), withFade);
        return;
      }
      const url = pi === 0 ? u0 : u1;
      if (!url) return;
      const body = buildWledMatrixScoreBody(String(v), withFade);
      if (!body) return;
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
          void wledMatrixQueueJson(settings, turnCid, async (endpoint) => {
            const { segId, w, h, serpentine } = wledMatrixReadLayout(settings);
            const total = w * h;
            if (total < 1 || total > 512) return;
            const fgA = settings.wledMatrixWledArrowHex || "#00E5FF";
            const cellsA = wledMatrixCollectCellsForArrow(w, h, serpentine, fgA);
            const iArrA = wledMatrixBuildSegI(total, cellsA);
            await wledMatrixSendSegJsonThrottled(settings, endpoint, {
              on: true,
              transition: 0,
              seg: [{ id: segId, i: iArrA }]
            });
            await new Promise((r) => setTimeout(r, arrowMs));
            const fg = settings.wledMatrixWledFgHex || "#FFFFFF";
            const cells = wledMatrixCollectCellsForDigits(String(rem), w, h, serpentine, fg);
            const iArr = wledMatrixBuildSegI(total, cells);
            await wledMatrixSendSegJsonThrottled(settings, endpoint, {
              on: true,
              transition: 12,
              seg: [{ id: segId, i: iArr }]
            });
          });
        } else if (turnUrl) {
          void enqueueWledMatrixTask(wledMatrixHostKey(turnUrl), async () => {
            await postWledMatrixScreen(settings, turnUrl, buildWledMatrixArrowBody());
            await new Promise((r) => setTimeout(r, arrowMs));
            await postWledMatrixScreen(settings, turnUrl, buildWledMatrixScoreBody(String(rem), true));
          });
        }
      }
      return;
    }

    if (showScores && scores && (key === "throw" || key === "gameshot" || key === "matchshot" || key === "busted" || key === "x01_game_start" || key === "gameon")) {
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
      Number.isFinite(Number(args?.participantCount)) &&
      Number(args.participantCount) === 2 &&
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
          const pc = Number(args?.participantCount);
          if (!Number.isFinite(pc) || pc !== 2) return;
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

  async function fetchJsonStateProbe(rawEndpoint) {
    const ep = normalizeEndpoint(rawEndpoint);
    if (!ep) return { ok: false, error: "Missing endpoint" };
    try {
      const res = await fetch(`${ep}/json/state`, { cache: "no-store" });
      const text = await res.text();
      let info = null;
      try {
        const j = JSON.parse(text);
        info = {
          name: j?.info?.name ?? null,
          ver: j?.info?.ver ?? null,
          leds: j?.info?.leds?.count ?? null
        };
      } catch (_) {}
      return {
        ok: res.ok,
        status: res.status,
        preview: text.slice(0, 500),
        info
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
    const txt = rawTxt.replace(/\D/g, "").slice(0, 3) || "0";

    if (mode === "pixelit") {
      const u0 = String(settings.wledMatrixPlayer0Url || "").trim();
      const u1 = String(settings.wledMatrixPlayer1Url || "").trim();
      const url = pi === 1 ? u1 : u0;
      if (!url) return { ok: false, error: "Missing PixelIt base URL for this player" };
      const body = kind === "arrow" ? buildWledMatrixArrowBody() : buildWledMatrixScoreBody(txt, true);
      if (!body) return { ok: false, error: "Empty screen body" };
      await postWledMatrixScreen(settings, url, body);
      return { ok: true, mode: "pixelit", kind };
    }

    const { cid0, cid1 } = wledMatrixResolveControllerIds(settings);
    const cid = pi === 1 ? cid1 : cid0;
    const endpoint = getControllerEndpoint(settings, cid);
    if (!endpoint) return { ok: false, error: "Missing WLED controller endpoint" };

    await wledMatrixQueueJson(settings, cid, async (ep2) => {
      const { segId, w, h, serpentine } = wledMatrixReadLayout(settings);
      const total = w * h;
      if (total < 1 || total > 512) return;
      if (kind === "arrow") {
        const fgA = settings.wledMatrixWledArrowHex || "#00E5FF";
        const cellsA = wledMatrixCollectCellsForArrow(w, h, serpentine, fgA);
        const iArrA = wledMatrixBuildSegI(total, cellsA);
        await wledMatrixSendSegJsonThrottled(settings, ep2, {
          on: true,
          transition: 0,
          seg: [{ id: segId, i: iArrA }]
        });
        return;
      }
      const fg = settings.wledMatrixWledFgHex || "#FFFFFF";
      const cells = wledMatrixCollectCellsForDigits(txt, w, h, serpentine, fg);
      const iArr = wledMatrixBuildSegI(total, cells);
      await wledMatrixSendSegJsonThrottled(settings, ep2, {
        on: true,
        transition: 12,
        seg: [{ id: segId, i: iArr }]
      });
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
