'use strict';

const crypto = require('crypto');

// ── Configuration ──

const ENABLED_ITERS = 50000;
const DISABLED_ITERS = 2000000;
const WARMUP_ITERS = 5000;
const SAMPLE_RUNS = 7;

// ── Helpers ──

function median(values) {
	const sorted = values.slice().sort((a, b) => a - b);
	const mid = sorted.length >> 1;
	return sorted.length & 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function hashString(str) {
	return crypto.createHash('sha256').update(str).digest('hex').slice(0, 16);
}

function clearDebugCache() {
	[
		require.resolve('../src'),
		require.resolve('../src/common'),
		require.resolve('../src/node'),
	].forEach(function (key) {
		delete require.cache[key];
	});
}

function freshDebug(enablePattern) {
	clearDebugCache();
	delete process.env.DEBUG;
	var debug = require('../src');
	debug.enable(enablePattern);
	return debug;
}

// ── Workload A: Enabled path (primary metric) ──
//
// Exercises the hot path when debug logging is active:
// timestamp diff, coerce, format-string regex, formatter dispatch (%s, %d, %O, %o),
// array splice for inlined formatters, formatArgs (color codes, split/join for
// multiline, ms.humanize), and final log dispatch.
//
// This is the primary optimization target because:
// 1. It exercises every line of the enabled path in common.js and node.js
// 2. Format string processing and formatArgs are the dominant costs
// 3. Real applications that enable debug logging care about this throughput
//
// Workload mixes: plain strings, %s/%d substitution, %O object inspection,
// and multiline messages — all patterns seen in real debug usage.

function fingerprintEnabled() {
	process.env.DEBUG_COLORS = '0';
	process.env.DEBUG_HIDE_DATE = '1';
	var debug = freshDebug('bench:*');
	var log = debug('bench:fp');

	var captured = [];
	log.log = function () {
		var parts = [];
		for (var i = 0; i < arguments.length; i++) {
			parts.push(String(arguments[i]));
		}
		captured.push(parts.join('|'));
	};

	log('simple message');
	log('format %s num %d', 'hello', 42);
	log('inspect %O', {a: 1, b: [2, 3]});
	log('compact %o', {x: 'y'});
	log('multi\nline');
	log('escaped %%');

	return hashString(captured.join('\n'));
}

function benchEnabled() {
	process.env.DEBUG_COLORS = '1';
	process.env.DEBUG_HIDE_DATE = '1';
	var debug = freshDebug('bench:*');
	var log = debug('bench:hot');
	log.log = function () {};

	var obj = {status: 200, headers: {type: 'json'}};

	for (var i = 0; i < WARMUP_ITERS; i++) {
		log('warmup %s', 'x');
	}

	var samples = [];
	for (var r = 0; r < SAMPLE_RUNS; r++) {
		var t = process.hrtime();
		for (var j = 0; j < ENABLED_ITERS; j++) {
			log('simple string message');
			log('request %s took %dms', '/api/users', 42);
			log('result %O', obj);
			log('line1\nline2\nline3');
		}
		var d = process.hrtime(t);
		samples.push(d[0] * 1e3 + d[1] / 1e6);
	}

	return {
		median: median(samples),
		min: Math.min.apply(null, samples),
		max: Math.max.apply(null, samples),
	};
}

// ── Workload B: Disabled path (guard metric) ──
//
// Exercises the production-common case where DEBUG is not set or does not match
// the calling namespace. Most Node.js applications import debug but never enable
// it in production. The overhead of a disabled debug() call is:
// 1. Spread args into the ...args rest parameter
// 2. Read the `enabled` getter (property access, closure variable check)
// 3. Early return
//
// This is the guard metric because:
// - In production, debug() calls vastly outnumber enabled ones
// - Even tiny per-call overhead matters at millions of calls/sec
// - Regressions here affect every debug consumer in production

function fingerprintDisabled() {
	var debug = freshDebug('unmatched');
	var log = debug('bench:guard');

	var calls = 0;
	log.log = function () {
		calls++;
	};

	log('a');
	log('b %s', 'c');
	log('d %O', {e: 1});

	return hashString('disabled:' + calls);
}

function benchDisabled() {
	var debug = freshDebug('unmatched');
	var log = debug('bench:cold');

	for (var i = 0; i < WARMUP_ITERS; i++) {
		log('warmup %s', 'x');
	}

	var samples = [];
	for (var r = 0; r < SAMPLE_RUNS; r++) {
		var t = process.hrtime();
		for (var j = 0; j < DISABLED_ITERS; j++) {
			log('request %s took %dms', '/api/users', 42);
		}
		var d = process.hrtime(t);
		samples.push(d[0] * 1e3 + d[1] / 1e6);
	}

	return {
		median: median(samples),
		min: Math.min.apply(null, samples),
		max: Math.max.apply(null, samples),
	};
}

// ── Main ──

var fpEnabled = fingerprintEnabled();
var fpDisabled = fingerprintDisabled();

var primary = benchEnabled();
var guard = benchDisabled();

var calls_a = 4 * ENABLED_ITERS;
var calls_b = DISABLED_ITERS;

console.log('--- Workload A: Enabled path (primary) ---');
console.log('ITERATIONS: ' + ENABLED_ITERS);
console.log('CALLS_PER_ITER: 4');
console.log('TOTAL_CALLS: ' + calls_a);
console.log('PRIMARY_MS: ' + primary.median.toFixed(2));
console.log('PRIMARY_MIN: ' + primary.min.toFixed(2));
console.log('PRIMARY_MAX: ' + primary.max.toFixed(2));
console.log('FINGERPRINT_A: ' + fpEnabled);
console.log('');
console.log('--- Workload B: Disabled path (guard) ---');
console.log('ITERATIONS: ' + DISABLED_ITERS);
console.log('GUARD_MS: ' + guard.median.toFixed(2));
console.log('GUARD_MIN: ' + guard.min.toFixed(2));
console.log('GUARD_MAX: ' + guard.max.toFixed(2));
console.log('FINGERPRINT_B: ' + fpDisabled);
console.log('');
console.log('METRIC: ' + primary.median.toFixed(2));
