import { describe, expect, it } from 'vitest';
import { codeFromScan, targetForLink } from '../src/lib/scan-link';

describe('codeFromScan', () => {
  it('takes the code from the kiosk link or a bare code', () => {
    expect(codeFromScan('https://acme.erp.example/attendance/scan?code=abc.def-GHI_123')).toBe(
      'abc.def-GHI_123',
    );
    expect(codeFromScan('site:1730000000:signature.here')).toBe('site:1730000000:signature.here');
  });

  it('refuses anything else', () => {
    expect(codeFromScan('')).toBeNull();
    expect(codeFromScan('https://evil.example/?other=1')).toBeNull();
    expect(codeFromScan('hello world')).toBeNull();
    expect(codeFromScan('x'.repeat(201))).toBeNull();
  });
});

describe('targetForLink', () => {
  it('maps company web paths to app screens, anything odd to Home', () => {
    expect(targetForLink('/tasks/0193d1f0-0000-7000-8000-000000000000')).toEqual({
      screen: 'TaskDetail',
      id: '0193d1f0-0000-7000-8000-000000000000',
    });
    expect(targetForLink('/tasks?state=open')).toEqual({ screen: 'Tasks' });
    expect(targetForLink('/leave')).toEqual({ screen: 'Leave' });
    expect(targetForLink('/time/approvals')).toEqual({ screen: 'Time' });
    expect(targetForLink('/attendance')).toEqual({ screen: 'Attendance' });
    expect(targetForLink('/invoices/1')).toEqual({ screen: 'Home' });
    expect(targetForLink('//evil.example')).toEqual({ screen: 'Home' });
    expect(targetForLink(null)).toEqual({ screen: 'Home' });
  });
});
