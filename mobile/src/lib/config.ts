// All runtime configuration comes from EXPO_PUBLIC_* variables (see .env.example).
// With no Supabase project configured the app runs in demo mode on sample data.
export const APP_NAME = 'StatusPing';

export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
export const DEMO = !SUPABASE_URL || !SUPABASE_ANON_KEY;

/** Public web address of the app, used for shareable status page links. */
export const WEB_URL = (process.env.EXPO_PUBLIC_WEB_URL ?? '').replace(/\/+$/, '');

export const REVENUECAT_IOS_KEY = process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY ?? '';
export const REVENUECAT_ANDROID_KEY = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY ?? '';

export const PRIVACY_URL = process.env.EXPO_PUBLIC_PRIVACY_URL ?? '';
export const TERMS_URL = process.env.EXPO_PUBLIC_TERMS_URL ?? '';
