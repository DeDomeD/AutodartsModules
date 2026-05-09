/**
 * Lobby-Filter (Lobby-Liste: /lobbies, ggf. / oder Hash-Router; siehe isLobbyListPage)
 * Blacklist, Favoriten, leere Lobbys; Namensfarben siteweit (z. B. Turniere), nur in der Lobby-Liste ausblendbar.
 * Zusätzlich: Game, Mode (SI-DO …), Legs (First to …), Spieleranzahl, optional Plus-Spieler (Blitz), Avg-Bereich, Sortierung.
 * Lobby-Öffnungsdauer neben Join (angelehnt an Greasyfork „Namesuche und Blackliste“: UUID v1 / sessionStorage).
 */
(() => {
  const STYLE_ID = "adm-lobbyfilter-style-v28";
  const WEBSITE_THEME_STYLE_ID = "adm-webdesign-style";
  /** Ganze Lobby-Karte bei Blacklist-Treffer einfärben (Markieren an, Ausblenden aus). */
  const CARD_BL_HIT_CLASS = "adm-lf-card-bl-hit";
  /** Ganze Lobby-Karte bei Favoriten-Treffer einfärben (wie Blacklist: linker Streifen + Verlauf). */
  const CARD_FAV_HIT_CLASS = "adm-lf-card-fav-hit";
  /** Leere Lobby (0 erkannte Spieler): gestrichelter Rahmen in Empty-Farbton. */
  const CARD_EMPTY_HIT_CLASS = "adm-lf-card-empty-hit";
  const BAR_ID = "adm-lobbyfilter-bar";
  const COUNTER_ID = "adm-lobbyfilter-counter";
  const SEARCH_ID = "adm-lobbyfilter-search";
  const MODE_ID = "adm-lf-mode";
  const INOUT_PAIR_ID = "adm-lf-inout-pair";
  const LEGS_ID = "adm-lf-legs";
  const PLAYER_COUNT_ID = "adm-lf-player-count";
  /** Max. erkannte Spieler-Slots in der Leiste (1 … N exakt filtern). */
  const MAX_LOBBY_PLAYER_SLOTS = 8;
  /** Min-/Max-AVG-Dropdown: 25 … 100 in 5er-Schritten */
  const AVG_DROPDOWN_MIN = 25;
  const AVG_DROPDOWN_MAX = 100;
  const AVG_DROPDOWN_STEP = 5;
  const SORT_ID = "adm-lf-sort";
  const MIN_AVG_ID = "adm-lf-min-avg";
  const MAX_AVG_ID = "adm-lf-max-avg";
  const PLUS_PLAYER_ID = "adm-lf-plus-player-only";
  const RESET_ID = "adm-lf-reset";
  /** Überschrift „Lobbys“ + Leiste in einer Zeile (Flex), weniger Abstand zur Liste */
  const HEADING_WRAP_CLASS = "adm-lf-heading-bar-wrap";
  /** Alte Trail-ID (Migration): Zähler/Reset/Plus sitzen jetzt in der Leiste neben der Suche. */
  const HEADING_TRAIL_ID = "adm-lf-heading-trail";
  /** Anzeige „wie lange offen“ vor dem Join-Button (vgl. Greasyfork userscript) */
  const JOIN_AGE_CLASS = "adm-lf-join-age";
  const LOBBY_OPEN_TIMES_SS_KEY = "adm_lobby_open_times_v1";
  /** Spielernamen außerhalb der Lobby-Kartenfilter (z. B. Turniere): einfärben, nie ausblenden. */
  const NAME_HIT_BL_CLASS = "adm-lf-name-bl";
  const NAME_HIT_FAV_CLASS = "adm-lf-name-fav";

  /** UI-Sprache (chrome.storage settings.uiLanguage), für Texte auf der Lobby-Leiste */
  let BAR_UI_LANG = "de";

  function syncBarLangFromSettings(s) {
    BAR_UI_LANG = String(s?.uiLanguage || "de").toLowerCase() === "en" ? "en" : "de";
  }

  function admBarT(key, vars = {}) {
    const lang = BAR_UI_LANG === "en" ? "en" : "de";
    const i18n = typeof window !== "undefined" && window.ADM_I18N;
    const dict = (i18n && i18n[lang]) || {};
    const fb = (i18n && i18n.de) || {};
    const en = (i18n && i18n.en) || {};
    let out = dict[key] || en[key] || fb[key] || String(key);
    for (const [k, v] of Object.entries(vars)) out = out.replace(`{${k}}`, String(v));
    return out;
  }

  function escHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/"/g, "&quot;");
  }

  /** Reine Zahl-Suche (501, 301, …) kollidiert mit separatem Modus-Dropdown — gleiche Tokens werden gegeneinander aufgelöst. */
  const LOBBY_X01_SCORE_SEARCH_TOKENS = new Set(["1001", "901", "701", "501", "301", "170", "121"]);

  const GAME_MODE_VALUES = [
    "",
    "121",
    "170",
    "301",
    "501",
    "701",
    "901",
    "1001",
    "x01",
    "cricket",
    "killer",
    "bermuda",
    "shanghai",
    "gotcha",
    "atc",
    "rtw",
    "random",
    "countup",
    "segment",
    "bob27",
    "bulloff"
  ];

  const GAME_MODE_LITERAL = {
    killer: "Killer",
    bermuda: "Bermuda",
    shanghai: "Shanghai",
    gotcha: "Gotcha",
    random: "Random Checkout",
    countup: "Count Up",
    segment: "Segment Training",
    bob27: "Bob's 27",
    bulloff: "Bull-off"
  };

  function gameModeOptionLabel(value) {
    const v = String(value ?? "");
    if (v === "") return admBarT("lobbyfilter_plus_any");
    if (v === "x01") return admBarT("lobbyfilter_mode_x01");
    if (v === "atc") return admBarT("lobbyfilter_mode_atc");
    if (v === "rtw") return admBarT("lobbyfilter_mode_rtw");
    if (v === "cricket") return admBarT("lobbyfilter_bar_game_cricket");
    if (/^\d+$/.test(v)) return `X01 · ${v}`;
    return GAME_MODE_LITERAL[v] || v;
  }

  function gameModeSelectOptionsHtml() {
    return GAME_MODE_VALUES.map((val) => `<option value="${escHtml(val)}">${escHtml(gameModeOptionLabel(val))}</option>`).join("");
  }

  function sortSelectOptionsHtml() {
    return [
      `<option value="inout_asc">${escHtml(admBarT("lobbyfilter_bar_sort_asc_short"))}</option>`,
      `<option value="inout_desc">${escHtml(admBarT("lobbyfilter_bar_sort_desc_short"))}</option>`
    ].join("");
  }

  /** Texte der Leiste an BAR_UI_LANG anpassen (z. B. nach Sprachwechsel in den Einstellungen). */
  function refreshBarStaticTexts(bar) {
    const root = bar || document.getElementById(BAR_ID);
    if (!root) return;
    root.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.dataset.i18n;
      if (key) el.textContent = admBarT(key);
    });
    root.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
      const key = el.dataset.i18nPlaceholder;
      if (key) el.setAttribute("placeholder", admBarT(key));
    });
    const modeSel = root.querySelector(`#${MODE_ID}`);
    if (modeSel) {
      const cur = modeSel.value;
      Array.from(modeSel.options).forEach((opt) => {
        opt.textContent = gameModeOptionLabel(opt.value);
      });
      if ([...modeSel.options].some((o) => o.value === cur)) modeSel.value = cur;
    }
    const pairSel = root.querySelector(`#${INOUT_PAIR_ID}`);
    if (pairSel && pairSel.options[0]) pairSel.options[0].textContent = admBarT("lobbyfilter_plus_any");
    const sortSel = root.querySelector(`#${SORT_ID}`);
    if (sortSel) {
      const cur = sortSel.value;
      sortSel.innerHTML = sortSelectOptionsHtml();
      sortSel.value = cur === "inout_desc" ? "inout_desc" : "inout_asc";
    }
    const legsSel = root.querySelector(`#${LEGS_ID}`);
    if (legsSel) {
      const cur = legsSel.value;
      legsSel.innerHTML = legsSelectOptionsHtml();
      const ln = parseInt(cur, 10);
      if (cur === "" || (Number.isFinite(ln) && ln >= 1 && ln <= 11 && legsSel.querySelector(`option[value="${cur}"]`))) {
        legsSel.value = cur;
      } else legsSel.value = "";
    }
    const pcSel = root.querySelector(`#${PLAYER_COUNT_ID}`);
    if (pcSel) {
      const cur = pcSel.value;
      pcSel.innerHTML = playerCountSelectOptionsHtml();
      if (cur === "" || (Number(cur) >= 1 && Number(cur) <= MAX_LOBBY_PLAYER_SLOTS && pcSel.querySelector(`option[value="${cur}"]`))) {
        pcSel.value = cur;
      } else pcSel.value = "";
    }
  }

  function refreshLobbyBarI18n() {
    const b = document.getElementById(BAR_ID);
    if (b) refreshBarStaticTexts(b);
  }

  /** Frühere Version: Trail neben der Überschrift — entfernen, falls noch im DOM. */
  function removeLegacyHeadingTrail() {
    document.getElementById(HEADING_TRAIL_ID)?.remove();
  }

  /** Nur Leisten-Filter; Blacklist/Modus im Sidepanel bleiben unberührt. */
  const LOBBY_BAR_RESET_KEYS = {
    lobbyFilterSearchText: "",
    lobbyFilterMode: "",
    lobbyFilterSortInOut: "inout_asc",
    lobbyFilterMinAvg: "",
    lobbyFilterMaxAvg: "",
    lobbyFilterPlusPlayerOnly: false,
    lobbyFilterPlusScope: "any",
    lobbyFilterInOutPair: "",
    lobbyFilterLegsFirstTo: "",
    lobbyFilterPlayerCount: ""
  };

  let STATE = {
    enabled: false,
    searchText: "",
    blacklist: [],
    blacklistHue: 0,
    /** Blacklist: passende Lobbys aus der Liste ausblenden */
    blacklistHide: true,
    /** Blacklist: Treffer in Namen farbig markieren */
    blacklistMark: true,
    favorites: [],
    favoritesHue: 120,
    /** Nur Lobbys mit mindestens einem Favoriten-Namen (wenn Liste nicht leer) */
    favoritesHide: false,
    favoritesMark: true,
    emptyHide: false,
    emptyMark: false,
    emptyHue: 210,
    mode: "",
    sortInOut: "inout_asc",
    /** Nur Lobbys mit erkanntem Plus-Spieler-Icon (Blitz) */
    plusPlayerOnly: false,
    /** @type {number|null} */
    minAvg: null,
    /** @type {number|null} */
    maxAvg: null,
    /** SI-SO … MI-MO als "in-out" mit 0=Straight,1=Double,2=Master; leer = alle */
    inOutPair: "",
    /** First to N Legs (1–11); null = alle */
    legsFirstTo: null,
    /** Genau N erkannte Spieler (1 … MAX_LOBBY_PLAYER_SLOTS); null = alle */
    playerCount: null,
    /** Neben Join: Dauer seit Lobby-Start (UUID v1 / Erstsichtung) */
    showOpenAge: true
  };

  let debounceTimer = null;
  let mo = null;
  /** @type {ReturnType<typeof setInterval> | null} */
  let lobbyOpenAgeIntervalId = null;

  const LOBBY_UUID_IN_PATH = /\/lobbies\/[a-f0-9-]{36}(?:\/|$)/i;

  function pathnameLooksLikeLobbyList() {
    const raw = String(location.pathname || "");
    const p = raw.replace(/\/+$/, "") || "/";
    const pl = p.toLowerCase();
    if (LOBBY_UUID_IN_PATH.test(pl)) return false;
    if (/\/lobbies$/i.test(pl)) return true;
    const h = String(location.hash || "").toLowerCase();
    if (h && /#(?:!?\/)?lobbies(?:\/|\?|$)/i.test(h) && !/#(?:!?\/)?lobbies\/[a-f0-9-]{36}/i.test(h)) return true;
    return false;
  }

  /** Nur eindeutige Lobby-Überschriften — kein Fallback auf irgendein h1 (sonst false positives auf /). */
  function headingSuggestsLobbyList() {
    const nodes = document.querySelectorAll('main h1, main h2, h1, h2, [role="heading"]');
    for (const el of nodes) {
      const t = String(el.textContent || "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
      if (t === "lobbys" || t === "lobbies") return true;
      if (t.startsWith("lobbys ") || t.startsWith("lobbies ")) return true;
      if (/\boffene\s+lobbys\b/.test(t) || /\bopen\s+lobbies\b/.test(t)) return true;
      if (/\blobby[\s-]?browser\b/.test(t) || /\blobby[\s-]?liste\b/.test(t)) return true;
    }
    return false;
  }

  /** Startseite o. ä.: Lobby-Grid ohne /lobbies in der URL (Site-Updates). */
  function domLooksLikeLobbyListOverview() {
    if (headingSuggestsLobbyList()) return true;
    const cards = document.querySelectorAll(".chakra-card");
    if (cards.length < 2) return false;
    for (const c of cards) {
      if (cardHasLobbyLink(c)) return true;
    }
    return false;
  }

  function isLobbyListPage() {
    if (pathnameLooksLikeLobbyList()) return true;
    const p = (String(location.pathname || "").replace(/\/+$/, "") || "/").toLowerCase();
    if (p === "/" || p === "") return domLooksLikeLobbyListOverview();
    return false;
  }

  function clampHue(raw, fallback) {
    const n = parseInt(String(raw), 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(0, Math.min(360, n));
  }

  function parseBlacklistHide(s) {
    if (Object.prototype.hasOwnProperty.call(s, "lobbyFilterBlacklistHide")) {
      const v = s.lobbyFilterBlacklistHide;
      if (typeof v === "boolean") return v;
      if (typeof v === "string") return !["0", "false", "off", "no"].includes(String(v).trim().toLowerCase());
      return !!v;
    }
    return true;
  }

  function parseBlacklistMark(s) {
    if (Object.prototype.hasOwnProperty.call(s, "lobbyFilterBlacklistMark")) {
      const v = s.lobbyFilterBlacklistMark;
      if (typeof v === "boolean") return v;
      if (typeof v === "string") return !["0", "false", "off", "no"].includes(String(v).trim().toLowerCase());
      return !!v;
    }
    return true;
  }

  function parseFavoritesHide(s) {
    if (Object.prototype.hasOwnProperty.call(s, "lobbyFilterFavoritesHide")) {
      const v = s.lobbyFilterFavoritesHide;
      if (typeof v === "boolean") return v;
      if (typeof v === "string") return ["1", "true", "yes", "on"].includes(String(v).trim().toLowerCase());
      return !!v;
    }
    return false;
  }

  function parseFavoritesMark(s) {
    if (Object.prototype.hasOwnProperty.call(s, "lobbyFilterFavoritesMark")) {
      const v = s.lobbyFilterFavoritesMark;
      if (typeof v === "boolean") return v;
      if (typeof v === "string") return !["0", "false", "off", "no"].includes(String(v).trim().toLowerCase());
      return !!v;
    }
    return true;
  }

  function parseEmptyHide(s) {
    if (Object.prototype.hasOwnProperty.call(s, "lobbyFilterEmptyHide")) {
      const v = s.lobbyFilterEmptyHide;
      if (typeof v === "boolean") return v;
      if (typeof v === "string") return ["1", "true", "yes", "on"].includes(String(v).trim().toLowerCase());
      return !!v;
    }
    return false;
  }

  function parseEmptyMark(s) {
    if (Object.prototype.hasOwnProperty.call(s, "lobbyFilterEmptyMark")) {
      const v = s.lobbyFilterEmptyMark;
      if (typeof v === "boolean") return v;
      if (typeof v === "string") return ["1", "true", "yes", "on"].includes(String(v).trim().toLowerCase());
      return !!v;
    }
    return false;
  }

  const INOUT_PAIR_ORDER = new Set(["0-0", "0-1", "0-2", "1-0", "1-1", "1-2", "2-0", "2-1", "2-2"]);

  function normalizeInOutPairFilter(raw) {
    const s = String(raw ?? "").trim();
    if (!s || !INOUT_PAIR_ORDER.has(s)) return "";
    return s;
  }

  function inOutPairMatches(filter, inRank, outRank) {
    const f = normalizeInOutPairFilter(filter);
    if (!f) return true;
    if (inRank === 9 || outRank === 9) return false;
    const parts = f.split("-");
    const a = parseInt(parts[0], 10);
    const b = parseInt(parts[1], 10);
    return inRank === a && outRank === b;
  }

  function normalizeSettings(settings) {
    const s = settings || {};
    let blacklist = [];
    try {
      const raw = JSON.parse(String(s.lobbyFilterBlacklistJson || "[]"));
      if (Array.isArray(raw)) {
        /** Einträge klein geschrieben → Abgleich mit Spielernamen ist case-insensitive. */
        blacklist = raw
          .map((x) => String(x || "").trim().toLowerCase())
          .filter(Boolean);
      }
    } catch {
      blacklist = [];
    }
    let favorites = [];
    try {
      const rawF = JSON.parse(String(s.lobbyFilterFavoritesJson || "[]"));
      if (Array.isArray(rawF)) {
        favorites = rawF
          .map((x) => String(x || "").trim().toLowerCase())
          .filter(Boolean);
      }
    } catch {
      favorites = [];
    }
    const sort = String(s.lobbyFilterSortInOut || "inout_asc").toLowerCase();
    function parseOptAvg(v) {
      const t = String(v ?? "").trim();
      if (!t) return null;
      const n = parseInt(t, 10);
      if (!Number.isFinite(n)) return null;
      const c = Math.max(AVG_DROPDOWN_MIN, Math.min(AVG_DROPDOWN_MAX, n));
      const snapped = Math.round(c / AVG_DROPDOWN_STEP) * AVG_DROPDOWN_STEP;
      return Math.max(AVG_DROPDOWN_MIN, Math.min(AVG_DROPDOWN_MAX, snapped));
    }
    let plusPlayerOnly = false;
    if (Object.prototype.hasOwnProperty.call(s, "lobbyFilterPlusPlayerOnly")) {
      const v = s.lobbyFilterPlusPlayerOnly;
      if (typeof v === "boolean") plusPlayerOnly = v;
      else if (typeof v === "string") plusPlayerOnly = ["1", "true", "yes", "on"].includes(String(v).trim().toLowerCase());
      else plusPlayerOnly = !!v;
    } else {
      const legacyPlus = String(s.lobbyFilterPlusScope || "any").toLowerCase();
      if (legacyPlus === "plus_only") plusPlayerOnly = true;
    }
    function parseLegsFirstTo(v) {
      const t = String(v ?? "").trim();
      if (!t) return null;
      const n = parseInt(t, 10);
      if (!Number.isFinite(n) || n < 1 || n > 11) return null;
      return n;
    }
    function parseLobbyPlayerCount(v) {
      const t = String(v ?? "").trim();
      if (!t) return null;
      const n = parseInt(t, 10);
      if (!Number.isFinite(n) || n < 1 || n > MAX_LOBBY_PLAYER_SLOTS) return null;
      return n;
    }
    let showOpenAge = true;
    if (Object.prototype.hasOwnProperty.call(s, "lobbyFilterShowOpenAge")) {
      const v = s.lobbyFilterShowOpenAge;
      if (typeof v === "boolean") showOpenAge = v;
      else if (typeof v === "string") showOpenAge = !["0", "false", "off", "no"].includes(String(v).trim().toLowerCase());
      else showOpenAge = !!v;
    }
    const installedIds = (Array.isArray(s.installedModules) ? s.installedModules : [])
      .map((x) => String(x || "").trim().toLowerCase())
      .filter(Boolean);
    const lobbyModuleOn = installedIds.includes("lobbyfilter");
    return {
      enabled: lobbyModuleOn || !!s.lobbyFilterEnabled,
      searchText: String(s.lobbyFilterSearchText || "").trim(),
      blacklist,
      blacklistHue: clampHue(s.lobbyFilterBlacklistHue, 0),
      blacklistHide: parseBlacklistHide(s),
      blacklistMark: parseBlacklistMark(s),
      favorites,
      favoritesHue: clampHue(s.lobbyFilterFavoritesHue, 120),
      favoritesHide: parseFavoritesHide(s),
      favoritesMark: parseFavoritesMark(s),
      emptyHide: parseEmptyHide(s),
      emptyMark: parseEmptyMark(s),
      emptyHue: clampHue(s.lobbyFilterEmptyHue, 210),
      mode: String(s.lobbyFilterMode || "").trim().toLowerCase(),
      sortInOut: sort === "inout_desc" ? "inout_desc" : "inout_asc",
      plusPlayerOnly,
      minAvg: parseOptAvg(s.lobbyFilterMinAvg),
      maxAvg: parseOptAvg(s.lobbyFilterMaxAvg),
      inOutPair: normalizeInOutPairFilter(s.lobbyFilterInOutPair),
      legsFirstTo: parseLegsFirstTo(s.lobbyFilterLegsFirstTo),
      playerCount: parseLobbyPlayerCount(s.lobbyFilterPlayerCount),
      showOpenAge
    };
  }

  /** Wie im Userscript: echte Spielernamen vs. Badges */
  function isPlayerName(text) {
    const t = String(text || "").trim();
    if (!t || t.length < 2 || t.length > 50) return false;
    if (/^[\d\s.\-+/()°%]+$/.test(t)) return false;
    if (/^\d+\+?$/.test(t)) return false;
    return true;
  }

  function getAllPlayerNameCandidates(root) {
    const base = root || document;
    let els = Array.from(base.querySelectorAll("span.ad-ext-player-name p"));
    if (els.length === 0) {
      els = Array.from(base.querySelectorAll(".chakra-card p.chakra-text"));
    }
    if (els.length === 0) {
      els = Array.from(base.querySelectorAll("span.ad-ext-player-name"));
    }
    return [...new Set(els)].filter((el) => isPlayerName(el.textContent.trim()));
  }

  /** Anzahl eindeutiger erkannter Spielernamen auf der Karte (Heuristik wie Namensuche). */
  function countLobbyPlayers(card) {
    const els = getAllPlayerNameCandidates(card);
    const names = new Set(
      els.map((e) => String(e.textContent || "").trim().toLowerCase()).filter((n) => n.length >= 2)
    );
    return names.size;
  }

  /** Kein erkannter Spielername (gleiche Heuristik wie Spieleranzahl-Filter). */
  function isLobbyCardEmpty(card) {
    return countLobbyPlayers(card) === 0;
  }

  /**
   * Namens-Knoten siteweit (Turniere, Tabellen, Karten …) — nur typische Autodarts-Selektoren.
   * Filter: isPlayerName; Lobby-Leiste ausschließen. Kein Ausblenden, nur Klassen für Farbe.
   */
  function getGlobalNameHighlightElements() {
    const out = [];
    const seen = new WeakSet();
    const sel = [
      "main span.ad-ext-player-name p",
      "main span.ad-ext-player-name",
      "main .chakra-card p.chakra-text",
      "main table p.chakra-text",
      "main table .chakra-text",
      'main [role="gridcell"] p.chakra-text',
      'main [role="gridcell"] .chakra-text',
      'main [role="cell"] p.chakra-text',
      'main [role="cell"] .chakra-text'
    ].join(", ");
    for (const el of document.querySelectorAll(sel)) {
      if (seen.has(el)) continue;
      if (el.closest(`#${BAR_ID}`)) continue;
      const t = String(el.textContent || "").trim();
      if (!isPlayerName(t)) continue;
      seen.add(el);
      out.push(el);
    }
    return out;
  }

  function cardHasLobbyLink(card) {
    for (const link of card.querySelectorAll("a[href]")) {
      const href = String(link.getAttribute("href") || "");
      if (/\/lobbies\/[a-f0-9-]{36}/i.test(href)) return true;
      if (/^lobbies\/[a-f0-9-]{36}/i.test(href)) return true;
    }
    return false;
  }

  function getLobbyCards() {
    return Array.from(document.querySelectorAll(".chakra-card")).filter((c) => cardHasLobbyLink(c));
  }

  /** @type {Record<string, number> | null} */
  let _lobbyOpenTimesCache = null;

  function readLobbyOpenTimesMap() {
    try {
      if (_lobbyOpenTimesCache && typeof _lobbyOpenTimesCache === "object") return _lobbyOpenTimesCache;
      const raw = JSON.parse(String(sessionStorage.getItem(LOBBY_OPEN_TIMES_SS_KEY) || "{}"));
      _lobbyOpenTimesCache = raw && typeof raw === "object" ? raw : {};
      return _lobbyOpenTimesCache;
    } catch {
      _lobbyOpenTimesCache = {};
      return _lobbyOpenTimesCache;
    }
  }

  function writeLobbyOpenTimesMap(map) {
    _lobbyOpenTimesCache = map;
    try {
      sessionStorage.setItem(LOBBY_OPEN_TIMES_SS_KEY, JSON.stringify(map));
    } catch {
      /* quota / private mode */
    }
  }

  /** UUID v1 → Unix ms (Greasyfork-Logik); sonst null (z. B. UUID v4). */
  function uuidV1ToUnixMs(uuid) {
    if (!uuid) return null;
    const parts = String(uuid).split("-");
    if (parts.length !== 5) return null;
    if (String(parts[2] || "")[0] !== "1") return null;
    try {
      const timeHex = parts[2].substring(1) + parts[1] + parts[0];
      const timeInt = parseInt(timeHex, 16);
      const unixMs = (timeInt - 122192928000000000) / 10000;
      if (unixMs > 1000000000000 && unixMs < Date.now() + 60000) return unixMs;
    } catch {
      /* ignore */
    }
    return null;
  }

  function getLobbyUuidFromCard(card) {
    try {
      for (const link of card.querySelectorAll("a[href]")) {
        const href = String(link.getAttribute("href") || "");
        const m = href.match(/\/lobbies\/([a-f0-9-]{36})/i);
        if (m) return m[1].toLowerCase();
        const m2 = href.match(/^lobbies\/([a-f0-9-]{36})/i);
        if (m2) return m2[1].toLowerCase();
      }
    } catch {
      /* ignore */
    }
    return null;
  }

  /** Erste Sichtung / UUID-Zeit in sessionStorage (nur wenn noch unbekannt). */
  function ensureLobbyOpenTimestampRecorded(uuid) {
    if (!uuid) return null;
    const d = { ...readLobbyOpenTimesMap() };
    if (d[uuid]) return d[uuid];
    let ts = uuidV1ToUnixMs(uuid);
    if (!ts) ts = Date.now();
    d[uuid] = ts;
    const cutoff = Date.now() - 3 * 60 * 60 * 1000;
    for (const k of Object.keys(d)) {
      if (d[k] < cutoff) delete d[k];
    }
    writeLobbyOpenTimesMap(d);
    return d[uuid];
  }

  /** Primäraktion „Lobby beitreten“ / „Join lobby“ (Chakra, ggf. andere Sprachen). */
  function findLobbyJoinButton(card) {
    try {
      const exactSel =
        'a.chakra-button[aria-label="Join lobby"], button.chakra-button[aria-label="Join lobby"], ' +
        'a[aria-label="Join lobby"], button[aria-label="Join lobby"]';
      const exact = card.querySelector(exactSel);
      if (exact) return exact;

      const candidates = card.querySelectorAll(
        "a.chakra-button, button.chakra-button, a[role='button'], button[role='button'], [role='button'], a[class*='button'], button[class*='button']"
      );
      for (const el of candidates) {
        const lab = String(el.getAttribute("aria-label") || "").trim();
        const lo = lab.toLowerCase();
        if (/\bjoin\s+lobby\b/i.test(lab) || lo === "join lobby") return el;
        if (/beitreten/.test(lo) && (/lobby/.test(lo) || lo.includes("lobby"))) return el;
        if (/\bjoin\b/.test(lo) && /lobby/.test(lo)) return el;
        if (lo === "join" || lo === "beitreten") return el;
        const rawTxt = String(el.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
        if (rawTxt === "join" || rawTxt === "beitreten") return el;
        if (/^join\b/.test(rawTxt) || /^beitreten\b/.test(rawTxt)) return el;
      }
      const joinHref = card.querySelector('a[href*="join"][href*="lobbies"], a[href*="/lobbies/"][href*="join"]');
      if (joinHref) return joinHref;
      const as = card.querySelectorAll("a.chakra-button, a[class*='chakra']");
      if (as.length) return as[as.length - 1];
      const bs = card.querySelectorAll("button.chakra-button, button[type='button']");
      return bs.length ? bs[bs.length - 1] : null;
    } catch {
      return null;
    }
  }

  function lobbyOpenAgeUiAllowed() {
    return !!(STATE.enabled && STATE.showOpenAge && isLobbyListPage());
  }

  function formatLobbyOpenDuration(totalSec) {
    if (!Number.isFinite(totalSec) || totalSec < 0) return "—";
    if (totalSec < 60) return `${totalSec}s`;
    const m = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${m}m ${sec}s`;
  }

  function removeAllLobbyOpenAgeLabels() {
    try {
      document.querySelectorAll(`.${JOIN_AGE_CLASS}`).forEach((n) => n.remove());
    } catch {
      /* ignore */
    }
  }

  function stopLobbyOpenAgeTicker() {
    if (lobbyOpenAgeIntervalId != null) {
      clearInterval(lobbyOpenAgeIntervalId);
      lobbyOpenAgeIntervalId = null;
    }
    removeAllLobbyOpenAgeLabels();
  }

  function updateLobbyJoinOpenAgeLabels() {
    if (!lobbyOpenAgeUiAllowed()) {
      removeAllLobbyOpenAgeLabels();
      return;
    }
    const cards = getLobbyCards();
    for (const card of cards) {
      const uuid = getLobbyUuidFromCard(card);
      const ts = uuid ? ensureLobbyOpenTimestampRecorded(uuid) : null;
      const joinBtn = findLobbyJoinButton(card);
      if (!joinBtn?.parentNode) continue;

      let span = joinBtn.previousElementSibling;
      if (!span?.classList?.contains(JOIN_AGE_CLASS)) {
        span = document.createElement("span");
        span.className = JOIN_AGE_CLASS;
        span.setAttribute("data-adm-lf-join-age", "1");
        joinBtn.parentNode.insertBefore(span, joinBtn);
      }

      if (!ts) {
        span.textContent = "—";
        span.className = JOIN_AGE_CLASS;
        span.removeAttribute("title");
        continue;
      }
      const diffMs = Date.now() - ts;
      const s = Math.floor(diffMs / 1000);
      if (s < 0) {
        span.textContent = "—";
        span.className = JOIN_AGE_CLASS;
        span.removeAttribute("title");
        continue;
      }
      span.textContent = formatLobbyOpenDuration(s);
      const minutes = Math.floor(s / 60);
      span.className =
        JOIN_AGE_CLASS + (minutes >= 10 ? " adm-lf-join-age--old" : minutes >= 5 ? " adm-lf-join-age--mid" : "");
      span.title = admBarT("lobbyfilter_open_age_tooltip");
    }
  }

  function startLobbyOpenAgeTickerIfNeeded() {
    if (!lobbyOpenAgeUiAllowed()) {
      stopLobbyOpenAgeTicker();
      return;
    }
    if (lobbyOpenAgeIntervalId != null) return;
    updateLobbyJoinOpenAgeLabels();
    lobbyOpenAgeIntervalId = setInterval(updateLobbyJoinOpenAgeLabels, 1000);
  }

  /** Tags/SVG entfernen, damit aus `innerHTML` kein Ziffern-Müll wie SVG-Pfadkoordinaten in den Fließtext rutscht. */
  function htmlToSearchablePlain(html) {
    try {
      return String(html || "")
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
    } catch {
      return "";
    }
  }

  /**
   * Kartentext für Legs/In-Out/Suche u. ä.
   * Sichtbar: `innerText` (wie zuvor, ohne SVG-/sr-only-Müll aus `textContent`).
   * Ausgeblendet (`display:none`): `innerText` leer → bereinigtes HTML (vgl. Greasyfork nutzt `innerHTML` fürs Filtern).
   */
  function getCardFlatText(card) {
    try {
      if (!card) return "";
      if (card.classList.contains("adm-lf-card-hidden")) {
        return htmlToSearchablePlain(card.innerHTML);
      }
      return String(card.innerText || "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
    } catch {
      return "";
    }
  }

  /** Wie Greasyfork-Script: X01-Zahl im Chakra-Badge (`501</span>`), zuverlässiger als Regex auf vollem textContent. */
  function detectX01ScoreFromBadgeHtml(html) {
    const h = String(html || "");
    const scores = ["1001", "901", "701", "501", "301", "170", "121"];
    /** Greasyfork: `gamemode + '</span>'`; Chakra nutzt teils `<p>`/`<b>`. */
    const closers = ["</span>", "</p>", "</b>"];
    let best = "";
    let bestIdx = Infinity;
    for (const s of scores) {
      for (const c of closers) {
        const idx = h.indexOf(`${s}${c}`);
        if (idx !== -1 && idx < bestIdx) {
          bestIdx = idx;
          best = s;
        }
      }
    }
    return best;
  }

  /** Erkennt Haupt-Spielmodus (heuristisch); `flat` von `getCardFlatText(card)` übergeben, um doppeltes Lesen zu vermeiden. */
  function detectGameMode(card, flat) {
    const t = flat != null ? flat : getCardFlatText(card);
    const html = String(card?.innerHTML || "");
    if (/\bkiller\b/.test(t)) return "killer";
    if (/\bcricket\b/.test(t) || /\btactics\b/.test(t)) return "cricket";
    if (/\bshanghai\b/.test(t)) return "shanghai";
    if (/\b(around\s*the\s*clock|around-the-clock)\b/.test(t) || /\batc\b/.test(t)) return "atc";
    if (/\brtw\b/.test(t) || /\bround\s*the\s*world\b/.test(t)) return "rtw";
    if (/\bbermuda\b/.test(t)) return "bermuda";
    if (/\bgotcha\b/.test(t)) return "gotcha";
    if (/\bcount[\s-]*up\b/.test(t)) return "countup";
    if (/\bsegment\b/.test(t) && /train/.test(t)) return "segment";
    if (/\bbob'?s?\s*27\b/.test(t) || /\bbobs\s*27\b/.test(t)) return "bob27";
    if (/\brandom\s*checkout\b/.test(t)) return "random";
    if (/\bbull[\s-]*off\b/.test(t) || /\bbulloff\b/.test(t)) return "bulloff";
    const fromBadge = detectX01ScoreFromBadgeHtml(html);
    if (fromBadge) return fromBadge;
    /** Linkstes Treffer im Fließtext, falls kein Badge-Treffer (ältere Markup-Varianten). */
    const scoreIds = [...LOBBY_X01_SCORE_SEARCH_TOKENS];
    let best = "";
    let bestIdx = Infinity;
    for (const s of scoreIds) {
      const m = new RegExp(`\\b${s}\\b`).exec(t);
      if (m && m.index < bestIdx) {
        bestIdx = m.index;
        best = s;
      }
    }
    if (best) return best;
    if (/\bx01\b/.test(t)) return "x01";
    return "";
  }

  const X01_VARIANT_KEYS = ["121", "170", "301", "501", "701", "901", "1001", "x01"];

  function modeMatches(filter, detected) {
    if (!filter) return true;
    if (filter === "x01") {
      return X01_VARIANT_KEYS.includes(detected);
    }
    if (!detected) return false;
    return detected === filter;
  }

  function parseRgbChannels(color) {
    const m = String(color || "").match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
    if (!m) return null;
    return [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])];
  }

  /** Erkennt typische gelbe/goldene „Plus“-Rahmen (Chakra / Theme). */
  function isYellowishBorderColor(color) {
    const ch = parseRgbChannels(color);
    if (!ch) return false;
    const [r, g, b] = ch;
    if (![r, g, b].every((x) => Number.isFinite(x))) return false;
    if (r < 155 || g < 130) return false;
    if (b > 155 && r < 215) return false;
    if (r + g - b < 110) return false;
    return true;
  }

  function hasYellowFrame(el) {
    try {
      const s = getComputedStyle(el);
      const bw =
        (parseFloat(s.borderTopWidth) || 0) +
        (parseFloat(s.borderLeftWidth) || 0) +
        (parseFloat(s.outlineWidth) || 0);
      if (bw < 0.5) return false;
      return (
        isYellowishBorderColor(s.borderTopColor) ||
        isYellowishBorderColor(s.borderRightColor) ||
        isYellowishBorderColor(s.borderBottomColor) ||
        isYellowishBorderColor(s.borderLeftColor) ||
        isYellowishBorderColor(s.outlineColor)
      );
    } catch {
      return false;
    }
  }

  /** URL/Attribut-Hinweis auf Autodarts-Plus-Badge (Assets, CDN, Umbenennungen, Hash-Suffixe). */
  function strLooksLikePlusPlayerAsset(s) {
    const blob = String(s || "").toLowerCase();
    if (!blob) return false;
    /* Vite: `/assets/plus-HASH.svg` — nach „plus“ beliebiger Hash/Zeichen bis Extension */
    if (/\/assets\/plus[^?"'\s<>#]*\.(svg|png|webp|avif)(\?|#|$)/i.test(blob)) return true;
    if (/\/assets\/[^?"'\s<>#]*\/plus[^?"'\s<>#]*\.(svg|png|webp|avif)(\?|#|$)/i.test(blob)) return true;
    if (/\bplus[-a-z0-9_.]+\.(svg|png|webp|avif)\b/i.test(blob)) return true;
    if (/[/?._]plus[/?._-]/i.test(blob) && /\.(svg|png|webp|avif)/i.test(blob)) return true;
    if (/plus(?:player|_player|-player|badge|icon|mitglied)/i.test(blob) && /\.(svg|png|webp|avif)/i.test(blob)) return true;
    if (
      /autodarts.*\bplus\b|\bplus\b.*(subscription|premium|abo|member)/i.test(blob) &&
      /\.(svg|png|webp|avif)/i.test(blob)
    ) {
      return true;
    }
    /* Kein reines „premium“/Freitext ohne Bild-URL — sonst false positives (alt, title, aria). */
    return false;
  }

  /**
   * Plus-Abo neben dem Spieler: Chakra z. B. `<img src="/assets/plus-….svg">`,
   * lazy `data-src`, oder CDN-Pfade mit „plus“ im Dateinamen.
   */
  function imgLooksLikeAutodartsPlusPlayer(img) {
    try {
      if (!img || img.tagName !== "IMG") return false;
      let resolvedSrc = "";
      try {
        resolvedSrc = String(img.src || "");
      } catch {
        resolvedSrc = "";
      }
      const parts = [
        img.getAttribute("src"),
        resolvedSrc,
        img.getAttribute("srcset"),
        img.getAttribute("data-src"),
        img.getAttribute("data-lazy-src"),
        img.getAttribute("data-original"),
        img.currentSrc,
        img.alt,
        img.title,
        img.getAttribute("aria-label")
      ];
      for (const p of parts) {
        if (strLooksLikePlusPlayerAsset(p)) return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /** „Lobby beitreten“ / User-Gruppe: 24×24-Icon mit typischen Pfaden — kein Plus-Mitglied-Blitz. */
  function svgExcludedFromPlusMemberGuess(svg) {
    try {
      if (!svg || svg.tagName !== "SVG") return false;
      const host = svg.closest("a, button");
      if (!host) return false;
      const href = String(host.getAttribute("href") || "").trim().toLowerCase();
      const lab = String(host.getAttribute("aria-label") || "").trim().toLowerCase();
      if (href.includes("/lobbies/") && /[a-f0-9-]{24,}/i.test(href.replace(/\/lobbies\//g, ""))) return true;
      if (/^join\s+lobby$|^join\s+lobby\b/i.test(lab) || lab === "join lobby") return true;
      let dBlob = "";
      svg.querySelectorAll("path").forEach((p) => {
        dBlob += String(p.getAttribute("d") || "");
      });
      if (/M22\s*9\s*V7\s*h-2/i.test(dBlob) && /M8\s*12\s*c2\.21/i.test(dBlob)) return true;
      return false;
    } catch {
      return false;
    }
  }

  /** Lucide/Radix/Chakra: kleines Zap/Bolt-SVG neben dem Spielernamen (Plus-Mitglied). */
  function svgLooksLikeLucideZapBolt(svg) {
    try {
      if (!svg || svg.tagName !== "SVG") return false;
      if (svgExcludedFromPlusMemberGuess(svg)) return false;
      const cl = String(svg.getAttribute("class") || "").toLowerCase();
      const id = String(svg.getAttribute("id") || "").toLowerCase();
      const looksLucide =
        /(lucide-zap|lucide-bolt|lucide--zap|lucide--bolt)/.test(cl) || /\blucide\b.*\b(zap|bolt)\b/.test(cl);
      const looksGenericBolt =
        /\b(zap|bolt|lightning|flash|thunder)\b/.test(cl) ||
        /\b(zap|bolt|lightning)\b/.test(id) ||
        /\b(tabler|heroicons|radix|chakra).*\b(bolt|zap|lightning)\b/.test(cl);
      if (!looksLucide && !looksGenericBolt) return false;
      const r = svg.getBoundingClientRect();
      return r.width <= 56 && r.width >= 4 && r.height <= 56 && r.height >= 4;
    } catch {
      return false;
    }
  }

  /** Kleines SVG, das wie Blitz/Plus-Badge aussieht (Lucide o. Ä.) — nicht das Join-Lobby-Personen-Icon. */
  function svgLooksLikePlusBolt(svg) {
    try {
      if (!svg || svg.tagName !== "SVG") return false;
      if (svgExcludedFromPlusMemberGuess(svg)) return false;
      const lab = String(
        svg.getAttribute("aria-label") ||
          svg.getAttribute("title") ||
          svg.closest("[aria-label]")?.getAttribute("aria-label") ||
          svg.closest("[title]")?.getAttribute("title") ||
          ""
      );
      if (/plus\s*player|autodarts\s*plus|plus\s*mitglied|premium\s*player/i.test(lab)) return true;
      const r = svg.getBoundingClientRect();
      if (r.width > 52 || r.height > 52 || r.width < 5 || r.height < 5) return false;
      const vb = String(svg.getAttribute("viewBox") || "").replace(/\s+/g, "");
      const paths = svg.querySelectorAll("path, polyline, polygon");
      if (!paths.length) return false;
      let dlen = 0;
      paths.forEach((p) => {
        dlen += String(p.getAttribute("d") || p.getAttribute("points") || "").length;
      });
      if (dlen < 18 || dlen > 420) return false;
      const looksLikeIconViewBox =
        /\b0\s*,\s*0\s*,\s*(20|22|24|32)\b/.test(String(svg.getAttribute("viewBox") || "")) ||
        vb.includes("002424") ||
        vb.includes("002020") ||
        vb.includes("002222") ||
        vb.includes("002323");
      if (!looksLikeIconViewBox) return false;
      const cl = String(svg.getAttribute("class") || "").toLowerCase();
      const hasBoltHintInClass =
        /\b(lucide|tabler|heroicons|radix)\b/.test(cl) || /\b(zap|bolt|lightning)\b/.test(cl);
      if (!hasBoltHintInClass && !/plus\s*player|autodarts\s*plus|mitglied|premium/i.test(lab)) return false;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Eltern + Geschwister (Icon sitzt oft neben dem Namen).
   * `boundaryRoot` = dieselbe Lobby-`.chakra-card`: niemals darüber hinaus, sonst liegen
   * Geschwister-Lobbys im gleichen Listen-Container und ein einziges Plus-Badge „infiziert“ alle Karten.
   */
  function collectNearbyBoxes(startEl, boundaryRoot) {
    const out = [];
    const seen = new Set();
    const inBounds = (n) => !boundaryRoot || boundaryRoot.contains(n);
    const add = (n) => {
      if (!n || n.nodeType !== 1 || seen.has(n)) return;
      if (!inBounds(n)) return;
      seen.add(n);
      out.push(n);
    };
    let n = startEl;
    for (let d = 0; n && d < 10; d += 1) {
      if (!inBounds(n)) break;
      add(n);
      const p = n.parentElement;
      if (p && inBounds(p)) {
        add(p);
        for (const c of p.children || []) add(c);
      }
      n = p;
      if (p && !inBounds(p)) break;
    }
    return out;
  }

  /**
   * Für „Nur Plus“-Leiste: Lobby hat mind. einen Plus-Mitglied-Spieler, erkennbar an
   * `/assets/plus-….svg`, Blitz-Icon neben dem Namen (chakra-stack), gelbem Rahmen, Aria, …
   */
  function cardHasPlusPlayerForLobbyFilter(card) {
    try {
      if (!card) return false;

      for (const img of card.querySelectorAll("img")) {
        const u = String(img.getAttribute("src") || img.getAttribute("srcset") || img.currentSrc || img.src || "").toLowerCase();
        if ((u.includes("/assets/plus") || u.includes("assets/plus")) && u.includes("svg")) return true;
        if (imgLooksLikeAutodartsPlusPlayer(img)) return true;
      }

      const nameAnchors = card.querySelectorAll(
        "span.ad-ext-player-name p, span.ad-ext-player-name, .ad-ext-player-name p, .ad-ext-player-name"
      );
      const seenScope = new Set();
      for (const anchor of nameAnchors) {
        const nm = String(anchor.textContent || "").trim();
        if (!isPlayerName(nm)) continue;

        let scope = anchor.closest(".chakra-stack");
        if (!scope || !card.contains(scope)) {
          let n = anchor;
          for (let i = 0; i < 8 && n && card.contains(n); i++, n = n.parentElement) {
            const sub = String(n.innerHTML || "");
            if (/\/assets\/plus[^"']*\.svg/i.test(sub) && n.querySelector?.(".ad-ext-player-name, p.chakra-text")) {
              scope = n;
              break;
            }
          }
        }
        if (!scope || !card.contains(scope) || seenScope.has(scope)) continue;
        seenScope.add(scope);

        const block = String(scope.innerHTML || "");
        if (/\/assets\/plus[^"']*\.svg/i.test(block)) return true;
        if (/\u26a1|⚡/.test(String(scope.textContent || ""))) return true;

        for (const svg of scope.querySelectorAll("svg")) {
          if (svgLooksLikeLucideZapBolt(svg) || svgLooksLikePlusBolt(svg)) return true;
        }
        for (const img of scope.querySelectorAll("img")) {
          if (imgLooksLikeAutodartsPlusPlayer(img)) return true;
        }
        for (const useEl of scope.querySelectorAll("use")) {
          const href = String(useEl.getAttribute("href") || useEl.getAttribute("xlink:href") || "").toLowerCase();
          /* Wortgrenzen: „flash“ darf nicht „flashlight“ treffen. */
          if (/\b(bolt|zap|lightning|spark)\b/i.test(href)) return true;
          if (/\bflash\b/i.test(href) && !/flashlight/i.test(href)) return true;
        }
      }

      const html = String(card.innerHTML || "");
      if (/aria-label=["'][^"']*(plus\s*player|autodarts\s*plus|plus\s*mitglied|plus-mitglied|autodartsplus)/i.test(html)) {
        return true;
      }
      if (/\/assets\/(?:[^/"'\s>]+\/)?plus[^"'\s>]*\.(svg|png|webp)/i.test(html)) return true;
      if (/data-(?:src|lazy-src)=["'][^"']*plus[^"']*\.(svg|png|webp)/i.test(html)) return true;

      const seeds = getAllPlayerNameCandidates(card);
      for (const nameEl of seeds) {
        const start = nameEl.nodeType === 1 ? nameEl : nameEl.parentElement;
        if (!start) continue;
        for (const box of collectNearbyBoxes(start, card)) {
          /* Kein hasYellowFrame hier: Theme-Rahmen/Warning-Farben treffen oft ohne Plus-Badge zu. */
          for (const svg of box.querySelectorAll("svg")) {
            if (svgLooksLikeLucideZapBolt(svg) || svgLooksLikePlusBolt(svg)) return true;
          }
          for (const img of box.querySelectorAll("img")) {
            if (imgLooksLikeAutodartsPlusPlayer(img)) return true;
          }
        }
      }

      for (const el of card.querySelectorAll("[role='img'][aria-label]")) {
        const lab = String(el.getAttribute("aria-label") || "").toLowerCase();
        if (/plus\s*player|autodarts\s*plus|plus\s*mitglied|premium\s*player/.test(lab)) return true;
        if (/\bplus\b/.test(lab) && /\bsubscription\b/.test(lab)) return true;
      }
    } catch {
      /* ignore */
    }
    return false;
  }

  /**
   * Plus-Lobby / Plus-Spieler (weichere Heuristik inkl. ⚡ im Kartentext), z. B. für künftige Features.
   * Die **Filter-Leiste „Nur Plus“** nutzt nur `cardHasPlusPlayerForLobbyFilter`.
   */
  function detectPlusPlayerLightning(card) {
    if (cardHasPlusPlayerForLobbyFilter(card)) return true;
    try {
      if (card && /\u26a1|⚡/.test(String(card.innerText || ""))) return true;
    } catch {
      /* ignore */
    }
    return false;
  }

  /**
   * Avg-Werte wie „50+“: oft als `span.chakra-badge` neben `span.ad-ext-player-name`,
   * zusätzlich Fallback über gesamten Kartentext (\d{2,3}+).
   */
  function extractPlayerAvgsFromCard(card) {
    try {
      const seen = new Set();
      const push = (n) => {
        if (!Number.isFinite(n)) return;
        if (n >= 20 && n <= 199) seen.add(n);
      };
      for (const el of card.querySelectorAll(".chakra-badge, [class*='chakra-badge']")) {
        const raw = String(el.textContent || "").trim();
        let m = raw.match(/^(\d{2,3})\s*\+$/);
        if (m) {
          push(parseInt(m[1], 10));
          continue;
        }
        m = raw.match(/\b(\d{2,3})\s*\+/);
        if (m) push(parseInt(m[1], 10));
      }
      const text = getCardFlatText(card);
      const re = /\b(\d{2,3})\s*\+/g;
      let m;
      while ((m = re.exec(text)) !== null) {
        push(parseInt(m[1], 10));
      }
      return [...seen];
    } catch {
      return [];
    }
  }

  function avgFilterMatches(card) {
    let minV = STATE.minAvg;
    let maxV = STATE.maxAvg;
    if (minV == null && maxV == null) return true;
    if (minV != null && maxV != null && minV > maxV) {
      const x = minV;
      minV = maxV;
      maxV = x;
    }
    const avgs = extractPlayerAvgsFromCard(card);
    if (!avgs.length) return false;
    return avgs.some((a) => (minV == null || a >= minV) && (maxV == null || a <= maxV));
  }

  /** „First to 3 Legs“, „First to 3L“ u. Ä. aus Kartentext (1–11). */
  function detectFirstToLegsCount(text) {
    const t = String(text || "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
    let m = t.match(/\bfirst\s+to\s+(\d{1,2})\s*leg[s]?\b/);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n >= 1 && n <= 11) return n;
    }
    m = t.match(/\bfirst\s+to\s+(\d{1,2})\s*l\b/);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n >= 1 && n <= 11) return n;
    }
    return null;
  }

  function legsFilterMatches(filterN, flatText) {
    if (filterN == null) return true;
    const d = detectFirstToLegsCount(flatText);
    if (d == null) return false;
    return d === filterN;
  }

  function legsSelectOptionsHtml() {
    const parts = [`<option value="">${escHtml(admBarT("lobbyfilter_plus_any"))}</option>`];
    for (let n = 1; n <= 11; n += 1) {
      const lab = n === 1 ? admBarT("lobbyfilter_bar_legs_ft_one") : admBarT("lobbyfilter_bar_legs_ft_n", { n });
      parts.push(`<option value="${n}">${escHtml(lab)}</option>`);
    }
    return parts.join("");
  }

  function playerCountSelectOptionsHtml() {
    const parts = [`<option value="">${escHtml(admBarT("lobbyfilter_plus_any"))}</option>`];
    for (let n = 1; n <= MAX_LOBBY_PLAYER_SLOTS; n += 1) {
      parts.push(`<option value="${n}">${n}</option>`);
    }
    return parts.join("");
  }

  function playerCountMatches(filterN, nPlayers) {
    if (filterN == null) return true;
    return nPlayers === filterN;
  }

  function lobbyAvgSelectOptionsHtml() {
    const parts = ['<option value="">—</option>'];
    for (let n = AVG_DROPDOWN_MIN; n <= AVG_DROPDOWN_MAX; n += AVG_DROPDOWN_STEP) {
      parts.push(`<option value="${n}">${n}</option>`);
    }
    return parts.join("");
  }

  function parseAvgSelectValue(raw) {
    const t = String(raw ?? "").trim();
    if (!t) return null;
    const n = parseInt(t, 10);
    if (!Number.isFinite(n) || n < AVG_DROPDOWN_MIN || n > AVG_DROPDOWN_MAX || n % AVG_DROPDOWN_STEP !== 0) return null;
    return n;
  }

  /**
   * Straight=0, Double=1, Master=2, unbekannt=9.
   * Erkennt DE/EN-Kurzformen (SI/DI/MI, SO/DO/MO) und Wörter.
   */
  function parseInOutRanks(text) {
    const t = text.replace(/\s+/g, " ").toLowerCase();
    let inRank = 9;
    let outRank = 9;

    const tryIn = [
      [/master\s*(in|ein)|\bmi\b|einwurf\s*master/, 2],
      [/double\s*(in|ein)|doppel\s*(in|ein)|\bdi\b|doppelte\s*ein/, 1],
      [/straight\s*(in|ein)|\bsi\b|gerade\s*(in|ein)|einwurf\s*straight/, 0]
    ];
    for (const [re, rank] of tryIn) {
      if (re.test(t)) {
        inRank = rank;
        break;
      }
    }

    const tryOut = [
      [/master\s*(out|aus)|\bmo\b|auswurf\s*master/, 2],
      [/double\s*(out|aus)|doppel\s*(out|aus)|\bdo\b|doppelte\s*aus/, 1],
      [/straight\s*(out|aus)|\bso\b|gerade\s*(out|aus)|auswurf\s*straight/, 0]
    ];
    for (const [re, rank] of tryOut) {
      if (re.test(t)) {
        outRank = rank;
        break;
      }
    }

    return { inRank, outRank, sortKey: inRank * 100 + outRank };
  }

  function clearCardOrder(cards) {
    cards.forEach((c) => {
      try {
        c.style.removeProperty("order");
      } catch {
        /* ignore */
      }
    });
  }

  /** Warteschlange: parallele get→set-Zyklen überschreiben sich sonst gegenseitig (Modus vs. Suche). */
  let settingsWriteChain = Promise.resolve();

  function mergeSettingsInStorage(partial) {
    if (!chrome?.storage?.local) return Promise.resolve(null);
    const step = new Promise((resolve) => {
      try {
        chrome.storage.local.get(["settings"], (items) => {
          if (chrome.runtime.lastError) {
            resolve(null);
            return;
          }
          const settings = { ...(items?.settings || {}), ...partial };
          chrome.storage.local.set({ settings }, () => {
            void chrome.runtime.lastError;
            resolve(settings);
          });
        });
      } catch {
        resolve(null);
      }
    });
    settingsWriteChain = settingsWriteChain.then(() => step).catch(() => null);
    return settingsWriteChain;
  }

  function persistBarPartial(partial) {
    void mergeSettingsInStorage(partial);
  }

  function findLobbiesTitleEl() {
    const nodes = document.querySelectorAll('main h1, main h2, h1, h2, [role="heading"]');
    for (const el of nodes) {
      const t = String(el.textContent || "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
      if (t === "lobbys" || t === "lobbies") return el;
      if (t.startsWith("lobbys ") || t.startsWith("lobbies ")) return el;
      if (/\boffene\s+lobbys\b/.test(t) || /\bopen\s+lobbies\b/.test(t)) return el;
      if (/\blobby[\s-]?browser\b/.test(t) || /\blobby[\s-]?liste\b/.test(t)) return el;
    }
    const main = document.querySelector("main");
    return main?.querySelector("h1, h2") || null;
  }

  /** Packt die Seiten-Überschrift und die Leiste in eine gemeinsame Flex-Zeile. */
  function ensureHeadingWrap(title) {
    if (!title?.parentNode) return null;
    const p = title.parentElement;
    if (p?.classList?.contains(HEADING_WRAP_CLASS)) return p;
    const wrap = document.createElement("div");
    wrap.className = HEADING_WRAP_CLASS;
    wrap.setAttribute("data-adm-lobbyfilter-heading-wrap", "1");
    title.parentNode.insertBefore(wrap, title);
    wrap.appendChild(title);
    return wrap;
  }

  function unwrapHeadingWrapIfOrphaned(wrap) {
    if (!wrap?.getAttribute?.("data-adm-lobbyfilter-heading-wrap")) return;
    if (wrap.querySelector(`#${BAR_ID}`)) return;
    removeLegacyHeadingTrail();
    const kids = Array.from(wrap.children);
    const heading = kids.find((n) => n.matches?.("h1, h2"));
    if (!heading || kids.length !== 1) return;
    wrap.parentNode?.insertBefore(heading, wrap);
    wrap.remove();
  }

  function mountBarAfterLobbysHeading(bar) {
    const title = findLobbiesTitleEl();
    if (title?.parentNode) {
      const wrap = ensureHeadingWrap(title);
      if (wrap) {
        wrap.appendChild(bar);
        title.after(bar);
        removeLegacyHeadingTrail();
      } else {
        title.parentNode.insertBefore(bar, title.nextSibling);
      }
    } else {
      const main = document.querySelector("main") || document.body;
      main.insertBefore(bar, main.firstChild);
    }
  }

  /** Solange Fokus in der Lobby-Leiste liegt, keine programmatischen Bar-Updates (sonst schließen native Select-Dropdowns). */
  function isFocusInsideLobbyBar() {
    try {
      const bar = document.getElementById(BAR_ID);
      const ae = document.activeElement;
      if (!ae || ae === document.body) return false;
      if (bar?.contains(ae)) return true;
      return false;
    } catch {
      return false;
    }
  }

  function repositionBarIfNeeded(bar) {
    const el = bar || document.getElementById(BAR_ID);
    if (!el || !document.body.contains(el)) return;
    const title = findLobbiesTitleEl();
    if (!title?.parentNode) return;
    const wrap = ensureHeadingWrap(title);
    if (wrap) {
      if (el.parentNode !== wrap) wrap.appendChild(el);
      if (el.previousElementSibling !== title) title.after(el);
      removeLegacyHeadingTrail();
    } else if (el.previousElementSibling !== title) {
      title.parentNode.insertBefore(el, title.nextSibling);
    }
  }

  let lobbyFilterThemeCascadeHooked = false;

  /**
   * Lobbyfilter-Styles sollen **nach** allen üblichen Theme-/Modul-`<style>`-Knoten kommen:
   * Styles am Ende von `<body>` stehen in der Kaskade hinter dem gesamten `<head>` und schlagen
   * gleich spezifische Regeln aus anderen Erweiterungs-Styles.
   */
  function ensureLobbyFilterStyleWinsCascade() {
    try {
      const el = document.getElementById(STYLE_ID);
      if (!el) return;
      const body = document.body;
      if (body) {
        if (body.lastElementChild !== el) body.appendChild(el);
        return;
      }
      const head = document.head;
      if (head && head.lastElementChild !== el) head.appendChild(el);
    } catch {
      /* ignore */
    }
  }

  /** Theme (#adm-webdesign-style) und andere Module: bei Updates Style-Knoten wieder ans Ende (body bevorzugt). */
  function setupLobbyFilterStyleAfterTheme() {
    if (lobbyFilterThemeCascadeHooked) return;
    const head = document.head;
    if (!head) return;
    lobbyFilterThemeCascadeHooked = true;
    const bump = () => ensureLobbyFilterStyleWinsCascade();
    const hookThemeNode = (node) => {
      if (!(node instanceof HTMLStyleElement)) return;
      if (node.id !== WEBSITE_THEME_STYLE_ID) return;
      if (node.dataset.admLfAfterThemeObs) return;
      node.dataset.admLfAfterThemeObs = "1";
      new MutationObserver(bump).observe(node, { childList: true, characterData: true, subtree: true });
      bump();
    };
    const scanHead = () => {
      const t = document.getElementById(WEBSITE_THEME_STYLE_ID);
      if (t) hookThemeNode(t);
      bump();
    };
    new MutationObserver(scanHead).observe(head, { childList: true });
    const attachBodyObserver = () => {
      const b = document.body;
      if (!b || b.dataset.admLfStyleOrderObs === "1") return;
      b.dataset.admLfStyleOrderObs = "1";
      new MutationObserver(bump).observe(b, { childList: true });
      bump();
    };
    if (document.body) attachBodyObserver();
    else document.addEventListener("DOMContentLoaded", attachBodyObserver, { once: true });
    scanHead();
  }

  /**
   * Wiederholte `.klassen` erhöhen die CSS-Spezifität (Element braucht die Klasse nur einmal).
   * Website-Theme-Packs nutzen oft `html body… div#root … div.chakra-card… .css-xxxxx` + `!important`.
   */
  function lfClassChain(classBase, total = 16) {
    const cls = String(classBase || "").replace(/^\./, "");
    if (!cls) return "";
    const n = Math.min(28, Math.max(6, Number(total) || 16));
    let out = "";
    for (let i = 0; i < n; i += 1) out += `.${cls}`;
    return out;
  }

  /**
   * Lobby-Karten: hohe Spezifität gegen Theme-Packs (`div#root … .chakra-card… !important`).
   * Zusätzlich Varianten **ohne** `<main>`: Viele React-Aufbauten hängen die Liste nur unter `#root`.
   */
  function lfChakraLobbyCardSelectors(classChainOnCard) {
    const x = String(classChainOnCard || "");
    return [
      `html body.chakra-ui-dark div#root main .chakra-card${x}`,
      `html body.chakra-ui-light div#root main .chakra-card${x}`,
      `html body div#root main .chakra-card${x}`,
      `html body.chakra-ui-dark div#root .chakra-card${x}`,
      `html body.chakra-ui-light div#root .chakra-card${x}`,
      `html body div#root .chakra-card${x}`,
      `html body main .chakra-card${x}`,
    ].join(",\n      ");
  }

  /** Namens-Markierung (Blacklist/Favoriten): Präfixe mit/ohne `main` unter `#root`. */
  function lfNameHitColorSelectors(hitClass, favVariant) {
    const ch = lfClassChain(hitClass, 16);
    const pres = [
      "html body.chakra-ui-dark div#root main",
      "html body.chakra-ui-light div#root main",
      "html body div#root main",
      "html body.chakra-ui-dark div#root",
      "html body.chakra-ui-light div#root",
      "html body div#root",
      "html body main",
    ];
    const suf = favVariant ? `:not(.${NAME_HIT_BL_CLASS})` : "";
    const bits = [];
    for (const pre of pres) {
      bits.push(`${pre} ${ch}${suf}`);
      bits.push(`${pre} p${ch}${suf}`);
      bits.push(`${pre} span${ch}${suf}`);
      bits.push(`${pre} .chakra-text${ch}${suf}`);
      bits.push(`${pre} [class*="chakra-text"]${ch}${suf}`);
    }
    return bits.join(",\n      ");
  }

  function injectStyle() {
    const legacyStyle = document.getElementById("adm-lobbyfilter-style");
    if (legacyStyle) legacyStyle.remove();
    const prevV2 = document.getElementById("adm-lobbyfilter-style-v2");
    if (prevV2) prevV2.remove();
    const prevV3 = document.getElementById("adm-lobbyfilter-style-v3");
    if (prevV3) prevV3.remove();
    const prevV4 = document.getElementById("adm-lobbyfilter-style-v4");
    if (prevV4) prevV4.remove();
    const prevV5 = document.getElementById("adm-lobbyfilter-style-v5");
    if (prevV5) prevV5.remove();
    const prevV6 = document.getElementById("adm-lobbyfilter-style-v6");
    if (prevV6) prevV6.remove();
    const prevV7 = document.getElementById("adm-lobbyfilter-style-v7");
    if (prevV7) prevV7.remove();
    const prevV8 = document.getElementById("adm-lobbyfilter-style-v8");
    if (prevV8) prevV8.remove();
    const prevV9 = document.getElementById("adm-lobbyfilter-style-v9");
    if (prevV9) prevV9.remove();
    const prevV10 = document.getElementById("adm-lobbyfilter-style-v10");
    if (prevV10) prevV10.remove();
    const prevV11 = document.getElementById("adm-lobbyfilter-style-v11");
    if (prevV11) prevV11.remove();
    const prevV12 = document.getElementById("adm-lobbyfilter-style-v12");
    if (prevV12) prevV12.remove();
    const prevV13 = document.getElementById("adm-lobbyfilter-style-v13");
    if (prevV13) prevV13.remove();
    const prevV14 = document.getElementById("adm-lobbyfilter-style-v14");
    if (prevV14) prevV14.remove();
    const prevV15 = document.getElementById("adm-lobbyfilter-style-v15");
    if (prevV15) prevV15.remove();
    const prevV16 = document.getElementById("adm-lobbyfilter-style-v16");
    if (prevV16) prevV16.remove();
    const prevV17 = document.getElementById("adm-lobbyfilter-style-v17");
    if (prevV17) prevV17.remove();
    const prevV18 = document.getElementById("adm-lobbyfilter-style-v18");
    if (prevV18) prevV18.remove();
    const prevV19 = document.getElementById("adm-lobbyfilter-style-v19");
    if (prevV19) prevV19.remove();
    const prevV20 = document.getElementById("adm-lobbyfilter-style-v20");
    if (prevV20) prevV20.remove();
    const prevV21 = document.getElementById("adm-lobbyfilter-style-v21");
    if (prevV21) prevV21.remove();
    const prevV22 = document.getElementById("adm-lobbyfilter-style-v22");
    if (prevV22) prevV22.remove();
    const prevV23 = document.getElementById("adm-lobbyfilter-style-v23");
    if (prevV23) prevV23.remove();
    const prevV24 = document.getElementById("adm-lobbyfilter-style-v24");
    if (prevV24) prevV24.remove();
    const prevV25 = document.getElementById("adm-lobbyfilter-style-v25");
    if (prevV25) prevV25.remove();
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .adm-lf-card-hidden {
        display: none !important;
      }
      ${lfChakraLobbyCardSelectors(lfClassChain(CARD_BL_HIT_CLASS))} {
        --adm-lf-bl-hit-h: var(--adm-lf-bl-h, 0);
        box-sizing: border-box;
        box-shadow:
          inset 0 0 0 1px hsla(var(--adm-lf-bl-hit-h), 58%, 55%, 0.42),
          inset 5px 0 0 0 hsl(var(--adm-lf-bl-hit-h), 68%, 48%) !important;
        background-color: hsla(var(--adm-lf-bl-hit-h), 42%, 48%, 0.11) !important;
        background-image: linear-gradient(
          90deg,
          hsla(var(--adm-lf-bl-hit-h), 48%, 46%, 0.2),
          transparent min(75%, 26rem)
        ) !important;
        border-radius: inherit !important;
      }
      ${lfChakraLobbyCardSelectors(lfClassChain(CARD_FAV_HIT_CLASS))} {
        --adm-lf-fav-hit-h: var(--adm-lf-fav-h, 120);
        box-sizing: border-box;
        box-shadow:
          inset 0 0 0 1px hsla(var(--adm-lf-fav-hit-h), 58%, 55%, 0.42),
          inset 5px 0 0 0 hsl(var(--adm-lf-fav-hit-h), 68%, 48%) !important;
        background-color: hsla(var(--adm-lf-fav-hit-h), 42%, 48%, 0.11) !important;
        background-image: linear-gradient(
          90deg,
          hsla(var(--adm-lf-fav-hit-h), 48%, 46%, 0.2),
          transparent min(75%, 26rem)
        ) !important;
        border-radius: inherit !important;
      }
      ${lfChakraLobbyCardSelectors(`${lfClassChain(CARD_BL_HIT_CLASS, 10)}${lfClassChain(CARD_FAV_HIT_CLASS, 10)}`)} {
        --adm-lf-bl-hit-h: var(--adm-lf-bl-h, 0);
        --adm-lf-fav-hit-h: var(--adm-lf-fav-h, 120);
        box-shadow:
          inset 0 0 0 1px hsla(var(--adm-lf-bl-hit-h), 48%, 50%, 0.38),
          inset 5px 0 0 0 hsl(var(--adm-lf-bl-hit-h), 68%, 48%),
          inset 10px 0 0 0 hsl(var(--adm-lf-fav-hit-h), 68%, 48%) !important;
        background-color: hsla(var(--adm-lf-bl-hit-h), 34%, 44%, 0.09) !important;
        background-image: linear-gradient(
          90deg,
          hsla(var(--adm-lf-bl-hit-h), 46%, 44%, 0.16),
          hsla(var(--adm-lf-fav-hit-h), 46%, 42%, 0.14) min(38%, 14rem),
          transparent min(75%, 26rem)
        ) !important;
        border-radius: inherit !important;
      }
      ${lfNameHitColorSelectors(NAME_HIT_BL_CLASS, false)} {
        color: hsl(var(--adm-lf-bl-h, 0), 78%, 70%) !important;
        -webkit-text-fill-color: hsl(var(--adm-lf-bl-h, 0), 78%, 70%) !important;
        font-weight: 650 !important;
        text-shadow: 0 0 14px hsla(var(--adm-lf-bl-h, 0), 85%, 48%, 0.45) !important;
      }
      ${lfNameHitColorSelectors(NAME_HIT_FAV_CLASS, true)} {
        color: hsl(var(--adm-lf-fav-h, 120), 76%, 66%) !important;
        -webkit-text-fill-color: hsl(var(--adm-lf-fav-h, 120), 76%, 66%) !important;
        font-weight: 650 !important;
        text-shadow: 0 0 14px hsla(var(--adm-lf-fav-h, 120), 80%, 42%, 0.42) !important;
      }
      ${lfChakraLobbyCardSelectors(lfClassChain(CARD_EMPTY_HIT_CLASS))} {
        --adm-lf-empty-hit-h: var(--adm-lf-empty-h, 210);
        outline: 2px dashed hsla(var(--adm-lf-empty-hit-h), 70%, 58%, 0.9) !important;
        outline-offset: -3px;
      }
      .${HEADING_WRAP_CLASS} {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        align-items: center;
        column-gap: 5px;
        row-gap: 0;
        width: 100%;
        min-width: 0;
        margin: 0 0 -6px 0;
        padding: 0;
        box-sizing: border-box;
      }
      .${HEADING_WRAP_CLASS} > h1,
      .${HEADING_WRAP_CLASS} > h2 {
        grid-column: 1;
        grid-row: 1;
        margin: 0;
        padding: 0 4px 0 0;
        line-height: 1.12;
        align-self: center;
        white-space: nowrap;
      }
      #${BAR_ID} {
        position: relative;
        z-index: 4;
        display: block;
        width: max-content;
        max-width: 100%;
        margin: 0;
        padding: 0;
        box-sizing: border-box;
        color-scheme: dark;
        background: transparent !important;
        border: none !important;
        border-bottom: 1px solid rgba(255,255,255,.1) !important;
        box-shadow: none !important;
        backdrop-filter: none !important;
        color: #eaf1ff !important;
        font-family: system-ui, "Segoe UI", sans-serif !important;
        font-size: 11px;
        line-height: 1.2;
      }
      .${HEADING_WRAP_CLASS} #${BAR_ID} {
        grid-column: 2;
        grid-row: 1;
        justify-self: stretch;
        align-self: center;
        min-width: 0;
        width: 100%;
        max-width: 100%;
        margin: 0;
        padding-top: 0;
        border-bottom: none;
      }
      #${BAR_ID}[hidden] { display: none !important; }
      #${BAR_ID} .adm-lf-rows {
        display: flex;
        flex-direction: row;
        align-items: flex-end;
        flex-wrap: wrap;
        justify-content: flex-start;
        gap: 3px 5px;
        width: 100%;
        max-width: 100%;
        min-width: 0;
        box-sizing: border-box;
      }
      #${BAR_ID} .adm-lf-bar-main {
        display: flex;
        flex-direction: row;
        flex: 1 1 auto;
        min-width: 0;
        align-items: stretch;
      }
      #${BAR_ID} .adm-lf-bar-main .adm-lf-row {
        flex: 1 1 auto;
        width: 100%;
        min-width: 0;
      }
      #${BAR_ID} .adm-lf-row {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-end;
        gap: 2px 5px;
        width: 100%;
        max-width: 100%;
        min-width: 0;
        overflow-x: auto;
        overflow-y: visible;
        padding: 0;
        box-sizing: border-box;
        -webkit-overflow-scrolling: touch;
        scrollbar-width: thin;
      }
      #${BAR_ID} .adm-lf-row--single {
        flex-wrap: nowrap;
        align-items: flex-end;
      }
      #${BAR_ID} .adm-lf-row--single .adm-lf-field--sort {
        flex: 0 0 auto;
        width: 102px;
        min-width: 86px;
        border-left: 1px solid rgba(255, 255, 255, 0.12);
        padding-left: 6px;
        margin-left: 4px;
        box-sizing: border-box;
      }
      #${BAR_ID} .adm-lf-row--single .adm-lf-field--sort .adm-lf-select {
        width: 100%;
        max-width: none;
      }
      #${BAR_ID} .adm-lf-row--single .adm-lf-field--search {
        flex: 1 1 120px;
        min-width: 72px;
        max-width: 220px;
      }
      #${BAR_ID} .adm-lf-row--single .adm-lf-field--search input[type="search"] {
        width: 100%;
        max-width: none;
      }
      #${BAR_ID} .adm-lf-row--single .adm-lf-field--plus {
        flex: 0 0 auto;
        border-left: 1px solid rgba(255, 255, 255, 0.12);
        padding-left: 6px;
        margin-left: 4px;
      }
      #${BAR_ID} .adm-lf-row--single .adm-lf-field--counter-reset {
        flex: 0 0 auto;
        margin-left: auto;
        align-items: flex-end;
        border-left: 1px solid rgba(255, 255, 255, 0.12);
        padding-left: 8px;
        padding-right: 2px;
        margin-right: 0;
      }
      #${BAR_ID} .adm-lf-field--counter-reset .adm-lf-label-placeholder {
        visibility: hidden;
        font-size: 9px;
        line-height: 1.15;
        margin: 0;
        padding: 0;
        min-height: 11px;
        user-select: none;
      }
      #${BAR_ID} .adm-lf-counter-reset-row {
        display: flex;
        flex-direction: row;
        align-items: center;
        justify-content: flex-end;
        gap: 6px;
        flex-wrap: nowrap;
        min-height: 26px;
        text-align: right;
      }
      #${BAR_ID} .adm-lf-row::-webkit-scrollbar {
        height: 4px;
      }
      #${BAR_ID} .adm-lf-row::-webkit-scrollbar-thumb {
        background: rgba(255,255,255,.22);
        border-radius: 4px;
      }
      #${BAR_ID} .adm-lf-field {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
        flex: 0 1 auto;
      }
      #${BAR_ID} .adm-lf-field.adm-lf-numinp {
        flex: 0 0 auto;
        width: 64px;
      }
      #${BAR_ID} .adm-lf-field.adm-lf-numinp .adm-lf-select {
        width: 100%;
        max-width: none;
      }
      #${BAR_ID} .adm-lf-field label {
        font-size: 9px;
        letter-spacing: .04em;
        text-transform: uppercase;
        color: rgba(234,241,255,.55) !important;
        -webkit-text-fill-color: rgba(234,241,255,.55) !important;
        white-space: nowrap;
      }
      #${BAR_ID} input[type="search"] {
        min-width: 0;
        box-sizing: border-box;
        padding: 4px 7px;
        border-radius: 6px !important;
        border: 1px solid rgba(255,255,255,.2) !important;
        background-color: rgba(12, 18, 30, 0.92) !important;
        color: #eaf1ff !important;
        -webkit-text-fill-color: #eaf1ff !important;
        font-size: 11px;
        outline: none;
      }
      #${BAR_ID} input[type="search"]::placeholder {
        color: rgba(234,241,255,.4) !important;
      }
      #${BAR_ID} .adm-lf-select {
        box-sizing: border-box;
        min-width: 0;
        max-width: 140px;
        padding: 4px 22px 4px 6px;
        border-radius: 6px !important;
        border: 1px solid rgba(255,255,255,.2) !important;
        background-color: rgba(12, 18, 30, 0.92) !important;
        background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23b8c5dc' d='M2.5 4.25L6 7.75l3.5-3.5'/%3E%3C/svg%3E") !important;
        background-repeat: no-repeat !important;
        background-position: right 6px center !important;
        background-size: 11px 11px !important;
        color: #eaf1ff !important;
        -webkit-text-fill-color: #eaf1ff !important;
        font-size: 11px;
        color-scheme: dark;
        -webkit-appearance: none;
        appearance: none;
        cursor: pointer;
      }
      #${BAR_ID} .adm-lf-select:hover {
        border-color: rgba(255,255,255,.3) !important;
        background-color: rgba(16, 24, 40, 0.95) !important;
      }
      #${BAR_ID} .adm-lf-select:focus {
        outline: none !important;
        border-color: rgba(100, 180, 255, .45) !important;
        box-shadow: 0 0 0 2px rgba(100, 180, 255, .12) !important;
      }
      #${BAR_ID} .adm-lf-select option {
        background-color: #0f1522 !important;
        color: #eaf1ff !important;
      }
      #${BAR_ID} .adm-lf-toggle-field {
        flex-direction: row;
        align-items: center;
        gap: 8px;
        padding-bottom: 0;
      }
      #${BAR_ID} .adm-lf-toggle-field > label:first-child {
        margin: 0;
        text-transform: none;
        font-size: 11px;
        color: rgba(234,241,255,.75) !important;
        -webkit-text-fill-color: rgba(234,241,255,.75) !important;
      }
      #${BAR_ID} .adm-lf-switch,
      .${HEADING_WRAP_CLASS} .adm-lf-switch {
        position: relative;
        display: inline-block;
        width: 38px;
        height: 22px;
        flex-shrink: 0;
      }
      #${BAR_ID} .adm-lf-switch input,
      .${HEADING_WRAP_CLASS} .adm-lf-switch input {
        opacity: 0;
        width: 0;
        height: 0;
        position: absolute;
      }
      #${BAR_ID} .adm-lf-switch .adm-lf-slider,
      .${HEADING_WRAP_CLASS} .adm-lf-switch .adm-lf-slider {
        position: absolute;
        cursor: pointer;
        inset: 0;
        background: rgba(255,255,255,.18);
        border-radius: 999px;
        transition: background 0.18s ease;
      }
      #${BAR_ID} .adm-lf-switch .adm-lf-slider::before,
      .${HEADING_WRAP_CLASS} .adm-lf-switch .adm-lf-slider::before {
        content: "";
        position: absolute;
        height: 16px;
        width: 16px;
        left: 3px;
        bottom: 3px;
        background: #f0f4ff;
        border-radius: 50%;
        transition: transform 0.18s ease;
      }
      #${BAR_ID} .adm-lf-switch input:checked + .adm-lf-slider,
      .${HEADING_WRAP_CLASS} .adm-lf-switch input:checked + .adm-lf-slider {
        background: rgba(90, 200, 130, 0.45);
      }
      #${BAR_ID} .adm-lf-switch input:checked + .adm-lf-slider::before,
      .${HEADING_WRAP_CLASS} .adm-lf-switch input:checked + .adm-lf-slider::before {
        transform: translateX(16px);
      }
      #${COUNTER_ID}.adm-lf-counter-stack {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 2px;
        font-variant-numeric: tabular-nums;
        color: rgba(234,241,255,.75) !important;
        -webkit-text-fill-color: rgba(234,241,255,.75) !important;
        font-size: 11px;
        line-height: 1.2;
        padding: 2px 0;
      }
      #${COUNTER_ID} .adm-lf-counter-empty-line {
        font-size: 11px;
        line-height: 1.2;
        color: rgba(234,241,255,.75) !important;
        -webkit-text-fill-color: rgba(234,241,255,.75) !important;
        white-space: nowrap;
        font-variant-numeric: tabular-nums;
      }
      #${COUNTER_ID} .adm-lf-counter-visible-line {
        font-size: 11px;
        line-height: 1.2;
        color: rgba(234,241,255,.75) !important;
        -webkit-text-fill-color: rgba(234,241,255,.75) !important;
        white-space: nowrap;
        font-variant-numeric: tabular-nums;
      }
      #${COUNTER_ID} .adm-lf-num {
        font-weight: 700;
      }
      #${COUNTER_ID} .adm-lf-num--ok {
        color: #68d391 !important;
        -webkit-text-fill-color: #68d391 !important;
      }
      #${COUNTER_ID} .adm-lf-num--warn {
        color: #ecc94b !important;
        -webkit-text-fill-color: #ecc94b !important;
      }
      #${COUNTER_ID} .adm-lf-num--alert {
        color: #fc8181 !important;
        -webkit-text-fill-color: #fc8181 !important;
      }
      #${BAR_ID} .adm-lf-reset,
      .${HEADING_WRAP_CLASS} .adm-lf-reset {
        flex-shrink: 0;
        padding: 5px 10px;
        border-radius: 8px !important;
        border: 1px solid rgba(255,255,255,.22) !important;
        background: rgba(255,255,255,.06) !important;
        color: rgba(234,241,255,.88) !important;
        -webkit-text-fill-color: rgba(234,241,255,.88) !important;
        font-size: 11px;
        cursor: pointer;
        font-family: inherit !important;
      }
      #${BAR_ID} .adm-lf-reset:hover,
      .${HEADING_WRAP_CLASS} .adm-lf-reset:hover {
        border-color: rgba(255,255,255,.35) !important;
        background: rgba(255,255,255,.1) !important;
      }
      /* Lobby-Dauer: Chakra-/Autodarts-nah (dezent wie Secondary-Badge, keine Extension-Farben) */
      .${JOIN_AGE_CLASS} {
        box-sizing: border-box;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        vertical-align: middle;
        white-space: nowrap;
        margin-inline-end: 0.45rem;
        padding: 0 0.45rem;
        min-height: 1.5rem;
        font-family: inherit;
        font-size: 0.75rem;
        font-weight: 500;
        line-height: 1.25;
        letter-spacing: 0.01em;
        font-variant-numeric: tabular-nums;
        border-radius: var(--chakra-radii-md, 0.375rem);
        color: var(--chakra-colors-gray-200, rgba(237, 242, 247, 0.92));
        background: var(--chakra-colors-whiteAlpha-200, rgba(255, 255, 255, 0.06));
        border: 1px solid var(--chakra-colors-whiteAlpha-300, rgba(255, 255, 255, 0.12));
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
      }
      .${JOIN_AGE_CLASS}.adm-lf-join-age--mid {
        color: var(--chakra-colors-gray-100, rgba(247, 250, 252, 0.95));
        background: var(--chakra-colors-whiteAlpha-300, rgba(255, 255, 255, 0.09));
        border-color: var(--chakra-colors-whiteAlpha-400, rgba(255, 255, 255, 0.16));
      }
      .${JOIN_AGE_CLASS}.adm-lf-join-age--old {
        color: var(--chakra-colors-orange-200, rgba(254, 215, 170, 0.95));
        background: var(--chakra-colors-whiteAlpha-300, rgba(255, 255, 255, 0.08));
        border-color: var(--chakra-colors-orange-400, rgba(251, 146, 60, 0.35));
      }
    `;
    if (document.body) document.body.appendChild(style);
    else (document.head || document.documentElement).appendChild(style);
    ensureLobbyFilterStyleWinsCascade();
    setupLobbyFilterStyleAfterTheme();
  }

  function paintBarAccent(bar) {
    const el = bar || document.getElementById(BAR_ID);
    if (!el) return;
    const h = STATE.blacklistHue;
    el.style.borderBottom = `1px solid hsla(${h}, 55%, 42%, 0.35)`;
  }

  /** Reine X01-Zahl in Suche vs. anderer X01-Modus im Dropdown → Suche leeren (Modus zählt). „Alle“/Cricket usw. lässt die Suche stehen. */
  function clearSearchIfConflictsWithMode(newModeRaw) {
    const newMode = String(newModeRaw || "").trim().toLowerCase();
    const prevSearch = String(STATE.searchText || "").trim().toLowerCase();
    if (!LOBBY_X01_SCORE_SEARCH_TOKENS.has(prevSearch)) return false;
    if (!newMode || !LOBBY_X01_SCORE_SEARCH_TOKENS.has(newMode)) return false;
    if (prevSearch === newMode) return false;
    STATE.searchText = "";
    const inp = document.getElementById(SEARCH_ID);
    if (inp) inp.value = "";
    return true;
  }

  /** Reine X01-Zahl in Suche vs. anderer X01-Modus → Modus leeren (Suche zählt). */
  function clearModeIfConflictsWithSearch() {
    const s = String(STATE.searchText || "").trim().toLowerCase();
    const m = String(STATE.mode || "").trim().toLowerCase();
    if (!LOBBY_X01_SCORE_SEARCH_TOKENS.has(s) || !LOBBY_X01_SCORE_SEARCH_TOKENS.has(m) || s === m) return false;
    STATE.mode = "";
    const modeEl = document.getElementById(MODE_ID);
    if (modeEl) modeEl.value = "";
    return true;
  }

  function wireBarSelect(id, key) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("change", () => {
      const v = String(el.value || "");
      if (key === "lobbyFilterMode") {
        const clearedSearch = clearSearchIfConflictsWithMode(v);
        STATE.mode = v.trim().toLowerCase();
        persistBarPartial(
          clearedSearch
            ? { lobbyFilterMode: el.value, lobbyFilterSearchText: "" }
            : { lobbyFilterMode: el.value }
        );
        scheduleApply();
        return;
      }
      if (key === "lobbyFilterSortInOut") {
        STATE.sortInOut = v === "inout_desc" ? "inout_desc" : "inout_asc";
      } else if (key === "lobbyFilterInOutPair") {
        STATE.inOutPair = normalizeInOutPairFilter(el.value);
      } else if (key === "lobbyFilterLegsFirstTo") {
        const t = String(el.value || "").trim();
        STATE.legsFirstTo = t === "" ? null : parseInt(t, 10);
        if (STATE.legsFirstTo != null && (!Number.isFinite(STATE.legsFirstTo) || STATE.legsFirstTo < 1 || STATE.legsFirstTo > 11)) {
          STATE.legsFirstTo = null;
        }
      } else if (key === "lobbyFilterPlayerCount") {
        const t = String(el.value || "").trim();
        STATE.playerCount = t === "" ? null : parseInt(t, 10);
        if (
          STATE.playerCount != null &&
          (!Number.isFinite(STATE.playerCount) || STATE.playerCount < 1 || STATE.playerCount > MAX_LOBBY_PLAYER_SLOTS)
        ) {
          STATE.playerCount = null;
        }
      } else if (key === "lobbyFilterMinAvg") {
        STATE.minAvg = parseAvgSelectValue(el.value);
      } else if (key === "lobbyFilterMaxAvg") {
        STATE.maxAvg = parseAvgSelectValue(el.value);
      }
      persistBarPartial(
        key === "lobbyFilterInOutPair"
          ? { lobbyFilterInOutPair: STATE.inOutPair || "" }
          : key === "lobbyFilterLegsFirstTo"
            ? { lobbyFilterLegsFirstTo: STATE.legsFirstTo == null ? "" : String(STATE.legsFirstTo) }
            : key === "lobbyFilterPlayerCount"
              ? { lobbyFilterPlayerCount: STATE.playerCount == null ? "" : String(STATE.playerCount) }
              : key === "lobbyFilterMinAvg"
                ? { lobbyFilterMinAvg: STATE.minAvg == null ? "" : String(STATE.minAvg) }
                : key === "lobbyFilterMaxAvg"
                  ? { lobbyFilterMaxAvg: STATE.maxAvg == null ? "" : String(STATE.maxAvg) }
                  : { [key]: el.value }
      );
      scheduleApply();
    });
  }

  function flushAvgInputsToStorage() {
    const minEl = document.getElementById(MIN_AVG_ID);
    const maxEl = document.getElementById(MAX_AVG_ID);
    if (!minEl && !maxEl) return;
    const n1 = minEl ? parseAvgSelectValue(minEl.value) : null;
    const n2 = maxEl ? parseAvgSelectValue(maxEl.value) : null;
    STATE.minAvg = n1;
    STATE.maxAvg = n2;
    persistBarPartial({
      lobbyFilterMinAvg: n1 == null ? "" : String(n1),
      lobbyFilterMaxAvg: n2 == null ? "" : String(n2)
    });
  }

  function resetLobbyBarFilters() {
    try {
      if (!chrome?.storage?.local) {
        STATE.searchText = "";
        STATE.mode = "";
        STATE.sortInOut = "inout_asc";
        STATE.minAvg = null;
        STATE.maxAvg = null;
        STATE.plusPlayerOnly = false;
        STATE.inOutPair = "";
        STATE.legsFirstTo = null;
        STATE.playerCount = null;
        syncBarInputsFromState();
        scheduleApply();
        return;
      }
      mergeSettingsInStorage(LOBBY_BAR_RESET_KEYS)
        .then((settings) => {
          try {
            if (settings) {
              syncBarLangFromSettings(settings);
              STATE = normalizeSettings(settings);
            } else {
              chrome.storage.local.get(["settings"], (items) => {
                void chrome.runtime?.lastError;
                const merged = { ...(items?.settings || {}), ...LOBBY_BAR_RESET_KEYS };
                syncBarLangFromSettings(merged);
                STATE = normalizeSettings(merged);
                syncBarInputsFromState();
                applyFilters();
              });
              return;
            }
            syncBarInputsFromState();
            applyFilters();
          } catch {
            scheduleApply();
          }
        })
        .catch(() => {
          try {
            scheduleApply();
          } catch {
            /* ignore */
          }
        });
    } catch {
      scheduleApply();
    }
  }

  function wireResetButton() {
    const btn = document.getElementById(RESET_ID);
    if (!btn) return;
    btn.addEventListener("click", () => resetLobbyBarFilters());
  }

  function wirePlusPlayerToggle() {
    const el = document.getElementById(PLUS_PLAYER_ID);
    if (!el || el.dataset.admLfPlusWired === "1") return;
    el.dataset.admLfPlusWired = "1";
    const syncPlusFromInput = () => {
      STATE.plusPlayerOnly = !!el.checked;
      persistBarPartial({
        lobbyFilterPlusPlayerOnly: STATE.plusPlayerOnly,
        lobbyFilterPlusScope: "any"
      });
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      try {
        applyFilters();
      } catch {
        scheduleApply();
      }
    };
    el.addEventListener("change", syncPlusFromInput);
  }

  function ensureBar() {
    if (!isLobbyListPage() || !STATE.enabled) {
      const old = document.getElementById(BAR_ID);
      removeLegacyHeadingTrail();
      if (old) {
        const wrap = old.parentElement;
        old.remove();
        unwrapHeadingWrapIfOrphaned(wrap);
      }
      return;
    }
    injectStyle();
    let bar = document.getElementById(BAR_ID);
    if (
      bar &&
      (!bar.querySelector(`#${PLUS_PLAYER_ID}`) ||
        !bar.querySelector(`#${COUNTER_ID}`) ||
        !bar.querySelector(`#${RESET_ID}`) ||
        !bar.querySelector(`#${INOUT_PAIR_ID}`) ||
        !bar.querySelector(`#${LEGS_ID}`) ||
        !bar.querySelector(`#${PLAYER_COUNT_ID}`) ||
        bar.querySelector(`#${MIN_AVG_ID}`)?.tagName !== "SELECT" ||
        !bar.querySelector(".adm-lf-rows") ||
        !bar.querySelector(".adm-lf-bar-main") ||
        !bar.querySelector(".adm-lf-row--single") ||
        !bar.querySelector(`#${SORT_ID}`) ||
        !bar.querySelector(`#${SEARCH_ID}`))
    ) {
      try {
        removeLegacyHeadingTrail();
        bar.remove();
      } catch {
        /* ignore */
      }
      bar = null;
    }
    if (bar) {
      if (isFocusInsideLobbyBar()) return;

      const m = bar.querySelector(`#${MODE_ID}`);
      const so = bar.querySelector(`#${SORT_ID}`);
      const minEl = bar.querySelector(`#${MIN_AVG_ID}`);
      const maxEl = bar.querySelector(`#${MAX_AVG_ID}`);
      const plusCb = bar.querySelector(`#${PLUS_PLAYER_ID}`);
      if (m && document.activeElement !== m && m.value !== (STATE.mode || "")) m.value = STATE.mode || "";
      const pairEl = bar.querySelector(`#${INOUT_PAIR_ID}`);
      if (pairEl && document.activeElement !== pairEl && pairEl.value !== (STATE.inOutPair || "")) {
        pairEl.value = STATE.inOutPair || "";
      }
      const legsEl = bar.querySelector(`#${LEGS_ID}`);
      if (
        legsEl &&
        document.activeElement !== legsEl &&
        legsEl.value !== (STATE.legsFirstTo == null ? "" : String(STATE.legsFirstTo))
      ) {
        legsEl.value = STATE.legsFirstTo == null ? "" : String(STATE.legsFirstTo);
      }
      const pcEl = bar.querySelector(`#${PLAYER_COUNT_ID}`);
      if (
        pcEl &&
        document.activeElement !== pcEl &&
        pcEl.value !== (STATE.playerCount == null ? "" : String(STATE.playerCount))
      ) {
        pcEl.value = STATE.playerCount == null ? "" : String(STATE.playerCount);
      }
      if (so && document.activeElement !== so && so.value !== STATE.sortInOut) so.value = STATE.sortInOut;
      if (minEl && document.activeElement !== minEl) {
        minEl.value = STATE.minAvg == null ? "" : String(STATE.minAvg);
      }
      if (maxEl && document.activeElement !== maxEl) {
        maxEl.value = STATE.maxAvg == null ? "" : String(STATE.maxAvg);
      }
      if (plusCb && document.activeElement !== plusCb) plusCb.checked = !!STATE.plusPlayerOnly;
      paintBarAccent(bar);
      repositionBarIfNeeded(bar);
      return;
    }

    if (!document.body) return;

    bar = document.createElement("div");
    bar.id = BAR_ID;
    bar.setAttribute("data-adm-lobbyfilter", "1");
    const modeVal = STATE.mode || "";
    const pairVal = STATE.inOutPair || "";
    const legsVal = STATE.legsFirstTo == null ? "" : String(STATE.legsFirstTo);
    const playerCountVal = STATE.playerCount == null ? "" : String(STATE.playerCount);
    const sortVal = STATE.sortInOut === "inout_desc" ? "inout_desc" : "inout_asc";
    const minVal = STATE.minAvg == null ? "" : String(STATE.minAvg);
    const maxVal = STATE.maxAvg == null ? "" : String(STATE.maxAvg);
    const plusOn = STATE.plusPlayerOnly ? "checked" : "";
    bar.innerHTML = `
      <div class="adm-lf-rows">
        <div class="adm-lf-bar-main">
          <div class="adm-lf-row adm-lf-row--single">
            <div class="adm-lf-field">
              <label for="${MODE_ID}" data-i18n="lobbyfilter_bar_label_game">Game</label>
              <select id="${MODE_ID}" class="adm-lf-select">${gameModeSelectOptionsHtml()}</select>
            </div>
            <div class="adm-lf-field">
              <label for="${INOUT_PAIR_ID}" data-i18n="lobbyfilter_bar_label_inout">Mode</label>
              <select id="${INOUT_PAIR_ID}" class="adm-lf-select">
                <option value="">${escHtml(admBarT("lobbyfilter_plus_any"))}</option>
                <option value="0-0">SI-SO</option>
                <option value="0-1">SI-DO</option>
                <option value="0-2">SI-MO</option>
                <option value="1-0">DI-SO</option>
                <option value="1-1">DI-DO</option>
                <option value="1-2">DI-MO</option>
                <option value="2-0">MI-SO</option>
                <option value="2-1">MI-DO</option>
                <option value="2-2">MI-MO</option>
              </select>
            </div>
            <div class="adm-lf-field">
              <label for="${LEGS_ID}" data-i18n="lobbyfilter_bar_label_legs">Legs</label>
              <select id="${LEGS_ID}" class="adm-lf-select">
                ${legsSelectOptionsHtml()}
              </select>
            </div>
            <div class="adm-lf-field adm-lf-numinp">
              <label for="${MIN_AVG_ID}" data-i18n="lobbyfilter_min_avg_label">Min AVG</label>
              <select id="${MIN_AVG_ID}" class="adm-lf-select">${lobbyAvgSelectOptionsHtml()}</select>
            </div>
            <div class="adm-lf-field adm-lf-numinp">
              <label for="${MAX_AVG_ID}" data-i18n="lobbyfilter_max_avg_label">Max AVG</label>
              <select id="${MAX_AVG_ID}" class="adm-lf-select">${lobbyAvgSelectOptionsHtml()}</select>
            </div>
            <div class="adm-lf-field">
              <label for="${PLAYER_COUNT_ID}" data-i18n="lobbyfilter_bar_label_players">Players</label>
              <select id="${PLAYER_COUNT_ID}" class="adm-lf-select">
                ${playerCountSelectOptionsHtml()}
              </select>
            </div>
            <div class="adm-lf-field adm-lf-field--sort">
              <label for="${SORT_ID}" data-i18n="lobbyfilter_bar_label_sort">Sort</label>
              <select id="${SORT_ID}" class="adm-lf-select">${sortSelectOptionsHtml()}</select>
            </div>
            <div class="adm-lf-field adm-lf-field--search">
              <label for="${SEARCH_ID}" data-i18n="lobbyfilter_bar_search_label">Search</label>
              <input type="search" id="${SEARCH_ID}" data-i18n-placeholder="lobbyfilter_bar_search_placeholder" placeholder="" autocomplete="off" spellcheck="false" />
            </div>
            <div class="adm-lf-field adm-lf-field--plus adm-lf-toggle-field">
              <label for="${PLUS_PLAYER_ID}" data-i18n="lobbyfilter_bar_label_plus">Plus</label>
              <label class="adm-lf-switch">
                <input type="checkbox" id="${PLUS_PLAYER_ID}" ${plusOn} />
                <span class="adm-lf-slider"></span>
              </label>
            </div>
            <div class="adm-lf-field adm-lf-field--counter-reset">
              <label class="adm-lf-label-placeholder" aria-hidden="true">&nbsp;</label>
              <div class="adm-lf-counter-reset-row">
                <span id="${COUNTER_ID}" class="adm-lf-counter-stack"></span>
                <button type="button" class="adm-lf-reset" id="${RESET_ID}" data-i18n="lobbyfilter_bar_reset_short">Reset</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
    mountBarAfterLobbysHeading(bar);
    paintBarAccent(bar);
    refreshLobbyBarI18n();

    const modeEl = bar.querySelector(`#${MODE_ID}`);
    const sortEl = bar.querySelector(`#${SORT_ID}`);
    if (modeEl) modeEl.value = modeVal;
    const pairSel = bar.querySelector(`#${INOUT_PAIR_ID}`);
    if (pairSel) pairSel.value = pairVal;
    const legsSel = bar.querySelector(`#${LEGS_ID}`);
    if (legsSel) legsSel.value = legsVal;
    const pcSel = bar.querySelector(`#${PLAYER_COUNT_ID}`);
    if (pcSel) pcSel.value = playerCountVal;
    if (sortEl) sortEl.value = sortVal;
    const minEl = bar.querySelector(`#${MIN_AVG_ID}`);
    const maxEl = bar.querySelector(`#${MAX_AVG_ID}`);
    if (minEl) minEl.value = minVal;
    if (maxEl) maxEl.value = maxVal;

    wireBarSelect(MODE_ID, "lobbyFilterMode");
    wireBarSelect(INOUT_PAIR_ID, "lobbyFilterInOutPair");
    wireBarSelect(LEGS_ID, "lobbyFilterLegsFirstTo");
    wireBarSelect(PLAYER_COUNT_ID, "lobbyFilterPlayerCount");
    wireBarSelect(SORT_ID, "lobbyFilterSortInOut");
    wireBarSelect(MIN_AVG_ID, "lobbyFilterMinAvg");
    wireBarSelect(MAX_AVG_ID, "lobbyFilterMaxAvg");
    wirePlusPlayerToggle();
    wireResetButton();

    const input = bar.querySelector(`#${SEARCH_ID}`);
    if (input) {
      let searchDebounce = null;
      input.value = STATE.searchText;
      input.addEventListener(
        "input",
        () => {
          STATE.searchText = String(input.value || "").trim();
          scheduleApply();
          if (searchDebounce) clearTimeout(searchDebounce);
          searchDebounce = setTimeout(() => {
            searchDebounce = null;
            const clearedMode = clearModeIfConflictsWithSearch();
            persistBarPartial(
              clearedMode
                ? { lobbyFilterSearchText: STATE.searchText, lobbyFilterMode: "" }
                : { lobbyFilterSearchText: STATE.searchText }
            );
            if (clearedMode) scheduleApply();
          }, 350);
        },
        { passive: true }
      );
      input.addEventListener("blur", () => {
        if (searchDebounce) clearTimeout(searchDebounce);
        searchDebounce = null;
        STATE.searchText = String(input.value || "").trim();
        const clearedMode = clearModeIfConflictsWithSearch();
        persistBarPartial(
          clearedMode
            ? { lobbyFilterSearchText: STATE.searchText, lobbyFilterMode: "" }
            : { lobbyFilterSearchText: STATE.searchText }
        );
        scheduleApply();
      });
    }
  }

  function nameMatchesList(playerName, entries) {
    const lo = String(playerName || "").trim().toLowerCase();
    if (!lo) return false;
    return entries.some((entry) => entry && lo.includes(entry));
  }

  function setBlacklistNameHueCssVar() {
    try {
      document.documentElement.style.setProperty("--adm-lf-bl-h", String(STATE.blacklistHue ?? 0));
    } catch {
      /* ignore */
    }
  }

  /** Blacklist-Treffer: ganze Lobby-Karte einfärben, wenn „Markieren“ an und „Ausblenden“ aus. */
  function applyBlacklistNameHighlights() {
    document.querySelectorAll(`.${CARD_BL_HIT_CLASS}`).forEach((el) => el.classList.remove(CARD_BL_HIT_CLASS));
    if (!STATE.enabled) {
      try {
        document.documentElement.style.removeProperty("--adm-lf-bl-h");
      } catch {
        /* ignore */
      }
      return;
    }
    if (STATE.blacklist.length) setBlacklistNameHueCssVar();
    else {
      try {
        document.documentElement.style.removeProperty("--adm-lf-bl-h");
      } catch {
        /* ignore */
      }
    }
    if (!isLobbyListPage()) return;
    if (!STATE.blacklist.length || STATE.blacklistHide || !STATE.blacklistMark) return;
    getLobbyCards().forEach((card) => {
      const nameEls = getAllPlayerNameCandidates(card);
      const hit = nameEls.some((el) => nameMatchesList(String(el.textContent || "").trim(), STATE.blacklist));
      if (hit) card.classList.add(CARD_BL_HIT_CLASS);
    });
  }

  function setFavoritesNameHueCssVar() {
    try {
      document.documentElement.style.setProperty("--adm-lf-fav-h", String(STATE.favoritesHue ?? 120));
    } catch {
      /* ignore */
    }
  }

  /** Favoriten-Treffer: Karte markieren (Farbe an, „Ausblenden“ aus), linker Streifen wie Blacklist. */
  function applyFavoritesNameHighlights() {
    document.querySelectorAll(`.${CARD_FAV_HIT_CLASS}`).forEach((el) => el.classList.remove(CARD_FAV_HIT_CLASS));
    if (!STATE.enabled) {
      try {
        document.documentElement.style.removeProperty("--adm-lf-fav-h");
      } catch {
        /* ignore */
      }
      return;
    }
    if (STATE.favorites.length) setFavoritesNameHueCssVar();
    else {
      try {
        document.documentElement.style.removeProperty("--adm-lf-fav-h");
      } catch {
        /* ignore */
      }
    }
    if (!isLobbyListPage()) return;
    if (!STATE.favorites.length || STATE.favoritesHide || !STATE.favoritesMark) return;
    getLobbyCards().forEach((card) => {
      const nameEls = getAllPlayerNameCandidates(card);
      const hit = nameEls.some((el) => nameMatchesList(String(el.textContent || "").trim(), STATE.favorites));
      if (hit) card.classList.add(CARD_FAV_HIT_CLASS);
    });
  }

  function setEmptyHueCssVar() {
    try {
      document.documentElement.style.setProperty("--adm-lf-empty-h", String(STATE.emptyHue ?? 210));
    } catch {
      /* ignore */
    }
  }

  /** Leere Lobby markieren: gestrichelter Rahmen, wenn Farbe an und Ausblenden aus. */
  function applyEmptyLobbyHighlights() {
    document.querySelectorAll(`.${CARD_EMPTY_HIT_CLASS}`).forEach((el) => el.classList.remove(CARD_EMPTY_HIT_CLASS));
    if (!STATE.enabled || !isLobbyListPage()) {
      try {
        document.documentElement.style.removeProperty("--adm-lf-empty-h");
      } catch {
        /* ignore */
      }
      return;
    }
    setEmptyHueCssVar();
    if (STATE.emptyHide || !STATE.emptyMark) return;
    getLobbyCards().forEach((card) => {
      if (isLobbyCardEmpty(card)) card.classList.add(CARD_EMPTY_HIT_CLASS);
    });
  }

  /** Blacklist/Favoriten-Treffer in Namen überall auf der Seite einfärben (nie ausblenden). */
  function applyGlobalPlayerNameHighlights() {
    const BL = NAME_HIT_BL_CLASS;
    const FAV = NAME_HIT_FAV_CLASS;
    try {
      document.querySelectorAll(`main .${BL}, main .${FAV}`).forEach((el) => {
        el.classList.remove(BL, FAV);
      });
    } catch {
      /* ignore */
    }
    if (!STATE.enabled) return;
    if (STATE.blacklist.length) setBlacklistNameHueCssVar();
    else {
      try {
        document.documentElement.style.removeProperty("--adm-lf-bl-h");
      } catch {
        /* ignore */
      }
    }
    if (STATE.favorites.length) setFavoritesNameHueCssVar();
    else {
      try {
        document.documentElement.style.removeProperty("--adm-lf-fav-h");
      } catch {
        /* ignore */
      }
    }
    if (!STATE.blacklist.length && !STATE.favorites.length) return;
    for (const el of getGlobalNameHighlightElements()) {
      const lo = String(el.textContent || "")
        .trim()
        .toLowerCase();
      if (!lo) continue;
      const hitBl = STATE.blacklist.some((e) => e && lo.includes(e));
      const hitFav = STATE.favorites.some((e) => e && lo.includes(e));
      if (hitBl) el.classList.add(BL);
      else if (hitFav) el.classList.add(FAV);
    }
  }

  function applyFilters() {
    const allLobbyCards = getLobbyCards();

    if (!isLobbyListPage() || !STATE.enabled) {
      stopLobbyOpenAgeTicker();
      clearCardOrder(allLobbyCards);
      document.querySelectorAll(".adm-lf-card-hidden").forEach((c) => {
        c.classList.remove("adm-lf-card-hidden");
      });
      applyBlacklistNameHighlights();
      applyFavoritesNameHighlights();
      applyEmptyLobbyHighlights();
      applyGlobalPlayerNameHighlights();
      const barOff = document.getElementById(BAR_ID);
      const wrapOff = barOff?.parentElement;
      removeLegacyHeadingTrail();
      barOff?.remove();
      if (wrapOff) unwrapHeadingWrapIfOrphaned(wrapOff);
      return;
    }

    ensureBar();
    ensureLobbyFilterStyleWinsCascade();
    if (!isFocusInsideLobbyBar()) {
      repositionBarIfNeeded();
      paintBarAccent();
    }
    const searchLower = STATE.searchText.toLowerCase();
    let shown = 0;
    let total = 0;
    let visibleCountHadBlOrFavHide = false;
    let visibleCountHadOtherHide = false;

    const metaByCard = new Map();

    let emptyLobbyCount = 0;
    for (const c of allLobbyCards) {
      if (isLobbyCardEmpty(c)) emptyLobbyCount += 1;
    }

    allLobbyCards.forEach((card) => {
      total += 1;

      const flat = getCardFlatText(card);
      const detectedMode = detectGameMode(card, flat);
      const io = parseInOutRanks(flat);
      metaByCard.set(card, { flat, detectedMode, ...io });

      const nameEls = getAllPlayerNameCandidates(card);
      const names = nameEls.map((el) => el.textContent.trim());

      let hideBl = false;
      if (STATE.blacklist.length && STATE.blacklistHide) {
        hideBl = names.some((n) => nameMatchesList(n, STATE.blacklist));
      }

      let hideFav = false;
      if (STATE.favorites.length && STATE.favoritesHide) {
        const anyFav = names.some((n) => nameMatchesList(n, STATE.favorites));
        hideFav = !anyFav;
      }

      const hideEmpty = !!(STATE.emptyHide && isLobbyCardEmpty(card));

      let hideSearch = false;
      if (searchLower) {
        let found = names.some((n) => n.toLowerCase().includes(searchLower));
        if (!found) found = card.innerHTML.toLowerCase().includes(searchLower);
        hideSearch = !found;
      }

      const hideMode = !modeMatches(STATE.mode, detectedMode);
      const hideInOut = !inOutPairMatches(STATE.inOutPair, io.inRank, io.outRank);
      const hideLegs = !legsFilterMatches(STATE.legsFirstTo, flat);
      const hidePlus = !!(STATE.plusPlayerOnly && !cardHasPlusPlayerForLobbyFilter(card));
      const hidePlayerCount = !playerCountMatches(STATE.playerCount, countLobbyPlayers(card));
      const hideAvg = !avgFilterMatches(card);

      const hideOther = hideSearch || hideMode || hideInOut || hideLegs || hidePlus || hidePlayerCount || hideAvg;

      const show = !hideBl && !hideFav && !hideEmpty && !hideOther;

      if (!show) {
        if (hideBl || hideFav) visibleCountHadBlOrFavHide = true;
        else if (hideOther) visibleCountHadOtherHide = true;
      }

      card.classList.toggle("adm-lf-card-hidden", !show);
      if (show) shown += 1;
    });

    if (STATE.sortInOut === "inout_desc") {
      const visible = allLobbyCards.filter((c) => !c.classList.contains("adm-lf-card-hidden"));
      const dir = -1;
      visible.sort((a, b) => {
        const ma = metaByCard.get(a) || { sortKey: 999 };
        const mb = metaByCard.get(b) || { sortKey: 999 };
        if (ma.sortKey !== mb.sortKey) return (ma.sortKey - mb.sortKey) * dir;
        const na = String(a?.innerText || "").slice(0, 80);
        const nb = String(b?.innerText || "").slice(0, 80);
        return na.localeCompare(nb, BAR_UI_LANG === "en" ? "en" : "de") * dir;
      });
      visible.forEach((c, i) => {
        c.style.order = String(i);
      });
      allLobbyCards
        .filter((c) => c.classList.contains("adm-lf-card-hidden"))
        .forEach((c, i) => {
          c.style.order = String(10000 + i);
        });
    } else {
      clearCardOrder(allLobbyCards);
    }

    applyBlacklistNameHighlights();
    applyFavoritesNameHighlights();
    applyEmptyLobbyHighlights();
    applyGlobalPlayerNameHighlights();

    const counter = document.getElementById(COUNTER_ID);
    if (counter) {
      if (total === 0) {
        counter.textContent = "";
        counter.classList.remove("adm-lf-counter-stack");
      } else {
        counter.classList.add("adm-lf-counter-stack");
        const emptyKey =
          emptyLobbyCount === 1 ? "lobbyfilter_bar_empty_lobbies_one" : "lobbyfilter_bar_empty_lobbies_other";
        const emptyLine = escHtml(admBarT(emptyKey, { n: String(emptyLobbyCount) }));
        const suffix = escHtml(admBarT("lobbyfilter_bar_counter_suffix"));
        const numTone = visibleCountHadBlOrFavHide ? "alert" : visibleCountHadOtherHide ? "warn" : "ok";
        counter.innerHTML = `<div class="adm-lf-counter-empty-line">${emptyLine}</div><div class="adm-lf-counter-visible-line"><span class="adm-lf-num adm-lf-num--${numTone}">${shown}</span> / ${total} ${suffix}</div>`;
      }
    }

    if (STATE.showOpenAge) updateLobbyJoinOpenAgeLabels();
    startLobbyOpenAgeTickerIfNeeded();
  }

  function scheduleApply() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      applyFilters();
    }, 80);
  }

  function syncBarInputsFromState() {
    if (isFocusInsideLobbyBar()) return;

    const modeEl = document.getElementById(MODE_ID);
    if (modeEl && document.activeElement !== modeEl && modeEl.value !== (STATE.mode || "")) {
      modeEl.value = STATE.mode || "";
    }
    const pairSel = document.getElementById(INOUT_PAIR_ID);
    if (pairSel && document.activeElement !== pairSel && pairSel.value !== (STATE.inOutPair || "")) {
      pairSel.value = STATE.inOutPair || "";
    }
    const legsSel = document.getElementById(LEGS_ID);
    if (legsSel && document.activeElement !== legsSel) {
      const want = STATE.legsFirstTo == null ? "" : String(STATE.legsFirstTo);
      if (legsSel.value !== want) legsSel.value = want;
    }
    const pcSel = document.getElementById(PLAYER_COUNT_ID);
    if (pcSel && document.activeElement !== pcSel) {
      const wantPc = STATE.playerCount == null ? "" : String(STATE.playerCount);
      if (pcSel.value !== wantPc) pcSel.value = wantPc;
    }
    const sortEl = document.getElementById(SORT_ID);
    if (sortEl && document.activeElement !== sortEl && sortEl.value !== STATE.sortInOut) {
      sortEl.value = STATE.sortInOut;
    }
    const inp = document.getElementById(SEARCH_ID);
    if (inp && document.activeElement !== inp && inp.value !== STATE.searchText) inp.value = STATE.searchText;
    const minEl = document.getElementById(MIN_AVG_ID);
    if (minEl && document.activeElement !== minEl) {
      const want = STATE.minAvg == null ? "" : String(STATE.minAvg);
      if (minEl.value !== want) minEl.value = want;
    }
    const maxEl = document.getElementById(MAX_AVG_ID);
    if (maxEl && document.activeElement !== maxEl) {
      const want = STATE.maxAvg == null ? "" : String(STATE.maxAvg);
      if (maxEl.value !== want) maxEl.value = want;
    }
    const plusCb = document.getElementById(PLUS_PLAYER_ID);
    if (plusCb && document.activeElement !== plusCb) plusCb.checked = !!STATE.plusPlayerOnly;
  }

  function loadFromStorageAndRun() {
    try {
      if (!chrome?.storage?.local) return;
      chrome.storage.local.get(["settings"], (items) => {
        const raw = items?.settings || {};
        syncBarLangFromSettings(raw);
        STATE = normalizeSettings(raw);
        syncBarInputsFromState();
        applyFilters();
      });
    } catch {
      /* ignore */
    }
  }

  function bindStorageWatcher() {
    if (!chrome?.storage?.onChanged) return;
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !changes.settings?.newValue) return;
      const nv = changes.settings.newValue;
      const prevLang = String(changes.settings.oldValue?.uiLanguage || "de").toLowerCase() === "en" ? "en" : "de";
      const nextLang = String(nv?.uiLanguage || "de").toLowerCase() === "en" ? "en" : "de";
      syncBarLangFromSettings(nv);
      STATE = normalizeSettings(nv);
      syncBarInputsFromState();
      if (prevLang !== nextLang) refreshLobbyBarI18n();
      scheduleApply();
    });
  }

  function bindObserver() {
    if (mo) return;
    mo = new MutationObserver(() => scheduleApply());
    mo.observe(document.documentElement, { childList: true, subtree: true });
  }

  function onRoute() {
    scheduleApply();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", loadFromStorageAndRun, { once: true });
  } else {
    loadFromStorageAndRun();
  }

  bindStorageWatcher();
  bindObserver();
  setupLobbyFilterStyleAfterTheme();

  let lastHref = location.href;
  setInterval(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      onRoute();
    }
  }, 500);

  window.addEventListener("popstate", onRoute);
  window.addEventListener("pageshow", scheduleApply);
  window.addEventListener("pagehide", () => {
    try {
      flushAvgInputsToStorage();
      const si = document.getElementById(SEARCH_ID);
      if (si) {
        STATE.searchText = String(si.value || "").trim();
        persistBarPartial({ lobbyFilterSearchText: STATE.searchText });
      }
    } catch {
      /* ignore */
    }
  });
})();
