# 项目交付与当前运行状态

更新时间：2026-10-19（北京时间）

| 项目 | 当前状态 |
| --- | --- |
| 公开体验 | [市场证据台](https://market-evidence-desk-20261018.minty-genet-8078.chatgpt.site)；公开发布完成后以首页和真实研究流复测为准 |
| 公开源码 | [GitHub：market-evidence-mvp](https://github.com/PatreIsreal/market-evidence-mvp) |
| 自托管版本 | Ubuntu/Docker 服务器上的 VPN 内实例；端口 3180，具体内网地址不放入公开文档 |
| 当前研究能力 | 真实扶摇行情与 DeepSeek 研究主流程已完成端到端验证；指数行情、市场宽度、风格和成交额可用 |
| 尚未接入 | 指数估值、情绪、重要事件、iFinD；历史市场宽度不能由当前快照回填 |
| 数据许可 | 扶摇数据在公开托管、页面展示和导出中的授权范围仍需确认 |

## 研究是否能跑通

**可以跑通核心研究 MVP。** 2026-10-18 自托管 live 版本使用扶摇交易日历、指数历史行情和全市场快照，完成 DeepSeek 计划及证据归纳；服务器研究流以 `done=complete` 结束。首页、health、capabilities 和历史/追问流程均有实测记录。建议演示问题：“指数走势与市场参与度是否一致？”

“能跑通”指已接通的研究路径，不表示七维数据完整：估值、情绪和事件当前明确显示缺口；历史区间没有可回填的逐日市场宽度。详情见[项目现状与迭代路线图](项目现状与迭代路线图.md)。

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
