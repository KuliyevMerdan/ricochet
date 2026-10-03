/**
 * The dependency graph in CLAUDE.md § Dependency rules, enforced.
 *
 * Every workspace unit has two spellings that must both be matched, because one that has not been
 * built yet cannot be resolved to a file: `packages/<name>/…` (resolved) and `@ricochet/<name>`
 * (unresolved). The leading `(\.\./)*` is what lets `config/fixtures/` prove these rules fire: a
 * cruise rooted there reports a unit as `../../packages/<name>/…`, and a rule that only matched the
 * unprefixed spelling would pass the fixtures for the wrong reason.
 */
const WORKSPACE = '^(\\.\\./)*((packages|apps|tools)/[^/]+/|@ricochet/[^/]+$)';

/** Matches only the named workspace units, in either spelling. */
const only = (...names) =>
  `^(\\.\\./)*((packages|apps|tools)/(${names.join('|')})/|@ricochet/(${names.join('|')})$)`;

const list = (names) => names.map((n) => `@ricochet/${n}`).join(', ') || '(nothing)';

/**
 * `from` a unit, `to` anywhere in the workspace that is not on its allow-list. A unit may always
 * reach its own modules; the rule is about what crosses a boundary.
 */
const mayOnlyDependOn = (where, name, ...allowed) => ({
  name: `${name}-deps`,
  comment: `@ricochet/${name} may only depend on: ${list(allowed)} — CLAUDE.md § Dependency rules.`,
  severity: 'error',
  from: { path: `^${where}/${name}/src/` },
  to: { path: WORKSPACE, pathNot: only(name, ...allowed) },
});

module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      comment: 'A cycle between units means the boundary is not real.',
      severity: 'error',
      from: {},
      to: { circular: true },
    },

    // The graph, one allow-list per unit.
    mayOnlyDependOn('packages', 'geom'),
    mayOnlyDependOn('packages', 'protocol', 'geom'),
    mayOnlyDependOn('packages', 'sim', 'protocol', 'geom'),
    /**
     * A bot sees exactly the snapshot a player is sent and acts only through inputs — so it cannot
     * see through a wall or move faster than a tank can. Its allow-list leaving out `sim` IS that
     * rule.
     */
    mayOnlyDependOn('packages', 'bots', 'protocol', 'geom'),
    mayOnlyDependOn('packages', 'netcode', 'sim', 'protocol', 'geom'),
    /**
     * `renderer` draws pictures and does not know what a snapshot is — the seam that lets the arena
     * be tested without a server. Its allow-list leaving out `protocol` IS that rule.
     */
    mayOnlyDependOn('packages', 'renderer', 'geom'),
    mayOnlyDependOn('apps', 'server', 'sim', 'bots', 'protocol', 'geom'),
    /**
     * The page predicts through `netcode`, which runs `sim` on the player's own inputs; it never
     * steps a world of its own. Its allow-list leaving out `sim` IS that rule.
     */
    mayOnlyDependOn('apps', 'web', 'netcode', 'renderer', 'protocol', 'geom'),
    mayOnlyDependOn('tools', 'bench', 'sim', 'bots', 'protocol', 'geom'),
    /** The load tool plays as a client does — through `netcode`, never a world of its own. */
    mayOnlyDependOn('tools', 'load', 'netcode', 'bots', 'protocol', 'geom'),

    // The hard rules on top of the graph.
    {
      name: 'phaser-stays-on-stage',
      comment:
        'Phaser belongs to the renderer and the web shell. The world’s physics is sim’s; Phaser draws, takes input, runs the camera and the sound (CLAUDE.md).',
      severity: 'error',
      from: { path: '^(packages|tools|apps/server)/', pathNot: '^packages/renderer/' },
      to: { path: '(^|/)phaser(/|$)' },
    },
    {
      name: 'no-react',
      comment:
        'No React anywhere: the shell is a name field, a scoreboard and an overlay — a framework would be the largest thing in it (CLAUDE.md § Packages).',
      severity: 'error',
      from: {},
      to: { path: '(^|/)(react|react-dom)(/|$)' },
    },
    {
      name: 'nothing-imports-apps',
      comment:
        'An app composes packages; nothing composes an app. Not a package, a tool, or the other app.',
      severity: 'error',
      from: { path: '^(packages|tools|apps)/([^/]+)/' },
      to: {
        path: '^(\\.\\./)*(apps/[^/]+/|@ricochet/(server|web)$)',
        pathNot: '^apps/$2/',
      },
    },
    {
      name: 'no-siblings',
      comment:
        'This repository is standalone: nothing from ../slots, ../crash or ../blackjack, by path or by package name. A "just this one type" copy is how standalone projects quietly become one.',
      severity: 'error',
      from: {},
      to: { path: '^(\\.\\./)+(slots|crash|blackjack)(/|$)|^@(slot|crash|blackjack)/' },
    },
    {
      name: 'packages-no-node-builtins',
      comment:
        'Every package runs in the browser or must be able to — sim and netcode predict in the page. Node belongs to apps/server and tools/*.',
      severity: 'error',
      from: { path: '^packages/' },
      to: { dependencyTypes: ['core'] },
    },
    {
      name: 'packages-no-server-libs',
      comment:
        'The HTTP framework, the socket server and the logger belong to apps/server. netcode is handed its socket; sim returns events and never sends them (CLAUDE.md).',
      severity: 'error',
      from: { path: '^packages/' },
      to: { path: '(^|/)(fastify|@fastify|ws|pino)(/|$)' },
    },
    {
      name: 'no-cross-package-deep-imports',
      comment:
        'Reach another unit through its entry point, never into its src/. A unit with a real public surface is a unit with a real boundary.',
      severity: 'error',
      from: { path: '^(packages|apps|tools)/([^/]+)/' },
      to: { path: '^(\\.\\./)*(packages|apps|tools)/[^/]+/src/', pathNot: '^$1/$2/' },
    },
  ],
  options: {
    /**
     * `doNotFollow` rather than `exclude` for `dist/`, and the difference is the whole enforcement: a
     * workspace import resolves to the target's built entry point, and excluding `dist` would delete
     * that edge — so an illegal import would be caught only while it was undeclared, and adding the
     * dependency to package.json (the normal way anyone introduces one) would silence the rule.
     */
    doNotFollow: { path: '(^|/)(node_modules|dist)(/|$)' },
    exclude: { path: '(^|/)\\.turbo(/|$)' },
    tsPreCompilationDeps: true,
    combinedDependencies: true,
  },
};
