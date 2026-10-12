# 世界新闻精选校准

## 本轮状态（2026-10-12）

使用者决定暂不进行人工标签，后续再做。本轮不再逐批索要标签，也不把“全部认为 OK”填写成 100 条人工金标或 F2 验收结果。以下流程与工具保留，供后续恢复校准；样本标签、事件分集和生产门槛保持未完成，不启用生产自动精选／热点推荐。

当前工具只做离线计分，不调用模型、不连接数据库、不写生产门槛。它不是已经完成的 100 条人工验收，也不能验证标签确实由人工提供。

## 输入与操作

先准备至少 100 条真实材料，人工标注每条自身的精选价值；同一具体事件及直接进展放同一分集，目标开发／留出约 80／20。初审 30 条及用于改规则的事件只能进开发集。保留实际 RSS 材料、来源、修订、提示词版本和回执的对应记录，不拿全文或后来知识替代当时材料。

结果文件保存于不入 Git 的 `.data/world/labelled-results.json`，为 JSON 数组。每条格式如下；这是格式示例，不是新闻金标：

```json
{
  "caseId": "world-001",
  "eventGroup": "specific-occurrence-001",
  "split": "development",
  "reviewedDuringRuleDevelopment": true,
  "gold": { "decision": "select", "annotator": "人工标注者代号", "reason": "人工判断理由" },
  "result": { "relevance": "PASS", "materialSufficient": true, "scores": [72, 68], "error": null }
}
```

`decision` 可为 select／reject／either；未标注的 pending 不能传入。每个分集必须有明确正例和负例。`scores` 是两次独立评分，不提前取整；失败、未评分可为 null。UNKNOWN、材料不足、错误或 PASS 缺评分没有完成决定，保留为失败／待补，不伪装成成功拒绝。BLOCK 不要求评分，是成功拒绝。

运行：

```bash
node modules/world-news/scripts/calibrate.ts .data/world/labelled-results.json
```

报告输出到终端，可由操作者保存；不会生成文件或更新线上配置。结果数组应来自世界新闻独立执行结果，不能使用现有 AI 行业评测提示词或门槛。

## 选择与验收

只在开发集扫描整数门槛 0—100，用两次分数之和与门槛的两倍比较。按有效决定 F2 选最优，再依次比较查全率、查准率；仍同分时选较低门槛。F2 = 5TP / (5TP + 4FN + FP)，使用未四舍五入的计数比率排序。

报告同时给出覆盖率、失败编号、错例、完整准确率及 completeF2（把未完成的该选材料也计作漏选），避免有效 F2 掩盖失败。either 不计入质量指标，失败另列。留出集仅按开发集选定门槛评估一次，不输出留出扫描。实际分集比例会报告；不为凑比例拆开事件。

工具会拒绝同事件跨集、已用于规则开发的留出材料、重复编号及不完整标签。它不能发现人工给同一事件起了两个不同组号，最终事件分集需人工核对。

尚待完成：真实 100 条材料及人工金标、世界结果采样／版本对应、真实评测与错例修订、最终留出验收。任何生产门槛启用仍须满足原规划的校准和发布条件。

## 与真实试验库结果衔接

本机已准备 `.data/world/human-gold.json` 空白标签模板（未填答案）和 `.data/world/model-results.json` 保存分析结果。原材料在 `.data/world/review-pool.json`，三个文件均不提交。先人工填写标签模板的 eventGroup、split、gold，保留已见标记和 caseId；其 result 留空，由工具接真实输出，不靠手抄评分。

生成模板／导出结果（只输出到终端，可由操作者保存）：

```bash
node modules/world-news/scripts/prepare-gold.ts
DATABASE_URL=postgres://postgres@127.0.0.1:54512/world_real_trial_test node modules/world-news/scripts/export-results.ts
node modules/world-news/scripts/attach-results.ts .data/world/human-gold.json .data/world/model-results.json
```

最后一条输出校准数组，保存为 `.data/world/labelled-results.json` 后才运行本页的计分命令。样本改换须先更新冻结索引，不能拿旧结果对新材料打分。

导出器只读实际 world 材料及当前修订的最近分析，不采集、不调用模型、不入库；全文、模型写出的摘要和金标都不在结果文件中。每条包含样本指纹、analysisId、promptVersion 和执行结果；版本可能属于不同试跑，使用者必须在正式评测时核对同一规则／模型配置，工具不宣称旧结果自动适用于新提示词。材料指纹不匹配时整个导出拒绝；没有分析显示 not analysed，UNKNOWN 保持待补，两者不伪装成功拒绝。

当前仅 5 条已有分析（3 PASS、2 UNKNOWN），另外 95 条尚未分析。标签和事件分集仍全部为空，因此 attach-results 和正式 F2 尚不能成功执行；部分导出不是 100 条真实评测。正式评测需按开发集先运行、冻结规则与门槛后再验收留出集，不得因为导出了全部材料就提前调参留出。
