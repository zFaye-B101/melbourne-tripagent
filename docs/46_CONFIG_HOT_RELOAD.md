# 46 · POI、规则与提示词的运行时配置热更新（2026-11-20）

状态：**本地实现、测试与构建通过；未发布**。这是 30 题 v1 冻结（45 号）之后的第二件事。

## 一、这次解决什么

以前改 POI、票价、规则参数或提示词都要重新构建前端。现在页面从静态站点的 `/runtime-config/` 读取一份带版本号的配置：

- 页面启动时拉一次；
- 之后每 30 秒、窗口重新获得焦点时检查 manifest；
- manifest 版本变了才重新拉全部文件；
- 任何一份核心文件缺失、格式不对或提示词太短，都保留当前配置，不回退到半份数据；
- 网络失败时继续用打包时的那份，行为和改造前一致。

“热更新”指换文件后下一次轮询/聚焦生效，**不需要重新构建前端**。WorkBuddy 静态发布仍需把新的 `runtime-config` 文件和 manifest 上传到站点；它不是服务端进程内重载。

## 二、哪些东西可以热更

| 配置 | 来源 | 说明 |
|---|---|---|
| POI 快照 | `site/data/melbourne-pois-v0.1.json` | 地点、别名、坐标、建议时长 |
| 门票快照 | `data/verified/poi-admission-price-v0.4.json` | 已核验门票与证据 |
| PTV 票价 | `site/data/ptv-fares-v0.4.json` | 交通票价与上限 |
| 出发准备 | `site/data/visitor-advice-v1.json` | 交通避坑、行李、购物、市场休市日 |
| 规则参数 | `site/config/rules.v1.json` | 闸门阈值、默认开始/结束、午餐时段、补充别名 |
| 提示词 | `site/config/prompt.v2.10.json` | 版本号与正文 |

**规则只外置可调参数。** 时间不重叠、跨天去重、必去/避开、确认门、预算披露、换点冻结、规划器失败保留旧结果等硬不变量仍由 `planner.ts` 代码保证，不能通过配置改掉。这样热更新不会把约束系统变成可远程重写的脚本。

## 三、文件与职责

新增：

- `site/config/rules.v1.json`：规则参数和补充别名。
- `site/config/prompt.v2.10.json`：提示词正文和版本号；BFF 与客户端共用同一份。
- `site/app/lib/runtime-config-state.ts`：当前配置、订阅、默认值；不 import planner，避免循环依赖。
- `site/app/lib/runtime-config.ts`：manifest/文件拉取、校验、整体应用与回退。
- `site/app/lib/runtime-config.test.ts`：应用、重置、版本不变跳过、坏提示词拒绝。
- 本文件。

修改：

- `planner.ts`：POI/门票/票价/出发准备快照改为可替换；别名索引重建；规则参数读取改为运行时值。
- `interpretation-tier.ts`：`minRecognizedFields` 从运行时配置读，缺省仍是 3。
- `trip-advice.ts`：出发准备快照可替换，`SOURCES` 随之更新。
- `cloud-llm-draft-adapter.ts`：每次调用使用当前提示词与版本号。
- `bff/provider-shared.ts`：提示词改为从 `config/prompt.v2.10.json` 读取，保留同一份打包回退。
- `page.tsx`：启动加载、30 秒轮询、聚焦刷新、配置版本展示；`poiById` 不再永久缓存。
- `featured-pois.tsx`：精选卡每次渲染按当前 `POIS` 重算，避免模块级快照过期。
- `vite.config.ts`：开发时从 `site/config` 和 `site/data` 直接服务 `/runtime-config/*`；构建时把同一批文件写进 `dist/client/runtime-config/`。
- `eval/baseline.eval.ts`：报告 meta 记录 `runtimeConfigVersion`；评测仍显式使用打包配置。
- `README.md`：补运行时配置入口。

## 四、文件布局与 manifest

构建产物：

```text
dist/client/runtime-config/
  manifest.json
  poi.json
  admission.json
  fares.json
  visitor-advice.json
  rules.json
  prompt.json
```

manifest 只放版本号：

```json
{ "version": "2026-11-20T05:01:36.725Z" }
```

版本号取参与配置的源文件里最新的修改时间。开发时改文件后 manifest 自动变化；部署时若上传工具保留旧 mtime，需要把 `manifest.json` 的 `version` 一起改成一个新值，客户端才会重新拉取。

客户端文件名固定，manifest 不接受任意路径，避免把配置请求变成任意文件读取。

## 五、校验与失败行为

- POI：必须有非空 `pois`、数据版本和来源字段；每个地点至少有 id、中英文名、别名和标签数组。
- 门票：必须有 `snapshotVersion`、`verifiedAt` 和记录数组。
- 票价：必须有 `policyVersion`、生效期和 `zone12.fullFare`。
- 出发准备：必须有 `sources`、`qvm.closedWeekdays`、版本与复核日期。
- 规则：数值逐项检查范围；不合法的一项回落到默认值，不让一个坏参数拖垮整份配置。
- 提示词：正文少于 200 字符直接拒绝，避免空提示词把模型调用变成乱答。
- 核心数据文件任一失败：整次加载失败，保留上一份配置；不会出现“POI 换了、票价没换”的半更新。

## 六、验证记录

- `npx vitest run app/lib/runtime-config.test.ts`：4 项通过（整体应用、重置、版本不变跳过、坏提示词拒绝）。
- `npm test`：Vitest 33 个文件、478 项全部通过（含新增 4 项运行时配置测试）；POI 导入 5 项、网关 40 项也通过。
- `npm run typecheck`：0 错误。
- `npm run lint`：0 warning / 0 error。
- `npm run build`：通过；`dist/client/runtime-config/` 生成 7 个文件，`prompt.json` 与 `prompt.v2.10.json` 内容一致；`release:validate` 通过（77 个文件、15.04 MiB）。
- 开发服务器烟测：`GET /runtime-config/manifest.json` 返回 200、`cache-control: no-store`；`touch` 规则文件后再次请求，manifest 版本从 `2026-11-20T04:57:08.907Z` 变为 `2026-11-20T05:01:36.725Z`，说明开发态会重新取文件。
- 30 题 v1 基线重跑：`supported 20/20`、`partial 核心 7/7`、`unsupported 核心 3/3`，硬检查 0 失败；报告里的 `runtimeConfigVersion` 是 `bundled`，因为评测不启动页面加载器。

## 七、边界与已知限制

- **BFF 提示词仍不是热更**：`site/bff` 没在线上主链；它读同一份 JSON 的打包值。若以后启用 BFF，需要把文件放进 KV/R2 或每次请求重读，不能把这里的静态文件当成服务端热更新。
- **已有行程不会自动重算**：配置版本变化后，页面用新配置处理下一次理解/生成；已经生成的行程仍显示它当时的数据版本。需要用户重新整理，避免在用户没确认时悄悄改掉行程。
- **删除 POI 的极端情况**：旧行程可能引用已删除的地点 id；页面会显示 id 或类别示意，不会伪造新地点。正式热更应先加后删，或同时清空旧行程。
- **配置文件没有独立的身份验证**：它和站点同源，信任边界与部署账号一致；不要让不可信第三方写这个目录。
- **提示词可见性不变**：云端通道在浏览器内组装提示词，热更后仍对访客可见；这不是新泄露，但也不能把提示词藏进前端。
- 规则热更不改变 `PLANNER_VERSION`；报告通过 `runtimeConfigVersion` 和 `POI_DATASET.dataVersion` 区分数据版本。

## 八、怎么用

开发：

```bash
cd site
npm run dev
# 改 site/config/rules.v1.json 或 site/config/prompt.v2.10.json
# 页面最多 30 秒后拉新版本；也可以切走再切回来触发 focus 检查
```

构建：

```bash
cd site
npm run build
# 把 dist/client/runtime-config/ 一起发布
```

只换线上配置、不重新构建：

1. 修改 `dist/client/runtime-config/` 下对应文件；
2. 把 `manifest.json` 的 `version` 改成新值；
3. 上传这些文件；页面下次轮询或聚焦时生效。

下一件 SSE 流式输出会复用这里的版本信息：流式事件里可以带上当前配置版本，避免页面把旧配置产生的结果当成新配置的结果。
