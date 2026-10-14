import assert from "node:assert/strict";
import test from "node:test";
import { competitionIngestQueue, scheduleCompetitionRefresh } from "../backend/daily.ts";
import { publicReadPostAllowed } from "../backend/browser.ts";

test("disabled automation neither enqueues nor executes pending competition jobs", async () => {
  const previous = process.env.COLLECT_ENABLED;
  process.env.COLLECT_ENABLED = "false";
  try {
    assert.deepEqual(await scheduleCompetitionRefresh(), { enqueued: 0, total: 31 });
    assert.deepEqual(await competitionIngestQueue.run([{ competitionId: "competition-001" }]), { skipped: "competition collection or model calls disabled" });
  } finally {
    if (previous === undefined) delete process.env.COLLECT_ENABLED;
    else process.env.COLLECT_ENABLED = previous;
  }
});

test("dynamic POST policy refuses mutations, credentials, empty bodies and other origins", () => {
  const origin = "https://os.xtnl.org.cn/";
  const allowed = (path: string, body: string) => publicReadPostAllowed(new URL(path, origin).href, origin, Buffer.from(body));
  assert.equal(allowed("/index.do", "op=matchlist"), true);
  assert.equal(allowed("/signup.do", "op=entry"), false);
  assert.equal(allowed("/index.do", "op=delete"), false);
  assert.equal(allowed("/index.do", "op=matchlist&token=secret"), false);
  assert.equal(publicReadPostAllowed("https://other.example/index.do", origin, Buffer.from("op=matchlist")), false);
  assert.equal(publicReadPostAllowed(new URL("index.do", origin).href, origin, null), false);
});
