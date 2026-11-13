import type { ComponentStatus, Impact, IncidentStatus } from './types';

export const COMPONENT_STATUSES: ComponentStatus[] = [
  'operational',
  'degraded',
  'partial_outage',
  'major_outage',
  'maintenance',
];
export const INCIDENT_STATUSES: IncidentStatus[] = ['investigating', 'identified', 'monitoring', 'resolved'];
export const IMPACTS: Impact[] = ['minor', 'major', 'critical', 'maintenance'];

export const COMPONENT_LABEL: Record<ComponentStatus, string> = {
  operational: 'Operational',
  degraded: 'Degraded',
  partial_outage: 'Partial outage',
  major_outage: 'Major outage',
  maintenance: 'Maintenance',
};

export const INCIDENT_LABEL: Record<IncidentStatus, string> = {
  investigating: 'Investigating',
  identified: 'Identified',
  monitoring: 'Monitoring',
  resolved: 'Resolved',
};

export const IMPACT_LABEL: Record<Impact, string> = {
  minor: 'Minor',
  major: 'Major',
  critical: 'Critical',
  maintenance: 'Maintenance',
};

/** What an incident of a given impact does to the services it affects. */
export const IMPACT_TO_COMPONENT: Record<Impact, ComponentStatus> = {
  minor: 'degraded',
  major: 'partial_outage',
  critical: 'major_outage',
  maintenance: 'maintenance',
};

const SEVERITY: ComponentStatus[] = ['operational', 'maintenance', 'degraded', 'partial_outage', 'major_outage'];

/** The worst status across a page's services. */
export function overallStatus(statuses: ComponentStatus[]): ComponentStatus {
  return statuses.reduce<ComponentStatus>(
    (worst, s) => (SEVERITY.indexOf(s) > SEVERITY.indexOf(worst) ? s : worst),
    'operational',
  );
}

export const OVERALL_HEADLINE: Record<ComponentStatus, string> = {
  operational: 'All systems operational',
  degraded: 'Degraded performance',
  partial_outage: 'Partial outage',
  major_outage: 'Major outage',
  maintenance: 'Maintenance in progress',
};

export function timeAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.round(h / 24);
  if (d < 14) return `${d} day${d === 1 ? '' : 's'} ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function dateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Turns a business name into a page code: "Acme Co." -> "acme-co". */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
}

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
