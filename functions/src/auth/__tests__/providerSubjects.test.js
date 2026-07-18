import { describe, expect, it, vi } from 'vitest';
import { resolveProviderSubject } from '../providerSubjects.js';

const harness = ({ mapping, userByEmail } = {}) => {
  const ref = { get: vi.fn().mockResolvedValue(mapping ? { exists: true, data: () => mapping } : { exists: false }) };
  const transaction = {
    get: vi.fn().mockResolvedValue({ exists: false }),
    create: vi.fn(),
  };
  return {
    firestore: {
      collection: vi.fn().mockReturnValue({ doc: vi.fn().mockReturnValue(ref) }),
      runTransaction: (fn) => fn(transaction),
    },
    auth: {
      getUserByEmail: userByEmail
        ? vi.fn().mockResolvedValue(userByEmail)
        : vi.fn().mockRejectedValue({ code: 'auth/user-not-found' }),
      getUser: vi.fn().mockRejectedValue({ code: 'auth/user-not-found' }),
    },
    transaction,
  };
};

describe('provider subject mapping', () => {
  it('uses an existing verified mapping', async () => {
    const h = harness({ mapping: { uid: 'stable-user' } });
    await expect(resolveProviderSubject({ ...h, provider: 'google', subject: 'sub-1' })).resolves.toBe('stable-user');
  });

  it('migrates a matching same-provider Firebase identity', async () => {
    const h = harness({ userByEmail: { uid: 'uid-1', providerData: [{ providerId: 'google.com', uid: 'sub-1' }] } });
    await expect(resolveProviderSubject({ ...h, provider: 'google', subject: 'sub-1', email: 'a@example.com' })).resolves.toBe('uid-1');
    expect(h.transaction.create).toHaveBeenCalled();
  });

  it('refuses to merge an email owned by another provider', async () => {
    const h = harness({ userByEmail: { uid: 'password-user', providerData: [{ providerId: 'password', uid: 'a@example.com' }] } });
    await expect(resolveProviderSubject({ ...h, provider: 'google', subject: 'sub-1', email: 'a@example.com' }))
      .rejects.toMatchObject({ code: 'provider_link_requires_reauthentication' });
  });
});
