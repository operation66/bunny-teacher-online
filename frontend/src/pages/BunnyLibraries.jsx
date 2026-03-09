import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { Alert, AlertDescription } from '../components/ui/alert';
import { 
  RefreshCw, 
  Search, 
  TrendingUp, 
  Database,
  BarChart3,
  CheckSquare,
  Square,
  Clock,
  Hash,
  X,
  CheckCircle,
  AlertCircle,
  Loader2,
  Eye
} from 'lucide-react';

// ─── Module-level caches (survive navigation, cleared on full page refresh) ───
// Libraries list — same data for all users, sourced from backend cache
const _librariesCache = {
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

// Stats cache — keyed by "month-year" so switching periods doesn't show stale data
const _statsCache = {
  data: {},       // { "1-2025": { libId: { views, ... }, ... } }
  fetchedAt: {},  // { "1-2025": timestamp }
  ttlMs: 10 * 60 * 1000,
  key(month, year) { return `${month}-${year}`; },
  get(month, year) {
    const k = this.key(month, year);
    if (!this.data[k] || !this.fetchedAt[k]) return null;
    if (Date.now() - this.fetchedAt[k] > this.ttlMs) return null;
    return this.data[k];
  },
  set(month, year, data) {
    const k = this.key(month, year);
    this.data[k] = data;
    this.fetchedAt[k] = Date.now();
  },
  merge(month, year, partial) {
    const k = this.key(month, year);
    this.data[k] = { ...(this.data[k] || {}), ...partial };
    this.fetchedAt[k] = Date.now();
  },
  clear() { this.data = {}; this.fetchedAt = {}; },
};

// Persist only UI preferences (not data) in localStorage
const PREFS_KEY = 'bunny_ui_prefs';
const loadPrefs = () => {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}'); } catch { return {}; }
};
const savePrefs = (prefs) => {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch {}
};

const BunnyLibraries = () => {
  const prefs = loadPrefs();

  const [libraries, setLibraries] = useState([]);
  const [libraryStats, setLibraryStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(false);
  const [selectedLibraries, setSelectedLibraries] = useState(new Set());
  const [selectedMonth, setSelectedMonth] = useState(prefs.month ?? new Date().getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(prefs.year ?? new Date().getFullYear());
  const [searchTerm, setSearchTerm] = useState('');
  const [sortOrder, setSortOrder] = useState('asc');
  const [message, setMessage] = useState({ text: '', type: '' });
  const [showRawNumbers, setShowRawNumbers] = useState(prefs.showRaw ?? false);
  const [showOnlyFetched, setShowOnlyFetched] = useState(false);
  const [showClearConfirmation, setShowClearConfirmation] = useState(false);

  const scrollRef = React.useRef(null);
  const [atTop, setAtTop] = useState(true);
  const [atBottom, setAtBottom] = useState(false);

  const [showStatusPopup, setShowStatusPopup] = useState(false);
  const [fetchStatus, setFetchStatus] = useState({
    isLoading: false, completed: [], failed: [], total: 0, currentLibrary: null
  });
  const [syncStatus, setSyncStatus] = useState({
    isLoading: false, completed: [], failed: [], total: 0
  });

  const months = [
    { value: 1, label: 'January' }, { value: 2, label: 'February' },
    { value: 3, label: 'March' }, { value: 4, label: 'April' },
    { value: 5, label: 'May' }, { value: 6, label: 'June' },
    { value: 7, label: 'July' }, { value: 8, label: 'August' },
    { value: 9, label: 'September' }, { value: 10, label: 'October' },
    { value: 11, label: 'November' }, { value: 12, label: 'December' }
  ];
  const years = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i);

  const showMessage = (text, type = 'success') => {
    setMessage({ text, type });
    setTimeout(() => setMessage({ text: '', type: '' }), 5000);
  };

  const handleScroll = (e) => {
    const el = e.currentTarget;
    setAtTop(el.scrollTop <= 0);
    setAtBottom(el.scrollTop + el.clientHeight >= el.scrollHeight - 1);
  };

  // ─── Persist UI preferences only (not data) ───────────────────────────────
  useEffect(() => {
    savePrefs({ month: selectedMonth, year: selectedYear, showRaw: showRawNumbers });
  }, [selectedMonth, selectedYear, showRawNumbers]);

  // ─── On mount ─────────────────────────────────────────────────────────────
  useEffect(() => {
    fetchLibraries(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── When period changes, load stats for new period from cache or backend ─
  useEffect(() => {
    const cached = _statsCache.get(selectedMonth, selectedYear);
    if (cached) {
      console.log(`[StatsCache] HIT for ${selectedMonth}-${selectedYear}`);
      setLibraryStats(cached);
    } else {
      // Clear displayed stats for old period, then load fresh
      setLibraryStats({});
      if (libraries.length > 0) {
        loadHistoricalStats(false);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMonth, selectedYear]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    setAtTop(el.scrollTop <= 0);
    setAtBottom(el.scrollTop + el.clientHeight >= el.scrollHeight - 1);
  }, [loading]);

  // ─── Load libraries list ──────────────────────────────────────────────────
  const fetchLibraries = async (forceRefresh = false) => {
    if (forceRefresh) {
      _librariesCache.clear();
      _statsCache.clear();
    }

    const cachedLibs = _librariesCache.get();
    if (cachedLibs && !forceRefresh) {
      console.log(`[LibCache] HIT — ${cachedLibs.length} libraries`);
      setLibraries(cachedLibs);
      setLoading(false);
      // Load stats for current period from cache or backend
      const cachedStats = _statsCache.get(selectedMonth, selectedYear);
      if (cachedStats) {
        setLibraryStats(cachedStats);
        showMessage(`Loaded ${cachedLibs.length} libraries from cache`);
      } else {
        showMessage(`Loaded ${cachedLibs.length} libraries — fetching stats...`, 'info');
        loadHistoricalStats(false);
      }
      return;
    }

    setLoading(true);
    try {
      const { data: baseData } = await api.get('/bunny-libraries/');
      const normalized = normalizeLibraries(baseData);
      _librariesCache.set(normalized);
      setLibraries(normalized);
      setLoading(false);
      showMessage(`Loaded ${normalized.length} libraries — fetching stats...`, 'info');
      loadHistoricalStats(false);
    } catch (error) {
      console.error('Error fetching libraries:', error);
      // Fallback to historical stats
      try {
        const { data } = await api.get('/historical-stats/libraries/', {
          params: { with_stats_only: true }
        });
        const normalized = normalizeLibraries(data);
        _librariesCache.set(normalized);
        setLibraries(normalized);
        const statsMap = buildStatsMap(data, selectedMonth, selectedYear);
        _statsCache.set(selectedMonth, selectedYear, statsMap);
        setLibraryStats(statsMap);
        showMessage(`Loaded ${normalized.length} libraries from historical stats`);
      } catch (fallbackErr) {
        showMessage('Failed to fetch libraries', 'error');
      } finally {
        setLoading(false);
      }
    }
  };

  // ─── Load historical stats (background, non-blocking) ────────────────────
  const loadHistoricalStats = async (forceRefresh = false) => {
    if (!forceRefresh) {
      const cached = _statsCache.get(selectedMonth, selectedYear);
      if (cached) {
        console.log(`[StatsCache] HIT for ${selectedMonth}-${selectedYear}`);
        setLibraryStats(cached);
        return;
      }
    }
    console.log(`[StatsCache] MISS for ${selectedMonth}-${selectedYear} — fetching`);
    setStatsLoading(true);
    try {
      const { data } = await api.get('/historical-stats/libraries/', {
        params: { with_stats_only: true }
      });
      const statsMap = buildStatsMap(data, selectedMonth, selectedYear);
      _statsCache.set(selectedMonth, selectedYear, statsMap);
      setLibraryStats(statsMap);
      const count = Object.keys(statsMap).length;
      if (count > 0) {
        showMessage(`Loaded stats for ${count} libraries`, 'success');
      }
    } catch (err) {
      console.warn('Failed to load historical stats (non-fatal):', err);
    } finally {
      setStatsLoading(false);
    }
  };

  // ─── Helpers ──────────────────────────────────────────────────────────────
  const normalizeLibraries = (data) => {
    const arr = Array.isArray(data) ? data : [];
    const normalized = arr.map(lib => ({
      id: lib.id ?? lib.library_id,
      name: lib.name ?? lib.library_name ?? `Library ${lib.id ?? lib.library_id}`,
      monthly_data: lib.monthly_data ?? [],
      last_updated: lib.last_updated ?? null,
    }));
    return Array.from(new Map(normalized.map(l => [l.id, l])).values());
  };

  const buildStatsMap = (data, month, year) => {
    const statsMap = {};
    (Array.isArray(data) ? data : []).forEach(lib => {
      const libId = lib.id ?? lib.library_id;
      const md = (lib.monthly_data || []).find(d => d.month === month && d.year === year);
      if (md && libId != null) {
        statsMap[libId] = {
          views: md.total_views ?? 0,
          total_watch_time_seconds: md.total_watch_time_seconds ?? 0,
          month: md.month,
          year: md.year,
          last_updated: lib.last_updated ?? null,
        };
      }
    });
    return statsMap;
  };

  // ─── Fetch stats for selected libraries (calls Bunny API) ─────────────────
  const fetchLibraryStats = async () => {
    if (selectedLibraries.size === 0) {
      showMessage('Please select at least one library', 'error');
      return;
    }

    setShowStatusPopup(true);
    setFetchStatus({ isLoading: true, completed: [], failed: [], total: selectedLibraries.size, currentLibrary: null });
    setSyncStatus({ isLoading: false, completed: [], failed: [], total: 0 });

    let configMap = new Map();
    try {
      const { data: configs } = await api.get('/library-configs/');
      configMap = new Map(configs.map(cfg => [cfg.library_id, cfg]));
    } catch (configError) {
      showMessage('Failed to check API configurations', 'error');
      setFetchStatus(prev => ({ ...prev, isLoading: false }));
      return;
    }

    const libraryIds = Array.from(selectedLibraries);
    const validLibraries = [];
    const unconfiguredLibraries = [];

    libraryIds.forEach(id => {
      const config = configMap.get(id);
      if (config?.stream_api_key) {
        validLibraries.push(id);
      } else {
        unconfiguredLibraries.push({
          library_id: id,
          library_name: libraries.find(lib => lib.id === id)?.name || `Library ${id}`,
          error: 'No API key configured. Please add API key in API Config page.'
        });
      }
    });

    if (unconfiguredLibraries.length > 0) {
      setFetchStatus(prev => ({ ...prev, failed: [...prev.failed, ...unconfiguredLibraries] }));
    }

    if (validLibraries.length > 0) {
      try {
        const { data } = await api.post('/historical-stats/batch-fetch/', {
          library_ids: validLibraries,
          month: selectedMonth,
          year: selectedYear
        });

        const successes = (data.results || []).filter(r => r.success);
        const failures = (data.results || []).filter(r => !r.success);

        // Update module-level stats cache with fresh data
        const freshStats = {};
        successes.forEach(r => {
          const d = r.data || {};
          freshStats[r.library_id] = {
            views: d.total_views ?? 0,
            total_watch_time_seconds: d.total_watch_time_seconds ?? 0,
            month: d.month ?? selectedMonth,
            year: d.year ?? selectedYear,
            last_updated: d.fetch_date ?? new Date().toISOString(),
          };
        });
        _statsCache.merge(selectedMonth, selectedYear, freshStats);
        setLibraryStats(prev => ({ ...prev, ...freshStats }));

        setFetchStatus(prev => ({
          ...prev,
          completed: successes.map(r => ({ library_id: r.library_id, library_name: r.library_name, message: r.message || 'Successfully fetched' })),
          failed: [...prev.failed, ...failures.map(r => ({ library_id: r.library_id, library_name: r.library_name, error: r.error || 'Failed' }))]
        }));

        const failCount = failures.length + unconfiguredLibraries.length;
        showMessage(
          `Updated stats for ${successes.length} libraries${failCount ? `, ${failCount} failed` : ''}`,
          failCount > 0 ? 'error' : 'success'
        );
      } catch (fetchError) {
        setFetchStatus(prev => ({
          ...prev,
          failed: [...prev.failed, ...validLibraries.map(id => ({
            library_id: id,
            library_name: libraries.find(lib => lib.id === id)?.name || `Library ${id}`,
            error: fetchError.response?.data?.detail || fetchError.message || 'Failed'
          }))]
        }));
        showMessage('Failed to fetch library statistics', 'error');
      }
    } else if (unconfiguredLibraries.length > 0) {
      showMessage('No libraries have API keys configured.', 'error');
    }

    setFetchStatus(prev => ({ ...prev, isLoading: false }));
  };

  const syncToLibrariesPage = async () => {
    const successfulFetches = fetchStatus.completed;
    if (successfulFetches.length === 0) { showMessage('No successful fetches to sync', 'error'); return; }

    setSyncStatus({ isLoading: true, completed: [], failed: [], total: successfulFetches.length });

    try {
      const { data: syncData } = await api.post('/historical-stats/sync/', {
        library_ids: successfulFetches.map(lib => lib.library_id),
        month: selectedMonth,
        year: selectedYear
      });

      const successResults = syncData.results.filter(r => r.success);
      const failureResults = syncData.results.filter(r => !r.success);

      setSyncStatus(prev => ({
        ...prev, isLoading: false,
        completed: successResults.map(r => ({ library_id: r.library_id, library_name: r.library_name, message: r.message || 'Synced' })),
        failed: failureResults.map(r => ({ library_id: r.library_id, library_name: r.library_name, error: r.error || 'Failed' }))
      }));

      // Invalidate historical stats backend cache so Libraries page picks up new data
      try { await api.post('/cache/clear-libraries'); } catch (_) {}

      if (typeof window !== 'undefined') window.dispatchEvent(new Event('teachers:updated'));
      showMessage(`Synced ${successResults.length} libraries${failureResults.length ? `, ${failureResults.length} failed` : ''}.`, failureResults.length > 0 ? 'error' : 'success');
    } catch (error) {
      setSyncStatus(prev => ({
        ...prev, isLoading: false,
        failed: successfulFetches.map(lib => ({ library_id: lib.library_id, library_name: lib.library_name, error: error.response?.data?.detail || error.message }))
      }));
      showMessage('Failed to sync to Libraries page', 'error');
    }
  };

  const closeStatusPopup = () => {
    const hadSync = syncStatus.completed.length > 0;
    setShowStatusPopup(false);
    setFetchStatus({ isLoading: false, completed: [], failed: [], total: 0, currentLibrary: null });
    setSyncStatus({ isLoading: false, completed: [], failed: [], total: 0 });
    if (hadSync) {
      // Reload stats after a successful sync so the table reflects latest data
      _statsCache.clear();
      loadHistoricalStats(true);
    }
  };

  const handleClearClick = () => setShowClearConfirmation(true);
  const confirmClear = () => {
    setSelectedLibraries(new Set());
    setLibraryStats({});
    _statsCache.clear();
    setShowClearConfirmation(false);
    showMessage('Cleared selected libraries and fetched stats');
  };

  const toggleLibrarySelection = (libraryId) => {
    setSelectedLibraries(prev => {
      const n = new Set(prev);
      n.has(libraryId) ? n.delete(libraryId) : n.add(libraryId);
      return n;
    });
  };

  const toggleSelectAll = () => {
    if (selectedLibraries.size > 0) setSelectedLibraries(new Set());
    else setSelectedLibraries(new Set(filteredAndSortedLibraries.map(lib => lib.id)));
  };

  const formatNumber = (num, forceRaw = false) => {
    if (showRawNumbers || forceRaw) return num?.toLocaleString() || '0';
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num?.toString() || '0';
  };

  const formatWatchTime = (seconds) => {
    if (!seconds || seconds === 0) return showRawNumbers ? '0:00:00' : '0 min';
    if (showRawNumbers) {
      const h = Math.floor(seconds / 3600);
      const m = Math.floor((seconds % 3600) / 60);
      const s = seconds % 60;
      return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    return `${Math.round(seconds / 60).toLocaleString()} min`;
  };

  const getStatisticsUrl = (libraryId, stats) => {
    if (!stats) return `https://dash.bunny.net/stream/${libraryId}/statistics`;
    const firstDay = `${stats.year}-${String(stats.month).padStart(2, '0')}-01`;
    const lastDay = new Date(stats.year, stats.month, 0).getDate();
    const lastDayFormatted = `${stats.year}-${String(stats.month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    return `https://dash.bunny.net/stream/${libraryId}/statistics?datePicker=${firstDay}&datePicker=${lastDayFormatted}`;
  };

  const filteredAndSortedLibraries = libraries
    .filter(library => {
      const matchesSearch = (library.name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
                            (library.id?.toString() || '').includes(searchTerm);
      if (showOnlyFetched) return matchesSearch && libraryStats[library.id] !== undefined;
      return matchesSearch;
    })
    .sort((a, b) => {
      const aName = (a.name || '').toLowerCase();
      const bName = (b.name || '').toLowerCase();
      if (sortOrder === 'asc') return aName < bName ? -1 : aName > bName ? 1 : 0;
      return aName > bName ? -1 : aName < bName ? 1 : 0;
    });

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Page Header */}
      <div className="space-y-3">
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-2">📊 Fetch Statistics Dashboard</h1>
            <p className="text-gray-600">Monitor and analyze data fetching performance</p>
          </div>
          <div className="flex items-center gap-2">
            {statsLoading && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-blue-50 text-blue-600 border border-blue-200">
                <RefreshCw className="w-3 h-3 animate-spin" />
                Loading stats...
              </span>
            )}
            <Button onClick={() => fetchLibraries(true)} disabled={loading || statsLoading} variant="outline">
              <RefreshCw className={`w-4 h-4 mr-2 ${(loading || statsLoading) ? 'animate-spin' : ''}`} />
              Refresh Libraries
            </Button>
          </div>
        </div>
      </div>

      {/* Statistics Controls */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5" />
            Fetch Statistics
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-4 items-end">
            <div className="flex-1">
              <label className="block text-sm font-medium mb-2">Month</label>
              <select value={selectedMonth} onChange={e => setSelectedMonth(parseInt(e.target.value))} className="w-full p-2 border rounded-md">
                {months.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-sm font-medium mb-2">Year</label>
              <select value={selectedYear} onChange={e => setSelectedYear(parseInt(e.target.value))} className="w-full p-2 border rounded-md">
                {years.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <Button onClick={fetchLibraryStats} disabled={loading || selectedLibraries.size === 0} className="px-6">
              <TrendingUp className={`w-4 h-4 mr-2 ${fetchStatus.isLoading ? 'animate-spin' : ''}`} />
              Fetch Stats ({selectedLibraries.size})
            </Button>
            <Button onClick={handleClearClick} variant="outline" className="px-6">
              <X className="w-4 h-4 mr-2" />
              Clear
            </Button>
          </div>
          {selectedLibraries.size > 0 && (
            <div className="text-sm text-gray-600">Selected {selectedLibraries.size} libraries for statistics fetching</div>
          )}
        </CardContent>
      </Card>

      {/* Message Alert */}
      {message.text && (
        <Alert className={message.type === 'error' ? 'border-red-500 bg-red-50' : 'border-green-500 bg-green-50'}>
          <AlertDescription className={message.type === 'error' ? 'text-red-700' : 'text-green-700'}>
            {message.text}
          </AlertDescription>
        </Alert>
      )}

      {/* Filters Panel */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex gap-4 items-center flex-wrap">
            <div className="flex-1 relative min-w-64">
              <Search className="w-4 h-4 absolute left-3 top-3 text-gray-400" />
              <Input placeholder="Search fetch records..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="pl-10" />
            </div>
            <Button variant={showOnlyFetched ? "default" : "outline"} onClick={() => setShowOnlyFetched(!showOnlyFetched)} className="flex items-center gap-2">
              <Database className="w-4 h-4" />
              {showOnlyFetched ? 'Show All' : 'Fetched Only'}
            </Button>
            <Button onClick={() => fetchLibraries(true)} disabled={loading || statsLoading} variant="outline" className="flex items-center gap-2">
              <RefreshCw className={`w-4 h-4 ${(loading || statsLoading) ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            <Button variant="outline" onClick={() => setSortOrder(v => v === 'asc' ? 'desc' : 'asc')}>
              {sortOrder === 'asc' ? '↑' : '↓'}
            </Button>
            <Button variant={showRawNumbers ? "default" : "outline"} onClick={() => setShowRawNumbers(!showRawNumbers)} className="flex items-center gap-2">
              <Hash className="w-4 h-4" />
              {showRawNumbers ? 'Formatted' : 'Raw Numbers'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Libraries Table */}
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <CardTitle className="flex items-center gap-2">
              <Database className="w-5 h-5" />
              Libraries ({filteredAndSortedLibraries.length})
              {statsLoading && <span className="text-xs font-normal text-blue-500 ml-2">— loading stats...</span>}
            </CardTitle>
            {filteredAndSortedLibraries.length > 0 && (
              <Button variant="outline" size="sm" onClick={toggleSelectAll}>
                {selectedLibraries.size > 0 ? <><CheckSquare className="w-4 h-4 mr-2" />Deselect All</> : <><Square className="w-4 h-4 mr-2" />Select All</>}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="overflow-hidden">
              <div ref={scrollRef} onScroll={handleScroll} className="virtual-scroll overflow-auto" style={{ maxHeight: '70vh' }}>
                {Array.from({ length: 10 }).map((_, i) => (
                  <div key={`skeleton-${i}`} className="shimmer-row" style={{ borderBottom: '1px solid #f1f5f9' }} />
                ))}
              </div>
            </div>
          ) : filteredAndSortedLibraries.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              {libraries.length === 0 ? 'No libraries found. Click "Refresh Libraries" to fetch data.' : 'No libraries match your search criteria.'}
            </div>
          ) : (
            <div ref={scrollRef} onScroll={handleScroll} className="virtual-scroll overflow-auto"
              style={{ maxHeight: '70vh', boxShadow: `${!atTop ? 'inset 0 8px 8px -8px rgba(0,0,0,0.1)' : ''}${(!atTop && !atBottom) ? ',' : ''}${!atBottom ? 'inset 0 -8px 8px -8px rgba(0,0,0,0.1)' : ''}` }}>
              {/* Stats loading bar */}
              {statsLoading && <div className="h-1 bg-blue-100"><div className="h-1 bg-blue-500 animate-pulse w-full" /></div>}
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b sticky top-0 bg-white z-10">
                    <th className="text-center p-2 w-[50px] sticky left-0 bg-[#fafafa] text-xs text-slate-500">#</th>
                    <th className="text-left p-2 text-xs">Select</th>
                    <th className="text-left p-2 text-xs">ID</th>
                    <th className="text-left p-2 text-xs">Name</th>
                    <th className="text-left p-2 text-xs">Views</th>
                    <th className="text-left p-2 text-xs">Watch Time</th>
                    <th className="text-left p-2 text-xs">Period</th>
                    <th className="text-left p-2 text-xs w-[80px]">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAndSortedLibraries.map((library, index) => {
                    const stats = libraryStats[library.id];
                    const isSelected = selectedLibraries.has(library.id);
                    const isCompleted = fetchStatus.completed.some(r => r.library_id === library.id);
                    const isFailed = fetchStatus.failed.some(r => r.library_id === library.id);
                    const rowStatus = isCompleted ? 'success' : isFailed ? 'failed' : (fetchStatus.isLoading && selectedLibraries.has(library.id) ? 'pending' : null);
                    const dotColor = rowStatus === 'success' ? '#10b981' : rowStatus === 'failed' ? '#ef4444' : rowStatus === 'pending' ? '#f59e0b' : '#cbd5e1';

                    return (
                      <tr key={library.id} className="border-b hover:bg-gray-50 group h-14 odd:bg-white even:bg-gray-50">
                        <td className="p-2 w-[50px] sticky left-0 bg-[#fafafa] text-center text-xs text-slate-400">
                          <span className="mr-1" style={{ color: dotColor }}>●</span>
                          {index + 1}
                        </td>
                        <td className="p-2">
                          <button onClick={() => toggleLibrarySelection(library.id)} className="p-1">
                            {isSelected ? <CheckSquare className="w-4 h-4 text-blue-600" /> : <Square className="w-4 h-4 text-gray-400" />}
                          </button>
                        </td>
                        <td className="p-2"><Badge variant="outline">{library.id}</Badge></td>
                        <td className="p-2 font-medium">{library.name}</td>
                        <td className="p-2">
                          {stats ? (
                            <div className="flex flex-col">
                              <span className="text-blue-600 font-medium">{formatNumber(stats.views)}</span>
                              {showRawNumbers && stats.views >= 1000 && <span className="text-xs text-gray-500">({formatNumber(stats.views, false)})</span>}
                            </div>
                          ) : (
                            <span className="text-gray-400">{statsLoading ? '…' : '-'}</span>
                          )}
                        </td>
                        <td className="p-2">
                          {stats ? (
                            <div className="flex items-center gap-1">
                              <Clock className="w-4 h-4 text-purple-600" />
                              <span className="text-purple-600 font-medium">{formatWatchTime(stats.total_watch_time_seconds)}</span>
                            </div>
                          ) : (
                            <span className="text-gray-400">{statsLoading ? '…' : '-'}</span>
                          )}
                        </td>
                        <td className="p-2">
                          {stats ? (
                            <span className="text-sm text-gray-600">{months.find(m => m.value === stats.month)?.label} {stats.year}</span>
                          ) : (
                            <span className="text-gray-400">-</span>
                          )}
                        </td>
                        <td className="p-2 w-[80px]">
                          <div className="flex gap-2 justify-end opacity-0 group-hover:opacity-100 transition">
                            <Button variant="outline" className="w-7 h-7 p-0 rounded hover:bg-slate-100"
                              onClick={() => window.open(getStatisticsUrl(library.id, stats), '_blank', 'noopener,noreferrer')}
                              title="View Statistics">
                              <Eye className="w-4 h-4 text-blue-600" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Clear Confirmation Modal */}
      {showClearConfirmation && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <div className="flex items-center justify-center mb-4"><AlertCircle className="h-12 w-12 text-amber-500" /></div>
            <h3 className="text-xl font-semibold text-slate-900 text-center mb-2">Clear Selected Libraries and Stats?</h3>
            <p className="text-sm text-slate-600 text-center mb-6">
              This will clear all selected libraries ({selectedLibraries.size}) and their fetched statistics. This action cannot be undone.
            </p>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setShowClearConfirmation(false)}>Cancel</Button>
              <Button className="flex-1 bg-red-600 hover:bg-red-700 text-white" onClick={confirmClear}>Yes, Clear</Button>
            </div>
          </div>
        </div>
      )}

      {/* Status Popup Modal */}
      {showStatusPopup && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold">Fetch & Sync Status</h2>
              <Button variant="ghost" size="sm" onClick={closeStatusPopup} className="p-1"><X className="w-4 h-4" /></Button>
            </div>

            {/* Fetch Status */}
            <div className="mb-6">
              <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                <TrendingUp className="w-5 h-5" />
                Fetch Statistics ({fetchStatus.completed.length + fetchStatus.failed.length}/{fetchStatus.total})
              </h3>
              {fetchStatus.isLoading && (
                <div className="flex items-center gap-2 text-blue-600 mb-3">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Fetching statistics from Bunny.net...</span>
                </div>
              )}
              {fetchStatus.completed.length > 0 && (
                <div className="mb-3">
                  <h4 className="font-medium text-green-600 mb-2 flex items-center gap-1">
                    <CheckCircle className="w-4 h-4" />Successfully Fetched ({fetchStatus.completed.length})
                  </h4>
                  <div className="space-y-1 max-h-32 overflow-y-auto">
                    {fetchStatus.completed.map(lib => (
                      <div key={`${lib.library_id}-done`} className="text-sm text-green-700 bg-green-50 p-2 rounded">
                        <strong>{lib.library_name}</strong> — {lib.message}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {fetchStatus.failed.length > 0 && (
                <div className="mb-3">
                  <h4 className="font-medium text-red-600 mb-2 flex items-center gap-1">
                    <AlertCircle className="w-4 h-4" />Failed to Fetch ({fetchStatus.failed.length})
                  </h4>
                  <div className="space-y-1 max-h-32 overflow-y-auto">
                    {fetchStatus.failed.map(lib => (
                      <div key={`${lib.library_id}-fail`} className="text-sm text-red-700 bg-red-50 p-2 rounded">
                        <strong>{lib.library_name}</strong> — {lib.error}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Sync Section */}
            {fetchStatus.completed.length > 0 && !fetchStatus.isLoading && (
              <div className="border-t pt-4">
                <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                  <RefreshCw className="w-5 h-5" />Sync to Libraries Page
                </h3>
                {!syncStatus.isLoading && syncStatus.completed.length === 0 && syncStatus.failed.length === 0 && (
                  <div className="mb-4">
                    <p className="text-gray-600 mb-3">Ready to sync {fetchStatus.completed.length} successfully fetched libraries.</p>
                    <Button onClick={syncToLibrariesPage} className="flex items-center gap-2">
                      <RefreshCw className="w-4 h-4" />Sync to Libraries Page
                    </Button>
                  </div>
                )}
                {syncStatus.isLoading && (
                  <div className="flex items-center gap-2 text-blue-600 mb-3">
                    <Loader2 className="w-4 h-4 animate-spin" /><span>Syncing...</span>
                  </div>
                )}
                {syncStatus.completed.length > 0 && (
                  <div className="mb-3">
                    <h4 className="font-medium text-green-600 mb-2 flex items-center gap-1">
                      <CheckCircle className="w-4 h-4" />Successfully Synced ({syncStatus.completed.length})
                    </h4>
                    <div className="space-y-1 max-h-32 overflow-y-auto">
                      {syncStatus.completed.map(lib => (
                        <div key={`${lib.library_id}-synced`} className="text-sm text-green-700 bg-green-50 p-2 rounded">
                          <strong>{lib.library_name}</strong> — {lib.message}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {syncStatus.failed.length > 0 && (
                  <div className="mb-3">
                    <h4 className="font-medium text-red-600 mb-2 flex items-center gap-1">
                      <AlertCircle className="w-4 h-4" />Failed to Sync ({syncStatus.failed.length})
                    </h4>
                    <div className="space-y-1 max-h-32 overflow-y-auto">
                      {syncStatus.failed.map(lib => (
                        <div key={`${lib.library_id}-syncfail`} className="text-sm text-red-700 bg-red-50 p-2 rounded">
                          <strong>{lib.library_name}</strong> — {lib.error}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {!syncStatus.isLoading && (syncStatus.completed.length > 0 || syncStatus.failed.length > 0) && (
                  <div className="mt-4 p-3 bg-gray-50 rounded">
                    <p className="font-medium">Sync Complete: {syncStatus.completed.length} successful, {syncStatus.failed.length} failed</p>
                    {syncStatus.completed.length > 0 && <p className="text-sm text-green-600 mt-1">Synced libraries are now available in the Libraries page.</p>}
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-end mt-6 pt-4 border-t">
              <Button onClick={closeStatusPopup} variant="outline">Close</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BunnyLibraries;
