const STORAGE_KEY = 'kojumi_beta1_write_key';

export const saveBeta1WriteKey = (key: string) => {
  const trimmedKey = key.trim();
  if (!trimmedKey) return;
  try {
    window.localStorage?.setItem(STORAGE_KEY, trimmedKey);
  } catch {
    // The key can still be used from the alert/manual copy path.
  }
};

export const getSavedBeta1WriteKey = (): string | null => {
  try {
    const saved = window.localStorage?.getItem(STORAGE_KEY)?.trim();
    return saved || null;
  } catch {
    return null;
  }
};

export const requestBeta1WriteKey = (): string | null => {
  const savedKey = getSavedBeta1WriteKey();
  const key = window.prompt('Please enter your Beta1 write key or trial key:', savedKey || '');
  const trimmedKey = key?.trim();
  if (trimmedKey) {
    saveBeta1WriteKey(trimmedKey);
  }
  return trimmedKey || null;
};
