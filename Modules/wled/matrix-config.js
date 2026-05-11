/* global chrome */
(function () {
  "use strict";

  const STR = {
    de: {
      title: "Matrix Config",
      hint: "Felder klicken: Ein/Aus. Mit gedrueckter Maustaste ziehen zum Setzen. „An WLED senden“ uebernimmt die Belegung auf das Segment (Solid). So gleichst du Serpentine / Zeilen vs. Spalten mit der Hardware ab.",
      clear: "Alle aus",
      send: "An WLED senden",
      noSettings: "Keine Einstellungen gefunden.",
      noDisplay: "Matrix-Eintrag fehlt oder Index ungueltig.",
      noEndpoint: "Kein Controller-Endpunkt.",
      badSize: "Breite×Hoehe ungueltig.",
      sent: "Gesendet.",
      httpErr: "HTTP-Fehler",
      fetchErr: "Fehler"
    },
    en: {
      title: "Matrix config",
      hint: "Click cells: on/off. Drag with button held to paint. “Send to WLED” writes the pattern to the segment (Solid). Use this to match serpentine / row vs. column wiring.",
      clear: "Clear all",
      send: "Send to WLED",
      noSettings: "No settings found.",
      noDisplay: "Missing matrix entry or invalid index.",
      noEndpoint: "No controller endpoint.",
      badSize: "Invalid width×height.",
      sent: "Sent.",
      httpErr: "HTTP error",
      fetchErr: "Error"
    }
  };

  function langFromSettings(settings) {
    const l = String(settings?.uiLanguage || "de").toLowerCase();
    return l.startsWith("en") ? "en" : "de";
  }

  function t(lang, key) {
    return STR[lang]?.[key] || STR.de[key] || key;
  }

  function normalizeEndpoint(raw) {
    let endpoint = String(raw || "").trim();
    if (!endpoint) return "";
    if (!/^https?:\/\//i.test(endpoint)) endpoint = `http://${endpoint}`;
    return endpoint.replace(/\/+$/, "");
  }

  function parseControllers(raw) {
    try {
      const arr = JSON.parse(String(raw || "[]"));
      if (!Array.isArray(arr)) return [];
      return arr
        .filter((item) => item && typeof item === "object")
        .map((item, index) => ({
          id: String(item.id || `ctrl_${index + 1}`).trim(),
          name: String(item.name || "").trim(),
          endpoint: String(item.endpoint || "").trim()
        }))
        .filter((item) => !!item.id);
    } catch {
      return [];
    }
  }

  function clampDim(n, fallback) {
    const v = Math.trunc(Number(n));
    if (!Number.isFinite(v) || v < 1) return fallback;
    return Math.min(128, v);
  }

  function parseDisplayOrientationToken(raw) {
    let o = String(raw?.orientation ?? "").trim().toLowerCase().replace(/-/g, "_");
    if (!o && String(raw?.scanMode || "").toLowerCase() === "cols") o = "vertical";
    if (!o) o = "horizontal";
    if (o === "rows") o = "horizontal";
    if (o === "cols") o = "vertical";
    const mirrorX = o.includes("mirror") || raw?.mirrorX === true;
    const vertical = o.startsWith("vertical");
    const scanMode = vertical ? "cols" : "rows";
    return { scanMode, mirrorX };
  }

  function normalizeDisplayEntry(raw, ctrls, idxFallback) {
    const cid = String(raw?.controllerId || "").trim() || String(ctrls[0]?.id || "").trim();
    let w = Math.min(128, Math.max(1, Math.trunc(Number(raw?.w)) || 16));
    let h = Math.min(128, Math.max(1, Math.trunc(Number(raw?.h)) || 16));
    while (w * h > 2048 && h > 1) h -= 1;
    while (w * h > 2048 && w > 1) w -= 1;
    const serpentine = raw?.serpentine === true;
    const po = parseDisplayOrientationToken(raw);
    const segmentId = Math.max(0, Math.min(31, Math.trunc(Number(raw?.segmentId)) || 0));
    return {
      id: String(raw?.id || `m_${idxFallback}`).trim(),
      controllerId: cid,
      segmentId,
      w,
      h,
      serpentine,
      scanMode: po.scanMode,
      mirrorX: po.mirrorX,
      segmentLabel: String(raw?.segmentLabel || "").trim()
    };
  }

  function parseDisplays(settings) {
    const ctrls = parseControllers(settings?.wledControllersJson);
    let arr = null;
    try {
      const raw = String(settings?.wledMatrixWledDisplaysJson || "").trim();
      if (raw) {
        const j = JSON.parse(raw);
        if (Array.isArray(j) && j.length) arr = j.map((x, i) => normalizeDisplayEntry(x, ctrls, i));
      }
    } catch {
      arr = null;
    }
    if (!arr || !arr.length) {
      const orient =
        String(settings?.wledMatrixWledScanMode || "rows").toLowerCase() === "cols" ? "vertical" : "horizontal";
      arr = [
        normalizeDisplayEntry(
          {
            id: "legacy",
            controllerId: String(settings?.wledMatrixWledControllerId0 || "").trim() || String(ctrls[0]?.id || "").trim(),
            segmentId: Math.max(0, Math.min(31, Math.trunc(Number(settings?.wledMatrixWledSegmentId)) || 0)),
            w: clampDim(settings?.wledMatrixWledWidth, 16),
            h: clampDim(settings?.wledMatrixWledHeight, 16),
            serpentine: settings?.wledMatrixWledSerpentine === true,
            orientation: orient
          },
          ctrls,
          0
        )
      ];
    }
    return { displays: arr, ctrls };
  }

  function getControllerEndpoint(ctrls, controllerId) {
    const id = String(controllerId || "").trim();
    const c = ctrls.find((x) => x.id === id) || ctrls[0];
    return normalizeEndpoint(c?.endpoint);
  }

  function normalizeScanMode(raw) {
    return String(raw || "rows").toLowerCase() === "cols" ? "cols" : "rows";
  }

  function xyToLinearIndex(x, y, w, h, serpentine, scanMode, mirrorX) {
    const sm = normalizeScanMode(scanMode);
    if (x < 0 || y < 0 || x >= w || y >= h) return -1;
    const xi = mirrorX === true ? w - 1 - x : x;
    if (sm === "cols") {
      if (serpentine && (xi & 1)) return xi * h + (h - 1 - y);
      return xi * h + y;
    }
    if (serpentine && (y & 1)) return y * w + (w - 1 - xi);
    return y * w + xi;
  }

  function normalizeHex6(raw) {
    let s = String(raw || "").trim().replace(/^#/, "");
    if (s.length === 3) s = s.split("").map((c) => c + c).join("");
    if (!/^[0-9a-fA-F]{6}$/.test(s)) return "FFFFFF";
    return s.toUpperCase();
  }

  function buildSegI(clearStart, clearLen, cells) {
    const cs = Math.max(0, Math.trunc(Number(clearStart)) || 0);
    const cl = Math.max(1, Math.min(8192, Math.trunc(Number(clearLen)) || 1));
    const i = [cs, cl, "000000"];
    cells.forEach((hex, idx) => {
      const n = Math.trunc(Number(idx));
      if (!Number.isFinite(n) || n < 0 || n >= cl) return;
      i.push(cs + n, String(hex).replace(/^#/, "").toUpperCase().slice(0, 6));
    });
    return i;
  }

  function getQueryDisplayIndex() {
    const p = new URLSearchParams(location.search);
    const n = Math.trunc(Number(p.get("d")));
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }

  function cellSizeForDims(w, h) {
    const maxPx = 420;
    const byW = Math.floor(maxPx / Math.max(w, 1));
    const byH = Math.floor((typeof window !== "undefined" ? window.innerHeight - 220 : 400) / Math.max(h, 1));
    return Math.max(10, Math.min(22, Math.min(byW, byH)));
  }

  async function loadSettings() {
    return new Promise((resolve, reject) => {
      try {
        chrome.storage.local.get(["settings"], (items) => {
          const err = chrome.runtime?.lastError;
          if (err) reject(err);
          else resolve(items?.settings || null);
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  function main() {
    const displayIndex = getQueryDisplayIndex();
    const titleEl = document.getElementById("mcTitle");
    const hintEl = document.getElementById("mcHint");
    const metaEl = document.getElementById("mcMeta");
    const gridEl = document.getElementById("mcGrid");
    const clearBtn = document.getElementById("mcClear");
    const sendBtn = document.getElementById("mcSend");
    const hoverEl = document.getElementById("mcHover");
    const statusEl = document.getElementById("mcStatus");

    loadSettings()
      .then((settings) => {
        const lang = langFromSettings(settings);
        document.documentElement.lang = lang === "en" ? "en" : "de";
        titleEl.textContent = t(lang, "title");
        hintEl.textContent = t(lang, "hint");
        clearBtn.textContent = t(lang, "clear");
        sendBtn.textContent = t(lang, "send");

        if (!settings) {
          statusEl.textContent = t(lang, "noSettings");
          statusEl.classList.add("mc-err");
          return;
        }

        const { displays, ctrls } = parseDisplays(settings);
        const d = displays[displayIndex] || displays[0];
        if (!d) {
          statusEl.textContent = t(lang, "noDisplay");
          statusEl.classList.add("mc-err");
          return;
        }

        const w = d.w;
        const h = d.h;
        const total = w * h;
        if (total < 1 || total > 8192) {
          statusEl.textContent = t(lang, "badSize");
          statusEl.classList.add("mc-err");
          return;
        }

        const endpoint = getControllerEndpoint(ctrls, d.controllerId);
        if (!endpoint) {
          statusEl.textContent = t(lang, "noEndpoint");
          statusEl.classList.add("mc-err");
          return;
        }

        const fgHex = normalizeHex6(settings.wledMatrixWledFgHex || "#FFFFFF");
        const ctrlName = ctrls.find((c) => c.id === d.controllerId)?.name || d.controllerId;

        metaEl.textContent = `${ctrlName} · ${endpoint} · seg ${d.segmentId} · ${w}×${h} · ${
          d.scanMode === "cols" ? "cols" : "rows"
        } · serpentine ${d.serpentine ? "on" : "off"} · #${fgHex}`;

        const cellPx = cellSizeForDims(w, h);
        document.documentElement.style.setProperty("--cell-size", `${cellPx}px`);
        gridEl.style.gridTemplateColumns = `repeat(${w}, var(--cell-size, 18px))`;

        /** @type {boolean[]} flat index visual row-major: index = y*w + x */
        const lit = new Array(w * h).fill(false);

        function paintAt(vx, vy, value) {
          if (vx < 0 || vy < 0 || vx >= w || vy >= h) return;
          lit[vy * w + vx] = value;
          const cell = gridEl.querySelector(`[data-vx="${vx}"][data-vy="${vy}"]`);
          if (cell) {
            cell.dataset.on = value ? "1" : "0";
            cell.setAttribute("aria-pressed", value ? "true" : "false");
          }
        }

        /** Fill all grid cells on the line from (vx0,vy0) to (vx1,vy1) inclusive. */
        function paintLine(vx0, vy0, vx1, vy1, value) {
          let x0 = vx0;
          let y0 = vy0;
          const x1 = vx1;
          const y1 = vy1;
          const dx = Math.abs(x1 - x0);
          const dy = Math.abs(y1 - y0);
          const sx = x0 < x1 ? 1 : -1;
          const sy = y0 < y1 ? 1 : -1;
          let err = dx - dy;
          for (;;) {
            paintAt(x0, y0, value);
            if (x0 === x1 && y0 === y1) break;
            const e2 = 2 * err;
            if (e2 > -dy) {
              err -= dy;
              x0 += sx;
            }
            if (e2 < dx) {
              err += dx;
              y0 += sy;
            }
          }
        }

        function toggleAt(vx, vy) {
          const cur = lit[vy * w + vx];
          paintAt(vx, vy, !cur);
        }

        for (let vy = 0; vy < h; vy += 1) {
          for (let vx = 0; vx < w; vx += 1) {
            const b = document.createElement("button");
            b.type = "button";
            b.className = "mc-cell";
            b.dataset.vx = String(vx);
            b.dataset.vy = String(vy);
            b.dataset.on = "0";
            b.setAttribute("role", "gridcell");
            b.setAttribute("aria-pressed", "false");
            b.title = `x=${vx} y=${vy}`;
            gridEl.appendChild(b);
          }
        }

        let paintValue = true;
        let dragging = false;
        let brushPointerId = -1;
        let lastBrushVx = -1;
        let lastBrushVy = -1;

        function updateHover(vx, vy) {
          if (vx < 0 || vy < 0) {
            hoverEl.textContent = "";
            return;
          }
          const li = xyToLinearIndex(vx, vy, w, h, d.serpentine, d.scanMode, d.mirrorX);
          hoverEl.textContent = `x=${vx} y=${vy} → LED #${li}`;
        }

        function cellFromClientPoint(clientX, clientY) {
          const hit = document.elementFromPoint(clientX, clientY);
          const cell = hit?.closest?.(".mc-cell");
          if (!cell || !gridEl.contains(cell)) return null;
          return cell;
        }

        function endBrush() {
          if (brushPointerId >= 0) {
            try {
              if (gridEl.hasPointerCapture(brushPointerId)) {
                gridEl.releasePointerCapture(brushPointerId);
              }
            } catch {
              /* ignore */
            }
          }
          dragging = false;
          brushPointerId = -1;
          lastBrushVx = -1;
          lastBrushVy = -1;
        }

        gridEl.addEventListener("pointerdown", (ev) => {
          if (ev.button !== 0) return;
          const cell = ev.target?.closest?.(".mc-cell");
          if (!cell || !gridEl.contains(cell)) return;
          ev.preventDefault();
          const vx = Math.trunc(Number(cell.dataset.vx));
          const vy = Math.trunc(Number(cell.dataset.vy));
          paintValue = !lit[vy * w + vx];
          dragging = true;
          brushPointerId = ev.pointerId;
          lastBrushVx = vx;
          lastBrushVy = vy;
          paintAt(vx, vy, paintValue);
          try {
            gridEl.setPointerCapture(ev.pointerId);
          } catch {
            /* ignore */
          }
          updateHover(vx, vy);
        });

        gridEl.addEventListener("pointerup", endBrush);
        gridEl.addEventListener("pointercancel", endBrush);

        gridEl.addEventListener("pointermove", (ev) => {
          if (dragging && ev.pointerId === brushPointerId) {
            const cell = cellFromClientPoint(ev.clientX, ev.clientY);
            if (!cell) return;
            const vx = Math.trunc(Number(cell.dataset.vx));
            const vy = Math.trunc(Number(cell.dataset.vy));
            if (vx === lastBrushVx && vy === lastBrushVy) {
              updateHover(vx, vy);
              return;
            }
            if (lastBrushVx >= 0 && lastBrushVy >= 0) {
              paintLine(lastBrushVx, lastBrushVy, vx, vy, paintValue);
            } else {
              paintAt(vx, vy, paintValue);
            }
            lastBrushVx = vx;
            lastBrushVy = vy;
            updateHover(vx, vy);
            return;
          }
          const cell = ev.target?.closest?.(".mc-cell");
          if (!cell || !gridEl.contains(cell)) return;
          const vx = Math.trunc(Number(cell.dataset.vx));
          const vy = Math.trunc(Number(cell.dataset.vy));
          updateHover(vx, vy);
        });

        clearBtn.addEventListener("click", () => {
          for (let vy = 0; vy < h; vy += 1) {
            for (let vx = 0; vx < w; vx += 1) paintAt(vx, vy, false);
          }
          statusEl.textContent = "";
          statusEl.classList.remove("mc-err");
          hoverEl.textContent = "";
        });

        async function sendWled() {
          statusEl.textContent = "";
          statusEl.classList.remove("mc-err");
          const cells = new Map();
          for (let vy = 0; vy < h; vy += 1) {
            for (let vx = 0; vx < w; vx += 1) {
              if (!lit[vy * w + vx]) continue;
              const idx = xyToLinearIndex(vx, vy, w, h, d.serpentine, d.scanMode, d.mirrorX);
              if (idx >= 0 && idx < total) cells.set(idx, fgHex);
            }
          }
          const iArr = buildSegI(0, total, cells);
          const body = {
            on: true,
            transition: 0,
            seg: [{ id: d.segmentId, fx: 0, sx: 0, i: iArr }]
          };
          try {
            const res = await fetch(`${endpoint}/json/state`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body)
            });
            if (!res.ok) {
              statusEl.textContent = `${t(lang, "httpErr")}: ${res.status}`;
              statusEl.classList.add("mc-err");
              return;
            }
            statusEl.textContent = t(lang, "sent");
          } catch (e) {
            statusEl.textContent = `${t(lang, "fetchErr")}: ${String(e?.message || e)}`;
            statusEl.classList.add("mc-err");
          }
        }

        sendBtn.addEventListener("click", () => void sendWled());
      })
      .catch((e) => {
        statusEl.textContent = String(e?.message || e);
        statusEl.classList.add("mc-err");
      });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", main);
  else main();
})();
