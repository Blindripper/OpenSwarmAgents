import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const dataPath = process.argv[2] || join(rootDir, "data/agentswarm.json");
const state = JSON.parse(await readFile(dataPath, "utf8"));

function literal(value) {
  if (value === null || value === undefined) return "null";
  return `'${String(value).replaceAll("'", "''")}'`;
}

console.log("begin;");
console.log(`
create table if not exists osa_app_state (
  id text primary key,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);
`.trim());
console.log(
  `insert into osa_app_state (id, payload, updated_at) values ('default', ${literal(JSON.stringify(state))}::jsonb, now()) on conflict (id) do update set payload = excluded.payload, updated_at = now();`
);
console.log("commit;");
