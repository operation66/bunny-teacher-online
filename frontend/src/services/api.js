import axios from 'axios';

const envBase = import.meta.env?.VITE_API_BASE_URL;
const API_BASE_URL = (envBase && envBase.trim() !== '')
  ? envBase.replace(/\/$/, '')
  : '/api';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Teachers API
export const teachersAPI = {
  // Get all teachers (fetch a large batch to cover all libraries)
  getAll: (skip = 0, limit = 10000) => 
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