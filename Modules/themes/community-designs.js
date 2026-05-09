(function initThemesCommunityDesigns(scope) {
  scope.AD_SB_WEBSITE_COMMUNITY_THEMES = [
    {
      id: "pimp-arena",
      label: "Pimp Arena",
      layout: "horizontal",
      sourceName: "Greasy Fork",
      sourceUrl: "https://greasyfork.org/en/scripts/488556-pimp-my-autodarts-caller-other-stuff-deprecated",
      author: "_seb_",
      description: "Dichteres Match-Layout mit leuchtenden Glasflaechen fuer kleinere Screens.",
      tags: ["Community", "Compact", "Neon"],
      preview: {
        bg: "linear-gradient(160deg, #0a1426 0%, #10244c 58%, #0e5a84 100%)",
        glow: "rgba(67, 225, 255, .34)",
        panel: "rgba(8, 18, 33, .78)",
        accent: "#43e1ff",
        accentSoft: "rgba(67, 225, 255, .22)"
      },
      css: `
        body{
          background:
            radial-gradient(120% 75% at 50% -10%, rgba(67,225,255,.20), transparent 48%),
            linear-gradient(160deg, #091325 0%, #10244c 55%, #0d4f75 100%) !important;
        }
        [class*="scoreboard"],[class*="player"],[class*="board"],[class*="card"],[class*="panel"],[class*="MuiPaper-root"]{
          background:linear-gradient(180deg, rgba(7,16,31,.90), rgba(11,23,43,.82)) !important;
          border:1px solid rgba(67,225,255,.20) !important;
          box-shadow:0 16px 30px rgba(0,0,0,.18), inset 0 1px 0 rgba(255,255,255,.06) !important;
        }
        [class*="turn"],[class*="dart"],[class*="visit"]{
          background:linear-gradient(180deg, rgba(67,225,255,.18), rgba(67,225,255,.08)) !important;
          border:1px solid rgba(67,225,255,.24) !important;
        }
      `
    },
    {
      id: "stream-glass",
      label: "Stream Glass",
      layout: "horizontal",
      sourceName: "Community",
      sourceUrl: "https://play.autodarts.io/",
      author: "Community",
      description: "Klare Streaming-Optik mit sauberem Kontrast und ruhigen Karten.",
      tags: ["Community", "Stream", "Glass"],
      preview: {
        bg: "linear-gradient(150deg, #10151f 0%, #1c2c3f 54%, #2f4b66 100%)",
        glow: "rgba(115, 186, 255, .26)",
        panel: "rgba(17, 25, 39, .84)",
        accent: "#73baff",
        accentSoft: "rgba(115, 186, 255, .18)"
      },
      css: `
        body{
          background:
            radial-gradient(90% 70% at 15% 0%, rgba(115,186,255,.18), transparent 46%),
            linear-gradient(150deg, #0e141e 0%, #162232 52%, #253c56 100%) !important;
        }
        [class*="scoreboard"],[class*="player"],[class*="board"],[class*="card"],[class*="panel"],[class*="MuiPaper-root"]{
          background:linear-gradient(180deg, rgba(16,24,36,.92), rgba(18,30,46,.80)) !important;
          border:1px solid rgba(164,208,255,.14) !important;
          backdrop-filter:blur(12px);
        }
        [class*="MuiButton-root"],button{
          border-radius:14px !important;
        }
        [class*="score"],[data-testid*="score"]{
          letter-spacing:.02em;
        }
      `
    },
    {
      id: "active-focus",
      label: "Active Focus",
      layout: "horizontal",
      sourceName: "Greasy Fork",
      sourceUrl: "https://greasyfork.org/en/scripts/489918-x01-active-player-score-display-for-autodarts",
      author: "dotty-dev",
      description: "Hebt die aktive Seite hart hervor und dimmt Nebeninfos fuer Score-Displays.",
      tags: ["Community", "Focus", "Scoreboard"],
      preview: {
        bg: "linear-gradient(160deg, #090c14 0%, #1b1528 52%, #36203f 100%)",
        glow: "rgba(255, 92, 163, .28)",
        panel: "rgba(20, 14, 28, .84)",
        accent: "#ff5ca3",
        accentSoft: "rgba(255, 92, 163, .18)"
      },
      css: `
        body{
          background:
            radial-gradient(100% 80% at 78% 18%, rgba(255,92,163,.18), transparent 46%),
            linear-gradient(160deg, #090c14 0%, #171321 50%, #2a1830 100%) !important;
        }
        [class*="player"],[class*="scoreboard"],[class*="board"],[class*="card"],[class*="panel"]{
          transition:opacity .12s ease, transform .12s ease;
        }
        [class*="player"]:not(.Mui-selected),[data-testid*="player"]:not(.Mui-selected){
          opacity:.72 !important;
          filter:saturate(.82);
        }
        .Mui-selected,[aria-selected="true"],[aria-current="true"],[data-selected="true"],[data-state="active"]{
          background:linear-gradient(180deg, rgba(255,92,163,.22), rgba(255,92,163,.10)) !important;
          border-color:rgba(255,92,163,.34) !important;
          box-shadow:0 0 0 1px rgba(255,92,163,.16) inset, 0 0 22px rgba(255,92,163,.12) !important;
        }
      `
    },
    {
      id: "big-match-counters",
      label: "Big Match Counters",
      layout: "horizontal",
      sourceName: "Greasy Fork",
      sourceUrl: "https://greasyfork.org/en/scripts/by-site/autodarts.io?sort=name",
      author: "MartinHH",
      description: "Inspiriert von Legs+Sets larger: mehr Gewicht auf Legs, Sets und lesbare Counter.",
      tags: ["Community", "Typography", "Counter"],
      preview: {
        bg: "linear-gradient(150deg, #0d1022 0%, #19345f 58%, #2e6bb0 100%)",
        glow: "rgba(99, 153, 255, .28)",
        panel: "rgba(9, 16, 34, .80)",
        accent: "#6399ff",
        accentSoft: "rgba(99, 153, 255, .18)"
      },
      css: `
        body{
          background:linear-gradient(150deg, #0d1022 0%, #18315a 55%, #275f9d 100%) !important;
        }
        [class*="leg"],[class*="set"],[data-testid*="leg"],[data-testid*="set"]{
          font-size:clamp(1.35rem, 2.4vw, 2.2rem) !important;
          font-weight:800 !important;
          letter-spacing:.04em !important;
          text-shadow:0 0 22px rgba(99,153,255,.28);
        }
        [class*="scoreboard"],[class*="card"],[class*="panel"],[class*="MuiPaper-root"]{
          background:linear-gradient(180deg, rgba(9,16,34,.90), rgba(14,26,50,.84)) !important;
          border:1px solid rgba(99,153,255,.16) !important;
        }
      `
    },
    {
      id: "triple-flare",
      label: "Triple Flare",
      layout: "horizontal",
      sourceName: "Greasy Fork",
      sourceUrl: "https://greasyfork.org/en/scripts/by-site/autodarts.io?sort=name",
      author: "dotty-dev / amazingjin",
      description: "Leuchtender Turn-Look mit Fokus auf Triple-, Double- und Bull-Momente.",
      tags: ["Community", "Animated", "Highlight"],
      preview: {
        bg: "linear-gradient(160deg, #120b1f 0%, #2f174c 46%, #6a1d55 100%)",
        glow: "rgba(255, 142, 74, .30)",
        panel: "rgba(23, 11, 34, .82)",
        accent: "#ff8e4a",
        accentSoft: "rgba(255, 142, 74, .18)"
      },
      css: `
        body{
          background:
            radial-gradient(90% 75% at 18% 0%, rgba(255,142,74,.18), transparent 48%),
            linear-gradient(160deg, #110b1d 0%, #2a1541 48%, #511b47 100%) !important;
        }
        [class*="dart"],[class*="turn"],[class*="visit"],[data-testid*="throw"]{
          border:1px solid rgba(255,142,74,.20) !important;
          background:linear-gradient(180deg, rgba(255,142,74,.18), rgba(255,142,74,.06)) !important;
          box-shadow:0 0 18px rgba(255,142,74,.10) !important;
        }
        [class*="letter"],[class*="segment"],svg text{
          paint-order:stroke fill;
          stroke:rgba(14,10,22,.84);
          stroke-width:.8px;
        }
      `
    },
    {
      id: "clean-broadcast",
      label: "Clean Broadcast",
      layout: "horizontal",
      sourceName: "Greasy Fork",
      sourceUrl: "https://greasyfork.org/en/scripts/by-site/autodarts.io?language=all&sort=created",
      author: "MartinHH / Community",
      description: "Ruhiger Broadcast-Look mit reduzierten Nebenwerten und klarer Score-Hierarchie.",
      tags: ["Community", "Broadcast", "Minimal"],
      preview: {
        bg: "linear-gradient(155deg, #0d1014 0%, #182029 48%, #2d3940 100%)",
        glow: "rgba(146, 255, 215, .26)",
        panel: "rgba(13, 18, 23, .84)",
        accent: "#92ffd7",
        accentSoft: "rgba(146, 255, 215, .18)"
      },
      css: `
        body{
          background:linear-gradient(155deg, #0d1014 0%, #172029 48%, #25323a 100%) !important;
        }
        [class*="avg"],[data-testid*="avg"]{
          opacity:.26 !important;
        }
        [class*="scoreboard"],[class*="player"],[class*="board"],[class*="card"],[class*="panel"]{
          background:rgba(13,18,23,.88) !important;
          border:1px solid rgba(146,255,215,.14) !important;
          box-shadow:none !important;
        }
        [class*="score"],[data-testid*="score"]{
          font-weight:800 !important;
          letter-spacing:.03em;
        }
      `
    }
  ];
  (function mergeCommunityDesignsIntoThemeSets(s) {
    try {
      const list = s.AD_SB_WEBSITE_COMMUNITY_THEMES;
      const sets = s.AD_SB_WEBSITE_THEME_SETS;
      if (!Array.isArray(list) || !sets) return;
      const existing = new Set();
      for (const key of ["horizontal", "vertical"]) {
        if (!Array.isArray(sets[key])) continue;
        for (const t of sets[key]) {
          const id = String(t?.id || "").toLowerCase();
          if (id) existing.add(id);
        }
      }
      for (const t of list) {
        const lay = String(t.layout || "horizontal").toLowerCase() === "vertical" ? "vertical" : "horizontal";
        if (!Array.isArray(sets[lay])) sets[lay] = [];
        const id = String(t.id || "").toLowerCase();
        if (id && existing.has(id)) continue;
        if (id) existing.add(id);
        sets[lay].push({ ...t, libraryOnly: true });
      }
    } catch (_) {}
  })(scope);
})(window);
