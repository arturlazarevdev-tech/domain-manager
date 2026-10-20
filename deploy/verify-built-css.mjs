import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const directory = process.argv[2] ?? ".next/static/chunks";
const files = (await readdir(directory)).filter((file) => file.endsWith(".css"));
assert(files.length > 0, "No production CSS was generated");
const css = (await Promise.all(files.map((file) => readFile(path.join(directory, file), "utf8")))).join("\n");
assert(!css.includes("@theme"), "Tailwind directives remain uncompiled: check postcss.config.mjs");
for (const selector of [".flex", ".grid", ".w-60", ".bg-primary"]) {
  assert(css.includes(`${selector}{`) || css.includes(`${selector} {`), `Missing Tailwind utility: ${selector}`);
}
console.log("Production CSS verified: Tailwind utilities and theme are compiled.");
