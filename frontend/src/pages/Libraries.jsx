import React, { useState, useEffect, useMemo, useRef } from 'react';
import api from '../services/api';
import { libraryCache } from '../services/libraryCache';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { Alert, AlertDescription } from '../components/ui/alert';
import * as XLSX from 'xlsx';
import { 
  RefreshCw, 
  Search, 
  ChevronDown, 
  ChevronRight,
  Database,
  Calendar,
  TrendingUp,
  Clock,
  Eye,
  Download,
  Filter,
  CheckSquare,
  Square,
  BarChart3,
  Activity,
  Zap,
  Sparkles,
  Globe,
  Users,
  Play,
  Layers,
  Hash,
  X
} from 'lucide-react';

// ─── Module-level cache for historical stats (survives navigation) ────────────
const _statsCache = {
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

const Libraries = () => {
  const [libraries, setLibraries] = useState([]);
  // loading: true only on very first load with no cache at all
  const [loading, setLoading] = useState(true);
  // statsLoading: background indicator while stats are being fetched
  const [statsLoading, setStatsLoading] = useState(false);
  const [message, setMessage] = useState({ text: '', type: '' });
  const [expandedLibraries, setExpandedLibraries] = useState(new Set());
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState('library_name');
  const [sortOrder, setSortOrder] = useState('asc');
  const [showOnlyWithStats, setShowOnlyWithStats] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState({
    libraryName: true,
    libraryId: true,
    monthlyData: true,
    lastUpdated: true,
    statsCount: true
  });

  const [watchTimeFormats, setWatchTimeFormats] = useState({});

  // API Tester state
  const [showApiTester, setShowApiTester] = useState(false);
  const [apiTestRunning, setApiTestRunning] = useState(false);
  const [apiTestLogs, setApiTestLogs] = useState([]);
  const [apiTestSummary, setApiTestSummary] = useState(null);

  const [selectedLibraries, setSelectedLibraries] = useState(new Set());
  const [showExportModal, setShowExportModal] = useState(false);

  const scrollRef = useRef(null);
  const [atTop, setAtTop] = useState(true);
  const [atBottom, setAtBottom] = useState(false);
  const baseCacheRef = useRef(null);
  // Track if we already fetched stats this session to avoid double-fetching
  const statsFetchedRef = useRef(false);
  
  const handleScroll = (e) => {
    const el = e.currentTarget;
    setAtTop(el.scrollTop <= 0);
    setAtBottom(el.scrollTop + el.clientHeight >= el.scrollHeight - 1);
  };
  
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    setAtTop(el.scrollTop <= 0);
    setAtBottom(el.scrollTop + el.clientHeight >= el.scrollHeight - 1);
  }, [loading]);

  // ─── Helpers ──────────────────────────────────────────────────────────────
  const showMessage = (text, type = 'success') => {
    setMessage({ text, type });
    setTimeout(() => setMessage({ text: '', type: '' }), 5000);
  };

  // Build a merged libraries array from base data + optional stats data
  const buildMergedLibraries = (baseData, statsData = [], configMap = new Map()) => {
    const baseMap = new Map();
    baseData.forEach(lib => {
      baseMap.set(lib.id, {
        library_id: lib.id,
        library_name: configMap.get(lib.id) || lib.name,
        has_stats: false,
        monthly_data: [],
        last_updated: null,
        video_views: lib.video_views || 0,
        total_watch_time_seconds: lib.total_watch_time_seconds || 0
      });
    });

    statsData.forEach(statLib => {
      const id = statLib.library_id ?? statLib.id;
      const base = baseMap.get(id);
      if (base) {
        base.has_stats = Array.isArray(statLib.monthly_data) && statLib.monthly_data.length > 0;
        base.monthly_data = statLib.monthly_data || [];
        base.last_updated = statLib.last_updated || base.last_updated;
        const cfgName = configMap.get(id);
        if (cfgName) base.library_name = cfgName;
        else if (statLib.library_name) base.library_name = statLib.library_name;
      } else {
        baseMap.set(id, {
          library_id: id,
          library_name: configMap.get(id) || statLib.library_name || `Library ${id}`,
          has_stats: Array.isArray(statLib.monthly_data) && statLib.monthly_data.length > 0,
          monthly_data: statLib.monthly_data || [],
          last_updated: statLib.last_updated || null,
          video_views: 0,
          total_watch_time_seconds: 0,
        });
      }
    });

    return Array.from(baseMap.values());
  };

  // ─── STEP 1: Load base libraries (fast — from cache or backend cache) ─────
  const loadBaseLibraries = async (forceReload = false) => {
    if (forceReload) {
      baseCacheRef.current = null;
      libraryCache.clear();
      _statsCache.clear();
      statsFetchedRef.current = false;
      try { await api.post('/cache/clear-libraries'); } catch (_) {}
    }

    let baseData = baseCacheRef.current || libraryCache.get();
    if (baseData) {
      console.log(`[LibCache] HIT — ${baseData.length} libraries from frontend cache`);
    } else {
      console.log('[LibCache] MISS — fetching from backend');
      const { data } = await api.get('/bunny-libraries/');
      baseData = data;
      baseCacheRef.current = baseData;
      libraryCache.set(baseData);
    }

    // Fetch config names (fast DB query)
    const configMap = new Map();
    try {
      const { data: cfgData } = await api.get('/library-configs/');
      (Array.isArray(cfgData) ? cfgData : []).forEach(cfg => {
        if (cfg?.library_id != null && cfg.library_name) {
          configMap.set(cfg.library_id, cfg.library_name);
        }
      });
    } catch (_) {}

    return { baseData, configMap };
  };

  // ─── STEP 2: Load historical stats (slow — run in background) ─────────────
  const loadHistoricalStats = async (withStatsOnly = false) => {
    const cached = _statsCache.get();
    if (cached) {
      console.log(`[StatsCache] HIT — ${cached.length} stat entries from cache`);
      return cached;
    }
    console.log('[StatsCache] MISS — fetching from backend');
    const { data } = await api.get('/historical-stats/libraries/', {
      params: { with_stats_only: withStatsOnly }
    });
    let statsData = data || [];

    // Filter out libraries that no longer exist in Bunny
    try {
      const { data: liveData } = await api.get('/bunny-libraries/');
      const liveIds = new Set(
        (Array.isArray(liveData) ? liveData : [])
          .map(l => l.id ?? l.library_id)
          .filter(id => id != null)
      );
      if (liveIds.size > 0) {
        const before = statsData.length;
        statsData = statsData.filter(lib => {
          const id = lib.library_id ?? lib.id;
          return liveIds.has(id);
        });
        console.log(`[StatsCache] Filtered ${before - statsData.length} deleted libraries`);
      }
    } catch (_) {
      console.warn('[StatsCache] Could not filter against live Bunny IDs');
    }

    _statsCache.set(statsData);
    return statsData;
  };

  // ─── Main fetch orchestrator ───────────────────────────────────────────────
  const fetchLibrariesWithHistory = async (withStatsOnly = false, forceReload = false) => {
    try {
      // Phase 1: Show base libraries immediately (fast)
      const hasExistingData = libraries.length > 0;
      if (!hasExistingData) setLoading(true);

      const { baseData, configMap } = await loadBaseLibraries(forceReload);

      // If we already have stats cached, merge immediately
      const cachedStats = forceReload ? null : _statsCache.get();
      if (cachedStats) {
        const merged = buildMergedLibraries(baseData, cachedStats, configMap);
        setLibraries(merged);
        setLoading(false);
        const withStatsCount = merged.filter(l => l.has_stats).length;
        showMessage(`Loaded ${merged.length} libraries; ${withStatsCount} with synced stats`, 'success');
        return;
      }

      // Show base libraries right away so page isn't blank
      const baseOnly = buildMergedLibraries(baseData, [], configMap);
      setLibraries(baseOnly);
      setLoading(false);
      showMessage(`Loaded ${baseOnly.length} libraries — fetching stats...`, 'info');

      // Phase 2: Load stats in background (don't block UI)
      if (!statsFetchedRef.current || forceReload) {
        statsFetchedRef.current = true;
        setStatsLoading(true);
        try {
          const statsData = await loadHistoricalStats(withStatsOnly);
          const merged = buildMergedLibraries(baseData, statsData, configMap);
          setLibraries(merged);
          const withStatsCount = merged.filter(l => l.has_stats).length;
          showMessage(`Loaded ${merged.length} libraries; ${withStatsCount} with synced stats`, 'success');
        } catch (statsErr) {
          console.warn('Historical stats failed (non-fatal):', statsErr);
          showMessage(`Showing ${baseOnly.length} libraries (stats unavailable)`, 'info');
        } finally {
          setStatsLoading(false);
        }
      }
    } catch (error) {
      console.error('Error fetching libraries:', error);
      setLoading(false);
      setStatsLoading(false); // ← ensure button is never stuck disabled
      // Fallback: try to get something from historical stats
      try {
        const statsData = await loadHistoricalStats(withStatsOnly);
        const normalized = (Array.isArray(statsData) ? statsData : []).map(lib => ({
          library_id: lib.library_id ?? lib.id,
          library_name: lib.library_name ?? lib.name ?? `Library ${lib.library_id ?? lib.id}`,
          has_stats: Array.isArray(lib.monthly_data) && lib.monthly_data.length > 0,
          monthly_data: lib.monthly_data ?? [],
          last_updated: lib.last_updated ?? null,
          video_views: 0,
          total_watch_time_seconds: 0,
        }));
        setLibraries(normalized);
        showMessage(`Loaded ${normalized.length} libraries from stats`, 'success');
      } catch (fallbackErr) {
        setLibraries([]);
        showMessage('Backend connection failed. Please ensure the API server is running.', 'error');
      }
    }
  };

  // Only run on mount — NOT on showOnlyWithStats change to avoid re-fetching on navigation
  useEffect(() => {
    fetchLibrariesWithHistory(showOnlyWithStats);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When showOnlyWithStats toggles, just re-filter client-side (no new fetch)
  // The filteredAndSortedLibraries memo already handles this

  // ─── API Tester ──────────────────────────────────────────────────────────
  const runApiTest = async () => {
    setApiTestRunning(true);
    setApiTestLogs([]);
    setApiTestSummary(null);
    const logs = [];

    const log = (msg, type = 'info') => {
      const entry = { msg, type, time: new Date().toLocaleTimeString() };
      logs.push(entry);
      setApiTestLogs([...logs]);
    };

    try {
      log('🔍 Checking cache status...', 'info');
      const cacheRes = await api.get('/cache/status');
      const cs = cacheRes.data;
      if (cs.cached) {
        log(`✅ Cache HIT — ${cs.libraries_count} libraries cached, ${cs.age_seconds}s old, expires in ${cs.expires_in_seconds}s`, 'success');
      } else {
        log('⚠️ Cache MISS — next call will fetch live from Bunny API', 'warning');
      }

      log('📡 Calling /bunny-libraries/ endpoint...', 'info');
      const t0 = Date.now();
      const libRes = await api.get('/bunny-libraries/');
      const elapsed = Date.now() - t0;
      const libs = libRes.data;
      log(`✅ Response received in ${elapsed}ms — ${libs.length} libraries returned`, 'success');

      if (libs.length > 0) {
        log(`📚 Sample libraries: ${libs.slice(0, 3).map(l => `"${l.name}" (ID: ${l.id})`).join(', ')}`, 'info');
      }

      log('📊 Checking historical stats endpoint...', 'info');
      const t1 = Date.now();
      const statsRes = await api.get('/historical-stats/libraries/');
      const elapsed2 = Date.now() - t1;
      log(`✅ Historical stats received in ${elapsed2}ms — ${statsRes.data.length} entries`, 'success');

      const withData = statsRes.data.filter(l => l.monthly_data?.length > 0).length;
      log(`📈 Libraries with monthly data: ${withData} / ${statsRes.data.length}`, 'info');

      log('✅ All checks passed — Bunny API is responding correctly', 'success');
      setApiTestSummary({ success: true, libCount: libs.length, elapsed, statsCount: statsRes.data.length, withData });
    } catch (err) {
      log(`❌ Error: ${err.response?.data?.detail || err.message}`, 'error');
      setApiTestSummary({ success: false, error: err.message });
    }

    setApiTestRunning(false);
  };

  // ─── UI helpers ──────────────────────────────────────────────────────────
  const toggleLibraryExpansion = (libraryId) => {
    setExpandedLibraries(prev => {
      const newSet = new Set(prev);
      newSet.has(libraryId) ? newSet.delete(libraryId) : newSet.add(libraryId);
      return newSet;
    });
  };

  const toggleLibrarySelection = (libraryId, event) => {
    event.stopPropagation();
    setSelectedLibraries(prev => {
      const newSet = new Set(prev);
      newSet.has(libraryId) ? newSet.delete(libraryId) : newSet.add(libraryId);
      return newSet;
    });
  };

  const formatNumber = (num) => {
    if (num === null || num === undefined) return 'N/A';
    return new Intl.NumberFormat().format(num);
  };

  const formatWatchTime = (seconds, format = 'minutes') => {
    if (!seconds && seconds !== 0) return 'N/A';
    if (format === 'hms') {
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      const secs = seconds % 60;
      return `${hours}h ${minutes}m ${secs}s`;
    }
    return `${Math.round(seconds / 60).toLocaleString()} min`;
  };

  const toggleWatchTimeFormat = (libraryId) => {
    setWatchTimeFormats(prev => ({
      ...prev,
      [libraryId]: prev[libraryId] === 'hms' ? 'minutes' : 'hms'
    }));
  };

  const getMonthName = (month) => {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return months[month - 1] || 'Unknown';
  };

  const filteredAndSortedLibraries = useMemo(() => {
    return libraries
      .filter(library => {
        const matchesSearch = library.library_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                             library.library_id.toString().includes(searchTerm);
        const matchesFilter = !showOnlyWithStats || (library.has_stats && library.monthly_data.length > 0);
        return matchesSearch && matchesFilter;
      })
      .sort((a, b) => {
        let aValue, bValue;
        switch (sortBy) {
          case 'library_name': aValue = a.library_name.toLowerCase(); bValue = b.library_name.toLowerCase(); break;
          case 'library_id': aValue = a.library_id; bValue = b.library_id; break;
          case 'last_updated': aValue = new Date(a.last_updated || 0); bValue = new Date(b.last_updated || 0); break;
          case 'monthly_count': aValue = a.monthly_data?.length || 0; bValue = b.monthly_data?.length || 0; break;
          default: aValue = a.library_name.toLowerCase(); bValue = b.library_name.toLowerCase();
        }
        if (aValue < bValue) return sortOrder === 'asc' ? -1 : 1;
        if (aValue > bValue) return sortOrder === 'asc' ? 1 : -1;
        return 0;
      });
  }, [libraries, searchTerm, sortBy, sortOrder, showOnlyWithStats]);

  const handleExportClick = () => setShowExportModal(true);

  const exportLibraries = (exportSelected) => {
    try {
      const toExport = exportSelected
        ? filteredAndSortedLibraries.filter(lib => selectedLibraries.has(lib.library_id))
        : filteredAndSortedLibraries;

      if (toExport.length === 0) { showMessage('No libraries to export', 'error'); setShowExportModal(false); return; }

      const exportData = toExport.map(library => {
        const baseData = {
          'Library Name': library.library_name,
          'Library ID': library.library_id,
          'Has Stats': library.has_stats ? 'Yes' : 'No',
          'Stats Count': library.monthly_data?.length || 0,
          'Last Updated': library.last_updated ? new Date(library.last_updated).toLocaleDateString() : 'N/A'
        };
        if (library.monthly_data?.length > 0) {
          library.monthly_data.forEach(monthData => {
            const monthKey = `${getMonthName(monthData.month)} ${monthData.year}`;
            baseData[`${monthKey} - Views`] = formatNumber(monthData.total_views);
            baseData[`${monthKey} - Watch Time (Minutes)`] = formatWatchTime(monthData.total_watch_time_seconds, 'minutes');
            baseData[`${monthKey} - Watch Time (H:M:S)`] = formatWatchTime(monthData.total_watch_time_seconds, 'hms');
          });
        }
        return baseData;
      });

      const allData = [...exportData, {}, { 'Library Name': 'SUMMARY', 'Stats Count': toExport.reduce((s, l) => s + (l.monthly_data?.length || 0), 0) }];
      const worksheet = XLSX.utils.json_to_sheet(allData);
      worksheet['!cols'] = Object.keys(exportData[0] || {}).map(k => ({ wch: Math.max(k.length, 15) }));
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Libraries Analytics');
      const fileName = `libraries-analytics${exportSelected ? '-selected' : ''}-${new Date().toISOString().split('T')[0]}.xlsx`;
      XLSX.writeFile(workbook, fileName);
      showMessage(`Excel file "${fileName}" downloaded successfully!`, 'success');
      setShowExportModal(false);
    } catch (error) {
      showMessage(`Error exporting: ${error.message}`, 'error');
      setShowExportModal(false);
    }
  };

  const getLibraryStats = () => {
    const totalLibraries = filteredAndSortedLibraries.length;
    const librariesWithStats = filteredAndSortedLibraries.filter(lib => lib.has_stats && lib.monthly_data?.length > 0).length;
    const totalDataPoints = filteredAndSortedLibraries.reduce((sum, lib) => sum + (lib.monthly_data?.length || 0), 0);
    return { totalLibraries, librariesWithStats, totalDataPoints };
  };

  const stats = getLibraryStats();
  const [headerCollapsed, setHeaderCollapsed] = useState(false);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100 relative overflow-hidden">
      {/* Background decorative elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-gradient-to-br from-blue-400/20 to-purple-600/20 rounded-full blur-3xl"></div>
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-gradient-to-tr from-indigo-400/20 to-pink-600/20 rounded-full blur-3xl"></div>
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-gradient-to-r from-cyan-400/10 to-blue-600/10 rounded-full blur-3xl"></div>
      </div>

      <div className="relative z-10 max-w-7xl mx-auto p-8 space-y-8">
        {/* Header Section */}
        <div className={`bg-white rounded-[12px] shadow-sm ${headerCollapsed ? 'p-4' : 'p-8'} mb-6`}>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-[28px] font-bold text-slate-800 flex items-center gap-2">
                <span className="text-[22px]">📊</span>
                Libraries Analytics
              </h1>
              {!headerCollapsed && (
                <p className="text-[14px] text-slate-500 mt-1">Advanced Performance Dashboard</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              {/* Stats loading indicator */}
              {statsLoading && (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-blue-50 text-blue-600 border border-blue-200">
                  <RefreshCw className="w-3 h-3 animate-spin" />
                  Loading stats...
                </span>
              )}
              <span className="inline-flex items-center px-2.5 py-1 rounded-md text-sm font-semibold bg-slate-100 text-slate-700 border border-slate-200">[{stats.totalLibraries}]</span>
              <button
                type="button"
                onClick={() => setHeaderCollapsed(v => !v)}
                className="inline-flex items-center px-2.5 py-1 rounded-md text-sm font-semibold bg-slate-100 text-slate-700 border border-slate-200 hover:bg-slate-200"
              >
                <ChevronDown className={`w-4 h-4 transition-transform ${headerCollapsed ? '' : 'rotate-180'}`} />
                <span className="ml-1">{headerCollapsed ? 'Expand' : 'Collapse'}</span>
              </button>
            </div>
          </div>

          {!headerCollapsed && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-6">
              {[
                { icon: '📚', value: stats.totalLibraries, label: 'Total Libs' },
                { icon: '📈', value: stats.librariesWithStats, label: 'Analytics' },
                { icon: '📊', value: stats.totalDataPoints, label: 'Data Points' },
              ].map(({ icon, value, label }) => (
                <div key={label} className="bg-gradient-to-b from-slate-50 to-white border border-slate-200 rounded-[10px] p-5 text-center transform transition-all duration-300 hover:-translate-y-1 hover:shadow-lg">
                  <div className="text-[18px] mb-2">{icon}</div>
                  <div className="text-[36px] font-bold text-blue-600 leading-none">{value}</div>
                  <div className="text-[12px] text-slate-500 uppercase mt-1">{label}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Message Alert */}
        {message.text && (
          <div className="relative">
            <div className="absolute inset-0 bg-gradient-to-r from-blue-600/20 to-indigo-600/20 rounded-2xl blur-lg"></div>
            <Alert className={`relative shadow-2xl border-0 backdrop-blur-sm ${
              message.type === 'error' ? 'bg-red-50/90 text-red-800' :
              message.type === 'info' ? 'bg-blue-50/90 text-blue-800' :
              'bg-green-50/90 text-green-800'
            }`}>
              <AlertDescription className="font-semibold text-lg">{message.text}</AlertDescription>
            </Alert>
          </div>
        )}

        {/* Filters & Controls Panel */}
        <div className="bg-white rounded-[12px] shadow-sm mb-5">
          <div className="px-6 py-5 space-y-5">
            <div className="relative">
              <Search className="absolute left-[14px] top-1/2 -translate-y-1/2 text-slate-400 w-[18px] h-[18px]" />
              <Input
                placeholder="Search libraries by name or ID..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="h-[42px] pl-[42px] pr-4 text-[14px] border-[1.5px] border-slate-300 rounded-[8px] bg-[#fafafa] focus:bg-white focus:border-blue-600 focus:outline-none focus:ring-4 focus:ring-blue-500/10"
              />
            </div>

            <div className="flex flex-wrap items-center gap-4">
              <button onClick={() => setShowOnlyWithStats(v => !v)} className="flex items-center cursor-pointer">
                <span className={`inline-flex items-center justify-center w-[20px] h-[20px] rounded-[5px] border-2 ${showOnlyWithStats ? 'bg-blue-600 border-blue-600' : 'bg-white border-slate-300'} transition-colors`}>
                  {showOnlyWithStats && <span className="text-white text-[14px] leading-none">✓</span>}
                </span>
                <span className="ml-2 text-[14px] text-slate-700 font-medium">Analytics Only</span>
              </button>

              <div className="flex items-center gap-2">
                <span className="text-[13px] text-slate-500">Sort by:</span>
                <div className="relative">
                  <select value={sortBy} onChange={e => setSortBy(e.target.value)}
                    className="h-[38px] pl-3 pr-8 text-[14px] border-[1.5px] border-slate-300 rounded-[8px] bg-white cursor-pointer focus:border-blue-600 focus:outline-none">
                    <option value="library_name">Name</option>
                    <option value="library_id">ID</option>
                    <option value="last_updated">Updated</option>
                    <option value="monthly_count">Data</option>
                  </select>
                  <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
                </div>
                <Button variant="outline" onClick={() => setSortOrder(v => v === 'asc' ? 'desc' : 'asc')}
                  className="w-[42px] h-[38px] border-[1.5px] border-slate-300 rounded-[8px] bg-white flex items-center justify-center text-slate-500">
                  <span className="text-[16px]">↕</span>
                </Button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {/* Columns Button */}
              <div className="relative group">
                <Button variant="outline" className="h-[38px] px-[18px] rounded-[8px] text-[14px] font-medium inline-flex items-center gap-2 bg-white border-[1.5px] border-slate-300 text-slate-600 hover:bg-slate-50">
                  <span className="text-[16px]">🎛️</span>Columns
                </Button>
                <div className="absolute top-full right-0 mt-3 bg-white border border-slate-200 rounded-2xl shadow-2xl p-6 min-w-56 z-20 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-300 transform translate-y-2 group-hover:translate-y-0">
                  <h4 className="font-bold text-gray-900 mb-4 text-lg">Show Columns</h4>
                  <div className="space-y-3">
                    {Object.entries({ libraryName: 'Library Name', libraryId: 'Library ID', statsCount: 'Stats Count', lastUpdated: 'Last Updated', monthlyData: 'Monthly Data' }).map(([key, label]) => (
                      <label key={key} className="flex items-center gap-3 cursor-pointer hover:bg-blue-50 p-2 rounded-lg transition-colors">
                        <input type="checkbox" checked={visibleColumns[key]} onChange={e => setVisibleColumns(prev => ({ ...prev, [key]: e.target.checked }))} className="rounded border-gray-300 text-blue-600 w-5 h-5" />
                        <span className="text-sm font-medium text-gray-700">{label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              <Button onClick={() => setShowApiTester(v => !v)}
                className={`h-[38px] px-[18px] rounded-[8px] text-[14px] font-medium inline-flex items-center gap-2 transition-all ${showApiTester ? 'bg-slate-700 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>
                <span>🧪</span>API Tester
              </Button>

              <Button onClick={handleExportClick}
                className="h-[38px] px-[18px] rounded-[8px] text-[14px] font-medium inline-flex items-center gap-2 bg-emerald-500 text-white hover:bg-emerald-600">
                <span className="text-[16px]">📥</span>Export Excel
              </Button>

              <Button
                onClick={() => { statsFetchedRef.current = false; fetchLibrariesWithHistory(showOnlyWithStats, true); }}
                disabled={loading}
                className="group h-[38px] px-[18px] rounded-[8px] text-[14px] font-medium inline-flex items-center gap-2 bg-blue-600 text-white hover:bg-blue-700"
                title="Force refresh from Bunny API (bypasses cache)">
                <RefreshCw className={`w-4 h-4 transition-transform duration-300 ${loading ? 'animate-spin' : 'group-hover:rotate-90'}`} />
                Refresh (Live)
              </Button>

              <Button
                onClick={async () => {
                  if (!window.confirm('This will remove deleted Bunny libraries from your database including their stats and assignments. Continue?')) return;
                  try {
                    const { data } = await api.post('/historical-stats/cleanup-deleted/');
                    showMessage(`Cleanup done: ${data.deleted_library_ids?.length || 0} stale libraries removed`, 'success');
                    statsFetchedRef.current = false;
                    fetchLibrariesWithHistory(showOnlyWithStats, true);
                  } catch (e) {
                    showMessage('Cleanup failed: ' + (e.response?.data?.detail || e.message), 'error');
                  }
                }}
                disabled={loading}
                className="h-[38px] px-[18px] rounded-[8px] text-[14px] font-medium inline-flex items-center gap-2 bg-orange-500 text-white hover:bg-orange-600"
                title="Remove deleted Bunny libraries from database">
                <X className="w-4 h-4" />
                Sync & Cleanup
              </Button>
            </div>
          </div>
        </div>

        {/* API Tester Panel */}
        {showApiTester && (
          <div className="bg-white rounded-[12px] shadow-sm mb-5 border border-blue-200">
            <div className="px-6 py-4 border-b border-blue-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-[18px]">🧪</span>
                <span className="text-[16px] font-bold text-slate-800">Bunny API Connection Tester</span>
              </div>
              <div className="flex items-center gap-2">
                <Button onClick={runApiTest} disabled={apiTestRunning}
                  className="h-[34px] px-4 rounded-[7px] text-[13px] font-medium bg-blue-600 text-white hover:bg-blue-700">
                  {apiTestRunning ? <><RefreshCw className="w-3 h-3 mr-1 animate-spin inline" /> Running...</> : '▶ Run Test'}
                </Button>
                <button onClick={() => setShowApiTester(false)}
                  className="w-[28px] h-[28px] flex items-center justify-center rounded-[6px] text-slate-400 hover:text-slate-600 hover:bg-slate-100 text-[18px] leading-none">×</button>
              </div>
            </div>
            <div className="px-6 py-4">
              {apiTestLogs.length === 0 && !apiTestRunning && (
                <div className="text-center py-8 text-slate-400 text-[14px]">
                  Click <strong>▶ Run Test</strong> to check your Bunny API connection
                </div>
              )}
              {apiTestLogs.length > 0 && (
                <div className="bg-slate-950 rounded-[8px] p-4 mb-4 space-y-1 font-mono text-[13px] max-h-[260px] overflow-y-auto">
                  {apiTestLogs.map((log, i) => (
                    <div key={i} className="flex items-start gap-3">
                      <span className="text-slate-500 text-[11px] mt-[2px] min-w-[64px] shrink-0">{log.time}</span>
                      <span className={log.type === 'error' ? 'text-red-400' : log.type === 'success' ? 'text-green-400' : log.type === 'warning' ? 'text-amber-400' : 'text-slate-300'}>
                        {log.msg}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {apiTestSummary && (
                <div className={`p-4 rounded-[8px] border ${apiTestSummary.success ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                  {apiTestSummary.success ? (
                    <div className="flex flex-wrap items-center gap-4">
                      <span className="text-green-800 text-[14px] font-semibold">✅ Connection healthy</span>
                      <span className="text-green-700 text-[13px] bg-green-100 px-2 py-0.5 rounded">{apiTestSummary.libCount} libraries</span>
                      <span className="text-green-700 text-[13px] bg-green-100 px-2 py-0.5 rounded">responded in {apiTestSummary.elapsed}ms</span>
                      <span className="text-green-700 text-[13px] bg-green-100 px-2 py-0.5 rounded">{apiTestSummary.withData} with monthly data</span>
                    </div>
                  ) : (
                    <div className="text-red-800 text-[14px] font-semibold">❌ Connection issue — {apiTestSummary.error}</div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Content Grid */}
        {loading ? (
          <div className="bg-white rounded-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.08)] overflow-hidden">
            <div className="virtual-scroll overflow-auto" style={{ maxHeight: '70vh' }}>
              {Array.from({ length: 10 }).map((_, i) => (
                <div key={`skeleton-${i}`} className="shimmer-row" style={{ borderBottom: '1px solid #f1f5f9' }}></div>
              ))}
            </div>
          </div>
        ) : filteredAndSortedLibraries.length === 0 ? (
          <div className="bg-white rounded-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.08)] overflow-hidden">
            <div style={{ paddingTop: '80px', paddingBottom: '80px', textAlign: 'center' }}>
              <div style={{ fontSize: '48px', color: '#cbd5e1' }}>🔍</div>
              <div className="mt-3" style={{ fontSize: '18px', fontWeight: 600, color: '#475569' }}>No libraries found</div>
              <div className="mt-1" style={{ fontSize: '14px', color: '#94a3b8' }}>Try adjusting your filters</div>
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.08)] overflow-hidden">
            {/* Background stats-loading bar */}
            {statsLoading && (
              <div className="h-1 bg-blue-100">
                <div className="h-1 bg-blue-500 animate-pulse" style={{ width: '100%' }}></div>
              </div>
            )}
            <div
              ref={scrollRef}
              onScroll={handleScroll}
              className="virtual-scroll overflow-auto"
              style={{ maxHeight: '70vh' }}
            >
              {/* Table Header */}
              <div className="sticky top-0 z-10" style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0', height: '48px' }}>
                <div className="flex items-center" style={{ padding: '0 24px' }}>
                  <div style={{ width: '50px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <span className="text-[11px] text-slate-500 font-semibold">SEL</span>
                  </div>
                  {visibleColumns.libraryName && <div style={{ width: '40%' }} className="uppercase tracking-[0.5px] text-[13px] font-semibold text-[#475569]">Library Name</div>}
                  {visibleColumns.libraryId && <div style={{ width: '20%' }} className="uppercase tracking-[0.5px] text-[13px] font-semibold text-[#475569]">Library ID</div>}
                  {visibleColumns.statsCount && <div style={{ width: '12%' }} className="uppercase tracking-[0.5px] text-[13px] font-semibold text-[#475569]">Stats Count</div>}
                  {visibleColumns.lastUpdated && <div style={{ width: '18%' }} className="uppercase tracking-[0.5px] text-[13px] font-semibold text-[#475569]">Last Updated</div>}
                  {visibleColumns.monthlyData && <div style={{ width: '10%' }} className="uppercase tracking-[0.5px] text-[13px] font-semibold text-[#475569] text-center">Monthly Data</div>}
                </div>
              </div>

              {/* Table Rows */}
              {filteredAndSortedLibraries.map((library, index) => {
                const isExpanded = expandedLibraries.has(library.library_id);
                const hasStats = library.has_stats && library.monthly_data && library.monthly_data.length > 0;
                const isSelected = selectedLibraries.has(library.library_id);

                return (
                  <div key={library.library_id}>
                    <div
                      className="transition-all duration-150 cursor-pointer hover:translate-x-[2px]"
                      style={{ height: '64px', padding: '0 24px', borderBottom: '1px solid #f1f5f9', background: index % 2 === 0 ? '#ffffff' : '#fafbfc' }}
                      onClick={() => toggleLibraryExpansion(library.library_id)}
                    >
                      <div className="flex items-center h-full">
                        <div style={{ width: '50px' }} className="flex items-center justify-center">
                          <button onClick={e => toggleLibrarySelection(library.library_id, e)} className="p-1">
                            {isSelected ? <CheckSquare className="w-4 h-4 text-blue-600" /> : <Square className="w-4 h-4 text-slate-400" />}
                          </button>
                        </div>
                        {visibleColumns.libraryName && (
                          <div style={{ width: '40%' }}>
                            <div className="text-[15px] font-semibold text-[#1e293b] leading-tight">{library.library_name || `Library ${library.library_id}`}</div>
                          </div>
                        )}
                        {visibleColumns.libraryId && (
                          <div style={{ width: '20%' }}>
                            <span className="text-[13px] text-[#64748b] bg-[#f1f5f9] px-2 py-1 rounded" style={{ fontFamily: 'Monaco, Courier New, monospace' }}>
                              <span className="font-semibold mr-1">ID:</span>{library.library_id}
                            </span>
                          </div>
                        )}
                        {visibleColumns.statsCount && (
                          <div style={{ width: '12%' }}>
                            <span className={`text-[18px] font-bold ${(library.monthly_data?.length || 0) === 0 ? 'text-[#94a3b8]' : 'text-[#2563eb]'}`}>
                              {library.monthly_data?.length || 0}
                            </span>
                          </div>
                        )}
                        {visibleColumns.lastUpdated && (
                          <div style={{ width: '18%' }}>
                            {library.last_updated
                              ? <span className="text-[13px] text-[#64748b] font-medium">{new Date(library.last_updated).toLocaleDateString()}</span>
                              : <span className="text-[13px] text-[#cbd5e1] italic">N/A</span>}
                          </div>
                        )}
                        {visibleColumns.monthlyData && (
                          <div style={{ width: '10%' }} className="flex items-center justify-center">
                            <input type="checkbox" checked={hasStats} readOnly className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-0" />
                          </div>
                        )}
                      </div>
                    </div>

                    {isExpanded && hasStats && visibleColumns.monthlyData && (
                      <div className="relative" style={{ background: '#ffffff', borderRadius: '12px', padding: '24px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)', borderLeft: '4px solid #2563eb', margin: '12px 24px', animation: 'slideDown 0.3s ease' }}>
                        <button type="button" onClick={() => toggleLibraryExpansion(library.library_id)}
                          className="absolute" style={{ top: '24px', right: '24px', width: '32px', height: '32px', borderRadius: '6px', background: '#f1f5f9', color: '#64748b' }}>
                          <span className="text-[14px]">🔼</span>
                        </button>

                        <div className="relative">
                          <div className="flex items-center gap-3">
                            <span className="text-[24px]">📚</span>
                            <span className="text-[24px] font-bold text-[#1e293b]">{library.library_name || `Library ${library.library_id}`}</span>
                          </div>
                          <div className="mt-2">
                            <span className="text-[14px] text-[#64748b] bg-[#f1f5f9] px-3 py-1 rounded" style={{ fontFamily: 'Monaco, monospace' }}>
                              <span className="font-semibold mr-1">ID:</span>{library.library_id}
                            </span>
                          </div>
                          <div className="mt-5 flex items-center gap-6">
                            <div>
                              <div className="text-[32px] font-bold text-[#2563eb] leading-none">{library.monthly_data?.length || 0}</div>
                              <div className="text-[12px] text-[#64748b]">Data Points</div>
                            </div>
                            <div className="flex items-center gap-2 text-[14px] text-[#64748b]">
                              <span className="text-[16px]">📅</span>
                              <span className="font-semibold text-[#1e293b]">{library.last_updated ? new Date(library.last_updated).toLocaleDateString() : 'N/A'}</span>
                            </div>
                            <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-[12px] font-semibold ${hasStats ? 'bg-[#d1fae5] text-[#065f46]' : 'bg-[#e2e8f0] text-[#64748b]'}`}>
                              <span>✓</span><span>{hasStats ? 'Has Data' : 'No Data'}</span>
                            </div>
                          </div>
                        </div>

                        <div className="mt-6">
                          <div className="flex items-center justify-between text-white rounded-t-[12px]"
                            style={{ background: 'linear-gradient(90deg,#6366f1,#4f46e5)', padding: '16px 24px' }}>
                            <div className="flex items-center gap-3">
                              <span className="text-[20px]">📈</span>
                              <span className="text-[18px] font-bold">Monthly Performance Analytics</span>
                            </div>
                            <Button onClick={e => { e.stopPropagation(); toggleWatchTimeFormat(library.library_id); }}
                              className="h-[32px] px-[14px] rounded-[6px] text-[13px] font-medium inline-flex items-center gap-2 bg-white/20 hover:bg-white/30 text-white border border-white/30">
                              <Hash className="w-3 h-3" />
                              {watchTimeFormats[library.library_id] === 'hms' ? 'Minutes' : 'Formatted'}
                            </Button>
                          </div>
                          <div className="bg-white rounded-b-[12px] overflow-hidden">
                            <div className="sticky top-0" style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0', height: '44px' }}>
                              <div className="flex items-center" style={{ padding: '0 24px' }}>
                                <div className="uppercase tracking-[0.5px] text-[13px] font-semibold text-[#475569]" style={{ width: '40%' }}>Period</div>
                                <div className="uppercase tracking-[0.5px] text-[13px] font-semibold text-[#475569]" style={{ width: '30%' }}>Views</div>
                                <div className="uppercase tracking-[0.5px] text-[13px] font-semibold text-[#475569]" style={{ width: '30%' }}>Watch Time</div>
                              </div>
                            </div>
                            {library.monthly_data
                              .slice().sort((a, b) => a.year !== b.year ? b.year - a.year : b.month - a.month)
                              .map((monthData, i, arr) => (
                                <div key={`${monthData.year}-${monthData.month}`}
                                  style={{ height: '56px', padding: '0 24px', borderBottom: i === arr.length - 1 ? 'none' : '1px solid #f1f5f9' }}>
                                  <div className="flex items-center gap-4 h-full">
                                    <div style={{ width: '40%' }} className="flex items-center gap-2">
                                      <span style={{ color: '#6366f1' }}>📅</span>
                                      <span className="text-[15px] font-semibold text-[#1e293b]">{getMonthName(monthData.month)} {monthData.year}</span>
                                    </div>
                                    <div style={{ width: '30%' }} className="flex items-center gap-2">
                                      <span style={{ color: '#10b981' }}>👁️</span>
                                      <span className="text-[18px] font-bold text-[#1e293b]">{formatNumber(monthData.total_views)}</span>
                                    </div>
                                    <div style={{ width: '30%' }} className="flex items-center gap-2">
                                      <span style={{ color: '#f59e0b' }}>⏱️</span>
                                      <span className="text-[15px] font-semibold text-[#1e293b]">
                                        {formatWatchTime(monthData.total_watch_time_seconds, watchTimeFormats[library.library_id] || 'minutes')}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Export Confirmation Modal */}
      {showExportModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-8 max-w-md w-full mx-4">
            <div className="flex items-center justify-center mb-4">
              <Download className="h-12 w-12 text-emerald-500" />
            </div>
            <h3 className="text-xl font-semibold text-slate-900 text-center mb-2">Export to Excel</h3>
            <p className="text-sm text-slate-600 text-center mb-6">Choose which libraries to export:</p>
            <div className="space-y-3 mb-6">
              <div className="p-3 bg-slate-50 rounded-lg">
                <div className="text-sm font-medium text-slate-700">Total Libraries: {filteredAndSortedLibraries.length}</div>
                <div className="text-sm font-medium text-slate-700 mt-1">Selected: {selectedLibraries.size}</div>
              </div>
            </div>
            <div className="flex flex-col gap-3">
              <Button onClick={() => exportLibraries(false)} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white">
                Export All Libraries ({filteredAndSortedLibraries.length})
              </Button>
              <Button onClick={() => exportLibraries(true)} disabled={selectedLibraries.size === 0}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 disabled:cursor-not-allowed">
                Export Selected ({selectedLibraries.size})
              </Button>
              <Button onClick={() => setShowExportModal(false)} variant="outline" className="w-full">Cancel</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Libraries;
