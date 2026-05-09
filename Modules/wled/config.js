(function initWledModuleConfig(scope) {
  const configs = scope.ADM_MODULE_CONFIGS || (scope.ADM_MODULE_CONFIGS = {});
  configs.wled = {
    id: "wled",
    defaults: {
      wledControllersJson: "[{\"id\":\"ctrl_1\",\"name\":\"\",\"endpoint\":\"http://127.0.0.1\"}]",
      wledEffectsJson: "[]",
      wledMatrixShowScores: false,
      wledMatrixShowPlayerTurn: false,
      wledMatrixPlayer0Url: "",
      wledMatrixPlayer1Url: "",
      wledMatrixMinIntervalMs: 400,
      wledMatrixArrowMs: 600,
      wledMatrixOutput: "pixelit",
      wledMatrixWledControllerId0: "",
      wledMatrixWledControllerId1: "",
      wledMatrixWledSegmentId: 0,
      wledMatrixWledWidth: 16,
      wledMatrixWledHeight: 16,
      wledMatrixWledSerpentine: false,
      wledMatrixWledFgHex: "#FFFFFF",
      wledMatrixWledArrowHex: "#00E5FF"
    },
    ini: {
      modulesConfigString: {
        wledControllersJson: "[{\"id\":\"ctrl_1\",\"name\":\"\",\"endpoint\":\"http://127.0.0.1\"}]",
        wledEffectsJson: "[]",
        wledMatrixShowScores: false,
        wledMatrixShowPlayerTurn: false,
        wledMatrixPlayer0Url: "",
        wledMatrixPlayer1Url: "",
        wledMatrixMinIntervalMs: 400,
        wledMatrixArrowMs: 600,
        wledMatrixOutput: "pixelit",
        wledMatrixWledControllerId0: "",
        wledMatrixWledControllerId1: "",
        wledMatrixWledSegmentId: 0,
        wledMatrixWledWidth: 16,
        wledMatrixWledHeight: 16,
        wledMatrixWledSerpentine: false,
        wledMatrixWledFgHex: "#FFFFFF",
        wledMatrixWledArrowHex: "#00E5FF"
      }
    }
  };
})(globalThis);
