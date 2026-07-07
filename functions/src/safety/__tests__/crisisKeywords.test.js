import { describe, it, expect } from 'vitest';
import { isCrisisText, CRISIS_KEYWORDS_REGEX } from '../crisisKeywords.js';
// Cross-package import (runs under the root vitest config) to assert the server
// regex never drifts from the client's source of truth.
import { CRISIS_KEYWORDS as CLIENT_CRISIS_KEYWORDS } from '../../../../src/config/constants.js';

describe('server crisis keywords', () => {
  it('stays identical to the client CRISIS_KEYWORDS regex', () => {
    expect(CRISIS_KEYWORDS_REGEX.source).toBe(CLIENT_CRISIS_KEYWORDS.source);
    expect(CRISIS_KEYWORDS_REGEX.flags).toBe(CLIENT_CRISIS_KEYWORDS.flags);
  });

  it('detects crisis phrases', () => {
    expect(isCrisisText('I want to kill myself')).toBe(true);
    expect(isCrisisText('there is no reason to live')).toBe(true);
    expect(isCrisisText('SUICIDE has been on my mind')).toBe(true);
  });

  it('does not flag normal or metaphorical text', () => {
    expect(isCrisisText('this deadline is killing me')).toBe(false);
    expect(isCrisisText('had a rough day but I am okay')).toBe(false);
    expect(isCrisisText('')).toBe(false);
    expect(isCrisisText(null)).toBe(false);
  });
});
