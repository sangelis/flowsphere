const assert = require('assert');
const path = require('path');
const fs = require('fs');

// Load the browser helper into a sandbox and grab formatStepLabel (no DOM needed for this fn).
const src = fs.readFileSync(path.join(__dirname, '..', 'studio', 'js', 'command-result-view.js'), 'utf8');
const sandbox = { window: {} };
const vm = require('vm');
vm.runInNewContext(src, sandbox);
const formatStepLabel = sandbox.window.formatStepLabel;

assert.strictEqual(typeof formatStepLabel, 'function', 'formatStepLabel exported on window');
assert.strictEqual(formatStepLabel({ type: 'command', command: 'python', args: ['a.py', '--x'] }), 'cmd: python a.py --x');
assert.strictEqual(formatStepLabel({ type: 'command', request: { command: 'node', args: ['x.js'] } }), 'cmd: node x.js');
assert.strictEqual(formatStepLabel({ type: 'http', method: 'GET', url: '/u' }), 'GET /u');
assert.strictEqual(formatStepLabel({ method: 'POST', url: '/p' }), 'POST /p');

console.log('formatStepLabel.test.js: all assertions passed');
