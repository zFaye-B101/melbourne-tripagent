# Melbourne TripAgent v0.4 票价、交通与自然语言 API 核验

状态：`RESEARCHED — DESIGN INPUT ONLY`  
核验日期：2026-09-15  
边界：本文件只保存公开资料核验和设计建议；尚未导入运行数据、修改规划器、配置 API Key、建立后端或更新线上版本。

## 1. 结论摘要

- 当前 40 个 POI 中，22 个可核实为免费公共空间或常规免费入场，9 个有可用于预算的固定价、起价或价格区间，8 个必须按具体演出／活动／日期查询，1 个仍未找到明确的个人游客票价。
- 因此，门票预算可以从“全部未知”升级为“部分覆盖的已知区间”，但活动依赖、动态票价和未核实项目绝不能按 A$0 计算。
- 截至核验日，维州公共交通执行 2026-06-01 至 2027-01-01 的临时半价政策。当前规划器没有真实公共交通路线，最多只能给出按日封顶的保守预留额，不能声称是精确通勤费用。
- 参考网站采用“网页 → 同源后端 → LLM／规则解析 → 确定性规划”的分层方式，而不是在网页中公开供应商 Key；这一架构值得借鉴，但它对本项目的墨尔本固定用例实测失败，不能照搬解析逻辑。
- 免费测试 API 的首选候选为智谱 `GLM-4-Flash-250414`：官方标注免费、支持中文与 JSON 输出，并提供 OpenAI-compatible 接口。它仍必须经过后端代理、Schema 和语义校验以及中国境内网络实测，不能让浏览器直接持有 Key。

## 2. POI 常规票价快照

### 状态口径

- `free_public_space_official`：官方公共空间，无常规景点门票；活动、餐饮、商品等另计。
- `free_general_entry_official`：常规入场或常设内容免费；特展、电影、导览等可能另计。
- `free_tour_reservation_official`：官方导览免费，但需要预约或受日期限制。
- `transport_fare_separate`：地点本身没有景点门票，乘车成本由交通预算单独计算。
- `fixed_general_admission_official`：可核实的常规入场固定价格。
- `range_general_admission_official`：价格随预订方式、日期或容量变化，只有区间可用。
- `from_general_admission_official`：只承诺起价，不能推导最高价。
- `fixed_optional_experience_official`：POI 本身不是固定收费景点，所列价格只对应导览／体验。
- `event_or_tour_dependent_official`、`event_dependent_official`：必须选定活动、场次或导览后才能报价。
- `not_verified`：没有足够的一手证据；不得显示为免费。

下表只记录一般游客最常见的常规入场或代表性体验。所有金额均为 AUD，特展、订票费、会员、组合票和临时优惠不自动计入。

| # | POI | 核实结果 | 建议状态 | 官方／一手来源 |
|---:|---|---|---|---|
| 1 | Federation Square | 免费公共空间；个别活动另计 | `free_public_space_official` | [Fed Square](https://fedsquare.com/) |
| 2 | ACMI | 常设展览 *The Story of the Moving Image* 免费；电影与特展另计 | `free_general_entry_official` | [ACMI](https://www.acmi.net.au/whats-on/story-of-the-moving-image-exhibition/) |
| 3 | NGV International | 常设馆藏免费；特展可能收费 | `free_general_entry_official` | [NGV](https://www.ngv.vic.gov.au/plan-your-visit/) |
| 4 | State Library Victoria | 图书馆及多数展览免费；部分活动收费 | `free_general_entry_official` | [State Library Victoria](https://www.slv.vic.gov.au/visit) |
| 5 | Queen Victoria Market | 进入市场无需门票；购物、餐饮和导览另计 | `free_public_space_official` | [Queen Victoria Market](https://qvm.com.au/visit-us/) |
| 6 | Immigration Museum | 成人 A$15；长者 A$12；16 岁及以下和符合条件优惠免费 | `fixed_general_admission_official` | [Museums Victoria](https://museumsvictoria.com.au/immigrationmuseum/whats-on/getting-in/) |
| 7 | Melbourne Museum | 成人 A$18；长者 A$12；16 岁及以下和符合条件优惠免费 | `fixed_general_admission_official` | [Melbourne Museum](https://museumsvictoria.com.au/melbournemuseum/plan-your-visit/) |
| 8 | Royal Exhibition Building | 无固定日常入场；Dome Promenade 成人 A$29、优惠／长者 A$23、儿童 A$15 | `event_or_tour_dependent_official` | [Museums Victoria](https://museumsvictoria.com.au/melbournemuseum/whats-on/royal-exhibition-building-dome-promenade) |
| 9 | Fitzroy Gardens | 免费公共花园；Cooks' Cottage 另计 | `free_public_space_official` | [City of Melbourne](https://whatson.melbourne.vic.gov.au/things-to-do/fitzroy-gardens) |
| 10 | Royal Botanic Gardens Melbourne | 花园常规入场免费；特别活动另计 | `free_general_entry_official` | [Royal Botanic Gardens Victoria](https://www.rbg.vic.gov.au/visit-melbourne-gardens/) |
| 11 | Shrine of Remembrance | 常规入场免费；导览成人 A$25、优惠 A$20、6–17 岁 A$15 | `free_general_entry_official` | [Shrine of Remembrance](https://www.shrine.org.au/plan-your-visit) |
| 12 | Old Melbourne Gaol | 成人 A$38、优惠／学生／30 岁以下 A$30、5–15 岁 A$22；可能有订票费 | `fixed_general_admission_official` | [Old Melbourne Gaol](https://www.oldmelbournegaol.com.au/tickets/) |
| 13 | The Ian Potter Centre: NGV Australia | 常设馆藏免费；特展可能收费 | `free_general_entry_official` | [NGV](https://www.ngv.vic.gov.au/plan-your-visit/) |
| 14 | St Paul's Cathedral | 免费，可自愿捐款；团体导览另有建议捐款 | `free_general_entry_official` | [St Paul's Cathedral](https://cathedral.org.au/explore/) |
| 15 | Melbourne Town Hall | 官方公共导览免费，但需预约且受日期／房间开放限制 | `free_tour_reservation_official` | [City of Melbourne](https://whatson.melbourne.vic.gov.au/things-to-do/melbourne-town-hall-tours) |
| 16 | Flinders Street Station | 地标外观和车站本身无景点票；乘车费另算 | `transport_fare_separate` | [Transport Victoria precinct map](https://www.ptv.vic.gov.au/assets/DTP1124-FlindersStreetStation-Precinct-Map_Degraves-Subway_web_Stage-1_v3.pdf) |
| 17 | Birrarung Marr | 免费公共公园；节庆活动另计 | `free_public_space_official` | [City of Melbourne](https://whatson.melbourne.vic.gov.au/things-to-do/birrarung-marr) |
| 18 | Forum Melbourne | 无日常景点票；仅按具体演出售票 | `event_dependent_official` | [Marriner Group](https://marrinergroup.com.au/index.php/forum-melbourne-ticketing) |
| 19 | Flagstaff Gardens | 免费公共花园；特别活动另计 | `free_public_space_official` | [City of Melbourne](https://whatson.melbourne.vic.gov.au/things-to-do/flagstaff-gardens) |
| 20 | Museum of Chinese Australian History | 成人 A$17；优惠及 5 岁以上儿童 A$14；家庭 A$42 | `fixed_general_admission_official` | [Chinese Museum](https://www.chinesemuseum.com.au/admission) |
| 21 | Princess Theatre | 无日常景点票；按具体演出售票 | `event_dependent_official` | [Marriner Group](https://marrinergroup.com.au/princess-theatre) |
| 22 | IMAX Melbourne | 影片、日期与座位决定价格 | `event_dependent_official` | [IMAX Melbourne](https://imaxmelbourne.com.au/about_imax/faq/) |
| 23 | Old Treasury Building | 自助参观免费；团体和导览另计 | `free_general_entry_official` | [Old Treasury Building](https://www.oldtreasurybuilding.org.au/visit-us/) |
| 24 | Parliament House | 官方公共／建筑导览免费；需预约并受议会日程限制 | `free_tour_reservation_official` | [Parliament of Victoria](https://www.parliament.vic.gov.au/visit/architecture-tour/) |
| 25 | St Patrick's Cathedral | 未找到明确的现行个人游客票价 | `not_verified` | [Catholic Archdiocese of Melbourne](https://melbournecatholic.org/st-patricks-cathedral/) |
| 26 | Carlton Gardens South | 免费公共花园；相邻展馆另计 | `free_public_space_official` | [City of Melbourne](https://whatson.melbourne.vic.gov.au/things-to-do/carlton-gardens) |
| 27 | Cooks' Cottage | 成人 A$8.20、优惠 A$6.10、5–15 岁 A$4.50、家庭 A$22 | `fixed_general_admission_official` | [City of Melbourne](https://whatson.melbourne.vic.gov.au/book-cooks-cottage) |
| 28 | ACCA | 画廊常规入场免费；布展期可能临时闭馆 | `free_general_entry_official` | [ACCA](https://acca.melbourne/) |
| 29 | Melbourne Skydeck | 成人线上 A$33 起、现场最高 A$43；优惠 A$25–33；4–16 岁 A$21–28 | `range_general_admission_official` | [Visit Victoria listing](https://www.visitvictoria.com/regions/melbourne/see-and-do/art-and-culture/architecture-and-design/melbourne-skydeck) |
| 30 | Alexandra Gardens | 免费公共花园；节庆和餐饮另计 | `free_public_space_official` | [City of Melbourne](https://whatson.melbourne.vic.gov.au/things-to-do/alexandra-gardens) |
| 31 | Kings Domain | 免费公共公园；园内场馆另计 | `free_public_space_official` | [City of Melbourne](https://whatson.melbourne.vic.gov.au/things-to-do/kings-domain) |
| 32 | Melbourne Recital Centre | 无固定日常观演价格 | `event_dependent_official` | [Melbourne Recital Centre](https://www.melbournerecital.com.au/visit-us/) |
| 33 | Hamer Hall | 无固定日常演出价格 | `event_dependent_official` | [Arts Centre Melbourne](https://www.artscentremelbourne.com.au/visit/getting-here) |
| 34 | SEA LIFE Melbourne Aquarium | 成人 A$39–53、2–15 岁 A$25–39、优惠 A$32–46、2 岁以下免费；动态定价 | `range_general_admission_official` | [SEA LIFE Melbourne](https://www.visitsealife.com/melbourne/tickets-passes/price-table/) |
| 35 | Docklands Park | 免费公共公园；周边活动另计 | `free_public_space_official` | [City of Melbourne](https://whatson.melbourne.vic.gov.au/things-to-do/docklands-park) |
| 36 | Webb Bridge | 免费步行桥 | `free_public_space_official` | [City of Melbourne](https://whatson.melbourne.vic.gov.au/things-to-do/walks/southbank-and-docklands) |
| 37 | Melbourne Zoo | 成人 A$58 起、优惠 A$44 起、长者 A$52.50 起；4–15 岁儿童平日 A$29、周末／假期免费 | `from_general_admission_official` | [Zoos Victoria](https://www.zoo.org.au/melbourne/melbourne-zoo-prices/) |
| 38 | MCG | MCG Tour 成人 A$38、优惠 A$26、5–15 岁 A$17；比赛票另计 | `fixed_optional_experience_official` | [MCG](https://www.mcg.org.au/australian-sports-museum-mcg-tours/plan-visit/tickets) |
| 39 | Rod Laver Arena | 无日常景点票；按赛事／演唱会售票 | `event_dependent_official` | [Rod Laver Arena](https://rodlaverarena.com.au/) |
| 40 | AAMI Park | 无日常景点票；按赛事／活动售票 | `event_dependent_official` | [AAMI Park](https://aamipark.com.au/) |

### 价格使用边界

1. “常规免费”不等于“所有内容免费”。卡片和日程必须写“常规入场免费；特展／活动另计”等条件。
2. `fixed` 可进入已知上下限；`range` 同时进入最低和最高；`from` 只进入最低，最高保持未知。
3. `event_dependent`、`not_verified` 不进入 A$0，也不能用于“预算充足”判断。
4. `fixed_optional_experience` 只有用户明确选择该体验时才计费；不能因为访问 MCG 外部就自动加入 Tour 票。
5. 每条价格必须保留 `sourceUrl`、`verifiedAt`、适用人群、价格条件和 `validUntil`。来源没有公布失效日时，`validUntil = null`，表示“未公布”而不是“永久有效”。
6. 来源没有公布有效期时，数值／起价／区间／常规免费入场默认 30 天后复核，明确不售票的公共空间默认 90 天后复核；这是产品 `reviewAfter`，不是官方保证。
7. 生成时若旅行日期晚于明确有效期，或价格快照已被标记为 `stale`／`review_due`，必须回到“需出发前确认”。

## 3. 墨尔本公共交通费用

### 核实的当前费率

临时政策：2026-06-01 至 2027-01-01，全维州公共交通半价；SkyBus、渡轮和非补贴区域巴士不参与。官方说明见 [Victorian Government](https://www.vic.gov.au/half-price-travel) 与 [Transport Victoria](https://transport.vic.gov.au/news-and-resources/campaigns/your-guide-to-myki-fares)。

| 当前 myki Money 费率 | 全价 | 优惠 |
|---|---:|---:|
| Zone 1+2，2 小时 | A$2.85 | A$1.42 |
| Zone 1+2，工作日封顶 | A$5.70 | A$2.85 |
| Zone 1+2，周末／公共假日封顶 | A$4.00 | A$2.00 |
| Zone 2，2 小时 | A$1.80 | A$0.90 |
| Zone 2，每日封顶 | A$3.60 | A$1.80 |

补充规则：

- Free Tram Zone 只有在电车行程的起点和终点都位于免费区内时才免费；只要有一端在区外，就需要正常付费。不能把“CBD”“距离短”或“经过免费区”直接等同为免费。[官方说明](https://transport.vic.gov.au/tickets-and-payments/myki/cheaper-travel-with-myki)
- 实体 myki 卡本身全价 A$6、优惠 A$3、Youth A$5，另需充值；Android Mobile myki 免费设立。Visa／Mastercard 或相应手机／手表钱包可直接 contactless，当前只支持 full fare。[myki](https://transport.vic.gov.au/tickets-and-payments/myki) · [票务方式](https://transport.vic.gov.au/tickets-and-payments)
- 18 岁以下使用 Youth myki 可免费乘坐维州公共交通；优惠、长者和儿童资格必须由用户自行确认，产品不能从“学生／游客”等词自动推定资格。
- SkyBus 不使用 myki，也不在临时半价范围内；机场接驳必须作为独立费用项查询。[机场交通](https://transport.vic.gov.au/plan-a-journey/travel-tips-and-resources/getting-to-and-from-melbourne-and-avalon-airports)

### 当前规划器适用的保守算法

当前规划器只有直线距离与交通方式启发式，没有路线、站点、分区或 Free Tram Zone 证据。因此：

1. 当日所有路段都明确步行：交通预留 A$0。
2. 只有未来真实路线引擎证明当日所有公共交通路段均为“仅免费区内电车”时，才允许交通预留 A$0。
3. 只要出现一个可能需要公共交通的路段，当前版本就使用 Zone 1+2 当日封顶作为“保守预留上限”：工作日全价 A$5.70，周末／维州公共假日全价 A$4.00；优惠按对应官方封顶。
4. UI 显示 `预计预留 A$0–A$5.70／日` 或 `A$0–A$4.00／日`，并固定说明“按日封顶预留，非精确路线票价”。不能按每段重复累加 2 小时票。
5. 实体 myki 卡费作为一次性可选准备费用；选择 contactless 或 Android Mobile myki 时卡费为 A$0。
6. SkyBus、其他机场接驳、渡轮、出租车、网约车、停车与租车全部单列为 `excluded_or_unknown`。
7. 费率表必须带 `effectiveFrom`、`effectiveUntil` 和 `verifiedAt`；旅行日期在 2027-01-01 及之后时，不再应用本表，改为“需刷新票价”。

## 4. 预算契约修订建议

### 最小旅客输入

要把“每张票”转换成整趟预算，必须知道人数与票种。v0.4 建议在“更多设置”增加紧凑的价格档案：

- 全价成人数量，默认 1，并明确显示；
- 优惠票数量，默认 0，选择后提示用户自行确认资格；
- 儿童年龄列表，可选；不同场馆年龄分段不同，不能只用一个“儿童数”猜票价；
- 是否需要购买实体 myki，默认否。

用户未展开时，概览必须写“当前按 1 名全价成人估算”，不能像参考站一样静默假设 2 名成人。

### 输出结构

```ts
type CostKnowledge = 'complete' | 'partial' | 'none';
type BudgetAssessment =
  | 'no_budget'
  | 'definitely_over'
  | 'within_verified_range'
  | 'needs_confirmation';

interface CostRange {
  minCents: number | null;
  maxCents: number | null;
  currency: 'AUD';
  knowledge: CostKnowledge;
  unknownItemIds: string[];
}

interface BudgetEstimateV2 {
  admission: CostRange;
  localTransit: CostRange;
  mykiSetup: CostRange;
  meals: CostRange; // v0.4 仍为 none，不能写 0
  knownTotal: CostRange;
  totalBudgetCents: number | null;
  assessment: BudgetAssessment;
  policyVersions: string[];
  verifiedAt: string;
}
```

### 计算与文案

- 门票最低值取所选 POI 的免费／固定／区间下限／起价之和；最高值只有在每个项目都有可信上界时才给数值，否则为 `null`。
- 本地交通最低值在无真实路线时为 A$0，最高值按每个可能乘车日的当日封顶累加；不把上限称为实际花费。
- `knownTotal` 只合并已覆盖的门票、交通和可选卡费；餐饮、活动依赖项目和机场费用仍列入未知清单。
- 只有 `knownTotal.min > totalBudget` 时，才可显示“即使按已知最低费用也会超出预算”。
- 只有所有纳入范围的费用都 `complete` 且 `knownTotal.max <= totalBudget` 时，才可显示 `within_verified_range`。v0.4 餐饮仍未知，所以整趟预算通常应显示“已知费用未超出，但仍有未定项目”，而不是“预算充足”。
- 可显示“扣除已知上限后的剩余额度”，但必须紧邻显示未知项目数量；若上限为 `null`，不计算剩余。

## 5. 参考网站公开配置核验

参考站公开 API 文档：[`/docs`](https://2bd8b4dffb5144c384ed0f69f178f71f.app.workbuddy.link/docs)；OpenAPI 定义：[`/openapi.json`](https://2bd8b4dffb5144c384ed0f69f178f71f.app.workbuddy.link/openapi.json)。

可观察到的方案：

```text
网页 POST /v1/plan { text }
  → 服务端自然语言解析
  → source: llm | rule
  → 确定性规划／住宿／预算／提示
  → JSON 返回网页
```

- `GET /v1/parse?text=...&use_llm=true` 用于查看解析结果；`ParseResult.source` 标记 `llm` 或 `rule`。
- `POST /v1/plan` 接受自然语言 `text` 或结构化 `request`；前端实测使用同源 `POST /v1/plan`，没有在浏览器公开第三方 API Key。
- 公开页面和 OpenAPI 无法证明具体 LLM 供应商、模型、免费额度、服务端环境变量或 WorkBuddy 是否代管 Key。不能从网络外观推断这些隐藏配置。

用本项目固定需求实测：

> 墨尔本3天，主要在市内，喜欢室外。出发点在CBD，早上11点出门，预算500澳元

参考站返回 HTTP 200 且 `parse_source = "llm"`，但把目的地写成“市内”、`origin = null`、到达／出发时间为空、三天行程为空；警告又说明“LLM 识别的城市墨尔本无法核实，已改用规则解析结果”。预算输入为 AUD，预算输出却变为 CNY。结论：分层架构可借鉴，解析字段、币种不变量和“尝试模式／最终采纳模式”必须重新设计。

本项目响应建议区分：

```ts
interface ParserDiagnostics {
  attemptedMode: 'llm' | 'rules';
  acceptedMode: 'llm' | 'rules' | 'none';
  fallbackReason: string | null;
  schemaVersion: string;
  promptVersion: string | null;
}
```

页面只需显示“AI 解析”或“本地解析”；供应商、模型和错误细节只留在不含原文的诊断日志。不能仅因调用过 LLM 就标记为 LLM 成功。

## 6. 免费／低门槛自然语言 API 比较

“免费”只描述核验日可见的服务层，不代表永久、无限量或中国境内一定可达。准确限额必须在实际账号控制台再次确认。

| 候选 | 官方免费事实 | 结构化与兼容性 | 中国验收与本项目判断 |
|---|---|---|---|
| 智谱 GLM-4-Flash-250414 | 官方称其为首个免费大模型 API；账号限额动态显示 | 支持 JSON 输出；提供 OpenAI-compatible 接口 | 中文请求最匹配，首选测试候选；网络和账号限额仍需中国普通网络实测 |
| Cloudflare Workers AI | Free／Paid Workers 每天共 10,000 Neurons 免费额度；部分高资源模型仅付费计划可用 | 有 OpenAI-compatible endpoint 和 JSON mode；仍需应用端校验 | 最适合未来 Worker/BFF，但官方未承诺中国大陆可达，不作为未经实测的唯一验收链路 |
| Google Gemini API | 部分模型有 Free Tier，精确额度按模型和账号显示 | 原生 structured output，亦有 OpenAI compatibility | 官方可用区域列表未列中国大陆，不作为中国验收主路径 |
| Groq | 有 Free tier；升级付费层才要求付款方式 | OpenAI-compatible；部分模型支持严格 Structured Outputs | 快速开发备选；免费层模型／限额和中国可达性需账号与网络实测 |
| OpenRouter | 免费模型总计通常 50 次／日；购买至少 US$10 credits 后为 1000 次／日 | OpenAI-compatible；`openrouter/free` 会动态选择免费模型 | 适合开发兜底，不适合作为稳定验收的唯一模型，因实际模型和可用性会变化 |
| SiliconFlow | 当前公开价格页未证明通用对话 API 长期全部免费 | OpenAI-compatible 能力需按具体模型核实 | 不把活动送券或非对话免费能力写成“永久免费通用 NLU” |

账号与付款边界：智谱官方文档要求注册并创建 API Key，但没有在上述公开文档中说明免费模型是否需要绑定付款方式，实施前必须在实际账号控制台确认；Cloudflare 的公开价格页同样不能替代注册流程实测。Groq 官方明确只有升级 Developer tier 才需要付款方式。OpenRouter 的 50 次／日免费模型调用不要求先购买 US$10 credits，但仍需要账号和 API Key。

主要官方资料：

- 智谱：[免费模型](https://docs.bigmodel.cn/cn/guide/models/free/glm-4-flash-250414) · [OpenAI API 兼容](https://docs.bigmodel.cn/cn/guide/develop/openai/introduction) · [结构化输出](https://docs.bigmodel.cn/cn/guide/capabilities/struct-output) · [速率限制](https://docs.bigmodel.cn/cn/api/rate-limit)
- Cloudflare：[Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/) · [OpenAI compatibility](https://developers.cloudflare.com/workers-ai/configuration/open-ai-compatibility/) · [JSON mode](https://developers.cloudflare.com/workers-ai/features/json-mode/) · [Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
- Gemini：[pricing](https://ai.google.dev/gemini-api/docs/pricing) · [available regions](https://ai.google.dev/gemini-api/docs/available-regions) · [structured output](https://ai.google.dev/gemini-api/docs/structured-output)
- Groq：[billing](https://console.groq.com/docs/billing-faqs) · [OpenAI compatibility](https://console.groq.com/docs/openai) · [structured outputs](https://console.groq.com/docs/structured-outputs)
- OpenRouter：[FAQ 与免费限额](https://openrouter.ai/docs/faq) · [free model variant](https://openrouter.ai/docs/guides/routing/model-variants/free) · [quickstart](https://openrouter.ai/docs/quickstart)

### 推荐的接入边界

```text
浏览器
  → POST /v1/trip-requests/parse
  → 同源或受限 CORS 的轻量 BFF
      → ProviderAdapter（首测：智谱 GLM-4-Flash-250414）
      → JSON Schema 校验
      → evidence／枚举／POI 白名单／硬约束语义校验
      → 最多一次修复重试
      → 整次切换到本地规则解析器
  → 已验证的 ParsedTripRequest v2
  → 浏览器内确定性 planTrip()
```

- Provider Key 只放在 BFF 的 secret／环境变量中，不进入前端包、请求、日志、Git 或聊天内容。
- LLM 只抽取请求，不生成 POI、票价、路线、顺序或预算结论。
- LLM 成功必须同时满足 HTTP 成功、合法 JSON、Schema 通过和语义证据通过；否则整次切回规则解析器，不拼接部分字段。
- 429、超时、服务过载、非法 JSON 和语义失败都保留用户原文、结构化设置和上一份成功行程。
- 初次接入先用固定测试集比较规则与 LLM，不立即成为线上默认；通过后再决定是否把 `useLlm` 从实验开关升级为默认。

## 7. 工作包与批准边界

### A. v0.4 本地体验与预算工作包

用户批准后才执行：

1. 把本文件的 40 条票价 assertion 写入版本化数据层并扩展验证报告。
2. 增加旅客价格档案、门票已知区间、公共交通封顶预留、卡费选项和未知费用清单。
3. 把预算比较改为 `definitely_over / within_verified_range / needs_confirmation`，保留餐饮和活动未知边界。
4. 实现此前已设计的热门卡、11:00、CBD 起点、完整下午排程、密度和候选弹窗。
5. 只做本地测试和预览，不上传线上版本。

### B. 联网自然语言解析实验工作包

这是独立的外部依赖和密钥工作包，即使 A 获批也不自动执行。开始前还需：

1. 用户确认供应商，并自行创建测试 Key；
2. 确认 WorkBuddy 是否能发布服务端路由和安全环境变量，或批准使用独立 BFF；
3. 在中国境内普通网络实测供应商 API 与最终 BFF；
4. 明确每日请求上限、超时、并发、日志保留和停止开关；
5. 使用固定解析矩阵通过后，才允许在线解析成为默认。

如果暂不批准 B，v0.4 仍使用增强后的本地规则解析器，完整支持已冻结的 Melbourne、1–3 天、CBD 起点、11:00 与户外／市内偏好。

## 8. 待实施验收补充

1. 40 条 POI 都有明确 price status；22 条免费、9 条可形成固定／起价／区间、8 条活动依赖、1 条未核实，统计可由数据验证脚本重算。
2. 免费场馆明确披露“特展／活动可能另计”；活动依赖和未核实项目从不写成 A$0。
3. Melbourne Museum、Old Melbourne Gaol、Cooks' Cottage、SEA LIFE 等固定回归值与本文件快照一致，并携带来源和核验日期。
4. 工作日、周末／公共假日、全步行、可能乘车和未来真实 FTZ-only 五类交通场景分别通过。
5. 2027-01-01 及以后的旅行不使用本次临时半价表；提示刷新官方费率。
6. 实体 myki 卡费只在用户选择购买时加入；contactless 不加卡费，优惠资格不由系统猜测。
7. SkyBus 和其他机场成本不混入 myki 日封顶。
8. 没有真实路线时，公共交通只显示预留区间和上限，不显示“精确交通费”。
9. 总预算低于已知最低值时显示确定超支；存在任何未知上界时不显示“预算充足”。
10. 参考站固定墨尔本输入的错误结果保存为负面回归：本项目必须正确保留 Melbourne、CBD、11:00、AUD 和 3 天非空行程。
11. LLM 返回额外字段、错误城市、无证据时间、币种改变或未知 POI 时必须校验失败并整次降级。
12. API 超时、429、服务端错误或中国网络不可达时，本地规则路径仍能生成，上一份成功行程不被覆盖。
13. API Key 不出现在前端构建、浏览器网络记录、版本库、日志或错误响应中。
14. 本轮在用户再次批准前不修改代码、运行数据、密钥、发布配置或线上版本。
