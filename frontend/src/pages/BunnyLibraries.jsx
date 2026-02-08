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

const BunnyLibraries = () => {
  const [libraries, setLibraries] = useState([]);
  const [libraryStats, setLibraryStats] = useState({});
  const [loading, setLoading] = useState(false);
  const [selectedLibraries, setSelectedLibraries] = useState(new Set());
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [searchTerm, setSearchTerm] = useState('');
  const [sortOrder, setSortOrder] = useState('asc');
  const [message, setMessage] = useState({ text: '', type: '' });
  const [showRawNumbers, setShowRawNumbers] = useState(false);
  const [showOnlyFetched, setShowOnlyFetched] = useState(false);
  
  // NEW: Clear confirmation state
  const [showClearConfirmation, setShowClearConfirmation] = useState(false);

  const scrollRef = React.useRef(null);
  const [atTop, setAtTop] = useState(true);
  const [atBottom, setAtBottom] = useState(false);
  
  const [showStatusPopup, setShowStatusPopup] = useState(false);
  const [fetchStatus, setFetchStatus] = useState({
    isLoading: false,
    completed: [],
    failed: [],
    total: 0,
    currentLibrary: null
  });
  const [syncStatus, setSyncStatus] = useState({
    isLoading: false,
    completed: [],
    failed: [],
    total: 0
  });

  const months = [
    { value: 1, label: 'January' },
    { value: 2, label: 'February' },
    { value: 3, label: 'March' },
    { value: 4, label: 'April' },
    { value: 5, label: 'May' },
    { value: 6, label: 'June' },
    { value: 7, label: 'July' },
    { value: 8, label: 'August' },
    { value: 9, label: 'September' },
    { value: 10, label: 'October' },
    { value: 11, label: 'November' },
    { value: 12, label: 'December' }
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

  // Persistence keys
  const LIBRARIES_CACHE_KEY = 'bunny_libraries_cache';
  const CACHE_EXPIRY_KEY = 'bunny_libraries_cache_expiry';
  const CACHE_DURATION = 24 * 60 * 60 * 1000;
  const SELECTED_LIBS_KEY = 'bunny_selected_libraries';
  const SELECTED_MONTH_KEY = 'bunny_selected_month';
  const SELECTED_YEAR_KEY = 'bunny_selected_year';
  const LIBRARY_STATS_KEY = 'bunny_library_stats';
  const SHOW_RAW_KEY = 'bunny_show_raw_numbers';

  // Load persisted data
  useEffect(() => {
    try {
      const persistedSelected = JSON.parse(localStorage.getItem(SELECTED_LIBS_KEY) || '[]');
      if (Array.isArray(persistedSelected) && persistedSelected.length > 0) {
        setSelectedLibraries(new Set(persistedSelected));
      }
    } catch (_) {}

    try {
      const pm = parseInt(localStorage.getItem(SELECTED_MONTH_KEY));
      const py = parseInt(localStorage.getItem(SELECTED_YEAR_KEY));
      if (!isNaN(pm) && pm >= 1 && pm <= 12) setSelectedMonth(pm);
      if (!isNaN(py) && py > 2000) setSelectedYear(py);
    } catch (_) {}

    try {
      const statsStr = localStorage.getItem(LIBRARY_STATS_KEY);
      if (statsStr) {
        const persistedStats = JSON.parse(statsStr);
        if (persistedStats && typeof persistedStats === 'object') {
          setLibraryStats(persistedStats);
        }
      }
    } catch (_) {}

    try {
      const rawPref = localStorage.getItem(SHOW_RAW_KEY);
      if (rawPref === 'true' || rawPref === 'false') {
        setShowRawNumbers(rawPref === 'true');
      }
    } catch (_) {}
  }, []);

  // Persist changes
  useEffect(() => {
    try { localStorage.setItem(SELECTED_MONTH_KEY, selectedMonth.toString()); } catch (_) {}
  }, [selectedMonth]);

  useEffect(() => {
    try { localStorage.setItem(SELECTED_YEAR_KEY, selectedYear.toString()); } catch (_) {}
  }, [selectedYear]);

  useEffect(() => {
    try { localStorage.setItem(SELECTED_LIBS_KEY, JSON.stringify(Array.from(selectedLibraries))); } catch (_) {}
  }, [selectedLibraries]);

  useEffect(() => {
    try { localStorage.setItem(LIBRARY_STATS_KEY, JSON.stringify(libraryStats)); } catch (_) {}
  }, [libraryStats]);

  useEffect(() => {
    try { localStorage.setItem(SHOW_RAW_KEY, showRawNumbers ? 'true' : 'false'); } catch (_) {}
  }, [showRawNumbers]);

  const loadLibrariesFromCache = () => {
    try {
      const cachedData = localStorage.getItem(LIBRARIES_CACHE_KEY);
      const cacheExpiry = localStorage.getItem(CACHE_EXPIRY_KEY);
      
      if (cachedData && cacheExpiry) {
        const now = Date.now();
        if (now < parseInt(cacheExpiry)) {
          const cached = JSON.parse(cachedData);
          const normalized = (Array.isArray(cached) ? cached : []).map((lib) => ({
            id: lib.id ?? lib.library_id,
            name: lib.name ?? lib.library_name ?? `Library ${lib.id ?? lib.library_id}`,
            monthly_data: lib.monthly_data ?? [],
            last_updated: lib.last_updated ?? null,
          }));
          const uniqueById = Array.from(new Map(normalized.map(l => [l.id, l])).values());
          setLibraries(uniqueById);
          showMessage(`Loaded ${uniqueById.length} libraries from cache`);
          return true;
        } else {
          localStorage.removeItem(LIBRARIES_CACHE_KEY);
          localStorage.removeItem(CACHE_EXPIRY_KEY);
        }
      }
    } catch (error) {
      console.error('Error loading from cache:', error);
      localStorage.removeItem(LIBRARIES_CACHE_KEY);
      localStorage.removeItem(CACHE_EXPIRY_KEY);
    }
    return false;
  };

  const saveLibrariesToCache = (libraries) => {
    try {
      const expiry = Date.now() + CACHE_DURATION;
      localStorage.setItem(LIBRARIES_CACHE_KEY, JSON.stringify(libraries));
      localStorage.setItem(CACHE_EXPIRY_KEY, expiry.toString());
    } catch (error) {
      console.error('Error saving to cache:', error);
    }
  };

  const fetchLibraries = async (forceRefresh = false) => {
    if (!forceRefresh && loadLibrariesFromCache()) {
      return;
    }

    setLoading(true);
    try {
      const { data: baseData } = await api.get('/bunny-libraries/');
      const normalizedBase = (Array.isArray(baseData) ? baseData : []).map((lib) => ({
        id: lib.id ?? lib.library_id,
        name: lib.name ?? lib.library_name ?? `Library ${lib.id ?? lib.library_id}`,
        monthly_data: [],
        last_updated: null,
      }));
      const uniqueBase = Array.from(new Map(normalizedBase.map(l => [l.id, l])).values());
      setLibraries(uniqueBase);

      saveLibrariesToCache(uniqueBase);
      showMessage(`Loaded ${uniqueBase.length} libraries from Bunny.net`);

      try {
        const { data: histData } = await api.get('/historical-stats/libraries/?with_stats_only=true');
        const statsMap = {};
        (Array.isArray(histData) ? histData : []).forEach((lib) => {
          const libId = lib.id ?? lib.library_id;
          const md = (lib.monthly_data || []).find(
            (d) => d.month === selectedMonth && d.year === selectedYear
          );
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
        setLibraryStats(prev => ({ ...prev, ...statsMap }));
      } catch (innerErr) {
        console.warn('Unable to load synced historical stats:', innerErr);
      }

    } catch (error) {
      console.error('Error fetching libraries:', error);
      try {
        const { data } = await api.get('/historical-stats/libraries/?with_stats_only=true');
        const normalized = (Array.isArray(data) ? data : []).map((lib) => ({
          id: lib.id ?? lib.library_id,
          name: lib.name ?? lib.library_name ?? `Library ${lib.id ?? lib.library_id}`,
          monthly_data: lib.monthly_data ?? [],
          last_updated: lib.last_updated ?? null,
        }));
        const uniqueById = Array.from(new Map(normalized.map(l => [l.id, l])).values());
        setLibraries(uniqueById);

        const statsMap = {};
        normalized.forEach((lib) => {
          const md = (lib.monthly_data || []).find(
            (d) => d.month === selectedMonth && d.year === selectedYear
          );
          if (md) {
            statsMap[lib.id] = {
              views: md.total_views ?? 0,
              total_watch_time_seconds: md.total_watch_time_seconds ?? 0,
              month: md.month,
              year: md.year,
              last_updated: lib.last_updated,
            };
          }
        });
        setLibraryStats(statsMap);
        saveLibrariesToCache(uniqueById);
        showMessage(`Fetched ${uniqueById.length} synced libraries from history`);
      } catch (fallbackErr) {
        console.error('Fallback error fetching libraries:', fallbackErr);
        showMessage('Failed to fetch libraries', 'error');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const statsMap = {};
    libraries.forEach((lib) => {
      const md = (lib.monthly_data || []).find(
        (d) => d.month === selectedMonth && d.year === selectedYear
      );
      if (md) {
        statsMap[lib.id] = {
          views: md.total_views ?? 0,
          total_watch_time_seconds: md.total_watch_time_seconds ?? 0,
          month: md.month,
          year: md.year,
          last_updated: lib.last_updated,
        };
      }
    });
    setLibraryStats(prev => ({ ...prev, ...statsMap }));
  }, [libraries, selectedMonth, selectedYear]);

  const fetchLibraryStats = async () => {
    if (selectedLibraries.size === 0) {
      showMessage('Please select at least one library', 'error');
      return;
    }

    setShowStatusPopup(true);
    setFetchStatus({
      isLoading: true,
      completed: [],
      failed: [],
      total: selectedLibraries.size,
      currentLibrary: null
    });
    setSyncStatus({
      isLoading: false,
      completed: [],
      failed: [],
      total: 0
    });

    let configMap = new Map();

    try {
      const { data: configs } = await api.get('/library-configs/');
      configMap = new Map(configs.map(cfg => [cfg.library_id, cfg]));
    } catch (configError) {
      console.error('Error fetching library configurations:', configError);
      showMessage('Failed to check API configurations', 'error');
      setFetchStatus(prev => ({
        ...prev,
        isLoading: false
      }));
      return;
    }

    const libraryIds = Array.from(selectedLibraries);
    const validLibraries = [];
    const unconfiguredLibraries = [];

    libraryIds.forEach(id => {
      const config = configMap.get(id);
      if (config && config.stream_api_key) {
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
      setFetchStatus(prev => ({
        ...prev,
        failed: [...prev.failed, ...unconfiguredLibraries]
      }));
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

        setLibraryStats(prev => {
          const updated = { ...prev };
          successes.forEach(r => {
            const d = r.data || {};
            updated[r.library_id] = {
              views: d.total_views ?? 0,
              total_watch_time_seconds: d.total_watch_time_seconds ?? 0,
              month: d.month ?? selectedMonth,
              year: d.year ?? selectedYear,
              last_updated: d.fetch_date ?? new Date().toISOString(),
            };
          });
          return updated;
        });

        setFetchStatus(prev => ({
          ...prev,
          completed: successes.map(r => ({
            library_id: r.library_id,
            library_name: r.library_name,
            message: r.message || 'Successfully fetched statistics',
          })),
          failed: [
            ...prev.failed,
            ...failures.map(r => ({
              library_id: r.library_id,
              library_name: r.library_name,
              error: r.error || 'Failed to fetch statistics',
            }))
          ]
        }));

        const successCount = successes.length;
        const failCount = failures.length + unconfiguredLibraries.length;
        const unconfiguredMsg = unconfiguredLibraries.length > 0 
          ? ` (${unconfiguredLibraries.length} libraries need API keys)` 
          : '';
        
        showMessage(
          `Updated stats for ${successCount} libraries${failCount ? `, ${failCount} failed` : ''}${unconfiguredMsg}`,
          failCount > 0 ? 'error' : 'success'
        );
      } catch (fetchError) {
        console.error('Error fetching library stats:', fetchError);
        setFetchStatus(prev => ({
          ...prev,
          failed: [
            ...prev.failed,
            ...validLibraries.map(id => ({
              library_id: id,
              library_name: libraries.find(lib => lib.id === id)?.name || `Library ${id}`,
              error: fetchError.response?.data?.detail || fetchError.message || 'Failed to fetch statistics'
            }))
          ]
        }));
        showMessage('Failed to fetch library statistics', 'error');
      }
    } else if (unconfiguredLibraries.length > 0) {
      showMessage('No libraries have API keys configured. Please configure API keys in API Config page.', 'error');
    }

    setFetchStatus(prev => ({ ...prev, isLoading: false }));
  };
  
  const syncToLibrariesPage = async () => {
    const successfulFetches = fetchStatus.completed;
    if (successfulFetches.length === 0) {
      showMessage('No successful fetches to sync', 'error');
      return;
    }

    setSyncStatus({
      isLoading: true,
      completed: [],
      failed: [],
      total: successfulFetches.length
    });

    let syncData;
    try {
      const { data } = await api.post('/historical-stats/sync/', {
        library_ids: successfulFetches.map(lib => lib.library_id),
        month: selectedMonth,
        year: selectedYear
      });
      syncData = data;
    } catch (error) {
      console.error('Error syncing to Libraries page:', error);
      setSyncStatus(prev => ({
        ...prev,
        isLoading: false,
        failed: successfulFetches.map(lib => ({
          library_id: lib.library_id,
          library_name: lib.library_name,
          error: error.response?.data?.detail || error.message || 'Failed to sync to Libraries page'
        }))
      }));
      showMessage('Failed to sync to Libraries page', 'error');
      return;
    }

    const successResults = syncData.results.filter(r => r.success);
    const failureResults = syncData.results.filter(r => !r.success);

    setSyncStatus(prev => ({
      ...prev,
      isLoading: false,
      completed: successResults.map(r => ({
        library_id: r.library_id,
        library_name: r.library_name,
        message: r.message || 'Successfully synced'
      })),
      failed: failureResults.map(r => ({
        library_id: r.library_id,
        library_name: r.library_name,
        error: r.error || 'Failed to sync'
      }))
    }));

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('teachers:updated'));
    }

    const successCount = successResults.length;
    const failCount = failureResults.length;
    
    showMessage(
      `Synced ${successCount} libraries${failCount ? `, ${failCount} failed` : ''}. Review on Libraries page.`,
      failCount > 0 ? 'error' : 'success'
    );
  };

  const closeStatusPopup = () => {
    const hadFetchCompleted = Array.isArray(fetchStatus?.completed) && fetchStatus.completed.length > 0;
    const hadSyncCompleted = Array.isArray(syncStatus?.completed) && syncStatus.completed.length > 0;
    setShowStatusPopup(false);
    setFetchStatus({
      isLoading: false,
      completed: [],
      failed: [],
      total: 0,
      currentLibrary: null
    });
    setSyncStatus({
      isLoading: false,
      completed: [],
      failed: [],
      total: 0
    });
    
    try {
      if (hadFetchCompleted && hadSyncCompleted) {
        fetchLibraries(true);
      }
    } catch (_) {}
  };

  // EDIT 6: Clear with confirmation
  const handleClearClick = () => {
    setShowClearConfirmation(true);
  };

  const confirmClear = () => {
    try {
      localStorage.removeItem(SELECTED_LIBS_KEY);
      localStorage.removeItem(LIBRARY_STATS_KEY);
    } catch (_) {}
    setSelectedLibraries(new Set());
    setLibraryStats({});
    setShowClearConfirmation(false);
    showMessage('Cleared selected libraries and fetched stats');
  };

  const toggleLibrarySelection = (libraryId) => {
    const newSelected = new Set(selectedLibraries);
    if (newSelected.has(libraryId)) {
      newSelected.delete(libraryId);
    } else {
      newSelected.add(libraryId);
    }
    setSelectedLibraries(newSelected);
  };

  // EDIT 3: Fixed Select All - shows "Deselect All" when ANY library selected
  const toggleSelectAll = () => {
    if (selectedLibraries.size > 0) {
      setSelectedLibraries(new Set());
    } else {
      setSelectedLibraries(new Set(filteredAndSortedLibraries.map(lib => lib.id)));
    }
  };

  const formatNumber = (num, forceRaw = false) => {
    if (showRawNumbers || forceRaw) {
      return num?.toLocaleString() || '0';
    }
    
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1) + 'M';
    } else if (num >= 1000) {
      return (num / 1000).toFixed(1) + 'K';
    }
    return num?.toString() || '0';
  };

  // EDIT 4: Watch time format - Minutes when Formatted, HH:MM:SS when Raw
  const formatWatchTime = (seconds) => {
    if (!seconds || seconds === 0) return showRawNumbers ? '0:00:00' : '0 min';
    
    if (showRawNumbers) {
      // Raw format: HH:MM:SS
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      const secs = seconds % 60;
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    } else {
      // Formatted: Total minutes
      const totalMinutes = Math.round(seconds / 60);
      return `${totalMinutes.toLocaleString()} min`;
    }
  };

  // EDIT 4C: Get statistics URL with date range
  const getStatisticsUrl = (libraryId, stats) => {
    if (!stats) return `https://dash.bunny.net/stream/${libraryId}/statistics`;
    
    const year = stats.year;
    const month = stats.month;
    
    // Get first and last day of month
    const firstDay = `${year}-${String(month).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const lastDayFormatted = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    
    return `https://dash.bunny.net/stream/${libraryId}/statistics?datePicker=${firstDay}&datePicker=${lastDayFormatted}`;
  };

  const filteredAndSortedLibraries = libraries
    .filter(library => {
      const nameLower = (library.name || '').toLowerCase();
      const matchesSearch = (
        nameLower.includes(searchTerm.toLowerCase()) ||
        (library.id?.toString() || '').includes(searchTerm)
      );
      
      if (showOnlyFetched) {
        return matchesSearch && libraryStats[library.id] !== undefined;
      }
      
      return matchesSearch;
    })
    .sort((a, b) => {
      const aName = (a.name || '').toLowerCase();
      const bName = (b.name || '').toLowerCase();
      
      if (sortOrder === 'asc') {
        return aName < bName ? -1 : aName > bName ? 1 : 0;
      } else {
        return aName > bName ? -1 : aName < bName ? 1 : 0;
      }
    });

  useEffect(() => {
    fetchLibraries();
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    setAtTop(el.scrollTop <= 0);
    setAtBottom(el.scrollTop + el.clientHeight >= el.scrollHeight - 1);
  }, [loading]);

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Page Header */}
      <div className="space-y-3">
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-2">📊 Fetch Statistics Dashboard</h1>
            <p className="text-gray-600">Monitor and analyze data fetching performance</p>
          </div>
          <div className="flex gap-2">
            <Button 
              onClick={() => fetchLibraries(true)} 
              disabled={loading}
              variant="outline"
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
              Refresh Libraries
            </Button>
          </div>
        </div>
        
        {/* EDIT 1: REMOVED 3 STATUS CARDS */}
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
              <select 
                value={selectedMonth} 
                onChange={(e) => setSelectedMonth(parseInt(e.target.value))}
                className="w-full p-2 border rounded-md"
              >
                {months.map(month => (
                  <option key={month.value} value={month.value}>
                    {month.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-sm font-medium mb-2">Year</label>
              <select 
                value={selectedYear} 
                onChange={(e) => setSelectedYear(parseInt(e.target.value))}
                className="w-full p-2 border rounded-md"
              >
                {years.map(year => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </div>
            <Button 
              onClick={fetchLibraryStats} 
              disabled={loading || selectedLibraries.size === 0}
              className="px-6"
            >
              <TrendingUp className={`w-4 h-4 mr-2 ${fetchStatus.isLoading ? 'animate-spin' : ''}`} />
              Fetch Stats ({selectedLibraries.size})
            </Button>
            <Button 
              onClick={handleClearClick}
              variant="outline"
              className="px-6"
            >
              <X className="w-4 h-4 mr-2" />
              Clear
            </Button>
          </div>
          
          {selectedLibraries.size > 0 && (
            <div className="text-sm text-gray-600">
              Selected {selectedLibraries.size} libraries for statistics fetching
            </div>
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

      {/* EDIT 2: Cleaned up Filters Panel - removed Status, Date, Sort dropdowns */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex gap-4 items-center flex-wrap">
            {/* Search */}
            <div className="flex-1 relative min-w-64">
              <Search className="w-4 h-4 absolute left-3 top-3 text-gray-400" />
              <Input
                placeholder="Search fetch records..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>

            {/* Fetched Only */}
            <Button
              variant={showOnlyFetched ? "default" : "outline"}
              onClick={() => setShowOnlyFetched(!showOnlyFetched)}
              className="flex items-center gap-2"
            >
              <Database className="w-4 h-4" />
              {showOnlyFetched ? 'Show All' : 'Fetched Only'}
            </Button>

            {/* Refresh */}
            <Button 
              onClick={() => fetchLibraries(true)} 
              disabled={loading}
              variant="outline"
              className="flex items-center gap-2"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>

            {/* Sort Order */}
            <Button
              variant="outline"
              onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
            >
              {sortOrder === 'asc' ? '↑' : '↓'}
            </Button>
            
            {/* Raw/Formatted Toggle */}
            <Button
              variant={showRawNumbers ? "default" : "outline"}
              onClick={() => setShowRawNumbers(!showRawNumbers)}
              className="flex items-center gap-2"
            >
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
            </CardTitle>
            {filteredAndSortedLibraries.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={toggleSelectAll}
              >
                {selectedLibraries.size > 0 ? (
                  <>
                    <CheckSquare className="w-4 h-4 mr-2" />
                    Deselect All
                  </>
                ) : (
                  <>
                    <Square className="w-4 h-4 mr-2" />
                    Select All
                  </>
                )}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="bg-white rounded-[12px] overflow-hidden">
              <div
                ref={scrollRef}
                onScroll={handleScroll}
                className="virtual-scroll overflow-auto"
                style={{
                  maxHeight: '70vh',
                  boxShadow: `${!atTop ? 'inset 0 8px 8px -8px rgba(0,0,0,0.1)' : ''}${(!atTop && !atBottom) ? ',' : ''}${!atBottom ? 'inset 0 -8px 8px -8px rgba(0,0,0,0.1)' : ''}`
                }}
              >
                {Array.from({ length: 10 }).map((_, i) => (
                  <div
                    key={`skeleton-${i}`}
                    className="shimmer-row"
                    style={{ borderBottom: '1px solid #f1f5f9' }}
                  ></div>
                ))}
              </div>
            </div>
          ) : filteredAndSortedLibraries.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              {libraries.length === 0 ? 'No libraries found. Click "Refresh Libraries" to fetch data.' : 'No libraries match your search criteria.'}
            </div>
          ) : (
            <div
              ref={scrollRef}
              onScroll={handleScroll}
              className="virtual-scroll overflow-auto"
              style={{
                maxHeight: '70vh',
                boxShadow: `${!atTop ? 'inset 0 8px 8px -8px rgba(0,0,0,0.1)' : ''}${(!atTop && !atBottom) ? ',' : ''}${!atBottom ? 'inset 0 -8px 8px -8px rgba(0,0,0,0.1)' : ''}`
              }}
            >
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
                    {/* EDIT 4B: REMOVED Last Updated column */}
                    <th className="text-left p-2 text-xs w-[80px]">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAndSortedLibraries.map((library, index) => {
                    const stats = libraryStats[library.id];
                    const isSelected = selectedLibraries.has(library.id);
                    const isCompleted = fetchStatus.completed.some(r => r.library_id === library.id);
                    const isFailed = fetchStatus.failed.some(r => r.library_id === library.id);
                    const rowStatus = isCompleted ? 'success' : (isFailed ? 'failed' : (fetchStatus.isLoading && selectedLibraries.has(library.id) ? 'pending' : null));
                    const dotColor = rowStatus === 'success' ? '#10b981' : (rowStatus === 'failed' ? '#ef4444' : (rowStatus === 'pending' ? '#f59e0b' : '#cbd5e1'));
                    
                    return (
                      <tr key={library.id} className="border-b hover:bg-gray-50 group h-14 odd:bg-white even:bg-gray-50">
                        <td className="p-2 w-[50px] sticky left-0 bg-[#fafafa] text-center text-xs text-slate-400">
                          <span className="mr-1" style={{ color: dotColor }}>●</span>
                          {index + 1}
                        </td>
                        <td className="p-2">
                          <button
                            onClick={() => toggleLibrarySelection(library.id)}
                            className="p-1"
                          >
                            {isSelected ? (
                              <CheckSquare className="w-4 h-4 text-blue-600" />
                            ) : (
                              <Square className="w-4 h-4 text-gray-400" />
                            )}
                          </button>
                        </td>
                        <td className="p-2">
                          <Badge variant="outline">{library.id}</Badge>
                        </td>
                        <td className="p-2 font-medium">{library.name}</td>
                        <td className="p-2">
                          {stats ? (
                            <div className="flex flex-col">
                              <span className="text-blue-600 font-medium">
                                {formatNumber(stats.views)}
                              </span>
                              {showRawNumbers && stats.views >= 1000 && (
                                <span className="text-xs text-gray-500">
                                  ({formatNumber(stats.views, false)})
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-gray-400">-</span>
                          )}
                        </td>
                        <td className="p-2">
                          {stats ? (
                            <div className="flex items-center gap-1">
                              <Clock className="w-4 h-4 text-purple-600" />
                              <span className="text-purple-600 font-medium">
                                {formatWatchTime(stats.total_watch_time_seconds)}
                              </span>
                            </div>
                          ) : (
                            <span className="text-gray-400">-</span>
                          )}
                        </td>
                        <td className="p-2">
                          {stats ? (
                            <span className="text-sm text-gray-600">
                              {months.find(m => m.value === stats.month)?.label} {stats.year}
                            </span>
                          ) : (
                            <span className="text-gray-400">-</span>
                          )}
                        </td>
                        {/* EDIT 4B: REMOVED Last Updated column */}
                        <td className="p-2 w-[80px]">
                          {/* EDIT 4C: Only Eye button, routes to statistics page with date range */}
                          <div className="flex gap-2 justify-end opacity-0 group-hover:opacity-100 transition">
                            <Button
                              variant="outline"
                              className="w-7 h-7 p-0 rounded hover:bg-slate-100"
                              onClick={() => window.open(getStatisticsUrl(library.id, stats), '_blank', 'noopener,noreferrer')}
                              title="View Statistics"
                            >
                              <Eye className="w-4 h-4" />
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
      
      {/* EDIT 5: REMOVED Data Accuracy Information Card */}

      {/* EDIT 6: Clear Confirmation Modal */}
      {showClearConfirmation && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <div className="flex items-center justify-center mb-4">
              <AlertCircle className="h-12 w-12 text-amber-500" />
            </div>
            <h3 className="text-xl font-semibold text-slate-900 text-center mb-2">
              Clear Selected Libraries and Stats?
            </h3>
            <p className="text-sm text-slate-600 text-center mb-6">
              This will clear all selected libraries ({selectedLibraries.size}) and their fetched statistics. This action cannot be undone.
            </p>

            <div className="flex gap-3">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setShowClearConfirmation(false)}
              >
                Cancel
              </Button>
              <Button
                className="flex-1 bg-red-600 hover:bg-red-700 text-white"
                onClick={confirmClear}
              >
                Yes, Clear
              </Button>
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
              <Button
                variant="ghost"
                size="sm"
                onClick={closeStatusPopup}
                className="p-1"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>

            {/* Fetch Status Section */}
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
                    <CheckCircle className="w-4 h-4" />
                    Successfully Fetched ({fetchStatus.completed.length})
                  </h4>
                  <div className="space-y-1 max-h-32 overflow-y-auto">
                    {fetchStatus.completed.map((lib) => (
                      <div key={`${lib.library_id}-${lib.message || 'completed'}`} className="text-sm text-green-700 bg-green-50 p-2 rounded">
                        <strong>{lib.library_name}</strong> - {lib.message}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {fetchStatus.failed.length > 0 && (
                <div className="mb-3">
                  <h4 className="font-medium text-red-600 mb-2 flex items-center gap-1">
                    <AlertCircle className="w-4 h-4" />
                    Failed to Fetch ({fetchStatus.failed.length})
                  </h4>
                  <div className="space-y-1 max-h-32 overflow-y-auto">
                    {fetchStatus.failed.map((lib) => (
                      <div key={`${lib.library_id}-${lib.error || 'failed'}`} className="text-sm text-red-700 bg-red-50 p-2 rounded">
                        <strong>{lib.library_name}</strong> - {lib.error}
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
                  <RefreshCw className="w-5 h-5" />
                  Sync to Libraries Page
                </h3>
                
                {!syncStatus.isLoading && syncStatus.completed.length === 0 && syncStatus.failed.length === 0 && (
                  <div className="mb-4">
                    <p className="text-gray-600 mb-3">
                      Ready to sync {fetchStatus.completed.length} successfully fetched libraries to the Libraries page.
                    </p>
                    <Button
                      onClick={syncToLibrariesPage}
                      className="flex items-center gap-2"
                    >
                      <RefreshCw className="w-4 h-4" />
                      Sync to Libraries Page
                    </Button>
                  </div>
                )}

                {syncStatus.isLoading && (
                  <div className="flex items-center gap-2 text-blue-600 mb-3">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Syncing to Libraries page...</span>
                  </div>
                )}

                {syncStatus.completed.length > 0 && (
                  <div className="mb-3">
                    <h4 className="font-medium text-green-600 mb-2 flex items-center gap-1">
                      <CheckCircle className="w-4 h-4" />
                      Successfully Synced ({syncStatus.completed.length})
                    </h4>
                    <div className="space-y-1 max-h-32 overflow-y-auto">
                      {syncStatus.completed.map((lib) => (
                        <div key={`${lib.library_id}-${lib.message || 'synced'}`} className="text-sm text-green-700 bg-green-50 p-2 rounded">
                          <strong>{lib.library_name}</strong> - {lib.message}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {syncStatus.failed.length > 0 && (
                  <div className="mb-3">
                    <h4 className="font-medium text-red-600 mb-2 flex items-center gap-1">
                      <AlertCircle className="w-4 h-4" />
                      Failed to Sync ({syncStatus.failed.length})
                    </h4>
                    <div className="space-y-1 max-h-32 overflow-y-auto">
                      {syncStatus.failed.map((lib) => (
                        <div key={`${lib.library_id}-${lib.error || 'sync_failed'}`} className="text-sm text-red-700 bg-red-50 p-2 rounded">
                          <strong>{lib.library_name}</strong> - {lib.error}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {!syncStatus.isLoading && (syncStatus.completed.length > 0 || syncStatus.failed.length > 0) && (
                  <div className="mt-4 p-3 bg-gray-50 rounded">
                    <p className="font-medium">
                      Sync Complete: {syncStatus.completed.length} successful, {syncStatus.failed.length} failed
                    </p>
                    {syncStatus.completed.length > 0 && (
                      <p className="text-sm text-green-600 mt-1">
                        Successfully synced libraries are now available in the Libraries page.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-end mt-6 pt-4 border-t">
              <Button onClick={closeStatusPopup} variant="outline">
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BunnyLibraries;
