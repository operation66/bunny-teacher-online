// FILE: frontend/src/pages/Settings.jsx
import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Alert, AlertDescription } from '../components/ui/alert';
import financialApi from '../services/financial_api';
import {
  Settings as SettingsIcon, Plus, Trash2, Save, Users,
  BookOpen, GraduationCap, CheckCircle, X, Edit2, AlertTriangle, Clock,
} from 'lucide-react';

const pct  = (v) => `${(v * 100).toFixed(2)}%`;
const fNum = (s) => parseFloat(s) || 0;

// Key used to persist "skipped/pending" libraries in localStorage
const PENDING_REVIEW_KEY = 'financial_pending_review_libs';

// ── EditModal ─────────────────────────────────────────────────────────────────
const EditModal = ({ assignment, stages, sections, subjects, onSave, onClose }) => {
  const [form, setForm] = useState({
    stage_id: assignment.stage_id,
    section_id: assignment.section_id ?? '',
    subject_id: assignment.subject_id,
    tax_rate: (assignment.tax_rate * 100).toFixed(2),
    revenue_percentage: (assignment.revenue_percentage * 100).toFixed(2),
  });
  const [saving, setSaving] = useState(false);
  const modalSections = sections.filter(s => s.stage_id === Number(form.stage_id));
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(assignment.id, {
        stage_id: Number(form.stage_id),
        section_id: form.section_id !== '' ? Number(form.section_id) : null,
        subject_id: Number(form.subject_id),
        tax_rate: fNum(form.tax_rate) / 100,
        revenue_percentage: fNum(form.revenue_percentage) / 100,
      });
    } finally { setSaving(false); }
  };
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-lg font-bold text-gray-900">Edit Assignment</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5"/></button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-xs text-gray-500 mb-1">Library</p>
            <p className="font-medium text-sm text-gray-800">{assignment.library_name}</p>
            <p className="text-xs text-gray-400">ID: {assignment.library_id}</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Stage</label>
            <select className="w-full h-10 px-3 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
              value={form.stage_id} onChange={e => set('stage_id', e.target.value)}>
              {stages.map(s => <option key={s.id} value={s.id}>{s.name} ({s.code})</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Section <span className="text-gray-400 font-normal">(empty = common)</span></label>
            <select className="w-full h-10 px-3 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
              value={form.section_id} onChange={e => set('section_id', e.target.value)}>
              <option value="">None (Common)</option>
              {modalSections.map(s => <option key={s.id} value={s.id}>{s.name} ({s.code})</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Subject</label>
            <select className="w-full h-10 px-3 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
              value={form.subject_id} onChange={e => set('subject_id', e.target.value)}>
              {subjects.map(s => <option key={s.id} value={s.id}>{s.name} ({s.code}){s.is_common ? ' — Common' : ''}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Tax Rate %</label>
              <div className="relative">
                <Input type="number" step="0.1" min="0" max="100" value={form.tax_rate}
                  onChange={e => set('tax_rate', e.target.value)} className="pr-8"/>
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm pointer-events-none">%</span>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Revenue %</label>
              <div className="relative">
                <Input type="number" step="0.1" min="0" max="100" value={form.revenue_percentage}
                  onChange={e => set('revenue_percentage', e.target.value)} className="pr-8"/>
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm pointer-events-none">%</span>
              </div>
            </div>
          </div>
        </div>
        <div className="flex gap-3 px-6 py-4 border-t bg-gray-50 rounded-b-2xl">
          <Button onClick={handleSave} disabled={saving} className="flex-1 bg-green-600 hover:bg-green-700 text-white">
            <Save className="w-4 h-4 mr-2"/>{saving ? 'Saving…' : 'Save Changes'}
          </Button>
          <Button variant="outline" onClick={onClose} className="flex-1">Cancel</Button>
        </div>
      </div>
    </div>
  );
};

// ── BulkEditModal ─────────────────────────────────────────────────────────────
const BulkEditModal = ({ count, onSave, onClose }) => {
  const [tax, setTax] = useState('');
  const [rev, setRev] = useState('');
  const [saving, setSaving] = useState(false);
  const handleSave = async () => {
    if (tax === '' && rev === '') { alert('Enter at least one value to update.'); return; }
    setSaving(true);
    try {
      const payload = {};
      if (tax !== '') payload.tax_rate = fNum(tax) / 100;
      if (rev !== '') payload.revenue_percentage = fNum(rev) / 100;
      await onSave(payload);
    } finally { setSaving(false); }
  };
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-lg font-bold text-gray-900">Bulk Edit <span className="text-blue-600">({count} selected)</span></h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5"/></button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <p className="text-sm text-gray-500">Leave blank to keep existing values unchanged.</p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Tax Rate %</label>
              <div className="relative">
                <Input type="number" step="0.1" min="0" max="100" placeholder="e.g. 5"
                  value={tax} onChange={e => setTax(e.target.value)} className="pr-8"/>
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm pointer-events-none">%</span>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Revenue %</label>
              <div className="relative">
                <Input type="number" step="0.1" min="0" max="100" placeholder="e.g. 95"
                  value={rev} onChange={e => setRev(e.target.value)} className="pr-8"/>
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm pointer-events-none">%</span>
              </div>
            </div>
          </div>
        </div>
        <div className="flex gap-3 px-6 py-4 border-t bg-gray-50 rounded-b-2xl">
          <Button onClick={handleSave} disabled={saving} className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white">
            <Save className="w-4 h-4 mr-2"/>{saving ? 'Applying…' : `Apply to ${count} Assignments`}
          </Button>
          <Button variant="outline" onClick={onClose} className="flex-1">Cancel</Button>
        </div>
      </div>
    </div>
  );
};

// ── MultiSectionPicker — checkbox list for picking multiple sections ──────────
const MultiSectionPicker = ({ availableSections, selectedIds, onChange, disabled }) => {
  const toggle = (id) => {
    const next = selectedIds.includes(id)
      ? selectedIds.filter(x => x !== id)
      : [...selectedIds, id];
    onChange(next);
  };
  if (!availableSections.length) {
    return <p className="text-xs text-gray-400 italic py-1">No sections for selected stage</p>;
  }
  return (
    <div className="border rounded-lg bg-white divide-y max-h-40 overflow-y-auto">
      <div className="px-3 py-1.5 bg-gray-50">
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox"
            checked={selectedIds.length === availableSections.length && availableSections.length > 0}
            onChange={() => {
              if (selectedIds.length === availableSections.length) onChange([]);
              else onChange(availableSections.map(s => s.id));
            }}
            disabled={disabled}
            className="w-3.5 h-3.5 rounded text-blue-600"/>
          <span className="text-xs font-semibold text-gray-600">All / None</span>
        </label>
      </div>
      {availableSections.map(s => {
        const isGen = s.code.toUpperCase().includes('GEN');
        return (
          <label key={s.id} className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-gray-50">
            <input type="checkbox" checked={selectedIds.includes(s.id)} onChange={() => toggle(s.id)}
              disabled={disabled} className="w-3.5 h-3.5 rounded text-blue-600"/>
            <span className={`text-xs font-mono font-bold px-1.5 py-0.5 rounded
              ${isGen ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>{s.code}</span>
            <span className="text-xs text-gray-700">{s.name}</span>
          </label>
        );
      })}
    </div>
  );
};

// ── UnmatchedModal (full rewrite) ─────────────────────────────────────────────
// Fixes: multi-select sections, clickable dropdowns, save works, filter by stage,
//        select all, bulk section apply, "review later" persistence
const UnmatchedModal = ({ results, stages, sections, subjects, onClose, onSaveManual }) => {
  const matched = results.filter(r => r.matched).length;
  const initialUnmatched = results.filter(r => !r.matched);

  // Load any previously-saved pending items from localStorage
  const loadPending = () => {
    try {
      const saved = localStorage.getItem(PENDING_REVIEW_KEY);
      return saved ? JSON.parse(saved) : null;
    } catch { return null; }
  };
  const savePending = (items) => {
    try { localStorage.setItem(PENDING_REVIEW_KEY, JSON.stringify(items)); } catch {}
  };
  const clearPending = () => {
    try { localStorage.removeItem(PENDING_REVIEW_KEY); } catch {}
  };

  // editingItems: map of library_id → { library_id, library_name, stage_id, section_ids[], subject_id, stage_code, section_code, subject_code }
  const buildInitial = (unmatched) => {
    const map = {};
    unmatched.forEach(r => {
      const stageMatch = stages.find(s => s.code === r.stage_code);
      const subjectMatch = subjects.find(s => s.code === r.subject_code);
      let sectionIds = [];
      if (stageMatch && r.section_code) {
        const secMatch = sections.find(s =>
          s.stage_id === stageMatch.id &&
          s.code.toUpperCase() === (r.section_code || '').toUpperCase()
        );
        if (secMatch) sectionIds = [secMatch.id];
      }
      map[r.library_id] = {
        library_id: r.library_id,
        library_name: r.library_name,
        stage_id: stageMatch?.id || '',
        section_ids: sectionIds,    // ARRAY — multiple sections allowed
        subject_id: subjectMatch?.id || '',
        stage_code: r.stage_code,
        section_code: r.section_code,
        subject_code: r.subject_code,
        removed: false,
      };
    });
    return map;
  };

  const [editingItems, setEditingItems] = useState(() => buildInitial(initialUnmatched));
  const [saving, setSaving] = useState(new Set());
  const [filterStage, setFilterStage] = useState('');
  const [selectedLibIds, setSelectedLibIds] = useState(new Set());
  const [showBulkSection, setShowBulkSection] = useState(false);
  const [bulkSectionIds, setBulkSectionIds] = useState([]);

  const remainingItems = Object.values(editingItems).filter(i => !i.removed);
  const visibleItems = filterStage
    ? remainingItems.filter(i => String(i.stage_id) === String(filterStage))
    : remainingItems;

  const updateItem = (libId, field, value) =>
    setEditingItems(prev => ({ ...prev, [libId]: { ...prev[libId], [field]: value } }));

  const removeItem = (libId) => {
    updateItem(libId, 'removed', true);
    setSelectedLibIds(prev => { const n = new Set(prev); n.delete(libId); return n; });
  };

  // Save one library — creates one assignment per selected section (or one with null if common/none)
  const handleSaveOne = async (libId) => {
    const item = editingItems[libId];
    if (!item.stage_id || !item.subject_id) { alert('Stage and Subject are required'); return; }
    setSaving(prev => new Set(prev).add(libId));
    try {
      const subjectObj = subjects.find(s => s.id === Number(item.subject_id));
      const payloads = [];

      if (item.section_ids.length === 0 || (subjectObj && subjectObj.is_common)) {
        // Common subject or no section selected → save once with section_id=null
        payloads.push({
          library_id: Number(item.library_id),
          library_name: item.library_name,
          stage_id: Number(item.stage_id),
          section_id: null,
          subject_id: Number(item.subject_id),
          tax_rate: 0.0,
          revenue_percentage: 0.95,
        });
      } else {
        // Save one assignment per selected section
        for (const secId of item.section_ids) {
          payloads.push({
            library_id: Number(item.library_id),
            library_name: item.library_name,
            stage_id: Number(item.stage_id),
            section_id: Number(secId),
            subject_id: Number(item.subject_id),
            tax_rate: 0.0,
            revenue_percentage: 0.95,
          });
        }
      }

      // Save all payloads — backend uses upsert so duplicates are safe
      const errors = [];
      for (const payload of payloads) {
        try {
          await onSaveManual(payload);
        } catch (err) {
          const msg = err?.response?.data?.detail || err?.message || 'Unknown error';
          // If already exists (409 or contains "already"), treat as success — assignment is there
          if (err?.response?.status === 409 || msg.toLowerCase().includes('already') || msg.toLowerCase().includes('duplicate')) {
            // Silently continue — assignment already exists, which is fine
          } else {
            errors.push(msg);
          }
        }
      }

      if (errors.length > 0) {
        alert(`Some sections failed to save:\n${errors.join('\n')}\n\nCheck your connection and try again.`);
      } else {
        removeItem(libId);
      }
    } catch (err) {
      const detail = err?.response?.data?.detail || err?.response?.statusText || err?.message || 'Unknown error';
      const status = err?.response?.status;
      alert(`Failed to save (${status || 'Network Error'}): ${detail}`);
    } finally {
      setSaving(prev => { const n = new Set(prev); n.delete(libId); return n; });
    }
  };

  // Save & review later — persist remaining items
  const handleReviewLater = () => {
    const remaining = Object.values(editingItems).filter(i => !i.removed);
    if (remaining.length > 0) {
      savePending(remaining);
    } else {
      clearPending();
    }
    onClose();
  };

  // Bulk apply section to selected
  const applyBulkSection = () => {
    setSelectedLibIds(prev => {
      prev.forEach(libId => {
        updateItem(libId, 'section_ids', [...bulkSectionIds]);
      });
      return prev;
    });
    setShowBulkSection(false);
    setBulkSectionIds([]);
  };

  // Select/deselect all visible
  const allVisibleSelected = visibleItems.length > 0 && visibleItems.every(i => selectedLibIds.has(i.library_id));
  const toggleSelectAll = () => {
    setSelectedLibIds(prev => {
      const next = new Set(prev);
      if (allVisibleSelected) visibleItems.forEach(i => next.delete(i.library_id));
      else visibleItems.forEach(i => next.add(i.library_id));
      return next;
    });
  };

  const selectedCount = visibleItems.filter(i => selectedLibIds.has(i.library_id)).length;

  // Sections available for bulk apply (based on most common stage among selected)
  const bulkStageId = (() => {
    const selected = visibleItems.filter(i => selectedLibIds.has(i.library_id));
    if (!selected.length) return '';
    const counts = {};
    selected.forEach(i => { counts[i.stage_id] = (counts[i.stage_id] || 0) + 1; });
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
  })();
  const bulkAvailableSections = bulkStageId
    ? sections.filter(s => s.stage_id === Number(bulkStageId))
    : [];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-orange-100 rounded-full flex items-center justify-center">
              <AlertTriangle className="w-5 h-5 text-orange-600"/>
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900">Manual Assignment Editor</h2>
              <p className="text-sm text-gray-500">
                <span className="text-green-600 font-semibold">{matched} auto-matched</span>
                {' · '}
                <span className="text-orange-600 font-semibold">{remainingItems.length} need review</span>
              </p>
            </div>
          </div>
          <button onClick={handleReviewLater} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5"/></button>
        </div>

        {/* Instructions */}
        <div className="px-6 py-3 bg-blue-50 border-b border-blue-100 flex-shrink-0">
          <p className="text-sm text-blue-800">
            <strong>Review unmatched libraries below.</strong> Edit the dropdowns to assign Stage/Section/Subject, then click <strong>Save</strong>. Section supports <strong>multiple selections</strong>. Or <strong>Remove</strong> libraries you don't need.
          </p>
        </div>

        {/* Filter + bulk actions bar */}
        <div className="px-6 py-3 border-b bg-gray-50 flex-shrink-0 flex items-center gap-3 flex-wrap">
          {/* Stage filter */}
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-gray-600">Filter Stage:</label>
            <select className="h-8 px-2 border rounded-lg text-xs bg-white"
              value={filterStage} onChange={e => { setFilterStage(e.target.value); setSelectedLibIds(new Set()); }}>
              <option value="">All ({remainingItems.length})</option>
              {stages.map(s => {
                const cnt = remainingItems.filter(i => String(i.stage_id) === String(s.id)).length;
                return cnt > 0 ? <option key={s.id} value={s.id}>{s.name} ({cnt})</option> : null;
              })}
            </select>
          </div>

          {/* Select all checkbox */}
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={allVisibleSelected} onChange={toggleSelectAll}
              className="w-3.5 h-3.5 rounded text-blue-600"/>
            <span className="text-xs text-gray-600">
              {allVisibleSelected ? 'Deselect all' : 'Select all'} ({visibleItems.length})
            </span>
          </label>

          {/* Bulk section apply */}
          {selectedCount > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-blue-700">{selectedCount} selected</span>
              <Button size="sm" onClick={() => setShowBulkSection(true)}
                className="h-7 text-xs bg-indigo-600 hover:bg-indigo-700 text-white px-3">
                <Edit2 className="w-3 h-3 mr-1"/>Bulk Apply Section
              </Button>
              <button onClick={() => setSelectedLibIds(new Set())}
                className="text-xs text-gray-400 hover:text-gray-600 underline">clear</button>
            </div>
          )}

          {/* Showing count */}
          <span className="ml-auto text-xs text-gray-500">
            Showing {visibleItems.length} of {remainingItems.length}
          </span>
        </div>

        {/* Bulk section picker popup */}
        {showBulkSection && (
          <div className="px-6 py-3 border-b bg-indigo-50 flex-shrink-0">
            <p className="text-xs font-semibold text-indigo-800 mb-2">
              Apply sections to {selectedCount} selected libraries:
            </p>
            <MultiSectionPicker
              availableSections={bulkAvailableSections}
              selectedIds={bulkSectionIds}
              onChange={setBulkSectionIds}
              disabled={false}/>
            <div className="flex gap-2 mt-2">
              <Button size="sm" onClick={applyBulkSection}
                className="h-7 text-xs bg-indigo-600 hover:bg-indigo-700 text-white px-3">
                Apply to {selectedCount} Libraries
              </Button>
              <Button size="sm" variant="outline" onClick={() => { setShowBulkSection(false); setBulkSectionIds([]); }}
                className="h-7 text-xs">Cancel</Button>
            </div>
          </div>
        )}

        {/* Scrollable list */}
        <div className="overflow-y-auto flex-1 px-6 py-4">
          {visibleItems.length === 0 ? (
            <div className="text-center py-16">
              <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-3"/>
              <p className="text-lg font-semibold text-gray-700">
                {remainingItems.length === 0 ? 'All libraries processed!' : 'No libraries match this filter'}
              </p>
              <p className="text-sm text-gray-500">
                {remainingItems.length === 0 ? 'Close this dialog to see your assignments.' : 'Try a different stage filter.'}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {visibleItems.map(item => {
                const stageObj = stages.find(s => s.id === Number(item.stage_id));
                const availableSections = stageObj ? sections.filter(s => s.stage_id === stageObj.id) : [];
                const subjectObj = subjects.find(s => s.id === Number(item.subject_id));
                const isSaving = saving.has(item.library_id);
                const isSelected = selectedLibIds.has(item.library_id);
                const canSave = item.stage_id && item.subject_id;

                return (
                  <div key={item.library_id}
                    className={`border-2 rounded-xl p-4 transition-all
                      ${isSelected ? 'border-indigo-400 bg-indigo-50' : 'border-orange-200 bg-orange-50'}`}>

                    {/* Top: checkbox + library info */}
                    <div className="flex items-start gap-3 mb-3">
                      <input type="checkbox" checked={isSelected}
                        onChange={() => setSelectedLibIds(prev => {
                          const next = new Set(prev);
                          next.has(item.library_id) ? next.delete(item.library_id) : next.add(item.library_id);
                          return next;
                        })}
                        className="w-4 h-4 rounded text-indigo-600 mt-0.5 flex-shrink-0"/>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm text-gray-800 truncate">{item.library_name}</p>
                        <div className="flex gap-1.5 flex-wrap mt-1">
                          <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">ID: {item.library_id}</span>
                          {item.stage_code && <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-mono">Parsed Stage: {item.stage_code}</span>}
                          {item.section_code && <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-mono">Parsed Section: {item.section_code}</span>}
                          {item.subject_code && <span className="text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded font-mono">Parsed Subject: {item.subject_code}</span>}
                        </div>
                      </div>
                    </div>

                    {/* Dropdowns row */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">

                      {/* Stage */}
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Stage *</label>
                        <select
                          className="w-full h-9 px-3 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none cursor-pointer"
                          value={item.stage_id}
                          onChange={e => {
                            updateItem(item.library_id, 'stage_id', e.target.value);
                            updateItem(item.library_id, 'section_ids', []);
                          }}
                          disabled={isSaving}>
                          <option value="">Select stage…</option>
                          {stages.map(s => <option key={s.id} value={s.id}>{s.name} ({s.code})</option>)}
                        </select>
                      </div>

                      {/* Section — multi-checkbox */}
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">
                          Sections <span className="text-gray-400 font-normal">(multi-select · empty = common)</span>
                        </label>
                        <MultiSectionPicker
                          availableSections={availableSections}
                          selectedIds={item.section_ids}
                          onChange={ids => updateItem(item.library_id, 'section_ids', ids)}
                          disabled={!item.stage_id || isSaving}/>
                      </div>

                      {/* Subject */}
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Subject *</label>
                        <select
                          className="w-full h-9 px-3 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none cursor-pointer"
                          value={item.subject_id}
                          onChange={e => updateItem(item.library_id, 'subject_id', e.target.value)}
                          disabled={isSaving}>
                          <option value="">Select subject…</option>
                          {subjects.map(s => (
                            <option key={s.id} value={s.id}>
                              {s.name} ({s.code}){s.is_common ? ' — Common' : ''}
                            </option>
                          ))}
                        </select>
                        {/* Hint about subject type */}
                        {subjectObj && (
                          <p className="text-xs text-gray-500 mt-1">
                            {subjectObj.is_common
                              ? '✓ Common — will apply to all sections'
                              : `✓ Section-specific — ${item.section_ids.length} section${item.section_ids.length !== 1 ? 's' : ''} selected`}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2 items-center">
                      <Button size="sm" onClick={() => handleSaveOne(item.library_id)}
                        disabled={!canSave || isSaving}
                        className="flex-1 bg-green-600 hover:bg-green-700 text-white">
                        <Save className="w-3.5 h-3.5 mr-1.5"/>
                        {isSaving ? 'Saving…' : `Save Assignment${item.section_ids.length > 1 ? ` (${item.section_ids.length} sections)` : ''}`}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => removeItem(item.library_id)}
                        disabled={isSaving}
                        className="text-red-600 border-red-300 hover:bg-red-50 px-3">
                        <Trash2 className="w-3.5 h-3.5 mr-1"/>Remove
                      </Button>
                    </div>

                    {/* Validation hint */}
                    {!canSave && (
                      <p className="text-xs text-orange-600 mt-2 flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3"/>Stage and Subject are required to save
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t bg-gray-50 rounded-b-2xl flex-shrink-0">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-600">
              {remainingItems.length === 0 ? 'All done! 🎉' : `${remainingItems.length} ${remainingItems.length === 1 ? 'library' : 'libraries'} remaining`}
            </p>
            <Button onClick={handleReviewLater} className="bg-gray-800 hover:bg-gray-900 text-white flex items-center gap-2">
              {remainingItems.length === 0 ? <CheckCircle className="w-4 h-4"/> : <Clock className="w-4 h-4"/>}
              {remainingItems.length === 0 ? 'Close' : 'Save & Review Later'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ── Main Settings ─────────────────────────────────────────────────────────────
const Settings = () => {
  const [stages, setStages] = useState([]);
  const [sections, setSections] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('stages');
  const [msg, setMsg] = useState({ text: '', type: '' });

  const [newStage, setNewStage] = useState({ code: '', name: '', display_order: 0 });
  const [newSection, setNewSection] = useState({ stage_id: '', code: '', name: '' });
  const [newSubject, setNewSubject] = useState({ code: '', name: '', is_common: false });

  const [filterStage, setFilterStage] = useState('');
  const [filterSection, setFilterSection] = useState('');
  const [filterSubject, setFilterSubject] = useState('');
  const [filterPending, setFilterPending] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [editTarget, setEditTarget] = useState(null);
  const [showBulkEdit, setShowBulkEdit] = useState(false);
  const [unmatchedResults, setUnmatchedResults] = useState(null);
  const [pendingLibs, setPendingLibs] = useState([]); // skipped from manual editor

  const flash = useCallback((text, type = 'success') => {
    setMsg({ text, type });
    setTimeout(() => setMsg({ text: '', type: '' }), 5000);
  }, []);
  const errMsg = (err) => err?.response?.data?.detail || err?.message || 'Unknown error';

  // Load pending libs from localStorage
  const loadPendingFromStorage = useCallback(() => {
    try {
      const saved = localStorage.getItem(PENDING_REVIEW_KEY);
      if (saved) setPendingLibs(JSON.parse(saved));
    } catch {}
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [st, sec, sub, asg] = await Promise.all([
        financialApi.getStages(), financialApi.getSections(),
        financialApi.getSubjects(), financialApi.getTeacherAssignments(),
      ]);
      setStages(st); setSections(sec); setSubjects(sub); setAssignments(asg);
    } catch (err) { flash('Error loading: ' + errMsg(err), 'error'); }
    finally { setLoading(false); }
  }, [flash]);

  useEffect(() => { loadAll(); loadPendingFromStorage(); }, [loadAll, loadPendingFromStorage]);

  // ── Stage CRUD ────────────────────────────────────────────────────────────
  const createStage = async (e) => {
    e.preventDefault();
    if (!newStage.code || !newStage.name) { flash('Code and Name required', 'error'); return; }
    try {
      await financialApi.createStage({ code: newStage.code.toUpperCase().trim(), name: newStage.name.trim(), display_order: parseInt(newStage.display_order) || 0 });
      flash('Stage created'); setNewStage({ code: '', name: '', display_order: 0 }); loadAll();
    } catch (err) { flash('Error: ' + errMsg(err), 'error'); }
  };
  const deleteStage = async (id) => {
    if (!window.confirm('Delete stage + all its sections & assignments?')) return;
    try { await financialApi.deleteStage(id); flash('Stage deleted'); loadAll(); }
    catch (err) { flash('Error: ' + errMsg(err), 'error'); }
  };

  // ── Section CRUD ──────────────────────────────────────────────────────────
  const createSection = async (e) => {
    e.preventDefault();
    if (!newSection.stage_id) { flash('Select a stage', 'error'); return; }
    try {
      await financialApi.createSection({ ...newSection, stage_id: parseInt(newSection.stage_id) });
      flash('Section created'); setNewSection({ stage_id: '', code: '', name: '' }); loadAll();
    } catch (err) { flash('Error: ' + errMsg(err), 'error'); }
  };
  const deleteSection = async (id) => {
    if (!window.confirm('Delete section?')) return;
    try { await financialApi.deleteSection(id); flash('Section deleted'); loadAll(); }
    catch (err) { flash('Error: ' + errMsg(err), 'error'); }
  };

  // ── Subject CRUD ──────────────────────────────────────────────────────────
  const createSubject = async (e) => {
    e.preventDefault();
    try {
      await financialApi.createSubject({ ...newSubject, code: newSubject.code.toUpperCase().trim() });
      flash('Subject created'); setNewSubject({ code: '', name: '', is_common: false }); loadAll();
    } catch (err) { flash('Error: ' + errMsg(err), 'error'); }
  };
  const deleteSubject = async (id) => {
    if (!window.confirm('Delete subject?')) return;
    try { await financialApi.deleteSubject(id); flash('Subject deleted'); loadAll(); }
    catch (err) { flash('Error: ' + errMsg(err), 'error'); }
  };

  // ── Assignment handlers ───────────────────────────────────────────────────
  const autoMatch = async () => {
    if (!window.confirm('Run auto-match for all libraries? Existing assignments are kept.')) return;
    setLoading(true);
    try {
      const r = await financialApi.autoMatchTeachers();
      await loadAll();
      if (r.results && r.results.some(x => !x.matched)) {
        setUnmatchedResults(r.results);
      } else {
        flash(`Auto-match done: ${r.matched} matched!`);
      }
    } catch (err) { flash('Auto-match error: ' + errMsg(err), 'error'); setLoading(false); }
  };

  const saveEdit = async (id, payload) => {
    try {
      await financialApi.updateTeacherAssignment(id, payload);
      flash('Updated'); setEditTarget(null); loadAll();
    } catch (err) { flash('Save error: ' + errMsg(err), 'error'); throw err; }
  };

  const deleteAssignment = async (id) => {
    if (!window.confirm('Delete this assignment?')) return;
    try { await financialApi.deleteTeacherAssignment(id); flash('Deleted'); loadAll(); }
    catch (err) { flash('Error: ' + errMsg(err), 'error'); }
  };

  const saveManualAssignment = async (assignment) => {
    try {
      await financialApi.createTeacherAssignment(assignment);
      await loadAll();
    } catch (err) {
      const msg = err?.response?.data?.detail || err?.message || '';
      // Treat "already exists" / duplicate as success — backend upsert may not be deployed yet
      if (err?.response?.status === 409 || msg.toLowerCase().includes('already') || msg.toLowerCase().includes('duplicate')) {
        await loadAll(); // reload to show the existing assignment
        return;
      }
      flash('Error creating assignment: ' + msg, 'error');
      throw err;
    }
  };

  // When unmatched modal closes, save remaining items to pending state
  const handleUnmatchedClose = () => {
    setUnmatchedResults(null);
    loadPendingFromStorage(); // reload pending from storage (modal saves to localStorage)
    loadAll();
  };

  // Reopen manual editor with pending items
  const reopenPendingEditor = () => {
    if (!pendingLibs.length) return;
    // Convert stored items back to AutoMatchResult format
    const fakeResults = pendingLibs.map(item => ({
      library_id: item.library_id,
      library_name: item.library_name,
      stage_code: item.stage_code,
      section_code: item.section_code,
      subject_code: item.subject_code,
      matched: false,
      message: 'Saved for review later',
    }));
    setUnmatchedResults(fakeResults);
  };

  // ── GROUPED ASSIGNMENTS: merge rows with same library_id into one row ─────
  // Each grouped row has all_section_ids: Section[] list
  const groupedAssignments = (() => {
    // Group by (library_id, stage_id, subject_id) — same library teaching same subject
    const map = new Map();
    assignments.forEach(a => {
      const key = `${a.library_id}|${a.stage_id}|${a.subject_id}`;
      if (!map.has(key)) {
        map.set(key, { ...a, _rowIds: [a.id], _sections: [] });
      }
      const group = map.get(key);
      if (!group._rowIds.includes(a.id)) group._rowIds.push(a.id);
      if (a.section_id) {
        const sec = sections.find(s => s.id === a.section_id);
        if (sec && !group._sections.find(s => s.id === sec.id)) {
          group._sections.push(sec);
        }
      } else {
        if (!group._sections.find(s => s.id === null)) {
          group._sections.push({ id: null, code: null, name: 'All Sections' });
        }
      }
    });
    return Array.from(map.values());
  })();

  // Filter grouped assignments
  const pendingLibIds = new Set(pendingLibs.map(p => p.library_id));

  const filteredGrouped = groupedAssignments.filter(a => {
    if (filterStage && a.stage_id !== Number(filterStage)) return false;
    if (filterSection) {
      if (filterSection === 'null') {
        if (!a._sections.some(s => s.id === null)) return false;
      } else {
        if (!a._sections.some(s => String(s.id) === filterSection)) return false;
      }
    }
    if (filterSubject && a.subject_id !== Number(filterSubject)) return false;
    if (filterPending && !pendingLibIds.has(a.library_id)) return false;
    return true;
  });

  // Dynamic filter options
  const sectionOptions = filterStage
    ? sections.filter(s => s.stage_id === Number(filterStage))
    : sections;

  const baseForSubjects = assignments.filter(a => {
    if (filterStage && a.stage_id !== Number(filterStage)) return false;
    if (filterSection) {
      if (filterSection === 'null') { if (a.section_id !== null) return false; }
      else { if (String(a.section_id) !== filterSection) return false; }
    }
    return true;
  });
  const subjectIdsInBase = new Set(baseForSubjects.map(a => a.subject_id));
  const subjectOptions = subjects.filter(s => subjectIdsInBase.has(s.id));

  const handleFilterStage = (v) => { setFilterStage(v); setFilterSection(''); setFilterSubject(''); setSelectedIds(new Set()); };
  const handleFilterSection = (v) => { setFilterSection(v); setFilterSubject(''); setSelectedIds(new Set()); };
  const handleFilterSubject = (v) => { setFilterSubject(v); setSelectedIds(new Set()); };

  // Selection operates on row IDs (first _rowIds element as proxy for group)
  const groupKey = (g) => g._rowIds[0];
  const allSelected = filteredGrouped.length > 0 && filteredGrouped.every(g => selectedIds.has(groupKey(g)));
  const toggleSelectAll = () => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (allSelected) filteredGrouped.forEach(g => next.delete(groupKey(g)));
      else filteredGrouped.forEach(g => next.add(groupKey(g)));
      return next;
    });
  };
  const toggleSelect = (key) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };
  const selectedCount = filteredGrouped.filter(g => selectedIds.has(groupKey(g))).length;
  const someSelected = selectedCount > 0;

  // Bulk delete — deletes ALL individual assignment rows in selected groups
  const bulkDelete = async () => {
    const targetGroups = someSelected
      ? filteredGrouped.filter(g => selectedIds.has(groupKey(g)))
      : filteredGrouped;
    const allIds = targetGroups.flatMap(g => g._rowIds);
    if (!allIds.length) return;
    const label = someSelected ? `${selectedCount} selected libraries` : `all ${filteredGrouped.length} visible`;
    if (!window.confirm(`Delete ${label} (${allIds.length} assignments total)? Cannot be undone.`)) return;
    setLoading(true);
    let failed = 0;
    await Promise.all(allIds.map(id => financialApi.deleteTeacherAssignment(id).catch(() => { failed++; })));
    setSelectedIds(new Set());
    flash(`Deleted ${allIds.length - failed} assignments${failed ? ` (${failed} failed)` : ''}`);
    loadAll();
  };

  const applyBulkEdit = async (payload) => {
    const targetGroups = filteredGrouped.filter(g => selectedIds.has(groupKey(g)));
    const allIds = targetGroups.flatMap(g => g._rowIds);
    if (!allIds.length) { flash('No assignments selected', 'error'); return; }
    let failed = 0;
    await Promise.all(allIds.map(id => financialApi.updateTeacherAssignment(id, payload).catch(() => { failed++; })));
    setShowBulkEdit(false); setSelectedIds(new Set());
    flash(`Updated ${allIds.length - failed} assignments${failed ? ` (${failed} failed)` : ''}`);
    loadAll();
  };

  // Section column: multiple badges stacked
  const sectionCell = (group) => {
    const secList = group._sections;
    if (!secList.length) {
      return <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-500">—</span>;
    }
    return (
      <div className="flex flex-wrap gap-1">
        {secList.map((s, i) => {
          if (!s.id) {
            return (
              <span key={i} className="text-xs px-2 py-0.5 rounded bg-purple-100 text-purple-700 font-semibold block">
                All Sections
              </span>
            );
          }
          const isGen = s.code.toUpperCase().includes('GEN');
          return (
            <div key={i}>
              <span className={`text-xs px-2 py-0.5 rounded font-mono font-bold
                ${isGen ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
                {s.code}
              </span>
              <div className="text-xs text-gray-400 underline leading-tight mt-0.5">{s.name}</div>
            </div>
          );
        })}
      </div>
    );
  };

  // ── TAB JSX (inline — no inner components) ────────────────────────────────
  const tabStagesJSX = (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Plus className="w-5 h-5"/>Add New Stage</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={createStage} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Code *</label>
                <Input placeholder="S1, M2, J4" value={newStage.code} onChange={e => setNewStage({ ...newStage, code: e.target.value.toUpperCase() })} required/>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
                <Input placeholder="Senior 1, Middle 2" value={newStage.name} onChange={e => setNewStage({ ...newStage, name: e.target.value })} required/>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Display Order</label>
                <Input type="number" value={newStage.display_order} onChange={e => setNewStage({ ...newStage, display_order: parseInt(e.target.value) || 0 })}/>
              </div>
            </div>
            <Button type="submit" className="bg-blue-600 hover:bg-blue-700"><Plus className="w-4 h-4 mr-2"/>Create Stage</Button>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Existing Stages ({stages.length})</CardTitle></CardHeader>
        <CardContent>
          {stages.length === 0 ? <p className="text-center py-8 text-gray-500">No stages yet.</p> : (
            <div className="space-y-2">
              {stages.map(s => (
                <div key={s.id} className="flex items-center justify-between p-4 border rounded-lg hover:bg-gray-50">
                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 bg-blue-100 rounded-lg flex items-center justify-center">
                      <span className="text-xl font-bold text-blue-600">{s.code}</span>
                    </div>
                    <div><p className="font-semibold text-gray-800">{s.name}</p><p className="text-xs text-gray-400">Order: {s.display_order}</p></div>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => deleteStage(s.id)} className="text-red-500 hover:text-red-700"><Trash2 className="w-4 h-4"/></Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );

  const tabSectionsJSX = (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Plus className="w-5 h-5"/>Add New Section</CardTitle></CardHeader>
        <CardContent>
          <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-800">
            <strong>Section codes:</strong> Use <code className="bg-yellow-100 px-1 rounded">GEN</code> / <code className="bg-yellow-100 px-1 rounded">LANG</code> for S1, or compound codes like <code className="bg-yellow-100 px-1 rounded">GEN-ART</code>, <code className="bg-yellow-100 px-1 rounded">LANG-SCIEN</code> for S2.
          </div>
          <form onSubmit={createSection} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Stage *</label>
                <select className="w-full h-10 px-3 border rounded-lg text-sm" value={newSection.stage_id} onChange={e => setNewSection({ ...newSection, stage_id: e.target.value })} required>
                  <option value="">Select stage…</option>
                  {stages.map(s => <option key={s.id} value={s.id}>{s.name} ({s.code})</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Code *</label>
                <Input placeholder="GEN, LANG, GEN-ART, LANG-SCIEN…" value={newSection.code} onChange={e => setNewSection({ ...newSection, code: e.target.value.toUpperCase() })} required/>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
                <Input placeholder="General Section, General Art Section…" value={newSection.name} onChange={e => setNewSection({ ...newSection, name: e.target.value })} required/>
              </div>
            </div>
            <Button type="submit" className="bg-green-600 hover:bg-green-700"><Plus className="w-4 h-4 mr-2"/>Create Section</Button>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Existing Sections ({sections.length})</CardTitle></CardHeader>
        <CardContent>
          {stages.length === 0 ? <p className="text-center py-8 text-gray-500">Create stages first.</p> : (
            <div className="space-y-4">
              {stages.map(stage => {
                const ss = sections.filter(s => s.stage_id === stage.id);
                return (
                  <div key={stage.id} className="border rounded-lg p-4">
                    <p className="font-semibold text-blue-600 mb-3">{stage.name} ({stage.code})</p>
                    {ss.length === 0 ? <p className="text-sm text-gray-400 italic">No sections yet</p> : ss.map(sec => (
                      <div key={sec.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg mb-2">
                        <div className="flex items-center gap-3">
                          <span className={`font-mono font-bold px-2 py-0.5 rounded text-sm ${sec.code.includes('GEN') ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>{sec.code}</span>
                          <span className="text-sm text-gray-700">{sec.name}</span>
                        </div>
                        <Button variant="outline" size="sm" onClick={() => deleteSection(sec.id)} className="text-red-500 hover:text-red-700"><Trash2 className="w-4 h-4"/></Button>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );

  const tabSubjectsJSX = (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Plus className="w-5 h-5"/>Add New Subject</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={createSubject} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Code *</label>
                <Input placeholder="AR, EN, ISC, BIO, MATH…" value={newSubject.code} onChange={e => setNewSubject({ ...newSubject, code: e.target.value.toUpperCase() })} required/>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
                <Input placeholder="Arabic, Biology, Mathematics…" value={newSubject.name} onChange={e => setNewSubject({ ...newSubject, name: e.target.value })} required/>
              </div>
              <div className="flex items-center pt-6">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={newSubject.is_common} onChange={e => setNewSubject({ ...newSubject, is_common: e.target.checked })} className="w-4 h-4 rounded text-blue-600"/>
                  <span className="text-sm font-medium text-gray-700">Common (all sections)</span>
                </label>
              </div>
            </div>
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
              <strong>Common subjects</strong> (AR, EN, HX, S.S, IT, FR…) appear in all sections — leave section empty when creating assignments.<br/>
              <strong>Section subjects</strong> (ISC, BIO, CH, PHYS, MATH, PURE-MATH, APPLIED-MATH, GEOG…) are specific to one or more sections.
            </div>
            <Button type="submit" className="bg-purple-600 hover:bg-purple-700"><Plus className="w-4 h-4 mr-2"/>Create Subject</Button>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Existing Subjects ({subjects.length})</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {[{ label: 'Common Subjects', isCommon: true, colour: 'purple' }, { label: 'Section Subjects', isCommon: false, colour: 'green' }].map(({ label, isCommon, colour }) => (
              <div key={label} className="border rounded-lg p-4">
                <p className={`font-semibold text-lg mb-3 text-${colour}-600`}>{label}</p>
                {subjects.filter(s => s.is_common === isCommon).map(sub => (
                  <div key={sub.id} className={`flex items-center justify-between p-3 bg-${colour}-50 rounded-lg mb-2`}>
                    <div className="flex items-center gap-3">
                      <span className={`font-mono font-bold text-${colour}-600`}>{sub.code}</span>
                      <span className="text-sm text-gray-700">{sub.name}</span>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => deleteSubject(sub.id)} className="text-red-500 hover:text-red-700"><Trash2 className="w-4 h-4"/></Button>
                  </div>
                ))}
                {subjects.filter(s => s.is_common === isCommon).length === 0 && <p className="text-sm text-gray-400 italic">None yet</p>}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );

  const tabAssignmentsJSX = (
    <div className="space-y-5">

      {/* Auto-match + pending review banner */}
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Users className="w-5 h-5"/>Teacher Assignments</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center flex-wrap gap-3">
            <Button onClick={autoMatch} disabled={loading} className="bg-blue-600 hover:bg-blue-700">
              <CheckCircle className="w-4 h-4 mr-2"/>{loading ? 'Running…' : 'Auto-Match All Libraries'}
            </Button>
            <span className="text-sm text-gray-500">Total: <strong>{assignments.length}</strong> assignments ({groupedAssignments.length} unique libraries)</span>
          </div>
          {pendingLibs.length > 0 && (
            <div className="flex items-center gap-3 p-3 bg-orange-50 border border-orange-200 rounded-lg">
              <Clock className="w-5 h-5 text-orange-600 flex-shrink-0"/>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-orange-800">{pendingLibs.length} libraries saved for review later</p>
                <p className="text-xs text-orange-600">From your last auto-match session — click to continue reviewing</p>
              </div>
              <Button size="sm" onClick={reopenPendingEditor} className="bg-orange-600 hover:bg-orange-700 text-white flex-shrink-0">
                <AlertTriangle className="w-3.5 h-3.5 mr-1.5"/>Continue Review
              </Button>
              <button onClick={() => {
                localStorage.removeItem(PENDING_REVIEW_KEY);
                setPendingLibs([]);
              }} className="text-orange-400 hover:text-orange-600 flex-shrink-0">
                <X className="w-4 h-4"/>
              </button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4 pb-3">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Stage</label>
              <select className="w-full h-9 px-3 border rounded-lg text-sm" value={filterStage} onChange={e => handleFilterStage(e.target.value)}>
                <option value="">All Stages</option>
                {stages.map(s => <option key={s.id} value={s.id}>{s.name} ({s.code})</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Section</label>
              <select className="w-full h-9 px-3 border rounded-lg text-sm" value={filterSection} onChange={e => handleFilterSection(e.target.value)} disabled={sectionOptions.length === 0}>
                <option value="">All Sections</option>
                {sectionOptions.map(s => <option key={s.id} value={String(s.id)}>{s.name} ({s.code})</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Subject</label>
              <select className="w-full h-9 px-3 border rounded-lg text-sm" value={filterSubject} onChange={e => handleFilterSubject(e.target.value)} disabled={subjectOptions.length === 0}>
                <option value="">All Subjects</option>
                {subjectOptions.map(s => <option key={s.id} value={s.id}>{s.name} ({s.code})</option>)}
              </select>
            </div>
            <div className="flex flex-col justify-end">
              <label className="block text-xs font-medium text-gray-500 mb-1">Status</label>
              <label className={`flex items-center gap-2 h-9 px-3 border rounded-lg cursor-pointer transition-colors
                ${filterPending ? 'bg-orange-50 border-orange-400' : 'bg-white border-gray-300'}`}>
                <input type="checkbox" checked={filterPending} onChange={e => { setFilterPending(e.target.checked); setSelectedIds(new Set()); }}
                  className="w-3.5 h-3.5 rounded text-orange-500"/>
                <span className="text-xs font-medium text-gray-700">Pending Review Only</span>
                {pendingLibs.length > 0 && (
                  <span className="ml-auto text-xs bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded-full font-semibold">{pendingLibs.length}</span>
                )}
              </label>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Bulk action bar */}
      <Card>
        <CardContent className="pt-3 pb-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-600">
                Showing <strong>{filteredGrouped.length}</strong> libraries
                {someSelected && <> · <span className="text-blue-600 font-semibold">{selectedCount} selected</span></>}
              </span>
              {someSelected && (
                <button onClick={() => setSelectedIds(new Set())} className="text-xs text-gray-400 hover:text-gray-600 underline">clear</button>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {someSelected && (
                <Button size="sm" onClick={() => setShowBulkEdit(true)} className="bg-indigo-600 hover:bg-indigo-700 text-white">
                  <Edit2 className="w-3.5 h-3.5 mr-1.5"/>Bulk Edit ({selectedCount})
                </Button>
              )}
              {filteredGrouped.length > 0 && (
                <Button size="sm" variant="outline" onClick={bulkDelete} disabled={loading}
                  className="text-red-600 border-red-300 hover:bg-red-50 hover:border-red-500">
                  <Trash2 className="w-3.5 h-3.5 mr-1.5"/>
                  {someSelected ? `Delete Selected (${selectedCount})` : `Delete All (${filteredGrouped.length})`}
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Table — grouped, no duplicate rows */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b">
                  <th className="px-4 py-3 w-10">
                    <input type="checkbox" checked={allSelected} onChange={toggleSelectAll}
                      className="w-4 h-4 rounded text-blue-600 cursor-pointer"/>
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Library</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Stage</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600 min-w-[160px]">Section(s)</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Subject</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">Tax %</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">Revenue %</th>
                  <th className="text-center px-4 py-3 font-medium text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredGrouped.map(g => {
                  const key = groupKey(g);
                  const isSelected = selectedIds.has(key);
                  const isPending = pendingLibIds.has(g.library_id);
                  return (
                    <tr key={key} onClick={() => toggleSelect(key)}
                      className={`border-b cursor-pointer transition-colors
                        ${isSelected ? 'bg-blue-50 hover:bg-blue-100' : isPending ? 'bg-orange-50 hover:bg-orange-100' : 'hover:bg-gray-50'}`}>
                      <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                        <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(key)}
                          className="w-4 h-4 rounded text-blue-600 cursor-pointer"/>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-start gap-1.5">
                          {isPending && <Clock className="w-3.5 h-3.5 text-orange-500 mt-0.5 flex-shrink-0" title="Pending review"/>}
                          <div>
                            <p className="font-medium text-gray-800 text-sm leading-tight">{g.library_name}</p>
                            <p className="text-xs text-gray-400">ID: {g.library_id}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded font-mono">{g.stage_name}</span>
                      </td>
                      <td className="px-4 py-3">{sectionCell(g)}</td>
                      <td className="px-4 py-3">
                        <span className="font-mono font-semibold text-gray-800">{g.subject_name}</span>
                        {g.subject_is_common && <span className="ml-1 text-xs text-purple-500">(common)</span>}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-gray-700">{pct(g.tax_rate)}</td>
                      <td className="px-4 py-3 text-right font-mono text-gray-700">{pct(g.revenue_percentage)}</td>
                      <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-center gap-2">
                          <Button size="sm" variant="outline" onClick={() => setEditTarget(g)} className="hover:bg-blue-50 hover:border-blue-300">
                            <Edit2 className="w-3.5 h-3.5 mr-1"/>Edit
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => { g._rowIds.forEach(id => deleteAssignment(id)); }}
                            className="text-red-500 hover:text-red-700 hover:border-red-300">
                            <Trash2 className="w-3.5 h-3.5"/>
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filteredGrouped.length === 0 && (
                  <tr><td colSpan="8" className="text-center py-12 text-gray-500">
                    No assignments match the current filters.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );

  // ── Final render ──────────────────────────────────────────────────────────
  const TABS = [
    { key: 'stages', label: `Stages (${stages.length})`, Icon: GraduationCap },
    { key: 'sections', label: `Sections (${sections.length})`, Icon: Users },
    { key: 'subjects', label: `Subjects (${subjects.length})`, Icon: BookOpen },
    { key: 'assignments', label: `Assignments (${assignments.length})`, Icon: CheckCircle },
  ];

  if (loading && stages.length === 0) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <p className="text-gray-500 text-lg">Loading settings…</p>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50 p-6 md:p-8">
      {editTarget && <EditModal assignment={editTarget} stages={stages} sections={sections} subjects={subjects} onSave={saveEdit} onClose={() => setEditTarget(null)}/>}
      {showBulkEdit && <BulkEditModal count={selectedCount} onSave={applyBulkEdit} onClose={() => setShowBulkEdit(false)}/>}
      {unmatchedResults && (
        <UnmatchedModal
          results={unmatchedResults}
          stages={stages}
          sections={sections}
          subjects={subjects}
          onClose={handleUnmatchedClose}
          onSaveManual={saveManualAssignment}/>
      )}

      <div className="max-w-7xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
            <SettingsIcon className="w-8 h-8 text-blue-600"/>Financial System Settings
          </h1>
          <p className="text-gray-500 mt-1">Configure stages, sections, subjects, and teacher assignments</p>
        </div>

        {msg.text && (
          <Alert className={msg.type === 'error' ? 'bg-red-50 border-red-300' : 'bg-green-50 border-green-300'}>
            <AlertDescription className={msg.type === 'error' ? 'text-red-800' : 'text-green-800'}>{msg.text}</AlertDescription>
          </Alert>
        )}

        <div className="flex gap-1 border-b overflow-x-auto">
          {TABS.map(({ key, label, Icon }) => (
            <button key={key} onClick={() => setActiveTab(key)}
              className={`flex items-center gap-2 px-5 py-3 text-sm font-medium whitespace-nowrap transition-colors
                ${activeTab === key ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500 hover:text-gray-800'}`}>
              <Icon className="w-4 h-4"/>{label}
            </button>
          ))}
        </div>

        {activeTab === 'stages' && tabStagesJSX}
        {activeTab === 'sections' && tabSectionsJSX}
        {activeTab === 'subjects' && tabSubjectsJSX}
        {activeTab === 'assignments' && tabAssignmentsJSX}
      </div>
    </div>
  );
};

export default Settings;
