const assert = require('assert');
const { mergeWithDefaults, describeStep, buildRequestLog, maskSubstitutions } = require('../lib/executor');

// --- mergeWithDefaults: command node ---
const defaults = {
  baseUrl: 'https://api.example.com',
  headers: { A: '1' },
  timeout: 45,
  cwd: '/defaults-dir',
  env: { K: 'v' },
  validations: [{ httpStatusCode: 200 }]
};

const cmd = mergeWithDefaults(
  { id: 'c', type: 'command', command: 'python', env: { K2: 'v2' } },
  defaults
);
assert.strictEqual(cmd.timeout, 45, 'command inherits timeout');
assert.strictEqual(cmd.cwd, '/defaults-dir', 'command inherits cwd');
assert.deepStrictEqual(cmd.env, { K: 'v', K2: 'v2' }, 'command env merged, node wins');
assert.strictEqual(cmd.headers, undefined, 'command does NOT inherit headers');
assert.ok(Array.isArray(cmd.validations), 'command inherits validations');

// --- mergeWithDefaults: http node unchanged ---
const http = mergeWithDefaults({ id: 'h', method: 'GET', url: '/x' }, defaults);
assert.strictEqual(http.url, 'https://api.example.com/x', 'http baseUrl prepended');
assert.deepStrictEqual(http.headers, { A: '1' }, 'http inherits headers');

// --- describeStep ---
assert.strictEqual(
  describeStep({ type: 'command', command: 'python', args: ['a.py', '--x'] }),
  'cmd: python a.py --x'
);
assert.strictEqual(describeStep({ type: 'http', method: 'GET', url: '/u' }), 'GET /u');

// --- buildRequestLog: command masks env ---
const clog = buildRequestLog({ type: 'command', command: 'python', args: ['a'], cwd: '/d', env: { SECRET: 'abc' } });
assert.strictEqual(clog.env.SECRET, '***', 'env masked in request log');
assert.strictEqual(clog.command, 'python', 'command recorded');

// --- buildRequestLog: http keeps method/url (no regression for Studio display) ---
const hlog = buildRequestLog({ type: 'http', method: 'GET', url: 'https://x', headers: { H: '1' }, body: { b: 1 } });
assert.strictEqual(hlog.method, 'GET', 'http log keeps method');
assert.strictEqual(hlog.url, 'https://x', 'http log keeps url');
assert.deepStrictEqual(hlog.headers, { H: '1' }, 'http log keeps headers');

// --- maskSubstitutions masks env.* records ---
const subs = [
  { original: '{{ .vars.x }}', value: 'plain', type: 'variable', path: 'args[0]' },
  { original: '{{ .vars.key }}', value: 'topsecret', type: 'variable', path: 'env.AZURE_OPENAI_API_KEY' }
];
const masked = maskSubstitutions(subs);
assert.strictEqual(masked[0].value, 'plain', 'non-env substitution untouched');
assert.strictEqual(masked[1].value, '***', 'env.* substitution masked');

console.log('executor-command.test.js: all assertions passed');
