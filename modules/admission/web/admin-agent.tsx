import { data, useLoaderData, useRevalidator, type LoaderFunctionArgs } from "react-router";
import type { AgentTasks } from "@aihot/contracts/admission-agent";
import { adminGet } from "@aihot/web/lib/admin.server";
import { useAdminAction } from "@aihot/web/features/admin/action";
import { buttonClass } from "@aihot/web/components/ui/Controls";
import { AgentTaskCard } from "./agent.tsx";
export const headers = () => ({ "Cache-Control": "no-store" });
export async function loader({ request }: LoaderFunctionArgs) { return data(await adminGet<AgentTasks>(request, "/api/admin/admissions/agents"), { headers: headers() }); }
export default function AdminAgent() {
  const { items } = useLoaderData<typeof loader>(), command = useAdminAction(), revalidator = useRevalidator();
  return <div className="pb-10"><h1 data-page-title className="text-2xl font-semibold text-ink">升学简报任务管理</h1><p className="my-4 text-sm leading-7 text-ink-3">共享目标暂停会影响所有关注者。恢复使用原材料检查点与既有累计预算，不能绕过人工核对或撤回保护。运行中的步骤持锁，请结束后再操作。</p><button className={`${buttonClass()} mb-5`} onClick={() => revalidator.revalidate()}>刷新任务状态</button><div className="space-y-6">{items.map(task => <section key={task.id}><AgentTaskCard task={task} /><div className="mt-3 flex gap-3">{([task.enabled ? "pause" : "resume", "retry"] as const).map(action => <button key={action} className={buttonClass()} disabled={command.busy} onClick={() => void command.run("POST", `/api/admin/admissions/agents/${task.id}`, { action }, { success: "任务状态已更新" })}>{action === "pause" ? "暂停目标" : action === "resume" ? "恢复目标" : "从检查点重试"}</button>)}</div></section>)}</div></div>;
}
