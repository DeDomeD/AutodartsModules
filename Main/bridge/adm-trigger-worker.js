/**
 * ADM Trigger — Worker-Seite
 * - Wurfzeile: [ADM] als graue „Bubble“, Score pink (Service-Worker-DevTools %c)
 * - Trigger-Historie optional über Logger bei Debug-Flags
 */
(function initAdmTriggerWorker(scope) {
  const ADM = scope.ADM || (scope.ADM = {});

  ADM.workerLogStyles = {};

  /** Graue Bubble wie Status-Tag */
  const STYLE_ADM_BUBBLE =
    "background:#64748b;color:#f8fafc;padding:2px 7px;border-radius:8px;font-weight:700;font-size:11px";
  /** Blaue Bubble — OBS-Zoom-Debug (Option „OBS debug“) */
  const STYLE_OBS_ZOOM_BUBBLE =
    "background:#2563eb;color:#f8fafc;padding:2px 7px;border-radius:8px;font-weight:700;font-size:11px";
  /** Score (Punkte) pink */
  const STYLE_SCORE_PINK = "color:#ec4899;font-weight:700";
  /** „Throw n -> Segment“ — helleres Grau (wie früher Digital/Live) */
  const STYLE_THROW_MAIN = "color:#94a3b8;font-weight:500;font-size:12px";
  /** Zusatz z. B. „(Korrektur)“ */
  const STYLE_TAIL_DIM = "color:#94a3b8;font-weight:500;font-size:11px";
  /** Seriennummer pro Zeile — verhindert Chrome-„(2)“-Gruppierung identischer Logs */
  const STYLE_SERIAL = "color:#cbd5e1;font-weight:400;font-size:10px";
  /** Wer geworfen hat (Name / Fallback) */
  const STYLE_THROWER = "color:#0f766e;font-weight:600;font-size:11px";
  /** „Player Turn :“-Label — helles Grün */
  const STYLE_PLAYER_TURN_LABEL =
    "color:#86efac;font-weight:600;font-size:12px";
  /** Spielername in gleicher Farbe wie Throw-Name */
  const STYLE_PLAYER_TURN_NAME =
    "color:#0f766e;font-weight:700;font-size:12px";
  /** „Score:“-Suffix bei End-Turn-Zeile — wie Wurf-Haupttext */
  const STYLE_END_TURN = "color:#94a3b8;font-weight:500;font-size:12px";
  /** Takeout (X01) — Amber */
  const STYLE_TAKEOUT = "color:#fbbf24;font-weight:600;font-size:12px";
  /** „Game ON“ — Blau, ohne Glow */
  const STYLE_GAME_ON = "color:#60a5fa;font-weight:600;font-size:12px";
  /** WLED-Effektzeile: [ADM] gelb */
  const STYLE_ADM_WLED_BADGE =
    "background:#facc15;color:#422006;padding:2px 7px;border-radius:8px;font-weight:800;font-size:11px";
  const STYLE_ADM_WLED_TEXT = "color:#fef9c3;font-weight:600;font-size:12px";
  /** Checkout-Vorschlag (Suggestion) */
  const STYLE_CHECKOUT = "color:#a855f7;font-weight:600;font-size:12px";
  /** Bust (State) */
  const STYLE_BUST_TEXT = "color:#ff2d55;font-weight:800;font-size:12px;text-shadow:0 0 8px rgba(255,45,85,0.55)";
  /** Leg Win (Checkout-Zusammenfassung) */
  const STYLE_LEG_WIN = "color:#39ff14;font-weight:800;font-size:12px;text-shadow:0 0 8px rgba(57,255,20,0.6)";
  /** Nächstes Leg (Legs-gewonnen-Stand) */
  const STYLE_NEXT_LEG = "color:#22d3ee;font-weight:700;font-size:12px";

  const noop = () => {};

  /** Fortlaufend #1, #2, … vor jeder Worker-Konsolenzeile (Match-Start → wieder bei 1). */
  let workerLogGlobalLineNo = 0;

  /** `%c`/`%s`/… wie in `console.log` → Segmente mit Chrome-CSS (für Worker-Mirror-UI). */
  function segmentsFromStyledConsole(format, argv) {
    /** @type {{ css: string, text: string }[]} */
    const segments = [];
    let fi = 0;
    let ai = 0;
    let style = "";
    let buf = "";
    const fmt = String(format || "");
    const args = Array.isArray(argv) ? argv : [];

    const flushBuf = () => {
      if (!buf) return;
      const last = segments[segments.length - 1];
      if (last && last.css === style) last.text += buf;
      else segments.push({ css: style, text: buf });
      buf = "";
    };

    const pushVal = (val) => {
      const t = String(val ?? "");
      if (!t) return;
      const last = segments[segments.length - 1];
      if (last && last.css === style) last.text += t;
      else segments.push({ css: style, text: t });
    };

    while (fi < fmt.length) {
      const p = fmt.indexOf("%", fi);
      if (p === -1) {
        buf += fmt.slice(fi);
        break;
      }
      buf += fmt.slice(fi, p);
      if (p + 1 >= fmt.length) break;
      const spec = fmt[p + 1];
      if (spec === "%") {
        buf += "%";
        fi = p + 2;
        continue;
      }
      if (spec === "c") {
        flushBuf();
        style = ai < args.length ? String(args[ai++]) : "";
        fi = p + 2;
        continue;
      }
      if (spec === "s" || spec === "d" || spec === "i" || spec === "f") {
        flushBuf();
        if (ai < args.length) pushVal(args[ai++]);
        fi = p + 2;
        continue;
      }
      fi = p + 2;
    }
    flushBuf();
    return segments;
  }

  function workerConsoleLog(format, ...styleAndArgs) {
    workerLogGlobalLineNo += 1;
    const n = workerLogGlobalLineNo;
    let mirrorCategory = "AD";
    const argv = [...styleAndArgs];
    const last = argv[argv.length - 1];
    if (
      last &&
      typeof last === "object" &&
      !Array.isArray(last) &&
      Object.prototype.hasOwnProperty.call(last, "mirrorCategory")
    ) {
      const mc = String(last.mirrorCategory || "AD").toUpperCase();
      mirrorCategory = mc === "SB" || mc === "OBS" || mc === "WLED" || mc === "MISC" ? mc : "AD";
      argv.pop();
    }
    console.log(`%c#${n}%c ${format}`, STYLE_SERIAL, "", ...argv);
    try {
      const fullFormat = `%c#${n}%c ${format}`;
      const segments = segmentsFromStyledConsole(fullFormat, [STYLE_SERIAL, "", ...argv]);
      ADM.workerMirrorLog?.pushEntry?.({ segments, category: mirrorCategory });
    } catch (_) {}
  }

  /**
   * Mirror-Zeile mit derselben Seriennummer wie `workerConsoleLog`, aber ohne `console.log`
   * (z. B. SB Action — [ADM]-Badges bündig unter den nummerierten ADM-Zeilen).
   * @param {{ css: string, text: string }[]} tailSegments
   * @param {"AD"|"SB"|"OBS"|"WLED"|"MISC"} mirrorCategory
   */
  function pushMirrorSegmentsWithSerial(tailSegments, mirrorCategory = "AD") {
    const segs = Array.isArray(tailSegments) ? tailSegments : [];
    if (!segs.length) return;
    workerLogGlobalLineNo += 1;
    const n = workerLogGlobalLineNo;
    const mc = String(mirrorCategory || "AD").toUpperCase();
    const cat = mc === "SB" || mc === "OBS" || mc === "WLED" || mc === "MISC" ? mc : "AD";
    const prefix = [
      { css: STYLE_SERIAL, text: `#${n}` },
      { css: "", text: " " }
    ];
    try {
      ADM.workerMirrorLog?.pushEntry?.({ segments: prefix.concat(segs), category: cat });
    } catch (_) {}
  }

  function gameEventsVisible() {
    return true;
  }

  function workerLogShowCheckout() {
    return true;
  }

  function workerLogShowPlayerTurn() {
    return true;
  }

  function workerLogShowEndTurn() {
    return true;
  }

  function workerLogShowTakeout() {
    return true;
  }

  /** Player-Turn-Zeile: Label hellgrün, Name neon, Rest gedämpft. */
  function emitPlayerTurnLine(who, requireSuffix, avgSuffix) {
    if (!workerLogShowPlayerTurn()) return;
    const san = ADM.triggerWorkerLog.sanitizeConsoleFormatArg;
    const nameSafe = san(who || "Spieler");
    const metaRaw = `${requireSuffix || ""}${avgSuffix || ""}`;
    if (metaRaw) {
      workerConsoleLog(
        `%c[ADM]%c Player Turn : %c%s%c%s`,
        STYLE_ADM_BUBBLE,
        STYLE_PLAYER_TURN_LABEL,
        STYLE_PLAYER_TURN_NAME,
        nameSafe,
        STYLE_PLAYER_TURN_LABEL,
        san(metaRaw)
      );
    } else {
      workerConsoleLog(
        `%c[ADM]%c Player Turn : %c%s`,
        STYLE_ADM_BUBBLE,
        STYLE_PLAYER_TURN_LABEL,
        STYLE_PLAYER_TURN_NAME,
        nameSafe
      );
    }
  }

  /** Pro X01-Visit: drei Würfe für die End-Turn-Zeile (nicht Bull-Off). */
  let visitSummaryBuffer = null;

  let lastThrowConsoleSeq = -1;
  let lastThrowConsoleFp = "";
  let lastThrowConsoleFpAt = 0;
  /** Wurfzähler pro Match + Spieler (für „#n“) */
  const throwCountByMatchPlayer = Object.create(null);
  let gameOnLineSerial = 0;

  let lastTriggerStorageSeq = -1;
  let lastTriggerStorageFp = "";
  let lastTriggerStorageFpAt = 0;
  let lastObsZoomConsoleSeg = "";
  let lastObsZoomConsoleAt = 0;
  /** Kurz-Dedupe: gleicher Guide + Throw-Nr. (DOM-Scans). */
  let lastCheckoutGuideLineFp = "";
  let lastCheckoutGuideLineAt = 0;
  /** Takeout-Zeilen: gleiche Kante kurz hintereinander (WS+DOM). */
  let lastTakeoutLineKind = "";
  let lastTakeoutLineAt = 0;
  /** Leg-Win-Zeile erst nach „Throw“ + ggf. „End Turn“ (Engine ruft Leg Win vor `printAdmThrowLine` auf). */
  let pendingLegWinConsole = null;

  function emitLegWinLineNow(opts) {
    const nameRaw = String(opts?.playerName || "Spieler")
      .replace(/\s+/g, " ")
      .trim() || "Spieler";
    const cp = Number(opts?.checkoutPoints);
    const numStr = Number.isFinite(cp) && cp >= 0 ? String(Math.trunc(cp)) : "?";
    const segRaw = String(opts?.lastSegment || "?").trim() || "?";
    const line = `Leg Win : ${nameRaw} ${numStr} ${segRaw}`;
    const safe = ADM.triggerWorkerLog.sanitizeConsoleFormatArg(line);
    workerConsoleLog(`%c[ADM]%c %c%s`, STYLE_ADM_BUBBLE, STYLE_THROW_MAIN, STYLE_LEG_WIN, safe);
  }

  function flushPendingLegWinConsole() {
    try {
      if (!pendingLegWinConsole) return;
      if (!gameEventsVisible()) {
        pendingLegWinConsole = null;
        return;
      }
      const opts = pendingLegWinConsole;
      pendingLegWinConsole = null;
      emitLegWinLineNow(opts);
    } catch {
      pendingLegWinConsole = null;
    }
  }

  ADM.triggerWorkerLog = {
    /**
     * Konsole: genau eine Zeile pro Wurf; Doppel mit gleicher bridgeSeq wird verworfen.
     * Am Ende eine eindeutige #nr (gegen DevTools-Gruppierung).
     * @param {{ dartIndexInVisit: number, segmentLabel: string, score: number, isCorrection?: boolean, isLegFinishOnBull?: boolean, isBullOffPhase?: boolean, throwerRemainingScore?: number|null, remainingBeforeThrow?: number|null, throwerAverageDisplay?: string|null, bridgeSeq?: number, throwerDisplayName?: string, matchId?: string|null, throwLogPlayerIndex?: number|null, suppressPlayerTurnOnDart1?: boolean }} meta
     */
    printAdmThrowLine(meta) {
      try {
        const bullOff = meta?.isBullOffPhase === true;
        const rawTop = meta?.throwerRemainingScore;
        const topCork =
          rawTop != null && rawTop !== "" && Number.isFinite(Number(rawTop))
            ? Number(rawTop)
            : NaN;
        const dartPts = Number(meta?.score);
        let displayScore = dartPts;
        if (bullOff && Number.isFinite(topCork)) displayScore = topCork;

        const seq = Number(meta?.bridgeSeq);
        if (Number.isFinite(seq) && seq > 0) {
          if (seq === lastThrowConsoleSeq) return;
          lastThrowConsoleSeq = seq;
        } else {
          const fp = `${meta?.dartIndexInVisit}|${meta?.segmentLabel}|${displayScore}|${meta?.isCorrection}`;
          const now = Date.now();
          if (fp === lastThrowConsoleFp && now - lastThrowConsoleFpAt < 350) return;
          lastThrowConsoleFp = fp;
          lastThrowConsoleFpAt = now;
        }

        const n = Number(meta?.dartIndexInVisit);
        const seg = String(meta?.segmentLabel || "?").trim() || "?";
        const sc = displayScore;
        const scoreStr = Number.isFinite(sc) ? String(sc) : "?";
        const corr = meta?.isCorrection ? " (Korrektur)" : "";
        const bullCo = meta?.isLegFinishOnBull ? " · Leg-Checkout (Bull)" : "";
        const tailMeta = corr + bullCo;
        const matchKey = String(meta?.matchId ?? "").trim() || "_";
        const piResolved = Number(meta?.throwLogPlayerIndex);
        const pi =
          Number.isInteger(piResolved) && piResolved >= 0 && piResolved <= 15
            ? piResolved
            : -1;
        const countKey = pi >= 0 ? `${matchKey}|${pi}` : `${matchKey}|?`;
        throwCountByMatchPlayer[countKey] = (throwCountByMatchPlayer[countKey] || 0) + 1;
        const serialStr = ` #${throwCountByMatchPlayer[countKey]}`;
        let who = String(meta?.throwerDisplayName || "").replace(/\s+/g, " ").trim();
        if (!who && pi >= 0) who = `Spieler ${pi + 1}`;
        const visitKey = `${matchKey}|${pi}`;
        const throwerSuffix = bullOff ? "" : who ? ` · ${who}` : "";
        const isCorr = !!meta?.isCorrection;
        const remTurn = Number(meta?.throwerRemainingScore);
        const requireSuffix =
          bullOff || !Number.isFinite(remTurn) || remTurn <= 0
            ? ""
            : ` | req. ${Math.trunc(remTurn)}`;
        const avgRaw = String(meta?.throwerAverageDisplay || "").trim();
        const avgSuffix = avgRaw ? ` | avg ${avgRaw}` : "";

        if (isCorr) {
          visitSummaryBuffer = null;
        }
        if (bullOff) {
          /** Player Turn nur aus DOM (`tryEmitDomPlayerTurnIfIndexChanged`) — vor dem Wurf, nicht nach WS-Event. */
          visitSummaryBuffer = null;
        } else if (Number.isFinite(n) && n >= 1 && n <= 3) {
          if (n === 1) {
            visitSummaryBuffer = { key: visitKey, displayName: who, darts: [{ seg, sc }] };
          } else if (visitSummaryBuffer && visitSummaryBuffer.key === visitKey) {
            if (n === 2 && visitSummaryBuffer.darts.length === 1) {
              visitSummaryBuffer.darts.push({ seg, sc });
            } else if (n === 3 && visitSummaryBuffer.darts.length === 2) {
              visitSummaryBuffer.darts.push({ seg, sc });
            } else {
              visitSummaryBuffer = null;
            }
          } else if (n === 2 || n === 3) {
            visitSummaryBuffer = null;
          }
        }

        if (
          !bullOff &&
          Number.isFinite(n) &&
          n === 1 &&
          !meta?.suppressPlayerTurnOnDart1
        ) {
          emitPlayerTurnLine(who || "Spieler", requireSuffix, avgSuffix);
        }

        if (gameEventsVisible()) {
          workerConsoleLog(
            `%c[ADM]%c Throw %s -> %s  %c%s%c%s%c%s%c%s`,
            STYLE_ADM_BUBBLE,
            STYLE_THROW_MAIN,
            Number.isFinite(n) && n > 0 ? String(n) : "?",
            seg,
            STYLE_SCORE_PINK,
            scoreStr,
            STYLE_TAIL_DIM,
            tailMeta,
            STYLE_THROWER,
            throwerSuffix,
            STYLE_SERIAL,
            serialStr
          );
        }

        if (
          !bullOff &&
          !isCorr &&
          n === 3 &&
          visitSummaryBuffer &&
          visitSummaryBuffer.key === visitKey &&
          visitSummaryBuffer.darts.length === 3
        ) {
          const d = visitSummaryBuffer.darts;
          const sum = d.reduce((acc, x) => acc + (Number.isFinite(x.sc) ? x.sc : 0), 0);
          const scoreBits = d.map((x) =>
            Number.isFinite(x.sc) ? String(Math.trunc(x.sc)) : "?"
          );
          const breakdownTail = scoreBits.length ? ` = ${scoreBits.join(" + ")}` : "";
          const nameSafe = ADM.triggerWorkerLog.sanitizeConsoleFormatArg(
            visitSummaryBuffer.displayName || "Spieler"
          );
          const sumSafe = ADM.triggerWorkerLog.sanitizeConsoleFormatArg(String(Math.trunc(sum)));
          const breakdownSafe = ADM.triggerWorkerLog.sanitizeConsoleFormatArg(breakdownTail);
          if (workerLogShowEndTurn()) {
            workerConsoleLog(
              `%c[ADM]%c End Turn : %c%s%c Score: %c%s%c%s`,
              STYLE_ADM_BUBBLE,
              STYLE_TAKEOUT,
              STYLE_PLAYER_TURN_NAME,
              nameSafe,
              STYLE_END_TURN,
              STYLE_SCORE_PINK,
              sumSafe,
              STYLE_END_TURN,
              breakdownSafe
            );
          }
          visitSummaryBuffer = null;
          flushPendingLegWinConsole();
        }
        /** Kurz-Checkout (1–2 Darts): keine End-Turn-Zeile — Leg Win direkt nach dem Wurf. */
        flushPendingLegWinConsole();
      } catch {
        // ignore
      }
    },
    /** Konsole: Serien-# pro Spieler + letzte Dedupe-Marks — z. B. nach Ausgebullt wieder bei #1. */
    resetThrowSerialCounters() {
      try {
        for (const k of Object.keys(throwCountByMatchPlayer)) {
          delete throwCountByMatchPlayer[k];
        }
        lastThrowConsoleSeq = -1;
        lastThrowConsoleFp = "";
        lastThrowConsoleFpAt = 0;
        visitSummaryBuffer = null;
        lastObsZoomConsoleSeg = "";
        lastObsZoomConsoleAt = 0;
        lastCheckoutGuideLineFp = "";
        lastCheckoutGuideLineAt = 0;
        pendingLegWinConsole = null;
      } catch {
        // ignore
      }
    },
    /** Nach Undo/Korrektur: kein „End Turn“ aus veralteten Dart-1/2-Puffern zusammenbauen. */
    clearVisitSummaryAfterUndo() {
      try {
        visitSummaryBuffer = null;
        pendingLegWinConsole = null;
      } catch {
        // ignore
      }
    },
    /**
     * Nach Bust: der zuletzt geloggte Wurf zählt für die Konsolen-# nicht mit (neuer Gegner-Zug).
     * @param {{ matchId?: string|null, playerIndex: number }} args
     */
    decrementThrowSerialAfterBust(args) {
      try {
        const pi = Number(args?.playerIndex);
        if (!Number.isInteger(pi) || pi < 0 || pi > 15) return;
        const matchKey = String(args?.matchId ?? "").trim() || "_";
        const countKey = `${matchKey}|${pi}`;
        const n = throwCountByMatchPlayer[countKey];
        if (Number.isFinite(n) && n > 0) throwCountByMatchPlayer[countKey] = n - 1;
      } catch {
        // ignore
      }
    },
    /** Neues Match (andere matchId): Wurf-# und Game-ON-# wieder von vorn. */
    resetForNewMatch() {
      try {
        for (const k of Object.keys(throwCountByMatchPlayer)) {
          delete throwCountByMatchPlayer[k];
        }
        lastThrowConsoleSeq = -1;
        lastThrowConsoleFp = "";
        lastThrowConsoleFpAt = 0;
        workerLogGlobalLineNo = 0;
        gameOnLineSerial = 0;
        visitSummaryBuffer = null;
        lastObsZoomConsoleSeg = "";
        lastObsZoomConsoleAt = 0;
        lastCheckoutGuideLineFp = "";
        lastCheckoutGuideLineAt = 0;
        pendingLegWinConsole = null;
        lastTakeoutLineKind = "";
        lastTakeoutLineAt = 0;
      } catch {
        // ignore
      }
    },
    /**
     * Vor Wurf 1: Player Turn (Bull-Off: nur Name).
     * @param {{ who: string, throwerRemainingScore?: number|null, throwerAverageDisplay?: string|null, isBullOffPhase?: boolean }} opts
     */
    printTurnPreamble(opts) {
      try {
        if (!gameEventsVisible()) return;
        const bull = opts?.isBullOffPhase === true;
        const who = String(opts?.who || "").replace(/\s+/g, " ").trim() || "Spieler";
        const rem = Number(opts?.throwerRemainingScore);
        /** Bull-Off: nur Name — Cork/X01-Zusätze kommen in der Wurfzeile bzw. aus dem Throw-Pfad. */
        let metaSuffix = "";
        if (!bull && Number.isFinite(rem) && rem > 0) {
          metaSuffix = ` | req. ${Math.trunc(rem)}`;
        }
        const requireSuffix = metaSuffix;
        const avgRaw = bull ? "" : String(opts?.throwerAverageDisplay || "").trim();
        const avgSuffix = avgRaw ? ` | avg ${avgRaw}` : "";
        emitPlayerTurnLine(who, requireSuffix, avgSuffix);
      } catch {
        // ignore
      }
    },
    /**
     * Spielstart: Namen + optional Moduszeile aus DOM (X01 / 301 / SI-DO).
     * @param {string[]} roster
     * @param {{ matchFormatSummary?: string }} [opts]
     */
    printGameOnPlayersLine(roster, opts) {
      try {
        if (!gameEventsVisible()) return;
        const list = Array.isArray(roster)
          ? roster.map((x) => String(x || "").replace(/\s+/g, " ").trim()).filter(Boolean)
          : [];
        const mode = String(opts?.matchFormatSummary || "").trim();
        const modeSuffix = mode ? ` | Mode ${mode}` : "";
        const body = list.length
          ? `Player: ${list.join(", ")}${modeSuffix}`
          : `(Spieler unbekannt)${modeSuffix}`;
        gameOnLineSerial += 1;
        const tail = ` #${gameOnLineSerial}`;
        const gameOnMain = ADM.triggerWorkerLog.sanitizeConsoleFormatArg(`Game ON  ${body}`);
        /** Wie Wurfzeilen: nur `[ADM]` in der Bubble, dann Leerraum, dann Inhalt. */
        workerConsoleLog(
          `%c[ADM]%c %c%s%c%s`,
          STYLE_ADM_BUBBLE,
          STYLE_THROW_MAIN,
          STYLE_GAME_ON,
          gameOnMain,
          STYLE_SERIAL,
          tail
        );
      } catch {
        // ignore
      }
    },
    printAdTriggerLine: noop,
    printVisitTimelineActivePlayer: noop,
    printVisitTimelineGameOn: noop,
    printVisitTimelineDart: noop,
    /**
     * Checkout-Vorschlag aus DOM (`#ad-ext-turn`) — vor dem physischen Wurf; danach {@link ADM.obsZoom.onCheckoutGuideLogged} (OBS-Zoom inkl. Spielerfilter), dann Throw per WS.
     * @param {string} segmentLabel — z. B. T20
     * @param {{ nextThrow?: number, domActivePlayerIndex?: number|null, checkoutDomPlayerName?: string }} [opts]
     */
    printCheckoutGuideLine(segmentLabel, opts) {
      try {
        if (!workerLogShowCheckout()) return;
        const guideRaw = String(segmentLabel || "").replace(/\s+/g, " ").trim();
        if (!guideRaw || /\[object Object\]/i.test(guideRaw)) return;
        const nt = Number(opts?.nextThrow);
        if (!Number.isInteger(nt) || nt < 1 || nt > 3) return;
        const domIdxRaw = opts?.domActivePlayerIndex;
        let domSeg = "";
        let domActiveCol = null;
        if (domIdxRaw != null && domIdxRaw !== "") {
          const domIdx = Number(domIdxRaw);
          if (Number.isInteger(domIdx) && domIdx >= 0 && domIdx <= 15) {
            domSeg = String(domIdx);
            domActiveCol = domIdx;
          }
        }
        const checkoutDomPlayerName = String(opts?.checkoutDomPlayerName || "").trim();
        /** Keine Checkout-Guide-Zeile, wenn OBS-Zoom nur bestimmte Spieler — sonst wirkte der Log wie „Zoom für alle“. */
        try {
          if (ADM.obsZoom?.checkoutGuidePassesPlayerFilter?.({
            displaySegment: guideRaw,
            guideRaw,
            nextThrow: nt,
            domActivePlayerIndex: domActiveCol,
            checkoutDomPlayerName: checkoutDomPlayerName || undefined
          }) === false) {
            return;
          }
        } catch (_) {}
        const fp = domSeg ? `${domSeg}|${nt}|${guideRaw.toLowerCase()}` : `${nt}|${guideRaw.toLowerCase()}`;
        const now = Date.now();
        if (fp === lastCheckoutGuideLineFp && now - lastCheckoutGuideLineAt < 400) return;
        lastCheckoutGuideLineFp = fp;
        lastCheckoutGuideLineAt = now;
        const head = ADM.triggerWorkerLog.sanitizeConsoleFormatArg("Checkout Guide ");
        const safeSeg = ADM.triggerWorkerLog.sanitizeConsoleFormatArg(guideRaw);
        const throwTail = ADM.triggerWorkerLog.sanitizeConsoleFormatArg(` · Throw ${nt}`);
        workerConsoleLog(
          `%c[ADM]%c %s%c%s%c%s`,
          STYLE_ADM_BUBBLE,
          STYLE_THROW_MAIN,
          head,
          STYLE_CHECKOUT,
          safeSeg,
          STYLE_THROW_MAIN,
          throwTail
        );
        /** Kein `printObsZoomLine` hier: würde vor dem OBS-Zoom-Spielernamenfilter erscheinen und OBS trifft ggf. nicht zu. */
        try {
          void ADM.obsZoom?.onCheckoutGuideLogged?.({
            displaySegment: guideRaw,
            guideRaw,
            nextThrow: nt,
            dedupeKey: fp,
            domActivePlayerIndex: domActiveCol,
            checkoutDomPlayerName: checkoutDomPlayerName
          });
        } catch (_) {}
      } catch {
        // ignore
      }
    },
    /**
     * Move-Zoom in OBS angewendet — nur bei OBS-Debug.
     * %c[ADM]%c blaue Bubble, „Zoom “ grau, Segment pink (wie Wurf-Score).
     */
    printObsZoomLine(segmentLabel, zoomOpts) {
      try {
        const raw = String(segmentLabel || "").replace(/\s+/g, " ").trim();
        if (!raw) return;
        const zNow = Date.now();
        if (
          !zoomOpts?.skipDedupe &&
          raw === lastObsZoomConsoleSeg &&
          zNow - lastObsZoomConsoleAt < 450
        )
          return;
        lastObsZoomConsoleSeg = raw;
        lastObsZoomConsoleAt = zNow;
        const safe = ADM.triggerWorkerLog.sanitizeConsoleFormatArg(raw);
        workerConsoleLog(
          `%c[ADM]%c Zoom %c%s`,
          STYLE_OBS_ZOOM_BUBBLE,
          STYLE_THROW_MAIN,
          STYLE_SCORE_PINK,
          safe,
          { mirrorCategory: "OBS" }
        );
      } catch {
        // ignore
      }
    },
    printTakeoutStartLine() {
      try {
        if (!workerLogShowTakeout()) return;
        const now = Date.now();
        if (lastTakeoutLineKind === "start" && now - lastTakeoutLineAt < 400) return;
        lastTakeoutLineKind = "start";
        lastTakeoutLineAt = now;
        workerConsoleLog(`%c[ADM]%c %cTakeout`, STYLE_ADM_BUBBLE, STYLE_THROW_MAIN, STYLE_TAKEOUT);
      } catch {
        // ignore
      }
    },
    printTakeoutFinishedLine() {
      try {
        if (!workerLogShowTakeout()) return;
        const now = Date.now();
        if (lastTakeoutLineKind === "end" && now - lastTakeoutLineAt < 400) return;
        lastTakeoutLineKind = "end";
        lastTakeoutLineAt = now;
        workerConsoleLog(`%c[ADM]%c %cTakeout finished`, STYLE_ADM_BUBBLE, STYLE_THROW_MAIN, STYLE_TAKEOUT);
      } catch {
        // ignore
      }
    },
    printAdmBustLine() {
      try {
        pendingLegWinConsole = null;
        if (!gameEventsVisible()) return;
        workerConsoleLog(`%c[ADM]%c %cBust`, STYLE_ADM_BUBBLE, STYLE_THROW_MAIN, STYLE_BUST_TEXT);
        if (visitSummaryBuffer && Array.isArray(visitSummaryBuffer.darts) && visitSummaryBuffer.darts.length > 0) {
          const d = visitSummaryBuffer.darts.slice(0, 3);
          const sum = d.reduce((acc, x) => acc + (Number.isFinite(x?.sc) ? x.sc : 0), 0);
          const scoreBits = d.map((x) =>
            Number.isFinite(x?.sc) ? String(Math.trunc(x.sc)) : "?"
          );
          const breakdownTail = scoreBits.length ? ` = ${scoreBits.join(" + ")}` : "";
          const nameSafe = ADM.triggerWorkerLog.sanitizeConsoleFormatArg(
            visitSummaryBuffer.displayName || "Spieler"
          );
          const sumSafe = ADM.triggerWorkerLog.sanitizeConsoleFormatArg(String(Math.trunc(sum)));
          const breakdownSafe = ADM.triggerWorkerLog.sanitizeConsoleFormatArg(breakdownTail);
          if (workerLogShowEndTurn()) {
            workerConsoleLog(
              `%c[ADM]%c End Turn : %c%s%c Score: %c%s%c%s`,
              STYLE_ADM_BUBBLE,
              STYLE_TAKEOUT,
              STYLE_PLAYER_TURN_NAME,
              nameSafe,
              STYLE_END_TURN,
              STYLE_SCORE_PINK,
              sumSafe,
              STYLE_END_TURN,
              breakdownSafe
            );
          }
          visitSummaryBuffer = null;
        }
      } catch {
        // ignore
      }
    },
    /**
     * Neues Leg gestartet: `Next Leg Name 1 | Name 0` (Legs gewonnen, Reihenfolge wie im Spiel).
     * @param {string} rosterWithLegs — z. B. `A 2 | B 0`
     */
    printAdmNextLegLine(rosterWithLegs) {
      try {
        if (!gameEventsVisible()) return;
        const part = String(rosterWithLegs || "").replace(/\s+/g, " ").trim();
        if (!part) return;
        const body = ADM.triggerWorkerLog.sanitizeConsoleFormatArg(`Next Leg ${part}`);
        workerConsoleLog(`%c[ADM]%c %c%s`, STYLE_ADM_BUBBLE, STYLE_THROW_MAIN, STYLE_NEXT_LEG, body);
      } catch {
        // ignore
      }
    },
    /**
     * @param {{ playerName?: string, checkoutPoints?: number|null, lastSegment?: string }} opts
     * @param {{ defer?: boolean }} [printMode] — `defer: true`: nach „Throw“/„End Turn“ ausgeben (finalizeThrow läuft vor `printAdmThrowLine`).
     */
    printAdmLegWinLine(opts, printMode) {
      try {
        if (!gameEventsVisible()) return;
        const defer = printMode && printMode.defer === true;
        if (defer) {
          pendingLegWinConsole = opts;
          return;
        }
        pendingLegWinConsole = null;
        emitLegWinLineNow(opts);
      } catch {
        // ignore
      }
    },
    /**
     * WLED: z. B. `[ADM] MeinEffekt | T20 | Presetname` — Badge gelb, Rest hell.
     * @param {{ effectName: string, triggerUnit: string, presetSummary: string }} opts
     */
    printAdmWledEffectLine(opts) {
      try {
        const o = opts && typeof opts === "object" ? opts : {};
        const san = ADM.triggerWorkerLog.sanitizeConsoleFormatArg;
        const name = san(String(o.effectName || "").trim() || "WLED");
        const trig = san(String(o.triggerUnit || "").trim() || "—");
        const presets = san(String(o.presetSummary || "").trim() || "—");
        workerConsoleLog(
          `%c[ADM]%c %s | %s | %s`,
          STYLE_ADM_WLED_BADGE,
          STYLE_ADM_WLED_TEXT,
          name,
          trig,
          presets,
          { mirrorCategory: "WLED" }
        );
      } catch {
        // ignore
      }
    },
    logTriggerToStorage(meta) {
      try {
        const m = meta && typeof meta === "object" ? meta : {};
        const seq = Number(m.bridgeSeq);
        if (Number.isFinite(seq) && seq > 0) {
          if (seq === lastTriggerStorageSeq) return;
          lastTriggerStorageSeq = seq;
        } else {
          const fp = `${m.trigger}|${m.effect}|${m.segment}|${m.label}`;
          const now = Date.now();
          if (fp === lastTriggerStorageFp && now - lastTriggerStorageFpAt < 120) return;
          lastTriggerStorageFp = fp;
          lastTriggerStorageFpAt = now;
        }
        ADM.logger?.info?.("triggers", "ad trigger dispatched", m);
      } catch {
        // ignore
      }
    },
    pushMirrorSegmentsWithSerial,
    sanitizeConsoleFormatArg(text) {
      return String(text ?? "").replace(/%/g, "");
    },
    nextWorkerAdTriggerLogTail() {
      return "";
    },
    styles: {}
  };
})(self);
