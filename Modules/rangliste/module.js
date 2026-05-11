(function initRanglisteModule(scope) {
  scope.ADM_MODULES = scope.ADM_MODULES || {};

  function rankT(api, key) {
    const lang = String(api?.getSettings?.()?.uiLanguage || "de").toLowerCase().startsWith("de") ? "de" : "en";
    const v = scope.ADM_I18N?.[lang]?.[key] ?? scope.ADM_I18N?.en?.[key];
    return v != null && v !== "" ? String(v) : key;
  }

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function fmtTs(ts) {
    const n = Number(ts);
    if (!Number.isFinite(n) || n <= 0) return "-";
    try {
      return new Date(n).toLocaleString("de-DE");
    } catch {
      return "-";
    }
  }

  function toNum(value, fallback = null) {
    if (value === null || value === undefined || value === "") return fallback;
    const normalized = String(value).replace(",", ".").replace(/[^\d.+-]/g, "");
    const n = Number(normalized);
    return Number.isFinite(n) ? n : fallback;
  }

  function fmtNum(value, digits = 2) {
    const n = toNum(value, null);
    if (n == null) return "-";
    if (Math.abs(n - Math.round(n)) < 0.005) return String(Math.round(n));
    return n.toFixed(digits).replace(".", ",");
  }

  function foldLabel(s) {
    return String(s || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function pickMetric(metrics, testers) {
    const entries = Object.entries(metrics && typeof metrics === "object" ? metrics : {});
    for (const [label, val] of entries) {
      const L = foldLabel(label);
      if (testers.some((test) => test(L))) return String(val || "").trim();
    }
    return "";
  }

  function renderWebStatSummary(adWeb, adWebError, api) {
    const metrics = adWeb?.metrics && typeof adWeb.metrics === "object" ? adWeb.metrics : {};
    const metricCount = Object.keys(metrics).length;
    const bestAvg = pickMetric(metrics, [
      (L) => (/bester\s+durchschnitt/.test(L) || /\bbest\s+average\b/i.test(L)) && !/checkout/.test(L)
    ]);
    const legs = pickMetric(metrics, [
      (L) => /gespielt\w*\s+legs/.test(L) || /gesamtanzahl\s+legs/.test(L) || /total\s+legs/.test(L) || /\blegs\s+played\b/i.test(L)
    ]);
    const darts = pickMetric(metrics, [
      (L) => /gesamtanzahl\s+darts/.test(L) || /geworfen\w*\s+darts/.test(L) || /total\s+darts/.test(L) || /\bdarts\s+thrown\b/i.test(L)
    ]);
    const status =
      adWeb == null
        ? rankT(api, String(adWebError || "") === "no_statistics_tab" ? "rangliste_web_no_tab" : "rangliste_web_unavailable")
        : metricCount
          ? rankT(api, "rangliste_web_ready")
          : rankT(api, "rangliste_web_empty");

    return `
      <div class="ranglisteWebCard">
        <div>
          <div class="sectionTitle" style="margin:0;">${rankT(api, "rangliste_web_title")}</div>
          <p class="hint ranglisteHint">${esc(status)}</p>
        </div>
        <div class="ranglisteWebKpis">
          <div><span>${rankT(api, "rangliste_best_avg")}</span><strong>${esc(bestAvg || "-")}</strong></div>
          <div><span>${rankT(api, "rangliste_legs")}</span><strong>${esc(legs || "-")}</strong></div>
          <div><span>${rankT(api, "rangliste_darts")}</span><strong>${esc(darts || "-")}</strong></div>
        </div>
      </div>`;
  }

  function buildRanking(players) {
    return (Array.isArray(players) ? players : [])
      .map((p, index) => {
        const legs = toNum(p?.legsWon, 0) || 0;
        const avgMatch = toNum(p?.averageMatch, 0) || 0;
        const avgLeg = toNum(p?.averageLeg, 0) || 0;
        const remaining = toNum(p?.scoreRemaining, 9999);
        const visit = toNum(p?.dartsThrownThisTurn, 0) || 0;
        const score =
          legs * 100000 +
          avgMatch * 1000 +
          avgLeg * 100 +
          visit * 2 -
          (remaining == null ? 9999 : remaining) * 0.1;
        return {
          raw: p,
          sourceIndex: index,
          name: String(p?.displayName || `P${index + 1}`).trim() || `P${index + 1}`,
          legs,
          avgMatch,
          avgLeg,
          remaining,
          visit,
          score
        };
      })
      .sort((a, b) =>
        b.legs - a.legs ||
        b.avgMatch - a.avgMatch ||
        b.avgLeg - a.avgLeg ||
        (a.remaining ?? 9999) - (b.remaining ?? 9999) ||
        b.visit - a.visit ||
        a.sourceIndex - b.sourceIndex
      );
  }

  function renderRanking(domPlay, domPlayError, adWeb, adWebError, api) {
    const snap = domPlay?.snap && typeof domPlay.snap === "object" ? domPlay.snap : null;
    const header = snap?.header;
    const fmt = header?.formatParts?.length ? header.formatParts.join(" - ") : (header?.gameVariant || "-");
    const age = typeof domPlay?.at === "number" && Number.isFinite(domPlay.at) ? fmtTs(domPlay.at) : "-";
    const players = buildRanking(snap?.players || []);

    if (domPlay == null) {
      const key = String(domPlayError || "") === "no_match_tab" ? "rangliste_no_match_tab" : "rangliste_unavailable";
      return `
        ${renderWebStatSummary(adWeb, adWebError, api)}
        <div class="ranglisteEmpty">
          <div class="sectionTitle" style="margin:0;">${rankT(api, "rangliste_live_title")}</div>
          <p class="hint">${esc(rankT(api, key))}</p>
        </div>`;
    }

    if (!players.length) {
      return `
        ${renderWebStatSummary(adWeb, adWebError, api)}
        <div class="ranglisteEmpty">
          <div class="sectionTitle" style="margin:0;">${rankT(api, "rangliste_live_title")}</div>
          <p class="hint">${esc(rankT(api, "rangliste_no_players"))}</p>
        </div>`;
    }

    const rows = players
      .map((p, idx) => {
        const active = p.raw?.isActive ? `<span class="ranglisteActive" title="${esc(rankT(api, "rangliste_active"))}"></span>` : "";
        return `
          <div class="ranglisteRow rank${idx + 1}">
            <div class="ranglistePlace">${idx + 1}</div>
            <div class="ranglistePlayer">
              <strong>${esc(p.name)}${active}</strong>
              <span>${esc(rankT(api, "rangliste_score"))}: ${fmtNum(p.score, 0)}</span>
            </div>
            <div class="ranglisteMetrics">
              <div><span>${rankT(api, "rangliste_legs")}</span><strong>${fmtNum(p.legs, 0)}</strong></div>
              <div><span>${rankT(api, "rangliste_avg_match")}</span><strong>${fmtNum(p.avgMatch)}</strong></div>
              <div><span>${rankT(api, "rangliste_avg_leg")}</span><strong>${fmtNum(p.avgLeg)}</strong></div>
              <div><span>${rankT(api, "rangliste_remaining")}</span><strong>${fmtNum(p.remaining, 0)}</strong></div>
              <div><span>${rankT(api, "rangliste_visit")}</span><strong>${fmtNum(p.visit, 0)}</strong></div>
            </div>
          </div>`;
      })
      .join("");

    return `
      ${renderWebStatSummary(adWeb, adWebError, api)}
      <div class="ranglisteMeta">
        <div>
          <div class="sectionTitle" style="margin:0;">${rankT(api, "rangliste_live_title")}</div>
          <p class="hint ranglisteHint">${esc(fmt)} - ${rankT(api, "rangliste_dom_age")}: ${esc(age)}</p>
        </div>
      </div>
      <div class="ranglisteRows">${rows}</div>
      <p class="hint ranglisteHint">${rankT(api, "rangliste_formula_hint")}</p>`;
  }

  async function refreshRangliste(api, root) {
    const mount = root.querySelector("#ranglisteMount");
    const statusEl = root.querySelector("#ranglisteStatus");
    if (!mount) return;
    try {
      const [domRes, adWebRes] = await Promise.all([
        api.send({ type: "GET_ADM_DOM_PLAY_STATS" }),
        api.send({ type: "GET_ADM_STATISTICS_PAGE_SNAPSHOT" })
      ]);
      const domPlay = domRes?.ok ? domRes.payload : null;
      const domPlayError = domRes?.ok ? null : String(domRes?.error || "dom_stats_failed");
      const adWeb = adWebRes?.ok ? adWebRes.payload : null;
      const adWebError = adWebRes?.ok ? null : String(adWebRes?.error || "ad_web_stats_failed");
      mount.innerHTML = renderRanking(domPlay, domPlayError, adWeb, adWebError, api);
      if (statusEl) statusEl.textContent = "";
    } catch (e) {
      if (statusEl) statusEl.textContent = `${rankT(api, "rangliste_load_failed")}: ${String(e?.message || e)}`;
    }
  }

  scope.ADM_MODULES.rangliste = {
    id: "rangliste",
    icon: "#",
    navLabelKey: "nav_rangliste",
    needs: { streamerbot: false, obs: false },
    render() {
      return `
        <h2 class="title"><span data-i18n="title_rangliste">Rangliste</span><span class="titleMeta">Live</span></h2>
        <div class="card">
          <p class="hint" data-i18n="rangliste_intro">Vergleicht die Spieler im aktuell offenen Match anhand der Statistikwerte.</p>
          <div id="ranglisteMount" style="margin-top:10px;"></div>
          <div class="rowSplit" style="margin-top:12px;">
            <button id="ranglisteRefreshBtn" class="btnPrimary" type="button" data-i18n="rangliste_refresh_btn">Aktualisieren</button>
          </div>
          <div id="ranglisteStatus" class="hint" style="margin-top:8px;"></div>
        </div>
        <div class="spacer"></div>
      `;
    },
    bind(api) {
      const root = api.root;
      if (root.__ranglisteTimer) {
        try { clearInterval(root.__ranglisteTimer); } catch {}
        root.__ranglisteTimer = null;
      }
      root.querySelector("#ranglisteRefreshBtn")?.addEventListener("click", () => {
        void refreshRangliste(api, root);
      });
      root.__ranglisteTimer = setInterval(() => {
        const page = root.closest(".page");
        if (!page || !page.classList.contains("active")) return;
        void refreshRangliste(api, root);
      }, 2000);
    },
    sync(api) {
      void refreshRangliste(api, api.root);
    }
  };
})(window);
