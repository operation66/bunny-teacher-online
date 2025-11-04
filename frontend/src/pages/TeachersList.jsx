import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { Link } from 'react-router-dom';
import { teachersAPI } from '../services/api';
import { Eye, Calendar, TrendingUp, HardDrive } from 'lucide-react';

const TeachersList = () => {
  const [teachers, setTeachers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [libraryConfigs, setLibraryConfigs] = useState([]);

  useEffect(() => {
    fetchTeachers();
    fetchLibraryConfigs();

    // Subscribe to global config updates from API Configuration page
    const handler = () => {
      fetchLibraryConfigs();
      fetchTeachers();
    };
    window.addEventListener('library-configs:updated', handler);
    window.addEventListener('teachers:updated', handler);
    return () => {
      window.removeEventListener('library-configs:updated', handler);
      window.removeEventListener('teachers:updated', handler);
    };
  }, []);

  const fetchTeachers = async () => {
    try {
      setLoading(true);
      const response = await teachersAPI.getAll();
      setTeachers(response.data);
      setError(null);
    } catch (err) {
      setError('Failed to fetch teachers. Please try again.');
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
      console.warn('Failed to fetch library configs:', err);
    }
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

  if (loading) {
    return (
      <div className="container">
        <div className="loading">Loading Bunny.net libraries...</div>
      </div>
    );
  }

  return (
    <div className="container">
      <div style={styles.header}>
        <h1>Bunny.net Libraries</h1>
      </div>

      {error && (
        <div className="error">
          {error}
        </div>
      )}

      <div className="card">
        {teachers.length === 0 ? (
          <div style={styles.emptyState}>
            <p>No libraries found. Use the API Configuration page to refresh and manage libraries.</p>
          </div>
        ) : (
          <div>
            <div style={styles.summary}>
              <strong>Total Libraries: {teachers.length}</strong>
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th>Library ID</th>
                  <th>Library Name</th>
                  <th>Current Month Views</th>
                  <th>Current Month Bandwidth</th>
                  <th>Last Updated</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {teachers.map((teacher) => (
                  <tr key={teacher.id}>
                    <td>
                      <span style={styles.libraryId}>{teacher.bunny_library_id}</span>
                    </td>
                    <td>
                      {(() => {
                        const cfg = libraryConfigs.find(c => c.library_id === teacher.bunny_library_id);
                        const displayName = cfg?.library_name || teacher.name;
                        return <strong>{displayName}</strong>;
                      })()}
                    </td>
                    <td>
                      <div style={styles.statCell}>
                        <TrendingUp size={16} style={styles.icon} />
                        {formatNumber(teacher.monthly_stats?.[0]?.views || 0)}
                      </div>
                    </td>
                    <td>
                      <div style={styles.statCell}>
                        <HardDrive size={16} style={styles.icon} />
                        {formatBytes(teacher.monthly_stats?.[0]?.bandwidth_gb || 0)}
                      </div>
                    </td>
                    <td>
                      <div style={styles.statCell}>
                        <Calendar size={16} style={styles.icon} />
                        {teacher.monthly_stats?.[0]?.updated_at 
                          ? new Date(teacher.monthly_stats[0].updated_at).toLocaleDateString()
                          : 'Never'
                        }
                      </div>
                    </td>
                    <td>
                      <div style={styles.actions}>
                        <Link
                          to={`/teachers/${teacher.id}`}
                          className="btn btn-secondary"
                          style={styles.actionBtn}
                          title="View Details"
                        >
                        <Eye size={16} />
                      </Link>
                      <Link
                          to={`/teachers/${teacher.id}`}
                          className="btn btn-secondary"
                          style={styles.actionBtn}
                          title="View Details"
                        >
                          <Eye size={16} />
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

const styles = {
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '20px',
  },
  refreshBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  emptyState: {
    textAlign: 'center',
    padding: '40px',
  },
  actions: {
    display: 'flex',
    gap: '8px',
  },
  actionBtn: {
    padding: '6px 8px',
    minWidth: 'auto',
  },
  summary: {
    marginBottom: '20px',
    padding: '15px',
    backgroundColor: '#e3f2fd',
    borderRadius: '8px',
    textAlign: 'center',
    fontWeight: '600',
    color: '#1976d2',
    border: '1px solid #bbdefb',
  },
  libraryId: {
    fontFamily: 'monospace',
    backgroundColor: '#f5f5f5',
    padding: '2px 6px',
    borderRadius: '4px',
    fontSize: '0.9em',
    fontWeight: 'bold',
  },
  statCell: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  icon: {
    color: '#666',
  },
};

export default TeachersList;