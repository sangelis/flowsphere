#!/usr/bin/env node
/**
 * Hermetic mock "client" for command-node tests.
 * Prints configurable output and exits with a configurable code, so tests
 * exercise lib/command-runner.js without depending on Python being installed.
 *
 * Flags:
 *   --status <n>     Include {"status": n} in the JSON output
 *   --answer <s>     Include {"answer": s} in the JSON output
 *   --echo-env <K>   Include {"env": {K: process.env[K] || null}} (test env passing)
 *   --exit <n>       Exit with code n (default 0)
 *   --stderr <s>     Write s to stderr
 *   --stdout <s>     Write raw s to stdout verbatim (overrides JSON output)
 *   --no-json        Print plain (non-JSON) text to stdout
 *   --sleep <ms>     Wait ms before emitting (test timeout)
 *   --flood          Write 11 MB to stdout (test the output cap)
 *   --unicode <n>    Emit {"status":200,"answer": "😀漢字é" repeated n times} as JSON
 *                    (large multibyte payload to test chunk-boundary decoding)
 *
 * In JSON mode the output always includes {"cwd": process.cwd()} so cwd can be asserted.
 */
const args = process.argv.slice(2);
const getFlag = (name) => {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : undefined;
};
const hasFlag = (name) => args.indexOf(name) !== -1;

const exitCode = getFlag('--exit') !== undefined ? parseInt(getFlag('--exit'), 10) : 0;
const stderrText = getFlag('--stderr');
const sleepMs = getFlag('--sleep') !== undefined ? parseInt(getFlag('--sleep'), 10) : 0;

function emit() {
  if (stderrText) process.stderr.write(stderrText);

  if (hasFlag('--flood')) {
    const block = 'x'.repeat(1024 * 1024); // 1 MB
    for (let i = 0; i < 11; i++) process.stdout.write(block);
    process.exit(exitCode);
    return;
  }

  const rawStdout = getFlag('--stdout');
  if (rawStdout !== undefined) {
    process.stdout.write(rawStdout);
    process.exit(exitCode);
    return;
  }

  const unicodeCount = getFlag('--unicode');
  if (unicodeCount !== undefined) {
    const answer = '😀漢字é'.repeat(parseInt(unicodeCount, 10));
    process.stdout.write(JSON.stringify({ status: 200, answer }));
    process.exit(exitCode);
    return;
  }

  if (hasFlag('--no-json')) {
    process.stdout.write('plain text output, not json\n');
    process.exit(exitCode);
    return;
  }

  const out = { cwd: process.cwd() };
  if (getFlag('--status') !== undefined) out.status = parseInt(getFlag('--status'), 10);
  if (getFlag('--answer') !== undefined) out.answer = getFlag('--answer');
  const echoEnv = getFlag('--echo-env');
  if (echoEnv !== undefined) out.env = { [echoEnv]: process.env[echoEnv] || null };
  process.stdout.write(JSON.stringify(out));
  process.exit(exitCode);
}

if (sleepMs > 0) setTimeout(emit, sleepMs);
else emit();
