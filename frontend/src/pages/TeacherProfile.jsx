import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { teachersAPI } from '../services/api';
import { ArrowLeft, Video, Wifi, Star, Users, Calendar, TrendingUp } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const TeacherProfile = () => {
  const { id } = useParams();
  const [teacher, setTeacher] = useState(null);
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (id) {
      fetchTeacherData();
    }
  }, [id]);

  const fetchTeacherData = async () => {
    try {
      setLoading(true);
      const [teacherResponse, reportsResponse] = await Promise.all([
        teachersAPI.getById(id),
        // Note: We'll need to create this endpoint in the backend
  fetch(`/api/teachers/${id}/reports`).catch(() => ({ json: () => [] }))
      ]);
      
      setTeacher(teacherResponse.data);
      
      // Handle reports if the endpoint exists
      try {
        const reportsData = await reportsResponse.json();
        setReports(Array.isArray(reportsData) ? reportsData : []);
      } catch {
        setReports([]);
      }
      
      setError(null);
    } catch (err) {
      setError('Failed to fetch teacher data');
      console.error('Error fetching teacher data:', err);
    } finally {
      setLoading(false);
    }
  };

  const getLatestReport = () => {
    if (reports.length === 0) return null;
    return reports.reduce((latest, current) => {
      const latestDate = new Date(latest.year, latest.month - 1);
      const currentDate = new Date(current.year, current.month - 1);
      return currentDate > latestDate ? current : latest;
    });
  };

  const getChartData = () => {
    return reports
      .sort((a, b) => {
        const dateA = new Date(a.year, a.month - 1);
        const dateB = new Date(b.year, b.month - 1);
        return dateA - dateB;
      })
      .slice(-12) // Last 12 months
      .map(report => ({
        month: `${report.month}/${report.year}`,
        video_views: report.video_views || 0,
        bandwidth_gb: report.bandwidth_gb || 0,
        quality_score: report.quality_score || 0,
        student_feedback_score: report.student_feedback_score || 0
      }));
  };

  if (loading) {
    return (
      <div className="container">
        <div className="loading">Loading teacher profile...</div>
      </div>
    );
  }

  if (error || !teacher) {
    return (
      <div className="container">
        <div className="error">
          {error || 'Teacher not found'}
        </div>
        <Link to="/teachers" className="btn btn-primary">
          Back to Teachers
        </Link>
      </div>
    );
  }

  const latestReport = getLatestReport();
  const chartData = getChartData();

  return (
    <div className="container">
      <div style={styles.header}>
        <Link to="/teachers" className="btn btn-secondary">
          <ArrowLeft size={18} />
          Back to Teachers
        </Link>
        <h1>{teacher.name}</h1>
      </div>

      {/* Teacher Info Card */}
      <div className="card">
        <div style={styles.teacherInfo}>
          <div>
            <h2>{teacher.name}</h2>
            <p><strong>Subject:</strong> {teacher.subject}</p>
            <p><strong>Grade:</strong> {teacher.grade}</p>
            <p><strong>Bunny Library ID:</strong> {teacher.bunny_library_id || 'Not set'}</p>
          </div>
          <div style={styles.reportCount}>
            <Calendar size={24} />
            <div>
              <div style={styles.countNumber}>{reports.length}</div>
              <div style={styles.countLabel}>Monthly Reports</div>
            </div>
          </div>
        </div>
      </div>

      {/* Performance Cards */}
      {latestReport && (
        <div className="grid grid-4">
          <div className="card" style={styles.performanceCard}>
            <div style={styles.cardHeader}>
              <Video size={24} color="#007bff" />
              <h3>Video Views</h3>
            </div>
            <div style={styles.cardValue}>
              {latestReport.video_views?.toLocaleString() || 'N/A'}
            </div>
            <div style={styles.cardSubtext}>
              Latest month: {latestReport.month}/{latestReport.year}
            </div>
          </div>

          <div className="card" style={styles.performanceCard}>
            <div style={styles.cardHeader}>
              <Wifi size={24} color="#28a745" />
              <h3>Bandwidth</h3>
            </div>
            <div style={styles.cardValue}>
              {latestReport.bandwidth_gb ? `${latestReport.bandwidth_gb} GB` : 'N/A'}
            </div>
            <div style={styles.cardSubtext}>
              Data transferred
            </div>
          </div>

          <div className="card" style={styles.performanceCard}>
            <div style={styles.cardHeader}>
              <Star size={24} color="#ffc107" />
              <h3>Quality Score</h3>
            </div>
            <div style={styles.cardValue}>
              {latestReport.quality_score || 'N/A'}
            </div>
            <div style={styles.cardSubtext}>
              {latestReport.quality_summary || 'No summary available'}
            </div>
          </div>

          <div className="card" style={styles.performanceCard}>
            <div style={styles.cardHeader}>
              <Users size={24} color="#dc3545" />
              <h3>Student Feedback</h3>
            </div>
            <div style={styles.cardValue}>
              {latestReport.student_feedback_score || 'N/A'}
            </div>
            <div style={styles.cardSubtext}>
              {latestReport.student_feedback_summary || 'No feedback available'}
            </div>
          </div>
        </div>
      )}

      {/* Video Views Chart */}
      {chartData.length > 0 && (
        <div className="card">
          <h3 style={styles.chartTitle}>
            <TrendingUp size={20} />
            Video Views - Last 12 Months
          </h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="video_views" fill="#007bff" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Operations Status */}
      {latestReport && (
        <div className="card">
          <h3>Operations Status</h3>
          <div style={styles.operationsGrid}>
            <div>
              <strong>On Schedule:</strong>
              <span style={{
                ...styles.statusBadge,
                backgroundColor: latestReport.operations_on_schedule ? '#28a745' : '#dc3545'
              }}>
                {latestReport.operations_on_schedule ? 'Yes' : 'No'}
              </span>
            </div>
            <div>
              <strong>Attitude Summary:</strong>
              <p>{latestReport.operations_attitude_summary || 'No summary available'}</p>
            </div>
          </div>
        </div>
      )}

      {/* Monthly Reports Table */}
      {reports.length > 0 && (
        <div className="card">
          <h3>All Monthly Reports</h3>
          <table className="table">
            <thead>
              <tr>
                <th>Month/Year</th>
                <th>Video Views</th>
                <th>Bandwidth (GB)</th>
                <th>Quality Score</th>
                <th>Student Score</th>
                <th>On Schedule</th>
              </tr>
            </thead>
            <tbody>
              {reports
                .sort((a, b) => {
                  const dateA = new Date(a.year, a.month - 1);
                  const dateB = new Date(b.year, b.month - 1);
                  return dateB - dateA; // Most recent first
                })
                .map((report, index) => (
                  <tr key={index}>
                    <td>{report.month}/{report.year}</td>
                    <td>{report.video_views?.toLocaleString() || '-'}</td>
                    <td>{report.bandwidth_gb || '-'}</td>
                    <td>{report.quality_score || '-'}</td>
                    <td>{report.student_feedback_score || '-'}</td>
                    <td>
                      <span style={{
                        ...styles.statusBadge,
                        backgroundColor: report.operations_on_schedule ? '#28a745' : '#dc3545'
                      }}>
                        {report.operations_on_schedule ? 'Yes' : 'No'}
                      </span>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      {reports.length === 0 && (
        <div className="card">
          <div style={styles.emptyState}>
            <p>No monthly reports available for this teacher.</p>
            <Link to="/upload" className="btn btn-primary">
              Upload Performance Data
            </Link>
          </div>
        </div>
      )}
    </div>
  );
};

const styles = {
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '20px',
    marginBottom: '20px',
  },
  teacherInfo: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  reportCount: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    textAlign: 'center',
  },
  countNumber: {
    fontSize: '24px',
    fontWeight: 'bold',
    color: '#007bff',
  },
  countLabel: {
    fontSize: '12px',
    color: '#666',
  },
  performanceCard: {
    textAlign: 'center',
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    marginBottom: '10px',
  },
  cardValue: {
    fontSize: '24px',
    fontWeight: 'bold',
    marginBottom: '5px',
  },
  cardSubtext: {
    fontSize: '12px',
    color: '#666',
  },
  chartTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '20px',
  },
  operationsGrid: {
    display: 'grid',
    gridTemplateColumns: 'auto 1fr',
    gap: '20px',
    alignItems: 'start',
  },
  statusBadge: {
    color: 'white',
    padding: '4px 8px',
    borderRadius: '4px',
    fontSize: '12px',
    fontWeight: 'bold',
    marginLeft: '8px',
  },
  emptyState: {
    textAlign: 'center',
    padding: '40px',
  },
};

export default TeacherProfile;