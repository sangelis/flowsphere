const assert = require('assert');
const { validateConfig } = require('../lib/config-validator');

const fields = (res) => res.errors.map((e) => e.field);

// valid command node passes
let res = validateConfig({ nodes: [{ id: 'c', type: 'command', command: 'python', args: ['x.py'] }] });
assert.ok(res.valid, 'valid command node should pass: ' + JSON.stringify(res.errors));

// missing command
res = validateConfig({ nodes: [{ id: 'c', type: 'command' }] });
assert.ok(fields(res).includes('nodes[0].command'), 'missing command flagged');

// args not a string array
res = validateConfig({ nodes: [{ id: 'c', type: 'command', command: 'python', args: [1, 2] }] });
assert.ok(fields(res).includes('nodes[0].args'), 'bad args flagged');

// env must be object of strings
res = validateConfig({ nodes: [{ id: 'c', type: 'command', command: 'python', env: { K: 5 } }] });
assert.ok(fields(res).includes('nodes[0].env'), 'bad env flagged');

// statusFrom must be a jsonpath string starting with '.'
res = validateConfig({ nodes: [{ id: 'c', type: 'command', command: 'python', statusFrom: 'status' }] });
assert.ok(fields(res).includes('nodes[0].statusFrom'), 'bad statusFrom flagged');

// HTTP fields rejected on a command node
res = validateConfig({ nodes: [{ id: 'c', type: 'command', command: 'python', method: 'GET', url: '/x' }] });
assert.ok(fields(res).includes('nodes[0].method'), 'method rejected on command node');
assert.ok(fields(res).includes('nodes[0].url'), 'url rejected on command node');

// invalid type
res = validateConfig({ nodes: [{ id: 'c', type: 'grpc', command: 'x' }] });
assert.ok(fields(res).includes('nodes[0].type'), 'invalid type flagged');

// defaults.env wrong type
res = validateConfig({ defaults: { env: { K: 5 } }, nodes: [{ id: 'h', method: 'GET', url: 'https://x.test' }] });
assert.ok(fields(res).includes('defaults.env'), 'bad defaults.env flagged');

// existing http node still validates (regression)
res = validateConfig({ nodes: [{ id: 'h', method: 'GET', url: 'https://x.test' }] });
assert.ok(res.valid, 'plain http node should still pass: ' + JSON.stringify(res.errors));

console.log('config-validator-command.test.js: all assertions passed');
