import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const ProtectedRoute = ({ path, children }) => {
  const { user } = useAuth();
  const location = useLocation();
  const target = path || location.pathname;

  if (!user) {
    return <Navigate to="/signin" replace state={{ from: location }} />;
  }

  const allowed = Array.isArray(user.allowedPages) && user.allowedPages.includes(target);
  if (!allowed) {
    return <Navigate to={user.allowedPages?.[0] || '/signin'} replace />;
  }

  return children;
};

export default ProtectedRoute;