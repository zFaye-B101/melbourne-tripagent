# 18. v0.5 LLM 职责分配与可替换 API 契约

## 1. 这次参考什么

参考原型值得借鉴的是产品链路：用户先用自然语言表达需求，系统把需求整理成结构化条件，再交给规划逻辑。公开页面只能证明它存在解析／规划接口，不能证明隐藏的模型、提示词、密钥或供应商配置；本项目不复制这些不可见部分，也不依赖某个模型名称。

本项目将 LLM 放在它最擅长、也最容易被校验的位置：**理解文字**。地点事实、预算事实、约束检查和排程继续由可测试的代码与版本化数据负责。

## 2. 固定主链

```text
用户自然语言
  → LLM 或本地规则解析
  → 不可信 TripRequestDraft v2
  → Schema 校验
  → 原文 evidence 校验
  → 语义、跨字段与范围校验
  → 确定性规范化为 ParsedTripRequest v2
  → 用户核对并确认
  → 确定性 planTrip()
  → 行程与约束结果
```

LLM 成功返回、HTTP 200 或合法 JSON 都不等于解析可用。只有全部校验通过后，结果才可以标记为 `acceptedMode = llm`；即使通过，也不能跳过用户确认。

## 3. 职责矩阵

| 能力       | LLM 可以做                                             | 确定性层必须做                           |
| ---------- | ------------------------------------------------------ | ---------------------------------------- |
| 自然语言   | 抽取城市、天数、时间、范围、偏好、人数、预算和地点原文 | 校验 Schema、证据和字段间不变量          |
| 缺失与歧义 | 标记 `null`、unresolved 或 unhandled                   | 决定是否阻断、追问顺序与合法选项         |
| 必去／避开 | 复制用户写出的地点名                                   | 名称／别名匹配、歧义处理、POI ID 白名单  |
| 默认值     | 不生成                                                 | 设置并在确认摘要中披露                   |
| POI 与路线 | 不选择、不生成事实                                     | 筛选、排序、分天、时间线、距离估算       |
| 票价与预算 | 只抽取用户预算文字和明确 AUD 金额                      | 使用版本化票价／交通快照计算三态结果     |
| 冲突       | 可保留原文                                             | 检查描述、详细设置、必去／避开和容量冲突 |
| 追问文案   | 后续可润色既定问题                                     | 决定问什么；基础模板必须独立可用         |
| 行程贴士   | 后续只能改写可信 Fact Bundle                           | 组装事实、核验引用，失败时回到模板       |

字段来源仍然是“描述中提到／详细设置／暂用默认／需要补充”。LLM 是解析方式，不是事实来源，因此不增加“来源：LLM”。

## 4. 解析输出

机器契约为 [`../data/trip-request-draft-v2.schema.json`](../data/trip-request-draft-v2.schema.json)，示例为 [`../data/examples/trip-request-v2.example.json`](../data/examples/trip-request-v2.example.json)。v2 覆盖当前界面的主要条件：

- Melbourne、1–3 天、日期原文；
- 每日起点与明确开始时间；
- CBD／中央城区／支持的内城区范围；
- 三档节奏、五档室内外倾向；
- 八类游客体验；
- 少走路、亲子、避开拥挤；
- 成人／优惠票人数、儿童年龄、公共交通介质；
- AUD 总预算；
- 必去／避开地点原文；
- 未处理要求、未解决片段和逐字段证据。

草稿禁止包含供应商、模型、POI ID、路线、价格事实或最终计划。v1 Schema 和 fixture 继续保留，只用于兼容与回归，不原地扩字段。

## 5. 解析诊断

前端与日志必须区分“尝试了什么”和“最终采纳什么”：

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
```

页面徽标只看 `acceptedMode`：LLM 被调用但规则结果最终获采纳时，仍显示“基础理解模式”，不能显示“AI 已理解”。当前生产 `page.tsx` 仍为 `adapter: undefined`，线上固定为 `rules → rules`；规则解析没有产生 LLM Draft，因此 `draftSchemaVersion = null`。

## 6. 可替换 Provider Adapter

真实接入采用独立 HTTPS BFF（Backend for Frontend）和统一 Adapter；静态 WorkBuddy 前端不保存 API Key，也不直接调用模型供应商。仓库中的 `site/bff` 已提供 Cloudflare Worker BFF、OpenAI／DeepSeek／智谱／DashScope 四个 Provider、严格 structured output 转换、服务端 key/model 环境变量读取、`LLM_ENABLED` 默认关闭，以及 CORS、API 版本、16 KB 流式请求上限、超时和整次规则降级边界。DashScope 仅允许本机 loopback；本地 Prompt v2.7 的固定八案真实 API 复验已有 7 条被模型采纳、1 条安全回退，详见[验收记录](24_LOCAL_NLU_EIGHT_CASE_ACCEPTANCE.md)，但不能视为稳定性或上线验收。本地页面已有一次性试用入口，线上前端尚未接入，BFF 也未部署。真实 Provider 还被服务端 `LLM_RATE_LIMITER` binding 二次门控：缺少 binding、配额拒绝或 limiter 异常时均不调用模型；BFF 尚未部署，线上也未放入真实 key。

```text
Browser → Trip Parse BFF → Provider Adapter → configured LLM API
```

供应商、模型、Base URL、Key、超时和开关仅存在于服务端配置中。浏览器只提交旅行文本和 locale，不提交模型名。更换 API 时只替换 Adapter／服务端配置，`TripRequestDraft v2`、验证器、确认界面和规划器保持不变。

首期一次请求只使用一个已获批准的供应商。失败时整体回退本地规则，不把同一段用户原文静默转发给第二家，也不混合 LLM 与规则的部分字段。

## 7. 超时、隐私与降级

- 建议单次 Provider 硬超时 4 秒，整条远程解析预算 6 秒。
- 只有 JSON／Schema 形状错误可在预算内修复一次；超时、429、网络和 5xx 直接整体规则回退。
- evidence 或语义失败不拼接修复；迟到响应必须因输入 fingerprint 不一致而丢弃。唯一新增的本机实验发生在 Evidence 校验**之前**：在默认关闭的私有开关下，仅把无证据、原文也未表达的可选 `/family=false` 舍弃为 `null`，不生成或复制证据；随后仍重跑 Schema 与全部原校验。详见[受限实验契约](22_OPTIONAL_ASSERTION_ELISION_PROPOSAL.md)。它不适用于生产环境，也不改变 Evidence Binding v1。
- 用户输入、上一份成功行程和替换历史在失败时保留。
- 实验阶段远程解析默认关闭，用户明确开启后才发送文本。
- 日志只记录 request ID、耗时、版本、attempted／accepted 和错误码，不记录完整原文、供应商正文、提示词或密钥。
- 供应商的数据保留条款、成本与中国普通网络可达性必须在真实接入前重新核实。

## 8. 可选的第二层 LLM

解析稳定后，可以单独增加“行程说明／贴士”层，但输入只能是服务端构造的 `FactBundle`：已确认偏好、已核验 POI 事实、有效票价／交通事实和确定性规划结果。每条输出必须携带 `factRefs`；出现新地点、新数字、新 URL 或无引用结论时整批拒绝并回到基础模板。贴士失败不能影响行程。

## 9. 本轮状态与后续顺序

当前已完成：

1. `TripRequestDraft v2` Schema、fixture 与契约测试；
2. 解析-only Prompt v2；
3. `attemptedMode / acceptedMode` 本地诊断结构；
4. v1 兼容保留；
5. 浏览器运行时 Schema、evidence、语义和跨字段验证；
6. 确定性 normalizer、POI 名称白名单解析和整次规则降级；
7. 测试专用 mock Adapter，以及超时、取消、版本不匹配和迟到响应回归；
8. 页面已改走可取消的异步 orchestrator，普通入口仍为 `adapter: undefined`。本地 `http://localhost:3000` 页面另有一次性、显式点击的 BFF 试用按钮；未点击时仍是 `rules → rules`，线上链接不显示该按钮。
9. 默认关闭的本机 `/family=false` 无证据舍弃实验及合成测试；历史单案 smoke 曾回退规则，后续本机八案复验为 7 条采纳、1 条回退，生产环境仍不可据此启用。

当前明确未完成：生产环境 key 与模型选择、BFF 部署、生产前端 opt-in 与 BFF URL 接线、稳定性与浏览器端真实调用验收。G1 代码已于 2026-09-16 完成本地验收并覆盖发布到既有 WorkBuddy 链接；本机 API 已执行八类真实模型测试，但线上仍固定使用本地规则路径，至今没有线上真实 LLM 调用。本地一次性试用入口尚未进行真实 Provider 点击测试，不能据此声称线上 LLM 已可用。

上线前还必须完成：

- 在目标 Cloudflare 账户配置并验证 `LLM_RATE_LIMITER` binding、匿名配额和滥用防护；代码已 fail-closed，但仓库不能预填账户专属 namespace；
- 月度成本上限；
- 供应商数据条款、保留和训练用途核实；
- 中国普通网络测试。

后续顺序：

1. 完成真实 key 安全配置、模型选择，以及生产前端 opt-in／BFF URL 接线；
2. 部署 BFF，先接一个供应商且功能开关默认关闭；
3. 完成分布式限流、滥用防护、月度成本上限、供应商数据条款和中国普通网络测试；
4. 通过质量、隐私、成本和网络验收后，再决定是否开启真实调用；
5. 最后再考虑 Fact Bundle 驱动的说明层。

Melbourne 版本未稳定前，不扩展 Australia 多城市，也不让 LLM 参与确定性规划。
