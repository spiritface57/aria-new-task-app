// Runtime-agnostic core of the reset-password function, unit-tested with fakes.

export interface ResetDeps {
  findUser(email: string, code: string): Promise<string | null>;
  setPassword(userId: string, password: string): Promise<void>;
  replaceCode(userId: string): Promise<string>;
}

export type ResetOutcome =
  | { status: 200; body: { newCode: string } }
  | { status: 400; body: { error: 'invalid_request' | 'weak_password' | 'recovery_invalid' } };

export const MIN_PASSWORD = 8;
export const MAX_PASSWORD = 72;   // bcrypt ignores bytes beyond 72

export async function resetPassword(input: unknown, deps: ResetDeps): Promise<ResetOutcome> {
  const { email, code, password } = (input ?? {}) as Record<string, unknown>;
  if (typeof email !== 'string' || typeof code !== 'string' || typeof password !== 'string'
      || email.length > 320 || code.length > 100) {
    return { status: 400, body: { error: 'invalid_request' } };
  }
  // Check the password before touching the code, so a rejected password never burns it.
  if (password.length < MIN_PASSWORD || new TextEncoder().encode(password).length > MAX_PASSWORD) {
    return { status: 400, body: { error: 'weak_password' } };
  }
  const userId = await deps.findUser(email, code);
  if (!userId) return { status: 400, body: { error: 'recovery_invalid' } };

  await deps.setPassword(userId, password);
  // The used code is replaced; the user must save the new one.
  return { status: 200, body: { newCode: await deps.replaceCode(userId) } };
}
