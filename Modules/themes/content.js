/**
 * Themes engine (Autodarts play.autodarts.io)
 * Responsibility:
 * - reads theme settings from chrome.storage
 * - resolves theme from Horizontal/Vertical config sets
 * - applies CSS through local style + background scripting API
 */
(() => {
let WEBSITE_THEME_STATE = {
  enabled: false,
  layout: "horizontal",
  theme: "classic",
  arenaPrimaryHue: 210,
  arenaSecondaryHue: 155,
  arenaTertiaryHue: 125,
  dartboardGlowEnabled: true,
  hideLeftMenuByDefault: true,
  backgroundImageData: "",
  backgroundImageDataMatch: "",
  backgroundImageDataMenu: "",
  backgroundSize: "cover"
};
let WEBSITE_THEME_REAPPLY_TIMER = null;
/** Mehrere `applyWebsiteTheme()` im selben Task → ein Lauf (weniger Flackern bei SPA-Updates). */
let APPLY_WEBSITE_THEME_COALESCE = 0;
let LAST_SENT_WEBSITE_THEME_CSS = null;
let LAST_SENT_WEBSITE_THEME_AT = 0;
let SELECTED_MARKER_OBSERVER = null;
let SELECTED_MARKER_TIMER = null;
/** Gedrosseltes `applyBuilderDataToDom` nach echten DOM-Strukturänderungen (nicht bei jedem Klassen-Toggle). */
let BUILDER_LAYOUT_REAPPLY_TIMER = null;
/** Erhöhen = alle ausstehenden `scheduleBuilderLayoutResync`-Timeouts ungültig (z. B. Wechsel zu nativem Autodarts). */
let BUILDER_LAYOUT_RESYNC_GEN = 0;
/** Nach Fenstergröße: Layout neu anwenden, px→UV migrieren, Überlappungen mildern. */
let BUILDER_RESIZE_RECONCILE_TIMER = null;
let lastKnownHref = String(location.href || "");
/**
 * Nur auf der eigentlichen Match-/Board-Ansicht Theme-Builder anwenden (Transforms, Marker, Auswahl),
 * nicht auf Lobby, Spiel suchen, Spielerstellung, Warte-/Settings-Routen — sonst treffen gespeicherte
 * Selektoren oder Heuristiken falsche Knoten (Gamemode-UI wirkt „verschoben“).
 */
function pathnameIndicatesWebsiteThemesPlayfield() {
  try {
    const pathname = String(location.pathname || "").toLowerCase();
    if (!/\/matches\/[^/]+/i.test(pathname)) return false;
    if (/\blobby\b/.test(pathname)) return false;
    if (/\/setup\b/.test(pathname) || /\/create\b/.test(pathname) || /\/invite\b/.test(pathname)) return false;
    if (/\/matches\/[^/]+\/(?:settings|configure|waiting|summary|overview)\b/i.test(pathname)) return false;
    if (/\/matches\/[^/]+\/(?:search|find|finder|browse|discover|queue|lobby)\b/i.test(pathname)) return false;
    return true;
  } catch {
    return false;
  }
}

/** Keine Auswahl / Zieh-States außerhalb der Match-Spielfläche — sonst treffen Heuristiken falsche Knoten (Lobby, Spiel suchen, …). */
function suspendBuilderOutsidePlayfield() {
  if (pathnameIndicatesWebsiteThemesPlayfield()) return;
  if (!BUILDER_ACTIVE) return;
  BUILDER_DRAG = null;
  BUILDER_RESIZE = null;
  BUILDER_ROTATE_DRAG = null;
  BUILDER_CROP_DRAG = null;
  BUILDER_PERSP_EDGE_DRAG = null;
  BUILDER_MARQUEE_DRAG = null;
  flushBuilderWheelCommitPending();
  document.querySelectorAll("[data-ad-sb-builder-hit='1']").forEach((el) => {
    try {
      el.removeAttribute("data-ad-sb-builder-hit");
    } catch {}
  });
  document.querySelectorAll("[data-adm-builder-hit='1']").forEach((el) => {
    try {
      el.removeAttribute("data-adm-builder-hit");
    } catch {}
  });
  BUILDER_SELECTED = null;
  BUILDER_SELECTED_SELECTOR = "";
  BUILDER_SELECTED_KEYS = [];
}
const WEBSITE_THEME_STYLE_ID = "adm-webdesign-style";
const MENU_TOGGLE_STYLE_ID = "adm-menu-toggle-style";
const MENU_TOGGLE_BUTTON_ID = "adm-menu-toggle-button";
const MENU_STATE_KEY = "adm_left_menu_collapsed";
let LAST_MENU_TARGET = null;
let LAST_LOGO_RECT = null;
/** Wenn „Menü zu“ gewünscht ist, das DOM aber noch kein Seitenleisten-Element liefert (SPA / document_start). */
let MENU_COLLAPSE_RETRY_TIMER = null;
const MENU_TARGET_STYLE_BACKUP = new WeakMap();
const MENU_PARENT_STYLE_BACKUP = new WeakMap();
const BUILDER_SAVE_BUTTON_ID = "adm-theme-builder-save";
const BUILDER_RESET_BUTTON_ID = "adm-theme-builder-reset";
const BUILDER_PIN_BUTTON_ID = "adm-theme-builder-pin-toggle";
const BUILDER_GRID_OVERLAY_ID = "adm-theme-builder-grid-overlay";
const BUILDER_GRID_TOGGLE_ID = "adm-theme-builder-grid-toggle";
const BUILDER_AUX_GRID_STYLE_ID = "adm-theme-builder-aux-grid-style";
const BUILDER_PIN_PANEL_ID = "adm-theme-builder-pin-panel";
const BUILDER_BOX_ID = "adm-theme-builder-box";
const BUILDER_FULL_OUTLINE_ID = "adm-theme-builder-full-outline";
const BUILDER_HANDLE_ID = "adm-theme-builder-handle";
const BUILDER_ROTATE_HANDLE_ID = "adm-theme-builder-rotate";
const BUILDER_STYLE_ID = "adm-theme-builder-style";
const BUILDER_DIALOG_ID = "adm-theme-builder-dialog";
const BUILDER_COLORS_PANEL_ID = "adm-theme-builder-colors";
const BUILDER_BG_TRIGGER_ID = "adm-theme-builder-bg-trigger";
const BUILDER_BG_POPOVER_ID = "adm-theme-builder-bg-popover";
const BUILDER_HINT_ID = "adm-theme-builder-hint";
const BUILDER_MARQUEE_ID = "adm-theme-builder-marquee";
const BUILDER_HINT_SUB_CLASS = "adm-theme-builder-hint-sub";
const BUILDER_HINT_MAIN =
  "Strg = Zuschneiden\nAlt = 3D Perspektive\nStrg + Scrollrad = Zoom\nLeerer Bereich aufziehen = Mehrfachauswahl · Shift = hinzufügen";
const BUILDER_HINT_SUB = "Strg + Z rückgängig · Esc = schließen";
const BUILDER_HINT_SUB_STYLE_ID = "adm-theme-builder-hint-sub-style";
const BUILDER_MAX_TILT_DEG = 62;
/** Markiert `#ad-ext-player-display` / Spalten für Flex-Stabilisierung (kein Stretch der anderen Box beim Verschieben). */
const BUILDER_PLAYER_FLEX_STAB = "data-adm-builder-flex-stab";
/**
 * `el.dataset.adSbBuilderX` → DOM `data-ad-sb-builder-x` (nicht `data-adm-builder-*`).
 * Falsche Selektoren ließen z. B. `cleanupOrphanBuilderAppliedStyles` / `clearBuilderTargetMarks` ins Leere laufen
 * oder Companion-`closest` scheitern — sichtbar als „springt zurück“ / falsche Treffer.
 */
const SEL_SB_BUILDER_APPLIED = "[data-ad-sb-builder-applied='1']";
const SEL_SB_BUILDER_APPLIED_CROP = "[data-ad-sb-builder-applied='1'].adm-builder-has-crop";
const SEL_SB_BUILDER_TARGET = "[data-ad-sb-builder-target='1']";
const SEL_SB_BUILDER_COMPANION = "[data-ad-sb-builder-companion-for]";
const SEL_SB_BUILDER_HAD_DISABLED = "[data-ad-sb-builder-had-disabled='1']";
const SEL_SB_BUILDER_HAD_ANCHOR_DISABLED = "[data-ad-sb-builder-had-anchor-disabled='1']";
const SEL_SB_BUILDER_HAD_ARIA_DISABLED = "[data-ad-sb-builder-had-aria-disabled='1']";
const SEL_SB_BUILDER_HAD_PE_RESTORE = "[data-ad-sb-builder-had-pe-restore='1']";

/**
 * Schlüssel für `ADM.galleryThumbStore` (IndexedDB) — pro Theme-ID ein Thumbnail.
 * (Chrome erlaubt keine Schreibzugriffe auf den Erweiterungsordner `assets/` zur Laufzeit.)
 */
function galleryThumbStorageRef(themeId) {
  const id = String(themeId || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, "");
  return id ? `adm-gthumb:${id}` : "";
}

function ensureBuilderHintSubCss() {
  const css = `#${BUILDER_HINT_ID} .${BUILDER_HINT_SUB_CLASS}{font-size:9.5px;line-height:1.35;opacity:.82;margin-top:3px;white-space:normal;}`;
  let s = document.getElementById(BUILDER_HINT_SUB_STYLE_ID);
  if (s) {
    s.textContent = css;
    return;
  }
  s = document.createElement("style");
  s.id = BUILDER_HINT_SUB_STYLE_ID;
  s.textContent = css;
  (document.head || document.documentElement || document.body).appendChild(s);
}

/**
 * Theme-Builder-UI mit `position:fixed` muss unter `<html>` hängen: Hat `body` oder der App-Root
 * `transform`/`filter`/`perspective`, wird `fixed` relativ dazu — Viewport-Koordinaten von
 * `getBoundingClientRect()` passen dann nicht (verschobenes / verzerrtes Trapez wie im Screenshot).
 */
function mountBuilderFixedHost(node) {
  if (!node) return;
  const root = document.documentElement || document.body;
  try {
    if (node.parentNode !== root) root.appendChild(node);
    else if (root === document.documentElement && node !== root.lastElementChild) root.appendChild(node);
  } catch {}
}

const DARTBOARD_GLOW_TARGET_KEY = "dartboard-glow";
let BUILDER_ACTIVE = false;
let BUILDER_SESSION_ACTIVE = false;
/** Pro Spielmodus (X01 vs. Bull-off); `BUILDER_DATA` referenziert immer `BUILDER_DATA_BY_MODE[BUILDER_ACTIVE_PLAY_MODE]`. */
let BUILDER_DATA_BY_MODE = { x01: {}, bull_off: {} };
let BUILDER_ACTIVE_PLAY_MODE = "x01";
let BUILDER_DATA = BUILDER_DATA_BY_MODE[BUILDER_ACTIVE_PLAY_MODE];
let BUILDER_SELECTED = null;
let BUILDER_SELECTED_SELECTOR = "";
/** Reihenfolge = Auswahlreihenfolge; letztes Element = primäres Ziel (Handles, Tastatur). */
let BUILDER_SELECTED_KEYS = [];
/** @type {{ sx: number, sy: number, curX: number, curY: number, additive: boolean } | null} */
let BUILDER_MARQUEE_DRAG = null;
let BUILDER_DRAG = null;
let BUILDER_RESIZE = null;
let BUILDER_ROTATE_DRAG = null;
/** @type {{ selector: string, edge: string, startX: number, startY: number, startCropT: number, startCropR: number, startCropB: number, startCropL: number, rectW: number, rectH: number } | null} */
let BUILDER_CROP_DRAG = null;
/** @type {{ selector: string, edge: string, startX: number, startY: number, startRx: number, startRy: number } | null} */
let BUILDER_PERSP_EDGE_DRAG = null;
let BUILDER_WHEEL_COMMIT_TIMER = 0;

function isBuilderPointerTransformActive() {
  return !!(
    BUILDER_DRAG ||
    BUILDER_RESIZE ||
    BUILDER_ROTATE_DRAG ||
    BUILDER_CROP_DRAG ||
    BUILDER_PERSP_EDGE_DRAG ||
    BUILDER_MARQUEE_DRAG
  );
}

function flushBuilderWheelCommitPending() {
  if (!BUILDER_WHEEL_COMMIT_TIMER) return;
  try {
    clearTimeout(BUILDER_WHEEL_COMMIT_TIMER);
  } catch {}
  BUILDER_WHEEL_COMMIT_TIMER = 0;
  if (BUILDER_ACTIVE) commitBuilderHistorySnapshot();
}

const BUILDER_PLAY_MODE_X01 = "x01";
const BUILDER_PLAY_MODE_BULL_OFF = "bull_off";

function getBuilderPlayModeFromDom() {
  try {
    const v = String(document.documentElement?.getAttribute?.("data-adm-play-mode") || "").toLowerCase();
    if (v === BUILDER_PLAY_MODE_BULL_OFF || v === BUILDER_PLAY_MODE_X01) return v;
  } catch {}
  return BUILDER_PLAY_MODE_X01;
}

/** Rohdaten aus Storage/Theme → immer `{ byMode: { x01, bull_off } }` (Legacy flach → nur x01). */
function normalizeBuilderStorageRoot(parsed) {
  const emptySlice = () => ({});
  if (!parsed || typeof parsed !== "object") return { byMode: { x01: emptySlice(), bull_off: emptySlice() } };
  if (parsed.byMode && typeof parsed.byMode === "object") {
    const x0 = parsed.byMode[BUILDER_PLAY_MODE_X01];
    const bo = parsed.byMode[BUILDER_PLAY_MODE_BULL_OFF];
    return {
      byMode: {
        x01: typeof x0 === "object" && x0 ? { ...x0 } : {},
        bull_off: typeof bo === "object" && bo ? { ...bo } : {}
      }
    };
  }
  const legacy = { ...parsed };
  delete legacy.byMode;
  return { byMode: { x01: legacy, bull_off: {} } };
}

function hydrateBuilderDataFromStorageRoot(rawSource) {
  const root = normalizeBuilderStorageRoot(rawSource);
  BUILDER_DATA_BY_MODE = {
    x01: pruneBuilderDataToMovableKeys(cloneBuilderData(root.byMode.x01 || {})),
    bull_off: pruneBuilderDataToMovableKeys(cloneBuilderData(root.byMode.bull_off || {}))
  };
  BUILDER_ACTIVE_PLAY_MODE = pathnameIndicatesWebsiteThemesPlayfield() ? getBuilderPlayModeFromDom() : BUILDER_PLAY_MODE_X01;
  if (!BUILDER_DATA_BY_MODE[BUILDER_ACTIVE_PLAY_MODE]) BUILDER_ACTIVE_PLAY_MODE = BUILDER_PLAY_MODE_X01;
  BUILDER_DATA = BUILDER_DATA_BY_MODE[BUILDER_ACTIVE_PLAY_MODE];
  try {
    delete BUILDER_DATA[DARTBOARD_GLOW_TARGET_KEY];
  } catch {}
  seedBuilderPinKeysSeenFromBuilderData();
}

function seedBuilderPinKeysSeenFromBuilderData() {
  try {
    Object.keys(BUILDER_DATA || {}).forEach((k) => {
      if (BUILDER_MOVABLE_KEY_SET.has(k)) BUILDER_PIN_KEYS_SEEN.add(k);
    });
  } catch {}
}

function switchBuilderDataForPlayModeIfNeeded() {
  if (!pathnameIndicatesWebsiteThemesPlayfield()) return;
  const next = getBuilderPlayModeFromDom();
  if (next === BUILDER_ACTIVE_PLAY_MODE) return;
  BUILDER_ACTIVE_PLAY_MODE = next;
  if (!BUILDER_DATA_BY_MODE[BUILDER_ACTIVE_PLAY_MODE]) {
    BUILDER_DATA_BY_MODE[BUILDER_ACTIVE_PLAY_MODE] = pruneBuilderDataToMovableKeys({});
  }
  BUILDER_DATA = BUILDER_DATA_BY_MODE[BUILDER_ACTIVE_PLAY_MODE];
  try {
    delete BUILDER_DATA[DARTBOARD_GLOW_TARGET_KEY];
  } catch {}
  BUILDER_HISTORY = [];
  BUILDER_HISTORY_INDEX = -1;
  commitBuilderHistorySnapshot();
  seedBuilderPinKeysSeenFromBuilderData();
}

function takeBuilderSessionSnapshot() {
  return {
    byMode: cloneBuilderData(BUILDER_DATA_BY_MODE),
    activeMode: BUILDER_ACTIVE_PLAY_MODE
  };
}

/**
 * Vor dem Speichern: gemessene Viewport-Anteile (vx,vy,vw,vh) je Ziel setzen — stabil nach Reload,
 * statt nur `position:relative` + px-Offset (der sich mit dem Layout verschiebt).
 */
function captureBuilderViewportAnchorsForSerialize() {
  if (!pathnameIndicatesWebsiteThemesPlayfield()) return;
  const iw = Math.max(1, window.innerWidth || 1);
  const ih = Math.max(1, window.innerHeight || 1);
  try {
    refreshBuilderTargets();
  } catch {}
  const mode = BUILDER_ACTIVE_PLAY_MODE || BUILDER_PLAY_MODE_X01;
  const slice = BUILDER_DATA_BY_MODE[mode];
  if (!slice) return;
  for (const key of Object.keys(slice)) {
    if (!BUILDER_MOVABLE_KEY_SET.has(key) || key === DARTBOARD_GLOW_TARGET_KEY) continue;
    const entry = slice[key];
    if (!entry || typeof entry !== "object") continue;
    const t = BUILDER_TARGETS.find((x) => x.key === key);
    const el = t?.el;
    if (!el || !document.contains(el)) continue;
    const r = el.getBoundingClientRect();
    entry.vx = r.left / iw;
    entry.vy = r.top / ih;
    entry.vw = r.width / iw;
    entry.vh = r.height / ih;
    entry.posUv = 1;
  }
}

/** Stylebot-kompatibles `play.autodarts.io`-CSS aus gespeichertem Builder-Snapshot (nur posUv-Einträge mit `sel`). */
function buildPlayAutodartsIoCssFromBuilderSnapshot(root) {
  const parts = [];
  const byMode = root?.byMode && typeof root.byMode === "object" ? root.byMode : {};
  for (const mode of [BUILDER_PLAY_MODE_X01, BUILDER_PLAY_MODE_BULL_OFF]) {
    const slice = byMode[mode] || {};
    for (const [key, entry] of Object.entries(slice)) {
      if (!BUILDER_MOVABLE_KEY_SET.has(key) || key === DARTBOARD_GLOW_TARGET_KEY) continue;
      if (!entry || typeof entry !== "object" || Number(entry.posUv) !== 1) continue;
      const sel = String(entry.sel || "").trim();
      if (!sel) continue;
      const vx = Number(entry.vx);
      const vy = Number(entry.vy);
      if (!Number.isFinite(vx) || !Number.isFinite(vy)) continue;
      const vw = Number(entry.vw);
      const vh = Number(entry.vh);
      const hasWh = Number.isFinite(vw) && vw > 0.0005 && Number.isFinite(vh) && vh > 0.0005;
      const sx = Number(entry.sx || 1);
      const sy = Number(entry.sy || 1);
      const safeSx = Number.isFinite(sx) ? Math.max(0.25, Math.min(4.0, sx)) : 1;
      const safeSy = Number.isFinite(sy) ? Math.max(0.25, Math.min(4.0, sy)) : 1;
      const uScale = Math.sqrt(Math.max(0.0625, safeSx * safeSy));
      const rot = Number(entry.rot || 0);
      const safeRot = Number.isFinite(rot) ? rot : 0;
      const rx = Number(entry.rx || 0);
      const ry = Number(entry.ry || 0);
      const safeRx = Number.isFinite(rx) ? Math.max(-BUILDER_MAX_TILT_DEG, Math.min(BUILDER_MAX_TILT_DEG, rx)) : 0;
      const safeRy = Number.isFinite(ry) ? Math.max(-BUILDER_MAX_TILT_DEG, Math.min(BUILDER_MAX_TILT_DEG, ry)) : 0;
      let persp = Number(entry.persp || 0);
      if (!Number.isFinite(persp) || persp <= 0) persp = 1000;
      persp = Math.round(Math.max(220, Math.min(2800, persp)));
      const has3d = Math.abs(safeRx) > 0.04 || Math.abs(safeRy) > 0.04;
      const tf = has3d
        ? `perspective(${persp}px) rotateX(${safeRx}deg) rotateY(${safeRy}deg) rotate(${safeRot}deg) scale(${uScale},${uScale})`
        : `rotate(${safeRot}deg) scale(${uScale},${uScale})`;
      const ct = clampBuilderCropPct(entry.cropT);
      const cr = clampBuilderCropPct(entry.cropR);
      const cb = clampBuilderCropPct(entry.cropB);
      const cl = clampBuilderCropPct(entry.cropL);
      const rad = Math.max(0, Math.round(entry.r || 0));
      const hasCrop = ct > 0 || cr > 0 || cb > 0 || cl > 0;
      const roundPart = rad > 0 ? ` round ${rad}px` : "";
      const clip = hasCrop ? `clip-path:inset(${ct}% ${cr}% ${cb}% ${cl}%${roundPart}) !important;` : "";
      const br = !hasCrop && (entry.r || 0) >= 0 ? `border-radius:${rad}px !important;` : "";
      const wh = hasWh ? `width:${vw * 100}vw !important;height:${vh * 100}vh !important;box-sizing:border-box !important;` : "";
      parts.push(
        `${sel}{position:fixed!important;left:${vx * 100}vw!important;top:${vy * 100}vh!important;margin:0!important;` +
          `${wh}transform-origin:center center!important;transform:${tf}!important;${clip}${br}z-index:42!important;}`
      );
    }
  }
  return parts.join("\n");
}

function cancelBuilderLayoutResyncPending() {
  BUILDER_LAYOUT_RESYNC_GEN += 1;
}

function scheduleBuilderLayoutResync() {
  if (!pathnameIndicatesWebsiteThemesPlayfield()) return;
  if (!WEBSITE_THEME_STATE?.enabled) return;
  BUILDER_LAYOUT_RESYNC_GEN += 1;
  const gen = BUILDER_LAYOUT_RESYNC_GEN;
  const delays = [0, 140, 420, 1000, 1800];
  delays.forEach((ms) => {
    setTimeout(() => {
      try {
        if (gen !== BUILDER_LAYOUT_RESYNC_GEN) return;
        if (!WEBSITE_THEME_STATE?.enabled) return;
        refreshBuilderTargets();
        applyBuilderDataToDom();
        refreshBuilderSelectionBox();
      } catch {}
    }, ms);
  });
}

function serializeBuilderDataRootForStorage() {
  try {
    captureBuilderViewportAnchorsForSerialize();
  } catch {}
  return JSON.stringify({
    byMode: {
      x01: stripDartboardGlowFromBuilderData(BUILDER_DATA_BY_MODE[BUILDER_PLAY_MODE_X01] || {}),
      bull_off: stripDartboardGlowFromBuilderData(BUILDER_DATA_BY_MODE[BUILDER_PLAY_MODE_BULL_OFF] || {})
    }
  });
}

function restoreBuilderFromSessionSnapshot(snap) {
  if (snap && typeof snap === "object" && snap.byMode && typeof snap.byMode === "object") {
    BUILDER_DATA_BY_MODE = {
      x01: pruneBuilderDataToMovableKeys(cloneBuilderData(snap.byMode[BUILDER_PLAY_MODE_X01] || {})),
      bull_off: pruneBuilderDataToMovableKeys(cloneBuilderData(snap.byMode[BUILDER_PLAY_MODE_BULL_OFF] || {}))
    };
    let am =
      snap.activeMode === BUILDER_PLAY_MODE_BULL_OFF ? BUILDER_PLAY_MODE_BULL_OFF : BUILDER_PLAY_MODE_X01;
    if (!BUILDER_DATA_BY_MODE[am]) am = BUILDER_PLAY_MODE_X01;
    BUILDER_ACTIVE_PLAY_MODE = am;
    BUILDER_DATA = BUILDER_DATA_BY_MODE[BUILDER_ACTIVE_PLAY_MODE];
    try {
      delete BUILDER_DATA[DARTBOARD_GLOW_TARGET_KEY];
    } catch {}
    seedBuilderPinKeysSeenFromBuilderData();
    return;
  }
  hydrateBuilderDataFromStorageRoot(snap && typeof snap === "object" ? snap : {});
}

let BUILDER_TARGETS = [];
let BUILDER_HISTORY = [];
let BUILDER_HISTORY_INDEX = -1;
let BUILDER_SESSION_SNAPSHOT = {};
let BUILDER_PIN_OPEN = false;
/** Raster sichtbar + Verschieben am 8-px-Raster einrasten (ein Schalter). */
let BUILDER_GRID_VISIBLE = false;
/** Debounce Speichern der Arena-Hue-Werte aus dem Builder-Farben-Panel. */
let BUILDER_BG_SAVE_TIMER = null;
let BUILDER_BG_POPOVER_OPEN = false;
/** @type {((ev: MouseEvent) => void) | null} */
let BUILDER_BG_POPOVER_DOC_MDOWN = null;
const BUILDER_GRID_STEP_PX = 8;
/** Keys, die mindestens einmal erfolgreich registriert oder aus gespeicherten Daten geladen wurden — bleiben im Feststellen-Panel „im Layout“ (kein Flackern bei Größe/Position). */
let BUILDER_PIN_KEYS_SEEN = new Set();
/** Nur diese Keys sind im Theme-Builder wählbar / speicherbar (Glow folgt der Scheibe, Modul-Schalter). */
const BUILDER_TARGET_KEYS = [
  { key: "dartboard", label: "Dartscheibe" },
  { key: "player-score-left", label: "Score links" },
  { key: "player-score-right", label: "Score rechts" },
  { key: "throw-track", label: "Wurf-Leiste (BullOff)" },
  { key: "throw-point-1", label: "Pfeil 1" },
  { key: "throw-point-2", label: "Pfeil 2" },
  { key: "throw-point-3", label: "Pfeil 3" },
  { key: "hud-turn-total", label: "Punktzahl (alle Würfe)" },
  { key: "hud-main-score", label: "Punktzahl (Rest)" },
  { key: "hud-checkout-rule", label: "Out / In" },
  { key: "action-undo", label: "Undo" },
  { key: "action-next", label: "Next" },
  { key: "action-referee", label: "AI Schiedsrichter" },
  { key: "hud-game-mode", label: "Gamemode" },
  { key: "hud-round", label: "Runde" },
  { key: "action-match-stats", label: "Statistik" },
  { key: "hud-eye", label: "Auge" },
  { key: "action-settings", label: "Einstellungen" },
  { key: "action-numpad", label: "Zahleneingabe" },
  { key: "board-coordinate-mode", label: "Virtual Board" },
  { key: "board-live", label: "Live Board" },
  { key: "board-live-mode", label: "Live-Modus Button" },
  { key: "board-start", label: "Starten" },
  { key: "board-reset", label: "Zurücksetzen" },
  { key: "board-calibrate", label: "Roter Button (kalibrieren)" },
  { key: "action-cancel", label: "Abbrechen" }
];
const BUILDER_MOVABLE_KEY_SET = new Set(BUILDER_TARGET_KEYS.map((t) => t.key));

/** True, wenn im Storage-Root mindestens ein speicherbares Builder-Ziel (ohne dartboard-glow) vorkommt. */
function builderStorageRootHasMovableData(rawSource) {
  const root = normalizeBuilderStorageRoot(rawSource && typeof rawSource === "object" ? rawSource : {});
  for (const mode of [BUILDER_PLAY_MODE_X01, BUILDER_PLAY_MODE_BULL_OFF]) {
    const slice = root.byMode[mode];
    if (!slice || typeof slice !== "object") continue;
    for (const k of Object.keys(slice)) {
      if (k === DARTBOARD_GLOW_TARGET_KEY) continue;
      if (BUILDER_MOVABLE_KEY_SET.has(k)) return true;
    }
  }
  return false;
}

/** Nur im Feststellen-Panel listen, wenn ein Element erkannt wurde (X01 hat z. B. keine BullOff-Wurfleiste). */
const BUILDER_PIN_OPTIONAL_KEYS = new Set([
  "throw-track",
  "throw-point-1",
  "throw-point-2",
  "throw-point-3",
  "hud-turn-total",
  "hud-main-score",
  "hud-checkout-rule",
  "hud-game-mode",
  "hud-round",
  "action-undo",
  "action-next",
  "action-referee",
  "action-match-stats",
  "hud-eye",
  "action-settings",
  "action-numpad",
  "board-coordinate-mode",
  "board-live",
  "board-live-mode",
  "board-start",
  "board-reset",
  "board-calibrate",
  "action-cancel"
]);
const BUILDER_DEFAULT_ALIGNMENT_THEMES = new Set(["classic", "hue", "minimal", "autodarts-minus"]);

function parseThemeBuilderTargets(raw) {
  try {
    const arr = JSON.parse(String(raw || "[]"));
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((x) => x && typeof x === "object")
      .map((x) => ({
        key: String(x.key || "")
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9-]/g, "")
          .slice(0, 48),
        label: String(x.label || x.key || "").trim().slice(0, 80) || String(x.key || "").trim(),
        selector: String(x.selector || "").trim()
      }))
      .filter((x) => x.key && x.selector);
  } catch {
    return [];
  }
}

/** Feste Builder-Ziele (keine freien JSON-Ziele mehr auf der Seite). */
function getEffectiveBuilderTargetKeys() {
  return BUILDER_TARGET_KEYS.map((t) => ({ ...t }));
}

const FALLBACK_THEME_SETS = {
  horizontal: [
    {
      id: "classic",
      css: `
        body{background:linear-gradient(180deg, #2f3f8d 0%, #2c5fad 55%, #245aa3 100%) !important;}
      `
    },
    /** Bisheriger Extension-„Werkreset“-Look (Gradient + gemeinsames Theme-CSS) — nicht vanilla play.autodarts.io. */
    {
      id: "autodarts-minus",
      label: "AutodartsMinus",
      author: "DeDomeD",
      arenaPrimaryHue: 210,
      arenaSecondaryHue: 155,
      arenaTertiaryHue: 125,
      css: `
        body{background:linear-gradient(180deg, #2f3f8d 0%, #2c5fad 55%, #245aa3 100%) !important;}
      `
    }
  ],
  vertical: [
    {
      id: "stack",
      css: `
        body{background:linear-gradient(180deg, #1f2b54 0%, #2e4e89 52%, #2f6aaa 100%) !important;}
      `
    },
    {
      id: "autodarts-minus",
      label: "AutodartsMinus",
      author: "DeDomeD",
      arenaPrimaryHue: 210,
      arenaSecondaryHue: 155,
      arenaTertiaryHue: 125,
      css: `
        body{background:linear-gradient(180deg, #1f2b54 0%, #2e4e89 52%, #2f6aaa 100%) !important;}
      `
    }
  ]
};

function getBaseThemeSets() {
  const src = globalThis.ADM_WEBSITE_THEME_SETS || {};
  return {
    horizontal: Array.isArray(src.horizontal) && src.horizontal.length
      ? src.horizontal
      : FALLBACK_THEME_SETS.horizontal,
    vertical: Array.isArray(src.vertical) && src.vertical.length
      ? src.vertical
      : FALLBACK_THEME_SETS.vertical
  };
}

function parseCustomThemes(raw, storageListLayout, uiLanguage) {
  try {
    const arr = JSON.parse(String(raw || "[]"));
    if (!Array.isArray(arr)) return [];
    const lang = uiLanguage ?? "de";
    return arr
      .filter((x) => x && typeof x === "object")
      .map((x) => {
        const resolvedLayout =
          storageListLayout != null
            ? normalizeLayout(
                x.layout != null && String(x.layout).trim() !== "" ? x.layout : storageListLayout
              )
            : normalizeLayout(x.layout != null && String(x.layout).trim() !== "" ? x.layout : "horizontal");
        const tagSource = Array.isArray(x.tags) ? x.tags.map((t) => String(t || "").trim()).filter(Boolean) : [];
        return {
          id: String(x.id || "").toLowerCase(),
          label: String(x.label || x.name || "Custom").trim() || "Custom",
          css: String(x.css || ""),
          layout: resolvedLayout,
          builderData: (x.builderData && typeof x.builderData === "object") ? x.builderData : {},
          backgroundImageDataMatch: String(x.backgroundImageDataMatch || "").trim(),
          backgroundSize: String(x.backgroundSize || "").trim(),
          arenaPrimaryHue: Number.isFinite(Number(x.arenaPrimaryHue)) ? Number(x.arenaPrimaryHue) : undefined,
          arenaSecondaryHue: Number.isFinite(Number(x.arenaSecondaryHue)) ? Number(x.arenaSecondaryHue) : undefined,
          arenaTertiaryHue: Number.isFinite(Number(x.arenaTertiaryHue)) ? Number(x.arenaTertiaryHue) : undefined,
          savedAt: Number.isFinite(Number(x.savedAt)) ? Number(x.savedAt) : 0,
          galleryUpdatedAt: Number.isFinite(Number(x.galleryUpdatedAt)) ? Number(x.galleryUpdatedAt) : 0,
          galleryScreenshot: String(x.galleryScreenshot || "").trim(),
          galleryScreenshotRef: String(x.galleryScreenshotRef || "").trim(),
          author: String(x.author || "").trim(),
          sourceName: String(x.sourceName || "").trim(),
          sourceUrl: String(x.sourceUrl || "").trim(),
          stylebotPackUrl: String(x.stylebotPackUrl || "").trim(),
          stylebotGalleryThumbUrl: String(x.stylebotGalleryThumbUrl || "").trim(),
          description: String(x.description || "").trim(),
          stylebotImport: !!x.stylebotImport,
          playAutodartsIo:
            x["play.autodarts.io"] && typeof x["play.autodarts.io"] === "object"
              ? x["play.autodarts.io"]
              : x.playAutodartsIo && typeof x.playAutodartsIo === "object"
                ? x.playAutodartsIo
                : undefined,
          tags: normalizeThemeTagsWithLayout(resolvedLayout, tagSource, lang)
        };
      })
      .filter((x) => !!x.id);
  } catch {
    return [];
  }
}

/** Stylebot-Pakete: Hintergrund per CSS oft ohne cover — Bildschirm-Anpassung erzwingen. */
function isStylebotPackThemeRow(row) {
  if (!row || typeof row !== "object") return false;
  if (String(row.id || "").toLowerCase().startsWith("tobyleif-")) return true;
  if (String(row.id || "").toLowerCase().startsWith("mrjames-")) return true;
  if (String(row.sourceName || "").toLowerCase() === "tobyleif") return true;
  if (String(row.author || "").toLowerCase() === "tobyleif") return true;
  const tags = row.tags;
  if (Array.isArray(tags) && tags.some((t) => String(t || "").toLowerCase().includes("stylebot"))) return true;
  return false;
}

/** Gleiche Logik wie `extractStylebotPackFromRootJson` im Themes-Popup (Stylebot-JSON → CSS). */
function extractStylebotPackFromRootJsonForThumb(json) {
  const empty = { css: "", playIo: null, layoutFromJson: "" };
  if (!json || typeof json !== "object") return empty;

  const layoutNorm = (raw) => {
    const s = String(raw || "")
      .trim()
      .toLowerCase()
      .normalize("NFKD")
      .replace(/\p{M}/gu, "");
    if (!s) return "";
    if (/\bvertical\b/.test(s) || /\bvertikal\b/.test(s) || /\bportrait\b/.test(s) || /\bhochformat\b/.test(s)) {
      return "vertical";
    }
    if (/\bhorizontal\b/.test(s) || /\bwaagerecht\b/.test(s) || /\blandscape\b/.test(s)) return "horizontal";
    return "";
  };

  const tryHostObject = (pack) => {
    if (!pack || typeof pack !== "object") return null;
    const css = String(pack.css || "").trim();
    if (!css) return null;
    return {
      css,
      playIo: pack,
      layoutFromJson: layoutNorm(pack.layout || pack.orientation)
    };
  };

  if (typeof json.css === "string" && json.css.trim()) {
    const css = json.css.trim();
    return {
      css,
      playIo: { css },
      layoutFromJson: layoutNorm(json.layout || json.orientation)
    };
  }

  let h = tryHostObject(json["play.autodarts.io"]);
  if (h) {
    if (!h.layoutFromJson) h.layoutFromJson = layoutNorm(json.layout || json.orientation);
    return h;
  }
  h = tryHostObject(json.playAutodartsIo);
  if (h) {
    if (!h.layoutFromJson) h.layoutFromJson = layoutNorm(json.layout || json.orientation);
    return h;
  }

  const keys = Object.keys(json);
  const candidates = [];
  for (const k of keys) {
    const v = json[k];
    const hit = tryHostObject(v);
    if (!hit) continue;
    const kl = k.toLowerCase();
    let score = 0;
    if (kl.includes("autodarts")) score += 4;
    if (kl.includes("play")) score += 2;
    if (kl.includes("io") || kl.includes("host")) score += 1;
    candidates.push({ ...hit, score });
  }
  candidates.sort((a, b) => b.score - a.score);
  if (candidates.length) {
    const best = candidates[0];
    if (!best.layoutFromJson) best.layoutFromJson = layoutNorm(json.layout || json.orientation);
    return { css: best.css, playIo: best.playIo, layoutFromJson: best.layoutFromJson };
  }

  return empty;
}

async function sha1HexOfUtf8Text(text) {
  const enc = new TextEncoder().encode(String(text || ""));
  const buf = await globalThis.crypto.subtle.digest("SHA-1", enc);
  const bytes = new Uint8Array(buf);
  let hex = "";
  for (let i = 0; i < bytes.length; i += 1) hex += bytes[i].toString(16).padStart(2, "0");
  return hex;
}

function snapshotWebsiteThemeStateForThumb() {
  try {
    return structuredClone(WEBSITE_THEME_STATE);
  } catch {
    return JSON.parse(
      JSON.stringify({
        ...WEBSITE_THEME_STATE,
        customThemesHorizontal: WEBSITE_THEME_STATE.customThemesHorizontal || [],
        customThemesVertical: WEBSITE_THEME_STATE.customThemesVertical || [],
        builderData: WEBSITE_THEME_STATE.builderData || {}
      })
    );
  }
}

/**
 * Kurz das echte Match-UI mit Stylebot-CSS stylen, Screenshot (wie Theme speichern), Zustand zurücksetzen.
 * Läuft nur auf `/matches/…`-Spielfläche und nicht während des Theme-Builders.
 */
async function runStylebotPackLiveThumbnailCapture(msg) {
  const packUrl = String(msg?.packUrl || "").trim();
  if (!packUrl) return { ok: false, error: "bad_pack_url" };
  if (BUILDER_SESSION_ACTIVE) return { ok: false, error: "builder_active" };
  if (!pathnameIndicatesWebsiteThemesPlayfield()) return { ok: false, error: "not_match_playfield" };

  let rawText = "";
  let json = null;
  try {
    const r = await fetch(packUrl, { credentials: "omit", cache: "no-store" });
    if (!r.ok) return { ok: false, error: `http_${r.status}` };
    rawText = await r.text();
    json = JSON.parse(rawText);
  } catch (e) {
    return { ok: false, error: String(e?.message || e || "fetch_json") };
  }

  const packSig = await sha1HexOfUtf8Text(rawText);
  const ex = extractStylebotPackFromRootJsonForThumb(json);
  let packCss = String(ex.css || "").trim();
  packCss = packCss.replace(/(^|[\r\n])\s*\/\/[^\r\n]*/g, "$1");
  if (!packCss) return { ok: false, error: "no_pack_css", packSig };

  let layout = String(msg?.layout || "horizontal").toLowerCase() === "vertical" ? "vertical" : "horizontal";
  if (ex.layoutFromJson === "vertical" || ex.layoutFromJson === "horizontal") layout = ex.layoutFromJson;

  const snap = snapshotWebsiteThemeStateForThumb();
  const ghostId = `__adm_thumb_${Date.now()}__`;
  const ghost = {
    id: ghostId,
    label: "adm-thumb",
    layout,
    css: packCss,
    builderData: {},
    backgroundImageDataMatch: "",
    backgroundSize: "cover",
    stylebotImport: true,
    stylebotPackUrl: packUrl,
    author: "tobyleif",
    sourceName: "tobyleif",
    tags: ["Stylebot"]
  };
  if (ex.playIo && typeof ex.playIo === "object") {
    ghost.playAutodartsIo = ex.playIo;
    ghost["play.autodarts.io"] = ex.playIo;
  }

  if (!Array.isArray(WEBSITE_THEME_STATE.customThemesHorizontal)) WEBSITE_THEME_STATE.customThemesHorizontal = [];
  if (!Array.isArray(WEBSITE_THEME_STATE.customThemesVertical)) WEBSITE_THEME_STATE.customThemesVertical = [];
  if (layout === "vertical") WEBSITE_THEME_STATE.customThemesVertical.push(ghost);
  else WEBSITE_THEME_STATE.customThemesHorizontal.push(ghost);

  WEBSITE_THEME_STATE.enabled = true;
  WEBSITE_THEME_STATE.layout = layout;
  WEBSITE_THEME_STATE.theme = ghostId;

  try {
    applyWebsiteThemeInternal();
    await new Promise((r) => {
      requestAnimationFrame(() => requestAnimationFrame(r));
    });
    await new Promise((r) => setTimeout(r, 520));
    const dataUrl = await captureMatchPageGalleryThumbnailJpeg();
    if (!String(dataUrl || "").trim().startsWith("data:image/")) {
      return { ok: false, error: "empty_capture", packSig };
    }
    return { ok: true, dataUrl: String(dataUrl).trim(), packSig };
  } catch (e) {
    return { ok: false, error: String(e?.message || e || "capture"), packSig };
  } finally {
    WEBSITE_THEME_STATE = snap;
    try {
      applyWebsiteThemeInternal();
    } catch {}
  }
}

function getThemeSetsFromState(state) {
  const base = getBaseThemeSets();
  const horizontal = [...base.horizontal, ...(state?.customThemesHorizontal || [])];
  const vertical = [...base.vertical, ...(state?.customThemesVertical || [])];
  return { horizontal, vertical };
}

function normalizeLayout(raw) {
  return String(raw || "").toLowerCase() === "vertical" ? "vertical" : "horizontal";
}

/** Erkennt Layout-Schlagworte in Tags (DE/EN), damit sie nicht doppelt vorkommen. */
function isThemeLayoutTagToken(s) {
  const lo = String(s || "")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "");
  return (
    lo === "horizontal" ||
    lo === "vertical" ||
    lo === "horizont" ||
    lo === "vertikal" ||
    lo === "landscape" ||
    lo === "waagerecht" ||
    lo === "hochformat" ||
    lo === "portrait"
  );
}

/** Einheitliches Layout-Tag (DE: Vertikal; EN: Vertical). */
function layoutDisplayTagForTheme(layout, uiLanguage) {
  const de = String(uiLanguage ?? "de").toLowerCase().startsWith("de");
  return normalizeLayout(layout) === "vertical" ? (de ? "Vertikal" : "Vertical") : "Horizontal";
}

function normalizeTagTokenForCompare(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ");
}

function pickThemeStatusKindFromTagList(tags) {
  const arr = Array.isArray(tags) ? tags : [];
  let hasUpdate = false;
  let hasNew = false;
  for (const raw of arr) {
    const lo = normalizeTagTokenForCompare(raw);
    if (!lo) continue;
    if (lo === "update" || lo === "updated" || lo.includes("update") || lo.includes("ui pdate")) hasUpdate = true;
    if (lo === "neu" || lo === "new") hasNew = true;
  }
  if (hasUpdate) return "update";
  if (hasNew) return "new";
  return null;
}

function themeStatusLabelFromKind(kind, uiLanguage) {
  if (!kind) return "";
  const de = String(uiLanguage ?? "de").toLowerCase().startsWith("de");
  if (kind === "update") return de ? "Update" : "Updated";
  if (kind === "new") return de ? "Neu" : "New";
  return "";
}

/** Nur Layout (immer zuerst) + optional Neu/Update — keine weiteren Schlagworte in `tags`. */
function normalizeThemeTagsWithLayout(layout, tags, uiLanguage) {
  const lang = uiLanguage ?? "de";
  const pill = layoutDisplayTagForTheme(layout, lang);
  const raw = Array.isArray(tags) ? tags.map((t) => String(t || "").trim()).filter(Boolean) : [];
  const rest = raw.filter((t) => !isThemeLayoutTagToken(t) && String(t).trim() !== pill);
  const kind = pickThemeStatusKindFromTagList(rest);
  const statusLabel = themeStatusLabelFromKind(kind, lang);
  return statusLabel ? [pill, statusLabel] : [pill];
}

function clampHue(raw, fallback) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(360, Math.round(n)));
}

function normalizeTheme(layout, rawTheme, stateRef = WEBSITE_THEME_STATE) {
  const themes = getThemeSetsFromState(stateRef)[layout] || [];
  let wanted = String(rawTheme || "").toLowerCase();
  if (wanted === "arena") wanted = "hue";
  if (wanted === "tools-glass") wanted = "stream-glass";
  if (themes.some((t) => t.id === wanted)) return wanted;
  return themes[0]?.id || "";
}

function findTheme(layout, theme) {
  const themes = getThemeSetsFromState(WEBSITE_THEME_STATE)[layout] || [];
  return themes.find((t) => t.id === theme) || themes[0] || null;
}

function normalizeWebsiteThemeSettings(settings) {
  const s = settings || {};
  const layout = normalizeLayout(s.websiteLayout);
  const customThemesHorizontal = parseCustomThemes(s.websiteCustomThemesHorizontal, "horizontal", s.uiLanguage);
  const customThemesVertical = parseCustomThemes(s.websiteCustomThemesVertical, "vertical", s.uiLanguage);
  const tempState = { customThemesHorizontal, customThemesVertical };
  const theme = normalizeTheme(layout, s.websiteTheme, tempState);
  const themeRows = getThemeSetsFromState(tempState)[layout] || [];
  const activeThemeRow =
    themeRows.find((t) => String(t?.id || "").toLowerCase() === String(theme || "").toLowerCase()) || null;
  let builderData = {};
  try {
    const raw = String(s.websiteThemeBuilderData || "{}");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") builderData = parsed;
  } catch {}
  const packBg = activeThemeRow && String(activeThemeRow.backgroundImageDataMatch || "").trim();
  const globalBgMatch = String(s.websiteBackgroundImageDataMatch || "").trim();
  const resolvedBackgroundImageDataMatch = String(packBg || globalBgMatch || "").trim();
  const packSize = String(activeThemeRow?.backgroundSize || "").toLowerCase();
  const globalSize = String(s.websiteBackgroundSize || "cover").toLowerCase();
  const sizePick = (packSize === "contain" || packSize === "auto") ? packSize : globalSize;
  const backgroundSize = sizePick === "contain" || sizePick === "auto" ? sizePick : "cover";
  const themesInstalled =
    Array.isArray(s.installedModules) &&
    s.installedModules.some((id) => {
      const x = String(id || "").toLowerCase();
      return x === "themes" || x === "websitedesign";
    });
  const matchNativeAutodarts =
    s.websiteMatchNativeAutodarts === true || String(s.websiteMatchNativeAutodarts || "").trim() === "1";
  const themesOn =
    !matchNativeAutodarts &&
    s.themesEnabled !== false &&
    (s.themesEnabled === true || s.websiteDesignEnabled === true || themesInstalled);
  return {
    enabled: themesOn,
    matchNativeAutodarts,
    layout,
    theme,
    arenaPrimaryHue: Number.isFinite(Number(activeThemeRow?.arenaPrimaryHue))
      ? clampHue(activeThemeRow.arenaPrimaryHue, 210)
      : clampHue(s.websiteArenaPrimaryHue, 210),
    arenaSecondaryHue: Number.isFinite(Number(activeThemeRow?.arenaSecondaryHue))
      ? clampHue(activeThemeRow.arenaSecondaryHue, 155)
      : clampHue(s.websiteArenaSecondaryHue, 155),
    arenaTertiaryHue: Number.isFinite(Number(activeThemeRow?.arenaTertiaryHue))
      ? clampHue(activeThemeRow.arenaTertiaryHue, 125)
      : clampHue(s.websiteArenaTertiaryHue, 125),
    dartboardGlowEnabled: true,
    hideLeftMenuByDefault: s.websiteHideLeftMenuByDefault !== false,
    builderEnabled: !!s.websiteThemeBuilderEnabled,
    builderData,
    customThemesHorizontal,
    customThemesVertical,
    themeBuilderTargets: parseThemeBuilderTargets(s.websiteThemeBuilderTargets),
    backgroundImageData: String(s.websiteBackgroundImageData || "").trim(),
    backgroundImageDataMatch: resolvedBackgroundImageDataMatch,
    backgroundImageDataMenu: String(s.websiteBackgroundImageDataMenu || "").trim(),
    backgroundSize
  };
}

function buildCustomBackgroundCss(cfg) {
  if (!pathnameIndicatesWebsiteThemesPlayfield()) return "";
  const rawIngame = String(cfg?.backgroundImageDataMatch || cfg?.backgroundImageData || "").trim();
  const rawMenu = String(cfg?.backgroundImageDataMenu || "").trim();
  const toLit = (raw) => {
    if (!raw) return "";
    const dataUrl = raw.startsWith("data:") ? raw : `data:image/jpeg;base64,${raw}`;
    try {
      return JSON.stringify(dataUrl);
    } catch {
      return "";
    }
  };
  const ingameLit = toLit(rawIngame);
  const menuLit = toLit(rawMenu);
  const menuEffective = menuLit || ingameLit;
  const ingameEffective = ingameLit || menuLit;
  if (!menuEffective) return "";
  const sizeRaw = String(cfg?.backgroundSize || "cover").toLowerCase();
  const size = sizeRaw === "contain" || sizeRaw === "auto" ? sizeRaw : "cover";
  const bgBlock = (lit) => `
      background-image:url(${lit}) !important;
      background-size:${size} !important;
      background-position:center center !important;
      background-repeat:no-repeat !important;
      background-attachment:fixed !important;
    `;
  return `
    html{min-height:100% !important;}
    body{
      ${bgBlock(menuEffective)}
    }
    html:has(#ad-ext-player-display) body{
      ${bgBlock(ingameEffective)}
    }
  `;
}

/** Theme-CSS soll Builder-Overlays nicht mit `filter` / `mask` verzerren (fixed + getBoundingClientRect). */
function buildThemeBuilderChromeIsolationCss() {
  const ids = [
    BUILDER_SAVE_BUTTON_ID,
    BUILDER_RESET_BUTTON_ID,
    BUILDER_PIN_BUTTON_ID,
    BUILDER_GRID_OVERLAY_ID,
    BUILDER_GRID_TOGGLE_ID,
    BUILDER_PIN_PANEL_ID,
    BUILDER_BOX_ID,
    BUILDER_FULL_OUTLINE_ID,
    BUILDER_HANDLE_ID,
    BUILDER_ROTATE_HANDLE_ID,
    BUILDER_DIALOG_ID,
    BUILDER_COLORS_PANEL_ID,
    BUILDER_BG_TRIGGER_ID,
    BUILDER_BG_POPOVER_ID,
    BUILDER_HINT_ID,
    BUILDER_MARQUEE_ID
  ];
  const sel = ids.map((id) => `#${id}`).join(",");
  return `
    ${sel}{
      filter:none !important;
      backdrop-filter:none !important;
      mask-image:none !important;
      -webkit-mask-image:none !important;
    }
  `;
}

/** Stylebot-JSON enthält manchmal `//`-Zeilen — das ist kein gültiges CSS-Kommentar. */
function sanitizeThemeCssInvalidSlashComments(css) {
  return String(css || "").replace(/^\s*\/\/[^\n]*$/gm, "");
}

/**
 * Tobyleif-Pakete: Body-Hintergrund oft `:root:has(.css-… ) body` — Chakra-Hashes ändern sich, dann greift
 * kein Bild mehr. Stattdessen wie unsere Hintergrund-Logik: Match-Ansicht über `#ad-ext-player-display`.
 */
function patchStylebotObsoleteRootBodyBackgroundSelectors(css) {
  let out = String(css || "");
  /* Kein früher Return: manche Pakete nutzen nur `:root:not(:has(.css-…)) body` — sonst greift der Patch nie. */
  out = out.replace(/:root:has\(\.css-[a-z0-9]+\)\s*body\s*\{/gi, "html:has(#ad-ext-player-display) body {");
  out = out.replace(/:root:not\(:has\(\.css-[a-z0-9]+\)\)\s*body\s*\{/gi, "html:not(:has(#ad-ext-player-display)) body {");
  return out;
}

/**
 * Globales Extension-Chrome um Autodarts herum. Bei echten Stylebot-JSON-Imports (`stylebotImport`)
 * absichtlich schlank: weniger !important auf breiten Selektoren — sonst weichen Animationen / Rahmen /
 * Marker von Stylebot im Browser ab.
 */
function buildAdmExtensionSharedChromeCss(cfg, stylebotImportPack) {
  const accent = "#19c7ff";
  const accentSoft = "rgba(25,199,255,.25)";
  const rootBlock = `
    :root{
      --adm-accent:${accent};
      --adm-accent-soft:${accentSoft};
      --adm-border:rgba(255,255,255,.14);
      --adm-calc-board-stroke:var(--adm-border);
      --adm-text:#eaf1ff;
      --adm-arena-primary-h:${cfg.arenaPrimaryHue};
      --adm-arena-secondary-h:${cfg.arenaSecondaryHue};
      --adm-arena-tertiary-h:${cfg.arenaTertiaryHue};
    }`;
  const throwFieldFix = `
    /* Remove box/outline around throw total number field */
    [class*="throw"] [class*="MuiOutlinedInput-root"],
    [class*="score"] [class*="MuiOutlinedInput-root"],
    [data-testid*="score"] [class*="MuiOutlinedInput-root"],
    [class*="visit"] [class*="MuiOutlinedInput-root"],
    [class*="throw"] input,
    [class*="visit"] input{
      background:transparent !important;
      border:none !important;
      box-shadow:none !important;
      outline:none !important;
    }
    [class*="throw"] .MuiOutlinedInput-notchedOutline,
    [class*="score"] .MuiOutlinedInput-notchedOutline,
    [data-testid*="score"] .MuiOutlinedInput-notchedOutline,
    [class*="visit"] .MuiOutlinedInput-notchedOutline,
    [class*="throw"] fieldset,
    [class*="visit"] fieldset{
      border:none !important;
      outline:none !important;
      box-shadow:none !important;
    }`;
  const dartGlowOff =
    cfg.dartboardGlowEnabled
      ? ""
      : `
      [data-adm-dartboard-glow="1"]{
        display:none !important;
        opacity:0 !important;
      }
    `;
  if (stylebotImportPack) {
    return `
    ${rootBlock}
    ${throwFieldFix}
    ${dartGlowOff}
  `;
  }
  return `
    ${rootBlock}
    body{
      color:var(--adm-text) !important;
    }
    button,[role="button"],input,select,textarea{
      border-radius:8px !important;
    }
    .MuiToggleButton-root,
    [class*="toggle"],
    [class*="Toggle"]{
      border-radius:10px !important;
    }
    .Mui-selected,
    button[aria-pressed="true"],
    [role="button"][aria-pressed="true"],
    [role="radio"][aria-checked="true"],
    [aria-selected="true"],
    [aria-current="true"],
    [data-selected="true"],
    [data-active="true"],
    [data-state="active"],
    [data-state="on"],
    button:has(input[type="radio"]:checked),
    button:has(input[type="checkbox"]:checked),
    label:has(input[type="radio"]:checked),
    label:has(input[type="checkbox"]:checked),
    .adm-selected-marker{
      background:linear-gradient(180deg, rgba(194,216,255,.84), rgba(165,193,247,.72)) !important;
      border-color:rgba(232,242,255,.98) !important;
      color:#ffffff !important;
      box-shadow:0 0 0 1px rgba(232,242,255,.55) inset, 0 0 14px rgba(170,206,255,.35) !important;
      font-weight:700 !important;
    }
    .adm-unselected-marker{
      filter:saturate(.9);
      opacity:.94;
    }
    [class*="score"],[data-testid*="score"],[class*="player"],[class*="Player"]{
      border-radius:10px !important;
    }
    ${throwFieldFix}
    [class*="MuiPaper-root"],[class*="card"],[class*="panel"],[class*="board"]{
      border-color:var(--adm-border) !important;
    }
    /* Chalkboard / Visit-Zeilen: vertikaler Strich über volle Höhe (häufig endet border am td nur am Text) */
    #ad-ext-player-display table,
    #ad-ext-turn table{
      width:100%;
      height:100%;
      min-height:100%;
      border-collapse:collapse !important;
      table-layout:fixed;
    }
    #ad-ext-player-display table tbody,
    #ad-ext-turn table tbody{
      position:relative;
      height:100%;
      min-height:100%;
    }
    #ad-ext-player-display table tbody tr,
    #ad-ext-turn table tbody tr{
      height:100%;
    }
    #ad-ext-player-display table tbody tr td,
    #ad-ext-turn table tbody tr td{
      position:relative;
      vertical-align:top;
      height:100%;
      box-sizing:border-box;
    }
    #ad-ext-player-display table tbody tr td:first-child,
    #ad-ext-turn table tbody tr td:first-child{
      border-right:none !important;
      border-inline-end:none !important;
    }
    #ad-ext-player-display table tbody tr td:first-child::after,
    #ad-ext-turn table tbody tr td:first-child::after{
      content:"";
      position:absolute;
      top:0;
      right:0;
      bottom:0;
      width:1px;
      background:var(--adm-calc-board-stroke) !important;
      pointer-events:none;
      z-index:1;
    }
    ${dartGlowOff}
  `;
}

function buildThemeCss(cfg) {
  const verticalLayout = `
    [class*="scoreboard"],[class*="players"],[class*="player-list"],[class*="matchHeader"]{
      display:grid !important;
      grid-template-columns:1fr !important;
      gap:10px !important;
    }
  `;

  const horizontalLayout = `
    [class*="scoreboard"],[class*="players"]{
      gap:8px !important;
    }
  `;

  const themeCfg = findTheme(cfg.layout, cfg.theme);
  const themeIdForFidelity = String(themeCfg?.id || cfg.theme || "").toLowerCase();
  const stylebotImportFidelity = !!(
    themeCfg &&
    (themeCfg.stylebotImport ||
      themeIdForFidelity === "mrjames-ad-template" ||
      themeIdForFidelity.startsWith("mrjames-"))
  );
  const layoutCss =
    stylebotImportFidelity ? "" : cfg.layout === "vertical" ? verticalLayout : horizontalLayout;
  const themeIdLower = String(cfg.theme || "").toLowerCase();
  const stylebotPack =
    themeIdLower === "mrjames-ad-template" || isStylebotPackThemeRow(themeCfg);
  let themeCss = String(themeCfg?.css || "");
  if (stylebotPack) {
    themeCss = sanitizeThemeCssInvalidSlashComments(themeCss);
    themeCss = patchStylebotObsoleteRootBodyBackgroundSelectors(themeCss);
  }
  const customBg = buildCustomBackgroundCss(cfg);
  /* MrJames: sehr GPU-lastig — fixed-Background triggert mit vielen Animationen oft Graublinken (Chrome). */
  const stylebotBgAttachment =
    themeIdLower === "mrjames-ad-template" || themeIdLower.startsWith("mrjames-") ? "scroll" : "fixed";
  const stylebotBgFit =
    stylebotImportFidelity || !isStylebotPackThemeRow(themeCfg)
      ? ""
      : `
    html,body{
      background-size:cover !important;
      background-position:center center !important;
      background-repeat:no-repeat !important;
      background-attachment:${stylebotBgAttachment} !important;
      min-height:100% !important;
    }
  `;
  /* Stylebot-Pakete: ohne stylebotImport weiterhin Helper zuerst. Importierte JSON-Pakete: nur Theme+optional customBg wie Stylebot. */
  const midTail = stylebotPack
    ? `${stylebotBgFit}${themeCss}${customBg}`
    : `${themeCss}${customBg}${stylebotBgFit}`;
  const sharedInject = buildAdmExtensionSharedChromeCss(cfg, stylebotImportFidelity && stylebotPack);

  return `
    ${sharedInject}
    ${layoutCss}
    ${midTail}
    ${buildThemeBuilderChromeIsolationCss()}
  `;
}

/** Explizite Nutzerwahl per Klick auf den Umschalter oben links; null = noch nicht gewählt. */
function readMenuCollapsedPreferenceFromLocalStorage() {
  try {
    const raw = localStorage.getItem(MENU_STATE_KEY);
    if (raw === "0") return false;
    if (raw === "1") return true;
  } catch {}
  return null;
}

function getInitialMenuCollapsedForApply() {
  const explicit = readMenuCollapsedPreferenceFromLocalStorage();
  if (explicit !== null) return explicit;
  return WEBSITE_THEME_STATE?.hideLeftMenuByDefault === true;
}

function setStoredMenuCollapsed(collapsed) {
  try {
    localStorage.setItem(MENU_STATE_KEY, collapsed ? "1" : "0");
  } catch {}
}

function getOrCreateMenuToggleStyle() {
  let style = document.getElementById(MENU_TOGGLE_STYLE_ID);
  if (style) return style;
  style = document.createElement("style");
  style.id = MENU_TOGGLE_STYLE_ID;
  style.textContent = `
    #${MENU_TOGGLE_BUTTON_ID}{
      position:fixed;
      top:10px;
      left:10px;
      width:44px;
      height:44px;
      border-radius:10px;
      border:none;
      background:transparent;
      display:block;
      cursor:pointer;
      z-index:2147483647;
      padding:0;
      margin:0;
      box-shadow:none;
      outline:none;
      color:transparent;
      overflow:hidden;
      opacity:0;
    }
    #${MENU_TOGGLE_BUTTON_ID}:focus-visible{
      opacity:1;
      outline:2px solid rgba(25,199,255,.85);
      outline-offset:2px;
    }
  `;
  (document.head || document.documentElement).appendChild(style);
  return style;
}

function scoreLeftMenuCandidate(el) {
  if (!el) return -1;
  const r = el.getBoundingClientRect();
  if (r.width < 120 || r.width > 520) return -1;
  const minH = Math.max(200, Math.min(window.innerHeight * 0.38, window.innerHeight - 100));
  if (r.height < minH) return -1;
  if (r.left > 40) return -1;
  const style = getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden") return -1;
  let score = 0;
  if (style.position === "fixed") score += 20;
  if (style.position === "sticky") score += 12;
  if (style.position === "absolute") score += 8;
  if (r.left <= 2) score += 12;
  if (r.width >= 180 && r.width <= 340) score += 18;
  const hint = `${el.className || ""} ${el.id || ""}`.toLowerCase();
  if (hint.includes("side")) score += 12;
  if (hint.includes("menu")) score += 10;
  if (hint.includes("nav")) score += 8;
  if (hint.includes("drawer")) score += 8;
  const text = String(el.innerText || "").toLowerCase();
  if (text.includes("autodarts")) score += 32;
  const navItems = el.querySelectorAll("a,button,[role='button'],li").length;
  if (navItems >= 6) score += 10;
  return score;
}

function findLeftMenuBrandNode() {
  const nodes = Array.from(document.querySelectorAll("a,div,span,h1,h2"));
  const norm = (t) => String(t || "").replace(/\s+/g, " ").trim().toUpperCase();
  let best = null;
  let bestLen = 1e9;
  for (const el of nodes) {
    const t = norm(el.textContent);
    if (!t.includes("AUTODARTS")) continue;
    if (t.length > 96) continue;
    if (t.length < bestLen) {
      bestLen = t.length;
      best = el;
    }
  }
  return best;
}

function findLeftMenuTarget() {
  // Strong anchor: element containing the brand text (nicht nur exakt „AUTODARTS“ — Chakra/Wrapper).
  const brandNode = findLeftMenuBrandNode();
  if (brandNode) {
    const chain = [];
    let cur = brandNode;
    for (let i = 0; i < 8 && cur; i += 1) {
      if (cur instanceof HTMLElement) chain.push(cur);
      cur = cur.parentElement;
    }
    let best = null;
    let bestScore = -1;
    chain.forEach((el) => {
      const s = scoreLeftMenuCandidate(el);
      if (s > bestScore) {
        bestScore = s;
        best = el;
      }
    });
    if (best) return best;
  }

  const selectors = [
    "aside",
    "nav",
    "[class*='sidebar']",
    "[class*='sideBar']",
    "[class*='drawer']",
    "[class*='menu']",
    "[id*='sidebar']",
    "[id*='menu']",
    "[id*='drawer']"
  ];
  const nodes = document.querySelectorAll(selectors.join(","));
  let best = null;
  let bestScore = -1;
  nodes.forEach((el) => {
    const s = scoreLeftMenuCandidate(el);
    if (s > bestScore) {
      bestScore = s;
      best = el;
    }
  });
  if (bestScore >= 0) return best;

  // Fallback: sample elements from the left viewport edge.
  for (let y = 60; y < window.innerHeight - 40; y += 90) {
    const stack = document.elementsFromPoint(8, y);
    for (const el of stack) {
      let cur = el;
      for (let i = 0; i < 8 && cur; i += 1) {
        if (cur instanceof HTMLElement) {
          const s = scoreLeftMenuCandidate(cur);
          if (s > bestScore) {
            bestScore = s;
            best = cur;
          }
        }
        cur = cur.parentElement;
      }
    }
  }
  return bestScore >= 0 ? best : null;
}

function backupTargetStyles(target) {
  if (!target || MENU_TARGET_STYLE_BACKUP.has(target)) return;
  MENU_TARGET_STYLE_BACKUP.set(target, {
    display: target.style.display || "",
    width: target.style.width || "",
    minWidth: target.style.minWidth || "",
    maxWidth: target.style.maxWidth || "",
    overflow: target.style.overflow || "",
    opacity: target.style.opacity || "",
    pointerEvents: target.style.pointerEvents || ""
  });
}

function restoreTargetStyles(target) {
  if (!target) return;
  const prev = MENU_TARGET_STYLE_BACKUP.get(target);
  if (!prev) return;
  target.style.display = prev.display;
  target.style.width = prev.width;
  target.style.minWidth = prev.minWidth;
  target.style.maxWidth = prev.maxWidth;
  target.style.overflow = prev.overflow;
  target.style.opacity = prev.opacity;
  target.style.pointerEvents = prev.pointerEvents;
}

function backupParentStyles(parent) {
  if (!parent || MENU_PARENT_STYLE_BACKUP.has(parent)) return;
  MENU_PARENT_STYLE_BACKUP.set(parent, {
    gridTemplateColumns: parent.style.gridTemplateColumns || ""
  });
}

function restoreParentStyles(parent) {
  if (!parent) return;
  const prev = MENU_PARENT_STYLE_BACKUP.get(parent);
  if (!prev) return;
  parent.style.gridTemplateColumns = prev.gridTemplateColumns;
}

function setMenuCollapsedState(collapsed) {
  const target = findLeftMenuTarget() || LAST_MENU_TARGET;
  if (!target) return;
  LAST_MENU_TARGET = target;
  target.setAttribute("data-adm-left-menu-target", "1");

  const parent = target.parentElement;
  backupTargetStyles(target);
  if (parent) backupParentStyles(parent);

  if (collapsed) {
    target.style.setProperty("display", "none", "important");
    target.style.setProperty("width", "0", "important");
    target.style.setProperty("min-width", "0", "important");
    target.style.setProperty("max-width", "0", "important");
    target.style.setProperty("overflow", "hidden", "important");
    target.style.setProperty("opacity", "0", "important");
    target.style.setProperty("pointer-events", "none", "important");

    if (parent) {
      const parentStyle = getComputedStyle(parent);
      if (parentStyle.display === "grid") {
        const cols = parentStyle.gridTemplateColumns || "";
        if (cols && cols.trim().split(/\s+/).length >= 2) {
          parent.style.setProperty("grid-template-columns", "0px 1fr", "important");
        }
      }
    }
    return;
  }

  restoreTargetStyles(target);
  if (parent) restoreParentStyles(parent);
}

function ensureMenuToggleButton() {
  getOrCreateMenuToggleStyle();
  let btn = document.getElementById(MENU_TOGGLE_BUTTON_ID);
  const target = findLeftMenuTarget();
  if (target) {
    target.setAttribute("data-adm-left-menu-target", "1");
    if (LAST_MENU_TARGET && LAST_MENU_TARGET !== target) {
      LAST_MENU_TARGET.removeAttribute("data-adm-left-menu-target");
    }
    LAST_MENU_TARGET = target;
  }
  if (!btn) {
    btn = document.createElement("button");
    btn.id = MENU_TOGGLE_BUTTON_ID;
    btn.type = "button";
    btn.title = "Autodarts Menu";
    btn.setAttribute("aria-label", "Autodarts Menu");
    btn.addEventListener("click", () => {
      const collapsed = document.documentElement.getAttribute("data-adm-left-menu-collapsed") !== "1";
      document.documentElement.setAttribute("data-adm-left-menu-collapsed", collapsed ? "1" : "0");
      setStoredMenuCollapsed(collapsed);
      setMenuCollapsedState(collapsed);
      const currentTarget = findLeftMenuTarget() || LAST_MENU_TARGET;
      positionMenuToggleButton(btn, currentTarget, collapsed);
    });
    mountBuilderFixedHost(btn);
  } else {
    mountBuilderFixedHost(btn);
  }

  btn.replaceChildren();
  btn.setAttribute("aria-label", "Autodarts Seitenleiste ein- oder ausblenden");
  btn.title = "Seitenleiste";
  const collapsed = getInitialMenuCollapsedForApply();
  document.documentElement.setAttribute("data-adm-left-menu-collapsed", collapsed ? "1" : "0");
  positionMenuToggleButton(btn, target, collapsed);
  setMenuCollapsedState(collapsed);
  if (!collapsed) clearMenuCollapseRetry();
  else if (!findLeftMenuTarget()) scheduleMenuCollapseRetryIfNeeded();
}

function findMenuLogoAnchor(target) {
  if (!target) return null;

  const iconNodes = Array.from(target.querySelectorAll("svg,img"));
  const candidates = [];
  iconNodes.forEach((node) => {
    const rect = node.getBoundingClientRect();
    if (rect.width < 12 || rect.height < 12) return;
    if (rect.width > 90 || rect.height > 90) return;
    if (rect.left > 120) return;
    if (rect.top > 180) return;

    const host = node.closest("a,button,div,span,header,nav,section");
    const hostText = String(host?.textContent || "").toUpperCase();
    const hasAutodartsText = hostText.includes("AUTODARTS");

    let score = 0;
    if (hasAutodartsText) score += 80;
    score += Math.max(0, 120 - rect.left);
    score += Math.max(0, 180 - rect.top);
    score += Math.max(0, 70 - Math.abs(rect.width - 32) - Math.abs(rect.height - 32));
    candidates.push({ node, score });
  });

  candidates.sort((a, b) => b.score - a.score);
  if (candidates.length > 0) return candidates[0].node;

  const brandNode = Array.from(target.querySelectorAll("a,div,span,h1,h2"))
    .find((el) => String(el.textContent || "").trim().toUpperCase().includes("AUTODARTS"));
  if (brandNode) {
    const icon = brandNode.querySelector("svg,img") || brandNode.previousElementSibling?.querySelector?.("svg,img");
    if (icon) return icon;
    return brandNode;
  }

  return target.querySelector("svg,img") || null;
}

function positionMenuToggleButton(btn, target, collapsed) {
  if (!btn) return;

  if (!collapsed) {
    const anchor = findMenuLogoAnchor(target);
    if (anchor) {
      const r = anchor.getBoundingClientRect();
      if (r.width > 10 && r.height > 10) {
        LAST_LOGO_RECT = { left: r.left, top: r.top, width: r.width, height: r.height };
      }
    }
  }

  const rect = LAST_LOGO_RECT || { left: 10, top: 10, width: 44, height: 44 };
  const side = Math.max(34, Math.min(58, Math.min(rect.width, rect.height)));
  btn.style.left = `${Math.max(6, Math.round(rect.left))}px`;
  btn.style.top = `${Math.max(6, Math.round(rect.top))}px`;
  btn.style.width = `${side}px`;
  btn.style.height = `${side}px`;
}

function clearMenuCollapseRetry() {
  if (!MENU_COLLAPSE_RETRY_TIMER) return;
  try {
    clearInterval(MENU_COLLAPSE_RETRY_TIMER);
  } catch {}
  MENU_COLLAPSE_RETRY_TIMER = null;
}

function scheduleMenuCollapseRetryIfNeeded() {
  if (!WEBSITE_THEME_STATE?.enabled) return;
  if (!getInitialMenuCollapsedForApply()) return;
  const tNow = findLeftMenuTarget();
  if (tNow) return;
  if (LAST_MENU_TARGET && LAST_MENU_TARGET.isConnected) return;
  if (MENU_COLLAPSE_RETRY_TIMER) return;
  let n = 0;
  MENU_COLLAPSE_RETRY_TIMER = setInterval(() => {
    n += 1;
    if (!WEBSITE_THEME_STATE?.enabled || !getInitialMenuCollapsedForApply()) {
      clearMenuCollapseRetry();
      return;
    }
    if (findLeftMenuTarget()) {
      clearMenuCollapseRetry();
      ensureMenuToggleButton();
      return;
    }
    if (n >= 50) clearMenuCollapseRetry();
  }, 400);
}

function removeMenuToggleButton() {
  clearMenuCollapseRetry();
  const btn = document.getElementById(MENU_TOGGLE_BUTTON_ID);
  if (btn) btn.remove();
  const style = document.getElementById(MENU_TOGGLE_STYLE_ID);
  if (style) style.remove();
  setMenuCollapsedState(false);
  document.documentElement.removeAttribute("data-adm-left-menu-collapsed");
  if (LAST_MENU_TARGET) {
    LAST_MENU_TARGET.removeAttribute("data-adm-left-menu-target");
    LAST_MENU_TARGET = null;
  }
}

function getOrCreateBuilderStyle() {
  ensureBuilderHintSubCss();
  let style = document.getElementById(BUILDER_STYLE_ID);
  if (style) {
    ensureBuilderCropFrameCss();
    return style;
  }
  style = document.createElement("style");
  style.id = BUILDER_STYLE_ID;
  style.textContent = `
    #${BUILDER_SAVE_BUTTON_ID}{
      position:fixed;
      top:12px;
      right:12px;
      z-index:2147483647;
      border:1px solid rgba(255,255,255,.24);
      background:rgba(8,14,24,.88);
      color:#fff;
      border-radius:10px;
      padding:8px 12px;
      font-weight:700;
      cursor:pointer;
    }
    #${BUILDER_RESET_BUTTON_ID}{
      position:fixed;
      top:56px;
      right:12px;
      z-index:2147483647;
      border:1px solid rgba(255,255,255,.24);
      background:rgba(8,14,24,.88);
      color:#fff;
      border-radius:10px;
      padding:8px 12px;
      font-weight:700;
      cursor:pointer;
    }
    #${BUILDER_PIN_BUTTON_ID}{
      position:fixed;
      top:100px;
      right:12px;
      z-index:2147483647;
      border:1px solid rgba(255,255,255,.24);
      background:rgba(8,14,24,.88);
      color:#fff;
      border-radius:10px;
      padding:8px 10px;
      font-weight:700;
      cursor:pointer;
      max-width:calc(100vw - 24px);
    }
    #${BUILDER_GRID_TOGGLE_ID}{
      position:fixed;
      top:144px;
      right:12px;
      z-index:2147483647;
      border:1px solid rgba(255,255,255,.24);
      background:rgba(8,14,24,.88);
      color:#fff;
      border-radius:10px;
      padding:7px 10px;
      font-weight:700;
      cursor:pointer;
      max-width:calc(100vw - 24px);
      font-size:12px;
    }
    #${BUILDER_BG_TRIGGER_ID}{
      position:fixed;
      top:12px;
      right:168px;
      z-index:2147483647;
      border:1px solid rgba(255,255,255,.24);
      background:rgba(8,14,24,.88);
      color:#fff;
      border-radius:999px;
      padding:6px 12px;
      font-weight:700;
      font-size:11px;
      cursor:pointer;
      max-width:min(140px, calc(100vw - 200px));
      box-sizing:border-box;
    }
    #${BUILDER_BG_POPOVER_ID}{
      position:fixed;
      top:52px;
      right:12px;
      z-index:2147483647;
      width:min(300px, calc(100vw - 24px));
      max-height:min(68vh, 520px);
      overflow:hidden;
      display:none;
      flex-direction:column;
      border:1px solid rgba(255,255,255,.22);
      border-radius:12px;
      background:rgba(8,14,24,.96);
      color:#fff;
      padding:10px 12px;
      box-shadow:0 18px 48px rgba(0,0,0,.4);
      box-sizing:border-box;
    }
    #${BUILDER_BG_POPOVER_ID}[data-open="1"]{
      display:flex;
    }
    #${BUILDER_BG_POPOVER_ID} .bbPopHead{
      font-weight:800;
      font-size:12px;
      margin:0 0 6px;
      opacity:.92;
    }
    #${BUILDER_BG_POPOVER_ID} .bbPopScroll{
      flex:1 1 auto;
      overflow-y:auto;
      overflow-x:hidden;
      min-height:0;
    }
    #${BUILDER_BG_POPOVER_ID} .bbGridEmpty{
      font-size:11px;
      line-height:1.4;
      opacity:.75;
      padding:6px 2px;
    }
    #${BUILDER_BG_POPOVER_ID} .bbGrid{
      display:grid;
      grid-template-columns:1fr 1fr;
      gap:8px;
      padding:2px 0 8px;
    }
    #${BUILDER_BG_POPOVER_ID} .bbGridBtn{
      display:flex;
      flex-direction:column;
      align-items:stretch;
      gap:4px;
      margin:0;
      padding:0;
      border:none;
      border-radius:10px;
      background:rgba(255,255,255,.06);
      cursor:pointer;
      color:#fff;
      text-align:left;
      overflow:hidden;
      border:1px solid rgba(255,255,255,.14);
    }
    #${BUILDER_BG_POPOVER_ID} .bbGridBtn:hover{
      border-color:rgba(25,199,255,.45);
      background:rgba(25,199,255,.12);
    }
    #${BUILDER_BG_POPOVER_ID} .bbGridBtn img{
      width:100%;
      height:56px;
      object-fit:cover;
      display:block;
      background:rgba(0,0,0,.25);
    }
    #${BUILDER_BG_POPOVER_ID} .bbGridCap{
      font-size:9.5px;
      line-height:1.25;
      padding:0 6px 6px;
      opacity:.88;
      display:-webkit-box;
      -webkit-line-clamp:2;
      -webkit-box-orient:vertical;
      overflow:hidden;
    }
    #${BUILDER_BG_POPOVER_ID} .bbPopFoot{
      margin-top:4px;
      padding-top:8px;
      border-top:1px solid rgba(255,255,255,.12);
    }
    #${BUILDER_BG_POPOVER_ID} .bbPopPick{
      display:block;
      width:100%;
      border-radius:10px;
      padding:8px 10px;
      border:1px solid rgba(25,199,255,.28);
      background:rgba(25,199,255,.16);
      color:#fff;
      font-weight:700;
      font-size:12px;
      cursor:pointer;
      box-sizing:border-box;
    }
    #${BUILDER_GRID_OVERLAY_ID}{
      position:fixed;
      inset:0;
      z-index:2147483640;
      pointer-events:none;
      display:none;
      background-image:
        linear-gradient(rgba(255,255,255,.09) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255,255,255,.09) 1px, transparent 1px);
      background-size:${BUILDER_GRID_STEP_PX}px ${BUILDER_GRID_STEP_PX}px;
      box-sizing:border-box;
    }
    #${BUILDER_MARQUEE_ID}{
      position:fixed;
      z-index:2147483645;
      pointer-events:none;
      box-sizing:border-box;
      display:none;
      border:1px dashed rgba(25,199,255,.92);
      background:rgba(25,199,255,.1);
    }
    #${BUILDER_HINT_ID}{
      position:fixed;
      left:12px;
      bottom:12px;
      z-index:2147483646;
      max-width:min(360px, calc(100vw - 24px));
      padding:10px 12px;
      border-radius:10px;
      border:1px solid rgba(255,255,255,.2);
      background:rgba(8,14,24,.9);
      color:rgba(255,255,255,.88);
      font-size:11px;
      line-height:1.45;
      pointer-events:none;
      white-space:pre-line;
      box-shadow:0 4px 18px rgba(0,0,0,.35);
    }
    #${BUILDER_BOX_ID}{
      position:fixed;
      z-index:2147483647;
      border:2px dashed rgba(120,220,255,.95);
      background:rgba(27,197,255,.08);
      pointer-events:none;
      box-sizing:border-box;
      display:none;
      isolation:isolate;
    }
    #${BUILDER_FULL_OUTLINE_ID}{
      position:fixed;
      z-index:2147483646;
      pointer-events:none;
      box-sizing:border-box;
      display:none;
      border:1px solid rgba(232,242,255,.72);
      box-shadow:0 0 0 1px rgba(232,242,255,.35) inset, 0 0 12px rgba(170,206,255,.28);
      background:transparent;
    }
    #${BUILDER_HANDLE_ID}{
      position:absolute;
      right:-6px;
      bottom:-6px;
      width:12px;
      height:12px;
      border-radius:3px;
      border:1px solid rgba(255,255,255,.9);
      background:#19c7ff;
      pointer-events:auto;
      cursor:nwse-resize;
      z-index:4;
    }
    #${BUILDER_ROTATE_HANDLE_ID}{
      position:absolute;
      left:-6px;
      top:-6px;
      width:12px;
      height:12px;
      border-radius:50%;
      border:1px solid rgba(255,255,255,.9);
      background:#ffb020;
      pointer-events:auto;
      cursor:grab;
      z-index:4;
    }
    #${BUILDER_BOX_ID} [data-adm-builder-edge]{
      position:absolute;
      background:transparent;
      pointer-events:auto;
      z-index:3;
      box-sizing:border-box;
    }
    #${BUILDER_BOX_ID} [data-adm-builder-edge="t"]{ left:18px; right:18px; top:-6px; height:12px; cursor:ns-resize; }
    #${BUILDER_BOX_ID} [data-adm-builder-edge="b"]{ left:18px; right:18px; bottom:-6px; height:12px; cursor:ns-resize; }
    #${BUILDER_BOX_ID} [data-adm-builder-edge="l"]{ top:18px; bottom:18px; left:-6px; width:12px; cursor:ew-resize; }
    #${BUILDER_BOX_ID} [data-adm-builder-edge="r"]{ top:18px; bottom:18px; right:-6px; width:12px; cursor:ew-resize; }
    [data-adm-builder-hit="1"]{
      outline:none !important;
      outline-offset:0 !important;
      cursor:move !important;
    }
    #${BUILDER_DIALOG_ID}{
      position:fixed;
      right:12px;
      top:56px;
      z-index:2147483647;
      width:280px;
      border:1px solid rgba(255,255,255,.22);
      border-radius:12px;
      background:rgba(8,14,24,.96);
      color:#fff;
      padding:12px;
      display:none;
    }
    #${BUILDER_DIALOG_ID} .row{
      margin-top:8px;
    }
    #${BUILDER_DIALOG_ID} .lbl{
      font-size:12px;
      opacity:.86;
      margin-bottom:4px;
      display:block;
    }
    #${BUILDER_DIALOG_ID} input[type="text"]{
      width:100%;
      border-radius:8px;
      border:1px solid rgba(255,255,255,.2);
      background:rgba(255,255,255,.06);
      color:#fff;
      padding:8px;
      outline:none;
    }
    #${BUILDER_DIALOG_ID} .checks{
      display:flex;
      gap:12px;
      align-items:center;
      margin-top:4px;
      font-size:12px;
    }
    #${BUILDER_DIALOG_ID} .actions{
      display:flex;
      justify-content:flex-end;
      gap:8px;
      margin-top:12px;
    }
    #${BUILDER_DIALOG_ID} button{
      border:1px solid rgba(255,255,255,.24);
      background:rgba(255,255,255,.08);
      color:#fff;
      border-radius:8px;
      padding:6px 10px;
      cursor:pointer;
      font-weight:700;
    }
    #${BUILDER_DIALOG_ID} button.primary{
      border-color:rgba(25,199,255,.45);
      background:rgba(25,199,255,.22);
    }
    #${BUILDER_PIN_PANEL_ID}{
      position:fixed;
      right:12px;
      top:188px;
      z-index:2147483647;
      width:280px;
      max-height:50vh;
      overflow:auto;
      border:1px solid rgba(255,255,255,.22);
      border-radius:12px;
      background:rgba(8,14,24,.94);
      color:#fff;
      padding:10px;
      display:none;
      box-shadow:0 18px 48px rgba(0,0,0,.34);
    }
    #${BUILDER_PIN_PANEL_ID}[data-open="1"]{
      display:block;
    }
    #${BUILDER_PIN_PANEL_ID} .pinHead{
      display:flex;
      align-items:center;
      justify-content:space-between;
      gap:8px;
      margin-bottom:8px;
    }
    #${BUILDER_PIN_PANEL_ID} .pinTtl{
      font-weight:800;
      font-size:12px;
      margin:0;
      opacity:.92;
    }
    #${BUILDER_PIN_PANEL_ID} .pinClose{
      border:1px solid rgba(255,255,255,.16);
      background:rgba(255,255,255,.06);
      color:#fff;
      border-radius:8px;
      width:28px;
      height:28px;
      cursor:pointer;
      font-weight:700;
      padding:0;
    }
    #${BUILDER_PIN_PANEL_ID} .pinRow{
      display:flex;
      align-items:center;
      justify-content:space-between;
      gap:10px;
      width:100%;
      margin-top:6px;
      padding:8px 10px;
      border-radius:10px;
      border:1px solid rgba(255,255,255,.12);
      background:rgba(255,255,255,.04);
      color:#fff;
      cursor:pointer;
      text-align:left;
      font-size:12px;
      box-sizing:border-box;
    }
    #${BUILDER_PIN_PANEL_ID} .pinRow:hover{
      background:rgba(255,255,255,.08);
    }
    #${BUILDER_PIN_PANEL_ID} .pinCb{
      width:16px;
      height:16px;
      flex-shrink:0;
      accent-color:#19c7ff;
      cursor:pointer;
    }
    #${BUILDER_PIN_PANEL_ID} .pinLabel{
      flex:1;
      min-width:0;
      overflow:hidden;
      text-overflow:ellipsis;
      white-space:nowrap;
    }
    #${BUILDER_PIN_PANEL_ID} .pinLock{
      font-size:20px;
      line-height:1;
      flex-shrink:0;
    }
    #${BUILDER_PIN_PANEL_ID} .pinLock.on{
      opacity:1;
      filter:none;
    }
    #${BUILDER_PIN_PANEL_ID} .pinLock.off{
      opacity:0.4;
      filter:grayscale(1);
    }
    #${BUILDER_PIN_PANEL_ID} .pinRow--missing{
      opacity:0.55;
      cursor:default;
    }
    #${BUILDER_PIN_PANEL_ID} .pinRow--missing:hover{
      background:rgba(255,255,255,.04);
    }
    #${BUILDER_PIN_PANEL_ID} .pinSub{
      display:block;
      font-size:10px;
      opacity:0.72;
      margin-top:2px;
      font-weight:400;
    }
    #${BUILDER_COLORS_PANEL_ID}{
      width:100%;
      flex:0 0 auto;
      border:1px solid rgba(255,255,255,.22);
      border-radius:12px;
      background:rgba(8,14,24,.94);
      color:#fff;
      padding:10px 12px;
      box-shadow:0 18px 48px rgba(0,0,0,.34);
      box-sizing:border-box;
    }
    #${BUILDER_COLORS_PANEL_ID} .bcHead{
      font-weight:800;
      font-size:12px;
      margin:0 0 8px;
      opacity:.92;
    }
    #${BUILDER_COLORS_PANEL_ID} .bcRow{
      margin-top:10px;
    }
    #${BUILDER_COLORS_PANEL_ID} .bcLab{
      display:flex;
      justify-content:space-between;
      align-items:baseline;
      gap:8px;
      font-size:11px;
      opacity:.88;
      margin-bottom:4px;
    }
    #${BUILDER_COLORS_PANEL_ID} .bcDeg{
      font-variant-numeric:tabular-nums;
      opacity:.95;
      font-weight:700;
    }
    #${BUILDER_COLORS_PANEL_ID} .bcHue{
      width:100%;
      accent-color:hsl(var(--hue, 210) 82% 52%);
    }
    #${BUILDER_BG_POPOVER_ID} .bbPopLbl{
      display:block;
      margin-top:10px;
      font-size:11px;
      opacity:.88;
    }
    #${BUILDER_BG_POPOVER_ID} .bbPopSel{
      width:100%;
      margin-top:4px;
      border-radius:8px;
      border:1px solid rgba(255,255,255,.2);
      background:rgba(255,255,255,.06);
      color:#fff;
      padding:6px 8px;
      font-size:12px;
      box-sizing:border-box;
    }
    #${BUILDER_BG_POPOVER_ID} .bbPopClear{
      display:block;
      width:100%;
      margin-top:8px;
      border-radius:10px;
      padding:7px 10px;
      border:1px solid rgba(255,255,255,.22);
      background:rgba(255,255,255,.08);
      color:#fff;
      font-weight:700;
      font-size:11px;
      cursor:pointer;
      box-sizing:border-box;
    }
    #${BUILDER_BG_POPOVER_ID} .bbPopClear:hover{
      border-color:rgba(255,120,120,.45);
      background:rgba(255,80,80,.12);
    }
    html[data-adm-builder-freeze="1"]{
      scroll-behavior:auto !important;
    }
    html[data-adm-builder-freeze="1"] *{
      animation:none !important;
      transition:none !important;
    }
  `;
  (document.head || document.documentElement).appendChild(style);
  ensureBuilderCropFrameCss();
  return style;
}

function cssEscapeSafe(v) {
  if (globalThis.CSS && CSS.escape) return CSS.escape(String(v || ""));
  return String(v || "").replace(/[^\w-]/g, "");
}

function cloneBuilderData(data) {
  try { return JSON.parse(JSON.stringify(data || {})); } catch { return {}; }
}

function pruneBuilderDataToMovableKeys(data) {
  const c = cloneBuilderData(data);
  Object.keys(c).forEach((k) => {
    if (!BUILDER_MOVABLE_KEY_SET.has(k)) delete c[k];
  });
  return c;
}

/** Glow folgt der Scheibe — nicht als eigenes Layout-Objekt speichern; nur erlaubte Keys behalten. */
function stripDartboardGlowFromBuilderData(data) {
  const c = cloneBuilderData(data);
  delete c[DARTBOARD_GLOW_TARGET_KEY];
  return pruneBuilderDataToMovableKeys(c);
}

function commitBuilderHistorySnapshot() {
  const snap = cloneBuilderData(BUILDER_DATA);
  const asJson = JSON.stringify(snap);
  const current = BUILDER_HISTORY[BUILDER_HISTORY_INDEX];
  if (current && JSON.stringify(current) === asJson) return;
  BUILDER_HISTORY = BUILDER_HISTORY.slice(0, BUILDER_HISTORY_INDEX + 1);
  BUILDER_HISTORY.push(snap);
  BUILDER_HISTORY_INDEX = BUILDER_HISTORY.length - 1;
}

function undoBuilderStep() {
  if (!BUILDER_ACTIVE) return;
  if (BUILDER_HISTORY_INDEX <= 0) return;
  const selectedKey = String(BUILDER_SELECTED_SELECTOR || "");
  flushBuilderWheelCommitPending();
  BUILDER_DRAG = null;
  BUILDER_RESIZE = null;
  BUILDER_ROTATE_DRAG = null;
  BUILDER_CROP_DRAG = null;
  BUILDER_PERSP_EDGE_DRAG = null;
  BUILDER_HISTORY_INDEX -= 1;
  BUILDER_DATA = pruneBuilderDataToMovableKeys(cloneBuilderData(BUILDER_HISTORY[BUILDER_HISTORY_INDEX]));
  BUILDER_DATA_BY_MODE[BUILDER_ACTIVE_PLAY_MODE] = BUILDER_DATA;
  applyBuilderDataToDom();
  if (selectedKey) rebindBuilderTargetKey(selectedKey);
  else {
    BUILDER_SELECTED_KEYS = [];
    clearBuilderSelectionHitMarkers();
    syncBuilderPrimaryFromKeys();
  }
  refreshBuilderSelectionBox();
}

function isRectVisible(r) {
  return !!r && r.width > 10 && r.height > 10 && r.bottom > 0 && r.right > 0 && r.top < window.innerHeight && r.left < window.innerWidth;
}

function isBuilderElement(node) {
  return !!node && node instanceof Element;
}

function getElementClassName(el) {
  if (!el) return "";
  const raw = el.className;
  if (typeof raw === "string") return raw;
  if (raw && typeof raw.baseVal === "string") return raw.baseVal;
  return "";
}

function getElementHint(el) {
  if (!el) return "";
  return `${getElementClassName(el)} ${el.id || ""}`.toLowerCase();
}

function normalizeBuilderPickElement(node) {
  if (!isBuilderElement(node)) return null;
  let chosen = node;
  const tinySvgTags = new Set(["path", "circle", "ellipse", "line", "polyline", "polygon", "g", "text", "tspan", "use"]);
  const tag = String(chosen.tagName || "").toLowerCase();
  if (tinySvgTags.has(tag)) {
    const svgRoot = chosen.closest("svg");
    if (svgRoot) chosen = svgRoot;
  }

  // If user clicked a tiny inner node, climb to a more useful movable container.
  let best = chosen;
  let cur = chosen;
  for (let i = 0; i < 8 && cur; i += 1) {
    if (isBuilderElement(cur)) {
      const r = cur.getBoundingClientRect();
      if (isRectVisible(r) && r.width >= 24 && r.height >= 24) {
        best = cur;
        if (r.width >= 90 && r.height >= 44) break;
      }
    }
    cur = cur.parentElement;
  }
  return best;
}

function isBuilderUiTarget(node) {
  if (!isBuilderElement(node)) return false;
  if (node.closest("[data-adm-builder-edge]")) return true;
  if (
    node.id === BUILDER_SAVE_BUTTON_ID ||
    node.id === BUILDER_RESET_BUTTON_ID ||
    node.id === BUILDER_PIN_BUTTON_ID ||
    node.id === BUILDER_GRID_TOGGLE_ID ||
    node.id === BUILDER_BOX_ID ||
    node.id === BUILDER_HANDLE_ID ||
    node.id === BUILDER_ROTATE_HANDLE_ID
  ) {
    return true;
  }
  if (node.closest(`#${BUILDER_SAVE_BUTTON_ID}`)) return true;
  if (node.closest(`#${BUILDER_RESET_BUTTON_ID}`)) return true;
  if (node.closest(`#${BUILDER_PIN_BUTTON_ID}`)) return true;
  if (node.closest(`#${BUILDER_GRID_TOGGLE_ID}`)) return true;
  if (node.closest(`#${BUILDER_BOX_ID}`)) return true;
  if (node.closest(`#${BUILDER_DIALOG_ID}`)) return true;
  if (node.closest(`#${BUILDER_PIN_PANEL_ID}`)) return true;
  if (node.closest(`#${BUILDER_COLORS_PANEL_ID}`)) return true;
  if (node.id === BUILDER_BG_TRIGGER_ID || node.closest(`#${BUILDER_BG_TRIGGER_ID}`)) return true;
  if (node.id === BUILDER_BG_POPOVER_ID || node.closest(`#${BUILDER_BG_POPOVER_ID}`)) return true;
  if (node.closest(`#${MENU_TOGGLE_BUTTON_ID}`)) return true;
  return false;
}

/** Auswahlrahmen / Handles — nicht für Treffer-Priorität unter dem Mauszeiger verwenden. */
function isBuilderChromeNode(node) {
  if (!isBuilderElement(node)) return false;
  const id = String(node.id || "");
  if (id === BUILDER_BOX_ID || id === BUILDER_HANDLE_ID || id === BUILDER_ROTATE_HANDLE_ID || id === BUILDER_FULL_OUTLINE_ID) return true;
  if (node.closest(`#${BUILDER_BOX_ID}`) || node.closest(`#${BUILDER_FULL_OUTLINE_ID}`)) return true;
  return false;
}

function blockBuilderEvent(ev) {
  if (!ev) return;
  ev.preventDefault();
  ev.stopPropagation();
  if (typeof ev.stopImmediatePropagation === "function") ev.stopImmediatePropagation();
}

function clearBuilderTargetMarks() {
  document.querySelectorAll(SEL_SB_BUILDER_TARGET).forEach((el) => {
    delete el.dataset.adSbBuilderTarget;
    delete el.dataset.adSbBuilderKey;
  });
  document.querySelectorAll(SEL_SB_BUILDER_COMPANION).forEach((el) => {
    delete el.dataset.adSbBuilderCompanionFor;
  });
}

function updateBuilderPinVisibility() {
  const panel = document.getElementById(BUILDER_PIN_PANEL_ID);
  const onPlayfield = pathnameIndicatesWebsiteThemesPlayfield();
  const showOpen = BUILDER_PIN_OPEN && onPlayfield;
  if (panel) panel.dataset.open = showOpen ? "1" : "0";
  const btn = document.getElementById(BUILDER_PIN_BUTTON_ID);
  if (btn) btn.textContent = showOpen ? "Feststellen ▴" : "Feststellen ▾";
}

function isBuilderTargetLocked(key) {
  const k = String(key || "");
  if (!k) return false;
  return !!getBuilderEntry(k)?.locked;
}

/** Union-Rechteck Scheibe + Glow (Viewport), für Auswahlrahmen. */
function getDartboardSelectionUnionRect() {
  const board = getTargetByKey("dartboard")?.el;
  const glow = getTargetByKey(DARTBOARD_GLOW_TARGET_KEY)?.el;
  const rects = [];
  if (isBuilderElement(board) && document.contains(board)) rects.push(board.getBoundingClientRect());
  if (isBuilderElement(glow) && document.contains(glow)) rects.push(glow.getBoundingClientRect());
  if (!rects.length) return null;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  rects.forEach((r) => {
    if (!r || !Number.isFinite(r.left)) return;
    left = Math.min(left, r.left);
    top = Math.min(top, r.top);
    right = Math.max(right, r.right);
    bottom = Math.max(bottom, r.bottom);
  });
  if (!Number.isFinite(left)) return null;
  return { left, top, width: Math.max(10, right - left), height: Math.max(10, bottom - top) };
}

function escapeHtmlAttr(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

function ensureBuilderPinPanel() {
  let panel = document.getElementById(BUILDER_PIN_PANEL_ID);
  if (!panel) {
    panel = document.createElement("div");
    panel.id = BUILDER_PIN_PANEL_ID;
    mountBuilderFixedHost(panel);
    panel.addEventListener("change", (ev) => {
      if (!pathnameIndicatesWebsiteThemesPlayfield()) return;
      const inp = ev.target;
      if (!inp || !inp.matches || !inp.matches("input.pinCb")) return;
      if (inp.disabled) return;
      const k = String(inp.getAttribute("data-builder-pin-key") || "").trim();
      if (!k) return;
      const v = !!inp.checked;
      const entry = getBuilderEntry(k);
      entry.locked = v;
      commitBuilderHistorySnapshot();
      ensureBuilderPinPanel();
      updateBuilderPinVisibility();
      if (BUILDER_SELECTED_KEYS.includes(k)) refreshBuilderSelectionBox();
      try {
        saveBuilderDataToSettings();
      } catch {}
    });
  } else {
    mountBuilderFixedHost(panel);
  }
  const pinKeys = getEffectiveBuilderTargetKeys().filter((t) => {
    if (BUILDER_PIN_OPTIONAL_KEYS.has(t.key)) {
      const tgt = getTargetByKey(t.key);
      return isBuilderElement(tgt?.el) && document.contains(tgt.el);
    }
    return true;
  });
  const rows = pinKeys
    .map((t) => {
      const present = isPinTargetPresentInLayout(t.key);
      const locked = isBuilderTargetLocked(t.key);
      const ico = locked ? "🔒" : "🔓";
      const cls = locked ? "pinLock on" : "pinLock off";
      const lab = escapeHtmlAttr(t.label);
      const rowCls = present ? "pinRow" : "pinRow pinRow--missing";
      const sub = present ? "" : `<span class="pinSub">(aktuell nicht im Layout)</span>`;
      const dis = present ? "" : "disabled";
      return `
      <label class="${rowCls}" title="Sperrt Verschieben, Größe, Drehen und Tasten-Anpassungen">
        <input type="checkbox" class="pinCb" data-builder-pin-key="${t.key}" ${locked ? "checked" : ""} ${dis} />
        <span class="pinLabel">${lab}${sub}</span>
        <span class="${cls}" aria-hidden="true">${ico}</span>
      </label>`;
    })
    .join("");
  const openState = BUILDER_PIN_OPEN ? "1" : "0";
  panel.dataset.open = openState;
  const rowsHtml = rows || '<div class="pinEmpty" style="font-size:11px;opacity:.75;padding:4px 0;">Keine Ziele auf dieser Ansicht erkannt.</div>';
  const renderSig = `${openState}|${rowsHtml}`;
  if (panel.dataset.renderSig !== renderSig) {
    panel.dataset.renderSig = renderSig;
    panel.innerHTML = `
      <div class="pinHead">
        <div class="pinTtl">Elemente sperren</div>
        <button type="button" class="pinClose" data-builder-pin-close="1" aria-label="Schliessen">X</button>
      </div>
      ${rowsHtml}
    `;
    panel.querySelector("[data-builder-pin-close='1']")?.addEventListener("click", () => {
      BUILDER_PIN_OPEN = false;
      updateBuilderPinVisibility();
    });
  }
}

function compressImageFileToDataUrlForThemes(file, maxEdge = 1920, quality = 0.82) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type || !String(file.type).startsWith("image/")) {
      reject(new Error("not_image"));
      return;
    }
    const img = new Image();
    const objUrl = URL.createObjectURL(file);
    img.onload = () => {
      try {
        let w = img.naturalWidth || img.width;
        let h = img.naturalHeight || img.height;
        if (!w || !h) throw new Error("bad_dimensions");
        const scale = w > maxEdge || h > maxEdge ? Math.min(maxEdge / w, maxEdge / h) : 1;
        w = Math.max(1, Math.round(w * scale));
        h = Math.max(1, Math.round(h * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("no_canvas");
        ctx.drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        URL.revokeObjectURL(objUrl);
        resolve(dataUrl);
      } catch (e) {
        try {
          URL.revokeObjectURL(objUrl);
        } catch {}
        reject(e);
      }
    };
    img.onerror = () => {
      try {
        URL.revokeObjectURL(objUrl);
      } catch {}
      reject(new Error("image_load_failed"));
    };
    img.src = objUrl;
  });
}

function schedulePersistBuilderBackgroundSettings() {
  if (BUILDER_BG_SAVE_TIMER) {
    try {
      clearTimeout(BUILDER_BG_SAVE_TIMER);
    } catch {}
    BUILDER_BG_SAVE_TIMER = null;
  }
  BUILDER_BG_SAVE_TIMER = /** @type {any} */ (setTimeout(() => {
    BUILDER_BG_SAVE_TIMER = null;
    try {
      if (!chrome?.storage?.local) return;
      chrome.storage.local.get(["settings"], (items) => {
        const settings = { ...(items?.settings || {}) };
        settings.websiteBackgroundImageDataMatch = WEBSITE_THEME_STATE.backgroundImageDataMatch;
        settings.websiteBackgroundSize = WEBSITE_THEME_STATE.backgroundSize;
        chrome.storage.local.set({ settings }, () => {
          void chrome.runtime?.lastError;
        });
      });
    } catch {}
  }, 400));
}

function syncBuilderBackgroundPanelFromState() {
  if (!BUILDER_ACTIVE) return;
  const raw = String(WEBSITE_THEME_STATE.backgroundImageDataMatch || "").trim();
  const sel = document.getElementById("adSbBuilderBgSize");
  if (sel) {
    const v = String(WEBSITE_THEME_STATE.backgroundSize || "cover").toLowerCase();
    sel.value = v === "contain" || v === "auto" ? v : "cover";
  }
  const wrap = document.getElementById("adSbBuilderBgPreviewWrap");
  const img = document.getElementById("adSbBuilderBgPreview");
  if (wrap && img) {
    if (raw) {
      img.src = raw.startsWith("data:") ? raw : `data:image/jpeg;base64,${raw}`;
      wrap.style.display = "";
    } else {
      img.removeAttribute("src");
      wrap.style.display = "none";
    }
  }
  if (BUILDER_BG_POPOVER_OPEN) renderBuilderBackgroundPopoverGrid();
}

function detachBuilderBgPopoverDocClose() {
  if (BUILDER_BG_POPOVER_DOC_MDOWN) {
    try {
      document.removeEventListener("mousedown", BUILDER_BG_POPOVER_DOC_MDOWN, true);
    } catch {}
    BUILDER_BG_POPOVER_DOC_MDOWN = null;
  }
}

function setBuilderBackgroundPopoverOpen(want) {
  const open = !!want;
  BUILDER_BG_POPOVER_OPEN = open;
  const pop = document.getElementById(BUILDER_BG_POPOVER_ID);
  const tr = document.getElementById(BUILDER_BG_TRIGGER_ID);
  if (pop) pop.dataset.open = open ? "1" : "0";
  if (tr) tr.setAttribute("aria-expanded", open ? "true" : "false");
  detachBuilderBgPopoverDocClose();
  if (open) {
    BUILDER_BG_POPOVER_DOC_MDOWN = (ev) => {
      if (!BUILDER_BG_POPOVER_OPEN) return;
      const t = ev.target;
      if (!(t instanceof Element)) return;
      if (t.closest(`#${BUILDER_BG_POPOVER_ID}`) || t.closest(`#${BUILDER_BG_TRIGGER_ID}`)) return;
      setBuilderBackgroundPopoverOpen(false);
    };
    document.addEventListener("mousedown", BUILDER_BG_POPOVER_DOC_MDOWN, true);
    renderBuilderBackgroundPopoverGrid();
  }
}

function themeRowBackgroundImageDataUrl(row) {
  const raw = String(row?.backgroundImageDataMatch || "").trim();
  if (!raw) return "";
  if (raw.startsWith("data:")) return raw.startsWith("data:image") ? raw : "";
  return raw.length >= 40 ? `data:image/jpeg;base64,${raw}` : "";
}

function extractDataImageUrlsFromThemeCss(css) {
  const s = String(css || "");
  if (!s.includes("data:image")) return [];
  const out = [];
  const re = /url\s*\(\s*(["']?)(data:image\/(?:png|jpe?g|webp|gif|avif);base64,[a-z0-9+/=\r\n]+)\1\s*\)/gi;
  let m;
  while ((m = re.exec(s)) !== null) {
    const u = String(m[2] || "").replace(/\s/g, "");
    if (u.startsWith("data:image")) out.push(u);
  }
  return out;
}

function collectThemeBackgroundPresets() {
  const seen = new Set();
  /** @type {{ key: string, label: string, dataUrl: string, size: string }[]} */
  const out = [];
  const push = (dataUrl, sizeRaw, label, key) => {
    const dataUrlStr = String(dataUrl || "").trim();
    if (!dataUrlStr.startsWith("data:image")) return;
    if (seen.has(dataUrlStr)) return;
    seen.add(dataUrlStr);
    const sz0 = String(sizeRaw || "cover").toLowerCase();
    const size = sz0 === "contain" || sz0 === "auto" ? sz0 : "cover";
    out.push({ key, label, dataUrl: dataUrlStr, size });
  };

  const cur = String(WEBSITE_THEME_STATE.backgroundImageDataMatch || "").trim();
  if (cur) {
    const du = cur.startsWith("data:") ? cur : `data:image/jpeg;base64,${cur}`;
    push(du, WEBSITE_THEME_STATE.backgroundSize, "Aktuelles / hochgeladenes Bild", "preset-current");
  }

  const sets = getThemeSetsFromState(WEBSITE_THEME_STATE);
  const walk = (rows, lay) => {
    (rows || []).forEach((row) => {
      const id = String(row?.id || "").toLowerCase();
      const lab = String(row?.label || row?.name || id || "Theme").trim() || id;
      const fromField = themeRowBackgroundImageDataUrl(row);
      if (fromField) {
        push(fromField, row?.backgroundSize, `${lab} (${lay})`, `preset-${id}-${lay}-field`);
      }
      const urls = extractDataImageUrlsFromThemeCss(row?.css);
      urls.forEach((u, i) => {
        push(u, "cover", `${lab} · Bild ${i + 1} (${lay})`, `preset-${id}-${lay}-css-${i}`);
      });
    });
  };
  walk(sets.horizontal, "H");
  walk(sets.vertical, "V");
  return out;
}

function applyBuilderBackgroundPreset(entry) {
  if (!entry || !entry.dataUrl) return;
  WEBSITE_THEME_STATE.backgroundImageDataMatch = entry.dataUrl;
  const sz = String(entry.size || "cover").toLowerCase();
  WEBSITE_THEME_STATE.backgroundSize = sz === "contain" || sz === "auto" ? sz : "cover";
  applyWebsiteTheme();
  syncBuilderBackgroundPanelFromState();
  schedulePersistBuilderBackgroundSettings();
  setBuilderBackgroundPopoverOpen(false);
}

function renderBuilderBackgroundPopoverGrid() {
  const grid = document.getElementById("adSbBuilderBgPresetGrid");
  if (!grid) return;
  const presets = collectThemeBackgroundPresets();
  if (!presets.length) {
    grid.innerHTML =
      '<div class="bbGridEmpty">Keine Bild-Hintergründe in den Theme-Sets (nur Verläufe/Farben). Nutze „Eigenes Bild …“ oder die Darstellung unten.</div>';
    return;
  }
  grid.replaceChildren();
  presets.forEach((p) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "bbGridBtn";
    btn.title = p.label;
    const img = document.createElement("img");
    img.alt = "";
    img.loading = "lazy";
    img.src = p.dataUrl;
    const cap = document.createElement("span");
    cap.className = "bbGridCap";
    cap.textContent = p.label;
    btn.appendChild(img);
    btn.appendChild(cap);
    btn.addEventListener("click", () => applyBuilderBackgroundPreset(p));
    grid.appendChild(btn);
  });
}

function getBuilderBackgroundPopoverMarkup() {
  return `
      <input type="file" id="adSbBuilderBgFile" accept="image/*" hidden />
      <div class="bbPopHead">Hintergrund</div>
      <div class="bbPopScroll">
        <div id="adSbBuilderBgPresetGrid" class="bbGrid"></div>
      </div>
      <div class="bbPopFoot">
        <button type="button" class="bbPopPick" id="adSbBuilderBgPopoverPick">Eigenes Bild …</button>
        <label class="bbPopLbl" for="adSbBuilderBgSize">Darstellung</label>
        <select id="adSbBuilderBgSize" class="bbPopSel">
          <option value="cover">Cover</option>
          <option value="contain">Contain</option>
          <option value="auto">Auto</option>
        </select>
        <button type="button" class="bbPopClear" id="adSbBuilderBgPopoverClear">Entfernen</button>
        <div id="adSbBuilderBgPreviewWrap" style="margin-top:8px;display:none;">
          <img id="adSbBuilderBgPreview" alt="" style="max-width:100%;max-height:72px;border-radius:8px;border:1px solid rgba(127,127,127,.35);" />
        </div>
        <div class="bbHint" style="margin-top:8px;font-size:9.5px;line-height:1.35;opacity:.72;">Wird mit dem Theme gespeichert (Extension).</div>
      </div>
    `;
}

function wireBuilderBackgroundPopoverControls(pop) {
  if (!pop || pop.dataset.admBgWired === "1") return;
  pop.dataset.admBgWired = "1";
  pop.querySelector("#adSbBuilderBgPopoverPick")?.addEventListener("click", (ev) => {
    try {
      ev.preventDefault();
      ev.stopPropagation();
    } catch {}
    try {
      pop.querySelector("#adSbBuilderBgFile")?.click();
    } catch {}
    setBuilderBackgroundPopoverOpen(false);
  });
  pop.querySelector("#adSbBuilderBgFile")?.addEventListener("change", async (ev) => {
    const input = ev.target;
    const file = input?.files?.[0];
    if (input) input.value = "";
    if (!file) return;
    if (file.size > 18 * 1024 * 1024) {
      try {
        window.alert("Datei zu groß (max. ca. 18 MB).");
      } catch {}
      return;
    }
    try {
      const dataUrl = await compressImageFileToDataUrlForThemes(file);
      WEBSITE_THEME_STATE.backgroundImageDataMatch = dataUrl;
      applyWebsiteTheme();
      syncBuilderBackgroundPanelFromState();
      schedulePersistBuilderBackgroundSettings();
    } catch {
      try {
        window.alert("Bild konnte nicht gelesen werden.");
      } catch {}
    }
  });
  pop.querySelector("#adSbBuilderBgPopoverClear")?.addEventListener("click", () => {
    WEBSITE_THEME_STATE.backgroundImageDataMatch = "";
    applyWebsiteTheme();
    syncBuilderBackgroundPanelFromState();
    schedulePersistBuilderBackgroundSettings();
  });
  pop.querySelector("#adSbBuilderBgSize")?.addEventListener("change", (ev) => {
    const v = String(ev.target?.value || "cover").toLowerCase();
    WEBSITE_THEME_STATE.backgroundSize = v === "contain" || v === "auto" ? v : "cover";
    applyWebsiteTheme();
    schedulePersistBuilderBackgroundSettings();
  });
}

function ensureBuilderBackgroundTriggerAndPopover() {
  getOrCreateBuilderStyle();
  let tr = document.getElementById(BUILDER_BG_TRIGGER_ID);
  if (!tr) {
    tr = document.createElement("button");
    tr.id = BUILDER_BG_TRIGGER_ID;
    tr.type = "button";
    tr.textContent = "Hintergrund";
    tr.title = "Hintergründe aus allen Themes oder eigenes Bild";
    tr.setAttribute("aria-expanded", "false");
    tr.setAttribute("aria-controls", BUILDER_BG_POPOVER_ID);
    tr.addEventListener("click", (ev) => {
      try {
        ev.preventDefault();
        ev.stopPropagation();
      } catch {}
      setBuilderBackgroundPopoverOpen(!BUILDER_BG_POPOVER_OPEN);
    });
    mountBuilderFixedHost(tr);
  } else {
    mountBuilderFixedHost(tr);
  }

  let pop = document.getElementById(BUILDER_BG_POPOVER_ID);
  if (!pop) {
    pop = document.createElement("div");
    pop.id = BUILDER_BG_POPOVER_ID;
    pop.dataset.open = "0";
    pop.setAttribute("role", "region");
    pop.setAttribute("aria-label", "Hintergrund wählen");
    pop.innerHTML = getBuilderBackgroundPopoverMarkup();
    mountBuilderFixedHost(pop);
  } else {
    mountBuilderFixedHost(pop);
    if (!pop.querySelector("#adSbBuilderBgPopoverClear")) {
      delete pop.dataset.admBgWired;
      pop.innerHTML = getBuilderBackgroundPopoverMarkup();
    }
  }
  wireBuilderBackgroundPopoverControls(pop);
  syncBuilderBackgroundPanelFromState();
}

function registerBuilderTarget(key, el, kind) {
  if (!key || !isBuilderElement(el)) return;
  if (!BUILDER_MOVABLE_KEY_SET.has(String(key))) return;
  if (BUILDER_TARGETS.some((t) => t.key === key)) return;
  el.dataset.adSbBuilderTarget = "1";
  el.dataset.adSbBuilderKey = key;
  BUILDER_TARGETS.push({ key, el, kind: kind || "generic" });
  try {
    BUILDER_PIN_KEYS_SEEN.add(String(key));
  } catch {}
}

/** Gleiche BUILDER_TARGETS-Liste, aber kein Klick-Ziel (Klicks landen auf `masterKey`) */
function registerBuilderCompanionTarget(key, el, masterKey, kind) {
  if (key !== DARTBOARD_GLOW_TARGET_KEY || masterKey !== "dartboard" || !isBuilderElement(el)) return;
  if (BUILDER_TARGETS.some((t) => t.key === key)) return;
  el.dataset.adSbBuilderCompanionFor = masterKey;
  try {
    el.style.setProperty("pointer-events", "none", "important");
  } catch {}
  BUILDER_TARGETS.push({ key, el, kind: kind || "companion", masterKey });
}

/**
 * Deaktivierte Buttons liefern im Browser keine Mausereignisse — der Theme-Builder könnte sie nicht greifen.
 * Im Builder heben wir `disabled` kurz auf und stellen beim Schließen / vor Re-Scan wieder her.
 */
function releaseDisabledForBuilderHit(el) {
  if (!isBuilderElement(el)) return;
  try {
    if (el instanceof HTMLButtonElement || el instanceof HTMLInputElement) {
      if (el.disabled) {
        el.dataset.adSbBuilderHadDisabled = "1";
        el.disabled = false;
      }
    }
    if (el instanceof HTMLAnchorElement) {
      if (el.hasAttribute("disabled")) {
        el.dataset.adSbBuilderHadAnchorDisabled = "1";
        el.removeAttribute("disabled");
      }
      if (el.getAttribute("aria-disabled") === "true") {
        el.dataset.adSbBuilderHadAriaDisabled = "1";
        el.setAttribute("aria-disabled", "false");
      }
      try {
        if (getComputedStyle(el).pointerEvents === "none") {
          el.dataset.adSbBuilderHadPeRestore = "1";
          el.style.setProperty("pointer-events", "auto", "important");
        }
      } catch {}
    }
    if (String(el.dataset?.adSbBuilderTarget || "") === "1") {
      try {
        if (getComputedStyle(el).pointerEvents === "none") {
          el.dataset.adSbBuilderHadPeRestore = "1";
          el.style.setProperty("pointer-events", "auto", "important");
        }
      } catch {}
    }
  } catch {}
}

function restoreBuilderReleasedDisabledState() {
  document.querySelectorAll(SEL_SB_BUILDER_HAD_DISABLED).forEach((el) => {
    try {
      if (el instanceof HTMLButtonElement || el instanceof HTMLInputElement) el.disabled = true;
      delete el.dataset.adSbBuilderHadDisabled;
    } catch {}
  });
  document.querySelectorAll(SEL_SB_BUILDER_HAD_ANCHOR_DISABLED).forEach((el) => {
    try {
      el.setAttribute("disabled", "");
      delete el.dataset.adSbBuilderHadAnchorDisabled;
    } catch {}
  });
  document.querySelectorAll(SEL_SB_BUILDER_HAD_ARIA_DISABLED).forEach((el) => {
    try {
      el.setAttribute("aria-disabled", "true");
      delete el.dataset.adSbBuilderHadAriaDisabled;
    } catch {}
  });
  document.querySelectorAll(SEL_SB_BUILDER_HAD_PE_RESTORE).forEach((el) => {
    try {
      el.style.removeProperty("pointer-events");
      delete el.dataset.adSbBuilderHadPeRestore;
    } catch {}
  });
}

function ensureBuilderTargetsAcceptPointerEvents() {
  if (!BUILDER_ACTIVE) return;
  for (const t of BUILDER_TARGETS) {
    if (t?.el) releaseDisabledForBuilderHit(t.el);
  }
}

function buildElementSelector(el) {
  if (!el || !el.tagName) return "";
  if (el.id) {
    const escaped = cssEscapeSafe(el.id);
    if (escaped && document.querySelectorAll(`#${escaped}`).length === 1) return `#${escaped}`;
  }
  const parts = [];
  let cur = el;
  while (cur && cur.nodeType === 1 && cur !== document.body && cur !== document.documentElement) {
    const tag = cur.tagName.toLowerCase();
    let idx = 1;
    let sib = cur;
    while ((sib = sib.previousElementSibling)) {
      if (sib.tagName.toLowerCase() === tag) idx += 1;
    }
    parts.unshift(`${tag}:nth-of-type(${idx})`);
    cur = cur.parentElement;
    if (parts.length >= 7) break;
  }
  return parts.length ? `body > ${parts.join(" > ")}` : "";
}

function normalizeTargetElementForKey(key, el) {
  if (!key || !isBuilderElement(el)) return el;
  if (key !== "player-score-left" && key !== "player-score-right") return el;

  // BullOff / ext: beide Spieler liegen unter #ad-ext-player-display — nicht zum gemeinsamen Parent hochklettern
  const extWrap = document.querySelector("#ad-ext-player-display");
  if (isBuilderElement(extWrap) && extWrap.contains(el)) {
    let cur = el;
    while (cur && cur !== extWrap && cur.parentElement) {
      if (cur.parentElement === extWrap) return cur;
      cur = cur.parentElement;
    }
  }

  const midX = window.innerWidth / 2;
  const forLeft = key === "player-score-left";
  let best = el;
  let cur = el;
  for (let i = 0; i < 7 && cur; i += 1) {
    const r = cur.getBoundingClientRect();
    if (!isRectVisible(r) || r.top >= window.innerHeight * 0.50) {
      cur = cur.parentElement;
      continue;
    }
    if (r.width < 230 || r.width > window.innerWidth * 0.60 || r.height < 90 || r.height > 360) {
      cur = cur.parentElement;
      continue;
    }
    // Kein Zeilen-Wrapper über beide Spieler: zu breit oder Mitte auf der falschen Seite.
    if (r.width > window.innerWidth * 0.48) {
      cur = cur.parentElement;
      continue;
    }
    const cx = r.left + r.width / 2;
    if (forLeft && cx >= midX - 40) {
      cur = cur.parentElement;
      continue;
    }
    if (!forLeft && cx <= midX + 40) {
      cur = cur.parentElement;
      continue;
    }
    best = cur;
    cur = cur.parentElement;
  }
  return best;
}

function detectDartboardGlowCompanion(boardEl) {
  if (!isBuilderElement(boardEl)) return null;
  const b = boardEl.getBoundingClientRect();
  if (!isRectVisible(b)) return null;
  let best = null;
  let bestScore = -1;
  const nodes = document.querySelectorAll("div,section,article,canvas,img,svg");
  for (const node of nodes) {
    if (!isBuilderElement(node) || node === boardEl) continue;
    if (boardEl.contains(node) || node.contains(boardEl)) continue;
    const r = node.getBoundingClientRect();
    if (!isRectVisible(r)) continue;
    if (r.width < b.width * 0.84 || r.height < b.height * 0.84) continue;
    if (r.width > b.width * 2.35 || r.height > b.height * 2.35) continue;
    const cdx = Math.abs((r.left + r.width / 2) - (b.left + b.width / 2));
    const cdy = Math.abs((r.top + r.height / 2) - (b.top + b.height / 2));
    if (cdx > Math.max(54, b.width * 0.18) || cdy > Math.max(54, b.height * 0.18)) continue;
    const hint = getElementHint(node);
    const style = getComputedStyle(node);
    const hasGlowHint = hint.includes("glow") || hint.includes("halo") || hint.includes("aura") || hint.includes("shadow");
    const hasGlowStyle = String(style.filter || "").includes("blur")
      || String(style.boxShadow || "").toLowerCase() !== "none"
      || String(style.backgroundImage || "").toLowerCase().includes("gradient");
    const likelyGlowShape = Math.abs(r.width - r.height) <= Math.max(28, b.width * 0.14);
    if (!hasGlowHint && !hasGlowStyle && !likelyGlowShape) continue;
    const txt = String(node.textContent || "").replace(/\s+/g, " ").trim();
    if (txt.length > 40) continue;

    let score = (r.width * r.height) - (cdx * 160) - (cdy * 160);
    if (hasGlowHint) score += 30000;
    if (hasGlowStyle) score += 22000;
    if (likelyGlowShape) score += 12000;
    if (String(style.pointerEvents || "").toLowerCase() === "none") score += 6000;
    if (score > bestScore) {
      bestScore = score;
      best = node;
    }
  }
  return best;
}

function findButtonByText(keywords, keyName) {
  if (getTargetByKey(keyName)) return;
  const nodes = document.querySelectorAll("button,[role='button']");
  for (const node of nodes) {
    if (!isBuilderElement(node)) continue;
    const txt = String(node.textContent || "").trim().toLowerCase();
    if (!txt) continue;
    if (!keywords.some((k) => txt.includes(k))) continue;
    const r = node.getBoundingClientRect();
    if (!isRectVisible(r)) continue;
    registerBuilderTarget(keyName, node, "button");
    return;
  }
}

/**
 * Icon-Buttons: sichtbarer Text oft leer — Suche über aria-label, title und textContent.
 * @param {string[]} keywords jeweils lowercase-Fragmente
 */
function findButtonByAccessibilityKeywords(keywords, keyName) {
  if (getTargetByKey(keyName)) return;
  const nodes = document.querySelectorAll("button,[role='button'],[role='button']");
  for (const node of nodes) {
    if (!isBuilderElement(node)) continue;
    const txt = String(node.textContent || "").trim().toLowerCase();
    const aria = String(node.getAttribute("aria-label") || "").toLowerCase();
    const title = String(node.getAttribute("title") || "").toLowerCase();
    const hay = `${txt} ${aria} ${title}`;
    if (!keywords.some((k) => hay.includes(k))) continue;
    const r = node.getBoundingClientRect();
    if (!isRectVisible(r)) continue;
    registerBuilderTarget(keyName, node, "button-a11y");
    return;
  }
}

/** Autodarts Chakra: <button class="chakra-button">…</button> mit sichtbarem „Undo“ (Icon + Text). */
function registerAutodartsChakraUndoButton() {
  if (getTargetByKey("action-undo")) return;
  const nodes = document.querySelectorAll("button.chakra-button");
  for (const node of nodes) {
    if (!isBuilderElement(node)) continue;
    const norm = String(node.textContent || "").replace(/\s+/g, " ").trim();
    if (!/\bundo\b/i.test(norm)) continue;
    const r = node.getBoundingClientRect();
    if (!isRectVisible(r)) continue;
    registerBuilderTarget("action-undo", node, "chakra-undo");
    return;
  }
}

/** Autodarts: <button aria-label="Call referee" …> (auch disabled — weiterhin verschiebbar). */
function registerAutodartsRefereeButton() {
  if (getTargetByKey("action-referee")) return;
  try {
    const refBtn = document.querySelector('button[aria-label="Call referee"]');
    if (isBuilderElement(refBtn)) {
      const r = refBtn.getBoundingClientRect();
      if (isRectVisible(r)) registerBuilderTarget("action-referee", refBtn, "chakra-referee");
    }
  } catch {}
}

function registerHudGameModeSpan() {
  if (getTargetByKey("hud-game-mode")) return;
  const el = document.querySelector("#ad-ext-game-variant");
  if (!isBuilderElement(el)) return;
  const r = el.getBoundingClientRect();
  if (!isRectVisible(r)) return;
  registerBuilderTarget("hud-game-mode", el, "hud-game-mode");
}

function registerHudRoundSpan() {
  if (getTargetByKey("hud-round")) return;
  const roundRe = /^R\d+(\/\d+)?$/i;
  const modeEl = document.querySelector("#ad-ext-game-variant");
  if (isBuilderElement(modeEl) && modeEl.parentElement) {
    const spans = modeEl.parentElement.querySelectorAll("span");
    for (const sp of spans) {
      if (sp === modeEl) continue;
      const t = String(sp.textContent || "").replace(/\s+/g, " ").trim();
      if (!roundRe.test(t)) continue;
      const r = sp.getBoundingClientRect();
      if (!isBuilderElement(sp) || !isRectVisible(r)) continue;
      registerBuilderTarget("hud-round", sp, "hud-round");
      return;
    }
  }
  const all = document.querySelectorAll("span");
  for (const sp of all) {
    const t = String(sp.textContent || "").replace(/\s+/g, " ").trim();
    if (!roundRe.test(t)) continue;
    const r = sp.getBoundingClientRect();
    if (!isBuilderElement(sp) || !isRectVisible(r)) continue;
    registerBuilderTarget("hud-round", sp, "hud-round");
    return;
  }
}

function registerBoardLiveLink() {
  if (getTargetByKey("board-live")) return;
  /** Rote Stop-/Live-Verknüpfung (oft `<a disabled>`). */
  for (const a of document.querySelectorAll("a.chakra-link.chakra-button, a.chakra-button.chakra-link, a.chakra-button")) {
    if (!isBuilderElement(a)) continue;
    const txt = String(a.textContent || "");
    if (!txt.includes("🔴")) continue;
    const r = a.getBoundingClientRect();
    if (r.width < 6 || r.height < 6) continue;
    if (r.bottom <= 0 || r.right <= 0 || r.top >= window.innerHeight || r.left >= window.innerWidth) continue;
    registerBuilderTarget("board-live", a, "board-live");
    return;
  }
}

function registerBoardLiveModeButton() {
  if (getTargetByKey("board-live-mode")) return;
  const liveBtn = document.querySelector('button[aria-label="Live-Modus"], button[aria-label="Live Modus"]');
  if (!isBuilderElement(liveBtn)) return;
  const r0 = liveBtn.getBoundingClientRect();
  if (!isRectVisible(r0)) return;
  registerBuilderTarget("board-live-mode", liveBtn, "board-live-toggle");
}

function registerBoardStartButton() {
  if (getTargetByKey("board-start")) return;
  for (const node of document.querySelectorAll("button.chakra-button")) {
    if (!isBuilderElement(node)) continue;
    const norm = String(node.textContent || "").replace(/\s+/g, " ").trim();
    if (!/\bStarten\b/i.test(norm)) continue;
    const r = node.getBoundingClientRect();
    if (!isRectVisible(r)) continue;
    registerBuilderTarget("board-start", node, "board-start");
    return;
  }
}

function registerBoardResetButton() {
  if (getTargetByKey("board-reset")) return;
  for (const node of document.querySelectorAll("button.chakra-button")) {
    if (!isBuilderElement(node)) continue;
    const norm = String(node.textContent || "").replace(/\s+/g, " ").trim();
    if (!/\bZurücksetzen\b/i.test(norm) && !/\bZuruecksetzen\b/i.test(norm)) continue;
    const r = node.getBoundingClientRect();
    if (!isRectVisible(r)) continue;
    registerBuilderTarget("board-reset", node, "board-reset");
    return;
  }
}

function registerBoardCalibrateButton() {
  if (getTargetByKey("board-calibrate")) return;
  const byAria = document.querySelector('button[aria-label="Board kalibrieren"]');
  if (isBuilderElement(byAria)) {
    const r = byAria.getBoundingClientRect();
    if (isRectVisible(r)) {
      registerBuilderTarget("board-calibrate", byAria, "board-calibrate");
      return;
    }
  }
  for (const node of document.querySelectorAll("button.chakra-button")) {
    if (!isBuilderElement(node)) continue;
    const al = String(node.getAttribute("aria-label") || "");
    if (!/kalibrieren/i.test(al)) continue;
    const r = node.getBoundingClientRect();
    if (!isRectVisible(r)) continue;
    registerBuilderTarget("board-calibrate", node, "board-calibrate");
    return;
  }
}

function registerCancelButton() {
  if (getTargetByKey("action-cancel")) return;
  const candidates = [];
  for (const node of document.querySelectorAll("button.chakra-button")) {
    if (!isBuilderElement(node)) continue;
    const norm = String(node.textContent || "").replace(/\s+/g, " ").trim();
    if (!/^Abbrechen$/i.test(norm)) continue;
    const r = node.getBoundingClientRect();
    if (!isRectVisible(r)) continue;
    candidates.push({ node, area: r.width * r.height });
  }
  candidates.sort((a, b) => a.area - b.area);
  if (candidates[0]) registerBuilderTarget("action-cancel", candidates[0].node, "action-cancel");
}

function registerHudTurnTotalBox() {
  if (getTargetByKey("hud-turn-total")) return;
  const pts = document.querySelector("#ad-ext-turn p.ad-ext-turn-points, #ad-ext-turn .ad-ext-turn-points");
  if (!isBuilderElement(pts)) return;
  const r = pts.getBoundingClientRect();
  if (!isRectVisible(r)) return;
  let el = pts;
  const parent = pts.parentElement;
  if (isBuilderElement(parent) && parent.id !== "ad-ext-turn") {
    const pr = parent.getBoundingClientRect();
    const sibs = parent.children?.length || 0;
    if (sibs <= 3 && pr.width < Math.max(420, r.width * 6) && pr.height < Math.max(160, r.height * 3)) el = parent;
  }
  registerBuilderTarget("hud-turn-total", el, "hud-turn-total");
}

function registerHudMainScoreSpan() {
  if (getTargetByKey("hud-main-score")) return;
  const modeEl = document.querySelector("#ad-ext-game-variant");
  if (!isBuilderElement(modeEl)) return;
  const playerDisp = document.querySelector("#ad-ext-player-display");
  let row = modeEl.parentElement;
  for (let depth = 0; depth < 7 && row; depth += 1) {
    let best = null;
    let bestScore = -1;
    for (const sp of row.querySelectorAll("span, p")) {
      if (!isBuilderElement(sp)) continue;
      if (playerDisp && playerDisp.contains(sp)) continue;
      const t = String(sp.textContent || "").replace(/\s+/g, " ").trim();
      if (!/^\d{2,4}$/.test(t)) continue;
      const rr = sp.getBoundingClientRect();
      if (!isRectVisible(rr) || rr.width < 14 || rr.height < 12) continue;
      const fs = parseFloat(String(getComputedStyle(sp).fontSize || "0")) || 0;
      let score = fs * 500 + rr.width * rr.height;
      if (modeEl.contains(sp)) score -= 80000;
      if (score > bestScore) {
        bestScore = score;
        best = sp;
      }
    }
    if (best) {
      registerBuilderTarget("hud-main-score", best, "hud-main-score");
      return;
    }
    row = row.parentElement;
  }
}

function registerHudCheckoutRuleSpan() {
  if (getTargetByKey("hud-checkout-rule")) return;
  const checkoutRe = /^[A-Z0-9]{1,6}[-–‑][A-Z0-9]{1,6}$/;
  const playerDisp = document.querySelector("#ad-ext-player-display");
  const modeEl = document.querySelector("#ad-ext-game-variant");
  if (isBuilderElement(modeEl)) {
    let row = modeEl.parentElement;
    for (let depth = 0; depth < 8 && row; depth += 1) {
      for (const sp of row.querySelectorAll("span, p, div")) {
        if (!isBuilderElement(sp)) continue;
        if (playerDisp && playerDisp.contains(sp)) continue;
        const t = String(sp.textContent || "").replace(/\s+/g, " ").trim();
        if (!checkoutRe.test(t) || t.length > 14) continue;
        const r = sp.getBoundingClientRect();
        if (!isRectVisible(r)) continue;
        registerBuilderTarget("hud-checkout-rule", sp, "hud-checkout-rule");
        return;
      }
      row = row.parentElement;
    }
  }
  for (const sp of document.querySelectorAll("span, p, div")) {
    if (!isBuilderElement(sp)) continue;
    if (playerDisp && playerDisp.contains(sp)) continue;
    const t = String(sp.textContent || "").replace(/\s+/g, " ").trim();
    if (!checkoutRe.test(t) || t.length > 14) continue;
    const r = sp.getBoundingClientRect();
    if (!isRectVisible(r) || r.top > window.innerHeight * 0.45) continue;
    registerBuilderTarget("hud-checkout-rule", sp, "hud-checkout-rule");
    return;
  }
}

function registerActionMatchStats() {
  if (getTargetByKey("action-match-stats")) return;
  const a = document.querySelector('a[aria-label="Match stats"], a[aria-label="Match Stats"]');
  if (!isBuilderElement(a)) return;
  const r = a.getBoundingClientRect();
  if (!isRectVisible(r)) return;
  registerBuilderTarget("action-match-stats", a, "match-stats");
}

function registerHudEyeButton() {
  if (getTargetByKey("hud-eye")) return;
  let best = null;
  let bestArea = -1;
  for (const svg of document.querySelectorAll('svg[data-icon="eye"], svg.fa-eye')) {
    if (!isBuilderElement(svg)) continue;
    let el = null;
    const par = svg.parentElement;
    if (isBuilderElement(par)) {
      const directEye = par.querySelector?.(":scope > svg[data-icon='eye'], :scope > svg.fa-eye");
      if (directEye === svg && String(par.tagName || "").toLowerCase() === "span") el = par;
    }
    if (!isBuilderElement(el)) el = svg.closest("button,a,[role='button']");
    if (!isBuilderElement(el)) {
      let cur = svg.parentElement;
      for (let i = 0; i < 6 && isBuilderElement(cur); i += 1) {
        const tag = String(cur.tagName || "").toLowerCase();
        if (tag === "button" || tag === "a" || String(cur.getAttribute("role") || "") === "button") {
          el = cur;
          break;
        }
        cur = cur.parentElement;
      }
    }
    if (!isBuilderElement(el)) continue;
    const r = el.getBoundingClientRect();
    if (!isRectVisible(r) || r.bottom > 320) continue;
    const area = r.width * r.height;
    if (area > bestArea) {
      bestArea = area;
      best = el;
    }
  }
  if (best) registerBuilderTarget("hud-eye", best, "hud-eye");
}

function registerActionSettingsMenuButton() {
  if (getTargetByKey("action-settings")) return;
  const gearNeedle = "M14,7.77";
  let best = null;
  let bestTop = 1e9;
  for (const node of document.querySelectorAll("button.chakra-menu__menu-button")) {
    if (!isBuilderElement(node)) continue;
    const r = node.getBoundingClientRect();
    if (!isRectVisible(r) || r.bottom > 220) continue;
    const html = node.innerHTML || "";
    if (!html.includes(gearNeedle)) continue;
    if (r.top < bestTop) {
      bestTop = r.top;
      best = node;
    }
  }
  if (best) registerBuilderTarget("action-settings", best, "settings-menu");
}

function registerActionNumpadButton() {
  if (getTargetByKey("action-numpad")) return;
  const byAria = document.querySelector(
    'button[aria-label*="Keyboard" i], button[aria-label*="Tastatur" i], button[aria-label*="Ziffer" i], button[aria-label*="Eingabe" i], button[aria-label*="Nummer" i]'
  );
  if (isBuilderElement(byAria)) {
    const r = byAria.getBoundingClientRect();
    if (isRectVisible(r)) {
      registerBuilderTarget("action-numpad", byAria, "numpad-aria");
      return;
    }
  }
  const pathNeedle = "M20 5H4";
  for (const node of document.querySelectorAll("button.chakra-button, button")) {
    if (!isBuilderElement(node)) continue;
    const r = node.getBoundingClientRect();
    if (!isRectVisible(r) || r.top > window.innerHeight * 0.55) continue;
    const html = node.innerHTML || "";
    if (!html.includes(pathNeedle)) continue;
    registerBuilderTarget("action-numpad", node, "numpad-path");
    return;
  }
}

function registerBoardCoordinateModeButton() {
  if (getTargetByKey("board-coordinate-mode")) return;
  const b = document.querySelector('button[aria-label="Koordinatenmodus"]');
  if (!isBuilderElement(b)) return;
  const r = b.getBoundingClientRect();
  if (!isRectVisible(r)) return;
  registerBuilderTarget("board-coordinate-mode", b, "coordinate-mode");
}

/** Pfeil-Spalten unter `#ad-ext-turn` (SVG-Dart), bevorzugt gegenüber generischer Heuristik. */
function registerAdExtTurnDartSlots() {
  const root = document.querySelector("#ad-ext-turn");
  if (!isBuilderElement(root)) return;
  const slots = [];
  for (const node of root.querySelectorAll(".ad-ext-turn-throw, div.score")) {
    if (!isBuilderElement(node)) continue;
    const img = node.querySelector('img[alt="Dart"], img[alt*="dart" i]');
    if (!img) continue;
    const r = node.getBoundingClientRect();
    if (!isRectVisible(r)) continue;
    slots.push({ node, left: r.left });
  }
  slots.sort((a, b) => a.left - b.left);
  slots.slice(0, 3).forEach((s, i) => {
    const key = `throw-point-${i + 1}`;
    if (getTargetByKey(key)) return;
    registerBuilderTarget(key, s.node, "ad-ext-dart-slot");
  });
}

function registerAutodartsHudAndBoardTargets() {
  registerHudGameModeSpan();
  registerHudRoundSpan();
  registerBoardLiveLink();
  registerBoardLiveModeButton();
  registerBoardStartButton();
  registerBoardResetButton();
  registerBoardCalibrateButton();
  registerCancelButton();
  registerHudTurnTotalBox();
  registerHudMainScoreSpan();
  registerHudCheckoutRuleSpan();
  registerActionMatchStats();
  registerHudEyeButton();
  registerActionSettingsMenuButton();
  registerActionNumpadButton();
  registerBoardCoordinateModeButton();
}

function snapBuilderCoordIfEnabled(n) {
  if (!BUILDER_GRID_VISIBLE || BUILDER_GRID_STEP_PX <= 0) return n;
  const step = BUILDER_GRID_STEP_PX;
  const v = Number(n);
  if (!Number.isFinite(v)) return n;
  return Math.round(v / step) * step;
}

function updateBuilderGridOverlay() {
  const ov = document.getElementById(BUILDER_GRID_OVERLAY_ID);
  if (!ov) return;
  ov.style.display = BUILDER_GRID_VISIBLE ? "block" : "none";
}

function setBuilderGridVisible(on) {
  BUILDER_GRID_VISIBLE = !!on;
  const btn = document.getElementById(BUILDER_GRID_TOGGLE_ID);
  if (btn) {
    btn.dataset.on = BUILDER_GRID_VISIBLE ? "1" : "0";
    btn.textContent = BUILDER_GRID_VISIBLE ? "Raster ✓" : "Raster";
  }
  updateBuilderGridOverlay();
}

function ensureBuilderAuxGridStyle() {
  if (document.getElementById(BUILDER_AUX_GRID_STYLE_ID)) return;
  const st = document.createElement("style");
  st.id = BUILDER_AUX_GRID_STYLE_ID;
  const g = BUILDER_GRID_STEP_PX;
  st.textContent = `
    #${BUILDER_GRID_TOGGLE_ID}{
      position:fixed;top:144px;right:12px;z-index:2147483647;
      border:1px solid rgba(255,255,255,.24);background:rgba(8,14,24,.88);color:#fff;
      border-radius:10px;padding:7px 10px;font-weight:700;cursor:pointer;
      max-width:calc(100vw - 24px);font-size:12px;
    }
    #${BUILDER_GRID_OVERLAY_ID}{
      position:fixed;inset:0;z-index:2147483640;pointer-events:none;display:none;
      background-image:
        linear-gradient(rgba(255,255,255,.09) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255,255,255,.09) 1px, transparent 1px);
      background-size:${g}px ${g}px;
      box-sizing:border-box;
    }
  `;
  (document.head || document.documentElement).appendChild(st);
}

/**
 * Overlay/Button können durch SPA-Updates aus dem DOM fliegen — hier wiederherstellen.
 * Raster an = Linien + Einrasten beim Verschieben (8 px).
 */
function repairBuilderGridLayer() {
  if (!BUILDER_ACTIVE || !pathnameIndicatesWebsiteThemesPlayfield()) return;
  ensureBuilderAuxGridStyle();
  try {
    document.getElementById("adm-theme-builder-snap-toggle")?.remove();
    document.getElementById("adm-theme-builder-align-all")?.remove();
  } catch {}
  let ov = document.getElementById(BUILDER_GRID_OVERLAY_ID);
  if (!ov || !document.documentElement.contains(ov)) {
    try {
      if (ov) ov.remove();
    } catch {}
    ov = document.createElement("div");
    ov.id = BUILDER_GRID_OVERLAY_ID;
    ov.setAttribute("aria-hidden", "true");
    document.documentElement.appendChild(ov);
  }
  let btn = document.getElementById(BUILDER_GRID_TOGGLE_ID);
  if (!btn || !document.documentElement.contains(btn)) {
    try {
      if (btn) btn.remove();
    } catch {}
    btn = document.createElement("button");
    btn.id = BUILDER_GRID_TOGGLE_ID;
    btn.type = "button";
    btn.title = "Raster: Hilfslinien + Einrasten beim Verschieben (8 px)";
    btn.addEventListener("click", () => setBuilderGridVisible(!BUILDER_GRID_VISIBLE));
    document.documentElement.appendChild(btn);
  }
  setBuilderGridVisible(BUILDER_GRID_VISIBLE);
}

function ensureBuilderGridAndSnapUi() {
  repairBuilderGridLayer();
}

function detectDartboardTarget() {
  const nodes = document.querySelectorAll(
    "canvas,video,img,svg,[class*='board'],[id*='board'],[class*='dart'],[id*='dart']"
  );
  let best = null;
  let bestScore = -1;
  for (const node of nodes) {
    if (!isBuilderElement(node)) continue;
    const r = node.getBoundingClientRect();
    if (!isRectVisible(r)) continue;
    if (r.width < 140 || r.height < 140) continue;
    // Sehr große Scheiben (Zoom) nicht ausschließen — Rettung über gespeicherten Selector bleibt aktiv
    const ratio = r.width / Math.max(1, r.height);
    if (ratio < 0.84 || ratio > 1.16) continue;
    // Keine harte Obenkante: nach Verschieben nach oben würde die Scheibe sonst nicht mehr erkannt werden
    // (Pin-Panel „nicht im Layout“, keine Anwahl). Lage bevorzugt weiter über Score in der Bewertungsfunktion.

    const txt = String(node.textContent || "").replace(/\s+/g, " ").trim();
    if (txt.length > 80) continue;
    const tag = String(node.tagName || "").toLowerCase();
    const isMediaTag = tag === "canvas" || tag === "video" || tag === "img" || tag === "svg";
    const cls = getElementHint(node);
    const mediaChildren = node.querySelectorAll("canvas,video,img,svg").length;
    if (!cls.includes("board") && !cls.includes("dart") && mediaChildren === 0 && !isMediaTag) continue;

    const area = r.width * r.height;
    const centerX = r.left + (r.width / 2);
    const centerY = r.top + (r.height / 2);
    const dx = Math.abs(centerX - (window.innerWidth / 2));
    const dy = Math.abs(centerY - (window.innerHeight * 0.68));
    let score = area - (dx * 80) - (dy * 40);
    if (cls.includes("board")) score += 50000;
    if (cls.includes("dart")) score += 30000;
    if (node.tagName.toLowerCase() === "canvas" || node.tagName.toLowerCase() === "video") score += 25000;
    if (node.tagName.toLowerCase() === "img" || node.tagName.toLowerCase() === "svg") score += 18000;
    if (mediaChildren > 0) score += 12000;
    if (score > bestScore) {
      bestScore = score;
      best = node;
    }
  }
  if (best) {
    const inner = best;
    const shell = findDartboardShellWrapper(inner);
    const dartEl =
      isBuilderElement(shell) && shell !== inner && shell.contains(inner) ? shell : inner;
    registerBuilderTarget("dartboard", dartEl, "board");
    const glow = detectDartboardGlowCompanion(inner);
    if (glow) {
      registerBuilderCompanionTarget(DARTBOARD_GLOW_TARGET_KEY, glow, "dartboard", "board-glow");
      glow.dataset.adSbDartboardGlow = "1";
    }
  }
  registerDartboardShellTargets();
}

function stripBuilderAppliedFromElement(el) {
  if (!isBuilderElement(el)) return;
  try {
    el.classList.remove("adm-builder-has-crop");
  } catch {}
  const orig = el.dataset.adSbBuilderOriginalStyle;
  if (orig !== undefined) {
    try {
      if (orig) el.setAttribute("style", orig);
      else el.removeAttribute("style");
    } catch {}
  }
  try {
    delete el.dataset.adSbBuilderApplied;
    delete el.dataset.adSbBuilderOriginalStyle;
    el.removeAttribute("data-adm-builder-hit");
    el.removeAttribute("data-ad-sb-builder-hit");
  } catch {}
}

function clearPlayerDisplayFlexStabilizer() {
  try {
    document.querySelectorAll(`[${BUILDER_PLAYER_FLEX_STAB}]`).forEach((node) => {
      if (!isBuilderElement(node)) return;
      const role = node.getAttribute(BUILDER_PLAYER_FLEX_STAB);
      node.removeAttribute(BUILDER_PLAYER_FLEX_STAB);
      if (role === "wrap") {
        node.style.removeProperty("align-items");
      } else if (role === "item") {
        ["align-self", "flex-grow", "flex-shrink", "flex-basis", "min-height"].forEach((p) => {
          try {
            node.style.removeProperty(p);
          } catch {}
        });
      }
    });
  } catch {}
}

/**
 * Verhindert, dass bei zwei Spieler-Spalten unter `#ad-ext-player-display` die nicht bewegte Box
 * per Flex-Stretch die volle Zeilenhöhe übernimmt (typisch wenn die andere Spalte `position:fixed` hat).
 */
function applyPlayerDisplayFlexStabilizerIfNeeded() {
  clearPlayerDisplayFlexStabilizer();
  const wrap = document.querySelector("#ad-ext-player-display");
  if (!isBuilderElement(wrap)) return;
  const left = getTargetByKey("player-score-left")?.el;
  const right = getTargetByKey("player-score-right")?.el;
  if (!isBuilderElement(left) || !isBuilderElement(right)) return;
  if (!wrap.contains(left) || !wrap.contains(right)) return;
  let st;
  try {
    st = getComputedStyle(wrap);
  } catch {
    return;
  }
  if (st.display !== "flex" && st.display !== "inline-flex") return;

  const directChildContaining = (el) => {
    let cur = el;
    while (cur && cur.parentElement && cur.parentElement !== wrap) {
      cur = cur.parentElement;
    }
    return cur && cur.parentElement === wrap ? cur : null;
  };
  const dl = directChildContaining(left);
  const dr = directChildContaining(right);
  if (!dl || !dr) return;

  wrap.setAttribute(BUILDER_PLAYER_FLEX_STAB, "wrap");
  wrap.style.setProperty("align-items", "flex-start", "important");

  const markItem = (node) => {
    if (!isBuilderElement(node)) return;
    node.setAttribute(BUILDER_PLAYER_FLEX_STAB, "item");
    node.style.setProperty("align-self", "flex-start", "important");
    node.style.setProperty("flex-grow", "0", "important");
    node.style.setProperty("flex-shrink", "0", "important");
    node.style.setProperty("flex-basis", "auto", "important");
    node.style.setProperty("min-height", "0", "important");
  };
  markItem(dl);
  if (dr !== dl) markItem(dr);
}

/**
 * Shell um Canvas/Video finden, wenn `.showAnimations` fehlt (Layout-Varianten).
 */
function findDartboardShellWrapper(el) {
  if (!isBuilderElement(el)) return null;
  const anim = el.closest?.(".showAnimations");
  if (isBuilderElement(anim) && anim !== el) return anim;
  const tag = String(el.tagName || "").toLowerCase();
  if (tag !== "canvas" && tag !== "video") return null;
  const ir = el.getBoundingClientRect();
  const areaI = Math.max(1, ir.width * ir.height);
  let p = el.parentElement;
  for (let hops = 0; isBuilderElement(p) && p !== document.body && hops < 10; hops += 1, p = p.parentElement) {
    const r = p.getBoundingClientRect();
    const ratio = r.width / Math.max(1, r.height);
    const areaP = r.width * r.height;
    if (
      r.width >= 110 &&
      r.height >= 110 &&
      ratio >= 0.62 &&
      ratio <= 1.55 &&
      p.contains(el) &&
      areaP >= areaI * 0.8 &&
      areaP <= areaI * 6
    ) {
      return p;
    }
  }
  return null;
}

/**
 * Gespeicherter `sel` bindet oft die innere Scheibe (Canvas/Video) — nach Perspektive (3D) leidet
 * Hit-Testing / Klicks. Autodarts nutzt typisch `.showAnimations` als Shell; die soll das Ziel sein.
 * Alte innere Scheibe: Builder-Styles entfernen, sonst bleibt ein unsichtbarer Transform-Layer und blockiert Klicks.
 */
function reconcileDartboardToShellHitTarget() {
  const t = getTargetByKey("dartboard");
  if (!t?.el || !document.contains(t.el)) return;
  const el = t.el;
  const shell = findDartboardShellWrapper(el);
  if (!isBuilderElement(shell) || shell === el) return;
  if (!shell.contains(el)) return;
  const ix = BUILDER_TARGETS.findIndex((x) => x.key === "dartboard");
  if (ix < 0) return;
  stripBuilderAppliedFromElement(el);
  try {
    delete el.dataset.adSbBuilderTarget;
    delete el.dataset.adSbBuilderKey;
  } catch {}
  BUILDER_TARGETS.splice(ix, 1);
  registerBuilderTarget("dartboard", shell, "dartboard-shell");
  try {
    const entry = BUILDER_DATA?.dartboard;
    if (entry && typeof entry === "object") entry.sel = buildElementSelector(shell);
  } catch {}
}

/** Optional: äußerer Rahmen (nicht als Builder-Ziel nutzbar — nur Heuristik-Rest). */
function registerDartboardShellTargets() {
  const board = getTargetByKey("dartboard")?.el;
  if (!isBuilderElement(board)) return;
  if (!getTargetByKey("dartboard-mount")) {
    const par = board.parentElement;
    if (isBuilderElement(par) && par !== document.body && par.contains(board)) {
      const r = par.getBoundingClientRect();
      if (isRectVisible(r) && r.width >= 120 && r.width <= window.innerWidth * 0.98 && r.height >= 100) {
        registerBuilderTarget("dartboard-mount", par, "dartboard-mount");
      }
    }
  }
}

/**
 * BullOff: horizontale Leiste mit Dart-Grafik (`div.score` laut DOM).
 * Nur wenn noch kein throw-track existiert.
 */
function registerBullOffThrowTrack() {
  if (getTargetByKey("throw-track")) return;
  const candidates = Array.from(document.querySelectorAll("div.score"));
  let best = null;
  let bestScore = -1;
  for (const node of candidates) {
    if (!isBuilderElement(node)) continue;
    const r = node.getBoundingClientRect();
    if (!isRectVisible(r)) continue;
    if (r.width < 100 || r.width > window.innerWidth * 0.94) continue;
    if (r.height < 20 || r.height > 160) continue;
    const midY = r.top + r.height / 2;
    if (midY < window.innerHeight * 0.12 || midY > window.innerHeight * 0.65) continue;
    const dartImg = node.querySelector('img[alt="Dart"], img[alt*="dart" i]');
    const hasSvg = !!node.querySelector("svg");
    if (!dartImg && !hasSvg) continue;
    let score = r.width * r.height;
    if (dartImg) score += 25_000;
    if (hasSvg) score += 8000;
    if (score > bestScore) {
      bestScore = score;
      best = node;
    }
  }
  if (best) registerBuilderTarget("throw-track", best, "throw-track-bulloff");
}

function isAncestor(a, b) {
  if (!a || !b || a === b) return false;
  let cur = b.parentElement;
  while (cur) {
    if (cur === a) return true;
    cur = cur.parentElement;
  }
  return false;
}

/** Linker/rechter Score dürfen nie derselbe Knoten sein und keiner im anderen als Vorfahre liegen. */
function arePlayerScoreTargetsDisjoint(a, b) {
  if (!isBuilderElement(a) || !isBuilderElement(b)) return true;
  if (a === b) return false;
  return !isAncestor(a, b) && !isAncestor(b, a);
}

function detectScoreCards() {
  const extWrap = document.querySelector("#ad-ext-player-display");
  if (isBuilderElement(extWrap)) {
    const children = Array.from(extWrap.children || []).filter((n) => isBuilderElement(n));
    const visible = children
      .map((n) => ({ node: n, r: n.getBoundingClientRect() }))
      .filter((x) => isRectVisible(x.r) && x.r.width > 180 && x.r.height > 90);
    let leftExt = null;
    let rightExt = null;
    if (visible.length >= 2) {
      const byX = [...visible].sort(
        (a, b) => a.r.left + a.r.width / 2 - (b.r.left + b.r.width / 2)
      );
      leftExt = byX[0];
      rightExt = byX[byX.length - 1];
    } else if (visible.length === 1) {
      const v = visible[0];
      const cx = v.r.left + v.r.width / 2;
      if (cx < window.innerWidth / 2) leftExt = v;
      else rightExt = v;
    }
    let leftEl = leftExt ? normalizeTargetElementForKey("player-score-left", leftExt.node) : null;
    let rightEl = rightExt ? normalizeTargetElementForKey("player-score-right", rightExt.node) : null;
    if (leftEl && rightEl && !arePlayerScoreTargetsDisjoint(leftEl, rightEl)) {
      rightEl = null;
    }
    if (leftExt && leftEl) registerBuilderTarget("player-score-left", leftEl, "score-card-ext");
    if (rightExt && rightEl) registerBuilderTarget("player-score-right", rightEl, "score-card-ext");
    if (leftExt && rightExt && leftEl && rightEl) return;
  }

  const nodes = document.querySelectorAll("div,section,article");
  const picks = [];
  for (const node of nodes) {
    if (!isBuilderElement(node)) continue;
    const r = node.getBoundingClientRect();
    if (!isRectVisible(r)) continue;
    if (r.top > window.innerHeight * 0.40) continue;
    if (r.width < 220 || r.height < 100) continue;
    if (r.width > window.innerWidth * 0.56) continue;
    const text = String(node.textContent || "").replace(/\s+/g, " ").trim();
    if (!/\b\d{2,4}\b/.test(text)) continue;
    if (text.length > 220) continue;
    const cls = getElementHint(node);
    if (cls.includes("overlay") || cls.includes("dialog")) continue;
    let score = (r.width * r.height);
    if (cls.includes("score")) score += 30000;
    if (cls.includes("player")) score += 18000;
    if (r.top < 170) score += 10000;
    picks.push({ node, r, score });
  }
  // Prefer the smallest matching card element, not an ancestor that wraps both players.
  const reduced = picks.filter((p) => !picks.some((q) => q !== p && isAncestor(p.node, q.node) && q.score > (p.score * 0.5)));

  const mid = window.innerWidth / 2;
  const leftCandidates = reduced
    .filter((p) => (p.r.left + p.r.width / 2) < mid)
    .sort((a, b) => b.score - a.score);
  const rightCandidates = reduced
    .filter((p) => (p.r.left + p.r.width / 2) >= mid)
    .sort((a, b) => b.score - a.score);

  let left = leftCandidates[0] || null;
  let right = rightCandidates[0] || null;
  let leftEl = left ? normalizeTargetElementForKey("player-score-left", left.node) : null;
  let rightEl = right ? normalizeTargetElementForKey("player-score-right", right.node) : null;
  if (leftEl && rightEl && !arePlayerScoreTargetsDisjoint(leftEl, rightEl)) {
    for (const rp of rightCandidates) {
      if (rp === right) continue;
      const re = normalizeTargetElementForKey("player-score-right", rp.node);
      if (arePlayerScoreTargetsDisjoint(leftEl, re)) {
        right = rp;
        rightEl = re;
        break;
      }
    }
  }
  if (leftEl && rightEl && !arePlayerScoreTargetsDisjoint(leftEl, rightEl)) {
    for (const lp of leftCandidates) {
      if (lp === left) continue;
      const le = normalizeTargetElementForKey("player-score-left", lp.node);
      if (arePlayerScoreTargetsDisjoint(le, rightEl)) {
        left = lp;
        leftEl = le;
        break;
      }
    }
  }
  if (leftEl && rightEl && !arePlayerScoreTargetsDisjoint(leftEl, rightEl)) {
    right = null;
    rightEl = null;
  }

  if (left) registerBuilderTarget("player-score-left", leftEl || normalizeTargetElementForKey("player-score-left", left.node), "player-score");
  if (right) registerBuilderTarget("player-score-right", rightEl || normalizeTargetElementForKey("player-score-right", right.node), "player-score");
}

function detectPointsTables() {
  const totalCells = Array.from(document.querySelectorAll(".ad-total-cell,.ad-total-overlay"))
    .filter((n) => isBuilderElement(n))
    .map((n) => ({ node: n, r: n.getBoundingClientRect() }))
    .filter((x) => isRectVisible(x.r) && x.r.width >= 36 && x.r.width <= 220 && x.r.height >= 90 && x.r.height <= 420);
  if (totalCells.length) {
    const leftCell = totalCells
      .filter((x) => (x.r.left + x.r.width / 2) < (window.innerWidth / 2))
      .sort((a, b) => b.r.width * b.r.height - a.r.width * a.r.height)[0];
    const rightCell = totalCells
      .filter((x) => (x.r.left + x.r.width / 2) >= (window.innerWidth / 2))
      .sort((a, b) => b.r.width * b.r.height - a.r.width * a.r.height)[0];
    if (leftCell) registerBuilderTarget("points-table-left", leftCell.node, "points-table-ext");
    if (rightCell) registerBuilderTarget("points-table-right", rightCell.node, "points-table-ext");
    if (leftCell && rightCell) return;
  }

  const nodes = document.querySelectorAll("div,section,article,aside,span");
  const picks = [];
  for (const node of nodes) {
    if (!isBuilderElement(node)) continue;
    const r = node.getBoundingClientRect();
    if (!isRectVisible(r)) continue;
    if (r.top > window.innerHeight * 0.44) continue;
    if (r.width < 44 || r.width > 210 || r.height < 100 || r.height > 380) continue;
    const ratio = r.height / Math.max(1, r.width);
    if (ratio < 1.1 || ratio > 6.0) continue;
    const text = String(node.textContent || "").replace(/\s+/g, " ").trim();
    const nums = text.match(/\b\d{1,4}\b/g) || [];
    if (nums.length < 2) continue;
    const hint = getElementHint(node);
    let score = (r.width * r.height) + (nums.length * 8000);
    if (hint.includes("score") || hint.includes("table") || hint.includes("leg") || hint.includes("visit")) score += 18000;
    if (String(getComputedStyle(node).borderStyle || "").toLowerCase() !== "none") score += 5000;
    picks.push({ node, r, score });
  }
  if (!picks.length) return;
  picks.sort((a, b) => b.score - a.score);
  const left = picks
    .filter((p) => (p.r.left + p.r.width / 2) < (window.innerWidth / 2))
    .sort((a, b) => b.score - a.score)[0];
  const right = picks
    .filter((p) => (p.r.left + p.r.width / 2) >= (window.innerWidth / 2))
    .sort((a, b) => b.score - a.score)[0];
  if (left) registerBuilderTarget("points-table-left", left.node, "points-table");
  if (right) registerBuilderTarget("points-table-right", right.node, "points-table");
}

function detectScoreSubparts() {
  const map = [
    { card: "player-score-left", value: "score-value-left", badge: "player-badge-left", meta: "player-meta-left", stats: "player-stats-left" },
    { card: "player-score-right", value: "score-value-right", badge: "player-badge-right", meta: "player-meta-right", stats: "player-stats-right" }
  ];
  map.forEach((cfg) => {
    const card = getTargetByKey(cfg.card)?.el || null;
    if (!isBuilderElement(card)) return;
    const cardRect = card.getBoundingClientRect();
    if (!isRectVisible(cardRect)) return;
    const nodes = card.querySelectorAll("div,section,article,span,p,h1,h2,h3,h4");
    let bestValue = null;
    let valueScore = -1;
    let bestMeta = null;
    let metaScore = -1;
    let bestStats = null;
    let statsScore = -1;
    let bestBadge = null;
    let badgeScore = -1;
    for (const node of nodes) {
      if (!isBuilderElement(node)) continue;
      const r = node.getBoundingClientRect();
      if (!isRectVisible(r)) continue;
      if (r.left < (cardRect.left - 6) || r.right > (cardRect.right + 6)) continue;
      if (r.top < (cardRect.top - 10) || r.bottom > (cardRect.bottom + 10)) continue;
      const txt = String(node.textContent || "").replace(/\s+/g, " ").trim();
      if (!txt || txt.length > 80) continue;
      const hint = getElementHint(node);

      if (/^\d{2,4}$/.test(txt) && r.height >= 46 && r.width >= 120) {
        const fs = parseFloat(String(getComputedStyle(node).fontSize || "0")) || 0;
        let score = (r.width * r.height) + (fs * 900);
        if (r.top < cardRect.top + cardRect.height * 0.55) score += 12000;
        if (score > valueScore) {
          valueScore = score;
          bestValue = node;
        }
      }

      const hasPlayerText = /bot|lvl|level|ttv|cpu|player/i.test(txt) || hint.includes("player");
      if (hasPlayerText && r.height >= 22 && r.height <= 88 && r.width >= 120) {
        let score = (r.width * r.height) + 9000;
        if (r.top > cardRect.top + cardRect.height * 0.35) score += 4500;
        if (score > metaScore) {
          metaScore = score;
          bestMeta = node;
        }
      }

      const hasStatsText = txt.includes("#") || txt.includes("/") || txt.includes("ø");
      if (hasStatsText && r.height >= 18 && r.height <= 70 && r.width >= 90) {
        let score = (r.width * r.height) + 8000;
        if (r.top > cardRect.top + cardRect.height * 0.48) score += 5000;
        if (score > statsScore) {
          statsScore = score;
          bestStats = node;
        }
      }

      const isBadge = /^\d{1,2}$/.test(txt) && r.width >= 24 && r.width <= 90 && r.height >= 20 && r.height <= 70;
      if (isBadge) {
        let score = (r.width * r.height) + 6000;
        if (r.top > cardRect.top + cardRect.height * 0.40) score += 5000;
        if (r.left < cardRect.left + cardRect.width * 0.45) score += 4500;
        if (score > badgeScore) {
          badgeScore = score;
          bestBadge = node;
        }
      }
    }
    if (bestValue) registerBuilderTarget(cfg.value, bestValue, "score-part");
    if (bestBadge) registerBuilderTarget(cfg.badge, bestBadge, "score-part");
    if (bestMeta) registerBuilderTarget(cfg.meta, bestMeta, "score-part");
    if (bestStats) registerBuilderTarget(cfg.stats, bestStats, "score-part");
  });
}

function detectThrowPointTracks() {
  const extThrows = Array.from(document.querySelectorAll(".ad-ext-turn-throw"))
    .filter((n) => isBuilderElement(n))
    .map((n) => ({ node: n, r: n.getBoundingClientRect() }))
    .filter((x) => isRectVisible(x.r));
  if (extThrows.length >= 3) {
    extThrows
      .sort((a, b) => a.r.left - b.r.left)
      .slice(0, 3)
      .forEach((x, i) => registerBuilderTarget(`throw-point-${i + 1}`, x.node, "throw-point-ext"));
    return;
  }

  const nodes = document.querySelectorAll("div,section,article,button,[role='button'],span");
  const picks = [];
  const fieldToken = /^(?:[SDT]\d{1,2}|M\d{1,2}|BULL|25)$/i;
  for (const node of nodes) {
    if (!isBuilderElement(node)) continue;
    const r = node.getBoundingClientRect();
    if (!isRectVisible(r)) continue;
    if (r.width < 110 || r.width > 620 || r.height < 34 || r.height > 190) continue;
    if (r.top < window.innerHeight * 0.10 || r.top > window.innerHeight * 0.55) continue;
    const txt = String(node.textContent || "").replace(/\s+/g, " ").trim();
    const hint = getElementHint(node);
    const directMatch = fieldToken.test(txt);
    const hasChildMatch = Array.from(node.querySelectorAll("span,div,p")).some((n) => fieldToken.test(String(n.textContent || "").trim()));
    const isLikelyField = directMatch || hasChildMatch || hint.includes("throw") || hint.includes("dart");
    if (!isLikelyField) continue;
    let score = (r.width * r.height);
    if (directMatch) score += 24000;
    if (hasChildMatch) score += 16000;
    if (hint.includes("throw") || hint.includes("dart")) score += 9000;
    const yBandCenter = window.innerHeight * 0.30;
    score -= Math.abs((r.top + r.height / 2) - yBandCenter) * 36;
    picks.push({ node, r, score });
  }
  if (!picks.length) return;

  // Prefer one horizontal row with at least 3 boxes.
  let bestBand = null;
  for (const p of picks) {
    const group = picks.filter((q) => Math.abs((q.r.top + q.r.height / 2) - (p.r.top + p.r.height / 2)) <= 36);
    if (group.length < 3) continue;
    const bandScore = group.reduce((sum, x) => sum + x.score, 0);
    if (!bestBand || bandScore > bestBand.score) bestBand = { score: bandScore, group };
  }
  const chosen = bestBand ? bestBand.group : picks;
  const unique = [];
  chosen
    .sort((a, b) => b.score - a.score)
    .forEach((p) => {
      if (unique.some((u) => Math.abs(u.r.left - p.r.left) < 22 && Math.abs(u.r.top - p.r.top) < 22)) return;
      unique.push(p);
    });
  unique
    .sort((a, b) => a.r.left - b.r.left)
    .slice(0, 3)
    .forEach((p, i) => registerBuilderTarget(`throw-point-${i + 1}`, p.node, "throw-point"));
}

function detectThrowBoxes() {
  const nodes = document.querySelectorAll("div,section,article,button,[role='button']");
  const total = [];
  const darts = [];
  for (const node of nodes) {
    if (!isBuilderElement(node)) continue;
    const r = node.getBoundingClientRect();
    if (!isRectVisible(r)) continue;
    const text = String(node.textContent || "").trim();
    const cls = getElementHint(node);
    if (r.width >= 70 && r.width <= 240 && r.height >= 70 && r.height <= 220) {
      if (/^\d{1,3}$/.test(text) || cls.includes("visit") || cls.includes("throw")) {
        total.push({ node, r, score: (r.height * r.width) + (cls.includes("throw") ? 9000 : 0) });
      }
    }
    if (r.width >= 90 && r.width <= 620 && r.height >= 28 && r.height <= 190) {
      if (cls.includes("dart") || cls.includes("throw") || /\b[SDT]\d{1,2}\b/i.test(text)) {
        darts.push({ node, r, score: (r.width * r.height) + (cls.includes("dart") ? 10000 : 0) });
      }
    }
  }
  total.sort((a, b) => b.score - a.score);
  if (total[0]) registerBuilderTarget("throw-total", total[0].node, "throw-total");
  darts.sort((a, b) => b.score - a.score);
  const kept = [];
  for (const d of darts) {
    if (kept.some((k) => Math.abs(k.r.left - d.r.left) < 20 && Math.abs(k.r.top - d.r.top) < 20)) continue;
    kept.push(d);
    if (kept.length >= 3) break;
  }
  kept.sort((a, b) => a.r.left - b.r.left).forEach((d, i) => registerBuilderTarget(`throw-point-${i + 1}`, d.node, "throw-point"));
  if (!getTargetByKey("throw-point-1") || !getTargetByKey("throw-point-2") || !getTargetByKey("throw-point-3")) {
    detectThrowPointTracks();
  }
}

function refreshBuilderTargets() {
  restoreBuilderReleasedDisabledState();
  clearBuilderTargetMarks();
  BUILDER_TARGETS = [];

  // 1) Restore from saved selector binding first (deterministic)
  const keys = Object.keys(BUILDER_DATA || {});
  keys.forEach((key) => {
    if (key === DARTBOARD_GLOW_TARGET_KEY) return;
    const sel = String(BUILDER_DATA?.[key]?.sel || "");
    if (!sel) return;
    let el = null;
    try { el = document.querySelector(sel); } catch {}
    if (!isBuilderElement(el)) return;
    registerBuilderTarget(key, el, "saved");
  });

  // Scheibe: wenn Schritt 1 das Ziel nicht setzte (z. B. leeres `sel` beim ersten Mal), aber ein Selector existiert —
  // oder die Heuristik kurz aussetzt — über gespeicherten Selector erneut registrieren (sonst keine Anwahl/Klicks).
  if (!getTargetByKey("dartboard")) {
    const sel = String(BUILDER_DATA?.dartboard?.sel || "");
    if (sel) {
      try {
        const el = document.querySelector(sel);
        if (isBuilderElement(el) && document.contains(el)) {
          registerBuilderTarget("dartboard", el, "saved-rescue");
        }
      } catch {}
    }
  }

  // 2) Fill only missing keys via heuristics — Undo/Referee zuerst exakt wie auf play.autodarts.io (Chakra)
  registerAutodartsRefereeButton();
  registerAutodartsChakraUndoButton();
  registerAutodartsHudAndBoardTargets();
  findButtonByText(["undo", "zurück", "zurueck", "rueck"], "action-undo");
  findButtonByAccessibilityKeywords(
    ["undo", "zurück", "zurueck", "rueck", "rückgängig", "rueckgaengig", "ruckgängig"],
    "action-undo"
  );
  findButtonByText(["next", "weiter"], "action-next");
  findButtonByAccessibilityKeywords(["next", "weiter", "continue", "fortfahren"], "action-next");
  findButtonByAccessibilityKeywords(
    ["call referee", "referee", "schiedsrichter", "schieds", "ai referee", "ai-schied"],
    "action-referee"
  );
  detectDartboardTarget();
  detectScoreCards();
  detectPointsTables();
  detectScoreSubparts();
  registerAdExtTurnDartSlots();
  detectThrowBoxes();
  registerBullOffThrowTrack();
  fillMissingPairedTargets();

  if (BUILDER_ACTIVE) {
    ensureBuilderPinPanel();
    ensureBuilderTargetsAcceptPointerEvents();
  }
}

function getBuilderTargetFromNode(node) {
  if (!isBuilderElement(node)) return null;
  let cur = node;
  while (cur) {
    if (isBuilderElement(cur) && cur.dataset?.adSbBuilderTarget === "1") {
      const key = String(cur.dataset.adSbBuilderKey || "");
      const t = BUILDER_TARGETS.find((x) => x.key === key);
      if (t) return t;
    }
    cur = cur.parentElement;
  }
  const comp = node.closest(SEL_SB_BUILDER_COMPANION);
  if (comp) {
    const masterKey = String(comp.dataset.adSbBuilderCompanionFor || "").trim();
    if (!masterKey) return null;
    return BUILDER_TARGETS.find((t) => t.key === masterKey) || null;
  }
  return null;
}

function builderTargetListOrder(key) {
  const i = BUILDER_TARGET_KEYS.findIndex((e) => e.key === key);
  return i >= 0 ? i : 999;
}

/**
 * Builder-Ziele unter dem Cursor: zuerst exakt der Knoten unter dem Pixel (sichtbare Ecke der
 * Scheibe, auch wenn der Rest off-screen ist); dann Stapel-„stark“/„schwach“; zuletzt Stapel-Fallback.
 */
function pickBestBuilderTargetAtPoint(clientX, clientY) {
  const x = clientX;
  const y = clientY;

  try {
    const probe = document.elementFromPoint(x, y);
    if (isBuilderElement(probe) && !isBuilderChromeNode(probe) && !isBuilderUiTarget(probe)) {
      const dartT0 = getTargetByKey("dartboard");
      if (
        dartT0?.el &&
        document.contains(dartT0.el) &&
        dartT0.el.contains(probe) &&
        BUILDER_MOVABLE_KEY_SET.has("dartboard")
      ) {
        return dartT0;
      }
      const direct = getBuilderTargetFromNode(probe);
      if (
        direct?.el &&
        BUILDER_MOVABLE_KEY_SET.has(String(direct.key)) &&
        String(direct.key) !== DARTBOARD_GLOW_TARGET_KEY
      ) {
        return direct;
      }
    } else if (!isBuilderElement(probe)) {
      const dartT1 = getTargetByKey("dartboard");
      if (dartT1?.el && document.contains(dartT1.el) && BUILDER_MOVABLE_KEY_SET.has("dartboard")) {
        try {
          for (const n of document.elementsFromPoint(x, y) || []) {
            if (!isBuilderElement(n) || isBuilderChromeNode(n) || isBuilderUiTarget(n)) continue;
            if (dartT1.el.contains(n)) return dartT1;
          }
        } catch {}
      }
    }
  } catch {}

  let stack = [];
  try {
    stack = typeof document.elementsFromPoint === "function" ? document.elementsFromPoint(x, y) : [];
  } catch {
    stack = [];
  }
  if (!stack.length) {
    try {
      const one = document.elementFromPoint(x, y);
      if (one) stack = [one];
    } catch {
      return null;
    }
  }

  const strong = [];
  const weak = [];
  for (let ti = 0; ti < BUILDER_TARGETS.length; ti += 1) {
    const t = BUILDER_TARGETS[ti];
    if (!t?.el || !t.key) continue;
    if (!BUILDER_MOVABLE_KEY_SET.has(String(t.key))) continue;
    if (String(t.key) === DARTBOARD_GLOW_TARGET_KEY) continue;
    const el = t.el;
    if (!document.contains(el)) continue;
    const r = el.getBoundingClientRect();
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue;

    let stackTopI = -1;
    for (let i = 0; i < stack.length; i += 1) {
      const n = stack[i];
      if (!isBuilderElement(n)) continue;
      if (isBuilderChromeNode(n)) continue;
      if (isBuilderUiTarget(n)) continue;
      if (el === n || el.contains(n)) {
        stackTopI = i;
        break;
      }
    }
    const area = Math.max(1, r.width * r.height);
    if (stackTopI >= 0) strong.push({ t, stackTopI, area });
    else weak.push({ t, area });
  }

  if (strong.length) {
    strong.sort((a, b) => {
      if (a.stackTopI !== b.stackTopI) return a.stackTopI - b.stackTopI;
      if (a.area !== b.area) return a.area - b.area;
      return builderTargetListOrder(a.t.key) - builderTargetListOrder(b.t.key);
    });
    return strong[0].t;
  }
  if (weak.length) {
    weak.sort((a, b) => {
      if (a.area !== b.area) return b.area - a.area;
      return builderTargetListOrder(a.t.key) - builderTargetListOrder(b.t.key);
    });
    return weak[0].t;
  }
  for (let i = 0; i < stack.length; i += 1) {
    const node = stack[i];
    if (!isBuilderElement(node)) continue;
    if (isBuilderChromeNode(node)) continue;
    if (isBuilderUiTarget(node)) continue;
    const hit = getBuilderTargetFromNode(node);
    if (hit?.el) return hit;
  }
  return null;
}

function applyBuilderTargetSelection(hit, opts) {
  if (!hit?.el || !hit.key) return;
  const additive = !!(opts && opts.additive);
  const k = String(hit.key);
  if (!BUILDER_MOVABLE_KEY_SET.has(k) || k === DARTBOARD_GLOW_TARGET_KEY) return;
  if (additive) {
    const existing = BUILDER_SELECTED_KEYS.slice();
    const idx = existing.indexOf(k);
    if (idx >= 0) {
      existing.splice(idx, 1);
      existing.push(k);
      BUILDER_SELECTED_KEYS = existing;
    } else {
      BUILDER_SELECTED_KEYS = [...existing, k];
    }
  } else {
    BUILDER_SELECTED_KEYS = [k];
  }
  clearBuilderSelectionHitMarkers();
  for (const key of BUILDER_SELECTED_KEYS) {
    const t = getTargetByKey(key);
    if (t?.el && document.contains(t.el)) t.el.dataset.admBuilderHit = "1";
  }
  syncBuilderPrimaryFromKeys();
  getBuilderEntry(BUILDER_SELECTED_SELECTOR);
  try {
    applyBuilderDataToDom();
  } catch {}
  refreshBuilderSelectionBox();
}

/**
 * Nach Perspektiv-Änderung kann das DOM-Ziel effektiv wechseln (z. B. anderer Wrapper).
 * Ziel unter gleichem Key neu binden, damit es sofort wieder greifbar ist.
 */
function rebindBuilderTargetKey(key) {
  const k = String(key || "");
  if (!k) return false;
  refreshBuilderTargets();
  const t = getTargetByKey(k);
  if (!t?.el || !document.contains(t.el)) return false;
  const entry = getBuilderEntry(k);
  try {
    entry.sel = buildElementSelector(t.el);
  } catch {}
  BUILDER_SELECTED_KEYS = [k];
  clearBuilderSelectionHitMarkers();
  t.el.dataset.admBuilderHit = "1";
  syncBuilderPrimaryFromKeys();
  return true;
}

function getBuilderEntry(selector) {
  const key = String(selector || "");
  if (!key) return null;
  if (!BUILDER_DATA[key]) {
    BUILDER_DATA[key] = {
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      r: 0,
      rot: 0,
      rx: 0,
      ry: 0,
      persp: 0,
      sx: 1,
      sy: 1,
      locked: false,
      cropT: 0,
      cropR: 0,
      cropB: 0,
      cropL: 0
    };
  }
  return BUILDER_DATA[key];
}

function getTargetByKey(key) {
  return BUILDER_TARGETS.find((t) => t.key === key) || null;
}

/**
 * Live-Transforms (Ziehen, Perspektive, Rad) müssen auf demselben Knoten liegen wie in `BUILDER_TARGETS`.
 * Nach 3D-Reconcile ist die Scheibe die Shell — `BUILDER_SELECTED` zeigt aber oft noch auf Canvas/Video;
 * würde man dort weiter transformieren, liegt ein unsichtbarer Media-Layer oben und blockiert Klicks.
 */
function getBuilderLiveTransformElement(selectorOpt) {
  const key = String(selectorOpt || BUILDER_SELECTED_SELECTOR || "");
  if (!key) return BUILDER_SELECTED;
  const t = getTargetByKey(key);
  if (t?.el && document.contains(t.el)) return t.el;
  return BUILDER_SELECTED;
}

/** Ob ein Pin-Ziel aktuell bedienbar ist (Feststellen-Panel). Scheibe: auch über gespeicherten Selector, falls Heuristik kurz aussetzt. */
function isPinTargetPresentInLayout(key) {
  const k = String(key || "");
  if (BUILDER_PIN_KEYS_SEEN.has(k)) return true;
  const t = getTargetByKey(k);
  if (isBuilderElement(t?.el) && document.contains(t.el)) return true;
  if (k === "dartboard") {
    const sel = String(BUILDER_DATA?.dartboard?.sel || "");
    if (sel) {
      try {
        const el = document.querySelector(sel);
        if (isBuilderElement(el) && document.contains(el)) return true;
      } catch {}
    }
  }
  return false;
}

function findSymmetricPartnerFor(sourceEl, wantRightSide) {
  if (!isBuilderElement(sourceEl)) return null;
  const srcRect = sourceEl.getBoundingClientRect();
  if (!isRectVisible(srcRect)) return null;
  const centerX = srcRect.left + (srcRect.width / 2);
  const centerY = srcRect.top + (srcRect.height / 2);
  const tag = String(sourceEl.tagName || "").toLowerCase();
  const srcHint = getElementHint(sourceEl);
  const classTokens = srcHint.split(/\s+/).filter((x) => x && x.length >= 4).slice(0, 8);
  const nodes = document.querySelectorAll(tag || "div");
  let best = null;
  let bestScore = -1;
  for (const node of nodes) {
    if (!isBuilderElement(node) || node === sourceEl) continue;
    const r = node.getBoundingClientRect();
    if (!isRectVisible(r)) continue;
    const cX = r.left + (r.width / 2);
    const cY = r.top + (r.height / 2);
    if (wantRightSide && cX <= (window.innerWidth / 2)) continue;
    if (!wantRightSide && cX >= (window.innerWidth / 2)) continue;
    if (Math.abs(cY - centerY) > Math.max(70, srcRect.height * 1.1)) continue;
    const wRatio = r.width / Math.max(1, srcRect.width);
    const hRatio = r.height / Math.max(1, srcRect.height);
    if (wRatio < 0.45 || wRatio > 2.25 || hRatio < 0.45 || hRatio > 2.25) continue;
    const hint = getElementHint(node);
    let sharedTokens = 0;
    classTokens.forEach((t) => { if (hint.includes(t)) sharedTokens += 1; });
    const xSymmetry = Math.abs((window.innerWidth - centerX) - cX);
    let score = (r.width * r.height) - (xSymmetry * 45) - (Math.abs(cY - centerY) * 80);
    score += (sharedTokens * 9000);
    if (score > bestScore) {
      bestScore = score;
      best = node;
    }
  }
  return best;
}

function fillMissingPairedTargets() {
  const pairs = [["player-score-left", "player-score-right"]];
  pairs.forEach(([leftKey, rightKey]) => {
    const left = getTargetByKey(leftKey)?.el || null;
    const right = getTargetByKey(rightKey)?.el || null;
    if (left && !right) {
      if (String(BUILDER_DATA?.[rightKey]?.sel || "").trim()) return;
      const partner = findSymmetricPartnerFor(left, true);
      if (partner && arePlayerScoreTargetsDisjoint(left, partner)) {
        registerBuilderTarget(rightKey, partner, "paired-fallback");
      }
    } else if (!left && right) {
      if (String(BUILDER_DATA?.[leftKey]?.sel || "").trim()) return;
      const partner = findSymmetricPartnerFor(right, false);
      if (partner && arePlayerScoreTargetsDisjoint(partner, right)) {
        registerBuilderTarget(leftKey, partner, "paired-fallback");
      }
    }
  });
}

function getMinSizeForTarget(key) {
  const target = getTargetByKey(key);
  const r = target?.el?.getBoundingClientRect?.();
  const baseW = r && r.width > 0 ? r.width : 120;
  const baseH = r && r.height > 0 ? r.height : 80;
  return {
    w: Math.max(36, Math.round(baseW * 0.28)),
    h: Math.max(30, Math.round(baseH * 0.28))
  };
}

function clampBuilderCropPct(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(48, Math.round(x)));
}

/** Viewport-Rechteck der sichtbaren Fläche nach `inset(ct% cr% cb% cl%)` (OBS-ähnlich). */
function clientRectAfterCropInset(r, entry) {
  if (!r || !Number.isFinite(r.left)) return r;
  const ct = clampBuilderCropPct(entry?.cropT);
  const cr = clampBuilderCropPct(entry?.cropR);
  const cb = clampBuilderCropPct(entry?.cropB);
  const cl = clampBuilderCropPct(entry?.cropL);
  if (!(ct > 0 || cr > 0 || cb > 0 || cl > 0)) {
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  }
  const rw = Math.max(1, r.width);
  const rh = Math.max(1, r.height);
  const left = r.left + (rw * cl) / 100;
  const top = r.top + (rh * ct) / 100;
  const width = Math.max(10, rw * (1 - (cl + cr) / 100));
  const height = Math.max(10, rh * (1 - (ct + cb) / 100));
  return { left, top, width, height };
}

function rectsIntersectViewport(a, b) {
  if (!a || !b || !Number.isFinite(a.left) || !Number.isFinite(b.left)) return false;
  const ar = a.left + a.width;
  const ab = a.top + a.height;
  const br = b.left + b.width;
  const bb = b.top + b.height;
  return !(ar < b.left || br < a.left || ab < b.top || bb < a.top);
}

/** Sichtbares Auswahl-Rechteck eines Ziels (nach Crop), z. B. für Marquee-Schnitt. */
function getBuilderTargetInteractiveRect(key) {
  const k = String(key || "");
  if (!k || !BUILDER_MOVABLE_KEY_SET.has(k) || k === DARTBOARD_GLOW_TARGET_KEY) return null;
  const t = getTargetByKey(k);
  const el = t?.el;
  if (!isBuilderElement(el) || !document.contains(el)) return null;
  const entry = getBuilderEntry(k);
  const ct0 = clampBuilderCropPct(entry.cropT);
  const cr0 = clampBuilderCropPct(entry.cropR);
  const cb0 = clampBuilderCropPct(entry.cropB);
  const cl0 = clampBuilderCropPct(entry.cropL);
  const hasCrop = ct0 > 0 || cr0 > 0 || cb0 > 0 || cl0 > 0;
  let rCropBase = el.getBoundingClientRect();
  if (k === "dartboard") {
    if (!hasCrop) {
      const u = getDartboardSelectionUnionRect();
      if (u) rCropBase = { left: u.left, top: u.top, width: u.width, height: u.height };
    } else {
      const board = getTargetByKey("dartboard")?.el;
      if (isBuilderElement(board) && document.contains(board)) rCropBase = board.getBoundingClientRect();
    }
  } else {
    rCropBase = { left: rCropBase.left, top: rCropBase.top, width: rCropBase.width, height: rCropBase.height };
  }
  return clientRectAfterCropInset(rCropBase, entry);
}

function collectBuilderTargetsIntersectingMarquee(x0, y0, x1, y1) {
  const left = Math.min(x0, x1);
  const top = Math.min(y0, y1);
  const right = Math.max(x0, x1);
  const bottom = Math.max(y0, y1);
  const mw = right - left;
  const mh = bottom - top;
  if (mw < 4 || mh < 4) return [];
  const marq = { left, top, width: mw, height: mh };
  refreshBuilderTargets();
  const keys = [];
  for (const t of BUILDER_TARGETS) {
    if (!t?.key) continue;
    const kk = String(t.key);
    if (!BUILDER_MOVABLE_KEY_SET.has(kk) || kk === DARTBOARD_GLOW_TARGET_KEY) continue;
    const r = getBuilderTargetInteractiveRect(kk);
    if (!r) continue;
    if (rectsIntersectViewport(marq, r)) keys.push(kk);
  }
  return keys;
}

function clearBuilderSelectionHitMarkers() {
  document.querySelectorAll("[data-adm-builder-hit='1'],[data-ad-sb-builder-hit='1']").forEach((n) => {
    try {
      n.removeAttribute("data-adm-builder-hit");
      n.removeAttribute("data-ad-sb-builder-hit");
    } catch {}
  });
}

function syncBuilderPrimaryFromKeys() {
  const keys = BUILDER_SELECTED_KEYS.filter(Boolean);
  BUILDER_SELECTED_SELECTOR = keys.length ? keys[keys.length - 1] : "";
  const t = getTargetByKey(BUILDER_SELECTED_SELECTOR);
  BUILDER_SELECTED = t?.el && document.contains(t.el) ? t.el : null;
}

function mergeUniqueBuilderKeys(base, add) {
  const out = [...(base || [])];
  const seen = new Set(out);
  for (const k of add || []) {
    const x = String(k || "");
    if (!x || seen.has(x)) continue;
    seen.add(x);
    out.push(x);
  }
  return out;
}

function setBuilderSelectionFromKeyList(nextKeys, additive) {
  const incoming = (nextKeys || [])
    .map((k) => String(k || ""))
    .filter((k) => BUILDER_MOVABLE_KEY_SET.has(k) && k !== DARTBOARD_GLOW_TARGET_KEY);
  const uniq = [...new Set(incoming)];
  BUILDER_SELECTED_KEYS = additive ? mergeUniqueBuilderKeys(BUILDER_SELECTED_KEYS, uniq) : uniq;
  clearBuilderSelectionHitMarkers();
  for (const key of BUILDER_SELECTED_KEYS) {
    const t = getTargetByKey(key);
    if (t?.el && document.contains(t.el)) t.el.dataset.admBuilderHit = "1";
  }
  syncBuilderPrimaryFromKeys();
  try {
    applyBuilderDataToDom();
  } catch {}
  refreshBuilderSelectionBox();
}

function beginBuilderDragFromPointerEvent(ev) {
  const keysToDrag = BUILDER_SELECTED_KEYS.filter(
    (k) => !isBuilderTargetLocked(k) && BUILDER_MOVABLE_KEY_SET.has(String(k)) && String(k) !== DARTBOARD_GLOW_TARGET_KEY
  );
  if (!keysToDrag.length) return false;
  const iw = Math.max(1, window.innerWidth || 1);
  const ih = Math.max(1, window.innerHeight || 1);
  /** @type {Record<string, { useUv: boolean, startVXv: number, startVYv: number, startLeft: number, startTop: number }>} */
  const starts = {};
  for (const k of keysToDrag) {
    const t = getTargetByKey(k);
    const el = t?.el;
    if (!isBuilderElement(el) || !document.contains(el)) continue;
    const entry = getBuilderEntry(k);
    migrateBuilderEntryToViewportAnchorsIfNeeded(entry, el);
    starts[k] = {
      useUv: Number(entry.posUv) === 1,
      startVXv: Number(entry.vx || 0),
      startVYv: Number(entry.vy || 0),
      startLeft: Number(entry.x || 0),
      startTop: Number(entry.y || 0)
    };
  }
  const okKeys = Object.keys(starts);
  if (!okKeys.length) return false;
  BUILDER_DRAG = {
    keys: okKeys,
    startX: ev.clientX,
    startY: ev.clientY,
    iw,
    ih,
    starts
  };
  return true;
}

function ensureBuilderMarqueeOverlay() {
  let el = document.getElementById(BUILDER_MARQUEE_ID);
  if (!el) {
    el = document.createElement("div");
    el.id = BUILDER_MARQUEE_ID;
    el.setAttribute("aria-hidden", "true");
    mountBuilderFixedHost(el);
  } else {
    mountBuilderFixedHost(el);
  }
  return el;
}

function hideBuilderMarqueeOverlay() {
  const el = document.getElementById(BUILDER_MARQUEE_ID);
  if (el) el.style.display = "none";
}

function updateBuilderMarqueeFromDrag() {
  const m = BUILDER_MARQUEE_DRAG;
  if (!m) return;
  const el = ensureBuilderMarqueeOverlay();
  const left = Math.min(m.sx, m.curX);
  const top = Math.min(m.sy, m.curY);
  const w = Math.abs(m.curX - m.sx);
  const h = Math.abs(m.curY - m.sy);
  el.style.display = "block";
  el.style.left = `${Math.round(left)}px`;
  el.style.top = `${Math.round(top)}px`;
  el.style.width = `${Math.max(0, Math.round(w))}px`;
  el.style.height = `${Math.max(0, Math.round(h))}px`;
}

const BUILDER_CROP_FRAME_STYLE_ID = "adm-theme-builder-crop-frame-style";

/** Aktiver Spieler / „am Zug“ — dann dicker Rahmen wie bei .adm-selected-marker oben/unten. */
function isBuilderCropFrameTurnHighlight(el) {
  if (!isBuilderElement(el)) return false;
  let cur = el;
  for (let i = 0; i < 8 && cur; i += 1) {
    if (cur.classList?.contains("adm-selected-marker")) return true;
    const cn = String(cur.className || "").toLowerCase();
    if (cn.includes("mui-selected")) return true;
    if (String(cur.getAttribute?.("aria-selected") || "") === "true") return true;
    if (String(cur.getAttribute?.("data-state") || "") === "active") return true;
    if (String(cur.getAttribute?.("data-active") || "") === "true") return true;
    if (cur.querySelector?.(":scope .adm-selected-marker")) return true;
    if (cur.querySelector?.(":scope .Mui-selected")) return true;
    if (cur.querySelector?.(':scope [data-state="active"]')) return true;
    cur = cur.parentElement;
  }
  return false;
}

/**
 * Nur Crop-Rahmen (Spieler am Zug) — ohne vollen `applyBuilderDataToDom`.
 * Sonst kämpft React/Chakra ständig mit unseren Inline-Transforms (`style` vs. `data-ad-sb-builder-original-style`).
 */
function refreshBuilderCropFrameTurnHighlights() {
  if (!pathnameIndicatesWebsiteThemesPlayfield()) return;
  const nodes = document.querySelectorAll(SEL_SB_BUILDER_APPLIED_CROP);
  nodes.forEach((el) => {
    if (!isBuilderElement(el)) return;
    const turn = isBuilderCropFrameTurnHighlight(el);
    try {
      el.style.setProperty("--adm-crop-frame-w", turn ? "3px" : "2px", "important");
      el.style.setProperty(
        "--adm-crop-frame-c",
        turn ? "rgba(232,242,255,.98)" : "rgba(248,252,255,.97)",
        "important"
      );
    } catch {}
  });
}

function scheduleBuilderLayoutReapply() {
  if (BUILDER_LAYOUT_REAPPLY_TIMER) {
    try {
      clearTimeout(BUILDER_LAYOUT_REAPPLY_TIMER);
    } catch {}
  }
  BUILDER_LAYOUT_REAPPLY_TIMER = setTimeout(() => {
    BUILDER_LAYOUT_REAPPLY_TIMER = null;
    try {
      const cfg = WEBSITE_THEME_STATE;
      if (!cfg?.enabled) return;
      if (!pathnameIndicatesWebsiteThemesPlayfield()) return;
      const activeThemeId = String(cfg.theme || "").toLowerCase();
      const keepDefaultAlignment = BUILDER_DEFAULT_ALIGNMENT_THEMES.has(activeThemeId) && !BUILDER_SESSION_ACTIVE;
      if (keepDefaultAlignment) return;
      if (isBuilderPointerTransformActive()) return;
      applyBuilderDataToDom();
      refreshBuilderSelectionBox();
    } catch {}
  }, 320);
}

function shouldReconcileBuilderLayoutOnViewportChange() {
  try {
    const cfg = WEBSITE_THEME_STATE;
    if (!cfg?.enabled) return false;
    if (!pathnameIndicatesWebsiteThemesPlayfield()) return false;
    const activeThemeId = String(cfg.theme || "").toLowerCase();
    if (BUILDER_DEFAULT_ALIGNMENT_THEMES.has(activeThemeId) && !BUILDER_SESSION_ACTIVE) return false;
    return true;
  } catch {
    return false;
  }
}

function listUvBuilderLayoutKeys() {
  const out = [];
  for (const t of BUILDER_TARGET_KEYS) {
    const k = String(t.key || "");
    if (!BUILDER_MOVABLE_KEY_SET.has(k) || k === DARTBOARD_GLOW_TARGET_KEY) continue;
    const entry = BUILDER_DATA[k];
    if (!entry || typeof entry !== "object") continue;
    if (Number(entry.posUv) !== 1 || !Number.isFinite(Number(entry.vx)) || !Number.isFinite(Number(entry.vy))) continue;
    const el = getTargetByKey(k)?.el;
    if (!isBuilderElement(el) || !document.contains(el)) continue;
    out.push(k);
  }
  return out;
}

function measureBuilderTargetRectByKey(k) {
  const el = getTargetByKey(k)?.el;
  if (!isBuilderElement(el) || !document.contains(el)) return null;
  const r = el.getBoundingClientRect();
  return { k, left: r.left, top: r.top, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
}

function applyBuilderUvPixelDelta(k, dxPx, dyPx) {
  const iw = Math.max(1, window.innerWidth || 1);
  const ih = Math.max(1, window.innerHeight || 1);
  const e = BUILDER_DATA[k];
  if (!e) return;
  e.vx = Number(e.vx) + dxPx / iw;
  e.vy = Number(e.vy) + dyPx / ih;
  const el = getTargetByKey(k)?.el;
  if (el) applyBuilderEntryToElement(el, e);
}

function clampBuilderUvRectsToViewport() {
  const iw = Math.max(1, window.innerWidth || 1);
  const ih = Math.max(1, window.innerHeight || 1);
  const pad = 6;
  for (const k of listUvBuilderLayoutKeys()) {
    const r = measureBuilderTargetRectByKey(k);
    if (!r) continue;
    let dx = 0;
    let dy = 0;
    if (r.left < pad) dx += pad - r.left;
    if (r.top < pad) dy += pad - r.top;
    if (r.right > iw - pad) dx += iw - pad - r.right;
    if (r.bottom > ih - pad) dy += ih - pad - r.bottom;
    if (dx !== 0 || dy !== 0) applyBuilderUvPixelDelta(k, dx, dy);
  }
}

/**
 * Nach Viewport-Änderung: relative px-Layouts in UV wandeln und sichtbare UV-Ziele ins Fenster schieben.
 * (Kein paarweises „Überlappungs-Auseinanderdrücken“ — das hat unabhängige Ziele wie Score links/rechts mitverrutscht.)
 */
function reconcileBuilderLayoutForViewportSize() {
  if (!shouldReconcileBuilderLayoutOnViewportChange()) return;
  refreshBuilderTargets();
  for (const t of BUILDER_TARGET_KEYS) {
    const k = String(t.key || "");
    if (!BUILDER_MOVABLE_KEY_SET.has(k) || k === DARTBOARD_GLOW_TARGET_KEY) continue;
    const entry = BUILDER_DATA[k];
    if (!entry || typeof entry !== "object") continue;
    const el = getTargetByKey(k)?.el;
    if (!isBuilderElement(el) || !document.contains(el)) continue;
    if (Number(entry.posUv) !== 1 || !Number.isFinite(Number(entry.vx)) || !Number.isFinite(Number(entry.vy))) {
      migrateBuilderEntryToViewportAnchorsIfNeeded(entry, el);
    }
  }
  applyBuilderDataToDom();
  clampBuilderUvRectsToViewport();

  refreshBuilderSelectionBox();
  scheduleBuilderLayoutResync();
}

function scheduleBuilderResizeReconcile() {
  if (BUILDER_ACTIVE) return;
  if (!shouldReconcileBuilderLayoutOnViewportChange()) return;
  if (BUILDER_RESIZE_RECONCILE_TIMER) {
    try {
      clearTimeout(BUILDER_RESIZE_RECONCILE_TIMER);
    } catch {}
  }
  BUILDER_RESIZE_RECONCILE_TIMER = setTimeout(() => {
    BUILDER_RESIZE_RECONCILE_TIMER = null;
    try {
      if (isBuilderPointerTransformActive()) return;
      reconcileBuilderLayoutForViewportSize();
    } catch {}
  }, 200);
}

/** ::after-Rahmen im sichtbaren inset-Bereich (clip-path schneidet die Original-Ränder ab). */
function ensureBuilderCropFrameCss() {
  const css = `
    .adm-builder-has-crop::after{
      content:"";
      position:absolute;
      pointer-events:none;
      box-sizing:border-box;
      z-index:2147483000;
      inset:var(--adm-crop-t,0%) var(--adm-crop-r,0%) var(--adm-crop-b,0%) var(--adm-crop-l,0%);
      box-shadow:inset 0 0 0 var(--adm-crop-frame-w,2px) var(--adm-crop-frame-c, rgba(248,252,255,.96));
      border-radius:var(--adm-crop-frame-br,0px);
    }
  `;
  let s = document.getElementById(BUILDER_CROP_FRAME_STYLE_ID);
  if (s) {
    s.textContent = css;
    return;
  }
  s = document.createElement("style");
  s.id = BUILDER_CROP_FRAME_STYLE_ID;
  s.textContent = css;
  (document.head || document.documentElement || document.body).appendChild(s);
}

function clearBuilderCropFrameVars(el) {
  if (!el?.classList) return;
  el.classList.remove("adm-builder-has-crop");
  const st = el.style;
  if (!st) return;
  st.removeProperty("--adm-crop-t");
  st.removeProperty("--adm-crop-r");
  st.removeProperty("--adm-crop-b");
  st.removeProperty("--adm-crop-l");
  st.removeProperty("--adm-crop-frame-br");
  st.removeProperty("--adm-crop-frame-w");
  st.removeProperty("--adm-crop-frame-c");
}

function applyBuilderEntryToElement(el, entry) {
  if (!el || !entry) return;
  if (!el.dataset.adSbBuilderOriginalStyle) {
    el.dataset.adSbBuilderOriginalStyle = el.getAttribute("style") || "";
  }
  el.dataset.adSbBuilderApplied = "1";
  const useUv = Number(entry.posUv) === 1 && Number.isFinite(Number(entry.vx)) && Number.isFinite(Number(entry.vy));
  if (useUv) {
    const vx = Number(entry.vx);
    const vy = Number(entry.vy);
    const vw = Number(entry.vw);
    const vh = Number(entry.vh);
    const hasWh = Number.isFinite(vw) && vw > 0.0005 && Number.isFinite(vh) && vh > 0.0005;
    el.style.setProperty("position", "fixed", "important");
    el.style.setProperty("left", `${vx * 100}vw`, "important");
    el.style.setProperty("top", `${vy * 100}vh`, "important");
    el.style.setProperty("margin", "0", "important");
    if (hasWh) {
      el.style.setProperty("width", `${vw * 100}vw`, "important");
      el.style.setProperty("height", `${vh * 100}vh`, "important");
      el.style.setProperty("box-sizing", "border-box", "important");
    } else {
      el.style.removeProperty("width");
      el.style.removeProperty("height");
      el.style.removeProperty("box-sizing");
    }
  } else {
    el.style.setProperty("position", "relative", "important");
    el.style.setProperty("left", `${Math.round(entry.x || 0)}px`, "important");
    el.style.setProperty("top", `${Math.round(entry.y || 0)}px`, "important");
    el.style.removeProperty("width");
    el.style.removeProperty("height");
    el.style.removeProperty("box-sizing");
  }
  const sx = Number(entry.sx || 1);
  const sy = Number(entry.sy || 1);
  const safeSx = Number.isFinite(sx) ? Math.max(0.25, Math.min(4.0, sx)) : 1;
  const safeSy = Number.isFinite(sy) ? Math.max(0.25, Math.min(4.0, sy)) : 1;
  // Immer gleichmäßig skalieren (Scheibe rund, keine unabhängigen X/Y-Streckungen)
  const uScale = Math.sqrt(Math.max(0.0625, safeSx * safeSy));
  const rot = Number(entry.rot || 0);
  const safeRot = Number.isFinite(rot) ? rot : 0;
  const rx = Number(entry.rx || 0);
  const ry = Number(entry.ry || 0);
  // Extremwerte machen die Scheibe im Hit-Test schwer greifbar (eine Seite "taucht" hinter andere Layer).
  // Etwas enger clampen hält 3D sichtbar, aber verhindert unbedienbare Zustände.
  const safeRx = Number.isFinite(rx) ? Math.max(-BUILDER_MAX_TILT_DEG, Math.min(BUILDER_MAX_TILT_DEG, rx)) : 0;
  const safeRy = Number.isFinite(ry) ? Math.max(-BUILDER_MAX_TILT_DEG, Math.min(BUILDER_MAX_TILT_DEG, ry)) : 0;
  let persp = Number(entry.persp || 0);
  if (!Number.isFinite(persp) || persp <= 0) persp = 1000;
  persp = Math.round(Math.max(220, Math.min(2800, persp)));
  const has3d = Math.abs(safeRx) > 0.04 || Math.abs(safeRy) > 0.04;
  el.style.setProperty("transform-origin", has3d || useUv ? "center center" : "top left", "important");
  if (has3d) {
    el.style.setProperty("transform-style", "preserve-3d", "important");
    el.style.setProperty(
      "transform",
      `perspective(${persp}px) rotateX(${safeRx}deg) rotateY(${safeRy}deg) rotate(${safeRot}deg) scale(${uScale}, ${uScale})`,
      "important"
    );
  } else {
    el.style.removeProperty("transform-style");
    el.style.setProperty("transform", `rotate(${safeRot}deg) scale(${uScale}, ${uScale})`, "important");
  }
  const rad = Math.max(0, Math.round(entry.r || 0));
  const ct = clampBuilderCropPct(entry.cropT);
  const cr = clampBuilderCropPct(entry.cropR);
  const cb = clampBuilderCropPct(entry.cropB);
  const cl = clampBuilderCropPct(entry.cropL);
  const boardEl = getTargetByKey("dartboard")?.el;
  const isDartboardSurface =
    el === boardEl || String(el.dataset?.adSbDartboardGlow || "") === "1";
  if (ct > 0 || cr > 0 || cb > 0 || cl > 0) {
    const roundPart = rad > 0 ? ` round ${rad}px` : "";
    el.style.setProperty("clip-path", `inset(${ct}% ${cr}% ${cb}% ${cl}%${roundPart})`, "important");
    el.style.removeProperty("border-radius");
    if (isDartboardSurface) {
      clearBuilderCropFrameVars(el);
    } else {
      ensureBuilderCropFrameCss();
      el.classList.add("adm-builder-has-crop");
      el.style.setProperty("--adm-crop-t", `${ct}%`, "important");
      el.style.setProperty("--adm-crop-r", `${cr}%`, "important");
      el.style.setProperty("--adm-crop-b", `${cb}%`, "important");
      el.style.setProperty("--adm-crop-l", `${cl}%`, "important");
      const innerBr = rad > 0 ? Math.max(0, rad - 2) : 0;
      el.style.setProperty("--adm-crop-frame-br", innerBr > 0 ? `${innerBr}px` : "0px", "important");
      const turn = isBuilderCropFrameTurnHighlight(el);
      el.style.setProperty("--adm-crop-frame-w", turn ? "3px" : "2px", "important");
      el.style.setProperty(
        "--adm-crop-frame-c",
        turn ? "rgba(232,242,255,.98)" : "rgba(248,252,255,.97)",
        "important"
      );
    }
  } else {
    el.style.removeProperty("clip-path");
    clearBuilderCropFrameVars(el);
    if ((entry.r || 0) >= 0) el.style.setProperty("border-radius", `${rad}px`, "important");
  }
  el.style.setProperty("z-index", "42", "important");

  if (boardEl && el === boardEl) {
    const glowEl = getTargetByKey(DARTBOARD_GLOW_TARGET_KEY)?.el;
    if (isBuilderElement(glowEl) && glowEl !== el) {
      applyBuilderEntryToElement(glowEl, entry);
    }
  }
  if (
    BUILDER_ACTIVE &&
    pathnameIndicatesWebsiteThemesPlayfield() &&
    String(BUILDER_SELECTED_SELECTOR || "") === "dartboard" &&
    boardEl &&
    isBuilderElement(BUILDER_SELECTED) &&
    BUILDER_SELECTED !== boardEl
  ) {
    try {
      document.querySelectorAll("[data-adm-builder-hit='1'],[data-ad-sb-builder-hit='1']").forEach((n) => {
        try {
          n.removeAttribute("data-adm-builder-hit");
          n.removeAttribute("data-ad-sb-builder-hit");
        } catch {}
      });
    } catch {}
    BUILDER_SELECTED = boardEl;
    BUILDER_SELECTED.dataset.admBuilderHit = "1";
  }
}

function clearBuilderAppliedStyles() {
  clearPlayerDisplayFlexStabilizer();
  const nodes = document.querySelectorAll(SEL_SB_BUILDER_APPLIED);
  nodes.forEach((el) => stripBuilderAppliedFromElement(el));
}

function cleanupOrphanBuilderAppliedStyles() {
  const nodes = document.querySelectorAll(SEL_SB_BUILDER_APPLIED);
  nodes.forEach((el) => {
    let key = String(el.dataset.adSbBuilderKey || "");
    if (!key && el.dataset.adSbDartboardGlow === "1") key = "dartboard";
    if ((!key || !BUILDER_DATA?.[key]) && Array.isArray(BUILDER_TARGETS)) {
      const hit = BUILDER_TARGETS.find((t) => t?.el === el);
      if (hit?.key && BUILDER_DATA?.[String(hit.key)]) {
        key = String(hit.key);
        try {
          el.dataset.adSbBuilderKey = key;
        } catch {}
      }
    }
    if (!key || !BUILDER_DATA?.[key]) {
      try {
        el.classList.remove("adm-builder-has-crop");
      } catch {}
      const orig = el.dataset.adSbBuilderOriginalStyle;
      if (orig !== undefined) {
        if (orig) el.setAttribute("style", orig);
        else el.removeAttribute("style");
      }
      delete el.dataset.adSbBuilderApplied;
      delete el.dataset.adSbBuilderOriginalStyle;
      try {
        el.removeAttribute("data-adm-builder-hit");
        el.removeAttribute("data-ad-sb-builder-hit");
      } catch {}
    }
  });
}

function applyBuilderDataToDom() {
  if (!pathnameIndicatesWebsiteThemesPlayfield()) {
    try {
      document.documentElement.removeAttribute("data-adm-play-mode");
    } catch {}
    clearBuilderAppliedStyles();
    cleanupOrphanBuilderAppliedStyles();
    return;
  }
  if (!isBuilderPointerTransformActive()) {
    switchBuilderDataForPlayModeIfNeeded();
  }
  if (isBuilderPointerTransformActive()) return;
  // Wichtig: `refreshBuilderTargets` → `clearBuilderTargetMarks` entfernt kurz `data-ad-sb-builder-key`.
  // Darf `cleanupOrphanBuilderAppliedStyles` **danach** laufen, sonst wirkt jedes Ziel wie eine „Waise“.
  cleanupOrphanBuilderAppliedStyles();
  refreshBuilderTargets();
  const entries = BUILDER_DATA || {};
  Object.keys(entries).forEach((key) => {
    if (key === DARTBOARD_GLOW_TARGET_KEY) return;
    if (!BUILDER_MOVABLE_KEY_SET.has(key)) return;
    const entry = entries[key];
    if (!entry || typeof entry !== "object") return;
    const target = BUILDER_TARGETS.find((t) => t.key === key);
    const el = target?.el || null;
    if (!el) return;
    if (!entry.sel) entry.sel = buildElementSelector(el);
    applyBuilderEntryToElement(el, entry);
    if (key === "player-score-left" || key === "player-score-right") {
      el.style.setProperty("overflow", "visible", "important");
      if (el.parentElement) el.parentElement.style.setProperty("overflow", "visible", "important");
    }
  });

  const boardEntry = entries?.dartboard;
  let glowTarget = getTargetByKey(DARTBOARD_GLOW_TARGET_KEY);
  if (!glowTarget?.el) {
    const boardEl = getTargetByKey("dartboard")?.el || null;
    const foundGlow = boardEl ? detectDartboardGlowCompanion(boardEl) : null;
    if (foundGlow) {
      registerBuilderCompanionTarget(DARTBOARD_GLOW_TARGET_KEY, foundGlow, "dartboard", "board-glow");
      foundGlow.dataset.adSbDartboardGlow = "1";
      glowTarget = getTargetByKey(DARTBOARD_GLOW_TARGET_KEY);
    }
  }
  if (glowTarget?.el) {
    glowTarget.el.style.setProperty("pointer-events", "none", "important");
    glowTarget.el.dataset.adSbDartboardGlow = "1";
    if (WEBSITE_THEME_STATE?.dartboardGlowEnabled === false) {
      glowTarget.el.style.setProperty("display", "none", "important");
      glowTarget.el.style.setProperty("opacity", "0", "important");
    } else {
      glowTarget.el.style.removeProperty("display");
      glowTarget.el.style.removeProperty("opacity");
    }
  }
  if (BUILDER_ACTIVE && pathnameIndicatesWebsiteThemesPlayfield()) {
    syncBuilderSelectedToCurrentTarget();
  }
  applyPlayerDisplayFlexStabilizerIfNeeded();
}

function syncDartboardGlowVisibility() {
  if (!pathnameIndicatesWebsiteThemesPlayfield()) return;
  const enabled = WEBSITE_THEME_STATE?.dartboardGlowEnabled !== false;
  // Ensure dartboard target exists before trying to resolve companion glow node.
  if (!getTargetByKey("dartboard")) {
    try {
      detectDartboardTarget();
    } catch {}
  }
  const boardEl = getTargetByKey("dartboard")?.el || null;
  let glowEl = getTargetByKey(DARTBOARD_GLOW_TARGET_KEY)?.el || null;
  if (!glowEl && boardEl) {
    try {
      const found = detectDartboardGlowCompanion(boardEl);
      if (found) {
        registerBuilderCompanionTarget(DARTBOARD_GLOW_TARGET_KEY, found, "dartboard", "board-glow");
        found.dataset.adSbDartboardGlow = "1";
        glowEl = found;
      }
    } catch {}
  }
  if (!glowEl) return;
  try {
    glowEl.dataset.adSbDartboardGlow = "1";
    glowEl.style.setProperty("pointer-events", "none", "important");
    if (!enabled) {
      glowEl.style.setProperty("display", "none", "important");
      glowEl.style.setProperty("opacity", "0", "important");
    } else {
      glowEl.style.removeProperty("display");
      glowEl.style.removeProperty("opacity");
    }
  } catch {}
}

/**
 * Nach `refreshBuilderTargets` zeigt `BUILDER_SELECTED` oft noch auf ein altes DOM (z. B. innere Scheibe),
 * während `BUILDER_TARGETS` neu registriert — dann kein Treffer mehr beim Klick (wie früher bei Resize).
 */
function syncBuilderSelectedToCurrentTarget() {
  if (!BUILDER_SELECTED_KEYS.length) return;
  try {
    document.querySelectorAll("[data-adm-builder-hit='1'],[data-ad-sb-builder-hit='1']").forEach((n) => {
      try {
        n.removeAttribute("data-adm-builder-hit");
        n.removeAttribute("data-ad-sb-builder-hit");
      } catch {}
    });
  } catch {}
  const nextKeys = [];
  for (const key of BUILDER_SELECTED_KEYS) {
    const k = String(key || "");
    if (!k) continue;
    let el = null;
    const t = getTargetByKey(k);
    if (t?.el && document.contains(t.el)) {
      el = t.el;
    } else {
      const sel = String(BUILDER_DATA?.[k]?.sel || "");
      try {
        el = sel ? document.querySelector(sel) : null;
      } catch {
        el = null;
      }
    }
    if (isBuilderElement(el) && document.contains(el)) {
      nextKeys.push(k);
      el.dataset.admBuilderHit = "1";
    }
  }
  BUILDER_SELECTED_KEYS = nextKeys;
  syncBuilderPrimaryFromKeys();
}

function ensureBuilderEdgeZones(box) {
  if (!box) return;
  const edges = ["t", "r", "b", "l"];
  for (const e of edges) {
    if (box.querySelector(`[data-adm-builder-edge="${e}"]`)) continue;
    const z = document.createElement("div");
    z.setAttribute("data-adm-builder-edge", e);
    z.setAttribute("aria-hidden", "true");
    box.appendChild(z);
  }
}

function ensureBuilderOverlay() {
  getOrCreateBuilderStyle();
  let box = document.getElementById(BUILDER_BOX_ID);
  if (!box) {
    box = document.createElement("div");
    box.id = BUILDER_BOX_ID;
    const rotHandle = document.createElement("div");
    rotHandle.id = BUILDER_ROTATE_HANDLE_ID;
    box.appendChild(rotHandle);
    const handle = document.createElement("div");
    handle.id = BUILDER_HANDLE_ID;
    box.appendChild(handle);
    mountBuilderFixedHost(box);
  } else if (!box.querySelector(`#${BUILDER_ROTATE_HANDLE_ID}`)) {
    const rotHandle = document.createElement("div");
    rotHandle.id = BUILDER_ROTATE_HANDLE_ID;
    box.insertBefore(rotHandle, box.firstChild);
  }
  mountBuilderFixedHost(box);
  ensureBuilderEdgeZones(box);
  return box;
}

function ensureBuilderFullOutlineOverlay() {
  getOrCreateBuilderStyle();
  let ring = document.getElementById(BUILDER_FULL_OUTLINE_ID);
  if (!ring) {
    ring = document.createElement("div");
    ring.id = BUILDER_FULL_OUTLINE_ID;
    ring.setAttribute("aria-hidden", "true");
  }
  mountBuilderFixedHost(ring);
  return ring;
}

function refreshBuilderSelectionBox() {
  const box = ensureBuilderOverlay();
  const fullRing = ensureBuilderFullOutlineOverlay();
  const setHandlesVisible = (show) => {
    const rot = box.querySelector(`#${BUILDER_ROTATE_HANDLE_ID}`);
    const hdl = box.querySelector(`#${BUILDER_HANDLE_ID}`);
    if (rot) rot.style.display = show ? "" : "none";
    if (hdl) hdl.style.display = show ? "" : "none";
    box.querySelectorAll("[data-adm-builder-edge]").forEach((e) => {
      e.style.display = show ? "" : "none";
    });
  };
  if (BUILDER_ACTIVE && pathnameIndicatesWebsiteThemesPlayfield()) {
    repairBuilderGridLayer();
    if (BUILDER_SELECTED_KEYS.length) {
      syncBuilderSelectedToCurrentTarget();
    }
  }
  if (!BUILDER_ACTIVE) {
    box.style.display = "none";
    fullRing.style.display = "none";
    box.style.removeProperty("border-color");
    box.style.removeProperty("border-style");
    setHandlesVisible(true);
    hideBuilderMarqueeOverlay();
    return;
  }
  if (!pathnameIndicatesWebsiteThemesPlayfield()) {
    box.style.display = "none";
    fullRing.style.display = "none";
    box.style.removeProperty("border-color");
    box.style.removeProperty("border-style");
    setHandlesVisible(true);
    hideBuilderMarqueeOverlay();
    return;
  }
  const keysOk = BUILDER_SELECTED_KEYS.filter((k) => {
    const kk = String(k || "");
    if (!kk) return false;
    const el = getTargetByKey(kk)?.el;
    return isBuilderElement(el) && document.contains(el);
  });
  if (keysOk.length !== BUILDER_SELECTED_KEYS.length) {
    BUILDER_SELECTED_KEYS = keysOk;
    syncBuilderPrimaryFromKeys();
  }
  if (!BUILDER_SELECTED_KEYS.length || !BUILDER_SELECTED || !document.contains(BUILDER_SELECTED)) {
    box.style.display = "none";
    fullRing.style.display = "none";
    box.style.removeProperty("border-color");
    box.style.removeProperty("border-style");
    setHandlesVisible(true);
    return;
  }

  const primary = String(BUILDER_SELECTED_SELECTOR || "");
  const keyCount = BUILDER_SELECTED_KEYS.length;
  const showHandles = keyCount === 1;
  setHandlesVisible(showHandles);

  if (keyCount > 1) {
    fullRing.style.display = "none";
    let uL = Infinity;
    let uT = Infinity;
    let uR = -Infinity;
    let uB = -Infinity;
    let anyLocked = false;
    for (const k of BUILDER_SELECTED_KEYS) {
      const r = getBuilderTargetInteractiveRect(k);
      if (!r || !Number.isFinite(r.left)) continue;
      uL = Math.min(uL, r.left);
      uT = Math.min(uT, r.top);
      uR = Math.max(uR, r.left + r.width);
      uB = Math.max(uB, r.top + r.height);
      if (isBuilderTargetLocked(k)) anyLocked = true;
    }
    if (!Number.isFinite(uL) || !Number.isFinite(uT)) {
      box.style.display = "none";
      return;
    }
    box.style.display = "block";
    box.style.left = `${Math.round(uL)}px`;
    box.style.top = `${Math.round(uT)}px`;
    box.style.width = `${Math.max(10, Math.round(uR - uL))}px`;
    box.style.height = `${Math.max(10, Math.round(uB - uT))}px`;
    mountBuilderFixedHost(box);
    if (anyLocked) {
      box.style.setProperty("border-color", "rgba(255, 186, 120, 0.98)", "important");
      box.style.setProperty("border-style", "solid", "important");
    } else {
      box.style.removeProperty("border-color");
      box.style.removeProperty("border-style");
    }
    return;
  }

  const entrySel = getBuilderEntry(primary);
  const ct0 = clampBuilderCropPct(entrySel.cropT);
  const cr0 = clampBuilderCropPct(entrySel.cropR);
  const cb0 = clampBuilderCropPct(entrySel.cropB);
  const cl0 = clampBuilderCropPct(entrySel.cropL);
  const hasCrop = ct0 > 0 || cr0 > 0 || cb0 > 0 || cl0 > 0;
  const locked = isBuilderTargetLocked(primary);

  /** Volle Fläche (unbeschnitten) für äußeren Rahmen — wird von clip-path nicht abgeschnitten. */
  let rFull = BUILDER_SELECTED.getBoundingClientRect();
  if (primary === "dartboard") {
    const u = getDartboardSelectionUnionRect();
    if (u) rFull = { left: u.left, top: u.top, width: u.width, height: u.height };
  } else {
    rFull = { left: rFull.left, top: rFull.top, width: rFull.width, height: rFull.height };
  }

  let rCropBase = BUILDER_SELECTED.getBoundingClientRect();
  if (primary === "dartboard") {
    if (!hasCrop) {
      const u = getDartboardSelectionUnionRect();
      if (u) rCropBase = { left: u.left, top: u.top, width: u.width, height: u.height };
    } else {
      const board = getTargetByKey("dartboard")?.el;
      if (isBuilderElement(board) && document.contains(board)) rCropBase = board.getBoundingClientRect();
    }
  } else {
    rCropBase = { left: rCropBase.left, top: rCropBase.top, width: rCropBase.width, height: rCropBase.height };
  }
  const rCrop = clientRectAfterCropInset(rCropBase, entrySel);

  if (hasCrop) {
    fullRing.style.display = "block";
    fullRing.style.left = `${Math.round(rFull.left)}px`;
    fullRing.style.top = `${Math.round(rFull.top)}px`;
    fullRing.style.width = `${Math.max(10, Math.round(rFull.width))}px`;
    fullRing.style.height = `${Math.max(10, Math.round(rFull.height))}px`;
    const br = Math.max(0, Math.round(entrySel.r || 0));
    fullRing.style.borderRadius = br > 0 ? `${br}px` : "10px";
    if (locked) {
      fullRing.style.setProperty("border", "1px solid rgba(255, 186, 120, 0.9)", "important");
      fullRing.style.setProperty("box-shadow", "0 0 0 1px rgba(255, 186, 120, 0.45) inset, 0 0 10px rgba(255, 186, 120, 0.22)", "important");
    } else {
      fullRing.style.setProperty("border", "1px solid rgba(232,242,255,.72)", "important");
      fullRing.style.setProperty("box-shadow", "0 0 0 1px rgba(232,242,255,.35) inset, 0 0 12px rgba(170,206,255,.28)", "important");
    }
    mountBuilderFixedHost(fullRing);
  } else {
    fullRing.style.display = "none";
  }

  box.style.display = "block";
  box.style.left = `${Math.round(rCrop.left)}px`;
  box.style.top = `${Math.round(rCrop.top)}px`;
  box.style.width = `${Math.max(10, Math.round(rCrop.width))}px`;
  box.style.height = `${Math.max(10, Math.round(rCrop.height))}px`;
  mountBuilderFixedHost(box);
  if (locked) {
    box.style.setProperty("border-color", "rgba(255, 186, 120, 0.98)", "important");
    box.style.setProperty("border-style", "solid", "important");
  } else if (BUILDER_CROP_DRAG && BUILDER_CROP_DRAG.selector === primary) {
    box.style.setProperty("border-color", "rgba(255, 72, 72, 0.98)", "important");
    box.style.setProperty("border-style", "dashed", "important");
  } else {
    box.style.removeProperty("border-color");
    box.style.removeProperty("border-style");
  }
}

function saveBuilderDataToSettings() {
  try {
    if (!chrome?.storage?.local) return;
    chrome.storage.local.get(["settings"], (items) => {
      const settings = items?.settings || {};
      settings.websiteThemeBuilderData = serializeBuilderDataRootForStorage();
      chrome.storage.local.set({ settings });
    });
  } catch {}
}

/**
 * Einstellungen nach „Alles zurücksetzen“: Extension injiziert **kein** Website-Theme mehr → wie natives Autodarts.
 * (`websiteMatchNativeAutodarts` — kein `themesEnabled:false`, sonst bliebe die Injektion dauerhaft aus.)
 * Vorheriges Extension-„Werk“-Aussehen ≈ Theme **AutodartsMinus** in der Galerie.
 */
function getWebsiteThemeNativeResetSettingsPatch() {
  return {
    websiteMatchNativeAutodarts: true,
    websiteThemeBuilderEnabled: false,
    websiteThemeBuilderData: "{}",
    websiteHideLeftMenuByDefault: false
  };
}

/** Gleiche Keys wie `Modules/themes/config.js` → `defaults` (Extension-Standard für die Website). */
function getWebsiteThemeFactoryDefaults() {
  try {
    const d = globalThis.ADM_MODULE_CONFIGS?.themes?.defaults;
    if (d && typeof d === "object") return { ...d };
  } catch {}
  return {
    websiteLayout: "horizontal",
    websiteTheme: "classic",
    websiteArenaPrimaryHue: 210,
    websiteArenaSecondaryHue: 155,
    websiteArenaTertiaryHue: 125,
    websiteDartboardGlowEnabled: true,
    websiteThemeBuilderEnabled: false,
    websiteThemeBuilderData: "{}",
    websiteCustomThemesHorizontal: "[]",
    websiteCustomThemesVertical: "[]",
    websiteCommunityFavorites: "[]",
    websiteThemeTobyleifAutoUpdate: false,
    websiteThemeTobyleifCatalogRemoteJson: "",
    websiteThemeTobyleifCatalogMetaJson: "{}",
    websiteThemeTobyleifLiveThumbByIdJson: "{}",
    websiteThemeBuilderTargets: "[]",
    websiteBackgroundImageData: "",
    websiteBackgroundImageDataMatch: "",
    websiteBackgroundImageDataMenu: "",
    websiteThemeGalleryBadgeStateJson: "{}",
    websiteBackgroundSize: "cover",
    websiteHideLeftMenuByDefault: true
  };
}

/**
 * Vor Werkseinstellungen: Extension-`insertCSS`, lokales Theme-`<style>` und Builder-Markierungen leeren,
 * damit kein altes Stylebot-/Custom-CSS „kleben“ bleibt (nur Hintergrund wäre dann sichtbar zurückgesetzt).
 */
function flushWebsiteThemeInjectionAndDecorations() {
  try {
    sendWebsiteThemeCss("");
  } catch {}
  try {
    const existing = document.getElementById(WEBSITE_THEME_STYLE_ID);
    if (existing) existing.remove();
  } catch {}
  try {
    clearWebsiteThemeDecorations();
  } catch {}
}

function resetBuilderToDefaults() {
  try {
    BUILDER_PIN_KEYS_SEEN = new Set();
  } catch {}
  BUILDER_SESSION_ACTIVE = false;
  BUILDER_SELECTED = null;
  BUILDER_SELECTED_SELECTOR = "";
  BUILDER_SELECTED_KEYS = [];
  BUILDER_DRAG = null;
  BUILDER_RESIZE = null;
  BUILDER_ROTATE_DRAG = null;
  BUILDER_CROP_DRAG = null;
  BUILDER_PERSP_EDGE_DRAG = null;
  if (BUILDER_WHEEL_COMMIT_TIMER) {
    try {
      clearTimeout(BUILDER_WHEEL_COMMIT_TIMER);
    } catch {}
    BUILDER_WHEEL_COMMIT_TIMER = 0;
  }

  const finishBuilderUiAfterThemeApply = () => {
    BUILDER_SESSION_SNAPSHOT = takeBuilderSessionSnapshot();
    BUILDER_HISTORY = [];
    BUILDER_HISTORY_INDEX = -1;
    commitBuilderHistorySnapshot();
    refreshBuilderTargets();
    ensureBuilderPinPanel();
    refreshBuilderSelectionBox();
    scheduleSelectedMarkerUpdate();
  };

  const applyNativeResetState = (settings) => {
    const factory = getWebsiteThemeFactoryDefaults();
    const nativePatch = getWebsiteThemeNativeResetSettingsPatch();
    const merged = { ...(settings || {}) };
    for (const k of Object.keys(factory)) {
      merged[k] = factory[k];
    }
    for (const k of Object.keys(nativePatch)) {
      merged[k] = nativePatch[k];
    }
    return merged;
  };

  try {
    if (!chrome?.storage?.local) {
      WEBSITE_THEME_STATE = normalizeWebsiteThemeSettings(applyNativeResetState(getWebsiteThemeFactoryDefaults()));
      try {
        localStorage.removeItem(MENU_STATE_KEY);
      } catch {}
      flushWebsiteThemeInjectionAndDecorations();
      applyWebsiteTheme();
      setBuilderActive(false);
      finishBuilderUiAfterThemeApply();
      return;
    }
    chrome.storage.local.get(["settings"], (items) => {
      const settings = applyNativeResetState(items?.settings || {});
      chrome.storage.local.set({ settings }, () => {
        void chrome.runtime?.lastError;
        WEBSITE_THEME_STATE = normalizeWebsiteThemeSettings(settings);
        try {
          localStorage.removeItem(MENU_STATE_KEY);
        } catch {}
        flushWebsiteThemeInjectionAndDecorations();
        applyWebsiteTheme();
        setBuilderActive(false);
        finishBuilderUiAfterThemeApply();
      });
    });
  } catch {
    try {
      WEBSITE_THEME_STATE = normalizeWebsiteThemeSettings(applyNativeResetState(getWebsiteThemeFactoryDefaults()));
      try {
        localStorage.removeItem(MENU_STATE_KEY);
      } catch {}
      flushWebsiteThemeInjectionAndDecorations();
      applyWebsiteTheme();
      setBuilderActive(false);
      finishBuilderUiAfterThemeApply();
    } catch {}
  }
}

function slugifyThemeName(name) {
  return String(name || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "custom";
}

/** Eindeutige Theme-ID pro Speichern (gleicher Anzeigename überschreibt nicht mehr den vorherigen Eintrag). */
function makeUniqueBuilderThemeId(label, layoutLetter) {
  const slug = slugifyThemeName(label);
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 8);
  const suffix = String(layoutLetter || "h").toLowerCase() === "v" ? "v" : "h";
  return `custom-${slug}-${t}-${r}-${suffix}`;
}

/** Builder-Overlays kurz ausblenden, damit der Screenshot nur die Match-Ansicht zeigt. */
function hideBuilderChromeForScreenshot() {
  const ids = [
    BUILDER_SAVE_BUTTON_ID,
    BUILDER_RESET_BUTTON_ID,
    BUILDER_PIN_BUTTON_ID,
    BUILDER_GRID_TOGGLE_ID,
    BUILDER_HINT_ID,
    BUILDER_BOX_ID,
    BUILDER_FULL_OUTLINE_ID,
    BUILDER_PIN_PANEL_ID,
    BUILDER_GRID_OVERLAY_ID,
    BUILDER_COLORS_PANEL_ID,
    BUILDER_BG_TRIGGER_ID,
    BUILDER_BG_POPOVER_ID,
    "adm-theme-builder-snap-toggle",
    "adm-theme-builder-align-all"
  ];
  const records = [];
  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    records.push({ el, vis: el.style.visibility, op: el.style.opacity, disp: el.style.display });
    el.style.visibility = "hidden";
    el.style.opacity = "0";
    el.style.display = "none";
  });
  const hitEls = [];
  try {
    document.querySelectorAll("[data-ad-sb-builder-hit='1']").forEach((el) => {
      try {
        el.removeAttribute("data-ad-sb-builder-hit");
      } catch {}
    });
    document.querySelectorAll("[data-adm-builder-hit='1']").forEach((el) => {
      hitEls.push(el);
      el.removeAttribute("data-adm-builder-hit");
    });
  } catch {}
  return () => {
    records.forEach(({ el, vis, op, disp }) => {
      el.style.visibility = vis;
      el.style.opacity = op;
      el.style.display = disp;
    });
    hitEls.forEach((el) => {
      try {
        el.setAttribute("data-adm-builder-hit", "1");
      } catch {}
    });
  };
}

function compressDataUrlToJpegDataUrl(dataUrl, maxEdge, quality) {
  return new Promise((resolve, reject) => {
    const raw = String(dataUrl || "").trim();
    if (!raw.startsWith("data:")) {
      reject(new Error("bad_data_url"));
      return;
    }
    const img = new Image();
    img.onload = () => {
      try {
        let w = img.naturalWidth || img.width;
        let h = img.naturalHeight || img.height;
        if (!w || !h) throw new Error("bad_dimensions");
        const scale = w > maxEdge || h > maxEdge ? Math.min(maxEdge / w, maxEdge / h) : 1;
        w = Math.max(1, Math.round(w * scale));
        h = Math.max(1, Math.round(h * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("no_canvas");
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", quality));
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = () => reject(new Error("image_load_failed"));
    img.src = raw;
  });
}

/**
 * Galerie-Thumbnail: sichtbarer Tab als JPEG (`captureVisibleTab` im Service Worker).
 * DOM-Bibliotheken (dom-to-image) scheitern auf play.autodarts.io zuverlässig (SVG/CSP/Assets).
 */
async function captureMatchPageGalleryThumbnailJpeg() {
  const dlg = document.getElementById(BUILDER_DIALOG_ID);
  const dlgWas = dlg ? dlg.style.display : "";
  if (dlg) dlg.style.display = "none";

  const savedSelector = String(BUILDER_SELECTED_SELECTOR || "");
  const savedKeys = BUILDER_SELECTED_KEYS.slice();
  try {
    document.querySelectorAll("[data-ad-sb-builder-hit='1']").forEach((el) => {
      try {
        el.removeAttribute("data-ad-sb-builder-hit");
      } catch {}
    });
    document.querySelectorAll("[data-adm-builder-hit='1']").forEach((el) => {
      try {
        el.removeAttribute("data-adm-builder-hit");
      } catch {}
    });
  } catch {}
  BUILDER_SELECTED = null;
  BUILDER_SELECTED_SELECTOR = "";
  BUILDER_SELECTED_KEYS = [];
  refreshBuilderSelectionBox();

  const undoChrome = hideBuilderChromeForScreenshot();
  try {
    await new Promise((r) => {
      requestAnimationFrame(() => requestAnimationFrame(r));
    });
    await new Promise((r) => setTimeout(r, 380));

    const res = await new Promise((resolve) => {
      try {
        if (!chrome?.runtime?.sendMessage) {
          resolve({ ok: false, error: "no_runtime" });
          return;
        }
        chrome.runtime.sendMessage({ type: "ADM_CAPTURE_VISIBLE_TAB_JPEG", quality: 84 }, (reply) => {
          const err = chrome.runtime.lastError;
          if (err) {
            resolve({ ok: false, error: `channel:${String(err.message || err)}` });
            return;
          }
          resolve(reply && typeof reply === "object" ? reply : { ok: false, error: "bad_reply" });
        });
      } catch (e) {
        resolve({ ok: false, error: String(e?.message || e) });
      }
    });

    const raw = String(res?.dataUrl || "").trim();
    if (!res?.ok || !raw.startsWith("data:image/")) {
      try {
        console.warn(
          "[ADM themes] Galerie-Screenshot fehlgeschlagen:",
          String(res?.error || "no_data"),
          "— Bei alten Meldungen zu domtoimage: chrome://extensions → Erweiterung neu laden."
        );
      } catch {}
      return "";
    }

    try {
      return await compressDataUrlToJpegDataUrl(raw, 640, 0.72);
    } catch {
      try {
        return await compressDataUrlToJpegDataUrl(raw, 480, 0.58);
      } catch {
        return raw.startsWith("data:image/jpeg") ? raw : "";
      }
    }
  } catch (e) {
    try {
      console.warn("[ADM themes] Galerie-Screenshot Ausnahme:", String(e?.message || e));
    } catch {}
    return "";
  } finally {
    undoChrome();
    if (dlg) dlg.style.display = dlgWas;
    if (BUILDER_ACTIVE && (savedKeys.length || savedSelector)) {
      BUILDER_SELECTED_KEYS = savedKeys.length ? savedKeys : savedSelector ? [savedSelector] : [];
      try {
        clearBuilderSelectionHitMarkers();
        for (const bk of BUILDER_SELECTED_KEYS) {
          const te = getTargetByKey(bk)?.el;
          if (te && document.contains(te)) te.dataset.admBuilderHit = "1";
        }
        syncBuilderPrimaryFromKeys();
      } catch {}
      try {
        refreshBuilderSelectionBox();
      } catch {}
    }
  }
}

function upsertCustomThemeList(list, nextTheme) {
  const out = Array.isArray(list) ? [...list] : [];
  const idx = out.findIndex((t) => String(t?.id || "") === String(nextTheme.id || ""));
  if (idx >= 0) out[idx] = nextTheme;
  else out.push(nextTheme);
  return out;
}

const BUILDER_SAVE_DIALOG_HTML = `
      <div class="row">
        <label class="lbl">Theme-Name</label>
        <input id="adSbThemeName" type="text" placeholder="z. B. Mein Layout" />
      </div>
      <div class="row hint" style="font-size:12px;opacity:.85;line-height:1.4;">
        Wird für das aktuell eingestellte Seitenlayout gespeichert (horizontal oder vertikal). Gespeicherte Themes findest du unter Themes → „Alle Themes durchsuchen“ (Vorschau, Favoriten, Export).
      </div>
      <div class="actions">
        <button id="adSbCancelSave" type="button">Abbrechen</button>
        <button id="adSbConfirmSave" class="primary" type="button">Speichern</button>
      </div>
    `;

function themePackEmbedForStorage(snapshot) {
  const bg = String(WEBSITE_THEME_STATE.backgroundImageDataMatch || "").trim();
  const bs = String(WEBSITE_THEME_STATE.backgroundSize || "cover").toLowerCase();
  return {
    builderData: snapshot,
    backgroundImageDataMatch: bg,
    backgroundSize: bs === "contain" || bs === "auto" ? bs : "cover",
    arenaPrimaryHue: WEBSITE_THEME_STATE.arenaPrimaryHue,
    arenaSecondaryHue: WEBSITE_THEME_STATE.arenaSecondaryHue,
    arenaTertiaryHue: WEBSITE_THEME_STATE.arenaTertiaryHue
  };
}

function showBuilderSaveDialog() {
  getOrCreateBuilderStyle();
  let dlg = document.getElementById(BUILDER_DIALOG_ID);
  if (!dlg) {
    dlg = document.createElement("div");
    dlg.id = BUILDER_DIALOG_ID;
    dlg.innerHTML = BUILDER_SAVE_DIALOG_HTML;
    mountBuilderFixedHost(dlg);
  } else if (!dlg.querySelector("#adSbThemeName")) {
    dlg.innerHTML = BUILDER_SAVE_DIALOG_HTML;
    mountBuilderFixedHost(dlg);
  }
  mountBuilderFixedHost(dlg);

  const nameInput = dlg.querySelector("#adSbThemeName");
  const cancel = dlg.querySelector("#adSbCancelSave");
  const confirm = dlg.querySelector("#adSbConfirmSave");
  if (!nameInput || !cancel || !confirm) return;

  nameInput.value = "";
  dlg.style.display = "block";
  setTimeout(() => { try { nameInput.focus(); } catch {} }, 10);

  const close = () => { dlg.style.display = "none"; };

  cancel.onclick = () => close();
  confirm.onclick = () => {
    const nameEl = dlg.querySelector("#adSbThemeName") || nameInput;
    const label = String(nameEl?.value ?? "").trim();
    if (!label) return;

    const layoutNorm = String(WEBSITE_THEME_STATE.layout || "horizontal").toLowerCase() === "vertical" ? "vertical" : "horizontal";
    const useH = layoutNorm === "horizontal";
    const useV = layoutNorm === "vertical";

    let snapshot;
    try {
      snapshot = JSON.parse(serializeBuilderDataRootForStorage());
    } catch {
      snapshot = normalizeBuilderStorageRoot({});
    }
    const embed = themePackEmbedForStorage(snapshot);

    (async () => {
      let galleryThumb = "";
      try {
        galleryThumb = await captureMatchPageGalleryThumbnailJpeg();
      } catch {
        galleryThumb = "";
      }

      const savedAt = Date.now();
      try {
        chrome.storage.local.get(["settings"], (items) => {
          void (async () => {
            try {
              const baseSettings = items?.settings || {};
              let persistedThemeId = "";

              const buildPatchedSettings = async (embedPack, includeGalleryThumb) => {
                const settings = { ...baseSettings };
                const hList = parseCustomThemes(settings.websiteCustomThemesHorizontal, "horizontal", settings.uiLanguage);
                const vList = parseCustomThemes(settings.websiteCustomThemesVertical, "vertical", settings.uiLanguage);

                const attachGalleryThumb = async (next, themeId) => {
                  if (!includeGalleryThumb || !galleryThumb || !themeId) return;
                  const ref = galleryThumbStorageRef(themeId);
                  if (!ref) return;
                  const put = await new Promise((resolve) => {
                    try {
                      chrome.runtime.sendMessage(
                        { type: "ADM_GALLERY_THUMB_PUT", ref, dataUrl: galleryThumb },
                        (reply) => {
                          void chrome.runtime.lastError;
                          resolve(reply && typeof reply === "object" ? reply : { ok: false });
                        }
                      );
                    } catch {
                      resolve({ ok: false });
                    }
                  });
                  if (put?.ok) {
                    next.galleryScreenshotRef = ref;
                    next.galleryScreenshot = "";
                  } else {
                    next.galleryScreenshot = galleryThumb;
                    next.galleryScreenshotRef = "";
                  }
                };

                if (useH) {
                  const id = makeUniqueBuilderThemeId(label, "h");
                  persistedThemeId = id;
                  const next = {
                    id,
                    label,
                    layout: "horizontal",
                    tags: normalizeThemeTagsWithLayout("horizontal", ["Builder"], settings.uiLanguage),
                    css: "",
                    savedAt,
                    ...embedPack
                  };
                  const shellCss = buildPlayAutodartsIoCssFromBuilderSnapshot(snapshot);
                  if (shellCss) {
                    const po = { css: shellCss };
                    next["play.autodarts.io"] = po;
                    next.playAutodartsIo = po;
                  }
                  await attachGalleryThumb(next, id);
                  settings.websiteCustomThemesHorizontal = JSON.stringify(upsertCustomThemeList(hList, next));
                  settings.websiteLayout = "horizontal";
                  settings.websiteTheme = id;
                }
                if (useV) {
                  const id = makeUniqueBuilderThemeId(label, "v");
                  persistedThemeId = id;
                  const next = {
                    id,
                    label,
                    layout: "vertical",
                    tags: normalizeThemeTagsWithLayout("vertical", ["Builder"], settings.uiLanguage),
                    css: "",
                    savedAt,
                    ...embedPack
                  };
                  const shellCss = buildPlayAutodartsIoCssFromBuilderSnapshot(snapshot);
                  if (shellCss) {
                    const po = { css: shellCss };
                    next["play.autodarts.io"] = po;
                    next.playAutodartsIo = po;
                  }
                  await attachGalleryThumb(next, id);
                  settings.websiteCustomThemesVertical = JSON.stringify(upsertCustomThemeList(vList, next));
                  if (!useH) {
                    settings.websiteLayout = "vertical";
                    settings.websiteTheme = id;
                  }
                }

                settings.websiteThemeBuilderData = serializeBuilderDataRootForStorage();
                return settings;
              };

              const onSavedOk = () => {
                const saveBtn = document.getElementById(BUILDER_SAVE_BUTTON_ID);
                if (saveBtn) {
                  saveBtn.textContent = "Gespeichert";
                  setTimeout(() => {
                    saveBtn.textContent = "Theme speichern";
                  }, 1200);
                }
                close();
                BUILDER_SESSION_ACTIVE = false;
                setBuilderActive(false);
              };

              const tryPersist = (settingsObj, onFail) => {
                chrome.storage.local.set({ settings: settingsObj }, () => {
                  const err = chrome.runtime?.lastError;
                  if (err) {
                    onFail?.(err);
                    return;
                  }
                  onSavedOk();
                });
              };

              const fullSettings = await buildPatchedSettings(embed, true);
              tryPersist(fullSettings, () => {
                void (async () => {
                  const leanEmbed = { ...embed, backgroundImageDataMatch: "" };
                  try {
                    const leanSettings = await buildPatchedSettings(leanEmbed, true);
                    tryPersist(leanSettings, () => {
                      void (async () => {
                        try {
                          const leanNoShot = await buildPatchedSettings(leanEmbed, false);
                          tryPersist(leanNoShot, (err3) => {
                            window.alert(
                              `Theme konnte nicht gespeichert werden: ${String(err3?.message || err3 || "unknown error")}`
                            );
                          });
                        } catch {
                          close();
                        }
                      })();
                    });
                  } catch {
                    close();
                  }
                })();
              });
            } catch {
              close();
            }
          })();
        });
      } catch {
        close();
      }
    })();
  };
}

function setBuilderActive(active) {
  BUILDER_ACTIVE = !!active;
  if (BUILDER_ACTIVE) document.documentElement.setAttribute("data-adm-builder-freeze", "1");
  else document.documentElement.removeAttribute("data-adm-builder-freeze");
  if (!BUILDER_ACTIVE) {
    restoreBuilderReleasedDisabledState();
    const resetBtn = document.getElementById(BUILDER_RESET_BUTTON_ID);
    if (resetBtn) resetBtn.remove();
    const btn = document.getElementById(BUILDER_SAVE_BUTTON_ID);
    if (btn) btn.remove();
    const box = document.getElementById(BUILDER_BOX_ID);
    if (box) box.remove();
    const fullRing = document.getElementById(BUILDER_FULL_OUTLINE_ID);
    if (fullRing) fullRing.remove();
    const dlg = document.getElementById(BUILDER_DIALOG_ID);
    if (dlg) dlg.remove();
    const pinBtn = document.getElementById(BUILDER_PIN_BUTTON_ID);
    if (pinBtn) pinBtn.remove();
    const pinPanel = document.getElementById(BUILDER_PIN_PANEL_ID);
    if (pinPanel) pinPanel.remove();
    const gridOv = document.getElementById(BUILDER_GRID_OVERLAY_ID);
    if (gridOv) gridOv.remove();
    const gridBtn = document.getElementById(BUILDER_GRID_TOGGLE_ID);
    if (gridBtn) gridBtn.remove();
    detachBuilderBgPopoverDocClose();
    BUILDER_BG_POPOVER_OPEN = false;
    try {
      document.getElementById(BUILDER_BG_TRIGGER_ID)?.remove();
      document.getElementById(BUILDER_BG_POPOVER_ID)?.remove();
    } catch {}
    try {
      document.getElementById("adm-theme-builder-background")?.remove();
    } catch {}
    if (BUILDER_BG_SAVE_TIMER) {
      try {
        clearTimeout(BUILDER_BG_SAVE_TIMER);
      } catch {}
      BUILDER_BG_SAVE_TIMER = null;
    }
    try {
      document.getElementById("adm-theme-builder-snap-toggle")?.remove();
      document.getElementById("adm-theme-builder-align-all")?.remove();
    } catch {}
    const auxSt = document.getElementById(BUILDER_AUX_GRID_STYLE_ID);
    if (auxSt) auxSt.remove();
    BUILDER_GRID_VISIBLE = false;
    const hintEl = document.getElementById(BUILDER_HINT_ID);
    if (hintEl) hintEl.remove();
    document.querySelectorAll("[data-ad-sb-builder-hit='1']").forEach((el) => {
      try {
        el.removeAttribute("data-ad-sb-builder-hit");
      } catch {}
    });
    document.querySelectorAll("[data-adm-builder-hit='1']").forEach((el) => {
      try {
        el.removeAttribute("data-adm-builder-hit");
      } catch {}
    });
    BUILDER_SELECTED = null;
    BUILDER_SELECTED_SELECTOR = "";
    BUILDER_SELECTED_KEYS = [];
    BUILDER_MARQUEE_DRAG = null;
    BUILDER_DRAG = null;
    BUILDER_RESIZE = null;
    BUILDER_ROTATE_DRAG = null;
    BUILDER_CROP_DRAG = null;
    BUILDER_PERSP_EDGE_DRAG = null;
    if (BUILDER_WHEEL_COMMIT_TIMER) {
      try {
        clearTimeout(BUILDER_WHEEL_COMMIT_TIMER);
      } catch {}
      BUILDER_WHEEL_COMMIT_TIMER = 0;
    }
    BUILDER_HISTORY = [];
    BUILDER_HISTORY_INDEX = -1;
    BUILDER_PIN_OPEN = false;
    try {
      document.getElementById(BUILDER_MARQUEE_ID)?.remove();
    } catch {}
    return;
  }

  getOrCreateBuilderStyle();
  try {
    document.getElementById("adm-theme-builder-background")?.remove();
  } catch {}
  if (!document.getElementById(BUILDER_RESET_BUTTON_ID)) {
    const resetBtn = document.createElement("button");
    resetBtn.id = BUILDER_RESET_BUTTON_ID;
    resetBtn.type = "button";
    resetBtn.textContent = "Alles zurücksetzen";
    resetBtn.addEventListener("click", () => resetBuilderToDefaults());
    mountBuilderFixedHost(resetBtn);
  } else {
    mountBuilderFixedHost(document.getElementById(BUILDER_RESET_BUTTON_ID));
  }
  if (!document.getElementById(BUILDER_SAVE_BUTTON_ID)) {
    const btn = document.createElement("button");
    btn.id = BUILDER_SAVE_BUTTON_ID;
    btn.type = "button";
    btn.textContent = "Theme speichern";
    btn.addEventListener("click", () => showBuilderSaveDialog());
    mountBuilderFixedHost(btn);
  } else {
    mountBuilderFixedHost(document.getElementById(BUILDER_SAVE_BUTTON_ID));
  }
  let hint = document.getElementById(BUILDER_HINT_ID);
  if (!hint) {
    hint = document.createElement("div");
    hint.id = BUILDER_HINT_ID;
    mountBuilderFixedHost(hint);
  } else {
    mountBuilderFixedHost(hint);
  }
  const sub = document.createElement("div");
  sub.className = BUILDER_HINT_SUB_CLASS;
  sub.textContent = BUILDER_HINT_SUB;
  hint.replaceChildren(document.createTextNode(`${BUILDER_HINT_MAIN}\n`), sub);
  if (!document.getElementById(BUILDER_PIN_BUTTON_ID)) {
    const pinBtn = document.createElement("button");
    pinBtn.id = BUILDER_PIN_BUTTON_ID;
    pinBtn.type = "button";
    pinBtn.title = "Elemente an Ort und Größe festhalten";
    pinBtn.addEventListener("click", () => {
      if (!pathnameIndicatesWebsiteThemesPlayfield()) return;
      BUILDER_PIN_OPEN = !BUILDER_PIN_OPEN;
      ensureBuilderPinPanel();
      updateBuilderPinVisibility();
    });
    mountBuilderFixedHost(pinBtn);
  } else {
    mountBuilderFixedHost(document.getElementById(BUILDER_PIN_BUTTON_ID));
  }
  ensureBuilderBackgroundTriggerAndPopover();
  ensureBuilderOverlay();
  ensureBuilderPinPanel();
  ensureBuilderGridAndSnapUi();
  updateBuilderPinVisibility();
  commitBuilderHistorySnapshot();
  refreshBuilderSelectionBox();
}

function selectBuilderElement(el, opts) {
  if (!pathnameIndicatesWebsiteThemesPlayfield()) return;
  if (!isBuilderElement(el)) return;
  if (el.closest("[data-adm-builder-edge]")) return;
  if (
    el.id === BUILDER_SAVE_BUTTON_ID ||
    el.id === BUILDER_RESET_BUTTON_ID ||
    el.id === BUILDER_PIN_BUTTON_ID ||
    el.id === BUILDER_GRID_TOGGLE_ID ||
    el.id === BUILDER_COLORS_PANEL_ID ||
    el.id === BUILDER_BG_TRIGGER_ID ||
    el.id === BUILDER_BG_POPOVER_ID ||
    el.id === BUILDER_BOX_ID ||
    el.id === BUILDER_HANDLE_ID ||
    el.id === BUILDER_ROTATE_HANDLE_ID
  ) {
    return;
  }
  if (
    el.closest(`#${BUILDER_SAVE_BUTTON_ID}`) ||
    el.closest(`#${BUILDER_RESET_BUTTON_ID}`) ||
    el.closest(`#${BUILDER_PIN_BUTTON_ID}`) ||
    el.closest(`#${BUILDER_GRID_TOGGLE_ID}`) ||
    el.closest(`#${BUILDER_COLORS_PANEL_ID}`) ||
    el.closest(`#${BUILDER_BG_TRIGGER_ID}`) ||
    el.closest(`#${BUILDER_BG_POPOVER_ID}`) ||
    el.closest(`#${BUILDER_PIN_PANEL_ID}`) ||
    el.closest(`#${BUILDER_BOX_ID}`) ||
    el.closest(`#${MENU_TOGGLE_BUTTON_ID}`)
  ) {
    return;
  }
  refreshBuilderTargets();
  const hit = getBuilderTargetFromNode(el);
  if (!hit?.el) return;
  applyBuilderTargetSelection(hit, { additive: !!(opts && opts.additive) });
}

/** Legacy px-Offsets → Viewport-Verankerung (einmalig vor Drag/Resize), damit Folge-Speichern stabil bleibt. */
function migrateBuilderEntryToViewportAnchorsIfNeeded(entry, el) {
  if (!entry || !el || !isBuilderElement(el) || !document.contains(el)) return;
  if (Number(entry.posUv) === 1 && Number.isFinite(Number(entry.vx)) && Number.isFinite(Number(entry.vy))) return;
  const iw = Math.max(1, window.innerWidth || 1);
  const ih = Math.max(1, window.innerHeight || 1);
  const r = el.getBoundingClientRect();
  entry.vx = r.left / iw;
  entry.vy = r.top / ih;
  entry.vw = r.width / iw;
  entry.vh = r.height / ih;
  entry.posUv = 1;
}

function onBuilderMouseDown(ev) {
  if (!BUILDER_ACTIVE) return;
  const target = ev.target;
  if (!isBuilderElement(target)) return;
  if (
    target.id === BUILDER_SAVE_BUTTON_ID ||
    target.id === BUILDER_RESET_BUTTON_ID ||
    target.id === BUILDER_PIN_BUTTON_ID ||
    target.id === BUILDER_GRID_TOGGLE_ID ||
    target.id === BUILDER_COLORS_PANEL_ID ||
    target.id === BUILDER_BG_TRIGGER_ID ||
    target.id === BUILDER_BG_POPOVER_ID ||
    target.closest(`#${BUILDER_SAVE_BUTTON_ID}`) ||
    target.closest(`#${BUILDER_RESET_BUTTON_ID}`) ||
    target.closest(`#${BUILDER_PIN_BUTTON_ID}`) ||
    target.closest(`#${BUILDER_GRID_TOGGLE_ID}`) ||
    target.closest(`#${BUILDER_COLORS_PANEL_ID}`) ||
    target.closest(`#${BUILDER_BG_TRIGGER_ID}`) ||
    target.closest(`#${BUILDER_BG_POPOVER_ID}`) ||
    target.closest(`#${BUILDER_PIN_PANEL_ID}`) ||
    target.closest(`#${MENU_TOGGLE_BUTTON_ID}`) ||
    target.closest(`#${BUILDER_DIALOG_ID}`)
  ) {
    return;
  }
  if (!pathnameIndicatesWebsiteThemesPlayfield()) return;

  const handle = target.id === BUILDER_HANDLE_ID ? target : target.closest(`#${BUILDER_HANDLE_ID}`);
  if (handle && BUILDER_SELECTED && BUILDER_SELECTED_KEYS.length <= 1) {
    if (isBuilderTargetLocked(BUILDER_SELECTED_SELECTOR)) {
      blockBuilderEvent(ev);
      return;
    }
    const selector = BUILDER_SELECTED_SELECTOR;
    const entry = getBuilderEntry(selector);
    if (BUILDER_SELECTED && document.contains(BUILDER_SELECTED)) {
      migrateBuilderEntryToViewportAnchorsIfNeeded(entry, BUILDER_SELECTED);
    }
    const rect = BUILDER_SELECTED.getBoundingClientRect();
    const startSX = Number(entry.sx || 1);
    const startSY = Number(entry.sy || 1);
    BUILDER_RESIZE = {
      selector,
      startX: ev.clientX,
      startY: ev.clientY,
      startW: Math.max(10, rect.width),
      startH: Math.max(10, rect.height),
      startSX: Number.isFinite(startSX) ? startSX : 1,
      startSY: Number.isFinite(startSY) ? startSY : 1,
      useUv: Number(entry.posUv) === 1,
      iw: Math.max(1, window.innerWidth || 1),
      ih: Math.max(1, window.innerHeight || 1),
      startVw: Number(entry.vw || 0),
      startVh: Number(entry.vh || 0)
    };
    blockBuilderEvent(ev);
    return;
  }

  const rotHandle = target.id === BUILDER_ROTATE_HANDLE_ID ? target : target.closest(`#${BUILDER_ROTATE_HANDLE_ID}`);
  if (rotHandle && BUILDER_SELECTED && BUILDER_SELECTED_KEYS.length <= 1) {
    if (isBuilderTargetLocked(BUILDER_SELECTED_SELECTOR)) {
      blockBuilderEvent(ev);
      return;
    }
    const selector = BUILDER_SELECTED_SELECTOR;
    const rect = BUILDER_SELECTED.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const prevAng = Math.atan2(ev.clientY - cy, ev.clientX - cx);
    BUILDER_ROTATE_DRAG = {
      selector,
      prevAng
    };
    blockBuilderEvent(ev);
    return;
  }

  const edgeHit = target.closest("[data-adm-builder-edge]");
  if (edgeHit && BUILDER_SELECTED && BUILDER_SELECTED_SELECTOR && BUILDER_SELECTED_KEYS.length <= 1) {
    if (isBuilderTargetLocked(BUILDER_SELECTED_SELECTOR)) {
      blockBuilderEvent(ev);
      return;
    }
    const edge = String(edgeHit.getAttribute("data-adm-builder-edge") || "").toLowerCase();
    if (!/^[trbl]$/.test(edge)) return;
    const rect = BUILDER_SELECTED.getBoundingClientRect();
    const rectW = Math.max(20, rect.width);
    const rectH = Math.max(20, rect.height);
    const entry0 = getBuilderEntry(BUILDER_SELECTED_SELECTOR);
    if (ev.ctrlKey && !ev.altKey) {
      BUILDER_CROP_DRAG = {
        selector: BUILDER_SELECTED_SELECTOR,
        edge,
        startX: ev.clientX,
        startY: ev.clientY,
        startCropT: Number(entry0.cropT || 0),
        startCropR: Number(entry0.cropR || 0),
        startCropB: Number(entry0.cropB || 0),
        startCropL: Number(entry0.cropL || 0),
        rectW,
        rectH
      };
      BUILDER_PERSP_EDGE_DRAG = null;
      blockBuilderEvent(ev);
      refreshBuilderSelectionBox();
      return;
    }
    if (ev.altKey && !ev.ctrlKey && !ev.metaKey) {
      BUILDER_PERSP_EDGE_DRAG = {
        selector: BUILDER_SELECTED_SELECTOR,
        edge,
        startX: ev.clientX,
        startY: ev.clientY,
        startRx: Number(entry0.rx || 0),
        startRy: Number(entry0.ry || 0)
      };
      BUILDER_CROP_DRAG = null;
      blockBuilderEvent(ev);
      refreshBuilderSelectionBox();
      return;
    }
    blockBuilderEvent(ev);
    return;
  }

  // Fallback für bereits ausgewähltes Element:
  // Wenn der Klick innerhalb der sichtbaren Selection-Box liegt, immer Drag starten.
  // So bleibt Positions-Änderung möglich, auch wenn der DOM-Hit-Test nach 3D danebenliegt.
  if (BUILDER_SELECTED && BUILDER_SELECTED_KEYS.length && !isBuilderUiTarget(target)) {
    const box = document.getElementById(BUILDER_BOX_ID);
    const left = Number.parseFloat(String(box?.style?.left || ""));
    const top = Number.parseFloat(String(box?.style?.top || ""));
    const width = Number.parseFloat(String(box?.style?.width || ""));
    const height = Number.parseFloat(String(box?.style?.height || ""));
    if (
      Number.isFinite(left) &&
      Number.isFinite(top) &&
      Number.isFinite(width) &&
      Number.isFinite(height) &&
      ev.clientX >= left &&
      ev.clientX <= left + width &&
      ev.clientY >= top &&
      ev.clientY <= top + height
    ) {
      if (!BUILDER_SELECTED_KEYS.some((k) => isBuilderTargetLocked(k))) {
        if (beginBuilderDragFromPointerEvent(ev)) {
          blockBuilderEvent(ev);
          return;
        }
      }
      blockBuilderEvent(ev);
      return;
    }
  }

  refreshBuilderTargets();
  let hitPick = pickBestBuilderTargetAtPoint(ev.clientX, ev.clientY);
  if (!hitPick) {
    const chosen = normalizeBuilderPickElement(target.closest("*"));
    if (chosen) hitPick = getBuilderTargetFromNode(chosen);
  }
  if (!hitPick?.el) {
    if (ev.button !== 0) return;
    if (isBuilderChromeNode(target)) {
      if (!isBuilderUiTarget(target)) blockBuilderEvent(ev);
      return;
    }
    BUILDER_MARQUEE_DRAG = {
      sx: ev.clientX,
      sy: ev.clientY,
      curX: ev.clientX,
      curY: ev.clientY,
      additive: !!ev.shiftKey
    };
    updateBuilderMarqueeFromDrag();
    blockBuilderEvent(ev);
    return;
  }
  applyBuilderTargetSelection(hitPick, { additive: !!ev.shiftKey });
  if (!BUILDER_SELECTED || !BUILDER_SELECTED_SELECTOR) {
    if (!isBuilderUiTarget(target)) blockBuilderEvent(ev);
    return;
  }
  if (BUILDER_SELECTED_KEYS.some((k) => isBuilderTargetLocked(k))) {
    blockBuilderEvent(ev);
    return;
  }
  beginBuilderDragFromPointerEvent(ev);
  blockBuilderEvent(ev);
}

function onBuilderClickBlock(ev) {
  if (!BUILDER_ACTIVE) return;
  if (!pathnameIndicatesWebsiteThemesPlayfield()) return;
  const target = ev.target;
  if (!isBuilderElement(target)) return;
  if (isBuilderUiTarget(target)) return;
  blockBuilderEvent(ev);
}

function onBuilderMouseMove(ev) {
  if (!BUILDER_ACTIVE) return;
  if (!pathnameIndicatesWebsiteThemesPlayfield()) {
    if (BUILDER_MARQUEE_DRAG) {
      BUILDER_MARQUEE_DRAG = null;
      hideBuilderMarqueeOverlay();
    }
    if (BUILDER_CROP_DRAG || BUILDER_PERSP_EDGE_DRAG || BUILDER_DRAG || BUILDER_RESIZE || BUILDER_ROTATE_DRAG) {
      BUILDER_CROP_DRAG = null;
      BUILDER_PERSP_EDGE_DRAG = null;
      BUILDER_DRAG = null;
      BUILDER_RESIZE = null;
      BUILDER_ROTATE_DRAG = null;
      refreshBuilderSelectionBox();
    }
    return;
  }
  if (BUILDER_MARQUEE_DRAG) {
    BUILDER_MARQUEE_DRAG.curX = ev.clientX;
    BUILDER_MARQUEE_DRAG.curY = ev.clientY;
    updateBuilderMarqueeFromDrag();
    return;
  }
  if (BUILDER_CROP_DRAG) {
    if (isBuilderTargetLocked(BUILDER_CROP_DRAG.selector)) {
      BUILDER_CROP_DRAG = null;
      refreshBuilderSelectionBox();
      return;
    }
    const entry = getBuilderEntry(BUILDER_CROP_DRAG.selector);
    const e = BUILDER_CROP_DRAG;
    const w = e.rectW;
    const h = e.rectH;
    const dx = ev.clientX - e.startX;
    const dy = ev.clientY - e.startY;
    if (e.edge === "t") entry.cropT = clampBuilderCropPct(e.startCropT + (dy / h) * 100);
    if (e.edge === "b") entry.cropB = clampBuilderCropPct(e.startCropB + (-dy / h) * 100);
    if (e.edge === "l") entry.cropL = clampBuilderCropPct(e.startCropL + (dx / w) * 100);
    if (e.edge === "r") entry.cropR = clampBuilderCropPct(e.startCropR + (-dx / w) * 100);
    if (BUILDER_SELECTED && BUILDER_SELECTED_SELECTOR === e.selector) {
      const applyEl = getBuilderLiveTransformElement(e.selector);
      if (applyEl) applyBuilderEntryToElement(applyEl, entry);
    }
    refreshBuilderSelectionBox();
    return;
  }
  if (BUILDER_PERSP_EDGE_DRAG) {
    if (isBuilderTargetLocked(BUILDER_PERSP_EDGE_DRAG.selector)) {
      BUILDER_PERSP_EDGE_DRAG = null;
      refreshBuilderSelectionBox();
      return;
    }
    const entry = getBuilderEntry(BUILDER_PERSP_EDGE_DRAG.selector);
    const e = BUILDER_PERSP_EDGE_DRAG;
    const dx = ev.clientX - e.startX;
    const dy = ev.clientY - e.startY;
    const sens = ev.shiftKey ? 0.18 : 0.1;
    let rx = e.startRx;
    let ry = e.startRy;
    if (e.edge === "t") rx = e.startRx + dy * sens;
    if (e.edge === "b") rx = e.startRx - dy * sens;
    if (e.edge === "l") ry = e.startRy - dx * sens;
    if (e.edge === "r") ry = e.startRy + dx * sens;
    entry.rx = Math.max(-BUILDER_MAX_TILT_DEG, Math.min(BUILDER_MAX_TILT_DEG, rx));
    entry.ry = Math.max(-BUILDER_MAX_TILT_DEG, Math.min(BUILDER_MAX_TILT_DEG, ry));
    if (BUILDER_SELECTED && BUILDER_SELECTED_SELECTOR === e.selector) {
      const applyEl = getBuilderLiveTransformElement(e.selector);
      if (applyEl) applyBuilderEntryToElement(applyEl, entry);
    }
    refreshBuilderSelectionBox();
    return;
  }
  if (BUILDER_DRAG) {
    const keys = BUILDER_DRAG.keys || [];
    if (!keys.length) {
      BUILDER_DRAG = null;
      return;
    }
    const dx = ev.clientX - BUILDER_DRAG.startX;
    const dy = ev.clientY - BUILDER_DRAG.startY;
    const iw = BUILDER_DRAG.iw || Math.max(1, window.innerWidth || 1);
    const ih = BUILDER_DRAG.ih || Math.max(1, window.innerHeight || 1);
    for (const k of keys) {
      if (isBuilderTargetLocked(k)) continue;
      const entry = getBuilderEntry(k);
      const st = BUILDER_DRAG.starts && BUILDER_DRAG.starts[k];
      if (!st) continue;
      if (st.useUv) {
        let nvx = st.startVXv + dx / iw;
        let nvy = st.startVYv + dy / ih;
        nvx = snapBuilderCoordIfEnabled(nvx * iw) / iw;
        nvy = snapBuilderCoordIfEnabled(nvy * ih) / ih;
        entry.vx = nvx;
        entry.vy = nvy;
      } else {
        let nx = st.startLeft + dx;
        let ny = st.startTop + dy;
        nx = snapBuilderCoordIfEnabled(nx);
        ny = snapBuilderCoordIfEnabled(ny);
        entry.x = nx;
        entry.y = ny;
      }
      const applyEl = getBuilderLiveTransformElement(k);
      if (applyEl) applyBuilderEntryToElement(applyEl, entry);
    }
    refreshBuilderSelectionBox();
    return;
  }
  if (BUILDER_RESIZE) {
    if (isBuilderTargetLocked(BUILDER_RESIZE.selector)) {
      BUILDER_RESIZE = null;
      return;
    }
    const entry = getBuilderEntry(BUILDER_RESIZE.selector);
    const min = getMinSizeForTarget(BUILDER_RESIZE.selector);
    const sw = Math.max(10, BUILDER_RESIZE.startW);
    const sh = Math.max(10, BUILDER_RESIZE.startH);
    let nextW = Math.max(min.w, BUILDER_RESIZE.startW + (ev.clientX - BUILDER_RESIZE.startX));
    let nextH = Math.max(min.h, BUILDER_RESIZE.startH + (ev.clientY - BUILDER_RESIZE.startY));
    const rw = nextW / sw;
    const rh = nextH / sh;
    const f = Math.max(rw, rh);
    nextW = Math.max(min.w, sw * f);
    nextH = Math.max(min.h, sh * f);
    const startU = Math.sqrt(Math.max(1e-8, BUILDER_RESIZE.startSX * BUILDER_RESIZE.startSY));
    const u = Math.max(0.25, Math.min(4.0, startU * f));
    entry.sx = u;
    entry.sy = u;
    entry.w = nextW;
    entry.h = nextH;
    if (BUILDER_RESIZE.useUv) {
      const iw = BUILDER_RESIZE.iw || Math.max(1, window.innerWidth || 1);
      const ih = BUILDER_RESIZE.ih || Math.max(1, window.innerHeight || 1);
      entry.vw = Math.max(0.0008, nextW / iw);
      entry.vh = Math.max(0.0008, nextH / ih);
    }
    if (BUILDER_SELECTED) {
      const applyEl = getBuilderLiveTransformElement(BUILDER_RESIZE.selector);
      if (applyEl) applyBuilderEntryToElement(applyEl, entry);
    }
    refreshBuilderSelectionBox();
    return;
  }
  if (BUILDER_ROTATE_DRAG && BUILDER_SELECTED) {
    if (isBuilderTargetLocked(BUILDER_ROTATE_DRAG.selector)) {
      BUILDER_ROTATE_DRAG = null;
      return;
    }
    const entry = getBuilderEntry(BUILDER_ROTATE_DRAG.selector);
    const rect = BUILDER_SELECTED.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const ang = Math.atan2(ev.clientY - cy, ev.clientX - cx);
    let d = ang - BUILDER_ROTATE_DRAG.prevAng;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    BUILDER_ROTATE_DRAG.prevAng = ang;
    const nextRot = (Number(entry.rot || 0) || 0) + (d * 180) / Math.PI;
    entry.rot = nextRot;
    if (BUILDER_SELECTED) {
      const applyEl = getBuilderLiveTransformElement(BUILDER_ROTATE_DRAG.selector);
      if (applyEl) applyBuilderEntryToElement(applyEl, entry);
    }
    refreshBuilderSelectionBox();
  }
}

function onBuilderMouseUp(ev) {
  if (!BUILDER_ACTIVE) return;
  const hadPerspDrag = !!BUILDER_PERSP_EDGE_DRAG;
  const perspSelector = hadPerspDrag ? String(BUILDER_PERSP_EDGE_DRAG.selector || "") : "";
  if (!pathnameIndicatesWebsiteThemesPlayfield()) {
    flushBuilderWheelCommitPending();
    if (BUILDER_MARQUEE_DRAG) {
      BUILDER_MARQUEE_DRAG = null;
      hideBuilderMarqueeOverlay();
    }
    if (BUILDER_DRAG || BUILDER_RESIZE || BUILDER_ROTATE_DRAG || BUILDER_CROP_DRAG || BUILDER_PERSP_EDGE_DRAG) {
      BUILDER_DRAG = null;
      BUILDER_RESIZE = null;
      BUILDER_ROTATE_DRAG = null;
      BUILDER_CROP_DRAG = null;
      BUILDER_PERSP_EDGE_DRAG = null;
      commitBuilderHistorySnapshot();
      refreshBuilderSelectionBox();
    }
    return;
  }
  if (BUILDER_MARQUEE_DRAG) {
    const m = BUILDER_MARQUEE_DRAG;
    BUILDER_MARQUEE_DRAG = null;
    hideBuilderMarqueeOverlay();
    const picked = collectBuilderTargetsIntersectingMarquee(m.sx, m.sy, m.curX, m.curY);
    const mw = Math.abs(m.curX - m.sx);
    const mh = Math.abs(m.curY - m.sy);
    if (picked.length) {
      setBuilderSelectionFromKeyList(picked, !!m.additive);
    } else if (mw < 5 && mh < 5 && !m.additive) {
      clearBuilderSelectionHitMarkers();
      BUILDER_SELECTED_KEYS = [];
      syncBuilderPrimaryFromKeys();
      try {
        applyBuilderDataToDom();
      } catch {}
      refreshBuilderSelectionBox();
    }
    try {
      blockBuilderEvent(ev);
    } catch {}
    return;
  }
  flushBuilderWheelCommitPending();
  if (BUILDER_DRAG || BUILDER_RESIZE || BUILDER_ROTATE_DRAG || BUILDER_CROP_DRAG || BUILDER_PERSP_EDGE_DRAG) {
    BUILDER_DRAG = null;
    BUILDER_RESIZE = null;
    BUILDER_ROTATE_DRAG = null;
    BUILDER_CROP_DRAG = null;
    BUILDER_PERSP_EDGE_DRAG = null;
    commitBuilderHistorySnapshot();
    applyBuilderDataToDom();
    if (hadPerspDrag && perspSelector) {
      rebindBuilderTargetKey(perspSelector);
    }
    refreshBuilderSelectionBox();
  }
  const target = ev?.target;
  if (isBuilderElement(target) && !isBuilderUiTarget(target)) blockBuilderEvent(ev);
}

function onBuilderWheel(ev) {
  if (!BUILDER_ACTIVE) return;
  if (!pathnameIndicatesWebsiteThemesPlayfield()) return;
  if (!ev.ctrlKey || ev.altKey) return;
  if (!BUILDER_SELECTED || !BUILDER_SELECTED_SELECTOR) return;
  if (isBuilderTargetLocked(BUILDER_SELECTED_SELECTOR)) return;
  const t = ev.target;
  if (!isBuilderElement(t) || isBuilderUiTarget(t)) return;
  blockBuilderEvent(ev);
  const entry = getBuilderEntry(BUILDER_SELECTED_SELECTOR);
  const startSX = Number(entry.sx || 1);
  const startSY = Number(entry.sy || 1);
  const startU = Math.sqrt(Math.max(1e-8, (Number.isFinite(startSX) ? startSX : 1) * (Number.isFinite(startSY) ? startSY : 1)));
  const dir = ev.deltaY < 0 ? 1 : -1;
  const step = ev.shiftKey ? 0.14 : 0.08;
  const nu = Math.max(0.25, Math.min(4.0, startU * (1 + dir * step)));
  entry.sx = nu;
  entry.sy = nu;
  {
    const applyEl = getBuilderLiveTransformElement(BUILDER_SELECTED_SELECTOR);
    if (applyEl) applyBuilderEntryToElement(applyEl, entry);
  }
  if (BUILDER_WHEEL_COMMIT_TIMER) {
    try {
      clearTimeout(BUILDER_WHEEL_COMMIT_TIMER);
    } catch {}
  }
  BUILDER_WHEEL_COMMIT_TIMER = /** @type {any} */ (setTimeout(() => {
    BUILDER_WHEEL_COMMIT_TIMER = 0;
    commitBuilderHistorySnapshot();
  }, 320));
  refreshBuilderSelectionBox();
}

function onBuilderKeyDown(ev) {
  if (!BUILDER_ACTIVE) return;
  const key = String(ev.key || "").toLowerCase();
  if (key === "escape") {
    restoreBuilderFromSessionSnapshot(BUILDER_SESSION_SNAPSHOT);
    applyBuilderDataToDom();
    BUILDER_SESSION_ACTIVE = false;
    setBuilderActive(false);
    ev.preventDefault();
    return;
  }
  if ((ev.ctrlKey || ev.metaKey) && key === "z") {
    undoBuilderStep();
    ev.preventDefault();
    return;
  }
  if (!pathnameIndicatesWebsiteThemesPlayfield()) return;
  if (!BUILDER_SELECTED || !BUILDER_SELECTED_SELECTOR) return;

  const entry = getBuilderEntry(BUILDER_SELECTED_SELECTOR);
  if (isBuilderTargetLocked(BUILDER_SELECTED_SELECTOR)) return;

  const stepTilt = ev.shiftKey ? 4 : 2;

  if (ev.altKey && !ev.ctrlKey && !ev.metaKey) {
    if (ev.key === "ArrowUp" || ev.key === "ArrowDown" || ev.key === "ArrowLeft" || ev.key === "ArrowRight") {
      if (ev.key === "ArrowUp") entry.rx = Math.max(-42, Number(entry.rx || 0) - stepTilt);
      if (ev.key === "ArrowDown") entry.rx = Math.min(42, Number(entry.rx || 0) + stepTilt);
      if (ev.key === "ArrowLeft") entry.ry = Math.max(-42, Number(entry.ry || 0) - stepTilt);
      if (ev.key === "ArrowRight") entry.ry = Math.min(42, Number(entry.ry || 0) + stepTilt);
      {
        const applyEl = getBuilderLiveTransformElement(BUILDER_SELECTED_SELECTOR);
        if (applyEl) applyBuilderEntryToElement(applyEl, entry);
      }
      commitBuilderHistorySnapshot();
      refreshBuilderSelectionBox();
      ev.preventDefault();
      return;
    }
    if (ev.key === "PageUp" || ev.key === "PageDown") {
      let p = Number(entry.persp || 0);
      if (p <= 0) p = 1000;
      const deltaP = ev.key === "PageUp" ? 140 : -140;
      entry.persp = Math.round(Math.max(220, Math.min(2800, p + deltaP)));
      {
        const applyEl = getBuilderLiveTransformElement(BUILDER_SELECTED_SELECTOR);
        if (applyEl) applyBuilderEntryToElement(applyEl, entry);
      }
      commitBuilderHistorySnapshot();
      refreshBuilderSelectionBox();
      ev.preventDefault();
      return;
    }
  }

  if (ev.key !== "[" && ev.key !== "]") return;
  if (ev.altKey) return;
  const delta = ev.key === "]" ? 2 : -2;
  entry.r = Math.max(0, Number(entry.r || 0) + delta);
  {
    const applyEl = getBuilderLiveTransformElement(BUILDER_SELECTED_SELECTOR);
    if (applyEl) applyBuilderEntryToElement(applyEl, entry);
  }
  commitBuilderHistorySnapshot();
  refreshBuilderSelectionBox();
  ev.preventDefault();
}

function sendWebsiteThemeCss(css, attempt = 0) {
  const next = String(css || "");
  const now = Date.now();
  if (
    attempt === 0 &&
    next === LAST_SENT_WEBSITE_THEME_CSS &&
    now - LAST_SENT_WEBSITE_THEME_AT < 180
  ) {
    return;
  }
  try {
    if (!chrome?.runtime?.sendMessage) {
      if (attempt >= 8) return;
      const delay = 160 + (attempt * 140);
      setTimeout(() => sendWebsiteThemeCss(css, attempt + 1), delay);
      return;
    }
    chrome.runtime.sendMessage(
      { type: "APPLY_WEBSITE_THEME_CSS", css },
      (res) => {
        void chrome.runtime?.lastError;
        const ok = !!res?.ok;
        if (ok) {
          LAST_SENT_WEBSITE_THEME_CSS = next;
          LAST_SENT_WEBSITE_THEME_AT = Date.now();
          return;
        }
        if (attempt >= 8) return;
        const delay = 160 + (attempt * 140);
        setTimeout(() => sendWebsiteThemeCss(css, attempt + 1), delay);
      }
    );
  } catch {
    if (attempt >= 8) return;
    const delay = 160 + (attempt * 140);
    setTimeout(() => sendWebsiteThemeCss(css, attempt + 1), delay);
  }
}

function getOrCreateLocalStyle() {
  let style = document.getElementById(WEBSITE_THEME_STYLE_ID);
  if (style) return style;
  style = document.createElement("style");
  style.id = WEBSITE_THEME_STYLE_ID;
  style.setAttribute("data-adm-webdesign-inject", "1");
  const head = document.head || document.documentElement || document.body;
  head.appendChild(style);
  return style;
}

function applyWebsiteThemeLocal(css) {
  if (!css) {
    const existing = document.getElementById(WEBSITE_THEME_STYLE_ID);
    if (existing) existing.remove();
    return;
  }
  const style = getOrCreateLocalStyle();
  style.textContent = css;
  try {
    const head = document.head || document.documentElement;
    if (head) head.appendChild(style);
  } catch {}
}

function clearSelectedMarkers() {
  document.querySelectorAll(".adm-selected-marker,.adm-unselected-marker").forEach((el) => {
    el.classList.remove("adm-selected-marker", "adm-unselected-marker");
  });
}

function clearWebsiteThemeDecorations() {
  document.documentElement.removeAttribute("data-adm-webdesign-layout");
  document.documentElement.removeAttribute("data-adm-webdesign-theme");
  clearSelectedMarkers();
  clearBuilderAppliedStyles();
  removeMenuToggleButton();
}

function applyWebsiteThemeInternal() {
  const cfg = WEBSITE_THEME_STATE;
  if (!cfg.enabled) {
    try {
      cancelThemeReapplyBurst();
    } catch {}
    try {
      cancelBuilderLayoutResyncPending();
    } catch {}
  }
  const activeTheme = findTheme(cfg.layout, cfg.theme);
  const css = cfg.enabled ? buildThemeCss(cfg) : "";
  const activeThemeId = String(cfg.theme || "").toLowerCase();
  const keepDefaultAlignment = BUILDER_DEFAULT_ALIGNMENT_THEMES.has(activeThemeId) && !BUILDER_SESSION_ACTIVE;
  if (cfg.enabled) {
    document.documentElement.setAttribute("data-adm-webdesign-layout", cfg.layout || "horizontal");
    document.documentElement.setAttribute("data-adm-webdesign-theme", cfg.theme || "classic");
  } else {
    clearWebsiteThemeDecorations();
  }
  applyWebsiteThemeLocal(css);
  sendWebsiteThemeCss(css);
  try {
    if (cfg.enabled) ensureMenuToggleButton();
    else removeMenuToggleButton();
  } catch {}

  const themeBuilderDataRaw =
    activeTheme?.builderData && typeof activeTheme.builderData === "object" ? activeTheme.builderData : null;
  const themeHasMovableLayout =
    themeBuilderDataRaw != null && builderStorageRootHasMovableData(themeBuilderDataRaw);
  if (keepDefaultAlignment) {
    try {
      BUILDER_PIN_KEYS_SEEN = new Set();
    } catch {}
    BUILDER_DATA_BY_MODE = { x01: {}, bull_off: {} };
    BUILDER_ACTIVE_PLAY_MODE = pathnameIndicatesWebsiteThemesPlayfield()
      ? getBuilderPlayModeFromDom()
      : BUILDER_PLAY_MODE_X01;
    BUILDER_DATA = BUILDER_DATA_BY_MODE[BUILDER_ACTIVE_PLAY_MODE];
  } else {
    const builderHydrateRoot = themeHasMovableLayout
      ? themeBuilderDataRaw
      : BUILDER_SESSION_ACTIVE && cfg.builderData && typeof cfg.builderData === "object"
        ? cfg.builderData
        : {};
    hydrateBuilderDataFromStorageRoot(builderHydrateRoot);
  }
  setBuilderActive(cfg.enabled && BUILDER_SESSION_ACTIVE);
  if (cfg.enabled && !keepDefaultAlignment) {
    applyBuilderDataToDom();
  } else {
    clearBuilderAppliedStyles();
    clearSelectedMarkers();
    if (!cfg.enabled) {
      document.documentElement.removeAttribute("data-adm-webdesign-layout");
      document.documentElement.removeAttribute("data-adm-webdesign-theme");
      removeMenuToggleButton();
    }
  }
  syncDartboardGlowVisibility();
  suspendBuilderOutsidePlayfield();
  updateBuilderPinVisibility();
  refreshBuilderSelectionBox();
  if (cfg.enabled && !keepDefaultAlignment && BUILDER_SESSION_ACTIVE) {
    scheduleBuilderLayoutResync();
  }
}

function applyWebsiteTheme() {
  const id = (APPLY_WEBSITE_THEME_COALESCE += 1);
  queueMicrotask(() => {
    if (id !== APPLY_WEBSITE_THEME_COALESCE) return;
    applyWebsiteThemeInternal();
  });
}

function startThemeBuilderSession() {
  let emptyLayoutWarning = false;
  try {
    if (chrome?.storage?.local) {
      chrome.storage.local.get(["settings"], (items) => {
        const settings = { ...(items?.settings || {}) };
        if (settings.websiteMatchNativeAutodarts) {
          delete settings.websiteMatchNativeAutodarts;
          chrome.storage.local.set({ settings }, () => void chrome.runtime?.lastError);
        }
      });
    }
  } catch {}
  try {
    delete WEBSITE_THEME_STATE.matchNativeAutodarts;
  } catch {}
  if (!WEBSITE_THEME_STATE.enabled) {
    WEBSITE_THEME_STATE.enabled = true;
  }
  const cfgPre = WEBSITE_THEME_STATE;
  const activeThemeRow = findTheme(cfgPre.layout, cfgPre.theme);
  const themeIdPre = String(cfgPre.theme || "").toLowerCase();
  const themeHasPackBuilderLayout =
    activeThemeRow?.builderData &&
    typeof activeThemeRow.builderData === "object" &&
    builderStorageRootHasMovableData(activeThemeRow.builderData);
  const skipNonBuilderPackWarning = BUILDER_DEFAULT_ALIGNMENT_THEMES.has(themeIdPre);

  if (!themeHasPackBuilderLayout && !skipNonBuilderPackWarning) {
    emptyLayoutWarning = true;
    hydrateBuilderDataFromStorageRoot({});
    try {
      cfgPre.builderData = {};
    } catch {}
    BUILDER_SELECTED_KEYS = [];
    clearBuilderSelectionHitMarkers();
    syncBuilderPrimaryFromKeys();
    try {
      if (chrome?.storage?.local) {
        chrome.storage.local.get(["settings"], (items) => {
          const settings = { ...(items?.settings || {}) };
          settings.websiteThemeBuilderData = "{}";
          chrome.storage.local.set({ settings }, () => {
            void chrome.runtime?.lastError;
          });
        });
      }
    } catch {}
  }

  BUILDER_SESSION_ACTIVE = true;
  applyWebsiteTheme();
  const pruned = pruneBuilderDataToMovableKeys(BUILDER_DATA || {});
  try {
    delete pruned[DARTBOARD_GLOW_TARGET_KEY];
  } catch {}
  BUILDER_DATA_BY_MODE[BUILDER_ACTIVE_PLAY_MODE] = pruned;
  BUILDER_DATA = pruned;
  BUILDER_SESSION_SNAPSHOT = takeBuilderSessionSnapshot();
  BUILDER_HISTORY = [];
  BUILDER_HISTORY_INDEX = -1;
  commitBuilderHistorySnapshot();
  if (!themeHasPackBuilderLayout && !skipNonBuilderPackWarning) {
    try {
      saveBuilderDataToSettings();
    } catch {}
  }
  return { ok: true, emptyLayoutWarning };
}

function isLikelySelected(el) {
  if (!el || !el.getAttribute) return false;
  const className = String(el.className || "").toLowerCase();
  const classTokens = className.split(/\s+/).filter(Boolean);
  const hasSelectedChild = !!el.querySelector?.(
    '.Mui-selected,[aria-pressed="true"],[aria-selected="true"],[aria-checked="true"],input[type="radio"]:checked,input[type="checkbox"]:checked'
  );
  if (el.getAttribute("aria-pressed") === "true") return true;
  if (el.getAttribute("aria-selected") === "true") return true;
  if (el.getAttribute("aria-checked") === "true") return true;
  if (el.getAttribute("data-selected") === "true") return true;
  if (el.getAttribute("data-active") === "true") return true;
  if (el.getAttribute("data-state") === "active") return true;
  if (el.getAttribute("data-state") === "on") return true;
  if (className.includes("mui-selected")) return true;
  if (className.includes("mui-checked")) return true;
  if (classTokens.includes("selected")) return true;
  if (classTokens.includes("is-selected")) return true;
  if (classTokens.includes("is-active")) return true;
  if (/(^|[\s_-])selected($|[\s_-])/.test(className)) return true;
  if (hasSelectedChild) return true;
  return false;
}

function isLikelyOptionControl(el) {
  if (!el || !el.matches) return false;
  if (el.matches(".MuiToggleButton-root")) return true;
  if (el.matches("[aria-pressed],[aria-selected],[aria-checked],[role='radio'],[role='option']")) return true;
  return false;
}

function updateSelectedMarkers() {
  if (!pathnameIndicatesWebsiteThemesPlayfield()) {
    clearSelectedMarkers();
    return;
  }
  const cfg = WEBSITE_THEME_STATE;
  if (!cfg?.enabled) {
    clearSelectedMarkers();
    return;
  }
  const nodes = document.querySelectorAll(
    ".MuiToggleButton-root,.MuiButtonBase-root,.MuiButton-root,button,[role='button'],[role='radio'],[role='option'],[aria-pressed],[aria-selected],[aria-checked],[data-state]"
  );
  nodes.forEach((el) => {
    const selected = isLikelySelected(el);
    const option = isLikelyOptionControl(el);
    el.classList.toggle("adm-selected-marker", selected);
    el.classList.toggle("adm-unselected-marker", option && !selected);
  });
  try {
    const activeThemeId = String(cfg.theme || "").toLowerCase();
    const keepDefaultAlignment = BUILDER_DEFAULT_ALIGNMENT_THEMES.has(activeThemeId) && !BUILDER_SESSION_ACTIVE;
    if (!keepDefaultAlignment) refreshBuilderCropFrameTurnHighlights();
  } catch {}
}

function scheduleSelectedMarkerUpdate() {
  if (SELECTED_MARKER_TIMER) clearTimeout(SELECTED_MARKER_TIMER);
  SELECTED_MARKER_TIMER = setTimeout(() => {
    SELECTED_MARKER_TIMER = null;
    updateSelectedMarkers();
  }, 160);
}

function bindSelectedMarkerObserver() {
  if (SELECTED_MARKER_OBSERVER) return;
  SELECTED_MARKER_OBSERVER = new MutationObserver(() => {
    scheduleSelectedMarkerUpdate();
  });
  SELECTED_MARKER_OBSERVER.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: [
      "class",
      "aria-pressed",
      "aria-selected",
      "aria-checked",
      "data-selected",
      "data-active",
      "data-adm-play-mode"
    ]
  });
}

function cancelThemeReapplyBurst() {
  if (WEBSITE_THEME_REAPPLY_TIMER) {
    try {
      clearInterval(WEBSITE_THEME_REAPPLY_TIMER);
    } catch {}
    WEBSITE_THEME_REAPPLY_TIMER = null;
  }
}

function scheduleThemeReapplyBurst() {
  if (!WEBSITE_THEME_STATE?.enabled) return;
  cancelThemeReapplyBurst();
  let remaining = 4;
  WEBSITE_THEME_REAPPLY_TIMER = setInterval(() => {
    if (!WEBSITE_THEME_STATE?.enabled) {
      cancelThemeReapplyBurst();
      return;
    }
    applyWebsiteTheme();
    scheduleSelectedMarkerUpdate();
    remaining -= 1;
    if (remaining <= 0) {
      clearInterval(WEBSITE_THEME_REAPPLY_TIMER);
      WEBSITE_THEME_REAPPLY_TIMER = null;
    }
  }, 600);
}

function loadWebsiteThemeFromStorage() {
  try {
    if (!chrome?.storage?.local) return;
    chrome.storage.local.get(["settings"], (items) => {
      const settings = items?.settings || {};
      WEBSITE_THEME_STATE = normalizeWebsiteThemeSettings(settings);
      applyWebsiteTheme();
      if (WEBSITE_THEME_STATE.enabled) {
        scheduleThemeReapplyBurst();
        scheduleBuilderLayoutResync();
      }
      scheduleSelectedMarkerUpdate();
    });
  } catch {}
}

function bindWebsiteThemeWatcher() {
  if (!chrome?.storage?.onChanged) return;
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    const next = changes?.settings?.newValue;
    if (!next || typeof next !== "object") return;
    const prev = changes?.settings?.oldValue;
    try {
      const themePickChanged =
        prev &&
        typeof prev === "object" &&
        (prev.websiteTheme !== next.websiteTheme || prev.websiteLayout !== next.websiteLayout);
      if (themePickChanged && next.websiteMatchNativeAutodarts) {
        const cleaned = { ...next };
        delete cleaned.websiteMatchNativeAutodarts;
        chrome.storage.local.set({ settings: cleaned }, () => void chrome.runtime?.lastError);
        WEBSITE_THEME_STATE = normalizeWebsiteThemeSettings(cleaned);
        applyWebsiteTheme();
        if (WEBSITE_THEME_STATE.enabled) {
          scheduleThemeReapplyBurst();
          scheduleBuilderLayoutResync();
        }
        scheduleSelectedMarkerUpdate();
        return;
      }
    } catch {}
    try {
      const wasShowByDefault = prev && prev.websiteHideLeftMenuByDefault === false;
      const nowHideByDefault = next.websiteHideLeftMenuByDefault !== false;
      if (wasShowByDefault && nowHideByDefault) {
        localStorage.removeItem(MENU_STATE_KEY);
      }
    } catch {}
    WEBSITE_THEME_STATE = normalizeWebsiteThemeSettings(next);
    applyWebsiteTheme();
    if (WEBSITE_THEME_STATE.enabled) {
      scheduleThemeReapplyBurst();
      scheduleBuilderLayoutResync();
    }
    scheduleSelectedMarkerUpdate();
  });
}

function onRouteChange() {
  const href = String(location.href || "");
  if (href === lastKnownHref) return;
  lastKnownHref = href;
  applyWebsiteTheme();
  scheduleSelectedMarkerUpdate();
}

const nativePushState = history.pushState.bind(history);
history.pushState = function patchedPushState() {
  const out = nativePushState.apply(history, arguments);
  onRouteChange();
  return out;
};

const nativeReplaceState = history.replaceState.bind(history);
history.replaceState = function patchedReplaceState() {
  const out = nativeReplaceState.apply(history, arguments);
  onRouteChange();
  return out;
};

window.addEventListener("popstate", onRouteChange);
window.addEventListener("hashchange", onRouteChange);
window.addEventListener("focus", () => {
  applyWebsiteTheme();
  scheduleSelectedMarkerUpdate();
});
window.addEventListener("resize", () => {
  const btn = document.getElementById(MENU_TOGGLE_BUTTON_ID);
  if (btn) {
    const collapsed = document.documentElement.getAttribute("data-adm-left-menu-collapsed") === "1";
    const target = findLeftMenuTarget() || LAST_MENU_TARGET;
    positionMenuToggleButton(btn, target, collapsed);
  }
  scheduleBuilderResizeReconcile();
});
try {
  window.visualViewport?.addEventListener?.("resize", scheduleBuilderResizeReconcile);
} catch {}
window.addEventListener("scroll", () => {
  const btn = document.getElementById(MENU_TOGGLE_BUTTON_ID);
  if (!btn) return;
  const collapsed = document.documentElement.getAttribute("data-adm-left-menu-collapsed") === "1";
  const target = findLeftMenuTarget() || LAST_MENU_TARGET;
  positionMenuToggleButton(btn, target, collapsed);
  refreshBuilderSelectionBox();
}, true);
window.addEventListener("pageshow", () => {
  applyWebsiteTheme();
  scheduleSelectedMarkerUpdate();
});
window.addEventListener("load", () => {
  applyWebsiteTheme();
  scheduleThemeReapplyBurst();
  scheduleSelectedMarkerUpdate();
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    applyWebsiteTheme();
    scheduleSelectedMarkerUpdate();
  }
});

document.addEventListener("mousedown", onBuilderMouseDown, true);
document.addEventListener("mousemove", onBuilderMouseMove, true);
document.addEventListener("mouseup", onBuilderMouseUp, true);
document.addEventListener("wheel", onBuilderWheel, { capture: true, passive: false });
document.addEventListener("keydown", onBuilderKeyDown, true);
document.addEventListener("click", onBuilderClickBlock, true);

if (chrome?.runtime?.onMessage?.addListener) {
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "ADM_START_THEME_BUILDER") {
      try {
        const out = startThemeBuilderSession();
        sendResponse?.(out && typeof out === "object" ? out : { ok: true, emptyLayoutWarning: false });
      } catch (e) {
        sendResponse?.({ ok: false, error: String(e?.message || e || "error") });
      }
      return true;
    }
    if (msg?.type === "ADM_DO_STYLEBOT_THUMB_CAPTURE") {
      void (async () => {
        try {
          const out = await runStylebotPackLiveThumbnailCapture(msg);
          sendResponse?.(out && typeof out === "object" ? out : { ok: false, error: "bad_reply" });
        } catch (e) {
          sendResponse?.({ ok: false, error: String(e?.message || e || "error") });
        }
      })();
      return true;
    }
    return undefined;
  });
}

setInterval(onRouteChange, 700);

loadWebsiteThemeFromStorage();
bindWebsiteThemeWatcher();
bindSelectedMarkerObserver();
})();
