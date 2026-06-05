---
marp: true
theme: default
class: invert
paginate: true
size: 16:9
header: 'API FlowSphere'
footer: 'Design in Studio. Execute Anywhere.'
---

<!-- _class: lead invert -->
<!-- _paginate: false -->
<!-- _header: '' -->
<!-- _footer: '' -->

# 🌐 API FlowSphere

### Design in Studio. Execute Anywhere.

**Automate multi-step API workflows** — define once, run anywhere. No coding required.

---

<!-- _class: lead invert -->

## The Problem

Complex API workflows need **multiple requests** with **interdependent data**.

> Login → Get profile → Create resource → Verify creation

Today that means brittle shell scripts, manual `curl` chains, and copy-pasting tokens between calls.

---

## The Solution

A professional, **cross-platform** platform for managing & executing API sequences.

- 🧩 **Reusable workflows** saved as JSON configs
- 🔗 **Smart data passing** between steps — no copy-paste
- ✅ **Built-in validation** catches failures immediately
- 🖱️ **Visual editing** with autocomplete for non-developers

Built in **Node.js** · Windows · macOS · Linux

---

## Core Capabilities

| Feature | What it does |
|---|---|
| **Dual Execution** | Run via CLI *or* browser UI — identical engine |
| **Live Flow Runner** | Real-time streaming, color-coded results |
| **Dynamic Variables** | `{{ $guid }}` · `{{ $timestamp }}` |
| **Smart Data Passing** | `{{ .responses.login.token }}` |
| **Conditional Logic** | Run steps based on prior results (AND logic) |
| **Response Validation** | Verify status codes & JSON fields, fail fast |

---

## How It Works

A workflow is just JSON — each node feeds the next:

```json
{
  "nodes": [
    { "id": "login", "method": "POST", "url": "/login",
      "body": { "user": "demo", "pass": "secret" },
      "validations": [{ "jsonpath": ".token", "exists": true }] },

    { "id": "getProfile", "method": "GET", "url": "/profile",
      "headers": {
        "Authorization": "Bearer {{ .responses.login.token }}"
      } }
  ]
}
```

---

<!-- _class: lead invert -->

## 🎨 FlowSphere Studio

**Visual editor + live execution — no JSON knowledge required**

- Form-based editing with templates (Empty, Simple, OAuth, User Input)
- **Smart autocomplete** — type `{{` to see variables, responses, inputs
- **Live Flow Runner** — streaming results: ✅ success ❌ failed ⊘ skipped
- **Engage Node** — test a single node in isolation
- **Import from Postman** · Auto-save · Live JSON preview

```bash
flowsphere studio   # → http://localhost:3737
```

---

<!-- _class: lead invert -->
<!-- _header: '' -->
<!-- _footer: '' -->

# 🎬 Live Demo

### FlowSphere Studio

*Watch data flow between API steps — automatically.*

---

## 🤖 FlowSphere MCP Server

**Turn configs into production-ready test code via Claude**

A Model Context Protocol server that generates **standalone, executable tests** from any FlowSphere JSON config.

- **8 generators** across 3 languages:
  - 🐍 Python — *pytest, behave/BDD*
  - 🟨 JavaScript — *Jest, Mocha, Cucumber/BDD*
  - 🟦 C# — *xUnit, NUnit, SpecFlow/BDD*
- A **20-line config → 400+ lines** of working test code
- Covers all 18 features · 153 tests · 100% coverage

> *"Generate Python pytest code from my FlowSphere config"*

---

## 🤔 "Why not Postman?"

| | 📮 Postman | 🌐 FlowSphere |
|---|---|---|
| **Pass data between steps** | Write JS in test scripts | Declarative `{{ .responses.x.y }}` — no code |
| **Source control** | Bulky, app/cloud-managed | Clean, human-readable, diff-able JSON |
| **Run in terminal** | Needs Newman (separate tool) | Built-in CLI — *same engine* as the UI |
| **Cost & access** | Account + paid team tiers | Free · MIT · local · no login |
| **Generate test code** | Per-request snippets | Full pytest / Jest / xUnit + BDD suites |

<!-- _footer: 'Postman is a great all-in-one platform. FlowSphere is the focused, lightweight, version-controlled alternative you own.' -->

---

## Why It Matters

- ⚡ **2–10× faster** than shell scripts
- 🔁 One engine, two interfaces — **CLI & Studio behave identically**
- 🧪 From design → execution → **auto-generated test suites**
- 🌍 Truly cross-platform, npm-distributed

---

<!-- _class: lead invert -->

# Get Started

```bash
npm install -g flowsphere

flowsphere examples/config-simple.json   # run a flow
flowsphere studio                        # visual editor
```

**FlowSphere** · github.com/ymoud/flowsphere
**MCP Server** · github.com/ymoud/flowsphere-mcp

### Thank you! 🚀
