/**
 * Try it Out Feature
 *
 * Plug-and-play feature for testing individual nodes in isolation.
 * Detects dependencies, allows mocking, executes node via API, and shows results.
 */

(function() {
    'use strict';

    /**
     * Escape HTML to prevent XSS
     * @param {string} text - Text to escape
     * @returns {string} Escaped text
     */
    function escapeHtml(text) {
        if (typeof text !== 'string') return text;
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Get substitution styling based on type
     * @param {string} type - Substitution type
     * @returns {Object} Object with typeClass and typeLabel
     */
    function getSubstitutionStyle(type) {
        let typeClass = 'substitution-var';
        let typeLabel = 'Variable';

        if (type === 'dynamic-guid') {
            typeClass = 'substitution-dynamic';
            typeLabel = 'Dynamic GUID';
        } else if (type === 'dynamic-timestamp') {
            typeClass = 'substitution-dynamic';
            typeLabel = 'Dynamic Timestamp';
        } else if (type === 'response') {
            typeClass = 'substitution-response';
            typeLabel = 'Response Reference';
        } else if (type === 'input') {
            typeClass = 'substitution-input';
            typeLabel = 'User Input';
        } else if (type === 'variable') {
            typeClass = 'substitution-var';
            typeLabel = 'Variable';
        }

        return { typeClass, typeLabel };
    }

    /**
     * Highlight substituted variables in plain text (like URLs)
     * @param {string} text - The text to highlight
     * @param {Array} substitutions - Array of substitution records
     * @returns {string} HTML string with highlighted values
     */
    function highlightSubstitutionsInText(text, substitutions = []) {
        if (!text || substitutions.length === 0) {
            return escapeHtml(text);
        }

        // Create a map of values to their substitution info
        const valueMap = new Map();
        substitutions.forEach(sub => {
            const key = String(sub.value);
            if (!valueMap.has(key)) {
                valueMap.set(key, []);
            }
            valueMap.get(key).push(sub);
        });

        let result = text;

        // Replace each substituted value with highlighted version
        // Sort by value length (longest first) to avoid partial replacements
        const sortedValues = Array.from(valueMap.keys()).sort((a, b) => b.length - a.length);

        for (const value of sortedValues) {
            const subs = valueMap.get(value);
            const sub = subs[0]; // Use first substitution info
            const { typeClass, typeLabel } = getSubstitutionStyle(sub.type);

            // Escape value for regex
            const escapedValue = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(escapedValue, 'g');

            // Create highlighted replacement
            const replacement = `<span class="json-substitution ${typeClass}" data-original="${escapeHtml(sub.original)}" data-type="${typeLabel}" title="${typeLabel}: ${escapeHtml(sub.original)}">${value}</span>`;

            result = result.replace(regex, replacement);
        }

        // Escape the remaining text (non-highlighted parts)
        const parts = result.split(/(<span[^>]*>.*?<\/span>)/);
        const escapedParts = parts.map((part, index) => {
            // Odd indices are our span tags - don't escape them
            if (index % 2 === 1) {
                return part;
            }
            // Even indices are regular text - escape them
            return escapeHtml(part);
        });

        return escapedParts.join('');
    }

    /**
     * Highlight substituted variables in JSON
     * @param {Object} jsonObj - The JSON object to display
     * @param {Array} substitutions - Array of substitution records
     * @returns {string} HTML string with highlighted values
     */
    function highlightSubstitutionsInJSON(jsonObj, substitutions = []) {
        if (!jsonObj || substitutions.length === 0) {
            return escapeHtml(JSON.stringify(jsonObj, null, 2));
        }

        // Create a map of values to their substitution info
        const valueMap = new Map();
        substitutions.forEach(sub => {
            const key = String(sub.value);
            if (!valueMap.has(key)) {
                valueMap.set(key, []);
            }
            valueMap.get(key).push(sub);
        });

        // Convert JSON to string
        let jsonString = JSON.stringify(jsonObj, null, 2);

        // Replace each substituted value with highlighted version
        // Sort by value length (longest first) to avoid partial replacements
        const sortedValues = Array.from(valueMap.keys()).sort((a, b) => b.length - a.length);

        for (const value of sortedValues) {
            const subs = valueMap.get(value);
            const sub = subs[0]; // Use first substitution info
            const { typeClass, typeLabel } = getSubstitutionStyle(sub.type);

            // Escape value for regex
            const escapedValue = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

            // Match the value when it appears as a JSON string value (between quotes)
            const regex = new RegExp(`"(${escapedValue})"`, 'g');

            // Create highlighted replacement
            const replacement = `"<span class="json-substitution ${typeClass}" data-original="${escapeHtml(sub.original)}" data-type="${typeLabel}" title="${typeLabel}: ${escapeHtml(sub.original)}">$1</span>"`;

            jsonString = jsonString.replace(regex, replacement);
        }

        // Escape the remaining text (non-highlighted parts)
        // Split by our span tags, escape each part, then rejoin
        const parts = jsonString.split(/(<span[^>]*>.*?<\/span>)/);
        const escapedParts = parts.map((part, index) => {
            // Odd indices are our span tags - don't escape them
            if (index % 2 === 1) {
                return part;
            }
            // Even indices are regular text - escape them
            return escapeHtml(part);
        });

        return escapedParts.join('');
    }

    /**
     * Extract schema from response body
     * Recursively analyzes the structure and captures field names and types
     * @param {any} value - The value to analyze
     * @param {number} maxDepth - Maximum depth to traverse (default: 10)
     * @param {number} currentDepth - Current depth (internal use)
     * @returns {object} Schema representation
     */
    function extractSchema(value, maxDepth = 10, currentDepth = 0) {
        // Prevent infinite recursion
        if (currentDepth >= maxDepth) {
            return { type: 'unknown', reason: 'max depth reached' };
        }

        // Handle null explicitly
        if (value === null) {
            return { type: 'null' };
        }

        // Handle undefined
        if (value === undefined) {
            return { type: 'undefined' };
        }

        // Get JavaScript type
        const jsType = typeof value;

        // Handle primitives
        if (jsType === 'string') {
            return { type: 'string' };
        }
        if (jsType === 'number') {
            return { type: 'number' };
        }
        if (jsType === 'boolean') {
            return { type: 'boolean' };
        }

        // Handle arrays
        if (Array.isArray(value)) {
            if (value.length === 0) {
                return { type: 'array', items: { type: 'unknown' } };
            }

            // Analyze first few items to determine array item type
            const samples = value.slice(0, 3); // Sample first 3 items
            const itemSchemas = samples.map(item => extractSchema(item, maxDepth, currentDepth + 1));

            // If all items have same type, use that
            const firstType = itemSchemas[0]?.type;
            const allSameType = itemSchemas.every(schema => schema.type === firstType);

            if (allSameType && firstType !== 'object') {
                return { type: 'array', items: itemSchemas[0] };
            } else if (allSameType && firstType === 'object') {
                // For object arrays, merge properties from samples
                const mergedProperties = {};
                itemSchemas.forEach(schema => {
                    if (schema.properties) {
                        Object.keys(schema.properties).forEach(key => {
                            if (!mergedProperties[key]) {
                                mergedProperties[key] = schema.properties[key];
                            }
                        });
                    }
                });
                return {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: mergedProperties
                    }
                };
            } else {
                return {
                    type: 'array',
                    items: { type: 'mixed' }
                };
            }
        }

        // Handle objects
        if (jsType === 'object') {
            const properties = {};
            for (const [key, val] of Object.entries(value)) {
                properties[key] = extractSchema(val, maxDepth, currentDepth + 1);
            }
            return {
                type: 'object',
                properties: properties
            };
        }

        // Fallback
        return { type: 'unknown' };
    }

    /**
     * Initialize the Try it Out feature
     */
    function initTryItOut() {
        console.log('[TryItOut] Feature initialized');

        // Make tryItOutNode function globally available
        window.tryItOutNode = tryItOutNode;
    }

    /**
     * Main entry point - called when "Try it Out" button is clicked
     * @param {number} nodeIndex - Index of the node to test
     */
    function tryItOutNode(nodeIndex) {
        const node = config.nodes[nodeIndex];
        if (!node) {
            alert('Node not found');
            return;
        }

        // Detect dependencies ({{ .responses.* }} references)
        const dependencies = detectDependencies(node);

        if (dependencies.length > 0) {
            // Show mocking modal to collect mock values
            showMockingModal(dependencies, (mockResponses) => {
                executeNode(node, mockResponses);
            });
        } else {
            // No dependencies - execute directly
            executeNode(node, {});
        }
    }

    /**
     * Detect response dependencies in a node
     * Scans for {{ .responses.nodeId.field }} patterns
     * @param {object} node - The node to scan
     * @returns {Array} Array of dependency objects
     */
    function detectDependencies(node) {
        const dependencies = [];
        const seen = new Set();

        // Serialize node to scan all string values
        const nodeStr = JSON.stringify(node);

        // Regex to match {{ .responses.nodeId.field }}
        const regex = /\{\{\s*\.responses\.(\w+)(\.([^\}]+))?\s*\}\}/g;

        let match;
        while ((match = regex.exec(nodeStr)) !== null) {
            const nodeId = match[1];
            const rawField = match[3] || '';
            const field = rawField.trim(); // Field path after nodeId, trimmed
            const placeholder = match[0]; // Full placeholder

            // Debug: show if trimming happened
            if (rawField !== field) {
                console.log('[TryItOut] Trimmed field:', JSON.stringify(rawField), '→', JSON.stringify(field));
            }

            // Use placeholder as key to avoid duplicates
            if (!seen.has(placeholder)) {
                seen.add(placeholder);

                // Find the referenced node
                const referencedNode = config.nodes.find(s => s.id === nodeId);
                const nodeName = referencedNode ? referencedNode.name : 'Unknown';

                dependencies.push({
                    nodeId,
                    nodeName,
                    field,
                    placeholder
                });
            }
        }

        return dependencies;
    }

    /**
     * Show modal to collect mock values for dependencies
     * @param {Array} dependencies - Array of dependency objects
     * @param {Function} onSubmit - Callback with mockResponses object
     */
    function showMockingModal(dependencies, onSubmit) {
        const modalId = 'tryItOutMockingModal';

        // Remove existing modal if present
        const existingModal = document.getElementById(modalId);
        if (existingModal) {
            existingModal.remove();
        }

        // Create modal HTML
        const modalHtml = `
            <div class="modal fade" id="${modalId}" tabindex="-1">
                <div class="modal-dialog modal-lg">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title">
                                <i class="bi bi-sliders me-2"></i>Node Calibration Required
                            </h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body">
                            <p>Some parameters need calibration before this node can execute.</p>
                            <p class="text-muted">Please supply the required values below.</p>
                            <div id="mockFieldsContainer">
                                ${dependencies.map((dep, index) => `
                                    <div class="form-group mb-3">
                                        <label class="form-label">
                                            <strong>{{ .responses.${dep.nodeId}${dep.field ? '.' + dep.field : ''} }}</strong>
                                            <small class="text-muted">(from: ${dep.nodeName})</small>
                                        </label>
                                        <input
                                            type="text"
                                            class="form-control mock-input"
                                            data-node-id="${dep.nodeId}"
                                            data-field="${dep.field}"
                                            placeholder="Enter mock value"
                                        />
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">
                                <i class="bi bi-x-circle me-2"></i>Cancel Calibration
                            </button>
                            <button type="button" class="btn btn-primary" id="executeMockedNode">
                                <i class="bi bi-play-circle me-2"></i>Apply & Engage
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Add modal to DOM
        document.body.insertAdjacentHTML('beforeend', modalHtml);

        // Initialize Bootstrap modal
        const modalEl = document.getElementById(modalId);
        const modal = window.configureModal(modalEl);

        // Handle Run button
        document.getElementById('executeMockedNode').addEventListener('click', () => {
            const mockResponses = {};

            // Collect all mock values
            const inputs = modalEl.querySelectorAll('.mock-input');
            inputs.forEach(input => {
                const nodeId = input.dataset.nodeId;
                const field = input.dataset.field;
                const value = input.value.trim();

                if (value) {
                    // Initialize node object if not exists
                    if (!mockResponses[nodeId]) {
                        mockResponses[nodeId] = {};
                    }

                    // Set nested value using field path
                    if (field) {
                        setNestedValue(mockResponses[nodeId], field, value);
                    } else {
                        // No field path - just store the value directly
                        mockResponses[nodeId] = value;
                    }
                }
            });

            // Close modal
            modal.hide();

            // Execute callback
            onSubmit(mockResponses);
        });

        // Clean up modal on close
        modalEl.addEventListener('hidden.bs.modal', () => {
            modalEl.remove();
        });

        // Show modal
        modal.show();
    }

    /**
     * Set a nested value in an object using dot notation
     * @param {object} obj - Target object
     * @param {string} path - Dot-separated path
     * @param {any} value - Value to set
     */
    function setNestedValue(obj, path, value) {
        const keys = path.split('.').map(k => k.trim()); // Trim each key
        let current = obj;

        for (let i = 0; i < keys.length - 1; i++) {
            const key = keys[i];
            if (!key) continue; // Skip empty keys
            if (!current[key] || typeof current[key] !== 'object') {
                current[key] = {};
            }
            current = current[key];
        }

        // Set final value (try to parse as JSON if possible)
        const finalKey = keys[keys.length - 1];
        if (!finalKey) return; // Skip if no final key
        try {
            // Try to parse as JSON (handles numbers, booleans, objects, arrays)
            current[finalKey] = JSON.parse(value);
        } catch {
            // If parsing fails, use as string
            current[finalKey] = value;
        }
    }

    /**
     * Execute a node via the API
     * @param {object} node - The node to execute
     * @param {object} mockResponses - Mock response values by node ID
     */
    async function executeNode(node, mockResponses) {
        // Show modal immediately with "Executing" state
        const modalEl = showResultsModal(node, null); // null = executing state

        try {
            console.log('[TryItOut] Executing node with mockResponses:', mockResponses);

            const response = await fetch('/api/execute-node', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    node: node,
                    config: config,
                    mockResponses: mockResponses
                })
            });

            const result = await response.json();
            console.log('[TryItOut] API response:', result);

            // Update modal with actual results
            updateResultsModal(modalEl, node, result);

        } catch (error) {
            // Update modal with error state
            const errorResult = {
                success: false,
                error: error.message,
                request: {
                    method: node.method || 'GET',
                    url: node.url || '',
                    headers: node.headers || {},
                    body: node.body || {}
                }
            };
            updateResultsModal(modalEl, node, errorResult);

            console.error('[TryItOut] Execution error:', error);
        }
    }

    /**
     * Show results modal with execution details
     * @param {object} node - The executed node
     * @param {object} result - Execution result from API (null = executing state)
     * @returns {HTMLElement} The modal element
     */
    function isCommandResult(result) {
        return !!result && (result.type === 'command' || (result.request && result.request.type === 'command'));
    }

    // Request column markup, branching on command vs HTTP (shared by both result modals).
    function renderTryItOutRequestColumn(result) {
        const req = result.request || {};
        const subs = result.substitutions;
        if (isCommandResult(result)) {
            const argsText = Array.isArray(req.args) ? req.args.join(' ') : '';
            const hasEnv = req.env && typeof req.env === 'object' && Object.keys(req.env).length > 0;
            return `
                <div class="mb-2">
                    <strong>cmd:</strong>
                    <code>${highlightSubstitutionsInText(req.command || '', subs)}</code>
                </div>

                ${argsText ? `
                    <div class="mb-2">
                        <strong>Arguments</strong>
                        <pre style="background: var(--bg-surface); color: var(--text-primary); border: 1px solid var(--border-color);" class="p-2 small">${highlightSubstitutionsInText(argsText, subs)}</pre>
                    </div>
                ` : ''}

                ${req.cwd ? `
                    <div class="mb-2">
                        <strong>Working Directory</strong>
                        <code>${highlightSubstitutionsInText(req.cwd, subs)}</code>
                    </div>
                ` : ''}

                ${hasEnv ? `
                    <details class="mb-2" open>
                        <summary><strong>Environment</strong></summary>
                        <pre style="background: var(--bg-surface); color: var(--text-primary); border: 1px solid var(--border-color);" class="p-2 small">${highlightSubstitutionsInJSON(req.env, subs)}</pre>
                    </details>
                ` : ''}
            `;
        }
        return `
            <div class="mb-2">
                <strong>${req.method || ''}</strong>
                <code>${highlightSubstitutionsInText(req.url || '', subs)}</code>
            </div>

            ${Object.keys(req.headers || {}).length > 0 ? `
                <details class="mb-2" open>
                    <summary><strong>Headers</strong></summary>
                    <pre style="background: var(--bg-surface); color: var(--text-primary); border: 1px solid var(--border-color);" class="p-2 small">${highlightSubstitutionsInJSON(req.headers, subs)}</pre>
                </details>
            ` : ''}

            ${req.body && Object.keys(req.body).length > 0 ? `
                <details class="mb-2" open>
                    <summary><strong>Body</strong></summary>
                    <pre style="background: var(--bg-surface); color: var(--text-primary); border: 1px solid var(--border-color);" class="p-2 small">${highlightSubstitutionsInJSON(req.body, subs)}</pre>
                </details>
            ` : ''}
        `;
    }

    // Response body markup, using rich command panels for command results (shared by both modals).
    function renderTryItOutResponseBody(result) {
        if (!result.response || !result.response.body) return '';
        const body = result.response.body;
        const isCmd = isCommandResult(result) || typeof body.exitCode !== 'undefined';
        const inner = (isCmd && typeof renderCommandResultPanels === 'function')
            ? renderCommandResultPanels(body)
            : `<pre style="background: var(--bg-surface); color: var(--text-primary); border: 1px solid var(--border-color); max-height: 400px; overflow-y: auto;" class="p-2 small">${JSON.stringify(body, null, 2)}</pre>`;
        return `
            <details open>
                <summary><strong>Response Body</strong></summary>
                ${inner}
            </details>
        `;
    }

    function showResultsModal(node, result) {
        const modalId = 'tryItOutResultsModal';
        // Remove existing modal if present
        const existingModal = document.getElementById(modalId);
        if (existingModal) {
            existingModal.remove();
        }

        // Determine state - executing or completed
        const isExecuting = result === null;
        const statusIcon = isExecuting ? '<div class="spinner-border spinner-border-sm" role="status"><span class="visually-hidden">Loading...</span></div>'
                          : (result.success ? '✅' : '❌');
        const statusText = isExecuting ? 'Executing...' : (result.success ? 'Success' : 'Failed');
        const statusClass = isExecuting ? 'text-primary' : (result.success ? 'text-success' : 'text-danger');

        // Build modal body content
        let modalBodyContent = '';

        if (isExecuting) {
            // Executing state - show spinner and basic info
            modalBodyContent = `
                <div class="text-center py-5">
                    <div class="spinner-border text-primary mb-3" role="status" style="width: 3rem; height: 3rem;">
                        <span class="visually-hidden">Loading...</span>
                    </div>
                    <h5>${node.name || formatStepLabel(node)}</h5>
                    <p class="text-muted">Executing request...</p>
                </div>
            `;
        } else {
            // Handle missing request object (error before execution)
            if (!result.request) {
                result.request = node.type === 'command'
                    ? {
                        type: 'command',
                        command: node.command || '',
                        args: Array.isArray(node.args) ? node.args : [],
                        cwd: node.cwd || '',
                        env: node.env || {}
                    }
                    : {
                        method: node.method || 'GET',
                        url: node.url || '',
                        headers: node.headers || {},
                        body: node.body || {}
                    };
            }

            // Format validations (match Flow Runner styling)
            let validationsHtml = '';
            if (result.validations && Array.isArray(result.validations)) {
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

            validationsHtml = `
                <div class="mb-3">
                    <h6>Validations:</h6>
                    ${validationParts.join('')}
                </div>
            `;
        }

            // Completed state - show request/response details
            modalBodyContent = `
                <div class="alert alert-${result.success ? 'success' : 'danger'} mb-3">
                    <strong>${node.name || formatStepLabel(node)}</strong>
                    <span class="ms-2">${statusIcon} ${statusText}</span>
                </div>
                <div class="row">
                    <div class="col-md-6">
                        <h6>Request</h6>
                        ${renderTryItOutRequestColumn(result)}
                    </div>

                    <div class="col-md-6">
                        <h6>Response</h6>
                        <div class="mb-2">
                            <strong class="${statusClass}">${statusText}</strong>
                            ${result.response ? `
                                <span class="badge bg-${result.response.status >= 200 && result.response.status < 300 ? 'success' : 'danger'}">
                                    ${result.response.status} ${result.response.statusText || ''}
                                </span>
                            ` : ''}
                            ${result.duration !== undefined ? `<small class="text-muted">(${result.duration}s)</small>` : ''}
                        </div>

                        ${result.error && !validationsHtml ? `
                            <div class="alert alert-danger">
                                <strong>Error:</strong> ${result.error}
                            </div>
                        ` : ''}

                        ${validationsHtml}

                        ${renderTryItOutResponseBody(result)}
                    </div>
                </div>
            `;
        }

        // Modal footer content
        const modalFooterContent = isExecuting ? `
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
        ` : `
            ${result.response?.body ? `
            <button type="button" class="btn btn-success" id="storeSchemaBtn">
                <i class="bi bi-save me-2"></i>Store Response Schema
            </button>
            ` : ''}
            <button type="button" class="btn btn-primary" id="reengageNode">
                <i class="bi bi-arrow-clockwise me-2"></i>Re-engage Node
            </button>
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
        `;

        const modalHtml = `
            <div class="modal fade" id="${modalId}" tabindex="-1">
                <div class="modal-dialog modal-xl">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title" id="tryItOutModalTitle">
                                <span class="modal-title-icon">${statusIcon}</span>
                                <span class="modal-title-text">${isExecuting ? 'Node Executing...' : 'Node Execution Complete'}</span>
                            </h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body" id="tryItOutModalBody">
                            ${modalBodyContent}
                        </div>
                        <div class="modal-footer" id="tryItOutModalFooter">
                            ${modalFooterContent}
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Add modal to DOM
        document.body.insertAdjacentHTML('beforeend', modalHtml);

        // Initialize and show Bootstrap modal
        const modalEl = document.getElementById(modalId);
        const modal = window.configureModal(modalEl);

        // Only attach event handlers if not in executing state
        if (!isExecuting) {
            // Add Re-engage Node button handler
            const reengageBtn = modalEl.querySelector('#reengageNode');
            if (reengageBtn) {
                reengageBtn.addEventListener('click', () => {
                    modal.hide();
                    // Re-run with same dependencies - need to show mocking modal again
                    tryItOutNode(config.nodes.indexOf(node));
                });
            }

            // Compare schema and style button accordingly
            const storeSchemaBtn = modalEl.querySelector('#storeSchemaBtn');
            if (storeSchemaBtn && result.response?.body && node.id) {
            const newSchema = extractSchema(result.response.body);
            const existingSchema = config.responseSchemas?.[node.id];

            if (existingSchema) {
                // Schema exists - compare with new schema using diff
                const diff = getSchemaDiff(existingSchema.schema, newSchema);
                const hasDifferences = diff.added.length > 0 || diff.removed.length > 0 || diff.changed.length > 0;

                if (!hasDifferences) {
                    // Schemas are the same - show as already stored
                    storeSchemaBtn.innerHTML = '<i class="bi bi-check-circle me-2"></i>Schema Up-to-Date';
                    storeSchemaBtn.disabled = true;
                    storeSchemaBtn.classList.remove('btn-success');
                    storeSchemaBtn.classList.add('btn-outline-success');
                } else {
                    // Schemas are different - show warning style
                    storeSchemaBtn.innerHTML = '<i class="bi bi-exclamation-triangle me-2"></i>Update Schema';
                    storeSchemaBtn.classList.remove('btn-success');
                    storeSchemaBtn.classList.add('btn-warning');
                }
            }

            // Add Store Schema button handler
            storeSchemaBtn.addEventListener('click', () => {
                // Don't do anything if button is disabled
                if (storeSchemaBtn.disabled) return;

                const schema = extractSchema(result.response.body);

                if (config.responseSchemas?.[node.id]) {
                    // Schema exists - check if there are actual differences
                    const existingSchema = config.responseSchemas[node.id];
                    const diff = getSchemaDiff(existingSchema.schema, schema);
                    const hasDifferences = diff.added.length > 0 || diff.removed.length > 0 || diff.changed.length > 0;

                    if (!hasDifferences) {
                        // Schemas are identical - shouldn't happen since button should be disabled
                        // But just in case, update button state and don't open modal
                        storeSchemaBtn.innerHTML = '<i class="bi bi-check-circle me-2"></i>Schema Up-to-Date';
                        storeSchemaBtn.disabled = true;
                        storeSchemaBtn.classList.remove('btn-success', 'btn-warning');
                        storeSchemaBtn.classList.add('btn-outline-success');
                        return;
                    }

                    // Has differences - show choice modal
                    showSchemaUpdateChoice(node, schema, modalEl);
                } else {
                    // No existing schema - store new
                    storeResponseSchema(node, schema, false);

                    // Update button to show success
                    storeSchemaBtn.innerHTML = '<i class="bi bi-check-circle me-2"></i>Schema Stored!';
                    storeSchemaBtn.disabled = true;
                    storeSchemaBtn.classList.remove('btn-success', 'btn-warning');
                    storeSchemaBtn.classList.add('btn-outline-success');

                    showToast('Response schema stored successfully', 'success', 3000);
                }
            });
            }
        } // End of !isExecuting block

        // Clean up modal on close
        modalEl.addEventListener('hidden.bs.modal', () => {
            modalEl.remove();
        });

        modal.show();
        return modalEl;
    }

    /**
     * Update results modal with actual execution results
     * @param {HTMLElement} modalEl - The modal element to update
     * @param {object} node - The executed node
     * @param {object} result - Execution result from API
     */
    function updateResultsModal(modalEl, node, result) {
        if (!modalEl) return;

        const statusIcon = result.success ? '✅' : '❌';
        const statusText = result.success ? 'Success' : 'Failed';
        const statusClass = result.success ? 'text-success' : 'text-danger';

        // Handle missing request object (error before execution)
        if (!result.request) {
            result.request = node.type === 'command'
                ? {
                    type: 'command',
                    command: node.command || '',
                    args: Array.isArray(node.args) ? node.args : [],
                    cwd: node.cwd || '',
                    env: node.env || {}
                }
                : {
                    method: node.method || 'GET',
                    url: node.url || '',
                    headers: node.headers || {},
                    body: node.body || {}
                };
        }

        // Format validations (match Flow Runner styling)
        let validationsHtml = '';
        if (result.validations && Array.isArray(result.validations)) {
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

            validationsHtml = `
                <div class="mb-3">
                    <h6>Validations:</h6>
                    ${validationParts.join('')}
                </div>
            `;
        }

        // Update modal title
        const modalTitle = modalEl.querySelector('#tryItOutModalTitle');
        if (modalTitle) {
            modalTitle.innerHTML = `
                <span class="modal-title-icon">${statusIcon}</span>
                <span class="modal-title-text">Node Execution Complete</span>
            `;
        }

        // Update modal body
        const modalBody = modalEl.querySelector('#tryItOutModalBody');
        if (modalBody) {
            modalBody.innerHTML = `
                <div class="alert alert-${result.success ? 'success' : 'danger'} mb-3">
                    <strong>${node.name || formatStepLabel(node)}</strong>
                    <span class="ms-2">${statusIcon} ${statusText}</span>
                </div>
                <div class="row">
                    <div class="col-md-6">
                        <h6>Request</h6>
                        ${renderTryItOutRequestColumn(result)}
                    </div>

                    <div class="col-md-6">
                        <h6>Response</h6>
                        <div class="mb-2">
                            <strong class="${statusClass}">${statusText}</strong>
                            ${result.response ? `
                                <span class="badge bg-${result.response.status >= 200 && result.response.status < 300 ? 'success' : 'danger'}">
                                    ${result.response.status} ${result.response.statusText || ''}
                                </span>
                            ` : ''}
                            ${result.duration !== undefined ? `<small class="text-muted">(${result.duration}s)</small>` : ''}
                        </div>

                        ${result.error && !validationsHtml ? `
                            <div class="alert alert-danger">
                                <strong>Error:</strong> ${result.error}
                            </div>
                        ` : ''}

                        ${validationsHtml}

                        ${renderTryItOutResponseBody(result)}
                    </div>
                </div>
            `;
        }

        // Update modal footer
        const modalFooter = modalEl.querySelector('#tryItOutModalFooter');
        if (modalFooter) {
            modalFooter.innerHTML = `
                ${result.response?.body ? `
                <button type="button" class="btn btn-success" id="storeSchemaBtn">
                    <i class="bi bi-save me-2"></i>Store Response Schema
                </button>
                ` : ''}
                <button type="button" class="btn btn-primary" id="reengageNode">
                    <i class="bi bi-arrow-clockwise me-2"></i>Re-engage Node
                </button>
                <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
            `;
        }

        // Re-attach event handlers
        const reengageBtn = modalEl.querySelector('#reengageNode');
        if (reengageBtn) {
            reengageBtn.addEventListener('click', () => {
                const modal = bootstrap.Modal.getInstance(modalEl);
                if (modal) modal.hide();
                tryItOutNode(config.nodes.indexOf(node));
            });
        }

        // Store schema button handler
        const storeSchemaBtn = modalEl.querySelector('#storeSchemaBtn');
        if (storeSchemaBtn && result.response?.body && node.id) {
            const newSchema = extractSchema(result.response.body);
            const existingSchema = config.responseSchemas?.[node.id];

            if (existingSchema) {
                const diff = getSchemaDiff(existingSchema.schema, newSchema);
                const hasDifferences = diff.added.length > 0 || diff.removed.length > 0 || diff.changed.length > 0;

                if (!hasDifferences) {
                    storeSchemaBtn.innerHTML = '<i class="bi bi-check-circle me-2"></i>Schema Up-to-Date';
                    storeSchemaBtn.disabled = true;
                    storeSchemaBtn.classList.remove('btn-success');
                    storeSchemaBtn.classList.add('btn-outline-success');
                } else {
                    storeSchemaBtn.innerHTML = '<i class="bi bi-exclamation-triangle me-2"></i>Update Schema';
                    storeSchemaBtn.classList.remove('btn-success');
                    storeSchemaBtn.classList.add('btn-warning');
                }
            }

            storeSchemaBtn.addEventListener('click', () => {
                if (storeSchemaBtn.disabled) return;

                const schema = extractSchema(result.response.body);

                if (config.responseSchemas?.[node.id]) {
                    const existingSchema = config.responseSchemas[node.id];
                    const diff = getSchemaDiff(existingSchema.schema, schema);
                    const hasDifferences = diff.added.length > 0 || diff.removed.length > 0 || diff.changed.length > 0;

                    if (!hasDifferences) {
                        storeSchemaBtn.innerHTML = '<i class="bi bi-check-circle me-2"></i>Schema Up-to-Date';
                        storeSchemaBtn.disabled = true;
                        storeSchemaBtn.classList.remove('btn-success', 'btn-warning');
                        storeSchemaBtn.classList.add('btn-outline-success');
                        return;
                    }

                    showSchemaUpdateChoice(node, schema, modalEl);
                } else {
                    storeResponseSchema(node, schema, false);
                    storeSchemaBtn.innerHTML = '<i class="bi bi-check-circle me-2"></i>Schema Stored!';
                    storeSchemaBtn.disabled = true;
                    storeSchemaBtn.classList.remove('btn-success', 'btn-warning');
                    storeSchemaBtn.classList.add('btn-outline-success');
                    showToast('Response schema stored successfully', 'success', 3000);
                }
            });
        }
    }

    /**
     * Check if two schemas can be meaningfully merged
     * @param {object} schema1 - First schema
     * @param {object} schema2 - Second schema
     * @returns {boolean} True if schemas can be merged
     */
    function schemasCanBeMerged(schema1, schema2) {
        if (!schema1 || !schema2) return false;

        // Different types at root - can't merge
        if (schema1.type !== schema2.type) return false;

        // Primitives can't be merged meaningfully
        if (['string', 'number', 'boolean', 'null'].includes(schema1.type)) {
            return false;
        }

        // Arrays can be merged if item types match
        if (schema1.type === 'array') {
            if (!schema1.items || !schema2.items) return false;
            return schemasCanBeMerged(schema1.items, schema2.items);
        }

        // Objects - check if they have compatible structure
        if (schema1.type === 'object') {
            const props1 = Object.keys(schema1.properties || {});
            const props2 = Object.keys(schema2.properties || {});

            // If no properties in either, can't merge
            if (props1.length === 0 || props2.length === 0) return false;

            // Check if there's ANY overlap in property names
            const hasOverlap = props1.some(prop => props2.includes(prop));

            // Check if there are conflicting property types
            const hasConflicts = props1.some(prop => {
                if (props2.includes(prop)) {
                    const type1 = schema1.properties[prop].type;
                    const type2 = schema2.properties[prop].type;
                    // Same property name but different types = conflict
                    return type1 !== type2;
                }
                return false;
            });

            // Can merge if:
            // - There's property overlap (shared structure), OR
            // - No conflicts and both schemas have properties
            // Can't merge if:
            // - Completely different property sets (no overlap) AND schemas are significantly different
            // - There are type conflicts for the same property

            if (hasConflicts) return false;

            // If there's overlap, can merge
            if (hasOverlap) return true;

            // No overlap - check if schemas are too different
            // If they're completely disjoint (no shared properties), it's likely success vs error
            const totalProps = props1.length + props2.length;
            const uniqueProps = new Set([...props1, ...props2]).size;

            // If all properties are unique, schemas are disjoint - don't merge
            if (uniqueProps === totalProps) return false;

            // Otherwise, can merge (will just combine properties)
            return true;
        }

        return false;
    }

    /**
     * Compare two schemas to see if they're equivalent
     * @param {object} schema1 - First schema
     * @param {object} schema2 - Second schema
     * @returns {boolean} True if schemas are the same
     */
    function schemasAreEqual(schema1, schema2) {
        if (!schema1 || !schema2) return false;

        // Different types
        if (schema1.type !== schema2.type) return false;

        // Primitives - just check type
        if (['string', 'number', 'boolean', 'null'].includes(schema1.type)) {
            return true;
        }

        // Arrays - compare item schemas
        if (schema1.type === 'array') {
            return schemasAreEqual(schema1.items, schema2.items);
        }

        // Objects - compare properties
        if (schema1.type === 'object') {
            const props1 = Object.keys(schema1.properties || {}).sort();
            const props2 = Object.keys(schema2.properties || {}).sort();

            // Different number of properties
            if (props1.length !== props2.length) return false;

            // Different property names
            if (JSON.stringify(props1) !== JSON.stringify(props2)) return false;

            // Compare each property recursively
            for (const key of props1) {
                if (!schemasAreEqual(schema1.properties[key], schema2.properties[key])) {
                    return false;
                }
            }

            return true;
        }

        return false;
    }

    /**
     * Get schema differences for display
     * @param {object} oldSchema - Existing schema
     * @param {object} newSchema - New schema
     * @param {string} path - Current path (for recursion)
     * @returns {object} Diff object with added, removed, changed arrays
     */
    function getSchemaDiff(oldSchema, newSchema, path = '') {
        const diff = {
            added: [],
            removed: [],
            changed: []
        };

        if (!oldSchema || !newSchema) return diff;

        // Different types at same path
        if (oldSchema.type !== newSchema.type) {
            diff.changed.push({
                path: path || '(root)',
                oldType: oldSchema.type,
                newType: newSchema.type
            });
            return diff;
        }

        // For objects, compare properties
        if (oldSchema.type === 'object' && oldSchema.properties && newSchema.properties) {
            const oldProps = Object.keys(oldSchema.properties);
            const newProps = Object.keys(newSchema.properties);

            // Find added properties
            newProps.forEach(prop => {
                if (!oldProps.includes(prop)) {
                    diff.added.push({
                        path: path ? `${path}.${prop}` : prop,
                        type: newSchema.properties[prop].type
                    });
                }
            });

            // Find removed properties
            oldProps.forEach(prop => {
                if (!newProps.includes(prop)) {
                    diff.removed.push({
                        path: path ? `${path}.${prop}` : prop,
                        type: oldSchema.properties[prop].type
                    });
                }
            });

            // Find changed properties (recursive)
            oldProps.forEach(prop => {
                if (newProps.includes(prop)) {
                    const subPath = path ? `${path}.${prop}` : prop;
                    const subDiff = getSchemaDiff(
                        oldSchema.properties[prop],
                        newSchema.properties[prop],
                        subPath
                    );
                    diff.added.push(...subDiff.added);
                    diff.removed.push(...subDiff.removed);
                    diff.changed.push(...subDiff.changed);
                }
            });
        }

        // For arrays, compare item schemas
        if (oldSchema.type === 'array' && oldSchema.items && newSchema.items) {
            const subPath = path ? `${path}[]` : '[]';
            const subDiff = getSchemaDiff(oldSchema.items, newSchema.items, subPath);
            diff.added.push(...subDiff.added);
            diff.removed.push(...subDiff.removed);
            diff.changed.push(...subDiff.changed);
        }

        return diff;
    }

    /**
     * Show modal asking user whether to replace or merge schema
     * @param {object} node - The node
     * @param {object} newSchema - The new schema
     * @param {HTMLElement} parentModalEl - Parent modal element
     */
    function showSchemaUpdateChoice(node, newSchema, parentModalEl) {
        const choiceModalId = `schemaChoice_${node.id}_${Date.now()}`;
        const existingSchema = config.responseSchemas[node.id];

        // Check if schemas can be merged
        const canMerge = schemasCanBeMerged(existingSchema.schema, newSchema);

        // Get schema differences
        const diff = getSchemaDiff(existingSchema.schema, newSchema);
        const hasDifferences = diff.added.length > 0 || diff.removed.length > 0 || diff.changed.length > 0;

        // Build diff display HTML
        let diffHtml = '';
        if (hasDifferences) {
            diffHtml = '<div class="mb-3"><h6 class="small text-muted mb-2">Schema Changes:</h6>';

            if (diff.added.length > 0) {
                diffHtml += '<div class="small mb-2"><strong class="text-success">+ Added:</strong><ul class="mb-0 ps-3">';
                diff.added.forEach(item => {
                    diffHtml += `<li><code>${item.path}</code> <span class="text-muted">(${item.type})</span></li>`;
                });
                diffHtml += '</ul></div>';
            }

            if (diff.removed.length > 0) {
                diffHtml += '<div class="small mb-2"><strong class="text-danger">- Removed:</strong><ul class="mb-0 ps-3">';
                diff.removed.forEach(item => {
                    diffHtml += `<li><code>${item.path}</code> <span class="text-muted">(${item.type})</span></li>`;
                });
                diffHtml += '</ul></div>';
            }

            if (diff.changed.length > 0) {
                diffHtml += '<div class="small mb-2"><strong class="text-warning">~ Changed:</strong><ul class="mb-0 ps-3">';
                diff.changed.forEach(item => {
                    diffHtml += `<li><code>${item.path}</code>: <span class="text-muted">${item.oldType}</span> → <span class="text-muted">${item.newType}</span></li>`;
                });
                diffHtml += '</ul></div>';
            }

            diffHtml += '</div>';
        } else {
            diffHtml = '<div class="alert alert-info py-2 small mb-3"><i class="bi bi-info-circle me-1"></i><strong>No changes detected</strong> - Schemas appear identical</div>';
        }

        const choiceModalHtml = `
            <div class="modal fade" id="${choiceModalId}" tabindex="-1">
                <div class="modal-dialog modal-dialog-centered">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title">
                                <i class="bi bi-diagram-3 me-2"></i>Schema Already Exists
                            </h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body">
                            <p>A schema already exists for node <strong>${node.id}</strong>.</p>
                            <p class="text-muted small">
                                Last saved: ${new Date(existingSchema.timestamp).toLocaleString()}
                            </p>

                            ${diffHtml}

                            ${!canMerge && hasDifferences ? `
                                <div class="alert alert-warning py-2 small mb-3">
                                    <i class="bi bi-exclamation-triangle me-1"></i>
                                    <strong>Incompatible schemas:</strong> The new response has a completely different structure. Merge is not available.
                                </div>
                            ` : ''}
                            <p class="mb-3">How would you like to update it?</p>

                            <div class="d-grid gap-2">
                                <button type="button" class="btn btn-outline-danger" id="replaceSchemaBtn">
                                    <i class="bi bi-arrow-repeat me-2"></i>
                                    <strong>Replace</strong>
                                    <div class="small text-muted">Discard old schema and use the new one</div>
                                </button>

                                ${canMerge && hasDifferences ? `
                                <button type="button" class="btn btn-outline-primary" id="mergeSchemaBtn">
                                    <i class="bi bi-unity me-2"></i>
                                    <strong>Merge</strong>
                                    <div class="small text-muted">Combine both schemas (keeps all fields)</div>
                                </button>
                                ` : ''}

                                <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">
                                    <i class="bi bi-x me-2"></i>
                                    <strong>Cancel</strong>
                                    <div class="small text-muted">Keep existing schema unchanged</div>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Add choice modal to DOM
        document.body.insertAdjacentHTML('beforeend', choiceModalHtml);

        // Initialize and show choice modal
        const choiceModalEl = document.getElementById(choiceModalId);
        const choiceModal = window.configureModal(choiceModalEl);

        // Replace button handler
        const replaceBtn = choiceModalEl.querySelector('#replaceSchemaBtn');
        replaceBtn.addEventListener('click', () => {
            storeResponseSchema(node, newSchema, false);
            showToast('Schema replaced successfully', 'success', 3000);
            choiceModal.hide();

            // Update parent modal button
            const storeBtn = parentModalEl?.querySelector('#storeSchemaBtn');
            if (storeBtn) {
                storeBtn.innerHTML = '<i class="bi bi-check-circle me-2"></i>Schema Updated!';
                storeBtn.disabled = true;
                storeBtn.classList.remove('btn-success');
                storeBtn.classList.add('btn-outline-success');
            }
        });

        // Merge button handler (only if button exists)
        const mergeBtn = choiceModalEl.querySelector('#mergeSchemaBtn');
        if (mergeBtn) {
            mergeBtn.addEventListener('click', () => {
                storeResponseSchema(node, newSchema, true);
                showToast('Schemas merged successfully', 'success', 3000);
                choiceModal.hide();

                // Update parent modal button
                const storeBtn = parentModalEl?.querySelector('#storeSchemaBtn');
                if (storeBtn) {
                    storeBtn.innerHTML = '<i class="bi bi-check-circle me-2"></i>Schema Merged!';
                    storeBtn.disabled = true;
                    storeBtn.classList.remove('btn-success');
                    storeBtn.classList.add('btn-outline-success');
                }
            });
        }

        // Clean up choice modal on close
        choiceModalEl.addEventListener('hidden.bs.modal', () => {
            choiceModalEl.remove();
        });

        choiceModal.show();
    }

    /**
     * Merge two schemas - combines properties from both
     * @param {object} existingSchema - The existing schema
     * @param {object} newSchema - The new schema to merge
     * @returns {object} Merged schema
     */
    function mergeSchemas(existingSchema, newSchema) {
        // If types don't match, keep existing
        if (existingSchema.type !== newSchema.type) {
            return existingSchema;
        }

        // For primitives, just return existing
        if (['string', 'number', 'boolean', 'null'].includes(existingSchema.type)) {
            return existingSchema;
        }

        // For arrays, merge item schemas
        if (existingSchema.type === 'array') {
            return {
                type: 'array',
                items: mergeSchemas(existingSchema.items || {}, newSchema.items || {})
            };
        }

        // For objects, merge properties
        if (existingSchema.type === 'object') {
            const mergedProperties = { ...existingSchema.properties };

            // Add new properties from newSchema
            if (newSchema.properties) {
                Object.keys(newSchema.properties).forEach(key => {
                    if (mergedProperties[key]) {
                        // Property exists in both - merge recursively
                        mergedProperties[key] = mergeSchemas(mergedProperties[key], newSchema.properties[key]);
                    } else {
                        // New property - add it
                        mergedProperties[key] = newSchema.properties[key];
                    }
                });
            }

            return {
                type: 'object',
                properties: mergedProperties
            };
        }

        // Default: return existing
        return existingSchema;
    }

    /**
     * Store response schema in config
     * @param {object} node - The node that was executed
     * @param {object} schema - Extracted schema
     * @param {boolean} shouldMerge - Whether to merge with existing schema
     */
    function storeResponseSchema(node, schema, shouldMerge = false) {
        if (!node.id) {
            console.error('[EngageNode] Cannot store schema: node has no ID');
            showToast('Cannot store schema: node must have an ID', 'error', 5000);
            return;
        }

        // Initialize responseSchemas section if not exists
        if (!config.responseSchemas) {
            config.responseSchemas = {};
        }

        // If merging and schema exists, merge the schemas
        if (shouldMerge && config.responseSchemas[node.id]) {
            const existingSchema = config.responseSchemas[node.id].schema;
            schema = mergeSchemas(existingSchema, schema);
        }

        // Store schema by node ID
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

        console.log('[EngageNode] Stored schema for node:', node.id);

        // Save to localStorage
        if (typeof saveToLocalStorage === 'function') {
            saveToLocalStorage();
        }

        // Update preview
        if (typeof updatePreview === 'function') {
            updatePreview();
        }

        // Update Response Schemas UI
        if (typeof window.renderResponseSchemas === 'function') {
            window.renderResponseSchemas();
        }

        // Update accordion header count
        updateResponseSchemasCount();
    }

    /**
     * Update the Response Schemas accordion header count
     */
    function updateResponseSchemasCount() {
        const header = document.querySelector('#responseSchemasSection')?.previousElementSibling;
        if (header) {
            const button = header.querySelector('button');
            if (button) {
                const count = Object.keys(config.responseSchemas || {}).length;
                button.textContent = `Response Schemas (${count})`;
            }
        }
    }

    /**
     * Show a toast notification
     * @param {string} message - Message to display
     * @param {string} type - Type: 'success', 'error', 'info'
     * @param {number} duration - Duration in ms (0 = no auto-hide)
     * @returns {object} Toast instance with hide() method
     */
    function showToast(message, type = 'info', duration = 3000) {
        // Use global showToast if available, otherwise create simple alert
        if (typeof window.showToast === 'function') {
            return window.showToast(message, type, duration);
        } else {
            // Fallback: use console
            console.log(`[EngageNode] ${type.toUpperCase()}: ${message}`);
            return { hide: () => {} };
        }
    }

    // Initialize on load
    if (typeof window.initTryItOut === 'undefined') {
        window.initTryItOut = initTryItOut;
    }

})();
