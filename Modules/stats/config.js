(function initStatsModuleConfig(scope) {
  const configs = scope.ADM_MODULE_CONFIGS || (scope.ADM_MODULE_CONFIGS = {});
  configs.stats = {
    id: "stats",
    autoInstall: true,
    defaults: {},
    ini: {
      togglesBool: [],
      togglesNumber: {},
      modulesConfigString: {}
    }
  };
})(globalThis);
