function renderDefaultValidations() {
    const validations = config.defaults?.validations || [];
    const container = document.getElementById('defaultValidations');

    if (!container) return;

    if (validations.length === 0) {
        container.innerHTML = '<div class="help-text" style="font-style: italic;">No default validations defined</div>';
        return;
    }

    container.innerHTML = validations.map((validation, index) => {
        let summary = '';
        if (validation.httpStatusCode !== undefined) {
            summary = `<strong>HTTP Status Code:</strong> ${validation.httpStatusCode}`;
        } else if (validation.jsonpath) {
            summary = `<strong>${validation.jsonpath}</strong>`;
            const criteria = [];
            if (validation.exists !== undefined) criteria.push(`exists: ${validation.exists}`);
            if (validation.equals !== undefined) criteria.push(`equals: "${validation.equals}"`);
            if (validation.notEquals !== undefined) criteria.push(`notEquals: "${validation.notEquals}"`);
            if (validation.greaterThan !== undefined) criteria.push(`> ${validation.greaterThan}`);
            if (validation.lessThan !== undefined) criteria.push(`< ${validation.lessThan}`);
            if (validation.greaterThanOrEqual !== undefined) criteria.push(`>= ${validation.greaterThanOrEqual}`);
            if (validation.lessThanOrEqual !== undefined) criteria.push(`<= ${validation.lessThanOrEqual}`);
            if (criteria.length > 0) summary += ` (${criteria.join(', ')})`;
        }

        return `
            <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px; padding: 8px; background: var(--bg-main); border: 1px solid var(--border-color); border-radius: 4px;">
                <div style="flex: 1;">${summary}</div>
                <button class="btn btn-secondary btn-small" onclick="editDefaultValidation(${index})">Edit</button>
                <button class="btn btn-danger btn-small" onclick="removeDefaultValidation(${index})">×</button>
            </div>
        `;
    }).join('');
}

function addDefaultValidation() {
    showDefaultValidationModal(-1, {status: 200});
}

function editDefaultValidation(index) {
    const validation = config.defaults.validations[index];
    showDefaultValidationModal(index, validation);
}

function removeDefaultValidation(index) {
    if (confirm('Remove this default validation?')) {
        config.defaults.validations.splice(index, 1);
        saveToLocalStorage();
        renderDefaultValidations();
        updatePreview();
    }
}

function showDefaultValidationModal(valIndex, validation) {
    showValidationModal(-1, valIndex, validation, true);
}

function addDefaultHeader() {
    config.defaults.headers = config.defaults.headers || {};
    config.defaults.headers['New-Header'] = 'value';
    saveToLocalStorage();
    renderDefaultHeaders();
    updatePreview();
}

function updateDefaultHeader(index, field, value) {
    const headers = config.defaults.headers || {};
    const keys = Object.keys(headers);
    const oldKey = keys[index];

    if (field === 'key') {
        const oldValue = headers[oldKey];
        delete headers[oldKey];
        headers[value] = oldValue;
    } else {
        headers[oldKey] = value;
    }

    config.defaults.headers = headers;
    saveToLocalStorage();
    updatePreview();
}

function removeDefaultHeader(index) {
    const headers = config.defaults.headers || {};
    const keys = Object.keys(headers);
    delete headers[keys[index]];
    saveToLocalStorage();
    renderDefaultHeaders();
    updatePreview();
}

function addStep(hint = null, skipModal = false, nodeDetails = null) {
    config.nodes = config.nodes || [];

    // If nodeDetails not provided and not skipping modal, show the "Add New Node" modal
    // The modal now handles both node details AND position selection
    if (!nodeDetails && !skipModal) {
        showAddNewNodeModal(hint);
        return;
    }

    // Determine insert position
    let insertIndex;
    let position = hint; // hint can be 'top', 'bottom', or a number

    if (position === 'top') {
        insertIndex = 0;
    } else if (position === 'bottom' || position === null) {
        insertIndex = config.nodes.length;
    } else if (typeof position === 'number') {
        insertIndex = Math.max(0, Math.min(position, config.nodes.length));
    } else {
        insertIndex = config.nodes.length;
    }

    // Create new step with provided details or defaults
    const newStep = nodeDetails
        ? (nodeDetails.type === 'command'
            ? {
                name: nodeDetails.name,
                id: nodeDetails.id,
                type: 'command',
                command: nodeDetails.command || '',
                args: nodeDetails.args || []
              }
            : {
                name: nodeDetails.name,
                id: nodeDetails.id,
                method: nodeDetails.method,
                url: nodeDetails.url,
                headers: {},
                body: {}
              })
        : {
            name: "New Node",
            method: "GET",
            url: "",
            headers: {},
            body: {}
        };

    // Insert step at position
    config.nodes.splice(insertIndex, 0, newStep);

    // Update open step indices
    const newOpenIndices = new Set();
    openStepIndices.forEach(i => {
        if (i >= insertIndex) {
            newOpenIndices.add(i + 1);
        } else {
            newOpenIndices.add(i);
        }
    });
    openStepIndices = newOpenIndices;

    // Open the newly added step
    openStepIndices.add(insertIndex);

    saveToLocalStorage();
    renderSteps();
    updatePreview();

    // Scroll to the newly added step after rendering
    setTimeout(() => scrollToStep(insertIndex), 100);
}

function showAddNewNodeModal(hint = 'bottom') {
    // Store the hint for later use
    window._newNodeHint = hint;

    const modal = document.getElementById('addNewNodeModal');
    if (!modal) {
        console.error('Add new node modal not found');
        return;
    }

    // Reset form
    document.getElementById('newNodeMethod').value = 'GET';
    document.getElementById('newNodeUrl').value = '';
    const typeSelect = document.getElementById('newNodeType');
    if (typeSelect) typeSelect.value = 'http';
    const commandInput = document.getElementById('newNodeCommand');
    if (commandInput) commandInput.value = '';
    toggleNewNodeType('http');
    document.getElementById('autoGenerateNodeDetails').checked = true;
    document.getElementById('nodePreview').style.display = 'none';

    // Show/hide position section based on number of nodes
    const MODAL_THRESHOLD = 5;
    const positionSection = document.getElementById('nodePositionSection');

    if (config.nodes && config.nodes.length > MODAL_THRESHOLD) {
        // Show position section
        positionSection.style.display = 'block';

        // Update max position
        const maxPos = config.nodes.length + 1;
        document.getElementById('newNodeMaxPosition').textContent = maxPos;
        document.getElementById('newNodeCustomPosition').setAttribute('max', maxPos);
        document.getElementById('newNodeCustomPosition').value = maxPos;

        // Pre-select position based on hint
        if (hint === 'bottom') {
            document.getElementById('newNodePositionBottom').checked = true;
        } else {
            document.getElementById('newNodePositionTop').checked = true;
        }
    } else {
        // Hide position section for small configs
        positionSection.style.display = 'none';
    }

    const bsModal = new bootstrap.Modal(modal, { backdrop: 'static', keyboard: false });
    bsModal.show();

    // Focus on URL input
    setTimeout(() => {
        document.getElementById('newNodeUrl').focus();
    }, 300);
}

function updateNodePreview() {
    const method = document.getElementById('newNodeMethod').value;
    const url = document.getElementById('newNodeUrl').value.trim();
    const autoGenerate = document.getElementById('autoGenerateNodeDetails').checked;
    const preview = document.getElementById('nodePreview');
    const nodeType = document.getElementById('newNodeType')?.value || 'http';

    if (nodeType === 'command') {
        const command = document.getElementById('newNodeCommand').value.trim();
        if (!command || !autoGenerate) {
            preview.style.display = 'none';
            return;
        }
        const generated = generateCommandNodeDetails(command);
        document.getElementById('previewId').textContent = generated.id;
        document.getElementById('previewName').textContent = generated.name;
        preview.style.display = 'block';
        return;
    }

    if (!url || !autoGenerate) {
        preview.style.display = 'none';
        return;
    }

    // Auto-generate ID and name
    const generated = generateNodeDetails(method, url);

    document.getElementById('previewId').textContent = generated.id;
    document.getElementById('previewName').textContent = generated.name;
    preview.style.display = 'block';
}

function generateNodeDetails(method, url) {
    // Extract meaningful parts from URL
    let cleanUrl = url;

    // Remove query params
    cleanUrl = cleanUrl.split('?')[0];

    // Remove leading slash
    if (cleanUrl.startsWith('/')) {
        cleanUrl = cleanUrl.substring(1);
    }

    // Split by slashes and filter out empty parts and path variables
    const parts = cleanUrl.split('/').filter(p => p && !p.startsWith('{') && !p.startsWith(':'));

    // Generate ID: method + path parts, joined with hyphens, lowercase
    const pathPart = parts.join('-').toLowerCase().replace(/[^a-z0-9-]/g, '') || 'request';
    const id = `${method.toLowerCase()}-${pathPart}`;

    // Generate Name: Method + humanized path
    let nameParts = [...parts];
    if (nameParts.length === 0) {
        nameParts = ['Request'];
    }

    // Capitalize first letter of each part
    const humanized = nameParts.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
    const name = `${method} ${humanized}`;

    return { id, name, method, url };
}

function generateCommandNodeDetails(command) {
    const base = (command || 'command').split(/[\\/]/).pop().replace(/\.[^.]+$/, '');
    const id = ('cmd-' + base).toLowerCase().replace(/[^a-z0-9-]/g, '') || 'cmd';
    const name = 'Run ' + (command || 'command');
    return { type: 'command', command: command || '', args: [], id, name };
}

function toggleNewNodeType(type) {
    const http = document.getElementById('newNodeHttpGroup');
    const cmd = document.getElementById('newNodeCommandGroup');
    const isCmd = type === 'command';
    if (http) http.style.display = isCmd ? 'none' : '';
    if (cmd) cmd.style.display = isCmd ? '' : 'none';
}

function confirmCreateNode() {
    const method = document.getElementById('newNodeMethod').value;
    const url = document.getElementById('newNodeUrl').value.trim();
    const autoGenerate = document.getElementById('autoGenerateNodeDetails').checked;

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

    // Close modal
    const modal = bootstrap.Modal.getInstance(document.getElementById('addNewNodeModal'));
    if (modal) modal.hide();

    // Get position from modal (if position section is visible)
    const positionSection = document.getElementById('nodePositionSection');
    let hint = window._newNodeHint || 'bottom';

    if (positionSection.style.display !== 'none') {
        const selectedPosition = document.querySelector('input[name="newNodePosition"]:checked')?.value;
        if (selectedPosition === 'custom') {
            const customPos = parseInt(document.getElementById('newNodeCustomPosition').value);
            if (!isNaN(customPos) && customPos >= 1 && customPos <= (config.nodes?.length || 0) + 1) {
                hint = customPos - 1; // Convert to 0-based index
            }
        } else {
            hint = selectedPosition; // 'top' or 'bottom'
        }
    }

    // Continue with adding the step (skipModal = true since we already handled position)
    addStep(hint, true, nodeDetails);
}

function skipNodeCreation() {
    // Close modal
    const modal = bootstrap.Modal.getInstance(document.getElementById('addNewNodeModal'));
    if (modal) modal.hide();

    // Get position from modal (if position section is visible)
    const positionSection = document.getElementById('nodePositionSection');
    let hint = window._newNodeHint || 'bottom';

    if (positionSection.style.display !== 'none') {
        const selectedPosition = document.querySelector('input[name="newNodePosition"]:checked')?.value;
        if (selectedPosition === 'custom') {
            const customPos = parseInt(document.getElementById('newNodeCustomPosition').value);
            if (!isNaN(customPos) && customPos >= 1 && customPos <= (config.nodes?.length || 0) + 1) {
                hint = customPos - 1; // Convert to 0-based index
            }
        } else {
            hint = selectedPosition; // 'top' or 'bottom'
        }
    }

    // Create a default node (nodeDetails = null will create default)
    addStep(hint, true, null); // skipModal = true to bypass position modal and use defaults
}

function showAddNodePositionModal(hint = 'top', nodeDetails = null) {
    // Store nodeDetails for later use
    window._pendingNodeDetails = nodeDetails;

    const modal = document.getElementById('addNodePositionModal');
    if (!modal) {
        console.error('Add node position modal not found');
        return;
    }

    // Update max position and reset form
    const maxPos = (config.nodes?.length || 0) + 1;
    const maxPosSpan = document.getElementById('maxNodePosition');
    const customPosInput = document.getElementById('customNodePosition');

    if (maxPosSpan) maxPosSpan.textContent = maxPos;
    if (customPosInput) {
        customPosInput.setAttribute('max', maxPos);
        customPosInput.value = maxPos; // Default to end position
    }

    // Pre-select radio based on hint
    const topRadio = document.getElementById('positionTop');
    const bottomRadio = document.getElementById('positionBottom');

    if (hint === 'bottom') {
        if (bottomRadio) bottomRadio.checked = true;
    } else {
        // Default to top
        if (topRadio) topRadio.checked = true;
    }

    const bsModal = new bootstrap.Modal(modal);
    bsModal.show();
}

function confirmAddNodePosition() {
    const position = document.querySelector('input[name="nodePosition"]:checked')?.value;
    const nodeDetails = window._pendingNodeDetails;

    if (position === 'custom') {
        const customPos = parseInt(document.getElementById('customNodePosition').value);
        if (!isNaN(customPos) && customPos >= 1 && customPos <= (config.nodes?.length || 0) + 1) {
            addStep(customPos - 1, true, nodeDetails); // Convert to 0-based index, skip modal
        } else {
            alert('Please enter a valid position between 1 and ' + ((config.nodes?.length || 0) + 1));
            return;
        }
    } else {
        addStep(position, true, nodeDetails); // Skip modal since we're already in the modal
    }

    // Close modal
    const modal = bootstrap.Modal.getInstance(document.getElementById('addNodePositionModal'));
    if (modal) modal.hide();
}

function scrollToStep(stepIndex) {
    const stepsAccordion = document.getElementById('stepsAccordion');
    if (!stepsAccordion) return;

    const stepItems = stepsAccordion.querySelectorAll('.accordion-item');
    const stepElement = stepItems[stepIndex];

    if (!stepElement) return;

    // Get the main scrollable container
    const editorContent = document.getElementById('editorContent');
    const scrollContainer = editorContent?.parentElement;

    if (!scrollContainer) return;

    // Calculate position to scroll to
    const containerRect = scrollContainer.getBoundingClientRect();
    const stepRect = stepElement.getBoundingClientRect();

    // Calculate the offset needed to center the step in view
    const targetScrollTop = scrollContainer.scrollTop + stepRect.top - containerRect.top - 20;

    // Smooth scroll animation
    scrollContainer.scrollTo({
        top: targetScrollTop,
        behavior: 'smooth'
    });

    // Add a highlight animation
    stepElement.style.animation = 'none';
    setTimeout(() => {
        stepElement.style.animation = 'stepHighlight 1s ease-out';
    }, 10);
}

function cloneStep(index) {
    config.nodes = config.nodes || [];

    if (index < 0 || index >= config.nodes.length) {
        console.error('Invalid step index:', index);
        return;
    }

    // Deep clone the step
    const originalStep = config.nodes[index];
    const clonedStep = JSON.parse(JSON.stringify(originalStep));

    // Modify the name to indicate it's a clone
    clonedStep.name = (clonedStep.name || 'Unnamed Node') + ' (Copy)';

    // Remove or modify the ID to avoid duplicates
    if (clonedStep.id) {
        delete clonedStep.id; // Remove ID, user can set a new one
    }

    // Insert the cloned step right after the original
    const insertIndex = index + 1;
    config.nodes.splice(insertIndex, 0, clonedStep);

    // Update open step indices
    const newOpenIndices = new Set();
    openStepIndices.forEach(i => {
        if (i >= insertIndex) {
            newOpenIndices.add(i + 1);
        } else {
            newOpenIndices.add(i);
        }
    });
    openStepIndices = newOpenIndices;

    // Open the cloned step
    openStepIndices.add(insertIndex);

    saveToLocalStorage();
    renderSteps();
    updatePreview();

    // Scroll to the cloned step
    setTimeout(() => scrollToStep(insertIndex), 100);
}

function removeStep(index) {
    if (confirm('Are you sure you want to remove this step?')) {
        config.nodes.splice(index, 1);

        // Update open step indices
        const newOpenIndices = new Set();
        openStepIndices.forEach(i => {
            if (i < index) {
                newOpenIndices.add(i);
            } else if (i > index) {
                newOpenIndices.add(i - 1);
            }
            // Skip i === index (the removed step)
        });
        openStepIndices = newOpenIndices;

        saveToLocalStorage();
        renderSteps();
        updatePreview();
    }
}

function moveStep(index, direction) {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= config.nodes.length) return;

    // Get the step element for animation
    const stepsAccordion = document.getElementById('stepsAccordion');
    const stepElement = stepsAccordion?.querySelectorAll('.accordion-item')[index];

    if (stepElement) {
        // Add fade-out animation
        stepElement.classList.add('step-fade-out');

        // Start swap almost immediately to minimize hidden time
        setTimeout(() => {
            performStepSwap(index, newIndex);
        }, 50); // Minimal delay for near-instant reappear
    } else {
        // Fallback: swap immediately if element not found
        performStepSwap(index, newIndex);
    }
}

function performStepSwap(index, newIndex) {
    const temp = config.nodes[index];
    config.nodes[index] = config.nodes[newIndex];
    config.nodes[newIndex] = temp;

    // Swap open states
    const indexWasOpen = openStepIndices.has(index);
    const newIndexWasOpen = openStepIndices.has(newIndex);

    if (indexWasOpen && !newIndexWasOpen) {
        openStepIndices.delete(index);
        openStepIndices.add(newIndex);
    } else if (!indexWasOpen && newIndexWasOpen) {
        openStepIndices.delete(newIndex);
        openStepIndices.add(index);
    }

    saveToLocalStorage();
    renderSteps();
    updatePreview();

    // Apply fade-in animation to the moved step at its new position
    setTimeout(() => {
        const stepsAccordion = document.getElementById('stepsAccordion');
        if (stepsAccordion) {
            const stepItems = stepsAccordion.querySelectorAll('.accordion-item');
            const movedStep = stepItems[newIndex];

            if (movedStep) {
                movedStep.classList.add('step-fade-in');

                // Remove class after animation completes
                setTimeout(() => {
                    movedStep.classList.remove('step-fade-in');
                }, 150); // Match fade-in animation duration
            }
        }
    }, 0);
}

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

    // Re-render steps if name or id changed (to update header)
    if (field === 'name' || field === 'id' || field === 'method') {
        renderSteps();
    }

    saveToLocalStorage();
    updatePreview();
}

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
    if (Object.prototype.hasOwnProperty.call(node.env, newKey)) {
        if (typeof showAlert === 'function') {
            showAlert('warning', `Environment variable "${newKey}" already exists. Rename cancelled.`);
        }
        renderSteps();
        return;
    }
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

function updateStepJSON(index, field, value) {
    const errorId = `json-error-${field}-${index}`;
    const textareaId = `json-textarea-${field}-${index}`;
    const errorContainer = document.getElementById(errorId);
    const textarea = document.getElementById(textareaId);

    try {
        const parsed = JSON.parse(value || '{}');
        config.nodes[index][field] = parsed;
        saveToLocalStorage();
        updatePreview();

        // Clear error message and styling on success
        if (errorContainer) {
            errorContainer.style.display = 'none';
            errorContainer.textContent = '';
        }
        if (textarea) {
            textarea.classList.remove('is-invalid');
        }
    } catch (err) {
        console.error('Invalid JSON:', err);

        // Show inline error message below textarea
        if (errorContainer) {
            errorContainer.style.display = 'block';
            errorContainer.textContent = `⚠ Invalid JSON: ${err.message}`;
        }

        // Add error styling to textarea (Bootstrap's is-invalid class adds red border)
        if (textarea) {
            textarea.classList.add('is-invalid');
        }

        // Note: The invalid JSON is NOT saved to config - the field keeps its previous valid value
    }
}

function updatePreview() {
    const jsonPreview = document.getElementById('jsonPreview');

    if (!config) {
        // Clear preview when no config
        jsonPreview.textContent = '';
        return;
    }

    // Clean up undefined fields before preview (preserve null and empty strings)
    const cleanConfig = JSON.parse(JSON.stringify(config, (key, value) => {
        if (value === undefined) return undefined;
        return value;
    }));

    jsonPreview.textContent = JSON.stringify(cleanConfig, null, 2);

    // Show file actions dropdown if config exists
    const fileActionsDropdown = document.getElementById('fileActionsDropdown');
    if (fileActionsDropdown) fileActionsDropdown.style.display = 'inline-block';
}

function positionTooltip() {
    const button = document.getElementById('copyJsonBtn');
    const tooltip = document.getElementById('copyTooltip');
    const rect = button.getBoundingClientRect();

    tooltip.style.left = rect.left + (rect.width / 2) - (tooltip.offsetWidth / 2) + 'px';
    tooltip.style.top = rect.top - tooltip.offsetHeight - 10 + 'px';
}

/**
 * Scroll JSON preview to the top
 */
function scrollJsonPreviewToTop() {
    // Check if JSON scroll-sync feature is enabled
    if (typeof FeatureRegistry !== 'undefined' && !FeatureRegistry.isFeatureEnabled('json-scroll-sync')) {
        return; // Feature disabled, skip scrolling
    }

    const jsonPreview = document.getElementById('jsonPreview');
    if (!jsonPreview) return;

    const previewContainer = jsonPreview.parentElement;
    if (previewContainer) {
        previewContainer.scrollTo({
            top: 0,
            behavior: 'instant' // Use instant for file loading
        });
    }
}

/**
 * Scroll JSON preview to a specific section and highlight it
 * If the section is already visible, only highlights it without scrolling
 * @param {string} section - Section identifier: 'general', 'variables', 'defaults', or 'step-N'
 */
function scrollToJsonSection(section) {
    // Check if JSON scroll-sync feature is enabled
    if (typeof FeatureRegistry !== 'undefined' && !FeatureRegistry.isFeatureEnabled('json-scroll-sync')) {
        return; // Feature disabled, skip scrolling
    }

    const jsonPreview = document.getElementById('jsonPreview');
    if (!jsonPreview || !config) return;

    // Check if JSON preview is collapsed - if so, skip scrolling
    const previewPanel = document.getElementById('previewPanel');
    if (previewPanel && previewPanel.classList.contains('collapsed')) {
        return; // Preview is collapsed, don't scroll
    }

    const jsonText = jsonPreview.textContent;
    const lines = jsonText.split('\n');
    let targetLine = 0;
    let targetLineCount = 0; // Number of lines the section spans

    // Find the line number and calculate span using a more robust method
    // that works with multi-line string values (like large base64 data)

    if (section === 'general') {
        // Scroll to top (enableDebug)
        targetLine = lines.findIndex(line => line.includes('"enableDebug"'));
        targetLineCount = 1; // Single line
    } else if (section === 'variables') {
        // Find variables section start
        const headerLine = lines.findIndex(line => line.includes('"variables"'));
        if (headerLine !== -1) {
            // Calculate how many lines the variables section spans
            const variablesJSON = JSON.stringify(config.variables, null, 2);
            const variablesLines = variablesJSON.split('\n');
            // Skip the opening line and brace, start at first content
            targetLine = headerLine + 1; // Line after "variables": {
            targetLineCount = variablesLines.length - 2; // Exclude opening and closing braces
        }
    } else if (section === 'defaults') {
        // Find defaults section start
        const headerLine = lines.findIndex(line => line.includes('"defaults"'));
        if (headerLine !== -1) {
            // Calculate how many lines the defaults section spans
            const defaultsJSON = JSON.stringify(config.defaults, null, 2);
            const defaultsLines = defaultsJSON.split('\n');
            // Skip the opening line and brace, start at first content
            targetLine = headerLine + 1; // Line after "defaults": {
            targetLineCount = defaultsLines.length - 2; // Exclude opening and closing braces
        }
    } else if (section.startsWith('step-')) {
        // Extract step index from section ID
        const stepIndex = parseInt(section.split('-')[1]);
        const step = config.nodes?.[stepIndex];

        if (step) {
            // Find the step by its unique identifier to locate the approximate area
            let searchPattern;
            if (step.id) {
                searchPattern = `"id": "${step.id}"`;
            } else if (step.name) {
                searchPattern = `"name": "${step.name}"`;
            } else {
                searchPattern = `"method": "${step.method}"`;
            }

            // Find the line with the identifier
            const identifierLine = lines.findIndex(line => line.includes(searchPattern));

            if (identifierLine !== -1) {
                // Now work backwards to find the opening brace of this step object
                let openingBraceLine = identifierLine;
                for (let i = identifierLine - 1; i >= 0; i--) {
                    const trimmed = lines[i].trim();
                    // Look for a line that is just an opening brace (start of step object)
                    if (trimmed === '{') {
                        openingBraceLine = i;
                        break;
                    }
                }

                // Start highlight at the first attribute line after opening brace
                targetLine = openingBraceLine + 1;

                // Calculate how many lines this step spans
                const stepJSON = JSON.stringify(step, null, 2);
                const stepLines = stepJSON.split('\n');
                targetLineCount = stepLines.length - 2; // Exclude opening and closing braces
            }
        }
    }

    if (targetLine === -1 || targetLine === 0) {
        return; // Could not find the section
    }

    if (targetLineCount === 0) {
        targetLineCount = 1; // At least highlight one line
    }

    // Calculate scroll position using computed line height
    const computedStyle = window.getComputedStyle(jsonPreview);
    const fontSize = parseFloat(computedStyle.fontSize) || 12;
    const lineHeightStr = computedStyle.lineHeight;
    let lineHeight;

    if (lineHeightStr === 'normal') {
        lineHeight = fontSize * 1.5; // Default normal line-height
    } else if (lineHeightStr.endsWith('px')) {
        lineHeight = parseFloat(lineHeightStr);
    } else {
        // It's a multiplier
        lineHeight = fontSize * parseFloat(lineHeightStr);
    }

    // Scroll first to make the content visible, THEN use Range API
    // Find the character offset where our target line starts
    let charOffset = 0;
    for (let i = 0; i < targetLine; i++) {
        charOffset += lines[i].length + 1; // +1 for newline character
    }

    // Find how many characters our target section spans
    let totalChars = 0;
    for (let i = 0; i < targetLineCount; i++) {
        if (targetLine + i < lines.length) {
            totalChars += lines[targetLine + i].length + 1;
        }
    }

    const previewContainer = jsonPreview.parentElement;
    if (previewContainer) {
        // Ensure container has position relative for absolute positioning of overlay
        if (window.getComputedStyle(previewContainer).position === 'static') {
            previewContainer.style.position = 'relative';
        }

        // Use Range API to find the EXACT position and check visibility
        // No need for initial approximate scroll
        requestAnimationFrame(() => {
            const textNode = jsonPreview.firstChild;
            if (textNode && textNode.nodeType === Node.TEXT_NODE) {
                try {
                    const range = document.createRange();
                    range.setStart(textNode, Math.min(charOffset, textNode.length));
                    range.setEnd(textNode, Math.min(charOffset + totalChars, textNode.length));

                    const rect = range.getBoundingClientRect();
                    const containerRect = previewContainer.getBoundingClientRect();

                    // Calculate absolute position within scrollable content
                    const absoluteTop = rect.top - containerRect.top + previewContainer.scrollTop;
                    const highlightHeight = rect.height;

                    // Check if section is already visible in viewport
                    const currentScrollTop = previewContainer.scrollTop;
                    const containerHeight = previewContainer.clientHeight;
                    const viewportTop = currentScrollTop;
                    const viewportBottom = currentScrollTop + containerHeight;

                    const sectionTop = absoluteTop;
                    const sectionBottom = absoluteTop + highlightHeight;

                    // Consider section visible if it's mostly within viewport (with some padding)
                    const padding = 80;
                    const isVisible =
                        (sectionTop >= viewportTop + padding) &&
                        (sectionBottom <= viewportBottom - padding);

                    // Only scroll if section is not already visible
                    if (!isVisible) {
                        const finalScroll = Math.max(0, absoluteTop - 80);
                        if (Math.abs(finalScroll - currentScrollTop) > 5) {
                            previewContainer.scrollTo({
                                top: finalScroll,
                                behavior: 'smooth'
                            });
                        }
                    }

                    // Create or update highlight overlay
                    let overlay = document.getElementById('jsonHighlightOverlay');
                    if (!overlay) {
                        overlay = document.createElement('div');
                        overlay.id = 'jsonHighlightOverlay';
                        overlay.className = 'json-highlight-overlay';
                        previewContainer.appendChild(overlay);
                    }

                    const previewPaddingLeft = parseFloat(computedStyle.paddingLeft) || 0;
                    const previewPaddingRight = parseFloat(computedStyle.paddingRight) || 0;

                    // Position overlay at the exact location
                    overlay.style.top = `${absoluteTop}px`;
                    overlay.style.left = `${previewPaddingLeft}px`;
                    overlay.style.right = `${previewPaddingRight}px`;
                    overlay.style.height = `${highlightHeight}px`;

                    // Trigger animation
                    overlay.classList.remove('active');
                    setTimeout(() => {
                        overlay.classList.add('active');
                        setTimeout(() => {
                            overlay.classList.remove('active');
                        }, 2000);
                    }, 50);
                } catch (e) {
                    console.error('[scrollToJsonSection] Range API error:', e);
                }
            }
        });
    }
}

function copyJSON() {
    if (!config) {
        alert('No configuration to copy');
        return;
    }

    const jsonText = document.getElementById('jsonPreview').textContent;
    const copyBtn = document.getElementById('copyJsonBtn');

    navigator.clipboard.writeText(jsonText).then(() => {
        // Visual feedback
        copyBtn.style.background = '#10b981';
        copyBtn.style.color = '#ffffff';

        // Reset after 1 second
        setTimeout(() => {
            copyBtn.style.background = '#374151';
            copyBtn.style.color = '#d4d4d4';
        }, 1000);
    }).catch(err => {
        console.error('Failed to copy JSON:', err);
        alert('Failed to copy JSON to clipboard');
    });
}

// Export functions to global scope for onclick handlers
window.editDefaultValidation = editDefaultValidation;
window.removeDefaultValidation = removeDefaultValidation;
window.addGlobalVariable = addGlobalVariable;
window.removeGlobalVariable = removeGlobalVariable;
window.addDefaultValidation = addDefaultValidation;
window.addDefaultHeader = addDefaultHeader;
window.removeDefaultHeader = removeDefaultHeader;
window.updateDefaultHeader = updateDefaultHeader;
window.addStep = addStep;
window.cloneStep = cloneStep;
window.removeStep = removeStep;
window.moveStep = moveStep;
window.updateStep = updateStep;
window.updateStepJSON = updateStepJSON;
window.confirmAddNodePosition = confirmAddNodePosition;
window.scrollToStep = scrollToStep;
window.updateNodePreview = updateNodePreview;
window.confirmCreateNode = confirmCreateNode;
window.scrollToJsonSection = scrollToJsonSection;
window.scrollJsonPreviewToTop = scrollJsonPreviewToTop;

// Global loader functions
function showLoader(message = 'Loading...') {
    const loader = document.getElementById('globalLoader');
    const loaderText = document.getElementById('loaderText');
    if (loader) {
        if (loaderText) loaderText.textContent = message;
        loader.classList.add('active');
    }
}

function hideLoader() {
    const loader = document.getElementById('globalLoader');
    if (loader) {
        loader.classList.remove('active');
    }
}

window.showLoader = showLoader;
window.hideLoader = hideLoader;
