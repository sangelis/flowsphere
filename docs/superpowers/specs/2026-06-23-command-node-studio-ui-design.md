# Command Node — Studio UI (Phase 2) Design Spec

- **Date:** 2026-06-23
- **Status:** Approved (Phase 2 design)
- **Depends on:** Phase 1 (`docs/superpowers/specs/2026-06-23-command-node-design.md`) — the engine, config schema, CLI, and validator for `type: "command"` nodes.
- **Topic:** Studio (browser GUI) support for editing, running, and visualizing `command` nodes, so the visual tool is a first-class peer of the CLI for the SDK-testing workflow.

---

## 1. Problem statement

Phase 1 made `type: "command"` nodes work in the engine, CLI, validator, and (functionally) the Studio execution endpoints. But the Studio **UI** is still HTTP-only: you cannot create or edit a command node through the editor, the node renders with blank `method`/`url`, and the Flow Runner / Try-it-Out result views assume an HTTP response. To use the visual tool for the LangGraph `AzureChatOpenAI` testing workflow, the UI must understand command nodes end-to-end.

## 2. Goals

- Edit command nodes visually: a node **type selector** (HTTP/Command) and command fields (`command`, `args`, `cwd`, `env`, `statusFrom`), with HTTP fields hidden for command nodes and vice-versa.
- Create command nodes from the **Add-Node** modal.
- Render command **results** richly in **Flow Runner** and **Try-it-Out**: a command-aware label, a request panel (with `env` masked), and dedicated **exit-code / stdout / stderr / parsed-json** panels.
- Extend **autocomplete** so later steps can reference a command node's outputs (`.exitCode`, `.stdout`, `.stderr`, `.json.*`).
- Add a command-node **template** and verify command **validation errors** surface in the existing validation UI.
- Update **docs** (README, CLAUDE.md, an example config).
- Reuse existing UI patterns (the CLAUDE.md "UI Styling Guide") everywhere; keep HTTP behavior unchanged.

## 3. Non-goals (Phase 2)

- Process **`stdin`** support (deferred; YAGNI until needed).
- **Configurable output cap** (`maxBuffer` stays a fixed 10 MB constant from Phase 1).
- A JS test framework / DOM testing harness (none exists in the repo; UI verification is a manual checklist plus one pure-function Node test).
- Migrating the user's actual Python client (separate follow-on).

## 4. Key design decisions (settled during brainstorming)

1. **Core vs toggleable:** Command-node *rendering* is **core**, not a new toggleable feature. Per the toggleable-features guide, "core functionality required for the app to work" is the explicit exception (guide line 17): once a config contains a command node, the editor and Flow Runner must render it — that can't be switched off without breaking those configs. Enhancements that live inside the already-toggleable **`autocomplete`** and **`try-it-out`** features ride those features' existing toggles and degrade gracefully when disabled. No new `FeatureRegistry` entry. (The per-step "toggle" already exists as the optional `type: "command"` node property — Pattern 4 — delivered in Phase 1.)
2. **Active renderer:** `studio/index.html` loads `js/ui-renderer-bootstrap.js` (line 762), **not** `js/ui-renderer.js` (dead/legacy). All editor-form work targets `ui-renderer-bootstrap.js`.
3. **Type switch is a field-set swap:** the validator rejects HTTP fields on command nodes and vice-versa, so switching a node's type must remove the other type's fields and seed defaults, then re-render.
4. **Rich result panels:** exit-code badge + separate stdout / stderr / parsed-json panels (stderr highlighted only when non-empty), reusing the JSON/code display pattern.
5. **Shared rendering helper:** a new **core** module so Flow Runner (core) and Try-it-Out (feature) don't duplicate the panel logic.
6. **Autocomplete:** always suggest the four fixed command outputs; drill into `.json.*` when a response schema exists (populated via the existing manual "Store Response Schema" button), exactly paralleling the existing HTTP schema flow.
7. **Phase 1 dependency:** Phase 2 assumes Phase 1 is merged — the engine/validator accept command nodes, the Studio server routes request objects through `buildRequestLog` and tags step logs/payloads with `type`, and `tests/test-suite.js` exists. Where Phase 2 needs a server field, it states the requirement and verifies it rather than assuming.

---

## 5. Architecture: core vs toggleable (Section A)

| Concern | Where | Toggle |
|---------|-------|--------|
| Editor form (type selector + command fields) | `ui-renderer-bootstrap.js`, `form-handlers.js`, `index.html` | **Core** (always on) |
| Flow Runner result rendering | `flow-runner.js` | **Core** |
| Shared result panels + label | `studio/js/command-result-view.js` (**new** core script) | **Core** |
| Validation error display | `config-validator-ui.js` (generic field list) | Core (already generic) |
| Autocomplete for command outputs | `autocomplete.js` | Rides the **`autocomplete`** feature toggle |
| Try-it-Out command rendering + schema | `try-it-out.js` | Rides the **`try-it-out`** feature toggle |
| Command template(s) | `studio/templates/nodes/command/*.json` | Additive (no toggle) |

Rationale: rendering a node type that exists in a config is core; an additive enhancement inside an optional feature inherits that feature's toggle. A single `command-nodes` feature gating everything was rejected because a "disabled" state would render configs containing command nodes as broken/raw JSON.

---

## 6. Editor form (Section B)

### Type selector & conditional fields — `renderStepForm` (`ui-renderer-bootstrap.js`, ~538-596)

- Add a **Node Type** `<select>` (HTTP / Command) near Step ID/Name, bound to `node.type` (absent ⇒ `http`).
- **Command** type renders: **Command** (text), **Arguments** (ordered add/remove list of text inputs), **Working directory** (text), **Environment variables** (key-value editor, same pattern as the existing Headers editor), **statusFrom** (text, placeholder `.status`). HTTP-only fields (method, url, headers, body) are **hidden**.
- **HTTP** type renders today's fields unchanged.
- **Shared (both types):** Step ID, Name, Conditions, User Input Prompts, Timeout, Validations, **Launch Browser** (Phase 1 allows `launchBrowser` on command nodes — it extracts a URL from `response.body`, e.g. `.json.authUrl`).

### Field-set swap & re-render — `updateStep` (`form-handlers.js`, ~546-560)

- Changing the type dropdown calls `updateStep(index, 'type', value)`. The handler:
  - **HTTP → Command:** delete `method`, `url`, `headers`, `body`; seed `command:''`, `args:[]`. (`launchBrowser` is shared — keep it.)
  - **Command → HTTP:** delete `command`, `args`, `cwd`, `env`, `statusFrom`; seed `method:'GET'`, `url:''`. (`launchBrowser` kept.)
  - **Re-render** the editor (add `type` to the set of fields that trigger a re-render — today only `name`/`id`/`method` do).
- New scalar handlers write `config.nodes[i].command` / `.cwd` / `.statusFrom`.
- **Arguments**: add/remove/update handlers maintaining the ordered `config.nodes[i].args` string array.
- **Environment**: reuse the existing Headers key-value editor handlers, writing `config.nodes[i].env`.

### Add-Node modal & `addStep` (`index.html` ~191-308 / ~396-485; `form-handlers.js` ~96-159)

- Add a **Command** starter (a card or a type toggle in the new-node form). When chosen, `addStep` creates `{ id, name, type:'command', command:'', args:[] }` instead of the HTTP default `{ method:'GET', url:'', headers:{}, body:{} }`. Any modal markup added/modified follows the **sticky-modal** rule (`backdrop:'static'`, `keyboard:false`) via the existing modal-bridge / `configureModal` helper, per the UI Styling Guide.

### Node list label — `renderSteps` (`ui-renderer-bootstrap.js`, ~449-453)

- For command nodes, show a **CMD** badge (reusing the method-badge styling) instead of the HTTP method badge; keep the name/id display.

### Autocomplete wiring

- The new **args** items, **cwd**, and **env values** receive `safeAttachAutocomplete(...)` in the render path (autocomplete is wired explicitly per render and is a no-op when the feature is disabled).

---

## 7. Result rendering (Section C)

### Shared core helper — `studio/js/command-result-view.js` (**new**, added to `index.html` core scripts)

Loaded as a core script (before features), exposing on `window`:
- `renderCommandResultPanels(body)` → HTML for: an **exit-code badge** (`text-success`/green when `body.exitCode === 0`, else `text-danger`/red), a **stdout** `<pre>`, a **stderr** `<pre>` (rendered with a warning border / shown prominently only when `body.stderr` is non-empty), and a **parsed-json** `<pre>` when `body.json` is not null. All panels use the mandated CSS variables (`--bg-surface`, `--text-primary`, `--border-color`) and `escapeHtml()` per the UI Styling Guide. The helper **defends against a missing/partial `body`** (undefined `body`, or absent `exitCode`/`stdout`/`stderr`/`json`) by rendering empty/neutral panels rather than throwing.
- `formatStepLabel(stepLike)` → `cmd: <command> <args joined>` when `stepLike.type === 'command'` (reading `command`/`args` from the step or its `request`), else `METHOD url`. Pure string logic, no DOM — unit-testable in Node.

### Flow Runner — `flow-runner.js` (core; `updateModalWithStep` ~1059-1197, `replaceStepPlaceholder` ~1232-1368, `displayExecutionResults` ~1556-1669)

Branch on `stepData.type` (Phase 1 already streams `type` and `request = { command, args, cwd, env-masked }`):
- Summary row / title uses `formatStepLabel(stepData)` instead of the blank `${stepData.method} ${stepData.url}`.
- Request panel: keep the existing `highlightSubstitutionsInJSON(stepData.request, …)` — it already renders the command request object (env pre-masked by Phase 1).
- Response area: for command, render `renderCommandResultPanels(stepData.response.body)` in place of the generic body `<pre>`. The status line (`Status 200 exit 0`) already works (`statusText` carries `exit <code>`). HTTP rendering unchanged.

### Try-it-Out — `try-it-out.js` (feature; `showResultsModal` ~542-810, `updateResultsModal` ~818-900+)

Branch on `result.type`:
- Request section: show `command`/`args`/`cwd`/`env`(masked) instead of `method`/`url`/`headers`/`body`.
- Response section: call the same `renderCommandResultPanels(result.response.body)`.

### Server payloads — `bin/flowsphere.js` (all three execution endpoints)

Phase 2 depends on Phase 1's server changes (each endpoint's `request` object routed through `buildRequestLog`; `type` added to step logs/payloads). Phase 2 states the requirements and **verifies** them across **all three** endpoints the Studio uses:
- **`/api/execute-stream`** (Flow Runner "Go with the Flow"): every `sendEvent('step', …)` payload carries `type` and the command `request` (`{ command, args, cwd, env-masked }`). The **`step_start`** event (currently `{ step, id, name, method, url }`, ~750) **must** also include `type` and, for command nodes, `command`/`args` (raw is fine — the later `step` event carries substituted values), so the pre-execution **placeholder** renders a `cmd: …` label instead of a blank `method url`.
- **`/api/execute-step`** (Flow Runner **step-by-step / auto-step**, ~346-572): the returned `stepLog` carries `type` and the command `request` on **success and failure** paths. Today it returns HTTP-shaped `method`/`url` + `request:{headers,body}`.
- **`/api/execute-node`** (Try-it-Out): success **and** failure payloads include `type` **and** the command-shaped masked `request` (`{ command, args, cwd, env }`) so the request section renders. Phase 1 routes this through `buildRequestLog`; Phase 2 ensures `type` is present on both paths.

The client computes the display label from `type` + `request.command/args` (via `formatStepLabel`), so it does **not** depend on a server-provided label string. Flow Runner's full-run and step-by-step/auto-step modes share the same step-rendering helpers (`updateModalWithStep` / `replaceStepPlaceholder`), so the client branching described above covers all three Studio execution modes.

### Styling-guide compliance

All new panels follow the UI Styling Guide: validation display pattern (unchanged), JSON/code display via CSS variables (never `bg-light` or hard-coded colors), `escapeHtml()` on all script-provided data (stdout/stderr/json can contain arbitrary text), and any modal stays `backdrop: 'static'`.

---

## 8. Autocomplete & response schemas (Section D)

Lives inside the toggleable `autocomplete` and `try-it-out` features (no-op when disabled).

- **`autocomplete.js`** (suggestion builders ~339-455): when building `{{ .responses.<id>… }}` suggestions, branch on the prior node's `type`:
  - **Command node** ⇒ always offer the four fixed outputs **`.exitCode`, `.stdout`, `.stderr`, `.json`** (suggestable even before the node has been run), and **drill into `.json.*`** using the stored schema when present.
  - **HTTP node** ⇒ unchanged.
- **`try-it-out.js`** (the existing **"Store Response Schema"** button → `storeResponseSchema(node, schema)`, ~686-795 / ~1433-1461): the schema is built from `result.response.body`. For a **command** node the body is `{ exitCode, stdout, stderr, json }`, so the schema-builder must capture that shape (notably the `json` sub-shape). The stored **wrapper** (`{ nodeId, nodeName, method, url, schema, timestamp }`, ~1452) is tagged with a **distinct** `nodeType:'command'` key — do **not** overwrite the body `schema`'s own structural `type` (e.g. `'object'`) — and its `method`/`url` metadata is replaced with command metadata (e.g. `command`). So later steps can autocomplete `{{ .responses.id.json.token }}` / `.exitCode`. This reuses the existing **manual** store-schema UX (there is no auto-store); only the schema *shape* and the `nodeType` tag for command bodies are new.
- **`ui-renderer-bootstrap.js`** (stored-schema summary ~296-356 that prints `method`/`url`): render a command-appropriate summary (or guard the undefined `method`/`url`) for command schemas.

The four fixed outputs are always suggestable; `.json.*` drilling lights up after a Try-it-Out run, paralleling the existing HTTP schema flow.

---

## 9. Templates, validation UI, docs (Section E)

### Templates

- Add a command-node template, e.g. `studio/templates/nodes/command/run-client.json`, shaped `{ name, description, node: { …command node… } }` — a "Run client script" example with placeholder `command`/`args`/`env` (e.g. a LangGraph Azure client invocation). Templates load dynamically via `/api/templates/nodes` (no server code change), but `import-nodes.js` has inline category labels/icons (~102-115), so a new **command** category needs one label/icon entry.

### Validation UI

- `config-validator-ui.js` (`showConfigValidationResults` ~104-195) renders a generic `error.field` + `error.message` + `error.suggestion` list, so Phase 1's command errors (`nodes[i].command`, `.args`, `.env`, `.statusFrom`, `.type`, rejected `method`/`url`/`headers`/`body`) surface automatically. **Verify only** — no code change expected.

### Docs (in scope)

- **README.md** — command-node config format + a usage example.
- **CLAUDE.md** — add command node to the Node-Level Properties table, the config-format section, and the relevant change-impact chains; note the rich-panel UI pattern.
- **`examples/config-command-node.json`** — an example config (the Azure client scenario).
- Specifics (wording, which examples) confirmed with the user before writing prose, per repo convention.

---

## 10. Testing & verification

The repo has no browser/DOM test harness (lib/ tests are plain-Node). So:

- **One Node unit test** for the pure helper `formatStepLabel` (no DOM): command label `cmd: python a.py --x`, http label `GET /u`, reading from both a step object and a `request`-details object. Added to `tests/test-suite.js` (created in Phase 1 — Phase 2 depends on Phase 1, so the suite runner exists; if Phase 2 were run independently, create/repair the suite per the Phase 1 plan).
- **Manual verification checklist** (browser, `node bin/flowsphere.js studio`):
  1. Add a Command node from the Add-Node modal; confirm the command skeleton.
  2. In the editor, switch a node HTTP↔Command; confirm fields swap, HTTP fields removed, and the JSON preview stays valid.
  3. Edit `command`, add/remove `args`, add `env` rows, set `cwd`/`statusFrom`; confirm the JSON preview updates and autocomplete fires in args/env/cwd on `{{`.
  4. Run the Phase 1 `tests/config-test-command-basic.json`, `…-chaining.json`, `…-condition.json` through **Flow Runner** ("Go with the Flow"); confirm the `cmd:` label, request panel (env masked), and exit-code/stdout/stderr/json panels.
  4b. Run the same configs in Flow Runner **step-by-step** and **auto-step** modes (which use `/api/execute-step`); confirm the placeholder and rendered step show the `cmd:` label, command request panel, and rich panels identically to the full run.
  5. **Try-it-Out** a command node; confirm the same rich rendering and that a follow-up step autocompletes `{{ .responses.<id>.json.* }}` / `.exitCode`.
  6. Trigger a command validation error (e.g. missing `command`, or `url` on a command node); confirm it shows in the validation modal.
  7. Insert the command template from the template library.
  8. Toggle the `autocomplete` and `try-it-out` features off; confirm graceful degradation (editor + Flow Runner still work).
- `npm test` (the Phase 1 suite + the new `formatStepLabel` test) stays green.

---

## 11. File-impact map (Chain 2 "node field" + Chain 7 "Studio UI feature" + Chain 8 "template")

| File | Change | Type |
|------|--------|------|
| `studio/js/ui-renderer-bootstrap.js` | type dropdown + command fields + CMD badge + autocomplete wiring + schema-summary guard | Modify (core) |
| `studio/js/form-handlers.js` | `updateStep` type-swap + re-render trigger; args/env editors; `addStep` command skeleton | Modify (core) |
| `studio/index.html` | Add-Node "Command" starter; load `command-result-view.js` | Modify (core) |
| `studio/js/command-result-view.js` | `renderCommandResultPanels`, `formatStepLabel` | **Create** (core) |
| `studio/js/flow-runner.js` | type-branch label + rich panels | Modify (core) |
| `studio/js/try-it-out.js` | command request section + rich panels + command response schema | Modify (feature) |
| `studio/js/autocomplete.js` | command-output suggestions + `.json.*` drilling | Modify (feature) |
| `bin/flowsphere.js` | all three exec endpoints — `/api/execute-stream` (incl. `step_start`), `/api/execute-step`, `/api/execute-node` — carry `type` + command-shaped masked `request` on success & failure | Modify |
| `studio/templates/nodes/command/run-client.json` | command template | **Create** |
| `README.md`, `CLAUDE.md`, `examples/config-command-node.json` | docs | Modify/Create |
| `tests/formatStepLabel.test.js`, `tests/test-suite.js` | unit test + wire into suite | Create/Modify |

---

## 12. Out of scope / future

- Process `stdin`; configurable output cap.
- DOM/integration test harness for Studio.
- A dedicated execution-log visualizer for command output.
