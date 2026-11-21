# Melbourne TripAgent

一个面向中文旅行者的墨尔本行程规划原型。用户用自然语言描述旅行需求，系统从有来源的 POI 数据库中选择地点，生成 1–3 天的确定性行程，并支持在不破坏其他安排的前提下替换单个地点。

## 当前状态（2026-09-28 校准）

- 地理范围：Melbourne only；默认用户：第一次或短期到访墨尔本的中文旅行者
- 数据：City of Melbourne Open Data 原始快照 242 行；精选 40 条 POI（保留 12 条 legacy ID，新增 28 条），核心来源为 CC BY 4.0
- **源码（本仓库 `main`）**：v0.5 G1 + WorkBuddy 云模型适配（`CLOUD_LLM_PARSE_ENABLED = true`，偏好 `glm-5.3-flash`、`reasoning_effort=minimal`、20 s 超时）+ [36 号](docs/36_RULES_FIRST_TIER_AND_CACHE.md)“规则优先、按需调用模型”闸门与同文缓存。LLM 只做需求抽取；POI、时间、预算和约束仍由确定性规则负责。
- **线上**：据 [33 号记录](docs/33_CLOUD_SERVICE_LLM_ROUTE.md)，2026-09-17 已同链接发布“每次点击都调用云模型”的临时版本，并在真实浏览器中达成 `acceptedMode=llm`；36 号的规则优先版本**尚未发布**。线上当前实际版本须重新打开网页核对，不能凭本 README 推断。
- 页面显示的规划器标识仍为 `trip-planner-v0.4.3-local`，没有随 v0.5 改名；它表示规划器算法版本，不是整站版本。
- `site/bff` 的 Cloudflare Worker／腾讯云 SCF 路径是保留的实验适配器，当前线上不走它们。公开模型额度的防滥用仍有未解项，见 [35 号](docs/35_PUBLIC_LLM_ABUSE_CONTROL.md)。
- 仍未接入：实时地图路线、实时营业时间、天气、酒店、日期活动。中国境内普通网络可达性待实测。
- **展示版界面（2026-11-21）**：吸顶导航、Hero、发现墨尔本、行前准备、项目说明、我的行程抽屉已落地；规划器、数据快照和模型边界未改。见 [47 号](docs/47_SHOWCASE_UI.md)。
- 第一轮迭代的规划见 [40 号现状与范围](docs/40_BASELINE_AND_FIRST_ITERATION_SCOPE.md)、[39 号架构框架](docs/39_ARCHITECTURE_AND_RESUME_PROJECT_FRAMEWORK.md)、[43 号 30 题评测草案](docs/43_EVAL_TASKS_AND_ACCEPTANCE_PROTOCOL_DRAFT.md)；38–43 号是从正式归档复制进来的副本，文内链接仍指向归档路径。

在线 Demo：<https://zfaye-b101.github.io/melbourne-tripagent/>（GitHub Pages，规则路径）
源码：<https://github.com/zFaye-B101/melbourne-tripagent>

## 展示版界面

在 `site/` 运行 `npm run dev` 后，首页是一次滚动展示：顶部导航跳到「规划行程 / 发现墨尔本 / 行前准备 / 项目说明」，Hero 右侧就是规划输入；「我的行程」抽屉复用必去/避开状态。发现区来自真实 40 个 POI，项目说明区列出链路、证据和限制。

布局参考了 IV 小组作业的 R/Shiny 版本（`melbourne-group-source-20261022.zip`）的导航、右侧 My Trip 与三列规划思路，但没有迁移到 R/Shiny，也没有把规划器搬到服务端。设计取舍、文件清单和验收记录见 [47 号](docs/47_SHOWCASE_UI.md)。展示版已部署到 GitHub Pages；静态环境只走规则路径，云端理解需要 WorkBuddy 同源环境。

## 仓库与复现

本目录是唯一开发仓库（Git，`main` 分支）。2026-09-28 之前没有版本历史，首个提交就是当时的快照，没有补造历史。`llm-gateway-kit` 已并入 [`packages/llm-gateway-kit/`](packages/llm-gateway-kit/)（原同级目录保留未动），因此单独克隆即可复现：

```bash
git clone <本仓库> melbourne-tripagent
cd melbourne-tripagent/site
npm ci          # Node >= 22.13
npm test        # Vitest + POI 导入测试 + llm-gateway-kit 测试
npm run typecheck && npm run lint
npm run build && npm run release:validate
```

2026-09-28 在干净克隆（Linux、Node 22.23）上的结果：Vitest 24 文件 415 项、POI 导入 5 项、网关 40 项全部通过；typecheck、lint 0 错误；构建与 `release:validate` 通过（70 文件、14.92 MiB）。密钥只放在被忽略的 `site/bff/.dev.vars`，参考 `site/bff/.env.example`。

注意：构建会把 Geist 字体下载到 `site/.vinext/fonts`（缓存，不入库）；离线或受限网络下会静默缺字体（发布包 59 而不是 70 个文件），正式发布前请在联网环境构建并核对文件数。

### 30 题基线评测

```bash
cd site && npm run eval:baseline   # 规则路径，不调用模型；报告写入 site/eval/reports/
```

题集已定稿为 `mel-eval-30-v1`；冻结口径与 2026-11-20 基线见 [45 号](docs/45_EVAL_30_FREEZE_V1.md)，第一次结果与问题清单见 [44 号](docs/44_REPO_AND_RULES_BASELINE_2026-09-28.md)。

### 运行时配置热更新

POI、门票、票价、出发准备、规则参数和提示词放在 `site/config/` 与 `site/data/`，构建时输出到 `dist/client/runtime-config/`。页面启动、每 30 秒和窗口聚焦时检查 manifest；版本变了才重新拉取，失败保留当前配置。开发时由 Vite 直接服务这些文件，换配置不需要重新构建。

```bash
cd site && npm run build   # 重新生成 dist/client/runtime-config/
```

规则只外置可调参数，硬不变量仍在代码里；BFF 不在线上主链，其提示词仍是打包回退。细节、边界与验证见 [46 号](docs/46_CONFIG_HOT_RELOAD.md)。

### 用本地 Ollama 模型测“需求理解”（不花线上额度）

需要先在本机启动 Ollama 并拉好模型。只在自己电脑上运行，不属于 `npm test`：

```bash
cd site
# 先小跑 5 题各 1 次，确认能通
OLLAMA_MODEL=qwen3:8b OLLAMA_RUNS=1 OLLAMA_TASKS=01,05,22,27,28 npm run eval:ollama
# 完整跑（29 题 × 3 次，本地 8B 模型可能要几十分钟）
OLLAMA_MODEL=qwen3:8b OLLAMA_RUNS=3 npm run eval:ollama
```

结果写到 `site/eval/reports/ollama-<模型>-<日期>.{md,json,jsonl}`。这只代表所选本地模型，不代表线上模型。

## 本地体验

网页位于 [`site/`](site/)。进入该目录后运行：

```bash
npm run dev
```

浏览器访问终端显示的本地地址。当前可实际操作：

- 自然语言是首屏主入口；先显示紧凑的“也许你想……”条件摘要和每项来源，用户确认后才调用规划器，修改条件会自动使旧确认失效。
- 描述与详细设置不一致时逐条显示冲突；每一项都可直接跳到对应设置，或回到原始描述自行修改。
- 中文本地规则解析支持 1–3 天、八类游客体验、五档室内外倾向、节奏、每日开始时间、CBD／Southbank／Docklands／Carlton／East Melbourne／POI 起点、活动范围、少走路和亲子需求。
- 首屏是展示版 Hero：说明项目做什么，右侧直接放自然语言输入；下方有 10 张精选卡和 40 个地点的发现区，都可设为“默认／必去／避开”。
- 行程与替代地点中的 40 个景点均有本地实景图；照片保留来源页、作者、许可和地点匹配依据，加载失败时才显示类别示意。
- 详细设置按“时间与范围／同行人和预算／游玩偏好”分组，可修正天数、起点、11:00 等开始时间、活动范围、体验主题、日期、旅行预算、同行人员与公共交通刷卡方式。
- 已知 POI 可设为“必去”或“避开”；冲突、未知硬约束和容量不足会阻止生成并保留旧行程。
- 缺少天数时询问 1／2／3 天，不擅自猜测；外地城市或 4 天以上会阻止生成。
- 生成后按“行程概览 → 出发提醒 → 逐日安排”展示，Day 标签一次切换一个完整日程，避免单页堆叠过长。
- 每日默认展开示意地图（可收起）、时间线、55 分钟午餐、午餐后活动、首段交通距离估算和地点来源查看；地图按地点类别着色。
- 景点门票、公共交通最高预留、实体 myki 卡费和未知费用在概览中分开披露。
- 面向用户显示 `已安排好／需要调整／与偏好有差距／出发前确认`；底层仍保留三态约束检查。
- “换一个”先展示全部可行候选，确认后才原子替换；其他日期冻结，并支持最多 20 步 LIFO 撤销。
- 顶部导航、我的行程抽屉、发现区、行前准备和项目说明构成一页可展示的网站结构。

## WorkBuddy 静态发布

在 `site/` 中运行：

```bash
npm run workbuddy:build
```

唯一发布目录是 `site/dist/client/`，入口是 `index.html`。不要把项目根目录或 `site/` 当成 Node 服务发布；详细步骤、在线地址和同链接更新流程见 [`docs/09_WORKBUDDY_RELEASE.md`](docs/09_WORKBUDDY_RELEASE.md)。

## 核心原则

> 当前由本地规则理解需求；未来接入 LLM 时也只允许抽取带证据的结构化需求。POI 事实、时间、预算和约束结论始终由结构化数据与确定性规则负责。

模型供应商不是前端能力的一部分。未来通过独立 BFF 和 Provider Adapter 接入任意获批 API；更换模型时不改变 Draft Schema、确认流程或规划器。LLM 被调用不代表结果获采纳，页面状态只依据通过全部校验的 `acceptedMode`。

项目的第一版必须证明三件事：

1. 自然语言需求可以被正确转成结构化约束。
2. 系统可以从真实、有来源的 Melbourne POI 中生成可行行程。
3. 用户可以局部替换一个地点，而不破坏其他日期和硬约束。

## 设计文件

- [`docs/01_PRD.md`](docs/01_PRD.md)：产品范围、目标用户和验收目标
- [`docs/02_UX.md`](docs/02_UX.md)：桌面端、移动端页面结构与交互状态
- [`docs/03_ARCHITECTURE.md`](docs/03_ARCHITECTURE.md)：系统边界、模块和请求链路
- [`docs/04_POI_DATA.md`](docs/04_POI_DATA.md)：POI 来源、分层、清洗和核验方案
- [`docs/05_PLANNING_RULES.md`](docs/05_PLANNING_RULES.md)：候选筛选、排程、约束检查和“换一个”规则
- [`docs/06_TEST_AND_ROADMAP.md`](docs/06_TEST_AND_ROADMAP.md)：测试矩阵、完成定义和实施顺序
- [`docs/07_INTERVIEW_NOTES.md`](docs/07_INTERVIEW_NOTES.md)：真实可讲的项目边界与面试准备
- [`.codex/model-routing.md`](.codex/model-routing.md)：本项目的动态模型路由与阶段复核门槛
- [`data/poi.schema.json`](data/poi.schema.json)：POI 数据结构
- [`data/examples/trip-request.example.json`](data/examples/trip-request.example.json)：旅行需求示例
- [`data/examples/itinerary.example.json`](data/examples/itinerary.example.json)：行程输出示例
- [`prompts/planner-system-prompt.md`](prompts/planner-system-prompt.md)：规划解释层的系统提示词草案
- [`data/SOURCES.md`](data/SOURCES.md)：原始数据、哈希、许可和字段边界
- [`docs/08_IMPLEMENTATION_LOG.md`](docs/08_IMPLEMENTATION_LOG.md)：本轮实现与验收证据
- [`docs/09_WORKBUDDY_RELEASE.md`](docs/09_WORKBUDDY_RELEASE.md)：静态发布契约、WorkBuddy 操作与境内验收清单
- [`docs/10_LLM_API_CONTRACT.md`](docs/10_LLM_API_CONTRACT.md)：真实 LLM 需求解析的 Schema、校验、降级与独立后端边界
- [`docs/19_LOCAL_LLM_PROVIDER_SETUP.md`](docs/19_LOCAL_LLM_PROVIDER_SETUP.md)：四家 Provider 的本地私密配置、切换与真实 API 冒烟步骤
- [`docs/23_LOCAL_NLU_DIAGNOSTICS_V2.md`](docs/23_LOCAL_NLU_DIAGNOSTICS_V2.md)：仅本机启用的必去地点语义证据脱敏分类与隐私边界
- [`docs/22_OPTIONAL_ASSERTION_ELISION_PROPOSAL.md`](docs/22_OPTIONAL_ASSERTION_ELISION_PROPOSAL.md)：默认关闭的本地无证据可选断言舍弃实验及验收边界
- [`docs/11_V0_4_DESIGN_CONTRACT.md`](docs/11_V0_4_DESIGN_CONTRACT.md)：v0.4 本地体验、费用与解析契约
- [`docs/12_PRICE_TRANSIT_AND_NLU_RESEARCH.md`](docs/12_PRICE_TRANSIT_AND_NLU_RESEARCH.md)：票价、PTV、NLU 候选与参考站研究
- [`docs/13_V0_4_LOCAL_VALIDATION.md`](docs/13_V0_4_LOCAL_VALIDATION.md)：v0.4 本地测试证据和人工验收边界
- [`docs/15_V0_4_2_AGENT_FIRST_CONTRACT.md`](docs/15_V0_4_2_AGENT_FIRST_CONTRACT.md)：自然语言主入口、确认门、三组设置与主题来源边界
- [`docs/16_V0_4_3_VISUAL_CONFLICT_COPY_CONTRACT.md`](docs/16_V0_4_3_VISUAL_CONFLICT_COPY_CONTRACT.md)：景点视觉、冲突定位与中文文案边界
- [`docs/17_V0_4_4_FULL_IMAGE_COMPACT_PROPOSAL.md`](docs/17_V0_4_4_FULL_IMAGE_COMPACT_PROPOSAL.md)：40 个地点图片覆盖与紧凑条件摘要的实现、来源和验收
- [`docs/18_V0_5_LLM_ROLE_AND_PROVIDER_CONTRACT.md`](docs/18_V0_5_LLM_ROLE_AND_PROVIDER_CONTRACT.md)：参考原型后的 LLM 职责分配、可替换 API、隐私与分阶段接入边界
- [`docs/25_ONLINE_LLM_RELEASE_GATE.md`](docs/25_ONLINE_LLM_RELEASE_GATE.md)：真实 LLM 线上发布门槛与当前规则版状态
- [`docs/30_CHINA_HOSTING_DECISION.md`](docs/30_CHINA_HOSTING_DECISION.md)：中国内地后端托管首选、WorkBuddy 能力区别及账号／域名阻断点
- [`docs/31_TENCENT_SCF_ADAPTER.md`](docs/31_TENCENT_SCF_ADAPTER.md)：腾讯云事件函数 URL 与 CloudBase 预算适配、本地证据及未执行的部署步骤
- [`docs/44_REPO_AND_RULES_BASELINE_2026-09-28.md`](docs/44_REPO_AND_RULES_BASELINE_2026-09-28.md)：唯一工作仓库、依赖复现与 30 题第一次规则基线
- [`docs/45_EVAL_30_FREEZE_V1.md`](docs/45_EVAL_30_FREEZE_V1.md)：30 题 v1 冻结口径与 2026-11-20 重跑结果
- [`docs/46_CONFIG_HOT_RELOAD.md`](docs/46_CONFIG_HOT_RELOAD.md)：POI、规则参数、提示词的运行时配置热更新
- [`docs/47_SHOWCASE_UI.md`](docs/47_SHOWCASE_UI.md)：展示版导航、Hero、发现区、行前准备、项目说明与我的行程抽屉
- [`data/trip-request-draft.schema.json`](data/trip-request-draft.schema.json)：供应商无关的 `TripRequestDraft v1` JSON Schema
- [`data/trip-request-draft-v2.schema.json`](data/trip-request-draft-v2.schema.json)：覆盖当前自然语言条件、逐字段证据与严格枚举的 `TripRequestDraft v2`
- [`data/examples/trip-request-v2.example.json`](data/examples/trip-request-v2.example.json)：v2 有效草稿与 evidence 示例
- [`prompts/nlu-extraction-system-v2.md`](prompts/nlu-extraction-system-v2.md)：只做需求抽取、不参与规划的 v2 系统提示词
- [`data/poi-admission-price-v0.4.schema.json`](data/poi-admission-price-v0.4.schema.json)：40 条 POI 门票快照 Schema

## 关键实现

- [`site/app/lib/planner.ts`](site/app/lib/planner.ts)：解析、确定性排序、排程、约束检查和原子替换
- [`site/app/lib/agent-session.ts`](site/app/lib/agent-session.ts)：待确认方案、来源标签与过期确认守卫
- [`site/app/lib/nlu-contract.ts`](site/app/lib/nlu-contract.ts)：供应商无关 Adapter、解析诊断与 evidence 类型
- [`site/app/lib/nlu-orchestrator.ts`](site/app/lib/nlu-orchestrator.ts)：异步解析、超时、整次规则降级、取消与 fingerprint 提交门
- [`site/app/lib/bff-parse-client.ts`](site/app/lib/bff-parse-client.ts)：供页面一次性 AI 试用入口调用的 Parse API 客户端，含响应校验、取消和完整规则回退；公开版未配置 BFF URL
- [`site/app/lib/trip-request-draft-v2-runtime.ts`](site/app/lib/trip-request-draft-v2-runtime.ts)：v2 Schema、evidence、语义验证和确定性规范化
- [`site/data/melbourne-pois-v0.1.json`](site/data/melbourne-pois-v0.1.json)：规划器适配层 POI 快照
- [`site/app/page.tsx`](site/app/page.tsx)：响应式交互界面、撤销状态和 WebMCP 接口
- [`site/app/components/featured-pois.tsx`](site/app/components/featured-pois.tsx)：热门景点轮播、三态偏好与降级
- [`site/app/components/poi-visual.tsx`](site/app/components/poi-visual.tsx)：行程与候选地点共用的照片／类别示意组件
- [`site/app/lib/poi-media.ts`](site/app/lib/poi-media.ts)：40 项完整图库、10 项精选子集与查询入口
- [`site/app/lib/planner.test.ts`](site/app/lib/planner.test.ts)：规划器与 v0.4 回归测试
- [`site/app/lib/agent-session.test.ts`](site/app/lib/agent-session.test.ts)：Agent-first 方案摘要、默认值和确认失效测试
- [`site/app/lib/trip-request-contract.test.ts`](site/app/lib/trip-request-contract.test.ts)：4 项 `TripRequestDraft v1` Schema 自动测试
- [`site/app/lib/trip-request-draft-v2.test.ts`](site/app/lib/trip-request-draft-v2.test.ts)：v2 范围、偏好、预算、同行人与 evidence 契约测试
- [`site/app/lib/pricing-data.test.ts`](site/app/lib/pricing-data.test.ts)：门票 Schema、40 POI 映射与 PTV 快照测试
- [`site/app/lib/featured-data.test.ts`](site/app/lib/featured-data.test.ts)：40 项图片覆盖、来源、本地文件与 10 项精选隔离测试
- [`scripts/sync-poi-media.mjs`](scripts/sync-poi-media.mjs)：固定 Commons 文件的许可核验、本地同步与图片清单生成
- [`scripts/validate-poi-snapshot.mjs`](scripts/validate-poi-snapshot.mjs)：规范化 POI 与官方原始 CSV 的逐条核验

## 推荐实施顺序

1. 已完成：12 条有来源 POI 的本地可点击原型。
2. 已完成：确定性的时间、重复、范围和未知状态检查。
3. 已完成：“换一个”和 20 步撤销。
4. 已完成 40 条 POI 的 raw／manifest／normalized／verified／planner adapter 导入链路。
5. 已保留 `TripRequestDraft v1` 兼容层，并在本地冻结 `TripRequestDraft v2`、解析-only Prompt 和 attempted／accepted 诊断；BFF 已具备 OpenAI／DeepSeek／智谱／DashScope Provider 切换。DashScope 已完成固定八案的本机真实响应试验，部分 Draft 被采纳、部分因证据不足安全回退；页面的一次性 AI 入口已接线，但公开 BFF 部署、费用与安全验收仍待完成。
6. 已完成 WorkBuddy 首版公开部署；中国境内普通网络验收仍待完成。
7. v0.4 已完成热门卡、11:00／CBD 解析、全天排程、门票／PTV 预算和候选弹窗，已随 v0.4.4 同链接发布。
8. v0.4.2 已恢复自然语言主入口，加入“理解 → 核对 → 确认生成”门槛、三组精细设置、五档场所倾向和八类游客体验，已随 v0.4.4 同链接发布。
9. v0.4.3 已为行程和全部替代候选补齐照片或明确示意，加入逐项冲突跳转，并统一面向游客的中文文案，已随 v0.4.4 同链接发布。
10. v0.4.4 已让全部 40 个地点使用来源可查的实景图，并将“也许你想……”条件摘要压缩为共享面板；已于 2026-09-16 覆盖更新既有 WorkBuddy 应用。
11. v0.5 G1 已完成 v2 evidence／语义运行时验证器、测试专用 mock Adapter、整次规则降级、页面异步取消和迟到结果保护，并已于 2026-09-16 同链接发布；真实 LLM 仍未调用，外部 NLU、真实地图路线、Australia 多城市扩展仍需另行批准。

## 验证

在 [`site/`](site/) 中运行：

```bash
npm run data:import
npm run data:validate
npm run data:test
npm test
npm run typecheck
npm run lint
npm run build
npm run release:validate
```

当前最终计数以本轮完整验收输出为准；数据导入输出位于 `data/normalized/`、`data/verified/`、`data/reports/` 与 `site/data/`。

## 数据与署名

当前 core POI 仅使用 City of Melbourne Open Data；本阶段没有接入 OSM/Overpass 的 POI enrichment。Wikimedia Commons 只提供热门卡与天际线视觉素材，不作为 POI 事实来源；每张图片保存作者、许可、来源页、核验日期与本地副本。所有展示事实和图片都要保留来源、抓取时间、许可证与核验状态。不要把受限旅游网站或商业地图页面作为批量抓取源。

## 作者与证据边界

这是 AI-assisted implementation：AI 可以生成代码，但需求取舍、数据来源选择、验收、测试和最终表述需要由项目作者理解并确认。在代码、运行记录和测试证据形成前，不应在简历中声称“独立开发并上线”或填写未经验证的性能数字。
