(function initLobbyFilterModuleConfig(scope) {
  const configs = scope.ADM_MODULE_CONFIGS || (scope.ADM_MODULE_CONFIGS = {});
  configs.lobbyfilter = {
    id: "lobbyfilter",
    autoInstall: true,
    defaults: {
      /** Teilstring-Suche auf Spielernamen (Lobby-Liste) */
      lobbyFilterSearchText: "",
      /** JSON-Array von Strings: wenn ein Name der Lobby einen Eintrag als Teilstring enthält → optional ausblenden */
      lobbyFilterBlacklistJson: "[]",
      /** Wenn an: Lobbys mit Blacklist-Treffer in der Liste ausblenden */
      lobbyFilterBlacklistHide: true,
      /** Wenn an: Treffer in Namen farbig markieren (nur sichtbar, wenn nicht ausgeblendet) */
      lobbyFilterBlacklistMark: true,
      /** HSL-Farbton (0–360): Akzentlinie der Lobby-Leiste; bei ausgeschaltetem Ausblenden Farbe für Blacklist-Namen */
      lobbyFilterBlacklistHue: 0,
      /** JSON-Array: Favoriten-Spielernamen (Teilstring, case-insensitive) */
      lobbyFilterFavoritesJson: "[]",
      /** Wenn an: nur Lobbys mit mindestens einem Favoriten-Treffer anzeigen (Liste nicht leer) */
      lobbyFilterFavoritesHide: false,
      /** Treffer farbig markieren (sichtbar, wenn „Ausblenden“ aus oder zusätzlich) */
      lobbyFilterFavoritesMark: true,
      /** HSL-Farbton (0–360) für Favoriten-Markierung */
      lobbyFilterFavoritesHue: 120,
      /** Leere Lobby: keine erkannten Spielernamen auf der Karte (Heuristik wie Spielerfilter) */
      lobbyFilterEmptyHide: false,
      lobbyFilterEmptyMark: false,
      lobbyFilterEmptyHue: 210,
      /** Nur Lobbys anzeigen, deren Karten-Text zum gewählten Modus passt (leer = alle) */
      lobbyFilterMode: "",
      /** Ein-/Auswurf-Paar SI-SO … MI-MO als "0-0" … "2-2"; leer = alle */
      lobbyFilterInOutPair: "",
      /** „First to N Leg(s)“ auf der Karte (1–11); leer = alle */
      lobbyFilterLegsFirstTo: "",
      /** Genau N erkannte Spieler auf der Karte (1–8); leer = alle */
      lobbyFilterPlayerCount: "",
      /** Sortierung nach erkanntem In/Out (Straight/Double/Master); inout_asc | inout_desc (Standard: aufsteigend) */
      lobbyFilterSortInOut: "inout_asc",
      /** @deprecated UI: nur noch für ältere Saves; nutze lobbyFilterPlusPlayerOnly */
      lobbyFilterPlusScope: "any",
      /** Nur Lobbys mit erkanntem Plus-Spieler (Blitz) anzeigen */
      lobbyFilterPlusPlayerOnly: false,
      /** Mindest-Durchschnitt (25–100, Schritt 5); leer = aus */
      lobbyFilterMinAvg: "",
      /** Höchst-Durchschnitt (25–100, Schritt 5); leer = aus */
      lobbyFilterMaxAvg: "",
      /** Neben „Join“: anzeigen, wie lange die Lobby schon offen ist (UUID v1 / Erstsichtung, sessionStorage) */
      lobbyFilterShowOpenAge: true
    },
    ini: {
      modulesConfigString: {
        lobbyFilterSearchText: "",
        lobbyFilterBlacklistJson: "[]",
        lobbyFilterBlacklistHide: true,
        lobbyFilterBlacklistMark: true,
        lobbyFilterBlacklistHue: 0,
        lobbyFilterFavoritesJson: "[]",
        lobbyFilterFavoritesHide: false,
        lobbyFilterFavoritesMark: true,
        lobbyFilterFavoritesHue: 120,
        lobbyFilterEmptyHide: false,
        lobbyFilterEmptyMark: false,
        lobbyFilterEmptyHue: 210,
        lobbyFilterMode: "",
        lobbyFilterInOutPair: "",
        lobbyFilterLegsFirstTo: "",
        lobbyFilterPlayerCount: "",
        lobbyFilterSortInOut: "inout_asc",
        lobbyFilterPlusScope: "any",
        lobbyFilterMinAvg: "",
        lobbyFilterMaxAvg: "",
        lobbyFilterShowOpenAge: true
      },
      togglesBool: [
        "lobbyFilterBlacklistHide",
        "lobbyFilterBlacklistMark",
        "lobbyFilterFavoritesHide",
        "lobbyFilterFavoritesMark",
        "lobbyFilterEmptyHide",
        "lobbyFilterEmptyMark",
        "lobbyFilterPlusPlayerOnly",
        "lobbyFilterShowOpenAge"
      ]
    }
  };
})(globalThis);
