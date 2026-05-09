/**
 * =============================================================================
 * ADM — Throw-Visit-Tracker (Service Worker)
 * =============================================================================
 *
 * Ziel
 * ----
 * Pro Aufnahme (Visit) genau drei Slots (Wurf 1–3). Die angezeigte Nummer ist
 * immer der **tatsächliche** Dart im aktuellen Visit — kein globaler Zähler über
 * viele Aufnahmen hinweg.
 *
 * Datenquellen (Slot-Wahl)
 * ------------------------
 * `round` und State-Index werden **nur** verwendet, wenn der so gewählte Slot
 * noch **leer** ist. Sonst → **nächster freier Slot** (0 → 1 → 2).
 *
 * Hintergrund: Digital / Maus auf der Scheibe liefert oft bei jedem Wurf
 * `round === 0` oder ein verzögerter State — würde man den Hint blind nutzen,
 * landet jeder Wurf in Slot 0 und wirkt wie eine „Korrektur“.
 *
 * Korrektur (`isCorrection: true`)
 * -------------------------------
 * Nur wenn wirklich alle Slots voll sind **und** es kein neuer Visit ist (s.u.).
 *
 * Doppel-Verarbeitung
 * -------------------
 * Gleiche Page-Message kann zweimal ankommen — `bridgeSeq` (pageScript) pro Throw
 * hochgezählt; gleiche Seq → `skipped`.
 *
 * Neuer Visit nach vollem Aufnahme-Stand
 * --------------------------------------
 * Der State liefert oft noch die **letzte** Runde mit 3 Darts (`dartsInTurn >= 3`),
 * während der nächste Wurf schon zur **neuen** Aufnahme gehört. Dann wären intern
 * alle Slots voll → fälschlich `replace_when_full`. Abhilfe: bei vollem Slot-Raster
 * und `round` 0/leer und (State ≥3 Darts oder State unbekannt) Slots leeren und
 * Wurf als Dart 1 werten — ausser `round` zeigt eindeutig Slot 1–2 (echte Korrektur).
 *
 * Undo
 * ----
 * `onUndo()` leert den zuletzt befüllten Slot (von hinten). Wird von der Engine
 * bei `undo_click` aus dem Content-Script aufgerufen.
 *
 * State-Reconcile
 * ---------------
 * `reconcileFromState(state)` kürzt die Slots, wenn der offizielle State weniger
 * Darts im aktuellen Turn meldet (z. B. externes Undo / Sync).
 *
 * =============================================================================
 */
(function initAdmThrowVisitTracker(scope) {
  const ADM = scope.ADM || (scope.ADM = {});

  /** @type {[null | { dedupeKey: string|null, segment: string, score: number }, null, null]} */
  let slots = [null, null, null];

  /** Visit-Schlüssel: Match + Set + Leg + Spieler — wechsel startet leere Slots */
  let visitKey = "";

  let lastDedupeKey = null;

  /** Monoton aus pageScript `post()` — gleiche Seq = dieselbe Nachricht doppelt */
  let lastBridgeSeqSeen = -1;

  /**
   * @param {object|null|undefined} stateLike
   * @param {number|null|undefined} playerIndex
   * @returns {number|null}
   */
  function countDartsInCurrentTurn(stateLike, playerIndex, domTurnHint) {
    if (
      domTurnHint &&
      typeof domTurnHint === "object" &&
      Number.isInteger(playerIndex) &&
      playerIndex === domTurnHint.activePlayerIndex &&
      domTurnHint.dartsInTurn != null &&
      Number.isFinite(Number(domTurnHint.dartsInTurn))
    ) {
      const n = Math.trunc(Number(domTurnHint.dartsInTurn));
      return Math.max(0, Math.min(3, n));
    }
    if (!Number.isInteger(playerIndex) || playerIndex < 0) return null;
    const roots = [stateLike?.raw?.state, stateLike?.raw, stateLike].filter(
      (x) => x && typeof x === "object"
    );
    for (const root of roots) {
      const turns = root.turns;
      if (!Array.isArray(turns) || !turns.length) continue;
      for (let i = turns.length - 1; i >= 0; i -= 1) {
        const turn = turns[i];
        if (!turn || typeof turn !== "object") continue;
        const tp = Number(turn.player ?? turn.playerIndex ?? turn.playerId ?? turn.competitorIndex ?? turn.participantIndex);
        if (tp !== playerIndex) continue;
        const darts = turn.darts ?? turn.throws ?? turn.dartThrows ?? turn.hits;
        if (Array.isArray(darts)) return darts.length;
        return 0;
      }
    }
    return null;
  }

  /** Letzter Eintrag in `turns[]` (laufender Visit-Kopf im State). */
  function getLastTurnPrimaryPlayer(stateLike) {
    const roots = [stateLike?.raw?.state, stateLike?.raw, stateLike].filter(
      (x) => x && typeof x === "object"
    );
    for (const root of roots) {
      const turns = root?.turns;
      if (!Array.isArray(turns) || !turns.length) continue;
      const last = turns[turns.length - 1];
      if (!last || typeof last !== "object") continue;
      const tp = Number(
        last.player ?? last.playerIndex ?? last.playerId ?? last.competitorIndex ?? last.participantIndex
      );
      if (Number.isInteger(tp) && tp >= 0) return tp;
    }
    return null;
  }

  function matchVisitKey(t) {
    const mid = String(t?.matchId ?? "").trim() || "_";
    const set = t?.set ?? "_";
    const leg = t?.leg ?? "_";
    const p = Number(t?.player);
    const pl = Number.isInteger(p) && p >= 0 && p <= 15 ? p : "_";
    return `${mid}|${set}|${leg}|${pl}`;
  }

  function parsePlayerIndexFromVisitKey(vk) {
    if (!vk || typeof vk !== "string") return null;
    const parts = vk.split("|");
    if (parts.length < 4) return null;
    const n = Number(parts[3]);
    if (Number.isInteger(n) && n >= 0 && n <= 15) return n;
    return null;
  }

  /**
   * Nach 3 Darts im Tracker: nächster Wurf = Dart 1 des nächsten Spielers (Round-Robin, n Spieler).
   * Kein Eingriff bei round=1/2 (Korrektur-Slots).
   */
  function peekAlternateAfterCompletedVisit(t, playerCount) {
    if (!Number.isInteger(playerCount) || playerCount < 2) return null;
    const filled = slots.filter((s) => s != null).length;
    if (filled !== 3) return null;
    const mid = String(t?.matchId ?? "").trim() || "_";
    const set = t?.set ?? "_";
    const leg = t?.leg ?? "_";
    const prefix = `${mid}|${set}|${leg}|`;
    if (!visitKey.startsWith(prefix)) return null;
    const p = parsePlayerIndexFromVisitKey(visitKey);
    if (p === null || p < 0 || p >= playerCount) return null;
    const r = parseRoundSlot0(t?.round);
    if (r === 1 || r === 2) return null;
    return (p + 1) % playerCount;
  }

  /** Slots 1–2 gefüllt: weiter derselbe Visit-Inhaber, außer State meldet Turn-Reset (0 Darts) oder ist voraus. */
  function peekStickyPlayerForNextDart(t, stateLike) {
    const mid = String(t?.matchId ?? "").trim() || "_";
    const set = t?.set ?? "_";
    const leg = t?.leg ?? "_";
    const prefix = `${mid}|${set}|${leg}|`;
    if (!visitKey.startsWith(prefix)) return null;
    const filled = slots.filter((s) => s != null).length;
    if (filled < 1 || filled > 2) return null;
    const stickyPlayer = parsePlayerIndexFromVisitKey(visitKey);
    if (stickyPlayer === null) return null;
    /**
     * Genau 2 Slots voll = der **kommende** Wurf ist Dart 3 dieses Visits.
     * State/Payload sind hier oft schon auf dem **nächsten** Spieler — keine State-Prüfung.
     */
    if (filled === 2) return stickyPlayer;
    if (!stateLike || typeof stateLike !== "object") return stickyPlayer;
    const nState = countDartsInCurrentTurn(stateLike, stickyPlayer);
    /**
     * 0 Darts für Sticky-Spieler: nur aufgeben, wenn der **letzte** Turn schon einem anderen Spieler gehört
     * (echter Wechsel). Sonst oft API-Quirk vor Dart 3 → Sticky würde wegfallen.
     */
    if (nState === 0 && filled > 0) {
      const lastP = getLastTurnPrimaryPlayer(stateLike);
      if (lastP !== null && lastP !== stickyPlayer) return null;
    }
    /**
     * State darf **einen** Dart voraus sein (WS: State schon mit 3. Dart, Tracker noch bei 2 Slots).
     * Nur bei > filled+1 Sticky abbrechen.
     */
    if (nState !== null && nState > filled + 1) return null;
    return stickyPlayer;
  }

  function resetSlots() {
    slots = [null, null, null];
  }

  /** Nach Bull-Off → X01: Slots/visitKey leeren, damit Throw 1–3 und Engine-Sync nicht vom Cork hängen. */
  function resetAfterBullOffToLegPlay() {
    resetSlots();
    visitKey = "";
    lastDedupeKey = null;
  }

  /** Neues Match (andere matchId): keine alten Slots/Namen/Seq aus dem vorigen Spiel. */
  function resetForNewMatch() {
    resetSlots();
    visitKey = "";
    lastDedupeKey = null;
    lastBridgeSeqSeen = -1;
  }

  /**
   * Normalisiert `round` vom Backend zu 0..2
   * @returns {number|null}
   */
  function parseRoundSlot0(round) {
    const r = Number(round);
    if (!Number.isFinite(r)) return null;
    if (r >= 0 && r <= 2) return Math.trunc(r);
    if (r >= 1 && r <= 3) return Math.trunc(r - 1);
    return null;
  }

  /**
   * Lesbare Segment-Zeichenkette (D20, T19, BULL, MISS, …)
   */
  function formatThrowSegmentLabel(t) {
    const seg = String(t?.segment || "").trim();
    if (seg) {
      const u = seg.toUpperCase().replace(/\s+/g, "");
      if (/^M\d*$/.test(u) || u === "MISS" || u === "OUTSIDE") return "MISS";
      return u;
    }
    const m = Number(t?.multiplier);
    const n = Number(t?.number);
    if (m === 0 || (Number(t?.score) === 0 && !Number.isFinite(n))) return "MISS";
    if (m === 3 && Number.isFinite(n)) return `T${n}`;
    if (m === 2 && n === 25) return "DBULL";
    if (m === 2 && Number.isFinite(n)) return `D${n}`;
    if (m === 1 && n === 25) return "BULL";
    if (m === 1 && Number.isFinite(n)) return `S${n}`;
    const sc = Number(t?.score);
    if (sc === 0) return "MISS";
    return "?";
  }

  /**
   * @param {object} t — Bridge-Throw
   * @param {{ getLastState?: () => object|null }} ctx
   * @returns {{
   *   skipped: boolean,
   *   dartIndexInVisit: number,
   *   segmentLabel: string,
   *   score: number,
   *   isCorrection: boolean,
   *   slotIndex0: number,
   *   reason?: string
   *   inputModeLabel?: string
   * }}
   */
  function readInputModeLabel(t) {
    const m = String(t?.inputMode ?? "").trim();
    if (m === "Digital" || m === "Live" || m === "Unbekannt") return m;
    return "Unbekannt";
  }

  function processThrow(t, ctx) {
    const getLastState = ctx?.getLastState;
    const bridgeSeq = Number(t?.bridgeSeq);
    if (Number.isFinite(bridgeSeq) && bridgeSeq > 0) {
      if (bridgeSeq === lastBridgeSeqSeen) {
        return {
          skipped: true,
          dartIndexInVisit: 0,
          segmentLabel: "",
          score: NaN,
          isCorrection: false,
          slotIndex0: -1,
          reason: "duplicate_bridgeSeq",
          inputModeLabel: readInputModeLabel(t)
        };
      }
      lastBridgeSeqSeen = bridgeSeq;
    }

    const dk =
      t?.dedupeKey !== undefined && t?.dedupeKey !== null && t?.dedupeKey !== ""
        ? String(t.dedupeKey)
        : null;

    if (dk && dk === lastDedupeKey) {
      return {
        skipped: true,
        dartIndexInVisit: 0,
        segmentLabel: "",
        score: NaN,
        isCorrection: false,
        slotIndex0: -1,
        reason: "duplicate_dedupeKey",
        inputModeLabel: readInputModeLabel(t)
      };
    }

    const mk = matchVisitKey(t);
    if (mk !== visitKey) {
      visitKey = mk;
      resetSlots();
    }

    const player = Number(t?.player);
    const state = typeof getLastState === "function" ? getLastState() : null;
    const domTurnHint =
      typeof ctx?.getDomTurnDartHint === "function" ? ctx.getDomTurnDartHint() : null;
    const dartsInTurn =
      Number.isInteger(player) && player >= 0
        ? countDartsInCurrentTurn(state, player, domTurnHint)
        : null;

    /** Neues Turn beginnt laut State (0 Darts), intern noch Reste → leeren */
    if (dartsInTurn === 0 && (slots[0] || slots[1] || slots[2])) {
      resetSlots();
    }

    const firstEmpty = slots.findIndex((s) => s == null);
    const fromRound = parseRoundSlot0(t?.round);
    const fromState =
      dartsInTurn != null ? Math.min(Math.max(0, dartsInTurn), 2) : null;

    const allSlotsFull = !!(slots[0] && slots[1] && slots[2]);
    /**
     * State zeigt oft noch 3 Darts der **vorigen** Aufnahme; der nächste Wurf ist
     * Dart 1 des neuen Visits — nicht „Korrektur auf Slot 0“.
     */
    const looksLikeFirstDartOfNewVisit =
      allSlotsFull &&
      (fromRound == null || fromRound === 0) &&
      (dartsInTurn == null || dartsInTurn >= 3 || dartsInTurn <= 1);

    let slot0;
    let pickReason;

    if (looksLikeFirstDartOfNewVisit) {
      resetSlots();
      slot0 = 0;
      pickReason = "new_visit_after_previous_full";
    } else if (fromRound != null && slots[fromRound] == null) {
      slot0 = fromRound;
      pickReason = "round_free";
    } else if (fromState != null && slots[fromState] == null) {
      slot0 = fromState;
      pickReason = "state_free";
    } else if (firstEmpty >= 0 && firstEmpty <= 2) {
      slot0 = firstEmpty;
      pickReason = "next_empty";
    } else {
      /** Alle Slots voll, aber explizit Dart 2/3 aus round → echte Korrektur/Ersatz */
      const fb = fromRound != null ? fromRound : 2;
      slot0 = Math.min(Math.max(0, fb), 2);
      pickReason = "replace_when_full";
    }

    const hadBefore = slots[slot0] != null;
    const sameKeyAsSlot = hadBefore && dk && slots[slot0].dedupeKey === dk;
    if (sameKeyAsSlot) {
      return {
        skipped: true,
        dartIndexInVisit: slot0 + 1,
        segmentLabel: formatThrowSegmentLabel(t),
        score: Number(t?.score),
        isCorrection: false,
        slotIndex0: slot0,
        reason: "duplicate_slot_dedupeKey",
        inputModeLabel: readInputModeLabel(t)
      };
    }

    const isCorrection = pickReason === "replace_when_full" && hadBefore;
    const segmentLabel = formatThrowSegmentLabel(t);
    const score = Number(t?.score);

    slots[slot0] = {
      dedupeKey: dk,
      segment: segmentLabel,
      score: Number.isFinite(score) ? score : NaN
    };

    if (dk) lastDedupeKey = dk;

    return {
      skipped: false,
      dartIndexInVisit: slot0 + 1,
      segmentLabel,
      score: Number.isFinite(score) ? score : NaN,
      isCorrection,
      slotIndex0: slot0,
      reason: isCorrection ? "correction" : pickReason,
      inputModeLabel: readInputModeLabel(t)
    };
  }

  function onUndo() {
    lastDedupeKey = null;
    for (let i = 2; i >= 0; i -= 1) {
      if (slots[i]) {
        slots[i] = null;
        return;
      }
    }
  }

  function peekFilledSlotCount() {
    return slots.filter((s) => s != null).length;
  }

  /**
   * Segment-Label aus dem Visit-Tracker → gleiche Worker-Keys wie `getThrowTriggerName` (t20, outside, …).
   */
  function segmentLabelToWorkerThrowKey(label) {
    const u = String(label || "").trim().toUpperCase().replace(/\s+/g, "");
    if (!u || u === "MISS" || /^M\d*$/.test(u) || u === "OUTSIDE") return "outside";
    if (u === "DBULL") return "dbull";
    if (u === "BULL") return "s25";
    const m = u.match(/^([SDT])(\d{1,2})$/);
    if (m) {
      const pref = m[1].toLowerCase();
      const num = Number(m[2]);
      if (pref === "d" && num === 25) return "bull";
      return `${pref}${num}`;
    }
    return "";
  }

  /**
   * Wenn alle drei Visit-Slots belegt sind: die drei Trigger-Keys (Reihenfolge = Slot 1–3).
   * Fuer WLED „Trefferkette“ (Multiset-Vergleich im Worker).
   */
  function peekVisitSlotTriggerKeys() {
    if (!slots[0] || !slots[1] || !slots[2]) return null;
    const a = segmentLabelToWorkerThrowKey(slots[0].segment);
    const b = segmentLabelToWorkerThrowKey(slots[1].segment);
    const c = segmentLabelToWorkerThrowKey(slots[2].segment);
    if (!a || !b || !c) return null;
    return [a, b, c];
  }

  function peekVisitPlayerIndex() {
    return parsePlayerIndexFromVisitKey(visitKey);
  }

  /** Erstes Segment von `visitKey` (matchId), nur wenn sinnvoll — für Abgleich mit `lastState.matchId`. */
  function peekVisitMatchIdPrefix() {
    if (!visitKey || typeof visitKey !== "string") return null;
    const seg = String(visitKey.split("|")[0] || "").trim();
    if (!seg || seg === "_") return null;
    return seg;
  }

  /**
   * State hat „Wahrheit“: wenn weniger Darts im Turn als befüllte Slots → von hinten leeren.
   */
  function reconcileFromState(stateLike) {
    const roots = [stateLike?.raw?.state, stateLike?.raw, stateLike].filter(
      (x) => x && typeof x === "object"
    );
    const keyPlayer = parsePlayerIndexFromVisitKey(visitKey);
    let active = null;
    for (const root of roots) {
      const turns = root?.turns;
      if (!Array.isArray(turns) || !turns.length) continue;
      for (let i = turns.length - 1; i >= 0; i -= 1) {
        const turn = turns[i];
        if (!turn || typeof turn !== "object") continue;
        const tp = Number(turn.player ?? turn.playerIndex ?? turn.playerId ?? turn.competitorIndex ?? turn.participantIndex);
        if (!Number.isInteger(tp) || tp < 0) continue;
        if (keyPlayer !== null && tp !== keyPlayer) continue;
        const darts = turn.darts ?? turn.throws ?? turn.dartThrows ?? turn.hits;
        const n = Array.isArray(darts) ? darts.length : 0;
        /** Leerer Folge-Turn (0 Darts) kommt oft vor Dart 3 — sonst n=0 → alle Slots gelöscht. */
        if (n === 0) continue;
        active = { player: tp, n };
        break;
      }
      if (active) break;
    }
    if (!active) return;
    if (active.n <= 0) return;
    const mk = `${String(stateLike?.matchId ?? "").trim() || "_"}|${stateLike?.set ?? "_"}|${stateLike?.leg ?? "_"}|${active.player}`;
    if (mk !== visitKey) return;

    /** Offiziell n Darts → Slots ab Index n leeren */
    for (let i = 0; i < 3; i += 1) {
      if (i >= active.n) slots[i] = null;
    }
    lastDedupeKey = null;
  }

  /**
   * DOM-Snapshot (`dom_play_snapshot`): wenn das UI weniger geworfene Darts zeigt als der Tracker,
   * Slots von hinten leeren (Undo / Sync). Nur bei passender matchId und gleichem Visit-Spieler.
   */
  function reconcileFromDomSnapshot(obs, stateLike) {
    if (!obs || typeof obs !== "object" || !obs.turn) return;
    const filledRaw = Number(obs.turn.filledSlotCount);
    if (!Number.isFinite(filledRaw)) return;
    const domFilled = Math.max(0, Math.min(3, Math.trunc(filledRaw)));
    const active = Number(obs.activePlayerIndex);
    if (!Number.isInteger(active) || active < 0) return;
    const midObs = String(obs.matchId ?? "").trim() || "_";
    const midState = String(stateLike?.matchId ?? "").trim();
    if (midState && midObs && midObs !== midState) return;
    const prefix = `${midObs}|${stateLike?.set ?? "_"}|${stateLike?.leg ?? "_"}|`;
    if (!visitKey.startsWith(prefix)) return;
    const vp = parsePlayerIndexFromVisitKey(visitKey);
    if (vp !== null && vp !== active) return;
    const curFilled = slots.filter((x) => x != null).length;
    if (domFilled >= curFilled) return;
    for (let i = domFilled; i < 3; i += 1) {
      slots[i] = null;
    }
    lastDedupeKey = null;
  }

  /**
   * Anzahl Darts im laufenden Turn laut WS-State für einen Spieler (0..n) — für DOM-Checkout-Slot-Wahl.
   */
  function countDartsInCurrentTurnForPlayer(stateLike, playerIndex) {
    return countDartsInCurrentTurn(stateLike, playerIndex);
  }

  ADM.admThrowVisitTracker = {
    processThrow,
    onUndo,
    reconcileFromState,
    reconcileFromDomSnapshot,
    resetAfterBullOffToLegPlay,
    resetForNewMatch,
    peekFilledSlotCount,
    peekVisitSlotTriggerKeys,
    peekVisitPlayerIndex,
    peekVisitMatchIdPrefix,
    peekAlternateAfterCompletedVisit,
    peekStickyPlayerForNextDart,
    formatThrowSegmentLabel,
    countDartsInCurrentTurnForPlayer,
    /** Test / Debug */
    _debugSnapshot() {
      return { visitKey, slots: slots.map((s) => (s ? { ...s } : null)) };
    }
  };
})(self);
