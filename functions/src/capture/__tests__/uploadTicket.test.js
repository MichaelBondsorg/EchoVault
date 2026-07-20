/**
 * Tests for issueCaptureUploadTicketCore — validation + V4 signed-URL minting
 * for the native background-upload path (task B5). Auth + consent are enforced
 * by the thin onCall wrapper in functions/index.js (mirroring every other
 * callable); this covers the pure, injectable core.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  issueCaptureUploadTicketCore,
  captureObjectPath,
  ALLOWED_UPLOAD_MIME_TYPES,
  UPLOAD_TICKET_TTL_MS,
} from '../uploadTicket.js';

const OP_ID = '11111111-2222-4333-8444-555555555555';

function makeStorage() {
  const getSignedUrl = vi.fn().mockResolvedValue(['https://signed.example/put?sig=abc']);
  const file = vi.fn().mockReturnValue({ getSignedUrl });
  const bucket = vi.fn().mockReturnValue({ file });
  return { storage: { bucket }, bucket, file, getSignedUrl };
}

describe('issueCaptureUploadTicketCore', () => {
  let s;
  beforeEach(() => { s = makeStorage(); });

  it('mints a V4 write signed URL bound to the requested contentType', async () => {
    const now = () => 1_000_000;
    const result = await issueCaptureUploadTicketCore(
      { uid: 'user-1', operationId: OP_ID, mimeType: 'audio/mp4' },
      { storage: s.storage, now }
    );

    expect(s.file).toHaveBeenCalledWith(`capture-uploads/user-1/${OP_ID}.m4a`);
    const opts = s.getSignedUrl.mock.calls[0][0];
    expect(opts).toMatchObject({ version: 'v4', action: 'write', contentType: 'audio/mp4' });
    expect(opts.expires).toBe(1_000_000 + UPLOAD_TICKET_TTL_MS);
    // No provenance ⇒ no extension headers signed in; URL still valid.
    expect(opts.extensionHeaders).toBeUndefined();

    expect(result.uploadUrl).toBe('https://signed.example/put?sig=abc');
    expect(result.objectPath).toBe(`capture-uploads/user-1/${OP_ID}.m4a`);
    expect(result.expiresAt).toBe(new Date(1_000_000 + UPLOAD_TICKET_TTL_MS).toISOString());
    // requiredHeaders always echoes Content-Type; nothing else without provenance.
    expect(result.requiredHeaders).toEqual({ 'Content-Type': 'audio/mp4' });
  });

  it('signs capture provenance into extensionHeaders and echoes requiredHeaders', async () => {
    const result = await issueCaptureUploadTicketCore(
      {
        uid: 'user-1', operationId: OP_ID, mimeType: 'audio/mp4',
        capturedAt: '2026-07-20T10:00:00Z', captureTimezone: 'America/Los_Angeles',
      },
      { storage: s.storage }
    );

    const opts = s.getSignedUrl.mock.calls[0][0];
    expect(opts.extensionHeaders).toEqual({
      'x-goog-meta-captured-at': '2026-07-20T10:00:00Z',
      'x-goog-meta-capture-timezone': 'America/Los_Angeles',
    });
    expect(result.requiredHeaders).toEqual({
      'Content-Type': 'audio/mp4',
      'x-goog-meta-captured-at': '2026-07-20T10:00:00Z',
      'x-goog-meta-capture-timezone': 'America/Los_Angeles',
    });
  });

  it('signs only the provenance field that was provided', async () => {
    const result = await issueCaptureUploadTicketCore(
      { uid: 'u', operationId: OP_ID, mimeType: 'audio/mp4', capturedAt: '2026-07-20T10:00:00.500Z' },
      { storage: s.storage }
    );
    const opts = s.getSignedUrl.mock.calls[0][0];
    expect(opts.extensionHeaders).toEqual({ 'x-goog-meta-captured-at': '2026-07-20T10:00:00.500Z' });
    expect(result.requiredHeaders['x-goog-meta-capture-timezone']).toBeUndefined();
  });

  it('rejects a malformed capturedAt', async () => {
    for (const bad of ['not-a-date', '2026-07-20', '20/07/2026', 1234, '2026-07-20T10:00:00']) {
      await expect(
        issueCaptureUploadTicketCore({ uid: 'u', operationId: OP_ID, mimeType: 'audio/mp4', capturedAt: bad }, { storage: s.storage })
      ).rejects.toMatchObject({ code: 'invalid-argument' });
    }
    expect(s.getSignedUrl).not.toHaveBeenCalled();
  });

  it('rejects an invalid IANA captureTimezone', async () => {
    // Note: Intl (ICU) accepts legacy abbreviations like 'PST'/'EST', so those
    // are intentionally NOT treated as junk. These are genuinely unknown ids.
    for (const bad of ['Not/AZone', '', 'America/Nowhere', 'Foo/Bar', 123]) {
      await expect(
        issueCaptureUploadTicketCore({ uid: 'u', operationId: OP_ID, mimeType: 'audio/mp4', captureTimezone: bad }, { storage: s.storage })
      ).rejects.toMatchObject({ code: 'invalid-argument' });
    }
    expect(s.getSignedUrl).not.toHaveBeenCalled();
  });

  it('derives the path from the authenticated uid (not from client metadata)', async () => {
    await issueCaptureUploadTicketCore(
      { uid: 'owner-abc', operationId: OP_ID, mimeType: 'audio/webm' },
      { storage: s.storage }
    );
    expect(s.file).toHaveBeenCalledWith(`capture-uploads/owner-abc/${OP_ID}.m4a`);
  });

  it.each(ALLOWED_UPLOAD_MIME_TYPES)('accepts allowed mimeType %s', async (mimeType) => {
    await expect(
      issueCaptureUploadTicketCore({ uid: 'u', operationId: OP_ID, mimeType }, { storage: s.storage })
    ).resolves.toBeTruthy();
  });

  it('rejects an unsupported mimeType', async () => {
    await expect(
      issueCaptureUploadTicketCore({ uid: 'u', operationId: OP_ID, mimeType: 'audio/ogg' }, { storage: s.storage })
    ).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(s.getSignedUrl).not.toHaveBeenCalled();
  });

  it('rejects a non-UUID operationId (path-traversal safe)', async () => {
    for (const bad of ['../evil', 'not-a-uuid', '', null, 'a/b/c']) {
      await expect(
        issueCaptureUploadTicketCore({ uid: 'u', operationId: bad, mimeType: 'audio/mp4' }, { storage: s.storage })
      ).rejects.toMatchObject({ code: 'invalid-argument' });
    }
    expect(s.getSignedUrl).not.toHaveBeenCalled();
  });

  it('rejects a missing uid as unauthenticated', async () => {
    await expect(
      issueCaptureUploadTicketCore({ uid: '', operationId: OP_ID, mimeType: 'audio/mp4' }, { storage: s.storage })
    ).rejects.toMatchObject({ code: 'unauthenticated' });
  });
});

describe('captureObjectPath', () => {
  it('builds the canonical capture-uploads path', () => {
    expect(captureObjectPath('uid-9', OP_ID)).toBe(`capture-uploads/uid-9/${OP_ID}.m4a`);
  });
});
