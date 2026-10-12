# 世界新闻本轮工程验收与复跑

范围：原规划的后台闭环及板块隔离，不包含世界新闻三层阅读页面或生产上线。2026-10-12 使用者明确暂缓人工标签／质量校准；不伪填金标，不启用真实生产门槛。

## 本次补齐

世界投影原先固定 `selected=false`，现按独立 `selection.thresholds.default` 与当前材料的两次有效评分平均值判断。低于门槛的合格相关内容仍可进入普通列表；缺有效双评分不成为精选；明确材料不足不公开。空门槛保留审核流程，空对象或 AI 来源等级键不能充当世界门槛。真实 `rules.ts` 仍为 null，测试数值不是推荐生产门槛。

精选写入实际可见时间，重建不刷新已入选发布时间；撤回、来源许可、原文修订和分析变更仍受统一 publication 读取约束。世界不会写入 AI 精选同步账本。热点使用同一个世界门槛状态，不借用 AI 写作下限。

## 验收证据

| 原规划要求 | 对应证据 |
| --- | --- |
| 本地 RSS／HTML／JSON 真实读取器，HTML／JSON 各两条，日期／摘要／缺字段 | `../tests/collection.test.ts`、`../tests/workflow.test.ts` |
| 同链接两板块独立、同板块去重／修订、旧 AI 升级不变 | `../tests/data-isolation.test.ts`、`../tests/upgrade.test.ts` |
| 并行提示词、模型、分类、任务、回执及预算不串 | `../tests/rules.standalone.test.ts`、`../tests/analysis.test.ts`、`../tests/receipts-isolation.test.ts`、`../tests/workflow.test.ts` |
| 事件归组、跨板块拒绝、人工合并／纠正 | `../tests/grouping.test.ts`、`../tests/corrections.test.ts` |
| AI 原出口与世界接口隔离，公开许可／修订／撤回 | `../tests/publication-isolation.test.ts`、`../tests/section-publish.test.ts` |
| 首轮 48 小时／旧文归档，北京日、日报容量／来源限制／草稿版本 | `../tests/collection.test.ts`、`../tests/daily.test.ts` |
| 错误、预算暂停、重跑／未知回执恢复 | `../tests/analysis.test.ts`、`../tests/operations.test.ts`、`../tests/recovery.test.ts` |
| 双评分精选、普通列表及可公开热点，编排不触发模型 | `../tests/section-publish.test.ts`、`../tests/hot.test.ts`、`../tests/workflow.test.ts` |
| 六源真实试抓及小批真实模型／归组 | [六源报告](2026-10-11-real-rss.md)、[首次模型报告](2026-10-11-real-model.md)、[多来源归组报告](2026-10-12-real-grouping.md) |

本次结果：后端 **810/810**、前端串行 **52/52**、类型检查、前端构建、迁移检查通过，运行站点冒烟 **30/30**。第一轮新增代码遇到分析 output 为 null 和测试类型声明问题，已修复后通过；中断后 Docker 退出导致一次连接拒绝，恢复专用测试容器后完成后端验收。已通过项目不继续重复运行。

队列联合测试的新增部分使用同一批实际采集／分析／归组结果，移除虚构来源材料的人工审批，装载仅测试用门槛后验证自动投影：4 条可读，3 条精选、1 条普通，热点公开读取 ready，日报仍生成待审修订；这些操作没有增加假模型请求。不是给真实来源授予许可或自动启用发布。

实际试验库只读及 HTTP 冒烟：107 条 world 材料、5 个分析、22 个回执／尝试；六源启用数及许可记录数均为 0，公开投影为 0。world 列表／事件为空、热点 calibration-required、实际已分析文章详情 404；旧 AI 列表不含 world。读取前后尝试数保持 22。临时 API／Web 已关闭，业务库未操作；当前测试容器映射端口为 51859。

## 单次复跑入口

先用 `docker port codex-world-news-stage2-test 5432/tcp` 核对当前映射端口，再替换下面的 51859；不要同时运行连接测试模板库的预览 API。

```bash
DATABASE_URL=postgres://postgres@127.0.0.1:51859/world_isolation_test node --test-global-setup=tests/databases.ts --import ./tests/databases.ts --test --test-timeout=90000 modules/world-news/tests/workflow.test.ts
```

该命令自动建立独立复制库，只请求本地素材／假模型，跑通采集 → 清洗去重 → 相关性 → 双评分／摘要 → 事件 → 投影 → 热点／日报草稿 → HTTP 路由及撤回；同时运行旧 AI 分析。不会调用付费模型，不改业务数据库。

## 留到后续的事项

- 人工金标、事件开发／留出分集、F2 与质量校准：使用者明确暂缓，工具和候选池保留，不算通过。
- 六源公开使用许可：见[条款记录](source-permissions.md)，未核实／未完成所需告知的来源不放行。需要实际官方依据或外部协调，不是再跑工程测试能解决。
- 生产启用、定时采集、正式门槛及业务库升级未执行；三层阅读页面不在本期后台计划内。
- 累计真实模型 22 请求；5 元上限内保守预留 0.81 元、峰值用量估算 0.0649 元，实际账单未核对。本次没有新增真实请求。
