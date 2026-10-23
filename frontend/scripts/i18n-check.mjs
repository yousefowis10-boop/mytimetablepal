// Lists every t("...") key in src/ and checks that src/i18n/ar.json translates all of them.
//   node scripts/i18n-check.mjs          -> exit 1 if any key is missing
//   node scripts/i18n-check.mjs --list   -> print missing keys as JSON (for translators)
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = new URL("../src/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(jsx?|mjs)$/.test(name) && !p.includes(`${join("src", "test")}`)) files.push(p);
  }
})(root);

const keys = new Set();
const re = /\bt\(\s*(["'`])((?:\\.|(?!\1).)*)\1/g;
for (const f of files) {
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(re)) {
    if (m[1] === "`" && m[2].includes("${")) continue;   // dynamic keys are not allowed
    keys.add(m[2].replace(/\\(["'`])/g, "$1"));
  }
}
// Nav labels/sections are translated with t(item.label); collect them from nav.js literals.
const nav = readFileSync(join(root, "nav.js"), "utf8");
for (const m of nav.matchAll(/(?:label|section):\s*"([^"]+)"/g)) keys.add(m[1]);

const ar = JSON.parse(readFileSync(join(root, "i18n", "ar.json"), "utf8"));
const missing = [...keys].filter((k) => !(k in ar)).sort();
const unused = Object.keys(ar).filter((k) => !keys.has(k));
if (process.argv.includes("--list")) {
  console.log(JSON.stringify(Object.fromEntries(missing.map((k) => [k, ""])), null, 2));
} else {
  console.log(`${keys.size} keys, ${missing.length} missing in ar.json, ${unused.length} unused.`);
  if (missing.length) {
    console.log(missing.map((k) => `  - ${k}`).join("\n"));
    process.exit(1);
  }
}
