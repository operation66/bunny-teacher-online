import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { teachersAPI } from '../services/api';
import { ArrowLeft, Save } from 'lucide-react';

const AddTeacher = () => {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    name: '',
    subject: '',
    grade: '',
    bunny_library_id: ''
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      // Convert bunny_library_id to integer if provided, otherwise null
      const teacherData = {
        ...formData,
        bunny_library_id: formData.bunny_library_id ? parseInt(formData.bunny_library_id) : null
      };

      await teachersAPI.create(teacherData);
      navigate('/teachers');
    } catch (err) {
      setError('Failed to create teacher. Please check your input and try again.');
      console.error('Error creating teacher:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container">
      <div style={styles.header}>
        <button
          onClick={() => navigate('/teachers')}
          className="btn btn-secondary"
          style={styles.backBtn}
        >
          <ArrowLeft size={18} />
          Back to Teachers
        </button>
        <h1>Add New Teacher</h1>
      </div>

      {error && (
        <div className="error">
          {error}
        </div>
      )}

      <div className="card">
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="name" className="form-label">
              Teacher Name *
            </label>
            <input
              type="text"
              id="name"
              name="name"
              value={formData.name}
              onChange={handleChange}
              className="form-control"
              required
              placeholder="Enter teacher's full name"
            />
          </div>

          <div className="form-group">
            <label htmlFor="subject" className="form-label">
              Subject *
            </label>
            <input
              type="text"
              id="subject"
              name="subject"
              value={formData.subject}
              onChange={handleChange}
              className="form-control"
              required
              placeholder="e.g., Mathematics, Science, English"
            />
          </div>

          <div className="form-group">
            <label htmlFor="grade" className="form-label">
              Grade *
            </label>
            <input
              type="text"
              id="grade"
              name="grade"
              value={formData.grade}
              onChange={handleChange}
              className="form-control"
              required
              placeholder="e.g., Grade 5, High School, University"
            />
          </div>

          <div className="form-group">
            <label htmlFor="bunny_library_id" className="form-label">
              Bunny.net Library ID
            </label>
            <input
              type="number"
              id="bunny_library_id"
              name="bunny_library_id"
              value={formData.bunny_library_id}
              onChange={handleChange}
              className="form-control"
              placeholder="Enter Bunny.net Video Library ID (optional)"
            />
            <small style={styles.helpText}>
              This ID is used to fetch video statistics from Bunny.net. Leave empty if not available.
            </small>
          </div>

          <div style={styles.formActions}>
            <button
              type="button"
              onClick={() => navigate('/teachers')}
              className="btn btn-secondary"
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={loading}
            >
              {loading ? (
                'Creating...'
              ) : (
                <>
                  <Save size={18} />
                  Create Teacher
                </>
              )}
            </button>
          </div>
        </form>
      </div>
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
  backBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  formActions: {
    display: 'flex',
    gap: '10px',
    justifyContent: 'flex-end',
    marginTop: '20px',
    paddingTop: '20px',
    borderTop: '1px solid #eee',
  },
  helpText: {
    color: '#666',
    fontSize: '12px',
    marginTop: '4px',
    display: 'block',
  },
};

export default AddTeacher;