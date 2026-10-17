import { data, useLoaderData, useRevalidator, type LoaderFunctionArgs } from "react-router";
import type { AdmissionImports } from "@aihot/contracts/admission";
import { adminGet } from "@aihot/web/lib/admin.server";
import { useAdminAction } from "@aihot/web/features/admin/action";
import { buttonClass } from "@aihot/web/components/ui/Controls";
import { ImportCard } from "./imports.tsx";
export const headers = () => ({ "Cache-Control": "no-store" });
export async function loader({ request }: LoaderFunctionArgs) { return data(await adminGet<AdmissionImports>(request, "/api/admin/admissions/imports"), { headers: headers() }); }
export default function AdminImports() {
  const { items, budget } = useLoaderData<typeof loader>(), command = useAdminAction(), revalidator = useRevalidator();
  return <div className="pb-10"><h1 data-page-title className="text-2xl font-semibold text-ink">升学来源处理</h1><p className="my-4 text-sm leading-7 text-ink-3">最近100个用户来源。累计模型保守记账{budget.accountedUpperCny.toFixed(4)}／{budget.limitCny}元；重新排队不会重置预算或已完成材料。暂停影响所有关注此链接的读者，运行中的任务请等处理结束再操作。</p><button className={`${buttonClass()} mb-5`} onClick={() => revalidator.revalidate()}>刷新处理状态</button><div className="space-y-5">{items.map(item => <section key={item.id}><ImportCard item={item} /><div className="mt-2 flex flex-wrap gap-3">{([item.enabled ? "pause" : "resume", "retry"] as const).map(action => <button key={action} className={buttonClass()} disabled={command.busy || item.status === "reading"} onClick={() => void command.run("POST", `/api/admin/admissions/imports/${item.id}`, { action }, { success: action === "pause" ? "已暂停来源" : "已重新排队" })}>{action === "pause" ? "暂停来源" : action === "resume" ? "恢复来源" : "重新排队"}</button>)}</div></section>)}</div>{!items.length && <p className="card p-6 text-sm text-ink-3">暂无用户添加的来源。</p>}</div>;
}
