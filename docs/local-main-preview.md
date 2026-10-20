# 2026-10-20 本机main预览部署

## 入口与代码

- 项目原目录已切换main并pull至`8a9233d`；使用者原有docker-compose.yml两行注释改动完整保留。
- 从该main代码构建镜像`all-news-local:8a9233d`，实际运行`all-news-main-api`和`all-news-main-web`。
- 本机入口：http://localhost:3000/；升学正式列表`/admissions`，明确标注的4条虚构流程示例`/admissions?dataset=demo`，目标简报入口`/admissions/agent`。
- Web只绑定127.0.0.1:3000，API仅Docker网络可达；本次未更新公网服务器。

## 数据与运行边界

启动Docker后核对本项目worker均停止；原有news worker仍为exited，不启动任何新worker。采集、模型、升学自动化、全部飞书及IndexNow开关均false。页面查询不产生付费请求；目标任务可以提交保存，但没有worker消费，不能把等待状态当作真实分析完成。

从`aihot-db-1`中的`all_news_unified`完整备份并恢复为独立`all_news_main_preview_20261020`，仅对副本应用12份新增升学迁移，不覆盖原库。副本保存592条原材料（AI351／world241）、31项竞赛展示，4100回执／4138尝试；本机没有升学真实公告，正式列表如实为空，4条示例不写入真实公告表。此数据不包含协作者服务器上的升学资料，不能将本次代码同步称为同步了远端运营数据库。

私有备份及容器环境文件在`/Users/Admin1/.codex/backups/all-news/2026-10-20-local-main/`，目录0700、文件0600，不提交Git。复用已有附件卷`aihot_data`及网络`aihot_default`。旧`aihot-integrated-api`和`aihot-integrated-web`已正常停止并保留；旧镜像、数据库及数据卷均保留。

## 验证

镜像构建、12迁移、站点smoke30项及MCP契约通过。浏览器1440×1000／390×844检查首页、世界、竞赛、升学正式／示例列表、Agent与院校目录共14次页面读取，均HTTP200、无页面运行异常及横向溢出。实际界面截图已查看。读取后回执4100／尝试4138未增加；采集及模型阀均false。本次没有业务代码变更，不重复刚通过的937后端／65Web等完整回归。

## 启停与回退

Docker命令在本机完整路径为`/Applications/Docker.app/Contents/Resources/bin/docker`。下列docker命令需将该目录加入PATH或使用完整路径。

```bash
# 重启当前预览，不启动worker。
docker start aihot-db-1 all-news-main-api all-news-main-web
# 暂停预览。
docker stop all-news-main-web all-news-main-api
# 回退旧版网页及API，先停新版，避免3000端口竞争。
docker stop all-news-main-web all-news-main-api
docker start aihot-db-1 aihot-integrated-api aihot-integrated-web
```

不要用项目原目录普通compose up替代此预览升级：其默认数据库和worker与本次独立预览不同，可能启动未授权处理。本次仅创建预览容器，不改原compose。后续如需真实升学数据，应另确认来源数据库／备份与迁移范围，保留既有费用账本和审核记录。
