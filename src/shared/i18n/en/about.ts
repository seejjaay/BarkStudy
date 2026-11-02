import type { LinkId } from '../../control';

/** The About page. */
export const ABOUT = {
  title: 'About BarkStudy',
  version: (v: string) => `BarkStudy ${v}`,
  blurb: 'A study companion for Windows. Pandesal walks along your windows, quizzes you from your own flashcards with spaced repetition, and escalates, politely, when you ignore him.',
  license: 'Free and open source under the MIT license.',
  links: { repo: 'Project page on GitHub', releases: 'Releases', license: 'License', privacy: 'Privacy', 'new-issue': 'Report a bug' } satisfies Record<LinkId, string>,
  setupTitle: 'Setup',
  setupHint: 'Walk through the first-run screens again: personality, the way to stop him, privacy and the starter deck.',
  setupAgain: 'Run setup again',
  setupWhileRunning: 'Finish or end the running session first.',
  problemTitle: 'Something wrong?',
  problemHint: 'Copy the diagnostics, then report the bug on GitHub and paste them into the report. You get to read them before anything is copied.',
  copyDiagnostics: 'Copy diagnostics…',
  diagnosticsTitle: 'Diagnostics',
  diagnosticsLabel: 'Diagnostics to paste into a bug report',
  diagnosticsNote:
    "This is exactly what gets copied: versions, counts, a few recent problems and a log of what Pandesal did. It holds no card text, deck names, topics or app names, and your name and folders are replaced.",
  copy: 'Copy',
  copied: 'Diagnostics copied. Paste them into your bug report.',
  loading: 'Gathering diagnostics…',
  loadFailed: "Couldn't gather the diagnostics.",
} as const;
