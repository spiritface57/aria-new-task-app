import { createClient } from '@supabase/supabase-js';
import { config } from './config';

export const supabase = createClient(
  config.supabaseUrl || 'http://localhost', config.supabaseAnonKey || 'missing',
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' } },
);
