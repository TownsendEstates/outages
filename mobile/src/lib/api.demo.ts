// In-memory backend used when no Supabase project is configured. It lets the
// whole app be explored (and reviewed) without a server. Nothing is saved.
import { PLAN_LIMITS } from './plans';
import type { Api, Component, Incident, Org, User } from './types';

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
let seq = 0;
const id = (p: string) => `${p}-${++seq}`;

const DEFAULT_COLOR = '#2563EB';
const demoUser: User = { id: 'demo-user', email: 'owner@northwind.example' };

let user: User | null = null;
const listeners = new Set<(u: User | null) => void>();
const setUser = (u: User | null) => {
  user = u;
  listeners.forEach((l) => l(u));
};

let org: Org | null = {
  id: 'org-northwind',
  name: 'Northwind Internet',
  slug: 'northwind',
  brand_color: DEFAULT_COLOR,
  plan: 'free',
  support_email: 'support@northwind.example',
  support_phone: '780-555-0142',
  support_url: null,
};

let components: (Component & { position: number })[] = [
  { id: 'c-fibre', name: 'Fibre internet', status: 'partial_outage', position: 0 },
  { id: 'c-email', name: 'Email hosting', status: 'operational', position: 1 },
  { id: 'c-portal', name: 'Customer portal', status: 'operational', position: 2 },
];

let incidents: Incident[] = [
  {
    id: 'i-fibre',
    title: 'Fibre outage in the west end',
    impact: 'major',
    status: 'identified',
    component_ids: ['c-fibre'],
    started_at: ago(48),
    resolved_at: null,
    updates: [
      {
        id: 'u-2',
        status: 'identified',
        body: 'A construction crew cut a fibre line near 170 Street. Our splicing team is on site. Estimated repair is 2 hours.',
        created_at: ago(21),
      },
      {
        id: 'u-1',
        status: 'investigating',
        body: 'We are seeing connections drop for customers west of 149 Street and are investigating.',
        created_at: ago(48),
      },
    ],
  },
  {
    id: 'i-email',
    title: 'Delayed email delivery',
    impact: 'minor',
    status: 'resolved',
    component_ids: ['c-email'],
    started_at: ago(60 * 24 * 6),
    resolved_at: ago(60 * 24 * 6 - 95),
    updates: [
      {
        id: 'u-4',
        status: 'resolved',
        body: 'The mail queue has cleared and delivery times are back to normal.',
        created_at: ago(60 * 24 * 6 - 95),
      },
      {
        id: 'u-3',
        status: 'investigating',
        body: 'Outbound email is taking up to 30 minutes to arrive. We are working on it.',
        created_at: ago(60 * 24 * 6),
      },
    ],
  },
];

const follows = new Set<string>();
let otherFollowers = 18;

const delay = <T,>(v: T) => new Promise<T>((r) => setTimeout(() => r(structuredCloneSafe(v)), 120));
const structuredCloneSafe = <T,>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const requireOrg = () => {
  if (!org || !user) throw new Error('Please sign in.');
  return org;
};

export const demoApi: Api = {
  async getStatusPage(slug) {
    if (!org || org.slug !== slug.toLowerCase()) return delay(null);
    const { plan, ...pub } = org;
    const resolved = incidents.filter((i) => i.status === 'resolved').slice(0, 15);
    return delay({
      org: { ...pub, show_badge: plan === 'free' },
      components: components.map(({ position, ...c }) => c),
      incidents: [...incidents.filter((i) => i.status !== 'resolved'), ...resolved],
    });
  },
  async getFollowed() {
    if (!org || !follows.has(org.id)) return delay([]);
    return delay([
      {
        id: org.id,
        name: org.name,
        slug: org.slug,
        brand_color: org.brand_color,
        component_statuses: components.map((c) => c.status),
        open_incidents: incidents.filter((i) => i.status !== 'resolved').length,
      },
    ]);
  },
  async follow(_device, slug) {
    if (!org || org.slug !== slug.toLowerCase()) throw new Error('PAGE_NOT_FOUND');
    follows.add(org.id);
  },
  async unfollow(_device, orgId) {
    follows.delete(orgId);
  },
  async registerDevice() {},
  async forgetDevice() {
    follows.clear();
  },

  async getUser() {
    return user;
  },
  onAuthChange(cb) {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
  async signIn() {
    setUser(demoUser);
  },
  async signUp() {
    setUser(demoUser);
    return false;
  },
  async signOut() {
    setUser(null);
  },
  async requestPasswordReset() {},
  async resetPassword() {
    setUser(demoUser);
  },
  async deleteAccount() {
    org = null;
    components = [];
    incidents = [];
    setUser(null);
  },

  async getDashboard() {
    if (!user || !org) return delay(null);
    return delay({
      org,
      components: components.map(({ position, ...c }) => c),
      incidents,
      followerCount: otherFollowers + (follows.has(org.id) ? 1 : 0),
    });
  },
  async slugAvailable() {
    return true;
  },
  async createOrg({ name, slug, support_email }) {
    org = {
      id: id('org'),
      name,
      slug,
      support_email,
      support_phone: null,
      support_url: null,
      brand_color: DEFAULT_COLOR,
      plan: 'free',
    };
    otherFollowers = 0;
  },
  async updateOrg(_orgId, patch) {
    const o = requireOrg();
    org = { ...o, ...patch };
    if (!PLAN_LIMITS[org.plan].customBranding) org.brand_color = DEFAULT_COLOR;
  },
  async addComponent(_orgId, name, position) {
    const o = requireOrg();
    if (components.length >= PLAN_LIMITS[o.plan].maxComponents) throw new Error('PLAN_LIMIT_COMPONENTS');
    components.push({ id: id('c'), name, status: 'operational', position });
  },
  async updateComponent(componentId, patch) {
    components = components.map((c) => (c.id === componentId ? { ...c, ...patch } : c));
  },
  async deleteComponent(componentId) {
    components = components.filter((c) => c.id !== componentId);
  },
  async reportIncident(input) {
    requireOrg();
    const now = new Date().toISOString();
    incidents.unshift({
      id: id('i'),
      title: input.title,
      impact: input.impact,
      status: 'investigating',
      component_ids: input.componentIds,
      started_at: now,
      resolved_at: null,
      updates: [{ id: id('u'), status: 'investigating', body: input.body, created_at: now }],
    });
    if (input.componentStatus) {
      const status = input.componentStatus;
      components = components.map((c) => (input.componentIds.includes(c.id) ? { ...c, status } : c));
    }
  },
  async postUpdate(incidentId, status, body) {
    const now = new Date().toISOString();
    const incident = incidents.find((i) => i.id === incidentId);
    if (!incident) throw new Error('INCIDENT_NOT_FOUND');
    incident.status = status;
    incident.resolved_at = status === 'resolved' ? now : null;
    incident.updates.unshift({ id: id('u'), status, body, created_at: now });
    if (status === 'resolved') {
      const stillAffected = new Set(
        incidents.filter((i) => i.id !== incidentId && i.status !== 'resolved').flatMap((i) => i.component_ids),
      );
      components = components.map((c) =>
        incident.component_ids.includes(c.id) && !stillAffected.has(c.id) ? { ...c, status: 'operational' } : c,
      );
    }
  },
  async deleteIncident(incidentId) {
    incidents = incidents.filter((i) => i.id !== incidentId);
  },
  async demoSetPlan(plan) {
    const o = requireOrg();
    org = { ...o, plan, brand_color: PLAN_LIMITS[plan].customBranding ? o.brand_color : DEFAULT_COLOR };
  },
};
