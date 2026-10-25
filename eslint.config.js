import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['node_modules', 'dist', 'out', 'release', '.superpowers', 'coverage'] },
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
    // Plain CommonJS helper scripts run by hand under Node. `window` and `document` appear only inside Playwright page callbacks.
    files: ['scripts/**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { __dirname: 'readonly', require: 'readonly', process: 'readonly', console: 'readonly', setTimeout: 'readonly', window: 'readonly', document: 'readonly' },
    },
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
    files: ['src/engine/**/*.ts', 'src/shared/**/*.ts'],
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
  {
    // The overlay renderer is sandboxed: no Electron or Node imports; it talks to main through window.barkOverlay.
    files: ['src/renderer/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [{ name: 'electron', message: 'Renderers use the contextBridge API.' }],
          patterns: [{ group: ['node:*'], message: 'Renderers have no Node.' }],
        },
      ],
    },
  },
  {
    // A sandboxed preload can import only electron and bundled local modules.
    files: ['src/preload/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [{ group: ['node:*'], message: 'Sandboxed preloads have no Node.' }] }],
    },
  },
);
