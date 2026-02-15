// FILE: frontend/src/pages/Settings.jsx
import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Alert, AlertDescription } from '../components/ui/alert';
import financialApi from '../services/financial_api';
import {
  Settings as SettingsIcon, Plus, Trash2, Save, Users,
  BookOpen, GraduationCap, CheckCircle, X, Edit2, AlertTriangle,
} from 'lucide-react';

const pct  = (v) => `${(v * 100).toFixed(2)}%`;
const fNum = (s) => parseFloat(s) || 0;

// ── EditModal ─────────────────────────────────────────────────────────────────
const EditModal = ({ assignment, stages, sections, subjects, onSave, onClose }) => {
  const [form, setForm] = useState({
    stage_id:           assignment.stage_id,
    section_id:         assignment.section_id ?? '',
    subject_id:         assignment.subject_id,
    tax_rate:           (assignment.tax_rate * 100).toFixed(2),
    revenue_percentage: (assignment.revenue_percentage * 100).toFixed(2),
  });
  const [saving, setSaving] = useState(false);
  const modalSections = sections.filter(s => s.stage_id === Number(form.stage_id));
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(assignment.id, {
        stage_id:           Number(form.stage_id),
        section_id:         form.section_id !== '' ? Number(form.section_id) : null,
        subject_id:         Number(form.subject_id),
        tax_rate:           fNum(form.tax_rate) / 100,
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
  const [tax,    setTax]    = useState('');
  const [rev,    setRev]    = useState('');
  const [saving, setSaving] = useState(false);
  const handleSave = async () => {
    if (tax === '' && rev === '') { alert('Enter at least one value to update.'); return; }
    setSaving(true);
    try {
      const payload = {};
      if (tax !== '') payload.tax_rate           = fNum(tax) / 100;
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
          <p className="text-sm text-gray-500">Leave a field blank to keep existing values unchanged.</p>
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

// ── ENHANCED UnmatchedModal ───────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════
// COMPLETE FIXED UnmatchedModal - Replace in Settings.jsx
// ══════════════════════════════════════════════════════════════════════════════

const UnmatchedModal = ({ results, stages, sections, subjects, onClose, onSaveManual, onDeleteLibrary }) => {
  const [editingItems, setEditingItems] = useState({});
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(new Set());
  
  const unmatched = results.filter(r => !r.matched);
  const matched   = results.filter(r =>  r.matched).length;

  // ✅ FIX 1: Initialize editing state with EXACT code matching
  useEffect(() => {
    const initial = {};
    unmatched.forEach(r => {
      const parsedStageCode = (r.stage_code || '').toUpperCase().trim();
      const parsedSectionCode = (r.section_code || '').toUpperCase().trim();
      const parsedSubjectCode = (r.subject_code || '').toUpperCase().trim();

      // Find exact matches
      const stageMatch = stages.find(s => s.code.toUpperCase() === parsedStageCode);
      const subjectMatch = subjects.find(s => s.code.toUpperCase() === parsedSubjectCode);
      
      initial[r.library_id] = {
        library_id: r.library_id,
        library_name: r.library_name,
        stage_id: stageMatch?.id?.toString() || '',
        section_id: '',
        subject_id: subjectMatch?.id?.toString() || '',
        stage_code: parsedStageCode,
        section_code: parsedSectionCode,
        subject_code: parsedSubjectCode,
      };
      
      // Auto-select section if stage found and section code exists
      if (stageMatch && parsedSectionCode) {
        const sectionMatch = sections.find(s => 
          s.stage_id === stageMatch.id && 
          s.code.toUpperCase() === parsedSectionCode
        );
        if (sectionMatch) {
          initial[r.library_id].section_id = sectionMatch.id.toString();
        }
      }
    });
    setEditingItems(initial);
    console.log('Initialized editing items:', initial); // Debug log
  }, [unmatched, stages, sections, subjects]);

  // ✅ FIX 2: Proper state update function
  const updateItem = (libId, field, value) => {
    console.log(`Updating ${field} for library ${libId} to:`, value); // Debug log
    setEditingItems(prev => {
      const updated = {
        ...prev,
        [libId]: {
          ...(prev[libId] || {}),
          [field]: value
        }
      };
      console.log('Updated editingItems:', updated); // Debug log
      return updated;
    });

    // Reset section when stage changes
    if (field === 'stage_id') {
      setTimeout(() => {
        setEditingItems(prev => ({
          ...prev,
          [libId]: {
            ...(prev[libId] || {}),
            section_id: ''
          }
        }));
      }, 0);
    }
  };

  // ✅ FIX 3: Selection handlers
  const toggleSelectOne = (libId) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(libId) ? next.delete(libId) : next.add(libId);
      return next;
    });
  };

  const toggleSelectAll = () => {
    const allLibIds = Object.keys(editingItems).map(id => parseInt(id));
    setSelectedIds(prev => {
      if (prev.size === allLibIds.length) {
        return new Set();
      } else {
        return new Set(allLibIds);
      }
    });
  };

  // ✅ FIX 4: Save single assignment
  const handleSaveOne = async (libId) => {
    const item = editingItems[libId];
    if (!item) {
      alert('Item not found');
      return;
    }
    
    if (!item.stage_id || item.stage_id === '') {
      alert('Stage is required');
      return;
    }
    
    if (!item.subject_id || item.subject_id === '') {
      alert('Subject is required');
      return;
    }
    
    setSaving(true);
    try {
      await onSaveManual({
        library_id: parseInt(item.library_id),
        library_name: item.library_name,
        stage_id: parseInt(item.stage_id),
        section_id: item.section_id && item.section_id !== '' ? parseInt(item.section_id) : null,
        subject_id: parseInt(item.subject_id),
        tax_rate: 0.0,
        revenue_percentage: 0.95,
      });
      
      // Remove from editing list on success
      setEditingItems(prev => {
        const next = { ...prev };
        delete next[libId];
        return next;
      });
      setSelectedIds(prev => {
        const next = new Set(prev);
        next.delete(libId);
        return next;
      });
    } catch (err) {
      alert('Failed to save: ' + (err?.response?.data?.detail || err?.message || 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  // ✅ FIX 5: Bulk save selected
  const handleSaveSelected = async () => {
    const selectedItems = Array.from(selectedIds)
      .map(id => editingItems[id])
      .filter(item => item && item.stage_id && item.stage_id !== '' && item.subject_id && item.subject_id !== '');
    
    if (selectedItems.length === 0) {
      alert('No valid items selected (Stage and Subject required)');
      return;
    }

    if (!window.confirm(`Save ${selectedItems.length} assignments?`)) return;

    setSaving(true);
    let successCount = 0;
    let failCount = 0;

    for (const item of selectedItems) {
      try {
        await onSaveManual({
          library_id: parseInt(item.library_id),
          library_name: item.library_name,
          stage_id: parseInt(item.stage_id),
          section_id: item.section_id && item.section_id !== '' ? parseInt(item.section_id) : null,
          subject_id: parseInt(item.subject_id),
          tax_rate: 0.0,
          revenue_percentage: 0.95,
        });
        successCount++;
        
        // Remove from lists
        setEditingItems(prev => {
          const next = { ...prev };
          delete next[item.library_id];
          return next;
        });
        setSelectedIds(prev => {
          const next = new Set(prev);
          next.delete(item.library_id);
          return next;
        });
      } catch (err) {
        console.error(`Failed to save library ${item.library_id}:`, err);
        failCount++;
      }
    }

    setSaving(false);
    alert(`Saved ${successCount} assignments${failCount > 0 ? `, ${failCount} failed` : ''}`);
  };

  // ✅ FIX 6: Delete single
  const handleDeleteOne = async (libId) => {
    if (!window.confirm('Remove this library from the list?')) return;
    
    setDeleting(prev => new Set(prev).add(libId));
    try {
      if (onDeleteLibrary) {
        await onDeleteLibrary(libId);
      }
      setEditingItems(prev => {
        const next = { ...prev };
        delete next[libId];
        return next;
      });
      setSelectedIds(prev => {
        const next = new Set(prev);
        next.delete(libId);
        return next;
      });
    } catch (err) {
      alert('Failed to remove');
    } finally {
      setDeleting(prev => {
        const next = new Set(prev);
        next.delete(libId);
        return next;
      });
    }
  };

  // ✅ FIX 7: Bulk delete
  const handleDeleteSelected = async () => {
    if (selectedIds.size === 0) {
      alert('No items selected');
      return;
    }

    if (!window.confirm(`Remove ${selectedIds.size} libraries from the list?`)) return;

    const idsToDelete = Array.from(selectedIds);
    
    for (const libId of idsToDelete) {
      setDeleting(prev => new Set(prev).add(libId));
      try {
        if (onDeleteLibrary) {
          await onDeleteLibrary(libId);
        }
        setEditingItems(prev => {
          const next = { ...prev };
          delete next[libId];
          return next;
        });
      } catch (err) {
        console.error(`Failed to delete library ${libId}`);
      } finally {
        setDeleting(prev => {
          const next = new Set(prev);
          next.delete(libId);
          return next;
        });
      }
    }

    setSelectedIds(new Set());
  };

  const remainingItems = Object.values(editingItems);
  const allSelected = remainingItems.length > 0 && selectedIds.size === remainingItems.length;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col">
        
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
                {selectedIds.size > 0 && <> · <span className="text-blue-600 font-semibold">{selectedIds.size} selected</span></>}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5"/>
          </button>
        </div>

        {/* Instructions */}
        <div className="px-6 py-3 bg-blue-50 border-b border-blue-100 flex-shrink-0">
          <p className="text-sm text-blue-800">
            <strong>⚠️ IMPORTANT:</strong> If subjects are missing from dropdowns, go to <strong>Subjects tab</strong> and create them first (use simple codes like <code className="bg-blue-100 px-1 rounded">PHYS</code>, not <code className="bg-red-100 px-1 rounded">PHYS-AR</code>).
          </p>
        </div>

        {/* ✅ BULK ACTIONS BAR */}
        {remainingItems.length > 0 && (
          <div className="px-6 py-3 bg-gray-50 border-b flex items-center justify-between flex-shrink-0">
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input 
                  type="checkbox" 
                  checked={allSelected}
                  onChange={toggleSelectAll}
                  className="w-4 h-4 rounded text-blue-600 cursor-pointer"
                />
                <span className="text-sm font-medium text-gray-700">
                  {allSelected ? 'Deselect All' : 'Select All'}
                </span>
              </label>
              {selectedIds.size > 0 && (
                <button 
                  onClick={() => setSelectedIds(new Set())}
                  className="text-xs text-gray-400 hover:text-gray-600 underline">
                  Clear ({selectedIds.size})
                </button>
              )}
            </div>
            {selectedIds.size > 0 && (
              <div className="flex items-center gap-2">
                <Button 
                  size="sm"
                  onClick={handleSaveSelected}
                  disabled={saving}
                  className="bg-green-600 hover:bg-green-700 text-white">
                  <Save className="w-3.5 h-3.5 mr-1.5"/>
                  Save Selected ({selectedIds.size})
                </Button>
                <Button 
                  size="sm"
                  variant="outline"
                  onClick={handleDeleteSelected}
                  disabled={saving}
                  className="text-red-600 border-red-300 hover:bg-red-50">
                  <Trash2 className="w-3.5 h-3.5 mr-1.5"/>
                  Remove Selected
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Scrollable list */}
        <div className="overflow-y-auto flex-1 px-6 py-4">
          {remainingItems.length === 0 ? (
            <div className="text-center py-12">
              <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-3"/>
              <p className="text-lg font-semibold text-gray-700">All libraries processed!</p>
              <p className="text-sm text-gray-500">Close this dialog to see your assignments.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {remainingItems.map(item => {
                if (!item) return null;
                
                const stageObj = stages.find(s => s.id === parseInt(item.stage_id));
                const availableSections = stageObj ? sections.filter(s => s.stage_id === stageObj.id) : [];
                const subjectObj = subjects.find(s => s.id === parseInt(item.subject_id));
                const isDeleting = deleting.has(item.library_id);
                const isSelected = selectedIds.has(item.library_id);
                
                // Check if all required fields are filled
                const canSave = item.stage_id && item.stage_id !== '' && item.subject_id && item.subject_id !== '';

                return (
                  <div key={item.library_id} 
                    className={`border-2 rounded-lg p-4 transition-all ${
                      isDeleting ? 'border-red-300 bg-red-50 opacity-50' : 
                      isSelected ? 'border-blue-300 bg-blue-50' :
                      'border-orange-200 bg-orange-50'
                    }`}>
                    
                    {/* Selection checkbox + Library name */}
                    <div className="flex items-start gap-3 mb-3">
                      <input 
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelectOne(item.library_id)}
                        disabled={isDeleting}
                        className="mt-1 w-4 h-4 rounded text-blue-600 cursor-pointer flex-shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-gray-800 mb-1 truncate">{item.library_name}</p>
                        <div className="flex gap-2 flex-wrap">
                          <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">ID: {item.library_id}</span>
                          {item.stage_code && (
                            <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded font-mono">
                              Parsed: {item.stage_code}
                            </span>
                          )}
                          {item.section_code && (
                            <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded font-mono">
                              {item.section_code}
                            </span>
                          )}
                          {item.subject_code && (
                            <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded font-mono">
                              {item.subject_code}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* ✅ FIXED DROPDOWNS - Controlled components with proper value binding */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                      
                      {/* Stage Dropdown */}
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">
                          Stage <span className="text-red-500">*</span>
                        </label>
                        <select 
                          className="w-full h-9 px-3 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none disabled:bg-gray-100 disabled:cursor-not-allowed"
                          value={item.stage_id || ''}
                          onChange={(e) => {
                            console.log('Stage changed to:', e.target.value);
                            updateItem(item.library_id, 'stage_id', e.target.value);
                          }}
                          disabled={isDeleting || saving}>
                          <option value="">Select stage...</option>
                          {stages.map(s => (
                            <option key={s.id} value={s.id}>
                              {s.name} ({s.code})
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Section Dropdown */}
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">
                          Section <span className="text-gray-400 text-xs">(optional for common subjects)</span>
                        </label>
                        <select 
                          className="w-full h-9 px-3 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none disabled:bg-gray-100 disabled:cursor-not-allowed"
                          value={item.section_id || ''}
                          onChange={(e) => {
                            console.log('Section changed to:', e.target.value);
                            updateItem(item.library_id, 'section_id', e.target.value);
                          }}
                          disabled={!item.stage_id || item.stage_id === '' || isDeleting || saving}>
                          <option value="">None (Common Subject)</option>
                          {availableSections.map(s => (
                            <option key={s.id} value={s.id}>
                              {s.name} ({s.code})
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Subject Dropdown - SHOW ALL SUBJECTS */}
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">
                          Subject <span className="text-red-500">*</span>
                        </label>
                        <select 
                          className="w-full h-9 px-3 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none disabled:bg-gray-100 disabled:cursor-not-allowed"
                          value={item.subject_id || ''}
                          onChange={(e) => {
                            console.log('Subject changed to:', e.target.value);
                            updateItem(item.library_id, 'subject_id', e.target.value);
                          }}
                          disabled={isDeleting || saving}>
                          <option value="">Select subject...</option>
                          {subjects.map(s => (
                            <option key={s.id} value={s.id}>
                              {s.name} ({s.code}){s.is_common ? ' — Common' : ''}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* Action buttons */}
                    <div className="flex gap-2">
                      <Button 
                        size="sm"
                        onClick={() => handleSaveOne(item.library_id)}
                        disabled={!canSave || saving || isDeleting}
                        className="flex-1 bg-green-600 hover:bg-green-700 text-white disabled:opacity-50 disabled:cursor-not-allowed">
                        <Save className="w-3.5 h-3.5 mr-1.5"/>
                        {saving ? 'Saving...' : 'Save Assignment'}
                      </Button>
                      
                      <Button 
                        size="sm"
                        variant="outline"
                        onClick={() => handleDeleteOne(item.library_id)}
                        disabled={saving || isDeleting}
                        className="text-red-600 border-red-300 hover:bg-red-50 disabled:opacity-50">
                        <Trash2 className="w-3.5 h-3.5 mr-1.5"/>
                        {isDeleting ? 'Removing...' : 'Remove'}
                      </Button>
                    </div>

                    {/* Validation messages */}
                    {!canSave && (
                      <p className="text-xs text-orange-600 mt-2 flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3 flex-shrink-0"/>
                        Stage and Subject are required to save
                      </p>
                    )}
                    
                    {/* Subject not found warning */}
                    {item.subject_code && (!item.subject_id || item.subject_id === '') && (
                      <p className="text-xs text-red-600 mt-1 flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3 flex-shrink-0"/>
                        Subject <code className="bg-red-100 px-1 rounded font-mono">{item.subject_code}</code> not found. 
                        Create it in Subjects tab first.
                      </p>
                    )}
                    
                    {/* Subject compatibility hint */}
                    {item.subject_id && item.subject_id !== '' && subjectObj && (
                      <p className="text-xs text-gray-500 mt-1">
                        {subjectObj.is_common 
                          ? '✓ Common subject — leave Section empty to apply to all sections'
                          : '✓ Section-specific subject — select GEN or LANG section'}
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
              {remainingItems.length === 0 
                ? 'All done! 🎉' 
                : `${remainingItems.length} ${remainingItems.length === 1 ? 'library' : 'libraries'} remaining`}
            </p>
            <Button onClick={onClose} className="bg-gray-800 hover:bg-gray-900 text-white">
              <X className="w-4 h-4 mr-2"/>
              {remainingItems.length === 0 ? 'Close' : 'Close & Review Later'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default UnmatchedModal;

// ── Main Settings ─────────────────────────────────────────────────────────────
const Settings = () => {
  const [stages,      setStages]      = useState([]);
  const [sections,    setSections]    = useState([]);
  const [subjects,    setSubjects]    = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [activeTab,   setActiveTab]   = useState('stages');
  const [msg,         setMsg]         = useState({ text: '', type: '' });

  const [newStage,   setNewStage]   = useState({ code: '', name: '', display_order: 0 });
  const [newSection, setNewSection] = useState({ stage_id: '', code: '', name: '' });
  const [newSubject, setNewSubject] = useState({ code: '', name: '', is_common: false });

  // Assignments tab state
  const [filterStage,      setFilterStage]      = useState('');
  const [filterSection,    setFilterSection]    = useState('');
  const [filterSubject,    setFilterSubject]    = useState('');
  const [selectedIds,      setSelectedIds]      = useState(new Set());
  const [editTarget,       setEditTarget]       = useState(null);
  const [showBulkEdit,     setShowBulkEdit]     = useState(false);
  const [unmatchedResults, setUnmatchedResults] = useState(null);

  const flash  = useCallback((text, type = 'success') => {
    setMsg({ text, type });
    setTimeout(() => setMsg({ text: '', type: '' }), 5000);
  }, []);
  const errMsg = (err) => err?.response?.data?.detail || err?.message || 'Unknown error';

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

  useEffect(() => { loadAll(); }, [loadAll]);

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

  // Manual assignment save from unmatched modal
  const saveManualAssignment = async (assignment) => {
    try {
      await financialApi.createTeacherAssignment(assignment);
      flash('Assignment created successfully!');
      await loadAll();
    } catch (err) {
      flash('Error creating assignment: ' + errMsg(err), 'error');
      throw err;
    }
  };

  // Delete library from unmatched modal (just removes from UI - no backend action needed)
  const deleteLibraryFromUnmatched = async (libId) => {
    // Just a UI operation - library is simply not processed
    flash(`Library ${libId} removed from unmatched list`);
  };

  // ── Filtering ─────────────────────────────────────────────────────────────
  const filteredAssignments = assignments.filter(a => {
    if (filterStage   && a.stage_id   !== Number(filterStage))       return false;
    if (filterSection && String(a.section_id) !== filterSection)     return false;
    if (filterSubject && a.subject_id !== Number(filterSubject))     return false;
    return true;
  });

  // Dynamic section options — only sections of selected stage
  const sectionOptions = filterStage
    ? sections.filter(s => s.stage_id === Number(filterStage))
    : sections;

  // Dynamic subject options — only subjects appearing in stage+section-filtered assignments
  const baseForSubjects = assignments.filter(a => {
    if (filterStage   && a.stage_id   !== Number(filterStage))       return false;
    if (filterSection && String(a.section_id) !== filterSection)     return false;
    return true;
  });
  const subjectIdsInBase = new Set(baseForSubjects.map(a => a.subject_id));
  const subjectOptions   = subjects.filter(s => subjectIdsInBase.has(s.id));

  const handleFilterStage = (v) => {
    setFilterStage(v); setFilterSection(''); setFilterSubject(''); setSelectedIds(new Set());
  };
  const handleFilterSection = (v) => {
    setFilterSection(v); setFilterSubject(''); setSelectedIds(new Set());
  };
  const handleFilterSubject = (v) => {
    setFilterSubject(v); setSelectedIds(new Set());
  };

  // ── Selection ─────────────────────────────────────────────────────────────
  const allSelected = filteredAssignments.length > 0 &&
    filteredAssignments.every(a => selectedIds.has(a.id));

  const toggleSelectAll = () => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (allSelected) { filteredAssignments.forEach(a => next.delete(a.id)); }
      else             { filteredAssignments.forEach(a => next.add(a.id));    }
      return next;
    });
  };

  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const selectedCount = filteredAssignments.filter(a => selectedIds.has(a.id)).length;
  const someSelected  = selectedCount > 0;

  // ── Bulk actions ──────────────────────────────────────────────────────────
  const bulkDelete = async () => {
    const targets = someSelected
      ? filteredAssignments.filter(a => selectedIds.has(a.id))
      : filteredAssignments;
    if (targets.length === 0) return;
    const label = someSelected ? `${targets.length} selected` : `all ${targets.length} visible`;
    if (!window.confirm(`Delete ${label} assignments? This cannot be undone.`)) return;
    setLoading(true);
    let failed = 0;
    await Promise.all(targets.map(a => financialApi.deleteTeacherAssignment(a.id).catch(() => { failed++; })));
    setSelectedIds(new Set());
    flash(`Deleted ${targets.length - failed} assignments${failed ? ` (${failed} failed)` : ''}`);
    loadAll();
  };

  const applyBulkEdit = async (payload) => {
    const targets = filteredAssignments.filter(a => selectedIds.has(a.id));
    if (targets.length === 0) { flash('No assignments selected', 'error'); return; }
    let failed = 0;
    await Promise.all(targets.map(a => financialApi.updateTeacherAssignment(a.id, payload).catch(() => { failed++; })));
    setShowBulkEdit(false); setSelectedIds(new Set());
    flash(`Updated ${targets.length - failed} assignments${failed ? ` (${failed} failed)` : ''}`);
    loadAll();
  };

  // ── UPDATED Section cell: shows "All Sections" for common subjects (section_id = NULL) ──
  const sectionCell = (a) => {
    if (!a.section_id) {
      // Common subject - applies to ALL sections
      return (
        <span className="text-xs px-2 py-1 rounded bg-purple-100 text-purple-700 font-semibold">
          All Sections
        </span>
      );
    }
    
    const secObj = sections.find(s => s.id === a.section_id);
    const code = secObj ? secObj.code : (a.section_name || '?');
    const name = secObj ? secObj.name : '';
    const isGen = code.toUpperCase().includes('GEN');
    
    return (
      <div>
        <span className={`text-xs px-2 py-0.5 rounded font-mono font-bold
          ${isGen ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
          {code}
        </span>
        {name && <div className="text-xs text-gray-400 underline mt-0.5 leading-tight">{name}</div>}
      </div>
    );
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Inline tab JSX (no inner components — prevents focus loss)
  // ─────────────────────────────────────────────────────────────────────────
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
                    <div>
                      <p className="font-semibold text-gray-800">{s.name}</p>
                      <p className="text-xs text-gray-400">Order: {s.display_order}</p>
                    </div>
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
            <strong>Section codes:</strong> Use <code className="bg-yellow-100 px-1 rounded">GEN</code> for Arabic-taught subjects and <code className="bg-yellow-100 px-1 rounded">LANG</code> for English-taught subjects.
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
                <label className="block text-sm font-medium text-gray-700 mb-1">Code * (GEN / LANG)</label>
                <Input placeholder="GEN or LANG" value={newSection.code} onChange={e => setNewSection({ ...newSection, code: e.target.value.toUpperCase() })} required/>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
                <Input placeholder="General Section, Language Section" value={newSection.name} onChange={e => setNewSection({ ...newSection, name: e.target.value })} required/>
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
                          <span className={`font-mono font-bold px-2 py-0.5 rounded text-sm ${sec.code === 'GEN' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>{sec.code}</span>
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
                  <span className="text-sm font-medium text-gray-700">Common (GEN + LANG)</span>
                </label>
              </div>
            </div>
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
              <strong>Common subjects</strong> (AR, EN, HX, S.S) appear in all sections — leave section empty when creating assignments.<br/>
              <strong>Section subjects</strong> (ISC, BIO, CH, PHYS, MATH, PURE-MATH, APPLIED-MATH…) are specific to GEN or LANG.
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

      {/* Auto-match */}
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Users className="w-5 h-5"/>Teacher Assignments</CardTitle></CardHeader>
        <CardContent>
          <div className="flex items-center flex-wrap gap-4">
            <Button onClick={autoMatch} disabled={loading} className="bg-blue-600 hover:bg-blue-700">
              <CheckCircle className="w-4 h-4 mr-2"/>{loading ? 'Running…' : 'Auto-Match All Libraries'}
            </Button>
            <span className="text-sm text-gray-500">Total: <strong>{assignments.length}</strong> assignments</span>
          </div>
        </CardContent>
      </Card>

      {/* Filters — 3 dynamic dropdowns */}
      <Card>
        <CardContent className="pt-4 pb-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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
          </div>
        </CardContent>
      </Card>

      {/* Bulk action bar */}
      <Card>
        <CardContent className="pt-3 pb-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-600">
                Showing <strong>{filteredAssignments.length}</strong>
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
              {filteredAssignments.length > 0 && (
                <Button size="sm" variant="outline" onClick={bulkDelete} disabled={loading}
                  className="text-red-600 border-red-300 hover:bg-red-50 hover:border-red-500">
                  <Trash2 className="w-3.5 h-3.5 mr-1.5"/>
                  {someSelected ? `Delete Selected (${selectedCount})` : `Delete All (${filteredAssignments.length})`}
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b">
                  <th className="px-4 py-3 w-10">
                    <input type="checkbox" checked={allSelected} onChange={toggleSelectAll}
                      className="w-4 h-4 rounded text-blue-600 cursor-pointer"
                      title={allSelected ? 'Deselect all' : 'Select all visible'}/>
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Library</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Stage</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Section</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Subject</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">Tax %</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">Revenue %</th>
                  <th className="text-center px-4 py-3 font-medium text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredAssignments.map(a => {
                  const isSelected = selectedIds.has(a.id);
                  return (
                    <tr key={a.id} onClick={() => toggleSelect(a.id)}
                      className={`border-b cursor-pointer transition-colors
                        ${isSelected ? 'bg-blue-50 hover:bg-blue-100' : 'hover:bg-gray-50'}`}>
                      <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                        <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(a.id)}
                          className="w-4 h-4 rounded text-blue-600 cursor-pointer"/>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-800 text-sm leading-tight">{a.library_name}</p>
                        <p className="text-xs text-gray-400">ID: {a.library_id}</p>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded font-mono">{a.stage_name}</span>
                      </td>
                      <td className="px-4 py-3">{sectionCell(a)}</td>
                      <td className="px-4 py-3">
                        <span className="font-mono font-semibold text-gray-800">{a.subject_name}</span>
                        {a.subject_is_common && <span className="ml-1 text-xs text-purple-500">(common)</span>}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-gray-700">{pct(a.tax_rate)}</td>
                      <td className="px-4 py-3 text-right font-mono text-gray-700">{pct(a.revenue_percentage)}</td>
                      <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-center gap-2">
                          <Button size="sm" variant="outline" onClick={() => setEditTarget(a)} className="hover:bg-blue-50 hover:border-blue-300">
                            <Edit2 className="w-3.5 h-3.5 mr-1"/>Edit
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => deleteAssignment(a.id)} className="text-red-500 hover:text-red-700 hover:border-red-300">
                            <Trash2 className="w-3.5 h-3.5"/>
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filteredAssignments.length === 0 && (
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
    { key: 'stages',      label: `Stages (${stages.length})`,          Icon: GraduationCap },
    { key: 'sections',    label: `Sections (${sections.length})`,       Icon: Users },
    { key: 'subjects',    label: `Subjects (${subjects.length})`,       Icon: BookOpen },
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
          onClose={() => { 
            setUnmatchedResults(null); 
            flash(`Auto-match complete. ${unmatchedResults.filter(r=>r.matched).length} matched, ${unmatchedResults.filter(r=>!r.matched).length} unmatched.`); 
          }}
          onSaveManual={saveManualAssignment}
          onDeleteLibrary={deleteLibraryFromUnmatched}
        />
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

        {activeTab === 'stages'      && tabStagesJSX}
        {activeTab === 'sections'    && tabSectionsJSX}
        {activeTab === 'subjects'    && tabSubjectsJSX}
        {activeTab === 'assignments' && tabAssignmentsJSX}
      </div>
    </div>
  );
};

export default Settings;
