import type { LinkId } from '../../control';

/** The About page. */
export const ABOUT = {
  title: 'About BarkStudy',
  version: (v: string) => `BarkStudy ${v}`,
  blurb: 'A study companion for Windows. Pandesal walks along your windows, quizzes you from your own flashcards with spaced repetition, and escalates, politely, when you ignore him.',
  license: 'Free and open source under the MIT license.',
  links: { repo: 'Project page on GitHub', releases: 'Releases', license: 'License' } satisfies Record<LinkId, string>,
  setupTitle: 'Setup',
  setupHint: 'Walk through the first-run screens again: personality, the way to stop him, privacy and the starter deck.',
  setupAgain: 'Run setup again',
} as const;
