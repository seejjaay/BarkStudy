import { ruleStep } from '../../src/engine/rules';
import type { Level } from '../../src/engine/types';

type Step = typeof ruleStep;

/** Deliberately broken copies of the rule layer. The checker must catch each one. */
export const MUTANTS = {
  'wrong-answer-escalates': (s, e) => {
    const r = ruleStep(s, e);
    if (e.type === 'ANSWER_SUBMITTED' && !e.correct && s.card) {
      return { ...r, state: { ...r.state, level: Math.min(s.level + 1, s.cap) as Level } };
    }
    return r;
  },
  'dig-ignores-cooldown': (s, e) => {
    if (e.type !== 'CHECKIN_TIMEOUT') return ruleStep(s, e);
    const r = ruleStep({ ...s, digCooling: false }, e);
    return { ...r, state: { ...r.state, digCooling: s.digCooling } };
  },
  'esc-ignored': (s, e) => (e.type === 'ESC_PRESSED' ? { state: s, required: [], intents: [] } : ruleStep(s, e)),
  'cap-ignored': (s, e) => {
    if (e.type !== 'CHECKIN_TIMEOUT') return ruleStep(s, e);
    const r = ruleStep({ ...s, cap: 4 }, e);
    return { ...r, state: { ...r.state, cap: s.cap } };
  },
} satisfies Record<string, Step>;

export type MutantId = keyof typeof MUTANTS;
