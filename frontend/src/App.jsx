import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Navbar from './components/Navbar';
import ProtectedRoute from './components/ProtectedRoute';
import { AuthProvider } from './context/AuthContext';
import Libraries from './pages/Libraries';
import BunnyLibraries from './pages/BunnyLibraries';
import LibraryConfig from './pages/LibraryConfig';
import DataUpload from './pages/DataUpload';
import Dashboard from './pages/Dashboard';
import TeacherComparison from './pages/TeacherComparison';
import TestTailwind from './test-tailwind';
import SignIn from './pages/SignIn';
import Users from './pages/Users';

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
            <Route path="/upload" element={<ProtectedRoute path="/upload"><DataUpload /></ProtectedRoute>} />
            <Route path="/dashboard" element={<ProtectedRoute path="/dashboard"><Dashboard /></ProtectedRoute>} />
            <Route path="/compare" element={<ProtectedRoute path="/compare"><TeacherComparison /></ProtectedRoute>} />
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