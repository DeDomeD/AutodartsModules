/**
 * Zentrale Default-Konfiguration
 * - wird beim ersten Start gespeichert
 * - dient als Fallback bei unvollständigen/alten Settings
 */
(function initDefaults(scope) {
  const ADM = scope.ADM || (scope.ADM = {});
  const DEFAULT_WEBSITE_API_URL = "https://autodarts-modules-production.up.railway.app";
  const moduleConfigs = scope.ADM_MODULE_CONFIGS || {};
  const installedModules = Object.values(moduleConfigs)
    .filter((cfg) => cfg?.autoInstall !== false)
    .map((cfg) => String(cfg.id || "").trim().toLowerCase())
    .filter(Boolean);
  const moduleDefaults = {};
  const actionDefaults = {};
  for (const cfg of Object.values(moduleConfigs)) {
    Object.assign(moduleDefaults, cfg?.defaults || {});
    Object.assign(actionDefaults, cfg?.actionDefaults || {});
  }

  ADM.DEFAULTS = {
    sbEnabled: true,
    sbUrl: "ws://127.0.0.1:8080/",
    sbPassword: "",
    obsEnabled: true,
    obsUrl: "ws://127.0.0.1:4455/",
    obsPassword: "",
    websiteApiUrl: DEFAULT_WEBSITE_API_URL,
    actionPrefix: "ADM ",
    /** Logs-Overlay: Kategorie-Chips 0=minimal (1 Strich), 1=erweitert (2 Striche), 2=aus. Checkout Guide nur bei AD-Stufe 1. */
    workerMirrorCatTiers: { AD: 0, SB: 0, OBS: 0, WLED: 0, MISC: 0 },
    uiLanguage: "de",
    accountToken: "",
    accountUserJson: "",
    installedModules,

    ...moduleDefaults,

    // Action suffix mapping (final action = prefix + suffix)
    actions: actionDefaults
  };
})(self);
