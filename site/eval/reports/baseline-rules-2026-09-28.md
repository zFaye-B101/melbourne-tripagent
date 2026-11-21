# 报表 A：现有版本 30 题规则路径基线（2026-09-28）

> 由 `npm run eval:baseline` 生成，请勿手改。解读与结论见 docs/44。

| 项 | 值 |
|---|---|
| runner | baseline-rules-runner-v0 |
| taskSet | mel-eval-30-draft-v0 |
| path | rules-only（未调用真实模型） |
| evalClock | 2026-09-28T10:00:00+10:00 |
| gitCommit | bb31f1a |
| workingTreeDirty | false |
| plannerVersion | trip-planner-v0.4.3-local |
| poiDataVersion | mel-poi-v0.1-2026-09-14 |
| node | v22.23.2 |

## 汇总

| 指标 | 值 |
|---|---|
| total | 30 |
| supported | 20 |
| partial | 7 |
| unsupported | 3 |
| fullCoverage | 20/30 |
| supportedHardPass | 20/20 |
| partialCoreHardPass | 7/7（43 号初判为部分支持；各题仍未交付的部分见逐题表） |
| unsupportedCoreHardPass | 3/3（仅核心行程部分；不代表该题通过） |

## 逐题

| ID | 类型 | 支持 | 硬检查 | 未通过的硬检查 | 未通过的诊断项 | 未交付部分 |
|---|---|---|---|---|---|---|
| 01 | 常规 | supported | ✅ | — | — | — |
| 02 | 常规 | supported | ✅ | — | — | — |
| 03 | 常规 | supported | ✅ | — | — | — |
| 04 | 常规 | partial | ✅ | — | — | 酒店星级/设施比较（资料来源门未过） |
| 05 | 常规 | supported | ✅ | — | — | — |
| 06 | 常规 | partial | ✅ | — | — | — |
| 07 | 常规 | supported | ✅ | — | — | — |
| 08 | 常规 | partial | ✅ | — | — | — |
| 09 | 常规 | supported | ✅ | — | — | — |
| 10 | 常规 | supported | ✅ | — | — | — |
| 11 | 常规 | supported | ✅ | — | — | — |
| 12 | 常规 | supported | ✅ | — | — | — |
| 13 | 常规 | supported | ✅ | — | — | — |
| 14 | 常规 | unsupported | ✅ | — | — | 日期活动候选与购票提醒（资料来源门未过） |
| 15 | 常规 | partial | ✅ | — | — | — |
| 16 | 多步骤 | partial | ✅ | — | — | 酒店属性比较（资料来源门未过） |
| 17 | 多步骤 | unsupported | ✅ | — | — | 出发国字段（仅作出发地提示，未用于个性化建议） |
| 18 | 多步骤 | partial | ✅ | — | — | 逐站营业时间避坑（目前只有维多利亚女王市场的开市日） |
| 19 | 多步骤 | supported | ✅ | — | — | — |
| 20 | 多步骤 | supported | ✅ | — | — | — |
| 21 | 多步骤 | supported | ✅ | — | — | — |
| 22 | 多步骤 | partial | ✅ | — | — | — |
| 23 | 多步骤 | supported | ✅ | — | — | — |
| 24 | 多步骤 | unsupported | ✅ | — | — | 住宿属性、当期活动、交通避坑、行李购物、含住宿/餐饮假设的逐项预算 |
| 25 | 异常 | supported | ✅ | — | — | — |
| 26 | 异常 | supported | ✅ | — | — | — |
| 27 | 异常 | supported | ✅ | — | — | — |
| 28 | 异常 | supported | ✅ | — | — | — |
| 29 | 异常 | supported | ✅ | — | — | — |
| 30 | 异常 | supported | ✅ | — | — | — |

人工复核（五维分、页面文案）尚未进行；上表只代表程序可判定的硬约束。
