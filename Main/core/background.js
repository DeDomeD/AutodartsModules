/**
 * Service-Worker Bootstrap
 * - erstellt den globalen Namespace `ADM`
 * - lädt alle Module (Settings, Effects, Overlay, Routing)
 * - startet danach die Initialisierung über `ADM.init()`
 *
 * Vibecoded by DeDomeD — Urheber; nicht als eigenes/fremdes Produkt verkaufen oder umbenennen.
 */

self.ADM = self.ADM || {};

const extUrl = (path) => chrome.runtime.getURL(path);

if (chrome?.sidePanel?.setPanelBehavior) {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
}

importScripts(
  extUrl("Modules/effects/config.js"),
  extUrl("Modules/wled/config.js"),
  extUrl("Modules/obszoom/config.js"),
  extUrl("Modules/lobbyfilter/config.js"),
  extUrl("Modules/stats/config.js"),
  extUrl("Modules/themes/config.js"),
  extUrl("Modules/community/config.js"),
  extUrl("Main/settings/defaults.js"),
  extUrl("Main/settings/store.js"),
  extUrl("Main/core/logger.js"),
  extUrl("Main/core/worker-mirror-log.js"),
  extUrl("Main/core/worker-status-log.js"),
  extUrl("Main/core/data-capture.js"),
  extUrl("Main/core/gallery-thumb-store.js"),
  extUrl("Main/bridge/adm-trigger-foundation.js"),
  extUrl("Main/bridge/adm-throw-visit-tracker.js"),
  extUrl("Main/bridge/adm-trigger-worker.js"),
  extUrl("Main/bridge/adm-trigger-sources.js"),
  extUrl("Main/bridge/adm-trigger-engine.js"),
  extUrl("Modules/wled/engine.js"),
  extUrl("Main/core/sb-client.js"),
  extUrl("Main/core/obs-client.js"),
  extUrl("Modules/obszoom/engine.js"),
  extUrl("Main/core/messages.js")
);

(async () => {
  try {
    await self.ADM.init();
  } catch (error) {
    console.error(
      "[ADM] Bei der Extension ist ein Fehler aufgetreten. Fehlerlog: Debug Logs (Einstellungen).",
      error
    );
  }
})();
