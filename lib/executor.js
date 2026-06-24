/**
 * Core execution engine for FlowSphere
 * Orchestrates the entire sequence execution flow
 */

const readline = require('readline');
const open = require('open');
const { readJSONFile, colorize, formatDuration, extractValue } = require('./utils');
const { substituteWithTracking } = require('./substitution');
const { executeRequest } = require('./http-client');
const { executeCommand } = require('./command-runner');
const { validateResponse } = require('./validator');
const { evaluateConditions } = require('./conditions');
const { validateConfig, formatErrors } = require('./config-validator');

/**
 * Mask env values for logs
 */
function maskEnv(env = {}) {
  const masked = {};
  Object.keys(env).forEach((key) => {
    masked[key] = '***';
  });
  return masked;
}

/**
 * Mask substitution records that target env.* paths
 */
function maskSubstitutions(substitutions = []) {
  return substitutions.map((sub) => {
    if (sub && typeof sub.path === 'string' && sub.path.startsWith('env.')) {
      return { ...sub, value: '***' };
    }
    return sub;
  });
}

/**
 * Build user-friendly step label
 */
function describeStep(step = {}) {
  const request = step.request || {};
  const type = step.type || request.type || 'http';
  if (type === 'command') {
    const command = step.command || request.command || '';
    const args = step.args || request.args || [];
    return `cmd: ${[command, ...args].filter(Boolean).join(' ')}`.trim();
  }
  const method = step.method || request.method || '';
  const url = step.url || request.url || '';
  return `${method} ${url}`.trim();
}

/**
 * Build request log payload from request details
 */
function buildRequestLog(details = {}) {
  const type = details.type || 'http';
  if (type === 'command') {
    return {
      type: 'command',
      command: details.command,
      args: details.args || [],
      cwd: details.cwd,
      env: maskEnv(details.env || {})
    };
  }

  return {
    type: 'http',
    method: details.method,
    url: details.url,
    headers: details.headers || {},
    body: details.body || {}
  };
}

/**
 * Merge step config with defaults
 */
function mergeWithDefaults(step, defaults) {
  const merged = { ...step };
  const nodeType = step.type || 'http';

  if (nodeType === 'command') {
    if (!merged.timeout && defaults.timeout) {
      merged.timeout = defaults.timeout;
    }
    if (!merged.cwd && defaults.cwd) {
      merged.cwd = defaults.cwd;
    }
    if (defaults.env || step.env) {
      merged.env = { ...(defaults.env || {}), ...(step.env || {}) };
    }
  } else {
    // Base URL
    if (defaults.baseUrl && step.url && step.url.startsWith('/')) {
      merged.url = defaults.baseUrl + step.url;
    }

    // Timeout
    if (!merged.timeout && defaults.timeout) {
      merged.timeout = defaults.timeout;
    }

    // Headers (merge)
    if (defaults.headers) {
      merged.headers = { ...(defaults.headers || {}), ...(step.headers || {}) };
    }
  }

  // Validations (merge unless skipDefaultValidations is true)
  if (step.skipDefaultValidations === true) {
    // Skip default validations - use only step validations (or empty array)
    merged.validations = step.validations || [];
  } else {
    // Merge default validations with step validations
    if (defaults.validations || step.validations) {
      merged.validations = [
        ...(defaults.validations || []),
        ...(step.validations || [])
      ];
    }
  }

  return merged;
}

/**
 * Prompt user for input
 */
async function promptUserInput(userPrompts) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const userInput = {};

  for (const [key, prompt] of Object.entries(userPrompts)) {
    const answer = await new Promise((resolve) => {
      rl.question(`${prompt} `, resolve);
    });
    userInput[key] = answer;
  }

  rl.close();
  return userInput;
}

/**
 * Execute a single step
 * Returns both the response and the actual request details (after substitution)
 */
async function executeStep(step, context) {
  const { enableDebug, allowUnsafeCommands = false } = context;

  // Substitute variables in step configuration and track substitutions
  const { result: substitutedStep, substitutions } = substituteWithTracking(step, context);
  const type = substitutedStep.type || 'http';
  const maskedSubstitutions = maskSubstitutions(substitutions);

  if (type === 'command') {
    const { command, args = [], cwd, env = {}, timeout, statusFrom } = substitutedStep;

    if (enableDebug) {
      console.error(`DEBUG: Executing command ${command} ${(args || []).join(' ')}`.trim());
    }

    const response = await executeCommand({
      command,
      args,
      cwd,
      env,
      timeout,
      statusFrom,
      allowUnsafeCommands
    });

    return {
      response,
      requestDetails: { type: 'command', command, args, cwd, env },
      substitutions: maskedSubstitutions
    };
  }

  const { method, url, headers, body, timeout } = substitutedStep;

  if (enableDebug) {
    console.error(`DEBUG: Executing ${method} ${url}`);
    if (headers) console.error(`DEBUG: Headers: ${JSON.stringify(headers)}`);
    if (body) console.error(`DEBUG: Body: ${JSON.stringify(body)}`);
  }

  const response = await executeRequest({
    method,
    url,
    headers,
    body,
    timeout
  });

  return {
    response,
    requestDetails: { type: 'http', method, url, headers, body },
    substitutions: maskedSubstitutions
  };
}

/**
 * Main execution function
 */
async function runSequence(configPath, options = {}) {
  const { startStep = 0, enableDebug = false } = options;

  // Load config
  const config = readJSONFile(configPath);

  // Validate config before execution
  const validationResult = validateConfig(config);
  if (!validationResult.valid) {
    console.error(formatErrors(validationResult.errors));
    throw new Error('Config validation failed. Please fix the errors above and try again.');
  }

  // Load defaults
  const defaults = config.defaults || {};
  console.log(colorize('Loaded defaults from configuration', 'gray'));

  // Load global variables
  const vars = config.variables || {};
  const varCount = Object.keys(vars).length;
  if (varCount > 0) {
    console.log(colorize(`Loaded ${varCount} global variable(s) from configuration`, 'gray'));
  }

  // Get nodes
  const nodes = config.nodes || [];
  console.log(colorize(`\nStarting HTTP sequence with ${nodes.length} nodes...\n`, 'cyan'));

  // Execution state
  const responses = [];
  const executionLog = [];
  let stepsExecuted = 0;
  let stepsSkipped = 0;
  let userInput = {}; // Persistent across all steps

  // Execute each node
  for (let i = 0; i < nodes.length; i++) {
    const stepNum = i + 1;
    let node = nodes[i];

    // Merge with defaults
    node = mergeWithDefaults(node, defaults);

    const { id, name, userPrompts, conditions, validations, launchBrowser } = node;
    const label = describeStep(node);
    const nodeType = node.type || 'http';

    // Skip steps before startStep
    if (i < startStep) {
      const skipReason = `--start-step: execution begins at step ${startStep + 1}`;
      console.log(`${label} ${colorize('⊘ SKIPPED', 'yellow')} (${skipReason})`);

      // Store empty response to maintain indexing
      responses.push({ id, status: 0, body: {} });

      // Log skipped step
      executionLog.push({
        step: stepNum,
        id,
        name,
        type: nodeType,
        label,
        status: 'skipped',
        skip_reason: skipReason
      });

      stepsSkipped++;
      continue;
    }

    // Prompt for user input if needed (before evaluating conditions)
    if (userPrompts && Object.keys(userPrompts).length > 0) {
      const displayName = name ? `"${name}"` : label;
      console.log(colorize(`\n${displayName} requires user input:`, 'cyan'));
      const newInput = await promptUserInput(userPrompts);
      // Merge new input with existing input (later keys override earlier ones)
      userInput = { ...userInput, ...newInput };
    }

    // Evaluate conditions (after collecting input)
    const context = { vars, responses, input: userInput, enableDebug, allowUnsafeCommands: config.allowUnsafeCommands || false };

    const { shouldExecute, skipReason } = evaluateConditions(conditions, context);

    if (!shouldExecute) {
      console.log(`${label} ${colorize('⊘ SKIPPED', 'blue')} (${skipReason})`);

      // Store empty response to maintain indexing
      responses.push({ id, status: 0, body: {} });

      // Log skipped step
      executionLog.push({
        step: stepNum,
        id,
        name,
        type: nodeType,
        label,
        status: 'skipped',
        skip_reason: skipReason
      });

      stepsSkipped++;
      continue;
    }

    // Execute step
    let requestDetails = null; // Initialize outside try block for error handling
    let substitutions = []; // Track substitutions for logging
    try {
      const startTime = Date.now();
      const result = await executeStep(node, context);
      const { response } = result;
      requestDetails = result.requestDetails;
      substitutions = result.substitutions || [];
      const endTime = Date.now();
      const duration = (endTime - startTime) / 1000;

      // Validate response and get validation results
      let validationResults;
      try {
        validationResults = validateResponse(response, validations, enableDebug);
      } catch (validationError) {
        // Extract validation results from error (includes failed validations)
        validationResults = validationError.validationResults || [];

        // Print validation info before failing
        if (validationResults.length > 0) {
          for (const validation of validationResults) {
            const icon = validation.passed ? '✓' : '✗';
            const iconColor = validation.passed ? 'green' : 'red';

            if (validation.type === 'httpStatusCode') {
              const label = validation.passed ? 'Validated' : 'Failed';
              const suffix = validation.passed ? '' : ` (expected ${validation.expected})`;
              console.log(colorize(`  ${icon} ${label} status = `, iconColor) + colorize(validation.actual + suffix, 'yellow'));
            } else if (validation.type === 'jsonpath') {
              const displayValue = typeof validation.value === 'object'
                ? JSON.stringify(validation.value)
                : validation.value;
              const label = validation.passed ? 'Extracted' : 'Failed';
              console.log(colorize(`  ${icon} ${label} ${validation.path} = `, iconColor) + colorize(displayValue, 'yellow'));
            }
          }
        }

        // Re-throw the validation error
        throw validationError;
      }

      // Store response for future reference
      responses.push({
        id,
        status: response.status,
        body: response.body
      });

      // Print success
      const statusText = `${response.status} ${response.statusText}`;
      const executedLabel = describeStep(requestDetails);
      console.log(
        `${executedLabel} ${colorize('✅', 'green')} Status ${statusText} (${formatDuration(duration)})`
      );

      // Print validation info (like legacy CLI)
      if (validationResults && validationResults.length > 0) {
        for (const validation of validationResults) {
          const icon = validation.passed ? '✓' : '✗';
          const iconColor = validation.passed ? 'green' : 'red';

          if (validation.type === 'httpStatusCode') {
            const label = validation.passed ? 'Validated' : 'Failed';
            const suffix = validation.passed ? '' : ` (expected ${validation.expected})`;
            console.log(colorize(`  ${icon} ${label} status = `, iconColor) + colorize(validation.actual + suffix, 'yellow'));
          } else if (validation.type === 'jsonpath') {
            const displayValue = typeof validation.value === 'object'
              ? JSON.stringify(validation.value)
              : validation.value;
            const label = validation.passed ? 'Extracted' : 'Failed';
            console.log(colorize(`  ${icon} ${label} ${validation.path} = `, iconColor) + colorize(displayValue, 'yellow'));
          }
        }
      }

      // Log execution (use substituted values from requestDetails)
      executionLog.push({
        step: stepNum,
        id,
        name,
        type: requestDetails.type || nodeType,
        label: executedLabel,
        command: requestDetails.command,
        method: requestDetails.method,
        url: requestDetails.url,
        request: buildRequestLog(requestDetails),
        response: {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
          body: response.body
        },
        substitutions: substitutions,
        duration,
        status: 'completed'
      });

      stepsExecuted++;

      // Launch browser if configured
      if (launchBrowser) {
        const browserUrl = extractValue(response.body, launchBrowser);
        if (browserUrl) {
          console.log(colorize(`  ↗ Opening browser: ${browserUrl}`, 'gray'));
          await open(browserUrl);
        }
      }

    } catch (error) {
      // Execution or validation failed
      const failedLabel = requestDetails ? describeStep(requestDetails) : label;
      const fallbackRequest = requestDetails || node;

      console.log(
        `${failedLabel} ${colorize('❌ FAILED', 'red')}`
      );
      console.log(colorize(`Error: ${error.message}`, 'red'));

      // Log failure
      executionLog.push({
        step: stepNum,
        id,
        name,
        type: requestDetails ? (requestDetails.type || nodeType) : nodeType,
        label: failedLabel,
        command: requestDetails ? requestDetails.command : node.command,
        method: requestDetails ? requestDetails.method : node.method,
        url: requestDetails ? requestDetails.url : node.url,
        request: buildRequestLog(fallbackRequest),
        substitutions: substitutions,
        error: error.message,
        status: 'failed'
      });

      // Stop execution on error
      console.log(colorize(`\nExecution stopped due to error in step ${stepNum}`, 'red'));
      console.log(colorize(`\nSummary: ${stepsExecuted} executed, ${stepsSkipped} skipped, 1 failed`, 'red'));

      return {
        success: false,
        stepsExecuted,
        stepsSkipped,
        stepsFailed: 1,
        executionLog
      };
    }
  }

  // All steps completed successfully
  console.log(colorize(`\n✅ Sequence completed successfully!`, 'green'));
  console.log(colorize(`Summary: ${stepsExecuted} executed, ${stepsSkipped} skipped\n`, 'green'));

  return {
    success: true,
    stepsExecuted,
    stepsSkipped,
    stepsFailed: 0,
    executionLog
  };
}

module.exports = {
  runSequence,
  readJSONFile,
  mergeWithDefaults,
  promptUserInput,
  executeStep,
  describeStep,
  buildRequestLog,
  maskSubstitutions
};
