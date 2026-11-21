# 墨尔本旅游：资料来源与使用边界（实施前规划）

日期：2026-09-28  
状态：只读来源核查与设计决策；没有申请账户、下载新数据、抓取页面、接入 API 或修改网站。来源条件会变化，真正接入前必须重查当前页面和实际协议。本文是产品数据准入判断，不代替资料提供方授权或法律意见。对应[第一轮功能范围](/Users/tako404/Desktop/studying/tongyong/秋招学习/墨尔本旅游/docs/40_BASELINE_AND_FIRST_ITERATION_SCOPE.md)。

## 1. 资料进入产品的共同门槛

每种新事实都先登记：`字段 → 提供方与原始 URL → 获取方式 → 获取/公开展示/缓存/作为 AI 输入四种用途各自的权利依据与到期条件 → 核验日 → 适用起止日与复核日 → 失效后行为 → 产品中的归因`。外部事实的 `verified` 只表示在注明时间与条件下核对过；它不等于实时或永久有效。**网页能打开，不等于有开放 API、复制权或把内容送给模型的权利。**

对来源权利暂不清楚的资料，只把原始链接提供给游客自行查看，不把其全文、图片、评分或卡片内容搬入本站。即使获得数据，也要分别决定“原样展示”“项目自写事实摘要”“作为 AI 输入”是否被允许；这三种用途不能相互推定。现有 [POI 数据来源记录](/Users/tako404/Desktop/studying/tongyong/秋招学习/墨尔本旅游/data/SOURCES.md:3)与[门票 Schema](/Users/tako404/Desktop/studying/tongyong/秋招学习/墨尔本旅游/data/poi-admission-price-v0.4.schema.json:1)是本项目已有的记录方式。

## 2. 按资料类型的准入决策

| 类型及所需字段 | 当前可核来源、使用边界 | 刷新/失效规划 | 第一轮决策 |
|---|---|---|---|
| 景点 POI：名称、坐标、分类、适配标签 | [City of Melbourne Open Data](https://data.melbourne.vic.gov.au/explore/dataset/landmarks-and-places-of-interest-including-schools-theatres-health-services-spor/information/)；项目已保存 2026-09-14 原始 242 行、精选 40 项及 CC BY 4.0 归因。中文名、建议时长、标签是**项目标注**，不能写成市府原字段。[本地链路](/Users/tako404/Desktop/studying/tongyong/秋招学习/墨尔本旅游/data/SOURCES.md:3) | 保留版本化快照；建议季度或来源变更时复核。无可核营业/关闭资料时仍提示出发前查官方。 | **继续使用既有快照**；不是本轮新增资料。 |
| 门票：POI、票型、包含项、来源、有效期 | 现有 [40 条门票快照](/Users/tako404/Desktop/studying/tongyong/秋招学习/墨尔本旅游/data/verified/poi-admission-price-v0.4.json:1)逐条引用运营方页面；各运营方页面是核价入口，不可假定存在统一开放 API 或批量再展示许可。 | 依记录中的 `reviewAfter/effectiveUntil` 复核；超期从“已核实金额”退出，显示待确认，不把未知当 A$0。 | **沿用已有分项披露**；不承诺实时票价或门票库存。 |
| 公共交通规则与票价：付款方式、票型、适用日、免费电车规则 | [Transport Victoria 访客页](https://transport.vic.gov.au/plan-a-journey/visitors-to-victoria)、[票价页](https://transport.vic.gov.au/tickets-and-payments/fares/metropolitan-train-tram-and-bus-fares)。其[版权说明](https://transport.vic.gov.au/website-terms/copyright)将网站自有文字置于 CC BY 4.0，图片、标识和第三方内容除外。现有[项目票价快照](/Users/tako404/Desktop/studying/tongyong/秋招学习/墨尔本旅游/site/data/ptv-fares-v0.4.json:1)有适用起止日。 | 每月及游客出发前复核；政策截止日是硬边界。当前官方页面写明半价至 2027-01-01，不能把旧价跨期沿用。 | **可规划带归因的规则快照和一般避坑提醒**；没有真实线路与免费区边界证据时，不判断某一段免费。 |
| 公共交通时刻/线路：站点、路线、班次 | [Transport Victoria GTFS Schedule](https://opendata.transport.vic.gov.au/dataset/gtfs-schedule)为 CC BY 4.0，按官方说明每周/按需更新、覆盖滚动约 30 天，含线路与时刻，不是票价 API；现有规划器仅直线估距。 | 如果以后接入，按官方发布节奏刷新并对旅期窗口校验；旧时刻不得冒充当天实时服务。 | **后置**。第一轮不靠它证明逐段电车免费或精确换乘。 |
| 酒店属性：名称、官方星级、设施、位置、特色 | [Tripadvisor Terra Location Details](https://docs.terra.tripadvisor.com/reference/locationget)有 `star_rating`、`attributes`、地址/坐标等候选字段，但需要账户、地点权限与具体协议；其[Discover API Master Terms](https://docs.terra.tripadvisor.com/docs/api-master-terms)限制面向消费者的 AI 用途、系统性网站提取、显示与缓存。另一候选 [ATDW 开发接入](https://support.atdw.com.au/en/articles/64809-developer-api-integration-guide)提供住宿数据，但需[分发协议与 API 凭证](https://support.atdw.com.au/en/articles/43990-how-to-join-as-a-distributor)。 | 数据允许进入产品后才定刷新周期和字段缺失策略。ATDW 的分发说明要求缓存至少每周更新两次；实际协议优先。 | **未获准具体酒店候选**。先保留住宿区域建议及官方核对入口；不得按“AI 抓 Tripadvisor”实施。酒店资料和住宿预算假设分离。 |
| 日期活动：名称、日期/场次、地点、主办方及购票入口 | [Visit Victoria 活动入口](https://www.visitvictoria.com/Regions/Melbourne/whats-on.aspx)和[市府 What's On](https://whatson.melbourne.vic.gov.au/)可供游客查阅，但其[使用声明](https://www.visitvictoria.com/legal-notices)和[市府免责声明](https://whatson.melbourne.vic.gov.au/disclaimer)不能当成自动抓取与公开再展示许可。ATDW 也是待授权的结构化候选。 | 若获得可用来源，活动在行前要更频繁核验，并以明确的年月日匹配旅期；场次/余票不可从活动存在推导。过期时退为官方链接与待确认。 | **具体活动卡受来源门控**。第一轮可设计日期确认和官方查询入口；未有获准数据时不称“活动推荐已完成”。 |
| 季节与行李：季节、天数、同行人、活动类型 | 南半球月份与项目自写触发规则可形成清单。[BOM 墨尔本机场月均表](https://www.bom.gov.au/climate/averages/tables/cw_086282_All.shtml)仅为历史统计，站点也不在 CBD；[BOM 版权说明](https://www.bom.gov.au/copyright)要求核对公开再使用条件。 | 无明确日期给通用清单；有日期可按季节给建议，但不可从月均表得出旅行当天预报。若将来接天气服务，再单独定时效。 | **项目自写的季节清单可先做**；不复制未获准的气候表，不声称实时天气。 |
| 购物：商品类别、可去区域/市场、地点来源 | 可从用户偏好与已有的 Queen Victoria Market POI 做有限建议，[市场官方访客入口](https://qvm.com.au/visit-us/)供游客核对。市府商圈网页可作外链；未核准其内容批量再展示。 | 商店营业时间、库存和价格变化快，只有单项获准且当期核实才写具体断言；否则只说类别/区域并给官方入口。 | **先做有依据的类别与区域建议**；不保证具体店铺现货或价格。 |
| 海关、入境物品、退税 | [澳大利亚农业部旅客入口](https://www.agriculture.gov.au/travelling/to-australia)、[澳洲边防退税入口](https://www.abf.gov.au/entering-and-leaving-australia/tourist-refund-scheme)可作官方查证入口。返回中国的规则还取决于目的地、身份与现行海关政策。 | 临行前由旅客复核；不从中文输入推定国籍/返程地，也不自动算资格、税额或携带限额。 | **只给核对入口与一般提醒**；个性化法规判断后置。 |

## 3. 编码前要关闭的两个资料关口

**酒店关口**：先选一个实际可用来源，核对账户/订单/分发协议是否允许本网站显示星级、设施、位置和特色，以及是否允许进入 AI 处理；抽查少量酒店是否真有这些字段。若不能，第一轮交付范围仍包含“住宿区域说明”，但**具体酒店候选记为未交付**，之后再找获准来源。Tripadvisor 与 ATDW 是候选，不是项目已经签约的服务。

**活动关口**：先证明能合法取得并展示活动标题、时间和地点，且能按旅期复核。如果只有网页可看，第一轮提供官方查询入口和“建议提前确认购票”的通用提醒；不能把抓来的活动内容放进本站候选卡，更不能自动塞进日程。

上述决定要写进本项目的资料目录和测试预期：权利按**获取、公开展示、缓存、AI 输入**分别记录 `confirmed/pending/restricted`，每个结论留条款或协议依据和复核日。只有获取和拟用展示方式都获准，事实才能进入对应产品位置；获得展示权也不自动获得送入模型的权利。待确认或受限时，产品只能展示自行撰写的通用说明及可供游客自行核对的原站链接。接入许可、费用、刷新义务和资料撤下机制都以届时实际条款为准。
