import { randomUUID } from "node:crypto";
import { sql, type Tx } from "@aihot/backend/db";
import { audit, Conflict } from "@aihot/backend/audit";
import type { AdmissionNotice, AdminNotice } from "@aihot/contracts/admission";
import { commandSchema, idSchema, identityKey, saveSchema, validatePublication, validateSchool } from "./domain.ts";

interface Row { id: string; draft: AdmissionNotice; published: AdmissionNotice | null; version: number; updated_at: Date }
const view = (row: Row): AdminNotice => ({ id: row.id, draft: row.draft, published: row.published, version: row.version, updatedAt: row.updated_at.toISOString() });
export async function adminNotices() {
  return (await sql<Row[]>`SELECT id, draft, published, version, updated_at FROM admission_notices ORDER BY updated_at DESC LIMIT 200`).map(view);
}
export async function saveNotice(input: unknown, actor: string, transaction?: Tx) {
  const body = saveSchema.parse(input);
  validateSchool(body.notice);
  try {
    const save = async (tx: Tx) => {
      const id = body.id ?? randomUUID();
      const [before] = await tx<Row[]>`SELECT * FROM admission_notices WHERE id = ${id} FOR UPDATE`;
      if (body.notice.source.verification === "machine" && actor !== "worker.admission") throw new Conflict("机器校验记录只能由升学处理任务写入；人工录入请使用人工核验");
      if ((body.id && !before) || (before && body.expectedVersion !== before.version)) throw new Conflict("内容已变化，请刷新后重新编辑");
      if (before?.published && identityKey(before.published) !== identityKey(body.notice)) throw new Conflict("请先撤回公告，再修改院校、年份、院系、专业、路径、阶段或批次");
      const [after] = before
        ? await tx<Row[]>`UPDATE admission_notices SET draft = ${tx.json(body.notice)}, identity_key = ${identityKey(body.notice)}, version = version + 1, updated_at = now() WHERE id = ${id} RETURNING *`
        : await tx<Row[]>`INSERT INTO admission_notices (id, identity_key, draft) VALUES (${id}, ${identityKey(body.notice)}, ${tx.json(body.notice)}) RETURNING *`;
      await audit(actor, "admission.save", `admission:${id}`, body.reason, before?.draft ?? null, after.draft, { db: tx });
      return view(after);
    };
    return await (transaction ? save(transaction) : sql.begin(save));
  } catch (error) {
    if ((error as { code?: string }).code === "23505") throw new Conflict("同院校、院系、专业、年份、路径、阶段与批次的公告已存在，请编辑原记录");
    throw error;
  }
}
export async function changePublication(idInput: unknown, action: "publish" | "withdraw", input: unknown, actor: string, transaction?: Tx) {
  const id = idSchema.parse(idInput);
  const body = commandSchema.parse(input);
  const change = async (tx: Tx) => {
    const [before] = await tx<Row[]>`SELECT * FROM admission_notices WHERE id = ${id} FOR UPDATE`;
    if (!before || before.version !== body.expectedVersion) throw new Conflict("内容已变化或已移除，请刷新后再操作");
    if (action === "publish") validatePublication(before.draft);
    const published = action === "publish" ? before.draft : null;
    const [after] = await tx<Row[]>`UPDATE admission_notices SET published = ${published ? tx.json(published) : null},
      version = version + 1, published_version = ${published ? before.version + 1 : null},
      published_at = ${published ? new Date() : null}, updated_at = now() WHERE id = ${id} RETURNING *`;
    await audit(actor, `admission.${action}`, `admission:${id}`, body.reason, before.published, published, { db: tx });
    if (published) {
      const fields = before.published ? Object.keys(published).filter(key => JSON.stringify(before.published![key as keyof AdmissionNotice]) !== JSON.stringify(published[key as keyof AdmissionNotice])) : ["new"];
      await tx`INSERT INTO admission_changes(notice_id,version,kind,fields) VALUES(${id},${after.version},${before.published ? "updated" : "new"},${tx.json(fields)}) ON CONFLICT DO NOTHING`;
    }
    return view(after);
  };
  return transaction ? change(transaction) : sql.begin(change);
}
