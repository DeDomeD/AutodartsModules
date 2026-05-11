/**
 * Worker-Mirror-Log UI (Overlay im Popup + eigenes Popout-Fenster).
 * Von settings-page.js aus installiert.
 */
(function initWorkerMirrorUi(scope) {
  const ADM_WORKER_MIRROR_UI = {
    /**
     * @param {object} cfg
     * @param {Document} [cfg.rootDoc]
     * @param {"overlay"|"standalone"} cfg.mode
     * @param {HTMLElement} [cfg.mountTarget] Standalone: Container; Overlay: default body
     * @param {HTMLElement} [cfg.settingsPageRoot] Overlay: Settings-.page root fuer Timer/isConnected
     * @param {() => object} cfg.getSettings
     * @param {(partial: object) => Promise<unknown>} cfg.savePartial
     * @param {(key: string, vars?: object) => string} cfg.t
     * @param {() => boolean} [cfg.shouldPoll] Overlay: default wenn Settings-Tab oder Shell offen
     * @param {() => void} [cfg.applyI18n]
     */
    install(cfg) {
      const doc = cfg.rootDoc || document;
      const mode = cfg.mode === "standalone" ? "standalone" : "overlay";
      const mountTarget = cfg.mountTarget || doc.body;
      const settingsPageRoot = cfg.settingsPageRoot || null;
      const getSettings = typeof cfg.getSettings === "function" ? cfg.getSettings : () => ({});
      const savePartial = typeof cfg.savePartial === "function" ? cfg.savePartial : async () => {};
      const t = typeof cfg.t === "function" ? cfg.t : (k) => k;
      const applyI18n = typeof cfg.applyI18n === "function" ? cfg.applyI18n : null;
      const shouldPollOverlay =
        typeof cfg.shouldPoll === "function"
          ? cfg.shouldPoll
          : () => {
              const settingsActive = !!doc
                .querySelector('.page[data-page="settings"]')
                ?.classList.contains("active");
              const shellOpen = !!getWorkerMirrorShell()?.classList.contains("isOpen");
              return settingsActive || shellOpen;
            };
      const shouldPoll = mode === "standalone" ? () => true : shouldPollOverlay;

      const mirrorApi = { getSettings, savePartial };
      const mirrorState = { lastId: -1, lines: [], maxLines: 2500 };
      let mirrorOverlayEscHandler = null;
      const pollAnchor = settingsPageRoot || mountTarget;
      const MIRROR_POLL_GLOBAL = "__admMirrorPollTimerId";

      function getWorkerMirrorShell() {
        return doc.getElementById("workerMirrorShell");
      }

      function removeMirrorOverlayEscHandler() {
        if (mirrorOverlayEscHandler) {
          doc.removeEventListener("keydown", mirrorOverlayEscHandler, true);
          mirrorOverlayEscHandler = null;
        }
      }

      function flattenMirrorSegments(segments) {
        if (!Array.isArray(segments)) return "";
        let out = "";
        for (let i = 0; i < segments.length; i += 1) {
          out += segments[i]?.text == null ? "" : String(segments[i].text);
        }
        return out;
      }

      function inferMirrorLineCategory(ent) {
        const fromServer = String(ent?.category || "").toUpperCase();
        if (
          fromServer === "AD" ||
          fromServer === "SB" ||
          fromServer === "OBS" ||
          fromServer === "WLED" ||
          fromServer === "MISC"
        ) {
          return fromServer;
        }
        const plain = flattenMirrorSegments(ent?.segments);
        const trimPlain = String(plain || "").trim();
        if (/^wled controller\b/i.test(trimPlain)) return "WLED";
        if (
          /message handler error/i.test(plain) &&
          /GET_WLED|TRIGGER_WLED/i.test(plain)
        ) {
          return "WLED";
        }
        if (
          /message handler error/i.test(plain) &&
          /"type"\s*:\s*"OBS_/i.test(plain)
        ) {
          return "OBS";
        }
        if (
          /message handler error/i.test(plain) &&
          /"type"\s*:\s*"SB_/i.test(plain)
        ) {
          return "SB";
        }
        if (/^\[MISC\]|\[MISC\]/i.test(plain)) return "MISC";
        if (/\[ADM\][^\n]*\bZoom\b/i.test(plain) || /\bZoom\s+[TD]\d/i.test(plain)) return "OBS";
        if (/\[ADM\]/i.test(plain)) return "AD";
        if (/^\[SB\]|\[SB\]/i.test(plain) || /\bstreamerbot\b/i.test(plain)) return "SB";
        if (/^\[OBS\]|\[OBS\]/i.test(plain) || /^OBS\s/i.test(plain.trim())) return "OBS";
        if (/^\[WLED\]|\[WLED\]/i.test(plain) || /\bwled\b/i.test(plain)) return "WLED";
        if (/\[AutoDart - Modules\]/i.test(plain)) return "MISC";
        return "MISC";
      }

      function parseMirrorFilterTokens(raw) {
        const s = String(raw || "").trim();
        if (!s) return { include: [], exclude: [] };
        const parts = s.split(/\s+/).filter(Boolean);
        const include = [];
        const exclude = [];
        for (const p of parts) {
          if (p.startsWith("-") && p.length > 1) exclude.push(p.slice(1).toLowerCase());
          else include.push(p.toLowerCase());
        }
        return { include, exclude };
      }

      function mirrorLinePassesTextFilter(plainLower, rawFilter) {
        const { include, exclude } = parseMirrorFilterTokens(rawFilter);
        for (const ex of exclude) {
          if (!ex) continue;
          if (plainLower.includes(ex)) return false;
        }
        for (const inc of include) {
          if (!inc) continue;
          if (!plainLower.includes(inc)) return false;
        }
        return true;
      }

      function getMirrorCatTier(cat) {
        const shell = getWorkerMirrorShell();
        if (!shell) return 0;
        const btn = shell.querySelector(`.workerMirrorCatBtn[data-mirror-cat="${cat}"]`);
        if (!btn) return 0;
        const tier = parseInt(String(btn.dataset.mirrorTier ?? "0"), 10);
        return tier === 0 || tier === 1 || tier === 2 ? tier : 0;
      }

      function syncMirrorCatBtnDOM(btn) {
        if (!btn || typeof btn.querySelector !== "function") return;
        let tier = parseInt(String(btn.dataset.mirrorTier ?? "0"), 10);
        if (!Number.isFinite(tier) || tier < 0 || tier > 2) tier = 0;
        btn.dataset.mirrorTier = String(tier);
        btn.classList.remove("workerMirrorCatBtn--t0", "workerMirrorCatBtn--t1", "workerMirrorCatBtn--t2");
        btn.classList.add(`workerMirrorCatBtn--t${tier}`);
        const segs = btn.querySelectorAll(".workerMirrorCatBtnMeter i");
        segs.forEach((seg, i) => {
          seg.classList.toggle("on", (tier === 0 && i === 0) || (tier === 1 && i <= 1));
        });
      }

      function miscIsSbConnectionDetail(plainLower) {
        const s = String(plainLower || "").trim();
        if (!/^\[misc\]/i.test(s)) return false;
        return (
          /\bconnecting to streamerbot\b/i.test(s) ||
          /\breconnect scheduled\b/i.test(s) ||
          /\sstreamerbot ws open\b/i.test(s) ||
          /\sstreamerbot ws closed\b/i.test(s)
        );
      }

      function miscIsObsConnectionDetail(plainLower) {
        const s = String(plainLower || "").trim();
        if (!/^\[misc\]/i.test(s)) return false;
        return (
          /\bobs connecting\b/i.test(s) ||
          /\bobs ws open\b/i.test(s) ||
          /\bobs reconnect\b/i.test(s) ||
          /\bobs endpoint unreachable\b/i.test(s) ||
          /\bobs websocket failed\b/i.test(s) ||
          /\bobs reconnect exhausted\b/i.test(s)
        );
      }

      function miscTierMinimalOk(plain, plainLower) {
        if (miscIsSbConnectionDetail(plainLower) || miscIsObsConnectionDetail(plainLower)) return false;
        if (/extension ready/i.test(plainLower)) return true;
        if (!/^\[misc\]/i.test(String(plain || "").trim())) return false;
        return /\b(error|warn|fatal)\b/i.test(plainLower);
      }

      function adMinimalOk(plainLower) {
        if (!/\[adm\]/i.test(plainLower)) return false;
        if (/checkout guide/i.test(plainLower)) return false;
        return (
          /\bthrow\s+\d+\s*->/i.test(plainLower) ||
          /player turn/.test(plainLower) ||
          /end turn/.test(plainLower) ||
          /leg win/.test(plainLower) ||
          /\bbust\b/.test(plainLower) ||
          /game on/.test(plainLower) ||
          /next leg/.test(plainLower) ||
          /takeout/.test(plainLower)
        );
      }

      function sbMinimalOk(plainLower) {
        const p = String(plainLower || "").trim();
        if (/streamerbot\s+(connected|disconnected)/i.test(p)) return true;
        if (/\[adm\]\s*sb\s+action\b/i.test(p)) return true;
        return false;
      }

      function obsZoomEngineDiagInPlain(plainLower) {
        return (
          /checkout auto zoom (skipped|applied|failed)/i.test(plainLower) ||
          /managed zoom (skipped|applied)/i.test(plainLower)
        );
      }

      function obsMinimalOk(plainLower) {
        if (/\bobs\s+(connected|disconnected)\b/i.test(plainLower)) return true;
        if (obsZoomEngineDiagInPlain(plainLower)) return false;
        if (/\[adm\][^\n]*\bzoom\b/i.test(plainLower)) return true;
        return false;
      }

      /**
       * Konsolenzeilen tragen optional `#123` vor `[ADM]` — Minimal-Filter muss danach prüfen.
       */
      function wledPlainAfterOptionalSerial(plainLower) {
        return String(plainLower || "")
          .trim()
          .replace(/^#\d+\s+/i, "")
          .trim()
          .toLowerCase();
      }

      /**
       * WLED Stufe 0 (ein Punkt): nur gelbe `[ADM]`-Kurzzeilen (Preset mit Pipes, Matrix „Name = Rest“)
       * sowie die grüne/roten Statuszeile „WLED Controller Connected/Disconnected“ (ohne Badge).
       * Alle `[WLED]`-Loggerzeilen (matrix POST, Preset-JSON, …) nur in Stufe 1 (zwei Punkte).
       */
      function wledMinimalOk(plainLower) {
        const p = wledPlainAfterOptionalSerial(plainLower);
        if (/^wled controller\s+(connected|disconnected)\b/.test(p)) return true;
        if (!/^\[adm\]/.test(p)) return false;
        if (/^\[adm\]\s*matrix\s+\d+\s*=/.test(p)) return true;
        const afterBadge = p.replace(/^\[adm\]\s*/, "").trim();
        const pipeCount = (afterBadge.match(/\|/g) || []).length;
        if (pipeCount >= 2) return true;
        /** Matrix-Spiegel: `[ADM] Segment-Name = 501` (keine Pipes; frueher nur `matrix 1 = …`). */
        if (
          pipeCount < 2 &&
          /\s=\s/.test(afterBadge) &&
          /=\s*[\d?—-]+$/.test(afterBadge.replace(/\s+$/g, ""))
        ) {
          return true;
        }
        return false;
      }

      function isMirrorLineVisible(ent) {
        const cat = inferMirrorLineCategory(ent);
        const plain = flattenMirrorSegments(ent.segments);
        const plainLower = plain.toLowerCase();

        if (cat === "MISC") {
          const tm = getMirrorCatTier("MISC");
          if (tm === 1) return true;
          if (tm === 2) {
            if (getMirrorCatTier("SB") === 1 && miscIsSbConnectionDetail(plainLower)) return true;
            if (getMirrorCatTier("OBS") === 1 && miscIsObsConnectionDetail(plainLower)) return true;
            return false;
          }
          return miscTierMinimalOk(plain, plainLower);
        }

        const tier = getMirrorCatTier(cat);
        if (tier === 2) return false;
        if (tier === 1) return true;
        if (cat === "AD") return adMinimalOk(plainLower);
        if (cat === "SB") return sbMinimalOk(plainLower);
        if (cat === "OBS") return obsMinimalOk(plainLower);
        if (cat === "WLED") return wledMinimalOk(plainLower);
        return false;
      }

      function getMirrorVisibleEntries() {
        const filterRaw = doc.getElementById("workerMirrorFilterInput")?.value ?? "";
        const out = [];
        for (let i = 0; i < mirrorState.lines.length; i += 1) {
          const ent = mirrorState.lines[i];
          if (!ent || typeof ent !== "object") continue;
          const cat = inferMirrorLineCategory(ent);
          if (!isMirrorLineVisible(ent)) continue;
          const plain = flattenMirrorSegments(ent.segments);
          const plainLower = plain.toLowerCase();
          if (!mirrorLinePassesTextFilter(plainLower, filterRaw)) continue;
          out.push({ ent, cat, plain });
        }
        return out;
      }

      function scrollMirrorViewportToBottom() {
        const vp = doc.getElementById("workerMirrorLogViewport");
        if (!vp) return;
        const snap = () => {
          vp.scrollTop = vp.scrollHeight;
          const last = vp.lastElementChild;
          if (last && typeof last.scrollIntoView === "function") {
            try {
              last.scrollIntoView({ block: "end", inline: "nearest" });
            } catch {
              try {
                last.scrollIntoView(false);
              } catch {
                // ignore
              }
            }
          }
        };
        snap();
        try {
          requestAnimationFrame(() => {
            snap();
            requestAnimationFrame(snap);
          });
        } catch {
          try {
            requestAnimationFrame(snap);
          } catch {
            // ignore
          }
        }
        setTimeout(snap, 0);
        setTimeout(snap, 40);
        setTimeout(snap, 120);
      }

      function refreshMirrorViewport() {
        const vp = doc.getElementById("workerMirrorLogViewport");
        if (!vp) return;
        vp.innerHTML = "";
        const visible = getMirrorVisibleEntries();
        for (let i = 0; i < visible.length; i += 1) {
          const { ent, cat } = visible[i];
          const row = doc.createElement("div");
          row.className = "workerMirrorLogLine";
          row.dataset.mirrorCat = cat;
          const segs = ent.segments;
          if (Array.isArray(segs) && segs.length) {
            for (let j = 0; j < segs.length; j += 1) {
              const seg = segs[j];
              const sp = doc.createElement("span");
              if (seg && seg.css) sp.setAttribute("style", String(seg.css));
              sp.textContent = seg?.text == null ? "" : String(seg.text);
              row.appendChild(sp);
            }
          } else if (ent.text != null) {
            row.textContent = String(ent.text);
          }
          vp.appendChild(row);
        }
        scrollMirrorViewportToBottom();
      }

      function downloadWorkerMirrorTxt() {
        const lines = getMirrorVisibleEntries().map((x) => x.plain);
        const text = lines.join("\n");
        const pad = (n) => String(n).padStart(2, "0");
        const d = new Date();
        const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
        const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = doc.createElement("a");
        a.href = url;
        a.download = `worker-console_${stamp}.txt`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
      }

      function normalizeWorkerMirrorTiers(raw) {
        const keys = ["AD", "SB", "OBS", "WLED", "MISC"];
        const out = { AD: 0, SB: 0, OBS: 0, WLED: 0, MISC: 0 };
        if (raw && typeof raw === "object" && !Array.isArray(raw)) {
          for (const k of keys) {
            const n = Number(raw[k]);
            if (n === 0 || n === 1 || n === 2) out[k] = n;
          }
        }
        return out;
      }

      function applyWorkerMirrorTiersToDom(rawTiers) {
        const shell = getWorkerMirrorShell();
        if (!shell) return;
        const tiers = normalizeWorkerMirrorTiers(rawTiers);
        shell.querySelectorAll(".workerMirrorCatBtn[data-mirror-cat]").forEach((btn) => {
          const cat = btn.getAttribute("data-mirror-cat");
          if (!cat || tiers[cat] === undefined) return;
          btn.dataset.mirrorTier = String(tiers[cat]);
          syncMirrorCatBtnDOM(btn);
        });
        refreshMirrorViewport();
      }

      function collectWorkerMirrorTiersFromDom() {
        const tiers = {};
        getWorkerMirrorShell()?.querySelectorAll(".workerMirrorCatBtn[data-mirror-cat]").forEach((btn) => {
          const c = btn.getAttribute("data-mirror-cat");
          const n = parseInt(String(btn.dataset.mirrorTier ?? "0"), 10);
          if (c && (n === 0 || n === 1 || n === 2)) tiers[c] = n;
        });
        return tiers;
      }

      async function persistWorkerMirrorTiers() {
        const tiers = collectWorkerMirrorTiersFromDom();
        const keys = ["AD", "SB", "OBS", "WLED", "MISC"];
        if (keys.some((k) => tiers[k] === undefined)) return;
        try {
          await savePartial({ workerMirrorCatTiers: tiers });
        } catch {
          // ignore
        }
      }

      function wireWorkerMirrorFilterControls(shell) {
        if (!shell || shell.dataset.admMirrorFilterWired === "1") return;
        shell.dataset.admMirrorFilterWired = "1";
        shell.querySelectorAll(".workerMirrorCatBtn").forEach((btn) => {
          syncMirrorCatBtnDOM(btn);
          btn.addEventListener("click", () => {
            const cur = parseInt(String(btn.dataset.mirrorTier ?? "0"), 10);
            const base = Number.isFinite(cur) && cur >= 0 && cur <= 2 ? cur : 0;
            btn.dataset.mirrorTier = String((base + 1) % 3);
            syncMirrorCatBtnDOM(btn);
            refreshMirrorViewport();
            void persistWorkerMirrorTiers();
          });
        });
        const fin = shell.querySelector("#workerMirrorFilterInput");
        if (fin) {
          let timer = null;
          fin.addEventListener("input", () => {
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => {
              timer = null;
              refreshMirrorViewport();
            }, 120);
          });
        }
      }

      function buildMirrorPanelHtml(includePopout) {
        const popoutBtn = includePopout
          ? `<button type="button" class="btnMini" id="btnPopoutWorkerMirror" data-i18n="worker_mirror_popout" data-i18n-title="worker_mirror_popout_title" title="">Pop-out</button>`
          : "";
        return `
          <div
            class="workerMirrorOverlayPanel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="workerMirrorOverlayTitle"
          >
            <div class="workerMirrorOverlayTop">
              <div class="workerMirrorOverlayTitle" id="workerMirrorOverlayTitle" data-i18n="worker_mirror_log_summary">
                Logs
              </div>
              <div class="workerMirrorOverlayToolbar">
                <div class="workerMirrorOverlayToolbarMain">
                  ${popoutBtn}
                  <button type="button" class="btnMini" id="btnDownloadWorkerMirror" data-i18n="worker_mirror_download" data-i18n-title="worker_mirror_download_title" title="">
                    Download
                  </button>
                  <button type="button" class="btnMini" id="btnClearWorkerMirror" data-i18n="worker_mirror_log_clear">
                    Leeren
                  </button>
                </div>
                <button type="button" class="workerMirrorOverlayCloseBtn" id="btnCloseWorkerMirrorOverlay" data-i18n-title="worker_mirror_close_title" data-i18n-aria-label="worker_mirror_close_title" title="" aria-label="">×</button>
              </div>
            </div>
            <div class="workerMirrorOverlayFilters">
              <div class="workerMirrorCatToggles" role="toolbar" aria-label="" data-i18n-aria-label="worker_mirror_cat_toolbar_aria">
                <button type="button" class="workerMirrorCatBtn workerMirrorCatBtn--t0" data-mirror-tier="0" data-mirror-cat="AD" data-i18n-title="worker_mirror_cat_ad_title" title=""><span class="workerMirrorCatBtnTxt">AD</span><span class="workerMirrorCatBtnMeter" aria-hidden="true"><i></i><i></i><i></i></span></button>
                <button type="button" class="workerMirrorCatBtn workerMirrorCatBtn--t0" data-mirror-tier="0" data-mirror-cat="SB" data-i18n-title="worker_mirror_cat_sb_title" title=""><span class="workerMirrorCatBtnTxt">SB</span><span class="workerMirrorCatBtnMeter" aria-hidden="true"><i></i><i></i><i></i></span></button>
                <button type="button" class="workerMirrorCatBtn workerMirrorCatBtn--t0" data-mirror-tier="0" data-mirror-cat="OBS" data-i18n-title="worker_mirror_cat_obs_title" title=""><span class="workerMirrorCatBtnTxt">OBS</span><span class="workerMirrorCatBtnMeter" aria-hidden="true"><i></i><i></i><i></i></span></button>
                <button type="button" class="workerMirrorCatBtn workerMirrorCatBtn--t0" data-mirror-tier="0" data-mirror-cat="WLED" data-i18n-title="worker_mirror_cat_wled_title" title=""><span class="workerMirrorCatBtnTxt">WLED</span><span class="workerMirrorCatBtnMeter" aria-hidden="true"><i></i><i></i><i></i></span></button>
                <button type="button" class="workerMirrorCatBtn workerMirrorCatBtnAll workerMirrorCatBtn--t0" data-mirror-tier="0" data-mirror-cat="MISC" data-i18n-title="worker_mirror_cat_all_title" title=""><span class="workerMirrorCatBtnTxt">ALL</span><span class="workerMirrorCatBtnMeter" aria-hidden="true"><i></i><i></i><i></i></span></button>
              </div>
              <input
                type="text"
                class="input workerMirrorFilterInput"
                id="workerMirrorFilterInput"
                data-i18n-placeholder="worker_mirror_filter_placeholder"
                placeholder=""
                spellcheck="false"
                autocomplete="off"
              />
            </div>
            <div id="workerMirrorLogViewport" class="workerMirrorLogViewport workerMirrorLogViewportOverlay" role="log"></div>
          </div>
        `;
      }

      function openOrFocusMirrorPopout() {
        const url = chrome.runtime.getURL("Modules/effects/mirror-log-window.html");
        chrome.windows.getAll({ populate: true, windowTypes: ["popup"] }, (wins) => {
          if (chrome.runtime.lastError) {
            chrome.windows.create(
              { url, type: "popup", width: 960, height: 800, focused: true },
              () => void chrome.runtime.lastError
            );
            return;
          }
          let foundWindowId = null;
          for (let wi = 0; wi < wins.length; wi += 1) {
            const w = wins[wi];
            const tabs = Array.isArray(w?.tabs) ? w.tabs : [];
            for (let ti = 0; ti < tabs.length; ti += 1) {
              if (tabs[ti]?.url === url && Number.isFinite(w?.id)) {
                foundWindowId = w.id;
                break;
              }
            }
            if (foundWindowId != null) break;
          }
          if (foundWindowId != null) {
            chrome.windows.update(foundWindowId, { focused: true }, () => void chrome.runtime.lastError);
            return;
          }
          chrome.windows.create(
            { url, type: "popup", width: 960, height: 800, focused: true },
            () => void chrome.runtime.lastError
          );
        });
      }

      function mountWorkerMirrorShell() {
        const existing = doc.getElementById("workerMirrorShell");
        if (existing) existing.remove();
        const shell = doc.createElement("div");
        shell.id = "workerMirrorShell";
        shell.className = mode === "overlay" ? "workerMirrorOverlay" : "workerMirrorStandaloneShell";
        shell.setAttribute("aria-hidden", mode === "overlay" ? "true" : "false");
        shell.innerHTML = buildMirrorPanelHtml(true);
        mountTarget.appendChild(shell);
        wireWorkerMirrorFilterControls(shell);
        applyWorkerMirrorTiersToDom(getSettings()?.workerMirrorCatTiers);
        try {
          applyI18n?.();
        } catch {
          // ignore
        }

        shell.querySelector("#btnCloseWorkerMirrorOverlay")?.addEventListener("click", () => {
          if (mode === "standalone") {
            try {
              window.close();
            } catch {
              // ignore
            }
          } else {
            closeWorkerMirrorOverlay();
          }
        });
        shell.querySelector("#btnDownloadWorkerMirror")?.addEventListener("click", () => {
          downloadWorkerMirrorTxt();
        });
        shell.querySelector("#btnClearWorkerMirror")?.addEventListener("click", () => {
          chrome.runtime.sendMessage({ type: "CLEAR_WORKER_MIRROR_LOG" }, () => {
            void chrome.runtime.lastError;
            mirrorState.lastId = -1;
            mirrorState.lines = [];
            refreshMirrorViewport();
          });
        });
        shell.querySelector("#btnPopoutWorkerMirror")?.addEventListener("click", () => {
          openOrFocusMirrorPopout();
          if (mode === "overlay") {
            closeWorkerMirrorOverlay();
          }
        });
      }

      function openWorkerMirrorOverlay() {
        if (!getWorkerMirrorShell()) mountWorkerMirrorShell();
        const shell = getWorkerMirrorShell();
        if (shell && mode === "overlay") {
          shell.classList.add("isOpen");
          shell.setAttribute("aria-hidden", "false");
        }
        removeMirrorOverlayEscHandler();
        mirrorOverlayEscHandler = (ev) => {
          if (ev.key !== "Escape") return;
          if (mode === "standalone") {
            try {
              window.close();
            } catch {
              // ignore
            }
            return;
          }
          if (!getWorkerMirrorShell()?.classList.contains("isOpen")) return;
          ev.preventDefault();
          closeWorkerMirrorOverlay();
        };
        doc.addEventListener("keydown", mirrorOverlayEscHandler, true);
        pollWorkerMirror();
        applyWorkerMirrorTiersToDom(getSettings()?.workerMirrorCatTiers);
        requestAnimationFrame(() => {
          getWorkerMirrorShell()?.querySelector("#workerMirrorFilterInput")?.focus?.();
        });
      }

      function closeWorkerMirrorOverlay() {
        const shell = getWorkerMirrorShell();
        if (shell && mode === "overlay") {
          shell.classList.remove("isOpen");
          shell.setAttribute("aria-hidden", "true");
        }
        removeMirrorOverlayEscHandler();
      }

      function renderMirrorDelta(res) {
        if (!res?.ok) return;
        const list = Array.isArray(res.lines) ? res.lines : [];
        if (res.truncated) {
          mirrorState.lines = [];
        }
        for (let i = 0; i < list.length; i += 1) {
          const ent = list[i];
          if (!ent || typeof ent !== "object") continue;
          mirrorState.lines.push({
            id: ent.id,
            segments: ent.segments,
            category: ent.category
          });
        }
        while (mirrorState.lines.length > mirrorState.maxLines) {
          mirrorState.lines.shift();
        }
        if (Number.isFinite(res.lastId)) mirrorState.lastId = res.lastId;
        refreshMirrorViewport();
      }

      function pollWorkerMirror() {
        if (mode === "overlay" && settingsPageRoot && !settingsPageRoot.isConnected) {
          const g = doc.defaultView || window;
          if (g[MIRROR_POLL_GLOBAL]) {
            clearInterval(g[MIRROR_POLL_GLOBAL]);
            g[MIRROR_POLL_GLOBAL] = null;
          }
          return;
        }
        if (!pollAnchor.isConnected) {
          const g = doc.defaultView || window;
          if (g[MIRROR_POLL_GLOBAL]) {
            clearInterval(g[MIRROR_POLL_GLOBAL]);
            g[MIRROR_POLL_GLOBAL] = null;
          }
          return;
        }
        if (!shouldPoll()) return;
        chrome.runtime.sendMessage(
          { type: "GET_WORKER_MIRROR_DELTA", afterId: mirrorState.lastId },
          (res) => {
            void chrome.runtime.lastError;
            renderMirrorDelta(res);
          }
        );
      }

      if (mode === "standalone") {
        mountWorkerMirrorShell();
        openWorkerMirrorOverlay();
      } else {
        mountWorkerMirrorShell();
      }

      const gWin = doc.defaultView || window;
      if (gWin[MIRROR_POLL_GLOBAL]) clearInterval(gWin[MIRROR_POLL_GLOBAL]);
      gWin[MIRROR_POLL_GLOBAL] = setInterval(pollWorkerMirror, 450);
      pollWorkerMirror();

      if (mode === "overlay" && !doc.body.dataset.admWorkerMirrorEyeDelegate) {
        doc.body.dataset.admWorkerMirrorEyeDelegate = "1";
        doc.body.addEventListener("click", (ev) => {
          if (ev.target.closest("#btnOpenWorkerMirrorWindow")) {
            openOrFocusMirrorPopout();
            return;
          }
          if (!ev.target.closest("#btnOpenServiceWorker")) return;
          const shell = getWorkerMirrorShell();
          if (shell?.classList.contains("isOpen")) closeWorkerMirrorOverlay();
          else openWorkerMirrorOverlay();
        });
      }

      return {
        applyWorkerMirrorTiersToDom,
        openWorkerMirrorOverlay,
        closeWorkerMirrorOverlay,
        getWorkerMirrorShell,
        openMirrorLogPopoutWindow: openOrFocusMirrorPopout
      };
    }
  };

  scope.ADM_WORKER_MIRROR_UI = ADM_WORKER_MIRROR_UI;
})(window);
