// Local real HTTP/database/queue runner. It never enables a model or the site's other collectors.
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL for the dedicated allnews_agent_local database.");
const database = new URL(process.env.DATABASE_URL);
if (!["127.0.0.1", "localhost", "[::1]"].includes(database.hostname) || database.pathname !== "/allnews_agent_local") {
  throw new Error("Use the dedicated allnews_agent_local database through localhost; production databases are refused.");
}
Object.assign(process.env, {
  NODE_ENV: "development", AIHOT_ENVIRONMENT: "admission-local", SITE_URL: "http://127.0.0.1:5470",
  AIHOT_CREDENTIALS_DIR: fileURLToPath(new URL("../../../.data/admission-local/no-credentials", import.meta.url)),
  AIHOT_DATA_DIR: fileURLToPath(new URL("../../../.data/admission-local", import.meta.url)),
  COLLECT_ENABLED: "false", ADMISSION_AUTOMATION_ENABLED: "false", MODEL_CALLS_ENABLED: "false",
  DEV_AUTH_ROLE: "", ADMIN_PASSWORD: "", FEISHU_PUSH_ENABLED: "false", FEISHU_CONTENT_PUSH_ENABLED: "false",
  INDEXNOW_SUBMIT_ENABLED: "false", ALLOW_PRIVATE_NETWORK_FETCH: "false", TRUST_PROXY: "false",
  API_HOST: "127.0.0.1", API_PORT: "5471", WEB_HOST: "127.0.0.1", WEB_PORT: "5470",
  API_BASE_URL: "http://127.0.0.1:5471",
});
const mode = process.argv[2];
if (mode === "api") {
  await import("../../../apps/api/src/main.ts");
} else if (mode === "worker") {
  // Only this isolated process may read official pages; the paid-model valve stays false.
  process.env.COLLECT_ENABLED = "true";
  process.env.ADMISSION_AUTOMATION_ENABLED = "true";
  const { installModules } = await import("@aihot/backend/modules");
  const { default: admission } = await import("../server.ts");
  installModules([admission]);
  const { getBoss, ensureQueue, stopBoss } = await import("@aihot/backend/jobs/queue");
  const { closeDb } = await import("@aihot/backend/db");
  const { agentQueue, scheduleAdmissionAgents } = await import("../jobs.ts");
  const boss = await getBoss();
  await ensureQueue(agentQueue.name, agentQueue.options);
  await boss.work(agentQueue.name, agentQueue.worker, async jobs => {
    await agentQueue.run(jobs.map(job => job.data) as Parameters<typeof agentQueue.run>[0]);
  });
  let scheduling = false;
  const tick = async () => {
    if (scheduling) return;
    scheduling = true;
    try { await scheduleAdmissionAgents(); }
    catch { console.error("Agent scheduling failed; check the local database connection."); }
    finally { scheduling = false; }
  };
  await tick();
  const timer = setInterval(() => void tick(), 10_000);
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true; clearInterval(timer);
    await stopBoss(); await closeDb(); process.exit(0);
  };
  process.on("SIGINT", () => void stop()); process.on("SIGTERM", () => void stop());
  console.log("Local Agent queue ready; official-page reads only, model calls disabled.");
} else if (!mode) {
  const { runMigrations } = await import("../../../scripts/migrate.ts");
  const { sql, closeDb } = await import("@aihot/backend/db");
  try { await runMigrations(sql, root); } finally { await closeDb(); }
  const children: ChildProcess[] = [];
  let stopping = false;
  const stop = async (code: number) => {
    if (stopping) return;
    stopping = true;
    await Promise.all(children.filter(child => child.exitCode === null && !child.signalCode).map(async child => {
      child.kill("SIGTERM"); await once(child, "exit");
    }));
    process.exit(code);
  };
  for (const args of [[fileURLToPath(import.meta.url), "api"], [fileURLToPath(import.meta.url), "worker"], ["apps/web/server.ts"]]) {
    const child = spawn(process.execPath, args, { cwd: root, env: process.env, stdio: "inherit" });
    children.push(child);
    child.on("error", () => { console.error("Local component could not start."); void stop(1); });
    child.on("exit", code => { if (!stopping) void stop(code || 1); });
  }
  process.on("SIGINT", () => void stop(0)); process.on("SIGTERM", () => void stop(0));
  console.log("Real local Agent: http://127.0.0.1:5470/admissions/agent (isolated database; models OFF)");
} else {
  throw new Error("Usage: node --env-file=<private local env> modules/admission/scripts/local-agent.ts");
}
