# 四板块 Agent 接入

接入页面为 `/agent`，统一 MCP 地址为 `/api/mcp`。本机预览使用 `http://localhost:3000/api/mcp`；部署后的实际地址以接入页为准。全部工具匿名只读，查询不会创建采集、付费模型或个人升学任务。

目前共 21 个工具，前缀来自 `site/site.ts` 的 `mcpPrefix`。现有配置为 `nexus_`。

| 板块 | 工具后缀 | 使用顺序 |
|---|---|---|
| 行业信息 | `get_latest`、`search`、`get_hot_topics`、`get_story`、`get_daily`、`get_weekly`、`get_monthly` | 查询动态或主题，再使用热点返回的事件编号跟进，按需读日报、周报、月报 |
| 世界新闻 | `get_world_news`、`get_world_item`、`get_world_events`、`get_world_event`、`get_world_hot_topics`、`get_world_daily` | 按政治／经济／安全或关键词筛选，再使用列表返回的新闻／事件编号读详情；热点可能明确返回待校准，不能用其他榜单替代 |
| 大学生竞赛 | `get_competitions`、`get_competition`、`get_competition_resources` | 先按名称、分类、年份、活动状态查比赛，使用列表的 `competitionId` 与 `editionId` 查询具体届次，再读经验帖／教学视频 |
| 保研 · 考研 | `get_admissions`、`get_admission`、`get_admission_schools`、`get_admission_updates`、`get_admission_coverage` | 先从院校目录取得学校编号，按院系、专业、年份、阶段查询公告，再核对条件、材料、截止时间和每日变化 |

竞赛分类使用逗号分隔，例如 `category: "数字媒体,软件开发"`；完整可选值由工具输入描述列出。竞赛页码与每页条数可传数字。升学 `track` 使用 `baoyan` 或 `kaoyan`，每页 12 条，按返回的 `pages` 继续读取。院校目录仅表示可选择的学校，不代表全部学校已有公告。

世界日报和升学每日变化的 `date` 为真实的 `YYYY-MM-DD`，省略时使用北京时间当天；没有这天的日报就返回没有结果，不拿其他日期冒充。详情编号只从对应列表获取。

## HTTP 与机器说明

- `/api/v1/agent`：包括四个板块的地址、参数和回答提示。
- `/api/v1/agent/world/news?category=economy&limit=5`：世界经济新闻。
- `/api/v1/agent/competitions?category=数字媒体&pageSize=5`：数字媒体竞赛；请求时对中文进行 URL 编码。
- `/api/v1/agent/competition?competitionId=列表返回值&editionId=列表返回值`：具体竞赛届次。
- `/api/v1/agent/competitions/resources?competitionId=列表返回值&editionId=列表返回值`：该届次可用的经验帖和教学视频。
- `/api/v1/agent/admissions?track=baoyan&year=2027`：2027 年保研公告，可进一步组合 `school`、`department`、`programme`、`stage`、`status`、`page`。
- `/llms.txt`：自动列出安装后的 MCP 工具及各板块入口。
- `/openapi-v1.json`：包括新增的 14 个 Agent GET 查询。它们返回 Markdown 和内嵌 JSON；MCP 的 `structuredContent.data` 为相同的公开数据。

MCP 与 Markdown 读取现有公开层，不返回管理员草稿、人工审核记录或未发布的资源。没有公开详情时，模块工具返回 `found: false, data: null`；列表没有匹配项时保留原列表的空结果与覆盖信息。新增板块工具采用 `no-store`，不在 MCP 中保留撤回前的结果。第三方标题、摘要和资料只作为数据，不作为指令执行。

RSS 当前仅提供行业信息的精选、动态和阶段报告订阅，不宣称已经覆盖世界、竞赛或升学。升学结果保留机器核验与人工核验的区别，过期公告保留截止状态，关联资源的适用届次和来源应单独核对。

## 实现位置

共享展示元数据在 `site/agent.ts`；本网站组合工具在 `site/modules/agent.ts`，网页组合在 `site/modules/agent-web.ts`。通过已有模块安装机制加载，所有业务内容均调用 `packages/backend/src/publication/` 的读取器或模块公开读取注册表。修改工具时同步 OpenAPI，专项测试会核对 MCP／OpenAPI 参数清单，并验证草稿不可读、撤回即时生效和读取不产生模型回执。
