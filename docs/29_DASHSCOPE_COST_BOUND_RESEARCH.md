# 百炼单次费用上界：资料推算与未核实项（2026-09-16）

## 已固定的请求条件

TripAgent 的百炼适配器只选 `qwen3.8-flash`，使用北京 Workspace 的文本 Chat Completions；请求固定 `n=1`、关闭思考与联网搜索，设置 `max_completion_tokens=4096`。相比仅限制回答文字的 `max_tokens`，`max_completion_tokens` 限制完整输出（包括可能的思考部分）；[百炼接口文档](https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions)还说明实际输出 Token 数与此值最多可能相差 10 个。

[模型官方说明](https://help.aliyun.com/zh/model-studio/qwen3-8-flash)列出最大输入 991,808 Token；北京地域的原价为输入 0.8 元/百万 Token、输出 2.7 元/百万 Token。按完整输入上限、输出 4,096+10 Token 和原价计算：

`(991808 × 0.8 + 4106 × 2.7) / 1000000 = 0.8045326 元/次`，向上取整为 **0.81 元/次**。

这个数字只是**指定模型、北京原价和上述参数下的资料推算**，不是账号实际费用承诺；请求的实际输入通常远低于模型上限。项目尚未将 0.81 元写入线上预算配置，也未执行真实模型账单验收。

## 公开启用前必须验证

1. 当前 API Key 确实指向北京地域、该 Workspace 和 `qwen3.8-flash`，且使用普通实时推理计费，而非价格或条款不同的产品。
2. 控制台当前的适用价格、免费额度余量与“免费额度用完即停”状态；[阿里云说明](https://help.aliyun.com/zh/model-studio/new-free-quota)指出已认证账号若未启用用完即停，免费额度耗尽后可能转为按量付费，配置生效也可能延迟。
3. 在明确授权的受控测试里核对 `max_completion_tokens` 实际生效、供应商 `usage` 与账单；若观察到与官方条件不符，停止使用上述推算。
4. 最终预算单位、单次预留数和总演示额度要由服务端固定并在云端并发测试后开启。模型调用预算不包含 Cloudflare 等托管设施的可能费用。

在这些检查完成之前，公网 LLM 硬门槛继续关闭。不能仅凭本页公式、配置标记或免费额度说明声称“完全不会产生费用”。
