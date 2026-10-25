import type { SessionView } from './control';

type Running = Extract<SessionView, { phase: 'running' }>;

export type SessionKind = 'running' | 'paused' | 'stay' | 'away' | 'quiet';

/**
 * What is holding Pandesal back, most binding first: Leave it, then a Stay, then the user being away, then a quiet app
 * in front. The control window's badge and the tray menu both say this, so they must agree.
 */
export function sessionKind(v: Running): SessionKind {
  if (v.paused) return 'paused';
  if (v.stay) return 'stay';
  if (v.away) return 'away';
  if (v.suppressed) return 'quiet';
  return 'running';
}
