// NEW FILE: frontend/src/pages/Financials.jsx
// Financial Management - Create periods, add revenues, calculate teacher payments

import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Alert, AlertDescription } from '../components/ui/alert';
import financialApi from '../services/financial_api';
import { DollarSign, Plus, Calculator, TrendingUp, Users, Eye, EyeOff, Trash2, ChevronDown, ChevronUp } from 'lucide-react';

const Financials = () => {
  // States
  const [periods, setPeriods] = useState([]);
  const [stages, setStages] = useState([]);
  const [selectedPeriod, setSelectedPeriod] = useState(null);
  const [selectedStage, setSelectedStage] = useState(null);
  const [financialData, setFinancialData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [calculating, setCalculating] = useState(false);
  const [message, setMessage] = useState({ text: '', type: '' });

  // Form states
  const [newPeriod, setNewPeriod] = useState({ name: '', year: new Date().getFullYear(), notes: '' });
  const [showNewPeriodForm, setShowNewPeriodForm] = useState(false);
  const [sectionRevenues, setSectionRevenues] = useState({});
  const [expandedSections, setExpandedSections] = useState(new Set());

  const showMessage = (text, type = 'success') => {
    setMessage({ text, type });
    setTimeout(() => setMessage({ text: '', type: '' }), 5000);
  };

  // Load initial data
  useEffect(() => {
    loadInitialData();
  }, []);

  // Load financial data when period/stage selected
  useEffect(() => {
    if (selectedPeriod && selectedStage) {
      loadFinancialData();
    }
  }, [selectedPeriod, selectedStage]);

  const loadInitialData = async () => {
    setLoading(true);
    try {
      const [periodsData, stagesData] = await Promise.all([
        financialApi.getFinancialPeriods(),
        financialApi.getStages()
      ]);
      setPeriods(periodsData);
      setStages(stagesData);
      
      // Auto-select first period if available
      if (periodsData.length > 0 && !selectedPeriod) {
        setSelectedPeriod(periodsData[0].id);
      }
    } catch (error) {
      showMessage('Error loading data: ' + (error.response?.data?.detail || error.message), 'error');
    } finally {
      setLoading(false);
    }
  };

  const loadFinancialData = async () => {
    try {
      const data = await financialApi.getFinancialData(selectedPeriod, selectedStage);
      setFinancialData(data);
      
      // Initialize section revenues
      const revenues = {};
      data.section_revenues.forEach(rev => {
        revenues[rev.section_id] = {
          total_orders: rev.total_orders,
          total_revenue_egp: rev.total_revenue_egp
        };
      });
      setSectionRevenues(revenues);
    } catch (error) {
      showMessage('Error loading financial data: ' + (error.response?.data?.detail || error.message), 'error');
    }
  };

  // ============================================
  // PERIOD FUNCTIONS
  // ============================================
  const handleCreatePeriod = async (e) => {
    e.preventDefault();
    try {
      await financialApi.createFinancialPeriod(newPeriod);
      showMessage('Period created successfully');
      setNewPeriod({ name: '', year: new Date().getFullYear(), notes: '' });
      setShowNewPeriodForm(false);
      loadInitialData();
    } catch (error) {
      showMessage('Error creating period: ' + (error.response?.data?.detail || error.message), 'error');
    }
  };

  const handleDeletePeriod = async (periodId) => {
    if (!window.confirm('Delete this period? All revenue data and payments will be deleted.')) return;
    try {
      await financialApi.deleteFinancialPeriod(periodId);
      showMessage('Period deleted successfully');
      setSelectedPeriod(null);
      setSelectedStage(null);
      setFinancialData(null);
      loadInitialData();
    } catch (error) {
      showMessage('Error deleting period: ' + (error.response?.data?.detail || error.message), 'error');
    }
  };

  // ============================================
  // REVENUE FUNCTIONS
  // ============================================
  const handleSaveRevenue = async (sectionId) => {
    if (!selectedPeriod || !selectedStage) return;
    
    const revenue = sectionRevenues[sectionId];
    if (!revenue) return;

    try {
      await financialApi.createOrUpdateSectionRevenue({
        period_id: selectedPeriod,
        stage_id: selectedStage,
        section_id: sectionId,
        total_orders: parseInt(revenue.total_orders) || 0,
        total_revenue_egp: parseFloat(revenue.total_revenue_egp) || 0
      });
      showMessage('Revenue saved successfully');
      loadFinancialData();
    } catch (error) {
      showMessage('Error saving revenue: ' + (error.response?.data?.detail || error.message), 'error');
    }
  };

  const handleRevenueChange = (sectionId, field, value) => {
    setSectionRevenues(prev => ({
      ...prev,
      [sectionId]: {
        ...(prev[sectionId] || {}),
        [field]: value
      }
    }));
  };

  // ============================================
  // CALCULATION FUNCTIONS
  // ============================================
  const handleCalculatePayments = async () => {
    if (!selectedPeriod || !selectedStage) {
      showMessage('Please select a period and stage first', 'error');
      return;
    }

    setCalculating(true);
    try {
      const result = await financialApi.calculatePayments(selectedPeriod, selectedStage);
      showMessage(`Payments calculated! ${result.payments_calculated} teachers, Total: ${formatCurrency(result.total_payment)} EGP`, 'success');
      loadFinancialData();
    } catch (error) {
      showMessage('Error calculating payments: ' + (error.response?.data?.detail || error.message), 'error');
    } finally {
      setCalculating(false);
    }
  };

  // ============================================
  // HELPER FUNCTIONS
  // ============================================
  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount || 0);
  };

  const formatWatchTime = (seconds) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  };

  const toggleSection = (sectionId) => {
    setExpandedSections(prev => {
      const newSet = new Set(prev);
      if (newSet.has(sectionId)) {
        newSet.delete(sectionId);
      } else {
        newSet.add(sectionId);
      }
      return newSet;
    });
  };

  // ============================================
  // RENDER FUNCTIONS
  // ============================================
  const renderPeriodSelector = () => (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <DollarSign className="w-5 h-5" />
            Financial Period
          </span>
          <Button
            size="sm"
            onClick={() => setShowNewPeriodForm(!showNewPeriodForm)}
            className="bg-blue-600 hover:bg-blue-700"
          >
            <Plus className="w-4 h-4 mr-2" />
            New Period
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* New Period Form */}
        {showNewPeriodForm && (
          <form onSubmit={handleCreatePeriod} className="border rounded-lg p-4 space-y-4 bg-gray-50">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-gray-700">Period Name *</label>
                <Input
                  placeholder="Q1 2025, Midterm 2025"
                  value={newPeriod.name}
                  onChange={(e) => setNewPeriod({ ...newPeriod, name: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Year *</label>
                <Input
                  type="number"
                  value={newPeriod.year}
                  onChange={(e) => setNewPeriod({ ...newPeriod, year: parseInt(e.target.value) })}
                  required
                />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Notes (Optional)</label>
              <Input
                placeholder="Additional notes..."
                value={newPeriod.notes}
                onChange={(e) => setNewPeriod({ ...newPeriod, notes: e.target.value })}
              />
            </div>
            <div className="flex gap-2">
              <Button type="submit" className="bg-green-600 hover:bg-green-700">Create</Button>
              <Button type="button" variant="outline" onClick={() => setShowNewPeriodForm(false)}>Cancel</Button>
            </div>
          </form>
        )}

        {/* Period List */}
        <div className="space-y-2">
          {periods.map(period => (
            <div
              key={period.id}
              className={`flex items-center justify-between p-4 border rounded-lg cursor-pointer transition-colors ${
                selectedPeriod === period.id ? 'bg-blue-50 border-blue-300' : 'hover:bg-gray-50'
              }`}
              onClick={() => setSelectedPeriod(period.id)}
            >
              <div>
                <div className="font-semibold text-lg">{period.name}</div>
                <div className="text-sm text-gray-500">Year: {period.year}</div>
                {period.notes && <div className="text-xs text-gray-400 mt-1">{period.notes}</div>}
              </div>
              <div className="flex items-center gap-2">
                {selectedPeriod === period.id && (
                  <span className="text-xs bg-blue-600 text-white px-2 py-1 rounded">Selected</span>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={(e) => { e.stopPropagation(); handleDeletePeriod(period.id); }}
                  className="text-red-600 hover:text-red-700"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </div>
          ))}
          {periods.length === 0 && (
            <div className="text-center py-8 text-gray-500">
              No periods yet. Create one above.
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );

  const renderStageSelector = () => (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TrendingUp className="w-5 h-5" />
          Select Stage
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!selectedPeriod ? (
          <div className="text-center py-8 text-gray-500">
            Please select a period first
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {stages.map(stage => (
              <div
                key={stage.id}
                className={`p-4 border rounded-lg cursor-pointer transition-all ${
                  selectedStage === stage.id
                    ? 'bg-green-50 border-green-300 shadow-md'
                    : 'hover:bg-gray-50 hover:shadow'
                }`}
                onClick={() => setSelectedStage(stage.id)}
              >
                <div className="text-center">
                  <div className="text-3xl font-bold text-blue-600 mb-2">{stage.code}</div>
                  <div className="font-semibold">{stage.name}</div>
                  {selectedStage === stage.id && (
                    <div className="text-xs bg-green-600 text-white px-2 py-1 rounded mt-2 inline-block">
                      Active
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );

  const renderFinancialWorkspace = () => {
    if (!financialData) return null;

    const { sections, section_revenues, teacher_assignments, teacher_payments } = financialData;

    // Group assignments by section
    const assignmentsBySection = {};
    sections.forEach(section => {
      assignmentsBySection[section.id] = teacher_assignments.filter(a => 
        a.section_id === section.id || a.subject_is_common
      );
    });

    // Group payments by section
    const paymentsBySection = {};
    sections.forEach(section => {
      paymentsBySection[section.id] = teacher_payments.filter(p => p.section_id === section.id);
    });

    return (
      <div className="space-y-6">
        {/* Summary Stats */}
        {teacher_payments.length > 0 && (
          <Card className="bg-gradient-to-r from-green-50 to-blue-50 border-green-200">
            <CardContent className="p-6">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <div className="text-center">
                  <div className="text-4xl font-bold text-green-600">
                    {formatCurrency(teacher_payments.reduce((sum, p) => sum + p.final_payment, 0))}
                  </div>
                  <div className="text-sm text-gray-600 mt-1">Total Payments (EGP)</div>
                </div>
                <div className="text-center">
                  <div className="text-4xl font-bold text-blue-600">{teacher_payments.length}</div>
                  <div className="text-sm text-gray-600 mt-1">Teachers</div>
                </div>
                <div className="text-center">
                  <div className="text-4xl font-bold text-purple-600">
                    {section_revenues.reduce((sum, r) => sum + r.total_orders, 0)}
                  </div>
                  <div className="text-sm text-gray-600 mt-1">Total Orders</div>
                </div>
                <div className="text-center">
                  <div className="text-4xl font-bold text-orange-600">
                    {formatCurrency(section_revenues.reduce((sum, r) => sum + r.total_revenue_egp, 0))}
                  </div>
                  <div className="text-sm text-gray-600 mt-1">Total Revenue (EGP)</div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Sections */}
        {sections.map(section => {
          const isExpanded = expandedSections.has(section.id);
          const sectionAssignments = assignmentsBySection[section.id] || [];
          const sectionPayments = paymentsBySection[section.id] || [];
          const revenue = sectionRevenues[section.id] || { total_orders: 0, total_revenue_egp: 0 };

          return (
            <Card key={section.id}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-3">
                    <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                      <span className="text-xl font-bold text-blue-600">{section.code}</span>
                    </div>
                    <div>
                      <div className="text-xl">{section.name}</div>
                      <div className="text-sm text-gray-500 font-normal">
                        {sectionAssignments.length} teachers assigned
                      </div>
                    </div>
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => toggleSection(section.id)}
                    >
                      {isExpanded ? (
                        <><ChevronUp className="w-4 h-4 mr-2" /> Collapse</>
                      ) : (
                        <><ChevronDown className="w-4 h-4 mr-2" /> Expand</>
                      )}
                    </Button>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="space-y-4">
                {/* Revenue Input */}
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                  <h3 className="font-semibold text-lg mb-3 flex items-center gap-2">
                    <DollarSign className="w-5 h-5 text-yellow-600" />
                    Section Revenue
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="text-sm font-medium text-gray-700">Total Orders *</label>
                      <Input
                        type="number"
                        placeholder="100"
                        value={revenue.total_orders || ''}
                        onChange={(e) => handleRevenueChange(section.id, 'total_orders', e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="text-sm font-medium text-gray-700">Total Revenue (EGP) *</label>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="10000.00"
                        value={revenue.total_revenue_egp || ''}
                        onChange={(e) => handleRevenueChange(section.id, 'total_revenue_egp', e.target.value)}
                      />
                    </div>
                    <div className="flex items-end">
                      <Button
                        onClick={() => handleSaveRevenue(section.id)}
                        className="bg-green-600 hover:bg-green-700 w-full"
                      >
                        Save Revenue
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Teachers List */}
                {isExpanded && (
                  <div className="space-y-4">
                    <h3 className="font-semibold text-lg flex items-center gap-2">
                      <Users className="w-5 h-5 text-blue-600" />
                      Teachers ({sectionAssignments.length})
                    </h3>
                    
                    {sectionPayments.length > 0 ? (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b bg-gray-50">
                              <th className="text-left p-3">Teacher</th>
                              <th className="text-left p-3">Subject</th>
                              <th className="text-right p-3">Watch Time</th>
                              <th className="text-right p-3">Watch %</th>
                              <th className="text-right p-3">Revenue %</th>
                              <th className="text-right p-3">Tax %</th>
                              <th className="text-right p-3">Payment (EGP)</th>
                            </tr>
                          </thead>
                          <tbody>
                            {sectionPayments.map(payment => (
                              <tr key={payment.id} className="border-b hover:bg-gray-50">
                                <td className="p-3">
                                  <div className="font-medium">{payment.library_name}</div>
                                  <div className="text-xs text-gray-500">ID: {payment.library_id}</div>
                                </td>
                                <td className="p-3">
                                  <div className="flex items-center gap-2">
                                    <span className="font-mono font-semibold">{payment.subject_name}</span>
                                    {payment.subject_is_common && (
                                      <span className="text-xs bg-purple-100 text-purple-700 px-2 py-1 rounded">
                                        Common
                                      </span>
                                    )}
                                  </div>
                                </td>
                                <td className="p-3 text-right">{formatWatchTime(payment.total_watch_time_seconds)}</td>
                                <td className="p-3 text-right">{(payment.watch_time_percentage * 100).toFixed(2)}%</td>
                                <td className="p-3 text-right">{(payment.revenue_percentage_applied * 100).toFixed(0)}%</td>
                                <td className="p-3 text-right">{(payment.tax_rate_applied * 100).toFixed(0)}%</td>
                                <td className="p-3 text-right">
                                  <div className="font-bold text-green-600">
                                    {formatCurrency(payment.final_payment)}
                                  </div>
                                  <div className="text-xs text-gray-500">
                                    -{formatCurrency(payment.tax_amount)} tax
                                  </div>
                                </td>
                              </tr>
                            ))}
                            <tr className="border-t-2 border-gray-300 bg-gray-100 font-bold">
                              <td colSpan="6" className="p-3 text-right">Section Total:</td>
                              <td className="p-3 text-right text-green-600 text-lg">
                                {formatCurrency(sectionPayments.reduce((sum, p) => sum + p.final_payment, 0))}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="text-center py-8 text-gray-500 border rounded-lg bg-gray-50">
                        <Calculator className="w-12 h-12 mx-auto mb-3 text-gray-400" />
                        <div>No payments calculated yet</div>
                        <div className="text-sm mt-1">Add revenue and click "Calculate Payments" below</div>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}

        {/* Calculate Button */}
        <Card className="bg-gradient-to-r from-blue-50 to-purple-50 border-blue-200">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xl font-bold text-gray-900">Ready to Calculate Payments?</h3>
                <p className="text-sm text-gray-600 mt-1">
                  Make sure you've entered revenue for all sections above
                </p>
              </div>
              <Button
                onClick={handleCalculatePayments}
                disabled={calculating}
                className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white px-8 py-6 text-lg"
              >
                <Calculator className="w-5 h-5 mr-2" />
                {calculating ? 'Calculating...' : 'Calculate Payments'}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 p-8 flex items-center justify-center">
        <div className="text-lg">Loading financials...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
            <DollarSign className="w-8 h-8 text-green-600" />
            Financial Management
          </h1>
          <p className="text-gray-600 mt-1">Manage periods, revenues, and calculate teacher payments</p>
        </div>

        {/* Message */}
        {message.text && (
          <Alert className={message.type === 'error' ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200'}>
            <AlertDescription className={message.type === 'error' ? 'text-red-800' : 'text-green-800'}>
              {message.text}
            </AlertDescription>
          </Alert>
        )}

        {/* Period Selector */}
        {renderPeriodSelector()}

        {/* Stage Selector */}
        {renderStageSelector()}

        {/* Financial Workspace */}
        {renderFinancialWorkspace()}
      </div>
    </div>
  );
};

export default Financials;
