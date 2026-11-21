# 公开 LLM 防滥用：平台能力核实与本地最小防护

日期：2026-09-17。状态：**已只读核实平台能力 + 已在本地实现最小防护 + 已通过类型检查/测试/构建；未发布**。

> 修订记录（2026-09-17）：**撤回第 6 节原"计费为预付费、额度耗尽不会自动产生费用"的结论**，改为"云服务计费与超额行为未独立核实，需对应控制台或专门条款确认"。保留"平台存在额度耗尽拒绝码"这一可确证事实。同步修正第 1 节、第 5 节、失败回退表与参考链接。**仅改文档，未改代码、未发布、未消耗额度。**

范围：仅当前应用 `wbapp_cFS2bnfmLJu6A0MoVMgysh`（`https://melbourne-tripagent.app.workbuddy.host/`）。不新建应用、不购买服务、不改动发布内容、不触碰 `34_PARTY_COUNT_AND_FARE_DESIGN.md` 的人数/票型设计。

## 一、结论（先给结果）

**在本轮可访问的 WorkBuddy 工具与 SDK 中，未发现可由应用配置的服务端硬上限。** 未找到每日调用总数、单 IP 频率或并发、单请求预算、可编程紧急停用等设置入口。平台自身存在额度耗尽与限流拒绝行为，但本轮无法查询或设置阈值；控制台是否另有管理入口仍需单独确认。

因此按预设的第二分支处理：**只在本地加最小防护**，并明确它只是减少误触，不构成防脚本。真正要防脚本，必须让受信服务端控制模型入口并关闭可直连的匿名通道——这需要新建服务或换架构，超出"只改当前应用、不新建应用"的约束，因此本轮不做。

平台侧确实存在**额度耗尽拒绝码**：`credits-exhausted`，SDK 注释写明"额度耗尽或环境已销毁，读写必然失败"——即请求会被**硬拒绝**，不会静默返回空结果。

但**云服务（云服务资源点）的计费方式与超额行为未独立核实**：耗尽后是硬停、还是可能转入按量计费，本轮没有找到直接针对 WorkBuddy Cloud Service 的官方条款（见第 6 节）。因此本报告**不宣称**"耗尽不会产生费用"，只宣称"耗尽会被拒绝"。触发阈值与重置时间同样无法读取，只能看控制台（见"未核实"）。

## 二、只读核实：实际证据

以下均为本轮实际调用/读取所得，非推断。

### 1. 云服务管理工具只有两个动作

`workbuddy_cloud_service` 是本项目唯一可用的云服务管理入口。它的完整参数集是：
`action`（仅 `inspect` / `activate`）、`directory`、`applicationMode`、`applicationId`、`appName`、`domainPrefix`、`intent`。

**没有任何与配额、限流、并发、调用上限、停用相关的参数。**

本轮 `action: "inspect"` 的原始返回：

```json
{"type":"cloud_service_inspect_result","action":"inspect","activated":false,"count":1,
 "applications":[{"appName":"Melbourne TripAgent","applicationId":"wbapp_cFS2bnfmLJu6A0MoVMgysh"}],
 "message":"This session has 1 application(s): ... A local manifest does NOT prove the cloud service is bound; activate is idempotent and never double-charges."}
```

每个应用只有 `appName` 与 `applicationId` 两个字段——**没有 quota / limit / usage / rate 字段**。工具自身也说明"本地清单不能证明云服务已绑定"，`activated: false` 只反映本会话状态。

### 2. 发布工具也没有限流参数

`workbuddy_sites_deploy` 的完整参数集是：
`action`、`directory`、`language`、`port`、`installCmd`、`startCmd`、`entryHtml`、`userAskedToPublish`、`miniProgramRequested`、`appName`、`domainPrefix`、`appId`、`createNewApp`、`replaceExistingApp`、`updateExistingApp`。

**没有配额/限流/上限类参数。** 发布只能控制"上线/下线/覆盖哪个应用"，不能控制调用量。

### 3. SDK 公开面里没有任何配额或限流接口

已安装 `@tencent-ai/workbuddy-cloud-sdk@0.1.1-dev.111acaf.202609102031`。`lib/index.d.ts` 末尾的完整 `export { … }` 列表逐项核对，**没有** quota / limit / usage / balance / billing / admin 相关符号。LLM 侧只有：

```ts
cloud.llm.models.list()                    // 只读模型目录
cloud.llm.chat.completions.create()        // 只支持流式
```

内置技能文档也把这件事写死了（`references/llm/management.md`，"What Is Not Available"）：

- model call usage / consumed volume
- remaining quota, quota limits, or the accounting period
- billing, unit prices, or monetary amounts
- **per-model rate-limit numbers**
- Config V3 product configuration introspection

并明确要求："When quota information is genuinely needed, direct the user to the WorkBuddy console rather than fabricating a programmatic answer."

### 4. 服务端有强制行为，但阈值不是应用可设的

`sdk lib/index.d.ts` 第 28–29 行的错误类别枚举里同时存在：

```ts
/** 额度耗尽或环境已销毁，读写必然失败（§11.3）。 */
 | 'credits-exhausted' | 'rate-limited'
```

`references/llm/code-generation.md` 的错误码分派表：

| code prefix | 行为 |
|---|---|
| `quota_` | Creator quota exhausted or rate-limited；只有带 `retryAfterMs` 的 `quota_rate_limited` 才建议重试 |

这说明：**平台侧确实会因额度耗尽或限流而拒绝调用**，且是硬失败（不是"降级返回空"）。但这是平台策略，应用既不能设置阈值，也不能查询当前用量——所以做不出"全应用最多 30 次/日"这种账本。

### 5. 单 IP 限制在这套架构里根本不成立

数据面是"浏览器 → 发布域名边缘 → 模型"，应用侧看不到访客 IP，SDK 也不暴露任何调用方元数据。因此"单 IP 10 分钟最多 5 次""同 IP 并发 1"**无法表达**——不是没实现，是这一层拿不到 IP。

### 6. 计费与耗尽行为：**未独立核实**（本节为 2026-09-17 修正处）

> **修正说明**：本节前一版写过"预付费，先购买、后抵扣 → 额度耗尽硬停、不会自动扣费"。**该结论过强，现予撤回。** 理由如下。

**（1）前版引用的文档链接对不上。** 前版引作"腾讯云官方计费文档"的 `cloud.tencent.com/document/product/1749/126592`，**当前呈现为 "WorkBuddy Enterprise 计费概述"**（企业版账号订阅 + 加量包）。它讲的是**企业版的坐席、积分（Credits）与加量包价格**，**不是**公开网页所用云服务（云服务资源点）的计费条款。

**（2）"预付费、先购买后抵扣"这句话存在，但语境不对。** 该表述实际出现在 **`workbuddy.cn/docs/enterprise/price/Pricing`（企业版定价）** 的"计费规则详解 → 基本规则"里，配的是**企业版许可证/坐席与积分**的说明，**不能**外推到本应用这种公开网页的云服务资源点。

**（3）能确证的只有"有额度"和"有拒绝码"。**
- WorkBuddy 定价页（`workbuddy.cn/pricing`）的套餐对比表确实把 **"云服务资源点"** 列为套餐权益，与"云服务应用个数"并列：

  | 权益 | 体验版 | 标准版 | 高级版 | 旗舰版 |
  |---|---|---|---|---|
  | 云服务应用个数 | 10 | 30 | 50 | 99 |
  | 云服务资源点 | 5 000 | 25 000 | 50 000 | 150 000 |

  可见**该资源点是有额度概念的**。
- 平台侧存在**额度耗尽拒绝码**（`credits-exhausted`、`quota_*`，见第 4 节）。

**（4）但以下问题均无官方直接证据：**
- 云服务资源点**用尽后的行为**——是硬停、降级，还是转按量计费？
- 云服务资源点与积分（Credits）**是否为同一账本**？
- 是否/何时重置、能否购买加量包补齐？

**结论（更正后）："云服务资源点耗尽后一定不会自动产生费用"这一判断，本轮无法给出。** 在拿到直接针对 WorkBuddy Cloud Service 的官方条款前，应按"**超额行为未确认**"对待。这既是风险披露上更诚实的表述，也正是**不建议**把该模型端点当作无限免费资源、或宣称"顶多被拒不会花钱"的原因之一。

（附注：要真正确认这一点，路径是查对应控制台或专门的云服务计费条款，而不是靠 SDK 错误语义反推；本轮**未做**任何实测消耗。）

### 7. 自动重试：应用侧没有，SDK 的 LLM 路径也没有

- 应用侧：`grep -rn -i "retry" site/app/ site/bff/*.ts` **零命中**。
- SDK 侧（静态定位，非运行时验证）：`lib/index.js` 中 `chat/completions` 位于字节 159015 / 229096；`retryEnabled` 的 7 处集中在 33k–41k（打包进来的数据库客户端），`retryAfterMs` 5 处位于 140k–152k（仅作为错误对象字段暴露）。**没有重试机器靠近 LLM 调用路径**。

结论：一次失败就是一次失败，不存在隐藏的重复消耗。

### 8. 紧急停用：没有 API，但有两个真实可用的应用级开关

平台侧没有可编程的停用接口。应用侧存在两个**真实生效**的关停手段：

| 手段 | 效果 | 代价 |
|---|---|---|
| `CLOUD_LLM_PARSE_ENABLED = false` + 重新构建发布 | AI 按钮从页面消失（可见性由 `isCloudLlmParseConfigured()` 决定） | 需要构建+发布；边缘缓存可能仍发旧版（见 `33` 号文档） |
| `workbuddy_sites_deploy` + `action: "unpublish"` | 整站下线，链接失效 | 最重，访客完全无法访问 |

两者都是**发布级**动作，不是秒级开关；且都**拦不住已经拿到 `publishableKey` 的脚本**——它不经过页面。

## 三、因此暴露的风险（未缓解）

1. **`publishableKey` 明文在发布包内**，任何人读出即可调用本应用额度。
2. **省略 `Origin` 的脚本请求返回 200**（`33` 号文档已实测），所以 Origin 校验只约束浏览器。
3. **凭据不可轮换**：SDK 没有轮换/吊销接口，应用 id 与发布域名绑定；改 key 等于换应用。
4. 因此本应用存在**额度被第三方消耗**的实在风险，且本轮无法在平台侧设上限。

## 四、本轮实际实施的本地防护（已构建通过，未发布）

新增 `site/app/lib/llm-local-guard.ts`（纯逻辑，可注入时钟）+ `llm-local-guard.test.ts`（14 项）。

三条规则，全部在**模型调用之前**判定：

| 规则 | 取值 | 依据 |
|---|---|---|
| 输入长度上限 | 2 000 字符 | 沿用既有契约（`nlu-orchestrator` 截断 2 000、draft runtime 拒绝 >2 000、BFF 客户端拒绝 >2 000），不引入新数字 |
| 单页 single-flight | 同时最多 1 个在途请求 | 防止并发重复消耗 |
| 结算后冷却 | 10 000 ms | 实测一次抽取 6–8 s，真人读完结果远超这个值；只影响连点 |

再加"无自动重试"（不提供任何重试入口）与清楚提示。

**决策顺序是本轮唯一有实际技术含量的地方，因此被抽成纯函数 `planAiClick()` 单独测试。**
顺序必须是：长度 → 是否已有请求在跑 → 才去占 single-flight 槽位。
初版把"占槽"写在了"已有请求在跑"的提前返回之前，结果是那条提前返回路径会把槽位永久占住、
**此后所有 AI 点击全部死锁**（typecheck / lint / 单测全绿也发现不了，因为它是页面接线顺序问题）。
现在的写法把顺序变成可测契约：`planAiClick` 在"已有请求在跑"时必须既不占槽、也不消耗冷却，
且紧接着的下一次点击仍能到达模型。

接入 `site/app/page.tsx` 的行为：

- AI 点击路径先过 `planAiClick`；**超长输入直接拒绝**，不调用模型，给出"超过 2000 字符（当前 N）"的明确提示。
- 冷却期内**不调用模型**，若处理器仍被触达则优雅回退规则模式并显示剩余秒数；AI 按钮在此期间禁用并显示"AI 理解冷却中（N 秒）"。
- 请求结算（含被中止）时启动冷却，被拒绝的尝试**不延长**冷却；`release` 幂等，中止与完成各结算一次不会重复计时。
- 若 SDK 客户端构造同步抛错，立刻交还槽位并回退规则模式（`aiRelease?.()` + 明确提示），
  不让"占着槽但永远不结算"的情况出现。
- 输入框加 `maxLength`，并在接近上限时显示"已用 N / 2000 字符"，避免粘贴被静默截断。
- 按钮旁披露文案写明：**"页面内只做误触防护：同一时间只跑一个请求、连点冷却 10 秒、描述上限 2000 字符。这些只作用于本页面，不能阻止脚本直接调用云端接口。"**

未做（有意）：**没有加任何"看起来像保护"的代理**——一个仍可绕过的中间层只会制造虚假安全感。

## 五、服务端生效 vs 仅前端体验限制（必须分开看）

**服务端确实生效的（非本 PR 引入，属平台行为）：**
- 额度耗尽 / 平台限流时**硬拒绝**（`credits-exhausted` / `rate-limited` / `quota_*`），应用会转成规则回退，不会静默失败。注意：这只说明"会被拒绝"。
- 非流式请求在发出前即被拒（`request_stream_required`）。
- `messages[0]` 非应用自有 system 时被拒。
- **计费与超额行为未独立核实**（见第 6 节）：不要把"不会自动扣费"当作已确认的服务端保护；它是待确认项，不是防护。

**仅前端体验限制（可被绕过，不构成防护）：**
- single-flight、10 秒冷却、2 000 字符上限、按钮禁用与倒计时、`maxLength` —— 全部在浏览器内，读包即知，改包即绕。
- 它们**不能**跨访客计数、不能按 IP 计数、不能设置全应用日上限。

## 六、失败回退

| 情况 | 行为 |
|---|---|
| 超长输入 | 不调用模型；明确提示；用户需精简 |
| 冷却期内点击 | 不调用模型；显示剩余秒数；回退规则模式 |
| 已有请求在途 | 提示"已有理解请求正在进行，请稍候"，不重复发 |
| 模型超时/断流/不合约 | 沿用既有回退码，退回规则模式，上一份成功行程保留 |
| 额度耗尽 | 请求被拒 → 回退规则模式（平台行为，非本轮引入）。**耗尽后的计费/超额后果未确认**（见第 6 节） |

## 七、回归结果

| 项 | 结果 |
|---|---|
| `npm run typecheck` | 通过 |
| `npm run lint`（oxlint） | 0 warning / 0 error |
| `vitest run` | **371 项 / 22 文件全部通过**（原 357 + 新增 14） |
| POI 测试 | 5 / 5 通过 |
| 网关测试 | 40 / 40 通过 |
| `npm run workbuddy:build` + `release:validate` | 通过，70 文件 / 14.92 MiB |
| 产物核对 | 入口 chunk `page-SYbCfx6J.js`，确认内含冷却倒计时、披露文案、字符计数、初始化失败提示；`wbpk_` 仍只在既有那一处；无厂商密钥 |

**未发布**，线上仍是上一版 `page-mXAfQ98N.js`。

## 八、回滚

本轮**没有发布**，线上仍是上一版。若要回滚本地改动：恢复 `site/app/page.tsx` 的两处接线并删除 `site/app/lib/llm-local-guard.ts` 及其测试即可，无数据迁移、无外部资源变更。

若上线后发现守卫影响体验：把 `LLM_LOCAL_LIMITS.cooldownMs` 调低或设为 0 即可（`cooldownMs: 0` 等价关闭冷却，single-flight 与长度上限仍生效）。

## 九、未核实事项（需控制台确认，勿臆测）

1. 本账号当前**剩余额度、计费周期与重置时间** —— SDK 无接口，只能看控制台。
2. **平台限流的具体阈值**（多少次/多久触发 `rate_limit`）—— 平台不公开，也不可设。
3. 额度耗尽后的**实际 UI 与是否提供免打扰** —— 需控制台确认。
4. **云服务资源点的计费方式与超额行为**（本轮修正后新增，优先级最高）：资源点用尽后是硬停、降级还是转按量计费；与积分（Credits）是否同一账本；是否需显式购买加量包才能恢复。**本轮未找到直接针对 WorkBuddy Cloud Service 的官方条款**，需查对应控制台或专门条款确认——在确认前，不得对外断言"不会产生费用"。
5. 边缘缓存对"紧急停用"的延迟 —— `33` 号文档已记录裸链接可能长期 HIT，紧急停用应按"尽快但不保证即时"预期。

## 十、明确不做

- 不新建应用、不购买服务、不发布。
- 不实现"服务端 30 次/日"这类看起来安全、实际无法生效的值。
- 不加仍可绕过的代理冒充保护。
- 不改人数/票型逻辑（属 `34` 号文档，Codex 独立设计）。
- 不把任何厂商密钥写入前端；`publishableKey` 保持仅出现在既有 `cloud-llm-config.ts` 一处。

## 参考

- 路线与实测：`33_CLOUD_SERVICE_LLM_ROUTE.md`
- 人数/票型设计（勿合并发布）：`34_PARTY_COUNT_AND_FARE_DESIGN.md`
- 腾讯云回退方案：`30_CHINA_HOSTING_DECISION.md`、`31_TENCENT_SCF_ADAPTER.md`
- 计费（**本轮修正：均不能作为云服务计费的直接证据**）
  - `https://cloud.tencent.com/document/product/1749/126592` —— 当前呈现为 **WorkBuddy Enterprise 计费概述**（企业版坐席 + 积分 + 加量包），**非**云服务（云服务资源点）条款。
  - `https://workbuddy.cn/docs/enterprise/price/Pricing` —— 企业版定价；"预付费，采用先购买、后抵扣的方式"出自此处，语境为**企业版许可证/坐席与积分**。
  - `https://www.workbuddy.cn/pricing` —— 个人版定价页；套餐对比表列出 **"云服务资源点"** 额度（5 000 / 25 000 / 50 000 / 150 000），但**未说明**用尽后的行为。
  - `https://cloud.tencent.com/document/product/1831/134339` —— WorkBuddy Enterprise 积分说明；只覆盖 Credits 的消耗/扣减/有效期，**未提**云服务资源点。
  - **待补**：直接针对 WorkBuddy Cloud Service / 云服务资源点的官方计费条款或控制台处设置说明。
