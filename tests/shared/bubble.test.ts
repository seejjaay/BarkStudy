import { describe, expect, it } from 'vitest';
import { MAX_TYPED_ANSWER, feedbackFor, isSelfGrade, isTypedAnswer, selfGradeFeedback } from '../../src/shared/bubble';

describe('feedback', () => {
  it('names the result in words and shows the expected answer when it was not exact', () => {
    expect(feedbackFor('exact', 'Paris')).toEqual({ tone: 'right', text: 'Correct! Pandesal got a treat.' });
    expect(feedbackFor('fuzzy', 'Paris')).toEqual({ tone: 'close', text: 'Close enough. It is “Paris”.' });
    expect(feedbackFor('wrong', 'Paris')).toEqual({ tone: 'wrong', text: 'Not quite. It is “Paris”.' });
  });

  it('self-grading has its own wording', () => {
    expect(selfGradeFeedback('good').tone).toBe('right');
    expect(selfGradeFeedback('again').tone).toBe('wrong');
  });
});

describe('validators', () => {
  it('a typed answer is a string within the limit', () => {
    expect(isTypedAnswer('')).toBe(true);
    expect(isTypedAnswer('x'.repeat(MAX_TYPED_ANSWER))).toBe(true);
    expect(isTypedAnswer('x'.repeat(MAX_TYPED_ANSWER + 1))).toBe(false);
    expect(isTypedAnswer(7)).toBe(false);
    expect(isTypedAnswer(null)).toBe(false);
  });

  it('a self grade is good or again, nothing else', () => {
    expect(isSelfGrade('good')).toBe(true);
    expect(isSelfGrade('again')).toBe(true);
    expect(isSelfGrade('hard')).toBe(false);
    expect(isSelfGrade(undefined)).toBe(false);
  });
});
