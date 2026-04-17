# Evaluation

This is the evaluation setup. It tells agents and reviewers how to set up, run experiments, and measure results. Both experimenters and reviewers follow the same instructions.

This file is the trust boundary. The evaluation code it references is outside the editable surface. Agents cannot change how they are judged.

The maintainer writes this file. It rarely changes.

## Setup

One-time setup from the repository root:

```bash
npm install
```

Verify the benchmark runs correctly:

```bash
node .polyresearch/bench.js
```

You should see output with `PRIMARY_MS:`, `GUARD_MS:`, and `METRIC:` lines.

Verify the test suite passes:

```bash
npx mocha test.js test.node.js
```

All 16 tests must pass.

Verify the linter passes:

```bash
node -r ./xo-compat.js node_modules/.bin/xo src/common.js src/node.js src/index.js
```

Warnings are acceptable; errors are not.

## Running an experiment

From the worktree root (which contains your modified `src/` files):

```bash
node .polyresearch/bench.js > run.log 2>&1
```

Then run the test suite and linter:

```bash
npx mocha test.js test.node.js > test.log 2>&1
node -r ./xo-compat.js node_modules/.bin/xo src/common.js src/node.js src/index.js > lint.log 2>&1
```

**All three must succeed.** A performance improvement that breaks tests or lint is rejected.

### Workload A: Enabled path (primary metric)

1. Creates a debug instance with namespace matching `bench:*`.
2. Colors enabled, `hideDate` set (to avoid variable `getDate()` overhead).
3. Runs 5,000 warmup calls (discarded).
4. Runs 7 sample runs of 50,000 iterations. Each iteration makes 4 debug calls:
   - Plain string: `log('simple string message')`
   - Format substitution: `log('request %s took %dms', '/api/users', 42)`
   - Object inspection: `log('result %O', obj)`
   - Multiline: `log('line1\nline2\nline3')`
5. Reports the **median** of the 7 sample runs as `PRIMARY_MS`.
6. Computes a SHA-256 fingerprint of captured output to verify correctness.

### Workload B: Disabled path (guard metric)

1. Creates a debug instance with namespace `bench:cold` while `DEBUG` is set to `unmatched`.
2. Runs 5,000 warmup calls (discarded).
3. Runs 7 sample runs of 2,000,000 calls each: `log('request %s took %dms', '/api/users', 42)`.
4. Reports the **median** of the 7 sample runs as `GUARD_MS`.
5. Computes a SHA-256 fingerprint to verify no output was produced.

### Primary metric

The primary metric reported as `METRIC:` is equal to `PRIMARY_MS`. This is the number that determines whether an experiment is an improvement.

The guard metric `GUARD_MS` is checked separately: it must not regress by more than 3 ms.

## Output format

A successful run prints this structure:

```
--- Workload A: Enabled path (primary) ---
ITERATIONS: 50000
CALLS_PER_ITER: 4
TOTAL_CALLS: 200000
PRIMARY_MS: 114.26
PRIMARY_MIN: 112.22
PRIMARY_MAX: 118.49
FINGERPRINT_A: 1990ffa01cb11326

--- Workload B: Disabled path (guard) ---
ITERATIONS: 2000000
GUARD_MS: 25.13
GUARD_MIN: 24.53
GUARD_MAX: 25.32
FINGERPRINT_B: 4ac7e68fb1172f4b

METRIC: 114.26
```

- `PRIMARY_MS` is the median enabled-path time in milliseconds (primary metric).
- `GUARD_MS` is the median disabled-path time in milliseconds (guard metric).
- `METRIC` equals `PRIMARY_MS` (the acceptance criterion).
- `FINGERPRINT_A` must remain `1990ffa01cb11326`.
- `FINGERPRINT_B` must remain `4ac7e68fb1172f4b`.

If either fingerprint changes, the experiment is rejected regardless of speed improvement.

## Parsing the metric

```bash
grep '^METRIC:' run.log | awk '{print $2}'
```

This produces a single number on stdout: the primary metric in milliseconds.

To inspect both metrics:

```bash
grep '^PRIMARY_MS:' run.log | awk '{print $2}'
grep '^GUARD_MS:' run.log | awk '{print $2}'
```

## Verifying tests

```bash
npx mocha test.js test.node.js 2>&1 | tail -3
```

Expected output includes `16 passing` and no failures. If any test fails, the experiment is rejected.

## Verifying lint

```bash
node -r ./xo-compat.js node_modules/.bin/xo src/common.js src/node.js src/index.js 2>&1
```

Only warnings (⚠) are acceptable. Any errors (✖) mean the experiment is rejected.

## Ground truth

**Workload A:** Median wall-clock time of 200,000 enabled debug calls over 7 sample runs. Correctness enforced by SHA-256 fingerprint of captured output.

**Workload B:** Median wall-clock time of 2,000,000 disabled debug calls over 7 sample runs. Correctness enforced by SHA-256 fingerprint verifying no output was produced.

**Test suite:** All 16 existing mocha tests must pass.

**Lint:** xo linter must produce no errors on editable source files.

The evaluation cannot be gamed by modifying the benchmark, the test files, or the lint config — all are outside the editable surface.

## Environment

- **Runtime:** Node.js (project requires `>= 6.0`, benchmark uses `process.hrtime` available since Node 0.9.3).
- **Hardware:** Results are relative. The benchmark uses medians over 7 runs to reduce noise. Improvements of less than 3 ms on the primary metric may be within measurement variance and will not be accepted.
- **Expected wall time:** A full benchmark run takes approximately 10-20 seconds.
- **Kill threshold:** If a run exceeds 60 seconds, kill it and record as `crashed`.
