# NEXUS 共享运行结果

这份快照让贡献者直接查看已跑出的内容，无需重新抓取或调用模型。它是已经脱敏的公开数据集，不是生产库备份。

当前文件：`nexus-2026-10-23.dump`，约 1.8 MB。完整表计数、导出时间和 SHA-256 校验值见同名 `.dump.json`；配套格式为 `nexus-public-snapshot-v1`。

| 内容 | 数量 |
|---|---:|
| 已公开新闻记录（含行业与世界） | 693 |
| 行业精选（网页口径） | 94 |
| 世界动态 | 169 |
| 竞赛届次 | 31 |
| 经验资源 | 48 |
| 视频／培训资源入口 | 27 |
| 升学公告 | 159 |
| 行业日报／周报／月报已有报告 | 8 |
| 世界已批准日报版本 | 4 |

数量采用 2026-10-23 的快照时点。时间窗、报名截止、内容更新会影响“今天”“最近一周”和热点展示；不修改原发布时间让历史数据冒充当天资讯。94 条行业精选包含网页阅读分组，机器同步快照按事实代表席位去重，数量可能不同。

保留摘要、公开事实／事件关联、报告、原文链接、竞赛届次、资源关联、升学核验标识与发布版本。已经验证恢复后的 159 条升学详情、31 条竞赛详情和 75 条资源关联与原库一致。

不包含密钥、账户／登录状态、反馈、费用／回执、后台审计、任务队列、个人升学目标、未发布草稿、抓取原文、附件全文和翻译全文。新闻只提供摘要模式。信源采集已停用，信源私有配置被清空；如以后需要自行更新，应重新核对并配置来源，不直接沿用原站后台状态。

快照包含资料索引与摘要，不包含第三方图片／视频文件。原文、图片和视频的权利仍归其来源；代码许可证不授予第三方素材的再分发许可。

## 首次 Docker 部署并带数据

要求 PostgreSQL 17 或更新的客户端。项目 Docker 镜像已带 PostgreSQL 17 客户端，所以可直接在容器内导入。**仅对全新空数据库操作**：导入器会拒绝覆盖已有表，不会自动删除原库。

1. 按项目部署文档准备 `.env`，生成自己的管理员／会话及图片代理密钥。将 `COLLECT_ENABLED`、`MODEL_CALLS_ENABLED`、`ADMISSION_AUTOMATION_ENABLED`、所有 `FEISHU_*_ENABLED` 和 `INDEXNOW_SUBMIT_ENABLED` 保持 `false`。不要复用别人 `.env`。
2. 只启动数据库并构建镜像，此时不要运行 setup：

   ```bash
   docker compose up -d --wait db
   docker compose build setup
   ```

3. 在 setup 第一次迁移前，导入快照：

   ```bash
   docker compose run --rm --no-deps setup node scripts/community-snapshot.ts restore data/community/nexus-2026-10-23.dump
   ```

   如果提示数据库已有表，说明不是空库。请保留原库，改用新的独立部署目录与 Compose 项目（`docker compose -p nexus-contributor ...`，后续所有步骤保持同一项目名）；不要删除已有卷来强行导入。

4. 再按常规顺序迁移与启动，只运行 API／Web 即可查看现成数据：

   ```bash
   docker compose run --rm setup
   docker compose up -d api web
   ```

访问 `http://localhost:3000`。快照自带已执行迁移记账，setup 只补未来新增迁移。没有启动 worker，也不需要模型 API Key；图片代理和管理员等本机密钥仍需按原部署要求独立生成。

## 非 Docker 导入

先创建一个空的 PostgreSQL 数据库，把 `.env` 中的 `DATABASE_URL` 指向它；安装 Node.js 24 和 PostgreSQL 17+ 客户端，完成 `npm ci`，再运行：

```bash
node --env-file=.env scripts/community-snapshot.ts restore data/community/nexus-2026-10-23.dump
node --env-file=.env scripts/migrate.ts
```

随后按部署文档启动 API／Web，采集和模型开关保持关闭。无需先执行 seed 或 migrate，它们会创建表，导致首次恢复被拒绝。

## 维护快照

导出只读原库，在另建的临时库中脱敏；临时库必须尚不存在、以 `_share_test` 结尾，结束自动删除。需要源库读取权限及临时库建库权限。不要把原库地址填进临时库配置。

```bash
# 在未跟踪的本机 .env 中设置 DATABASE_URL 和 SNAPSHOT_SCRATCH_URL
node --env-file=.env scripts/community-snapshot.ts export data/community/nexus-2026-10-23.dump
```

更新前先审查脱敏规则，更新后重新恢复验证并同步本页计数与测试。共享文件只有 `.dump`、`.dump.json` 和本说明，临时原始备份不会写入仓库。此快照用于开发预览，不承诺恢复付费工作流历史或继续原有私有任务。
