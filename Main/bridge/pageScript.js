/**
 * In-Page Patch für Autodarts (PAGE world)
 * - WebSocket: klassischer Capture — `MessageEvent.prototype.data` + `WebSocket.prototype.send`
 *   (wie gängige Userscripte), `websocket-incoming` / `websocket-outgoing` + Normalisierung → post(__ADM__).
 *   Normalisierte throw/state/event tragen `bridgeSource: "websocket"` (Worker: Trigger-Bus nur dafür).
 * - DOM `autodarts-*` → `bridgeSource: "dom"`. DOM-/Window-Scans → `bridgeSource: "observed"` (kein Bus in der Reset-Engine).
 * - Fetch/XHR/EventSource + Capture bleiben für Debug/Recording ohne Trigger-Quelle.
 *
 * Vibecoded by DeDomeD — Urheber; nicht als eigenes/fremdes Produkt verkaufen oder umbenennen.
 */
(() => {
  if (window.__ADM_PATCHED__) return;
  window.__ADM_PATCHED__ = true;

  const NativeFetch = window.fetch ? window.fetch.bind(window) : null;
  const NativeXHR = window.XMLHttpRequest;
  const NativeEventSource = window.EventSource;
  let lastCustomEventSig = "";
  let lastCustomEventAt = 0;
  let lastCaptureSig = "";
  let lastCaptureAt = 0;
  let lastObservedStateSig = "";
  let lastObservedStateAt = 0;
  let bridgeScanTimer = null;
  let bridgeDomObserver = null;
  /** Pro ausgehender Throw-Message — Worker dedupliziert nur echte Doppel-Calls, nicht „gleiches Segment“. */
  let bridgeThrowPostSeq = 0;
  /** Letzter State aus der Page-Bridge — an Throws anhängen, damit der Worker nicht einen veralteten lastState sieht. */
  let lastBridgeStatePayload = null;
  /** Gleiche Page-Roster-Signatur nicht erneut posten (Spiel-URL, ≥2 Namen). */
  let lastMatchContextSig = "";
  /** Lobby-/Setup-Cache: Namen merken, kein Game-ON (eigene Signatur). */
  let lastLobbyMatchContextSig = "";
  /** Nur Window-/window_hint-Scans drosseln wenn WS frisch (sonst Spieler-Flackern). */
  const WS_STATE_AUTHORITY_RECENCY_MS = 3200;
  let lastAuthoritativeStatePostedAt = 0;

  function isPageScriptObservedStateRaw(raw) {
    if (!raw || typeof raw !== "object") return false;
    if (!Object.prototype.hasOwnProperty.call(raw, "observed")) return false;
    if (!Object.prototype.hasOwnProperty.call(raw, "source")) return false;
    if (!Object.prototype.hasOwnProperty.call(raw, "meta")) return false;
    const src = raw.source;
    if (typeof src !== "string") return false;
    return (
      src === "dom_checkout" ||
      src === "dom_game_variant" ||
      src === "dom_play_snapshot" ||
      src.startsWith("window:") ||
      src.startsWith("window_hint:")
    );
  }

  function noteAuthoritativeStateIfApplicable(payload) {
    if (!payload || payload.type !== "state") return;
    if (isPageScriptObservedStateRaw(payload.raw)) return;
    lastAuthoritativeStatePostedAt = Date.now();
  }

  function hasFreshAuthoritativeState() {
    if (!lastAuthoritativeStatePostedAt) return false;
    return Date.now() - lastAuthoritativeStatePostedAt < WS_STATE_AUTHORITY_RECENCY_MS;
  }

  /**
   * @param {object} payload
   * @param {"websocket"|"dom"|"observed"|undefined} bridgeSource — Worker nutzt Trigger-Bus primär bei "websocket"
   */
  function post(payload, bridgeSource) {
    if (!payload || typeof payload !== "object") return;
    if (bridgeSource) payload.bridgeSource = bridgeSource;
    if (payload.type === "state") {
      lastBridgeStatePayload = payload;
    }
    if (payload.type === "throw") {
      bridgeThrowPostSeq += 1;
      payload.bridgeSeq = bridgeThrowPostSeq;
      if (lastBridgeStatePayload && typeof lastBridgeStatePayload === "object") {
        payload.__admStateHint = lastBridgeStatePayload;
      }
    }
    noteAuthoritativeStateIfApplicable(payload);
    window.postMessage({ __ADM__: true, payload }, "*");
  }

  function safeShallowKeys(obj) {
    if (!obj || typeof obj !== "object") return [];
    try {
      return Object.keys(obj).slice(0, 80);
    } catch {
      return [];
    }
  }

  function postCapture(source, payload, meta = {}) {
    const sig = JSON.stringify({
      source,
      t: meta?.topic ?? "",
      u: meta?.url ?? "",
      s: meta?.status ?? "",
      k: meta?.payloadKeys ?? meta?.detailKeys ?? [],
      r: meta?.reason ?? ""
    });
    const now = Date.now();
    if (sig === lastCaptureSig && (now - lastCaptureAt) < 200) return;
    lastCaptureSig = sig;
    lastCaptureAt = now;

    post({
      type: "capture",
      ts: Date.now(),
      source,
      meta,
      raw: payload
    });
  }

  function clipForCapture(value, depth = 0) {
    if (depth > 4) return "[max_depth]";
    if (value === null || value === undefined) return value;
    const t = typeof value;
    if (t === "string") return value.length > 500 ? `${value.slice(0, 500)}...` : value;
    if (t === "number" || t === "boolean") return value;
    if (t !== "object") return String(value);

    if (Array.isArray(value)) {
      return value.slice(0, 20).map((v) => clipForCapture(v, depth + 1));
    }

    const out = {};
    const keys = Object.keys(value).slice(0, 60);
    for (const k of keys) out[k] = clipForCapture(value[k], depth + 1);
    return out;
  }

  function shouldCaptureUrl(urlRaw) {
    const url = String(urlRaw || "").toLowerCase();
    if (!url) return false;
    if (url.includes("autodarts")) return true;
    return (
      url.includes("match") ||
      url.includes("game") ||
      url.includes("state") ||
      url.includes("throw") ||
      url.includes("event")
    );
  }

  function tryParseJsonText(text) {
    if (typeof text !== "string") return null;
    const src = text.trim();
    if (!src) return null;
    try {
      return JSON.parse(src);
    } catch {
      return null;
    }
  }

  function shouldDropCustomDuplicate(kind, payload) {
    const sig = JSON.stringify({
      kind,
      t: payload?.type,
      e: payload?.event,
      m: payload?.matchId,
      p: payload?.player,
      r: payload?.round,
      s: payload?.set,
      l: payload?.leg
    });
    const now = Date.now();
    if (sig === lastCustomEventSig && (now - lastCustomEventAt) < 120) return true;
    lastCustomEventSig = sig;
    lastCustomEventAt = now;
    return false;
  }

  function getNestedObjectCandidates(value) {
    if (!value || typeof value !== "object") return [];
    const out = [value];
    const nestedKeys = ["data", "payload", "body", "detail", "event", "state", "message"];
    for (const key of nestedKeys) {
      const child = value?.[key];
      if (child && typeof child === "object") out.push(child);
    }
    return out;
  }

  function pickFirstValue(candidates) {
    for (const value of candidates) {
      if (value !== undefined && value !== null && value !== "") return value;
    }
    return null;
  }

  function findNestedValueByKeys(root, keys, maxDepth = 4) {
    if (!root || typeof root !== "object") return null;
    const wanted = new Set((Array.isArray(keys) ? keys : [keys]).map((key) => String(key || "").toLowerCase()));
    const queue = [{ value: root, depth: 0 }];
    const seen = new Set();

    while (queue.length > 0) {
      const current = queue.shift();
      const value = current?.value;
      const depth = Number(current?.depth || 0);
      if (!value || typeof value !== "object" || depth > maxDepth) continue;
      if (seen.has(value)) continue;
      seen.add(value);

      for (const [key, child] of Object.entries(value)) {
        const normalizedKey = String(key || "").toLowerCase();
        if (wanted.has(normalizedKey) && child !== undefined && child !== null && child !== "") {
          return child;
        }
        if (child && typeof child === "object") {
          queue.push({ value: child, depth: depth + 1 });
        }
      }
    }
    return null;
  }

  function parseWinnerReference(rawWinner, roots = []) {
    if (rawWinner === undefined || rawWinner === null || rawWinner === "") return null;

    const directNum = Number(rawWinner);
    if (Number.isFinite(directNum) && Number.isInteger(directNum) && directNum >= 0 && directNum <= 15) {
      return directNum;
    }

    const objectCandidates = [rawWinner, ...roots].filter((x) => x && typeof x === "object");
    for (const source of objectCandidates) {
      if (!source || typeof source !== "object") continue;
      const nestedIndex = pickFirstValue([
        source?.index,
        source?.playerIndex,
        source?.winnerIndex,
        source?.id
      ]);
      const idx = Number(nestedIndex);
      if (Number.isFinite(idx) && Number.isInteger(idx) && idx >= 0 && idx <= 15) {
        return idx;
      }
    }

    const winnerName = String(
      typeof rawWinner === "string"
        ? rawWinner
        : (
          rawWinner?.name ??
          rawWinner?.displayName ??
          rawWinner?.username ??
          rawWinner?.playerName ??
          ""
        )
    ).trim().toLowerCase();
    if (!winnerName) return null;

    for (const root of roots) {
      const playerGroups = [
        Array.isArray(root?.players) ? root.players : null,
        Array.isArray(root?.participants) ? root.participants : null,
        Array.isArray(root?.competitors) ? root.competitors : null
      ].filter(Array.isArray);
      for (const players of playerGroups) {
        for (let i = 0; i < players.length; i += 1) {
          const player = players[i];
          if (!player || typeof player !== "object") continue;
          const playerName = String(
            player.name ??
            player.displayName ??
            player.username ??
            player.playerName ??
            player.user?.name ??
            ""
          ).trim().toLowerCase();
          if (playerName && playerName === winnerName) return i;
        }
      }
    }

    return null;
  }

  /**
   * Digital (Maus / UI auf der Scheibe) vs. Live (Kamera / Board-Erkennung).
   *
   * 1) Explizite Strings / Booleans aus `body` und Root (API kann je nach Version variieren —
   *    Liste bei Bedarf erweitern).
   * 2) Heuristik: kein `coords` → oft UI; `coords` mit x/y → oft Erkennung (kann bei manchen
   *    Builds auch für Klicks gesetzt sein — dann „Unbekannt“ möglich).
   */
  function inferAutodartsThrowInputMode(body, rootPrimary, coords) {
    const b = body && typeof body === "object" ? body : {};
    const r = rootPrimary && typeof rootPrimary === "object" ? rootPrimary : {};

    const rawHit = pickFirstValue([
      b.inputMode,
      b.throwMode,
      b.throwSource,
      b.inputType,
      b.inputSource,
      b.mode,
      b.source,
      b.origin,
      r.inputMode,
      r.throwMode,
      r.source,
      b.dart?.inputMode,
      b.dart?.source,
      findNestedValueByKeys(b, ["inputMode", "throwMode", "throwSource", "inputSource"])
    ]);
    let s = String(rawHit != null ? rawHit : "")
      .trim()
      .toLowerCase()
      .replace(/[\s_-]+/g, "");
    if (s) {
      if (/(digital|manual|click|ui|client|mouse|keyboard|simulat)/.test(s)) return "Digital";
      if (/(live|camera|board|physical|autodetect|vision|sensor)/.test(s)) return "Live";
      if (s === "true" || s === "1") return "Digital";
      if (s === "false" || s === "0") return "Live";
    }
    if (b.digital === true || b.isDigital === true || b.manualThrow === true || b.fromUi === true) {
      return "Digital";
    }
    if (b.live === true || b.fromBoard === true || b.camera === true) return "Live";

    if (coords == null || coords === undefined) return "Digital";
    if (typeof coords === "object" && coords !== null) {
      const nx = Number(coords.x ?? coords.X);
      const ny = Number(coords.y ?? coords.Y);
      if (Number.isFinite(nx) || Number.isFinite(ny)) return "Live";
    }
    return "Unbekannt";
  }

  // Game-Event normalisieren (inkl. robustem Segment/Score Fallback)
  function normalizeGameEvent(gameEventData) {
    if (!gameEventData || typeof gameEventData !== "object") return null;

    const root = gameEventData?.data && typeof gameEventData.data === "object"
      ? gameEventData.data
      : gameEventData;
    const rootCandidates = getNestedObjectCandidates(root);
    const rootPrimary = rootCandidates[0] || root;
    const body = pickFirstValue(rootCandidates.map((candidate) => (
      candidate?.body && typeof candidate.body === "object" ? candidate.body : null
    ))) || rootPrimary;
    const bodyCandidates = getNestedObjectCandidates(body);

    const evNameRaw = pickFirstValue([
      rootPrimary?.event,
      rootPrimary?.type,
      rootPrimary?.eventType,
      rootPrimary?.action,
      rootPrimary?.actionType,
      rootPrimary?.name,
      body?.event,
      body?.type,
      body?.eventType,
      body?.action,
      body?.actionType,
      body?.name,
      findNestedValueByKeys(rootPrimary, ["event", "eventType", "action", "actionType", "name", "type"])
    ]);
    const evName = String(evNameRaw || "").toLowerCase();

    const seg = pickFirstValue([
      body?.segment,
      body?.dart?.segment,
      rootPrimary?.segment,
      findNestedValueByKeys(body, ["segment"]),
      findNestedValueByKeys(rootPrimary, ["segment"])
    ]);

    const segName = typeof seg === "string" ? seg : (seg?.name ?? null);
    let mult = Number.isFinite(Number(seg?.multiplier)) ? Number(seg.multiplier) : null;
    let num = Number.isFinite(Number(seg?.number)) ? Number(seg.number) : null;
    const bed = seg?.bed ?? body?.bed ?? null;
    const coords = body?.coords ?? root?.coords ?? null;
    const matchId = pickFirstValue([
      rootPrimary?.matchId,
      rootPrimary?.id,
      body?.matchId,
      body?.id,
      findNestedValueByKeys(rootPrimary, ["matchId", "match_id", "id"])
    ]);
    const round = pickFirstValue([
      body?.round,
      rootPrimary?.round,
      findNestedValueByKeys(rootPrimary, ["round", "roundNumber"])
    ]);
    const set = pickFirstValue([
      body?.set,
      rootPrimary?.set,
      findNestedValueByKeys(rootPrimary, ["set", "setNumber", "currentSet"])
    ]);
    const leg = pickFirstValue([
      body?.leg,
      rootPrimary?.leg,
      findNestedValueByKeys(rootPrimary, ["leg", "legNumber", "currentLeg"])
    ]);

    const looksLikeThrow =
      evName.includes("throw") ||
      evName.includes("dart") ||
      !!segName ||
      Number.isFinite(mult) ||
      Number.isFinite(num) ||
      !!body?.dart ||
      !!coords;

    if (looksLikeThrow) {
      if ((!Number.isFinite(mult) || !Number.isFinite(num)) && typeof segName === "string") {
        const s = segName.trim().toUpperCase();
        if (/^T([1-9]|1\d|20)$/.test(s)) {
          mult = 3;
          num = Number(s.slice(1));
        } else if (/^D([1-9]|1\d|20|25)$/.test(s)) {
          mult = 2;
          num = Number(s.slice(1));
        } else if (/^S([1-9]|1\d|20|25)$/.test(s)) {
          mult = 1;
          num = Number(s.slice(1));
        } else if (/^(?:[1-9]|1\d|20)$/.test(s)) {
          mult = 1;
          num = Number(s);
        } else if (s === "BULL") {
          mult = 1;
          num = 25;
        } else if (s === "DBULL") {
          mult = 2;
          num = 25;
        } else if (/^M(?:ISS)?\d*$/.test(s) || s === "MISS") {
          mult = 0;
          num = 0;
        }
      }

      let score = Number.isFinite(Number(body?.score)) ? Number(body.score) : null;
      if (!Number.isFinite(score) && Number.isFinite(mult) && Number.isFinite(num)) {
        score = mult * num;
      }

      if (!Number.isFinite(score) && typeof segName === "string") {
        if (/^m\d{1,2}$/i.test(segName) || /^miss$/i.test(segName)) score = 0;
        else if (/^bull$/i.test(segName)) score = 25;
        else if (/^dbull$/i.test(segName)) score = 50;
      }
      if (!Number.isFinite(score)) return null;

      const playerRaw = pickFirstValue([
        body?.playerIndex,
        body?.player,
        body?.competitorIndex,
        body?.participantIndex,
        body?.dart?.playerIndex,
        body?.dart?.player,
        body?.turn?.playerIndex,
        body?.turn?.player,
        body?.currentPlayer,
        body?.thrower,
        rootPrimary?.playerIndex,
        rootPrimary?.player,
        rootPrimary?.competitorIndex,
        rootPrimary?.participantIndex,
        rootPrimary?.currentPlayer,
        rootPrimary?.thrower,
        findNestedValueByKeys(body, [
          "playerIndex",
          "currentPlayerIndex",
          "activePlayerIndex",
          "competitorIndex",
          "participantIndex",
          "player",
          "thrower",
          "throwerIndex"
        ]),
        findNestedValueByKeys(rootPrimary, [
          "playerIndex",
          "currentPlayerIndex",
          "activePlayerIndex",
          "competitorIndex",
          "participantIndex",
          "player",
          "thrower"
        ])
      ]);
      const playerNameRaw =
        pickFirstValue([
          body?.playerName,
          body?.name,
          body?.displayName,
          body?.username,
          body?.player?.name,
          body?.user?.name,
          body?.dart?.playerName,
          body?.dart?.name,
          body?.turn?.playerName,
          body?.competitor?.name,
          body?.competitor?.displayName,
          body?.competitor?.username,
          rootPrimary?.playerName,
          rootPrimary?.name,
          rootPrimary?.displayName,
          rootPrimary?.username,
          findNestedValueByKeys(body, ["playerName", "displayName", "username", "nickname", "tagLine"]),
          findNestedValueByKeys(rootPrimary, ["playerName", "winnerName", "displayName", "username", "name"])
        ]);
      let player = null;
      let playerName = null;
      const playerNum = Number(playerRaw);
      if (Number.isFinite(playerNum) && Number.isInteger(playerNum) && playerNum >= 0 && playerNum <= 15) {
        player = playerNum;
      } else if (playerRaw && typeof playerRaw === "object") {
        const nestedPlayerNum = Number(
          pickFirstValue([playerRaw.index, playerRaw.playerIndex, playerRaw.id])
        );
        if (Number.isFinite(nestedPlayerNum) && Number.isInteger(nestedPlayerNum) && nestedPlayerNum >= 0 && nestedPlayerNum <= 15) {
          player = nestedPlayerNum;
        }
        const nestedPlayerName = String(
          pickFirstValue([playerRaw.name, playerRaw.displayName, playerRaw.username, playerRaw.playerName]) || ""
        ).trim();
        if (nestedPlayerName) playerName = nestedPlayerName;
      } else if (typeof playerRaw === "string") {
        const p = playerRaw.trim();
        const pl = p.toLowerCase();
        if (pl === "left") player = 0;
        else if (pl === "right") player = 1;
        else if (p) playerName = p;
      }

      if (!playerName && typeof playerNameRaw === "string") {
        const pn = playerNameRaw.trim();
        if (pn) playerName = pn;
      }

      if (!playerName && typeof playerRaw === "string") {
        const p = playerRaw.trim().toLowerCase();
        if (p === "left") player = 0;
        else if (p === "right") player = 1;
      }

      const dedupeKey = pickFirstValue([
        body?.id,
        body?.throwId,
        body?.eventId,
        body?.dartId,
        body?.dart?.id,
        body?.sequence,
        body?.index,
        rootPrimary?.lastThrowId,
        findNestedValueByKeys(body, ["throwId", "eventId", "id"])
      ]);

      const wallTs = Date.now();
      const monoTs =
        typeof performance !== "undefined" && typeof performance.now === "function"
          ? performance.now()
          : null;

      const inputMode = inferAutodartsThrowInputMode(body, rootPrimary, coords);

      return {
        type: "throw",
        ts: wallTs,
        monoTs: Number.isFinite(monoTs) ? monoTs : null,
        dedupeKey: dedupeKey != null && dedupeKey !== "" ? dedupeKey : null,
        matchId,
        round,
        set,
        leg,
        score,
        player,
        playerName,
        segment: segName,
        bed,
        multiplier: mult,
        number: num,
        coords,
        inputMode,
        /** Tiefensuche im Worker nach playerIndex, falls flache Felder fehlen */
        bridgeThrowRaw: body && typeof body === "object" ? body : rootPrimary
      };
    }

    return {
      type: "event",
      ts: Date.now(),
      matchId,
      round,
      set,
      leg,
      player: parseWinnerReference(
        pickFirstValue([
          body?.playerIndex,
          body?.player,
          rootPrimary?.playerIndex,
          rootPrimary?.player
        ]),
        [...rootCandidates, ...bodyCandidates]
      ),
      playerName: String(
        pickFirstValue([
          body?.playerName,
          body?.name,
          body?.displayName,
          rootPrimary?.playerName,
          rootPrimary?.name,
          rootPrimary?.displayName
        ]) || ""
      ).trim() || null,
      winner: parseWinnerReference(
        pickFirstValue([
          body?.winner,
          body?.winnerIndex,
          body?.winnerPlayer,
          rootPrimary?.winner,
          rootPrimary?.winnerIndex,
          findNestedValueByKeys(rootPrimary, ["winner", "winnerIndex", "winnerPlayer"])
        ]),
        [...rootCandidates, ...bodyCandidates]
      ),
      event: String(evNameRaw ?? "unknown"),
      raw: gameEventData
    };
  }

  function normalizeState(stateData) {
    if (!stateData || typeof stateData !== "object") return null;

    const node = stateData?.state && typeof stateData.state === "object" ? stateData.state : stateData;
    function parsePlayerIndex(candidates, rootsForPlayers) {
      for (const raw of candidates) {
        const n = Number(raw);
        if (Number.isFinite(n)) return n;
        if (raw && typeof raw === "object") {
          const nested = Number(raw.index ?? raw.playerIndex ?? raw.id);
          if (Number.isFinite(nested)) return nested;
        }
        if (typeof raw === "string") {
          const s = raw.trim().toLowerCase();
          if (s === "left") return 0;
          if (s === "right") return 1;

          for (const root of rootsForPlayers) {
            const playerGroups = [
              Array.isArray(root?.players) ? root.players : null,
              Array.isArray(root?.participants) ? root.participants : null,
              Array.isArray(root?.competitors) ? root.competitors : null
            ].filter(Array.isArray);
            for (const players of playerGroups) {
              for (let i = 0; i < players.length; i += 1) {
                const p = players[i];
                if (!p || typeof p !== "object") continue;
                const name = String(
                  p.name ??
                  p.username ??
                  p.displayName ??
                  p.playerName ??
                  p.user?.name ??
                  p.user ??
                  ""
                ).trim().toLowerCase();
                if (name && name === s) return i;
              }
            }
          }
        }
      }
      return null;
    }
    const checkoutGuide = null;
    const scoreRoots = [stateData?.state, stateData];

    function readScore(obj) {
      if (!obj || typeof obj !== "object") return null;
      const candidates = [
        obj.remaining,
        obj.left,
        obj.rest,
        obj.pointsLeft,
        obj.toGo,
        obj.scoreToGo,
        obj.remainingScore,
        obj.currentScore,
        obj.gameScore,
        obj.points,
        obj.score
      ];
      for (const raw of candidates) {
        const n = Number(raw);
        if (Number.isFinite(n)) return n;
      }
      return null;
    }

    function toPlayerScores(anyPlayers) {
      if (!Array.isArray(anyPlayers)) return null;
      const scores = anyPlayers.map((p) => {
        if (typeof p === "number" && Number.isFinite(p)) return p;
        if (p && typeof p === "object") return readScore(p);
        return null;
      });
      return scores.some((x) => Number.isFinite(x)) ? scores : null;
    }

    let playerScores = null;
    for (const root of scoreRoots) {
      if (playerScores) break;
      playerScores =
        toPlayerScores(root?.players) ??
        toPlayerScores(root?.participants) ??
        toPlayerScores(root?.competitors) ??
        toPlayerScores(root?.scores) ??
        toPlayerScores(root?.playerScores) ??
        null;
    }

    const playerIndex = parsePlayerIndex(
      [
        node?.throwingPlayerIndex,
        node?.throwingPlayer,
        node?.currentThrowerIndex,
        node?.currentThrower,
        node?.dartThrowerIndex,
        node?.throwerIndex,
        node?.nextPlayerIndex,
        node?.nextPlayer,
        node?.nextCompetitorIndex,
        node?.playerIndex,
        node?.currentPlayerIndex,
        node?.activePlayerIndex,
        node?.player,
        node?.currentPlayer,
        stateData?.throwingPlayerIndex,
        stateData?.throwingPlayer,
        stateData?.currentThrowerIndex,
        stateData?.currentThrower,
        stateData?.dartThrowerIndex,
        stateData?.throwerIndex,
        stateData?.nextPlayerIndex,
        stateData?.nextPlayer,
        stateData?.nextCompetitorIndex,
        stateData?.playerIndex,
        stateData?.currentPlayerIndex,
        stateData?.activePlayerIndex,
        stateData?.player,
        stateData?.currentPlayer,
        findNestedValueByKeys(node, [
          "throwingPlayerIndex",
          "throwingPlayer",
          "currentThrowerIndex",
          "currentThrower",
          "nextPlayerIndex",
          "nextPlayer",
          "playerIndex",
          "currentPlayerIndex",
          "activePlayerIndex",
          "player",
          "currentPlayer"
        ]),
        findNestedValueByKeys(stateData, [
          "throwingPlayerIndex",
          "throwingPlayer",
          "currentThrowerIndex",
          "currentThrower",
          "nextPlayerIndex",
          "nextPlayer",
          "playerIndex",
          "currentPlayerIndex",
          "activePlayerIndex",
          "player",
          "currentPlayer"
        ])
      ],
      [node, stateData]
    );

    const winner = parseWinnerReference(
      pickFirstValue([
        node?.winner,
        node?.winnerIndex,
        node?.winnerPlayer,
        stateData?.winner,
        stateData?.winnerIndex,
        stateData?.winnerPlayer,
        findNestedValueByKeys(node, ["winner", "winnerIndex", "winnerPlayer"]),
        findNestedValueByKeys(stateData, ["winner", "winnerIndex", "winnerPlayer"])
      ]),
      [node, stateData]
    );

    return {
      type: "state",
      ts: Date.now(),
      matchId: stateData.id ?? node?.id ?? null,
      player: playerIndex,
      round: node?.round ?? stateData?.round ?? null,
      set: node?.set ?? stateData?.set ?? null,
      leg: node?.leg ?? stateData?.leg ?? null,
      turnBusted: !!(node?.turnBusted ?? stateData?.turnBusted),
      gameFinished: !!(node?.gameFinished ?? stateData?.gameFinished),
      winner,
      checkoutGuide,
      playerScores,
      raw: stateData
    };
  }

  /**
   * Ein Root-JSON-Objekt vom Autodarts-WS → 0..n Bridge-Payloads (throw | state | event).
   */
  function expandFromRoot(parsed) {
    const out = [];
    if (!parsed || typeof parsed !== "object") return out;

    const envelopes = [parsed, parsed?.data, parsed?.payload, parsed?.params, parsed?.result].filter(
      (x) => x && typeof x === "object"
    );
    const topics = envelopes
      .map((x) => String(x?.topic || ""))
      .filter(Boolean)
      .map((x) => x.toLowerCase());
    const channels = envelopes
      .map((x) => String(x?.channel || ""))
      .filter(Boolean)
      .map((x) => x.toLowerCase());

    /** `autodarts.boards` — IBoard wie Tools for Autodarts (`event` + `status`, u. a. Takeout). */
    if (channels.some((c) => c.includes("autodarts.board"))) {
      const pl =
        parsed?.params?.data?.data ??
        parsed?.params?.data ??
        parsed?.data?.data ??
        parsed?.data ??
        parsed?.payload?.data ??
        parsed?.payload ??
        parsed;
      const boardPayload = pl && typeof pl === "object" && !Array.isArray(pl) ? pl : null;
      if (boardPayload) {
        const be = String(boardPayload.event ?? "").trim();
        const bs = String(boardPayload.status ?? "").trim();
        out.push({
          type: "state",
          ts: Date.now(),
          matchId: boardPayload.matchId ?? null,
          player: null,
          round: null,
          set: null,
          leg: null,
          turnBusted: false,
          gameFinished: false,
          winner: null,
          checkoutGuide: null,
          playerScores: null,
          raw: {
            source: "autodarts_boards",
            boardEvent: be,
            boardStatus: bs,
            observed: boardPayload
          }
        });
      }
      return out;
    }

    const channelLooksRelevant = channels.some((c) =>
      c.includes("autodarts.match") || c.includes("autodarts.game") || c.includes("match")
    );
    const topic = topics.find(Boolean) || "";
    if (!channelLooksRelevant && !topic) return out;

    const isGameEventTopic =
      topic.endsWith(".game-events") ||
      topic.includes(".game-events.") ||
      topic.includes("game-events") ||
      topic.includes("game_event");

    const isStateTopic =
      topic.endsWith(".state") ||
      topic.includes(".state.") ||
      topic.includes("/state") ||
      topic.includes("match-state") ||
      topic.includes("state_update") ||
      topic.includes("state");

    const payload =
      parsed?.data?.data ??
      parsed?.payload?.data ??
      parsed?.data ??
      parsed?.payload ??
      parsed;

    const looksStateLike =
      payload &&
      typeof payload === "object" &&
      (
        payload.state ||
        payload.players ||
        payload.playerScores ||
        payload.scores ||
        payload.set !== undefined ||
        payload.leg !== undefined ||
        payload.round !== undefined
      );

    if (isGameEventTopic) {
      if (Array.isArray(payload)) {
        for (let i = 0; i < payload.length; i += 1) {
          const p = normalizeGameEvent(payload[i]);
          if (p) out.push(p);
        }
      } else {
        const p = normalizeGameEvent(payload);
        if (p) out.push(p);
      }
      /** Kein return: derselbe WS-Frame kann zusätzlich State enthalten (topic game-events + Payload state-like). */
    }

    if (!isGameEventTopic && payload && typeof payload === "object") {
      const quickEvRaw = pickFirstValue([
        payload.event,
        payload.eventType,
        findNestedValueByKeys(payload, ["event", "eventType"]),
        payload.data && typeof payload.data === "object" ? payload.data.event : null,
        payload.message && typeof payload.message === "object" ? payload.message.event : null
      ]);
      const quickEv = String(quickEvRaw || "").trim();
      if (quickEv) {
        const qk = quickEv.toLowerCase().replace(/[\s._-]+/g, "");
        const qVar = new Set([qk]);
        if (qk.endsWith("event") && qk.length > 5) qVar.add(qk.slice(0, -5));
        const startKeys = new Set([
          "gamestarted",
          "matchstarted",
          "boardstarted",
          "gameon",
          "gamebegin",
          "matchbegin",
          "boardbegin",
          "legstarted",
          "roundstarted",
          "sessionstarted"
        ]);
        if ([...qVar].some((k) => startKeys.has(k))) {
          const p = normalizeGameEvent({
            event: quickEv,
            matchId: pickFirstValue([
              payload.matchId,
              findNestedValueByKeys(payload, ["matchId", "match_id", "id"])
            ]),
            set: pickFirstValue([payload.set, findNestedValueByKeys(payload, ["set", "setNumber", "currentSet"])]),
            leg: pickFirstValue([payload.leg, findNestedValueByKeys(payload, ["leg", "legNumber", "currentLeg"])]),
            round: pickFirstValue([payload.round, findNestedValueByKeys(payload, ["round", "roundNumber"])]),
            raw: payload
          });
          if (p && p.type === "event") out.push(p);
        }
      }
    }

    if (isStateTopic || looksStateLike) {
      const s = normalizeState(payload);
      if (s) out.push(s);
    }

    return out;
  }

  function expandFromJsonString(raw) {
    if (typeof raw !== "string") return [];
    try {
      return expandFromRoot(JSON.parse(raw));
    } catch {
      return [];
    }
  }

  function getNumberOrNull(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function normalizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  /**
   * Nur echte Spieler-Spalten: direkte Kinder von `#ad-ext-player-display`, die eine `.ad-ext-player`-Karte enthalten.
   * Ignoriert KI-Schiedsrichter-Overlays, Toasts und andere eingeschobene Knoten ohne Spielerkarte (stabile Indizes).
   */
  function listAdExtPlayerDisplayColumns(root) {
    if (!root) return [];
    return Array.from(root.children || []).filter(
      (n) => n && n.nodeType === 1 && n.querySelector(".ad-ext-player")
    );
  }

  /** Call-Referee / KI-Schiedsrichter — kein Abbruch der Turn-Zeile wie bei Undo/Next. */
  function isCallRefereeButton(el) {
    if (!el || el.nodeType !== 1) return false;
    if (String(el.tagName || "").toUpperCase() !== "BUTTON") return false;
    const ar = String(el.getAttribute?.("aria-label") || "").toLowerCase();
    if (ar.includes("referee") || ar.includes("schiedsrichter")) return true;
    const title = String(el.getAttribute?.("title") || "").toLowerCase();
    if (title.includes("referee") || title.includes("schiedsrichter")) return true;
    return false;
  }

  function parseDartThrowSlotElement(el) {
    if (!el || el.nodeType !== 1) {
      return { empty: true, points: null, segmentLabel: null };
    }
    if (el.classList.contains("ad-ext-turn-throw")) {
      const flexRoot = el.querySelector("p div[style*='flex-direction']") || el.querySelector("p div");
      const divs = flexRoot ? Array.from(flexRoot.querySelectorAll(":scope > div")) : [];
      const rawPts = divs[0] ? normalizeText(divs[0].textContent || "") : "";
      const seg = divs[1] ? normalizeText(divs[1].textContent || "") : "";
      const pts = rawPts ? Number(rawPts) : NaN;
      return {
        empty: false,
        points: Number.isFinite(pts) ? pts : null,
        segmentLabel: seg || null
      };
    }
    if (el.classList.contains("score")) {
      return { empty: true, points: null, segmentLabel: null };
    }
    return { empty: true, points: null, segmentLabel: null };
  }

  function dedupeObservedState(payload) {
    const sig = JSON.stringify({
      t: payload?.type,
      m: payload?.matchId,
      p: payload?.player,
      r: payload?.round,
      s: payload?.set,
      l: payload?.leg,
      w: payload?.winner,
      c: payload?.checkoutGuide,
      nt: payload?.checkoutNextThrow ?? null,
      tvs: payload?.turnVisitSum ?? null,
      remaining: payload?.remainingScore ?? null,
      scores: payload?.playerScores,
      gv: payload?.gameVariant ?? null,
      mf: payload?.matchFormatSummary ?? null,
      pd: payload?.playerDisplayByIndex ?? null,
      dai: payload?.domActivePlayerIndex ?? null,
      dsp: payload?.domSnapshotSig ?? null
    });
    const now = Date.now();
    if (sig === lastObservedStateSig && (now - lastObservedStateAt) < 450) return true;
    lastObservedStateSig = sig;
    lastObservedStateAt = now;
    return false;
  }

  function emitObservedState(source, stateLike, meta = {}) {
    if (!stateLike || typeof stateLike !== "object") return;
    const gvRaw = stateLike.gameVariant;
    const hasStringGameVariant = typeof gvRaw === "string";
    const mfRaw = stateLike.matchFormatSummary;
    const matchFormatSummary = typeof mfRaw === "string" ? mfRaw.trim() : null;
    const playerDisplayByIndex = Array.isArray(stateLike.playerDisplayByIndex)
      ? stateLike.playerDisplayByIndex
      : null;
    const domActivePlayerIndexRaw = stateLike.domActivePlayerIndex;
    const domActivePlayerIndex =
      domActivePlayerIndexRaw != null && Number.isInteger(Number(domActivePlayerIndexRaw))
        ? Number(domActivePlayerIndexRaw)
        : null;
    const turnVisitSumRaw = stateLike.turnVisitSum;
    const turnVisitSum =
      turnVisitSumRaw != null && turnVisitSumRaw !== "" && Number.isFinite(Number(turnVisitSumRaw))
        ? Math.trunc(Number(turnVisitSumRaw))
        : null;
    const checkoutNextThrowRaw = stateLike.checkoutNextThrow;
    const checkoutNextThrow =
      checkoutNextThrowRaw != null && checkoutNextThrowRaw !== "" && Number.isFinite(Number(checkoutNextThrowRaw))
        ? Math.trunc(Number(checkoutNextThrowRaw))
        : null;
    const payload = {
      type: "state",
      ts: Date.now(),
      matchId: stateLike.matchId ?? null,
      player: stateLike.player ?? null,
      round: stateLike.round ?? null,
      set: stateLike.set ?? null,
      leg: stateLike.leg ?? null,
      turnBusted: !!stateLike.turnBusted,
      gameFinished: !!stateLike.gameFinished,
      winner: stateLike.winner ?? null,
      checkoutGuide: stateLike.checkoutGuide ?? null,
      checkoutNextThrow,
      turnVisitSum,
      remainingScore: Number.isFinite(Number(stateLike.remainingScore)) ? Number(stateLike.remainingScore) : null,
      playerScores: Array.isArray(stateLike.playerScores) ? stateLike.playerScores : null,
      gameVariant: hasStringGameVariant ? gvRaw : null,
      matchFormatSummary,
      playerDisplayByIndex,
      domActivePlayerIndex,
      raw: {
        source,
        meta,
        observed: stateLike.raw ?? stateLike
      }
    };
    const hasUsefulData =
      hasStringGameVariant ||
      !!payload.matchId ||
      payload.player !== null ||
      !!payload.checkoutGuide ||
      (Number.isFinite(payload.checkoutNextThrow) && payload.checkoutNextThrow >= 1) ||
      Number.isFinite(payload.remainingScore) ||
      (Array.isArray(payload.playerScores) && payload.playerScores.some((x) => Number.isFinite(Number(x)))) ||
      (Array.isArray(playerDisplayByIndex) && playerDisplayByIndex.length > 0);
    if (!hasUsefulData) return;
    if (dedupeObservedState(payload)) return;
    post(payload, "observed");
  }

  function readScoresFromObjectCollection(collection) {
    if (!Array.isArray(collection)) return null;
    const values = collection
      .map((item) => {
        if (typeof item === "number") return item;
        if (!item || typeof item !== "object") return null;
        return (
          getNumberOrNull(item.remaining) ??
          getNumberOrNull(item.scoreToGo) ??
          getNumberOrNull(item.pointsLeft) ??
          getNumberOrNull(item.currentScore) ??
          getNumberOrNull(item.score)
        );
      })
      .filter((value) => Number.isFinite(value));
    return values.length ? values : null;
  }

  function scanWindowStateCandidates(reason = "window_scan") {
    if (hasFreshAuthoritativeState()) return;
    const fixedKeys = [
      "__NEXT_DATA__",
      "__APOLLO_STATE__",
      "__INITIAL_STATE__",
      "__REDUX_STATE__",
      "__NUXT__",
      "autodarts"
    ];
    const dynamicKeys = [];
    try {
      for (const key of Object.getOwnPropertyNames(window)) {
        const lower = String(key || "").toLowerCase();
        if (
          lower.includes("autodarts") ||
          lower.includes("checkout") ||
          lower.includes("matchstate") ||
          lower.includes("gamestate")
        ) {
          dynamicKeys.push(key);
        }
        if (dynamicKeys.length >= 10) break;
      }
    } catch {}

    const keys = Array.from(new Set(fixedKeys.concat(dynamicKeys)));
    for (const key of keys) {
      let value;
      try {
        value = window[key];
      } catch {
        value = undefined;
      }
      if (!value || typeof value !== "object") continue;

      const normalized = normalizeState(value);
      if (normalized) {
        emitObservedState(`window:${key}`, normalized, { reason, key });
      }

      const playerScores = (
        readScoresFromObjectCollection(value?.players) ??
        readScoresFromObjectCollection(value?.participants) ??
        readScoresFromObjectCollection(value?.competitors) ??
        (Array.isArray(value?.playerScores) ? value.playerScores : null)
      );
      if (playerScores) {
        emitObservedState(`window_hint:${key}`, {
          matchId: value?.matchId ?? value?.id ?? null,
          player: getNumberOrNull(
            value?.currentPlayerIndex ??
            value?.activePlayerIndex ??
            value?.playerIndex
          ),
          round: value?.round ?? null,
          set: value?.set ?? null,
          leg: value?.leg ?? null,
          winner: parseWinnerReference(value?.winner, [value]),
          checkoutGuide: null,
          playerScores,
          raw: value
        }, { reason, key, mode: "hint" });
      }
    }
  }

  /** Text nach ∅ / ∅ in der Stats-Zeile (z. B. `131.0 / 131.0`). */
  function parseAverageAfterEmptySymbol(text) {
    const t = String(text || "");
    const idx = t.search(/\u2205|∅/);
    if (idx < 0) return "";
    return t
      .slice(idx + 1)
      .replace(/^\s*\|\s*/, "")
      .trim();
  }

  /** Fallback wenn ∅ fehlt: `a / b` mit typischen Ø-Werten (keine Startscores wie 301). */
  function parseAveragePairLoose(text) {
    const t = String(text || "");
    const m = t.match(/(\d{1,3}(?:\.\d+)?)\s*\/\s*(\d{1,3}(?:\.\d+)?)/);
    if (!m) return "";
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return "";
    if (a > 200 || b > 200) return "";
    return `${m[1]} / ${m[2]}`.replace(/\s+/g, " ").trim();
  }

  /**
   * Aktiver Spieler laut UI: innere Zeile hat `ad-ext-player ad-ext-player-active` vs. `ad-ext-player-inactive`.
   * (Ältere Builds nutzten u. a. `ad-ext-player-active-active` auf der Spalte — weiter als Fallback.)
   * Top-Level-Kinder von `#ad-ext-player-display` sind oft nur Wrapper-`div`s um jeweils eine `.ad-ext-player`-Box.
   * @returns {number|null} Spaltenindex (Reihenfolge der **Spieler-Spalten** — siehe `listAdExtPlayerDisplayColumns`)
   */
  function getDomActivePlayerColumnIndex() {
    const root = document.getElementById("ad-ext-player-display");
    if (!root) return null;
    const cols = listAdExtPlayerDisplayColumns(root);
    const isActivePlayerClass = (cnRaw) => {
      const cn = String(cnRaw || "");
      if (/\bad-ext-player-inactive\b/.test(cn)) return false;
      if (/\bad-ext-player-active-active\b/.test(cn)) return true;
      if (/\bad-ext-player-active-inactive\b/.test(cn)) return false;
      if (/\bad-ext-player-active\b/.test(cn)) return true;
      return false;
    };
    for (let i = 0; i < cols.length && i < 16; i += 1) {
      const col = cols[i];
      if (isActivePlayerClass(col.className)) return i;
      const innerPlayer = col.querySelector(".ad-ext-player");
      if (innerPlayer && isActivePlayerClass(innerPlayer.className)) return i;
      try {
        if (col.querySelector("[class*='ad-ext-player-active-active']")) return i;
      } catch (_) {
        const legacy = col.querySelector(".ad-ext-player-active-active");
        if (legacy) return i;
      }
    }
    return null;
  }

  /** `#ad-ext-player-display`: Rest (`ad-ext-player-score`) + Ø-Zeile pro Spalte (Reihenfolge = Spielerindex). */
  function collectPlayerDisplayStripsFromDom() {
    const root = document.getElementById("ad-ext-player-display");
    if (!root) return [];
    const cols = listAdExtPlayerDisplayColumns(root);
    const out = [];
    for (let i = 0; i < cols.length && i < 16; i += 1) {
      const col = cols[i];
      const scoreEl = col.querySelector(".ad-ext-player-score") || col.querySelector("p.ad-ext-player-score");
      const nameEl =
        col.querySelector(".ad-ext-player-name .chakra-text") ||
        col.querySelector(".ad-ext-player-name") ||
        col.querySelector("span.ad-ext-player-name p.chakra-text");
      let remaining = null;
      if (scoreEl) {
        remaining = parseAdExtPlayerScoreBox(scoreEl);
        if (remaining == null) {
          const raw = normalizeText(scoreEl.textContent || "").replace(/\u2212/g, "-");
          const m = raw.match(/-?\d{1,4}/);
          const n = m ? Number(m[1]) : NaN;
          if (Number.isFinite(n) && n >= -999 && n <= 1002) remaining = Math.trunc(n);
        }
      }
      const name = nameEl ? normalizeText(nameEl.textContent || "") : "";
      let bestStats = "";
      col.querySelectorAll("p.chakra-text").forEach((p) => {
        const tx = normalizeText(p.textContent || "");
        if ((/\u2205|∅/.test(tx) || /\bavg\b/i.test(tx)) && tx.length > bestStats.length) bestStats = tx;
      });
      let average = parseAverageAfterEmptySymbol(bestStats) || null;
      if (!average) {
        col.querySelectorAll("p.chakra-text, span.chakra-text").forEach((p) => {
          const tx = normalizeText(p.textContent || "");
          if (!tx) return;
          if (/\u2205|∅/.test(tx) || /\bavg\b/i.test(tx)) {
            const a = parseAverageAfterEmptySymbol(tx) || parseAveragePairLoose(tx);
            if (a) average = a;
          }
        });
      }
      if (!average) {
        col.querySelectorAll("p.chakra-text, span.chakra-text").forEach((p) => {
          const tx = normalizeText(p.textContent || "");
          const a = parseAveragePairLoose(tx);
          if (a) average = a;
        });
      }
      out.push({
        remaining,
        name: name || null,
        average
      });
    }
    return out;
  }

  function scanDomPlayerDisplay(reason = "dom_player_display_scan") {
    const strips = collectPlayerDisplayStripsFromDom();
    if (!strips.length) return;
    const domActivePlayerIndex = getDomActivePlayerColumnIndex();
    emitObservedState(
      "dom_player_display",
      {
        matchId: extractMatchIdFromLocation(),
        playerDisplayByIndex: strips,
        domActivePlayerIndex: domActivePlayerIndex == null ? null : domActivePlayerIndex,
        raw: {
          reason,
          url: String(location.href || "")
        }
      },
      { reason, mode: "dom_player_display" }
    );
  }

  /**
   * `ad-ext-game-variant` steht in einer `ul` neben weiteren `span`s:
   * z. B. X01 (Modus), 301 (Startscore), SI-DO (Ein-/Ausstieg) — Bull-off nur erster Eintrag.
   */
  function collectMatchFormatFromDom() {
    const anchor = document.getElementById("ad-ext-game-variant");
    if (!anchor) return null;
    const root = anchor.closest("ul") || anchor.parentElement;
    if (!root) return null;
    const spans = Array.from(root.querySelectorAll(":scope > span"));
    const parts = spans
      .map((el) => normalizeText(el.textContent || ""))
      .filter((t) => t.length > 0);
    if (!parts.length) return null;
    return {
      gameVariant: parts[0],
      matchFormatSummary: parts.join(" / "),
      formatParts: parts
    };
  }

  function scanDomGameVariant(reason = "dom_game_variant_scan") {
    const fmt = collectMatchFormatFromDom();
    if (!fmt) return;
    emitObservedState(
      "dom_game_variant",
      {
        matchId: extractMatchIdFromLocation(),
        gameVariant: fmt.gameVariant,
        matchFormatSummary: fmt.matchFormatSummary,
        raw: {
          reason,
          url: String(location.href || ""),
          elementId: "ad-ext-game-variant",
          formatParts: fmt.formatParts
        }
      },
      { reason, mode: "dom_game_variant" }
    );
  }

  function extractMatchIdFromLocation() {
    try {
      const p = String(location.pathname || "");
      const m = p.match(/\/(?:matches|match|games|lobbies)\/([a-f0-9-]{8,}|[\w-]{6,})/i);
      return m ? m[1] : null;
    } catch {
      return null;
    }
  }

  /** Kein match_context / Game ON während Lobby-Erstellung oder Vorab-Setup. */
  function isLikelyLobbyOrPreMatchUrl() {
    const h = String(location.href || "").toLowerCase();
    const p = String(location.pathname || "").toLowerCase();
    const hash = String(location.hash || "").toLowerCase();
    if (/\blobby\b/.test(p) || /\blobby\b/.test(h) || /\blobby\b/.test(hash)) return true;
    if (/\/setup\b/.test(p) || /\/create\b/.test(p) || /\/invite\b/.test(p)) return true;
    if (/[?&]lobby(?:=|&|$)/i.test(h)) return true;
    if (/\/matches\/[^/]+\/(?:settings|configure|waiting|summary|overview)\b/i.test(p)) return true;
    return false;
  }

  /** Echtes Spielfeld: Segment `/matches/<id>/…`, aber nicht Lobby-/Setup-Pfade (siehe oben). */
  function isLiveMatchesPlayUrl() {
    const p = String(location.pathname || "").toLowerCase();
    if (!/\/matches\/[^/]+/.test(p)) return false;
    return !isLikelyLobbyOrPreMatchUrl();
  }

  /** Roster-Scan nur auf relevanten Autodarts-Routen. */
  function isUrlRelevantForMatchContext() {
    const p = String(location.pathname || "").toLowerCase();
    if (/\/matches\/[^/]+/.test(p)) return true;
    if (/\/lobbies\//i.test(p)) return true;
    if (p.includes("match")) return true;
    return false;
  }

  function collectPlayerRosterFromNextData() {
    try {
      const el = document.getElementById("__NEXT_DATA__");
      if (!el?.textContent) return [];
      const data = JSON.parse(el.textContent);
      const candidates = [];

      function walk(o, depth) {
        if (depth < 0 || !o) return;
        if (Array.isArray(o) && o.length >= 1 && o.length <= 8) {
          const names = [];
          let ok = true;
          for (let i = 0; i < o.length; i += 1) {
            const row = o[i];
            if (!row || typeof row !== "object") {
              ok = false;
              break;
            }
            const n = String(
              row.name ??
                row.displayName ??
                row.username ??
                row.nickname ??
                row.playerName ??
                row.tagLine ??
                row.user?.name ??
                row.user?.displayName ??
                row.user?.username ??
                row.profile?.name ??
                ""
            ).trim();
            if (!n || n.length > 64) {
              ok = false;
              break;
            }
            names.push(n);
          }
          if (ok && names.length === o.length && names.length >= 1) candidates.push(names);
        }
        if (Array.isArray(o)) {
          for (let i = 0; i < o.length && i < 80; i += 1) walk(o[i], depth - 1);
        } else if (o && typeof o === "object") {
          const vals = Object.values(o);
          for (let i = 0; i < vals.length && i < 60; i += 1) walk(vals[i], depth - 1);
        }
      }

      walk(data, 12);
      if (!candidates.length) return [];
      candidates.sort((a, b) => b.length - a.length);
      return candidates[0];
    } catch {
      return [];
    }
  }

  function domTextLooksLikePlayerName(s) {
    const t = normalizeText(s);
    if (t.length < 2 || t.length > 40) return false;
    if (/^\d{1,4}$/.test(t)) return false;
    if (/^(leg|set|round|score|out|in|vs|dart)\b/i.test(t)) return false;
    return true;
  }

  function collectPlayerRosterFromDomTestIds() {
    const ordered = [];
    const seen = new Set();
    try {
      document.querySelectorAll("[data-testid]").forEach((el) => {
        const id = String(el.getAttribute("data-testid") || "").toLowerCase();
        if (!id) return;
        if (!/\b(player|user|opponent|competitor|participant|member|p\d|seat)\b/.test(id)) return;
        if (/\b(score|point|dart|avatar|icon|button|badge|count|timer|leg|set|stat)\b/.test(id)) return;
        const t = normalizeText(el.textContent || "");
        if (!domTextLooksLikePlayerName(t)) return;
        const key = t.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        ordered.push(t);
      });
    } catch {
      // ignore
    }
    return ordered;
  }

  /** Sichtbare Namen wie auf dem Board (Next-Daten + data-testid). */
  function collectMatchPlayerRosterFromPage() {
    let r = collectPlayerRosterFromNextData();
    if (r.length >= 2) return r;
    const d = collectPlayerRosterFromDomTestIds();
    if (d.length > r.length) return d;
    return r.length ? r : d;
  }

  function tryPostMatchContextRoster(reason) {
    if (!isUrlRelevantForMatchContext()) return;
    const roster = collectMatchPlayerRosterFromPage();
    const inLobby = isLikelyLobbyOrPreMatchUrl();

    if (inLobby) {
      /** Nur Cache fürs Werfer-Logging — Extension druckt kein Game ON bei fromLobbyUrl. */
      if (roster.length < 1) return;
      const sig = `lobby\u0001${roster.map((x) => x.toLowerCase()).join("\u0001")}`;
      if (sig === lastLobbyMatchContextSig) return;
      lastLobbyMatchContextSig = sig;
      post(
        {
          type: "match_context",
          ts: Date.now(),
          matchId: extractMatchIdFromLocation(),
          playerNames: roster,
          source: `${reason}:lobby_cache`,
          fromLobbyUrl: true,
          matchPlayPathOk: false
        },
        "websocket"
      );
      return;
    }

    /** Game-ON-Kontext nur unter Live-`/matches/…`-URL (nicht nur irgendwo „match“ in der Path). */
    if (!isLiveMatchesPlayUrl()) return;
    if (roster.length < 2) return;
    const sig = roster.map((x) => x.toLowerCase()).join("\u0001");
    if (sig === lastMatchContextSig) return;
    lastMatchContextSig = sig;
    post(
      {
        type: "match_context",
        ts: Date.now(),
        matchId: extractMatchIdFromLocation(),
        playerNames: roster,
        source: reason,
        fromLobbyUrl: false,
        matchPlayPathOk: true,
        pagePath: String(location.pathname || "")
      },
      "websocket"
    );
  }

  function parsePlayerStatsLineForSnapshot(text) {
    const t = normalizeText(text || "");
    const dm = t.match(/#\s*(\d+)/);
    const dartsThrown = dm ? Number(dm[1]) : null;
    let averageLeg = null;
    let averageMatch = null;
    const afterEmpty = parseAverageAfterEmptySymbol(t);
    if (afterEmpty) {
      const segs = afterEmpty.split("/").map((s) => s.trim());
      if (segs[0]) {
        const a = Number(segs[0].replace(",", "."));
        if (Number.isFinite(a)) averageLeg = a;
      }
      if (segs[1]) {
        const b = Number(segs[1].replace(",", "."));
        if (Number.isFinite(b)) averageMatch = b;
      }
    }
    if (averageLeg == null || averageMatch == null) {
      const loose = parseAveragePairLoose(t);
      if (loose) {
        const segs = loose.split("/").map((s) => s.trim());
        if (segs[0] && averageLeg == null) {
          const a = Number(segs[0].replace(",", "."));
          if (Number.isFinite(a)) averageLeg = a;
        }
        if (segs[1] && averageMatch == null) {
          const b = Number(segs[1].replace(",", "."));
          if (Number.isFinite(b)) averageMatch = b;
        }
      }
    }
    return {
      dartsThrownThisTurn: Number.isFinite(dartsThrown) ? Math.trunc(dartsThrown) : null,
      averageLeg,
      averageMatch
    };
  }

  function parseLegsWonFromPlayerColumn(col) {
    if (!col) return null;
    try {
      const cand =
        col.querySelector("span[class*='3fr5p8'] p") ||
        col.querySelector("[class*='3fr5p8'] p.chakra-text") ||
        col.querySelector(".chakra-stack.css-37hv00 p.chakra-text");
      if (cand) {
        const raw = normalizeText(cand.textContent || "");
        const n = Number(raw);
        if (Number.isFinite(n) && n >= 0 && n <= 999) return Math.trunc(n);
      }
    } catch (_) {}

    /** Chakra-Hash-Klassen wechseln bei KI-Schiedsrichter / Re-Renders — konservative Text-Heuristik. */
    try {
      const scoreEl = col.querySelector(".ad-ext-player-score, p.ad-ext-player-score");
      const blocks = col.querySelectorAll("p.chakra-text, span.chakra-text");
      for (let bi = 0; bi < blocks.length; bi += 1) {
        const el = blocks[bi];
        if (!el || (scoreEl && scoreEl.contains(el))) continue;
        const raw = normalizeText(el.textContent || "");
        if (!/^\d{1,2}$/.test(raw)) continue;
        const n = Number(raw);
        if (!(n >= 0 && n <= 50)) continue;
        const row = el.closest("p");
        const rowText = row ? normalizeText(row.textContent || "") : raw;
        if (/#\s*\d/.test(rowText) && (/[∅\u2205/]/.test(rowText) || /\d+\s*\/\s*\d/.test(rowText))) continue;
        if (rowText.length > 6) continue;
        return Math.trunc(n);
      }
    } catch (_) {}
    return null;
  }

  function collectTurnRowFromDomForSnapshot() {
    const turnRoot = document.getElementById("ad-ext-turn");
    if (!turnRoot) {
      return {
        visitSum: null,
        isBust: false,
        slots: [],
        refereeButtonPresent: false,
        refereeButtonDisabled: true
      };
    }
    const visitEl = turnRoot.querySelector(".ad-ext-turn-points");
    let visitSum = null;
    let isBust = false;
    if (visitEl) {
      const raw = normalizeText(visitEl.textContent || "");
      if (/^BUST$/i.test(raw)) isBust = true;
      const n = Number(raw);
      if (Number.isFinite(n) && n >= 0 && n <= 1000) visitSum = Math.trunc(n);
    }
    const slots = [];
    const children = Array.from(turnRoot.children || []);
    for (let i = 0; i < children.length; i += 1) {
      const ch = children[i];
      if (!ch || ch.nodeType !== 1) continue;
      if (String(ch.tagName || "").toUpperCase() === "BUTTON") {
        if (isCallRefereeButton(ch)) continue;
        break;
      }
      if (ch.querySelector?.(".ad-ext-turn-points")) continue;
      if (ch.classList.contains("score") || ch.classList.contains("ad-ext-turn-throw")) {
        slots.push(parseDartThrowSlotElement(ch));
      }
    }
    /** KI-UI kann Wrapper um Throws legen — Fallback, wenn direkte Kinder keine Slots liefern. */
    if (!slots.length) {
      try {
        const throws = Array.from(turnRoot.querySelectorAll(":scope .ad-ext-turn-throw"));
        for (let ti = 0; ti < throws.length; ti += 1) {
          slots.push(parseDartThrowSlotElement(throws[ti]));
        }
      } catch (_) {}
    }
    const refBtn = turnRoot.querySelector('button[aria-label="Call referee"]');
    return {
      visitSum,
      isBust,
      slots,
      refereeButtonPresent: !!refBtn,
      refereeButtonDisabled: !refBtn || refBtn.disabled === true
    };
  }

  function findChakraButtonByText(rx) {
    const buttons = Array.from(document.querySelectorAll("button.chakra-button, button"));
    return buttons.find((b) => rx.test(normalizeText(b.textContent || ""))) || null;
  }

  /**
   * Board-Status-Link (Chakra) — bei Takeout oft nur „✊“ (vgl. Tools for Autodarts `BoardStatus.TAKEOUT`).
   */
  function resolveBoardStatusLinkForSnapshot() {
    const direct = document.querySelector("a.chakra-link.chakra-button");
    if (direct) return direct;
    const turn = document.getElementById("ad-ext-turn");
    const sib = turn && turn.nextElementSibling;
    if (!sib || sib.nodeType !== 1) return null;
    const links = sib.querySelectorAll("a.chakra-link, a.chakra-button, a");
    for (let i = 0; i < links.length; i += 1) {
      const a = links[i];
      const cn = String(a.className || "");
      if (/\bchakra-link\b/.test(cn) && /\bchakra-button\b/.test(cn)) return a;
    }
    return null;
  }

  function readBoardViewModesForSnapshot() {
    const labels = ["Segmentmodus", "Koordinatenmodus", "Live-Modus"];
    const modes = {};
    for (const label of labels) {
      const btn = document.querySelector(`button[aria-label="${label}"]`);
      modes[label] = !!(btn && btn.hasAttribute("data-active"));
    }
    const activeModeLabel = labels.find((m) => modes[m]) || null;
    return {
      segmentModeActive: !!modes["Segmentmodus"],
      coordinateModeActive: !!modes["Koordinatenmodus"],
      liveModeActive: !!modes["Live-Modus"],
      activeModeLabel
    };
  }

  function readBoardDetectionRowForSnapshot() {
    const startBtn = findChakraButtonByText(/\bStarten\b/i);
    const resetBtn = findChakraButtonByText(/\bZurücksetzen\b/i);
    const cancelBtn = findChakraButtonByText(/\bAbbrechen\b/i);
    const surrenderBtn = findChakraButtonByText(/\bAufgeben\b/i);
    const calBtn = document.querySelector('button[aria-label="Board kalibrieren"]');
    const statusLink = resolveBoardStatusLinkForSnapshot();
    const statusText = statusLink ? normalizeText(statusLink.textContent || "") : "";
    const takeoutActive = statusText === "\u270a" || statusText === "✊";
    return {
      statusLinkPresent: !!statusLink,
      statusLinkDisabled: !!(statusLink && statusLink.hasAttribute("disabled")),
      statusText: statusText || null,
      takeoutActive,
      startPresent: !!startBtn,
      startDisabled: !!(startBtn && startBtn.disabled),
      resetPresent: !!resetBtn,
      resetDisabled: !!(resetBtn && resetBtn.disabled),
      calibratePresent: !!calBtn,
      calibrateDisabled: !!(calBtn && calBtn.disabled),
      cancelPresent: !!cancelBtn,
      cancelDisabled: !!(cancelBtn && cancelBtn.disabled),
      surrenderPresent: !!surrenderBtn,
      surrenderDisabled: !!(surrenderBtn && surrenderBtn.disabled)
    };
  }

  /**
   * Genau der große Wert in `.ad-ext-player-score` (Abstand zum Board z. B. `-6`, Treffer `25`/`50`, X01-Rest `301`).
   * Nicht mit `\b(\d+)\b` parsen — das verwirft das Minus und liefert falsche Cork-Werte.
   */
  function parseAdExtPlayerScoreBox(scoreEl) {
    if (!scoreEl) return null;
    const raw = normalizeText(scoreEl.textContent || "").replace(/\u2212/g, "-");
    const compact = raw.replace(/\s+/g, "");
    if (/^-?\d{1,4}$/.test(compact)) {
      const v = Number(compact);
      if (Number.isFinite(v) && v >= -999 && v <= 1002) return Math.trunc(v);
    }
    return null;
  }

  /**
   * X01-Rest der aktiven Spalte — gleiche Quelle wie Checkout-Vorschläge in `#ad-ext-turn`.
   */
  function getActiveColumnRemainingScoreForCheckoutGuide() {
    const ai = getDomActivePlayerColumnIndex();
    const root = document.getElementById("ad-ext-player-display");
    if (ai == null || !Number.isInteger(ai) || ai < 0 || !root) return null;
    const cols = listAdExtPlayerDisplayColumns(root);
    if (ai >= cols.length) return null;
    const col = cols[ai];
    const scoreEl = col.querySelector(".ad-ext-player-score") || col.querySelector("p.ad-ext-player-score");
    const v = scoreEl ? parseAdExtPlayerScoreBox(scoreEl) : null;
    if (v == null || !Number.isFinite(v) || v < 0 || v > 1002) return null;
    return Math.trunc(v);
  }

  /**
   * Erste `.suggestion` unter `#ad-ext-turn` = nächster physischer Wurf; `.ad-ext-turn-throw` zählen erledigte Darts.
   */
  function collectCheckoutGuideSnapshotFromAdExtTurn() {
    const turnRoot = document.getElementById("ad-ext-turn");
    if (!turnRoot) return null;
    let visitSum = null;
    let filledThrows = 0;
    let segment = "";
    const children = Array.from(turnRoot.children || []);
    for (let i = 0; i < children.length; i += 1) {
      const ch = children[i];
      if (!ch || ch.nodeType !== 1) continue;
      if (String(ch.tagName || "").toUpperCase() === "BUTTON") {
        if (isCallRefereeButton(ch)) continue;
        break;
      }
      const ptsEl = ch.querySelector?.(".ad-ext-turn-points");
      if (ptsEl) {
        const raw = normalizeText(ptsEl.textContent || "");
        if (!/^BUST$/i.test(raw)) {
          const n = Number(raw);
          if (Number.isFinite(n) && n >= 0 && n <= 1000) visitSum = Math.trunc(n);
        }
        continue;
      }
      if (ch.classList.contains("ad-ext-turn-throw")) {
        filledThrows += 1;
        continue;
      }
      if (ch.classList.contains("suggestion")) {
        let seg = "";
        const pChakra = ch.querySelector("p.chakra-text");
        if (pChakra) seg = normalizeText(pChakra.textContent || "");
        if (!seg) {
          const ps = ch.querySelectorAll("p");
          for (let j = 0; j < ps.length; j += 1) {
            const t = normalizeText(ps[j].textContent || "");
            if (t && t !== "?" && t !== "…") {
              seg = t;
              break;
            }
          }
        }
        if (seg) {
          segment = seg.replace(/\s+/g, " ").trim();
          break;
        }
      }
    }
    if (!segment) return null;
    const nextThrow = Math.min(3, Math.max(1, filledThrows + 1));
    return { visitSum, filledThrows, nextThrow, segment };
  }

  function scanDomCheckoutGuide(reason = "dom_checkout_scan") {
    const fmt = collectMatchFormatFromDom();
    if (fmt && /bull[-\s]?off/i.test(String(fmt.gameVariant || "").toLowerCase())) return;
    const pack = collectCheckoutGuideSnapshotFromAdExtTurn();
    if (!pack) return;
    const remainingScore = getActiveColumnRemainingScoreForCheckoutGuide();
    emitObservedState(
      "dom_checkout",
      {
        matchId: extractMatchIdFromLocation(),
        checkoutGuide: pack.segment,
        checkoutNextThrow: pack.nextThrow,
        checkoutSuggestionSlotIndex0: pack.filledThrows,
        turnVisitSum: pack.visitSum != null ? pack.visitSum : null,
        domActivePlayerIndex: getDomActivePlayerColumnIndex(),
        remainingScore: remainingScore != null ? remainingScore : null,
        raw: {
          reason,
          url: String(location.href || "")
        }
      },
      { reason, mode: "dom_checkout" }
    );
  }

  function isBullOffDomContext(fmt, header) {
    const gv = String(header?.gameVariant || fmt?.gameVariant || "").toLowerCase();
    return /bull[-\s]?off/i.test(gv);
  }

  function buildHeaderForDomPlaySnapshot(fmt) {
    if (!fmt || !Array.isArray(fmt.formatParts)) return null;
    const parts = fmt.formatParts.map((x) => String(x || "").trim()).filter(Boolean);
    const out = {
      gameVariant: parts[0] || "",
      startScore: null,
      inOutRule: "",
      roundLabelRaw: "",
      roundCurrent: null,
      roundMax: null,
      formatParts: parts
    };
    if (parts[1]) {
      const n = Number(parts[1]);
      if (Number.isFinite(n)) out.startScore = Math.trunc(n);
    }
    if (parts[2]) out.inOutRule = parts[2];
    for (let i = 0; i < parts.length; i += 1) {
      const rm = String(parts[i]).match(/^R\s*(\d+)\s*\/\s*(\d+)$/i);
      if (rm) {
        out.roundLabelRaw = parts[i];
        out.roundCurrent = Number(rm[1]);
        out.roundMax = Number(rm[2]);
        break;
      }
    }
    return out;
  }

  function collectDomPlaySnapshot() {
    const collectedAt = Date.now();
    const fmt = collectMatchFormatFromDom();
    const header = buildHeaderForDomPlaySnapshot(fmt);
    const bullOffDom = isBullOffDomContext(fmt, header);
    const matchId = extractMatchIdFromLocation();
    const activePlayerIndex = getDomActivePlayerColumnIndex();
    const root = document.getElementById("ad-ext-player-display");
    const players = [];
    if (root) {
      const cols = listAdExtPlayerDisplayColumns(root);
      for (let i = 0; i < cols.length && i < 16; i += 1) {
        const col = cols[i];
        const scoreEl = col.querySelector(".ad-ext-player-score") || col.querySelector("p.ad-ext-player-score");
        const nameEl =
          col.querySelector(".ad-ext-player-name .chakra-text") ||
          col.querySelector(".ad-ext-player-name p.chakra-text") ||
          col.querySelector(".ad-ext-player-name");
        let scoreRemaining = null;
        let bullProximity = null;
        const topParsed = scoreEl ? parseAdExtPlayerScoreBox(scoreEl) : null;
        let topScoreDisplay = topParsed;
        const minAllowedScore = bullOffDom ? -999 : 0;
        if (topParsed != null) {
          if (topParsed >= minAllowedScore && topParsed <= 1002) scoreRemaining = topParsed;
          /** Nur im echten Bull-Off-Kontext: negative Distanzen = Cork. In X01 können KI-Schiedsrichter / UI kurz negative Werte zeigen — die dürfen `bullProximity` nicht setzen, sonst erkennt die Engine fälschlich Bull-Off und unterdrückt Wurf-Trigger. */
          if (bullOffDom) {
            bullProximity = topParsed;
          }
        } else if (scoreEl) {
          const raw = normalizeText(scoreEl.textContent || "").replace(/\u2212/g, "-");
          const m = raw.match(/-?\d{1,4}/);
          const n = m ? Number(m[1]) : NaN;
          if (Number.isFinite(n) && n >= minAllowedScore && n <= 1002) scoreRemaining = Math.trunc(n);
        }
        const displayName = nameEl ? normalizeText(nameEl.textContent || "") : "";
        let statsLine = "";
        col.querySelectorAll("p.chakra-text").forEach((p) => {
          const tx = normalizeText(p.textContent || "");
          if (/#\s*\d+/.test(tx) && tx.length > statsLine.length) statsLine = tx;
        });
        const st = statsLine ? parsePlayerStatsLineForSnapshot(statsLine) : { dartsThrownThisTurn: null, averageLeg: null, averageMatch: null };
        const inner = col.querySelector(".ad-ext-player");
        const inactive = inner && inner.classList.contains("ad-ext-player-inactive");
        const winner = inner && inner.classList.contains("ad-ext-player-winner");
        const isActive = inner ? !inactive : i === activePlayerIndex;
        players.push({
          index: i,
          displayName: displayName || null,
          scoreRemaining,
          bullProximity,
          topScoreDisplay: topScoreDisplay != null && Number.isFinite(topScoreDisplay) ? topScoreDisplay : null,
          legsWon: parseLegsWonFromPlayerColumn(col),
          dartsThrownThisTurn: st.dartsThrownThisTurn,
          averageLeg: st.averageLeg,
          averageMatch: st.averageMatch,
          isActive: !!isActive,
          isWinner: !!winner,
          statsLineRaw: statsLine || null
        });
      }
    }
    const turnBlock = collectTurnRowFromDomForSnapshot();
    const slots = turnBlock.slots;
    const dartPoints = slots.map((s) => (s.empty ? null : s.points));
    const dartSegmentLabels = slots.map((s) => (s.empty ? null : s.segmentLabel));
    const filledSlotCount = slots.filter((s) => !s.empty).length;
    const undoBtn = findChakraButtonByText(/\bUndo\b/i);
    const nextBtn = findChakraButtonByText(/\bNext\b/i);
    const playerScoresRemaining = players.map((p) =>
      p.scoreRemaining != null && Number.isFinite(Number(p.scoreRemaining))
        ? Math.trunc(Number(p.scoreRemaining))
        : null
    );
    let activeRemainingScore = null;
    if (activePlayerIndex != null && players[activePlayerIndex]) {
      const ap = players[activePlayerIndex];
      activeRemainingScore =
        ap.scoreRemaining != null && Number.isFinite(Number(ap.scoreRemaining))
          ? Math.trunc(Number(ap.scoreRemaining))
          : null;
    }
    return {
      meta: {
        source: "dom_play_snapshot",
        collectedAt,
        url: String(location.href || "")
      },
      matchId,
      header,
      activePlayerIndex,
      activeRemainingScore,
      playerScoresRemaining,
      players,
      turn: {
        visitSum: turnBlock.visitSum,
        slots,
        dartSlotCount: slots.length,
        filledSlotCount,
        dartPoints,
        dartSegmentLabels,
        refereeButtonPresent: turnBlock.refereeButtonPresent,
        refereeButtonDisabled: turnBlock.refereeButtonDisabled
      },
      controls: {
        undoPresent: !!undoBtn,
        undoDisabled: !!(undoBtn && undoBtn.disabled),
        nextPresent: !!nextBtn,
        nextDisabled: !!(nextBtn && nextBtn.disabled)
      },
      boardView: readBoardViewModesForSnapshot(),
      boardDetection: readBoardDetectionRowForSnapshot()
    };
  }

  function syncPlayModeAttributeFromSnapshot(snapshot) {
    try {
      const root = document.documentElement;
      if (!root) return;
      const gv = String(snapshot?.header?.gameVariant || "").toLowerCase();
      // Nur Format-Text: `bullProximity` wird in X01 auch bei negativem Score gesetzt — würde sonst
      // data-adm-play-mode ständig umschalten und Theme-Builder-Layouts flickern.
      const bull = /bull[-\s]?off/i.test(gv);
      root.setAttribute("data-adm-play-mode", bull ? "bull_off" : "x01");
    } catch (_) {}
  }

  function emitDomPlaySnapshot(snapshot, reason) {
    if (!snapshot || typeof snapshot !== "object") return;
    try {
      window.__ADM_DOM_PLAY_SNAPSHOT__ = snapshot;
      window.__ADM_DOM_PLAY_SNAPSHOT_AT__ = snapshot.meta?.collectedAt ?? Date.now();
    } catch (_) {}
    syncPlayModeAttributeFromSnapshot(snapshot);
    const players = Array.isArray(snapshot.players) ? snapshot.players : [];
    const bd = snapshot.boardDetection;
    const hasUseful =
      players.length > 0 ||
      snapshot.turn?.visitSum != null ||
      (snapshot.turn?.filledSlotCount ?? 0) > 0 ||
      (bd &&
        (bd.takeoutActive === true ||
          (typeof bd.statusText === "string" && bd.statusText.length > 0)));
    if (!hasUseful) return;
    const domSnapshotSig = JSON.stringify({
      v: snapshot.turn?.visitSum ?? null,
      dp: snapshot.turn?.dartPoints ?? null,
      sg: snapshot.turn?.dartSegmentLabels ?? null,
      fill: snapshot.turn?.filledSlotCount ?? 0,
      act: snapshot.activePlayerIndex,
      scr: snapshot.playerScoresRemaining ?? null,
      cork: players.map((p) => (p.bullProximity != null ? p.bullProximity : null)),
      dartN: players.map((p) => p.dartsThrownThisTurn),
      takeout: snapshot.boardDetection?.takeoutActive === true ? 1 : 0
    });
    const fmtSummary = snapshot.header?.formatParts?.length
      ? snapshot.header.formatParts.join(" / ")
      : snapshot.header?.gameVariant || null;
    const payload = {
      type: "state",
      ts: Date.now(),
      matchId: snapshot.matchId ?? null,
      player: snapshot.activePlayerIndex,
      domActivePlayerIndex: snapshot.activePlayerIndex,
      playerScores:
        Array.isArray(snapshot.playerScoresRemaining) && snapshot.playerScoresRemaining.length
          ? snapshot.playerScoresRemaining
          : null,
      remainingScore: Number.isFinite(Number(snapshot.activeRemainingScore)) ? Number(snapshot.activeRemainingScore) : null,
      gameVariant: snapshot.header?.gameVariant || null,
      matchFormatSummary: fmtSummary,
      raw: {
        source: "dom_play_snapshot",
        meta: { reason, collectedAt: snapshot.meta?.collectedAt },
        observed: snapshot
      },
      domSnapshotSig
    };
    if (dedupeObservedState(payload)) return;
    post(payload, "observed");
  }

  function scanDomPlaySnapshot(reason = "dom_play_snapshot") {
    try {
      const snap = collectDomPlaySnapshot();
      emitDomPlaySnapshot(snap, reason);
    } catch (e) {
      try {
        console.warn("[AD SB] dom_play_snapshot scan failed", e);
      } catch (_) {}
    }
  }

  function queueBridgeScan(reason = "queued") {
    if (bridgeScanTimer) return;
    bridgeScanTimer = setTimeout(() => {
      bridgeScanTimer = null;
      scanWindowStateCandidates(reason);
      scanDomGameVariant(reason);
      scanDomPlayerDisplay(reason);
      scanDomCheckoutGuide(reason);
      scanDomPlaySnapshot(reason);
      tryPostMatchContextRoster(reason);
    }, 120);
  }

  function hookWindowKey(key) {
    try {
      const descriptor = Object.getOwnPropertyDescriptor(window, key);
      if (descriptor && descriptor.configurable === false) return;
      if (descriptor && (typeof descriptor.get === "function" || typeof descriptor.set === "function")) return;
      let current = window[key];
      Object.defineProperty(window, key, {
        configurable: true,
        enumerable: descriptor?.enumerable ?? true,
        get() {
          return current;
        },
        set(next) {
          current = next;
          queueBridgeScan(`window_hook:${key}`);
        }
      });
      if (current !== undefined) queueBridgeScan(`window_existing:${key}`);
    } catch {
      // ignore
    }
  }

  function startDomAndStateBridge() {
    if (bridgeDomObserver) return;
    bridgeDomObserver = new MutationObserver(() => {
      queueBridgeScan("dom_mutation");
    });
    try {
      bridgeDomObserver.observe(document.documentElement || document, {
        childList: true,
        subtree: true,
        characterData: true
      });
    } catch {
      // ignore
    }

    [
      "__NEXT_DATA__",
      "__APOLLO_STATE__",
      "__INITIAL_STATE__",
      "__REDUX_STATE__",
      "__NUXT__",
      "autodarts"
    ].forEach(hookWindowKey);

    queueBridgeScan("bridge_start");
    setInterval(() => queueBridgeScan("bridge_poll"), 1500);
  }

  function bindAutodartsDomEvents() {
    // Directly consume website-provided events as primary source of truth.
    window.addEventListener("autodarts-game-event", (ev) => {
      postCapture("dom_game_event", ev?.detail, {
        detailKeys: safeShallowKeys(ev?.detail)
      });
      const p = normalizeGameEvent(ev?.detail);
      if (!p || shouldDropCustomDuplicate("game-event", p)) return;
      post(p, "dom");
    });

    window.addEventListener("autodarts-state", (ev) => {
      postCapture("dom_state", ev?.detail, {
        detailKeys: safeShallowKeys(ev?.detail)
      });
      const s = normalizeState(ev?.detail);
      if (!s || shouldDropCustomDuplicate("state", s)) return;
      post(s, "dom");
    });
  }

  function bindFetchCapture() {
    if (!NativeFetch) return;
    window.fetch = async function patchedFetch(input, init) {
      const url = (typeof input === "string" ? input : (input?.url || "")).toString();
      let res;
      try {
        res = await NativeFetch(input, init);
      } catch (err) {
        if (shouldCaptureUrl(url)) {
          postCapture("fetch_error", { error: String(err?.message || err) }, {
            url,
            method: String(init?.method || "GET").toUpperCase()
          });
        }
        throw err;
      }

      if (!shouldCaptureUrl(url)) return res;

      try {
        const clone = res.clone();
        const ct = String(clone.headers?.get("content-type") || "").toLowerCase();
        let body = null;
        if (ct.includes("application/json")) {
          body = clipForCapture(await clone.json());
        } else {
          const text = await clone.text();
          body = clipForCapture(tryParseJsonText(text) ?? text.slice(0, 400));
        }
        postCapture("fetch_response", body, {
          url,
          status: clone.status,
          method: String(init?.method || "GET").toUpperCase(),
          contentType: ct
        });
      } catch {
        // ignore
      }
      return res;
    };
  }

  function bindXhrCapture() {
    if (!NativeXHR) return;
    const origOpen = NativeXHR.prototype.open;
    const origSend = NativeXHR.prototype.send;

    NativeXHR.prototype.open = function patchedOpen(method, url) {
      try {
        this.__ADM_URL__ = String(url || "");
        this.__ADM_METHOD__ = String(method || "GET").toUpperCase();
      } catch {}
      return origOpen.apply(this, arguments);
    };

    NativeXHR.prototype.send = function patchedSend() {
      try {
        this.addEventListener("load", () => {
          const url = String(this.__ADM_URL__ || "");
          if (!shouldCaptureUrl(url)) return;
          const ct = String(this.getResponseHeader?.("content-type") || "").toLowerCase();
          const raw = this.responseType === "" || this.responseType === "text"
            ? String(this.responseText || "")
            : this.response;
          const parsed = typeof raw === "string" ? (tryParseJsonText(raw) ?? raw.slice(0, 400)) : raw;
          postCapture("xhr_response", clipForCapture(parsed), {
            url,
            method: String(this.__ADM_METHOD__ || "GET"),
            status: Number(this.status || 0),
            contentType: ct
          });
        });
      } catch {
        // ignore
      }
      return origSend.apply(this, arguments);
    };
  }

  function bindEventSourceCapture() {
    if (!NativeEventSource) return;
    function PatchedEventSource(url, config) {
      const es = new NativeEventSource(url, config);
      es.addEventListener("message", (ev) => {
        if (!shouldCaptureUrl(url)) return;
        const parsed = tryParseJsonText(String(ev?.data || ""));
        postCapture("eventsource_message", clipForCapture(parsed ?? String(ev?.data || "").slice(0, 400)), {
          url: String(url || "")
        });
      });
      return es;
    }
    PatchedEventSource.prototype = NativeEventSource.prototype;
    Object.setPrototypeOf(PatchedEventSource, NativeEventSource);
    window.EventSource = PatchedEventSource;
  }

  function captureStorageSnapshot(reason = "storage_snapshot") {
    try {
      const ls = {};
      const ss = {};
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = String(localStorage.key(i) || "");
        if (!key) continue;
        const lk = key.toLowerCase();
        if (lk.includes("autodarts") || lk.includes("match") || lk.includes("game")) {
          ls[key] = localStorage.getItem(key);
        }
      }
      for (let i = 0; i < sessionStorage.length; i += 1) {
        const key = String(sessionStorage.key(i) || "");
        if (!key) continue;
        const lk = key.toLowerCase();
        if (lk.includes("autodarts") || lk.includes("match") || lk.includes("game")) {
          ss[key] = sessionStorage.getItem(key);
        }
      }
      if (Object.keys(ls).length || Object.keys(ss).length) {
        postCapture("storage_snapshot", clipForCapture({ localStorage: ls, sessionStorage: ss }), { reason });
      }
    } catch {
      // ignore
    }
  }

  function captureGlobalSnapshot(reason = "global_snapshot") {
    try {
      const candidates = [
        "__NEXT_DATA__",
        "__APOLLO_STATE__",
        "__INITIAL_STATE__",
        "__REDUX_STATE__",
        "autodarts"
      ];
      const out = {};
      for (const key of candidates) {
        if (window[key] !== undefined) out[key] = clipForCapture(window[key]);
      }
      if (Object.keys(out).length > 0) {
        postCapture("global_snapshot", out, { reason });
      }
    } catch {
      // ignore
    }
  }

  const WS_CAPTURE_INCOMING = "websocket-incoming";
  const WS_CAPTURE_OUTGOING = "websocket-outgoing";
  /** Apps lesen `MessageEvent.data` oft mehrmals — sonst laufen Ingest/Posts pro WS-Frame mehrfach. */
  const wsMessageAdmHandled = new WeakSet();

  function ingestExpandedWsPayloads(payloads) {
    if (!payloads || !payloads.length) return;
    const rank = (t) => {
      if (t === "state") return 0;
      if (t === "event") return 1;
      if (t === "throw") return 2;
      return 3;
    };
    const sorted = payloads.slice().sort((a, b) => rank(a?.type) - rank(b?.type));
    let hadThrow = false;
    for (let i = 0; i < sorted.length; i += 1) {
      const p = sorted[i];
      if (!p || !p.type) continue;
      if (p.type === "event" && shouldDropCustomDuplicate("game-event", p)) continue;
      if (p.type === "state" && shouldDropCustomDuplicate("state", p)) continue;
      if (p.type === "throw") hadThrow = true;
      post(p, "websocket");
    }
    if (hadThrow) {
      queueBridgeScan("after_throw_ws");
    }
  }

  function installWebsocketCapture() {
    const msgDesc = Object.getOwnPropertyDescriptor(MessageEvent.prototype, "data");
    if (!msgDesc || typeof msgDesc.get !== "function") return;
    const origDataGet = msgDesc.get;
    msgDesc.get = function patchedMessageEventDataGet() {
      const r = origDataGet.call(this);
      try {
        if (!(this.currentTarget instanceof WebSocket)) return r;
        if (wsMessageAdmHandled.has(this)) return r;
        wsMessageAdmHandled.add(this);
        const ws = this.currentTarget;
        const url = String(ws.url || "");
        const dataForEvent = typeof r === "string" ? r : "(binary data)";
        window.dispatchEvent(
          new CustomEvent(WS_CAPTURE_INCOMING, {
            detail: {
              url,
              data: dataForEvent,
              timestamp: new Date().toISOString()
            }
          })
        );
        if (typeof r === "string" && r.length > 0) {
          ingestExpandedWsPayloads(expandFromJsonString(r));
        }
      } catch (e) {
        console.error("[WebSocket Capture] Error processing message:", e);
      }
      return r;
    };
    Object.defineProperty(MessageEvent.prototype, "data", msgDesc);

    const origSend = WebSocket.prototype.send;
    if (typeof origSend !== "function") return;
    WebSocket.prototype.send = function patchedWsSend(data) {
      try {
        const url = String(this.url || "");
        const dataForEvent = typeof data === "string" ? data : "(binary data)";
        if (typeof data === "string") {
          try {
            JSON.parse(data);
          } catch {
            // ignore
          }
        }
        window.dispatchEvent(
          new CustomEvent(WS_CAPTURE_OUTGOING, {
            detail: {
              url,
              data: dataForEvent,
              timestamp: new Date().toISOString()
            }
          })
        );
      } catch (o) {
        console.error("[WebSocket Capture] Error intercepting send:", o);
      }
      return origSend.call(this, data);
    };
  }

  installWebsocketCapture();
  bindAutodartsDomEvents();
  bindFetchCapture();
  bindXhrCapture();
  bindEventSourceCapture();
  startDomAndStateBridge();
  captureGlobalSnapshot("init");
  captureStorageSnapshot("init");
  window.addEventListener("focus", () => {
    queueBridgeScan("focus");
    captureGlobalSnapshot("focus");
    captureStorageSnapshot("focus");
  });
})();
