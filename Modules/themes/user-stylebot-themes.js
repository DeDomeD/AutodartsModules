(function initWebsiteUserStylebotThemes(scope) {
  scope.AD_SB_WEBSITE_USER_STYLEBOT_THEMES = [
    {
      id: "user-scolia-pro",
      label: "Scolia Pro",
      layout: "horizontal",
      sourceName: "User Stylebot",
      sourceUrl: "",
      author: "message.txt",
      description: "Echtes Stylebot-Theme mit Scolia-Look, gruenen Akzenten, Board-Ring und dunklem Match-Layout.",
      tags: ["User", "Scolia", "Dark"],
      preview: {
        bg: "linear-gradient(160deg, #1e2126 0%, #2a2d35 48%, #363940 100%)",
        glow: "rgba(74, 222, 128, .28)",
        panel: "rgba(30, 33, 38, .86)",
        accent: "#4ade80",
        accentSoft: "rgba(74, 222, 128, .18)"
      },
      css: `
        :root {
          --spacing-player: 24px;
          --player-box-width: 350px;
          --top-offset: 95px;
          --scolia-bg-primary: #2a2d35;
          --scolia-bg-secondary: #363940;
          --scolia-bg-dark: #1e2126;
          --scolia-card-bg: #363940;
          --scolia-card-hover: #3f444d;
          --scolia-accent-green: #4ade80;
          --scolia-accent-green-dark: #22c55e;
          --scolia-text-primary: #e5e7eb;
          --scolia-border: #4b5563;
          --shadow-sm: 0 2px 8px rgba(0, 0, 0, 0.4);
          --shadow-md: 0 4px 16px rgba(0, 0, 0, 0.5);
          --shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.6);
          --shadow-glow-green: 0 0 24px rgba(74, 222, 128, 0.4);
        }
        :root:not(:has(.css-rc3vw3)) .css-tkevr6 {
          position: relative;
          width: 100%;
          height: 95%;
          box-sizing: border-box;
        }
        :root:not(:has(.css-rc3vw3)) #ad-ext-player-display > div {
          position: absolute;
          width: var(--player-box-width);
          background: rgba(30, 33, 38, 0.92);
          border: 2px solid var(--scolia-border);
          border-radius: 12px;
          box-shadow: var(--shadow-md);
          overflow: hidden;
          backdrop-filter: blur(20px);
        }
        :root:not(:has(.css-rc3vw3)):root:has(.css-1cdcn26) .css-rtn29s {
          border: 2px solid var(--scolia-accent-green);
          background: linear-gradient(135deg, var(--scolia-card-bg) 0%, rgba(74, 222, 128, 0.08) 100%);
          box-shadow: var(--shadow-glow-green), var(--shadow-lg);
          transform: scale(1.02);
        }
        :root:not(:has(.css-rc3vw3)) .css-1dkgpmk,
        :root:not(:has(.css-rc3vw3)) .css-1wlduvp,
        :root:not(:has(.css-rc3vw3)) .css-sm8wdq,
        :root:not(:has(.css-rc3vw3)) .css-881tme,
        :root:not(:has(.css-rc3vw3)) #ad-ext-turn .css-rrf7rv,
        :root:not(:has(.css-rc3vw3)) #ad-ext-turn .score.css-156dsds,
        :root:not(:has(.css-rc3vw3)) #ad-ext-turn .ad-ext-turn-throw.css-1p5spmi {
          height: 90px;
          background: var(--scolia-card-bg);
          border: 2px solid var(--scolia-border);
          border-radius: 12px;
          box-shadow: var(--shadow-sm);
          color: var(--scolia-text-primary);
          font-weight: 600;
        }
        :root:has(.css-1cdcn26) body {
          background-image: url(https://de1.sportal365images.com/process/smp-bet365-images/news.bet365.com-gb/29112024/1075e215-cef9-4e65-9dba-dc70ae4c1270.jpg);
          background-repeat: no-repeat;
          background-size: cover;
          background-position: center;
          background-attachment: fixed;
          background-color: #2a2d35;
        }
        :root:has(.css-1cdcn26) .css-1cdcn26::before {
          content: '';
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: 850px;
          height: 850px;
          background-image: url(https://image2url.com/r2/default/images/1771475546593-d3b5dee2-2e74-4ace-9678-c6fe5de878fd.png);
          background-size: contain;
          background-repeat: no-repeat;
          background-position: center;
          z-index: -1;
          pointer-events: none;
          filter: drop-shadow(0 0 20px rgba(74, 222, 128, 0.3));
        }
      `
    },
    {
      id: "user-tangeza-portrait",
      label: "Tangeza Portrait",
      layout: "vertical",
      sourceName: "User Stylebot",
      sourceUrl: "",
      author: "tangezas_portrait.txt",
      description: "Echtes Portrait-Theme mit grossen Avataren, runden Boxen und gruener Aktiv-Markierung.",
      tags: ["User", "Portrait", "Bright"],
      preview: {
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
    },
    {
      id: "user-maju-v1",
      label: "Maju v1",
      layout: "horizontal",
      sourceName: "User Stylebot",
      sourceUrl: "",
      author: "Maju Template v1.txt",
      description: "Echtes User-Template mit grossen Score-Flaechen, blauem Broadcast-Look und Wallpaper.",
      tags: ["User", "Broadcast", "Blue"],
      preview: {
        bg: "linear-gradient(160deg, rgba(10,15,30,.88), rgba(17,85,204,.52))",
        glow: "rgba(17, 85, 204, .30)",
        panel: "rgba(10, 15, 30, .84)",
        accent: "#1155cc",
        accentSoft: "rgba(17, 85, 204, .18)"
      },
      css: `
        :root {
          --color-bg-main: rgba(10, 15, 30, 0.5);
          --color-bg-box: rgba(10, 15, 30, 0.75);
          --color-border: #ffffff;
          --color-text: #ffffff;
          --color-shadow: 0 0 10px #1155cc;
          --color-shadow-strong: 0 0 25px #1155cc;
          --player-top-offset: 100px;
          --player-side-offset: 20px;
          --player-width: 450px;
          --score-width: 850px;
          --score-height: 150px;
          --wallpaper-url: url(https://i.ibb.co/jvzX7CCW/upload.jpg);
        }
        :root:not(:has(.css-rc3vw3)) .css-rtn29s,
        :root:not(:has(.css-rc3vw3)) .css-hjw8x4 {
          width: var(--player-width);
          background: var(--color-bg-box);
          color: var(--color-text);
          border: 10px solid var(--color-border);
          box-shadow: var(--color-shadow);
        }
        :root:not(:has(.css-rc3vw3)) .css-rtn29s {
          background: #1155cc;
        }
        :root:not(:has(.css-rc3vw3)) .css-1r7jzhg {
          font-size: 150px;
          font-weight: 700;
          text-shadow: var(--color-shadow);
        }
        :root:not(:has(.css-rc3vw3)) #ad-ext-turn .score.css-156dsds,
        :root:not(:has(.css-rc3vw3)) #ad-ext-turn .ad-ext-turn-throw.css-1p5spmi {
          font-size: 100px;
          font-weight: bold;
          background: var(--color-bg-box);
          color: var(--color-text);
          border: 2px solid var(--color-border);
          box-shadow: var(--color-shadow);
        }
        p.chakra-text.ad-ext-player-score.css-1r7jzhg,
        span.css-143thu1,
        span.css-3fr5p8,
        span.chakra-badge.css-n2903v {
          background-color: #1155cc;
          color: #ffffff;
        }
        :root:has(.css-1cdcn26) body,
        :root:not(:has(.css-1cdcn26)) body {
          background-image: var(--wallpaper-url);
          background-repeat: no-repeat;
          background-position: center;
          background-size: cover;
        }
      `
    },
    {
      id: "user-template-gold",
      label: "Template Gold",
      layout: "horizontal",
      sourceName: "User Stylebot",
      sourceUrl: "",
      author: "Template 17.02.2026.txt",
      description: "Echtes Template mit goldener Aktivfarbe, klaren Panels und reduzierter Menue-Optik.",
      tags: ["User", "Gold", "Clean"],
      preview: {
        bg: "linear-gradient(160deg, rgba(10,15,30,.88), rgba(255,170,0,.34))",
        glow: "rgba(255, 170, 0, .26)",
        panel: "rgba(10, 15, 30, .84)",
        accent: "#ffaa00",
        accentSoft: "rgba(255, 170, 0, .18)"
      },
      css: `
        :root {
          --color-bg-main: rgba(10, 15, 30, 0.5);
          --color-bg-box: rgba(10, 15, 30, 0.75);
          --color-border: #ffffff;
          --color-border-active: #ffaa00;
          --color-text: #ffffff;
          --color-text-soft: #ffffff;
          --color-shadow: 0 0 10px rgba(255, 170, 0, 0.5);
          --color-shadow-strong: 0 0 25px rgba(255, 170, 0, 0.8);
          --player-top-offset: 200px;
          --player-side-offset: 60px;
          --player-width: 350px;
        }
        :root:not(:has(.css-rc3vw3)) .css-rtn29s,
        :root:not(:has(.css-rc3vw3)) .css-hjw8x4 {
          background: var(--color-bg-box);
          color: var(--color-text);
          border: 2px solid var(--color-border);
          box-shadow: var(--color-shadow);
        }
        :root:not(:has(.css-rc3vw3)) .css-rtn29s {
          border-color: var(--color-border-active);
        }
        :root:not(:has(.css-rc3vw3)) #ad-ext-turn .css-rrf7rv,
        :root:not(:has(.css-rc3vw3)) #ad-ext-turn .score.css-156dsds,
        :root:not(:has(.css-rc3vw3)) #ad-ext-turn .ad-ext-turn-throw.css-1p5spmi {
          background: var(--color-bg-box);
          color: var(--color-text);
          border: 2px solid var(--color-border);
          border-radius: 10px;
          box-shadow: var(--color-shadow);
        }
        span.css-143thu1 {
          background-color: rgba(35, 45, 65, 0.95);
        }
        span.css-3fr5p8 {
          background-color: rgba(155, 120, 0, 0.95);
        }
      `
    }
  ];
})(window);
