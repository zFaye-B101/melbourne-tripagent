# 本地模型评测：qwen3.5:9b（2026-09-28）

> 由 `npm run eval:ollama` 生成。本地模型，不代表线上模型；未花线上额度。

| 项 | 值 |
|---|---|
| model | qwen3.5:9b |
| think | false |
| numCtx | 16384 |
| runsPerTask | 1 |
| promptVersion | nlu-extraction-system-v2.9 |
| plannerVersion | trip-planner-v0.4.3-local |
| poiDataVersion | mel-poi-v0.1-2026-09-14 |
| gitCommit | 28e29ff |
| workingTreeDirty | true |
| date | 2026-09-28 |
| note | 本地模型，不代表线上模型；未花线上额度。 |
| replayOf | null |

## 汇总

| 指标 | 值 |
|---|---|
| runs | 5 |
| tasks | 5 |
| llmAccepted | 0/5 |
| llmAcceptedWhereProductionWouldCallModel | 0/2 |
| acceptedButDiffersFromRules | 0 |
| planOkChangedVsRules | 0 |
| contextFullRuns | 0 |
| latencyMs | {"p50":18719,"p90":33860,"max":33860} |

## 未采纳原因（第一道未通过的校验）

| 原因 | 次数 |
|---|---|
| evidence.unexpected_coordinate @ /evidence | 1 |
| semantic.unhandled_requirement_missing @ /dailyStartText | 1 |
| semantic.evidence_not_proven @ /venuePreference | 1 |
| semantic.evidence_not_proven @ /days | 1 |
| semantic.evidence_not_proven @ /mustIncludeNames | 1 |

## 逐题

| ID | 线上是否会调模型 | 采纳次数 | 未采纳原因 | 与规则不同的字段 | 平均耗时 ms |
|---|---|---|---|---|---|
| 01 | 不会（规则已够用） | 0/1 | evidence.unexpected_coordinate：Evidence /experiencePreferences/museum_exhibition#scalar 没有对应的抽取值。 | — | 33860 |
| 05 | 不会（规则已够用） | 0/1 | semantic.unhandled_requirement_missing：模糊出发时间必须保留为 unresolved。 | — | 18719 |
| 22 | 会 | 0/1 | semantic.evidence_not_proven：室内外 evidence 与抽取值不一致。 | — | 23901 |
| 27 | 不会（规则已够用） | 0/1 | semantic.evidence_not_proven：天数 evidence 与抽取值不一致。 | — | 15022 |
| 28 | 会 | 0/1 | semantic.evidence_not_proven：/mustIncludeNames evidence 未把地点与明确意图绑定。 | — | 16546 |
