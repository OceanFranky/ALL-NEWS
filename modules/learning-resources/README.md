# 经验帖与教学视频：R1 资源管理

对应 `docs/student-platform-requirements.md` 的 R1。资源与关联独立保存，供竞赛及后续升学资源复用；本版只接入已存在的竞赛身份，不虚构升学对象。支持人工录入及受控维护发现，发布仍需人工审核；维护不调用模型。

## 操作

后台 `/admin/resources` 提供资源搜索、分页和竞赛覆盖清单；`/admin/resources/new` 录入，`/admin/resources/:id` 编辑、审核、撤回及查看历史。未提供作者、日期、时长或封面时保留未知；封面必须记录使用依据。内容介绍需要说明来自原文、简介、字幕或人工整理。不会下载、转存视频。

资源可关联多个竞赛和范围。未限定届次和年份表示跨届通用；具体届次必须属于所选竞赛。年份与已知届次年份冲突时拒绝保存。范围填写适用赛段／方向，关联理由仅后台可读。解除关联通过编辑后保存完成。

保存产生新版本并转为待审核，旧公开内容立即停止展示。发布需要已核验、至少一个有效关联且未标记失效；临时访问失败可保留，但读者看到通用提示。撤回与编辑都立即影响公开读取。审核和保存携带当前版本；其他管理员已经改动时返回409，避免覆盖。原文URL按标准URL序列化、移除片段后判重，不擅自移除可能改变资源身份的查询参数。

每次修改在同一事务保存历史快照和 `audit_log`，记录操作者、说明及前后状态。后台历史展示最近100个版本，数据库保留全部版本。

## 接口

| 方法与路径 | 用途 |
| --- | --- |
| `GET /api/admin/resources?q=&page=1` | 每页30条，搜索标题或原文URL |
| `GET /api/admin/resources/targets` | 现有竞赛及稳定届次 |
| `GET /api/admin/resources/coverage` | 已发布且未失效的资源数量与待补提示，按竞赛汇总 |
| `POST /api/admin/resources` | 新建：`expectedVersion:0`、`reason`、`data`、`links` |
| `GET /api/admin/resources/:id` | 当前资源及修订历史 |
| `PUT /api/admin/resources/:id` | 替换元数据及全部关联，必须提供当前版本与说明 |
| `POST /api/admin/resources/:id/review` | `action:publish/withdraw`、`expectedVersion`、`reason` |
| `GET /api/v1/competitions/:competitionId/editions/:editionId/resources` | R2使用的经验帖／视频分组；仅返回当前可见届次的适用资源 |

请求与响应类型在 `packages/contracts/src/learning-resources.ts`。后台复用管理员会话与CSRF；公开接口通过统一 `publication/modules` 读取，使用 `no-store`，排除草稿、撤回、失效、错误竞赛及其他年份／届次关联。竞赛详情撤回后资源接口也返回404。内部封面使用依据、访问失败原始记录与关联理由不公开。

覆盖清单统计竞赛层面的已发布关联数量，不能当作所有届次、赛段均覆盖的证明。R2通过此接口接详情区域；其实现和验证在 `codex/competition-resources`。实际31项逐届内容仍需验收，缺少真实资源时保留空态，不能用测试夹具补数。

## 部署与回退

`0068_learning_resources`、`0069_learning_resource_links`、`0070_learning_resource_history` 只创建新表；先执行根目录迁移。站点已注册模块，Docker复制其package清单。无需新增模型、采集开关或费用授权。

回退时先停止资源写入、关闭依赖新接口的页面，再回退应用；保留三个新表与审计，不删已有数据。未来升学接入沿用资源元数据、审核和历史，增加真实目标的关联规则。

## 当前内容边界

2026-10-19按使用者补资源并完成接入的授权整理85条真实来源记录，71条通过内容筛选，14条保留草稿。已核验部分包括45条经验分享（含长文、方案合集、学习笔记及明确标注的高校摘要）和26条视频页面／官方培训入口，覆盖差异见 [逐项报告](RESOURCE-COVERAGE.md)。未逐一播放视频，不把简介作为字幕或观看总结。第11、16、23项仍缺可发布经验，不能称31项全部配齐。

小红书公开搜索返回安全限制300012；官方开放平台本次核实为电商接口，未确认通用笔记搜索能力。没有安装第三方抓取器、绕过登录／验证码或调用收费API。真实小红书原文链接可用现有后台录入；仅搜索标题不满足发布核验。

## 精选清单导入

2026-10-20增补4条后，共89条：48条经验分享／高校培训摘要和27条视频页面／官方入口已筛选，14条草稿。新增内容与官方通知的区别、未收录原因见[本日核验记录](verification/2026-10-20-source-review.md)。原证据日期保留，清单更新日期不表示重新核验了全部旧资源。

清单在 `seeds/competition-resources.json`，保存来源URL、核验日期／方式、短介绍、范围、发布建议及31项缺口。先导入竞赛名录和迁移，再运行：

```powershell
# 默认只预览，无写入；--publish表示预览经过筛选的发布子集
node --env-file=.env modules/learning-resources/scripts/import-curated.ts --publish
# 在目标开发库实际导入；只有decision=publish的记录发布，其他留草稿
node --env-file=.env modules/learning-resources/scripts/import-curated.ts --apply --publish
# 生成可审查的离线覆盖报告（不代表数据库实时状态）
node --env-file=.env modules/learning-resources/scripts/report-curated.ts --output modules/learning-resources/RESOURCE-COVERAGE.md
```

省略 `--publish` 时全部新记录为草稿。导入复用后台保存／审核和审计；预先验证整份清单格式及竞赛身份，按URL跳过已有资源，不覆盖编辑、不恢复撤回。每条写入是独立事务，中断后可以重跑接续；整体不是单个事务。普通片段锚点去重，`#/`与`#!/`应用路由保留；小红书等平台的身份查询参数不任意删除。原始证据与审核建议不替代管理员以后重新检查。

公开接口只显示已审核资源，优先官方，其次按已知发布日期排序。旧届资源以不限届次的方法参考接入，在标题、简介、范围中注明原年份和赛道；不表示旧赛规适用于本届。真正只适用于某一届／年份的操作规则，仍应使用限定关联。

本地开发库目前只有31项名录，没有竞赛材料／修订／展示版本；接入真实详情仍需恢复原数据库备份。不会造届次填补它，测试夹具只在隔离测试库使用。维护默认关闭，未启用常驻worker、模型或外部发布。

## 受控自动维护

竞赛Agent统一入口已接入资源发现与到期复查；正常／unchanged／失败均记录资源阶段，配置 `competitionAgentEnabled` 可单独停止。已保存材料中的链接无需额外启用来源页，仍受全局采集阀和数量限制。没有额外模型调用，新候选只入待审核。详见维护手册的「与竞赛Agent一起执行」。

后台 `/admin/resources/maintenance` 可设置来源、逐项复查间隔、请求／候选／检查上限，预览、运行一次、停止及查看报告。参见 [维护操作说明](MAINTENANCE.md)。
