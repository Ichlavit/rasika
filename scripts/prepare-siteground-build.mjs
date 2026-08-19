import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const pluginPath = path.join(
  process.cwd(),
  "node_modules/astro/dist/assets/fonts/vite-plugin-fonts.js",
);
const unpatched = `    async buildStart() {
      if (sync) {
        return;
      }`;
const patched = `    async buildStart() {
      if (sync || !settings.config.fonts?.length) {
        return;
      }`;

if (!fs.existsSync(pluginPath)) {
  throw new Error(`Astro font plugin not found: ${pluginPath}`);
}

const source = fs.readFileSync(pluginPath, "utf8");
if (source.includes(patched)) {
  console.log("Astro font initialization already disabled for the font-free SiteGround build.");
} else if (source.includes(unpatched)) {
  fs.writeFileSync(pluginPath, source.replace(unpatched, patched));
  console.log("Disabled unused Astro font initialization for the SiteGround build.");
} else {
  throw new Error("Astro font plugin changed; review the SiteGround build preparation step.");
}

process.exit(0);
