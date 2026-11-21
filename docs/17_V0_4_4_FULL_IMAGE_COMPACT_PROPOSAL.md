# v0.4.4 全量地点图片与紧凑条件摘要

## 1. 本轮范围

本轮只修改本地版本，不发布到 WorkBuddy：

1. 让规划器中的 40 个 Melbourne POI 都有可辨认的本地实景图。
2. 保持首页精选轮播为 10 个地点，不因补齐图片而膨胀成 40 张卡片。
3. 将“我理解的是”改为 `也许你想……`。
4. 将基础七项条件从七张独立卡片收进一个共享面板，降低高度和视觉噪声。

规划算法、自然语言解析规则、冲突定位、确认门、替换与撤销逻辑均不改变。

## 2. 图片数据结构

图片与精选列表分开维护：

- `site/data/poi-media-v0.4.4.json`：40 个地点的完整运行时图片清单。
- `site/data/featured-pois-v0.4.json`：首页仍然展示的 10 个编辑精选地点。
- `data/curation/poi-media-v0.4.4.json`：新增 30 张图片以及 2 张精选替换图的固定 Commons 文件映射与地点匹配依据。
- `data/raw/media/poi/`：本地来源副本。
- `site/public/poi/`：网页实际读取的副本。

`POI_PHOTOS` 代表完整 40 项图库；`FEATURED_POI_PHOTOS` 只按精选清单取 10 项。每日行程、替代地点和来源说明使用完整图库，首页轮播使用精选子集。

## 3. 来源、许可与地点匹配

新增图片来自 Wikimedia Commons。同步脚本通过 MediaWiki `imageinfo` 读取原文件地址、MIME、尺寸、SHA-1 和扩展元数据，网页不热链远程图片。

只接受：

- CC0 1.0；
- Public domain；
- CC BY 2.0／2.5／2.5 AU／3.0／4.0；
- CC BY-SA 2.0／2.5／2.5 AU／3.0／4.0。

NC、ND、未知许可、fair use、仅编辑用途和 GFDL-only 均被拒绝。每条记录至少保留 Commons 文件页、作者、许可、许可链接、署名、地点匹配证据和本地文件哈希。

地点匹配优先采用准确英文维基百科条目的主图；缺少主图时使用 Commons 分类、结构化 depicts、文件说明或 POI 坐标附近的地理检索。不能只凭“看起来相似”选图。特别复核了 Federation Square／Flinders Street Station、Melbourne Museum／Royal Exhibition Building、NGV International／Ian Potter Centre、IMAX／Melbourne Museum 和相邻公园等易混组合。

## 4. 视觉复核

40 张图片以 4 × 10 联系表统一检查，并按页面使用的居中 4:3 缩略图复核：

- 建筑应能看到立面、入口、名称或稳定的建筑特征；
- 公园应能看到有来源支持的园路、绿地或园内标志景观；
- 体育场馆可使用能明确辨认场地的内部全景；
- 不使用同名异城、相邻地点抢主体、Logo、海报或 AI 生成图。

本轮同时替换了两张已有图片：Federation Square 改为能直接看到广场活动空间的照片；Melbourne Museum 改为入口处带 `MUSEUM` 字样的现代建筑照片。Docklands Park 也由电车站画面改为园内 Reed Vessel 水景与绿化。

图片加载失败时，`PoiVisual` 仍会安全降级为类别示意；文案明确说明是加载失败，不会误称为“没有已核验图片”。

## 5. 条件摘要布局

标题为 `也许你想……`，副文案说明这些条件需要用户确认后才会生成或更新行程。

基础条件按稳定 `id` 分组，不依赖数组位置：

- 行程范围：天数、每天起点、每天出发、主要活动区域；
- 偏好与同行：节奏、室内外偏好、同行人员；
- 其他偏好：体验、避开体验、少走路、亲子、预算等动态项目。

七张带阴影的按钮卡已删除，改为语义化 `<dl>/<dt>/<dd>`：桌面基础信息两排，移动端最多四排。来源文字 `描述中提到／详细设置／暂用默认／需要补充` 始终保留，颜色只作辅助；原文证据继续放在来源标签的说明中。统一的 `修改条件` 按钮仍打开详细设置，冲突面板中的逐项跳转不受影响。

## 6. 可复现同步

```bash
node scripts/sync-poi-media.mjs
```

脚本会批量查询固定的 Commons 文件、验证许可与 JPEG 响应、下载最长边不超过 1280px 的本地副本并生成 40 项运行时清单。任何缺图、错误 MIME、文件过小、许可缺失或非白名单许可都会中止。

重新同步后必须再次制作联系表并人工核对，再运行：

```bash
node scripts/sync-poi-media.mjs --mark-reviewed
```

该命令只记录已经完成的视觉复核，不发起网络请求。

## 7. 本地验收

- 图片清单恰好 40 个唯一 POI ID，并与规划器数据集集合完全相同。
- 40 个 `imageSrc` 唯一且本地文件存在，每个文件大于 10 KB。
- `getPoiPhoto()` 对 40 个 POI 均返回图片。
- 首页 `FEATURED_POI_PHOTOS` 仍严格为 10 个，顺序与原精选清单一致。
- 70 项 Vitest 与 5 项 Node 导入测试通过。
- TypeScript、Oxlint、POI 数据校验、格式检查、生产构建和静态包校验通过。
- `http://localhost:3000/poi/webb-bridge.jpg` 返回 `200 image/jpeg`，证明新增静态图片由本地预览正常提供。

本轮没有调用 WorkBuddy／Sites hosting，没有改动线上版本。

## 8. 模型路由记录

- 图片许可、地点匹配与摘要信息结构：L4，使用 `gpt-5.6-sol / ultra` 子任务复核。
- 资产盘点与机械实现审计：L1–L2，使用 `gpt-5.6-luna / low`。
- Site 文件最终编辑、真实下载、测试和构建由主任务完成；主任务的精确运行模型在界面不可验证，因此不虚构型号。
