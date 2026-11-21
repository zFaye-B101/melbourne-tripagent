# Local NLU Diagnostics v1

Local NLU Diagnostics v1 是仅用于本机排障的脱敏校验事件，不属于 Parse HTTP API。它默认关闭，只有以下三个条件同时满足时才创建日志 sink：

- `LLM_LOCAL_DIAGNOSTICS=true`；
- `LLM_RUNTIME_ENV=local`；
- 请求 URL 的主机是 `localhost`、`127.0.0.1` 或 `[::1]`。

请求头、请求体和 Origin 都不能开启诊断。打开诊断不会改变 HTTP 状态、响应头、响应体或公开 Schema；生产 Worker 的开关保持 `false`。

## 输出契约

一次 Provider 成功返回后的校验链最多输出一行，前缀固定为 `TRIPAGENT_NLU_LOCAL_DIAG_V1`。JSON 只包含：

- `outcome`：`accepted` 或 `fallback`；
- 完整的 Evidence Binding v1 摘要；
- `firstFailure`：首个失败阶段、稳定原因枚举和安全路径。

`accepted` 必须对应 `firstFailure: null`，`fallback` 必须携带一个失败对象。绑定状态为 `applied` 时，只允许 `scope_coordinate_reused + /geography/strength + 1`；其他状态的 `addedPath` 和 `addedCount` 必须分别为 `null` 和 `0`。`not_run` 只允许 `schema_not_passed`，绑定内部异常固定为 `internal_error + binding_exception`。

失败顺序是 Schema、Evidence、Semantic、Normalization。Schema 路径只基于 AJV `instancePath` 映射；不会读取 `params`、`additionalProperty` 或错误消息。Evidence 和 Semantic 校验器直接返回强制的安全 issue；绑定、校验器和 normalization 自身抛异常时会整体回退规则解析，并输出对应的 `binding_exception`、`validator_exception` 或 `normalization.exception`，不会让请求崩溃。

实现会重新构造白名单对象，不会原样返回传入事件。未知枚举、未知路径、阶段与原因不匹配、结果与首个失败矛盾、绑定字段矛盾的事件都会整条丢弃。允许值的机器可读清单位于 `data/local-nlu-diagnostic-v1.schema.json`，并由测试保证与 TypeScript allowlist 完全一致。

## 隐私与运维边界

日志永不包含旅行原文、quote、Provider Draft、校验 message、模型或供应商信息、请求 ID、URL、凭据、错误对象或 stack。日志写入失败为 fail-open：解析结果不受影响，也不会追加第二行重试。

临时排障完成后应关闭本地开关。该机制不调用 Provider、不增加重试，也不能作为部署、模型质量或 LLM 已被产品接受的证据。
