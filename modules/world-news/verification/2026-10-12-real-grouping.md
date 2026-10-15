# 真实多来源分析与事件归组试跑

执行时间：2026-10-12 10:23 北京时间；专用 Docker `world_real_trial_test`，当前映射端口 54512。使用已保存 RSS 材料，复用现有官方 DeepSeek `deepseek-flash` 配置，没有再次采集或访问原文／视频，没有修改业务数据库。

## 结果与可核对身份

| 样本 | 来源 | 分析／回执 | 结果 |
| --- | --- | --- | --- |
| world-048，`anr9j0qays3e0svry0dntroh9` | NPR | 分析 3，回执 8—13 | PASS；双评分 87／78，均值 82.5；中文标题摘要保留“沙特当局称”；新事件 2、事实 2 |
| world-050，`qs21vs5rjk5iq4kbwdkiothdc` | NPR | 分析 4，回执 14—15 | UNKNOWN；材料未足以支持具体事实，没有评分／中文文案／归组 |
| world-031，`xghepmrueqj3dgpt6sois4xbb` | France 24 | 分析 5，回执 16—22 | PASS；双评分 38／0，均值 19；中文文案保留“正在考虑”；SAME_STORY，归入事件 2、独立事实 3 |

上述身份、原文入口和材料指纹可在 [候选索引](../review/formal-pool.json) 核对。所有材料修订为 1；模型结果不是人工金标。本批新增 15 个真实请求，均 completed，没有 unknown 请求、失败或预算中断；累计 22 个请求。

回执记录模型均为 `deepseek-flash`；提示词版本依次为 `world:prefilter@10228cddf3`、`world:structure@0e918b0bce`、`world:selection-score@f0d5ff04c1`、`world:understand@e17b280ff3`、`world:group-pair@bf77b7ef3f`、`world:group-review@c658bca237`。双评分同规则、不同用途身份，第二次不含第一次答案。

实际步骤使用 `runWorldAnalysisTask`／`runWorldGroupTask` 和共享真实调用、回执、板块预算及 publication 投影，不是本地假模型；本批直接调用任务执行器，没有启动队列 worker。实际队列调度的完整验证另见 [本地联合验收](2026-10-11-local-workflow.md)，不能把两种证据混说。

## 归组检查

- NPR 伤亡通报与此前俄乌能源停火事件，被初判为 UNRELATED，没有因为都提到特朗普就归一起。
- France 24 的特朗普回应与 NPR 的机场袭击伤亡通报，初判和独立复核都返回 SAME_STORY（各 confidence 0.72），理由均为同一机场袭击的直接后续反应。
- 数据库事件 2 属于 world，保留事实 2、3，各自的报道角色为 primary；不是把两篇改成同一已发生事实，也不是“两来源独立证实同一个伤亡数字”。
- 尚未在本批验证同一事实的两源 SAME_OCCURRENCE、评论关联、多事件误归率或人工事件金标；这些不能由当前单个关系对推出。

## 费用和开关

保留原累计起点 `2026-10-11T15:03:05.324Z`，人民币上限 5 元，不因换端口或开始第二批重置。累计保守预留上界 **0.81 元**，按回执 token 用量和峰值未缓存单价估算 **0.0649 元**；均不是已核对的实际扣款。价格依据本日重新读取的 [官方定价](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)：Flash 峰值输入 2 元／百万 tokens、输出 8 元／百万 tokens，不使用缓存或时段折扣。

`MODEL_CALLS_ENABLED` 仅试跑进程打开；保存材料模式保持采集关闭，不写 `.env`。来源六个均暂停；摘要许可记录仍为零，不自动发布、不更改生产门槛。API／Web 检查时模型和采集均关闭。

可复跑命令如下；先核对 Docker 当前端口。脚本沿用原材料身份、规则版本和尝试标记，已有回答通过回执复用，但若材料／规则已改变则可能产生新费用，不能把“重跑”当作必然免费：

```bash
DATABASE_URL=postgres://postgres@127.0.0.1:54512/world_real_trial_test node modules/world-news/verification/model-real.ts --execute-paid-trial --articles=anr9j0qays3e0svry0dntroh9,qs21vs5rjk5iq4kbwdkiothdc,xghepmrueqj3dgpt6sois4xbb
```

## 读取边界与回归

实库有 107 条 world 原材料、5 个分析、3 条 world 投影，eligible 均 false；AI 无文章或回执。实际 HTTP 检查：

- 旧 AI `/api/v1/items?mode=all`：200，items 空，不漏入世界内容。
- world 文章／事件列表：200，items 空；已分析 world-048 详情 404。
- world 热点：200、calibration-required；本日日报 404，没有批准刊期。
- 阅读前后真实回执尝试数均 22，没有页面触发模型或新增费用。

本批类型／构建／迁移／差异检查、后端 804/804、前端串行 52/52、真实试验库上的站点冒烟 30/30 通过。临时 API／Web 已停止，未推送、本地分批提交，保留原有 compose 改动。

## 待完成，不作为通过项

两次评分 38／0 差异明显，列为校准错例；不能为该例直接改门槛或重试到获得满意答案。人工 100 条标签／事件分集仍为空，F2 和留出验收未运行；来源使用权限仍有缺口。真实多来源直接进展归组已得到证据，但全套产品验收尚未完成，更不代表准许生产自动精选或公开这些材料。
