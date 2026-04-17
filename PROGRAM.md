# Research program

This is the research playbook. It tells agents what to optimize, what they can touch, and what constraints to respect. Read this before every experiment.

The maintainer writes and edits this file. When the research direction shifts, update this file. Contributors pick up the change on their next session start.

required_confirmations: 0
metric_tolerance: 3
metric_direction: lower_is_better
lead_github_login: alanzabihi
maintainer_github_login: alanzabihi
auto_approve: true
assignment_timeout: 24h
review_timeout: 12h
min_queue_depth: 5
max_queue_depth: 10

## Goal

Reduce the wall-clock time of the `debug` module's **enabled logging path**, measured in milliseconds. The primary metric is median time to execute 200,000 enabled debug calls (50,000 iterations x 4 call types). Lower is better.

### Workloads

- **Workload A — Enabled path (primary):** 50,000 iterations of 4 debug calls each (plain string, `%s`/`%d` substitution, `%O` object inspection, multiline message) with colors enabled and `hideDate` set. Exercises the full hot path: timestamp diff, coerce, format-string regex, formatter dispatch, `args.splice`, `formatArgs` (ANSI color codes, `split('\n').join`, `ms.humanize`), and log dispatch. **This is the primary optimization target.**
- **Workload B — Disabled path (guard):** 2,000,000 calls to a debug instance whose namespace does not match `DEBUG`. Exercises only the `enabled` getter (closure variable check) and early return. **This is the guard metric — it may not regress beyond 3 ms.**

### Why this split

The disabled path is the production-common case. Most Node.js applications import `debug` but run with `DEBUG` unset. The overhead of a disabled `debug()` call affects every consumer in production. It is already near-minimal (~25ms for 2M calls ≈ 12.5ns/call), so it serves as a regression guard rather than an optimization target.

The enabled path is where all the CPU time is spent when logging is active. Format string processing, ANSI color formatting, `ms.humanize()`, and `split/join` for multiline messages dominate. This is where contributors should focus.

### Acceptance criteria

An improvement must reduce the primary metric (Workload A median) by at least **3 ms**. The guard metric (Workload B) may not regress by more than **3 ms** compared to its baseline.

## What you CAN modify

- `src/common.js` — core debug factory, format string processing, namespace matching, enabled getter
- `src/node.js` — Node.js-specific formatting, ANSI color codes, `getDate()`, `log()`, `formatters.o` / `formatters.O`

## What you CANNOT modify

- `.polyresearch/` — the reproducible environment (benchmark harness)
- `POLYRESEARCH.md` — the coordination protocol
- `PROGRAM.md` — this file
- `PREPARE.md` — the evaluation setup
- `results.tsv` — maintained by the lead on `main`
- `src/index.js` — platform detection entry point
- `src/browser.js` — browser implementation (out of scope)
- `test.js`, `test.node.js` — the test suite
- `node_modules/` — dependencies
- `package.json` — dependency manifest
- `xo-compat.js` — lint compatibility shim

## Constraints

1. **Correctness is non-negotiable.** Workload A must produce fingerprint `1990ffa01cb11326`. Workload B must produce fingerprint `4ac7e68fb1172f4b`. If either check fails, the experiment is rejected.
2. **Tests must pass.** Run the full mocha test suite (`npx mocha test.js test.node.js`). A change that breaks any existing test is rejected regardless of performance gain.
3. **Lint must pass.** Run `node -r ./xo-compat.js node_modules/.bin/xo src/common.js src/node.js src/index.js`. No new errors allowed (existing warnings are acceptable).
4. **No new dependencies.** Do not add, remove, or upgrade entries in `package.json`. The only production dependency is `ms@^2.1.3`. Optimize using existing code.
5. **Public API is frozen.** `debug(namespace)` returns a function. That function has `.enabled`, `.namespace`, `.color`, `.useColors`, `.extend()`, `.log`, `.destroy()`, `.diff`, `.prev`, `.curr`. The `enabled` property must remain a getter that responds to `debug.enable()`/`debug.disable()` calls and to manual `.enabled = true/false` overrides. All of this must keep working.
6. **Node >= 6.0 runtime floor.** The `engines` field requires Node 6+. Do not use APIs introduced after Node 6 (no `Object.entries`, no `String.prototype.replaceAll`, no optional chaining, no nullish coalescing, no `Array.prototype.flat`, no `BigInt`, etc.). ES6 features (arrow functions, `const`/`let`, template literals, destructuring, rest/spread, `for...of`) are safe.
7. **Expected run time.** A single benchmark invocation takes approximately 10-20 seconds depending on hardware. Kill and record as `crashed` if it exceeds 60 seconds.
8. **Guard metric constraint.** An optimization that improves Workload A but regresses Workload B by more than 3 ms will not be accepted.

## Strategy

The `debug` module processes output in this pipeline: **create instance → check enabled → format args → format for env → log**. Each stage has different optimization characteristics.

### Hot path analysis (enabled path)

1. **Timestamp diff** (`common.js:74-80`) — `Number(new Date())` allocates a Date object per call. `Date.now()` is faster and available since ES5.
2. **Format string regex** (`common.js:91-107`) — `args[0].replace(/%([a-zA-Z%])/g, callback)` runs a regex with a callback on every enabled call. The regex is recompiled each time. Pre-compiling or avoiding regex entirely for common patterns (no `%` in message) could help.
3. **Array splice in formatter loop** (`common.js:103`) — `args.splice(index, 1)` shifts remaining elements. For messages with multiple formatters, this is O(n) per formatter. Building a new array instead of mutating could be cheaper.
4. `**formatArgs` string operations** (`node.js:167-180`) — With colors: template literal for prefix, `split('\n').join('\n' + prefix)` for multiline, `ms.humanize()` for diff suffix. Without colors: `getDate()` + string concatenation.
5. `**ms.humanize()` per call** (`node.js:176`) — Called on every enabled log to format the diff. The `ms` library does number comparisons and string concatenation. For repeated similar diffs, caching could help.
6. `**split('\n').join('\n' + prefix)`** (`node.js:175`) — Splits and rejoins the formatted message. For single-line messages (the common case), this is wasted work.
7. `**formatters.o` split/map/join** (`node.js:248-253`) — `util.inspect(v).split('\n').map(str => str.trim()).join(' ')` creates multiple intermediate arrays. Could be replaced with a single regex.
8. `**coerce()` check** (`common.js:82, 272-277`) — `instanceof Error` check on every call. Cheap but runs before the string type check.

### Disabled path (guard)

The disabled path is already minimal: rest parameter collection (`...args`), property access on `debug.enabled` getter, closure variable check, return. The main cost is the `...args` spread which allocates an array. Avoiding the spread for disabled calls would require restructuring the function signature.

### Promising directions

- **Replace `Number(new Date())` with `Date.now()`** — eliminates object allocation.
- **Fast-path for format strings without `%`** — skip regex entirely for plain messages.
- **Pre-compile the format regex** — hoist `/%([a-zA-Z%])/g` to module scope.
- **Avoid `args.splice`** — build output array without mutation.
- **Short-circuit `split('\n').join` for single-line messages** — check for `\n` before splitting.
- **Cache `ms.humanize()` for repeated identical diffs** — diff is often 0ms for rapid calls.
- **Replace `split/map/join` in `formatters.o`** with a single `replace(/\n\s*/g, ' ')`.
- **Reduce string allocations in `formatArgs`** — pre-compute color prefix once per instance instead of per call.
- **Eliminate unnecessary property writes** — `self.diff`, `self.prev`, `self.curr` are set on every call but rarely read.

### What to avoid

- **Changing the `enabled` getter contract** — the getter must respond dynamically to `debug.enable()` changes and manual `.enabled = true/false` overrides. The caching via `namespacesCache`/`enabledCache` is already correct and must be preserved.
- **Removing format string support** — `%s`, `%d`, `%o`, `%O`, `%%` are documented API.
- **Changing output format** — the fingerprint captures exact output. Color codes, namespace prefix, `+Xms` suffix must remain identical.
- **Using Node > 6 APIs** — the `engines` field says `>= 6.0`. Stick to ES6.