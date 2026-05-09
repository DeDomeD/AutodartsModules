(function initEffectsModule(scope) {
  scope.ADM_MODULES = scope.ADM_MODULES || {};

  let MISS_GUARD_POPUP_OPEN = false;
  const TRIGGER_GROUP_COLLAPSED = {};
  const CUSTOM_EFFECT_TRIGGER_OPTIONS = [
    { value: "miss", de: "Miss", en: "Miss" },
    { value: "specialMiss", de: "Special Miss", en: "Special Miss" },
    { value: "dbl", de: "Double", en: "Double" },
    { value: "tpl", de: "Triple", en: "Triple" },
    { value: "bull", de: "Bull", en: "Bull" },
    { value: "dbull", de: "Double Bull", en: "Double Bull" },
    { value: "t20", de: "T20", en: "T20" },
    { value: "t19", de: "T19", en: "T19" },
    { value: "t18", de: "T18", en: "T18" },
    { value: "t17", de: "T17", en: "T17" },
    { value: "high100", de: "High 100+", en: "High 100+" },
    { value: "high140", de: "High 140+", en: "High 140+" },
    { value: "oneeighty", de: "180", en: "180" },
    { value: "noScore", de: "No Score", en: "No Score" },
    { value: "waschmaschine", de: "Waschmaschine", en: "Waschmaschine" },
    { value: "bust", de: "Bust", en: "Bust" },
    { value: "winner", de: "Winner", en: "Winner" },
    { value: "correction", de: "Korrektur", en: "Correction" },
    { value: "myTurnStart", de: "Mein Zug", en: "My Turn Start" },
    { value: "opponentTurnStart", de: "Gegner Zug", en: "Opponent Turn Start" }
  ];
  const CUSTOM_EFFECT_TRIGGER_SUGGESTIONS = [
    ...CUSTOM_EFFECT_TRIGGER_OPTIONS.map((item) => item.value),
    "throw",
    "last_throw",
    "gameon",
    "takeout",
    "takeout_finished",
    "gameshot",
    "gameshot+d10",
    "gameshot+t20",
    "matchshot",
    "matchshot+bull",
    "busted",
    "outside",
    "bot_throw",
    "board_starting",
    "board_started",
    "board_stopping",
    "board_stopped",
    "calibration_started",
    "calibration_finished",
    "manual_reset_done",
    "lobby_in",
    "lobby_out",
    "tournament_ready",
    "range_100_180",
    "180",
    "140",
    "s20",
    "d10",
    "t20",
    "t19",
    "t18",
    "t17",
    "t20_t20_t20",
    "s20_s20_s20",
    "d16_d16_d16",
    "player_1",
    "player_2",
    "player_3",
    "player_4",
    "player_5",
    "player_6"
  ];
  const CUSTOM_EFFECT_TRIGGER_GROUPS = [
    {
      key: "main",
      de: "Main Source",
      en: "Main Source",
      values: ["throw", "last_throw", "gameon", "myTurnStart", "opponentTurnStart", "manual_reset_done"]
    },
    {
      key: "finish",
      de: "Checkouts",
      en: "Checkouts",
      values: ["takeout", "takeout_finished", "gameshot", "matchshot", "winner", "busted", "bust"]
    },
    {
      key: "visit",
      de: "Visit & Punkte",
      en: "Visit & Points",
      values: ["180", "140", "range_100_180", "high100", "high140", "oneeighty", "noScore", "waschmaschine"]
    },
    {
      key: "segments",
      de: "Segmente",
      en: "Segments",
      values: ["s20", "d10", "t20", "outside", "bull", "dbull", "dbl", "tpl"]
    },
    {
      key: "combo",
      de: "Kombis & Spieler",
      en: "Combos & Players",
      values: ["player_1", "player_2", "player_3", "player_4", "bot_throw"]
    },
    {
      key: "system",
      de: "Board & System",
      en: "Board & System",
      values: ["board_starting", "board_started", "board_stopping", "board_stopped", "calibration_started", "calibration_finished", "lobby_in", "lobby_out", "tournament_ready"]
    }
  ];

  function currentLang(settings) {
    return String(settings?.uiLanguage || "de").toLowerCase() === "en" ? "en" : "de";
  }

  function parseCustomEffects(raw) {
    try {
      const arr = JSON.parse(String(raw || "[]"));
      if (!Array.isArray(arr)) return [];
      return arr
        .filter((item) => item && typeof item === "object")
        .map((item) => ({
          id: String(item.id || "").trim(),
          key: String(item.key || "").trim(),
          name: String(item.name || "").trim(),
          trigger: String(item.trigger || "").trim(),
          enabled: item.enabled !== false
        }))
        .filter((item) => !!item.id && !!item.key && !!item.name && !!item.trigger);
    } catch {
      return [];
    }
  }

  function getTriggerLabel(trigger, settings) {
    const lang = currentLang(settings);
    const normalized = normalizeConfiguredTrigger(trigger);
    const playerMatch = normalized.match(/^(player|spieler)_(\d+)$/);
    if (playerMatch) {
      const number = Number(playerMatch[2]);
      if (number >= 1) {
        return lang === "en" ? `Player ${number}` : `Spieler ${number}`;
      }
    }
    const option = CUSTOM_EFFECT_TRIGGER_OPTIONS.find((item) => item.value === trigger);
    if (!option) return trigger;
    return lang === "en" ? option.en : option.de;
  }

  function renderCustomEffectTriggerSuggestions(settings) {
    const lang = currentLang(settings);
    return CUSTOM_EFFECT_TRIGGER_SUGGESTIONS
      .map((value) => {
        const playerMatch = String(value).match(/^player_(\d+)$/);
        if (playerMatch) {
          const number = Number(playerMatch[1]);
          const label = lang === "en" ? `Player ${number}` : `Spieler ${number}`;
          return `<option value="${value}" label="${label}"></option>`;
        }
        const option = CUSTOM_EFFECT_TRIGGER_OPTIONS.find((item) => item.value === value);
        const label = option ? (lang === "en" ? option.en : option.de) : value;
        return `<option value="${value}" label="${label}"></option>`;
      })
      .join("");
  }

  function normalizeConfiguredTrigger(value) {
    return String(value || "").trim().toLowerCase();
  }

  function getPlayerTriggerHintText(value, settings) {
    const lang = currentLang(settings);
    const normalized = normalizeConfiguredTrigger(value);
    if (!/^player_[12]$/.test(normalized) && !/^spieler_[12]$/.test(normalized)) return "";
    return lang === "en"
      ? "You can also use player_3, player_4, player_5 and more."
      : "Du kannst genauso auch player_3, player_4, player_5 usw. verwenden.";
  }

  function updateTriggerFieldHint(root, settings) {
    const input = root.querySelector("#customEffectTrigger");
    const hint = root.querySelector("#customEffectTriggerDynamicHint");
    if (!hint) return;
    hint.textContent = getPlayerTriggerHintText(input?.value, settings);
    hint.style.display = hint.textContent ? "" : "none";
  }

  function isTriggerGroupCollapsed(groupKey) {
    return TRIGGER_GROUP_COLLAPSED[groupKey] !== false;
  }

  function renderTriggerPickerGroups(settings) {
    const lang = currentLang(settings);
    return `
      <div class="triggerPicker">
        ${CUSTOM_EFFECT_TRIGGER_GROUPS.map((group) => `
          <div class="triggerGroup">
            <button
              type="button"
              class="triggerGroupHeader"
              data-trigger-group-toggle="${group.key}"
              aria-expanded="${isTriggerGroupCollapsed(group.key) ? "false" : "true"}"
            >
              <span class="triggerGroupTitle">${lang === "en" ? group.en : group.de}</span>
              <span class="triggerGroupArrow">${isTriggerGroupCollapsed(group.key) ? "v" : "^"}</span>
            </button>
            <div class="triggerChipRow${isTriggerGroupCollapsed(group.key) ? " hidden" : ""}">
              ${group.values.map((value) => `
                <button type="button" class="triggerChip" data-trigger-pick="${value}">
                  <span class="triggerChipValue">${getTriggerLabel(value, settings)}</span>
                </button>
              `).join("")}
            </div>
          </div>
        `).join("")}
      </div>
    `;
  }

  function renderCustomEffectsList(settings) {
    const customEffects = parseCustomEffects(settings?.customEffectsJson);
    if (!customEffects.length) {
      return `<div class="hint" style="margin-top:0;" data-i18n="custom_effects_empty">Noch keine benutzerdefinierten Effekte angelegt.</div>`;
    }
    return `
      <div class="list" style="margin-top:12px;">
        ${customEffects.map((item) => `
          <div class="listToggle">
            <div class="liText">
              <div class="liTitle">${item.name}</div>
              <div class="liSub">${getTriggerLabel(item.trigger, settings)}</div>
            </div>
            <div class="inlineActionsRow">
              <label class="switch">
                <input type="checkbox" data-custom-effect-toggle="${item.id}" ${item.enabled ? "checked" : ""} />
                <span class="slider"></span>
              </label>
              <button type="button" class="customThemeDelete" data-custom-effect-delete="${item.id}" title="${currentLang(settings) === "en" ? "Delete effect" : "Effekt löschen"}">X</button>
            </div>
          </div>
        `).join("")}
      </div>
    `;
  }

  function renderConnectionButton(kind, label, opts = {}) {
    const withRetry = !!opts.withRetry;
    return `
      <button
        type="button"
        class="connectionStatusBtn"
        data-connection-kind="${kind}"
        ${kind === "obs" ? "data-obs-status" : "data-sb-status"}
        ${withRetry ? `data-connection-retry="${kind}"` : ""}
      >
        <div class="connectionStatusLabel">
          <span>${label}</span>
          <span class="connectionStatusText" data-connection-status-text></span>
          <span class="connectionStatusAttempts" data-connection-attempts></span>
        </div>
      </button>
    `;
  }

  scope.ADM_MODULES.effects = {
    id: "effects",
    icon: "E",
    navLabelKey: "nav_effects",
    needs: { streamerbot: true, obs: false },
    render() {
      return `
        <h2 class="title"><span data-i18n="title_effects">Effects</span><span class="titleMeta">Streamer.bot/OBS</span></h2>

        <div class="card" data-settings-nav-connections style="cursor:pointer;">
          <div class="sectionHead">
            <div class="sectionTitle" style="margin:0;" data-i18n="section_connections">Verbindungen</div>
          </div>
          <div class="connectionStatusGrid" id="effectsConnectionStripGrid" data-connections-open="false">
            ${renderConnectionButton("obs", "OBS", { withRetry: false })}
            ${renderConnectionButton("sb", "Streamer.bot", { withRetry: false })}
          </div>
          <div class="hint" style="margin-top:8px;" data-i18n="module_connections_tap_hint">Tippen, um die Verbindungen in den Einstellungen zu oeffnen.</div>
        </div>

        <div class="divider"></div>

        <div class="sectionTitle" data-i18n="section_per_dart">Per Dart</div>
        <div class="list">
          <div class="listToggle">
            <div class="liText">
              <div class="liTitle"> <span data-i18n="miss_title">Miss</span> <button type="button" class="miniChevronBtn${MISS_GUARD_POPUP_OPEN ? " active" : ""}" id="missGuardPopupToggle" aria-label="Miss Guard Einstellungen" title="Miss Guard Einstellungen"><span class="ddArrow">${MISS_GUARD_POPUP_OPEN ? "▲" : "▼"}</span></button></div>
              <div class="liSub" data-i18n="miss_sub">Score 0 / M*</div>
            </div>
            <label class="switch"><input type="checkbox" id="enableMiss" /><span class="slider"></span></label>
          </div>
          <div class="inlinePopupWrap${MISS_GUARD_POPUP_OPEN ? " open" : ""}" id="missGuardPopupWrap">
            <div class="inlinePopupCard">
              <div class="formRow" style="margin-top:0;">
                <label class="label" for="missGuardThreshold" data-i18n="miss_guard_threshold_label">Miss Guard Threshold</label>
                <input class="input" id="missGuardThreshold" type="number" min="2" max="170" step="1" />
                <div class="hint" data-i18n="miss_guard_threshold_hint">At and below this score, generic Miss can be suppressed.</div>
              </div>
              <div class="list" style="margin-top:10px;">
                <div class="listToggle">
                  <div class="liText">
                    <div class="liTitle" data-i18n="miss_guard_title">Double-Out Miss Guard</div>
                    <div class="liSub" data-i18n="miss_guard_sub">Suppress generic Miss in finish range</div>
                  </div>
                  <label class="switch"><input type="checkbox" id="missGuardOnDoubleOut" /><span class="slider"></span></label>
                </div>
              </div>
            </div>
          </div>
          <div class="listToggle">
            <div class="liText">
              <div class="liTitle" data-i18n="double_title">Double</div>
              <div class="liSub" data-i18n="double_sub">Any double hit</div>
            </div>
            <label class="switch"><input type="checkbox" id="enableDouble" /><span class="slider"></span></label>
          </div>
          <div class="listToggle">
            <div class="liText">
              <div class="liTitle" data-i18n="triple_title">Triple (generic)</div>
              <div class="liSub" data-i18n="triple_sub">Only when not T20/T19/T18/T17</div>
            </div>
            <label class="switch"><input type="checkbox" id="enableTriple" /><span class="slider"></span></label>
          </div>
          <div class="listToggle">
            <div class="liText">
              <div class="liTitle" data-i18n="bull_title">Bull</div>
              <div class="liSub">25</div>
            </div>
            <label class="switch"><input type="checkbox" id="enableBull" /><span class="slider"></span></label>
          </div>
          <div class="listToggle">
            <div class="liText">
              <div class="liTitle" data-i18n="dbull_title">Double Bull</div>
              <div class="liSub">50</div>
            </div>
            <label class="switch"><input type="checkbox" id="enableDBull" /><span class="slider"></span></label>
          </div>
          <div class="listToggle">
            <div class="liText">
              <div class="liTitle">Leg-Checkout auf Bull</div>
              <div class="liSub">Leg mit 25/50 beendet (Rest = Dart-Score). Kein Bull-Off („Einbullen“).</div>
            </div>
            <label class="switch"><input type="checkbox" id="enableBullCheckout" /><span class="slider"></span></label>
          </div>
          <div class="listToggle">
            <div class="liText">
              <div class="liTitle" data-i18n="effects_bull_off_triggers_title">Wurf-Trigger trotz Bull-Off/Cork</div>
              <div class="liSub" data-i18n="effects_bull_off_triggers_sub">Standard: aus. Bei Bedarf aktivieren, wenn die Erkennung hängen bleibt (z. B. KI-Schiedsrichter) — dann feuern auch echte Cork-Würfe alle Dart-Trigger.</div>
            </div>
            <label class="switch"><input type="checkbox" id="emitThrowTriggersDuringBullOffPhase" /><span class="slider"></span></label>
          </div>
        </div>

        <div class="divider"></div>
        <div class="sectionTitle" data-i18n="section_special_triples">Special Triples</div>
        <div class="grid2">
          <div class="tile"><div class="tileTitle">T20</div><label class="switch"><input id="enableT20" type="checkbox" /><span class="slider"></span></label></div>
          <div class="tile"><div class="tileTitle">T19</div><label class="switch"><input id="enableT19" type="checkbox" /><span class="slider"></span></label></div>
          <div class="tile"><div class="tileTitle">T18</div><label class="switch"><input id="enableT18" type="checkbox" /><span class="slider"></span></label></div>
          <div class="tile"><div class="tileTitle">T17</div><label class="switch"><input id="enableT17" type="checkbox" /><span class="slider"></span></label></div>
        </div>

        <div class="divider"></div>
        <div class="sectionTitle" data-i18n="section_per_visit">Per Visit (after 3 darts)</div>
        <div class="list">
          <div class="listToggle">
            <div class="liText">
              <div class="liTitle" data-i18n="high100_title">High 100+</div>
              <div class="liSub" data-i18n="after_third_dart_sub">Triggers only after 3rd dart</div>
            </div>
            <label class="switch"><input type="checkbox" id="enableHigh100" /><span class="slider"></span></label>
          </div>
          <div class="listToggle">
            <div class="liText">
              <div class="liTitle" data-i18n="high140_title">High 140+</div>
              <div class="liSub" data-i18n="after_third_dart_sub">Triggers only after 3rd dart</div>
            </div>
            <label class="switch"><input type="checkbox" id="enableHigh140" /><span class="slider"></span></label>
          </div>
          <div class="listToggle">
            <div class="liText">
              <div class="liTitle" data-i18n="oneeighty_title">180</div>
              <div class="liSub" data-i18n="priority_third_dart_sub">Priority on 3rd dart</div>
            </div>
            <label class="switch"><input type="checkbox" id="enable180" /><span class="slider"></span></label>
          </div>
          <div class="listToggle">
            <div class="liText">
              <div class="liTitle" data-i18n="washer_title">Waschmaschine (20, 1, 5)</div>
              <div class="liSub" data-i18n="washer_sub">Triggers when 20,1,5 in any order.</div>
            </div>
            <label class="switch"><input type="checkbox" id="enableWaschmaschine" /><span class="slider"></span></label>
          </div>
          <div class="listToggle">
            <div class="liText">
              <div class="liTitle" data-i18n="no_score_title">No Score</div>
              <div class="liSub" data-i18n="no_score_sub">Full visit scores 0</div>
            </div>
            <label class="switch"><input type="checkbox" id="enableNoScore" /><span class="slider"></span></label>
          </div>
        </div>

        <div class="divider"></div>
        <div class="sectionTitle" data-i18n="section_other">Other</div>
        <div class="list">
          <div class="listToggle">
            <div class="liText">
              <div class="liTitle" data-i18n="correction_title">Undo / Correction</div>
              <div class="liSub" data-i18n="correction_sub">Undo button trigger</div>
            </div>
            <label class="switch"><input type="checkbox" id="enableCorrection" /><span class="slider"></span></label>
          </div>
          <div class="formRow" style="margin:12px 0 4px;">
            <label class="label" for="turnStartSbMode" data-i18n="turn_start_sb_mode_label">Streamer.bot: Zug-Start</label>
            <select id="turnStartSbMode" class="input">
              <option value="player_name" data-i18n="turn_start_sb_mode_player_name">Pro Spielername (z. B. „Bot Level 9 Turn“)</option>
              <option value="my_opponent" data-i18n="turn_start_sb_mode_my_opponent">Klassisch: Mein Zug / Gegner Zug</option>
            </select>
            <div class="hint" data-i18n="turn_start_sb_mode_sub">Pro Name: Action = Prefix + Vorlage unten. Klassisch: Zuordnung ueber „Mein Autodarts-Anzeigename“ und die beiden Schalter.</div>
          </div>
          <div class="formRow" style="margin:4px 0 4px;">
            <label class="label" for="turnStartSuffixTemplate" data-i18n="turn_start_suffix_template_label">Vorlage Zug-Start (Suffix)</label>
            <input class="input" id="turnStartSuffixTemplate" type="text" placeholder="{name} Turn" autocomplete="off" />
            <div class="hint" data-i18n="turn_start_suffix_template_sub">Platzhalter <code>{name}</code> = Anzeigename (z. B. Bot Level 9). In Streamer.bot eine Action pro erwartetem Namen anlegen.</div>
          </div>
          <div class="formRow" style="margin:12px 0 4px;">
            <label class="label" for="myAutodartsUsername" data-i18n="my_autodarts_username_label">Mein Autodarts-Anzeigename</label>
            <input class="input" id="myAutodartsUsername" type="text" placeholder="z. B. dedomed_ttv" autocomplete="off" />
            <div class="hint" data-i18n="my_autodarts_username_sub">Fuer „Mein Zug“ / „Gegner Zug“ wird dieser Name mit dem aktiven Spieler abgeglichen (ohne Leerzeichen, Gross/Klein egal). Leer = erster Spieler (Slot 0) wie bisher.</div>
          </div>
          <div class="listToggle">
            <div class="liText">
              <div class="liTitle" data-i18n="my_turn_start_title">Mein Zug</div>
              <div class="liSub" data-i18n="my_turn_start_sub">Trigger on your turn start</div>
            </div>
            <label class="switch"><input type="checkbox" id="enableMyTurnStart" /><span class="slider"></span></label>
          </div>
          <div class="listToggle">
            <div class="liText">
              <div class="liTitle" data-i18n="opponent_turn_start_title">Gegner Zug</div>
              <div class="liSub" data-i18n="opponent_turn_start_sub">Trigger on opponent turn</div>
            </div>
            <label class="switch"><input type="checkbox" id="enableOpponentTurnStart" /><span class="slider"></span></label>
          </div>
          <div class="listToggle">
            <div class="liText">
              <div class="liTitle" data-i18n="special_miss_title">Special Miss</div>
              <div class="liSub" data-i18n="special_miss_sub">Miss in finish range</div>
            </div>
            <label class="switch"><input type="checkbox" id="enableSpecialMiss" /><span class="slider"></span></label>
          </div>
        </div>

        <div class="spacer"></div>
        <div class="card">
          <div class="sectionHead">
            <div class="sectionTitle" style="margin:0;" data-i18n="custom_effects_title">Benutzerdefinierte Effekte</div>
          </div>
          <div class="hint" data-i18n="custom_effects_hint">Lege eigene Effekt-Trigger mit Namen, Autodarts-Auslöser und Schalter an.</div>
          <datalist id="admSbActionNameSuggestions"></datalist>
          <div class="formRow">
            <label class="label" for="customEffectName" data-i18n="custom_effects_name_label">Name</label>
            <input class="input" id="customEffectName" type="text" list="admSbActionNameSuggestions" placeholder="z. B. Team Winner" autocomplete="off" />
          </div>
          <div class="formRow">
            <label class="label" for="customEffectTrigger" data-i18n="custom_effects_trigger_label">Autodarts Trigger</label>
            <input class="input" id="customEffectTrigger" type="text" list="customEffectTriggerSuggestions" placeholder="z. B. gameshot, range_100_180, t20_t20_t20" />
            <datalist id="customEffectTriggerSuggestions">${renderCustomEffectTriggerSuggestions({ uiLanguage: "de" })}</datalist>
            <div class="hint">Freier Trigger oder Schnellwahl. Fuer weitere Spieler einfach <code>player_3</code>, <code>player_4</code>, <code>player_5</code> usw. eintragen.</div>
            <div class="hint" id="customEffectTriggerDynamicHint" style="display:none;"></div>
            <div id="customEffectTriggerPickerMount">${renderTriggerPickerGroups({ uiLanguage: "de" })}</div>
          </div>
          <div class="rowSplit">
            <button id="addCustomEffectBtn" class="btnPrimary" type="button" data-i18n="custom_effects_add_btn">Effekt hinzufügen</button>
          </div>
          <div id="customEffectsStatus" class="hint" style="margin-top:8px;"></div>
          <div id="customEffectsListMount">${renderCustomEffectsList({ uiLanguage: "de", customEffectsJson: "[]" })}</div>
        </div>
        <div class="spacer"></div>
      `;
    },
    bind(api) {
      const root = api.root;
      const ids = [
        "enableMiss", "enableDouble", "enableTriple", "enableBull", "enableDBull", "enableBullCheckout",
        "emitThrowTriggersDuringBullOffPhase",
        "enableT20", "enableT19", "enableT18", "enableT17",
        "enableHigh100", "enableHigh140", "enable180", "enableWaschmaschine", "enableNoScore",
        "enableCorrection", "enableMyTurnStart", "enableOpponentTurnStart", "enableSpecialMiss",
        "missGuardOnDoubleOut"
      ];
      ids.forEach((id) => api.bindAuto(root, id, id));
      api.bindAuto(root, "missGuardThreshold", "missGuardThreshold", "number");
      api.bindAutoImmediate(root, "myAutodartsUsername", "myAutodartsUsername", (value) => String(value || "").trim());
      api.bindAutoImmediate(root, "turnStartSuffixTemplate", "turnStartSuffixTemplate", (value) => String(value || "").trim());
      root.querySelector("#turnStartSbMode")?.addEventListener("change", async (ev) => {
        const v = String(ev.target?.value || "player_name").trim().toLowerCase();
        await api.savePartial({ turnStartSbMode: v === "my_opponent" ? "my_opponent" : "player_name" });
      });

      root.querySelector("#missGuardPopupToggle")?.addEventListener("click", () => {
        MISS_GUARD_POPUP_OPEN = !MISS_GUARD_POPUP_OPEN;
        scope.ADM_MODULES.effects.sync(api, api.getSettings?.() || {});
      });

      root.querySelector("#customEffectTrigger")?.addEventListener("input", () => {
        updateTriggerFieldHint(root, api.getSettings?.() || {});
      });

      root.querySelector("#addCustomEffectBtn")?.addEventListener("click", async () => {
        const settings = api.getSettings?.() || {};
        const nameInput = root.querySelector("#customEffectName");
        const triggerInput = root.querySelector("#customEffectTrigger");
        const statusEl = root.querySelector("#customEffectsStatus");
        const name = String(nameInput?.value || "").trim();
        const trigger = normalizeConfiguredTrigger(triggerInput?.value);
        if (!name || !trigger) {
          if (statusEl) statusEl.textContent = currentLang(settings) === "en"
            ? "Please enter a name and choose a trigger."
            : "Bitte Namen und Auslöser auswählen.";
          return;
        }

        const customEffects = parseCustomEffects(settings.customEffectsJson);
        const id = `fx_${Date.now()}_${Math.floor(Math.random() * 9999)}`;
        const key = `custom_${id}`;
        const nextEffects = customEffects.concat([{ id, key, name, trigger, enabled: true }]);
        const nextActions = { ...(settings.actions || {}), [key]: name };

        await api.savePartial({
          customEffectsJson: JSON.stringify(nextEffects),
          actions: nextActions
        });

        if (nameInput) nameInput.value = "";
        if (triggerInput) triggerInput.value = "";
        if (statusEl) statusEl.textContent = currentLang(settings) === "en"
          ? "Custom effect added."
          : "Benutzerdefinierter Effekt hinzugefügt.";
      });

      root.addEventListener("change", async (ev) => {
        const target = ev.target;
        if (!target?.matches?.("[data-custom-effect-toggle]")) return;
        const settings = api.getSettings?.() || {};
        const id = String(target.dataset.customEffectToggle || "");
        const nextEffects = parseCustomEffects(settings.customEffectsJson).map((item) => (
          item.id === id ? { ...item, enabled: !!target.checked } : item
        ));
        await api.savePartial({ customEffectsJson: JSON.stringify(nextEffects) });
      });

      root.addEventListener("click", async (ev) => {
        const groupToggleBtn = ev.target?.closest?.("[data-trigger-group-toggle]");
        if (groupToggleBtn) {
          const groupKey = String(groupToggleBtn.dataset.triggerGroupToggle || "");
          if (groupKey) {
            TRIGGER_GROUP_COLLAPSED[groupKey] = !isTriggerGroupCollapsed(groupKey);
            const triggerPickerMount = root.querySelector("#customEffectTriggerPickerMount");
            if (triggerPickerMount) triggerPickerMount.innerHTML = renderTriggerPickerGroups(api.getSettings?.() || {});
          }
          return;
        }

        const triggerPickBtn = ev.target?.closest?.("[data-trigger-pick]");
        if (triggerPickBtn) {
          const triggerInput = root.querySelector("#customEffectTrigger");
          if (triggerInput) {
            triggerInput.value = String(triggerPickBtn.dataset.triggerPick || "");
            triggerInput.dispatchEvent(new Event("input", { bubbles: true }));
          }
          return;
        }

        const btn = ev.target?.closest?.("[data-custom-effect-delete]");
        if (!btn) return;
        const settings = api.getSettings?.() || {};
        const id = String(btn.dataset.customEffectDelete || "");
        const customEffects = parseCustomEffects(settings.customEffectsJson);
        const removeItem = customEffects.find((item) => item.id === id);
        if (!removeItem) return;
        const nextEffects = customEffects.filter((item) => item.id !== id);
        const nextActions = { ...(settings.actions || {}) };
        delete nextActions[removeItem.key];
        await api.savePartial({
          customEffectsJson: JSON.stringify(nextEffects),
          actions: nextActions
        });
      });
    },
    sync(api, settings) {
      const root = api.root;
      const s = settings || {};
      const ids = [
        "enableMiss", "enableDouble", "enableTriple", "enableBull", "enableDBull", "enableBullCheckout",
        "emitThrowTriggersDuringBullOffPhase",
        "enableT20", "enableT19", "enableT18", "enableT17",
        "enableHigh100", "enableHigh140", "enable180", "enableWaschmaschine", "enableNoScore",
        "enableCorrection", "enableMyTurnStart", "enableOpponentTurnStart", "enableSpecialMiss",
        "missGuardOnDoubleOut"
      ];
      ids.forEach((id) => api.setChecked(root, id, !!s[id]));
      api.setValue(root, "missGuardThreshold", Number.isFinite(s.missGuardThreshold) ? s.missGuardThreshold : 40);
      api.setValue(root, "myAutodartsUsername", String(s.myAutodartsUsername || "").trim());
      const mode = String(s.turnStartSbMode || "player_name").toLowerCase().trim();
      api.setValue(root, "turnStartSbMode", mode === "my_opponent" ? "my_opponent" : "player_name");
      api.setValue(root, "turnStartSuffixTemplate", String(s.turnStartSuffixTemplate || "{name} Turn").trim() || "{name} Turn");
      const connectionGrid = root.querySelector("#effectsConnectionStripGrid");
      if (connectionGrid) {
        connectionGrid.dataset.connectionsOpen = "false";
        const visibleCount = Array.from(connectionGrid.querySelectorAll("[data-connection-kind]")).filter((node) => {
          const kind = String(node.dataset.connectionKind || "");
          return kind === "obs" ? s.obsEnabled !== false : s.sbEnabled !== false;
        }).length;
        connectionGrid.classList.toggle("compactSingle", visibleCount <= 1);
      }
      const popupWrap = root.querySelector("#missGuardPopupWrap");
      if (popupWrap) popupWrap.classList.toggle("open", MISS_GUARD_POPUP_OPEN);
      const popupToggle = root.querySelector("#missGuardPopupToggle");
      if (popupToggle) {
        popupToggle.classList.toggle("active", MISS_GUARD_POPUP_OPEN);
        popupToggle.innerHTML = `<span class="ddArrow">${MISS_GUARD_POPUP_OPEN ? "▲" : "▼"}</span>`;
      }
      const triggerSuggestions = root.querySelector("#customEffectTriggerSuggestions");
      if (triggerSuggestions) triggerSuggestions.innerHTML = renderCustomEffectTriggerSuggestions(s);
      updateTriggerFieldHint(root, s);
      const triggerPickerMount = root.querySelector("#customEffectTriggerPickerMount");
      if (triggerPickerMount) triggerPickerMount.innerHTML = renderTriggerPickerGroups(s);
      const mount = root.querySelector("#customEffectsListMount");
      if (mount) mount.innerHTML = renderCustomEffectsList(s);
      api.refreshConnectionStatuses?.();
    },
    async refreshSbActionsDatalist(api) {
      const root = api?.root;
      const dl = root?.querySelector?.("#admSbActionNameSuggestions");
      if (!dl) return;
      try {
        const res = await api.send({ type: "SB_GET_ACTIONS" });
        const raw = res?.ok && Array.isArray(res.actions) ? res.actions : [];
        const names = [];
        for (const a of raw) {
          const n = String(a?.name || "").trim();
          if (n && !names.includes(n)) names.push(n);
        }
        names.sort((a, b) => a.localeCompare(b));
        dl.innerHTML = "";
        for (const n of names) {
          const opt = document.createElement("option");
          opt.value = n;
          dl.appendChild(opt);
        }
      } catch {
        /* ignore */
      }
    }
  };
})(window);
