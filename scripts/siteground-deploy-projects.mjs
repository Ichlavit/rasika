import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const parsed = {};
for (const fileName of [".env", ".env.local"]) {
  if (!fs.existsSync(fileName)) continue;
  for (const line of fs.readFileSync(fileName, "utf8").split(/\r?\n/)) {
    const match = line.trim().match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    parsed[match[1]] = value;
  }
}

const required = ["SITEGROUND_SSH_HOST", "SITEGROUND_SSH_USER", "SITEGROUND_SSH_PORT", "SITEGROUND_REMOTE_PATH", "SITEGROUND_SSH_KEY_PATH"];
const missing = required.filter((key) => !parsed[key]);
if (missing.length) throw new Error(`Missing SiteGround configuration: ${missing.join(", ")}`);

const pages = ["dist/projects/index.html", "dist/projects/share/index.html"];
const assets = [...new Set(pages.flatMap((page) => [...fs.readFileSync(page, "utf8").matchAll(/\/_astro\/([^\"']+)/g)].map((match) => match[1])))];
for (const asset of assets) {
  if (!fs.existsSync(path.join("dist/_astro", asset))) throw new Error(`Missing project asset: ${asset}`);
}
if (!fs.existsSync("dist/favicon.svg")) throw new Error("Run the production build before deploying projects.");

const destination = `${parsed.SITEGROUND_SSH_USER}@${parsed.SITEGROUND_SSH_HOST}`;
const keyPath = path.resolve(parsed.SITEGROUND_SSH_KEY_PATH);
const askpassPath = path.resolve(".ssh/askpass.sh");
const knownHostsPath = "/private/tmp/rasika_siteground_known_hosts";
const remoteRoot = parsed.SITEGROUND_REMOTE_PATH.replace(/\/+$/, "");
const stageRoot = `${remoteRoot}/.projects-deploy-${Date.now()}`;
const env = { ...process.env, ...parsed, SSH_ASKPASS: askpassPath, SSH_ASKPASS_REQUIRE: "force", DISPLAY: process.env.DISPLAY || ":0" };
const sshArgs = ["-i", keyPath, "-p", String(parsed.SITEGROUND_SSH_PORT), "-o", "IdentitiesOnly=yes", "-o", "StrictHostKeyChecking=accept-new", "-o", `UserKnownHostsFile=${knownHostsPath}`];
const scpArgs = ["-i", keyPath, "-P", String(parsed.SITEGROUND_SSH_PORT), "-o", "IdentitiesOnly=yes", "-o", "StrictHostKeyChecking=accept-new", "-o", `UserKnownHostsFile=${knownHostsPath}`];

function run(command, args) {
  const result = spawnSync(command, args, { env, encoding: "utf8" });
  process.stdout.write(result.stdout || "");
  process.stderr.write(result.stderr || "");
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run("ssh", [...sshArgs, destination, `mkdir -p '${stageRoot}/projects/share' '${stageRoot}/_astro'`]);
run("scp", [...scpArgs, "dist/projects/index.html", `${destination}:${stageRoot}/projects/index.html`]);
run("scp", [...scpArgs, "dist/projects/share/index.html", `${destination}:${stageRoot}/projects/share/index.html`]);
run("scp", [...scpArgs, "dist/favicon.svg", `${destination}:${stageRoot}/favicon.svg`]);
for (const asset of assets) run("scp", [...scpArgs, path.join("dist/_astro", asset), `${destination}:${stageRoot}/_astro/${asset}`]);
run("ssh", [...sshArgs, destination, `install -m 0644 '${stageRoot}/projects/index.html' '${remoteRoot}/projects/index.html' && install -m 0644 '${stageRoot}/projects/share/index.html' '${remoteRoot}/projects/share/index.html' && install -m 0644 '${stageRoot}/favicon.svg' '${remoteRoot}/favicon.svg' && rsync -az '${stageRoot}/_astro/' '${remoteRoot}/_astro/' && rm -rf '${stageRoot}'`]);

console.log("Project planner deployed.");
