import React, { useState, useEffect, useMemo } from 'react';
import api from '../services/api';
import { teachersAPI } from '../services/api';
import { Upload, FileSpreadsheet, AlertCircle, Clock, User, Calendar, ChevronDown } from 'lucide-react';
import { SearchableSelect } from '../components/ui/searchable-select';

const DataUpload = () => {
  const [teachers, setTeachers] = useState([]);
  const [libraryConfigs, setLibraryConfigs] = useState([]);
  const [selectedTeacher, setSelectedTeacher] = useState('');
  const [uploadHistory, setUploadHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  
  // Month/Year selection
  const now = new Date();
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());

  // Separate states for each upload section
  const [qualityUpload, setQualityUpload] = useState({
    file: null,
    uploading: false
  });
  const [studentUpload, setStudentUpload] = useState({
    file: null,
    uploading: false
  });
  const [operationsUpload, setOperationsUpload] = useState({
    file: null,
    uploading: false
  });

  useEffect(() => {
    fetchTeachers();
  }, []);

  // Fetch library configs and subscribe to global updates from API Config
  useEffect(() => {
    const fetchAndSubscribe = async () => {
      await fetchLibraryConfigs();
    };
    fetchAndSubscribe();

    const handler = () => {
      // Refresh configs and teachers when API Config updates
      fetchLibraryConfigs();
      fetchTeachers();
    };
    window.addEventListener('library-configs:updated', handler);
    // Also refresh when teachers list changes after Libraries sync
    window.addEventListener('teachers:updated', handler);
    return () => {
      window.removeEventListener('library-configs:updated', handler);
      window.removeEventListener('teachers:updated', handler);
    };
  }, []);

  useEffect(() => {
    if (selectedTeacher) {
      fetchUploadHistory();
    }
  }, [selectedTeacher]);

  const fetchTeachers = async () => {
    try {
      setLoading(true);
      const response = await teachersAPI.getAll();
      setTeachers(response.data);
    } catch (err) {
      setError('Failed to fetch teachers');
      console.error('Error fetching teachers:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchLibraryConfigs = async () => {
    try {
      const { data } = await api.get('/library-configs/');
      setLibraryConfigs(data);
    } catch (err) {
      console.error('Error fetching library configs:', err);
    }
  };

  const fetchUploadHistory = async () => {
    if (!selectedTeacher) return;
    
    try {
      const response = await fetch(`/api/upload-history/${selectedTeacher}`);
      if (response.ok) {
        const data = await response.json();
        setUploadHistory(data);
      }
    } catch (err) {
      console.error('Error fetching upload history:', err);
    }
  };

  const handleTeacherSelect = (val) => {
    setSelectedTeacher(val);
    setError(null);
    setSuccess(null);
  };

  const handleFileChange = (section, file) => {
    switch (section) {
      case 'quality':
        setQualityUpload(prev => ({ ...prev, file }));
        break;
      case 'student':
        setStudentUpload(prev => ({ ...prev, file }));
        break;
      case 'operations':
        setOperationsUpload(prev => ({ ...prev, file }));
        break;
    }
  };

  const uploadReport = async (reportType, file, setUploadState) => {
    if (!selectedTeacher) {
      setError('Please select a teacher first');
      return;
    }

    if (!file) {
      setError(`Please select a file for ${reportType} report`);
      return;
    }
    
    if (!selectedMonth || !selectedYear) {
      setError('Please select month and year');
      return;
    }

    try {
      setUploadState(prev => ({ ...prev, uploading: true }));
      setError(null);

      const formData = new FormData();
      formData.append('teacher_id', selectedTeacher);
      formData.append('month', selectedMonth);
      formData.append('year', selectedYear);
      formData.append('file', file);

      const response = await fetch(`/api/upload-${reportType}-report/`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || `Failed to upload ${reportType} report`);
      }

      const result = await response.json();
      setSuccess(`${reportType.charAt(0).toUpperCase() + reportType.slice(1)} report uploaded successfully!`);
      
      // Reset the upload state
      setUploadState({ file: null, uploading: false });
      
      // Refresh upload history
      await fetchUploadHistory();
      
      // Clear file input
      const fileInput = document.getElementById(`${reportType}-file`);
      if (fileInput) fileInput.value = '';

    } catch (err) {
      setError(err.message);
      console.error(`Error uploading ${reportType} report:`, err);
    } finally {
      setUploadState(prev => ({ ...prev, uploading: false }));
    }
  };

  const saveAllReports = async () => {
    if (!selectedTeacher) {
      setError('Please select a teacher first');
      return;
    }
    if (!selectedMonth || !selectedYear) {
      setError('Please select month and year');
      return;
    }

    const uploads = [];
    if (qualityUpload.file) uploads.push(['quality', qualityUpload.file, setQualityUpload]);
    if (studentUpload.file) uploads.push(['student', studentUpload.file, setStudentUpload]);
    if (operationsUpload.file) uploads.push(['operations', operationsUpload.file, setOperationsUpload]);

    if (uploads.length === 0) {
      setError('Please choose at least one report file to upload');
      return;
    }

    setError(null);
    setSuccess(null);

    let completed = 0;
    const failures = [];
    for (const [type, file, setter] of uploads) {
      try {
        await uploadReport(type, file, setter);
        completed += 1;
      } catch (e) {
        failures.push(`${type}: ${e?.message || 'Unknown error'}`);
      }
    }

    if (completed > 0) {
      setSuccess(`Uploaded ${completed} report${completed > 1 ? 's' : ''} for ${selectedMonth}/${selectedYear}.`);
    }
    if (failures.length > 0) {
      setError(`Failed uploads -> ${failures.join('; ')}`);
    }
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleString();
  };

  const getReportTypeColor = (type) => {
    switch (type) {
      case 'quality': return '#28a745';
      case 'student': return '#007bff';
      case 'operations': return '#ffc107';
      default: return '#6c757d';
    }
  };

  const [headerCollapsed, setHeaderCollapsed] = useState(false);
  const teacherOptions = useMemo(() => {
    return (teachers || []).map((t) => {
      // Default label is teacher name + library id
      let label = `${t.name} (Library ID: ${t.bunny_library_id ?? 'N/A'})`;
      // If teacher is mapped to a Bunny library, override with config library_name
      if (t.bunny_library_id) {
        const cfg = (libraryConfigs || []).find(c => c.library_id === t.bunny_library_id);
        if (cfg && cfg.library_name) {
          label = `${cfg.library_name} (Library ID: ${t.bunny_library_id})`;
        }
      }
      return {
        label,
        value: String(t.id),
      };
    });
  }, [teachers, libraryConfigs]);

  if (loading) {
    return (
      <div className="container">
        <div className="loading">Loading teachers...</div>
      </div>
    );
  }

  return (
    <div className="container">
      <div style={styles.header}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <h1>Upload Data</h1>
          <button
            type="button"
            onClick={() => setHeaderCollapsed((v) => !v)}
            className="inline-flex items-center px-2.5 py-1 rounded-md text-sm font-semibold bg-slate-100 text-slate-700 border border-slate-200 hover:bg-slate-200"
            aria-label={headerCollapsed ? 'Expand header' : 'Collapse header'}
            title={headerCollapsed ? 'Expand header' : 'Collapse header'}
          >
            <ChevronDown className={`w-4 h-4 transition-transform ${headerCollapsed ? '' : 'rotate-180'}`} />
            <span className="ml-1">{headerCollapsed ? 'Expand' : 'Collapse'}</span>
          </button>
        </div>
        {!headerCollapsed && (
          <p style={styles.subtitle}>Upload quality, student, and operations reports for teachers</p>
        )}
      </div>

      {error && (
        <div className="error" style={styles.alert}>
          <AlertCircle size={18} />
          {error}
        </div>
      )}

      {success && (
        <div className="success" style={styles.successAlert}>
          {success}
        </div>
      )}

      {/* Teacher Selection with searchable dropdown */}
      <div className="card">
        <div style={styles.sectionHeader}>
          <User size={20} />
          <h2>1. Select Teacher</h2>
        </div>
        <div style={styles.teacherSelection}>
          <SearchableSelect
            options={teacherOptions}
            value={String(selectedTeacher || '')}
            onChange={(val) => handleTeacherSelect(val)}
            placeholder="Choose a teacher from Bunny.net libraries..."
            className="min-w-[280px]"
          />
        </div>
      </div>

      {/* Month/Year Selection */}
      {selectedTeacher && (
        <div className="card">
          <div style={styles.sectionHeader}>
            <Calendar size={20} />
            <h2>2. Select Month and Year</h2>
          </div>
          <div style={styles.dateSelectionRow}>
            <div style={styles.dateControl}>
              <label htmlFor="month" style={styles.inputLabel}>Month</label>
              <select
                id="month"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(Number(e.target.value))}
                style={styles.select}
              >
                {[1,2,3,4,5,6,7,8,9,10,11,12].map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
            <div style={styles.dateControl}>
              <label htmlFor="year" style={styles.inputLabel}>Year</label>
              <input
                id="year"
                type="number"
                min={2000}
                max={2100}
                value={selectedYear}
                onChange={(e) => setSelectedYear(Number(e.target.value))}
                style={styles.input}
              />
            </div>
          </div>
        </div>
      )}

      {selectedTeacher && (
        <>
          {/* Upload Sections */}
          <div style={styles.uploadSections}>
            {/* Quality Report Upload */}
            <div className="card" style={styles.uploadCard}>
              <div style={styles.sectionHeader}>
                <FileSpreadsheet size={20} style={{ color: '#28a745' }} />
                <h3>Quality Report</h3>
              </div>
              <div style={styles.uploadArea}>
                <input
                  type="file"
                  id="quality-file"
                  accept=".xlsx,.xls,.csv"
                  onChange={(e) => handleFileChange('quality', e.target.files[0])}
                  style={styles.fileInput}
                />
                <label htmlFor="quality-file" style={styles.fileLabel}>
                  <Upload size={24} />
                  {qualityUpload.file ? qualityUpload.file.name : 'Choose Quality Report File'}
                </label>
                <button
                  onClick={() => uploadReport('quality', qualityUpload.file, setQualityUpload)}
                  disabled={!qualityUpload.file || qualityUpload.uploading}
                  className="btn btn-success"
                  style={styles.uploadBtn}
                >
                  {qualityUpload.uploading ? 'Uploading...' : 'Upload Quality Report'}
                </button>
              </div>
            </div>

            {/* Student Report Upload */}
            <div className="card" style={styles.uploadCard}>
              <div style={styles.sectionHeader}>
                <FileSpreadsheet size={20} style={{ color: '#007bff' }} />
                <h3>Student Report</h3>
              </div>
              <div style={styles.uploadArea}>
                <input
                  type="file"
                  id="student-file"
                  accept=".xlsx,.xls,.csv"
                  onChange={(e) => handleFileChange('student', e.target.files[0])}
                  style={styles.fileInput}
                />
                <label htmlFor="student-file" style={styles.fileLabel}>
                  <Upload size={24} />
                  {studentUpload.file ? studentUpload.file.name : 'Choose Student Report File'}
                </label>
                <button
                  onClick={() => uploadReport('student', studentUpload.file, setStudentUpload)}
                  disabled={!studentUpload.file || studentUpload.uploading}
                  className="btn btn-primary"
                  style={styles.uploadBtn}
                >
                  {studentUpload.uploading ? 'Uploading...' : 'Upload Student Report'}
                </button>
              </div>
            </div>

            {/* Operations Report Upload */}
            <div className="card" style={styles.uploadCard}>
              <div style={styles.sectionHeader}>
                <FileSpreadsheet size={20} style={{ color: '#ffc107' }} />
                <h3>Operations Report</h3>
              </div>
              <div style={styles.uploadArea}>
                <input
                  type="file"
                  id="operations-file"
                  accept=".xlsx,.xls,.csv"
                  onChange={(e) => handleFileChange('operations', e.target.files[0])}
                  style={styles.fileInput}
                />
                <label htmlFor="operations-file" style={styles.fileLabel}>
                  <Upload size={24} />
                  {operationsUpload.file ? operationsUpload.file.name : 'Choose Operations Report File'}
                </label>
                <button
                  onClick={() => uploadReport('operations', operationsUpload.file, setOperationsUpload)}
                  disabled={!operationsUpload.file || operationsUpload.uploading}
                  className="btn btn-warning"
                  style={styles.uploadBtn}
                >
                  {operationsUpload.uploading ? 'Uploading...' : 'Upload Operations Report'}
                </button>
              </div>
            </div>
          </div>

          {/* Save All Reports */}
          <div style={styles.actionRow}>
            <button
              onClick={saveAllReports}
              className="btn btn-primary"
              style={styles.uploadBtn}
            >
              Save All Reports
            </button>
          </div>

          {/* Upload History */}
          <div className="card">
            <div style={styles.sectionHeader}>
              <Clock size={20} />
              <h2>Upload History</h2>
            </div>
            {uploadHistory.length === 0 ? (
              <div style={styles.emptyState}>
                <p>No uploads found for this teacher.</p>
              </div>
            ) : (
              <div style={styles.historyTable}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Report Type</th>
                      <th>Upload Date & Time</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {uploadHistory.map((upload, index) => (
                      <tr key={index}>
                        <td>
                          <span 
                            style={{
                              ...styles.reportTypeBadge,
                              backgroundColor: getReportTypeColor(upload.report_type)
                            }}
                          >
                            {upload.report_type.charAt(0).toUpperCase() + upload.report_type.slice(1)}
                          </span>
                        </td>
                        <td>
                          <div style={styles.dateCell}>
                            <Calendar size={16} style={styles.icon} />
                            {formatDate(upload.uploaded_at)}
                          </div>
                        </td>
                        <td>
                          <span style={styles.statusBadge}>
                            Uploaded
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
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
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '15px',
    backgroundColor: '#f8d7da',
    color: '#721c24',
    border: '1px solid #f5c6cb',
    borderRadius: '8px',
    marginBottom: '20px',
  },
  successAlert: {
    padding: '15px',
    backgroundColor: '#d4edda',
    color: '#155724',
    border: '1px solid #c3e6cb',
    borderRadius: '8px',
    marginBottom: '20px',
  },
  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    marginBottom: '20px',
    paddingBottom: '10px',
    borderBottom: '2px solid #f0f0f0',
  },
  teacherSelection: {
    marginBottom: '10px',
  },
  teacherSelect: {
    width: '100%',
    padding: '12px',
    border: '2px solid #ddd',
    borderRadius: '8px',
    fontSize: '16px',
    backgroundColor: 'white',
  },
  uploadSections: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
    gap: '20px',
    marginBottom: '30px',
  },
  uploadCard: {
    border: '2px solid #f0f0f0',
  },
  uploadArea: {
    textAlign: 'center',
    padding: '20px',
  },
  fileInput: {
    display: 'none',
  },
  fileLabel: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '10px',
    padding: '30px',
    border: '2px dashed #ddd',
    borderRadius: '8px',
    cursor: 'pointer',
    backgroundColor: '#fafafa',
    transition: 'all 0.2s',
    marginBottom: '15px',
  },
  uploadBtn: {
    width: '100%',
    padding: '12px',
    fontSize: '16px',
    fontWeight: '600',
  },
  emptyState: {
    textAlign: 'center',
    padding: '40px',
    color: '#666',
  },
  historyTable: {
    overflowX: 'auto',
  },
  reportTypeBadge: {
    color: 'white',
    padding: '4px 12px',
    borderRadius: '20px',
    fontSize: '12px',
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  dateCell: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  statusBadge: {
    backgroundColor: '#28a745',
    color: 'white',
    padding: '4px 12px',
    borderRadius: '20px',
    fontSize: '12px',
    fontWeight: '600',
  },
  icon: {
    color: '#666',
  },
};

export default DataUpload;