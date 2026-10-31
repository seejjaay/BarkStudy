/**
 * Pandesal's starter deck, so a first session works straight away. It goes through the same parser as any import:
 * one "front,back" card per line. Half teaches the app, half is light trivia with short answers that are quick to type.
 */
export const SAMPLE_DECK = {
  name: "Pandesal's starter deck",
  text: [
    'What ends zoomies or a dig-in at once?,Esc',
    'What does Pandesal earn for a correct answer?,A treat',
    "What is the name for Pandesal's lap-running fit?,Zoomies",
    'Where are your decks and history stored?,On your PC',
    'Does answering calm Pandesal down or wind him up?,Calm him down',
    'What is the capital of the Philippines?,Manila',
    'What is 7 x 8?,56',
    'What is the chemical symbol for water?,H2O',
    'What is the largest planet in the solar system?,Jupiter',
    'How many continents are there?,7',
    'Who wrote Noli Me Tangere?,Jose Rizal',
    'What is the opposite of north?,South',
  ].join('\n'),
} as const;
