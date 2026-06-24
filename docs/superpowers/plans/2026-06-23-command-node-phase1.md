# Command Node (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking. Follow @superpowers:test-driven-development for each task.

> **⚠️ Commit policy:** The user asked for **no commits in the current session**. The `Commit` steps below are part of the standard TDD workflow for whoever executes this plan. Per the repo convention (`CLAUDE.md`: "NEVER commit changes without explicit user approval"; "only commit changes you have made … be cautious not to commit something you haven't written"), obtain explicit approval before any commit, and stage **only** the specific files you authored — never `git add -A`.

**Goal:** Add a `type: "command"` node that runs a local process (e.g. a Python client) as a sequence step and maps its result (`exitCode`, `stdout`, `stderr`, parsed `json`, reported HTTP status) onto FlowSphere's existing response model, so validations, response-chaining, conditions, and logging all work unchanged.

**Architecture:** A new `lib/command-runner.js` mirrors `lib/http-client.js` and returns the same response object. `executeStep` in `lib/executor.js` dispatches on `node.type` — `"command"` → `executeCommand`, otherwise → today's `executeRequest`. The CLI (`runSequence`) and all three Studio endpoints reach command execution through `executeStep` automatically. `lib/config-validator.js` gains command-node rules. Studio UI is **Phase 2** (separate plan).

**Tech Stack:** Node.js (`child_process.spawn`, `shell: false`), `node:assert` for plain-Node tests (matching the repo's existing test style), the existing `lib/utils.js` `extractValue` jsonpath helper.

**Spec:** `docs/superpowers/specs/2026-06-23-command-node-design.md`

---

## Scope Check

This is a single, self-contained subsystem (one new node type) with a clearly bounded blast radius: `lib/command-runner.js` (new), `lib/executor.js`, `lib/config-validator.js`, light guards in `bin/flowsphere.js`, plus tests/fixtures. It does not span multiple independent subsystems. No decomposition into multiple plans is needed. Studio UI is explicitly deferred to a Phase 2 plan.

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `lib/command-runner.js` | Execute a local process; return the standard response object `{ status, statusText, headers, body, duration }` with `body = { exitCode, stdout, stderr, json }`. | **Create** |
| `tests/fixtures/mock-client.js` | Hermetic Node mock "client" — configurable stdout/JSON/exit/stderr/sleep/flood. Lets tests run without Python. | **Create** |
| `lib/executor.js` | `executeStep` dispatch by type; `mergeWithDefaults` type-guard; `describeStep`/`buildRequestLog`/`maskEnv`/`maskSubstitutions` helpers; wire them into `runSequence` display + logging. | **Modify** |
| `lib/config-validator.js` | `validateCommandNode` helper; dispatch in `validateNode`; `type` enum; `defaults.cwd`/`defaults.env` rules. | **Modify** |
| `bin/flowsphere.js` | Use `buildRequestLog` so the three Studio endpoints' `request` objects are correct (and `env`-masked) for command nodes, without regressing HTTP. | **Modify** |
| `tests/command-runner.test.js` | Unit tests for `executeCommand`. | **Create** |
| `tests/executor-dispatch.test.js` | Unit tests proving `executeStep` dispatches to `executeCommand` and substitutes args. | **Create** |
| `tests/executor-command.test.js` | Unit tests for `mergeWithDefaults` + `describeStep`/`buildRequestLog`/`maskSubstitutions`. | **Create** |
| `tests/config-validator-command.test.js` | Unit tests for command-node validation. | **Create** |
| `tests/runsequence-command.test.js` | Unit test that `runSequence` produces a command-aware, env-masked execution-log entry. | **Create** |
| `tests/test-suite.js` | Runnable entry that runs all unit test files (fixes the already-broken `npm test`). | **Create** |
| `tests/config-test-command-basic.json` | Integration config: a basic command run with validations. | **Create** |
| `tests/config-test-command-chaining.json` | Integration config: response-chaining a command's `json` into a later command's args. | **Create** |
| `tests/config-test-command-condition.json` | Integration config: a later step's condition branches on a command node's output. | **Create** |

**Task order rationale:** `runSequence` calls `validateConfig` before executing, so a command node cannot run end-to-end until the validator accepts it. Therefore config-validation (Task 5) precedes the `runSequence` wiring + its integration test (Task 6).

---

## Chunk 1: Command runner core

### Task 1: Hermetic mock client fixture

**Files:**
- Create: `tests/fixtures/mock-client.js`

- [ ] **Step 1: Create the fixture**

```javascript
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
```

- [ ] **Step 2: Smoke-test the fixture manually**

Run: `node tests/fixtures/mock-client.js --status 200 --answer hi`
Expected stdout (cwd will vary): `{"cwd":"...","status":200,"answer":"hi"}`

- [ ] **Step 3: Commit**

```bash
git add tests/fixtures/mock-client.js
git commit -m "test: add hermetic mock client fixture for command nodes"
```

---

### Task 2: `lib/command-runner.js` — `executeCommand`

**Files:**
- Create: `lib/command-runner.js`
- Test: `tests/command-runner.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/command-runner.test.js`:

```javascript
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

  console.log('command-runner.test.js: all assertions passed');
}

run().catch((err) => { console.error('FAIL:', err.message); process.exit(1); });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/command-runner.test.js`
Expected: FAIL — `Cannot find module '../lib/command-runner'`.

- [ ] **Step 3: Write the implementation**

Create `lib/command-runner.js`:

```javascript
/**
 * Command runner for FlowSphere.
 * Executes a local process as a sequence step and maps the result onto the
 * same response shape produced by http-client.js, so the validator, conditions,
 * response-chaining, and logging all work unchanged.
 */

const { spawn } = require('child_process');
const path = require('path');
const { extractValue } = require('./utils');

// Maximum combined stdout+stderr bytes before the process is killed.
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024; // 10 MB
// Grace period between SIGTERM and SIGKILL when killing a process.
const KILL_GRACE_MS = 2000;

/**
 * Coerce a reported status value into a number, or null if not numeric.
 */
function toNumericStatus(value) {
  if (typeof value === 'number' && !Number.isNaN(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) {
    return Number(value);
  }
  return null;
}

/**
 * Execute a local command as a step.
 *
 * @param {Object} options
 * @param {string} options.command - Executable to run
 * @param {string[]} [options.args] - Arguments (already substituted)
 * @param {string} [options.cwd] - Working directory (absolute, or relative to process.cwd())
 * @param {Object} [options.env] - Extra environment variables (already substituted)
 * @param {number} [options.timeout] - Timeout in seconds (default 30)
 * @param {string} [options.statusFrom] - jsonpath into parsed stdout for HTTP status (default ".status")
 * @returns {Promise<{status:number, statusText:string, headers:Object, body:Object, duration:number}>}
 */
function executeCommand(options) {
  const {
    command,
    args = [],
    cwd,
    env = {},
    timeout = 30,
    statusFrom = '.status'
  } = options;

  return new Promise((resolve, reject) => {
    const startTime = Date.now();

    const resolvedCwd = cwd
      ? (path.isAbsolute(cwd) ? cwd : path.resolve(process.cwd(), cwd))
      : process.cwd();

    let child;
    try {
      child = spawn(command, args, {
        cwd: resolvedCwd,
        env: { ...process.env, ...env },
        shell: false
      });
    } catch (err) {
      return reject(new Error(`Command not found: ${command}`));
    }

    let stdout = '';
    let stderr = '';
    let outputBytes = 0;
    let settled = false;
    let timedOut = false;
    let overLimit = false;
    let killTimer = null;

    const killProcess = () => {
      try { child.kill('SIGTERM'); } catch (e) { /* ignore */ }
      killTimer = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch (e) { /* ignore */ }
      }, KILL_GRACE_MS);
      if (killTimer.unref) killTimer.unref();
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killProcess();
    }, timeout * 1000);
    if (timer.unref) timer.unref();

    const onData = (chunk, isErr) => {
      outputBytes += Buffer.byteLength(chunk);
      if (outputBytes > MAX_OUTPUT_BYTES) {
        if (!overLimit) {
          overLimit = true;
          killProcess();
        }
        return; // stop accumulating once over the cap
      }
      if (isErr) stderr += chunk; else stdout += chunk;
    };

    child.stdout.on('data', (c) => onData(c.toString(), false));
    child.stderr.on('data', (c) => onData(c.toString(), true));

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      if (err.code === 'ENOENT') {
        return reject(new Error(`Command not found: ${command}`));
      }
      return reject(err);
    });

    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);

      const duration = (Date.now() - startTime) / 1000;

      if (timedOut) {
        return reject(new Error(`Command timeout after ${timeout}s`));
      }
      if (overLimit) {
        return reject(new Error(`Command output exceeded ${MAX_OUTPUT_BYTES / (1024 * 1024)} MB`));
      }

      const exitCode = code === null ? 1 : code;

      // Parse stdout as JSON if possible
      let json = null;
      const trimmed = stdout.trim();
      if (trimmed.length > 0) {
        try { json = JSON.parse(trimmed); } catch (e) { json = null; }
      }

      // Determine status: script-reported HTTP status, else exit-derived
      const reported = json !== null ? toNumericStatus(extractValue(json, statusFrom)) : null;
      const status = reported !== null ? reported : (exitCode === 0 ? 200 : 500);

      const statusText = signal ? `killed (${signal})` : `exit ${exitCode}`;

      resolve({
        status,
        statusText,
        headers: {},
        body: { exitCode, stdout, stderr, json },
        duration
      });
    });
  });
}

module.exports = {
  executeCommand,
  MAX_OUTPUT_BYTES
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/command-runner.test.js`
Expected: PASS — `command-runner.test.js: all assertions passed`

- [ ] **Step 5: Commit**

```bash
git add lib/command-runner.js tests/command-runner.test.js
git commit -m "feat: add command-runner for executing local processes as steps"
```

---

### Task 3: `executeStep` dispatch by node type

**Files:**
- Modify: `lib/executor.js` (imports near top; `executeStep` at lines ~79-108)
- Test: `tests/executor-dispatch.test.js`

- [ ] **Step 1: Write the failing test** (verifies dispatch actually routes command nodes to `executeCommand`, and that args are substituted through `executeStep`)

Create `tests/executor-dispatch.test.js`:

```javascript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/executor-dispatch.test.js`
Expected: FAIL — today `executeStep` calls `executeRequest` for every node, so a command node has no `url`/`method` and the HTTP path errors (assertion on `requestDetails.type === 'command'` fails).

- [ ] **Step 3: Add the import**

At the top of `lib/executor.js`, after the existing `const { executeRequest } = require('./http-client');` line, add:

```javascript
const { executeCommand } = require('./command-runner');
```

- [ ] **Step 4: Replace `executeStep` body to dispatch on type**

Replace the entire `executeStep` function with:

```javascript
async function executeStep(step, context) {
  const { enableDebug } = context;

  // Substitute variables in step configuration and track substitutions
  const { result: substitutedStep, substitutions } = substituteWithTracking(step, context);

  const nodeType = substitutedStep.type || 'http';

  if (nodeType === 'command') {
    const { command, args = [], cwd, env, timeout, statusFrom } = substitutedStep;

    if (enableDebug) {
      console.error(`DEBUG: Executing command ${command} ${(args || []).join(' ')}`);
      if (cwd) console.error(`DEBUG: cwd: ${cwd}`);
    }

    const response = await executeCommand({ command, args, cwd, env, timeout, statusFrom });

    return {
      response,
      requestDetails: { type: 'command', command, args, cwd, env },
      substitutions
    };
  }

  const { method, url, headers, body, timeout } = substitutedStep;

  if (enableDebug) {
    console.error(`DEBUG: Executing ${method} ${url}`);
    if (headers) console.error(`DEBUG: Headers: ${JSON.stringify(headers)}`);
    if (body) console.error(`DEBUG: Body: ${JSON.stringify(body)}`);
  }

  // Execute HTTP request
  const response = await executeRequest({ method, url, headers, body, timeout });

  return {
    response,
    requestDetails: { type: 'http', method, url, headers, body },
    substitutions
  };
}
```

> `requestDetails` now carries a `type` field for both paths. Existing HTTP consumers still read `requestDetails.method`/`.url`/`.headers`/`.body`.

- [ ] **Step 5: Run test to verify it passes**

Run: `node tests/executor-dispatch.test.js`
Expected: PASS — `executor-dispatch.test.js: all assertions passed`
Run regression: `node tests/command-runner.test.js`
Expected: still PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/executor.js tests/executor-dispatch.test.js
git commit -m "feat: dispatch command vs http in executeStep"
```

---

## Chunk 2: Executor integration + validation

### Task 4: `mergeWithDefaults` type-guard + logging helpers (+ test)

**Files:**
- Modify: `lib/executor.js` (`mergeWithDefaults` at lines ~18-51; add helpers; `module.exports`)
- Test: `tests/executor-command.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/executor-command.test.js`:

```javascript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/executor-command.test.js`
Expected: FAIL — `describeStep`/`buildRequestLog`/`maskSubstitutions` are not exported (TypeError: not a function).

- [ ] **Step 3: Replace `mergeWithDefaults`**

Replace the `mergeWithDefaults` function with:

```javascript
function mergeWithDefaults(step, defaults) {
  const merged = { ...step };
  const nodeType = step.type || 'http';

  if (nodeType !== 'command') {
    // Base URL (HTTP only)
    if (defaults.baseUrl && step.url && step.url.startsWith('/')) {
      merged.url = defaults.baseUrl + step.url;
    }
    // Headers (HTTP only, merge)
    if (defaults.headers) {
      merged.headers = { ...(defaults.headers || {}), ...(step.headers || {}) };
    }
  } else {
    // Command nodes: inherit cwd/env from defaults (env merged, node wins)
    if (!merged.cwd && defaults.cwd) {
      merged.cwd = defaults.cwd;
    }
    if (defaults.env || step.env) {
      merged.env = { ...(defaults.env || {}), ...(step.env || {}) };
    }
  }

  // Timeout (both types)
  if (!merged.timeout && defaults.timeout) {
    merged.timeout = defaults.timeout;
  }

  // Validations (both types; merge unless skipDefaultValidations is true)
  if (step.skipDefaultValidations === true) {
    merged.validations = step.validations || [];
  } else if (defaults.validations || step.validations) {
    merged.validations = [
      ...(defaults.validations || []),
      ...(step.validations || [])
    ];
  }

  return merged;
}
```

- [ ] **Step 4: Add the helper functions** (place just after `mergeWithDefaults`)

```javascript
/**
 * Mask environment-variable values for logging (env holds credentials).
 */
function maskEnv(env) {
  if (!env || typeof env !== 'object') return env;
  const masked = {};
  for (const key of Object.keys(env)) masked[key] = '***';
  return masked;
}

/**
 * One-line description of a step (or its substituted requestDetails) for console output.
 */
function describeStep(stepOrDetails) {
  if ((stepOrDetails.type || 'http') === 'command') {
    const args = Array.isArray(stepOrDetails.args) ? stepOrDetails.args.join(' ') : '';
    return `cmd: ${stepOrDetails.command}${args ? ' ' + args : ''}`;
  }
  return `${stepOrDetails.method} ${stepOrDetails.url}`;
}

/**
 * Build the request-log object for a log entry / API payload, masking env secrets.
 * HTTP keeps method/url/headers/body (so Studio displays are unchanged); command
 * records command/args/cwd and a masked env.
 */
function buildRequestLog(requestDetails) {
  if (!requestDetails) return {};
  if (requestDetails.type === 'command') {
    return {
      command: requestDetails.command,
      args: requestDetails.args || [],
      cwd: requestDetails.cwd,
      env: maskEnv(requestDetails.env)
    };
  }
  return {
    method: requestDetails.method,
    url: requestDetails.url,
    headers: requestDetails.headers || {},
    body: requestDetails.body || {}
  };
}

/**
 * Mask env.* substitution records (env holds credentials).
 */
function maskSubstitutions(substitutions) {
  if (!Array.isArray(substitutions)) return substitutions;
  return substitutions.map((sub) =>
    (sub && typeof sub.path === 'string' && sub.path.startsWith('env.'))
      ? { ...sub, value: '***' }
      : sub
  );
}
```

- [ ] **Step 5: Export the helpers**

In the `module.exports` block at the bottom of `lib/executor.js`, add the four helpers:

```javascript
module.exports = {
  runSequence,
  readJSONFile,
  mergeWithDefaults,
  promptUserInput,
  executeStep,
  describeStep,
  buildRequestLog,
  maskEnv,
  maskSubstitutions
};
```

- [ ] **Step 6: Run test to verify it passes**

Run: `node tests/executor-command.test.js`
Expected: PASS — `executor-command.test.js: all assertions passed`

- [ ] **Step 7: Commit**

```bash
git add lib/executor.js tests/executor-command.test.js
git commit -m "feat: command-aware defaults merge + logging helpers"
```

---

### Task 5: Config-validator command-node rules

**Files:**
- Modify: `lib/config-validator.js` (`validateDefaults` ~170-234; `validateNode` ~239-440; add `validateCommandNode` helper)
- Test: `tests/config-validator-command.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/config-validator-command.test.js`:

```javascript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/config-validator-command.test.js`
Expected: FAIL — today the validator demands `method`/`url` for every node, so a command node produces the wrong errors (e.g. "method rejected on command node" assertion fails because the validator instead complains the command node is *missing* method/url).

- [ ] **Step 3: Add `validateCommandNode` helper**

Add this function to `lib/config-validator.js` (e.g. just before `validateNode`):

```javascript
/**
 * Validate a command-type node (structure-level checks).
 */
function validateCommandNode(node, nodePrefix, index, nodeId, errors) {
  // command is required and must be a non-empty string
  if (!node.command || typeof node.command !== 'string' || node.command.trim() === '') {
    errors.push({
      field: `${nodePrefix}.command`,
      message: 'Command node must have a non-empty "command" string',
      type: 'structure', category: 'structure', nodeIndex: index, nodeId
    });
  }

  // args: array of strings
  if (node.args !== undefined) {
    if (!Array.isArray(node.args) || !node.args.every((a) => typeof a === 'string')) {
      errors.push({
        field: `${nodePrefix}.args`,
        message: 'args must be an array of strings',
        type: 'type', category: 'structure', nodeIndex: index, nodeId
      });
    }
  }

  // cwd: string
  if (node.cwd !== undefined && typeof node.cwd !== 'string') {
    errors.push({
      field: `${nodePrefix}.cwd`,
      message: 'cwd must be a string',
      type: 'type', category: 'structure', nodeIndex: index, nodeId
    });
  }

  // env: object of string values
  if (node.env !== undefined) {
    if (typeof node.env !== 'object' || node.env === null || Array.isArray(node.env) ||
        !Object.values(node.env).every((v) => typeof v === 'string')) {
      errors.push({
        field: `${nodePrefix}.env`,
        message: 'env must be an object of string values',
        type: 'type', category: 'structure', nodeIndex: index, nodeId
      });
    }
  }

  // statusFrom: jsonpath string starting with '.'
  if (node.statusFrom !== undefined) {
    if (typeof node.statusFrom !== 'string' || !node.statusFrom.startsWith('.')) {
      errors.push({
        field: `${nodePrefix}.statusFrom`,
        message: 'statusFrom must be a jsonpath string starting with "." (e.g., ".status")',
        type: 'format', category: 'structure', nodeIndex: index, nodeId
      });
    }
  }

  // Reject HTTP-only fields
  for (const f of ['method', 'url', 'headers', 'body']) {
    if (node[f] !== undefined) {
      errors.push({
        field: `${nodePrefix}.${f}`,
        message: `"${f}" is not allowed on a command node`,
        type: 'structure', category: 'structure', nodeIndex: index, nodeId,
        suggestion: 'Remove this field, or set "type" to "http"'
      });
    }
  }
}
```

- [ ] **Step 4: Dispatch on type in `validateNode`**

In `validateNode`, immediately after `const nodeId = node.id || \`Node ${index}\`;`, insert:

```javascript
  const nodeType = node.type !== undefined ? node.type : 'http';

  if (!valuesOnly) {
    if (node.type !== undefined && nodeType !== 'http' && nodeType !== 'command') {
      errors.push({
        field: `${nodePrefix}.type`,
        message: `Invalid node type: "${node.type}"`,
        type: 'structure', category: 'structure', nodeIndex: index, nodeId,
        suggestion: 'Valid types: http, command'
      });
    }

    if (nodeType === 'command') {
      validateCommandNode(node, nodePrefix, index, nodeId, errors);
    }
  }
```

> Gating under `!valuesOnly` keeps command-node structure checks consistent with the existing HTTP structure checks (Studio's live `valuesOnly` mode skips structure errors).

Then wrap the **existing HTTP method/url validation region** (the `if (!valuesOnly) { …method… } else if (typeof node.url !== 'string') { … } else { …URL format… }` block spanning ~lines 244-309) so it only runs for non-command nodes. The robust transform: wrap that entire region in `if (nodeType !== 'command') { … }`. After editing, re-read `validateNode` and confirm a command node never reaches the method/url checks.

- [ ] **Step 5: Gate the optional headers/body type-checks to HTTP**

To avoid duplicate errors (command nodes already reject `headers`/`body` via `validateCommandNode`), gate the two existing optional checks:

- Change `if (node.headers !== undefined) {` (~line 324) to `if (nodeType !== 'command' && node.headers !== undefined) {`.
- Change `if (!structureOnly && node.body !== undefined) {` (~line 337) to `if (nodeType !== 'command' && !structureOnly && node.body !== undefined) {`.

> Leave `timeout`, `userPrompts`, `conditions`, `validations`, `launchBrowser`, and `validatePlaceholders` unchanged — they apply to both node types.

- [ ] **Step 6: Validate `defaults.cwd` / `defaults.env`**

In `validateDefaults`, after the `defaults.headers` block (~line 218), add:

```javascript
  // Validate default cwd (command nodes)
  if (defaults.cwd !== undefined && typeof defaults.cwd !== 'string') {
    errors.push({
      field: 'defaults.cwd',
      message: 'cwd must be a string',
      type: 'type'
    });
  }

  // Validate default env (command nodes)
  if (defaults.env !== undefined) {
    if (typeof defaults.env !== 'object' || defaults.env === null || Array.isArray(defaults.env) ||
        !Object.values(defaults.env).every((v) => typeof v === 'string')) {
      errors.push({
        field: 'defaults.env',
        message: 'env must be an object of string values',
        type: 'type'
      });
    }
  }
```

- [ ] **Step 7: Run test to verify it passes**

Run: `node tests/config-validator-command.test.js`
Expected: PASS.
Run regression: `node tests/test-validator-categories.js`
Expected: still prints the same categorized errors as before (no crash; HTTP validation unchanged).

- [ ] **Step 8: Commit**

```bash
git add lib/config-validator.js tests/config-validator-command.test.js
git commit -m "feat: validate command nodes and defaults.cwd/env"
```

---

### Task 6: Wire helpers into `runSequence` (+ integration test)

**Files:**
- Modify: `lib/executor.js` (`runSequence` console + log sites)
- Test: `tests/runsequence-command.test.js`

Goal: command nodes print a `cmd: …` label (instead of `undefined undefined`) and their execution-log entries carry `type`, a `label`, command fields, a masked `request`, and masked substitutions. HTTP behavior is unchanged. This task's test calls `runSequence`, which validates the config first — so it depends on Task 5.

- [ ] **Step 1: Write the failing test**

Create `tests/runsequence-command.test.js`:

```javascript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/runsequence-command.test.js`
Expected: FAIL — before wiring, the log entry has no `type`/`label`/command fields and `request` is not built from `buildRequestLog` (assertion on `entry.type === 'command'` fails). (The sequence itself runs because Task 5 validation and Task 3 dispatch are in place.)

- [ ] **Step 3: Skipped-step display + log (two skip blocks)**

There are two skip blocks (the `--start-step` block ~159-179 and the conditions block ~195-214). In **each**, swap the `console.log` label to `describeStep(node)` and add `type`/`label` to the pushed `executionLog` entry.

`--start-step` block — replace:
```javascript
      console.log(`${method} ${url} ${colorize('⊘ SKIPPED', 'yellow')} (${skipReason})`);
```
with:
```javascript
      console.log(`${describeStep(node)} ${colorize('⊘ SKIPPED', 'yellow')} (${skipReason})`);
```

conditions block — replace:
```javascript
      console.log(`${method} ${url} ${colorize('⊘ SKIPPED', 'blue')} (${skipReason})`);
```
with:
```javascript
      console.log(`${describeStep(node)} ${colorize('⊘ SKIPPED', 'blue')} (${skipReason})`);
```

In both skip `executionLog.push({ ... })` calls, add `type: node.type || 'http'` and `label: describeStep(node)` alongside the existing `method`/`url` fields (leave `method`/`url` — they are `undefined` for command nodes, which is harmless).

- [ ] **Step 4: Success display**

Replace:
```javascript
      console.log(
        `${requestDetails.method} ${requestDetails.url} ${colorize('✅', 'green')} Status ${statusText} (${formatDuration(duration)})`
      );
```
with:
```javascript
      console.log(
        `${describeStep(requestDetails)} ${colorize('✅', 'green')} Status ${statusText} (${formatDuration(duration)})`
      );
```

- [ ] **Step 5: Success execution-log entry**

Replace the success `executionLog.push({ ... })` (the one with `status: 'completed'`) with:

```javascript
      executionLog.push({
        step: stepNum,
        id,
        name,
        type: requestDetails.type,
        label: describeStep(requestDetails),
        ...(requestDetails.type === 'command'
          ? { command: requestDetails.command, args: requestDetails.args }
          : { method: requestDetails.method, url: requestDetails.url }),
        request: buildRequestLog(requestDetails),
        response: {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
          body: response.body
        },
        substitutions: maskSubstitutions(result.substitutions || []),
        duration,
        status: 'completed'
      });
```

- [ ] **Step 6: Failure display + log**

Replace:
```javascript
      const logMethod = requestDetails ? requestDetails.method : method;
      const logUrl = requestDetails ? requestDetails.url : url;

      console.log(
        `${logMethod} ${logUrl} ${colorize('❌ FAILED', 'red')}`
      );
```
with:
```javascript
      const failLabel = describeStep(requestDetails || node);

      console.log(
        `${failLabel} ${colorize('❌ FAILED', 'red')}`
      );
```

Then replace the failure `executionLog.push({ ... })` (the one with `status: 'failed'`) with:

```javascript
      executionLog.push({
        step: stepNum,
        id,
        name,
        type: (requestDetails && requestDetails.type) || node.type || 'http',
        label: failLabel,
        ...((requestDetails && requestDetails.type === 'command') || node.type === 'command'
          ? { command: requestDetails ? requestDetails.command : node.command, args: requestDetails ? requestDetails.args : node.args }
          : { method: requestDetails ? requestDetails.method : method, url: requestDetails ? requestDetails.url : url }),
        request: requestDetails ? buildRequestLog(requestDetails) : {},
        substitutions: maskSubstitutions(substitutions),
        error: error.message,
        status: 'failed'
      });
```

> The failure `console.log(\`Error: ${error.message}\`)` line below stays as-is.

- [ ] **Step 7: Run test to verify it passes**

Run: `node tests/runsequence-command.test.js`
Expected: PASS — `runsequence-command.test.js: all assertions passed`
Run regression: `node tests/command-runner.test.js && node tests/executor-dispatch.test.js && node tests/executor-command.test.js && node tests/config-validator-command.test.js`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add lib/executor.js tests/runsequence-command.test.js
git commit -m "feat: command-aware console output and execution logs in runSequence"
```

---

## Chunk 3: Studio guards + integration

### Task 7: Studio endpoint guards (DRY via `buildRequestLog`)

**Files:**
- Modify: `bin/flowsphere.js` (`/api/execute-node` ~198-345; `/api/execute-step` ~346-572; `/api/execute-stream` ~573-957)

Goal: the three Studio endpoints already *execute* command nodes (they call `executeStep`). This task makes the `request` objects they build (both the browser payloads and the saved execution-log entries) correct and `env`-masked for command nodes, **without regressing HTTP** — `buildRequestLog`'s http variant returns `{ method, url, headers, body }`, the same shape these endpoints already emit. Pretty browser *rendering* of command results (panels for stdout/stderr/exit) is **Phase 2**.

- [ ] **Step 1: Import the helper in each endpoint**

Each endpoint has its own `require('../lib/executor')` (at ~217, ~367, ~639). Add `buildRequestLog` and `maskSubstitutions` to each destructured import, e.g.:

```javascript
const { mergeWithDefaults, executeStep, buildRequestLog, maskSubstitutions } = require('../lib/executor');
```

- [ ] **Step 2: Route every `request` object through `buildRequestLog`**

The three endpoints use **two** `request`-object shapes; replace both with `buildRequestLog(requestDetails)`. HTTP stays identical or a superset (no display regression); command nodes get `{ command, args, cwd, env: masked }`:

- `/api/execute-node` uses `request: { method, url, headers, body }` — at the validation-failure payload (~279-284), the success payload (~301-306), and an execution-error ternary (~319-329).
- `/api/execute-step` (success ~474-477, error ~516-519) and `/api/execute-stream` (success ~794-797, error ~839-842) use `request: { headers, body }`, with `method`/`url` as **separate top-level** `stepLog` fields — leave those top-level fields in place.

For the success / validation-failure sites (where `requestDetails` is always set):
```javascript
            request: buildRequestLog(requestDetails),
```

For the execution-error fallback sites (where `requestDetails` may be null because `executeStep` threw before returning) — spread the in-scope node so `buildRequestLog` gets the right fields for either type:

```javascript
          request: requestDetails
            ? buildRequestLog(requestDetails)
            : buildRequestLog({ type: fallbackNode.type || 'http', ...fallbackNode }),
```

where `fallbackNode` is the node variable already in scope at that site: **`mergedNode`** in `/api/execute-node`, and **`node`** in `/api/execute-step` and `/api/execute-stream`. (For an HTTP node this preserves the original `method`/`url` fallback; for a command node it yields a masked command log.)

- [ ] **Step 3: Add `type` to the step-log / payload objects**

To each object whose `request` you replaced in Step 2 — the `/api/execute-step` and `/api/execute-stream` `stepLog` objects (success ~468-488 / ~788-808 and their failure variants), and (optionally) the `/api/execute-node` payloads — add a sibling field:

```javascript
            type: requestDetails ? requestDetails.type : (fallbackNode.type || 'http'),
```

using the same `fallbackNode` as Step 2 (`mergedNode` in `/api/execute-node`, `node` in the others). This lets saved logs and the frontend distinguish command vs http steps. (Surfacing `exitCode`/stdout/stderr in the browser is Phase 2.)

- [ ] **Step 4: Mask `substitutions` in every endpoint payload/log**

`executeStep` records `env.*` substitutions with their real secret values. The endpoints currently return `substitutions: substitutions` (or `substitutions: result.substitutions || []`) unmasked, which would leak command `env` secrets in Try-it-Out / step / SSE payloads and logs. Wrap each such field with `maskSubstitutions(...)`:

- `/api/execute-node`: `substitutions: substitutions` at ~285, ~307, ~330 → `substitutions: maskSubstitutions(substitutions)`.
- `/api/execute-step`: `substitutions: result.substitutions || []` (~484) → `maskSubstitutions(result.substitutions || [])`; `substitutions: substitutions` (~520) → `maskSubstitutions(substitutions)`.
- `/api/execute-stream`: `substitutions: result.substitutions || []` (~804) → `maskSubstitutions(result.substitutions || [])`; `substitutions: substitutions` (~843) → `maskSubstitutions(substitutions)`.

- [ ] **Step 5: Smoke-test a modified endpoint does not regress, handles command nodes, and masks env**

`/api/execute-node` is one of the endpoints edited in this task. Start studio from the **repo root** (so relative arg paths resolve): `node bin/flowsphere.js studio` and note the printed port (default 3737; do not rely on auto-open). Then, in another shell:

```powershell
# HTTP regression: request payload still carries method/url
$h = @{ id='h'; method='GET'; url='https://jsonplaceholder.typicode.com/todos/1' }
$hb = @{ node=$h; config=@{ nodes=@($h) } } | ConvertTo-Json -Depth 6
$hr = Invoke-RestMethod -Uri http://localhost:3737/api/execute-node -Method Post -ContentType 'application/json' -Body $hb
"$($hr.request.method) $($hr.request.url)"   # expect: GET https://jsonplaceholder.typicode.com/todos/1

# Command node with an env secret: request carries command/args; env substitution is masked in `substitutions`
$c = @{ id='c'; type='command'; command='node'; args=@('tests/fixtures/mock-client.js','--echo-env','SECRET'); env=@{ SECRET='{{ .vars.k }}' } }
$cb = @{ node=$c; config=@{ variables=@{ k='topsecret' }; nodes=@($c) } } | ConvertTo-Json -Depth 6
$cr = Invoke-RestMethod -Uri http://localhost:3737/api/execute-node -Method Post -ContentType 'application/json' -Body $cb
"$($cr.success) $($cr.request.command)"                                   # expect: True node
($cr.substitutions | Where-Object { $_.path -eq 'env.SECRET' }).value      # expect: ***
```

Expected: the HTTP call returns `GET https://…/todos/1` (no regression); the command call returns `True node`, and the `env.SECRET` substitution value is masked to `***` (the real value still reaches the process — `$cr.response.body.json.env.SECRET` would be `topsecret` — only the logged substitution is masked). Stop the server with `Stop-Process -Id <PID>` (PID printed at startup, or from the shell you launched it in).

- [ ] **Step 6: Commit**

```bash
git add bin/flowsphere.js
git commit -m "feat: command-aware request payloads in studio endpoints"
```

---

### Task 8: Integration configs + runnable test suite (fix `npm test`)

**Files:**
- Create: `tests/config-test-command-basic.json`, `tests/config-test-command-chaining.json`, `tests/config-test-command-condition.json`
- Create: `tests/test-suite.js`

- [ ] **Step 1: Create `tests/config-test-command-basic.json`**

```json
{
  "nodes": [
    {
      "id": "run-client",
      "name": "Run mock client",
      "type": "command",
      "command": "node",
      "args": ["tests/fixtures/mock-client.js", "--status", "200", "--answer", "hello"],
      "validations": [
        { "httpStatusCode": 200 },
        { "jsonpath": ".json.answer", "equals": "hello" },
        { "jsonpath": ".exitCode", "equals": 0 }
      ]
    }
  ]
}
```

- [ ] **Step 2: Create `tests/config-test-command-chaining.json`** (response-chaining a command's json into a later command's args)

```json
{
  "nodes": [
    {
      "id": "make-token",
      "name": "Produce a token",
      "type": "command",
      "command": "node",
      "args": ["tests/fixtures/mock-client.js", "--stdout", "{\"status\":200,\"token\":\"abc123\"}"]
    },
    {
      "id": "use-token",
      "name": "Consume the token from the previous step",
      "type": "command",
      "command": "node",
      "args": ["tests/fixtures/mock-client.js", "--stdout", "{\"status\":200,\"received\":\"{{ .responses.make-token.json.token }}\"}"],
      "validations": [
        { "httpStatusCode": 200 },
        { "jsonpath": ".json.received", "equals": "abc123" }
      ]
    }
  ]
}
```

- [ ] **Step 3: Create `tests/config-test-command-condition.json`** (a later step's condition branches on a command node's output)

```json
{
  "nodes": [
    {
      "id": "probe",
      "name": "Probe premium flag",
      "type": "command",
      "command": "node",
      "args": ["tests/fixtures/mock-client.js", "--stdout", "{\"status\":200,\"premium\":true}"]
    },
    {
      "id": "premium-only",
      "name": "Runs only when probe.premium == true",
      "type": "command",
      "command": "node",
      "args": ["tests/fixtures/mock-client.js", "--status", "200"],
      "conditions": [
        { "node": "probe", "field": ".json.premium", "equals": "true" }
      ]
    }
  ]
}
```

- [ ] **Step 4: Create `tests/test-suite.js`** (fixes `npm test`, which currently points at this missing file)

```javascript
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
```

- [ ] **Step 5: Run the suite**

Run: `npm test`
Expected: PASS — runs all five unit test files, prints `✓ All test files passed`, exit code 0.

- [ ] **Step 6: Commit**

```bash
git add tests/config-test-command-basic.json tests/config-test-command-chaining.json tests/config-test-command-condition.json tests/test-suite.js
git commit -m "test: integration configs + runnable test suite for command nodes"
```

---

### Task 9: End-to-end CLI verification

**Files:** none (verification only)

The CLI prompts to save a log at the end; pipe `n` to skip it.

- [ ] **Step 1: Basic command run**

Run (PowerShell): `"n" | node bin/flowsphere.js tests/config-test-command-basic.json`
Expected: a line like `cmd: node tests/fixtures/mock-client.js --status 200 --answer hello ✅ Status 200 exit 0 (…s)`, the three validations shown as passed, and `✅ Sequence completed successfully!`.

- [ ] **Step 2: Response chaining**

Run: `"n" | node bin/flowsphere.js tests/config-test-command-chaining.json`
Expected: both steps succeed; the `use-token` validation `.json.received == abc123` passes (proving `{{ .responses.make-token.json.token }}` substituted into args).

- [ ] **Step 3: Condition on a command node's output**

Run: `"n" | node bin/flowsphere.js tests/config-test-command-condition.json`
Expected: `probe` runs; `premium-only` executes (not skipped) because the condition `probe.json.premium == true` holds.

- [ ] **Step 4: Failure path (non-zero exit → default 200 check fails → sequence stops)**

Create a throwaway config `tests/tmp-command-fail.json` with a single command node whose args are `["tests/fixtures/mock-client.js", "--no-json", "--exit", "1"]` and no validations.
Run: `"n" | node bin/flowsphere.js tests/tmp-command-fail.json`
Expected: `❌ FAILED`, `Status 500`, `Execution stopped due to error`. Then delete the throwaway file: `Remove-Item tests/tmp-command-fail.json`.

- [ ] **Step 5: Full unit suite green**

Run: `npm test`
Expected: PASS — `✓ All test files passed`.

- [ ] **Step 6: (Only if a verification revealed a bug)**

Task 9 is verification-only — no new files are expected. If a step revealed a bug, fix it under the relevant earlier task and stage **only** the specific file(s) you changed (e.g. `git add lib/command-runner.js`). Do **not** run `git add -A` or stage files you did not author.

---

## Out of scope (Phase 2 — separate plan)

Studio UI: a command-node editor form, Flow Runner / Try-it-Out result rendering (exit code + stdout/stderr panels + parsed-json view), node templates, validation-UI messages, and surfacing `command`/`exitCode` in the browser SSE payloads. Reuse the existing validation/substitution display patterns from the UI styling guide.

## Documentation

Per repo convention, do **not** auto-update `README.md` / `CLAUDE.md`. Ask the user before adding user-facing docs for command nodes.
