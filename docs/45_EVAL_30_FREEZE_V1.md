# 45 · 30 题评测集 v1 冻结与规则基线（2026-11-20）

状态：**题集已冻结、规则基线已重跑**。冻结与第一次基线只改评测资产，没有改产品代码，没有调用真实或本地模型，也没有发布网站。后续的配置热更新见 [46 号](46_CONFIG_HOT_RELOAD.md)，不影响本文件的冻结题集与 v1 判定口径。

## 一、冻结了什么

- 题集：[`site/eval/tasks.v1.json`](../site/eval/tasks.v1.json)，版本 `mel-eval-30-v1`，30 条，`frozenAt` 为 2026-11-20。
- 范围：30 条用户输入、`support` 和 `featureTag` 与 v0 逐字一致；本次只把版本从 `mel-eval-30-draft-v0` 定稿为 `mel-eval-30-v1`，没有增删或改写题目。
- 判定：逐题的硬检查仍写在 [`site/eval/baseline.eval.ts`](../site/eval/baseline.eval.ts) 里，runner 版本为 `baseline-rules-runner-v1`。这是“轻冻结”：题集和判定代码一起版本化，不把 30 套断言拆成另一份数据文件。
- 支持状态：`supported` 20 条、`partial` 7 条、`unsupported` 3 条，沿用 43 号文档的现状推断。`partial` 和 `unsupported` 不计为“功能已交付”，只看各自已承诺的核心行程部分。

评测时钟仍固定在 `2026-09-28T10:00:00+10:00`，与 v0 基线同口径，便于同题前后比较；报告里的 `runDate` 是实际运行日，两者不是同一个日期。

## 二、改了什么

| 文件 | 改动 |
|---|---|
| `site/eval/tasks.v1.json` | 新增；v0 的 30 条输入原样定稿，补齐 `frozenAt`、`status` 和说明。 |
| `site/eval/baseline.eval.ts` | 改读 v1；runner 升到 v1；报告按实际运行日落盘；meta 增加 `runDate`；报告导语改指 45 号。 |
| `site/eval/reports/baseline-rules-2026-11-20.{json,md}` | 本次运行生成。 |
| `docs/45_EVAL_30_FREEZE_V1.md` | 本文件。 |
| `README.md` | 评测入口补上 v1 与 45 号链接。 |

没有改 `site/app/**`、`site/bff/**`、POI/票价快照或提示词。v0 的题集和 2026-09-28 报告保留，用于对照。

## 三、怎么跑

```bash
cd site
npm run eval:baseline
```

本轮结果：Vitest 1 个文件、30 项全部执行完毕；失败被记录为数据，不会让 `npm test` 变红。报告：

- [`baseline-rules-2026-11-20.md`](../site/eval/reports/baseline-rules-2026-11-20.md)
- [`baseline-rules-2026-11-20.json`](../site/eval/reports/baseline-rules-2026-11-20.json)

## 四、结果

| 指标 | 值 |
|---|---|
| 总题数 | 30 |
| supported 支持状态 | 20 |
| partial 支持状态 | 7 |
| unsupported 支持状态 | 3 |
| 全题覆盖率 | 20/30 |
| 已支持题硬检查通过 | **20/20** |
| partial 题核心硬检查通过 | **7/7** |
| unsupported 题核心硬检查通过 | **3/3**（不代表该题通过） |
| 硬检查失败 | 0 |
| 软诊断失败 | 0 |

逐题明细见报告。与 v0 基线（2026-09-28）相比，三项汇总没有变化；冻结本身没有引入回归。

`partial` 题仍未交付的部分保持原样：酒店星级/设施比较、日期活动候选、逐站营业时间、出发国个性化建议等，受资料来源门或未实现功能限制，不能把核心行程通过当成整题完成。

## 五、怎么读这份结果

- 这是**规则路径**基线，不调用云端或本地模型；第 29 题用注入的“永不返回”适配器模拟超时，50 ms 截止，不花额度。
- 多步骤题通过调用与页面相同的库函数模拟（`buildPlanProposal`／`canCommitPlanning`／`replaceStopWithPoi`／LIFO 结果栈），**不是**浏览器端到端测试；页面文案、按钮状态和无障碍披露仍需人工看。
- 五维质量分（信息完整性、逻辑一致性、来源充分性、事实可靠性、可执行性）还没有人工评分。本报告只能证明程序可判定的硬约束，不能当产品总评。
- 报告里的 `workingTreeDirty=true` 是预期的：冻结文件当时未提交，随后配置热更新（46 号）也改了产品代码。配置改造完成后同一天重跑了同一题集，汇总仍是 20/20、7/7、3/3，当前报告是重跑后的版本。
- 版本号、题集文件和 runner 一起构成可复核的基线。

## 六、对后面两件事的意义

配置热更新和 SSE 流式输出都会改运行路径。动它们之前，先保留这份 v1 基线；改完重跑 `npm run eval:baseline`，同题对比 supported 20/20、partial 7/7、unsupported 核心 3/3 是否退化。任何新失败都要先判断是产品问题还是评测器问题，不能直接把分数变化算成功能收益。
