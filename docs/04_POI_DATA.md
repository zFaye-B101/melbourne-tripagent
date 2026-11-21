# 04. POI 数据方案

## 1. 目标

第一版不是建立“全墨尔本旅游数据库”，而是准备一份足以支撑演示、来源清晰、可以反复验证的 POI 快照。

- v0：12 条测试 POI，验证完整交互闭环。
- v0.1：从 242 行官方快照中精选 40 条已去重 POI，覆盖主要类别和内城区；保留 12 条 legacy ID，新增 28 条。
- v0.2：40–80 条经过质量检查的 POI，形成固定测试数据集。
- Australia 扩展只有在 Melbourne 闭环通过后再讨论。

## 2. 合规数据源

### City of Melbourne Open Data

用途：第一批地标、博物馆、剧院、公园等 POI 的名称、类别和坐标。

- 数据集：<https://data.melbourne.vic.gov.au/explore/dataset/landmarks-and-places-of-interest-including-schools-theatres-health-services-spor/>
- API：<https://data.melbourne.vic.gov.au/api-console/explore/v2.1/>
- 优点：官方、结构化、可导出、适合建立种子库。
- 限制：主要覆盖 City of Melbourne 市政辖区；字段较薄；不能用于保证实时营业时间或价格。

### OpenStreetMap / Overpass

用途：补充内城区覆盖、类别、网站、无障碍和可选开放时间标签。

- Overpass：<https://wiki.openstreetmap.org/wiki/Overpass_API>
- 署名：<https://osmfoundation.org/wiki/Licence/Attribution_Guidelines>
- 只做一次性、小规模离线导入并缓存结果。
- 不把公共 Overpass 实例当作用户请求时的实时后端。
- 地图上显示 `© OpenStreetMap contributors`，数据库文档保留 ODbL 信息。
- 不批量抓取 OpenStreetMap 地图瓦片。

### Wikimedia Commons

用途：为已确认 POI 补一张可复用图片，而不是发现 POI。

- API：<https://commons.wikimedia.org/wiki/Commons:API>
- 图片信息：<https://www.mediawiki.org/wiki/API:Imageinfo>
- 复用规则：<https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia>
- 每张图必须保存文件页、作者、许可证、许可证链接和修改说明。
- 没有明确许可信息的图片不进入最终展示层。

### ATDW（未来阶段）

用途：扩展到澳大利亚全国时评估。

- 指南：<https://support.atdw.com.au/en/articles/64809-developer-api-integration-guide>
- 它需要 Distributor API Key，并受分发许可、刷新和追踪要求约束。
- 不抓取 ATDW 网页；只有获得授权后才调用官方 API。
- 不作为学生 MVP 的永久依赖。

### 明确不抓取

- Visit Victoria / Visit Melbourne 的网页正文和图片。
- 商业地图、点评、社交媒体的受限页面。
- 需要登录、绕过验证码或规避反爬限制的内容。
- 无法确认版权和使用条件的图片。

Visit Victoria 的法律声明将 content scraping 列为不可接受使用：<https://corporate.visitvictoria.com/legal-notices>

## 3. 数据分层

```text
官方 API／开放数据导出
          ↓
raw：保存原始响应，不覆盖
          ↓
versioned curation manifest：冻结 40 条选择、ID、别名和产品标注
          ↓
normalized：统一字段、格式和名称
          ↓
verified：达到规划准入条件的事实快照
          ↓
planner adapter：转换为页面规划器 DTO
```

`inference` 不是独立输出层，而是 canonical/normalized 记录中的独立字段组；它保存产品标注和 AI 推断，不能冒充外部事实。

### Raw

当前 raw 快照为 242 行。数据集只直接提供静态英文名称、主题、子主题和坐标；营业时间、价格、临时关闭、拥挤程度等动态信息均为 unknown。

保留：

- `source_name`
- `source_url` 或 API endpoint
- `source_record_id`
- `retrieved_at`
- 请求参数
- `license`
- 原始 payload
- payload hash

Raw 记录只追加，不人工改写，以便复现清洗过程。

### Normalized

执行：

- 名称、地址、坐标和类别标准化。
- 英文名、中文名和别名分开保存。
- 价格区分 free、fixed、from、range 和 unknown。
- 营业时间保留原文，并在能可靠解析时添加结构化值。
- 每个关键字段保存自己的来源，不只给整条 POI 一个来源。

### Verified

`verified_core` 只表示名称、坐标、来源等静态核心字段通过导入核验，不表示景点当前开放、价格有效或没有临时闭馆。

状态：

- `unverified`
- `partially_verified`
- `verified_core`
- `conflicted`
- `stale`
- `temporarily_closed`

最低准入条件：

1. 名称和坐标有效。
2. 位于当前支持区域。
3. 至少一个可追溯来源。
4. 没有明确的永久关闭证据。
5. 动态字段缺失时明确为 unknown，而非自动补齐。

### Inference

以下内容可以由 AI 推断，但不得冒充外部事实：

- 兴趣标签。
- 雨天友好度。
- 建议停留时间。
- 适合慢节奏／亲子等推荐标签。
- 中文摘要和推荐理由。

记录 `model`、`prompt_version`、`generated_at`、`evidence_fields`、`confidence` 和 `review_status`。

## 4. 去重策略

依次使用：

1. 同一来源的稳定 ID。
2. 规范化英文名完全相同且坐标相距小于阈值。
3. 官方 URL 相同。
4. 名称近似、类别一致且坐标邻近，进入人工复核队列。

不能仅因中文译名相同就自动合并。

## 5. 事实冲突

多个来源冲突时，不静默覆盖。为关键字段保存 assertion：

```json
{
  "field": "opening_hours_text",
  "value": "source supplied value",
  "source_url": "https://example.org/official-page",
  "retrieved_at": "2026-09-14T00:00:00Z",
  "authority": "official",
  "status": "current"
}
```

处理优先级：

1. POI 官方网站或官方开放数据。
2. 受许可的旅游数据库。
3. OpenStreetMap 等社区来源。
4. AI 推断不能参与事实冲突裁决。

仍无法判断时标记 `conflicted`，规划器不能宣称该字段已核实。

## 6. 动态字段策略

- 营业时间、价格、预约和临时关闭都保存抓取／核验日期。
- 没有具体旅行日期时，开放状态一律 `not_verifiable`。
- 有日期但数据过期时，展示 `stale` 并建议出发前访问官网。
- 价格缺失时不把 `0` 当作免费。
- 费用字段覆盖不完整时，预算检查结果不能显示 Pass。

## 7. 首批覆盖类别

至少覆盖：

- 地标与城市景观
- 博物馆、画廊与文化
- 公园与花园
- 咖啡和餐饮体验
- 市场和街区漫步
- 亲子与室内活动
- 体育与公共空间

区域以 CBD、Carlton、Southbank、Docklands、Parkville、East Melbourne 等内城区为先。St Kilda、Brighton、Great Ocean Road 等在范围和交通能力明确后再加入。

## 8. 导入验收

- 每条 POI 都能由 `poi_id` 反查到数据记录。
- 名称、坐标、类别和来源字段不得为空。
- 坐标位于支持范围内。
- 无许可证图片不得展示。
- 重复候选进入报告，不能静默删除。
- 采集失败和字段缺失进入日志。
- 导入过程可重复运行，并得到确定的新增、更新、冲突和跳过统计。
- 固定输出：`data/normalized/poi-import-v1.json`、`data/verified/poi-import-v1.json`、`data/reports/poi-import-v1.json`、`site/data/melbourne-pois-v0.1.json`。
- 从 `site/` 运行 `npm run data:import`、`npm run data:validate` 和 `npm run data:test`。
