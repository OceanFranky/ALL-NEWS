import { Form, Link } from "react-router";
import type { ResourceCoverage, ResourceList } from "@aihot/contracts/learning-resources";
import { adminGet } from "@aihot/web/lib/admin.server";
import { AdminPage, Badge, Button, Card, DataTable, Input } from "@aihot/web/features/admin/ui";

export async function loader({ request }: { request: Request }) {
  const [list, coverage] = await Promise.all([
    adminGet<ResourceList>(request, `/api/admin/resources${new URL(request.url).search}`),
    adminGet<ResourceCoverage[]>(request, "/api/admin/resources/coverage"),
  ]);
  return { list, coverage, q: new URL(request.url).searchParams.get("q") ?? "" };
}
export const headers = () => ({ "Cache-Control": "no-store" });
export const meta = () => [{ title: "经验帖与教学视频 · 后台" }];
export default function ResourcesAdmin({ loaderData: { list, coverage, q } }: { loaderData: Awaited<ReturnType<typeof loader>> }) {
  const pageLink = (page: number) => `?${new URLSearchParams({ q, page: String(page) })}`;
  return <AdminPage title="经验帖与教学视频" subtitle="人工录入原文链接，核对适用竞赛与届次后审核发布。编辑后需要重新审核。" actions={<div className="flex gap-4"><Link className="text-accent" to="/admin/resources/maintenance">自动维护</Link><Link className="text-accent" to="/admin/resources/new">＋录入资源</Link></div>}>
    <Card title="资源列表"><Form method="get" className="mb-4 flex gap-2"><Input key={q} defaultValue={q} name="q" aria-label="搜索资源" placeholder="标题或原文链接" /><Button type="submit">搜索</Button></Form>
      <DataTable rows={list.items} rowKey={item => item.id} empty="暂未收录资源，可先录入经过核实的经验帖或视频。" columns={[
        { key: "title", label: "资源", render: item => <Link className="text-accent" to={`/admin/resources/${item.id}`}>{item.data.title}</Link> },
        { key: "kind", label: "类型", render: item => item.data.kind === "video" ? "教学视频" : "经验帖" },
        { key: "state", label: "审核状态", render: item => <Badge tone={item.status === "published" ? "ok" : "muted"}>{{ draft: "待审核", published: "已发布", withdrawn: "已撤回" }[item.status]}</Badge> },
        { key: "links", label: "关联", render: item => `${item.links.length}个范围` },
      ]} />
      <nav className="mt-4 flex gap-4 text-[13px]" aria-label="资源分页">{list.page > 1 && <Link to={pageLink(list.page - 1)}>上一页</Link>}<span>第{list.page}页 · 共{list.total}条</span>{list.page * 30 < list.total && <Link to={pageLink(list.page + 1)}>下一页</Link>}</nav>
    </Card>
    <div className="mt-5"><Card title="竞赛资源覆盖与待补清单"><p className="mb-3 text-[13px] text-ink-3">统计已发布、未失效的资源。具体届次仍按关联范围核对；有卡片区域不代表内容覆盖完成。</p><DataTable rows={coverage} rowKey={item => item.competitionId} empty="请先导入竞赛名单。" columns={[
      { key: "name", label: "竞赛", render: item => item.name }, { key: "experience", label: "经验帖", render: item => item.experience }, { key: "video", label: "视频", render: item => item.video }, { key: "reason", label: "待补事项", render: item => item.reason },
    ]} /></Card></div>
  </AdminPage>;
}
