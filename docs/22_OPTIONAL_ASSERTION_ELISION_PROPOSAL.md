# 无证据可选断言舍弃：本地实验提案

状态：**本地实验已实现并通过合成测试；默认关闭；两次真实 Provider smoke 均未通过 LLM 采纳验收，未发布**。本策略不改变现有 Evidence Binding v1 或线上解析行为。

## 背景与目标

固定的本地百炼测试在 Prompt v2.3 与 v2.4 下均到达模型，但最终回退规则解析。脱敏诊断只指出首个失败为 `/family` 缺少 evidence；它**不能**说明模型给的是 `true` 还是 `false`，也不能说明后续字段是否合格。

目标是研究能否安全丢弃一个未获原文证明的*可选断言*。本策略不能创造证据、改变硬约束、合并 LLM 与规则的部分结果，或保证上述真实测试会通过。

## 冻结边界

仅在原 Draft 已通过 Schema 后，考虑对 `/family` 做如下处理：

1. `family` 必须严格等于 `false`，且 `/family` 完全没有 evidence 坐标；若有伪造、重复或错误坐标，保持原样并由既有 evidence 校验拒绝。
2. 独立且保守的原文检查必须**未发现已知的**亲子／儿童同行表述。规则解析结果为 `family=false` 只能作为必要条件，不可单独作为证明。明确肯定、明确否定、儿童年龄、模糊表述或检查器无法判定时，一律不处理。关键词检查不能保证识别所有说法，因此本规则仍是默认关闭的本地实验。
3. 在深拷贝中把该值改为 `null`，不添加、删除或复制任何 evidence；原 Provider Draft 不得被修改。
4. 随后运行既有 Evidence Binding v1，并重新通过完整 Schema、原文 evidence、语义和规范化校验。任何其他失败仍整次回退规则。

`true`、人数、儿童年龄、预算、目的地、日期、地点、地理范围和硬约束均不在白名单。不得把“2 位成人”“4 岁儿童”等原文坐标复制为 `/family` evidence。这个策略与“补证据”不同，只会降低未获证明的可选断言，不会采纳它。

## 实施与验收门

实现位置为 `site/app/lib/optional-assertion-elision.ts`；`nlu-orchestrator.ts` 的 `enableOptionalAssertionElision` 默认是 `false`。BFF 仅在 `LLM_OPTIONAL_ASSERTION_ELISION=true`、`LLM_RUNTIME_ENV=local` 且请求主机为本机回环地址时传入该选项；缺少开关或生产环境均保持关闭。开关不属于 HTTP 请求／响应，不会由浏览器指定。关闭开关即可恢复原解析顺序。

合成 Draft 测试覆盖：无亲子表述的 `false` 无证据只变为 `null`；`true`、明确肯定／否定、模糊表述、儿童年龄、伪造／重复坐标不会被舍弃；原 Draft 保持不变。端到端离线测试确认开关关闭仍因缺证据回退，开启后只在其他字段全部合格时才能获得 `acceptedMode=llm`；生产环境开关误设为 `true` 也不起作用。测试没有调用真实模型。

本规则是 Evidence 校验前的受限舍弃，不是 Evidence 失败后的拼接修复，也不能藏在 normalization 内。`docs/10_LLM_API_CONTRACT.md` 与 `docs/18_V0_5_LLM_ROLE_AND_PROVIDER_CONTRACT.md` 同步记录了该本地例外；公开 Parse API 和生产默认值不变。

用户批准后的单次本地真实请求得到 HTTP 200、`attemptedMode=llm`，但 `acceptedMode=rules`、`fallbackReasonCode=semantic_rejected`；安全诊断的首个失败为 `semantic.evidence_not_proven`，路径 `/geography/scope`。因此本实验没有通过真实模型采纳验收。不能从这条诊断断定 Provider 的 `/family` 实际值，也不能把回退响应中四个 evidence path 的 `false` 当作 Provider 原始 Draft 的缺失情况。

Prompt v2.5 修正起点／活动区域示例后，用户另行批准的单次复验仍为 HTTP 200、`attemptedMode=llm`、`acceptedMode=rules`，首个安全失败是 `semantic.evidence_not_proven`，路径 `/mustIncludeNames`。这说明该次请求到达后续校验阶段，但不能证明旧字段在所有模型输出中稳定正确，也不能得知原始地点值或 quote。

是否再发送真实请求、使用账号额度及是否最终接入网页，需要用户另行确认。即使后续单条请求获得 `acceptedMode=llm`，也不能替代多场景质量、隐私、成本和部署验收。
