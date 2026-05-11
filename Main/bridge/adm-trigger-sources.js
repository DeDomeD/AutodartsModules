/**
 * ADM Trigger — Quellen (Service Worker)
 * Zusammengefasst: ehem. adm-trigger-source-websocket.js, -dom.js, -observed.js
 * WebSocket zuerst (setzt admTriggerBus.__log), danach DOM-/observed-Stubs.
 */
/**
 * Trigger-Quelle: WebSocket (Page-Script setzt bridgeSource === "websocket").
 * Nutzt ADM.admTriggerBus.emit und ADM.admTriggerKeys (Foundation-Bundle).
 */
(function initAdmTriggerSourceWebsocket(scope) {
  const ADM = scope.ADM || (scope.ADM = {});

  ADM.admTriggerSources = ADM.admTriggerSources || { list: [] };

  const Keys = () => ADM.admTriggerKeys;

  function normalizeTriggerKey(value) {
    return Keys().normalizeTriggerKey(value);
  }

  function getSettings() {
    return ADM.getSettings?.() || {};
  }

  function emit(key, payload) {
    ADM.admTriggerBus?.emit?.(key, payload);
  }

  function looksLikeDartSegmentOrThrowLabel(value) {
    const raw = String(value || "").trim();
    if (!raw) return false;
    const u = raw.toUpperCase().replace(/\s+/g, "");
    if (u === "BULL" || u === "DBULL") return true;
    if (/^M\d*$/.test(u)) return true;
    if (/^[SDT](?:[1-9]|1\d|20|25)$/.test(u)) return true;
    return false;
  }

  const SPECIAL_TRIPLES = new Set(["T20", "T19", "T18", "T17"]);

  const GAME_ON_BRIDGE_EVENT_KEYS = new Set([
    "gamestarted",
    "matchstarted",
    "gameon",
    "gamebegin",
    "matchbegin",
    "legstarted",
    "roundstarted",
    "sessionstarted",
    "boardstarted",
    "boardstarting",
    "playstarted",
    "playbegin",
    "matchplaystarted",
    "dartsessionstarted"
  ]);

  let lastGameOnWsAt = 0;
  let lastWsGameEventSig = "";
  let lastWsGameEventAt = 0;
  /** Verhindert doppeltes `gameshot+…` wenn WS-Game-Event und `handleState` denselben Leggewinn melden. */
  let lastGameshotPlusLegSig = "";

  function buildGameshotPlusLegSig(matchId, set, leg, throwName) {
    const tn = String(throwName || "").trim().toLowerCase();
    if (!tn) return "";
    return `${String(matchId ?? "").trim()}|${set ?? "_"}|${leg ?? "_"}|${tn}`;
  }

  function shouldEmitDedupedGameshotPlus(matchId, set, leg, throwName) {
    const sig = buildGameshotPlusLegSig(matchId, set, leg, throwName);
    if (!sig) return false;
    if (sig === lastGameshotPlusLegSig) return false;
    lastGameshotPlusLegSig = sig;
    return true;
  }

  function segmentToKey(segUpper) {
    return segUpper ? String(segUpper).toLowerCase() : "";
  }

  function hasSpecificTripleAction(segUpper) {
    const key = segmentToKey(segUpper);
    return !!(key && getSettings().actions?.[key]);
  }

  function getThrowTriggerName(t) {
    const segUpper = String(t?.segment || "").trim().toUpperCase();
    if (segUpper === "BULL" || segUpper === "DBULL") return segUpper.toLowerCase();
    const mult = Number(t?.multiplier);
    const num = Number(t?.number);
    if (Number.isFinite(mult) && Number.isFinite(num)) {
      if (mult === 3) return `t${num}`;
      if (mult === 2) return num === 25 ? "bull" : `d${num}`;
      if (mult === 1) return `s${num}`;
    }
    const segMatch = segUpper.match(/^([SDT])(\d{1,2})$/);
    if (segMatch) return `${segMatch[1].toLowerCase()}${Number(segMatch[2])}`;
    if (/^M(?:ISS)?/.test(segUpper) || segUpper === "OUTSIDE") return "outside";
    return "";
  }

  function normalizePlayerTriggerName(name) {
    const raw = String(name || "").trim().toLowerCase();
    if (!raw) return "";
    return raw.replace(/\s+/g, "_");
  }

  function getEventThrowTriggerName(e) {
    return getThrowTriggerName(
      e?.raw?.data?.body?.dart ??
        e?.raw?.body?.dart ??
        e?.raw?.data?.body ??
        e?.raw?.body ??
        e?.raw ??
        e
    );
  }

  function getEventTriggerKeys(e) {
    const rawName = String(e?.event || "").trim();
    const lower = rawName.toLowerCase();
    if (!lower) return [];

    const compact = lower.replace(/[\s-]+/g, "_");
    const keys = new Set([lower, compact]);
    const compactNoUnderscore = compact.replace(/_/g, "");

    if (compact === "bust") keys.add("busted");
    if (compact === "match_shot" || compact === "matchshot") keys.add("matchshot");
    if (compact === "takeoutfinish" || compact === "takeout_finish") keys.add("takeout_finished");
    if (["match_won", "match_finished", "match_finish", "match_end"].includes(compact)) keys.add("matchshot");
    if (["checkout", "check_out", "finish", "takeout"].includes(compact)) keys.add("takeout");
    if (["checkout_finished", "checkout_finish", "finish_finished", "finish_done"].includes(compact)) {
      keys.add("takeout_finished");
    }
    if (compactNoUnderscore === "boardstarting") keys.add("board_starting");
    if (compactNoUnderscore === "boardstarted") keys.add("board_started");
    if (compactNoUnderscore === "boardstopping") keys.add("board_stopping");
    if (compactNoUnderscore === "boardstopped") keys.add("board_stopped");
    if (compactNoUnderscore === "calibrationstarted") keys.add("calibration_started");
    if (compactNoUnderscore === "calibrationfinished") keys.add("calibration_finished");
    if (compactNoUnderscore === "manualresetdone") keys.add("manual_reset_done");
    if (compactNoUnderscore === "lobbyin") keys.add("lobby_in");
    if (compactNoUnderscore === "lobbyout") keys.add("lobby_out");
    if (compactNoUnderscore === "tournamentready") keys.add("tournament_ready");
    return Array.from(keys);
  }

  function isDuplicateGameEvent(e) {
    const name = String(e?.event || "unknown").toLowerCase();
    const sig = [name, e?.matchId ?? "", e?.set ?? "", e?.leg ?? "", e?.player ?? ""].join("|");
    const now = Date.now();
    if (sig === lastWsGameEventSig && now - lastWsGameEventAt < 180) return true;
    lastWsGameEventSig = sig;
    lastWsGameEventAt = now;
    return false;
  }

  function tryEmitGameOn(e, ctx) {
    const qk = String(e.event || "")
      .trim()
      .toLowerCase()
      .replace(/[\s._-]+/g, "");
    if (!qk) return;
    const variants = new Set([qk]);
    if (qk.endsWith("event") && qk.length > 5) variants.add(qk.slice(0, -5));
    let hit = false;
    for (const k of variants) {
      if (GAME_ON_BRIDGE_EVENT_KEYS.has(k)) hit = true;
    }
    if (!hit) return;
    const now = Date.now();
    if (now - lastGameOnWsAt < 2000) return;
    lastGameOnWsAt = now;
    const lastMerged = ctx?.getLastState?.() ?? null;
    const playerScoresForEmit =
      Array.isArray(lastMerged?.playerScores) && lastMerged.playerScores.length >= 2
        ? lastMerged.playerScores.map((x) => (Number.isFinite(Number(x)) ? Math.trunc(Number(x)) : null))
        : null;
    emit("gameon", {
      ...e,
      effect: "gameon_ws_event",
      ...(playerScoresForEmit ? { playerScores: playerScoresForEmit } : {})
    });
  }

  function handleThrow(t, ctx) {
    const meta = t?.__admVisitMeta;
    if (meta?.skipped) return;
    const settings = getSettings();

    /** Konsolen-Log immer (inkl. Bull-Off); Trigger-Kette unten nur außerhalb Cork. */
    try {
      ADM.triggerWorkerLog?.printAdmThrowLine?.({
        dartIndexInVisit: meta?.dartIndexInVisit ?? 1,
        segmentLabel: meta?.segmentLabel ?? "",
        score: meta?.score,
        isCorrection: !!meta?.isCorrection,
        isLegFinishOnBull: !!meta?.isLegFinishOnBull,
        isBullOffPhase: !!meta?.isBullOffPhase,
        throwerRemainingScore:
          meta?.throwerRemainingScore != null &&
          meta.throwerRemainingScore !== "" &&
          Number.isFinite(Number(meta.throwerRemainingScore))
            ? Number(meta.throwerRemainingScore)
            : null,
        remainingBeforeThrow:
          meta?.remainingBeforeThrow != null &&
          meta.remainingBeforeThrow !== "" &&
          Number.isFinite(Number(meta.remainingBeforeThrow))
            ? Number(meta.remainingBeforeThrow)
            : null,
        throwerAverageDisplay:
          meta?.throwerAverageDisplay != null && String(meta.throwerAverageDisplay).trim()
            ? String(meta.throwerAverageDisplay).trim()
            : null,
        bridgeSeq: Number(t?.bridgeSeq),
        throwerDisplayName: String(meta?.throwerDisplayName || "").trim(),
        matchId: t?.matchId ?? null,
        throwLogPlayerIndex:
          meta?.throwLogPlayerIndex != null && meta.throwLogPlayerIndex !== undefined
            ? meta.throwLogPlayerIndex
            : null,
        suppressPlayerTurnOnDart1: !!meta?.suppressPlayerTurnOnDart1
      });
    } catch (_) {}

    if (meta?.isBullOffPhase && settings.emitThrowTriggersDuringBullOffPhase !== true) return;

    const lastState = ctx.getLastState?.() ?? null;
    const playerScoresForEmit = Array.isArray(lastState?.playerScores)
      ? lastState.playerScores.map((x) => (Number.isFinite(Number(x)) ? Math.trunc(Number(x)) : null))
      : undefined;
    emit("throw", {
      ...t,
      effect: "throw",
      ...(playerScoresForEmit ? { playerScores: playerScoresForEmit } : {})
    });
    const throwTriggerName = getThrowTriggerName(t);
    if (throwTriggerName && throwTriggerName !== "outside") {
      emit(throwTriggerName, { ...t, effect: "throw_named" });
    }
    const rawThrowPlayerName = String(t?.playerName || "").trim();
    if (rawThrowPlayerName && !looksLikeDartSegmentOrThrowLabel(rawThrowPlayerName)) {
      const canonical = normalizePlayerTriggerName(rawThrowPlayerName) || rawThrowPlayerName.toLowerCase();
      if (canonical) emit(canonical, { ...t, effect: "player_throw" });
      if (/\b(bot|cpu)\b/i.test(rawThrowPlayerName)) {
        emit("bot_throw", { ...t, effect: "bot_throw" });
      }
    }
    if (!throwTriggerName && Number(t.score) === 0) {
      emit("outside", { ...t, effect: "outside" });
    }
    if (throwTriggerName === "outside") {
      emit("outside", { ...t, effect: "outside" });
    }

    const segUpper = String(t?.segment ?? "").toUpperCase();
    const pi = Number(t?.player);
    let remaining = NaN;
    if (Number.isFinite(pi) && Array.isArray(lastState?.playerScores)) {
      remaining = Number(lastState.playerScores[pi]);
    }
    const inDoubleOutRange = Number.isFinite(remaining) && remaining > 0 && remaining <= 40;

    if (t.score === 0 && inDoubleOutRange) {
      emit("specialMiss", {
        ...t,
        effect: "special_miss",
        remaining,
        __admSkipSb: !settings.enableSpecialMiss
      });
    }
    if (t.score === 0 && !(settings.missGuardOnDoubleOut && inDoubleOutRange)) {
      emit("miss", { ...t, effect: "throw_chain", __admSkipSb: !settings.enableMiss });
    }
    if (t.score === 25) {
      emit("bull", { ...t, effect: "throw_chain", __admSkipSb: !settings.enableBull });
    }
    if (t.score === 50) {
      emit("dbull", { ...t, effect: "throw_chain", __admSkipSb: !settings.enableDBull });
    }

    if (settings.enableBullCheckout !== false && t?.__admVisitMeta?.isLegFinishOnBull) {
      emit("bull_checkout", {
        ...t,
        effect: "bull_checkout"
      });
    }

    const isDoubleBull =
      t.score === 50 ||
      (t.multiplier === 2 && Number(t.number) === 25) ||
      String(t.segment || "").toUpperCase() === "DBULL";
    if (t.multiplier === 2 && t.score > 0 && !isDoubleBull) {
      emit("dbl", { ...t, effect: "throw_chain", __admSkipSb: !settings.enableDouble });
    }

    if (t.multiplier === 3) {
      const isSpecial = SPECIAL_TRIPLES.has(segUpper) && hasSpecificTripleAction(segUpper);
      if (isSpecial) {
        const k = segmentToKey(segUpper);
        const toggleId = `enable${segUpper}`;
        const already = k === throwTriggerName;
        if (!already && k) {
          emit(k, { ...t, effect: "throw_chain", __admSkipSb: settings[toggleId] === false });
        }
      } else {
        emit("tpl", { ...t, effect: "throw_chain", __admSkipSb: !settings.enableTriple });
      }
    }
  }

  function handleState(s) {
    const settings = getSettings();
    if (s.turnBusted) {
      emit("busted", { ...s, effect: "bust", __admSkipSb: !settings.enableBust });
    }
    if (s.gameFinished && s.winner != null) {
      const basePayload = { ...s, effect: "gameshot_state", winner: s.winner };
      emit("gameshot", basePayload);
      /**
       * Leggewinn + letzter Treffer (WLED-Pad `gameshot+…`): Worker-Zeile nutzt Checkout-Segment,
       * der Bus hatte hier oft nur `gameshot` ohne Suffix — dann greifen keine `gameshot+t20`-Regeln.
       */
      let lt = null;
      try {
        lt = typeof ADM.admTriggers?.getLastThrow === "function" ? ADM.admTriggers.getLastThrow() : null;
      } catch (_) {
        lt = null;
      }
      const throwName = lt && typeof lt === "object" ? getThrowTriggerName(lt) : "";
      if (
        throwName &&
        shouldEmitDedupedGameshotPlus(s?.matchId, s?.set, s?.leg, throwName)
      ) {
        emit(`gameshot+${throwName}`, { ...basePayload, throwName });
      }
    }
  }

  function handleGameEvent(e, ctx) {
    if (isDuplicateGameEvent(e)) return;
    const lastState = ctx.getLastState?.() ?? null;
    tryEmitGameOn(e, ctx);
    const payload = { ...e, effect: "game_event", state: lastState };
    const keys = getEventTriggerKeys(e);
    for (const k of keys) {
      const nk = normalizeTriggerKey(k);
      if (nk === "turn_start" || nk === "turn_end") continue;
      emit(k, payload);
    }
    const throwName = getEventThrowTriggerName(e);
    if (!throwName) return;
    if (keys.some((x) => normalizeTriggerKey(x) === "gameshot")) {
      const midGs = e?.matchId ?? lastState?.matchId;
      const setGs = e?.set ?? lastState?.set;
      const legGs = e?.leg ?? lastState?.leg;
      if (shouldEmitDedupedGameshotPlus(midGs, setGs, legGs, throwName)) {
        emit(`gameshot+${throwName}`, { ...payload, throwName });
      }
    }
    if (keys.some((x) => normalizeTriggerKey(x) === "matchshot")) {
      emit(`matchshot+${throwName}`, { ...payload, throwName });
    }
  }

  ADM.admTriggerSources.list.push({
    id: "websocket",
    bridgeSource: "websocket",
    match(payload) {
      return String(payload?.bridgeSource || "") === "websocket";
    },
    handleThrow,
    handleState,
    handleGameEvent
  });

  try {
    ADM.admTriggerBus.__log = (unifiedKey, payload) => {
      try {
        ADM.triggerWorkerLog?.logTriggerToStorage?.({
          trigger: Keys().normalizeTriggerKey(unifiedKey),
          label: String(unifiedKey || ""),
          effect: payload?.effect ?? "",
          player: payload?.player ?? null,
          segment: payload?.segment ?? null,
          recommendedSegment: payload?.recommendedSegment ?? null,
          bridgeSeq: Number(payload?.bridgeSeq) || null
        });
      } catch (_) {}
    };
  } catch (_) {}
})(self);

/**
 * Trigger-Quelle: DOM Custom-Events (Page-Script: bridgeSource === "dom").
 * Platzhalter — hier später z. B. emit(...) ergänzen, parallel zu WebSocket.
 */
(function initAdmTriggerSourceDom(scope) {
  const ADM = scope.ADM || (scope.ADM = {});
  ADM.admTriggerSources = ADM.admTriggerSources || { list: [] };

  ADM.admTriggerSources.list.push({
    id: "dom",
    bridgeSource: "dom",
    match(payload) {
      return String(payload?.bridgeSource || "") === "dom";
    },
    handleThrow(/* t, ctx */) {},
    handleState(/* s, ctx */) {},
    handleGameEvent(/* e, ctx */) {}
  });
})(self);

/**
 * Trigger-Quelle: beobachteter State (Page-Script: bridgeSource === "observed", DOM/window Scans).
 * Platzhalter — optional für Checkout-Hints ohne WS.
 */
(function initAdmTriggerSourceObserved(scope) {
  const ADM = scope.ADM || (scope.ADM = {});
  ADM.admTriggerSources = ADM.admTriggerSources || { list: [] };

  ADM.admTriggerSources.list.push({
    id: "observed",
    bridgeSource: "observed",
    match(payload) {
      return String(payload?.bridgeSource || "") === "observed";
    },
    handleThrow(/* t, ctx */) {},
    handleState(/* s, ctx */) {},
    handleGameEvent(/* e, ctx */) {}
  });
})(self);
