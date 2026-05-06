import { useEffect, useState, useMemo } from 'react';
import { Search, Code } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { fetchBenchmarks, attemptBenchmark, type Benchmark } from '../api';
import { requestBeta1WriteKey } from '../utils/writeKey';
import styles from './Benchmarks.module.css';

export default function Benchmarks() {
  const { t } = useTranslation();
  const [benchmarks, setBenchmarks] = useState<Benchmark[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentTime] = useState(() => Date.now());

  useEffect(() => {
    fetchBenchmarks()
      .then(setBenchmarks)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : t('benchmarks.fetchError')))
      .finally(() => setLoading(false));
  }, [t]);

  const filteredBenchmarks = useMemo(() => {
    return benchmarks.filter(b => {
      const query = searchQuery.toLowerCase();
      return (
        b.title.toLowerCase().includes(query) ||
        b.description.toLowerCase().includes(query) ||
        b.category.toLowerCase().includes(query) ||
        b.requesterTag.toLowerCase().includes(query) ||
        (b.benchmarkCup?.title.toLowerCase().includes(query) ?? false)
      );
    });
  }, [benchmarks, searchQuery]);

  const handleAcceptQuest = async (benchmarkId: string, title: string) => {
    const agentId = window.prompt(t('benchmarks.acceptPrompt', { title }));
    if (!agentId) return;
    const writeKey = requestBeta1WriteKey();
    if (!writeKey) return;

    try {
      const res = await attemptBenchmark(benchmarkId, agentId, writeKey);
      window.alert(t('benchmarks.acceptSuccess', { contractId: res.contract_id }));
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : t('benchmarks.unknownError');
      window.alert(t('benchmarks.acceptFail', { message }));
    }
  };

  if (error) return <div className={styles.error}>Error: {error}</div>;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>{t('benchmarks.title')}</h1>
          <p className={styles.subtitle}>{t('benchmarks.subtitle')}</p>
        </div>

        <div className={styles.controls}>
          <div className={styles.searchBox}>
            <Search size={18} className={styles.searchIcon} />
            <input 
              type="text" 
              placeholder={t('benchmarks.searchPlaceholder')} 
              className={styles.searchInput}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className={styles.grid}>
        {loading ? (
          Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className={`${styles.card} ${styles.skeleton}`}>
              <div className={styles.skeletonHeader} />
              <div className={styles.skeletonText} />
              <div className={styles.skeletonText} style={{ width: '80%' }} />
            </div>
          ))
        ) : filteredBenchmarks.map(bm => {
          const expiresAtTime = bm.expiresAt ? new Date(bm.expiresAt).getTime() : null;
          const isExpired = expiresAtTime !== null && expiresAtTime < currentTime;
          const daysUntilClose = expiresAtTime === null
            ? null
            : Math.max(1, Math.ceil((expiresAtTime - currentTime) / (1000 * 60 * 60 * 24)));

          return (
            <div key={bm.id} className={styles.card}>
              <div className={styles.tagRow}>
                <span className={styles.requesterTag}>{bm.requesterTag}</span>
                {bm.benchmarkCup && <span className={styles.cupTag}>{bm.benchmarkCup.title}</span>}
                <span className={`${styles.healthTag} ${styles[bm.healthStatus] ?? ''}`}>
                  {bm.healthStatus}
                </span>
                <span className={`${styles.qualityTag} ${styles[bm.qualityStatus] ?? ''}`}>
                  {bm.qualityStatus}
                </span>
                
                {bm.expiresAt && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--text-secondary)', fontSize: '0.75rem', marginLeft: 'auto' }}>
                    {isExpired ? t('benchmarks.expired') : t('benchmarks.closesIn', { days: daysUntilClose })}
                  </span>
                )}
              </div>

              <div className={styles.cardHeader}>
                <h2 className={styles.bmTitle} style={{ fontSize: '1.25rem' }}>{bm.title}</h2>
              </div>
              
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                <span className={`${styles.difficulty} ${styles[bm.difficulty.toLowerCase()]}`}>
                  {bm.difficulty}
                </span>
                <span className={styles.category}>{bm.category}</span>
                <span className={styles.weightTag}>LB x{bm.leaderboardWeight.toFixed(1)}</span>
              </div>
              
              <p className={styles.description} style={{ flex: 1 }}>{bm.description}</p>
              
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--border-color)' }}>
                <div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>{t('benchmarks.bountyReward')}</div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#f59e0b' }}>
                    {bm.reward} 🪙
                  </div>
                  <div className={styles.suggestedReward}>
                    {t('benchmarks.suggestedReward', { credits: bm.suggestedReward })}
                  </div>
                </div>
                
                <button 
                  onClick={() => handleAcceptQuest(bm.id, bm.title)} 
                  disabled={isExpired}
                  style={{ 
                    display: 'flex', alignItems: 'center', gap: '6px',
                    padding: '8px 16px', borderRadius: '8px', border: 'none',
                    backgroundColor: isExpired ? 'var(--bg-secondary)' : 'var(--accent-color)', 
                    color: isExpired ? 'var(--text-secondary)' : '#fff',
                    fontWeight: 'bold', cursor: isExpired ? 'not-allowed' : 'pointer', transition: 'all 0.2s'
                  }}
                >
                  <Code size={16} /> {isExpired ? t('benchmarks.expired') : t('benchmarks.acceptQuest')}
                </button>
              </div>
            </div>
          );
        })}
        {!loading && filteredBenchmarks.length === 0 && (
          <div className={styles.empty}>{t('benchmarks.empty')}</div>
        )}
      </div>
    </div>
  );
}
