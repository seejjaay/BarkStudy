/**
 * Pandesal's words, keyed by the line keys the engine emits (src/engine/lines.ts). The dog is male, so a pronoun for
 * himself is "I/me/my" and nothing else. Guilt lines take a `{minutes}` param. Short, first person, warm and never nagging.
 */
export const EN: Record<string, string> = {
  // Wandering and resting
  'line.idleWander.1': 'Just sniffing around.',
  'line.idleWander.2': 'Wandering. Wandering is good.',
  'line.idleWander.3': 'Smells like a good day.',
  'line.nap.1': 'Zzz… five more minutes.',
  'line.nap.2': "Napping. Wake me if there's a treat.",
  'line.nap.3': '*yawn* Just resting my eyes.',

  // Bringing and repeating the question
  'line.showCard.1': 'I brought you a question!',
  'line.showCard.2': 'Psst. I got a card for you.',
  'line.showCard.3': 'Look what I found. Can you answer it?',
  'line.reAsk.1': 'Hey, that one is still open.',
  'line.reAsk.2': 'Remember this one?',
  'line.reAsk.3': 'Want to try that again?',

  // Getting your attention
  'line.followCursor.1': 'Wait for me!',
  'line.followCursor.2': "I'm right behind you.",
  'line.followCursor.3': 'Where are we going?',
  'line.whine.1': 'Hey… are you there?',
  'line.whine.2': "*whine* I'm getting lonely.",
  'line.whine.3': 'Psst. Down here. Still waiting.',
  'line.laps.1': "Zoomies! I can't help it!",
  'line.laps.2': 'Round and round we go!',
  'line.laps.3': 'So much energy! Running laps!',
  'line.digIn.1': "I'm digging in until you answer.",
  'line.digIn.2': 'Dig dig dig. Not moving.',
  'line.digIn.3': 'This is my spot now.',

  // Reacting to an answer
  'line.celebrateSmall.1': 'Good job! Tail wag!',
  'line.celebrateSmall.2': 'Yes! You got it.',
  'line.celebrateSmall.3': 'Nice one!',
  'line.celebrateBig.1': 'Amazing! Best human ever!',
  'line.celebrateBig.2': "You did it! I'm so proud!",
  'line.celebrateBig.3': 'Woo! Treat party!',
  'line.calm.1': "It's okay. We'll get it next time.",
  'line.calm.2': 'No worries. Mistakes help us learn.',
  'line.calm.3': "That's alright. I still think you're great.",

  // Sulking, curling up and staying put
  'line.sulk.1': "Hmph. I'll just sit here.",
  'line.sulk.2': "I'm not sulking. Okay, a little.",
  'line.sulk.3': "Fine. I'll stare at the wall.",
  'line.curlUp.1': "I'll curl up and wait.",
  'line.curlUp.2': 'Making myself small. Take your time.',
  'line.curlUp.3': "Quiet now. I'll be here.",
  'line.sitStay.1': 'Staying. Good boy, right?',
  'line.sitStay.2': "Sit. Stay. I'm good at this.",
  'line.sitStay.3': "I'll stay right here.",

  // Coming back
  'line.greetReturn.1': "You're back! You're back!",
  'line.greetReturn.2': 'I missed you! Welcome back!',
  'line.greetReturn.3': 'There you are! Tail wag!',

  // Gentle guilt about the wait
  'line.guilt.1': 'That took {minutes} minutes. I waited the whole time.',
  'line.guilt.2': '{minutes} minutes! I counted every one.',
  'line.guilt.3': 'I waited {minutes} minutes for you. Glad you came.',
  'line.lastGuilt.1': 'Last time you left me for {minutes} minutes. Not this time, okay?',
  'line.lastGuilt.2': 'You were gone {minutes} minutes last time. I remember.',
  'line.lastGuilt.3': "I'm glad you're back. Last time it was {minutes} minutes!",
};

/** The text for a line key with `{name}` placeholders filled from `params`, or null for a key that has no text. */
export function say(key: string, params?: Record<string, number>): string | null {
  if (!Object.hasOwn(EN, key)) return null;
  const text = EN[key] as string;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = params?.[name];
    return value === undefined ? whole : String(value);
  });
}

// The control window and tray words, one module per screen. Pandesal's own lines stay above.
export { COMMON, plural } from './en/common';
export { STUDY } from './en/study';
export { DECKS } from './en/decks';
export { HISTORY } from './en/history';
export { SETTINGS } from './en/settings';
export { ONBOARDING } from './en/onboarding';
export { ABOUT } from './en/about';
export { TRAY } from './en/tray';
