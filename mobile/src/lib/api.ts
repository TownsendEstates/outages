import { demoApi } from './api.demo';
import { supabaseApi } from './api.supabase';
import { DEMO } from './config';
import type { Api } from './types';

export const api: Api = DEMO ? demoApi : supabaseApi;

/** Turns backend errors into something a person can act on. */
export function friendlyError(e: unknown): string {
  const err = e as { message?: string; code?: string };
  const msg = err?.message ?? String(e);
  if (msg.includes('PLAN_LIMIT_COMPONENTS')) return "You've reached your plan's service limit. Upgrade to add more.";
  if (msg.includes('PAGE_NOT_FOUND')) return "We couldn't find a status page with that code.";
  if (msg.includes('INCIDENT_NOT_FOUND')) return 'That incident no longer exists.';
  if (err?.code === '23505') return 'That page code is already taken. Try another.';
  if (err?.code === '23514') return 'Some of that information is too long or in the wrong format.';
  if (/Invalid login credentials/i.test(msg)) return 'Wrong email or password.';
  if (/token has expired|otp.*(expired|invalid)/i.test(msg)) return 'That code is wrong or has expired. Request a new one.';
  if (/already registered/i.test(msg)) return 'An account with that email already exists. Sign in instead.';
  if (/network|fetch/i.test(msg)) return 'No connection. Check your internet and try again.';
  return msg;
}
