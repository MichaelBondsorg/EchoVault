import { createHash } from 'node:crypto';

const providerId = (provider) => `${provider}.com`;
const mappingId = (provider, subject) =>
  createHash('sha256').update(`${provider}:${subject}`).digest('hex');

/**
 * Resolve a verified provider subject without silently merging identities by email.
 * Existing same-provider users are migrated; cross-provider collisions require
 * an authenticated reauthentication/linking flow.
 */
export async function resolveProviderSubject({ firestore, auth, provider, subject, email }) {
  if (!['google', 'apple'].includes(provider) || !subject) throw new Error('provider_subject_invalid');
  const ref = firestore.collection('providerSubjects').doc(mappingId(provider, subject));
  const existingMapping = await ref.get();
  if (existingMapping.exists) return existingMapping.data().uid;

  const legacyUid = provider === 'apple' ? `apple_${subject}` : subject;
  let uid = legacyUid;

  if (email) {
    try {
      const existingUser = await auth.getUserByEmail(email);
      const sameProvider = existingUser.providerData?.some(
        (identity) => identity.providerId === providerId(provider) && identity.uid === subject
      );
      if (!sameProvider && existingUser.uid !== legacyUid) {
        const error = new Error('provider_link_requires_reauthentication');
        error.code = 'provider_link_requires_reauthentication';
        throw error;
      }
      uid = existingUser.uid;
    } catch (error) {
      if (error.code !== 'auth/user-not-found') throw error;
    }
  } else {
    try {
      uid = (await auth.getUser(legacyUid)).uid;
    } catch (error) {
      if (error.code !== 'auth/user-not-found') throw error;
    }
  }

  return firestore.runTransaction(async (transaction) => {
    const raced = await transaction.get(ref);
    if (raced.exists) return raced.data().uid;
    transaction.create(ref, {
      uid,
      provider,
      subjectHash: createHash('sha256').update(subject).digest('hex'),
      createdAt: new Date(),
    });
    return uid;
  });
}
