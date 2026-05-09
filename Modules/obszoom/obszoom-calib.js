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

  /** @type {Map<string, { u: number, v: number }>} */
  const filterUvByName = new Map();

  /** @type {{ name: string, pointerId: number } | null} */
  let dragState = null;
  let renderMarkersQueued = false;

  /** null | "triple" | "double" | "single" | "other" — nacheinander Klicks auf die Scheibe */
  let fieldCalibCategory = null;
  /** @type {string[]} */
  let fieldCalibNames = [];
  let fieldCalibIndex = 0;

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

  function syncCategoryButtonActive() {
    const c = fieldCalibCategory;
    $("btnCalibCatTriple")?.classList.toggle("calib-catBtnActive", c === "triple");
    $("btnCalibCatDouble")?.classList.toggle("calib-catBtnActive", c === "double");
    $("btnCalibCatSingle")?.classList.toggle("calib-catBtnActive", c === "single");
    $("btnCalibCatOther")?.classList.toggle("calib-catBtnActive", c === "other");
  }

  function syncCalibCategoryButtonsEnabled() {
    const im = img();
    const ok = !!im?.naturalWidth;
    const t = $("btnCalibCatTriple");
    const d = $("btnCalibCatDouble");
    const s = $("btnCalibCatSingle");
    const o = $("btnCalibCatOther");
    if (t) t.disabled = !ok || SETTINGS.obsZoomIncludeTriples === false;
    if (d) d.disabled = !ok || SETTINGS.obsZoomIncludeDoubles === false;
    if (s) s.disabled = !ok || SETTINGS.obsZoomIncludeSingles === false;
    if (o) o.disabled = !ok;
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

  function fieldCalibHumanName(fn) {
    const up = String(fn || "").toUpperCase();
    if (up === "MAIN") return "Main (Bull-Mitte)";
    return String(fn);
  }

  function refreshFieldCalibBanner() {
    if (!fieldCalibCategory || fieldCalibIndex >= fieldCalibNames.length) {
      updateWizardBanner("");
      return;
    }
    const nm = fieldCalibNames[fieldCalibIndex];
    const catLabel =
      fieldCalibCategory === "triple"
        ? "Triple"
        : fieldCalibCategory === "double"
          ? "Double"
          : fieldCalibCategory === "single"
            ? "Single"
            : "Sonstiges";
    updateWizardBanner(
      `${catLabel}: Bitte ${fieldCalibHumanName(nm)} setzen (${fieldCalibIndex + 1} / ${fieldCalibNames.length})`
    );
  }

  function cancelFieldCalibMode(clearStatus) {
    fieldCalibCategory = null;
    fieldCalibNames = [];
    fieldCalibIndex = 0;
    setCalibCaptureUi(false);
    syncCategoryButtonActive();
    updateWizardBanner("");
    if (clearStatus) setStatus("");
  }

  function categoryDoneMessage(cat) {
    if (cat === "triple") return "Alle Triple-Felder gesetzt.";
    if (cat === "double") return "Alle Double-Felder gesetzt.";
    if (cat === "single") return "Alle Single-Felder gesetzt.";
    if (cat === "other") return "Sonstiges abgeschlossen (Main, Bull, D-Bull, Miss).";
    return "Kategorie fertig.";
  }

  function startFieldCalibCategory(cat) {
    const im = img();
    if (!im?.naturalWidth) {
      setStatus("Zuerst Vorschau laden (Aktualisieren oder Bilddatei).");
      return;
    }
    if (fieldCalibCategory === cat) {
      cancelFieldCalibMode(true);
      setStatus("Modus beendet.");
      return;
    }
    const names = buildNamesForCategory(cat);
    if (!names.length) {
      setStatus("Diese Kategorie ist in den Einstellungen deaktiviert.");
      return;
    }
    fieldCalibCategory = cat;
    fieldCalibNames = names;
    fieldCalibIndex = 0;
    setCalibCaptureUi(true);
    syncCategoryButtonActive();
    refreshFieldCalibBanner();
    setStatus("");
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
      o[k] = { nx: uv.u, ny: uv.v };
    });
    return o;
  }

  /** Für OBS: zuerst aktuelle Marker, sonst gespeicherte JSON-Punktlage. */
  function pointsRecordForObsApply() {
    const fromMap = pointsMapForObs();
    if (Object.keys(fromMap).length > 0) return fromMap;
    try {
      const raw = SETTINGS?.obsZoomCalibPointsJson || "{}";
      const obj = typeof raw === "string" ? JSON.parse(raw) : raw;
      const map = obj?.points && typeof obj.points === "object" ? obj.points : obj;
      if (!map || typeof map !== "object") return {};
      const out = {};
      for (const [k, p] of Object.entries(map)) {
        if (p && Number.isFinite(Number(p.nx)) && Number.isFinite(Number(p.ny))) {
          out[k] = { nx: Number(p.nx), ny: Number(p.ny) };
        }
      }
      return out;
    } catch {
      return {};
    }
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
    const sceneName =
      normalizeText($("calibSceneName")?.value) || normalizeText(SETTINGS.obsZoomSceneName);
    const targetSourceName =
      normalizeText($("calibTargetSource")?.value) || normalizeText(SETTINGS.obsZoomTargetSource);
    if (!sceneName || !targetSourceName) {
      setStatus("Szene und Ziel-Quelle unter „Filter in OBS“ eintragen.");
      return;
    }
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
        points: pointsRecord,
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
        filterUvByName.set(k, { u: Number(p.nx), v: Number(p.ny) });
        n += 1;
      }
    }
    if (n === 0) return false;
    const main = filterUvByName.get("Main");
    if (main) {
      const d = sourceUvToDisplayUv(main.u, main.v);
      boardCenterU = d.u;
      boardCenterV = d.v;
    }
    layoutActive = true;
    updateZoomInnerOrigin();
    applyPreviewTransform();
    renderManualMarkers();
    refreshReticle();
    syncCalibCategoryButtonsEnabled();
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

  function syncObsTargetFieldsFromSettings() {
    const sn = $("calibSceneName");
    const tn = $("calibTargetSource");
    if (sn) sn.value = normalizeText(SETTINGS.obsZoomSceneName);
    if (tn) tn.value = normalizeText(SETTINGS.obsZoomTargetSource);
  }

  function exportCalibPointsJson() {
    const pts = pointsMapForObs();
    if (Object.keys(pts).length === 0) {
      setStatus("Keine Punkte zum Exportieren.");
      return;
    }
    const body = JSON.stringify(
      {
        version: 1,
        type: "obszoom-calibration-points",
        exportedAt: new Date().toISOString(),
        points: pts
      },
      null,
      2
    );
    const blob = new Blob([body], { type: "application/json;charset=utf-8" });
    const a = document.createElement("a");
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = `obszoom-kalibrierung-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setStatus("Punkte als JSON exportiert.");
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
    const targetSrc =
      normalizeText($("calibTargetSource")?.value) || normalizeText(SETTINGS.obsZoomTargetSource);
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
          } else {
            previewSpace = "pgm";
            const progScene = normalizeText(res.sceneName);
            await refreshPreviewPlacement(im, progScene, targetSrc);
          }
          applyPreviewTransform();
          refreshReticle();
          tryLoadPointsFromSettings();
          syncCalibCategoryButtonsEnabled();
          let msg = previewFromSource
            ? `Vorschau: volles Bild der Quelle \u201e${targetSrc}\u201c (Koordinaten wie OBS-Quelle).`
            : normalizeText(res.sceneName)
              ? `PGM: ${res.sceneName} — Kalibrier-Punkte werden in Quellen-Koordinaten umgerechnet.`
              : "Vorschau: Programm-Canvas geladen.";
          if (previewSpace === "pgm" && targetSrc && !previewPlacement) {
            msg +=
              " Keine Zuordnung (Quelle nicht direkt in der PGM-Szene oder OBS-Fehler) — ggf. volle Quellen-Vorschau aktivieren.";
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
    if (fieldCalibCategory) return;
    if (!layoutActive || !img()?.naturalWidth) return;
    const hit = ev.target?.closest?.(".calib-marker-hit");
    if (!hit) return;
    const g = hit.closest?.("[data-filter]");
    if (!g) return;
    const name = g.getAttribute("data-filter");
    if (!name || name === "Main") return;
    ev.preventDefault();
    ev.stopPropagation();
    dragState = { name, pointerId: ev.pointerId };
    layoutSvg()?.classList.add("calib-markerDragging");
    try {
      layoutSvg()?.setPointerCapture(ev.pointerId);
    } catch {}
  }

  function onMarkerPointerMove(ev) {
    if (!dragState || ev.pointerId !== dragState.pointerId) return;
    const im = img();
    if (!im) return;
    const disp = eventToUv(im, ev.clientX, ev.clientY);
    const src = displayUvToSourceUv(disp.u, disp.v);
    filterUvByName.set(dragState.name, { u: src.u, v: src.v });
    const mainSrc = displayUvToSourceUv(boardCenterU, boardCenterV);
    filterUvByName.set("Main", { u: mainSrc.u, v: mainSrc.v });
    scheduleRenderMarkers();
  }

  function onMarkerPointerUp(ev) {
    if (!dragState || ev.pointerId !== dragState.pointerId) return;
    try {
      layoutSvg()?.releasePointerCapture(ev.pointerId);
    } catch {}
    layoutSvg()?.classList.remove("calib-markerDragging");
    dragState = null;
    scheduleRenderMarkers();
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
    syncObsTargetFieldsFromSettings();
    const previewCb = $("calibPreviewFromSource");
    if (previewCb) previewCb.checked = SETTINGS.obsZoomCalibPreviewFromSource === true;
    previewCb?.addEventListener("change", () => {
      void (async () => {
        try {
          SETTINGS = await savePartial({
            obsZoomCalibPreviewFromSource: !!previewCb.checked
          });
          setStatus(
            previewCb.checked
              ? "Vorschau-Modus: volle Ziel-Quelle — „Aktualisieren“ zum Laden."
              : "Vorschau-Modus: Programm-Canvas — „Aktualisieren“ zum Laden."
          );
        } catch (e) {
          setStatus(String(e?.message || e));
        }
      })();
    });
    applyPreviewTransform();
    syncCalibCategoryButtonsEnabled();

    layoutSvg()?.addEventListener("pointerdown", onMarkerPointerDown);
    layoutSvg()?.addEventListener("pointermove", onMarkerPointerMove);
    layoutSvg()?.addEventListener("pointerup", onMarkerPointerUp);
    layoutSvg()?.addEventListener("pointercancel", onMarkerPointerUp);

    $("calibObsZoomSlider")?.addEventListener("input", () => {
      syncObsZoomReadout();
      refreshReticle();
    });

    $("btnCalibExportPoints")?.addEventListener("click", () => exportCalibPointsJson());
    $("btnCalibImportPoints")?.addEventListener("click", () => $("calibPointsJsonFile")?.click());
    $("calibPointsJsonFile")?.addEventListener("change", (ev) => {
      const file = ev.target?.files?.[0];
      if (ev.target) ev.target.value = "";
      if (!file) return;
      void (async () => {
        try {
          const text = await file.text();
          const data = JSON.parse(text);
          if (applyPointsMapFromJsonObject(data)) {
            setStatus(`Import: Punktlage aus „${file.name}“ übernommen.`);
          } else {
            setStatus("Import: keine gültigen Punkte (nx/ny) gefunden.");
          }
        } catch (e) {
          setStatus(`Import: ${String(e?.message || e)}`);
        }
      })();
    });
    $("btnCalibLoadFromSettings")?.addEventListener("click", () => {
      try {
        const raw = SETTINGS?.obsZoomCalibPointsJson || "{}";
        const obj = typeof raw === "string" ? JSON.parse(raw) : raw;
        if (applyPointsMapFromJsonObject(obj)) {
          setStatus("Punkte aus Extension-Einstellungen geladen.");
        } else {
          setStatus("In den Einstellungen ist keine Punktlage gespeichert.");
        }
      } catch (e) {
        setStatus(String(e?.message || e));
      }
    });

    $("btnCalibCreateMoveFilters")?.addEventListener("click", () => {
      void (async () => {
        const sceneName = normalizeText($("calibSceneName")?.value);
        const sourceName = normalizeText($("calibTargetSource")?.value);
        if (!sceneName || !sourceName) {
          setStatus("Szene und Ziel-Quelle eintragen.");
          return;
        }
        try {
          SETTINGS = await savePartial({
            obsZoomSceneName: sceneName,
            obsZoomTargetSource: sourceName
          });
          const res = await send({
            type: "OBS_CREATE_MOVE_FILTERS",
            sceneName,
            sourceName,
            mode: "upsert",
            duration: Math.max(0, Number(SETTINGS.obsZoomDurationMs) || 450),
            easing: Number.isFinite(Number(SETTINGS.obsZoomMoveEasingType))
              ? Number(SETTINGS.obsZoomMoveEasingType)
              : 3,
            easingFunction: Number.isFinite(Number(SETTINGS.obsZoomMoveEasingFunction))
              ? Number(SETTINGS.obsZoomMoveEasingFunction)
              : 2,
            includeSingles: SETTINGS.obsZoomIncludeSingles !== false,
            includeDoubles: SETTINGS.obsZoomIncludeDoubles !== false,
            includeTriples: SETTINGS.obsZoomIncludeTriples !== false
          });
          if (!res?.ok) throw new Error(String(res?.error || "obs_create_filters_failed"));
          const c = Number(res.created) || 0;
          const u = Number(res.updated) || 0;
          setStatus(`OBS: ${c} Filter neu, ${u} aktualisiert.`);
        } catch (e) {
          setStatus(`OBS Filter: ${String(e?.message || e)}`);
        }
      })();
    });

    $("btnCalibTuneFilters")?.addEventListener("click", () => {
      void (async () => {
        try {
          const points = pointsRecordForObsApply();
          if (Object.keys(points).length === 0) {
            setStatus("Keine Punktlage — kalibrieren, importieren oder „Aus Einstellungen laden“.");
            return;
          }
          await applyZoomToObs(points, {
            persist: false,
            statusMsg: `OBS: Zoom-Positionen aktualisiert (${Object.keys(points).length} Filter).`
          });
        } catch (e) {
          setStatus(`OBS: ${String(e?.message || e)}`);
        }
      })();
    });

    $("btnCalibCatTriple")?.addEventListener("click", () => startFieldCalibCategory("triple"));
    $("btnCalibCatDouble")?.addEventListener("click", () => startFieldCalibCategory("double"));
    $("btnCalibCatSingle")?.addEventListener("click", () => startFieldCalibCategory("single"));
    $("btnCalibCatOther")?.addEventListener("click", () => startFieldCalibCategory("other"));

    shell()?.addEventListener("click", (ev) => {
      const im = img();
      if (!im?.naturalWidth) return;
      if (ev.target?.closest?.(".calib-toolbar")) return;
      if (dragState) return;
      if (!fieldCalibCategory && ev.target?.closest?.(".calib-marker-hit")) return;

      if (
        fieldCalibCategory &&
        fieldCalibNames.length > 0 &&
        fieldCalibIndex < fieldCalibNames.length
      ) {
        const nm = fieldCalibNames[fieldCalibIndex];
        const disp = eventToUv(im, ev.clientX, ev.clientY);
        const src = displayUvToSourceUv(disp.u, disp.v);
        filterUvByName.set(nm, { u: src.u, v: src.v });
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
        return;
      }

      if (layoutActive && !fieldCalibCategory) return;
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
          resetLayoutState();
          applyPreviewTransform();
          refreshReticle();
          syncCalibCategoryButtonsEnabled();
          setStatus("Eigenes Bild geladen.");
          $("calibFallbackWrap").hidden = false;
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

    $("btnCalibSave")?.addEventListener("click", async () => {
      try {
        if (!layoutActive) {
          setStatus("Zuerst Felder setzen (Kategorie-Buttons rechts unter „Felder setzen“).");
          return;
        }
        const strength = getObsZoomPanStrength();
        const zoomPct = getObsZoomPercent();
        const partial = {
          obsZoomStrength: strength,
          obsZoomCalibZoomPercent: zoomPct,
          obsZoomCalibPointsJson: JSON.stringify(pointsMapForObs())
        };
        const sn = normalizeText($("calibSceneName")?.value);
        const tn = normalizeText($("calibTargetSource")?.value);
        if (sn) partial.obsZoomSceneName = sn;
        if (tn) partial.obsZoomTargetSource = tn;
        SETTINGS = await savePartial(partial);
        setStatus("In Extension gespeichert.");
      } catch (e) {
        setStatus(`Speichern: ${String(e?.message || e)}`);
      }
    });

    $("btnCalibApplyObs")?.addEventListener("click", async () => {
      try {
        const points = pointsRecordForObsApply();
        if (Object.keys(points).length === 0) {
          setStatus("Keine Punktlage — kalibrieren, importieren oder „Aus Einstellungen laden“.");
          return;
        }
        await applyZoomToObs(points, { persist: true });
      } catch (e) {
        setStatus(`OBS: ${String(e?.message || e)}`);
      }
    });

    await captureFromObs();
  }

  document.addEventListener("DOMContentLoaded", () => {
    void init();
  });
})();
