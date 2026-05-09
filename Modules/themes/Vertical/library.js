(function initThemesVerticalLibrary(scope) {
  const sets = scope.AD_SB_WEBSITE_THEME_SETS || (scope.AD_SB_WEBSITE_THEME_SETS = {});
  const base = Array.isArray(sets.vertical) ? sets.vertical.slice() : [];
  const extra = [
    {
      id: "user-tangeza-portrait",
      label: "Tangeza Portrait",
      libraryOnly: true,
      sourceName: "User Stylebot",
      author: "tangezas_portrait.txt",
      description: "Portrait-Theme mit grossen Avataren, runden Panels und gruener Aktiv-Markierung.",
      tags: ["User", "Portrait", "Bright"],
      preview: {
        kind: "user-tangeza-portrait",
        bg: "linear-gradient(180deg, rgba(12,43,91,.95), rgba(0,255,0,.30))",
        glow: "rgba(0, 255, 0, .28)",
        panel: "rgba(7, 21, 44, .84)",
        accent: "#00ff00",
        accentSoft: "rgba(0, 255, 0, .18)"
      },
      css: `
        :root{
          --theme-bg:#001f52;
          --theme-player-badge-bg:#e69138;
          --theme-text-abort-color:#e57b7b;
        }
        :root:not(:has(.css-rc3vw3)):root:has(.css-1cdcn26) div.css-nfhdnc {
          background-color: var(--theme-bg);
        }
        :root:not(:has(.css-rc3vw3)) #ad-ext-player-display > div,
        :root:not(:has(.css-rc3vw3)) .css-1dkgpmk,
        :root:not(:has(.css-rc3vw3)) .css-1sinmig,
        :root:not(:has(.css-rc3vw3)) .css-1wlduvp,
        :root:not(:has(.css-rc3vw3)) .css-sm8wdq,
        :root:not(:has(.css-rc3vw3)) .css-881tme,
        :root:not(:has(.css-rc3vw3)) .css-1tv7rud,
        :root:not(:has(.css-rc3vw3)) #ad-ext-turn .css-rrf7rv,
        :root:not(:has(.css-rc3vw3)) #ad-ext-turn .score.css-156dsds,
        :root:not(:has(.css-rc3vw3)) #ad-ext-turn .ad-ext-turn-throw.css-1p5spmi {
          border-radius: 20px;
        }
        :root:not(:has(.css-rc3vw3)):root:has(.css-1cdcn26) .css-rtn29s {
          border: none;
          background-color: rgba(0,255,0,0.5);
        }
        :root:not(:has(.css-rc3vw3)):root:has(.css-1cdcn26) .css-156dsds {
          border-color: #00ff00;
        }
        :root:not(:has(.css-rc3vw3)):root:has(.css-1cdcn26) div.css-rysx5v {
          background: linear-gradient(180deg, rgba(12,43,91,0.9), rgba(0,255,0,0.35));
        }
        :root:not(:has(.css-rc3vw3)):root:has(.css-1cdcn26):root:not(:has(#ad-ext-player-display > div:nth-child(3))) .chakra-avatar{
          --avatar-size: 7rem;
        }
      `
    }
  ];
  sets.vertical = [...base, ...extra];
})(globalThis);
