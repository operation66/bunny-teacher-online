// FILE: frontend/src/pages/Financials.jsx
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Alert, AlertDescription } from '../components/ui/alert';
import financialApi from '../services/financial_api';
import {
  DollarSign, Plus, Calculator, TrendingUp, Users, Trash2,
  ChevronDown, ChevronUp, AlertTriangle, CheckCircle, XCircle,
  ArrowUpDown, ArrowUp, ArrowDown, Eye, RefreshCw, Clock,
  ShieldCheck, ShieldAlert, ShieldX, FileText, Download,
  ChevronRight, GripVertical, BarChart2, FileDown
} from 'lucide-react';

// ─── Constants ───────────────────────────────────────────────────────────────
// EXCLUDED_KEY removed — exclusions now stored in DB via /library-exclusions endpoint
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

// Report column definitions
const REPORT_COLUMNS = {
  identity: {
    label: 'Identity',
    cols: [
      { key: 'teacher_name',   label: 'Teacher Name',  default: true },
      { key: 'teacher_code',   label: 'Teacher Code',  default: true },
      { key: 'library_name',   label: 'Library Name',  default: false },
      { key: 'library_id',     label: 'Library ID',    default: false },
      { key: 'stage_code',     label: 'Stage',         default: true },
      { key: 'section_code',   label: 'Section',       default: true },
      { key: 'subject_name',   label: 'Subject',       default: true },
      { key: 'period_name',    label: 'Period',        default: false },
    ]
  },
  watch_time: {
    label: 'Watch Time',
    cols: [
      { key: 'watch_time_minutes',    label: 'Watch Time (min)', default: true },
      { key: 'watch_time_percentage', label: 'Watch %',          default: true },
    ]
  },
  financial: {
    label: 'Financial',
    cols: [
      { key: 'revenue_percentage',  label: 'Revenue %',          default: false },
      { key: 'tax_percentage',      label: 'Tax %',              default: false },
      { key: 'base_revenue',        label: 'Base Revenue',       default: false },
      { key: 'calculated_revenue',  label: 'Calculated Revenue', default: false },
      { key: 'tax_amount',          label: 'Tax Amount',         default: false },
      { key: 'final_payment',       label: 'Final Payment',      default: true },
    ]
  },
  finalization: {
    label: 'Finalization',
    cols: [
      { key: 'transfer_percentage', label: 'Transfer %',      default: false },
      { key: 'transfer_amount',     label: 'Transfer Amount', default: false },
      { key: 'carry_forward_in',    label: 'Carry Fwd In',    default: false },
      { key: 'carry_forward_out',   label: 'Carry Fwd Out',   default: false },
      { key: 'total_due',           label: 'Total Due',       default: false },
    ]
  },
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
  const [selectedModalLibs, setSelectedModalLibs] = useState(new Set());

  // Table filters & sorting
  const [subjectFilter, setSubjectFilter] = useState('all');
  const [sortCol, setSortCol]             = useState('library_name');
  const [sortDir, setSortDir]             = useState('asc');

// ── NEW: Teacher view toggle ──────────────────────────────────────────────
  const [viewMode, setViewMode] = useState('teacher'); // default to teacher view
  const [expandedTeachers, setExpandedTeachers] = useState(new Set());

  // ── Search ────────────────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery]         = useState('');
  const [searchResults, setSearchResults]     = useState([]);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [highlightedId, setHighlightedId]     = useState(null); // library_id or teacher_profile_id
  const searchRef                             = useRef(null);
  // ── NEW: Audit state ──────────────────────────────────────────────────────
  const [lastAudit, setLastAudit]             = useState(null);
  const [auditExpanded, setAuditExpanded]     = useState(false);
  const [auditAcknowledged, setAuditAcknowledged] = useState(false);
  const [acknowledging, setAcknowledging]     = useState(false);

  // ── Audit detail panel ────────────────────────────────────────────────────
  const [showAuditPanel, setShowAuditPanel]   = useState(false);
  const [auditDetail, setAuditDetail]         = useState(null);
  const [loadingAuditDetail, setLoadingAuditDetail] = useState(false);
  const [auditHistory, setAuditHistory]       = useState([]);
  const [expandedWarningGroups, setExpandedWarningGroups] = useState({
    critical: true, warning: true, finalization_only: true,
    info: true, no_impact: false, resolved: false,
  });

// ── NEW: Finalization modal ───────────────────────────────────────────────
  const [showFinalizationModal, setShowFinalizationModal] = useState(false);
  const [finalizationPreview, setFinalizationPreview]     = useState(null);
  const [loadingFinalization, setLoadingFinalization]     = useState(false);
  const [finalizationInputs, setFinalizationInputs]       = useState({});
  const [submittingFinalization, setSubmittingFinalization] = useState(false);
  const [showCreatePeriodInline, setShowCreatePeriodInline] = useState(false);
  const [finalizeFilterStage, setFinalizeFilterStage]     = useState('all');
  const [finalizeFilterSubject, setFinalizeFilterSubject] = useState('all');
  const [sectionFilter, setSectionFilter]                 = useState('all');
  const [collapsedFinalizeTeachers, setCollapsedFinalizeTeachers] = useState(new Set());
  
  // ── NEW: Report builder modal ─────────────────────────────────────────────
  const [showReportModal, setShowReportModal]   = useState(false);
  const [reportStep, setReportStep]             = useState(1);
  const [reportConfig, setReportConfig]         = useState({
    report_type: 'teacher',
    period_ids: [],
    stage_ids: [],
    section_ids: [],
    subject_ids: [],
    teacher_profile_ids: [],
    columns: Object.values(REPORT_COLUMNS).flatMap(g => g.cols.filter(c=>c.default).map(c=>c.key)),
    group_by: 'teacher',
    group_by_secondary: null,
    show_subtotals: true,
    show_grand_total: true,
    sort_by: 'final_payment',
    sort_direction: 'desc',
    comparative_teachers: [],
  });
  const [reportData, setReportData]             = useState(null);
  const [generatingReport, setGeneratingReport] = useState(false);
  const [teacherProfiles, setTeacherProfiles]   = useState([]);
  const [finalizationsMap, setFinalizationsMap] = useState({});
  const [showResetModal, setShowResetModal]     = useState(false);
  const [resetting, setResetting]               = useState(false);
  const [resetSummary, setResetSummary]         = useState(null);
  const [resetConfirmed, setResetConfirmed]     = useState(false);
  const [subjectChangeWarning, setSubjectChangeWarning] = useState(() => {
    try { const s = localStorage.getItem('subject_change_warning'); return s ? JSON.parse(s) : null; } catch { return null; }
  });

  // ── Subject change warning lock ───────────────────────────────────────────
  const isStageWarningLocked = !!(
    subjectChangeWarning &&
    selectedStage &&
    subjectChangeWarning.affectedStageIds?.includes(selectedStage)
  );

  const renderSubjectChangeWarningBanner = () => {
    if (!subjectChangeWarning) return null;
    if (!selectedStage) return null;
    const isThisStageAffected = subjectChangeWarning.affectedStageIds?.includes(selectedStage);
    // Show a softer banner for non-affected stages, full lock for affected
    return (
      <div className={`border-2 rounded-xl p-4 flex items-start gap-4
        ${isThisStageAffected
          ? 'border-red-400 bg-red-50'
          : 'border-orange-300 bg-orange-50'}`}>
        <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0
          ${isThisStageAffected ? 'bg-red-100' : 'bg-orange-100'}`}>
          <AlertTriangle className={`w-5 h-5 ${isThisStageAffected ? 'text-red-600' : 'text-orange-600'}`}/>
        </div>
        <div className="flex-1 min-w-0">
          <p className={`font-bold text-base ${isThisStageAffected ? 'text-red-900' : 'text-orange-900'}`}>
            {isThisStageAffected
              ? '🔒 This stage is locked — Reset Stage to continue'
              : '⚠ Subject change pending — some stages need reset'}
          </p>
          <p className={`text-sm mt-1 ${isThisStageAffected ? 'text-red-800' : 'text-orange-800'}`}>
            Subject <strong>{subjectChangeWarning.subjectCode} — {subjectChangeWarning.subjectName}</strong> was changed from{' '}
            <strong>{subjectChangeWarning.wasCommon ? 'Common → Section-specific' : 'Section-specific → Common'}</strong>.
            {isThisStageAffected
              ? ' Existing payment calculations for this stage are now stale and must be reset.'
              : ' Select an affected stage below to reset it.'}
          </p>
          {isThisStageAffected && (
            <div className="mt-3 space-y-1">
              {subjectChangeWarning.wasCommon ? (
                <>
                  <p className="text-sm text-red-700 font-semibold">Steps to unlock:</p>
                  <p className="text-sm text-red-700">1. Click <strong>Reset Stage</strong> below ↓</p>
                  <p className="text-sm text-red-700">2. Go to <strong>Settings → Assignments</strong> and run <strong>Auto-Match</strong></p>
                  <p className="text-sm text-red-700">3. Return here and <strong>Calculate Payments</strong></p>
                </>
              ) : (
                <>
                  <p className="text-sm text-red-700 font-semibold">Steps to unlock:</p>
                  <p className="text-sm text-red-700">1. Click <strong>Reset Stage</strong> below ↓</p>
                  <p className="text-sm text-red-700">2. <strong>Calculate Payments</strong> again</p>
                </>
              )}
            </div>
          )}
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            <span className={`text-xs font-semibold ${isThisStageAffected ? 'text-red-700' : 'text-orange-700'}`}>
              Pending stages:
            </span>
            {subjectChangeWarning.affectedStageIds?.map(stageId => {
              const stage = stages.find(s => s.id === stageId);
              return stage ? (
                <span key={stageId}
                  className={`text-xs px-2 py-0.5 rounded font-mono font-bold cursor-pointer
                    ${stageId === selectedStage
                      ? 'bg-red-200 text-red-800 ring-2 ring-red-400'
                      : 'bg-orange-200 text-orange-800 hover:bg-orange-300'}`}
                  onClick={() => { setSelectedStage(stageId); setStageCollapsed(true); }}>
                  {stage.code}
                </span>
              ) : null;
            })}
          </div>
        </div>
      </div>
    );
  };

  // ── Helpers ──────────────────────────────────────────────────────────────
  const showMsg = (text, type='success') => {
    setMessage({text,type});
    setTimeout(()=>setMessage({text:'',type:''}), 5000);
  };

  const getPeriod = () => periods.find(p=>p.id===selectedPeriod);
  const getPeriodMonths = () => getPeriod()?.months || [];

// ── Period collapse ───────────────────────────────────────────────────────
  const [periodCollapsed, setPeriodCollapsed] = useState(false);

  // ── Load data ─────────────────────────────────────────────────────────────
  useEffect(()=>{ loadInitial(); },[]);
  
  useEffect(()=>{
    if(selectedPeriod && selectedStage) {
      loadFinancialData();
      loadLatestAudit();
      loadAuditHistory(selectedPeriod, selectedStage);
      loadFinalizations(selectedPeriod);
      loadExclusions(selectedPeriod, selectedStage);
    }
  },[selectedPeriod, selectedStage]);

  const loadInitial = async () => {
    setLoading(true);
    try {
      const [p, s, profiles] = await Promise.all([
        financialApi.getFinancialPeriods(),
        financialApi.getStages(),
        financialApi.getTeacherProfiles().catch(()=>[]),
      ]);
      setPeriods(p);
      setStages(s);
      setTeacherProfiles(profiles);
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
      setExpandedSections(new Set(data.sections.map(s=>s.id)));
    } catch(e) {
      showMsg('Error loading financial data: '+(e.response?.data?.detail||e.message),'error');
    }
  };

  const loadAuditDetail = async (auditId) => {
    if (!auditId) return;
    setLoadingAuditDetail(true);
    setAuditDetail(null);
    try {
      const detail = await financialApi.getAuditDetail(auditId);
      console.log('[AuditDetail] loaded:', detail);
      if (!detail || !detail.id) {
        console.warn('[AuditDetail] empty or invalid response', detail);
      }
      setAuditDetail(detail);
    } catch(e) {
      console.error('[AuditDetail] Failed to load audit detail', e);
    } finally {
      setLoadingAuditDetail(false);
    }
  };

  const loadAuditHistory = async (periodId, stageId) => {
    if (!periodId || !stageId) return;
    try {
      const history = await financialApi.getCalculationAudits(periodId, stageId);
      setAuditHistory(history || []);
    } catch(e) {
      console.error('Failed to load audit history', e);
    }
  };
  
  const loadLatestAudit = async () => {
    if(!selectedPeriod || !selectedStage) return;
    try {
      const audits = await financialApi.getCalculationAudits(selectedPeriod, selectedStage);
      if(audits && audits.length > 0) {
        setLastAudit(audits[0]); // newest first
        setAuditAcknowledged(audits[0].acknowledged);
      } else {
        setLastAudit(null);
        setAuditAcknowledged(false);
      }
    } catch { setLastAudit(null); }
  };
 
  const loadExclusions = async (periodId, stageId) => {
    try {
      const ids = await financialApi.getLibraryExclusions(periodId, stageId);
      setExcludedLibs(new Set(ids));
    } catch {
      setExcludedLibs(new Set());
    }
  };

  const loadFinalizations = async (periodId) => {
    if(!periodId) return;
    try {
      const fins = await financialApi.getFinalizations(periodId);
      // Build a map: String(teacher_profile_id) -> array of finalization records
      // Coerce to string so numeric vs string IDs always match
      const map = {};
      (fins || []).forEach(fin => {
        // Support both field names in case backend uses either
        const k = String(fin.teacher_profile_id ?? fin.profile_id ?? '');
        if(!k) return;
        if(!map[k]) map[k] = [];
        map[k].push(fin);
      });
      setFinalizationsMap(map);
    } catch(e) {
      console.error('Failed to load finalizations', e);
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
      setShowCreatePeriodInline(false);
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
    setSelectedModalLibs(new Set());
    try {
      const data = await financialApi.getLibrariesPreview(selectedPeriod, selectedStage);
      setLibraryPreview(data);
      // exclusions already loaded from DB on stage select — no need to reload here
    } catch(e){
      showMsg('Error loading preview: '+(e.response?.data?.detail||e.message),'error');
      setShowLibraryModal(false);
    } finally { setLoadingPreview(false); }
  };

  const persistExcluded = async (newSet) => {
    try {
      await financialApi.setLibraryExclusions(
        selectedPeriod,
        selectedStage,
        Array.from(newSet)
      );
    } catch(e) {
      console.error('Failed to save exclusions:', e);
    }
  };

  const toggleLibraryExclude = (libId) => {
    setExcludedLibs(prev=>{
      const s = new Set(prev);
      s.has(libId) ? s.delete(libId) : s.add(libId);
      persistExcluded(s); // async but fire-and-forget is fine here
      return s;
    });
  };

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
  
  const toggleModalSelect = (libId) => {
    setSelectedModalLibs(prev=>{
      const s = new Set(prev);
      s.has(libId) ? s.delete(libId) : s.add(libId);
      return s;
    });
  };

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
    setLastAudit(null);
    setAuditAcknowledged(false);
    try {
      const result = await financialApi.calculatePayments(
        selectedPeriod, selectedStage, Array.from(excludedLibs)
      );
      showMsg(`Payments calculated! ${result.payments_calculated} teachers · Total: ${fmtCurrency(result.total_payment)} EGP`);
      setRevenueChanged(false);
      // Set audit from response immediately
      if(result.audit_id) {
        setLastAudit({
          id: result.audit_id,
          status: result.audit_status,
          warnings: result.audit_warnings || [],
          verification_status: 'matched',
          verification_delta: 0,
          acknowledged: false,
        });
        setAuditAcknowledged(false);
        setAuditExpanded(true); // auto-expand banner
      }
      loadFinancialData();
    } catch(e){
      showMsg('Error: '+(e.response?.data?.detail||e.message),'error');
    } finally { setCalculating(false); }
  };

  // ── NEW: Audit acknowledge ────────────────────────────────────────────────
  const handleAcknowledgeAudit = async () => {
    if(!lastAudit) return;
    setAcknowledging(true);
    try {
      await financialApi.acknowledgeAudit(lastAudit.id);
      setAuditAcknowledged(true);
      setLastAudit(prev => ({...prev, acknowledged: true}));
      showMsg('Audit acknowledged — finalization is now available.');
    } catch(e) {
      showMsg('Error acknowledging audit: '+(e.response?.data?.detail||e.message),'error');
    } finally { setAcknowledging(false); }
  };

  // ── NEW: Open finalization modal ──────────────────────────────────────────
  const openFinalizationModal = async () => {
    if(!selectedPeriod) return;
    setLoadingFinalization(true);
    setShowFinalizationModal(true);
    setShowCreatePeriodInline(false);
    try {
      const preview = await financialApi.getFinalizationPreview(selectedPeriod);
      setFinalizationPreview(preview);
      // Initialize merged transfer % inputs (one per teacher)
      const inputs = {};
      preview.rows.forEach(row => {
        const mergedKey = `merged-${row.teacher_profile_id}`;
        if (!(mergedKey in inputs)) {
          inputs[mergedKey] = row.existing_transfer_percentage != null
            ? (row.existing_transfer_percentage * 100).toFixed(0)
            : '100';
        }
      });
      setFinalizationInputs(inputs);
    } catch(e) {
      showMsg('Error loading finalization: '+(e.response?.data?.detail||e.message),'error');
      setShowFinalizationModal(false);
    } finally { setLoadingFinalization(false); }
  };

  const getFinalizationRow = (row) => {
    const key = `${row.teacher_profile_id}-${row.stage_id}-${row.section_id}`;
    const pct = Math.min(100, Math.max(0, parseFloat(finalizationInputs[key]) || 0)) / 100;
    const transferAmount = row.total_due * pct;
    const carryOut = row.total_due - transferAmount;
    return { key, pct, transferAmount, carryOut };
  };

  const handleSubmitFinalization = async () => {
  if (!finalizationPreview) return;
  setSubmittingFinalization(true);
  try {
    const rows = (finalizationPreview.rows || []).map(row => {
      // Use the merged key: one transfer % per teacher across all their rows
      const mergedKey = `merged-${row.teacher_profile_id}`;
      const pctStr = finalizationInputs[mergedKey] ?? '100';
      const pct = Math.min(100, Math.max(0, parseFloat(pctStr) || 0)) / 100;
      return {
        teacher_profile_id: row.teacher_profile_id,
        stage_id:           row.stage_id,
        section_id:         row.section_id,
        transfer_percentage: pct,
        notes: null,
      };
    });
 
    await financialApi.submitFinalization({
      period_id: selectedPeriod,
      // Guard: only send audit_id if we actually have one (backend now accepts null)
      audit_id: lastAudit?.id ?? null,
      rows,
    });
 
    showMsg('Finalization saved successfully!');
    setShowFinalizationModal(false);
    loadFinalizations(selectedPeriod);
  } catch (e) {
    showMsg(
      'Error submitting finalization: ' + (e.response?.data?.detail || e.message),
      'error'
    );
  } finally {
    setSubmittingFinalization(false);
  }
};

  // ── Reset period stage ────────────────────────────────────────────────────
  const handleResetStage = async () => {
    if(!selectedPeriod || !selectedStage) return;
    setResetting(true);
    try {
      const result = await financialApi.resetPeriodStage(selectedPeriod, selectedStage);
      setResetSummary(result);
      setShowResetModal(false);
      setLastAudit(null);
      setAuditAcknowledged(false);
      setAuditHistory([]);
      setFinancialData(prev => prev ? {...prev, teacher_payments: []} : prev);
      setFinalizationsMap({});
      // Check if this reset clears the subject change warning
      if (subjectChangeWarning?.affectedStageIds?.includes(selectedStage)) {
        const remaining = subjectChangeWarning.affectedStageIds.filter(id => id !== selectedStage);
        if (remaining.length === 0) {
          setSubjectChangeWarning(null);
          try { localStorage.removeItem('subject_change_warning'); } catch {}
        } else {
          const updated = { ...subjectChangeWarning, affectedStageIds: remaining };
          setSubjectChangeWarning(updated);
          try { localStorage.setItem('subject_change_warning', JSON.stringify(updated)); } catch {}
        }
      }
      showMsg(
        `Reset complete — deleted ${result.deleted_payments} payments, ` +
        `${result.deleted_finalizations} finalizations, ` +
        `${result.deleted_audits} audits.`,
        'success'
      );
      loadFinancialData();
      loadFinalizations(selectedPeriod);
    } catch(e) {
      showMsg('Reset failed: '+(e.response?.data?.detail||e.message), 'error');
    } finally {
      setResetting(false);
    }
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

  // ── Search logic ──────────────────────────────────────────────────────────
  const allPayments = useMemo(() => financialData?.teacher_payments || [], [financialData]);

  useEffect(() => {
    if (!searchQuery.trim() || allPayments.length === 0) {
      setSearchResults([]);
      setShowSearchResults(false);
      return;
    }
    const q = searchQuery.toLowerCase();
    const seen = new Set();
    const results = [];
    allPayments.forEach(p => {
      const nameMatch  = (p.library_name || '').toLowerCase().includes(q);
      const codeMatch  = (p.teacher_profile_code || '').toLowerCase().includes(q);
      const tNameMatch = (p.teacher_profile_name || '').toLowerCase().includes(q);
      if (nameMatch || codeMatch || tNameMatch) {
        const key = p.teacher_profile_id || p.library_id;
        if (!seen.has(key)) {
          seen.add(key);
          results.push({
            id: key,
            library_id: p.library_id,
            teacher_profile_id: p.teacher_profile_id,
            label: p.teacher_profile_name || p.library_name,
            sublabel: p.teacher_profile_code
              ? `${p.teacher_profile_code} · ${p.library_name}`
              : `Library ID: ${p.library_id}`,
            section_id: p.section_id,
          });
        }
      }
    });
    setSearchResults(results.slice(0, 10));
    setShowSearchResults(true);
  }, [searchQuery, allPayments]);

  const scrollToResult = (result) => {
    setHighlightedId(result.library_id);
    setShowSearchResults(false);
    setSearchQuery('');
    // Expand the section containing this payment
    if (result.section_id) {
      setExpandedSections(prev => new Set([...prev, result.section_id]));
    }
    // In teacher view, expand the teacher card so the row renders in DOM
    const teacherKey = result.teacher_profile_id || result.label;
    setExpandedTeachers(prev => new Set([...prev, teacherKey]));

    // Retry scroll with backoff — waits for React to render expanded rows
    const attemptScroll = (attempts) => {
      if (attempts <= 0) { setHighlightedId(null); return; }
      const el = document.getElementById(`payment-row-${result.library_id}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(() => setHighlightedId(null), 3000);
      } else {
        setTimeout(() => attemptScroll(attempts - 1), 200);
      }
    };
    setTimeout(() => attemptScroll(5), 100);
  };
  // ── NEW: Teacher view grouping ────────────────────────────────────────────
  const groupPaymentsByTeacher = (payments) => {
    const grouped = {};
    payments.forEach(p => {
      const key = p.teacher_profile_id || p.library_name;
      if (!grouped[key]) {
        grouped[key] = {
          teacher_profile_id: p.teacher_profile_id,
          teacher_name: p.teacher_profile_name || p.library_name,
          teacher_code: p.teacher_profile_code || null,
          total_watch_time_seconds: 0,
          total_final_payment: 0,
          payments: [],
        };
      }
      grouped[key].total_watch_time_seconds += (p.total_watch_time_seconds || 0);
      grouped[key].total_final_payment += p.final_payment;
      grouped[key].payments.push(p);
    });
    return Object.values(grouped).sort((a,b)=>b.total_final_payment-a.total_final_payment);
  };

  // ── NEW: Report generation ────────────────────────────────────────────────
  const handleGenerateReport = async () => {
    setGeneratingReport(true);
    try {
      const data = await financialApi.generateReport(reportConfig);
      setReportData(data);
      setReportStep(5);
    } catch(e) {
      showMsg('Error generating report: '+(e.response?.data?.detail||e.message),'error');
    } finally { setGeneratingReport(false); }
  };

  const handleExportExcel = async () => {
    if(!reportData) return;
    try {
      // Dynamic import SheetJS
      const XLSX = await import('https://cdn.sheetjs.com/xlsx-0.20.0/package/xlsx.mjs');
      const visibleCols = reportData.columns.filter(c=>c.visible);
      const headers = visibleCols.map(c=>c.label);

      const rows = reportData.rows.map(row => {
        if(row.row_type === 'subtotal' || row.row_type === 'grand_total') {
          return visibleCols.map(c => row.data[c.key] !== undefined ? row.data[c.key] : (row.group_label || ''));
        }
        return visibleCols.map(c => row.data[c.key] !== undefined ? row.data[c.key] : '');
      });

      const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Report');
      const period = periods.find(p=>p.id===selectedPeriod);
      XLSX.writeFile(wb, `report_${period?.name||'export'}_${new Date().toISOString().slice(0,10)}.xlsx`);
    } catch(e) {
      showMsg('Excel export failed: '+e.message,'error');
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER: Reset confirmation modal
  // ─────────────────────────────────────────────────────────────────────────
  const renderResetModal = () => {
    if(!showResetModal) return null;
    const periodName = periods.find(p=>p.id===selectedPeriod)?.name || '';
    const stageName  = stages.find(s=>s.id===selectedStage)?.code  || '';
    const payCount   = financialData?.teacher_payments?.length || 0;
    const finCount   = finalizationsMap
      ? Object.values(finalizationsMap).reduce((s,arr)=>s+arr.length, 0)
      : 0;

    return (
      <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
          {/* Header */}
          <div className="flex items-center gap-3 px-6 py-4 border-b bg-red-50 rounded-t-xl">
            <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
              <AlertTriangle className="w-5 h-5 text-red-600"/>
            </div>
            <div>
              <h2 className="text-lg font-bold text-red-900">Reset Stage Data</h2>
              <p className="text-sm text-red-600">This action cannot be undone</p>
            </div>
          </div>

          {/* Body */}
          <div className="px-6 py-5 space-y-4">
            <p className="text-sm text-gray-700">
              You are about to permanently delete all calculated data for:
            </p>
            <div className="bg-gray-50 border rounded-lg px-4 py-3 space-y-1">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Period</span>
                <span className="font-semibold text-gray-900">{periodName}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Stage</span>
                <span className="font-semibold text-gray-900">{stageName}</span>
              </div>
            </div>

            {/* What will be deleted */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                What will be deleted:
              </p>
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-sm text-red-700">
                  <XCircle className="w-4 h-4 flex-shrink-0"/>
                  <span>
                    <strong>{payCount}</strong> teacher payment records
                  </span>
                </div>
                <div className="flex items-center gap-2 text-sm text-red-700">
                  <XCircle className="w-4 h-4 flex-shrink-0"/>
                  <span>
                    <strong>{finCount}</strong> finalization records
                  </span>
                </div>
                <div className="flex items-center gap-2 text-sm text-red-700">
                  <XCircle className="w-4 h-4 flex-shrink-0"/>
                  <span>
                    <strong>{auditHistory.length}</strong> audit trail runs
                  </span>
                </div>
              </div>
            </div>

            {/* Warning about carry-forward */}
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
              <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5"/>
              <p className="text-xs text-amber-800">
                If any carry-forward amounts from this stage were applied to a future
                period, those future period calculations may also be affected.
              </p>
            </div>

            {/* Confirm checkbox */}
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                className="w-4 h-4 accent-red-600"
                checked={resetConfirmed}
                onChange={e => setResetConfirmed(e.target.checked)}
              />
              <span className="text-sm text-gray-700">
                I understand this will permanently delete all data for this stage
              </span>
            </label>
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t bg-gray-50 rounded-b-xl flex items-center justify-between gap-3">
            <Button
              variant="outline"
              onClick={()=>{ setShowResetModal(false); setResetConfirmed(false); }}
              disabled={resetting}>
              Cancel
            </Button>
            <Button
              disabled={!resetConfirmed || resetting}
              onClick={handleResetStage}
              className="bg-red-600 hover:bg-red-700 text-white font-semibold disabled:opacity-40 disabled:cursor-not-allowed">
              {resetting
                ? 'Resetting…'
                : `Reset ${stageName} — ${periodName}`}
            </Button>
          </div>
        </div>
      </div>
    );
  };

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER: Period selector
  // ─────────────────────────────────────────────────────────────────────────
  const renderPeriods = () => (
    <Card>
      <CardHeader className="cursor-pointer" onClick={()=>setPeriodCollapsed(!periodCollapsed)}>
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <DollarSign className="w-5 h-5"/>Financial Period
            {selectedPeriod && periodCollapsed && (
              <span className="text-sm font-normal text-blue-600 ml-2">
                ({periods.find(p=>p.id===selectedPeriod)?.name})
              </span>
            )}
          </span>
          <div className="flex items-center gap-2" onClick={e=>e.stopPropagation()}>
            <Button size="sm" onClick={()=>setShowPeriodForm(!showPeriodForm)}
              className="bg-blue-600 hover:bg-blue-700">
              <Plus className="w-4 h-4 mr-1"/>New Period
            </Button>
            {periodCollapsed
              ? <ChevronDown className="w-5 h-5 text-gray-400"/>
              : <ChevronUp className="w-5 h-5 text-gray-400"/>}
          </div>
        </CardTitle>
      </CardHeader>
      {!periodCollapsed && <CardContent className="space-y-4">
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
              onClick={()=>{ setSelectedPeriod(period.id); setPeriodCollapsed(true); }}
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
      </CardContent>}
    </Card>
  );

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER: Stage selector
  // ─────────────────────────────────────────────────────────────────────────
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

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER: Summary card
  // ─────────────────────────────────────────────────────────────────────────
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
                  <button onClick={handleCalculate} disabled={calculating}
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

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER: NEW — Audit banner
  // ─────────────────────────────────────────────────────────────────────────
const renderAuditBanner = () => {
    if(!lastAudit) return null;

    const isFailed   = lastAudit.status === 'failed';
    const isWarnings = lastAudit.status === 'warnings';
    const isPassed   = lastAudit.status === 'passed';
    const isMismatch = lastAudit.verification_status === 'mismatched';

    const bgColor = isFailed || isMismatch
      ? 'bg-red-50 border-red-300'
      : isWarnings
        ? 'bg-yellow-50 border-yellow-300'
        : 'bg-green-50 border-green-300';

    const Icon = isFailed || isMismatch ? ShieldX : isWarnings ? ShieldAlert : ShieldCheck;
    const iconColor = isFailed || isMismatch ? 'text-red-500' : isWarnings ? 'text-yellow-500' : 'text-green-500';

    const warnings = lastAudit.warnings || [];

    return (
      <div className={`border rounded-lg ${bgColor} overflow-hidden`}>
{/* Banner header */}
        <div
          className="flex items-center justify-between px-4 py-3 cursor-pointer"
          onClick={()=>setAuditExpanded(!auditExpanded)}>
          <div className="flex items-center gap-3">
            <Icon className={`w-5 h-5 ${iconColor}`}/>
            <div>
              {isPassed && !isMismatch && (
                <span className="font-semibold text-green-800">Verification passed — all checks clear</span>
              )}
              {isWarnings && (
                <span className="font-semibold text-yellow-800">
                  {warnings.filter(w=>w.severity==='warning'||w.severity==='critical').length} warning{warnings.filter(w=>w.severity==='warning'||w.severity==='critical').length!==1?'s':''} — click to review
                  {warnings.filter(w=>w.severity==='finalization_only').length > 0 && (
                    <span className="text-purple-600 ml-2 font-normal text-xs">
                      + {warnings.filter(w=>w.severity==='finalization_only').length} finalization only
                    </span>
                  )}
                  {warnings.filter(w=>w.severity==='no_impact').length > 0 && (
                    <span className="text-gray-500 ml-2 font-normal text-xs">
                      + {warnings.filter(w=>w.severity==='no_impact').length} no impact
                </span>
              )}
                </span>
              )}
              {(isFailed || isMismatch) && (
                <span className="font-semibold text-red-800">
                  {isMismatch
                    ? `Verification mismatch — delta: ${fmtCurrency(lastAudit.verification_delta)} EGP`
                    : `${warnings.filter(w=>w.severity==='critical').length} critical issue(s) detected`
                  }
                </span>
              )}
              {/* Always show audit run ID for traceability */}
              <span className="text-xs text-gray-400 ml-2 font-mono">Run #{lastAudit.id}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {lastAudit.acknowledged && (
              <span className="text-xs bg-green-600 text-white px-2 py-0.5 rounded">Acknowledged</span>
            )}
            {/* View Audit Trail button — always visible regardless of status */}
            <button
              onClick={async e => {
                e.stopPropagation();
                setShowAuditPanel(true);
                setAuditDetail(null);
                setLoadingAuditDetail(true);
                const freshHistory = await financialApi.getCalculationAudits(
                selectedPeriod, selectedStage
                ).catch(()=>[]);
                setAuditHistory(freshHistory || []);
                const targetId = freshHistory?.length > 0
                ? freshHistory[0].id
                : lastAudit?.id;
                if(targetId) {
                await loadAuditDetail(targetId);
                } else {
                setLoadingAuditDetail(false);
                }
              }}
              className="text-xs font-semibold bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors">
              <FileText className="w-3.5 h-3.5"/>View Audit Trail
            </button>
            {warnings.length > 0
              ? (auditExpanded ? <ChevronUp className="w-4 h-4 text-gray-500"/> : <ChevronDown className="w-4 h-4 text-gray-500"/>)
              : null
            }
          </div>
        </div>

        {/* Expanded warnings list */}
        {auditExpanded && warnings.length > 0 && (
          <div className="px-4 pb-3 border-t border-gray-200">
            <div className="mt-3 space-y-2">
              {warnings.map((w,i)=>(
                <div key={i} className={`flex items-start gap-2 text-sm rounded px-3 py-2
                  ${w.severity==='critical'?'bg-red-100 text-red-800':'bg-yellow-100 text-yellow-800'}`}>
                  <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0"/>
                  <div>
                    <span className="font-mono font-semibold text-xs">[{w.code}]</span>
                    <span className="ml-2">{w.message}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Acknowledge row */}
        {!lastAudit.acknowledged && (warnings.length > 0 || isMismatch) && (
          <div className="px-4 py-3 border-t border-gray-200 flex items-center gap-3 bg-white/50">
            <input
              type="checkbox"
              id="ack-audit"
              checked={auditAcknowledged}
              onChange={()=>{}}
              className="w-4 h-4 accent-blue-600 cursor-pointer"
              disabled={acknowledging}
            />
            <label htmlFor="ack-audit" className="text-sm text-gray-700">
              I have reviewed and acknowledge all warnings
            </label>
            <Button
              size="sm"
              onClick={handleAcknowledgeAudit}
              disabled={acknowledging}
              className="bg-blue-600 hover:bg-blue-700 ml-2">
              {acknowledging ? 'Saving…' : 'Confirm Acknowledgement'}
            </Button>
          </div>
        )}
      </div>
    );
  };

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER: Audit Trail Panel
  // ─────────────────────────────────────────────────────────────────────────
  const renderAuditPanel = () => {
    if (!showAuditPanel) return null;

    const audit = auditDetail;
    const warnings = audit?.warnings || [];
    const hasErrors   = warnings.some(w => w.severity === 'critical');
    const hasWarnings = warnings.some(w => w.severity === 'warning');

    const statusBadge = !audit ? null : audit.status === 'passed'
      ? <span className="text-xs bg-green-100 text-green-700 border border-green-300 px-2 py-0.5 rounded-full font-semibold">PASSED</span>
      : audit.status === 'warnings'
        ? <span className="text-xs bg-yellow-100 text-yellow-700 border border-yellow-300 px-2 py-0.5 rounded-full font-semibold">WARNINGS</span>
        : <span className="text-xs bg-red-100 text-red-700 border border-red-300 px-2 py-0.5 rounded-full font-semibold">FAILED</span>;

    const inputs = audit?.inputs_snapshot || {};
    const sectionRevenues = inputs.section_revenues || {};
    const watchTimes = inputs.watch_time_map || inputs.watch_times || {};
    const excludedIds = inputs.excluded_library_ids || [];
    const periodMonths = inputs.period_months || [];

    const outputRows = audit?.output_rows || [];
    const verificationDelta = audit?.verification_delta || 0;
    const verificationOk = audit?.verification_status === 'matched';

    // Derive total payment from outputs
    const totalPaymentsFromOutputs = outputRows.reduce((s, r) => s + (r.final_payment || 0), 0);

    // Derive expected from section revenues (sum of all revenues)
    const totalRevenueFromInputs = Object.values(sectionRevenues).reduce(
      (s, r) => s + (r.total_revenue_egp || 0), 0
    );

    return (
      <div className="fixed inset-0 bg-black/60 z-50 flex items-start justify-center p-4 overflow-y-auto">
        <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl my-4">

          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b bg-gray-50 rounded-t-xl">
            <div>
              <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-blue-600"/>
                Calculation Audit Trail
              </h2>
              {audit && (
                <div className="flex items-center gap-2 mt-1">
                  {statusBadge}
                  <span className="text-sm text-gray-500">
                    Run #{audit.id} · {audit.created_at ? new Date(audit.created_at).toLocaleString() : ''}
                  </span>
                  {audit.acknowledged && (
                    <span className="text-xs bg-green-600 text-white px-2 py-0.5 rounded">
                      Acknowledged
                      {audit.acknowledged_at && (
                        <span className="ml-1 opacity-80">
                          · {new Date(audit.acknowledged_at).toLocaleString()}
                        </span>
                      )}
                    </span>
                  )}
                </div>
              )}
            </div>
            <button onClick={() => { setShowAuditPanel(false); setAuditDetail(null); }}
              className="text-gray-400 hover:text-gray-600 text-2xl font-bold leading-none">×</button>
          </div>

          <div className="max-h-[80vh] overflow-y-auto">

            {/* Run history selector */}
            {auditHistory.length > 0 && (
              <div className="px-6 pt-4 pb-3 border-b bg-gray-50">
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                  Calculation Runs for this Stage ({auditHistory.length})
                  <span className="ml-1 font-normal normal-case text-gray-400">— IDs are global across all stages</span>
                </div>
                <div className="flex gap-2 flex-wrap">
                  {auditHistory.map(h => (
                    <button
                      key={h.id}
                      onClick={() => loadAuditDetail(h.id)}
                      className={`text-xs px-3 py-1.5 rounded-lg border font-mono transition-all flex items-center gap-1.5
                        ${audit?.id === h.id
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-white text-gray-600 border-gray-300 hover:border-blue-400'}`}>
                      #{h.id}
                      <span className={`w-2 h-2 rounded-full ${
                        h.status === 'passed' ? 'bg-green-400' :
                        h.status === 'warnings' ? 'bg-yellow-400' : 'bg-red-400'
                      }`}/>
                      <span className="opacity-60 font-sans">
                        {h.created_at ? new Date(h.created_at).toLocaleDateString() : ''}
                      </span>
                      {h.acknowledged && <span className="text-green-300">✓</span>}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {loadingAuditDetail ? (
              <div className="p-16 text-center text-gray-400">
                <div className="text-4xl mb-3 animate-spin">⏳</div>
                Loading audit detail…
              </div>
            ) : !audit ? (
              <div className="p-16 text-center text-gray-400">
                <ShieldCheck className="w-12 h-12 mx-auto mb-3 opacity-30"/>
                {auditHistory.length > 0
                  ? <div>
                      <p className="mb-2">Click a run above to load its details.</p>
                      <button
                        onClick={() => loadAuditDetail(auditHistory[0].id)}
                        className="text-sm text-blue-600 underline hover:text-blue-800">
                        Load Run #{auditHistory[0].id}
                      </button>
                    </div>
                  : <p>No audit data available. Calculate payments first.</p>
                }
              </div>
            ) : (
              <div className="px-6 py-5 space-y-6">

                {/* ── OPTION A: Inputs Snapshot ── */}
                <div>
                  <h3 className="text-sm font-bold text-gray-800 uppercase tracking-wide mb-3 flex items-center gap-2">
                    <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded text-xs font-bold">Option A</span>
                    Inputs Snapshot
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

                    {/* Section revenues */}
                    <div className="border rounded-lg overflow-hidden">
                      <div className="bg-gray-50 px-4 py-2 text-xs font-semibold text-gray-600 uppercase tracking-wide border-b">
                        Section Revenues Used
                      </div>
                      <div className="divide-y">
                        {Object.entries(sectionRevenues).length === 0 ? (
                          <div className="px-4 py-3 text-sm text-gray-400">No revenue data recorded</div>
                        ) : Object.entries(sectionRevenues).map(([secId, data]) => (
                          <div key={secId} className="px-4 py-2.5 flex justify-between text-sm">
                            <span className="text-gray-600">Section {secId}</span>
                            <div className="text-right">
                              <div className="font-mono font-semibold text-gray-900">
                                {fmtCurrency(data.total_revenue_egp)} EGP
                              </div>
                              <div className="text-xs text-gray-400">{(data.total_orders||0).toLocaleString()} orders</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Period & exclusions */}
                    <div className="space-y-3">
                      <div className="border rounded-lg overflow-hidden">
                        <div className="bg-gray-50 px-4 py-2 text-xs font-semibold text-gray-600 uppercase tracking-wide border-b">
                          Period Months
                        </div>
                        <div className="px-4 py-3 flex flex-wrap gap-1.5">
                          {periodMonths.length === 0
                            ? <span className="text-sm text-gray-400">All months in period year</span>
                            : periodMonths.map(m => (
                                <span key={m} className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-mono">
                                  {MONTH_LABELS[m.split('-')[1]]} {m.split('-')[0]}
                                </span>
                              ))}
                        </div>
                      </div>
                      {excludedIds.length > 0 && (
                        <div className="border rounded-lg overflow-hidden">
                          <div className="bg-red-50 px-4 py-2 text-xs font-semibold text-red-600 uppercase tracking-wide border-b">
                            Excluded Libraries ({excludedIds.length})
                          </div>
                          <div className="px-4 py-3 flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                            {excludedIds.map(id => (
                              <span key={id} className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded font-mono">
                                ID {id}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* ── OPTION A: Warnings ── */}
                <div>
                  <h3 className="text-sm font-bold text-gray-800 uppercase tracking-wide mb-3 flex items-center gap-2">
                    <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded text-xs font-bold">Option A</span>
                    Warnings & Errors
                    {warnings.length === 0
                      ? <span className="text-xs text-green-600 font-normal normal-case">— none detected ✓</span>
                      : <span className="text-xs text-gray-500 font-normal normal-case">({warnings.length} total)</span>}
                  </h3>
                  {warnings.length === 0 ? (
                    <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-lg px-4 py-3">
                      <CheckCircle className="w-5 h-5 text-green-500"/>
                      <span className="text-sm text-green-700 font-medium">All checks passed — no warnings or errors</span>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {[
                        { key: 'critical',         label: 'Critical Issues',          bgHeader: 'bg-red-100 border-red-300',    bgItem: 'bg-red-50 border-red-200',    textHeader: 'text-red-800',    icon: '🚨' },
                        { key: 'warning',           label: 'Warnings',                 bgHeader: 'bg-yellow-100 border-yellow-300', bgItem: 'bg-yellow-50 border-yellow-200', textHeader: 'text-yellow-800', icon: '⚠️' },
                        { key: 'finalization_only', label: 'Affects Finalization Only', bgHeader: 'bg-purple-100 border-purple-300', bgItem: 'bg-purple-50 border-purple-200', textHeader: 'text-purple-800', icon: '🔗' },
                        { key: 'info',              label: 'Info',                     bgHeader: 'bg-blue-100 border-blue-300',  bgItem: 'bg-blue-50 border-blue-200',  textHeader: 'text-blue-800',  icon: 'ℹ️' },
                        { key: 'no_impact',         label: 'No Impact',                bgHeader: 'bg-gray-100 border-gray-300',  bgItem: 'bg-gray-50 border-gray-200',  textHeader: 'text-gray-600',  icon: '✓'  },
                        { key: 'resolved',          label: 'Resolved / Acknowledged',  bgHeader: 'bg-green-100 border-green-300', bgItem: 'bg-green-50 border-green-200', textHeader: 'text-green-800', icon: '✅' },
                      ].map(group => {
                        const groupWarnings = warnings.filter(w => w.severity === group.key);
                        if (groupWarnings.length === 0) return null;
                        const isExpanded = expandedWarningGroups[group.key] !== false;
                        return (
                          <div key={group.key} className={`border rounded-lg overflow-hidden`}>
                            <button
                              onClick={() => setExpandedWarningGroups(prev => ({...prev, [group.key]: !isExpanded}))}
                              className={`w-full flex items-center justify-between px-4 py-2.5 border-b ${group.bgHeader}`}>
                              <span className={`flex items-center gap-2 text-sm font-semibold ${group.textHeader}`}>
                                <span>{group.icon}</span>
                                {group.label}
                                <span className="bg-white/70 text-xs font-bold px-2 py-0.5 rounded-full">
                                  {groupWarnings.length} check{groupWarnings.length !== 1 ? 's' : ''}
                                </span>
                              </span>
                              {isExpanded
                                ? <ChevronUp className={`w-4 h-4 ${group.textHeader}`}/>
                                : <ChevronDown className={`w-4 h-4 ${group.textHeader}`}/>}
                            </button>
                            {isExpanded && (
                              <div className="divide-y">
                                {groupWarnings.map((w, i) => (
                                  <div key={i} className={`px-4 py-3 ${group.bgItem}`}>
                                    <div className="flex items-start gap-2">
                                      {group.key === 'no_impact' || group.key === 'resolved' || group.key === 'info'
                                        ? <CheckCircle className={`w-4 h-4 mt-0.5 flex-shrink-0 ${
                                            group.key === 'no_impact' ? 'text-gray-400' :
                                            group.key === 'resolved' ? 'text-green-500' : 'text-blue-500'
                                          }`}/>
                                        : <AlertTriangle className={`w-4 h-4 mt-0.5 flex-shrink-0 ${
                                            group.key === 'critical' ? 'text-red-500' :
                                            group.key === 'finalization_only' ? 'text-purple-500' : 'text-yellow-500'
                                          }`}/>
                                      }
                                      <div className="flex-1 min-w-0">
                                        <code className={`text-xs font-mono px-1.5 py-0.5 rounded font-bold ${
                                          group.key === 'critical' ? 'bg-red-100 text-red-700' :
                                          group.key === 'finalization_only' ? 'bg-purple-100 text-purple-700' :
                                          group.key === 'no_impact' ? 'bg-gray-100 text-gray-500' :
                                          group.key === 'info' ? 'bg-blue-100 text-blue-700' :
                                          group.key === 'resolved' ? 'bg-green-100 text-green-700' :
                                          'bg-yellow-100 text-yellow-700'
                                        }`}>{w.code}</code>
                                        <p className={`text-sm mt-1 ${group.textHeader}`}>{w.message}</p>
                                        {w.library_id && (
                                          <div className="mt-1 text-xs text-gray-500 font-mono">
                                            Library ID: {w.library_id} · {w.library_name}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* ── OPTION A: Outputs Snapshot ── */}
                {outputRows.length > 0 && (
                  <div>
                    <h3 className="text-sm font-bold text-gray-800 uppercase tracking-wide mb-3 flex items-center gap-2">
                      <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded text-xs font-bold">Option A</span>
                      Outputs Snapshot ({outputRows.length} payment records)
                    </h3>
                    <div className="border rounded-lg overflow-hidden">
                      <div className="overflow-x-auto max-h-52">
                        <table className="w-full text-xs">
                          <thead className="bg-gray-50 sticky top-0 border-b">
                            <tr>
                              <th className="text-left px-3 py-2 font-semibold text-gray-600">Library</th>
                              <th className="text-left px-3 py-2 font-semibold text-gray-600">Section</th>
                              <th className="text-right px-3 py-2 font-semibold text-gray-600">Watch %</th>
                              <th className="text-right px-3 py-2 font-semibold text-gray-600">Payment (EGP)</th>
                            </tr>
                          </thead>
                          <tbody>
                            {outputRows.map((row, i) => (
                              <tr key={i} className="border-b hover:bg-gray-50">
                                <td className="px-3 py-1.5">
                                  <div className="font-mono text-gray-700 text-xs">{row.library_name || row.library_id}</div>
                                  <div className="text-gray-400 text-xs">ID: {row.library_id}</div>
                                </td>
                                <td className="px-3 py-1.5">
                                  {row.section_code ? (
                                    <span className={`text-xs px-2 py-0.5 rounded font-mono font-bold
                                      ${(row.section_code||'').toUpperCase().includes('GEN')
                                        ? 'bg-green-100 text-green-700'
                                        : 'bg-blue-100 text-blue-700'}`}>
                                      {row.section_code}
                                    </span>
                                  ) : (
                                    <span className="text-gray-400 text-xs">{row.section_name || '—'}</span>
                                  )}
                                </td>
                                <td className="px-3 py-1.5 text-right font-mono">
                                  {((row.watch_time_percentage || 0) * 100).toFixed(2)}%
                                </td>
                                <td className="px-3 py-1.5 text-right font-mono font-bold text-green-700">
                                  {fmtCurrency(row.final_payment)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot>
                            <tr className="bg-gray-50 border-t-2 border-gray-300 font-bold">
                              <td colSpan={3} className="px-3 py-2 text-right text-gray-700 text-xs">Total Payments:</td>
                              <td className="px-3 py-2 text-right font-mono text-green-700">
                                {fmtCurrency(totalPaymentsFromOutputs)}
                              </td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    </div>
                  </div>
                )}

                {/* ── OPTION B: Cross-Validation ── */}
                <div>
                  <h3 className="text-sm font-bold text-gray-800 uppercase tracking-wide mb-3 flex items-center gap-2">
                    <span className="bg-purple-100 text-purple-700 px-2 py-0.5 rounded text-xs font-bold">Option B</span>
                    Cross-Validation
                  </h3>
                  <div className={`rounded-xl border p-5 ${
                    verificationOk
                      ? 'bg-green-50 border-green-200'
                      : 'bg-red-50 border-red-200'
                  }`}>
                    <div className="flex items-start gap-4">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
                        verificationOk ? 'bg-green-200' : 'bg-red-200'
                      }`}>
                        {verificationOk
                          ? <CheckCircle className="w-5 h-5 text-green-700"/>
                          : <XCircle className="w-5 h-5 text-red-700"/>}
                      </div>
                      <div className="flex-1">
                        <div className={`font-bold text-base mb-1 ${
                          verificationOk ? 'text-green-800' : 'text-red-800'
                        }`}>
                          {verificationOk
                            ? 'Independent recalculation matches stored payments'
                            : 'Discrepancy detected between calculation and stored payments'}
                        </div>
                        <p className={`text-sm mb-3 ${
                          verificationOk ? 'text-green-700' : 'text-red-700'
                        }`}>
                          {verificationOk
                            ? 'The system re-derived every payment from raw watch-time data and found no discrepancies. The stored values are verified correct.'
                            : `The re-calculation produced a different sum. Delta: ${fmtCurrency(verificationDelta)} EGP. This may indicate a rounding issue or a bug — do not finalize until resolved.`}
                        </p>
                        <div className="grid grid-cols-3 gap-4">
                          <div className="bg-white/70 rounded-lg px-3 py-2.5 text-center">
                            <div className="text-xs text-gray-500 mb-0.5">Stored Payments Sum</div>
                            <div className="font-mono font-bold text-gray-900">{fmtCurrency(totalPaymentsFromOutputs)}</div>
                          </div>
                          <div className="bg-white/70 rounded-lg px-3 py-2.5 text-center">
                            <div className="text-xs text-gray-500 mb-0.5">Total Revenue Input</div>
                            <div className="font-mono font-bold text-gray-900">{fmtCurrency(totalRevenueFromInputs)}</div>
                          </div>
                          <div className={`rounded-lg px-3 py-2.5 text-center ${
                            verificationOk ? 'bg-green-200/60' : 'bg-red-200/60'
                          }`}>
                            <div className="text-xs text-gray-500 mb-0.5">Verification Delta</div>
                            <div className={`font-mono font-bold ${
                              verificationOk ? 'text-green-700' : 'text-red-700'
                            }`}>
                              {fmtCurrency(verificationDelta)}
                              {verificationOk && <span className="ml-1 text-green-600">✓</span>}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* ── Acknowledge from panel ── */}
                {!audit.acknowledged && warnings.length > 0 && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 flex items-center gap-3">
                    <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0"/>
                    <div className="flex-1 text-sm text-amber-800">
                      Warnings must be acknowledged before finalization is allowed.
                    </div>
                    <Button
                      size="sm"
                      onClick={async () => {
                        await handleAcknowledgeAudit();
                        setAuditDetail(prev => prev ? {...prev, acknowledged: true} : prev);
                      }}
                      disabled={acknowledging}
                      className="bg-amber-600 hover:bg-amber-700 text-white flex-shrink-0">
                      {acknowledging ? 'Saving…' : 'Acknowledge & Unlock Finalization'}
                    </Button>
                  </div>
                )}
                {audit.acknowledged && (
                  <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 flex items-center gap-2 text-sm text-green-700">
                    <CheckCircle className="w-4 h-4 text-green-500"/>
                    <div>
                      <span className="font-semibold">Warnings acknowledged — finalization is unlocked.</span>
                      <div className="text-xs text-green-600 mt-0.5 space-y-0.5">
                        {audit.acknowledged_at && (
                          <div>🕐 {audit.acknowledged_at}</div>
                        )}
                        {audit.acknowledged_by_email && (
                          <div>👤 {audit.acknowledged_by_email}</div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t bg-gray-50 rounded-b-xl flex justify-end">
            <Button variant="outline" onClick={() => { setShowAuditPanel(false); setAuditDetail(null); }}>
              Close
            </Button>
          </div>
        </div>
      </div>
    );
  };
  
  // ─────────────────────────────────────────────────────────────────────────
  // RENDER: Watch time cell with tooltip
  // ─────────────────────────────────────────────────────────────────────────
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

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER: Payments table (library view)
  // ─────────────────────────────────────────────────────────────────────────
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

    const totalFinalPayment  = sorted.reduce((s,p) => s + p.final_payment, 0);
    const totalBeforeTax     = sorted.reduce((s,p) => s + (p.calculated_revenue || 0), 0);
    const totalWatchTimeSecs = sorted.reduce((s,p) => s + (p.total_watch_time_seconds || 0), 0);

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
              <th className={`${thClass} text-right`}>Status</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(payment=>(
              <tr key={payment.id}
                id={`payment-row-${payment.library_id}`}
                className={`border-b transition-colors
                  ${highlightedId === payment.library_id
                    ? 'bg-yellow-100 ring-2 ring-yellow-400'
                    : 'hover:bg-gray-50'}`}>
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
                <td className={`${tdClass} text-right`}>
                  {(() => {
                    // payment.teacher_profile_id is directly on each TeacherPayment row
                    const profileId = String(payment.teacher_profile_id ?? '');
                    const fins = profileId ? (finalizationsMap[profileId] || []) : [];
                    // Match by stage_id + section_id (coerce to string for safety)
                    const fin = fins.find(f =>
                      String(f.stage_id) === String(payment.stage_id) &&
                      String(f.section_id) === String(payment.section_id)
                    );
                    if(!fin) return <span className="text-xs text-gray-400">—</span>;
                    console.log('[status]', payment.library_id, 'profileId:', profileId, 'fins:', fins, 'fin:', fin);
                    return (
                      <div className="space-y-1">
                        <span className="text-xs font-semibold bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">
                          Finalized
                        </span>
                        <div className="text-xs text-green-700 font-mono">
                          {fmtCurrency(fin.transfer_amount)} transferred
                        </div>
                        {fin.carry_forward_out > 0.01 && (
                          <div className="text-xs text-orange-600 font-mono">
                            {fmtCurrency(fin.carry_forward_out)} carry fwd
                          </div>
                        )}
                        <div className="text-xs text-gray-400">
                          {Math.round((fin.transfer_percentage || 0) * 100)}%
                        </div>
                      </div>
                    );
                  })()}
                </td>
              </tr>
            ))}
            <tr className="border-t-2 border-gray-300 bg-gray-100 font-bold">
              <td colSpan={2} className="px-3 py-2 text-right text-sm text-gray-700">Section Total:</td>
              <td className="px-3 py-2 text-right">
                <div className="font-bold text-blue-700 font-mono flex items-center justify-end gap-1">
                  <Clock className="w-3.5 h-3.5 text-blue-500"/>
                  {fmtMinutes(totalWatchTimeSecs)} min
                </div>
              </td>
              <td className="px-3 py-2"/><td className="px-3 py-2"/><td className="px-3 py-2"/>
              <td className="px-3 py-2 text-right">
                <div className="font-bold text-green-700 text-base">{fmtCurrency(totalFinalPayment)}</div>
                <div className="text-xs text-gray-500 font-normal mt-0.5">
                  Before tax: {fmtCurrency(totalBeforeTax)}
                </div>
              </td>
              <td className="px-3 py-2"/>
            </tr>
          </tbody>
        </table>
      </div>
    );
  };

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER: NEW — Teacher view table
  // ─────────────────────────────────────────────────────────────────────────
  const renderTeacherView = (sectionPayments) => {
    const filtered = subjectFilter==='all'
      ? sectionPayments
      : sectionPayments.filter(p=>p.subject_name===subjectFilter);

    if(filtered.length===0) return (
      <div className="text-center py-8 text-gray-500 border rounded-lg bg-gray-50">
        <Users className="w-10 h-10 mx-auto mb-2 text-gray-400"/>
        <div>No payments yet</div>
      </div>
    );

    const grouped = groupPaymentsByTeacher(filtered);
    const sectionTotalWt  = filtered.reduce((s,p)=>s+(p.total_watch_time_seconds||0),0);
    const sectionTotalPay = filtered.reduce((s,p)=>s+p.final_payment,0);

    return (
      <div className="space-y-2">
        {grouped.map(teacher => {
          const key = teacher.teacher_profile_id || teacher.teacher_name;
          const isExpanded = expandedTeachers.has(key);
          const watchPct = sectionTotalWt > 0
            ? ((teacher.total_watch_time_seconds / sectionTotalWt) * 100).toFixed(2)
            : '0.00';

          return (
            <div key={key} className="border rounded-lg overflow-hidden">
              {/* Teacher row */}
              <div
                className="flex items-center justify-between px-4 py-3 bg-white hover:bg-gray-50 cursor-pointer"
                onClick={()=>setExpandedTeachers(prev=>{
                  const s=new Set(prev);
                  s.has(key)?s.delete(key):s.add(key);
                  return s;
                })}>
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center">
                    <Users className="w-4 h-4 text-blue-600"/>
                  </div>
                  <div>
                    <div className="font-semibold text-gray-900">{teacher.teacher_name}</div>
                    {teacher.teacher_code && (
                      <div className="text-xs text-gray-500 font-mono">{teacher.teacher_code}</div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-6 text-sm">
                  <div className="text-right">
                    <div className="text-gray-500 text-xs">Watch Time</div>
                    <div className="font-mono font-semibold text-blue-700">
                      {fmtMinutes(teacher.total_watch_time_seconds)} min
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-gray-500 text-xs">Watch %</div>
                    <div className="font-mono font-semibold text-purple-700">{watchPct}%</div>
                  </div>
                  <div className="text-right">
                    <div className="text-gray-500 text-xs">Payment</div>
                    <div className="font-bold text-green-700">
                      {fmtCurrency(teacher.total_final_payment)} EGP
                    </div>
                  </div>
                  {/* Finalization summary for this teacher */}
                  {(() => {
                    const fins = teacher.teacher_profile_id
                      ? (finalizationsMap[String(teacher.teacher_profile_id)] || [])
                      : [];
                    if(fins.length === 0) return null;
                    const totalTransfer = fins.reduce((s,f) => s + (f.transfer_amount || 0), 0);
                    const totalCarry    = fins.reduce((s,f) => s + (f.carry_forward_out || 0), 0);
                    return (
                      <div className="text-right border-l border-gray-200 pl-4">
                        <div className="flex items-center gap-1 justify-end">
                          <span className="text-xs font-semibold bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">
                            Finalized
                          </span>
                        </div>
                        <div className="text-xs text-green-700 font-mono mt-0.5">
                          {fmtCurrency(totalTransfer)} transferred
                        </div>
                        {totalCarry > 0.01 && (
                          <div className="text-xs text-orange-600 font-mono">
                            {fmtCurrency(totalCarry)} carry fwd
                          </div>
                        )}
                      </div>
                    );
                  })()}
                  <div className="flex items-center gap-1 text-xs text-gray-400">
                    {teacher.payments.length} lib{teacher.payments.length!==1?'s':''}
                    {isExpanded ? <ChevronUp className="w-3.5 h-3.5"/> : <ChevronDown className="w-3.5 h-3.5"/>}
                  </div>
                </div>
              </div>

              {/* Expanded individual libraries */}
              {isExpanded && (
                <div className="border-t bg-gray-50 px-4 py-3">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-gray-500 border-b">
                        <th className="text-left pb-1 font-medium">Library</th>
                        <th className="text-left pb-1 font-medium">Subject</th>
                        <th className="text-right pb-1 font-medium">Watch (min)</th>
                        <th className="text-right pb-1 font-medium">Watch %</th>
                        <th className="text-right pb-1 font-medium">Payment (EGP)</th>
                        <th className="text-right pb-1 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {teacher.payments.map(p=>(
                        <tr key={p.id}
                          id={`payment-row-${p.library_id}`}
                          className={`border-b border-gray-200 transition-colors
                            ${highlightedId === p.library_id ? 'bg-yellow-100' : ''}`}>
                          <td className="py-1.5">
                            <div className="font-medium text-gray-700">{p.library_name}</div>
                            <div className="text-gray-400">ID: {p.library_id}</div>
                          </td>
                          <td className="py-1.5">
                            <span className={`px-1.5 py-0.5 rounded font-semibold
                              ${p.subject_is_common?'bg-purple-100 text-purple-700':'bg-gray-100 text-gray-600'}`}>
                              {p.subject_name}
                            </span>
                          </td>
                          <td className="py-1.5 text-right font-mono">{fmtMinutes(p.total_watch_time_seconds)}</td>
                          <td className="py-1.5 text-right font-mono">{fmtPct(p.watch_time_percentage)}</td>
                          <td className="py-1.5 text-right font-bold text-green-700">{fmtCurrency(p.final_payment)}</td>
                          <td className="py-1.5 text-right">
                            {(() => {
                              const fins = teacher.teacher_profile_id
                                ? (finalizationsMap[String(teacher.teacher_profile_id)] || [])
                                : [];
                              const fin = fins.find(f =>
                                String(f.stage_id) === String(p.stage_id) &&
                                String(f.section_id) === String(p.section_id)
                              );
                              if(!fin) return <span className="text-xs text-gray-300">—</span>;
                              return (
                                <div className="space-y-0.5">
                                  <div className="text-xs font-semibold bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-full text-center">
                                    Finalized
                                  </div>
                                  <div className="text-xs text-green-700 font-mono text-right">
                                    {fmtCurrency(fin.transfer_amount)}
                                  </div>
                                  {fin.carry_forward_out > 0.01 && (
                                    <div className="text-xs text-orange-500 font-mono text-right">
                                      +{fmtCurrency(fin.carry_forward_out)} fwd
                                    </div>
                                  )}
                                </div>
                              );
                            })()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}

        {/* Section total row */}
        <div className="flex items-center justify-between px-4 py-2 bg-gray-100 border rounded-lg font-bold text-sm">
          <span className="text-gray-700">Section Total</span>
          <div className="flex items-center gap-6">
            <span className="font-mono text-blue-700 flex items-center gap-1">
              <Clock className="w-3.5 h-3.5"/>
              {fmtMinutes(sectionTotalWt)} min
            </span>
            <span className="text-green-700">{fmtCurrency(sectionTotalPay)} EGP</span>
          </div>
        </div>
      </div>
    );
  };

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER: Section cards
  // ─────────────────────────────────────────────────────────────────────────
  const renderSections = () => {
    if(!financialData) return null;
    const {sections, teacher_payments} = financialData;

    const paymentsBySection = {};
    sections.forEach(sec=>{
      paymentsBySection[sec.id] = teacher_payments.filter(p=>p.section_id===sec.id);
    });

    // For teacher view: group ALL payments across ALL sections by teacher
    const allFilteredPayments = teacher_payments.filter(p => {
      if(subjectFilter !== 'all' && p.subject_name !== subjectFilter) return false;
      if(sectionFilter !== 'all' && String(p.section_id) !== sectionFilter) return false;
      return true;
    });

    const allTeacherGroups = groupPaymentsByTeacher(allFilteredPayments);

    return (
      <div className="space-y-4">
        {/* Subject filter + view mode toggle bar */}
        {teacher_payments.length>0 && (
          <div className="flex items-center justify-between gap-3 bg-white border rounded-lg px-4 py-3">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-sm font-medium text-gray-600">Filter:</span>
              <select
                value={sectionFilter}
                onChange={e=>setSectionFilter(e.target.value)}
                className="text-sm border rounded px-2 py-1 bg-white">
                <option value="all">All Sections</option>
                {financialData?.sections?.map(s=>(
                  <option key={s.id} value={String(s.id)}>{s.name}</option>
                ))}
              </select>
              <select
                value={subjectFilter}
                onChange={e=>setSubjectFilter(e.target.value)}
                className="text-sm border rounded px-2 py-1 bg-white">
                <option value="all">All Subjects</option>
                {allSubjects.map(s=><option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
              <button
                onClick={()=>setViewMode('library')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all
                  ${viewMode==='library'?'bg-white shadow text-gray-900':'text-gray-500 hover:text-gray-700'}`}>
                <BarChart2 className="w-3.5 h-3.5"/>Library View
              </button>
              <button
                onClick={()=>setViewMode('teacher')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all
                  ${viewMode==='teacher'?'bg-white shadow text-gray-900':'text-gray-500 hover:text-gray-700'}`}>
                <Users className="w-3.5 h-3.5"/>Teacher View
              </button>
            </div>
          </div>
        )}

        {/* ── TEACHER VIEW: unified across all sections ── */}
        {viewMode==='teacher' && teacher_payments.length>0 && (
          <div className="space-y-3">
            {allTeacherGroups.map(teacher => {
              const key = teacher.teacher_profile_id || teacher.teacher_name;
              const isExpanded = expandedTeachers.has(key);

              // Group this teacher's payments by section
              const sectionGroups = {};
              teacher.payments.forEach(p => {
                const secKey = p.section_id;
                if(!sectionGroups[secKey]) sectionGroups[secKey] = {
                  section_name: p.section_name,
                  section_id: p.section_id,
                  payments: [],
                  total_payment: 0,
                  total_watch: 0,
                };
                sectionGroups[secKey].payments.push(p);
                sectionGroups[secKey].total_payment += p.final_payment;
                sectionGroups[secKey].total_watch += (p.total_watch_time_seconds||0);
              });

              const fins = teacher.teacher_profile_id
                ? (finalizationsMap[String(teacher.teacher_profile_id)] || [])
                : [];
              const totalTransfer = fins.reduce((s,f)=>s+(f.transfer_amount||0),0);
              const totalCarry    = fins.reduce((s,f)=>s+(f.carry_forward_out||0),0);

              return (
                <div key={key} className="border rounded-xl overflow-hidden shadow-sm">
                  {/* Teacher header */}
                  <div
                    className="flex items-center justify-between px-4 py-3 bg-white hover:bg-gray-50 cursor-pointer border-b"
                    onClick={()=>setExpandedTeachers(prev=>{
                      const s=new Set(prev);
                      s.has(key)?s.delete(key):s.add(key);
                      return s;
                    })}>
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                        <Users className="w-4 h-4 text-blue-600"/>
                      </div>
                      <div>
                        <div className="font-semibold text-gray-900">{teacher.teacher_name}</div>
                        {teacher.teacher_code && (
                          <div className="text-xs text-gray-500 font-mono">{teacher.teacher_code}</div>
                        )}
                      </div>
                      {/* Section chips */}
                      <div className="flex gap-1.5 ml-2 flex-wrap">
                        {Object.values(sectionGroups).map(sec=>(
                          <span key={sec.section_id}
                            className={`text-xs font-semibold px-2 py-0.5 rounded-full
                              ${(sec.section_name||'').toUpperCase().includes('GEN')
                                ?'bg-green-100 text-green-700'
                                :'bg-blue-100 text-blue-700'}`}>
                            {sec.section_name}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center gap-5 text-sm">
                      <div className="text-right">
                        <div className="text-gray-400 text-xs">Watch</div>
                        <div className="font-mono font-semibold text-blue-700">
                          {fmtMinutes(teacher.total_watch_time_seconds)} min
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-gray-400 text-xs">Payment</div>
                        <div className="font-bold text-green-700">
                          {fmtCurrency(teacher.total_final_payment)} EGP
                        </div>
                      </div>
                      {fins.length > 0 && (
                        <div className="text-right border-l border-gray-200 pl-4">
                          <span className="text-xs font-semibold bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full block mb-0.5">
                            Finalized
                          </span>
                          <div className="text-xs text-green-700 font-mono">{fmtCurrency(totalTransfer)} transferred</div>
                          {totalCarry > 0.01 && (
                            <div className="text-xs text-orange-600 font-mono">{fmtCurrency(totalCarry)} carry fwd</div>
                          )}
                        </div>
                      )}
                      <div className="flex items-center gap-1 text-xs text-gray-400">
                        {teacher.payments.length} lib{teacher.payments.length!==1?'s':''}
                        {isExpanded?<ChevronUp className="w-3.5 h-3.5"/>:<ChevronDown className="w-3.5 h-3.5"/>}
                      </div>
                    </div>
                  </div>

                  {/* Expanded: libraries grouped by section */}
                  {isExpanded && (
                    <div className="bg-gray-50 divide-y">
                      {Object.values(sectionGroups).map(sec=>(
                        <div key={sec.section_id} className="px-4 py-3">
                          {/* Section sub-header */}
                          <div className="flex items-center justify-between mb-2">
                            <span className={`text-xs font-bold px-2 py-0.5 rounded
                              ${(sec.section_name||'').toUpperCase().includes('GEN')
                                ?'bg-green-100 text-green-700'
                                :'bg-blue-100 text-blue-700'}`}>
                              {sec.section_name}
                            </span>
                            <div className="flex items-center gap-4 text-xs text-gray-500">
                              <span className="font-mono flex items-center gap-1">
                                <Clock className="w-3 h-3"/>{fmtMinutes(sec.total_watch)} min
                              </span>
                              <span className="font-bold text-green-700">{fmtCurrency(sec.total_payment)} EGP</span>
                            </div>
                          </div>
                          {/* Libraries table */}
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-gray-400 border-b">
                                <th className="text-left pb-1 font-medium">Library</th>
                                <th className="text-left pb-1 font-medium">Subject</th>
                                <th className="text-right pb-1 font-medium">Watch</th>
                                <th className="text-right pb-1 font-medium">Watch %</th>
                                <th className="text-right pb-1 font-medium">Payment</th>
                                <th className="text-right pb-1 font-medium">Status</th>
                              </tr>
                            </thead>
                            <tbody>
                              {sec.payments.map(p=>(
                                <tr key={p.id}
                                  id={`payment-row-${p.library_id}`}
                                  className={`border-b border-gray-200 transition-colors
                                    ${highlightedId===p.library_id?'bg-yellow-100':''}`}>
                                  <td className="py-1.5">
                                    <div className="font-medium text-gray-700">{p.library_name}</div>
                                    <div className="text-gray-400">ID: {p.library_id}</div>
                                  </td>
                                  <td className="py-1.5">
                                    <span className={`px-1.5 py-0.5 rounded font-semibold
                                      ${p.subject_is_common?'bg-purple-100 text-purple-700':'bg-gray-100 text-gray-600'}`}>
                                      {p.subject_name}
                                      {p.subject_is_common&&<span className="ml-1 opacity-60">(common)</span>}
                                    </span>
                                  </td>
                                  <td className="py-1.5 text-right font-mono">{fmtMinutes(p.total_watch_time_seconds)}</td>
                                  <td className="py-1.5 text-right font-mono">{fmtPct(p.watch_time_percentage)}</td>
                                  <td className="py-1.5 text-right font-bold text-green-700">{fmtCurrency(p.final_payment)}</td>
                                  <td className="py-1.5 text-right">
                                    {(()=>{
                                      const fin = fins.find(f=>
                                        String(f.stage_id)===String(p.stage_id)&&
                                        String(f.section_id)===String(p.section_id)
                                      );
                                      if(!fin) return <span className="text-gray-300">—</span>;
                                      return (
                                        <div>
                                          <div className="text-xs font-semibold bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-full text-center">Finalized</div>
                                          <div className="text-xs text-green-700 font-mono text-right">{fmtCurrency(fin.transfer_amount)}</div>
                                          {fin.carry_forward_out>0.01&&(
                                            <div className="text-xs text-orange-500 font-mono text-right">+{fmtCurrency(fin.carry_forward_out)} fwd</div>
                                          )}
                                        </div>
                                      );
                                    })()}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Grand total */}
            <div className="flex items-center justify-between px-4 py-2.5 bg-gray-100 border rounded-lg font-bold text-sm">
              <span className="text-gray-700">All Teachers Total</span>
              <div className="flex items-center gap-6">
                <span className="font-mono text-blue-700 flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5"/>
                  {fmtMinutes(allFilteredPayments.reduce((s,p)=>s+(p.total_watch_time_seconds||0),0))} min
                </span>
                <span className="text-green-700">
                  {fmtCurrency(allFilteredPayments.reduce((s,p)=>s+p.final_payment,0))} EGP
                </span>
              </div>
            </div>
          </div>
        )}

        {/* ── LIBRARY VIEW: per-section cards ── */}
        {viewMode==='library' && sections.map(section=>{
          const secPayments   = paymentsBySection[section.id]||[];
          const isExpanded    = expandedSections.has(section.id);
          const revCollapsed  = revenueCollapsed[section.id];
          const rev           = sectionRevenues[section.id]||{total_orders:0,total_revenue_egp:0};
          const secTotal      = secPayments.reduce((s,p)=>s+p.final_payment,0);
          const secRevSaved   = financialData.section_revenues.find(r=>r.section_id===section.id);
          const secTotalWatchSecs = secPayments.reduce((s,p)=>s+(p.total_watch_time_seconds||0),0);

          return (
            <Card key={section.id} className="overflow-hidden">
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
                          <span className="text-green-600 font-semibold">{fmtCurrency(secTotal)} EGP payments</span>
                          <span className="text-gray-300">·</span>
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
                  {isExpanded?<ChevronUp className="w-4 h-4 text-gray-400"/>:<ChevronDown className="w-4 h-4 text-gray-400"/>}
                </div>
              </div>

              {isExpanded && (
                <CardContent className="pt-0 space-y-4">
                  <div className="border rounded-lg overflow-hidden">
                    <div
                      className="flex items-center justify-between px-4 py-3 bg-yellow-50 cursor-pointer"
                      onClick={()=>setRevenueCollapsed(prev=>({...prev,[section.id]:!prev[section.id]}))}>
                      <span className="text-sm font-semibold text-yellow-800 flex items-center gap-2">
                        <DollarSign className="w-4 h-4"/>Section Revenue
                      </span>
                      {revCollapsed?<ChevronDown className="w-4 h-4 text-yellow-600"/>:<ChevronUp className="w-4 h-4 text-yellow-600"/>}
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
                  {renderPaymentsTable(secPayments)}
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>
    );
  };

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER: Calculate footer bar
  // ─────────────────────────────────────────────────────────────────────────
const renderCalculateBar = () => {
    if(!financialData) return null;
    const hasPayments = financialData.teacher_payments.length > 0;
    const canFinalize = hasPayments && !isStageWarningLocked && (
      !lastAudit ||
      lastAudit.status === 'passed' ||
      lastAudit.acknowledged
    );

    if (isStageWarningLocked) {
      return (
        <Card className="border-2 border-red-300 bg-red-50">
          <CardContent className="p-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="font-bold text-red-900 flex items-center gap-2">
                  🔒 Stage Locked — Reset Required
                </h3>
                <p className="text-sm text-red-700 mt-0.5">
                  All actions are disabled until you reset this stage.
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={()=>setShowReportModal(true)}
                  className="border-gray-400 text-gray-700 hover:bg-gray-100">
                  <FileText className="w-4 h-4 mr-1"/>Build Report
                </Button>
                <Button
                  onClick={()=>{ setResetConfirmed(false); setShowResetModal(true); }}
                  className="bg-red-600 hover:bg-red-700 text-white font-bold px-6 animate-pulse">
                  <RefreshCw className="w-4 h-4 mr-2"/>Reset Stage to Unlock
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      );
    }

    return (
      <Card className={`border-2 ${revenueChanged?'border-orange-300 bg-orange-50':'border-blue-200 bg-blue-50'}`}>
        <CardContent className="p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h3 className="font-bold text-gray-900">
                {revenueChanged ? '⚠ Revenue updated — recalculate payments' : 'Calculate Payments'}
              </h3>
              <p className="text-sm text-gray-600 mt-0.5">Review libraries → approve/reject → calculate</p>
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
            <div className="flex gap-2 flex-wrap justify-end">
              <Button variant="outline" onClick={()=>setShowReportModal(true)}
                className="border-gray-400 text-gray-700 hover:bg-gray-100">
                <FileText className="w-4 h-4 mr-1"/>Build Report
              </Button>
              {hasPayments && (
                <Button
                  variant="outline"
                  onClick={()=>{ setResetConfirmed(false); setShowResetModal(true); }}
                  className="border-red-300 text-red-600 hover:bg-red-50">
                  <RefreshCw className="w-4 h-4 mr-1"/>Reset Stage
                </Button>
              )}
              {hasPayments && (
                <Button variant="outline"
                  onClick={async ()=>{
                    setShowAuditPanel(true);
                    setAuditDetail(null);
                    setLoadingAuditDetail(true);
                    const freshHistory = await financialApi.getCalculationAudits(
                    selectedPeriod, selectedStage
                    ).catch(()=>[]);
                    setAuditHistory(freshHistory || []);
                    const targetId = freshHistory?.length > 0
                    ? freshHistory[0].id
                    : lastAudit?.id;
                    if(targetId) {
                    await loadAuditDetail(targetId);
                    } else {
                    setLoadingAuditDetail(false);
                    }
                  }}
                  className="border-indigo-400 text-indigo-700 hover:bg-indigo-50">
                  <ShieldCheck className="w-4 h-4 mr-1"/>Audit Trail
                  {auditHistory.length > 0 && (
                    <span className="ml-1.5 bg-indigo-100 text-indigo-700 text-xs rounded-full px-1.5 py-0.5">
                      {auditHistory.length}
                    </span>
                  )}
                </Button>
              )}
              <Button
                onClick={openFinalizationModal}
                disabled={!canFinalize}
                title={!canFinalize ? 'Calculate payments and acknowledge audit first' : ''}
                className={`border font-semibold
                  ${canFinalize
                    ? 'bg-purple-600 hover:bg-purple-700 text-white'
                    : 'bg-gray-200 text-gray-400 cursor-not-allowed border-gray-300'}`}>
                <CheckCircle className="w-4 h-4 mr-1"/>Finalize Payments
              </Button>
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

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER: Library approval modal (unchanged from original)
  // ─────────────────────────────────────────────────────────────────────────
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
              {libraryPreview?.no_analytics_count>0 && (
                <div className="mx-6 mt-4 flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
                  <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0"/>
                  <span className="text-sm text-red-700 font-medium">
                    {libraryPreview.no_analytics_count} libraries have no watch time data for the selected months.
                  </span>
                </div>
              )}
              <div className="px-6 pt-4 flex items-center justify-between flex-wrap gap-3">
                <div className="flex gap-4 text-xs text-gray-500">
                  <span className="flex items-center gap-1"><CheckCircle className="w-3 h-3 text-green-500"/>Approved</span>
                  <span className="flex items-center gap-1"><XCircle className="w-3 h-3 text-red-500"/>Rejected</span>
                  <span className="flex items-center gap-1"><AlertTriangle className="w-3 h-3 text-orange-400"/>No analytics</span>
                </div>
                {someSelected && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500">{selectedModalLibs.size} selected</span>
                    {!selectedAreAllExcluded && (
                      <button onClick={rejectSelected}
                        className="flex items-center gap-1.5 text-xs bg-red-500 hover:bg-red-600 text-white px-3 py-1.5 rounded-lg font-medium">
                        <XCircle className="w-3.5 h-3.5"/>Reject Selected
                      </button>
                    )}
                    {Array.from(selectedModalLibs).some(id=>excludedLibs.has(id)) && (
                      <button onClick={restoreSelected}
                        className="flex items-center gap-1.5 text-xs bg-green-500 hover:bg-green-600 text-white px-3 py-1.5 rounded-lg font-medium">
                        <CheckCircle className="w-3.5 h-3.5"/>Restore Selected
                      </button>
                    )}
                  </div>
                )}
              </div>
              <div className="px-6 py-4 max-h-[55vh] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="px-3 py-2 w-10">
                        <input type="checkbox" checked={allSelected} onChange={toggleSelectAll}
                          className="w-4 h-4 rounded accent-blue-600 cursor-pointer"/>
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
                            ${isChecked?'bg-blue-50':''}
                            ${rejected&&!isChecked?'opacity-50 bg-red-50':''}
                            ${noData&&!rejected&&!isChecked?'bg-orange-50':''}
                            ${!rejected&&!noData&&!isChecked?'hover:bg-gray-50':''}`}>
                          <td className="px-3 py-2">
                            <input type="checkbox" checked={isChecked}
                              onChange={()=>toggleModalSelect(lib.library_id)}
                              className="w-4 h-4 rounded accent-blue-600 cursor-pointer"/>
                          </td>
                          <td className="px-3 py-2">
                            <button onClick={()=>toggleLibraryExclude(lib.library_id)}
                              title={rejected?'Click to restore':'Click to reject'}>
                              {rejected?<XCircle className="w-5 h-5 text-red-500"/>
                                       :<CheckCircle className="w-5 h-5 text-green-500"/>}
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
                              : fmtMinutes(lib.total_watch_time_seconds)}
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
              <div className="px-6 py-4 border-t flex items-center justify-between bg-gray-50 rounded-b-xl">
                <div className="flex items-center gap-4 flex-wrap">
                  <div className="text-sm text-gray-600">
                    <span className="font-semibold text-green-700">{libraries.length - excludedLibs.size} approved</span>
                    {excludedLibs.size>0 &&
                      <span className="text-red-600 ml-3 font-semibold">{excludedLibs.size} rejected</span>}
                  </div>
                  {excludedLibs.size>0 && (
                    <button onClick={()=>{
                        const empty = new Set();
                        setExcludedLibs(empty);
                        persistExcluded(empty);
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

// ─────────────────────────────────────────────────────────────────────────
  // RENDER: NEW — Finalization modal
  // ─────────────────────────────────────────────────────────────────────────
const renderFinalizationModal = () => {
    if(!showFinalizationModal) return null;

    const allRows = finalizationPreview?.rows || [];

    // Derive unique stages and subjects for filter dropdowns
    const finalizeStages   = [...new Map(allRows.map(r => [r.stage_id, { id: r.stage_id, code: r.stage_code, name: r.stage_name }])).values()];
    // Build subjects from subject_name since subject_id may not be present on finalization rows
    const finalizeSubjects = [...new Map(
      allRows
        .filter(r => r.subject_name)
        .map(r => [r.subject_name, { id: r.subject_name, name: r.subject_name }])
    ).values()];

// Apply filters to rows
    const filteredRows = allRows.filter(row => {
      if (finalizeFilterStage   !== 'all' && String(row.stage_id) !== finalizeFilterStage) return false;
      if (finalizeFilterSubject !== 'all' && row.subject_name     !== finalizeFilterSubject) return false;
      return true;
    });
  
    // Group filtered rows by teacher_profile_id
    const groupedByTeacher = {};
    filteredRows.forEach(row => {
      const k = String(row.teacher_profile_id);
      if(!groupedByTeacher[k]) {
        groupedByTeacher[k] = {
          teacher_profile_id: row.teacher_profile_id,
          teacher_code: row.teacher_code,
          teacher_name: row.teacher_name,
          rows: [],
        };
      }
      groupedByTeacher[k].rows.push(row);
    });

    // For each teacher, compute a single merged key for the transfer % input
    // key = teacher_profile_id (since we merge all sections)
    const getMergedRow = (teacherGroup) => {
      const rows = teacherGroup.rows;
      const mergedKey = `merged-${teacherGroup.teacher_profile_id}`;
      const pctStr = finalizationInputs[mergedKey] ?? '100';
      const pct = Math.min(100, Math.max(0, parseFloat(pctStr) || 0)) / 100;
      const totalGross    = rows.reduce((s,r) => s + r.gross_payment, 0);
      const totalCarryIn  = rows.reduce((s,r) => s + r.carry_forward_in, 0);
      const totalDue      = rows.reduce((s,r) => s + r.total_due, 0);
      const transferAmount = totalDue * pct;
      const carryOut      = totalDue - transferAmount;
      return { mergedKey, pct, totalGross, totalCarryIn, totalDue, transferAmount, carryOut };
    };

    // Sections info chips for a teacher (unique stage+section+subject combos)
    const getSectionChips = (rows) => {
      return rows.map(r => ({
        stage: r.stage_code,
        section: r.section_code,
        subject: r.subject_name,
        amount: r.gross_payment,
      }));
    };

    const anyCarryOut = Object.values(groupedByTeacher).some(tg => getMergedRow(tg).carryOut > 0.01);

    // Section breakdown tooltip content
    const SectionBreakdownTooltip = ({ rows }) => (
      <div className="min-w-[280px] space-y-2 p-1">
        {rows.map((r, i) => (
          <div key={i} className="text-xs border-b border-gray-700 pb-1.5 last:border-0 last:pb-0">
            <div className="font-semibold text-gray-200 mb-1">
              {r.stage_code} · {r.section_code}
              {r.subject_name && <span className="text-purple-300 ml-1">({r.subject_name})</span>}
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
              <span className="text-gray-400">Gross</span>
              <span className="font-mono text-right text-white">{fmtCurrency(r.gross_payment)}</span>
              {r.carry_forward_in > 0 && <>
                <span className="text-gray-400">Carry In</span>
                <span className="font-mono text-right text-orange-300">{fmtCurrency(r.carry_forward_in)}</span>
              </>}
              <span className="text-gray-400">Total Due</span>
              <span className="font-mono text-right text-blue-300">{fmtCurrency(r.total_due)}</span>
            </div>
          </div>
        ))}
      </div>
    );

    return (
      <div className="fixed inset-0 bg-black/60 z-50 flex items-start justify-center p-6 overflow-y-auto">
        <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl my-4">

          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b bg-gray-50 rounded-t-xl">
            <div>
              <h2 className="text-xl font-bold text-gray-900">Finalize Payments</h2>
              <p className="text-sm text-gray-500 mt-0.5">
                Period: <strong>{finalizationPreview?.period_name}</strong>
              </p>
            </div>
            <button onClick={()=>setShowFinalizationModal(false)}
              className="text-gray-400 hover:text-gray-600 text-2xl font-bold leading-none">×</button>
          </div>

          {loadingFinalization ? (
            <div className="p-12 text-center text-gray-500">Loading finalization data…</div>
          ) : (
            <>
              {/* ── Filter bar — outside scroll container so dropdowns are never clipped ── */}
              <div className="px-6 py-3 border-b bg-white flex items-center gap-4 flex-wrap">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Filter:</span>
                <div className="flex items-center gap-2">
                  <label className="text-xs text-gray-500">Stage</label>
                  <select
                    value={finalizeFilterStage}
                    onChange={e => setFinalizeFilterStage(e.target.value)}
                    className="text-sm border rounded px-2 py-1.5 bg-white min-w-[130px]">
                    <option value="all">All Stages</option>
                    {finalizeStages.map(s=>(
                      <option key={s.id} value={String(s.id)}>{s.name} ({s.code})</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-xs text-gray-500">Subject</label>
                  <select
                    value={finalizeFilterSubject}
                    onChange={e => setFinalizeFilterSubject(e.target.value)}
                    className="text-sm border rounded px-2 py-1.5 bg-white min-w-[130px]">
                    <option value="all">All Subjects</option>
                    {finalizeSubjects.map(s=>(
                      <option key={s.id} value={s.name}>{s.name}</option>
                    ))}
                  </select>
                </div>
                <span className="ml-auto text-xs text-gray-400">
                  {Object.keys(groupedByTeacher).length} teacher{Object.keys(groupedByTeacher).length!==1?'s':''}
                  {' · '}{filteredRows.length} section-row{filteredRows.length!==1?'s':''}
                </span>
              </div>

              {/* ── Scrollable content ── */}
              <div className="px-6 py-4 overflow-y-auto space-y-3" style={{maxHeight:'60vh'}}>

                {/* Warning: no next period */}
                {anyCarryOut && !finalizationPreview?.next_period_exists && (
                  <div className="flex items-start gap-3 bg-amber-50 border border-amber-300 rounded-lg px-4 py-3">
                    <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5"/>
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-amber-800">
                        No next period found — carry-forward amounts will be stored without a destination period.
                      </p>
                      <div className="flex gap-2 mt-2">
                        <button onClick={()=>setShowCreatePeriodInline(!showCreatePeriodInline)}
                          className="text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white px-3 py-1.5 rounded">
                          {showCreatePeriodInline ? 'Hide Form' : 'Create Period Now'}
                        </button>
                      </div>
                      {showCreatePeriodInline && (
                        <form onSubmit={handleCreatePeriod} className="mt-3 border rounded-lg p-3 bg-white space-y-3">
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="text-xs font-medium text-gray-600">Period Name *</label>
                              <Input placeholder="Q2 2025" value={newPeriod.name}
                                onChange={e=>setNewPeriod({...newPeriod,name:e.target.value})} required/>
                            </div>
                            <div>
                              <label className="text-xs font-medium text-gray-600">Year *</label>
                              <Input type="number" value={newPeriod.year}
                                onChange={e=>setNewPeriod({...newPeriod,year:parseInt(e.target.value)})} required/>
                            </div>
                          </div>
                          <div className="grid grid-cols-6 gap-1">
                            {MONTHS.map(m=>{
                              const key=`${newPeriod.year}-${m.value}`;
                              const sel=newPeriod.months.includes(key);
                              return (
                                <button type="button" key={m.value} onClick={()=>toggleMonth(key)}
                                  className={`text-xs py-1.5 rounded border transition-all
                                    ${sel?'bg-blue-600 text-white border-blue-600':'bg-white text-gray-600 border-gray-300'}`}>
                                  {m.label.slice(0,3)}
                                </button>
                              );
                            })}
                          </div>
                          <div className="flex gap-2">
                            <Button type="submit" className="bg-green-600 hover:bg-green-700 text-xs h-8">Create Period</Button>
                            <Button type="button" variant="outline" onClick={()=>setShowCreatePeriodInline(false)} className="text-xs h-8">Cancel</Button>
                          </div>
                        </form>
                      )}
                    </div>
                  </div>
                )}

                {/* ── Teacher rows ── */}
                {Object.values(groupedByTeacher).map(teacherGroup => {
                  const isCollapsed = collapsedFinalizeTeachers.has(String(teacherGroup.teacher_profile_id));
                  const { mergedKey, pct, totalGross, totalCarryIn, totalDue, transferAmount, carryOut } = getMergedRow(teacherGroup);
                  const chips = getSectionChips(teacherGroup.rows);

                  return (
                    <div key={teacherGroup.teacher_profile_id} className="border rounded-xl overflow-visible shadow-sm">

                      {/* ── Teacher header — collapsible ── */}
                      <div
                        className="px-4 py-3 bg-slate-700 text-white flex items-center justify-between cursor-pointer hover:bg-slate-600 transition-colors rounded-t-xl"
                        onClick={()=>setCollapsedFinalizeTeachers(prev=>{
                          const s=new Set(prev);
                          const k=String(teacherGroup.teacher_profile_id);
                          s.has(k)?s.delete(k):s.add(k);
                          return s;
                        })}>
                        <div className="flex items-center gap-2">
                          {isCollapsed
                            ? <ChevronDown className="w-4 h-4 text-slate-400"/>
                            : <ChevronUp className="w-4 h-4 text-slate-400"/>}
                          <Users className="w-4 h-4"/>
                          <span className="font-semibold">{teacherGroup.teacher_name}</span>
                          <span className="text-slate-300 font-mono text-sm">({teacherGroup.teacher_code})</span>
                        </div>
                        <div className="flex items-center gap-5 text-sm">
                          <div className="text-right">
                            <div className="text-slate-400 text-xs">Gross</div>
                            <div className="font-mono font-semibold">{fmtCurrency(totalGross)}</div>
                          </div>
                          {totalCarryIn > 0 && (
                            <div className="text-right">
                              <div className="text-slate-400 text-xs">Carry In</div>
                              <div className="font-mono font-semibold text-orange-300">{fmtCurrency(totalCarryIn)}</div>
                            </div>
                          )}
                          {/* Total Due with tooltip — renders downward to avoid header clipping */}
                          <div className="text-right relative group">
                            <div className="text-slate-400 text-xs">Total Due ⓘ</div>
                            <div className="font-mono font-bold text-blue-300 underline decoration-dotted cursor-help">{fmtCurrency(totalDue)}</div>
                            <div className="absolute top-full right-0 mt-2 hidden group-hover:block z-[9999] pointer-events-none">
                              <div className="bg-gray-900 text-white rounded-xl px-4 py-3 shadow-2xl border border-gray-700 whitespace-nowrap">
                                <div className="absolute bottom-full right-4 border-8 border-transparent border-b-gray-900"/>
                                <SectionBreakdownTooltip rows={teacherGroup.rows}/>
                              </div>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-slate-400 text-xs">Transfer</div>
                            <div className="font-mono font-bold text-green-300">{fmtCurrency(transferAmount)}</div>
                          </div>
                          {carryOut > 0.01 && (
                            <div className="text-right">
                              <div className="text-slate-400 text-xs">Carry Out</div>
                              <div className="font-mono font-semibold text-orange-300">{fmtCurrency(carryOut)}</div>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* ── Expanded body: section info chips + single transfer % ── */}
                      {!isCollapsed && (
                        <div className="bg-white px-4 py-4 rounded-b-xl space-y-4">

                          {/* Section info chips row */}
                          <div className="flex flex-wrap gap-2">
                            {chips.map((chip, i) => (
                              <div key={i} className="flex items-center gap-1.5 bg-slate-100 border border-slate-200 rounded-lg px-3 py-1.5 text-xs">
                                <span className="font-mono font-bold text-blue-700">{chip.stage}</span>
                                <span className="text-gray-400">·</span>
                                <span className={`font-semibold px-1.5 py-0.5 rounded
                                  ${chip.section.toUpperCase().includes('GEN') ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
                                  {chip.section}
                                </span>
                                {chip.subject && (
                                  <>
                                    <span className="text-gray-400">·</span>
                                    <span className="bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded font-medium">{chip.subject}</span>
                                  </>
                                )}
                                <span className="text-gray-500 ml-1">{fmtCurrency(chip.amount)}</span>
                              </div>
                            ))}
                          </div>

                          {/* Single transfer % + computed fields */}
                          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 items-end bg-gray-50 border rounded-lg px-4 py-3">
                            <div>
                              <div className="text-xs text-gray-500 mb-1">Total Gross</div>
                              <div className="font-bold text-gray-800">{fmtCurrency(totalGross)} EGP</div>
                            </div>
                            {totalCarryIn > 0 && (
                              <div>
                                <div className="text-xs text-gray-500 mb-1">Carry Forward In</div>
                                <div className="font-semibold text-orange-600">{fmtCurrency(totalCarryIn)} EGP</div>
                              </div>
                            )}
                            <div>
                              <div className="text-xs text-gray-500 mb-1">Total Due</div>
                              <div className="font-bold text-blue-700">{fmtCurrency(totalDue)} EGP</div>
                            </div>
                            <div>
                              <div className="text-xs text-gray-500 mb-1">Transfer %</div>
                              <div className="flex items-center gap-1">
                                <input
                                  type="number" min="0" max="100"
                                  value={finalizationInputs[mergedKey] ?? '100'}
                                  onChange={e => setFinalizationInputs(prev=>({...prev,[mergedKey]:e.target.value}))}
                                  className="w-16 border rounded px-2 py-1.5 text-center text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-400"
                                  onClick={e => e.stopPropagation()}
                                />
                                <span className="text-gray-500">%</span>
                              </div>
                            </div>
                            <div>
                              <div className="text-xs text-gray-500 mb-1">Transfer Amount</div>
                              <div className="font-bold text-green-700">{fmtCurrency(transferAmount)} EGP</div>
                            </div>
                            {carryOut > 0.01 && (
                              <div>
                                <div className="text-xs text-gray-500 mb-1">Carry Forward Out</div>
                                <div className="font-semibold text-orange-600">
                                  {fmtCurrency(carryOut)} EGP
                                  {finalizationPreview?.next_period_name && (
                                    <div className="text-xs text-gray-400 font-normal">→ {finalizationPreview.next_period_name}</div>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}

                {filteredRows.length === 0 && (
                  <div className="text-center py-12 text-gray-500">
                    <CheckCircle className="w-12 h-12 mx-auto mb-3 text-gray-300"/>
                    <div>{allRows.length === 0
                      ? 'No teacher payments found. Calculate payments first.'
                      : 'No results match the current filters.'}</div>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="px-6 py-4 border-t bg-gray-50 rounded-b-xl flex items-center justify-between">
                <Button variant="outline" onClick={()=>setShowFinalizationModal(false)}>Cancel</Button>
                <Button
                  onClick={handleSubmitFinalization}
                  disabled={submittingFinalization || allRows.length === 0}
                  className="bg-purple-600 hover:bg-purple-700 text-white font-semibold px-6">
                  {submittingFinalization
                    ? 'Saving…'
                    : `Finalize ${Object.keys(groupedByTeacher).length} Teacher${Object.keys(groupedByTeacher).length!==1?'s':''}`}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  };
  
  // ─────────────────────────────────────────────────────────────────────────
  // RENDER: NEW — Report builder modal
  // ─────────────────────────────────────────────────────────────────────────
  const renderReportModal = () => {
    if(!showReportModal) return null;

    const toggleColumn = (key) => {
      setReportConfig(prev => {
        const cols = prev.columns.includes(key)
          ? prev.columns.filter(c=>c!==key)
          : [...prev.columns, key];
        return {...prev, columns: cols};
      });
    };

    const togglePeriod = (id) => setReportConfig(prev => ({
      ...prev,
      period_ids: prev.period_ids.includes(id)
        ? prev.period_ids.filter(p=>p!==id)
        : [...prev.period_ids, id]
    }));

    const toggleStage = (id) => setReportConfig(prev => ({
      ...prev,
      stage_ids: prev.stage_ids.includes(id)
        ? prev.stage_ids.filter(s=>s!==id)
        : [...prev.stage_ids, id]
    }));

    const toggleTeacher = (id) => setReportConfig(prev => ({
      ...prev,
      teacher_profile_ids: prev.teacher_profile_ids.includes(id)
        ? prev.teacher_profile_ids.filter(t=>t!==id)
        : [...prev.teacher_profile_ids, id]
    }));

    const visibleCols = reportData
      ? reportData.columns.filter(c=>c.visible)
      : [];

    const REPORT_TYPES = [
      { value: 'teacher',        label: 'Teacher Report',      desc: 'Focus on one or more specific teachers' },
      { value: 'period_summary', label: 'Period Summary',      desc: 'All teachers in selected periods' },
      { value: 'comparison',     label: 'Comparison Report',   desc: 'Teacher vs teacher, stage vs stage' },
      { value: 'carry_forward',  label: 'Carry Forward Report',desc: 'Outstanding balances' },
    ];

    const GROUP_OPTIONS = ['teacher','stage','section','subject','period'];
    const SORT_OPTIONS  = ['final_payment','watch_time_minutes','watch_time_percentage','teacher_name','stage_code'];

    return (
      <div className="fixed inset-0 bg-black/60 z-50 flex items-start justify-center p-6 overflow-y-auto">
        <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl my-4">
          {/* Modal header */}
          <div className="flex items-center justify-between px-6 py-4 border-b bg-gray-50 rounded-t-xl">
            <div>
              <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                <FileText className="w-5 h-5 text-blue-600"/>Report Builder
              </h2>
              <p className="text-sm text-gray-500 mt-0.5">Build and export custom financial reports</p>
            </div>
            <button onClick={()=>{ setShowReportModal(false); setReportStep(1); setReportData(null); }}
              className="text-gray-400 hover:text-gray-600 text-2xl font-bold leading-none">×</button>
          </div>

          {/* Step indicator */}
          <div className="px-6 pt-4 flex items-center gap-2 text-sm">
            {['Type','Scope','Columns','Grouping','Preview'].map((s,i)=>(
              <React.Fragment key={i}>
                <button
                  onClick={()=>setReportStep(i+1)}
                  className={`flex items-center gap-1.5 px-2 py-1 rounded font-medium transition-all
                    ${reportStep===i+1
                      ?'bg-blue-600 text-white'
                      :reportStep>i+1
                        ?'bg-blue-100 text-blue-700'
                        :'text-gray-400'}`}>
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold
                    ${reportStep===i+1?'bg-white text-blue-600':reportStep>i+1?'bg-blue-600 text-white':'bg-gray-200 text-gray-500'}`}>
                    {reportStep>i+1?'✓':i+1}
                  </span>
                  {s}
                </button>
                {i<4 && <ChevronRight className="w-3.5 h-3.5 text-gray-300"/>}
              </React.Fragment>
            ))}
          </div>

          <div className="px-6 py-4 max-h-[65vh] overflow-y-auto">

            {/* STEP 1 — Report type */}
            {reportStep===1 && (
              <div className="space-y-3">
                <h3 className="font-semibold text-gray-800">Select Report Type</h3>
                {REPORT_TYPES.map(t=>(
                  <label key={t.value}
                    className={`flex items-start gap-3 p-4 border rounded-lg cursor-pointer transition-all
                      ${reportConfig.report_type===t.value?'border-blue-400 bg-blue-50':'border-gray-200 hover:border-gray-300'}`}>
                    <input type="radio" name="report_type" value={t.value}
                      checked={reportConfig.report_type===t.value}
                      onChange={()=>setReportConfig(prev=>({...prev,report_type:t.value}))}
                      className="mt-1 accent-blue-600"/>
                    <div>
                      <div className="font-semibold text-gray-900">{t.label}</div>
                      <div className="text-sm text-gray-500">{t.desc}</div>
                    </div>
                  </label>
                ))}
              </div>
            )}

            {/* STEP 2 — Scope */}
            {reportStep===2 && (
              <div className="space-y-5">
                <div>
                  <h3 className="font-semibold text-gray-800 mb-2">Select Periods</h3>
                  <div className="flex flex-wrap gap-2">
                    {periods.map(p=>(
                      <button key={p.id} onClick={()=>togglePeriod(p.id)}
                        className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-all
                          ${reportConfig.period_ids.includes(p.id)
                            ?'bg-blue-600 text-white border-blue-600'
                            :'bg-white text-gray-700 border-gray-300 hover:border-blue-400'}`}>
                        {p.name}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <h3 className="font-semibold text-gray-800 mb-2">Select Stages</h3>
                  <div className="flex flex-wrap gap-2">
                    {stages.map(s=>(
                      <button key={s.id} onClick={()=>toggleStage(s.id)}
                        className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-all
                          ${reportConfig.stage_ids.includes(s.id)
                            ?'bg-blue-600 text-white border-blue-600'
                            :'bg-white text-gray-700 border-gray-300 hover:border-blue-400'}`}>
                        {s.code}
                      </button>
                    ))}
                  </div>
                </div>
                {reportConfig.report_type==='teacher' && (
                  <div>
                    <h3 className="font-semibold text-gray-800 mb-2">Select Teachers</h3>
                    <div className="max-h-48 overflow-y-auto border rounded-lg divide-y">
                      {teacherProfiles.map(t=>(
                        <label key={t.id} className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50 cursor-pointer">
                          <input type="checkbox"
                            checked={reportConfig.teacher_profile_ids.includes(t.id)}
                            onChange={()=>toggleTeacher(t.id)}
                            className="w-4 h-4 accent-blue-600"/>
                          <span className="text-sm text-gray-700">{t.name}</span>
                          <span className="text-xs text-gray-400 font-mono">{t.code}</span>
                        </label>
                      ))}
                      {teacherProfiles.length===0 && (
                        <div className="px-3 py-4 text-center text-gray-500 text-sm">
                          No teacher profiles found. Run Auto-Link in Settings first.
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* STEP 3 — Columns */}
            {reportStep===3 && (
              <div className="space-y-4">
                <h3 className="font-semibold text-gray-800">Select Columns</h3>
                {Object.entries(REPORT_COLUMNS).map(([groupKey, group])=>(
                  <div key={groupKey} className="border rounded-lg overflow-hidden">
                    <div className="px-4 py-2 bg-gray-50 font-semibold text-sm text-gray-700 border-b">
                      {group.label}
                    </div>
                    <div className="px-4 py-3 grid grid-cols-2 md:grid-cols-3 gap-2">
                      {group.cols.map(col=>(
                        <label key={col.key} className="flex items-center gap-2 cursor-pointer">
                          <input type="checkbox"
                            checked={reportConfig.columns.includes(col.key)}
                            onChange={()=>toggleColumn(col.key)}
                            className="w-4 h-4 accent-blue-600"/>
                          <span className="text-sm text-gray-700">{col.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* STEP 4 — Grouping */}
            {reportStep===4 && (
              <div className="space-y-5">
                <div>
                  <h3 className="font-semibold text-gray-800 mb-2">Group By</h3>
                  <div className="flex flex-wrap gap-2">
                    {GROUP_OPTIONS.map(opt=>(
                      <button key={opt} onClick={()=>setReportConfig(prev=>({...prev,group_by:opt}))}
                        className={`px-3 py-1.5 rounded-lg text-sm font-medium border capitalize transition-all
                          ${reportConfig.group_by===opt
                            ?'bg-blue-600 text-white border-blue-600'
                            :'bg-white text-gray-700 border-gray-300 hover:border-blue-400'}`}>
                        {opt}
                      </button>
                    ))}
                    <button onClick={()=>setReportConfig(prev=>({...prev,group_by:null}))}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-all
                        ${!reportConfig.group_by
                          ?'bg-gray-700 text-white border-gray-700'
                          :'bg-white text-gray-700 border-gray-300 hover:border-gray-400'}`}>
                      No Grouping
                    </button>
                  </div>
                </div>
                <div>
                  <h3 className="font-semibold text-gray-800 mb-2">Sort By</h3>
                  <div className="flex flex-wrap gap-2">
                    {SORT_OPTIONS.map(opt=>(
                      <button key={opt} onClick={()=>setReportConfig(prev=>({...prev,sort_by:opt}))}
                        className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-all
                          ${reportConfig.sort_by===opt
                            ?'bg-blue-600 text-white border-blue-600'
                            :'bg-white text-gray-700 border-gray-300 hover:border-blue-400'}`}>
                        {opt.replace(/_/g,' ')}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" className="w-4 h-4 accent-blue-600"
                      checked={reportConfig.show_subtotals}
                      onChange={e=>setReportConfig(prev=>({...prev,show_subtotals:e.target.checked}))}/>
                    <span className="text-sm text-gray-700">Show subtotals per group</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" className="w-4 h-4 accent-blue-600"
                      checked={reportConfig.show_grand_total}
                      onChange={e=>setReportConfig(prev=>({...prev,show_grand_total:e.target.checked}))}/>
                    <span className="text-sm text-gray-700">Show grand total</span>
                  </label>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-600">Sort direction:</span>
                    <select value={reportConfig.sort_direction}
                      onChange={e=>setReportConfig(prev=>({...prev,sort_direction:e.target.value}))}
                      className="text-sm border rounded px-2 py-1">
                      <option value="desc">Descending</option>
                      <option value="asc">Ascending</option>
                    </select>
                  </div>
                </div>
              </div>
            )}

            {/* STEP 5 — Preview & Export */}
            {reportStep===5 && (
              <div className="space-y-4">
                {!reportData ? (
                  <div className="text-center py-8 text-gray-500">
                    <p>Click "Generate Report" to preview data.</p>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between">
                      <div className="text-sm text-gray-600">
                        <strong>{reportData.total_rows}</strong> data rows ·
                        Generated at {new Date(reportData.generated_at).toLocaleTimeString()}
                      </div>
                      <Button onClick={handleExportExcel}
                        className="bg-green-600 hover:bg-green-700 text-white flex items-center gap-2">
                        <FileDown className="w-4 h-4"/>Export Excel
                      </Button>
                    </div>
                    <div className="overflow-x-auto rounded-lg border max-h-96">
                      <table className="w-full text-xs">
                        <thead className="bg-gray-50 sticky top-0">
                          <tr>
                            {visibleCols.map(col=>(
                              <th key={col.key} className="px-3 py-2 text-left font-semibold text-gray-600 whitespace-nowrap border-b">
                                {col.label}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {reportData.rows.map((row, i)=>{
                            const isSubtotal = row.row_type==='subtotal';
                            const isGrand    = row.row_type==='grand_total';
                            const isComp     = row.row_type==='comparative';
                            return (
                              <tr key={i}
                                className={`border-b
                                  ${isGrand?'bg-green-50 font-bold':''}
                                  ${isSubtotal?'bg-blue-50 font-semibold':''}
                                  ${isComp?'bg-purple-50 italic':''}
                                  ${!isSubtotal&&!isGrand&&!isComp?'hover:bg-gray-50':''}`}>
                                {visibleCols.map(col=>(
                                  <td key={col.key} className="px-3 py-2 whitespace-nowrap">
                                    {(isSubtotal||isGrand) && col.key==='teacher_name'
                                      ? <span className="text-gray-600">{row.group_label}</span>
                                      : row.data[col.key] !== undefined && row.data[col.key] !== null
                                        ? typeof row.data[col.key]==='number'
                                          ? fmtCurrency(row.data[col.key])
                                          : row.data[col.key]
                                        : ''
                                    }
                                  </td>
                                ))}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Modal footer */}
          <div className="px-6 py-4 border-t bg-gray-50 rounded-b-xl flex items-center justify-between">
            <div className="flex gap-2">
              {reportStep > 1 && (
                <Button variant="outline" onClick={()=>setReportStep(reportStep-1)}>← Back</Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={()=>{ setShowReportModal(false); setReportStep(1); setReportData(null); }}>
                Close
              </Button>
              {reportStep < 5 && (
                <Button onClick={()=>setReportStep(reportStep+1)}
                  className="bg-blue-600 hover:bg-blue-700 text-white">
                  Next →
                </Button>
              )}
              {reportStep === 4 && (
                <Button onClick={handleGenerateReport} disabled={generatingReport}
                  className="bg-blue-600 hover:bg-blue-700 text-white">
                  {generatingReport ? 'Generating…' : 'Generate Report →'}
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  // ─────────────────────────────────────────────────────────────────────────
  // MAIN RENDER
  // ─────────────────────────────────────────────────────────────────────────
  if(loading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-lg text-gray-600">Loading financials…</div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      {renderLibraryModal()}
      {renderFinalizationModal()}
      {renderReportModal()}
      {renderAuditPanel()}
      {renderResetModal()}
      <div className="max-w-7xl mx-auto space-y-5">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
            <DollarSign className="w-8 h-8 text-green-600"/>Financial Management
          </h1>
          <p className="text-gray-500 mt-1">Manage periods, revenues, and calculate teacher payments</p>
        </div>

        {message.text && (
          <Alert className={message.type==='error'?'bg-red-50 border-red-200':'bg-green-50 border-green-200'}>
            <AlertDescription className={message.type==='error'?'text-red-800':'text-green-800'}>
              {message.text}
            </AlertDescription>
          </Alert>
        )}

        {renderPeriods()}
        {renderStages()}

        {/* ── Global Search Bar ── */}
        {financialData && (
          <div className="relative" ref={searchRef}>
            <div className="flex items-center gap-2 bg-white border-2 border-gray-200 rounded-xl px-4 py-2.5 shadow-sm focus-within:border-blue-400 transition-colors">
              <RefreshCw className="w-4 h-4 text-gray-400 flex-shrink-0" style={{transform:'none'}}/>
              <input
                type="text"
                placeholder="Search teacher name, P-code, or library…"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onFocus={() => searchResults.length > 0 && setShowSearchResults(true)}
                className="flex-1 text-sm outline-none bg-transparent placeholder-gray-400"
              />
              {searchQuery && (
                <button onClick={() => { setSearchQuery(''); setShowSearchResults(false); }}
                  className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
              )}
            </div>
            {showSearchResults && searchResults.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-white border rounded-xl shadow-xl z-40 overflow-hidden">
                {searchResults.map((r, i) => (
                  <button key={i} onClick={() => scrollToResult(r)}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-blue-50 text-left border-b last:border-0 transition-colors">
                    <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                      <Users className="w-4 h-4 text-blue-600"/>
                    </div>
                    <div>
                      <div className="font-medium text-gray-900 text-sm">{r.label}</div>
                      <div className="text-xs text-gray-400">{r.sublabel}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {financialData && (
          <>
            {renderSummary()}
            {renderSubjectChangeWarningBanner()}
            {/* Audit banner appears between summary and section cards */}
            {!isStageWarningLocked && renderAuditBanner()}
            {!isStageWarningLocked && renderSections()}
            {renderCalculateBar()}
          </>
        )}
      </div>
    </div>
  );
};

export default Financials;
