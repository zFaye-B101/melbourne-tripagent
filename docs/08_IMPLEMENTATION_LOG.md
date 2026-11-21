# 08. 实施与验收记录

## 2026-09-14–15：Melbourne v0.1 本地原型与 40 POI 扩量

### 本轮目标

在不接真实 LLM、不接第三方地图、不公开部署的前提下，完成一个可实际操作的 Melbourne 1–3 天行程规划闭环。

### 已完成

- 使用官方 Sites 模板建立 React + TypeScript + Vinext/Vite 单页应用。
- 保存 City of Melbourne Open Data 原始 CSV 与元数据快照。
- 保存官方 raw 快照 242 行；从中冻结 40 条 CBD／内城区 POI（12 条 legacy ID + 28 条新增），保留稳定 ID、来源行键、坐标、许可和核验状态。
- 建立 manifest → normalized → verified → planner adapter 四层导入链路及固定输出路径。
- 实现受限中文规则解析、确定性区域排序、09:30–17:30 排程、午餐占位和坐标距离交通估算。
- 实现 40 条已知 POI 的必去／避开硬约束、别名匹配、冲突与未知地点阻断；必去地点不可替换。
- 实现 `Pass / Fail / Not verifiable` 检查，未知营业时间、票价、实时交通和拥挤程度不会被当作通过。
- 实现单点原子替换、其他日期冻结、当天重新排程、失败不提交和最多 20 步 LIFO 撤销。
- 实现缺少天数的 1／2／3 天澄清、外地城市与 4 天以上阻断，并保留上一次成功结果。
- 添加桌面／移动端布局、图片失败降级、来源详情和一个页面级 WebMCP 生成工具。

### 数据证据

- CSV：`data/raw/city-of-melbourne-poi-2026-09-14.csv`
- CSV SHA-256：`c79c6816a5155278cc99bc67898ada00a3fe1e1f4b77fd48d582deac85cf0aa0`
- 元数据：`data/raw/city-of-melbourne-poi-metadata-2026-09-14.json`
- 元数据 SHA-256：`97e1b4bb60b15049eba65e709ae921f89febbd4d01b4e98befe6ed7a805ee875`
- 许可：City of Melbourne Open Data，CC BY 4.0。
- 自动核验结果：40／40 精选记录的英文名、主题、子主题和坐标与原始 CSV 匹配；原始 CSV SHA-256 与质量报告一致。

### 实际检查

| 检查                    | 结果                                                                                                        |
| ----------------------- | ----------------------------------------------------------------------------------------------------------- |
| `npm run data:import`   | 通过；生成 normalized、verified、quality report 与 planner snapshot，40 条                                  |
| `npm run data:validate` | 通过；40 条均重新匹配原始 CSV，版本 `mel-poi-v0.1-2026-09-14`                                               |
| `npm run data:test`     | 5／5 通过；包含确定性、失败不覆盖、四产物写入和真实 manifest 集成测试                                       |
| `npm test`              | 23／23 通过；18 项规划器测试 + 5 项导入测试                                                                 |
| POI JSON Schema         | 40／40 normalized 记录通过 `data/poi.schema.json`                                                           |
| 连续两次导入            | 四份产物 SHA-256 逐项相同                                                                                   |
| `npm run typecheck`     | 通过                                                                                                        |
| `npm run lint`          | 通过；生成的 UI 组件目录不纳入项目自有代码 lint                                                             |
| `npm run build`         | 通过                                                                                                        |
| 桌面浏览器              | 3 天生成、Melbourne Skydeck 必去、SEA LIFE Melbourne Aquarium 避开、单点替换／撤销及引用状态展示通过        |
| 390px 窄屏              | 单栏布局通过，无横向溢出                                                                                    |
| 图片失败状态            | 有降级文案；本地授权图片加载通过                                                                            |
| 全新浏览器控制台        | 0 error／0 warning                                                                                          |
| WebMCP 运行时           | 当前 Playwright Chromium 未暴露 `document.modelContext`，因此只确认了防御式注册实现，未宣称工具调用验收通过 |

### 模型路由记录

- 架构与规则契约：L4，委派 `gpt-5.6-sol`，`ultra`；发现“缺少天数默认 2 天”与项目规则冲突后，再由同一组合裁决为“必须澄清”。
- POI 来源与许可研究：L3，委派 `gpt-5.6-terra`，`high`。
- 单张图片来源检索：L1，委派 `gpt-5.6-luna`，`low`。
- 测试向量：L2，委派 `gpt-5.6-luna`，`medium`。
- 站点实现与验证：站点技能要求由当前 Site owner 亲自编辑；主会话精确型号与 effort 不可验证，因此保持不变，没有把“未发生的降档”写成模型切换。
- 40 POI 导入契约与失败恢复规则：L4，委派 `gpt-5.6-sol`，`ultra`。
- 数据源审计与新增参考页核验：L3，委派 `gpt-5.6-terra`，`high`。
- 导入器、验证器与回归测试：L2，委派 `gpt-5.6-luna`，`medium`。
- 精选清单整理与文档同步：L1，委派 `gpt-5.6-luna`，`low`。

### 已知限制

- 规则解析只识别维护过的关键词，不能等同于真实 LLM 理解。
- 地图和交通均为坐标示意与估算，不可用于导航。
- 营业时间、票价、天气、拥挤、无障碍路线和临时闭馆仍需出发前核实。
- 数据集只提供静态名称、主题、子主题和坐标；动态营业时间、票价、临时关闭、拥挤和无障碍事实仍未知。
- `verified_core` 仅表示静态核心字段通过来源核验，不表示景点当前开放。
- 页面包含 WebMCP 生成工具的防御式注册；本次浏览器实测 `document.modelContext` 为 `undefined`，因此未声称工具调用验收通过。
- 未公开部署，也没有账号、持久化、分享或导出。

### 下一次需要 L4 决策的事项

自动刷新与动态数据、接入真实 LLM、实时路线／天气／营业时间、公开部署或扩展到 Australia 多城市，任一项开始前都要重新冻结数据、许可、隐私、成本与失败恢复规则。

## 2026-09-15：WorkBuddy 静态发布候选

### 冻结契约

- 架构决策按 L4 处理，由 `gpt-5.6-sol / ultra` 只读复核；最终选择保留 Vinext，并使用 `output: 'export'`，不重写成普通 Vite SPA。
- 逐文件兼容性复核按 L1／L2 处理，由 `gpt-5.6-luna / low` 完成；站点修改仍由当前 Site owner 落地。
- 唯一发布目录为 `site/dist/client/`，发布类型为 `static`，入口为 `index.html`。
- WorkBuddy 仅托管静态文件，不运行 Wrangler、数据库或 API；项目根目录和 `site/` 均不是发布目标。
- 本轮只生成并验收本地发布候选，未执行公开发布。

### 实施内容

- `next.config.ts` 启用 Vinext 静态导出。
- `.openai/hosting.json` 声明 `static.directory = dist/client`。
- 去除页面中的 `next/font/google` 调用，改用系统中英文字体栈；静态页不引用 Google Fonts 域名。
- 将 4030×2267、3,261,982 bytes 的原始 JPEG 保存在 `data/raw/media/`，页面改用 1600×901、280,664 bytes 的本地 WebP；署名与 CC BY-SA 4.0 许可保持不变。
- 增加 `npm run workbuddy:build` 和静态发布完整性检查脚本。
- 新增 `docs/09_WORKBUDDY_RELEASE.md`，记录 WorkBuddy 操作、发布授权边界和中国境内验收清单。

### 验收证据

| 检查                       | 结果                                                     |
| -------------------------- | -------------------------------------------------------- |
| `npm run data:validate`    | 通过；40 条 POI 与官方 raw CSV 匹配                      |
| `npm test`                 | 23／23 通过；18 项规划器测试 + 5 项导入测试              |
| `npm run typecheck`        | 通过                                                     |
| `npm run lint`             | 通过                                                     |
| `npm run workbuddy:build`  | 通过；`/` 与 `/404` 共 2 个路由静态预渲染成功            |
| `npm run release:validate` | 通过；30 个文件、8 个首页本地资源均存在，发布包 1.19 MiB |
| 本地静态 HTTP              | 首页 200（50,246 bytes）；WebP 图片 200（280,664 bytes） |

本地静态验收不等于中国境内可达，也不等于已经上线。只有获得本轮明确发布授权、生成公开链接并由中国境内网络实测后，才可记录为 `deployed + china_access_verified`。

## 2026-09-15：WorkBuddy 首版公开发布

- 用户在本轮明确授权发布。
- WorkBuddy 以 `language=static`、`entryHtml=index.html` 发布 `site/dist/client/`，创建新应用 `Melbourne TripAgent`；未覆盖其他应用，也未运行 Node、Wrangler 或重新构建。
- 公开链接：<https://melbourne-tripagent.app.workbuddy.host/>
- WorkBuddy 返回发布成功及可达性检查通过；另在独立浏览器中打开公开链接，并实际切换 Day 1／Day 2，页面和交互正常。
- 后续由 Codex 在本地修改、测试并重新生成 `site/dist/client/`，再由 WorkBuddy 选择已有应用 `Melbourne TripAgent` 覆盖发布；公开链接保持不变。
- 当前状态为 `deployed`；由于尚未由中国境内普通网络实测，不标记为 `china_access_verified`。

## 2026-09-15：v0.3 纵向 UX、LLM 契约与同链接更新

### 用户界面

- 初始页不再显示预生成示例行程，只保留需求输入、示例和真实能力说明。
- 生成后改为 `我理解的是 → 出发提醒 → Day 1／2／3 连续纵向行程 → 规划说明与数据来源`。
- Day 导航改为吸顶快速定位，点击后滚动到对应日期，不再隐藏其他日期。
- 每日地图默认折叠并持续标注 `不是导航路线`；天际线图片只在概览出现一次。
- 普通用户不再直接看到 `Pass / Fail / Not verifiable`，改为 `已安排好／需要调整／与偏好有差距／出发前确认`；底层三态仍保留用于测试。
- 保留地点来源、替换、当天重排、最多 20 步撤销和失败时保留上一份成功行程。

### LLM 接口契约

- 按 L4 规则设计，使用 `gpt-5.6-sol / ultra` 做只读复核，冻结供应商无关的 `TripRequestDraft v1`。
- LLM 只抽取带原文证据的地点名称与已支持偏好，不能生成 POI ID 或行程。
- 预算、起点、人数、指定交通、无障碍、饮食和预约等当前未执行要求必须进入 `unhandledRequirements`，不能静默忽略。
- 服务端必须执行 JSON Schema、证据和 40 POI 白名单校验；真实供应商、后端部署、费用和中国境内可达性仍待决策。
- 新增 4 项 Schema 自动测试，覆盖有效示例、额外字段、四天不可截断和未表达偏好保持 `null`。

### 验收证据

| 检查                       | 结果                                                                            |
| -------------------------- | ------------------------------------------------------------------------------- |
| `npm test`                 | 27／27 通过；18 项规划器 + 4 项 AI 契约 + 5 项导入链路                          |
| `npm run typecheck`        | 通过                                                                            |
| `npm run lint`             | 通过                                                                            |
| `npm run workbuddy:build`  | 通过；2 个路由静态预渲染成功                                                    |
| `npm run release:validate` | 通过；30 个文件、7 个首页资源均存在，发布包 1.15 MiB                            |
| 本地真实浏览器             | 三日完整纵向展示、Day 2 定位、地点替换／撤销、缺天数追问与旧结果保留均通过      |
| 最终静态包                 | 两日生成成功；9 个同源请求均 200；控制台 0 error／0 warning                     |
| 390px 窄屏                 | `scrollWidth = viewport = 390`，无横向溢出                                      |
| WorkBuddy 覆盖发布         | `updateExistingApp=true`、`verified=true`，没有创建新应用，网址不变             |
| 独立公网浏览器             | 新首页与两日纵向生成均通过；9 个页面／资源请求均 200，控制台 0 error／0 warning |

### 发布结果

- 在线地址：<https://melbourne-tripagent.app.workbuddy.host/>
- WorkBuddy 返回根页面 HTTP 200，线上 `index.html` 与本地文件大小一致，favicon 和 skyline 图片均为 HTTP 200。
- WorkBuddy 自动维护 `.wbapp_*.genie`、`.workbuddy/applications.yaml` 与 `.workbuddy/memory/` 发布元数据；业务源码和 `site/dist/client` 没有被 WorkBuddy 修改或重新构建。
- 中国境内普通网络仍需验收人员实测，因此状态保持 `deployed`，不标记为 `china_access_verified`。

### 依赖审计说明

`npm audit --omit=dev` 当前报告 6 项生产依赖树告警（5 high、1 low）。涉及 Vinext 图片解析构建链、Vite 的 Windows 开发服务器、React Server Functions 和 Undici；本次 WorkBuddy 只托管纯静态文件，不运行 Node、开发服务器、服务端函数，也不处理用户上传图片，因此这些路径不暴露在当前线上运行面。没有执行可能破坏兼容性的 `audit fix --force`；框架与 React 版本升级应作为独立维护迭代完成并重新跑完整发布验收。

## 2026-09-15：v0.4 本地体验、排程与预算

### 范围

- 用户批准实施设计契约 `11_V0_4_DESIGN_CONTRACT.md`，但明确要求本轮只修改本地版本。
- 未调用外部 NLU／LLM、未配置 API Key 或 BFF、未触发 WorkBuddy／Sites hosting；线上地址仍运行此前 v0.3。

### 实施内容

- 加入 10 张真实授权图片的热门景点轮播、图片来源元数据与 `默认／必去／避开` 三态硬约束。
- 加入完整快速设置、生成前解析摘要、CBD 代理起点、首段交通、中央城区与户外偏好。
- 修复晚出发和下午空白，按轻松／均衡／紧凑节奏保证地点数、55 分钟午餐、下午活动和结束覆盖。
- 加入 40 条门票快照及 Schema、PTV 临时费率快照、旅客组合、参考预算与未知费用披露。
- 把单击即替换改为全量可行候选对话框；用户确认后才产生一次可撤销原子变更。
- 将准备情况压缩为一行，并降低主要区块与时间线的垂直间距。

### 验收

- `npm run typecheck`、`npm run lint`、`npm run data:validate` 和静态构建均通过。
- `npm run test` 共 43 项通过：38 项 Vitest 与 5 项 Node 数据导入测试。
- `npm run release:validate` 通过：41 个静态文件、17 个首页资源引用、4.71 MiB。
- 完整证据与人工验收边界见 `13_V0_4_LOCAL_VALIDATION.md`。

## 2026-09-15：v0.4.1 本地信息层级与替代地点审计

### 范围

- 只修改本地源码和 `site/dist/client/` 本地构建，没有调用 WorkBuddy／Sites hosting，线上 v0.3 地址未更新。
- 设计契约见 `14_V0_4_1_LOCAL_UX_CONTRACT.md`。

### 实施内容

- 将快速设置提升为主入口，只常显天数、节奏和偏好主题；其余设置默认折叠。
- 把四条一键示例移到首屏横向列表；自然语言改为诚实的可选本地关键词补充。
- 移除热门景点自动轮播和暂停键，将手动上一组／下一组按钮放在图片外。
- Day 标签改为一次只显示一天；地点说明默认显示，来源继续折叠，地图默认关闭。
- 用结构化证据标签替换重复理由；必去改为醒目徽章，交通时间与直线距离移入时间栏。
- “查看替代地点”现在审计数据集除目标外的全部 39 个地点，并分别列出可直接替换与暂不可选及其原因。
- 替换候选排序改为同类别、同区域、用户偏好分数、稳定 ID 的严格字典序。
- 修复否定兴趣误识别，并且不再把“想去”自动升级为必去硬约束。

### 自动验收

| 检查                | 结果                                                                              |
| ------------------- | --------------------------------------------------------------------------------- |
| `npm test`          | 通过；45 项 Vitest + 5 项 Node 数据导入测试                                       |
| `npm run typecheck` | 通过                                                                              |
| `npm run lint`      | 通过                                                                              |
| `npm run build`     | 通过；2 个静态路由预渲染成功                                                      |
| 本地 HTTP           | `http://127.0.0.1:3000/` 返回 200；新入口和热门景点文案生效，页面不再包含暂停按钮 |

本轮没有执行浏览器视觉截图，也没有发布；视觉密度和交互手感等待用户在当前本地页面继续验收。

## 2026-09-15：v0.4.2 Agent-first 本地交互

### 范围

- 用户批准按 `15_V0_4_2_AGENT_FIRST_CONTRACT.md` 只实现本地版本。
- 未调用外部 NLU／LLM、未配置 API Key 或 BFF、未触发 WorkBuddy／Sites hosting；线上地址继续运行此前 v0.3。
- 页面中的 `Agent` 是交互角色，实际解析模式明确显示为 `基础理解模式`。

### 实施内容

- 自然语言输入恢复为首屏最大入口；示例语句只填入输入框，不自动提交。
- 新增 `PlanProposal`：先展示 `我理解的是`，逐项区分 `你说的／手动调整／Agent 默认／需确认`，用户确认后才调用确定性规划器。
- 自然语言、精细设置或热门卡任一改变都会使旧提案过期；WebMCP 工具也只能准备提案，不能绕过确认门。
- 精细调整重组为 `行程边界／同行人与费用／游玩偏好`，加入五档场所倾向、八类游客体验及当前 40 POI 覆盖数量。
- 官方 `theme/sub_theme` 与 TripAgent 产品标签分开披露；咖啡、餐厅与夜生活覆盖不足时只提示未用于排序。
- 起点扩展为 CBD、Southbank、Docklands、Carlton、East Melbourne 与当前 POI；支持 `出发点CBD／从CBD出发` 等紧凑表达，未知酒店或地址会阻止生成。
- 修正混合偏好来源：原文识别的体验与手动补充的体验分别展示，不互相冒充。
- 旧计划、全量替代候选、原子替换、20 步撤销、预算与来源披露保持不变；新请求失败不覆盖上一份成功结果。

### 自动验收

| 检查                                | 结果                                                  |
| ----------------------------------- | ----------------------------------------------------- |
| `npm test`                          | 通过；65 项 Vitest + 5 项 Node 数据导入测试，共 70 项 |
| `npm run typecheck`                 | 通过                                                  |
| `npm run lint`                      | 通过                                                  |
| `npm run data:validate`             | 通过；40 条 POI 与原始 CSV 匹配                       |
| `oxfmt --check`（6 个变更代码文件） | 通过                                                  |
| `npm run build`                     | 通过；2 个静态路由预渲染成功                          |
| `npm run release:validate`          | 通过；41 个文件、17 个 HTML 资源引用、4.73 MiB        |
| 本地 HTTP                           | `http://localhost:3000/` 返回 200                     |

生产构建首次在受限沙箱中因预渲染临时端口权限失败；在获准的本机环境重跑同一构建后通过。这是环境权限差异，不是代码修复或公网发布。

### 模型路由

- 规则、状态机与产品边界：L4，按用户指定使用 `gpt-5.6-sol / ultra`。
- 实现前契约复核：L3，`gpt-5.6-terra / high`。
- UI 状态映射：L2，`gpt-5.6-terra / medium`。
- 测试与最终代码复核：L2，`gpt-5.6-luna / medium`。
- 文档一致性审计：L1，`gpt-5.6-luna / low`。
- 站点实际编辑由 Site owner 主会话完成；主会话精确运行模型不可验证，因此不虚构型号。

本轮没有执行浏览器视觉截图，也没有发布。用户可在现有 `http://localhost:3000/` 继续进行交互与视觉验收。

## 2026-09-15：v0.4.3 景点视觉、冲突定位与中文文案

### 范围

- 用户批准按 `16_V0_4_3_VISUAL_CONFLICT_COPY_CONTRACT.md` 继续修改本地版本。
- 未新增外部图片、未接入外部 NLU／LLM、未触发 WorkBuddy／Sites hosting；线上版本未在本轮更新。

### 实施内容

- 新增共用景点视觉组件：10 个有完整来源的地点显示本地实景图，其余 30 个显示明确标注的类别示意；图片失败时也安全降级。
- 每日行程、可直接替换候选与暂不可选候选均在地点名称旁显示紧凑视觉素材；有照片的地点可展开查看作者和许可。
- 解析结果新增机器可读的设置冲突目标。冲突面板逐条提供“去修改”，打开详细设置后自动展开、滚动并聚焦对应控件；所有冲突项同时高亮。
- 保留“修改旅行描述”入口；任意一侧改变都会让旧理解过期，必须重新整理并确认。
- 面向用户的来源标签改为 `描述中提到／详细设置／暂用默认／需要补充`，交互角色统一使用“我”。
- 将预算、同行人、区域、选择理由和错误提示改为更接近日常旅行表达的文案。

### 自动验收

| 检查                                | 结果                                                  |
| ----------------------------------- | ----------------------------------------------------- |
| `npm test`                          | 通过；69 项 Vitest + 5 项 Node 数据导入测试，共 74 项 |
| `npm run typecheck`                 | 通过                                                  |
| `npm run lint`                      | 通过                                                  |
| `npm run data:validate`             | 通过；40 条 POI 与原始 CSV 匹配                       |
| `oxfmt --check`（8 个变更代码文件） | 通过                                                  |
| `npm run build`                     | 通过；2 个静态路由预渲染成功                          |
| `npm run release:validate`          | 通过；41 个文件、17 个 HTML 资源引用、4.74 MiB        |

浏览器只读检查因本机管理员策略校验不可用而未执行；没有绕过安全控制。用户可刷新现有 `http://localhost:3000/` 做视觉与交互验收。本轮没有发布。

## 2026-09-16：v0.4.4 全量地点图片与紧凑条件摘要

### 范围

- 用户确认其余内容可以接受，本轮只处理 40 个地点图片覆盖、需求摘要标题和七项摘要的占地问题。
- 设计与来源契约见 `17_V0_4_4_FULL_IMAGE_COMPACT_PROPOSAL.md`。
- 实现与本地验收阶段未触发 WorkBuddy／Sites hosting；本地验收完成并得到用户明确同意后，于 2026-09-16 覆盖更新既有 WorkBuddy 应用。

### 实施内容

- 新增 40 项完整图片清单，并将完整图库与 10 项首页精选列表拆开；逐日行程和替换列表不再出现常规类别占位。
- 为 30 个原缺图地点补齐本地 Wikimedia Commons 图片、来源页、作者、许可、哈希和地点匹配证据。
- 替换容易误认的 Federation Square 与 Melbourne Museum 旧图；Docklands Park 改为园内水景装置与绿化画面。
- 以居中 4:3 缩略图制作 4 × 10 联系表，人工核对 40 个地点，没有发现同名异城或主体错配。
- 图片加载失败时仍保留类别示意降级，并准确区分“加载失败”和“没有核验图片”。
- 需求摘要标题改为 `也许你想……`；七张独立卡收成共享白色面板，基础信息按“行程范围／偏好与同行”固定两排，动态条件进入“其他偏好”。
- 摘要条目改用 `<dl>/<dt>/<dd>`，只保留一个 `修改条件` 入口；四类来源文字、原文证据、确认门和冲突逐项跳转保持不变。

### 自动验收

| 检查                                      | 结果                                                              |
| ----------------------------------------- | ----------------------------------------------------------------- |
| `npm run test`                            | 通过；70 项 Vitest + 5 项 Node 数据导入测试，共 75 项             |
| `npm run typecheck`                       | 通过                                                              |
| `npm run lint`                            | 通过                                                              |
| `npm run data:validate`                   | 通过；40 条 POI 与原始 CSV 匹配                                   |
| `oxfmt --check`（8 个变更代码／数据文件） | 通过                                                              |
| `npm run build`                           | 通过；2 个静态路由预渲染成功                                      |
| `npm run release:validate`                | 通过；70 个文件、17 个 HTML 资源引用、14.67 MiB                   |
| 本地静态图片                              | `http://localhost:3000/poi/webb-bridge.jpg` 返回 `200 image/jpeg` |

第一次生产构建在受限环境中因预渲染需要监听 `127.0.0.1` 而收到 `EPERM`；在获准的本机环境重跑同一命令后通过。本地开发服务继续位于 `http://localhost:3000/`。

### WorkBuddy 同链接发布

- 使用注册标记中的既有应用 ID `wbapp_cFS2bnfmLJu6A0MoVMgysh`，以 `updateExistingApp=true` 覆盖发布；没有创建新应用。
- WorkBuddy 返回 `verified=true`、`deployedAs=web-page`，公开地址保持为 <https://melbourne-tripagent.app.workbuddy.host/>。
- 线上首页与本地 `dist/client/index.html` 的 SHA-256 一致；线上 `/poi/webb-bridge.jpg` 与本地图片的 SHA-256 也一致。
- 当前状态为 `deployed`；中国境内可达性尚未实测，不标记为 `china_access_verified`。

### 模型路由

- 图片来源／许可契约与摘要结构：L4，`gpt-5.6-sol / ultra`。
- 资产盘点与机械实现审计：L1–L2，`gpt-5.6-luna / low`。
- Site 文件最终编辑、下载和验证由主任务完成；主任务精确模型不可验证，不虚构型号。

## 2026-09-16：v0.4.5 初始页首屏压缩（仅本地）

### 范围

- 本轮只压缩尚未生成行程时的初始页，不改变自然语言解析、详细设置、规划器、图片来源或线上版本。
- 明确没有调用 WorkBuddy／Sites hosting；既有线上地址仍停留在上一版，等待用户本地验收后再决定是否覆盖发布。

### 实施内容

- 缩短顶栏、输入卡标题区、表单内边距和页面上下留白；自然语言输入仍是首屏主入口，并保留 2–3 行可见空间。
- 将原先单独占块的示例区改为一行 `也许你想……` 短标签；标签点击后仍会填入完整示例句，完整内容同时保留为无障碍名称和悬停提示。
- 压缩热门景点区标题、控制按钮、图片比例和卡片间距；照片、分类、中文／英文名称、短介绍、图片来源及 `默认／必去／避开` 三态选择全部保留。
- 手机端保留正常纵向滚动，不用缩小正文或牺牲触控目标来强行塞入单屏。

### 本地验收

| 检查                       | 结果                                                          |
| -------------------------- | ------------------------------------------------------------- |
| 1366 × 768 初始页          | `scrollHeight = clientHeight = 768`；无纵向或横向页面滚动     |
| 1280 × 800 初始页          | `scrollHeight = clientHeight = 800`；无纵向或横向页面滚动     |
| 1440 × 900 初始页          | `scrollHeight = clientHeight = 900`；无纵向或横向页面滚动     |
| 390 × 844 初始页           | 无横向页面滚动；保留 67 px 自然纵向滚动，输入区和主按钮在首屏 |
| 浏览器交互                 | 示例填入、详细设置开关、热门景点必去计数、轮播下一组均通过    |
| `npm test`                 | 通过；70 项 Vitest + 5 项 Node 数据导入测试，共 75 项         |
| `npm run typecheck`        | 通过                                                          |
| `npm run lint`             | 通过                                                          |
| `npm run build`            | 通过；2 个静态路由预渲染成功                                  |
| `npm run release:validate` | 通过；70 个文件、17 个 HTML 资源引用、14.67 MiB               |

生产构建首次在受限沙箱中因预渲染临时监听本机回环地址而收到 `EPERM`；在获准的本机环境重跑同一构建后通过。浏览器控制台只有 React 开发工具提示，没有错误或警告。

### 模型路由

- 初始页信息层级与压缩边界：L3，由 `gpt-5.6-terra / high` 做只读复核。
- 多视口验收清单：L2，由 `gpt-5.6-luna / low` 做只读整理。
- Site 文件编辑、浏览器验收与构建由主任务完成；主任务精确型号和 effort 不可验证，因此保持不变且不虚构。

## 2026-09-16：真实 LLM 接入准备（默认关闭、未部署）

### 范围

- 只准备真实 LLM 的服务端边界，不把 API Key 放入项目，不调用真实模型，不接入生产页面，也不发布 BFF 或更新 WorkBuddy。
- WorkBuddy 静态页面继续使用 `adapter: undefined` 的本地规则路径；现有线上版本不受影响。

### 实施内容

- 新增独立 Cloudflare Worker BFF：`POST /v1/trip-requests/parse`。
- 新增 OpenAI Responses Provider Adapter；模型和 Key 只从服务端环境读取，`store: false`，输出使用严格 JSON Schema，并设置输出上限。
- 将本地 Draft v2 Schema 转换为 Structured Outputs 兼容形态：所有对象字段 required、可选项用 nullable、对象禁止额外字段，并移除 Provider 不支持的 `uniqueItems`；结果仍必须通过本地完整 AJV、evidence 与语义门。
- 只允许浏览器提交文本、locale 与数据版本；拒绝浏览器指定模型／供应商、未知字段、错误版本、未授权 Origin 和非目标路径。
- 请求体按流式读取执行 16 KB 上限，旅行文本仍限制为 2,000 字符。
- `LLM_ENABLED` 默认关闭；即使设为 true，缺少服务端 `LLM_RATE_LIMITER` binding、配额拒绝或 limiter 异常时也会 fail-closed，直接回退规则解析而不调用 Provider。
- 供应商超时、429、认证／配置、网络、非法 JSON、Schema、evidence、语义和版本错误均使用稳定原因码整体回退；不拼接 LLM 与规则字段。

### 本地验收

| 检查                       | 结果                                                               |
| -------------------------- | ------------------------------------------------------------------ |
| `npm test`                 | 通过；125 项 Vitest + 5 项 Node 数据导入测试，共 130 项            |
| `npm run typecheck`        | 通过                                                               |
| `npm run lint`             | 通过                                                               |
| `npm run data:validate`    | 通过；40 条 POI 与原始 CSV 匹配                                    |
| `npm run build`            | 通过；2 个静态路由预渲染成功                                       |
| `npm run release:validate` | 通过；70 个文件、17 个 HTML 资源引用、14.82 MiB                    |
| Wrangler BFF dry-run       | 通过；430.27 KiB，gzip 84.43 KiB；没有部署                         |
| 静态包敏感信息扫描         | 未发现 API Key、OpenAI endpoint 或服务端模型配置进入 `dist/client` |

### 尚未启用的硬门槛

- 在目标 Cloudflare 账户创建并验证 rate limiting binding、匿名配额／滥用策略；CORS 不作为认证。
- 配置项目级、可轮换的 API Key，选择支持 Responses Structured Outputs 的具体模型，并设月度硬成本上限与账单告警。
- 完成供应商数据保留／隐私告知、前端明确 opt-in 与 BFF URL 接线、真实模型质量／拒答／429／延迟／成本测试，以及中国普通网络可达性测试。

### 模型路由

- 实现与测试补全：`gpt-5.6-luna / medium`。
- 结构化输出、安全边界与激活条件复核：`gpt-5.6-sol / high`。

## 2026-09-16：智谱／DeepSeek 本地 Provider 配置（未调用、未部署）

### 范围与实现

- 需求解析保持无状态，不新增数据库；Key 只允许进入被忽略的 `site/bff/.dev.vars` 或服务端 secret。
- 新增 `LLM_PROVIDER` 显式路由，支持 `zhipu`、`deepseek`、`openai`；一次请求只调用配置的一家，不做跨供应商静默重试。
- 新增本地回环专用 DashScope `qwen3.8-flash` Chat Completions Adapter：固定 Workspace endpoint、严格 JSON Schema、FreeTierOnly 配置门与额度耗尽熔断；未进行真实 API 调用或部署。
- 智谱默认测试模型为官方当前免费文本模型 `glm-4.7-flash`，使用 Chat Completions `json_object`；完整 Draft v2 Schema 写入系统提示词，随后仍经过本地 AJV、evidence 和语义校验。
- DeepSeek 使用 Responses API 与 `deepseek-flash` 配置；只读取 `message/output_text`，不把 reasoning 文本误当作 JSON，并区分鉴权／余额、限流和服务不可用回退。
- 新增显式 runtime + loopback 双条件的本地限流绕过：只有 `LLM_RUNTIME_ENV=local` 且来自 `localhost`、`127.0.0.1`、`[::1]` 的请求在显式开启时有效；生产配置固定为 `production`，非本机环境仍然 fail-closed，必须提供 `LLM_RATE_LIMITER`。
- 本机回环的真实 Provider 验证等待上限放宽为 20 秒；生产与非回环请求仍固定 4 秒，且前端不能覆盖超时。
- 将 BFF `compatibility_date` 调整为当前已安装 Workers 运行时实际支持的 `2026-05-22`，修复本地启动阻断。
- 新增 `npm run bff:smoke`，用于在用户自行放入本地 Key 后验证真实 Provider 输出是否被本地验证链接受。

### 验证与未完成项

- `npm test`：通过；135 项 Vitest + 5 项 Node 数据导入测试，共 140 项。
- `npm run typecheck`：通过。
- `npm run lint`：通过。
- 本地 BFF 成功读取 `bff/.dev.vars` 并启动；无 Key 冒烟返回 HTTP 200、`attemptedMode=llm`、`acceptedMode=rules`、`fallbackReasonCode=auth_or_config`，确认没有误把空配置视为接通。
- Wrangler BFF dry-run：通过；436.97 KiB，gzip 85.49 KiB，没有部署。
- `npm run build` 与 `npm run release:validate`：通过；70 个静态文件、17 个 HTML 资源引用、14.82 MiB。
- 静态发布包敏感配置扫描：未发现智谱／DeepSeek endpoint、模型名或 Key 变量；本地私密配置权限已设为仅当前用户可读写。
- 机器上没有发现可用的智谱／DeepSeek 环境 Key，因此当前只完成请求契约、响应解析、错误映射、Provider 路由和 mock 网络测试；不能把它表述为“真实 API 已调用成功”。
- 本轮不修改生产页面、不部署 BFF、不更新 WorkBuddy。真实 smoke 的唯一剩余输入是用户在本机私密文件中加入自己的 API Key。
- 生产调用仍有明确安全硬门槛：当前统一匿名限流 key 和 CORS 不是认证；增加调用方认证／抗滥用挑战、不可伪造配额键和成本上限前，线上必须保持 `LLM_ENABLED=false`。

### 2026-09-16 百炼补充验证

- `qwen3.8-flash` Adapter 固定北京业务空间 endpoint、精确模型名、严格 JSON Schema，并显式关闭 thinking、search 和 stream；结构化输出请求不设置 `max_tokens`。
- 只允许本机回环调用；缺 Key、业务空间 ID、免费额度确认门或模型不匹配时均在网络请求前失败。
- 同时兼容 OpenAI 风格嵌套 `error.code` 与百炼顶层 `code` 的额度错误；识别后打开当前进程熔断。控制台“免费额度用完即停”仍是计费保护前提，本地熔断不承诺零费用。
- 独立复跑：159 项 Vitest、5 项 Node 数据测试、TypeScript 类型检查与 oxlint 全部通过；未进行真实 API 调用、前端接线或部署。

### 2026-09-16 百炼真实 smoke 记录

- 第一次百炼真实 smoke 在 20 秒等待上限内超时；只读 `models` endpoint 返回 HTTP 200，耗时约 2.4 秒。故仅将本机回环等待上限调整为 60 秒，生产与非回环请求仍固定 4 秒；本记录不代表真实 smoke 成功。
- 第二次请求约 19.9 秒得到 `qwen3.8-flash` 的结构化响应，`attemptedMode=llm`、Prompt 版本和 Schema 链均生效；但 evidence 逐字校验失败，最终 `acceptedMode=rules`、`fallbackReasonCode=evidence_rejected`。这证明真实 API、地域、Key、Workspace 和模型响应可达，但尚不能标记为 LLM 结果已被产品接受。
- 随后停止真实请求并关闭本地 BFF；未继续消耗额度、未接入前端、未部署。清理本轮 Wrangler 临时目录后，DashScope/BFF 定向测试 37 项、TypeScript 类型检查和 oxlint 均通过。

### 2026-09-16 百炼脱敏诊断记录

- 经用户明确同意，只向同一北京地域 `qwen3.8-flash` endpoint 再发送了一次固定旅行描述；请求约 25.2 秒完成，测试进程正常退出。
- 诊断代码只允许输出校验阶段、稳定错误码或本地校验器的安全原因，不输出 Key、Workspace ID、完整模型回答或 Draft；但 Vitest 对通过用例的 console 输出进行了拦截，本次进程结束后没有留下字段级诊断行。
- 因此不能从本次运行诚实地声称具体失败字段，也不能把当前状态升级为“LLM 已被产品接受”。没有为补日志擅自发送第二次请求。
- 临时诊断文件已删除，本地 BFF 保持关闭；未接入前端、未部署、未更新 WorkBuddy。若继续，需要再次获得用户明确同意，并使用已确认可见的安全输出通道执行一次请求。

### 2026-09-16 百炼第二次脱敏诊断记录

- 再次获得用户明确同意后，先在不加载任何 Provider 配置的情况下以 `--disableConsoleIntercept` 验证脱敏输出通道；只显示 `stage`、稳定错误码或本地校验原因，且没有发出网络请求。
- 随后只发送一次固定旅行描述；请求约 21.7 秒完成。返回值通过 Provider 解析与 Draft v2 Schema，失败点精确定位为 evidence：`抽取值 /date/resolution#scalar 缺少原文 evidence。`
- 该输入只有“每天早上十一点出发”这一每日开始时间，没有旅行日历日期。当前最可能的根因是模型将每日时间错误映射为非 `missing` 的日期状态，或至少没有按契约为该日期状态提供逐字证据；由于本轮不输出完整 Draft，二者不能进一步武断区分。
- 本轮没有降低 evidence 门槛、没有发送额外请求。临时诊断文件已删除，本地 BFF 保持关闭；未接入前端、未部署、未更新 WorkBuddy。

### 2026-09-16 日期／每日开始时间提示词修复（仅本地）

- 将运行时 Prompt 版本从 `nlu-extraction-system-v2` 递增为 `nlu-extraction-system-v2.1`，便于后续 smoke 区分修复前后的供应商输出。
- 明确规定旅行日期与每日开始时间严格分离：只有“每天早上十一点出发”等开始时间、没有独立日历日期时，`date` 必须保持 `missing`，不得生成 `/date/*` evidence；`dailyStartText` 必须完整保留原文，`dailyStartMinutes` 只在原文可确定时填写，两者分别携带 evidence。
- 同步更新可读 Prompt 文档，并为运行时提示词、Prompt 版本和现有完整 Draft 的 Schema／evidence／语义三道门增加回归断言；没有修改 Schema，也没有降低 evidence 或语义校验。
- 完整本地验证通过：12 个 Vitest 文件、161 项测试，另有 5 项 Node POI 导入测试；TypeScript 类型检查和 oxlint 均通过。
- 本轮没有加载私密配置、没有调用真实 Provider、没有接入前端、没有部署或更新 WorkBuddy。修复状态为 `implemented`，尚不能标记为 `smoke_tested`。
- 模型路由：本地实现由 `gpt-5.6-luna / low` 完成，主会话独立复核并修正固定示例的完整原文与文档版本号；主会话型号不可验证且保持不变。

### 2026-09-16 `nlu-extraction-system-v2.1` 真实 smoke

- 经用户明确同意，先以空配置执行无网络预检，确认脱敏输出只包含校验阶段、稳定原因与 Prompt 版本；随后只向北京地域 `qwen3.8-flash` 发送一次既有固定旅行描述，没有自动重试。
- 请求约 22.5 秒完成，真实返回使用 `promptVersion=nlu-extraction-system-v2.1`，通过 Provider 解析与 Draft v2 Schema，但在 evidence 门失败：`抽取值 /experiencePreferences/parks_gardens#scalar 缺少原文 evidence。`
- 本次没有再出现原先的 `/date/resolution` 缺 evidence 错误，说明 v2.1 至少改变了供应商输出；但校验在 `parks_gardens` evidence 处提前停止，尚未运行完整语义门，因此不能单凭这次结果宣称日期字段已经完全正确，整个 Draft 也仍不能被产品接受。
- 原文表达“喜欢室外”与“博物馆和美术馆、历史”，并没有直接表达公园／花园偏好。当前最可能问题是模型把场所环境 `venuePreference=outdoor` 推导成了体验主题 `parks_gardens`；这违反“只抽取直接表达字段”的契约。
- 临时 smoke 文件已删除，本地 BFF 保持关闭；没有降低校验门、没有接入前端、没有部署或更新 WorkBuddy。当前状态仍是 `implemented`，不能标记为完整 `smoke_tested`。

### 2026-09-16 偏好轴隔离提示词修复（v2.2，仅本地）

- 将运行时 Prompt 版本递增为 `nlu-extraction-system-v2.2`，明确 `geography`（活动区域）、`venuePreference`（室内外环境）和八个 `experiencePreferences`（体验主题）是三个独立轴，禁止跨字段推断。
- 明确“室外”只能证明 `venuePreference`，不能自动填写 `parks_gardens`、`river_city_walk`、`city_icons_views` 等主题；“室内”也不能自动填写 `museum_exhibition`。每个体验主题只有在用户直接表达对应主题时才可为非 `null`。
- 新增固定示例：“喜欢室外、博物馆和美术馆、历史”只能产生 `venuePreference=outdoor`、`museum_exhibition=prefer`、`history_heritage=prefer`，其他体验主题保持 `null`，不得生成 `parks_gardens` evidence。
- 未修改 Schema 或 validator；新增本地负例证明：即使错误 Draft 为 `parks_gardens=prefer` 补上“喜欢室外”这一真实 quote，原文存在性检查可通过，语义门仍会以“无法由 evidence 证明”拒绝。
- 完整本地验证通过：12 个 Vitest 文件、161 项测试，另有 5 项 Node POI 导入测试；TypeScript 类型检查和 oxlint 均通过。
- 本轮没有加载私密配置、没有调用真实 Provider、没有接入前端、没有部署或更新 WorkBuddy。当前版本为 `implemented`，仍需另行授权真实 smoke 才能判断是否被供应商完整执行。
- 模型路由：本地实现由 `gpt-5.6-luna / low` 完成，主会话独立复核并复跑全部本地验证；主会话型号不可验证且保持不变。

### 2026-09-16 `nlu-extraction-system-v2.2` 真实 smoke

- 经用户明确同意，先以空配置执行无网络预检，再只向北京地域 `qwen3.8-flash` 发送一次既有固定旅行描述；没有自动重试。
- 请求约 19.1 秒完成，真实返回使用 `promptVersion=nlu-extraction-system-v2.2`，通过 Provider 解析与 Draft v2 Schema，但在 evidence 门失败：`抽取值 /geography/strength#scalar 缺少原文 evidence。`
- 本次不再出现 v2.1 的 `parks_gardens` 缺 evidence 问题，但校验在 geography evidence 处提前停止，仍不能宣称整个 Draft 或此前字段已全部通过。
- 原文“主要在市内”可以同时证明活动范围与软强度；当前失败说明模型仍容易漏掉“同一原文片段需要为多个字段分别生成 evidence 项”的机械要求。结合此前 `/date/resolution`、`parks_gardens` 与本次结果，继续逐字段追加提示词的收益已经下降，应先重新评估 evidence 绑定方式，而不是立即制作 v2.3 并再次消耗真实额度。
- 临时 smoke 文件已删除，本地 BFF 保持关闭；没有降低校验门、没有接入前端、没有部署或更新 WorkBuddy。当前状态仍不能标记为完整 `smoke_tested`。

### 模型路由

- 本次属于 L3 Provider 集成；主会话负责实现和验证，当前运行型号不可验证且保持不变。
- DeepSeek 与智谱的官方接口核对由两个只读分支并行完成；其具体运行型号未暴露，不虚构型号。

### 2026-09-16 Evidence Binding v1（仅本地）

- 在 Draft v2 首次 Schema 通过后、现有 evidence 校验前加入 provider-neutral 的 Evidence Binding v1；唯一允许的映射为 `/geography/strength ← /geography/scope`。
- 只有当整份 Draft 恰好缺少这一项、已有 evidence 全部合法、来源 quote 与完整原文都能确定性证明相同的 geography scope 和 hard/soft strength 时，才原样复制 `quote + occurrence`；不搜索原文，不改抽取值，不处理日期、偏好、预算、地点、人数或数组。
- 补全后的克隆 Draft 重新执行 Schema、evidence 和语义三道门；任一步失败或绑定过程异常，都整次回退规则解析并返回 `evidence_rejected`，不采纳任何 LLM 字段。
- 高等级只读审计发现并推动修复了 `structuredClone()` 异常可能逃逸的问题；编排层现已统一捕获并安全回退。公开 Parse API、ParserDiagnostics、Provider、Prompt、Planner 与 Draft Schema 均未改变。
- 完整本地验证通过：12 个 Vitest 文件、174 项测试，另有 5 项 Node POI 导入测试；POI 数据快照 40 条校验通过，TypeScript 类型检查和 oxlint 均通过。
- 本轮没有读取 `.dev.vars`、没有调用真实 Provider、没有接入前端、没有构建或部署。状态为 `implemented`，尚未 `smoke_tested`。
- 模型路由：规则与安全契约由 `gpt-5.6-sol / ultra` 设计，并由 `gpt-5.6-sol / high` 独立审计；代码与测试由 `gpt-5.6-luna / low` 实现；主会话完成全套本地复验。

### 2026-09-16 Evidence Binding v1 单次真实 smoke

- 经用户明确同意，在脱敏预检确认本机百炼配置、固定 `qwen3.8-flash`、北京业务空间、免费额度确认门和本地回环条件均满足后，只发送了一次既有固定旅行描述；没有自动重试。
- 请求约 22.3 秒完成，HTTP 200、`decision=ready`、`attemptedMode=llm`、`promptVersion=nlu-extraction-system-v2.2`，但最终 `acceptedMode=rules`、`fallbackReasonCode=evidence_rejected`，因此 LLM 草稿仍未被产品采纳。
- 本次脱敏 stdout/stderr 没有记录更具体的 evidence 字段或路径；不能据此判断是 geography 绑定前置证明未满足，还是绑定后暴露了另一个缺失证据。没有输出或保存 Provider Draft，也没有为追查原因发起第二次请求。
- smoke 结束后立即停止本地 BFF，并确认 8787 端口关闭；未修改私密配置、未接入前端、未部署或更新 WorkBuddy。Evidence Binding v1 已执行真实 smoke，但尚未通过 LLM 接受验收。
- 模型路由：固定 smoke 由 `gpt-5.6-luna / low` 执行；主会话按既有严格验收门复核结果，没有因失败升级模型或扩大调用次数。

### 2026-09-16 Local NLU Diagnostics v1 最终验收（仅本地、离线）

- 将 `DraftValidationResult` 收紧为强制 issue 的判别联合：每个 Schema、Evidence、Semantic 失败分支都必须同时返回稳定原因与安全路径，TypeScript 不再允许仅返回 message。
- Schema 诊断只按 AJV `instancePath` 映射到白名单；未知路径为 `null`，evidence 子路径统一为 `/evidence`。AJV `params`、`additionalProperty` 和 message 不进入诊断事件。
- Evidence 的 7 个数据失败原因、绑定异常与校验器异常，以及 Semantic 的 5 个业务失败原因与校验器异常均有直接测试；Normalization 异常也通过测试依赖注入覆盖。共 19 个稳定失败原因全部具备 validator 或 orchestrator 断言。
- Orchestrator 删除通用占位 issue，直接使用校验器返回值；绑定内部异常固定为 `evidence.binding_exception`，绑定后 Schema 失败固定覆写为 `schema.post_binding_invalid`，各校验器自身抛异常时安全回退并输出对应 `validator_exception`。一次 Provider 成功后的校验链最多 emit 一次。
- Sanitizer 改为严格重建白名单对象，不再原样返回输入；校验 outcome/firstFailure、绑定四字段、`not_run`、`internal_error`、stage/reason 与路径的一致性。新增机器可读 Schema，并以测试保证枚举和代码 allowlist 完全一致。
- HTTP 回归测试确认打开或关闭本地诊断开关时，响应状态、headers 和 body 完全一致；flag/runtime/loopback 三重门、请求头或请求体不能开启、单行输出、同步／异步 sink 失败均保持 fail-open。
- 完整验证通过：13 个 Vitest 文件、224 项测试，另有 5 项 Node POI 导入测试，共 229 项；TypeScript 类型检查、oxlint、相关 TypeScript 与 JSON 文件的 oxfmt 检查，以及 40 条 POI 数据快照校验全部通过。
- 本轮没有联网，没有读取或修改 `.dev.vars`，没有调用 Provider，没有启动 BFF，没有构建或部署，也没有改变公开 Parse HTTP API。
- 模型路由：该收口属于 L4 契约与实现复核；规则与隐私边界由 `gpt-5.6-sol / ultra` 冻结。实现先后由 `gpt-5.6-luna / low` 与 `gpt-5.6-terra / medium` 推进，在两轮仍未完整满足强制 issue 契约后，按升级规则改由 `gpt-5.6-sol / high` 完成；主会话模型名称不可验证，仅负责独立复验，未虚构或改写其型号。

### 2026-09-16 Local NLU Diagnostics v1 单次真实 smoke

- 经用户单独授权，只发送一次既有固定 smoke 请求，没有自动重试或追加 Provider 调用。
- 请求约 27.6 秒完成，HTTP 200、`decision=ready`、`attemptedMode=llm`、`promptVersion=nlu-extraction-system-v2.2`；最终为 `acceptedMode=rules`、`fallbackReasonCode=evidence_rejected`，因此 API 可达，但 LLM Draft 仍未被产品采纳。
- 本地诊断只输出一条 `TRIPAGENT_NLU_LOCAL_DIAG_V1`：`outcome=fallback`；Evidence Binding 为 `status=skipped`、`reason=invalid_existing`；首个失败为 `stage=evidence`、`reason=evidence.missing_required_coordinate`、`path=/destination/supportedCity`。
- 这证明诊断通道能在不暴露旅行原文、quote、Draft、Provider 响应或凭据的情况下定位首个校验失败；不能据此把 LLM 标记为已通过接受验收。
- smoke 后已停止本地 BFF，并独立确认 8787 端口没有监听。未修改 `.dev.vars` 或代码，未启动前端，未构建、部署或更新 WorkBuddy。
- 模型路由：固定 smoke 属于 L1 执行，由 `gpt-5.6-luna / low` 完成；主会话模型名称不可验证、保持不变，只复核端口状态与脱敏结论。

### 2026-09-16 Prompt v2.3（仅本地）

- Prompt 升级为 `nlu-extraction-system-v2.3`，补齐 Melbourne destination 双 evidence、无目的地/其他城市约束，以及 geography scope/strength 分别 evidence 要求。
- Evidence Binding allowlist 仍仅允许 `/geography/strength <- /geography/scope`；destination 不得绑定。
- 离线验证：13 个 Vitest 文件、225 项测试通过，另有 5 项 Node 导入测试通过；typecheck、lint、相关代码格式与 40 条 POI 数据校验通过。
- 此实现阶段未读取 `.dev.vars`、未调用真实 Provider、未启动 BFF、未构建或部署。

### 2026-09-16 Prompt v2.3 单次真实 smoke（未通过发布门）

- 经用户授权，仅发送一次既定本地回环 smoke 请求，没有重试。约 28.217 秒后返回 HTTP 200、`decision=ready`、`attemptedMode=llm`、`promptVersion=nlu-extraction-system-v2.3`，但 `acceptedMode=rules`、`fallbackReasonCode=evidence_rejected`。
- 四个目标 evidence path 在最终 `fieldEvidence` 中均为 false；这是整次回退后不返回 LLM 字段证据的结果，不能据此逐项判断 Provider Draft 的真实缺失情况。
- 唯一一条脱敏诊断为 `outcome=fallback`，Binding `not_needed / missing_count_not_one`；首个失败为 `evidence.missing_required_coordinate`，安全路径 `/family`。只知道首个校验失败点，不能推断后续字段都已通过，也不能确定 `/family` 抽取值。
- 本次真实验收未达到 `acceptedMode=llm`，按预定停止条件不再请求、不降低验证门，也不发布“线上 LLM”。本地 BFF 已停止，并由主会话独立确认 8787 无监听。未修改私密配置、构建或部署。
- 公开部署还缺少独立后端、生产级调用方抗滥用与可信配额、成本上限和前端显式同意；当前 WorkBuddy 应用仍是纯静态规则模式。一次本地 Provider HTTP 200 不等于线上 LLM 可用。
- 模型路由：提示词与发布边界由 `gpt-5.6-sol / ultra` 分别冻结和审计；本地实现与单次 smoke 由 `gpt-5.6-luna / low` 执行；主会话型号不可验证、保持不变，独立复核测试与端口状态。

### 2026-09-16 继续推进：本地真实解析与前端接线准备

- 恢复本地检查后，对固定 smoke 文本执行了两次 v2.3 请求：第一次仅看公共解析摘要，第二次临时打开三重门保护的本机脱敏诊断。两次均为 HTTP 200、`attemptedMode=llm`、`acceptedMode=rules`、`fallbackReasonCode=evidence_rejected`；第二次首个失败仍是 `/family` 缺 evidence。固定脚本只打印诊断枚举和 evidence 路径是否存在，未输出 Provider Draft、原文 quote 或密钥。
- Prompt v2.4 明确成人／儿童人数与优惠票表述不能自动推出亲子偏好，缺少明确表达时三个可选布尔偏好保持 `null`。相关定向离线测试和 typecheck 通过。
- v2.4 再做一次相同的固定真实 smoke，仍为 HTTP 200、`acceptedMode=rules`、`evidence_rejected`；脱敏首个失败仍是 `/family` 缺 evidence。诊断无法说明该值是 `true` 还是 `false`，也无法说明后续字段是否合格，因此停止继续调用，不宣称真实 LLM 解析已通过。
- 三次请求都只在本机 loopback BFF 发起；结束后停止 BFF，移除临时 `LLM_LOCAL_DIAGNOSTICS` 配置，并确认 8787 端口没有监听。没有修改线上 WorkBuddy 应用，也没有部署 BFF 或把密钥放到静态页面。
- 新增默认未接入页面的 BFF 浏览器客户端与 mock-fetch 回归，为后续显式同意入口做准备；未获本地真实接受验收前不展示用户开关或上线远程解析。另写 `22_OPTIONAL_ASSERTION_ELISION_PROPOSAL.md`，只设计可选的、默认关闭的无证据断言舍弃策略，尚未实现。
- 浏览器客户端独立复核并修正了正常规则回退、范围错误、NFKC 证据、起点／人数／时段、超时和取消的边界；客户端只发送三项既定请求字段，尚未从 `page.tsx` 调用。最终本地检查：237 个 Vitest 与 5 个 Node 测试、typecheck、lint、40 条 POI 快照校验通过；没有据此重建或发布静态站。

### 2026-09-16 无证据可选断言舍弃实验（仅本地、默认关闭）

- 经用户同意，只实现此前冻结的本地实验：首次 Schema 通过后，只有 `family === false`、没有任何 `/family` evidence、规则解析也为 `family=false` 且保守原文检查未发现已知亲子／儿童表述时，才在深拷贝中将该可选值改为 `null`。不新增、复制或删除 evidence，不修改原始 Provider Draft，不改其他字段。
- 改写后的 Draft 重新通过 Schema，再执行现有 Evidence Binding v1、绑定后 Schema、evidence、语义及规范化；任一步失败仍整次回退本地规则。实验开关 `LLM_OPTIONAL_ASSERTION_ELISION` 默认为关闭，仅在 `LLM_RUNTIME_ENV=local` 且请求主机为回环地址时有效；浏览器无法通过公开 Parse API 开启。
- 独立复核补充了“两大一小”、带娃、儿童年龄及英文 baby／infant／toddler 等保守拦截，并修复 elision 自身异常时的误导性诊断：现在安全回退，不伪报未执行的绑定失败。测试覆盖伪造／重复 `/family` 坐标、外地城市、4 天、非 AUD、未知硬地点、原 Draft 不变及只调用一次 mock Adapter。
- 离线验证：15 个 Vitest 文件、264 项测试和 5 项 Node POI 导入测试通过；typecheck、lint、相关代码格式检查和 40 条 POI 数据快照校验通过。未读取或修改私密配置，未调用真实 Provider、未接入前端、未构建或部署；不能据此宣称真实 LLM Draft 已获采纳。
- 模型路由：实现由 `gpt-5.6-luna / medium` 完成，独立复核与边界修复由 `gpt-5.6-terra / medium` 完成；主会话型号不可验证、保持不变，负责最终复验与文档同步。

### 2026-09-16 无证据可选断言舍弃实验：单次真实 smoke（未通过）

- 经用户单独批准，先用脱敏布尔预检确认百炼本地配置、免费额度确认门、既定 `qwen3.8-flash` 模型和密钥／业务空间存在；没有输出密钥值。第一次启动因受限环境无法写 Wrangler 日志及绑定 inspector 端口而失败，**未发送 Provider 请求**。随后关闭 Wrangler 落盘日志，仅为本机端口申请运行权限，并通过 CLI 临时注入实验／诊断开关，不修改 `.dev.vars`。
- 只发送一次既有固定旅行描述，没有自动重试。返回 HTTP 200、`decision=ready`、`attemptedMode=llm`、`promptVersion=nlu-extraction-system-v2.4`，但 `acceptedMode=rules`、`fallbackReasonCode=semantic_rejected`。唯一安全诊断的首个失败为 `semantic.evidence_not_proven`，路径 `/geography/scope`。
- 回退响应中的四个 evidence path 布尔值均为 `false`，这是整次规则回退不返回 LLM fieldEvidence 的结果，不能推断 Provider Draft 这四个字段都缺证据。此次也不能确定 Provider 的 `/family` 实际值或实验分支是否改写了它；仅能确认这次验证到达了后续语义门，真实 LLM 仍未被采纳。
- 测试后已停止本地 BFF，主会话独立确认 8787 和 9229 均无监听。未改密钥文件、未接入前端、未构建或部署、未更新 WorkBuddy。若继续诊断或再调用真实 API，必须另行决定范围与额度。
- 模型路由：本次有界 L1 smoke 由 `gpt-5.6-luna / low` 执行；主会话型号与 effort 不可验证、保持不变，独立核对安全诊断、端口关闭与发布边界。

### 2026-09-16 geography 语义证据契约修复（Prompt v2.5，仅本地）

- 对上次单次真实 smoke 的 `/geography/scope` 安全路径做独立只读审计：本地解析器会将“主要在市内”确定性映射为 `central_city_v1 / soft`；语义门会比较模型给出的 geography 值和两条 evidence quote 的本地解析结果。脱敏诊断不能揭示 Provider 实际填入的 scope 或 quote，因此无法确定其具体错误。
- 发现确定性的提示／示例契约缺口：运行时 Prompt 没有明确上述映射，示例 Draft 的 scope evidence 错绑在单独的“CBD”（它是起点片段），依赖跨字段拼接才通过。Prompt v2.5 明确 `originText` 与 `geography` 独立：“从 CBD 出发”只表示起点；“主要在市内”对应 `central_city_v1 / soft`，“只在CBD”对应 `cbd_core_v1 / hard`，两个 geography path 各自使用完整的同一连续 quote。示例 Draft 也改用完整“主要在市内”。
- 新增离线 mock Adapter 回归：正确 Draft 通过 Schema、原文证据、语义与编排验收，且只调用一次 mock Provider；错误地将起点 CBD 当成活动区域，或把“主要在市内”映射为默认内城范围，仍被语义门拒绝。未修改 Schema、Evidence Binding、语义校验器、规划器或公开 API，没有自动覆写模型字段／证据。
- 本地复验：15 个 Vitest 文件、267 项测试与 5 项 Node POI 导入测试通过；typecheck、lint、相关文件格式及 40 条 POI 数据快照校验通过。本轮未读取 `.dev.vars`，未调用真实 Provider、未启动 BFF、未接入前端、未构建或部署。v2.5 只能标记为离线实现，不能标记为真实 LLM 采纳通过。
- 模型路由：L3 独立根因审计由 `gpt-5.6-terra / medium` 完成；冻结范围内的 L2 提示与测试实现由 `gpt-5.6-luna / medium` 完成；主会话型号／effort 不可验证、保持不变，完成独立回归与文档复核。

### 2026-09-16 Prompt v2.5 单次真实 smoke（仍未通过）

- 经用户单独同意，脱敏预检确认既定 DashScope 本地配置、免费额度确认门、`qwen3.8-flash`、v2.5 Prompt 及密钥／业务空间存在；实验和诊断开关原本关闭。通过本机 CLI 临时开启，无持久私密配置改动；仅运行一次既有固定 smoke，没有重试。
- 返回 HTTP 200、`decision=ready`、`attemptedMode=llm`、`promptVersion=nlu-extraction-system-v2.5`，但 `acceptedMode=rules`、`fallbackReasonCode=semantic_rejected`。唯一安全诊断的首个失败为 `semantic.evidence_not_proven`，路径 `/mustIncludeNames`；Binding 为 `not_needed`。因此真实模型草稿仍未被产品采纳。
- 该语义门要求单条必去地点 evidence 同时包含可匹配的地点名称与明确“必去”意图。脱敏诊断不包含 Provider Draft、数组值或 quote，不能判断模型具体是名称、意图、quote 边界还是其他组合错误。回退响应中四个 evidence path 的 `false` 只表示未返回 LLM 证据，不能推断原始 Draft 缺失。
- 测试后停止本地 BFF；主会话独立确认 8787／9229 均无监听、实验／诊断开关未持久开启。未改代码、未部署 BFF、未接入前端、未更新 WorkBuddy。连续两轮真实 smoke 从 `/geography/scope` 转到 `/mustIncludeNames`，但单次差异不能证明旧字段在所有模型输出中稳定正确；不自动进入下一次 API 调用。
- 模型路由：本次 L1 单次执行由 `gpt-5.6-luna / low` 完成；主会话型号与 effort 不可验证、保持不变，独立复核安全结果与停止条件。

### 2026-09-16 Local NLU Diagnostics v2（仅本地、离线）

- 在已冻结的 v1 之外新增独立 v2 日志 Schema；仍是同一条本机单行诊断，默认关闭，沿用环境 flag、本地 runtime、回环请求主机三重门。v2 新增顶层 `mustIncludeCause`，仅当首个失败严格为 `semantic.evidence_not_proven /mustIncludeNames` 时输出固定类别：`opposite_only`、`intent_marker_absent`、`opposite_nearer_or_tied` 或 `unclassified`；其他结果为 `null`。
- 分类取现有语义门的首个失败地点，沿用相同的文本规范化、首次名称位置、意图关键词和距离比较；只解释失败，不改变模型草稿是否通过、规则回退或公开 Parse HTTP 响应。日志重建固定白名单，不写原文、quote、地点名、数组索引、Provider Draft 或凭据；分类异常与日志异常均安全降级。
- 独立复核发现 v2 JSON Schema 原本缺少原因类别与首失败之间的条件约束，以及专属测试缺口；现已补上条件约束和合成 mock Adapter／日志测试。全量离线回归：15 个 Vitest 文件、282 项测试和 5 项 Node POI 导入测试通过；typecheck、lint、相关代码格式与 40 条 POI 数据校验通过。
- 未读取或修改 `.dev.vars`，未调用真实 Provider、启动 BFF、接入前端、构建或部署。此前 Prompt v2.5 的真实回退不能被新诊断追溯，LLM 仍未通过采纳验收，线上继续 rules-only。
- 模型路由：契约由 `gpt-5.6-sol / ultra` 冻结，代码由 `gpt-5.6-luna / medium` 实现，`gpt-5.6-terra / medium` 做只读独立复核，新增测试由 `gpt-5.6-luna / medium` 完成；主会话实际型号／effort 不可验证、保持不变，负责全量复验和文档同步。

### 2026-09-16 固定八案真实 LLM 复验（仅本地）

- 经用户批准，固定最多八条不同旅行描述，新增显式 `--run` 的本机批量测试脚本；未将原始模型回复、用户文本或密钥写入测试报告。完整场景、条件和结果见 [`24_LOCAL_NLU_EIGHT_CASE_ACCEPTANCE.md`](24_LOCAL_NLU_EIGHT_CASE_ACCEPTANCE.md)。
- 初始 v2.5 对这八类均回退规则，脱敏首因分散在缺 evidence、语义不符与引文不在原文，不能归因于单句。Prompt v2.6–v2.7 加入通用的未提及值、范围外条件、逐字段 evidence 与意图边界；另为明确慢节奏改述增加有限证据判定及正反单元测试，没有放宽地点、天数、预算或范围硬校验。
- 最终在 DashScope `qwen3.8-flash`、Prompt v2.7、本机诊断及可选 `/family=false` 保守实验打开的条件下，**单次完整批次 7/8 真实采纳**；第八条因无据推断体验主题被安全拒绝并回退规则。迭代中同一文本曾出现不同首因，不能把一次 7/8 当作稳定通过率。线上仍 rules-only，未发布或部署 BFF。
- 模型路由：八案与证据契约的独立设计复核由 `gpt-5.6-sol / ultra` 只读完成；主会话型号和思考档位不可验证、保持原状，负责本地实现、真实验收及文档同步。
