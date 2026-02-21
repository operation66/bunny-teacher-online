import { apiClient as authApi } from './api';

export { authApi };

export const login = (email, password) =>
  authApi.post('/auth/login', { email, password }).then(res => res.data);

export const usersApi = {
  list: () => authApi.get('/users/').then(res => res.data),
  create: (payload) => authApi.post('/users/', payload).then(res => res.data),
  update: (id, payload) => authApi.put(`/users/${id}`, payload).then(res => res.data),
  remove: (id) => authApi.delete(`/users/${id}`).then(res => res.data)
};

export const PAGES = [
  { key: '/libraries', label: 'Libraries' },
  { key: '/bunny-libraries', label: 'Fetch Stats' },
  { key: '/library-config', label: 'API Config' },
  { key: '/dashboard', label: 'Dashboard' },
  { key: '/settings', label: 'Settings' },
  { key: '/financials', label: 'Financials' },
];
