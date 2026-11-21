# 中国境内 LLM 后端托管：候选决策（2026-09-17 更新）

## 目标与边界

保留现有 WorkBuddy 墨尔本旅行网页及网址，仅为用户主动点击的“AI 辅助理解”提供独立 HTTPS 解析接口。百炼 API Key 只在服务端；网页不出现管理入口、邀请码或可迁移组件。LLM 只抽取旅行需求，POI、时间、预算和约束检查仍由现有确定性逻辑决定。此文是选型记录，**不是部署许可或上线验收**。

用户希望托管平台与计算地域位于中国内地。此前的 Cloudflare Worker／Durable Object 方案暂停；本机没有登录 Cloudflare，也没有创建资源。现已在本地新增独立的腾讯云事件函数 URL 与 CloudBase 账本适配，详情见 [`31_TENCENT_SCF_ADAPTER.md`](31_TENCENT_SCF_ADAPTER.md)；**尚未创建云资源、实测云端事务或开放模型调用**。

## 候选路线

| 方案 | 适配理由 | 阻断点 |
| --- | --- | --- |
| **阿里云函数计算 FC（华北 2／北京；有已备案域名时优先）+ 持久原子预算存储** | 当前百炼适配器固定使用北京地域兼容接口；FC 支持 HTTP 函数、环境变量及北京地域。可维持 WorkBuddy 前端，不必迁移网站。[FC 地域](https://help.aliyun.com/zh/functioncompute/fc-endpoints)、[FC 环境变量](https://help.aliyun.com/zh/functioncompute/environment-variables) | 必须把 Worker 请求入口改为 FC 运行时适配器，并把 Cloudflare Durable Object 账本改为经过并发验收的中国境内持久存储。面向公开网页的稳定入口需要符合 FC 的自定义域名及备案要求；默认函数域名仅适合测试。[FC 域名](https://help.aliyun.com/zh/functioncompute/configure-custom-domain-names)、[HTTP 触发器限制](https://help.aliyun.com/zh/functioncompute/http-triggers-overview) |
| **备选：腾讯云 CloudBase（中国内地环境）** | 官方 HTTP 访问服务可把云函数、云托管和静态托管放在统一入口；CodeBuddy IDE 另有 CloudBase 等部署入口。[CloudBase HTTP 访问](https://cloud.tencent.com/document/product/876/122894)、[CodeBuddy 部署](https://www.workbuddy.cn/docs/ide/User-guide/deploy) | WorkBuddy 个人版当前应用的静态发布与 CodeBuddy IDE／腾讯云 CloudBase 不是同一项已证实的托管服务。CloudBase 默认域名有期限、频率等限制，正式服务建议已备案自定义域名；仍需独立预算与密钥配置。[CloudBase HTTP 访问](https://cloud.tencent.com/document/product/876/122894) |

### 没有自有域名时的独立接口候选

腾讯云云函数 SCF 的**函数 URL** 与 API 网关默认子域名不同。官方[函数 URL 概述](https://cloud.tencent.com/document/product/583/96099)说明它提供专用公网 HTTPS 地址，创建后端点保持不变；[创建说明](https://cloud.tencent.com/document/product/583/100227)列出公网访问、CORS 和开放／CAM 鉴权设置。因此可以研究：保留 WorkBuddy 前端，把小范围演示的 BFF 放在中国内地 SCF，并使用平台分配的函数 URL，用户无需先购买域名。此处仅是候选，尚未确认本账号资格、地域、费用、浏览器响应、平台使用限制或中国普通网络可达性，**没有部署或开放模型调用**。

不要把该候选与腾讯云 [API 网关默认子域名](https://cloud.tencent.com/document/product/628/11827)混为一谈：后者官方明确仅供联调测试、不建议作正式服务。即使函数 URL 可用，“开放”鉴权也意味着任何人可请求；CORS 不阻止非浏览器调用，服务端共享预算、总体限流及费用硬停仍不可省。

阿里云表格存储的[局部事务](https://help.aliyun.com/zh/tablestore/local-transactions)和[条件更新](https://help.aliyun.com/zh/tablestore/conditional-update-by-using-cli-or-sdk)是预算后端候选，不代表现有 Cloudflare 账本已经可迁移。必须保证“检查剩余额度、记唯一请求、预留上界”在并发下不可分割；否则公网模型入口保持关闭。

## WorkBuddy 能力的区别

- WorkBuddy [模型配置](https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Model)支持为**WorkBuddy 助手本身**添加自定义模型／API，配置留在本机；这不等于公开旅行网页取得该 API 的服务端调用权限。
- WorkBuddy [轻量发布](https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Library/Lightweight-Publish)可把 HTML 产物发布为链接并随时取消发布；[更新日志](https://www.workbuddy.cn/docs/workbuddy/Changelog)还记录“数据管理—应用”可直接发布／取消发布。这说明有更好的产物管理，但不能据此推断现有 `app.workbuddy.host` 应用支持后台函数、密钥托管或原子数据库。
- WorkBuddy 分配的 `melbourne-tripagent.app.workbuddy.host` 可继续作为**前端**公开地址，但不等于用户拥有可绑定到阿里云 FC 的自定义域名。FC 绑定要求已备案／接入备案的域名，并由域名解析管理方把 CNAME 指向 FC；当前没有证据表明用户能修改 WorkBuddy 子域名的 DNS，或 WorkBuddy 会代为将该子域名接入 FC。不能据此推断 `workbuddy.host` 本身未备案；阻断点是此子域名的配置控制权与后端绑定条件。[FC 自定义域名](https://help.aliyun.com/zh/functioncompute/configure-custom-domain-names)
- [Buddy 应用](https://open.workbuddy.cn/docs/buddy-app)可配置模型池、工作模式、技能和连接器，但属于另一种面向 WorkBuddy 客户端的应用形态，涉及开放平台配置和审核；不是给当前网页加一项开关。[第三方应用 Open API](https://open.workbuddy.cn/docs/third-party-app)主要用于授权访问 WorkBuddy 用户与任务能力，也不是公开网页的通用 LLM 代理。

## 未满足的发布条件

1. 在账号控制台确认阿里云 FC 北京地域可开通、百炼 Key 类型与免费额度“用完即停”状态；不能凭本机曾调用成功推断账号现状。
2. 用户目前没有自己的已备案域名；WorkBuddy 分配的前端子域名不满足可自行解析并绑定 FC 的条件。阿里云文档要求公开网站类型服务使用已备案自定义域名，默认 HTTP 触发器地址只供测试，因此不把阿里云默认地址接到公开网页。若考虑腾讯云 SCF 函数 URL，先在真实账号中核对它与 API 网关默认域名的差异、使用限制和费用，再决定是否用于小范围演示。
3. 核实 FC、预算存储、出网流量及百炼分别如何计费；FC 试用包耗尽后可能转按量付费，不能把“有免费试用”写成零费用保证。[FC 计费](https://help.aliyun.com/zh/functioncompute/billing-overview-of-fc)
4. 腾讯云入口与中国境内预算适配器的本地实现及模拟测试已完成；仍需真实账号下的云端预算并发／持久测试、一次受控真实百炼请求与费用核对。网页原文只在用户明确点击后传给已说明的数据接收方。阿里云 FC 入口未实现，保留为备选。
5. 从中国普通网络测试 WorkBuddy 网页、独立 HTTPS 接口及完整回退；检查 `acceptedMode`，不能只以 HTTP 200 判定 LLM 成功。全部通过后再考虑同链接更新网页。

上述条件没有完成前，现有线上网页继续保持规则版。需要新建收费云资源、购买域名／套餐、备案或公开启用模型时，先由用户确认具体账号、费用与动作。
