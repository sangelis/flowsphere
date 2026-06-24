/**
 * Configuration file validator
 * Validates FlowSphere config files before execution
 *
 * VALIDATION CATEGORIES:
 *
 * - STRUCTURE validations: Studio UI prevents these errors
 *   Examples: missing fields, wrong types, malformed syntax, invalid HTTP methods
 *   These cannot be broken through Studio forms
 *
 * - VALUE validations: Studio UI CANNOT prevent these errors
 *   Examples: duplicate node IDs, references to deleted nodes, invalid placeholders
 *   These CAN be broken through Studio (e.g., duplicate ID when adding nodes,
 *   deleting a node that's referenced elsewhere, etc.)
 *
 * Usage:
 * - External file loads: Validate ALL (structure + value)
 * - Studio operations: Validate VALUES only (optional, with debouncing)
 */

const VALID_HTTP_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];
const VALID_COMPARISON_OPERATORS = ['equals', 'notEquals', 'greaterThan', 'lessThan', 'greaterThanOrEqual', 'lessThanOrEqual', 'exists'];
const PLACEHOLDER_REGEX = /\{\{\s*([^}]+)\s*\}\}/g;

/**
 * Main validation function
 * @param {Object} config - The configuration object to validate
 * @param {Object} options - Validation options
 * @param {boolean} options.structureOnly - Only validate structure (skip value checks)
 * @param {boolean} options.valuesOnly - Only validate values (skip structure checks)
 * @returns {Object} - { valid: boolean, errors: Array }
 */
function validateConfig(config, options = {}) {
  const { structureOnly = false, valuesOnly = false } = options;
  const errors = [];

  // Structure validation: Basic structure validation
  if (!valuesOnly) {
    if (!config || typeof config !== 'object') {
      errors.push({
        field: 'root',
        message: 'Config must be a valid object',
        type: 'structure',
        category: 'structure'
      });
      return { valid: false, errors };
    }

    // Nodes array is required
    if (!config.nodes || !Array.isArray(config.nodes)) {
      errors.push({
        field: 'nodes',
        message: 'Config must have a "nodes" array',
        type: 'structure',
        category: 'structure'
      });
      return { valid: false, errors };
    }

    if (config.nodes.length === 0) {
      errors.push({
        field: 'nodes',
        message: 'Config must have at least one node',
        type: 'structure',
        category: 'structure'
      });
      return { valid: false, errors };
    }

    // Validate global variables (if present) - structure only
    if (config.variables !== undefined) {
      validateVariables(config.variables, errors, structureOnly);
    }

    // Validate defaults (if present) - structure only
    if (config.defaults) {
      validateDefaults(config.defaults, errors, structureOnly);
    }
  }

  // Collect node IDs for reference validation
  const nodeIds = new Set();
  const duplicateIds = new Set();

  // First pass: collect and check for duplicate IDs (VALUE validation)
  config.nodes.forEach((node, index) => {
    if (!valuesOnly) {
      // Structure check: ID must exist and be a string
      if (!node.id) {
        errors.push({
          field: `nodes[${index}]`,
          message: 'Each node must have an "id" field',
          type: 'structure',
          category: 'structure',
          nodeIndex: index,
          nodeName: node.name || `Node ${index}`
        });
      } else if (typeof node.id !== 'string') {
        errors.push({
          field: `nodes[${index}].id`,
          message: 'Node "id" must be a string',
          type: 'structure',
          category: 'structure',
          nodeIndex: index,
          nodeId: node.id
        });
      }
    }

    // Value check: ID must be unique (this CAN be broken in Studio)
    if (!structureOnly && node.id && typeof node.id === 'string') {
      if (nodeIds.has(node.id)) {
        duplicateIds.add(node.id);
        errors.push({
          field: `nodes[${index}].id`,
          message: `Duplicate node ID: "${node.id}"`,
          type: 'duplicate',
          category: 'value',
          nodeIndex: index,
          nodeId: node.id,
          suggestion: 'Each node must have a unique ID'
        });
      }
      nodeIds.add(node.id);
    } else if (node.id) {
      nodeIds.add(node.id);
    }
  });

  // Second pass: validate each node
  config.nodes.forEach((node, index) => {
    validateNode(node, index, nodeIds, config.defaults, errors, structureOnly, valuesOnly);
  });

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Validate global variables section
 */
function validateVariables(variables, errors, structureOnly = false) {
  if (typeof variables !== 'object' || Array.isArray(variables)) {
    errors.push({
      field: 'variables',
      message: 'The "variables" field must be an object',
      type: 'structure'
    });
    return;
  }

  // Check that all values are primitives (string, number, boolean)
  Object.entries(variables).forEach(([key, value]) => {
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
      errors.push({
        field: `variables.${key}`,
        message: `Variable "${key}" must be a string, number, or boolean`,
        type: 'type',
        suggestion: 'Variables should be simple values, not objects or arrays'
      });
    }
  });
}

/**
 * Validate defaults section
 */
function validateDefaults(defaults, errors, structureOnly = false) {
  if (typeof defaults !== 'object' || Array.isArray(defaults)) {
    errors.push({
      field: 'defaults',
      message: 'The "defaults" field must be an object',
      type: 'structure'
    });
    return;
  }

  // Validate baseUrl
  if (defaults.baseUrl !== undefined) {
    if (typeof defaults.baseUrl !== 'string') {
      errors.push({
        field: 'defaults.baseUrl',
        message: 'baseUrl must be a string',
        type: 'type'
      });
    } else if (!isValidUrl(defaults.baseUrl)) {
      errors.push({
        field: 'defaults.baseUrl',
        message: `Invalid baseUrl: "${defaults.baseUrl}"`,
        type: 'format',
        suggestion: 'baseUrl must be a valid URL (e.g., https://api.example.com)'
      });
    }
  }

  // Validate timeout
  if (defaults.timeout !== undefined) {
    if (typeof defaults.timeout !== 'number' || defaults.timeout <= 0) {
      errors.push({
        field: 'defaults.timeout',
        message: 'timeout must be a positive number (seconds)',
        type: 'type'
      });
    }
  }

  if (defaults.cwd !== undefined && typeof defaults.cwd !== 'string') {
    errors.push({
      field: 'defaults.cwd',
      message: 'cwd must be a string',
      type: 'type'
    });
  }

  if (defaults.env !== undefined) {
    if (typeof defaults.env !== 'object' || Array.isArray(defaults.env) || defaults.env === null) {
      errors.push({
        field: 'defaults.env',
        message: 'env must be an object',
        type: 'type'
      });
    } else {
      Object.entries(defaults.env).forEach(([key, value]) => {
        if (typeof value !== 'string') {
          errors.push({
            field: 'defaults.env',
            message: `env "${key}" must be a string`,
            type: 'type'
          });
        }
      });
    }
  }

  // Validate headers
  if (defaults.headers !== undefined) {
    if (typeof defaults.headers !== 'object' || Array.isArray(defaults.headers)) {
      errors.push({
        field: 'defaults.headers',
        message: 'headers must be an object',
        type: 'type'
      });
    }
  }

  // Validate default validations
  if (defaults.validations !== undefined) {
    if (!Array.isArray(defaults.validations)) {
      errors.push({
        field: 'defaults.validations',
        message: 'validations must be an array',
        type: 'type'
      });
    } else {
      defaults.validations.forEach((validation, vIndex) => {
        validateValidationRule(validation, `defaults.validations[${vIndex}]`, errors);
      });
    }
  }
}

/**
 * Validate a single node
 */
function validateNode(node, index, nodeIds, defaults, errors, structureOnly = false, valuesOnly = false) {
  const nodePrefix = `nodes[${index}]`;
  const nodeId = node.id || `Node ${index}`;
  const nodeType = node.type || 'http';

  if (!valuesOnly && node.type !== undefined && !['http', 'command'].includes(node.type)) {
    errors.push({
      field: `${nodePrefix}.type`,
      message: 'type must be "http" or "command"',
      type: 'value',
      category: 'structure',
      nodeIndex: index,
      nodeId
    });
  }

  if (nodeType === 'command') {
    return validateCommandNode(node, nodePrefix, index, nodeId, nodeIds, errors, structureOnly, valuesOnly);
  }

  // STRUCTURE: Validate required fields exist
  if (!valuesOnly) {
    if (!node.method) {
      errors.push({
        field: `${nodePrefix}.method`,
        message: 'Node must have a "method" field',
        type: 'structure',
        category: 'structure',
        nodeIndex: index,
        nodeId
      });
    } else if (typeof node.method !== 'string' || !VALID_HTTP_METHODS.includes(node.method.toUpperCase())) {
      errors.push({
        field: `${nodePrefix}.method`,
        message: `Invalid HTTP method: "${node.method}"`,
        type: 'value',
        category: 'structure',
        nodeIndex: index,
        nodeId,
        suggestion: `Valid methods: ${VALID_HTTP_METHODS.join(', ')}`
      });
    }

    if (!node.url) {
      errors.push({
        field: `${nodePrefix}.url`,
        message: 'Node must have a "url" field',
        type: 'structure',
        category: 'structure',
        nodeIndex: index,
        nodeId
      });
    }
  } else if (typeof node.url !== 'string') {
    errors.push({
      field: `${nodePrefix}.url`,
      message: 'url must be a string',
      type: 'type',
      nodeIndex: index,
      nodeId
    });
  } else {
    // Validate URL format (after placeholder substitution check)
    const urlWithoutPlaceholders = node.url.replace(PLACEHOLDER_REGEX, 'PLACEHOLDER');
    if (urlWithoutPlaceholders.startsWith('/')) {
      // Relative URL - check if baseUrl exists
      if (!defaults?.baseUrl) {
        errors.push({
          field: `${nodePrefix}.url`,
          message: 'Relative URL requires baseUrl in defaults',
          type: 'reference',
          nodeIndex: index,
          nodeId,
          suggestion: 'Either add baseUrl to defaults or use an absolute URL'
        });
      }
    } else if (!isValidUrl(urlWithoutPlaceholders) && !urlWithoutPlaceholders.startsWith('http')) {
      errors.push({
        field: `${nodePrefix}.url`,
        message: `Invalid URL format: "${node.url}"`,
        type: 'format',
        nodeIndex: index,
        nodeId,
        suggestion: 'URL must be absolute (https://...) or relative (/path)'
      });
    }
  }

  // Validate optional fields
  if (node.timeout !== undefined) {
    if (typeof node.timeout !== 'number' || node.timeout <= 0) {
      errors.push({
        field: `${nodePrefix}.timeout`,
        message: 'timeout must be a positive number (seconds)',
        type: 'type',
        nodeIndex: index,
        nodeId
      });
    }
  }

  if (node.headers !== undefined) {
    if (typeof node.headers !== 'object' || Array.isArray(node.headers)) {
      errors.push({
        field: `${nodePrefix}.headers`,
        message: 'headers must be an object',
        type: 'type',
        nodeIndex: index,
        nodeId
      });
    }
  }

  // VALUE: Validate body matches content-type
  if (!structureOnly && node.body !== undefined) {
    // Get effective headers (merge defaults + node headers)
    const effectiveHeaders = {
      ...(defaults?.headers || {}),
      ...(node.headers || {})
    };

    // Find Content-Type header (case-insensitive)
    const contentTypeKey = Object.keys(effectiveHeaders).find(
      key => key.toLowerCase() === 'content-type'
    );
    const contentType = contentTypeKey ? effectiveHeaders[contentTypeKey] : null;

    // If Content-Type is JSON, body should be object or array (not string/number/boolean/null)
    if (contentType && contentType.toLowerCase().includes('application/json')) {
      const bodyType = typeof node.body;
      const isValidJsonBody = bodyType === 'object' && node.body !== null;

      if (!isValidJsonBody) {
        errors.push({
          field: `${nodePrefix}.body`,
          message: `Body must be an object or array when Content-Type is "application/json" (got ${bodyType === 'object' && node.body === null ? 'null' : bodyType})`,
          type: 'value',
          category: 'value',
          nodeIndex: index,
          nodeId,
          suggestion: 'Use an object like {"key": "value"} or an array [1, 2, 3] for JSON requests'
        });
      } else {
        // Check if the body can be successfully stringified (no circular references, etc.)
        try {
          JSON.stringify(node.body);
        } catch (stringifyError) {
          errors.push({
            field: `${nodePrefix}.body`,
            message: `Body cannot be serialized to JSON: ${stringifyError.message}`,
            type: 'value',
            category: 'value',
            nodeIndex: index,
            nodeId,
            suggestion: 'Remove circular references or invalid JSON values from the body'
          });
        }
      }
    }
  }

  // Validate userPrompts
  if (node.userPrompts !== undefined) {
    validateUserPrompts(node.userPrompts, nodePrefix, index, nodeId, errors);
  }

  // Validate conditions
  if (node.conditions !== undefined) {
    validateConditions(node.conditions, nodePrefix, index, nodeId, nodeIds, errors);
  }

  // Legacy: single condition field (deprecated but still supported)
  if (node.condition !== undefined) {
    validateCondition(node.condition, `${nodePrefix}.condition`, index, nodeId, nodeIds, errors);
  }

  // Validate validations
  if (node.validations !== undefined) {
    if (!Array.isArray(node.validations)) {
      errors.push({
        field: `${nodePrefix}.validations`,
        message: 'validations must be an array',
        type: 'type',
        nodeIndex: index,
        nodeId
      });
    } else {
      node.validations.forEach((validation, vIndex) => {
        validateValidationRule(validation, `${nodePrefix}.validations[${vIndex}]`, errors, index, nodeId);
      });
    }
  }

  // Validate launchBrowser
  if (node.launchBrowser !== undefined) {
    if (typeof node.launchBrowser !== 'string') {
      errors.push({
        field: `${nodePrefix}.launchBrowser`,
        message: 'launchBrowser must be a string (jsonpath)',
        type: 'type',
        nodeIndex: index,
        nodeId
      });
    } else if (!node.launchBrowser.startsWith('.')) {
      errors.push({
        field: `${nodePrefix}.launchBrowser`,
        message: 'launchBrowser must be a valid jsonpath (e.g., ".url" or ".data.authUrl")',
        type: 'format',
        nodeIndex: index,
        nodeId,
        suggestion: 'Jsonpath must start with a dot (.)'
      });
    }
  }

  // Validate placeholder references in the entire node (VALUE validation)
  validatePlaceholders(node, nodePrefix, index, nodeId, nodeIds, errors, structureOnly, valuesOnly);
}

function validateCommandNode(node, nodePrefix, index, nodeId, nodeIds, errors, structureOnly = false, valuesOnly = false) {
  const disallowedHttpFields = ['method', 'url', 'headers', 'body'];

  if (!valuesOnly) {
    if (!node.command || typeof node.command !== 'string') {
      errors.push({
        field: `${nodePrefix}.command`,
        message: 'Command node must have a "command" field',
        type: 'structure',
        category: 'structure',
        nodeIndex: index,
        nodeId
      });
    }

    disallowedHttpFields.forEach((field) => {
      if (node[field] !== undefined) {
        errors.push({
          field: `${nodePrefix}.${field}`,
          message: `"${field}" is not supported on command nodes`,
          type: 'structure',
          category: 'structure',
          nodeIndex: index,
          nodeId
        });
      }
    });
  }

  if (node.args !== undefined) {
    if (!Array.isArray(node.args) || node.args.some((arg) => typeof arg !== 'string')) {
      errors.push({
        field: `${nodePrefix}.args`,
        message: 'args must be an array of strings',
        type: 'type',
        nodeIndex: index,
        nodeId
      });
    }
  }

  if (node.cwd !== undefined && typeof node.cwd !== 'string') {
    errors.push({
      field: `${nodePrefix}.cwd`,
      message: 'cwd must be a string',
      type: 'type',
      nodeIndex: index,
      nodeId
    });
  }

  if (node.env !== undefined) {
    if (typeof node.env !== 'object' || Array.isArray(node.env) || node.env === null) {
      errors.push({
        field: `${nodePrefix}.env`,
        message: 'env must be an object',
        type: 'type',
        nodeIndex: index,
        nodeId
      });
    } else {
      Object.entries(node.env).forEach(([key, value]) => {
        if (typeof value !== 'string') {
          errors.push({
            field: `${nodePrefix}.env`,
            message: `env "${key}" must be a string`,
            type: 'type',
            nodeIndex: index,
            nodeId
          });
        }
      });
    }
  }

  if (node.statusFrom !== undefined) {
    if (typeof node.statusFrom !== 'string' || !node.statusFrom.startsWith('.')) {
      errors.push({
        field: `${nodePrefix}.statusFrom`,
        message: 'statusFrom must be a jsonpath string that starts with "."',
        type: 'format',
        nodeIndex: index,
        nodeId
      });
    }
  }

  if (node.timeout !== undefined && (typeof node.timeout !== 'number' || node.timeout <= 0)) {
    errors.push({
      field: `${nodePrefix}.timeout`,
      message: 'timeout must be a positive number (seconds)',
      type: 'type',
      nodeIndex: index,
      nodeId
    });
  }

  if (node.userPrompts !== undefined) {
    validateUserPrompts(node.userPrompts, nodePrefix, index, nodeId, errors);
  }
  if (node.conditions !== undefined) {
    validateConditions(node.conditions, nodePrefix, index, nodeId, nodeIds, errors);
  }
  if (node.condition !== undefined) {
    validateCondition(node.condition, `${nodePrefix}.condition`, index, nodeId, nodeIds, errors);
  }
  if (node.validations !== undefined) {
    if (!Array.isArray(node.validations)) {
      errors.push({
        field: `${nodePrefix}.validations`,
        message: 'validations must be an array',
        type: 'type',
        nodeIndex: index,
        nodeId
      });
    } else {
      node.validations.forEach((validation, vIndex) => {
        validateValidationRule(validation, `${nodePrefix}.validations[${vIndex}]`, errors, index, nodeId);
      });
    }
  }
  if (node.launchBrowser !== undefined) {
    if (typeof node.launchBrowser !== 'string') {
      errors.push({
        field: `${nodePrefix}.launchBrowser`,
        message: 'launchBrowser must be a string (jsonpath)',
        type: 'type',
        nodeIndex: index,
        nodeId
      });
    } else if (!node.launchBrowser.startsWith('.')) {
      errors.push({
        field: `${nodePrefix}.launchBrowser`,
        message: 'launchBrowser must be a valid jsonpath (e.g., ".url" or ".data.authUrl")',
        type: 'format',
        nodeIndex: index,
        nodeId,
        suggestion: 'Jsonpath must start with a dot (.)'
      });
    }
  }

  validatePlaceholders(node, nodePrefix, index, nodeId, nodeIds, errors, structureOnly, valuesOnly);
}

/**
 * Validate user prompts
 */
function validateUserPrompts(userPrompts, nodePrefix, nodeIndex, nodeId, errors) {
  if (typeof userPrompts !== 'object' || Array.isArray(userPrompts)) {
    errors.push({
      field: `${nodePrefix}.userPrompts`,
      message: 'userPrompts must be an object',
      type: 'type',
      nodeIndex,
      nodeId
    });
    return;
  }

  Object.entries(userPrompts).forEach(([key, prompt]) => {
    if (typeof prompt !== 'string') {
      errors.push({
        field: `${nodePrefix}.userPrompts.${key}`,
        message: `Prompt for "${key}" must be a string`,
        type: 'type',
        nodeIndex,
        nodeId
      });
    }
  });
}

/**
 * Validate conditions array
 */
function validateConditions(conditions, nodePrefix, nodeIndex, nodeId, nodeIds, errors) {
  if (!Array.isArray(conditions)) {
    errors.push({
      field: `${nodePrefix}.conditions`,
      message: 'conditions must be an array',
      type: 'type',
      nodeIndex,
      nodeId,
      suggestion: 'Use an array for multiple conditions: [{"node": "...", ...}]'
    });
    return;
  }

  conditions.forEach((condition, cIndex) => {
    validateCondition(condition, `${nodePrefix}.conditions[${cIndex}]`, nodeIndex, nodeId, nodeIds, errors);
  });
}

/**
 * Validate a single condition
 */
function validateCondition(condition, fieldPath, nodeIndex, nodeId, nodeIds, errors) {
  if (typeof condition !== 'object' || Array.isArray(condition)) {
    errors.push({
      field: fieldPath,
      message: 'Each condition must be an object',
      type: 'type',
      nodeIndex,
      nodeId
    });
    return;
  }

  // Count source types
  const hasNode = 'node' in condition;
  const hasVariable = 'variable' in condition;
  const hasInput = 'input' in condition;
  const hasResponse = 'response' in condition; // Legacy

  const sourceCount = [hasNode, hasVariable, hasInput, hasResponse].filter(Boolean).length;

  if (sourceCount === 0) {
    errors.push({
      field: fieldPath,
      message: 'Condition must specify a source: "node", "variable", or "input"',
      type: 'structure',
      nodeIndex,
      nodeId,
      suggestion: 'Use {"node": "stepId", "field": ".path", "equals": "value"} or {"variable": "varName", "equals": "value"} or {"input": "inputName", "equals": "value"}'
    });
    return;
  }

  if (sourceCount > 1) {
    errors.push({
      field: fieldPath,
      message: 'Condition must have only one source (node, variable, or input)',
      type: 'structure',
      nodeIndex,
      nodeId
    });
    return;
  }

  // Validate based on source type
  if (hasNode) {
    validateNodeCondition(condition, fieldPath, nodeIndex, nodeId, nodeIds, errors);
  } else if (hasVariable) {
    validateVariableCondition(condition, fieldPath, nodeIndex, nodeId, errors);
  } else if (hasInput) {
    validateInputCondition(condition, fieldPath, nodeIndex, nodeId, errors);
  } else if (hasResponse) {
    // Legacy response-based condition
    validateLegacyResponseCondition(condition, fieldPath, nodeIndex, nodeId, errors);
  }
}

/**
 * Validate node-based condition
 */
function validateNodeCondition(condition, fieldPath, nodeIndex, nodeId, nodeIds, errors) {
  // Validate node reference
  if (typeof condition.node !== 'string') {
    errors.push({
      field: fieldPath,
      message: 'Condition "node" must be a string (node ID)',
      type: 'type',
      nodeIndex,
      nodeId
    });
  } else if (!nodeIds.has(condition.node)) {
    errors.push({
      field: fieldPath,
      message: `Condition references non-existent node: "${condition.node}"`,
      type: 'reference',
      nodeIndex,
      nodeId,
      suggestion: `Valid node IDs: ${Array.from(nodeIds).join(', ')}`
    });
  }

  // Check for comparison operator (but not for statusCode which is special)
  if (!condition.statusCode) {
    // Must have field for non-statusCode conditions
    if (!condition.field) {
      errors.push({
        field: fieldPath,
        message: 'Node condition must have "field" (jsonpath) or "statusCode"',
        type: 'structure',
        nodeIndex,
        nodeId,
        suggestion: 'Use {"node": "stepId", "field": ".path", "equals": "value"} or {"node": "stepId", "statusCode": 200}'
      });
    } else if (typeof condition.field !== 'string') {
      errors.push({
        field: fieldPath,
        message: 'Condition "field" must be a string (jsonpath)',
        type: 'type',
        nodeIndex,
        nodeId
      });
    } else if (!condition.field.startsWith('.')) {
      errors.push({
        field: fieldPath,
        message: 'Condition "field" must be a valid jsonpath starting with "."',
        type: 'format',
        nodeIndex,
        nodeId,
        suggestion: 'Example: ".id" or ".data.userId"'
      });
    }

    // Must have at least one comparison operator
    const hasOperator = VALID_COMPARISON_OPERATORS.some(op => op in condition);
    if (!hasOperator) {
      errors.push({
        field: fieldPath,
        message: 'Condition must have a comparison operator',
        type: 'structure',
        nodeIndex,
        nodeId,
        suggestion: `Valid operators: ${VALID_COMPARISON_OPERATORS.join(', ')}`
      });
    }
  } else {
    // statusCode condition
    if (typeof condition.statusCode !== 'number') {
      errors.push({
        field: fieldPath,
        message: 'Condition "statusCode" must be a number',
        type: 'type',
        nodeIndex,
        nodeId
      });
    }
  }
}

/**
 * Validate variable-based condition
 */
function validateVariableCondition(condition, fieldPath, nodeIndex, nodeId, errors) {
  if (typeof condition.variable !== 'string') {
    errors.push({
      field: fieldPath,
      message: 'Condition "variable" must be a string (variable name)',
      type: 'type',
      nodeIndex,
      nodeId
    });
  }

  // Must have at least one comparison operator
  const hasOperator = VALID_COMPARISON_OPERATORS.some(op => op in condition);
  if (!hasOperator) {
    errors.push({
      field: fieldPath,
      message: 'Variable condition must have a comparison operator',
      type: 'structure',
      nodeIndex,
      nodeId,
      suggestion: `Valid operators: ${VALID_COMPARISON_OPERATORS.join(', ')}`
    });
  }
}

/**
 * Validate input-based condition
 */
function validateInputCondition(condition, fieldPath, nodeIndex, nodeId, errors) {
  if (typeof condition.input !== 'string') {
    errors.push({
      field: fieldPath,
      message: 'Condition "input" must be a string (input variable name)',
      type: 'type',
      nodeIndex,
      nodeId
    });
  }

  // Must have at least one comparison operator
  const hasOperator = VALID_COMPARISON_OPERATORS.some(op => op in condition);
  if (!hasOperator) {
    errors.push({
      field: fieldPath,
      message: 'Input condition must have a comparison operator',
      type: 'structure',
      nodeIndex,
      nodeId,
      suggestion: `Valid operators: ${VALID_COMPARISON_OPERATORS.join(', ')}`
    });
  }
}

/**
 * Validate legacy response-based condition (deprecated)
 */
function validateLegacyResponseCondition(condition, fieldPath, nodeIndex, nodeId, errors) {
  if (typeof condition.response !== 'number') {
    errors.push({
      field: fieldPath,
      message: 'Legacy condition "response" must be a number (step index)',
      type: 'type',
      nodeIndex,
      nodeId,
      suggestion: 'Consider using the new "node" syntax: {"node": "stepId", ...}'
    });
  }

  // Can have either statusCode or field
  if (condition.statusCode !== undefined) {
    if (typeof condition.statusCode !== 'number') {
      errors.push({
        field: fieldPath,
        message: 'Condition "statusCode" must be a number',
        type: 'type',
        nodeIndex,
        nodeId
      });
    }
  } else if (condition.field !== undefined) {
    if (typeof condition.field !== 'string' || !condition.field.startsWith('.')) {
      errors.push({
        field: fieldPath,
        message: 'Condition "field" must be a valid jsonpath starting with "."',
        type: 'format',
        nodeIndex,
        nodeId
      });
    }

    // Must have comparison operator
    const hasOperator = VALID_COMPARISON_OPERATORS.some(op => op in condition);
    if (!hasOperator) {
      errors.push({
        field: fieldPath,
        message: 'Condition must have a comparison operator',
        type: 'structure',
        nodeIndex,
        nodeId,
        suggestion: `Valid operators: ${VALID_COMPARISON_OPERATORS.join(', ')}`
      });
    }
  } else {
    errors.push({
      field: fieldPath,
      message: 'Legacy condition must have "statusCode" or "field"',
      type: 'structure',
      nodeIndex,
      nodeId
    });
  }
}

/**
 * Validate a validation rule
 */
function validateValidationRule(validation, fieldPath, errors, nodeIndex, nodeId) {
  if (typeof validation !== 'object' || Array.isArray(validation)) {
    errors.push({
      field: fieldPath,
      message: 'Each validation must be an object',
      type: 'type',
      nodeIndex,
      nodeId
    });
    return;
  }

  // Check if it's a status code validation or jsonpath validation
  const hasStatusCode = 'httpStatusCode' in validation;
  const hasJsonpath = 'jsonpath' in validation;

  if (!hasStatusCode && !hasJsonpath) {
    errors.push({
      field: fieldPath,
      message: 'Validation must have "httpStatusCode" or "jsonpath"',
      type: 'structure',
      nodeIndex,
      nodeId,
      suggestion: 'Use {"httpStatusCode": 200} or {"jsonpath": ".field", "exists": true}'
    });
    return;
  }

  if (hasStatusCode) {
    if (typeof validation.httpStatusCode !== 'number') {
      errors.push({
        field: fieldPath,
        message: 'httpStatusCode must be a number',
        type: 'type',
        nodeIndex,
        nodeId
      });
    }
  }

  if (hasJsonpath) {
    if (typeof validation.jsonpath !== 'string') {
      errors.push({
        field: fieldPath,
        message: 'jsonpath must be a string',
        type: 'type',
        nodeIndex,
        nodeId
      });
    } else if (!validation.jsonpath.startsWith('.')) {
      errors.push({
        field: fieldPath,
        message: 'jsonpath must start with "." (e.g., ".id" or ".data.userId")',
        type: 'format',
        nodeIndex,
        nodeId
      });
    }

    // Validate comparison operators if present
    const hasOperator = VALID_COMPARISON_OPERATORS.some(op => op in validation);
    // It's okay to have no operator (defaults to exists check)
  }
}

/**
 * Check for malformed placeholders (missing opening or closing braces)
 * Recursively checks all string values in an object/array
 */
function checkForMalformedPlaceholders(obj, nodePrefix, nodeIndex, nodeId, errors, path = '') {
  if (typeof obj === 'string') {
    // Check this string value for malformed placeholders
    const openCount = (obj.match(/\{\{/g) || []).length;
    const closeCount = (obj.match(/\}\}/g) || []).length;

    if (openCount !== closeCount) {
      // Show a snippet of the malformed placeholder
      const snippet = obj.length > 60 ? obj.substring(0, 60) + '...' : obj;
      errors.push({
        field: nodePrefix + (path ? `.${path}` : ''),
        message: `Malformed placeholder: Found ${openCount} opening "{{" but ${closeCount} closing "}}"`,
        type: 'format',
        category: 'value',
        nodeIndex,
        nodeId,
        suggestion: `Check: "${snippet}" - all placeholders need both {{ and }}`
      });
    }
  } else if (Array.isArray(obj)) {
    // Recursively check array elements
    obj.forEach((item, index) => {
      checkForMalformedPlaceholders(item, nodePrefix, nodeIndex, nodeId, errors, path ? `${path}[${index}]` : `[${index}]`);
    });
  } else if (obj && typeof obj === 'object') {
    // Recursively check object properties
    Object.keys(obj).forEach(key => {
      checkForMalformedPlaceholders(obj[key], nodePrefix, nodeIndex, nodeId, errors, path ? `${path}.${key}` : key);
    });
  }
}

/**
 * Validate placeholder references throughout the node
 * VALUE VALIDATION: Checks if referenced nodes exist (can be broken in Studio)
 */
function validatePlaceholders(node, nodePrefix, nodeIndex, nodeId, nodeIds, errors, structureOnly = false, valuesOnly = false) {
  // First, check for malformed placeholders by examining all string values
  if (!structureOnly) {
    checkForMalformedPlaceholders(node, nodePrefix, nodeIndex, nodeId, errors);
  }

  // Now validate complete/well-formed placeholders
  const nodeStr = JSON.stringify(node);
  const matches = nodeStr.matchAll(PLACEHOLDER_REGEX);

  for (const match of matches) {
    const placeholder = match[1].trim();

    // Check placeholder syntax
    if (placeholder.startsWith('.responses.')) {
      // Response reference
      const parts = placeholder.split('.');

      // STRUCTURE: Syntax check (Studio prevents this)
      if (!valuesOnly && parts.length < 3) {
        errors.push({
          field: nodePrefix,
          message: `Invalid response placeholder: "{{ ${placeholder} }}"`,
          type: 'format',
          category: 'structure',
          nodeIndex,
          nodeId,
          suggestion: 'Use {{ .responses.nodeId.field }} syntax'
        });
        continue;
      }

      // VALUE: Reference check (Studio CAN'T prevent - you can delete a referenced node)
      if (!structureOnly && parts.length >= 3) {
        const referencedNodeId = parts[2];
        if (!nodeIds.has(referencedNodeId)) {
          errors.push({
            field: nodePrefix,
            message: `Response placeholder references non-existent node: "${referencedNodeId}"`,
            type: 'reference',
            category: 'value',
            nodeIndex,
            nodeId,
            suggestion: `Valid node IDs: ${Array.from(nodeIds).join(', ')}`
          });
        }
      }
    } else if (placeholder.startsWith('.vars.')) {
      // Variable reference - just check syntax (STRUCTURE)
      if (!valuesOnly) {
        const parts = placeholder.split('.');
        if (parts.length < 3) {
          errors.push({
            field: nodePrefix,
            message: `Invalid variable placeholder: "{{ ${placeholder} }}"`,
            type: 'format',
            category: 'structure',
            nodeIndex,
            nodeId,
            suggestion: 'Use {{ .vars.variableName }} syntax'
          });
        }
      }
    } else if (placeholder.startsWith('.input.')) {
      // Input reference - just check syntax (STRUCTURE)
      if (!valuesOnly) {
        const parts = placeholder.split('.');
        if (parts.length < 3) {
          errors.push({
            field: nodePrefix,
            message: `Invalid input placeholder: "{{ ${placeholder} }}"`,
            type: 'format',
            category: 'structure',
            nodeIndex,
            nodeId,
            suggestion: 'Use {{ .input.variableName }} syntax'
          });
        }
      }
    } else if (placeholder === '$guid' || placeholder === '$timestamp') {
      // Dynamic placeholders - valid (no check needed)
    } else if (placeholder.startsWith('$')) {
      // Unknown dynamic placeholder (STRUCTURE)
      if (!valuesOnly) {
        errors.push({
          field: nodePrefix,
          message: `Unknown dynamic placeholder: "{{ ${placeholder} }}"`,
          type: 'format',
          category: 'structure',
          nodeIndex,
          nodeId,
          suggestion: 'Valid dynamic placeholders: {{ $guid }}, {{ $timestamp }}'
        });
      }
    } else {
      // Unknown placeholder format (STRUCTURE)
      if (!valuesOnly) {
        errors.push({
          field: nodePrefix,
          message: `Invalid placeholder syntax: "{{ ${placeholder} }}"`,
          type: 'format',
          category: 'structure',
          nodeIndex,
          nodeId,
          suggestion: 'Valid formats: {{ .responses.nodeId.field }}, {{ .vars.name }}, {{ .input.name }}, {{ $guid }}, {{ $timestamp }}'
        });
      }
    }
  }
}

/**
 * Check if a URL is valid
 */
function isValidUrl(url) {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Format validation errors for display
 */
function formatErrors(errors) {
  if (errors.length === 0) {
    return '✓ Config validation passed';
  }

  let output = `❌ Config Validation Failed (${errors.length} error${errors.length > 1 ? 's' : ''})\n\n`;

  errors.forEach((error, index) => {
    output += `Error ${index + 1}:\n`;

    if (error.nodeId && error.nodeIndex !== undefined) {
      output += `  Node: "${error.nodeId}" (nodes[${error.nodeIndex}])\n`;
    }

    output += `  Field: ${error.field}\n`;
    output += `  Issue: ${error.message}\n`;

    if (error.suggestion) {
      output += `  Fix: ${error.suggestion}\n`;
    }

    output += '\n';
  });

  return output;
}

module.exports = {
  validateConfig,
  formatErrors
};
