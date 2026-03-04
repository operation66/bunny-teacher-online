import axios from 'axios';

const _envBase = import.meta.env?.VITE_API_BASE_URL;
const API_BASE_URL = (_envBase && _envBase.trim() !== '')
  ? _envBase.replace(/\/$/, '')
  : '/api';

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
});

// NEW: Add a request interceptor to attach the JWT token
apiClient.interceptors.request.use((config) => {
  let token = localStorage.getItem('token');
  
  if (!token) {
    try {
      const raw = localStorage.getItem('elkheta_user');
      if (raw) token = JSON.parse(raw).token;
    } catch {}
  }
  
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('elkheta_user');
      alert('Your session has been reset. Please sign in again.');
      window.location.href = '/signin';
    }
    return Promise.reject(error);
  }
);

const api = apiClient;

// Teachers API
export const teachersAPI = {
  // Get all teachers
  getAll: (skip = 0, limit = 500) => 
    api.get(`/teachers/?skip=${skip}&limit=${limit}`),
  
  // Get teacher by ID
  getById: (id) => 
    api.get(`/teachers/${id}`),
  
  // Create new teacher
  create: (teacherData) => 
    api.post('/teachers/', teacherData),
  
  // Update teacher
  update: (id, teacherData) => 
    api.put(`/teachers/${id}`, teacherData),
  
  // Delete teacher
  delete: (id) => 
    api.delete(`/teachers/${id}`),
};

// Monthly Reports API
export const reportsAPI = {
  // Get reports for a specific teacher
  getByTeacher: (teacherId) => 
    api.get(`/teachers/${teacherId}/reports`),
  
  // Upload Excel file
  uploadExcel: (formData) => 
    api.post('/upload-excel/', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    }),
  
  // Trigger monthly fetch
  triggerMonthlyFetch: () => 
    api.post('/trigger-monthly-fetch/'),
};

export default api;
