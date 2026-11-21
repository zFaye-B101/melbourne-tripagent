# 09. WorkBuddy 静态发布说明

## 当前结论

Melbourne TripAgent 已冻结为纯静态发布方案。行程解析、生成、地点替换和撤销均在浏览器内完成，不需要 Wrangler、数据库、API Key 或后台服务。

- 源码目录：`site/`
- 构建命令：在 `site/` 运行 `npm run workbuddy:build`
- 唯一发布目录：`site/dist/client/`
- 入口文件：`index.html`
- 发布类型：`static`
- 应用名：`Melbourne TripAgent`
- 当前线上状态：v0.5 G1 已覆盖发布（2026-09-16）
- 公开链接：<https://melbourne-tripagent.app.workbuddy.host/>
- 中国境内网络验收：待完成

本机当前发布目录：

```text
/Users/tako404/.codex/.chatgpt-projects/g-p-6a8eba479a1c8191abdb667aa8b13369/melbourne-tripagent/site/dist/client
```

## 为什么选择静态发布

当前 MVP 没有服务端接口、数据库、账号系统或运行时密钥。Vinext 的 `output: 'export'` 会把首页和所需脚本、样式、图片全部写入 `dist/client`，因此 WorkBuddy 只需托管这组文件。这样比运行 Cloudflare Worker 更简单，也更适合交给中国境内验收人员直接访问。

`site/` 仍保留原有 Wrangler 开发脚本，但它不属于本次 WorkBuddy 发布路径。不要把 `site/` 或项目根目录作为 Node 应用发布，否则可能误走 Wrangler 启动流程。

## 本地生成与检查

进入 `site/` 后运行：

```bash
npm run data:validate
npm test
npm run typecheck
npm run lint
npm run workbuddy:build
```

最后一条命令会重新生成静态文件，并检查：

- `dist/client/index.html` 存在；
- HTML 引用的同源脚本、样式、图标和图片均存在；
- 页面使用压缩后的本地 WebP 首图；
- 页面不依赖 Google Fonts，也不依赖 `/_next/image` 服务；
- `.openai/hosting.json` 的静态目录仍是 `dist/client`。

## 在 WorkBuddy 中发布

只有在准备公开上线时，才在 WorkBuddy 的最新一条消息中明确提出发布。例如：

> 请把 `/Users/tako404/.codex/.chatgpt-projects/g-p-6a8eba479a1c8191abdb667aa8b13369/melbourne-tripagent/site/dist/client` 作为 static 网站发布为应用，入口使用 `index.html`，应用名为“墨尔本行程助手”。不要构建或运行 Wrangler。

首次发布选择“创建新应用”；后续发布必须选择已有应用 `Melbourne TripAgent`，以更新同一个公开链接。不能根据文件夹名称自动覆盖其他应用。

本项目已于 2026-09-15 通过 WorkBuddy 内置 Sites 发布工具完成首版发布，运行类型为 `static`，入口为 `index.html`。发布后的独立浏览器验收确认首页可达，并成功从 Day 1 切换到 Day 2。

同日 v0.3 更新使用 `updateExistingApp=true` 覆盖现有应用，没有创建新应用。WorkBuddy 返回 `verified=true`；独立公网浏览器确认新初始页与两日纵向生成正常，9 个页面／资源请求均为 HTTP 200，控制台 0 error／0 warning。

2026-09-16，v0.4.4 使用注册标记中的既有应用 `wbapp_cFS2bnfmLJu6A0MoVMgysh` 再次覆盖发布，仍为 `updateExistingApp=true`、`language=static`、`entryHtml=index.html`，没有创建新应用。WorkBuddy 返回 `verified=true`、`deployedAs=web-page`；线上首页（57,504 B）和 `/poi/webb-bridge.jpg`（253,820 B）分别与本地发布文件的 SHA-256 完全一致。公开网址保持不变；中国境内可达性仍待境内用户实测。

同日，v0.5 G1 再次使用同一注册标记和现有应用完成覆盖上传。WorkBuddy 在上传步骤返回部署成功；随后完整资源审计耗时过长而被人工停止，但部署本身未回滚。独立无缓存请求确认公开网址仍为原地址，线上首页（58,408 B）的 SHA-256 为 `7bba8373fb8dddaa112ede3842b128a1f397f8dbf75acd71e514e30b6806f43a`，与本地新包完全一致；`/poi/webb-bridge.jpg` 也保持 `f9d25e29164bc36e0e478c6ff632295f2a30c83c7a5ead8d6898de3ded0d36a8`。当前线上生产路径仍是 `adapter: undefined`，没有真实 Provider、BFF、API Key 或供应商网络调用。

## 后续同链接更新

1. Codex 在本地完成源码修改、测试和 `npm run workbuddy:build`。
2. 确认新的静态产物仍位于 `site/dist/client/`，并通过 `npm run release:validate`。
3. 在 WorkBuddy 中明确提出“重新发布／更新”，选择已有应用 `Melbourne TripAgent`，不要创建新应用。
4. WorkBuddy 继续使用 `language=static`、`entryHtml=index.html` 发布该目录。
5. 发布后打开 <https://melbourne-tripagent.app.workbuddy.host/> 验证版本内容；网址保持不变。

职责边界：Codex 负责源码、测试和构建；WorkBuddy 只负责发布最终静态产物及后续覆盖同一应用。

## 中国境内验收

公开链接生成后，请让验收人员在中国境内普通网络下检查：

1. 首页、样式、图标和天际线图片能完整加载；
2. 生成 1／2／3 天行程均可用；
3. 缺少天数时会追问，外地城市和 4 天以上会阻止生成；
4. 必去、避开、换一个、撤销和 Day 切换均正常；
5. 外部 POI 来源链接打不开时，核心行程生成仍不受影响；
6. 手机宽度没有横向溢出或按钮遮挡。

本地成功不能证明中国境内链路一定可达。只有境内实测通过后，才能把状态升级为 `china_access_verified`。

## 回退顺序

1. WorkBuddy 未识别时，重新确认上传目录精确为 `site/dist/client`，类型为 `static`。
2. 若目录识别仍异常，再复制为独立静态发布目录；不改业务逻辑。
3. 只有静态托管被证明确实不兼容时，才评估符合 `$PORT` 与 `0.0.0.0` 约束的 Node 服务。
4. 仅当 Vinext 静态导出或页面激活在目标环境中失败，才考虑重写为普通 Vite SPA。
