import type React from 'react';
import { Link } from 'react-router-dom';

const NotFound: React.FC = () => {
  return (
    <div style={{ padding: '4rem 2rem', textAlign: 'center' }}>
      <h1 style={{ fontSize: '3rem', marginBottom: '1rem' }}>404</h1>
      <p style={{ fontSize: '1.5rem', marginBottom: '2rem' }}>Page not found</p>
      <Link to="/" style={{ padding: '0.5rem 1rem', textDecoration: 'none', background: '#3b82f6', color: 'white', borderRadius: '4px' }}>
        Go back home
      </Link>
    </div>
  );
};

export default NotFound;
