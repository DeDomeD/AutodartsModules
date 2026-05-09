(function initWledModule(scope) {
  scope.ADM_MODULES = scope.ADM_MODULES || {};

  /**
   * Nur Schluessel wie im Worker-Log: `admTriggerBus.emit` vereinheitlicht vor `__log`
   * (`toUnifiedDispatchKey` in `adm-trigger-foundation.js`), dieselben Keys kommen bei WLED an.
   * Siehe `Main/docs/adm-triggers-worker-background.md`.
   */
  /** UI-only Select-Werte → werden beim Speichern in echte Worker-Keys aufgeloest. */
  const WLED_PAD_LEG = "__wled_pad_leg__";
  /** Ein Eintrag „Wurf“: Single/Double/Triple waehlbar ueber S/D/T neben dem Zahlenfeld. */
  const WLED_PAD_THROW = "__wled_pad_throw__";
  const WLED_PAD_PLAYER = "__wled_pad_player__";
  /** 2 Spieler: zwei Presets wechseln pro Visit; nach Leggewinn wieder mit Preset 1. */
  const WLED_PAD_PLAYER_ALTERNATE = "__wled_pad_player_alternate__";
  /** Drei Treffer eines Visits (beliebige Reihenfolge), z.B. drei Zahlen als Singles oder volle Segment-Tokens. */
  const WLED_PAD_CHAIN = "__wled_pad_chain_visit__";

  const WLED_PAD_SEGMENT_SELECTS = new Set([WLED_PAD_LEG, WLED_PAD_THROW]);

  const WLED_TRIGGER_GROUPS = [
    {
      key: "wledPad",
      de: "Leggewinn, Wurf, Spieler, Trefferkette",
      en: "Leg, throw, player, chain",
      values: [WLED_PAD_LEG, WLED_PAD_THROW, WLED_PAD_CHAIN, WLED_PAD_PLAYER, WLED_PAD_PLAYER_ALTERNATE]
    },
    {
      key: "match",
      de: "Match & Leg (weitere)",
      en: "Match & leg (more)",
      values: ["gameon", "busted", "bot_throw"]
    },
    {
      key: "checkout",
      de: "Checkout",
      en: "Checkout",
      values: ["takeout"]
    },
    {
      key: "board",
      de: "Board & Session",
      en: "Board & session",
      values: [
        "board_starting",
        "board_started",
        "board_stopping",
        "board_stopped",
        "calibration_started",
        "calibration_finished",
        "manual_reset_done",
        "lobby_in",
        "lobby_out",
        "tournament_ready"
      ]
    },
    {
      key: "gamemode",
      de: "Gamemode",
      en: "Gamemode",
      values: ["x01_game_start", "bull_off_start", "bull_off_end"]
    }
  ];

  const wledUiState = {
    presetsByControllerId: {},
    statusByControllerId: {},
    collapsedByControllerId: {},
    loadedEndpointByControllerId: {},
    loadingByControllerId: {},
    presetDropdownOpen: false,
    advancedJsonCollapsed: true,
    advancedJsonDraft: "",
    advancedJsonHelperMode: "player",
    advancedJsonHelperHue: 210,
    wledPadMult: "t",
    wledSegmentPadOpen: false,
    /** false = aufgeklappt (Inhalt sichtbar), true = zugeklappt */
    matrixSectionCollapsed: false,
    effectsSectionCollapsed: false,
    testSectionCollapsed: false
  };

  function getLang(settings) {
    return String(settings?.uiLanguage || "de").toLowerCase() === "en" ? "en" : "de";
  }

  function clampHue(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return 210;
    return Math.max(0, Math.min(360, Math.round(num)));
  }

  function hslToRgb(h, s = 88, l = 50) {
    const hue = ((Number(h) % 360) + 360) % 360;
    const sat = Math.max(0, Math.min(100, Number(s))) / 100;
    const light = Math.max(0, Math.min(100, Number(l))) / 100;
    const c = (1 - Math.abs((2 * light) - 1)) * sat;
    const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
    const m = light - (c / 2);
    let r = 0;
    let g = 0;
    let b = 0;

    if (hue < 60) [r, g, b] = [c, x, 0];
    else if (hue < 120) [r, g, b] = [x, c, 0];
    else if (hue < 180) [r, g, b] = [0, c, x];
    else if (hue < 240) [r, g, b] = [0, x, c];
    else if (hue < 300) [r, g, b] = [x, 0, c];
    else [r, g, b] = [c, 0, x];

    return [
      Math.round((r + m) * 255),
      Math.round((g + m) * 255),
      Math.round((b + m) * 255)
    ];
  }

  function buildSolidAdvancedJson(hue) {
    const [r, g, b] = hslToRgb(hue);
    return JSON.stringify({
      on: true,
      seg: [
        {
          id: 0,
          fx: 0,
          col: [[r, g, b], [0, 0, 0], [0, 0, 0]]
        }
      ]
    }, null, 2);
  }

  function renderAdvancedJsonHelper(settings) {
    const lang = getLang(settings);
    const mode = wledUiState.advancedJsonHelperMode === "score" ? "score" : "player";
    const hue = clampHue(wledUiState.advancedJsonHelperHue);
    const modeTitle = mode === "score"
      ? (lang === "en" ? "Score Color" : "Score-Farbe")
      : (lang === "en" ? "Player Color" : "Spieler-Farbe");
    return `
      <div class="advancedJsonHelper">
        <div class="advancedJsonHelperHead">
          <div class="advancedJsonHelperTitle">${modeTitle}</div>
          <div class="choiceRow advancedJsonModeRow">
            <button type="button" class="choiceBtn${mode === "player" ? " active" : ""}" data-wled-advanced-mode="player">${lang === "en" ? "Player" : "Spieler"}</button>
            <button type="button" class="choiceBtn${mode === "score" ? " active" : ""}" data-wled-advanced-mode="score">${lang === "en" ? "Score" : "Score"}</button>
          </div>
        </div>
        <div class="advancedJsonHelperControls">
          <input
            id="wledAdvancedJsonHue"
            class="hueSlider advancedJsonHueSlider"
            type="range"
            min="0"
            max="360"
            step="1"
            value="${hue}"
            style="--hue:${hue};"
          />
          <div class="advancedJsonColorPreview" style="background:hsl(${hue} 88% 50%);"></div>
        </div>
        <div class="rowSplit">
          <button type="button" class="btnPrimary" id="wledApplyAdvancedJsonHelper">${lang === "en" ? "Apply Solid Json" : "Solid Json uebernehmen"}</button>
        </div>
      </div>
    `;
  }

  function renderAdvancedJsonSection(settings) {
    const lang = getLang(settings);
    return `
      <div class="advancedJsonSection">
        <button
          type="button"
          class="btnPrimary fullWidthBtn"
          style="display:flex;align-items:center;justify-content:space-between;gap:10px;text-align:left;box-sizing:border-box;"
          id="wledAdvancedJsonToggle"
          aria-expanded="${wledUiState.advancedJsonCollapsed ? "false" : "true"}"
        >
          <span style="font-size:13px;font-weight:650;letter-spacing:0.01em;">Advanced Json</span>
          <span class="wledFoldChev">${wledUiState.advancedJsonCollapsed ? "v" : "^"}</span>
        </button>
        <div class="advancedJsonSectionBody${wledUiState.advancedJsonCollapsed ? " hidden" : ""}">
          <div class="advancedJsonCard">
            <label class="label advancedJsonLabel" for="wledAdvancedJson">Advanced Json</label>
            <textarea
              class="input advancedJsonInput"
              id="wledAdvancedJson"
              rows="6"
              placeholder='{"on":true,"bri":180,"seg":[{"id":0,"fx":27}]}'
            >${wledUiState.advancedJsonDraft}</textarea>
            <div class="hint advancedJsonHint">${lang === "en" ? "Optional WLED JSON that is additionally sent to the selected controllers." : "Optionales WLED JSON, das zusaetzlich an die gewaehlten Controller gesendet wird."}</div>
            <div id="wledAdvancedJsonHelperMount">${renderAdvancedJsonHelper(settings)}</div>
          </div>
        </div>
      </div>
    `;
  }

  function parseControllers(raw) {
    try {
      const arr = JSON.parse(String(raw || "[]"));
      if (!Array.isArray(arr)) return [];
      return arr
        .filter((item) => item && typeof item === "object")
        .map((item, index) => ({
          id: String(item.id || `ctrl_${index + 1}`).trim(),
          name: String(item.name || "").trim(),
          endpoint: String(item.endpoint || "").trim()
        }))
        .filter((item) => !!item.id);
    } catch {
      return [];
    }
  }

  function normalizePresetTargets(rawTargets, controllers) {
    const controllerMap = new Map((controllers || []).map((item, index) => [item.id, { ...item, index }]));
    if (!Array.isArray(rawTargets)) return [];
    return rawTargets
      .filter((item) => item && typeof item === "object")
      .map((item) => {
        const controllerId = String(item.controllerId || "").trim();
        const presetId = String(item.presetId || "").trim();
        const controller = controllerMap.get(controllerId);
        if (!controller || !presetId) return null;
        return {
          controllerId,
          presetId,
          presetName: String(item.presetName || "").trim(),
          controllerName: String(item.controllerName || "").trim() || controller.name || `Controller ${controller.index + 1}`
        };
      })
      .filter(Boolean);
  }

  function parseWledEffects(raw, controllers = []) {
    try {
      const arr = JSON.parse(String(raw || "[]"));
      if (!Array.isArray(arr)) return [];
      return arr
        .filter((item) => item && typeof item === "object")
        .map((item) => {
          const legacyTargets = item.controllerId && item.presetId
            ? [{
                controllerId: String(item.controllerId || item.controller || "").trim(),
                presetId: String(item.presetId || "").trim(),
                presetName: String(item.presetName || "").trim()
              }]
            : [];
          const presetTargets = normalizePresetTargets(item.presetTargets || legacyTargets, controllers);
          let trigger = String(item.trigger || "").trim();
          const playerFilter = String(item.playerFilter || "").trim();
          if (normalizeConfiguredTrigger(trigger) === "throw" && playerFilter) {
            trigger = "player_turn";
          }
          const chainRaw = item?.chainTriple;
          const chainTriple = Array.isArray(chainRaw)
            ? chainRaw.map((x) => normalizeSegmentToken(String(x || ""))).filter(Boolean)
            : [];
          return {
            id: String(item.id || "").trim(),
            name: String(item.name || "").trim(),
            trigger,
            presetTargets,
            advancedJson: String(item.advancedJson || "").trim(),
            playerFilter,
            chainTriple: chainTriple.length === 3 ? chainTriple : [],
            enabled: item.enabled !== false
          };
        })
        .filter((item) => !!item.id && !!item.name && !!item.trigger && (item.presetTargets.length > 0 || !!item.advancedJson));
    } catch {
      return [];
    }
  }

  function getControllers(settings) {
    const parsed = parseControllers(settings?.wledControllersJson);
    return parsed.length ? parsed : [{ id: "ctrl_1", name: "", endpoint: "http://127.0.0.1" }];
  }

  function isControllerCollapsed(controllerId) {
    return wledUiState.collapsedByControllerId[controllerId] !== false;
  }

  function getControllerLabel(controller, settings, index = -1) {
    if (controller?.name) return controller.name;
    const fallbackIndex = index >= 0 ? index + 1 : 1;
    return getLang(settings) === "en" ? `Controller ${fallbackIndex}` : `Controller ${fallbackIndex}`;
  }

  function getTriggerLabel(trigger, settings) {
    const lang = getLang(settings);
    const normalized = normalizeConfiguredTrigger(trigger);
    if (normalized === WLED_PAD_LEG) return lang === "en" ? "Leg win (+ last dart)" : "Leggewinn (+ letzter Treffer)";
    if (normalized === WLED_PAD_THROW) return lang === "en" ? "Throw (S / D / T + field)" : "Wurf (S / D / T + Feld)";
    if (normalized === WLED_PAD_PLAYER) return lang === "en" ? "Player (name filter)" : "Spieler (Namensfilter)";
    if (normalized === WLED_PAD_PLAYER_ALTERNATE) {
      return lang === "en" ? "Player (alternate)" : "Spieler (Wechsel)";
    }
    if (normalized === WLED_PAD_CHAIN) {
      return lang === "en" ? "Hit chain" : "Trefferkette";
    }
    const playerMatch = normalized.match(/^(player|spieler)_(\d+)$/);
    if (playerMatch) {
      const number = Number(playerMatch[2]);
      if (number >= 1) {
        return lang === "en" ? `Player ${number} (name key)` : `Spieler ${number} (Namens-Key)`;
      }
    }
    const combo = normalized.match(/^(gameshot|matchshot)\+(.+)$/);
    if (combo) {
      const head = combo[1] === "gameshot" ? (lang === "en" ? "Leg win" : "Leggewinn") : (lang === "en" ? "Match win" : "Matchgewinn");
      return `${head} + ${combo[2]}`;
    }
    const seg = normalized.match(/^([sdt])(\d+)$/);
    if (seg) {
      const n = seg[2];
      if (seg[1] === "s") return lang === "en" ? `Single ${n}` : `Single ${n}`;
      if (seg[1] === "d") return lang === "en" ? `Double ${n}` : `Double ${n}`;
      return lang === "en" ? `Triple ${n}` : `Triple ${n}`;
    }
    const labels = {
      chain_visit: {
        de: "Trefferkette",
        en: "Hit chain"
      },
      player_turn_alternate: {
        de: "Spieler Wechsel (2 Presets, nur 2 Spieler)",
        en: "Player alternate (2 presets, 2 players only)"
      },
      gameon: { de: "Game ON", en: "Game ON" },
      gameshot: { de: "Leggewinn", en: "Leg shot / win" },
      matchshot: { de: "Matchgewinn", en: "Match shot / win" },
      busted: { de: "Bust", en: "Bust" },
      bot_throw: { de: "Bot-Wurf", en: "Bot throw" },
      takeout: { de: "Checkout / Takeout", en: "Checkout / takeout" },
      takeout_finished: { de: "Takeout fertig (alt)", en: "Takeout finished (legacy)" },
      throw: { de: "Wurf meta (alt)", en: "Throw meta (legacy)" },
      player_turn: { de: "Spieler am Zug (alt)", en: "Player turn (legacy)" },
      outside: { de: "Outside (alt)", en: "Outside (legacy)" },
      double: { de: "Double (alt)", en: "Double (legacy)" },
      triple: { de: "Triple (alt)", en: "Triple (legacy)" },
      bull: { de: "Bull (alt)", en: "Bull (legacy)" },
      bull_checkout: { de: "Bull-Checkout (alt)", en: "Bull checkout (legacy)" },
      checkout: { de: "Checkout (Roh-Event)", en: "Checkout (raw event)" },
      board_starting: { de: "Board startet", en: "Board starting" },
      board_started: { de: "Board gestartet", en: "Board started" },
      board_stopping: { de: "Board stoppt", en: "Board stopping" },
      board_stopped: { de: "Board gestoppt", en: "Board stopped" },
      calibration_started: { de: "Kalibrierung start", en: "Calibration started" },
      calibration_finished: { de: "Kalibrierung Ende", en: "Calibration finished" },
      manual_reset_done: { de: "Manueller Reset", en: "Manual reset done" },
      lobby_in: { de: "Lobby rein", en: "Lobby in" },
      lobby_out: { de: "Lobby raus", en: "Lobby out" },
      tournament_ready: { de: "Turnier bereit", en: "Tournament ready" },
      x01_game_start: {
        de: "X01 Spielstart (Game ON, kein Cork)",
        en: "X01 game start (Game ON, not cork)"
      },
      bull_off_start: { de: "Bull-Off Start", en: "Bull-off start" },
      bull_off_end: { de: "Bull-Off Ende", en: "Bull-off end" }
    };
    const row = labels[normalized];
    if (row) return lang === "en" ? row.en : row.de;
    return trigger;
  }

  /**
   * Kurzer Hover-Text (title) pro Trigger-Option — Beispiele wie in Worker/Log ueblich.
   */
  function getTriggerOptionHint(value, settings) {
    const lang = getLang(settings);
    const v = normalizeConfiguredTrigger(value);
    const H = {
      [WLED_PAD_LEG]: {
        de: "Leggewinn inkl. letztem Checkout-Treffer. Beispiel: D20 auswaehlen → Trigger gameshot+d20 (wie Leggewinn + D20 im Log).",
        en: "Leg win including checkout dart. Example: pick D20 → trigger gameshot+d20 (same idea as leg win + D20 in the log)."
      },
      [WLED_PAD_THROW]: {
        de: "Ein einzelner Wurf wie im Worker (t20, d16, outside, …). Beispiel: Triple 20 → t20.",
        en: "One throw segment as in the worker (t20, d16, outside, …). Example: triple 20 → t20."
      },
      [WLED_PAD_CHAIN]: {
        de: "Nach dem 3. Dart eines Visits: drei Treffer in beliebiger Reihenfolge. Beispiel Waschmaschine: drei passende Segmente eintragen (z.B. nur drei Zahlen 1 20 5 als Singles).",
        en: "After the 3rd dart of a visit: three hits in any order. Waschmaschine-style: enter three matching segments (e.g. three numbers 1 20 5 as singles)."
      },
      [WLED_PAD_PLAYER]: {
        de: "Einmal pro Aufnahme wenn der aktive Spielername den Filter enthaelt. Beispiel: alex → trifft auf „Alex Müller“.",
        en: "Once per visit if the active player name contains the filter. Example: alex matches “Alex Smith”."
      },
      [WLED_PAD_PLAYER_ALTERNATE]: {
        de: "Nur 2 Spieler: genau 2 Presets (A/B), nach Leggewinn wieder Preset 1, dann Wechsel pro Zug.",
        en: "2 players only: exactly 2 presets (A/B); after a leg win starts with preset 1, then alternates each visit."
      },
      gameon: {
        de: "Spiel / Match laeuft (Game ON).",
        en: "Game is live (game on)."
      },
      busted: {
        de: "Bust (Ueberwurf).",
        en: "Bust (score over remaining)."
      },
      bot_throw: {
        de: "Wurf eines Bot-/CPU-Spielers.",
        en: "Throw from a bot / CPU player."
      },
      takeout: {
        de: "Checkout / Takeout aktiv (Worker-Key takeout).",
        en: "Checkout / takeout in progress (worker key takeout)."
      },
      board_starting: { de: "Board startet.", en: "Board is starting." },
      board_started: { de: "Board gestartet.", en: "Board started." },
      board_stopping: { de: "Board stoppt.", en: "Board is stopping." },
      board_stopped: { de: "Board gestoppt.", en: "Board stopped." },
      calibration_started: { de: "Kalibrierung beginnt.", en: "Calibration started." },
      calibration_finished: { de: "Kalibrierung fertig.", en: "Calibration finished." },
      manual_reset_done: { de: "Manueller Reset / Korrektur.", en: "Manual reset / correction." },
      lobby_in: { de: "Lobby / Warteraum betreten.", en: "Entered lobby / waiting room." },
      lobby_out: { de: "Lobby verlassen.", en: "Left lobby." },
      tournament_ready: { de: "Turnier bereit.", en: "Tournament ready." },
      x01_game_start: {
        de: "X01-Spielstart (nach Bull-Off etc.).",
        en: "X01 game start (after bull-off, etc.)."
      },
      bull_off_start: { de: "Bull-Off / Cork beginnt.", en: "Bull-off / cork begins." },
      bull_off_end: { de: "Bull-Off / Cork endet.", en: "Bull-off / cork ends." }
    };
    const row = H[v];
    if (!row) return "";
    return lang === "en" ? row.en : row.de;
  }

  function getAllLoadedPresets(settings) {
    const controllers = getControllers(settings);
    return controllers.flatMap((controller, index) => {
      const controllerLabel = getControllerLabel(controller, settings, index);
      return (wledUiState.presetsByControllerId[controller.id] || []).map((preset) => ({
        controllerId: controller.id,
        controllerLabel,
        presetId: String(preset.id),
        presetName: String(preset.name || "")
      }));
    });
  }

  function getSelectedPresetTargets(root, settings) {
    const raw = String(root.querySelector("#wledSelectedPresetTargets")?.value || "[]");
    const allLoaded = getAllLoadedPresets(settings);
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.map((item) => {
        const controllerId = String(item?.controllerId || "").trim();
        const presetId = String(item?.presetId || "").trim();
        const match = allLoaded.find((entry) => entry.controllerId === controllerId && entry.presetId === presetId);
        if (!match) return null;
        return {
          controllerId,
          controllerName: match.controllerLabel,
          presetId,
          presetName: match.presetName
        };
      }).filter(Boolean);
    } catch {
      return [];
    }
  }

  function normalizeConfiguredTrigger(value) {
    return String(value || "").trim().toLowerCase();
  }

  function normalizeSegmentToken(raw) {
    let s = normalizeConfiguredTrigger(raw).replace(/\s+/g, "");
    if (!s) return "";
    if (s === "d25" || s === "dbull" || s === "doublebull") s = "bull";
    return s;
  }

  function isValidLegSuffix(s) {
    if (!s) return false;
    if (s === "outside" || s === "bull" || s === "dbull") return true;
    if (/^(s25|t25)$/.test(s)) return true;
    return /^[sdt](?:[1-9]|1[0-9]|20)$/.test(s);
  }

  function isValidThrowSegment(s) {
    return isValidLegSuffix(s);
  }

  function getWledSelectMode(root) {
    return normalizeConfiguredTrigger(root.querySelector("#wledEffectTrigger")?.value);
  }

  function getEffectivePadMult(root) {
    void root;
    return wledUiState.wledPadMult || "t";
  }

  function setWledSegmentField(root, text) {
    const el = root.querySelector("#wledSegmentField");
    if (el) el.value = text || "";
  }

  function apiGetSettingsSafe(root) {
    void root;
    try {
      return scope.ADM_MODULES?.wled?._delegateApi?.getSettings?.() || {};
    } catch {
      return {};
    }
  }

  function setWledSegmentPadPopoverOpen(root, open, settings) {
    const s = settings || apiGetSettingsSafe(root);
    const lang = getLang(s);
    wledUiState.wledSegmentPadOpen = !!open;
    const body = root.querySelector("#wledSegmentPadBody");
    const tgl = root.querySelector("#wledSegmentPadToggle");
    if (body) {
      body.classList.toggle("hidden", !open);
      body.hidden = !open;
    }
    if (tgl) {
      tgl.setAttribute("aria-expanded", open ? "true" : "false");
      tgl.setAttribute(
        "aria-label",
        open
          ? (lang === "en" ? "Close keypad" : "Tastenfeld schliessen")
          : (lang === "en" ? "Open keypad" : "Tastenfeld oeffnen")
      );
      tgl.title = open
        ? (lang === "en" ? "Close keypad" : "Tastenfeld schliessen")
        : (lang === "en" ? "Open keypad" : "Tastenfeld oeffnen");
    }
  }

  function syncWledPadMultUi(root) {
    const sel = getWledSelectMode(root);
    const row = root.querySelector("#wledPadMultRow");
    if (row) {
      const showMult = sel === WLED_PAD_LEG || sel === WLED_PAD_THROW;
      row.classList.toggle("hidden", !showMult);
      row.hidden = !showMult;
    }
    root.querySelectorAll("[data-wled-pad-mult]").forEach((btn) => {
      const m = String(btn.dataset.wledPadMult || "").toLowerCase();
      btn.classList.toggle("active", m === (wledUiState.wledPadMult || "t"));
    });
  }

  function onWledTriggerSelectChange(root, settings) {
    const s = settings || apiGetSettingsSafe(root);
    const lang = getLang(s);
    const sel = getWledSelectMode(root);
    const segRow = root.querySelector("#wledSegmentPadRow");
    const pfRow = root.querySelector("#wledPlayerFilterRow");
    const hintSeg = root.querySelector("#wledSegmentPadHint");
    const hintPf = root.querySelector("#wledPlayerFilterHint");

    if (sel === WLED_PAD_PLAYER) {
      setWledSegmentPadPopoverOpen(root, false, s);
      if (segRow) {
        segRow.classList.add("hidden");
        segRow.hidden = true;
      }
      const chainRowP = root.querySelector("#wledChainTripleRow");
      if (chainRowP) {
        chainRowP.classList.add("hidden");
        chainRowP.hidden = true;
      }
      const altRow = root.querySelector("#wledAlternateLogicRow");
      if (altRow) {
        altRow.classList.add("hidden");
        altRow.hidden = true;
      }
      if (pfRow) {
        pfRow.classList.remove("hidden");
        pfRow.hidden = false;
      }
      if (hintPf) {
        hintPf.textContent = lang === "en"
          ? "Once per visit if the active player name contains this text (case-insensitive). For different LEDs per person, add one effect per person with a different filter — works even if Autodarts or other modules change column order or box positions."
          : "Einmal pro Aufnahme, wenn der aktive Spielername diesen Text enthaelt (ohne Gross/Kleinschreibung). Verschiedene LEDs pro Person: je einen Effekt mit eigenem Namensfilter — unabhaengig von Spalten-Tausch oder verschobenen Boxen durch andere Module.";
      }
      setWledSegmentField(root, "");
      return;
    }

    if (sel === WLED_PAD_CHAIN) {
      setWledSegmentPadPopoverOpen(root, false, s);
      if (segRow) {
        segRow.classList.add("hidden");
        segRow.hidden = true;
      }
      const chainRow = root.querySelector("#wledChainTripleRow");
      const chainHint = root.querySelector("#wledChainTripleHint");
      if (chainRow) {
        chainRow.classList.remove("hidden");
        chainRow.hidden = false;
      }
      if (chainHint) {
        chainHint.textContent = lang === "en"
          ? "Exactly three hits for one visit (any order). Example: three numbers 1 20 5 as singles, or full segment tokens. Fires after the 3rd dart of the visit."
          : "Genau drei Treffer einer Aufnahme (beliebige Reihenfolge), z.B. drei Zahlen 1 20 5 als Singles oder volle Segment-Tokens. Ausloesung nach dem 3. Dart des Visits.";
      }
      if (pfRow) {
        pfRow.classList.add("hidden");
        pfRow.hidden = true;
      }
      const pfiC = root.querySelector("#wledPlayerFilterInput");
      if (pfiC) pfiC.value = "";
      const altRowC = root.querySelector("#wledAlternateLogicRow");
      if (altRowC) {
        altRowC.classList.add("hidden");
        altRowC.hidden = true;
      }
      setWledSegmentField(root, "");
      return;
    }

    if (sel === WLED_PAD_PLAYER_ALTERNATE) {
      setWledSegmentPadPopoverOpen(root, false, s);
      if (segRow) {
        segRow.classList.add("hidden");
        segRow.hidden = true;
      }
      const chainRowAlt = root.querySelector("#wledChainTripleRow");
      if (chainRowAlt) {
        chainRowAlt.classList.add("hidden");
        chainRowAlt.hidden = true;
      }
      if (pfRow) {
        pfRow.classList.add("hidden");
        pfRow.hidden = true;
      }
      const pfiAlt = root.querySelector("#wledPlayerFilterInput");
      if (pfiAlt) pfiAlt.value = "";
      const altRow = root.querySelector("#wledAlternateLogicRow");
      const altHint = root.querySelector("#wledAlternateLogicHint");
      if (altRow) {
        altRow.classList.remove("hidden");
        altRow.hidden = false;
      }
      if (altHint) {
        altHint.textContent = lang === "en"
          ? "Exactly two presets required (1st = first visit after each leg start, 2nd = next player, then alternating). Only runs when the match has two participants; not during bull-off."
          : "Es muessen genau zwei Presets gewaehlt sein (1. = erster Zug nach Leggewinn/Spielstart, 2. = naechster Spieler, danach im Wechsel). Nur bei zwei Teilnehmern; nicht im Bull-Off.";
      }
      setWledSegmentField(root, "");
      return;
    }

    const altRowHide = root.querySelector("#wledAlternateLogicRow");
    if (altRowHide) {
      altRowHide.classList.add("hidden");
      altRowHide.hidden = true;
    }

    if (pfRow) {
      pfRow.classList.add("hidden");
      pfRow.hidden = true;
    }
    const pfi = root.querySelector("#wledPlayerFilterInput");
    if (pfi) pfi.value = "";

    if (WLED_PAD_SEGMENT_SELECTS.has(sel)) {
      const chainRowSeg = root.querySelector("#wledChainTripleRow");
      if (chainRowSeg) {
        chainRowSeg.classList.add("hidden");
        chainRowSeg.hidden = true;
      }
      if (segRow) {
        segRow.classList.remove("hidden");
        segRow.hidden = false;
      }
      wledUiState.wledPadMult = "t";
      setWledSegmentField(root, "");
      syncWledPadMultUi(root);
      setWledSegmentPadPopoverOpen(root, false, s);
      if (hintSeg) {
        if (sel === WLED_PAD_LEG) {
          hintSeg.textContent = lang === "en"
            ? "Last dart for leg win — type a key or open the keypad (button)."
            : "Letzter Treffer beim Leggewinn — eintippen oder Tastenfeld ueber den Button oeffnen.";
        } else {
          hintSeg.textContent = lang === "en"
            ? "Throw segment (worker log). Open keypad for S / D / T, numbers, Miss (no score), Outside, DBull."
            : "Wurf-Segment wie im Log. Tastenfeld: S / D / T, Zahlen, Miss (kein Treffer), Outside, DBull.";
        }
      }
      return;
    }

    setWledSegmentPadPopoverOpen(root, false, s);
    if (segRow) {
      segRow.classList.add("hidden");
      segRow.hidden = true;
    }
    const chainRowEnd = root.querySelector("#wledChainTripleRow");
    if (chainRowEnd) {
      chainRowEnd.classList.add("hidden");
      chainRowEnd.hidden = true;
    }
    setWledSegmentField(root, "");
  }

  function applyPadNumber(root, n) {
    const mult = getEffectivePadMult(root);
    const sel = getWledSelectMode(root);
    let tok = "";
    if (n === 25) {
      if (mult === "s") tok = "s25";
      else if (mult === "d") tok = "bull";
      else tok = "t25";
    } else {
      tok = `${mult}${n}`;
    }
    setWledSegmentField(root, tok);
  }

  function applyPadSpecial(root, kind) {
    const sel = getWledSelectMode(root);
    if (!WLED_PAD_SEGMENT_SELECTS.has(sel)) return;
    const k = String(kind || "").toLowerCase();
    let tok = "outside";
    if (k === "miss") tok = "outside";
    else if (k === "dbull") tok = "dbull";
    else if (k === "bull") tok = "bull";
    setWledSegmentField(root, tok);
  }

  function parseChainTripleFromForm(root) {
    const raw = String(root.querySelector("#wledChainTripleInput")?.value || "").trim();
    if (!raw) return { ok: false };
    const parts = raw.split(/[\s,;+]+/).map((x) => x.trim()).filter(Boolean);
    if (parts.length !== 3) return { ok: false };
    const out = [];
    for (const p0 of parts) {
      if (/^\d+$/.test(p0)) {
        const n = parseInt(p0, 10);
        if (!Number.isFinite(n) || n < 1 || (n > 20 && n !== 25)) return { ok: false };
        if (n === 25) out.push("s25");
        else out.push(`s${n}`);
        continue;
      }
      const p = normalizeSegmentToken(p0);
      if (!isValidThrowSegment(p)) return { ok: false };
      out.push(p);
    }
    if (out.length !== 3) return { ok: false };
    return { ok: true, triple: out };
  }

  function composeWledEffectFromForm(root) {
    const sel = getWledSelectMode(root);
    if (!sel) return { ok: false, code: "no_trigger" };

    if (sel === WLED_PAD_PLAYER) {
      const pf = String(root.querySelector("#wledPlayerFilterInput")?.value || "").trim();
      if (!pf) return { ok: false, code: "player_empty" };
      return { ok: true, trigger: "player_turn", playerFilter: pf };
    }

    if (sel === WLED_PAD_PLAYER_ALTERNATE) {
      return { ok: true, trigger: "player_turn_alternate", playerFilter: "" };
    }

    if (sel === WLED_PAD_CHAIN) {
      const parsed = parseChainTripleFromForm(root);
      if (!parsed.ok) return { ok: false, code: "chain_bad" };
      return { ok: true, trigger: "chain_visit", playerFilter: "", chainTriple: parsed.triple };
    }

    if (WLED_PAD_SEGMENT_SELECTS.has(sel)) {
      const raw = normalizeSegmentToken(root.querySelector("#wledSegmentField")?.value || "");
      if (!raw) return { ok: false, code: "segment_empty" };
      if (sel === WLED_PAD_LEG) {
        if (!isValidLegSuffix(raw)) return { ok: false, code: "segment_bad" };
        return { ok: true, trigger: `gameshot+${raw}`, playerFilter: "" };
      }
      if (raw === "outside" || raw === "bull" || raw === "dbull") {
        return { ok: true, trigger: raw, playerFilter: "" };
      }
      if (!isValidThrowSegment(raw)) return { ok: false, code: "segment_bad" };
      return { ok: true, trigger: raw, playerFilter: "" };
    }

    return { ok: true, trigger: sel, playerFilter: "" };
  }

  function getEffectTriggerSummary(item, settings) {
    const t = normalizeConfiguredTrigger(item.trigger);
    const pf = String(item.playerFilter || "").trim();
    if (t === "player_turn_alternate") {
      const lang = getLang(settings);
      return lang === "en"
        ? "2 players: presets alternate each visit; after a leg starts with preset 1"
        : "2 Spieler: Presets wechseln pro Zug; nach Leggewinn mit Preset 1";
    }
    if (t === "chain_visit" && Array.isArray(item.chainTriple) && item.chainTriple.length === 3) {
      const lang = getLang(settings);
      const s = item.chainTriple.map((x) => String(x || "").toUpperCase()).join(" ");
      return lang === "en"
        ? `Hit chain ${s} (visit, any order)`
        : `Trefferkette ${s} (Aufnahme, Reihenfolge egal)`;
    }
    const turnNameFilter = t === "player_turn" || (t === "throw" && pf);
    if (turnNameFilter && pf) {
      const lang = getLang(settings);
      return lang === "en"
        ? `Player name contains „${pf}“ (once per visit)`
        : `Spielername enthaelt „${pf}“ (einmal pro Aufnahme)`;
    }
    return getTriggerLabel(item.trigger, settings);
  }

  function renderWledPadNumberGrid() {
    let html = "";
    for (let n = 1; n <= 20; n += 1) {
      html += `<button type="button" class="btn wledPadNumBtn" data-wled-pad-num="${n}">${n}</button>`;
    }
    return html;
  }

  function formatWledPresetLineForLog(targets) {
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

  function renderTriggerDropdownOptions(settings) {
    const lang = getLang(settings);
    return WLED_TRIGGER_GROUPS.map((group) => `
      <optgroup label="${lang === "en" ? group.en : group.de}">
        ${group.values.map((value) => {
          const hint = getTriggerOptionHint(value, settings);
          const titleAttr = hint ? ` title="${escapeWledAttr(hint)}"` : "";
          return `
          <option value="${escapeWledAttr(value)}"${titleAttr}>${getTriggerLabel(value, settings)}</option>`;
        }).join("")}
      </optgroup>
    `).join("");
  }

  function formatPresetName(item) {
    return item.presetName ? item.presetName : `Preset ${item.presetId}`;
  }

  function formatPresetSelectionLabel(settings, selectedTargets) {
    const lang = getLang(settings);
    if (!selectedTargets.length) return lang === "en" ? "Choose presets" : "Presets auswaehlen";
    if (selectedTargets.length === 1) {
      const target = selectedTargets[0];
      return `${target.presetName || `Preset ${target.presetId}`} | W ${target.controllerName}`;
    }
    return lang === "en"
      ? `${selectedTargets.length} presets selected`
      : `${selectedTargets.length} Presets ausgewaehlt`;
  }

  function renderPresetPicker(settings, selectedTargets = []) {
    const selectedSet = new Set(selectedTargets.map((item) => `${item.controllerId}::${item.presetId}`));
    const allLoaded = getAllLoadedPresets(settings);
    if (!allLoaded.length) {
      return `<div class="hint" style="margin-top:0;">${getLang(settings) === "en" ? "Load presets from one or more controllers first." : "Lade zuerst Presets von einem oder mehreren Controllern."}</div>`;
    }
    return `
      <div class="presetDropdown" data-wled-preset-dropdown="true">
        <input id="wledSelectedPresetTargets" type="hidden" value='${JSON.stringify(selectedTargets)}' />
        <div class="presetSelectedList">
          ${selectedTargets.length ? selectedTargets.map((target) => `
            <button
              type="button"
              class="presetSelectedChip"
              data-wled-remove-selected="${target.controllerId}::${target.presetId}"
            >
              <span class="presetSelectedChipText">
                <span class="presetSelectedChipTitle">${target.presetName || `Preset ${target.presetId}`}</span>
                <span class="presetSelectedChipSub">${target.controllerName}</span>
              </span>
              <span class="presetSelectedChipClose">X</span>
            </button>
          `).join("") : `<div class="hint" style="margin-top:0;">${getLang(settings) === "en" ? "No presets selected yet." : "Noch keine Presets ausgewaehlt."}</div>`}
        </div>
        <button
          type="button"
          class="input presetDropdownBtn"
          id="wledPresetDropdownBtn"
          aria-expanded="${wledUiState.presetDropdownOpen ? "true" : "false"}"
        >
          <span class="presetDropdownValue">${formatPresetSelectionLabel(settings, selectedTargets)}</span>
          <span class="presetDropdownArrow">${wledUiState.presetDropdownOpen ? "^" : "v"}</span>
        </button>
        <div class="presetDropdownMenu${wledUiState.presetDropdownOpen ? " open" : ""}">
          <div class="list" style="margin-top:0;">
            ${allLoaded.map((item) => {
              const key = `${item.controllerId}::${item.presetId}`;
              return `
                <button
                  type="button"
                  class="listItem presetOptionBtn${selectedSet.has(key) ? " active" : ""}"
                  data-wled-preset-option="true"
                  data-wled-preset-controller="${item.controllerId}"
                  data-wled-preset-id="${item.presetId}"
                >
                  <div class="liText">
                    <div class="liTitle">${formatPresetName(item)}</div>
                    <div class="liSub">${item.controllerLabel}</div>
                  </div>
                </button>
              `;
            }).join("")}
          </div>
        </div>
      </div>
    `;
  }

  function escapeWledAttr(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderControllers(settings) {
    const lang = getLang(settings);
    const controllers = getControllers(settings);
    return controllers.map((controller, index) => {
      const collapsed = isControllerCollapsed(controller.id);
      const title = escapeWledAttr(getControllerLabel(controller, settings, index));
      const namePh = lang === "en" ? "Optional display name" : "Optionaler Anzeigename";
      const endpointPh = "http://192.168.178.50";
      const nameLbl = lang === "en" ? "Display name" : "Anzeigename";
      const endpointLbl = lang === "en" ? "IP / HTTP endpoint" : "IP / HTTP-Endpoint";
      const hintEndpoint = lang === "en"
        ? "WLED IP or full HTTP endpoint."
        : "WLED IP oder kompletter HTTP-Endpoint.";
      const dd = collapsed ? "v" : "^";
      return `
      ${index > 0 ? '<div class="divider"></div>' : ""}
      <div class="wledSettingsControllerBlock" data-wled-settings-controller="${controller.id}">
        <div class="sectionHead" style="margin-top:${index === 0 ? "0" : "10px"};">
          <div class="sectionTitle" style="margin:0;">${title}</div>
          <button
            type="button"
            class="miniChevronBtn${collapsed ? "" : " active"}"
            data-wled-toggle-controller="${controller.id}"
            aria-expanded="${collapsed ? "false" : "true"}"
            aria-label="${lang === "en" ? "Toggle details" : "Details ein-/ausklappen"}"
            title="${lang === "en" ? "Details" : "Details"}"
          ><span class="ddArrow">${dd}</span></button>
        </div>
        <div class="connectionStatusGrid compactSingle" style="margin-top:8px;" data-connections-open="true">
          <button
            type="button"
            class="connectionStatusBtn disconnected"
            data-wled-controller-connection="${controller.id}"
          >
            <div class="connectionStatusLabel">
              <span>WLED</span>
              <span class="connectionStatusText" data-wled-connection-line></span>
            </div>
          </button>
        </div>
        <div class="inlinePopupWrap${collapsed ? "" : " open"}" data-wled-controller-panel="${controller.id}" style="padding:0;border-top:none;background:transparent;">
          <div class="formRow" style="margin-top:12px;">
            <div class="connectionInputHeader">
              <label class="label" for="wledControllerName_${controller.id}">${nameLbl}</label>
            </div>
            <input class="input" id="wledControllerName_${controller.id}" data-wled-controller-name="${controller.id}" type="text" placeholder="${escapeWledAttr(namePh)}" value="${escapeWledAttr(controller.name)}" />
          </div>
          <div class="formRow">
            <div class="connectionInputHeader">
              <label class="label" for="wledControllerEndpoint_${controller.id}">${endpointLbl}</label>
            </div>
            <input class="input" id="wledControllerEndpoint_${controller.id}" data-wled-controller-endpoint="${controller.id}" type="text" placeholder="${endpointPh}" value="${escapeWledAttr(controller.endpoint)}" />
            <div class="hint">${hintEndpoint}</div>
          </div>
          <div class="inlineActionsRow" style="margin-top:12px;">
            <button type="button" class="btnPrimary" data-wled-load-presets="${controller.id}">${lang === "en" ? "Load presets" : "Presets laden"}</button>
            ${index > 0 ? `<button type="button" class="customThemeDelete" data-wled-remove-controller="${controller.id}" title="${lang === "en" ? "Remove controller" : "Controller entfernen"}">X</button>` : ""}
          </div>
          <div class="hint" style="margin-top:8px;" data-wled-status="${controller.id}">${wledUiState.statusByControllerId[controller.id] || ""}</div>
        </div>
      </div>
    `;
    }).join("");
  }

  function renderTargetSummary(item, settings) {
    const parts = [];
    if (item.presetTargets.length) {
      parts.push(item.presetTargets.map((target) => `${target.controllerName} | ${target.presetId}${target.presetName ? ` - ${target.presetName}` : ""}`).join(" | "));
    }
    if (item.advancedJson) {
      parts.push("Advanced Json");
    }
    return parts.join(" | ");
  }

  function getEndpointForControllerId(settings, controllerId) {
    const ctrls = getControllers(settings || {});
    const id = String(controllerId || "").trim() || String(ctrls[0]?.id || "").trim();
    const c = ctrls.find((x) => x.id === id);
    return String(c?.endpoint || "").trim();
  }

  function syncWledFoldUi(root, which) {
    const apply = (foldKey, panelId, collapsed) => {
      const btn = root.querySelector(`[data-wled-fold="${foldKey}"]`);
      const panel = root.querySelector(`#${panelId}`);
      if (!btn || !panel) return;
      btn.setAttribute("aria-expanded", collapsed ? "false" : "true");
      const ar = btn.querySelector(".wledFoldChev");
      if (ar) ar.textContent = collapsed ? "v" : "^";
      panel.classList.toggle("hidden", collapsed);
      panel.hidden = !!collapsed;
    };
    if (which === "all" || which === "matrix") {
      apply("matrix", "wledMatrixCollapsible", wledUiState.matrixSectionCollapsed === true);
    }
    if (which === "all" || which === "effects") {
      apply("effects", "wledEffectsCollapsible", wledUiState.effectsSectionCollapsed === true);
    }
    if (which === "all" || which === "test") {
      apply("test", "wledTestCollapsible", wledUiState.testSectionCollapsed === true);
    }
  }

  function setWledTestOutput(root, text) {
    const el = root.querySelector("#wledTestOutput");
    if (el != null) el.textContent = text == null ? "" : String(text);
  }

  function getWledTestPlayerIndex(root) {
    const a = root.querySelector(".wledTestPlayerBtn.active");
    return Number(a?.dataset?.wledTestPlayer) === 1 ? 1 : 0;
  }

  function renderWledMatrixControllerOptions(settings, selectedId) {
    const ctrls = getControllers(settings || {});
    const sel = String(selectedId || "").trim();
    const lang = getLang(settings || {});
    const defLab = lang === "en" ? "(default order)" : "(Reihenfolge Standard)";
    const opts = [`<option value="">${escapeWledAttr(defLab)}</option>`];
    for (const c of ctrls) {
      const id = escapeWledAttr(c.id);
      const lab = escapeWledAttr(c.name || c.id);
      opts.push(`<option value="${id}"${sel === c.id ? " selected" : ""}>${lab}</option>`);
    }
    return opts.join("");
  }

  function renderWledMatrixSection(settings) {
    const s = settings || {};
    const modeWled = String(s.wledMatrixOutput || "pixelit").toLowerCase() === "wled_leds";
    const u0 = escapeWledAttr(String(s.wledMatrixPlayer0Url || ""));
    const u1 = escapeWledAttr(String(s.wledMatrixPlayer1Url || ""));
    const sc = s.wledMatrixShowScores === true ? "checked" : "";
    const st = s.wledMatrixShowPlayerTurn === true ? "checked" : "";
    const minIv = Number(s.wledMatrixMinIntervalMs);
    const arIv = Number(s.wledMatrixArrowMs);
    const minVal = Number.isFinite(minIv) ? Math.trunc(minIv) : 400;
    const arVal = Number.isFinite(arIv) ? Math.trunc(arIv) : 600;
    const segId = Math.max(0, Math.min(31, Math.trunc(Number(s.wledMatrixWledSegmentId) || 0)));
    const mw = Math.max(1, Math.min(32, Math.trunc(Number(s.wledMatrixWledWidth) || 16)));
    const mh = Math.max(1, Math.min(32, Math.trunc(Number(s.wledMatrixWledHeight) || 16)));
    const serp = s.wledMatrixWledSerpentine === true ? "checked" : "";
    const fg = escapeWledAttr(String(s.wledMatrixWledFgHex || "#FFFFFF"));
    const ah = escapeWledAttr(String(s.wledMatrixWledArrowHex || "#00E5FF"));
    const optPix = !modeWled ? "selected" : "";
    const optWled = modeWled ? "selected" : "";
    const pixHidden = modeWled ? " class=\"hidden\" hidden" : "";
    const wledHidden = modeWled ? "" : " class=\"hidden\" hidden";
    return `
      <div class="hint" data-i18n="wled_matrix_intro_hint"></div>
      <div class="formRow" style="margin-top:12px;">
        <label class="label" for="wledMatrixOutput" data-i18n="wled_matrix_output_label">Ausgabe</label>
        <select class="input" id="wledMatrixOutput">
          <option value="pixelit" ${optPix} data-i18n="wled_matrix_output_pixelit">PixelIt (/api/screen)</option>
          <option value="wled_leds" ${optWled} data-i18n="wled_matrix_output_wled">WLED (JSON, Einzel-LEDs)</option>
        </select>
      </div>
      <div class="listToggle" style="margin-top:12px;">
        <div class="liText">
          <div class="liTitle" data-i18n="wled_matrix_show_scores">Punkte anzeigen</div>
          <div class="liSub" data-i18n="wled_matrix_show_scores_hint"></div>
        </div>
        <label class="switch">
          <input type="checkbox" id="wledMatrixShowScores" ${sc} />
          <span class="slider"></span>
        </label>
      </div>
      <div class="listToggle" style="margin-top:10px;">
        <div class="liText">
          <div class="liTitle" data-i18n="wled_matrix_show_turn">Zug-Anzeige (Pfeil)</div>
          <div class="liSub" data-i18n="wled_matrix_show_turn_hint"></div>
        </div>
        <label class="switch">
          <input type="checkbox" id="wledMatrixShowPlayerTurn" ${st} />
          <span class="slider"></span>
        </label>
      </div>
      <div id="wledMatrixPixelitFields"${pixHidden}>
        <div class="formRow" style="margin-top:12px;">
          <label class="label" for="wledMatrixPlayer0Url" data-i18n="wled_matrix_url_p1">Matrix Spieler 1 — Basis-URL</label>
          <input class="input" id="wledMatrixPlayer0Url" type="text" data-i18n-placeholder="wled_matrix_url_placeholder" placeholder="http://192.168.178.50" value="${u0}" autocomplete="off" />
        </div>
        <div class="formRow">
          <label class="label" for="wledMatrixPlayer1Url" data-i18n="wled_matrix_url_p2">Matrix Spieler 2 — Basis-URL</label>
          <input class="input" id="wledMatrixPlayer1Url" type="text" data-i18n-placeholder="wled_matrix_url_placeholder" placeholder="http://192.168.178.50" value="${u1}" autocomplete="off" />
        </div>
      </div>
      <div id="wledMatrixWledFields"${wledHidden}>
        <div class="formRow" style="margin-top:12px;">
          <label class="label" for="wledMatrixWledControllerId0" data-i18n="wled_matrix_wled_ctrl_p1">WLED Controller Spieler 1</label>
          <select class="input" id="wledMatrixWledControllerId0">${renderWledMatrixControllerOptions(s, s.wledMatrixWledControllerId0)}</select>
          <div class="hint" data-i18n="wled_matrix_wled_ctrl_hint"></div>
        </div>
        <div class="formRow">
          <label class="label" for="wledMatrixWledControllerId1" data-i18n="wled_matrix_wled_ctrl_p2">WLED Controller Spieler 2</label>
          <select class="input" id="wledMatrixWledControllerId1">${renderWledMatrixControllerOptions(s, s.wledMatrixWledControllerId1)}</select>
        </div>
        <div class="formRow">
          <label class="label" for="wledMatrixWledSegmentId" data-i18n="wled_matrix_wled_segment_label">Segment-ID (WLED)</label>
          <input class="input" id="wledMatrixWledSegmentId" type="number" min="0" max="31" step="1" value="${segId}" />
        </div>
        <div class="formRow">
          <label class="label" data-i18n="wled_matrix_wled_size_label">Matrix Breite x Hoehe</label>
          <div style="display:flex;gap:8px;align-items:center;">
            <input class="input" id="wledMatrixWledWidth" type="number" min="1" max="32" step="1" value="${mw}" style="flex:1;min-width:0;" />
            <span style="opacity:0.8;">×</span>
            <input class="input" id="wledMatrixWledHeight" type="number" min="1" max="32" step="1" value="${mh}" style="flex:1;min-width:0;" />
          </div>
        </div>
        <div class="listToggle" style="margin-top:8px;">
          <div class="liText">
            <div class="liTitle" data-i18n="wled_matrix_wled_serpentine_label">Serpentinen-Verkabelung</div>
          </div>
          <label class="switch">
            <input type="checkbox" id="wledMatrixWledSerpentine" ${serp} />
            <span class="slider"></span>
          </label>
        </div>
        <div class="formRow">
          <label class="label" for="wledMatrixWledFgHex" data-i18n="wled_matrix_wled_fg_label">Zahlen-Farbe (Hex)</label>
          <input class="input" id="wledMatrixWledFgHex" type="text" value="${fg}" autocomplete="off" />
        </div>
        <div class="formRow">
          <label class="label" for="wledMatrixWledArrowHex" data-i18n="wled_matrix_wled_arrow_label">Pfeil-Farbe (Hex)</label>
          <input class="input" id="wledMatrixWledArrowHex" type="text" value="${ah}" autocomplete="off" />
        </div>
      </div>
      <div class="formRow">
        <label class="label" for="wledMatrixMinIntervalMs" data-i18n="wled_matrix_min_interval_label">Min. Abstand je Matrix (ms)</label>
        <input class="input" id="wledMatrixMinIntervalMs" type="number" min="0" max="60000" step="50" value="${minVal}" />
        <div class="hint" data-i18n="wled_matrix_min_interval_hint"></div>
      </div>
      <div class="formRow">
        <label class="label" for="wledMatrixArrowMs" data-i18n="wled_matrix_arrow_ms_label">Pause Pfeil → Punkte (ms)</label>
        <input class="input" id="wledMatrixArrowMs" type="number" min="120" max="5000" step="50" value="${arVal}" />
        <div class="hint" data-i18n="wled_matrix_arrow_ms_hint"></div>
      </div>
    `;
  }

  function renderEffectList(settings) {
    const controllers = getControllers(settings);
    const items = parseWledEffects(settings?.wledEffectsJson, controllers);
    if (!items.length) {
      return `<div class="hint" style="margin-top:0;">${getLang(settings) === "en" ? "No WLED effects created yet." : "Noch keine WLED-Effekte angelegt."}</div>`;
    }
    return `
      <div class="list" style="margin-top:12px;">
        ${items.map((item) => `
          <div class="listToggle">
            <div class="liText">
              <div class="liTitle">${item.name}</div>
              <div class="liSub">${getEffectTriggerSummary(item, settings)} | ${renderTargetSummary(item, settings)}</div>
            </div>
            <div class="inlineActionsRow">
              <button type="button" class="btnPrimary" data-wled-test="${item.id}">Test</button>
              <label class="switch">
                <input type="checkbox" data-wled-toggle="${item.id}" ${item.enabled ? "checked" : ""} />
                <span class="slider"></span>
              </label>
              <button type="button" class="customThemeDelete" data-wled-delete="${item.id}" title="Effekt loeschen">X</button>
            </div>
          </div>
        `).join("")}
      </div>
    `;
  }

  function updateControllerStatus(root, controllerId, text) {
    void root;
    document.querySelectorAll(`[data-wled-status="${controllerId}"]`).forEach((el) => {
      el.textContent = text || "";
    });
  }

  function refreshPresetPicker(root, settings) {
    const mount = root.querySelector("#wledPresetPickerMount");
    if (!mount) return;
    const selectedTargets = getSelectedPresetTargets(root, settings);
    mount.innerHTML = renderPresetPicker(settings, selectedTargets);
  }

  function writeSelectedPresetTargets(root, targets) {
    const hidden = root.querySelector("#wledSelectedPresetTargets");
    if (hidden) hidden.value = JSON.stringify(targets || []);
  }

  async function saveControllers(api, controllers) {
    await api.savePartial({ wledControllersJson: JSON.stringify(controllers) });
  }

  async function loadPresetsForController(api, controllerId) {
    const root = api.root;
    const settings = api.getSettings?.() || {};
    const endpoint = String(document.querySelector(`[data-wled-controller-endpoint="${controllerId}"]`)?.value || "").trim();
    if (!endpoint) {
      wledUiState.presetsByControllerId[controllerId] = [];
      wledUiState.loadedEndpointByControllerId[controllerId] = "";
      wledUiState.statusByControllerId[controllerId] = "";
      updateControllerStatus(root, controllerId, "");
      afterWledPresetLoadUi(api, settings);
      return;
    }
    if (wledUiState.loadingByControllerId[controllerId]) return;
    wledUiState.loadingByControllerId[controllerId] = true;
    updateControllerStatus(root, controllerId, getLang(settings) === "en" ? "Loading presets..." : "Lade Presets...");
    try {
      const res = await api.send({ type: "GET_WLED_PRESETS", endpoint });
      if (!res?.ok) throw new Error(res?.error || "Preset load failed");
      wledUiState.presetsByControllerId[controllerId] = Array.isArray(res.presets) ? res.presets : [];
      wledUiState.loadedEndpointByControllerId[controllerId] = endpoint;
      const text = getLang(settings) === "en"
        ? `${wledUiState.presetsByControllerId[controllerId].length} presets loaded.`
        : `${wledUiState.presetsByControllerId[controllerId].length} Presets geladen.`;
      wledUiState.statusByControllerId[controllerId] = text;
      updateControllerStatus(root, controllerId, text);
      refreshPresetPicker(root, api.getSettings?.() || settings);
      afterWledPresetLoadUi(api, api.getSettings?.() || settings);
    } catch (e) {
      const text = getLang(settings) === "en"
        ? `Load failed: ${String(e?.message || e)}`
        : `Laden fehlgeschlagen: ${String(e?.message || e)}`;
      wledUiState.presetsByControllerId[controllerId] = [];
      wledUiState.loadedEndpointByControllerId[controllerId] = "";
      wledUiState.statusByControllerId[controllerId] = text;
      updateControllerStatus(root, controllerId, text);
      refreshPresetPicker(root, api.getSettings?.() || settings);
      afterWledPresetLoadUi(api, api.getSettings?.() || settings);
    } finally {
      wledUiState.loadingByControllerId[controllerId] = false;
    }
  }

  function paintWledControllerConnectionButtonsFromCache(api, settings) {
    const s = settings || {};
    const controllers = getControllers(s);
    const lang = getLang(s);
    for (const controller of controllers) {
      const id = controller.id;
      const ep = String(controller.endpoint || "").trim();
      if (!ep) {
        api.updateWledControllerConnectionBtnUi?.(id, false, lang === "en" ? "No endpoint" : "Kein Endpoint");
        continue;
      }
      const loaded = wledUiState.loadedEndpointByControllerId[id] === ep;
      const st = String(wledUiState.statusByControllerId[id] || "");
      if (!loaded) {
        api.updateWledControllerConnectionBtnUi?.(id, false, lang === "en" ? "Tap load" : "Presets laden");
        continue;
      }
      if (/fehl|failed/i.test(st)) {
        api.updateWledControllerConnectionBtnUi?.(id, false, lang === "en" ? "Offline" : "Offline");
        continue;
      }
      const cnt = (wledUiState.presetsByControllerId[id] || []).length;
      api.updateWledControllerConnectionBtnUi?.(id, true, lang === "en" ? `${cnt} presets` : `${cnt} Presets`);
    }
  }

  function refreshWledModuleStripFromCache(api, settings) {
    const s = settings || {};
    const lang = getLang(s);
    const withEp = getControllers(s).filter((c) => String(c.endpoint || "").trim());
    if (!withEp.length) {
      api.updateWledConnectionStripUi?.("disconnected", lang === "en" ? "No endpoint" : "Kein Endpoint");
      return;
    }
    const anyLoaded = withEp.some((c) => {
      const ep = String(c.endpoint).trim();
      return wledUiState.loadedEndpointByControllerId[c.id] === ep;
    });
    if (!anyLoaded) {
      api.updateWledConnectionStripUi?.(
        "disconnected",
        lang === "en" ? "Tap refresh (Presets)" : "Aktualisieren (Presets)"
      );
      return;
    }
    let okN = 0;
    let bad = 0;
    for (const c of withEp) {
      const ep = String(c.endpoint).trim();
      if (wledUiState.loadedEndpointByControllerId[c.id] !== ep) continue;
      const st = String(wledUiState.statusByControllerId[c.id] || "");
      if (/fehl|failed/i.test(st)) bad += 1;
      else okN += 1;
    }
    let state = "connecting";
    let detail = "";
    if (bad && !okN) {
      state = "disconnected";
      detail = lang === "en" ? "Unreachable" : "Nicht erreichbar";
    } else if (okN && !bad) {
      state = "connected";
      detail = lang === "en" ? "OK" : "OK";
    } else {
      state = "connecting";
      detail = lang === "en" ? `${okN}/${withEp.length} OK` : `${okN}/${withEp.length} OK`;
    }
    api.updateWledConnectionStripUi?.(state, detail);
  }

  function afterWledPresetLoadUi(api, settings) {
    const s = settings || api.getSettings?.() || {};
    paintWledControllerConnectionButtonsFromCache(api, s);
    refreshWledModuleStripFromCache(api, s);
  }

  /**
   * Controller-UI liegt in den Einstellungen (#settingsWledControllersMount), nicht im WLED-Modul-root —
   * daher Document-Delegation, sonst erreichen Klicks/Change den root-Listener nicht.
   */
  function wireSettingsWledControllerDelegation(scopeRef) {
    if (scopeRef.__admWledSettingsMountDocWired) return;
    scopeRef.__admWledSettingsMountDocWired = true;

    document.addEventListener("change", async (ev) => {
      const target = ev.target;
      if (!target?.closest?.("#settingsWledControllersMount")) return;
      if (!target.matches?.("[data-wled-controller-name], [data-wled-controller-endpoint]")) return;
      const api = scopeRef.ADM_MODULES?.wled?._delegateApi;
      if (!api) return;
      const settings = api.getSettings?.() || {};
      const controllers = getControllers(settings).map((item) => {
        if (item.id !== target.dataset.wledControllerName && item.id !== target.dataset.wledControllerEndpoint) return item;
        return {
          ...item,
          name: String(document.querySelector(`[data-wled-controller-name="${item.id}"]`)?.value || "").trim(),
          endpoint: String(document.querySelector(`[data-wled-controller-endpoint="${item.id}"]`)?.value || "").trim()
        };
      });
      await saveControllers(api, controllers);
    });

    document.addEventListener("click", async (ev) => {
      if (!ev.target?.closest?.("#settingsWledControllersMount")) return;
      const api = scopeRef.ADM_MODULES?.wled?._delegateApi;
      if (!api) return;

      const loadBtn = ev.target.closest?.("[data-wled-load-presets]");
      if (loadBtn) {
        await loadPresetsForController(api, String(loadBtn.dataset.wledLoadPresets || ""));
        return;
      }

      const collapseBtn = ev.target.closest?.("[data-wled-toggle-controller]");
      if (collapseBtn) {
        const controllerId = String(collapseBtn.dataset.wledToggleController || "");
        wledUiState.collapsedByControllerId[controllerId] = !isControllerCollapsed(controllerId);
        const settings = api.getSettings?.() || {};
        const controllerMount = document.querySelector("#settingsWledControllersMount");
        if (controllerMount) controllerMount.innerHTML = renderControllers(settings);
        return;
      }

      const removeBtn = ev.target.closest?.("[data-wled-remove-controller]");
      if (removeBtn) {
        const settings = api.getSettings?.() || {};
        const controllers = getControllers(settings);
        const removeId = String(removeBtn.dataset.wledRemoveController || "");
        const nextControllers = controllers.filter((item) => item.id !== removeId);
        const nextEffects = parseWledEffects(settings.wledEffectsJson, controllers)
          .map((item) => ({
            ...item,
            presetTargets: item.presetTargets.filter((target) => target.controllerId !== removeId)
          }))
          .filter((item) => item.presetTargets.length > 0);
        delete wledUiState.presetsByControllerId[removeId];
        delete wledUiState.statusByControllerId[removeId];
        await api.savePartial({
          wledControllersJson: JSON.stringify(nextControllers),
          wledEffectsJson: JSON.stringify(nextEffects)
        });
      }
    });
  }

  scope.ADM_MODULES.wled = {
    id: "wled",
    icon: "W",
    navLabelKey: "nav_wled",
    needs: { streamerbot: false, obs: false },
    render() {
      return `
        <h2 class="title" data-i18n="title_wled">WLED</h2>
        <div class="card" data-settings-nav-connections style="cursor:pointer;">
          <div class="sectionHead">
            <div class="sectionTitle" style="margin:0;" data-i18n="section_connections">Verbindungen</div>
          </div>
          <div class="connectionStatusBtn" data-wled-connection-strip style="width:100%;box-sizing:border-box;">
            <div class="connectionStatusLabel">
              <span>WLED</span>
              <span class="connectionStatusText" data-wled-strip-text></span>
            </div>
          </div>
          <div class="hint" style="margin-top:8px;" data-i18n="module_connections_tap_hint">Tippen, um die Verbindungen in den Einstellungen zu oeffnen.</div>
        </div>
        <div class="card">
          <button
            type="button"
            class="btnPrimary fullWidthBtn"
            style="display:flex;align-items:center;justify-content:space-between;gap:10px;text-align:left;box-sizing:border-box;"
            data-wled-fold="matrix"
            id="wledMatrixFoldBtn"
            aria-expanded="${wledUiState.matrixSectionCollapsed ? "false" : "true"}"
          >
            <span style="font-size:13px;font-weight:650;letter-spacing:0.01em;" data-i18n="wled_matrix_section_title">Matrizen</span>
            <span class="wledFoldChev">${wledUiState.matrixSectionCollapsed ? "v" : "^"}</span>
          </button>
          <div
            id="wledMatrixCollapsible"
            class="advancedJsonSectionBody${wledUiState.matrixSectionCollapsed ? " hidden" : ""}"
            ${wledUiState.matrixSectionCollapsed ? "hidden" : ""}
          >
            <div id="wledMatrixSectionMount"></div>
          </div>
        </div>
        <div class="card">
          <div class="sectionHead" style="margin:0;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <button
              type="button"
              class="btnPrimary"
              style="flex:1;min-width:0;margin:0;display:flex;align-items:center;justify-content:space-between;gap:10px;text-align:left;box-sizing:border-box;"
              data-wled-fold="effects"
              id="wledEffectsFoldBtn"
              aria-expanded="${wledUiState.effectsSectionCollapsed ? "false" : "true"}"
            >
              <span style="font-size:13px;font-weight:650;letter-spacing:0.01em;" data-i18n="wled_effects_fold_title">WLED Effekte</span>
              <span class="wledFoldChev">${wledUiState.effectsSectionCollapsed ? "v" : "^"}</span>
            </button>
            <button id="addWledEffectBtn" class="btnPrimary" type="button" style="flex:0 0 auto;">Hinzufügen</button>
          </div>
          <div
            id="wledEffectsCollapsible"
            class="advancedJsonSectionBody${wledUiState.effectsSectionCollapsed ? " hidden" : ""}"
            ${wledUiState.effectsSectionCollapsed ? "hidden" : ""}
          >
          <div class="hint">Lege mehrere Trigger an und waehle dafuer beliebig viele Presets aus allen geladenen Controllern.</div>
          <div class="formRow">
            <label class="label" for="wledEffectName">Name</label>
            <input class="input" id="wledEffectName" type="text" placeholder="z. B. 180 Ring" />
          </div>
          <div class="formRow">
            <label class="label" for="wledEffectTrigger">Trigger</label>
            <select class="input" id="wledEffectTrigger">
              <option value="">${getLang({ uiLanguage: "de" }) === "en" ? "Choose trigger" : "Trigger auswaehlen"}</option>
              ${renderTriggerDropdownOptions({ uiLanguage: "de" })}
            </select>
            <div class="hint">Waehle den Trigger aus, der den Effekt ausloesen soll.</div>
          </div>
          <div class="formRow hidden" id="wledSegmentPadRow" hidden>
            <label class="label" for="wledSegmentField">Feld / Treffer</label>
            <div class="wledSegmentFieldRow" style="display:flex;gap:8px;align-items:stretch;">
              <input class="input" id="wledSegmentField" type="text" autocomplete="off" placeholder="t20" style="flex:1;min-width:0;" />
              <button
                type="button"
                class="btn wledPadToggleBtn"
                id="wledSegmentPadToggle"
                aria-expanded="false"
                aria-controls="wledSegmentPadBody"
                aria-label="Tastenfeld oeffnen"
                title="Tastenfeld oeffnen"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <circle cx="6" cy="5" r="2"/><circle cx="12" cy="5" r="2"/><circle cx="18" cy="5" r="2"/>
                  <circle cx="6" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="18" cy="12" r="2"/>
                  <circle cx="6" cy="19" r="2"/><circle cx="12" cy="19" r="2"/><circle cx="18" cy="19" r="2"/>
                </svg>
              </button>
            </div>
            <div class="hint" id="wledSegmentPadHint"></div>
            <div id="wledSegmentPadBody" class="hidden wledPadPanel" hidden>
              <div class="wledPadMultStrip" id="wledPadMultRow">
                <button type="button" class="choiceBtn wledPadMultChip" data-wled-pad-mult="s" title="Single">S</button>
                <button type="button" class="choiceBtn wledPadMultChip" data-wled-pad-mult="d" title="Double">D</button>
                <button type="button" class="choiceBtn wledPadMultChip" data-wled-pad-mult="t" title="Triple">T</button>
              </div>
              <div class="wledPadNumGrid" style="display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:6px;margin-top:10px;">
                ${renderWledPadNumberGrid()}
              </div>
              <div class="wledPadSpecialRow" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:10px;">
                <button type="button" class="btn" data-wled-pad-twentyfive="1" title="Bull (25): S=s25, D=bull (Doppel-25), T=t25">Bull (25)</button>
                <button type="button" class="btn" data-wled-pad-special="miss" title="Miss / kein Treffer (Worker: outside)">Miss</button>
                <button type="button" class="btn" data-wled-pad-special="outside">Outside</button>
                <button type="button" class="btn" data-wled-pad-special="dbull" title="Double Bull (Innenbull)">DBull</button>
              </div>
            </div>
          </div>
          <div class="formRow hidden" id="wledPlayerFilterRow" hidden>
            <label class="label" for="wledPlayerFilterInput">Spielername (Filter)</label>
            <input class="input" id="wledPlayerFilterInput" type="text" placeholder="z. B. alex" autocomplete="off" />
            <div class="hint" id="wledPlayerFilterHint"></div>
          </div>
          <div class="formRow hidden" id="wledAlternateLogicRow" hidden>
            <div class="hint" id="wledAlternateLogicHint"></div>
          </div>
          <div class="formRow hidden" id="wledChainTripleRow" hidden>
            <label class="label" for="wledChainTripleInput">Trefferkette</label>
            <input class="input" id="wledChainTripleInput" type="text" autocomplete="off" placeholder="z.B. 1 20 5" />
            <div class="hint" id="wledChainTripleHint"></div>
          </div>
          <div class="formRow">
            <div class="connectionInputHeader" style="align-items:center;">
              <label class="label" style="margin:0;">Presets</label>
              <button type="button" class="btnPrimary" id="btnWledRefreshPresetsModule" data-i18n="wled_presets_refresh_btn">Aktualisieren</button>
            </div>
            <div id="wledPresetPickerMount"></div>
          </div>
          <div class="formRow" id="wledAdvancedJsonSectionMount">${renderAdvancedJsonSection({ uiLanguage: "de" })}</div>
          <div id="wledEffectsStatus" class="hint" style="margin-top:8px;"></div>
          <div id="wledEffectsListMount"></div>
          </div>
        </div>

        <div class="card">
          <button
            type="button"
            class="btnPrimary fullWidthBtn"
            style="display:flex;align-items:center;justify-content:space-between;gap:10px;text-align:left;box-sizing:border-box;"
            data-wled-fold="test"
            id="wledTestFoldBtn"
            aria-expanded="${wledUiState.testSectionCollapsed ? "false" : "true"}"
          >
            <span style="font-size:13px;font-weight:650;letter-spacing:0.01em;" data-i18n="wled_test_section_title">Test</span>
            <span class="wledFoldChev">${wledUiState.testSectionCollapsed ? "v" : "^"}</span>
          </button>
          <div
            id="wledTestCollapsible"
            class="advancedJsonSectionBody${wledUiState.testSectionCollapsed ? " hidden" : ""}"
            ${wledUiState.testSectionCollapsed ? "hidden" : ""}
          >
            <div class="hint" style="margin-bottom:10px;" data-i18n="wled_test_section_hint"></div>
            <div class="formRow">
              <label class="label" for="wledTestControllerSelect" data-i18n="wled_test_controller_label">Controller</label>
              <select class="input" id="wledTestControllerSelect"></select>
            </div>
            <div class="inlineActionsRow" style="margin-top:10px;flex-wrap:wrap;">
              <button type="button" class="btnPrimary" id="btnWledTestJsonState" data-i18n="wled_test_ping_json">GET /json/state</button>
              <button type="button" class="btnPrimary" id="btnWledTestPreset" data-i18n="wled_test_send_preset">Preset senden</button>
            </div>
            <div class="formRow" style="margin-top:10px;">
              <label class="label" for="wledTestPresetId" data-i18n="wled_test_preset_id_label">Preset-ID</label>
              <input class="input" id="wledTestPresetId" type="number" min="1" max="250" step="1" value="1" />
            </div>
            <div class="formRow" style="margin-top:10px;">
              <label class="label" data-i18n="wled_test_matrix_player_label">Matrix-Test Spieler</label>
              <div class="choiceRow" style="margin-top:6px;">
                <button type="button" class="choiceBtn wledTestPlayerBtn active" data-wled-test-player="0">P1</button>
                <button type="button" class="choiceBtn wledTestPlayerBtn" data-wled-test-player="1">P2</button>
              </div>
            </div>
            <div class="formRow">
              <label class="label" for="wledTestMatrixScore" data-i18n="wled_test_matrix_score_label">Test-Punktezahl</label>
              <input class="input" id="wledTestMatrixScore" type="text" inputmode="numeric" maxlength="3" value="180" autocomplete="off" />
            </div>
            <div class="inlineActionsRow" style="margin-top:10px;flex-wrap:wrap;">
              <button type="button" class="btnPrimary" id="btnWledTestMatrixDigits" data-i18n="wled_test_matrix_digits">Matrix Zahl</button>
              <button type="button" class="btnPrimary" id="btnWledTestMatrixArrow" data-i18n="wled_test_matrix_arrow">Matrix Pfeil</button>
            </div>
            <pre id="wledTestOutput" class="hint wledTestOutputBox"></pre>
          </div>
        </div>

        <div class="spacer"></div>
      `;
    },
    bind(api) {
      const root = api.root;
      scope.ADM_MODULES.wled._delegateApi = api;
      wireSettingsWledControllerDelegation(scope);
      if (!root.__admWledMatrixUiWired) {
        root.__admWledMatrixUiWired = true;
        const persistWledMatrix = async () => {
          await api.savePartial({
            wledMatrixOutput: String(root.querySelector("#wledMatrixOutput")?.value || "pixelit").trim() === "wled_leds"
              ? "wled_leds"
              : "pixelit",
            wledMatrixShowScores: !!root.querySelector("#wledMatrixShowScores")?.checked,
            wledMatrixShowPlayerTurn: !!root.querySelector("#wledMatrixShowPlayerTurn")?.checked,
            wledMatrixPlayer0Url: String(root.querySelector("#wledMatrixPlayer0Url")?.value || "").trim(),
            wledMatrixPlayer1Url: String(root.querySelector("#wledMatrixPlayer1Url")?.value || "").trim(),
            wledMatrixWledControllerId0: String(root.querySelector("#wledMatrixWledControllerId0")?.value || "").trim(),
            wledMatrixWledControllerId1: String(root.querySelector("#wledMatrixWledControllerId1")?.value || "").trim(),
            wledMatrixWledSegmentId: Math.max(0, Math.min(31, Math.trunc(Number(root.querySelector("#wledMatrixWledSegmentId")?.value) || 0))),
            wledMatrixWledWidth: Math.max(1, Math.min(32, Math.trunc(Number(root.querySelector("#wledMatrixWledWidth")?.value) || 16))),
            wledMatrixWledHeight: Math.max(1, Math.min(32, Math.trunc(Number(root.querySelector("#wledMatrixWledHeight")?.value) || 16))),
            wledMatrixWledSerpentine: !!root.querySelector("#wledMatrixWledSerpentine")?.checked,
            wledMatrixWledFgHex: String(root.querySelector("#wledMatrixWledFgHex")?.value || "#FFFFFF").trim(),
            wledMatrixWledArrowHex: String(root.querySelector("#wledMatrixWledArrowHex")?.value || "#00E5FF").trim(),
            wledMatrixMinIntervalMs: Math.max(
              0,
              Math.min(60000, Math.trunc(Number(root.querySelector("#wledMatrixMinIntervalMs")?.value) || 400))
            ),
            wledMatrixArrowMs: Math.max(
              120,
              Math.min(5000, Math.trunc(Number(root.querySelector("#wledMatrixArrowMs")?.value) || 600))
            )
          });
        };
        root.addEventListener("change", (ev) => {
          if (!ev.target?.closest?.("#wledMatrixSectionMount")) return;
          void persistWledMatrix();
        });
        root.addEventListener(
          "blur",
          (ev) => {
            if (!ev.target?.closest?.("#wledMatrixSectionMount")) return;
            void persistWledMatrix();
          },
          true
        );
      }
      onWledTriggerSelectChange(root, api.getSettings?.() || {});
      syncWledPadMultUi(root);

      root.querySelector("#btnWledRefreshPresetsModule")?.addEventListener("click", async () => {
        const settings = api.getSettings?.() || {};
        const controllers = getControllers(settings);
        for (const c of controllers) {
          await loadPresetsForController(api, c.id);
        }
        afterWledPresetLoadUi(api, api.getSettings?.() || settings);
      });

      root.addEventListener("input", (ev) => {
        const target = ev.target;
        if (target?.matches?.("#wledAdvancedJson")) {
          wledUiState.advancedJsonDraft = String(target.value || "");
          return;
        }
        if (!target?.matches?.("#wledAdvancedJsonHue")) return;
        const hue = clampHue(target.value);
        wledUiState.advancedJsonHelperHue = hue;
        target.style.setProperty("--hue", String(hue));
        const preview = root.querySelector(".advancedJsonColorPreview");
        if (preview) preview.style.background = `hsl(${hue} 88% 50%)`;
      });

      root.querySelector("#addWledEffectBtn")?.addEventListener("click", async () => {
        const settings = api.getSettings?.() || {};
        const controllers = getControllers(settings);
        const lang = getLang(settings);
        const statusEl = root.querySelector("#wledEffectsStatus");
        const name = String(root.querySelector("#wledEffectName")?.value || "").trim();
        const composed = composeWledEffectFromForm(root);
        const advancedJson = String(root.querySelector("#wledAdvancedJson")?.value || wledUiState.advancedJsonDraft || "").trim();
        const presetTargets = getSelectedPresetTargets(root, settings);
        if (!composed.ok) {
          const msg = {
            no_trigger: lang === "en" ? "Please choose a trigger." : "Bitte einen Trigger auswaehlen.",
            player_empty: lang === "en"
              ? "Enter part of the player name (name filter is required)."
              : "Bitte einen Teil des Spielernamens eintragen (Namensfilter ist Pflicht).",
            segment_empty: lang === "en" ? "Enter or pick a segment (e.g. t20)." : "Segment eintragen oder ueber die Feld-Tasten waehlen (z.B. t20).",
            segment_bad: lang === "en" ? "Invalid segment. Examples: t20, d16, s5, bull, outside." : "Ungueltiges Segment. Beispiele: t20, d16, s5, bull, outside.",
            chain_bad: lang === "en"
              ? "Hit chain: enter exactly three hits (e.g. three numbers 1 20 5 as singles, or three segment tokens)."
              : "Trefferkette: genau drei Treffer eintragen (z.B. drei Zahlen 1 20 5 als Singles oder drei Segment-Tokens)."
          };
          if (statusEl) statusEl.textContent = msg[composed.code] || (lang === "en" ? "Check trigger and fields." : "Trigger und Felder pruefen.");
          return;
        }
        const { trigger, playerFilter, chainTriple } = composed;
        if (!name || !trigger || (!presetTargets.length && !advancedJson)) {
          if (statusEl) statusEl.textContent = lang === "en"
            ? "Please enter a name, trigger and choose presets or Advanced Json."
            : "Bitte Name, Trigger und Presets oder Advanced Json auswaehlen.";
          return;
        }
        if (advancedJson) {
          try {
            JSON.parse(advancedJson);
          } catch (e) {
            if (statusEl) statusEl.textContent = lang === "en"
              ? `Advanced Json invalid: ${String(e?.message || e)}`
              : `Advanced Json ungueltig: ${String(e?.message || e)}`;
            return;
          }
        }
        if (advancedJson && !presetTargets.length) {
          if (statusEl) statusEl.textContent = lang === "en"
            ? "Please select at least one preset so the target controller is known."
            : "Bitte mindestens ein Preset waehlen, damit der Ziel-Controller bekannt ist.";
          return;
        }
        const trigNorm = normalizeConfiguredTrigger(trigger);
        if (trigNorm === "player_turn_alternate" && presetTargets.length !== 2) {
          if (statusEl) statusEl.textContent = lang === "en"
            ? "Player (alternate): select exactly two presets (order = A then B)."
            : "Spieler (Wechsel-Logik): genau zwei Presets waehlen (Reihenfolge = A dann B).";
          return;
        }
        const newRow = {
          id: `wled_${Date.now()}_${Math.floor(Math.random() * 9999)}`,
          name,
          trigger,
          presetTargets,
          advancedJson,
          playerFilter: String(playerFilter || "").trim()
        };
        if (trigNorm === "chain_visit" && Array.isArray(chainTriple) && chainTriple.length === 3) {
          newRow.chainTriple = chainTriple;
        }
        const nextEffects = parseWledEffects(settings.wledEffectsJson, controllers).concat([newRow]);
        await api.savePartial({ wledEffectsJson: JSON.stringify(nextEffects) });
        const nameInput = root.querySelector("#wledEffectName");
        if (nameInput) nameInput.value = "";
        const pfi = root.querySelector("#wledPlayerFilterInput");
        if (pfi) pfi.value = "";
        const chainIn = root.querySelector("#wledChainTripleInput");
        if (chainIn) chainIn.value = "";
        setWledSegmentField(root, "");
        const triggerInput = root.querySelector("#wledEffectTrigger");
        if (triggerInput) triggerInput.value = "";
        onWledTriggerSelectChange(root, api.getSettings?.() || settings);
        syncWledPadMultUi(root);
        const advancedJsonInput = root.querySelector("#wledAdvancedJson");
        if (advancedJsonInput) advancedJsonInput.value = "";
        wledUiState.advancedJsonDraft = "";
        writeSelectedPresetTargets(root, []);
        wledUiState.presetDropdownOpen = false;
        refreshPresetPicker(root, api.getSettings?.() || settings);
        if (statusEl) statusEl.textContent = lang === "en" ? "WLED effect added." : "WLED Effekt hinzugefuegt.";
      });

      root.addEventListener("change", (ev) => {
        const target = ev.target;
        if (target?.matches?.("#wledEffectTrigger")) {
          onWledTriggerSelectChange(root, api.getSettings?.() || {});
          syncWledPadMultUi(root);
        }
      });

      root.addEventListener("change", async (ev) => {
        const target = ev.target;
        if (target?.matches?.("[data-wled-toggle]")) {
          const settings = api.getSettings?.() || {};
          const controllers = getControllers(settings);
          const id = String(target.dataset.wledToggle || "");
          const nextEffects = parseWledEffects(settings.wledEffectsJson, controllers).map((item) => (
            item.id === id ? { ...item, enabled: !!target.checked } : item
          ));
          await api.savePartial({ wledEffectsJson: JSON.stringify(nextEffects) });
          return;
        }

      });

      if (!root.__admWledTestUiWired) {
        root.__admWledTestUiWired = true;
        root.querySelector("#btnWledTestJsonState")?.addEventListener("click", async () => {
          const settings = api.getSettings?.() || {};
          const lang = getLang(settings);
          const cid = String(root.querySelector("#wledTestControllerSelect")?.value || "").trim();
          const ep = getEndpointForControllerId(settings, cid);
          if (!ep) {
            setWledTestOutput(root, lang === "en" ? "No controller endpoint (check Connections)." : "Kein Controller-Endpoint (Verbindungen pruefen).");
            return;
          }
          try {
            const res = await api.send({ type: "WLED_TEST_JSON_STATE", endpoint: ep });
            if (res == null) {
              setWledTestOutput(
                root,
                lang === "en"
                  ? "No response from the extension background (reload the extension or check the service worker)."
                  : "Keine Antwort vom Extension-Hintergrund (Extension neu laden oder Service Worker pruefen)."
              );
              return;
            }
            setWledTestOutput(root, JSON.stringify(res, null, 2));
          } catch (e) {
            setWledTestOutput(root, String(e?.message || e));
          }
        });
        root.querySelector("#btnWledTestPreset")?.addEventListener("click", async () => {
          const settings = api.getSettings?.() || {};
          const lang = getLang(settings);
          const cid = String(root.querySelector("#wledTestControllerSelect")?.value || "").trim();
          const ep = getEndpointForControllerId(settings, cid);
          const pid = Math.max(1, Math.min(250, Math.trunc(Number(root.querySelector("#wledTestPresetId")?.value) || 1)));
          if (!ep) {
            setWledTestOutput(root, lang === "en" ? "No controller endpoint." : "Kein Controller-Endpoint.");
            return;
          }
          try {
            const res = await api.send({ type: "TRIGGER_WLED_PRESET", endpoint: ep, presetId: pid });
            if (res == null) {
              setWledTestOutput(
                root,
                lang === "en"
                  ? "No response from the extension background (reload the extension or check the service worker)."
                  : "Keine Antwort vom Extension-Hintergrund (Extension neu laden oder Service Worker pruefen)."
              );
              return;
            }
            setWledTestOutput(root, JSON.stringify(res, null, 2));
          } catch (e) {
            setWledTestOutput(root, String(e?.message || e));
          }
        });
        root.querySelector("#btnWledTestMatrixDigits")?.addEventListener("click", async () => {
          const settings = api.getSettings?.() || {};
          const lang = getLang(settings);
          const pi = getWledTestPlayerIndex(root);
          const text = String(root.querySelector("#wledTestMatrixScore")?.value || "180").trim() || "180";
          try {
            const res = await api.send({
              type: "WLED_TEST_MATRIX",
              payload: { kind: "digits", playerIndex: pi, text }
            });
            if (res == null) {
              setWledTestOutput(
                root,
                lang === "en"
                  ? "No response from the extension background (reload the extension or check the service worker)."
                  : "Keine Antwort vom Extension-Hintergrund (Extension neu laden oder Service Worker pruefen)."
              );
              return;
            }
            setWledTestOutput(root, JSON.stringify(res, null, 2));
          } catch (e) {
            setWledTestOutput(root, String(e?.message || e));
          }
        });
        root.querySelector("#btnWledTestMatrixArrow")?.addEventListener("click", async () => {
          const pi = getWledTestPlayerIndex(root);
          try {
            const settings = api.getSettings?.() || {};
            const lang = getLang(settings);
            const res = await api.send({
              type: "WLED_TEST_MATRIX",
              payload: { kind: "arrow", playerIndex: pi, text: "0" }
            });
            if (res == null) {
              setWledTestOutput(
                root,
                lang === "en"
                  ? "No response from the extension background (reload the extension or check the service worker)."
                  : "Keine Antwort vom Extension-Hintergrund (Extension neu laden oder Service Worker pruefen)."
              );
              return;
            }
            setWledTestOutput(root, JSON.stringify(res, null, 2));
          } catch (e) {
            setWledTestOutput(root, String(e?.message || e));
          }
        });
      }

      root.addEventListener("click", async (ev) => {
        const foldBtn = ev.target.closest?.("[data-wled-fold]");
        if (foldBtn && root.contains(foldBtn)) {
          const k = String(foldBtn.dataset.wledFold || "");
          if (k === "matrix") wledUiState.matrixSectionCollapsed = !wledUiState.matrixSectionCollapsed;
          else if (k === "effects") wledUiState.effectsSectionCollapsed = !wledUiState.effectsSectionCollapsed;
          else if (k === "test") wledUiState.testSectionCollapsed = !wledUiState.testSectionCollapsed;
          if (k === "matrix" || k === "effects" || k === "test") {
            syncWledFoldUi(root, k);
            ev.preventDefault();
            return;
          }
        }

        const testPl = ev.target.closest?.("[data-wled-test-player]");
        if (testPl && root.contains(testPl)) {
          root.querySelectorAll(".wledTestPlayerBtn").forEach((b) => b.classList.remove("active"));
          testPl.classList.add("active");
          return;
        }

        if (
          wledUiState.presetDropdownOpen &&
          !ev.target?.closest?.("[data-wled-preset-dropdown]") &&
          !ev.target?.closest?.("#wledPresetDropdownBtn")
        ) {
          wledUiState.presetDropdownOpen = false;
          refreshPresetPicker(root, api.getSettings?.() || {});
        }

        if (wledUiState.wledSegmentPadOpen) {
          const inSegPad = ev.target?.closest?.(
            "#wledSegmentPadBody, #wledSegmentPadToggle, .wledSegmentFieldRow, #wledSegmentPadHint"
          );
          if (!inSegPad) {
            setWledSegmentPadPopoverOpen(root, false, api.getSettings?.() || {});
          }
        }

        const segPadTgl = ev.target?.closest?.("#wledSegmentPadToggle");
        if (segPadTgl && WLED_PAD_SEGMENT_SELECTS.has(getWledSelectMode(root))) {
          setWledSegmentPadPopoverOpen(root, !wledUiState.wledSegmentPadOpen, api.getSettings?.() || {});
          return;
        }

        const multBtn = ev.target?.closest?.("[data-wled-pad-mult]");
        const padMode = getWledSelectMode(root);
        if (multBtn && (padMode === WLED_PAD_LEG || padMode === WLED_PAD_THROW)) {
          wledUiState.wledPadMult = String(multBtn.dataset.wledPadMult || "t").toLowerCase();
          syncWledPadMultUi(root);
          return;
        }

        const numBtn = ev.target?.closest?.("[data-wled-pad-num]");
        if (numBtn && WLED_PAD_SEGMENT_SELECTS.has(getWledSelectMode(root))) {
          const n = parseInt(String(numBtn.dataset.wledPadNum || ""), 10);
          if (Number.isFinite(n) && n >= 1 && n <= 20) applyPadNumber(root, n);
          return;
        }

        const tfBtn = ev.target?.closest?.("[data-wled-pad-twentyfive]");
        if (tfBtn && WLED_PAD_SEGMENT_SELECTS.has(getWledSelectMode(root))) {
          applyPadNumber(root, 25);
          return;
        }

        const specBtn = ev.target?.closest?.("[data-wled-pad-special]");
        if (specBtn && WLED_PAD_SEGMENT_SELECTS.has(getWledSelectMode(root))) {
          applyPadSpecial(root, String(specBtn.dataset.wledPadSpecial || ""));
          return;
        }

        const dropdownBtn = ev.target?.closest?.("#wledPresetDropdownBtn");
        if (dropdownBtn) {
          wledUiState.presetDropdownOpen = !wledUiState.presetDropdownOpen;
          refreshPresetPicker(root, api.getSettings?.() || {});
          return;
        }

        const advancedJsonToggleBtn = ev.target?.closest?.("#wledAdvancedJsonToggle");
        if (advancedJsonToggleBtn) {
          wledUiState.advancedJsonDraft = String(root.querySelector("#wledAdvancedJson")?.value || wledUiState.advancedJsonDraft || "");
          wledUiState.advancedJsonCollapsed = !wledUiState.advancedJsonCollapsed;
          const mount = root.querySelector("#wledAdvancedJsonSectionMount");
          if (mount) mount.innerHTML = renderAdvancedJsonSection(api.getSettings?.() || {});
          return;
        }

        const advancedModeBtn = ev.target?.closest?.("[data-wled-advanced-mode]");
        if (advancedModeBtn) {
          wledUiState.advancedJsonHelperMode = String(advancedModeBtn.dataset.wledAdvancedMode || "player") === "score" ? "score" : "player";
          const mount = root.querySelector("#wledAdvancedJsonHelperMount");
          if (mount) mount.innerHTML = renderAdvancedJsonHelper(api.getSettings?.() || {});
          return;
        }

        const applyAdvancedJsonBtn = ev.target?.closest?.("#wledApplyAdvancedJsonHelper");
        if (applyAdvancedJsonBtn) {
          const textarea = root.querySelector("#wledAdvancedJson");
          const nextValue = buildSolidAdvancedJson(wledUiState.advancedJsonHelperHue);
          wledUiState.advancedJsonDraft = nextValue;
          if (textarea) textarea.value = nextValue;
          return;
        }

        const presetOptionBtn = ev.target?.closest?.("[data-wled-preset-option]");
        if (presetOptionBtn) {
          const settings = api.getSettings?.() || {};
          const controllerId = String(presetOptionBtn.dataset.wledPresetController || "").trim();
          const presetId = String(presetOptionBtn.dataset.wledPresetId || "").trim();
          const selectedTargets = getSelectedPresetTargets(root, settings);
          const exists = selectedTargets.some((item) => item.controllerId === controllerId && item.presetId === presetId);
          const match = getAllLoadedPresets(settings).find((item) => item.controllerId === controllerId && item.presetId === presetId);
          if (!match) return;
          const nextTargets = exists
            ? selectedTargets.filter((item) => !(item.controllerId === controllerId && item.presetId === presetId))
            : selectedTargets.concat([{
                controllerId,
                controllerName: match.controllerLabel,
                presetId,
                presetName: match.presetName
              }]);
          writeSelectedPresetTargets(root, nextTargets);
          wledUiState.presetDropdownOpen = true;
          refreshPresetPicker(root, settings);
          return;
        }

        const removeSelectedBtn = ev.target?.closest?.("[data-wled-remove-selected]");
        if (removeSelectedBtn) {
          const settings = api.getSettings?.() || {};
          const removeKey = String(removeSelectedBtn.dataset.wledRemoveSelected || "");
          const nextTargets = getSelectedPresetTargets(root, settings)
            .filter((item) => `${item.controllerId}::${item.presetId}` !== removeKey);
          writeSelectedPresetTargets(root, nextTargets);
          refreshPresetPicker(root, settings);
          return;
        }

        const deleteBtn = ev.target?.closest?.("[data-wled-delete]");
        if (deleteBtn) {
          const settings = api.getSettings?.() || {};
          const controllers = getControllers(settings);
          const id = String(deleteBtn.dataset.wledDelete || "");
          const nextEffects = parseWledEffects(settings.wledEffectsJson, controllers).filter((item) => item.id !== id);
          await api.savePartial({ wledEffectsJson: JSON.stringify(nextEffects) });
          return;
        }

        const testBtn = ev.target?.closest?.("[data-wled-test]");
        if (!testBtn) return;
        const settings = api.getSettings?.() || {};
        const controllers = getControllers(settings);
        const items = parseWledEffects(settings.wledEffectsJson, controllers);
        const statusEl = root.querySelector("#wledEffectsStatus");
        const id = String(testBtn.dataset.wledTest || "");
        const match = items.find((item) => item.id === id);
        if (!match) return;
        try {
          const isAlt = normalizeConfiguredTrigger(match.trigger) === "player_turn_alternate";
          const testTargets = isAlt && Array.isArray(match.presetTargets) && match.presetTargets.length >= 1
            ? [match.presetTargets[0]]
            : match.presetTargets;
          const presetSummary = formatWledPresetLineForLog(testTargets);
          const res = await api.send({
            type: "TRIGGER_WLED_TARGETS",
            targets: testTargets,
            advancedJson: match.advancedJson || "",
            wledLogMeta: {
              effectName: match.name,
              triggerUnit: `${getEffectTriggerSummary(match, settings)} · Test`,
              presetSummary: presetSummary || "—"
            }
          });
          if (res == null) {
            throw new Error(
              getLang(settings) === "en"
                ? "No response from extension background"
                : "Keine Antwort vom Extension-Hintergrund"
            );
          }
          if (!res?.ok) throw new Error(res?.error || "Trigger failed");
          if (statusEl) {
            statusEl.textContent = isAlt && getLang(settings) === "en"
              ? "Test: fired preset 1 only (alternate uses both in play)."
              : isAlt
                ? "Test: nur Preset 1 ausgeloest (im Spiel wechseln beide)."
                : (getLang(settings) === "en" ? "Presets triggered." : "Presets ausgeloest.");
          }
        } catch (e) {
          if (statusEl) statusEl.textContent = getLang(settings) === "en"
            ? `Trigger failed: ${String(e?.message || e)}`
            : `Trigger fehlgeschlagen: ${String(e?.message || e)}`;
        }
      });
    },
    sync(api, settings) {
      const root = api.root;
      const s = settings || {};
      const matrixMount = root.querySelector("#wledMatrixSectionMount");
      if (matrixMount) matrixMount.innerHTML = renderWledMatrixSection(s);
      const tSel = root.querySelector("#wledTestControllerSelect");
      if (tSel) {
        const prevSel = String(tSel.value || "").trim();
        const ctrls = getControllers(s);
        const lang = getLang(s);
        const emptyOpt = lang === "en" ? "(no controllers)" : "(keine Controller)";
        tSel.innerHTML = ctrls.length
          ? ctrls.map((c) => `<option value="${escapeWledAttr(c.id)}">${escapeWledAttr(c.name || c.id)}</option>`).join("")
          : `<option value="">${emptyOpt}</option>`;
        if (prevSel && ctrls.some((c) => c.id === prevSel)) tSel.value = prevSel;
      }
      syncWledFoldUi(root, "all");
      const controllers = getControllers(s);
      wledUiState.advancedJsonDraft = String(root.querySelector("#wledAdvancedJson")?.value || wledUiState.advancedJsonDraft || "");

      const triggerSelect = root.querySelector("#wledEffectTrigger");
      if (triggerSelect) {
        const selectedTrigger = String(triggerSelect.value || "");
        triggerSelect.innerHTML = `
          <option value="">${getLang(s) === "en" ? "Choose trigger" : "Trigger auswaehlen"}</option>
          ${renderTriggerDropdownOptions(s)}
        `;
        if (selectedTrigger) triggerSelect.value = selectedTrigger;
      }
      onWledTriggerSelectChange(root, s);
      syncWledPadMultUi(root);
      const advancedJsonSectionMount = root.querySelector("#wledAdvancedJsonSectionMount");
      if (advancedJsonSectionMount) advancedJsonSectionMount.innerHTML = renderAdvancedJsonSection(s);
      const advancedJsonHelperMount = root.querySelector("#wledAdvancedJsonHelperMount");
      if (advancedJsonHelperMount) advancedJsonHelperMount.innerHTML = renderAdvancedJsonHelper(s);

      const controllerMount = document.querySelector("#settingsWledControllersMount");
      if (controllerMount) controllerMount.innerHTML = renderControllers(s);

      refreshPresetPicker(root, s);

      const effectsMount = root.querySelector("#wledEffectsListMount");
      if (effectsMount) effectsMount.innerHTML = renderEffectList(s);

      for (const controller of controllers) {
        updateControllerStatus(root, controller.id, wledUiState.statusByControllerId[controller.id] || "");
      }

      paintWledControllerConnectionButtonsFromCache(api, s);
      refreshWledModuleStripFromCache(api, s);
    },
    async appendControllerFromSettings(api) {
      const settings = api.getSettings?.() || {};
      const controllers = getControllers(settings);
      const nextIndex = controllers.length + 1;
      const nextId = `ctrl_${Date.now()}_${Math.floor(Math.random() * 9999)}`;
      const nextControllers = controllers.concat([{ id: nextId, name: "", endpoint: "" }]);
      wledUiState.collapsedByControllerId[nextId] = false;
      await saveControllers(api, nextControllers);
      const statusEl = document.querySelector("#wledEffectsStatus");
      if (statusEl) {
        statusEl.textContent = getLang(settings) === "en"
          ? `Controller ${nextIndex} added.`
          : `Controller ${nextIndex} hinzugefuegt.`;
      }
    },
    async refreshPresetsOnPopupOpen(api) {
      const settings = api.getSettings?.() || {};
      const controllers = getControllers(settings);
      for (const c of controllers) {
        await loadPresetsForController(api, c.id);
      }
      afterWledPresetLoadUi(api, api.getSettings?.() || settings);
    }
  };
})(window);
