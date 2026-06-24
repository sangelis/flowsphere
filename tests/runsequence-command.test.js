const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { runSequence } = require('../lib/executor');

const MOCK = path.join(__dirname, 'fixtures', 'mock-client.js');
const NODE = process.execPath;

async function run() {
  const config = {
    nodes: [
      {
        id: 'c',
        name: 'cmd step',
        type: 'command',
        command: NODE,
        args: [MOCK, '--status', '200', '--answer', 'hi'],
        env: { SECRET: 'topsecret' },
        validations: [
          { httpStatusCode: 200 },
          { jsonpath: '.json.answer', equals: 'hi' }
        ]
      }
    ]
  };
  const tmp = path.join(__dirname, `.tmp-runseq-${process.pid}-${Date.now()}.json`);
  fs.writeFileSync(tmp, JSON.stringify(config));
  try {
    const result = await runSequence(tmp, {});
    assert.strictEqual(result.success, true, 'sequence succeeds');
    const entry = result.executionLog.find((e) => e.id === 'c');
    assert.ok(entry, 'log entry exists');
    assert.strictEqual(entry.type, 'command', 'log entry type is command');
    assert.ok(entry.label.startsWith('cmd:'), 'log entry has cmd label');
    assert.strictEqual(entry.command, NODE, 'command recorded');
    assert.strictEqual(entry.request.env.SECRET, '***', 'env masked in log');
  } finally {
    fs.unlinkSync(tmp);
  }
  console.log('runsequence-command.test.js: all assertions passed');
}

run().catch((err) => { console.error('FAIL:', err.message); process.exit(1); });
