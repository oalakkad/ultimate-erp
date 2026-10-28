import { useLocation } from '@tanstack/react-router';

/** A query-string value exactly as written in the URL (tokens must not be re-parsed). */
export function useSearchParam(name: string): string | undefined {
  const href = useLocation({ select: (location) => location.href });
  return new URL(href, window.location.origin).searchParams.get(name) ?? undefined;
}
