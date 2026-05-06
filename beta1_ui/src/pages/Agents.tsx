import { useEffect, useState, useMemo } from 'react';
import { Search, ArrowUpDown, Zap, PiggyBank, Diamond, ShieldCheck, Search as SearchIcon, Target } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { fetchAgents, type Agent } from '../api';
import AgentDetailsModal from '../components/AgentDetailsModal';
import { getAgentBadges } from '../utils/badges';
import styles from './Agents.module.css';

const BadgeIcon = ({ name, color }: { name: string, color: string }) => {
  const props = { size: 12, color, style: { marginRight: '4px', verticalAlign: 'middle', marginTop: '-2px' } };
  switch(name) {
    case 'Zap': return <Zap {...props} />;
    case 'PiggyBank': return <PiggyBank {...props} />;
    case 'Diamond': return <Diamond {...props} />;
    case 'ShieldCheck': return <ShieldCheck {...props} />;
    case 'Search': return <SearchIcon {...props} />;
    case 'Target': return <Target {...props} />;
    default: return null;
  }
};

export default function Agents() {
  const { t } = useTranslation();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'price'>('name');

  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);

  useEffect(() => {
    fetchAgents()
      .then(setAgents)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const filteredAndSortedAgents = useMemo(() => {
    const result = agents.filter(a => {
      const query = searchQuery.toLowerCase();
      return (
        (a.name || a.agentName || '').toLowerCase().includes(query) ||
        (a.description || '').toLowerCase().includes(query) ||
        a.categories.some(c => c.toLowerCase().includes(query))
      );
    });

    result.sort((a, b) => {
      if (sortBy === 'name') {
        const nameA = a.name || a.agentName || '';
        const nameB = b.name || b.agentName || '';
        return nameA.localeCompare(nameB);
      } else {
        return (a.basePrice || 0) - (b.basePrice || 0);
      }
    });

    return result;
  }, [agents, searchQuery, sortBy]);

  if (error) return <div className={styles.error}>Error: {error}</div>;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>{t('agents.title')}</h1>
          <p className={styles.subtitle}>{t('agents.subtitle')}</p>
        </div>
        
        <div className={styles.controls}>
          <div className={styles.searchBox}>
            <Search size={18} className={styles.searchIcon} />
            <input 
              type="text" 
              placeholder={t('agents.searchPlaceholder')} 
              className={styles.searchInput}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <button 
            className={styles.sortBtn}
            onClick={() => setSortBy(prev => prev === 'name' ? 'price' : 'name')}
          >
            <ArrowUpDown size={16} />
            {t('agents.sortBy', { type: sortBy === 'name' ? t('agents.sortName') : t('agents.sortPrice') })}
          </button>
        </div>
      </div>

      <div className={styles.grid}>
        {loading ? (
          Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className={`${styles.card} ${styles.skeleton}`}>
              <div className={styles.skeletonHeader} />
              <div className={styles.skeletonText} />
              <div className={styles.skeletonText} style={{ width: '80%' }} />
              <div className={styles.skeletonTags} />
            </div>
          ))
        ) : filteredAndSortedAgents.map(agent => {
          const badges = getAgentBadges(agent.metrics?.detailedScores);
          return (
          <div 
            key={agent.id} 
            className={styles.card}
            style={{ cursor: 'pointer' }}
            onClick={() => setSelectedAgentId(agent.id!)}
          >
            <div className={styles.cardHeader}>
              <h2 className={styles.agentName}>{agent.name || agent.agentName}</h2>
              <span className={styles.price}>{agent.basePrice} 🪙</span>
            </div>

            {badges.length > 0 && (
              <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: '12px' }}>
                {badges.map(b => (
                  <span key={b.text} style={{ display: 'inline-flex', alignItems: 'center', fontSize: '0.7rem', padding: '2px 6px', borderRadius: '12px', backgroundColor: b.color + '15', color: b.color, fontWeight: '600' }}>
                    <BadgeIcon name={b.icon} color={b.color} />
                    {b.text}
                  </span>
                ))}
              </div>
            )}
            
            <p className={styles.description}>
              {agent.description || t('agents.noDescription')}
            </p>
            
            <div className={styles.categories}>
              {agent.categories.map(c => (
                <span key={c} className={styles.category}>{c.trim()}</span>
              ))}
            </div>
            
            <div className={styles.footer}>
              <span className={styles.id}>ID: {agent.id?.substring(0, 8)}...</span>
            </div>
          </div>
        )})}
        {!loading && filteredAndSortedAgents.length === 0 && (
          <div className={styles.empty}>{t('agents.empty')}</div>
        )}
      </div>

      {selectedAgentId && (
        <AgentDetailsModal 
          agentId={selectedAgentId} 
          onClose={() => setSelectedAgentId(null)} 
        />
      )}
    </div>
  );
}
