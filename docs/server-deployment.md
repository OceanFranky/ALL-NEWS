# main 公网服务器部署记录

## 范围与安全边界

本次部署应用代码固定为本仓库 `main` 的 `ae6abe3`，包含行业信息、世界新闻、大学生竞赛及自动日报。部署工具和本记录保存在独立 `codex/server-deployment` 分支，不直接向main提交。

服务器系统盘已满、账号没有sudo权限，故不安装系统级Docker、不删除他人文件、不改已有服务。使用本人可写的数据盘目录作为 `$DEPLOY_ROOT`；源码、运行时、npm缓存、临时文件、数据库、附件和日志全部放在该目录。Node与PostgreSQL从官方发布文件取得并核对SHA256；数据库编译包含pg_trgm及现有搜索表需要的LZ4，不更改历史迁移或已有列的压缩方式。编译工具只通过 `apt download` 与 `dpkg-deb -x` 解包到私有目录，不安装进系统。

- Web对外监听3000；API只监听127.0.0.1:3001，PostgreSQL只监听127.0.0.1:15432，数据库socket位于私有目录。
- 后端读取 `server.env`，Web只读取不含密钥的 `web.env`。目录权限700、配置及备份600；不提交任何密钥、密码、数据库dump或附件到Git。
- 复用使用者指定的DeepSeek配置；管理员密码、会话密钥、图片签名及数据库密码重新随机生成，旧后台会话不能在新环境继续使用。管理员密码保存在服务器私有 `server.env`，不在聊天或日志输出。
- 迁移前正常停止本机worker；服务器成为唯一采集／付费任务执行端。复制 `providers.daily_spend` 及全部回执，不重置 `startedAt`、不清空当日额度，仍为AI／世界合计北京时间每天5元。预算不足时延后，不为立即看到新内容而重置额度。
- 只启用AI与world worker；竞赛展示版本、候选与运行记录迁移，但不启用竞赛自动采集。飞书与IndexNow推送保持关闭。

## 公网展示的确认记录

使用者明确要求全部数据（包括世界新闻）迁移并公网展示、开启采集与模型。原世界来源记录的LOCALHOST-ONLY范围不能默默沿用为公网许可；启用脚本仅在显式参数 `--operator-confirmed-public-summaries` 下，将这些旧记录改为可追溯的“站点操作人于本次迁移明确要求公网摘要展示”，保留原值于审计中。

这记录的是使用者的部署决定，**不是代理已核实第三方授权**，也不声称来源授予了转载许可。已另向使用者询问六源适用条款／许可依据，尚需使用者核实补充。不开放全文，不放宽材料充分性、分类、日期、归组、撤回或精选／热点阈值。正式持续运营前还需由使用者确认站点条款、隐私、来源使用范围和其他上线要求。

## 数据切换

1. 停止本机worker并等待任务收尾；保留本机原库、原容器和用户的compose改动。
2. 对统一库执行完整 `pg_dump -Fc`，对数据卷打包附件；私有备份留在本机与服务器。
3. 在专用新库恢复，使用 `deploy/database-manifest.sql` 对比public与pgboss所有表的行数和逐行JSON指纹；核对通过后才允许修改展示范围或启动任务。
4. 核对备份及附件归档的SHA256；在服务器运行迁移检查，沿用已发布迁移账本，不重跑种子来覆盖真实来源。
5. 使用 `deploy/activate-server.ts` 核对5元策略与安全阀、记录操作人决定和切换审计，然后启动服务。

首次试恢复暴露服务器编译缺少LZ4，恢复在搜索表处退出；只删除本次新建、未对外服务的部分恢复库后重新恢复，原备份与本机业务库不变。编译开关变化后清理旧对象再构建，不能通过改SQL或去掉列压缩绕过。

## 运行与维护

此处 `$DEPLOY_ROOT` 是服务器私有部署目录，不是本机仓库目录。

```bash
bash deploy/bootstrap-user-runtime.sh "$DEPLOY_ROOT"
python3 deploy/install-user-services.py "$DEPLOY_ROOT" ae6abe3
loginctl enable-linger "$USER"
systemctl --user daemon-reload
systemctl --user enable --now all-news-{postgres,api,web,worker}.service
systemctl --user status all-news-{postgres,api,web,worker}.service
```

四个独立systemd用户服务崩溃后自动重启，已启用linger后不依赖SSH窗口保持打开，重启主机也会启动。worker停止等待最多240秒，给现有付费调用收尾；停止／回退要先停worker，再停Web、API与数据库。不要同时恢复本机worker，否则两份数据库分别计账，无法保证全局每天5元。

```bash
systemctl --user stop all-news-worker.service
systemctl --user stop all-news-web.service all-news-api.service
systemctl --user stop all-news-postgres.service
```

日志在 `$DEPLOY_ROOT/logs/`。更新应用时先备份与停worker，在新的release目录准备main指定提交，更新用户服务WorkingDirectory与启动位置后再启动；不得把新旧worker同时开起来。旧数据库不得被新一次试恢复覆盖。

当前入口为公网IP的HTTP地址。配域名／HTTPS前，不建议通过不可信网络使用HTTP后台登录；应先建立SSH加密隧道使用管理入口，或完成HTTPS部署。SSH登录密码由使用者提供且已出现在聊天中，建议自行更换为强密码或SSH密钥；本次未擅自更改账号凭据。

## 2026-10-15 实际验收

- 公网入口：`http://36.140.177.23:3000`。实际部署目录为 `/data/wenhao/all-news-production`，应用release为 `releases/ae6abe3`。采用本仓库main归档传输，不在服务器保存GitHub登录凭据。
- 切换前完整迁移70张public／pgboss表，行数和UTC规范化逐行JSON指纹全部一致；最初时区不同导致JSON时间表示差异，统一UTC后核对一致，不通过改数据凑指纹。dump、附件归档及main源码归档在两端SHA256一致。库中AI349／world226条原材料，31项竞赛展示及168次竞赛运行全部保留，3917个回执／3955次尝试和原5元策略起算点完整迁移。
- 启动worker前，公网smoke全部通过；AI普通列表304条、世界117条、竞赛31项、当天日报6重点＋6快讯。公开页面读取后回执3917／尝试3955未增，后台未登录401；前后端没有开发身份绕过。
- 从本机外部访问1440桌面与390手机，行业五标签、世界日报／新闻详情、竞赛总览成功，无页面运行错误或横向溢出。图片未在本任务补齐；已有部分来源封面失败不作为全图可用声明。Browser插件未提供，使用仓库现有Playwright对公网地址验证。
- PostgreSQL／API／Web／worker四个用户服务均active且enabled，linger为yes；未重启共享主机做破坏性测试。外部不能连接3001和15432，仅3000公开。后端环境与Web无密钥环境分开；私有目录700，配置／备份600。系统盘仍满，本次未清理他人文件；数据盘剩余约35GB，部署占约1.2GB，后续需要关注容量和日志增长。
- 服务器实际任务已执行：世界分析、归组、综述及自动日报成功，首次采集世界6源成功、新增15条，AI12次成功、新增2条；3个AI来源（Google Research、Hugging Face、Mistral）失败，独立HTTPS连接测试亦超时。未擅自接入共享代理或替换来源；这些来源仍按原失败策略处理，不能称24源全部成功。
- 付费回执已继续增长，证明服务器真实模型处理在运行；复制原北京时间每天5元账期，未清零、未扩大限额。本机worker保持停止，竞赛运行仍168，飞书和IndexNow关闭。旧AI日报2026-10-14与2026-09月报因历史输入不足仍失败，属于原有缺期，不补造内容。
- 世界6源已按使用者明确公网摘要决定更新操作记录，原LOCALHOST值保留在审计；使用者未提供进一步第三方许可依据，正式运营核实责任仍待完成。只展示摘要／原文链接，无来源启用全文。
- 复验：类型检查、891项后端、Web构建、迁移检查、脚本语法、systemd单元校验及公网smoke通过；SSH隧道内随机密码登录成功，`dev=false`，不将密码发到公网HTTP。本轮前端全量58/60，两个既有导航缓存／预取性能时序用例失败；该文件独立重跑后预取用例通过、缓存意图用例仍失败，未改动其业务或断言，未宣称前端全绿。公网实际行业／世界／竞赛桌面手机验收通过，应用仍为此前CI通过的main提交。

后台入口为 `/admin`；服务器随机后台密码仅存于私有 `server.env` 的 `ADMIN_PASSWORD`。需查看时通过SSH登录本人账号，在服务器内读取，不要将环境文件整体贴到聊天、工单或Git。建议配置域名和HTTPS后再公开使用后台；当前管理可用SSH隧道：

```bash
ssh -L 3300:127.0.0.1:3000 wenhao@36.140.177.23
```

隧道建立后打开 `http://localhost:3300/admin`，管理流量走SSH；对外生成链接仍使用配置中的公网 `SITE_URL`。
