/**
 * Stylebot-JSON-Pakete unter https://tobyleif.com/autodarts/
 * Einträge mit „alt“ im Dateinamen oder Anzeigenamen werden ausgelassen (alte/abgelöste Varianten).
 *
 * Optionaler Live-Katalog (Themes-Modul, Auto-Update): dieselbe Basis-URL mit
 * `adm-autodarts-catalog.json` oder `catalog.json` — JSON-Array wie diese Liste
 * `[{ "file": "…json", "layout": "horizontal"|"vertical", "name": "…" }, …]`.
 */
(function initTobyleifStylebotCatalog(scope) {
  /**
   * Optional `thumb`: feste Galerie-Vorschau (tobyleif.com), falls JSON-Fetch/CSS-Parsing scheitert.
   * Optional `preview`: CSS-Variablen-Swatch für die Karte (`bg`, `panel`, `accent`, …).
   * Remote-Katalog (`adm-autodarts-catalog.json`) kann dieselben Felder mitschicken — `module.js` merged sie.
   */
  const allRows = [
    { file: "autodartsblau.json", layout: "horizontal", name: "Blau" },
    { file: "autodartsbronze.json", layout: "horizontal", name: "Bronze" },
    { file: "autodartsclean.json", layout: "horizontal", name: "Clean" },
    { file: "autodartscyan.json", layout: "horizontal", name: "Cyan" },
    { file: "autodartsgrafikblau.json", layout: "horizontal", name: "Grafik Blau" },
    { file: "autodartsgrafikblauvert.json", layout: "vertical", name: "Grafik Blau (Vertikal)" },
    { file: "autodartsgrafikbraun.json", layout: "horizontal", name: "Grafik Braun" },
    { file: "autodartsgrafikbraunvert.json", layout: "vertical", name: "Grafik Braun (Vertikal)" },
    { file: "autodartsgrafikbulls.json", layout: "horizontal", name: "Grafik Bulls" },
    { file: "autodartsgrafikbullsvert.json", layout: "vertical", name: "Grafik Bulls (Vertikal)" },
    { file: "autodartsgrafikgruen.json", layout: "horizontal", name: "Grafik Grün" },
    { file: "autodartsgrafikgruenvert.json", layout: "vertical", name: "Grafik Grün (Vertikal)" },
    { file: "autodartsgrafiklila.json", layout: "horizontal", name: "Grafik Lila" },
    { file: "autodartsgrafiklilavert.json", layout: "vertical", name: "Grafik Lila (Vertikal)" },
    { file: "autodartsgrafikrotweiss.json", layout: "horizontal", name: "Grafik Rot-Weiß" },
    { file: "autodartsgrafikrotweissvert.json", layout: "vertical", name: "Grafik Rot-Weiß (Vertikal)" },
    { file: "autodartsgrafiksw.json", layout: "horizontal", name: "Grafik SW" },
    { file: "autodartsgrafikswvert.json", layout: "vertical", name: "Grafik SW (Vertikal)" },
    { file: "autodartspremier.json", layout: "horizontal", name: "Premier" },
    { file: "autodartspremiervert.json", layout: "vertical", name: "Premier (Vertikal)" },
    { file: "autodartsschwarz.json", layout: "horizontal", name: "Schwarz" },
    { file: "autodartsschwarzvert.json", layout: "vertical", name: "Schwarz (Vertikal)" },
    {
      file: "autodartsweiss.json",
      layout: "horizontal",
      name: "Weiß",
      thumb: "https://tobyleif.com/images/WhiteSquares.jpg",
      preview: {
        bg: "linear-gradient(135deg, #eef2f7 0%, #d8e0ea 50%, #c5d0de 100%)",
        panel: "rgba(248, 250, 252, 0.82)",
        accent: "#1e293b",
        accentSoft: "rgba(30, 41, 59, 0.18)",
        glow: "rgba(255, 255, 255, 0.45)"
      }
    },
    {
      file: "autodartsweissvert.json",
      layout: "vertical",
      name: "Weiß (Vertikal)",
      thumb: "https://tobyleif.com/images/WhiteSquares.jpg",
      preview: {
        bg: "linear-gradient(135deg, #eef2f7 0%, #d8e0ea 50%, #c5d0de 100%)",
        panel: "rgba(248, 250, 252, 0.82)",
        accent: "#1e293b",
        accentSoft: "rgba(30, 41, 59, 0.18)",
        glow: "rgba(255, 255, 255, 0.45)"
      }
    },
    { file: "autodartswm.json", layout: "horizontal", name: "WM" },
    { file: "autodartswmvert.json", layout: "vertical", name: "WM (Vertikal)" }
  ];

  function rowHasAltInLabel(row) {
    const hay = `${String(row?.file || "")} ${String(row?.name || "")}`.toLowerCase();
    return hay.includes("alt");
  }

  scope.ADM_TOBYLEIF_STYLEBOT_BASE = "https://tobyleif.com/autodarts/";
  scope.ADM_TOBYLEIF_STYLEBOT_CATALOG = allRows.filter((r) => !rowHasAltInLabel(r));
})(window);
