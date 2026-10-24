import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['node_modules', 'dist', 'out', 'release', 'spike', '.superpowers', 'coverage'] },
  js.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    files: ['**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    // No Math.random anywhere in src/: randomness goes through src/engine/rng.ts.
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Use the seeded RNG in src/engine/rng.ts.' },
      ],
    },
  },
  {
    // The engine is pure: no Electron, React or Node. tsconfig.engine.json blocks DOM and Node types too.
    files: ['src/engine/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'electron', message: 'The engine must stay pure.' },
            { name: 'react', message: 'The engine must stay pure.' },
            { name: 'react-dom', message: 'The engine must stay pure.' },
          ],
          patterns: [
            { group: ['node:*'], message: 'The engine must stay pure.' },
            { group: ['react-dom/*', 'electron/*'], message: 'The engine must stay pure.' },
          ],
        },
      ],
    },
  },
);
