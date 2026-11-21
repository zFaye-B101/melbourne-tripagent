# 腾讯云云函数适配：本地完成，尚未部署

日期：2026-09-17。此文件是小范围演示的实施说明，**不是线上 LLM 已可用的证明**。WorkBuddy 继续托管旅行网页；腾讯云 SCF 事件函数（Event Function）的函数 URL 承担独立解析接口；CloudBase 文档数据库记录匿名演示的共享调用额度；百炼 Key 只保存在服务端。用户网页不展示网关组件、管理页或邀请码。

## 已实现的边界

- `site/bff/tencent-scf/index.ts` 接受腾讯云函数 URL 的 `body / headers / httpMethod / path` 事件格式，将现有 `/v1/trip-requests/parse` 协议转回标准 HTTP 响应。只有精确路径、POST 和 OPTIONS 可通过；来源限于环境变量中的 HTTPS 白名单。来源白名单是浏览器限制，**不是身份验证**，非浏览器仍能直接请求公开 URL。
- `site/bff/index.ts` 的 Cloudflare Worker 公开模型调用门槛仍保持关闭；SCF 入口是单独、显式的运行时适配，不借用本机回环地址或绕过原门槛。
- `site/bff/tencent-scf/budget-cloudbase.ts` 使用一个预建的 CloudBase 文档，在服务端事务中一起检查并更新总额度与每分钟总调用数。每次准入先永久分配上界单位，即使模型失败也不退回；额度只是“模型调用次数／上界单位”的近似预算，不是人民币精确计费。文档不存在、额度不一致、事务失败或 SDK 不可用时都不调用模型。
- 现有结构化需求校验、来源证据校验及规则回退不变。模型只负责需求理解，不生成景点事实或行程。
- `npm run bff:scf:build` 产生 `site/dist/tencent-scf/index.js` 和 `package.json`；**不要**把这个目录作为 WorkBuddy 前端上传目录。WorkBuddy 仍只发布 `site/dist/client/`。

腾讯云官方[函数 URL 协议](https://cloud.tencent.cn/document/product/583/96099)支持事件函数并公开了上述 event/response 结构；[CloudBase 服务端事务](https://docs.cloudbase.net/database/transaction)支持原子读写及冲突处理。这里选择事件函数，避免 Web 函数的端口、启动脚本和额外响应流量差异；实际账号的功能和费用仍需在控制台确认。[SCF Node.js 运行时](https://cloud.tencent.com/document/product/583/11060)列有 Node.js 20.19。

## 本地已通过／尚未通过

- 已通过：TypeScript 类型检查、SCF 事件封装与 CORS 模拟、错误配置拒绝、并发共享额度模拟、打包后的规则模式本地烟测。
- 尚未通过：部署依赖包的完整安装（本机网络检查未完成，安装尝试已停止）、真实腾讯账号中的 SDK／数据库事务调用、函数 URL 的浏览器预检和中国普通网络访问、真实百炼成功且 `parser.acceptedMode=llm`、腾讯云成本控制、同链接的 WorkBuddy 更新。因此当前状态是 **`implemented + locally_tested`，不是 `deployed`**。
- `@cloudbase/node-sdk` 被固定为 `3.18.3`，仅在服务端包安装；腾讯云[初始化文档](https://docs.cloudbase.net/api-reference/server/node-sdk/initialization)现已标注该 SDK 停止维护、建议迁往 JS SDK v3。这个适配器保留在演示范围内，部署前须在真实环境验证事务响应格式；若不兼容，不可直接启用模型。

## 未来在腾讯云账号里的顺序

以下动作会创建或使用可能计费的云资源；本轮**没有执行**。先核实账户可用资源、套餐／超限按量设置和花费上限，再决定是否做。

1. 在同一个账号下确认可用的中国内地地域。当前保守候选是 **上海 `ap-shanghai`**：SCF 支持上海；CloudBase 当前基础环境文档列上海为标准对外地域，而北京地域的 CloudBase 可用性文档存在版本差异，不能默认两者都能在北京开通。[SCF 地域和计费](https://cloud.tencent.com/document/product/583/17299)、[CloudBase 基础环境](https://docs.cloudbase.net/cli-v1/envs/basement)。百炼当前适配器访问北京兼容接口；需要单独验证上海函数到该接口的网络通路和数据处理告知。
2. 在 CloudBase 创建文档数据库环境与集合 `tripagent_budgets`，手动写入 ID 为 `LLM_BUDGET_PERIOD` 的唯一文档，例如 `demo-2026-09`，内容为 `{"limitUnits":20,"allocatedUnits":0,"windowMinute":"","windowCount":0}`。`limitUnits` 必须与 SCF 环境变量严格一致。切换预算期需先创建新文档，不能仅修改环境变量。数据库不要开放客户端写入权限。
3. 在 `site/` 执行 `npm run bff:scf:build`，然后只在 `site/dist/tencent-scf/` 安装其 `package.json` 声明的生产依赖，再把该目录内容打包上传到 **SCF 事件函数**。运行时选择 Node.js 20.19；入口 `index.main_handler`；函数超时应大于本适配器的 20 秒模型截止时间并留出数据库／冷启动余量。先以 `LLM_ENABLED=false` 部署规则模式。包里不应有 `.dev.vars`、百炼 Key 或 CloudBase Key。
4. 给该函数创建**函数 URL**，开启公网；公开静态网页无法安全签名 CAM 请求，若要让访客直接使用，只能选择开放调用并承担匿名访问风险。CORS 使用精确来源 `https://melbourne-tripagent.app.workbuddy.host`、方法 POST/OPTIONS、请求头 `content-type`，不使用 `*`，不发送凭证。[函数 URL 创建说明](https://cloud.tencent.com/document/product/583/100227)。先以无密钥规则模式检查函数 URL；此处不是 API 网关的默认子域名。
5. 在 SCF 环境变量中配置下表，不写进网页、仓库或截图。仅当 CloudBase 账本真实事务、额度拒绝和失败回退通过，再令 `LLM_ENABLED=true`。SDK 的 `accessKey` 是服务端 CloudBase API Key，不是网页可公开的 Publishable Key；[CloudBase 鉴权说明](https://docs.cloudbase.net/api-reference/server/node-sdk/initialization)需按账号权限核实。

| 环境变量 | 示例／要求 |
| --- | --- |
| `LLM_ENABLED` | 初次部署 `false`；通过云端验收后才改 `true` |
| `LLM_RUNTIME_ENV` | `production` |
| `ALLOWED_ORIGINS` | `https://melbourne-tripagent.app.workbuddy.host` |
| `LLM_PROVIDER` | 当前建议 `dashscope`，其它 Provider 仍按原适配器配置 |
| `LLM_BUDGET_PERIOD` | 与预建文档 ID 相同，如 `demo-2026-09` |
| `LLM_BUDGET_LIMIT_UNITS` | 与文档 `limitUnits` 相同，如 `20` |
| `LLM_MAX_COST_UNITS` | 单次预留单位，如 `1` |
| `LLM_MAX_CALLS_PER_MINUTE` | 全站每分钟上界，如 `2` |
| `CLOUDBASE_ENV_ID` / `CLOUDBASE_APIKEY` | 仅服务端配置；不复制到前端 |
| `DASHSCOPE_API_KEY` / `DASHSCOPE_WORKSPACE_ID` / `DASHSCOPE_MODEL` | 百炼账号实际值；现有 DashScope 适配器只接受 `qwen3.8-flash` |
| `DASHSCOPE_FREE_TIER_ONLY_CONFIRMED` | 只有在账号免费额度条件已实测确认时才设 `true` |

6. 云端验证：先发错来源、错数据版本和大请求，确认不能触发模型；然后验证两次并发请求不会越过账本上限、额度耗尽后的回退、一次固定真实请求的 `parser.acceptedMode=llm`。仅返回 HTTP 200 不够。若账本响应与本地模拟不同，保持 `LLM_ENABLED=false`，修复后再试。
7. 以上都通过后，才在**前端构建时**设置 `VITE_TRIP_PARSE_BFF_URL=https://<function-url>/v1/trip-requests/parse`，构建并验证 `site/dist/client/`，之后由 WorkBuddy 覆盖原应用以保持原网址。不得把 Key 放入该构建变量。发布前后均需中国普通网络测试。

## 风险与停止条件

匿名函数 URL 可被非浏览器访问；CORS 无法替代鉴权。这个总额度仅防止**百炼模型请求次数**无限增长，不能为 SCF 调用、CloudBase 读写、日志、出网流量或百炼实际人民币费用提供统一硬上限。需要在腾讯云和百炼各自设置可用的预算／告警／超额停用，并核实是否真的“用完即停”。腾讯云[SCF 计费](https://cloud.tencent.com/document/product/583/17299)与[CloudBase 价格](https://cloud.tencent.com/document/product/876/75213)可能随账号套餐而不同，不应称为免费托管。若任一真实并发、费用或中国网络测试未通过，保持线上规则版并关闭 `LLM_ENABLED`。
