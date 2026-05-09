/**
 * Service-Worker-Konsolen-Status für AutoDart Modules (grün = OK, rot = Problem).
 */
(function initWorkerStatusLog(scope) {
  const ADM = scope.ADM || (scope.ADM = {});

  const STYLE_OK = "color:#16a34a;font-weight:600";
  const STYLE_BAD = "color:#dc2626;font-weight:600";

  function endpointLabel(url) {
    const raw = String(url || "").trim();
    if (!raw) return "?";
    try {
      const u = new URL(raw);
      const port = u.port || (u.protocol === "wss:" ? "443" : u.protocol === "https:" ? "443" : "80");
      return `${u.hostname}:${port}`;
    } catch {
      return raw.replace(/^wss?:\/\//i, "").replace(/\/+$/, "") || "?";
    }
  }

  function printLine(restText, ok) {
    try {
      const t = String(restText ?? "");
      let category = "MISC";
      if (/^OBS\b/i.test(t)) category = "OBS";
      else if (/^Streamerbot\b/i.test(t)) category = "SB";
      else if (/^WLED\b/i.test(t)) category = "WLED";
      const bodyStyle = ok ? STYLE_OK : STYLE_BAD;
      console.log(`%c${t}`, bodyStyle);
      ADM.workerMirrorLog?.pushEntry?.({
        category,
        segments: [{ css: bodyStyle, text: t }]
      });
    } catch {
      // ignore
    }
  }

  function readExtensionVersion() {
    try {
      const v = chrome?.runtime?.getManifest?.()?.version;
      return typeof v === "string" && v.trim() ? v.trim() : "";
    } catch {
      return "";
    }
  }

  let lastObsState = null;
  let lastObsEndpoint = "";
  let lastStreamerbotState = null;
  let lastStreamerbotEndpoint = "";
  /** Pro Endpoint nur bei Zustandswechsel loggen (mehrere Controller / GET_WLED-Polls). */
  const lastWledPrintedByEndpoint = new Map();

  ADM.workerModuleStatusLog = {
    extensionReady() {
      const ver = readExtensionVersion();
      printLine(ver ? `Extension ready · v${ver}` : "Extension ready", true);
    },
    obs(connected, url) {
      const nextState = !!connected;
      const ep = endpointLabel(url);
      if (
        lastObsState === nextState &&
        lastObsEndpoint === ep
      ) return;
      lastObsState = nextState;
      lastObsEndpoint = ep;
      printLine(`OBS ${nextState ? "Connected" : "Disconnected"} ${ep}`, nextState);
    },
    streamerbot(connected, url) {
      const nextState = !!connected;
      const ep = endpointLabel(url);
      if (
        lastStreamerbotState === nextState &&
        lastStreamerbotEndpoint === ep
      ) return;
      lastStreamerbotState = nextState;
      lastStreamerbotEndpoint = ep;
      printLine(`Streamerbot ${nextState ? "Connected" : "Disconnected"} ${ep}`, nextState);
    },
    wled(connected, url) {
      const nextState = !!connected;
      const ep = endpointLabel(url);
      if (lastWledPrintedByEndpoint.get(ep) === nextState) return;
      lastWledPrintedByEndpoint.set(ep, nextState);
      printLine(`WLED Controller ${nextState ? "Connected" : "Disconnected"} ${ep}`, nextState);
    }
  };
})(self);
