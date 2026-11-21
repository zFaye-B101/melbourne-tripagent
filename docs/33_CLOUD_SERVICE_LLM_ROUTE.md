# 云服务 LLM 路线决策记录（WorkBuddy Cloud Service）

日期：2026-09-17。状态：**已开通云服务 + 已两次同链接发布 + 已在真实浏览器里完成端到端验收**。云服务绑定到原应用，`site/dist/client/` 两次都用同一 `appId` 覆盖发布，网址不变。真实浏览器中已实测 `parser.acceptedMode=llm`（7.5 s）。本轮同时**推翻并修正了上一版关于模型选择的结论**，并定位出一条**尚未修复的提示词↔语义策略裂缝**（见"遗留问题"）。

本文件替代 `30_CHINA_HOSTING_DECISION.md` / `31_TENCENT_SCF_ADAPTER.md` 作为**主路线**的依据；那两份文件降级为**回退方案**，仍然有效，但不得与本路线同时上线。

## 结论

保留现有静态前端与 `https://melbourne-tripagent.app.workbuddy.host/`，**不接腾讯云**：复用同一个应用 `wbapp_cFS2bnfmLJu6A0MoVMgysh` 开通 WorkBuddy 云服务，用其 **LLM API 模块**做需求抽取，其余全部沿用现有浏览器内流水线。

模型仍然只负责"需求理解"，景点、路线、时间、费用与约束继续由确定性数据与规则负责；规则模式仍是默认，LLM 只在显式点击时尝试，任何失败一律回退规则。

## 已核实事实（本机可复现）

- 本会话只读 `inspect`（`workbuddy_cloud_service`，`action: "inspect"`）返回：会话内应用 1 个，`Melbourne TripAgent = wbapp_cFS2bnfmLJu6A0MoVMgysh`，`activated: false` → **云服务当前未开通**。工具明确提示"本地清单不能证明云服务已绑定"。
- 应用登记与上一轮发布一致：`.wbapp_cFS2bnfmLJu6A0MoVMgysh.genie`（`appType: web`、`entryHtml: index.html`、`localDir: site/dist/client`），镜像于 `.workbuddy/applications.yaml`。
- 产品能力（WorkBuddy 云服务，即 `cloud-service` 技能 + 内置 `workbuddy_cloud_service` 工具）：
  - 无密钥模型调用，前端只持有 `publicConfig` 的 `endpoint` + `publishableKey`；`publishableKey` 只标识应用、本身不带权限，服务端按 **Origin 精确匹配**校验。环境 id 与厂商 Key 不下发。
  - 数据面路径 `/.cloud/llm/chat/completions`；**只支持流式**（非流式会被拒 `request_stream_required`）；每次调用 `messages[0]` 必须是应用自己的 `system`。
  - 与 Sites 发布**共用同一个 `applicationId`**：复用该 id 重新发布即保留原域名与 Origin。新建应用会换域名并破坏 Origin。
  - 文档明确**禁止**自建 BFF / Node 代理去调模型通道，也禁止把长生命周期密钥放进前端。
  - SDK **不暴露**用量、余额、额度周期与计费；额度错误码为 `quota_*`。SDK 包名 `@tencent-ai/workbuddy-cloud-sdk`，`site/` 有构建步骤 → 采用 npm 形式（`@dev` 通道）；CDN 形式依赖 jsdelivr，境内可达性不可靠，仅作安装失败时的最后手段。
- 代码接缝（现有，无需新建服务端）：`site/app/lib/nlu-orchestrator.ts` 已经在浏览器内完成 draft v2 schema 校验 → 证据绑定 → 语义校验 → 规范化，并通过 `NluDraftAdapter` 抽象取数；提示词与 schema 在 `site/bff/provider-shared.ts`（`PROMPT_VERSION = nlu-extraction-system-v2.7`）。现有 HTTP 运输层是 `site/app/lib/bff-parse-client.ts`，入口开关在 `site/app/lib/ai-parse-opt-in.ts`。
- 结构后果（已接受）：SDK 路线下模型调用必须由浏览器发起，因此解析流水线在前端运行，提示词对访客可见。这是该路线的固有代价，不是实现缺陷。

## 用户确认（控制台侧，本机不可复核）

标记为**用户提供**，不计入本机证据：

- 匿名访客（无登录、无痕窗口）**暂时可以**直接调用模型通道 → 满足"验收者无邀请码、无登录"的验收前提。
- 账号应用额度**默认充足** → 预期可以完成云服务绑定。

这两项仍需在最末一次真实调用中以实测复验（见验收）。

## 仍待核实

（下列四项在 2026-09-17 的实测中已各自有了结果，见"实测记录"。留此仅作原始清单。）

- ~~`models.list()` 实际返回的模型目录~~ → **已核实**：30 个条目，`auto` 为 isDefault；但**不能只依赖目录元数据**，见模型实测表。
- ~~额度、用量与超限行为~~ → **部分核实**：响应里的 `usage.credit` 可见，余额与超限行为**仍未知**（无查询接口，只能靠控制台）。
- ~~`endpoint` 与发布域名的可达性~~ → **已核实**：发布域名下 `/.cloud/**` 正常转发；"中国大陆普通网络"未在本次环境验证。
- ~~重新发布后网址是否严格不变~~ → **已核实**：`shareLink` 不变；但**边缘缓存不等于立即生效**，见发布特性。

## 最小实施顺序与停点

1. **只读核验（零成本，已完成）**：读 `32_WORKBUDDY_TENCENT_HANDOFF.md`、`inspect` 应用、定位前端接缝。无任何资源创建。
2. **停点 ①｜开通云服务**：在 `workbuddy_cloud_service` 上以 `applicationMode: "reuse"` + `applicationId: wbapp_cFS2bnfmLJu6A0MoVMgysh` 触发；确认动作由 WorkBuddy UI 对话框完成，**不代答、不绕过**。可能占用账号应用额度。此步**不发布**，线上完全不变。开通后取得 `publicConfig`。
3. **本地改造（零成本）**：`site/` 安装 SDK（npm，`@dev`）；新增"云端 draft 适配器"，与现有 `NluDraftAdapter` 同形，负责组装 `schemaPrompt()`、调用 SDK 并收集 SSE 为 JSON；默认关闭，保留规则回退；`publicConfig` 两个值按集成期常量注入，不使用环境变量或 BFF。跑 typecheck、lint、既有测试、构建与静态包校验。
4. **停点 ②｜首次真实模型调用**：在本地 dev 上确认目录非空、流式收集正确、`draftSchemaVersion` / `promptVersion` 正常、证据校验通过。**这一次调用开始消耗额度。**
5. **停点 ③｜同链接重新发布**：需要当轮明确说"发布"，并以 `appId` 复用（**不得** `createNewApp`）；上传目录仍是 `site/dist/client/`。
6. **云端验收标准**：不是 HTTP 200，而是诊断中 `parser.acceptedMode=llm` + draft schema 通过 + 证据绑定通过；并验证超时、额度、断网三种失败都回退规则，且页面与上一份成功行程不受影响；同时复验"无登录、无痕、境内网络"下的匿名调用。
7. **回滚**：保留上一版 `site/dist/client/`；任一项不通过就用同一 `appId` 重发规则版，网址不变。

## 实施记录（2026-09-17）

### 已执行

- **停点 ① 已完成**：以 `applicationMode: "reuse"` + `applicationId: wbapp_cFS2bnfmLJu6A0MoVMgysh` 开通云服务，UI 确认对话框由用户点击。返回 `billingStatus: normal`、`provisionStatus: assigned`、`reusedExisting: true` —— 未新建应用、未更换域名。`publicConfig.endpoint` = `https://melbourne-tripagent.app.workbuddy.host`，**与发布域名同源**；页面与数据面因此不存在跨域问题，但也意味着通道只在发布域名下可用。
- **新增** `site/app/lib/cloud-llm-draft-adapter.ts`：`NluDraftAdapter` 的云端实现。不 import SDK，只依赖一个本地声明的最小结构接口，因此可注入假客户端做单测。调用前用 `models.list()` 取首个非 `disabled` 模型，**不在代码里写死 model id**；目录为空或全被禁用时返回回退码，不伪造模型。模型只在显式点击时调用，`stream: true`、`messages[0]` 为应用自有 system 提示词，流式分片自行累积为 JSON，再交给既有流水线做 schema／证据／语义校验与规范化。默认不发送 `temperature` 与输出长度上限（模型目录未核实，先减少变量）。
- **新增** `site/app/lib/cloud-llm-config.ts`：`publicConfig` 的两个值（`endpoint`、`publishableKey`）作为集成期常量；开关 `CLOUD_LLM_PARSE_ENABLED`；惰性单例客户端（SDK 客户端须初始化一次并复用）；`CLOUD_LLM_DEADLINE_MS = 20_000`，超时由既有编排器转为规则回退。
- **修改** `site/app/page.tsx`：AI 面板的可见条件扩展为"已配置 BFF 地址 或 已配置云服务"；解释分支新增"仅显式 AI 点击且无 BFF 地址"时使用云端适配器，规则模式仍是默认；披露文案改为"已配置的云端理解服务"。
- **修改** `site/package.json`：新增依赖 `@tencent-ai/workbuddy-cloud-sdk`（`dev` 通道，未固定版本；npm 形式安装成功，未使用 CDN 形式）。
- **本地验证**：`tsc --noEmit` 通过；`oxlint` 0 warning / 0 error；21 个测试文件全部通过（含新增 9 项适配器测试：分片累积、system 首条消息、禁用项跳过、空目录回退、非 JSON 输出、`itemIndex: null` 归一化、错误码映射、超时与目录失败均不抛异常）；POI 测试 5 项、网关测试 40 项通过；构建与 `release:validate` 通过（70 文件、14.91 MiB），发布包内**含 `publishableKey`、不含任何厂商密钥**（校验脚本断言）。

### 未执行及原因

- ~~**未发起任何真实模型调用**~~ → **已修正**：当时以为数据面只在发布域名下可用，所以把停点 ② 排在停点 ③ 之后。实测表明这个判断对**浏览器**成立，但对**本机脚本不成立**——服务端并不强制 `Origin`，因此可以直接从本机对发布域名发起真实调用并完成端到端验收，不必等浏览器。这让"先发布再验证"变成了"可以先验证再发布"，是本次最有价值的流程修正。
- ~~**未重新发布**~~ → **已发布**，见下。
- ~~**未做浏览器加载冒烟**~~ → **已完成，且无需下载任何浏览器**。上一轮判断"本机没有可用浏览器"是错的：`playwright-cli` 确实不可用，但**系统已安装 Google Chrome**，用 `--headless=new --remote-debugging-port` + CDP 即可驱动，不需要 500 MB 的 Chromium 下载。本次用它完成了真实页面的点击级验收（见"真实浏览器端到端验收"）。关键经验：Chrome 在工具沙箱内启动时需要 `--no-sandbox`，否则报 `sandbox initialization failed: Operation not permitted` 后直接退出；此外用一个独立 `--user-data-dir` 并只按该路径杀进程，避免影响用户自己正在运行的 Chrome。

### 待反馈的文档不一致

- 内置云服务技能要求 `endpoint` 必须显式传入、不得依赖同源回落；而已安装 SDK（`0.1.1-dev.111acaf`）的类型声明写明：**省略 `endpoint` 走同源才是推荐用法**，显式传绝对地址反而有"重新发布后旧地址失效"的风险。本实现按技能要求显式传值（当前 `endpoint` 与发布域名一致，风险可控），但两处说明应当统一。
- `references/llm/code-generation.md` 的能力清单里列了"keyless 鉴权如何工作（凭据来源、终端用户是否必须登录）"，但该文件正文没有对应章节。**本次已用实测回答**：匿名（无 `Authorization`）可直接调用，不需要终端用户登录。

## 实测记录（2026-09-17，发布后真实调用）

### 停点 ③：同链接重新发布（已完成）

`workbuddy_sites_deploy`，`appId: wbapp_cFS2bnfmLJu6A0MoVMgysh` + `updateExistingApp: true`，上传目录仍是 `site/dist/client/`。返回 `shareLink` 与原来完全一致（`https://melbourne-tripagent.app.workbuddy.host/`）、`verified: true`。**未新建应用、未更换域名。**

**但发现一个必须记住的发布特性：边缘缓存没有随发布失效。**

- 裸链接 `GET /` 持续返回 `eo-cache-status: HIT`，`last-modified` 仍是**上一次发布**的时间（2026-09-16 01:20:40Z），引用的还是旧 chunk `page-BnIgFPZX.js` —— 该 chunk 内 `wbpk_` 与 `chat/completions` 计数均为 **0**，即云服务之前的老版本。
- 只有**带任意查询串**（`/?v=...`）才会绕过缓存键、拿到本次构建（`page-D-1-lBV2.js`，内含 SDK）。
- 强制 `Cache-Control: no-cache` 与 `If-Modified-Since` 都**不能**让边缘回源。
- 距发布约 25 分钟后 `age` 已到 1470s 仍是 HIT。

后果：**发布成功 ≠ 访客看到新版本**。验收与自测都必须带查询串，或等缓存自然过期；这也解释了为什么"发布后肉眼检查像没更新"。

### 已确认的平台行为（发布前无法验证、现已实测）

- **反向代理会转发 `/.cloud/**`**：`/.cloud/llm/models` 与 `/.cloud/llm/chat/completions` 经发布域名均正常。这是发布前唯一悬空的平台行为，现已确认。
- **模型目录非空**：30 个条目；`auto` 为 `isDefault`；除 `hunyuan-chat` 与图像模型外，其余都带 `onlyReasoning: true`。
- **匿名调用成立**：不带 `Authorization` 调用成功；与 SDK 内置的 `anonymousTokenProvider`（恒返回 `undefined`）一致。
- **只支持流式**：非流式请求返回 400 `request_invalid_parameter`。
- **`Origin` 校验不是鉴权**：带正确 `Origin` 返回 200；**完全不带 `Origin` 也返回 200**。浏览器跨域 POST 无法省略 `Origin`，所以浏览器侧仍受同源约束；但任何脚本只要从发布包里读出 `publishableKey` 就能调用并消耗额度。这与 `31_TENCENT_SCF_ADAPTER.md` 里"函数 URL 匿名可访问、CORS 不是鉴权"是同一类风险，必须按"publishableKey 是公开标识、额度可被滥用"来对待。
- **用量只在响应里**：每个流的最后一个分片带 `usage`，其中含 `credit`（实测 0.02 / 0.29 / 3.82 不等），但**仍无余额/额度查询接口**，做不出硬账本。

### 模型实测（生产提示词，约 9.2k 字符 system prompt）

**第一轮（未发送 `reasoning_effort`）的结论是错误的，现更正。** 当时测到 `auto` 81 s、`default` 4–7 s 或 88 s+、`hunyuan-chat` 22–60 s 且 schema 不过，于是判断"模型路由不稳定、只能靠显式首选模型规避"。

真实原因不是模型，而是**缺了 `reasoning_effort`**：不发送该参数时，所有推理条目都跑在各自声明的 `high` 默认档上，长时间只吐 `reasoning_content`，在一次点击的预算内根本不产出 `content`。

第二轮横评（同一生产提示词，全部发送 `reasoning_effort: 'minimal'`）：

| 条目 | 次数 | 墙钟 | 首正文 | credit | schema |
| --- | --- | --- | --- | --- | --- |
| `glm-5.3-flash` | 3 + 2 | 6.2–7.6 s | 4.1–4.7 s | **0.03–0.04** | 通过 |
| `glm-5.3-flash`（`low`） | 2 | 6.3–7.5 s | 4.2–4.9 s | 0.03 | 通过 |
| `glm-5.3` | 1 | 10.3 s | 6.9 s | 0.75 | 通过 |
| `default`（别名） | 1 | 7.7 s | 3.6 s | 0.71 | 通过 |
| `auto`（目录 isDefault） | 1 | 12.2 s | 8.5 s | 0.78 | 通过 |
| `deepseek-v4.1-flash` | 1 | 19.4 s | 18.1 s | 0.27 | 通过 |
| `deepseek-v4-flash` | 1 | 16.0 s | 14.8 s | 0.42 | 通过 |
| `hy3` | 1 | 55.7 s | 49.1 s | 0.00 | 通过 |
| `hunyuan-chat`（不发 effort） | 1 | 26.4 s | 3.9 s | 0.02 | **不通过（6 处）** |

- **加上 `reasoning_effort` 后，这一整类推理条目都变得快速且 schema 合法**，连 `auto`/`default` 都能用。原来的"路由不稳定"判断作废。
- `auto` 与 `default` 仍被避开，但理由变成**价格与确定性**：`default` 是 `x2.20` 的贵价别名且会路由到同一后端，`glm-5.3-flash` 只要 `x0.06`，实测同一答案 **0.03 vs 0.71 credits（约 24 倍）**。
- `hunyuan-chat` 依然被排除，理由不变且是契约问题：它把 `evidence` 嵌在各 section 内（`/destination/evidence`、`/date/evidence`…），不是唯一的顶层 `evidence` 列表，`validateDraftSchema` 6 处报错。**快而错仍是错。**
- 目录元数据的 `supportsReasoning` / `onlyReasoning` 无法预测可用性（`default` 无任何标记却最贵最慢），但 `reasoning.canDisableThinking` 是有效信号——这正是新分层规则的第一档。
- `glm-5.3-flash` 声明的 `supportedEfforts` 是 `['low','high','max']`，`minimal` 并不在其列，但网关在全部被测条目上都正常接受并生效（`reasoning_content` 仅 400–500 字）。`low` 作为声明内的替代值已实测等效（6.3 / 7.5 s，0.03 credits）。

### 实测暴露并已修复的三个缺陷

1. **流缺少 `[DONE]` 会丢弃已经完整的草稿**。`default` 5 次运行中有 2 次在**收完整个 JSON 数据帧后**直接断流、不发 `[DONE]`；SDK 因此抛出终止性错误 `gateway_stream_interrupted`，而旧实现把它当作整体失败，**扔掉了一份完整且 schema 可通过的草稿**。修复：终止性传输错误不再单独否决结果——保留已收内容，交给 `JSON.parse` 判定完整性（能解析即为完整；截断的 JSON 仍回退，并沿用传输错误码）。这一条修复前，"看起来像模型不稳定"的现象里有一半其实是客户端把好结果丢了。
2. **模型选择**。旧规则取目录里第一个非禁用项 → `auto` → 必然超时。新规则：先走 `preferredModelIds`（显式、可覆盖、缺失或不可选时静默跳过），再按能力分层（`reasoning.canDisableThinking` → 声明了 reasoning 配置 → 普通 chat → 声明输出上限 → 任意可选项），层内用 `isDefault` 破平。三层都为空时返回回退码，**绝不伪造模型 id**。
3. **缺 `reasoning_effort`（根因级）**。适配器此前完全不发送该参数，于是所有推理条目跑在 `high` 档、只吐 `reasoning_content`。这是"发布了却完全不可用"的真正原因：线上每次点击都会等满截止时间再回退。修复：新增 `reasoningEffort` 选项并在配置里固定为 `minimal`；同时**不再**把 reasoning-only 当作排除条件（那批模型现在是首选）。

### 最终配置

- `CLOUD_LLM_PREFERRED_MODELS = ['glm-5.3-flash']` —— 实测最快（6.2–7.6 s）且最便宜（0.03 credits）的可用条目。
- `CLOUD_LLM_REASONING_EFFORT = 'minimal'` —— 决定功能可用与否的单一参数。
- `CLOUD_LLM_DEADLINE_MS = 20_000`（原 30_000）—— 正常路径 6–8 s，最慢的仍能出草稿的回退项是 12.2 s，故约 2.6 倍余量；比 30 s 更能缩短异常时的等待。
- 未加"识别到 reasoning-only 就提前放弃"的启发式：它会与"先 reasoning 后 content"的正常流式冲突，收益不值得引入误判风险，记为后续可选优化。

### 真实浏览器端到端验收（2026-09-17，第二次发布后）

用本机已安装的 Google Chrome 以无头模式（CDP，未下载任何新浏览器）加载**线上页面**，注入 fetch 探针后模拟真实点击：

- **用例：页面自带示例** `墨尔本 3 天，主要在市内，喜欢室外，从 CBD 出发，每天 11 点出门`
  - 请求体 `model: "glm-5.3-flash"`；实际路由 `glm-5.3-flash`
  - 流：148 734 字节 / 429 个 data 帧 / `[DONE]` 完整；`content` 1542 字、`reasoning_content` **0 字**
  - 无中止、无失败资源、无控制台错误
  - **点击后 7.5 s 页面徽标切换为「AI 辅助理解 · 待你确认」**，无兜底提示
  - 结论：`parser.acceptedMode=llm` **已在真实浏览器中达成**，浏览器 UI 层（按钮渲染、点击接线、披露文案、徽标）全部实测通过。
- **用例：含同行人数** `下周去墨尔本玩两天，两个人，想看点建筑和咖啡。`
  - 模型侧正常（`content` 1701 字、`[DONE]` 完整、无错误），**但页面 10.5 s 后回退为「基础理解模式」并显示兜底提示**
  - 原因见"遗留问题"，与模型无关

### 回归验证（第二次发布）

`tsc --noEmit` 通过；`oxlint` 0 warning / 0 error；vitest **357 项 / 21 个文件全部通过**（适配器用例扩到 23 项，新增"转发 `reasoning_effort`"、"优先选择可限制思考的条目"、"优先声明了 reasoning 配置的条目"）；POI 5 项、网关 40 项通过；`workbuddy:build` 与 `release:validate` 通过（70 文件、14.91 MiB）。产物内确认：`glm-5.3-flash`、`reasoning_effort`、`minimal`、`2e4`（20000）。

## 遗留问题：提示词与语义策略之间存在一条未修复的裂缝

这是当前唯一已知的、会导致回退的功能缺口，**与模型选择无关，换任何模型都不会好**。

- **现象**：只要用户写出同行人数（如"两个人""2 人"），LLM 路径必然回退规则。
- **触发点**：`site/app/lib/trip-request-draft-v2-runtime.ts` 的 `validateFieldEvidenceSemantics` 调用
  `countQuoteMatches(quote('/party/adultFullFareCount'), adultCount, /成人/)`，
  而 `countQuoteMatches` 第一条就是 `if (!subject.test(quote)) return false;` ——
  **证据引文必须字面包含「成人」**。
- **矛盾所在**：`site/bff/provider-shared.ts` 的提示词第 21 条要求所有 `evidence.quote` **逐字复制原文连续片段**，第 16 条又要求 `adultFullFareCount` 记录用户明确写出的数量。用户几乎不会写"成人"（写的是"两个人""两大一小""2 人"），于是**任何逐字引文都不可能包含「成人」**——模型无论多强都只能二选一：填数字然后被拒，或填 null 违背提示词。
- **对照实验**（用真实草稿 + 真实校验器，不改任何代码）：引文取 `"两个人"`、`"两个人，想看点建筑和咖啡。"`、`"下周去墨尔本玩两天，两个人，想看点建筑和咖啡。"`、`"玩两天，两个人"`、`"2 人"` —— **全部失败**；只有把 `adultFullFareCount` 置为 `null` 才通过。
- **影响面**：页面自带的三个示例都不写人数，所以官方示例路径不受影响；但"两个人"是中文里极常见的表述，真实用户输入中占比不低。
- **三种修法（未执行，需决策）**：
  1. **放宽策略**：把 `/成人/` 换成能同时覆盖「人／成人／大人／两位」等表述的模式。改动被冻结的确定性校验器，需要同步核对现有断言 `evidence_not_proven` 的测试。
  2. **改提示词**：明确要求仅在原文含「成人」时才填 `adultFullFareCount`。但这等于让模型丢弃用户明确说出的信息，且要升 `PROMPT_VERSION`。
  3. **接受回退**：不修，按"这类输入走规则模式"处理（页面已有诚实提示）。
- **本文件的立场**：**未擅自修改语义策略或提示词版本**——两者都是被 357 项测试约束的契约，属于独立工作流，应由 Codex 或用户决定。

## 风险与停止条件

- **发布不等于生效**：边缘缓存可能持续发旧版 HTML（见上），验收必须带查询串或确认缓存已过期。第二次发布后裸链接 `age` 已到 2455 s 仍是 HIT，且仍指向最早的构建——这不是一次性现象，必须长期按"发布后带查询串或等缓存过期"处理。
- **已知功能缺口**：见"遗留问题"（同行人数引文必须字面含「成人」）。这类输入会稳定回退规则，页面有诚实提示，不是静默失败；但换任何模型都不会好。
- **静默降级的天花板**：即使配置正确，任何一层校验（schema／证据绑定／语义）不通过都会退回规则模式，而页面对"模型答得不对"与"模型没答"只显示同一句提示。定位必须依赖 `parser.acceptedMode` 与 `fallbackReasonCode`，必要时配合本文件记录的 fetch 探针方法（无头 Chrome + CDP + 包装 `window.fetch`）。
- **`Origin` 校验不等于鉴权（已实测确认）**：完全不带 `Origin` 的请求同样返回 200，所以校验只能约束浏览器，拦不住脚本。`publishableKey` 就明文躺在发布包里，任何人读出它都能消耗本应用额度。云服务侧无法编程约束用量（无 balance/quota 查询接口），只能依靠平台配额与客户端限流，后者可被绕过。**额度滥用的实际风险高于最初判断，需要按"该 key 公开"来接受或另行设限。**
- **`/.cloud/llm` 通道属于本应用**，不得当作开放代理对外宣传或复用。
- 若 `models.list()` 为空、`glm-5.3-flash` 从目录消失且没有任何可限制思考的条目、匿名调用实测需要登录、或重新发布无法保号：**停止**，保持线上规则版，回到腾讯 SCF 回退方案（`31_TENCENT_SCF_ADAPTER.md`），两者不要同时启用。

## 可复用的验收方法

本轮最有价值的产出之一是一套不依赖任何新下载的真实验收手段，后续回归可照用：

1. **本机脚本直连**（不经过浏览器）：用 `esbuild` 把 `app/lib/nlu-orchestrator.ts` 与 `app/lib/cloud-llm-config.ts` 打成 ESM，直接调用真实编排器 + 真实通道，检查 `parser.acceptedMode` / `fallbackReasonCode`。用于快速迭代模型与参数。
2. **真实浏览器点击级验收**：`"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --no-sandbox --disable-gpu --remote-debugging-port=9333 --user-data-dir=/tmp/<独立目录>`，然后走 CDP：
   - `Page.addScriptToEvaluateOnNewDocument` **在任何应用代码之前**注入 `window.fetch` 包装，记录每个 `/.cloud/` 请求的 URL、状态、耗时，并用 `res.body.tee()` 收集完整 SSE 文本——这样能看到真实分片数、`[DONE]` 是否存在、`content` 与 `reasoning_content` 各多少字、被中止时的确切错误。
   - `Runtime.evaluate` 用原生 `HTMLTextAreaElement` value setter + `input` 事件填 React 受控输入，再点按钮。
   - 以页面自身渲染的徽标（「AI 辅助理解 · 待你确认」）作为验收信号，而不是只看 HTTP 200。
3. **契约层对照实验**（零成本、无模型调用）：把真实草稿喂给导出的小体积校验器（如 `validateFieldEvidenceSemantics`），只改动一个字段的引文，就能定位是哪条规则拒绝了它。

## 明确不做

- 不把任何密钥、CloudBase Key、百炼 Key 写入网页、构建变量、仓库或截图。
- 不新建应用（会换域名）；不使用 CDN 形式规避安装问题。
- 不在未重新验收的情况下把 `site/dist/tencent-scf/` 作为前端上传目录。

## 参考

- 首轮只读评审材料：`32_WORKBUDDY_TENCENT_HANDOFF.md`
- 腾讯云回退方案：`30_CHINA_HOSTING_DECISION.md`、`31_TENCENT_SCF_ADAPTER.md`、`29_DASHSCOPE_COST_BOUND_RESEARCH.md`
- 现有解析契约：`25_ONLINE_LLM_RELEASE_GATE.md`、`10_LLM_API_CONTRACT.md`
- WorkBuddy 文档入口：https://www.workbuddy.cn/docs/workbuddy/Overview
