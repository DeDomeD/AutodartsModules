(function initObsZoomModuleConfig(scope) {
  const configs = scope.ADM_MODULE_CONFIGS || (scope.ADM_MODULE_CONFIGS = {});
  configs.obszoom = {
    id: "obszoom",
    defaults: {
      obsZoomSource: "Game Capture",
      obsZoomSceneName: "",
      obsZoomTargetSource: "",
      obsZoomDurationMs: 450,
      obsZoomStrength: 150,
      /** Zoom-% für Kalibrierung (100 = aktuelle OBS-Skalierung der Quelle). */
      obsZoomCalibZoomPercent: 100,
      /** JSON: Record<filterName, { nx, ny }> — Legacy; Canvas-Modus nutzt obsZoomCalibCanvasPointJson. */
      obsZoomCalibPointsJson: "{}",
      /** JSON: { nx, ny } | {} — Klick auf Programm-Canvas (0–1). */
      obsZoomCalibCanvasPointJson: "{}",
      /** JSON: Board-Kalibrierung { fitted, cx, cy, R, rot } — 0–1 / rad; R = Radius bis Triple-Ring; rot = Zusatzrotation. */
      obsZoomBoardCalibJson: "{}",
      obsZoomEffectsJson: "[]",
      checkoutTriggerThreshold: 170,
      obsZoomMoveEasingType: 3,
      obsZoomMoveEasingFunction: 2,
      obsZoomIncludeSingles: true,
      obsZoomIncludeDoubles: true,
      obsZoomIncludeTriples: true,
      obsZoomLastTestTrigger: "T20",
      obsZoomPlayerFilterMode: "all",
      obsZoomPlayerNamesList: "",
      /** Bull-Off-Start → Move-Filter BULL; normales X01-Game-ON → MAIN (ganzes Board). */
      obsZoomBullOffZoom: false,
      /** Vor Checkout (Rest vor Wurf > checkoutTriggerThreshold): immer Triple-20; ohne T20/T19 stattdessen MAIN. */
      obsZoomStickyTriple20: false,
      /** Wie obsZoomStickyTriple20, aber Triple-19. Nur einer wirkt — T20 hat Vorrang. */
      obsZoomStickyTriple19: false,
      /** Kalibrier-Vorschau: true = Screenshot der Ziel-Quelle (voll), false = Programm-Canvas (PGM). */
      obsZoomCalibPreviewFromSource: false
    },
    actionDefaults: {
      checkout: "Checkout"
    },
    ini: {
      togglesBool: [
        "obsZoomIncludeSingles",
        "obsZoomIncludeDoubles",
        "obsZoomIncludeTriples",
        "obsZoomCalibPreviewFromSource",
        "obsZoomBullOffZoom",
        "obsZoomStickyTriple20",
        "obsZoomStickyTriple19"
      ],
      togglesNumber: {
        obsZoomDurationMs: 450,
        obsZoomStrength: 150,
        obsZoomCalibZoomPercent: 100,
        checkoutTriggerThreshold: 170,
        obsZoomMoveEasingType: 3,
        obsZoomMoveEasingFunction: 2
      },
      modulesConfigString: {
        obsZoomSource: "Game Capture",
        obsZoomSceneName: "",
        obsZoomTargetSource: "",
        obsZoomEffectsJson: "[]",
        obsZoomCalibPointsJson: "{}",
        obsZoomCalibCanvasPointJson: "{}",
        obsZoomBoardCalibJson: "{}",
        obsZoomPlayerFilterMode: "all",
        obsZoomPlayerNamesList: ""
      }
    }
  };
})(globalThis);
