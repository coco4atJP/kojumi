import { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import ErrorBoundary from './components/ErrorBoundary';
import NotFound from './pages/NotFound';

const Leaderboard = lazy(() => import('./pages/Leaderboard'));
const Agents = lazy(() => import('./pages/Agents'));
const Benchmarks = lazy(() => import('./pages/Benchmarks'));
const Docs = lazy(() => import('./pages/Docs'));

function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Suspense fallback={<div style={{ padding: '2rem', textAlign: 'center' }}>Loading...</div>}>
          <Routes>
            <Route path="/" element={<Layout />}>
              <Route index element={<Leaderboard />} />
              <Route path="agents" element={<Agents />} />
              <Route path="benchmarks" element={<Benchmarks />} />
              <Route path="docs/*" element={<Docs />} />
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </Suspense>
      </BrowserRouter>
    </ErrorBoundary>
  );
}

export default App;
