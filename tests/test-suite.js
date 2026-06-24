#!/usr/bin/env node
/**
 * Runs the non-interactive unit test files. Exits non-zero if any fail.
 */
const { execFileSync } = require('child_process');
const path = require('path');

const tests = [
  'command-runner.test.js',
  'executor-dispatch.test.js',
  'executor-command.test.js',
  'config-validator-command.test.js',
  'runsequence-command.test.js'
];

let failed = 0;
for (const t of tests) {
  const file = path.join(__dirname, t);
  console.log(`\n=== Running ${t} ===`);
  try {
    execFileSync(process.execPath, [file], { stdio: 'inherit' });
  } catch (e) {
    failed++;
    console.error(`✗ ${t} FAILED`);
  }
}

if (failed > 0) {
  console.error(`\n${failed} test file(s) failed`);
  process.exit(1);
}
console.log('\n✓ All test files passed');
