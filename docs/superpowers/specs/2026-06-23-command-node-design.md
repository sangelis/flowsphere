# Command Node — Design Spec

- **Date:** 2026-06-23
- **Status:** Approved (Phase 1 design)
- **Topic:** A new `command` node type that runs a local process (e.g. a Python client) as a sequence step and maps its result onto FlowSphere's existing response model.

---

## 1. Problem statement

FlowSphere executes sequential HTTP requests from a JSON config. The user needs to test their application **through a specific client SDK** — a Python script that uses LangGraph's `AzureChatOpenAI` to send requests — rather than via FlowSphere's own `axios` HTTP client. The goal is to uncover SDK-specific quirks and gotchas (auth handling, headers, retries, rate-limit/error behavior) that a raw HTTP call would not reveal.

Concretely: run `python client.py <args>` as a step, capture its result, and **process that result just as if it were an HTTP POST** — so the same validations, response-chaining, conditions, and logging all apply.

## 2. Goals

- Add a `command` node type that runs an arbitrary local executable with arguments, captured output, exit code, working directory, environment variables, and a timeout.
- Map the process result onto the existing `response` model so `validateResponse`, `conditions`, response-chaining (`{{ .responses.id.* }}`), and logging work **unchanged**.
- Surface the **real upstream HTTP status** the SDK observed (reported by the script) as `response.status`, so `{ httpStatusCode: … }` validations test what the SDK actually saw.
- Keep the change small and surgical; remain 100% backward-compatible with existing configs.
- Work everywhere `executeStep` is used: the CLI and all three Studio execution endpoints.

## 3. Non-goals (Phase 1)

- **Studio UI** for command nodes (editor form, Flow Runner / Try-it-Out result rendering, node templates, validation-UI text). The engine runs command nodes through the Studio endpoints already; the *visual* layer is a separate Phase 2 spec.
- A general handler-registry / plugin architecture for node types (revisit when a *third* node type appears).
- Migrating the user's actual Python client (a follow-on task once the feature exists).
- `stdin` input to the process (deferred; YAGNI).

## 4. Key design decisions (settled during brainstorming)

1. **Integration approach:** dispatch by node `type` inside `executeStep` (not a parallel call path, not a registry yet). New module `lib/command-runner.js` mirrors `lib/http-client.js`.
2. **Response model:** hybrid. `body = { exitCode, stdout, stderr, json }` where `json` is parsed stdout when it is valid JSON, else `null`. Robust to SDK log noise while still rewarding clean-JSON output.
3. **Status:** `response.status` carries the **script-reported HTTP status**, read from a configurable jsonpath `statusFrom` (default `.status`) into the parsed stdout JSON. Fallback when not reported: `exitCode === 0 → 200`, non-zero → `500`. This keeps the default `{ httpStatusCode: 200 }` check working uniformly.
4. **Command form:** split `command` + `args` array, run via `spawn` with `shell: false` (injection-safe). No single-string/shell form.
5. **Environment:** support `cwd` and `env` (values substituted, layered over inherited `process.env`). A relative `cwd` resolves against `process.cwd()` (shell semantics), identical in CLI and Studio.
6. **Failure semantics:** only **spawn failures** (`ENOENT`), **timeouts**, and **exceeding the output cap** throw (→ step fails, sequence stops, like network errors). A **non-zero exit is normal data** (status 500, body populated); validations decide pass/fail.
7. **Headers:** passed explicitly via `args` (curl-style `--header "Name: value"`) or `env`, fully substituted. Command nodes have **no `headers` field** and do **not** inherit `defaults.baseUrl` / `defaults.headers` (those shape an HTTP request that a command node never makes).
8. **Scope:** phased. This spec is Phase 1 (engine + config schema + CLI + validator + tests).

---

## 5. Config schema (Section A)

A command node is an entry in `nodes[]`, discriminated by `type`. Backward-compatible: a missing `type` (every existing config) means `"http"`.

```json
{
  "id": "call-client",
  "name": "Run LangGraph Azure ChatOpenAI client",
  "type": "command",
  "command": "python",
  "args": [
    "client.py",
    "--prompt", "{{ .vars.prompt }}",
    "--token", "{{ .responses.auth.json.token }}",
    "--json"
  ],
  "cwd": "./clients/azure-openai",
  "env": {
    "AZURE_OPENAI_API_KEY": "{{ .vars.azureKey }}",
    "AZURE_OPENAI_ENDPOINT": "{{ .vars.azureEndpoint }}"
  },
  "timeout": 60,
  "statusFrom": ".status",
  "conditions": [],
  "validations": [
    { "httpStatusCode": 200 },
    { "jsonpath": ".json.answer", "exists": true },
    { "jsonpath": ".exitCode", "equals": 0 }
  ]
}
```

### Field semantics

| Field | Required | Meaning |
|-------|----------|---------|
| `type` | no | `"command"`. Absent / `"http"` → unchanged HTTP behavior. |
| `command` | **yes** | Executable to run (`python`, `python3`, or a venv path like `.venv/Scripts/python.exe`). |
| `args` | no | Array of strings, each run through the existing substitution engine. Default `[]`. |
| `cwd` | no | Working directory. Absolute paths used as-is; a **relative path resolves against `process.cwd()`** — the directory where `flowsphere` / `flowsphere studio` was launched (shell semantics). Identical in CLI and Studio (the server writes configs to a temp dir, so config-relative resolution is not viable). |
| `env` | no | KEY→value map; values substituted; layered over inherited `process.env` (node wins). |
| `timeout` | no | Seconds. Reuses existing default-merging. On expiry the process is killed and the step fails like an HTTP timeout. |
| `statusFrom` | no | jsonpath into parsed-stdout JSON for the reported HTTP status. Default `.status`. |
| `validations` | no | Same array as HTTP nodes. `httpStatusCode` targets `response.status`; `jsonpath` targets `.exitCode`, `.stdout`, `.stderr`, `.json.*`. |
| `conditions` | no | Unchanged. |
| `launchBrowser` | no | Still works; extracts from `body` (e.g. `".json.authUrl"`). |

`method`, `url`, `headers`, `body` are **rejected** on a command node (config-validator error) to avoid confusion.

`defaults` may carry `cwd` / `env` shared across command nodes (`env` merged with node values winning; `cwd` taken from the node, else default), in addition to `timeout` / `validations`. These default keys are type-checked by the config-validator and covered by a merge test (§7, §8).

### Substitution

`args`, `cwd`, and `env` values support the full substitution syntax for free, because `executeStep` already substitutes the whole node before dispatch:

- Global vars: `{{ .vars.azureKey }}`
- Response chaining: `{{ .responses.auth.json.token }}`
- User input: `{{ .input.username }}`
- Dynamic: `{{ $guid }}`, `{{ $timestamp }}`

### Passing headers to your script

Since FlowSphere does not make the request (the script does, via the SDK), "passing headers" means handing header data to the script, which applies them to the SDK call (e.g. `AzureChatOpenAI(default_headers=…)`). Two equivalent transports, both substituted:

**A — curl-style repeated args (recommended, universal):**

```json
"args": [
  "client.py",
  "--header", "api-key: {{ .vars.azureKey }}",
  "--header", "x-correlation-id: {{ $guid }}",
  "--header", "Authorization: Bearer {{ .responses.auth.json.token }}"
]
```

Script side: `argparse` `--header` with `action="append"`, split on the first `:`, feed into `default_headers`.

**B — one JSON env var:**

```json
"env": { "REQUEST_HEADERS": "{\"api-key\":\"{{ .vars.azureKey }}\",\"x-id\":\"{{ $guid }}\"}" }
```

Script side: `json.loads(os.environ["REQUEST_HEADERS"])`.

> **Secrets in headers:** `args` are recorded in execution logs (and are visible in the OS process list), so prefer transport **B** (`env`) for secret headers like `api-key` / bearer tokens — `env` values are masked in logs (§6). Use `args` for non-secret headers.

---

## 6. Execution & response model (Section B)

New module **`lib/command-runner.js`** (mirrors `http-client.js`), exporting `executeCommand(options)` where options are the **already-substituted** `{ command, args, cwd, env, timeout, statusFrom }`.

### Flow

1. `spawn(command, args, { cwd: resolvedCwd, env: { ...process.env, ...env }, shell: false })`, where `resolvedCwd` is `cwd` when absolute, else `path.resolve(process.cwd(), cwd)`. Accumulate `stdout` / `stderr`, enforcing a combined-output cap of **10 MB** (module constant `MAX_OUTPUT_BYTES`). Exceeding it kills the process and throws `Command output exceeded 10 MB`. (A configurable cap is deferred — fixed constant in Phase 1.)
2. **Timeout:** a timer kills the process on expiry — `SIGTERM`, then `SIGKILL` after a **2 s** grace if it has not exited — and throws `Command timeout after Ns`, exactly like the HTTP timeout.
3. **On exit** `(exitCode, signal)`, build the response:
   - Parse stdout as JSON → `json` (`null` if not JSON).
   - **Status:** if `json` exists and `extractValue(json, statusFrom)` is numeric → use it; else `exitCode === 0 ? 200 : 500`.
   - `body = { exitCode, stdout, stderr, json }`; `headers: {}`; `duration`.
   - `statusText`: `exit <code>` (or `killed (<signal>)` when terminated).

### What throws vs. what is data

- **Throws** (→ step fails, sequence stops, like network errors): spawn failure (`ENOENT` → `Command not found: <command>`), timeout, exceeding `maxBuffer`.
- **Normal data** (no throw): a non-zero exit. The response is returned with status 500 and a populated body; validations decide pass/fail. This keeps quirk-hunting flexible.

### Example

Script prints `{"status":429,"error":"rate limited"}` and exits 0:

```js
response = {
  status: 429, statusText: "exit 0", headers: {},
  body: {
    exitCode: 0,
    stdout: '{"status":429,"error":"rate limited"}',
    stderr: "<SDK retry/log noise>",
    json: { status: 429, error: "rate limited" }
  },
  duration: 2.41
}
```

Stored as `{ id, status: 429, body }`. So `{ httpStatusCode: 200 }` **fails → sequence stops** (the SDK quirk is caught); `{{ .responses.call-client.json.error }}` resolves to `"rate limited"`.

### Module boundary

`executeCommand` returns **only the response object** `{ status, statusText, headers, body, duration }`, exactly mirroring `executeRequest` in `http-client.js`. It does **not** build `requestDetails` or handle substitutions. `executeStep` (the caller) substitutes the node, calls `executeCommand`, then assembles the standard `{ response, requestDetails, substitutions }` it returns to the orchestrator — identical to how it wraps `executeRequest` today. `requestDetails = { type: "command", command, args, cwd, env }`.

### Logging & secret masking

`env` is the credential channel, so it is masked wherever it would otherwise reach a log:
- `requestDetails.env` — values replaced with `"***"` (keys preserved).
- Substitution records whose `path` starts with `env.` — `value` replaced with `"***"`. (Substitution tracking comes free from the `executeStep`-level substitution, recording paths like `args.1`, `env.AZURE_OPENAI_API_KEY`.)

`args` are **not** masked (they are logged for debuggability and are already visible in the OS process list); the schema guidance directs secret headers to `env` for this reason. This is the command-node policy; HTTP-node logging is unchanged.

---

## 7. Integration points (Section C)

### Changes

- **`lib/executor.js` → `executeStep`:** after the existing `substituteWithTracking(step, context)`, dispatch on `substitutedStep.type`. `"command"` → `executeCommand({ command, args, cwd, env, timeout, statusFrom })` (returns the response object only); otherwise → today's `executeRequest`. `executeStep` then assembles `{ response, requestDetails, substitutions }` with `requestDetails.type` set accordingly — same wrapping for both paths.
- **`lib/executor.js` → `runSequence`:** add a small `describeStep(node)` helper (command → `cmd: python client.py …`; http → `METHOD url`) used in the skip / success / fail console lines and the `executionLog` entries. Log entries gain a `type` field; command entries record `command` / `args` / `cwd` (env masked) under `request`.
- **`lib/executor.js` → `mergeWithDefaults`:** type-guard so command nodes inherit `timeout` / `validations` / `cwd` / `env` but **not** `baseUrl` / `headers`.
- **`cwd` resolution:** no context plumbing needed. `command-runner` resolves a relative `cwd` against `process.cwd()` directly (absolute paths as-is). Identical in the CLI and all Studio endpoints, and it avoids the temp-file trap (`/api/execute` and `/api/execute-stream` write the config to `os.tmpdir()`, so a config-relative base would point at the temp dir).
- **`lib/config-validator.js`:** branch on `type`. A `command` node requires a non-empty `command` string; validates `args` (string array) / `cwd` (string) / `env` (object of string values) / `statusFrom` (string) / `timeout` (number) types; and **rejects** `method` / `url` / `headers` / `body`. Also type-checks `defaults.cwd` (string) and `defaults.env` (object of string values). `type` is restricted to `http` | `command`. HTTP rules unchanged.
- **`bin/flowsphere.js`:** the CLI path works via `runSequence`. `/api/execute` (Studio "run all") calls `runSequence` in-process on a temp config, so it inherits command-node support through the CLI path. The three direct endpoints (`/api/execute-node`, `/api/execute-step`, `/api/execute-stream`) already call `executeStep`, so they run command nodes functionally; add minimal guards so any `method` / `url` assumptions in their response payloads do not crash on command nodes (pretty browser rendering is Phase 2).

### Deliberately unchanged (proof the design fits)

- **`lib/validator.js`** — reads `response.status` + `response.body`, both populated. ✓
- **`lib/conditions.js`** — same; later steps can branch on a command node's `.json.*` / `.exitCode`. ✓
- **`lib/substitution.js`** — operates on the node generically; `args` / `env` substitution is free. ✓

Blast radius: `executor.js` + `config-validator.js` + new `command-runner.js`, with light guards in `bin/flowsphere.js`.

---

## 8. Testing (Section D)

Matches the repo's plain-Node test style (scripts that `require` lib modules and assert).

- **Hermetic mock client:** add `tests/fixtures/mock-client.js`, run via **`node`** (`process.execPath`), so tests do not depend on Python. It prints configurable JSON and exits with a configurable code: `--status 429`, `--exit 1`, `--stderr "…"`, `--no-json`.
- **`command-runner` unit tests:** JSON stdout → `statusFrom` status; non-JSON → `json:null`, status from exit (0→200); non-zero exit → status 500, no throw; reported 429 → status 429; timeout → throws; `ENOENT` → `Command not found`; **output cap exceeded → throws**; stderr captured; `env` layering; relative `cwd` resolved against `process.cwd()`.
- **`config-validator` tests:** valid command node; missing `command`; `args` not a string array; `method` / `url` / `headers` / `body` present → error; bad `type`; `defaults.env` not an object → error.
- **`executor` tests:** `mergeWithDefaults` applies `defaults.cwd` / `defaults.env` to a command node (env merged, node wins) and does **not** apply `baseUrl` / `headers`; masking hides `requestDetails.env` values and `env.*` substitution records while leaving `args` visible.
- **Integration configs** in `tests/` (using `node` + the fixture): a basic command run; **HTTP → command chaining** (`{{ .responses.x.json.* }}` into args); a later step's **condition** branching on a command node's `.exitCode` / `.json.*`.
- **Discovered issue:** `npm test` references `tests/test-suite.js`, which does not exist — the script is already broken. Flag in the implementation plan and propose wiring the new tests into a runnable entry (and optionally repairing `npm test`) rather than leaving it silently broken.

### Edge cases (documented)

- Large stdout → `maxBuffer` cap → kill + clear error.
- Process killed by signal (timeout) → `statusText` reflects it.
- Empty / array / primitive JSON stdout.
- `statusFrom` resolving to a non-numeric value → fallback to exit-derived status.
- Args that become empty after substitution → passed as `""`.
- **Windows:** with `shell: false`, `.bat` / `.cmd` need a shell; `command` must be a real executable (`python` / `python.exe`).

---

## 9. Phase 2 (out of scope here)

Studio UI for command nodes — editor form, Flow Runner / Try-it-Out result rendering (exit code + stdout/stderr panels + json view), node templates, validation-UI messages. Reuse the existing validation/substitution display patterns from the UI styling guide. Its own spec.

## 10. Documentation

Per repo convention, README / CLAUDE.md are **not** auto-updated; doc updates are ask-first during implementation. This spec is the design artifact.
