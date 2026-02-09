// NEW FILE: frontend/src/pages/Settings.jsx
// Financial System Settings - Configure stages, sections, subjects, and teacher assignments

import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Alert, AlertDescription } from '../components/ui/alert';
import financialApi from '../services/financial_api';
import { Settings as SettingsIcon, Plus, Trash2, Save, Users, BookOpen, GraduationCap, CheckCircle } from 'lucide-react';

const Settings = () => {
  // States
  const [stages, setStages] = useState([]);
  const [sections, setSections] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState({ text: '', type: '' });

  // Form states
  const [newStage, setNewStage] = useState({ code: '', name: '', display_order: 0 });
  const [newSection, setNewSection] = useState({ stage_id: '', code: '', name: '' });
  const [newSubject, setNewSubject] = useState({ code: '', name: '', is_common: false });

  // UI states
  const [activeTab, setActiveTab] = useState('stages'); // stages, sections, subjects, assignments
  const [selectedStage, setSelectedStage] = useState(null);
  const [editingAssignment, setEditingAssignment] = useState(null);

  const showMessage = (text, type = 'success') => {
    setMessage({ text, type });
    setTimeout(() => setMessage({ text: '', type: '' }), 5000);
  };

  // Load data
  useEffect(() => {
    loadAllData();
  }, []);

  const loadAllData = async () => {
    setLoading(true);
    try {
      const [stagesData, sectionsData, subjectsData, assignmentsData] = await Promise.all([
        financialApi.getStages(),
        financialApi.getSections(),
        financialApi.getSubjects(),
        financialApi.getTeacherAssignments()
      ]);
      setStages(stagesData);
      setSections(sectionsData);
      setSubjects(subjectsData);
      setAssignments(assignmentsData);
    } catch (error) {
      showMessage('Error loading data: ' + (error.response?.data?.detail || error.message), 'error');
    } finally {
      setLoading(false);
    }
  };

  // ============================================
  // STAGE FUNCTIONS
  // ============================================
const handleCreateStage = async (e) => {
  e.preventDefault();
  
  // VALIDATION: Ensure all fields are present and valid
  if (!newStage.code || !newStage.name) {
    showMessage('Code and Name are required', 'error');
    return;
  }
  
  try {
    // Create payload with correct types
    const payload = {
      code: newStage.code.toUpperCase().trim(),
      name: newStage.name.trim(),
      display_order: parseInt(newStage.display_order) || 0
    };
    
    console.log('Creating stage with payload:', payload); // DEBUG
    
    await financialApi.createStage(payload);
    showMessage('Stage created successfully');
    setNewStage({ code: '', name: '', display_order: 0 });
    loadAllData();
  } catch (error) {
    console.error('Create stage error:', error.response?.data); // DEBUG
    showMessage('Error creating stage: ' + (error.response?.data?.detail || error.message), 'error');
  }
};
  
  const handleDeleteStage = async (stageId) => {
    if (!window.confirm('Are you sure? This will delete all sections and assignments for this stage.')) return;
    try {
      await financialApi.deleteStage(stageId);
      showMessage('Stage deleted successfully');
      loadAllData();
    } catch (error) {
      showMessage('Error deleting stage: ' + (error.response?.data?.detail || error.message), 'error');
    }
  };

  // ============================================
  // SECTION FUNCTIONS
  // ============================================
  const handleCreateSection = async (e) => {
    e.preventDefault();
    if (!newSection.stage_id) {
      showMessage('Please select a stage', 'error');
      return;
    }
    try {
      await financialApi.createSection(newSection);
      showMessage('Section created successfully');
      setNewSection({ stage_id: '', code: '', name: '' });
      loadAllData();
    } catch (error) {
      showMessage('Error creating section: ' + (error.response?.data?.detail || error.message), 'error');
    }
  };

  const handleDeleteSection = async (sectionId) => {
    if (!window.confirm('Are you sure? This will delete all assignments for this section.')) return;
    try {
      await financialApi.deleteSection(sectionId);
      showMessage('Section deleted successfully');
      loadAllData();
    } catch (error) {
      showMessage('Error deleting section: ' + (error.response?.data?.detail || error.message), 'error');
    }
  };

  // ============================================
  // SUBJECT FUNCTIONS
  // ============================================
  const handleCreateSubject = async (e) => {
    e.preventDefault();
    try {
      await financialApi.createSubject(newSubject);
      showMessage('Subject created successfully');
      setNewSubject({ code: '', name: '', is_common: false });
      loadAllData();
    } catch (error) {
      showMessage('Error creating subject: ' + (error.response?.data?.detail || error.message), 'error');
    }
  };

  const handleDeleteSubject = async (subjectId) => {
    if (!window.confirm('Are you sure? This will delete all assignments for this subject.')) return;
    try {
      await financialApi.deleteSubject(subjectId);
      showMessage('Subject deleted successfully');
      loadAllData();
    } catch (error) {
      showMessage('Error deleting subject: ' + (error.response?.data?.detail || error.message), 'error');
    }
  };

  // ============================================
  // TEACHER ASSIGNMENT FUNCTIONS
  // ============================================
  const handleAutoMatch = async () => {
    if (!window.confirm('This will automatically assign teachers to subjects based on library names. Continue?')) return;
    
    setLoading(true);
    try {
      const result = await financialApi.autoMatchTeachers();
      showMessage(`Auto-match complete: ${result.matched} matched, ${result.unmatched} unmatched`, 'success');
      loadAllData();
    } catch (error) {
      showMessage('Error auto-matching: ' + (error.response?.data?.detail || error.message), 'error');
      setLoading(false);
    }
  };

  const handleUpdateAssignment = async (assignmentId, data) => {
    try {
      await financialApi.updateTeacherAssignment(assignmentId, data);
      showMessage('Assignment updated successfully');
      setEditingAssignment(null);
      loadAllData();
    } catch (error) {
      showMessage('Error updating assignment: ' + (error.response?.data?.detail || error.message), 'error');
    }
  };

  const handleDeleteAssignment = async (assignmentId) => {
    if (!window.confirm('Are you sure you want to delete this assignment?')) return;
    try {
      await financialApi.deleteTeacherAssignment(assignmentId);
      showMessage('Assignment deleted successfully');
      loadAllData();
    } catch (error) {
      showMessage('Error deleting assignment: ' + (error.response?.data?.detail || error.message), 'error');
    }
  };

  // ============================================
  // RENDER FUNCTIONS
  // ============================================
  const renderStages = () => (
    <div className="space-y-6">
      {/* Create Form */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plus className="w-5 h-5" />
            Add New Stage
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreateStage} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="text-sm font-medium text-gray-700">Code *</label>
                <Input
                  placeholder="S1, M2, J4"
                  value={newStage.code}
                  onChange={(e) => setNewStage({ ...newStage, code: e.target.value.toUpperCase() })}
                  required
                />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Name *</label>
                <Input
                  placeholder="Senior 1, Middle 2, Junior 4"
                  value={newStage.name}
                  onChange={(e) => setNewStage({ ...newStage, name: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Display Order</label>
                <Input
                  type="number"
                  value={newStage.display_order}
                  onChange={(e) => setNewStage({ ...newStage, display_order: parseInt(e.target.value) })}
                />
              </div>
            </div>
            <Button type="submit" className="bg-blue-600 hover:bg-blue-700">
              <Plus className="w-4 h-4 mr-2" />
              Create Stage
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* List */}
      <Card>
        <CardHeader>
          <CardTitle>Existing Stages ({stages.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {stages.map(stage => (
              <div key={stage.id} className="flex items-center justify-between p-4 border rounded-lg hover:bg-gray-50">
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 bg-blue-100 rounded-lg flex items-center justify-center">
                    <span className="text-2xl font-bold text-blue-600">{stage.code}</span>
                  </div>
                  <div>
                    <div className="font-semibold text-lg">{stage.name}</div>
                    <div className="text-sm text-gray-500">Order: {stage.display_order}</div>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleDeleteStage(stage.id)}
                  className="text-red-600 hover:text-red-700"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            ))}
            {stages.length === 0 && (
              <div className="text-center py-8 text-gray-500">
                No stages yet. Create one above.
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );

  const renderSections = () => (
    <div className="space-y-6">
      {/* Create Form */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plus className="w-5 h-5" />
            Add New Section
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreateSection} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="text-sm font-medium text-gray-700">Stage *</label>
                <select
                  className="w-full h-10 px-3 border rounded-md"
                  value={newSection.stage_id}
                  onChange={(e) => setNewSection({ ...newSection, stage_id: parseInt(e.target.value) })}
                  required
                >
                  <option value="">Select Stage</option>
                  {stages.map(stage => (
                    <option key={stage.id} value={stage.id}>{stage.name} ({stage.code})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Code *</label>
                <Input
                  placeholder="AR, EN"
                  value={newSection.code}
                  onChange={(e) => setNewSection({ ...newSection, code: e.target.value.toUpperCase() })}
                  required
                />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Name *</label>
                <Input
                  placeholder="Arabic Section, English Section"
                  value={newSection.name}
                  onChange={(e) => setNewSection({ ...newSection, name: e.target.value })}
                  required
                />
              </div>
            </div>
            <Button type="submit" className="bg-green-600 hover:bg-green-700">
              <Plus className="w-4 h-4 mr-2" />
              Create Section
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* List by Stage */}
      <Card>
        <CardHeader>
          <CardTitle>Existing Sections ({sections.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {stages.map(stage => {
              const stageSections = sections.filter(s => s.stage_id === stage.id);
              return (
                <div key={stage.id} className="border rounded-lg p-4">
                  <div className="font-semibold text-lg mb-3 text-blue-600">{stage.name}</div>
                  <div className="space-y-2">
                    {stageSections.map(section => (
                      <div key={section.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                        <div className="flex items-center gap-3">
                          <span className="font-mono font-bold text-green-600">{section.code}</span>
                          <span>{section.name}</span>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleDeleteSection(section.id)}
                          className="text-red-600 hover:text-red-700"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    ))}
                    {stageSections.length === 0 && (
                      <div className="text-sm text-gray-500 italic">No sections for this stage</div>
                    )}
                  </div>
                </div>
              );
            })}
            {stages.length === 0 && (
              <div className="text-center py-8 text-gray-500">
                Create stages first before adding sections.
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );

  const renderSubjects = () => (
    <div className="space-y-6">
      {/* Create Form */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plus className="w-5 h-5" />
            Add New Subject
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreateSubject} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="text-sm font-medium text-gray-700">Code *</label>
                <Input
                  placeholder="MATH, AR, EN, HX, S.S"
                  value={newSubject.code}
                  onChange={(e) => setNewSubject({ ...newSubject, code: e.target.value.toUpperCase() })}
                  required
                />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Name *</label>
                <Input
                  placeholder="Mathematics, Arabic, English"
                  value={newSubject.name}
                  onChange={(e) => setNewSubject({ ...newSubject, name: e.target.value })}
                  required
                />
              </div>
              <div className="flex items-center pt-6">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newSubject.is_common}
                    onChange={(e) => setNewSubject({ ...newSubject, is_common: e.target.checked })}
                    className="w-4 h-4 text-blue-600 rounded"
                  />
                  <span className="text-sm font-medium">Common Subject</span>
                </label>
              </div>
            </div>
            <div className="text-sm text-gray-600 bg-blue-50 p-3 rounded">
              <strong>Common subjects</strong> (AR, EN, HX, S.S) appear in all sections. 
              <strong> Section subjects</strong> (MATH, SCI, etc.) are specific to sections (AR or EN).
            </div>
            <Button type="submit" className="bg-purple-600 hover:bg-purple-700">
              <Plus className="w-4 h-4 mr-2" />
              Create Subject
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* List */}
      <Card>
        <CardHeader>
          <CardTitle>Existing Subjects ({subjects.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Common Subjects */}
            <div className="border rounded-lg p-4">
              <h3 className="font-semibold text-lg mb-3 text-purple-600">Common Subjects</h3>
              <div className="space-y-2">
                {subjects.filter(s => s.is_common).map(subject => (
                  <div key={subject.id} className="flex items-center justify-between p-3 bg-purple-50 rounded-lg">
                    <div className="flex items-center gap-3">
                      <span className="font-mono font-bold text-purple-600">{subject.code}</span>
                      <span>{subject.name}</span>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDeleteSubject(subject.id)}
                      className="text-red-600 hover:text-red-700"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
                {subjects.filter(s => s.is_common).length === 0 && (
                  <div className="text-sm text-gray-500 italic">No common subjects yet</div>
                )}
              </div>
            </div>

            {/* Section-Specific Subjects */}
            <div className="border rounded-lg p-4">
              <h3 className="font-semibold text-lg mb-3 text-green-600">Section Subjects</h3>
              <div className="space-y-2">
                {subjects.filter(s => !s.is_common).map(subject => (
                  <div key={subject.id} className="flex items-center justify-between p-3 bg-green-50 rounded-lg">
                    <div className="flex items-center gap-3">
                      <span className="font-mono font-bold text-green-600">{subject.code}</span>
                      <span>{subject.name}</span>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDeleteSubject(subject.id)}
                      className="text-red-600 hover:text-red-700"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
                {subjects.filter(s => !s.is_common).length === 0 && (
                  <div className="text-sm text-gray-500 italic">No section subjects yet</div>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );

  const renderAssignments = () => (
    <div className="space-y-6">
      {/* Auto-Match Button */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="w-5 h-5" />
            Teacher Assignments
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <Alert className="bg-blue-50 border-blue-200">
              <AlertDescription>
                <strong>Auto-Match:</strong> Automatically assigns teachers to subjects based on library names.
                Library names should follow pattern: <code>S1-AR-P0046-Teacher</code> or <code>J4-EN-MATH-Teacher</code>
              </AlertDescription>
            </Alert>
            <Button 
              onClick={handleAutoMatch}
              className="bg-blue-600 hover:bg-blue-700"
              disabled={loading}
            >
              <CheckCircle className="w-4 h-4 mr-2" />
              Auto-Match Teachers from Libraries
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Filter */}
      <Card>
        <CardHeader>
          <CardTitle>Filter by Stage</CardTitle>
        </CardHeader>
        <CardContent>
          <select
            className="w-full md:w-64 h-10 px-3 border rounded-md"
            value={selectedStage || ''}
            onChange={(e) => setSelectedStage(e.target.value ? parseInt(e.target.value) : null)}
          >
            <option value="">All Stages</option>
            {stages.map(stage => (
              <option key={stage.id} value={stage.id}>{stage.name}</option>
            ))}
          </select>
        </CardContent>
      </Card>

      {/* Assignments List */}
      <Card>
        <CardHeader>
          <CardTitle>
            Teacher Assignments 
            ({selectedStage ? assignments.filter(a => a.stage_id === selectedStage).length : assignments.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50">
                  <th className="text-left p-3">Library</th>
                  <th className="text-left p-3">Stage</th>
                  <th className="text-left p-3">Section</th>
                  <th className="text-left p-3">Subject</th>
                  <th className="text-left p-3">Tax Rate %</th>
                  <th className="text-left p-3">Revenue %</th>
                  <th className="text-center p-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {assignments
                  .filter(a => !selectedStage || a.stage_id === selectedStage)
                  .map(assignment => (
                    <tr key={assignment.id} className="border-b hover:bg-gray-50">
                      <td className="p-3">
                        <div className="font-medium">{assignment.library_name}</div>
                        <div className="text-xs text-gray-500">ID: {assignment.library_id}</div>
                      </td>
                      <td className="p-3">{assignment.stage_name}</td>
                      <td className="p-3">
                        {assignment.subject_is_common ? (
                          <span className="text-xs bg-purple-100 text-purple-700 px-2 py-1 rounded">Common</span>
                        ) : (
                          assignment.section_name || 'N/A'
                        )}
                      </td>
                      <td className="p-3">
                        <span className="font-mono font-semibold">{assignment.subject_name}</span>
                      </td>
                      <td className="p-3">
                        {editingAssignment === assignment.id ? (
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            max="100"
                            defaultValue={(assignment.tax_rate * 100).toFixed(2)}
                            className="w-20"
                            id={`tax-${assignment.id}`}
                          />
                        ) : (
                          <span>{(assignment.tax_rate * 100).toFixed(2)}%</span>
                        )}
                      </td>
                      <td className="p-3">
                        {editingAssignment === assignment.id ? (
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            max="100"
                            defaultValue={(assignment.revenue_percentage * 100).toFixed(2)}
                            className="w-20"
                            id={`revenue-${assignment.id}`}
                          />
                        ) : (
                          <span>{(assignment.revenue_percentage * 100).toFixed(2)}%</span>
                        )}
                      </td>
                      <td className="p-3">
                        <div className="flex items-center justify-center gap-2">
                          {editingAssignment === assignment.id ? (
                            <>
                              <Button
                                size="sm"
                                onClick={() => {
                                  const taxRate = parseFloat(document.getElementById(`tax-${assignment.id}`).value) / 100;
                                  const revenuePct = parseFloat(document.getElementById(`revenue-${assignment.id}`).value) / 100;
                                  handleUpdateAssignment(assignment.id, {
                                    tax_rate: taxRate,
                                    revenue_percentage: revenuePct
                                  });
                                }}
                                className="bg-green-600 hover:bg-green-700"
                              >
                                <Save className="w-4 h-4" />
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setEditingAssignment(null)}
                              >
                                Cancel
                              </Button>
                            </>
                          ) : (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setEditingAssignment(assignment.id)}
                              >
                                Edit
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleDeleteAssignment(assignment.id)}
                                className="text-red-600 hover:text-red-700"
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
            {assignments.filter(a => !selectedStage || a.stage_id === selectedStage).length === 0 && (
              <div className="text-center py-8 text-gray-500">
                No assignments yet. Click "Auto-Match Teachers" to get started.
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 p-8 flex items-center justify-center">
        <div className="text-lg">Loading settings...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
              <SettingsIcon className="w-8 h-8 text-blue-600" />
              Financial System Settings
            </h1>
            <p className="text-gray-600 mt-1">Configure stages, sections, subjects, and teacher assignments</p>
          </div>
        </div>

        {/* Message */}
        {message.text && (
          <Alert className={message.type === 'error' ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200'}>
            <AlertDescription className={message.type === 'error' ? 'text-red-800' : 'text-green-800'}>
              {message.text}
            </AlertDescription>
          </Alert>
        )}

        {/* Tabs */}
        <div className="flex gap-2 border-b">
          <button
            onClick={() => setActiveTab('stages')}
            className={`px-6 py-3 font-medium transition-colors ${
              activeTab === 'stages'
                ? 'border-b-2 border-blue-600 text-blue-600'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <GraduationCap className="w-4 h-4 inline mr-2" />
            Stages ({stages.length})
          </button>
          <button
            onClick={() => setActiveTab('sections')}
            className={`px-6 py-3 font-medium transition-colors ${
              activeTab === 'sections'
                ? 'border-b-2 border-blue-600 text-blue-600'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <Users className="w-4 h-4 inline mr-2" />
            Sections ({sections.length})
          </button>
          <button
            onClick={() => setActiveTab('subjects')}
            className={`px-6 py-3 font-medium transition-colors ${
              activeTab === 'subjects'
                ? 'border-b-2 border-blue-600 text-blue-600'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <BookOpen className="w-4 h-4 inline mr-2" />
            Subjects ({subjects.length})
          </button>
          <button
            onClick={() => setActiveTab('assignments')}
            className={`px-6 py-3 font-medium transition-colors ${
              activeTab === 'assignments'
                ? 'border-b-2 border-blue-600 text-blue-600'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <CheckCircle className="w-4 h-4 inline mr-2" />
            Assignments ({assignments.length})
          </button>
        </div>

        {/* Content */}
        <div>
          {activeTab === 'stages' && renderStages()}
          {activeTab === 'sections' && renderSections()}
          {activeTab === 'subjects' && renderSubjects()}
          {activeTab === 'assignments' && renderAssignments()}
        </div>
      </div>
    </div>
  );
};

export default Settings;
