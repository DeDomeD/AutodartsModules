/**
 * Ringpuffer: dieselben Konsolenzeilen wie im Service Worker, inkl. CSS-Segmente
 * für die farbige Anzeige in der Extension (Side Panel).
 * Optional: category AD | SB | OBS | WLED | MISC für Filter in der UI.
 */
(function initWorkerMirrorLog(scope) {
  const ADM = scope.ADM || (scope.ADM = {});
  const cap = 2500;
  /** @type {{ id: number, segments: { css: string, text: string }[], category: string }[]} */
  const entries = [];
  let nextLineId = 0;

  function normalizeCategory(raw) {
    const c = String(raw || "").toUpperCase();
    if (c === "SB" || c === "OBS" || c === "WLED" || c === "MISC") return c;
    return "AD";
  }

  ADM.workerMirrorLog = {
    /**
     * @param {{ segments: { css: string, text: string }[], category?: string }} entry
     */
    pushEntry(entry) {
      const segs = entry && Array.isArray(entry.segments) ? entry.segments : null;
      if (!segs || !segs.length) return;
      let hasText = false;
      for (let i = 0; i < segs.length; i += 1) {
        if (String(segs[i]?.text || "").length) {
          hasText = true;
          break;
        }
      }
      if (!hasText) return;
      const id = nextLineId++;
      const category = normalizeCategory(entry?.category);
      entries.push({ id, segments: segs, category });
      while (entries.length > cap) entries.shift();
    },

    /** @param {number} afterId */
    getSince(afterId) {
      const aid = Number.isFinite(afterId) ? afterId : -1;
      if (!entries.length) {
        return { lines: [], lastId: -1, truncated: false };
      }
      const oldestId = entries[0].id;
      if (aid >= 0 && aid < oldestId - 1) {
        const lastId = entries[entries.length - 1].id;
        return {
          lines: entries.map((e) => ({
            id: e.id,
            segments: e.segments,
            category: e.category
          })),
          lastId,
          truncated: true
        };
      }
      const lines = entries
        .filter((e) => e.id > aid)
        .map((e) => ({
          id: e.id,
          segments: e.segments,
          category: e.category
        }));
      return {
        lines,
        lastId: entries[entries.length - 1].id,
        truncated: false
      };
    },

    clear() {
      function flattenEntry(e) {
        if (!e || !Array.isArray(e.segments)) return "";
        let s = "";
        for (let i = 0; i < e.segments.length; i += 1) {
          s += e.segments[i]?.text == null ? "" : String(e.segments[i].text);
        }
        return s;
      }
      let keeper = null;
      for (let i = entries.length - 1; i >= 0; i -= 1) {
        if (/extension ready/i.test(flattenEntry(entries[i]))) {
          keeper = entries[i];
          break;
        }
      }
      entries.length = 0;
      if (keeper) {
        entries.push(keeper);
      } else {
        try {
          ADM.workerModuleStatusLog?.extensionReady?.();
        } catch {
          // ignore
        }
      }
    }
  };
})(self);
