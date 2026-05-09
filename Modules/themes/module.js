(function initThemesModule(scope) {
  scope.ADM_MODULES = scope.ADM_MODULES || {};
  let COMMUNITY_GALLERY_OPEN = false;
  let HUE_MODAL_OPEN = false;
  /** Built-in Horizontal-Themes, die in „Alle Themes durchsuchen“ + Favoriten-Leiste wie HUE/Dark erscheinen. */
  const CATALOG_GALLERY_HORIZONTAL_IDS = new Set(["hue", "minimal", "mrjames-ad-template"]);

  /** Snapshot aus `tobyleif-stylebot-catalog.js` (bevor ein Remote-Katalog `ADM_TOBYLEIF_STYLEBOT_CATALOG` überschreibt). */
  const ADM_TOBYLEIF_EMBEDDED_CATALOG_SNAPSHOT = (() => {
    const c = globalThis.ADM_TOBYLEIF_STYLEBOT_CATALOG;
    return Array.isArray(c) ? c.map((r) => ({ ...r })) : [];
  })();

  let tobyleifGalleryAutoRefreshTimer = null;
  const TOBY_CATALOG_MIN_REFRESH_MS = 6 * 60 * 60 * 1000;
  /** Mindestabstand für Katalog-Fetch beim Öffnen des Panels (sichtbar), damit nicht gespammt wird. */
  const TOBY_CATALOG_ON_OPEN_MIN_MS = 45 * 1000;
  const GALLERY_NEW_MS = 7 * 24 * 60 * 60 * 1000;
  const GALLERY_UPDATED_MS = 3 * 24 * 60 * 60 * 1000;
  /** Preset-Galerie: „Neu“-Fenster ab diesem Zeitpunkt (UTC), z. B. wenn ein Built-in neu in die Galerie kam. */
  const GALLERY_BUILTIN_INTRO_MS = {
    "mrjames-ad-template": Date.UTC(2026, 4, 9)
  };
  let tobyPanelVisibleHookBound = false;
  let tobyLastOnOpenRefreshMs = 0;

  function rowHasAltInTobyleifCatalog(row) {
    const hay = `${String(row?.file || "")} ${String(row?.name || "")}`.toLowerCase();
    return hay.includes("alt");
  }

  /** Klammer-Inhalte am Namensende entfernen; „(Vertikal)“/„(Horizontal)“ → layout aus Klammer, falls eindeutig. */
  function stripTrailingParentheticalNameParts(displayName) {
    let n = String(displayName || "").trim();
    const innerTexts = [];
    const re = /\s*\(([^)]*)\)\s*$/;
    let m;
    while ((m = n.match(re))) {
      innerTexts.push(m[1]);
      n = n.replace(re, "").trim();
    }
    return { baseName: n, innerTexts };
  }

  function normParenInner(inner) {
    return String(inner || "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/\p{M}/gu, "");
  }

  function parentheticalChunkSuggestsVertical(inner) {
    const t = normParenInner(inner);
    return /\bvertikal\b/.test(t) || /\bvertical\b/.test(t);
  }

  function parentheticalChunkSuggestsHorizontal(inner) {
    const t = normParenInner(inner);
    return /\bhorizontal\b/.test(t) || /\bwaagerecht\b/.test(t) || /\blandscape\b/.test(t);
  }

  /** `innerTexts[0]` = rechte Klammer in der ursprünglichen Zeichenkette — dort zuerst Layout-Hinweise werten. */
  function layoutOverrideFromParentheticalHints(innerTexts) {
    if (!innerTexts.length) return null;
    for (let i = 0; i < innerTexts.length; i += 1) {
      const inner = innerTexts[i];
      const v = parentheticalChunkSuggestsVertical(inner);
      const h = parentheticalChunkSuggestsHorizontal(inner);
      if (v && !h) return "vertical";
      if (h && !v) return "horizontal";
    }
    const anyV = innerTexts.some(parentheticalChunkSuggestsVertical);
    const anyH = innerTexts.some(parentheticalChunkSuggestsHorizontal);
    if (anyV && !anyH) return "vertical";
    if (anyH && !anyV) return "horizontal";
    return null;
  }

  function normalizeTobyleifCatalogRowNameAndLayout(nameRaw, layout) {
    let layoutOut = String(layout || "horizontal").toLowerCase() === "vertical" ? "vertical" : "horizontal";
    const { baseName, innerTexts } = stripTrailingParentheticalNameParts(nameRaw);
    const hint = layoutOverrideFromParentheticalHints(innerTexts);
    if (hint) layoutOut = hint;
    return { name: baseName, layout: layoutOut };
  }

  function normalizeTobyleifCatalogRows(raw) {
    if (!Array.isArray(raw)) return [];
    const out = [];
    for (const x of raw) {
      if (!x || typeof x !== "object") continue;
      const file = String(x.file || "").trim();
      if (!file || !/\.json$/i.test(file)) continue;
      let layout = String(x.layout || "horizontal").toLowerCase() === "vertical" ? "vertical" : "horizontal";
      const nameRaw = String(x.name || "").trim() || file.replace(/\.json$/i, "");
      const adj = normalizeTobyleifCatalogRowNameAndLayout(nameRaw, layout);
      layout = adj.layout;
      const name = String(adj.name || "").trim() || file.replace(/\.json$/i, "");
      const row = { file, layout, name };
      if (rowHasAltInTobyleifCatalog(row)) continue;
      out.push(row);
    }
    return out;
  }

  function parseTobyleifCatalogMeta(settings) {
    try {
      const raw = String(settings?.websiteThemeTobyleifCatalogMetaJson || "{}");
      const o = JSON.parse(raw);
      return o && typeof o === "object" ? o : {};
    } catch {
      return {};
    }
  }

  function getEmbeddedTobyleifCatalogRowsNormalized() {
    return normalizeTobyleifCatalogRows(ADM_TOBYLEIF_EMBEDDED_CATALOG_SNAPSHOT);
  }

  function getEffectiveTobyleifCatalogRows(settings) {
    const st = settings || {};
    try {
      const raw = String(st.websiteThemeTobyleifCatalogRemoteJson || "").trim();
      if (!raw) return getEmbeddedTobyleifCatalogRowsNormalized();
      const arr = JSON.parse(raw);
      const rows = normalizeTobyleifCatalogRows(arr);
      return rows.length ? rows : getEmbeddedTobyleifCatalogRowsNormalized();
    } catch {
      return getEmbeddedTobyleifCatalogRowsNormalized();
    }
  }

  function hydrateTobyleifCatalogFromSettings(settings) {
    const rows = getEffectiveTobyleifCatalogRows(settings);
    try {
      globalThis.ADM_TOBYLEIF_STYLEBOT_CATALOG = rows;
    } catch {}
  }

  async function pingTobyleifStylebotOrigin(settings) {
    const st = settings || {};
    const base = String(globalThis.ADM_TOBYLEIF_STYLEBOT_BASE || "https://tobyleif.com/autodarts/").replace(/\/?$/, "/");
    const rows = getEffectiveTobyleifCatalogRows(st);
    const probeFile = String(rows[0]?.file || "autodartsblau.json").trim() || "autodartsblau.json";
    const url = /^https?:\/\//i.test(probeFile) ? probeFile : `${base}${probeFile.replace(/^\//, "")}`;
    try {
      const r = await fetch(url, { method: "GET", credentials: "omit", cache: "no-store" });
      return { ok: r.ok, status: r.status, url };
    } catch (e) {
      return { ok: false, status: 0, url, error: String(e?.message || e || "fetch") };
    }
  }

  async function fetchRemoteTobyleifCatalogJson(settings) {
    const base = String(globalThis.ADM_TOBYLEIF_STYLEBOT_BASE || "https://tobyleif.com/autodarts/").replace(/\/?$/, "/");
    const candidates = [`${base}adm-autodarts-catalog.json`, `${base}catalog.json`];
    let lastErr = "";
    for (const url of candidates) {
      try {
        const r = await fetch(url, { credentials: "omit", cache: "no-store" });
        if (!r.ok) {
          lastErr = `HTTP ${r.status}`;
          continue;
        }
        const json = await r.json();
        const arr = Array.isArray(json) ? json : Array.isArray(json?.entries) ? json.entries : null;
        if (!arr) {
          lastErr = "bad_json_shape";
          continue;
        }
        const rows = normalizeTobyleifCatalogRows(arr);
        if (!rows.length) {
          lastErr = "empty_catalog";
          continue;
        }
        return { ok: true, rows, catalogUrl: url };
      } catch (e) {
        lastErr = String(e?.message || e || "fetch");
      }
    }
    return { ok: false, rows: null, catalogUrl: "", error: lastErr || "unreachable" };
  }

  function catalogRowsFromStoredOrEmbedded(settings) {
    const st = settings || {};
    const raw = String(st.websiteThemeTobyleifCatalogRemoteJson || "").trim();
    if (!raw) return getEmbeddedTobyleifCatalogRowsNormalized();
    try {
      const arr = JSON.parse(raw);
      const rows = normalizeTobyleifCatalogRows(arr);
      return rows.length ? rows : getEmbeddedTobyleifCatalogRowsNormalized();
    } catch {
      return getEmbeddedTobyleifCatalogRowsNormalized();
    }
  }

  /** Dateiname aus Katalog (`foo.json` oder volle Pack-URL) — stabile Gallery-IDs auch bei absoluten URLs. */
  function tobyleifCatalogFileBasename(file) {
    const f = String(file || "").trim();
    if (!f) return "";
    if (/^https?:\/\//i.test(f)) {
      try {
        const path = new URL(f).pathname || "";
        const seg = path.split("/").filter(Boolean).pop() || "";
        return /\.json$/i.test(seg) ? seg : f;
      } catch {
        return f;
      }
    }
    const parts = f.split(/[/\\]/);
    return parts[parts.length - 1] || f;
  }

  function tobyleifRowGalleryId(row) {
    const file = String(row?.file || "").trim();
    const baseName = tobyleifCatalogFileBasename(file) || file;
    const slug = baseName
      .replace(/\.json$/i, "")
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "pack";
    return `tobyleif-${slug}`;
  }

  function tobyleifRowSignature(row) {
    return JSON.stringify({
      f: String(row?.file || "").toLowerCase(),
      n: String(row?.name || ""),
      l: String(row?.layout || "").toLowerCase()
    });
  }

  function parseGalleryBadgeState(settings) {
    try {
      const raw = String(settings?.websiteThemeGalleryBadgeStateJson || "{}").trim();
      const o = JSON.parse(raw);
      if (!o || typeof o !== "object") return { byId: {} };
      const byId = o.byId && typeof o.byId === "object" ? o.byId : {};
      return { byId: { ...byId } };
    } catch {
      return { byId: {} };
    }
  }

  function mergeTobyleifCatalogBadgeState(prevState, prevRows, newRows, nowMs) {
    const out = { byId: { ...(prevState?.byId || {}) } };
    const prevById = new Map();
    for (const r of prevRows || []) {
      const id = tobyleifRowGalleryId(r);
      prevById.set(id, tobyleifRowSignature(r));
    }
    for (const r of newRows || []) {
      const id = tobyleifRowGalleryId(r);
      const sig = tobyleifRowSignature(r);
      const prevSig = prevById.get(id);
      const cur = out.byId[id] && typeof out.byId[id] === "object" ? { ...out.byId[id] } : {};
      if (prevSig == null) {
        out.byId[id] = { firstSeenMs: nowMs, lastSig: sig };
        continue;
      }
      if (prevSig !== sig) {
        out.byId[id] = {
          ...cur,
          firstSeenMs: Number.isFinite(Number(cur.firstSeenMs)) ? Number(cur.firstSeenMs) : nowMs,
          lastSig: sig,
          updatedUntilMs: nowMs + GALLERY_UPDATED_MS
        };
      } else {
        out.byId[id] = { ...cur, lastSig: sig };
      }
    }
    return out;
  }

  function computeThemeGalleryBadges(theme, nowMs, settings) {
    const st = settings || {};
    const id = String(theme?.id || "").toLowerCase();
    const showUpdated = (until) => Number.isFinite(Number(until)) && nowMs < Number(until);
    const showNewFrom = (firstMs) => Number.isFinite(Number(firstMs)) && nowMs < Number(firstMs) + GALLERY_NEW_MS;

    if (theme?.catalogPreset) {
      const intro = Number(theme.galleryIntroMs) || GALLERY_BUILTIN_INTRO_MS[id] || 0;
      if (intro > 0 && showNewFrom(intro)) {
        return { showNew: true, showUpdated: false };
      }
      return { showNew: false, showUpdated: false };
    }

    if (theme?.localSaved) {
      const updatedUntil = Number(theme.galleryUpdatedAt || 0) + GALLERY_UPDATED_MS;
      if (Number(theme.galleryUpdatedAt) > 0 && nowMs < updatedUntil) {
        return { showNew: false, showUpdated: true };
      }
      const savedAt = Number(theme.savedAt || 0);
      if (savedAt > 0 && nowMs < savedAt + GALLERY_NEW_MS) {
        return { showNew: true, showUpdated: false };
      }
      return { showNew: false, showUpdated: false };
    }

    if (isTobyleifStylebotGalleryTheme(theme) && theme?.stylebotImport && !theme.localSaved) {
      const rec = parseGalleryBadgeState(st).byId[id];
      if (rec && showUpdated(rec.updatedUntilMs)) {
        return { showNew: false, showUpdated: true };
      }
      if (rec && showNewFrom(rec.firstSeenMs) && !showUpdated(rec.updatedUntilMs)) {
        return { showNew: true, showUpdated: false };
      }
    }

    return { showNew: false, showUpdated: false };
  }

  /** Neu/Update wie Layout-Pill (Horizontal/Vertikal), darunter in einer eigenen Zeile. */
  function galleryLayoutStatusRowHtml(settings, theme, opts) {
    const st = settings || {};
    const inMeta = !!(opts && opts.inMeta);
    const b = computeThemeGalleryBadges(theme, Date.now(), st);
    const pillCls = `communityGalleryLayoutPill${inMeta ? " communityGalleryLayoutPill--inMeta" : ""}`;
    const pills = [];
    if (b.showUpdated) {
      pills.push(`<span class="${pillCls}">${escapeHtml(tr(st, "Update", "Updated"))}</span>`);
    } else if (b.showNew) {
      pills.push(`<span class="${pillCls}">${escapeHtml(tr(st, "Neu", "New"))}</span>`);
    }
    if (!pills.length) return "";
    const rowCls = inMeta
      ? "communityGalleryLayoutPillRow communityGalleryLayoutPillRow--inMeta"
      : "communityGalleryLayoutPillRow";
    return `<div class="${rowCls}">${pills.join("")}</div>`;
  }

  function ensureTobyleifCatalogRefreshOnPanelVisible(api, root) {
    if (tobyPanelVisibleHookBound) return;
    tobyPanelVisibleHookBound = true;
    const run = () => {
      try {
        if (document.visibilityState !== "visible") return;
        const now = Date.now();
        if (now - tobyLastOnOpenRefreshMs < TOBY_CATALOG_ON_OPEN_MIN_MS) return;
        tobyLastOnOpenRefreshMs = now;
        void (async () => {
          try {
            await runTobyleifCatalogRefresh(api, api.getSettings?.() || {}, { repaintRoot: true, apiRoot: root });
          } catch {}
        })();
      } catch {}
    };
    document.addEventListener("visibilitychange", run);
    window.addEventListener("pageshow", run);
    requestAnimationFrame(run);
  }

  async function runTobyleifCatalogRefresh(api, settings, opts) {
    const st = settings || {};
    const now = Date.now();
    const prevMeta = parseTobyleifCatalogMeta(st);
    const prevRows = catalogRowsFromStoredOrEmbedded(st);
    const prevBadge = parseGalleryBadgeState(st);
    const ping = await pingTobyleifStylebotOrigin(st);
    const remote = await fetchRemoteTobyleifCatalogJson(st);
    const meta = {
      ...prevMeta,
      lastCheckMs: now,
      pingOk: !!ping.ok,
      pingUrl: ping.url || "",
      pingStatus: ping.status || 0,
      lastError: ""
    };
    const patch = { websiteThemeTobyleifCatalogMetaJson: "" };
    if (remote.ok && remote.rows?.length) {
      meta.lastCatalogRefreshMs = now;
      meta.catalogUrl = remote.catalogUrl || "";
      meta.catalogCount = remote.rows.length;
      meta.lastError = "";
      const nextBadge = mergeTobyleifCatalogBadgeState(prevBadge, prevRows, remote.rows, now);
      patch.websiteThemeTobyleifCatalogRemoteJson = JSON.stringify(remote.rows);
      patch.websiteThemeTobyleifCatalogMetaJson = JSON.stringify(meta);
      patch.websiteThemeGalleryBadgeStateJson = JSON.stringify(nextBadge);
      await api.savePartial(patch);
      hydrateTobyleifCatalogFromSettings({ ...st, ...patch });
      clearStylebotPackFetchCaches();
    } else {
      meta.lastError = remote.ok ? "empty" : String(remote.error || "catalog");
      patch.websiteThemeTobyleifCatalogMetaJson = JSON.stringify(meta);
      await api.savePartial(patch);
      hydrateTobyleifCatalogFromSettings({ ...st, ...patch });
    }
    if (opts && opts.repaintRoot && opts.apiRoot) {
      paint(opts.apiRoot, api.getSettings?.() || {});
    }
    return { ping, remote, meta };
  }

  function maybeTobyleifAutoRefreshOnGalleryOpen(api, settings, root) {
    if (!settings?.websiteThemeTobyleifAutoUpdate) return;
    const meta = parseTobyleifCatalogMeta(settings);
    const last = Number(meta.lastCatalogRefreshMs) || 0;
    if (last && Date.now() - last < TOBY_CATALOG_MIN_REFRESH_MS) return;
    if (tobyleifGalleryAutoRefreshTimer) {
      try {
        clearTimeout(tobyleifGalleryAutoRefreshTimer);
      } catch {}
      tobyleifGalleryAutoRefreshTimer = null;
    }
    tobyleifGalleryAutoRefreshTimer = setTimeout(() => {
      tobyleifGalleryAutoRefreshTimer = null;
      void (async () => {
        try {
          await runTobyleifCatalogRefresh(api, api.getSettings?.() || settings, { repaintRoot: true, apiRoot: root });
        } catch {}
      })();
    }, 400);
  }

  function getThemeSets() {
    const fallback = {
      horizontal: [{ id: "classic", label: "Classic" }],
      vertical: [{ id: "stack", label: "Stack" }]
    };
    const src = scope.ADM_WEBSITE_THEME_SETS || fallback;
    return {
      horizontal: Array.isArray(src.horizontal) && src.horizontal.length ? src.horizontal : fallback.horizontal,
      vertical: Array.isArray(src.vertical) && src.vertical.length ? src.vertical : fallback.vertical
    };
  }

  function parseCustomThemes(raw, storageListLayout) {
    try {
      const arr = JSON.parse(String(raw || "[]"));
      if (!Array.isArray(arr)) return [];
      return arr
        .filter((x) => x && typeof x === "object")
        .map((x) => {
          const resolvedLayout =
            storageListLayout != null
              ? normalizeLayout(
                  x.layout != null && String(x.layout).trim() !== "" ? x.layout : storageListLayout
                )
              : normalizeLayout(x.layout != null && String(x.layout).trim() !== "" ? x.layout : "horizontal");
          const tagSource = Array.isArray(x.tags) ? x.tags.map((t) => String(t || "").trim()).filter(Boolean) : [];
          return {
            id: String(x.id || "").toLowerCase(),
            label: String(x.label || x.name || "").trim() || "Custom",
            css: String(x.css || ""),
            layout: resolvedLayout,
            builderData: (x.builderData && typeof x.builderData === "object") ? x.builderData : {},
            sourceName: String(x.sourceName || ""),
            sourceUrl: String(x.sourceUrl || ""),
            stylebotPackUrl: String(x.stylebotPackUrl || "").trim(),
            author: String(x.author || ""),
            description: String(x.description || ""),
            tags: normalizeThemeTagsWithLayout(resolvedLayout, tagSource),
            preview: x.preview && typeof x.preview === "object" ? x.preview : undefined,
            backgroundImageDataMatch: String(x.backgroundImageDataMatch || "").trim(),
            backgroundSize: String(x.backgroundSize || "").trim(),
            arenaPrimaryHue: Number.isFinite(Number(x.arenaPrimaryHue)) ? Number(x.arenaPrimaryHue) : undefined,
            arenaSecondaryHue: Number.isFinite(Number(x.arenaSecondaryHue)) ? Number(x.arenaSecondaryHue) : undefined,
            arenaTertiaryHue: Number.isFinite(Number(x.arenaTertiaryHue)) ? Number(x.arenaTertiaryHue) : undefined,
            savedAt: Number.isFinite(Number(x.savedAt)) ? Number(x.savedAt) : 0,
            galleryUpdatedAt: Number.isFinite(Number(x.galleryUpdatedAt)) ? Number(x.galleryUpdatedAt) : 0,
            galleryScreenshot: String(x.galleryScreenshot || "").trim(),
            galleryScreenshotRef: String(x.galleryScreenshotRef || "").trim(),
            stylebotImport: !!x.stylebotImport,
            playAutodartsIo:
              x["play.autodarts.io"] && typeof x["play.autodarts.io"] === "object"
                ? x["play.autodarts.io"]
                : x.playAutodartsIo && typeof x.playAutodartsIo === "object"
                  ? x.playAutodartsIo
                  : undefined
          };
        })
        .filter((x) => !!x.id);
    } catch {
      return [];
    }
  }

  function getAllThemesForLayout(layout, settings) {
    const base = getThemeSets()[layout] || [];
    const customRaw = layout === "vertical"
      ? settings?.websiteCustomThemesVertical
      : settings?.websiteCustomThemesHorizontal;
    const custom = parseCustomThemes(customRaw, layout);
    const out = [...base, ...custom];
    const used = new Set();
    return out.filter((t) => {
      const id = String(t?.id || "").toLowerCase();
      if (!id || used.has(id)) return false;
      used.add(id);
      return true;
    });
  }

  function getCustomThemesForLayout(layout, settings) {
    const customRaw = layout === "vertical"
      ? settings?.websiteCustomThemesVertical
      : settings?.websiteCustomThemesHorizontal;
    return parseCustomThemes(customRaw, layout);
  }

  function normalizeLayout(raw) {
    return String(raw || "").toLowerCase() === "vertical" ? "vertical" : "horizontal";
  }

  /** Erkennt Layout-Schlagworte in Tags (DE/EN), damit sie nicht doppelt vorkommen. */
  function isThemeLayoutTagToken(s) {
    const lo = String(s || "")
      .trim()
      .toLowerCase()
      .normalize("NFKD")
      .replace(/\p{M}/gu, "");
    return (
      lo === "horizontal" ||
      lo === "vertical" ||
      lo === "horizont" ||
      lo === "vertikal" ||
      lo === "landscape" ||
      lo === "waagerecht" ||
      lo === "hochformat" ||
      lo === "portrait"
    );
  }

  /** Einheitliches Layout-Tag wie in der Galerie (Pill / Suche). */
  function layoutDisplayTagForTheme(layout) {
    return normalizeLayout(layout) === "vertical" ? "Vertical" : "Horizontal";
  }

  /** Immer genau ein Horizontal/Vertical-Tag vorne, Rest ohne Layout-Duplikate. */
  function normalizeThemeTagsWithLayout(layout, tags) {
    const pill = layoutDisplayTagForTheme(layout);
    const raw = Array.isArray(tags) ? tags.map((t) => String(t || "").trim()).filter(Boolean) : [];
    const rest = raw.filter((t) => !isThemeLayoutTagToken(t) && String(t).trim() !== pill);
    return [pill, ...rest];
  }

  function normalizeTheme(layout, rawTheme, settings) {
    const themes = getAllThemesForLayout(layout, settings);
    let wanted = String(rawTheme || "").toLowerCase();
    if (wanted === "arena") wanted = "hue";
    if (wanted === "tools-glass") wanted = "stream-glass";
    if (themes.some((t) => t.id === wanted)) return wanted;
    return themes[0]?.id || "";
  }

  function themeSupportsColorPopup(layout, theme) {
    const normalizedLayout = normalizeLayout(layout);
    const normalizedTheme = String(theme || "").toLowerCase();
    return (normalizedLayout === "horizontal" && normalizedTheme === "hue")
      || (normalizedLayout === "vertical" && normalizedTheme === "vertical-scores");
  }

  function normalizeHue(raw, fallback) {
    const n = Number(raw);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(0, Math.min(360, Math.round(n)));
  }

  function tr(settings, keyDe, keyEn) {
    return String(settings?.uiLanguage || "de").toLowerCase().startsWith("de") ? keyDe : keyEn;
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/"/g, "&quot;");
  }

  /** Eigene Theme-Builder-Layouts (gespeichert, kein importiertes Stylebot-Paket). */
  function isUserBuilderGalleryTheme(theme) {
    return !!(theme && theme.localSaved && !theme.stylebotImport && !theme.catalogPreset);
  }

  function isTobyleifStylebotGalleryTheme(theme) {
    if (!theme) return false;
    if (theme.stylebotImport) return true;
    const id = String(theme.id || "").toLowerCase();
    if (id.startsWith("tobyleif-")) return true;
    if (String(theme.author || "").toLowerCase() === "tobyleif") return true;
    if (String(theme.sourceName || "").toLowerCase() === "tobyleif") return true;
    const tags = theme.tags;
    if (Array.isArray(tags) && tags.some((t) => String(t || "").toLowerCase().includes("stylebot"))) return true;
    return false;
  }

  function galleryCreatorDisplayName(settings, theme) {
    if (isTobyleifStylebotGalleryTheme(theme)) return "tobyleif";
    if (theme?.catalogPreset) {
      if (String(theme.id || "").toLowerCase() === "mrjames-ad-template") return "MrJames";
      return "DeDomeD";
    }
    const a = String(theme?.author || "").trim();
    if (a && (!theme.localSaved || a.toLowerCase() !== "lokal")) return a;
    try {
      const uj = String(settings?.accountUserJson || "").trim();
      if (uj) {
        const u = JSON.parse(uj);
        const n = String(u?.name || u?.username || u?.displayName || u?.nick || u?.email || "").trim();
        if (n) return n;
      }
    } catch {}
    if (theme.localSaved) return tr(settings, "lokal", "local");
    return String(theme?.sourceName || "Community").trim() || "Community";
  }

  function galleryCardMetaHtml(settings, theme) {
    const st = settings || {};
    const title = escapeHtml(String(theme.label || "").trim() || theme.id);
    const creator = escapeHtml(galleryCreatorDisplayName(st, theme));
    const by = escapeHtml(tr(st, "Von", "by"));
    const layoutPill = !theme.localSaved
      ? `<div class="communityGalleryLayoutPill">${theme.layout === "vertical" ? "Vertical" : "Horizontal"}</div>`
      : "";
    const statusRow = galleryLayoutStatusRowHtml(st, theme, { inMeta: false });
    return `
      <div class="communityGalleryCardHead">
        <div class="communityGalleryCardTitle">${title}</div>
        <div class="communityGalleryCardByline"><span class="communityGalleryByPrefix">${by}</span> <span class="communityGalleryByName">${creator}</span></div>
        ${layoutPill}
        ${statusRow}
      </div>
    `;
  }

  /** Nur für lokale Builder-Themes: Titel + Urheber oben links im Vorschaubild (kein Block darunter). */
  function galleryLocalInImageMetaHtml(settings, theme, options) {
    const st = settings || {};
    const opts = options || {};
    const title = escapeHtml(String(theme.label || "").trim() || theme.id);
    const creator = escapeHtml(galleryCreatorDisplayName(st, theme));
    const by = escapeHtml(tr(st, "Von", "by"));
    const layoutPill = opts.withLayoutPill
      ? `<div class="communityGalleryLayoutPill communityGalleryLayoutPill--inMeta">${theme.layout === "vertical" ? "Vertical" : "Horizontal"}</div>`
      : "";
    const statusRow = galleryLayoutStatusRowHtml(st, theme, { inMeta: true });
    const builderBadge = isUserBuilderGalleryTheme(theme)
      ? `<div class="communityLocalInImageBuilderBadge" aria-hidden="true">${escapeHtml(tr(st, "Builder", "Builder"))}</div>`
      : "";
    return `
      <div class="communityLocalInImageMeta">
        <div class="communityLocalInImageTitle">${title}</div>
        <div class="communityLocalInImageByline"><span class="communityGalleryByPrefix">${by}</span> <span class="communityGalleryByName">${creator}</span></div>
        ${layoutPill}
        ${statusRow}
      </div>
      ${builderBadge}
    `;
  }

  function isGalleryCompactCard(theme) {
    return !!(theme && (theme.catalogPreset || theme.stylebotImport));
  }

  /** Erste http(s)-URL aus CSS `url(...)` für Stylebot-Pack-Vorschau (Hintergrund aus JSON-CSS). */
  function extractFirstHttpBackgroundUrlFromCss(cssText) {
    const s = String(cssText || "");
    const re = /\burl\s*\(\s*['"]?([^'")]+)['"]?\s*\)/gi;
    let m;
    while ((m = re.exec(s)) !== null) {
      let u = String(m[1] || "").trim();
      if (u.startsWith("//")) u = `https:${u}`;
      if (/^https?:\/\//i.test(u)) return u;
    }
    return "";
  }

  const stylebotCssBgPreviewCache = new Map();
  const stylebotPackFetchInflight = new Map();

  function clearStylebotPackFetchCaches() {
    try {
      stylebotCssBgPreviewCache.clear();
      stylebotPackFetchInflight.clear();
    } catch {}
  }

  function resolveStylebotPackJsonUrl(theme) {
    if (!theme) return "";
    const direct = String(theme.stylebotPackUrl || "").trim();
    if (direct) return direct;
    const src = String(theme.sourceUrl || "").trim();
    if (!src || !/\.json(\?|$)/i.test(src)) return "";
    const id = String(theme.id || "").toLowerCase();
    if (id.startsWith("tobyleif-")) return src;
    const sn = String(theme.sourceName || "").toLowerCase();
    const au = String(theme.author || "").toLowerCase();
    if (sn === "tobyleif" || au === "tobyleif") return src;
    const tags = theme.tags;
    if (Array.isArray(tags) && tags.some((t) => String(t || "").toLowerCase().includes("stylebot"))) return src;
    return "";
  }

  /** Stylebot-Exporte von tobyleif.com: klassisch `play.autodarts.io`-Objekt; neuere JSONs können Top-Level-`css` oder andere Host-Keys nutzen. */
  function extractStylebotPackFromRootJson(json) {
    const empty = { css: "", playIo: null, layoutFromJson: "" };
    if (!json || typeof json !== "object") return empty;

    const layoutNorm = (raw) => {
      const s = String(raw || "")
        .trim()
        .toLowerCase()
        .normalize("NFKD")
        .replace(/\p{M}/gu, "");
      if (!s) return "";
      if (/\bvertical\b/.test(s) || /\bvertikal\b/.test(s) || /\bportrait\b/.test(s) || /\bhochformat\b/.test(s)) {
        return "vertical";
      }
      if (/\bhorizontal\b/.test(s) || /\bwaagerecht\b/.test(s) || /\blandscape\b/.test(s)) return "horizontal";
      return "";
    };

    const tryHostObject = (pack) => {
      if (!pack || typeof pack !== "object") return null;
      const css = String(pack.css || "").trim();
      if (!css) return null;
      return {
        css,
        playIo: pack,
        layoutFromJson: layoutNorm(pack.layout || pack.orientation)
      };
    };

    if (typeof json.css === "string" && json.css.trim()) {
      const css = json.css.trim();
      return {
        css,
        playIo: { css },
        layoutFromJson: layoutNorm(json.layout || json.orientation)
      };
    }

    let h = tryHostObject(json["play.autodarts.io"]);
    if (h) {
      if (!h.layoutFromJson) h.layoutFromJson = layoutNorm(json.layout || json.orientation);
      return h;
    }
    h = tryHostObject(json.playAutodartsIo);
    if (h) {
      if (!h.layoutFromJson) h.layoutFromJson = layoutNorm(json.layout || json.orientation);
      return h;
    }

    const keys = Object.keys(json);
    const candidates = [];
    for (const k of keys) {
      const v = json[k];
      const hit = tryHostObject(v);
      if (!hit) continue;
      const kl = k.toLowerCase();
      let score = 0;
      if (kl.includes("autodarts")) score += 4;
      if (kl.includes("play")) score += 2;
      if (kl.includes("io") || kl.includes("host")) score += 1;
      candidates.push({ ...hit, score });
    }
    candidates.sort((a, b) => b.score - a.score);
    if (candidates.length) {
      const best = candidates[0];
      if (!best.layoutFromJson) best.layoutFromJson = layoutNorm(json.layout || json.orientation);
      return { css: best.css, playIo: best.playIo, layoutFromJson: best.layoutFromJson };
    }

    return empty;
  }

  async function resolveStylebotPackPreviewImageUrl(packUrl) {
    const key = String(packUrl || "").trim();
    if (!key) return "";
    if (stylebotCssBgPreviewCache.has(key)) return stylebotCssBgPreviewCache.get(key);
    let inflight = stylebotPackFetchInflight.get(key);
    if (!inflight) {
      inflight = (async () => {
        try {
          const r = await fetch(key, { credentials: "omit", cache: "force-cache" });
          if (!r.ok) throw new Error(String(r.status));
          const json = await r.json();
          const ex = extractStylebotPackFromRootJson(json);
          let css = String(ex.css || "").trim();
          css = css.replace(/(^|[\r\n])\s*\/\/[^\r\n]*/g, "$1");
          const resolved = extractFirstHttpBackgroundUrlFromCss(css) || "";
          stylebotCssBgPreviewCache.set(key, resolved);
          return resolved;
        } catch {
          stylebotCssBgPreviewCache.set(key, "");
          return "";
        } finally {
          stylebotPackFetchInflight.delete(key);
        }
      })();
      stylebotPackFetchInflight.set(key, inflight);
    }
    return inflight;
  }

  function pickStylebotPreviewHost(rootEl) {
    if (!rootEl) return null;
    const shell = rootEl.querySelector(".communityGalleryPreviewShell");
    if (shell) return shell;
    return rootEl.querySelector(".quickPresetPreview--photo") || rootEl.querySelector(".quickPresetPreview");
  }

  function collectStylebotPackPreviewJobs(root) {
    const jobs = [];
    const hostsDone = new Set();
    const pushJob = (rootEl, packUrl) => {
      const url = String(packUrl || "").trim();
      if (!url || !rootEl) return;
      const host = pickStylebotPreviewHost(rootEl);
      if (!host || host.querySelector("img.communityPreviewImage--stylebotFetched")) return;
      if (hostsDone.has(host)) return;
      hostsDone.add(host);
      jobs.push({ packUrl: url, host });
    };

    const modal = root?.querySelector?.("#websiteCommunityThemeModal");
    if (modal?.classList.contains("open")) {
      modal.querySelectorAll(".communityThemeCard[data-stylebot-pack-url]").forEach((card) => {
        pushJob(card, card.getAttribute("data-stylebot-pack-url"));
      });
    }

    root?.querySelector?.("#websiteFavoriteGalleryStrip")?.querySelectorAll?.("[data-stylebot-pack-url]")?.forEach?.((node) => {
      pushJob(node, node.getAttribute("data-stylebot-pack-url"));
    });

    return jobs;
  }

  async function hydrateStylebotPackPreviews(root) {
    const jobs = collectStylebotPackPreviewJobs(root);
    if (!jobs.length) return;
    const concurrency = 3;
    const queue = jobs.slice();
    const worker = async () => {
      while (queue.length) {
        const job = queue.shift();
        if (!job) continue;
        const resolved = await resolveStylebotPackPreviewImageUrl(job.packUrl);
        if (!resolved || !job.host.isConnected) continue;
        if (job.host.querySelector("img.communityPreviewImage--stylebotFetched")) continue;
        const img = document.createElement("img");
        img.className = "communityPreviewImage communityPreviewImage--stylebotFetched";
        img.alt = "";
        img.loading = "lazy";
        img.decoding = "async";
        img.src = resolved;
        job.host.appendChild(img);
      }
    };
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
  }

  function galleryWireMountPoints(root) {
    if (!root) return [];
    const g = root.querySelector("#websiteCommunityGalleryMount");
    const f = root.querySelector("#websiteFavoriteGalleryStrip");
    const mounts = [g, f].filter(Boolean);
    return mounts.length ? mounts : [root];
  }

  /**
   * Data-URL-Screenshots: nach `innerHTML` per DOM setzen (keine Riesen-Strings im Markup).
   * Galerie-Mount und Favoriten-Leiste werden beide angebunden.
   * Data-URLs werden sofort gesetzt. `galleryScreenshotRef` → Thumbnail per Message aus IndexedDB (async).
   * Leeres `src` bei deferred + nur Placeholder vermeidet sofortiges `error` vor dem ersten gültigen `src`.
   */
  const DEFERRED_GALLERY_IMG_PLACEHOLDER =
    "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

  function wireDeferredThemeScreenshots(root, settings) {
    const mounts = galleryWireMountPoints(root);
    if (!mounts.length) return;
    const all = getCommunityThemes(settings);
    const byId = new Map(all.map((t) => [String(t.id || "").toLowerCase(), t]));

    mounts.forEach((mount) => {
      mount.querySelectorAll("[data-adm-gallery-blob]").forEach((node) => {
        try {
          const u = node.dataset.admGalleryBlob;
          if (u && String(u).startsWith("blob:")) URL.revokeObjectURL(u);
        } catch {}
        try {
          delete node.dataset.admGalleryBlob;
        } catch {}
      });
    });

    const applyShotToImg = (img, shot) => {
      if (!shot.startsWith("data:image/")) return;
      try {
        img.src = shot;
      } catch {}
    };

    const applyShotToSwatch = (el, shot) => {
      if (!shot.startsWith("data:image/")) return;
      const safe = shot.replace(/\\/g, "\\\\").replace(/"/g, "%22");
      el.style.backgroundImage = `url("${safe}")`;
      el.style.backgroundSize = "cover";
      el.style.backgroundPosition = "center";
    };

    mounts.forEach((mount) => {
      mount.querySelectorAll(".communityPreviewImage--deferredShot[data-theme-id]").forEach((img) => {
        const id = String(img.getAttribute("data-theme-id") || "").toLowerCase();
        const theme = byId.get(id);
        const shot = String(theme?.galleryScreenshot || "").trim();
        const ref = String(theme?.galleryScreenshotRef || "").trim();
        if (shot.startsWith("data:image/")) {
          applyShotToImg(img, shot);
          return;
        }
        if (ref) {
          void (async () => {
            const res = await new Promise((resolve) => {
              try {
                chrome.runtime.sendMessage({ type: "ADM_GALLERY_THUMB_GET", ref }, (reply) => {
                  void chrome.runtime.lastError;
                  resolve(reply && typeof reply === "object" ? reply : { ok: false });
                });
              } catch {
                resolve({ ok: false });
              }
            });
            if (res?.ok && String(res.dataUrl || "").startsWith("data:image/")) {
              applyShotToImg(img, String(res.dataUrl));
            }
          })();
        }
      });
      mount.querySelectorAll(".communityMiniSwatch--deferredPhoto[data-favorite-theme-id]").forEach((el) => {
        const id = String(el.getAttribute("data-favorite-theme-id") || "").toLowerCase();
        const theme = byId.get(id);
        const shot = String(theme?.galleryScreenshot || "").trim();
        const ref = String(theme?.galleryScreenshotRef || "").trim();
        if (shot.startsWith("data:image/")) {
          applyShotToSwatch(el, shot);
          return;
        }
        if (ref) {
          void (async () => {
            const res = await new Promise((resolve) => {
              try {
                chrome.runtime.sendMessage({ type: "ADM_GALLERY_THUMB_GET", ref }, (reply) => {
                  void chrome.runtime.lastError;
                  resolve(reply && typeof reply === "object" ? reply : { ok: false });
                });
              } catch {
                resolve({ ok: false });
              }
            });
            if (res?.ok && String(res.dataUrl || "").startsWith("data:image/")) {
              applyShotToSwatch(el, String(res.dataUrl));
            }
          })();
        }
      });
    });
  }

  function normalizeBackgroundSize(raw) {
    const v = String(raw || "cover").toLowerCase();
    return v === "contain" || v === "auto" ? v : "cover";
  }

  /**
   * Skaliert große Bilder herunter und speichert als JPEG-Data-URL (Speicher-Limit).
   * @param {File} file
   * @returns {Promise<string>}
   */
  function compressImageFileToDataUrl(file, maxEdge = 1920, quality = 0.82) {
    return new Promise((resolve, reject) => {
      if (!file || !file.type || !String(file.type).startsWith("image/")) {
        reject(new Error("not_image"));
        return;
      }
      const img = new Image();
      const objUrl = URL.createObjectURL(file);
      img.onload = () => {
        try {
          let w = img.naturalWidth || img.width;
          let h = img.naturalHeight || img.height;
          if (!w || !h) throw new Error("bad_dimensions");
          const scale = w > maxEdge || h > maxEdge ? Math.min(maxEdge / w, maxEdge / h) : 1;
          w = Math.max(1, Math.round(w * scale));
          h = Math.max(1, Math.round(h * scale));
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d");
          if (!ctx) throw new Error("no_canvas");
          ctx.drawImage(img, 0, 0, w, h);
          const dataUrl = canvas.toDataURL("image/jpeg", quality);
          URL.revokeObjectURL(objUrl);
          resolve(dataUrl);
        } catch (e) {
          try {
            URL.revokeObjectURL(objUrl);
          } catch {}
          reject(e);
        }
      };
      img.onerror = () => {
        try {
          URL.revokeObjectURL(objUrl);
        } catch {}
        reject(new Error("image_load_failed"));
      };
      img.src = objUrl;
    });
  }


  function pickFirstHttpUrl(text) {
    const raw = String(text || "").trim();
    if (!raw) return "";
    const m = raw.match(/https?:\/\/[^\s"'<>]+/i);
    return m ? String(m[0]).trim() : "";
  }

  async function compressImageUrlToDataUrl(url) {
    const target = String(url || "").trim();
    if (!/^https?:\/\//i.test(target)) throw new Error("bad_url");
    const res = await fetch(target, { method: "GET" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    if (!String(blob.type || "").startsWith("image/")) throw new Error("not_image");
    const file = new File([blob], "remote-image", { type: blob.type || "image/jpeg" });
    return compressImageFileToDataUrl(file);
  }


  function parseJsonIdList(raw) {
    try {
      const arr = JSON.parse(String(raw || "[]"));
      if (!Array.isArray(arr)) return [];
      return arr
        .map((x) => String(x || "").trim().toLowerCase())
        .filter((x, idx, list) => !!x && list.indexOf(x) === idx);
    } catch {
      return [];
    }
  }

  /** Custom-Themes aus dem Speicher → Karten für „Alle Themes durchsuchen“. */
  function localSavedThemesToGallery(settings) {
    const s = settings && typeof settings === "object" ? settings : {};
    const h = parseCustomThemes(s.websiteCustomThemesHorizontal, "horizontal");
    const v = parseCustomThemes(s.websiteCustomThemesVertical, "vertical");
    const byKey = new Map();
    const add = (t, listLayout) => {
      const id = String(t?.id || "").toLowerCase();
      if (!id) return;
      const layout = normalizeLayout(listLayout);
      const mapKey = `${layout}::${id}`;
      const desc = String(t.description || "").trim();
      const builderLabel = tr(s, "Builder", "Builder");
      const rawTagList = Array.isArray(t.tags) ? t.tags.map((x) => String(x || "").trim()).filter(Boolean) : [];
      let baseTags;
      if (t.stylebotImport) {
        baseTags = normalizeThemeTagsWithLayout(
          layout,
          rawTagList.length ? rawTagList : ["Stylebot", "ADM"]
        );
      } else {
        const seen = new Set();
        const out = [];
        const push = (x) => {
          const k = String(x || "").trim().toLowerCase();
          if (!k || seen.has(k)) return;
          seen.add(k);
          out.push(String(x).trim());
        };
        push(builderLabel);
        rawTagList.forEach((x) => {
          if (String(x || "").trim().toLowerCase() === builderLabel.toLowerCase()) return;
          if (isThemeLayoutTagToken(x)) return;
          push(x);
        });
        baseTags = normalizeThemeTagsWithLayout(layout, out.length ? out : [builderLabel]);
      }
      const savedAt = Number.isFinite(Number(t.savedAt)) ? Number(t.savedAt) : 0;
      byKey.set(mapKey, {
        id,
        label: String(t.label || id).trim() || id,
        layout,
        sourceName: String(t.sourceName || "Theme Builder").trim(),
        sourceUrl: String(t.sourceUrl || "").trim(),
        author: String(t.author || t.sourceName || "").trim() || "Lokal",
        description: desc || "Im Theme-Builder gespeichert.",
        tags: baseTags,
        preview: t.preview && typeof t.preview === "object" ? t.preview : {},
        css: String(t.css || ""),
        builderData: t.builderData && typeof t.builderData === "object" ? t.builderData : {},
        backgroundImageDataMatch: String(t.backgroundImageDataMatch || "").trim(),
        backgroundSize: t.backgroundSize,
        arenaPrimaryHue: t.arenaPrimaryHue,
        arenaSecondaryHue: t.arenaSecondaryHue,
        arenaTertiaryHue: t.arenaTertiaryHue,
        savedAt,
        galleryUpdatedAt: Number.isFinite(Number(t.galleryUpdatedAt)) ? Number(t.galleryUpdatedAt) : 0,
        galleryScreenshot: String(t.galleryScreenshot || "").trim(),
        galleryScreenshotRef: String(t.galleryScreenshotRef || "").trim(),
        stylebotPackUrl: String(t.stylebotPackUrl || "").trim(),
        stylebotImport: !!t.stylebotImport,
        playAutodartsIo:
          t["play.autodarts.io"] && typeof t["play.autodarts.io"] === "object"
            ? t["play.autodarts.io"]
            : t.playAutodartsIo && typeof t.playAutodartsIo === "object"
              ? t.playAutodartsIo
              : undefined,
        localSaved: true,
        needsDetail: false
      });
    };
    h.forEach((t) => add(t, "horizontal"));
    v.forEach((t) => add(t, "vertical"));
    return Array.from(byKey.values());
  }

  /** Offizielle Horizontal-Presets (HUE, Dark, MrJames AD Template) in der Galerie „Alle Themes“. */
  function catalogPresetThemesForGallery(settings) {
    const st = settings || SETTINGS_SNAPSHOT || {};
    const horizontal = getThemeSets().horizontal || [];
    const out = [];
    for (const row of horizontal) {
      const id = String(row?.id || "").toLowerCase();
      if (!CATALOG_GALLERY_HORIZONTAL_IDS.has(id)) continue;
      const label =
        id === "minimal"
          ? "Dark"
          : String(row.label || (id === "hue" ? "HUE" : id)).trim() || id;
      const author = id === "mrjames-ad-template" ? "MrJames" : "DeDomeD";
      const description =
        id === "hue"
          ? tr(st, "Arena-Farbverlauf mit drei einstellbaren Hue-Werten (Popup „HUE Farben“).", "Arena gradients with three adjustable hues (HUE colors popup).")
          : id === "minimal"
            ? tr(st, "Reduziertes dunkles Erscheinungsbild für die Match-Ansicht.", "Reduced dark look for the match view.")
            : tr(
                st,
                "Stylebot-Port „AD Template“ (MrJames) — Original-CSS aus Stylebot, im Extension-Bundle.",
                "MrJames Stylebot AD template — original Stylebot CSS bundled in the extension."
              );
      const savedAt = id === "hue" ? 2 : id === "minimal" ? 1 : 5;
      const introMs = GALLERY_BUILTIN_INTRO_MS[id];
      out.push({
        id,
        label,
        layout: "horizontal",
        author,
        sourceName: author,
        sourceUrl: "",
        description,
        tags: normalizeThemeTagsWithLayout("horizontal", [tr(st, "Voreinstellung", "Preset"), "ADM"]),
        preview: row.preview && typeof row.preview === "object" ? row.preview : {},
        css: String(row.css || ""),
        builderData: {},
        backgroundImageDataMatch: "",
        localSaved: false,
        catalogPreset: true,
        needsDetail: false,
        savedAt,
        galleryIntroMs: Number.isFinite(Number(introMs)) ? Number(introMs) : 0,
        galleryScreenshot: "",
        galleryScreenshotRef: ""
      });
    }
    return out;
  }

  /** Galerie-Einträge für tobyleif Stylebot-JSON (ohne Speicherung bis zur Anwendung). */
  function tobyleifSyntheticThemes(settings) {
    const st = settings || SETTINGS_SNAPSHOT || {};
    const cat = getEffectiveTobyleifCatalogRows(st);
    const base = String(globalThis.ADM_TOBYLEIF_STYLEBOT_BASE || "https://tobyleif.com/autodarts/").replace(/\/?$/, "/");
    const out = [];
    let idx = 0;
    for (const row of cat) {
      const file = String(row?.file || "").trim();
      if (!file) continue;
      const baseName = tobyleifCatalogFileBasename(file) || file;
      const slug = baseName
        .replace(/\.json$/i, "")
        .replace(/[^a-z0-9]+/gi, "-")
        .replace(/^-+|-+$/g, "")
        .toLowerCase() || "pack";
      const id = `tobyleif-${slug}`;
      const name = String(row?.name || slug).trim() || slug;
      const layout = String(row?.layout || "horizontal").toLowerCase() === "vertical" ? "vertical" : "horizontal";
      const packUrl = /^https?:\/\//i.test(file) ? file.trim() : `${base}${file.replace(/^\//, "")}`;
      out.push({
        id,
        label: name,
        layout,
        author: "tobyleif",
        sourceName: "tobyleif",
        sourceUrl: packUrl,
        stylebotPackUrl: packUrl,
        description: tr(
          st,
          "Stylebot-Paket von tobyleif.com/autodarts (JSON). Nach Anwenden lokal gespeichert.",
          "Stylebot pack from tobyleif.com/autodarts (JSON). Saved locally after apply."
        ),
        tags: normalizeThemeTagsWithLayout(layout, ["Stylebot", "ADM"]),
        preview: {},
        css: "",
        builderData: {},
        backgroundImageDataMatch: "",
        localSaved: false,
        stylebotImport: true,
        catalogPreset: false,
        needsDetail: false,
        savedAt: 1000 + idx,
        galleryScreenshot: "",
        galleryScreenshotRef: ""
      });
      idx += 1;
    }
    return out;
  }

  function getCommunityThemes(settings) {
    const st = settings || SETTINGS_SNAPSHOT || {};
    const locals = localSavedThemesToGallery(st);
    const catalog = catalogPresetThemesForGallery(st);
    const toby = tobyleifSyntheticThemes(st);
    const byId = new Map();
    catalog.forEach((t) => byId.set(String(t.id || "").toLowerCase(), t));
    toby.forEach((t) => byId.set(String(t.id || "").toLowerCase(), t));
    locals.forEach((t) => byId.set(String(t.id || "").toLowerCase(), t));
    return Array.from(byId.values());
  }

  function findRawCustomThemeById(settings, id) {
    const want = String(id || "").toLowerCase();
    const keys = ["websiteCustomThemesHorizontal", "websiteCustomThemesVertical"];
    for (const key of keys) {
      const listLayout = key === "websiteCustomThemesVertical" ? "vertical" : "horizontal";
      const list = parseCustomThemes(settings?.[key], listLayout);
      const hit = list.find((t) => String(t.id || "").toLowerCase() === want);
      if (hit) return { storageKey: key, entry: { ...hit } };
    }
    return null;
  }

  function getCommunityFavorites(settings) {
    const list = parseJsonIdList(settings?.websiteCommunityFavorites);
    const mapped = list.map((id) => (id === "tools-glass" ? "stream-glass" : id));
    const seen = new Set();
    return mapped.filter((id) => {
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }

  function isCommunityThemeActive(theme, settings) {
    if (!theme) return false;
    const layout = normalizeLayout(settings?.websiteLayout);
    const activeTheme = String(settings?.websiteTheme || "").toLowerCase();
    return layout === theme.layout && activeTheme === String(theme.id || "").toLowerCase();
  }

  function getCommunityThemeCards(settings) {
    const favorites = getCommunityFavorites(settings);
    const favoriteSet = new Set(favorites);
    return getCommunityThemes(settings).sort((a, b) => {
      const aOwn = isUserBuilderGalleryTheme(a) ? 1 : 0;
      const bOwn = isUserBuilderGalleryTheme(b) ? 1 : 0;
      if (aOwn !== bOwn) return bOwn - aOwn;
      const aFav = favoriteSet.has(a.id) ? 1 : 0;
      const bFav = favoriteSet.has(b.id) ? 1 : 0;
      if (aFav !== bFav) return bFav - aFav;
      const aT = Number(a.savedAt) || 0;
      const bT = Number(b.savedAt) || 0;
      if (a.localSaved && b.localSaved && aT !== bT) return bT - aT;
      return String(a.label).localeCompare(String(b.label));
    });
  }

  function getVisibleThemesForLayout(layout, settings) {
    const all = getThemeSets()[layout] || [];
    const favorites = new Set(getCommunityFavorites(settings));
    const standard = all.filter((theme) => !theme?.libraryOnly);
    const extra = all.filter((theme) => theme?.libraryOnly && favorites.has(String(theme.id || "").toLowerCase()));
    const out = [...standard, ...extra];
    const used = new Set();
    return out.filter((theme) => {
      const id = String(theme?.id || "").toLowerCase();
      if (!id || used.has(id)) return false;
      used.add(id);
      return true;
    });
  }

  function upsertCustomThemeList(list, nextTheme) {
    const out = Array.isArray(list) ? [...list] : [];
    const idx = out.findIndex((t) => String(t?.id || "").toLowerCase() === String(nextTheme?.id || "").toLowerCase());
    if (idx >= 0) out[idx] = nextTheme;
    else out.push(nextTheme);
    return out;
  }

  function bindCommunityPreviewImageFallbacks(root) {
    if (!root) return;
    root.querySelectorAll(".communityPreviewImage").forEach((img) => {
      if (img.classList.contains("communityPreviewImage--deferredShot")) return;
      if (img.dataset.errorBound === "1") return;
      img.dataset.errorBound = "1";
      img.addEventListener("error", () => {
        img.style.display = "none";
      });
    });
  }

  function presetQuickPreviewWireframe(theme) {
    const preview = (theme && theme.preview) || {};
    return `
            <span class="quickPresetPreview" style="--preview-bg:${preview.bg || "#14233a"}; --preview-accent:${preview.accent || "#19c7ff"};">
              <span class="quickPresetTop">
                <span class="quickPresetDot"></span>
                <span class="quickPresetBar"></span>
                <span class="quickPresetPill"></span>
              </span>
              <span class="quickPresetBoard">
                <span class="quickPresetPlayer"></span>
                <span class="quickPresetPlayer dim"></span>
              </span>
              <span class="quickPresetFocus"></span>
            </span>`;
  }

  /** Favoriten-Leiste: nur explizit markierte Themes; HUE/Dark erst nach Stern in der Galerie; gleiche Kartenbreite wie bisherige Quick-Presets. */
  function renderFavoriteStrip(settings) {
    const st = settings || SETTINGS_SNAPSHOT || {};
    const layout = normalizeLayout(st.websiteLayout);
    const favoriteOrder = getCommunityFavorites(st);
    const byId = new Map(getCommunityThemes(st).map((t) => [String(t.id || "").toLowerCase(), t]));
    const layoutPresets = getThemeSets()[layout] || getThemeSets().horizontal || [];
    const presetById = (want) => layoutPresets.find((t) => String(t?.id || "").toLowerCase() === want);
    const activeId = String(st.websiteTheme || "").toLowerCase();
    const activeInFavoriteList =
      !!activeId && favoriteOrder.some((x) => String(x || "").toLowerCase() === activeId);

    const rows = [];
    const maxSlots = 12;

    const pushActiveThemeIfMissingFromFavorites = () => {
      if (!activeId || activeInFavoriteList) return;
      if (rows.length >= maxSlots) return;
      const theme = byId.get(activeId);
      const presetRow = presetById(activeId);
      const isHueOrMinimalPreset = CATALOG_GALLERY_HORIZONTAL_IDS.has(activeId) && presetRow;
      if (isHueOrMinimalPreset) {
        const applyAttr = `data-quick-theme="${activeId}"`;
        rows.push(`
          <button type="button" class="communityMiniCard quickPresetCard active" ${applyAttr}>
            ${presetQuickPreviewWireframe(presetRow)}
            <span class="communityMiniText">${escapeHtml(String(presetRow.label || activeId))}</span>
            <span class="quickPresetState">${tr(st, "Aktiv", "Active")}</span>
          </button>`);
        return;
      }
      if (presetRow) {
        const applyAttr = `data-quick-theme="${activeId}"`;
        rows.push(`
          <button type="button" class="communityMiniCard quickPresetCard active" ${applyAttr}>
            ${presetQuickPreviewWireframe(presetRow)}
            <span class="communityMiniText">${escapeHtml(String(presetRow.label || activeId))}</span>
            <span class="quickPresetState">${tr(st, "Aktiv", "Active")}</span>
          </button>`);
        return;
      }
      if (theme) {
        const packUrlFav = resolveStylebotPackJsonUrl(theme);
        const isStylebotFavorite = !!(theme?.stylebotImport && packUrlFav);
        const applyAttr = `data-community-apply="${activeId}"`;
        const shot = String(theme.galleryScreenshot || "").trim();
        const shotRef = String(theme.galleryScreenshotRef || "").trim();
        const hasShot = shot.startsWith("data:image/") || !!shotRef;
        const tidAttr = String(theme.id || "").trim().toLowerCase().replace(/"/g, "");
        const pv = theme.preview || {};
        const favLocalPhotoStyle = `--preview-bg:${pv.bg || "#14233a"}; --preview-accent:${pv.accent || "#19c7ff"};`;
        const useStylebotPackThumb = !!(packUrlFav && !hasShot && theme?.stylebotImport);
        const packAttrFav = useStylebotPackThumb ? ` data-stylebot-pack-url="${escapeAttr(packUrlFav)}"` : "";
        const previewInner = useStylebotPackThumb
          ? `<span class="quickPresetPreview quickPresetPreview--photo" style="${escapeAttr(favLocalPhotoStyle)}"></span>`
          : hasShot
            ? `<span class="quickPresetPreview quickPresetPreview--photo" style="${escapeAttr(favLocalPhotoStyle)}"><img class="communityPreviewImage communityPreviewImage--deferredShot" src="${DEFERRED_GALLERY_IMG_PLACEHOLDER}" alt="" data-theme-id="${tidAttr}" /></span>`
            : presetQuickPreviewWireframe(theme);
        rows.push(`
          <button type="button" class="communityMiniCard quickPresetCard active" ${applyAttr}${packAttrFav}>
            ${previewInner}
            <span class="communityMiniText">${escapeHtml(String(theme.label || activeId))}</span>
            <span class="quickPresetState">${tr(st, "Aktiv", "Active")}</span>
          </button>`);
      }
    };

    pushActiveThemeIfMissingFromFavorites();

    for (const fid of favoriteOrder) {
      if (rows.length >= maxSlots) break;
      const id = String(fid || "").toLowerCase();
      if (!id) continue;
      const theme = byId.get(id);
      const presetRow = presetById(id);
      const isHueOrMinimalPreset = CATALOG_GALLERY_HORIZONTAL_IDS.has(id) && presetRow;

      if (isHueOrMinimalPreset) {
        const active = normalizeLayout(st.websiteLayout) === "horizontal" && String(st.websiteTheme || "").toLowerCase() === id;
        const applyAttr = `data-quick-theme="${id}"`;
        rows.push(`
          <button type="button" class="communityMiniCard quickPresetCard${active ? " active" : ""}" ${applyAttr}>
            ${presetQuickPreviewWireframe(presetRow)}
            <span class="communityMiniText">${escapeHtml(String(presetRow.label || id))}</span>
            <span class="quickPresetState">${active ? "Aktiv" : "Theme"}</span>
          </button>`);
        continue;
      }

      const packUrlFav = theme ? resolveStylebotPackJsonUrl(theme) : "";
      const isStylebotFavorite = !!(theme?.stylebotImport && packUrlFav);

      if (!theme || (!theme.localSaved && !isStylebotFavorite)) continue;

      const active = isCommunityThemeActive(theme, st);
      const applyAttr = `data-community-apply="${id}"`;
      const shot = String(theme.galleryScreenshot || "").trim();
      const shotRef = String(theme.galleryScreenshotRef || "").trim();
      const hasShot = shot.startsWith("data:image/") || !!shotRef;
      const tidAttr = String(theme.id || "").trim().toLowerCase().replace(/"/g, "");
      const pv = theme.preview || {};
      const favLocalPhotoStyle = `--preview-bg:${pv.bg || "#14233a"}; --preview-accent:${pv.accent || "#19c7ff"};`;
      const useStylebotPackThumb = !!(packUrlFav && !hasShot && theme?.stylebotImport);
      const packAttrFav = useStylebotPackThumb ? ` data-stylebot-pack-url="${escapeAttr(packUrlFav)}"` : "";
      const previewInner = useStylebotPackThumb
        ? `<span class="quickPresetPreview quickPresetPreview--photo" style="${escapeAttr(favLocalPhotoStyle)}"></span>`
        : hasShot
        ? `<span class="quickPresetPreview quickPresetPreview--photo" style="${escapeAttr(favLocalPhotoStyle)}"><img class="communityPreviewImage communityPreviewImage--deferredShot" src="${DEFERRED_GALLERY_IMG_PLACEHOLDER}" alt="" data-theme-id="${tidAttr}" /></span>`
        : presetQuickPreviewWireframe(theme);
      rows.push(`
        <button type="button" class="communityMiniCard quickPresetCard${active ? " active" : ""}" ${applyAttr}${packAttrFav}>
          ${previewInner}
          <span class="communityMiniText">${escapeHtml(String(theme.label || id))}</span>
          <span class="quickPresetState">${active ? "Aktiv" : "Theme"}</span>
        </button>`);
    }
    if (!rows.length) {
      return `<div class="hint" style="margin-top:0;">${tr(st, "Noch keine Favoriten markiert.", "No favorites marked yet.")}</div>`;
    }
    return rows.join("");
  }

  function renderCommunityPreview(theme, settings) {
    const st = settings || SETTINGS_SNAPSHOT || {};
    const compactGallery = isGalleryCompactCard(theme);
    const layoutHint = theme.layout === "vertical" ? "vertikal vertical" : "horizontal";
    const tagList = (Array.isArray(theme.tags) ? theme.tags : []).map((x) => String(x || "").trim()).filter(Boolean);
    const tagHay = tagList.join(" ");
    const bd = computeThemeGalleryBadges(theme, Date.now(), st);
    const badgeHay = bd.showUpdated ? " update updated " : bd.showNew ? " neu new " : "";
    const searchBlob =
      `${String(theme.label || "")} ${galleryCreatorDisplayName(st, theme)} ${String(theme.author || "")} ${String(theme.sourceName || "")} ${String(theme.description || "")} ${tagHay} ${layoutHint}${badgeHay}`.toLowerCase();
    const preview = theme.preview || {};
    const previewKind = String(preview.kind || theme.id || "").toLowerCase();
    const tagLead = theme.stylebotImport
      ? tr(st, "Stylebot", "Stylebot")
      : theme.localSaved
      ? tr(st, "Gespeichert", "Saved")
      : tr(st, "Community", "Community");
    const tags = [
      `<span class="communityTag">${tagLead}</span>`,
      ...tagList.slice(0, 12).map((tag) => `<span class="communityTag">${escapeHtml(tag)}</span>`)
    ].join("");
    const sourceBtn = !compactGallery && String(theme.sourceUrl || "").trim()
      ? `<button type="button" class="btn" data-community-source="${theme.id}">${tr(st, "Quelle", "Source")}</button>`
      : "";
    const starInShell = theme.localSaved
      ? ""
      : `<button type="button" class="communityStarBtn" data-community-favorite="${theme.id}" title="${favoriteTitleFor(theme.id, st)}">${favoriteGlyphFor(theme.id, st)}</button>`;
    const localHeroChrome = theme.localSaved
      ? `<div class="communityLocalHeroToolbarTop" role="toolbar" aria-label="${tr(st, "Favorit", "Favorite")}">
          <button type="button" class="communityIconTool" data-community-favorite="${theme.id}" title="${favoriteTitleFor(theme.id, st)}">${favoriteGlyphFor(theme.id, st)}</button>
        </div>
        <div class="communityLocalHeroToolbarBottom" role="toolbar" aria-label="${tr(st, "Download und Löschen", "Download and delete")}">
          <button type="button" class="communityIconTool" data-community-download="${theme.id}" title="${tr(st, "Download (JSON)", "Download (JSON)")}">⬇</button>
          <button type="button" class="communityIconTool communityIconToolDanger" data-community-delete-local="${theme.id}" title="${tr(st, "Löschen", "Delete")}">🗑</button>
        </div>`
      : "";
    const exportBtn = theme.localSaved || theme.catalogPreset || theme.stylebotImport
      ? ""
      : `<button type="button" class="btn" data-community-download="${theme.id}">${tr(st, "Export (JSON)", "Export (JSON)")}</button>`;
    /** Ganzes Karten-Element: Klick wendet an (Stern/Löschen/Download/Quelle werden vorher im Handler abgefangen). */
    const cardApplyAttr = ` data-community-apply="${theme.id}"`;
    const packUrlCard = resolveStylebotPackJsonUrl(theme);
    const packAttrCard = packUrlCard ? ` data-stylebot-pack-url="${escapeAttr(packUrlCard)}"` : "";
    const galleryShot = String(theme.galleryScreenshot || "").trim();
    const galleryRef = String(theme.galleryScreenshotRef || "").trim();
    const hasDataShot = galleryShot.startsWith("data:image/");
    const hasGalleryThumb = hasDataShot || !!galleryRef;
    const cardModifier = theme.localSaved ? " communityThemeCard--local" : compactGallery ? " communityThemeCard--galleryCompact" : "";
    const heroPreviewClass = theme.localSaved ? " communityPreview--localHero" : compactGallery ? " communityPreview--compactHero" : "";
    const tidAttr = String(theme.id || "").trim().toLowerCase().replace(/"/g, "");
    /** Data-URL/Ref-Thumbnails; sonst Verlauf aus --preview-* */
    const previewImgHtml = hasGalleryThumb
      ? `<img class="communityPreviewImage communityPreviewImage--deferredShot" src="${DEFERRED_GALLERY_IMG_PLACEHOLDER}" alt="" data-theme-id="${tidAttr}" />`
      : "";
    const inImageMetaHtml = theme.localSaved
      ? galleryLocalInImageMetaHtml(st, theme)
      : compactGallery
      ? galleryLocalInImageMetaHtml(st, theme, { withLayoutPill: true })
      : "";
    const showLargeCardMeta = !theme.localSaved && !compactGallery;
    return `
      <div class="communityThemeCard${cardModifier}${isCommunityThemeActive(theme, st) ? " active" : ""}" data-community-card="${theme.id}" data-gallery-search="${escapeAttr(searchBlob)}" data-gallery-layout="${escapeAttr(String(theme.layout || "horizontal"))}"${cardApplyAttr}${packAttrCard}>
        <div class="communityGalleryPreviewShell communityPreview preview-${previewKind}${heroPreviewClass}" style="--preview-bg:${preview.bg || "#16243a"}; --preview-panel:${preview.panel || "rgba(11,18,28,.78)"}; --preview-accent:${preview.accent || "#19c7ff"}; --preview-accent-soft:${preview.accentSoft || "rgba(25,199,255,.18)"}; --preview-glow:${preview.glow || "rgba(25,199,255,.22)"};">
          ${starInShell}
          ${previewImgHtml}
          ${inImageMetaHtml}
          ${localHeroChrome}
        </div>
        ${showLargeCardMeta ? galleryCardMetaHtml(st, theme) : ""}
        ${showLargeCardMeta
        ? `<div class="communityThemeBody">
          <div class="communityThemeDesc">${escapeHtml(theme.description)}</div>
          <div class="communityTagRow">${tags}</div>
          <div class="communityThemeActions">
            <button type="button" class="btnPrimary" data-community-apply="${theme.id}">${isCommunityThemeActive(theme, st) ? tr(st, "Aktiv", "Active") : tr(st, "Anwenden", "Apply")}</button>
            ${sourceBtn}
            ${exportBtn}
          </div>
        </div>`
        : ""}
      </div>
    `;
  }

  let SETTINGS_SNAPSHOT = {};

  function favoriteGlyphFor(themeId, settings) {
    return getCommunityFavorites(settings).includes(String(themeId || "").toLowerCase()) ? "★" : "☆";
  }

  function favoriteTitleFor(themeId, settings) {
    const active = getCommunityFavorites(settings).includes(String(themeId || "").toLowerCase());
    return active
      ? tr(settings, "Favorit entfernen", "Remove favorite")
      : tr(settings, "Als Favorit markieren", "Add favorite");
  }

  function updateCommunityGalleryFilters(root) {
    const grid = root.querySelector("#websiteCommunityThemeModal .communityModalGrid");
    if (!grid) return;
    const inp = root.querySelector("[data-community-gallery-search]");
    const q = String(inp?.value || "").trim().toLowerCase();
    const layoutEl = root.querySelector('input[name="admGalleryLayoutFilter"]:checked');
    const layoutFilter = String(layoutEl?.value || "all").toLowerCase();
    grid.querySelectorAll("[data-community-card]").forEach((card) => {
      const hay = String(card.getAttribute("data-gallery-search") || "").toLowerCase();
      const layout = String(card.getAttribute("data-gallery-layout") || "").toLowerCase();
      const textOk = !q || hay.includes(q);
      const layoutOk = layoutFilter === "all" || layout === layoutFilter;
      card.style.display = textOk && layoutOk ? "" : "none";
    });
  }

  function tobyleifGalleryHeaderActionsHtml(settings) {
    const st = settings || {};
    const meta = parseTobyleifCatalogMeta(st);
    const on = !!st.websiteThemeTobyleifAutoUpdate;
    const checked = on ? " checked" : "";
    const titleParts = [
      tr(
        st,
        "Stylebot-Pakete: tobyleif.com/autodarts — bei Auto-Update periodisch Katalog-JSON laden.",
        "Stylebot packs: tobyleif.com/autodarts — with auto-update, refresh catalog JSON periodically."
      )
    ];
    if (meta.lastCheckMs) {
      titleParts.push(`${tr(st, "Letzte Prüfung", "Last check")}: ${new Date(Number(meta.lastCheckMs)).toLocaleString()}`);
    }
    if (String(meta.lastError || "").trim()) titleParts.push(String(meta.lastError));
    const title = titleParts.join(" · ");
    return `
      <label class="communityTobyAutoPill" title="${escapeAttr(title)}">
        <input type="checkbox"${checked} data-tobyleif-auto-update="1" class="communityTobyAutoPillInput" />
        <span class="communityTobyAutoPillMark" aria-hidden="true">✓</span>
        <span class="communityTobyAutoPillText">${escapeHtml(tr(st, "Auto-Update", "Auto-update"))}</span>
      </label>
      <button type="button" class="btnMini communityTobyRefresh" data-tobyleif-catalog-refresh="1" title="${escapeAttr(
        tr(st, "tobyleif.com: Katalog & Verbindung prüfen", "tobyleif.com: refresh catalog & check connection")
      )}">↻</button>
    `;
  }

  function renderCommunityGallery(settings) {
    const cards = getCommunityThemeCards(settings);
    const countText = tr(settings, "Alle Themes", "All themes");
    const searchPh = tr(settings, "Name, Ersteller oder Tags suchen…", "Search by name, author, or tags…");
    const layoutFilterAria = tr(settings, "Themes nach Layout filtern", "Filter themes by layout");
    const allLbl = tr(settings, "Alle", "All");
    const horLbl = tr(settings, "Horizontal", "Horizontal");
    const verLbl = tr(settings, "Vertikal", "Vertical");
    const body = cards.length
      ? cards.map((theme) => renderCommunityPreview(theme, settings)).join("")
      : `<div class="communityEmpty">${tr(
        settings,
        "Noch keine gespeicherten Themes. Auf der Match-Seite Theme-Builder starten und ein Layout speichern.",
        "No saved themes yet. Start the Theme Builder on the match page and save a layout."
      )}</div>`;
    return `
      <div class="communityModalBackdrop${COMMUNITY_GALLERY_OPEN ? " open" : ""}" id="websiteCommunityThemeModal">
        <div class="communityModalDialog">
          <div class="communityModalHeader">
            <div>
              <div class="communityModalTitle">${tr(settings, "Themes", "Themes")}</div>
              <div class="communityModalSub">${countText}</div>
            </div>
            <div class="communityModalHeaderActions">
              ${tobyleifGalleryHeaderActionsHtml(settings)}
              <button type="button" class="btnPrimary" data-community-close="1">X</button>
            </div>
          </div>
          <div class="communityGalleryLayoutRow">
            <div class="communityGallerySegment communityGallerySegment--wide" role="radiogroup" aria-label="${escapeAttr(layoutFilterAria)}">
              <label class="communityGallerySegmentBtn">
                <input type="radio" name="admGalleryLayoutFilter" value="all" checked data-gallery-layout-filter="1" />
                <span class="communityGallerySegmentFace">${escapeHtml(allLbl)}</span>
              </label>
              <label class="communityGallerySegmentBtn">
                <input type="radio" name="admGalleryLayoutFilter" value="horizontal" data-gallery-layout-filter="1" />
                <span class="communityGallerySegmentFace">${escapeHtml(horLbl)}</span>
              </label>
              <label class="communityGallerySegmentBtn">
                <input type="radio" name="admGalleryLayoutFilter" value="vertical" data-gallery-layout-filter="1" />
                <span class="communityGallerySegmentFace">${escapeHtml(verLbl)}</span>
              </label>
            </div>
          </div>
          <div class="communityGallerySearchRow">
            <input type="search" class="input communityGallerySearchInput" data-community-gallery-search="1" placeholder="${escapeAttr(searchPh)}" autocomplete="off" />
          </div>
          <div class="communityModalGrid">${body}</div>
        </div>
      </div>
    `;
  }

  function paint(root, settings) {
    if (!root) return;
    SETTINGS_SNAPSHOT = settings || {};
    hydrateTobyleifCatalogFromSettings(settings || {});
    const layout = normalizeLayout(settings?.websiteLayout);
    const theme = normalizeTheme(layout, settings?.websiteTheme, settings);
    const primaryHue = normalizeHue(settings?.websiteArenaPrimaryHue, 210);
    const secondaryHue = normalizeHue(settings?.websiteArenaSecondaryHue, 155);
    const tertiaryHue = normalizeHue(settings?.websiteArenaTertiaryHue, 125);

    const favoriteStrip = root.querySelector("#websiteFavoriteGalleryStrip");
    if (favoriteStrip) favoriteStrip.innerHTML = renderFavoriteStrip(settings);
    if (!themeSupportsColorPopup(layout, theme)) HUE_MODAL_OPEN = false;
    const hueModal = root.querySelector("#websiteHueModalMount");
    if (hueModal) {
      const visible = themeSupportsColorPopup(layout, theme) && HUE_MODAL_OPEN;
      hueModal.style.display = visible ? "" : "none";
    }
    const hueTitle = root.querySelector("#websiteHueModalTitle");
    const hueMeta = root.querySelector("#websiteHueModalMeta");
    if (hueTitle) hueTitle.textContent = theme === "vertical-scores" ? "Vertikal Scores Farben" : "HUE Farben";
    if (hueMeta) hueMeta.textContent = theme === "vertical-scores"
      ? "Drei Farbtöne für Vertikal Scores"
      : "Drei Farbtöne für Hintergrund und Akzente (HUE-Theme)";

    const primary = root.querySelector("#websiteArenaPrimaryHue");
    const secondary = root.querySelector("#websiteArenaSecondaryHue");
    const tertiary = root.querySelector("#websiteArenaTertiaryHue");
    const primaryVal = root.querySelector("#websiteArenaPrimaryHueValue");
    const secondaryVal = root.querySelector("#websiteArenaSecondaryHueValue");
    const tertiaryVal = root.querySelector("#websiteArenaTertiaryHueValue");
    if (primary) primary.value = String(primaryHue);
    if (secondary) secondary.value = String(secondaryHue);
    if (tertiary) tertiary.value = String(tertiaryHue);
    if (primary) primary.style.setProperty("--hue", String(primaryHue));
    if (secondary) secondary.style.setProperty("--hue", String(secondaryHue));
    if (tertiary) tertiary.style.setProperty("--hue", String(tertiaryHue));
    const galleryWrap = root.querySelector("#websiteCommunityGalleryMount");
    if (galleryWrap) galleryWrap.innerHTML = renderCommunityGallery(settings);
    updateCommunityGalleryFilters(root);
    wireDeferredThemeScreenshots(root, settings);
    bindCommunityPreviewImageFallbacks(root);
    void hydrateStylebotPackPreviews(root);
    if (primaryVal) primaryVal.textContent = `${primaryHue}°`;
    if (secondaryVal) secondaryVal.textContent = `${secondaryHue}°`;
    if (tertiaryVal) tertiaryVal.textContent = `${tertiaryHue}°`;
    const bgDataIngame = String(settings?.websiteBackgroundImageDataMatch || settings?.websiteBackgroundImageData || "").trim();
    const bgDataMenu = String(settings?.websiteBackgroundImageDataMenu || "").trim();
    const bgSize = normalizeBackgroundSize(settings?.websiteBackgroundSize);
    const hideMenuTitle = root.querySelector("#websiteHideLeftMenuTitle");
    const hideMenuHint = root.querySelector("#websiteHideLeftMenuHint");
    if (hideMenuTitle) {
      hideMenuTitle.textContent = tr(settings, "Menü ausblenden (Standard)", "Hide menu by default");
    }
    if (hideMenuHint) {
      hideMenuHint.textContent = tr(
        settings,
        "Klicke oben links, um das Menü anzuzeigen oder auszublenden.",
        "Click the top-left control on play.autodarts.io to show or hide the sidebar."
      );
    }
    const hideMenuCb = root.querySelector("#websiteHideLeftMenuByDefault");
    if (hideMenuCb) hideMenuCb.checked = settings?.websiteHideLeftMenuByDefault !== false;

    const bgSel = root.querySelector("#websiteBackgroundSize");
    if (bgSel) bgSel.value = bgSize;
    const setBgPreview = (wrapSel, imgSel, raw) => {
      const bgPrevWrap = root.querySelector(wrapSel);
      const bgPrevImg = root.querySelector(imgSel);
      if (!bgPrevWrap || !bgPrevImg) return;
      if (raw) {
        bgPrevImg.src = raw.startsWith("data:") ? raw : `data:image/jpeg;base64,${raw}`;
        bgPrevWrap.style.display = "";
      } else {
        bgPrevImg.removeAttribute("src");
        bgPrevWrap.style.display = "none";
      }
    };
    setBgPreview("#websiteBackgroundPreviewWrapIngame", "#websiteBackgroundPreviewIngame", bgDataIngame);
    setBgPreview("#websiteBackgroundPreviewWrapMenu", "#websiteBackgroundPreviewMenu", bgDataMenu);
  }

  /**
   * Alle offenen play.autodarts.io-Tabs neu laden (Theme + Hintergrund greifen zuverlässig).
   * @param {{ clearMenuLocalStorage?: boolean, bypassCache?: boolean }} [opts]
   */
  function reloadAutodartsWebsiteTabs(opts) {
    try {
      if (!chrome?.tabs?.query || !chrome?.tabs?.reload) return;
      const opt = opts && typeof opts === "object" ? opts : {};
      const clearMenuLs = !!opt.clearMenuLocalStorage;
      const bypassCache = !!opt.bypassCache;
      const hostOk = (raw) => {
        try {
          const h = new URL(String(raw || "").trim()).hostname.toLowerCase();
          return h === "play.autodarts.io" || h.endsWith(".play.autodarts.io");
        } catch {
          return false;
        }
      };
      const reloadTab = (id) => {
        try {
          chrome.tabs.reload(id, { bypassCache }, () => void chrome.runtime?.lastError);
        } catch {}
      };
      const MENU_LS_KEY = "adm_left_menu_collapsed";
      chrome.tabs.query({}, (all) => {
        void chrome.runtime?.lastError;
        (all || []).forEach((t) => {
          if (!hostOk(t?.url)) return;
          const id = t?.id;
          if (!Number.isInteger(id)) return;
          if (clearMenuLs && chrome?.scripting?.executeScript) {
            try {
              chrome.scripting.executeScript(
                {
                  target: { tabId: id },
                  func: (key) => {
                    try {
                      localStorage.removeItem(key);
                    } catch {}
                  },
                  args: [MENU_LS_KEY]
                },
                () => {
                  void chrome.runtime?.lastError;
                  reloadTab(id);
                }
              );
            } catch {
              reloadTab(id);
            }
          } else {
            reloadTab(id);
          }
        });
      });
    } catch {}
  }

  async function applyCommunityTheme(api, settings, themeId) {
    const id = String(themeId || "").toLowerCase();
    const theme = getCommunityThemes(settings).find((x) => x.id === id);
    if (!theme) return;
    if (theme.catalogPreset) {
      const nextTheme = normalizeTheme("horizontal", id, settings);
      HUE_MODAL_OPEN = themeSupportsColorPopup("horizontal", nextTheme);
      await api.savePartial({
        websiteLayout: "horizontal",
        websiteTheme: nextTheme,
        websiteThemeBuilderData: "{}",
        websiteBackgroundImageDataMatch: "",
        websiteBackgroundImageData: "",
        websiteBackgroundImageDataMenu: ""
      });
      COMMUNITY_GALLERY_OPEN = false;
      paint(api.root, api.getSettings?.() || {});
      reloadAutodartsWebsiteTabs();
      return;
    }
    if (theme.stylebotImport) {
      const packUrl = resolveStylebotPackJsonUrl(theme);
      if (!packUrl) return;
      let packCss = "";
      let ex = { css: "", playIo: null, layoutFromJson: "" };
      try {
        const r = await fetch(packUrl, { credentials: "omit", cache: "force-cache" });
        if (!r.ok) throw new Error(String(r.status));
        const json = await r.json();
        ex = extractStylebotPackFromRootJson(json);
        packCss = String(ex.css || "").trim();
      } catch (e) {
        window.alert(
          tr(
            settings,
            `Stylebot-Paket konnte nicht geladen werden: ${String(e?.message || e || "")}`,
            `Could not load Stylebot pack: ${String(e?.message || e || "")}`
          )
        );
        return;
      }
      packCss = packCss.replace(/(^|[\r\n])\s*\/\/[^\r\n]*/g, "$1");
      if (!packCss.trim()) {
        window.alert(
          tr(
            settings,
            "Stylebot-JSON enthält kein nutzbares CSS (kein play.autodarts.io-Block und kein Top-Level-css).",
            "Stylebot JSON contains no usable CSS (no play.autodarts.io block and no top-level css)."
          )
        );
        return;
      }
      let layout = normalizeLayout(theme.layout);
      if (ex.layoutFromJson === "vertical" || ex.layoutFromJson === "horizontal") {
        layout = ex.layoutFromJson;
      }
      const listKey = layout === "vertical" ? "websiteCustomThemesVertical" : "websiteCustomThemesHorizontal";
      const list = parseCustomThemes(settings[listKey], layout);
      const prevSlot = list.find((t) => String(t.id || "").toLowerCase() === id);
      const prevCss = String(prevSlot?.css || "").trim();
      const entry = {
        id,
        label: String(theme.label || id).trim() || id,
        layout,
        css: packCss,
        builderData: {},
        backgroundImageDataMatch: "",
        backgroundSize: "cover",
        author: "tobyleif",
        sourceName: "tobyleif",
        sourceUrl: packUrl,
        stylebotPackUrl: packUrl,
        description: String(theme.description || "").trim(),
        tags: normalizeThemeTagsWithLayout(
          layout,
          Array.isArray(theme.tags) && theme.tags.length ? theme.tags : ["Stylebot"]
        ),
        savedAt: Number.isFinite(Number(prevSlot?.savedAt)) ? Number(prevSlot.savedAt) : Date.now(),
        galleryUpdatedAt:
          prevSlot && prevCss !== String(packCss || "").trim()
            ? Date.now()
            : Number.isFinite(Number(prevSlot?.galleryUpdatedAt))
              ? Number(prevSlot.galleryUpdatedAt)
              : 0,
        galleryScreenshot: "",
        galleryScreenshotRef: "",
        stylebotImport: true
      };
      if (ex.playIo && typeof ex.playIo === "object") {
        entry.playAutodartsIo = ex.playIo;
        entry["play.autodarts.io"] = ex.playIo;
      }
      const merged = upsertCustomThemeList(list, entry);
      await api.savePartial({
        websiteLayout: layout,
        websiteTheme: id,
        [listKey]: JSON.stringify(merged),
        websiteThemeBuilderData: "{}",
        websiteBackgroundImageDataMatch: "",
        websiteBackgroundImageData: "",
        websiteBackgroundImageDataMenu: "",
        websiteBackgroundSize: "cover"
      });
      COMMUNITY_GALLERY_OPEN = false;
      paint(api.root, api.getSettings?.() || {});
      reloadAutodartsWebsiteTabs();
      return;
    }
    const layout = normalizeLayout(theme.layout);
    const rawHit = findRawCustomThemeById(settings, id);
    const listKey = rawHit?.storageKey
      ? rawHit.storageKey
      : (layout === "vertical" ? "websiteCustomThemesVertical" : "websiteCustomThemesHorizontal");
    const list = parseCustomThemes(settings[listKey], layout);
    const prev = rawHit?.entry && typeof rawHit.entry === "object" ? { ...rawHit.entry } : {};
    const themeBd = theme.builderData && typeof theme.builderData === "object" ? theme.builderData : null;
    const prevBd = prev.builderData && typeof prev.builderData === "object" ? prev.builderData : {};
    const builderObj = themeBd && Object.keys(themeBd).length ? themeBd : prevBd;
    const entry = {
      ...prev,
      id,
      layout,
      label: String(theme.label || prev.label || id).trim() || id,
      css: String(theme.css || prev.css || "").trim(),
      builderData: builderObj,
      backgroundImageDataMatch: String(theme.backgroundImageDataMatch ?? prev.backgroundImageDataMatch ?? "").trim(),
      backgroundSize: normalizeBackgroundSize(theme.backgroundSize || prev.backgroundSize),
      arenaPrimaryHue: Number.isFinite(Number(theme.arenaPrimaryHue))
        ? Number(theme.arenaPrimaryHue)
        : prev.arenaPrimaryHue,
      arenaSecondaryHue: Number.isFinite(Number(theme.arenaSecondaryHue))
        ? Number(theme.arenaSecondaryHue)
        : prev.arenaSecondaryHue,
      arenaTertiaryHue: Number.isFinite(Number(theme.arenaTertiaryHue))
        ? Number(theme.arenaTertiaryHue)
        : prev.arenaTertiaryHue,
      galleryScreenshot: String(theme.galleryScreenshot ?? prev.galleryScreenshot ?? "").trim(),
      galleryScreenshotRef: String(theme.galleryScreenshotRef ?? prev.galleryScreenshotRef ?? "").trim(),
      author: String(theme.author || prev.author || "").trim(),
      sourceName: String(theme.sourceName || prev.sourceName || "").trim(),
      sourceUrl: String(theme.sourceUrl || prev.sourceUrl || "").trim(),
      stylebotPackUrl: String(theme.stylebotPackUrl || prev.stylebotPackUrl || "").trim(),
      description: String(theme.description || prev.description || "").trim(),
      tags: normalizeThemeTagsWithLayout(
        layout,
        Array.isArray(theme.tags) && theme.tags.length
          ? theme.tags
          : Array.isArray(prev.tags)
            ? prev.tags
            : []
      ),
      savedAt: Number.isFinite(Number(theme.savedAt)) ? Number(theme.savedAt) : (Number(prev.savedAt) || Date.now()),
      galleryUpdatedAt: (() => {
        const prevCss = String(prev.css || "").trim();
        const nextCss = String(theme.css || prev.css || "").trim();
        const prevBdStr = JSON.stringify(prevBd || {});
        const nextBdStr = JSON.stringify(builderObj || {});
        if (String(prev.id || "").toLowerCase() === id && (prevCss !== nextCss || prevBdStr !== nextBdStr)) {
          return Date.now();
        }
        return Number.isFinite(Number(prev.galleryUpdatedAt)) ? Number(prev.galleryUpdatedAt) : 0;
      })(),
      stylebotImport: !!(theme.stylebotImport || prev.stylebotImport)
    };
    const playIo =
      (theme.playAutodartsIo && typeof theme.playAutodartsIo === "object" && theme.playAutodartsIo) ||
      (theme["play.autodarts.io"] && typeof theme["play.autodarts.io"] === "object" ? theme["play.autodarts.io"] : null) ||
      (prev.playAutodartsIo && typeof prev.playAutodartsIo === "object" ? prev.playAutodartsIo : null) ||
      (prev["play.autodarts.io"] && typeof prev["play.autodarts.io"] === "object" ? prev["play.autodarts.io"] : null);
    if (playIo && typeof playIo === "object") {
      entry.playAutodartsIo = playIo;
      entry["play.autodarts.io"] = playIo;
    }
    const merged = upsertCustomThemeList(list, entry);
    const patch = {
      websiteLayout: layout,
      websiteTheme: id,
      [listKey]: JSON.stringify(merged),
      websiteThemeBuilderData: JSON.stringify(builderObj)
    };
    if (entry.backgroundImageDataMatch) {
      patch.websiteBackgroundImageDataMatch = entry.backgroundImageDataMatch;
    } else {
      patch.websiteBackgroundImageDataMatch = "";
      patch.websiteBackgroundImageData = "";
      patch.websiteBackgroundImageDataMenu = "";
    }
    patch.websiteBackgroundSize = entry.backgroundSize;
    if (Number.isFinite(entry.arenaPrimaryHue)) patch.websiteArenaPrimaryHue = entry.arenaPrimaryHue;
    if (Number.isFinite(entry.arenaSecondaryHue)) patch.websiteArenaSecondaryHue = entry.arenaSecondaryHue;
    if (Number.isFinite(entry.arenaTertiaryHue)) patch.websiteArenaTertiaryHue = entry.arenaTertiaryHue;
    await api.savePartial(patch);
    COMMUNITY_GALLERY_OPEN = false;
    paint(api.root, api.getSettings?.() || {});
    reloadAutodartsWebsiteTabs();
  }

  scope.ADM_MODULES.themes = {
    id: "themes",
    icon: "D",
    navLabelKey: "nav_themes",
    needs: { streamerbot: false, obs: false },
    render() {
      return `
        <h2 class="title"><span data-i18n="title_themes">Themes</span><span class="titleMeta">Autodarts</span></h2>
        <div class="card">
          <div class="formRow themeBuilderSection">
            <button id="startThemeBuilderBtn" class="btnPrimary fullWidthBtn" type="button">Theme Builder starten</button>
            <div id="themeBuilderSideNotice" class="admSidePanelWarning" hidden role="alert">
              <div class="admSidePanelWarningTitle" id="themeBuilderSideNoticeTitle"></div>
              <p class="admSidePanelWarningBody" id="themeBuilderSideNoticeBody"></p>
              <button type="button" class="btn admSidePanelWarningDismiss" id="themeBuilderSideNoticeDismiss" data-i18n="theme_builder_notice_dismiss">OK</button>
            </div>
            <div class="hint">Startet den Builder auf der Match-Seite.</div>
          </div>

          <div class="formRow">
            <div class="connectionInputHeader">
              <div class="label" id="websiteHideLeftMenuTitle" style="margin:0;">Menü ausblenden (Standard)</div>
              <label class="switch switchCompact" for="websiteHideLeftMenuByDefault" title="">
                <input id="websiteHideLeftMenuByDefault" type="checkbox" />
                <span class="slider"></span>
              </label>
            </div>
            <div class="hint" id="websiteHideLeftMenuHint" style="margin-top:8px;">Klicke oben links, um das Menü anzuzeigen oder auszublenden.</div>
          </div>

          <details class="bgUploadDropdown formRow">
            <summary class="btnPrimary fullWidthBtn bgUploadSummary"><span data-i18n="website_bg_title">Hintergrundbild</span></summary>
            <div class="bgUploadBody">
              <div class="label" style="margin:0 0 6px;" data-i18n="website_bg_section_ingame">Im Spiel (Board / erweiterte Ansicht)</div>
              <div id="websiteBackgroundDropZoneIngame" class="communityEmpty" style="border-style:dashed;cursor:copy;" data-i18n="website_bg_drop_hint">
                Bilddatei hierher ziehen — oder URL unten einfügen (wird automatisch übernommen).
              </div>
              <input type="file" id="websiteBackgroundFileInputIngame" accept="image/*" hidden />
              <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">
                <button type="button" class="btnPrimary" id="websiteBackgroundPickFileBtnIngame" data-i18n="website_bg_pick">Bild wählen …</button>
              </div>
              <input id="websiteBackgroundUrlFieldIngame" class="input" type="text" autocomplete="off" spellcheck="false" data-i18n-placeholder="website_bg_url_placeholder" placeholder="https://… — wird automatisch übernommen" style="width:100%;margin-top:8px;" />
              <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:8px;">
                <button type="button" class="btnPrimary" id="websiteBackgroundClearBtnIngame" data-i18n="website_bg_remove_ingame">Entfernen (Im Spiel)</button>
              </div>
              <div id="websiteBackgroundPreviewWrapIngame" class="hint" style="margin-top:8px;display:none;">
                <img id="websiteBackgroundPreviewIngame" alt="" style="max-width:100%;max-height:120px;border-radius:8px;border:1px solid rgba(127,127,127,.35);" />
              </div>

              <div class="label" style="margin:14px 0 6px;" data-i18n="website_bg_section_menu">Menü / ohne erweiterte Spielansicht</div>
              <div id="websiteBackgroundDropZoneMenu" class="communityEmpty" style="border-style:dashed;cursor:copy;" data-i18n="website_bg_drop_hint">
                Bilddatei hierher ziehen — oder URL unten einfügen (wird automatisch übernommen).
              </div>
              <input type="file" id="websiteBackgroundFileInputMenu" accept="image/*" hidden />
              <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">
                <button type="button" class="btnPrimary" id="websiteBackgroundPickFileBtnMenu" data-i18n="website_bg_pick">Bild wählen …</button>
              </div>
              <input id="websiteBackgroundUrlFieldMenu" class="input" type="text" autocomplete="off" spellcheck="false" data-i18n-placeholder="website_bg_url_placeholder" placeholder="https://… — wird automatisch übernommen" style="width:100%;margin-top:8px;" />
              <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:8px;">
                <button type="button" class="btnPrimary" id="websiteBackgroundClearBtnMenu" data-i18n="website_bg_remove_menu">Entfernen (Menü)</button>
              </div>
              <div id="websiteBackgroundPreviewWrapMenu" class="hint" style="margin-top:8px;display:none;">
                <img id="websiteBackgroundPreviewMenu" alt="" style="max-width:100%;max-height:120px;border-radius:8px;border:1px solid rgba(127,127,127,.35);" />
              </div>

              <div style="margin-top:10px;">
                <label class="label" for="websiteBackgroundSize">Darstellung</label>
                <select id="websiteBackgroundSize" class="input" style="width:100%;max-width:none;margin-top:6px;" title="Darstellung">
                  <option value="cover">Cover</option>
                  <option value="contain">Contain</option>
                  <option value="auto">Auto</option>
                </select>
              </div>
              <div class="hint" style="margin-top:8px;" data-i18n="website_bg_hint">Zwei Bilder möglich …</div>
            </div>
          </details>

          <div class="formRow">
            <div class="sectionHead">
              <div class="sectionTitle" style="margin:0;">Favoriten Galerie</div>
            </div>
            <div id="websiteFavoriteGalleryStrip" class="communityMiniRow"></div>
            <div style="margin-top:8px;">
              <button id="openCommunityThemeGallery" class="btnPrimary fullWidthBtn" type="button">Alle Themes durchsuchen</button>
            </div>
            <div class="hint">Eigene Builder-Themes, HUE/Dark (DeDomeD), Stylebot (tobyleif.com/autodarts) — Ausrichtung filtern, Suche nach Name/Ersteller. Favoriten-Stern: Leiste oben. In der Galerie: Auto-Update / ↻ lädt optional Katalog-JSON von tobyleif (adm-autodarts-catalog.json oder catalog.json).</div>
          </div>

          <div id="websiteHueModalMount" style="display:none">
            <div class="hueModalBackdrop" data-hue-backdrop="1">
              <div class="hueModalDialog">
                <div class="communityModalHeader">
                  <div>
                    <div id="websiteHueModalTitle" class="communityModalTitle">HUE Farben</div>
                    <div id="websiteHueModalMeta" class="communityModalMeta">Schnelle Farbanpassung für das HUE Theme</div>
                  </div>
                  <div class="communityModalHeaderActions">
                    <button class="btnPrimary" type="button" data-hue-close="1">Schließen</button>
                  </div>
                </div>
                <div class="hueModalBody">
                  <div class="list">
                    <div class="listToggle">
                      <div class="liText">
                        <div class="liTitle">Hauptfarbe (dunkel)</div>
                        <div class="liSub">Hue: <span id="websiteArenaPrimaryHueValue">210°</span></div>
                      </div>
                      <input id="websiteArenaPrimaryHue" class="hueSlider" type="range" min="0" max="360" step="1" />
                    </div>
                    <div class="listToggle">
                      <div class="liText">
                        <div class="liTitle">Sekundaerfarbe</div>
                        <div class="liSub">Hue: <span id="websiteArenaSecondaryHueValue">155°</span></div>
                      </div>
                      <input id="websiteArenaSecondaryHue" class="hueSlider" type="range" min="0" max="360" step="1" />
                    </div>
                    <div class="listToggle">
                      <div class="liText">
                        <div class="liTitle">Dritte Farbe</div>
                        <div class="liSub">Hue: <span id="websiteArenaTertiaryHueValue">125°</span></div>
                      </div>
                      <input id="websiteArenaTertiaryHue" class="hueSlider" type="range" min="0" max="360" step="1" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="formRow">
            <button id="resetWebsiteThemesBtn" class="btnPrimary fullWidthBtn" type="button">Alles zurücksetzen</button>
            <div class="hint">Wechselt auf Classic (horizontal), entfernt Hintergrundbilder, setzt Theme-Builder (inkl. Ziele) und Menü-/Glow-Defaults zurück und lädt alle offenen play.autodarts.io-Tabs neu — Galerie-Themes und Favoriten bleiben erhalten.</div>
          </div>
          <div id="websiteCommunityGalleryMount"></div>
        </div>
        <div class="spacer"></div>
      `;
    },
    bind(api) {
      const root = api.root;

      function hideThemeBuilderSideNotice() {
        const box = root.querySelector("#themeBuilderSideNotice");
        if (box) box.hidden = true;
      }
      function showThemeBuilderSideNotice(title, body) {
        const box = root.querySelector("#themeBuilderSideNotice");
        const tEl = root.querySelector("#themeBuilderSideNoticeTitle");
        const bEl = root.querySelector("#themeBuilderSideNoticeBody");
        if (tEl) tEl.textContent = title;
        if (bEl) bEl.textContent = body;
        if (box) {
          box.hidden = false;
          try {
            box.scrollIntoView({ behavior: "smooth", block: "nearest" });
          } catch {}
        }
        try {
          window.__ADM_APPLY_I18N__?.();
        } catch {}
      }
      root.querySelector("#themeBuilderSideNoticeDismiss")?.addEventListener("click", hideThemeBuilderSideNotice);

      api.bindAuto(root, "websiteArenaPrimaryHue", "websiteArenaPrimaryHue", "number");
      api.bindAuto(root, "websiteArenaSecondaryHue", "websiteArenaSecondaryHue", "number");
      api.bindAuto(root, "websiteArenaTertiaryHue", "websiteArenaTertiaryHue", "number");
      api.bindAuto(root, "websiteHideLeftMenuByDefault", "websiteHideLeftMenuByDefault");

      root.querySelector("#websiteArenaPrimaryHue")?.addEventListener("input", (ev) => {
        const v = normalizeHue(ev.target?.value, 210);
        const out = root.querySelector("#websiteArenaPrimaryHueValue");
        ev.target?.style?.setProperty?.("--hue", String(v));
        if (out) out.textContent = `${v}°`;
      });
      root.querySelector("#websiteArenaSecondaryHue")?.addEventListener("input", (ev) => {
        const v = normalizeHue(ev.target?.value, 155);
        const out = root.querySelector("#websiteArenaSecondaryHueValue");
        ev.target?.style?.setProperty?.("--hue", String(v));
        if (out) out.textContent = `${v}°`;
      });
      root.querySelector("#websiteArenaTertiaryHue")?.addEventListener("input", (ev) => {
        const v = normalizeHue(ev.target?.value, 125);
        const out = root.querySelector("#websiteArenaTertiaryHueValue");
        ev.target?.style?.setProperty?.("--hue", String(v));
        if (out) out.textContent = `${v}°`;
      });

      root.querySelector("#startThemeBuilderBtn")?.addEventListener("click", async () => {
        hideThemeBuilderSideNotice();
        try {
          if (chrome?.tabs?.query && chrome?.tabs?.sendMessage) {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
              const tabId = tabs?.[0]?.id;
              const settings = api.getSettings?.() || {};
              if (!Number.isInteger(tabId)) {
                showThemeBuilderSideNotice(
                  tr(settings, "Hinweis", "Notice"),
                  tr(settings, "Kein gültiger Browser-Tab.", "No valid browser tab.")
                );
                return;
              }
              chrome.tabs.sendMessage(tabId, { type: "ADM_START_THEME_BUILDER" }, (response) => {
                const le = chrome.runtime.lastError;
                if (le) {
                  showThemeBuilderSideNotice(
                    tr(settings, "Theme Builder", "Theme Builder"),
                    tr(
                      settings,
                      "Auf der aktiven Registerkarte läuft die Erweiterung nicht (keine play.autodarts.io-Match-Seite). Öffne eine Match-Seite und tippe erneut auf „Theme Builder starten“.",
                      "The active tab is not a play.autodarts.io match page with the extension. Open a match page, then tap “Start Theme Builder” again."
                    )
                  );
                  return;
                }
                if (!response || response.ok === false) {
                  const err = String(response?.error || "").trim();
                  showThemeBuilderSideNotice(
                    tr(settings, "Theme Builder", "Theme Builder"),
                    err
                      ? tr(settings, `Fehler: ${err}`, `Error: ${err}`)
                      : tr(
                          settings,
                          "Der Theme Builder konnte nicht gestartet werden.",
                          "Could not start the Theme Builder."
                        )
                  );
                  return;
                }
                if (response && response.emptyLayoutWarning) {
                  showThemeBuilderSideNotice(
                    tr(settings, "Hinweis", "Notice"),
                    tr(
                      settings,
                      "Dieses Theme enthält kein gespeichertes Theme-Builder-Layout (Galerie). Der Builder startet mit einem leeren Standard-Layout. Die bisherigen Builder-Daten in den Einstellungen wurden zurückgesetzt, damit sich Editor und Theme nicht gegenseitig stören.",
                      "This theme has no saved Theme Builder layout (gallery). The builder starts with an empty default layout. Previous builder data in settings was reset so the editor and theme do not conflict."
                    )
                  );
                  return;
                }
                try {
                  window.close();
                } catch {}
              });
            });
            return;
          }
        } catch {}
        try {
          window.close();
        } catch {}
      });

      const BG_STORAGE_INGAME = "websiteBackgroundImageDataMatch";
      const BG_STORAGE_MENU = "websiteBackgroundImageDataMenu";
      const BG_URL_DEBOUNCE_MS = 420;

      const applyBackgroundFromUrlSlot = async (storageKey, raw, errCtx = "URL", clearUrlInput) => {
        const settings = api.getSettings?.() || {};
        const url = pickFirstHttpUrl(raw);
        if (!url) {
          window.alert(tr(settings, "Bitte einen gültigen http(s)-Link angeben.", "Please provide a valid http(s) URL."));
          return;
        }
        try {
          const dataUrl = await compressImageUrlToDataUrl(url);
          await api.savePartial({ [storageKey]: dataUrl });
          if (clearUrlInput) clearUrlInput.value = "";
          paint(root, api.getSettings?.() || {});
        } catch (e) {
          const msg = String(e?.message || e || "");
          window.alert(tr(settings, `Bild von ${errCtx} konnte nicht geladen werden: ${msg}`, `Could not load image from ${errCtx}: ${msg}`));
        }
      };

      const applyBackgroundFromFileSlot = async (storageKey, file, errCtx = "Datei") => {
        const settings = api.getSettings?.() || {};
        if (!file) return;
        if (!String(file.type || "").startsWith("image/")) {
          window.alert(tr(settings, "Bitte eine Bilddatei wählen.", "Please choose an image file."));
          return;
        }
        if (file.size > 18 * 1024 * 1024) {
          window.alert(tr(settings, "Datei zu groß (max. ca. 18 MB).", "File too large (max ~18 MB)."));
          return;
        }
        try {
          const dataUrl = await compressImageFileToDataUrl(file);
          await api.savePartial({ [storageKey]: dataUrl });
          paint(root, api.getSettings?.() || {});
        } catch (e) {
          const msg = String(e?.message || e || "");
          window.alert(
            tr(settings, `Bild von ${errCtx} konnte nicht gelesen werden: ${msg}`, `Could not read image from ${errCtx}: ${msg}`)
          );
        }
      };

      function wireUrlAutoApply(storageKey, inputEl) {
        if (!inputEl) return;
        let debounceTimer = null;
        const run = async () => {
          debounceTimer = null;
          const v = String(inputEl.value || "").trim();
          if (!v) return;
          await applyBackgroundFromUrlSlot(storageKey, v, "URL", inputEl);
        };
        inputEl.addEventListener("input", () => {
          clearTimeout(debounceTimer);
          const v = String(inputEl.value || "").trim();
          if (!v) return;
          debounceTimer = setTimeout(run, BG_URL_DEBOUNCE_MS);
        });
        inputEl.addEventListener("keydown", async (ev) => {
          if (ev.key !== "Enter") return;
          ev.preventDefault();
          clearTimeout(debounceTimer);
          debounceTimer = null;
          await run();
        });
        inputEl.addEventListener("blur", () => {
          clearTimeout(debounceTimer);
          debounceTimer = null;
          const v = String(inputEl.value || "").trim();
          if (v) void run();
        });
      }

      function wireDropZone(storageKey, dropZone) {
        if (!dropZone) return;
        dropZone.addEventListener("dragover", (ev) => {
          ev.preventDefault();
          dropZone.style.borderColor = "rgba(25,199,255,.55)";
          dropZone.style.background = "rgba(25,199,255,.08)";
        });
        dropZone.addEventListener("dragleave", () => {
          dropZone.style.removeProperty("border-color");
          dropZone.style.removeProperty("background");
        });
        dropZone.addEventListener("drop", async (ev) => {
          ev.preventDefault();
          dropZone.style.removeProperty("border-color");
          dropZone.style.removeProperty("background");
          const urlField =
            storageKey === BG_STORAGE_INGAME
              ? root.querySelector("#websiteBackgroundUrlFieldIngame")
              : root.querySelector("#websiteBackgroundUrlFieldMenu");
          const data = ev.dataTransfer;
          const droppedFile = data?.files?.length
            ? Array.from(data.files).find((f) => f && String(f.type || "").startsWith("image/"))
            : null;
          if (droppedFile) {
            await applyBackgroundFromFileSlot(storageKey, droppedFile, "Drag&Drop");
            if (urlField) urlField.value = "";
            return;
          }
          const fromUriList = data?.getData?.("text/uri-list") || "";
          const fromPlain = data?.getData?.("text/plain") || "";
          const fromHtml = data?.getData?.("text/html") || "";
          const raw = fromUriList || fromPlain || fromHtml;
          await applyBackgroundFromUrlSlot(storageKey, raw, "Drag&Drop", urlField);
        });
      }

      wireUrlAutoApply(BG_STORAGE_INGAME, root.querySelector("#websiteBackgroundUrlFieldIngame"));
      wireUrlAutoApply(BG_STORAGE_MENU, root.querySelector("#websiteBackgroundUrlFieldMenu"));
      wireDropZone(BG_STORAGE_INGAME, root.querySelector("#websiteBackgroundDropZoneIngame"));
      wireDropZone(BG_STORAGE_MENU, root.querySelector("#websiteBackgroundDropZoneMenu"));

      root.querySelector("#websiteBackgroundClearBtnIngame")?.addEventListener("click", async () => {
        await api.savePartial({ websiteBackgroundImageDataMatch: "" });
        const el = root.querySelector("#websiteBackgroundUrlFieldIngame");
        if (el) el.value = "";
        paint(root, api.getSettings?.() || {});
      });
      root.querySelector("#websiteBackgroundClearBtnMenu")?.addEventListener("click", async () => {
        await api.savePartial({ websiteBackgroundImageDataMenu: "" });
        const el = root.querySelector("#websiteBackgroundUrlFieldMenu");
        if (el) el.value = "";
        paint(root, api.getSettings?.() || {});
      });

      const fileIngame = root.querySelector("#websiteBackgroundFileInputIngame");
      root.querySelector("#websiteBackgroundPickFileBtnIngame")?.addEventListener("click", () => fileIngame?.click?.());
      fileIngame?.addEventListener("change", async (ev) => {
        const input = ev.target;
        const file = input?.files?.[0];
        if (input) input.value = "";
        await applyBackgroundFromFileSlot(BG_STORAGE_INGAME, file, tr(api.getSettings?.() || {}, "Datei", "file"));
        const el = root.querySelector("#websiteBackgroundUrlFieldIngame");
        if (el) el.value = "";
      });

      const fileMenu = root.querySelector("#websiteBackgroundFileInputMenu");
      root.querySelector("#websiteBackgroundPickFileBtnMenu")?.addEventListener("click", () => fileMenu?.click?.());
      fileMenu?.addEventListener("change", async (ev) => {
        const input = ev.target;
        const file = input?.files?.[0];
        if (input) input.value = "";
        await applyBackgroundFromFileSlot(BG_STORAGE_MENU, file, tr(api.getSettings?.() || {}, "Datei", "file"));
        const el = root.querySelector("#websiteBackgroundUrlFieldMenu");
        if (el) el.value = "";
      });

      root.querySelector("#websiteBackgroundSize")?.addEventListener("change", async (ev) => {
        const v = normalizeBackgroundSize(ev.target?.value);
        await api.savePartial({ websiteBackgroundSize: v });
      });
      root.querySelector("#openCommunityThemeGallery")?.addEventListener("click", () => {
        COMMUNITY_GALLERY_OPEN = true;
        const st = api.getSettings?.() || {};
        paint(root, st);
        maybeTobyleifAutoRefreshOnGalleryOpen(api, st, root);
      });
      root.querySelector("#resetWebsiteThemesBtn")?.addEventListener("click", async () => {
        COMMUNITY_GALLERY_OPEN = false;
        HUE_MODAL_OPEN = false;
        const defaults = scope.ADM_MODULE_CONFIGS?.themes?.defaults || {};
        const patch = {
          websiteLayout: "horizontal",
          websiteTheme: "classic",
          websiteArenaPrimaryHue: Number.isFinite(Number(defaults.websiteArenaPrimaryHue)) ? Number(defaults.websiteArenaPrimaryHue) : 210,
          websiteArenaSecondaryHue: Number.isFinite(Number(defaults.websiteArenaSecondaryHue)) ? Number(defaults.websiteArenaSecondaryHue) : 155,
          websiteArenaTertiaryHue: Number.isFinite(Number(defaults.websiteArenaTertiaryHue)) ? Number(defaults.websiteArenaTertiaryHue) : 125,
          websiteThemeBuilderEnabled: false,
          websiteThemeBuilderData: "{}",
          websiteThemeBuilderTargets: "[]",
          websiteBackgroundImageDataMatch: "",
          websiteBackgroundImageData: "",
          websiteBackgroundImageDataMenu: "",
          websiteThemeGalleryBadgeStateJson: "{}",
          websiteBackgroundSize: String(defaults.websiteBackgroundSize || "cover").trim() || "cover",
          websiteHideLeftMenuByDefault: defaults.websiteHideLeftMenuByDefault !== false,
          websiteDartboardGlowEnabled: defaults.websiteDartboardGlowEnabled !== false
        };
        await api.savePartial(patch);
        paint(root, api.getSettings?.() || {});
        reloadAutodartsWebsiteTabs({ clearMenuLocalStorage: true, bypassCache: true });
      });

      root.addEventListener("input", (ev) => {
        if (!ev.target?.matches?.("[data-community-gallery-search]")) return;
        updateCommunityGalleryFilters(root);
      });
      root.addEventListener("change", async (ev) => {
        if (ev.target?.matches?.("[data-tobyleif-auto-update]")) {
          const on = !!ev.target.checked;
          await api.savePartial({ websiteThemeTobyleifAutoUpdate: on });
          const next = api.getSettings?.() || {};
          if (on) {
            await runTobyleifCatalogRefresh(api, next, { repaintRoot: true, apiRoot: root });
          } else {
            paint(root, next);
          }
          return;
        }
        if (!ev.target?.matches?.("[data-gallery-layout-filter]")) return;
        updateCommunityGalleryFilters(root);
      });

      root.addEventListener("click", async (ev) => {
        const target = ev.target;
        if (!target || !target.closest) return;
        const settings = api.getSettings?.() || {};

        const tobyRefresh = target.closest("[data-tobyleif-catalog-refresh]");
        if (tobyRefresh) {
          await runTobyleifCatalogRefresh(api, settings, { repaintRoot: true, apiRoot: root });
          return;
        }

        const closeGalleryBtn = target.closest("[data-community-close]");
        if (closeGalleryBtn) {
          COMMUNITY_GALLERY_OPEN = false;
          paint(root, settings);
          return;
        }

        const galleryBackdrop = target.closest(".communityModalBackdrop");
        if (galleryBackdrop && target === galleryBackdrop) {
          COMMUNITY_GALLERY_OPEN = false;
          paint(root, settings);
          return;
        }

        const closeHueBtn = target.closest("[data-hue-close]");
        if (closeHueBtn) {
          HUE_MODAL_OPEN = false;
          paint(root, settings);
          return;
        }

        const hueBackdrop = target.closest(".hueModalBackdrop");
        if (hueBackdrop && target === hueBackdrop) {
          HUE_MODAL_OPEN = false;
          paint(root, settings);
          return;
        }

        const favoriteBtn = target.closest("[data-community-favorite]");
        if (favoriteBtn) {
          const id = String(favoriteBtn.dataset.communityFavorite || "").toLowerCase();
          if (!id) return;
          const current = getCommunityFavorites(settings);
          const next = current.includes(id)
            ? current.filter((x) => x !== id)
            : [id, ...current];
          await api.savePartial({ websiteCommunityFavorites: JSON.stringify(next) });
          paint(root, api.getSettings?.() || {});
          return;
        }

        const sourceBtn = target.closest("[data-community-source]");
        if (sourceBtn) {
          const id = String(sourceBtn.dataset.communitySource || "").toLowerCase();
          const theme = getCommunityThemes(settings).find((x) => x.id === id);
          const url = String(theme?.sourceUrl || "").trim();
          if (!url) return;
          if (chrome?.tabs?.create) chrome.tabs.create({ url });
          else window.open(url, "_blank");
          return;
        }

        const deleteLocalBtn = target.closest("[data-community-delete-local]");
        if (deleteLocalBtn) {
          const id = String(deleteLocalBtn.dataset.communityDeleteLocal || "").toLowerCase();
          if (!id) return;
          const raw = findRawCustomThemeById(settings, id);
          if (!raw) return;
          const ok = window.confirm(
            tr(settings, "Dieses gespeicherte Layout wirklich löschen?", "Really delete this saved layout?")
          );
          if (!ok) return;
          const thumbRef = String(raw.entry?.galleryScreenshotRef || "").trim();
          if (thumbRef) {
            await new Promise((resolve) => {
              try {
                chrome.runtime.sendMessage({ type: "ADM_GALLERY_THUMB_DELETE", ref: thumbRef }, () => {
                  void chrome.runtime.lastError;
                  resolve();
                });
              } catch {
                resolve();
              }
            });
          }
          const themeLayout = raw.storageKey === "websiteCustomThemesVertical" ? "vertical" : "horizontal";
          const list = parseCustomThemes(settings[raw.storageKey], themeLayout);
          const filtered = list.filter((t) => String(t.id || "").toLowerCase() !== id);
          const patch = { [raw.storageKey]: JSON.stringify(filtered) };
          const curLayout = normalizeLayout(settings.websiteLayout);
          if (String(settings.websiteTheme || "").toLowerCase() === id && themeLayout === curLayout) {
            const builtins = getThemeSets()[curLayout] || [];
            const fallback = String(builtins[0]?.id || (curLayout === "vertical" ? "stack" : "classic"));
            patch.websiteTheme = fallback;
          }
          const favs = getCommunityFavorites(settings).filter((x) => x !== id);
          patch.websiteCommunityFavorites = JSON.stringify(favs);
          await api.savePartial(patch);
          paint(root, api.getSettings?.() || {});
          return;
        }

        const downloadBtn = target.closest("[data-community-download]");
        if (downloadBtn) {
          const id = String(downloadBtn.dataset.communityDownload || "").toLowerCase();
          const raw = findRawCustomThemeById(settings, id);
          if (!raw?.entry) return;
          const payload = {
            format: "autodarts-theme-pack",
            version: 1,
            exportedAt: new Date().toISOString(),
            theme: raw.entry
          };
          const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
          const a = document.createElement("a");
          const safeName = String(id || "theme").replace(/[^\w.-]+/g, "_").slice(0, 80);
          a.href = URL.createObjectURL(blob);
          a.download = `${safeName}.autodarts-theme.json`;
          a.click();
          setTimeout(() => {
            try {
              URL.revokeObjectURL(a.href);
            } catch {}
          }, 4000);
          return;
        }

        const applyCommunityBtn = target.closest("[data-community-apply]");
        if (applyCommunityBtn) {
          const id = String(applyCommunityBtn.dataset.communityApply || "").toLowerCase();
          if (!id) return;
          await applyCommunityTheme(api, settings, id);
          return;
        }

        const quickThemeBtn = target.closest("[data-quick-theme]");
        if (quickThemeBtn) {
          const id = String(quickThemeBtn.dataset.quickTheme || "").toLowerCase();
          if (!id) return;
          const nextTheme = normalizeTheme("horizontal", id, settings);
          HUE_MODAL_OPEN = themeSupportsColorPopup("horizontal", nextTheme);
          await api.savePartial({ websiteLayout: "horizontal", websiteTheme: nextTheme, websiteThemeBuilderData: "{}" });
          reloadAutodartsWebsiteTabs();
          return;
        }

        const layoutBtn = target.closest("[data-layout]");
        if (layoutBtn) {
          const layout = normalizeLayout(layoutBtn.dataset.layout);
          const nextTheme = normalizeTheme(layout, settings?.websiteTheme, settings);
          HUE_MODAL_OPEN = themeSupportsColorPopup(layout, nextTheme);
          await api.savePartial({ websiteLayout: layout, websiteTheme: nextTheme, websiteThemeBuilderData: "{}" });
          reloadAutodartsWebsiteTabs();
          return;
        }

        const themeBtn = target.closest("[data-theme]");
        if (themeBtn) {
          const layout = normalizeLayout(settings?.websiteLayout);
          const wanted = String(themeBtn.dataset.theme || "");
          const nextTheme = normalizeTheme(layout, wanted, settings);
          HUE_MODAL_OPEN = themeSupportsColorPopup(layout, nextTheme);
          await api.savePartial({ websiteLayout: layout, websiteTheme: nextTheme, websiteThemeBuilderData: "{}" });
          reloadAutodartsWebsiteTabs();
          return;
        }
      });

      ensureTobyleifCatalogRefreshOnPanelVisible(api, root);
    },
    sync(api, settings) {
      const root = api.root;
      const s = settings || {};
      paint(root, s);
    }
  };
})(window);
