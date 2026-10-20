import { useState } from "react";
import type { PublicNotice } from "@aihot/contracts/admission";
import { useChecklist } from "./stars.ts";
import { materialRows } from "./visual-data.ts";

function MaterialCell({ item, text }: { item: PublicNotice; text: string }) {
  const { checked, toggle } = useChecklist(item.id, item.version); const [failed, setFailed] = useState(false);
  return <td className="border-b border-line px-1 py-2 text-center align-middle"><label className={`mx-auto flex min-h-11 w-11 items-center justify-center rounded-lg ${checked.includes(text) ? "bg-accent-soft" : "bg-bg-sunk"}`}><input type="checkbox" className="size-4 accent-teal-700" aria-label={`${item.title}：${text}`} checked={checked.includes(text)} onChange={() => setFailed(!toggle(text))} /></label>{failed && <span role="status" className="block text-xs leading-5 text-ink-3">保存失败</span>}</td>;
}

export function MaterialMatrix({ items }: { items: PublicNotice[] }) {
  const rows = materialRows(items);
  const common = rows.filter(row => row.targetIds.length > 1).length;
  return <section aria-labelledby="matrix-title" className="mt-5 min-w-0 rounded-2xl border border-line bg-surface p-4 sm:p-6" data-material-matrix>
    <div className="flex flex-wrap items-end justify-between gap-3"><h3 id="matrix-title" className="font-serif text-xl font-bold text-ink">一眼看清，哪些材料重复出现</h3><p className="text-xs leading-6 text-accent">{common}项相同条目被多个目标列出</p></div>
    <p className="mt-3 text-xs leading-6 text-ink-3">仅按完全相同的材料文字归组，相近名称分开列出。每格对应一个目标，分别勾选；模板、签章与提交版本仍须逐校核对。</p>
    <details className="mt-4 border-y border-line py-3 text-xs leading-6 text-ink-3"><summary className="min-h-7 cursor-pointer font-medium text-accent">核对各列的院系、专业与批次</summary><ol className="mt-3 space-y-3">{items.map((item, index) => <li key={item.id} className="break-words"><p className="font-medium text-ink">0{index + 1} · {item.school.name} · {item.year}级</p><p>{item.department} / {item.programme} / {item.batch}</p></li>)}</ol></details>
    {rows.length ? <table className="mt-5 w-full table-fixed border-collapse text-sm"><caption className="sr-only">所选目标的申请材料重合情况。复选框表示该目标公告列出的材料；破折号表示该条目尚未列出，不代表不需要。</caption><colgroup><col style={{ width: "44%" }} />{items.map(item => <col key={item.id} />)}</colgroup><thead><tr><th scope="col" className="border-b border-line py-3 pr-2 text-left text-xs font-semibold text-ink-3">材料原始要求</th>{items.map((item, index) => <th scope="col" key={item.id} className="break-words border-b border-line px-1 py-3 text-center align-top"><span className="block font-mono text-xs font-medium text-accent">0{index + 1}</span><span className="mt-1 block text-xs font-medium leading-5 text-ink">{item.school.name}</span></th>)}</tr></thead><tbody>{rows.map(row => <tr key={row.text}><th scope="row" className="break-words border-b border-line py-3 pr-3 text-left align-middle text-xs font-normal leading-6 text-ink-2">{row.text}{row.targetIds.length > 1 && <span className="mt-1 block text-xs text-accent">{row.targetIds.length}个目标列出</span>}</th>{items.map(item => row.targetIds.includes(item.id) ? <MaterialCell key={`${item.id}:${item.version}`} item={item} text={row.text} /> : <td key={item.id} className="border-b border-line px-1 py-3 text-center text-ink-3"><span aria-label={`${item.school.name}尚未列出此条材料`}>—</span></td>)}</tr>)}</tbody></table> : <p className="mt-5 text-sm leading-7 text-ink-3">所选目标的材料尚未整理，请先核对官方原文。</p>}
    <p className="mt-4 text-xs leading-6 text-ink-3">勾选＝该目标下自行标记已备齐；—＝此条目尚未列出，不表示不需要。勾选与下方清单、详情页同步，不代表已提交或资格审核通过。</p>
  </section>;
}
