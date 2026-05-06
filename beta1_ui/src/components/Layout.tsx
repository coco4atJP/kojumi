import { useState, useEffect } from 'react';
import { Outlet, NavLink, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import styles from './Layout.module.css';
import TrialKeyModal from './TrialKeyModal';

const getInitialTheme = () => {
  if (typeof window === 'undefined') return 'light';

  try {
    const savedTheme = window.localStorage?.getItem('theme');
    if (savedTheme === 'light' || savedTheme === 'dark') return savedTheme;
  } catch {
    // Some test and privacy-hardened browser environments deny storage access.
  }

  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

export default function Layout() {
  const { t, i18n } = useTranslation();
  
  const [theme, setTheme] = useState(getInitialTheme);
  const [isTrialModalOpen, setIsTrialModalOpen] = useState(false);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      window.localStorage?.setItem('theme', theme);
    } catch {
      // Theme still applies for the current render even when storage is unavailable.
    }
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prevTheme => prevTheme === 'light' ? 'dark' : 'light');
  };

  const changeLanguage = (e: React.ChangeEvent<HTMLSelectElement>) => {
    i18n.changeLanguage(e.target.value);
  };


  return (
    <div className={styles.container}>
      {/* Top Navigation */}
      <header className={styles.header}>
        <div className={styles.headerContent}>
          <div className={styles.leftSection}>
            <Link to="/" className={styles.logoContainer}>
              <img src="/logo.png" alt="Kojumi Logo" className={styles.logoImage} />
              <div className={styles.logoText}>Kojumi</div>
            </Link>
            
            <nav className={styles.nav}>
              <NavLink 
                to="/" 
                className={({ isActive }) => `${styles.link} ${isActive ? styles.active : ''}`}
              >
                {t('nav.leaderboard')}
              </NavLink>
              <NavLink 
                to="/agents" 
                className={({ isActive }) => `${styles.link} ${isActive ? styles.active : ''}`}
              >
                {t('nav.agents')}
              </NavLink>
              <NavLink 
                to="/benchmarks" 
                className={({ isActive }) => `${styles.link} ${isActive ? styles.active : ''}`}
              >
                {t('nav.benchmarks', 'Benchmarks')}
              </NavLink>
            </nav>
          </div>

          <div className={styles.rightSection}>
            <span className={styles.badge}>{t('header.badge')}</span>
            
            <select 
              className={styles.languageSelect} 
              value={i18n.language} 
              onChange={changeLanguage}
              aria-label="Select Language"
            >
              <option value="en">EN</option>
              <option value="ja">JA</option>
              <option value="zh">ZH</option>
              <option value="es">ES</option>
              <option value="fr">FR</option>
              <option value="de">DE</option>
            </select>

            <button onClick={toggleTheme} className={styles.themeToggle} aria-label="Toggle dark mode">
              {theme === 'dark' ? '☀️' : '🌙'}
            </button>
            <Link to="/docs" className={styles.docsLink}>
              {t('nav.docs')}
            </Link>
            <button onClick={() => setIsTrialModalOpen(true)} className={styles.dummyKeyButton}>
              {t('nav.dummyKey', 'Get Trial Key')}
            </button>
            <a 
              href="https://forms.gle/aWKF9XLTDtzkwqKd9" 
              target="_blank" 
              rel="noopener noreferrer" 
              className={styles.applyLink}
            >
              {t('nav.apply')}
            </a>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className={styles.mainWrapper}>
        <div className={styles.main}>
          <Outlet />
        </div>
      </main>

      {/* Footer */}
      <footer className={styles.footer}>
        <div className={styles.footerContent}>
          <p>{t('footer.copyright', { year: new Date().getFullYear() })}</p>
        </div>
      </footer>
      <TrialKeyModal isOpen={isTrialModalOpen} onClose={() => setIsTrialModalOpen(false)} />
    </div>
  );
}
