# 竞赛资源Agent接入与GitHub上传

日期：2026-10-20。目标仓库：[OceanFranky/ALL-NEWS](https://github.com/OceanFranky/ALL-NEWS)。本次修改仅在功能分支工作区，未提交、推送或合并main。

## 最终行为

原 `ingest.ts`、`ingest-catalogue.ts`、`competition.ingest` 均走统一 `ingestCompetition`。每项竞赛结束详情阶段后，同步执行资源发现和到期复查；详情unchanged、材料失败、预算停止也会记录资源阶段。资源故障保留原详情结果。

复用已保存材料中的真实视频／经验链接，同源优先；可加管理员启用的当前竞赛发现页。新内容只进入未核验草稿，人工审核发布后由R2详情HTTP接口展示。未知发布日期、适用年份和作者保留未知；HTTP200不等于内容优质或视频可播放。资源阶段没有额外模型调用。

后台 `/admin/resources/maintenance` 提供独立Agent开关、请求／候选上限、停止及报告；默认Agent接入为true，但本机采集总阀仍关闭，额外来源初始逐项关闭。单次原竞赛CLI即可执行，不需第二次启动资源脚本。单独队列消费者 `modules/competition/scripts/worker.ts` 不自动排31项或启动新闻采集。

完整运行、限制及故障处理见[维护手册](../modules/learning-resources/MAINTENANCE.md)。本机尚缺真实竞赛模型配置及当前预算授权，本次没有启动真实31项付费获取；31项联合测试为本地HTTP夹具，不能当作真实内容覆盖。

## 分支与上传顺序

| 顺序 | 本地目录 | GitHub分支 | 要交付的内容 |
| --- | --- | --- | --- |
| 1 | `D:\pycharm\数媒竞赛\ALL-NEWS-dev` | `codex/resource-management` | R1资源管理、维护、资源清单、竞赛Agent接入及依赖、迁移、后台、测试和文档 |
| 2 | `D:\pycharm\数媒竞赛\ALL-NEWS-resources` | `codex/competition-resources` | 先同步R1提交，再只提交R2详情资源区域及真实联调工具等增量 |

两分支起点均为 `89ca543`。R2当前包含R1未提交副本；不要将共享模块当成两份独立实现反复提交。先审查并提交R1，再在妥善保留R2增量的前提下同步R1提交，让R2的PR以R1为依赖分支。最终是否合并main由使用者决定。本次无需另改旧 `codex/competition` 分支，也不用上传ZIP解压目录。

## R1必须包含

- `modules/learning-resources/` 整个模块：backend、api、web、迁移0068–0074、seeds、scripts、tests、说明与核验报告。`seeds/competition-resources.json` 保存现有精选资源链接，`seeds/maintenance-sources.json` 保存31项额外发现页及默认限制；数据库本身不会随Git上传。
- `packages/contracts/src/learning-resources.ts`：资源／维护契约及新 `competitionAgentEnabled` 默认值、竞赛任务关联。
- `modules/competition/backend/workflow.ts`、`modules/competition/backend/resource-stage.ts`、`modules/competition/scripts/ingest.ts`、`modules/competition/scripts/ingest-catalogue.ts`、`modules/competition/scripts/worker.ts`、`modules/competition/WORKFLOW.md`：原Agent接入、可选资源阶段及专用消费者。
- `site/modules/index.ts`、`site/modules/server.ts`、`site/modules/web.ts`、`site/modules/competition-resources.ts`、`site/package.json`、`Dockerfile`、`package-lock.json`：站点组合、模块注册、workspace与镜像依赖。两个模块不互相导入实现，新闻worker原隔离保持。
- `apps/web/tests/learning-resources.test.ts`、`apps/web/tests/resource-maintenance.test.ts`、`tests/daily-money.test.ts`、`tests/databases.ts`、`tests/world-competition.test.ts`：资源流程、模块注册与Windows测试库兼容。
- `docs/deploy.md`、`docs/student-platform-requirements.md`、`docs/local-resource-development.md`、本说明及 `aiwork.md`：部署、需求进度、开发与交接记录。

其中本次新增核心文件为 `modules/learning-resources/backend/competition.ts`、`modules/learning-resources/tests/competition-agent.test.ts`、`modules/competition/scripts/worker.ts`；其余包含前几轮尚未提交的资源接入成果，需一起审查以免只上传入口导致缺依赖。

## R2增量

- `modules/competition/web/detail.tsx`、`modules/competition/web/resources.tsx`。
- `modules/competition/scripts/verify-resources.ts`、`apps/web/tests/competition-resources.test.ts`。
- `docs/competition-real-data-integration.md`、`docs/competition-resources-development.md`、`modules/competition/verification/*resource*` 对应报告及R2 `aiwork.md`。

两树共享的资源模块、契约、原Agent接入和依赖应完全一致；这些随R1同步，不作为R2重复实现。

## 不上传的内容

`.env`、密钥、数据库连接凭据、`.data/`、数据库目录／备份、`node_modules/`、`apps/web/build/`、`.react-router/`、本机服务日志。原始全量测试日志可能含子进程连接参数，只在忽略目录保留，报告仅写脱敏结果。项目外的资源网址Markdown清单可保留本机，仓库已有正式种子和来源核验报告。

上传只分发代码、资源网址及配置模板；不会恢复原Mac数据库的真实竞赛详情、展示届次或运行数据。换机器需自行配置数据库并迁移，按手册预览／导入资源；原竞赛数据仍需原库恢复或获当前授权后重新运行Agent。

## 当前Git状态

所有成果仍为本地未提交改动。应按文件审查、分支提交后推送上述两个功能分支；不要直接提交main，不使用包含未知文件的宽泛暂存。最终验证记录见[本次核验报告](../modules/learning-resources/verification/2026-10-20-competition-agent-checks.md)。

### 上传执行记录

以上为交付审查时的状态。使用者随后明确要求“帮我传”，已授权提交和推送两个功能分支。R1从`ALL-NEWS-dev`交付；R2为保留原工作区，在`ALL-NEWS-upload`从R1创建`codex/competition-resources-publish`，仅添加R2增量，再正常推送至远端`codex/competition-resources`。原`ALL-NEWS-resources`未提交副本保留，不应再次重复提交。上传不合并main；GitHub分支及提交历史作为最终上传结果。

上传前main已更新至`8a9233d`，新增升学模块；已将其合入资源功能分支并解决9处模块注册、依赖、部署与日志冲突，保留双方功能及原提交历史。最新兼容整理通过类型检查、生产构建、93项竞赛／资源及跨模块回归、8项迁移安全、2项后台浏览器测试；此前全量结果与Windows限制仍见核验报告。没有向main写入提交。
