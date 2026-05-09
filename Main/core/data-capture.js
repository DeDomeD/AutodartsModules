/**
 * Autodarts Data Capture
 * Responsibility:
 * - stores normalized + raw-capture samples from injected page events
 * - derives reusable field paths
 * - persists snapshot in chrome.storage.local
 */
(function initDataCapture(scope) {
  const ADM = scope.ADM || (scope.ADM = {});

  const STORAGE_KEY = "adm_data_capture_v1";
  const LIFETIME_STATS_KEY = "adm_stats_lifetime_v1";
  const SESSION_STATS_KEY = "adm_stats_session_v1";
  const SAMPLE_LIMIT = 30;
  const PATH_LIMIT = 1200;
  const MAX_DEPTH = 6;

  let state = null;
  let saveTimer = null;
  let aggregateSaveTimer = null;
  let ready = false;
  let inFlight = null;
  /** Zähler seit Browser-Start (chrome.storage.session — überlebt Reload/Service-Worker, nicht Browser-Neustart). */
  let sessionCounters = null;
  /** Zähler über alle Sessions (chrome.storage.local). */
  let lifetimeCounters = null;
  /** Wurf-Kennzahlen (Session / Lifetime), ergänzend zu `counters.throw`. */
  let sessionThrowAgg = null;
  let lifetimeThrowAgg = null;
  /** State-Kennzahlen (Bust, Spielende). */
  let sessionStateAgg = null;
  let lifetimeStateAgg = null;

  function nowIso() {
    return new Date().toISOString();
  }

  function makeEmptyCounters() {
    return {
      total: 0,
      throw: 0,
      state: 0,
      event: 0,
      ui: 0,
      capture: 0
    };
  }

  function normalizeCountersObject(raw) {
    const out = makeEmptyCounters();
    if (!raw || typeof raw !== "object") return out;
    for (const k of Object.keys(raw)) {
      const n = Number(raw[k]);
      if (Number.isFinite(n) && n >= 0) out[k] = n;
    }
    return out;
  }

  function bumpCounterStore(store, type) {
    const t = String(type || "unknown");
    if (!Object.prototype.hasOwnProperty.call(store, t)) store[t] = 0;
    store.total = Number(store.total || 0) + 1;
    store[t] = Number(store[t] || 0) + 1;
  }

  function makeEmptyThrowAgg() {
    return {
      withPoints: 0,
      miss: 0,
      triple: 0,
      doubleRing: 0,
      bull25: 0,
      bull50: 0,
      t60: 0
    };
  }

  function makeEmptyStateAgg() {
    return {
      bust: 0,
      gameFinished: 0
    };
  }

  function normalizeThrowAgg(raw) {
    const out = makeEmptyThrowAgg();
    if (!raw || typeof raw !== "object") return out;
    for (const k of Object.keys(out)) {
      const n = Number(raw[k]);
      if (Number.isFinite(n) && n >= 0) out[k] = n;
    }
    return out;
  }

  function normalizeStateAgg(raw) {
    const out = makeEmptyStateAgg();
    if (!raw || typeof raw !== "object") return out;
    for (const k of Object.keys(out)) {
      const n = Number(raw[k]);
      if (Number.isFinite(n) && n >= 0) out[k] = n;
    }
    return out;
  }

  function bumpThrowAgg(store, evt) {
    if (!store || typeof store !== "object") return;
    const score = Number(evt.score);
    if (!Number.isFinite(score)) return;

    const mult = Number(evt.multiplier);
    const num = Number(evt.number);
    const seg = String(evt.segment || "").trim().toUpperCase();
    const isDoubleBull =
      score === 50 ||
      (mult === 2 && num === 25) ||
      seg === "DBULL";

    if (score > 0) store.withPoints += 1;
    if (score === 0) store.miss += 1;
    if (score === 60) store.t60 += 1;
    if (score === 25) store.bull25 += 1;
    if (score === 50 || isDoubleBull) store.bull50 += 1;
    if (mult === 3 && score > 0) store.triple += 1;
    if (mult === 2 && score > 0 && !isDoubleBull) store.doubleRing += 1;
  }

  function bumpStateAgg(store, evt) {
    if (!store || typeof store !== "object") return;
    if (evt.turnBusted === true) store.bust += 1;
    if (evt.gameFinished === true) store.gameFinished += 1;
  }

  function makeEmpty() {
    return {
      version: 1,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      counters: makeEmptyCounters(),
      samples: {
        throw: [],
        state: [],
        event: [],
        ui: [],
        capture: []
      },
      fieldPaths: {
        throw: [],
        state: [],
        event: [],
        ui: [],
        capture: [],
        stateRaw: [],
        eventRaw: [],
        captureRaw: []
      }
    };
  }

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

  function storageSessionGet(key) {
    return new Promise((resolve, reject) => {
      try {
        if (!chrome?.storage?.session) return resolve(undefined);
        chrome.storage.session.get([key], (items) => {
          const err = chrome.runtime?.lastError;
          if (err) reject(err);
          else resolve(items?.[key]);
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  function storageSessionSet(items) {
    return new Promise((resolve, reject) => {
      try {
        if (!chrome?.storage?.session) return reject(new Error("chrome.storage.session not available"));
        chrome.storage.session.set(items, () => {
          const err = chrome.runtime?.lastError;
          if (err) reject(err);
          else resolve(true);
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  function sanitize(obj) {
    if (obj === undefined) return undefined;
    try {
      return JSON.parse(JSON.stringify(obj, (k, v) => {
        if (typeof v === "string" && v.length > 500) return `${v.slice(0, 500)}...`;
        return v;
      }));
    } catch {
      return "[unserializable]";
    }
  }

  function clipArray(arr, max = SAMPLE_LIMIT) {
    if (!Array.isArray(arr)) return [];
    return arr.length <= max ? arr : arr.slice(arr.length - max);
  }

  function ensureAggregateCounters() {
    if (!sessionCounters || typeof sessionCounters !== "object") sessionCounters = makeEmptyCounters();
    if (!lifetimeCounters || typeof lifetimeCounters !== "object") lifetimeCounters = makeEmptyCounters();
    if (!sessionThrowAgg || typeof sessionThrowAgg !== "object") sessionThrowAgg = makeEmptyThrowAgg();
    if (!lifetimeThrowAgg || typeof lifetimeThrowAgg !== "object") lifetimeThrowAgg = makeEmptyThrowAgg();
    if (!sessionStateAgg || typeof sessionStateAgg !== "object") sessionStateAgg = makeEmptyStateAgg();
    if (!lifetimeStateAgg || typeof lifetimeStateAgg !== "object") lifetimeStateAgg = makeEmptyStateAgg();
  }

  function scheduleAggregateSave() {
    if (aggregateSaveTimer) return;
    aggregateSaveTimer = setTimeout(async () => {
      aggregateSaveTimer = null;
      try {
        ensureAggregateCounters();
        const iso = nowIso();
        await Promise.all([
          storageSet({
            [LIFETIME_STATS_KEY]: {
              version: 1,
              updatedAt: iso,
              counters: { ...lifetimeCounters },
              throwAgg: { ...lifetimeThrowAgg },
              stateAgg: { ...lifetimeStateAgg }
            }
          }),
          storageSessionSet({
            [SESSION_STATS_KEY]: {
              version: 1,
              updatedAt: iso,
              counters: { ...sessionCounters },
              throwAgg: { ...sessionThrowAgg },
              stateAgg: { ...sessionStateAgg }
            }
          })
        ]);
      } catch (e) {
        console.error("[ADM] aggregate stats save failed", e);
      }
    }, 400);
  }

  function ensure() {
    if (!state || typeof state !== "object") state = makeEmpty();
    if (!state.counters || typeof state.counters !== "object") state.counters = makeEmptyCounters();
    if (!state.samples || typeof state.samples !== "object") state.samples = makeEmpty().samples;
    if (!state.fieldPaths || typeof state.fieldPaths !== "object") state.fieldPaths = makeEmpty().fieldPaths;
  }

  function scheduleSave() {
    if (saveTimer) return;
    saveTimer = setTimeout(async () => {
      saveTimer = null;
      try {
        await storageSet({ [STORAGE_KEY]: state });
      } catch (e) {
        console.error("[ADM] capture save failed", e);
      }
    }, 900);
  }

  async function init() {
    if (ready) return;
    if (inFlight) {
      await inFlight;
      return;
    }
    inFlight = (async () => {
      state = makeEmpty();
      let legacyBlobCounters = null;
      try {
        const stored = await storageGet(STORAGE_KEY);
        if (stored && typeof stored === "object") {
          state = stored;
          ensure();
          for (const k of Object.keys(state.samples)) {
            state.samples[k] = clipArray(state.samples[k]);
          }
          for (const k of Object.keys(state.fieldPaths)) {
            state.fieldPaths[k] = Array.isArray(state.fieldPaths[k])
              ? state.fieldPaths[k].slice(0, PATH_LIMIT)
              : [];
          }
          if (Number(state.counters?.total) > 0) {
            legacyBlobCounters = normalizeCountersObject(state.counters);
          }
        }
        try {
          const lifeWrap = await storageGet(LIFETIME_STATS_KEY);
          const sessWrap = await storageSessionGet(SESSION_STATS_KEY);
          if (lifeWrap && typeof lifeWrap === "object" && lifeWrap.counters) {
            lifetimeCounters = normalizeCountersObject(lifeWrap.counters);
            lifetimeThrowAgg = normalizeThrowAgg(lifeWrap.throwAgg);
            lifetimeStateAgg = normalizeStateAgg(lifeWrap.stateAgg);
          } else if (legacyBlobCounters && legacyBlobCounters.total > 0) {
            lifetimeCounters = { ...legacyBlobCounters };
            lifetimeThrowAgg = makeEmptyThrowAgg();
            lifetimeStateAgg = makeEmptyStateAgg();
            await storageSet({
              [LIFETIME_STATS_KEY]: {
                version: 1,
                updatedAt: nowIso(),
                counters: { ...lifetimeCounters },
                throwAgg: { ...lifetimeThrowAgg },
                stateAgg: { ...lifetimeStateAgg },
                migratedFromCaptureCounters: true
              }
            });
          } else {
            lifetimeCounters = makeEmptyCounters();
            lifetimeThrowAgg = makeEmptyThrowAgg();
            lifetimeStateAgg = makeEmptyStateAgg();
          }
          sessionCounters = normalizeCountersObject(sessWrap?.counters);
          sessionThrowAgg = normalizeThrowAgg(sessWrap?.throwAgg);
          sessionStateAgg = normalizeStateAgg(sessWrap?.stateAgg);
        } catch {
          sessionCounters = makeEmptyCounters();
          lifetimeCounters = makeEmptyCounters();
          sessionThrowAgg = makeEmptyThrowAgg();
          lifetimeThrowAgg = makeEmptyThrowAgg();
          sessionStateAgg = makeEmptyStateAgg();
          lifetimeStateAgg = makeEmptyStateAgg();
        }
        ensure();
        ensureAggregateCounters();
        state.counters = { ...sessionCounters };
      } catch {}
      ready = true;
    })();
    await inFlight;
  }

  function collectPaths(value, prefix = "", out = new Set(), depth = 0) {
    if (depth > MAX_DEPTH) return out;
    if (value === null || value === undefined) {
      if (prefix) out.add(prefix);
      return out;
    }

    const t = typeof value;
    if (t !== "object") {
      if (prefix) out.add(prefix);
      return out;
    }

    if (Array.isArray(value)) {
      const arrPath = prefix ? `${prefix}[]` : "[]";
      out.add(arrPath);
      if (value.length > 0) {
        collectPaths(value[0], arrPath, out, depth + 1);
      }
      return out;
    }

    const keys = Object.keys(value).slice(0, 120);
    if (keys.length === 0 && prefix) out.add(prefix);
    for (const key of keys) {
      const next = prefix ? `${prefix}.${key}` : key;
      out.add(next);
      collectPaths(value[key], next, out, depth + 1);
    }
    return out;
  }

  function mergePaths(bucketName, obj) {
    const bucket = Array.isArray(state.fieldPaths[bucketName]) ? state.fieldPaths[bucketName] : [];
    const current = new Set(bucket);
    const next = collectPaths(obj);
    for (const p of next) current.add(p);
    state.fieldPaths[bucketName] = Array.from(current).sort().slice(0, PATH_LIMIT);
  }

  function pushSample(kind, payload) {
    if (!Array.isArray(state.samples[kind])) state.samples[kind] = [];
    state.samples[kind].push({
      ts: Date.now(),
      iso: nowIso(),
      data: sanitize(payload)
    });
    state.samples[kind] = clipArray(state.samples[kind], SAMPLE_LIMIT);
  }

  function ingestEvent(evt) {
    ensure();
    if (!evt || typeof evt !== "object") return;

    const type = String(evt.type || "unknown");
    ensureAggregateCounters();
    bumpCounterStore(sessionCounters, type);
    bumpCounterStore(lifetimeCounters, type);
    if (type === "throw") {
      bumpThrowAgg(sessionThrowAgg, evt);
      bumpThrowAgg(lifetimeThrowAgg, evt);
    } else if (type === "state") {
      bumpStateAgg(sessionStateAgg, evt);
      bumpStateAgg(lifetimeStateAgg, evt);
    }
    state.counters = { ...sessionCounters };
    state.updatedAt = nowIso();
    scheduleAggregateSave();

    if (type === "throw") {
      pushSample("throw", evt);
      mergePaths("throw", evt);
    } else if (type === "state") {
      pushSample("state", evt);
      mergePaths("state", evt);
      mergePaths("stateRaw", evt.raw);
    } else if (type === "event") {
      pushSample("event", evt);
      mergePaths("event", evt);
      mergePaths("eventRaw", evt.raw);
    } else if (type === "capture") {
      pushSample("capture", evt);
      mergePaths("capture", evt);
      mergePaths("captureRaw", evt.raw);
    } else if (type === "ui") {
      pushSample("ui", evt);
      mergePaths("ui", evt);
    }

    scheduleSave();
  }

  function ingestUi(payload) {
    ingestEvent({
      type: "ui",
      ts: Date.now(),
      payload: payload || {}
    });
  }

  function getSnapshot() {
    ensure();
    ensureAggregateCounters();
    const snap = sanitize(state);
    if (typeof snap !== "object" || snap === null) {
      return {
        countersSession: sanitize({ ...sessionCounters }),
        countersLifetime: sanitize({ ...lifetimeCounters }),
        counters: sanitize({ ...sessionCounters }),
        throwAggSession: sanitize({ ...sessionThrowAgg }),
        throwAggLifetime: sanitize({ ...lifetimeThrowAgg }),
        stateAggSession: sanitize({ ...sessionStateAgg }),
        stateAggLifetime: sanitize({ ...lifetimeStateAgg })
      };
    }
    snap.countersSession = sanitize({ ...sessionCounters });
    snap.countersLifetime = sanitize({ ...lifetimeCounters });
    snap.counters = sanitize({ ...sessionCounters });
    snap.throwAggSession = sanitize({ ...sessionThrowAgg });
    snap.throwAggLifetime = sanitize({ ...lifetimeThrowAgg });
    snap.stateAggSession = sanitize({ ...sessionStateAgg });
    snap.stateAggLifetime = sanitize({ ...lifetimeStateAgg });
    return snap;
  }

  async function clear() {
    sessionCounters = makeEmptyCounters();
    sessionThrowAgg = makeEmptyThrowAgg();
    sessionStateAgg = makeEmptyStateAgg();
    try {
      await storageSessionSet({
        [SESSION_STATS_KEY]: {
          version: 1,
          updatedAt: nowIso(),
          counters: { ...sessionCounters },
          throwAgg: { ...sessionThrowAgg },
          stateAgg: { ...sessionStateAgg }
        }
      });
    } catch {
      // ignore
    }
    state = makeEmpty();
    state.counters = { ...sessionCounters };
    await storageSet({ [STORAGE_KEY]: state });
  }

  ADM.capture = {
    init,
    ingestEvent,
    ingestUi,
    getSnapshot,
    clear
  };
})(self);
