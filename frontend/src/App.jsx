import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Navbar from './components/Navbar';
import ProtectedRoute from './components/ProtectedRoute';
import { AuthProvider } from './context/AuthContext';
import Libraries from './pages/Libraries';
import BunnyLibraries from './pages/BunnyLibraries';
import LibraryConfig from './pages/LibraryConfig';
import Dashboard from './pages/Dashboard';
import TestTailwind from './test-tailwind';
import SignIn from './pages/SignIn';
import Users from './pages/Users';
import Settings from './pages/Settings';
import Financials from './pages/Financials';

function App() {
  return (
    <AuthProvider>
      <div className="min-h-screen bg-gray-50">
        <Navbar />
        <main>
          <Routes>
            <Route path="/" element={<Navigate to="/libraries" replace />} />
            <Route path="/signin" element={<SignIn />} />
            <Route path="/users" element={<Users />} />
            <Route path="/libraries" element={<ProtectedRoute path="/libraries"><Libraries /></ProtectedRoute>} />
            <Route path="/bunny-libraries" element={<ProtectedRoute path="/bunny-libraries"><BunnyLibraries /></ProtectedRoute>} />
            <Route path="/library-config" element={<ProtectedRoute path="/library-config"><LibraryConfig /></ProtectedRoute>} />
            <Route path="/dashboard" element={<ProtectedRoute path="/dashboard"><Dashboard /></ProtectedRoute>} />
            <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
            <Route path="/financials" element={<ProtectedRoute><Financials /></ProtectedRoute>} />
            <Route path="/test" element={<TestTailwind />} />
          </Routes>
        </main>
      </div>
    </AuthProvider>
  );
}

const styles = {
  main: {
    paddingTop: '80px', // Account for fixed navbar
    minHeight: '100vh',
    backgroundColor: '#f8f9fa',
  },
};

export default App;
