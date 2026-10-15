# 本机统一部署记录

日期：2026-10-15。代码：`codex/world-competition` 的 `2330a57`；本记录不代表PR已合并main。

后续按使用者要求仅更新前端导航，当前Web镜像为 `aihot-integrated:industry-navigation`，API及下述统一数据库不变；新版入口与回退见[行业信息导航](industry-navigation.md)。

## 数据来源与纠正

此前把Docker库482条文章都称作AI文章、把世界数据仅描述为早期107条试跑，均不准确。实际只读核对：原Docker `aihot` 已有299条AI、183条world，以及世界来源的本机预览许可和56条eligible投影；旧3200预览库才只有竞赛。此次以现有站点库为底，不再让空新闻的竞赛副本作为集成展示库。

新建独立 `all_news_unified`，完整复制站点库并执行9份未应用的竞赛迁移，再事务导入 `competition_ingestion` 的9张模块表。保留原来的AI/world资料、分析、事件关系、报告、账户及配置，原业务库不覆盖。

| 内容 | 统一库结果 |
| --- | --- |
| AI原材料 | 299条；254条eligible投影，默认精选接口当前返回14项，受原有筛选／时间规则约束 |
| 世界原材料 | 183条；88条当前版本PASS、材料充分且归组完成的内容，经现有审核函数通过并可本机展示 |
| 竞赛 | 31个目录／届次／展示指针；221份材料、168次运行、130份候选修订、53条来源记录、289条额度记录 |
| 付费证据 | 原2866回执＋竞赛275回执＝3141；另导入285条竞赛尝试、62条竞赛审计 |

竞赛回执保留logical_key及历史金额，以新序号写入并映射候选／额度外键，不覆盖原新闻回执、不重新调用模型。映射文件保存在私有备份目录。竞赛原库尚无section列，导入后沿用现有receipts的默认ai归属及competition.*用途，不发明新的section或改写已发布schema；不代表允许竞赛任务借用世界预算。跨模块预算归属如需调整，应另行设计迁移。

早期 `world_real_trial_test` 当前有132条world材料，86个URL已在站点库出现、46个仅见于试验库；此开发试验库完整另备份归档，没有把旧试验的独立ID、历史分析或测试状态盲目覆盖到当前业务库，也没有把试验材料自动公开。它不是现行站点数据源。

## 公开边界

使用者本次明确要求统一部署并展示内容。88条世界内容通过现有 `reviewSectionPublication` 逐条按当前修订审核，保留审核审计；未跳过材料、分类、日期、来源和归组检查。其余95条原材料未强行发布，竞赛沿用已获授权的31项展示指针；AI不更改原有精选、撤回或审核规则。

六源许可仍保留原有 **LOCALHOST-ONLY** 依据，不伪造第三方公网转载授权。新版网页仅绑定 `127.0.0.1:3000`，本记录的“展示”是本机匿名前台可读，不是上线互联网；后续公网部署仍须完成来源使用核验。全文、推送、定时采集和模型调用未启用。

## 运行与回退

- 新镜像 `aihot-integrated:2330a57`；Docker内 `aihot-integrated-api`、`aihot-integrated-web` 共用新库，沿用原 `aihot_data` 附件卷。数据库容器仍为 `aihot-db-1`，没有删除卷。
- 主入口 `http://localhost:3000/`、`/world`、`/world/timeline`、`/competitions`；旧3200本机Web进程改读3000的HTTP API，两个地址不再读取不同数据库。旧3201空新闻API已停止。
- API私有配置在 `/Users/Admin1/.codex/backups/all-news/2026-10-15-unified/runtime.env`，权限0600，不提交Git；网页容器没有数据库或模型密钥。COLLECT、MODEL_CALLS、FEISHU及INDEXNOW安全阀关闭，worker未启动。
- 新容器配置了 `unless-stopped`。需要启动已停止的新部署，可先启动 `aihot-db-1`，再启动上述两个integrated容器。旧 `aihot-api-1`、`aihot-web-1` 仅停止未删除，不与新版同时抢3000端口。
- **不要直接在旧目录执行普通compose up当作本次升级操作**：它仍指向旧镜像及旧库。升级容器管理配置属于后续部署整理；当前以这里记录的新容器为准，用户原有compose文件未修改。
- 备份目录包含原AI/world库、竞赛库、旧world试验库、合并前后统一库dump、附件tar及回执映射。含私有数据，不纳入Git。回退时停止新Web/API，启动原数据库及旧Web/API即可恢复原站；新库和备份均保留，不删表或卷。

## 验证

本机Docker镜像构建通过；部署后迁移显示已最新。原库与统一库的articles、sources、analyses、stories、facts、fact_articles、article_revisions、reports和report_revisions全表指纹一致；模块导入在事务内核对逐表数量，外键保持启用。

两个地址HTTP均返回AI默认精选14项、world总数88、竞赛总数31，世界详情200。站点smoke全通过。Browser插件／browser skill未提供，使用现有Playwright：1440与390宽度检查首页、世界总览、竞赛总览／列表，均200、无页面运行异常或横向溢出，截图仅保存在本机/tmp。

本次没有改业务代码、历史迁移或生产阈值，未重复付费调用；类型、877后端、58前端等代码验收沿用2330a57已通过的本地及远端CI，另执行上述实际部署验证。
