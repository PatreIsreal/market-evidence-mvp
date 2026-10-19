"use client";

import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  BookOpenCheck,
  CalendarDays,
  Check,
  ChevronRight,
  CircleHelp,
  Database,
  Download,
  GitCompareArrows,
  Layers3,
  LoaderCircle,
  Radio,
  Search,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { AiReport, Dimension, Evidence, PricePoint, ResearchInput, ResearchSnapshot } from "@/lib/contracts/research";
import { dimensionLabels } from "@/lib/contracts/research";
import { assessResearchConfidence } from "@/lib/confidence";
import { consumeResearchStream, type ResearchStreamEvent } from "@/lib/client/consume-stream";
import { downloadSnapshot } from "@/lib/client/export-report";

type CapabilityResponse = {
  mode: "demo" | "live";
  providers: Record<string, string>;
  dimensions: Array<{ id: Dimension; label: string; status: string }>;
};

const indexes = [
  ["SSE_COMPOSITE", "上证指数"],
  ["SZSE_COMPONENT", "深证成指"],
  ["CHINEXT", "创业板指"],
  ["CSI300", "沪深300"],
  ["CSI1000", "中证1000"],
] as const;

const emptyQuestion = "近 60 个交易日，指数变化与市场参与度是否一致？";
const dimensionOrder: Dimension[] = ["price", "breadth", "style", "valuation", "liquidity", "sentiment", "events"];

function beijingToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
}

function daysBefore(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() - days);
  return value.toISOString().slice(0, 10);
}

function formatNumber(value: number | null | undefined, digits = 2) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toLocaleString("zh-CN", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function formatPercent(value: number | null | undefined) {
  return value === null || value === undefined || !Number.isFinite(value) ? "—" : `${formatNumber(value * 100)}%`;
}

function safeExternalLink(value?: string) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function metricDate(value?: string | null) {
  if (!value) return "等待真实数据";
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "long", day: "numeric" }).format(new Date(`${value}T12:00:00+08:00`));
}

function pointsForChart(points: PricePoint[]) {
  const first = points.find((point) => point.close > 0)?.close;
  if (!first) return [];
  return points.filter((point) => Number.isFinite(point.close) && point.close > 0).map((point) => ({ ...point, normalized: (point.close / first) * 100 }));
}

function chartPath(values: number[], min: number, max: number, width = 800, height = 230) {
  if (values.length < 2) return "";
  const spread = max - min || 1;
  return values.map((value, index) => {
    const x = 10 + (index / (values.length - 1)) * (width - 20);
    const y = 12 + (1 - (value - min) / spread) * (height - 24);
    return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
}

function qualityText(status: string) {
  const labels: Record<string, string> = {
    available: "有数据",
    missing: "缺少数据",
    unavailable: "未接入",
    stale: "数据过期",
    conflict: "来源冲突",
    failed: "调用失败",
  };
  return labels[status] ?? "演示数据";
}

function EvidenceCard({ evidence, onSelect }: { evidence: Evidence; onSelect: (evidence: Evidence) => void }) {
  return (
    <button className="evidence-row" type="button" onClick={() => onSelect(evidence)}>
      <span className="evidence-id">{evidence.id}</span>
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate text-[13px] font-semibold text-slate-800">{evidence.label}</span>
        <span className="mt-1 block text-[11px] text-slate-500">{evidence.period.start} 至 {evidence.period.end} · {evidence.unit}</span>
        {typeof evidence.value === "string" && <span className="mt-1 block truncate text-[11px] leading-5 text-slate-600">{evidence.value}</span>}
      </span>
      <span className="evidence-value">{typeof evidence.value === "number" ? `${formatNumber(evidence.value)}${evidence.unit === "%" ? "%" : ""}` : "查看摘要"}</span>
      <ChevronRight size={15} className="text-slate-400" />
    </button>
  );
}

export function ResearchWorkspace() {
  const [capabilities, setCapabilities] = useState<CapabilityResponse | null>(null);
  const [primaryIndex, setPrimaryIndex] = useState<ResearchInput["scope"]["primaryIndex"]>("SSE_COMPOSITE");
  const [windowDays, setWindowDays] = useState<20 | 60 | 120>(60);
  const [rangeMode, setRangeMode] = useState<"lookback" | "range">("lookback");
  const [startDate, setStartDate] = useState(() => daysBefore(beijingToday(), 90));
  const [endDate, setEndDate] = useState(beijingToday);
  const [question, setQuestion] = useState(emptyQuestion);
  const [focus, setFocus] = useState<ResearchInput["scope"]["focus"]>("overview");
  const [snapshot, setSnapshot] = useState<ResearchSnapshot | null>(null);
  const [aiReport, setAiReport] = useState<AiReport | null>(null);
  const [plan, setPlan] = useState<{ origin?: string; intent?: string; calls?: Array<{ callId: string; toolName: string; purpose: string; status?: string }> } | null>(null);
  const [toolStatus, setToolStatus] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<{ kind: "warning" | "error"; message: string } | null>(null);
  const [phase, setPhase] = useState<"idle" | "running" | "partial" | "failed">("idle");
  const [selectedEvidence, setSelectedEvidence] = useState<Evidence | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    void fetch("/api/capabilities", { cache: "no-store" })
      .then((response) => response.ok ? response.json() as Promise<CapabilityResponse> : null)
      .then((result) => { if (result) setCapabilities(result); })
      .catch(() => setCapabilities(null));
    return () => controller.current?.abort();
  }, []);

  const applyEvent = useCallback((event: ResearchStreamEvent) => {
    if (event.type === "plan") setPlan(event.data as typeof plan);
    if (event.type === "tool_started") {
      const data = event.data as { callId: string };
      setToolStatus((previous) => ({ ...previous, [data.callId]: "执行中" }));
    }
    if (event.type === "tool_finished") {
      const data = event.data as { callId: string; status: string };
      setToolStatus((previous) => ({ ...previous, [data.callId]: qualityText(data.status) }));
    }
    if (event.type === "tool_retrying") {
      const data = event.data as { callId: string; attempt: number; maxAttempts: number };
      setToolStatus((previous) => ({ ...previous, [data.callId]: `重试中（${data.attempt}/${data.maxAttempts}）` }));
    }
    if (event.type === "snapshot") setSnapshot(event.data as ResearchSnapshot);
    if (event.type === "report") setAiReport(event.data as AiReport);
    if (event.type === "warning") {
      const data = event.data as { message?: string };
      setNotice({ kind: "warning", message: data.message ?? "部分数据或模型能力尚不可用。" });
    }
    if (event.type === "error") {
      const data = event.data as { message?: string };
      setNotice({ kind: "error", message: data.message ?? "研究未完成。" });
      setPhase("failed");
    }
    if (event.type === "done") {
      const data = event.data as { outcome?: string };
      setPhase(data.outcome === "complete" ? "idle" : data.outcome === "failed" ? "failed" : "partial");
    }
  }, []);

  async function runResearch(nextFocus = focus, nextQuestion = question, continueFromSnapshot = false) {
    controller.current?.abort();
    const requestController = new AbortController();
    controller.current = requestController;
    setPhase("running");
    setNotice(null);
    setSnapshot(null);
    setAiReport(null);
    setPlan(null);
    setToolStatus({});

    const input: ResearchInput = {
      schemaVersion: "1.0",
      question: nextQuestion.trim() || emptyQuestion,
      scope: {
        primaryIndex,
        period: continueFromSnapshot && snapshot
          ? snapshot.scope.period
          : rangeMode === "range"
            ? { kind: "range", startDate, endDate }
            : { kind: "lookback", tradingDays: windowDays },
        asOfDate: continueFromSnapshot && snapshot ? snapshot.scope.asOfDate : null,
        focus: nextFocus,
        comparisonIndexes: (["CSI300", "CSI1000"] as const).filter((id) => id !== primaryIndex).slice(0, 2),
      },
      ...(continueFromSnapshot && snapshot ? {
        context: {
          parentReportId: snapshot.reportId,
          parentScope: {
            primaryIndex: snapshot.scope.primaryIndex,
            period: snapshot.scope.period,
            asOfDate: snapshot.scope.asOfDate,
            focus: snapshot.scope.focus,
            comparisonIndexes: snapshot.scope.comparisonIndexes,
          },
        },
      } : {}),
    };

    try {
      const response = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
        body: JSON.stringify(input),
        signal: requestController.signal,
      });
      await consumeResearchStream(response, applyEvent);
    } catch (error) {
      if (requestController.signal.aborted) return;
      setNotice({ kind: "error", message: error instanceof Error ? error.message : "研究请求失败。" });
      setPhase("failed");
    }
  }

  async function submitResearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runResearch();
  }

  const demoMode = capabilities?.mode !== "live";
  const confidence = snapshot ? assessResearchConfidence(snapshot, aiReport !== null) : null;
  const priceChart = snapshot ? pointsForChart(snapshot.priceSeries) : [];
  const firstComparison = snapshot ? pointsForChart(snapshot.comparisonSeries[0]?.points ?? []) : [];
  const secondComparison = snapshot ? pointsForChart(snapshot.comparisonSeries[1]?.points ?? []) : [];
  const benchmarkValues = [
    ...priceChart.map((point) => point.normalized),
    ...firstComparison.map((point) => point.normalized),
    ...secondComparison.map((point) => point.normalized),
  ];
  const chartMin = benchmarkValues.length ? Math.min(...benchmarkValues) : 0;
  const chartMax = benchmarkValues.length ? Math.max(...benchmarkValues) : 1;

  return (
    <div className="workspace-shell">
      <header className="topbar">
        <button className="mobile-menu-button" type="button" aria-label="打开导航" onClick={() => setMobileNavOpen((open) => !open)}>
          <Layers3 size={19} />
        </button>
        <a className="brand" href="#top" aria-label="市场证据台首页">
          <span className="brand-mark"><Activity size={18} strokeWidth={2.3} /></span>
          <span>市场证据台</span>
        </a>
        <div className="topbar-context"><span>研究工作台</span><span className="context-dot">/</span><span className="context-muted">A 股大势</span></div>
        <div className="topbar-actions">
          <span className={`connection-chip ${demoMode ? "connection-pending" : "connection-live"}`}>
            <span className="connection-dot" />{demoMode ? "演示环境" : "实时环境"}
          </span>
          <button className="icon-button" type="button" title="研究方法说明"><CircleHelp size={18} /></button>
          <span className="avatar-mark">研</span>
        </div>
      </header>

      {mobileNavOpen && <button className="mobile-nav-backdrop" aria-label="关闭导航" onClick={() => setMobileNavOpen(false)} />}
      <div className="workspace-body" id="top">
        <aside className={`sidebar ${mobileNavOpen ? "sidebar-open" : ""}`}>
          <div className="sidebar-section-label">工作空间</div>
          <button className="nav-item nav-item-active" type="button"><Activity size={17} /><span>市场总览</span><span className="nav-active-dot" /></button>
          <div className="sidebar-section-label sidebar-section-spaced">研究范围</div>
          <div className="sidebar-index-list">
            {indexes.slice(0, 3).map(([id, name]) => (
              <button className={`sidebar-index ${primaryIndex === id ? "sidebar-index-selected" : ""}`} key={id} onClick={() => setPrimaryIndex(id)} type="button">
                <span className="index-mini-mark">{name.slice(0, 1)}</span><span>{name}</span>{primaryIndex === id && <Check size={14} />}
              </button>
            ))}
          </div>
          <div className="sidebar-section-label sidebar-section-spaced">本次研究</div>
          <div className="sidebar-study-card">
            <span className="sidebar-study-icon"><Search size={15} /></span>
            <span><strong>{phase === "running" ? "正在整理证据" : snapshot ? snapshot.synthetic ? "合成演示研究" : "扶摇数据研究" : "等待发起研究"}</strong><small>{snapshot ? metricDate(snapshot.scope.actualEndDate) : "提交问题后显示进度"}</small></span>
          </div>
          <div className="sidebar-bottom">
            <div className="sidebar-source-card">
              <span className="source-card-icon"><Database size={15} /></span>
              <strong>数据连接</strong>
              <p>{demoMode ? "扶摇与 iFinD 尚未验证" : "请检查各来源的本轮质量"}</p>
              <a href="#data-status">查看能力 <ArrowRight size={13} /></a>
            </div>
            <div className="sidebar-version"><span className="version-dot" />MVP 开发中 <span>v0.1</span></div>
          </div>
        </aside>

        <main className="main-content">
          <div className="content-wrap">
            <section className="page-intro">
              <div>
                <div className="eyebrow"><span className="eyebrow-icon"><Activity size={14} /></span>市场状态研究 <span className="eyebrow-line" /> 面向证据的观察框架</div>
                <h1>先看证据，再谈市场。</h1>
                <p className="intro-copy">把行情、参与度与风格放在一起看，了解判断由什么支持，又会在什么条件下改变。</p>
              </div>
              <div className="intro-stamp"><div className="stamp-icon"><ShieldCheck size={18} /></div><span><strong>研究边界</strong><small>不预测涨跌 · 不提供仓位</small></span></div>
            </section>

            <section className={`environment-banner ${demoMode ? "environment-demo" : "environment-live"}`} aria-live="polite">
              <div className="environment-symbol">{demoMode ? <TriangleAlert size={17} /> : <Radio size={17} />}</div>
              <div className="environment-text"><strong>{demoMode ? "演示环境｜当前未接入真实数据与 AI 模型" : "实时环境｜请以本轮数据质量标识为准"}</strong><span>{demoMode ? "下方结果由合成序列生成，只展示交互和计算方式；不代表 A 股行情或 AI 市场判断。" : "每项指标仍需检查来源、统计口径与数据时点。"}</span></div>
              <a href="#data-status">查看接入状态 <ArrowRight size={13} /></a>
            </section>

            <form className="research-form panel" onSubmit={(event) => void submitResearch(event)}>
              <div className="form-heading"><div className="form-icon"><Sparkles size={17} /></div><div><h2>发起一项研究</h2><p>问题可以聚焦指数、风格、风险变量或历史阶段。</p></div><span className="form-step">STEP 01 <ChevronRight size={13} /> QUERY</span></div>
              <label className="question-label" htmlFor="research-question">你想了解什么？</label>
              <div className="question-input-wrap"><Search size={18} /><input id="research-question" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="例如：指数走势与市场参与度是否一致？" maxLength={1000} /><kbd>↵</kbd></div>
              <div className="scope-row">
              <label className="select-field"><span>主观察指数</span><select value={primaryIndex} onChange={(event) => setPrimaryIndex(event.target.value as ResearchInput["scope"]["primaryIndex"])}>{indexes.map(([id, name]) => <option value={id} key={id}>{name}</option>)}</select></label>
                <label className="select-field"><span>研究区间</span><select value={rangeMode === "range" ? "range" : String(windowDays)} onChange={(event) => { if (event.target.value === "range") setRangeMode("range"); else { setRangeMode("lookback"); setWindowDays(Number(event.target.value) as 20 | 60 | 120); } }}><option value="20">近 20 个交易日</option><option value="60">近 60 个交易日</option><option value="120">近 120 个交易日</option><option value="range">指定日期区间</option></select></label>
                <div className="scope-note"><CalendarDays size={15} /><span>{snapshot ? `${snapshot.synthetic ? "演示区间" : "实际区间"} ${snapshot.scope.actualStartDate} — ${snapshot.scope.actualEndDate}` : "真实交易日将由数据日历确定"}</span></div>
                <button className="run-button" type="submit" disabled={phase === "running"}>{phase === "running" ? <LoaderCircle size={16} className="spin" /> : <Search size={16} />}{phase === "running" ? "正在查询" : "开始研究"}<ArrowRight size={15} /></button>
              </div>
              {rangeMode === "range" && <div className="date-range-row"><label className="date-field"><span>开始日期</span><input type="date" required value={startDate} max={endDate} onChange={(event) => setStartDate(event.target.value)} /></label><label className="date-field"><span>结束日期</span><input type="date" required value={endDate} max={beijingToday()} min={startDate} onChange={(event) => setEndDate(event.target.value)} /></label><span className="date-range-hint">按所选自然日查询；实际交易日由数据源返回。</span></div>}
              <div className="quick-prompts"><span>试试：</span><button type="button" onClick={() => { setQuestion("比较大盘与小盘指数的区间表现"); setFocus("style"); }}>大小盘风格</button><button type="button" onClick={() => { setQuestion("市场参与度与波动有哪些值得继续核对的变量？"); setFocus("risk"); }}>风险变量</button><button type="button" onClick={() => { setQuestion("指定历史阶段中，指数表现与市场参与度是否一致？"); setFocus("historical"); }}>历史阶段</button></div>
            </form>

            {phase === "running" && <div className="progress-panel panel" role="status"><LoaderCircle size={18} className="spin text-blue-600" /><span><strong>正在整理本轮研究</strong><small>请查看实际查询步骤；不以进度条代替工具返回。</small></span></div>}
            {notice && <div className={`notice-panel ${notice.kind === "error" ? "notice-error" : "notice-warning"}`} role="status"><TriangleAlert size={17} /><span>{notice.message}</span></div>}
            {plan && <section className="panel tool-plan-panel" aria-label="本轮查询计划"><div className="panel-header"><div><span className="section-kicker">QUERY PLAN</span><h3>本轮查询计划</h3></div><span className="dimension-caption">{plan.origin === "demo_fixture" ? "本地合成演示" : plan.origin === "model" ? "AI 研究计划" : plan.origin === "rule_fallback" ? "代码默认计划" : "数据执行计划"}</span></div>{plan.intent && <p className="plan-angle">{plan.intent}</p>}{plan.calls?.map((call) => <div className="tool-plan-row" key={call.callId}><span className="tool-plan-dot" /><span><strong>{call.purpose}</strong><small>{call.toolName}</small></span><span className="tool-plan-state">{toolStatus[call.callId] ?? call.status ?? "已规划"}</span></div>)}</section>}

            {!snapshot && phase !== "running" && <section className="empty-state panel"><div className="empty-illustration"><div className="empty-ring empty-ring-a" /><div className="empty-ring empty-ring-b" /><div className="empty-core"><Activity size={25} /></div><span className="empty-spark empty-spark-a" /><span className="empty-spark empty-spark-b" /></div><div className="empty-copy"><span className="section-kicker">EVIDENCE FIRST</span><h2>让一个清晰的问题，带出一条证据链。</h2><p>开始研究后，这里会按顺序呈现查询计划、数据时点、指标证据与未验证的部分。</p><button type="button" className="demo-link" onClick={() => { setQuestion(emptyQuestion); document.getElementById("research-question")?.focus(); }}>从上方问题开始 <ArrowRight size={15} /></button></div><div className="empty-aside"><span className="empty-aside-number">01</span><span>确定研究范围</span><span className="empty-aside-line" /><span className="empty-aside-number muted">02</span><span className="muted">查看取数计划</span><span className="empty-aside-line" /><span className="empty-aside-number muted">03</span><span className="muted">追溯结论依据</span></div></section>}

            {snapshot && <>
              <section className="result-heading">
                <div><span className="section-kicker">RESEARCH SNAPSHOT {snapshot.synthetic && <span className="demo-kicker">· 合成演示</span>}</span><h2>{snapshot.indexName} <span className="result-separator">/</span> {snapshot.scope.actualStartDate} — {snapshot.scope.actualEndDate}</h2><p>{snapshot.synthetic ? "下列指标按代码计算。演示日期按工作日生成，未使用真实交易日历。" : "下列指标由服务端按扶摇历史日线计算；每个维度单独显示数据可用性与时点。"}</p></div>
                <div className="result-actions"><span className="result-source-pill"><span className="mini-dot" />{snapshot.sourceLabel}</span><button type="button" onClick={() => downloadSnapshot({ ...snapshot, aiReport: aiReport ?? undefined }, "markdown")}><Download size={14} />导出 Markdown</button><button type="button" onClick={() => downloadSnapshot({ ...snapshot, aiReport: aiReport ?? undefined }, "json")}><Download size={14} />JSON</button></div>
              </section>

              <section className="metric-grid" aria-label="研究指标">
                <MetricCard label="20 日区间收益" value={formatPercent(snapshot.metrics.return20)} change={snapshot.metrics.return20 === null ? "观察窗口不足" : snapshot.synthetic ? "仅为合成价格变化" : "基于扶摇指数日线"} icon={<Activity size={16} />} evidence={snapshot.evidence.find((item) => item.dimension === "price")?.id} />
                <MetricCard label="当日上涨比例" value={formatPercent(snapshot.metrics.breadthLatest)} change={snapshot.synthetic ? "合成固定样本" : qualityText(snapshot.dimensionStatuses.breadth.status)} icon={<GitCompareArrows size={16} />} evidence={snapshot.evidence.find((item) => item.dimension === "breadth")?.id} />
                <MetricCard label="区间最大回撤" value={formatPercent(snapshot.metrics.maxDrawdown)} change={snapshot.synthetic ? "仅描述演示窗口" : "基于扶摇日线收盘价"} icon={<ArrowDownRight size={16} />} evidence={snapshot.evidence.find((item) => item.label.includes("回撤"))?.id} />
                <MetricCard label="年化波动（20 日）" value={formatPercent(snapshot.metrics.volatility20)} change="252 日年化约定" icon={<Radio size={16} />} evidence={snapshot.evidence.find((item) => item.label.includes("波动"))?.id} />
              </section>

              <section className="analysis-grid">
                <div className="panel chart-panel">
                  <div className="panel-header"><div><span className="section-kicker">01 / PRICE STRUCTURE</span><h3>价格结构 <span className="chart-subtitle">— 归一化表现</span></h3></div><button className="panel-menu" type="button" title="指标说明"><CircleHelp size={16} /></button></div>
                  <div className="chart-legend"><span><i className="legend-line primary-line" />{snapshot.indexName}</span>{snapshot.comparisonSeries.map((series, index) => <span key={series.indexId}><i className={`legend-line ${index === 0 ? "large-line" : "small-line"}`} />{series.indexName}</span>)}</div>
                    <div className="chart-frame">
                    <div className="chart-axis-labels"><span>相对表现</span><span>100 = 区间起点</span></div>
                    <svg className="line-chart" viewBox="0 0 800 230" role="img" aria-label={snapshot.synthetic ? "主指数与比较指数的合成归一化演示序列" : "主指数与对比指数的归一化表现序列"}>
                      <line x1="10" x2="790" y1="48" y2="48" className="chart-gridline" /><line x1="10" x2="790" y1="105" y2="105" className="chart-gridline" /><line x1="10" x2="790" y1="163" y2="163" className="chart-gridline" /><line x1="10" x2="790" y1="220" y2="220" className="chart-gridline" />
                      <path d={chartPath(priceChart.map((point) => point.normalized), chartMin, chartMax)} className="chart-line primary-chart-line" />
                      <path d={chartPath(firstComparison.map((point) => point.normalized), chartMin, chartMax)} className="chart-line large-chart-line" />
                      <path d={chartPath(secondComparison.map((point) => point.normalized), chartMin, chartMax)} className="chart-line small-chart-line" />
                    </svg>
                    <div className="chart-dates"><span>{priceChart[0]?.tradeDate ?? "—"}</span><span>{priceChart[Math.floor(priceChart.length / 2)]?.tradeDate ?? "—"}</span><span>{priceChart.at(-1)?.tradeDate ?? "—"}</span></div>
                  </div>
                  <p className="chart-footnote"><span className="note-mark">i</span>{snapshot.synthetic ? "代理序列为合成数据；图形仅演示同区间归一化与证据标签。" : "指数点位按所选区间首个有效收盘值归一化为 100；指数数据无复权语义。"}</p>
                </div>

                <div className="panel conclusion-panel">
                  <div className="panel-header"><div><span className="section-kicker">02 / AI CONCLUSION</span><h3>最终结论</h3></div><span className={aiReport ? "status-waiting status-complete" : "status-waiting"}><span />{aiReport ? aiReport.generationMode === "model" ? "LLM 已生成" : aiReport.generationMode === "recovered" ? "LLM 修复结论已生成" : "规则兜底结论已生成" : "尚无结论"}</span></div>
                  {aiReport ? <div className="ai-report"><div className="ai-summary"><span className="ai-pending-icon"><Sparkles size={17} /></span><div><strong className="ai-conclusion-label">最终结论</strong><p>{aiReport.summary}</p>{aiReport.recoveryNote && <p className="ai-uncertainty">{aiReport.recoveryNote}</p>}<div className="ai-citations">{aiReport.summaryEvidenceIds.map((id) => <button type="button" key={id} onClick={() => { const evidence = snapshot?.evidence.find((entry) => entry.id === id); if (evidence) setSelectedEvidence(evidence); }}>{id}</button>)}</div></div></div>
                    <div className="ai-report-block"><strong>证据支持的观察</strong>{aiReport.observations.map((item, index) => <div className="ai-report-item" key={"observation-" + index}><p>{item.statement}</p><div className="ai-citations">{item.evidenceIds.map((id) => <button type="button" key={id} onClick={() => { const evidence = snapshot?.evidence.find((entry) => entry.id === id); if (evidence) setSelectedEvidence(evidence); }}>{id}</button>)}</div></div>)}</div>
                    {aiReport.counterpoints.length > 0 && <div className="ai-report-block"><strong>反证与限制</strong>{aiReport.counterpoints.map((item, index) => <div className="ai-report-item" key={"counterpoint-" + index}><p>{item.statement}</p><div className="ai-citations">{item.evidenceIds.map((id) => <button type="button" key={id} onClick={() => { const evidence = snapshot?.evidence.find((entry) => entry.id === id); if (evidence) setSelectedEvidence(evidence); }}>{id}</button>)}</div></div>)}</div>}
                    {aiReport.uncertainties.length > 0 && <div className="ai-report-block"><strong>仍待核对</strong>{aiReport.uncertainties.map((item, index) => <p className="ai-uncertainty" key={"uncertainty-" + index}><span>{dimensionLabels[item.dimension]}</span>{item.statement}</p>)}</div>}
                  </div> : <div className="ai-pending-box"><span className="ai-pending-icon"><Sparkles size={17} /></span><div><strong>{snapshot.mode === "demo" ? "演示环境不调用模型" : "本轮未生成 AI 最终结论"}</strong><p>{snapshot.mode === "demo" ? "此处只展示合成演示数据和代码计算；合成序列不进入 AI 研判。" : "模型尚未配置或本轮输出未通过校验。真实数据、规则标签和证据仍可查看。"}</p></div></div>}
                  <div className="tag-list-heading">规则标签 <span>{snapshot.synthetic ? "来自合成序列" : "由服务端代码计算"}</span></div>
                  <div className="state-tag-list">{snapshot.stateTags.length ? snapshot.stateTags.map((tag) => <span className="state-tag" key={tag.id}><Activity size={13} />{tag.label}</span>) : <span className="empty-tag">{snapshot.synthetic ? "当前演示序列没有触发已配置标签。" : "本轮数据没有触发已配置规则标签。"}</span>}</div>
                  <div className="status-divider" />
                  <div className="confidence-row"><span>七维证据覆盖</span><strong>{aiReport ? String(aiReport.evidenceCoverage) + "%" : "未计算"}</strong><small>按行情、宽度、风格、估值、流动性、情绪、事件七个维度的可用性计算；不代表涨跌概率。</small></div>
                  {confidence && <div className="confidence-row"><span>结论证据强度</span><strong>{confidence.label}</strong><small>{confidence.reason}描述本轮证据对 AI 最终结论的支持程度，不代表未来涨跌概率。</small></div>}
                  <div className="study-boundary"><ShieldCheck size={15} /><span>{snapshot.synthetic ? "标签描述合成历史；不表示未来走势。" : "AI 仅归纳本轮证据；不预测涨跌或给出交易指令。"}</span></div>
                </div>
              </section>

              <section className="secondary-grid">
                <div className="panel dimensions-panel" id="data-status">
                  <div className="panel-header"><div><span className="section-kicker">03 / EVIDENCE COVERAGE</span><h3>七个证据维度</h3></div><span className="dimension-caption">本轮接入情况</span></div>
                  <div className="dimension-list">{dimensionOrder.map((dimension) => {
                    const item = snapshot.dimensionStatuses[dimension];
                    const available = item.status === "available";
                    return <div className="dimension-item" key={dimension}><span className={`dimension-icon ${available ? "dimension-icon-ready" : "dimension-icon-muted"}`}>{dimension === "price" ? <Activity size={15} /> : dimension === "breadth" ? <GitCompareArrows size={15} /> : dimension === "style" ? <Layers3 size={15} /> : dimension === "events" ? <BookOpenCheck size={15} /> : <Database size={15} />}</span><span className="dimension-name"><strong>{dimensionLabels[dimension]}</strong><small>{item.explanation}</small></span><span className={`dimension-status ${available ? "status-demo" : "status-missing"}`}>{qualityText(item.status)}</span></div>;
                  })}</div>
                </div>
                <div className="panel evidence-panel">
                  <div className="panel-header"><div><span className="section-kicker">04 / TRACEABILITY</span><h3>本轮证据 <span className="evidence-count">{snapshot.evidence.length}</span></h3></div><ShieldCheck size={17} className="evidence-shield" /></div>
                  {snapshot.evidence.length ? <div className="evidence-list">{snapshot.evidence.map((evidence) => <EvidenceCard evidence={evidence} key={evidence.id} onSelect={setSelectedEvidence} />)}</div> : <div className="no-evidence">尚无可用证据。数据维度连接后，此处显示原始字段和计算依据。</div>}
                  <div className="evidence-footer"><span>来源、单位、数据时点与公式均可追溯</span><ArrowRight size={14} /></div>
                </div>
              </section>

              <section className="panel switches-panel">
                <div className="panel-header"><div><span className="section-kicker">05 / REASSESSMENT</span><h3>重新评估的条件</h3></div><span className="dimension-caption">不构成交易指令</span></div>
                {snapshot.switchConditions.length ? snapshot.switchConditions.map((condition) => <div className="switch-condition" key={condition.metricId}><span className="switch-icon"><GitCompareArrows size={16} /></span><div className="switch-copy"><strong>{condition.label}</strong><p>当前值 <b>{formatNumber(condition.currentValue)}{condition.unit}</b> {condition.operator} {condition.threshold}{condition.unit} 时，复核：{condition.reevaluateMeaning}</p></div><span className={`condition-result condition-${condition.evaluation}`}>{condition.evaluation === "met" ? "已满足" : condition.evaluation === "not_met" ? "未满足" : "无法计算"}</span></div>) : <div className="no-evidence">此条件需要有效的指标数据，本轮无法计算。</div>}
              </section>

              <section className="followup-section"><div><span className="section-kicker">CONTINUE RESEARCH</span><h3>沿着证据，继续问下去</h3><p>每次追问都会重新校验范围和数据可用性。</p></div><div className="followup-actions"><button type="button" onClick={() => void runResearch("style", "比较大盘与小盘指数的区间表现", true)}><GitCompareArrows size={15} />对比风格</button><button type="button" onClick={() => void runResearch("risk", "市场参与度与波动有哪些值得继续核对的变量？", true)}><Activity size={15} />检查风险变量</button><button type="button" onClick={() => void runResearch("historical", "指定历史阶段中，指数表现与市场参与度是否一致？", true)}><CalendarDays size={15} />继续研究此区间</button></div></section>
            </>}

            <footer className="page-footer"><span>市场证据台 <i>·</i> MVP 研究工作台</span><span>研究性信息展示，不构成投资建议。</span><span><ShieldCheck size={13} />数据来源与时点需逐项验证</span></footer>
          </div>
        </main>
      </div>

      {selectedEvidence && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedEvidence(null); }}><section className="evidence-dialog" role="dialog" aria-modal="true" aria-labelledby="evidence-title"><div className="dialog-header"><div><span className="section-kicker">SOURCE TRACE / {selectedEvidence.id}</span><h2 id="evidence-title">{selectedEvidence.label}</h2></div><button className="icon-button" type="button" aria-label="关闭" onClick={() => setSelectedEvidence(null)}>×</button></div><div className="dialog-value">{typeof selectedEvidence.value === "number" ? <>{formatNumber(selectedEvidence.value)}<small> {selectedEvidence.unit}</small></> : <p className="dialog-excerpt">{String(selectedEvidence.value ?? "暂无摘要")}</p>}</div><div className="trace-grid"><TraceItem label="数据来源" value={snapshot?.sourceLabel ?? "合成演示生成器"} /><TraceItem label="数据时点" value={selectedEvidence.dataAsOf ?? "未提供"} /><TraceItem label="统计区间" value={`${selectedEvidence.period.start} — ${selectedEvidence.period.end}`} /><TraceItem label="样本口径" value={selectedEvidence.scopeDescription} /><TraceItem label="原始字段" value={selectedEvidence.sourceRefs.map((ref) => ref.fields.join(", ")).join("；")} /><TraceItem label="计算方法" value={String(selectedEvidence.derivation?.parameters.note ?? "原始字段")} />{selectedEvidence.sourceRefs.map((ref) => safeExternalLink(ref.sourceUrl)).find(Boolean) && <div className="trace-item"><span>原文链接</span><strong><a href={selectedEvidence.sourceRefs.map((ref) => safeExternalLink(ref.sourceUrl)).find(Boolean)!} target="_blank" rel="noreferrer">打开来源 ↗</a></strong></div>}</div><div className="dialog-notice"><TriangleAlert size={15} /><span>{selectedEvidence.issues.join(" ")}</span></div><button className="dialog-close-button" type="button" onClick={() => setSelectedEvidence(null)}>关闭证据详情</button></section></div>}
    </div>
  );
}

function MetricCard({ label, value, change, icon, evidence }: { label: string; value: string; change: string; icon: React.ReactNode; evidence?: string }) {
  return <article className="metric-card"><div className="metric-card-top"><span>{label}</span><span className="metric-icon">{icon}</span></div><strong className="metric-value">{value}</strong><div className="metric-card-bottom"><span>{change}</span>{evidence && <span className="metric-evidence-ref">{evidence}</span>}</div></article>;
}

function TraceItem({ label, value }: { label: string; value: string }) {
  return <div className="trace-item"><span>{label}</span><strong>{value}</strong></div>;
}
