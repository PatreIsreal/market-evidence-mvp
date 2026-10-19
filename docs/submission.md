# 项目交付与当前运行状态

更新时间：2026-10-19（北京时间）

| 项目 | 当前状态 |
| --- | --- |
| 公开体验 | [市场证据台](https://market-evidence-desk-20261018.minty-genet-8078.chatgpt.site)；2026-10-19 已验证匿名 live health 与真实研究流 |
| 公开源码 | [GitHub：market-evidence-mvp](https://github.com/PatreIsreal/market-evidence-mvp) |
| 自托管版本 | Ubuntu/Docker 服务器上的 VPN 内实例；端口 3180，具体内网地址不放入公开文档 |
| 当前研究能力 | 公开 Sites v9 端到端运行；扶摇行情、情绪、快讯候选和 DeepSeek 报告真实研究流均成功，`done=complete` |
| 本次数据状态 | 2026-10-19 行情截止；情绪和事件候选 available，10 条新闻候选中有事件证据被报告引用；七维覆盖率 57% |
| 尚未完成 | 指数估值历史与 iFinD 未接入；市场宽度没有历史序列；事件候选仍需重大性、交叉来源核验和展示授权确认；自托管版本尚未升级 |
| 数据许可 | 扶摇数据在公开托管、页面展示和导出中的授权范围仍需确认 |

## 研究是否能跑通

**公开版核心研究 MVP 可以跑通，但七维数据仍不完整。** 2026-10-19 Sites v9 匿名研究流 HTTP 200 并以 `done=complete` 结束；扶摇情绪统计与 10 条近期 A 股快讯候选 available，DeepSeek 报告在反证中引用事件证据，覆盖率 57%。指数估值历史和逐日市场宽度仍缺；自托管版本尚未升级，因此这不代表七维完整。

公开研究请求会使用服务端配置的扶摇与 DeepSeek 额度；当前站点没有登录或请求限流。扶摇数据公开展示和导出的授权范围仍待确认。

“能跑通”指已接通的研究路径，不表示七维数据完整：公开版本已有情绪代理和新闻候选；指数估值历史、历史宽度和事件交叉核验仍缺。详情见[项目现状与迭代路线图](项目现状与迭代路线图.md)。

## 验收材料

- [原始需求](source-requirements.md)
- [完整开发执行计划](development-plan.md)
- [项目现状与迭代路线图（压缩版）](项目现状与迭代路线图.md)
- [方法说明](methodology.md)
- [数据能力与来源](data-capabilities.md)
- [AI 使用与验证记录](ai-usage-and-validation.md)
- [测试说明](testing.md)
- [开发进度](progress.md)
- [自托管部署](self-hosted-deployment.md)
