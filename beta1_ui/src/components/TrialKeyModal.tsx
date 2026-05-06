import { useState, useEffect, useRef } from 'react';
import { X, Copy, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { issueTrialKey, createAgent, TURNSTILE_SITE_KEY } from '../api';
import { saveBeta1WriteKey } from '../utils/writeKey';
import styles from './Layout.module.css';

interface TrialKeyModalProps {
  isOpen: boolean;
  onClose: () => void;
}

declare global {
  interface Window {
    turnstile?: {
      render: (
        element: HTMLElement,
        options: {
          sitekey: string;
          callback: (token: string) => void;
          'expired-callback': () => void;
          'error-callback': () => void;
        },
      ) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId: string) => void;
    };
  }
}

export default function TrialKeyModal({ isOpen, onClose }: TrialKeyModalProps) {
  const { t } = useTranslation();
  const [step, setStep] = useState<'instructions' | 'result'>('instructions');
  const [agentName, setAgentName] = useState('');
  const [issuingTrial, setIssuingTrial] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultData, setResultData] = useState<{ apiKey: string; expiresAt: string; agentId: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState('');
  const turnstileRef = useRef<HTMLDivElement | null>(null);
  const turnstileWidgetId = useRef<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setStep('instructions');
      setAgentName(`trial-agent-${crypto.randomUUID().slice(0, 8)}`);
      setError(null);
      setResultData(null);
      setCopied(false);
      setTurnstileToken('');
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !TURNSTILE_SITE_KEY || !turnstileRef.current) return;

    let cancelled = false;
    const scriptId = 'cloudflare-turnstile-script';
    const renderWidget = () => {
      if (cancelled || !turnstileRef.current || !window.turnstile || turnstileWidgetId.current) return;
      turnstileWidgetId.current = window.turnstile.render(turnstileRef.current, {
        sitekey: TURNSTILE_SITE_KEY,
        callback: setTurnstileToken,
        'expired-callback': () => setTurnstileToken(''),
        'error-callback': () => {
          setTurnstileToken('');
          setError('Turnstile verification failed. Please try again.');
        },
      });
    };

    const existingScript = document.getElementById(scriptId) as HTMLScriptElement | null;
    if (existingScript) {
      renderWidget();
    } else {
      const script = document.createElement('script');
      script.id = scriptId;
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.defer = true;
      script.onload = renderWidget;
      document.head.appendChild(script);
    }

    return () => {
      cancelled = true;
      if (turnstileWidgetId.current && window.turnstile) {
        window.turnstile.remove(turnstileWidgetId.current);
        turnstileWidgetId.current = null;
      }
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleIssueTrialKey = async () => {
    if (!agentName.trim() || issuingTrial) return;

    setIssuingTrial(true);
    setError(null);
    try {
      const trial = await issueTrialKey(agentName.trim(), 3, turnstileToken || undefined);
      saveBeta1WriteKey(trial.apiKey);
      const agent = await createAgent(trial.apiKey, {
        name: agentName.trim(),
        description: 'Trial sandbox agent',
        categories: ['trial'],
        base_price: 0,
        owner: 'Trial participant',
      });

      setResultData({
        apiKey: trial.apiKey,
        expiresAt: trial.expiresAt,
        agentId: agent.id || '',
      });
      setStep('result');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      if (TURNSTILE_SITE_KEY && window.turnstile) {
        window.turnstile.reset(turnstileWidgetId.current || undefined);
        setTurnstileToken('');
      }
    } finally {
      setIssuingTrial(false);
    }
  };

  const handleCopy = () => {
    if (resultData) {
      const textToCopy = `API key: ${resultData.apiKey}\nExpires: ${new Date(resultData.expiresAt).toLocaleString()}\nAgent ID: ${resultData.agentId}`;
      navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <button className={styles.closeBtn} onClick={onClose} aria-label="Close modal">
          <X size={20} />
        </button>

        {step === 'instructions' && (
          <>
            <h2 className={styles.modalTitle}>{t('nav.dummyKey', 'Get Trial Key')}</h2>
            
            <p className={styles.modalText}>
              {t('trial.instructions', 'This will issue a temporary Trial API key and create a sandbox agent valid for 3 days.\n\nNote: Trial keys are meant for evaluation purposes only and have rate limits.\n\nDo you want to proceed?')}
            </p>

            <div style={{ marginBottom: '0.5rem', fontWeight: 600, color: 'var(--text-primary)' }}>
              {t('trial.promptName', 'Trial agent name:')}
            </div>
            <input
              type="text"
              className={styles.modalInput}
              value={agentName}
              onChange={(e) => setAgentName(e.target.value)}
              disabled={issuingTrial}
              autoFocus
            />

            {TURNSTILE_SITE_KEY && (
              <div style={{ marginBottom: '1rem' }}>
                <div ref={turnstileRef} />
              </div>
            )}

            {error && (
              <div style={{ color: '#ef4444', marginBottom: '1rem', fontSize: '0.875rem' }}>
                Error: {error}
              </div>
            )}

            <div className={styles.modalFooter}>
              <button className={styles.cancelButton} onClick={onClose} disabled={issuingTrial}>
                Cancel
              </button>
              <button 
                className={styles.confirmButton} 
                onClick={handleIssueTrialKey} 
                disabled={issuingTrial || !agentName.trim() || Boolean(TURNSTILE_SITE_KEY && !turnstileToken)}
              >
                {issuingTrial ? 'Issuing...' : 'Proceed'}
              </button>
            </div>
          </>
        )}

        {step === 'result' && resultData && (
          <>
            <h2 className={styles.modalTitle}>Trial Access Ready</h2>
            
            <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>
              Your trial key has been issued and saved in this browser for benchmark attempts.
            </p>

            <div className={styles.copyArea}>
              <button 
                onClick={handleCopy}
                style={{ position: 'absolute', top: '0.5rem', right: '0.5rem', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}
                title="Copy to clipboard"
              >
                {copied ? <Check size={18} color="var(--accent-color)" /> : <Copy size={18} />}
              </button>
              <div style={{ paddingRight: '2rem' }}>
                <div style={{ marginBottom: '0.5rem' }}><strong>API key:</strong><br/>{resultData.apiKey}</div>
                <div style={{ marginBottom: '0.5rem' }}><strong>Expires:</strong><br/>{new Date(resultData.expiresAt).toLocaleString()}</div>
                <div><strong>Agent ID:</strong><br/>{resultData.agentId}</div>
              </div>
            </div>

            <div className={styles.modalFooter} style={{ marginTop: '2rem' }}>
              <button className={styles.confirmButton} onClick={onClose}>
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
