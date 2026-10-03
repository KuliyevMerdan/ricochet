# Rule fixtures

These files are **deliberately illegal**. They exist so that [`tests/`](../../tests) can prove the
project's structural rules actually fire — a rule nobody has seen fail is a rule you are trusting,
not enforcing. `pnpm lint:boundaries` scanning the real workspace and finding nothing tells you
nothing on its own; these are the other half.

| Fixture | Proves | Enforced by |
| --- | --- | --- |
| `packages/bots/src/illegal-sim.ts` | a bot sees a snapshot, never the world — S0's "Done when" | [`.dependency-cruiser.cjs`](../../.dependency-cruiser.cjs) |
| `packages/renderer/src/illegal-protocol.ts` | the renderer draws pictures, not messages — S0's "Done when" | `.dependency-cruiser.cjs` |
| `packages/sim/src/inexact.ts` | `sim` cannot call `Math.sin` — S0's "Done when" — while `Math.sqrt` stays legal | [`eslint.config.mjs`](../../eslint.config.mjs) |
| `packages/geom/src/inexact.ts` | the same exactness in `geom` | `eslint.config.mjs` |
| `packages/protocol/src/inexact.ts` | (legal) exactness holds `geom` and `sim` only | `eslint.config.mjs` |
| `packages/sim/src/illegal-netcode.ts` | the world knows nothing of a client | `.dependency-cruiser.cjs` |
| `packages/sim/src/illegal-phaser.ts` | the world's physics is `sim`'s, not Phaser's | `.dependency-cruiser.cjs` |
| `packages/sim/src/illegal-fs.ts` | no package imports a Node builtin | `.dependency-cruiser.cjs` |
| `packages/sim/src/illegal-deep-import.ts` | a unit is reached through its entry point, never its `src/` | `.dependency-cruiser.cjs` |
| `packages/netcode/src/illegal-ws.ts` | no package imports a server library — `netcode` is handed its socket | `.dependency-cruiser.cjs` |
| `packages/netcode/src/illegal-react.ts` | there is no React in this repository | `.dependency-cruiser.cjs` |
| `packages/geom/src/illegal-{slots,crash,blackjack}-{package,path}.ts` | nothing from the sibling projects, by package name or relative path | `.dependency-cruiser.cjs` |
| `apps/web/src/illegal-sim.ts` | the page predicts through `netcode`, never a world of its own | `.dependency-cruiser.cjs` |
| `apps/server/src/illegal-web.ts` | nothing imports an app | `.dependency-cruiser.cjs` |
| `apps/server/src/illegal-phaser.ts` | the server draws nothing | `.dependency-cruiser.cjs` |
| `tools/bench/src/illegal-server.ts` | the bench measures the sim, not the server | `.dependency-cruiser.cjs` |
| `tools/load/src/illegal-sim.ts` | the load tool plays over the wire, as a client does | `.dependency-cruiser.cjs` |
| `packages/{renderer,bots,sim,netcode}/src/legal.ts`, `apps/{web,server}/src/legal.ts` | each allow-list, and Phaser, `fastify` and `ws` where they belong, is *not* flagged | `.dependency-cruiser.cjs` |
| `packages/{geom,protocol,sim,bots}/src/impure.ts` | each pure package is held to the purity rules | `eslint.config.mjs` |
| `packages/geom/src/unsafe.ts` | no `any`, no `!`, no `as` in source — and `as const` stays legal | `eslint.config.mjs` |
| `packages/protocol/src/index.ts` | (legal) the target the deep-import fixture reaches into | — |

They are excluded from TypeScript and ESLint in normal runs, and `pnpm lint:boundaries` scans only
`packages/`, `apps/` and `tools/`. Nothing here is compiled or shipped. The paths mirror the real
workspace because both rule sets match on path.

The sibling path fixtures point at modules that do not exist, on purpose: they must resolve the same
way on a machine with `../slots`, `../crash` and `../blackjack` checked out beside this one and on
CI, where they are not.
