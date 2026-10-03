import { describe, expect, it, vi } from 'vitest';
import { resetPassword, type ResetDeps } from './reset';

function deps(user: string | null = 'u1'): ResetDeps {
  return {
    findUser: vi.fn(async () => user),
    setPassword: vi.fn(async () => {}),
    replaceCode: vi.fn(async () => 'NEWCODE'),
  };
}

describe('resetPassword', () => {
  it('sets the password and returns a fresh code', async () => {
    const d = deps();
    const r = await resetPassword({ email: 'a@b.c', code: 'X', password: 'long enough' }, d);
    expect(r).toEqual({ status: 200, body: { newCode: 'NEWCODE' } });
    expect(d.setPassword).toHaveBeenCalledWith('u1', 'long enough');
  });
  it('rejects a short password without looking up or burning the code', async () => {
    const d = deps();
    const r = await resetPassword({ email: 'a@b.c', code: 'X', password: 'short' }, d);
    expect(r.body).toEqual({ error: 'weak_password' });
    expect(d.findUser).not.toHaveBeenCalled();
  });
  it('rejects passwords longer than bcrypt can store', async () => {
    const r = await resetPassword({ email: 'a@b.c', code: 'X', password: 'é'.repeat(40) }, deps());
    expect(r.body).toEqual({ error: 'weak_password' });
  });
  it('gives the same answer for a wrong email or code', async () => {
    const d = deps(null);
    const r = await resetPassword({ email: 'a@b.c', code: 'X', password: 'long enough' }, d);
    expect(r).toEqual({ status: 400, body: { error: 'recovery_invalid' } });
    expect(d.setPassword).not.toHaveBeenCalled();
  });
  it('rejects malformed input', async () => {
    expect((await resetPassword(null, deps())).body).toEqual({ error: 'invalid_request' });
    expect((await resetPassword({ email: 1, code: 'x', password: 'long enough' }, deps())).body)
      .toEqual({ error: 'invalid_request' });
  });
});
