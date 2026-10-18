# 市场证据台

面向 A 股研究的市场状态工作台。产品围绕行情结构、市场宽度、风格、估值、流动性、情绪和事件呈现可追溯证据，帮助用户观察市场状态及需要重新评估的条件。

## 当前交付状态

工作台、合成演示、指标、证据抽屉、JSON／Markdown 导出、扶摇 REST 适配器和结构化 AI 报告适配器已进入实现。默认本地模式为清楚标注的合成演示。扶摇官方接口契约已核对，但真实 API Key、接口权限、字段映射、真实模型调用和托管部署尚未验证。

带有扶摇 Key 时，live 模式可以获取指数日线和最新全市场快照，按代码计算指标；宽度仅在快照时点与最近已完成交易日一致且分页完整时可用。配置 OpenAI Chat Completions 兼容的模型服务后，服务端会基于本轮已验证证据生成结构化归纳、观察、反证和不确定事项，并校验证据引用。iFinD MCP 尚未连接。缺少真实能力时，页面显示缺口，不会用演示值代替。

## 本地运行

要求 Node.js 22.13 或更高版本。安装依赖并启动：

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
```

不要把真实密钥提交到 Git 或粘贴到聊天。只配置 Key 不代表接口权限、展示授权或数据质量已验证。模型端点须支持 Chat Completions 的 JSON Object 输出；模型报告中的摘要、观察和反证均须引用本轮证据 ID，否则会被隐藏。iFinD 变量目前只是预留。

## 设计选择与 AI 职责

- 代码负责输入和日期校验、数据读取、交易日对齐、指标、规则标签、质量传播、证据与导出。
- 运行时模型连接后，AI 只能围绕服务端已验证证据生成有引用的归纳、反证和不确定事项；不得更改数据、指标、阈值或置信度上限。
- 演示环境不调用模型；live 模式只有在服务端模型凭据可用且报告通过校验后才显示 AI 研判。
- 产品不预测未来涨跌或上涨概率，不提供仓位、买卖指令或收益承诺。

## 数据来源和局限

扶摇官方接口结构与接入状态记录在 [`docs/data-capabilities.md`](docs/data-capabilities.md)。代码使用指数历史日线、近一年交易日历和全市场最新快照；指数代码映射、授权、真实响应及部署出网仍待 live 验证。市场宽度不能由最新快照回填旧历史日期。当前未实现指数估值、情绪、事件与 iFinD。

演示序列为代码生成的合成数据，不是实际市场记录。live 上游失败不会静默降级为 demo。

## 文档

- [原始需求](docs/source-requirements.md)
- [完整开发执行计划](docs/development-plan.md)
- [市场观察方法](docs/methodology.md)
- [数据能力与验证状态](docs/data-capabilities.md)
- [开发进度与阻塞](docs/progress.md)
- [AI 使用与验证记录](docs/ai-usage-and-validation.md)
- [测试说明](docs/testing.md)
- [实现决策](docs/decisions.md)

## 已知边界

当前 Sites 项目已注册但尚未部署；源码还未推送到正式仓库。完整 MVP 仍需真实扶摇与模型调用、最终访问权限检查和部署后主链路验证。
