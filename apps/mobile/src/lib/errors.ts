import { type MessageKey, type MessageParams } from '@ultimate-erp/i18n';
import { ApiError } from './api';

type Translate = (key: MessageKey, params?: MessageParams) => string;

/** A friendly, translated sentence for any failure (the server only ever sends codes). */
export function errorText(t: Translate, err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'NETWORK') return t('ui.errors.network');
    return t(`ui.errors.${err.code}`);
  }
  return t('ui.errors.INTERNAL_ERROR');
}

/** The "Reference: …" line to quote to support, when the server gave a request ID. */
export function errorReference(t: Translate, err: unknown): string | undefined {
  return err instanceof ApiError && err.requestId
    ? t('ui.states.errorReference', { id: err.requestId.slice(0, 8) })
    : undefined;
}
