# Melbourne TripAgent v0.4 本地体验、费用与解析设计契约

状态：`IMPLEMENTED — LOCALLY TESTED`  
日期：2026-09-15  
交付边界：只修改和验证本地版本，不上传、不覆盖线上版本、不调用任何部署流程。

票价、PTV 费率、免费 NLU API 与参考站实测证据见 [`12_PRICE_TRANSIT_AND_NLU_RESEARCH.md`](./12_PRICE_TRANSIT_AND_NLU_RESEARCH.md)。票价、PTV 和本地规则部分已经实施；外部 NLU、BFF、API Key 与线上发布仍未实施。

## 1. 现状结论

- 当前首页预填示例文本；尚未生成时没有帮助用户认识墨尔本景点的入口。
- 当前“换一个”会直接选中内部排序的下一项，用户看不到全部候选。
- 输入“墨尔本玩 2 天，轻松节奏，喜欢历史和花园”时，`relaxed` 每天固定选择 2 个地点，却没有下午覆盖或最早结束要求，因此第二天可能在午餐后就结束。
- 当前运行数据中 40 个 POI 的 `priceStatus` 仍全部为 `not_verified`；现已完成官方来源的独立票价核验，但尚未导入运行数据。核验结果包含免费、固定价、起价、区间、活动依赖和未知，后两类绝不能作为 A$0。
- PTV 当前存在 2026-06-01 至 2027-01-01 的临时半价政策。该政策必须作为有有效期的版本化快照按旅行日期使用，不能写死为永久价格。
- 参考站公开接口采用 LLM／规则解析与确定性规划分层，但固定墨尔本用例实测仍丢失 CBD、11:00 和目的地并返回空行程；`source = llm` 不能作为理解正确的证据。
- 当前 POI 数据没有图片；仅概览天际线是本地许可图片。热门卡只能使用另行核验并本地保存的图片。
- 现行代码和测试使用 09:30–17:30；本轮保留 09:30 默认开始和 17:30 固定结束，并新增可执行的自定义开始时间，不沿用旧文档中的 09:00–20:00。

## 2. 目标与非目标

### 目标

1. 初始无结果状态直接提供可横向浏览的墨尔本热门景点卡片。
2. 卡片展示真实照片、分类、短介绍以及 `默认 / 必去 / 避开` 三态选择。
3. 卡片选择真正进入确定性规划器的硬约束。
4. 每个完整旅行日都具有下午活动，不再把上午半日误认为全天计划。
5. 增加诚实的总预算、官方门票快照区间与 PTV 市内交通预留上限展示。
6. 压缩准备情况、页面行距和区块间距，提高单屏信息密度。
7. “换一个”先展示全部可行候选，确认后才原子替换。
8. 补齐自然语言与快速设置分类，真正支持户外偏好、中央城区偏好、CBD 起点和每日开始时间。
9. 生成前展示结构化解析摘要，让用户能核对 Melbourne、天数、CBD、11:00、户外和区域偏好。
10. 为后续免费 NLU API 实验冻结供应商无关的 BFF、校验与整次规则回退边界。

### 非目标

- 不接实时票价；本轮只使用带来源、核验时间和失效规则的离线官方价格快照。营业时间、天气、客流、导航、订票或支付仍不接入。
- 不按未知价格筛选或排序，不把“已覆盖费用未超出”改写为“整趟预算充足”。
- “热门”只是编辑精选，不代表实时热度或客流排名。
- 不扩展到其他城市。v0.4 本地工作包不接真实 LLM、不添加账号或持久化；NLU API 属于必须另行批准的联网实验工作包。
- 不把餐饮、机场接驳、出租车、网约车、停车、租车或区域交通计入“完整旅行总价”。
- 不热链第三方图片，不使用缺少作者或许可证的图片。
- 不修改 hosting 配置，不生成或上传 WorkBuddy 发布版本。

## 3. 信息架构

初始状态：

```text
品牌栏
紧凑需求输入
  ├─ 自然语言输入
  ├─ 快速设置：天数／开始时间／起点／区域／室内外／节奏／兴趣
  ├─ 参考总预算 AUD（可选）／价格档案（默认明确显示 1 名全价成人）
  ├─ 示例需求
  └─ 生成行程
热门景点
  ├─ 编辑精选提示
  ├─ 横向轮播
  └─ 已选择的必去／避开摘要
```

生成后：

```text
紧凑行程概览 + 解析摘要 + 门票区间／PTV 交通预留／预算额度
单行准备情况
吸顶 Day 导航
连续 Day 时间线
折叠：完整检查与来源
```

“无结果状态”以 `result === null` 为准。用户输入文字、选择卡片、补充天数或生成失败时仍显示热门卡；首次成功生成后才切换到结果视图。首页输入初始值为空，示例只放在 placeholder 和建议按钮中。

## 4. 请求分类与快速设置

自然语言输入继续保留，但不能再是设置行程的唯一入口。首页增加紧凑的“快速设置”，所有结构化设置独立保存，不改写用户原文。

常显选项：

- 天数：`1 天 / 2 天 / 3 天`；
- 每日开始：`09:30 / 10:00 / 11:00 / 自定义`；
- 起点：`CBD 参考点 / 当前 40 POI 中的一个地点`；
- 活动区域：`中央城区优先 / 全部支持区域`；
- 场所环境：`户外优先 / 无偏好 / 室内优先`；
- 节奏：`轻松 / 均衡 / 紧凑`；
- 兴趣：`艺术文化 / 历史建筑 / 公园自然 / 城市地标 / 市场美食 / 亲子`。

每个兴趣分类采用 `多安排 / 无偏好 / 少安排` 三态；“少安排”是软负向偏好，不等于硬排除。当前数据只有 1 个“市场美食”地点，界面必须注明该分类候选较少，不能暗示覆盖充分。

更多设置保留：少走路、日期、参考预算、计价旅客与交通介质，以及热门卡的 `默认 / 必去 / 避开`。

计价旅客采用可见默认值，不能静默假设：

- 全价成人数量：默认 1；
- 已自行确认资格的优惠票数量：默认 0；
- 儿童年龄：可选数组，因为各场馆的儿童年龄分段不同；
- PTV 支付介质：`contactless / 已有 myki / 新购实体 myki`，默认 `contactless`。

输入区或概览始终显示：`门票：1 位成人 · PTV：1 位全票乘客 · contactless`。优惠资格由用户自行确认，系统不能从“学生”“游客”“长者”等词自动推定。

当前不提供看似可以执行、实际没有数据支持的“实时少拥挤”“指定公交线路”“无障碍保证”等选项；相关要求只能记录为待确认或澄清。

### 请求结构 v2

```ts
type PreferenceState = 'prefer' | 'neutral' | 'avoid';
type FieldSource = 'structured' | 'text' | 'legacy_v1' | 'default';
type VenuePreference = 'outdoor' | 'neutral' | 'indoor';
type GeoScope = 'cbd_core_v1' | 'central_city_v1' | 'supported_inner_city';

interface ResolvedOrigin {
  kind: 'poi' | 'preset_proxy';
  refId: string;
  label: string;
  latitude: number;
  longitude: number;
  resolution: 'exact_poi' | 'area_proxy' | 'default_proxy';
  source: FieldSource;
  evidence: string | null;
}

interface DailyWindow {
  startMinutes: number;
  endMinutes: number;
  startSource: FieldSource;
  endSource: 'default';
  evidence: string | null;
}

interface ParsedTripRequestV2 {
  requestVersion: 'parsed-trip-request-v2';
  origin: ResolvedOrigin;
  dailyWindow: DailyWindow;
  geography: {
    scope: GeoScope;
    strength: 'soft' | 'hard';
    zoneVersion: 'mel-central-zones-v1';
    source: FieldSource;
    evidence: string | null;
  };
  venuePreference: {
    value: VenuePreference;
    source: FieldSource;
    evidence: string | null;
  };
  categoryPreferences: Record<PoiCategory, PreferenceState>;
  lowWalking: boolean | null;
  family: boolean | null;
  avoidCrowds: boolean | null;
  pricingParty: {
    adultFullFareCount: number;
    concessionEligibleCount: number;
    childAges: number[];
    ptvPaymentMedium: 'contactless' | 'existing_myki' | 'new_physical_myki';
    source: 'visible_default_one_adult' | 'user_selected';
  };
}
```

`categoryPreferences` 成为分类偏好的唯一事实源；旧 `interests` 只作为兼容派生值。`venuePreference` 取代单一的 `preferIndoor`，从而区分“户外优先”和“没有表达室内外偏好”。未表达的偏好保留为 `null` 或 `neutral`，不能静默写成 `false`。

### 解析优先级与中文词表

文本先执行 Unicode NFKC 规范化并保留字段对应的原文证据。优先级为：明确纠正句式 → 起点与时间上下文 → 否定／无偏好 → 硬范围 → 软范围与环境偏好 → 具体 POI 最长别名 → 通用兴趣 → 默认值。

- 起点：`从…出发`、`出发点在/是…`、`起点在/是…`、`住在…`、`住宿在…`；
- CBD 起点别名：`cbd`、`市中心`、`墨尔本市中心`；
- 开始时间：`早上/上午 11 点出门`、`11:00 出发`、`十一点开始`、`11 点半开逛`；
- 户外：`喜欢/偏好/优先/多安排 + 户外|室外|露天`；
- 室内：相同偏好词加 `室内|室内场馆`；
- 无偏好：`室内外都可以/都行/无所谓`；
- 软地理：`主要在/以…为主/尽量在/优先在 + 市内|市区|市中心`；
- 硬地理：`只在/仅限/不要离开/不能超出 + CBD|市区`。

`花园/公园`只增加自然兴趣；没有“户外/室外”证据时不自动推断户外偏好。结构化非默认设置与文字冲突时阻止生成，并让用户选择“采用快速设置”或“采用文字”；默认值不构成冲突。同一字段存在多个不一致文本且没有“不是 X，是 Y／改成 Y”等明确纠正时必须澄清。

固定示例：

> 墨尔本 3天 主要在市内，喜欢室外。出发点在cbd。早上11点出门

必须解析为：Melbourne、3 天、`central_city_v1` 软偏好、`outdoor`、CBD 代理起点、每天 11:00–17:30、默认均衡节奏。

## 5. 热门景点卡

本轮目标为 10 张编辑精选卡片；每个 `poiId` 必须属于当前 40 POI 快照，所有卡片都可通过轮播访问。若某张图片许可信息不完整，移除该卡并换成另一条合规 POI，不用占位图冒充真实地点照片。

每张卡只展示：

- 4:3 本地照片；
- 中文名称，英文名为次要信息；
- 现有分类；
- 不超过两行的极短介绍；
- 图片作者和许可证短署名；
- `默认 / 必去 / 避开` 三段式选择。

标题旁固定显示：`编辑精选 · 不代表实时热度`。

### 图片数据结构

```ts
interface FeaturedPoiMedia {
  poiId: string;
  imageSrc: string;
  alt: string;
  sourcePageUrl: string;
  author: string;
  license: string;
  licenseUrl: string;
  attribution: string;
  verifiedAt: string;
  modification: string;
  editorialOrder: number;
}
```

原图保存在数据区，网页衍生图保存在 `site/public/poi/`。运行时单图失败时只降级该卡为类别占位，不影响其他卡片和选择操作。

## 6. 三态选择

```ts
type PoiPreferenceState = 'default' | 'must' | 'avoid';
```

- 每个 POI 同时只能有一个状态。
- `default` 不添加约束；`must` 进入 `mustIncludePoiIds`；`avoid` 进入 `excludePoiIds`。
- 三态切换必须原子完成，不留下旧状态。
- 卡片状态不改写用户原文；生成时与文本解析结果合并并去重。
- 若卡片和文本对同一 POI 给出相反约束，阻止生成并点名冲突，不静默覆盖。
- 澄清、解析失败和排程失败均保留卡片选择；成功结果在概览中展示有效的必去／避开地点。
- 控件采用单选组语义，状态不能只依赖颜色，必须同时有文字和图标。

## 7. 轮播与动效

- 复用现有 Carousel／Embla，支持触控拖动、触控板、左右按钮和键盘方向键。
- 移动端卡片约为 `78vw` 并露出下一张；桌面同时显示约 3 张。
- 平移动画约 240ms、ease-out，不使用翻转、强缩放或视差。
- 无交互时每 5.5 秒前进一张并循环；提供可见的播放／暂停按钮。
- hover、focus-within、拖动、页面不可见时暂停。
- 用户改变任一卡片状态后，本次页面会话永久停止自动轮播。
- 自动轮播不移动键盘焦点，不逐张触发屏幕阅读器播报。
- `prefers-reduced-motion: reduce` 下不自动轮播，滚动近乎即时。

## 8. 票价、交通与预算 MVP

### 8.1 版本化 POI 票价快照

现有 POI 主 Schema 和 `poi-import-v1` 不原地破坏。批准实施后新增独立 sidecar：

- `data/poi-admission-price-v0.4.schema.json`；
- `data/verified/poi-admission-price-v0.4.json`。

完整 40 条核验表见 [`12_PRICE_TRANSIT_AND_NLU_RESEARCH.md`](./12_PRICE_TRANSIT_AND_NLU_RESEARCH.md)。运行时只通过 `poiId` 与当前 40 POI 快照连接。

```ts
type AdmissionBasis =
  | 'free_general_entry'
  | 'not_ticketed_public_space'
  | 'paid_fixed'
  | 'paid_from'
  | 'paid_range'
  | 'event_dependent'
  | 'unknown';

type PriceVerificationStatus =
  | 'verified_current'
  | 'verified_time_bounded'
  | 'review_due'
  | 'stale'
  | 'conflicted'
  | 'unknown';

interface TicketTier {
  ticketType: 'adult' | 'child' | 'concession';
  minCents: number | null;
  maxCents: number | null;
  eligibilityText: string | null;
}

interface PriceEvidence {
  sourceUrl: string;
  sourceTitle: string;
  authority: 'official';
  retrievedAt: string;
  effectiveFrom: string | null;
  effectiveUntil: string | null;
  reviewAfter: string;
}

interface PoiAdmissionPriceSnapshot {
  poiId: string;
  currency: 'AUD' | null;
  basis: AdmissionBasis;
  tiers: TicketTier[];
  displayText: string;
  inclusions: string[];
  exclusions: string[];
  bookingRequired: boolean | null;
  verificationStatus: PriceVerificationStatus;
  evidence: PriceEvidence[];
}
```

数值不变量：

- `free_general_entry`、`not_ticketed_public_space` 的基础门票为 `[0, 0]`，但付费特展、导览和活动必须放入 `exclusions`；
- `paid_fixed = [x, x]`；`paid_range = [min, max]`；`paid_from = [min, null]`；
- `event_dependent`、`unknown`、`stale`、`conflicted` 为 `[null, null]`，绝不能转换成 A$0；
- `retrievedAt` 只表示核验时间，不等于永久有效；超过 `effectiveUntil` 或 `reviewAfter` 后自动降级；
- 来源未公布有效期时，数值、起价、区间和常规免费入场的默认 `reviewAfter` 为核验后 30 天，明确不售票的公共空间为 90 天；这是产品复核阈值，不冒充官方有效期；
- 免费基础入场与额外付费体验必须能同时表达，例如 Shrine 免费入场但导览收费；
- MCG Tour 等可选体验只有用户明确选择时才计费，不能因浏览 POI 外部空间而自动加入。

### 8.2 PTV 交通费率快照

截至 2026-09-15，2026-06-01 至 2027-01-01 执行临时半价：

| 票种 | Zone 1+2 两小时 | 工作日每日上限 | 周末／公共假日每日上限 |
|---|---:|---:|---:|
| 全票 | A$2.85 | A$5.70 | A$4.00 |
| 优惠票 | A$1.42 | A$2.85 | A$2.00 |

费率必须保存为独立、带 `effectiveFrom / effectiveUntil / verifiedAt / sourceUrl` 的版本化快照，不散落在 UI 文案或规划器常量中。

当前没有真实路线，交通预算采用以下保守算法：

1. 当日所有路段都明确步行时，交通预留为 A$0。
2. 只有未来真实路线证据证明所有公共交通路段均为 tram，且实际起点和终点都在 Free Tram Zone 内时，才允许把当日交通写为 A$0。
3. 当前仅凭直线距离、CBD 标签或 POI 坐标无法证明免费区路线；只要有一个可能乘车的路段，就按 Zone 1+2 当日封顶计算预留上限。
4. 有日期时区分工作日与周末；只有能由本地官方假日表确认时才使用公共假日上限。没有日期时采用更高的工作日上限并披露这一保守假设。
5. 全日不尝试用两小时票价优化，也不按每段重复累加；混合旅客分别乘以对应全票／优惠票上限。
6. 实体 myki 卡费全价 A$6、优惠 A$3，只有选择 `new_physical_myki` 时才作为一次性准备费用加入；contactless 或已有／Mobile myki 不加卡费。
7. SkyBus、其他机场接驳、渡轮、出租车、网约车、停车、租车和区域交通均为 `excluded_or_unknown`，不混入 metropolitan daily cap。
8. 旅行日期位于 2027-01-01 及之后时停止使用本快照，要求刷新官方票价。

页面固定使用“PTV 交通预留上限”“按日封顶预留，非精确路线票价”，不使用“精确交通费”。

### 8.3 预算输出

首页保留 `参考总预算（AUD，可选）`，允许非负值并使用整数 cents；总预算表示当前显式旅客组的整趟额度。

```ts
interface MoneyRange {
  minCents: number | null;
  maxCents: number | null;
}

interface CostCoverage {
  admission: 'complete' | 'partial' | 'none';
  transit:
    | 'daily_cap_allowance'
    | 'ftz_confirmed_zero'
    | 'walking_only_zero'
    | 'unknown';
  unknownItems: string[];
  excludedItems: string[];
}

interface BudgetEnvelopeV2 {
  currency: 'AUD';
  totalLimitCents: number | null;
  pricingParty: ParsedTripRequestV2['pricingParty'];
  admissionRange: MoneyRange;
  transitRange: MoneyRange;
  mykiSetupRange: MoneyRange;
  knownComponentsRange: MoneyRange;
  totalRange: MoneyRange;
  coverage: CostCoverage;
  comparison:
    | 'known_min_exceeds_limit'
    | 'known_components_within_limit'
    | 'indeterminate'
    | null;
  policyVersions: string[];
  verifiedAt: string;
}
```

计算规则：

- 门票最低值合计免费／固定／区间下限／起价；只有所选 POI 的当前旅客票种全部有可信上界时，最高值才是数字，否则为 `null`。
- 缺少某个儿童年龄段或优惠票价时，该 POI 对当前旅客组为未知；不套用成人价，也不写 A$0。
- 交通最低值在无真实路线时为 A$0，最高值按每个可能乘车日的当日封顶累加。
- `knownComponentsRange` 只合并当前已覆盖的门票、交通和可选 myki 卡费；餐饮、活动依赖项目和机场成本进入未知／排除清单。
- 只有 `knownComponentsRange.min > totalLimit` 时，才可显示“即使按已知最低费用也会超出预算”。
- `known_components_within_limit` 只表示已覆盖项目没有超过额度，不能改写为“预算充足”。只有所有纳入范围的费用都具备上界时，`totalRange.max` 才可存在。
- 当前餐饮仍未知，所以整趟通常显示“已知费用未超出，但仍有 N 项待确认”。
- 如果已知上界存在，可显示扣除它后的剩余额度；必须紧邻显示未知项目。上界为 `null` 时不计算剩余。
- 预算继续不影响选点、候选排序或规划成功／失败；明确的整趟硬预算仍先澄清，因为系统没有覆盖全部旅行成本。

文案示例：

> 当前按 1 名全价成人估算 · 已核实门票 A$0–A$38 · PTV 交通最多预留 A$5.70 · 另有 1 项活动票价待确认  
> 不含餐饮、机场接驳及未选择的付费体验

## 9. 起点、活动区域与每日时间

### CBD 起点

- `CBD` 是模糊区域，不是假装精确的酒店坐标；统一映射到当前 POI 快照中的弗林德斯街车站坐标 `-37.8179063007545, 144.967064817875`。
- 页面必须显示：`CBD 参考起点（以弗林德斯街车站坐标估算）`。
- 用户明确写 CBD 时记录为 `area_proxy`；没有提供起点而采用默认时记录为 `default_proxy`。两者坐标可相同，但来源和解释不能混淆。
- 每一天都从该起点出发。每日开始时间表示“离开起点”的时间，首个 POI 的开始时间为出发时间加首段交通时间。
- 首段继续使用直线距离估算，明确标注“不是导航”，并计入总距离、时间和少走路检查。
- 精确支持当前 40 POI 的名称和别名作为起点。
- 不支持白名单外酒店、街道地址、其他城区、经纬度和每天不同起点；这些情况必须澄清，不静默回退 CBD，也不调用地理编码。

### “主要在市内”

“主要在市内”不等于“只在 CBD”，也不冒充法定市界。它映射为版本化软偏好 `central_city_v1`：CBD、North CBD、Federation Square、Southbank、Arts Precinct、雅拉河畔与 East Melbourne。

- 软目标：全程位于 `central_city_v1` 的 POI 严格过半；未达到时仍可生成，但显示 `与市内优先偏好有差距（x/y）`。
- `只在／仅限／不能离开 CBD` 才映射为 `cbd_core_v1 + hard` 并执行硬过滤。
- 硬范围与必去地点冲突时先澄清，不删除必去地点或偷偷放宽范围。
- `supported_inner_city` 表示当前 40 POI 的完整产品支持范围。

### 每日开始与结束

- 未指定开始时间：每天 09:30 离开起点。
- `早上 11 点出门`：每天严格 11:00 离开起点。
- 结束时间本轮固定为 17:30，不因晚出发自动顺延。
- 自定义开始时间限 08:00–13:00、15 分钟步进；超出范围不截断，要求用户调整。
- 显式自定义结束时间、逐日不同起点或逐日不同时间暂不支持，检测到后澄清。
- 11:00 出发会缩短可用时间并可能减少地点数；系统必须在概览中明确，不得偷偷延长一天。

## 10. 日程填充规则

### 午餐

- 当日窗口覆盖午餐时，插入恰好 55 分钟午餐，开始于 12:00–14:00。
- 午餐不与首段交通、POI 或地点间交通重叠；下午 POI 不得早于午餐结束。
- 午餐不是 POI，不计入地点数量，也不能单独把 `finishTime` 推迟来通过覆盖检查。
- `finishTime` 取最后一个真实 POI 的结束时间。

### 节奏策略

| 节奏 | 每日 POI 数量 | 最后一项 POI 的覆盖阈值 | 默认 17:30 时 | 下午覆盖 |
|---|---:|---:|---:|---|
| relaxed | 2–3 | `end − 150 分钟` | 15:00 | 至少 1 个 POI 在午餐后开始 |
| balanced | 3–4 | `end − 90 分钟` | 16:00 | 至少 1 个 POI 在午餐后开始 |
| packed | 4 | `end − 60 分钟` | 16:30 | 至少 1 个 POI 在午餐后开始 |

时间窗口是硬约束，节奏是软偏好。显式节奏无法满足时询问是否放宽；默认 balanced 无法满足时可以确定性降为 relaxed，但必须同时保存并展示 `requestedPace / effectivePace`，不能静默降级。连 relaxed 的两个 POI 都无法合法排入时返回 `insufficient_data`。

数量、覆盖阈值和下午活动必须同时满足：先计算起点首段、放置必去地点并选择主区域；按稳定排序满足最小地点数；未满足时间或下午覆盖时继续尝试候选，最多 4 个；仍不满足时再有限尝试其他稳定候选或调序。任何一天仍不满足则整次失败，不提交半日、空白日或部分结果。

固定回归一：

> 墨尔本玩 2 天，轻松节奏，喜欢历史和花园

两个 Day 都必须为 2–3 个 POI，至少一个午餐后 POI，最后 POI 不早于 15:00 结束，且无重复、无重叠和硬约束失败。

固定回归二：

> 墨尔本 3天 主要在市内，喜欢室外。出发点在cbd。早上11点出门

三个 Day 都必须在 11:00 后从披露的 CBD 代理点出发；首个地点不得早于首段交通结束；中央城区地点严格过半或显示软偏好差距；户外地点在其他条件相同时稳定优先；所有活动仍在 17:30 前结束。

## 11. TripRequestDraft 兼容方案

- 保留现有 `TripRequestDraft v1` 文件和测试，不原地增加字段，因为其 Schema 已禁止额外字段，且把 `origin`、`daily_window` 视为未处理要求。
- 后续真实 LLM 接入时新增独立 `TripRequestDraft v2`，默认产出 v2；本轮本地规则解析器直接规范化为 `ParsedTripRequest v2`。
- v1 通过显式 adapter 升级：旧兴趣映射为对应分类 `prefer`；`preferIndoor=true` 映射为 `indoor`；`false/null` 映射为 `neutral`，不得反推 outdoor。
- v1 中的 origin／daily window 原文只有在确定性规则可以完整解析时才升级，否则继续澄清。
- 不把 v1、v2、LLM 与规则解析结果的部分字段拼接；失败降级仍是整次请求切换。

### 11.1 联网 NLU 实验与参考站边界

参考站公开可观察到的是“网页调用同源 `/v1/parse` 或 `/v1/plan`，服务端在 LLM 与规则解析之间选择，再返回规划结果”。公开页面无法确认其模型供应商、密钥、免费额度或服务端环境变量，本项目不能声称复制了这些隐藏配置。

固定墨尔本用例在参考站实测时虽然返回 `parse_source = llm`，却丢失 Melbourne、CBD 与 11:00，并返回空行程及币种不一致。因此本项目必须区分“尝试了 LLM”和“最终通过校验并被采纳”：

```ts
interface ParserDiagnostics {
  attemptedMode: 'llm' | 'rules';
  acceptedMode: 'llm' | 'rules' | 'none';
  fallbackReason: string | null;
  schemaVersion: string;
  promptVersion: string | null;
}

interface NluProvider {
  parse(
    text: string,
    options: { signal: AbortSignal; locale: 'zh-CN' }
  ): Promise<unknown>;
}
```

建议架构：

```text
浏览器
  → POST /v1/trip-requests/parse
  → BFF / NLU Provider Adapter
  → TripRequestDraft v2 JSON Schema
  → evidence、枚举、POI 白名单与硬约束语义校验
  → ParsedTripRequest v2
  → 浏览器内确定性 planTrip()
```

服务端仅通过 secret／环境变量配置：`NLU_ENABLED`、`NLU_PROVIDER`、`NLU_MODEL`、`NLU_BASE_URL`、`NLU_API_KEY`、`NLU_TIMEOUT_MS`。Key 禁止进入浏览器代码、静态包、请求响应、日志、Git 或聊天内容。

解析规则：

- LLM 只抽取结构化需求，不产生 POI 坐标、内部 ID、票价、路线、顺序或预算结论；
- 输出先过 JSON Schema，再过语义校验；`evidence.quote` 必须可在规范化原文中定位；
- 本地锚点守卫先标记城市、天数、起点、开始时间、必去／避开及否定词；LLM 漏掉任何明确锚点时整份拒绝；
- HTTP 成功或 `source = llm` 都不等于解析成功；只有结构与语义同时通过才能 `acceptedMode = llm`；
- 超时、429、5xx、非法 JSON、Schema 或语义失败时，最多修复重试一次，然后整次切换规则解析；绝不把两者部分字段拼接；
- 规则仍无法确定时返回澄清，禁止生成错误城市或空白 Day；
- 连续 API 异常时本次会话可关闭 LLM 通道，保留本地规则和上一份成功行程；
- 生成前显示结构化解析摘要，用户可通过快速设置纠正。

供应商候选只在运行时通过 Provider Adapter 配置，不写死到前端：

1. 首选实验候选：智谱 `GLM-4-Flash-250414`，官方标注免费、OpenAI-compatible 并支持 JSON 输出；
2. 开发备选：OpenRouter free，仅作可替换测试项，不作为稳定验收唯一依赖；
3. Cloudflare Workers AI：更适合未来 Worker／BFF 部署，但中国网络仍需实测；
4. Gemini：官方可用区域未列中国大陆，不作为中国验收主路径；
5. 免费额度、模型名、JSON 能力或连通性变化时只改服务端配置，不改前端契约。

NLU 是独立的联网工作包。v0.4 本地实现获批并不自动授权创建账号、接收 API Key、发起外部模型请求、建立后端或上传线上版本。

## 12. “换一个”候选弹窗

点击“换一个”只打开 Dialog，不立即修改行程。

弹窗包含：

- `替换「当前地点」`；
- `其他日期和当天其他地点保持不变`；
- `全部可替换选项（N）`；
- 不分页、不循环隐藏的全量可行候选；
- 每项显示名称、分类、区域、建议停留时间、替换后时间段、当天结束时间、地点间距离，以及已核实的基础门票状态。固定／区间价格显示来源快照；活动依赖、未知或过期时显示 `票价需按日期／活动确认`。营业时间仍统一为出发前确认。

固定内部排序为：同类别 → 同区域 → 用户偏好分数 → 稳定 ID；不显示内部评分或“匹配率”。候选必须先完整预演并满足时间窗、pace 覆盖、去重、必去／避开和其他硬检查。

规划器改为两步接口：

```ts
listReplacementOptions(result, dayIndex, stopIndex): ReplacementOption[]
replaceStopWithPoi(result, dayIndex, stopIndex, candidatePoiId): ReplaceOutcome
```

用户先单选，再点击 `确认替换`。取消、关闭、按 Escape 或空候选均不修改结果。确认时再次预演；成功后只替换目标 slot、其他日期完全相等、当天其他 POI ID 不变，并只压入一个撤销快照。

## 13. 密度、响应式与无障碍

- 主体字号保持 16px；常用标签 14px；许可证等元数据 12–13px。
- 主体行高约 1.45，元数据约 1.35。
- 区块间距压到 12–16px，Day 时间线垂直内边距压到 12–14px。
- 地图和来源继续默认折叠，推荐理由最多两行。
- 准备情况压成概览下方一行，例如：`✓ 结构检查通过 · 3 项出发前确认：营业时间、费用、实时交通 [查看]`。
- 完整检查仍放在 `规划说明与数据来源` 中。
- 320／390px 不出现页面级横向溢出；移动端输入、预算和生成按钮纵向排列。
- Dialog 桌面最大宽约 680px、高度不超过 80vh；移动端接近全屏，候选列表独立滚动。
- 200% 文字缩放下核心操作仍可见，触控目标至少 44×44px。
- Dialog 使用现有组件，保持焦点锁定、Escape 关闭和关闭后焦点返回。
- 生成、卡片状态和替换反馈使用简短 `aria-live="polite"`。

## 14. 失败与恢复

- 单张图片失败：只降级该卡。
- 图片许可不完整：从精选列表移除并换用合规 POI。
- 输入或预算非法：字段旁说明，旧结果不变。
- 票价过期、冲突、来源撤回或当前旅客票种缺失：只把对应费用降级为未知，保留行程，不套用其他票种或 A$0。
- PTV 旅行日期超出费率有效窗口：不继续沿用旧封顶；要求刷新官方费率。
- 无 Free Tram Zone 的真实路线证据：自动采用 daily cap 保守预留，不猜免费。
- 缺少天数：保留原文、预算、卡片状态和旧结果，只询问 1／2／3 天。
- 卡片与原文冲突：点名冲突 POI，不生成。
- 开始时间非法、起点未知或多义、结构化与文本冲突、硬区域与必去冲突、同一字段多个无纠正值、逐日不同时间／起点：停止并澄清。
- 户外优先但必去室内、少安排某分类但该类是必去等软冲突不阻止生成；硬约束优先并明确偏好差距。
- 任一天无法满足 pace 覆盖：不提交新结果，说明无法形成完整日程。
- NLU 超时、429、5xx、非法 JSON、Schema 或语义失败：整次切换到规则解析；规则仍不确定时澄清，不调用规划器。
- 连续 NLU 异常：本次会话关闭 AI 解析通道，继续提供本地规则路径和非阻塞说明。
- 候选预演或确认失败：Dialog 保留并显示原因，原行程不变。
- 新图片均为本地资源，来源页临时不可达不影响规划。
- 本轮最多标记为 `designed / implemented / locally tested`，不得把线上版本写成已更新。

## 15. 验收标准

1. 首次打开无预生成结果，输入区下方直接显示 10 张真实照片景点卡。
2. 每张卡均属于 40 POI 快照，作者、许可、来源页和核验日期完整。
3. 所有卡片可通过鼠标、触控和键盘访问，三态互斥并进入规划硬约束。
4. 卡片与文本冲突会阻止生成，不静默覆盖。
5. 自动轮播可暂停，交互后停止；reduced-motion 下不自动移动。
6. 固定两天轻松用例的两个 Day 都有下午活动并在 15:00 后结束。
7. balanced 与 packed 分别达到 16:00 和 16:30 覆盖阈值。
8. 午餐与 POI／交通不重叠，不能伪造结束时间。
9. 成功行程无重复、无重叠、必去恰好一次、避开零次。
10. 40 个 POI 价格记录均能由 `poiId` 映射，并含 basis、verification status、官方来源、`retrievedAt` 和 `reviewAfter`；统计为 22 条免费、9 条固定／起价／区间、8 条活动依赖、1 条未核实。
11. “换一个”显示全部可行候选；打开和取消不修改结果，确认才产生一次原子变更，撤销可精确恢复。
12. 准备情况只占一条；完整检查仍可展开查看。
13. 320px、390px、桌面和 200% 文字缩放下无横向溢出、遮挡或不可触达控件。
14. 图片失败、无候选、预算非法和排程无解均保留上一份成功行程。
15. 现有数据验证、测试、类型检查、静态检查和本地构建继续通过，并有新增回归测试。
16. 不执行上传、WorkBuddy 覆盖发布或 Sites hosting。
17. 新增长句固定示例被完整解析为 3 天、中央城区软偏好、户外优先、CBD 代理起点和 11:00–17:30。
18. 三天均从 11:00 离开起点，首个 POI 必须在首段交通后开始；CBD 代理说明始终可见。
19. “喜欢室外”不再解析为空，也不自动等同于“喜欢自然”；未满足时只显示软偏好差距。
20. 缺失起点与明确 CBD 虽使用同一代理坐标，但记录和展示的来源不同。
21. “主要在市内”达到中央城区严格过半或显示差距；“只在 CBD”执行硬过滤。
22. v1 输入保持兼容；新字段进入 v2，不原地破坏既有 Schema。
23. 免费基础入场和额外收费体验能同时表达；`event_dependent`、`unknown`、`stale`、`conflicted` 从不贡献 A$0。
24. 当前默认明确显示 1 名全价成人；儿童年龄或优惠票种缺少匹配价格时准确标为部分覆盖。
25. 一名全票乘客可能乘车时，工作日按 A$5.70／日、周末或已确认公共假日按 A$4.00／日预留；无日期时采用工作日上限并显示保守假设。
26. 仅凭 CBD、POI 坐标或直线距离不能触发 Free Tram Zone 的 A$0；只有全步行或未来真实路线确认的 FTZ-only tram 才允许为零。
27. 2027-01-01 及以后的旅行不使用本次临时 PTV 价格；SkyBus、机场接驳和实体卡费不被静默混入 daily cap。
28. 总预算低于已知最低值时显示确定超支；存在未知上界时不显示“预算充足”。
29. 固定长句必须在生成前摘要中显示 Melbourne、3 天、CBD、11:00、户外和中央城区，并产生 3 个非空 Day。
30. 注入“LLM 漏掉 CBD／11:00”、错误城市、币种改变、未知 POI、额外字段或伪造 evidence 的结果时，语义校验拒绝整份输出并由规则正确恢复或澄清。
31. NLU timeout、429、5xx、非法 JSON、额外字段和整次规则回退均有回归测试；失败不覆盖上一份成功行程。
32. API Key 不出现在前端构建、浏览器请求、版本库、日志或错误响应中。
33. NLU 进入公开版本前，必须在中国大陆普通网络完成 20 条固定中文用例、每条 3 次：硬字段不允许静默漏失或空行程；API 通路至少 57／60 成功、p95 不高于 12 秒；API 不可用时规则或明确澄清路径 60／60 可用。未通过则保持本地规则模式。

## 16. 预计修改范围

- `site/app/page.tsx`：空初始值、热门轮播、三态、预算、单行准备情况和替换 Dialog。
- `site/app/lib/planner.ts`：请求 v2、快速设置合并、起点首段、区域／户外偏好、开始时间、价格快照适配、预算结构、pace 覆盖、候选枚举与指定候选替换。
- `site/app/lib/planner.test.ts`：排程覆盖、午餐、票价／PTV／预算、卡片约束和显式替换回归。
- `site/app/globals.css`：密度和 reduced-motion 补充。
- `data/poi-admission-price-v0.4.schema.json`：不破坏 `poi-import-v1` 的独立票价 Schema。
- `data/verified/poi-admission-price-v0.4.json`：40 条版本化官方票价 assertion。
- `site/data/ptv-fares-v0.4.json`：有明确有效期的 PTV 费率快照。
- `site/data/featured-pois-v0.4.json`：精选卡片与图片署名清单。
- `site/public/poi/`：网页用的压缩本地照片。
- `data/raw/media/poi/`：原始照片与来源记录。
- 新增 `TripRequestDraft v2` Schema／adapter 前，保留 v1 文件和测试不变；本地规则解析可先产出内部 `ParsedTripRequest v2`，外部 NLU Schema、BFF、Provider Adapter 和 secret 只属于另行批准的联网工作包。
- 实现后同步 `docs/02_UX.md`、`docs/05_PLANNING_RULES.md`、`docs/06_TEST_AND_ROADMAP.md` 和 `docs/08_IMPLEMENTATION_LOG.md`。

不修改 `docs/09_WORKBUDDY_RELEASE.md`、`.openai/hosting.json`、WorkBuddy 元数据或线上状态。

### 独立工作包边界

1. `v0.4-local`：票价／PTV 快照、预算展示、热门卡、请求解析与排程修复。用户批准后仅在本地实施和验证。
2. `v0.4-nlu-lab`：GLM 或其他 Provider Adapter、BFF、Schema、语义校验与规则 fallback。必须另行批准供应商、外部请求和 API Key 使用。
3. `v0.4-online`：WorkBuddy／外部 BFF 发布、secret 注入和中国大陆网络验收。必须再次批准，不由前两个批准自动继承。

## 17. 重新决策条件

出现以下任一情况必须回到设计阶段：

- 找不到至少 6 张许可完整的真实 POI 图片；
- 当前 40 POI 无法满足 pace 覆盖阈值；
- 需要把预算变成真正硬约束或按价格排序；
- 官方价格无法稳定映射现有 40 个 POI ID，或活动依赖／未知比例使选中行程无法给出有意义的上界；
- 用户要求精确支持儿童年龄组合、长者资格、团体票、套票、实时折扣或动态场次价格；
- PTV 临时半价到期或官方政策改变；
- 需要依据真实路线自动判断 Free Tram Zone；
- 需要把 myki 介质、机场、区域交通或餐饮纳入完整总价；
- 需要改变默认 09:30、固定结束 17:30 或支持逐日不同窗口；
- 需要接入实时事实、外部运行时、其他城市或公开发布；
- WorkBuddy 无法安全保存 secret 或提供服务端函数；
- 免费模型、额度、JSON 能力或中国大陆连通性改变，或 GLM 未通过固定验收矩阵；
- 用户希望预算直接改变选点或成为整趟硬约束；
- 实现要求削弱原子替换、来源披露或失败不覆盖旧结果。
