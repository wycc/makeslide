import { useEffect, useState } from 'react';
import { getMonthlyCost, getSystemAiSettings } from '../lib/api';

export interface BudgetWarning {
  exceeded: boolean;
  costUsd: number;
  limitUsd: number;
}

export function useBudgetWarning(): BudgetWarning | null {
  const [warning, setWarning] = useState<BudgetWarning | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [settings, cost] = await Promise.all([getSystemAiSettings(), getMonthlyCost()]);
        if (cancelled) return;
        const limit = settings.monthly_budget_usd;
        if (typeof limit !== 'number' || limit <= 0) return;
        const costUsd = cost.total_cost_usd ?? 0;
        if (costUsd >= limit) {
          setWarning({ exceeded: true, costUsd, limitUsd: limit });
        }
      } catch {
        // Silently ignore — budget check is non-critical
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return warning;
}
