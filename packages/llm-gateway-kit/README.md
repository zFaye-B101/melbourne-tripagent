# llm-gateway-kit

一个零依赖（dependency-free）、仅服务端（server-only）的 ESM 小型 LLM gateway。它把 OpenAI Responses API、阿里云百炼兼容接口的调用和可注册的结构化任务（structured task）封装为稳定、可测试的边界。其他模型或供应商需要由服务端自行编写 adapter。server-only 是架构和部署要求，不是本包提供的浏览器安全强制机制；公开使用前应在 CI 检查 client bundle，确认没有打包服务端入口或密钥。设计上 `apiKey`、模型、prompt、schema 和 URL 都只能由服务端配置，不能接受浏览器传入这些配置；静态 WorkBuddy 前端绝不能放 API key。本包提供可组合的本地 HTTP 处理器和预算账本构件，但不提供已部署的 BFF（backend-for-frontend）、现成认证或部署能力。

## API

`createOpenAIResponsesProvider({ apiKey, model, fetchImpl?, maxOutputTokens? })` 返回 `generate({ systemPrompt, userText, schemaName, jsonSchema, signal })`。请求固定发往 OpenAI Responses endpoint，使用 `store:false` 和 strict JSON Schema。结果为 `{ok:true, outputText}` 或稳定错误码。

`createDashscopeCompatibleProvider({ apiKey, workspaceId, model, fetchImpl?, maxOutputTokens?, outputTokenLimitField?, onFreeTierQuotaExhausted? })` 提供服务端 DashScope compatible-mode Chat Completions 调用，固定使用北京 Workspace endpoint、strict JSON Schema、关闭 thinking/search、非流式请求，并返回相同的 `{ok:true, outputText}` / 稳定错误码契约。`maxOutputTokens` 默认 4096，最高 8192；为兼容已有调用，默认以 `max_tokens` 发送。仅在已确认目标模型支持时，可设置 `outputTokenLimitField:'max_completion_tokens'` 限定包含思考内容的完整输出；TripAgent 的 `qwen3.8-flash` 采用此设置。响应体限制为 64 KiB。检测到免费额度耗尽时只调用可选的同步回调，不在 provider 内部维护 circuit。两种 provider 都不会返回 provider response body 或密钥。

`createStructuredTaskRunner({ tasks, provider, enabled? })` 注册含 `id`、`version`、`systemPrompt`、`schemaName`、`jsonSchema`、`validateOutput` 的任务，可选 `normalizeOutput`。默认禁用（`enabled:false`）；禁用时不会调用 provider。运行时会 JSON parse、normalize 并强制通过 validate。`jsonSchema` 是发给模型的输出约束；本包不自带 JSON Schema 校验器，`validateOutput` 必须在服务端独立检查模型返回值，不能直接写成恒为 `true`。

`llm-gateway-kit/http` 的 `createStructuredTaskBff` 是一个默认关闭的、固定单任务的 HTTP 边界：只接受带精确允许 Origin 的 `POST application/json`，请求体只能是 `{text, consent:true}`，并要求调用方提供调用者策略、限流、预算预留和结算四个 hook。调用者策略必须返回服务端决定的 `subjectKey`：它可以是真实认证主体，也可以是小范围匿名演示共享主体；后者**不等于认证**，会让他人有机会耗尽共享额度。它不接受浏览器传入 provider/model/prompt/schema，所有响应均 `no-store`，并限制请求、文本和响应大小。`deadlineMs` 用单调时钟限制调用者策略、body、限流、预算预留、runner 和正常结算路径；超过期限不再开始模型调用或返回成功。预算预留之前超时只拒绝本次请求；预留或模型费用状态不明、结算失败时会锁闭当前 handler。超时后的 `unknown` 结算会另尝试最多 1 秒的清理等待；同步阻塞的外部 hook 不能被 JavaScript 计时器抢占，所以 `deadlineMs` 不是严格的 HTTP 响应时间上限。四个 hook 的分布式原子性、调用者策略和 provider 成本上限由部署方负责验证；预算后端必须持久保留 `unknown` reservation，不能自动退款；默认模板不是生产就绪的公开代理。

`llm-gateway-kit/budget-ledger` 的 `createSerializedBudgetLedger({ transactionSync, budgetId, limitUnits })` 是保守预算账本：服务端先用唯一 `requestId` 预留单次调用的最大计费单位；重复 ID 永远不能再次取得调用许可；成功或费用不明时均保留全额预留。`limitUnits` 和 `maxCostUnits` 必须由服务端按同一种正整数单位配置，账本不计算真实价格。`transactionSync` 必须在所有请求实例之间真正串行且持久；普通内存 Map 只用于测试，不能用于公开服务。

`llm-gateway-kit/cloudflare-budget` 的 `createCloudflareSqliteBudgetLedger({ storage, budgetId, limitUnits })` 将账本接到 SQLite-backed Durable Object 的 `storage.transactionSync`/`storage.kv`。同一预算期的所有调用必须路由到同一个 Durable Object 实例。这个适配器目前只通过模拟存储测试；项目尚未创建 Durable Object、接通 HTTP 钩子或验证真实跨实例并发。它也不提供身份验证、限流、供应商账户层面的停用开关或可证明的费用上界。

安全边界和生产发布前检查见 [`SECURITY.md`](./SECURITY.md)。

## 示例

```js
import { createOpenAIResponsesProvider, createStructuredTaskRunner } from 'llm-gateway-kit';
const provider = createOpenAIResponsesProvider({ apiKey: process.env.OPENAI_API_KEY, model: process.env.LLM_MODEL });
const runner = createStructuredTaskRunner({ enabled: true, provider, tasks: [{
  id: 'support-classify', version: '1', systemPrompt: 'Classify customer support.', schemaName: 'support',
  jsonSchema: { type: 'object', properties: { category: { type: 'string' } }, required: ['category'], additionalProperties: false },
  validateOutput: (v) => v !== null && typeof v === 'object' && !Array.isArray(v) &&
    Object.keys(v).length === 1 && typeof v.category === 'string'
}] });
const result = await runner.run({ taskId: 'support-classify', text: 'My invoice is wrong.' });
```

不会记录 provider response body 或密钥。运行 `npm test` 执行内置 Node tests；测试使用 mock fetch，不访问真实 API。它不是可直接面向公开网站的代理服务：调用者还需提供用户同意、服务端决定的配额主体、限流、费用上限、日志与隐私说明；较大范围公开使用还需身份或抗滥用措施。小范围匿名演示必须接受共享额度可被他人耗尽的风险。
