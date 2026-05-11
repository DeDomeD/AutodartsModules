(function initThemesHorizontalConfig(scope) {
  const sets = scope.ADM_WEBSITE_THEME_SETS || (scope.ADM_WEBSITE_THEME_SETS = {});
  sets.horizontal = [
    {
      id: "classic",
      label: "Classic",
      preview: {
        bg: "linear-gradient(180deg, #2f3f8d 0%, #2c5fad 55%, #245aa3 100%)",
        panel: "rgba(23,35,86,.78)",
        accent: "#7ec8ff",
        accentSoft: "rgba(126,200,255,.18)",
        glow: "rgba(126,200,255,.22)"
      },
      css: `
        body{
          background:linear-gradient(180deg, #2f3f8d 0%, #2c5fad 55%, #245aa3 100%) !important;
        }
        [class*="card"],[class*="panel"],[class*="MuiPaper-root"]{
          background:linear-gradient(180deg, rgba(255,255,255,.08), rgba(255,255,255,.03)) !important;
          border:1px solid rgba(255,255,255,.08) !important;
        }
      `
    },
    {
      id: "hue",
      label: "HUE",
      preview: {
        bg: "linear-gradient(135deg, #142032 0%, #163450 50%, #17351d 100%)",
        panel: "rgba(20,30,45,.78)",
        accent: "#5be3ff",
        accentSoft: "rgba(91,227,255,.18)",
        glow: "rgba(91,227,255,.22)"
      },
      css: `
        body{
          background:
            radial-gradient(120% 75% at 0% 50%, hsl(var(--adm-arena-primary-h) 92% 55% / .18), transparent 50%),
            radial-gradient(120% 75% at 100% 50%, hsl(var(--adm-arena-secondary-h) 88% 52% / .16), transparent 52%),
            linear-gradient(180deg, hsl(var(--adm-arena-primary-h) 34% 12%) 0%, hsl(var(--adm-arena-tertiary-h) 36% 13%) 52%, hsl(var(--adm-arena-primary-h) 38% 8%) 100%) !important;
        }
        [class*="turn"],[class*="dart"]{
          background:linear-gradient(
            180deg,
            hsl(var(--adm-arena-primary-h) 34% 24% / .95),
            hsl(var(--adm-arena-primary-h) 32% 18% / .95)
          ) !important;
          border:1px solid hsl(var(--adm-arena-secondary-h) 70% 62% / .26) !important;
          color:#eef4ff !important;
        }
        [class*="score"],[data-testid*="score"]{
          background:transparent !important;
          border:none !important;
          box-shadow:none !important;
        }
      `
    },
    {
      id: "minimal",
      label: "Dark",
      preview: {
        bg: "linear-gradient(180deg, #0b0f15 0%, #121821 100%)",
        panel: "rgba(17,24,39,.86)",
        accent: "#d6e4ff",
        accentSoft: "rgba(214,228,255,.12)",
        glow: "rgba(214,228,255,.16)"
      },
      css: `
        body{
          background:#0b0f15 !important;
        }
        [class*="card"],[class*="panel"]{
          background:#111827 !important;
          border:1px solid rgba(255,255,255,.1) !important;
          box-shadow:none !important;
        }
        [class*="score"],[data-testid*="score"]{
          background:transparent !important;
          border:none !important;
          box-shadow:none !important;
        }
      `
    }
  ];
})(globalThis);
