# API FlowSphere

[![npm version](https://img.shields.io/npm/v/flowsphere.svg)](https://www.npmjs.com/package/flowsphere)
[![npm downloads](https://img.shields.io/npm/dm/flowsphere.svg)](https://www.npmjs.com/package/flowsphere)
[![license](https://img.shields.io/npm/l/flowsphere.svg)](https://github.com/ymoud/flowsphere/blob/main/LICENSE)

**Design in Studio. Execute Anywhere.**

---

**Automate multi-step API workflows** — Define once, run anywhere. No coding required.

API FlowSphere is a professional industrial-grade platform for managing and executing API workflows. It combines **FlowSphere Studio** (visual web app with live execution) and **FlowSphere CLI** (command-line executor) to give you complete control over complex API sequences.

## What It Does

Executes API call sequences where each step uses data from previous responses. Perfect for testing authentication flows, onboarding journeys, or any multi-step API process.

**Example:** Login → Get user profile → Create resource → Verify creation
- Each step automatically passes tokens, IDs, and data to the next
- **Execute via CLI or browser UI** — same engine, your choice of interface
- Visual config editor with live execution (no JSON editing needed)
- Works on Windows, macOS, and Linux (truly cross-platform with Node.js)

## Why It Exists

Complex API workflows require multiple requests with interdependent data. This tool eliminates manual curl commands and brittle shell scripts by providing:
- **Reusable workflows** saved as JSON configurations
- **Smart variable passing** between steps (no manual copy-paste)
- **Built-in validation** to catch failures immediately
- **Visual editing** with autocomplete for non-developers

## Installation

### NPM (Recommended)

```bash
# Install globally
npm install -g flowsphere

# Verify installation
flowsphere --version
```

### Local Development

```bash
# Clone repository
git clone <your-repo-url>
cd flowsphere

# Install dependencies
npm install

# Run locally
node bin/flowsphere.js config.json
```

## Quick Start

### 1. Create and Run Workflows

**Option A: Create from scratch** (no JSON knowledge required):
```bash
# Launch visual editor to create new flows
flowsphere studio
```

Studio provides templates to get started:
- **Empty** — Start with a blank canvas
- **Simple API Flow** — Basic request/response example
- **OAuth Flow** — Authentication with browser launch
- **User Input** — Interactive prompts

**Option B: Run existing workflows** (FlowSphere CLI):
```bash
# Try a learning example
flowsphere examples/config-simple.json
```

**That's it.** The CLI handles everything: making requests, extracting data, passing it forward, and validating responses.

**Prerequisites:** Node.js 14.17.0 or higher

**Advanced:**
```bash
# Validate config without executing (check for errors)
flowsphere config.json --validate

# Resume from a specific step (useful for debugging)
flowsphere examples/config.json --start-step 6

# Display version
flowsphere --version

# Show help
flowsphere --help
```

### 2. FlowSphere Studio (Visual Editor + Live Execution)

**Create API workflows visually — no JSON knowledge required.**

Launch Studio with a single command:

```bash
flowsphere studio
```

This will:
- Start a local server on **port 3737**
- Automatically open your browser to `http://localhost:3737`
- Give you access to the full visual config editor **with live execution**

**Build flows from scratch or edit existing ones:**
- **Start fresh** with built-in templates:
  - Empty workflow
  - Simple API call example
  - OAuth authentication flow
  - User input prompts
- **Edit existing configs** by loading JSON files
- **Import from Postman** — convert existing collections automatically

**Key Studio features:**
- **Live Flow Execution** — Run your API sequences directly in the browser with real-time streaming results
  - Color-coded status indicators (✅ success, ❌ failed, ⊘ skipped)
  - Expandable request/response details with syntax highlighting
  - **Variable highlighting** — see which values were substituted (color-coded by type)
  - User input prompts during execution flow
  - OAuth browser launch for authentication flows
  - Save execution logs and re-run sequences with one click
- **Engage Node (Try it Out)** — Test individual nodes in isolation without running the entire sequence
  - Intelligent dependency mocking (automatically prompts for required values from previous responses)
  - **Response schema storage** — optionally save response structure for enhanced autocomplete
  - **Schema-based autocomplete** — field suggestions with type indicators (string, number, object, array)
  - **Schema comparison** — detect changes between runs and choose to replace or merge schemas
  - Works for both successful and failed requests (captures any valid JSON response)
- **Form-based editing** — no manual JSON editing needed, includes templates (OAuth flow, user input, etc.)
- **Smart autocomplete** — type `{{` to see available variables, responses, inputs with types
- **Import from Postman** — convert existing Postman collections automatically
- **Auto-save** to browser (never lose work)
- **Live JSON preview** with one-click export to file

### 3. Programmatic API

Use FlowSphere as a library in your Node.js projects:

```javascript
const FlowSphere = require('flowsphere');

// Run a config file
const result = await FlowSphere.run('config.json');
console.log(`Executed: ${result.stepsExecuted}, Skipped: ${result.stepsSkipped}`);

// Run with options
await FlowSphere.run('config.json', {
  startStep: 5,
  enableDebug: true,
  saveLog: true
});
```

## Core Capabilities

| Feature | Description |
|---------|-------------|
| **Dual Execution Modes** | Run flows via CLI (terminal) or Studio UI (browser) with identical results |
| **Live Flow Runner** | Execute sequences in browser with real-time streaming, color-coded highlighting, and detailed logs |
| **Config Validation** | Pre-execution validation catches errors early with clear, actionable messages; CLI `--validate` flag and Studio UI integration |
| **Dynamic Variables** | Generate UUIDs and timestamps: `{{ $guid }}`, `{{ $timestamp }}` |
| **Smart Data Passing** | Reference any field from previous responses: `{{ .responses.login.token }}` |
| **Variable Highlighting** | Color-coded visualization of substituted values (variables, responses, dynamic values, user input) |
| **Conditional Logic** | Execute steps based on previous results with AND logic (e.g., premium vs. free user flows) |
| **User Interaction** | Prompt for input (passwords, codes) or auto-launch browser (OAuth flows) |
| **Response Validation** | Verify status codes and response fields; fail fast on errors |
| **Flexible Formats** | JSON and form-urlencoded bodies supported |
| **Visual Feedback** | Clear status indicators: ✅ success / ❌ failed / ⊘ skipped |
| **Execution Logging** | Save detailed logs of all requests/responses for debugging and audit trails |
| **Cross-Platform** | Native Windows, macOS, Linux support (no WSL needed) |

## Config Validation System

FlowSphere includes a comprehensive validation system that catches configuration errors **before execution**, saving time and preventing confusing runtime failures.

### Features

- **Pre-Execution Validation** — Every flow is validated before running (CLI and Studio)
- **Manual Validation** — CLI `--validate` flag and Studio "Validate" button
- **Auto-Validation** — Silent validation on file load with badge indicator (✅ valid / 🔴 error count)
- **Inline JSON Feedback** — Real-time error highlighting for invalid JSON in textareas
- **Clear Error Messages** — Actionable suggestions for fixing issues

### CLI Usage

```bash
# Validate without executing
flowsphere config.json --validate

# Example output
❌ Config Validation Failed (2 errors)

Error 1:
  Node: "get-premium-data" (nodes[3])
  Field: nodes[3].id
  Issue: Duplicate node ID: "get-premium-data"
  Fix: Each node must have a unique ID

Error 2:
  Node: "another-node" (nodes[4])
  Field: nodes[4].body.text
  Issue: Malformed placeholder: Found 1 opening "{{" but 0 closing "}}"
  Fix: Check: "{{ .responses.user-login.test" - all placeholders need both {{ and }}
```

### Studio UI

- **Validate Button** — Manually check config with detailed error modal
- **Auto-Validation** — Silent check on file load shows badge (✅ / 🔴)
- **Inline JSON Errors** — Real-time feedback with red borders and error messages
- **Pre-Execution Check** — Blocks execution if validation fails

### What It Validates

**Structure Validations** (external file loads):
- Missing required fields (id, method, url)
- Invalid HTTP methods
- Invalid field types
- Malformed placeholder syntax

**Value Validations** (all loads):
- ✅ Duplicate node IDs
- ✅ Non-existent node references in placeholders
- ✅ Malformed placeholders (missing `{{` or `}}`)
- ✅ JSON body type mismatch with Content-Type header
- ✅ Invalid condition syntax
- ✅ Invalid validation rules
- ✅ Circular references in JSON bodies

**Two-Tier System:** Studio's UI prevents structure errors, but users can still create value errors (e.g., delete a node that's referenced elsewhere). FlowSphere validates both.

➡️ See [Technical Design](docs/technical/config-validation-system.md) for architecture details.

## Examples

See the [`examples/`](examples/) folder for complete, ready-to-run configurations:

| File | Description |
|------|-------------|
| [`config-simple.json`](examples/config-simple.json) | **Start here** — Basic workflow with public JSONPlaceholder API |
| [`config-oauth-example.json`](examples/config-oauth-example.json) | OAuth authentication flow with browser launch |
| [`config-test-features.json`](examples/config-test-features.json) | User input prompts and interactive workflows |
| [`config-command-node.json`](examples/config-command-node.json) | **Command nodes** — run local processes and chain their output |
| [`config.json`](examples/config.json) | Full-featured example with authentication and validation |

**Test configurations** (in [`tests/`](tests/) folder):

| File | Description |
|------|-------------|
| [`config-test-condition-variables.json`](tests/config-test-condition-variables.json) | Comprehensive conditional execution tests |
| [`config-test-variables.json`](tests/config-test-variables.json) | Demonstrates global variables feature |
| [`config-test-multiple-validations.json`](tests/config-test-multiple-validations.json) | Tests all validation types |
| [`config-test-comparisons.json`](tests/config-test-comparisons.json) | Tests numeric comparison validations |

**Run any example:**
```bash
flowsphere examples/config-simple.json
flowsphere tests/config-test-condition-variables.json
```

---

## Technical Reference

### Configuration Format

```json
{
  "variables": {
    "apiKey": "your-api-key",
    "userId": "12345"
  },
  "defaults": {
    "baseUrl": "https://api.example.com",
    "headers": { "Content-Type": "application/json" },
    "timeout": 30,
    "validations": [
      { "httpStatusCode": 200 }
    ]
  },
  "nodes": [
    {
      "id": "login",
      "name": "Authenticate",
      "method": "POST",
      "url": "/login",
      "body": { "username": "user", "password": "pass" },
      "validations": [
        { "jsonpath": ".token", "exists": true }
      ]
    },
    {
      "id": "getProfile",
      "name": "Get Profile",
      "method": "GET",
      "url": "/profile",
      "headers": { "Authorization": "Bearer {{ .responses.login.token }}" }
    }
  ]
}
```

### Node Fields

| Field | Required | Description |
|-------|----------|-------------|
| `id` | ✓ | Unique identifier (letters, numbers, underscore, hyphen) |
| `name` | ✓ | Human-readable description |
| `method` | ✓ | HTTP method (GET, POST, PUT, DELETE, PATCH) |
| `url` | ✓ | Full URL or relative path (with baseUrl) |
| `headers` | | HTTP headers (merged with defaults) |
| `body` | | Request body (JSON object) |
| `timeout` | | Request timeout in seconds (overrides defaults) |
| `userPrompts` | | User input prompts: `{"key": "Prompt text"}` |
| `conditions` | | Array of conditional execution rules (AND logic) |
| `validations` | | Array of validation rules (overrides defaults) |
| `launchBrowser` | | JSONPath to URL for browser launch |

> The fields above describe HTTP nodes (the default). A node can instead run a local
> process by setting `"type": "command"` — see [Command Nodes](#command-nodes) below.

### Command Nodes

A node with `"type": "command"` runs a local executable instead of making an HTTP
request. Its output is mapped onto the same response model used by HTTP nodes, so
validations, conditions, and `{{ .responses.* }}` substitution all work identically.

| Field | Required | Description |
|-------|----------|-------------|
| `type` | ✓ | Set to `"command"` to run a process instead of an HTTP request |
| `command` | ✓ | Executable to run (e.g. `node`, `python`, `./script.sh`) |
| `args` | | Array of string arguments passed to the command |
| `cwd` | | Working directory for the process (defaults to the current directory) |
| `env` | | Object of environment variables for the process (values are masked in logs) |
| `statusFrom` | | JSONPath into the command's parsed JSON stdout used to derive the response status (defaults to `.status`) |

`id`, `name`, `timeout`, `conditions`, `validations`, `userPrompts`, and `launchBrowser` work
the same as for HTTP nodes (`launchBrowser` reads its URL from the command's response body,
e.g. `.json.authUrl`). Only the request-shaping fields `method`, `url`, `headers`, and `body`
are rejected on command nodes.

**Response model.** A command node produces a response body shaped like:

```json
{
  "exitCode": 0,
  "stdout": "raw stdout text",
  "stderr": "raw stderr text",
  "json": { /* stdout parsed as JSON, when possible */ }
}
```

Validate or chain any of these via JSONPath, e.g. `.exitCode`, `.stdout`,
`.json.answer`, `.json.items.[0].id`.

**Status mapping.** The response status is derived as follows:
- `statusFrom` defaults to `.status`. If the parsed stdout `json` contains a numeric value at
  that path, that value becomes the response status (a string like `"500"` is coerced to a number).
- Otherwise — no numeric value at that path — the status is `200` when the process exits `0`,
  and `500` when it exits non-zero.

Point `statusFrom` at a different field to read the status from elsewhere in the JSON output, or
at a path that won't match to always use the exit-code mapping.

A status outside the success range fails the node just like a failing HTTP status.

**Passing secrets / headers.** Pass values to the process through `args` or `env`.
Environment values support variable substitution and are masked (`***`) in execution
logs and the Studio UI.

**Example:**

```json
{
  "id": "run-client",
  "name": "Run a local client and map its result onto the response model",
  "type": "command",
  "command": "node",
  "args": ["tests/fixtures/mock-client.js", "--status", "200", "--answer", "{{ .vars.answerText }}"],
  "env": { "EXAMPLE_TOKEN": "{{ .vars.answerText }}-secret" },
  "statusFrom": ".status",
  "validations": [
    { "jsonpath": ".json.answer", "equals": "FlowSphere" },
    { "jsonpath": ".exitCode", "equals": 0 }
  ]
}
```

A later node can chain the parsed output with
`{{ .responses.run-client.json.answer }}`. See
[`examples/config-command-node.json`](examples/config-command-node.json) for a
complete, runnable workflow.

### Variable Substitution

#### Dynamic Variables
```
{{ $guid }}        - Generates unique UUID v4 for each occurrence
{{ $timestamp }}   - Current Unix timestamp (seconds since epoch)
```

#### Global Variables
```
{{ .vars.apiKey }}
{{ .vars.userId }}
```

Reference values defined in the `variables` section at config level.

#### Named Response References
```
{{ .responses.nodeId.field.subfield }}
{{ .responses.login.token }}
{{ .responses.getUser.id }}
```

Reference responses from previous nodes using their node ID.

#### User Input
```
{{ .input.variableName }}
{{ .input.username }}
{{ .input.password }}
```

### Conditional Execution

Execute nodes conditionally based on previous responses. Uses **AND logic** — node executes only if ALL conditions are met.

```json
{
  "conditions": [
    {
      "source": "node",
      "node": "login",
      "httpStatusCode": 200
    },
    {
      "source": "node",
      "node": "getUser",
      "field": ".isPremium",
      "equals": "true"
    },
    {
      "source": "variable",
      "variable": "apiKey",
      "exists": true
    }
  ]
}
```

**Condition Types:**
- `httpStatusCode` - Check HTTP status (node source only)
- `equals` / `notEquals` - Value comparison
- `exists` - Field existence check
- `greaterThan` / `lessThan` - Numeric comparisons
- `greaterThanOrEqual` / `lessThanOrEqual` - Numeric comparisons with equality

**Condition Sources:**
- `node` - Check response from previous node
- `variable` - Check global variable
- `input` - Check user input value

### Response Validation

Validations are specified as an array. Each validation can check HTTP status code or JSON path criteria:

```json
{
  "validations": [
    { "httpStatusCode": 201 },                            // HTTP status code
    { "jsonpath": ".id", "exists": true },               // Field must exist
    { "jsonpath": ".[0].userId", "exists": true },       // Array element field
    { "jsonpath": ". | length", "greaterThan": 0 },      // Array length
    { "jsonpath": ".name", "equals": "John" },           // Field value equals
    { "jsonpath": ".error", "notEquals": "failed" },     // Field value not equals
    { "jsonpath": ".count", "greaterThan": 0 },          // Numeric comparison
    { "jsonpath": ".age", "lessThanOrEqual": 120 }       // Multiple criteria supported
  ]
}
```

**Default validations:** If no `validations` array is specified, defaults to `httpStatusCode: 200`. Set in `defaults.validations` to apply defaults to all nodes.

### Array Operations

FlowSphere supports advanced array operations in JSON paths:

```json
{
  "jsonpath": ".[0].userId",           // Access first element field
  "jsonpath": ".users[2].name",        // Access specific array index
  "jsonpath": ". | length",            // Get array length
  "jsonpath": ".data.items | length"   // Get nested array length
}
```

## Performance

**FlowSphere Node.js is significantly faster than shell scripts:**
- **2-10x faster execution** (0.010-0.084s vs 0.128-0.198s per step)
- Efficient async HTTP operations
- Optimized variable substitution
- Native JSON parsing

## Architecture

```
flowsphere/
├── bin/
│   └── flowsphere.js          # CLI entry point + Express server for Studio
├── lib/
│   ├── executor.js            # Core execution engine (shared by CLI & Studio)
│   ├── substitution.js        # Variable substitution with tracking
│   ├── http-client.js         # HTTP request handling
│   ├── validator.js           # Response validation
│   ├── conditions.js          # Conditional logic
│   ├── logger.js              # Execution logging
│   └── utils.js               # Utilities
├── studio/                    # Visual config editor + Flow Runner
│   ├── index.html
│   ├── css/
│   │   └── styles.css         # UI styles + variable highlighting
│   └── js/
│       ├── config-editor.js   # Visual config editor
│       ├── flow-runner.js     # Live execution UI
│       ├── autocomplete.js    # Smart variable autocomplete
│       └── ...                # Other UI modules
├── examples/                  # Example configs
├── tests/                     # Test configs
└── package.json
```

**Key Design Principle:** The execution engine (`lib/executor.js`) is shared between CLI and Studio, ensuring 100% identical behavior across both interfaces.

## Postman Integration

Convert Postman collections to FlowSphere configs:

```bash
node postman-tools/parse-postman.js
```

Reads from `Postman/` folder and generates optimized configs in `scenarios/`.

## Contributing

We welcome contributions! FlowSphere is designed to be:
- **Extensible:** Add new validation types, condition sources, or output formats
- **Maintainable:** Modular architecture with clear separation of concerns
- **Well-tested:** Comprehensive test suite in `tests/` folder

## Legacy Bash Version

The original Bash implementation is archived in [`legacy/`](legacy/) folder for reference. It is no longer maintained. All existing configs are 100% compatible with the Node.js version.

## License

MIT

---

**Built with ❤️ for API developers and testers**

Need help? Check the [examples](examples/) or open an issue!
