(function initProfileModuleConfig(scope) {
  const configs = scope.ADM_MODULE_CONFIGS || (scope.ADM_MODULE_CONFIGS = {});
  configs.profile = {
    id: "profile",
    autoInstall: true,
    defaults: {
      profileDisplayName: "",
      profileBio: "",
      profileRegion: "",
      profilePublicOptIn: false,
      profileLastSyncedAt: ""
    },
    ini: {
      modulesConfigString: {
        profileDisplayName: "",
        profileBio: "",
        profileRegion: "",
        profilePublicOptIn: "false",
        profileLastSyncedAt: ""
      }
    }
  };
})(globalThis);
