/** The tray menu, its tooltip, and the notifications for a tray action that could not run. */
export const TRAY = {
  tooltip: (status: string) => `BarkStudy\n${status}`,

  volumeLow: 'Low',
  volumeMedium: 'Medium',
  volumeHigh: 'High',

  idle: 'No session running',
  ended: (answered: number, treats: number) => `Session finished: ${answered} answered, ${treats} treats`,
  paused: (deck: string) => `Studying ${deck}: paused (Leave it)`,
  stay: (deck: string, minutesLeft: number | null) => `Studying ${deck}: staying${minutesLeft === null ? '' : `, about ${minutesLeft} min left`}`,
  away: (deck: string) => `Studying ${deck}: you are away`,
  quiet: (deck: string) => `Studying ${deck}: quiet while another app is in front`,
  running: (deck: string) => `Studying ${deck}`,
  /** Appended to the status line while battery saver is on. */
  napping: '(napping: battery saver)',

  trackerDown: 'Window tracking is off. Pandesal roams the screen edges.',
  shortcutTaken: (label: string) => `${label} is used by another app, so Leave it works from this menu only.`,
  resume: 'Resume',
  pause: 'Leave it (pause)',
  endStay: 'End stay',
  stayMenu: 'Stay (focus block)',
  stayFor: (minutes: number) => `Stay ${minutes} minutes`,
  endSession: 'End session',
  startNoDecks: 'Start session (add a deck with cards first)',
  startMenu: 'Start session',
  deckItem: (name: string, count: number) => `${name} (${count} ${count === 1 ? 'card' : 'cards'})`,
  sounds: 'Sounds',
  volume: 'Volume',
  open: 'Open BarkStudy',
  quit: 'Quit BarkStudy',

  whyNot: {
    'empty-deck': 'That deck has no cards yet.',
    'not-found': 'That deck is gone.',
    'already-running': 'A session is already running.',
    'not-running': 'No session is running.',
  } as Readonly<Record<string, string>>,
  failed: 'That did not work. Open BarkStudy for details.',
} as const;
