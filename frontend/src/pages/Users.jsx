import React, { useEffect, useMemo, useState } from 'react';
import { usersApi, PAGES, authApi } from '../services/auth';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Button } from '../components/ui/button';

const UsersPageInner = () => {
  const [users, setUsers] = useState([]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [selected, setSelected] = useState([]);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loadError, setLoadError] = useState('');

  // Edit state
  const [editingUser, setEditingUser] = useState(null);
  const [editEmail, setEditEmail] = useState('');
  const [editPassword, setEditPassword] = useState('');
  const [showEditPassword, setShowEditPassword] = useState(false);
  const [editSelected, setEditSelected] = useState([]);
  const [editError, setEditError] = useState('');
  const [editSuccess, setEditSuccess] = useState('');

  // Delete / force-logout state
  const [deletingId, setDeletingId] = useState(null);
  const [forcingLogoutId, setForcingLogoutId] = useState(null);

  const pageOptions = useMemo(() => [...PAGES], []);

  const load = async () => {
    try {
      const data = await usersApi.list();
      setUsers(data);
    } catch (e) {
      setLoadError('Failed to load users: ' + (e?.response?.data?.detail || e.message));
    }
  };

  useEffect(() => { load(); }, []);

  const toggle = (key) =>
    setSelected((prev) => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);

  const toggleEdit = (key) =>
    setEditSelected((prev) => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);

  const genPassword = () => setPassword(Math.random().toString(36).slice(-10));
  const genEditPassword = () => setEditPassword(Math.random().toString(36).slice(-10));

  const createUser = async (e) => {
    e.preventDefault();
    setError(''); setSuccess('');
    try {
      await usersApi.create({ email, password, allowed_pages: selected });
      setEmail(''); setPassword(''); setSelected([]);
      setSuccess('User created successfully');
      await load();
    } catch (err) {
      setError(err?.response?.data?.detail || 'Failed to create user');
    }
  };

  const startEdit = (user) => {
    setEditingUser(user);
    setEditEmail(user.email);
    setEditPassword('');
    setShowEditPassword(false);
    setEditSelected(Array.isArray(user.allowed_pages) ? user.allowed_pages : []);
    setEditError('');
    setEditSuccess('');
  };

  const cancelEdit = () => {
    setEditingUser(null);
    setEditEmail('');
    setEditPassword('');
    setEditSelected([]);
    setEditError('');
    setEditSuccess('');
  };

  const saveEdit = async (e) => {
    e.preventDefault();
    setEditError(''); setEditSuccess('');
    try {
      const payload = { email: editEmail, allowed_pages: editSelected };
      if (editPassword) payload.password = editPassword;
      await usersApi.update(editingUser.id, payload);
      setEditSuccess('User updated successfully');
      await load();
      setTimeout(() => cancelEdit(), 1000);
    } catch (err) {
      setEditError(err?.response?.data?.detail || 'Failed to update user');
    }
  };

  const deleteUser = async (userId) => {
    if (!window.confirm('Are you sure you want to delete this user?')) return;
    setDeletingId(userId);
    try {
      await usersApi.remove(userId);
      await load();
    } catch (err) {
      alert(err?.response?.data?.detail || 'Failed to delete user');
    } finally {
      setDeletingId(null);
    }
  };

  const forceLogout = async (userId, userEmail) => {
    if (!window.confirm(`Force logout ${userEmail}? Their current session will be immediately invalidated.`)) return;
    setForcingLogoutId(userId);
    try {
      await authApi.post(`/users/${userId}/force-logout`);
      alert(`${userEmail} has been logged out successfully.`);
    } catch (err) {
      alert(err?.response?.data?.detail || 'Failed to force logout user');
    } finally {
      setForcingLogoutId(null);
    }
  };

  return (
    <div className="max-w-3xl mx-auto mt-8 space-y-8">

      {/* ── Create User ── */}
      <Card>
        <CardHeader>
          <CardTitle>Create User</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={createUser} className="space-y-4">
            <div>
              <label className="text-sm text-gray-700">Email</label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <label className="text-sm text-gray-700">Password</label>
                <div style={{ position: 'relative' }}>
                  <Input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    style={{ paddingRight: '80px' }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(p => !p)}
                    style={{
                      position: 'absolute', right: '10px', top: '50%',
                      transform: 'translateY(-50%)', background: 'none',
                      border: 'none', cursor: 'pointer', fontSize: '12px',
                      color: '#666', padding: '2px 6px'
                    }}
                  >
                    {showPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>
              <Button type="button" onClick={genPassword}>Generate</Button>
            </div>
            <div>
              <label className="text-sm text-gray-700">Allowed Pages</label>
              <div className="grid grid-cols-2 gap-2 mt-2">
                {pageOptions.map(p => (
                  <label key={p.key} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={selected.includes(p.key)} onChange={() => toggle(p.key)} />
                    {p.label}
                  </label>
                ))}
              </div>
            </div>
            {error && <div className="text-sm text-red-600">{error}</div>}
            {success && <div className="text-sm text-green-600">{success}</div>}
            <Button type="submit">Save User</Button>
          </form>
        </CardContent>
      </Card>

      {/* ── Existing Users ── */}
      <Card>
        <CardHeader>
          <CardTitle>Existing Users</CardTitle>
        </CardHeader>
        <CardContent>
          {loadError && <div className="text-sm text-red-600 mb-3">{loadError}</div>}
          <div className="space-y-3">
            {users.map(u => (
              <div key={u.id} className="border rounded-md overflow-hidden">

                {/* ── View mode ── */}
                {editingUser?.id !== u.id && (
                  <div className="p-3">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="font-medium">{u.email}</div>
                        <div className="text-sm text-gray-500 mt-1">
                          Pages: {Array.isArray(u.allowed_pages) ? u.allowed_pages.join(', ') : '—'}
                        </div>
                      </div>
                      <div className="flex gap-2 shrink-0 flex-wrap justify-end">
                        <Button
                          type="button"
                          onClick={() => startEdit(u)}
                          style={{ backgroundColor: '#3498db', color: 'white', padding: '6px 14px', fontSize: '13px' }}
                        >
                          Edit
                        </Button>
                        <Button
                          type="button"
                          onClick={() => forceLogout(u.id, u.email)}
                          disabled={forcingLogoutId === u.id}
                          style={{ backgroundColor: '#e67e22', color: 'white', padding: '6px 14px', fontSize: '13px' }}
                        >
                          {forcingLogoutId === u.id ? 'Logging out…' : 'Sign Out User'}
                        </Button>
                        <Button
                          type="button"
                          onClick={() => deleteUser(u.id)}
                          disabled={deletingId === u.id}
                          style={{ backgroundColor: '#e74c3c', color: 'white', padding: '6px 14px', fontSize: '13px' }}
                        >
                          {deletingId === u.id ? 'Deleting…' : 'Delete'}
                        </Button>
                      </div>
                    </div>
                  </div>
                )}

                {/* ── Edit mode ── */}
                {editingUser?.id === u.id && (
                  <form onSubmit={saveEdit} className="p-4 bg-gray-50 space-y-4">
                    <div className="font-medium text-gray-700 mb-1">Editing: {u.email}</div>

                    <div>
                      <label className="text-sm text-gray-700">Email</label>
                      <Input
                        type="email"
                        value={editEmail}
                        onChange={(e) => setEditEmail(e.target.value)}
                        required
                      />
                    </div>

                    <div className="flex items-end gap-2">
                      <div className="flex-1">
                        <label className="text-sm text-gray-700">
                          New Password <span className="text-gray-400">(leave blank to keep current)</span>
                        </label>
                        <div style={{ position: 'relative' }}>
                          <Input
                            type={showEditPassword ? 'text' : 'password'}
                            value={editPassword}
                            onChange={(e) => setEditPassword(e.target.value)}
                            placeholder="Leave blank to keep current"
                            style={{ paddingRight: '80px' }}
                          />
                          <button
                            type="button"
                            onClick={() => setShowEditPassword(p => !p)}
                            style={{
                              position: 'absolute', right: '10px', top: '50%',
                              transform: 'translateY(-50%)', background: 'none',
                              border: 'none', cursor: 'pointer', fontSize: '12px',
                              color: '#666', padding: '2px 6px'
                            }}
                          >
                            {showEditPassword ? 'Hide' : 'Show'}
                          </button>
                        </div>
                      </div>
                      <Button type="button" onClick={genEditPassword}>Generate</Button>
                    </div>

                    <div>
                      <label className="text-sm text-gray-700">Allowed Pages</label>
                      <div className="grid grid-cols-2 gap-2 mt-2">
                        {pageOptions.map(p => (
                          <label key={p.key} className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={editSelected.includes(p.key)}
                              onChange={() => toggleEdit(p.key)}
                            />
                            {p.label}
                          </label>
                        ))}
                      </div>
                    </div>

                    {editError && <div className="text-sm text-red-600">{editError}</div>}
                    {editSuccess && <div className="text-sm text-green-600">{editSuccess}</div>}

                    <div className="flex gap-2">
                      <Button type="submit" style={{ backgroundColor: '#27ae60', color: 'white' }}>
                        Save Changes
                      </Button>
                      <Button type="button" onClick={cancelEdit} style={{ backgroundColor: '#95a5a6', color: 'white' }}>
                        Cancel
                      </Button>
                    </div>
                  </form>
                )}

              </div>
            ))}
            {users.length === 0 && !loadError && (
              <div className="text-sm text-gray-600">No users yet.</div>
            )}
          </div>
        </CardContent>
      </Card>

    </div>
  );
};

export default UsersPageInner;
