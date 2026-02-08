import React, { useEffect, useMemo, useState } from 'react';
import { usersApi, PAGES } from '../services/auth';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Button } from '../components/ui/button';
import ProtectedRoute from '../components/ProtectedRoute';

const UsersPageInner = () => {
  const [users, setUsers] = useState([]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [selected, setSelected] = useState([]);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  
  // Add Users page to the available options
  const pageOptions = useMemo(() => {
    const allPages = [...PAGES];
    // Check if Users page already exists
    if (!allPages.find(p => p.key === '/users')) {
      allPages.push({ key: '/users', label: 'Users' });
    }
    return allPages;
  }, []);
  
  const load = async () => {
    try { setUsers(await usersApi.list()); } catch (e) { /* ignore */ }
  };
  
  useEffect(() => { load(); }, []);
  
  const toggle = (key) => {
    setSelected((prev) => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
  };
  
  const genPassword = () => {
    const p = Math.random().toString(36).slice(-10);
    setPassword(p);
  };
  
  const createUser = async (e) => {
    e.preventDefault();
    setError(''); setSuccess('');
    try {
      await usersApi.create({ email, password, allowed_pages: selected });
      setEmail(''); setPassword(''); setSelected([]);
      setSuccess('User created');
      await load();
    } catch (err) {
      setError(err?.response?.data?.detail || 'Failed to create user');
    }
  };
  
  return (
    <div className="max-w-3xl mx-auto mt-8 space-y-8">
      <Card>
        <CardHeader>
          <CardTitle>Create User</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={createUser} className="space-y-4">
            <div>
              <label className="text-sm text-gray-700">Email</label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <label className="text-sm text-gray-700">Password</label>
                <Input type="text" value={password} onChange={(e) => setPassword(e.target.value)} />
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
      <Card>
        <CardHeader>
          <CardTitle>Existing Users</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {users.map(u => (
              <div key={u.id} className="p-3 border rounded-md">
                <div className="font-medium">{u.email}</div>
                <div className="text-sm text-gray-600">Pages: {Array.isArray(u.allowed_pages) ? u.allowed_pages.join(', ') : ''}</div>
              </div>
            ))}
            {users.length === 0 && <div className="text-sm text-gray-600">No users yet.</div>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default UsersPageInner;
