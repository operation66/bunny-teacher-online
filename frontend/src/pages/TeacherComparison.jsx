import React, { useState, useEffect } from 'react';
import { teachersAPI } from '../services/api';
import { Users, Video, Wifi, Star, TrendingUp, ArrowRight } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

const TeacherComparison = () => {
  const [teachers, setTeachers] = useState([]);
  const [selectedTeacher1, setSelectedTeacher1] = useState('');
  const [selectedTeacher2, setSelectedTeacher2] = useState('');
  const [teacher1Data, setTeacher1Data] = useState(null);
  const [teacher2Data, setTeacher2Data] = useState(null);
  const [teacher1Reports, setTeacher1Reports] = useState([]);
  const [teacher2Reports, setTeacher2Reports] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchTeachers();
  }, []);

  useEffect(() => {
    if (selectedTeacher1 && selectedTeacher2) {
      fetchComparisonData();
    }
  }, [selectedTeacher1, selectedTeacher2]);

  const fetchTeachers = async () => {
    try {
      const response = await teachersAPI.getAll();
      setTeachers(response.data);
    } catch (err) {
      setError('Failed to fetch teachers');
      console.error('Error fetching teachers:', err);
    }
  };

  const fetchComparisonData = async () => {
    if (!selectedTeacher1 || !selectedTeacher2) return;

    try {
      setLoading(true);
      setError(null);

      const [teacher1Response, teacher2Response] = await Promise.all([
        teachersAPI.getById(selectedTeacher1),
        teachersAPI.getById(selectedTeacher2)
      ]);

      setTeacher1Data(teacher1Response.data);
      setTeacher2Data(teacher2Response.data);

      // Fetch reports for both teachers
      try {
        const [reports1Response, reports2Response] = await Promise.all([
  fetch(`/api/teachers/${selectedTeacher1}/reports`).catch(() => ({ json: () => [] })),
  fetch(`/api/teachers/${selectedTeacher2}/reports`).catch(() => ({ json: () => [] }))
        ]);

        const reports1Data = await reports1Response.json().catch(() => []);
        const reports2Data = await reports2Response.json().catch(() => []);

        setTeacher1Reports(Array.isArray(reports1Data) ? reports1Data : []);
        setTeacher2Reports(Array.isArray(reports2Data) ? reports2Data : []);
      } catch {
        setTeacher1Reports([]);
        setTeacher2Reports([]);
      }

    } catch (err) {
      setError('Failed to fetch comparison data');
      console.error('Error fetching comparison data:', err);
    } finally {
      setLoading(false);
    }
  };

  const getLatestReport = (reports) => {
    if (reports.length === 0) return null;
    return reports.reduce((latest, current) => {
      const latestDate = new Date(latest.year, latest.month - 1);
      const currentDate = new Date(current.year, current.month - 1);
      return currentDate > latestDate ? current : latest;
    });
  };

  const getAverageMetrics = (reports) => {
    if (reports.length === 0) return {};
    
    const totals = reports.reduce((acc, report) => ({
      video_views: acc.video_views + (report.video_views || 0),
      bandwidth_gb: acc.bandwidth_gb + (report.bandwidth_gb || 0),
      quality_score: acc.quality_score + (report.quality_score || 0),
      student_feedback_score: acc.student_feedback_score + (report.student_feedback_score || 0),
    }), { video_views: 0, bandwidth_gb: 0, quality_score: 0, student_feedback_score: 0 });

    return {
      avg_video_views: Math.round(totals.video_views / reports.length),
      avg_bandwidth_gb: Math.round(totals.bandwidth_gb / reports.length * 100) / 100,
      avg_quality_score: Math.round(totals.quality_score / reports.length * 100) / 100,
      avg_student_feedback_score: Math.round(totals.student_feedback_score / reports.length * 100) / 100,
    };
  };

  const getChartData = () => {
    const maxLength = Math.max(teacher1Reports.length, teacher2Reports.length);
    const chartData = [];

    for (let i = 0; i < maxLength; i++) {
      const report1 = teacher1Reports[i];
      const report2 = teacher2Reports[i];
      
      chartData.push({
        month: report1 ? `${report1.month}/${report1.year}` : (report2 ? `${report2.month}/${report2.year}` : `Month ${i + 1}`),
        teacher1_views: report1?.video_views || 0,
        teacher2_views: report2?.video_views || 0,
      });
    }

    return chartData.slice(-6); // Last 6 months for better visibility
  };

  const teacher1Latest = getLatestReport(teacher1Reports);
  const teacher2Latest = getLatestReport(teacher2Reports);
  const teacher1Averages = getAverageMetrics(teacher1Reports);
  const teacher2Averages = getAverageMetrics(teacher2Reports);
  const chartData = getChartData();

  return (
    <div className="container">
      <h1>Teacher Performance Comparison</h1>

      {/* Teacher Selection */}
      <div className="card">
        <h3>Select Teachers to Compare</h3>
        <div className="grid grid-2">
          <div>
            <label>First Teacher:</label>
            <select
              value={selectedTeacher1}
              onChange={(e) => setSelectedTeacher1(e.target.value)}
              className="form-control"
            >
              <option value="">Select a teacher...</option>
              {teachers.map(teacher => (
                <option key={teacher.id} value={teacher.id}>
                  {teacher.name} - {teacher.subject}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>Second Teacher:</label>
            <select
              value={selectedTeacher2}
              onChange={(e) => setSelectedTeacher2(e.target.value)}
              className="form-control"
            >
              <option value="">Select a teacher...</option>
              {teachers.filter(t => t.id !== parseInt(selectedTeacher1)).map(teacher => (
                <option key={teacher.id} value={teacher.id}>
                  {teacher.name} - {teacher.subject}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {loading && (
        <div className="loading">Loading comparison data...</div>
      )}

      {error && (
        <div className="error">{error}</div>
      )}

      {/* Comparison Results */}
      {teacher1Data && teacher2Data && !loading && (
        <>
          {/* Teacher Info Comparison */}
          <div className="card">
            <h3>Teacher Information</h3>
            <div className="grid grid-2">
              <div style={styles.teacherCard}>
                <h4>{teacher1Data.name}</h4>
                <p><strong>Subject:</strong> {teacher1Data.subject}</p>
                <p><strong>Grade:</strong> {teacher1Data.grade}</p>
                <p><strong>Reports:</strong> {teacher1Reports.length}</p>
              </div>
              <div style={styles.teacherCard}>
                <h4>{teacher2Data.name}</h4>
                <p><strong>Subject:</strong> {teacher2Data.subject}</p>
                <p><strong>Grade:</strong> {teacher2Data.grade}</p>
                <p><strong>Reports:</strong> {teacher2Reports.length}</p>
              </div>
            </div>
          </div>

          {/* Latest Performance Comparison */}
          {(teacher1Latest || teacher2Latest) && (
            <div className="card">
              <h3>Latest Month Performance</h3>
              <div style={styles.comparisonTable}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Metric</th>
                      <th>{teacher1Data.name}</th>
                      <th>{teacher2Data.name}</th>
                      <th>Winner</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td><Video size={16} /> Video Views</td>
                      <td>{teacher1Latest?.video_views?.toLocaleString() || 'N/A'}</td>
                      <td>{teacher2Latest?.video_views?.toLocaleString() || 'N/A'}</td>
                      <td>
                        {getWinner(teacher1Latest?.video_views, teacher2Latest?.video_views, teacher1Data.name, teacher2Data.name)}
                      </td>
                    </tr>
                    <tr>
                      <td><Wifi size={16} /> Bandwidth (GB)</td>
                      <td>{teacher1Latest?.bandwidth_gb || 'N/A'}</td>
                      <td>{teacher2Latest?.bandwidth_gb || 'N/A'}</td>
                      <td>
                        {getWinner(teacher1Latest?.bandwidth_gb, teacher2Latest?.bandwidth_gb, teacher1Data.name, teacher2Data.name)}
                      </td>
                    </tr>
                    <tr>
                      <td><Star size={16} /> Quality Score</td>
                      <td>{teacher1Latest?.quality_score || 'N/A'}</td>
                      <td>{teacher2Latest?.quality_score || 'N/A'}</td>
                      <td>
                        {getWinner(teacher1Latest?.quality_score, teacher2Latest?.quality_score, teacher1Data.name, teacher2Data.name)}
                      </td>
                    </tr>
                    <tr>
                      <td><Users size={16} /> Student Feedback</td>
                      <td>{teacher1Latest?.student_feedback_score || 'N/A'}</td>
                      <td>{teacher2Latest?.student_feedback_score || 'N/A'}</td>
                      <td>
                        {getWinner(teacher1Latest?.student_feedback_score, teacher2Latest?.student_feedback_score, teacher1Data.name, teacher2Data.name)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Average Performance Comparison */}
          {(teacher1Reports.length > 0 || teacher2Reports.length > 0) && (
            <div className="card">
              <h3>Average Performance (All Time)</h3>
              <div style={styles.comparisonTable}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Metric</th>
                      <th>{teacher1Data.name}</th>
                      <th>{teacher2Data.name}</th>
                      <th>Winner</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td><Video size={16} /> Avg Video Views</td>
                      <td>{teacher1Averages.avg_video_views?.toLocaleString() || 'N/A'}</td>
                      <td>{teacher2Averages.avg_video_views?.toLocaleString() || 'N/A'}</td>
                      <td>
                        {getWinner(teacher1Averages.avg_video_views, teacher2Averages.avg_video_views, teacher1Data.name, teacher2Data.name)}
                      </td>
                    </tr>
                    <tr>
                      <td><Wifi size={16} /> Avg Bandwidth (GB)</td>
                      <td>{teacher1Averages.avg_bandwidth_gb || 'N/A'}</td>
                      <td>{teacher2Averages.avg_bandwidth_gb || 'N/A'}</td>
                      <td>
                        {getWinner(teacher1Averages.avg_bandwidth_gb, teacher2Averages.avg_bandwidth_gb, teacher1Data.name, teacher2Data.name)}
                      </td>
                    </tr>
                    <tr>
                      <td><Star size={16} /> Avg Quality Score</td>
                      <td>{teacher1Averages.avg_quality_score || 'N/A'}</td>
                      <td>{teacher2Averages.avg_quality_score || 'N/A'}</td>
                      <td>
                        {getWinner(teacher1Averages.avg_quality_score, teacher2Averages.avg_quality_score, teacher1Data.name, teacher2Data.name)}
                      </td>
                    </tr>
                    <tr>
                      <td><Users size={16} /> Avg Student Feedback</td>
                      <td>{teacher1Averages.avg_student_feedback_score || 'N/A'}</td>
                      <td>{teacher2Averages.avg_student_feedback_score || 'N/A'}</td>
                      <td>
                        {getWinner(teacher1Averages.avg_student_feedback_score, teacher2Averages.avg_student_feedback_score, teacher1Data.name, teacher2Data.name)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Video Views Chart Comparison */}
          {chartData.length > 0 && (
            <div className="card">
              <h3 style={styles.chartTitle}>
                <TrendingUp size={20} />
                Video Views Comparison - Last 6 Months
              </h3>
              <ResponsiveContainer width="100%" height={400}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="teacher1_views" fill="#007bff" name={teacher1Data.name} />
                  <Bar dataKey="teacher2_views" fill="#28a745" name={teacher2Data.name} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </>
      )}

      {/* Empty State */}
      {!selectedTeacher1 || !selectedTeacher2 ? (
        <div className="card">
          <div style={styles.emptyState}>
            <Users size={48} color="#ccc" />
            <h3>Select Two Teachers to Compare</h3>
            <p>Choose two teachers from the dropdowns above to see their performance comparison.</p>
          </div>
        </div>
      ) : null}
    </div>
  );
};

// Helper function to determine winner
const getWinner = (value1, value2, name1, name2) => {
  if (!value1 && !value2) return 'N/A';
  if (!value1) return name2;
  if (!value2) return name1;
  
  if (value1 > value2) {
    return <span style={{ color: '#007bff', fontWeight: 'bold' }}>{name1}</span>;
  } else if (value2 > value1) {
    return <span style={{ color: '#28a745', fontWeight: 'bold' }}>{name2}</span>;
  } else {
    return 'Tie';
  }
};

const styles = {
  teacherCard: {
    padding: '15px',
    border: '1px solid #ddd',
    borderRadius: '8px',
    backgroundColor: '#f8f9fa',
  },
  comparisonTable: {
    overflowX: 'auto',
  },
  chartTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '20px',
  },
  emptyState: {
    textAlign: 'center',
    padding: '60px 20px',
    color: '#666',
  },
};

export default TeacherComparison;