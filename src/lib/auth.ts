import { config } from './config';
import { supabase } from './supabase';

export const MIN_PASSWORD = 8;

export async function signUp(email: string, password: string, captchaToken?: string) {
  const { data, error } = await supabase.auth.signUp({ email, password, options: { captchaToken } });
  if (error) throw error;
  // With "Confirm email" on, Supabase returns no session and tries to send an
  // email this project can't deliver. It must be off (see README step 2).
  if (!data.session) throw new Error('confirm_email_enabled');
}

export async function signIn(email: string, password: string, captchaToken?: string) {
  const { error } = await supabase.auth.signInWithPassword({ email, password, options: { captchaToken } });
  if (error) throw error;
}

/** Returns the replacement recovery code; the used one stops working. */
export async function resetPassword(email: string, code: string, password: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${config.supabaseUrl}/functions/v1/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: config.supabaseAnonKey },
      body: JSON.stringify({ email, code, password }),
    });
  } catch {
    throw new Error('Failed to fetch');
  }
  const body = await res.json().catch(() => ({})) as { newCode?: string; error?: string };
  if (!res.ok || !body.newCode) throw new Error(body.error ?? 'server_error');
  return body.newCode;
}
