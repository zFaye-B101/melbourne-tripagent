# 本地模型评测：qwen3.5:9b（2026-09-29）

> 由 `npm run eval:ollama` 生成。本地模型，不代表线上模型；未花线上额度。

| 项 | 值 |
|---|---|
| model | qwen3.5:9b |
| think | false |
| numCtx | 16384 |
| runsPerTask | 3 |
| promptVersion | nlu-extraction-system-v2.10 |
| plannerVersion | trip-planner-v0.4.3-local |
| poiDataVersion | mel-poi-v0.1-2026-09-14 |
| gitCommit | bb31f1a |
| workingTreeDirty | true |
| date | 2026-09-29 |
| note | 本地模型，不代表线上模型；未花线上额度。 |
| replayOf | eval/reports/ollama-qwen3.5-9b-2026-09-29-drafts.jsonl |

## 汇总

| 指标 | 值 |
|---|---|
| runs | 87 |
| tasks | 29 |
| llmAccepted | 12/87 |
| llmAcceptedWhereProductionWouldCallModel | 6/63 |
| acceptedButDiffersFromRules | 0 |
| planOkChangedVsRules | 0 |
| contextFullRuns | 0 |
| latencyMs | {"p50":0,"p90":0,"max":0} |

## 未采纳原因（第一道未通过的校验）

| 原因 | 次数 |
|---|---|
| evidence.missing_required_coordinate @ /pace | 9 |
| evidence.missing_required_coordinate @ /days | 9 |
| semantic.evidence_not_proven @ /mustIncludeNames | 6 |
| evidence.missing_required_coordinate @ /unresolvedPhrases | 6 |
| evidence.quote_not_in_source @ /evidence | 6 |
| evidence.missing_required_coordinate @ /date/resolution | 6 |
| evidence.missing_required_coordinate @ /destination/text | 6 |
| evidence.literal_mismatch @ /evidence | 6 |
| semantic.evidence_not_proven @ /experiencePreferences/museum_exhibition | 3 |
| semantic.evidence_not_proven @ /party/concessionEligibleCount | 3 |
| semantic.evidence_not_proven @ /pace | 3 |
| worse_than_rules | 3 |
| semantic.evidence_not_proven @ /days | 3 |
| semantic.rule_mismatch @ /mustIncludeNames | 3 |
| evidence.missing_required_coordinate @ /unhandledRequirements | 3 |

## 逐题

| ID | 线上是否会调模型 | 采纳次数 | 未采纳原因 | 与规则不同的字段 | 平均耗时 ms |
|---|---|---|---|---|---|
| 01 | 不会（规则已够用） | 0/3 | evidence.missing_required_coordinate：抽取值 /pace#scalar 缺少原文 evidence。 | — | 0 |
| 02 | 会 | 0/3 | semantic.evidence_not_proven：/mustIncludeNames evidence 未把地点与明确意图绑定。 | — | 0 |
| 03 | 不会（规则已够用） | 0/3 | evidence.missing_required_coordinate：抽取值 /unresolvedPhrases#0 缺少原文 evidence。 | — | 0 |
| 04 | 会 | 0/3 | evidence.quote_not_in_source：Evidence /destination/supportedCity#scalar 不是原文中的有效片段。 | — | 0 |
| 05 | 不会（规则已够用） | 3/3 | — | — | 0 |
| 06 | 不会（规则已够用） | 0/3 | evidence.missing_required_coordinate：抽取值 /date/resolution#scalar 缺少原文 evidence。 | — | 0 |
| 07 | 会 | 3/3 | — | — | 0 |
| 08 | 会 | 0/3 | semantic.evidence_not_proven：体验偏好 museum_exhibition 无法由 evidence 证明。 | — | 0 |
| 09 | 不会（规则已够用） | 3/3 | — | — | 0 |
| 10 | 不会（规则已够用） | 0/3 | semantic.evidence_not_proven：优惠票数量 evidence 与抽取值不一致。 | — | 0 |
| 11 | 会 | 0/3 | evidence.missing_required_coordinate：抽取值 /pace#scalar 缺少原文 evidence。 | — | 0 |
| 12 | 会 | 0/3 | semantic.evidence_not_proven：/mustIncludeNames evidence 未把地点与明确意图绑定。 | — | 0 |
| 13 | 会 | 0/3 | semantic.evidence_not_proven：节奏 evidence 与抽取值不一致。 | — | 0 |
| 14 | 会 | 0/3 | evidence.missing_required_coordinate：抽取值 /date/resolution#scalar 缺少原文 evidence。 | — | 0 |
| 15 | 会 | 0/3 | evidence.missing_required_coordinate：抽取值 /destination/text#scalar 缺少原文 evidence。 | — | 0 |
| 16 | 会 | 0/3 | evidence.missing_required_coordinate：抽取值 /days#scalar 缺少原文 evidence。 | — | 0 |
| 17 | 不会（规则已够用） | 0/3 | evidence.literal_mismatch：Evidence /party/childAges#0 未包含对应原文值。 | — | 0 |
| 18 | 会 | 0/3 | evidence.missing_required_coordinate：抽取值 /days#scalar 缺少原文 evidence。 | — | 0 |
| 19 | 会 | 0/3 | — | — | 0 |
| 20 | 会 | 0/3 | evidence.missing_required_coordinate：抽取值 /days#scalar 缺少原文 evidence。 | — | 0 |
| 21 | 会 | 0/3 | evidence.missing_required_coordinate：抽取值 /unresolvedPhrases#0 缺少原文 evidence。 | — | 0 |
| 22 | 会 | 3/3 | — | — | 0 |
| 23 | 会 | 0/3 | evidence.missing_required_coordinate：抽取值 /pace#scalar 缺少原文 evidence。 | — | 0 |
| 24 | 会 | 0/3 | evidence.missing_required_coordinate：抽取值 /destination/text#scalar 缺少原文 evidence。 | — | 0 |
| 25 | 会 | 0/3 | evidence.quote_not_in_source：Evidence /experiencePreferences/parks_gardens#scalar 不是原文中的有效片段。 | — | 0 |
| 26 | 会 | 0/3 | evidence.literal_mismatch：Evidence /destination/text#scalar 未包含对应原文值。 | — | 0 |
| 27 | 不会（规则已够用） | 0/3 | semantic.evidence_not_proven：天数 evidence 与抽取值不一致。 | — | 0 |
| 28 | 会 | 0/3 | semantic.rule_mismatch：必去或避开地点与原文不一致。 | — | 0 |
| 30 | 会 | 0/3 | evidence.missing_required_coordinate：抽取值 /unhandledRequirements#0 缺少原文 evidence。 | — | 0 |
