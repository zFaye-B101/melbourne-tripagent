# POI 数据来源记录

## City of Melbourne Open Data

- 数据集：Landmarks and places of interest including schools, theatres, health services, sports facilities
- 数据集 ID：`landmarks-and-places-of-interest-including-schools-theatres-health-services-spor`
- 数据集页面：https://data.melbourne.vic.gov.au/explore/dataset/landmarks-and-places-of-interest-including-schools-theatres-health-services-spor/information/
- 许可：CC BY 4.0
- 归因：City of Melbourne Open Data
- 抓取日期：2026-09-14
- CSV SHA-256：`c79c6816a5155278cc99bc67898ada00a3fe1e1f4b77fd48d582deac85cf0aa0`
- 元数据 SHA-256：`97e1b4bb60b15049eba65e709ae921f89febbd4d01b4e98befe6ed7a805ee875`

本次 raw 快照共 242 行。开放数据直接支持英文名称、主题、子主题和坐标。中文名、产品分类、区域、建议停留时间、室内外、适配标签和摘要属于产品标注，不应表示为开放数据原字段。价格、营业时间、临时关闭、拥挤程度和无障碍信息没有写入静态事实，均应标记为 unknown/not_verified，并要求用户出发前从各景点官方页面复核。

该数据集没有 native row ID。canonical provenance 中的 `source_record_id` 使用可复现的项目级 `sourceRowKey = feature_name|latitude,longitude`，并明确标注这是项目生成的可复现键，不冒充数据集原生 ID。当前固定链路为 `raw -> versioned curation manifest -> normalized -> verified -> planner adapter`；精选范围为 40 条，其中 12 条保留 legacy ID、28 条新增。

## 页面视觉素材

- 文件页：https://commons.wikimedia.org/wiki/File:City_Skyline_of_Melbourne.jpg
- 作者：李沛钊
- 许可：CC BY-SA 4.0
- 页面署名：`Photo: 李沛钊 / Wikimedia Commons · CC BY-SA 4.0`
- 原始文件：`data/raw/media/city-skyline-of-melbourne-original.jpg`（4030×2267，3,261,982 bytes）
- 原始文件 SHA-256：`5d6967e89fe2cdd1bc3de1b2d3ae3f9f8bb30fda99b205ff677c316920320e7d`
- 页面派生文件：`site/public/melbourne-skyline.webp`（1600×901，280,664 bytes，WebP quality 82）
- 派生文件 SHA-256：`524b3f6b9dcbecb4f5e98819e9cbcef5e2c3a1512b64063bc7b3550c07348c76`

该照片仅用作页面中的墨尔本城市视觉素材，不作为 POI 字段证据。页面文件是从保留的原始授权图片缩放、压缩得到的展示副本，署名与许可保持不变。
