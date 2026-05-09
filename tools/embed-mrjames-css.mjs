/**
 * Embeds `Modules/themes/Horizontal/mrjames-ad-template.source.css`
 * into `mrjames-ad-template.js` (css string literal).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, "Modules", "themes", "Horizontal");
const cssPath = path.join(dir, "mrjames-ad-template.source.css");
const jsPath = path.join(dir, "mrjames-ad-template.js");

const css = fs.readFileSync(cssPath, "utf8");
let js = fs.readFileSync(jsPath, "utf8");
const marker = "    css: ";
const i = js.indexOf(marker);
if (i < 0) throw new Error("marker not found");
const q = js.indexOf('"', i + marker.length);
if (q < 0) throw new Error("opening quote not found");
let j = q + 1;
let esc = false;
while (j < js.length) {
  const c = js[j];
  if (esc) {
    esc = false;
    j++;
    continue;
  }
  if (c === "\\") {
    esc = true;
    j++;
    continue;
  }
  if (c === '"') break;
  j++;
}
if (j >= js.length) throw new Error("closing quote not found");
const escaped = JSON.stringify(css).slice(1, -1);
js = js.slice(0, q + 1) + escaped + js.slice(j);
fs.writeFileSync(jsPath, js, "utf8");
console.log("embedded", path.relative(root, cssPath), "->", path.relative(root, jsPath));
