# 竞赛数据接口（已实现）

日期：2026-10-15。共享响应类型在 `@aihot/contracts/competitions`，请求schema在 `backend/query.ts`。候选查询、展示版本、公开列表／详情／筛选／总览及三层前端已实现；每日增量生产后续开发。

## 1. 展示规则与身份

使用者已授权：**现有31项校验通过候选首次展示，后续更新另行选择。** 首次清单固定为2026-10-14最终验收快照，不自动选择未来最新候选。缺图、字段未知或非今年年份可以展示；结构／引用校验不等于完整语义审核。

身份关系：`competitionId → editionId → revisionId`。项目来自学校名录，届次为稳定UUID；年份不充当唯一身份，同年多届可分别创建。展示指针固定revisionId，修订变化不改变详情地址。候选保留原draft／needs_review研究状态，展示选择单独记录。

首版返回全部已选定且未撤回的届次，默认按名录ID、届次ID稳定排序；不隐藏历史、不做重点评分。年份／状态可显式筛选。目前是首次选定的31届，不宣称覆盖全部历史或赛段。

公开管理员与访客读取一致；候选及调查材料只在受保护接口。所有公开请求经 `packages/backend/src/publication/modules.ts` 调用本模块读取器，路由不直接读库。

## 2. 公开接口

### `GET /api/v1/competitions`

| 参数 | 格式与默认值 | 语义 |
| --- | --- | --- |
| q | 最多200字符，默认空 | 名录名称／展示名称大小写不敏感的字面子串 |
| category | 批准标签，多个用英文逗号分隔 | 11个标签复用taxonomy.ts |
| schoolLevel | 如A2、B2，多选逗号分隔 | 主体或专项级别；枚举来自filters |
| year | 2000–2200四位年份或unknown | 精确匹配primary；unknown为年份待核验 |
| activity | 下述状态，多个逗号分隔 | 匹配任一对应范围的状态 |
| sort | catalogue（默认）、year_desc、next_node | 名录顺序、年份降序、下一节点升序；无值放后，并列按稳定身份 |
| page | 1–1000000，默认1 | 超出结果页返回空items及真实total |
| pageSize | 1–100，默认20 | 服务端过滤、排序和分页，前端不用下载全库 |

不同维度取交集，同维度多选取并集。每个参数只能出现一次，中文需URL编码；未知参数、标签、级别、状态和非法分页返回400。示例：`/api/v1/competitions?year=2026&activity=registration_open&pageSize=20`。

返回 `CompetitionList`：`{ items: CompetitionRecord[], total, page, pageSize, computedAt }`。total为过滤后的可见届次数，不是名录数／修订数；多分类不重复计数。

### `GET /api/v1/competitions/filters`

无查询参数。返回 `CompetitionFilters`：categories、schoolLevels、years、hasUnknownYear、activities、sorts。分类为批准全集，级别／年份为当前可见集合，不随筛选联动；本版无分类计数或热度。

### `GET /api/v1/competitions/overview`

无查询参数。返回 `CompetitionOverview`：total（可见届次）、registrationOpen／competitionOngoing（任一已知范围开放／进行的届次数）、active、featured（记录及方向理由）、upcoming（记录与最近可确定节点）、categories（方向、去重届次数及最多3项入口）、changes、computedAt。总览与列表读取相同展示版本，不触发采集或模型。

使用者允许先自行选择重点，`featured.ts` 按软件、人工智能、数学建模三个方向固定选择；每项目优先已知年份最新的可见届次，不宣称热度。总览只截取前6项进行中与前10个近期节点用于页面编排，全部记录仍可由竞赛库检索，不设重要性门槛。

changes只反映当前仍可见的展示版本，相对前一明确选择版本的已知报名时间、比赛时间、人数、教师限制或赛段变化；提供changedAt及fields中的name、previous、current。首次收录、仅候选变化、未知恢复、原文证据变化不当成重要事实变更；撤回后从总览同时消失。未实现每日自动发现或自动发布新变化。

### `GET /api/v1/competitions/:competitionId/editions/:editionId`

无查询参数。返回 `CompetitionDetail`：`{ item: CompetitionRecord, editions: [{ editionId, name, year }], computedAt }`。editions只包含同项目可见届次。身份格式错误400；不存在、归属错误、未展示或撤回404，不暴露内部草稿状态。

### 记录与缺失语义

CompetitionRecord包含稳定身份、revisionId、version、publishedAt、业务字段、schoolRecognition、activity、nextNodes、sources。业务字段保留 `{ value, status, reason }`，不公开原始evidence及模型reason。

| status | value和界面说明 |
| --- | --- |
| known | 原值，reason为空 |
| unknown | null；资料不足，待核验 |
| not_stated | null；已查材料未说明 |
| not_applicable | null；不适用 |
| pending | null；官方安排待公布 |
| conflict | null；材料存在冲突，待核验 |

人数／教师限制保留scope、text、minimum、maximum、counts，null上限不等于不限。schoolRecognition保留所选修订的schoolLevel／schoolLevelByScope／schoolRecognitionText，不能推断学校名称或全国级别。图片缺失用文字布局；文件仅提供已有title／url，不强制新增机构等字段。

sources为所选修订实际材料的url／fetchedAt，不代表每个链接都是官网。官网有单独字段状态。publishedAt是本站选择展示版本时间，fetchedAt是材料读取时间，均不是官方发布日期。公开不返回材料块、运行报告、预算或回执。

### 时间与状态

- activity按报名／比赛条目返回kind、scope、label、status；枚举为registration_open／registration_upcoming／registration_closed、competition_ongoing／competition_upcoming／competition_finished、unknown。某赛段finished不代表全赛事结束，界面保留范围。
- day区间包含当地起止自然日；minute按实际时刻计算 `[start,end)`。不依赖服务器时区。
- 只有截止且未到期不宣称开放；过期可标该范围截止。只有开始且已开始不无限宣称进行中。月份、大约表达、区间不足保留unknown。
- nextNodes只返回最近可确定的未来节点，并列全部保留。包含kind、scope、label、officialText、precision、timezone、date、daysRemaining。日级截止在最后一天结束后到期，date仍保留官方截止日。
- daysRemaining按该时区自然日差计算，截止当天为0；不确定时不生成精确倒计时。computedAt为后端计算时间。无新材料也能跨日改变状态，无需新修订或模型调用。
- 当前no-store，避免时间或撤回被旧缓存遮蔽；返回既有公共CORS／站点策略头。服务失败返回Problem JSON，不包装成空列表。

## 3. 管理员接口与版本操作

均复用session鉴权（未登录401），写操作需要 `x-csrf-token`（缺失／过期403）。

| 请求 | 输入／返回 |
| --- | --- |
| `GET /api/admin/competitions/candidates` | 仅q、page、pageSize；每个名录最新候选、validation（含errors／missing）、已绑定届次，total及分页；无候选名录也保留 |
| `GET /api/admin/competitions/:competitionId/candidate` | 可选revisionId，否则最新；catalogue、revision、materials、sources、revisions、displays |
| `POST /api/admin/competitions/:competitionId/editions` | `{ revisionId, reason }`；返回editionId。已绑定则返回原届次，否则明确创建新届次，不按年份猜测 |
| `POST /api/admin/competitions/:competitionId/editions/:editionId/display` | `{ revisionId: string或null, expectedVersion, reason }`；选择修订／null撤回，返回edition_id、revision_id、version、published_at |

初建届次version=0；选择／撤回递增。expectedVersion不符409，重新查询displays后再操作。选择既有届次可明确绑定未归属修订；跨项目、跨已绑定届次、与该届已知年份不一致均拒绝。同年不等于同届，操作者仍须核对名称与范围。

写入前按持久化材料重算结构、引用、日期及分类校验，核对学校认定，拒绝已拒绝候选；允许明确缺失，不要求图片齐全。版本写入及audit_log记录同事务提交，并发操作不会静默覆盖。Agent入库新修订不自动执行展示选择。

## 4. 首次展示与验证

指定 `DATABASE_URL` 后：

```bash
node scripts/migrate.ts
node modules/competition/scripts/publish-initial.ts
node modules/competition/scripts/publish-initial.ts --apply
node modules/competition/scripts/verify-publication.ts
```

0064–0066只新增三张模块表，不删除既有数据。首次展示／届次回填不进入发布迁移。脚本默认输出计划，--apply使用已授权最终31项快照，事务内创建届次并选择展示；最新修订不同或校验失败时整批拒绝。重复执行不覆盖后续选择、不恢复已撤回内容，不作为永久自动发布入口。

验证脚本通过HTTP处理器逐项对照列表／详情／搜索／分页、展示指针及原字段缺失状态，核对任务及回执计数不变；不证明所有事实语义正确。前端总览、库、详情及独立收藏均已接入；长期预算、生产采集及增量自动发布不因本次首次展示授权而开启。
