import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

import { DEMO, SUPABASE_ANON_KEY, SUPABASE_URL } from './config';

let client: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (DEMO) throw new Error('Supabase is not configured');
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        storage: AsyncStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    });
    if (Platform.OS !== 'web') {
      // Only refresh the session while the app is in the foreground.
      const c = client;
      AppState.addEventListener('change', (state) => {
        if (state === 'active') c.auth.startAutoRefresh();
        else c.auth.stopAutoRefresh();
      });
    }
  }
  return client;
}
