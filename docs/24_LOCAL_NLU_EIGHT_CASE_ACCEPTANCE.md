# 本地真实 LLM：八类输入验收（2026-09-16）

## 范围

- 固定测试集为 `scripts/smoke-bff-batch.mjs` 中的 **8 条不同文本**，没有超过用户给出的 10 条上限。测试涵盖完整约束、口语改述、儿童与票型、缺天数、超过三天、其他城市、非澳元预算、相对日期与模糊时间。
- 通过本机回环 BFF 调用已配置的 DashScope `qwen3.8-flash`；最终批次使用 Prompt `nlu-extraction-system-v2.7`。临时以 CLI 打开 `LLM_LOCAL_DIAGNOSTICS` 与保守的 `LLM_OPTIONAL_ASSERTION_ELISION` 本机实验开关，没有修改私密配置或部署 BFF。
- 每个测试只有 `acceptedMode=llm` 且相应关键断言通过才算模型验收；HTTP 200、可用的规则兜底结果都不算。范围外输入的正确结果是 `scope_error`，不能静默改写为墨尔本一至三天行程。
- 迭代期间在修改提示与证据规则后复用了同一测试集并做了有限重测；下表是**较早的一次完整八条批次**，不能当作重复运行的稳定性统计。后续复验见下节。

| 场景 | 最终决定 | 最终采用 | 关键检查 |
| --- | --- | --- | --- |
| 完整约束 | `ready` | LLM | 3 天、11:00、CBD、A$500、必去与避开均正确 |
| 口语化改述 | `ready` | LLM | 2 天、10:00、Southbank、“别太赶”对应轻松节奏 |
| 儿童与同行人 | `ready` | LLM | 1 天、Carlton、2 位成人、6 岁儿童 |
| 缺少天数 | `clarification` | LLM | 不猜天数，只追问天数 |
| 超过三天 | `scope_error` | LLM | 不偷偷缩成三天，不生成行程 |
| 其他城市 | `scope_error` | LLM | 不把悉尼改成墨尔本，不生成行程 |
| 非澳元预算 | `scope_error` | LLM | 不换算人民币，不生成行程 |
| 相对日期与模糊出发时间 | `scope_error` | 本地规则 | 未生成行程；模型额外推断 `museum_exhibition`，其证据不足而被拒绝 |

这次 **7/8** 条通过真实模型采纳与关键条件检查；第 8 条安全回退本地规则。该失败的脱敏首因是 `semantic.evidence_not_proven /experiencePreferences/museum_exhibition`。此前同一超三天文本曾在一次单独试验中回退，故单次 7/8 不是稳定通过率，也不构成线上放行。

## 后续同集复验（2026-09-16）

本地通用修正后，先有一次**误关** `LLM_OPTIONAL_ASSERTION_ELISION` 的八条批次，结果 6/8 LLM 采纳；这与上表配置不同，不用于比较改进幅度。随后仅通过本机 CLI 恢复该开关，并打开脱敏诊断，再对**同样的 8 条文本**完整运行一次。没有增加第 9 条文本，没有修改私密配置，也没有部署。

在一致的本机实验配置下，最新批次为 **5/8 LLM 采纳且关键检查通过，3/8 安全回退规则**。`full-constraints`、`child-and-party`、`four-days-out-of-scope`、`sydney-out-of-scope`、`non-aud-budget` 通过；其余三条不计作真实模型采纳。回退避免了无证据推断，但当时 `natural-paraphrase` 的规则回退没有识别“别太赶”，因此其轻松节奏断言也失败，不能把三条说成全部满足用户需求：

| 场景 | 脱敏首因 | 保留的安全边界 |
| --- | --- | --- |
| `natural-paraphrase` | `semantic.rule_mismatch /originText` | 起点不能与本地识别的区域不一致 |
| `missing-days` | `semantic.evidence_not_proven /lowWalking` | “轻松”不能自动变成“少走路” |
| `relative-date-fuzzy-start` | `semantic.evidence_not_proven /mustIncludeNames`，`intent_marker_absent` | “想去”不能自动升级为“必去” |

本轮本机供应商请求约耗时 6–15 秒；生产 BFF 当前只给模型 4 秒，因此本地结果**不能**推断线上能成功采用模型。模型输出在不同批次间有波动，不应为了追求 8/8 而放宽原文证据门。可继续优化通用提示，但线上真实调用仍受 [发布门槛](25_ONLINE_LLM_RELEASE_GATE.md) 约束。

复盘后，本地规则新增了“别太赶／别排太满／悠闲／不赶时间”等通用慢节奏解析，并保留“紧凑”等相反指令优先的测试；离线测试已通过。这个改动只改善未来规则回退的可用性，**没有**把上面的真实模型批次改算为通过，也尚未做修改后的浏览器或供应商复验。

## 通用改动与边界

- Prompt v2.6–v2.7 明确未提及的 `false/0`、范围外城市与天数、非澳元预算、地点意图词和逐字段原文证据的处理；未为八条中的某一整句写特殊分支。
- 语义证据门新增一组有限的“别太赶／别排太满／悠闲”等慢节奏表达证明规则，保留反向、矛盾表达拒绝测试。模型仍负责提出候选含义，证据门只验证该候选是否由原文支持。
- Schema、原文 evidence、跨字段与范围校验继续失败即整次规则回退；没有自动补造 quote，没有把任何 LLM 生成的 POI、路线或票价当事实。
- `.oxlintrc.json` 与 `.gitignore` 排除 Wrangler 本机生成的 `bff/.wrangler/`，不影响产品代码。
- 线上 WorkBuddy 仍为 rules-only；本轮没有发布、没有向静态站注入 API Key。真实模型的本机验收不等于浏览器交互验收、生产认证／限流／成本验收或中国网络验收。

## 复测方式

先运行不发请求的 `node scripts/smoke-bff-batch.mjs` 查看 8 个场景 ID；只有显式 `--run` 才逐条发送。`--case=<ID>`、`--from=<ID>` 与 `--limit=<N>` 可限制实际调用范围。脚本遇认证、配额或限流错误立即停下，不自动重试；输出仅含场景 ID、解析模式、固定错误码和布尔断言，不打印原文、供应商回复或密钥。

下一阶段若要上线，应先解决公开 BFF 的调用方认证与配额、成本上限、供应商数据条款、生产响应时限和中国普通网络实测；模型采纳率也应在明确的安全边界内改善，而不是让规则回退冒充 LLM 成功。
