# 阶段 2：世界新闻隔离迁移与兼容设计

日期：2026-10-11。分支：`codex/world-news`。基线提交：`85f3088`。

阶段 1 已本地提交，未推送。使用者已批准阶段 2，允许复用现有模型配置、本轮付费上限人民币 5 元。已完成 2B 独立规则基础及 2C 的扩展迁移／材料身份／来源操作边界，在专用测试库验证；没有启用真实世界来源、采集或发布。生产唯一身份切换、2D 及完整隔离验收仍待完成。本文其余架构条款为目标设计，不代表全部已实现。

## 1. 代码检查结果：为什么不能只分目录

| 已核对的位置 | 当前行为 | 必须改的边界 |
| --- | --- | --- |
| `content/materials.ts`、`0001_core.sql` | identity_key 全局唯一；锁定、冲突处理均不含板块 | 按板块＋原文身份锁定、判重、修订 |
| `content/provenance.ts` | 多来源发现后协调归属 | 只能在同板块协调，不把 world 原文改归 AI |
| `sources/collect.ts` | 首轮统一标记 first-import，来源列表不分板块 | AI 行为保留；world 近期首轮策略独立 |
| `jobs/content.ts` | 普通 RSS 只有摘要时仍可能进正文提取 | world 显式 RSS-only，不伪造全文标记 |
| `editorial/prompts.ts` | 固定读取 industry/prompts，按文件名缓存 | 规则包显式选择，缓存按板块＋文件标识 |
| `editorial/analyze.ts` | 分类、门槛、系统提示词与版本在模块级取 AI 配置 | 改为每任务不可变上下文，不改变 AI 输入与版本 |
| `editorial/models.ts` | models.* 设置与一分钟全局缓存 | 保留 AI 旧键；world 独立步骤选择与缓存 |
| `jobs/queue.ts` | 工作载荷没有板块 | 生产者、消费者、恢复、单例键一起改；处理旧 AI 任务 |
| `events/recall.ts`、`events/merge.ts` | 召回与合并无板块核对 | SQL 范围＋事务内资源归属核对 |
| `events/hot.ts` | 最新热点快照与来源时钟全站读取；含 AI 社区来源规则 | 按板块快照／来源；world 不使用 AI 社区词表与热度排序 |
| `reports/edition.ts` | AI 分类静态导入，日报默认 12 重点＋10 快讯 | 编排策略独立；world 6＋6，不影响 AI |
| `publication/scope.ts` | 可见性、精选条件无板块 | 公开读取统一范围，不只在 API 最外层过滤 |
| `admin/sources.ts` | 来源列表、统计、详情、重复地址检查均全局 | 地址查重按板块；创建后归属不可修改；详情操作核对 |
| `providers/receipts.ts` | logical_key 无板块；预算只按服务计数 | world 回执身份＋板块预算；保留 AI 回执复用 |
| `scripts/migrate.ts`、`migration-safety.ts` | 全目录迁移按文件名排序；严格一语句在线词法 | 不放未批准 SQL 到迁移目录；不改历史、不关闭检查 |

上表路径除数据库脚本外均相对 `packages/backend/src/`。原有来源的 `participation_mode = isolated` 只是流程参与方式，不是数据或规则板块。

## 2. 板块上下文和规则注册

### 2.1 类型与入口

计划在 `packages/contracts/src/sections.ts` 定义唯一类型 `SectionId = "ai" | "world"` 及严格校验；共享服务在 `packages/backend/src/sections/` 建立规则注册／资源归属检查。

- HTTP 外部输入只接受精确 ai／world；非法值返回 400，不默认全站或 AI。
- 老公开入口固定传 ai；world 入口固定传 world。不能让老接口的查询参数绕过范围。
- 管理后台老请求不带板块时保留 AI 兼容；切到世界新闻后每个请求明确携带 world，不从进程或上一次页面读取当前板块。
- 资源从数据库读取后核对所属板块。不存在或属于另一板块的 HTTP 详情返回 404，避免泄漏另一板块资源存在；后台合并的身份冲突可返回 409。
- 引擎内部的新任务必须显式上下文，不能让开发者遗漏时默认 AI。缺板块的旧队列载荷仅进入兼容路径，并必须证明数据库资源确实属于 AI。
- 不用 HTTP 传来的分类、模型或提示词当规则对象；由注册表按板块加载受信任规则。

### 2.2 注册与依赖方向

AI 内置适配器继续读 `industry/`、现有 `site/models.ts` 等已使用配置；世界新闻由模块声明规则包，在 `site/modules/server.ts` 安装。

共享引擎不直接导入 `modules/world-news/`。需在现有模块插口中增加通用板块规则注册能力，站点清单安装世界模块；前后端共享类型不反向依赖后端或模块。

世界规则缺失、分类无效、提示词不存在或模型步骤无配置时明确失败，不能调用 AI 模板或用 AI 门槛代替。世界模块未准备好时只有 AI 可执行，注册缺失必须能安全拒绝 world 请求。

阶段 1 的 Markdown 是规则稿，不自动当作可运行提示词。可执行 world 提示词及契约要依据审查结果落地；生产门槛继续为空／未校准，不能因注册规则包就自动发布。

### 2.3 并发与兼容

任务持有不可变 SectionContext，包含规则、分类、提示词访问器、模型步骤、发布及材料策略。不使用可变“当前板块”。

提示词包含与展开只能在该规则包内进行；允许共用明确的通用安全文本，不跨包寻找缺失文件。缓存键含板块、规则版本和文件名。

AI 提示词正文、填值、既有 promptVersion 与付费 logical_key 的计算保持原样，避免所有历史回执失效或新旧结果被隐性重算。world 使用自己的版本／身份空间。

## 3. 数据归属设计

### 3.1 拥有板块的主记录

| 表 | 拟新增／调整 | 原有记录处理 |
| --- | --- | --- |
| sources | section_id；范围检查；(section_id,id) 唯一索引 | 常量 ai，不改变地址、游标或启停 |
| articles | section_id；(section_id,identity_key) 唯一；同板块来源外键 | ai；保持 ID、URL、修订及原始 identity_key |
| stories | section_id；同板块 merged_into 自关联 | ai；不重新归组 |
| facts | section_id；同板块 story_id 外键 | ai；不改事实 |
| publications | section_id；同板块文章／来源／分析／事实／事件关联 | ai；不重建旧发布结果 |
| hot_rankings | section_id；最新快照读取与索引按板块 | ai；保留旧快照 |
| reports | section_id；唯一改为 (section_id,kind,key) | ai；旧日报内容及读取不变 |
| receipts | section_id；调用与复用核对归属 | ai；旧 logical_key 不变 |
| selectbench_runs | section_id；世界评测独立范围 | ai；不导入世界初审 JSON 为旧评测 |
| 业务 job_runs | 可空 section_id，板块任务显式归属；全站运维留空 | 不把备份等全站任务误标成世界任务 |

每个已有内容主表新增列使用 `text NOT NULL DEFAULT 'ai'`；板块枚举用单独 CHECK NOT VALID，然后独立文件 VALIDATE。新代码写入时仍显式传板块，不能依赖默认值创建 world 数据。

表的现有主键继续保留，不更换 ID 格式，不批量重写旧内容。

### 3.2 派生关系：追溯与同板块约束

| 记录／关系 | 隔离方案 |
| --- | --- |
| article_revisions、translations、translation_attempts、quote_translations、editorial_overrides、grouping_overrides、regroup_pending、pool_search | 沿 article_id 外键追溯；读写从文章上下文核对，不能接受任意其他板块 ID |
| article_discoveries | 加 section_id，对文章与发现来源分别建同板块外键；跨板块同原文创建两份发现记录 |
| analyses | 加 section_id，同板块文章外键；公开结果还校验 analysis_id 确实属于该 article_id |
| fetch_runs | 来源 ID 唯一可追溯；后台读取和任务记录按所属来源范围 |
| fact_articles | 加 section_id，分别引用同板块事实和文章 |
| story_signals | 加 section_id，分别引用同板块事件、文章、来源 |
| story_links | 加 section_id，两端事件都必须同板块 |
| story_aliases | 归属从目标事件追溯；查别名、跳转时必须在请求板块内 |
| story_digests、story_heat_hourly | 事件外键追溯；综述内 article_ids/context_article_ids 数组另做范围检查 |
| receipt_attempts | 从 receipt_id 追溯板块；预算与费用统计 JOIN 所属回执，不计成另一板块 |
| report_revisions、selectbench_results | 从父报告／评测运行追溯；读取与回执引用核对所属板块 |
| selected_ledger、selected_state | 加 section_id；同步快照、水位、删除通知及状态查询按板块，旧出口仍 AI |

对关联多种主记录的表加板块复合外键，不仅靠应用层“应该是”。只依赖单一父记录的修订表不重复制造无用板块字段；保持可追溯即可。

数组／JSON 的内容 ID 无法用普通外键逐项约束：事务写入前检查所有引用、包括事件归属；公开读取时重新检查同板块与可见性，不能只验证快照顶层 section_id。尚未存在、错误板块的引用拒绝写入，撤回后不继续公开。

来源归属不进入更新接口的可编辑字段；新建时固定。复合外键会拒绝有下游记录的跨板块改动；不添加未经论证的触发器，直接数据库管理员仍须遵守不可改归属约定。

### 3.3 复合约束重点

为被引用的主表建立 `(section_id,id)` 唯一索引；articles 用 `(section_id,id)` 与原文复合唯一索引。新增外键采用相同 section_id 与目标 ID：

- articles → sources；
- analyses → articles；
- facts → stories；
- fact_articles → facts、articles；
- story_signals → stories、articles、sources；
- story_links → stories 的两端；
- stories.merged_into → stories；
- publications → articles、sources、stories、facts；
- article_discoveries → articles、sources。

publications.analysis_id 还需三列外键 `(section_id,analysis_id,article_id)` 对应 analyses 的 `(section_id,id,article_id)` 唯一索引，避免“同板块但引用另一篇文章的分析”。可空事件／事实关联保持可空，应用写入检查事实与事件是否一致。

旧单列外键无害时保留，不为“清理”删除已有保护。外键侧查询／删除所需索引优先复用现有前导列索引；确实缺少的再增加，不给所有列无差别建索引。

## 4. 在线迁移与发布顺序（必须审查）

当前最大编号 0057。实施时重新检查编号，使用新的完整文件名。共享表迁移放 database/migrations，只有世界模块自有表才放模块 migrations。

### 4.1 SQL 形态示例

以下是设计示例，不是已创建的迁移，不可直接一次执行。每条放不同文件，执行前检查真实表结构及约束名。

```sql
ALTER TABLE articles ADD COLUMN section_id text NOT NULL DEFAULT 'ai';
```

```sql
ALTER TABLE articles ADD CONSTRAINT articles_section_check
CHECK (section_id IN ('ai', 'world')) NOT VALID;
```

```sql
ALTER TABLE articles VALIDATE CONSTRAINT articles_section_check;
```

```sql
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS sources_section_id_idx
ON sources (section_id, id);
```

```sql
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS articles_section_identity_idx
ON articles (section_id, identity_key);
```

```sql
ALTER TABLE articles ADD CONSTRAINT articles_section_source_fk
FOREIGN KEY (section_id, source_id) REFERENCES sources (section_id, id) NOT VALID;
```

```sql
ALTER TABLE articles VALIDATE CONSTRAINT articles_section_source_fk;
```

现有检查器允许上述形式；不需要改检查词法、不用 DO、不直接添加会扫描全表的 UNIQUE 约束。外键可引用符合 PostgreSQL 要求的非部分复合唯一索引。

### 4.2 扩展、切换、启用

1. 只做新增列／CHECK／并发复合索引／复合外键及验证，不生成 world 内容。常量默认 ai 让旧记录兼容，无需大批 UPDATE。
2. 部署已完整改造的 api、worker、脚本与后台，所有新写入和查询带板块；新代码先在只有 AI 的库验证回归。此时旧全局原文唯一约束仍存在。
3. 清点所有文章写入方，包括种子、外部导入和恢复脚本；确认没有旧二进制或仍使用 ON CONFLICT(identity_key) 的写入方。旧队列载荷走只允许 AI 的兼容校验。
4. 各入口已使用 ON CONFLICT(section_id,identity_key) 后，单独新迁移删除旧全局 identity_key 唯一约束。报告 kind/key 唯一约束也只能在全部写入及读取改造后删除。实际名称从数据库目录核对，不靠默认猜测。
5. 所有 AI 公开出口和后台边界验收通过后，阶段 3 才允许创建关闭状态的 world 来源及本地测试数据。
6. 真实采集、模型和发布必须等阶段 5 的独立批准；不通过部署默认值启用。

重要：不能把“删除旧唯一约束”的迁移和扩展迁移一口气放进首次升级并交给旧 worker 运行。迁移执行器会顺序执行全部文件，不知道代码发布步骤；扩展与切换必须是不同已审查发布批次。不能为图方便修改历史迁移或降低编号。

### 4.3 失败与回退

新增列或索引失败则停止，保留现有数据，查清未完成约束。并发索引中断可能遗留 invalid 索引，按现有 runner 提示审查后处理，不能认为 IF NOT EXISTS 就代表有效。

只做扩展且未写 world 数据前，可以回到旧应用，但需要保留新增字段，不能擅自删除。切换后已经存在 world 内容时，禁止直接回滚到无板块过滤的旧应用，否则旧公开接口可能泄漏 world 数据。

切换后的应用回退只能到同样理解板块的版本；旧全局唯一约束不能在跨板块同链接已存在时盲目恢复。回退不删除 world 数据、不合并原文身份，异常时先停止相关执行并另行审查。

阶段 2 实施时在 docs/deploy.md 写清上述升级批次、运行检查和回退限制；本文不代表已操作真实库。

## 5. 任务、缓存、模型与预算

### 任务

content.analyze、extract-body、events.group／digest、sources.fetch、publication.republish-source 等涉及内容的 JobData 添加板块。生产者从受校验资源获取板块，消费者再次核对数据库；singletonKey 含板块及资源 ID。

恢复、重跑、扫描任务和模块 articleChanged/sourceRepublished/reportsChanged 事件载荷也必须携带板块，不能由后台切换状态控制异步任务。

world 不执行正文补取、精选通知、周报月报任务。全局备份与清理仍是全站维护，不套 world 内容规则。

### 缓存与公开游标

缓存键、搜索范围、热点最新快照、召回向量集合和报告刊期包含板块。跨板块不可复用评分结果，即使 RSS 文本相同。AI 缓存及公开游标格式若保持不变，必须绑定固定 AI 查询；world 游标带 world 范围并严格验证，跨板块游标拒绝。

### 模型

world 独立步骤配置；可以经明确配置使用同一底层模型服务，但不能读取 AI 的 models.* 管理员选择当作 world 默认。凭据和网络客户端可共享，规则及步骤选择不共享。

AI 现有环境变量／步骤默认与回执保持；world 缺配置明确待配置。stage 2 不替使用者决定生产模型、预算数值或新环境变量名称。

### 回执与预算

AI logical_key 兼容旧计算；world logical_key 加固定板块域，identity 含板块、规则版本、输入修订、模型与调用配置。读取旧回执也核对 section_id；purpose 相同不代表可跨板块复用。

保留 budgets 的服务总上限；拟增加 section_budgets(section_id,service,per_minute,per_hour,per_day)，计数来自 receipt_attempts JOIN receipts。使用已有服务预算事务锁，一次事务同时检查总额与板块额，再登记回执／尝试；不能两个事务分别检查而出现并发超额。

world 未配置预算默认待配置／暂停，不继承 AI 额度或变无限。AI 未配置新增板块预算时暂保留既有服务上限行为，以免升级自动停掉原 AI；新增 AI 板块额度也要使用者确认。预算分别显示，不能把 world 暂停说成整个服务故障。

## 6. 后台和公开接口契约草案

世界阅读页面不在本阶段。后台共享界面增加显式切换，至少信源、内容、事件、模型、运行、统计和草稿均显示当前板块；所有操作请求与资源核验成对实施，不仅过滤列表。

旧公开 API、RSS、MCP、搜索、主题、同步账本、站点地图和分享入口固定 AI，保留原响应格式。世界接口通过 publication 读取层：

| 计划接口 | 作用 | 权限与范围 |
| --- | --- | --- |
| GET /api/v1/world/items | 分类列表、分页和摘要搜索 | world 的可公开资料 |
| GET /api/v1/world/items/:id | 文章详情 | world、当前可见、仅许可内容 |
| GET /api/v1/world/stories | 事件列表 | world、当前可公开证据 |
| GET /api/v1/world/stories/:id | 事件详情及报道 | world，别名跳转也核对 |
| GET /api/v1/world/hot | 热点 | world、校准批准后才启用推荐 |
| 世界日报公开读取，路径阶段 4 确认 | 批准版本 | 不返回最新未审草稿 |

路径为待审接口契约，尚未存在，不注册 world RSS、MCP 或外部导入新出口。草稿只管理员读取。

日报建议保留现有 reports/report_revisions，以新增 approved_revision 指针明确批准修订：world 公共读取只读指向的不可变修订，而非 reports 最新草稿 content。旧 AI 报告继续现有行为。审批者与审批时间记录在单独批准记录中，不能改写旧批准修订。具体审批表与写入事务留阶段 4 审查，不在阶段 2 提前伪装成已完成。

## 7. 实施拆分和验收

| 子项 | 文件／内容范围 | 必须证明 |
| --- | --- | --- |
| 2A 本文设计审查 | 本文及进度记录 | 迁移批次、旧 AI 兼容、约束与范围可核对；已完成 |
| 2B 契约与规则上下文 | contracts、backend/sections、模块注册及提示词适配 | 无非法板块／AI 回退；并发提示词不串；AI 输入与版本不变 |
| 2C 数据与身份 | 新迁移、materials/provenance、来源管理 | 同链接跨板块独立、同板块重采不增、复合关系拒绝混板块 |
| 2D 执行与出口 | jobs、editorial、events、publication、admin、回执与预算 | 队列、召回、合并、缓存、模型、费用和所有旧出口范围正确 |
| 2E 回归验收 | 独立测试库、假服务、构建与本地 API | 完成下列测试；不把基础单元测试说成后台已跑通 |

子项用于在同一阶段组织工作，不自动扩大到六源入库或真实模型调用。阶段 2 全部完成后仍需展示差异、提交／推送批准及阶段 3 批准。

### 需新增的关键用例

- 来源 world＋任务 ai、文章 world＋请求 ai、无效板块、旧无板块队列指向 world：在任何付费请求或写入前拒绝。
- 相同规范化 URL 两板块各一条；同板块重采零新增，修订只影响本板块。
- SQL 直接尝试跨板块 source/article、fact/article、story/fact、story/story 合并关系：数据库约束拒绝。
- 同板块 publications 引用另一 article 的 analysis：拒绝。
- AI／world 并发使用同名提示词，文本、包含文件、分类、缓存、模型选择、回执均不串。
- 老 AI logical_key 可复用已保存回执，AI promptVersion、门槛、首次导入、日报编排和公共响应格式不变。
- 世界来源地址可与 AI 相同，同板块重复创建仍拒绝；来源更新不能改所属板块。
- 各旧出口和统计以混合测试数据逐项检查，不只检查一个列表。
- 世界材料正文补取请求计数为零；缺摘要／时间为待补，不能错用 AI 的 UNKNOWN 公开行为。
- 板块额度耗尽不调用；总额耗尽两板块都停；并发计数、重试和回执复用正确。
- 世界热点快照 JSON 或报告修订夹入 AI ID：写入拒绝，公开读取也不能泄漏。
- 迁移历史检查、类型检查、数据库测试、前端构建／既有测试及 API 冒烟。

## 8. 当前审查与进度

请审查本设计，尤其四个技术选择：共享表加归属与复合约束；旧 AI 提示词和回执身份保持；扩展／切换分批发布；world 未配置模型／预算时明确暂停而不是借用 AI。

未完成样本标注不阻碍做隔离基础测试，但阻止声明规则已冻结、校准或启用自动发布。来源使用许可、生产模型与预算继续由使用者决定。

2B 当前差异：新增严格 SectionId、不可变规则注册和独立提示词工厂；旧 AI 提示词入口保持兼容；世界新闻采用自己的分类、提示词和显式模型步骤配置，不继承 AI 的步骤环境变量或后台覆盖。世界门槛为空，提示词是规则稿，尚未接入分析／事件工作流。

早期 2B 不执行迁移；后续 2C 已在专用测试库执行扩展迁移，但未改业务库或调用真实付费服务，实际模型费用仍为 0 元。5 元是本轮授权上限，不是已实现的人民币预算熔断。真实调用前仍须确认可执行的费用上界。2C 生产身份切换、2D 队列／读取／回执预算和完整 2E 验收未完成，不能据此接入世界来源。修改待审，尚未提交／推送。

### 2B 验证记录

| 检查 | 结果与边界 |
| --- | --- |
| 规则与并发提示词 | 6 项通过，含全部 AI 提示词原文本／哈希兼容、缺文件不回退、不可变规则 |
| 模型选择 | 1 项通过，AI／world 覆盖与缓存各自独立，错误世界配置拒绝；未请求模型 |
| 类型、构建与差异 | 类型检查、前端构建、迁移历史检查、`git diff --check` 通过；无新 SQL 迁移 |
| 本地页面／接口冒烟 | 专用空测试库、采集与模型关闭，30 项通过；不是 world 接口验收 |
| 全量数据库测试 | 未通过：本机缺 `pg_dump`，备份测试失败；此前误关假模型和模板库被冒烟服务占用的运行无效，已纠正后重跑 |
| 既有前端测试 | 首轮 42/44 通过；悬停项单独复测通过，分类返回缓存项单独复测仍失败；无前端改动，未修复该问题 |

前端使用仓库 Playwright（Browser plugin not available），覆盖 Chromium 和 WebKit。测试流程包含列表 → 分类／详情 → 返回、离线缓存及播放器交互；未进行本批新 UI 的视觉验收，因为本批不改 UI。缓存失败表现为返回已访问的模型分类时额外请求数据，见 `apps/web/tests/navigation-performance.test.ts:155`。不能把构建成功或单项复测通过写成完整前端验收。

### 2C 扩展批次与最新验收（2026-10-11）

使用者批准继续数据库隔离，并允许补齐所需备份客户端。本批新建 `0058`—`0063` 共 99 个迁移文件，按现有在线迁移约定拆分列、CHECK、索引、外键及验证；不改旧文件、不删除数据、不删除旧全局唯一约束。在专用 PostgreSQL 17 Docker 测试库执行，不操作已有 `aihot-db-1` 业务库。

材料入口已检查来源归属，并按板块锁定、判重、记录发现和修订；原发来源候选只在本板块寻找。来源管理的列表、统计、详情、查重和修改按板块处理，归属不允许作为修改字段。世界来源创建后暂停，启用／手动采集被拒绝。旧 AI 分析、提取、处理队列入口、归组、合并、发布和采集入口拒绝或跳过世界资源；AI 热点快照、关联事件、评测与运行列表补充固定 AI 范围。仍不是所有公开出口／后台／工作流已完全隔离。

`articles_identity_key_key` 未删除时，世界材料入口明确拒绝写入。测试中的跨板块同链接行为仅在每文件专用临时库模拟后续切换；上线切换仍等待 2D 全部改造与审查，不能以本批验收替代。

| 验证 | 最新结果 |
| --- | --- |
| 后端全量回归 | **699/699 通过**；模型／付费接口使用本地假服务 |
| 备份与恢复 | 8 项通过，包含真实导出／恢复、附件、失败处理与保留策略；对象存储为假服务，无外部上传 |
| 数据隔离 | SQL 拒绝跨板块来源、分析、事实、事件、发现、信号和合并关联；同板块但引用另一篇文章分析也拒绝 |
| 身份、并发与修订 | 模拟切换后同链接跨板块各一条；12 次同板块并发只创建一条；世界修订不修改 AI |
| 30 条既有真实 RSS 快照 | 离线重放得到 60 条独立记录，重复重放零新增／零修订，摘要缺失保持缺失；没有联网抓取或生成全文 |
| 带旧数据升级 | 旧文章 ID、原文身份、修订、来源游标、发布内容和关系不变；旧数据默认 AI；再次迁移零新增 |
| 类型／构建／迁移／差异 | 类型检查、前端构建、迁移历史与在线安全检查、空白差异检查通过 |
| 前端既有测试 | **44/44 通过**，Chromium／WebKit；此前缓存失败本次未复现，未修改前端，不宣称已定位或修复原因 |
| 本地 API／页面冒烟 | **30/30 通过**，`http://127.0.0.1:3330`，采集／模型／推送关闭；非世界接口验收 |

备份环境说明：Docker 应用镜像已有 `pg_dump`／`pg_restore` 17.11，数据库仍是 Docker 内的 PostgreSQL 17。本机直接运行 Node 测试需要宿主机客户端，本轮安装 Homebrew `libpq` 18.6，仅在测试命令临时加入 PATH；未改 shell 启动配置、`.env` 或备份业务实现。

本批费用 0 元；未提交／推送、未合并 main、未纳入使用者 `docker-compose.yml` 改动。下一批是 2D：任务载荷与消费核验、召回／缓存／完整公开读取、世界规则执行、回执与分板块预算；完成后再审查生产身份切换。世界接口、采集闭环、校准与真实模型验收仍未完成。

### 2D 首批：旧 AI 公开读取边界（2026-10-11，待审）

使用者批准后，2B／2C 已本地提交 `3edf9c9`，没有推送或合并。以下是继续阶段 2D 的独立差异，不包含新的数据库迁移或生产身份切换：

- `publication/scope.ts` 的列表、事件报道、精选及机器代表条件都包含板块；省略时保持旧入口 AI，显式非法板块拒绝，不解释成全站。世界接口以后可显式使用 `world`，当前未注册。
- 详情／Markdown、分享图元数据、收藏可用性和事件 ID／别名解析限制 AI；世界 ID 在旧入口不可读。
- 日报周报月报的目录、详情、最新期、相邻期与期号只计 AI；站点地图及全站统计在本阶段仍是 AI 范围。
- 精选快照、水位和变更只读 AI 的账本与状态；世界记录不会作为删除通知泄漏其 ID。
- AI 热度的当前信号、来源健康时钟、历史修复与过期快照清理限制 AI；不复用世界排序规则。
- 测试人为创建两板块公开材料，验证即使未来世界已有公开数据，旧 HTTP／RSS／Agent／MCP 入口仍保持 AI。所有数据和本地 MCP 连接均属于专用测试环境，没有启动生产 worker、采集或模型。

验收：专项 7/7、后端全量 706/706、前端既有回归 44/44、类型检查、前端构建、迁移历史／在线安全、差异检查及本地页面／API 冒烟 30/30 均通过。浏览器回归使用仓库现有 Playwright（Browser plugin not available），没有改 UI 或声称新世界页面已完成。专用 Docker 测试库及临时 API／Web 服务验收后已停止，没有操作业务库或真实模型，费用 0 元。

本批新差异尚未提交／推送，等待使用者审查。仍待完成：任务消费与资源归属核验、独立世界召回／模型执行、回执与板块预算、世界公开接口及后台切换。不能据这批宣称阶段 2D 或完整链路已完成。
