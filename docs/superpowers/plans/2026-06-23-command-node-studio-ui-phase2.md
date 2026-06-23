# Command Node — Studio UI (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax. The work is browser JS (no DOM test harness in the repo), so most tasks end in a **manual browser check**; one pure helper has a Node unit test.

> **⚠️ Commit policy:** The user asked for **no commits in the current session**. `Commit` steps are for whoever executes this plan; per `CLAUDE.md` ("NEVER commit changes without explicit user approval"; "only commit changes you have made"), get approval before committing and stage only the files you authored — never `git add -A`.

> **⚠️ Depends on Phase 1** (`docs/superpowers/plans/2026-06-23-command-node-phase1.md`) being implemented first: the engine/validator accept `type:"command"` nodes, the Studio server routes request objects through `buildRequestLog` and tags step logs/payloads with `type`, and `tests/test-suite.js` exists.

**Goal:** Make FlowSphere Studio a first-class editor/runner for `type:"command"` nodes — a type selector + command fields in the editor, rich command result panels in Flow Runner and Try-it-Out, command-output autocomplete, a template, and docs.

**Architecture:** Command-node rendering is **core** (a first-class node type): edits go in the active renderer `ui-renderer-bootstrap.js`, `form-handlers.js`, `flow-runner.js`, plus a new core helper `command-result-view.js`. Enhancements inside the already-toggleable `autocomplete` and `try-it-out` features ride those toggles. A small server tweak ensures all three execution endpoints emit `type` + command-shaped masked `request`.

**Tech Stack:** Vanilla browser JS + Bootstrap 5; the existing FlowSphere Studio patterns (UI Styling Guide in `CLAUDE.md`); `node:assert` for the one pure-function test.

**Spec:** `docs/superpowers/specs/2026-06-23-command-node-studio-ui-design.md`

---

## Scope Check

One coherent subsystem (Studio UI for an existing node type). Bounded blast radius: `studio/js/ui-renderer-bootstrap.js`, `studio/js/form-handlers.js`, `studio/index.html`, new `studio/js/command-result-view.js`, `studio/js/flow-runner.js`, `studio/js/try-it-out.js`, `studio/js/autocomplete.js`, `bin/flowsphere.js`, a template JSON, docs, and one test. Not split further.

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `studio/js/command-result-view.js` | **New core** helper: `renderCommandResultPanels(body)`, `formatStepLabel(stepLike)`, `isCommandLike(x)` | Create |
| `studio/index.html` | Load `command-result-view.js` in core scripts; add a **Command** starter to the Add-Node modal | Modify |
| `studio/js/ui-renderer-bootstrap.js` | Type dropdown + conditional command/HTTP fields in `renderStepForm`; CMD badge in `renderSteps` | Modify |
| `studio/js/form-handlers.js` | `updateStep` type-swap + re-render; `addStep` command skeleton; arg/env editors | Modify |
| `studio/js/flow-runner.js` | Branch on `type`: `formatStepLabel` + `renderCommandResultPanels` in step rendering | Modify |
| `studio/js/try-it-out.js` | Command request section + `renderCommandResultPanels`; command-shaped response schema | Modify |
| `studio/js/autocomplete.js` | Command-output suggestions (`.exitCode/.stdout/.stderr/.json` + `.json.*` drilling) | Modify |
| `bin/flowsphere.js` | All 3 exec endpoints emit `type` + command-shaped masked `request` (incl. `step_start`) | Modify |
| `studio/templates/nodes/command/run-client.json` | **New** command template | Create |
| `tests/formatStepLabel.test.js`, `tests/test-suite.js` | Unit test for `formatStepLabel`; wire into suite | Create/Modify |
| `README.md`, `CLAUDE.md`, `examples/config-command-node.json` | Docs | Modify/Create |

---

## Chunk 1: Editor form

### Task 1: Node type dropdown + conditional fields in `renderStepForm`

**Files:** Modify `studio/js/ui-renderer-bootstrap.js` (`renderStepForm` at line 769; `renderSteps` badge at ~452)

- [ ] **Step 1: Add a Node Type selector + branch the Request section**

In `renderStepForm(step, index)`, compute the type at the top and render a type dropdown in the "Node Details" block (after the Node ID / Node Name row, ~line 802). Insert:

```javascript
    const nodeType = step.type === 'command' ? 'command' : 'http';
```
…and add this markup right after the id/name `.row` (after line 802):

```html
            <div class="row g-3 mb-3">
                <div class="col-md-6">
                    <label class="form-label">Node Type</label>
                    <select class="form-select form-select-sm" onchange="updateStep(${index}, 'type', this.value)">
                        <option value="http" ${nodeType === 'http' ? 'selected' : ''}>HTTP Request</option>
                        <option value="command" ${nodeType === 'command' ? 'selected' : ''}>Command (run a local process)</option>
                    </select>
                    <div class="form-text">HTTP sends a request; Command runs a local process and maps its result onto the response model.</div>
                </div>
            </div>
```

- [ ] **Step 2: Wrap the existing HTTP "Request Details" block so it only renders for HTTP**

The "Request Details" section's **HTTP-only** fields — HTTP Method, URL, Headers, Body (starting ~line 829) — must only render when `nodeType === 'http'`. Wrap **just those**:

```javascript
        ${nodeType === 'http' ? `
        <!-- Request Details (HTTP) -->
        <div class="border-bottom pb-3 mb-3">
          ... existing HTTP method/url/timeout/headers/body markup ...
        </div>
        ` : `
        ${renderCommandFields(step, index)}
        `}
```

> Keep **Timeout** available to both types. Simplest: move the Timeout field out of the HTTP-only block into a shared row, OR duplicate a Timeout input inside `renderCommandFields`. Use the shared approach: render Timeout in a shared row shown for both types, and remove it from the HTTP-only `.row` (leaving Method + URL there).

> **Validations**, **Conditions**, **User Input Prompts**, and **Launch Browser** are shared — ensure they render for both types (they live in their own sections; verify they are outside the `nodeType === 'http'` wrapper). `launchBrowser` is valid on command nodes (extracts from `response.body`, e.g. `.json.authUrl`).

- [ ] **Step 3: Add the `renderCommandFields` function**

Add a new function near `renderStepForm`:

```javascript
function renderCommandFields(step, index) {
    const args = Array.isArray(step.args) ? step.args : [];
    const env = (step.env && typeof step.env === 'object') ? step.env : {};
    const argsHtml = args.map((a, i) => `
        <div class="input-group input-group-sm mb-2" data-arg-row="${i}">
            <input type="text" class="form-control" value="${escapeAttr(a)}"
                   onchange="updateStepArg(${index}, ${i}, this.value)" placeholder="argument">
            <button class="btn btn-outline-danger" type="button" onclick="removeStepArg(${index}, ${i})" title="Remove">
                <i class="bi bi-x"></i>
            </button>
        </div>
    `).join('');
    const envHtml = Object.entries(env).map(([k, v], i) => `
        <div class="input-group input-group-sm mb-2" data-env-row="${i}">
            <input type="text" class="form-control" value="${escapeAttr(k)}"
                   onchange="updateStepEnvKey(${index}, '${escapeJsString(k)}', this.value)" placeholder="VAR_NAME" style="max-width: 40%;">
            <span class="input-group-text">=</span>
            <input type="text" class="form-control" value="${escapeAttr(v)}"
                   onchange="updateStepEnvValue(${index}, '${escapeJsString(k)}', this.value)" placeholder="value">
            <button class="btn btn-outline-danger" type="button" onclick="removeStepEnv(${index}, '${escapeJsString(k)}')" title="Remove">
                <i class="bi bi-x"></i>
            </button>
        </div>
    `).join('');

    return `
        <!-- Command Details -->
        <div class="border-bottom pb-3 mb-3">
            <h6 class="text-uppercase fw-semibold small text-secondary mb-3">Command Details</h6>
            <div class="mb-3">
                <label class="form-label">Command</label>
                <input type="text" class="form-control form-control-sm" value="${escapeAttr(step.command || '')}"
                       onchange="updateStep(${index}, 'command', this.value)" placeholder="python  (or .venv/Scripts/python.exe)">
                <div class="form-text">Executable to run (no shell). Use Arguments for flags/values.</div>
            </div>
            <div class="mb-3">
                <label class="form-label">Arguments</label>
                <div id="argsList_${index}">${argsHtml}</div>
                <button class="btn btn-outline-secondary btn-sm mt-1" onclick="addStepArg(${index})">
                    <i class="bi bi-plus"></i> Add Argument
                </button>
                <div class="form-text">Each argument is passed separately. Supports {{ .vars.x }}, {{ .responses.id.json.field }}, {{ $guid }}.</div>
            </div>
            <div class="row g-3 mb-3">
                <div class="col-md-6">
                    <label class="form-label">Working Directory (cwd)</label>
                    <input type="text" class="form-control form-control-sm" value="${escapeAttr(step.cwd || '')}"
                           onchange="updateStep(${index}, 'cwd', this.value)" placeholder="relative to launch dir, or absolute">
                </div>
                <div class="col-md-6">
                    <label class="form-label">Status From (jsonpath)</label>
                    <input type="text" class="form-control form-control-sm" value="${escapeAttr(step.statusFrom || '')}"
                           onchange="updateStep(${index}, 'statusFrom', this.value)" placeholder=".status">
                    <div class="form-text">Reads the reported HTTP status from parsed stdout JSON.</div>
                </div>
            </div>
            <div class="mb-3">
                <label class="form-label">Environment Variables</label>
                <div id="envList_${index}">${envHtml}</div>
                <button class="btn btn-outline-secondary btn-sm mt-1" onclick="addStepEnv(${index})">
                    <i class="bi bi-plus"></i> Add Variable
                </button>
                <div class="form-text">Layered over the inherited environment. Values are masked in execution logs.</div>
            </div>
        </div>
    `;
}
```

> If helpers `escapeAttr` / `escapeJsString` don't already exist in this file, add minimal versions (escape `"`/`<`/`>`/`&` for attributes; escape `'`/`\` for the JS-string args). Check first — the file already escapes values elsewhere; reuse whatever exists.

- [ ] **Step 4: CMD badge in `renderSteps`**

In `renderSteps` (~line 452) the header badge is `<span class="badge ${getMethodBadgeClass(step.method)} ms-2">${step.method || 'GET'}</span>`. Make it type-aware:

```javascript
                            ${(step.type === 'command')
                                ? `<span class="badge bg-secondary ms-2">CMD</span>`
                                : `<span class="badge ${getMethodBadgeClass(step.method)} ms-2">${step.method || 'GET'}</span>`}
```

Also guard the accordion-item class at ~line 442 (`step-method-${(step.method || 'GET').toLowerCase()}`) so command nodes don't get a misleading method class — e.g. `step-method-${step.type === 'command' ? 'cmd' : (step.method || 'GET').toLowerCase()}`.

- [ ] **Step 5: Manual check (rendering only)**

Refresh Studio and load a config that already contains a command node — e.g. open/import `tests/config-test-command-basic.json`. Confirm the command node's form renders the Command / Arguments / cwd / statusFrom / Environment fields (not HTTP Method/URL/Headers/Body), its header badge shows **CMD**, **Launch Browser** still appears, and `{{`-autocomplete fires in the new text fields (auto-attached to all text inputs, `ui-renderer-bootstrap.js:565`). (Interactive type-**switching** via the dropdown is verified in Task 2, once `updateStep` handles `type` and the arg/env handlers exist.)

- [ ] **Step 6: Commit**

```bash
git add studio/js/ui-renderer-bootstrap.js
git commit -m "feat(studio): node type selector + command fields in editor form"
```

---

### Task 2: `updateStep` type-swap + arg/env handlers + `addStep` command skeleton

**Files:** Modify `studio/js/form-handlers.js` (`updateStep` line 546; `addStep` line 96)

- [ ] **Step 1: Type-swap in `updateStep`**

Replace `updateStep` (lines 546-560) with a version that, on a `type` change, swaps the field set and re-renders:

```javascript
function updateStep(index, field, value) {
    const node = config.nodes[index];

    if (field === 'type') {
        const newType = value === 'command' ? 'command' : 'http';
        node.type = newType;
        if (newType === 'command') {
            delete node.method; delete node.url; delete node.headers; delete node.body;
            delete node.skipDefaultHeaders;
            if (node.command === undefined) node.command = '';
            if (!Array.isArray(node.args)) node.args = [];
        } else {
            delete node.command; delete node.args; delete node.cwd; delete node.env; delete node.statusFrom;
            if (node.method === undefined) node.method = 'GET';
            if (node.url === undefined) node.url = '';
        }
        saveToLocalStorage();
        renderSteps();
        updatePreview();
        return;
    }

    if (value === undefined || value === '') {
        delete node[field];
    } else {
        node[field] = value;
    }

    // Re-render header on name/id/method change (type handled above)
    if (field === 'name' || field === 'id' || field === 'method') {
        renderSteps();
    }

    saveToLocalStorage();
    updatePreview();
}
```

> `launchBrowser` is intentionally NOT deleted on swap (shared field).

- [ ] **Step 2: Add arg/env handlers**

Add these functions to `form-handlers.js` (near `updateStep`):

```javascript
function addStepArg(index) {
    const node = config.nodes[index];
    if (!Array.isArray(node.args)) node.args = [];
    node.args.push('');
    saveToLocalStorage();
    renderSteps();
    updatePreview();
}

function updateStepArg(index, argIndex, value) {
    const node = config.nodes[index];
    if (!Array.isArray(node.args)) node.args = [];
    node.args[argIndex] = value;
    saveToLocalStorage();
    updatePreview();
}

function removeStepArg(index, argIndex) {
    const node = config.nodes[index];
    if (!Array.isArray(node.args)) return;
    node.args.splice(argIndex, 1);
    saveToLocalStorage();
    renderSteps();
    updatePreview();
}

function addStepEnv(index) {
    const node = config.nodes[index];
    if (!node.env || typeof node.env !== 'object') node.env = {};
    // find a unique placeholder key
    let key = 'NEW_VAR';
    let n = 1;
    while (Object.prototype.hasOwnProperty.call(node.env, key)) { key = `NEW_VAR_${n++}`; }
    node.env[key] = '';
    saveToLocalStorage();
    renderSteps();
    updatePreview();
}

function updateStepEnvKey(index, oldKey, newKey) {
    const node = config.nodes[index];
    if (!node.env || newKey === oldKey) return;
    if (!newKey) return;
    const val = node.env[oldKey];
    delete node.env[oldKey];
    node.env[newKey] = val;
    saveToLocalStorage();
    renderSteps();
    updatePreview();
}

function updateStepEnvValue(index, key, value) {
    const node = config.nodes[index];
    if (!node.env) node.env = {};
    node.env[key] = value;
    saveToLocalStorage();
    updatePreview();
}

function removeStepEnv(index, key) {
    const node = config.nodes[index];
    if (!node.env) return;
    delete node.env[key];
    saveToLocalStorage();
    renderSteps();
    updatePreview();
}
```

> These are plain function declarations in a classic (non-module) script, so they're globally reachable from inline `onclick` exactly like the existing `addStep`/`updateStep` — no `window.` assignment is required. (If a future bundler/linter needs it, also do `window.addStepArg = addStepArg`, etc.)

- [ ] **Step 3: `addStep` command skeleton**

In `addStep` (line 96), extend the `newStep` creation (lines 121-134) so a command node can be created. Change the `nodeDetails` branch to honor a `type`:

```javascript
    const newStep = nodeDetails
        ? (nodeDetails.type === 'command'
            ? { name: nodeDetails.name, id: nodeDetails.id, type: 'command', command: nodeDetails.command || '', args: nodeDetails.args || [] }
            : { name: nodeDetails.name, id: nodeDetails.id, method: nodeDetails.method, url: nodeDetails.url, headers: {}, body: {} })
        : { name: "New Node", method: "GET", url: "", headers: {}, body: {} };
```

- [ ] **Step 4: Manual check**

Refresh Studio. Switch a node to Command, add two arguments and one env var, edit `cwd`/`statusFrom`; confirm the JSON preview (right pane) updates live and `method`/`url`/`headers`/`body` are removed from that node. Switch back to HTTP; confirm command fields are removed and `method`/`url` return. Confirm the config still validates (no command-node errors from leftover HTTP fields).

- [ ] **Step 5: Commit**

```bash
git add studio/js/form-handlers.js
git commit -m "feat(studio): command-node create/edit handlers (type swap, args, env)"
```

---

### Task 3: Add-Node modal "Command" starter

**Files:** Modify `studio/index.html` (Add-Node modal ~191-485) and `studio/js/form-handlers.js` (the modal's confirm handler / `showAddNewNodeModal`)

- [ ] **Step 1: Add a type choice + command input to the Add-Node modal**

In the "Add New Node" modal markup in `studio/index.html` (the new-node form that has `#newNodeMethod` / `#newNodeUrl` / `#autoGenerateNodeDetails`, ~396-485), add:
- a `#newNodeType` `<select>` (HTTP / Command) above the method/url group,
- a `#newNodeCommand` text input in a `#newNodeCommandGroup` div (hidden by default),
- wrap the existing method/url inputs in a `#newNodeHttpGroup` div.

Add an inline `onchange="toggleNewNodeType(this.value)"` on the select. Add `toggleNewNodeType(type)` to `form-handlers.js`:

```javascript
function toggleNewNodeType(type) {
    const http = document.getElementById('newNodeHttpGroup');
    const cmd = document.getElementById('newNodeCommandGroup');
    const isCmd = type === 'command';
    if (http) http.style.display = isCmd ? 'none' : '';
    if (cmd) cmd.style.display = isCmd ? '' : 'none';
}
```

- [ ] **Step 2: Generate command id/name + build `nodeDetails` in `confirmCreateNode`**

`generateNodeDetails(method, url)` (form-handlers.js:230) derives id/name from the URL — command nodes have no URL, so add a parallel helper:

```javascript
function generateCommandNodeDetails(command) {
    const base = (command || 'command').split(/[\\/]/).pop().replace(/\.[^.]+$/, '');
    const id = ('cmd-' + base).toLowerCase().replace(/[^a-z0-9-]/g, '') || 'cmd';
    const name = 'Run ' + (command || 'command');
    return { type: 'command', command: command || '', args: [], id, name };
}
```

In `confirmCreateNode()` (form-handlers.js:262), **replace** the existing `let nodeDetails = null; if (url) { … }` block (~268-273) with a type-aware version (it reuses the existing `method`/`url`/`autoGenerate` reads above it):

```javascript
    const nodeType = document.getElementById('newNodeType')?.value || 'http';
    let nodeDetails = null;
    if (nodeType === 'command') {
        const command = document.getElementById('newNodeCommand').value.trim();
        nodeDetails = autoGenerate
            ? generateCommandNodeDetails(command)
            : { type: 'command', command, args: [], id: '', name: 'New Command Node' };
    } else if (url) {
        nodeDetails = autoGenerate
            ? generateNodeDetails(method, url)
            : { method, url, id: '', name: 'New Node' };
    }
```

(`addStep`'s `newStep` builder already handles `nodeDetails.type === 'command'` from Task 2 Step 3.)

- [ ] **Step 3: Sticky-modal compliance**

Confirm the Add-Node modal is opened sticky (`backdrop:'static'`, `keyboard:false`) per the UI Styling Guide. If it currently uses `new bootstrap.Modal(el)` without options, switch it to the project's sticky helper (`configureModal(...)` / the modal-bridge) so the modal can't be dismissed by backdrop click. (Touch only this modal.)

- [ ] **Step 4: Manual check**

Refresh Studio. Open Add-Node, choose **Command**, enter a command, confirm; a new command node is inserted (open, with command skeleton). Clicking outside the modal does not dismiss it.

- [ ] **Step 5: Commit**

```bash
git add studio/index.html studio/js/form-handlers.js
git commit -m "feat(studio): Command starter in Add-Node modal"
```

---

## Chunk 2: Result rendering

### Task 4: New core helper `command-result-view.js` (+ unit test for `formatStepLabel`)

**Files:** Create `studio/js/command-result-view.js`; Modify `studio/index.html`; Create `tests/formatStepLabel.test.js`; Modify `tests/test-suite.js`

- [ ] **Step 1: Write the failing unit test for `formatStepLabel`**

`formatStepLabel` must be pure (no DOM) so it can be Node-tested. Create `tests/formatStepLabel.test.js`:

```javascript
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `node tests/formatStepLabel.test.js`
Expected: FAIL — `command-result-view.js` does not exist yet (`ENOENT`).

- [ ] **Step 3: Create `studio/js/command-result-view.js`**

```javascript
/**
 * Shared rendering helpers for command-node results.
 * Core module (loaded before optional features) so Flow Runner (core) and
 * Try-it-Out (feature) both reuse it. No external dependencies.
 */
(function () {
    'use strict';

    function escapeHtml(text) {
        if (text === null || text === undefined) return '';
        if (typeof text !== 'string') text = String(text);
        // Prefer DOM escaping in the browser; fall back to manual for Node tests.
        if (typeof document !== 'undefined' && document.createElement) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }
        return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function isCommandLike(x) {
        return !!x && (x.type === 'command' ||
            (x.request && x.request.type === 'command') ||
            (x.body && typeof x.body.exitCode !== 'undefined'));
    }

    /**
     * One-line label for a step / request-details object.
     */
    function formatStepLabel(stepLike) {
        if (!stepLike) return '';
        const isCommand = stepLike.type === 'command' || (stepLike.request && stepLike.request.type === 'command');
        if (isCommand) {
            const src = (stepLike.command !== undefined || stepLike.args !== undefined) ? stepLike : (stepLike.request || {});
            const args = Array.isArray(src.args) ? src.args.join(' ') : '';
            return `cmd: ${src.command || ''}${args ? ' ' + args : ''}`.trim();
        }
        return `${stepLike.method || ''} ${stepLike.url || ''}`.trim();
    }

    /**
     * Rich panels for a command response body { exitCode, stdout, stderr, json }.
     * Defends against missing/partial body.
     */
    function renderCommandResultPanels(body) {
        body = body || {};
        const exit = (typeof body.exitCode === 'number') ? body.exitCode : null;
        const exitClass = exit === 0 ? 'text-success' : 'text-danger';
        const exitBadge = `<span class="badge ${exit === 0 ? 'bg-success' : 'bg-danger'}">Exit ${exit === null ? '?' : exit}</span>`;
        const preStyle = "background: var(--bg-surface); color: var(--text-primary); border: 1px solid var(--border-color);";

        const stdout = body.stdout || '';
        const stderr = body.stderr || '';
        const hasJson = body.json !== null && body.json !== undefined;

        const stderrPanel = stderr.trim().length > 0 ? `
            <div class="mb-2">
                <label class="form-label small text-danger mb-1"><i class="bi bi-exclamation-triangle me-1"></i>stderr</label>
                <pre class="p-2 small mb-0" style="${preStyle} border-color: var(--text-danger, #dc3545);">${escapeHtml(stderr)}</pre>
            </div>` : '';

        const jsonPanel = hasJson ? `
            <div class="mb-2">
                <label class="form-label small mb-1">parsed json</label>
                <pre class="p-2 small mb-0" style="${preStyle}">${escapeHtml(JSON.stringify(body.json, null, 2))}</pre>
            </div>` : '';

        return `
            <div class="command-result">
                <div class="mb-2">${exitBadge}</div>
                <div class="mb-2">
                    <label class="form-label small mb-1">stdout</label>
                    <pre class="p-2 small mb-0" style="${preStyle}">${escapeHtml(stdout)}</pre>
                </div>
                ${stderrPanel}
                ${jsonPanel}
            </div>
        `;
    }

    const api = { formatStepLabel, renderCommandResultPanels, isCommandLike };
    if (typeof window !== 'undefined') {
        window.formatStepLabel = formatStepLabel;
        window.renderCommandResultPanels = renderCommandResultPanels;
        window.isCommandLike = isCommandLike;
    }
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
```

- [ ] **Step 4: Run to verify it passes**

Run: `node tests/formatStepLabel.test.js`
Expected: PASS — `formatStepLabel.test.js: all assertions passed`

- [ ] **Step 5: Load the helper as a core script**

In `studio/index.html`, add it to the core scripts (after `state.js`, before `flow-runner.js` — it must load before the features that call it). Insert near line 762:

```html
    <script src="js/command-result-view.js"></script>
```

- [ ] **Step 6: Wire into the test suite**

In `tests/test-suite.js` (created in Phase 1, Task 8), add `'formatStepLabel.test.js'` to the `tests` array. If you are running Phase 2 before Phase 1 is implemented, first create `tests/test-suite.js` per Phase 1 Task 8 (a runner that `execFileSync`s each listed test file with `process.execPath` and exits non-zero on any failure).

- [ ] **Step 7: Run the suite**

Run: `npm test`
Expected: PASS (Phase 1 tests + `formatStepLabel.test.js`).

- [ ] **Step 8: Commit**

```bash
git add studio/js/command-result-view.js studio/index.html tests/formatStepLabel.test.js tests/test-suite.js
git commit -m "feat(studio): shared command-result-view helper + formatStepLabel test"
```

---

### Task 5: Server payloads — `type` + command request on all three endpoints

**Files:** Modify `bin/flowsphere.js`

> **Prerequisite:** Phase 1 Task 7 must be implemented — it adds `buildRequestLog` (in `lib/executor.js`, Phase 1 Task 4) and routes each endpoint's `request` through it and tags step logs/payloads with `type`. If `buildRequestLog` is absent from `lib/executor.js` / `bin/flowsphere.js` still emits HTTP-shaped `request` objects, implement Phase 1 Tasks 4 and 7 first. This task fills the two remaining gaps (`step_start` `type`; any missing `type` on `/api/execute-node`) and verifies all three endpoints.

- [ ] **Step 1: `step_start` must carry `type` (+ command label fields)**

In `/api/execute-stream`, the `step_start` event (~750) sends `{ step, id, name, method, url }`. Add `type` and, for command nodes, `command`/`args` (raw node values are fine here):

```javascript
          sendEvent('step_start', {
            step: stepNum,
            id,
            name,
            type: node.type || 'http',
            method,
            url,
            ...(node.type === 'command' ? { command: node.command, args: node.args } : {})
          });
```

- [ ] **Step 2: Verify `/api/execute-stream` `step` events and `/api/execute-step`/`/api/execute-node` payloads carry `type` + command `request`**

Confirm (from Phase 1) that: every `sendEvent('step', stepLog)` stepLog has `type` and `request = buildRequestLog(requestDetails)`; `/api/execute-step` success and failure `stepLog` have `type` + `buildRequestLog(...)`; `/api/execute-node` success and failure payloads have `type` + `buildRequestLog(...)`. If any is missing (e.g. Phase 1 left `/api/execute-node` `type` optional), add it. Each command `request` must be `{ command, args, cwd, env-masked }` (Phase 1's `buildRequestLog` masks env).

- [ ] **Step 3: Manual check (smoke)**

Start `node bin/flowsphere.js studio` from the repo root (default port **3737** — use the port printed at startup if it differs). POST a command node to `/api/execute-node` and confirm the JSON response has `type:'command'` and `request.command`:

```powershell
$c = @{ id='c'; type='command'; command='node'; args=@('tests/fixtures/mock-client.js','--status','200','--answer','hi') }
$cb = @{ node=$c; config=@{ nodes=@($c) } } | ConvertTo-Json -Depth 6
$cr = Invoke-RestMethod -Uri http://localhost:3737/api/execute-node -Method Post -ContentType 'application/json' -Body $cb
"$($cr.type) $($cr.request.command)"   # expect: command node
```
Stop the server with `Stop-Process -Id <PID>`.

- [ ] **Step 4: Commit**

```bash
git add bin/flowsphere.js
git commit -m "feat(studio): emit type + command request from all execution endpoints"
```

---

### Task 6: Flow Runner command rendering

**Files:** Modify `studio/js/flow-runner.js` (`updateModalWithStep` ~1059, `replaceStepPlaceholder` ~1232, `displayExecutionResults` ~1556; the `step_start` placeholder render)

- [ ] **Step 1: Use `formatStepLabel` for the step label everywhere**

In `updateModalWithStep`, `replaceStepPlaceholder`, the `step_start` placeholder renderer, and `displayExecutionResults`, replace the `${stepData.method} ${stepData.url}` (and equivalents) summary/title strings with `formatStepLabel(stepData)`. (For `displayExecutionResults`, use `formatStepLabel(log)` per log entry.)

- [ ] **Step 2: Render command result panels**

In the response region of `updateModalWithStep` and `replaceStepPlaceholder` (where `escapeHtml(JSON.stringify(stepData.response.body, …))` is rendered, ~1155-1167 / ~1332-1344), branch:

```javascript
const responseHtml = (stepData.type === 'command' || (stepData.response && stepData.response.body && typeof stepData.response.body.exitCode !== 'undefined'))
    ? renderCommandResultPanels(stepData.response.body)
    : `<pre class="json-preview-code ..." style="...">${escapeHtml(JSON.stringify(stepData.response.body, null, 2))}</pre>`;
```
Use `responseHtml` in place of the existing response `<pre>`. The request panel (`highlightSubstitutionsInJSON(stepData.request, …)`) is unchanged — it already renders the command request object (env masked). Guard for `renderCommandResultPanels` existence (`typeof renderCommandResultPanels === 'function'`) since it's core but be defensive.

Apply the **same branch** in `displayExecutionResults` (the final log viewer, ~1556-1669) where it renders `JSON.stringify(log.response.body, null, 2)` (~1619-1633), so completed command steps show the rich panels there too (branch on `log.type === 'command'` or the `body.exitCode` presence).

- [ ] **Step 3: Manual check**

Refresh Studio. Run `tests/config-test-command-basic.json` (open it in Studio or paste the JSON) through **Flow Runner** ("Go with the Flow"). Confirm: the step shows a `cmd: …` label (not blank), the request panel shows command/args/cwd/env (env masked), and the response shows an **Exit 0** badge + stdout panel + (if present) stderr + parsed-json panels. Repeat with `…-chaining.json` and `…-condition.json`.

- [ ] **Step 4: Manual check — step-by-step / auto-step**

Run the same config in Flow Runner **step-by-step** and **auto-step** modes. Confirm the placeholder (from `step_start`) shows `cmd: …` and the rendered step shows the rich panels identically.

- [ ] **Step 5: Commit**

```bash
git add studio/js/flow-runner.js
git commit -m "feat(studio): command-aware rendering in Flow Runner"
```

---

### Task 7: Try-it-Out command rendering

**Files:** Modify `studio/js/try-it-out.js` (`showResultsModal` ~542, `updateResultsModal` ~818)

- [ ] **Step 1: Command-aware request section**

In `showResultsModal`/`updateResultsModal`, where the Request section reads `result.request.method/url/headers/body`, branch on `result.type === 'command'` (or `result.request?.type === 'command'`): render `command`, `args` (joined), `cwd`, and `env` (already masked) using the existing labeled layout / `highlightSubstitutionsInJSON(result.request, result.substitutions)`. Use `formatStepLabel(result)` for any method/url heading.

- [ ] **Step 2: Command-aware response section**

Where the Response section renders `JSON.stringify(result.response.body, …)`, branch: for command, call `renderCommandResultPanels(result.response.body)`.

- [ ] **Step 3: Manual check**

Refresh Studio (ensure the `try-it-out` feature is enabled). "Engage Node" on a command node; confirm the request section shows command/args/cwd/env(masked) and the response shows the rich panels.

- [ ] **Step 4: Commit**

```bash
git add studio/js/try-it-out.js
git commit -m "feat(studio): command-aware rendering in Try-it-Out"
```

---

## Chunk 3: Autocomplete, schemas, templates, docs

### Task 8: Command response schema storage (Try-it-Out)

**Files:** Modify `studio/js/try-it-out.js` (`storeResponseSchema` ~1433; the schema-builder used before it)

- [ ] **Step 1: Build a command-shaped schema and tag the wrapper**

The "Store Response Schema" button builds a schema from `result.response.body` and calls `storeResponseSchema(node, schema)`. For a command node the body is `{ exitCode, stdout, stderr, json }` — build the schema to reflect that shape (drill into `json` so `.json.*` suggestions exist). In `storeResponseSchema` (wrapper at ~1452), add a distinct `nodeType` tag and replace the HTTP `method`/`url` metadata for command nodes:

```javascript
        config.responseSchemas[node.id] = {
            nodeId: node.id,
            nodeName: node.name || (node.type === 'command' ? 'cmd: ' + (node.command || '') : (node.method || 'GET') + ' ' + (node.url || '')),
            nodeType: node.type === 'command' ? 'command' : 'http',
            ...(node.type === 'command'
                ? { command: node.command || '' }
                : { method: node.method || 'GET', url: node.url || '' }),
            schema: schema,
            timestamp: new Date().toISOString()
        };
```

> Do NOT put `type:'command'` on the wrapper — `schema` itself uses a structural `type` (e.g. `'object'`). Use `nodeType`.

- [ ] **Step 2: Guard the stored-schema summary renderer**

`ui-renderer-bootstrap.js` (~296-356) renders stored schemas with `schemaData.method || 'GET'` and `schemaData.url`. For `nodeType === 'command'` schemas, render a command summary (e.g. `cmd: <command>`) instead of `method/url`, or guard the undefined values.

- [ ] **Step 3: Manual check**

Refresh Studio. Engage a command node, click **Store Response Schema**; confirm it stores without error and the stored-schemas list shows a command-appropriate summary (not "GET undefined").

- [ ] **Step 4: Commit**

```bash
git add studio/js/try-it-out.js studio/js/ui-renderer-bootstrap.js
git commit -m "feat(studio): store command-shaped response schema for command nodes"
```

---

### Task 9: Autocomplete for command outputs

**Files:** Modify `studio/js/autocomplete.js` (response-reference suggestion builders ~359-432)

- [ ] **Step 1: Suggest command outputs for command-producing nodes**

Where autocomplete builds `{{ .responses.<id>… }}` suggestions from prior nodes, branch on the prior node's type (look it up in `config.nodes` by id, or via the stored schema's `nodeType`):
- **Command node** ⇒ always offer the four fixed outputs `.exitCode`, `.stdout`, `.stderr`, `.json`, and when a stored schema exists, drill into `.json.*` (apply the existing schema-field builder to the schema's `json` sub-shape).
- **HTTP node** ⇒ unchanged.

- [ ] **Step 2: Manual check**

Refresh Studio (ensure `autocomplete` enabled). Create a command node with id `client`, then in a later node's argument/URL type `{{ .responses.client.` — confirm `.exitCode/.stdout/.stderr/.json` appear. After Engaging `client` and storing its schema (Task 8), confirm `{{ .responses.client.json.` drills into the stored JSON fields.

- [ ] **Step 3: Commit**

```bash
git add studio/js/autocomplete.js
git commit -m "feat(studio): autocomplete command outputs (.exitCode/.stdout/.stderr/.json)"
```

---

### Task 10: Command-node template

**Files:** Create `studio/templates/nodes/command/run-client.json`; Modify `studio/js/import-nodes.js` (category labels/icons ~102-115)

- [ ] **Step 1: Create the template**

```json
{
  "templateName": "Run client script",
  "description": "Run a local client (e.g. a Python SDK client) and map its result onto the response model",
  "category": "command",
  "requiredVariables": ["prompt", "azureKey", "azureEndpoint"],
  "nodes": [
    {
      "id": "run-client",
      "name": "Run client script",
      "type": "command",
      "command": "python",
      "args": ["client.py", "--prompt", "{{ .vars.prompt }}", "--json"],
      "cwd": "./clients",
      "env": { "AZURE_OPENAI_API_KEY": "{{ .vars.azureKey }}", "AZURE_OPENAI_ENDPOINT": "{{ .vars.azureEndpoint }}" },
      "statusFrom": ".status",
      "validations": [
        { "httpStatusCode": 200 },
        { "jsonpath": ".json.answer", "exists": true },
        { "jsonpath": ".exitCode", "equals": 0 }
      ]
    }
  ]
}
```

> **Template shape matters:** the importer (`import-nodes.js`) reads `template.templateName`, `template.description`, `template.requiredVariables`, and `template.nodes` (an **array**), and `/api/templates/nodes` injects `id` from the filename. Do **not** use `{ name, description, node }` (that shape from the change-impact-guide doc is outdated and would import 0 nodes). Verify `processTemplate(...)` (the importer's id-rename / variable-extraction step) handles a command node (no method/url) — it processes node objects generically, but confirm during the manual check.

- [ ] **Step 2: Add a "command" category label/icon**

In `import-nodes.js` `renderCategories()` (~102-115), add an entry to **both** inline maps (the icon value is bare — it's rendered as `bi bi-${icon}`):

```javascript
    const categoryIcons = {
      'auth': 'shield-lock',
      'user-input': 'person-circle',
      'validation': 'check-circle',
      'conditional': 'shuffle',
      'command': 'terminal'
    };
    const categoryNames = {
      'auth': 'Authentication',
      'user-input': 'User Interaction',
      'validation': 'Validation Examples',
      'conditional': 'Conditional Flow',
      'command': 'Command'
    };
```

- [ ] **Step 3: Manual check**

Refresh Studio. Open the template library (Import Nodes); confirm a **Command** category appears with the "Run client script" template; insert it and confirm a command node is added with the command fields populated.

- [ ] **Step 4: Commit**

```bash
git add studio/templates/nodes/command/run-client.json studio/js/import-nodes.js
git commit -m "feat(studio): command-node template + category"
```

---

### Task 11: Docs + example config

**Files:** Create `examples/config-command-node.json`; Modify `README.md`, `CLAUDE.md`

> Confirm specifics with the user before writing prose (per repo convention). Then:

- [ ] **Step 1: Example config**

Create `examples/config-command-node.json` — a small runnable example using `node tests/fixtures/mock-client.js` (so it runs without Python), plus a comment-style `name`/`description` showing the command-node shape.

- [ ] **Step 2: README**

Add a "Command nodes" subsection: config format (`type`, `command`, `args`, `cwd`, `env`, `statusFrom`), the `{ exitCode, stdout, stderr, json }` response model, status mapping, passing headers via args/env, and a short example.

- [ ] **Step 3: CLAUDE.md**

Add `type`/`command`/`args`/`cwd`/`env`/`statusFrom` to the Node-Level Properties documentation and a note on the command-result UI pattern (rich panels via `command-result-view.js`).

- [ ] **Step 4: Manual check**

`"n" | node bin/flowsphere.js examples/config-command-node.json` runs successfully.

- [ ] **Step 5: Commit**

```bash
git add examples/config-command-node.json README.md CLAUDE.md
git commit -m "docs: document command nodes (README, CLAUDE.md, example)"
```

---

### Task 12: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Unit suite green**

Run: `npm test`
Expected: PASS (Phase 1 tests + `formatStepLabel.test.js`).

- [ ] **Step 2: End-to-end manual checklist** (browser, `node bin/flowsphere.js studio` from repo root)

1. Add a Command node from the Add-Node modal; confirm the command skeleton + sticky modal.
2. Switch a node HTTP↔Command; confirm the field-set swap and that the JSON preview stays valid (no leftover cross-type fields).
3. Edit `command`, add/remove `args`, add `env` rows, set `cwd`/`statusFrom`; confirm preview updates and autocomplete fires on `{{` in args/env/cwd.
4. Run `tests/config-test-command-basic.json`, `…-chaining.json`, `…-condition.json` through **Flow Runner**; confirm `cmd:` label, request panel (env masked), exit-code/stdout/stderr/json panels.
5. Run one in **step-by-step** and **auto-step** modes; confirm placeholder + rich panels.
6. **Engage** a command node; confirm rich rendering; **Store Response Schema**; confirm a later step autocompletes `{{ .responses.<id>.json.* }}` and `.exitCode`.
7. Trigger a command validation error (missing `command`, or `url` on a command node); confirm it shows in the validation modal.
8. Insert the command template from the library.
9. Toggle the `autocomplete` and `try-it-out` features off (Settings); confirm graceful degradation — editor + Flow Runner still work.

- [ ] **Step 3: (Only if a check revealed a bug)**

Fix under the relevant task; stage only the specific file(s) you changed (never `git add -A`).

---

## Out of scope (future)

Process `stdin`; configurable output cap; a DOM/integration test harness; a dedicated command-output log visualizer.
