// FILE: frontend/src/pages/Financials.jsx
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Alert, AlertDescription } from '../components/ui/alert';
import financialApi from '../services/financial_api';
import {
  DollarSign, Plus, Calculator, TrendingUp, Users, Trash2,
  ChevronDown, ChevronUp, AlertTriangle, CheckCircle, XCircle,
  ArrowUpDown, ArrowUp, ArrowDown, Eye, RefreshCw, Clock
} from 'lucide-react';

// ─── Constants ───────────────────────────────────────────────────────────────
const EXCLUDED_KEY = (periodId, stageId) => `financials_excluded_${periodId}_${stageId}`;

const MONTHS = [
  { value: '01', label: 'January' }, { value: '02', label: 'February' },
  { value: '03', label: 'March' },   { value: '04', label: 'April' },
  { value: '05', label: 'May' },     { value: '06', label: 'June' },
  { value: '07', label: 'July' },    { value: '08', label: 'August' },
  { value: '09', label: 'September'},{ value: '10', label: 'October' },
  { value: '11', label: 'November' },{ value: '12', label: 'December' },
];

const MONTH_LABELS = {
  '01':'Jan','02':'Feb','03':'Mar','04':'Apr','05':'May','06':'Jun',
  '07':'Jul','08':'Aug','09':'Sep','10':'Oct','11':'Nov','12':'Dec',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
const fmtCurrency = (n) => new Intl.NumberFormat('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}).format(n||0);
const fmtMinutes  = (secs) => Math.round((secs||0)/60).toLocaleString();
const fmtPct      = (n,dec=2) => ((n||0)*100).toFixed(dec)+'%';

// ─── Tooltip component ────────────────────────────────────────────────────────
const Tooltip = ({ content, children }) => (
  <div className="relative group inline-block">
    {children}
    <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block
                    bg-gray-900 text-white text-xs rounded-lg px-3 py-2 whitespace-nowrap shadow-lg min-w-max">
      {content}
      <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900"/>
    </div>
  </div>
);

// ─── SortIcon ────────────────────────────────────────────────────────────────
const SortIcon = ({ col, sortCol, sortDir }) => {
  if (sortCol !== col) return <ArrowUpDown className="w-3 h-3 ml-1 text-gray-400 inline"/>;
  return sortDir === 'asc'
    ? <ArrowUp className="w-3 h-3 ml-1 text-blue-600 inline"/>
    : <ArrowDown className="w-3 h-3 ml-1 text-blue-600 inline"/>;
};

// ─── Main Component ───────────────────────────────────────────────────────────
const Financials = () => {
  // Core state
  const [periods, setPeriods]           = useState([]);
  const [stages, setStages]             = useState([]);
  const [selectedPeriod, setSelectedPeriod] = useState(null);
  const [selectedStage, setSelectedStage]   = useState(null);
  const [financialData, setFinancialData]   = useState(null);
  const [loading, setLoading]           = useState(true);
  const [calculating, setCalculating]   = useState(false);
  const [message, setMessage]           = useState({ text: '', type: '' });
  const [revenueChanged, setRevenueChanged] = useState(false);

  // UI collapse states
  const [stageCollapsed, setStageCollapsed]     = useState(false);
  const [expandedSections, setExpandedSections] = useState(new Set());
  const [revenueCollapsed, setRevenueCollapsed] = useState({});

  // Period form
  const [showPeriodForm, setShowPeriodForm] = useState(false);
  const [newPeriod, setNewPeriod] = useState({
    name: '', year: new Date().getFullYear(), notes: '', months: []
  });

  // Revenue inputs
  const [sectionRevenues, setSectionRevenues] = useState({});

  // Library preview / approval modal
  const [showLibraryModal, setShowLibraryModal] = useState(false);
  const [libraryPreview, setLibraryPreview]     = useState(null);
  const [excludedLibs, setExcludedLibs]         = useState(new Set());
  const [loadingPreview, setLoadingPreview]      = useState(false);

  // ── FEATURE 1: Select state for modal ────────────────────────────────────
  // selectedModalLibs tracks which libraries have their checkbox ticked in the modal.
  // This is separate from excludedLibs (reject/approve toggle).
  const [selectedModalLibs, setSelectedModalLibs] = useState(new Set());

  // Table filters & sorting
  const [subjectFilter, setSubjectFilter] = useState('all');
  const [sortCol, setSortCol]             = useState('library_name');
  const [sortDir, setSortDir]             = useState('asc');

  // ── Helpers ──────────────────────────────────────────────────────────────
  const showMsg = (text, type='success') => {
    setMessage({text,type});
    setTimeout(()=>setMessage({text:'',type:''}), 5000);
  };

  const getPeriod = () => periods.find(p=>p.id===selectedPeriod);
  const getPeriodMonths = () => getPeriod()?.months || [];

  // ── Load data ─────────────────────────────────────────────────────────────
  useEffect(()=>{ loadInitial(); },[]);

  useEffect(()=>{
    if(selectedPeriod && selectedStage) {
      loadFinancialData();
      // Restore persisted exclusions for this period+stage
      try {
        const saved = localStorage.getItem(EXCLUDED_KEY(selectedPeriod, selectedStage));
        setExcludedLibs(saved ? new Set(JSON.parse(saved)) : new Set());
      } catch { setExcludedLibs(new Set()); }
    }
  },[selectedPeriod, selectedStage]);

  const loadInitial = async () => {
    setLoading(true);
    try {
      const [p, s] = await Promise.all([
        financialApi.getFinancialPeriods(),
        financialApi.getStages(),
      ]);
      setPeriods(p);
      setStages(s);
      if(p.length>0 && !selectedPeriod) setSelectedPeriod(p[0].id);
    } catch(e) {
      showMsg('Error loading data: '+(e.response?.data?.detail||e.message),'error');
    } finally { setLoading(false); }
  };

  const loadFinancialData = async () => {
    try {
      const data = await financialApi.getFinancialData(selectedPeriod, selectedStage);
      setFinancialData(data);
      setRevenueChanged(false);
      const revs = {};
      data.section_revenues.forEach(r=>{
        revs[r.section_id]={total_orders:r.total_orders, total_revenue_egp:r.total_revenue_egp};
      });
      setSectionRevenues(revs);
      // Expand all sections by default after first load
      setExpandedSections(new Set(data.sections.map(s=>s.id)));
    } catch(e) {
      showMsg('Error loading financial data: '+(e.response?.data?.detail||e.message),'error');
    }
  };

  // ── Period CRUD ───────────────────────────────────────────────────────────
  const toggleMonth = (monthStr) => {
    setNewPeriod(prev=>{
      const ms = new Set(prev.months);
      ms.has(monthStr) ? ms.delete(monthStr) : ms.add(monthStr);
      return {...prev, months: Array.from(ms).sort()};
    });
  };

  const handleCreatePeriod = async (e) => {
    e.preventDefault();
    if(newPeriod.months.length===0){
      showMsg('Please select at least one month for the period','error');
      return;
    }
    try {
      await financialApi.createFinancialPeriod(newPeriod);
      showMsg('Period created successfully');
      setNewPeriod({name:'',year:new Date().getFullYear(),notes:'',months:[]});
      setShowPeriodForm(false);
      loadInitial();
    } catch(e){
      showMsg('Error creating period: '+(e.response?.data?.detail||e.message),'error');
    }
  };

  const handleDeletePeriod = async (periodId) => {
    if(!window.confirm('Delete this period? All data will be lost.')) return;
    try {
      await financialApi.deleteFinancialPeriod(periodId);
      showMsg('Period deleted');
      setSelectedPeriod(null); setSelectedStage(null); setFinancialData(null);
      loadInitial();
    } catch(e){
      showMsg('Error: '+(e.response?.data?.detail||e.message),'error');
    }
  };

  // ── Revenue ───────────────────────────────────────────────────────────────
  const handleRevenueChange = (sectionId, field, value) => {
    setSectionRevenues(prev=>({
      ...prev,
      [sectionId]:{...(prev[sectionId]||{}), [field]:value}
    }));
    setRevenueChanged(true);
  };

  const handleSaveRevenue = async (sectionId) => {
    if(!selectedPeriod||!selectedStage) return;
    const rev = sectionRevenues[sectionId];
    if(!rev) return;
    try {
      await financialApi.createOrUpdateSectionRevenue({
        period_id:selectedPeriod, stage_id:selectedStage, section_id:sectionId,
        total_orders:parseInt(rev.total_orders)||0,
        total_revenue_egp:parseFloat(rev.total_revenue_egp)||0,
      });
      showMsg('Revenue saved — click Calculate Payments to update results','success');
      setRevenueChanged(true);
    } catch(e){
      showMsg('Error saving revenue: '+(e.response?.data?.detail||e.message),'error');
    }
  };

  // ── Library Preview ───────────────────────────────────────────────────────
  const openLibraryPreview = async () => {
    if(!selectedPeriod||!selectedStage) return;
    setLoadingPreview(true);
    setShowLibraryModal(true);
    setSelectedModalLibs(new Set()); // reset checkbox selection on open
    try {
      const data = await financialApi.getLibrariesPreview(selectedPeriod, selectedStage);
      setLibraryPreview(data);
      // ── FEATURE 1 FIX: Restore persisted exclusions when modal opens ──────
      // Do NOT wipe excludedLibs here — restore from localStorage so user's
      // previously rejected libraries are preserved across modal open/close.
      try {
        const saved = localStorage.getItem(EXCLUDED_KEY(selectedPeriod, selectedStage));
        if(saved) setExcludedLibs(new Set(JSON.parse(saved)));
        // else leave current excludedLibs untouched (already loaded on period/stage change)
      } catch {}
    } catch(e){
      showMsg('Error loading preview: '+(e.response?.data?.detail||e.message),'error');
      setShowLibraryModal(false);
    } finally { setLoadingPreview(false); }
  };

  // ── FEATURE 1: Persist exclusion toggle ──────────────────────────────────
  const persistExcluded = (newSet) => {
    try {
      localStorage.setItem(
        EXCLUDED_KEY(selectedPeriod, selectedStage),
        JSON.stringify(Array.from(newSet))
      );
    } catch {}
  };

  const toggleLibraryExclude = (libId) => {
    setExcludedLibs(prev=>{
      const s = new Set(prev);
      s.has(libId) ? s.delete(libId) : s.add(libId);
      persistExcluded(s);
      return s;
    });
  };

  // ── FEATURE 1: Bulk reject/restore selected libraries ────────────────────
  const rejectSelected = () => {
    setExcludedLibs(prev=>{
      const s = new Set(prev);
      selectedModalLibs.forEach(id => s.add(id));
      persistExcluded(s);
      return s;
    });
    setSelectedModalLibs(new Set());
  };

  const restoreSelected = () => {
    setExcludedLibs(prev=>{
      const s = new Set(prev);
      selectedModalLibs.forEach(id => s.delete(id));
      persistExcluded(s);
      return s;
    });
    setSelectedModalLibs(new Set());
  };

  // Toggle a single checkbox in the modal
  const toggleModalSelect = (libId) => {
    setSelectedModalLibs(prev=>{
      const s = new Set(prev);
      s.has(libId) ? s.delete(libId) : s.add(libId);
      return s;
    });
  };

  // Select all / deselect all
  const toggleSelectAll = () => {
    const allIds = (libraryPreview?.libraries||[]).map(l=>l.library_id);
    if(selectedModalLibs.size === allIds.length) {
      setSelectedModalLibs(new Set());
    } else {
      setSelectedModalLibs(new Set(allIds));
    }
  };

  // ── Calculate ─────────────────────────────────────────────────────────────
  const handleCalculate = async () => {
    if(!selectedPeriod||!selectedStage){
      showMsg('Select a period and stage first','error'); return;
    }
    setCalculating(true);
    setShowLibraryModal(false);
    try {
      const result = await financialApi.calculatePayments(
        selectedPeriod, selectedStage, Array.from(excludedLibs)
      );
      showMsg(`Payments calculated! ${result.payments_calculated} teachers · Total: ${fmtCurrency(result.total_payment)} EGP`);
      setRevenueChanged(false);
      loadFinancialData();
    } catch(e){
      showMsg('Error: '+(e.response?.data?.detail||e.message),'error');
    } finally { setCalculating(false); }
  };

  // ── Sort ──────────────────────────────────────────────────────────────────
  const handleSort = (col) => {
    setSortDir(prev => sortCol===col ? (prev==='asc'?'desc':'asc') : 'asc');
    setSortCol(col);
  };

  const sortPayments = (payments) => {
    return [...payments].sort((a,b)=>{
      let va=a[sortCol], vb=b[sortCol];
      if(typeof va==='string') va=va.toLowerCase(), vb=(vb||'').toLowerCase();
      if(va===vb) return 0;
      const d = va < vb ? -1 : 1;
      return sortDir==='asc' ? d : -d;
    });
  };

  // ── Derived data ──────────────────────────────────────────────────────────
  const allSubjects = useMemo(()=>{
    if(!financialData) return [];
    const s = new Set(financialData.teacher_payments.map(p=>p.subject_name).filter(Boolean));
    return Array.from(s).sort();
  },[financialData]);

  const totalRevenue = useMemo(()=>{
    if(!financialData) return 0;
    return Object.values(sectionRevenues).reduce((sum,r)=>sum+(parseFloat(r.total_revenue_egp)||0),0);
  },[sectionRevenues]);

  const totalOrders = useMemo(()=>{
    if(!financialData) return 0;
    return Object.values(sectionRevenues).reduce((sum,r)=>sum+(parseInt(r.total_orders)||0),0);
  },[sectionRevenues]);

  const totalPayments = useMemo(()=>{
    if(!financialData) return 0;
    return financialData.teacher_payments.reduce((sum,p)=>sum+p.final_payment,0);
  },[financialData]);

  // ── Render: Period selector ───────────────────────────────────────────────
  const renderPeriods = () => (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2"><DollarSign className="w-5 h-5"/>Financial Period</span>
          <Button size="sm" onClick={()=>setShowPeriodForm(!showPeriodForm)}
            className="bg-blue-600 hover:bg-blue-700">
            <Plus className="w-4 h-4 mr-1"/>New Period
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {showPeriodForm && (
          <form onSubmit={handleCreatePeriod}
            className="border rounded-lg p-4 space-y-4 bg-gray-50">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-gray-700">Period Name *</label>
                <Input placeholder="Q1 2025, Midterm 2025"
                  value={newPeriod.name}
                  onChange={e=>setNewPeriod({...newPeriod,name:e.target.value})} required/>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Year *</label>
                <Input type="number" value={newPeriod.year}
                  onChange={e=>setNewPeriod({...newPeriod,year:parseInt(e.target.value)})} required/>
              </div>
            </div>

            {/* Month picker */}
            <div>
              <label className="text-sm font-medium text-gray-700 block mb-2">
                Select Months * ({newPeriod.months.length} selected)
              </label>
              <div className="grid grid-cols-4 gap-2">
                {MONTHS.map(m=>{
                  const key = `${newPeriod.year}-${m.value}`;
                  const selected = newPeriod.months.includes(key);
                  return (
                    <button type="button" key={m.value}
                      onClick={()=>toggleMonth(key)}
                      className={`px-3 py-2 rounded-lg text-sm font-medium border transition-all
                        ${selected
                          ? 'bg-blue-600 text-white border-blue-600 shadow'
                          : 'bg-white text-gray-700 border-gray-300 hover:border-blue-400'}`}>
                      {m.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-gray-700">Notes</label>
              <Input placeholder="Additional notes..." value={newPeriod.notes}
                onChange={e=>setNewPeriod({...newPeriod,notes:e.target.value})}/>
            </div>
            <div className="flex gap-2">
              <Button type="submit" className="bg-green-600 hover:bg-green-700">Create</Button>
              <Button type="button" variant="outline" onClick={()=>setShowPeriodForm(false)}>Cancel</Button>
            </div>
          </form>
        )}

        <div className="space-y-2">
          {periods.map(period=>(
            <div key={period.id}
              onClick={()=>setSelectedPeriod(period.id)}
              className={`flex items-center justify-between p-4 border rounded-lg cursor-pointer transition-colors
                ${selectedPeriod===period.id?'bg-blue-50 border-blue-300':'hover:bg-gray-50'}`}>
              <div>
                <div className="font-semibold text-lg">{period.name}</div>
                <div className="text-sm text-gray-500">Year: {period.year}</div>
                {period.months?.length>0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {period.months.map(m=>(
                      <span key={m} className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-mono">
                        {MONTH_LABELS[m.split('-')[1]]} {m.split('-')[0]}
                      </span>
                    ))}
                  </div>
                )}
                {period.notes && <div className="text-xs text-gray-400 mt-1">{period.notes}</div>}
              </div>
              <div className="flex items-center gap-2">
                {selectedPeriod===period.id &&
                  <span className="text-xs bg-blue-600 text-white px-2 py-1 rounded">Selected</span>}
                <Button size="sm" variant="outline"
                  onClick={e=>{e.stopPropagation();handleDeletePeriod(period.id);}}
                  className="text-red-600 hover:text-red-700">
                  <Trash2 className="w-4 h-4"/>
                </Button>
              </div>
            </div>
          ))}
          {periods.length===0 && <div className="text-center py-8 text-gray-500">No periods yet.</div>}
        </div>
      </CardContent>
    </Card>
  );

  // ── Render: Stage selector (collapsible) ──────────────────────────────────
  const renderStages = () => (
    <Card>
      <CardHeader className="cursor-pointer" onClick={()=>setStageCollapsed(!stageCollapsed)}>
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5"/>Select Stage
            {selectedStage && (
              <span className="text-sm font-normal text-blue-600 ml-2">
                ({stages.find(s=>s.id===selectedStage)?.code})
              </span>
            )}
          </span>
          {stageCollapsed ? <ChevronDown className="w-5 h-5 text-gray-400"/> : <ChevronUp className="w-5 h-5 text-gray-400"/>}
        </CardTitle>
      </CardHeader>
      {!stageCollapsed && (
        <CardContent>
          {!selectedPeriod ? (
            <div className="text-center py-6 text-gray-500">Select a period first</div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {stages.map(stage=>(
                <div key={stage.id}
                  onClick={()=>{ setSelectedStage(stage.id); setStageCollapsed(true); }}
                  className={`p-4 border rounded-lg cursor-pointer text-center transition-all
                    ${selectedStage===stage.id
                      ?'bg-green-50 border-green-400 shadow-md'
                      :'hover:bg-gray-50 hover:shadow'}`}>
                  <div className="text-2xl font-bold text-blue-600">{stage.code}</div>
                  <div className="text-sm font-medium mt-1">{stage.name}</div>
                  {selectedStage===stage.id &&
                    <span className="text-xs bg-green-600 text-white px-2 py-0.5 rounded mt-1 inline-block">Active</span>}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );

  // ── Render: Summary card ──────────────────────────────────────────────────
  const renderSummary = () => {
    if(!financialData) return null;
    return (
      <Card className="bg-gradient-to-r from-green-50 to-blue-50 border-green-200">
        <CardContent className="p-6">
          <div className="grid grid-cols-3 gap-6">
            <div className="text-center">
              <div className="text-3xl font-bold text-green-600">{fmtCurrency(totalPayments)}</div>
              <div className="text-sm text-gray-600 mt-1">Total Payments (EGP)</div>
              {revenueChanged && (
                <div className="text-xs text-orange-600 mt-1 font-medium flex items-center gap-2">
                  ⚠ Revenue changed —
                  <button
                    onClick={handleCalculate}
                    disabled={calculating}
                    className="underline font-bold hover:text-orange-800 disabled:opacity-50">
                    {calculating ? 'Calculating…' : 'Recalculate now'}
                  </button>
                </div>
              )}
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-purple-600">{totalOrders.toLocaleString()}</div>
              <div className="text-sm text-gray-600 mt-1">Total Orders</div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-orange-600">{fmtCurrency(totalRevenue)}</div>
              <div className="text-sm text-gray-600 mt-1">Total Revenue (EGP)</div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

  // ── Render: Watch time tooltip ────────────────────────────────────────────
  const renderWatchTimeCell = (payment) => {
    const breakdown = payment.monthly_watch_breakdown || {};
    const hasBd = Object.keys(breakdown).length > 0;
    const totalMins = fmtMinutes(payment.total_watch_time_seconds);

    if(!hasBd) return <span className="font-mono">{totalMins} min</span>;

    const bdContent = (
      <div className="space-y-1 min-w-[180px]">
        {Object.entries(breakdown).sort().map(([k,v])=>(
          <div key={k} className="flex justify-between gap-6">
            <span className="text-gray-300">{MONTH_LABELS[k.split('-')[1]]} {k.split('-')[0]}</span>
            <span className="font-mono font-bold">{fmtMinutes(v)} min</span>
          </div>
        ))}
        <div className="border-t border-gray-600 pt-1 mt-1 flex justify-between gap-6">
          <span className="text-gray-300">Total</span>
          <span className="font-mono font-bold text-yellow-300">{totalMins} min</span>
        </div>
      </div>
    );

    return (
      <Tooltip content={bdContent}>
        <span className="font-mono underline decoration-dotted cursor-help">{totalMins} min</span>
      </Tooltip>
    );
  };

  // ── FEATURE 3 & 4: Render section payments table ──────────────────────────
  // Added: "before tax" sub-line under total payment in totals row
  // Added: total watch time column at end of totals row
  const renderPaymentsTable = (sectionPayments) => {
    const filtered = subjectFilter==='all'
      ? sectionPayments
      : sectionPayments.filter(p=>p.subject_name===subjectFilter);
    const sorted = sortPayments(filtered);

    if(sorted.length===0) return (
      <div className="text-center py-8 text-gray-500 border rounded-lg bg-gray-50">
        <Calculator className="w-10 h-10 mx-auto mb-2 text-gray-400"/>
        <div>No payments yet — save revenue and click Calculate Payments</div>
      </div>
    );

    const thClass = "text-xs font-semibold text-gray-600 px-3 py-2 cursor-pointer select-none whitespace-nowrap";
    const tdClass = "px-3 py-2 text-sm";

    // ── FEATURE 4: Compute section totals ────────────────────────────────
    const totalFinalPayment    = sorted.reduce((s,p) => s + p.final_payment, 0);
    const totalBeforeTax       = sorted.reduce((s,p) => s + (p.calculated_revenue || 0), 0);
    const totalWatchTimeSecs   = sorted.reduce((s,p) => s + (p.total_watch_time_seconds || 0), 0);

    return (
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className={`${thClass} text-left`} onClick={()=>handleSort('library_name')}>
                Teacher <SortIcon col="library_name" sortCol={sortCol} sortDir={sortDir}/>
              </th>
              <th className={`${thClass} text-left`} onClick={()=>handleSort('subject_name')}>
                Subject <SortIcon col="subject_name" sortCol={sortCol} sortDir={sortDir}/>
              </th>
              <th className={`${thClass} text-right`} onClick={()=>handleSort('total_watch_time_seconds')}>
                Watch (min) <SortIcon col="total_watch_time_seconds" sortCol={sortCol} sortDir={sortDir}/>
              </th>
              <th className={`${thClass} text-right`} onClick={()=>handleSort('watch_time_percentage')}>
                Watch % <SortIcon col="watch_time_percentage" sortCol={sortCol} sortDir={sortDir}/>
              </th>
              <th className={`${thClass} text-right`}>Rev %</th>
              <th className={`${thClass} text-right`}>Tax %</th>
              <th className={`${thClass} text-right`} onClick={()=>handleSort('final_payment')}>
                Payment (EGP) <SortIcon col="final_payment" sortCol={sortCol} sortDir={sortDir}/>
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(payment=>(
              <tr key={payment.id} className="border-b hover:bg-gray-50 transition-colors">
                <td className={`${tdClass} text-left`}>
                  <div className="font-medium text-gray-900">{payment.library_name}</div>
                  <div className="text-xs text-gray-400">ID: {payment.library_id}</div>
                </td>
                <td className={`${tdClass} text-left`}>
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono font-semibold">{payment.subject_name}</span>
                    {payment.subject_is_common && (
                      <span className="text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded font-medium">Common</span>
                    )}
                  </div>
                </td>
                <td className={`${tdClass} text-right text-gray-700`}>
                  {renderWatchTimeCell(payment)}
                </td>
                <td className={`${tdClass} text-right text-gray-700`}>
                  {fmtPct(payment.watch_time_percentage)}
                </td>
                <td className={`${tdClass} text-right text-gray-500`}>
                  {fmtPct(payment.revenue_percentage_applied,0)}
                </td>
                <td className={`${tdClass} text-right text-gray-500`}>
                  {fmtPct(payment.tax_rate_applied,0)}
                </td>
                <td className={`${tdClass} text-right`}>
                  <div className="font-bold text-green-700">{fmtCurrency(payment.final_payment)}</div>
                  {payment.tax_amount>0 &&
                    <div className="text-xs text-gray-400">-{fmtCurrency(payment.tax_amount)} tax</div>}
                </td>
              </tr>
            ))}

            {/* ── FEATURE 3 & 4: Totals row ─────────────────────────────── */}
            <tr className="border-t-2 border-gray-300 bg-gray-100 font-bold">
              {/* Label spanning: Teacher, Subject, Watch%, Rev%, Tax% = 5 cols */}
              <td colSpan={2} className="px-3 py-2 text-right text-sm text-gray-700">
                Section Total:
              </td>

              {/* FEATURE 4: Total watch time for the section */}
              <td className="px-3 py-2 text-right">
                <div className="font-bold text-blue-700 font-mono flex items-center justify-end gap-1">
                  <Clock className="w-3.5 h-3.5 text-blue-500"/>
                  {fmtMinutes(totalWatchTimeSecs)} min
                </div>
              </td>

              {/* Watch %, Rev %, Tax % — empty spacers */}
              <td className="px-3 py-2"/>
              <td className="px-3 py-2"/>
              <td className="px-3 py-2"/>

              {/* FEATURE 3: Payment total + before-tax sub-line */}
              <td className="px-3 py-2 text-right">
                <div className="font-bold text-green-700 text-base">
                  {fmtCurrency(totalFinalPayment)}
                </div>
                <div className="text-xs text-gray-500 font-normal mt-0.5">
                  Before tax: {fmtCurrency(totalBeforeTax)}
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    );
  };

  // ── FEATURE 2: Render section cards with total watch time in header ───────
  const renderSections = () => {
    if(!financialData) return null;
    const {sections, teacher_payments} = financialData;

    const paymentsBySection = {};
    sections.forEach(sec=>{
      paymentsBySection[sec.id] = teacher_payments.filter(p=>p.section_id===sec.id);
    });

    return (
      <div className="space-y-4">
        {/* Subject filter bar */}
        {teacher_payments.length>0 && (
          <div className="flex items-center gap-3 bg-white border rounded-lg px-4 py-3">
            <span className="text-sm font-medium text-gray-600">Filter by Subject:</span>
            <select
              value={subjectFilter}
              onChange={e=>setSubjectFilter(e.target.value)}
              className="text-sm border rounded px-2 py-1 bg-white">
              <option value="all">All Subjects</option>
              {allSubjects.map(s=><option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        )}

        {sections.map(section=>{
          const secPayments   = paymentsBySection[section.id]||[];
          const isExpanded    = expandedSections.has(section.id);
          const revCollapsed  = revenueCollapsed[section.id];
          const rev           = sectionRevenues[section.id]||{total_orders:0,total_revenue_egp:0};
          const secTotal      = secPayments.reduce((s,p)=>s+p.final_payment,0);
          const secRevSaved   = financialData.section_revenues.find(r=>r.section_id===section.id);

          // ── FEATURE 2: Total watch time for this section ─────────────────
          const secTotalWatchSecs = secPayments.reduce((s,p)=>s+(p.total_watch_time_seconds||0),0);

          return (
            <Card key={section.id} className="overflow-hidden">
              {/* Section header — always visible, shows totals */}
              <div
                className="flex items-center justify-between px-5 py-4 bg-white cursor-pointer hover:bg-gray-50"
                onClick={()=>setExpandedSections(prev=>{
                  const s=new Set(prev);
                  s.has(section.id)?s.delete(section.id):s.add(section.id);
                  return s;
                })}>
                <div className="flex items-center gap-3">
                  <div className={`w-12 h-12 rounded-lg flex items-center justify-center font-bold text-lg
                    ${section.code==='GEN'?'bg-green-100 text-green-700':'bg-blue-100 text-blue-700'}`}>
                    {section.code}
                  </div>
                  <div>
                    <div className="font-semibold text-gray-900">{section.name}</div>
                    {/* ── FEATURE 2: Show total watch time alongside other stats ── */}
                    <div className="flex flex-wrap gap-3 text-sm text-gray-500 mt-0.5 items-center">
                      {secRevSaved && (
                        <>
                          <span>{secRevSaved.total_orders.toLocaleString()} orders</span>
                          <span className="text-gray-300">·</span>
                          <span>{fmtCurrency(secRevSaved.total_revenue_egp)} EGP revenue</span>
                        </>
                      )}
                      {secPayments.length>0 && (
                        <>
                          <span className="text-gray-300">·</span>
                          <span className="text-green-600 font-semibold">
                            {fmtCurrency(secTotal)} EGP payments
                          </span>
                          <span className="text-gray-300">·</span>
                          {/* Watch time badge */}
                          <span className="flex items-center gap-1 text-blue-600 font-semibold">
                            <Clock className="w-3.5 h-3.5"/>
                            {fmtMinutes(secTotalWatchSecs)} min watch
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400">{secPayments.length} teachers</span>
                  {isExpanded ? <ChevronUp className="w-4 h-4 text-gray-400"/>
                              : <ChevronDown className="w-4 h-4 text-gray-400"/>}
                </div>
              </div>

              {isExpanded && (
                <CardContent className="pt-0 space-y-4">
                  {/* Revenue block (collapsible) */}
                  <div className="border rounded-lg overflow-hidden">
                    <div
                      className="flex items-center justify-between px-4 py-3 bg-yellow-50 cursor-pointer"
                      onClick={()=>setRevenueCollapsed(prev=>({...prev,[section.id]:!prev[section.id]}))}>
                      <span className="text-sm font-semibold text-yellow-800 flex items-center gap-2">
                        <DollarSign className="w-4 h-4"/>Section Revenue
                      </span>
                      {revCollapsed ? <ChevronDown className="w-4 h-4 text-yellow-600"/>
                                    : <ChevronUp className="w-4 h-4 text-yellow-600"/>}
                    </div>
                    {!revCollapsed && (
                      <div className="p-4 bg-yellow-50 border-t border-yellow-200">
                        <div className="grid grid-cols-3 gap-4">
                          <div>
                            <label className="text-xs font-medium text-gray-600">Total Orders</label>
                            <Input type="number" placeholder="0"
                              value={rev.total_orders||''}
                              onChange={e=>handleRevenueChange(section.id,'total_orders',e.target.value)}/>
                          </div>
                          <div>
                            <label className="text-xs font-medium text-gray-600">Total Revenue (EGP)</label>
                            <Input type="number" step="0.01" placeholder="0.00"
                              value={rev.total_revenue_egp||''}
                              onChange={e=>handleRevenueChange(section.id,'total_revenue_egp',e.target.value)}/>
                          </div>
                          <div className="flex items-end">
                            <Button onClick={()=>handleSaveRevenue(section.id)}
                              className="bg-green-600 hover:bg-green-700 w-full">
                              Save Revenue
                            </Button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Payments table */}
                  <div>
                    <h3 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
                      <Users className="w-4 h-4 text-blue-500"/>
                      Teachers ({secPayments.length})
                    </h3>
                    {renderPaymentsTable(secPayments)}
                  </div>
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>
    );
  };

  // ── Render: Calculate footer ──────────────────────────────────────────────
  const renderCalculateBar = () => {
    if(!financialData) return null;
    return (
      <Card className={`border-2 ${revenueChanged?'border-orange-300 bg-orange-50':'border-blue-200 bg-blue-50'}`}>
        <CardContent className="p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h3 className="font-bold text-gray-900">
                {revenueChanged ? '⚠ Revenue updated — recalculate payments' : 'Calculate Payments'}
              </h3>
              <p className="text-sm text-gray-600 mt-0.5">
                Review libraries → approve/reject → calculate
              </p>
              {getPeriodMonths().length>0 && (
                <div className="flex gap-1 mt-1">
                  {getPeriodMonths().map(m=>(
                    <span key={m} className="text-xs bg-white border rounded px-1.5 py-0.5 font-mono text-gray-600">
                      {MONTH_LABELS[m.split('-')[1]]}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={openLibraryPreview}
                className="border-blue-400 text-blue-700 hover:bg-blue-100">
                <Eye className="w-4 h-4 mr-1"/>Review Libraries
                {excludedLibs.size>0 && (
                  <span className="ml-1.5 bg-red-500 text-white text-xs rounded-full px-1.5 py-0.5">
                    {excludedLibs.size} excluded
                  </span>
                )}
              </Button>
              <Button onClick={handleCalculate} disabled={calculating}
                className={`px-6 py-2 font-semibold text-white
                  ${revenueChanged
                    ?'bg-orange-500 hover:bg-orange-600'
                    :'bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700'}`}>
                <Calculator className="w-4 h-4 mr-2"/>
                {calculating ? 'Calculating…' : 'Calculate Payments'}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

  // ── FEATURE 1: Render library approval modal (with select + bulk actions) ─
  const renderLibraryModal = () => {
    if(!showLibraryModal) return null;
    const periodMonths  = libraryPreview?.period_months || [];
    const libraries     = libraryPreview?.libraries || [];
    const allIds        = libraries.map(l=>l.library_id);
    const allSelected   = allIds.length > 0 && selectedModalLibs.size === allIds.length;
    const someSelected  = selectedModalLibs.size > 0;
    const selectedAreAllExcluded = someSelected &&
      Array.from(selectedModalLibs).every(id => excludedLibs.has(id));

    return (
      <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center p-6 overflow-y-auto">
        <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b">
            <div>
              <h2 className="text-xl font-bold">Review Libraries</h2>
              <p className="text-sm text-gray-500 mt-0.5">
                Approve or reject libraries before calculating payments.
                Period months: {periodMonths.map(m=>MONTH_LABELS[m.split('-')[1]]).join(', ')}
              </p>
            </div>
            <button onClick={()=>setShowLibraryModal(false)}
              className="text-gray-400 hover:text-gray-600 text-2xl font-bold leading-none">×</button>
          </div>

          {loadingPreview ? (
            <div className="p-12 text-center text-gray-500">Loading library data…</div>
          ) : (
            <>
              {/* Warning banner */}
              {libraryPreview?.no_analytics_count>0 && (
                <div className="mx-6 mt-4 flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
                  <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0"/>
                  <span className="text-sm text-red-700 font-medium">
                    {libraryPreview.no_analytics_count} libraries have no watch time data for the selected months.
                    Consider rejecting them.
                  </span>
                </div>
              )}

              {/* Legend + bulk action bar */}
              <div className="px-6 pt-4 flex items-center justify-between flex-wrap gap-3">
                <div className="flex gap-4 text-xs text-gray-500">
                  <span className="flex items-center gap-1">
                    <CheckCircle className="w-3 h-3 text-green-500"/>Approved (included)
                  </span>
                  <span className="flex items-center gap-1">
                    <XCircle className="w-3 h-3 text-red-500"/>Rejected (excluded)
                  </span>
                  <span className="flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3 text-orange-400"/>No analytics
                  </span>
                </div>

                {/* ── FEATURE 1: Bulk action buttons ───────────────────── */}
                {someSelected && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500">{selectedModalLibs.size} selected</span>
                    {/* Show "Reject Selected" if any selected are currently approved */}
                    {!selectedAreAllExcluded && (
                      <button
                        onClick={rejectSelected}
                        className="flex items-center gap-1.5 text-xs bg-red-500 hover:bg-red-600 text-white px-3 py-1.5 rounded-lg font-medium transition-colors">
                        <XCircle className="w-3.5 h-3.5"/>Reject Selected
                      </button>
                    )}
                    {/* Show "Restore Selected" if any selected are currently excluded */}
                    {Array.from(selectedModalLibs).some(id=>excludedLibs.has(id)) && (
                      <button
                        onClick={restoreSelected}
                        className="flex items-center gap-1.5 text-xs bg-green-500 hover:bg-green-600 text-white px-3 py-1.5 rounded-lg font-medium transition-colors">
                        <CheckCircle className="w-3.5 h-3.5"/>Restore Selected
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Table */}
              <div className="px-6 py-4 max-h-[55vh] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      {/* ── FEATURE 1: Select all checkbox column ──────── */}
                      <th className="px-3 py-2 w-10">
                        <input
                          type="checkbox"
                          checked={allSelected}
                          onChange={toggleSelectAll}
                          className="w-4 h-4 rounded accent-blue-600 cursor-pointer"
                          title={allSelected ? 'Deselect all' : 'Select all'}
                        />
                      </th>
                      <th className="text-left px-3 py-2 text-xs font-semibold text-gray-600">Status</th>
                      <th className="text-left px-3 py-2 text-xs font-semibold text-gray-600">Library</th>
                      <th className="text-left px-3 py-2 text-xs font-semibold text-gray-600">Subject</th>
                      <th className="text-left px-3 py-2 text-xs font-semibold text-gray-600">Section</th>
                      <th className="text-right px-3 py-2 text-xs font-semibold text-gray-600">Total (min)</th>
                      {periodMonths.map(m=>(
                        <th key={m} className="text-right px-2 py-2 text-xs font-semibold text-gray-600">
                          {MONTH_LABELS[m.split('-')[1]]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {libraries.map(lib=>{
                      const rejected  = excludedLibs.has(lib.library_id);
                      const noData    = !lib.has_analytics;
                      const isChecked = selectedModalLibs.has(lib.library_id);
                      return (
                        <tr key={`${lib.library_id}-${lib.section_name}`}
                          className={`border-b transition-colors
                            ${isChecked ? 'bg-blue-50' : ''}
                            ${rejected && !isChecked ? 'opacity-50 bg-red-50' : ''}
                            ${noData && !rejected && !isChecked ? 'bg-orange-50' : ''}
                            ${!rejected && !noData && !isChecked ? 'hover:bg-gray-50' : ''}`}>

                          {/* ── FEATURE 1: Row checkbox ────────────────── */}
                          <td className="px-3 py-2">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={()=>toggleModalSelect(lib.library_id)}
                              className="w-4 h-4 rounded accent-blue-600 cursor-pointer"
                            />
                          </td>

                          {/* Status toggle (approve / reject) */}
                          <td className="px-3 py-2">
                            <button
                              onClick={()=>toggleLibraryExclude(lib.library_id)}
                              className="focus:outline-none"
                              title={rejected ? 'Click to restore' : 'Click to reject'}>
                              {rejected
                                ? <XCircle className="w-5 h-5 text-red-500"/>
                                : <CheckCircle className="w-5 h-5 text-green-500"/>}
                            </button>
                          </td>

                          <td className="px-3 py-2">
                            <div className="font-medium">{lib.library_name}</div>
                            <div className="text-xs text-gray-400">ID: {lib.library_id}</div>
                          </td>
                          <td className="px-3 py-2">
                            <span className={`text-xs px-2 py-0.5 rounded font-semibold
                              ${lib.subject_is_common?'bg-purple-100 text-purple-700':'bg-gray-100 text-gray-700'}`}>
                              {lib.subject_name}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-gray-600">{lib.section_name}</td>
                          <td className="px-3 py-2 text-right font-mono">
                            {noData
                              ? <span className="text-orange-500 flex items-center justify-end gap-1">
                                  <AlertTriangle className="w-3 h-3"/>0
                                </span>
                              : fmtMinutes(lib.total_watch_time_seconds)
                            }
                          </td>
                          {periodMonths.map(m=>(
                            <td key={m} className="px-2 py-2 text-right font-mono text-gray-500 text-xs">
                              {fmtMinutes(lib.monthly_watch_breakdown?.[m]||0)}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Footer */}
              <div className="px-6 py-4 border-t flex items-center justify-between bg-gray-50 rounded-b-xl">
                <div className="flex items-center gap-4 flex-wrap">
                  <div className="text-sm text-gray-600">
                    <span className="font-semibold text-green-700">
                      {libraries.length - excludedLibs.size} approved
                    </span>
                    {excludedLibs.size>0 &&
                      <span className="text-red-600 ml-3 font-semibold">{excludedLibs.size} rejected</span>}
                  </div>
                  {excludedLibs.size>0 && (
                    <button
                      onClick={()=>{
                        setExcludedLibs(new Set());
                        try { localStorage.removeItem(EXCLUDED_KEY(selectedPeriod, selectedStage)); } catch {}
                      }}
                      className="text-xs text-blue-600 underline hover:text-blue-800">
                      Restore all
                    </button>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={()=>setShowLibraryModal(false)}>Cancel</Button>
                  <Button onClick={handleCalculate} disabled={calculating}
                    className="bg-blue-600 hover:bg-blue-700 text-white">
                    <Calculator className="w-4 h-4 mr-1"/>
                    {calculating ? 'Calculating…' : 'Calculate Now'}
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    );
  };

  // ── Main render ───────────────────────────────────────────────────────────
  if(loading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-lg text-gray-600">Loading financials…</div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      {renderLibraryModal()}

      <div className="max-w-7xl mx-auto space-y-5">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
            <DollarSign className="w-8 h-8 text-green-600"/>Financial Management
          </h1>
          <p className="text-gray-500 mt-1">Manage periods, revenues, and calculate teacher payments</p>
        </div>

        {/* Alert */}
        {message.text && (
          <Alert className={message.type==='error'?'bg-red-50 border-red-200':'bg-green-50 border-green-200'}>
            <AlertDescription className={message.type==='error'?'text-red-800':'text-green-800'}>
              {message.text}
            </AlertDescription>
          </Alert>
        )}

        {renderPeriods()}
        {renderStages()}

        {financialData && (
          <>
            {renderSummary()}
            {renderSections()}
            {renderCalculateBar()}
          </>
        )}
      </div>
    </div>
  );
};

export default Financials;
