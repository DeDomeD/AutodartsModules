/**
 * Structured Debug Logger
 * Responsibility:
 * - collects categorized runtime logs in the service worker
 * - stores logs by day in chrome.storage.local
 * - keeps at most 109 day buckets
 * - returns the latest 10 days by default
 */
(function initLogger(scope) {
  const ADM = scope.ADM || (scope.ADM = {});

  const STORAGE_KEY = "adm_logs_v2";
  const DAYS_TO_KEEP = 109;
  const DEFAULT_DAYS_TO_RETURN = 10;
  const ENTRIES_PER_CHANNEL_PER_DAY = 10;
  /** Nur auf `true` setzen, wenn `Main/logs/start-log-writer` laeuft — sonst spammt jeder Log-Eintrag einen fetch (Devtools: dauernd „ausstehend“). */
  const LOCAL_WRITER_ENABLED = false;
  const LOCAL_WRITER_URL = "http://127.0.0.1:8765/log";

  const CHANNELS = [
    "system",
    "events",
    "throws",
    "state",
    "ui",
    "actions",
    "sb",
    "obs",
    "wled",
    "pixelit",
    "triggers",
    "overlay",
    "errors"
  ];

  let logs = { days: {} };
  let saveInFlight = null;
  let saveQueued = false;
  let ready = false;
  let inFlightLoad = null;

  function storageGet(key) {
    return new Promise((resolve, reject) => {
      try {
        if (!chrome?.storage?.local) return reject(new Error("chrome.storage.local not available"));
        chrome.storage.local.get([key], (items) => {
          const err = chrome.runtime?.lastError;
          if (err) reject(err);
          else resolve(items?.[key]);
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  function storageSet(items) {
    return new Promise((resolve, reject) => {
      try {
        if (!chrome?.storage?.local) return reject(new Error("chrome.storage.local not available"));
        chrome.storage.local.set(items, () => {
          const err = chrome.runtime?.lastError;
          if (err) reject(err);
          else resolve(true);
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  function shipToLocalWriter(entry) {
    if (!LOCAL_WRITER_ENABLED) return;
    if (typeof fetch !== "function") return;
    if (!entry || typeof entry !== "object") return;
    fetch(LOCAL_WRITER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entry)
    }).catch(() => {
      // keep silent to avoid console noise when local writer is not running
    });
  }

  function mirrorCatFromLoggerChannel(rawChannel, message, data) {
    const r = String(rawChannel || "").toLowerCase();
    const m = String(message || "").toLowerCase();
    if (r === "sb" || r === "actions") return "SB";
    if (r === "obs") return "OBS";
    if (r === "wled") return "WLED";
    if (r === "errors") {
      const typ =
        data && typeof data === "object" && data.type != null ? String(data.type) : "";
      if (typ && /^(GET_WLED|TRIGGER_WLED)/i.test(typ)) return "WLED";
      if (typ && /^OBS_/i.test(typ)) return "OBS";
      if (typ && /^SB_/i.test(typ)) return "SB";
      if (m.includes("wled")) return "WLED";
      if (m.includes("obs")) return "OBS";
      if (m.includes("streamerbot") || m.includes("streamer.bot")) return "SB";
      return "MISC";
    }
    if (
      r === "throws" ||
      r === "state" ||
      r === "events" ||
      r === "ui" ||
      r === "overlay" ||
      r === "triggers" ||
      r === "system"
    ) {
      return "MISC";
    }
    return "MISC";
  }

  /**
   * Verbindungs-Versuche (SB/OBS) nur als MISC — sichtbar, wenn im Overlay „ALL“ aktiv ist.
   * Doppelte Connected/Disconnected-Zeilen weglassen (gleiche Infos wie [AutoDart - Modules] Status).
   */
  function refineMirrorCategoryForSbObs(rawChannel, message, baseCat) {
    const r = String(rawChannel || "").toLowerCase();
    const m = String(message || "").trim().toLowerCase();
    if (r === "sb") {
      if (m === "streamerbot connected" || m === "streamerbot ws closed") return { skip: true };
      if (m === "connecting to streamerbot" || m === "reconnect scheduled" || m === "streamerbot ws open") {
        return { skip: false, cat: "MISC" };
      }
      return { skip: false, cat: "SB" };
    }
    if (r === "obs") {
      if (m.startsWith("obs connected (") || m.startsWith("obs disconnected (")) return { skip: true };
      if (
        m.startsWith("obs connecting (") ||
        m.startsWith("obs ws open (") ||
        m.startsWith("obs reconnect scheduled") ||
        m.startsWith("obs endpoint unreachable (") ||
        m.startsWith("obs websocket failed (") ||
        m.startsWith("obs reconnect exhausted")
      ) {
        return { skip: false, cat: "MISC" };
      }
      return { skip: false, cat: "OBS" };
    }
    return { skip: false, cat: baseCat };
  }

  /** Action-Details nur im SB-„Voll“-Mirror; Kurzzeile [ADM] SB Action … kommt direkt aus sb-client. */
  function shouldSkipActionsChannelMirror(rawChannel, message) {
    if (String(rawChannel || "").toLowerCase() !== "actions") return false;
    const m = String(message || "").trim().toLowerCase();
    if (m === "action sent") return true;
    if (m === "sb doaction") return true;
    return false;
  }

  function pushWorkerMirrorForLogger(level, rawChannel, message, data) {
    if (shouldSkipActionsChannelMirror(rawChannel, message)) return;
    let cat = mirrorCatFromLoggerChannel(rawChannel, message, data);
    const refined = refineMirrorCategoryForSbObs(rawChannel, message, cat);
    if (refined.skip) return;
    if (refined.cat) cat = refined.cat;
    const tagStyle = "color:#64748b;font-weight:700";
    const bodyStyle =
      level === "error" ? "color:#fda4af;font-weight:500" : level === "warn" ? "color:#fcd34d;font-weight:500" : "color:#e2e8f0;font-weight:500";
    let extra = "";
    if (data !== undefined) {
      try {
        extra = ` ${JSON.stringify(data)}`;
        if (extra.length > 260) extra = `${extra.slice(0, 260)}…`;
      } catch {
        extra = " [data]";
      }
    }
    ADM.workerMirrorLog?.pushEntry?.({
      category: cat,
      segments: [
        { css: tagStyle, text: `[${cat}] ` },
        { css: bodyStyle, text: String(message || "") + extra }
      ]
    });
  }

  function makeEmptyDayStore() {
    const out = {};
    for (const c of CHANNELS) out[c] = [];
    return out;
  }

  function ensureRoot() {
    if (!logs || typeof logs !== "object") logs = { days: {} };
    if (!logs.days || typeof logs.days !== "object") logs.days = {};
  }

  function sanitizeData(data) {
    if (data === undefined) return undefined;
    try {
      return JSON.parse(JSON.stringify(data, (k, v) => {
        if (k === "raw") return "[raw omitted]";
        if (typeof v === "string" && v.length > 500) return `${v.slice(0, 500)}...`;
        return v;
      }));
    } catch {
      return "[unserializable]";
    }
  }

  function dateKeyFromTs(ts) {
    const d = new Date(ts);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function getSortedDayKeys() {
    ensureRoot();
    return Object.keys(logs.days).sort();
  }

  function pruneOldDays() {
    const keys = getSortedDayKeys();
    if (keys.length <= DAYS_TO_KEEP) return;
    const removeCount = keys.length - DAYS_TO_KEEP;
    for (let i = 0; i < removeCount; i += 1) {
      delete logs.days[keys[i]];
    }
  }

  /** Nach `QUOTA_EXCEEDED`: weniger Tage + weniger Einträge pro Kanal, dann erneut speichern. */
  function aggressivePruneForQuota() {
    const keys = getSortedDayKeys();
    const keepDays = Math.min(30, Math.max(7, Math.floor(DAYS_TO_KEEP / 4)));
    if (keys.length > keepDays) {
      const removeCount = keys.length - keepDays;
      for (let i = 0; i < removeCount; i += 1) {
        delete logs.days[keys[i]];
      }
    }
    const trimPerCh = Math.max(3, Math.floor(ENTRIES_PER_CHANNEL_PER_DAY / 2));
    for (const dayKey of getSortedDayKeys()) {
      ensureDay(dayKey);
      for (const c of CHANNELS) {
        const arr = logs.days[dayKey][c];
        if (Array.isArray(arr) && arr.length > trimPerCh) {
          logs.days[dayKey][c] = arr.slice(-trimPerCh);
        }
      }
    }
    pruneOldDays();
  }

  function isStorageQuotaError(e) {
    const msg = String(e?.message || e || "");
    return /quota|QUOTA_EXCEEDED|quota exceeded/i.test(msg);
  }

  function ensureDay(dayKey) {
    ensureRoot();
    if (!logs.days[dayKey] || typeof logs.days[dayKey] !== "object") {
      logs.days[dayKey] = makeEmptyDayStore();
      return;
    }
    for (const c of CHANNELS) {
      if (!Array.isArray(logs.days[dayKey][c])) logs.days[dayKey][c] = [];
    }
  }

  function persistNow() {
    if (saveInFlight) {
      saveQueued = true;
      return;
    }
    const payload = () => ({ [STORAGE_KEY]: logs });
    saveInFlight = storageSet(payload())
      .catch((e) => {
        if (isStorageQuotaError(e)) {
          try {
            aggressivePruneForQuota();
          } catch {
            // ignore
          }
          return storageSet(payload());
        }
        throw e;
      })
      .catch((e) => {
        console.warn("[ADM] logger save failed", String(e?.message || e));
      })
      .finally(() => {
        saveInFlight = null;
        if (saveQueued) {
          saveQueued = false;
          persistNow();
        }
      });
  }

  async function init() {
    if (ready) return;
    if (inFlightLoad) {
      await inFlightLoad;
      return;
    }
    inFlightLoad = (async () => {
      logs = { days: {} };
      try {
        const stored = await storageGet(STORAGE_KEY);
        if (stored && typeof stored === "object") {
          logs = { days: {} };
          const days = stored.days && typeof stored.days === "object" ? stored.days : {};
          for (const [dayKey, dayStore] of Object.entries(days)) {
            logs.days[dayKey] = makeEmptyDayStore();
            if (dayStore && typeof dayStore === "object") {
              for (const c of CHANNELS) {
                if (Array.isArray(dayStore[c])) {
                  logs.days[dayKey][c] = dayStore[c].slice(-ENTRIES_PER_CHANNEL_PER_DAY);
                }
              }
            }
          }
          pruneOldDays();
        }
      } catch (e) {
        console.warn("[ADM] logger init fallback", e);
      }
      ready = true;
    })();
    await inFlightLoad;
  }

  function write(level, channel, message, data) {
    const rawChannel = String(channel || "system");
    const ch = CHANNELS.includes(channel) ? channel : "system";
    const now = Date.now();
    const dayKey = dateKeyFromTs(now);
    ensureDay(dayKey);

    const entry = {
      ts: now,
      iso: new Date(now).toISOString(),
      level: String(level || "info"),
      channel: ch,
      message: String(message || ""),
      data: sanitizeData(data)
    };

    const arr = logs.days[dayKey][ch];
    arr.push(entry);
    if (arr.length > ENTRIES_PER_CHANNEL_PER_DAY) {
      logs.days[dayKey][ch] = arr.slice(-ENTRIES_PER_CHANNEL_PER_DAY);
    }

    pruneOldDays();
    persistNow();
    shipToLocalWriter(entry);
    try {
      pushWorkerMirrorForLogger(String(level || "info"), rawChannel, message, data);
    } catch {
      // ignore
    }
    return entry;
  }

  function info(channel, message, data) {
    return write("info", channel, message, data);
  }

  function warn(channel, message, data) {
    return write("warn", channel, message, data);
  }

  function error(channel, message, data) {
    return write("error", channel, message, data);
  }

  function getAll(options = {}) {
    const reqDays = Number(options?.days);
    const daysToReturn = Number.isFinite(reqDays)
      ? Math.max(1, Math.min(DAYS_TO_KEEP, Math.floor(reqDays)))
      : DEFAULT_DAYS_TO_RETURN;

    const sortedKeys = getSortedDayKeys();
    const selectedKeys = sortedKeys.slice(-daysToReturn);
    const out = {};
    for (const dayKey of selectedKeys) {
      out[dayKey] = makeEmptyDayStore();
      for (const c of CHANNELS) {
        out[dayKey][c] = Array.isArray(logs.days[dayKey]?.[c]) ? logs.days[dayKey][c].slice() : [];
      }
    }
    return {
      retentionDays: DAYS_TO_KEEP,
      defaultDaysReturned: DEFAULT_DAYS_TO_RETURN,
      entriesPerChannelPerDay: ENTRIES_PER_CHANNEL_PER_DAY,
      days: out
    };
  }

  async function clearAll() {
    logs = { days: {} };
    saveQueued = false;
    await storageSet({ [STORAGE_KEY]: logs });
  }

  ADM.logger = {
    init,
    info,
    warn,
    error,
    getAll,
    clearAll,
    channels: CHANNELS.slice()
  };
})(self);
