# 测试说明

测试代码位置：`tests/unit/`。当前测试使用构造数据和模拟 HTTP 响应，不代表扶摇真实账户已授权，也不代替部署环境冒烟。

## 本地命令

```sh
npm test
npm run typecheck
npm run lint
npm run build
```

Vitest 使用独立的 `vitest.config.ts`，不加载 Sites 的 Cloudflare Worker 插件配置。

## 已执行结果

| 检查 | 环境 | 结果 |
| --- | --- | --- |
| npm test | Node.js 25；合成数据与模拟扶摇／模型响应 | 7 个文件、26 项测试通过 |
| `npm run lint` | 本地源码 | 通过 |
| `npm run typecheck` | TypeScript | 通过 |
| npm run build | 本地 Vinext 生产构建 | 通过 |
| 浏览器主链路 | 本地开发服务器 | 演示研究与证据抽屉已检查；下载行为和 AI 报告真实呈现待复核 |
| 扶摇 + DeepSeek live 研究流 | 本地 Wrangler Worker runtime | HTTP 200、真实快照、`deepseek-flash` 计划与报告成功；证据引用校验通过，`done=complete` |
| 自托管生产包 | 本地 Wrangler Worker runtime | `npm run build` 后 `start:selfhost` health 显示两类凭据已绑定；20 日研究流成功返回真实数据并通过 AI 报告校验 |
| Ubuntu Docker 自托管 | 服务器 `192.168.188.2:3180` | 外部桌面 GET health／页面均返回 200；Docker health 为 healthy；CA bundle 挂载后真实研究流 `done=complete` |
| Sites 部署与远程流式响应 | 私有站点已部署 | 未登录请求返回 401；登录后 UI／流式消费待所有者验证 |
| 扶摇 + DeepSeek live 研究流 | 本地 Wrangler Worker runtime | HTTP 200、真实数据快照、`deepseek-flash` 计划和报告均成功；报告证据引用通过服务端校验，`done=complete` |
| 自托管生产包 | 本地打包 Worker runtime | `npm run build` 后 `start:selfhost` health 配置为 live 且两类凭据均已绑定；20 日研究流完整返回并通过报告校验 |

## 已覆盖行为

- 收益、均线、回撤、波动、上涨宽度、同样本均值、成交额比值以及异常／不足数据处理。
- 日期 schema 默认值、无效日历日期、倒置日期和不支持的回看周期。
- 合成快照的显式演示标识、未接维度和来源说明。
- NDJSON 多事件、尾行无换行、无 `done` 的中断流、无效事件以及 HTTP 错误提示。
- 扶摇适配器的字段映射、当日完整快照宽度、历史宽度不回填、缺少 Key、非 HTTPS 配置和业务错误。
- 模型结构化输出、证据引用存在性、交易建议拦截、合成数据隔离，以及 Markdown 报告引用导出。

## 上线前仍要做

- 确认扶摇数据展示授权范围；再逐项核验深证成指与创业板代码映射。
- 在交易日取得时点与最近完成交易日一致的完整快照后，验证宽度计算和分页完整性。
- 浏览器下载和 AI 报告呈现仍待一次最终 UI 回归。
- 通过 Sites 部署检查 GET health、POST 研究流和浏览器流式消费。
