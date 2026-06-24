const assert = require('assert');
const fs = require('fs');
const path = require('path');

// The bundled command fixtures use relative paths ("node tests/fixtures/mock-client.js"),
// so resolve them deterministically against the repo root regardless of the invoking cwd.
const REPO_ROOT = path.join(__dirname, '..');
process.chdir(REPO_ROOT);

const { runSequence } = require('../lib/executor');

const MOCK = path.join(__dirname, 'fixtures', 'mock-client.js');
const NODE = process.execPath;

function withTempConfig(config, fn) {
  const tmp = path.join(__dirname, `.tmp-cmdint-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(tmp, JSON.stringify(config));
  return Promise.resolve(fn(tmp)).finally(() => fs.unlinkSync(tmp));
}

async function run() {
  // --- Fixture: basic command node passes ---
  let r = await runSequence(path.join(__dirname, 'config-test-command-basic.json'), {});
  assert.strictEqual(r.success, true, 'basic: succeeds');
  assert.strictEqual(r.stepsExecuted, 1, 'basic: one step executed');
  assert.strictEqual(r.stepsFailed, 0, 'basic: nothing failed');

  // --- Fixture: command -> command chaining via {{ .responses.<id>.json.* }} ---
  r = await runSequence(path.join(__dirname, 'config-test-command-chaining.json'), {});
  assert.strictEqual(r.success, true, 'chaining: succeeds');
  assert.strictEqual(r.stepsExecuted, 2, 'chaining: both steps executed');
  const used = r.executionLog.find((e) => e.id === 'use-token');
  assert.ok(used, 'chaining: use-token entry exists');
  assert.strictEqual(used.response.body.json.received, 'abc123',
    'chaining: second command received the first command\'s parsed json value');

  // --- Fixture: condition gating on a command node's parsed output (true -> runs) ---
  r = await runSequence(path.join(__dirname, 'config-test-command-condition.json'), {});
  assert.strictEqual(r.success, true, 'condition+: succeeds');
  assert.strictEqual(r.stepsExecuted, 2, 'condition+: gated step ran when premium == true');
  assert.strictEqual(r.stepsSkipped, 0, 'condition+: nothing skipped');

  // --- Condition gating (false -> skipped) ---
  await withTempConfig({
    nodes: [
      {
        id: 'probe', name: 'Probe', type: 'command', command: NODE,
        args: [MOCK, '--stdout', '{"status":200,"premium":false}']
      },
      {
        id: 'premium-only', name: 'Premium only', type: 'command', command: NODE,
        args: [MOCK, '--status', '200'],
        conditions: [{ node: 'probe', field: '.json.premium', equals: 'true' }]
      }
    ]
  }, async (tmp) => {
    const res = await runSequence(tmp, {});
    assert.strictEqual(res.success, true, 'condition-: sequence still succeeds');
    assert.strictEqual(res.stepsExecuted, 1, 'condition-: only the probe executed');
    assert.strictEqual(res.stepsSkipped, 1, 'condition-: gated step skipped when premium == false');
    const skipped = res.executionLog.find((e) => e.id === 'premium-only');
    assert.ok(skipped && skipped.status === 'skipped', 'condition-: gated step logged as skipped');
  });

  // --- Failure path: a failing command node stops the sequence and masks env in the log ---
  await withTempConfig({
    nodes: [
      {
        id: 'will-fail', name: 'Fails validation', type: 'command', command: NODE,
        args: [MOCK, '--status', '200', '--answer', 'actual'],
        env: { SECRET: 'topsecret' },
        validations: [{ jsonpath: '.json.answer', equals: 'expected' }]
      },
      {
        id: 'should-not-run', name: 'Should never execute', type: 'command', command: NODE,
        args: [MOCK, '--status', '200']
      }
    ]
  }, async (tmp) => {
    const res = await runSequence(tmp, {});
    assert.strictEqual(res.success, false, 'failure: sequence reports failure');
    assert.strictEqual(res.stepsFailed, 1, 'failure: one step failed');
    assert.strictEqual(res.stepsExecuted, 0, 'failure: failing step not counted as executed');

    const failed = res.executionLog.find((e) => e.id === 'will-fail');
    assert.ok(failed, 'failure: failed step logged');
    assert.strictEqual(failed.status, 'failed', 'failure: status is failed');
    assert.strictEqual(failed.type, 'command', 'failure: type is command');

    // The sequence must stop — the second node must not appear in the log.
    assert.ok(!res.executionLog.some((e) => e.id === 'should-not-run'),
      'failure: subsequent step did not run');

    // Env must be masked on the failure path; no raw secret may leak into the log.
    assert.strictEqual(failed.request.env.SECRET, '***', 'failure: env masked in failed log entry');
    assert.ok(!JSON.stringify(res.executionLog).includes('topsecret'),
      'failure: raw env secret does not leak anywhere in the execution log');
  });

  console.log('command-integration.test.js: all assertions passed');
}

run().catch((err) => { console.error('FAIL:', err.message); process.exit(1); });
