(function () {
  const DEFAULT_RADIUS_NORM = 0.42;
  const SVG_NS = "http://www.w3.org/2000/svg";

  async function send(msg) {
    return chrome.runtime.sendMessage(msg);
  }

  async function savePartial(partial) {
    const res = await send({ type: "SET_SETTINGS", settings: partial || {} });
    if (!res?.ok || !res.settings) throw new Error(String(res?.error || "save_failed"));
    return res.settings;
  }

  let SETTINGS = {};
  let screenshotRaw = "";
  /** @type {"pgm"|"source"|"file"|"unknown"} */
  let previewSpace = "unknown";
  /**
   * PGM: Rechteck der Ziel-Quelle im Screenshot + Crop — für Canvas→Quellen-UV.
   * @type {null | { imgW: number, imgH: number, rect: { left: number, top: number, width: number, height: number }, sourceWidth: number, sourceHeight: number, cropLeft: number, cropRight: number, cropTop: number, cropBottom: number }}
   */
  let previewPlacement = null;
  /** PGM: zuletzt erkannte Programm-Szene (für OBS-Placement — muss zur Vorschau passen). */
  let lastProgramSceneName = "";

  const img = () => document.getElementById("calibImg");
  const layoutSvg = () => document.getElementById("calibLayoutSvg");
  const zoomInner = () => document.getElementById("calibZoomInner");
  const shell = () => document.getElementById("calibImgShell");
  const reticle = () => document.getElementById("calibReticle");
  const stageRow = () => document.getElementById("calibStageRow");
  const wizardBanner = () => document.getElementById("calibWizardBanner");

  let layoutActive = false;
  let boardCenterU = 0.5;
  let boardCenterV = 0.5;

  /** @type {Map<string, { u: number, v: number, du?: number, dv?: number }>} — du/dv = Klick in Vorschau-UV (PGM), u/v = Quellen-UV für OBS */
  const filterUvByName = new Map();

  /** @type {{ name: string, pointerId: number } | null} */
  let dragState = null;
  /** Nach Marker-Ziehen: ein folgender Klick auf die Shell sonst als nächstes Feld gewertet — unterdrücken. */
  let markerDragMoved = false;
  let skipNextShellClick = false;
  let renderMarkersQueued = false;

  /** null | "triple" | "double" | "single" | "other" — nacheinander Klicks auf die Scheibe */
  let fieldCalibCategory = null;
  /** @type {string[]} */
  let fieldCalibNames = [];
  let fieldCalibIndex = 0;

  const CATEGORY_ORDER = ["triple", "double", "single", "other"];
  /** Aktuelle Position für Zurück/Weiter (0 = Triple … 3 = Sonstiges). */
  let categoryRingIndex = 0;

  let persistCalibTimer = null;

  function $(id) {
    return document.getElementById(id);
  }

  function normalizeText(v) {
    return String(v || "").trim();
  }

  function clamp01(x) {
    return Math.min(1, Math.max(0, x));
  }

  function previewUsesCanvasRemap() {
    return (
      previewSpace === "pgm" &&
      previewPlacement &&
      previewPlacement.rect &&
      previewPlacement.rect.width > 1 &&
      previewPlacement.rect.height > 1
    );
  }

  /** Klick-UV auf dem Bild → normalisierte Quellen-Textur (0–1), wie OBS-Move-Filter sie erwarten. */
  function displayUvToSourceUv(u, v) {
    if (!previewUsesCanvasRemap()) return { u: clamp01(u), v: clamp01(v) };
    const pl = previewPlacement;
    const cw = pl.imgW;
    const ch = pl.imgH;
    const px = u * cw;
    const py = v * ch;
    const r = pl.rect;
    const lx = (px - r.left) / r.width;
    const ly = (py - r.top) / r.height;
    const sw = Math.max(1, pl.sourceWidth);
    const sh = Math.max(1, pl.sourceHeight);
    const cl = pl.cropLeft;
    const cr = pl.cropRight;
    const ct = pl.cropTop;
    const cb = pl.cropBottom;
    const vizw = Math.max(1, sw - cl - cr);
    const vizh = Math.max(1, sh - ct - cb);
    const nx = cl / sw + clamp01(lx) * (vizw / sw);
    const ny = ct / sh + clamp01(ly) * (vizh / sh);
    return { u: clamp01(nx), v: clamp01(ny) };
  }

  /** Quellen-UV → Anzeige-UV auf dem PGM-Bild (Marker / Reticle). */
  function sourceUvToDisplayUv(nx, ny) {
    if (!previewUsesCanvasRemap()) return { u: clamp01(nx), v: clamp01(ny) };
    const pl = previewPlacement;
    const sw = Math.max(1, pl.sourceWidth);
    const sh = Math.max(1, pl.sourceHeight);
    const cl = pl.cropLeft;
    const cr = pl.cropRight;
    const ct = pl.cropTop;
    const cb = pl.cropBottom;
    const vizw = Math.max(1, sw - cl - cr);
    const vizh = Math.max(1, sh - ct - cb);
    const sxPix = clamp01(nx) * sw;
    const syPix = clamp01(ny) * sh;
    const lx = (sxPix - cl) / vizw;
    const ly = (syPix - ct) / vizh;
    const r = pl.rect;
    const cw = pl.imgW;
    const ch = pl.imgH;
    const px = r.left + clamp01(lx) * r.width;
    const py = r.top + clamp01(ly) * r.height;
    return { u: clamp01(px / cw), v: clamp01(py / ch) };
  }

  function setStatus(t) {
    const el = $("calibStatus");
    if (el) el.textContent = String(t || "");
  }

  function dataUrlFromObsImage(raw) {
    const s = String(raw || "").trim();
    if (!s) return "";
    if (s.startsWith("data:")) return s;
    return `data:image/jpeg;base64,${s}`;
  }

  function buildFilterNamesForSettings() {
    const names = ["Main", "Bull", "DBull", "Miss"];
    if (SETTINGS.obsZoomIncludeSingles !== false) {
      for (let i = 1; i <= 20; i += 1) names.push(`S${String(i).padStart(2, "0")}`);
    }
    if (SETTINGS.obsZoomIncludeTriples !== false) {
      for (let i = 1; i <= 20; i += 1) names.push(`T${String(i).padStart(2, "0")}`);
    }
    if (SETTINGS.obsZoomIncludeDoubles !== false) {
      for (let i = 1; i <= 20; i += 1) names.push(`D${String(i).padStart(2, "0")}`);
    }
    return names;
  }

  function getObsZoomPercent() {
    const n = Number($("calibObsZoomSlider")?.value);
    if (!Number.isFinite(n)) return 100;
    return Math.min(400, Math.max(50, Math.round(n)));
  }

  /** Pan-Stärke für OBS (nur noch aus Einstellungen / Speichern, kein Feld auf dieser Seite). */
  function getObsZoomPanStrength() {
    return Math.max(1, Number.isFinite(Number(SETTINGS.obsZoomStrength)) ? Number(SETTINGS.obsZoomStrength) : 150);
  }

  function syncObsZoomReadout() {
    const el = $("calibZoomReadout");
    if (el) el.textContent = `${getObsZoomPercent()} %`;
  }

  function setCalibCaptureUi(on) {
    const sh = shell();
    if (sh) sh.classList.toggle("calib-waitingCalib", !!on);
  }

  function updateWizardBanner(text) {
    const el = wizardBanner();
    if (!el) return;
    const s = String(text || "").trim();
    if (!s) {
      el.hidden = true;
      el.textContent = "";
    } else {
      el.hidden = false;
      el.textContent = s;
    }
  }

  function categoryLabelDe(cat) {
    if (cat === "triple") return "Triple";
    if (cat === "double") return "Double";
    if (cat === "single") return "Single";
    if (cat === "other") return "Sonstiges";
    return String(cat || "");
  }

  function syncCategoryNav() {
    const im = img();
    const ok = !!im?.naturalWidth;
    const cat =
      fieldCalibCategory && CATEGORY_ORDER.includes(fieldCalibCategory)
        ? fieldCalibCategory
        : CATEGORY_ORDER[categoryRingIndex];
    const lab = $("calibCatLabel");
    if (lab) lab.textContent = categoryLabelDe(cat);
    const prev = $("btnCalibCatPrev");
    const next = $("btnCalibCatNext");
    if (prev) prev.disabled = !ok;
    if (next) next.disabled = !ok;
  }

  function refreshIdleBanner() {
    if (fieldCalibCategory) return;
    const im = img();
    if (!im?.naturalWidth) return;
    updateWizardBanner(
      `${categoryLabelDe(CATEGORY_ORDER[categoryRingIndex])}: Mit „Zurück“ / „Weiter“ die Kategorie wechseln, dann nacheinander auf die Vorschau klicken. Grüne Punkte = gespeicherte Treffer.`
    );
  }

  function schedulePersistCalib() {
    if (persistCalibTimer) clearTimeout(persistCalibTimer);
    persistCalibTimer = setTimeout(() => {
      persistCalibTimer = null;
      void (async () => {
        try {
          await flushPersistCalibImmediate();
        } catch (e) {
          setStatus(String(e?.message || e));
        }
      })();
    }, 800);
  }

  /** Speichert Zoom/Stärke und — sobald Marker existieren — Punktlage (Merge Speicher + Map, keine layoutActive-Sperre). */
  async function flushPersistCalibImmediate() {
    if (persistCalibTimer) {
      clearTimeout(persistCalibTimer);
      persistCalibTimer = null;
    }
    const partial = {
      obsZoomStrength: getObsZoomPanStrength(),
      obsZoomCalibZoomPercent: getObsZoomPercent()
    };
    if (filterUvByName.size > 0) {
      const merged = { ...parseStoredCalibPoints(), ...pointsMapForObs() };
      partial.obsZoomCalibPointsJson = JSON.stringify(merged);
    }
    SETTINGS = await savePartial(partial);
  }

  function forceStartFieldCalibCategory(cat) {
    const im = img();
    if (!im?.naturalWidth) {
      setStatus("Zuerst Vorschau laden (Aktualisieren).");
      updateWizardBanner("");
      return;
    }
    const idx = CATEGORY_ORDER.indexOf(cat);
    if (idx >= 0) categoryRingIndex = idx;
    const names = buildNamesForCategory(cat);
    if (!names.length) {
      setStatus(
        `${categoryLabelDe(cat)} ist im Zoom-Modul deaktiviert — mit „Weiter“/„Zurück“ eine andere Kategorie.`
      );
      syncCategoryNav();
      refreshIdleBanner();
      return;
    }
    fieldCalibCategory = cat;
    fieldCalibNames = names;
    fieldCalibIndex = 0;
    setCalibCaptureUi(true);
    syncCategoryNav();
    refreshFieldCalibBanner();
    setStatus("");
  }

  function shiftCategoryRing(delta) {
    if (!img()?.naturalWidth) {
      setStatus("Zuerst Vorschau laden (Aktualisieren).");
      return;
    }
    let idx = categoryRingIndex;
    for (let step = 0; step < CATEGORY_ORDER.length; step += 1) {
      idx = (idx + delta + CATEGORY_ORDER.length) % CATEGORY_ORDER.length;
      const cat = CATEGORY_ORDER[idx];
      if (buildNamesForCategory(cat).length > 0) {
        categoryRingIndex = idx;
        forceStartFieldCalibCategory(cat);
        return;
      }
    }
    setStatus("Keine Kategorie aktiv (Triple/Double/Single im Zoom-Modul prüfen).");
  }

  /** Standard-Scheibe im Uhrzeigersinn ab 20 oben (wie DartboardLayout). */
  const DARTBOARD_SEGMENT_ORDER_FALLBACK = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];

  function dartboardSegmentOrderClockwise() {
    const o = window.DartboardLayout?.DARTBOARD_SEGMENT_ORDER;
    if (Array.isArray(o) && o.length === 20) return o;
    return DARTBOARD_SEGMENT_ORDER_FALLBACK;
  }

  function buildNamesForCategory(cat) {
    const order = dartboardSegmentOrderClockwise();
    const asPref = (prefix) => order.map((n) => `${prefix}${String(n).padStart(2, "0")}`);
    if (cat === "triple") {
      if (SETTINGS.obsZoomIncludeTriples === false) return [];
      return asPref("T");
    }
    if (cat === "double") {
      if (SETTINGS.obsZoomIncludeDoubles === false) return [];
      return asPref("D");
    }
    if (cat === "single") {
      if (SETTINGS.obsZoomIncludeSingles === false) return [];
      return asPref("S");
    }
    if (cat === "other") {
      return ["Main", "Bull", "DBull", "Miss"];
    }
    return [];
  }

  /** Kurzer Hinweis im Banner: wo der Nutzer als Nächstes klicken soll. */
  function fieldCalibInstruction(fn) {
    const up = String(fn || "").toUpperCase();
    if (up === "MAIN") return "Bitte auf die Bull-Mitte klicken (Main)";
    if (up === "BULL") return "Bitte auf den Outer Bull klicken (Bull)";
    if (up === "DBULL") return "Bitte auf den Double Bull klicken";
    if (up === "MISS") return "Bitte auf den Miss-Bereich klicken";
    return `Bitte auf ${fn} klicken`;
  }

  function refreshFieldCalibBanner() {
    if (!fieldCalibCategory || fieldCalibIndex >= fieldCalibNames.length) {
      updateWizardBanner("");
      return;
    }
    const nm = fieldCalibNames[fieldCalibIndex];
    updateWizardBanner(
      `${fieldCalibInstruction(nm)} — ${fieldCalibIndex + 1} von ${fieldCalibNames.length}`
    );
  }

  function cancelFieldCalibMode(clearStatus) {
    fieldCalibCategory = null;
    fieldCalibNames = [];
    fieldCalibIndex = 0;
    setCalibCaptureUi(false);
    syncCategoryNav();
    if (clearStatus) setStatus("");
    refreshIdleBanner();
  }

  function categoryDoneMessage(cat) {
    if (cat === "triple") return "Alle Triple-Felder gesetzt.";
    if (cat === "double") return "Alle Double-Felder gesetzt.";
    if (cat === "single") return "Alle Single-Felder gesetzt.";
    if (cat === "other") return "Sonstiges abgeschlossen (Main, Bull, D-Bull, Miss).";
    return "Kategorie fertig.";
  }

  function eventToUv(imgEl, clientX, clientY) {
    const ir = imgEl.getBoundingClientRect();
    const nw = imgEl.naturalWidth;
    const nh = imgEl.naturalHeight;
    if (!nw || !nh) return { u: 0.5, v: 0.5 };
    const scale = Math.min(ir.width / nw, ir.height / nh);
    const dw = nw * scale;
    const dh = nh * scale;
    const ox = (ir.width - dw) / 2;
    const oy = (ir.height - dh) / 2;
    const x = clientX - ir.left - ox;
    const y = clientY - ir.top - oy;
    return {
      u: Math.min(1, Math.max(0, x / dw)),
      v: Math.min(1, Math.max(0, y / dh))
    };
  }

  function uvToOverlayPx(imgEl, u0, v0) {
    const iw = imgEl.offsetWidth;
    const ih = imgEl.offsetHeight;
    const nw = imgEl.naturalWidth;
    const nh = imgEl.naturalHeight;
    if (!iw || !ih || !nw || !nh) return { x: 0, y: 0 };
    const sc = Math.min(iw / nw, ih / nh);
    const dw = nw * sc;
    const dh = nh * sc;
    const ox = (iw - dw) / 2;
    const oy = (ih - dh) / 2;
    return { x: ox + u0 * dw, y: oy + v0 * dh };
  }

  function reticleDiameterPx(zoomPct, dw, dh) {
    const z = Math.max(50, Math.min(400, zoomPct));
    const m = Math.min(dw, dh);
    if (!Number.isFinite(m) || m <= 0) return 32;
    const factor = 100 / z;
    const d = factor * DEFAULT_RADIUS_NORM * m;
    return Math.round(Math.min(Math.max(d, 14), 0.92 * m));
  }

  function positionReticle(imgEl, reticleEl, u0, v0, zoomPct) {
    if (!imgEl?.naturalWidth || !reticleEl) return;
    const shellEl = imgEl.closest?.(".calib-imgShell") || imgEl.parentElement?.parentElement;
    if (!shellEl) return;
    const ir = imgEl.getBoundingClientRect();
    const sr = shellEl.getBoundingClientRect();
    const nw = imgEl.naturalWidth;
    const nh = imgEl.naturalHeight;
    const scale = Math.min(ir.width / nw, ir.height / nh);
    const dw = nw * scale;
    const dh = nh * scale;
    const ox = (ir.width - dw) / 2;
    const oy = (ir.height - dh) / 2;
    const cx = ir.left - sr.left + ox + u0 * dw;
    const cy = ir.top - sr.top + oy + v0 * dh;
    const d = reticleDiameterPx(zoomPct, dw, dh);
    const half = d / 2;
    reticleEl.style.width = `${d}px`;
    reticleEl.style.height = `${d}px`;
    reticleEl.style.marginLeft = `${-half}px`;
    reticleEl.style.marginTop = `${-half}px`;
    reticleEl.style.left = `${cx}px`;
    reticleEl.style.top = `${cy}px`;
  }

  function refreshReticle() {
    const el = img();
    const rt = reticle();
    if (!el || !rt) return;
    const z = getObsZoomPercent();
    if (layoutActive) positionReticle(el, rt, boardCenterU, boardCenterV, z);
    else positionReticle(el, rt, 0.5, 0.5, z);
  }

  function updateZoomInnerOrigin() {
    const zi = zoomInner();
    if (!zi) return;
    if (layoutActive) {
      zi.style.transformOrigin = `${boardCenterU * 100}% ${boardCenterV * 100}%`;
    } else {
      zi.style.transformOrigin = "50% 50%";
    }
  }

  function applyPreviewTransform() {
    const zi = zoomInner();
    if (!zi) return;
    updateZoomInnerOrigin();
    zi.style.transform = "scale(1)";
    requestAnimationFrame(() => {
      refreshReticle();
      if (layoutActive) renderManualMarkers();
    });
  }

  function clearLayoutOverlay() {
    const svg = layoutSvg();
    if (svg) svg.innerHTML = "";
  }

  function refRadiusOverlayPx() {
    const im = img();
    if (!im) return 0;
    const nw = im.naturalWidth;
    const nh = im.naturalHeight;
    if (!nw || !nh) return 0;
    const rNat = DEFAULT_RADIUS_NORM * (Math.min(nw, nh) / 2);
    const sc = Math.min(im.offsetWidth / nw, im.offsetHeight / nh);
    return rNat * sc;
  }

  function filterDotStyle(name) {
    const up = String(name).toUpperCase();
    if (up === "MAIN") return { r: 7, fill: "#ffd54a", label: true, fs: 11 };
    if (up === "BULL" || up === "DBULL" || up === "MISS") {
      return { r: 6, fill: "#39ff14", label: true, fs: 10 };
    }
    if (/^T\d/.test(up)) return { r: 4, fill: "#39ff14", label: true, fs: 8 };
    if (/^D\d/.test(up)) return { r: 3.5, fill: "#7aff9a", label: true, fs: 7 };
    return { r: 2.5, fill: "#b8ffc8", label: false, fs: 0 };
  }

  function renderManualMarkers() {
    const svg = layoutSvg();
    const im = img();
    const zi = zoomInner();
    if (!svg || !im?.naturalWidth || !zi || !layoutActive) return;
    const iw = Math.max(1, im.offsetWidth);
    const ih = Math.max(1, im.offsetHeight);
    svg.setAttribute("width", String(iw));
    svg.setAttribute("height", String(ih));
    svg.setAttribute("viewBox", `0 0 ${iw} ${ih}`);

    const frag = document.createDocumentFragment();
    const pCenter = uvToOverlayPx(im, boardCenterU, boardCenterV);
    const rRef = refRadiusOverlayPx();

    const ringEl = document.createElementNS(SVG_NS, "circle");
    ringEl.setAttribute("cx", String(pCenter.x));
    ringEl.setAttribute("cy", String(pCenter.y));
    ringEl.setAttribute("r", String(Math.max(1, rRef)));
    ringEl.setAttribute("fill", "none");
    ringEl.setAttribute("stroke", "rgba(57,255,20,0.35)");
    ringEl.setAttribute("stroke-width", "1.5");
    ringEl.setAttribute("stroke-dasharray", "5 5");
    ringEl.setAttribute("pointer-events", "none");
    frag.appendChild(ringEl);

    const names = buildFilterNamesForSettings().filter((n) => filterUvByName.has(n));
    const ordered = names.filter((n) => n !== "Main");
    ordered.push("Main");

    function appendMarker(fn) {
      const pos = filterUvByName.get(fn);
      if (!pos) return;
      const st = filterDotStyle(fn);
      const disp = sourceUvToDisplayUv(pos.u, pos.v);
      const pt = uvToOverlayPx(im, disp.u, disp.v);
      const g = document.createElementNS(SVG_NS, "g");
      g.setAttribute("class", fn === "Main" ? "calib-marker calib-marker-main" : "calib-marker");
      g.setAttribute("data-filter", fn);

      const hitR = Math.max(12, st.r + 8);
      const hit = document.createElementNS(SVG_NS, "circle");
      hit.setAttribute("class", "calib-marker-hit");
      hit.setAttribute("cx", String(pt.x));
      hit.setAttribute("cy", String(pt.y));
      hit.setAttribute("r", String(hitR));
      hit.setAttribute("fill", "transparent");
      g.appendChild(hit);

      const dc = document.createElementNS(SVG_NS, "circle");
      dc.setAttribute("cx", String(pt.x));
      dc.setAttribute("cy", String(pt.y));
      dc.setAttribute("r", String(st.r));
      dc.setAttribute("fill", st.fill);
      dc.setAttribute("stroke", "rgba(0,50,30,0.45)");
      dc.setAttribute("stroke-width", "0.75");
      dc.setAttribute("pointer-events", "none");
      g.appendChild(dc);

      if (st.label && st.fs > 0) {
        const tx = document.createElementNS(SVG_NS, "text");
        tx.setAttribute("x", String(pt.x));
        tx.setAttribute("y", String(pt.y - st.r - 3));
        tx.setAttribute("text-anchor", "middle");
        tx.setAttribute("fill", fn === "Main" ? "#1a1408" : "#e8fff0");
        tx.setAttribute("font-size", String(st.fs));
        tx.setAttribute("font-family", "system-ui,Segoe UI,sans-serif");
        tx.setAttribute("font-weight", "600");
        tx.setAttribute("pointer-events", "none");
        tx.textContent = fn;
        g.appendChild(tx);
      }
      frag.appendChild(g);
    }

    for (let i = 0; i < ordered.length; i += 1) appendMarker(ordered[i]);

    svg.innerHTML = "";
    svg.appendChild(frag);
  }

  function scheduleRenderMarkers() {
    if (renderMarkersQueued || !layoutActive) return;
    renderMarkersQueued = true;
    requestAnimationFrame(() => {
      renderMarkersQueued = false;
      renderManualMarkers();
    });
  }

  function resetLayoutState() {
    cancelFieldCalibMode(false);
    layoutActive = false;
    filterUvByName.clear();
    clearLayoutOverlay();
    updateZoomInnerOrigin();
    applyPreviewTransform();
    refreshReticle();
  }

  function pointsMapForObs() {
    const o = {};
    filterUvByName.forEach((uv, k) => {
      const rec = { nx: uv.u, ny: uv.v };
      if (Number.isFinite(uv.du)) rec.du = uv.du;
      if (Number.isFinite(uv.dv)) rec.dv = uv.dv;
      o[k] = rec;
    });
    return o;
  }

  /** Nur nx/ny für OBS-WebSocket-Payload. */
  function stripCalibPointsForObsPayload(record) {
    const out = {};
    for (const [k, p] of Object.entries(record || {})) {
      if (!p || typeof p !== "object") continue;
      if (Number.isFinite(Number(p.nx)) && Number.isFinite(Number(p.ny))) {
        out[k] = { nx: Number(p.nx), ny: Number(p.ny) };
      }
    }
    return out;
  }

  /** Aus Extension-Einstellungen: Record<filterName, { nx, ny, du?, dv? }> */
  function parseStoredCalibPoints() {
    try {
      const raw = SETTINGS?.obsZoomCalibPointsJson || "{}";
      const obj = typeof raw === "string" ? JSON.parse(raw) : raw;
      const map = obj?.points && typeof obj.points === "object" ? obj.points : obj;
      if (!map || typeof map !== "object") return {};
      const out = {};
      for (const [k, p] of Object.entries(map)) {
        if (p && Number.isFinite(Number(p.nx)) && Number.isFinite(Number(p.ny))) {
          const rec = { nx: Number(p.nx), ny: Number(p.ny) };
          if (Number.isFinite(Number(p.du))) rec.du = Number(p.du);
          if (Number.isFinite(Number(p.dv))) rec.dv = Number(p.dv);
          out[k] = rec;
        }
      }
      return out;
    } catch {
      return {};
    }
  }

  /** Nach frischer OBS-Placement: Quellen-UV aus gespeicherten Vorschau-Klicks neu berechnen. */
  function recomputeAllCalibSourceUvFromDisplay() {
    if (!previewUsesCanvasRemap()) return;
    for (const [k, uv] of [...filterUvByName.entries()]) {
      if (!Number.isFinite(uv.du) || !Number.isFinite(uv.dv)) continue;
      const src = displayUvToSourceUv(uv.du, uv.dv);
      filterUvByName.set(k, { ...uv, u: src.u, v: src.v, du: uv.du, dv: uv.dv });
    }
    scheduleRenderMarkers();
  }

  async function refreshPgmPlacementFromObs(im) {
    const tgt = normalizeText(SETTINGS.obsZoomTargetSource);
    const scene =
      normalizeText(lastProgramSceneName) || normalizeText(SETTINGS.obsZoomSceneName);
    await refreshPreviewPlacement(im, scene, tgt);
  }

  /**
   * Für OBS: gespeicherte Punktlage + **Live-Marker** (Map überschreibt — nie nur alte Defaults,
   * wenn der Nutzer schon Marker im Speicher hat).
   */
  function pointsRecordForObsApply() {
    const stored = parseStoredCalibPoints();
    const live = pointsMapForObs();
    if (Object.keys(live).length === 0) return stored;
    return { ...stored, ...live };
  }

  /**
   * Wendet die Kalibrier-Punkte auf die OBS-Move-Filter an.
   * @param {Record<string, { nx: number, ny: number }>} pointsRecord
   * @param {{ persist?: boolean, statusMsg?: string }} opts persist: auch in Extension speichern
   */
  async function applyZoomToObs(pointsRecord, opts) {
    const persist = opts?.persist === true;
    const strength = getObsZoomPanStrength();
    const zoomPercent = getObsZoomPercent();
    const sceneName = normalizeText(SETTINGS.obsZoomSceneName);
    const targetSourceName = normalizeText(SETTINGS.obsZoomTargetSource);
    if (!sceneName || !targetSourceName) {
      setStatus("Szene und Ziel-Quelle im Zoom-Modul (Extension-Popup) eintragen — dann wirkt „Filter anwenden“.");
      return;
    }
    const obsPoints = stripCalibPointsForObsPayload(pointsRecord);
    if (persist) {
      SETTINGS = await savePartial({
        obsZoomSceneName: sceneName,
        obsZoomTargetSource: targetSourceName,
        obsZoomStrength: strength,
        obsZoomCalibZoomPercent: zoomPercent,
        obsZoomCalibPointsJson: JSON.stringify(pointsRecord)
      });
    }
    const res = await send({
      type: "OBS_APPLY_ZOOM_CALIBRATION",
      payload: {
        sceneName,
        targetSourceName,
        canvasMode: false,
        points: obsPoints,
        strength,
        zoomPercent,
        includeSingles: SETTINGS.obsZoomIncludeSingles !== false,
        includeDoubles: SETTINGS.obsZoomIncludeDoubles !== false,
        includeTriples: SETTINGS.obsZoomIncludeTriples !== false
      }
    });
    if (!res?.ok) throw new Error(String(res?.error || "apply"));
    const errN = Array.isArray(res?.errors) ? res.errors.length : 0;
    const def = `OBS: ${res.applied || 0} Filter${errN ? `, ${errN} Fehler` : ""}.`;
    setStatus(opts?.statusMsg || def);
  }

  /**
   * @param {unknown} obj Rohes JSON: entweder `Record<name,{nx,ny}>` oder `{ points: { … } }`
   * @returns {boolean} true wenn mindestens ein Punkt übernommen wurde
   */
  function applyPointsMapFromJsonObject(obj) {
    const im = img();
    if (!im?.naturalWidth) return false;
    let map = obj;
    if (obj && typeof obj === "object" && obj.points && typeof obj.points === "object") {
      map = obj.points;
    }
    if (!map || typeof map !== "object") return false;
    cancelFieldCalibMode(false);
    filterUvByName.clear();
    let n = 0;
    for (const [k, p] of Object.entries(map)) {
      if (p && Number.isFinite(Number(p.nx)) && Number.isFinite(Number(p.ny))) {
        const u = Number(p.nx);
        const v = Number(p.ny);
        let du = Number(p.du);
        let dv = Number(p.dv);
        if (!Number.isFinite(du) || !Number.isFinite(dv)) {
          const d = sourceUvToDisplayUv(u, v);
          du = d.u;
          dv = d.v;
        }
        filterUvByName.set(k, { u, v, du, dv });
        n += 1;
      }
    }
    if (n === 0) return false;
    const main = filterUvByName.get("Main");
    if (main) {
      boardCenterU = Number.isFinite(main.du) ? main.du : sourceUvToDisplayUv(main.u, main.v).u;
      boardCenterV = Number.isFinite(main.dv) ? main.dv : sourceUvToDisplayUv(main.u, main.v).v;
    }
    layoutActive = true;
    updateZoomInnerOrigin();
    applyPreviewTransform();
    renderManualMarkers();
    refreshReticle();
    syncCategoryNav();
    refreshIdleBanner();
    return true;
  }

  function tryLoadPointsFromSettings() {
    const im = img();
    if (!im?.naturalWidth) return;
    try {
      const raw = SETTINGS?.obsZoomCalibPointsJson || "{}";
      const obj = typeof raw === "string" ? JSON.parse(raw) : raw;
      applyPointsMapFromJsonObject(obj);
    } catch {
      /* ignore */
    }
  }

  async function refreshPreviewPlacement(im, programSceneName, targetSrc) {
    previewPlacement = null;
    const scene = normalizeText(programSceneName);
    const tgt = normalizeText(targetSrc);
    if (!scene || !tgt || !im?.naturalWidth) return;
    try {
      const pl = await send({
        type: "OBS_GET_ZOOM_CALIB_PLACEMENT",
        payload: {
          sceneName: scene,
          targetSourceName: tgt,
          canvasWidth: im.naturalWidth,
          canvasHeight: im.naturalHeight
        }
      });
      if (!pl?.ok) return;
      if (pl.rotationUnsupported) {
        setStatus(
          "PGM: Ziel-Quelle ist gedreht — Canvas→Quelle-Zuordnung aus. Bitte Rotation 0° oder volle Quellen-Vorschau."
        );
        return;
      }
      previewPlacement = {
        imgW: im.naturalWidth,
        imgH: im.naturalHeight,
        rect: pl.rect,
        sourceWidth: pl.sourceWidth,
        sourceHeight: pl.sourceHeight,
        cropLeft: pl.cropLeft,
        cropRight: pl.cropRight,
        cropTop: pl.cropTop,
        cropBottom: pl.cropBottom
      };
    } catch {
      previewPlacement = null;
    }
  }

  async function captureFromObs() {
    const fb = $("calibFallbackWrap");
    if (fb) fb.hidden = true;
    previewPlacement = null;
    previewSpace = "unknown";
    lastProgramSceneName = "";
    const targetSrc = normalizeText(SETTINGS.obsZoomTargetSource);
    const useSourcePreview = SETTINGS.obsZoomCalibPreviewFromSource === true;
    setStatus(
      useSourcePreview && targetSrc
        ? `Hole Vorschau der Quelle \u201e${targetSrc}\u201c …`
        : "Hole Programm-Canvas (PGM) …"
    );
    try {
      let res = null;
      let previewFromSource = false;
      let baseW = 1920;
      let baseH = 1080;
      const vb = await send({ type: "OBS_GET_VIDEO_BASE" });
      if (vb?.ok && Number.isFinite(Number(vb.baseWidth)) && Number.isFinite(Number(vb.baseHeight))) {
        baseW = Math.max(8, Math.trunc(Number(vb.baseWidth)));
        baseH = Math.max(8, Math.trunc(Number(vb.baseHeight)));
      }
      if (useSourcePreview && targetSrc) {
        res = await send({
          type: "OBS_GET_SOURCE_SCREENSHOT",
          sourceName: targetSrc,
          options: {
            imageWidth: 1920,
            imageHeight: 1080,
            imageFormat: "jpeg"
          }
        });
        if (res?.ok) previewFromSource = true;
      }
      if (!previewFromSource) {
        if (useSourcePreview && targetSrc && res && !res.ok) {
          setStatus(`Quelle \u201e${targetSrc}\u201c: ${String(res.error || "Fehler")} — nutze PGM …`);
        }
        res = await send({
          type: "OBS_GET_SOURCE_SCREENSHOT",
          mode: "program",
          options: {
            imageWidth: baseW,
            imageHeight: baseH,
            imageFormat: "jpeg"
          }
        });
      }
      if (!res?.ok) throw new Error(String(res?.error || "shot"));
      screenshotRaw = String(res.imageData || "").trim();
      if (!screenshotRaw) throw new Error("obs_screenshot_empty");
      const im = img();
      if (!im) throw new Error("no_img_element");
      const url = dataUrlFromObsImage(screenshotRaw);
      im.onload = () => {
        resetLayoutState();
        void (async () => {
          if (previewFromSource) {
            previewSpace = "source";
            previewPlacement = null;
            lastProgramSceneName = "";
          } else {
            previewSpace = "pgm";
            lastProgramSceneName = normalizeText(res.sceneName);
            const progScene = lastProgramSceneName;
            await refreshPreviewPlacement(im, progScene, targetSrc);
          }
          applyPreviewTransform();
          refreshReticle();
          tryLoadPointsFromSettings();
          syncCategoryNav();
          forceStartFieldCalibCategory(CATEGORY_ORDER[categoryRingIndex]);
          for (let attempt = 0; attempt < 4 && !fieldCalibCategory; attempt++) {
            shiftCategoryRing(1);
          }
          if (!fieldCalibCategory) refreshIdleBanner();
          let msg = previewFromSource
            ? `Vorschau: volles Bild der Quelle \u201e${targetSrc}\u201c (Koordinaten wie OBS-Quelle).`
            : normalizeText(res.sceneName)
              ? `PGM: ${res.sceneName} — Kalibrier-Punkte werden in Quellen-Koordinaten umgerechnet.`
              : "Vorschau: Programm-Canvas geladen.";
          if (previewSpace === "pgm" && targetSrc && !previewPlacement) {
            msg +=
              " Keine Zuordnung (Quelle nicht direkt in der PGM-Szene oder OBS-Fehler) — ggf. volle Quellen-Vorschau aktivieren.";
          }
          if (
            previewSpace === "pgm" &&
            lastProgramSceneName &&
            normalizeText(SETTINGS.obsZoomSceneName) &&
            lastProgramSceneName !== normalizeText(SETTINGS.obsZoomSceneName)
          ) {
            msg += ` Hinweis: PGM-Szene (${lastProgramSceneName}) ≠ eingestellte OBS-Szene (${normalizeText(SETTINGS.obsZoomSceneName)}) — Zoom kann verziehen; gleiche Szene wählen oder Quelle direkt in der PGM-Szene platzieren.`;
          }
          setStatus(msg);
          if (fb) fb.hidden = true;
        })();
      };
      im.onerror = () => {
        setStatus("Bild konnte nicht geladen werden.");
        if (fb) fb.hidden = false;
      };
      im.src = url;
    } catch (e) {
      setStatus(String(e?.message || e));
      if (fb) fb.hidden = false;
    }
  }

  function onMarkerPointerDown(ev) {
    if (!layoutActive || !img()?.naturalWidth) return;
    const hit = ev.target?.closest?.(".calib-marker-hit");
    if (!hit) return;
    const g = hit.closest?.("[data-filter]");
    if (!g) return;
    const name = g.getAttribute("data-filter");
    if (!name || name === "Main") return;
    ev.preventDefault();
    ev.stopPropagation();
    markerDragMoved = false;
    dragState = { name, pointerId: ev.pointerId };
    layoutSvg()?.classList.add("calib-markerDragging");
    try {
      layoutSvg()?.setPointerCapture(ev.pointerId);
    } catch {}
  }

  function onMarkerPointerMove(ev) {
    if (!dragState || ev.pointerId !== dragState.pointerId) return;
    markerDragMoved = true;
    const im = img();
    if (!im) return;
    const disp = eventToUv(im, ev.clientX, ev.clientY);
    const src = displayUvToSourceUv(disp.u, disp.v);
    filterUvByName.set(dragState.name, { u: src.u, v: src.v, du: disp.u, dv: disp.v });
    const mainSrc = displayUvToSourceUv(boardCenterU, boardCenterV);
    filterUvByName.set("Main", { u: mainSrc.u, v: mainSrc.v, du: boardCenterU, dv: boardCenterV });
    scheduleRenderMarkers();
  }

  function onMarkerPointerUp(ev) {
    if (!dragState || ev.pointerId !== dragState.pointerId) return;
    const moved = markerDragMoved;
    markerDragMoved = false;
    try {
      layoutSvg()?.releasePointerCapture(ev.pointerId);
    } catch {}
    layoutSvg()?.classList.remove("calib-markerDragging");
    dragState = null;
    if (moved) skipNextShellClick = true;
    scheduleRenderMarkers();
    schedulePersistCalib();
  }

  async function init() {
    try {
      const res = await send({ type: "GET_SETTINGS" });
      SETTINGS = res?.ok && res.settings ? res.settings : {};
    } catch {
      SETTINGS = {};
    }
    const zp = Number.isFinite(Number(SETTINGS.obsZoomCalibZoomPercent))
      ? SETTINGS.obsZoomCalibZoomPercent
      : 100;
    $("calibObsZoomSlider").value = String(zp);
    syncObsZoomReadout();
    categoryRingIndex = 0;
    applyPreviewTransform();
    syncCategoryNav();

    layoutSvg()?.addEventListener("pointerdown", onMarkerPointerDown);
    layoutSvg()?.addEventListener("pointermove", onMarkerPointerMove);
    layoutSvg()?.addEventListener("pointerup", onMarkerPointerUp);
    layoutSvg()?.addEventListener("pointercancel", onMarkerPointerUp);

    $("calibObsZoomSlider")?.addEventListener("input", () => {
      syncObsZoomReadout();
      refreshReticle();
      schedulePersistCalib();
    });

    $("btnCalibCatPrev")?.addEventListener("click", () => shiftCategoryRing(-1));
    $("btnCalibCatNext")?.addEventListener("click", () => shiftCategoryRing(1));

    $("btnCalibApplyFilters")?.addEventListener("click", () => {
      void (async () => {
        try {
          const im = img();
          if (previewSpace === "pgm" && im?.naturalWidth) {
            setStatus("Hole aktuelle Quellen-Position aus OBS …");
            await refreshPgmPlacementFromObs(im);
            recomputeAllCalibSourceUvFromDisplay();
          }
          await flushPersistCalibImmediate();
          const points = pointsRecordForObsApply();
          if (Object.keys(points).length === 0) {
            setStatus("Zuerst Kalibrier-Punkte setzen, dann „Filter anwenden“.");
            return;
          }
          setStatus("Schreibe Move-Filter in OBS …");
          await applyZoomToObs(points, { persist: true });
        } catch (e) {
          setStatus(String(e?.message || e));
        }
      })();
    });

    async function handleShellClick(ev) {
      const im = img();
      if (!im?.naturalWidth) return;
      if (ev.target?.closest?.(".calib-toolbar")) return;
      if (ev.target?.closest?.(".calib-zoomHud")) return;
      if (ev.target?.closest?.(".calib-applyHud")) return;
      if (dragState) return;
      if (skipNextShellClick) {
        skipNextShellClick = false;
        return;
      }
      if (!fieldCalibCategory && ev.target?.closest?.(".calib-marker-hit")) return;
      if (fieldCalibCategory && ev.target?.closest?.(".calib-marker")) return;

      if (
        fieldCalibCategory &&
        fieldCalibNames.length > 0 &&
        fieldCalibIndex < fieldCalibNames.length
      ) {
        if (previewSpace === "pgm") {
          await refreshPgmPlacementFromObs(im);
        }
        const nm = fieldCalibNames[fieldCalibIndex];
        const disp = eventToUv(im, ev.clientX, ev.clientY);
        const src = displayUvToSourceUv(disp.u, disp.v);
        filterUvByName.set(nm, { u: src.u, v: src.v, du: disp.u, dv: disp.v });
        if (nm === "Main") {
          boardCenterU = disp.u;
          boardCenterV = disp.v;
        }
        fieldCalibIndex += 1;
        layoutActive = filterUvByName.size > 0;
        updateZoomInnerOrigin();
        applyPreviewTransform();
        if (fieldCalibIndex >= fieldCalibNames.length) {
          const done = fieldCalibCategory;
          cancelFieldCalibMode(false);
          setStatus(categoryDoneMessage(done));
        } else {
          refreshFieldCalibBanner();
        }
        refreshReticle();
        scheduleRenderMarkers();
        schedulePersistCalib();
        return;
      }

      if (layoutActive && !fieldCalibCategory) return;
    }

    shell()?.addEventListener("click", (ev) => {
      void handleShellClick(ev);
    });

    $("calibRetryObs")?.addEventListener("click", () => {
      void captureFromObs();
    });

    $("calibFile")?.addEventListener("change", (ev) => {
      const file = ev.target?.files?.[0];
      setStatus("");
      if (!file || !String(file.type || "").startsWith("image/")) {
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const im = img();
        im.onload = () => {
          previewSpace = "file";
          previewPlacement = null;
          lastProgramSceneName = "";
          resetLayoutState();
          applyPreviewTransform();
          refreshReticle();
          syncCategoryNav();
          forceStartFieldCalibCategory(CATEGORY_ORDER[categoryRingIndex]);
          for (let attempt = 0; attempt < 4 && !fieldCalibCategory; attempt++) {
            shiftCategoryRing(1);
          }
          if (!fieldCalibCategory) refreshIdleBanner();
          setStatus("Eigenes Bild geladen.");
          const fbw = $("calibFallbackWrap");
          if (fbw) fbw.hidden = false;
        };
        im.onerror = () => setStatus("Bild fehlerhaft.");
        im.src = String(reader.result || "");
      };
      reader.readAsDataURL(file);
    });

    $("calibFs")?.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      const target = stageRow() || shell();
      try {
        if (!document.fullscreenElement) {
          if (target?.requestFullscreen) await target.requestFullscreen();
        } else {
          await document.exitFullscreen();
        }
      } catch {}
      const b = $("calibFs");
      if (b) b.textContent = document.fullscreenElement ? "Vollbild beenden" : "Vollbild";
    });

    document.addEventListener("fullscreenchange", () => {
      requestAnimationFrame(() => {
        refreshReticle();
        if (layoutActive) renderManualMarkers();
      });
      const b = $("calibFs");
      if (b) b.textContent = document.fullscreenElement ? "Vollbild beenden" : "Vollbild";
    });

    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape" && fieldCalibCategory) {
        cancelFieldCalibMode(true);
        setStatus("Felder-Modus abgebrochen.");
      }
    });

    window.addEventListener("resize", () => {
      if (img()?.naturalWidth) {
        refreshReticle();
        if (layoutActive) renderManualMarkers();
      }
    });

    $("btnCalibShot")?.addEventListener("click", () => {
      void captureFromObs();
    });

    await captureFromObs();
  }

  document.addEventListener("DOMContentLoaded", () => {
    void init();
  });
})();
