const assert = require('assert');
const path = require('path');
const { executeCommand } = require('../lib/command-runner');

const MOCK = path.join(__dirname, 'fixtures', 'mock-client.js');
const NODE = process.execPath;

async function run() {
  // 1. Reported status is used as response.status; json parsed; exitCode captured
  let r = await executeCommand({ command: NODE, args: [MOCK, '--status', '429', '--answer', 'hi'] });
  assert.strictEqual(r.status, 429, '1: reported status used');
  assert.strictEqual(r.body.exitCode, 0, '1: exitCode captured');
  assert.strictEqual(r.body.json.answer, 'hi', '1: json parsed');
  assert.deepStrictEqual(r.headers, {}, '1: headers empty object');

  // 2. Non-JSON stdout -> json null, status from exit 0 -> 200
  r = await executeCommand({ command: NODE, args: [MOCK, '--no-json'] });
  assert.strictEqual(r.body.json, null, '2: json null on non-JSON');
  assert.strictEqual(r.status, 200, '2: exit 0 -> 200');

  // 3. Non-zero exit, no reported status -> 500, and does NOT throw
  r = await executeCommand({ command: NODE, args: [MOCK, '--no-json', '--exit', '3'] });
  assert.strictEqual(r.body.exitCode, 3, '3: exitCode 3');
  assert.strictEqual(r.status, 500, '3: non-zero exit -> 500');

  // 4. Custom statusFrom path
  r = await executeCommand({ command: NODE, args: [MOCK, '--stdout', '{"http":{"code":201}}'], statusFrom: '.http.code' });
  assert.strictEqual(r.status, 201, '4: custom statusFrom');

  // 5. stderr captured
  r = await executeCommand({ command: NODE, args: [MOCK, '--status', '200', '--stderr', 'some warning'] });
  assert.ok(r.body.stderr.includes('some warning'), '5: stderr captured');

  // 6. env layering (node env on top of inherited process.env)
  r = await executeCommand({ command: NODE, args: [MOCK, '--echo-env', 'MY_TEST_VAR'], env: { MY_TEST_VAR: 'hello' } });
  assert.strictEqual(r.body.json.env.MY_TEST_VAR, 'hello', '6: env layering');

  // 7. Relative cwd resolved against process.cwd(); absolute cwd respected
  r = await executeCommand({ command: NODE, args: [MOCK, '--status', '200'], cwd: __dirname });
  assert.strictEqual(path.resolve(r.body.json.cwd), path.resolve(__dirname), '7: cwd respected');

  // 8. Timeout -> throws
  await assert.rejects(
    () => executeCommand({ command: NODE, args: [MOCK, '--sleep', '5000'], timeout: 1 }),
    /timeout after 1s/,
    '8: timeout rejects'
  );

  // 9. ENOENT -> "Command not found"
  await assert.rejects(
    () => executeCommand({ command: 'definitely-not-a-real-binary-xyz', args: [] }),
    /Command not found/,
    '9: ENOENT rejects'
  );

  // 10. Output cap -> throws
  await assert.rejects(
    () => executeCommand({ command: NODE, args: [MOCK, '--flood'] }),
    /output exceeded/,
    '10: output cap rejects'
  );

  // 11. Large multibyte UTF-8 output is not corrupted across chunk boundaries
  r = await executeCommand({ command: NODE, args: [MOCK, '--unicode', '25000'] });
  const expectedAnswer = '😀漢字é'.repeat(25000);
  assert.strictEqual(r.status, 200, '11: unicode status parsed');
  assert.ok(r.body.json && typeof r.body.json.answer === 'string', '11: unicode json parsed');
  assert.ok(!r.body.json.answer.includes('\uFFFD'), '11: no replacement chars');
  assert.strictEqual(r.body.json.answer, expectedAnswer, '11: multibyte output intact');

  console.log('command-runner.test.js: all assertions passed');
}

run().catch((err) => { console.error('FAIL:', err.message); process.exit(1); });
