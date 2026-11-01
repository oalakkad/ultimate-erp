/**
 * The kiosk QR encodes the web scan link, `https://acme.erp.example/attendance/scan?code=…`, so
 * one code serves both the web page and the app. Accepts that link or a bare code.
 */
export function codeFromScan(data: string): string | null {
  const text = data.trim();
  if (text === '') return null;
  if (/^https?:\/\//i.test(text)) {
    try {
      const url = new URL(text);
      const code = url.searchParams.get('code');
      return code && code.length <= 200 ? code : null;
    } catch {
      return null;
    }
  }
  // A bare code: URL-safe characters only (the server signs with base64url parts and dots).
  return /^[A-Za-z0-9._:-]{10,200}$/.test(text) ? text : null;
}

/** Where a notification link (a web path inside the company) should open in the app. */
export type AppTarget =
  | { screen: 'TaskDetail'; id: string }
  | { screen: 'Tasks' }
  | { screen: 'Leave' }
  | { screen: 'Time' }
  | { screen: 'Attendance' }
  | { screen: 'Notifications' }
  | { screen: 'Home' };

export function targetForLink(link: string | null): AppTarget {
  if (!link || !link.startsWith('/') || link.startsWith('//')) return { screen: 'Home' };
  const path = link.split(/[?#]/)[0] ?? '';
  const task = /^\/tasks\/([0-9a-f-]{36})$/i.exec(path);
  if (task?.[1]) return { screen: 'TaskDetail', id: task[1] };
  if (path.startsWith('/tasks')) return { screen: 'Tasks' };
  if (path.startsWith('/leave')) return { screen: 'Leave' };
  if (path.startsWith('/time')) return { screen: 'Time' };
  if (path.startsWith('/attendance')) return { screen: 'Attendance' };
  if (path.startsWith('/notifications')) return { screen: 'Notifications' };
  return { screen: 'Home' };
}
