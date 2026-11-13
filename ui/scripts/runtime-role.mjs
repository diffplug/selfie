// Creates or updates `selfie_app`, the role the Worker's Hyperdrive connects as, with only the DML that
// sign-in's tables need, including those later migrations add. Run it as the migration role, after
// `pnpm db:migrate`, with both values from the environment so neither is in a command's arguments:
//
//   DATABASE_URL=… SELFIE_APP_PASSWORD=… node scripts/runtime-role.mjs
//
// See OPERATIONS.md -> Neon.
import { queryDatabase } from "pgstencil/postgres";

const url = process.env.DATABASE_URL;
const password = process.env.SELFIE_APP_PASSWORD;
if (!url) throw new Error("Set DATABASE_URL to the migration role's direct URL.");
// DDL takes no bind parameters, so the password is spliced in, and only as hex.
if (!password || !/^[0-9a-f]{32,128}$/.test(password)) throw new Error("Set SELFIE_APP_PASSWORD to 32 to 128 hex digits, as `openssl rand -hex 24` makes.");

const run = (text) => queryDatabase(url, text, []);
const [{ exists }] = await queryDatabase(url, "SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'selfie_app') AS exists", []);
await run(`${exists ? "ALTER" : "CREATE"} ROLE selfie_app LOGIN PASSWORD '${password}'`);
await run("GRANT USAGE ON SCHEMA public TO selfie_app");
await run("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO selfie_app");
await run("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO selfie_app");
await run("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO selfie_app");
await run("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO selfie_app");
console.log(`${exists ? "Updated" : "Created"} selfie_app, with DML on sign-in's tables.`);
