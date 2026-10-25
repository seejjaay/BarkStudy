import type { AppError, BarkControlApi, Result } from '../../shared/control';
import { errorText } from './text';

export const api: BarkControlApi = window.barkControl;

/** A request that fails outright (the channel is gone, main threw) becomes an ordinary error result the UI can show. */
export async function attempt<T>(request: Promise<Result<T>>): Promise<Result<T>> {
  try {
    return await request;
  } catch (e) {
    return { ok: false, error: { code: 'invalid-request', message: e instanceof Error ? e.message : String(e) } };
  }
}

export const describe = (e: AppError): string => errorText(e);
