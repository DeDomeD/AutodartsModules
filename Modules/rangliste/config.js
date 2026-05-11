(function initRanglisteModuleConfig(scope) {
  const configs = scope.ADM_MODULE_CONFIGS || (scope.ADM_MODULE_CONFIGS = {});
  configs.rangliste = {
    id: "rangliste",
    autoInstall: true,
    defaults: {},
    ini: {
      togglesBool: [],
      togglesNumber: {},
      modulesConfigString: {}
    }
  };
})(globalThis);
