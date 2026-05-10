/**
 * Runtime Message Router
 * Responsibility:
 * - handles popup/API messages (GET/SET settings, tests)
 * - receives Autodarts bridge events
 * - forwards events to Effects/Overlay modules
 */
(function initMessages(scope) {
  const ADM = scope.ADM || (scope.ADM = {});

  let listenersBound = false;
  const lastPlayerNamesByIndex = {};
  let lastActivePlayerIndex = null;
  const websiteThemeCssByTabId = new Map();
  /** Verhindert wiederholtes `setIcon` (Netzwerk/Devtools-Spam), wenn sich der Zustand pro Tab nicht ändert. */
  const lastToolbarIconColorByTabId = new Map();
  const ACTION_ICON_GRAY = {
    16: "Main/assets/ICON_grau_16.png",
    32: "Main/assets/ICON_grau_32.png"
  };
  const ACTION_ICON_COLOR = {
    16: "Main/assets/ICON_16.png",
    32: "Main/assets/ICON_32.png"
  };

  /** GET_WLED_PRESETS wird oft gepollt — Mirror nicht bei jedem erfolgreichen Fetch fluten. */
  const lastWledPresetMirrorLogByEndpoint = new Map();

  function logInfo(channel, message, data) {
    try { ADM.logger?.info?.(channel, message, data); } catch {}
  }

  function logError(channel, message, data) {
    try { ADM.logger?.error?.(channel, message, data); } catch {}
  }

  function readNameFromPlayer(playerObj) {
    if (!playerObj || typeof playerObj !== "object") return "";
    const cand =
      playerObj.name ??
      playerObj.displayName ??
      playerObj.nickname ??
      playerObj.username ??
      playerObj.userName ??
      playerObj.playerName ??
      playerObj?.player?.name ??
      playerObj?.user?.name ??
      "";
    return String(cand || "").trim();
  }

  function updatePlayerNameCacheFromState(e) {
    const roots = [e?.raw?.state, e?.raw, e].filter((x) => x && typeof x === "object");
    for (const root of roots) {
      const players = Array.isArray(root?.players) ? root.players : null;
      if (!players) continue;
      for (let i = 0; i < players.length; i += 1) {
        const n = readNameFromPlayer(players[i]);
        if (n) lastPlayerNamesByIndex[i] = n;
      }
    }
  }

  function asValidPlayerIndex(v) {
    const n = Number(v);
    if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
    if (n < 0 || n > 15) return null;
    return n;
  }

  function isAutodartsUrl(url) {
    const raw = String(url || "").trim();
    if (!raw || raw.startsWith("chrome://") || raw.startsWith("edge://")) return false;
    try {
      const u = new URL(raw);
      if (u.protocol !== "https:") return false;
      const host = u.hostname.toLowerCase();
      /** z. B. play.autodarts.io oder *.play.autodarts.io (Staging); nicht nur strikter String-Prefix. */
      return host === "play.autodarts.io" || host.endsWith(".play.autodarts.io");
    } catch {
      return /^https:\/\/play\.autodarts\.io\b/i.test(raw);
    }
  }

  const DEFAULT_WEBSITE_API_URL = "https://autodarts-modules-production.up.railway.app";

  function normalizeWebsiteApiUrl(url) {
    return String(url || DEFAULT_WEBSITE_API_URL).trim().replace(/\/+$/, "");
  }

  async function startGoogleAuthFlow(baseUrlRaw) {
    const baseUrl = normalizeWebsiteApiUrl(baseUrlRaw);
    const startUrl = `${baseUrl}/api/auth/google/start?returnTo=${encodeURIComponent("/account.html")}`;
    const accountPrefix = `${baseUrl}/account.html`;

    return new Promise((resolve, reject) => {
      if (!chrome?.tabs?.create || !chrome?.tabs?.onUpdated?.addListener || !chrome?.tabs?.onRemoved?.addListener) {
        reject(new Error("tabs api not available"));
        return;
      }

      let authTabId = null;
      let done = false;

      function finishError(error) {
        if (done) return;
        done = true;
        cleanup();
        reject(error instanceof Error ? error : new Error(String(error || "Google login failed")));
      }

      function finishOk(result) {
        if (done) return;
        done = true;
        cleanup();
        resolve(result);
      }

      function cleanup() {
        try { chrome.tabs.onUpdated.removeListener(handleUpdated); } catch {}
        try { chrome.tabs.onRemoved.removeListener(handleRemoved); } catch {}
      }

      async function handleUpdated(tabId, changeInfo, tab) {
        if (tabId !== authTabId) return;
        const url = String(changeInfo?.url || tab?.url || "");
        if (!url || !url.startsWith(accountPrefix)) return;

        try {
          const parsed = new URL(url);
          const auth = String(parsed.searchParams.get("auth") || "").trim().toLowerCase();
          if (!auth) return;

          if (auth === "success") {
            const token = String(parsed.searchParams.get("token") || "").trim();
            const rawUser = String(parsed.searchParams.get("user") || "").trim();
            let user = null;
            try {
              user = rawUser ? JSON.parse(rawUser) : null;
            } catch {}
            if (!token || !user) {
              finishError(new Error("Google login returned incomplete account data"));
              return;
            }
            await ADM.setSettings({
              websiteApiUrl: baseUrl,
              accountToken: token,
              accountUserJson: JSON.stringify(user)
            });
            try { chrome.tabs.remove(tabId, () => void chrome.runtime?.lastError); } catch {}
            finishOk({ ok: true, token, user });
            return;
          }

          const error = String(parsed.searchParams.get("error") || "Google login failed");
          try { chrome.tabs.remove(tabId, () => void chrome.runtime?.lastError); } catch {}
          finishError(new Error(error));
        } catch (e) {
          finishError(e);
        }
      }

      function handleRemoved(tabId) {
        if (tabId !== authTabId || done) return;
        finishError(new Error("Google login tab was closed"));
      }

      chrome.tabs.onUpdated.addListener(handleUpdated);
      chrome.tabs.onRemoved.addListener(handleRemoved);
      chrome.tabs.create({ url: startUrl, active: true }, (tab) => {
        const err = chrome.runtime?.lastError;
        if (err) {
          finishError(new Error(String(err.message || err)));
          return;
        }
        authTabId = tab?.id ?? null;
        if (!Number.isInteger(authTabId)) {
          finishError(new Error("Could not open Google login tab"));
        }
      });
    });
  }

  function setActionIconForTab(tabId, isColor) {
    try {
      if (!chrome?.action?.setIcon) return;
      if (!Number.isInteger(tabId)) return;
      if (lastToolbarIconColorByTabId.get(tabId) === isColor) return;
      const path = isColor ? ACTION_ICON_COLOR : ACTION_ICON_GRAY;
      const runtimePath = chrome.runtime?.getURL
        ? {
            16: chrome.runtime.getURL(path[16]),
            32: chrome.runtime.getURL(path[32])
          }
        : null;
      const variants = [{ tabId, path }];
      if (runtimePath) variants.push({ tabId, path: runtimePath });

      let idx = 0;
      const tryNext = () => {
        if (idx >= variants.length) {
          lastToolbarIconColorByTabId.delete(tabId);
          return;
        }
        const details = variants[idx];
        idx += 1;
        chrome.action.setIcon(details, () => {
          const err = chrome.runtime?.lastError;
          if (err) {
            tryNext();
            return;
          }
          lastToolbarIconColorByTabId.set(tabId, isColor);
        });
      };
      tryNext();
    } catch {}
  }

  function refreshActionIconByTab(tabId, tabObj) {
    const directUrl = String(tabObj?.url || tabObj?.pendingUrl || "");
    if (directUrl) {
      setActionIconForTab(tabId, isAutodartsUrl(directUrl));
      return;
    }
    if (!chrome?.tabs?.get || !Number.isInteger(tabId)) {
      setActionIconForTab(tabId, false);
      return;
    }
    chrome.tabs.get(tabId, (resolvedTab) => {
      const err = chrome.runtime?.lastError;
      if (err) {
        setActionIconForTab(tabId, false);
        return;
      }
      const resolvedUrl = String(resolvedTab?.url || resolvedTab?.pendingUrl || "");
      setActionIconForTab(tabId, isAutodartsUrl(resolvedUrl));
    });
  }

  /**
   * Öffnet DevTools für den eigenen MV3-Service-Worker (Target.openDevTools über Browser-Target).
   * Fallback: chrome://inspect → chrome://extensions (jeweils neuer Tab).
   */
  async function openExtensionServiceWorkerDevTools() {
    const extId = chrome.runtime.id;
    const tryOpenUrl = (url) =>
      new Promise((resolve) => {
        if (!chrome.tabs?.create) {
          resolve(false);
          return;
        }
        chrome.tabs.create({ url, active: true }, () => {
          resolve(!chrome.runtime.lastError);
        });
      });

    let targets = [];
    if (chrome.debugger?.getTargets) {
      try {
        targets = await chrome.debugger.getTargets();
      } catch {
        targets = [];
      }
    }

    const prefix = `chrome-extension://${extId}/`;
    const swTarget =
      targets.find(
        (t) =>
          typeof t.url === "string" &&
          t.url.startsWith(prefix) &&
          (String(t.type || "").toLowerCase() === "service_worker" ||
            t.type === "worker" ||
            t.type === "background_page")
      ) || targets.find((t) => typeof t.url === "string" && t.url.startsWith(prefix));

    let browserTarget = targets.find((t) => String(t.type || "").toLowerCase() === "browser");
    if (!browserTarget) {
      browserTarget = targets.find(
        (t) => String(t.type || "").toLowerCase() === "tab" && String(t.url || "").startsWith("chrome://")
      );
    }

    if (swTarget?.id && browserTarget?.id && chrome.debugger?.attach && chrome.debugger?.sendCommand) {
      try {
        await chrome.debugger.attach({ targetId: browserTarget.id }, "1.3");
        try {
          await chrome.debugger.sendCommand(
            { targetId: browserTarget.id },
            "Target.openDevTools",
            { targetId: swTarget.id, panelId: "console" }
          );
          return { ok: true, method: "openDevTools" };
        } catch (e) {
          logInfo("system", "Target.openDevTools failed", { error: String(e?.message || e) });
        } finally {
          try {
            await chrome.debugger.detach({ targetId: browserTarget.id });
          } catch {}
        }
      } catch (e) {
        logInfo("system", "debugger attach (browser) failed", { error: String(e?.message || e) });
      }
    }

    if (await tryOpenUrl("chrome://inspect/#workers")) {
      return { ok: true, method: "inspect_workers" };
    }
    if (await tryOpenUrl("chrome://inspect/#service-workers")) {
      return { ok: true, method: "inspect_service_workers" };
    }
    if (await tryOpenUrl(`chrome://extensions/?id=${encodeURIComponent(extId)}`)) {
      return { ok: true, method: "extensions" };
    }
    return { ok: false, error: "no_tab_opened" };
  }

  /**
   * Galerie-Screenshot: mehrere `captureVisibleTab`-Versuche (Paint nach Tab-Wechsel),
   * optional PNG, danach CDP `Page.captureScreenshot` (Manifest hat `debugger`).
   */
  async function captureGalleryThumbnailViaExtension(sender, quality) {
    const tabId = sender.tab?.id;
    const windowId = sender.tab?.windowId;
    if (!Number.isInteger(tabId) || !Number.isInteger(windowId)) {
      return { ok: false, error: "no_sender_tab" };
    }
    const q = Number.isFinite(Number(quality))
      ? Math.min(95, Math.max(50, Math.round(Number(quality))))
      : 82;

    const captureOnce = (winId, opts) =>
      new Promise((resolve) => {
        try {
          chrome.tabs.captureVisibleTab(winId, opts, (url) => {
            const err = chrome.runtime.lastError;
            const dataUrl = String(url || "").trim();
            resolve({
              ok: !err && !!dataUrl && dataUrl.startsWith("data:image/"),
              dataUrl,
              err: err ? String(err.message || err) : dataUrl ? "" : "no_url"
            });
          });
        } catch (e) {
          resolve({ ok: false, dataUrl: "", err: String(e?.message || e) });
        }
      });

    await new Promise((resolve) => {
      chrome.windows.update(windowId, { focused: true }, () => {
        void chrome.runtime.lastError;
        resolve();
      });
    });
    await new Promise((resolve) => {
      chrome.tabs.update(tabId, { active: true }, () => {
        void chrome.runtime.lastError;
        resolve();
      });
    });

    let lastErr = "empty_capture";
    for (const delayMs of [520, 420, 600]) {
      await new Promise((r) => setTimeout(r, delayMs));
      const r = await captureOnce(windowId, { format: "jpeg", quality: q });
      if (r.ok) return { ok: true, dataUrl: r.dataUrl };
      lastErr = r.err || "jpeg_failed";
    }

    await new Promise((r) => setTimeout(r, 220));
    const png = await captureOnce(windowId, { format: "png" });
    if (png.ok && png.dataUrl.startsWith("data:image/png")) {
      return { ok: true, dataUrl: png.dataUrl };
    }
    lastErr = png.err || lastErr;

    if (chrome.debugger?.attach && chrome.debugger?.sendCommand && chrome.debugger?.detach) {
      let attached = false;
      try {
        await new Promise((resolve, reject) => {
          chrome.debugger.attach({ tabId }, "1.3", () => {
            const err = chrome.runtime.lastError;
            if (err) reject(new Error(String(err.message || err)));
            else {
              attached = true;
              resolve();
            }
          });
        });
        const shot = await new Promise((resolve, reject) => {
          chrome.debugger.sendCommand(
            { tabId },
            "Page.captureScreenshot",
            {
              format: "jpeg",
              quality: q,
              captureBeyondViewport: false,
              fromSurface: true
            },
            (result) => {
              const err = chrome.runtime.lastError;
              if (err) reject(new Error(String(err.message || err)));
              else resolve(result);
            }
          );
        });
        if (shot?.data) {
          return { ok: true, dataUrl: `data:image/jpeg;base64,${shot.data}` };
        }
        lastErr = "debugger_no_data";
      } catch (e) {
        lastErr = String(e?.message || e || "debugger_failed");
      } finally {
        if (attached) {
          await new Promise((resolve) => {
            chrome.debugger.detach({ tabId }, () => {
              void chrome.runtime.lastError;
              resolve();
            });
          });
        }
      }
    }

    logInfo("themes", "gallery capture exhausted", { tabId, lastErr });
    return { ok: false, error: lastErr };
  }

  function tabUrlLooksLikeAutodartsMatchPlay(url) {
    try {
      const u = new URL(String(url || ""));
      const host = u.hostname.toLowerCase();
      if (host !== "play.autodarts.io" && !host.endsWith(".play.autodarts.io")) return false;
      return /\/matches\//i.test(u.pathname || "");
    } catch {
      return false;
    }
  }

  function findAutodartsMatchTabId() {
    return new Promise((resolve) => {
      try {
        chrome.tabs.query({}, (all) => {
          const err = chrome.runtime?.lastError;
          if (err) {
            resolve(null);
            return;
          }
          const tabs = Array.isArray(all) ? all : [];
          const matchTabs = tabs.filter((t) => tabUrlLooksLikeAutodartsMatchPlay(t.url));
          if (!matchTabs.length) {
            resolve(null);
            return;
          }
          chrome.tabs.query({ active: true, lastFocusedWindow: true }, (focused) => {
            const fe = chrome.runtime?.lastError;
            const fTab = !fe && Array.isArray(focused) ? focused[0] : null;
            const fid = fTab?.id;
            const fav = fTab?.url || "";
            if (Number.isInteger(fid) && tabUrlLooksLikeAutodartsMatchPlay(fav)) {
              const exact = matchTabs.find((x) => x.id === fid);
              if (exact) {
                resolve(exact.id);
                return;
              }
            }
            resolve(matchTabs[0].id ?? null);
          });
        });
      } catch {
        resolve(null);
      }
    });
  }

  function tabUrlLooksLikeAutodartsStatistics(url) {
    try {
      const u = new URL(String(url || ""));
      const host = u.hostname.toLowerCase();
      const okHost =
        host === "play.autodarts.io" ||
        host.endsWith(".play.autodarts.io") ||
        host === "autodarts.io" ||
        host.endsWith(".autodarts.io");
      if (!okHost) return false;
      const path = String(u.pathname || "") + String(u.hash || "");
      return /\bstatistics\b/i.test(path);
    } catch {
      return false;
    }
  }

  function findAutodartsStatisticsTabId() {
    return new Promise((resolve) => {
      try {
        chrome.tabs.query({}, (all) => {
          const err = chrome.runtime?.lastError;
          if (err) {
            resolve(null);
            return;
          }
          const tabs = Array.isArray(all) ? all : [];
          const statTabs = tabs.filter((t) => tabUrlLooksLikeAutodartsStatistics(t.url));
          if (!statTabs.length) {
            resolve(null);
            return;
          }
          chrome.tabs.query({ active: true, lastFocusedWindow: true }, (focused) => {
            const fe = chrome.runtime?.lastError;
            const fTab = !fe && Array.isArray(focused) ? focused[0] : null;
            const fid = fTab?.id;
            const fav = fTab?.url || "";
            if (Number.isInteger(fid) && tabUrlLooksLikeAutodartsStatistics(fav)) {
              const exact = statTabs.find((x) => x.id === fid);
              if (exact) {
                resolve(exact.id);
                return;
              }
            }
            resolve(statTabs[0].id ?? null);
          });
        });
      } catch {
        resolve(null);
      }
    });
  }

  function bindMessageListener() {
    if (listenersBound) return;
    listenersBound = true;

    if (chrome?.tabs?.onRemoved?.addListener) {
      chrome.tabs.onRemoved.addListener((tabId) => {
        websiteThemeCssByTabId.delete(tabId);
        lastToolbarIconColorByTabId.delete(tabId);
      });
    }
    if (chrome?.tabs?.onUpdated?.addListener) {
      chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
        if (changeInfo?.status === "loading") {
          websiteThemeCssByTabId.delete(tabId);
        }
        // Nur bei URL-Wechsel oder abgeschlossenem Load — nicht bei jedem `loading`-Tick (weniger setIcon-Aufrufe).
        if (changeInfo?.url || changeInfo?.status === "complete") {
          const tabLike = (changeInfo?.url || tab?.url || tab?.pendingUrl)
            ? { ...(tab || {}), url: changeInfo?.url || tab?.url || tab?.pendingUrl }
            : tab;
          refreshActionIconByTab(tabId, tabLike);
        }
      });
    }
    if (chrome?.tabs?.onCreated?.addListener) {
      chrome.tabs.onCreated.addListener((tab) => {
        const tabId = tab?.id;
        if (!Number.isInteger(tabId)) return;
        refreshActionIconByTab(tabId, tab);
      });
    }
    if (chrome?.tabs?.onActivated?.addListener) {
      chrome.tabs.onActivated.addListener((activeInfo) => {
        const tabId = activeInfo?.tabId;
        if (!Number.isInteger(tabId) || !chrome?.tabs?.get) return;
        chrome.tabs.get(tabId, (tab) => {
          if (chrome.runtime?.lastError) {
            setActionIconForTab(tabId, false);
            return;
          }
          refreshActionIconByTab(tabId, tab);
        });
      });
    }
    if (chrome?.tabs?.query) {
      const refreshFocusedTabIcon = () => {
        chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
          if (chrome.runtime?.lastError) {
            return;
          }
          const tab = Array.isArray(tabs) ? tabs[0] : null;
          if (!tab || !Number.isInteger(tab.id)) {
            return;
          }
          refreshActionIconByTab(tab.id, tab);
        });
      };
      refreshFocusedTabIcon();
      /** Nach TAB/Fenster-Wechsel (MV3-SW neu): Icon neu an aktive URL koppeln. */
      if (chrome?.windows?.onFocusChanged?.addListener) {
        chrome.windows.onFocusChanged.addListener((windowId) => {
          if (windowId === chrome.windows.WINDOW_ID_NONE) return;
          refreshFocusedTabIcon();
        });
      }
    }

    function removeCss(tabId, css) {
      return new Promise((resolve, reject) => {
        try {
          chrome.scripting.removeCSS(
            { target: { tabId }, css },
            () => {
              const err = chrome.runtime?.lastError;
              if (err) reject(err);
              else resolve(true);
            }
          );
        } catch (e) {
          reject(e);
        }
      });
    }

    function insertCss(tabId, css) {
      return new Promise((resolve, reject) => {
        try {
          chrome.scripting.insertCSS(
            { target: { tabId }, css },
            () => {
              const err = chrome.runtime?.lastError;
              if (err) reject(err);
              else resolve(true);
            }
          );
        } catch (e) {
          reject(e);
        }
      });
    }

    async function applyWebsiteThemeCssForTab(tabId, cssText) {
      const nextCss = String(cssText || "");
      const prevCss = websiteThemeCssByTabId.get(tabId) || "";

      if (prevCss && prevCss !== nextCss) {
        try { await removeCss(tabId, prevCss); } catch {}
      }

      if (!nextCss) {
        websiteThemeCssByTabId.delete(tabId);
        return;
      }

      if (prevCss === nextCss) return;
      await insertCss(tabId, nextCss);
      websiteThemeCssByTabId.set(tabId, nextCss);
    }

    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      (async () => {
        try {
          const settings = ADM.getSettings();

          if (msg?.type === "OPEN_SERVICE_WORKER_DEVTOOLS") {
            const result = await openExtensionServiceWorkerDevTools();
            sendResponse(result);
            return;
          }

          if (msg?.type === "GET_WORKER_MIRROR_DELTA") {
            const afterId = Number(msg?.afterId);
            const snap = ADM.workerMirrorLog?.getSince?.(Number.isFinite(afterId) ? afterId : -1);
            sendResponse({ ok: true, ...(snap || { lines: [], lastId: -1, truncated: false }) });
            return;
          }

          if (msg?.type === "CLEAR_WORKER_MIRROR_LOG") {
            ADM.workerMirrorLog?.clear?.();
            sendResponse({ ok: true });
            return;
          }

          if (msg?.type === "GET_SETTINGS") {
            sendResponse({ ok: true, settings });
            return;
          }

          if (msg?.type === "ADM_GALLERY_THUMB_PUT") {
            const ref = String(msg?.ref || "").trim();
            const dataUrl = String(msg?.dataUrl || "").trim();
            if (!ref || !dataUrl.startsWith("data:image/")) {
              sendResponse({ ok: false, error: "bad_args" });
              return;
            }
            try {
              await ADM.galleryThumbStore?.put?.(ref, dataUrl);
              sendResponse({ ok: true });
            } catch (e) {
              sendResponse({ ok: false, error: String(e?.message || e) });
            }
            return;
          }

          if (msg?.type === "ADM_GALLERY_THUMB_GET") {
            const ref = String(msg?.ref || "").trim();
            if (!ref) {
              sendResponse({ ok: false, error: "bad_ref" });
              return;
            }
            try {
              const dataUrl = await ADM.galleryThumbStore?.get?.(ref);
              if (dataUrl && dataUrl.startsWith("data:image/")) sendResponse({ ok: true, dataUrl });
              else sendResponse({ ok: false, error: "missing" });
            } catch (e) {
              sendResponse({ ok: false, error: String(e?.message || e) });
            }
            return;
          }

          if (msg?.type === "ADM_GALLERY_THUMB_DELETE") {
            const ref = String(msg?.ref || "").trim();
            if (!ref) {
              sendResponse({ ok: false, error: "bad_ref" });
              return;
            }
            try {
              await ADM.galleryThumbStore?.delete?.(ref);
              sendResponse({ ok: true });
            } catch (e) {
              sendResponse({ ok: false, error: String(e?.message || e) });
            }
            return;
          }

          if (msg?.type === "ADM_CAPTURE_VISIBLE_TAB_JPEG") {
            const rawQ = Number(msg?.quality);
            const quality = Number.isFinite(rawQ) ? Math.min(95, Math.max(50, Math.round(rawQ))) : 82;
            const out = await captureGalleryThumbnailViaExtension(sender, quality);
            if (out.ok && out.dataUrl) sendResponse({ ok: true, dataUrl: out.dataUrl });
            else sendResponse({ ok: false, error: String(out.error || "capture_failed") });
            return;
          }

          if (msg?.type === "ADM_REQUEST_STYLEBOT_THUMB_CAPTURE") {
            const packUrl = String(msg?.packUrl || "").trim();
            const layout =
              String(msg?.layout || "horizontal").toLowerCase() === "vertical" ? "vertical" : "horizontal";
            const themeId = String(msg?.themeId || "").trim().toLowerCase();
            if (!packUrl || !themeId) {
              sendResponse({ ok: false, error: "bad_args" });
              return;
            }
            const tabId = await findAutodartsMatchTabId();
            if (!Number.isInteger(tabId)) {
              sendResponse({ ok: false, error: "no_match_tab" });
              return;
            }
            const reply = await new Promise((resolve) => {
              try {
                chrome.tabs.sendMessage(
                  tabId,
                  { type: "ADM_DO_STYLEBOT_THUMB_CAPTURE", packUrl, layout, themeId },
                  (res) => {
                    const err = chrome.runtime.lastError;
                    if (err) resolve({ ok: false, error: `tab:${String(err.message || err)}` });
                    else resolve(res && typeof res === "object" ? res : { ok: false, error: "bad_tab_reply" });
                  }
                );
              } catch (e) {
                resolve({ ok: false, error: String(e?.message || e) });
              }
            });
            sendResponse(reply);
            return;
          }

          if (msg?.type === "SET_SETTINGS") {
            const updated = await ADM.setSettings(msg.settings || {});
            ADM.refreshRuntimeConnections?.();
            try {
              ADM.overlay?.afterSettingsSaved?.();
            } catch {}
            logInfo("system", "settings updated", {
              keys: Object.keys(msg.settings || {})
            });
            sendResponse({ ok: true, settings: updated });
            return;
          }

          if (msg?.type === "SB_TEST") {
            const ok = await ADM.connectOnceForTest(settings.sbUrl, settings.sbPassword);
            logInfo("sb", "connection test", { url: settings.sbUrl, ok });
            sendResponse({ ok });
            return;
          }

          if (msg?.type === "GET_SB_STATUS") {
            sendResponse({ ok: true, status: ADM.getSBStatus?.() || { state: "unknown" } });
            return;
          }

          if (msg?.type === "SB_GET_ACTIONS") {
            const r = await ADM.requestGetActions?.(Number(msg?.timeoutMs) || 4000);
            if (r?.ok) {
              sendResponse({ ok: true, actions: Array.isArray(r.actions) ? r.actions : [] });
            } else {
              sendResponse({ ok: false, error: String(r?.error || "sb_get_actions_failed"), actions: [] });
            }
            return;
          }

          if (msg?.type === "GET_OBS_STATUS") {
            sendResponse({ ok: true, status: ADM.getObsStatus?.() || { state: "unknown" } });
            return;
          }

          if (msg?.type === "START_GOOGLE_AUTH") {
            const result = await startGoogleAuthFlow(msg?.baseUrl || settings.websiteApiUrl);
            sendResponse({ ok: true, ...result, settings: ADM.getSettings() });
            return;
          }

          if (msg?.type === "OBS_TEST") {
            const ok = await ADM.retryObsConnection?.();
            logInfo("system", "obs test", { url: settings.obsUrl, ok });
            sendResponse({ ok });
            return;
          }

          if (msg?.type === "SB_RETRY") {
            ADM.retrySBConnection?.();
            sendResponse({ ok: true });
            return;
          }

          if (msg?.type === "OBS_RETRY") {
            const ok = await ADM.retryObsConnection?.();
            sendResponse({ ok: !!ok });
            return;
          }

          if (msg?.type === "OBS_GET_SCENES") {
            const scenes = await ADM.getObsScenes?.();
            sendResponse({ ok: true, scenes });
            return;
          }

          if (msg?.type === "OBS_GET_SCENE_SOURCES") {
            const sources = await ADM.getObsSceneSources?.(msg?.sceneName);
            sendResponse({ ok: true, sources });
            return;
          }

          if (msg?.type === "OBS_CREATE_MOVE_FILTERS") {
            const result = await ADM.createObsMoveFilters?.(msg?.sceneName, msg?.sourceName, {
              mode: msg?.mode,
              duration: msg?.duration,
              easing: msg?.easing,
              easingFunction: msg?.easingFunction,
              includeSingles: msg?.includeSingles,
              includeDoubles: msg?.includeDoubles,
              includeTriples: msg?.includeTriples
            });
            sendResponse({ ok: true, ...result });
            return;
          }

          if (msg?.type === "OBS_GET_SOURCE_SCREENSHOT") {
            try {
              const prog = msg?.mode === "program" || msg?.canvas === true;
              const shot = prog
                ? await ADM.getObsProgramCanvasScreenshot?.({
                    ...msg?.options,
                    fallbackSceneName: settings?.obsZoomSceneName
                  })
                : await ADM.getObsSourceScreenshot?.(msg?.sourceName, msg?.options || {});
              sendResponse({ ok: true, ...shot });
            } catch (e) {
              sendResponse({ ok: false, error: String(e?.message || e || "obs_get_source_screenshot_failed") });
            }
            return;
          }

          if (msg?.type === "OBS_GET_VIDEO_BASE") {
            try {
              const dims = await ADM.getObsVideoBaseResolution?.();
              sendResponse({ ok: true, ...dims });
            } catch (e) {
              sendResponse({ ok: false, error: String(e?.message || e || "obs_get_video_base_failed") });
            }
            return;
          }

          if (msg?.type === "OBS_DELETE_MOVE_FILTERS") {
            const result = await ADM.deleteObsMoveFilters?.(msg?.sceneName, {
              includeSingles: msg?.includeSingles,
              includeDoubles: msg?.includeDoubles,
              includeTriples: msg?.includeTriples
            });
            sendResponse({ ok: true, ...result });
            return;
          }

          if (msg?.type === "OBS_EXPORT_MOVE_FILTER_BACKUP") {
            const result = await ADM.getObsMoveFilterBackup?.(msg?.sceneName);
            sendResponse({ ok: true, ...result });
            return;
          }

          if (msg?.type === "OBS_EXPORT_MOVE_FILTER_SETTINGS") {
            try {
              const payload = await ADM.exportObsMoveFilterSettings?.(msg?.sceneName);
              sendResponse({ ok: true, payload });
            } catch (e) {
              sendResponse({ ok: false, error: String(e?.message || e || "obs_export_move_filter_settings_failed") });
            }
            return;
          }

          if (msg?.type === "OBS_IMPORT_MOVE_FILTER_SETTINGS") {
            try {
              const result = await ADM.importObsMoveFilterSettings?.(msg?.doc);
              sendResponse({ ok: true, ...result });
            } catch (e) {
              sendResponse({ ok: false, error: String(e?.message || e || "obs_import_move_filter_settings_failed") });
            }
            return;
          }

          if (msg?.type === "OBS_IMPORT_MOVE_FILTER_BACKUP") {
            const result = await ADM.importObsMoveFilterBackup?.(msg?.backup);
            sendResponse({ ok: true, ...result });
            return;
          }

          if (msg?.type === "OBS_ZOOM_TRIGGER_TEST") {
            const result = await ADM.obsZoom?.triggerTestInput?.(msg?.trigger, msg?.payload || {});
            sendResponse({ ok: !!result?.ok, ...(result || {}) });
            return;
          }

          if (msg?.type === "GET_OVERLAY_STATE") {
            sendResponse({ ok: true, payload: ADM.overlay.getState() });
            return;
          }

          if (msg?.type === "GET_CAPTURED_DATA") {
            sendResponse({ ok: true, payload: ADM.capture?.getSnapshot?.() || null });
            return;
          }

          if (msg?.type === "GET_ADM_DOM_PLAY_STATS") {
            try {
              const tabId = await findAutodartsMatchTabId();
              if (!Number.isInteger(tabId)) {
                sendResponse({ ok: false, error: "no_match_tab", payload: null });
                return;
              }
              const execRes = await chrome.scripting.executeScript({
                target: { tabId },
                world: "MAIN",
                func: () => {
                  try {
                    const w = typeof window !== "undefined" ? window : {};
                    return {
                      snap: w.__ADM_DOM_PLAY_SNAPSHOT__ && typeof w.__ADM_DOM_PLAY_SNAPSHOT__ === "object"
                        ? w.__ADM_DOM_PLAY_SNAPSHOT__
                        : null,
                      at:
                        typeof w.__ADM_DOM_PLAY_SNAPSHOT_AT__ === "number" && Number.isFinite(w.__ADM_DOM_PLAY_SNAPSHOT_AT__)
                          ? w.__ADM_DOM_PLAY_SNAPSHOT_AT__
                          : null
                    };
                  } catch (e) {
                    return { snap: null, at: null, readError: String(e?.message || e) };
                  }
                }
              });
              const r = execRes?.[0]?.result;
              sendResponse({
                ok: true,
                payload: r && typeof r === "object" ? r : { snap: null, at: null }
              });
            } catch (e) {
              sendResponse({ ok: false, error: String(e?.message || e), payload: null });
            }
            return;
          }

          if (msg?.type === "GET_ADM_STATISTICS_PAGE_SNAPSHOT") {
            try {
              const tabId = await findAutodartsStatisticsTabId();
              if (!Number.isInteger(tabId)) {
                sendResponse({ ok: false, error: "no_statistics_tab", payload: null });
                return;
              }
              const execRes = await chrome.scripting.executeScript({
                target: { tabId },
                world: "MAIN",
                func: () => {
                  function norm(s) {
                    return String(s || "")
                      .replace(/\u00a0/g, " ")
                      .replace(/\s+/g, " ")
                      .trim();
                  }
                  /** KPI-Zeilen: Label + mindestens ein direktes Kind-<span> (Wert = letztes Span, wie Chakra/Recharts-Karten). */
                  function readKpiPairsFromScope(scope) {
                    const out = {};
                    if (!scope || !scope.querySelectorAll) return out;
                    const ps = scope.querySelectorAll("p");
                    for (let i = 0; i < ps.length; i += 1) {
                      const p = ps[i];
                      if (p.closest && (p.closest('[role="menu"]') || p.closest(".chakra-menu__menu-list"))) continue;
                      const spanKids = Array.from(p.children || []).filter(function (c) {
                        return c && String(c.tagName || "").toLowerCase() === "span";
                      });
                      if (!spanKids.length) continue;
                      const valSpan = spanKids[spanKids.length - 1];
                      const val = norm(valSpan.textContent || "");
                      if (!val) continue;
                      let label = "";
                      const nodes = p.childNodes;
                      for (let j = 0; j < nodes.length; j += 1) {
                        const ch = nodes[j];
                        if (ch === valSpan) break;
                        if (ch.nodeType === 3) label += ch.textContent || "";
                        else if (ch.nodeType === 1) {
                          const tg = String(ch.tagName || "").toLowerCase();
                          if (tg === "span") label += norm(ch.textContent || "") + " ";
                          else if (tg !== "script" && tg !== "style") label += norm(ch.textContent || "") + " ";
                        }
                      }
                      label = norm(label);
                      if (!label) continue;
                      if (label.length > 180 || val.length > 180) continue;
                      if (label.length < 2) continue;
                      out[label] = val;
                    }
                    return out;
                  }
                  function mergeKpiMaps(target, add) {
                    const a = add && typeof add === "object" ? add : {};
                    const ks = Object.keys(a);
                    for (let i = 0; i < ks.length; i += 1) {
                      target[ks[i]] = a[ks[i]];
                    }
                    return target;
                  }
                  try {
                    const root = document.getElementById("root");
                    if (!root) {
                      return {
                        ok: false,
                        error: "no_root",
                        metrics: {},
                        capturedAt: Date.now(),
                        url: String(location.href || ""),
                        scrapeDebug: { reason: "no_root" }
                      };
                    }
                    const metrics = {};
                    const panels = root.querySelectorAll('[role="tabpanel"]:not([hidden])');
                    let usedPanels = 0;
                    if (panels && panels.length) {
                      for (let pi = 0; pi < panels.length; pi += 1) {
                        const part = readKpiPairsFromScope(panels[pi]);
                        if (Object.keys(part).length) usedPanels += 1;
                        mergeKpiMaps(metrics, part);
                      }
                    }
                    if (Object.keys(metrics).length < 4) {
                      const cards = root.querySelectorAll("[class*='chakra-card']");
                      const maxC = Math.min(cards.length, 16);
                      for (let ci = 0; ci < maxC; ci += 1) {
                        mergeKpiMaps(metrics, readKpiPairsFromScope(cards[ci]));
                      }
                    }
                    if (Object.keys(metrics).length < 4) {
                      mergeKpiMaps(metrics, readKpiPairsFromScope(root));
                    }
                    const scrapeDebug = {
                      panelCount: panels ? panels.length : 0,
                      usedPanels: usedPanels,
                      metricKeys: Object.keys(metrics).length
                    };
                    return {
                      ok: true,
                      capturedAt: Date.now(),
                      url: String(location.href || ""),
                      metrics,
                      scrapeDebug
                    };
                  } catch (e) {
                    return {
                      ok: false,
                      error: String(e?.message || e),
                      metrics: {},
                      capturedAt: Date.now(),
                      url: String(location.href || ""),
                      scrapeDebug: { error: String(e?.message || e) }
                    };
                  }
                }
              });
              const r = execRes?.[0]?.result;
              if (!r || typeof r !== "object") {
                sendResponse({ ok: false, error: "empty_result", payload: null });
                return;
              }
              if (r.ok === false) {
                sendResponse({ ok: false, error: String(r.error || "scrape_failed"), payload: r });
                return;
              }
              try {
                const n = r.metrics && typeof r.metrics === "object" ? Object.keys(r.metrics).length : 0;
                if (!n) {
                  logInfo("stats", "statistics scrape returned no KPI rows", {
                    tabId,
                    url: r.url,
                    scrapeDebug: r.scrapeDebug || null
                  });
                }
              } catch {
                // ignore
              }
              sendResponse({ ok: true, payload: r });
            } catch (e) {
              sendResponse({ ok: false, error: String(e?.message || e), payload: null });
            }
            return;
          }

          if (msg?.type === "GET_WLED_PRESETS") {
            try {
              const presets = await ADM.wled?.fetchPresets?.(msg?.endpoint);
              const epKey = String(msg?.endpoint || "").trim() || "?";
              const cnt = Array.isArray(presets) ? presets.length : 0;
              const now = Date.now();
              const prevLog = lastWledPresetMirrorLogByEndpoint.get(epKey);
              const shouldMirrorLog = !prevLog || prevLog.count !== cnt || (now - prevLog.ts) > 60000;
              if (shouldMirrorLog) {
                logInfo("wled", "presets loaded", {
                  endpoint: msg?.endpoint || "",
                  count: cnt
                });
                lastWledPresetMirrorLogByEndpoint.set(epKey, { ts: now, count: cnt });
                try {
                  ADM.workerModuleStatusLog?.wled?.(true, msg?.endpoint);
                } catch {
                  // ignore
                }
              }
              sendResponse({ ok: true, presets: Array.isArray(presets) ? presets : [] });
              return;
            } catch (e) {
              try {
                ADM.workerModuleStatusLog?.wled?.(false, msg?.endpoint);
              } catch {
                // ignore
              }
              logError("wled", "presets fetch failed", {
                endpoint: msg?.endpoint || "",
                error: String(e?.message || e)
              });
              sendResponse({ ok: false, error: String(e?.message || e), presets: [] });
              return;
            }
          }

          if (msg?.type === "TRIGGER_WLED_PRESET") {
            try {
              await ADM.wled?.triggerPreset?.(msg?.endpoint, msg?.presetId);
              logInfo("wled", "preset trigger requested", {
                endpoint: msg?.endpoint || "",
                presetId: msg?.presetId ?? null
              });
              sendResponse({ ok: true });
              return;
            } catch (e) {
              try {
                ADM.workerModuleStatusLog?.wled?.(false, msg?.endpoint);
              } catch {
                // ignore
              }
              logError("wled", "preset trigger failed", {
                endpoint: msg?.endpoint || "",
                presetId: msg?.presetId ?? null,
                error: String(e?.message || e)
              });
              sendResponse({ ok: false, error: String(e?.message || e) });
              return;
            }
          }

          if (msg?.type === "WLED_TEST_JSON_STATE") {
            try {
              const r = await ADM.wled?.fetchJsonStateProbe?.(msg?.endpoint);
              sendResponse(r && typeof r === "object" ? r : { ok: false, error: "probe_failed" });
            } catch (e) {
              sendResponse({ ok: false, error: String(e?.message || e) });
            }
            return;
          }

          if (msg?.type === "WLED_TEST_MATRIX") {
            try {
              const r = await ADM.wled?.runWledMatrixTest?.(msg?.payload || {});
              sendResponse({ ok: !!(r && r.ok), ...(r && typeof r === "object" ? r : {}) });
            } catch (e) {
              sendResponse({ ok: false, error: String(e?.message || e) });
            }
            return;
          }

          if (msg?.type === "TRIGGER_WLED_TARGETS") {
            try {
              await ADM.wled?.triggerTargets?.(msg?.targets, settings, msg?.advancedJson || "");
              const lm = msg?.wledLogMeta;
              if (lm && typeof lm === "object") {
                try {
                  ADM.triggerWorkerLog?.printAdmWledEffectLine?.({
                    effectName: String(lm.effectName || "").trim() || "WLED",
                    triggerUnit: String(lm.triggerUnit || "").trim() || "Test",
                    presetSummary: String(lm.presetSummary || "").trim() || "—"
                  });
                } catch {
                  // ignore
                }
              }
              sendResponse({ ok: true });
              return;
            } catch (e) {
              logError("wled", "wled targets trigger failed", {
                error: String(e?.message || e)
              });
              sendResponse({ ok: false, error: String(e?.message || e) });
              return;
            }
          }

          if (msg?.type === "AUTODARTS_TAB_ACTIVE") {
            const tabId = sender?.tab?.id;
            /**
             * Content-Script ist nur auf https://play.autodarts.io/* registriert — keine URL-Prüfung:
             * `sender.tab.url` ist während Laden oft `about:blank` / veraltet, dann blieb das Icon grau.
             */
            if (Number.isInteger(tabId)) {
              setActionIconForTab(tabId, true);
            }
            sendResponse({ ok: true });
            return;
          }

          if (msg?.type === "AUTODARTS_NAVIGATION") {
            ADM.admTriggers?.handleNavigation?.(msg.payload);
            sendResponse({ ok: true });
            return;
          }

          if (msg?.type === "CLEAR_CAPTURED_DATA") {
            await ADM.capture?.clear?.();
            sendResponse({ ok: true });
            return;
          }

          if (msg?.type === "GET_DEBUG_LOGS") {
            sendResponse({ ok: true, logs: ADM.logger?.getAll?.({ days: msg?.days }) || {} });
            return;
          }

          if (msg?.type === "APPLY_WEBSITE_THEME_CSS") {
            const tabId = sender?.tab?.id;
            if (!Number.isInteger(tabId)) {
              sendResponse({ ok: false, error: "no sender tab id" });
              return;
            }
            await applyWebsiteThemeCssForTab(tabId, msg?.css || "");
            sendResponse({ ok: true });
            return;
          }

          if (msg?.type === "CLEAR_DEBUG_LOGS") {
            await ADM.logger?.clearAll?.();
            sendResponse({ ok: true });
            return;
          }

          if (msg?.type === "AUTODARTS_EVENT") {
            const e = msg.payload;
            if (e?.type === "match_context") {
              ADM.applyMatchContextFromPage?.(e);
              sendResponse({ ok: true });
              return;
            }
            if (!e?.type) {
              sendResponse({ ok: true, skipped: true });
              return;
            }
            ADM.capture?.ingestEvent?.(e);

            const logGame = true;
            const logThrow = logGame;
            const logState = logGame;
            const logBoardEv = logGame;
            if (e.type === "throw") {
              if (logThrow) {
                logInfo("throws", "throw event", {
                  player: e.player ?? null,
                  playerName: e.playerName ?? null,
                  score: e.score ?? null,
                  segment: e.segment ?? null,
                  multiplier: e.multiplier ?? null,
                  number: e.number ?? null
                });
              }
            } else if (e.type === "state") {
              updatePlayerNameCacheFromState(e);
              const stateIdx = asValidPlayerIndex(e.player);
              if (stateIdx !== null) lastActivePlayerIndex = stateIdx;
              if (logState) {
                logInfo("state", "state event", {
                  matchId: e.matchId ?? null,
                  player: e.player ?? null,
                  round: e.round ?? null,
                  set: e.set ?? null,
                  leg: e.leg ?? null,
                  turnBusted: !!e.turnBusted,
                  gameFinished: !!e.gameFinished,
                  winner: e.winner ?? null,
                  checkoutGuide: e.checkoutGuide ?? null,
                  playerScores: Array.isArray(e.playerScores) ? e.playerScores : null
                });
              }
            } else if (e.type === "event") {
              if (logBoardEv) {
                logInfo("events", "game event", {
                  event: e.event ?? "unknown",
                  matchId: e.matchId ?? null,
                  set: e.set ?? null,
                  leg: e.leg ?? null,
                  player: e.player ?? null
                });
              }
            }

            if (e.type === "throw") ADM.admTriggers?.handleThrow?.(e);
            else if (e.type === "state") ADM.admTriggers?.handleState?.(e);
            else if (e.type === "event") ADM.admTriggers?.handleGameEvent?.(e);

            sendResponse({ ok: true });
            return;
          }

          if (msg?.type === "AUTODARTS_UI_EVENT") {
            logInfo("ui", "ui event", {
              kind: msg?.payload?.kind ?? "unknown"
            });
            ADM.capture?.ingestUi?.(msg.payload);

            ADM.admTriggers?.handleUiEvent?.(msg.payload);
            sendResponse({ ok: true });
            return;
          }

          sendResponse({ ok: false, error: "unknown message" });
        } catch (e) {
          logError("errors", "message handler error", {
            type: msg?.type || null,
            error: String(e?.message || e)
          });
          sendResponse({ ok: false, error: String(e?.message || e) });
        }
      })();

      return true;
    });
  }

  ADM.init = async function init() {
    await ADM.capture?.init?.();
    bindMessageListener();
    await ADM.logger?.init?.();
    ADM.overlay.bindRuntimePorts();
    await ADM.loadSettings();
    try {
      ADM.refreshRuntimeConnections?.();
    } catch (e) {
      logError("errors", "initial connection refresh failed", { error: String(e?.message || e) });
    }
    logInfo("system", "service worker initialized", {});
    try {
      ADM.workerModuleStatusLog?.extensionReady?.();
    } catch {
      // ignore
    }
  };
})(self);
