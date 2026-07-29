import fs from "node:fs";
import path from "node:path";

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};
  return Object.fromEntries(
    fs.readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        const key = line.slice(0, index).trim();
        let value = line.slice(index + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        return [key, value];
      }),
  );
}

const root = process.cwd();
const env = { ...loadEnv(path.join(root, ".env.local")), ...process.env };
const fileArg = process.argv.find((arg) => arg.endsWith(".sql"));
const checkOnly = process.argv.includes("--check");
if (!fileArg) throw new Error("Usage: node scripts/run-supabase-migration.mjs <migration.sql> [--check]");

const filePath = path.resolve(root, fileArg);
const match = path.basename(filePath).match(/^(\d+)_([a-z0-9_]+)\.sql$/i);
if (!match) throw new Error("Migration filename must begin with a numeric version.");
const projectRef = env.SUPABASE_PROJECT_REF;
const accessToken = env.SUPABASE_ACCESS_TOKEN;
if (!projectRef || !accessToken) throw new Error("SUPABASE_PROJECT_REF and SUPABASE_ACCESS_TOKEN are required.");

const sql = fs.readFileSync(filePath, "utf8");
const history = `
insert into supabase_migrations.schema_migrations (version, name, statements)
values ('${match[1]}', '${match[2]}', array[]::text[])
on conflict (version) do nothing;`;
const query = checkOnly
  ? `begin;\n${sql}\nrollback;`
  : `begin;\n${sql}\n${history}\ncommit;`;

const response = await fetch(`https://api.supabase.com/v1/projects/${encodeURIComponent(projectRef)}/database/query`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ query, read_only: false }),
});
const result = await response.json().catch(() => ({}));
if (!response.ok) {
  throw new Error(`Supabase migration ${checkOnly ? "check" : "apply"} failed (${response.status}): ${JSON.stringify(result)}`);
}
console.log(checkOnly ? "Migration SQL validated in a rolled-back transaction." : `Applied migration ${match[1]}_${match[2]}.`);
