import { useEffect, useState, useRef } from 'react';
import { X, Play, Terminal, UserCircle, ExternalLink } from 'lucide-react';
import { fetchAgentDetails, fetchBenchmarks, attemptBenchmark, type AgentDetails, API_BASE_URL } from '../api';
import { getAgentBadges } from '../utils/badges';
import { requestBeta1WriteKey } from '../utils/writeKey';
import styles from '../pages/Agents.module.css';

interface AgentDetailsModalProps {
  agentId: string;
  onClose: () => void;
}

interface ExecutionListResponse {
  items?: { id: string }[];
}

interface ExecutionEvent {
  createdAt: string;
  message: string;
}

interface ExecutionEventsResponse {
  items?: ExecutionEvent[];
}

interface DeliveryListResponse {
  items?: { id: string }[];
}

const getErrorMessage = (error: unknown): string => {
  return error instanceof Error ? error.message : 'Unknown error';
};

export default function AgentDetailsModal({ agentId, onClose }: AgentDetailsModalProps) {
  const [agentDetails, setAgentDetails] = useState<AgentDetails | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'playground'>('overview');
  
  // Playground states
  const [isRunning, setIsRunning] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDetailsLoading(true);
    fetchAgentDetails(agentId)
      .then(setAgentDetails)
      .catch(console.error)
      .finally(() => setDetailsLoading(false));
  }, [agentId]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  const handleTestRun = async () => {
    if (isRunning || !agentDetails) return;
    const writeKey = requestBeta1WriteKey();
    if (!writeKey) return;

    setIsRunning(true);
    setActiveTab('playground');
    setLogs([`> Preparing benchmark attempt for ${agentDetails.name}...`]);

    try {
      setLogs(prev => [...prev, '> Fetching available benchmarks...']);
      const benchmarks = await fetchBenchmarks();
      const testBenchmark = benchmarks.find(b => b.status === 'active');
      
      if (!testBenchmark) {
        setLogs(prev => [...prev, '> Error: No active benchmarks available for testing.']);
        setIsRunning(false);
        return;
      }

      setLogs(prev => [...prev, `> Starting attempt on benchmark: "${testBenchmark.title}"`]);
      const attemptRes = await attemptBenchmark(testBenchmark.id, agentDetails.id!, writeKey);
      const contractId = attemptRes.contract_id;
      
      setLogs(prev => [...prev, `> Contract created: ${contractId}`]);
      setLogs(prev => [...prev, `> Waiting for this agent's worker to pick up the task...`]);
      setLogs(prev => [...prev, `> This creates a real benchmark contract; a worker for this agent must already be online.`]);

      let executionId: string | null = null;
      let lastEventCount = 0;
      let isCompleted = false;

      const pollInterval = setInterval(async () => {
        try {
          if (!executionId) {
            // Poll for execution
            const execRes = await fetch(`${API_BASE_URL}/v1/executions?contract_id=${contractId}`);
            const execData = await execRes.json() as ExecutionListResponse;
            if (execData.items && execData.items.length > 0) {
              executionId = execData.items[0].id;
              setLogs(prev => [...prev, `> Agent picked up task! Execution ID: ${executionId}`]);
            }
          }

          if (executionId) {
            // Poll for events
            const evRes = await fetch(`${API_BASE_URL}/v1/executions/${executionId}/events?limit=100`);
            const evData = await evRes.json() as ExecutionEventsResponse;
            if (evData.items && evData.items.length > lastEventCount) {
              const newEvents = evData.items.slice(lastEventCount);
              newEvents.forEach((ev) => {
                setLogs(prev => [...prev, `[${new Date(ev.createdAt).toISOString().split('T')[1].slice(0,-1)}] ${ev.message}`]);
              });
              lastEventCount = evData.items.length;
            }

            // Poll for delivery
            const delRes = await fetch(`${API_BASE_URL}/v1/deliveries?contract_id=${contractId}`);
            const delData = await delRes.json() as DeliveryListResponse;
            if (delData.items && delData.items.length > 0) {
              const delivery = delData.items[0];
              setLogs(prev => [...prev, `> Delivery submitted! ID: ${delivery.id}`]);
              setLogs(prev => [...prev, `> Task completed successfully.`]);
              isCompleted = true;
            }
          }

          if (isCompleted) {
            clearInterval(pollInterval);
            setIsRunning(false);
          }
        } catch (e) {
          console.error("Polling error:", e);
        }
      }, 2000);

      // Stop polling after 60 seconds to avoid infinite loop
      setTimeout(() => {
        if (!isCompleted) {
          clearInterval(pollInterval);
          setLogs(prev => [...prev, `> Timeout: Agent did not complete task within 60 seconds.`]);
          setIsRunning(false);
        }
      }, 60000);

    } catch (e: unknown) {
      setLogs(prev => [...prev, `> Error: ${getErrorMessage(e)}`]);
      setIsRunning(false);
    }
  };

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modal} style={{ maxWidth: '800px', width: '90vw', maxHeight: '90vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
        <button className={styles.closeBtn} onClick={onClose}>
          <X size={24} />
        </button>
        {detailsLoading ? (
          <div style={{ padding: '2rem', textAlign: 'center' }}>Loading agent details...</div>
        ) : agentDetails ? (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
              <div>
                <h2 className={styles.agentName} style={{ fontSize: '2rem', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '12px' }}>
                  {agentDetails.name}
                </h2>
                
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
                  <UserCircle size={16} />
                  <span>Operated by: </span>
                  <span style={{ fontWeight: 'bold', color: 'var(--text-primary)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                    {agentDetails.owner || 'Community Contributor'} <ExternalLink size={12} />
                  </span>
                </div>

                <div className={styles.categories}>
                  {agentDetails.categories.map(c => (
                    <span key={c} className={styles.category}>{c.trim()}</span>
                  ))}
                  {getAgentBadges(agentDetails.metrics?.detailedScores).map(b => (
                    <span key={b.text} style={{ fontSize: '0.75rem', padding: '2px 8px', borderRadius: '12px', backgroundColor: b.color + '20', color: b.color, fontWeight: 'bold' }}>
                      {b.text}
                    </span>
                  ))}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px' }}>
                <span className={styles.price} style={{ fontSize: '1.5rem' }}>{agentDetails.basePrice} 🪙</span>
                <button 
                  onClick={handleTestRun}
                  disabled={isRunning}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '6px',
                    padding: '8px 16px', borderRadius: '8px', border: 'none',
                    backgroundColor: isRunning ? 'var(--bg-secondary)' : 'var(--accent-color)',
                    color: isRunning ? 'var(--text-secondary)' : '#fff',
                    fontWeight: 'bold', cursor: isRunning ? 'not-allowed' : 'pointer',
                    transition: 'all 0.2s'
                  }}
                >
                  <Play size={16} />
                  {isRunning ? 'Starting...' : 'Start Attempt'}
                </button>
              </div>
            </div>

            <div style={{ borderBottom: '1px solid var(--border-color)', marginBottom: '1.5rem', display: 'flex', gap: '1rem' }}>
              <button 
                onClick={() => setActiveTab('overview')}
                style={{ background: 'none', border: 'none', padding: '0.5rem 1rem', fontSize: '1rem', fontWeight: 'bold', cursor: 'pointer', borderBottom: activeTab === 'overview' ? '2px solid var(--accent-color)' : '2px solid transparent', color: activeTab === 'overview' ? 'var(--text-primary)' : 'var(--text-secondary)' }}
              >
                Overview
              </button>
              <button 
                onClick={() => setActiveTab('playground')}
                style={{ background: 'none', border: 'none', padding: '0.5rem 1rem', fontSize: '1rem', fontWeight: 'bold', cursor: 'pointer', borderBottom: activeTab === 'playground' ? '2px solid var(--accent-color)' : '2px solid transparent', color: activeTab === 'playground' ? 'var(--text-primary)' : 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                <Terminal size={16} /> Playground
              </button>
            </div>

            {activeTab === 'overview' ? (
              <>
                <p className={styles.description} style={{ marginBottom: '2rem', fontSize: '1rem', lineHeight: '1.6' }}>
                  {agentDetails.description || 'No description provided.'}
                </p>

                {agentDetails.metrics && agentDetails.metrics.evaluationsCount > 0 && (
                  <div style={{ backgroundColor: 'var(--bg-secondary)', padding: '1.5rem', border: '1px solid var(--border-color)', borderRadius: '8px', marginBottom: '2rem' }}>
                    <h3 style={{ margin: '0 0 1rem 0', color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: '0.875rem' }}>Performance Metrics</h3>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '1rem' }}>
                      <div>
                        <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Average Score</div>
                        <div style={{ fontSize: '1.5rem', fontWeight: '800', color: 'var(--accent-color)' }}>
                          {agentDetails.metrics.averageScore}
                        </div>
                      </div>
                      <div>
                        <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Tasks Completed</div>
                        <div style={{ fontSize: '1.5rem', fontWeight: '800', color: 'var(--text-primary)' }}>
                          {agentDetails.metrics.evaluationsCount}
                        </div>
                      </div>
                      <div>
                        <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Quality</div>
                        <div style={{ fontSize: '1.125rem', fontWeight: '600' }}>{agentDetails.metrics.detailedScores.quality}</div>
                      </div>
                      <div>
                        <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Reliability</div>
                        <div style={{ fontSize: '1.125rem', fontWeight: '600' }}>{agentDetails.metrics.detailedScores.reliability}</div>
                      </div>
                      <div>
                        <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Efficiency</div>
                        <div style={{ fontSize: '1.125rem', fontWeight: '600' }}>{agentDetails.metrics.detailedScores.speed}</div>
                      </div>
                      <div>
                        <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Autonomy</div>
                        <div style={{ fontSize: '1.125rem', fontWeight: '600' }}>{agentDetails.metrics.detailedScores.cost}</div>
                      </div>
                      <div>
                        <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Transparency</div>
                        <div style={{ fontSize: '1.125rem', fontWeight: '600' }}>{agentDetails.metrics.detailedScores.evidence}</div>
                      </div>
                    </div>
                  </div>
                )}

                <h3 style={{ margin: '0 0 1rem 0', color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: '0.875rem' }}>Recent Deliveries</h3>
                {agentDetails.recentDeliveries && agentDetails.recentDeliveries.length > 0 ? (
                  <div style={{ border: '1px solid var(--border-heavy)', borderRadius: '8px', overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                      <thead style={{ backgroundColor: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-heavy)' }}>
                        <tr>
                          <th style={{ padding: '0.75rem 1rem', color: 'var(--text-secondary)', fontSize: '0.75rem', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Task</th>
                          <th style={{ padding: '0.75rem 1rem', color: 'var(--text-secondary)', fontSize: '0.75rem', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Date</th>
                          <th style={{ padding: '0.75rem 1rem', color: 'var(--text-secondary)', fontSize: '0.75rem', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Score</th>
                        </tr>
                      </thead>
                      <tbody>
                        {agentDetails.recentDeliveries.map((delivery, i) => (
                          <tr key={i} style={{ borderBottom: i < agentDetails.recentDeliveries!.length - 1 ? '1px solid var(--border-color)' : 'none' }}>
                            <td style={{ padding: '0.75rem 1rem', fontSize: '0.875rem', color: 'var(--text-primary)' }}>{delivery.taskName}</td>
                            <td style={{ padding: '0.75rem 1rem', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                              {new Date(delivery.date).toLocaleDateString()}
                            </td>
                            <td style={{ padding: '0.75rem 1rem', fontSize: '0.875rem', fontWeight: '600', color: delivery.score && delivery.score > 0.9 ? 'var(--accent-color)' : 'var(--text-secondary)' }}>
                              {delivery.score ? delivery.score.toFixed(2) : '-'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p style={{ color: 'var(--text-secondary)' }}>No recent deliveries found.</p>
                )}
              </>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', height: '400px' }}>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '1rem' }}>
                  Start a real benchmark attempt and watch for execution events from this agent's worker.
                </p>
                <div 
                  ref={scrollRef}
                  style={{ 
                    flex: 1, 
                    backgroundColor: '#1e1e1e', 
                    color: '#00ff00', 
                    padding: '1rem', 
                    fontFamily: 'monospace', 
                    borderRadius: '8px', 
                    overflowY: 'auto',
                    boxShadow: 'inset 0 0 10px rgba(0,0,0,0.5)'
                  }}
                >
                  {logs.length === 0 ? (
                    <div style={{ color: '#888', fontStyle: 'italic' }}>Waiting for execution... Click "Start Attempt" to begin.</div>
                  ) : (
                    logs.map((log, i) => (
                      <div key={i} style={{ marginBottom: '4px', whiteSpace: 'pre-wrap' }}>{log}</div>
                    ))
                  )}
                  {isRunning && (
                    <div style={{ animation: 'blink 1s step-end infinite', marginTop: '4px' }}>_</div>
                  )}
                </div>
                <style>
                  {`@keyframes blink { 50% { opacity: 0; } }`}
                </style>
              </div>
            )}
          </div>
        ) : (
          <div style={{ padding: '2rem', textAlign: 'center', color: '#ef4444' }}>Failed to load agent details.</div>
        )}
      </div>
    </div>
  );
}
