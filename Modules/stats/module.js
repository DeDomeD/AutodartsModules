(function initStatsModule(scope) {
  scope.ADM_MODULES = scope.ADM_MODULES || {};

  function statsT(api, key) {
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

  function readLatestSample(payload, kind) {
    const arr = payload?.samples?.[kind];
    if (!Array.isArray(arr) || !arr.length) return null;
    return arr[arr.length - 1] || null;
  }

  function nerdCountersBlock(counters, api) {
    const c = counters && typeof counters === "object" ? counters : {};
    const total = Number(c.total || 0);
    const throwCount = Number(c.throw || 0);
    const stateCount = Number(c.state || 0);
    const eventCount = Number(c.event || 0);
    const uiCount = Number(c.ui || 0);
    const captureCount = Number(c.capture || 0);
    return `
        <div class="listItem"><span>${statsT(api, "stats_total_events")}</span><strong>${total}</strong></div>
        <div class="listItem"><span>${statsT(api, "stats_throws")}</span><strong>${throwCount}</strong></div>
        <div class="listItem"><span>${statsT(api, "stats_states")}</span><strong>${stateCount}</strong></div>
        <div class="listItem"><span>${statsT(api, "stats_game_events")}</span><strong>${eventCount}</strong></div>
        <div class="listItem"><span>${statsT(api, "stats_ui_events")}</span><strong>${uiCount}</strong></div>
        <div class="listItem"><span>${statsT(api, "stats_capture_events")}</span><strong>${captureCount}</strong></div>`;
  }

  function throwBreakdownRows(agg, api) {
    const a = agg && typeof agg === "object" ? agg : {};
    const n = (k) => Number(a[k] || 0);
    return `
        <div class="listItem"><span>${statsT(api, "stats_throw_scored")}</span><strong>${n("withPoints")}</strong></div>
        <div class="listItem"><span>${statsT(api, "stats_throw_miss")}</span><strong>${n("miss")}</strong></div>
        <div class="listItem"><span>${statsT(api, "stats_throw_triple")}</span><strong>${n("triple")}</strong></div>
        <div class="listItem"><span>${statsT(api, "stats_throw_double")}</span><strong>${n("doubleRing")}</strong></div>
        <div class="listItem"><span>${statsT(api, "stats_throw_bull25")}</span><strong>${n("bull25")}</strong></div>
        <div class="listItem"><span>${statsT(api, "stats_throw_bull50")}</span><strong>${n("bull50")}</strong></div>
        <div class="listItem"><span>${statsT(api, "stats_throw_t60")}</span><strong>${n("t60")}</strong></div>`;
  }

  function visitLiveRows(snap, api) {
    if (!snap || typeof snap !== "object" || !snap.turn) return "";
    const t = snap.turn;
    const visit = t.visitSum != null && Number.isFinite(Number(t.visitSum)) ? String(t.visitSum) : "—";
    const filled = t.filledSlotCount != null ? String(t.filledSlotCount) : "—";
    const labels = Array.isArray(t.dartSegmentLabels)
      ? t.dartSegmentLabels.map((x) => esc(x == null || x === "" ? "—" : String(x))).join(" · ")
      : "—";
    const pts = Array.isArray(t.dartPoints)
      ? t.dartPoints.map((x) => (x == null || x === "" ? "—" : esc(String(x)))).join(" · ")
      : "—";
    return `
        <div class="sectionTitle statsNerdSubHead">${statsT(api, "stats_throw_live_visit_title")}</div>
        <div class="list statsNerdList">
          <div class="listItem"><span>${statsT(api, "stats_throw_live_visit_sum")}</span><strong>${esc(visit)}</strong></div>
          <div class="listItem"><span>${statsT(api, "stats_throw_live_slots")}</span><strong>${esc(filled)}</strong></div>
          <div class="listItem"><span>${statsT(api, "stats_throw_live_seg")}</span><strong>${labels}</strong></div>
          <div class="listItem"><span>${statsT(api, "stats_throw_live_pts")}</span><strong>${pts}</strong></div>
        </div>`;
  }

  function nerdDetailsSectionCombined(sessionCtr, lifetimeCtr, api) {
    return `
      <details id="statsNerdDetails" class="statsNerdDetails">
        <summary class="statsNerdSummary">${statsT(api, "stats_nerd_summary")}</summary>
        <p class="hint statsNerdHint">${statsT(api, "stats_nerd_hint")}</p>
        <div class="sectionTitle statsNerdSubHead">${statsT(api, "stats_section_session")}</div>
        <div class="list statsNerdList">
          ${nerdCountersBlock(sessionCtr, api)}
        </div>
        <div class="sectionTitle statsNerdSubHead" style="margin-top:10px;">${statsT(api, "stats_section_lifetime")}</div>
        <div class="list statsNerdList">
          ${nerdCountersBlock(lifetimeCtr, api)}
        </div>
      </details>`;
  }

  function compactSessionBlock(titleKey, counters, throwAgg, api, opts = {}) {
    const throwCount = Number(counters?.throw || 0);
    const detailsId = String(opts.detailsId || "statsThrowInline");
    const domSnap = opts.domSnap && typeof opts.domSnap === "object" ? opts.domSnap : null;
    const liveBlock =
      opts.includeLiveVisit && domSnap?.turn ? visitLiveRows(domSnap, api) : "";
    return `
      <div class="formRow" style="margin-top:2px;">
        <div class="sectionTitle" style="margin:0;">${statsT(api, titleKey)}</div>
        <div class="statsThrowsBlock">
          <div class="list" style="margin-top:8px;">
            <details id="${esc(detailsId)}" class="statsInlineThrowDetails">
              <summary class="statsInlineThrowSummary">
                <span>${statsT(api, "stats_throws")}</span>
                <span class="statsInlineThrowSummaryMeta">
                  <strong>${throwCount}</strong>
                  <span class="statsInlineThrowChevron" aria-hidden="true"></span>
                </span>
              </summary>
              <div class="statsInlineThrowBody">
                ${liveBlock}
                <div class="list statsNerdList statsInlineThrowSublist">
                  ${throwBreakdownRows(throwAgg, api)}
                </div>
              </div>
            </details>
          </div>
        </div>
      </div>`;
  }

  function foldAdWebLabel(s) {
    return String(s || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  /**
   * Maps Autodarts /statistics KPI row labels (DE/EN variants) to canonical slots.
   * `take` order: specific combinations first so labels are not stolen by the wrong slot.
   */
  function resolveAdWebSlots(rawMetrics) {
    const raw = rawMetrics && typeof rawMetrics === "object" ? { ...rawMetrics } : {};
    const entries = Object.entries(raw);
    const used = new Set();

    function take(testFn) {
      for (const [label, val] of entries) {
        if (used.has(label)) continue;
        const L = foldAdWebLabel(label);
        if (testFn(label, L)) {
          used.add(label);
          return String(val);
        }
      }
      return "";
    }

    const s = {};

    s.avg_checkout = take((label, L) => {
      if (!/checkout/.test(L)) return false;
      if (/bester\s+checkout|\bbest\s+checkout\b/i.test(L) && !/(durchschnitt|average|mean|mittel)/i.test(L)) return false;
      return (
        /(durchschnitt|average|mean|mittel)/i.test(L) ||
        /checkout\s*%/i.test(L) ||
        /checkout-%/i.test(L) ||
        (/%/.test(String(raw[label] || "")) && /checkout/i.test(L))
      );
    });

    s.best_checkout = take((label, L) =>
      (/bester\s+checkout/.test(L) || /\bbest\s+checkout\b/i.test(L)) && !/(durchschnitt|average|mean|mittel)/i.test(L)
    );

    s.best_avg = take(
      (label, L) =>
        (/bester\s+durchschnitt/.test(L) || /\bbest\s+average\b/i.test(L)) && !/checkout/i.test(L)
    );

    s.act_darts = take(
      (label, L) =>
        /gesamtanzahl\s+darts/.test(L) ||
        /geworfen\w*\s+darts/.test(L) ||
        /total\s+darts/.test(L) ||
        /\bdarts\s+thrown\b/i.test(L)
    );

    s.act_legs = take(
      (label, L) =>
        /gespielt\w*\s+legs/.test(L) ||
        /gesamtanzahl\s+legs/.test(L) ||
        /total\s+legs/.test(L) ||
        /\blegs\s+played\b/i.test(L)
    );

    s.act_games = take(
      (label, L) =>
        /gespielt\w*\s+spiele/.test(L) ||
        /gesamtanzahl\s+spiele/.test(L) ||
        /total\s+games/.test(L) ||
        /\bgames\s+played\b/i.test(L)
    );

    s.act_time = take(
      (label, L) =>
        /gesamtspielzeit/.test(L) || /total\s+play(ing)?\s*time/i.test(L) || /\bplay\s*time\b/i.test(L)
    );

    s.act_dist = take(
      (label, L) =>
        /gesamte\s+strecke/.test(L) ||
        /zuruckgelegte\s+strecke/.test(L) ||
        /total\s+distance/i.test(L) ||
        /\bdistance\s+thrown\b/i.test(L)
    );

    s.best_leg = take((label, L) => /bestes\s+leg/.test(L) || /\bbest\s+leg\b/i.test(L));

    s.n180 = take(
      (label, L) =>
        /alle\s*180/.test(L) ||
        /\ball\s*180\b/i.test(L) ||
        /^180er$/.test(L) ||
        /^180s$/i.test(L)
    );

    s.n140 = take((label, L) => {
      if (/checkout/.test(L)) return false;
      return (
        /140\s*\+/.test(L) ||
        />\s*140\b/.test(L) ||
        /uber\s*140/.test(L) ||
        /over\s*140/.test(L) ||
        /visits?\s+.*140/i.test(L)
      );
    });

    s.n100 = take((label, L) => {
      if (/checkout/.test(L) || /140|180/.test(L)) return false;
      return (
        /100\s*\+/.test(L) ||
        />\s*100\b/.test(L) ||
        /uber\s*100/.test(L) ||
        /over\s*100/.test(L) ||
        /visits?\s+.*100/i.test(L)
      );
    });

    return { slots: s, used };
  }

  function adWebVal(v) {
    const t = v != null ? String(v).trim() : "";
    return t ? esc(t) : "—";
  }

  function renderAdWebStatsBlock(adWeb, adWebError, api) {
    const metrics = adWeb?.metrics && typeof adWeb.metrics === "object" ? adWeb.metrics : {};
    const { slots } = resolveAdWebSlots(metrics);

    function row(i18nKey, val) {
      return `<div class="listItem"><span>${statsT(api, i18nKey)}</span><strong>${adWebVal(val)}</strong></div>`;
    }

    const actRows = [
      row("stats_ad_web_lbl_darts_thrown", slots.act_darts),
      row("stats_ad_web_lbl_legs_played", slots.act_legs),
      row("stats_ad_web_lbl_games_played", slots.act_games),
      row("stats_ad_web_lbl_playtime", slots.act_time),
      row("stats_ad_web_lbl_distance", slots.act_dist)
    ].join("");

    const perfRows = [
      row("stats_ad_web_lbl_best_avg", slots.best_avg),
      row("stats_ad_web_lbl_best_leg_darts", slots.best_leg),
      row("stats_ad_web_lbl_best_checkout", slots.best_checkout),
      row("stats_ad_web_lbl_avg_checkout", slots.avg_checkout),
      row("stats_ad_web_lbl_ge_100", slots.n100),
      row("stats_ad_web_lbl_ge_140", slots.n140),
      row("stats_ad_web_lbl_180", slots.n180)
    ].join("");

    const errShort =
      adWeb == null
        ? `<p class="hint statsAdWebErr">${esc(
            statsT(
              api,
              String(adWebError || "") === "no_statistics_tab"
                ? "stats_ad_web_no_tab_short"
                : "stats_ad_web_unavailable_short"
            )
          )}</p>`
        : Object.keys(metrics).length === 0
          ? `<p class="hint statsAdWebErr">${esc(statsT(api, "stats_ad_web_empty_short"))}</p>`
          : "";

    return `
      <div class="formRow statsAdWebRow">
        <div class="sectionTitle" style="margin:0;">${statsT(api, "stats_ad_web_title")}</div>
        ${errShort}
        <div class="statsAdWebSec">
          <div class="statsAdWebSecTitle">${statsT(api, "stats_ad_web_sec_activity")}</div>
          <div class="list statsNerdList statsAdWebKpiList">${actRows}</div>
        </div>
        <div class="statsAdWebSec" style="margin-top:10px;">
          <div class="statsAdWebSecTitle">${statsT(api, "stats_ad_web_sec_performance")}</div>
          <div class="list statsNerdList statsAdWebKpiList">${perfRows}</div>
        </div>
      </div>`;
  }

  function renderAutodartsPlusBlock(domPlay, domPlayError, api) {
    const snap = domPlay?.snap;
    if (domPlay == null) {
      const isNoTab = String(domPlayError || "") === "no_match_tab";
      const hintKey = isNoTab ? "stats_plus_no_tab" : "stats_plus_unavailable";
      const extra =
        !isNoTab && domPlayError ? ` (${esc(String(domPlayError))})` : "";
      return `
        <div class="formRow statsPlusRow">
          <div class="sectionTitle" style="margin:0;">${statsT(api, "stats_plus_live_title")}</div>
          <p class="hint">${esc(statsT(api, hintKey))}${extra}</p>
        </div>`;
    }
    if (!snap || typeof snap !== "object") {
      return `
        <div class="formRow statsPlusRow">
          <div class="sectionTitle" style="margin:0;">${statsT(api, "stats_plus_live_title")}</div>
          <p class="hint">${statsT(api, "stats_plus_snapshot_empty")}</p>
        </div>`;
    }
    const players = Array.isArray(snap.players) ? snap.players : [];
    if (!players.length) {
      return `
        <div class="formRow statsPlusRow">
          <div class="sectionTitle" style="margin:0;">${statsT(api, "stats_plus_live_title")}</div>
          <p class="hint">${statsT(api, "stats_plus_no_columns")}</p>
        </div>`;
    }
    const header = snap.header;
    const fmt =
      header?.formatParts?.length ? esc(header.formatParts.join(" · ")) : esc(header?.gameVariant || "—");
    const age =
      typeof domPlay?.at === "number" && Number.isFinite(domPlay.at) ? fmtTs(domPlay.at) : "—";
    const rows = players
      .map((p) => {
        const name = esc(p.displayName || `P${(p.index ?? 0) + 1}`);
        const rem = p.scoreRemaining != null ? esc(String(p.scoreRemaining)) : "—";
        const legs = p.legsWon != null ? esc(String(p.legsWon)) : "—";
        const avL = p.averageLeg != null ? esc(String(p.averageLeg)) : "—";
        const avM = p.averageMatch != null ? esc(String(p.averageMatch)) : "—";
        const dTurn = p.dartsThrownThisTurn != null ? esc(String(p.dartsThrownThisTurn)) : "—";
        const act = p.isActive ? ` <span class="statsPlusActive" title="${esc(statsT(api, "stats_plus_active"))}">●</span>` : "";
        return `<tr><td>${name}${act}</td><td>${rem}</td><td>${legs}</td><td>${avL}</td><td>${avM}</td><td>${dTurn}</td></tr>`;
      })
      .join("");
    return `
      <div class="formRow statsPlusRow">
        <div class="sectionTitle" style="margin:0;">${statsT(api, "stats_plus_live_title")}</div>
        <p class="hint statsPlusFmt">${fmt}</p>
        <p class="hint statsPlusDomAge">${statsT(api, "stats_plus_dom_age")}: ${esc(age)}</p>
        <div class="statsPlusTableWrap">
          <table class="statsPlusTable">
            <thead><tr>
              <th>${statsT(api, "stats_plus_col_player")}</th>
              <th>${statsT(api, "stats_plus_col_remain")}</th>
              <th>${statsT(api, "stats_plus_col_legs")}</th>
              <th>${statsT(api, "stats_plus_col_avg_leg")}</th>
              <th>${statsT(api, "stats_plus_col_avg_match")}</th>
              <th>${statsT(api, "stats_plus_col_darts_turn")}</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>`;
  }

  function renderSnapshot(root, payload, api) {
    const sessionCtr = payload?.countersSession || payload?.counters || {};
    const lifetimeCtr = payload?.countersLifetime || {};
    const sessionThrowAgg = payload?.throwAggSession || {};
    const lifetimeThrowAgg = payload?.throwAggLifetime || {};
    const domPlay = payload?.domPlay;
    const domPlayError = payload?.domPlayError;
    const adWebStats = payload?.adWebStats;
    const adWebStatsError = payload?.adWebStatsError;

    const latestThrow = readLatestSample(payload, "throw");
    const latestState = readLatestSample(payload, "state");
    const latestEvent = readLatestSample(payload, "event");

    const throwData = latestThrow?.data || {};
    const stateData = latestState?.data || {};
    const eventData = latestEvent?.data || {};

    const throwText = latestThrow
      ? `${String(throwData.playerName || `P${Number(throwData.player || 0) + 1}`)} · ${String(throwData.segment || "?")} · ${String(throwData.score ?? "-")}`
      : "-";
    const stateText = latestState
      ? `Set ${String(stateData.set ?? "-")} · Leg ${String(stateData.leg ?? "-")} · Round ${String(stateData.round ?? "-")}`
      : "-";
    const eventText = latestEvent
      ? `${String(eventData.event || "event")} · P${Number(eventData.player ?? -1) + 1}`
      : "-";

    const mount = root.querySelector("#statsLiveMount");
    if (!mount) return;
    const nerdWasOpen = !!mount.querySelector("#statsNerdDetails")?.open;
    const throwSessionOpen = !!mount.querySelector("#statsThrowInlineSession")?.open;
    const throwLifetimeOpen = !!mount.querySelector("#statsThrowInlineLifetime")?.open;
    const domSnap = domPlay?.snap && typeof domPlay.snap === "object" ? domPlay.snap : null;

    mount.innerHTML = `
      ${renderAdWebStatsBlock(adWebStats, adWebStatsError, api)}
      ${renderAutodartsPlusBlock(domPlay, domPlayError, api)}
      ${compactSessionBlock("stats_section_session", sessionCtr, sessionThrowAgg, api, {
        detailsId: "statsThrowInlineSession",
        includeLiveVisit: true,
        domSnap
      })}
      <div class="formRow" style="margin-top:14px;">
        ${compactSessionBlock("stats_section_lifetime", lifetimeCtr, lifetimeThrowAgg, api, {
          detailsId: "statsThrowInlineLifetime",
          includeLiveVisit: false,
          domSnap: null
        })}
      </div>
      <div class="formRow" style="margin-top:12px;">
        <div class="sectionTitle" style="margin:0;">${statsT(api, "stats_latest_section")}</div>
        <div class="hint" style="margin-top:6px;"><b>${statsT(api, "stats_latest_throw")}:</b> ${esc(throwText)}</div>
        <div class="hint"><b>${statsT(api, "stats_latest_state")}:</b> ${esc(stateText)}</div>
        <div class="hint"><b>${statsT(api, "stats_latest_event")}:</b> ${esc(eventText)}</div>
      </div>
      ${nerdDetailsSectionCombined(sessionCtr, lifetimeCtr, api)}
      <div class="hint" style="margin-top:10px;">
        ${statsT(api, "stats_updated_at")}: ${fmtTs(payload?.updatedAt ? Date.parse(payload.updatedAt) : 0)}
      </div>
    `;
    const nerdEl = mount.querySelector("#statsNerdDetails");
    if (nerdEl) nerdEl.open = nerdWasOpen;
    const throwSessEl = mount.querySelector("#statsThrowInlineSession");
    if (throwSessEl) throwSessEl.open = throwSessionOpen;
    const throwLifeEl = mount.querySelector("#statsThrowInlineLifetime");
    if (throwLifeEl) throwLifeEl.open = throwLifetimeOpen;
  }

  async function refreshStats(api, root) {
    const statusEl = root.querySelector("#statsStatus");
    try {
      const [res, domRes, adWebRes] = await Promise.all([
        api.send({ type: "GET_CAPTURED_DATA" }),
        api.send({ type: "GET_ADM_DOM_PLAY_STATS" }),
        api.send({ type: "GET_ADM_STATISTICS_PAGE_SNAPSHOT" })
      ]);
      if (!res?.ok) throw new Error(res?.error || "capture_unavailable");
      const payload = { ...(res.payload || {}) };
      if (domRes?.ok) {
        payload.domPlay = domRes.payload;
        payload.domPlayError = null;
      } else {
        payload.domPlay = null;
        payload.domPlayError = String(domRes?.error || "dom_stats_failed");
      }
      if (adWebRes?.ok) {
        payload.adWebStats = adWebRes.payload;
        payload.adWebStatsError = null;
      } else {
        payload.adWebStats = null;
        payload.adWebStatsError = String(adWebRes?.error || "ad_web_stats_failed");
      }
      renderSnapshot(root, payload, api);
      if (statusEl) statusEl.textContent = "";
    } catch (e) {
      if (statusEl) statusEl.textContent = `Fehler beim Laden: ${String(e?.message || e)}`;
    }
  }

  scope.ADM_MODULES.stats = {
    id: "stats",
    icon: "S",
    navLabelKey: "nav_stats",
    needs: { streamerbot: false, obs: false },
    render() {
      return `
        <h2 class="title"><span data-i18n="title_stats">Statistik</span><span class="titleMeta">v2</span></h2>
        <div class="card">
          <div id="statsLiveMount" style="margin-top:4px;"></div>
          <div class="rowSplit" style="margin-top:12px;">
            <button id="statsRefreshBtn" class="btnPrimary" type="button" data-i18n="stats_refresh_btn">Aktualisieren</button>
            <button id="statsClearBtn" class="btn" type="button" data-i18n="stats_clear_btn">Daten leeren</button>
          </div>
          <div id="statsStatus" class="hint" style="margin-top:8px;"></div>
        </div>
        <div class="spacer"></div>
      `;
    },
    bind(api) {
      const root = api.root;
      if (root.__statsTimer) {
        try { clearInterval(root.__statsTimer); } catch {}
        root.__statsTimer = null;
      }

      root.querySelector("#statsRefreshBtn")?.addEventListener("click", () => {
        void refreshStats(api, root);
      });
      root.querySelector("#statsClearBtn")?.addEventListener("click", async () => {
        const statusEl = root.querySelector("#statsStatus");
        try {
          const res = await api.send({ type: "CLEAR_CAPTURED_DATA" });
          if (!res?.ok) throw new Error(res?.error || "clear_failed");
          await refreshStats(api, root);
          if (statusEl) statusEl.textContent = "Statistikdaten gelöscht.";
        } catch (e) {
          if (statusEl) statusEl.textContent = `Fehler beim Löschen: ${String(e?.message || e)}`;
        }
      });

      root.__statsTimer = setInterval(() => {
        const page = root.closest(".page");
        if (!page || !page.classList.contains("active")) return;
        void refreshStats(api, root);
      }, 2000);
    },
    sync(api) {
      void refreshStats(api, api.root);
    }
  };
})(window);
