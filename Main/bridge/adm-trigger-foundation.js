/**
 * ADM Trigger — Foundation (Service Worker)
 * Zusammengefasst: ehem. adm-trigger-api.js, adm-trigger-keys.js, adm-trigger-bus.js
 * Reihenfolge: API -> Keys -> Bus (nicht aendern).
 */
/**
 * Trigger-API v2 — oeffentliche Einstiegsoberflaeche (emit + nach Engine-Start alle Handler).
 *
 * - Neu: ADM.admTriggers.emit(key, payload)
 * - Bridge/Messages: ADM.admTriggers.handleThrow / handleState / … (von adm-trigger-engine.js zugewiesen)
 * - ADM.autodartsTriggers zeigt auf dasselbe Objekt (Kompatibilitaet).
 */
(function initAdmTriggerApi(scope) {
  const ADM = scope.ADM || (scope.ADM = {});
  let engineEmit = null;

  ADM.admTriggers = {
    version: 2,
    _registerEngine(fn) {
      if (typeof fn === "function") engineEmit = fn;
    },
    isReady() {
      return typeof engineEmit === "function";
    },
    emit(key, payload = {}) {
      if (engineEmit) {
        return engineEmit(key, payload);
      }
      try {
        ADM.logger?.warn?.("triggers", "admTriggers.emit before engine ready", {
          key: String(key || "")
        });
      } catch (_) {}
    }
  };
})(self);

/**
 * Gemeinsame Trigger-Schluessel-Hilfen (Service Worker).
 * Von adm-trigger-engine.js und Modulen wie WLED verwendet — eine Quelle fuer Normalisierung und Regel-Matching.
 */
(function initAdmTriggerKeys(scope) {
  const ADM = scope.ADM || (scope.ADM = {});

  function normalizeTriggerKey(value) {
    return String(value || "").trim().toLowerCase();
  }

  function toUnifiedDispatchKey(rawNorm) {
    const k = normalizeTriggerKey(rawNorm);
    if (!k) return k;
    if (k === "checkout" || k.startsWith("checkout_")) return "takeout";
    if (k === "turn_active_player") return "gameon";
    if (k === "myturnstart" || k === "opponentturnstart") return "gameon";
    if (k === "oneeighty") return "180";
    if (k === "high140") return "140";
    if (k === "high100") return "range_100_139";
    if (k === "winner") return "gameshot";
    if (k === "bust") return "busted";
    if (k === "correction") return "manual_reset_done";
    if (k === "specialmiss" || k === "miss") return "outside";
    if (k === "dbl") return "double";
    if (k === "tpl") return "triple";
    if (k === "dbull") return "bull";
    if (k === "waschmaschine") return "s20_s1_s5";
    return k;
  }

  const SB_ACTION_LEGACY_ALIASES = {
    takeout: ["checkout"],
    gameon: ["myturnstart", "opponentturnstart", "turn_active_player"],
    "180": ["oneeighty"],
    "140": ["high140"],
    gameshot: ["winner"],
    busted: ["bust"],
    manual_reset_done: ["correction"],
    outside: ["miss", "specialmiss"],
    double: ["dbl"],
    triple: ["tpl"],
    bull: ["dbull"],
    s20_s1_s5: ["waschmaschine"],
    range_100_139: ["high100"]
  };

  function resolveActionSettingsKey(actionsObj, candidateNorm) {
    const want = normalizeTriggerKey(candidateNorm);
    if (!want || !actionsObj) return "";
    for (const k of Object.keys(actionsObj)) {
      if (normalizeTriggerKey(k) === want) return k;
    }
    return "";
  }

  function triggerMatchesRule(rule, emittedKey, payload = {}) {
    const trigger = normalizeTriggerKey(rule);
    const key = normalizeTriggerKey(emittedKey);
    if (!trigger || !key) return false;
    if (trigger === key) return true;
    /** WLED: gespeicherter Trigger `player_turn_alternate` hoert auf Bus-`player_turn`. */
    if (trigger === "player_turn_alternate" && key === "player_turn") return true;
    if (toUnifiedDispatchKey(trigger) === toUnifiedDispatchKey(key)) return true;

    let rangeRule = trigger;
    if (rangeRule === "high100") rangeRule = "range_100_139";
    const rangeMatch = rangeRule.match(/^range_(\d+)_(\d+)$/);
    if (rangeMatch) {
      const sumPayload = Number(payload?.sum);
      const sumKey = /^\d+$/.test(key) ? Number(key) : NaN;
      const sum = Number.isFinite(sumPayload) ? sumPayload : sumKey;
      if (!Number.isFinite(sum)) return false;
      const min = Number(rangeMatch[1]);
      const max = Number(rangeMatch[2]);
      return sum >= Math.min(min, max) && sum <= Math.max(min, max);
    }

    return false;
  }

  ADM.admTriggerKeys = {
    normalizeTriggerKey,
    toUnifiedDispatchKey,
    SB_ACTION_LEGACY_ALIASES,
    resolveActionSettingsKey,
    triggerMatchesRule
  };
})(self);

/**
 * ADM Trigger-Bus — ein Trigger-Key geht hier zentral raus:
 * optional Debug-Log (Hook von der Engine) → Custom Effects → Streamer.bot → WLED / OBS Zoom.
 * Die Engine entscheidet *wann* welcher Key feuert; der Bus *wie* er verarbeitet wird.
 */
(function initAdmTriggerBus(scope) {
  const ADM = scope.ADM || (scope.ADM = {});

  const Keys = () => ADM.admTriggerKeys;

  function getSettings() {
    return ADM.getSettings?.() || {};
  }

  function normalizeTriggerKey(value) {
    return Keys().normalizeTriggerKey(value);
  }

  function toUnifiedDispatchKey(rawNorm) {
    return Keys().toUnifiedDispatchKey(rawNorm);
  }

  function resolveActionSettingsKey(actionsObj, candidateNorm) {
    return Keys().resolveActionSettingsKey(actionsObj, candidateNorm);
  }

  function isModuleActive(moduleId) {
    const settings = getSettings();
    const installed = Array.isArray(settings?.installedModules) ? settings.installedModules : [];
    return installed
      .map((item) => String(item || "").trim().toLowerCase())
      .includes(String(moduleId || "").trim().toLowerCase());
  }

  function normalizeUsernameCompare(value) {
    let v = String(value || "").trim().toLowerCase();
    try {
      v = v.normalize("NFKD").replace(/\p{M}/gu, "");
    } catch (_) {}
    return v.replace(/\s+/g, "");
  }

  function getEffectsMyPlayerIndex() {
    const legacy = Number(getSettings()?.myPlayerIndex);
    if (Number.isFinite(legacy) && legacy >= 0) return legacy;
    return 0;
  }

  function isActivePlayerMeBySettings(playerIndex, playerName) {
    const configured = String(getSettings()?.myAutodartsUsername || "").trim();
    if (configured) {
      const a = normalizeUsernameCompare(configured);
      const b = normalizeUsernameCompare(playerName);
      return !!(a && b && a === b);
    }
    const myIdx = getEffectsMyPlayerIndex();
    return Number.isInteger(myIdx) && Number.isInteger(playerIndex) && playerIndex === myIdx;
  }

  function toTitleWords(text) {
    return String(text || "")
      .split(/[_\s-]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join(" ");
  }

  function formatPlayerTurnSuffix(displayName, template) {
    const raw = String(displayName || "").trim();
    if (!raw) return "";
    const titled = toTitleWords(raw.replace(/\s+/g, " "));
    const t = String(template || "{name} Turn").trim() || "{name} Turn";
    return t.replace(/\{name\}/gi, titled || raw);
  }

  function isTurnActivePlayerDispatchEffect(payload) {
    const e = String(payload?.effect || "");
    return (
      e === "turn_active_player_after_game_on" ||
      e === "turn_active_player_state" ||
      e === "turn_active_player_next_click"
    );
  }

  function isNamedTurnStreamerbotMode(settings) {
    return String(settings?.turnStartSbMode || "player_name").toLowerCase().trim() !== "my_opponent";
  }

  function resolveStreamerbotActionKey(unifiedKey, rawNorm, payload = {}) {
    const s = getSettings()?.actions || {};
    const direct = resolveActionSettingsKey(s, unifiedKey);
    if (direct) return direct;

    if (unifiedKey === "gameon") {
      const effGo = String(payload?.effect || "");
      if (isNamedTurnStreamerbotMode(getSettings())) {
        if (effGo === "gameon_game_event" || effGo === "gameon_navigation") {
          return "";
        }
      }
      const curr = Number(payload?.playerIndex ?? payload?.player);
      const activeName = String(payload?.playerName || "").trim();
      const currIsMe = isActivePlayerMeBySettings(curr, activeName);
      const sideKey = currIsMe ? "myturnstart" : "opponentturnstart";
      const fromSide = resolveActionSettingsKey(s, sideKey);
      if (fromSide) return fromSide;
    }

    const alts = Keys().SB_ACTION_LEGACY_ALIASES[unifiedKey];
    if (alts) {
      for (const a of alts) {
        const k = resolveActionSettingsKey(s, a);
        if (k) return k;
      }
    }
    const raw = normalizeTriggerKey(rawNorm);
    if (raw) {
      const rk = resolveActionSettingsKey(s, raw);
      if (rk) return rk;
    }
    return resolveActionSettingsKey(s, unifiedKey) || unifiedKey;
  }

  function stripAdmDispatchMeta(payload) {
    if (!payload || typeof payload !== "object") return payload;
    const rest = { ...payload };
    delete rest.__admSkipSb;
    delete rest.__admEffectAlts;
    delete rest._admTriggerSource;
    return rest;
  }

  function getCustomEffects() {
    try {
      const arr = JSON.parse(String(getSettings()?.customEffectsJson || "[]"));
      if (!Array.isArray(arr)) return [];
      return arr.filter((item) => item && typeof item === "object");
    } catch {
      return [];
    }
  }

  function fireCustomEffects(triggerKey, payload = {}, alternateRawNorm = null) {
    const firedActionKeys = new Set();
    if (!isModuleActive("effects")) return firedActionKeys;
    const key = normalizeTriggerKey(triggerKey);
    if (!key) return firedActionKeys;
    const altList = [];
    if (Array.isArray(alternateRawNorm)) {
      for (const a of alternateRawNorm) {
        const n = normalizeTriggerKey(a);
        if (n) altList.push(n);
      }
    } else if (alternateRawNorm) {
      const n = normalizeTriggerKey(alternateRawNorm);
      if (n) altList.push(n);
    }
    const customSentActionKeys = new Set();
    for (const item of getCustomEffects()) {
      if (item.enabled === false) continue;
      const matches =
        Keys().triggerMatchesRule(item.trigger, key, payload) ||
        altList.some((alt) => Keys().triggerMatchesRule(item.trigger, alt, payload));
      if (!matches) continue;
      const actionKey = String(item.key || "").trim();
      if (!actionKey) continue;
      const ak = normalizeTriggerKey(actionKey);
      if (ak && customSentActionKeys.has(ak)) continue;
      if (ak) customSentActionKeys.add(ak);
      ADM.fireActionByKey(actionKey, {
        ...payload,
        effect: "custom_effect",
        customEffectId: String(item.id || ""),
        customEffectName: String(item.name || ""),
        customTrigger: key
      });
      if (ak) firedActionKeys.add(ak);
    }
    return firedActionKeys;
  }

  function dispatchExternalTrigger(triggerKey, payload = {}) {
    const key = normalizeTriggerKey(triggerKey);
    if (!key) return;
    ADM.wled?.handleActionTrigger?.(key, payload);
    ADM.obsZoom?.handleActionTrigger?.(key, payload);
  }

  ADM.admTriggerBus = {
    /** Engine setzt diese Funktion nach Definition von logADTrigger (Lesbare Labels im Debug-Log). */
    __log: null,
    isModuleActive,
    emit(triggerKey, payload = {}) {
      const rawNorm = normalizeTriggerKey(triggerKey);
      if (!rawNorm) return;
      const key = toUnifiedDispatchKey(rawNorm);

      const extraAlts = Array.isArray(payload?.__admEffectAlts) ? payload.__admEffectAlts : [];
      const altDedup = new Set([rawNorm]);
      for (const a of extraAlts) {
        const n = normalizeTriggerKey(a);
        if (n) altDedup.add(n);
      }
      const customAltArg = altDedup.size > 1 ? [...altDedup] : rawNorm;

      try {
        if (typeof ADM.admTriggerBus.__log === "function") {
          ADM.admTriggerBus.__log(key, { ...payload, _admTriggerSource: rawNorm });
        }
      } catch (_) {}

      const effectsActive = isModuleActive("effects");
      const forwardPayload = stripAdmDispatchMeta(payload);
      const customFiredKeys = effectsActive ? fireCustomEffects(key, forwardPayload, customAltArg) : new Set();
      const sbKey = resolveStreamerbotActionKey(key, rawNorm, payload);
      const settingsDispatch = getSettings();
      let firedNamedTurnSb = false;
      if (
        effectsActive &&
        key === "gameon" &&
        isTurnActivePlayerDispatchEffect(payload) &&
        isNamedTurnStreamerbotMode(settingsDispatch) &&
        !payload?.__admSkipSb
      ) {
        const tpl = String(settingsDispatch?.turnStartSuffixTemplate || "{name} Turn");
        const suffix = formatPlayerTurnSuffix(String(payload?.playerName || "").trim(), tpl);
        if (suffix) {
          ADM.fireActionBySuffix?.(suffix, { ...forwardPayload, __skipExternalModules: true });
          firedNamedTurnSb = true;
        }
      }
      if (
        effectsActive &&
        !firedNamedTurnSb &&
        resolveActionSettingsKey(getSettings()?.actions || {}, sbKey) &&
        !customFiredKeys.has(normalizeTriggerKey(sbKey)) &&
        !payload?.__admSkipSb
      ) {
        ADM.fireActionByKey(sbKey, { ...forwardPayload, __skipExternalModules: true });
      }
      dispatchExternalTrigger(key, { ...forwardPayload, _admRawTrigger: rawNorm });
    }
  };
})(self);
