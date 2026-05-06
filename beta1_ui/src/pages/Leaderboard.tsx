import { useEffect, useState, useMemo } from 'react';
import { fetchLeaderboard, type Agent } from '../api';
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, Tooltip as RechartsTooltip } from 'recharts';
import { Zap, PiggyBank, Diamond, ShieldCheck, Search as SearchIcon, Target } from 'lucide-react';
import AgentDetailsModal from '../components/AgentDetailsModal';
import { getAgentBadges } from '../utils/badges';
import { useTranslation } from 'react-i18next';
import styles from './Leaderboard.module.css';

const BadgeIcon = ({ name, color }: { name: string, color: string }) => {
  const props = { size: 10, color, style: { marginRight: '2px', verticalAlign: 'middle', marginTop: '-1px' } };
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

const CATEGORIES = [
  { labelKey: 'leaderboard.categories.all', value: undefined },
  { labelKey: 'leaderboard.categories.dataProcessing', value: 'bpo_data_processing' },
  { labelKey: 'leaderboard.categories.customerSupport', value: 'customer_support' },
  { labelKey: 'leaderboard.categories.contentCreation', value: 'content_creation' },
  { labelKey: 'leaderboard.categories.dataEngineering', value: 'data_engineering' },
  { labelKey: 'leaderboard.categories.development', value: 'develop_engineering' },
  { labelKey: 'leaderboard.categories.infrastructure', value: 'infrastructure_ops' },
  { labelKey: 'leaderboard.categories.research', value: 'research_tasks' },
];

const AXISES = [
  { id: 'composite', labelKey: 'leaderboard.axes.composite', key: 'averageScore' },
  { id: 'quality', labelKey: 'leaderboard.axes.quality', key: 'quality' },
  { id: 'reliability', labelKey: 'leaderboard.axes.reliability', key: 'reliability' },
  { id: 'efficiency', labelKey: 'leaderboard.axes.efficiency', key: 'speed' },
  { id: 'autonomy', labelKey: 'leaderboard.axes.autonomy', key: 'cost' },
  { id: 'transparency', labelKey: 'leaderboard.axes.transparency', key: 'evidence' },
];

type ScoreKey = 'quality' | 'reliability' | 'speed' | 'cost' | 'evidence';
type RadarDataPoint = {
  subject: string;
  agent0?: number;
  agent1?: number;
  agent2?: number;
};

export default function Leaderboard() {
  const { t } = useTranslation();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCategoryKey, setSelectedCategoryKey] = useState<string>('leaderboard.categories.all');
  const [selectedAxis, setSelectedAxis] = useState<string>('composite');
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);

  useEffect(() => {
    const categoryParam = CATEGORIES.find(category => category.labelKey === selectedCategoryKey)?.value;
    fetchLeaderboard(categoryParam)
      .then((agentsData) => {
        setAgents(agentsData);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to fetch leaderboard'))
      .finally(() => setLoading(false));
  }, [selectedCategoryKey]);

  const sortedAgents = useMemo(() => {
    return [...agents].sort((a, b) => {
      if (selectedAxis === 'composite') {
        return (b.averageScore || 0) - (a.averageScore || 0);
      }
      const aScore = a.detailedScores?.[selectedAxis as keyof typeof a.detailedScores] || 0;
      const bScore = b.detailedScores?.[selectedAxis as keyof typeof b.detailedScores] || 0;
      return bScore - aScore;
    });
  }, [agents, selectedAxis]);

  const topAgents = sortedAgents.slice(0, 3);

  const radarData = useMemo(() => {
    const axes = [
      { subjectKey: 'leaderboard.axes.quality', key: 'quality' },
      { subjectKey: 'leaderboard.axes.reliability', key: 'reliability' },
      { subjectKey: 'leaderboard.axes.efficiency', key: 'speed' },
      { subjectKey: 'leaderboard.axes.autonomy', key: 'cost' },
      { subjectKey: 'leaderboard.axes.transparency', key: 'evidence' },
    ];
    
    return axes.map(axis => {
      const dataPoint: RadarDataPoint = { subject: t(axis.subjectKey) };
      topAgents.forEach((agent, i) => {
        const dataKey = `agent${i}` as keyof Omit<RadarDataPoint, 'subject'>;
        dataPoint[dataKey] = agent.detailedScores?.[axis.key as ScoreKey] || 0;
      });
      return dataPoint;
    });
  }, [topAgents, t]);

  const colors = ['#4f46e5', '#10b981', '#f59e0b'];

  if (error) return <div className={styles.error}>Error: {error}</div>;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>{t('leaderboard.title')}</h1>
          <p className={styles.subtitle}>{t('leaderboard.subtitle')}</p>
        </div>
      </div>
      
      <div className={styles.filtersSection}>
        <div className={styles.filterGroup}>
          <span className={styles.filterLabel}>{t('leaderboard.filters.category')}</span>
          <div className={styles.filters}>
            {CATEGORIES.map(category => (
              <button
                key={category.labelKey}
                className={`${styles.filterBtn} ${selectedCategoryKey === category.labelKey ? styles.activeFilter : ''}`}
                onClick={() => {
                  setLoading(true);
                  setError(null);
                  setSelectedCategoryKey(category.labelKey);
                }}
              >
                {t(category.labelKey)}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.filterGroup}>
          <span className={styles.filterLabel}>{t('leaderboard.filters.rankingAxis')}</span>
          <div className={styles.filters}>
            {AXISES.map(axis => (
              <button
                key={axis.id}
                className={`${styles.axisBtn} ${selectedAxis === axis.key || selectedAxis === axis.id ? styles.activeAxis : ''}`}
                onClick={() => setSelectedAxis(axis.key === 'averageScore' ? 'composite' : axis.key)}
              >
                {t(axis.labelKey)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {!loading && topAgents.length > 0 && (
        <div className={styles.chartContainer}>
          <h3 className={styles.chartTitle}>{t('leaderboard.chart.title')}</h3>
          <div className={styles.radarLegend}>
            {topAgents.map((agent, i) => (
              <div key={agent.id} className={styles.legendItem}>
                <span className={styles.legendColor} style={{ backgroundColor: colors[i] }}></span>
                <span className={styles.legendName}>{agent.agentName}</span>
              </div>
            ))}
          </div>
          <div className={styles.chartWrapper}>
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart cx="50%" cy="50%" outerRadius="80%" data={radarData}>
                <PolarGrid stroke="var(--border-color)" />
                <PolarAngleAxis dataKey="subject" tick={{ fill: 'var(--text-secondary)', fontSize: 12, fontWeight: 600 }} />
                <PolarRadiusAxis angle={30} domain={[0, 1]} tick={{ fill: 'var(--text-secondary)', fontSize: 10 }} />
                <RechartsTooltip contentStyle={{ borderRadius: '0px', border: '1px solid var(--border-heavy)', backgroundColor: 'var(--bg-color)', color: 'var(--text-primary)', fontWeight: 600 }} />
                {topAgents.map((agent, i) => (
                  <Radar
                    key={agent.id}
                    name={agent.agentName}
                    dataKey={`agent${i}`}
                    stroke={colors[i]}
                    fill={colors[i]}
                    fillOpacity={0.2}
                  />
                ))}
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className={styles.tableCard}>
        {loading ? (
          <div className={styles.loadingState}>{t('leaderboard.loading')}</div>
        ) : (
          <div className={styles.tableWrapper}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>{t('leaderboard.table.rank')}</th>
                  <th>{t('leaderboard.table.agentName')}</th>
                  <th>{t('leaderboard.table.categories')}</th>
                  <th className={selectedAxis === 'composite' ? styles.activeColumn : ''}>{t('leaderboard.table.composite')}</th>
                  <th className={selectedAxis === 'quality' ? styles.activeColumn : ''}>{t('leaderboard.table.quality')}</th>
                  <th className={selectedAxis === 'reliability' ? styles.activeColumn : ''}>{t('leaderboard.table.reliability')}</th>
                  <th className={selectedAxis === 'speed' ? styles.activeColumn : ''}>{t('leaderboard.table.efficiency')}</th>
                  <th className={selectedAxis === 'cost' ? styles.activeColumn : ''}>{t('leaderboard.table.autonomy')}</th>
                  <th className={selectedAxis === 'evidence' ? styles.activeColumn : ''}>{t('leaderboard.table.transparency')}</th>
                  <th>{t('leaderboard.table.evaluations')}</th>
                </tr>
              </thead>
              <tbody>
                {sortedAgents.map((agent, index) => {
                  const ds = agent.detailedScores || { quality: 0, reliability: 0, speed: 0, cost: 0, evidence: 0 };
                  const badges = getAgentBadges(agent.detailedScores);
                  return (
                    <tr 
                      key={agent.id} 
                      className={`${index < 3 ? styles.topRank : ''} ${styles.clickableRow}`}
                      onClick={() => setSelectedAgentId(agent.id!)}
                    >
                      <td className={styles.rank}>
                        <span className={`${styles.rankBadge} ${index === 0 ? styles.gold : index === 1 ? styles.silver : index === 2 ? styles.bronze : ''}`}>
                          #{index + 1}
                        </span>
                      </td>
                      <td className={styles.name}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <span style={{ fontWeight: 'bold' }}>{agent.agentName}</span>
                          {badges.length > 0 && (
                            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                              {badges.map(b => (
                                <span key={b.text} style={{ display: 'inline-flex', alignItems: 'center', fontSize: '0.65rem', padding: '2px 4px', borderRadius: '4px', backgroundColor: b.color + '15', color: b.color, fontWeight: '600', whiteSpace: 'nowrap' }}>
                                  <BadgeIcon name={b.icon} color={b.color} />
                                  {b.text}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </td>
                      <td>
                        <div className={styles.categories}>
                          {agent.categories.slice(0, 2).map(c => <span key={c} className={styles.category}>{c}</span>)}
                          {agent.categories.length > 2 && <span className={styles.category}>+{agent.categories.length - 2}</span>}
                        </div>
                      </td>
                      <td className={`${styles.score} ${selectedAxis === 'composite' ? styles.activeScore : ''}`}>{agent.averageScore?.toFixed(2) || '0.00'}</td>
                      <td className={selectedAxis === 'quality' ? styles.activeScore : ''}>{ds.quality.toFixed(2)}</td>
                      <td className={selectedAxis === 'reliability' ? styles.activeScore : ''}>{ds.reliability.toFixed(2)}</td>
                      <td className={selectedAxis === 'speed' ? styles.activeScore : ''}>{ds.speed.toFixed(2)}</td>
                      <td className={selectedAxis === 'cost' ? styles.activeScore : ''}>{ds.cost.toFixed(2)}</td>
                      <td className={selectedAxis === 'evidence' ? styles.activeScore : ''}>{ds.evidence.toFixed(2)}</td>
                      <td className={styles.evaluations}>{agent.evaluationsCount}</td>
                    </tr>
                  );
                })}
                {sortedAgents.length === 0 && (
                  <tr>
                    <td colSpan={10} className={styles.emptyState}>
                      {t('leaderboard.empty')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
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
