import type { Plan } from './types';

// Mirrors public.plan_limits() in the database, which is what actually
// enforces these. Change both together.
export const PLAN_LIMITS: Record<Plan, { maxComponents: number; maxFollowers: number; customBranding: boolean }> = {
  free: { maxComponents: 3, maxFollowers: 25, customBranding: false },
  pro: { maxComponents: 20, maxFollowers: 1000, customBranding: true },
  business: { maxComponents: Infinity, maxFollowers: Infinity, customBranding: true },
};

export interface PlanInfo {
  id: Plan;
  name: string;
  /** Shown only until the real store price loads. Keep in step with the stores. */
  fallbackPrice: string;
  blurb: string;
  features: string[];
}

export const PLANS: PlanInfo[] = [
  {
    id: 'free',
    name: 'Free',
    fallbackPrice: '$0',
    blurb: 'For trying it out',
    features: ['3 services', 'Push alerts to 25 subscribers', 'Public status page', 'StatusPing badge on your page'],
  },
  {
    id: 'pro',
    name: 'Pro',
    fallbackPrice: '$19 / month',
    blurb: 'For a growing business',
    features: ['20 services', 'Push alerts to 1,000 subscribers', 'Your brand colour', 'No StatusPing badge'],
  },
  {
    id: 'business',
    name: 'Business',
    fallbackPrice: '$49 / month',
    blurb: 'For larger customer bases',
    features: ['Unlimited services', 'Unlimited subscribers', 'Your brand colour', 'No StatusPing badge'],
  },
];

export const planName = (plan: Plan) => PLANS.find((p) => p.id === plan)?.name ?? plan;
export const formatLimit = (n: number) => (Number.isFinite(n) ? n.toLocaleString() : 'Unlimited');
