import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { login } from '../services/auth';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(() => {
    try {
      const raw = localStorage.getItem('elkheta_user');
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  });

  useEffect(() => {
    if (user) localStorage.setItem('elkheta_user', JSON.stringify(user));
    else localStorage.removeItem('elkheta_user');
  }, [user]);

  const signIn = async (email, password) => {
    const data = await login(email, password);
    setUser({ id: data.user_id, email: data.email, allowedPages: data.allowed_pages });
    return data;
  };

  const signOut = () => setUser(null);

  const value = useMemo(() => ({ user, signIn, signOut }), [user]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => useContext(AuthContext);