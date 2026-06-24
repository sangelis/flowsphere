#!/usr/bin/env node

/**
 * FlowSphere CLI
 * Command-line interface for HTTP sequence runner
 */

const path = require('path');
const fs = require('fs');
const { runSequence } = require('../lib/executor');
const { promptSaveLog } = require('../lib/logger');
const { validateConfig, formatErrors } = require('../lib/config-validator');

// Parse command-line arguments
const args = process.argv.slice(2);

// Show help
function showHelp() {
  console.log(`
FlowSphere - HTTP Sequence Runner

USAGE:
  flowsphere <config-file> [options]
  flowsphere studio [options]
  flowsphere --version
  flowsphere --help

COMMANDS:
  <config-file>        Path to JSON config file to execute
  studio               Launch visual config editor in browser

OPTIONS:
  --start-step <n>     Start execution from step n (1-indexed)
  --validate           Validate config file without executing
  --port <n>           Port for Studio server (default: 3737)
  --version            Show version number
  --help               Show this help message

EXAMPLES:
  flowsphere config.json
  flowsphere examples/config-simple.json
  flowsphere config.json --start-step 5
  flowsphere config.json --validate
  flowsphere studio
  flowsphere studio --port 8080

For more information, visit: https://github.com/yourusername/flowsphere
`);
}

// Show version
function showVersion() {
  const packageJson = require('../package.json');
  console.log(`FlowSphere v${packageJson.version}`);
}

// Launch studio
async function launchStudio(port = 3737) {
  console.log('Launching FlowSphere Studio...\n');

  const express = require('express');
  const { spawn } = require('child_process');
  const os = require('os');

  const app = express();
  const studioPath = path.join(__dirname, '../studio');

  // Check if studio folder exists
  if (!fs.existsSync(studioPath)) {
    console.error('Error: Studio folder not found.');
    console.error('The config editor should be in: ' + studioPath);
    process.exit(1);
  }

  // Parse JSON request bodies
  app.use(express.json({ limit: '10mb' }));

  // Serve static files
  app.use(express.static(studioPath));

  // API endpoint to execute sequences (bypasses CORS)
  app.post('/api/execute', async (req, res) => {
    try {
      const { config, options = {} } = req.body;

      if (!config) {
        return res.status(400).json({
          success: false,
          error: 'Missing config in request body'
        });
      }

      // Create temp file for config
      const tempConfigPath = path.join(os.tmpdir(), `flowsphere-${Date.now()}.json`);
      fs.writeFileSync(tempConfigPath, JSON.stringify(config, null, 2));

      try {
        // Use the same executor as CLI
        const result = await runSequence(tempConfigPath, {
          startStep: options.startStep || 0,
          enableDebug: options.enableDebug || false
        });

        // Clean up temp file
        fs.unlinkSync(tempConfigPath);

        // Return execution result
        res.json({
          success: result.success,
          stepsExecuted: result.stepsExecuted,
          stepsSkipped: result.stepsSkipped,
          stepsFailed: result.stepsFailed || 0,
          executionLog: result.executionLog
        });

      } catch (executionError) {
        // Clean up temp file on error
        try {
          fs.unlinkSync(tempConfigPath);
        } catch (cleanupError) {
          // Ignore cleanup errors
        }
        throw executionError;
      }

    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  });

  // Store for pending user input requests
  const pendingInputRequests = new Map();

  // Endpoint to provide user input during execution
  app.post('/api/provide-input', (req, res) => {
    const { executionId, stepIndex, userInput } = req.body;

    if (!executionId || stepIndex === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Missing executionId or stepIndex'
      });
    }

    const key = `${executionId}-${stepIndex}`;
    const resolver = pendingInputRequests.get(key);

    if (resolver) {
      resolver(userInput || {});
      pendingInputRequests.delete(key);
      res.json({ success: true });
    } else {
      res.status(404).json({
        success: false,
        error: 'No pending input request found'
      });
    }
  });

  // Endpoint to save execution log
  app.post('/api/save-log', (req, res) => {
    try {
      const { executionLog, executionResult = {} } = req.body;

      if (!executionLog || !Array.isArray(executionLog)) {
        return res.status(400).json({
          success: false,
          error: 'Missing or invalid executionLog in request body'
        });
      }

      // Use the logger module to save the log with metadata
      const { saveLog } = require('../lib/logger');
      const logPath = saveLog(executionLog, 'studio-execution', null, executionResult);

      // Read the saved log file to return its content for download
      const logContent = fs.readFileSync(logPath, 'utf8');

      res.json({
        success: true,
        path: logPath,
        filename: path.basename(logPath),
        logContent: logContent
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  // Execute single node endpoint for "Try it Out" feature
  app.post('/api/execute-node', async (req, res) => {
    try {
      const { node, config, mockResponses = {} } = req.body;

      if (!node) {
        return res.status(400).json({
          success: false,
          error: 'Missing node in request body'
        });
      }

      if (!config) {
        return res.status(400).json({
          success: false,
          error: 'Missing config in request body'
        });
      }

      // Import required executor modules
      const { mergeWithDefaults, executeStep, buildRequestLog, maskSubstitutions } = require('../lib/executor');
      const { validateResponse } = require('../lib/validator');

      // Merge node with defaults from config
      const defaults = config.defaults || {};
      const mergedNode = mergeWithDefaults(node, defaults);

      // Build mock responses array by node ID
      const responses = [];
      for (const nodeId in mockResponses) {
        responses.push({
          id: nodeId,
          status: 200,
          body: mockResponses[nodeId]
        });
      }

      // Debug logging
      console.log('[TryItOut API] mockResponses:', JSON.stringify(mockResponses, null, 2));
      console.log('[TryItOut API] Built responses array:', JSON.stringify(responses, null, 2));

      // Build execution context
      const context = {
        vars: config.variables || {},
        responses: responses,
        input: {}, // No user input for try it out (yet)
        enableDebug: config.enableDebug || false
      };

      const startTime = Date.now();
      let response = null;
      let requestDetails = null;
      let validationResults = null;
      let substitutions = [];

      try {
        // Execute the node
        const result = await executeStep(mergedNode, context);
        response = result.response;
        requestDetails = result.requestDetails;
        substitutions = result.substitutions || [];

        const endTime = Date.now();
        const duration = (endTime - startTime) / 1000;

        // Validate response
        const validations = mergedNode.validations || [];
        try {
          validationResults = validateResponse(response, validations, context.enableDebug);
        } catch (validationError) {
          // Validation failed - extract results from error
          validationResults = validationError.validationResults || null;

          // Return validation failure response
          return res.json({
            success: false,
            response: {
              status: response.status,
              statusText: response.statusText,
              headers: response.headers,
              body: response.body
            },
            type: requestDetails ? requestDetails.type : (mergedNode.type || 'http'),
            request: buildRequestLog(requestDetails),
            substitutions: maskSubstitutions(substitutions),
            validations: validationResults,
            duration: parseFloat(duration.toFixed(3)),
            error: validationError.message
          });
        }

        // Success - return complete result
        res.json({
          success: true,
          response: {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
            body: response.body
          },
          type: requestDetails ? requestDetails.type : (mergedNode.type || 'http'),
          request: buildRequestLog(requestDetails),
          substitutions: maskSubstitutions(substitutions),
          validations: validationResults,
          duration: parseFloat(duration.toFixed(3))
        });

      } catch (error) {
        // Execution error (network, timeout, etc.)
        const endTime = Date.now();
        const duration = (endTime - startTime) / 1000;

        res.json({
          success: false,
          type: requestDetails ? requestDetails.type : (mergedNode.type || 'http'),
          request: requestDetails
            ? buildRequestLog(requestDetails)
            : buildRequestLog({ type: mergedNode.type || 'http', ...mergedNode }),
          substitutions: maskSubstitutions(substitutions),
          duration: parseFloat(duration.toFixed(3)),
          error: error.message
        });
      }

    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  });

  // Single-step execution endpoint (Phase 2: Step-by-Step mode)
  app.post('/api/execute-step', async (req, res) => {
    try {
      const { config, stepIndex, responses = [], userInput = {} } = req.body;

      if (!config) {
        return res.status(400).json({
          success: false,
          error: 'Missing config in request body'
        });
      }

      if (stepIndex === undefined || stepIndex === null) {
        return res.status(400).json({
          success: false,
          error: 'Missing stepIndex in request body'
        });
      }

      console.log(`[Server] Executing single step ${stepIndex + 1}`);

      // Import required executor modules
      const { readJSONFile, mergeWithDefaults, promptUserInput, executeStep, describeStep, buildRequestLog, maskSubstitutions } = require('../lib/executor');
      const { validateResponse } = require('../lib/validator');
      const { evaluateConditions } = require('../lib/conditions');

      // Create temp file for config
      const tempConfigPath = path.join(os.tmpdir(), `flowsphere-step-${Date.now()}.json`);
      fs.writeFileSync(tempConfigPath, JSON.stringify(config, null, 2));

      try {
        // Load config
        const loadedConfig = readJSONFile(tempConfigPath);
        const defaults = loadedConfig.defaults || {};
        const vars = loadedConfig.variables || {};
        const nodes = loadedConfig.nodes || [];

        if (stepIndex >= nodes.length) {
          throw new Error(`Step index ${stepIndex} out of range (0-${nodes.length - 1})`);
        }

        const stepNum = stepIndex + 1;
        let node = nodes[stepIndex];
        node = mergeWithDefaults(node, defaults);

        const { id, name, method, url, conditions, validations } = node;

        // Check if step requires user input
        if (node.userPrompts && Object.keys(node.userPrompts).length > 0) {
          // Check if userInput was provided
          const promptKeys = Object.keys(node.userPrompts);
          const hasAllInputs = promptKeys.every(key => userInput.hasOwnProperty(key));

          if (!hasAllInputs) {
            // Return inputRequired response
            return res.json({
              success: true,
              inputRequired: true,
              stepIndex: stepIndex,
              step: stepNum,
              id: id,
              name: name || describeStep(node),
              prompts: node.userPrompts
            });
          }
        }

        // Evaluate conditions
        const context = { vars, responses, input: userInput, enableDebug: false };
        const { shouldExecute, skipReason } = evaluateConditions(conditions, context);

        if (!shouldExecute) {
          // Step is skipped
          const stepLog = {
            step: stepNum,
            id,
            name,
            type: node.type || 'http',
            method,
            url,
            request: buildRequestLog({ ...node, type: node.type || 'http' }),
            status: 'skipped',
            skipReason
          };

          // Clean up temp file
          fs.unlinkSync(tempConfigPath);

          return res.json({
            success: true,
            inputRequired: false,
            ...stepLog
          });
        }

        // Execute step
        let response = null;
        let validationResults = null;
        let substitutions = [];
        let requestDetails = null;
        let startTime = Date.now();

        console.log(`[Server] Executing step ${stepNum}: ${describeStep(node)}`);

        try {
          const result = await executeStep(node, context);
          response = result.response;
          requestDetails = result.requestDetails;
          substitutions = result.substitutions || [];
          const endTime = Date.now();
          const duration = (endTime - startTime) / 1000;

          console.log(`[Server] Step ${stepNum} completed: Status ${response.status} (${duration.toFixed(3)}s)`);

          // Validate response and get validation results
          try {
            validationResults = validateResponse(response, validations, false);
          } catch (validationError) {
            // Validation failed, but extract results from error
            validationResults = validationError.validationResults || null;
            // Re-throw to be caught by outer catch
            throw validationError;
          }

          // Create step log (use substituted values from requestDetails)
          const stepLog = {
            step: stepNum,
            id,
            name,
            type: requestDetails ? requestDetails.type : (node.type || 'http'),
            method: requestDetails.method,
            url: requestDetails.url,
            request: buildRequestLog(requestDetails),
            response: {
              status: response.status,
              statusText: response.statusText,
              headers: response.headers,
              body: response.body
            },
            substitutions: maskSubstitutions(result.substitutions || []),
            validations: validationResults,
            duration: parseFloat(duration.toFixed(3)),
            status: 'completed'
          };

          // Include launchBrowser config if present (for frontend to handle)
          if (node.launchBrowser) {
            stepLog.launchBrowser = node.launchBrowser;
          }

          // Clean up temp file
          fs.unlinkSync(tempConfigPath);

          return res.json({
            success: true,
            inputRequired: false,
            ...stepLog
          });

        } catch (error) {
          // Error handling - include whatever data we have
          const endTime = Date.now();
          const duration = (endTime - startTime) / 1000;

          const stepLog = {
            step: stepNum,
            id,
            name,
            // Use substituted values if available, otherwise use originals
            type: requestDetails ? requestDetails.type : (node.type || 'http'),
            method: requestDetails ? requestDetails.method : method,
            url: requestDetails ? requestDetails.url : url,
            request: requestDetails
              ? buildRequestLog(requestDetails)
              : buildRequestLog({ type: node.type || 'http', ...node }),
            substitutions: maskSubstitutions(substitutions),
            status: 'failed',
            error: error.message,
            duration: parseFloat(duration.toFixed(3))
          };

          // If we have a response (validation failure), include it
          if (response) {
            stepLog.response = {
              status: response.status,
              statusText: response.statusText,
              headers: response.headers,
              body: response.body
            };
          }

          // If we have validation results (partial validations before failure), include them
          if (validationResults) {
            stepLog.validations = validationResults;
          }

          // Clean up temp file
          fs.unlinkSync(tempConfigPath);

          return res.json({
            success: true,  // Request succeeded, but step failed
            inputRequired: false,
            ...stepLog
          });
        }

      } catch (error) {
        // Clean up temp file
        try {
          fs.unlinkSync(tempConfigPath);
        } catch (cleanupError) {
          // Ignore cleanup errors
        }

        throw error; // Will be caught by outer catch
      }

    } catch (error) {
      console.error('[Server] Execute-step error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  });

  // Streaming execution endpoint using Server-Sent Events (SSE)
  app.post('/api/execute-stream', async (req, res) => {
    try {
      const { config, options = {} } = req.body;

      if (!config) {
        return res.status(400).json({
          success: false,
          error: 'Missing config in request body'
        });
      }

      // Generate unique execution ID
      const executionId = `exec-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      console.log(`[Server] Starting execution ${executionId}`);

      // Set up SSE headers
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      });

      console.log(`[Server] SSE connection opened for ${executionId}`);

      // Flag to track if execution should be cancelled
      let executionCancelled = false;

      // Helper to send SSE events
      const sendEvent = (eventType, data) => {
        if (executionCancelled) return; // Don't send if cancelled
        try {
          res.write(`event: ${eventType}\n`);
          res.write(`data: ${JSON.stringify(data)}\n\n`);
        } catch (error) {
          console.log(`[Server] Failed to send event (connection likely closed): ${error.message}`);
          executionCancelled = true;
        }
      };

      // Clean up pending input requests when connection closes
      res.on('close', () => {
        console.log(`[Server] Response stream closed, stopping execution ${executionId}`);
        executionCancelled = true;

        // Resolve pending input requests with empty object to unblock the loop
        for (const [key, resolve] of pendingInputRequests.entries()) {
          if (key.startsWith(executionId)) {
            resolve({});  // Resolve with empty input to unblock
            pendingInputRequests.delete(key);
            console.log(`[Server] Resolved and cleaned up pending input request: ${key}`);
          }
        }
      });

      // Create temp file for config
      const tempConfigPath = path.join(os.tmpdir(), `flowsphere-${Date.now()}.json`);
      fs.writeFileSync(tempConfigPath, JSON.stringify(config, null, 2));

      // Send start event
      sendEvent('start', {
        totalSteps: config.nodes ? config.nodes.length : 0
      });

      try {
        // Import required executor modules
        const { readJSONFile, mergeWithDefaults, promptUserInput, executeStep, describeStep, buildRequestLog, maskSubstitutions } = require('../lib/executor');
        const { validateResponse } = require('../lib/validator');
        const { evaluateConditions } = require('../lib/conditions');

        // Load config
        const loadedConfig = readJSONFile(tempConfigPath);
        const defaults = loadedConfig.defaults || {};
        const vars = loadedConfig.variables || {};
        const nodes = loadedConfig.nodes || [];
        const startStep = options.startStep || 0;
        const enableDebug = options.enableDebug || false;

        const responses = [];
        const executionLog = [];
        let stepsExecuted = 0;
        let stepsSkipped = 0;
        let userInput = {}; // Persistent across all steps

        // Execute each node and stream results
        for (let i = 0; i < nodes.length; i++) {
          // Check if execution was cancelled (client disconnected)
          if (executionCancelled) {
            console.log(`[Server] Execution cancelled at step ${i + 1}, stopping loop`);
            break;
          }

          const stepNum = i + 1;
          let node = nodes[i];
          node = mergeWithDefaults(node, defaults);

          const { id, name, method, url, conditions, validations } = node;

          // Skip steps before startStep
          if (i < startStep) {
            const skipReason = `--start-step: execution begins at step ${startStep + 1}`;
            responses.push({ id, status: 0, body: {} });
            const stepLog = {
              step: stepNum,
              id,
              name,
              type: node.type || 'http',
              method,
              url,
              request: buildRequestLog({ ...node, type: node.type || 'http' }),
              status: 'skipped',
              skipReason
            };
            executionLog.push(stepLog);
            stepsSkipped++;

            // Send step event
            sendEvent('step', stepLog);
            continue;
          }

          // Check if step requires user input
          if (node.userPrompts && Object.keys(node.userPrompts).length > 0) {
            // Send input_required event
            sendEvent('input_required', {
              executionId,
              stepIndex: i,
              step: stepNum,
              name: node.name || describeStep(node),
              prompts: node.userPrompts
            });

            // Wait for user input
            const newInput = await new Promise((resolve) => {
              const key = `${executionId}-${i}`;
              pendingInputRequests.set(key, resolve);
            });

            // Check if execution was cancelled during user input
            if (executionCancelled) {
              console.log(`[Server] Execution cancelled during user input at step ${stepNum}, stopping`);
              break;
            }

            // Merge new input with existing input (later keys override earlier ones)
            userInput = { ...userInput, ...newInput };
          }

          // Evaluate conditions
          const context = { vars, responses, input: userInput, enableDebug };
          const { shouldExecute, skipReason } = evaluateConditions(conditions, context);

          if (!shouldExecute) {
            responses.push({ id, status: 0, body: {} });
            const stepLog = {
              step: stepNum,
              id,
              name,
              type: node.type || 'http',
              method,
              url,
              request: buildRequestLog({ ...node, type: node.type || 'http' }),
              status: 'skipped',
              skipReason
            };
            executionLog.push(stepLog);
            stepsSkipped++;

            // Send step event
            sendEvent('step', stepLog);
            continue;
          }

          // Execute step
          let response = null;
          let validationResults = null;
          let substitutions = [];
          let requestDetails = null;
          let startTime = Date.now();

          // Send step_start event so frontend can show placeholder if needed
          sendEvent('step_start', {
            step: stepNum,
            id,
            name,
            type: node.type || 'http',
            method,
            url,
            ...(node.type === 'command' ? { command: node.command, args: node.args } : {})
          });

          console.log(`[Server] Executing step ${stepNum}: ${describeStep(node)}`);

          try {
            const result = await executeStep(node, context);
            response = result.response;
            requestDetails = result.requestDetails;
            substitutions = result.substitutions || [];
            const endTime = Date.now();
            const duration = (endTime - startTime) / 1000;

            console.log(`[Server] Step ${stepNum} completed: Status ${response.status} (${duration.toFixed(3)}s)`);

            // Validate response and get validation results
            try {
              validationResults = validateResponse(response, validations, enableDebug);
            } catch (validationError) {
              // Validation failed, but extract results from error
              validationResults = validationError.validationResults || null;
              // Re-throw to be caught by outer catch
              throw validationError;
            }

            // Store response
            responses.push({
              id,
              status: response.status,
              body: response.body
            });

            // Create step log (use substituted values from requestDetails)
            const stepLog = {
              step: stepNum,
              id,
              name,
              type: requestDetails ? requestDetails.type : (node.type || 'http'),
              method: requestDetails.method,
              url: requestDetails.url,
              request: buildRequestLog(requestDetails),
              response: {
                status: response.status,
                statusText: response.statusText,
                headers: response.headers,
                body: response.body
              },
              substitutions: maskSubstitutions(result.substitutions || []),
              validations: validationResults,
              duration: parseFloat(duration.toFixed(3)),
              status: 'completed'
            };

            // Include launchBrowser config if present (for frontend to handle)
            if (node.launchBrowser) {
              stepLog.launchBrowser = node.launchBrowser;
            }

            executionLog.push(stepLog);
            stepsExecuted++;

            // Check if cancelled during execution before sending result
            if (executionCancelled) {
              console.log(`[Server] Execution cancelled after step ${stepNum} completed, stopping`);
              break;
            }

            // Send step event
            sendEvent('step', stepLog);

          } catch (error) {
            // Error handling - include whatever data we have
            const endTime = Date.now();
            const duration = (endTime - startTime) / 1000;

            const stepLog = {
              step: stepNum,
              id,
              name,
              // Use substituted values if available, otherwise use originals
              type: requestDetails ? requestDetails.type : (node.type || 'http'),
              method: requestDetails ? requestDetails.method : method,
              url: requestDetails ? requestDetails.url : url,
              request: requestDetails
                ? buildRequestLog(requestDetails)
                : buildRequestLog({ type: node.type || 'http', ...node }),
              substitutions: maskSubstitutions(substitutions),
              status: 'failed',
              error: error.message,
              duration: parseFloat(duration.toFixed(3))
            };

            // If we have a response (validation failure), include it
            if (response) {
              stepLog.response = {
                status: response.status,
                statusText: response.statusText,
                headers: response.headers,
                body: response.body
              };
            }

            // If we have validation results (partial validations before failure), include them
            if (validationResults) {
              stepLog.validations = validationResults;
            }

            executionLog.push(stepLog);

            // Check if execution was cancelled (don't send error for user-initiated stop)
            if (executionCancelled) {
              console.log(`[Server] Execution cancelled during error handling, stopping without sending error event`);
              break;
            }

            // Send step event
            sendEvent('step', stepLog);

            // Send error and end
            sendEvent('error', {
              message: error.message,
              step: stepNum
            });

            sendEvent('end', {
              success: false,
              stepsExecuted,
              stepsSkipped,
              stepsFailed: 1,
              executionLog
            });

            // Clean up and close
            try {
              fs.unlinkSync(tempConfigPath);
            } catch (cleanupError) {
              console.log(`[Server] Failed to cleanup temp file: ${cleanupError.message}`);
            }
            res.end();
            return;
          }
        }

        // Clean up temp file
        try {
          fs.unlinkSync(tempConfigPath);
        } catch (cleanupError) {
          console.log(`[Server] Failed to cleanup temp file: ${cleanupError.message}`);
        }

        // Send appropriate end event
        if (!executionCancelled) {
          // All steps completed successfully
          sendEvent('end', {
            success: true,
            stepsExecuted,
            stepsSkipped,
            stepsFailed: 0,
            executionLog
          });
          res.end();
        } else {
          // Execution was interrupted by user (connection already closed)
          console.log(`[Server] Execution was interrupted, connection already closed by client`);
          // Don't send event or call res.end() - connection is already closed
        }

      } catch (error) {
        // Clean up temp file
        try {
          fs.unlinkSync(tempConfigPath);
        } catch (cleanupError) {
          // Ignore cleanup errors
        }

        // Only send error event if execution wasn't cancelled
        if (!executionCancelled) {
          sendEvent('error', {
            message: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
          });
          sendEvent('end', {
            success: false,
            error: error.message
          });
          res.end();
        } else {
          console.log(`[Server] Execution was cancelled during error, not sending error event`);
          // Connection already closed by client
        }
      }

    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  // POST /api/validate - Validate config without executing
  app.post('/api/validate', (req, res) => {
    try {
      const { config } = req.body;

      if (!config) {
        return res.status(400).json({
          success: false,
          error: 'Missing config in request body'
        });
      }

      const { validateConfig } = require('../lib/config-validator');
      const result = validateConfig(config);

      res.json({
        valid: result.valid,
        errors: result.errors
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  // Template cache for performance
  let templateCache = null;

  // GET /api/templates/nodes - List all node templates
  app.get('/api/templates/nodes', (req, res) => {
    try {
      // Return cached templates if available
      if (templateCache) {
        return res.json(templateCache);
      }

      const templatesDir = path.join(__dirname, '../studio/templates/nodes');

      // Check if templates directory exists
      if (!fs.existsSync(templatesDir)) {
        return res.json({});
      }

      const categories = fs.readdirSync(templatesDir).filter(item => {
        const itemPath = path.join(templatesDir, item);
        return fs.statSync(itemPath).isDirectory();
      });

      const templates = {};
      categories.forEach(category => {
        const categoryPath = path.join(templatesDir, category);
        const files = fs.readdirSync(categoryPath).filter(f => f.endsWith('.json'));

        templates[category] = files.map(file => {
          const content = JSON.parse(fs.readFileSync(path.join(categoryPath, file), 'utf8'));
          return {
            id: file.replace('.json', ''),
            ...content
          };
        });
      });

      // Cache the templates
      templateCache = templates;

      res.json(templates);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  // GET /api/templates/nodes/:category/:id - Get specific template
  app.get('/api/templates/nodes/:category/:id', (req, res) => {
    try {
      const { category, id } = req.params;
      const templatePath = path.join(__dirname, `../studio/templates/nodes/${category}/${id}.json`);

      if (!fs.existsSync(templatePath)) {
        return res.status(404).json({
          success: false,
          error: 'Template not found'
        });
      }

      const template = JSON.parse(fs.readFileSync(templatePath, 'utf8'));
      res.json(template);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  // Start server on specified port
  const server = app.listen(port, () => {
    const actualPort = server.address().port;
    const url = `http://localhost:${actualPort}`;

    console.log(`🎨 FlowSphere Studio running at: ${url}`);
    console.log(`   Port: ${actualPort} (localStorage will persist across restarts)`);
    console.log('Press Ctrl+C to stop\n');

    // Open browser using platform-specific command
    const platform = process.platform;
    let command, args;

    if (platform === 'win32') {
      // Windows
      command = 'cmd';
      args = ['/c', 'start', url];
    } else if (platform === 'darwin') {
      // macOS
      command = 'open';
      args = [url];
    } else {
      // Linux and others
      command = 'xdg-open';
      args = [url];
    }

    try {
      const child = spawn(command, args, {
        detached: true,
        stdio: 'ignore'
      });
      child.unref();
    } catch (error) {
      console.error('Could not open browser automatically. Please open the URL manually.');
    }
  });

  // Handle port already in use error
  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`\n❌ Error: Port ${port} is already in use.`);
      console.error(`\nTry one of these options:`);
      console.error(`  1. Stop the process using port ${port}`);
      console.error(`  2. Use a different port: flowsphere studio --port <port-number>`);
      console.error(`  3. Default port is 3737\n`);
      process.exit(1);
    } else {
      console.error(`Server error: ${error.message}`);
      process.exit(1);
    }
  });

  // Handle Ctrl+C gracefully
  process.on('SIGINT', () => {
    console.log('\n\nStopping FlowSphere Studio...');
    server.close(() => {
      console.log('Goodbye!');
      process.exit(0);
    });
  });
}

// Main CLI logic
async function main() {
  // No arguments - show help
  if (args.length === 0) {
    showHelp();
    process.exit(0);
  }

  const command = args[0];

  // Handle special commands
  if (command === '--help' || command === '-h') {
    showHelp();
    process.exit(0);
  }

  if (command === '--version' || command === '-v') {
    showVersion();
    process.exit(0);
  }

  if (command === 'studio') {
    // Parse port option
    let port = 3737; // Default port
    for (let i = 1; i < args.length; i++) {
      if (args[i] === '--port' && args[i + 1]) {
        port = parseInt(args[i + 1]);
        if (isNaN(port) || port < 1 || port > 65535) {
          console.error('Error: Port must be a number between 1 and 65535');
          process.exit(1);
        }
        break;
      }
    }
    await launchStudio(port);
    return;
  }

  // Otherwise, treat first argument as config file path
  const configPath = path.resolve(command);

  // Check if config file exists
  if (!fs.existsSync(configPath)) {
    console.error(`Error: Config file not found: ${configPath}`);
    process.exit(1);
  }

  // Parse options
  let startStep = 0;
  let validateOnly = false;

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--start-step' && args[i + 1]) {
      startStep = parseInt(args[i + 1]) - 1; // Convert to 0-indexed
      i++; // Skip next argument
    } else if (args[i] === '--validate') {
      validateOnly = true;
    }
  }

  // If --validate flag is present, validate and exit
  if (validateOnly) {
    try {
      const configContent = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      const result = validateConfig(configContent);

      if (result.valid) {
        console.log('✓ Config validation passed');
        console.log(`  ${configContent.nodes.length} node(s) validated successfully`);
        process.exit(0);
      } else {
        console.error(formatErrors(result.errors));
        process.exit(1);
      }
    } catch (error) {
      console.error(`❌ Failed to validate config: ${error.message}`);
      process.exit(1);
    }
  }

  // Run the sequence
  try {
    const result = await runSequence(configPath, {
      startStep,
      enableDebug: false
    });

    // Add startStep to result for logging
    result.startStep = startStep;

    // Prompt to save log with execution metadata
    if (result.success) {
      await promptSaveLog(result.executionLog, configPath, result);
      process.exit(0);
    } else {
      await promptSaveLog(result.executionLog, configPath, result);
      process.exit(1);
    }

  } catch (error) {
    console.error(`\nFatal error: ${error.message}`);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Run CLI
main().catch((error) => {
  console.error('Unexpected error:', error);
  process.exit(1);
});
