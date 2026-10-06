import { build } from "esbuild";
import fs from "fs/promises";
import path from "path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const dir = path.join(root, "src/cheeseburger/search/desktop");
const out = path.join(root, "addons/CheeseburgerSearch.plugin.js");

const header = `/**
 * @name CheeseburgerSearch
 * @author TonyskalYT
 * @description Advanced search menu (button next to the search bar or Ctrl+Shift+F) plus better search: has: image only finds uploads, and filters like is:photo, not:gif, ext:png, site:, sort:old.
 * @version 2.0.0
 * @source https://github.com/TonyskalYT/rain
 */
`;

const result = await build({
    entryPoints: [path.join(dir, "plugin.tsx")],
    bundle: true,
    write: false,
    format: "cjs",
    platform: "browser",
    target: "es2022",
    jsx: "automatic",
    alias: { "react/jsx-runtime": path.join(dir, "jsx.ts") },
    legalComments: "none",
    footer: { js: "module.exports = module.exports.default;" },
    logLevel: "error",
});

const code = result.outputFiles[0].text.split("\n").filter(l => !/^\s*\/\/ /.test(l)).join("\n");
await fs.writeFile(out, header + code);
console.log(`Built ${path.relative(root, out)} (${Math.round((header.length + code.length) / 1024)}kb)`);
