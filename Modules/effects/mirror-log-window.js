(function initMirrorLogWindow() {
  let SETTINGS = {};

  function currentLang() {
    return String(SETTINGS?.uiLanguage || "de").toLowerCase() === "en" ? "en" : "de";
  }

  function t(key, vars) {
    const dict = (window.ADM_I18N && window.ADM_I18N[currentLang()]) || {};
    const fallback = (window.ADM_I18N && window.ADM_I18N.en) || {};
    let out = dict[key] || fallback[key] || key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) out = out.replace(`{${k}}`, String(v));
    }
    return out;
  }

  function applyMirrorWindowI18n() {
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.dataset.i18n;
      if (key) el.textContent = t(key);
    });
    document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
      const key = el.dataset.i18nPlaceholder;
      if (key) el.setAttribute("placeholder", t(key));
    });
    document.querySelectorAll("[data-i18n-title]").forEach((el) => {
      const key = el.dataset.i18nTitle;
      if (key) {
        const tx = t(key);
        el.setAttribute("title", tx);
        el.setAttribute("aria-label", tx);
      }
    });
    document.querySelectorAll("[data-i18n-aria-label]").forEach((el) => {
      const key = el.dataset.i18nAriaLabel;
      if (key) el.setAttribute("aria-label", t(key));
    });
  }

  function send(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (r) => resolve(r));
      } catch {
        resolve(null);
      }
    });
  }

  async function savePartial(partial) {
    const res = await send({ type: "SET_SETTINGS", settings: partial || {} });
    if (res?.ok && res.settings) SETTINGS = res.settings;
    return res;
  }

  async function boot() {
    const res = await send({ type: "GET_SETTINGS" });
    SETTINGS = res?.ok ? res.settings : {};
    window.ADM_WORKER_MIRROR_UI.install({
      rootDoc: document,
      mode: "standalone",
      mountTarget: document.getElementById("mirrorWindowRoot"),
      getSettings: () => SETTINGS,
      savePartial,
      t,
      applyI18n: applyMirrorWindowI18n
    });
    applyMirrorWindowI18n();
  }

  boot();
})();
