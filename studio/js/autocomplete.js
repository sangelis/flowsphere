// ========================================
// AUTOCOMPLETE FUNCTIONALITY
// ========================================

function initAutocomplete() {
    // Create dropdown element if it doesn't exist
    if (!autocompleteDropdown) {
        autocompleteDropdown = document.createElement('div');
        autocompleteDropdown.className = 'autocomplete-dropdown';
        document.body.appendChild(autocompleteDropdown);
    }

    // Hide dropdown when clicking anywhere outside
    document.addEventListener('mousedown', (e) => {
        if (!autocompleteDropdown || !autocompleteDropdown.classList.contains('show')) {
            return;
        }

        // Check if click is outside the dropdown and not on the target input
        const isClickOutside = !autocompleteDropdown.contains(e.target) &&
                               (!autocompleteTarget || e.target !== autocompleteTarget);

        if (isClickOutside) {
            // Don't preventDefault on interactive elements (buttons, links, inputs, etc.)
            const clickedElement = e.target;
            const isInteractive = clickedElement.closest('button, a, input, select, textarea, [role="button"]');

            if (!isInteractive) {
                e.preventDefault(); // Prevent input from losing focus (which triggers onchange)
            }

            hideAutocomplete();
        }
    }, true); // Use capture phase to ensure we catch it early
}

function attachAutocompleteToInput(input, stepIndex = null, mode = 'template') {
    // Store the mode and stepIndex on the input element
    input.dataset.autocompleteMode = mode;
    input.dataset.autocompleteStepIndex = stepIndex;

    input.addEventListener('input', function(e) {
        if (mode === 'jq') {
            handleJqAutocompleteInput(e.target);
        } else {
            handleAutocompleteInput(e.target, stepIndex);
        }
    });

    input.addEventListener('keydown', function(e) {
        if (!autocompleteDropdown || !autocompleteDropdown.classList.contains('show')) {
            return;
        }

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            autocompleteSelectedIndex = Math.min(autocompleteSelectedIndex + 1, autocompleteSuggestions.length - 1);
            updateAutocompleteSelection();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            autocompleteSelectedIndex = Math.max(autocompleteSelectedIndex - 1, -1);
            updateAutocompleteSelection();
        } else if (e.key === 'Enter' || e.key === 'Tab') {
            if (autocompleteSelectedIndex >= 0 && autocompleteSelectedIndex < autocompleteSuggestions.length) {
                e.preventDefault();
                selectAutocompleteSuggestion(autocompleteSuggestions[autocompleteSelectedIndex]);
            }
        } else if (e.key === 'Escape') {
            e.preventDefault();
            hideAutocomplete();
        }
    });

    // Handle blur with slight delay to allow clicking on dropdown
    input.addEventListener('blur', function(e) {
        setTimeout(() => {
            if (autocompleteTarget === e.target) {
                hideAutocomplete();
            }
        }, 200);
    });
}

function handleAutocompleteInput(input, stepIndex) {
    const value = input.value;
    const cursorPos = input.selectionStart;

    // Find if cursor is after "{{" and before "}}"
    const beforeCursor = value.substring(0, cursorPos);
    const lastOpenBrace = beforeCursor.lastIndexOf('{{');

    if (lastOpenBrace === -1) {
        hideAutocomplete();
        return;
    }

    const afterLastBrace = beforeCursor.substring(lastOpenBrace + 2);
    const hasCloseBrace = afterLastBrace.includes('}}');

    if (hasCloseBrace) {
        hideAutocomplete();
        return;
    }

    // Get the partial text after "{{"
    const partialText = afterLastBrace.trim();

    // Store the stepIndex for this autocomplete session
    autocompleteStepIndex = stepIndex;

    // Build suggestions
    const suggestions = buildAutocompleteSuggestions(partialText, stepIndex);

    if (suggestions.length > 0) {
        showAutocomplete(input, suggestions, lastOpenBrace + 2);
    } else {
        hideAutocomplete();
    }
}

/**
 * Build field suggestions from stored schema
 * @param {object} schema - The schema object
 * @param {string} nodeId - The node ID
 * @param {array} fieldPath - Path segments after nodeId (e.g., ['user', 'address'])
 * @param {string} partialText - Full partial text being typed
 * @returns {array} Array of field suggestions with types
 */
function buildSchemaFieldSuggestions(schema, nodeId, fieldPath, partialText) {
    const suggestions = [];

    // Navigate to the current position in the schema
    let currentSchema = schema;
    for (const segment of fieldPath) {
        if (!segment) continue; // Skip empty segments

        if (currentSchema.type === 'object' && currentSchema.properties) {
            if (currentSchema.properties[segment]) {
                currentSchema = currentSchema.properties[segment];
            } else {
                // Path doesn't exist in schema
                return suggestions;
            }
        } else if (currentSchema.type === 'array' && currentSchema.items) {
            // Handle array access
            if (segment === '0' || segment === '1' || segment === '2') {
                // Array index access - navigate to items schema
                currentSchema = currentSchema.items;
            } else if (currentSchema.items.type === 'object' && currentSchema.items.properties) {
                // Direct field access on array items
                if (currentSchema.items.properties[segment]) {
                    currentSchema = currentSchema.items.properties[segment];
                } else {
                    return suggestions;
                }
            } else {
                return suggestions;
            }
        } else {
            // Can't navigate further
            return suggestions;
        }
    }

    // Generate suggestions based on current schema type
    if (currentSchema.type === 'object' && currentSchema.properties) {
        // Show object fields
        for (const [fieldName, fieldSchema] of Object.entries(currentSchema.properties)) {
            const fullPath = ` .responses.${nodeId}.${[...fieldPath, fieldName].filter(Boolean).join('.')}`;

            // Add trailing "." for objects/arrays so user can drill deeper
            const trailingDot = (fieldSchema.type === 'object' || fieldSchema.type === 'array') ? '.' : '';

            // Check if this field matches the partial text
            if (fullPath.toLowerCase().includes(partialText.toLowerCase()) || partialText.endsWith('.')) {
                const typeInfo = getTypeDisplayInfo(fieldSchema);
                suggestions.push({
                    text: fullPath + trailingDot,
                    display: fieldName,
                    hint: typeInfo.hint,
                    category: 'Response Fields',
                    type: fieldSchema.type,
                    typeColor: typeInfo.color
                });
            }
        }
    } else if (currentSchema.type === 'array') {
        // Show array access options
        const arrayPath = ` .responses.${nodeId}.${fieldPath.filter(Boolean).join('.')}`;

        suggestions.push({
            text: arrayPath + '.[0]',
            display: '.[0]',
            hint: 'Access first item in array',
            category: 'Response Fields',
            type: 'array-index',
            typeColor: '#6c757d'
        });

        suggestions.push({
            text: arrayPath + ' | length',
            display: '| length',
            hint: 'Get array length',
            category: 'Response Fields',
            type: 'array-operation',
            typeColor: '#6c757d'
        });

        // If array items are objects, show field drilling
        if (currentSchema.items && currentSchema.items.type === 'object' && currentSchema.items.properties) {
            for (const [fieldName, fieldSchema] of Object.entries(currentSchema.items.properties)) {
                const fullPath = ` .responses.${nodeId}.${[...fieldPath, fieldName].filter(Boolean).join('.')}`;
                const typeInfo = getTypeDisplayInfo(fieldSchema);
                suggestions.push({
                    text: fullPath,
                    display: fieldName,
                    hint: `${typeInfo.hint} (in array items)`,
                    category: 'Response Fields',
                    type: fieldSchema.type,
                    typeColor: typeInfo.color
                });
            }
        }
    }

    return suggestions;
}

/**
 * Get display information for a schema type
 * @param {object} fieldSchema - The field schema
 * @returns {object} Display info with hint and color
 */
function getTypeDisplayInfo(fieldSchema) {
    const type = fieldSchema.type;

    switch (type) {
        case 'string':
            return { hint: 'string', color: '#4ade80' }; // Bright green (works in dark theme)
        case 'number':
            return { hint: 'number', color: '#60a5fa' }; // Bright blue (works in dark theme)
        case 'boolean':
            return { hint: 'boolean', color: '#c084fc' }; // Bright purple (works in dark theme)
        case 'object':
            return { hint: 'object →', color: '#fb923c' }; // Bright orange (works in dark theme)
        case 'array':
            return { hint: 'array []', color: '#22d3ee' }; // Bright cyan (works in dark theme)
        case 'null':
            return { hint: 'null', color: '#94a3b8' }; // Light gray (works in dark theme)
        default:
            return { hint: type || 'unknown', color: '#94a3b8' }; // Light gray (works in dark theme)
    }
}

/**
 * Build fixed field suggestions for command node responses
 * @param {string} nodeId - The node ID
 * @param {array} fieldPath - Path segments after nodeId
 * @param {string} partialText - Full partial text being typed
 * @returns {array} Array of command output suggestions with types
 */
function buildCommandResponseFieldSuggestions(nodeId, fieldPath, partialText) {
    const suggestions = [];

    // Only show fixed command outputs at the command response root
    if (fieldPath.length > 1) return suggestions;

    const commandOutputs = [
        { name: 'exitCode', type: 'number' },
        { name: 'stdout', type: 'string' },
        { name: 'stderr', type: 'string' },
        { name: 'json', type: 'object' }
    ];

    for (const output of commandOutputs) {
        const fullPath = ` .responses.${nodeId}.${output.name}`;

        if (fullPath.toLowerCase().includes(partialText.toLowerCase()) || partialText.endsWith('.')) {
            const typeInfo = getTypeDisplayInfo({ type: output.type });
            suggestions.push({
                text: fullPath,
                display: output.name,
                hint: typeInfo.hint,
                category: 'Response Fields',
                type: output.type,
                typeColor: typeInfo.color
            });
        }
    }

    return suggestions;
}

function buildAutocompleteSuggestions(partialText, stepIndex) {
    const suggestions = [];

    if (!config) return suggestions;

    // Count dots in partialText to determine nesting level
    const dotCount = (partialText.match(/\./g) || []).length;

    // Category: Basic Syntax (only show when starting fresh or typing first level)
    // Don't show if user has already typed a complete keyword like ".responses." (2+ dots)
    if (partialText.length <= 3 && dotCount < 2) {
        const basicSuggestions = [];

        // Add dynamic variables ($guid, $timestamp)
        const guidSyntax = ' $guid';
        const timestampSyntax = ' $timestamp';
        if (guidSyntax.toLowerCase().includes(partialText.toLowerCase()) || partialText === '') {
            basicSuggestions.push({
                text: guidSyntax,
                display: '$guid',
                hint: 'Generate unique UUID',
                category: 'Basic Syntax'
            });
        }
        if (timestampSyntax.toLowerCase().includes(partialText.toLowerCase()) || partialText === '') {
            basicSuggestions.push({
                text: timestampSyntax,
                display: '$timestamp',
                hint: 'Current Unix timestamp',
                category: 'Basic Syntax'
            });
        }

        // Add .vars if there are variables
        if (config.variables && Object.keys(config.variables).length > 0) {
            const varSyntax = ' .vars.';
            // Only match if suggestion starts with what user typed
            if (varSyntax.toLowerCase().startsWith(partialText.toLowerCase()) || partialText === '') {
                basicSuggestions.push({
                    text: varSyntax,
                    display: '.vars.<variableName>',
                    hint: 'Access global variables',
                    category: 'Basic Syntax'
                });
            }
        }

        // Add .responses if there are previous steps
        if (config.nodes && config.nodes.length > 0 && stepIndex !== null && stepIndex > 0) {
            const respNamedSyntax = ' .responses.';
            // Only match if suggestion starts with what user typed
            if (respNamedSyntax.toLowerCase().startsWith(partialText.toLowerCase()) || partialText === '') {
                basicSuggestions.push({
                    text: respNamedSyntax,
                    display: '.responses.<stepId>.<field>',
                    hint: 'Access previous step response by ID',
                    category: 'Basic Syntax'
                });
            }
        }

        // Add .input if there are prompts
        if (stepIndex !== null && config.nodes && config.nodes[stepIndex]) {
            const step = config.nodes[stepIndex];
            if (step.userPrompts && Object.keys(step.userPrompts).length > 0) {
                const inputSyntax = ' .input.';
                // Only match if suggestion starts with what user typed
                if (inputSyntax.toLowerCase().startsWith(partialText.toLowerCase()) || partialText === '') {
                    basicSuggestions.push({
                        text: inputSyntax,
                        display: '.input.<variableName>',
                        hint: 'Access user input from prompts',
                        category: 'Basic Syntax'
                    });
                }
            }
        }

        if (basicSuggestions.length > 0) {
            suggestions.push({ isCategory: true, name: 'Basic Syntax' });
            suggestions.push(...basicSuggestions);
        }
    }

    // Category: Global Variables
    if (config.variables && Object.keys(config.variables).length > 0) {
        const varSuggestions = [];
        for (const [key, value] of Object.entries(config.variables)) {
            const suggestion = ` .vars.${key}`;
            if (suggestion.toLowerCase().includes(partialText.toLowerCase()) || partialText === '') {
                varSuggestions.push({
                    text: suggestion,
                    display: `.vars.${key}`,
                    hint: `Global variable: ${JSON.stringify(value)}`,
                    category: 'Global Variables'
                });
            }
        }
        if (varSuggestions.length > 0) {
            suggestions.push({ isCategory: true, name: 'Global Variables' });
            suggestions.push(...varSuggestions);
        }
    }

    // Category: Response References
    if (config.nodes && config.nodes.length > 0 && stepIndex !== null) {
        const respSuggestions = [];

        // Add named references (by step ID)
        for (let i = 0; i < Math.min(stepIndex, config.nodes.length); i++) {
            const step = config.nodes[i];
            if (step.id) {
                const namedRef = ` .responses.${step.id}`;

                if (namedRef.toLowerCase().includes(partialText.toLowerCase()) || partialText === '') {
                    // Check if we have a schema for this node
                    const schema = config.responseSchemas?.[step.id]?.schema;
                    const isPrimitive = schema && ['string', 'number', 'boolean', 'null'].includes(schema.type);

                    if (isPrimitive) {
                        // For primitive responses, don't add trailing "." and show the type
                        const typeInfo = getTypeDisplayInfo(schema);
                        respSuggestions.push({
                            text: namedRef,
                            display: `.responses.${step.id}`,
                            hint: `${typeInfo.hint} response from: ${step.name || step.id}`,
                            category: 'Response References',
                            type: schema.type,
                            typeColor: typeInfo.color
                        });
                    } else {
                        // For object/array responses, or when no schema available
                        respSuggestions.push({
                            text: namedRef + '.',
                            display: `.responses.${step.id}.<field>`,
                            hint: `Response from step: ${step.name || step.id}`,
                            category: 'Response References'
                        });
                    }
                }
            }
        }

        if (respSuggestions.length > 0) {
            suggestions.push({ isCategory: true, name: 'Response References' });
            suggestions.push(...respSuggestions);
        }
    }

    // Category: Response Fields (from stored schemas or command node outputs)
    // Check if user is typing .responses.nodeId.
    if (partialText.startsWith('.responses.')) {
        const afterResponses = partialText.substring('.responses.'.length);
        const parts = afterResponses.split('.');

        if (parts.length >= 1) {
            const nodeId = parts[0];
            const schema = config.responseSchemas?.[nodeId];
            const node = config.nodes?.find(n => n.id === nodeId);
            const isCommandNode = node?.type === 'command' || schema?.nodeType === 'command';

            if (isCommandNode) {
                const fieldPath = parts.slice(1); // Remaining path after nodeId
                const fieldSuggestions = buildCommandResponseFieldSuggestions(
                    nodeId,
                    fieldPath,
                    partialText
                );
                const jsonSchema = schema?.schema?.properties?.json;

                if (fieldPath[0] === 'json' && jsonSchema) {
                    fieldSuggestions.push(...buildSchemaFieldSuggestions(
                        jsonSchema,
                        `${nodeId}.json`,
                        fieldPath.slice(1),
                        partialText
                    ));
                }

                if (fieldSuggestions.length > 0) {
                    const categoryName = fieldPath.length > 0
                        ? `Fields in ${nodeId}.${fieldPath.join('.')}`
                        : `Fields in ${nodeId} response`;
                    suggestions.push({ isCategory: true, name: categoryName });
                    suggestions.push(...fieldSuggestions);
                }
            } else if (schema && schema.schema) {
                const fieldPath = parts.slice(1); // Remaining path after nodeId
                const fieldSuggestions = buildSchemaFieldSuggestions(
                    schema.schema,
                    nodeId,
                    fieldPath,
                    partialText
                );

                if (fieldSuggestions.length > 0) {
                    const categoryName = fieldPath.length > 0
                        ? `Fields in ${nodeId}.${fieldPath.join('.')}`
                        : `Fields in ${nodeId} response`;
                    suggestions.push({ isCategory: true, name: categoryName });
                    suggestions.push(...fieldSuggestions);
                }
            }
        }
    }

    // Category: User Input (from current step's prompts)
    if (stepIndex !== null && config.nodes && config.nodes[stepIndex]) {
        const step = config.nodes[stepIndex];
        if (step.userPrompts && Object.keys(step.userPrompts).length > 0) {
            const inputSuggestions = [];
            for (const key of Object.keys(step.userPrompts)) {
                const suggestion = ` .input.${key}`;
                if (suggestion.toLowerCase().includes(partialText.toLowerCase()) || partialText === '') {
                    inputSuggestions.push({
                        text: suggestion,
                        display: `.input.${key}`,
                        hint: `User input: ${step.userPrompts[key]}`,
                        category: 'User Input'
                    });
                }
            }
            if (inputSuggestions.length > 0) {
                suggestions.push({ isCategory: true, name: 'User Input (Current Step)' });
                suggestions.push(...inputSuggestions);
            }
        }
    }

    return suggestions;
}

// ========================================
// JQ AUTOCOMPLETE (for jsonpath fields)
// ========================================

function handleJqAutocompleteInput(input) {
    const value = input.value;
    const cursorPos = input.selectionStart;

    // Get stepIndex from input dataset
    const stepIndex = input.dataset.autocompleteStepIndex !== undefined
        ? parseInt(input.dataset.autocompleteStepIndex)
        : null;

    // Build jq suggestions based on current context
    const suggestions = buildJqSuggestions(value, cursorPos, stepIndex);

    if (suggestions.length > 0) {
        showJqAutocomplete(input, suggestions);
    } else {
        hideAutocomplete();
    }
}

function buildJqSuggestions(value, cursorPos, stepIndex = null) {
    const suggestions = [];

    // Get text before cursor to understand context
    const beforeCursor = value.substring(0, cursorPos);
    const afterCursor = value.substring(cursorPos);

    // Check if user is typing a field path (starts with ".")
    // For example: ".token", ".user.name", ".data.items"
    if (beforeCursor.startsWith('.') && stepIndex !== null && stepIndex !== undefined) {
        const node = config.nodes[stepIndex];

        if (node && node.id && config.responseSchemas && config.responseSchemas[node.id]) {
            const schema = config.responseSchemas[node.id].schema;

            // Parse the field path being typed
            const fieldPath = beforeCursor.substring(1); // Remove leading "."
            const parts = fieldPath.split('.');

            // Get suggestions from schema
            const schemaSuggestions = buildSchemaFieldSuggestionsForJq(
                schema,
                parts,
                beforeCursor
            );

            if (schemaSuggestions.length > 0) {
                suggestions.push({ isCategory: true, name: 'Response Fields (from stored schema)' });
                suggestions.push(...schemaSuggestions);
            }
        }
    }

    // Only show jq patterns if field is empty or user just typed something
    // Check if we should show suggestions (typing at start, after space, or after pipe)
    const lastChar = beforeCursor.slice(-1);
    const isEmpty = beforeCursor.trim() === '';
    const afterPipe = beforeCursor.trim().endsWith('|');
    const afterSpace = lastChar === ' ' && !isEmpty;

    // Show suggestions when: empty field, after pipe, or field is short
    if (isEmpty || afterPipe || beforeCursor.length <= 2) {
        // Common Pattern 1: Filter array by field value
        const patternSuggestions = [
            {
                text: '.[] | select(.field == "value")',
                display: '.[] | select(.field == "value")',
                hint: 'Find items in array where field equals value',
                category: 'Common Patterns',
                isTemplate: true
            },
            {
                text: '[.[] | select(.field == "value")] | length',
                display: '[.[] | select(...)] | length',
                hint: 'Count items matching condition',
                category: 'Common Patterns',
                isTemplate: true
            },
            {
                text: '.field | length',
                display: '.field | length',
                hint: 'Get length of array or string field',
                category: 'Common Patterns',
                isTemplate: true
            }
        ];

        if (patternSuggestions.length > 0) {
            suggestions.push({ isCategory: true, name: 'Common jq Patterns' });
            suggestions.push(...patternSuggestions);
        }
    }

    return suggestions;
}

/**
 * Build field suggestions from stored schema for jq mode (validations)
 * Similar to buildSchemaFieldSuggestions but for jq jsonpath syntax
 * @param {object} schema - The schema object
 * @param {array} fieldPath - Path segments being typed (e.g., ['user', 'address'])
 * @param {string} partialText - Full partial text being typed (e.g., '.user.address')
 * @returns {array} Array of field suggestions with types
 */
function buildSchemaFieldSuggestionsForJq(schema, fieldPath, partialText) {
    const suggestions = [];

    // Special case: If we're at the root (empty path or just typing ".") and schema is primitive
    const isPrimitive = ['string', 'number', 'boolean', 'null'].includes(schema.type);
    if ((fieldPath.length === 1 && fieldPath[0] === '') && isPrimitive) {
        // Root is a primitive - suggest "." to access the value
        const typeInfo = getTypeDisplayInfo(schema);
        suggestions.push({
            text: '.',
            display: '. (root value)',
            hint: `Response is ${typeInfo.hint}`,
            category: 'Response Fields',
            type: schema.type,
            typeColor: typeInfo.color
        });
        return suggestions;
    }

    // Navigate to the current position in the schema
    let currentSchema = schema;
    for (let i = 0; i < fieldPath.length - 1; i++) {
        const segment = fieldPath[i];
        if (!segment) continue;

        if (currentSchema.type === 'object' && currentSchema.properties) {
            if (currentSchema.properties[segment]) {
                currentSchema = currentSchema.properties[segment];
            } else {
                return suggestions;
            }
        } else if (currentSchema.type === 'array' && currentSchema.items) {
            if (segment === '0' || segment === '1' || segment === '2') {
                currentSchema = currentSchema.items;
            } else if (currentSchema.items.type === 'object' && currentSchema.items.properties) {
                if (currentSchema.items.properties[segment]) {
                    currentSchema = currentSchema.items.properties[segment];
                } else {
                    return suggestions;
                }
            } else {
                return suggestions;
            }
        } else {
            return suggestions;
        }
    }

    // Generate suggestions based on current schema type
    if (currentSchema.type === 'object' && currentSchema.properties) {
        // Show object fields
        for (const [fieldName, fieldSchema] of Object.entries(currentSchema.properties)) {
            const fullPath = fieldPath.length === 1 && fieldPath[0] === ''
                ? `.${fieldName}`
                : `.${[...fieldPath.slice(0, -1), fieldName].filter(Boolean).join('.')}`;

            // Add trailing "." for objects/arrays so user can drill deeper
            const trailingDot = (fieldSchema.type === 'object' || fieldSchema.type === 'array') ? '.' : '';

            // Check if this field matches the partial text
            const lastSegment = fieldPath[fieldPath.length - 1] || '';
            if (fieldName.toLowerCase().includes(lastSegment.toLowerCase()) || lastSegment === '') {
                const typeInfo = getTypeDisplayInfo(fieldSchema);
                suggestions.push({
                    text: fullPath + trailingDot,
                    display: fieldName,
                    hint: typeInfo.hint,
                    category: 'Response Fields',
                    type: fieldSchema.type,
                    typeColor: typeInfo.color
                });
            }
        }
    } else if (currentSchema.type === 'array') {
        // Show array access options
        const arrayPath = fieldPath.length === 1 && fieldPath[0] === ''
            ? '.'
            : `.${fieldPath.slice(0, -1).filter(Boolean).join('.')}`;

        suggestions.push({
            text: arrayPath + '[0]',
            display: '[0]',
            hint: 'Access first item in array',
            category: 'Response Fields',
            type: 'array-index',
            typeColor: '#6c757d'
        });

        suggestions.push({
            text: arrayPath + ' | length',
            display: '| length',
            hint: 'Get array length',
            category: 'Response Fields',
            type: 'array-operation',
            typeColor: '#6c757d'
        });

        // If array items are objects, show field drilling
        if (currentSchema.items && currentSchema.items.type === 'object' && currentSchema.items.properties) {
            for (const [fieldName, fieldSchema] of Object.entries(currentSchema.items.properties)) {
                const fullPath = fieldPath.length === 1 && fieldPath[0] === ''
                    ? `.${fieldName}`
                    : `.${[...fieldPath.slice(0, -1), fieldName].filter(Boolean).join('.')}`;
                const typeInfo = getTypeDisplayInfo(fieldSchema);
                suggestions.push({
                    text: fullPath,
                    display: fieldName,
                    hint: `${typeInfo.hint} (in array items)`,
                    category: 'Response Fields',
                    type: fieldSchema.type,
                    typeColor: typeInfo.color
                });
            }
        }
    } else if (isPrimitive) {
        // Current position is a primitive - can't drill deeper
        // Don't suggest anything (user has already navigated to a leaf)
    }

    return suggestions;
}

function showJqAutocomplete(input, suggestions) {
    // Reuse existing showAutocomplete but don't require {{ }}
    showAutocomplete(input, suggestions, 0);
}

function getCaretCoordinates(input) {
    const position = input.selectionStart;

    if (input.tagName === 'TEXTAREA') {
        // Create mirror div for textarea
        const div = document.createElement('div');
        const computed = window.getComputedStyle(input);
        const isFirefox = window.mozInnerScreenX != null;

        // Copy all CSS properties
        div.style.position = 'absolute';
        div.style.top = '0px';
        div.style.left = '-9999px';
        div.style.whiteSpace = 'pre-wrap';
        div.style.wordWrap = 'break-word';

        // Transfer CSS properties
        const properties = [
            'direction', 'boxSizing', 'width', 'height', 'overflowX', 'overflowY',
            'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
            'borderStyle', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
            'fontStyle', 'fontVariant', 'fontWeight', 'fontStretch', 'fontSize',
            'fontSizeAdjust', 'lineHeight', 'fontFamily', 'textAlign', 'textTransform',
            'textIndent', 'textDecoration', 'letterSpacing', 'wordSpacing', 'tabSize'
        ];

        properties.forEach(prop => {
            div.style[prop] = computed[prop];
        });

        // Firefox needs this
        if (isFirefox) {
            if (input.scrollHeight > parseInt(computed.height)) {
                div.style.overflowY = 'scroll';
            }
        } else {
            div.style.overflow = 'hidden';
        }

        document.body.appendChild(div);

        // Get text before caret
        const textContent = input.value.substring(0, position);
        div.textContent = textContent;

        // Create span at caret position
        const span = document.createElement('span');
        span.textContent = input.value.substring(position) || '.';
        div.appendChild(span);

        const coordinates = {
            top: span.offsetTop - input.scrollTop,
            left: span.offsetLeft - input.scrollLeft
        };

        document.body.removeChild(div);

        return coordinates;
    } else {
        // For single-line input
        const div = document.createElement('div');
        const computed = window.getComputedStyle(input);

        div.style.position = 'absolute';
        div.style.top = '0px';
        div.style.left = '-9999px';
        div.style.whiteSpace = 'nowrap';

        // Transfer CSS properties
        const properties = [
            'boxSizing', 'width',
            'borderLeftWidth', 'borderRightWidth',
            'paddingLeft', 'paddingRight',
            'fontStyle', 'fontVariant', 'fontWeight', 'fontStretch', 'fontSize',
            'fontFamily', 'letterSpacing'
        ];

        properties.forEach(prop => {
            div.style[prop] = computed[prop];
        });

        document.body.appendChild(div);

        // Get text before caret
        const textContent = input.value.substring(0, position);
        div.textContent = textContent;

        // Create span at caret position
        const span = document.createElement('span');
        span.textContent = input.value.substring(position) || '.';
        div.appendChild(span);

        const coordinates = {
            top: parseInt(computed.height) - 5,
            left: span.offsetLeft - input.scrollLeft
        };

        document.body.removeChild(div);

        return coordinates;
    }
}

function showAutocomplete(input, suggestions, bracePosition) {
    if (!autocompleteDropdown) return;

    autocompleteTarget = input;
    autocompleteSuggestions = suggestions.filter(s => !s.isCategory);
    autocompleteSelectedIndex = autocompleteSuggestions.length > 0 ? 0 : -1;

    // Build dropdown HTML
    let html = '';
    let currentCategory = null;

    for (const suggestion of suggestions) {
        if (suggestion.isCategory) {
            html += `<div class="autocomplete-category">${suggestion.name}</div>`;
        } else {
            // Build display with type coloring if available
            const displayHtml = suggestion.typeColor
                ? `${escapeHtml(suggestion.display)} <span class="autocomplete-type" style="color: ${suggestion.typeColor}">(${escapeHtml(suggestion.hint)})</span>`
                : escapeHtml(suggestion.display);

            const hintHtml = suggestion.typeColor
                ? '' // Type is already shown inline with display
                : escapeHtml(suggestion.hint);

            html += `
                <div class="autocomplete-item" data-text="${suggestion.text.replace(/"/g, '&quot;')}">
                    <div class="autocomplete-item-main">${displayHtml}</div>
                    ${hintHtml ? `<div class="autocomplete-item-hint">${hintHtml}</div>` : ''}
                </div>
            `;
        }
    }

    autocompleteDropdown.innerHTML = html;

    // Make dropdown visible first (but position off-screen) so browser can calculate dimensions
    autocompleteDropdown.style.visibility = 'hidden';
    autocompleteDropdown.classList.add('show');

    // Use requestAnimationFrame to ensure DOM is laid out before calculating position
    requestAnimationFrame(() => {
        // Position dropdown at caret (text cursor)
        const rect = input.getBoundingClientRect();
        const caretPos = getCaretCoordinates(input);
        const inputStyle = window.getComputedStyle(input);
        const lineHeight = parseInt(inputStyle.lineHeight) || parseInt(inputStyle.fontSize) * 1.2 || 18;

        // Calculate absolute position
        // For textarea, add lineHeight to position below the current line
        // For input, caretPos.top already accounts for the input height
        let top, left;

        if (input.tagName === 'TEXTAREA') {
            top = rect.top + window.scrollY + caretPos.top + lineHeight + 2;
            left = rect.left + window.scrollX + caretPos.left;
        } else {
            top = rect.top + window.scrollY + caretPos.top;
            left = rect.left + window.scrollX + caretPos.left;
        }

        // Get actual dropdown height after layout
        const dropdownHeight = autocompleteDropdown.offsetHeight;
        const dropdownWidth = 250;
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        // Adjust if goes off right edge
        if (left + dropdownWidth > window.scrollX + viewportWidth) {
            left = Math.max(10, window.scrollX + viewportWidth - dropdownWidth - 10);
        }

        // Adjust if goes off bottom edge (use actual height instead of max height)
        if (top + dropdownHeight > window.scrollY + viewportHeight) {
            // Position above caret instead
            if (input.tagName === 'TEXTAREA') {
                top = rect.top + window.scrollY + caretPos.top - dropdownHeight - 2;
            } else {
                top = rect.top + window.scrollY - dropdownHeight - 2;
            }
        }

        autocompleteDropdown.style.top = top + 'px';
        autocompleteDropdown.style.left = left + 'px';
        autocompleteDropdown.style.visibility = 'visible';

        // Add click handlers after positioning
        const items = autocompleteDropdown.querySelectorAll('.autocomplete-item');
        items.forEach((item, index) => {
            item.addEventListener('click', () => {
                const text = item.getAttribute('data-text');
                selectAutocompleteSuggestion({ text });
            });
        });

        // Highlight the first item by default
        updateAutocompleteSelection();
    });
}

function updateAutocompleteSelection() {
    const items = autocompleteDropdown.querySelectorAll('.autocomplete-item');
    items.forEach((item, index) => {
        if (index === autocompleteSelectedIndex) {
            item.classList.add('selected');
            item.scrollIntoView({ block: 'nearest' });
        } else {
            item.classList.remove('selected');
        }
    });
}

function selectAutocompleteSuggestion(suggestion) {
    if (!autocompleteTarget || !suggestion) return;

    const input = autocompleteTarget;
    const mode = input.dataset.autocompleteMode || 'template';

    // Handle jq mode differently - just replace entire value
    if (mode === 'jq') {
        input.value = suggestion.text;
        const newCursorPos = suggestion.text.length;
        input.setSelectionRange(newCursorPos, newCursorPos);

        hideAutocomplete();
        input.focus();

        // If suggestion ends with "." (object/array field), automatically re-trigger autocomplete
        if (suggestion.text.endsWith('.')) {
            // Get stepIndex from input dataset
            const stepIndex = input.dataset.autocompleteStepIndex !== undefined
                ? parseInt(input.dataset.autocompleteStepIndex)
                : null;

            // Slight delay to ensure cursor is positioned correctly
            setTimeout(() => {
                handleJqAutocompleteInput(input);
            }, 10);
        }

        // Don't trigger change event for jq mode - it's a plain text field, not JSON
        // The validation modal will handle saving when the user clicks Save
        return;
    }

    // Template mode - existing logic
    const value = input.value;
    const cursorPos = input.selectionStart;

    // Find the "{{" before cursor
    const beforeCursor = value.substring(0, cursorPos);
    const lastOpenBrace = beforeCursor.lastIndexOf('{{');

    if (lastOpenBrace === -1) return;

    // Replace from "{{" to cursor with "{{ suggestion }}"
    const before = value.substring(0, lastOpenBrace);
    const after = value.substring(cursorPos);

    // Check if closing brackets already exist immediately after cursor (on same line)
    // Only check up to the next newline or end of string to avoid false positives from other lines
    const nextNewline = after.indexOf('\n');
    const afterCurrentLine = nextNewline === -1 ? after : after.substring(0, nextNewline);
    const hasClosingBrackets = afterCurrentLine.trimStart().startsWith('}}');

    // Check if suggestion ends with "." (expects more input)
    const expectsMoreInput = suggestion.text.trimEnd().endsWith('.');

    // If closing brackets exist, remove leading whitespace from after to avoid double spaces
    const afterCleaned = hasClosingBrackets ? after.trimStart() : after;

    // Add trailing space if closing brackets already exist and suggestion is complete
    const trailingSpace = (hasClosingBrackets && !expectsMoreInput) ? ' ' : '';

    // Only add closing brackets if they don't exist and suggestion is complete
    const closingBrackets = (hasClosingBrackets || expectsMoreInput) ? '' : ' }}';
    const newValue = before + '{{' + suggestion.text + trailingSpace + closingBrackets + afterCleaned;

    input.value = newValue;

    // Set cursor position after the inserted text
    const newCursorPos = lastOpenBrace + 2 + suggestion.text.length + trailingSpace.length + closingBrackets.length;
    input.setSelectionRange(newCursorPos, newCursorPos);

    // Always hide autocomplete after selection
    hideAutocomplete();

    input.focus();

    // If suggestion ends with "." (object/array field), automatically re-trigger autocomplete
    if (suggestion.text.endsWith('.')) {
        // Slight delay to ensure cursor is positioned correctly
        setTimeout(() => {
            handleAutocompleteInput(input, autocompleteStepIndex);
        }, 10);
    }

    // Don't trigger change event - let it fire naturally when user finishes editing (blur)
    // Triggering it immediately causes JSON parse errors when JSON is incomplete
}

function hideAutocomplete() {
    if (autocompleteDropdown) {
        autocompleteDropdown.classList.remove('show');
        autocompleteDropdown.innerHTML = '';
    }
    autocompleteTarget = null;
    autocompleteSelectedIndex = -1;
    autocompleteSuggestions = [];
    autocompleteStepIndex = null;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function attachAutocompleteToAllInputs() {
    if (!config) return;

    // Attach to global variable inputs
    const varInputs = document.querySelectorAll('#globalVariablesContainer input[type="text"]');
    varInputs.forEach(input => {
        attachAutocompleteToInput(input, null);
    });

    // Attach to default header inputs
    const headerInputs = document.querySelectorAll('#defaultHeadersContainer input[type="text"]');
    headerInputs.forEach(input => {
        attachAutocompleteToInput(input, null);
    });

    // Attach to baseUrl input
    const baseUrlInput = document.getElementById('baseUrl');
    if (baseUrlInput) {
        attachAutocompleteToInput(baseUrlInput, null);
    }

    // Attach to all step inputs
    if (config.nodes) {
        config.nodes.forEach((step, stepIndex) => {
            // Find all inputs and textareas within this step
            const stepInputs = document.querySelectorAll(`#stepsList .step-item:nth-child(${stepIndex + 1}) input[type="text"], #stepsList .step-item:nth-child(${stepIndex + 1}) textarea`);
            stepInputs.forEach(input => {
                // Skip inputs that shouldn't have autocomplete (like step name)
                const skipPlaceholders = ['Describe this step', 'uniqueStepId'];
                if (!skipPlaceholders.includes(input.placeholder)) {
                    attachAutocompleteToInput(input, stepIndex);
                }
            });
        });
    }
}

// Initialize autocomplete on page load
initAutocomplete();
