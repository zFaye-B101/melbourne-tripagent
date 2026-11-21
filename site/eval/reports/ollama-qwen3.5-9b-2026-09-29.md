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
| gitCommit | d0e7cd3 |
| workingTreeDirty | true |
| date | 2026-09-29 |
| note | 本地模型，不代表线上模型；未花线上额度。 |
| replayOf | null |

## 汇总

| 指标 | 值 |
|---|---|
| runs | 87 |
| tasks | 29 |
| llmAccepted | 15/87 |
| llmAcceptedWhereProductionWouldCallModel | 9/63 |
| acceptedButDiffersFromRules | 3 |
| planOkChangedVsRules | 3 |
| contextFullRuns | 0 |
| latencyMs | {"p50":24543,"p90":33666,"max":38507} |

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
| semantic.evidence_not_proven @ /days | 3 |
| semantic.rule_mismatch @ /mustIncludeNames | 3 |
| evidence.missing_required_coordinate @ /unhandledRequirements | 3 |

## 逐题

| ID | 线上是否会调模型 | 采纳次数 | 未采纳原因 | 与规则不同的字段 | 平均耗时 ms |
|---|---|---|---|---|---|
| 01 | 不会（规则已够用） | 0/3 | evidence.missing_required_coordinate：抽取值 /pace#scalar 缺少原文 evidence。 | — | 25589 |
| 02 | 会 | 0/3 | semantic.evidence_not_proven：/mustIncludeNames evidence 未把地点与明确意图绑定。 | — | 21207 |
| 03 | 不会（规则已够用） | 0/3 | evidence.missing_required_coordinate：抽取值 /unresolvedPhrases#0 缺少原文 evidence。 | — | 25521 |
| 04 | 会 | 0/3 | evidence.quote_not_in_source：Evidence /destination/supportedCity#scalar 不是原文中的有效片段。 | — | 31931 |
| 05 | 不会（规则已够用） | 3/3 | — | — | 30437 |
| 06 | 不会（规则已够用） | 0/3 | evidence.missing_required_coordinate：抽取值 /date/resolution#scalar 缺少原文 evidence。 | — | 33283 |
| 07 | 会 | 3/3 | — | — | 23601 |
| 08 | 会 | 0/3 | semantic.evidence_not_proven：体验偏好 museum_exhibition 无法由 evidence 证明。 | — | 23205 |
| 09 | 不会（规则已够用） | 3/3 | — | — | 25222 |
| 10 | 不会（规则已够用） | 0/3 | semantic.evidence_not_proven：优惠票数量 evidence 与抽取值不一致。 | — | 25177 |
| 11 | 会 | 0/3 | evidence.missing_required_coordinate：抽取值 /pace#scalar 缺少原文 evidence。 | — | 24542 |
| 12 | 会 | 0/3 | semantic.evidence_not_proven：/mustIncludeNames evidence 未把地点与明确意图绑定。 | — | 22235 |
| 13 | 会 | 0/3 | semantic.evidence_not_proven：节奏 evidence 与抽取值不一致。 | — | 25016 |
| 14 | 会 | 0/3 | evidence.missing_required_coordinate：抽取值 /date/resolution#scalar 缺少原文 evidence。 | — | 26591 |
| 15 | 会 | 0/3 | evidence.missing_required_coordinate：抽取值 /destination/text#scalar 缺少原文 evidence。 | — | 17708 |
| 16 | 会 | 0/3 | evidence.missing_required_coordinate：抽取值 /days#scalar 缺少原文 evidence。 | — | 16939 |
| 17 | 不会（规则已够用） | 0/3 | evidence.literal_mismatch：Evidence /party/childAges#0 未包含对应原文值。 | — | 35659 |
| 18 | 会 | 0/3 | evidence.missing_required_coordinate：抽取值 /days#scalar 缺少原文 evidence。 | — | 11223 |
| 19 | 会 | 3/3 | — | blocked | 27456 |
| 20 | 会 | 0/3 | evidence.missing_required_coordinate：抽取值 /days#scalar 缺少原文 evidence。 | — | 20797 |
| 21 | 会 | 0/3 | evidence.missing_required_coordinate：抽取值 /unresolvedPhrases#0 缺少原文 evidence。 | — | 23208 |
| 22 | 会 | 3/3 | — | — | 36263 |
| 23 | 会 | 0/3 | evidence.missing_required_coordinate：抽取值 /pace#scalar 缺少原文 evidence。 | — | 30792 |
| 24 | 会 | 0/3 | evidence.missing_required_coordinate：抽取值 /destination/text#scalar 缺少原文 evidence。 | — | 19534 |
| 25 | 会 | 0/3 | evidence.quote_not_in_source：Evidence /experiencePreferences/parks_gardens#scalar 不是原文中的有效片段。 | — | 23457 |
| 26 | 会 | 0/3 | evidence.literal_mismatch：Evidence /destination/text#scalar 未包含对应原文值。 | — | 32300 |
| 27 | 不会（规则已够用） | 0/3 | semantic.evidence_not_proven：天数 evidence 与抽取值不一致。 | — | 24716 |
| 28 | 会 | 0/3 | semantic.rule_mismatch：必去或避开地点与原文不一致。 | — | 26573 |
| 30 | 会 | 0/3 | evidence.missing_required_coordinate：抽取值 /unhandledRequirements#0 缺少原文 evidence。 | — | 21096 |
