(function initObsZoomModule(scope) {
  scope.ADM_MODULES = scope.ADM_MODULES || {};
  let OBS_SCENES = [];
  let SOURCE_PICKER_OPEN = false;
  let OBS_SCENE_SOURCES = [];
  let OBS_SELECTED_SOURCE = "";
  let WARNING_MODAL_OPEN = false;
  let WARNING_MODAL_TITLE = "";
  let WARNING_MODAL_MESSAGE = "";
  let WARNING_MODAL_CONFIRM_LABEL = "Fortfahren";
  let WARNING_MODAL_ACTION = null;
  let PLAYER_NAME_MODAL_OPEN = false;
  let OBS_MOVE_DURATION = 300;
  let OBS_EASING_TYPE = 3;
  let OBS_EASING_FUNCTION = 2;
  let OBS_INCLUDE_SINGLES = true;
  let OBS_INCLUDE_DOUBLES = true;
  let OBS_INCLUDE_TRIPLES = true;
  let OBS_TEST_TRIGGER = "T20";
  /** OBS-Szenen-Karte im Popup: eingeklappt = Inhalt verborgen. */
  let OBS_SCENES_UI_COLLAPSED = false;
  const OBS_MOVE_PLUGIN_DOWNLOAD_URL = "https://obsproject.com/forum/resources/move.913/";
  const DEFAULT_WEBSITE_BASE = "https://autodarts-modules-production.up.railway.app";

  function normalizeText(value) {
    return String(value || "").trim();
  }

  function getObsZoomGuidePageUrl(api) {
    try {
      const base = api.normalizeWebsiteApiUrl?.(api.getSettings?.()?.websiteApiUrl) || DEFAULT_WEBSITE_BASE;
      return `${String(base).replace(/\/+$/, "")}/modules/obszoom.html#anleitung`;
    } catch {
      return `${DEFAULT_WEBSITE_BASE}/modules/obszoom.html#anleitung`;
    }
  }

  function parseObsZoomDisplayNames(raw) {
    return String(raw || "")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .split(/[\n,;]+/)
      .map((s) => normalizeText(s))
      .filter(Boolean);
  }

  function mergeObsZoomDisplayNameLists(a, b) {
    const seen = new Set();
    const out = [];
    for (const list of [a, b]) {
      for (const raw of list) {
        const n = normalizeText(raw);
        if (!n) continue;
        const key = n.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(n);
      }
    }
    return out;
  }

  /**
   * Aktuelle Namensliste: UI-Textarea und getSettings() koennen nach savePartial kurz auseinanderlaufen —
   * Merge ohne Duplikate, damit weder neue Chips noch gespeicherte Eintraege verloren gehen.
   */
  function readObsZoomPlayerNamesArray(api, root) {
    const fromTa = parseObsZoomDisplayNames(root.querySelector("#obsZoomPlayerNamesList")?.value || "");
    const fromSt = parseObsZoomDisplayNames(api.getSettings?.()?.obsZoomPlayerNamesList || "");
    return mergeObsZoomDisplayNameLists(fromTa, fromSt);
  }

  function serializeObsZoomDisplayNames(arr) {
    return arr.map((s) => normalizeText(s)).filter(Boolean).join("\n");
  }

  function escapeObsChipHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function obsZoomT(api, key) {
    const lang = String(api?.getSettings?.()?.uiLanguage || "de").toLowerCase().startsWith("de") ? "de" : "en";
    const pack = scope.ADM_I18N?.[lang]?.[key];
    return String(pack || "");
  }

  function refreshObsZoomPlayerFilterUi(api, root, rawList) {
    const names = parseObsZoomDisplayNames(rawList);
    const statusEl = root.querySelector("#obsZoomPlayerFilterStatus");
    const namedBlock = root.querySelector("#obsZoomPlayerFilterNamedBlock");
    const chipsEl = root.querySelector("#obsZoomPlayerChips");
    const hidden = root.querySelector("#obsZoomPlayerNamesList");
    const serialized = serializeObsZoomDisplayNames(names);
    if (hidden) hidden.value = serialized;
    if (statusEl) statusEl.style.display = names.length ? "none" : "";
    if (namedBlock) namedBlock.style.display = names.length ? "" : "none";
    if (chipsEl) {
      const removeAria = obsZoomT(api, "obszoom_player_chip_remove") || "Remove";
      chipsEl.innerHTML = names
        .map(
          (n, idx) => `
        <span class="obsZoomPlayerChip">
          <span class="obsZoomPlayerChipLabel">${escapeObsChipHtml(n)}</span>
          <button type="button" class="obsZoomPlayerChipRemove" data-obs-zoom-remove-player="${idx}" aria-label="${escapeObsChipHtml(removeAria)}">×</button>
        </span>`
        )
        .join("");
    }
  }

  async function persistObsZoomPlayerNames(api, root, namesArr) {
    const str = serializeObsZoomDisplayNames(namesArr);
    const mode = namesArr.length ? "names" : "all";
    refreshObsZoomPlayerFilterUi(api, root, str);
    await api.savePartial?.({ obsZoomPlayerNamesList: str, obsZoomPlayerFilterMode: mode });
  }

  function renderTestButtons() {
    const presets = [
      { value: "T20", label: "T20" },
      { value: "BULL", label: "BULL" },
      { value: "D10", label: "D10" },
      { value: "T19", label: "T19" },
      { value: "MAIN", label: "Main" }
    ];
    return presets.map((p) => `
      <button class="btnMini" type="button" data-obs-zoom-test-preset="${p.value}">${p.label}</button>
    `).join("");
  }

  async function flushObsZoomToStorage(api, root) {
    const sceneName = normalizeText(root.querySelector("#obsZoomSceneSelect")?.value);
    const durationEl = root.querySelector("#obsZoomMoveDuration");
    const duration = Math.max(0, Number(durationEl?.value));
    const partial = {
      obsZoomSceneName: sceneName,
      obsZoomDurationMs: Number.isFinite(duration) ? duration : OBS_MOVE_DURATION,
      obsZoomMoveEasingType: Number(root.querySelector("#obsZoomEasingType")?.value ?? OBS_EASING_TYPE) || 3,
      obsZoomMoveEasingFunction: Number(root.querySelector("#obsZoomEasingFunction")?.value ?? OBS_EASING_FUNCTION) || 2,
      obsZoomIncludeSingles: !!root.querySelector("#obsZoomIncludeSingles")?.checked,
      obsZoomIncludeDoubles: !!root.querySelector("#obsZoomIncludeDoubles")?.checked,
      obsZoomIncludeTriples: !!root.querySelector("#obsZoomIncludeTriples")?.checked,
      obsZoomLastTestTrigger: normalizeText(root.querySelector("#obsZoomTestTrigger")?.value || OBS_TEST_TRIGGER).toUpperCase() || "T20"
    };
    const stored = api.getSettings?.() || {};
    const targetFromUi = normalizeText(OBS_SELECTED_SOURCE);
    const targetStored = normalizeText(stored.obsZoomTargetSource);
    if (targetFromUi && (!OBS_SCENE_SOURCES.length || OBS_SCENE_SOURCES.includes(targetFromUi))) {
      partial.obsZoomTargetSource = targetFromUi;
    } else if (targetStored) {
      partial.obsZoomTargetSource = targetStored;
    }
    await api.savePartial?.(partial);
  }

  function updateObsZoomScenesCollapseUi(root) {
    const det = root.querySelector("#obsZoomScenesDetails");
    if (!det) return;
    det.open = !OBS_SCENES_UI_COLLAPSED;
  }

  function renderConnectionButton(kind, label, opts = {}) {
    const withRetry = !!opts.withRetry;
    return `
      <button
        type="button"
        class="connectionStatusBtn"
        data-connection-kind="${kind}"
        ${kind === "obs" ? "data-obs-status" : "data-sb-status"}
        ${withRetry ? `data-connection-retry="${kind}"` : ""}
      >
        <div class="connectionStatusLabel">
          <span>${label}</span>
          <span class="connectionStatusText" data-connection-status-text></span>
          <span class="connectionStatusAttempts" data-connection-attempts></span>
        </div>
      </button>
    `;
  }

  async function runObsZoomTriggerTest(api, root, rawTrigger, touchInput = true) {
    await flushObsZoomToStorage(api, root);
    const trigger = normalizeText(rawTrigger).toUpperCase();
    if (!trigger) {
      api.setStatus?.("Bitte einen Zoom-Trigger eingeben.");
      return;
    }
    const input = root.querySelector("#obsZoomTestTrigger");
    if (touchInput) {
      if (input) input.value = trigger;
      OBS_TEST_TRIGGER = trigger;
    }
    try {
      const res = await api.send({
        type: "OBS_ZOOM_TRIGGER_TEST",
        trigger,
        payload: {
          source: "obszoom_module_test"
        }
      });
      if (!res?.ok) throw new Error(String(res?.error || res?.reason || "obs_zoom_trigger_test_failed"));
      const modeLabel = res?.mode === "managed_filter" ? "Filter" : "Trigger";
      const targetLabel = String(res?.managedKey || res?.trigger || trigger);
      api.setStatus?.(`Zoom-Test gesendet: ${modeLabel} ${targetLabel}`);
    } catch (error) {
      api.setStatus?.(`Zoom-Test fehlgeschlagen: ${String(error?.message || error || "unknown_error")}`);
    }
  }

  function renderSceneOptions() {
    if (!OBS_SCENES.length) {
      return `<option value="">Keine Szenen geladen</option>`;
    }
    return OBS_SCENES.map((sceneName) => `<option value="${sceneName}">${sceneName}</option>`).join("");
  }

  function renderSourceOptions(api) {
    const lang = String(api?.getSettings?.()?.uiLanguage || "de").toLowerCase();
    const emptyLabel = lang === "en" ? "No sources" : "Keine Quellen";
    if (!OBS_SCENE_SOURCES.length) {
      return `<option value="">${emptyLabel}</option>`;
    }
    return OBS_SCENE_SOURCES.map((sourceName) => `<option value="${sourceName}">${sourceName}</option>`).join("");
  }

  function renderSourcePicker() {
    if (!SOURCE_PICKER_OPEN) return "";
    return `
      <div class="hueModalBackdrop">
        <div class="hueModalDialog">
          <div class="communityModalHeader">
            <div>
              <div class="communityModalTitle">Quelle waehlen</div>
              <div class="communityModalSub">Waehle die OBS Quelle, fuer die die Move Filter erstellt werden sollen.</div>
            </div>
            <div class="communityModalHeaderActions">
              <button type="button" class="btnMini" data-obs-source-picker-close>Schliessen</button>
            </div>
          </div>
          <div class="hueModalBody">
            <div class="list">
              ${OBS_SCENE_SOURCES.map((sourceName) => `
                <button type="button" class="listItem" data-obs-scene-source-pick="${sourceName}">
                  <span>${sourceName}</span>
                </button>
              `).join("")}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function closePlayerNameModal(api) {
    PLAYER_NAME_MODAL_OPEN = false;
    scope.ADM_MODULES.obszoom.sync(api, api.getSettings?.() || {});
  }

  function openPlayerNameModal(api) {
    PLAYER_NAME_MODAL_OPEN = true;
    scope.ADM_MODULES.obszoom.sync(api, api.getSettings?.() || {});
    requestAnimationFrame(() => {
      try {
        api.root?.querySelector?.("#obsZoomPlayerNameInput")?.focus?.();
      } catch {}
    });
  }

  function renderPlayerNameModal(api) {
    if (!PLAYER_NAME_MODAL_OPEN) return "";
    const title = obsZoomT(api, "obszoom_player_name_modal_title") || "Spielername";
    const hint = obsZoomT(api, "obszoom_player_name_modal_hint") || "";
    const add = obsZoomT(api, "obszoom_player_name_modal_add") || "Hinzufügen";
    const cancel = obsZoomT(api, "obszoom_player_name_modal_cancel") || "Abbrechen";
    const ph = obsZoomT(api, "obszoom_player_name_modal_placeholder") || "";
    return `
      <div class="hueModalBackdrop" data-obs-player-name-backdrop tabindex="-1">
        <div class="hueModalDialog obsZoomPlayerNameDialog" role="dialog" aria-modal="true" aria-labelledby="obsZoomPlayerNameModalTitle">
          <div class="communityModalHeader">
            <div class="communityModalTitle" id="obsZoomPlayerNameModalTitle">${escapeObsChipHtml(title)}</div>
            ${hint ? `<div class="communityModalSub">${escapeObsChipHtml(hint)}</div>` : ""}
          </div>
          <div class="hueModalBody">
            <div class="formRow" style="margin-top:0;">
              <label class="label" for="obsZoomPlayerNameInput">${escapeObsChipHtml(title)}</label>
              <input class="input" id="obsZoomPlayerNameInput" type="text" autocomplete="off" placeholder="${escapeObsChipHtml(ph)}" />
            </div>
            <div id="obsZoomPlayerNameModalErr" class="hint obsZoomPlayerNameModalErr" style="display:none;margin-top:8px;"></div>
            <div class="inlineActionsRow obsZoomPlayerNameModalActions" style="margin-top:14px;">
              <button type="button" class="btn secondary" data-obs-player-name-cancel>${escapeObsChipHtml(cancel)}</button>
              <button type="button" class="btn primary" data-obs-player-name-add>${escapeObsChipHtml(add)}</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  async function submitPlayerNameFromModal(api, root) {
    const errEl = root.querySelector("#obsZoomPlayerNameModalErr");
    if (errEl) {
      errEl.style.display = "none";
      errEl.textContent = "";
    }
    const entered = normalizeText(root.querySelector("#obsZoomPlayerNameInput")?.value);
    if (!entered) {
      if (errEl) {
        errEl.textContent = obsZoomT(api, "obszoom_player_name_modal_empty") || "";
        errEl.style.display = errEl.textContent ? "" : "none";
      }
      return;
    }
    const cur = readObsZoomPlayerNamesArray(api, root);
    if (cur.some((n) => n.toLowerCase() === entered.toLowerCase())) {
      if (errEl) {
        errEl.textContent =
          obsZoomT(api, "obszoom_player_name_duplicate") ||
          (String(api.getSettings?.()?.uiLanguage || "de").toLowerCase().startsWith("de")
            ? "Name schon auf der Liste."
            : "Already on the list.");
        errEl.style.display = "";
      }
      return;
    }
    cur.push(entered);
    closePlayerNameModal(api);
    await persistObsZoomPlayerNames(api, root, cur);
  }

  function renderWarningModal() {
    if (!WARNING_MODAL_OPEN) return "";
    return `
      <div class="hueModalBackdrop">
        <div class="hueModalDialog warningModalDialog">
          <div class="communityModalHeader warningModalHeader">
            <div class="warningModalTitleWrap">
              <div class="warningModalIcon">!</div>
              <div>
                <div class="communityModalTitle">${WARNING_MODAL_TITLE || "Warnung"}</div>
                <div class="communityModalSub">${WARNING_MODAL_MESSAGE || ""}</div>
              </div>
            </div>
          </div>
          <div class="hueModalBody warningModalBody">
            <div class="obsZoomBackupActions">
              <button type="button" class="btnMini" data-obs-warning-cancel>Abbrechen</button>
              <button type="button" class="btnMini warningConfirmBtn" data-obs-warning-confirm>${WARNING_MODAL_CONFIRM_LABEL || "Fortfahren"}</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function closeWarningModal(api) {
    WARNING_MODAL_OPEN = false;
    WARNING_MODAL_TITLE = "";
    WARNING_MODAL_MESSAGE = "";
    WARNING_MODAL_CONFIRM_LABEL = "Fortfahren";
    WARNING_MODAL_ACTION = null;
    scope.ADM_MODULES.obszoom.sync(api, api.getSettings?.() || {});
  }

  function openWarningModal(api, title, message, onConfirm, confirmLabel = "Fortfahren") {
    WARNING_MODAL_TITLE = String(title || "Warnung");
    WARNING_MODAL_MESSAGE = String(message || "");
    WARNING_MODAL_CONFIRM_LABEL = String(confirmLabel || "Fortfahren");
    WARNING_MODAL_ACTION = typeof onConfirm === "function" ? onConfirm : null;
    WARNING_MODAL_OPEN = true;
    scope.ADM_MODULES.obszoom.sync(api, api.getSettings?.() || {});
  }

  async function reloadObsScenes(api, root, silent = false) {
    try {
      const res = await api.send({ type: "OBS_GET_SCENES" });
      if (!res?.ok) throw new Error(String(res?.error || "obs_get_scenes_failed"));
      OBS_SCENES = Array.isArray(res?.scenes) ? res.scenes : [];
      OBS_SCENE_SOURCES = [];
      OBS_SELECTED_SOURCE = "";
      scope.ADM_MODULES.obszoom.sync(api, api.getSettings?.() || {});
      if (!silent) {
        api.setStatus?.(OBS_SCENES.length ? `OBS Szenen geladen: ${OBS_SCENES.length}` : "Keine OBS Szenen gefunden.");
      }
    } catch (error) {
      if (!silent) {
        api.setStatus?.(`OBS Szenen konnten nicht geladen werden: ${String(error?.message || error || "unknown_error")}`);
      }
      const sceneSelect = root?.querySelector?.("#obsZoomSceneSelect");
      if (sceneSelect && !sceneSelect.value) {
        sceneSelect.innerHTML = renderSceneOptions();
      }
    }
  }

  async function reloadObsSceneSources(api, root, sceneName, silent = false, opts = {}) {
    const persistSelection = opts.persistSelection !== false;
    const targetScene = String(sceneName || "").trim();
    if (!targetScene) {
      OBS_SCENE_SOURCES = [];
      OBS_SELECTED_SOURCE = "";
      SOURCE_PICKER_OPEN = false;
      scope.ADM_MODULES.obszoom.sync(api, api.getSettings?.() || {});
      return;
    }
    try {
      const res = await api.send({ type: "OBS_GET_SCENE_SOURCES", sceneName: targetScene });
      if (!res?.ok) throw new Error(String(res?.error || "obs_get_scene_sources_failed"));
      OBS_SCENE_SOURCES = Array.isArray(res?.sources) ? res.sources : [];
      const storedSource = normalizeText(api.getSettings?.()?.obsZoomTargetSource);
      if (OBS_SCENE_SOURCES.includes(storedSource)) OBS_SELECTED_SOURCE = storedSource;
      if (!OBS_SCENE_SOURCES.includes(OBS_SELECTED_SOURCE)) OBS_SELECTED_SOURCE = OBS_SCENE_SOURCES[0] || "";
      // Quellen-Auswahl-Modal nur nach Create/Update (runCreateMoveFiltersFlow), nie bei passivem Laden
      if (persistSelection) {
        const persist = { obsZoomSceneName: targetScene };
        if (OBS_SELECTED_SOURCE && OBS_SCENE_SOURCES.includes(OBS_SELECTED_SOURCE)) {
          persist.obsZoomTargetSource = OBS_SELECTED_SOURCE;
        }
        await api.savePartial?.(persist);
      }
      scope.ADM_MODULES.obszoom.sync(api, api.getSettings?.() || {});
      if (!silent) {
        api.setStatus?.(OBS_SCENE_SOURCES.length ? `Quellen geladen: ${OBS_SCENE_SOURCES.length}` : "Keine Quellen in der Szene gefunden.");
      }
    } catch (error) {
      OBS_SCENE_SOURCES = [];
      OBS_SELECTED_SOURCE = "";
      SOURCE_PICKER_OPEN = false;
      scope.ADM_MODULES.obszoom.sync(api, api.getSettings?.() || {});
      if (!silent) {
        api.setStatus?.(`Quellen konnten nicht geladen werden: ${String(error?.message || error || "unknown_error")}`);
      }
    }
  }

  async function createMoveFiltersForSelection(api, root, sourceName, mode = "upsert") {
    const sceneName = String(root.querySelector("#obsZoomSceneSelect")?.value || "").trim();
    const duration = Number(root.querySelector("#obsZoomMoveDuration")?.value || OBS_MOVE_DURATION);
    const easing = Number(root.querySelector("#obsZoomEasingType")?.value || OBS_EASING_TYPE);
    const easingFunction = Number(root.querySelector("#obsZoomEasingFunction")?.value || OBS_EASING_FUNCTION);
    const targetSource = String(sourceName || "").trim();
    if (!sceneName) {
      api.setStatus?.("Bitte zuerst eine OBS Szene waehlen.");
      return;
    }
    if (!targetSource) {
      api.setStatus?.("Bitte eine OBS Quelle waehlen.");
      return;
    }
    const res = await api.send({
      type: "OBS_CREATE_MOVE_FILTERS",
      mode,
      sceneName,
      sourceName: targetSource,
      duration,
      easing,
      easingFunction,
      includeSingles: OBS_INCLUDE_SINGLES,
      includeDoubles: OBS_INCLUDE_DOUBLES,
      includeTriples: OBS_INCLUDE_TRIPLES
    });
    if (!res?.ok) throw new Error(String(res?.error || "obs_create_move_filters_failed"));
    await api.savePartial?.({
      obsZoomSceneName: sceneName,
      obsZoomTargetSource: targetSource
    });
    const errorCount = Array.isArray(res?.errors) ? res.errors.length : 0;
    const summary = mode === "create"
      ? `erstellt ${res?.created || 0}`
      : `aktualisiert ${res?.updated || 0}`;
    api.setStatus?.(`Move Filter fuer ${sceneName} / ${targetSource}: ${summary}${errorCount ? `, Fehler ${errorCount}` : ""}. Checkout nutzt jetzt diese Szene automatisch.`);
  }

  async function runCreateMoveFiltersFlow(api, root, mode = "upsert") {
    const sceneName = String(root.querySelector("#obsZoomSceneSelect")?.value || "").trim();
    if (!sceneName) {
      api.setStatus?.("Bitte zuerst eine OBS Szene waehlen.");
      return;
    }
    await reloadObsSceneSources(api, root, sceneName, true);
    if (!OBS_SCENE_SOURCES.length) {
      api.setStatus?.("In dieser Szene wurde keine Quelle gefunden.");
      return;
    }
    let picked = normalizeText(root.querySelector("#obsZoomSourceSelect")?.value);
    if (picked && OBS_SCENE_SOURCES.includes(picked)) {
      OBS_SELECTED_SOURCE = picked;
    } else if (OBS_SELECTED_SOURCE && OBS_SCENE_SOURCES.includes(OBS_SELECTED_SOURCE)) {
      picked = OBS_SELECTED_SOURCE;
    } else {
      picked = normalizeText(OBS_SCENE_SOURCES[0] || "");
      OBS_SELECTED_SOURCE = picked;
    }
    if (!picked) {
      api.setStatus?.("Bitte eine Quelle waehlen.");
      return;
    }
    await createMoveFiltersForSelection(api, root, picked, mode);
  }

  async function runDeleteMoveFiltersFlow(api, root) {
    const sceneName = String(root.querySelector("#obsZoomSceneSelect")?.value || "").trim();
    if (!sceneName) {
      api.setStatus?.("Bitte zuerst eine OBS Szene waehlen.");
      return;
    }
    const res = await api.send({
      type: "OBS_DELETE_MOVE_FILTERS",
      sceneName,
      includeSingles: OBS_INCLUDE_SINGLES,
      includeDoubles: OBS_INCLUDE_DOUBLES,
      includeTriples: OBS_INCLUDE_TRIPLES
    });
    if (!res?.ok) throw new Error(String(res?.error || "obs_delete_move_filters_failed"));
    const errorCount = Array.isArray(res?.errors) ? res.errors.length : 0;
    api.setStatus?.(`Move Filter geloescht: ${res?.deleted || 0}${errorCount ? `, Fehler ${errorCount}` : ""}.`);
  }

  function downloadBackupFile(sceneName, payload) {
    const safeSceneName = String(sceneName || "scene")
      .trim()
      .replace(/[<>:"/\\|?*\x00-\x1F]+/g, "-")
      .replace(/\s+/g, "_");
    const fileName = `obs-zoom-backup-${safeSceneName || "scene"}.json`;
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function downloadFilterSettingsJson(sceneName, payload) {
    const safeSceneName = String(sceneName || "scene")
      .trim()
      .replace(/[<>:"/\\|?*\x00-\x1F]+/g, "-")
      .replace(/\s+/g, "_");
    const fileName = `obs-zoom-filter-settings-${safeSceneName || "scene"}.json`;
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function readBackupFile(file) {
    const text = await file.text();
    return JSON.parse(text);
  }

  scope.ADM_MODULES.obszoom = {
    id: "obszoom",
    icon: "Z",
    navLabelKey: "nav_obszoom",
    needs: { streamerbot: false, obs: true },
    render() {
      return `
        <h2 class="title"><span data-i18n="title_obszoom">Zoom</span><span class="titleMeta">OBS</span></h2>
        <div class="card" data-settings-nav-connections style="cursor:pointer;">
          <div class="sectionHead">
            <div class="sectionTitle" style="margin:0;" data-i18n="section_connections">Verbindungen</div>
          </div>
          <div class="connectionStatusGrid" id="obsZoomConnectionStripGrid" data-connections-open="false">
            ${renderConnectionButton("obs", "OBS", { withRetry: false })}
            ${renderConnectionButton("sb", "Streamer.bot", { withRetry: false })}
          </div>
          <div class="hint" style="margin-top:8px;" data-i18n="module_connections_tap_hint">Tippen, um die Verbindungen in den Einstellungen zu oeffnen.</div>
        </div>

        <div class="card obsZoomObsScenesCard">
          <details class="bgUploadDropdown formRow obsZoomScenesDetails" id="obsZoomScenesDetails"${OBS_SCENES_UI_COLLAPSED ? "" : " open"}>
            <summary class="btnPrimary fullWidthBtn bgUploadSummary obsZoomScenesSummary" aria-label="OBS Szenen ein- oder ausklappen" title="Ein-/Ausklappen">
              <span class="obsZoomScenesSummaryInner">
                <span class="obsZoomScenesSummaryTitle" data-i18n="obszoom_scenes_fold_title">OBS Szenen</span>
                <span class="ddArrow obsZoomScenesSummaryArrow" aria-hidden="true"></span>
              </span>
            </summary>
            <div class="bgUploadBody obsZoomScenesBody">
          <div class="formRow obsZoomScenesPickRow">
            <div class="obsZoomSceneSourcePair">
              <div class="obsZoomScenePick">
                <label class="label" for="obsZoomSceneSelect" data-i18n="obszoom_scene_label">Szene</label>
                <div class="obsZoomSelectShell obsZoomSelectShellScene">
                  <select class="input obsZoomSceneSelect" id="obsZoomSceneSelect">
                    ${renderSceneOptions()}
                  </select>
                </div>
              </div>
              <div class="obsZoomSourcePick">
                <label class="label" for="obsZoomSourceSelect" data-i18n="obszoom_source_label">Quelle</label>
                <div class="obsZoomSourceSelectRow">
                  <div class="obsZoomSelectShell obsZoomSelectShellSource">
                  <select class="input obsZoomSourceSelect" id="obsZoomSourceSelect">
                    ${renderSourceOptions(null)}
                  </select>
                  </div>
                  <button class="miniChevronBtn obsZoomRefreshScenesBtn" id="btnRefreshObsScenes" type="button" title="Szenen aktualisieren" aria-label="Szenen aktualisieren">
                    <span class="refreshGlyph"></span>
                  </button>
                </div>
              </div>
            </div>
          </div>
          <div class="formRow">
            <label class="label" for="obsZoomMoveDuration">Duration (ms)</label>
            <input class="input" id="obsZoomMoveDuration" type="number" min="0" step="50" value="300" />
          </div>
          <div class="formRow">
            <label class="label" for="obsZoomEasingType">Easing Type</label>
            <select class="input" id="obsZoomEasingType">
              <option value="0">None</option>
              <option value="1">In</option>
              <option value="2">Out</option>
              <option value="3" selected>In Out</option>
            </select>
          </div>
          <div class="formRow">
            <label class="label" for="obsZoomEasingFunction">Easing Function</label>
            <select class="input" id="obsZoomEasingFunction">
              <option value="1">Quadratic</option>
              <option value="2" selected>Cubic</option>
              <option value="3">Quartic</option>
              <option value="4">Quintic</option>
              <option value="5">Sine</option>
              <option value="6">Circular</option>
              <option value="7">Exponential</option>
              <option value="8">Elastic</option>
              <option value="9">Bounce</option>
              <option value="10">Back</option>
            </select>
          </div>
          <div class="formRow">
            <label class="label">Filtergruppen</label>
            <div class="obsZoomTypeRow">
              <label class="obsZoomTypeToggle">
                <input id="obsZoomIncludeSingles" type="checkbox" checked />
                <span>Single</span>
              </label>
              <label class="obsZoomTypeToggle">
                <input id="obsZoomIncludeDoubles" type="checkbox" checked />
                <span>Double</span>
              </label>
              <label class="obsZoomTypeToggle">
                <input id="obsZoomIncludeTriples" type="checkbox" checked />
                <span>Triple</span>
              </label>
            </div>
            <div class="hint">Main, Bull, DBull und Miss werden immer erstellt.</div>
          </div>
          <div class="inlineActionsRow" style="margin-top:14px;">
            <button class="btn primary" id="btnCreateObsMoveFilters" type="button">Create</button>
            <button class="btn secondary" id="btnUpdateObsMoveFilters" type="button">Update</button>
            <button class="btn secondary" id="btnDeleteObsMoveFilters" type="button">Delete</button>
          </div>
          <div class="formRow obsZoomCalibFullRow">
            <div class="obsZoomConfigToolRow">
              <button type="button" class="btn secondary btnObsZoomCalibWip" id="btnObsZoomOpenCalibWindow" data-i18n="obszoom_btn_configurator">Konfigurator …</button>
              <div class="obsZoomFilterSettingsSplit" data-i18n-aria-label="obszoom_filter_settings_split_aria" role="group">
                <button type="button" class="btn secondary obsZoomSplitBtnLeft" id="btnObsZoomSaveFilterSettings" data-i18n="obszoom_filter_settings_save">Save</button>
                <button type="button" class="btn secondary obsZoomSplitBtnRight" id="btnObsZoomLoadFilterSettings" data-i18n="obszoom_filter_settings_load">Load</button>
              </div>
            </div>
            <input id="obsZoomFilterSettingsImportInput" type="file" accept="application/json,.json" style="display:none;" />
            <div class="hint obsZoomCalibHint" data-i18n="obszoom_calib_hint">Kalibrierung und OBS-Zuordnung im Konfigurator-Fenster.</div>
          </div>
            </div>
          </details>
        </div>

        <div class="card obsZoomPlayerFilterCard">
          <div class="sectionTitle" data-i18n="obszoom_section_player_filter">Trigger</div>
          <div class="formRow">
            <label class="label" for="obsZoomCheckoutTriggerThreshold" data-i18n="checkout_threshold_label">Checkout Schwelle</label>
            <input class="input" id="obsZoomCheckoutTriggerThreshold" type="number" min="2" max="170" step="1" value="170" />
            <div class="hint" data-i18n="checkout_threshold_hint">Ab diesem Restwert und darunter wird der Checkout-Trigger aktiv.</div>
          </div>
          <div class="formRow" style="margin-top:10px;">
            <button type="button" class="btnPrimary obsZoomPlayerNameBtn" id="btnObsZoomAddPlayerName" data-i18n="obszoom_player_name_btn">Player Name</button>
          </div>
          <div id="obsZoomPlayerFilterStatus" class="obsZoomPlayerFilterStatus hint" style="margin-top:8px;" data-i18n="obszoom_player_filter_empty_status">Immer — kein Spielername eingetragen.</div>
          <div id="obsZoomPlayerFilterNamedBlock" class="obsZoomPlayerFilterNamedBlock" style="display:none;margin-top:8px;">
            <div class="obsZoomPlayerWhenLabel" data-i18n="obszoom_player_filter_when_throw">Wenn Spieler wirft:</div>
            <div id="obsZoomPlayerChips" class="obsZoomPlayerChips"></div>
          </div>
          <textarea id="obsZoomPlayerNamesList" style="display:none;" aria-hidden="true" tabindex="-1"></textarea>
        </div>

        <div class="card obsZoomModesCard">
          <div class="sectionTitle" data-i18n="obszoom_section_modes">Modi</div>
          <div class="list obsZoomModesList">
            <div class="listToggle">
              <div class="liText">
                <div class="liTitle" data-i18n="obszoom_switch_bull_off">Bull/off</div>
              </div>
              <label class="switch">
                <input id="obsZoomBullOffZoom" type="checkbox" aria-label="Bull/off" />
                <span class="slider"></span>
              </label>
            </div>
            <div class="listToggle">
              <div class="liText">
                <div class="liTitle" data-i18n="obszoom_switch_only_t20">Only T20</div>
              </div>
              <label class="switch">
                <input id="obsZoomStickyTriple20" type="checkbox" aria-label="Only T20" />
                <span class="slider"></span>
              </label>
            </div>
            <div class="listToggle">
              <div class="liText">
                <div class="liTitle" data-i18n="obszoom_switch_only_t19">Only T19</div>
              </div>
              <label class="switch">
                <input id="obsZoomStickyTriple19" type="checkbox" aria-label="Only T19" />
                <span class="slider"></span>
              </label>
            </div>
          </div>
          <div class="hint obsZoomModesHint" data-i18n="obszoom_modes_hint_short">
            Bull/off: Cork-Zoom, danach ganzes Board. Only T20/T19: vor Checkout Triple-Zoom; ohne beide Main bis zur Schwelle (Trigger-Karte). Nur eines aktiv, sonst zählt T20.
          </div>
        </div>

        <div class="card">
          <div class="sectionTitle" style="margin:0 0 12px 0;">Test Area</div>
          <div class="miniButtonRow" style="margin-bottom:12px;">
            ${renderTestButtons()}
          </div>
          <div class="formRow">
            <label class="label" for="obsZoomTestTrigger">Trigger</label>
            <input class="input" id="obsZoomTestTrigger" type="text" placeholder="z. B. T20 oder checkout_t20" value="${OBS_TEST_TRIGGER}" />
          </div>
          <div class="inlineActionsRow" style="margin-top:14px;">
            <button class="btn primary" id="btnObsZoomTestTrigger" type="button">Testen</button>
          </div>
        </div>

        <div class="card">
          <div class="sectionTitle" style="margin:0 0 12px 0;">Backup</div>
          <div class="hint" style="margin-bottom:12px;">Exportiere oder spiele komplette Szenen-, Quellen- und Filter-Backups wieder ein.</div>
          <div class="obsZoomBackupActions">
            <button class="btnMini" id="btnExportObsMoveFilterBackup" type="button">Exportieren</button>
            <button class="btnMini" id="btnImportObsMoveFilterBackup" type="button">Importieren</button>
          </div>
          <div class="obsZoomBackupFooter">
            <button class="btnMini" id="btnObsZoomOpenGuide" type="button">Anleitung (Web)</button>
            <button class="btnMini" id="btnDownloadObsMovePlugin" type="button">Plugin</button>
          </div>
          <input id="obsZoomBackupImportInput" type="file" accept="application/json,.json" style="display:none;" />
        </div>
        <div id="obsZoomSourcePickerMount">${renderSourcePicker()}</div>
        <div id="obsZoomWarningModalMount">${renderWarningModal()}</div>
        <div id="obsZoomPlayerNameModalMount"></div>
        <div class="spacer"></div>
      `;
    },
    bind(api) {
      const root = api.root;
      api.bindAuto(root, "obsZoomCheckoutTriggerThreshold", "checkoutTriggerThreshold", "number");
      root.querySelector("#btnObsZoomAddPlayerName")?.addEventListener("click", () => {
        openPlayerNameModal(api);
      });
      root.addEventListener("keydown", (ev) => {
        if (!PLAYER_NAME_MODAL_OPEN) return;
        if (ev.key === "Escape") {
          ev.preventDefault();
          closePlayerNameModal(api);
          return;
        }
        if (ev.key === "Enter") {
          const t = ev.target;
          if (t && t.id === "obsZoomPlayerNameInput") {
            ev.preventDefault();
            void submitPlayerNameFromModal(api, root);
          }
        }
      });
      root.querySelector("#obsZoomPlayerChips")?.addEventListener("click", async (ev) => {
        const btn = ev.target.closest("[data-obs-zoom-remove-player]");
        if (!btn) return;
        const idx = Number(btn.getAttribute("data-obs-zoom-remove-player"));
        if (!Number.isFinite(idx) || idx < 0) return;
        const cur = readObsZoomPlayerNamesArray(api, root);
        if (idx >= cur.length) return;
        cur.splice(idx, 1);
        await persistObsZoomPlayerNames(api, root, cur);
      });
      root.querySelector("#obsZoomSceneSelect")?.addEventListener("change", async (ev) => {
        const sceneName = normalizeText(ev.target?.value);
        await api.savePartial?.({ obsZoomSceneName: sceneName });
        await reloadObsSceneSources(api, root, sceneName, true);
      });
      root.querySelector("#obsZoomSourceSelect")?.addEventListener("change", async (ev) => {
        const name = normalizeText(ev.target?.value);
        OBS_SELECTED_SOURCE = name;
        if (name) await api.savePartial?.({ obsZoomTargetSource: name });
      });
      root.querySelector("#obsZoomMoveDuration")?.addEventListener("input", (ev) => {
        OBS_MOVE_DURATION = Math.max(0, Number(ev.target?.value || OBS_MOVE_DURATION) || 0);
      });
      root.querySelector("#obsZoomMoveDuration")?.addEventListener("change", () => {
        const v = Math.max(0, Number(root.querySelector("#obsZoomMoveDuration")?.value) || 0);
        OBS_MOVE_DURATION = v;
        void api.savePartial?.({ obsZoomDurationMs: v });
      });
      root.querySelector("#btnObsZoomOpenCalibWindow")?.addEventListener("click", () => {
        try {
          const url = chrome.runtime.getURL("Modules/obszoom/obszoom-calib.html");
          if (chrome?.windows?.create) {
            chrome.windows.create({ url, type: "popup", width: 1060, height: 840, focused: true });
          } else {
            chrome.tabs.create({ url });
          }
        } catch (error) {
          api.setStatus?.(`Konfigurator: ${String(error?.message || error || "unknown_error")}`);
        }
      });
      root.querySelector("#btnObsZoomSaveFilterSettings")?.addEventListener("click", async () => {
        const sceneName = String(root.querySelector("#obsZoomSceneSelect")?.value || "").trim();
        if (!sceneName) {
          api.setStatus?.(obsZoomT(api, "obszoom_filter_settings_need_scene") || "Bitte zuerst eine OBS Szene waehlen.");
          return;
        }
        try {
          const res = await api.send({ type: "OBS_EXPORT_MOVE_FILTER_SETTINGS", sceneName });
          if (!res?.ok || !res?.payload) throw new Error(String(res?.error || "obs_export_move_filter_settings_failed"));
          downloadFilterSettingsJson(sceneName, res.payload);
          const okMsg = obsZoomT(api, "obszoom_filter_settings_saved_status") || "Filter-Einstellungen exportiert.";
          api.setStatus?.(`${okMsg} (${res.payload.filters?.length || 0} Filter)`);
        } catch (error) {
          api.setStatus?.(
            `${obsZoomT(api, "obszoom_filter_settings_save_failed") || "Export fehlgeschlagen"}: ${String(error?.message || error || "unknown_error")}`
          );
        }
      });
      root.querySelector("#btnObsZoomLoadFilterSettings")?.addEventListener("click", () => {
        const input = root.querySelector("#obsZoomFilterSettingsImportInput");
        if (!input) return;
        input.value = "";
        input.click();
      });
      root.querySelector("#obsZoomFilterSettingsImportInput")?.addEventListener("change", async (ev) => {
        const file = ev.target?.files?.[0];
        if (!file) return;
        const sceneName = String(root.querySelector("#obsZoomSceneSelect")?.value || "").trim();
        if (!sceneName) {
          api.setStatus?.(obsZoomT(api, "obszoom_filter_settings_need_scene") || "Bitte zuerst eine OBS Szene waehlen.");
          return;
        }
        openWarningModal(
          api,
          obsZoomT(api, "obszoom_filter_settings_import_title") || "Filter-Einstellungen laden",
          obsZoomT(api, "obszoom_filter_settings_import_body") ||
            "Die JSON-Datei wird auf die Move-Filter dieser Szene in OBS angewendet (bestehende Filter, gleiche Namen).",
          async () => {
            try {
              const doc = await readBackupFile(file);
              /** Immer die aktuell gewählte OBS-Szene — unabhängig von `sceneName` in der Datei. */
              const toSend = { ...doc, sceneName };
              const res = await api.send({ type: "OBS_IMPORT_MOVE_FILTER_SETTINGS", doc: toSend });
              if (!res?.ok) throw new Error(String(res?.error || "obs_import_move_filter_settings_failed"));
              const errN = Array.isArray(res?.errors) ? res.errors.length : 0;
              const okMsg = obsZoomT(api, "obszoom_filter_settings_loaded_status") || "Filter-Einstellungen angewendet.";
              api.setStatus?.(`${okMsg} ${res.applied || 0}${errN ? `, ${errN} Hinweise` : ""}.`);
            } catch (error) {
              api.setStatus?.(
                `${obsZoomT(api, "obszoom_filter_settings_load_failed") || "Import fehlgeschlagen"}: ${String(error?.message || error || "unknown_error")}`
              );
            }
          },
          obsZoomT(api, "obszoom_filter_settings_import_confirm") || "Anwenden"
        );
      });
      root.querySelector("#obsZoomBullOffZoom")?.addEventListener("change", (ev) => {
        const on = !!ev.target?.checked;
        void api.savePartial?.({ obsZoomBullOffZoom: on });
      });
      root.querySelector("#obsZoomStickyTriple20")?.addEventListener("change", (ev) => {
        const on = !!ev.target?.checked;
        const patch = { obsZoomStickyTriple20: on };
        if (on) patch.obsZoomStickyTriple19 = false;
        void api.savePartial?.(patch);
      });
      root.querySelector("#obsZoomStickyTriple19")?.addEventListener("change", (ev) => {
        const on = !!ev.target?.checked;
        const patch = { obsZoomStickyTriple19: on };
        if (on) patch.obsZoomStickyTriple20 = false;
        void api.savePartial?.(patch);
      });
      root.querySelector("#obsZoomIncludeSingles")?.addEventListener("change", (ev) => {
        OBS_INCLUDE_SINGLES = !!ev.target?.checked;
        void api.savePartial?.({ obsZoomIncludeSingles: OBS_INCLUDE_SINGLES });
      });
      root.querySelector("#obsZoomIncludeDoubles")?.addEventListener("change", (ev) => {
        OBS_INCLUDE_DOUBLES = !!ev.target?.checked;
        void api.savePartial?.({ obsZoomIncludeDoubles: OBS_INCLUDE_DOUBLES });
      });
      root.querySelector("#obsZoomIncludeTriples")?.addEventListener("change", (ev) => {
        OBS_INCLUDE_TRIPLES = !!ev.target?.checked;
        void api.savePartial?.({ obsZoomIncludeTriples: OBS_INCLUDE_TRIPLES });
      });
      root.querySelector("#obsZoomEasingType")?.addEventListener("change", (ev) => {
        OBS_EASING_TYPE = Number(ev.target?.value || OBS_EASING_TYPE) || 3;
        void api.savePartial?.({ obsZoomMoveEasingType: OBS_EASING_TYPE });
      });
      root.querySelector("#obsZoomEasingFunction")?.addEventListener("change", (ev) => {
        OBS_EASING_FUNCTION = Number(ev.target?.value || OBS_EASING_FUNCTION) || 2;
        void api.savePartial?.({ obsZoomMoveEasingFunction: OBS_EASING_FUNCTION });
      });
      root.querySelectorAll("[data-connection-retry]").forEach((button) => {
        button.addEventListener("click", async () => {
          const kind = String(button.dataset.connectionRetry || "");
          if (kind === "sb") await api.send({ type: "SB_RETRY" });
          if (kind === "obs") await api.send({ type: "OBS_RETRY" });
          setTimeout(() => api.refreshConnectionStatuses?.(), 150);
        });
      });
      root.querySelector("#obsZoomScenesDetails")?.addEventListener("toggle", () => {
        const det = root.querySelector("#obsZoomScenesDetails");
        if (!det) return;
        OBS_SCENES_UI_COLLAPSED = !det.open;
      });
      root.querySelector("#btnRefreshObsScenes")?.addEventListener("click", async () => {
        await reloadObsScenes(api, root, false);
      });
      root.querySelector("#btnCreateObsMoveFilters")?.addEventListener("click", async () => {
        try {
          await runCreateMoveFiltersFlow(api, root, "create");
        } catch (error) {
          api.setStatus?.(`Move Filter konnten nicht erstellt werden: ${String(error?.message || error || "unknown_error")}`);
        }
      });
      root.querySelector("#btnUpdateObsMoveFilters")?.addEventListener("click", async () => {
        openWarningModal(
          api,
          obsZoomT(api, "obszoom_update_modal_title") || "Achtung",
          obsZoomT(api, "obszoom_update_modal_body") ||
            "Quelle, Dauer und Easing der Move-Filter werden aktualisiert. Transformation (Position/Zoom) je Filter bleibt erhalten.",
          async () => {
            try {
              await runCreateMoveFiltersFlow(api, root, "update");
            } catch (error) {
              api.setStatus?.(`Move Filter konnten nicht aktualisiert werden: ${String(error?.message || error || "unknown_error")}`);
            }
          },
          obsZoomT(api, "obszoom_update_modal_confirm") || "Ueberschreiben"
        );
      });
      root.querySelector("#btnDeleteObsMoveFilters")?.addEventListener("click", async () => {
        openWarningModal(
          api,
          "Filter loeschen",
          "Diese Aktion loescht die angehakten Single-, Double- und Triple-Filter. Main, Bull, DBull und Miss bleiben erhalten.",
          async () => {
            try {
              await runDeleteMoveFiltersFlow(api, root);
            } catch (error) {
              api.setStatus?.(`Move Filter konnten nicht geloescht werden: ${String(error?.message || error || "unknown_error")}`);
            }
          },
          "Loeschen"
        );
      });

      root.querySelector("#btnExportObsMoveFilterBackup")?.addEventListener("click", async () => {
        const sceneName = String(root.querySelector("#obsZoomSceneSelect")?.value || "").trim();
        if (!sceneName) {
          api.setStatus?.("Bitte zuerst eine OBS Szene waehlen.");
          return;
        }
        try {
          const res = await api.send({ type: "OBS_EXPORT_MOVE_FILTER_BACKUP", sceneName });
          if (!res?.ok) throw new Error(String(res?.error || "obs_export_move_filter_backup_failed"));
          const payload = {
            type: "obszoom-move-filter-backup",
            sceneName: res.sceneName || sceneName,
            exportedAt: res.exportedAt || new Date().toISOString(),
            sources: Array.isArray(res.sources) ? res.sources : [],
            filters: Array.isArray(res.filters) ? res.filters : []
          };
          downloadBackupFile(sceneName, payload);
          api.setStatus?.(`Backup exportiert: ${payload.sources.length} Quellen, ${payload.filters.length} Filter.`);
        } catch (error) {
          api.setStatus?.(`Backup konnte nicht exportiert werden: ${String(error?.message || error || "unknown_error")}`);
        }
      });
      root.querySelector("#btnImportObsMoveFilterBackup")?.addEventListener("click", () => {
        const input = root.querySelector("#obsZoomBackupImportInput");
        if (!input) return;
        input.value = "";
        input.click();
      });
      root.querySelector("#obsZoomBackupImportInput")?.addEventListener("change", async (ev) => {
        const file = ev.target?.files?.[0];
        if (!file) return;
        openWarningModal(
          api,
          "Backup einspielen",
          "Diese Aktion kann Szene, Quellen und Filter aus dem Backup in OBS anlegen oder bestehende Einstellungen vollstaendig ueberschreiben.",
          async () => {
            try {
              const backup = await readBackupFile(file);
              const res = await api.send({ type: "OBS_IMPORT_MOVE_FILTER_BACKUP", backup });
              if (!res?.ok) throw new Error(String(res?.error || "obs_import_move_filter_backup_failed"));
              const errorCount = Array.isArray(res?.errors) ? res.errors.length : 0;
              api.setStatus?.(`Backup eingespielt: Szene ${res?.createdScene || 0}, Quellen erstellt ${res?.createdSources || 0}, Quellen aktualisiert ${res?.updatedSources || 0}, Filter erstellt ${res?.createdFilters || 0}, Filter aktualisiert ${res?.updatedFilters || 0}${errorCount ? `, Fehler ${errorCount}` : ""}.`);
              void reloadObsScenes(api, root, true);
            } catch (error) {
              api.setStatus?.(`Backup konnte nicht eingespielt werden: ${String(error?.message || error || "unknown_error")}`);
            }
          },
          "Einspielen"
        );
      });
      root.querySelector("#btnObsZoomOpenGuide")?.addEventListener("click", () => {
        const url = getObsZoomGuidePageUrl(api);
        try {
          if (chrome?.tabs?.create) {
            chrome.tabs.create({ url });
            return;
          }
          window.open(url, "_blank", "noopener,noreferrer");
        } catch (error) {
          api.setStatus?.(`Anleitung konnte nicht geoeffnet werden: ${String(error?.message || error || "unknown_error")}`);
        }
      });
      root.querySelector("#btnDownloadObsMovePlugin")?.addEventListener("click", () => {
        try {
          window.open(OBS_MOVE_PLUGIN_DOWNLOAD_URL, "_blank", "noopener,noreferrer");
          api.setStatus?.("Move Plugin Download geoeffnet.");
        } catch (error) {
          api.setStatus?.(`Move Plugin Download konnte nicht geoeffnet werden: ${String(error?.message || error || "unknown_error")}`);
        }
      });
      let obsZoomTestTriggerSaveTimer = null;
      root.querySelector("#obsZoomTestTrigger")?.addEventListener("input", (ev) => {
        OBS_TEST_TRIGGER = normalizeText(ev.target?.value).toUpperCase();
        if (obsZoomTestTriggerSaveTimer) clearTimeout(obsZoomTestTriggerSaveTimer);
        obsZoomTestTriggerSaveTimer = setTimeout(() => {
          obsZoomTestTriggerSaveTimer = null;
          const v = normalizeText(root.querySelector("#obsZoomTestTrigger")?.value).toUpperCase() || "T20";
          void api.savePartial?.({ obsZoomLastTestTrigger: v });
        }, 400);
      });
      root.querySelector("#btnObsZoomTestTrigger")?.addEventListener("click", async () => {
        await runObsZoomTriggerTest(api, root, root.querySelector("#obsZoomTestTrigger")?.value || OBS_TEST_TRIGGER);
      });
      function attachObsZoomPanelActivationLoad() {
        const pageEl = root;
        if (!pageEl || pageEl.dataset.obsZoomObsActivationBound === "1") return;
        pageEl.dataset.obsZoomObsActivationBound = "1";
        let debounceTimer = null;
        let inFlight = false;
        const runLoad = async () => {
          if (!pageEl.classList.contains("active")) return;
          if (pageEl.classList.contains("pageDisabled")) return;
          if (inFlight) return;
          inFlight = true;
          try {
            await reloadObsScenes(api, root, true);
            const sel = normalizeText(root.querySelector("#obsZoomSceneSelect")?.value);
            if (sel) await reloadObsSceneSources(api, root, sel, true);
          } catch {
            /* still silent */
          } finally {
            inFlight = false;
          }
        };
        const schedule = () => {
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            debounceTimer = null;
            void runLoad();
          }, 40);
        };
        const mo = new MutationObserver(() => schedule());
        mo.observe(pageEl, { attributes: true, attributeFilter: ["class"] });
        if (pageEl.classList.contains("active") && !pageEl.classList.contains("pageDisabled")) {
          schedule();
        }
      }
      attachObsZoomPanelActivationLoad();

      root.addEventListener("click", async (ev) => {
        const playerNameBackdrop = ev.target?.closest?.("[data-obs-player-name-backdrop]");
        if (playerNameBackdrop && ev.target === playerNameBackdrop) {
          closePlayerNameModal(api);
          return;
        }
        const playerNameCancel = ev.target?.closest?.("[data-obs-player-name-cancel]");
        if (playerNameCancel) {
          closePlayerNameModal(api);
          return;
        }
        const playerNameAdd = ev.target?.closest?.("[data-obs-player-name-add]");
        if (playerNameAdd) {
          await submitPlayerNameFromModal(api, root);
          return;
        }

        const testPresetBtn = ev.target?.closest?.("[data-obs-zoom-test-preset]");
        if (testPresetBtn) {
          const preset = String(testPresetBtn.getAttribute("data-obs-zoom-test-preset") || "").trim();
          await runObsZoomTriggerTest(api, root, preset, false);
          return;
        }

        const sourcePickBtn = ev.target?.closest?.("[data-obs-scene-source-pick]");
        if (sourcePickBtn) {
          OBS_SELECTED_SOURCE = String(sourcePickBtn.dataset.obsSceneSourcePick || "").trim();
          const pendingMode = String(root.dataset.obsZoomPendingMode || "create");
          delete root.dataset.obsZoomPendingMode;
          SOURCE_PICKER_OPEN = false;
          scope.ADM_MODULES.obszoom.sync(api, api.getSettings?.() || {});
          try {
            await createMoveFiltersForSelection(api, root, OBS_SELECTED_SOURCE, pendingMode);
          } catch (error) {
            const actionLabel = pendingMode === "create" ? "erstellt" : "aktualisiert";
            api.setStatus?.(`Move Filter konnten nicht ${actionLabel} werden: ${String(error?.message || error || "unknown_error")}`);
          }
          return;
        }

        const closePickerBtn = ev.target?.closest?.("[data-obs-source-picker-close]");
        if (closePickerBtn) {
          delete root.dataset.obsZoomPendingMode;
          SOURCE_PICKER_OPEN = false;
          scope.ADM_MODULES.obszoom.sync(api, api.getSettings?.() || {});
          return;
        }

        const cancelWarningBtn = ev.target?.closest?.("[data-obs-warning-cancel]");
        if (cancelWarningBtn) {
          closeWarningModal(api);
          return;
        }

        const confirmWarningBtn = ev.target?.closest?.("[data-obs-warning-confirm]");
        if (confirmWarningBtn) {
          const action = WARNING_MODAL_ACTION;
          closeWarningModal(api);
          if (typeof action === "function") {
            await action();
          }
          return;
        }
      });
    },
    sync(api, settings) {
      const root = api.root;
      const s = settings || {};
      {
        const d = Number(s.obsZoomDurationMs);
        OBS_MOVE_DURATION = Number.isFinite(d) && d >= 0 ? d : 450;
        const et = Number(s.obsZoomMoveEasingType);
        OBS_EASING_TYPE = Number.isFinite(et) ? et : 3;
        const ef = Number(s.obsZoomMoveEasingFunction);
        OBS_EASING_FUNCTION = Number.isFinite(ef) ? ef : 2;
        OBS_INCLUDE_SINGLES = s.obsZoomIncludeSingles !== false;
        OBS_INCLUDE_DOUBLES = s.obsZoomIncludeDoubles !== false;
        OBS_INCLUDE_TRIPLES = s.obsZoomIncludeTriples !== false;
        const tt = normalizeText(s.obsZoomLastTestTrigger || "T20").toUpperCase();
        OBS_TEST_TRIGGER = tt || "T20";
      }
      const sceneSelect = root.querySelector("#obsZoomSceneSelect");
      if (sceneSelect) {
        const storedScene = normalizeText(s.obsZoomSceneName);
        const prevUi = normalizeText(sceneSelect.value);
        sceneSelect.innerHTML = renderSceneOptions();
        let pick = "";
        if (storedScene && OBS_SCENES.includes(storedScene)) pick = storedScene;
        else if (prevUi && OBS_SCENES.includes(prevUi)) pick = prevUi;
        else if (OBS_SCENES.length) pick = OBS_SCENES[0];
        if (pick) sceneSelect.value = pick;
        if (pick && pick !== storedScene) {
          void api.savePartial?.({ obsZoomSceneName: pick });
        }
      }
      const sourceSelect = root.querySelector("#obsZoomSourceSelect");
      if (sourceSelect) {
        sourceSelect.innerHTML = renderSourceOptions(api);
        const storedSource = normalizeText(s.obsZoomTargetSource);
        let srcPick = "";
        if (OBS_SELECTED_SOURCE && OBS_SCENE_SOURCES.includes(OBS_SELECTED_SOURCE)) srcPick = OBS_SELECTED_SOURCE;
        else if (storedSource && OBS_SCENE_SOURCES.includes(storedSource)) srcPick = storedSource;
        else if (OBS_SCENE_SOURCES.length) srcPick = OBS_SCENE_SOURCES[0];
        if (srcPick && OBS_SCENE_SOURCES.includes(srcPick)) {
          sourceSelect.value = srcPick;
          OBS_SELECTED_SOURCE = srcPick;
        } else {
          OBS_SELECTED_SOURCE = normalizeText(sourceSelect.value);
        }
      }
      const sourcePickerMount = root.querySelector("#obsZoomSourcePickerMount");
      if (sourcePickerMount) sourcePickerMount.innerHTML = renderSourcePicker();
      const warningModalMount = root.querySelector("#obsZoomWarningModalMount");
      if (warningModalMount) warningModalMount.innerHTML = renderWarningModal();
      const playerNameModalMount = root.querySelector("#obsZoomPlayerNameModalMount");
      if (playerNameModalMount) playerNameModalMount.innerHTML = renderPlayerNameModal(api);
      api.setValue(root, "obsZoomCheckoutTriggerThreshold", Number.isFinite(s.checkoutTriggerThreshold) ? s.checkoutTriggerThreshold : 170);
      refreshObsZoomPlayerFilterUi(api, root, String(s.obsZoomPlayerNamesList || ""));
      const bullOffZoomEl = root.querySelector("#obsZoomBullOffZoom");
      if (bullOffZoomEl) bullOffZoomEl.checked = s.obsZoomBullOffZoom === true;
      const st20 = root.querySelector("#obsZoomStickyTriple20");
      if (st20) st20.checked = s.obsZoomStickyTriple20 === true;
      const st19 = root.querySelector("#obsZoomStickyTriple19");
      if (st19) st19.checked = s.obsZoomStickyTriple19 === true;
      const namesCount = parseObsZoomDisplayNames(s.obsZoomPlayerNamesList || "").length;
      const filterMode = namesCount ? "names" : "all";
      if (String(s.obsZoomPlayerFilterMode || "") !== filterMode) {
        void api.savePartial?.({ obsZoomPlayerFilterMode: filterMode });
      }
      api.setValue(root, "obsZoomMoveDuration", OBS_MOVE_DURATION);
      const singlesInput = root.querySelector("#obsZoomIncludeSingles");
      if (singlesInput) singlesInput.checked = OBS_INCLUDE_SINGLES;
      const doublesInput = root.querySelector("#obsZoomIncludeDoubles");
      if (doublesInput) doublesInput.checked = OBS_INCLUDE_DOUBLES;
      const triplesInput = root.querySelector("#obsZoomIncludeTriples");
      if (triplesInput) triplesInput.checked = OBS_INCLUDE_TRIPLES;
      api.setValue(root, "obsZoomEasingType", OBS_EASING_TYPE);
      api.setValue(root, "obsZoomEasingFunction", OBS_EASING_FUNCTION);
      api.setValue(root, "obsZoomTestTrigger", OBS_TEST_TRIGGER);
      const connectionGrid = root.querySelector("#obsZoomConnectionStripGrid");
      if (connectionGrid) {
        connectionGrid.dataset.connectionsOpen = "false";
        const visibleCount = Array.from(connectionGrid.querySelectorAll("[data-connection-kind]")).filter((node) => {
          const kind = String(node.dataset.connectionKind || "");
          return kind === "obs" ? s.obsEnabled !== false : s.sbEnabled !== false;
        }).length;
        connectionGrid.classList.toggle("compactSingle", visibleCount <= 1);
      }
      api.refreshConnectionStatuses?.();
      updateObsZoomScenesCollapseUi(root);
    },
    async refreshObsListsOnPopupOpen(api) {
      const root = api?.root;
      if (!root) return;
      try {
        await reloadObsScenes(api, root, true);
        const fromDom = normalizeText(root.querySelector("#obsZoomSceneSelect")?.value);
        const fromSettings = normalizeText(api.getSettings?.()?.obsZoomSceneName);
        const scene = fromDom || fromSettings || "";
        if (scene) await reloadObsSceneSources(api, root, scene, true, { persistSelection: false });
      } catch {
        /* silent */
      }
    }
  };
})(window);
