# 竞赛真实数据恢复与资源联调

2026-10-20。开发库可通过原备份恢复，或使用已有Agent重新生成真实候选；两条路径都必须保留来源、修订、展示身份及费用证据。Git／ZIP内的历史验收报告不能替代原数据库。

## 1. 运行前核对

```powershell
node --env-file=.env modules/learning-resources/scripts/check-competition-runtime.ts --output .data/competition-preflight.json
```

只读检查31项材料／候选／展示数量、现有竞赛预算记录、模型配置是否存在及开关，不输出密钥，不请求模型。当前本机材料／修订／展示0，未配置模型；详见共享资源模块verification/2026-10-20-source-review.md。仅检查配置存在性，不证明接口有效。

若取得原备份，先恢复到独立数据库进行只读审计，核对材料ID、候选引用、学校认定、展示版本及费用记录，保留本地资源库。禁止直接用整库恢复覆盖已有89条资源或原业务库；先审查具体恢复／导入计划。恢复旧预算账本后也不能默认开启长期任务。

## 2. 通过既有Agent重新获取

真实调用前需要明确模型配置文件路径和本次费用上限；不在聊天或Git中保存密钥。现有competitionChat仅接受已核价的官方deepseek-flash配置，不能把空库中没有预算记录视为旧授权余额。使用新预算前必须明确批次和硬上限，并核对当前模型定价，不能自动开第三轮或改旧账。

满足配置、预算后使用现有入口：先单项`modules/competition/scripts/ingest.ts --id competition-XXX --auto`验证，再用`ingest-catalogue.ts --ids ...`逐项扩展到31项。采集／模型开关仅在本次任务进程启用，不改开发默认开关，不启动常驻worker。失败、预算停止或来源限制保留真实原因。

运行后用`modules/competition/scripts/audit.ts`独立读回，核名称、年份、官方身份、赛段、延期范围及引用材料；缺字段保留未知。确认真实候选后通过既有addEdition／selectDisplay及审计选择本机展示版本。2026-10-14的publish-initial.ts固定旧修订ID，不能用于新库直接发布新候选，也不能改历史验收JSON来绕过它。

## 3. 真实HTTP联调

```powershell
node --env-file=.env modules/competition/scripts/verify-resources.ts --base http://localhost:3000 --output .data/competition-live-resources.json
```

脚本分页读取真实公开列表，要求批准名单31项各有真实展示届次；逐项核对详情身份／版本／材料来源、资源类型和适用竞赛／年份／届次、内部字段不泄漏，以及精选资源是否出现在正确页面。缺少真实届次时逐项报告并退出1，空库不会绿色通过。人工撤回精选资源时会要求核对清单，不恢复撤回记录。

此脚本不负责自动发布或构造数据；HTTP通过后还需实际浏览器逐项打开稳定届次，验证经验／视频卡片、手机布局、原平台返回及未知／失效状态。现有31项页面夹具仍是代码回归证据，不是真实内容联调。

当前真实报告为0／31，全部缺公开展示届次；资源后台已实机核对89条／31项覆盖。补充资源清单含48经验分享（包含高校摘要）、27视频／官方培训入口、14草稿，第11／16／23项仍缺可发布个人经验。
