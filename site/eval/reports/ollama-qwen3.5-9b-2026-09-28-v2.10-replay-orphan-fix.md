# 本地模型评测：qwen3.5:9b（2026-09-29）

> 由 `npm run eval:ollama` 生成。本地模型，不代表线上模型；未花线上额度。

| 项 | 值 |
|---|---|
| model | qwen3.5:9b |
| think | false |
| numCtx | 16384 |
| runsPerTask | 1 |
| promptVersion | nlu-extraction-system-v2.10 |
| plannerVersion | trip-planner-v0.4.3-local |
| poiDataVersion | mel-poi-v0.1-2026-09-14 |
| gitCommit | 9dca9a1 |
| workingTreeDirty | true |
| date | 2026-09-29 |
| note | 本地模型，不代表线上模型；未花线上额度。 |
| replayOf | eval/reports/ollama-qwen3.5-9b-2026-09-28-v2.10-drafts.jsonl |

## 汇总

| 指标 | 值 |
|---|---|
| runs | 5 |
| tasks | 5 |
| llmAccepted | 2/5 |
| llmAcceptedWhereProductionWouldCallModel | 1/2 |
| acceptedButDiffersFromRules | 0 |
| planOkChangedVsRules | 0 |
| contextFullRuns | 0 |
| latencyMs | {"p50":0,"p90":0,"max":0} |

## 未采纳原因（第一道未通过的校验）

| 原因 | 次数 |
|---|---|
| evidence.missing_required_coordinate @ /pace | 1 |
| semantic.evidence_not_proven @ /days | 1 |
| semantic.rule_mismatch @ /mustIncludeNames | 1 |

## 逐题

| ID | 线上是否会调模型 | 采纳次数 | 未采纳原因 | 与规则不同的字段 | 平均耗时 ms |
|---|---|---|---|---|---|
| 01 | 不会（规则已够用） | 0/1 | evidence.missing_required_coordinate：抽取值 /pace#scalar 缺少原文 evidence。 | — | 0 |
| 05 | 不会（规则已够用） | 1/1 | — | — | 0 |
| 22 | 会 | 1/1 | — | — | 0 |
| 27 | 不会（规则已够用） | 0/1 | semantic.evidence_not_proven：天数 evidence 与抽取值不一致。 | — | 0 |
| 28 | 会 | 0/1 | semantic.rule_mismatch：必去或避开地点与原文不一致。 | — | 0 |
