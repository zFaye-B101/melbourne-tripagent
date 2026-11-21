# 10. v0.5 NLU / LLM 需求解析接口契约

## 1. 冻结结论

真实 LLM 只负责把用户原文抽取为不可信 `TripRequestDraft v2`。Schema、原文证据、语义、版本与 POI 白名单全部通过后，确定性规范化层才能生成 `ParsedTripRequest v2`，再由用户确认并交给现有规划器。

```text
用户原文
  → LLM 抽取 TripRequestDraft v2
  → Schema 校验
  → 可选本机实验：仅在严格条件下把无证据的 /family=false 舍弃为 null
  → 再次 Schema 校验（仅实验开启时）
  → Evidence Binding v1（仅修复经双重证明的 geography strength 单漏项）
  → evidence / 语义校验
  → 确定性规范化为 ParsedTripRequest v2
  → 用户核对与确认
  → 现有 planTrip()
```

LLM 不生成行程、POI ID、路线、时间线、距离、价格事实、预算结论或约束状态。供应商与模型可以通过服务端 Adapter 更换，不进入浏览器契约。

当前仓库已经具备 Cloudflare Worker BFF、OpenAI Responses／DeepSeek Responses／智谱 Chat Completions／DashScope compatible-mode 四个 Provider、服务端 provider/model/key 环境变量读取，以及本地 loopback 专用开发开关；BFF 还包含 CORS、API 版本、请求大小、超时和整次规则降级门。DashScope 已在本机完成真实 API 可达性和模型响应验证，但返回 Draft 因 evidence 校验被整次拒绝；生产 `page.tsx` 仍为 `adapter: undefined`，BFF 尚未部署，线上继续是 rules-only（仅规则）路径。本文件和 [v0.5 职责分配契约](18_V0_5_LLM_ROLE_AND_PROVIDER_CONTRACT.md) 记录的是可上线边界与当前准备状态。

## 2. Schema 与版本

- v2 机器定义：[`../data/trip-request-draft-v2.schema.json`](../data/trip-request-draft-v2.schema.json)
- v2 有效示例：[`../data/examples/trip-request-v2.example.json`](../data/examples/trip-request-v2.example.json)
- v2 解析提示词：[`../prompts/nlu-extraction-system-v2.md`](../prompts/nlu-extraction-system-v2.md)
- v1 Schema、fixture 和测试继续冻结保留，只用于兼容与回归；不原地扩字段。

v2 覆盖：

- 目的地、1–3 天和日期原文；
- 起点原文、每日出发时间文字与明确分钟值；
- 活动范围与强度、节奏、五档室内外倾向；
- 八类体验偏好、少走路、亲子、避开拥挤；
- 成人／优惠票人数、儿童年龄与公共交通介质；
- AUD 总预算；
- 必去／避开地点原文；
- 未处理要求、未解决片段和逐字段 evidence。

草稿不能包含请求 ID、用户完整历史、模型名、供应商、内部 POI ID、最终错误、默认值或行程结果。

## 3. Evidence 与语义校验

JSON Schema 只是第一道检查。随后必须执行：

1. 每个从用户原文抽取的非 `null` 值，包括显式 `false`、`0` 与数组成员，都有原文 evidence；`schemaVersion`、`date.resolution = missing` 和空数组等结构性哨兵值不伪造证据。
2. `quote` 必须是规范化用户原文中的真实连续片段；`occurrence` 精确指向重复片段中的第几次出现，数组成员用 `itemIndex` 对齐。
3. 相对日期保持 `relative_unresolved`；不得由模型依据当前日期换算。
4. 字符串做长度限制、Unicode NFKC 规范化和去重，但不改写含义。
5. `dailyStartMinutes` 必须可由明确时间原文确定；“上午”等模糊表达不能变成具体分钟。
6. 外地城市和 4 天以上保持原意并成为硬范围错误，不得改写为 Melbourne 或 3 天。
7. 其他币种不能由模型换算为 AUD；优惠资格不能从学生、游客或年龄描述擅自推断。
8. 必去／避开只通过当前数据版本的名称与别名表确定性匹配；最终 POI ID 必须属于当前数据集白名单。
9. 未知、歧义或必去／避开冲突先澄清；LLM 草稿不能直接强制转换为 `ParsedTripRequest`。
10. 解析结果必须携带版本，BFF 与浏览器数据快照不一致时拒绝或整体规则降级。

Schema 通过后、evidence 校验前允许执行 provider-neutral 的
[Evidence Binding v1](20_EVIDENCE_BINDING_V1.md)。首版唯一白名单是把已存在、且能被确定性解析同时证明范围与强度的
`/geography/scope` evidence 坐标原样复制给缺失的 `/geography/strength`。它不搜索原文、不改抽取值、一次最多补一项，也不处理日期、偏好、预算、人数、地点或数组；补全后仍须重新通过完整 Schema、evidence 和语义门，否则整次规则降级。

另有一个[默认关闭的本机断言舍弃实验](22_OPTIONAL_ASSERTION_ELISION_PROPOSAL.md)，独立于 Evidence Binding v1：仅当 `/family` 严格为 `false`、完全没有该路径证据、保守的原文检查判定未表达亲子语义时，在深拷贝中将其改为 `null`。它发生在 Evidence 校验之前，不补造、复制或删除任何证据；之后仍重新通过 Schema、原 Binding 和完整校验。BFF 只有在本机回环、`LLM_RUNTIME_ENV=local`、私有 `LLM_OPTIONAL_ASSERTION_ELISION=true` 同时满足时才传入该实验选项；生产环境和公开 API 均不受影响。

## 4. 澄清、范围与默认值

确定性层按以下优先级决定下一步：

1. 外地城市或超过 3 天：`scope_error`。
2. 必去／避开冲突、未知或歧义地点：澄清或要求移除。
3. 天数缺失：询问 1、2 或 3 天。
4. 未处理硬约束或无法判断软硬的要求：先澄清。
5. 未写城市可默认 Melbourne；未写节奏可默认 balanced，但都必须在确认摘要披露。
6. 未写日期或日期仍为相对表达时可以继续，动态事实保持“出发前确认”。
7. 软偏好无法执行时可以继续，但不得展示为“已安排好”。

问题内容、顺序和可选项由确定性层产生；未来 LLM 只能润色已有问题，不能自行决定新的约束。

## 5. API 边界

WorkBuddy 继续只托管 `site/dist/client`，不保存密钥。真实接入必须使用独立 HTTPS BFF：

### `POST /v1/trip-requests/parse`

请求：

```json
{
  "text": "墨尔本玩三天，从 CBD 出发，每天 11 点，预算 A$500",
  "locale": "zh-CN",
  "datasetVersion": "mel-poi-v0.1-2026-09-14"
}
```

响应契约：

```ts
interface ParserDiagnostics {
  attemptedMode: "llm" | "rules";
  acceptedMode: "llm" | "rules" | "none";
  fallbackReasonCode:
    | "deadline_exceeded"
    | "rate_limited"
    | "provider_unavailable"
    | "auth_or_config"
    | "invalid_json"
    | "schema_rejected"
    | "evidence_rejected"
    | "semantic_rejected"
    | "version_mismatch"
    | "circuit_open"
    | null;
  draftSchemaVersion: "trip-request-draft-v2" | null;
  normalizedRequestVersion: "parsed-trip-request-v2";
  semanticPolicyVersion: "trip-semantic-v1";
  promptVersion: string | null;
}

interface FieldEvidenceV2 {
  path: string;
  quote: string;
  occurrence: number;
  itemIndex: number | null;
}

interface ClarificationOptionV1 {
  value: string;
  label: string;
}

interface ClarificationSpecV1 {
  id: string;
  field: string;
  prompt: string;
  options: ClarificationOptionV1[];
}

interface NoticeV1 {
  code: string;
  message: string;
}

interface ParseResponseV1 {
  apiVersion: "trip-parse-api-v1";
  requestId: string;
  decision: "ready" | "clarification" | "scope_error" | "service_error";
  parser: ParserDiagnostics;
  datasetVersion: string;
  request: Omit<ParsedTripRequest, "rawText"> | null;
  fieldEvidence: FieldEvidenceV2[];
  question: ClarificationSpecV1 | null;
  warnings: NoticeV1[];
}
```

`ready` 必须带非空 `request` 且 `question = null`；`clarification` 必须带一个确定性生成的问题；`scope_error` 与 `service_error` 的 `request = null`。`fieldEvidence` 是通过验证后的最小证据，不是供应商原始 Draft。

`decision` 只允许 `ready`、`clarification`、`scope_error`、`service_error`。浏览器不接收供应商原始响应或未清洗 Draft，也不提交供应商／模型名。

## 6. Attempted 与 Accepted

诊断必须区分：

- `attemptedMode`：本次先尝试了 LLM 还是规则解析。
- `acceptedMode`：最终通过全部验证并被采纳的是 LLM、规则，还是都没有。
- `fallbackReasonCode`：只用稳定枚举描述整体降级原因，不泄露供应商正文。

HTTP 200、合法 JSON 或旧式 `source = llm` 都不表示结果正确。LLM 被调用但语义校验失败、规则解析最终被采纳时，应记录 `llm → rules`，页面仍显示“基础理解模式”。当前本地实现固定记录 `rules → rules`；它没有生成 LLM Draft，因此 `draftSchemaVersion = null`。

## 7. 失败、超时与整次降级

```text
Provider 调用
  → 严格 JSON Schema
  → evidence 与语义校验
  → 只有 JSON／Schema 形状错误可在剩余预算内修复一次
  → 仍失败则整次切换规则解析器
```

- 建议 Provider 硬超时 4 秒，整条远程解析预算 6 秒。
- 超时、429、网络和 5xx 不在同请求重试，直接整体规则降级。
- 不把 LLM 的部分字段与规则字段拼接。
- `clarification`、`scope_error` 与硬约束冲突是正常业务结果，不能借降级绕过。
- 输入改变时取消请求；迟到响应因 fingerprint 不匹配而丢弃。
- LLM 与规则都未通过时使用 `acceptedMode = none` 和 `service_error`，并保留原输入、上一份成功行程和替换历史。
- 首期只配置一个 Provider；失败时不得把原文静默发送给第二家。

## 8. 服务端安全与隐私

- API Key 只存服务端 secret／环境变量，禁止进入静态包、请求响应、日志、Git 或聊天内容。
- CORS 只允许批准的 WorkBuddy 域名和本地开发地址。
- 旅行原文最多 2,000 字符；BFF 对请求体按流式读取执行 16 KB 硬上限，避免先完整缓冲大请求。
- `LLM_ENABLED = true` 仍不足以触发 Provider：必须同时存在服务端 `LLM_RATE_LIMITER` binding；缺失、拒绝或异常时整次回退规则路径，不调用模型。
- CORS 只限制浏览器跨域读取，不是认证。部署前仍需在目标 Cloudflare 账户配置分布式限流 binding、匿名配额／滥用策略和月度成本硬上限。
- 当前限流 key 对所有匿名调用者共用，也不构成认证；真实调用上线前必须增加调用方认证或抗滥用挑战与不可伪造的配额键，否则保持 `LLM_ENABLED = false`。
- 远程解析实验默认关闭，用户明确选择后才发送文本。
- 日志只记录 request ID、耗时、attempted／accepted、版本、错误码与熔断状态，不记录完整原文、供应商响应、系统提示词或密钥。
- 服务端错误不包含内部错误栈或供应商正文。
- 数据保留条款、成本与中国普通网络可达性在接入具体 Provider 前重新核实。

## 9. Provider Adapter

浏览器契约与供应商无关：

```text
Browser → Trip Parse BFF → Provider Adapter → configured LLM API
```

供应商、模型、Base URL、Key、超时和功能开关只存在于服务端。更换 API 只替换 Adapter／配置，不修改 Draft v2、验证规则、确认界面或 `planTrip()`。

当前已实现供应商无关的 Adapter 接口、运行时验证链和测试专用 mock；`site/bff` 已有 Cloudflare Worker BFF、OpenAI Responses、DeepSeek Responses、智谱 Chat Completions 和 DashScope compatible-mode Adapter。服务端通过 `LLM_PROVIDER` 只选择一家供应商；DeepSeek 与 DashScope 使用 provider JSON Schema，智谱使用 `json_object` 并把完整 Schema 放入提示词，输出都必须继续通过本地 AJV、evidence 与语义门。DashScope 仅允许本机 loopback；真实 API 的固定八案中部分 Draft 已通过 evidence，部分安全回退，见 [八案记录](24_LOCAL_NLU_EIGHT_CASE_ACCEPTANCE.md)。生产页面默认 `adapter: undefined`，只有明确点击且构建时配置合法 HTTPS BFF URL 才会走远程解析；当前未配置也未部署 BFF，不得把线上静态页面描述成“LLM 已接入”。本地配置与 smoke 步骤见 [19_LOCAL_LLM_PROVIDER_SETUP.md](19_LOCAL_LLM_PROVIDER_SETUP.md)。

## 10. 接入前验收矩阵

至少覆盖：

- Melbourne、CBD、11:00、AUD、3 天全部保留；
- 缺少天数、外地城市、4 天、模糊时间、非 AUD 预算；
- 未知／歧义地点、必去／避开冲突、POI 白名单；
- 显式 `false`、重复 quote、数组成员和伪造 evidence；
- 提示注入、额外字段、非法 JSON、Schema／语义失败；
- 超时、429、5xx、版本不匹配的整次规则降级；
- `attemptedMode` 与 `acceptedMode` 各组合；
- 失败不覆盖输入、旧行程和替换历史；
- 静态包、日志、响应与错误中没有 Key 或供应商正文。

上线前未完成：

- 真实 key 的安全配置与具体模型（model）选择；
- 在目标部署账户配置并验证 `LLM_RATE_LIMITER` 分布式限流 binding、匿名配额与滥用防护（代码已 fail-closed，但本地配置未声明账户专属 namespace）；
- 月度成本上限与超限处置；
- 供应商数据条款、保留和训练用途核实；
- 中国普通网络测试；
- 生产前端 opt-in 源码已准备，但仍缺实际 HTTPS BFF URL、在线启用、端到端验证与真实用户告知；本地一次性试用入口不能代替它。

完成这些事项并经用户另行批准前，不放入真实密钥、不部署 BFF，也不上线任何真实 LLM 调用；线上继续保持 `adapter: undefined` 的 rules-only 路径。
# Local diagnostic boundary

Local NLU diagnostics are not part of the Parse API. They do not alter HTTP status, headers, parser payload, request parsing, or response schema, and are not available to callers as an API feature.
> 历史上 Prompt v2.5 的单次真实 Provider 复验曾因 `/mustIncludeNames` 语义证据不成立而整次回退 rules。当前本地 Prompt 已是 v2.7，八类文本的真实验收结果见 [本地八案报告](24_LOCAL_NLU_EIGHT_CASE_ACCEPTANCE.md)；线上仍是 rules-only。Melbourne 的 destination 两个字段必须各自有 evidence；Evidence Binding 不处理 destination，仅允许 geography strength 从 geography scope 复制。
