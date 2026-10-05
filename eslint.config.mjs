// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

/**
 * The purity rules from CLAUDE.md, as lint rules.
 *
 * `geom`, `protocol`, `sim` and `bots` take time as a parameter and randomness as a seed. That is
 * what lets the client predict its own tank with the server's own `sim`, what lets `tools/bench`
 * step a thousand rooms through the code that serves the demo, and what keeps a world a unit test.
 * Ambient time or randomness anywhere in them destroys all three quietly — the tests keep passing,
 * they just stop meaning anything.
 */
const PURE_PACKAGES = ['geom', 'protocol', 'sim', 'bots'];

/**
 * The packages whose arithmetic must come out the same to the bit in every JavaScript engine: the
 * server's Node and the player's browser run `sim` on the same inputs, and a prediction that
 * disagrees with the server by one ulp is a correction on screen.
 *
 * `+ - * /` and `Math.sqrt` are IEEE 754 operations, correctly rounded everywhere. ECMAScript leaves
 * the transcendental functions *implementation-approximated* — V8, JavaScriptCore and SpiderMonkey
 * may each return a different last bit — so they are banned here, and a direction is a lookup in
 * `geom`'s table instead.
 */
const EXACT_PACKAGES = ['geom', 'sim'];

const APPROXIMATED = [
  'sin',
  'cos',
  'tan',
  'asin',
  'acos',
  'atan',
  'atan2',
  'sinh',
  'cosh',
  'tanh',
  'asinh',
  'acosh',
  'atanh',
  'exp',
  'expm1',
  'log',
  'log1p',
  'log2',
  'log10',
  'pow',
  'cbrt',
  'hypot',
];

const CLOCK =
  'Time is a parameter. Take it from the caller — ambient time makes prediction and replay impossible.';

const INEXACT =
  'Not specified to the bit — the browser and the server may disagree, and a prediction with it is a correction. Use geom’s direction table, or multiply.';

/** The rules every pure package is held to; the exact packages add theirs to the same list. */
const PURE_SYNTAX = [
  {
    selector: "CallExpression[callee.object.name='Math'][callee.property.name='random']",
    message: 'Randomness enters as a seed carried in the world, never from Math.random.',
  },
  {
    selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
    message: CLOCK,
  },
  {
    selector: "NewExpression[callee.name='Date'][arguments.length=0]",
    message: CLOCK,
  },
  {
    selector: "CallExpression[callee.object.name='performance'][callee.property.name='now']",
    message: CLOCK,
  },
  {
    selector: "CallExpression[callee.name='fetch']",
    message: 'No I/O in a pure package — the caller does it and hands in the result.',
  },
];

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/dist-perf/**',
      '**/node_modules/**',
      '**/.turbo/**',
      'config/fixtures/**', // deliberately illegal — see config/fixtures/README.md
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    // Tooling config that has to stay CommonJS (dependency-cruiser loads it with `require`).
    files: ['**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { module: 'writable', require: 'readonly', __dirname: 'readonly' },
    },
  },
  {
    // Browser measurement scripts: Node drives Playwright, and the functions handed to
    // `page.evaluate` run in the page — so both sets of globals are real here.
    files: ['apps/web/scripts/**/*.mjs'],
    languageOptions: {
      globals: Object.fromEntries(
        [
          'process',
          'console',
          'setTimeout',
          'setInterval',
          'clearInterval',
          'fetch',
          'window',
          'document',
          'performance',
          'requestAnimationFrame',
          'Event',
          'KeyboardEvent',
          'PointerEvent',
        ].map((name) => [name, 'readonly']),
      ),
    },
  },
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // CLAUDE.md § Other rules: no `any`, no non-null `!`, no `as` outside a parser boundary. Source
    // only — a test may assert its way to a fixture. Where a boundary genuinely needs one, it
    // carries an `eslint-disable-next-line` that says why. `as const` is not an assertion about a
    // value's type and stays allowed.
    files: ['**/{packages,apps,tools}/*/src/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/consistent-type-assertions': ['error', { assertionStyle: 'never' }],
    },
  },
  {
    // `**/` so the rule set also applies to config/fixtures/packages/… — the fixtures that prove
    // these rules fire (tests/purity.test.ts).
    files: [`**/packages/{${PURE_PACKAGES.join(',')}}/**/*.ts`],
    rules: {
      'no-restricted-syntax': ['error', ...PURE_SYNTAX],
      'no-restricted-globals': [
        'error',
        { name: 'window', message: 'A pure package runs in Node and the browser alike — no DOM.' },
        {
          name: 'document',
          message: 'A pure package runs in Node and the browser alike — no DOM.',
        },
        { name: 'localStorage', message: 'No storage in a pure package — it has no I/O.' },
        { name: 'process', message: 'No ambient config. What a pure package needs, it is handed.' },
      ],
    },
  },
  {
    // A later `no-restricted-syntax` replaces an earlier one for the same file, so the exact
    // packages restate the purity selectors and add theirs.
    // Tests are exempt: an oracle may compute with `Math.cos` what the code under test must not.
    files: [`**/packages/{${EXACT_PACKAGES.join(',')}}/**/*.ts`],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...PURE_SYNTAX,
        {
          selector: `CallExpression[callee.object.name='Math'][callee.property.name=/^(${APPROXIMATED.join('|')})$/]`,
          message: INEXACT,
        },
        {
          selector: "BinaryExpression[operator='**'], AssignmentExpression[operator='**=']",
          message: INEXACT,
        },
      ],
    },
  },
);
