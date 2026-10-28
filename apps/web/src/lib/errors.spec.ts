import { ERROR_CODES } from '@ultimate-erp/contracts';
import { translate } from '@ultimate-erp/i18n';
import { describe, expect, it } from 'vitest';
import { ApiError } from './api.js';
import { errorText } from './errors.js';

describe('error messages', () => {
  it.each(['en', 'ar'] as const)('every API error code has a %s translation', (locale) => {
    for (const code of ERROR_CODES) {
      const text = errorText(
        (key, params) => translate(locale, key, params),
        new ApiError(400, code, 'r'),
      );
      expect(text, code).not.toMatch(/^Missing/);
      expect(text.length, code).toBeGreaterThan(5);
    }
  });

  it('never shows raw codes or server text to people', () => {
    const text = errorText(
      (key) => translate('en', key),
      new ApiError(401, 'INVALID_CREDENTIALS', 'r'),
    );
    expect(text).toBe('The email or password is incorrect.');
  });
});
