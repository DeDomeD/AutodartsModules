/**
 * Vibecoded by DeDomeD — Urheber; nicht als eigenes/fremdes Produkt verkaufen oder umbenennen (nur Quelltext).
 */
const $ = (id) => document.getElementById(id);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

let SETTINGS = null;
let CURRENT_PAGE = "";
let SEARCH = "";
let ACTIVE_MODULES = [];
let CONNECTION_STATUS_TIMER = null;
const DEFAULT_WEBSITE_API_URL = "https://autodarts-modules-production.up.railway.app";
const WEBSITE_URL = `${DEFAULT_WEBSITE_API_URL}/`;

const MODULE_ORDER = [
  "effects",
  "overlay",
  "wled",
  "caller",
  "playercam",
  "obszoom",
  "macros",
  "lobbyfilter",
  "stats",
  "themes",
  "community",
  "liga",
  "games"
];
/** Optional: Modul-ID → i18n-Key fuer Tooltip; gruener Pip via .navItemReady (derzeit unbenutzt). */
const MODULE_NAV_READY = {};
/** Nav-Icons: noch in Arbeit (leicht rötlich). */
const MODULE_NAV_WIP = new Set(["overlay", "caller", "playercam", "macros", "liga", "games"]);
/** Nav-Icons: Beta (gelblich). */
const MODULE_NAV_BETA = new Set(["effects", "wled", "stats", "themes"]);
const WEBSITE_ICON_COLOR = "assets/ICON.png";
const WEBSITE_ICON_GRAY = "assets/ICON_grau.png";
const LAST_PAGE_STORAGE_KEY = "adm_last_popup_page";

function currentLang() {
  const lang = String(SETTINGS?.uiLanguage || "de").toLowerCase();
  return lang === "en" ? "en" : "de";
}

function t(key, vars = {}) {
  const dict = (window.ADM_I18N && window.ADM_I18N[currentLang()]) || {};
  const fallback = (window.ADM_I18N && window.ADM_I18N.en) || {};
  let out = dict[key] || fallback[key] || key;
  for (const [k, v] of Object.entries(vars)) out = out.replace(`{${k}}`, String(v));
  return out;
}

function normalizePrefix(p) {
  const txt = String(p || "").trim();
  return txt.endsWith(" ") ? txt : `${txt} `;
}

function normalizeWebsiteApiUrl(url) {
  return String(url || DEFAULT_WEBSITE_API_URL).trim().replace(/\/+$/, "");
}

function getWebsiteAccountUrl() {
  return `${normalizeWebsiteApiUrl(SETTINGS?.websiteApiUrl)}/account.html`;
}

async function callWebsiteApi(path, options = {}) {
  const baseUrl = normalizeWebsiteApiUrl(options.baseUrl || SETTINGS?.websiteApiUrl);
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };
  const token = String(options.token || SETTINGS?.accountToken || "").trim();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${baseUrl}${path}`, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.ok === false) {
    throw new Error(String(data?.error || `HTTP ${res.status}`));
  }
  return data;
}

function normalizeInstalledModules(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    const id = String(item || "").trim().toLowerCase();
    if (!id) continue;
    if (out.includes(id)) continue;
    out.push(id);
  }
  return out;
}

function getInstalledModuleSet(raw) {
  return new Set(normalizeInstalledModules(raw));
}

function getModuleConfigList() {
  return Object.values(window.ADM_MODULE_CONFIGS || {});
}

function collectModuleIniSpec() {
  const spec = {
    togglesBool: [],
    togglesNumber: {},
    modulesConfigString: {}
  };
  for (const cfg of getModuleConfigList()) {
    const ini = cfg?.ini || {};
    for (const key of ini.togglesBool || []) {
      if (!spec.togglesBool.includes(key)) spec.togglesBool.push(key);
    }
    Object.assign(spec.togglesNumber, ini.togglesNumber || {});
    Object.assign(spec.modulesConfigString, ini.modulesConfigString || {});
  }
  return spec;
}

/** Alte Marquee-DOM von .liTitle entfernen (falls aus früherer Version). */
function clearLegacyMarqueeFromLiTitles() {
  $$(".liTitle").forEach((el) => {
    if (el.querySelector(":scope > .marqueeTrack") && el.dataset.plainText) {
      el.textContent = el.dataset.plainText;
    }
    el.classList.remove("marqueeOn");
    el.style.removeProperty("--marquee-duration");
    delete el.dataset.plainText;
  });
}

function applyI18n() {
  clearLegacyMarqueeFromLiTitles();

  $$("[data-i18n]").forEach((el) => {
    const key = el.dataset.i18n;
    if (!key) return;
    el.textContent = t(key);
  });
  $$("[data-i18n-placeholder]").forEach((el) => {
    const key = el.dataset.i18nPlaceholder;
    if (!key) return;
    el.setAttribute("placeholder", t(key));
  });
  $$("[data-i18n-title]").forEach((el) => {
    const key = el.dataset.i18nTitle;
    if (!key) return;
    el.setAttribute("title", t(key));
  });
  $$("[data-i18n-aria-label]").forEach((el) => {
    const key = el.dataset.i18nAriaLabel;
    if (!key) return;
    el.setAttribute("aria-label", t(key));
  });
}

window.__ADM_APPLY_I18N__ = applyI18n;

function setPage(name) {
  const pageName = String(name || "settings");
  const exists = !!document.querySelector(`.page[data-page="${pageName}"]`);
  if (!exists) return;

  CURRENT_PAGE = pageName;
  try {
    localStorage.setItem(LAST_PAGE_STORAGE_KEY, pageName);
  } catch {}

  $$(".page").forEach((p) => p.classList.toggle("active", p.dataset.page === pageName));
  $$(".navItem").forEach((b) => b.classList.toggle("active", b.dataset.nav === pageName));
  applySearchFilter(SEARCH);
}

function openConnectionsInSettings() {
  setPage("settings");
  requestAnimationFrame(() => {
    document.getElementById("settingsConnectionsSection")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  });
}

function applyWledConnectionStrip(el, state, detailText) {
  if (!el) return;
  const s = String(state || "unknown").toLowerCase();
  el.classList.remove("connected", "disconnected", "connecting", "exhausted");
  if (s === "connected") el.classList.add("connected");
  else if (s === "connecting") el.classList.add("connecting");
  else el.classList.add("disconnected");
  const textEl = el.querySelector("[data-wled-strip-text]");
  if (textEl) textEl.textContent = detailText || "";
}

function applyWledControllerConnectionBtn(btn, ok, detailText) {
  if (!btn) return;
  btn.classList.remove("connected", "disconnected", "connecting", "exhausted");
  if (ok === true) btn.classList.add("connected");
  else btn.classList.add("disconnected");
  const line = btn.querySelector("[data-wled-connection-line]");
  if (line) line.textContent = detailText || "";
}

function updateWledConnectionStripUi(state, detailText) {
  $$("[data-wled-connection-strip]").forEach((el) => applyWledConnectionStrip(el, state, detailText));
}

function updateWledControllerConnectionBtnUi(controllerId, ok, detailText) {
  const id = String(controllerId || "").trim();
  if (!id) return;
  document.querySelectorAll(`[data-wled-controller-connection="${id}"]`).forEach((btn) => {
    applyWledControllerConnectionBtn(btn, ok, detailText);
  });
}

function getLastPageOrDefault() {
  try {
    let saved = String(localStorage.getItem(LAST_PAGE_STORAGE_KEY) || "").trim().toLowerCase();
    if (saved === "websitedesign") {
      saved = "themes";
      try {
        localStorage.setItem(LAST_PAGE_STORAGE_KEY, "themes");
      } catch {
        /* ignore */
      }
    }
    if (!saved) return "settings";
    const exists = !!document.querySelector(`.page[data-page="${saved}"]`);
    return exists ? saved : "settings";
  } catch {
    return "settings";
  }
}

function clearInvalidLastPageIfNeeded() {}

function applySearchFilter(query) {
  SEARCH = String(query || "").trim().toLowerCase();
  if (!SEARCH) {
    const activePage = document.querySelector(".page.active");
    if (!activePage) return;
    $$(".listItem, .listToggle, .tile, .card", activePage).forEach((el) => {
      el.style.display = "";
    });
    return;
  }
  const activePage = document.querySelector(".page.active");
  if (!activePage) return;
  const rows = $$(".listItem, .listToggle, .tile, .card", activePage);
  rows.forEach((el) => {
    if (!SEARCH) {
      el.style.display = "";
      return;
    }
    el.style.display = (el.innerText || "").toLowerCase().includes(SEARCH) ? "" : "none";
  });
}

/**
 * Theme-Builder (Match-Seite) schreibt `chrome.storage.local` direkt — ohne diesen Spiegel
 * bleiben Side-Panel/Popup-`SETTINGS` veraltet und die Galerie-Vorschau leer.
 */
let admSettingsStorageMirrorBound = false;
function bindAdmSettingsStorageMirror() {
  if (admSettingsStorageMirrorBound) return;
  if (!chrome?.storage?.onChanged) return;
  admSettingsStorageMirrorBound = true;
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes.settings) return;
    void (async () => {
      try {
        const res = await send({ type: "GET_SETTINGS" });
        if (!res?.ok || !res.settings) return;
        SETTINGS = res.settings;
        syncActiveModules(SETTINGS);
      } catch {
        /* ignore */
      }
    })();
  });
}

async function send(msg) {
  try {
    return await chrome.runtime.sendMessage(msg);
  } catch (e) {
    try {
      void chrome.runtime?.lastError;
    } catch {
      /* ignore */
    }
    return { ok: false, error: String(e?.message || e || "send_failed") };
  }
}

function setChecked(root, id, value) {
  const el = root.querySelector(`#${id}`);
  if (!el) return;
  el.checked = !!value;
}

function setValue(root, id, value) {
  const el = root.querySelector(`#${id}`);
  if (!el) return;
  el.value = value;
}

function bindAuto(root, id, key, type = "checkbox") {
  const el = root.querySelector(`#${id}`);
  if (!el) return;
  el.addEventListener("change", async () => {
    const value = type === "checkbox"
      ? !!el.checked
      : type === "number"
        ? parseInt(el.value || "0", 10)
        : el.value;
    await savePartial({ [key]: value });
  });
}

function bindAutoImmediate(root, id, key, transform = (value) => value, delayMs = 250) {
  const el = root.querySelector(`#${id}`);
  if (!el) return;
  let timer = null;
  const commit = async () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    await savePartial({ [key]: transform(el.value) });
  };
  el.addEventListener("input", () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      void commit();
    }, delayMs);
  });
  el.addEventListener("change", () => {
    void commit();
  });
}

function getConnectionStatusText(status) {
  return "";
}

function isConnectionEnabled(kind, settings = SETTINGS) {
  if (kind === "sb") return settings?.sbEnabled !== false;
  if (kind === "obs") return settings?.obsEnabled !== false;
  return true;
}

function applyConnectionStatusField(field, status) {
  if (!field) return;
  const kind = String(field.dataset.connectionKind || "").trim().toLowerCase();
  const expanded = field.closest("[data-connections-open]")?.dataset?.connectionsOpen === "true";
  const enabled = isConnectionEnabled(kind);
  field.classList.toggle("connectionHidden", !enabled && !expanded);
  if (!enabled) {
    field.classList.remove("connected", "connecting", "exhausted");
    field.classList.add("disconnected");
  }
  const state = String(status?.state || "unknown").toLowerCase();
  const exhausted = !!status?.exhausted;
  field.classList.remove("connected", "disconnected", "connecting", "exhausted");
  if (!enabled) {
    field.classList.add("disconnected");
  } else {
    if (state === "connected") field.classList.add("connected");
    else if (state === "connecting") field.classList.add("connecting");
    else if (state === "disconnected") field.classList.add("disconnected");
    if (exhausted) field.classList.add("exhausted");
  }

  const textEl = field.querySelector("[data-connection-status-text]");
  const attemptsEl = field.querySelector("[data-connection-attempts]");
  if (textEl) textEl.textContent = enabled ? getConnectionStatusText(status) : "aus";
  if (attemptsEl) {
    const attempts = Number(status?.attempts || 0);
    const state = String(status?.state || "unknown").toLowerCase();
    if (!enabled) attemptsEl.textContent = "";
    else if (attempts > 0) attemptsEl.textContent = `${attempts}/5`;
    else if (state === "connected") attemptsEl.textContent = "";
    else attemptsEl.textContent = "";
  }
}

async function refreshConnectionStatuses() {
  const sbFields = $$("[data-sb-status]");
  const obsFields = $$("[data-obs-status]");
  if (!sbFields.length && !obsFields.length) return;

  const [sbRes, obsRes] = await Promise.all([
    sbFields.length ? send({ type: "GET_SB_STATUS" }).catch(() => ({ ok: false })) : Promise.resolve(null),
    obsFields.length ? send({ type: "GET_OBS_STATUS" }).catch(() => ({ ok: false })) : Promise.resolve(null)
  ]);

  const sbStatus = sbRes?.ok ? sbRes.status : { state: "unknown" };
  const obsStatus = obsRes?.ok ? obsRes.status : { state: "unknown" };
  sbFields.forEach((field) => applyConnectionStatusField(field, sbStatus));
  obsFields.forEach((field) => applyConnectionStatusField(field, obsStatus));
}

function parseIniBoolean(raw) {
  const v = String(raw || "").trim().toLowerCase();
  if (v === "true" || v === "1" || v === "yes" || v === "on") return true;
  if (v === "false" || v === "0" || v === "no" || v === "off") return false;
  return null;
}

function parseIniNumber(raw, fallback = 0) {
  const n = parseInt(String(raw || "").trim(), 10);
  return Number.isFinite(n) ? n : fallback;
}

function parseIniSettings(text) {
  const sections = {};
  let current = "";
  const lines = String(text || "").split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith(";") || line.startsWith("#")) continue;
    const sec = line.match(/^\[([^\]]+)\]$/);
    if (sec) {
      current = sec[1].trim().toLowerCase();
      if (!sections[current]) sections[current] = {};
      continue;
    }
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (!sections[current]) sections[current] = {};
    sections[current][key] = value;
  }

  const partial = {};
  const sb = sections.streamerbot || {};
  const toggles = sections.toggles || {};
  const actions = sections.actions || {};
  const modules = sections.modules || sections.addons || {};

  if (sb.sbUrl) partial.sbUrl = sb.sbUrl;
  if (sb.sbPassword !== undefined) partial.sbPassword = sb.sbPassword;
  if (sb.sbEnabled !== undefined) {
    const parsed = parseIniBoolean(sb.sbEnabled);
    if (parsed !== null) partial.sbEnabled = parsed;
  }
  if (sb.obsUrl) partial.obsUrl = sb.obsUrl;
  if (sb.obsPassword !== undefined) partial.obsPassword = sb.obsPassword;
  if (sb.obsEnabled !== undefined) {
    const parsed = parseIniBoolean(sb.obsEnabled);
    if (parsed !== null) partial.obsEnabled = parsed;
  }
  if (sb.actionPrefix !== undefined) partial.actionPrefix = normalizePrefix(sb.actionPrefix);
  if (toggles.uiLanguage !== undefined) partial.uiLanguage = String(toggles.uiLanguage).toLowerCase() === "en" ? "en" : "de";

  if (modules.installed !== undefined) {
    partial.installedModules = normalizeInstalledModules(String(modules.installed).split(","));
  }

  const boolKeys = [];
  const moduleIniSpec = collectModuleIniSpec();
  for (const key of moduleIniSpec.togglesBool) {
    if (!boolKeys.includes(key)) boolKeys.push(key);
  }
  for (const key of boolKeys) {
    if (toggles[key] === undefined) continue;
    const parsed = parseIniBoolean(toggles[key]);
    if (parsed !== null) partial[key] = parsed;
  }

  for (const [key, fallback] of Object.entries(moduleIniSpec.togglesNumber)) {
    if (toggles[key] === undefined) continue;
    partial[key] = parseIniNumber(toggles[key], fallback);
  }

  const moduleCfg = sections.modules_config || sections.addons_config || {};
  for (const [key, fallback] of Object.entries(moduleIniSpec.modulesConfigString)) {
    if (moduleCfg[key] === undefined) continue;
    partial[key] = String(moduleCfg[key] || fallback || "");
  }
  if (Object.keys(actions).length > 0) partial.actions = actions;

  return partial;
}

function toIniText(s) {
  const settings = s || {};
  const asBool = (v) => (v ? "true" : "false");
  const actions = settings.actions || {};
  const installedModules = normalizeInstalledModules(settings.installedModules);
  const moduleIniSpec = collectModuleIniSpec();
  const moduleToggleBoolLines = moduleIniSpec.togglesBool.map((key) => `${key}=${asBool(settings[key])}`);
  const moduleToggleNumberLines = Object.entries(moduleIniSpec.togglesNumber).map(
    ([key, fallback]) => `${key}=${Number.isFinite(settings[key]) ? settings[key] : fallback}`
  );
  const moduleConfigLines = Object.entries(moduleIniSpec.modulesConfigString).map(
    ([key, fallback]) => `${key}=${settings[key] || fallback || ""}`
  );

  const lines = [
    "[modules]",
    `installed=${installedModules.join(",")}`,
    "",
    "[streamerbot]",
    `sbEnabled=${asBool(settings.sbEnabled !== false)}`,
    `sbUrl=${settings.sbUrl || "ws://127.0.0.1:8080/"}`,
    `sbPassword=${settings.sbPassword || ""}`,
    `obsEnabled=${asBool(settings.obsEnabled !== false)}`,
    `obsUrl=${settings.obsUrl || "ws://127.0.0.1:4455/"}`,
    `obsPassword=${settings.obsPassword || ""}`,
    `actionPrefix=${(settings.actionPrefix || "ADM ").trim()}`,
    "",
    "[toggles]",
    `uiLanguage=${String(settings.uiLanguage || "de").toLowerCase() === "en" ? "en" : "de"}`,
    "",
    ...moduleToggleBoolLines,
    ...moduleToggleNumberLines,
    "",
    "[modules_config]",
    ...moduleConfigLines,
    "",
    "[actions]",
    ...Object.keys(actions)
      .sort((a, b) => a.localeCompare(b))
      .map((k) => `${k}=${actions[k]}`)
  ];
  return `${lines.join("\n")}\n`;
}

function toModuleIniText(settings, moduleConfig) {
  const cfg = moduleConfig || {};
  const ini = cfg.ini || {};
  const asBool = (v) => (v ? "true" : "false");
  const lines = [
    "[module]",
    `id=${String(cfg.id || "")}`,
    ""
  ];

  const boolKeys = Array.isArray(ini.togglesBool) ? ini.togglesBool : [];
  const numberEntries = Object.entries(ini.togglesNumber || {});
  if (boolKeys.length || numberEntries.length) {
    lines.push("[toggles]");
    for (const key of boolKeys) {
      lines.push(`${key}=${asBool(settings?.[key])}`);
    }
    for (const [key, fallback] of numberEntries) {
      lines.push(`${key}=${Number.isFinite(settings?.[key]) ? settings[key] : fallback}`);
    }
    lines.push("");
  }

  const moduleConfigEntries = Object.entries(ini.modulesConfigString || {});
  if (moduleConfigEntries.length) {
    lines.push("[modules_config]");
    for (const [key, fallback] of moduleConfigEntries) {
      lines.push(`${key}=${settings?.[key] || fallback || ""}`);
    }
    lines.push("");
  }

  const actionKeys = [
    ...Object.keys(cfg.actionDefaults || {}),
    ...Object.keys(settings?.actions || {}).filter((key) => key.startsWith("custom_"))
  ].filter((key, index, arr) => arr.indexOf(key) === index);
  if (actionKeys.length) {
    lines.push("[actions]");
    for (const key of actionKeys.sort((a, b) => a.localeCompare(b))) {
      if (settings?.actions?.[key] !== undefined) {
        lines.push(`${key}=${settings.actions[key]}`);
      }
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

function buildIniFiles(settings) {
  const files = [{
    name: "settings.ini",
    content: toIniText(settings)
  }];
  for (const cfg of getModuleConfigList()) {
    if (!cfg?.id) continue;
    files.push({
      name: `${String(cfg.id || "").toLowerCase()}.ini`,
      content: toModuleIniText(settings, cfg)
    });
  }
  return files;
}

function getModuleList() {
  const registry = window.ADM_MODULES || {};
  return MODULE_ORDER
    .map((id) => registry[id])
    .filter((a) => !!a && typeof a.render === "function");
}

function collectFeatureNeeds(modules) {
  const needs = { streamerbot: false, obs: false };
  for (const module of modules || []) {
    if (module?.needs?.streamerbot) needs.streamerbot = true;
    if (module?.needs?.obs) needs.obs = true;
  }
  return needs;
}

/** Streamer.bot-Nutzung wie im Worker (`shouldUseStreamerbot`). */
function settingsImplyStreamerbot(settings) {
  if (settings?.sbEnabled === false) return false;
  const installed = getInstalledModuleSet(settings?.installedModules);
  return installed.has("effects") || installed.has("overlay") || installed.has("obszoom");
}

/**
 * Beim Oeffnen des Popups: WLED-Presets, OBS-Szenen/Quellen, optional SB-Action-Namen (Effects-Datalist) nachladen.
 */
async function runPopupOpenExternalListRefresh(settings, host) {
  if (!host) return;
  const installed = getInstalledModuleSet(settings?.installedModules);
  if (installed.has("wled")) {
    const page = host.querySelector('.page[data-page="wled"]');
    if (page) {
      try {
        await window.ADM_MODULES?.wled?.refreshPresetsOnPopupOpen?.(apiFor(page));
      } catch {
        /* ignore */
      }
    }
  }
  if (installed.has("obszoom")) {
    const page = host.querySelector('.page[data-page="obszoom"]');
    if (page) {
      try {
        await window.ADM_MODULES?.obszoom?.refreshObsListsOnPopupOpen?.(apiFor(page));
      } catch {
        /* ignore */
      }
    }
  }
  if (installed.has("effects") && settingsImplyStreamerbot(settings)) {
    const page = host.querySelector('.page[data-page="effects"]');
    if (page) {
      try {
        await window.ADM_MODULES?.effects?.refreshSbActionsDatalist?.(apiFor(page));
      } catch {
        /* ignore */
      }
    }
  }
}

function setModuleToggleTitle(input, enabled) {
  if (!input) return;
  input.title = enabled ? "Modul deaktivieren" : "Modul aktivieren";
  input.setAttribute("aria-label", input.title);
}

function syncModulePageState(page, enabled) {
  if (!page) return;
  page.classList.toggle("pageDisabled", !enabled);
  const toggle = page.querySelector("[data-module-toggle]");
  if (toggle) {
    toggle.checked = !!enabled;
    setModuleToggleTitle(toggle, !!enabled);
  }
}

function decorateModulePage(page, module, enabled) {
  if (!page || page.querySelector(".modulePageHeader")) {
    syncModulePageState(page, enabled);
    return;
  }

  const content = document.createElement("div");
  content.className = "modulePageBody";
  while (page.firstChild) content.appendChild(page.firstChild);

  const header = document.createElement("div");
  header.className = "modulePageHeader";
  header.innerHTML = `
    <div class="modulePageHeaderMain"></div>
    <label class="switch switchCompact modulePageSwitch">
      <input type="checkbox" data-module-toggle="${module.id}" />
      <span class="slider"></span>
    </label>
  `;

  const title = content.querySelector(".title");
  const headerMain = header.querySelector(".modulePageHeaderMain");
  if (title && headerMain) headerMain.appendChild(title);

  const toggle = header.querySelector("[data-module-toggle]");
  setModuleToggleTitle(toggle, enabled);
  toggle.addEventListener("change", async () => {
    const current = normalizeInstalledModules(SETTINGS?.installedModules || []);
    const next = new Set(current);
    if (toggle.checked) next.add(module.id);
    else next.delete(module.id);
    await savePartial({ installedModules: Array.from(next) });
  });

  page.append(header, content);
  syncModulePageState(page, enabled);
}

function apiFor(root) {
  return {
    root,
    t,
    send,
    getSettings: () => SETTINGS,
    savePartial,
    bindAuto,
    bindAutoImmediate,
    setChecked,
    setValue,
    normalizePrefix,
    parseIniSettings,
    toIniText,
    buildIniFiles,
    refreshSbStatus: refreshConnectionStatuses,
    refreshConnectionStatuses,
    updateWledConnectionStripUi,
    updateWledControllerConnectionBtnUi,
    callWebsiteApi,
    normalizeWebsiteApiUrl,
    getWebsiteAccountUrl,
    normalizeInstalledModules,
    getModuleList
  };
}

function startSbStatusTimer() {
  if (CONNECTION_STATUS_TIMER) clearInterval(CONNECTION_STATUS_TIMER);
  CONNECTION_STATUS_TIMER = null;
  if (!$$("[data-sb-status]").length && !$$("[data-obs-status]").length) return;
  refreshConnectionStatuses();
  CONNECTION_STATUS_TIMER = setInterval(refreshConnectionStatuses, 1200);
}

function setModuleShellState(hasModules) {
  const header = document.querySelector(".header");
  const nav = $("moduleNav");
  const host = $("moduleHost");
  if (!header || !nav || !host) return;
  header.style.display = hasModules ? "" : "none";
  nav.style.display = hasModules ? "flex" : "none";
  host.style.padding = hasModules ? "" : "0";
}

function navIconSvg(id, fallback = "*") {
  const map = {
    settings: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z"/><path d="M19 12a7 7 0 0 0-.08-1l2-1.55-2-3.45-2.43.75a7.3 7.3 0 0 0-1.73-1l-.38-2.5H9.62l-.38 2.5a7.3 7.3 0 0 0-1.73 1L5.08 5.99l-2 3.45L5.08 11A7 7 0 0 0 5 12c0 .34.03.67.08 1l-2 1.55 2 3.45 2.43-.75c.53.41 1.11.75 1.73 1l.38 2.5h4.76l.38-2.5c.62-.25 1.2-.59 1.73-1l2.43.75 2-3.45-2-1.55c.05-.33.08-.66.08-1Z"/></svg>`,
    effects: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m12 3 1.9 4.7L19 9.2l-3.9 3.2 1.2 4.9L12 14.7 7.7 17.3l1.2-4.9L5 9.2l5.1-1.5L12 3Z"/></svg>`,
    overlay: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="4" y="6" width="16" height="12" rx="2"/><path d="M8 10h8M8 14h5"/></svg>`,
    wled: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3a6 6 0 0 0-3.8 10.6c.5.4.8 1 .8 1.6V16h6v-.8c0-.6.3-1.2.8-1.6A6 6 0 0 0 12 3Z"/><path d="M10 19h4M10.5 21h3"/></svg>`,
    caller: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="9" y="4" width="6" height="10" rx="3"/><path d="M6.5 11.5a5.5 5.5 0 1 0 11 0M12 17v3M9.5 20h5"/></svg>`,
    playercam: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3" y="6" width="18" height="14" rx="2.5" stroke="currentColor" stroke-width="1.75"/><circle cx="12" cy="13" r="3.5" stroke="currentColor" stroke-width="1.75"/><path d="M8 4h8" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/></svg>`,
    obszoom: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="11" cy="11" r="6"/><path d="m16 16 4 4M11 8v6M8 11h6"/></svg>`,
    macros: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><line x1="21" y1="4" x2="14" y2="4"/><line x1="10" y1="4" x2="3" y2="4"/><line x1="21" y1="12" x2="12" y2="12"/><line x1="8" y1="12" x2="3" y2="12"/><line x1="21" y1="20" x2="16" y2="20"/><line x1="12" y1="20" x2="3" y2="20"/><line x1="14" y1="2" x2="14" y2="6"/><line x1="8" y1="10" x2="8" y2="14"/><line x1="16" y1="18" x2="16" y2="22"/></svg>`,
    stats: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16"/><rect x="6" y="11" width="2.8" height="7" rx="1"/><rect x="10.6" y="8" width="2.8" height="10" rx="1"/><rect x="15.2" y="5" width="2.8" height="13" rx="1"/></svg>`,
    themes: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m4 16 8-8 4 4-8 8H4v-4Z"/><path d="m14 6 2-2 4 4-2 2"/></svg>`,
    community: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="8" cy="9" r="3"/><circle cx="16" cy="8" r="2.5"/><path d="M3.5 18a4.5 4.5 0 0 1 9 0"/><path d="M13 18a3.5 3.5 0 0 1 7 0"/></svg>`,
    liga: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 5h10v4a5 5 0 0 1-10 0V5Z"/><path d="M9 19h6M12 14v5"/><path d="M5 5h2M17 5h2"/></svg>`,
    games: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M21.58 16.09l-1.09-7.66A3.996 3.996 0 0 0 16.53 5H7.47C5.48 5 3.79 6.46 3.51 8.43l-1.09 7.66C2.2 17.63 3.39 19 4.94 19c.68 0 1.32-.27 1.8-.75L9 16h6l2.26 2.25c.48.48 1.13.75 1.8.75 1.56 0 2.75-1.37 2.52-2.91zM7 15v-2H5v2H3v-2H1v2h2v2h2v-2h2zm11.41-1.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM14 9c0-1.1.9-2 2-2s2 .9 2 2-.9 2-2 2-2-.9-2-2z"/></svg>`
  };
  return map[id] || `<span>${fallback}</span>`;
}

function appendWebsiteButton(nav) {
  if (!nav) return;
  const btn = document.createElement("button");
  btn.className = "navSiteBtn";
  btn.type = "button";
  btn.title = "Website";
  btn.setAttribute("aria-label", "Website");
  btn.innerHTML = `
    <img src="${WEBSITE_ICON_GRAY}" alt="Website" />
    <div class="navText">Website</div>
  `;
  btn.addEventListener("click", () => {
    const url = String(WEBSITE_URL || "").trim();
    if (!url) return;
    if (chrome?.tabs?.create) {
      chrome.tabs.create({ url });
      return;
    }
    window.open(url, "_blank");
  });
  nav.appendChild(btn);
  refreshWebsiteAccessState(btn);
}

function createNavButton(id, labelKey, iconFallback, onClick) {
  const btn = document.createElement("button");
  btn.className = "navItem";
  btn.dataset.nav = id;
  btn.innerHTML = `
    <div class="navIcon">${navIconSvg(id, iconFallback || "*")}</div>
    <div class="navText" data-i18n="${labelKey || `nav_${id}`}"></div>
  `;
  btn.addEventListener("click", onClick);
  return btn;
}

async function refreshWebsiteAccessState(btn) {
  if (!btn) return;
  const img = btn.querySelector("img");
  btn.classList.remove("noSiteAccess");
  if (img) img.src = WEBSITE_ICON_COLOR;
  btn.title = "Website";
  btn.setAttribute("aria-label", "Website");
}

function buildModuleLayout(settings, preferredPage = "") {
  const host = $("moduleHost");
  const nav = $("moduleNav");
  if (!host || !nav) return;

  const moduleList = getModuleList();
  const installedSet = getInstalledModuleSet(settings?.installedModules);
  clearInvalidLastPageIfNeeded(settings?.installedModules);
  ACTIVE_MODULES = moduleList.slice();
  const needs = collectFeatureNeeds(moduleList.filter((module) => installedSet.has(module.id)));

  host.innerHTML = "";
  nav.innerHTML = "";
  setModuleShellState(true);

  const navTop = document.createElement("div");
  navTop.className = "navSection navSectionTop";
  const navMiddle = document.createElement("div");
  navMiddle.className = "navSection navSectionMiddle";
  const navBottom = document.createElement("div");
  navBottom.className = "navSection navSectionBottom";
  nav.append(navTop, navMiddle, navBottom);

  const settingsPage = document.createElement("section");
  settingsPage.className = "page";
  settingsPage.dataset.page = "settings";
  settingsPage.innerHTML = window.ADM_MAIN_SETTINGS?.render?.({ needs, settings, t }) || "";
  host.appendChild(settingsPage);

  const settingsBtn = createNavButton(
    "settings",
    window.ADM_MAIN_SETTINGS?.navLabelKey || "nav_settings",
    window.ADM_MAIN_SETTINGS?.icon || "[]",
    () => setPage("settings")
  );
  window.ADM_MAIN_SETTINGS?.bind?.(apiFor(settingsPage));

  for (const module of ACTIVE_MODULES) {
    const page = document.createElement("section");
    page.className = "page";
    page.dataset.page = module.id;
    page.innerHTML = module.render({ needs });
    decorateModulePage(page, module, installedSet.has(module.id));
    host.appendChild(page);

    const btn = createNavButton(
      module.id,
      module.navLabelKey || `nav_${module.id}`,
      module.icon || "*",
      () => setPage(module.id)
    );
    btn.classList.toggle("disabled", !installedSet.has(module.id));
    if (MODULE_NAV_WIP.has(module.id)) btn.classList.add("navItemWip");
    else if (MODULE_NAV_BETA.has(module.id)) btn.classList.add("navItemBeta");
    else if (module.id === "obszoom" || module.id === "lobbyfilter") btn.classList.add("navItemStable");
    const readyKey = MODULE_NAV_READY[module.id];
    if (readyKey) {
      btn.classList.add("navItemReady");
      btn.dataset.i18nTitle = readyKey;
    }
    if (module.id === "community") navBottom.appendChild(btn);
    else navMiddle.appendChild(btn);

    module.bind?.(apiFor(page));
  }
  navBottom.appendChild(settingsBtn);
  appendWebsiteButton(navTop);

  const hostEl = $("moduleHost");
  if (hostEl && hostEl.dataset.admConnJump !== "1") {
    hostEl.dataset.admConnJump = "1";
    hostEl.addEventListener("click", (ev) => {
      if (!ev.target.closest("[data-settings-nav-connections]")) return;
      openConnectionsInSettings();
    });
  }

  window.ADM_MAIN_SETTINGS?.sync?.(apiFor(settingsPage), settings);
  for (const module of ACTIVE_MODULES) {
    const page = host.querySelector(`.page[data-page="${module.id}"]`);
    module.sync?.(apiFor(page), settings);
  }

  setPage(preferredPage || CURRENT_PAGE || getLastPageOrDefault());
  applyI18n();
  applySearchFilter($("searchInput")?.value || "");
  startSbStatusTimer();
  void runPopupOpenExternalListRefresh(settings, host);
}

function syncActiveModules(settings) {
  SETTINGS = settings;
  const settingsPage = document.querySelector(`.page[data-page="settings"]`);
  if (settingsPage) {
    window.ADM_MAIN_SETTINGS?.sync?.(apiFor(settingsPage), settings);
  }
  for (const module of ACTIVE_MODULES) {
    const page = document.querySelector(`.page[data-page="${module.id}"]`);
    if (!page) continue;
    syncModulePageState(page, getInstalledModuleSet(settings?.installedModules).has(module.id));
    module.sync?.(apiFor(page), settings);
  }
  applyI18n();
  refreshConnectionStatuses();
}

async function savePartial(partial) {
  const activePageBeforeSave = CURRENT_PAGE;
  const prev = normalizeInstalledModules(SETTINGS?.installedModules).join(",");
  const res = await send({ type: "SET_SETTINGS", settings: partial || {} });
  if (!res?.ok || !res.settings) return;
  const next = normalizeInstalledModules(res.settings.installedModules).join(",");
  SETTINGS = res.settings;
  if (prev !== next) {
    buildModuleLayout(SETTINGS, activePageBeforeSave);
    return;
  }
  syncActiveModules(SETTINGS);
}

function bindShell() {
  applySearchFilter("");
}

async function init() {
  bindShell();
  const res = await send({ type: "GET_SETTINGS" });
  SETTINGS = res?.ok && res.settings && typeof res.settings === "object" ? res.settings : {};
  buildModuleLayout(SETTINGS);
  bindAdmSettingsStorageMirror();
  window.addEventListener("beforeunload", () => {
    if (CONNECTION_STATUS_TIMER) clearInterval(CONNECTION_STATUS_TIMER);
  }, { once: true });
}

init();
