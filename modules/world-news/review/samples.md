# 世界新闻：30 条真实 RSS 初审材料

- 快照时间：`2026-10-11T16:27:58.649682+08:00`（北京时间）。
- 方法：六个来源各取 RSS 当前前 5 条，共 30 条；六次响应 HTTP 200。
- 状态：未标注、未入库、未公开、未调用模型、未独立事实核查。
- 这是规则讨论初审池，不是正式 100 条金标或均衡代表性样本；未运行项目读取器，不能当作采集链路验收。
- 只读取 RSS，没有访问原文页。快照中的 `rssText` 是订阅 description 经审查脚本去除 HTML 后的文字，不是全文，也不是 AI 摘要；空值原样保留。
- 材料用于本仓库审查，来源处理／翻译／公开展示权限仍待确认，不因保存样本获得授权。

## 1. 怎样标注

打开[材料快照](samples.json)，按编号阅读 title、rssText、publishedAtRaw；只依据当时 RSS 材料判断，不把打开原文后新增信息默认为快照已有。

将每条 `labels: null` 改为以下对象。示例仅说明格式，不是 W01 的答案；尚未确定的字段填 null，不能由 AI 擅自填写使用者标签。

```json
{
  "relevance": "PASS",
  "materialSufficient": false,
  "primaryCategory": "经济与产业",
  "contentType": "机构声明",
  "selection": "pending",
  "eventGroup": null,
  "reason": "相关，但 RSS 没有提供足够信息；等待材料。"
}
```

- relevance：PASS／BLOCK／UNKNOWN；与材料充分性分开判断。
- materialSufficient：true／false／null；是否足够支持具体中文摘要，不是文字长短。
- primaryCategory：三个已确认分类之一或 null；交叉题材选主分类，在 reason 写辅助方向。
- contentType：事实报道／机构声明／评论分析或 null。
- selection：select／reject／either／pending；评价本条材料本身的注意力价值，不因另一个来源已报道就 reject。
- eventGroup：具体事件的自定组号或 null；同一事件／直接进展用同组，不能同国同战争全部一组。正式开发／留出分集要整体按事件分组。
- reason：一句判断理由；材料不足、矛盾说法、重复无增量等明确写出来。
- 初审同一事件的直接进展如何划分仍需人工确认；AI 不预填分组和金标。

## 2. 初审目录

| 编号 | 来源 | RSS 标题（原文，仅供核对） | 原文入口 |
| --- | --- | --- | --- |
| W01 | 联合国中文新闻 | 世卫组织呼吁从机构化照护转向社区精神卫生照护 | [链接](https://news.un.org/feed/view/zh/story/2026/10/1142970) |
| W02 | 联合国中文新闻 | 世界邮政日：邮政网络连接世界，开启无限可能 | [链接](https://news.un.org/feed/view/zh/story/2026/10/1142969) |
| W03 | 联合国中文新闻 | 前联合国人权高专皮莱获诺贝尔和平奖 | [链接](https://news.un.org/feed/view/zh/story/2026/10/1142968) |
| W04 | 联合国中文新闻 | 廉价老花镜仍是提升生活质量的关键途径 | [链接](https://news.un.org/feed/view/zh/story/2026/10/1142967) |
| W05 | 联合国中文新闻 | 人权高专：实现赔偿正义必须消除制度性种族主义 | [链接](https://news.un.org/feed/view/zh/story/2026/10/1142966) |
| W06 | France 24 | Spanish PM Sanchez kicks off election campaign amid housing crisis protests | [链接](https://www.france24.com/en/europe/20261011-spanish-pm-sanchez-kicks-off-election-campaign-amid-housing-crisis-protests) |
| W07 | France 24 | Riyadh airport strike kills 12, Saudi Arabia threatens 'decisive' response | [链接](https://www.france24.com/en/middle-east/20261011-riyadh-airport-strike-kills-12-saudi-arabia-threatens-decisive-response) |
| W08 | France 24 | India court orders release of 'cockroach' movement leaders after detention | [链接](https://www.france24.com/en/asia-pacific/20261011-india-court-orders-release-of-cockroach-movement-leaders-after-detention) |
| W09 | France 24 | Middle East live: Riyadh airport attack 'not acceptable', Trump says | [链接](https://www.france24.com/en/middle-east/20261011-live-saudi-arabia-vows-decisive-response-after-deadly-houthi-strike-on-riyadh-airport) |
| W10 | France 24 | SPOTLIGHT | [链接](https://www.france24.com/en/tv-shows/spotlight/20261010-spotlight) |
| W11 | NPR 世界新闻 | Attack on Riyadh airport killed 12 people and wounded over 300 more, Saudi authorities say | [链接](https://www.npr.org/2026/10/10/g-s1-147682/attack-on-riyadh-airport-killed-12-people-and-wounded-over-300-more-saudi-authorities-say) |
| W12 | NPR 世界新闻 | Bayeux Tapestry's London tour spurs enthusiasts to Battle of Hastings reenactment | [链接](https://www.npr.org/2026/10/10/nx-s1-5993847/bayeux-tapestrys-london-tour-spurs-enthusiasts-to-battle-of-hastings-re-enactment) |
| W13 | NPR 世界新闻 | Trump weighs joining the fight against Houthis after Riyadh airport attack | [链接](https://www.npr.org/2026/10/10/nx-s1-5997512/saudi-arabia-riyadh-airport-bombing-attack) |
| W14 | NPR 世界新闻 | Protests against voter roll revisions rock capital of world's largest democracy | [链接](https://www.npr.org/2026/10/10/nx-s1-5995118/protests-against-voter-roll-revisions-rock-capital-of-worlds-largest-democracy) |
| W15 | NPR 世界新闻 | U.S. and Russia tout diesel deal to ease sanctions and reopen fuel flows | [链接](https://www.npr.org/2026/10/10/nx-s1-5996938/u-s-and-russia-tout-diesel-deal-to-ease-sanctions-and-reopen-fuel-flows) |
| W16 | 美联储公告 | Federal Reserve Board releases results of the 2025 Survey of Consumer Finances, which provides the public and policymakers with detailed insights into the economic condition of American families | [链接](https://www.federalreserve.gov/newsevents/pressreleases/other20261009a.htm) |
| W17 | 美联储公告 | Federal Reserve Board announces enforcement action against American Express Company to address, among other things, the firm’s failure to sufficiently detect and report certain suspicious activity related to money laundering | [链接](https://www.federalreserve.gov/newsevents/pressreleases/enforcement20261008a.htm) |
| W18 | 美联储公告 | Minutes of the Federal Open Market Committee, September 15-16, 2026 | [链接](https://www.federalreserve.gov/newsevents/pressreleases/monetary20261007a.htm) |
| W19 | 美联储公告 | Federal Reserve Board announces approval of application by Isabella Bank Corporation | [链接](https://www.federalreserve.gov/newsevents/pressreleases/orders20261005a.htm) |
| W20 | 美联储公告 | Federal Reserve Board announces approval of application by Fleur Capital Corporation | [链接](https://www.federalreserve.gov/newsevents/pressreleases/orders20261002a.htm) |
| W21 | 欧洲央行新闻 |  Meeting of 9-10 September 2026 | [链接](https://www.ecb.europa.eu//press/accounts/2026/html/ecb.mg261008~a10153d090.en.html) |
| W22 | 欧洲央行新闻 |  Piero Cipollone: Interview with Corriere della Sera | [链接](https://www.ecb.europa.eu//press/inter/date/2026/html/ecb.in261008~3184e7d0d0.en.html) |
| W23 | 欧洲央行新闻 |  Results of the September 2026 survey on credit terms and conditions in euro-denominated securities financing and OTC derivatives markets (SESFOD) | [链接](https://www.ecb.europa.eu//press/pr/date/2026/html/ecb.pr261007~6447350434.en.html) |
| W24 | 欧洲央行新闻 |  Frank Elderson: Effective supervision through timely remediation | [链接](https://www.ecb.europa.eu//press/key/date/2026/html/ecb.sp261006_1~0df91e4e44.en.html) |
| W25 | 欧洲央行新闻 |  Piero Cipollone: Money in the digital age: digital euro, tokenisation and the role of central banks | [链接](https://www.ecb.europa.eu//press/key/date/2026/html/ecb.sp261006~0da978f159.en.html) |
| W26 | WTO 新闻 | AI boom and trade resilience to Middle East crisis lift outlook, but gains to be uneven | [链接](https://www.wto.org/english/news_e/news26_e/stat_08oct26_510_e.htm) |
| W27 | WTO 新闻 | General Council addresses WTO reform, ministerial follow-ups, ongoing negotiations | [链接](https://www.wto.org/english/news_e/news26_e/gc_05oct26_508_e.htm) |
| W28 | WTO 新闻 | Co-sponsors of sustainability initiative advance work plan towards MC15 | [链接](https://www.wto.org/english/news_e/news26_e/tessd_02oct26_507_e.htm) |
| W29 | WTO 新闻 | WTO MSME Group explores IP's role in trade, hears success stories and updates | [链接](https://www.wto.org/english/news_e/news26_e/igmsm_02oct26_505_e.htm) |
| W30 | WTO 新闻 | DDG Nordquist: Trade continues apace, showing resiliency | [链接](https://www.wto.org/english/news_e/news26_e/ddgjn_01oct26_506_e.htm) |

## 3. 已观察到的材料限制与待补范围

- W21—W25（欧洲央行）无 RSS 摘要：保留空值，不从标题推断会议决定、讲话内容或报告结果。
- 美联储样本存在摘要仅重复标题的情况；“说明发布了报告”与“支持概括报告内容”不同。
- 各来源前五条不是按正例／噪声／边界比例抽样；没有先替使用者决定哪些该选。
- 本池有健康／文化、机构例行活动、节目介绍、经济和冲突交叉材料，适合讨论边界；评论分析、重大政策后果、相互矛盾说法仍需补充代表性真实材料。
- RSS 时间有不同时区并包含旧文；初审不能用当前抓取时间代替发布时间。
- 这批看过并据此改规则的材料可用于开发，不得混进“未见”留出集。
- 额外工程测试另需本地虚构夹具：缺时间、提示词注入、相同链接跨板块、重复／修订、48 小时边界、日期时区等。须明确标为虚构，不冒充真实媒体材料。

## 4. 下一步与禁止事项

使用者先完成或反馈标签 → 修订规则 → 审查阶段 2 的隔离实现。100 条正式样本及 80／20 事件隔离分集在后续阶段安排。

不要把本 JSON 直接传给现有 AI 评测脚本：它不是该脚本的格式，世界规则及板块上下文尚未适配。当前不扫描门槛、不填写模型评价、不启用公开结果。
