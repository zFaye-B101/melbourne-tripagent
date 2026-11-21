# 共享预算本机接线验收（2026-09-16）

## 完成的本地接线

- BFF 已加入可选的**仅本机**预算包装器：服务端固定 `public-demo` 共享主体、请求唯一 ID 和单次最大预算单位；预留成功才进入供应商适配器，异常或费用不明不自动返还。
- `TripBudgetDurableObject` 使用独立 `llm-gateway-kit` 的 SQLite 同步事务账本。项目 Wrangler 4.92 要求 `new_sqlite_classes` 迁移声明；`wrangler deploy --dry-run` 已检查打包与绑定，但**没有部署**。
- 公网请求仍在预算、限流、供应商之前由现有硬门槛拒绝。`LLM_LOCAL_BUDGET_ENABLED` 只能启用本机测试，不能打开公网模型调用。

## 隔离验证

使用 `/private/tmp/` 下的无密钥临时配置和独立持久目录，以 `127.0.0.1:8789` 运行本机 Worker。原项目的 `.dev.vars` 在初次启动时被 Wrangler 自动发现；该服务已在任何测试请求前停止。之后的测试全部改用隔离配置，不读取或传递真实 API Key，不访问供应商。

| 场景 | 观察结果 |
| --- | --- |
| 单次预留 2 单位、总额 1 单位 | `attemptedMode=llm`，`acceptedMode=rules`，`fallbackReasonCode=rate_limited`；供应商未调用 |
| 单次预留 2、总额 2，首次请求 | 先预留；因为隔离配置没有密钥，安全回退 `auth_or_config` |
| 同预算期第二次请求 | `rate_limited`，没有重新获取调用许可 |
| 停止并重启本机 Worker 后第三次请求 | 仍为 `rate_limited`，证明此次本地持久目录保留了预留状态 |

验证后已停止临时 Worker，8789 端口不再监听。页面、线上 WorkBuddy 网址和公网 LLM 开关均未更改。

## 仍不能声称完成

本机持久与模拟测试不等于 Cloudflare 云端跨实例并发通过，也不证明供应商真实账单的单次人民币费用上界。百炼账号的免费额度余额、用完即停状态、真实 HTTPS BFF、中国普通网络可达性、页面同意体验和真实模型调用仍需单独验收；在此之前公网硬门槛保持关闭。
