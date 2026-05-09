(function initLobbyFilterModule(scope) {
  scope.ADM_MODULES = scope.ADM_MODULES || {};

  scope.ADM_MODULES.lobbyfilter = {
    id: "lobbyfilter",
    icon: "L",
    navLabelKey: "nav_lobbyfilter",
    needs: { streamerbot: false, obs: false },
    render() {
      return `
        <div class="admLfModule">
        <h2 class="title admLfModuleTitle"><span data-i18n="title_lobbyfilter">Lobby-Filter</span><span class="titleMeta">play.autodarts.io</span></h2>
        <div class="card admLfCard">
          <div class="formRow admLfFormRowTight">
            <div class="sectionTitle admLfSectionTitle" data-i18n="lobbyfilter_section_blacklist">Blacklist</div>
          </div>
          <div class="formRow">
            <label class="label" for="lobbyFilterBlacklistJson" data-i18n="lobbyfilter_bl_one_per_line">Playername (eine Zeile pro Eintrag)</label>
            <textarea class="input admLfTextarea" id="lobbyFilterBlacklistJson" rows="8" style="min-height:140px;font-family:ui-monospace,monospace;font-size:12px;" placeholder=""></textarea>
          </div>
          <div class="list admLfList">
            <div class="listToggle">
              <div class="liText">
                <div class="liTitle" data-i18n="lobbyfilter_hide_short">Ausblenden</div>
              </div>
              <label class="switch">
                <input id="lobbyFilterBlacklistHide" type="checkbox" />
                <span class="slider"></span>
              </label>
            </div>
            <div class="listToggle">
              <div class="liText">
                <div class="liTitle" data-i18n="lobbyfilter_color_short">Farbe</div>
              </div>
              <label class="switch">
                <input id="lobbyFilterBlacklistMark" type="checkbox" />
                <span class="slider"></span>
              </label>
            </div>
          </div>
          <div class="admLfHueSliderRow">
            <input type="range" id="lobbyFilterBlacklistHue" class="hueSlider admLfHueSlider admLfHueSliderBlock" min="0" max="360" step="1" />
            <div id="lobbyHueSwatchBl" class="admLfHueSwatch admLfHueSwatchBlock" aria-hidden="true"></div>
          </div>
        </div>
        <div class="card admLfCard admLfCardStack">
          <div class="formRow admLfFormRowTight">
            <div class="sectionTitle admLfSectionTitle" data-i18n="lobbyfilter_section_favorites">Favoriten</div>
          </div>
          <div class="formRow">
            <label class="label" for="lobbyFilterFavoritesJson" data-i18n="lobbyfilter_fav_one_per_line">Spielername (eine Zeile pro Eintrag)</label>
            <textarea class="input admLfTextarea" id="lobbyFilterFavoritesJson" rows="8" style="min-height:140px;font-family:ui-monospace,monospace;font-size:12px;" placeholder=""></textarea>
          </div>
          <div class="list admLfList">
            <div class="listToggle">
              <div class="liText">
                <div class="liTitle" data-i18n="lobbyfilter_hide_short">Ausblenden</div>
              </div>
              <label class="switch">
                <input id="lobbyFilterFavoritesHide" type="checkbox" />
                <span class="slider"></span>
              </label>
            </div>
            <div class="listToggle">
              <div class="liText">
                <div class="liTitle" data-i18n="lobbyfilter_color_short">Farbe</div>
              </div>
              <label class="switch">
                <input id="lobbyFilterFavoritesMark" type="checkbox" />
                <span class="slider"></span>
              </label>
            </div>
          </div>
          <div class="admLfHueSliderRow">
            <input type="range" id="lobbyFilterFavoritesHue" class="hueSlider admLfHueSlider admLfHueSliderBlock" min="0" max="360" step="1" />
            <div id="lobbyHueSwatchFav" class="admLfHueSwatch admLfHueSwatchBlock" aria-hidden="true"></div>
          </div>
        </div>
        <div class="card admLfCard admLfCardStack">
          <div class="formRow admLfFormRowTight">
            <div class="sectionTitle admLfSectionTitle" data-i18n="lobbyfilter_section_empty">Leere Lobbys</div>
          </div>
          <div class="list admLfList">
            <div class="listToggle">
              <div class="liText">
                <div class="liTitle" data-i18n="lobbyfilter_hide_short">Ausblenden</div>
              </div>
              <label class="switch">
                <input id="lobbyFilterEmptyHide" type="checkbox" />
                <span class="slider"></span>
              </label>
            </div>
            <div class="listToggle">
              <div class="liText">
                <div class="liTitle" data-i18n="lobbyfilter_color_short">Farbe</div>
              </div>
              <label class="switch">
                <input id="lobbyFilterEmptyMark" type="checkbox" />
                <span class="slider"></span>
              </label>
            </div>
          </div>
          <div class="admLfHueSliderRow">
            <input type="range" id="lobbyFilterEmptyHue" class="hueSlider admLfHueSlider admLfHueSliderBlock" min="0" max="360" step="1" />
            <div id="lobbyHueSwatchEmpty" class="admLfHueSwatch admLfHueSwatchBlock" aria-hidden="true"></div>
          </div>
        </div>
        <div class="card admLfCard admLfCardStack">
          <div class="list admLfList admLfListFlush">
            <div class="listToggle">
              <div class="liText">
                <div class="liTitle" data-i18n="lobbyfilter_time_short">Zeit</div>
              </div>
              <label class="switch">
                <input id="lobbyFilterShowOpenAge" type="checkbox" />
                <span class="slider"></span>
              </label>
            </div>
          </div>
        </div>
        <div class="spacer"></div>
        </div>
      `;
    },
    bind(api) {
      const root = api.root;
      const clampHueInput = (v) => {
        const t = String(v ?? "").trim();
        if (t === "") return "0";
        const n = parseInt(t, 10);
        if (!Number.isFinite(n)) return "0";
        return String(Math.max(0, Math.min(360, n)));
      };

      const syncHueVar = (el) => {
        if (!el) return;
        const v = parseInt(String(el.value), 10);
        const n = Number.isFinite(v) ? Math.max(0, Math.min(360, v)) : 0;
        el.style.setProperty("--hue", String(n));
      };

      const paintSwatch = (hueEl, swEl) => {
        if (!hueEl || !swEl) return;
        const v = parseInt(String(hueEl.value), 10);
        const n = Number.isFinite(v) ? Math.max(0, Math.min(360, v)) : 0;
        swEl.style.background = `hsl(${n}, 85%, 52%)`;
      };

      const refreshHueUiBl = () => {
        const hb = root.querySelector("#lobbyFilterBlacklistHue");
        const sb = root.querySelector("#lobbyHueSwatchBl");
        syncHueVar(hb);
        paintSwatch(hb, sb);
      };

      const refreshHueUiFav = () => {
        const hb = root.querySelector("#lobbyFilterFavoritesHue");
        const sb = root.querySelector("#lobbyHueSwatchFav");
        syncHueVar(hb);
        paintSwatch(hb, sb);
      };

      const refreshHueUiEmpty = () => {
        const hb = root.querySelector("#lobbyFilterEmptyHue");
        const sb = root.querySelector("#lobbyHueSwatchEmpty");
        syncHueVar(hb);
        paintSwatch(hb, sb);
      };

      const syncColorHueRowBl = () => {
        const mark = root.querySelector("#lobbyFilterBlacklistMark");
        const hue = root.querySelector("#lobbyFilterBlacklistHue");
        const sw = root.querySelector("#lobbyHueSwatchBl");
        const on = !!(mark && mark.checked);
        if (hue) {
          hue.disabled = !on;
          hue.style.opacity = on ? "1" : "0.4";
        }
        if (sw) sw.style.opacity = on ? "1" : "0.4";
      };

      const syncColorHueRowFav = () => {
        const mark = root.querySelector("#lobbyFilterFavoritesMark");
        const hue = root.querySelector("#lobbyFilterFavoritesHue");
        const sw = root.querySelector("#lobbyHueSwatchFav");
        const on = !!(mark && mark.checked);
        if (hue) {
          hue.disabled = !on;
          hue.style.opacity = on ? "1" : "0.4";
        }
        if (sw) sw.style.opacity = on ? "1" : "0.4";
      };

      const syncColorHueRowEmpty = () => {
        const mark = root.querySelector("#lobbyFilterEmptyMark");
        const hue = root.querySelector("#lobbyFilterEmptyHue");
        const sw = root.querySelector("#lobbyHueSwatchEmpty");
        const on = !!(mark && mark.checked);
        if (hue) {
          hue.disabled = !on;
          hue.style.opacity = on ? "1" : "0.4";
        }
        if (sw) sw.style.opacity = on ? "1" : "0.4";
      };

      api.bindAuto(root, "lobbyFilterBlacklistHide", "lobbyFilterBlacklistHide");
      api.bindAuto(root, "lobbyFilterBlacklistMark", "lobbyFilterBlacklistMark");
      api.bindAuto(root, "lobbyFilterFavoritesHide", "lobbyFilterFavoritesHide");
      api.bindAuto(root, "lobbyFilterFavoritesMark", "lobbyFilterFavoritesMark");
      api.bindAuto(root, "lobbyFilterEmptyHide", "lobbyFilterEmptyHide");
      api.bindAuto(root, "lobbyFilterEmptyMark", "lobbyFilterEmptyMark");
      api.bindAuto(root, "lobbyFilterShowOpenAge", "lobbyFilterShowOpenAge");
      api.bindAutoImmediate(root, "lobbyFilterBlacklistHue", "lobbyFilterBlacklistHue", clampHueInput, 200);
      api.bindAutoImmediate(root, "lobbyFilterFavoritesHue", "lobbyFilterFavoritesHue", clampHueInput, 200);
      api.bindAutoImmediate(root, "lobbyFilterEmptyHue", "lobbyFilterEmptyHue", clampHueInput, 200);

      const markBl = root.querySelector("#lobbyFilterBlacklistMark");
      if (markBl) markBl.addEventListener("change", () => syncColorHueRowBl());

      const markFav = root.querySelector("#lobbyFilterFavoritesMark");
      if (markFav) markFav.addEventListener("change", () => syncColorHueRowFav());

      const markEmpty = root.querySelector("#lobbyFilterEmptyMark");
      if (markEmpty) markEmpty.addEventListener("change", () => syncColorHueRowEmpty());

      const hbBl = root.querySelector("#lobbyFilterBlacklistHue");
      if (hbBl) hbBl.addEventListener("input", () => refreshHueUiBl());

      const hbFav = root.querySelector("#lobbyFilterFavoritesHue");
      if (hbFav) hbFav.addEventListener("input", () => refreshHueUiFav());

      const hbEmpty = root.querySelector("#lobbyFilterEmptyHue");
      if (hbEmpty) hbEmpty.addEventListener("input", () => refreshHueUiEmpty());

      const taBl = root.querySelector("#lobbyFilterBlacklistJson");
      const saveBl = async () => {
        const lines = String(taBl?.value || "")
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean);
        await api.savePartial({ lobbyFilterBlacklistJson: JSON.stringify(lines) });
      };
      if (taBl) {
        taBl.addEventListener("change", () => void saveBl());
        taBl.addEventListener("blur", () => void saveBl());
      }

      const taFav = root.querySelector("#lobbyFilterFavoritesJson");
      const saveFav = async () => {
        const lines = String(taFav?.value || "")
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean);
        await api.savePartial({ lobbyFilterFavoritesJson: JSON.stringify(lines) });
      };
      if (taFav) {
        taFav.addEventListener("change", () => void saveFav());
        taFav.addEventListener("blur", () => void saveFav());
      }

      refreshHueUiBl();
      refreshHueUiFav();
      refreshHueUiEmpty();
      syncColorHueRowBl();
      syncColorHueRowFav();
      syncColorHueRowEmpty();
    },
    sync(api, settings) {
      const root = api.root;
      const s = settings || {};
      const hueVal = (raw, fallback) => {
        const n = parseInt(String(raw ?? ""), 10);
        if (!Number.isFinite(n)) return String(fallback);
        return String(Math.max(0, Math.min(360, n)));
      };
      api.setChecked(root, "lobbyFilterBlacklistHide", s.lobbyFilterBlacklistHide !== false);
      api.setChecked(root, "lobbyFilterBlacklistMark", s.lobbyFilterBlacklistMark !== false);
      api.setChecked(root, "lobbyFilterFavoritesHide", s.lobbyFilterFavoritesHide === true);
      api.setChecked(root, "lobbyFilterFavoritesMark", s.lobbyFilterFavoritesMark !== false);
      api.setChecked(root, "lobbyFilterEmptyHide", s.lobbyFilterEmptyHide === true);
      api.setChecked(root, "lobbyFilterEmptyMark", s.lobbyFilterEmptyMark === true);
      api.setChecked(root, "lobbyFilterShowOpenAge", s.lobbyFilterShowOpenAge !== false);
      api.setValue(root, "lobbyFilterBlacklistHue", hueVal(s.lobbyFilterBlacklistHue, 0));
      api.setValue(root, "lobbyFilterFavoritesHue", hueVal(s.lobbyFilterFavoritesHue, 120));
      api.setValue(root, "lobbyFilterEmptyHue", hueVal(s.lobbyFilterEmptyHue, 210));

      const hbBl = root.querySelector("#lobbyFilterBlacklistHue");
      const sbBl = root.querySelector("#lobbyHueSwatchBl");
      if (hbBl) {
        const n = parseInt(hueVal(s.lobbyFilterBlacklistHue, 0), 10);
        hbBl.style.setProperty("--hue", String(n));
      }
      if (hbBl && sbBl) {
        const n = parseInt(String(hbBl.value), 10) || 0;
        sbBl.style.background = `hsl(${Math.max(0, Math.min(360, n))}, 85%, 52%)`;
      }

      const markBl = root.querySelector("#lobbyFilterBlacklistMark");
      const hueBl = root.querySelector("#lobbyFilterBlacklistHue");
      const swBl = root.querySelector("#lobbyHueSwatchBl");
      const onBl = !!(markBl && markBl.checked);
      if (hueBl) {
        hueBl.disabled = !onBl;
        hueBl.style.opacity = onBl ? "1" : "0.4";
      }
      if (swBl) swBl.style.opacity = onBl ? "1" : "0.4";

      const hbFav = root.querySelector("#lobbyFilterFavoritesHue");
      const sbFav = root.querySelector("#lobbyHueSwatchFav");
      if (hbFav) {
        const n = parseInt(hueVal(s.lobbyFilterFavoritesHue, 120), 10);
        hbFav.style.setProperty("--hue", String(n));
      }
      if (hbFav && sbFav) {
        const n = parseInt(String(hbFav.value), 10) || 0;
        sbFav.style.background = `hsl(${Math.max(0, Math.min(360, n))}, 85%, 52%)`;
      }

      const markFav = root.querySelector("#lobbyFilterFavoritesMark");
      const hueFav = root.querySelector("#lobbyFilterFavoritesHue");
      const swFav = root.querySelector("#lobbyHueSwatchFav");
      const onFav = !!(markFav && markFav.checked);
      if (hueFav) {
        hueFav.disabled = !onFav;
        hueFav.style.opacity = onFav ? "1" : "0.4";
      }
      if (swFav) swFav.style.opacity = onFav ? "1" : "0.4";

      const hbEmpty = root.querySelector("#lobbyFilterEmptyHue");
      const sbEmpty = root.querySelector("#lobbyHueSwatchEmpty");
      if (hbEmpty) {
        const n = parseInt(hueVal(s.lobbyFilterEmptyHue, 210), 10);
        hbEmpty.style.setProperty("--hue", String(n));
      }
      if (hbEmpty && sbEmpty) {
        const n = parseInt(String(hbEmpty.value), 10) || 0;
        sbEmpty.style.background = `hsl(${Math.max(0, Math.min(360, n))}, 85%, 52%)`;
      }

      const markEmpty = root.querySelector("#lobbyFilterEmptyMark");
      const hueEmpty = root.querySelector("#lobbyFilterEmptyHue");
      const swEmpty = root.querySelector("#lobbyHueSwatchEmpty");
      const onEmpty = !!(markEmpty && markEmpty.checked);
      if (hueEmpty) {
        hueEmpty.disabled = !onEmpty;
        hueEmpty.style.opacity = onEmpty ? "1" : "0.4";
      }
      if (swEmpty) swEmpty.style.opacity = onEmpty ? "1" : "0.4";

      const taBl = root.querySelector("#lobbyFilterBlacklistJson");
      if (taBl) {
        let lines = [];
        try {
          const raw = JSON.parse(String(s.lobbyFilterBlacklistJson || "[]"));
          if (Array.isArray(raw)) lines = raw.map((x) => String(x || "").trim()).filter(Boolean);
        } catch {
          lines = [];
        }
        taBl.value = lines.join("\n");
      }

      const taFav = root.querySelector("#lobbyFilterFavoritesJson");
      if (taFav) {
        let lines = [];
        try {
          const raw = JSON.parse(String(s.lobbyFilterFavoritesJson || "[]"));
          if (Array.isArray(raw)) lines = raw.map((x) => String(x || "").trim()).filter(Boolean);
        } catch {
          lines = [];
        }
        taFav.value = lines.join("\n");
      }
    }
  };
})(window);
