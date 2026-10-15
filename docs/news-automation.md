# AI／世界新闻自动更新

2026-10-15，使用者明确授权复用现有DeepSeek API，AI及世界新闻合计每天5元，并确认合格世界摘要自动展示。只开启现有18个AI和6个世界RSS来源；不新增信源，不包含竞赛自动采集、推送或公网转载授权。

## 运行方式

- `COLLECT_ENABLED=true`、`MODEL_CALLS_ENABLED=true` 仅写入本机私有运行配置，未修改仓库的默认或示例阀配置。所有AI模型步骤使用default，即现有官方 `api.deepseek.com` 的 `deepseek-flash`，非思考、文本模式，密钥不写入Git或日志。
- Worker每分钟检查到期信源，沿用既有频率（AI来源60—180分钟、世界来源30分钟）增量读取和去重。不是每次打开页面抓取，也不保证每条内容秒级更新。睡眠／关闭Docker期间不能采集，恢复运行后继续。
- `site/modules/server.ts` 的 `SERVER_MODULES` 保留两模块API；`WORKER_MODULES` 本次仅安装world-news，AI引擎任务照常注册，竞赛自动队列／定时器不安装。竞赛展示和收藏不受影响。
- 设置 `sections.world.publication={"automaticSummary":true}` 后，当前材料充分、PASS、分类／日期有效、归组完成且来源有适用许可时自动发布摘要。不伪造人工审核记录，不覆盖人工撤回，不开放全文。世界精选／热点仍需原有校准，未修改阈值。

## 合计每日5元熔断

`settings.providers.daily_spend` 使用现有货币策略结构：`limitCny`、`startedAt`、`service`、`model`、`endpointHost`、`inputPerMillionCny`、`outputPerMillionCny`、`reference`。本机配置分别为5、首次启用时间、llm、deepseek-flash、api.deepseek.com、2、8及[官方人民币价格页](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)。2026-10-15核验采用峰时未命中输入／输出价格，不享用缓存或闲时折扣来扩大额度；价格变动后须重新核对。

- 按Asia/Shanghai自然日计账，首日从用户本次授权启用时刻起算。重启、部署不重置 `startedAt` 或清空历史；次日00:00通过账期查询自然恢复额度，不需要每天修改设置。
- 所有新付费尝试在回执事务内共用数据库锁，AI／world、不同worker并发竞争同一额度；发送前预留UTF-8输入字节＋消息开销与最大输出的保守费用。未配置该策略的部署保持原行为。
- 成功且有完整非负整数token用量的尝试，按上述峰时费率向上取整到微元结算，释放未用预留；未知、失败、缺失用量及执行中保留全额预留。每次重试单独计入，保存答案复用不新增费用。旧失败请求恢复前补记预留，不允许借旧回执绕过上限。
- 不覆盖的模型／主机、未知预留、未来启用时间、多模态输入及覆盖消息／模型／输出上限的参数，在实际请求前拒绝；预算不足沿用BudgetExceededError，AI按既有重试时间暂停，world任务延后执行而非立即反复调用。
- 这是本站请求的应用层费用上界，不是DeepSeek账户级限额；同一密钥在其他应用的消费不受这里控制。实际账单仍以供应商为准，不把预留或峰时估算称为已扣费金额。

原 `sections.world.spend` 是旧试跑累计上限，本机已在审计及私有备份中归档后移除，改由共享每日策略管理；历史机制仍供其他试跑使用，不改历史回执。所有付费请求仍经过原有receipts、次数限流和分板块预算。

## 本机部署与停用

API／worker镜像为 `aihot-integrated:news-daily-budget`，容器分别为 `aihot-integrated-api`、`aihot-integrated-worker`。Web仍是导航版，共读Docker `all_news_unified`；入口仍为localhost:3000，3200同库。推送保持关闭，来源许可保留LOCALHOST-ONLY，不暴露公网。

私有配置和启用前dump在 `/Users/Admin1/.codex/backups/all-news/2026-10-15-news-activation/`，不提交Git。需暂停自动更新时正常停止 `aihot-integrated-worker`，最长等待210秒收尾，避免制造未知付费回执；不要启动旧worker来代替。完全关闭付费还需将私有API／worker环境的MODEL_CALLS_ENABLED改false后重建相应容器。回退前先停worker，再切回已停止的 `aihot-integrated-api-before-news`（其模型／采集阀关闭）；保留数据库及账本，不重置预算。

## 验证范围

本地假服务回归覆盖：AI与世界并发合计5元、缓存复用、未知／失败／重试保留预留、成功token结算、北京时间跨日及其他数据库时区、缺失或未来策略、旧回执补记、请求覆盖与图像拒绝、world延后去重，以及竞赛worker不安装。摘要发布测试验证字面true开关、材料／许可／日期／归组门槛、人工撤回和不冒充精选校准。

最终typecheck、887项后端、构建／59项前端、Docker／smoke及桌面手机部署验证通过；真实首轮采集和费用快照见[启用验收](../modules/world-news/verification/2026-10-15-news-daily-activation.md)。
