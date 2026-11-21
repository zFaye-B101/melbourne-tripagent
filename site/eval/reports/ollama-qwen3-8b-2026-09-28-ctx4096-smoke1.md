# 本地模型评测：qwen3:8b（2026-09-28）

> 由 `npm run eval:ollama` 生成。本地模型，不代表线上模型；未花线上额度。

| 项 | 值 |
|---|---|
| model | qwen3:8b |
| think | false |
| runsPerTask | 1 |
| promptVersion | nlu-extraction-system-v2.9 |
| plannerVersion | trip-planner-v0.4.3-local |
| poiDataVersion | mel-poi-v0.1-2026-09-14 |
| gitCommit | 7b76162 |
| workingTreeDirty | true |
| date | 2026-09-28 |
| note | 本地模型，不代表线上模型；未花线上额度。 |

## 汇总

| 指标 | 值 |
|---|---|
| runs | 5 |
| tasks | 5 |
| llmAccepted | 0/5 |
| llmAcceptedWhereProductionWouldCallModel | 0/2 |
| acceptedButDiffersFromRules | 0 |
| planOkChangedVsRules | 0 |
| latencyMs | {"p50":32920,"p90":40964,"max":40964} |

## 未采纳原因（第一道未通过的校验）

| 原因 | 次数 |
|---|---|
| evidence.unexpected_coordinate @ /evidence | 3 |
| evidence.missing_required_coordinate @ /pace | 1 |
| evidence.quote_not_in_source @ /evidence | 1 |

## 逐题

| ID | 线上是否会调模型 | 采纳次数 | 未采纳原因 | 与规则不同的字段 | 平均耗时 ms |
|---|---|---|---|---|---|
| 01 | 不会（规则已够用） | 0/1 | evidence.unexpected_coordinate@/evidence | — | 39857 |
| 05 | 不会（规则已够用） | 0/1 | evidence.unexpected_coordinate@/evidence | — | 32920 |
| 22 | 会 | 0/1 | evidence.unexpected_coordinate@/evidence | — | 40964 |
| 27 | 不会（规则已够用） | 0/1 | evidence.missing_required_coordinate@/pace | — | 32406 |
| 28 | 会 | 0/1 | evidence.quote_not_in_source@/evidence | — | 30047 |
