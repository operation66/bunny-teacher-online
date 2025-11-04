import React, { useState, useEffect, useRef } from 'react';
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
  Settings,
  CheckCircle,
  XCircle,
  Eye,
  EyeOff,
  Search,
  ChevronDown,
  ChevronRight
} from 'lucide-react';

const LibraryConfig = () => {
  const [configs, setConfigs] = useState([]);
  const [filteredConfigs, setFilteredConfigs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState({});
  const [message, setMessage] = useState({ type: '', text: '' });
  const [showApiKeys, setShowApiKeys] = useState({});
  const [searchTerm, setSearchTerm] = useState('');
  const [pendingChanges, setPendingChanges] = useState({});
  // UI-only states for new visuals
  const [expandedId, setExpandedId] = useState(null);
  const [activeOnly, setActiveOnly] = useState(false);
  const [typeFilter, setTypeFilter] = useState('All Configs');
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const scrollRef = useRef(null);
  const [atTop, setAtTop] = useState(true);
  const [atBottom, setAtBottom] = useState(false);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const t = el.scrollTop;
    const max = el.scrollHeight - el.clientHeight;
    setAtTop(t <= 0);
    setAtBottom(t >= max - 1);
  };

  useEffect(() => {
    fetchConfigs();
  }, []);

  useEffect(() => {
    // Filter configs based on search term and Active Only checkbox
    let filtered = configs.filter(config => 
      config.library_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      config.library_id.toString().includes(searchTerm)
    );
    if (activeOnly) {
      // Active means API key is present
      filtered = filtered.filter(cfg => !!(cfg.stream_api_key && String(cfg.stream_api_key).trim().length > 0));
    }
    setFilteredConfigs(filtered);
  }, [configs, searchTerm, activeOnly]);

  const fetchConfigs = async () => {
    setLoading(true);
    setMessage({ type: '', text: '' });
    
    try {
      // First, ensure configs are synced with live Bunny libraries
      try {
        const syncResp = await fetch('/api/library-configs/sync-from-bunny/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });
        if (syncResp.ok) {
          const syncData = await syncResp.json();
          // Show a concise sync summary without blocking the fetch
          setMessage({
            type: 'success',
            text: `Sync done: created ${syncData.created || 0}, updated ${syncData.updated || 0}`
          });
        }
      } catch (syncErr) {
        // Do not block loading configs if sync fails; just log and proceed
        console.warn('Sync from Bunny failed, proceeding to load existing configs:', syncErr);
      }

      // Get authoritative list of live Bunny libraries
      let liveIds = [];
      try {
        const { data: liveData } = await api.get('/bunny-libraries/');
        liveIds = (Array.isArray(liveData) ? liveData : []).map(l => l.id ?? l.library_id).filter(id => id != null);
      } catch (liveErr) {
        console.warn('Failed to fetch live Bunny libraries; falling back to existing configs only:', liveErr);
      }

      const { data } = await api.get('/library-configs/');
      const filtered = liveIds.length > 0
        ? data.filter(cfg => liveIds.includes(cfg.library_id))
        : data;
      setConfigs(filtered);
      setMessage({ 
        type: 'success', 
        text: `Loaded ${filtered.length} library configurations` 
      });

      // Notify other pages that library configs were refreshed
      try {
        const event = new CustomEvent('library-configs:updated', { detail: { count: filtered.length } });
        window.dispatchEvent(event);
      } catch (e) {
        // noop
      }
    } catch (error) {
      console.error('Error fetching configs:', error);
      setMessage({ 
        type: 'error', 
        text: `Failed to fetch configurations: ${error.message}` 
      });
    } finally {
      setLoading(false);
    }
  };

  // Sync from Bunny removed; use Refresh to fetch configs

  const saveConfig = async (libraryId) => {
    const changes = pendingChanges[libraryId];
    if (!changes) return;

    setSaving(prev => ({ ...prev, [libraryId]: true }));
    
    try {
    const response = await fetch(`/api/library-configs/${libraryId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(changes)
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const updatedConfig = await response.json();
      
      // Update the config in state
      setConfigs(prev => prev.map(config => 
        config.library_id === libraryId ? updatedConfig : config
      ));
      
      // Clear pending changes
      setPendingChanges(prev => {
        const newChanges = { ...prev };
        delete newChanges[libraryId];
        return newChanges;
      });
      
      setMessage({ 
        type: 'success', 
        text: `Successfully saved configuration for library ${libraryId}` 
      });

      // Notify other pages that a config was saved (updates may affect names/keys)
      try {
        const event = new CustomEvent('library-configs:updated', { detail: { savedLibraryId: libraryId } });
        window.dispatchEvent(event);
      } catch (e) {
        // noop
      }
    } catch (error) {
      console.error('Error saving config:', error);
      setMessage({ 
        type: 'error', 
        text: `Failed to save configuration: ${error.message}` 
      });
    } finally {
      setSaving(prev => ({ ...prev, [libraryId]: false }));
    }
  };

  const handleFieldChange = (libraryId, field, value) => {
    // Update local state immediately
    setConfigs(prev => prev.map(config => 
      config.library_id === libraryId 
        ? { ...config, [field]: value }
        : config
    ));
    
    // Track pending changes
    setPendingChanges(prev => ({
      ...prev,
      [libraryId]: {
        ...prev[libraryId],
        [field]: value
      }
    }));
  };

  const toggleApiKeyVisibility = (libraryId) => {
    setShowApiKeys(prev => ({
      ...prev,
      [libraryId]: !prev[libraryId]
    }));
  };

  const toggleActive = (libraryId, currentStatus) => {
    handleFieldChange(libraryId, 'is_active', !currentStatus);
  };

  const hasPendingChanges = (libraryId) => {
    return pendingChanges[libraryId] && Object.keys(pendingChanges[libraryId]).length > 0;
  };

  // Derived header stats
  const totalConfigs = configs.length;
  // Active APIs counted by presence of an API key
  const activeCount = configs.filter(c => !!(c.stream_api_key && String(c.stream_api_key).trim().length > 0)).length;
  const latestUpdate = configs.reduce((acc, c) => {
    const t = c.updated_at ? new Date(c.updated_at).getTime() : 0;
    return t > acc ? t : acc;
  }, 0);
  const formatTimeAgo = (dateInput) => {
    if (!dateInput) return '—';
    const d = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
    const diff = Date.now() - d.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs} hours ago`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days} days ago`;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const endpointFor = (cfg) => `https://video.bunnycdn.com/library/${cfg.library_id}/videos`;
  const isConfigured = (cfg) => !!(cfg.stream_api_key && String(cfg.stream_api_key).trim().length > 0);
  // Status reflects API key presence (Active = API added), not backend is_active
  const statusFor = (cfg) => (hasPendingChanges(cfg.library_id) ? 'Pending' : (isConfigured(cfg) ? 'Active' : 'Inactive'));
  const statusStyles = (st) => {
    switch (st) {
      case 'Active': return 'bg-emerald-100 text-emerald-800';
      case 'Inactive': return 'bg-rose-100 text-rose-800';
      case 'Pending': return 'bg-amber-100 text-amber-800';
      default: return 'bg-slate-100 text-slate-700';
    }
  };

  const toggleSelected = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

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
          <div className="flex gap-2">
            <Button 
              onClick={fetchConfigs} 
              disabled={loading}
              className="flex items-center gap-2"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </div>

        {/* Stat Cards */}
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-4">
            <div className="text-sm text-indigo-600 font-medium flex items-center gap-2">
              <span>🔧</span>
              Total Configs
            </div>
            <div className="text-2xl font-semibold text-indigo-800 mt-1">{totalConfigs}</div>
          </div>
          <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-4">
            <div className="text-sm text-indigo-600 font-medium flex items-center gap-2">
              <span>✓</span>
              Active APIs
            </div>
            <div className="text-2xl font-semibold text-indigo-800 mt-1">{activeCount}</div>
          </div>
          <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-4">
            <div className="text-sm text-indigo-600 font-medium flex items-center gap-2">
              <span>🕐</span>
              Last Update
            </div>
            <div className="text-base font-medium text-indigo-800 mt-1">{latestUpdate ? `Updated ${formatTimeAgo(new Date(latestUpdate))}` : 'No updates yet'}</div>
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
            <Input
              placeholder="Search configurations..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} />
            Active Only
          </label>
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-600">Type:</span>
            <select 
              className="text-sm border border-slate-300 rounded px-2 py-1"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
            >
              <option>All Configs</option>
              <option>REST APIs</option>
              <option>GraphQL</option>
              <option>Webhooks</option>
              <option>Custom</option>
            </select>
          </div>
          <Button variant="outline" className="flex items-center gap-2" onClick={() => setShowSettingsModal(true)}>
            <Settings className="h-4 w-4" />
            Settings
          </Button>
        </div>
      </div>

      {/* Two-column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Left: Configuration List (60%) */}
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
            {/* Sticky Header */}
            <div className="sticky top-0 z-10 bg-slate-50 border-b border-slate-200 grid grid-cols-[1fr_1.2fr_0.7fr_0.8fr_80px] px-4 h-10 items-center text-xs font-semibold text-slate-600">
              <div>Config Name</div>
              <div>Endpoint</div>
              <div>Status</div>
              <div>Last Modified</div>
              <div className="text-center">Actions</div>
            </div>

            {/* Loading shimmer rows */}
            {loading && (
              <div className="p-4 space-y-2">
                {[...Array(8)].map((_, i) => (
                  <div key={i} className="animate-pulse h-[60px] bg-slate-100 rounded" />
                ))}
              </div>
            )}

            {/* Rows with inline Expanded Details */}
            {!loading && filteredConfigs.map(cfg => {
              const st = statusFor(cfg);
              const isRowExpanded = expandedId === cfg.library_id;
              return (
                <React.Fragment key={cfg.library_id}>
                  <div 
                    className="grid grid-cols-[1fr_1.2fr_0.7fr_0.8fr_80px] items-center px-4 border-b hover:bg-slate-50 h-[60px] cursor-pointer"
                    onClick={() => setExpandedId(isRowExpanded ? null : cfg.library_id)}
                    role="button"
                    tabIndex={0}
                  >
                    {/* Config Name */}
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-indigo-500 text-base">🔗</span>
                      <span className="font-mono text-[15px] font-semibold text-slate-900 truncate" title={cfg.library_name}>{cfg.library_name}</span>
                    </div>
                    {/* Endpoint */}
                    <div className="min-w-0">
                      <span 
                        className="font-mono text-[13px] bg-[#f8f9fa] px-2 py-1 rounded text-slate-800 truncate inline-block max-w-full"
                        title={endpointFor(cfg)}
                      >
                        {endpointFor(cfg)}
                      </span>
                    </div>
                    {/* Status */}
                    <div>
                      <span className={`inline-flex items-center px-3 py-1 rounded-full text-[12px] font-semibold ${statusStyles(st)}`}>
                        {st}
                      </span>
                    </div>
                    {/* Last Modified */}
                    <div className="flex items-center gap-2 text-[13px] text-slate-500">
                      <span>🕐</span>
                      <span>{formatTimeAgo(cfg.updated_at)}</span>
                    </div>
                    {/* Actions */}
                    <div className="flex items-center justify-center gap-2">
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        onClick={(e) => { e.stopPropagation(); setExpandedId(isRowExpanded ? null : cfg.library_id); }} 
                        className="h-8 px-2"
                      >
                        {isRowExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </Button>
                      <input 
                        type="checkbox" 
                        checked={selectedIds.has(cfg.library_id)} 
                        onChange={(e) => { e.stopPropagation(); toggleSelected(cfg.library_id); }}
                      />
                    </div>
                  </div>

                  {isRowExpanded && (
                    <div className="bg-white mx-6 my-3 rounded-xl p-6 border border-slate-200 shadow-sm" style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.08)', borderLeft: '4px solid #6366f1' }}>
                      <div className="flex items-center justify-between mb-3">
                        <div className="text-[18px] font-bold text-slate-900">Config Name: {cfg.library_name}</div>
                        <div className="flex items-center gap-2">
                          <Button size="sm" className="h-8 px-3 bg-blue-600 text-white rounded-md" disabled>Edit</Button>
                          <Button size="sm" className="h-8 px-3 bg-red-500 text-white rounded-md" disabled>Delete</Button>
                        </div>
                      </div>

                      <div className="mb-4">
                        <div className="text-[13px] font-semibold text-slate-600 uppercase mb-1">Endpoint Configuration</div>
                        <div className="space-y-4">
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
                              <Button 
                                type="button" 
                                size="sm" 
                                variant="ghost" 
                                className="w-7 h-7 rounded-full bg-slate-100 hover:bg-slate-200"
                                onClick={() => toggleApiKeyVisibility(cfg.library_id)}
                              >
                                👁️
                              </Button>
                            </div>
                            <div className="flex gap-2">
                              <Input
                                type="text"
                                placeholder="Enter Stream API key"
                                value={cfg.stream_api_key || ''}
                                onChange={(e) => handleFieldChange(cfg.library_id, 'stream_api_key', e.target.value)}
                                disabled={saving[cfg.library_id]}
                                className="flex-1"
                              />
                              {hasPendingChanges(cfg.library_id) && (
                                <Button
                                  size="sm"
                                  onClick={() => saveConfig(cfg.library_id)}
                                  disabled={saving[cfg.library_id]}
                                  className="flex items-center gap-2"
                                >
                                  <Save className="h-4 w-4" />
                                  Save
                                </Button>
                              )}
                            </div>
                            {!isConfigured(cfg) && (
                              <div className="text-[12px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 inline-block">
                                Add an API key to activate this library.
                              </div>
                            )}
                          </div>
                          <div>
                            <div className="text-[13px] font-semibold text-slate-600 uppercase">Rate Limit</div>
                            <div className="text-[15px] text-slate-900">100 requests/min</div>
                          </div>
                        </div>
                      </div>

                      {/* Small Stats */}
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
                        <div className="rounded-lg border border-slate-200 p-4">
                          <div className="text-sm text-slate-600 flex items-center gap-2"><span>✓</span> Active Status</div>
                          <div className="mt-1 text-slate-900 font-medium">{cfg.is_active ? 'Active' : 'Inactive'}</div>
                        </div>
                        <div className="rounded-lg border border-slate-200 p-4">
                          <div className="text-sm text-slate-600 flex items-center gap-2"><span>📊</span> Calls Today</div>
                          <div className="mt-1 text-slate-900 font-medium">—</div>
                        </div>
                        <div className="rounded-lg border border-slate-200 p-4">
                          <div className="text-sm text-slate-600 flex items-center gap-2"><span>⚡</span> Uptime</div>
                          <div className="mt-1 text-slate-900 font-medium">—</div>
                        </div>
                      </div>

                      {/* Controls */}
                      <div className="flex items-center justify-between pt-2">
                        <div className="flex items-center gap-3">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => toggleActive(cfg.library_id, cfg.is_active)}
                            disabled={saving[cfg.library_id]}
                          >
                            {isConfigured(cfg) ? 'Deactivate' : 'Activate'}
                          </Button>
                          <div className="flex items-center gap-2 text-sm">
                            {isConfigured(cfg) ? (
                              <Badge variant="default" className="bg-green-500">
                                <CheckCircle className="h-3 w-3 mr-1" />
                                Configured
                              </Badge>
                            ) : (
                              <Badge variant="secondary" className="bg-amber-500">
                                <XCircle className="h-3 w-3 mr-1" />
                                Missing API Key
                              </Badge>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {saving[cfg.library_id] && (
                            <div className="flex items-center gap-2 text-sm text-blue-600">
                              <RefreshCw className="h-3 w-3 animate-spin" />
                              Saving...
                            </div>
                          )}
                          {hasPendingChanges(cfg.library_id) && (
                            <Button
                              size="sm"
                              onClick={() => saveConfig(cfg.library_id)}
                              disabled={saving[cfg.library_id]}
                              className="flex items-center gap-2"
                            >
                              <Save className="h-4 w-4" />
                              Save Changes
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </React.Fragment>
              );
            })}

            {/* Scroll position visual accents */}
            <div className={`sticky bottom-0 h-4 ${atBottom ? 'bg-transparent' : 'bg-gradient-to-t from-slate-100 to-transparent'}`}></div>
          </div>

          {/* Empty states */}
          {filteredConfigs.length === 0 && !loading && searchTerm && (
            <Card className="w-full mt-4">
              <CardContent className="text-center py-8">
                <Search className="h-12 w-12 mx-auto text-gray-400 mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">No Configurations Found</h3>
                <p className="text-gray-500 mb-4">
                  No configurations match your search criteria. Try a different search term.
                </p>
                <Button onClick={() => setSearchTerm('')} variant="outline">
                  Clear Search
                </Button>
              </CardContent>
            </Card>
          )}

          {configs.length === 0 && !loading && !searchTerm && (
            <Card className="w-full mt-4">
              <CardContent className="text-center py-8">
                <Database className="h-12 w-12 mx-auto text-gray-400 mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">No API Configurations</h3>
                <p className="text-gray-500 mb-4">
                  Click "Refresh" to load your video libraries and configure their API keys.
                </p>
                <Button onClick={fetchConfigs} disabled={loading} className="flex items-center gap-2">
                  <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                  Refresh
                </Button>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right: Quick Actions (40%) */}
        <div className="lg:col-span-2">
          <div className="bg-[#f8fafc] p-6 border border-slate-200 rounded-xl">
            <h3 className="text-sm font-semibold text-slate-700 mb-3">Quick Actions & Info</h3>
            <div className="space-y-3">
              <Button className="w-full h-[42px] rounded-lg text-[14px] font-medium flex items-center gap-2" disabled>
                ➕ Add New Config
              </Button>
              <Button variant="outline" className="w-full h-[42px] rounded-lg text-[14px] font-medium flex items-center gap-2" disabled>
                📋 Bulk Edit
              </Button>
              <Button variant="destructive" className="w-full h-[42px] rounded-lg text-[14px] font-medium flex items-center gap-2" disabled={selectedIds.size === 0}>
                🗑️ Delete Selected
              </Button>
              {/* Sync All removed; use Refresh in header */}
            </div>
            <div className="mt-6 text-sm text-slate-600">
              <div>Selected: {selectedIds.size}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Settings Modal (visual-only) */}
      {showSettingsModal && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => setShowSettingsModal(false)}>
          <div className="bg-white rounded-lg p-6 w-full max-w-md border border-slate-200" onClick={(e) => e.stopPropagation()}>
            <h4 className="text-lg font-semibold mb-2">Advanced Filtering</h4>
            <p className="text-sm text-slate-600 mb-4">This modal is a visual-only mock for future filter options.</p>
            <div className="flex justify-end">
              <Button variant="outline" onClick={() => setShowSettingsModal(false)}>Close</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LibraryConfig;