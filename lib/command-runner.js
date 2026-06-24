/**
 * Command runner for FlowSphere.
 * Executes a local process as a sequence step and maps the result onto the
 * same response shape produced by http-client.js, so the validator, conditions,
 * response-chaining, and logging all work unchanged.
 */

const { spawn } = require('child_process');
const { StringDecoder } = require('string_decoder');
const path = require('path');
const { extractValue } = require('./utils');

// Maximum combined stdout+stderr bytes before the process is killed.
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024; // 10 MB
// Grace period between SIGTERM and SIGKILL when killing a process.
const KILL_GRACE_MS = 2000;

// Characters that have special meaning in shells. Reject them in command names
// even though shell: false is used, to prevent inadvertent injection if the
// spawning path ever changes and to satisfy static analysis.
const SHELL_METACHAR_RE = /[;&|><`$\\()\[\]{}\n\r'"]/;

/**
 * Trust-boundary security check for command nodes.
 *
 * FlowSphere treats its config file as privileged input — the person who runs
 * the tool controls the config, so command nodes are intentionally designed to
 * execute user-configured local executables. This function enforces the
 * narrowest safe defaults so that the feature cannot be accidentally misused:
 *
 *   Safe mode (default, allowUnsafeCommands omitted or false):
 *     - `command` must be an absolute path. This prevents PATH-based hijacking
 *       and makes the intended executable unambiguous.
 *
 *   Unsafe mode (allowUnsafeCommands: true in config):
 *     - Bare command names are permitted. Use only when the execution
 *       environment is fully trusted and the PATH is known-good.
 *
 * In both modes, shell metacharacters are rejected in the command name because
 * shell: false is used and such characters have no legitimate role there.
 *
 * @param {string} command - The executable (already variable-substituted).
 * @param {boolean} allowUnsafe - Pass true only when the config has opted in.
 */
function validateCommandSecurity(command, allowUnsafe) {
  if (SHELL_METACHAR_RE.test(command)) {
    throw new Error(
      `Command "${command}" contains shell metacharacters, which are not ` +
      'permitted. Use an absolute path to a trusted executable without ' +
      'special characters.'
    );
  }
  if (!allowUnsafe && !path.isAbsolute(command)) {
    throw new Error(
      `Command "${command}" must be an absolute path (e.g. /usr/bin/node). ` +
      'Bare command names are disabled by default to prevent PATH-based ' +
      'hijacking. Set allowUnsafeCommands: true in your config to opt in ' +
      '(ensure the runtime PATH is fully trusted before doing so).'
    );
  }
}

/**
 * Coerce a reported status value into a number, or null if not numeric.
 */
function toNumericStatus(value) {
  if (typeof value === 'number' && !Number.isNaN(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) {
    return Number(value);
  }
  return null;
}

/**
 * Execute a local command as a step.
 *
 * @param {Object} options
 * @param {string} options.command - Executable to run
 * @param {string[]} [options.args] - Arguments (already substituted)
 * @param {string} [options.cwd] - Working directory (absolute, or relative to process.cwd())
 * @param {Object} [options.env] - Extra environment variables (already substituted)
 * @param {number} [options.timeout] - Timeout in seconds (default 30)
 * @param {string} [options.statusFrom] - jsonpath into parsed stdout for HTTP status (default ".status")
 * @param {boolean} [options.allowUnsafeCommands] - Allow bare (non-absolute) command names
 * @returns {Promise<{status:number, statusText:string, headers:Object, body:Object, duration:number}>}
 */
function executeCommand(options) {
  const {
    command,
    args = [],
    cwd,
    env = {},
    timeout = 30,
    statusFrom = '.status',
    allowUnsafeCommands = false
  } = options;

  return new Promise((resolve, reject) => {
    // Validate command before spawning (throws synchronously; Promise catches it).
    try {
      validateCommandSecurity(command, allowUnsafeCommands);
    } catch (err) {
      return reject(err);
    }

    const startTime = Date.now();

    const resolvedCwd = cwd
      ? (path.isAbsolute(cwd) ? cwd : path.resolve(process.cwd(), cwd))
      : process.cwd();

    let child;
    try {
      // Command and cwd come from user-owned config (privileged input). Safe mode enforces absolute
      // paths to block PATH hijacking; shell: false prevents shell expansion; shell metacharacters
      // are rejected by validateCommandSecurity(). Users opt into bare names via allowUnsafeCommands.
      child = spawn(command, args, { // lgtm[js/command-line-injection]
        cwd: resolvedCwd, // lgtm[js/path-injection]
        env: { ...process.env, ...env },
        shell: false
      });
    } catch (err) {
      return reject(new Error(`Command not found: ${command}`));
    }

    let stdout = '';
    let stderr = '';
    let outputBytes = 0;
    let settled = false;
    let timedOut = false;
    let overLimit = false;
    let killTimer = null;

    const killProcess = () => {
      try { child.kill('SIGTERM'); } catch (e) { /* ignore */ }
      killTimer = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch (e) { /* ignore */ }
      }, KILL_GRACE_MS);
      if (killTimer.unref) killTimer.unref();
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killProcess();
    }, timeout * 1000);
    if (timer.unref) timer.unref();

    // Decode each stream with its own StringDecoder so multibyte UTF-8
    // characters that straddle chunk boundaries are not corrupted into U+FFFD.
    const stdoutDecoder = new StringDecoder('utf8');
    const stderrDecoder = new StringDecoder('utf8');

    const onData = (chunk, isErr) => {
      outputBytes += chunk.length; // count raw bytes against the cap
      if (outputBytes > MAX_OUTPUT_BYTES) {
        if (!overLimit) {
          overLimit = true;
          killProcess();
        }
        return; // stop accumulating once over the cap
      }
      const decoder = isErr ? stderrDecoder : stdoutDecoder;
      const text = decoder.write(chunk);
      if (isErr) stderr += text; else stdout += text;
    };

    child.stdout.on('data', (c) => onData(c, false));
    child.stderr.on('data', (c) => onData(c, true));

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      if (err.code === 'ENOENT') {
        return reject(new Error(`Command not found: ${command}`));
      }
      return reject(err);
    });

    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);

      const duration = (Date.now() - startTime) / 1000;

      if (timedOut) {
        return reject(new Error(`Command timeout after ${timeout}s`));
      }
      if (overLimit) {
        return reject(new Error(`Command output exceeded ${MAX_OUTPUT_BYTES / (1024 * 1024)} MB`));
      }

      // Flush any bytes the decoders buffered for an incomplete trailing sequence.
      stdout += stdoutDecoder.end();
      stderr += stderrDecoder.end();

      const exitCode = code === null ? 1 : code;

      // Parse stdout as JSON if possible
      let json = null;
      const trimmed = stdout.trim();
      if (trimmed.length > 0) {
        try { json = JSON.parse(trimmed); } catch (e) { json = null; }
      }

      // Determine status: script-reported HTTP status, else exit-derived
      const reported = json !== null ? toNumericStatus(extractValue(json, statusFrom)) : null;
      const status = reported !== null ? reported : (exitCode === 0 ? 200 : 500);

      const statusText = signal ? `killed (${signal})` : `exit ${exitCode}`;

      resolve({
        status,
        statusText,
        headers: {},
        body: { exitCode, stdout, stderr, json },
        duration
      });
    });
  });
}

module.exports = {
  executeCommand,
  validateCommandSecurity,
  MAX_OUTPUT_BYTES
};
