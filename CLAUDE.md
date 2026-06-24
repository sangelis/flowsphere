# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## 🚨 REQUIRED: Read Architecture Documentation FIRST

**BEFORE implementing any feature or checking any code files, you MUST read:**

📖 **[docs/technical/core-architecture.md](docs/technical/core-architecture.md)** - How the system works

This document contains critical architecture information including:
- ✅ Where config is stored (NOT `window.config`!)
- ✅ How to modify config in Studio (import from `state.js`, call `renderEditor()`)
- ✅ How execution works (CLI vs Studio vs Try it Out)
- ✅ Common mistakes to avoid
- ✅ State management rules
- ✅ Integration points between components

🔗 **[docs/technical/change-impact-guide.md](docs/technical/change-impact-guide.md)** - What to update when making changes

This document contains "chain of events" showing what files need updating for different types of changes:
- ✅ Adding a new config field (top-level, node-level)
- ✅ Adding a new validation type or condition type
- ✅ Adding a new substitution syntax
- ✅ Adding a new API endpoint or UI feature
- ✅ Complete dependency maps and file relationships
- ✅ Common scenarios and quick reference guides

🎛️ **[docs/technical/toggleable-features-guide.md](docs/technical/toggleable-features-guide.md)** - How to make features toggleable

**⚠️ IMPORTANT: All new features should be toggleable by default.**

This document explains the toggleable feature patterns used in FlowSphere:
- ✅ When to make features toggleable (and when not to)
- ✅ 4 implementation patterns: Feature Registry, Built-in Features, Config-Level, Node Properties
- ✅ Naming conventions and testing requirements
- ✅ Real-world examples from the codebase
- ✅ Pattern selection flowchart and comparison table

**Why this matters:**
Agents frequently make preventable mistakes like accessing `window.config` (doesn't exist), forgetting to re-render the UI after config changes, or duplicating executor logic instead of reusing modules. They also often forget to update all necessary files when adding features (e.g., adding a config field but forgetting to update the validator, UI, docs, examples, and tests). Reading these documents first will save you time and prevent incomplete implementations.

**Workflow:**
1. Read `docs/technical/core-architecture.md` (Quick Start section)
2. Read `docs/technical/change-impact-guide.md` (find your change type)
3. **If adding a new feature**: Read `docs/technical/toggleable-features-guide.md` to implement toggleable pattern
4. Understand where config is stored and how to access it
5. Identify all files that need updating for your change type
6. Review relevant code files for your specific feature
7. Implement using the correct patterns and update ALL required files

---

## Overview

This is an HTTP sequence runner tool (FlowSphere) that executes sequential HTTP requests defined in JSON configuration files. The tool is implemented in **Node.js** for cross-platform compatibility and npm distribution.

## Running the Tool

**Execute a sequence:**
```bash
# Using Node.js (current implementation)
node bin/flowsphere.js examples/config-simple.json

# Or if installed globally via npm
flowsphere examples/config-simple.json
```

**Legacy Bash version (deprecated):**
```bash
./legacy/flowsphere examples/config-simple.json
```

**Available config examples (in `examples/` folder):**
- `config-simple.json` - Basic example using JSONPlaceholder API
- `config.json` - Full-featured example with authentication flow
- `config-oauth-example.json` - OAuth flow example with browser launch and user input
- `config-test-features.json` - Demonstrates user input prompts and variable substitution
- `config-user-input.json` - User input demonstration
- `config-comprehensive-demo.json` - **Comprehensive demo with ALL features** (12 nodes)
  - User input prompts (username, userType)
  - Conditional execution (premium vs basic users)
  - Multiple validation types (exists, equals, greaterThan, lessThan, etc.)
  - Variable substitution (global vars, responses, user input)
  - Dynamic placeholders ($guid, $timestamp)
  - All HTTP methods (GET, POST, PUT, DELETE)
  - Skipped steps based on conditions
  - Array length validations

**Test configs (in `tests/` folder):**
- `config-test-variables.json` - Demonstrates global variables feature
- `config-test-multiple-validations.json` - Demonstrates multiple JSON path validations feature
- `config-test-defaults.json` - Tests defaults merging behavior
- `config-test-comparisons.json` - Tests numeric comparison validations

**Prerequisites:**
- Node.js 14.17.0 or higher
- npm (comes with Node.js)

**Install dependencies:**
```bash
npm install
```

## Architecture

### Core Components (Node.js)

**bin/flowsphere.js** (CLI entry point):
- Parses command-line arguments (--start-step, --version, --help, studio)
- Routes commands to appropriate handlers
- Launches Express server for `flowsphere studio` command

**lib/executor.js** (main execution engine):
- `runSequence()`: Orchestrates the entire sequence execution
- `executeStep()`: Executes individual HTTP requests
- `mergeWithDefaults()`: Merges step config with global defaults
- `promptUserInput()`: Collects user input interactively
- Response storage: Array `responses[]` maintains state across steps

**lib/substitution.js** (variable substitution engine):
- `replaceDynamicPlaceholders()`: Replaces `{{ $guid }}` and `{{ $timestamp }}`
- `substituteVariables()`: Replaces global vars, user input, and response references
- `substituteInObject()`: Recursively substitutes variables in objects/arrays
- Substitution order: Dynamic Variables → Global Variables → User Input → Response References

**lib/http-client.js** (HTTP request handling):
- `executeRequest()`: Executes HTTP requests with axios
- Timeout support (converts seconds to milliseconds)
- Automatic JSON parsing of responses
- Error handling for network issues and timeouts

**lib/validator.js** (response validation):
- `validateResponse()`: Validates HTTP responses against rules
- Supports HTTP status code validation
- Supports JSON path validations with multiple criteria
- Numeric comparisons (>, <, >=, <=)
- Existence checks and equality/inequality

**lib/conditions.js** (conditional execution):
- `evaluateCondition()`: Evaluates single condition
- `evaluateConditions()`: Evaluates multiple conditions with AND logic
- Supports node, variable, and input sources
- Detailed skip reasons with expected vs actual values

**lib/logger.js** (execution logging):
- `promptSaveLog()`: Interactive log saving prompt
- `saveLog()`: Saves execution log to JSON file
- Logs include all step details, responses, and skip reasons

**lib/utils.js** (utilities):
- `generateUUID()`: UUID v4 generation
- `getTimestamp()`: Unix timestamp generation
- `extractValue()`: JSON path extraction (supports arrays with `.[0]` and `. | length`)
- `colorize()`: Terminal color output
- `deepMerge()`: Object merging for defaults

**Config File Format:**
```json
{
  "enableDebug": false,              // Optional: enable debug logging (default: false)
  "variables": {                     // Optional: global variables accessible in all steps
    "apiKey": "my-secret-key",
    "userId": "12345"
  },
  "defaults": {
    "baseUrl": "https://api.example.com",
    "timeout": 30,                   // Request timeout in seconds
    "headers": { "Content-Type": "application/json" },
    "validations": [                 // Default validations applied to all steps
      { "httpStatusCode": 200 }
    ]
  },
  "nodes": [
    {
      "id": "step-id",               // Required unique identifier for the step
      "name": "Step description",
      "method": "GET|POST|PUT|DELETE|PATCH",
      "url": "/endpoint",            // Can be relative if baseUrl is set
      "timeout": 10,                 // Optional step-level timeout override
      "headers": {},                 // Merged with defaults
      "body": {},                    // Optional request payload
      "userPrompts": {},             // Optional user input prompts
      "conditions": [],              // Optional conditional execution (AND logic)
      "validations": [],             // Response validations (httpStatusCode + jsonpath)
      "launchBrowser": ".url"        // Optional: launch browser with URL from response
    }
  ]
}
```

**Command Nodes (`type: "command"`):**

A node can run a local process instead of an HTTP request by setting `type: "command"`. Its
output is mapped onto the same response model HTTP nodes use, so validations, conditions, and
`{{ .responses.* }}` substitution all work identically.

Command node properties (replace the request-shaping HTTP fields `method`/`url`/`headers`/`body`):
- `type`: `"command"` — selects the command runner (HTTP is the default when omitted)
- `command`: executable to run (e.g. `node`, `python`, `./script.sh`) — required
- `args`: array of string arguments passed to the command
- `cwd`: working directory for the process (defaults to current directory)
- `env`: object of environment variables for the process (values are masked in logs and the UI)
- `statusFrom`: JSONPath into the command's parsed JSON stdout used to derive the response status (defaults to `.status`)

`id`, `name`, `timeout`, `conditions`, `validations`, `userPrompts`, and `launchBrowser` work the
same as for HTTP nodes (`launchBrowser` reads its URL from the command response body). Only
`method`/`url`/`headers`/`body` are rejected on command nodes.

Command response body shape (validate/chain via JSONPath such as `.exitCode`, `.json.answer`):
```json
{ "exitCode": 0, "stdout": "raw stdout", "stderr": "raw stderr", "json": { /* parsed stdout */ } }
```

Status mapping: `statusFrom` defaults to `.status` — if the parsed stdout JSON has a numeric value
at that path it becomes the response status; otherwise exit `0` → `200`, non-zero exit → `500`.
See `examples/config-command-node.json`.

**Command-result UI pattern (Studio):** Command results are rendered with rich panels (exit code,
stdout, stderr, parsed JSON) via `studio/js/command-result-view.js` — a core helper loaded before
`ui-renderer-bootstrap.js` and reused by both Flow Runner (`flow-runner.js`) and Try it Out
(`try-it-out.js`). When adding UI that displays execution results, reuse `formatStepLabel()` and
`renderCommandResultPanels()` from that module rather than duplicating command-rendering logic.

### Key Features

**Dynamic Value Substitution:**
- **Dynamic variables** (Postman-style syntax):
  - `{{ $guid }}` - Generates a unique UUID v4 for each occurrence
  - `{{ $timestamp }}` - Inserts current Unix timestamp (seconds since epoch)
  - Used in: URLs, headers, request bodies
  - Each `{{ $guid }}` occurrence generates a new unique UUID
  - All `{{ $timestamp }}` occurrences in the same step get the same timestamp value
  - Example: `"requestId": "{{ $guid }}"` or `"timestamp": {{ $timestamp }}`
  - **Note**: This is NOT backwards compatible - the old `GENERATED_GUID` and `TIMESTAMP` syntax no longer works
- Global variables syntax: `{{ .vars.key }}`
  - References values defined in the `variables` section at config level
  - Useful for API keys, user IDs, common values used across multiple steps
  - Used in: URLs, headers, request bodies
  - Example: `{{ .vars.apiKey }}`
- Response syntax: `{{ .responses.stepId.field.subfield }}`
  - Named references: responses.stepId references step by its `id` field
  - Used in: URLs, headers, request bodies
  - Example: `{{ .responses.authenticate.token }}`
- User input syntax: `{{ .input.variableName }}`
  - References values collected from `userPrompts` in the same step
  - Used in: URLs, headers, request bodies
- Implementation: `substitute_variables()` uses regex matching to find and replace placeholders
- Substitution order: Dynamic Variables ($guid, $timestamp) → Global Variables → User Input → Response References

**Conditional Execution:**
- Steps execute only if ALL conditions are met (AND logic)
- Each step can have multiple conditions in the `conditions` array
- **Condition sources**:
  - `step`: Check response from a previous node (by node ID) - **use `"node"` field**
  - `variable`: Check a global variable value
  - `input`: Check a user input value
- **Condition types**:
  - `statusCode`: Check HTTP status of previous response (step source only)
  - `equals`/`notEquals`: Check for equality/inequality
  - `exists`: Check if field exists
  - `greaterThan`/`lessThan`: Numeric comparisons (supports integers and floats)
  - `greaterThanOrEqual`/`lessThanOrEqual`: Numeric comparisons with equality
- **Variable substitution in conditions**: All condition values support variable substitution
  - Global variables: `{{ .vars.key }}`
  - User input: `{{ .input.key }}`
  - Response references: `{{ .responses.nodeId.field }}`
  - Dynamic placeholders: `{{ $timestamp }}`, `{{ $guid }}`
  - Example: `"equals": "{{ .vars.expectedValue }}"`
- **Example**: Execute step only if user ID equals 1 AND user is active:
  ```json
  "conditions": [
    {"node": "get-user", "field": ".id", "equals": "1"},
    {"node": "get-user", "field": ".active", "equals": "true"}
  ]
  ```
- Skipped steps maintain array indexing (stored as empty responses)

**Validation:**
- **Unified validations array** - All validations (httpStatusCode + jsonpath) in one array
- **HTTP Status Code validation**: `{"httpStatusCode": 200}`
  - Validates HTTP response status code
  - If no httpStatusCode validation defined, defaults to 200
  - Can be set globally in `defaults.validations`
  - Example: `{"httpStatusCode": 201}`
- **JSON path validations**: Validate response body fields
  - Each validation must have `jsonpath` field
  - Optional criteria:
    - `exists`: true/false - check if field exists
    - `equals`: expected value - check for equality
    - `notEquals`: unwanted value - check for inequality
    - `greaterThan`: number - check if value is greater than threshold
    - `lessThan`: number - check if value is less than threshold
    - `greaterThanOrEqual`: number - check if value is >= threshold
    - `lessThanOrEqual`: number - check if value is <= threshold
  - Multiple validation criteria can be combined on the same path
  - If no criteria specified, defaults to checking that field exists
  - Numeric comparisons support integers and floats
- **Default validations**: Define in `defaults.validations` to apply to all steps
  - Steps without validations inherit default validations
  - Steps with validations override defaults completely
- **Example:**
    ```json
    {
      "defaults": {
        "validations": [
          { "httpStatusCode": 200 }
        ]
      },
      "nodes": [
        {
          "id": "create-user",
          "name": "Create user",
          "method": "POST",
          "url": "/users",
          "validations": [
            { "httpStatusCode": 201 },
            { "jsonpath": ".id", "exists": true, "greaterThan": 0 },
            { "jsonpath": ".email", "notEquals": "" },
            { "jsonpath": ".age", "greaterThanOrEqual": 18, "lessThanOrEqual": 120 }
          ]
        },
        {
          "id": "get-user",
          "name": "Get user (uses default validations)",
          "method": "GET",
          "url": "/users/1"
        }
      ]
    }
    ```
- Stops execution immediately on validation failure

**Timeout Control:**
- Request timeout in seconds (converted to milliseconds for axios)
- Can be set globally in `defaults.timeout`
- Can be overridden per step with step-level `timeout` property
- Step-level timeout takes precedence over default timeout
- Timeout failures are clearly reported with specific error messages
- Execution stops immediately on timeout

**User Input Prompts:**
- Collect user input interactively before executing a step
- Step property: `userPrompts` - object with key-value pairs (variable name: prompt message)
- Values accessible via `{{ .input.variableName }}` syntax
- Example:
  ```json
  {
    "name": "Login with credentials",
    "method": "POST",
    "url": "/login",
    "userPrompts": {
      "username": "Enter your username:",
      "password": "Enter your password:"
    },
    "body": {
      "user": "{{ .input.username }}",
      "pass": "{{ .input.password }}"
    }
  }
  ```
- User input is reset for each step that uses userPrompts
- Can be combined with response substitution in the same step

**Browser Launch:**
- Automatically open URLs in the default browser after successful step execution
- Step property: `launchBrowser` - jsonpath to extract URL from response
- Supports Windows (start), macOS (open), and Linux (xdg-open)
- Example:
  ```json
  {
    "name": "Get authorization URL",
    "method": "POST",
    "url": "/oauth/authorize",
    "launchBrowser": ".authorizationUrl"
  }
  ```
- Browser launches only if the jsonpath successfully extracts a URL
- Runs in background, doesn't block execution
- Useful for OAuth flows and interactive authentication

**Debug Logging:**
- Optional detailed execution logging for troubleshooting
- Config property: `enableDebug: true` (defaults to false)
- Shows variable substitution, step execution flow, and internal state
- Debug output goes to stderr, normal output to stdout

**Execution Logging:**
- Detailed logs saved to `logs/` directory in JSON format
- Each log file named with timestamp: `execution_log_YYYYMMDD_HHMMSS.json`
- Includes all request/response details, validations, and skip reasons
- Automatically prompted after each run (can be declined)
- Useful for debugging, auditing, and understanding workflow execution

## FlowSphere Studio (Visual Config Editor)

**studio/** provides a browser-based GUI for creating and editing configuration files without manually writing JSON.

The editor has a modular structure with separate HTML, CSS, and JavaScript files organized by functionality. See `studio/README.md` for detailed module documentation.

**Launching Studio:**
```bash
# Using the Node.js CLI (starts Express server automatically)
node bin/flowsphere.js studio

# Or if installed globally
flowsphere studio
```

This will start a local Express server on a random available port and automatically open your browser.

**Key Features:**
- Form-based editing with validation
- Auto-save to browser localStorage (never lose work)
- Live JSON preview with copy-to-clipboard
- Template-based config creation (Empty, Simple, OAuth, User Input)
- Download configs as JSON files
- Modular architecture for maintainability

**Intelligent Autocomplete:**
The editor includes context-aware autocomplete for the `{{ }}` variable substitution syntax:

- **Trigger**: Type `{{` in any text input or textarea
- **Suggestions shown**:
  - **Basic Syntax** (when you first type `{{`):
    - `$guid` - Generate unique UUID
    - `$timestamp` - Current Unix timestamp
    - `.responses.` - Access response by step ID
    - `.vars.` - Access global variables
    - `.input.` - Access user input prompts
  - **Global Variables**: Shows all variables defined in the `variables` section with their values
  - **Response References**: Shows available responses from previous steps by step ID
  - **User Input**: Shows prompt variables defined in the current step
- **Features**:
  - Positions dropdown at text caret for accurate placement
  - Filters suggestions as you type
  - Keyboard navigation: Arrow keys, Enter/Tab to select, Escape to close
  - Mouse selection: Click any suggestion
  - Works in all text fields: URLs, headers, body, conditions array, validations, modals

**Implementation details:**
- Uses mirror div technique for accurate caret positioning in textareas
- Handles horizontal/vertical scrolling correctly
- Accounts for all CSS properties affecting text layout
- Browser-specific handling (Firefox, Chrome, Safari)

**When to use:**
- Creating new configs without writing JSON manually
- Editing existing configs with visual feedback
- Learning the config format through form-based UI
- Quick testing of different configurations

## Postman Integration

**Convert Postman collections to config files:**
```bash
node postman-tools/parse-postman.js
```

**Parser capabilities:**
- Reads from `Postman/Onboarding Chatbot 2025.postman_collection.json`
- Resolves environment variables from `Postman/OnboardingApi.postman_environment.json`
- Sorts requests by numeric prefixes (1., 2., 3., etc.)
- Auto-detects dependencies between requests
- Auto-wires dependencies using `{{ .responses.stepId.field }}` syntax
- Handles Postman dynamic variables (`{{$guid}}`, `{{$timestamp}}`)
- Generates optimized config with defaults section
- Outputs to `scenarios/config-onboarding.json`

## Development Guidelines

**IMPORTANT - Git Workflow:**
- **NEVER commit changes without explicit user approval**
- **NEVER commit if the user has not tested the changes**
- Always wait for the user to test and verify changes before committing
- Only create commits when the user explicitly asks (e.g., "commit it", "commit this", "commit the changes")

## Documentation Structure

FlowSphere uses an organized documentation structure in the `/docs` directory:

```
ROADMAP.md                  (root level - high visibility for users)

docs/
├── features/               Feature specifications
├── technical/              Architecture & technical designs
├── implementation/         Implementation status & tracking
├── prompts/                AI prompts and branding guidelines (development artifacts)
└── INTERNAL-TASKS.md       Internal improvements & tooling
```

### docs/features/ - Feature Specifications

**Purpose:** User-facing feature specifications that define WHAT we're building.

**Content:**
- **Overview:** What the feature does and why it's valuable
- **Problem Statement:** What user problem does this solve?
- **Solution:** High-level approach to solving the problem
- **Key Features:** Bulleted list of capabilities
- **UI/UX Design:** Mockups, wireframes, user workflows
- **Implementation Phases:** Break large features into phases
- **Acceptance Criteria:** Testable requirements for completion
- **Benefits:** Value to users and use cases

**Example Files:**
- `flow-runner-execution-controls.md` - Execution modes (stop, step-by-step, auto-step)
- `swagger-openapi-import.md` - Import Swagger/OpenAPI specs
- `execution-log-visualizer.md` - Visual log analysis tool

**When to Create:**
- New user-facing feature in ROADMAP.md
- Feature requires multiple implementation phases
- Feature needs stakeholder/community review

### docs/technical/ - Architecture & Technical Designs

**Purpose:** Technical architecture documents that explain HOW systems work and integrate.

**Focus on Architecture, Not Implementation:**
- Describe **what** the feature does and **how it integrates**, not detailed code
- Document state management integration points (e.g., "uses global `config` from state.js")
- Specify existing functions to call (e.g., "trigger re-render with `renderEditor()`")
- Identify data structures and where they're stored (e.g., "nodes array in `config.nodes`")
- Describe UI interactions and user workflows
- Note edge cases and error handling approaches

**Avoid:**
- Detailed code snippets showing exact implementation
- Function internals or algorithm specifics
- Line-by-line implementation details

**Include:**
- Integration with existing systems (state management, UI rendering, APIs)
- Data flow between components
- Function names to call for specific actions
- Expected behavior and acceptance criteria
- Dependencies on existing code/modules

**Example - Good:**
```
**State Management Integration:**
- Must integrate with Studio's global `config` variable from state.js
- Modifications update `config.nodes` array directly
- Trigger UI update with `renderEditor()` function
- Variables added to `config.variables`, rendered with `renderGlobalVariables()`
```

**Example - Bad:**
```javascript
function addNode(node) {
  if (!config.nodes) {
    config.nodes = [];
  }
  config.nodes.push(node);
  renderEditor();
}
```

**Example Files:**
- `flow-execution-architecture.md` - How client-server SSE communication works

**When to Create:**
- Complex architectural patterns (e.g., SSE streaming, state management)
- System integration points (client-server communication)
- Design decisions that need documentation for future developers
- Cross-cutting concerns (authentication, error handling, etc.)

### docs/implementation/ - Implementation Status & Tracking

**Purpose:** Track implementation progress and document what was actually built.

**Content:**
- **Status:** Percentage complete or phase status
- **What Was Implemented:** Concrete changes made (client-side, server-side, etc.)
- **Current Issues:** Known bugs or blockers
- **Testing:** Test results and acceptance criteria checks
- **Files Modified:** List of changed files with line ranges
- **Next Steps:** What needs to be done next

**Example Files:**
- `phase1-stop-implementation-status.md` - Status of graceful interruption feature

**When to Create:**
- Multi-phase feature implementation tracking
- Complex features with multiple developers
- Features that need status updates for stakeholders
- Post-implementation documentation of what was actually built

**Note:** These are temporary documents - once implementation is complete, key information should be moved to feature specs or technical docs, and implementation docs can be archived.

### docs/prompts/ - AI Prompts and Development Artifacts

**Purpose:** Store AI prompts, branding guidelines, and other development artifacts used during feature development.

**Content:**
- API prompts used for feature development
- Theme and branding guidelines
- UI/UX prompt templates
- Execution mode branding specifications
- Logo and visual identity prompts

**When to Create:**
- Significant AI-assisted feature development that needs prompt documentation
- Branding or design work that needs to be documented for consistency
- Reusable prompt templates for future development

**Note:** These are development artifacts and are excluded from npm package distribution (see `.npmignore`).

### docs/INTERNAL-TASKS.md - Internal Improvements

**Purpose:** Track internal/infrastructure tasks that aren't user-facing features.

**What Belongs Here:**
- Infrastructure improvements (debug mode, logging)
- Developer experience (testing, CI/CD, tooling)
- Code quality (refactoring, documentation)
- Performance optimizations
- Security improvements

**What DOESN'T Belong Here:**
- User-facing features (belongs in ROADMAP.md)
- Feature specifications (belongs in docs/features/)

---

## Development Guidelines

**When modifying Node.js code:**
- Maintain cross-platform compatibility (use `path.join()` for file paths)
- Use native Node.js modules when possible (avoid shell commands)
- Follow the modular architecture (separate concerns into different lib/ files)
- Test on Windows, macOS, and Linux if making system-level changes
- All config files must remain 100% compatible with existing format

**Testing changes:**
```bash
# Test basic execution
node bin/flowsphere.js examples/config-simple.json

# Test conditional execution
node bin/flowsphere.js tests/config-test-condition-variables.json

# Test validations
node bin/flowsphere.js tests/config-test-multiple-validations.json

# Test variables
node bin/flowsphere.js tests/config-test-variables.json

# Test studio command
node bin/flowsphere.js studio
```

**Config file design:**
- Use `defaults` section to reduce duplication (baseUrl, timeout, common headers, default validations)
- Relative URLs (starting with `/`) are automatically prepended with baseUrl
- Step-level configs override defaults (headers are merged, timeout/validations override)
- Default validations apply to steps without validations; steps with validations override defaults completely
- Conditional steps reference only completed steps (step 3 can check responses 0, 1, or 2)
- All steps must have a unique `id` field for named references
- each time you implement a feature/bug fix dont automatically update documentation. Ask me first
- you should not create documentation files for bug fixes u make, unless i tell to do so.
- dont open a browser each time you make a change to the ui, instruct the user to refresh the page and provide them with a lclickable link
- when i ask you to commit, only commit changes you have made (even in a file) as files might be edited externally. Always be cautious not to commit something you havent written.
## UI Styling Guide

When implementing UI features in FlowSphere Studio, follow these consistent styling patterns to ensure uniform user experience across all features.

### Validation Display Pattern

**Use this exact pattern when displaying validation results** (used in Flow Runner and Try it Out):

```javascript
// Format validations
const validationParts = result.validations.map(v => {
    const icon = v.passed ? '<span class="text-success">✓</span>' : '<span class="text-danger">✗</span>';

    if (v.type === 'httpStatusCode') {
        const label = v.passed ? 'Validated' : 'Failed';
        return `
            <div class="ps-4 small">
                ${icon} ${label} status = <span class="text-warning">${v.actual}</span>${v.passed ? '' : ` (expected ${v.expected})`}
            </div>
        `;
    } else if (v.type === 'jsonpath') {
        const displayValue = typeof v.value === 'object'
            ? JSON.stringify(v.value)
            : String(v.value);
        const shortValue = displayValue.length > 80
            ? displayValue.substring(0, 77) + '...'
            : displayValue;
        const label = v.passed ? 'Extracted' : 'Failed';
        return `
            <div class="ps-4 small">
                ${icon} ${label} ${escapeHtml(v.path)} = <span class="text-warning">${escapeHtml(shortValue)}</span>
            </div>
        `;
    }
    return '';
});
```

**Key elements:**
- Icon: `✓` (text-success) for passed, `✗` (text-danger) for failed
- Label: `Validated`/`Extracted` for passed, `Failed` for failed
- Value color: `text-warning` (yellow/orange)
- Indentation: `ps-4` (padding-start: 1.5rem)
- Size: `small` class
- Always use `escapeHtml()` for user-provided values

### JSON/Code Display Pattern

**Use CSS variables for theme-aware displays:**

```html
<pre style="background: var(--bg-surface); color: var(--text-primary); border: 1px solid var(--border-color);" class="p-2 small">
    ${JSON.stringify(data, null, 2)}
</pre>
```

**Never use:**
- `bg-light` class in dark theme contexts (it's white)
- Hard-coded colors like `#FFFFFF` or `#000000`

**CSS Variables available:**
- `--bg-surface` - Surface background (adapts to theme)
- `--text-primary` - Primary text color (adapts to theme)
- `--border-color` - Border color (adapts to theme)
- `--text-warning` - Warning/accent text (yellow/orange)
- `--text-success` - Success text (green)
- `--text-danger` - Error text (red)

### Escape HTML Function

**Always include this function when displaying user-provided data:**

```javascript
function escapeHtml(text) {
    if (typeof text !== 'string') return text;
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
```

### Substitution Display Pattern

**Display variable substitutions using this format:**

```javascript
const substitutionsHtml = result.substitutions.map(sub => `
    <li>
        <code>${sub.original}</code> → <code>${sub.value}</code>
        ${sub.type ? `<small class="text-muted">(${sub.type})</small>` : ''}
    </li>
`).join('');
```

**Substitution object structure:**
- `original` - The original placeholder (e.g., `{{ .vars.name }}`)
- `value` - The substituted value
- `type` - Source type: `dynamic-guid`, `dynamic-timestamp`, `variable`, `input`, `response`

### Color Classes

**Bootstrap text colors:**
- `text-success` - Green (passed validations, success states)
- `text-danger` - Red (failed validations, errors)
- `text-warning` - Yellow/Orange (values, highlights)
- `text-muted` - Gray (secondary info, labels)
- `text-primary` - Default text color (theme-aware)

### Modal Behavior

**⚠️ CRITICAL: All modals must be "sticky" (cannot be dismissed by clicking outside)**

When implementing modals in FlowSphere Studio:

1. **Disable backdrop dismiss:**
   ```javascript
   // Bootstrap 5 modal configuration
   const modal = new bootstrap.Modal(document.getElementById('myModal'), {
       backdrop: 'static',  // Prevents closing on backdrop click
       keyboard: false      // Optional: also prevents ESC key dismiss
   });
   ```

2. **Explicit close actions only:**
   - Modals should ONLY close via explicit user actions:
     - ✅ Click "Close", "Cancel", "Done", or "X" button
     - ✅ Click "Save" or action button that completes the task
   - Modals should NEVER close via:
     - ❌ Clicking outside the modal (backdrop click)
     - ❌ Accidental ESC key press (use `keyboard: false`)

3. **Rationale:**
   - Prevents accidental data loss (user typing in form, clicks outside by mistake)
   - Ensures users make conscious decisions to close/cancel
   - Consistent with professional UX patterns for data-entry forms
   - Reduces frustration from accidental modal dismissals

4. **Examples in codebase:**
   - Flow Runner modal (`studio/js/flow-runner.js`)
   - Try it Out modal (`studio/js/try-it-out.js`)
   - All modals in `studio/js/modals.js`

**When creating new modals:**
- Always use `backdrop: 'static'` in modal configuration
- Always provide clear "Close" or "Cancel" button
- Test that clicking outside does NOT close the modal

### Consistency Checklist

When implementing new UI features that display execution results:
- ✅ Use the exact validation display pattern from Flow Runner
- ✅ Use CSS variables for background/text colors
- ✅ Use `escapeHtml()` for all user-provided data
- ✅ Match icon styles: ✓ for success, ✗ for failure
- ✅ Match text colors: green for success, red for failure, yellow for values
- ✅ Match indentation and spacing: `ps-4`, `small` class
- ✅ Test in both dark and light themes
- ✅ Modals use `backdrop: 'static'` and cannot be dismissed by clicking outside

### Substitution Display Pattern with Path

**Display variable substitutions with location context:**

```javascript
// Format substitution path helper function
function formatSubstitutionPath(path) {
    if (!path) return '';
    const parts = path.split('.');
    if (parts.length === 0) return '';
    
    const section = parts[0];
    
    if (section === 'headers') {
        const headerName = parts.slice(1).join('.');
        return `request header ${headerName}`;
    } else if (section === 'body') {
        const bodyPath = parts.slice(1).join('.');
        return bodyPath ? `request body: ${bodyPath}` : 'request body';
    } else if (section === 'url') {
        return 'request URL';
    } else if (section === 'method') {
        return 'request method';
    } else {
        return path;
    }
}

// Display substitutions with location
const substitutionsHtml = result.substitutions.map(sub => {
    const location = formatSubstitutionPath(sub.path);
    return `
        <li class="mb-1">
            ${location ? `<span class="text-muted">${location}:</span> ` : ''}
            <code>${sub.original}</code> → <code>${sub.value}</code>
            ${sub.type ? `<small class="text-muted">(${sub.type})</small>` : ''}
        </li>
    `;
}).join('');
```

**Substitution object structure (lib/substitution.js):**
- `original` - The original placeholder (e.g., `{{ .vars.name }}`)
- `value` - The substituted value
- `type` - Source type: `dynamic-guid`, `dynamic-timestamp`, `variable`, `input`, `response`
- `path` - Location where substitution occurred (e.g., `headers.sandboxId`, `body.payload.id`)

**Display examples:**
- `headers.sandboxId` → "request header sandboxId: {{ .vars.sandboxId }} → Yannis-Test (variable)"
- `body.payload.id` → "request body: payload.id: {{ $guid }} → abc-123 (dynamic-guid)"
- `url` → "request URL: {{ .vars.baseUrl }} → https://api.example.com (variable)"
- we need to be consistent in our UI components. When implementing a new feature always try to find similar UI and re-use the same logic.
