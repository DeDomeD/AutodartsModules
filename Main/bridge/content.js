/**
 * Content Bridge (Autodarts Seite -> Extension)
 * - injiziert `Main/bridge/pageScript.js` (PAGE world: WS-Capture + DOM/Fetch-Bridge)
 * - leitet `postMessage` (__ADM__) ans Background-Script weiter
 * - erkennt Undo-/Korrektur-Klicks als UI-Events
 *
 * Vibecoded by DeDomeD — Urheber; nicht als eigenes/fremdes Produkt verkaufen oder umbenennen.
 */

let pageScriptInjected = false;
/** `null` bis erste Messung — dann sofort ein Navigation-Event mit echtem Pfad (Worker: Game-ON-URL-Gate). */
let lastKnownHref = null;
/** Throttle: Toolbar-Icon per Content-Ping erneuern (SW/Tab-Events können Grau wiederherstellen). */
let lastAutodartsIconPingAt = 0;

function isMatchPage() {
  const path = String(location.pathname || "").toLowerCase();
  return path.includes("/matches");
}

function safeSend(msg) {
  try {
    chrome.runtime.sendMessage(msg, () => void chrome.runtime.lastError);
  } catch {
    // ignore when extension context is unavailable
  }
}

function pingAutodartsTabActive() {
  safeSend({ type: "AUTODARTS_TAB_ACTIVE" });
}

function hostLooksLikePlayAutodarts() {
  const h = String(location.hostname || "").toLowerCase();
  return h === "play.autodarts.io" || h.endsWith(".play.autodarts.io");
}

/** Nur wenn wir weiterhin auf Play-Autodarts sind — max. alle ~3 s (reicht zum „Icon bleibt bunt“-Healing). */
function maybeReaffirmToolbarIcon() {
  if (!hostLooksLikePlayAutodarts()) return;
  const now = Date.now();
  if (now - lastAutodartsIconPingAt < 3000) return;
  lastAutodartsIconPingAt = now;
  pingAutodartsTabActive();
}

function injectPageScriptOnce() {
  if (pageScriptInjected) return;
  try {
    const s = document.createElement("script");
    s.src = chrome.runtime.getURL("Main/bridge/pageScript.js");
    s.type = "text/javascript";
    (document.documentElement || document.head).appendChild(s);
    s.onload = () => {
      try {
        s.remove();
      } catch {
        // ignore
      }
    };
    pageScriptInjected = true;
  } catch (e) {
    console.error("[ADM] bridge inject failed", e);
  }
}

function ensureBridge() {
  // Always inject as early as possible so we never miss early WS/app init.
  injectPageScriptOnce();
}

function checkRouteChangeAndBridge() {
  const href = String(location.href || "");
  const pathname = String(location.pathname || "");
  ensureBridge();

  if (lastKnownHref === null) {
    lastKnownHref = href;
    lastAutodartsIconPingAt = Date.now();
    pingAutodartsTabActive();
    safeSend({
      type: "AUTODARTS_NAVIGATION",
      payload: {
        href,
        pathname,
        previousPathname: "",
        ts: Date.now(),
        reason: "initial"
      }
    });
    return;
  }

  if (href === lastKnownHref) {
    maybeReaffirmToolbarIcon();
    return;
  }
  let previousPathname = "";
  try {
    previousPathname = new URL(lastKnownHref).pathname || "";
  } catch {
    previousPathname = "";
  }
  lastKnownHref = href;
  lastAutodartsIconPingAt = Date.now();
  pingAutodartsTabActive();
  safeSend({
    type: "AUTODARTS_NAVIGATION",
    payload: {
      href,
      pathname,
      previousPathname,
      ts: Date.now()
    }
  });
}

/** Explizite Korrektur-/Uebernehmen-/Ok-Bestätigung (zusaetzlich zu Undo), damit die Pipeline wie bei undo_click resettet. */
function looksLikeVisitCorrectionButton(btn, buttonLabel) {
  const hay = String(buttonLabel || "").toLowerCase();
  if (!hay) return false;
  if (hay.includes("korrektur")) return true;
  if (hay.includes("korrigieren")) return true;
  if (hay.includes("übernehmen") || hay.includes("ubernehmen")) return true;
  if (hay.includes("apply")) return true;
  if (hay.includes("correct")) return true;
  return false;
}

/**
 * Nach direkter Pfeil-Korrektur bestaetigt Autodarts per Chakra-„Ok“ (Check-Icon + Text).
 * Schmal gehalten: nur echte Button-Elemente, Klasse `chakra-button`, sichtbarer Text genau „Ok“.
 */
function looksLikeVisitCorrectionConfirmOk(btn, buttonLabel) {
  if (!btn || String(btn.tagName || "").toLowerCase() !== "button") return false;
  const cls = String(btn.className || "").toLowerCase();
  if (!cls.includes("chakra-button")) return false;

  const norm = (s) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
  const label = norm(buttonLabel);
  const visible = norm(btn.innerText || btn.textContent);
  if (label === "ok" || visible === "ok") return true;
  return false;
}

function isUndoButton(btn) {
  if (!btn) return false;

  const text = (btn.innerText || "").trim().toLowerCase();
  const aria = (btn.getAttribute("aria-label") || "").trim().toLowerCase();
  const title = (btn.getAttribute("title") || "").trim().toLowerCase();
  const dataTest = (btn.getAttribute("data-testid") || "").trim().toLowerCase();
  const name = (btn.getAttribute("name") || "").trim().toLowerCase();
  const hay = [text, aria, title, dataTest, name].join(" | ");

  if (
    hay.includes("undo") ||
    hay.includes("rueckgaengig") ||
    hay.includes("rueck") ||
    hay.includes("zurueck") ||
    hay.includes("ruckgangig") ||
    hay.includes("zuruck") ||
    hay.includes("revert") ||
    hay.includes("back")
  ) return true;

  const cls = (btn.className || "").toString().toLowerCase();
  return !!(btn.querySelector("svg") && (cls.includes("undo") || cls.includes("revert") || cls.includes("back")));
}

function getButtonLabel(btn) {
  if (!btn) return "";
  const candidates = [
    btn.getAttribute?.("data-testid"),
    btn.getAttribute?.("aria-label"),
    btn.getAttribute?.("title"),
    btn.getAttribute?.("name"),
    btn.innerText,
    btn.textContent
  ];
  for (const value of candidates) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    if (text) return text;
  }
  return "";
}

window.addEventListener("click", (ev) => {
  if (!isMatchPage()) return;

  const target = ev.target;
  if (!target?.closest) return;
  const btn = target.closest("button, [role='button']");
  if (!btn) return;

  const buttonLabel = getButtonLabel(btn);
  safeSend({
    type: "AUTODARTS_UI_EVENT",
    payload: { kind: "button_press", label: buttonLabel, ts: Date.now() }
  });

  if (isUndoButton(btn)) {
    safeSend({
      type: "AUTODARTS_UI_EVENT",
      payload: { kind: "undo_click", label: buttonLabel || "Undo", ts: Date.now() }
    });
  } else if (
    looksLikeVisitCorrectionButton(btn, buttonLabel) ||
    looksLikeVisitCorrectionConfirmOk(btn, buttonLabel)
  ) {
    safeSend({
      type: "AUTODARTS_UI_EVENT",
      payload: { kind: "visit_correction_click", label: buttonLabel || "Ok", ts: Date.now() }
    });
  }
}, true);

window.addEventListener("message", (event) => {
  if (event.source !== window) return;

  const msg = event.data;
  if (!msg || msg.__ADM__ !== true) return;

  safeSend({
    type: "AUTODARTS_EVENT",
    payload: msg.payload
  });
});

// SPA-Navigation in Autodarts abfangen, damit die Bridge bei Route-Wechseln aktiv bleibt
const nativePushState = history.pushState.bind(history);
history.pushState = function patchedPushState() {
  const out = nativePushState.apply(history, arguments);
  checkRouteChangeAndBridge();
  ensureBridge();
  return out;
};

const nativeReplaceState = history.replaceState.bind(history);
history.replaceState = function patchedReplaceState() {
  const out = nativeReplaceState.apply(history, arguments);
  checkRouteChangeAndBridge();
  ensureBridge();
  return out;
};

window.addEventListener("popstate", () => {
  checkRouteChangeAndBridge();
  ensureBridge();
});
window.addEventListener("hashchange", () => {
  checkRouteChangeAndBridge();
  ensureBridge();
});
window.addEventListener("focus", () => {
  checkRouteChangeAndBridge();
  ensureBridge();
});
window.addEventListener("pageshow", () => {
  checkRouteChangeAndBridge();
  ensureBridge();
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  pingAutodartsTabActive();
  checkRouteChangeAndBridge();
});

setInterval(checkRouteChangeAndBridge, 700);

ensureBridge();
checkRouteChangeAndBridge();
