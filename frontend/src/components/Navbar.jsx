import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Home, Users, Upload, BarChart3, TrendingUp, Video, Settings, Database } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const Navbar = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, signOut } = useAuth();

  const baseItems = [
    { path: '/libraries', label: 'Libraries', icon: Database },
    { path: '/bunny-libraries', label: 'Fetch Stats', icon: Video },
    { path: '/library-config', label: 'API Config', icon: Settings },
    { path: '/dashboard', label: 'Dashboard', icon: TrendingUp },
    { path: '/users', label: 'Users', icon: Users },
  ];

  const navItems = user ? baseItems.filter(i => (user.allowedPages||[]).includes(i.path)) : [];

  return (
    <nav style={styles.navbar}>
      <div style={styles.container}>
        <Link to="/libraries" style={styles.brand}>
          <BarChart3 size={24} />
          <span>Elkheta Dashboard</span>
        </Link>
        
        <div style={styles.navLinks}>
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;
            
            return (
              <Link
                key={item.path}
                to={item.path}
                style={{
                  ...styles.navLink,
                  ...(isActive ? styles.activeLink : {})
                }}
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </Link>
            );
          })}

          {/* Sign In button - only shown when NOT logged in */}
          {!user && (
            <Link to="/signin" style={styles.navLink}>
              <span>Sign In</span>
            </Link>
          )}

          {/* Sign Out button - only shown when logged in */}
          {user && (
            <button
              onClick={() => {
                signOut();
                navigate('/signin');
              }}
              style={{
                ...styles.navLink,
                backgroundColor: '#e74c3c',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              <span>Sign Out</span>
            </button>
          )}
        </div>
      </div>
    </nav>
  );
};

const styles = {
  navbar: {
    backgroundColor: '#2c3e50',
    color: 'white',
    padding: '0',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
  },
  container: {
    maxWidth: '1200px',
    margin: '0 auto',
    padding: '0 20px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    height: '60px',
  },
  brand: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    color: 'white',
    textDecoration: 'none',
    fontSize: '20px',
    fontWeight: 'bold',
  },
  navLinks: {
    display: 'flex',
    gap: '20px',
  },
  navLink: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    color: 'white',
    textDecoration: 'none',
    padding: '8px 16px',
    borderRadius: '4px',
    transition: 'background-color 0.2s',
  },
  activeLink: {
    backgroundColor: '#34495e',
  },
};

export default Navbar;
