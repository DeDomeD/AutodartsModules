(function initMainSettingsPage(scope) {
  scope.ADM_MAIN_SETTINGS = {
    id: "settings",
    icon: "[]",
    navLabelKey: "nav_settings",
    render(context = {}) {
      return `
        <h2 class="title" data-i18n="title_settings">Settings</h2>

        <div class="sectionHead" style="margin-top:0;">
          <div class="sectionTitle" data-i18n="section_debug">Debug</div>
          <button
            type="button"
            id="btnOpenServiceWorker"
            class="btnMini"
            style="font-size:15px;line-height:1;padding:4px 9px;"
            data-i18n-title="debug_open_worker_title"
            data-i18n-aria-label="debug_open_worker_title"
            title=""
            aria-label=""
          >👁</button>
        </div>

        <div class="sectionTitle" style="margin-top:14px;" data-i18n="section_general">General</div>
        <div class="card">
          <div class="formRow">
            <label class="label" for="uiLanguage" data-i18n="language_label">Language</label>
            <select class="input" id="uiLanguage">
              <option value="de">Deutsch</option>
              <option value="en">English</option>
            </select>
            <div class="hint" data-i18n="language_hint">Changes all popup texts between German and English.</div>
          </div>
        </div>

        <div id="settingsConnectionsSection" class="card" style="margin-top:14px;scroll-margin-top:10px;">
          <div class="sectionTitle" data-i18n="section_central_connections">Verbindungen (OBS, Streamer.bot, WLED)</div>
          <div class="hint" data-i18n="connections_central_hint">Diese Zugangsdaten nutzen Effekte, OBS-Zoom und WLED gemeinsam.</div>
          <div class="connectionStatusGrid" id="settingsConnectionGrid" data-connections-open="true" style="margin-top:10px;">
            <button type="button" class="connectionStatusBtn" data-connection-kind="obs" data-obs-status data-connection-retry="obs">
              <div class="connectionStatusLabel">
                <span>OBS</span>
                <span class="connectionStatusText" data-connection-status-text></span>
                <span class="connectionStatusAttempts" data-connection-attempts></span>
              </div>
            </button>
            <button type="button" class="connectionStatusBtn" data-connection-kind="sb" data-sb-status data-connection-retry="sb">
              <div class="connectionStatusLabel">
                <span>Streamer.bot</span>
                <span class="connectionStatusText" data-connection-status-text></span>
                <span class="connectionStatusAttempts" data-connection-attempts></span>
              </div>
            </button>
          </div>
          <div class="formRow" style="margin-top:12px;">
            <div class="connectionInputHeader">
              <label class="label" for="settingsObsUrl" data-i18n="hint_obs_ws">OBS WebSocket</label>
              <div class="connectionInputSwitch">
                <span>Aktiv</span>
                <label class="switch switchCompact"><input id="settingsObsEnabled" type="checkbox" /><span class="slider"></span></label>
              </div>
            </div>
            <input class="input" id="settingsObsUrl" type="text" placeholder="ws://127.0.0.1:4455/" />
          </div>
          <div class="formRow">
            <label class="label" for="settingsObsPassword">OBS Passwort</label>
            <input class="input" id="settingsObsPassword" type="password" placeholder="optional" />
          </div>
          <div class="divider"></div>
          <div class="formRow">
            <div class="connectionInputHeader">
              <label class="label" for="settingsSbUrl" data-i18n="hint_sb_ws">Streamer.bot</label>
              <div class="connectionInputSwitch">
                <span>Aktiv</span>
                <label class="switch switchCompact"><input id="settingsSbEnabled" type="checkbox" /><span class="slider"></span></label>
              </div>
            </div>
            <input class="input" id="settingsSbUrl" type="text" placeholder="ws://127.0.0.1:8080/" />
          </div>
          <div class="formRow">
            <label class="label" for="settingsSbPassword">Streamer.bot Passwort</label>
            <input class="input" id="settingsSbPassword" type="password" placeholder="optional" />
          </div>
          <div class="formRow">
            <label class="label" for="settingsActionPrefix" data-i18n="label_action_prefix">Action Prefix</label>
            <input class="input" id="settingsActionPrefix" type="text" placeholder="ADM " />
            <div class="hint" data-i18n="hint_action_prefix">Actions run as Prefix + Suffix.</div>
          </div>
          <div class="divider"></div>
          <div class="sectionTitle" style="margin-top:4px;" data-i18n="wled_controllers_section">WLED Controller</div>
          <div id="settingsWledControllersMount"></div>
          <div class="rowSplit" style="margin-top:12px;">
            <button id="settingsAddWledControllerBtn" class="btnMini" type="button" data-i18n="wled_add_controller_plus_btn">+ Controller</button>
          </div>
        </div>

        <div class="sectionTitle" style="margin-top:14px;" data-i18n="section_settings">Settings</div>
        <div class="card">
          <div class="hint" data-i18n="settings_io_hint">Import or export your current settings.</div>
          <div class="rowSplit" style="margin-top:10px;">
            <button id="btnSaveIni" class="btnPrimary" data-i18n="btn_save">Save</button>
            <button id="btnLoadIni" class="btn" data-i18n="btn_load">Load</button>
          </div>
          <div class="rowSplit" style="margin-top:10px;">
            <button id="btnExportAllIni" class="btnPrimary" type="button">Export All Configs</button>
            <button id="btnImportAllIni" class="btn" type="button">Import All Configs</button>
          </div>
          <input id="iniFileInput" type="file" accept=".ini,text/plain" style="display:none;" />
          <input id="iniFilesInput" type="file" accept=".ini,text/plain" multiple style="display:none;" />
          <div class="hint" id="iniStatus" style="margin-top:8px;"></div>
        </div>
      `;
    },
    bind(api) {
      const root = api.root;

      api.bindAuto(root, "settingsObsEnabled", "obsEnabled");
      api.bindAuto(root, "settingsSbEnabled", "sbEnabled");
      api.bindAutoImmediate(root, "settingsObsUrl", "obsUrl", (value) => String(value || "").trim());
      api.bindAutoImmediate(root, "settingsObsPassword", "obsPassword", (value) => String(value || ""));
      api.bindAutoImmediate(root, "settingsSbUrl", "sbUrl", (value) => String(value || "").trim());
      api.bindAutoImmediate(root, "settingsSbPassword", "sbPassword", (value) => String(value || ""));
      api.bindAutoImmediate(root, "settingsActionPrefix", "actionPrefix", (value) => api.normalizePrefix(value || ""));

      root.querySelectorAll("[data-connection-retry]").forEach((button) => {
        button.addEventListener("click", async () => {
          const kind = String(button.dataset.connectionRetry || "");
          if (kind === "sb") await api.send({ type: "SB_RETRY" });
          if (kind === "obs") await api.send({ type: "OBS_RETRY" });
          setTimeout(() => api.refreshConnectionStatuses?.(), 150);
        });
      });

      root.querySelector("#settingsAddWledControllerBtn")?.addEventListener("click", async () => {
        const wledMod = scope.ADM_MODULES?.wled;
        if (typeof wledMod?.appendControllerFromSettings === "function") {
          await wledMod.appendControllerFromSettings(api);
        }
      });

      root.querySelector("#btnLoadIni")?.addEventListener("click", () => {
        const input = root.querySelector("#iniFileInput");
        if (!input) return;
        input.value = "";
        input.click();
      });

      root.querySelector("#iniFileInput")?.addEventListener("change", async (ev) => {
        const statusEl = root.querySelector("#iniStatus");
        try {
          const file = ev?.target?.files?.[0];
          if (!file) return;
          if (statusEl) statusEl.textContent = api.t("status_loading");
          const text = await file.text();
          const partial = api.parseIniSettings(text);
          if (Object.keys(partial).length === 0) throw new Error(api.t("status_no_valid_values"));
          await api.savePartial(partial);
          if (statusEl) statusEl.textContent = api.t("status_loaded_from", { name: file.name });
        } catch (e) {
          if (statusEl) statusEl.textContent = api.t("status_load_failed", { error: String(e?.message || e) });
        }
      });

      root.querySelector("#btnSaveIni")?.addEventListener("click", async () => {
        const statusEl = root.querySelector("#iniStatus");
        try {
          if (statusEl) statusEl.textContent = api.t("status_loading");
          const ini = api.toIniText(api.getSettings());
          const blob = new Blob([ini], { type: "text/plain;charset=utf-8" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = "settings.ini";
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
          if (statusEl) statusEl.textContent = api.t("status_saved_download");
        } catch (e) {
          if (statusEl) statusEl.textContent = api.t("status_save_failed", { error: String(e?.message || e) });
        }
      });

      root.querySelector("#btnImportAllIni")?.addEventListener("click", () => {
        const input = root.querySelector("#iniFilesInput");
        if (!input) return;
        input.value = "";
        input.click();
      });

      root.querySelector("#iniFilesInput")?.addEventListener("change", async (ev) => {
        const statusEl = root.querySelector("#iniStatus");
        try {
          const files = Array.from(ev?.target?.files || []);
          if (!files.length) return;
          if (statusEl) statusEl.textContent = "Konfigurationen werden geladen...";
          const settingsFile = files.find((file) => String(file.name || "").toLowerCase() === "settings.ini");
          if (!settingsFile) throw new Error("settings.ini fehlt");
          const text = await settingsFile.text();
          const partial = api.parseIniSettings(text);
          if (Object.keys(partial).length === 0) throw new Error(api.t("status_no_valid_values"));
          await api.savePartial(partial);
          if (statusEl) statusEl.textContent = `${files.length} Konfigurationsdateien geladen.`;
        } catch (e) {
          if (statusEl) statusEl.textContent = `Import fehlgeschlagen: ${String(e?.message || e)}`;
        }
      });

      root.querySelector("#btnExportAllIni")?.addEventListener("click", async () => {
        const statusEl = root.querySelector("#iniStatus");
        try {
          if (statusEl) statusEl.textContent = "Konfigurationen werden exportiert...";
          const files = api.buildIniFiles(api.getSettings());
          for (const file of files) {
            const blob = new Blob([file.content], { type: "text/plain;charset=utf-8" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = file.name;
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            await new Promise((resolve) => setTimeout(resolve, 120));
          }
          if (statusEl) statusEl.textContent = `${files.length} Konfigurationsdateien exportiert.`;
        } catch (e) {
          if (statusEl) statusEl.textContent = `Export fehlgeschlagen: ${String(e?.message || e)}`;
        }
      });

      const mirrorCtl = scope.ADM_WORKER_MIRROR_UI?.install?.({
        rootDoc: document,
        mode: "overlay",
        settingsPageRoot: root,
        mountTarget: document.body,
        getSettings: () => api.getSettings?.() || {},
        savePartial: (partial) => api.savePartial(partial),
        t: (key, vars) => api.t(key, vars),
        applyI18n: () => {
          try {
            window.__ADM_APPLY_I18N__?.();
          } catch {
            // ignore
          }
        }
      });
      scope.__admMirrorCtl = mirrorCtl;

      api.bindAuto(root, "uiLanguage", "uiLanguage", "text");
    },
    sync(api, settings) {
      const root = api.root;
      const s = settings || {};
      api.setValue(root, "uiLanguage", String(s.uiLanguage || "de").toLowerCase() === "en" ? "en" : "de");

      api.setChecked(root, "settingsObsEnabled", s.obsEnabled !== false);
      api.setChecked(root, "settingsSbEnabled", s.sbEnabled !== false);
      api.setValue(root, "settingsObsUrl", s.obsUrl || "");
      api.setValue(root, "settingsObsPassword", s.obsPassword || "");
      api.setValue(root, "settingsSbUrl", s.sbUrl || "");
      api.setValue(root, "settingsSbPassword", s.sbPassword || "");
      api.setValue(root, "settingsActionPrefix", String(s.actionPrefix || "").trim());

      const connectionGrid = root.querySelector("#settingsConnectionGrid");
      if (connectionGrid) {
        connectionGrid.dataset.connectionsOpen = "true";
        const visibleCount = Array.from(connectionGrid.querySelectorAll("[data-connection-kind]")).filter((node) => {
          const kind = String(node.dataset.connectionKind || "");
          return kind === "obs" ? s.obsEnabled !== false : s.sbEnabled !== false;
        }).length;
        connectionGrid.classList.toggle("compactSingle", visibleCount <= 1);
      }

      try {
        scope.__admMirrorCtl?.applyWorkerMirrorTiersToDom?.(s.workerMirrorCatTiers);
      } catch {
        // ignore
      }

      const statusEl = root.querySelector("#iniStatus");
      if (statusEl && !statusEl.textContent) statusEl.textContent = api.t("status_idle");

      api.refreshConnectionStatuses?.();
    }
  };
})(window);
