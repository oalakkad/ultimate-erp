import { describe, expect, it } from 'vitest';
import { renderHtml } from './mailer.js';

describe('renderHtml', () => {
  it('makes links clickable, keeping query strings intact', () => {
    const html = renderHtml('Confirm:\n\nhttp://localhost:3000/verify?token=abc&x=1\n', 'en');
    expect(html).toContain(
      '<a href="http://localhost:3000/verify?token=abc&#38;x=1">http://localhost:3000/verify?token=abc&#38;x=1</a>',
    );
  });

  it('escapes HTML in the text so names cannot inject markup', () => {
    const html = renderHtml('Hello <script>alert(1)</script>', 'en');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&#60;script&#62;');
  });

  it('sets the writing direction for Arabic', () => {
    expect(renderHtml('مرحبًا', 'ar')).toContain('lang="ar" dir="rtl"');
  });
});
