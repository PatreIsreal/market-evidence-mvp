# 市场证据台

面向 A 股研究的市场状态工作台。产品围绕行情结构、市场宽度、风格、估值、流动性、情绪和事件呈现可追溯证据，帮助用户观察市场状态及需要重新评估的条件。

## 当前交付状态

工作台、合成演示、指标、证据抽屉、JSON／Markdown 导出、扶摇 REST 适配器和结构化 AI 报告适配器已实现。自托管版本已在服务器运行；公开 Sites 也已匿名验证真实研究流，DeepSeek `deepseek-flash` 报告通过证据校验并以 `done=complete` 结束。2026-10-19 公开测试的行情截止 2026-10-16，但全市场快照被判为 stale，因此市场宽度明确显示不可用，报告覆盖率为 67%。模型引用的数值必须能由引用证据或本轮研究范围支持，否则隐藏 AI 报告并保留代码计算结果。

live 模式会获取指数日线和最新全市场快照，按代码计算指标；宽度仅在完整分页、市场收盘确认且能对应最近已完成交易日时可用。模型先从受限的行情、市场宽度、风格维度中选择研究范围，再基于返回证据生成结构化归纳、观察、反证和不确定事项；服务端会校验证据引用及数值。iFinD MCP 尚未连接；本机技能配置目前未通过认证。估值、情绪和事件维度保持明确缺口，不会用演示值代替。

## 本地运行

本地开发要求 Node.js 22.13 或更高版本。安装依赖并启动：

```sh
npm install
npm run dev
```

执行检查：

```sh
npm test
npm run typecheck
npm run lint
npm run build
```

测试使用独立的 Vitest 配置；扶摇适配器的单测使用模拟 HTTP 响应，不等于真实 API 冒烟。

## 环境配置

本地运行时由 Cloudflare/Vinext 读取忽略文件 `.dev.vars`。当前示例默认 `APP_DATA_MODE=demo`。如需 live，可在本地未跟踪文件或托管 secret 中配置：

```dotenv
APP_DATA_MODE=live
FUYAO_BASE_URL=https://fuyao.aicubes.cn
FUYAO_API_KEY=仅服务端使用的密钥
MODEL_BASE_URL=https://api.openai.com/v1
MODEL_API_KEY=仅服务端使用的密钥
MODEL_NAME=你的可用模型名称
# DeepSeek 推荐关闭默认思考模式，以便稳定输出结构化 JSON
MODEL_THINKING_MODE=disabled
```

不要把真实密钥提交到 Git 或粘贴到聊天。只配置 Key 不代表接口权限、展示授权或数据质量已验证。模型端点须支持 Chat Completions 的 JSON Object 输出；模型报告中的摘要、观察和反证均须引用本轮证据 ID，否则会被隐藏。使用 DeepSeek 时，可将 `MODEL_BASE_URL` 设为 `https://api.deepseek.com`、`MODEL_NAME` 设为 `deepseek-flash`，并设置 `MODEL_THINKING_MODE=disabled`。iFinD 变量目前只是预留。

## 设计选择与 AI 职责

- 代码负责输入和日期校验、数据读取、交易日对齐、指标、规则标签、质量传播、证据与导出。
- 运行时模型连接后，AI 只能围绕服务端已验证证据生成有引用的归纳、反证和不确定事项；不得更改数据、指标、阈值或置信度上限。
- 演示环境不调用模型；live 模式只有在服务端模型凭据可用且报告通过校验后才显示 AI 研判。
- 产品不预测未来涨跌或上涨概率，不提供仓位、买卖指令或收益承诺。

## 数据来源和局限

扶摇官方接口结构与接入状态记录在 [`docs/data-capabilities.md`](docs/data-capabilities.md)。上证、深证成指、创业板、沪深 300 与中证 1000 的 live 取数已验证；全市场快照曾能计算最近完成交易日的宽度，但 10-19 公开研究时快照被判 stale，需恢复稳定的新鲜度。不能回填旧历史日期。数据展示授权仍待确认。当前未实现估值、情绪、事件与 iFinD 适配器。

演示序列为代码生成的合成数据，不是实际市场记录。live 上游失败不会静默降级为 demo。

## 文档

- [项目现状与迭代路线图（压缩版）](docs/项目现状与迭代路线图.md)
- [原始需求](docs/source-requirements.md)
- [完整开发执行计划](docs/development-plan.md)
- [市场观察方法](docs/methodology.md)
- [数据能力与验证状态](docs/data-capabilities.md)
- [开发进度与阻塞](docs/progress.md)
- [AI 使用与验证记录](docs/ai-usage-and-validation.md)
- [测试说明](docs/testing.md)
- [自托管部署](docs/self-hosted-deployment.md)
- [项目交付状态](docs/submission.md)
- [实现决策](docs/decisions.md)

## 已知边界

公开体验：[市场证据台](https://market-evidence-desk-20261018.minty-genet-8078.chatgpt.site)。公开源码：[GitHub 仓库](https://github.com/PatreIsreal/market-evidence-mvp)。公开版本由服务端保管扶摇与 DeepSeek 凭据；访客发起研究会使用配置账户的上游额度。自托管部署默认只监听本机回环地址；如需在 VPN 内访问，按[自托管部署说明](docs/self-hosted-deployment.md)设置绑定地址。
