// Public capability names shared by the connection page and the installed server modules.
export const AGENT_SECTIONS = [
  { id: "industry", name: "行业信息", description: "按你的行业关注点查询精选、热点、事件脉络与日报、周报、月报。", workflow: "获取动态 → 检索主题 → 跟进事件 → 阅读阶段报告", ask: "整理最近一周我关注行业的重要进展，附来源与事件脉络。" },
  { id: "world-news", name: "世界新闻", description: "阅读政治、经济与安全动态、事件时间线及世界日报。", workflow: "筛选世界动态 → 追踪事件 → 阅读热点与日报", ask: "查询世界经济动态，并区分已发布新闻与尚待校准的热点。" },
  { id: "competition", name: "大学生竞赛", description: "筛选比赛、查看届次与报名节点，获取关联经验帖和教学视频。", workflow: "发现比赛 → 核对届次与节点 → 获取备赛资源", ask: "帮我找数字媒体相关竞赛，列出已知报名安排和对应经验帖、教学视频。" },
  { id: "admission", name: "保研 · 考研", description: "按学校、院系、专业与阶段查公告，核对条件、材料和每日变化。", workflow: "定位学校与方向 → 查招生公告 → 核对条件与截止时间", ask: "查询计算机相关保研公告，列出适用年份、申请条件、材料和原文链接。" },
] as const;

export const MODULE_AGENT_TOOLS = [
  { section: "world-news", tool: "get_world_news", path: "/world/news", title: "世界新闻列表", ask: "按分类、关键词和页码查询世界新闻", parameters: "q、category（politics/economy/security）、page、limit" },
  { section: "world-news", tool: "get_world_item", path: "/world/item", title: "世界新闻详情", ask: "阅读新闻摘要与原文出处", parameters: "id（取自世界新闻列表）" },
  { section: "world-news", tool: "get_world_events", path: "/world/events", title: "世界事件列表", ask: "发现可追踪的世界事件", parameters: "limit" },
  { section: "world-news", tool: "get_world_event", path: "/world/event", title: "世界事件详情", ask: "了解世界事件时间线与多来源报道", parameters: "publicId（取自世界事件列表）" },
  { section: "world-news", tool: "get_world_hot_topics", path: "/world/hot", title: "世界热点", ask: "查看世界热点及其校准状态", parameters: "无" },
  { section: "world-news", tool: "get_world_daily", path: "/world/daily", title: "世界日报", ask: "阅读指定北京时间日期的世界日报", parameters: "date（YYYY-MM-DD，默认北京时间当天）" },
  { section: "competition", tool: "get_competitions", path: "/competitions", title: "竞赛列表", ask: "筛选竞赛、届次和报名状态", parameters: "q、category（逗号分隔）、activity、year、sort、page、pageSize" },
  { section: "competition", tool: "get_competition", path: "/competition", title: "竞赛届次详情", ask: "核对比赛规则、人数限制、节点与官方材料", parameters: "competitionId、editionId（均取自竞赛列表）" },
  { section: "admission", tool: "get_admissions", path: "/admissions", title: "升学公告", ask: "按院校、院系、专业、年份和阶段查询招生公告", parameters: "q、school、department、programme、track（baoyan/kaoyan）、stage、year、status、page 等" },
  { section: "admission", tool: "get_admission", path: "/admission", title: "升学公告详情", ask: "核对申请条件、材料、截止时间和机器核验标识", parameters: "noticeId（取自升学公告列表）" },
  { section: "admission", tool: "get_admission_schools", path: "/admissions/schools", title: "院校目录", ask: "查院校编号、地区和官方站点；目录不等于公告已齐全", parameters: "无" },
  { section: "admission", tool: "get_admission_updates", path: "/admissions/updates", title: "升学每日变化", ask: "查看指定日期的新增与变更公告", parameters: "date（YYYY-MM-DD，默认北京时间当天）" },
  { section: "admission", tool: "get_admission_coverage", path: "/admissions/coverage", title: "升学来源覆盖", ask: "核对哪些学校有公告、哪些来源尚待处理", parameters: "无" },
  { section: "competition", tool: "get_competition_resources", path: "/competitions/resources", title: "竞赛经验帖与教学视频", ask: "按具体竞赛届次获取已发布、已核验的备赛资源", parameters: "competitionId、editionId（均取自竞赛列表）" },
] as const;
