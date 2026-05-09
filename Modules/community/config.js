(function initCommunityModuleConfig(scope) {
  const configs = scope.ADM_MODULE_CONFIGS || (scope.ADM_MODULE_CONFIGS = {});
  configs.community = {
    id: "community",
    autoInstall: true,
    defaults: {
      communityWebsiteUploadsJson: "[]",
      communityWebsitePushQueueJson: "[]"
    },
    ini: {
      modulesConfigString: {
        communityWebsiteUploadsJson: "[]",
        communityWebsitePushQueueJson: "[]"
      }
    }
  };
})(globalThis);
