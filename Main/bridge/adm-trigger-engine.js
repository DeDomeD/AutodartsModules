/**
 * ADM Trigger-Engine — Snapshot/Overlay/OBS-Zoom; Trigger laufen über `ADM.admTriggerSources.list`
 * (Trigger-Quellen: `adm-trigger-sources.js` — WebSocket aktiv, DOM/observed derzeit Stubs).
 * Trigger-Uebersicht: `Main/docs/adm-triggers-worker-background.md`.
 */
(function initAdmTriggerEngine(scope) {
  const ADM = scope.ADM || (scope.ADM = {});

  const cloneValue = (value) => {
    if (value === undefined) return undefined;
    if (typeof structuredClone === "function") {
      try {
        return structuredClone(value);
      } catch {}
    }
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return value;
    }
  };

  let lastState = null;
  let lastKnownActivePlayer = null;
  const lastKnownPlayerNameByIndex = {};

  function clearMatchScopedPlayerMemory() {
    for (let i = 0; i < 16; i += 1) {
      delete lastKnownPlayerNameByIndex[i];
    }
    lastKnownActivePlayer = null;
  }

  function checkoutThresholdFromSettings() {
    const settings = ADM.getSettings?.() || {};
    return Math.max(2, Math.min(170, Number(settings.checkoutTriggerThreshold) || 170));
  }

  const runtimeState = {
    lastState: null,
    lastThrow: null,
    lastGameEvent: null,
    lastUiEvent: null,
    lastKnownActivePlayer: null,
    visitDarts: [],
    visitThrows: [],
    checkout: null,
    updatedAt: 0,
    /** Pro Match: DOM-„Game ON“ nur vor dem ersten Wurf */
    throwCountThisMatch: 0,
    matchIdForThrowCounter: null,
    /**
     * Ab 2 Spielern: Werfer nur über Round-Robin (Dart 1–3 gleicher Index, dann +1).
     * Unabhängig von Visit-Tracker/Reconcile — verhindert Off-by-one mit API/Game-ON.
     */
    visitRotationPlayer: 0,
    /** 0..2 = wie viele Würfe dieser Aufnahme schon gezählt sind (nächster Wurf = +1). */
    visitDartsCompletedInTurn: 0,
    /** Live-Spiel erlaubt: Navigation `/matches/…` oder belastbarer `dom_play_snapshot` (2 Namen + Modus/Match). */
    gameOnUrlAllowed: false,
    /** Aus Game-ON-Roster / Page / State — für Round-Robin nach 3 Darts (nicht nur 2 Spieler). */
    rosterParticipantCount: 0,
    /** DOM `#ad-ext-game-variant` (z. B. „Bull-off“, „501“) — Cork-Phase, nicht Leg-Checkout. */
    gameVariantLabel: "",
    /** DOM: z. B. `X01 / 301 / SI-DO` aus der gleichen `ul` wie `ad-ext-game-variant`. */
    matchFormatSummary: "",
    /** Nach Bull-Off → X01: ersten Leg-Werfer erneut aus Hint setzen (Gewinner beginnt). */
    pendingLegStartRotationSeed: false,
    /** Letztes Page-`match_context`-Roster (zuverlässiger als 3. Geister-Slot im WS-State). */
    matchContextRosterNames: [],
    /** Kanonische Match-ID fürs Game-ON-Dedupe (URL / WS / Page) — verhindert Doppel-Logs bei `_` vs. echter Id. */
    playPathMatchId: "",
    /** Page `#ad-ext-player-display` — Rest + Ø pro Spaltenindex */
    domPlayerDisplayByIndex: [],
    /** Zuletzt geloggter Turn-Preamble (Player Turn vor Wurf 1) */
    lastTurnPreambleLoggedKey: "",
    /** Während `printTurnPreamble` — verhindert Doppel-Logging */
    turnPreambleEmitInFlightKey: "",
    turnPreambleLogSeq: 0,
    /** Letzter Player-Turn-Index/-Name aus DOM — Fallback für Leg-Win-Name. */
    lastTurnPlayerIndex: null,
    lastTurnPlayerName: "",
    /** Zuletzt für Player-Turn geloggter aktiver Spaltenindex (DOM: `.ad-ext-player-active` vs. inactive) */
    lastDomLoggedActivePlayerIndex: null,
    /** Letzter aktiver Spaltenindex aus `#ad-ext-player-display` (für Werfer-Zuordnung, auch Bull-Off). */
    domLiveActivePlayerIndex: null,
    /** Dedupe: eine Leg-Win-Zeile pro Leg + Gewinner */
    lastLegWinLoggedKey: "",
    /** Dedupe: eine „Next Leg“-Zeile pro neuem Leg (Set/Leg-Key) */
    lastNextLegLoggedKey: "",
    /** Letzter DOM-Spielstand (Page `dom_play_snapshot`) — Hauptquelle für stabile Turn-/Dart-Anzeige */
    lastDomPlaySnapshot: null,
    lastDomPlaySnapshotAt: 0,
    /** Bust aus DOM-Turnbox, rising-edge dedupe. */
    lastDomBustSeen: false,
    /** Bust-Log-Dedupe (WS + DOM). */
    lastBustLogAtTs: 0,
    /** Aktiver Spaltenindex nach dem letzten `applyDomPlaySnapshotToRuntime` (Spaltenwechsel trotz filled≥1). */
    lastDomSnapshotAppliedActiveIndex: null,
    /** Dedupe: ein Bull-Off-„Game ON“ pro Match/Set/Leg (unabhängig von `printGameOnOnce`-Fingerprint). */
    bullOffGameOnGate: "",
    /** Dedupe-Fallback für Bull-Off-Game-ON ohne stabile matchId (Roster + Set/Leg). */
    bullOffGameOnRosterGate: "",
    /** Bull-Off wurde erkannt/gestartet, auch wenn `dom_game_variant` verspätet kommt. */
    bullOffPhaseLatched: false,
    /** Zusätzlicher Kurzzeit-Dedupe gegen doppeltes Bull-Off-Game-ON. */
    lastBullOffGameOnRosterFp: "",
    lastBullOffGameOnAtTs: 0,
    /**
     * Nach entschiedenem Cork: Spaltenindex des Gewinners, solange Bull-Off-Phase aktiv.
     * Bleibt gesetzt, wenn die Seite die Cork-Zahlen oben leert — sonst käme noch ein Player Turn für den Verlierer.
     */
    bullOffCorkWinnerIndex: null,
    /** Kurze Sperre gegen verspätete DOM-Player-Turn-Logs direkt nach Leg/Game-Finish. */
    suppressDomPlayerTurnUntilTs: 0,
    /** Bull-Off: letzte geloggte Player-Turn-Zeit (gegen Doppel-Logs beim Start). */
    lastBullOffPlayerTurnAt: 0,
    /** Bull-Off: letzter Werferindex für Abschluss-Logik (2 Spieler, kein unnötiger dritter Turn). */
    bullOffLastThrowPlayerIndex: null,
    /** Bull-Off: fortlaufender Wurfzaehler (ein Dart = ein Zyklus). */
    bullOffThrowSerial: 0,
    /** Bull-Off: Player-Turn wurde fuer diesen Wurfzyklus bereits geloggt. */
    bullOffTurnPromptSerial: -1,
    /** Letzter brauchbarer Wurf pro Spieler (für Leg-Win-Fallback bei Korrektur). */
    lastThrowInfoByPlayer: {},
    /** Dedupe: zuletzt geloggter Checkout-Guide aus `dom_checkout` (Segment|nextThrow|Visit-Punkte). */
    lastDomCheckoutGuideSig: "",
    /** `autodarts.boards` — `status === "Takeout in progress"` */
    wsBoardTakeoutInProgress: false,
    /** DOM Board-Status-Link zeigt Takeout (✊). */
    lastDomBoardTakeoutHint: false,
    /** Kombination WS+DOM — Kantenerkennung für Worker-Zeilen. */
    lastTakeoutCombinedActive: false
  };
  /** Prozessweite Kurzzeit-Sperre: verhindert doppeltes Bull-Off-Game-ON trotz Runtime-Reset/MatchId-Wechsel. */
  let globalBullOffGameOnRosterFp = "";
  let globalBullOffGameOnAtTs = 0;

  function domSnapshotMatchesCurrentMatch(obs) {
    if (!obs) return false;
    const sm = String(obs.matchId ?? "").trim();
    const lm = String(lastState?.matchId ?? "").trim();
    if (!lm) return true;
    if (!sm) return true;
    return sm === lm;
  }

  /** Letzter DOM-Snapshot zum gleichen Match (ohne Zeitfenster) — Werfer/Leg nur aus der Seite. */
  function getLastDomPlaySnapshotIfMatch() {
    const obs = runtimeState.lastDomPlaySnapshot;
    if (!obs || typeof obs !== "object") return null;
    if (!domSnapshotMatchesCurrentMatch(obs)) return null;
    return obs;
  }

  /**
   * Bull-Off: `topScoreDisplay` aus dem Snapshot auch nutzen, wenn `matchId` kurz mit WS/State
   * auseinanderläuft — sonst bleibt nur API-„Rest“ (oft 0) und die pinke Zahl wird 0.
   */
  function getDomPlaySnapshotForBullTopBoxRead() {
    const matched = getLastDomPlaySnapshotIfMatch();
    if (matched && Array.isArray(matched.players) && matched.players.length) return matched;
    if (!isBullOffPhaseActive()) return matched;
    const raw = runtimeState.lastDomPlaySnapshot;
    if (raw && typeof raw === "object" && Array.isArray(raw.players) && raw.players.length) return raw;
    return matched;
  }

  function domPlayerStripAtIndex(idx) {
    if (!Number.isInteger(idx) || idx < 0 || !Array.isArray(runtimeState.domPlayerDisplayByIndex)) {
      return null;
    }
    if (idx >= runtimeState.domPlayerDisplayByIndex.length) return null;
    return runtimeState.domPlayerDisplayByIndex[idx];
  }

  /** Abstand/Treffer aus Snapshot + optional gleicher Strip (Cork-Zeile in der Konsole). */
  function pickBullOffProximityFromSnapshotAndStrip(obsSnap, pi, stripHint) {
    if (!Number.isInteger(pi) || pi < 0) return null;
    const ds = stripHint != null ? stripHint : domPlayerStripAtIndex(pi);
    const dsRem = ds != null && Number.isFinite(Number(ds.remaining)) ? Number(ds.remaining) : null;
    const pl = obsSnap?.players?.[pi];
    let topCork = null;
    if (pl?.topScoreDisplay != null && Number.isFinite(Number(pl.topScoreDisplay))) {
      topCork = Math.trunc(Number(pl.topScoreDisplay));
    } else if (pl?.bullProximity != null && Number.isFinite(Number(pl.bullProximity))) {
      topCork = Math.trunc(Number(pl.bullProximity));
    } else if (pl && Number.isFinite(Number(pl.scoreRemaining))) {
      const sr = Number(pl.scoreRemaining);
      if (sr < 0 || sr === 25 || sr === 50) topCork = sr;
    }
    if (dsRem != null && dsRem !== 0) return dsRem;
    if (topCork != null && Number.isFinite(topCork) && topCork !== 0) return topCork;
    if (dsRem != null && Number.isFinite(dsRem)) return dsRem;
    return topCork != null && Number.isFinite(topCork) ? topCork : null;
  }

  function normalizeNameLookupKey(raw) {
    return String(raw || "").trim().toLowerCase().replace(/\s+/g, "");
  }

  function pickBullOffProximityFromDomStripsByName(playerName) {
    const strips = Array.isArray(runtimeState.domPlayerDisplayByIndex)
      ? runtimeState.domPlayerDisplayByIndex
      : [];
    if (!strips.length) return { value: null, strip: null };

    const key = normalizeNameLookupKey(playerName);
    if (key) {
      for (const strip of strips) {
        const stripKey = normalizeNameLookupKey(strip?.name);
        const rem = Number(strip?.remaining);
        if (!stripKey || !Number.isFinite(rem)) continue;
        if (stripKey === key || stripKey.includes(key) || key.includes(stripKey)) {
          return { value: rem, strip };
        }
      }
    }

    let fallback = null;
    for (const strip of strips) {
      const rem = Number(strip?.remaining);
      if (!Number.isFinite(rem)) continue;
      if (rem !== 0) return { value: rem, strip };
      if (!fallback) fallback = { value: rem, strip };
    }
    return fallback || { value: null, strip: null };
  }

  function bullOffRoundNeedsContinuation() {
    try {
      const obs = getDomPlaySnapshotForBullTopBoxRead();
      const pLen = Array.isArray(obs?.players) ? obs.players.length : 0;
      if (pLen >= 2) {
        const r0 = bullCorkRankFromPlayerOrStrip(obs.players[0], 0);
        const r1 = bullCorkRankFromPlayerOrStrip(obs.players[1], 1);
        if (r0 != null && r1 != null) return r0 === r1;
      }
      const strips = Array.isArray(runtimeState.domPlayerDisplayByIndex)
        ? runtimeState.domPlayerDisplayByIndex
        : [];
      if (strips.length >= 2) {
        const r0 = bullCorkRankFromPlayerOrStrip(null, 0);
        const r1 = bullCorkRankFromPlayerOrStrip(null, 1);
        if (r0 != null && r1 != null) return r0 === r1;
      }
    } catch (_) {}
    return true;
  }

  function buildSyntheticStateFromDomSnapshot(obs) {
    const pss = obs.playerScoresRemaining;
    const scores = Array.isArray(pss)
      ? pss.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n >= 0 && n <= 1002)
      : [];
    const ai = asValidPlayerIndex(obs.activePlayerIndex);
    const ars = Number(obs.activeRemainingScore);
    return {
      player: ai !== null ? ai : undefined,
      playerScores: scores.length ? scores : null,
      remainingScore: Number.isFinite(ars) && ars >= 0 ? ars : null,
      matchId: obs.matchId ?? null,
      raw: {}
    };
  }

  function mergeLastStateWithDomSnapshot(stateLike) {
    const obs = getLastDomPlaySnapshotIfMatch();
    if (!obs) return stateLike;
    if (!stateLike || typeof stateLike !== "object") {
      return buildSyntheticStateFromDomSnapshot(obs);
    }
    const base = { ...stateLike };
    const pss = obs.playerScoresRemaining;
    if (Array.isArray(pss) && pss.length > 0) {
      const mergedScores = Array.isArray(base.playerScores) ? [...base.playerScores] : [];
      for (let i = 0; i < pss.length; i += 1) {
        if (pss[i] == null) continue;
        const n = Number(pss[i]);
        if (Number.isFinite(n) && n >= 0 && n <= 1002) mergedScores[i] = n;
      }
      base.playerScores = mergedScores.length ? mergedScores : base.playerScores;
    }
    const ai = asValidPlayerIndex(obs.activePlayerIndex);
    if (ai !== null) base.player = ai;
    const ars = Number(obs.activeRemainingScore);
    if (Number.isFinite(ars) && ars >= 0 && ars <= 1002) base.remainingScore = ars;
    return base;
  }

  function mapSnapshotPlayersToDisplayStrips(players) {
    if (!Array.isArray(players) || !players.length) return [];
    return players.map((p) => {
      let average = null;
      if (p?.averageLeg != null && p?.averageMatch != null) {
        average = `${p.averageLeg} / ${p.averageMatch}`;
      } else if (p?.averageMatch != null) average = String(p.averageMatch);
      else if (p?.averageLeg != null) average = String(p.averageLeg);
      const topBox =
        p?.topScoreDisplay != null && Number.isFinite(Number(p.topScoreDisplay))
          ? Math.trunc(Number(p.topScoreDisplay))
          : null;
      const cork =
        p?.bullProximity != null && Number.isFinite(Number(p.bullProximity))
          ? Math.trunc(Number(p.bullProximity))
          : null;
      const remX01 =
        p?.scoreRemaining != null && Number.isFinite(Number(p.scoreRemaining))
          ? Number(p.scoreRemaining)
          : null;
      return {
        name: p?.displayName != null ? String(p.displayName).replace(/\s+/g, " ").trim() || null : null,
        remaining: topBox != null ? topBox : cork != null ? cork : remX01,
        average
      };
    });
  }

  function getDomTurnDartHintForTracker() {
    const obs = getLastDomPlaySnapshotIfMatch();
    if (!obs) return null;
    const active = asValidPlayerIndex(obs.activePlayerIndex);
    const filled = Number(obs.turn?.filledSlotCount);
    if (active === null || !Number.isFinite(filled)) return null;
    return {
      activePlayerIndex: active,
      dartsInTurn: Math.max(0, Math.min(3, Math.trunc(filled)))
    };
  }

  function applyDomPlaySnapshotToRuntime(obs) {
    if (!obs || typeof obs !== "object") return;
    const mode = resolveDomSnapshotMode(obs);
    if (!isBullOffPhaseLabel(obs.header?.gameVariant || "")) {
      runtimeState.pendingLegStartRotationSeed = false;
    }
    const pc = effectiveParticipantCount(lastState);
    if (mode === MODE_X01 && pc >= 2 && domSnapshotMatchesCurrentMatch(obs)) {
      const filled = Number(obs.turn?.filledSlotCount);
      if (Number.isFinite(filled)) {
        runtimeState.visitDartsCompletedInTurn = Math.max(0, Math.min(3, Math.trunc(filled)));
      }
      const ai = asValidPlayerIndex(obs.activePlayerIndex);
      if (ai !== null && ai < pc) {
        runtimeState.visitRotationPlayer = ai;
      }
    }
    const strips = mapSnapshotPlayersToDisplayStrips(obs.players);
    if (strips.length) {
      runtimeState.domPlayerDisplayByIndex = strips;
    }
    if (mode === MODE_BULL_OFF) {
      syncBullOffCorkWinnerLock(obs);
      tryMaybeLogBullOffGameOnFromDomSnapshot(obs);
    } else {
      syncBullOffCorkWinnerLock(obs);
      /** X01-Reihenfolge: genau ein Game ON vor Player Turn. */
      tryLogGameOnFromDomPlaySnapshot(obs);
    }
    const dai = asValidPlayerIndex(obs.activePlayerIndex);
    if (dai !== null) {
      runtimeState.domLiveActivePlayerIndex = dai;
      tryEmitDomPlayerTurnIfIndexChanged(dai, obs);
      runtimeState.lastDomSnapshotAppliedActiveIndex = dai;
    }
    try {
      ADM.admThrowVisitTracker?.reconcileFromDomSnapshot?.(obs, lastState);
    } catch (_) {}
    try {
      syncEngineVisitCountersFromTracker();
    } catch (_) {}
  }

  function extractMatchIdFromPathname(pathname) {
    try {
      const p = String(pathname || "");
      const m = p.match(/\/(?:matches|match|games|lobbies)\/([a-f0-9-]{8,}|[\w-]{6,})/i);
      return m ? m[1] : null;
    } catch {
      return null;
    }
  }

  /** Eine Zeile für Dedupe/Fingerprint — nicht mal mit „_“ und mal mit echter Id. */
  function resolveMatchIdForGameOn(stateLike, hint) {
    const h = String(hint ?? "").trim();
    if (h) return h;
    if (stateLike && typeof stateLike === "object") {
      const sm = String(stateLike.matchId ?? "").trim();
      if (sm) return sm;
    }
    const throwMid = String(runtimeState.matchIdForThrowCounter ?? "").trim();
    if (throwMid) return throwMid;
    const cached = String(runtimeState.playPathMatchId ?? "").trim();
    if (cached) return cached;
    return "_";
  }

  function rememberPlayPathMatchId(id) {
    const t = String(id ?? "").trim();
    if (t) runtimeState.playPathMatchId = t;
  }

  function isBullOffPhaseLabel(text) {
    return /bull[-\s]?off/i.test(String(text || ""));
  }

  /** Cork-Wertung: höher = besser (`50` > `25` > `-1` > `-2` …). `null` = noch kein Treffer / unbekannt. */
  function corkProximityRankValue(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return null;
    if (v === 50) return 1_000_000;
    if (v === 25) return 999_999;
    if (v < 0) return 500_000 + v;
    return null;
  }

  function bullCorkRankFromPlayerOrStrip(playerObj, stripIdx) {
    if (playerObj && typeof playerObj === "object") {
      if (playerObj.bullProximity != null && Number.isFinite(Number(playerObj.bullProximity))) {
        return corkProximityRankValue(Number(playerObj.bullProximity));
      }
      const sr = Number(playerObj.scoreRemaining);
      if (Number.isFinite(sr) && (sr < 0 || sr === 25 || sr === 50)) {
        return corkProximityRankValue(sr);
      }
    }
    const strips = runtimeState.domPlayerDisplayByIndex;
    if (Array.isArray(strips) && strips[stripIdx] != null && Number.isFinite(Number(strips[stripIdx].remaining))) {
      return corkProximityRankValue(Number(strips[stripIdx].remaining));
    }
    return null;
  }

  /** Gleichstand → Lock löschen; unterschiedliche Ranks → Gewinner merken (für Player-Turn nach geleertem DOM). */
  function syncBullOffCorkWinnerLock(obs) {
    try {
      if (!isBullOffPhaseActive()) {
        runtimeState.bullOffCorkWinnerIndex = null;
        return;
      }
      const players = obs?.players;
      if (!Array.isArray(players) || players.length < 2) return;
      const r0 = bullCorkRankFromPlayerOrStrip(players[0], 0);
      const r1 = bullCorkRankFromPlayerOrStrip(players[1], 1);
      if (r0 != null && r1 != null) {
        if (r0 === r1) runtimeState.bullOffCorkWinnerIndex = null;
        else runtimeState.bullOffCorkWinnerIndex = r0 > r1 ? 0 : 1;
      }
    } catch (_) {}
  }

  /**
   * Snapshot zeigt Cork-Abstände (nur gesetzt, wenn die Page schon Bull-Off-DOM erkannt hat).
   */
  function domPlaySnapshotIndicatesBullOffCork(obs) {
    if (!obs || typeof obs !== "object") return false;
    const players = obs.players;
    if (!Array.isArray(players) || !players.length) return false;
    for (let i = 0; i < players.length; i += 1) {
      const p = players[i];
      if (p?.bullProximity == null) continue;
      const n = Number(p.bullProximity);
      if (Number.isFinite(n)) return true;
    }
    return false;
  }

  /** Snapshot-Header zeigt schon ein normales Scoring-Spiel (X01 o. Ä.) — dann kein „Cork=Bull-Off“ aus Proximity allein. */
  function headerImpliesScoringGameNotCork(header) {
    if (!header || typeof header !== "object") return false;
    const gv0 = String(header.gameVariant || "").trim().toLowerCase();
    if (gv0) {
      if (/bull[-\s]?off/.test(gv0)) return false;
      if (/\b(301|501|701|1001)\b/.test(gv0)) return true;
      if (/\bx01\b/.test(gv0)) return true;
      if (/\b(cricket|shanghai|count|segment|gotcha|bermuda|around|atc|rtw|random|bob)\b/i.test(gv0)) return true;
      return false;
    }
    const parts = Array.isArray(header.formatParts) ? header.formatParts : [];
    const joined = parts.map((x) => String(x || "").trim()).join(" ").toLowerCase();
    if (!joined) return false;
    if (/bull[-\s]?off/.test(joined)) return false;
    if (/\b(301|501|701|1001)\b/.test(joined)) return true;
    if (/\bx01\b/.test(joined)) return true;
    return false;
  }

  /** Cork-Zeilen im Snapshot nur werten, wenn sie nicht offensichtlich aus einem X01-/Scoring-Kontext stammen. */
  function domCorkMeansBullOffNotX01Noise(obs) {
    if (!domPlaySnapshotIndicatesBullOffCork(obs)) return false;
    if (headerImpliesScoringGameNotCork(obs?.header)) return false;
    return true;
  }

  /**
   * Bull-Off: Label aus Runtime **oder** aus letztem DOM-Snapshot (gleiches Match).
   * Ohne Snapshot-Abgleich kommen WS-Würfe oft **vor** `dom_game_variant` — dann feuern fälschlich `throw` / `bull` / `dbull`.
   */
  function isBullOffPhaseActive() {
    if (runtimeState.bullOffPhaseLatched) return true;
    if (isBullOffPhaseLabel(runtimeState.gameVariantLabel)) return true;
    try {
      const obs = getLastDomPlaySnapshotIfMatch();
      if (!obs) return false;
      const gv = String(obs?.header?.gameVariant || "").trim();
      if (isBullOffPhaseLabel(gv)) return true;
      if (domCorkMeansBullOffNotX01Noise(obs)) return true;
    } catch (_) {}
    return false;
  }

  /** Mode-Abschnitte: Bull-off und X01 strikt trennen. */
  const MODE_BULL_OFF = "bull_off";
  const MODE_X01 = "x01";

  function resolveDomSnapshotMode(obs) {
    if (isBullOffPhaseActive()) return MODE_BULL_OFF;
    const gv = String(obs?.header?.gameVariant || "").trim();
    if (isBullOffPhaseLabel(gv)) return MODE_BULL_OFF;
    if (obs && domCorkMeansBullOffNotX01Noise(obs)) return MODE_BULL_OFF;
    return MODE_X01;
  }

  /** Takeout-Zeilen nur X01, nicht Cork/Bull-Off. */
  function takeoutWorkerSignalsAllowed() {
    if (isBullOffPhaseActive()) return false;
    const obs = getLastDomPlaySnapshotIfMatch();
    if (obs) return resolveDomSnapshotMode(obs) === MODE_X01;
    const gv = String(runtimeState.gameVariantLabel || "").trim();
    if (gv && isBullOffPhaseLabel(gv)) return false;
    return true;
  }

  function maybeEmitTakeoutWorkerLines() {
    if (!takeoutWorkerSignalsAllowed()) return;
    const ws = runtimeState.wsBoardTakeoutInProgress === true;
    const dom = runtimeState.lastDomBoardTakeoutHint === true;
    const nowActive = ws || dom;
    const was = runtimeState.lastTakeoutCombinedActive === true;
    try {
      const tw = ADM.triggerWorkerLog;
      if (nowActive && !was) {
        tw?.printTakeoutStartLine?.();
      } else if (!nowActive && was) {
        tw?.printTakeoutFinishedLine?.();
      }
    } catch (_) {}
    runtimeState.lastTakeoutCombinedActive = nowActive;
  }

  function syncRuntimeState(patch = {}) {
    Object.assign(runtimeState, patch, { updatedAt: Date.now() });
  }

  function getSnapshot() {
    return {
      lastState: cloneValue(runtimeState.lastState),
      lastThrow: cloneValue(runtimeState.lastThrow),
      lastGameEvent: cloneValue(runtimeState.lastGameEvent),
      lastUiEvent: cloneValue(runtimeState.lastUiEvent),
      lastKnownActivePlayer: runtimeState.lastKnownActivePlayer,
      visitDarts: cloneValue(runtimeState.visitDarts) || [],
      visitThrows: cloneValue(runtimeState.visitThrows) || [],
      checkout: cloneValue(runtimeState.checkout),
      gameVariantLabel: String(runtimeState.gameVariantLabel || ""),
      matchFormatSummary: String(runtimeState.matchFormatSummary || ""),
      pendingLegStartRotationSeed: !!runtimeState.pendingLegStartRotationSeed,
      updatedAt: runtimeState.updatedAt || 0,
      lastDomPlaySnapshot: cloneValue(runtimeState.lastDomPlaySnapshot),
      lastDomPlaySnapshotAt: runtimeState.lastDomPlaySnapshotAt || 0
    };
  }

  function asValidPlayerIndex(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    if (!Number.isInteger(n)) return null;
    if (n < 0 || n > 15) return null;
    return n;
  }

  function readPlayerName(playerObj, fallback = "") {
    if (typeof playerObj === "string") {
      const t = String(playerObj || "").trim();
      return t || fallback;
    }
    if (!playerObj || typeof playerObj !== "object") return fallback;
    const cand =
      playerObj.name ??
      playerObj.displayName ??
      playerObj.nickname ??
      playerObj.username ??
      playerObj.userName ??
      playerObj.playerName ??
      playerObj.liveName ??
      playerObj.publicName ??
      playerObj.tagLine ??
      playerObj?.player?.name ??
      playerObj?.user?.name ??
      playerObj?.user?.displayName ??
      playerObj?.profile?.name ??
      "";
    const out = String(cand || "").trim();
    return out || fallback;
  }

  const PLAYER_LIST_KEYS = ["players", "participants", "competitors"];

  function firstPlayerArrayOnRoot(root) {
    if (!root || typeof root !== "object") return null;
    for (const key of PLAYER_LIST_KEYS) {
      const ar = root[key];
      if (Array.isArray(ar) && ar.length > 0) return ar;
    }
    return null;
  }

  function getPlayerNameByIndex(stateLike, idx, fallback = "") {
    const i = Number(idx);
    if (!Number.isFinite(i) || i < 0) return fallback;
    const roots = [stateLike?.raw?.state, stateLike?.raw, stateLike].filter((x) => x && typeof x === "object");
    for (const root of roots) {
      const ar = firstPlayerArrayOnRoot(root);
      if (ar && ar[i] != null) {
        const name = readPlayerName(ar[i], "");
        if (name) return name;
      }
      for (const child of Object.values(root)) {
        if (!child || typeof child !== "object") continue;
        const ar2 = firstPlayerArrayOnRoot(child);
        if (ar2 && ar2[i] != null) {
          const name = readPlayerName(ar2[i], "");
          if (name) return name;
        }
      }
      const deepRow = deepFindNthPlayerRow(root, i, 7, 200);
      if (deepRow) {
        const name = readPlayerName(deepRow, "");
        if (name) return name;
      }
    }
    return fallback;
  }

  function extractPlayerNameFromTurnsForIndex(stateLike, activeIndex) {
    const ai = Number(activeIndex);
    if (!Number.isInteger(ai) || ai < 0) return "";
    const roots = [stateLike?.raw?.state, stateLike?.raw].filter((x) => x && typeof x === "object");
    for (const root of roots) {
      const turns = root.turns;
      if (!Array.isArray(turns) || !turns.length) continue;
      for (let k = turns.length - 1; k >= 0; k -= 1) {
        const turn = turns[k];
        if (!turn || typeof turn !== "object") continue;
        const tp = asValidPlayerIndex(turn.player ?? turn.playerIndex ?? turn.playerId);
        if (tp !== ai) continue;
        const direct =
          String(turn.playerName || turn.name || turn.displayName || turn.nickname || "").trim();
        if (direct) return direct;
        const nested = readPlayerName(turn.player || turn.user || {}, "");
        if (nested) return nested;
        break;
      }
    }
    return "";
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

  function sanitizePlayerDisplayName(raw) {
    const s = String(raw || "").trim();
    if (!s || looksLikeDartSegmentOrThrowLabel(s)) return "";
    return s;
  }

  /** Ein Wort (Spielername): einheitliche Schreibweise, damit Preamble und Wurfzeile nicht doppelt wirken. */
  function normalizeConsolePlayerName(raw) {
    const s = sanitizePlayerDisplayName(raw);
    if (!s) return "";
    if (/^[a-zA-ZäöüÄÖÜß]{2,28}$/.test(s)) {
      return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
    }
    return s;
  }

  function rememberPlayerName(index, name) {
    const i = Number(index);
    const n = sanitizePlayerDisplayName(name);
    if (!Number.isInteger(i) || i < 0 || !n) return;
    lastKnownPlayerNameByIndex[i] = n;
  }

  function rememberPlayerNamesFromState(stateLike) {
    const roots = [stateLike?.raw?.state, stateLike?.raw, stateLike].filter((x) => x && typeof x === "object");
    for (const root of roots) {
      const rememberFromArray = (ar) => {
        if (!Array.isArray(ar)) return;
        for (let j = 0; j < ar.length; j += 1) {
          rememberPlayerName(j, readPlayerName(ar[j], ""));
        }
      };
      rememberFromArray(firstPlayerArrayOnRoot(root));
      for (const child of Object.values(root)) {
        if (!child || typeof child !== "object") continue;
        rememberFromArray(firstPlayerArrayOnRoot(child));
      }
    }
  }

  function getPreferredPlayerName(stateLike, idx, fallback = "") {
    const i = Number(idx);
    if (!Number.isInteger(i) || i < 0) return fallback;
    const strips = runtimeState.domPlayerDisplayByIndex;
    if (Array.isArray(strips) && strips[i]?.name) {
      const dn = sanitizePlayerDisplayName(strips[i].name);
      if (dn) {
        rememberPlayerName(i, dn);
        return dn;
      }
    }
    const fromState = sanitizePlayerDisplayName(getPlayerNameByIndex(stateLike, i, ""));
    if (fromState) {
      rememberPlayerName(i, fromState);
      return fromState;
    }
    const fromTurns = sanitizePlayerDisplayName(extractPlayerNameFromTurnsForIndex(stateLike, i));
    if (fromTurns) {
      rememberPlayerName(i, fromTurns);
      return fromTurns;
    }
    const cached = String(lastKnownPlayerNameByIndex[i] || "").trim();
    if (cached) {
      if (looksLikeDartSegmentOrThrowLabel(cached)) {
        delete lastKnownPlayerNameByIndex[i];
      } else {
        return cached;
      }
    }
    return fallback;
  }

  /**
   * Alle Mitspieler in Tabellenreihenfolge (Index 0 … n-1) für Konsolen-Zeile „Game ON“.
   */
  function isPlayerLikeRow(o) {
    if (!o || typeof o !== "object") return false;
    return !!(
      o.name ??
      o.displayName ??
      o.playerName ??
      o.nickname ??
      o.username ??
      o.user?.name ??
      o.user?.displayName ??
      o.tagLine ??
      (typeof o.index === "number" && o.index >= 0 && o.index <= 15)
    );
  }

  /** Fallback wenn players[] nicht auf Root liegt (verschachtelte API). */
  function deepFindLongestPlayerRowArray(obj, maxDepth, maxNodes) {
    let best = 0;
    let nodes = 0;
    function walk(o, d) {
      if (d < 0 || !o || typeof o !== "object" || nodes > maxNodes) return;
      nodes += 1;
      if (Array.isArray(o) && o.length > 0 && o.length <= 16) {
        const like = o.filter((row) => isPlayerLikeRow(row)).length;
        if (like >= Math.max(1, Math.ceil(o.length * 0.51)) && o.length > best) best = o.length;
      }
      if (d === 0) return;
      const vals = Object.values(o);
      for (let i = 0; i < vals.length && i < 40; i += 1) {
        const v = vals[i];
        if (v && typeof v === "object") walk(v, d - 1);
      }
    }
    walk(obj, maxDepth);
    return best;
  }

  /** Längstes player-ähnliches Array finden und Eintrag `idx` zurückgeben. */
  function deepFindNthPlayerRow(root, idx, maxDepth, maxNodes) {
    let bestArr = null;
    let nodes = 0;
    function walk(o, d) {
      if (d < 0 || !o || typeof o !== "object" || nodes > maxNodes) return;
      nodes += 1;
      if (Array.isArray(o) && o.length > idx && o.length <= 16) {
        const like = o.filter((row) => isPlayerLikeRow(row)).length;
        if (like >= Math.max(1, Math.ceil(o.length * 0.51)) && (!bestArr || o.length > bestArr.length)) {
          bestArr = o;
        }
      }
      if (d === 0) return;
      for (const v of Object.values(o).slice(0, 40)) {
        if (v && typeof v === "object") walk(v, d - 1);
      }
    }
    walk(root, maxDepth);
    return bestArr && bestArr[idx] != null ? bestArr[idx] : null;
  }

  function maxPlayerListLength(stateLike) {
    if (!stateLike || typeof stateLike !== "object") return 0;
    const roots = [stateLike?.raw?.state, stateLike?.raw, stateLike].filter(
      (x) => x && typeof x === "object"
    );
    let n = 0;
    for (const root of roots) {
      const ar = firstPlayerArrayOnRoot(root);
      if (ar && ar.length > n) n = ar.length;
      for (const child of Object.values(root)) {
        if (!child || typeof child !== "object") continue;
        const ar2 = firstPlayerArrayOnRoot(child);
        if (ar2 && ar2.length > n) n = ar2.length;
      }
    }
    if (n === 0) {
      for (const root of roots) {
        const deep = deepFindLongestPlayerRowArray(root, 7, 200);
        if (deep > n) n = deep;
      }
    }
    if (n > 0) return n;
    let maxI = -1;
    for (let i = 0; i < 16; i += 1) {
      if (lastKnownPlayerNameByIndex[i]) maxI = i;
    }
    return maxI + 1;
  }

  /** Max. aus State, letztem State und dem beim Game-ON/Page gemerkten Roster (3+ Spieler möglich). */
  function effectiveParticipantCount(stateLike) {
    const fromHint = stateLike ? maxPlayerListLength(stateLike) : 0;
    const fromLast = lastState ? maxPlayerListLength(lastState) : 0;
    const persisted = Number(runtimeState.rosterParticipantCount) || 0;
    return Math.min(16, Math.max(0, Math.max(fromHint, fromLast, persisted)));
  }

  function collectMatchRosterNames(stateLike) {
    if (!stateLike || typeof stateLike !== "object") return [];
    const n = maxPlayerListLength(stateLike);
    if (n <= 0) return [];
    const out = [];
    for (let i = 0; i < n; i += 1) {
      const name = getPreferredPlayerName(stateLike, i, "");
      out.push(name || `Spieler ${i + 1}`);
    }
    return out;
  }

  /**
   * Ohne Page-Roster: an `playerScores` kürzen — abbrechen am ersten Index ohne endlichen Score,
   * damit kein dritter „Geister“-Eintrag (z. B. „drei“) in Game ON landet.
   */
  function collectMatchRosterNamesTrimmedByScores(stateLike) {
    const full = collectMatchRosterNames(stateLike);
    const sc = stateLike?.playerScores;
    if (!Array.isArray(sc) || sc.length === 0) return full;
    let cap = full.length;
    for (let i = 0; i < full.length; i += 1) {
      if (i >= sc.length || !Number.isFinite(Number(sc[i]))) {
        cap = i;
        break;
      }
    }
    if (cap >= 2 && cap < full.length) return full.slice(0, cap);
    return full;
  }

  function rosterFromDomDisplayStrips() {
    const strips = runtimeState.domPlayerDisplayByIndex;
    if (!Array.isArray(strips) || strips.length < 2) return [];
    const names = [];
    for (let i = 0; i < strips.length && i < 16; i += 1) {
      const n = sanitizePlayerDisplayName(String(strips[i]?.name || "").trim());
      if (!n) break;
      names.push(n);
    }
    return names.length >= 2 ? names : [];
  }

  function pickGameOnRosterNames(stateLike) {
    const fromState =
      stateLike && typeof stateLike === "object"
        ? collectMatchRosterNamesTrimmedByScores(stateLike)
        : [];
    const ctx = runtimeState.matchContextRosterNames;
    if (Array.isArray(ctx) && ctx.length >= 2) {
      const list = ctx
        .map((x) => String(x || "").replace(/\s+/g, " ").trim())
        .filter(Boolean);
      if (list.length >= 2) {
        /** Page-Roster hängt nach 4er-Spiel oft noch mit 4 Namen — Live-State mit 2ern hat Vorrang. */
        if (fromState.length >= 2 && fromState.length < list.length) return fromState;
        return list;
      }
    }
    if (fromState.length >= 2) return fromState;
    return [];
  }

  const gameOnRosterLoggedKeys = new Set();
  /** Gleiche Namensliste nicht doppelt (Page-Roster + WS-State). */
  const gameOnPrintedRosterFp = new Set();
  /** Kurzzeit-Dedupe ohne Match-ID: unterdrückt direkte Doppel-Logs beim Start (z. B. "_" vs echte Match-ID). */
  let lastGameOnShortFp = "";
  let lastGameOnShortAt = 0;
  /** Nur bei Wechsel der Match-Id in der URL: sonst leeren Re-Navs (SPA) das Dedupe und erzeugen doppeltes „Game ON“. */
  let lastNavClearedGameOnMatchId = "";

  function clearGameOnDedupeCaches() {
    gameOnRosterLoggedKeys.clear();
    gameOnPrintedRosterFp.clear();
  }

  /**
   * DOM-`matchFormatSummary` enthält oft einen Runden-Zähler (`… / R2/50`), der sich nach jeder Runde ändert.
   * Für Game-ON-Dedupe nur den stabilen Modus-Teil verwenden (sonst „Game ON“ pro Runde).
   */
  function normalizeMatchFormatSummaryForGameOnDedupe(raw) {
    let s = String(raw || "").trim().toLowerCase();
    /** X01: `… / R2/50` pro Runde */
    s = s.replace(/\s*\/\s*r\d+\/\d+\s*$/i, "");
    /** Bull-off: `… / R2` bei unentschiedenem Cork — kein zweites Game ON */
    s = s.replace(/\s*\/\s*r\d+\s*$/i, "");
    return s.trim();
  }

  /** Game-ON-Zeile nur aus DOM (`dom_game_variant` / Snapshot-Header), nicht aus WebSocket raten. */
  function resolveGameOnFormatLine() {
    return String(runtimeState.matchFormatSummary || "").trim();
  }

  function deriveMatchFormatSummaryFromDomSnapshotPayload(s, obs) {
    let fmt = String(s?.matchFormatSummary || "").trim();
    if (fmt) return fmt;
    if (!obs || typeof obs !== "object") return "";
    const h = obs.header;
    if (!h || typeof h !== "object") return "";
    if (Array.isArray(h.formatParts) && h.formatParts.length) {
      fmt = h.formatParts.map((x) => String(x || "").trim()).filter(Boolean).join(" / ");
    }
    if (!fmt) fmt = String(h.gameVariant || "").trim();
    return fmt;
  }

  /** Genug DOM, um wie „auf dem Board“ zu gelten — unabhängig von Navigation/Match-Context. */
  function domPlaySnapshotIndicatesLivePlay(obs) {
    if (!obs || typeof obs !== "object") return false;
    const players = obs.players;
    if (!Array.isArray(players) || players.length < 2) return false;
    let named = 0;
    for (let i = 0; i < players.length; i += 1) {
      if (String(players[i]?.displayName || "").trim()) named += 1;
    }
    if (named < 2) return false;
    if (String(obs.matchId || "").trim()) return true;
    if (String(runtimeState.playPathMatchId || "").trim()) return true;
    return !!deriveMatchFormatSummaryFromDomSnapshotPayload({}, obs);
  }

  /**
   * `dom_play_snapshot`-Nachricht: Moduszeile + ggf. Cork-Label in den Runtime-Cache,
   * damit `shouldEmitDomPlayerTurn` / Game ON nicht an fehlender Navigation hängen.
   */
  function hydrateRuntimeFromDomPlaySnapshot(s, obs) {
    try {
      const fmt = deriveMatchFormatSummaryFromDomSnapshotPayload(s, obs);
      const gv = String(obs?.header?.gameVariant || "").trim();
      const patch = {};
      if (fmt) patch.matchFormatSummary = fmt;
      if (gv) patch.gameVariantLabel = gv;
      if (Object.keys(patch).length) syncRuntimeState(patch);
      const mid = String(obs?.matchId || "").trim();
      if (mid) rememberPlayPathMatchId(mid);
      if (domPlaySnapshotIndicatesLivePlay(obs)) {
        runtimeState.gameOnUrlAllowed = true;
      }
    } catch (_) {}
  }

  /**
   * Game ON aus `dom_play_snapshot` (Namen + Modus aus `header`), wenn die Kopfzeile schon da ist.
   */
  function tryLogGameOnFromDomPlaySnapshot(obs) {
    try {
      if (!runtimeState.gameOnUrlAllowed || !obs || typeof obs !== "object") return;
      if ((runtimeState.throwCountThisMatch || 0) > 0) return;
      if (isBullOffPhaseLabel(obs.header?.gameVariant || runtimeState.gameVariantLabel || "")) return;
      const players = obs.players;
      if (!Array.isArray(players) || players.length < 2) return;
      const roster = players
        .map((p) => sanitizePlayerDisplayName(String(p?.displayName || "").trim()))
        .filter(Boolean);
      if (roster.length < 2) return;
      for (let i = 0; i < roster.length; i += 1) rememberPlayerName(i, roster[i]);
      let fmtLine = "";
      if (Array.isArray(obs.header?.formatParts) && obs.header.formatParts.length) {
        fmtLine = obs.header.formatParts.map((x) => String(x || "").trim()).filter(Boolean).join(" / ");
      }
      if (!fmtLine) fmtLine = String(obs.header?.gameVariant || "").trim();
      if (!fmtLine) fmtLine = resolveGameOnFormatLine();
      /** Ohne sichtbare Moduszeile im DOM trotzdem eine Game-ON-Zeile (Dedupe über set/leg). */
      if (!fmtLine) fmtLine = "Match";
      const st = lastState && typeof lastState === "object" ? lastState : {};
      const mid = resolveMatchIdForGameOn(st, obs.matchId);
      if (mid && mid !== "_") rememberPlayPathMatchId(mid);
      const set = st?.set ?? "_";
      const leg = st?.leg ?? "_";
      const fmt = normalizeMatchFormatSummaryForGameOnDedupe(fmtLine);
      const midKey = String(mid || "_").trim().toLowerCase();
      const dedupeKey = `${midKey}|${set}|${leg}|${fmt}`;
      if (gameOnRosterLoggedKeys.has(dedupeKey)) return;
      if (gameOnRosterLoggedKeys.size > 80) gameOnRosterLoggedKeys.clear();
      gameOnRosterLoggedKeys.add(dedupeKey);
      printGameOnOnceByRosterContent(roster, mid, fmtLine);
    } catch (_) {}
  }

  /** Nach `tryLogGameOnAfterBullOffEnd`: gleiche Schlüssel setzen wie `tryLogGameOnRoster`, damit kein Doppel-Log folgt. */
  function markGameOnPrintedForDedupe(list, matchIdForFp, stateLike) {
    if (!Array.isArray(list) || !list.length) return;
    if (!String(runtimeState.matchFormatSummary || "").trim()) return;
    const st = stateLike && typeof stateLike === "object" ? stateLike : lastState;
    const midKey = String(matchIdForFp ?? "").trim().toLowerCase() || "_";
    const fmtKey = normalizeMatchFormatSummaryForGameOnDedupe(runtimeState.matchFormatSummary);
    if (!fmtKey) return;
    const set = st?.set ?? "_";
    const leg = st?.leg ?? "_";
    const dedupeKey = `${midKey}|${set}|${leg}|${fmtKey}`;
    if (gameOnRosterLoggedKeys.size > 80) gameOnRosterLoggedKeys.clear();
    gameOnRosterLoggedKeys.add(dedupeKey);
    const fp = `${midKey}|${fmtKey}|${list.join("|").toLowerCase()}`;
    if (gameOnPrintedRosterFp.size > 60) gameOnPrintedRosterFp.clear();
    gameOnPrintedRosterFp.add(fp);
  }

  function printGameOnOnceByRosterContent(roster, matchIdForFp, formatLine) {
    const fmtLine = String(formatLine || "").trim();
    if (!fmtLine) return false;
    const list = Array.isArray(roster)
      ? roster.map((x) => String(x || "").replace(/\s+/g, " ").trim()).filter(Boolean)
      : [];
    if (!list.length) return false;
    const midFp = String(matchIdForFp ?? "").trim().toLowerCase() || "_";
    const fmtFp = normalizeMatchFormatSummaryForGameOnDedupe(fmtLine);
    const shortFp = `${fmtFp}|${list.join("|").toLowerCase()}`;
    const now = Date.now();
    if (shortFp && shortFp === lastGameOnShortFp && now - Number(lastGameOnShortAt || 0) < 12000) {
      return false;
    }
    const fp = `${midFp}|${fmtFp}|${list.join("|").toLowerCase()}`;
    if (gameOnPrintedRosterFp.has(fp)) return false;
    if (gameOnPrintedRosterFp.size > 60) gameOnPrintedRosterFp.clear();
    gameOnPrintedRosterFp.add(fp);
    lastGameOnShortFp = shortFp;
    lastGameOnShortAt = now;
    ADM.triggerWorkerLog?.printGameOnPlayersLine?.(list, {
      matchFormatSummary: fmtLine
    });
    try {
      ADM.admTriggerBus?.emit?.("x01_game_start", {
        effect: "x01_game_start",
        matchFormatSummary: fmtLine,
        matchId: matchIdForFp ?? null,
        playerNames: list.slice()
      });
    } catch (_) {}
    return true;
  }

  /**
   * Einmaliges „Game ON“ zu Bull-Off-Start (Roster vor dem Leeren von `matchContextRosterNames`).
   * Cork: näher am Bull gewinnt (`50` > `25` > `-1` > `-2` > …); Gleichstand → Reihenfolge regelt die App/WS.
   */
  function tryLogBullOffGameOnStart(roster, variantLabel, formatSummaryLine, stateLike, matchIdHint) {
    try {
      if (!runtimeState.gameOnUrlAllowed) return;
      if (Number(runtimeState.bullOffThrowSerial || 0) > 0) return;
      let list = Array.isArray(roster)
        ? roster.map((x) => String(x || "").replace(/\s+/g, " ").trim()).filter(Boolean)
        : [];
      if (list.length < 2) list = rosterFromDomDisplayStrips();
      if (list.length < 2) return;
      const st =
        stateLike && typeof stateLike === "object" && !Array.isArray(stateLike) ? stateLike : lastState;
      if (st && stateLikeLobbyOrPreGame(st)) return;
      let fmtLine = [String(variantLabel || "").trim(), String(formatSummaryLine || "").trim()]
        .filter(Boolean)
        .join(" · ")
        .trim();
      if (!fmtLine) fmtLine = String(variantLabel || "Bull-off").trim() || "Bull-off";
      const mid = resolveMatchIdForGameOn(st, matchIdHint);
      if (mid && mid !== "_") rememberPlayPathMatchId(mid);
      const set = st?.set ?? "_";
      const leg = st?.leg ?? "_";
      const midKey = String(mid || "_").trim().toLowerCase();
      const legGate = `${midKey}|${set}|${leg}|bull_off_gameon`;
      if (runtimeState.bullOffGameOnGate === legGate) return;
      const rosterGate = `${set}|${leg}|${list.join("|").toLowerCase()}`;
      if (runtimeState.bullOffGameOnRosterGate === rosterGate) return;
      const rosterFpSimple = list.join("|").toLowerCase();
      const nowTs = Date.now();
      if (
        runtimeState.lastBullOffGameOnRosterFp === rosterFpSimple &&
        nowTs - Number(runtimeState.lastBullOffGameOnAtTs || 0) < 12000
      ) {
        return;
      }
      if (
        globalBullOffGameOnRosterFp === rosterFpSimple &&
        nowTs - Number(globalBullOffGameOnAtTs || 0) < 12000
      ) {
        return;
      }
      runtimeState.bullOffGameOnGate = legGate;
      runtimeState.bullOffGameOnRosterGate = rosterGate;
      runtimeState.bullOffPhaseLatched = true;
      runtimeState.lastBullOffGameOnRosterFp = rosterFpSimple;
      runtimeState.lastBullOffGameOnAtTs = nowTs;
      globalBullOffGameOnRosterFp = rosterFpSimple;
      globalBullOffGameOnAtTs = nowTs;
      ADM.triggerWorkerLog?.printGameOnPlayersLine?.(list, { matchFormatSummary: fmtLine });
      markGameOnPrintedForDedupe(list, mid, st);
      const fmtKey = normalizeMatchFormatSummaryForGameOnDedupe(fmtLine);
      const dedupeKey = `${midKey}|${set}|${leg}|${fmtKey}`;
      if (gameOnRosterLoggedKeys.size > 80) gameOnRosterLoggedKeys.clear();
      gameOnRosterLoggedKeys.add(dedupeKey);
      const rosterFp = `${midKey}|${fmtKey}|${list.join("|").toLowerCase()}`;
      if (gameOnPrintedRosterFp.size > 60) gameOnPrintedRosterFp.clear();
      gameOnPrintedRosterFp.add(rosterFp);
      runtimeState.rosterParticipantCount = Math.max(runtimeState.rosterParticipantCount || 0, list.length);
      try {
        ADM.admTriggerBus?.emit?.("bull_off_start", {
          effect: "bull_off_start",
          matchFormatSummary: fmtLine,
          matchId: mid ?? null,
          playerNames: list.slice()
        });
      } catch (_) {}
    } catch (_) {}
  }

  /**
   * Fallback: `dom_game_variant` kann fehlen/verspätet sein — Bull-Off-Game ON sobald der Snapshot die Phase zeigt.
   */
  function tryMaybeLogBullOffGameOnFromDomSnapshot(obs) {
    try {
      if (!runtimeState.gameOnUrlAllowed) return;
      if (!obs || typeof obs !== "object") return;
      const gv = String(obs.header?.gameVariant || "").trim();
      const corkish = domCorkMeansBullOffNotX01Noise(obs);
      if (!isBullOffPhaseLabel(gv) && !corkish) return;
      const players = Array.isArray(obs.players) ? obs.players : [];
      const names = [];
      for (let i = 0; i < players.length && i < 16; i += 1) {
        const n = sanitizePlayerDisplayName(String(players[i]?.displayName || "").trim());
        if (n) names.push(n);
      }
      if (names.length < 2) return;
      let fmtSumm = "";
      if (Array.isArray(obs.header?.formatParts) && obs.header.formatParts.length) {
        fmtSumm = obs.header.formatParts
          .map((x) => String(x || "").trim())
          .filter(Boolean)
          .join(" · ");
      }
      const variantForLog = isBullOffPhaseLabel(gv) ? gv : gv || "Bull-off";
      tryLogBullOffGameOnStart(
        names,
        variantForLog,
        fmtSumm,
        lastState,
        obs.matchId ?? lastState?.matchId ?? null
      );
    } catch (_) {}
  }

  /**
   * Eine Zeile „Game ON“ mit allen Namen — bei leerem Roster kein Log (kommt oft nachfolgender State).
   * Dedupe pro Match/Leg, damit fehlende matchId nicht alle Spiele unter „_“ blockiert.
   */
  function stateLikeLobbyOrPreGame(stateLike) {
    if (!stateLike || typeof stateLike !== "object") return false;
    const roots = [stateLike?.raw?.state, stateLike?.raw, stateLike].filter(
      (x) => x && typeof x === "object"
    );
    for (const r of roots) {
      const st = String(r?.status ?? r?.phase ?? r?.matchStatus ?? r?.gamePhase ?? "").toLowerCase();
      if (/(lobby|waiting|setup|invite|pregame|idle|pending|creating|scheduled|matchmaking)/.test(st))
        return true;
      if (r?.inLobby === true || r?.lobby === true || r?.isLobby === true) return true;
    }
    return false;
  }

  function stateLikeGameFinished(stateLike) {
    if (!stateLike || typeof stateLike !== "object") return false;
    if (stateLike.gameFinished === true) return true;
    const roots = [stateLike?.raw?.state, stateLike?.raw].filter((x) => x && typeof x === "object");
    for (const r of roots) {
      if (r?.gameFinished === true || r?.finished === true || r?.isFinished === true) return true;
    }
    return false;
  }

  /** Checkout-/WS-Helfer: Live-Spiel, kein Lobby-State (Player Turn kommt nur noch per DOM). */
  function shouldEmitTurnPreambleForState(stateLike) {
    if (!runtimeState.gameOnUrlAllowed) return false;
    if (!stateLike || typeof stateLike !== "object") return false;
    if (stateLikeGameFinished(stateLike)) return false;
    if (stateLikeLobbyOrPreGame(stateLike)) return false;
    if (maxPlayerListLength(stateLike) < 2) return false;
    if (isBullOffPhaseActive()) return true;
    return !!String(runtimeState.matchFormatSummary || "").trim();
  }

  /** Player Turn: Live-Kontext + Moduszeile **oder** belastbarer Snapshot (2 Namen + Match), falls UI keine `ad-ext-game-variant` zeigt. */
  function shouldEmitDomPlayerTurn() {
    if (Date.now() < Number(runtimeState.suppressDomPlayerTurnUntilTs || 0)) return false;
    if (stateLikeGameFinished(lastState)) return false;
    if (!runtimeState.gameOnUrlAllowed) return false;
    if (isBullOffPhaseActive()) return true;
    if (String(runtimeState.matchFormatSummary || "").trim()) return true;
    const obs = getLastDomPlaySnapshotIfMatch();
    return !!(obs && domPlaySnapshotIndicatesLivePlay(obs));
  }

  function tryLogGameOnRoster(stateLike, matchIdHint) {
    try {
      if (!runtimeState.gameOnUrlAllowed) return;
      if ((runtimeState.throwCountThisMatch || 0) > 0) return;
      if (isBullOffPhaseActive()) return;
      const st =
        stateLike && typeof stateLike === "object" && !Array.isArray(stateLike) ? stateLike : lastState;
      if (st && stateLikeLobbyOrPreGame(st)) return;
      const roster = pickGameOnRosterNames(st);
      if (roster.length < 2) return;
      const fmtLine = resolveGameOnFormatLine();
      if (!fmtLine) return;
      runtimeState.rosterParticipantCount = Math.max(runtimeState.rosterParticipantCount || 0, roster.length);
      const mid = resolveMatchIdForGameOn(st, matchIdHint);
      if (mid && mid !== "_") rememberPlayPathMatchId(mid);
      const set = st?.set ?? "_";
      const leg = st?.leg ?? "_";
      const fmt = normalizeMatchFormatSummaryForGameOnDedupe(fmtLine);
      const midKey = String(mid || "_").trim().toLowerCase();
      const dedupeKey = `${midKey}|${set}|${leg}|${fmt}`;
      if (gameOnRosterLoggedKeys.has(dedupeKey)) return;
      if (gameOnRosterLoggedKeys.size > 80) gameOnRosterLoggedKeys.clear();
      gameOnRosterLoggedKeys.add(dedupeKey);
      printGameOnOnceByRosterContent(roster, mid, fmtLine);
    } catch (_) {}
  }

  /** Nach Ausgebullt: zweite Game-ON-Zeile mit aktuellem Mode-String; Dedupe wie `tryLogGameOnRoster` verhindert direktes Doppel-Log. */
  function tryLogGameOnAfterBullOffEnd() {
    try {
      if (!runtimeState.gameOnUrlAllowed) return;
      const st = lastState;
      if (!st || stateLikeLobbyOrPreGame(st)) return;
      const roster = pickGameOnRosterNames(st);
      if (roster.length < 2) return;
      const list = roster.map((x) => String(x || "").replace(/\s+/g, " ").trim()).filter(Boolean);
      if (!list.length) return;
      const mid = resolveMatchIdForGameOn(st, null);
      if (mid && mid !== "_") rememberPlayPathMatchId(mid);
      const fmtLine = String(runtimeState.matchFormatSummary || "").trim();
      if (!fmtLine) return;
      const set = st?.set ?? "_";
      const leg = st?.leg ?? "_";
      const fmt = normalizeMatchFormatSummaryForGameOnDedupe(fmtLine);
      const midKey = String(mid || "_").trim().toLowerCase();
      const dedupeKey = `${midKey}|${set}|${leg}|${fmt}`;
      if (gameOnRosterLoggedKeys.has(dedupeKey)) return;
      if (gameOnRosterLoggedKeys.size > 80) gameOnRosterLoggedKeys.clear();
      gameOnRosterLoggedKeys.add(dedupeKey);
      printGameOnOnceByRosterContent(list, mid, fmtLine);
      markGameOnPrintedForDedupe(list, mid, st);
    } catch (_) {}
  }

  /**
   * Spielernamen aus Page (`__NEXT_DATA__` / DOM) — Cache + Game-ON (einmal pro gleicher Liste).
   */
  function applyMatchContextFromPage(e) {
    try {
      const fromLobby = e?.fromLobbyUrl === true;
      if (e?.matchPlayPathOk === true) runtimeState.gameOnUrlAllowed = true;
      rememberPlayPathMatchId(e?.matchId);
      const names = Array.isArray(e?.playerNames) ? e.playerNames : [];
      const cleaned = [];
      for (let i = 0; i < names.length && i < 16; i += 1) {
        const n = sanitizePlayerDisplayName(String(names[i] || "").trim());
        if (n) {
          rememberPlayerName(i, n);
          cleaned.push(n);
        }
      }
      if (cleaned.length >= 2) {
        runtimeState.rosterParticipantCount = Math.max(runtimeState.rosterParticipantCount || 0, cleaned.length);
        runtimeState.matchContextRosterNames = cleaned.slice();
      }
      if (fromLobby) return;
      if (e?.matchPlayPathOk !== true) return;
      /**
       * Game ON erst mit DOM-Moduszeile (`matchFormatSummary`); Dedupe in `tryLogGameOnRoster`.
       */
      if (cleaned.length >= 2) {
        tryLogGameOnRoster(lastState, lastState?.matchId ?? e?.matchId ?? null);
      }
    } catch (_) {}
  }

  function countDartsInTurnObj(turn) {
    if (!turn || typeof turn !== "object") return 0;
    const darts = turn.darts ?? turn.throws ?? turn.dartThrows ?? turn.hits;
    return Array.isArray(darts) ? darts.length : 0;
  }

  /**
   * Werfer aus `turns[]`: der **letzte** Listeneintrag ist der aktuelle Visit
   * (auch bei 0 Darts — sonst nimmt man fälschlich noch den vollen Visit von Spieler 0).
   */
  /**
   * Explizite API-Felder für Werfer / nächster Spieler (vor `turns[]`-Heuristik).
   * Reihenfolge: zuerst „dieser Wurf“, dann aktueller Spieler, dann nextPlayer.
   */
  /**
   * Für **Wurf-Zuordnung** kein `nextPlayer`: der zeigt oft schon den Gegner, während noch Dart 2/3 fliegt.
   */
  function inferPlayerIndexFromStateRootsForThrow(stateLike) {
    if (!stateLike || typeof stateLike !== "object") return null;
    const roots = [stateLike?.raw?.state, stateLike?.raw, stateLike].filter(
      (x) => x && typeof x === "object"
    );
    const keyGroups = [
      [
        "throwingPlayerIndex",
        "throwingPlayer",
        "currentThrowerIndex",
        "currentThrower",
        "dartThrowerIndex",
        "throwerIndex",
        "thrower"
      ],
      ["playerIndex", "currentPlayerIndex", "activePlayerIndex", "activeCompetitorIndex", "competitorIndex"]
    ];
    for (const keys of keyGroups) {
      for (const root of roots) {
        for (const k of keys) {
          const idx = asValidPlayerIndex(root[k]);
          if (idx !== null) return idx;
        }
      }
    }
    return null;
  }

  function inferThrowerIndexFromLastTurn(stateLike) {
    const roots = [stateLike?.raw?.state, stateLike?.raw, stateLike].filter(
      (x) => x && typeof x === "object"
    );

    for (const root of roots) {
      const turns = root?.turns;
      if (!Array.isArray(turns) || turns.length === 0) continue;

      const last = turns[turns.length - 1];
      const lastIdx = asValidPlayerIndex(
        last?.player ?? last?.playerIndex ?? last?.playerId ?? last?.competitorIndex ?? last?.participantIndex
      );
      const lastN = countDartsInTurnObj(last);

      if (lastIdx !== null) {
        if (lastN > 0) return lastIdx;
        return lastIdx;
      }

      for (let k = turns.length - 1; k >= 0; k -= 1) {
        const turn = turns[k];
        if (!turn || typeof turn !== "object") continue;
        const n = countDartsInTurnObj(turn);
        if (n === 0) continue;
        const tp = asValidPlayerIndex(
          turn.player ?? turn.playerIndex ?? turn.playerId ?? turn.competitorIndex ?? turn.participantIndex
        );
        if (tp !== null) return tp;
      }
    }
    return resolveActivePlayerFromStateExcludingNext(stateLike);
  }

  /** Wie resolveActivePlayerFromState, aber ohne `nextPlayer` (nur für Turn-/Wurf-Fallback). */
  function resolveActivePlayerFromStateExcludingNext(s) {
    const direct = asValidPlayerIndex(s?.player);
    if (direct !== null) return direct;
    const raw = s?.raw;
    const roots = [raw?.state, raw].filter((x) => x && typeof x === "object");
    for (const root of roots) {
      const cand = [
        root?.throwingPlayerIndex,
        root?.throwingPlayer,
        root?.currentThrowerIndex,
        root?.currentThrower,
        root?.dartThrowerIndex,
        root?.throwerIndex,
        root?.playerIndex,
        root?.currentPlayerIndex,
        root?.activePlayerIndex,
        root?.competitorIndex,
        root?.participantIndex,
        root?.activeCompetitorIndex,
        root?.player
      ];
      for (const c of cand) {
        const idx = asValidPlayerIndex(c);
        if (idx !== null) return idx;
      }
    }
    return null;
  }

  function findPlayerIndexByName(name) {
    const target = String(name || "").trim().toLowerCase();
    if (!target) return null;
    if (looksLikeDartSegmentOrThrowLabel(target)) return null;
    const entries = Object.entries(lastKnownPlayerNameByIndex);
    for (const [idx, playerName] of entries) {
      const pn = String(playerName || "").trim().toLowerCase();
      if (pn && pn === target) {
        const n = Number(idx);
        if (Number.isInteger(n) && n >= 0) return n;
      }
    }
    /** z. B. „Bot Level 1“ vs. langer Anzeigename aus dem Board */
    for (const [idx, playerName] of entries) {
      const pn = String(playerName || "").trim().toLowerCase();
      if (!pn || pn.length < 4) continue;
      if (target.startsWith(pn) || (target.length >= 4 && pn.startsWith(target))) {
        const n = Number(idx);
        if (Number.isInteger(n) && n >= 0) return n;
      }
    }
    return null;
  }

  /** Längstes `turns[]` aus State-Rohtypen — vermeidet unterschiedliche Indizes zwischen `raw.state` und Flach-State. */
  function bestTurnsArrayFromState(stateLike) {
    let best = null;
    let bestLen = 0;
    const roots = [stateLike?.raw?.state, stateLike?.raw, stateLike].filter(
      (x) => x && typeof x === "object"
    );
    for (const root of roots) {
      const turns = root.turns;
      if (!Array.isArray(turns) || !turns.length) continue;
      if (turns.length > bestLen) {
        bestLen = turns.length;
        best = turns;
      }
    }
    return best;
  }

  /**
   * Letzter `turns[]`-Eintrag für diesen Spieler: Index (stabiler Visit-Schlüssel) + Dart-Anzahl.
   * Wichtig: Der Schlüssel darf **nicht** `n` enthalten — sonst ändert er sich nach Wurf 1 → doppeltes Player Turn.
   */
  function visitTurnCursorForPlayer(stateLike, pi) {
    if (!Number.isInteger(pi) || pi < 0) return null;
    const turns = bestTurnsArrayFromState(stateLike);
    if (!Array.isArray(turns) || !turns.length) return null;
    for (let i = turns.length - 1; i >= 0; i -= 1) {
      const turn = turns[i];
      if (!turn || typeof turn !== "object") continue;
      const tp = asValidPlayerIndex(
        turn.player ??
          turn.playerIndex ??
          turn.playerId ??
          turn.competitorIndex ??
          turn.participantIndex
      );
      if (tp !== pi) continue;
      const darts = turn.darts ?? turn.throws ?? turn.dartThrows ?? turn.hits;
      const n = Array.isArray(darts) ? darts.length : 0;
      return { index: i, darts: n };
    }
    return null;
  }

  /**
   * Wie viele Darts der **aktive** Spieler laut `turns[]` schon in der laufenden Aufnahme hat.
   * Steht der letzte Turn bei einem anderen Spieler (z. B. nach Bust), gilt der Auftritt von `ap` als neu → 0.
   */
  function visitDartsCompletedForEngineFromState(stateLike, ap, pc) {
    if (!Number.isInteger(ap) || ap < 0 || !Number.isInteger(pc) || pc < 2 || ap >= pc) return 0;
    const turns = bestTurnsArrayFromState(stateLike);
    if (!Array.isArray(turns) || !turns.length) return 0;
    const last = turns[turns.length - 1];
    if (!last || typeof last !== "object") return 0;
    const lp = asValidPlayerIndex(
      last.player ??
        last.playerIndex ??
        last.playerId ??
        last.competitorIndex ??
        last.participantIndex
    );
    if (lp !== null && lp !== ap) {
      return 0;
    }
    const cur = visitTurnCursorForPlayer(stateLike, ap);
    const d = cur && typeof cur.darts === "number" ? cur.darts : 0;
    return Math.min(3, Math.max(0, d));
  }

  function buildTurnPreambleKey(stateLike, pi) {
    if (!stateLike || typeof stateLike !== "object" || !Number.isInteger(pi) || pi < 0) return "";
    const mid = String(stateLike.matchId ?? "").trim() || "_";
    const set = stateLike.set ?? "_";
    const leg = stateLike.leg ?? "_";
    const cur = visitTurnCursorForPlayer(stateLike, pi);
    const turnPart = cur ? String(cur.index) : "_";
    return `${mid}|${set}|${leg}|${pi}|${turnPart}`;
  }

  /** Gleiche Key-Logik wie `emitPlayerTurnFromDomPlayerIndex`. */
  function resolveTurnPreambleKeyForPlayer(stateLike, pi) {
    let fineKey = "";
    if (stateLike && typeof stateLike === "object") {
      fineKey = buildTurnPreambleKey(stateLike, pi);
    }
    if (!fineKey) {
      fineKey = `${String(runtimeState.playPathMatchId || "").trim() || "_"}|dom|${pi}`;
    }
    return fineKey;
  }

  /**
   * Player Turn — nur wenn sich die aktive Spalte (`.ad-ext-player-active`) ändert.
   */
  function emitPlayerTurnFromDomPlayerIndex(pi) {
    if (!Number.isInteger(pi) || pi < 0) return;
    const strips = runtimeState.domPlayerDisplayByIndex;
    const strip = Array.isArray(strips) && pi < strips.length ? strips[pi] : null;
    const nm = strip != null && strip.name != null ? String(strip.name).replace(/\s+/g, " ").trim() : "";
    if (nm) rememberPlayerName(pi, nm);
    const whoRaw =
      nm || getPreferredPlayerName(lastState, pi, "") || `Spieler ${pi + 1}`;
    const who = normalizeConsolePlayerName(whoRaw) || whoRaw;
    let rem = null;
    if (strip != null && Number.isFinite(Number(strip.remaining))) {
      rem = Number(strip.remaining);
    } else if (lastState && Array.isArray(lastState.playerScores) && pi < lastState.playerScores.length) {
      const r = Number(lastState.playerScores[pi]);
      if (Number.isFinite(r) && r >= 0) rem = r;
    }
    const bull = isBullOffPhaseActive();
    if (!bull && Number.isFinite(rem) && rem === 0) return;
    let avg =
      strip != null && strip.average != null && String(strip.average).trim()
        ? String(strip.average).trim()
        : null;
    let remForTurnLine = rem;
    if (!bull && (remForTurnLine == null || !Number.isFinite(remForTurnLine) || remForTurnLine <= 0) && (runtimeState.throwCountThisMatch || 0) === 0) {
      const start = parseStartScoreFromMatchFormatSummary();
      if (Number.isFinite(start) && start > 0) remForTurnLine = start;
    }
    if (!bull && !avg && (runtimeState.throwCountThisMatch || 0) === 0) {
      avg = "0 / 0";
    }
    let fineKey = "";
    if (lastState && typeof lastState === "object") {
      fineKey = buildTurnPreambleKey(lastState, pi);
    }
    if (!fineKey) {
      fineKey = `${String(runtimeState.playPathMatchId || "").trim() || "_"}|dom|${pi}`;
    }
    if (fineKey && fineKey === String(runtimeState.lastTurnPreambleLoggedKey || "")) {
      return;
    }
    if (fineKey && fineKey === String(runtimeState.turnPreambleEmitInFlightKey || "")) {
      return;
    }
    runtimeState.turnPreambleEmitInFlightKey = fineKey;
    runtimeState.lastTurnPlayerIndex = pi;
    runtimeState.lastTurnPlayerName = String(who || "").replace(/\s+/g, " ").trim();
    if (!bull) {
      const pcP = effectiveParticipantCount(lastState);
      if (pcP >= 2) {
        runtimeState.visitDartsCompletedInTurn = 0;
        runtimeState.visitRotationPlayer = pi;
      }
    }
    try {
      const participantCount = effectiveParticipantCount(lastState);
      const mergedForScores = mergeLastStateWithDomSnapshot(lastState);
      const psRaw = Array.isArray(mergedForScores?.playerScores) ? mergedForScores.playerScores : null;
      const playerScores = psRaw
        ? psRaw.map((x) => (Number.isFinite(Number(x)) ? Math.trunc(Number(x)) : null))
        : null;
      const remainingScore =
        rem != null && Number.isFinite(Number(rem))
          ? Math.trunc(Number(rem))
          : (Number.isFinite(pi) && playerScores && pi < playerScores.length && playerScores[pi] != null
            ? playerScores[pi]
            : Number.isFinite(Number(remForTurnLine))
              ? Math.trunc(Number(remForTurnLine))
              : null);
      ADM.admTriggerBus?.emit?.("player_turn", {
        effect: "player_turn_dom",
        player: pi,
        playerIndex: pi,
        playerName: who,
        matchId: lastState?.matchId ?? runtimeState.playPathMatchId ?? null,
        isBullOffPhase: bull,
        participantCount,
        remainingScore,
        playerScores
      });
      ADM.triggerWorkerLog?.printTurnPreamble?.({
        who,
        throwerRemainingScore:
          rem != null && Number.isFinite(Number(rem))
            ? Number(rem)
            : Number.isFinite(Number(remForTurnLine))
              ? Number(remForTurnLine)
              : null,
        throwerAverageDisplay: avg,
        isBullOffPhase: bull
      });
    } catch (_) {
    } finally {
      runtimeState.turnPreambleLogSeq = (runtimeState.turnPreambleLogSeq || 0) + 1;
      runtimeState.lastTurnPreambleLoggedKey = fineKey;
      runtimeState.turnPreambleEmitInFlightKey = "";
    }
    runtimeState.lastDomLoggedActivePlayerIndex = pi;
  }

  /**
   * „Player Turn“ (DOM) nur am **echten** Visit-Start.
   * Primär: `dom_play_snapshot` — leere Slots **oder** Spaltenwechsel mit 1–3 Darts (schneller Scan nach Wechsel).
   * Fallback: WS-State mit `visitTurnCursorForPlayer(…).darts === 0`.
   */
  function shouldEmitDomPlayerTurnForVisitStart(domActiveIndex, obsHint) {
    if (isBullOffPhaseActive()) {
      const wLock = runtimeState.bullOffCorkWinnerIndex;
      if (
        wLock != null &&
        Number.isInteger(wLock) &&
        wLock >= 0 &&
        Number.isInteger(domActiveIndex) &&
        domActiveIndex !== wLock
      ) {
        return false;
      }
      const obs =
        obsHint && typeof obsHint === "object" ? obsHint : getLastDomPlaySnapshotIfMatch();
      const pLen = Array.isArray(obs?.players) ? obs.players.length : 0;
      const sLen = Array.isArray(runtimeState.domPlayerDisplayByIndex)
        ? runtimeState.domPlayerDisplayByIndex.length
        : 0;
      if (pLen >= 2) {
        const r0 = bullCorkRankFromPlayerOrStrip(obs.players[0], 0);
        const r1 = bullCorkRankFromPlayerOrStrip(obs.players[1], 1);
        if (r0 != null && r1 != null && r0 !== r1) {
          const winner = r0 > r1 ? 0 : 1;
          if (domActiveIndex !== winner) return false;
        }
      } else if (sLen >= 2 && (!obs || !Array.isArray(obs.players) || obs.players.length < 2)) {
        const r0 = bullCorkRankFromPlayerOrStrip(null, 0);
        const r1 = bullCorkRankFromPlayerOrStrip(null, 1);
        if (r0 != null && r1 != null && r0 !== r1) {
          const winner = r0 > r1 ? 0 : 1;
          if (domActiveIndex !== winner) return false;
        }
      }
      return true;
    }
    const obs =
      obsHint && typeof obsHint === "object" ? obsHint : getLastDomPlaySnapshotIfMatch();
    const prevActive = runtimeState.lastDomSnapshotAppliedActiveIndex;
    if (obs && typeof obs === "object") {
      const snapAi = asValidPlayerIndex(obs.activePlayerIndex);
      if (snapAi === domActiveIndex) {
        const fc = Number(obs.turn?.filledSlotCount);
        if (Number.isFinite(fc)) {
          if (fc === 0) return true;
          if (
            prevActive !== null &&
            prevActive !== domActiveIndex &&
            fc >= 1 &&
            fc <= 3
          ) {
            return true;
          }
          if (
            (prevActive === null || prevActive === domActiveIndex) &&
            runtimeState.lastDomLoggedActivePlayerIndex === null &&
            fc >= 1 &&
            fc <= 3
          ) {
            return true;
          }
          return false;
        }
      }
    }
    const pcLog = effectiveParticipantCount(lastState);
    if (pcLog < 2 || !lastState || typeof lastState !== "object") return true;
    const statePi = resolveActivePlayerFromState(lastState);
    if (statePi != null && statePi !== domActiveIndex) return false;
    const cur = visitTurnCursorForPlayer(lastState, domActiveIndex);
    if (cur == null) return true;
    return cur.darts === 0;
  }

  function tryEmitDomPlayerTurnIfIndexChanged(domActiveIndex, obsHint) {
    if (!Number.isInteger(domActiveIndex) || domActiveIndex < 0) return;
    if (!shouldEmitDomPlayerTurn()) return;
    const strips = runtimeState.domPlayerDisplayByIndex;
    const n = Array.isArray(strips) ? strips.length : 0;
    if (n < 1 || domActiveIndex >= n) return;
    if (domActiveIndex === runtimeState.lastDomLoggedActivePlayerIndex) return;
    if (isBullOffPhaseActive()) {
      const nowTs = Date.now();
      if (nowTs - Number(runtimeState.lastBullOffPlayerTurnAt || 0) < 700) return;
      if (runtimeState.bullOffTurnPromptSerial === runtimeState.bullOffThrowSerial) return;
      if (runtimeState.bullOffThrowSerial === 0 && Number(runtimeState.lastBullOffPlayerTurnAt || 0) > 0) return;
    }

    if (!shouldEmitDomPlayerTurnForVisitStart(domActiveIndex, obsHint)) {
      if (!isBullOffPhaseActive()) {
        const pcLog = effectiveParticipantCount(lastState);
        if (pcLog >= 2 && lastState && typeof lastState === "object") {
          const statePi = resolveActivePlayerFromState(lastState);
          if (statePi === domActiveIndex) {
            const cur = visitTurnCursorForPlayer(lastState, domActiveIndex);
            if (cur != null && cur.darts > 0) {
              runtimeState.lastDomLoggedActivePlayerIndex = domActiveIndex;
            }
          }
        }
      }
      return;
    }

    if (isBullOffPhaseActive()) {
      runtimeState.lastBullOffPlayerTurnAt = Date.now();
      runtimeState.bullOffTurnPromptSerial = runtimeState.bullOffThrowSerial;
    }
    emitPlayerTurnFromDomPlayerIndex(domActiveIndex);
  }

  /**
   * `dom_checkout` kann vor dem nächsten `dom_play_snapshot` ankommen — für Throw 1 braucht
   * `shouldEmitDomPlayerTurnForVisitStart` trotzdem leere Slots und den Active-Index aus dem Checkout-Scan.
   */
  function buildDomCheckoutThrow1PlayerTurnObsHint(domActiveIndex) {
    const base = getLastDomPlaySnapshotIfMatch();
    const ai = asValidPlayerIndex(domActiveIndex);
    if (!base || typeof base !== "object" || ai === null) return base;
    const prevTurn = base.turn && typeof base.turn === "object" ? base.turn : {};
    return {
      ...base,
      activePlayerIndex: ai,
      turn: { ...prevTurn, filledSlotCount: 0 }
    };
  }

  /** Nach Bull-Off-Start: aktive Spalte oft erst Millisekunden später im Snapshot — Player Turn vor dem ersten Wurf. */
  function pokeDomPlayerTurnAfterBullOffStart() {
    try {
      if (!isBullOffPhaseActive()) return;
      const obs = getLastDomPlaySnapshotIfMatch();
      const aiRaw = obs != null ? obs.activePlayerIndex : runtimeState.domLiveActivePlayerIndex;
      const ai = asValidPlayerIndex(aiRaw);
      if (ai == null || !Number.isInteger(ai) || ai < 0) return;
      tryEmitDomPlayerTurnIfIndexChanged(ai, obs || undefined);
    } catch (_) {}
  }

  function resolveActivePlayerFromState(s) {
    const obsDom = getLastDomPlaySnapshotIfMatch();
    if (obsDom) {
      const domPi = asValidPlayerIndex(obsDom.activePlayerIndex);
      if (domPi !== null) return domPi;
    }
    const direct = asValidPlayerIndex(s?.player);
    if (direct !== null) return direct;

    const raw = s?.raw;
    const roots = [raw?.state, raw].filter((x) => x && typeof x === "object");
    for (const root of roots) {
      const cand = [
        root?.throwingPlayerIndex,
        root?.throwingPlayer,
        root?.currentThrowerIndex,
        root?.currentThrower,
        root?.dartThrowerIndex,
        root?.throwerIndex,
        root?.nextPlayerIndex,
        root?.nextPlayer,
        root?.nextCompetitorIndex,
        root?.playerIndex,
        root?.currentPlayerIndex,
        root?.activePlayerIndex,
        root?.competitorIndex,
        root?.participantIndex,
        root?.activeCompetitorIndex,
        root?.player
      ];
      for (const c of cand) {
        const idx = asValidPlayerIndex(c);
        if (idx !== null) return idx;
      }
    }
    return null;
  }

  function stateHintForThrow(t) {
    const h = t?.__admStateHint;
    if (h && typeof h === "object" && h.type === "state") return mergeLastStateWithDomSnapshot(h);
    return mergeLastStateWithDomSnapshot(lastState);
  }

  function deepFindPlayerIndexInThrow(obj, maxDepth, maxNodes) {
    let nodes = 0;
    function walk(o, d) {
      if (d < 0 || !o || typeof o !== "object" || nodes > maxNodes) return null;
      nodes += 1;
      const entries = Object.entries(o).slice(0, 55);
      for (const [k, v] of entries) {
        const lk = String(k).toLowerCase();
        if (
          lk === "playerindex" ||
          lk === "currentplayerindex" ||
          lk === "activeplayerindex" ||
          lk === "throwingplayerindex" ||
          lk === "currentthrowerindex" ||
          lk === "dartthrowerindex" ||
          lk === "throwerindex" ||
          lk === "competitorindex" ||
          lk === "participantindex" ||
          lk === "memberindex" ||
          lk === "seatindex" ||
          lk === "slotindex" ||
          lk === "playerid" ||
          lk === "userid"
        ) {
          const idx = asValidPlayerIndex(v);
          if (idx !== null) return idx;
        }
        if (
          (lk === "player" || lk === "throwingplayer" || lk === "currentthrower") &&
          (typeof v === "number" || typeof v === "string")
        ) {
          const idx = asValidPlayerIndex(v);
          if (idx !== null) return idx;
        }
        if (lk === "order" && typeof v === "number" && v >= 0 && v <= 15) {
          const idx = asValidPlayerIndex(v);
          if (idx !== null) return idx;
        }
      }
      for (const [, v] of entries) {
        if (v && typeof v === "object") {
          const found = walk(v, d - 1);
          if (found !== null) return found;
        }
      }
      return null;
    }
    return walk(obj, maxDepth);
  }

  function getThrowPlayerIndex(t) {
    const st = stateHintForThrow(t);
    const playerCount = effectiveParticipantCount(st);
    const fromPayloadName = sanitizePlayerDisplayName(String(t?.playerName || "").trim());
    const fromName =
      fromPayloadName && !looksLikeDartSegmentOrThrowLabel(fromPayloadName)
        ? findPlayerIndexByName(fromPayloadName)
        : null;

    if (playerCount >= 2 && isBullOffPhaseActive()) {
      /**
       * Werfer-Spalte: zuerst Seite (aktive Spalte), nicht WS-`t.player` — der ist im Cork oft immer `0`,
       * dann liest man nur Spalte 0 (1. Wurf: leer → 0, 2. Wurf: Wert vom 1. Spieler).
       */
      const obs = getDomPlaySnapshotForBullTopBoxRead();
      const snapPi = obs ? asValidPlayerIndex(obs.activePlayerIndex) : null;
      if (snapPi !== null && snapPi >= 0 && snapPi < playerCount) {
        return snapPi;
      }
      const domIdx = runtimeState.domLiveActivePlayerIndex;
      if (domIdx != null && Number.isInteger(domIdx) && domIdx >= 0 && domIdx < playerCount) {
        return domIdx;
      }
      if (fromName !== null && fromName >= 0 && fromName < playerCount) return fromName;
      const fromWs = asValidPlayerIndex(t?.player);
      if (fromWs !== null && fromWs >= 0 && fromWs < playerCount) {
        return fromWs;
      }
      return 0;
    }

    if (playerCount >= 2 && !isBullOffPhaseActive()) {
      const snap = getLastDomPlaySnapshotIfMatch();
      if (snap) {
        const domPi = asValidPlayerIndex(snap.activePlayerIndex);
        if (domPi !== null && domPi >= 0 && domPi < playerCount) {
          runtimeState.visitRotationPlayer = domPi;
          return domPi;
        }
      }
      const live = asValidPlayerIndex(runtimeState.domLiveActivePlayerIndex);
      if (live !== null && live >= 0 && live < playerCount) {
        runtimeState.visitRotationPlayer = live;
        return live;
      }
      return (runtimeState.visitRotationPlayer ?? 0) % playerCount;
    }

    const sticky = ADM.admThrowVisitTracker?.peekStickyPlayerForNextDart?.(t, st);

    if (sticky !== null) return sticky;
    if (fromName !== null) return fromName;

    const fromRoots = st ? inferPlayerIndexFromStateRootsForThrow(st) : null;
    const fromTurn = st ? inferThrowerIndexFromLastTurn(st) : null;
    const direct = asValidPlayerIndex(t?.player);
    /**
     * `deepFind` im Throw-JSON: verschachteltes `player:0` überschreibt sonst korrekte `turns[]` —
     * deshalb **nach** State/Turns. Kein `nextPlayer` in der Suche (s. oben).
     */
    const fromRaw = deepFindPlayerIndexInThrow(t?.bridgeThrowRaw, 8, 260);

    /** Bei Widerspruch: `turns[]` (laufender Visit) vor flachen Root-Indices ohne nextPlayer. */
    if (fromRoots !== null && fromTurn !== null && fromRoots !== fromTurn) return applyStickyToIndex(sticky, fromTurn);
    if (fromRoots !== null && direct !== null && fromRoots !== direct) return applyStickyToIndex(sticky, fromRoots);
    if (fromRoots !== null) return applyStickyToIndex(sticky, fromRoots);

    if (fromTurn !== null && direct !== null && fromTurn !== direct) return applyStickyToIndex(sticky, fromTurn);
    if (fromTurn !== null) return applyStickyToIndex(sticky, fromTurn);
    if (direct !== null) return applyStickyToIndex(sticky, direct);

    if (fromRaw !== null) return applyStickyToIndex(sticky, fromRaw);

    return applyStickyToIndex(sticky, asValidPlayerIndex(lastKnownActivePlayer));
  }

  function applyStickyToIndex(sticky, idx) {
    if (sticky !== null && idx !== null && idx !== sticky) return sticky;
    if (sticky !== null && idx === null) return sticky;
    return idx;
  }

  /** Konsolen-Wurfzeile: echter Name aus State/Cache, nie Segment-Tokens wie „S20“. */
  function resolveThrowerDisplayNameForConsole(t) {
    const idx = getThrowPlayerIndex(t);
    const st = stateHintForThrow(t);
    const fromPayload = sanitizePlayerDisplayName(t?.playerName);
    if (idx != null && idx >= 0 && idx <= 15) {
      const fromState = getPreferredPlayerName(st, idx, "");
      const base = fromState || fromPayload;
      if (base) return normalizeConsolePlayerName(base) || base;
      return `Spieler ${idx + 1}`;
    }
    if (fromPayload) return normalizeConsolePlayerName(fromPayload) || fromPayload;
    return "";
  }

  function looksLikeThrowPayloadForObsZoom(p) {
    if (!p || typeof p !== "object") return false;
    if (p.__admVisitMeta && typeof p.__admVisitMeta === "object") return true;
    const eff = String(p.effect || "").trim().toLowerCase();
    if (
      eff === "throw" ||
      eff === "throw_named" ||
      eff === "throw_chain" ||
      eff === "player_throw" ||
      eff === "bot_throw" ||
      eff === "special_miss" ||
      eff === "outside"
    ) {
      return true;
    }
    if (String(p.segment || "").trim()) return true;
    return Number.isFinite(Number(p.multiplier)) && Number.isFinite(Number(p.number));
  }

  function resolveDisplayNameForObsZoom(payload) {
    if (!payload || typeof payload !== "object") return "";
    const stateLike = mergeLastStateWithDomSnapshot(
      payload.state && typeof payload.state === "object" ? payload.state : lastState
    );
    /**
     * Checkout-Vorschlag: zuerst DOM-Streifen-Name (wie in der Checkout-Zeile), dann Spaltenindex.
     * Wichtig: Ohne Spaltenindex aber mit `playerName` (z. B. „PLAYER 1“) darf nicht sofort "" zurückkommen —
     * sonst bleibt der OBS-Zoom-Spielerfilter ohne Namen und blendet auch korrekte Checkouts aus.
     */
    if (
      String(payload.effect || "") === "checkout_suggestion" &&
      payload._obsZoomRequireDomPlayerColumn === true
    ) {
      const fromStrip = sanitizePlayerDisplayName(String(payload.playerName || "").trim());
      if (fromStrip) return fromStrip;
      const domIdx = asValidPlayerIndex(payload.player ?? payload.playerIndex);
      if (domIdx === null) return "";
      const fromState = getPreferredPlayerName(stateLike, domIdx, "");
      if (fromState) return fromState;
      return "";
    }
    /**
     * `payload.player` aus der Bridge ist nicht zuverlässig (z. B. immer 0) — der Visit-Index aus der Engine
     * bzw. `getThrowPlayerIndex` muss Vorrang haben, sonst sieht der OBS-Zoom-Namensfilter denselben Namen bei jedem Wurf.
     */
    let idx = asValidPlayerIndex(payload?.__admVisitMeta?.throwLogPlayerIndex);
    if (idx === null) idx = asValidPlayerIndex(payload.player ?? payload.playerIndex);
    if (idx === null && Array.isArray(payload.darts) && payload.darts.length) {
      for (let i = payload.darts.length - 1; i >= 0; i -= 1) {
        const d = payload.darts[i];
        if (d && typeof d === "object") {
          const di = getThrowPlayerIndex(d);
          if (di !== null) {
            idx = di;
            break;
          }
        }
      }
    }
    if (idx === null && looksLikeThrowPayloadForObsZoom(payload)) {
      idx = getThrowPlayerIndex(payload);
    }
    if (idx === null) idx = resolveActivePlayerFromState(stateLike);
    if (idx === null) return "";
    const fromState = getPreferredPlayerName(stateLike, idx, "");
    if (fromState) return fromState;
    const fromMeta = String(payload?.__admVisitMeta?.throwerDisplayName || "").replace(/\s+/g, " ").trim();
    return fromMeta || "";
  }

  function dispatchTrigger(triggerKey, payload = {}) {
    ADM.admTriggerBus?.emit?.(triggerKey, payload);
  }

  /** Kontext für Trigger-Quellen (z. B. letzter Match-State beim WS-Wurf). */
  function makeTriggerSourceContext() {
    return {
      getLastState: () => mergeLastStateWithDomSnapshot(lastState)
    };
  }

  function runTriggerSources(kind, payload) {
    const list = ADM.admTriggerSources?.list;
    if (!Array.isArray(list)) return;
    const ctx = makeTriggerSourceContext();
    for (const src of list) {
      if (typeof src.match !== "function" || !src.match(payload)) continue;
      if (kind === "throw") src.handleThrow?.(payload, ctx);
      else if (kind === "state") src.handleState?.(payload, ctx);
      else if (kind === "gameEvent") src.handleGameEvent?.(payload, ctx);
    }
  }

  /** Rest vor dem Wurf, falls die API ihn an `body`/`dart`/`turn` anhängt (Reihenfolge Throw vs. State). */
  function pickRemainingBeforeFromBridgeThrow(t) {
    const raw = t?.bridgeThrowRaw;
    if (!raw || typeof raw !== "object") return null;
    const candidates = [raw, raw.body, raw.dart, raw.turn, raw.before, raw.previous].filter(
      (x) => x && typeof x === "object"
    );
    for (const o of candidates) {
      for (const k of ["remaining", "remainingScore", "scoreLeft", "pointsLeft"]) {
        const v = Number(o[k]);
        if (Number.isFinite(v) && v >= 0 && v <= 1002) return v;
      }
    }
    return null;
  }

  /** Rest vor diesem Wurf für Anzeige (Bridge-Rohtransport bevorzugt, sonst `playerScores`). */
  function pickThrowerRemainingBeforeThrow(t, stateLike, throwLogPlayerIndex) {
    if (isBullOffPhaseActive()) {
      /** Cork: API/Bridge liefert hier oft 0 — echte „Weite“ steht nur in `#ad-ext-player-display`. */
      return null;
    }
    const merged = mergeLastStateWithDomSnapshot(stateLike);
    let pi =
      throwLogPlayerIndex != null && throwLogPlayerIndex >= 0 && throwLogPlayerIndex <= 15
        ? throwLogPlayerIndex
        : asValidPlayerIndex(t?.player);
    if (pi === null) pi = asValidPlayerIndex(lastKnownActivePlayer);

    const rawRem = pickRemainingBeforeFromBridgeThrow(t);
    let stateRem = null;
    if (
      pi !== null &&
      merged &&
      typeof merged === "object" &&
      Array.isArray(merged.playerScores) &&
      pi < merged.playerScores.length
    ) {
      stateRem = Number(merged.playerScores[pi]);
    }

    if (Number.isFinite(rawRem) && rawRem >= 0) return rawRem;
    if (Number.isFinite(stateRem) && stateRem >= 0) return stateRem;
    return null;
  }

  /**
   * Bull-Treffer aus Segment/Score.
   *
   * Hinweis Begriffe (wichtig):
   * - **Einbullen / Bull-Off (Cork):** Wer mit einem Pfeil näher ans Bull kommt, beginnt das Leg;
   *   bei Gleichstand oft Reihenfolge drehen und wiederholen — das ist **nicht** dasselbe wie Leg-Checkout auf Bull
   *   und hier (noch) nicht ausgewertet; dafür bräuchte es Phase/Events aus Autodarts (z. B. Status vor Leg-Start).
   * - **Leg-Checkout auf Bull:** Rest vor dem Wurf === Dart-Punkte (25 oder 50), optional aus Rohtransport.
   *   Wenn der State schon nach dem Wurf kommt (Rest 0), fällt die Heuristik weg — dann helfen WS-Events wie takeout/takeout_finished.
   */
  function inferThrowBullMeta(t, stateLike, throwLogPlayerIndex) {
    const merged = mergeLastStateWithDomSnapshot(stateLike);
    const empty = { isBullHit: false, isLegFinishOnBull: false, remainingBeforeThrow: null };
    if (!t || typeof t !== "object") return empty;
    if (isBullOffPhaseActive()) return empty;
    const segLabel = ADM.admThrowVisitTracker?.formatThrowSegmentLabel?.(t) ?? "";
    const su = String(segLabel || "").toUpperCase();
    const mult = Number(t?.multiplier);
    const num = Number(t?.number);
    const dart = Number(t?.score);
    const isBullHit =
      su === "BULL" ||
      su === "DBULL" ||
      su === "S25" ||
      (num === 25 && (mult === 1 || mult === 2));
    if (!isBullHit) return empty;

    let pi =
      throwLogPlayerIndex != null && throwLogPlayerIndex >= 0 && throwLogPlayerIndex <= 15
        ? throwLogPlayerIndex
        : asValidPlayerIndex(t?.player);
    if (pi === null) pi = asValidPlayerIndex(lastKnownActivePlayer);

    const rawRem = pickRemainingBeforeFromBridgeThrow(t);
    let stateRem = null;
    if (
      pi !== null &&
      merged &&
      typeof merged === "object" &&
      Array.isArray(merged.playerScores) &&
      pi < merged.playerScores.length
    ) {
      stateRem = Number(merged.playerScores[pi]);
    }

    let remainingBeforeThrow = null;
    if (Number.isFinite(rawRem) && rawRem >= 0) remainingBeforeThrow = rawRem;
    else if (Number.isFinite(stateRem) && stateRem >= 0) remainingBeforeThrow = stateRem;

    const isLegFinishOnBull =
      Number.isFinite(dart) &&
      dart > 0 &&
      Number.isFinite(remainingBeforeThrow) &&
      remainingBeforeThrow === dart;

    return {
      isBullHit: true,
      isLegFinishOnBull,
      remainingBeforeThrow: Number.isFinite(remainingBeforeThrow) ? remainingBeforeThrow : null
    };
  }

  function handleThrow(t) {
    if (!isBullOffPhaseActive() && effectiveParticipantCount(lastState) >= 2) {
      try {
        syncEngineVisitCountersFromTracker();
      } catch (_) {}
    }
    const throwLogPlayerIndex = getThrowPlayerIndex(t);
    const pRaw = Number(t?.player);
    if (throwLogPlayerIndex != null && throwLogPlayerIndex >= 0 && throwLogPlayerIndex <= 15) {
      lastKnownActivePlayer = throwLogPlayerIndex;
    } else if (Number.isFinite(pRaw)) {
      lastKnownActivePlayer = pRaw;
    }
    const tForVisit =
      throwLogPlayerIndex != null && throwLogPlayerIndex >= 0 && throwLogPlayerIndex <= 15
        ? { ...t, player: throwLogPlayerIndex }
        : t;
    const visitMeta =
      ADM.admThrowVisitTracker?.processThrow?.(tForVisit, {
        getLastState: () => mergeLastStateWithDomSnapshot(lastState),
        getDomTurnDartHint: getDomTurnDartHintForTracker
      }) || null;
    const visitSkipped = visitMeta && typeof visitMeta === "object" ? !!visitMeta.skipped : false;
    const bullOff = isBullOffPhaseActive();
    if (bullOff && throwLogPlayerIndex != null && throwLogPlayerIndex >= 0 && throwLogPlayerIndex <= 15) {
      const prevThrower = runtimeState.bullOffLastThrowPlayerIndex;
      if (prevThrower != null && prevThrower !== throwLogPlayerIndex) {
        if (!bullOffRoundNeedsContinuation()) {
          runtimeState.suppressDomPlayerTurnUntilTs = Date.now() + 60000;
        }
      }
      runtimeState.bullOffLastThrowPlayerIndex = throwLogPlayerIndex;
    }
    const bullMeta = visitSkipped
      ? { isBullHit: false, isLegFinishOnBull: false, remainingBeforeThrow: null }
      : inferThrowBullMeta(t, lastState, throwLogPlayerIndex);
    const throwerDisplayName = resolveThrowerDisplayNameForConsole(t);
    const domStrip = domPlayerStripAtIndex(throwLogPlayerIndex);
    let stripForAvg = domStrip;
    /** Rest **vor** diesem Wurf (API/State); DOM kann nach Checkout schon 0 zeigen — Leg-Win braucht das echte „vorher“. */
    const throwerRemainingBeforeDart = pickThrowerRemainingBeforeThrow(t, lastState, throwLogPlayerIndex);
    let throwerRemainingScore = throwerRemainingBeforeDart;
    if (bullOff) {
      const obsSnap = getDomPlaySnapshotForBullTopBoxRead();
      let topCork = null;
      if (throwLogPlayerIndex != null && throwLogPlayerIndex >= 0) {
        topCork = pickBullOffProximityFromSnapshotAndStrip(
          obsSnap,
          throwLogPlayerIndex,
          domStrip
        );
      }
      if (topCork == null) {
        const byName = pickBullOffProximityFromDomStripsByName(throwerDisplayName);
        if (byName.value != null && Number.isFinite(Number(byName.value))) {
          topCork = Number(byName.value);
          if (byName.strip) stripForAvg = byName.strip;
        }
      }
      if (topCork == null) {
        const domAi = asValidPlayerIndex(runtimeState.domLiveActivePlayerIndex);
        if (domAi != null) {
          const activeStrip = domPlayerStripAtIndex(domAi);
          const byActive = pickBullOffProximityFromSnapshotAndStrip(obsSnap, domAi, activeStrip);
          if (byActive != null) {
            topCork = byActive;
            stripForAvg = activeStrip || stripForAvg;
          }
        }
      }
      if (topCork == null && throwLogPlayerIndex != null && throwLogPlayerIndex >= 0) {
        const alt = asValidPlayerIndex(obsSnap?.activePlayerIndex);
        if (alt != null && alt !== throwLogPlayerIndex) {
          const altStrip = domPlayerStripAtIndex(alt);
          const tryAlt = pickBullOffProximityFromSnapshotAndStrip(obsSnap, alt, altStrip);
          if (tryAlt != null) {
            topCork = tryAlt;
            stripForAvg = altStrip;
          }
        }
      }
      if (topCork != null && Number.isFinite(topCork)) throwerRemainingScore = topCork;
    } else if (domStrip != null && Number.isFinite(Number(domStrip.remaining))) {
      throwerRemainingScore = Number(domStrip.remaining);
    }
    const throwerAverageDisplay =
      stripForAvg != null && stripForAvg.average != null && String(stripForAvg.average).trim()
        ? String(stripForAvg.average).trim()
        : null;
    const logMetaPatch = {
      throwerDisplayName,
      throwLogPlayerIndex:
        throwLogPlayerIndex != null && throwLogPlayerIndex >= 0 && throwLogPlayerIndex <= 15
          ? throwLogPlayerIndex
          : null,
      isBullHit: !!bullMeta.isBullHit,
      isLegFinishOnBull: !!bullMeta.isLegFinishOnBull,
      isBullOffPhase: bullOff,
      remainingBeforeThrow:
        bullMeta.remainingBeforeThrow != null && Number.isFinite(bullMeta.remainingBeforeThrow)
          ? bullMeta.remainingBeforeThrow
          : throwerRemainingBeforeDart != null && Number.isFinite(throwerRemainingBeforeDart)
            ? throwerRemainingBeforeDart
            : null,
      throwerRemainingScore:
        throwerRemainingScore != null && Number.isFinite(throwerRemainingScore)
          ? throwerRemainingScore
          : null,
      throwerAverageDisplay
    };
    const pcLog = effectiveParticipantCount(lastState);
    const engineThrow123 =
      pcLog >= 2 && !visitSkipped
        ? bullOff
          ? 1
          : Math.min(3, Math.max(1, (runtimeState.visitDartsCompletedInTurn ?? 0) + 1))
        : null;
    const baseVisitMeta =
      visitMeta && typeof visitMeta === "object"
        ? { ...visitMeta, ...logMetaPatch }
        : {
            skipped: false,
            dartIndexInVisit: 1,
            segmentLabel: "?",
            score: NaN,
            isCorrection: false,
            inputModeLabel: String(t?.inputMode || "Unbekannt").trim() || "Unbekannt",
            ...logMetaPatch
          };
    const trackerDartIdx = Number(baseVisitMeta?.dartIndexInVisit);
    const trackerHasValidDartIdx =
      Number.isFinite(trackerDartIdx) &&
      trackerDartIdx >= 1 &&
      trackerDartIdx <= 3;
    const trackerLooksResetToOne =
      !bullOff &&
      trackerHasValidDartIdx &&
      trackerDartIdx === 1 &&
      engineThrow123 != null &&
      engineThrow123 > 1 &&
      baseVisitMeta?.isCorrection !== true;
    if (engineThrow123 != null && (!trackerHasValidDartIdx || trackerLooksResetToOne)) {
      baseVisitMeta.dartIndexInVisit = engineThrow123;
    }
    /**
     * X01: Player Turn per DOM (`printTurnPreamble`). Bull-Off: Player Turn ebenfalls DOM + Cork-Gewinner-Lock; Wurfzeile `printAdmThrowLine`.
     */
    if (!visitSkipped && pcLog >= 2 && engineThrow123 === 1) {
      baseVisitMeta.suppressPlayerTurnOnDart1 = true;
    }
    const tWithMeta = { ...t, __admVisitMeta: baseVisitMeta };
    if (
      !bullOff &&
      throwLogPlayerIndex != null &&
      throwLogPlayerIndex >= 0 &&
      throwLogPlayerIndex <= 15
    ) {
      const segForCache = String(baseVisitMeta?.segmentLabel || "").trim();
      const scoreForCache = Number(baseVisitMeta?.score);
      runtimeState.lastThrowInfoByPlayer[throwLogPlayerIndex] = {
        segment: segForCache && segForCache !== "?" ? segForCache : "",
        score: Number.isFinite(scoreForCache) ? scoreForCache : null,
        ts: Date.now()
      };
    }
    const pcRot = effectiveParticipantCount(lastState);
    if (!visitMeta?.skipped) {
      if (!bullOff) {
        runtimeState.throwCountThisMatch = (runtimeState.throwCountThisMatch || 0) + 1;
        if (pcRot >= 2) {
          const v = (runtimeState.visitDartsCompletedInTurn ?? 0) + 1;
          if (v >= 3) {
            runtimeState.visitDartsCompletedInTurn = 0;
            runtimeState.visitRotationPlayer = ((runtimeState.visitRotationPlayer ?? 0) + 1) % pcRot;
          } else {
            runtimeState.visitDartsCompletedInTurn = v;
          }
        }
      }
    }

    const finalizeThrow = (finalThrowPayload) => {
      if (
        bullOff &&
        !visitSkipped &&
        throwLogPlayerIndex != null &&
        throwLogPlayerIndex >= 0 &&
        throwLogPlayerIndex <= 15
      ) {
        runtimeState.bullOffThrowSerial += 1;
        if (!bullOffRoundNeedsContinuation()) {
          runtimeState.suppressDomPlayerTurnUntilTs = Date.now() + 60000;
        }
      }
      if (!bullOff && lastState?.gameFinished === true) {
        try {
          const st = lastState;
          const pi = asValidPlayerIndex(finalThrowPayload?.player);
          const meta = finalThrowPayload?.__admVisitMeta;
          const rb = Number(meta?.remainingBeforeThrow);
          const sc = Number(finalThrowPayload?.score);
          const checkoutConfirmed =
            pi !== null &&
            throwLooksLikeLegCheckoutDart(finalThrowPayload) &&
            Number.isFinite(rb) &&
            Number.isFinite(sc) &&
            rb === sc;
          if (checkoutConfirmed) {
            const legWinKey = `${String(st?.matchId || "").trim() || "_"}|${st?.set ?? "_"}|${st?.leg ?? "_"}`;
            if (legWinKey !== runtimeState.lastLegWinLoggedKey) {
              runtimeState.lastLegWinLoggedKey = legWinKey;
              const throwerName = String(meta?.throwerDisplayName || "").replace(/\s+/g, " ").trim();
              const seg = inferLegWinSegmentFromThrow(finalThrowPayload) || String(meta?.segmentLabel || "").trim() || "?";
              ADM.triggerWorkerLog?.printAdmLegWinLine?.(
                {
                  playerName: throwerName || getPreferredPlayerName(st, pi, `Spieler ${pi + 1}`),
                  checkoutPoints: rb,
                  lastSegment: seg
                },
                { defer: true }
              );
            }
          }
        } catch (_) {}
      }
      syncRuntimeState({
        lastThrow: finalThrowPayload,
        lastState,
        lastKnownActivePlayer
      });
      try {
        ADM.overlay?.handleThrow?.(t);
      } catch (_) {}
      runTriggerSources("throw", finalThrowPayload);
    };

    if (bullOff) {
      const BULL_OFF_RETRY_MAX = 4;
      const BULL_OFF_RETRY_DELAY_MS = 45;
      const tryFinalizeBullOffThrow = (attempt, lastPayload) => {
        let candidate = lastPayload || tWithMeta;
        try {
          candidate =
            finalThrowMetaWithLatestBullOffProximity(candidate, throwLogPlayerIndex, throwerDisplayName, domStrip, stripForAvg)
            || candidate;
        } catch (_) {}

        const rem = Number(candidate?.__admVisitMeta?.throwerRemainingScore);
        const hasUsableValue = Number.isFinite(rem) && rem !== 0;
        if (hasUsableValue || attempt >= BULL_OFF_RETRY_MAX) {
          finalizeThrow(candidate);
          return;
        }
        setTimeout(() => {
          tryFinalizeBullOffThrow(attempt + 1, candidate);
        }, BULL_OFF_RETRY_DELAY_MS);
      };
      setTimeout(() => {
        tryFinalizeBullOffThrow(0, tWithMeta);
      }, BULL_OFF_RETRY_DELAY_MS);
      return;
    }

    finalizeThrow(tWithMeta);
  }

  function finalThrowMetaWithLatestBullOffProximity(tWithMeta, throwLogPlayerIndex, throwerDisplayName, domStrip, stripForAvg) {
    const obsSnap = getDomPlaySnapshotForBullTopBoxRead();
    let topCork = null;
    let bestStripForAvg = stripForAvg || domStrip || null;

    if (throwLogPlayerIndex != null && throwLogPlayerIndex >= 0) {
      topCork = pickBullOffProximityFromSnapshotAndStrip(obsSnap, throwLogPlayerIndex, domStrip);
    }
    if (topCork == null) {
      const byName = pickBullOffProximityFromDomStripsByName(throwerDisplayName);
      if (byName.value != null && Number.isFinite(Number(byName.value))) {
        topCork = Number(byName.value);
        if (byName.strip) bestStripForAvg = byName.strip;
      }
    }
    if (topCork == null) {
      const domAi = asValidPlayerIndex(runtimeState.domLiveActivePlayerIndex);
      if (domAi != null) {
        const activeStrip = domPlayerStripAtIndex(domAi);
        const byActive = pickBullOffProximityFromSnapshotAndStrip(obsSnap, domAi, activeStrip);
        if (byActive != null) {
          topCork = byActive;
          bestStripForAvg = activeStrip || bestStripForAvg;
        }
      }
    }
    if (topCork == null || !Number.isFinite(Number(topCork))) {
      return tWithMeta;
    }

    const nextMeta = {
      ...(tWithMeta.__admVisitMeta || {}),
      throwerRemainingScore: Number(topCork),
      throwerAverageDisplay:
        bestStripForAvg != null && bestStripForAvg.average != null && String(bestStripForAvg.average).trim()
          ? String(bestStripForAvg.average).trim()
          : (tWithMeta.__admVisitMeta?.throwerAverageDisplay ?? null)
    };
    return { ...tWithMeta, __admVisitMeta: nextMeta };
  }

  /** Genau ein Spieler mit Rest 0 — `scores[i]` kann `null` sein (Platzhalter aus DOM). */
  function pickSingleZeroPlayerIndexFromScores(scores) {
    if (!Array.isArray(scores) || scores.length < 2) return null;
    let z = -1;
    let c = 0;
    for (let i = 0; i < scores.length; i += 1) {
      const n = Number(scores[i]);
      if (Number.isFinite(n) && n === 0) {
        c += 1;
        z = i;
      }
    }
    if (c === 1) return z;
    return null;
  }

  function winnerIndexHasZeroOnScores(idx, scores) {
    if (!Number.isInteger(idx) || idx < 0 || !Array.isArray(scores)) return false;
    if (idx >= scores.length) return false;
    const n = Number(scores[idx]);
    return Number.isFinite(n) && n === 0;
  }

  /** Leg-Gewinner nur aus DOM-Snapshot (`players[].scoreRemaining`): genau eine 0. */
  function pickLegWinnerIndexFromDomPlayersOnly() {
    const obs = getLastDomPlaySnapshotIfMatch();
    if (!obs || !Array.isArray(obs.players) || obs.players.length < 2) return null;
    let winnerIdx = -1;
    let winnerCount = 0;
    for (let i = 0; i < obs.players.length; i += 1) {
      if (obs.players[i]?.isWinner === true) {
        winnerCount += 1;
        winnerIdx = i;
      }
    }
    if (winnerCount === 1) return winnerIdx;
    let z = -1;
    let c = 0;
    for (let i = 0; i < obs.players.length; i += 1) {
      const n = Number(obs.players[i]?.scoreRemaining);
      if (Number.isFinite(n) && n === 0) {
        c += 1;
        z = i;
      }
    }
    if (c === 1) return z;
    return null;
  }

  function parseStartScoreFromMatchFormatSummary() {
    const txt = String(runtimeState.matchFormatSummary || "").trim();
    if (!txt) return null;
    const m = txt.match(/(?:^|\/)\s*(\d{2,3})\s*(?:\/|$)/);
    if (!m) return null;
    const n = Number(m[1]);
    if (!Number.isFinite(n) || n < 101 || n > 1001) return null;
    return Math.trunc(n);
  }

  /** Fallback: gemischte Scores (nur wenn DOM keine eindeutige 0 liefert). */
  function pickLegWinnerIndexFromFinishedScores(stateLike) {
    const merged = mergeLastStateWithDomSnapshot(stateLike);
    return pickSingleZeroPlayerIndexFromScores(merged?.playerScores);
  }

  /** Legs-Won aus WS-`stats[]` (Fallback wenn DOM-Snapshot noch fehlt). */
  function extractLegsWonPerPlayerFromStateRoots(stateLike) {
    const roots = [stateLike?.raw?.state, stateLike?.raw, stateLike].filter(
      (x) => x && typeof x === "object"
    );
    for (const root of roots) {
      const stats = root?.stats;
      if (!Array.isArray(stats) || stats.length < 2) continue;
      const out = [];
      for (let i = 0; i < stats.length; i++) {
        const st = stats[i];
        let lw = null;
        const legSt = st?.legStats;
        if (legSt && typeof legSt === "object") {
          lw = Number(
            legSt.legsWon ?? legSt.legs ?? legSt.wonLegs ?? legSt.legswon ?? legSt.count
          );
        }
        if (!Number.isFinite(lw)) lw = Number(st?.legsWon ?? st?.legs ?? st?.wonLegs);
        out.push(Number.isFinite(lw) && lw >= 0 ? Math.trunc(lw) : null);
      }
      if (out.some((x) => x != null)) return out;
    }
    return null;
  }

  /**
   * Zeile für „Next Leg“: `Name gewLegs | Name gewLegs` (Reihenfolge wie Spieler-Spalten im DOM).
   */
  function buildNextLegRosterLine(stateLike) {
    const obs = getLastDomPlaySnapshotIfMatch();
    if (obs && Array.isArray(obs.players) && obs.players.length >= 2) {
      const parts = [];
      for (let i = 0; i < obs.players.length; i++) {
        const p = obs.players[i];
        const name =
          sanitizePlayerDisplayName(String(p?.displayName || "").trim()) || `Spieler ${i + 1}`;
        let lw = Number(p?.legsWon);
        if (!Number.isFinite(lw)) lw = 0;
        parts.push(`${name} ${Math.max(0, Math.trunc(lw))}`);
      }
      if (parts.length) return parts.join(" | ");
    }
    const roster = pickGameOnRosterNames(stateLike);
    const lwArr = extractLegsWonPerPlayerFromStateRoots(stateLike);
    if (roster.length >= 2) {
      const parts = [];
      for (let i = 0; i < roster.length; i++) {
        const n = roster[i];
        let c = 0;
        if (lwArr && lwArr[i] != null) c = lwArr[i];
        parts.push(`${n} ${c}`);
      }
      return parts.join(" | ");
    }
    return "";
  }

  function tryLogNextLegWorkerLine(current, prev) {
    if (!current || typeof current !== "object" || !prev || typeof prev !== "object") return;
    if (stateLikeLobbyOrPreGame(current)) return;
    const pl = Number(prev.leg);
    const cl = Number(current.leg);
    if (!Number.isFinite(cl) || !Number.isFinite(pl)) return;
    if (cl <= pl) return;
    if (pl < 1) return;
    const ps = prev.set ?? "_";
    const cs = current.set ?? "_";
    if (String(ps) !== String(cs)) return;
    if (current.gameFinished) return;
    const mid = String(current?.matchId ?? "").trim() || "_";
    const dedupe = `${mid}|${cs}|${cl}`;
    if (dedupe === runtimeState.lastNextLegLoggedKey) return;
    const line = buildNextLegRosterLine(current);
    if (!line) return;
    runtimeState.lastNextLegLoggedKey = dedupe;
    try {
      ADM.triggerWorkerLog?.printAdmNextLegLine?.(line);
    } catch (_) {}
  }

  function resolveWinnerIndexFromState(stateLike) {
    const direct = asValidPlayerIndex(stateLike?.winner);
    if (direct !== null) return direct;
    const roots = [stateLike?.raw?.state, stateLike?.raw, stateLike].filter((x) => x && typeof x === "object");
    const winnerKeys = [
      "gameWinner",
      "winner",
      "winnerIndex",
      "winningPlayer",
      "winningPlayerIndex",
      "winnerPlayerIndex",
      "legWinner",
      "legWinnerIndex"
    ];
    for (const root of roots) {
      for (const key of winnerKeys) {
        const idx = asValidPlayerIndex(root?.[key]);
        if (idx !== null) return idx;
      }
    }
    return null;
  }

  function inferLegWinSegmentFromThrow(t) {
    if (!t || typeof t !== "object") return "";
    const m = Number(t.multiplier);
    const num = Number(t.number);
    if (m === 2 && num === 25) return "DBULL";
    if (m === 2 && Number.isFinite(num) && num >= 1 && num <= 20) return `D${num}`;
    let seg = String(t?.__admVisitMeta?.segmentLabel || "").trim();
    if (seg && seg !== "?") return seg;
    try {
      return String(ADM.admThrowVisitTracker?.formatThrowSegmentLabel?.(t) || "").trim();
    } catch (_) {
      return "";
    }
  }

  function throwLooksLikeLegCheckoutDart(t) {
    if (!t || typeof t !== "object") return false;
    const mult = Number(t?.multiplier);
    const num = Number(t?.number);
    if (mult === 2 && Number.isFinite(num) && num >= 1 && num <= 25) {
      return true;
    }
    let seg = String(t?.__admVisitMeta?.segmentLabel || "").trim().toUpperCase();
    if (!seg || seg === "?") {
      try {
        seg = String(ADM.admThrowVisitTracker?.formatThrowSegmentLabel?.(t) || "")
          .trim()
          .toUpperCase();
      } catch (_) {
        seg = "";
      }
    }
    if (!seg) return false;
    if (seg === "DBULL") return true;
    const compact = seg.replace(/\s+/g, "");
    /** D1–D20 (inkl. D01/D08), D25 Bull-Checkout */
    return /^D(?:0?[1-9]|1\d|20|25)$/.test(compact);
  }

  /**
   * Gewinner-Visit aus WS-State: Summe der Dart-Punkte (= Checkout-Höhe der Aufnahme) + letztes Segment.
   */
  function pickLegWinCheckoutFromState(stateLike, winnerIdx) {
    if (!Number.isInteger(winnerIdx) || winnerIdx < 0) {
      return { visitTotal: null, lastSeg: "" };
    }
    const roots = [stateLike?.raw?.state, stateLike?.raw, stateLike].filter(
      (x) => x && typeof x === "object"
    );
    const fmt = ADM.admThrowVisitTracker?.formatThrowSegmentLabel;
    for (const root of roots) {
      const turns = root?.turns;
      if (!Array.isArray(turns) || !turns.length) continue;
      for (let i = turns.length - 1; i >= 0; i -= 1) {
        const turn = turns[i];
        if (!turn || typeof turn !== "object") continue;
        const tp = Number(
          turn.player ??
            turn.playerIndex ??
            turn.playerId ??
            turn.competitorIndex ??
            turn.participantIndex
        );
        if (tp !== winnerIdx) continue;
        const darts = turn.darts ?? turn.throws ?? turn.dartThrows ?? turn.hits;
        if (!Array.isArray(darts) || !darts.length) continue;
        let sum = 0;
        for (const d of darts) {
          const sc = Number(d?.score ?? d?.points);
          if (Number.isFinite(sc)) sum += sc;
        }
        const lastDart = darts[darts.length - 1];
        let lastSeg = "";
        if (lastDart && typeof lastDart === "object" && typeof fmt === "function") {
          try {
            lastSeg = String(fmt(lastDart) || "").trim();
          } catch (_) {
            lastSeg = "";
          }
        }
        return { visitTotal: sum > 0 ? sum : null, lastSeg };
      }
    }
    return { visitTotal: null, lastSeg: "" };
  }

  function handleState(s) {
    const rawSource = String(s?.raw?.source ?? "").trim();
    if (rawSource === "autodarts_boards") {
      const rs = String(s?.raw?.boardStatus ?? s?.raw?.observed?.status ?? "").trim();
      runtimeState.wsBoardTakeoutInProgress = rs === "Takeout in progress";
      try {
        maybeEmitTakeoutWorkerLines();
      } catch (_) {}
      return;
    }
    if (rawSource === "dom_play_snapshot") {
      const obs = s?.raw?.observed;
      if (obs && typeof obs === "object") {
        const mode = resolveDomSnapshotMode(obs);
        hydrateRuntimeFromDomPlaySnapshot(s, obs);
        const domBustNow = obs?.turn?.isBust === true;
        const domBustRising = domBustNow && runtimeState.lastDomBustSeen !== true;
        runtimeState.lastDomBustSeen = domBustNow;
        if (domBustRising && mode === MODE_X01) {
          const nowTs = Date.now();
          if (nowTs - Number(runtimeState.lastBustLogAtTs || 0) > 500) {
            runtimeState.lastBustLogAtTs = nowTs;
            try {
              ADM.triggerWorkerLog?.printAdmBustLine?.();
            } catch (_) {}
          }
        }
        syncRuntimeState({
          lastDomPlaySnapshot: cloneValue(obs),
          lastDomPlaySnapshotAt: Date.now()
        });
        applyDomPlaySnapshotToRuntime(obs);
        runtimeState.lastDomBoardTakeoutHint = obs?.boardDetection?.takeoutActive === true;
        try {
          maybeEmitTakeoutWorkerLines();
        } catch (_) {}
      }
      return;
    }
    if (rawSource === "dom_checkout") {
      if (isBullOffPhaseActive()) return;
      const segRaw = String(s?.checkoutGuide ?? "").replace(/\s+/g, " ").trim();
      const ntRaw = s?.checkoutNextThrow;
      const nextThrow =
        ntRaw != null && ntRaw !== "" && Number.isFinite(Number(ntRaw)) ? Math.trunc(Number(ntRaw)) : NaN;
      const rem = Number(s?.remainingScore);
      const th = checkoutThresholdFromSettings();
      if (!segRaw || nextThrow < 1 || nextThrow > 3 || !Number.isFinite(rem) || rem <= 0 || rem > th) {
        return;
      }
      const visitSum = Number(s?.turnVisitSum);
      let resolvedCheckout = null;
      try {
        resolvedCheckout = ADM.obsZoom?.resolveDomCheckoutGuide?.(segRaw, { remainingScore: rem });
      } catch (_) {
        resolvedCheckout = null;
      }
      if (!resolvedCheckout || typeof resolvedCheckout !== "object") {
        resolvedCheckout = { logLine: segRaw, displaySegment: segRaw, guideRaw: segRaw, usedOverride: false };
      }
      const sig = `${String(s?.matchId ?? "").trim() || "_"}|${Number.isFinite(visitSum) ? visitSum : "?"}|${nextThrow}|${String(resolvedCheckout.logLine || segRaw).toUpperCase()}`;
      if (sig === runtimeState.lastDomCheckoutGuideSig) return;
      runtimeState.lastDomCheckoutGuideSig = sig;
      const domAiCheckout =
        asValidPlayerIndex(s?.domActivePlayerIndex) ??
        asValidPlayerIndex(runtimeState.domLiveActivePlayerIndex);
      if (nextThrow === 1 && domAiCheckout !== null) {
        try {
          tryEmitDomPlayerTurnIfIndexChanged(
            domAiCheckout,
            buildDomCheckoutThrow1PlayerTurnObsHint(domAiCheckout)
          );
        } catch (_) {}
      }
      const checkoutStrip = domAiCheckout !== null ? domPlayerStripAtIndex(domAiCheckout) : null;
      const checkoutDomPlayerName =
        checkoutStrip && typeof checkoutStrip.name === "string"
          ? String(checkoutStrip.name).replace(/\s+/g, " ").trim()
          : "";
      try {
        ADM.triggerWorkerLog?.printCheckoutGuideLine?.(segRaw, {
          nextThrow,
          domActivePlayerIndex: domAiCheckout,
          checkoutDomPlayerName: checkoutDomPlayerName || undefined,
          remainingScore: rem,
          resolvedCheckoutGuide: resolvedCheckout
        });
      } catch (_) {}
      return;
    }
    if (rawSource === "dom_player_display") {
      const arr = Array.isArray(s?.playerDisplayByIndex) ? s.playerDisplayByIndex : [];
      runtimeState.domPlayerDisplayByIndex = arr;
      const dai = s?.domActivePlayerIndex;
      if (dai != null && Number.isInteger(Number(dai))) {
        const n = Number(dai);
        runtimeState.domLiveActivePlayerIndex = n;
        tryEmitDomPlayerTurnIfIndexChanged(n);
      }
      return;
    }
    if (rawSource === "dom_game_variant") {
      rememberPlayPathMatchId(s?.matchId);
      const next = typeof s?.gameVariant === "string" ? String(s.gameVariant).trim() : "";
      const prev = String(runtimeState.gameVariantLabel ?? "").trim();
      runtimeState.gameVariantLabel = next;
      runtimeState.matchFormatSummary =
        typeof s?.matchFormatSummary === "string" ? String(s.matchFormatSummary).trim() : "";
      const now = isBullOffPhaseLabel(next);
      const was = isBullOffPhaseLabel(prev);
      if (now && runtimeState.bullOffPhaseLatched) {
        syncRuntimeState({ lastState, lastKnownActivePlayer });
        return;
      }
      if (now && !was) {
        const rosterForBull = pickGameOnRosterNames(lastState);
        const fmtSumm =
          typeof s?.matchFormatSummary === "string" ? String(s.matchFormatSummary).trim() : "";
        runtimeState.lastTurnPreambleLoggedKey = "";
        runtimeState.turnPreambleEmitInFlightKey = "";
        runtimeState.turnPreambleLogSeq = 0;
        runtimeState.lastDomLoggedActivePlayerIndex = null;
        runtimeState.lastDomSnapshotAppliedActiveIndex = null;
        runtimeState.domLiveActivePlayerIndex = null;
        /** Altes Page-Roster (z. B. 4 Spieler) nicht in Cork/X01 übernehmen */
        runtimeState.matchContextRosterNames = [];
        runtimeState.pendingLegStartRotationSeed = false;
        runtimeState.visitDartsCompletedInTurn = 0;
        runtimeState.visitRotationPlayer = 0;
        runtimeState.bullOffThrowSerial = 0;
        runtimeState.bullOffTurnPromptSerial = -1;
        tryLogBullOffGameOnStart(
          rosterForBull,
          next,
          fmtSumm,
          lastState,
          s?.matchId ?? lastState?.matchId ?? null
        );
        try {
          queueMicrotask(pokeDomPlayerTurnAfterBullOffStart);
        } catch (_) {
          pokeDomPlayerTurnAfterBullOffStart();
        }
        setTimeout(pokeDomPlayerTurnAfterBullOffStart, 90);
        try {
          ADM.admTriggerBus?.emit?.("bull_off_start", {
            effect: "bull_off_start",
            gameVariant: next,
            matchId: s?.matchId ?? null
          });
        } catch (_) {}
      }
      if (!now && was) {
        runtimeState.bullOffPhaseLatched = false;
        runtimeState.bullOffLastThrowPlayerIndex = null;
        runtimeState.bullOffThrowSerial = 0;
        runtimeState.bullOffTurnPromptSerial = -1;
        runtimeState.suppressDomPlayerTurnUntilTs = 0;
        runtimeState.lastTurnPreambleLoggedKey = "";
        runtimeState.turnPreambleEmitInFlightKey = "";
        runtimeState.turnPreambleLogSeq = 0;
        runtimeState.lastDomLoggedActivePlayerIndex = null;
        runtimeState.lastDomSnapshotAppliedActiveIndex = null;
        runtimeState.domLiveActivePlayerIndex = null;
        runtimeState.lastBullOffPlayerTurnAt = 0;
        runtimeState.pendingLegStartRotationSeed = true;
        runtimeState.visitDartsCompletedInTurn = 0;
        runtimeState.visitRotationPlayer = 0;
        runtimeState.throwCountThisMatch = 0;
        /** Sonst ein X01-Game-ON noch mit altem 4er-Page-Roster */
        runtimeState.matchContextRosterNames = [];
        try {
          ADM.admThrowVisitTracker?.resetAfterBullOffToLegPlay?.();
        } catch (_) {}
        try {
          ADM.triggerWorkerLog?.resetThrowSerialCounters?.();
        } catch (_) {}
        tryLogGameOnAfterBullOffEnd();
        try {
          ADM.admTriggerBus?.emit?.("bull_off_end", {
            effect: "bull_off_end",
            gameVariant: next,
            matchId: s?.matchId ?? null
          });
        } catch (_) {}
      }
      syncRuntimeState({ lastState, lastKnownActivePlayer });
      if (String(runtimeState.matchFormatSummary || "").trim()) {
        try {
          if (!isBullOffPhaseActive()) {
            tryLogGameOnRoster(lastState, s?.matchId ?? lastState?.matchId ?? null);
          }
        } catch (_) {}
      }
      return;
    }

    const prevStateForEdge = lastState;
    lastState = s;
    const mid = String(s?.matchId ?? "").trim() || null;
    if (mid) rememberPlayPathMatchId(mid);
    if (mid && mid !== runtimeState.matchIdForThrowCounter) {
      /** Bei Matchwechsel keinen Bull-off-Status mitschleppen (sonst X01-Logik gebremst). */
      const preserveBullOffStartState = false;
      const preservedDomLoggedActive = null;
      runtimeState.matchIdForThrowCounter = mid;
      runtimeState.throwCountThisMatch = 0;
      runtimeState.rosterParticipantCount = 0;
      runtimeState.visitRotationPlayer = 0;
      runtimeState.visitDartsCompletedInTurn = 0;
      runtimeState.gameVariantLabel = "";
      runtimeState.matchFormatSummary = "";
      runtimeState.pendingLegStartRotationSeed = false;
      runtimeState.matchContextRosterNames = [];
      runtimeState.playPathMatchId = mid;
      runtimeState.visitDarts = [];
      runtimeState.visitThrows = [];
      runtimeState.checkout = null;
      runtimeState.domPlayerDisplayByIndex = [];
      runtimeState.domLiveActivePlayerIndex = null;
      runtimeState.lastTurnPreambleLoggedKey = "";
      runtimeState.turnPreambleEmitInFlightKey = "";
      runtimeState.turnPreambleLogSeq = 0;
      runtimeState.lastTurnPlayerIndex = null;
      runtimeState.lastTurnPlayerName = "";
      runtimeState.lastDomLoggedActivePlayerIndex = preserveBullOffStartState ? preservedDomLoggedActive : null;
      runtimeState.lastDomSnapshotAppliedActiveIndex = null;
      runtimeState.lastLegWinLoggedKey = "";
      runtimeState.lastNextLegLoggedKey = "";
      runtimeState.lastDomCheckoutGuideSig = "";
      runtimeState.lastDomPlaySnapshot = null;
      runtimeState.lastDomPlaySnapshotAt = 0;
      runtimeState.lastDomBustSeen = false;
      runtimeState.wsBoardTakeoutInProgress = false;
      runtimeState.lastDomBoardTakeoutHint = false;
      runtimeState.lastTakeoutCombinedActive = false;
      runtimeState.bullOffGameOnGate = preserveBullOffStartState ? runtimeState.bullOffGameOnGate : "";
      runtimeState.bullOffGameOnRosterGate = preserveBullOffStartState ? runtimeState.bullOffGameOnRosterGate : "";
      runtimeState.bullOffPhaseLatched = preserveBullOffStartState ? runtimeState.bullOffPhaseLatched : false;
      runtimeState.lastBullOffGameOnRosterFp = preserveBullOffStartState ? runtimeState.lastBullOffGameOnRosterFp : "";
      runtimeState.lastBullOffGameOnAtTs = preserveBullOffStartState ? runtimeState.lastBullOffGameOnAtTs : 0;
      runtimeState.bullOffCorkWinnerIndex = preserveBullOffStartState ? runtimeState.bullOffCorkWinnerIndex : null;
      runtimeState.suppressDomPlayerTurnUntilTs = 0;
      runtimeState.lastBullOffPlayerTurnAt = preserveBullOffStartState ? runtimeState.lastBullOffPlayerTurnAt : 0;
      runtimeState.bullOffLastThrowPlayerIndex = preserveBullOffStartState ? runtimeState.bullOffLastThrowPlayerIndex : null;
      runtimeState.bullOffThrowSerial = preserveBullOffStartState ? runtimeState.bullOffThrowSerial : 0;
      runtimeState.bullOffTurnPromptSerial = preserveBullOffStartState ? runtimeState.bullOffTurnPromptSerial : -1;
      runtimeState.lastThrowInfoByPlayer = {};
      runtimeState.lastBustLogAtTs = 0;
      clearMatchScopedPlayerMemory();
      clearGameOnDedupeCaches();
      try {
        ADM.admThrowVisitTracker?.resetForNewMatch?.();
      } catch (_) {}
      try {
        ADM.triggerWorkerLog?.resetForNewMatch?.();
      } catch (_) {}
    }
    /** Pro Leg (gleiche matchId): `throwCountThisMatch` sonst >0 → kein Game ON / falsche Guards nach Leg Win. */
    if (
      prevStateForEdge &&
      typeof prevStateForEdge === "object" &&
      mid &&
      String(prevStateForEdge.matchId ?? "").trim() === mid
    ) {
      const legKey = (st) => `${st?.set ?? "_"}|${st?.leg ?? "_"}`;
      if (legKey(prevStateForEdge) !== legKey(s)) {
        runtimeState.throwCountThisMatch = 0;
      }
    }
    const ap = resolveActivePlayerFromState(s);
    if (ap !== null) lastKnownActivePlayer = ap;
    rememberPlayerNamesFromState(s);
    const mpl = maxPlayerListLength(s);
    if (mpl >= 2) {
      const prevPc = runtimeState.rosterParticipantCount || 0;
      /** Nicht nur wachsen: nach Rematch mit weniger Spielern sonst Rotation/Tracker für 4er */
      runtimeState.rosterParticipantCount =
        prevPc > mpl ? mpl : Math.max(prevPc, mpl);
    }
    const wsSrc = String(s?.bridgeSource ?? "").trim() === "websocket";
    const bustRising = wsSrc && !!s.turnBusted && !prevStateForEdge?.turnBusted;
    if (bustRising && !isBullOffPhaseActive()) {
      const nowTs = Date.now();
      if (nowTs - Number(runtimeState.lastBustLogAtTs || 0) > 500) {
        runtimeState.lastBustLogAtTs = nowTs;
        try {
          ADM.triggerWorkerLog?.printAdmBustLine?.();
        } catch (_) {}
      }
    }
    if (bustRising && isBullOffPhaseActive()) {
      try {
        ADM.triggerWorkerLog?.clearVisitSummaryAfterUndo?.();
      } catch (_) {}
    }
    try {
      ADM.admThrowVisitTracker?.reconcileFromState?.(s);
    } catch (_) {}
    syncEngineVisitCountersFromTracker();
    if (bustRising && !isBullOffPhaseActive()) {
      const pc = effectiveParticipantCount(s);
      if (pc >= 2) {
        runtimeState.visitDartsCompletedInTurn = 0;
        const nxt = resolveActivePlayerFromState(s);
        if (nxt !== null && nxt >= 0 && nxt < pc) {
          runtimeState.visitRotationPlayer = nxt;
        }
      }
      try {
        const lt = runtimeState.lastThrow;
        const bMid = String(lt?.matchId ?? "").trim();
        const curMid = String(mid ?? "").trim();
        const bpi = asValidPlayerIndex(lt?.player);
        if (
          lt &&
          bpi !== null &&
          (bMid === curMid || (!curMid && bMid) || (curMid && bMid && bMid === curMid))
        ) {
          ADM.triggerWorkerLog?.decrementThrowSerialAfterBust?.({
            matchId: curMid || bMid || "_",
            playerIndex: bpi
          });
        }
      } catch (_) {}
    }
    if (wsSrc && s.gameFinished && !isBullOffPhaseActive()) {
      const lt = runtimeState.lastThrow;
      const ltPi = asValidPlayerIndex(lt?.player);
      const meta = lt?.__admVisitMeta;
      const rb = Number(meta?.remainingBeforeThrow);
      const dartSc = Number(lt?.score);
      const mergedScores = mergeLastStateWithDomSnapshot(s)?.playerScores;
      let w = pickLegWinnerIndexFromDomPlayersOnly();
      const wsW = resolveWinnerIndexFromState(s);
      if (w == null) w = wsW;
      if (w == null) w = pickSingleZeroPlayerIndexFromScores(s?.playerScores);
      if (w == null) w = pickSingleZeroPlayerIndexFromScores(mergedScores);
      if (w == null && wsW !== null) {
        if (winnerIndexHasZeroOnScores(wsW, s?.playerScores)) w = wsW;
        else if (winnerIndexHasZeroOnScores(wsW, mergedScores)) w = wsW;
      }
      if (
        w == null &&
        ltPi !== null &&
        throwLooksLikeLegCheckoutDart(lt) &&
        Number.isFinite(rb) &&
        Number.isFinite(dartSc) &&
        rb === dartSc
      ) {
        w = ltPi;
      }
      if (
        w == null &&
        ltPi !== null &&
        Number(lt?.multiplier) === 2 &&
        Number.isFinite(rb) &&
        Number.isFinite(dartSc) &&
        rb === dartSc
      ) {
        w = ltPi;
      }
      if (w == null && ltPi !== null && throwLooksLikeLegCheckoutDart(lt)) {
        w = ltPi;
      }
      if (w == null) w = pickLegWinnerIndexFromFinishedScores(s);
      if (w == null) w = wsW;
      const midStrForWin = String(mid || "").trim();
      const ltMidForWin = String(lt?.matchId ?? "").trim();
      const ltMatchesCurrentLeg = !!lt && (ltMidForWin === midStrForWin || (!midStrForWin && ltMidForWin));
      const ltCheckoutConfirmed =
        !!lt &&
        ltPi !== null &&
        ltMatchesCurrentLeg &&
        throwLooksLikeLegCheckoutDart(lt) &&
        Number.isFinite(rb) &&
        Number.isFinite(dartSc) &&
        rb === dartSc;
      if (w == null && ltPi !== null && ltMatchesCurrentLeg && throwLooksLikeLegCheckoutDart(lt)) {
        w = ltPi;
      }
      if (
        wsW === null &&
        w !== null &&
        ltPi !== null &&
        lt &&
        throwLooksLikeLegCheckoutDart(lt) &&
        w !== ltPi
      ) {
        const scf = mergedScores;
        const throwerAtZero =
          Array.isArray(scf) &&
          ltPi >= 0 &&
          ltPi < scf.length &&
          Number.isFinite(Number(scf[ltPi])) &&
          Number(scf[ltPi]) === 0;
        const rbOk =
          Number.isFinite(rb) && Number.isFinite(dartSc) && rb === dartSc;
        if (rbOk || throwerAtZero) w = ltPi;
      }
      if (w !== null && ltCheckoutConfirmed) {
        const legWinKey = `${String(mid || "").trim() || "_"}|${s.set ?? "_"}|${s.leg ?? "_"}`;
        if (legWinKey !== runtimeState.lastLegWinLoggedKey) {
          runtimeState.lastLegWinLoggedKey = legWinKey;
          const fromState = pickLegWinCheckoutFromState(s, w);
          let checkoutPts = fromState.visitTotal;
          let lastSeg = fromState.lastSeg;
          if (checkoutPts == null || !lastSeg) {
            const midStr = String(mid || "").trim();
            const ltMid = String(lt?.matchId ?? "").trim();
            const matchLt = lt && (ltMid === midStr || (!midStr && ltMid)) && ltPi === w;
            if (matchLt) {
              if (!lastSeg) {
                lastSeg = String(lt?.segmentLabel ?? "").trim();
                if (!lastSeg && ADM.admThrowVisitTracker?.formatThrowSegmentLabel) {
                  try {
                    lastSeg = String(ADM.admThrowVisitTracker.formatThrowSegmentLabel(lt) || "").trim();
                  } catch (_) {
                    lastSeg = "";
                  }
                }
              }
              if (checkoutPts == null) {
                const meta = lt.__admVisitMeta;
                const rb = Number(meta?.remainingBeforeThrow);
                const tr = Number(meta?.throwerRemainingScore);
                if (Number.isFinite(rb) && rb >= 0) checkoutPts = rb;
                else if (Number.isFinite(tr) && tr >= 0) checkoutPts = tr;
              }
            }
          }
          if (!lastSeg && lt && w === ltPi) {
            lastSeg = inferLegWinSegmentFromThrow(lt);
          }
          if ((!lastSeg || lastSeg === "?") && w != null) {
            const cachedThrow = runtimeState.lastThrowInfoByPlayer?.[w];
            const cSeg = String(cachedThrow?.segment || "").trim();
            if (cSeg) lastSeg = cSeg;
            if (
              (checkoutPts == null || !Number.isFinite(Number(checkoutPts)) || Number(checkoutPts) <= 0) &&
              Number.isFinite(Number(cachedThrow?.score))
            ) {
              checkoutPts = Number(cachedThrow.score);
            }
          }
          try {
            const ltTurnName = String(lt?.__admVisitMeta?.throwerDisplayName || "").replace(/\s+/g, " ").trim();
            const turnName = ltTurnName || String(runtimeState.lastTurnPlayerName || "").replace(/\s+/g, " ").trim();
            const winIdx = ltPi != null ? ltPi : w;
            ADM.triggerWorkerLog?.printAdmLegWinLine?.({
              playerName: turnName || getPreferredPlayerName(s, winIdx, `Spieler ${winIdx + 1}`),
              checkoutPoints: checkoutPts,
              lastSegment: lastSeg || "?"
            });
          } catch (_) {}
          runtimeState.suppressDomPlayerTurnUntilTs = Date.now() + 1800;
        }
      }
    }
    if (wsSrc && !isBullOffPhaseActive()) {
      tryLogNextLegWorkerLine(s, prevStateForEdge);
    }
    syncRuntimeState({
      lastState: s,
      lastKnownActivePlayer
    });
    try {
      ADM.overlay?.handleState?.();
    } catch (_) {}
    runTriggerSources("state", s);
  }

  function handleGameEvent(e) {
    syncRuntimeState({
      lastGameEvent: e,
      lastState,
      lastKnownActivePlayer
    });
    try {
      ADM.overlay?.handleGameEvent?.(e);
    } catch (_) {}
    runTriggerSources("gameEvent", e);
  }

  /**
   * Visit-Zähler der Engine an den Throw-Tracker anbinden (Slots + visitKey).
   * Nach Undo/Korrektur oder Reconcile: gleicher Stand wie „Throw 1–3“ im Tracker.
   * Kein Abgleich, wenn `visitKey` zu einer anderen matchId gehört (alter Stand nach Matchwechsel).
   */
  function syncEngineVisitCountersFromTracker() {
    if (isBullOffPhaseActive()) return;
    const pc = effectiveParticipantCount(lastState);
    if (pc < 2) return;
    const tr = ADM.admThrowVisitTracker;
    if (!tr || typeof tr.peekFilledSlotCount !== "function") return;
    const stateMid = String(lastState?.matchId ?? "").trim() || null;
    const trMid = typeof tr.peekVisitMatchIdPrefix === "function" ? tr.peekVisitMatchIdPrefix() : null;
    if (stateMid && trMid && stateMid !== trMid) return;

    const filled = tr.peekFilledSlotCount();
    const tpi = typeof tr.peekVisitPlayerIndex === "function" ? tr.peekVisitPlayerIndex() : null;
    if (typeof filled !== "number" || filled < 0 || filled > 3) return;

    const ap = resolveActivePlayerFromState(lastState);
    if (
      ap !== null &&
      tpi !== null &&
      Number.isInteger(ap) &&
      Number.isInteger(tpi) &&
      ap >= 0 &&
      ap < pc &&
      tpi >= 0 &&
      tpi < pc &&
      ap !== tpi
    ) {
      runtimeState.visitDartsCompletedInTurn = visitDartsCompletedForEngineFromState(lastState, ap, pc);
      runtimeState.visitRotationPlayer = ap;
      return;
    }

    if (tpi === null || tpi < 0 || tpi >= pc) {
      if (filled <= 2) runtimeState.visitDartsCompletedInTurn = filled;
      else if (filled === 3) runtimeState.visitDartsCompletedInTurn = 0;
      return;
    }

    if (filled === 3) {
      runtimeState.visitDartsCompletedInTurn = 0;
      runtimeState.visitRotationPlayer = (tpi + 1) % pc;
    } else {
      runtimeState.visitDartsCompletedInTurn = filled;
      runtimeState.visitRotationPlayer = tpi;
    }
  }

  function handleUiEvent(p) {
    const kind = String(p?.kind || "").trim();
    if (kind === "undo_click" || kind === "visit_correction_click") {
      try {
        ADM.admThrowVisitTracker?.onUndo?.();
      } catch (_) {}
      syncEngineVisitCountersFromTracker();
      /** Kein `null`: sonst wirkt der nächste DOM-Scan wie Spaltenwechsel → bei 0 Darts fälschlich erneut „Player Turn“. */
      {
        const live = runtimeState.domLiveActivePlayerIndex;
        if (Number.isInteger(live) && live >= 0 && live <= 15) {
          runtimeState.lastDomLoggedActivePlayerIndex = live;
        } else {
          const ap = resolveActivePlayerFromState(lastState);
          if (ap != null && ap >= 0 && ap <= 15) {
            runtimeState.lastDomLoggedActivePlayerIndex = ap;
          }
        }
      }
      /** Falsch erkannter Win + Korrektur: nächste echte Leg-Win-/Next-Leg-Zeilen wieder erlauben. */
      runtimeState.lastLegWinLoggedKey = "";
      runtimeState.lastNextLegLoggedKey = "";
      runtimeState.lastDomCheckoutGuideSig = "";
      runtimeState.suppressDomPlayerTurnUntilTs = 0;
      try {
        ADM.triggerWorkerLog?.clearVisitSummaryAfterUndo?.();
      } catch (_) {}
      runtimeState.lastTakeoutCombinedActive = false;
    }
    syncRuntimeState({
      lastUiEvent: p,
      lastState,
      lastKnownActivePlayer
    });
    try {
      ADM.overlay?.handleUiEvent?.(p);
    } catch (_) {}
  }

  function pathnameIndicatesLobbyOrPrematch(pathname) {
    const p = String(pathname || "").toLowerCase();
    if (/\blobby\b/.test(p)) return true;
    if (/\/setup\b/.test(p) || /\/create\b/.test(p) || /\/invite\b/.test(p)) return true;
    if (/\/matches\/[^/]+\/(?:settings|configure|waiting|summary|overview)\b/i.test(p)) return true;
    return false;
  }

  function pathnameIndicatesLiveMatchesPlay(pathname) {
    const p = String(pathname || "").toLowerCase();
    if (!/\/matches\/[^/]+/.test(p)) return false;
    return !pathnameIndicatesLobbyOrPrematch(p);
  }

  function handleNavigation(p) {
    try {
      const path = String(p?.pathname || "");
      if (pathnameIndicatesLiveMatchesPlay(path)) {
        const parsed = extractMatchIdFromPathname(path);
        if (parsed) rememberPlayPathMatchId(parsed);
        runtimeState.gameOnUrlAllowed = true;
        const pid = String(parsed || "").trim().toLowerCase();
        if (pid && pid !== lastNavClearedGameOnMatchId) {
          lastNavClearedGameOnMatchId = pid;
          clearGameOnDedupeCaches();
        }
      } else if (pathnameIndicatesLobbyOrPrematch(path) || !/\/matches\/[^/]+/i.test(path.toLowerCase())) {
        runtimeState.gameOnUrlAllowed = false;
        runtimeState.playPathMatchId = "";
        lastNavClearedGameOnMatchId = "";
        clearGameOnDedupeCaches();
      }
    } catch (_) {}
  }

  const handlers = {
    getSnapshot,
    getState: () => cloneValue(runtimeState.lastState),
    getLastThrow: () => cloneValue(runtimeState.lastThrow),
    getLastGameEvent: () => cloneValue(runtimeState.lastGameEvent),
    getLastUiEvent: () => cloneValue(runtimeState.lastUiEvent),
    getCheckout: () => cloneValue(runtimeState.checkout),
    getDomPlaySnapshot: () => ({
      snapshot: cloneValue(runtimeState.lastDomPlaySnapshot),
      at: runtimeState.lastDomPlaySnapshotAt || 0
    }),
    resolveDisplayNameForObsZoom,
    handleThrow,
    handleGameEvent,
    handleState,
    handleUiEvent,
    handleNavigation
  };

  try {
    Object.assign(ADM.admTriggers, handlers);
    ADM.admTriggers._registerEngine(dispatchTrigger);
  } catch (_) {}

  ADM.autodartsTriggers = ADM.admTriggers;
  ADM.tryLogGameOnRoster = tryLogGameOnRoster;
  ADM.collectMatchRosterNamesForLog = collectMatchRosterNames;
  ADM.applyMatchContextFromPage = applyMatchContextFromPage;
})(self);
