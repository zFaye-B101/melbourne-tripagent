# 19. 本地 LLM Provider 配置

## 当前结论

- 这个 demo 的需求解析是无状态请求，不需要数据库。API Key 只放在本地私密配置或服务端 secret 中，不保存进数据库、前端代码或浏览器。
- 本地 BFF 支持 `zhipu`、`deepseek`、`openai`、`dashscope` 四种显式选择；一次请求只会发送给配置中的一家，不会失败后偷偷转发给第二家。
- 当前准备优先验证百炼 `qwen3.8-flash`：它支持严格 JSON Schema，并可在控制台仍显示有效免费额度时用于这个本地 demo。智谱 `glm-4.7-flash` 保留为备选；它只保证 JSON 对象，不保证严格 JSON Schema。无论使用哪一家，输出都必须通过项目已有的 Schema、原文 evidence 和语义校验，任一失败就整次回退本地规则解析。免费额度和服务规则会变化，不能当作固定 SLA 或正式商用授权。
- DeepSeek 当前 API 没有官方长期免费承诺。Adapter 支持其 Responses API，但应在账户有余额时再测试。
- 本地页面仅在 `http://localhost:3000` 显示一次性的 AI 理解按钮；普通整理、快捷键和页面工具仍走本地规则。点击该按钮才会把输入框文字发送给本机 BFF 及其配置的模型供应商；详细设置与地点选择不发送。固定八案已有真实 Provider 复验，但模型采纳有波动，见 [八案记录](24_LOCAL_NLU_EIGHT_CASE_ACCEPTANCE.md)。线上 WorkBuddy 页面仍只用规则，也未部署 BFF。

## 本地配置

私密配置文件是 `site/bff/.dev.vars`，已经加入忽略规则。当前默认配置为：

```text
LLM_ENABLED=true
LLM_PROVIDER=zhipu
LLM_RUNTIME_ENV=local
LLM_LOCAL_DEV_BYPASS_RATE_LIMITER=true
ZHIPU_MODEL=glm-4.7-flash
```

只需在本机把 API Key 填入 `ZHIPU_API_KEY=` 后面。不要把真实 Key 发到聊天、提交到 Git 或写进网页代码。

切换到 DeepSeek 时，只改本机配置：

```text
LLM_PROVIDER=deepseek
DEEPSEEK_MODEL=deepseek-flash
DEEPSEEK_API_KEY=<仅保存在本机>
```

切换到百炼 DashScope 时，只在本机回环地址使用以下配置（真实 API 已在固定八案中被采纳过，但并非每次都通过 evidence；尚未部署）：

```text
LLM_PROVIDER=dashscope
DASHSCOPE_MODEL=qwen3.8-flash
DASHSCOPE_WORKSPACE_ID=<业务空间 ID>
DASHSCOPE_API_KEY=<北京同地域 Key，仅保存在本机>
DASHSCOPE_FREE_TIER_ONLY_CONFIRMED=true
```

Adapter 使用业务空间专属 endpoint。请使用与该业务空间同在北京地域的通用 Key，并先在控制台确认 `qwen3.8-flash` 仍有免费额度且已开启“免费额度用完即停”，再把确认门设为 `true`。代码识别到已知额度错误后会在当前进程停止后续调用，但这个本地熔断不能代替控制台计费保护，也不能承诺账户一定不会产生费用。它不会自动切换供应商。DashScope 只允许 `LLM_RUNTIME_ENV=local` 下的 `localhost`、`127.0.0.1` 或 `[::1]`，即使非回环地址存在成功的服务端限流检查也不会调用。

## 验证步骤

在 `site/` 目录启动本地 BFF：

```bash
npm run bff:dev
```

保持它运行，再开一个终端执行：

```bash
npm run bff:smoke
```

本地网页上的试用按钮是另一条手动入口，不会自动执行上述 smoke。按钮只有在本机预览页可见；即使点击，BFF 未启动或模型未启用时也不能证明 LLM 已被采纳。真实模型请求应在确认供应商、发送内容与可能费用后另行执行。

只有输出同时出现以下结果，才算真实 API 已接通且模型结果通过本地校验：

```json
{
  "attemptedMode": "llm",
  "acceptedMode": "llm",
  "fallbackReasonCode": null
}
```

如果 `acceptedMode` 是 `rules`，页面仍可工作，但说明这次模型调用因为 Key、额度、限流、网络、非法 JSON、Schema、evidence 或语义校验失败而安全回退。具体原因查看 `fallbackReasonCode`，不需要把供应商原始错误或 Key 暴露给浏览器。

## 本地与上线边界

本地绕过只有在 `LLM_RUNTIME_ENV=local`、`LLM_LOCAL_DEV_BYPASS_RATE_LIMITER=true` 且请求主机是 `localhost`、`127.0.0.1` 或 `[::1]` 时同时生效。本机回环测试允许模型最多等待 60 秒，以容纳免费模型的排队延迟；生产与任何非回环地址仍固定为 4 秒。生产配置固定为 `LLM_RUNTIME_ENV=production`；不要把本地私密配置部署到隧道、反向代理或公开 Worker。非本机地址仍必须存在服务端 `LLM_RATE_LIMITER`，否则不会调用任何模型。浏览器请求也不能指定供应商、模型、超时或 Key。

生产页面目前仍为 rules-only。源码中已准备默认关闭的前端单次明确同意入口：只有构建时提供有效的 HTTPS `VITE_TRIP_PARSE_BFF_URL` 才在非本机页面显示。若以后决定上线真实 LLM，仍需完成调用方认证或抗滥用挑战、不可伪造的配额键、全局成本上限、隐私告知、中国网络实测和 BFF 地址接线。CORS 和全用户共用的匿名限流 key 都不能代替认证；完成前禁止在线上把 `LLM_ENABLED` 打开。完整条件见 [线上发布门槛](25_ONLINE_LLM_RELEASE_GATE.md)。

## 官方依据

- 智谱：[GLM-4.7-Flash](https://docs.bigmodel.cn/cn/guide/models/free/glm-4.7-flash) · [对话补全 API](https://docs.bigmodel.cn/api-reference/%E6%A8%A1%E5%9E%8B-api/%E5%AF%B9%E8%AF%9D%E8%A1%A5%E5%85%A8) · [速率限制](https://docs.bigmodel.cn/cn/api/rate-limit) · [用户协议](https://docs.bigmodel.cn/cn/terms/user-agreement)
- DeepSeek：[Responses API](https://api-docs.deepseek.com/api/create-response/) · [模型与价格](https://api-docs.deepseek.com/quick_start/pricing/) · [错误码](https://api-docs.deepseek.com/quick_start/error_codes/)
- 百炼：[OpenAI Chat 兼容接口](https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope) · [结构化输出](https://help.aliyun.com/zh/model-studio/qwen-structured-output) · [API Key](https://help.aliyun.com/zh/model-studio/get-api-key) · [新人免费额度与用完即停](https://help.aliyun.com/zh/model-studio/new-free-quota) · [错误码](https://help.aliyun.com/zh/model-studio/error-code)
# Temporary local diagnostics

For one local troubleshooting run only, set `LLM_LOCAL_DIAGNOSTICS=true` and `LLM_RUNTIME_ENV=local` in the local Worker environment, then call the loopback parse endpoint. Do not use `tee`, shell redirection, copied request bodies, or provider logs: the diagnostic line is already intentionally minimal. Remove the temporary flag after the run. The three gates (flag, local runtime, loopback URL) are all required; a request header cannot enable it.
> 以下是历史 Prompt v2.5 单次复验记录：它回退 rules，首个安全诊断在 `/mustIncludeNames`。当前本地 Prompt 为 v2.7，固定八案的最新结果见 [本地八案报告](24_LOCAL_NLU_EIGHT_CASE_ACCEPTANCE.md)。既有单案 smoke 脚本仅输出四个必需 evidence path 的布尔结果；回退时这些值为 `false` 不代表 Provider 原始 Draft 缺失该字段，也不会输出用户原文 quote。destination evidence 缺失不会由 Binding 自动补回。

此后的本地代码新增了默认关闭的 Diagnostics v2：同一条脱敏日志可对 `/mustIncludeNames` 首个语义失败给出固定原因类别，详见 [`23_LOCAL_NLU_DIAGNOSTICS_V2.md`](23_LOCAL_NLU_DIAGNOSTICS_V2.md)。此前 v2.5 的真实请求发生在该诊断实现之前，无法追溯分类；后续 v2.6–v2.7 已做本机真实 API 八案测试，记录见上方报告。
