// FILE: frontend/src/pages/Dashboard.jsx
import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/card';
import { Alert, AlertDescription } from '../components/ui/alert';
import financialApi from '../services/financial_api';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip,
  ResponsiveContainer, Cell
} from 'recharts';
import {
  DollarSign, Users, Clock, TrendingUp, ChevronDown, ChevronRight,
  BarChart2, Table2, AlertCircle
} from 'lucide-react';

// ─── Helpers ─────────────────────────────────────────────────────────────────
const fmtCurrency = (n) =>
  new Intl.NumberFormat('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}).format(n||0);
const fmtMinutes = (secs) => Math.round((secs||0)/60).toLocaleString();

// ─── Color scale for matrix cells ────────────────────────────────────────────
const cellColor = (value, max) => {
  if(!max || !value) return '#f8fafc';
  const intensity = Math.max(0.08, value / max);
  const r = Math.round(219 - intensity * 130);
  const g = Math.round(234 - intensity * 80);
  const b = Math.round(254 - intensity * 40);
  return `rgb(${r},${g},${b})`;
};

const cellTextColor = (value, max) => {
  if(!max || !value) return '#94a3b8';
  return value / max > 0.6 ? '#1e3a5f' : '#1e40af';
};

// ─── KPI Card ─────────────────────────────────────────────────────────────────
const KPICard = ({ icon: Icon, label, value, sub, color }) => (
  <Card className="border border-gray-200">
    <CardContent className="p-5">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-sm font-medium text-gray-500">{label}</div>
          <div className={`text-2xl font-bold mt-1 ${color}`}>{value}</div>
          {sub && <div className="text-xs text-gray-400 mt-1">{sub}</div>}
        </div>
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center bg-gray-50`}>
          <Icon className={`w-5 h-5 ${color}`}/>
        </div>
      </div>
    </CardContent>
  </Card>
);

// ─── Main Dashboard ───────────────────────────────────────────────────────────
const Dashboard = () => {
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState('');
  const [summary, setSummary]         = useState(null);
  const [selectedPeriodId, setSelectedPeriodId] = useState(null);

  // Comparison panel
  const [compXAxis, setCompXAxis]     = useState('teacher');
  const [compYAxis, setCompYAxis]     = useState('payment');
  const [compPeriods, setCompPeriods] = useState([]);
  const [compStages, setCompStages]   = useState([]);
  const [compData, setCompData]       = useState(null);
  const [compLoading, setCompLoading] = useState(false);
  const [compView, setCompView]       = useState('chart'); // 'chart' | 'table'

  // Rankings config
  const [rankMetric, setRankMetric]   = useState('payment');
  const [rankStageId, setRankStageId] = useState(null);

  // ── Load dashboard summary ─────────────────────────────────────────────────
  useEffect(() => { loadSummary(); }, [selectedPeriodId]);

  const loadSummary = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await financialApi.getDashboardSummary(selectedPeriodId);
      setSummary(data);
      // Default comparison period to current selection or first period
      if(data.periods.length > 0 && compPeriods.length === 0) {
        setCompPeriods([data.periods[0].id]);
      }
    } catch(e) {
      setError('Failed to load dashboard: '+(e.response?.data?.detail||e.message));
    } finally { setLoading(false); }
  };

  // ── Load comparison data ───────────────────────────────────────────────────
  useEffect(() => {
    if(!summary) return;
    loadComparison();
  }, [compXAxis, compYAxis, compPeriods, compStages]);

  const loadComparison = async () => {
    setCompLoading(true);
    try {
      const data = await financialApi.getDashboardComparison({
        x_axis: compXAxis,
        y_axis: compYAxis,
        period_ids: compPeriods,
        stage_ids: compStages,
        section_ids: [],
        use_finalized: false,
      });
      setCompData(data);
    } catch(e) {
      console.error('Comparison load failed:', e);
    } finally { setCompLoading(false); }
  };

  // ── Derived: matrix ────────────────────────────────────────────────────────
  const { matrixPeriods, matrixStages, matrixLookup, matrixMax } = useMemo(() => {
    if(!summary) return { matrixPeriods:[], matrixStages:[], matrixLookup:{}, matrixMax:0 };
    const periodsUsed = summary.periods;
    const stagesUsed  = summary.stages;
    const lookup = {};
    let max = 0;
    summary.matrix.forEach(cell => {
      lookup[`${cell.period_id}-${cell.stage_id}`] = cell;
      if(cell.calculated_total > max) max = cell.calculated_total;
    });
    return { matrixPeriods: periodsUsed, matrixStages: stagesUsed, matrixLookup: lookup, matrixMax: max };
  }, [summary]);

  // ── Derived: filtered rankings ─────────────────────────────────────────────
  const filteredRankings = useMemo(() => {
    if(!summary) return [];
    let rows = [...summary.teacher_rankings];
    if(rankStageId) {
      // Can't filter server-side here without refetch; skip client-side filter for now
    }
    return rows.slice(0, 10);
  }, [summary, rankMetric, rankStageId]);

  const maxRankValue = useMemo(() => {
    if(!filteredRankings.length) return 1;
    return Math.max(...filteredRankings.map(r=>r.value));
  }, [filteredRankings]);

  // ── Bar chart colors ───────────────────────────────────────────────────────
  const CHART_COLORS = [
    '#2563eb','#3b82f6','#60a5fa','#93c5fd','#bfdbfe',
    '#1d4ed8','#1e40af','#1e3a8a','#172554','#dbeafe',
  ];

  const X_AXIS_OPTIONS = ['teacher','stage','section','subject','period'];
  const Y_AXIS_OPTIONS = [
    { value:'payment',      label:'Final Payment' },
    { value:'watch_time',   label:'Watch Time' },
    { value:'watch_pct',    label:'Watch %' },
    { value:'carry_forward',label:'Carry Forward' },
    { value:'orders',       label:'Orders' },
  ];

  const formatCompValue = (v) => {
    if(compYAxis==='watch_time') return `${Math.round(v).toLocaleString()} min`;
    if(compYAxis==='watch_pct')  return `${v.toFixed(2)}%`;
    if(compYAxis==='orders')     return v.toLocaleString();
    return `${fmtCurrency(v)} EGP`;
  };

  // ── Navigate to Financials with period+stage pre-selected ──────────────────
  const handleMatrixCellClick = (periodId, stageId) => {
    // Store selection in localStorage for Financials page to pick up
    try {
      localStorage.setItem('dashboard_nav_period', periodId);
      localStorage.setItem('dashboard_nav_stage', stageId);
    } catch {}
    window.location.href = '/financials';
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  if(loading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-lg text-gray-600">Loading dashboard…</div>
    </div>
  );

  if(error) return (
    <div className="min-h-screen bg-gray-50 p-6">
      <Alert className="bg-red-50 border-red-200 max-w-xl mx-auto mt-12">
        <AlertCircle className="w-4 h-4"/>
        <AlertDescription className="text-red-800">{error}</AlertDescription>
      </Alert>
    </div>
  );

  if(!summary) return null;

  const { kpis } = summary;

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto space-y-6">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
              <BarChart2 className="w-8 h-8 text-blue-600"/>Dashboard
            </h1>
            <p className="text-gray-500 mt-1">Financial overview across all periods and stages</p>
          </div>
          {/* Period filter */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500 font-medium">Filter period:</span>
            <select
              value={selectedPeriodId||''}
              onChange={e=>setSelectedPeriodId(e.target.value?parseInt(e.target.value):null)}
              className="text-sm border rounded-lg px-3 py-2 bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
              <option value="">All Periods</option>
              {summary.periods.map(p=>(
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* ── ROW 1: KPI Bar ──────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KPICard
            icon={DollarSign}
            label="Total Finalized"
            value={`${fmtCurrency(kpis.total_finalized_egp)} EGP`}
            sub="across all periods"
            color="text-green-600"
          />
          <KPICard
            icon={TrendingUp}
            label="Total Outstanding"
            value={`${fmtCurrency(kpis.total_outstanding_egp)} EGP`}
            sub="pending transfer"
            color="text-red-500"
          />
          <KPICard
            icon={Users}
            label="Active Teachers"
            value={kpis.active_teachers_count.toLocaleString()}
            sub={kpis.period_name ? `in ${kpis.period_name}` : 'this period'}
            color="text-blue-600"
          />
          <KPICard
            icon={Clock}
            label="Total Watch Time"
            value={`${fmtMinutes(kpis.total_watch_time_seconds)} min`}
            sub={kpis.period_name ? `in ${kpis.period_name}` : 'this period'}
            color="text-purple-600"
          />
        </div>

        {/* ── ROW 2: Matrix (60%) + Rankings (40%) ──────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

          {/* Period × Stage Matrix */}
          <Card className="lg:col-span-3 border border-gray-200">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold text-gray-800">
                Period × Stage Payment Matrix
              </CardTitle>
              <p className="text-xs text-gray-400">
                Click a cell to navigate to that period + stage in Financials.
                Color intensity = relative value.
              </p>
            </CardHeader>
            <CardContent>
              {matrixPeriods.length === 0 ? (
                <div className="text-center py-10 text-gray-400 text-sm">
                  No period/stage data yet.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr>
                        <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500 w-28">Period</th>
                        {matrixStages.map(s=>(
                          <th key={s.id} className="text-center px-3 py-2 text-xs font-semibold text-gray-500 whitespace-nowrap">
                            {s.code}
                          </th>
                        ))}
                        <th className="text-right px-3 py-2 text-xs font-semibold text-gray-600">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {matrixPeriods.map(period => {
                        const rowCells = matrixStages.map(stage => {
                          const key = `${period.id}-${stage.id}`;
                          return matrixLookup[key] || null;
                        });
                        const rowTotal = rowCells.reduce((sum,c)=>sum+(c?.calculated_total||0),0);
                        return (
                          <tr key={period.id} className="border-t border-gray-100">
                            <td className="px-3 py-2 text-xs font-medium text-gray-700 whitespace-nowrap">
                              {period.name}
                            </td>
                            {rowCells.map((cell, i) => {
                              const val = cell?.calculated_total || 0;
                              const isFinalized = cell && cell.finalized_total > 0;
                              const bg = cellColor(val, matrixMax);
                              const tc = cellTextColor(val, matrixMax);
                              return (
                                <td key={i} className="px-2 py-1">
                                  <div
                                    onClick={()=>cell&&handleMatrixCellClick(period.id, matrixStages[i].id)}
                                    className={`rounded px-2 py-2 text-center transition-all
                                      ${val>0?'cursor-pointer hover:opacity-80':'cursor-default'}`}
                                    style={{ backgroundColor: bg }}>
                                    {val > 0 ? (
                                      <div>
                                        <div className="font-bold text-xs" style={{ color: tc }}>
                                          {fmtCurrency(val)}
                                        </div>
                                        {isFinalized && (
                                          <div className="text-xs mt-0.5 opacity-70" style={{ color: tc }}>
                                            ✓ {fmtCurrency(cell.finalized_total)}
                                          </div>
                                        )}
                                      </div>
                                    ) : (
                                      <span className="text-gray-300 text-xs">—</span>
                                    )}
                                  </div>
                                </td>
                              );
                            })}
                            <td className="px-3 py-2 text-right">
                              <span className="font-semibold text-gray-800 text-xs">
                                {rowTotal > 0 ? fmtCurrency(rowTotal) : '—'}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                      {/* Column totals row */}
                      <tr className="border-t-2 border-gray-300 bg-gray-50">
                        <td className="px-3 py-2 text-xs font-bold text-gray-700">Total</td>
                        {matrixStages.map(stage => {
                          const colTotal = matrixPeriods.reduce((sum, period) => {
                            const cell = matrixLookup[`${period.id}-${stage.id}`];
                            return sum + (cell?.calculated_total||0);
                          }, 0);
                          return (
                            <td key={stage.id} className="px-2 py-2 text-center">
                              <span className="font-bold text-xs text-gray-800">
                                {colTotal > 0 ? fmtCurrency(colTotal) : '—'}
                              </span>
                            </td>
                          );
                        })}
                        <td className="px-3 py-2 text-right">
                          <span className="font-bold text-sm text-blue-700">
                            {fmtCurrency(
                              matrixPeriods.reduce((sum,period) =>
                                sum + matrixStages.reduce((s2,stage) => {
                                  const cell = matrixLookup[`${period.id}-${stage.id}`];
                                  return s2+(cell?.calculated_total||0);
                                },0)
                              ,0)
                            )}
                          </span>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Teacher Rankings */}
          <Card className="lg:col-span-2 border border-gray-200">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-semibold text-gray-800">Top Teachers</CardTitle>
                <select
                  value={rankMetric}
                  onChange={e=>setRankMetric(e.target.value)}
                  className="text-xs border rounded px-2 py-1 bg-white">
                  <option value="payment">By Payment</option>
                  <option value="watch_time">By Watch Time</option>
                  <option value="watch_pct">By Watch %</option>
                </select>
              </div>
              {summary.stages.length > 0 && (
                <select
                  value={rankStageId||''}
                  onChange={e=>setRankStageId(e.target.value?parseInt(e.target.value):null)}
                  className="text-xs border rounded px-2 py-1 bg-white w-full mt-1">
                  <option value="">All Stages</option>
                  {summary.stages.map(s=>(
                    <option key={s.id} value={s.id}>{s.code} — {s.name}</option>
                  ))}
                </select>
              )}
            </CardHeader>
            <CardContent>
              {filteredRankings.length === 0 ? (
                <div className="text-center py-10 text-gray-400 text-sm">No ranking data yet.</div>
              ) : (
                <div className="space-y-2">
                  {filteredRankings.map((row, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0
                        ${i===0?'bg-yellow-400 text-white':i===1?'bg-gray-300 text-gray-700':i===2?'bg-amber-600 text-white':'bg-gray-100 text-gray-500'}`}>
                        {i+1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="text-sm font-medium text-gray-800 truncate">{row.teacher_name}</span>
                          <span className="text-xs text-gray-600 font-mono flex-shrink-0 ml-2">
                            {rankMetric==='payment' ? `${fmtCurrency(row.value)} EGP`
                             : rankMetric==='watch_time' ? `${fmtMinutes(row.value*60)} min`
                             : `${row.value.toFixed(2)}%`}
                          </span>
                        </div>
                        {/* Progress bar */}
                        <div className="w-full bg-gray-100 rounded-full h-1.5">
                          <div
                            className="bg-blue-500 h-1.5 rounded-full"
                            style={{ width: `${(row.value/maxRankValue)*100}%` }}/>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ── ROW 3: Comparison Panel ─────────────────────────────────────── */}
        <Card className="border border-gray-200">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <CardTitle className="text-base font-semibold text-gray-800">Comparison Panel</CardTitle>
              {/* Chart / table toggle */}
              <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
                <button
                  onClick={()=>setCompView('chart')}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-sm font-medium transition-all
                    ${compView==='chart'?'bg-white shadow text-gray-900':'text-gray-500 hover:text-gray-700'}`}>
                  <BarChart2 className="w-3.5 h-3.5"/>Chart
                </button>
                <button
                  onClick={()=>setCompView('table')}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-sm font-medium transition-all
                    ${compView==='table'?'bg-white shadow text-gray-900':'text-gray-500 hover:text-gray-700'}`}>
                  <Table2 className="w-3.5 h-3.5"/>Table
                </button>
              </div>
            </div>

            {/* Comparison filter bar */}
            <div className="flex flex-wrap gap-3 mt-3">
              <div className="flex items-center gap-2">
                <label className="text-xs font-medium text-gray-500">X Axis:</label>
                <select value={compXAxis} onChange={e=>setCompXAxis(e.target.value)}
                  className="text-sm border rounded px-2 py-1 bg-white capitalize">
                  {X_AXIS_OPTIONS.map(o=>(
                    <option key={o} value={o}>{o.charAt(0).toUpperCase()+o.slice(1)}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs font-medium text-gray-500">Y Axis:</label>
                <select value={compYAxis} onChange={e=>setCompYAxis(e.target.value)}
                  className="text-sm border rounded px-2 py-1 bg-white">
                  {Y_AXIS_OPTIONS.map(o=>(
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs font-medium text-gray-500">Periods:</label>
                <div className="flex flex-wrap gap-1">
                  {summary.periods.map(p=>(
                    <button key={p.id}
                      onClick={()=>setCompPeriods(prev=>
                        prev.includes(p.id)?prev.filter(x=>x!==p.id):[...prev,p.id])}
                      className={`px-2 py-0.5 rounded text-xs font-medium border transition-all
                        ${compPeriods.includes(p.id)
                          ?'bg-blue-600 text-white border-blue-600'
                          :'bg-white text-gray-600 border-gray-300 hover:border-blue-400'}`}>
                      {p.name}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs font-medium text-gray-500">Stages:</label>
                <div className="flex flex-wrap gap-1">
                  {summary.stages.map(s=>(
                    <button key={s.id}
                      onClick={()=>setCompStages(prev=>
                        prev.includes(s.id)?prev.filter(x=>x!==s.id):[...prev,s.id])}
                      className={`px-2 py-0.5 rounded text-xs font-medium border transition-all
                        ${compStages.includes(s.id)
                          ?'bg-green-600 text-white border-green-600'
                          :'bg-white text-gray-600 border-gray-300 hover:border-green-400'}`}>
                      {s.code}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </CardHeader>

          <CardContent>
            {compLoading ? (
              <div className="h-64 flex items-center justify-center text-gray-400 text-sm">
                Loading comparison…
              </div>
            ) : !compData || compData.rows.length === 0 ? (
              <div className="h-64 flex items-center justify-center text-gray-400 text-sm">
                No data for selected filters.
              </div>
            ) : compView === 'chart' ? (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={compData.rows.slice(0,20)}
                    layout="vertical"
                    margin={{ top:0, right:40, bottom:0, left:120 }}>
                    <XAxis
                      type="number"
                      tickFormatter={v => compYAxis==='watch_time' ? `${Math.round(v/60)}m`
                        : compYAxis==='watch_pct' ? `${v.toFixed(0)}%`
                        : fmtCurrency(v)}
                      tick={{ fontSize:11, fill:'#6b7280' }}
                      axisLine={false}
                      tickLine={false}/>
                    <YAxis
                      type="category"
                      dataKey="label"
                      width={110}
                      tick={{ fontSize:11, fill:'#374151' }}
                      axisLine={false}
                      tickLine={false}/>
                    <RechartsTooltip
                      formatter={(v)=>[formatCompValue(v), Y_AXIS_OPTIONS.find(o=>o.value===compYAxis)?.label]}
                      contentStyle={{ fontSize:'12px', border:'1px solid #e5e7eb', borderRadius:'6px' }}
                      cursor={{ fill:'#f1f5f9' }}
                      isAnimationActive={false}/>
                    <Bar dataKey="value" radius={[0,4,4,0]} isAnimationActive={false}>
                      {compData.rows.slice(0,20).map((_, i) => (
                        <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]}/>
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              /* Table view */
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="text-left px-4 py-2 text-xs font-semibold text-gray-600">#</th>
                      <th className="text-left px-4 py-2 text-xs font-semibold text-gray-600 capitalize">{compXAxis}</th>
                      <th className="text-right px-4 py-2 text-xs font-semibold text-gray-600">
                        {Y_AXIS_OPTIONS.find(o=>o.value===compYAxis)?.label}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {compData.rows.map((row,i)=>(
                      <tr key={i} className="border-b hover:bg-gray-50">
                        <td className="px-4 py-2 text-gray-400 text-xs">{i+1}</td>
                        <td className="px-4 py-2 font-medium text-gray-800">{row.label}</td>
                        <td className="px-4 py-2 text-right font-mono text-gray-700">
                          {formatCompValue(row.value)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

      </div>
    </div>
  );
};

export default Dashboard;
