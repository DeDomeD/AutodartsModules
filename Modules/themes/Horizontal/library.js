(function initThemesHorizontalLibrary(scope) {
  const sets = scope.AD_SB_WEBSITE_THEME_SETS || (scope.AD_SB_WEBSITE_THEME_SETS = {});
  const base = Array.isArray(sets.horizontal) ? sets.horizontal.slice() : [];
  const extra = [
    {
      id: "user-scolia-pro",
      label: "Scolia Pro",
      libraryOnly: true,
      sourceName: "User Stylebot",
      author: "message.txt",
      description: "Scolia-Look mit gruenen Highlights, dunklen Glasflaechen und Board-Ring.",
      tags: ["User", "Scolia", "Dark"],
      preview: {
        kind: "user-scolia-pro",
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
          --scolia-card-bg: #363940;
          --scolia-accent-green: #4ade80;
          --scolia-text-primary: #e5e7eb;
          --scolia-border: #4b5563;
          --shadow-sm: 0 2px 8px rgba(0, 0, 0, 0.4);
          --shadow-md: 0 4px 16px rgba(0, 0, 0, 0.5);
          --shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.6);
          --shadow-glow-green: 0 0 24px rgba(74, 222, 128, 0.4);
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
          background: var(--scolia-card-bg);
          border: 2px solid var(--scolia-border);
          border-radius: 12px;
          box-shadow: var(--shadow-sm);
          color: var(--scolia-text-primary);
        }
        :root:has(.css-1cdcn26) body {
          background-image: url(https://de1.sportal365images.com/process/smp-bet365-images/news.bet365.com-gb/29112024/1075e215-cef9-4e65-9dba-dc70ae4c1270.jpg);
          background-repeat: no-repeat;
          background-size: cover;
          background-position: center;
          background-attachment: fixed;
          background-color: #2a2d35;
        }
      `
    },
    {
      id: "user-maju-v1",
      label: "Maju v1",
      libraryOnly: true,
      sourceName: "User Stylebot",
      author: "Maju Template v1.txt",
      description: "Blauer Broadcast-Look mit grossen Counter-Flaechen und Wallpaper.",
      tags: ["User", "Broadcast", "Blue"],
      preview: {
        kind: "user-maju-v1",
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
          --player-top-offset: 100px;
          --player-side-offset: 20px;
          --player-width: 450px;
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
      libraryOnly: true,
      sourceName: "User Stylebot",
      author: "Template 17.02.2026.txt",
      description: "Goldener Aktiv-Look mit klaren Panels und reduzierter Menue-Optik.",
      tags: ["User", "Gold", "Clean"],
      preview: {
        kind: "user-template-gold",
        bg: "linear-gradient(160deg, rgba(10,15,30,.88), rgba(255,170,0,.34))",
        glow: "rgba(255, 170, 0, .26)",
        panel: "rgba(10, 15, 30, .84)",
        accent: "#ffaa00",
        accentSoft: "rgba(255, 170, 0, .18)"
      },
      css: `
        :root {
          --color-bg-box: rgba(10, 15, 30, 0.75);
          --color-border: #ffffff;
          --color-border-active: #ffaa00;
          --color-text: #ffffff;
          --color-shadow: 0 0 10px rgba(255, 170, 0, 0.5);
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
  sets.horizontal = [...base, ...extra];
})(globalThis);
