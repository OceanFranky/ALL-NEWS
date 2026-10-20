# 本机资源模块开发

2026-10-20更新：资源已增至89条（48经验分享／高校摘要、27视频页面／官方入口已发布，14草稿）；原竞赛材料／修订／展示仍为0。新增运行前检查：`node --env-file=.env modules/learning-resources/scripts/check-competition-runtime.ts`。本机没有模型配置，真实Agent重跑待配置路径与当前费用上限；下列10月19日85条记录为上一阶段状态。

日期：2026-10-19。工作目录 `D:\pycharm\数媒竞赛\ALL-NEWS-dev`；Git来源 `OceanFranky/ALL-NEWS`，分支 `codex/resource-management`，起点 `89ca543`。原ZIP解压目录保留，后续开发使用该Git克隆。

## 已准备的本机环境

- Node.js 24.15.0；PowerShell使用 `npm.cmd`，避免系统对 `npm.ps1` 的签名限制。
- 项目依赖已按锁文件安装；新模块的workspace链接与锁文件同步更新。
- 独立PostgreSQL 17.10，仅监听 `127.0.0.1:55432`；开发库 `student_resources_dev`、测试库 `student_resources_test`。没有安装系统服务。
- Windows PostgreSQL在中文安装／数据路径初始化时发生UTF8编码错误，因此便携程序与数据使用系统临时目录的英文路径。实际数据目录记录在 `.data/local-postgres-location.txt`。这是可重建的开发环境，系统清理临时目录可能移除它，不用于生产或唯一数据备份。
- 数据库配置和随机管理员密码在本地 `.env`，不提交Git。采集、模型、推送关闭，不启动worker。
- 开发库已执行迁移、导入31项名录及85条真实来源记录：45条经验分享、26条视频页面／官方培训入口已发布，14条待核验草稿。经验分享包含明确标注的高校摘要、学习笔记与方案合集；视频未逐一播放。覆盖与缺口见 [逐项清单](../modules/learning-resources/RESOURCE-COVERAGE.md)。尚无原环境竞赛详情。

## 当前机器上启动

在项目根目录打开三个PowerShell终端，分别执行：

```powershell
# 终端1：数据库，已经运行时不要重复启动
node .data/local-postgres.mjs
```

```powershell
# 终端2：API
node --env-file=.env apps/api/src/main.ts
```

```powershell
# 终端3：已构建的网页
node --env-file=.env apps/web/server.ts
```

后台地址 `http://localhost:3000/admin/resources`，使用 `.env` 的 `ADMIN_PASSWORD` 登录。改前端后重新执行 `npm.cmd run build -w @aihot/web` 并重启网页；也可以用 `npm.cmd run dev:web` 替代已构建网页，勿同时占用3000端口。

上述 `.data` 工具只属于当前本机，不随Git分发。其他协作者可直接安装PostgreSQL17、配置自己的 `.env` 和独立开发库，再执行：

```powershell
npm.cmd ci
npm.cmd run db:migrate
node --env-file=.env modules/competition/scripts/import-catalogue.ts
# 先预览，再向自己的开发库导入精选资源
node --env-file=.env modules/learning-resources/scripts/import-curated.ts --publish
node --env-file=.env modules/learning-resources/scripts/import-curated.ts --apply --publish
```

复制 `.env.example` 后必须先将 `COLLECT_ENABLED`、`MODEL_CALLS_ENABLED` 及推送开关设为 `false`。资源录入／审核无需模型密钥。导入名单不会恢复真实竞赛届次与详情，恢复详情需要核对原数据库备份。

## 验证

本机辅助脚本 `node --env-file=.env .data/run-tests.mjs` 将测试指向独立 `student_resources_test`；只在测试子进程启用连本地假服务所需的采集／模型开关，不修改开发 `.env`。标准协作环境按根目录AGENTS.md执行同样的完整检查。Windows对POSIX信号的支持差异可能影响既有SIGTERM测试，需如实记录，不通过删测试绕过。

资源操作、接口与数据边界见 [R1模块说明](../modules/learning-resources/README.md)。本机资源后台已核对85条记录、31项覆盖、1440／390宽度；[导入记录](../modules/learning-resources/verification/2026-10-19-import.json)保留实际数量及重复运行无写入的验证。第11、16、23项仍缺可发布经验，小红书公开搜索受限，未确认通用笔记搜索API。

R2已经在 `ALL-NEWS-resources` 接入详情资源区域；其共享依赖当前为R1未提交副本。审查后先提交R1，再让R2同步该提交并仅提交R2增量。不要把两个旧ZIP目录当成可提交分支。真实详情仍需从原数据库备份恢复，不能用测试夹具代替。
