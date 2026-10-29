/** React Query key of one client (shared by the detail page and its tabs). */
export const clientKey = (id: string) => ['clients', 'detail', id] as const;
