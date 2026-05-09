/**
 * Gemeinsame Dartboard-Geometrie für OBS-Move-Kalibrierung.
 * Radien normiert auf Außen-Double-Draht = 1.0 (≈ 170 mm).
 * triple/double/single = jeweils **Mitte des Trefferbands**, nicht auf den Drähten.
 */
(function initDartboardLayout(scope) {
  const DARTBOARD_SEGMENT_ORDER = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];

  const U = 170;
  const R = {
    doubleOuter: 1,
    doubleInner: 162 / U,
    tripleOuter: 107 / U,
    tripleInner: 99 / U,
    outerBullWire: 15.9 / U,
    innerBullWire: 6.35 / U
  };

  const DARTBOARD_RING_FR = {
    /** Mitte Triple-Bett (zwischen innerem und äußerem Triple-Draht). */
    triple: (R.tripleInner + R.tripleOuter) / 2,
    /** Mitte Double-Bett. */
    double: (R.doubleInner + R.doubleOuter) / 2,
    /** Mitte „fettes“ Single (zwischen Triple außen und Double innen). */
    single: (R.tripleOuter + R.doubleInner) / 2,
    /** Grobes Bull (25) — Mitte zwischen innerem und äußerem Bull-Draht. */
    outerBull: (R.innerBullWire + R.outerBullWire) / 2,
    /** Double-Bull — nahe Zentrum des inneren Scheibenfelds. */
    innerBull: R.innerBullWire * 0.48,
    /** Äußerer Double-Draht (Spider) — nur für Kalibrier-Klicks auf den Draht. */
    doubleWireOuter: R.doubleOuter
  };

  function dartboardSegmentIndex(segmentNumber) {
    const n = Number(segmentNumber);
    if (!Number.isFinite(n) || n < 1 || n > 20) return -1;
    return DARTBOARD_SEGMENT_ORDER.indexOf(n);
  }

  function dartboardUvForFilter(filterName, centerU, centerV, radiusNorm, W, H, angleOffsetRad) {
    const fn = String(filterName || "").trim();
    const w = Number(W);
    const h = Number(H);
    const minS = Math.min(w, h);
    if (!Number.isFinite(minS) || minS <= 0) return null;
    const rn = Number(radiusNorm);
    if (!Number.isFinite(rn) || rn <= 0) return null;
    const Rpx = rn * (minS / 2);
    const cu = Number(centerU);
    const cv = Number(centerV);
    if (!Number.isFinite(cu) || !Number.isFinite(cv)) return null;
    const ao = Number(angleOffsetRad);
    const angleOff = Number.isFinite(ao) ? ao : 0;
    const base = -Math.PI / 2 + angleOff;

    function addPolar(fr, theta) {
      const u = cu + (Rpx * fr * Math.cos(theta)) / w;
      const v = cv + (Rpx * fr * Math.sin(theta)) / h;
      return { u: Math.min(1, Math.max(0, u)), v: Math.min(1, Math.max(0, v)) };
    }

    const up = fn.toUpperCase();
    if (up === "MAIN") return { u: Math.min(1, Math.max(0, cu)), v: Math.min(1, Math.max(0, cv)) };
    if (up === "MISS") return { u: 0.06, v: 0.06 };
    if (up === "BULL") return addPolar(DARTBOARD_RING_FR.outerBull, base);
    if (up === "DBULL") return addPolar(DARTBOARD_RING_FR.innerBull, base);

    let m = /^T(\d{1,2})$/i.exec(fn);
    if (m) {
      const idx = dartboardSegmentIndex(Number(m[1]));
      if (idx < 0) return null;
      const theta = base + (idx * (2 * Math.PI)) / 20;
      return addPolar(DARTBOARD_RING_FR.triple, theta);
    }
    m = /^D(\d{1,2})$/i.exec(fn);
    if (m) {
      const idx = dartboardSegmentIndex(Number(m[1]));
      if (idx < 0) return null;
      const theta = base + (idx * (2 * Math.PI)) / 20;
      return addPolar(DARTBOARD_RING_FR.double, theta);
    }
    m = /^S(\d{1,2})$/i.exec(fn);
    if (m) {
      const idx = dartboardSegmentIndex(Number(m[1]));
      if (idx < 0) return null;
      const theta = base + (idx * (2 * Math.PI)) / 20;
      return addPolar(DARTBOARD_RING_FR.single, theta);
    }
    return null;
  }

  function getAllLayoutFilterNames() {
    const names = ["Main", "Bull", "DBull", "Miss"];
    for (let i = 1; i <= 20; i += 1) names.push(`S${String(i).padStart(2, "0")}`);
    for (let i = 1; i <= 20; i += 1) names.push(`T${String(i).padStart(2, "0")}`);
    for (let i = 1; i <= 20; i += 1) names.push(`D${String(i).padStart(2, "0")}`);
    return names;
  }

  scope.DartboardLayout = {
    DARTBOARD_SEGMENT_ORDER,
    DARTBOARD_RING_FR,
    /** Rohradien (normiert), z. B. für Debug. */
    DARTBOARD_RADIUS_NORM: R,
    dartboardSegmentIndex,
    dartboardUvForFilter,
    getAllLayoutFilterNames
  };
})(typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : globalThis);
