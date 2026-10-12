# 世界新闻公开 API（后端接口约定）

世界新闻接口只返回 `world` 板块当前可公开的摘要和原文链接。读者请求不调用模型；采集、评分、事件归组和综述在后台任务中运行。三个分类键固定为 `politics`、`economy`、`security`。

## 总览

- `GET /api/v1/world/daily/YYYY-MM-DD`：已批准日报的 `focus`（今日重点）和 `flashes`（今日速览）。日期为北京时间的刊期；无已批准版本返回 404。前端不要从草稿或热点自动顶替今日重点。
- `GET /api/v1/world/highlights`：`categories` 按政治、经济、安全顺序返回 `{ key, label, lead, briefs }`。`lead` 来自当前已发布的世界事件热点，每类最多一条；`briefs` 是该类最新普通新闻，最多三条且不重复 `lead`。`status` 与热点相同；未校准时 `lead` 为 `null`，已公开的普通新闻仍可出现在 `briefs`。
- `GET /api/v1/world/hot`：经世界新闻双评分与事件排序得到的热点。`calibration-required` 表示正式世界门槛尚未校准，不能把后台草稿当成公开推荐。校准后 worker 每五分钟刷新快照；后台仍可手动生成。热点是配置来源内的事件排序，不是全网热度或新的一次模型打分。

“持续关注”卡片的内容仍暂停接入；即使事件接口已有报道列表，也不在首轮后端数据中拼装这组卡片。

## 分类时间线

`GET /api/v1/world/items?category=economy&q=关键词&page=1&limit=40`。`category` 和 `q` 可省略；`page` 从 1 开始，最大 10000；`limit` 为 1—100。按 `timelineAt` 降序、文章 ID 降序排列。响应保留已有的 `sectionId`、`items` 和 `count`；`count` 是本页条数。

新增 `pagination: { page, limit, total, hasMore }`，其中 `total` 是同一筛选条件下当前可公开的总条数。新增 `days: [{ date, count }]`，按北京时间的 `timelineAt` 日期统计整个筛选结果，不只是当前页。`publishedAt` 是原文发布时间，可能为 `null`；不要把 `timelineAt` 显示成已知的原文发布时间。撤回、修订和许可变化会在下一次请求的计数中体现；翻页期间数据也可能变化。

## 单条新闻和事件

- `GET /api/v1/world/items/:id`：现有基础摘要字段，不提供全文、原文标题、标签、图片或新增背景资料。
- `GET /api/v1/world/stories`：当前可公开事件的标题、最近时间和报道数。
- `GET /api/v1/world/stories/:publicId`：事件及其可公开报道；新增 `story.digest`。综述由世界新闻自己的后台任务生成，只有其所依据的报道当前仍可公开且内容未变时才返回；否则为 `null`。不在公开接口中提供未经证据重查的生成进展句。

综述模型使用世界新闻独立提示词、模型步骤、回执和费用上限。世界正式筛选门槛仍待人工样本校准；真实来源许可仍待使用者后续核验。测试可用本地假信源和假模型验证全链路，不能据此认定真实来源已经获准公开。
