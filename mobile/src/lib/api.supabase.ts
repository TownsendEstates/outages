import type { User as AuthUser } from '@supabase/supabase-js';

import { supabase } from './supabase';
import type { Api, Dashboard, Incident, IncidentUpdate, User } from './types';

const toUser = (u: AuthUser | null | undefined): User | null => (u ? { id: u.id, email: u.email ?? '' } : null);

function check<T>(res: { data: T; error: { message: string; code?: string } | null }): T {
  if (res.error) throw Object.assign(new Error(res.error.message), { code: res.error.code });
  return res.data;
}

/** Push delivery must never fail the post itself; the update is already live. */
async function notify(updateId: string) {
  try {
    await supabase().functions.invoke('notify-incident', { body: { update_id: updateId } });
  } catch {
    // Followers still see the update the next time they open the page.
  }
}

const newestFirst = (a: IncidentUpdate, b: IncidentUpdate) => b.created_at.localeCompare(a.created_at);

export const supabaseApi: Api = {
  async getStatusPage(slug) {
    return check(await supabase().rpc('get_status_page', { p_slug: slug }));
  },
  async getFollowed(deviceId) {
    return check(await supabase().rpc('get_followed', { p_device: deviceId })) ?? [];
  },
  async follow(deviceId, slug, pushToken, platform) {
    check(
      await supabase().rpc('follow_org', {
        p_device: deviceId,
        p_slug: slug,
        p_push_token: pushToken,
        p_platform: platform,
      }),
    );
  },
  async unfollow(deviceId, orgId) {
    check(await supabase().rpc('unfollow_org', { p_device: deviceId, p_org: orgId }));
  },
  async registerDevice(deviceId, pushToken, platform) {
    check(
      await supabase().rpc('register_device', {
        p_device: deviceId,
        p_push_token: pushToken,
        p_platform: platform,
      }),
    );
  },
  async forgetDevice(deviceId) {
    check(await supabase().rpc('forget_device', { p_device: deviceId }));
  },

  async getUser() {
    const { data } = await supabase().auth.getSession();
    return toUser(data.session?.user);
  },
  onAuthChange(cb) {
    const { data } = supabase().auth.onAuthStateChange((_event, session) => cb(toUser(session?.user)));
    return () => data.subscription.unsubscribe();
  },
  async signIn(email, password) {
    const { error } = await supabase().auth.signInWithPassword({ email, password });
    if (error) throw error;
  },
  async signUp(email, password) {
    const { data, error } = await supabase().auth.signUp({ email, password });
    if (error) throw error;
    return !data.session;
  },
  async signOut() {
    await supabase().auth.signOut();
  },
  async requestPasswordReset(email) {
    const { error } = await supabase().auth.resetPasswordForEmail(email);
    if (error) throw error;
  },
  async resetPassword(email, code, newPassword) {
    const verified = await supabase().auth.verifyOtp({ email, token: code, type: 'recovery' });
    if (verified.error) throw verified.error;
    const { error } = await supabase().auth.updateUser({ password: newPassword });
    if (error) throw error;
  },
  async deleteAccount() {
    check(await supabase().rpc('delete_my_account'));
    await supabase().auth.signOut({ scope: 'local' });
  },

  async getDashboard(): Promise<Dashboard | null> {
    const db = supabase();
    const org = check(await db.from('organizations').select('*').maybeSingle());
    if (!org) return null;
    const [components, incidents, followerCount] = await Promise.all([
      db.from('components').select('id, name, status').eq('org_id', org.id).order('position').order('created_at'),
      db
        .from('incidents')
        .select(
          'id, title, impact, status, component_ids, started_at, resolved_at, updates:incident_updates(id, status, body, created_at)',
        )
        .eq('org_id', org.id)
        .order('started_at', { ascending: false })
        .limit(50),
      db.rpc('org_follower_count', { p_org: org.id }),
    ]);
    return {
      org,
      components: check(components) ?? [],
      incidents: ((check(incidents) ?? []) as Incident[]).map((i) => ({
        ...i,
        updates: [...i.updates].sort(newestFirst),
      })),
      followerCount: check(followerCount) ?? 0,
    };
  },
  async slugAvailable(slug) {
    return check(await supabase().rpc('slug_available', { p_slug: slug }));
  },
  async createOrg({ name, slug, support_email }) {
    const { data } = await supabase().auth.getSession();
    const owner_id = data.session?.user.id;
    if (!owner_id) throw new Error('Please sign in again.');
    check(await supabase().from('organizations').insert({ owner_id, name, slug, support_email }));
  },
  async updateOrg(orgId, patch) {
    check(await supabase().from('organizations').update(patch).eq('id', orgId));
  },
  async addComponent(orgId, name, position) {
    check(await supabase().from('components').insert({ org_id: orgId, name, position }));
  },
  async updateComponent(id, patch) {
    check(await supabase().from('components').update(patch).eq('id', id));
  },
  async deleteComponent(id) {
    check(await supabase().from('components').delete().eq('id', id));
  },
  async reportIncident(input) {
    const updateId: string = check(
      await supabase().rpc('report_incident', {
        p_org: input.orgId,
        p_title: input.title,
        p_impact: input.impact,
        p_component_ids: input.componentIds,
        p_component_status: input.componentStatus,
        p_body: input.body,
      }),
    );
    await notify(updateId);
  },
  async postUpdate(incidentId, status, body) {
    const updateId: string = check(
      await supabase().rpc('post_incident_update', { p_incident: incidentId, p_status: status, p_body: body }),
    );
    await notify(updateId);
  },
  async deleteIncident(id) {
    check(await supabase().from('incidents').delete().eq('id', id));
  },
};
