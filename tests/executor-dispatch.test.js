const assert = require('assert');
const path = require('path');
const { executeStep } = require('../lib/executor');

const MOCK = path.join(__dirname, 'fixtures', 'mock-client.js');
const NODE = process.execPath;

async function run() {
  // Dispatches a command node to executeCommand and wraps the result
  const result = await executeStep(
    { id: 'c', type: 'command', command: NODE, args: [MOCK, '--status', '201', '--answer', 'ok'] },
    { vars: {}, responses: [], input: {}, enableDebug: false }
  );
  assert.strictEqual(result.requestDetails.type, 'command', 'dispatched to command path');
  assert.strictEqual(result.response.status, 201, 'command response status surfaced');
  assert.strictEqual(result.response.body.json.answer, 'ok', 'command body json surfaced');

  // Args are substituted through executeStep (vars -> command args)
  const result2 = await executeStep(
    { id: 'c2', type: 'command', command: NODE, args: [MOCK, '--stdout', '{"status":200,"v":"{{ .vars.token }}"}'] },
    { vars: { token: 'xyz' }, responses: [], input: {}, enableDebug: false }
  );
  assert.strictEqual(result2.response.body.json.v, 'xyz', 'args substituted via executeStep');

  console.log('executor-dispatch.test.js: all assertions passed');
}

run().catch((err) => { console.error('FAIL:', err.message); process.exit(1); });
