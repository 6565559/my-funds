import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, Info, RefreshCw, Search } from 'lucide-react';
import { api, AuthRequired } from '../api';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Input } from './ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { Choice, EmptyState, Modal, PageSkeleton } from './shared';
import Chart from './Chart';

const BANDS = [
  ['low', '低估', '0–20%', 'bg-emerald-100 text-emerald-800', 'bg-emerald-500'],
  ['cool', '合理偏低', '20–50%', 'bg-teal-50 text-teal-700', 'bg-teal-300'],
  ['warm', '合理偏高', '50–80%', 'bg-amber-50 text-amber-800', 'bg-amber-400'],
  ['high', '高估', '80–100%', 'bg-rose-50 text-rose-700', 'bg-rose-400'],
];
const STATUS = { missing: '暂无数据', error: '数据不可用', cached: '更新失败 · 缓存', stale: '待更新', insufficient: '历史不足', invalid: '指标无效' };
const METRICS = [['pe', 'PE-TTM 市盈率'], ['pb', 'PB 市净率']];
const number = value => value == null ? '—' : value.toFixed(2);

function TemperatureBar({ value }) {
  if (value == null) return <span className="text-muted-foreground">—</span>;
  return <div className="flex min-w-40 items-center gap-2 md:min-w-52 md:gap-3" aria-label={`历史分位 ${value.toFixed(1)}%`}>
    <div className="relative flex h-2.5 flex-1 rounded-sm" aria-hidden="true">
      {BANDS.map(([id, , , , color], i) => <span key={id} className={`${color} opacity-35 first:rounded-l-sm last:rounded-r-sm`} style={{ width: `${[20, 30, 30, 20][i]}%` }} />)}
      <span className="absolute -top-1.5 h-5 w-0.5 -translate-x-1/2 bg-foreground" style={{ left: `${value}%` }}>
        <span className="absolute -left-[3px] top-0 h-0 w-0 border-x-4 border-t-4 border-x-transparent border-t-foreground" />
      </span>
    </div>
    <span className="num w-14 text-right font-medium">{value.toFixed(1)}%</span>
  </div>;
}

function StateBadge({ item }) {
  const band = item.status === 'ok' && BANDS.find(([id]) => id === item.band);
  return <Badge variant="secondary" className={`whitespace-nowrap border-0 font-normal ${band ? band[3] : ''}`}>
    {band ? band[1] : STATUS[item.status] || '暂无数据'}
  </Badge>;
}

function HistoryDialog({ index, window, metric, onClose, onAuthRequired }) {
  const [result, setResult] = useState(null), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setResult(null); setError('');
    api.indexValuationHistory(index.code, window, metric).then(value => {
      if (active) setResult(value);
    }).catch(e => {
      if (!active) return;
      if (e instanceof AuthRequired) onAuthRequired?.();
      else setError(e.message);
    });
    return () => { active = false; };
  }, [index.code, window, metric, retry, onAuthRequired]);
  const option = useMemo(() => ({
    tooltip: { trigger: 'axis', renderMode: 'richText', valueFormatter: value => `${number(value)} 倍` },
    grid: { left: 8, right: 12, top: 24, bottom: 8, containLabel: true },
    xAxis: { type: 'category', boundaryGap: false, data: result?.series.map(row => row.date) || [], axisLabel: { color: '#71717a', fontSize: 10 }, axisTick: { show: false } },
    yAxis: { type: 'value', scale: true, axisLabel: { color: '#71717a', fontSize: 10 }, splitLine: { lineStyle: { color: '#e4e4e7', type: 'dashed' } } },
    series: [{ type: 'line', name: metric === 'pe' ? 'PE-TTM' : 'PB', showSymbol: false, connectNulls: false,
      data: result?.series.map(row => row.value) || [], lineStyle: { color: '#0f766e', width: 1.5 }, areaStyle: { color: 'rgba(15,118,110,0.04)' } }],
  }), [result, metric]);
  return <Modal open onOpenChange={open => !open && onClose()} title={`${index.name} · 历史估值`}
    description={`${index.code} · ${metric === 'pe' ? 'PE-TTM' : 'PB-LF'} · 近${window === '5y' ? '5' : '10'}年原始日估值`} className="sm:max-w-3xl">
    {error ? <div role="alert" className="flex items-center justify-between text-sm text-destructive">{error}<Button variant="outline" onClick={() => setRetry(n => n + 1)}>重试</Button></div>
      : !result ? <PageSkeleton /> : !result.series.length ? <EmptyState title="暂无历史数据" description="来源恢复后可再次更新估值。" /> : <>
        <div className="flex flex-wrap items-end justify-between gap-3 rounded-lg bg-muted/60 p-4">
          <div><p className="text-xs text-muted-foreground">最新估值 · {result.date}</p><p className="num mt-1 text-2xl">{number(result.value)}<span className="ml-1 text-xs text-muted-foreground">倍</span></p></div>
          <StateBadge item={result} />
        </div>
        <Chart option={option} label={`${index.name}历史${metric === 'pe' ? '市盈率' : '市净率'}曲线`} className="h-72 sm:h-80" />
        <p className="text-xs leading-6 text-muted-foreground">{result.historyStart} — {result.historyEnd} · {result.sampleCount.toLocaleString('zh-CN')} 个有效样本。{result.source.methodology}</p>
      </>}
  </Modal>;
}

export default function IndexTemperatureView({ active, onAuthRequired }) {
  const [window, setWindow] = useState('10y'), [metric, setMetric] = useState('pe');
  const [query, setQuery] = useState(''), [band, setBand] = useState('all'), [sort, setSort] = useState('asc');
  const [data, setData] = useState(null), [loading, setLoading] = useState(false), [error, setError] = useState('');
  const [retry, setRetry] = useState(0), [selected, setSelected] = useState(null);
  const refresh = useRef(false);
  useEffect(() => {
    if (!active) return;
    let current = true;
    setLoading(true); setError(''); setData(null);
    const force = refresh.current;
    refresh.current = false;
    api.indexValuations(window, metric, force).then(value => {
      if (current) setData(value);
    }).catch(e => {
      if (!current) return;
      if (e instanceof AuthRequired) onAuthRequired?.();
      else setError(e.message);
    }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [active, window, metric, retry, onAuthRequired]);
  const rows = useMemo(() => (data?.rows || []).filter(row =>
    `${row.name} ${row.code}`.toLowerCase().includes(query.trim().toLowerCase()) &&
    (band === 'all' || row[metric].status === 'ok' && row[metric].band === band))
    .sort((a, b) => {
      const x = a[metric].temperature, y = b[metric].temperature;
      if (x == null || y == null) return x == null ? y == null ? 0 : 1 : -1;
      return sort === 'asc' ? x - y : y - x;
    }), [data, query, band, metric, sort]);
  const dates = [...new Set(data?.rows.map(row => row[metric].date).filter(Boolean) || [])].sort();
  const oldest = dates[0], newest = dates.at(-1);
  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap gap-3">
        <div className="inline-flex rounded-lg border bg-card p-1">
          {METRICS.map(([key, name]) => <Button key={key} size="sm" variant={metric === key ? 'secondary' : 'ghost'} aria-pressed={metric === key} onClick={() => setMetric(key)}>{name}</Button>)}
        </div>
        <div className="inline-flex rounded-lg border bg-card p-1">
          {['5y', '10y'].map(value => <Button key={value} size="sm" variant={window === value ? 'secondary' : 'ghost'} aria-pressed={window === value} onClick={() => setWindow(value)}>近{value === '5y' ? '5' : '10'}年</Button>)}
        </div>
      </div>
      <Button variant="outline" disabled={loading} onClick={() => { refresh.current = true; setRetry(n => n + 1); }}><RefreshCw className={loading ? 'animate-spin' : ''} />更新估值</Button>
    </div>
    {error ? <div role="alert" className="panel flex items-center justify-between gap-4 p-5 text-sm text-destructive">{error}<Button variant="outline" onClick={() => setRetry(n => n + 1)}>重试</Button></div>
      : loading || !data ? <PageSkeleton /> : <>
        <section className="panel p-5 sm:p-6" aria-label="估值分布">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><h2 className="section-title">已覆盖指数估值分布</h2><p className="mt-1.5 text-xs text-muted-foreground">{data.covered} 个有效 · {data.excluded} 个未纳入 · 按{metric === 'pe' ? 'PE-TTM' : 'PB'}分位</p></div>
            <p className="text-xs text-muted-foreground">估值日期 <span className="num ml-1 text-foreground">{newest ? oldest === newest ? newest : `${oldest} — ${newest}` : '暂无'}</span></p>
          </div>
          <div className="mt-6 flex h-3 overflow-hidden rounded-full bg-muted" aria-hidden="true">
            {BANDS.map(([id, , , , color]) => <span key={id} className={color} style={{ width: `${data.covered ? data.distribution[id] / data.covered * 100 : 0}%` }} />)}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {BANDS.map(([id, label, range, , color]) => <button key={id} type="button" aria-label={`筛选${label}`} aria-pressed={band === id}
              onClick={() => setBand(value => value === id ? 'all' : id)} className={`flex items-center gap-2 rounded-md px-2 py-2 text-left text-xs transition-colors hover:bg-muted ${band === id ? 'bg-muted ring-1 ring-border' : ''}`}>
              <span className={`size-2 shrink-0 rounded-full ${color}`} /><span>{label}<span className="ml-1.5 text-muted-foreground">{range}</span></span><span className="num ml-auto text-sm">{data.distribution[id]}</span>
            </button>)}
          </div>
        </section>
        <section className="panel overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4 sm:px-5">
            <div className="relative w-full sm:w-64"><Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" /><Input aria-label="搜索指数" placeholder="搜索名称或代码" value={query} onChange={e => setQuery(e.target.value)} className="pl-9" /></div>
            <div className="flex items-center gap-3">
              {band !== 'all' && <Button variant="ghost" size="sm" onClick={() => setBand('all')}>清除筛选</Button>}
              <Choice label="温度排序" value={sort} onChange={setSort} options={[['asc', '温度从低到高'], ['desc', '温度从高到低']]} />
            </div>
          </div>
          {!rows.length ? <EmptyState title="没有匹配的指数" description="试试其他名称，或清除估值档位筛选。" /> : <Table className="min-w-full md:min-w-[920px]">
            <TableHeader><TableRow className="bg-muted/50">
              {['指数', `当前${metric === 'pe' ? 'PE-TTM' : 'PB'}`, '历史分位 / 温度', '估值判断', 'PE-TTM', 'PB-LF', '数据日期'].map((label, i) => <TableHead key={label} className={`whitespace-nowrap px-3 text-xs md:px-5 ${i !== 0 && i !== 2 ? 'hidden md:table-cell' : ''}`}>{label}</TableHead>)}
            </TableRow></TableHeader>
            <TableBody>{rows.map(row => <TableRow key={row.code}>
              <TableCell className="px-3 py-4 md:px-5"><button type="button" aria-label={`查看${row.name}历史估值`} onClick={() => setSelected(row)} className="group text-left">
                <span className="flex items-center gap-1.5 font-medium">{row.name}<ArrowUpRight className="size-3 text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" /></span><span className="num mt-1 block text-[10px] text-muted-foreground">{row.code}</span>
              </button><div className="mt-2 space-y-1 md:hidden"><p className="num text-xs">{number(row[metric].value)} 倍</p><StateBadge item={row[metric]} /><p className="num text-[10px] text-muted-foreground">{row[metric].date || '暂无日期'}</p></div></TableCell>
              <TableCell className="hidden px-5 md:table-cell"><span className="num text-lg font-medium">{number(row[metric].value)}</span><span className="ml-1 text-xs text-muted-foreground">倍</span></TableCell>
              <TableCell className="px-3 md:px-5"><TemperatureBar value={row[metric].temperature} /></TableCell>
              <TableCell className="hidden px-5 md:table-cell"><StateBadge item={row[metric]} /></TableCell>
              {['pe', 'pb'].map(key => <TableCell key={key} className="hidden px-5 md:table-cell"><span className="num">{number(row[key].value)}</span>
                <span className="mt-1 block whitespace-nowrap text-[10px] text-muted-foreground">{row[key].date || '暂无日期'}{row[key].status !== 'ok' ? ` · ${STATUS[row[key].status]}` : ''}</span>
              </TableCell>)}
              <TableCell className="num hidden px-5 text-xs text-muted-foreground md:table-cell">{row[metric].date || '—'}</TableCell>
            </TableRow>)}</TableBody>
          </Table>}
        </section>
        <div className="flex items-start gap-2.5 px-1 text-xs leading-6 text-muted-foreground">
          <Info className="mt-1 size-4 shrink-0" /><div>
            <p>温度越低，表示估值相对自身历史越低；它不代表未来涨跌。历史不足、指标无效、待更新及更新失败的指数不计入分布。</p>
            <p>来源：<a href={data.source.url} target="_blank" rel="noreferrer" className="underline underline-offset-2">{data.source.name}</a> · {data.source.methodology}</p>
            <p>每次更新受缓存与一小时冷却限制，更新按钮不代表来源已发布新数据。20%计入低估，50%计入合理偏低，80%计入高估。</p>
          </div>
        </div>
      </>}
    {active && selected && <HistoryDialog index={selected} window={window} metric={metric} onClose={() => setSelected(null)} onAuthRequired={onAuthRequired} />}
  </div>;
}
