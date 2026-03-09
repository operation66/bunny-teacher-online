import React, { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import api from '../services/api';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { Alert, AlertDescription } from '../components/ui/alert';
import { 
  RefreshCw, 
  Save, 
  Key, 
  Database,
  CheckCircle,
  XCircle,
  Eye,
  EyeOff,
  Search,
  ChevronDown,
  ChevronRight,
  AlertCircle,
  Loader,
  Trash2
} from 'lucide-react';

// ─── Module-level cache (survives page navigation, clears on full refresh) ────
const _configCache = {
  data: null,
  fetchedAt: null,
  ttlMs: 10 * 60 * 1000, // 10 minutes
  get() {
    if (!this.data || !this.fetchedAt) return null;
    if (Date.now() - this.fetchedAt > this.ttlMs) return null;
    return this.data;
  },
  set(data) { this.data = data; this.fetchedAt = Date.now(); },
  clear() { this.data = null; this.fetchedAt = null; },
};

const LibraryConfig = () => {
  const [configs, setConfigs] = useState([]);
  const [filteredConfigs, setFilteredConfigs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false); // separate indicator for background sync
  const [saving, setSaving] = useState({});
  const [message, setMessage] = useState({ type: '', text: '' });
  const [showApiKeys, setShowApiKeys] = useState({});
  const [searchTerm, setSearchTerm] = useState('');
  const [pendingChanges, setPendingChanges] = useState({});
  const [expandedId, setExpandedId] = useState(null);
  const [activeOnly, setActiveOnly] = useState(false);
  const [inactiveOnly, setInactiveOnly] = useState(false);  
  const [selectedIds, setSelectedIds] = useState(new Set());
  const scrollRef = useRef(null);
  const [atTop, setAtTop] = useState(true);
  const [atBottom, setAtBottom] = useState(false);
  const syncDoneRef = useRef(false); // only sync-from-bunny once per session
  
  const [showExcelModal, setShowExcelModal] = useState(false);
  const [excelProgress, setExcelProgress] = useState({
    isProcessing: false, totalRows: 0, processedRows: 0,
    successCount: 0, failCount: 0, failedRows: [], isComplete: false
  });

  const [showClearConfirmation, setShowClearConfirmation] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearMode, setClearMode] = useState('all');

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    setAtTop(el.scrollTop <= 0);
    setAtBottom(el.scrollTop >= el.scrollHeight - el.clientHeight - 1);
  };

  // ─── Filter effect (pure client-side, no fetch) ───────────────────────────
  useEffect(() => {
    let filtered = configs.filter(config =>
      config.library_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      config.library_id.toString().includes(searchTerm)
    );
    if (activeOnly) filtered = filtered.filter(cfg => isConfigured(cfg));
    if (inactiveOnly) filtered = filtered.filter(cfg => !isConfigured(cfg));
    setFilteredConfigs(filtered);
  }, [configs, searchTerm, activeOnly, inactiveOnly]);

  // ─── On mount: load from cache first, then optionally sync ───────────────
  useEffect(() => {
    loadConfigs(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Core loader — forceSync = true only when user clicks Refresh ─────────
  const loadConfigs = async (forceSync = false) => {
    // If we have cached data and not forcing, show it immediately
    const cached = _configCache.get();
    if (cached && !forceSync) {
      console.log(`[ConfigCache] HIT — ${cached.length} configs from cache`);
      setConfigs(cached);
      setLoading(false);
      setMessage({ type: 'success', text: `Loaded ${cached.length} library configurations` });
      return;
    }

    // No cache or forced — show loading
    console.log(`[ConfigCache] ${forceSync ? 'FORCE RELOAD' : 'MISS'} — fetching from backend`);
    setLoading(true);
    setMessage({ type: '', text: '' });

    try {
      // Phase 1: Get configs quickly (no Bunny API call)
      const { data: rawConfigs } = await api.get('/library-configs/');

      // Get live library IDs from backend cache (fast — served from bunny_service cache)
      let liveIds = [];
      try {
        const { data: liveData } = await api.get('/bunny-libraries/');
        liveIds = (Array.isArray(liveData) ? liveData : []).map(l => l.id ?? l.library_id).filter(id => id != null);
      } catch (_) {}

      const filtered = liveIds.length > 0
        ? rawConfigs.filter(cfg => liveIds.includes(cfg.library_id))
        : rawConfigs;

      _configCache.set(filtered);
      setConfigs(filtered);
      setLoading(false);
      setMessage({ type: 'success', text: `Loaded ${filtered.length} library configurations` });

      // Phase 2: Sync-from-bunny in background — only once per session (or on forceSync)
      if (forceSync || !syncDoneRef.current) {
        syncDoneRef.current = true;
        setSyncing(true);
        try {
          const { data: syncData } = await api.post('/library-configs/sync-from-bunny/');
          if (syncData && (syncData.created > 0 || syncData.updated > 0)) {
            // Re-fetch configs to pick up newly synced entries
            const { data: refreshed } = await api.get('/library-configs/');
            const refreshedFiltered = liveIds.length > 0
              ? refreshed.filter(cfg => liveIds.includes(cfg.library_id))
              : refreshed;
            _configCache.set(refreshedFiltered);
            setConfigs(refreshedFiltered);
            setMessage({
              type: 'success',
              text: `Sync complete: ${syncData.created} created, ${syncData.updated} updated — ${refreshedFiltered.length} total`
            });
          }
        } catch (syncErr) {
          // Sync failure is non-fatal — configs already loaded from DB
          console.warn('[ConfigCache] Sync-from-bunny failed (non-fatal):', syncErr.message);
        } finally {
          setSyncing(false);
        }
      }

    } catch (error) {
      console.error('Error loading configs:', error);
      setLoading(false);
      setMessage({
        type: 'error',
        text: `Failed to load configurations: ${error.response?.data?.detail || error.message}`
      });
    }
  };

  // Called by Refresh button — clears cache and forces full reload + sync
  const fetchConfigs = () => {
    _configCache.clear();
    syncDoneRef.current = false;
    loadConfigs(true);
  };

  // ─── Excel helpers ────────────────────────────────────────────────────────
  const isRowEmpty = (row) => {
    if (!row || typeof row !== 'object') return true;
    return Object.values(row).every(v => v === null || v === undefined || (typeof v === 'string' && v.trim() === ''));
  };
  const getLibraryId = (row) => {
    const id = row['Library ID'] || row['library_id'] || row['ID'] || row['id'];
    if (id === null || id === undefined || id === '') return null;
    const n = typeof id === 'number' ? id : parseInt(String(id).trim(), 10);
    return isNaN(n) ? null : n;
  };
  const getApiKey = (row) => {
    const key = row['API Key'] || row['api_key'] || row['API_KEY'] || row['Stream API Key'];
    if (!key || typeof key !== 'string') return null;
    const t = key.trim();
    return t.length > 0 ? t : null;
  };
  const isRowValid = (row) => !!(getLibraryId(row) && getApiKey(row));

  const handleExcelUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      setExcelProgress({ isProcessing: true, totalRows: 0, processedRows: 0, successCount: 0, failCount: 0, failedRows: [], isComplete: false });
      setShowExcelModal(true);

      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data);
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonData = XLSX.utils.sheet_to_json(worksheet);
      const validRows = jsonData.filter(row => !isRowEmpty(row) && isRowValid(row));
      setExcelProgress(prev => ({ ...prev, totalRows: validRows.length }));

      let successCount = 0, failCount = 0, failedRows = [];

      for (let i = 0; i < validRows.length; i++) {
        const row = validRows[i];
        const libraryId = getLibraryId(row);
        const apiKey = getApiKey(row);

        if (!libraryId || !apiKey) {
          failCount++;
          failedRows.push({ rowNumber: jsonData.indexOf(row) + 2, libraryId: libraryId || 'N/A', reason: 'Missing Library ID or API Key' });
          setExcelProgress(prev => ({ ...prev, processedRows: i + 1, failCount, failedRows }));
          continue;
        }

        try {
          const response = await api.put(`/library-configs/${libraryId}`, { stream_api_key: apiKey, is_active: true });
          const savedConfig = response.data;
          if (!savedConfig?.stream_api_key || savedConfig.stream_api_key.trim() !== apiKey.trim()) {
            throw new Error('API key was not saved correctly on the backend');
          }
          successCount++;
          setConfigs(prev => prev.map(cfg => cfg.library_id === libraryId ? savedConfig : cfg));
          // Update cache too
          if (_configCache.data) {
            _configCache.data = _configCache.data.map(cfg => cfg.library_id === libraryId ? savedConfig : cfg);
          }
          setExcelProgress(prev => ({ ...prev, processedRows: i + 1, successCount }));
        } catch (err) {
          failCount++;
          failedRows.push({
            rowNumber: jsonData.indexOf(row) + 2, libraryId,
            reason: err.response?.data?.detail || err.message || 'Unknown error'
          });
          setExcelProgress(prev => ({ ...prev, processedRows: i + 1, failCount, failedRows }));
        }
      }

      setExcelProgress(prev => ({ ...prev, isProcessing: false, isComplete: true }));
      setMessage({ type: successCount > 0 ? 'success' : 'error', text: `Excel upload complete! Updated ${successCount} libraries.${failCount > 0 ? ` Failed: ${failCount}` : ''}` });
    } catch (error) {
      setExcelProgress(prev => ({ ...prev, isProcessing: false, isComplete: true }));
      setMessage({ type: 'error', text: `Failed to process Excel file: ${error.message}` });
    }
    event.target.value = '';
  };

  const closeExcelModal = () => {
    if (!excelProgress.isProcessing) {
      setShowExcelModal(false);
      setExcelProgress({ isProcessing: false, totalRows: 0, processedRows: 0, successCount: 0, failCount: 0, failedRows: [], isComplete: false });
    }
  };

  // ─── Clear API keys ───────────────────────────────────────────────────────
  const clearAllApiKeys = async () => {
    setClearing(true);
    const librariesToClear = clearMode === 'selected'
      ? configs.filter(cfg => selectedIds.has(cfg.library_id))
      : configs;

    let clearedCount = 0, errorCount = 0;
    for (const config of librariesToClear) {
      try {
        await api.put(`/library-configs/${config.library_id}`, { stream_api_key: '', is_active: false });
        clearedCount++;
        setConfigs(prev => prev.map(cfg =>
          cfg.library_id === config.library_id ? { ...cfg, stream_api_key: '', is_active: false } : cfg
        ));
        if (_configCache.data) {
          _configCache.data = _configCache.data.map(cfg =>
            cfg.library_id === config.library_id ? { ...cfg, stream_api_key: '', is_active: false } : cfg
          );
        }
      } catch (err) {
        errorCount++;
      }
    }
    setMessage({ type: 'success', text: `Cleared API keys for ${clearedCount} libraries.${errorCount > 0 ? ` Failed: ${errorCount}` : ''}` });
    setSelectedIds(new Set());
    setShowClearConfirmation(false);
    setTimeout(() => setClearing(false), 500);
  };

  // ─── Config edit helpers ──────────────────────────────────────────────────
  const saveConfig = async (libraryId) => {
    const changes = pendingChanges[libraryId];
    if (!changes) return;
    setSaving(prev => ({ ...prev, [libraryId]: true }));
    try {
      const { data: updatedConfig } = await api.put(`/library-configs/${libraryId}`, changes);
      setConfigs(prev => prev.map(cfg => cfg.library_id === libraryId ? updatedConfig : cfg));
      if (_configCache.data) {
        _configCache.data = _configCache.data.map(cfg => cfg.library_id === libraryId ? updatedConfig : cfg);
      }
      setPendingChanges(prev => { const n = { ...prev }; delete n[libraryId]; return n; });
      setMessage({ type: 'success', text: `Saved configuration for library ${libraryId}` });
    } catch (error) {
      setMessage({ type: 'error', text: `Failed to save: ${error.response?.data?.detail || error.message}` });
    } finally {
      setSaving(prev => ({ ...prev, [libraryId]: false }));
    }
  };

  const handleFieldChange = (libraryId, field, value) => {
    setConfigs(prev => prev.map(cfg => cfg.library_id === libraryId ? { ...cfg, [field]: value } : cfg));
    setPendingChanges(prev => ({ ...prev, [libraryId]: { ...prev[libraryId], [field]: value } }));
  };

  const toggleApiKeyVisibility = (id) => setShowApiKeys(prev => ({ ...prev, [id]: !prev[id] }));
  const toggleActive = (id, cur) => handleFieldChange(id, 'is_active', !cur);
  const hasPendingChanges = (id) => !!(pendingChanges[id] && Object.keys(pendingChanges[id]).length > 0);

  // ─── Display helpers ──────────────────────────────────────────────────────
  const isConfigured = (cfg) => !!(cfg.stream_api_key && String(cfg.stream_api_key).trim().length > 0);
  const totalConfigs = configs.length;
  const activeCount = configs.filter(isConfigured).length;

  const formatTimeAgo = (d) => {
    if (!d) return '—';
    const date = typeof d === 'string' ? new Date(d) : d;
    const diff = Date.now() - date.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs} hours ago`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days} days ago`;
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const endpointFor = (cfg) => `https://dash.bunny.net/stream/${cfg.library_id}/library/videos`;
  const statusFor = (cfg) => hasPendingChanges(cfg.library_id) ? 'Pending' : isConfigured(cfg) ? 'Active' : 'Inactive';
  const statusStyles = (st) => ({ Active: 'bg-emerald-100 text-emerald-800', Inactive: 'bg-rose-100 text-rose-800', Pending: 'bg-amber-100 text-amber-800' }[st] || 'bg-slate-100 text-slate-700');

  const toggleSelected = (id) => setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleSelectAll = () => {
    if (selectedIds.size === filteredConfigs.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(filteredConfigs.map(cfg => cfg.library_id)));
  };

  const progressPercentage = excelProgress.totalRows > 0
    ? Math.round((excelProgress.processedRows / excelProgress.totalRows) * 100) : 0;

  return (
    <div className="container mx-auto p-6 max-w-7xl">
      {/* Page Header */}
      <div className="mb-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold mb-2 flex items-center gap-2">
              <span className="text-indigo-500">⚙️</span>
              API Configuration
            </h1>
            <p className="text-gray-600">Manage Bunny CDN library API settings and endpoints</p>
          </div>
          <div className="flex items-center gap-2">
            {syncing && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-blue-50 text-blue-600 border border-blue-200">
                <RefreshCw className="w-3 h-3 animate-spin" />
                Syncing...
              </span>
            )}
            <Button onClick={fetchConfigs} disabled={loading || syncing} className="flex items-center gap-2">
              <RefreshCw className={`h-4 w-4 ${(loading || syncing) ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-4">
            <div className="text-sm text-indigo-600 font-medium flex items-center gap-2"><span>🔧</span>Total Configs</div>
            <div className="text-2xl font-semibold text-indigo-800 mt-1">{totalConfigs}</div>
          </div>
          <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-4">
            <div className="text-sm text-indigo-600 font-medium flex items-center gap-2"><span>✓</span>Active APIs</div>
            <div className="text-2xl font-semibold text-indigo-800 mt-1">{activeCount}</div>
          </div>
        </div>
      </div>

      {/* Status Message */}
      {message.text && (
        <Alert className={`mb-4 ${message.type === 'error' ? 'border-red-500 bg-red-50' : 'border-green-500 bg-green-50'}`}>
          <AlertDescription className={message.type === 'error' ? 'text-red-700' : 'text-green-700'}>
            {message.text}
          </AlertDescription>
        </Alert>
      )}

      {/* Search & Filters */}
      <div className="rounded-lg border border-slate-200 bg-white p-4 mb-4">
        <div className="flex flex-col md:flex-row md:items-center gap-3">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 h-4 w-4" />
            <Input placeholder="Search configurations..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="pl-10" />
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={activeOnly} onChange={e => { setActiveOnly(e.target.checked); if (e.target.checked) setInactiveOnly(false); }} />
            Active Only
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={inactiveOnly} onChange={e => { setInactiveOnly(e.target.checked); if (e.target.checked) setActiveOnly(false); }} />
            Inactive Only
          </label>
        </div>
      </div>

      {/* Two-column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Left: Configuration List */}
        <div className="lg:col-span-3">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-slate-700">Configuration List</h2>
            <div className="text-xs text-slate-500">{filteredConfigs.length} of {configs.length}</div>
          </div>

          <div
            ref={scrollRef}
            onScroll={handleScroll}
            className="virtual-scroll border border-slate-200 rounded-lg overflow-auto"
            style={{ maxHeight: '70vh' }}
          >
            {/* Background sync indicator bar */}
            {syncing && (
              <div className="h-1 bg-blue-100">
                <div className="h-1 bg-blue-500 animate-pulse w-full"></div>
              </div>
            )}

            {/* Sticky Header */}
            <div className="sticky top-0 z-10 bg-slate-50 border-b border-slate-200 grid grid-cols-[50px_2fr_1.2fr_0.7fr_0.8fr_80px] px-4 h-10 items-center text-xs font-semibold text-slate-600">
              <div className="flex items-center justify-center">
                <input type="checkbox"
                  checked={selectedIds.size === filteredConfigs.length && filteredConfigs.length > 0}
                  onChange={toggleSelectAll} title="Select all visible" />
              </div>
              <div>Config Name</div>
              <div>Endpoint</div>
              <div>Status</div>
              <div>Last Modified</div>
              <div className="text-center">Actions</div>
            </div>

            {/* Loading shimmer */}
            {loading && (
              <div className="p-4 space-y-2">
                {[...Array(8)].map((_, i) => (
                  <div key={i} className="animate-pulse h-[60px] bg-slate-100 rounded" />
                ))}
              </div>
            )}

            {/* Rows */}
            {!loading && filteredConfigs.map(cfg => {
              const st = statusFor(cfg);
              const isRowExpanded = expandedId === cfg.library_id;
              return (
                <React.Fragment key={cfg.library_id}>
                  <div className="grid grid-cols-[50px_2fr_1.2fr_0.7fr_0.8fr_80px] items-center px-4 border-b hover:bg-slate-50 h-[60px]">
                    <div className="flex items-center justify-center">
                      <input type="checkbox" checked={selectedIds.has(cfg.library_id)}
                        onChange={e => { e.stopPropagation(); toggleSelected(cfg.library_id); }} />
                    </div>
                    <div className="flex items-center gap-2 min-w-0 cursor-pointer"
                      onClick={() => setExpandedId(isRowExpanded ? null : cfg.library_id)}>
                      <span className="text-indigo-500 text-base">🔗</span>
                      <span className="font-mono text-[15px] font-semibold text-slate-900 truncate" title={cfg.library_name}>{cfg.library_name}</span>
                    </div>
                    <div className="min-w-0">
                      <span className="font-mono text-[13px] bg-[#f8f9fa] px-2 py-1 rounded text-slate-800 truncate inline-block max-w-full" title={endpointFor(cfg)}>
                        {endpointFor(cfg)}
                      </span>
                    </div>
                    <div>
                      <span className={`inline-flex items-center px-3 py-1 rounded-full text-[12px] font-semibold ${statusStyles(st)}`}>{st}</span>
                    </div>
                    <div className="flex items-center gap-2 text-[13px] text-slate-500">
                      <span>🕐</span><span>{formatTimeAgo(cfg.updated_at)}</span>
                    </div>
                    <div className="flex items-center justify-center">
                      <Button variant="ghost" size="sm"
                        onClick={e => { e.stopPropagation(); setExpandedId(isRowExpanded ? null : cfg.library_id); }}
                        className="h-8 px-2">
                        {isRowExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>

                  {isRowExpanded && (
                    <div className="bg-white mx-6 my-3 rounded-xl p-6 border border-slate-200 shadow-sm"
                      style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.08)', borderLeft: '4px solid #6366f1' }}>
                      <div className="flex items-center justify-between mb-3">
                        <div className="text-[18px] font-bold text-slate-900">Config Name: {cfg.library_name}</div>
                        <div className="flex items-center gap-2">
                          <Button size="sm" className="h-8 px-3 bg-blue-600 text-white rounded-md" disabled>Edit</Button>
                          <Button size="sm" className="h-8 px-3 bg-red-500 text-white rounded-md" disabled>Delete</Button>
                        </div>
                      </div>

                      <div className="mb-4 space-y-4">
                        <div>
                          <div className="text-[13px] font-semibold text-slate-600 uppercase">Base URL</div>
                          <div className="text-[15px] text-slate-900 font-mono">{endpointFor(cfg)}</div>
                        </div>
                        <div>
                          <div className="text-[13px] font-semibold text-slate-600 uppercase">API Key</div>
                          <div className="flex items-center gap-2 mb-2">
                            <div className="text-[15px] text-slate-900 font-mono bg-slate-100 rounded px-2 py-1">
                              {showApiKeys[cfg.library_id] ? (cfg.stream_api_key || '—') : '••••••••••••••••'}
                            </div>
                            <Button type="button" size="sm" variant="ghost"
                              className="w-7 h-7 rounded-full bg-slate-100 hover:bg-slate-200"
                              onClick={() => toggleApiKeyVisibility(cfg.library_id)}>👁️</Button>
                          </div>
                          <div className="flex gap-2">
                            <Input type="text" placeholder="Enter Stream API key"
                              value={cfg.stream_api_key || ''}
                              onChange={e => handleFieldChange(cfg.library_id, 'stream_api_key', e.target.value)}
                              disabled={saving[cfg.library_id]} className="flex-1" />
                            {hasPendingChanges(cfg.library_id) && (
                              <Button size="sm" onClick={() => saveConfig(cfg.library_id)}
                                disabled={saving[cfg.library_id]} className="flex items-center gap-2">
                                <Save className="h-4 w-4" />Save
                              </Button>
                            )}
                          </div>
                          {!isConfigured(cfg) && (
                            <div className="text-[12px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 inline-block mt-2">
                              Add an API key to activate this library.
                            </div>
                          )}
                        </div>
                        <div>
                          <div className="text-[13px] font-semibold text-slate-600 uppercase">Rate Limit</div>
                          <div className="text-[15px] text-slate-900">100 requests/min</div>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
                        {[['✓', 'Active Status', cfg.is_active ? 'Active' : 'Inactive'],
                          ['📊', 'Calls Today', '—'],
                          ['⚡', 'Uptime', '—']].map(([icon, label, val]) => (
                          <div key={label} className="rounded-lg border border-slate-200 p-4">
                            <div className="text-sm text-slate-600 flex items-center gap-2"><span>{icon}</span>{label}</div>
                            <div className="mt-1 text-slate-900 font-medium">{val}</div>
                          </div>
                        ))}
                      </div>

                      <div className="flex items-center justify-between pt-2">
                        <div className="flex items-center gap-3">
                          <Button size="sm" variant="outline"
                            onClick={() => toggleActive(cfg.library_id, cfg.is_active)}
                            disabled={saving[cfg.library_id]}>
                            {isConfigured(cfg) ? 'Deactivate' : 'Activate'}
                          </Button>
                          {isConfigured(cfg) ? (
                            <Badge variant="default" className="bg-green-500">
                              <CheckCircle className="h-3 w-3 mr-1" />Configured
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="bg-amber-500">
                              <XCircle className="h-3 w-3 mr-1" />Missing API Key
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {saving[cfg.library_id] && (
                            <div className="flex items-center gap-2 text-sm text-blue-600">
                              <RefreshCw className="h-3 w-3 animate-spin" />Saving...
                            </div>
                          )}
                          {hasPendingChanges(cfg.library_id) && (
                            <Button size="sm" onClick={() => saveConfig(cfg.library_id)}
                              disabled={saving[cfg.library_id]} className="flex items-center gap-2">
                              <Save className="h-4 w-4" />Save Changes
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </React.Fragment>
              );
            })}

            <div className={`sticky bottom-0 h-4 ${atBottom ? 'bg-transparent' : 'bg-gradient-to-t from-slate-100 to-transparent'}`}></div>
          </div>

          {filteredConfigs.length === 0 && !loading && searchTerm && (
            <Card className="w-full mt-4">
              <CardContent className="text-center py-8">
                <Search className="h-12 w-12 mx-auto text-gray-400 mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">No Configurations Found</h3>
                <p className="text-gray-500 mb-4">No configurations match your search. Try a different term.</p>
                <Button onClick={() => setSearchTerm('')} variant="outline">Clear Search</Button>
              </CardContent>
            </Card>
          )}

          {configs.length === 0 && !loading && !searchTerm && (
            <Card className="w-full mt-4">
              <CardContent className="text-center py-8">
                <Database className="h-12 w-12 mx-auto text-gray-400 mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">No API Configurations</h3>
                <p className="text-gray-500 mb-4">Click "Refresh" to load your video libraries.</p>
                <Button onClick={fetchConfigs} disabled={loading} className="flex items-center gap-2">
                  <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Refresh
                </Button>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right: Quick Actions */}
        <div className="lg:col-span-2">
          <div className="bg-[#f8fafc] p-6 border border-slate-200 rounded-xl">
            <h3 className="text-sm font-semibold text-slate-700 mb-3">Quick Actions & Info</h3>
            <div className="space-y-3">
              <div className="relative">
                <input type="file" accept=".xlsx,.xls" onChange={handleExcelUpload}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  disabled={excelProgress.isProcessing} />
                <Button className="w-full h-[42px] rounded-lg text-[14px] font-medium flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white disabled:opacity-50"
                  disabled={excelProgress.isProcessing}>
                  📤 Upload Excel (API Keys)
                </Button>
              </div>

              <Button className="w-full h-[42px] rounded-lg text-[14px] font-medium flex items-center justify-center gap-2 bg-amber-600 hover:bg-amber-700 text-white"
                onClick={() => { setClearMode('all'); setShowClearConfirmation(true); }}
                disabled={configs.length === 0 || clearing}>
                <Trash2 className="h-4 w-4" />Clear All API Keys
              </Button>

              {selectedIds.size > 0 && (
                <Button className="w-full h-[42px] rounded-lg text-[14px] font-medium flex items-center justify-center gap-2 bg-orange-600 hover:bg-orange-700 text-white"
                  onClick={() => { setClearMode('selected'); setShowClearConfirmation(true); }}
                  disabled={clearing}>
                  <Trash2 className="h-4 w-4" />Clear Selected ({selectedIds.size})
                </Button>
              )}

              <Button variant="destructive" className="w-full h-[42px] rounded-lg text-[14px] font-medium flex items-center justify-center gap-2"
                disabled={selectedIds.size === 0}>
                🗑️ Delete Selected
              </Button>
            </div>
            <div className="mt-6 text-sm text-slate-600">
              <div>Selected: {selectedIds.size}/{filteredConfigs.length}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Clear Confirmation Modal */}
      {showClearConfirmation && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => !clearing && setShowClearConfirmation(false)}>
          <div className="bg-white rounded-lg p-8 w-full max-w-md border border-slate-200" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-center mb-4">
              <AlertCircle className="h-12 w-12 text-amber-500" />
            </div>
            <h3 className="text-xl font-semibold text-slate-900 text-center mb-2">
              Clear {clearMode === 'all' ? 'All' : 'Selected'} API Keys?
            </h3>
            <p className="text-sm text-slate-600 text-center mb-6">
              {clearMode === 'all'
                ? `This will clear API keys for all ${configs.length} libraries. This cannot be undone.`
                : `This will clear API keys for ${selectedIds.size} selected ${selectedIds.size === 1 ? 'library' : 'libraries'}. This cannot be undone.`}
            </p>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setShowClearConfirmation(false)} disabled={clearing}>Cancel</Button>
              <Button className="flex-1 bg-amber-600 hover:bg-amber-700 text-white flex items-center justify-center gap-2"
                onClick={clearAllApiKeys} disabled={clearing}>
                {clearing ? <><RefreshCw className="h-4 w-4 animate-spin" />Clearing...</> : <><Trash2 className="h-4 w-4" />Yes, Clear</>}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Excel Upload Progress Modal */}
      {showExcelModal && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={closeExcelModal}>
          <div className="bg-white rounded-lg p-8 w-full max-w-md border border-slate-200" onClick={e => e.stopPropagation()}>
            <div className="text-center">
              {excelProgress.isProcessing ? (
                <>
                  <div className="flex justify-center mb-4"><Loader className="h-12 w-12 text-indigo-600 animate-spin" /></div>
                  <h3 className="text-xl font-semibold text-slate-900 mb-2">Processing Excel File</h3>
                  <p className="text-sm text-slate-600 mb-6">Please wait while we process your file...</p>
                </>
              ) : excelProgress.failCount === 0 ? (
                <>
                  <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-4" />
                  <h3 className="text-xl font-semibold text-slate-900 mb-2">Upload Complete!</h3>
                </>
              ) : (
                <>
                  <AlertCircle className="h-12 w-12 text-amber-500 mx-auto mb-4" />
                  <h3 className="text-xl font-semibold text-slate-900 mb-2">Upload Complete (With Issues)</h3>
                </>
              )}

              <div className="mb-6">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-slate-700">Progress</span>
                  <span className="text-sm font-semibold text-indigo-600">{progressPercentage}%</span>
                </div>
                <div className="w-full h-3 bg-slate-200 rounded-full overflow-hidden">
                  <div className="h-full bg-indigo-600 transition-all duration-300" style={{ width: `${progressPercentage}%` }}></div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4 mb-6">
                {[['blue', 'Processed', excelProgress.processedRows],
                  ['green', 'Success', excelProgress.successCount],
                  ['red', 'Failed', excelProgress.failCount]].map(([color, label, val]) => (
                  <div key={label} className={`rounded-lg bg-${color}-50 p-3`}>
                    <div className={`text-2xl font-bold text-${color}-600`}>{val}</div>
                    <div className="text-xs text-slate-600">{label}</div>
                  </div>
                ))}
              </div>

              {excelProgress.failedRows.length > 0 && (
                <div className="mb-6 max-h-[200px] overflow-y-auto">
                  <div className="text-left bg-red-50 border border-red-200 rounded-lg p-3">
                    <p className="text-xs font-semibold text-red-700 mb-2">Failed Rows:</p>
                    <div className="space-y-1">
                      {excelProgress.failedRows.map((r, i) => (
                        <div key={i} className="text-xs text-red-600">
                          <span className="font-semibold">Row {r.rowNumber}</span> - {r.libraryId}: {r.reason}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {!excelProgress.isProcessing && (
                <Button onClick={closeExcelModal}
                  className={`w-full ${excelProgress.failCount === 0 ? 'bg-green-600 hover:bg-green-700' : 'bg-amber-600 hover:bg-amber-700'}`}>
                  Close
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LibraryConfig;
