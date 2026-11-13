export type ComponentStatus = 'operational' | 'degraded' | 'partial_outage' | 'major_outage' | 'maintenance';
export type IncidentStatus = 'investigating' | 'identified' | 'monitoring' | 'resolved';
export type Impact = 'minor' | 'major' | 'critical' | 'maintenance';
export type Plan = 'free' | 'pro' | 'business';

export interface Contact {
  support_email: string | null;
  support_phone: string | null;
  support_url: string | null;
}

/** An organization as its owner sees it. */
export interface Org extends Contact {
  id: string;
  name: string;
  slug: string;
  brand_color: string;
  plan: Plan;
}

/** An organization as the public sees it. */
export interface PublicOrg extends Contact {
  id: string;
  name: string;
  slug: string;
  brand_color: string;
  show_badge: boolean;
}

export interface Component {
  id: string;
  name: string;
  status: ComponentStatus;
}

export interface IncidentUpdate {
  id: string;
  status: IncidentStatus;
  body: string;
  created_at: string;
}

export interface Incident {
  id: string;
  title: string;
  impact: Impact;
  status: IncidentStatus;
  component_ids: string[];
  started_at: string;
  resolved_at: string | null;
  /** Newest first. */
  updates: IncidentUpdate[];
}

export interface StatusPage {
  org: PublicOrg;
  components: Component[];
  incidents: Incident[];
}

export interface FollowedOrg {
  id: string;
  name: string;
  slug: string;
  brand_color: string;
  component_statuses: ComponentStatus[];
  open_incidents: number;
}

export interface Dashboard {
  org: Org;
  components: Component[];
  incidents: Incident[];
  followerCount: number;
}

export interface User {
  id: string;
  email: string;
}

export interface NewIncident {
  orgId: string;
  title: string;
  impact: Impact;
  componentIds: string[];
  componentStatus: ComponentStatus | null;
  body: string;
}

export type OrgPatch = Partial<Pick<Org, 'name' | 'brand_color' | 'support_email' | 'support_phone' | 'support_url'>>;

export interface Api {
  // Public — no account needed
  getStatusPage(slug: string): Promise<StatusPage | null>;
  getFollowed(deviceId: string): Promise<FollowedOrg[]>;
  follow(deviceId: string, slug: string, pushToken: string | null, platform: string): Promise<void>;
  unfollow(deviceId: string, orgId: string): Promise<void>;
  registerDevice(deviceId: string, pushToken: string, platform: string): Promise<void>;
  forgetDevice(deviceId: string): Promise<void>;

  // Owner account
  getUser(): Promise<User | null>;
  onAuthChange(cb: (user: User | null) => void): () => void;
  signIn(email: string, password: string): Promise<void>;
  /** Resolves true when the account must confirm its email before signing in. */
  signUp(email: string, password: string): Promise<boolean>;
  signOut(): Promise<void>;
  /** Emails a 6-digit code. Resolves even if the address has no account. */
  requestPasswordReset(email: string): Promise<void>;
  resetPassword(email: string, code: string, newPassword: string): Promise<void>;
  deleteAccount(): Promise<void>;

  // Owner data
  getDashboard(): Promise<Dashboard | null>;
  slugAvailable(slug: string): Promise<boolean>;
  createOrg(input: { name: string; slug: string; support_email: string | null }): Promise<void>;
  updateOrg(orgId: string, patch: OrgPatch): Promise<void>;
  addComponent(orgId: string, name: string, position: number): Promise<void>;
  updateComponent(id: string, patch: Partial<Pick<Component, 'name' | 'status'>>): Promise<void>;
  deleteComponent(id: string): Promise<void>;
  reportIncident(input: NewIncident): Promise<void>;
  postUpdate(incidentId: string, status: IncidentStatus, body: string): Promise<void>;
  deleteIncident(id: string): Promise<void>;

  /** Demo mode only: pretend a purchase happened. */
  demoSetPlan?(plan: Plan): Promise<void>;
}
