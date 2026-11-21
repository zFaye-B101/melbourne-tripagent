# Local NLU Diagnostics v2：必去地点证据分类

这是仅供本机排障的脱敏日志契约，不是新的解析 API，也不是向模型追加请求。v1 契约及其 Schema 保留原样；v2 在同一条校验日志中增加 `mustIncludeCause`，不会额外输出第二行。

## 启用和输出范围

仍须同时满足 `LLM_LOCAL_DIAGNOSTICS=true`、`LLM_RUNTIME_ENV=local`，并且请求主机为 `localhost`、`127.0.0.1` 或 `[::1]`。默认关闭。请求头、请求体和 Origin 无法启用该功能。只有 Provider 成功返回后进入本地校验链，才可能有这一条日志；一个请求最多尝试输出一行，前缀为 `TRIPAGENT_NLU_LOCAL_DIAG_V2`。

事件沿用 `outcome`、Evidence Binding 摘要和 `firstFailure`，版本号为 `2`。新增 `mustIncludeCause`，仅当首个失败严格为 `semantic.evidence_not_proven`、路径严格为 `/mustIncludeNames` 时可为 `{ "code": "..." }`；其他所有结果必须为 `null`。允许的 code 只有：

- `opposite_only`：证据中没有“必去”标记，却出现“避开”标记。
- `intent_marker_absent`：两种意图标记都没有。
- `opposite_nearer_or_tied`：两种标记都出现，但“避开”标记与地点的距离更近或相同。
- `unclassified`：不能安全归入前三类，包括地点字面不在证据中、空内容或分类过程异常。

分类沿用现有语义门对地点名首次出现位置、文本规范化、意图关键词和距离的计算规则；它只解释首个失败，不改变通过／回退判定。更早的 Schema、Evidence、Evidence Binding 失败，以及其他字段的语义失败，都不会生成地点分类。尤其不能从分类反推模型实际抽取的地点名、别名或原句。

日志只允许固定枚举和安全路径，禁止原始旅行描述、quote、Provider Draft、地点名、POI ID、数组索引、计数、文本长度、指纹、凭据或错误对象。输出前重新按白名单构造事件；分类或日志失败不影响原有规则回退，也不重试。机器可读格式见 `data/local-nlu-diagnostic-v2.schema.json`。

诊断本身不能证明真实模型已被采纳，仍必须检查公开响应的 `acceptedMode`。历史 Prompt v2.5 的单次请求为 `acceptedMode=rules`；后续 v2.7 的 [本机八案复验](24_LOCAL_NLU_EIGHT_CASE_ACCEPTANCE.md) 有 7 条被模型采纳、1 条安全回退。线上 WorkBuddy 仍保持 rules-only。
