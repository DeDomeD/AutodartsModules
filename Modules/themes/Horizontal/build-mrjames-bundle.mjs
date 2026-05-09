import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cssPath = path.join(__dirname, "mrjames-ad-template.source.css");
const outPath = path.join(__dirname, "mrjames-ad-template.js");
const c = fs.readFileSync(cssPath, "utf8");
const j = JSON.stringify(c);
const out = `(function (scope) {
  var sets = scope.ADM_WEBSITE_THEME_SETS;
  if (!sets || !Array.isArray(sets.horizontal)) return;
  sets.horizontal.push({
    id: "mrjames-ad-template",
    label: "AD Template (MrJames)",
    author: "MrJames",
    sourceName: "Stylebot",
    tags: ["stylebot", "stylebot-pack", "extended-ui", "community"],
    preview: {
      bg: "radial-gradient(120% 90% at 50% 0%, rgba(120,0,0,.9), rgba(0,0,0,.95))",
      panel: "rgba(0,0,0,.55)",
      accent: "#ff4a3a",
      accentSoft: "rgba(255,74,58,.28)",
      glow: "rgba(255,60,40,.4)"
    },
    css: ${j}
  });
})(globalThis);
`;
fs.writeFileSync(outPath, out, "utf8");
console.log("wrote", outPath, "bytes", Buffer.byteLength(out, "utf8"));
