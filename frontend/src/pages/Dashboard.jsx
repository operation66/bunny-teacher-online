import React, { useState, useEffect } from 'react';
import { teachersAPI } from '../services/api';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart, Line } from 'recharts';
import { Calendar, User, FileText, TrendingUp, Eye, Download } from 'lucide-react';

const Dashboard = () => {
  const [teachers, setTeachers] = useState([]);
  const [selectedTeacher, setSelectedTeacher] = useState('');
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [selectedReports, setSelectedReports] = useState([]);
  const [dashboardData, setDashboardData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

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

  const reportTypes = [
    { value: 'quality', label: 'Quality Report', color: '#28a745' },
    { value: 'student', label: 'Student Report', color: '#007bff' },
    { value: 'operations', label: 'Operations Report', color: '#ffc107' }
  ];

  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 5 }, (_, i) => currentYear - i);

  useEffect(() => {
    fetchTeachers();
  }, []);

  useEffect(() => {
    if (selectedTeacher && selectedReports.length > 0) {
      fetchDashboardData();
    }
  }, [selectedTeacher, selectedMonth, selectedYear, selectedReports]);

  const fetchTeachers = async () => {
    try {
      const response = await teachersAPI.getAll();
      setTeachers(response.data);
    } catch (err) {
      setError('Failed to fetch teachers');
      console.error('Error fetching teachers:', err);
    }
  };

  const fetchDashboardData = async () => {
    if (!selectedTeacher || selectedReports.length === 0) return;

    try {
      setLoading(true);
      setError(null);

  const response = await fetch(`/api/dashboard-data/?teacher_id=${selectedTeacher}&month=${selectedMonth}&year=${selectedYear}&report_types=${selectedReports.join(',')}`);
      
      if (!response.ok) {
        throw new Error('Failed to fetch dashboard data');
      }

      const data = await response.json();
      setDashboardData(data);
    } catch (err) {
      setError(err.message);
      console.error('Error fetching dashboard data:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleReportTypeChange = (reportType) => {
    setSelectedReports(prev => {
      if (prev.includes(reportType)) {
        return prev.filter(type => type !== reportType);
      } else {
        return [...prev, reportType];
      }
    });
  };

  const formatBytes = (bytes) => {
    if (!bytes) return '0 GB';
    const gb = bytes / (1024 * 1024 * 1024);
    return `${gb.toFixed(2)} GB`;
  };

  const formatNumber = (num) => {
    if (!num) return '0';
    return num.toLocaleString();
  };

  const getSelectedTeacherName = () => {
    const teacher = teachers.find(t => t.id.toString() === selectedTeacher);
    return teacher ? teacher.name : '';
  };

  const getSelectedMonthName = () => {
    const month = months.find(m => m.value === parseInt(selectedMonth));
    return month ? month.label : '';
  };

  return (
    <div className="container">
      <div style={styles.header}>
        <h1>Dashboard</h1>
        <p style={styles.subtitle}>Analyze teacher performance data and Bunny.net statistics</p>
      </div>

      {error && (
        <div className="error" style={styles.alert}>
          {error}
        </div>
      )}

      {/* Selection Controls */}
      <div className="card" style={styles.controlsCard}>
        <h2 style={styles.controlsTitle}>Select Data to View</h2>
        
        <div style={styles.controlsGrid}>
          {/* Teacher Selection */}
          <div style={styles.controlGroup}>
            <label style={styles.label}>
              <User size={18} />
              Teacher
            </label>
            <select
              value={selectedTeacher}
              onChange={(e) => setSelectedTeacher(e.target.value)}
              style={styles.select}
            >
              <option value="">Choose a teacher...</option>
              {teachers.map((teacher) => (
                <option key={teacher.id} value={teacher.id}>
                  {teacher.name}
                </option>
              ))}
            </select>
          </div>

          {/* Month Selection */}
          <div style={styles.controlGroup}>
            <label style={styles.label}>
              <Calendar size={18} />
              Month
            </label>
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(parseInt(e.target.value))}
              style={styles.select}
            >
              {months.map((month) => (
                <option key={month.value} value={month.value}>
                  {month.label}
                </option>
              ))}
            </select>
          </div>

          {/* Year Selection */}
          <div style={styles.controlGroup}>
            <label style={styles.label}>
              <Calendar size={18} />
              Year
            </label>
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(parseInt(e.target.value))}
              style={styles.select}
            >
              {years.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </div>

          {/* Report Types Selection */}
          <div style={styles.controlGroup}>
            <label style={styles.label}>
              <FileText size={18} />
              Report Types
            </label>
            <div style={styles.checkboxGroup}>
              {reportTypes.map((reportType) => (
                <label key={reportType.value} style={styles.checkboxLabel}>
                  <input
                    type="checkbox"
                    checked={selectedReports.includes(reportType.value)}
                    onChange={() => handleReportTypeChange(reportType.value)}
                    style={styles.checkbox}
                  />
                  <span style={{ color: reportType.color, fontWeight: '600' }}>
                    {reportType.label}
                  </span>
                </label>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Dashboard Data Preview */}
      {selectedTeacher && selectedReports.length > 0 && (
        <div style={styles.previewSection}>
          <div style={styles.previewHeader}>
            <h2>
              <Eye size={24} />
              Data Preview: {getSelectedTeacherName()} - {getSelectedMonthName()} {selectedYear}
            </h2>
          </div>

          {loading ? (
            <div className="card">
              <div style={styles.loadingState}>Loading dashboard data...</div>
            </div>
          ) : dashboardData ? (
            <>
              {/* Monthly Statistics */}
              {dashboardData.monthly_stats && (
                <div className="card">
                  <h3 style={styles.sectionTitle}>
                    <TrendingUp size={20} />
                    Bunny.net Monthly Statistics
                  </h3>
                  <div style={styles.statsGrid}>
                    <div style={styles.statCard}>
                      <div style={styles.statValue}>{formatNumber(dashboardData.monthly_stats.views)}</div>
                      <div style={styles.statLabel}>Total Views</div>
                    </div>
                    <div style={styles.statCard}>
                      <div style={styles.statValue}>{formatBytes(dashboardData.monthly_stats.bandwidth_gb)}</div>
                      <div style={styles.statLabel}>Bandwidth Used</div>
                    </div>
                    <div style={styles.statCard}>
                      <div style={styles.statValue}>{dashboardData.monthly_stats.month}/{dashboardData.monthly_stats.year}</div>
                      <div style={styles.statLabel}>Period</div>
                    </div>
                  </div>
                </div>
              )}

              {/* Quality Report Data */}
              {selectedReports.includes('quality') && dashboardData.quality_reports && dashboardData.quality_reports.length > 0 && (
                <div className="card">
                  <h3 style={styles.sectionTitle}>
                    <FileText size={20} style={{ color: '#28a745' }} />
                    Quality Reports
                  </h3>
                  <div style={styles.reportTable}>
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Upload Date</th>
                          <th>Score</th>
                          <th>Summary</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dashboardData.quality_reports.map((report, index) => (
                          <tr key={index}>
                            <td>{new Date(report.uploaded_at).toLocaleDateString()}</td>
                            <td>
                              <span style={styles.scoreBadge}>
                                {report.score || 'N/A'}
                              </span>
                            </td>
                            <td>{report.summary || 'No summary available'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Student Report Data */}
              {selectedReports.includes('student') && dashboardData.student_reports && dashboardData.student_reports.length > 0 && (
                <div className="card">
                  <h3 style={styles.sectionTitle}>
                    <FileText size={20} style={{ color: '#007bff' }} />
                    Student Reports
                  </h3>
                  <div style={styles.reportTable}>
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Upload Date</th>
                          <th>Score</th>
                          <th>Summary</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dashboardData.student_reports.map((report, index) => (
                          <tr key={index}>
                            <td>{new Date(report.uploaded_at).toLocaleDateString()}</td>
                            <td>
                              <span style={styles.scoreBadge}>
                                {report.score || 'N/A'}
                              </span>
                            </td>
                            <td>{report.summary || 'No summary available'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Operations Report Data */}
              {selectedReports.includes('operations') && dashboardData.operations_reports && dashboardData.operations_reports.length > 0 && (
                <div className="card">
                  <h3 style={styles.sectionTitle}>
                    <FileText size={20} style={{ color: '#ffc107' }} />
                    Operations Reports
                  </h3>
                  <div style={styles.reportTable}>
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Upload Date</th>
                          <th>On Schedule</th>
                          <th>Attitude Summary</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dashboardData.operations_reports.map((report, index) => (
                          <tr key={index}>
                            <td>{new Date(report.uploaded_at).toLocaleDateString()}</td>
                            <td>
                              <span style={{
                                ...styles.statusBadge,
                                backgroundColor: report.on_schedule ? '#28a745' : '#dc3545'
                              }}>
                                {report.on_schedule ? 'Yes' : 'No'}
                              </span>
                            </td>
                            <td>{report.attitude_summary || 'No summary available'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* No Data Message */}
              {(!dashboardData.quality_reports || dashboardData.quality_reports.length === 0) &&
               (!dashboardData.student_reports || dashboardData.student_reports.length === 0) &&
               (!dashboardData.operations_reports || dashboardData.operations_reports.length === 0) && (
                <div className="card">
                  <div style={styles.noDataState}>
                    <FileText size={48} style={{ color: '#ccc' }} />
                    <h3>No Report Data Available</h3>
                    <p>No reports found for the selected teacher, month, and year.</p>
                    <p>Upload some reports first to see data here.</p>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="card">
              <div style={styles.noDataState}>
                <p>Select a teacher and report types to view dashboard data.</p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const styles = {
  header: {
    marginBottom: '30px',
    textAlign: 'center',
  },
  subtitle: {
    color: '#666',
    fontSize: '16px',
    marginTop: '8px',
  },
  alert: {
    padding: '15px',
    backgroundColor: '#f8d7da',
    color: '#721c24',
    border: '1px solid #f5c6cb',
    borderRadius: '8px',
    marginBottom: '20px',
  },
  controlsCard: {
    marginBottom: '30px',
    border: '2px solid #e3f2fd',
    backgroundColor: '#fafafa',
  },
  controlsTitle: {
    marginBottom: '20px',
    color: '#1976d2',
  },
  controlsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
    gap: '20px',
  },
  controlGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  label: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontWeight: '600',
    color: '#333',
    fontSize: '14px',
  },
  select: {
    padding: '10px',
    border: '2px solid #ddd',
    borderRadius: '6px',
    fontSize: '14px',
    backgroundColor: 'white',
  },
  checkboxGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  checkboxLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    cursor: 'pointer',
  },
  checkbox: {
    width: '16px',
    height: '16px',
  },
  previewSection: {
    marginTop: '30px',
  },
  previewHeader: {
    marginBottom: '20px',
  },
  loadingState: {
    textAlign: 'center',
    padding: '40px',
    color: '#666',
  },
  sectionTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    marginBottom: '20px',
    paddingBottom: '10px',
    borderBottom: '2px solid #f0f0f0',
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: '20px',
  },
  statCard: {
    textAlign: 'center',
    padding: '20px',
    backgroundColor: '#f8f9fa',
    borderRadius: '8px',
    border: '1px solid #e9ecef',
  },
  statValue: {
    fontSize: '24px',
    fontWeight: 'bold',
    color: '#1976d2',
    marginBottom: '5px',
  },
  statLabel: {
    fontSize: '14px',
    color: '#666',
    fontWeight: '500',
  },
  reportTable: {
    overflowX: 'auto',
  },
  scoreBadge: {
    backgroundColor: '#007bff',
    color: 'white',
    padding: '4px 12px',
    borderRadius: '20px',
    fontSize: '12px',
    fontWeight: '600',
  },
  statusBadge: {
    color: 'white',
    padding: '4px 12px',
    borderRadius: '20px',
    fontSize: '12px',
    fontWeight: '600',
  },
  noDataState: {
    textAlign: 'center',
    padding: '60px 20px',
    color: '#666',
  },
};

export default Dashboard;