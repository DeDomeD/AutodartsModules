(function initThemesVerticalConfig(scope) {
  const sets = scope.ADM_WEBSITE_THEME_SETS || (scope.ADM_WEBSITE_THEME_SETS = {});
  sets.vertical = [
    {
      id: "stack",
      label: "Stack",
      preview: {
        bg: "linear-gradient(180deg, #1f2b54 0%, #2e4e89 52%, #2f6aaa 100%)",
        panel: "rgba(25,39,75,.82)",
        accent: "#9fd0ff",
        accentSoft: "rgba(159,208,255,.18)",
        glow: "rgba(159,208,255,.2)"
      },
      css: `
        body{
          background:linear-gradient(180deg, #1f2b54 0%, #2e4e89 52%, #2f6aaa 100%) !important;
        }
        [class*="player"],[class*="score"],[class*="scoreboard"],[class*="board"]{
          border-radius:12px !important;
        }
      `
    },
    {
      id: "focus",
      label: "Focus",
      preview: {
        bg: "linear-gradient(180deg, #101827 0%, #0f1e33 100%)",
        panel: "rgba(20,34,56,.88)",
        accent: "#5dc4ff",
        accentSoft: "rgba(93,196,255,.18)",
        glow: "rgba(93,196,255,.22)"
      },
      css: `
        body{
          background:
            radial-gradient(140% 70% at 50% -10%, rgba(26,185,255,.2), transparent 55%),
            linear-gradient(180deg, #101827 0%, #0f1e33 100%) !important;
        }
        [class*="player"],[class*="score"],[class*="scoreboard"]{
          background:linear-gradient(180deg, rgba(20,34,56,.94), rgba(16,28,45,.92)) !important;
          border:1px solid rgba(93,196,255,.24) !important;
        }
      `
    },
    {
      id: "slate",
      label: "Slate",
      preview: {
        bg: "linear-gradient(180deg, #202737 0%, #2a3247 45%, #38415b 100%)",
        panel: "rgba(28,34,49,.86)",
        accent: "#c7d2e7",
        accentSoft: "rgba(199,210,231,.16)",
        glow: "rgba(199,210,231,.18)"
      },
      css: `
        body{
          background:linear-gradient(180deg, #202737 0%, #2a3247 45%, #38415b 100%) !important;
        }
        [class*="card"],[class*="panel"],[class*="MuiPaper-root"]{
          background:rgba(8,12,20,.42) !important;
          border:1px solid rgba(255,255,255,.11) !important;
        }
      `
    },
    {
      id: "vertical-scores",
      label: "Vertikal Scores",
      libraryOnly: true,
      sourceName: "ADM Themes",
      author: "Codex",
      description: "Erster Nachbau eines roten Score-Layouts mit seitlichen Score-Panels und Farbsteuerung.",
      tags: ["Vertical", "Scores", "WIP"],
      preview: {
        bg: "linear-gradient(180deg, #2a0000 0%, #590000 58%, #2a0000 100%)",
        panel: "rgba(86, 8, 8, .84)",
        accent: "#ff4d4d",
        accentSoft: "rgba(255, 77, 77, .20)",
        glow: "rgba(255, 60, 60, .34)"
      },
      css: `
        :root {
          --color-bg-main: linear-gradient(135deg, hsl(var(--adm-arena-primary-h) 82% 12%), hsl(var(--adm-arena-tertiary-h) 70% 16%));
          --color-bg-box: linear-gradient(145deg, hsl(var(--adm-arena-primary-h) 62% 18%), hsl(var(--adm-arena-tertiary-h) 58% 22%));
          --color-border: hsl(var(--adm-arena-secondary-h) 96% 72%);
          --color-text: #ffecec;
          --color-text-soft: hsl(var(--adm-arena-secondary-h) 100% 86%);
          --color-shadow: 0 0 10px hsl(var(--adm-arena-secondary-h) 96% 58%);
          --color-shadow-strong: 0 0 20px hsl(var(--adm-arena-tertiary-h) 95% 58%);
          --font-main: 'Montserrat', sans-serif;
          --spacing-player: 20px;
        }

        :root:not(:has(.css-rc3vw3)) .css-tkevr6 {
          position: relative;
          width: 100%;
          height: 100%;
          padding: 10px;
          box-sizing: border-box;
          background: var(--color-bg-main);
          color: var(--color-text);
          font-family: var(--font-main);
        }

        :root:not(:has(.css-rc3vw3)) .css-rtn29s,
        :root:not(:has(.css-rc3vw3)) .css-hjw8x4 {
          background: var(--color-bg-box);
          color: var(--color-text);
          padding: 1rem;
          box-sizing: border-box;
          border: 2px solid var(--color-border);
          box-shadow: 0 0 20px var(--color-shadow);
          transition: all 0.3s ease;
          border-radius: 12px;
          z-index: 10;
          position: absolute;
          width: 400px;
          height: calc((100% - 180px) / 2);
        }

        :root:not(:has(.css-rc3vw3)) .css-rtn29s:hover,
        :root:not(:has(.css-rc3vw3)) .css-hjw8x4:hover {
          box-shadow: 0 0 35px var(--color-shadow-strong);
          transform: scale(1.03);
          cursor: pointer;
        }

        :root:not(:has(.css-rc3vw3)) #ad-ext-player-display > div:nth-child(1),
        :root:not(:has(.css-rc3vw3)) #ad-ext-player-display > div:nth-child(2),
        :root:not(:has(.css-rc3vw3)) #ad-ext-player-display > div:nth-child(5),
        :root:not(:has(.css-rc3vw3)) #ad-ext-player-display > div:nth-child(6),
        :root:not(:has(.css-rc3vw3)) #ad-ext-player-display > div:nth-child(9),
        :root:not(:has(.css-rc3vw3)) #ad-ext-player-display > div:nth-child(10) {
          top: 90px;
        }

        :root:not(:has(.css-rc3vw3)) #ad-ext-player-display > div:nth-child(3),
        :root:not(:has(.css-rc3vw3)) #ad-ext-player-display > div:nth-child(4),
        :root:not(:has(.css-rc3vw3)) #ad-ext-player-display > div:nth-child(7),
        :root:not(:has(.css-rc3vw3)) #ad-ext-player-display > div:nth-child(8) {
          top: calc(90px + ((100% - 180px) / 2) + var(--spacing-player));
        }

        :root:not(:has(.css-rc3vw3)) #ad-ext-player-display > div:nth-child(odd) {
          left: 60px;
        }

        :root:not(:has(.css-rc3vw3)) #ad-ext-player-display > div:nth-child(even) {
          right: 60px;
        }

        :root:not(:has(.css-rc3vw3)) #ad-ext-player-display > div:nth-child(1):nth-last-child(1),
        :root:not(:has(.css-rc3vw3)) #ad-ext-player-display > div:nth-child(1):nth-last-child(2),
        :root:not(:has(.css-rc3vw3)) #ad-ext-player-display > div:nth-child(2):nth-last-child(1) {
          top: 90px;
          height: calc(100% - 180px);
        }

        :root:not(:has(.css-rc3vw3)) #ad-ext-player-display > div:nth-child(1):nth-last-child(2) {
          left: 60px;
        }

        :root:not(:has(.css-rc3vw3)) #ad-ext-player-display > div:nth-child(2):nth-last-child(1) {
          right: 60px;
        }

        :root:not(:has(.css-rc3vw3)) .css-1cdcn26 {
          margin: 0 auto;
          transform: scale(0.95);
          background-color: transparent;
          color: var(--color-text);
        }

        :root:not(:has(.css-rc3vw3)) .css-y3hfdd {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: flex-start;
          gap: 0.5rem;
          width: 100%;
          height: 100%;
          padding: 1rem 0.75rem 0.75rem;
          background-color: transparent;
          color: var(--color-text);
          position: relative;
        }

        :root:not(:has(.css-rc3vw3)) .css-elma0c {
          font-size: 80px;
          text-align: center;
          color: var(--color-border);
          text-shadow: 0 0 20px var(--color-shadow);
        }

        :root:not(:has(.css-rc3vw3)) .css-1j0bqop {
          order: 1;
          font-size: 24px;
          margin-bottom: 0.9rem;
          text-align: center;
          color: var(--color-text-soft);
        }

        :root:not(:has(.css-rc3vw3)) .css-1r7jzhg {
          order: 2;
          font-size: 132px;
          text-align: center;
          color: var(--color-text);
          text-shadow: 0 0 25px var(--color-shadow);
          line-height: 1;
          margin-top: 1.6rem;
          margin-bottom: 15.5rem;
        }

        :root:not(:has(.css-rc3vw3)) #ad-ext-player-display:has(> div:nth-child(2):nth-last-child(1)) .css-1u90hiz,
        :root:not(:has(.css-rc3vw3)) #ad-ext-player-display:has(> div:only-child) .css-1u90hiz {
          position: absolute !important;
          left: 50% !important;
          right: auto !important;
          top: auto !important;
          bottom: 26px !important;
          transform: translateX(-50%) !important;
          width: min(84%, 245px) !important;
          height: 46% !important;
          max-height: 470px !important;
          margin: 0 !important;
          padding: 0 !important;
          box-shadow: none !important;
          overflow: visible !important;
          z-index: 3 !important;
        }

        :root:not(:has(.css-rc3vw3)) #ad-ext-player-display:has(> div:nth-child(2):nth-last-child(1)) .css-1u90hiz tbody tr td,
        :root:not(:has(.css-rc3vw3)) #ad-ext-player-display:has(> div:only-child) .css-1u90hiz tbody tr td {
          font-size: 2.25rem !important;
          line-height: 1.12 !important;
        }

        :root:not(:has(.css-rc3vw3)) .css-ege71s {
          background: var(--color-bg-main);
          color: var(--color-text);
        }

        :root:not(:has(.css-rc3vw3)) #ad-ext-turn .css-rrf7rv,
        :root:not(:has(.css-rc3vw3)) #ad-ext-turn .score.css-156dsds,
        :root:not(:has(.css-rc3vw3)) #ad-ext-turn .ad-ext-turn-throw.css-1p5spmi {
          background: var(--color-bg-box);
          color: var(--color-text);
          height: 120px;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0.5rem 1rem;
          border: 2px solid var(--color-border);
          box-shadow: 0 0 20px var(--color-shadow);
          text-shadow: 0 0 15px var(--color-shadow);
          transition: all 0.3s ease;
          margin-bottom: 1rem;
          border-radius: 10px;
        }

        :root:not(:has(.css-rc3vw3)) #ad-ext-turn .css-rrf7rv {
          font-size: 32px;
        }

        :root:not(:has(.css-rc3vw3)) #ad-ext-turn .score.css-156dsds,
        :root:not(:has(.css-rc3vw3)) #ad-ext-turn .ad-ext-turn-throw.css-1p5spmi {
          font-size: 100px;
          font-weight: bold;
        }

        :root:not(:has(.css-rc3vw3)) #ad-ext-turn .css-rrf7rv:hover,
        :root:not(:has(.css-rc3vw3)) #ad-ext-turn .score.css-156dsds:hover,
        :root:not(:has(.css-rc3vw3)) #ad-ext-turn .ad-ext-turn-throw.css-1p5spmi:hover {
          box-shadow: 0 0 35px var(--color-shadow-strong);
          transform: scale(1.03);
          cursor: pointer;
        }
      `
    }
  ];
})(globalThis);
