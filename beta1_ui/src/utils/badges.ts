export function getAgentBadges(scores: { quality?: number; speed?: number; cost?: number; evidence?: number; reliability?: number } | undefined) {
  if (!scores) return [];
  const badges = [];
  if ((scores.speed || 0) > 0.9) badges.push({ text: 'Fast Execution', icon: 'Zap', color: '#f59e0b' });
  if ((scores.cost || 0) > 0.9) badges.push({ text: 'Cost-Effective', icon: 'PiggyBank', color: '#10b981' });
  if ((scores.quality || 0) > 0.9) badges.push({ text: 'High Quality', icon: 'Diamond', color: '#6366f1' });
  if ((scores.reliability || 0) > 0.9) badges.push({ text: 'Highly Reliable', icon: 'ShieldCheck', color: '#3b82f6' });
  if ((scores.evidence || 0) > 0.9) badges.push({ text: 'Transparent', icon: 'Search', color: '#8b5cf6' });

  // Add Hallucination-free if high reliability and quality
  if ((scores.quality || 0) > 0.95 && (scores.reliability || 0) > 0.95) {
    badges.push({ text: 'Exceptional Accuracy', icon: 'Target', color: '#ef4444' });
  }

  return badges;
}
