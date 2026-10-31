import type { DiagnosticsInput } from '../../src/main/diagnostics';
import { DEFAULT_SETTINGS } from '../../src/shared/settings';

/** A small, valid bundle input for the handler tests' platform fakes. */
export const sampleDiagnosticsInput = (over: Partial<DiagnosticsInput> = {}): DiagnosticsInput => ({
  app: { version: '1.2.3', electron: '33.0.0', chrome: '130.0.0', node: '20.0.0' },
  os: { release: '10.0.26300', arch: 'x64' },
  displays: [{ width: 1920, height: 1080, scale: 1 }],
  settings: DEFAULT_SETTINGS,
  state: { trackerDown: false, leaveItConflict: false, batterySaver: false, phase: 'idle' },
  crashes: { count: 0, newest: null },
  problems: [],
  engine: null,
  home: 'C:\\Users\\Someone',
  user: 'Someone',
  ...over,
});
