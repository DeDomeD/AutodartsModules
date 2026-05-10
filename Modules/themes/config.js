(function initThemesModuleConfig(scope) {
  const configs = scope.ADM_MODULE_CONFIGS || (scope.ADM_MODULE_CONFIGS = {});
  configs.themes = {
    id: "themes",
    defaults: {
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
      /**
       * Zusätzliche Builder-Ziele: JSON-Array
       * [{"key":"header-wrap","label":"Header","selector":"#app > div > header"}]
       * key: nur a-z, 0-9, Bindestrich; selector: gültiger document.querySelector-String
       */
      websiteThemeBuilderTargets: "[]",
      /** data:-URL (JPEG), leer = kein eigenes Hintergrundbild */
      websiteBackgroundImageData: "",
      /** data:-URL (JPEG) nur Match-Seite */
      websiteBackgroundImageDataMatch: "",
      /** data:-URL (JPEG) nur Menü-/Nicht-Match-Seiten */
      websiteBackgroundImageDataMenu: "",
      /** cover | contain | auto */
      websiteBackgroundSize: "cover",
      /** true = linke Seitenleiste auf play.autodarts.io zunächst eingeklappt (ohne vorherigen Klick am Umschalter) */
      websiteHideLeftMenuByDefault: true,
      /**
       * true = Stylebot-Paketliste von tobyleif.com/autodarts beim Öffnen der Galerie (gedrosselt) bzw. manuell „↻“ neu laden.
       * Katalog-URLs der Reihe nach: adm-autodarts-catalog.json, catalog.json — sonst eingebettete Liste.
       */
      websiteThemeTobyleifAutoUpdate: false,
      /** JSON-Array [{ file, layout, name }] nach erfolgreichem Remote-Katalog; leer = nur eingebettete Liste */
      websiteThemeTobyleifCatalogRemoteJson: "",
      /** JSON { lastCheckMs, lastCatalogRefreshMs, pingOk, lastError, catalogUrl, catalogCount } */
      websiteThemeTobyleifCatalogMetaJson: "{}",
      /**
       * JSON `Record<themeId, { ref: string, sig: string }>` — Live-Galerie-Screenshot (Match-Seite) pro Tobyleif-Pack;
       * `sig` = SHA-1 (hex) der rohen Stylebot-JSON-Textantwort, damit bei geändertem Pack neu gerendert wird.
       */
      websiteThemeTobyleifLiveThumbByIdJson: "{}"
    },
    ini: {
      togglesBool: [
        "websiteThemeBuilderEnabled",
        "websiteDartboardGlowEnabled",
        "websiteHideLeftMenuByDefault",
        "websiteThemeTobyleifAutoUpdate"
      ],
      togglesNumber: {
        websiteArenaPrimaryHue: 210,
        websiteArenaSecondaryHue: 155,
        websiteArenaTertiaryHue: 125
      },
      modulesConfigString: {
        websiteLayout: "horizontal",
        websiteTheme: "classic",
        websiteThemeBuilderData: "{}",
        websiteCustomThemesHorizontal: "[]",
        websiteCustomThemesVertical: "[]",
        websiteCommunityFavorites: "[]",
        websiteThemeBuilderTargets: "[]",
        websiteBackgroundImageData: "",
        websiteBackgroundImageDataMatch: "",
        websiteBackgroundImageDataMenu: "",
        websiteBackgroundSize: "cover",
        websiteThemeTobyleifCatalogRemoteJson: "",
        websiteThemeTobyleifCatalogMetaJson: "{}",
        websiteThemeTobyleifLiveThumbByIdJson: "{}"
      }
    }
  };
})(globalThis);
