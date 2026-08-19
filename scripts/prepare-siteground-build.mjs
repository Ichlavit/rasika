import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const pluginPath = path.join(
  process.cwd(),
  "node_modules/astro/dist/assets/fonts/vite-plugin-fonts.js",
);
const compilerPath = path.join(
  process.cwd(),
  "node_modules/@astrojs/compiler/dist/node/index.js",
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

if (!fs.existsSync(compilerPath)) {
  throw new Error(`Astro compiler entry not found: ${compilerPath}`);
}

const asyncFsImport = 'import{a as c}from"../chunk-W5DTLHV4.js";import{promises as m}from"fs";';
const syncFsImport = 'import{a as c}from"../chunk-W5DTLHV4.js";import{readFileSync as m}from"fs";';
const asyncInstantiation = "y=async(t,s)=>{let r;return r=await(async()=>{let o=await m.readFile(t).then(e=>e.buffer);return WebAssembly.instantiate(new Uint8Array(o),s)})(),r},";
const syncInstantiation = "y=async(t,s)=>({instance:new WebAssembly.Instance(new WebAssembly.Module(m(t)),s)}),";
let compilerSource = fs.readFileSync(compilerPath, "utf8");

if (compilerSource.includes(syncFsImport) && compilerSource.includes(syncInstantiation)) {
  console.log("Astro compiler already uses the lower-peak synchronous loader.");
} else if (compilerSource.includes(asyncFsImport) && compilerSource.includes(asyncInstantiation)) {
  compilerSource = compilerSource
    .replace(asyncFsImport, syncFsImport)
    .replace(asyncInstantiation, syncInstantiation);
  fs.writeFileSync(compilerPath, compilerSource);
  console.log("Enabled the lower-peak Astro compiler loader for SiteGround.");
} else {
  throw new Error("Astro compiler loader changed; review the SiteGround build preparation step.");
}

process.exit(0);
