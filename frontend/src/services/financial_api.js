// FILE: frontend/src/services/financial_api.js
import api from './api';

const financialApi = {
  // ============================================
  // STAGES
  // ============================================
  getStages: async () => {
    const response = await api.get('/stages/');
    return response.data;
  },
  createStage: async (stageData) => {
    const response = await api.post('/stages/', stageData);
    return response.data;
  },
  updateStage: async (stageId, stageData) => {
    const response = await api.put(`/stages/${stageId}`, stageData);
    return response.data;
  },
  deleteStage: async (stageId) => {
    const response = await api.delete(`/stages/${stageId}`);
    return response.data;
  },

  // ============================================
  // SECTIONS
  // ============================================
  getSections: async (stageId = null) => {
    const params = stageId ? { stage_id: stageId } : {};
    const response = await api.get('/sections/', { params });
    return response.data;
  },
  createSection: async (sectionData) => {
    const response = await api.post('/sections/', sectionData);
    return response.data;
  },
  deleteSection: async (sectionId) => {
    const response = await api.delete(`/sections/${sectionId}`);
    return response.data;
  },

  // ============================================
  // SUBJECTS
  // ============================================
  getSubjects: async () => {
    const response = await api.get('/subjects/');
    return response.data;
  },
  createSubject: async (subjectData) => {
    const response = await api.post('/subjects/', subjectData);
    return response.data;
  },
  deleteSubject: async (subjectId) => {
    const response = await api.delete(`/subjects/${subjectId}`);
    return response.data;
  },

  // ============================================
  // TEACHER ASSIGNMENTS
  // ============================================
  getTeacherAssignments: async (stageId = null) => {
    const params = stageId ? { stage_id: stageId } : {};
    const response = await api.get('/teacher-assignments/', { params });
    return response.data;
  },
  createTeacherAssignment: async (assignmentData) => {
    const response = await api.post('/teacher-assignments/', assignmentData);
    return response.data;
  },
  updateTeacherAssignment: async (assignmentId, assignmentData) => {
    const response = await api.put(`/teacher-assignments/${assignmentId}`, assignmentData);
    return response.data;
  },
  deleteTeacherAssignment: async (assignmentId) => {
    const response = await api.delete(`/teacher-assignments/${assignmentId}`);
    return response.data;
  },
  autoMatchTeachers: async () => {
    const response = await api.post('/teacher-assignments/auto-match');
    return response.data;
  },

  // ============================================
  // FINANCIAL PERIODS
  // ============================================
  getFinancialPeriods: async () => {
    const response = await api.get('/financial-periods/');
    return response.data;
  },
  createFinancialPeriod: async (periodData) => {
    const response = await api.post('/financial-periods/', periodData);
    return response.data;
  },
  updateFinancialPeriod: async (periodId, periodData) => {
    const response = await api.put(`/financial-periods/${periodId}`, periodData);
    return response.data;
  },
  deleteFinancialPeriod: async (periodId) => {
    const response = await api.delete(`/financial-periods/${periodId}`);
    return response.data;
  },

  // ============================================
  // SECTION REVENUES
  // ============================================
  createOrUpdateSectionRevenue: async (revenueData) => {
    const response = await api.post('/section-revenues/', revenueData);
    return response.data;
  },

  // ============================================
  // FINANCIAL DATA & CALCULATIONS
  // ============================================
  getFinancialData: async (periodId, stageId) => {
    const response = await api.get(`/financials/${periodId}/${stageId}`);
    return response.data;
  },

  // NEW: library preview for approval popup
  getLibrariesPreview: async (periodId, stageId) => {
    const response = await api.get(`/financials/${periodId}/${stageId}/libraries-preview`);
    return response.data;
  },

  // Updated: now accepts excludedLibraryIds array
  calculatePayments: async (periodId, stageId, excludedLibraryIds = []) => {
    const response = await api.post(
      `/calculate-payments/${periodId}/${stageId}`,
      { excluded_library_ids: excludedLibraryIds }
    );
    return response.data;
  },

  getTeacherPayments: async (periodId) => {
    const response = await api.get(`/teacher-payments/${periodId}`);
    return response.data;
  },
};

export default financialApi;
