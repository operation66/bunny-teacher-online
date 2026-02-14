// FILE: frontend/src/pages/Settings.jsx
import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Alert, AlertDescription } from '../components/ui/alert';
import financialApi from '../services/financial_api';
import {
  Settings as SettingsIcon, Plus, Trash2, Save, Users,
  BookOpen, GraduationCap, CheckCircle, X, Edit2,
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// Small helpers
// ─────────────────────────────────────────────────────────────────────────────
const pct  = (v) => `${(v * 100).toFixed(2)}%`;
const fNum = (s) => parseFloat(s) || 0;

// ─────────────────────────────────────────────────────────────────────────────
// Edit-assignment modal  (all fields editable)
// ─────────────────────────────────────────────────────────────────────────────
const EditModal = ({ assignment, stages, sections, subjects, onSave, onClose }) => {
  const [form, setForm] = useState({
    stage_id:           assignment.stage_id,
    section_id:         assignment.section_id ?? '',   // '' means "none / common"
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
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-lg font-bold text-gray-900">Edit Assignment</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {/* Library (read-only display) */}
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-xs text-gray-500 mb-1">Library</p>
            <p className="font-medium text-sm text-gray-800">{assignment.library_name}</p>
            <p className="text-xs text-gray-400">ID: {assignment.library_id}</p>
          </div>

          {/* Stage */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Stage</label>
            <select
              className="w-full h-10 px-3 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              value={form.stage_id}
              onChange={e => set('stage_id', e.target.value)}
            >
              {stages.map(s => (
                <option key={s.id} value={s.id}>{s.name} ({s.code})</option>
              ))}
            </select>
          </div>

          {/* Section */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Section <span className="text-gray-400 font-normal">(leave empty for common subjects)</span>
            </label>
            <select
              className="w-full h-10 px-3 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              value={form.section_id}
              onChange={e => set('section_id', e.target.value)}
            >
              <option value="">None (Common – both GEN &amp; LANG)</option>
              {modalSections.map(s => (
                <option key={s.id} value={s.id}>{s.name} ({s.code})</option>
              ))}
            </select>
          </div>

          {/* Subject */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Subject</label>
            <select
              className="w-full h-10 px-3 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              value={form.subject_id}
              onChange={e => set('subject_id', e.target.value)}
            >
              {subjects.map(s => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.code}){s.is_common ? ' — Common' : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Tax + Revenue */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Tax Rate %</label>
              <div className="relative">
                <Input
                  type="number" step="0.1" min="0" max="100"
                  value={form.tax_rate}
                  onChange={e => set('tax_rate', e.target.value)}
                  className="pr-8"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm pointer-events-none">%</span>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Revenue %</label>
              <div className="relative">
                <Input
                  type="number" step="0.1" min="0" max="100"
                  value={form.revenue_percentage}
                  onChange={e => set('revenue_percentage', e.target.value)}
                  className="pr-8"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm pointer-events-none">%</span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-3 px-6 py-4 border-t bg-gray-50 rounded-b-2xl">
          <Button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 bg-green-600 hover:bg-green-700 text-white"
          >
            <Save className="w-4 h-4 mr-2" />
            {saving ? 'Saving…' : 'Save Changes'}
          </Button>
          <Button variant="outline" onClick={onClose} className="flex-1">Cancel</Button>
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────
const Settings = () => {
  const [stages,      setStages]      = useState([]);
  const [sections,    setSections]    = useState([]);
  const [subjects,    setSubjects]    = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [activeTab,   setActiveTab]   = useState('stages');
  const [filterStage, setFilterStage] = useState('');
  const [editTarget,  setEditTarget]  = useState(null);  // assignment being edited
  const [msg,         setMsg]         = useState({ text: '', type: '' });

  const [newStage,   setNewStage]   = useState({ code: '', name: '', display_order: 0 });
  const [newSection, setNewSection] = useState({ stage_id: '', code: '', name: '' });
  const [newSubject, setNewSubject] = useState({ code: '', name: '', is_common: false });

  // ── message helper ──────────────────────────────────────────────────────
  const flash = useCallback((text, type = 'success') => {
    setMsg({ text, type });
    setTimeout(() => setMsg({ text: '', type: '' }), 5000);
  }, []);

  const errMsg = (err) =>
    err?.response?.data?.detail || err?.message || 'Unknown error';

  // ── load ────────────────────────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [st, sec, sub, asg] = await Promise.all([
        financialApi.getStages(),
        financialApi.getSections(),
        financialApi.getSubjects(),
        financialApi.getTeacherAssignments(),
      ]);
      setStages(st);
      setSections(sec);
      setSubjects(sub);
      setAssignments(asg);
    } catch (err) {
      flash('Error loading data: ' + errMsg(err), 'error');
    } finally {
      setLoading(false);
    }
  }, [flash]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // ── STAGES ──────────────────────────────────────────────────────────────
  const createStage = async (e) => {
    e.preventDefault();
    if (!newStage.code || !newStage.name) { flash('Code and Name are required', 'error'); return; }
    try {
      await financialApi.createStage({
        code: newStage.code.toUpperCase().trim(),
        name: newStage.name.trim(),
        display_order: parseInt(newStage.display_order) || 0,
      });
      flash('Stage created');
      setNewStage({ code: '', name: '', display_order: 0 });
      loadAll();
    } catch (err) { flash('Error: ' + errMsg(err), 'error'); }
  };

  const deleteStage = async (id) => {
    if (!window.confirm('Delete stage and all its sections & assignments?')) return;
    try { await financialApi.deleteStage(id); flash('Stage deleted'); loadAll(); }
    catch (err) { flash('Error: ' + errMsg(err), 'error'); }
  };

  // ── SECTIONS ────────────────────────────────────────────────────────────
  const createSection = async (e) => {
    e.preventDefault();
    if (!newSection.stage_id) { flash('Select a stage', 'error'); return; }
    try {
      await financialApi.createSection({ ...newSection, stage_id: parseInt(newSection.stage_id) });
      flash('Section created');
      setNewSection({ stage_id: '', code: '', name: '' });
      loadAll();
    } catch (err) { flash('Error: ' + errMsg(err), 'error'); }
  };

  const deleteSection = async (id) => {
    if (!window.confirm('Delete section?')) return;
    try { await financialApi.deleteSection(id); flash('Section deleted'); loadAll(); }
    catch (err) { flash('Error: ' + errMsg(err), 'error'); }
  };

  // ── SUBJECTS ────────────────────────────────────────────────────────────
  const createSubject = async (e) => {
    e.preventDefault();
    try {
      await financialApi.createSubject({ ...newSubject, code: newSubject.code.toUpperCase().trim() });
      flash('Subject created');
      setNewSubject({ code: '', name: '', is_common: false });
      loadAll();
    } catch (err) { flash('Error: ' + errMsg(err), 'error'); }
  };

  const deleteSubject = async (id) => {
    if (!window.confirm('Delete subject?')) return;
    try { await financialApi.deleteSubject(id); flash('Subject deleted'); loadAll(); }
    catch (err) { flash('Error: ' + errMsg(err), 'error'); }
  };

  // ── ASSIGNMENTS ─────────────────────────────────────────────────────────
  const autoMatch = async () => {
    if (!window.confirm('Run auto-match for all 288 libraries? Existing assignments are kept.')) return;
    setLoading(true);
    try {
      const r = await financialApi.autoMatchTeachers();
      flash(`Auto-match done: ${r.matched} matched, ${r.unmatched} unmatched out of ${r.total_libraries} libraries`);
      loadAll();
    } catch (err) { flash('Auto-match error: ' + errMsg(err), 'error'); setLoading(false); }
  };

  const saveEdit = async (id, payload) => {
    try {
      await financialApi.updateTeacherAssignment(id, payload);
      flash('Assignment updated');
      setEditTarget(null);
      loadAll();
    } catch (err) { flash('Save error: ' + errMsg(err), 'error'); throw err; }
  };

  const deleteAssignment = async (id) => {
    if (!window.confirm('Delete this assignment?')) return;
    try { await financialApi.deleteTeacherAssignment(id); flash('Deleted'); loadAll(); }
    catch (err) { flash('Error: ' + errMsg(err), 'error'); }
  };

  // ── DERIVED ─────────────────────────────────────────────────────────────
  const filteredAssignments = filterStage
    ? assignments.filter(a => a.stage_id === Number(filterStage))
    : assignments;

  // ── SECTION badge colour ─────────────────────────────────────────────────
  const sectionBadge = (a) => {
    if (!a.section_name) return <span className="text-xs px-2 py-0.5 rounded bg-purple-100 text-purple-700">—</span>;
    const isGen = a.section_name.toUpperCase().includes('GEN');
    return (
      <span className={`text-xs px-2 py-0.5 rounded font-mono font-semibold
        ${isGen ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
        {a.section_name}
      </span>
    );
  };

  // ────────────────────────────────────────────────────────────────────────
  // TAB: STAGES
  // ────────────────────────────────────────────────────────────────────────
  const TabStages = () => (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Plus className="w-5 h-5"/>Add New Stage</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={createStage} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Code *</label>
                <Input placeholder="S1, M2, J4" value={newStage.code}
                  onChange={e => setNewStage({ ...newStage, code: e.target.value.toUpperCase() })} required/>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
                <Input placeholder="Senior 1, Middle 2, Junior 4" value={newStage.name}
                  onChange={e => setNewStage({ ...newStage, name: e.target.value })} required/>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Display Order</label>
                <Input type="number" value={newStage.display_order}
                  onChange={e => setNewStage({ ...newStage, display_order: parseInt(e.target.value) || 0 })}/>
              </div>
            </div>
            <Button type="submit" className="bg-blue-600 hover:bg-blue-700">
              <Plus className="w-4 h-4 mr-2"/>Create Stage
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Existing Stages ({stages.length})</CardTitle></CardHeader>
        <CardContent>
          {stages.length === 0
            ? <p className="text-center py-8 text-gray-500">No stages yet.</p>
            : <div className="space-y-2">
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
                    <Button variant="outline" size="sm" onClick={() => deleteStage(s.id)}
                      className="text-red-500 hover:text-red-700 hover:border-red-300">
                      <Trash2 className="w-4 h-4"/>
                    </Button>
                  </div>
                ))}
              </div>
          }
        </CardContent>
      </Card>
    </div>
  );

  // ────────────────────────────────────────────────────────────────────────
  // TAB: SECTIONS
  // ────────────────────────────────────────────────────────────────────────
  const TabSections = () => (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Plus className="w-5 h-5"/>Add New Section</CardTitle></CardHeader>
        <CardContent>
          <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-800">
            <strong>Section codes:</strong> Use <code className="bg-yellow-100 px-1 rounded">GEN</code> for
            Arabic-taught subjects and <code className="bg-yellow-100 px-1 rounded">LANG</code> for
            English-taught subjects. These replace the old AR / EN section names.
          </div>
          <form onSubmit={createSection} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Stage *</label>
                <select className="w-full h-10 px-3 border rounded-lg text-sm"
                  value={newSection.stage_id}
                  onChange={e => setNewSection({ ...newSection, stage_id: e.target.value })} required>
                  <option value="">Select stage…</option>
                  {stages.map(s => <option key={s.id} value={s.id}>{s.name} ({s.code})</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Code * (GEN / LANG)</label>
                <Input placeholder="GEN or LANG" value={newSection.code}
                  onChange={e => setNewSection({ ...newSection, code: e.target.value.toUpperCase() })} required/>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
                <Input placeholder="General Section, Language Section" value={newSection.name}
                  onChange={e => setNewSection({ ...newSection, name: e.target.value })} required/>
              </div>
            </div>
            <Button type="submit" className="bg-green-600 hover:bg-green-700">
              <Plus className="w-4 h-4 mr-2"/>Create Section
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Existing Sections ({sections.length})</CardTitle></CardHeader>
        <CardContent>
          {stages.length === 0
            ? <p className="text-center py-8 text-gray-500">Create stages first.</p>
            : <div className="space-y-4">
                {stages.map(stage => {
                  const ss = sections.filter(s => s.stage_id === stage.id);
                  return (
                    <div key={stage.id} className="border rounded-lg p-4">
                      <p className="font-semibold text-blue-600 mb-3">{stage.name} ({stage.code})</p>
                      {ss.length === 0
                        ? <p className="text-sm text-gray-400 italic">No sections yet</p>
                        : ss.map(sec => (
                            <div key={sec.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg mb-2">
                              <div className="flex items-center gap-3">
                                <span className={`font-mono font-bold px-2 py-0.5 rounded text-sm
                                  ${sec.code === 'GEN' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
                                  {sec.code}
                                </span>
                                <span className="text-sm text-gray-700">{sec.name}</span>
                              </div>
                              <Button variant="outline" size="sm" onClick={() => deleteSection(sec.id)}
                                className="text-red-500 hover:text-red-700 hover:border-red-300">
                                <Trash2 className="w-4 h-4"/>
                              </Button>
                            </div>
                          ))
                      }
                    </div>
                  );
                })}
              </div>
          }
        </CardContent>
      </Card>
    </div>
  );

  // ────────────────────────────────────────────────────────────────────────
  // TAB: SUBJECTS
  // ────────────────────────────────────────────────────────────────────────
  const TabSubjects = () => (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Plus className="w-5 h-5"/>Add New Subject</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={createSubject} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Code *</label>
                <Input placeholder="AR, EN, ISC, BIO, MATH…" value={newSubject.code}
                  onChange={e => setNewSubject({ ...newSubject, code: e.target.value.toUpperCase() })} required/>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
                <Input placeholder="Arabic, Biology, Mathematics…" value={newSubject.name}
                  onChange={e => setNewSubject({ ...newSubject, name: e.target.value })} required/>
              </div>
              <div className="flex items-center pt-6">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={newSubject.is_common}
                    onChange={e => setNewSubject({ ...newSubject, is_common: e.target.checked })}
                    className="w-4 h-4 rounded text-blue-600"/>
                  <span className="text-sm font-medium text-gray-700">Common (GEN + LANG)</span>
                </label>
              </div>
            </div>
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
              <strong>Common subjects</strong> (AR, EN, HX, S.S) are taught in <em>all</em> sections —
              auto-match will create one row per section for each library.<br/>
              <strong>Section subjects</strong> (ISC, BIO, CHEM, PHYS, MATH…) are specific to
              GEN or LANG based on the <code className="bg-blue-100 px-1 rounded">AR</code> /
              <code className="bg-blue-100 px-1 rounded">EN</code> indicator after the subject
              code in the library name.
            </div>
            <Button type="submit" className="bg-purple-600 hover:bg-purple-700">
              <Plus className="w-4 h-4 mr-2"/>Create Subject
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Existing Subjects ({subjects.length})</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {[
              { label: 'Common Subjects', filter: true,  colour: 'purple' },
              { label: 'Section Subjects', filter: false, colour: 'green'  },
            ].map(({ label, filter, colour }) => (
              <div key={label} className="border rounded-lg p-4">
                <p className={`font-semibold text-lg mb-3 text-${colour}-600`}>{label}</p>
                {subjects.filter(s => s.is_common === filter).map(sub => (
                  <div key={sub.id} className={`flex items-center justify-between p-3 bg-${colour}-50 rounded-lg mb-2`}>
                    <div className="flex items-center gap-3">
                      <span className={`font-mono font-bold text-${colour}-600`}>{sub.code}</span>
                      <span className="text-sm text-gray-700">{sub.name}</span>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => deleteSubject(sub.id)}
                      className="text-red-500 hover:text-red-700">
                      <Trash2 className="w-4 h-4"/>
                    </Button>
                  </div>
                ))}
                {subjects.filter(s => s.is_common === filter).length === 0 && (
                  <p className="text-sm text-gray-400 italic">None yet</p>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );

  // ────────────────────────────────────────────────────────────────────────
  // TAB: ASSIGNMENTS
  // ────────────────────────────────────────────────────────────────────────
  const TabAssignments = () => (
    <div className="space-y-6">
      {/* Info + auto-match button */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Users className="w-5 h-5"/>Teacher Assignments</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert className="bg-blue-50 border-blue-200">
            <AlertDescription className="text-sm leading-relaxed">
              <strong>Parsing rules:</strong><br/>
              • <code>S1-AR-…</code> → AR is the <em>subject</em> (Arabic, common → both GEN &amp; LANG)<br/>
              • <code>S1-ISC-AR-…</code> → ISC is the subject, AR means <strong>GEN section</strong><br/>
              • <code>S1-BIO-EN-…</code> → BIO is the subject, EN means <strong>LANG section</strong><br/>
              • Default Revenue: <strong>95%</strong> · Default Tax: <strong>0%</strong>
            </AlertDescription>
          </Alert>

          <div className="flex items-center flex-wrap gap-4">
            <Button onClick={autoMatch} disabled={loading} className="bg-blue-600 hover:bg-blue-700">
              <CheckCircle className="w-4 h-4 mr-2"/>
              {loading ? 'Running…' : 'Auto-Match All Libraries'}
            </Button>
            <span className="text-sm text-gray-500">
              Total assignments: <strong>{assignments.length}</strong>
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Filter */}
      <Card>
        <CardContent className="pt-4 pb-3">
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium text-gray-700 whitespace-nowrap">Filter by Stage:</label>
            <select className="h-9 px-3 border rounded-lg text-sm min-w-[200px]"
              value={filterStage} onChange={e => setFilterStage(e.target.value)}>
              <option value="">All Stages ({assignments.length})</option>
              {stages.map(s => (
                <option key={s.id} value={s.id}>
                  {s.name} ({assignments.filter(a => a.stage_id === s.id).length})
                </option>
              ))}
            </select>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardHeader>
          <CardTitle>Assignments ({filteredAssignments.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b">
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
                {filteredAssignments.map(a => (
                  <tr key={a.id} className="border-b hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-800 text-sm leading-tight">{a.library_name}</p>
                      <p className="text-xs text-gray-400">ID: {a.library_id}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded font-mono">
                        {a.stage_name}
                      </span>
                    </td>
                    <td className="px-4 py-3">{sectionBadge(a)}</td>
                    <td className="px-4 py-3">
                      <span className="font-mono font-semibold text-gray-800">{a.subject_name}</span>
                      {a.subject_is_common && (
                        <span className="ml-1 text-xs text-purple-500">(common)</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-gray-700">{pct(a.tax_rate)}</td>
                    <td className="px-4 py-3 text-right font-mono text-gray-700">{pct(a.revenue_percentage)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-2">
                        <Button size="sm" variant="outline" onClick={() => setEditTarget(a)}
                          className="hover:bg-blue-50 hover:border-blue-300">
                          <Edit2 className="w-3.5 h-3.5 mr-1"/>Edit
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => deleteAssignment(a.id)}
                          className="text-red-500 hover:text-red-700 hover:border-red-300">
                          <Trash2 className="w-3.5 h-3.5"/>
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredAssignments.length === 0 && (
                  <tr>
                    <td colSpan="7" className="text-center py-12 text-gray-500">
                      No assignments yet. Click <strong>Auto-Match All Libraries</strong> above.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );

  // ────────────────────────────────────────────────────────────────────────
  // RENDER
  // ────────────────────────────────────────────────────────────────────────
  const TABS = [
    { key: 'stages',      label: `Stages (${stages.length})`,      Icon: GraduationCap },
    { key: 'sections',    label: `Sections (${sections.length})`,   Icon: Users },
    { key: 'subjects',    label: `Subjects (${subjects.length})`,   Icon: BookOpen },
    { key: 'assignments', label: `Assignments (${assignments.length})`, Icon: CheckCircle },
  ];

  if (loading && stages.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-500 text-lg">Loading settings…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6 md:p-8">
      {/* Edit modal */}
      {editTarget && (
        <EditModal
          assignment={editTarget}
          stages={stages}
          sections={sections}
          subjects={subjects}
          onSave={saveEdit}
          onClose={() => setEditTarget(null)}
        />
      )}

      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
            <SettingsIcon className="w-8 h-8 text-blue-600"/>
            Financial System Settings
          </h1>
          <p className="text-gray-500 mt-1">Configure stages, sections, subjects, and teacher assignments</p>
        </div>

        {/* Flash message */}
        {msg.text && (
          <Alert className={msg.type === 'error' ? 'bg-red-50 border-red-300' : 'bg-green-50 border-green-300'}>
            <AlertDescription className={msg.type === 'error' ? 'text-red-800' : 'text-green-800'}>
              {msg.text}
            </AlertDescription>
          </Alert>
        )}

        {/* Tabs */}
        <div className="flex gap-1 border-b overflow-x-auto">
          {TABS.map(({ key, label, Icon }) => (
            <button key={key} onClick={() => setActiveTab(key)}
              className={`flex items-center gap-2 px-5 py-3 text-sm font-medium whitespace-nowrap transition-colors
                ${activeTab === key
                  ? 'border-b-2 border-blue-600 text-blue-600'
                  : 'text-gray-500 hover:text-gray-800'}`}>
              <Icon className="w-4 h-4"/>
              {label}
            </button>
          ))}
        </div>

        {/* Content */}
        {activeTab === 'stages'      && <TabStages/>}
        {activeTab === 'sections'    && <TabSections/>}
        {activeTab === 'subjects'    && <TabSubjects/>}
        {activeTab === 'assignments' && <TabAssignments/>}
      </div>
    </div>
  );
};

export default Settings;
