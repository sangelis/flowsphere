/**
 * Flow Runner Module
 * Handles execution of flow sequences via the /api/execute-stream endpoint
 */

/**
 * Global Modal Configuration
 * Centralized settings that all modals inherit
 * Add global modal behaviors here and all modals will automatically inherit them
 */
window.FlowSphereModalConfig = {
    // Prevent dismissal by clicking outside or pressing ESC
    backdrop: 'static',
    keyboard: false
};

/**
 * Configure a Bootstrap modal with global settings
 * @param {string|HTMLElement} modalElement - Modal element or selector
 * @param {Object} customConfig - Optional custom configuration to override defaults
 * @returns {bootstrap.Modal} Configured Bootstrap modal instance
 */
window.configureModal = function(modalElement, customConfig = {}) {
    const element = typeof modalElement === 'string'
        ? document.getElementById(modalElement) || document.querySelector(modalElement)
        : modalElement;

    if (!element) {
        console.warn('[Modal Config] Modal element not found:', modalElement);
        return null;
    }

    // Merge global config with custom config
    const config = { ...window.FlowSphereModalConfig, ...customConfig };

    // Get or create Bootstrap modal instance with config
    const modalInstance = bootstrap.Modal.getOrCreateInstance(element, config);

    return modalInstance;
};

// Store the last execution log and result for saving
let lastExecutionLog = null;
let lastExecutionResult = null;

// Execution state
let executionState = 'idle'; // 'idle', 'running', 'completed', 'failed', 'stopped'
let currentStepNumber = 0;
let totalStepsCount = 0;

// Execution control
let currentReader = null; // SSE reader for stopping execution
let currentAbortController = null; // AbortController for aborting fetch
let stopRequested = false; // Flag to track if user requested stop
let currentExecutionId = null; // Track current execution to ignore old events
let pendingPlaceholderResolve = null; // Resolve function for pending placeholder click

// Execution mode (Phase 2: Step-by-Step, Phase 3: Auto-Step)
let executionMode = 'full-speed'; // 'full-speed', 'step-by-step', or 'auto-step'
let autoStepDelay = 3; // Delay in seconds for auto-step mode (default: 3s)
let continueRequested = false; // Flag for step-by-step continue
let pendingContinueResolve = null; // Resolve function for continue promise
let countdownIntervalId = null; // Interval ID for countdown timer

/**
 * Update Run Sequence button visibility based on config state
 * Should be called whenever the config changes
 */
function updateRunSequenceButton() {
    const btn = document.getElementById('runSequenceBtn');
    if (!btn) return;

    // Show button only if there are nodes in the config
    const hasNodes = config && config.nodes && config.nodes.length > 0;
    btn.style.display = hasNodes ? 'inline-block' : 'none';
}

/**
 * Update execution progress indicator (now integrated in modal header)
 */
function updateProgressIndicator(state, stepNumber, totalSteps) {
    const progressBarContainer = document.getElementById('progressBarContainer');
    const progressIcon = document.getElementById('progressIcon');
    const progressBar = document.getElementById('progressBar');
    const progressSteps = document.getElementById('progressSteps');

    if (!progressBarContainer || !progressIcon) return;

    // Show progress bar during active states
    if (state === 'loading' || state === 'running' || state === 'paused' || state === 'completed' || state === 'failed' || state === 'stopped') {
        progressBarContainer.style.display = 'flex';

        // Update icon and progress bar based on state
        if (state === 'loading') {
            progressIcon.innerHTML = '<div class="spinner-border spinner-border-sm text-primary" role="status"><span class="visually-hidden">Loading...</span></div>';
            progressBar.className = 'progress-bar progress-bar-striped progress-bar-animated bg-primary';
            progressBar.style.width = '0%';
            if (progressSteps) progressSteps.textContent = `0 / ${totalSteps}`;
        } else if (state === 'running') {
            progressIcon.innerHTML = '<div class="spinner-border spinner-border-sm text-primary" role="status"><span class="visually-hidden">Running...</span></div>';
            progressBar.className = 'progress-bar progress-bar-striped progress-bar-animated bg-primary';
            const percentage = totalSteps > 0 ? (stepNumber / totalSteps * 100) : 0;
            progressBar.style.width = percentage + '%';
            if (progressSteps) progressSteps.textContent = `${stepNumber} / ${totalSteps}`;
        } else if (state === 'paused') {
            progressIcon.innerHTML = '<i class="bi bi-pause-circle-fill fs-5" style="color: var(--accent);"></i>';
            progressBar.className = 'progress-bar bg-accent';
            const percentage = totalSteps > 0 ? (stepNumber / totalSteps * 100) : 0;
            progressBar.style.width = percentage + '%';
            if (progressSteps) progressSteps.textContent = `${stepNumber} / ${totalSteps}`;
        } else if (state === 'stopped') {
            progressIcon.innerHTML = '<i class="bi bi-stop-circle-fill text-danger fs-5"></i>';
            progressBar.className = 'progress-bar bg-danger';
            const percentage = totalSteps > 0 ? (stepNumber / totalSteps * 100) : 0;
            progressBar.style.width = percentage + '%';
            if (progressSteps) progressSteps.textContent = `${stepNumber} / ${totalSteps}`;
        } else if (state === 'completed') {
            progressIcon.innerHTML = '<i class="bi bi-check-circle-fill text-success fs-5"></i>';
            progressBar.className = 'progress-bar bg-success';
            progressBar.style.width = '100%';
            if (progressSteps) progressSteps.textContent = `${totalSteps} / ${totalSteps}`;
        } else if (state === 'failed') {
            progressIcon.innerHTML = '<i class="bi bi-x-circle-fill text-danger fs-5"></i>';
            progressBar.className = 'progress-bar bg-danger';
            const percentage = totalSteps > 0 ? (stepNumber / totalSteps * 100) : 0;
            progressBar.style.width = percentage + '%';
            if (progressSteps) progressSteps.textContent = `${stepNumber} / ${totalSteps}`;
        }
    } else {
        // Hide progress bar when idle
        progressBarContainer.style.display = 'none';
        progressIcon.innerHTML = '';
    }
}

/**
 * Helper to set modal title and subtitle
 */
function setModalTitle(title, subtitle = null) {
    const modalTitle = document.getElementById('resultsModalLabel');
    const modalSubtitle = document.getElementById('resultsModalSubtitle');

    if (modalTitle) {
        modalTitle.innerHTML = title;
    }

    if (modalSubtitle) {
        if (subtitle) {
            modalSubtitle.innerHTML = subtitle;
            modalSubtitle.style.display = 'block';
        } else {
            modalSubtitle.style.display = 'none';
        }
    }
}

/**
 * Update Run button based on current execution state
 */
function updateRunButton(newState) {
    if (newState) {
        executionState = newState;
    }

    const runBtn = document.getElementById('runSequenceBtn');

    // Update toolbar Run button
    if (runBtn) {
        if (executionState === 'idle' || executionState === 'completed' || executionState === 'failed' || executionState === 'stopped') {
            runBtn.disabled = false;
            runBtn.innerHTML = '<i class="bi bi-water"></i> Go with the <em>Flow</em>';
        } else if (executionState === 'running') {
            runBtn.disabled = true;
            runBtn.innerHTML = '<i class="bi bi-water"></i> <em>Flow</em> in Motion';
        }
    }
}

/**
 * Clear results and reset to idle state
 */
function clearResults() {
    // Reset state
    currentStepNumber = 0;
    totalStepsCount = 0;
    lastExecutionLog = null;
    lastExecutionResult = null;
    stopRequested = false;
    currentReader = null;
    currentAbortController = null;
    pendingPlaceholderResolve = null;
    continueRequested = false;
    pendingContinueResolve = null;

    // Clear countdown timer if active
    if (countdownIntervalId) {
        clearInterval(countdownIntervalId);
        countdownIntervalId = null;
    }

    // Hide Continue button if visible
    hideContinueButton();

    // Update button and progress to idle state
    updateRunButton('idle');
    updateProgressIndicator('idle', 0, 0);

    // Close results modal
    const modal = document.getElementById('resultsModal');
    if (modal) {
        const bootstrapModal = bootstrap.Modal.getInstance(modal);
        if (bootstrapModal) {
            bootstrapModal.hide();
        }
    }
}

/**
 * Stop the currently running execution
 */
function stopExecution() {
    console.log('[Flow Runner] Stop requested');

    // Set stop flag
    stopRequested = true;

    // Update Stop button to show "Interrupting the Flow..." and disable it
    const stopBtn = document.getElementById('stopExecutionBtn');
    if (stopBtn) {
        stopBtn.innerHTML = 'Interrupting the <em>Flow</em>...';
        stopBtn.disabled = true;
        stopBtn.classList.add('disabled');
    }

    // DON'T abort fetch or cancel reader - let current step complete gracefully
    // The event loop will receive the final step event, display it, then stop
    // This implements "graceful interruption" - current step finishes, next step becomes "Not Run"
    console.log('[Flow Runner] Waiting for current step to complete gracefully...');

    // Resolve pending placeholder click if waiting (Full Speed mode)
    if (pendingPlaceholderResolve) {
        console.log('[Flow Runner] Resolving pending placeholder click');
        pendingPlaceholderResolve();
        pendingPlaceholderResolve = null;
    }

    // Resolve pending continue if waiting (Step-by-Step or Auto-Step mode)
    if (pendingContinueResolve) {
        console.log('[Flow Runner] Resolving pending continue in step-by-step/auto-step mode');
        pendingContinueResolve();
        pendingContinueResolve = null;
    }

    // Clear countdown timer if active (Auto-Step mode)
    if (countdownIntervalId) {
        console.log('[Flow Runner] Clearing countdown timer');
        clearInterval(countdownIntervalId);
        countdownIntervalId = null;
    }

    // Remove countdown UI elements (Continue Now button and countdown preview)
    const continueBtn = document.getElementById('continueStepBtn');
    const nextStepPreview = document.getElementById('nextStepPreview');
    if (continueBtn) {
        console.log('[Flow Runner] Removing Continue Now button');
        continueBtn.remove();
    }
    if (nextStepPreview) {
        console.log('[Flow Runner] Removing countdown preview');
        nextStepPreview.remove();
    }

    // Close any open input modal (userInputModal is the ID from collectUserInputForStep)
    const userInputModalEl = document.getElementById('userInputModal');
    if (userInputModalEl) {
        const userInputModal = bootstrap.Modal.getInstance(userInputModalEl);
        if (userInputModal) {
            userInputModal.hide();
            console.log('[Flow Runner] Closed user input modal due to stop');
        }
    }

    // Note: UI updates will happen when we receive the 'interrupted' event from server
    // or when the event loop detects stopRequested and breaks
}


/**
 * Show the Stop Execution button
 */
function showStopButton() {
    const stopBtn = document.getElementById('stopExecutionBtn');
    if (stopBtn) {
        stopBtn.style.display = 'inline-block';
        // Reset button state to default
        stopBtn.innerHTML = '<i class="bi bi-stop-circle"></i> Interrupt the <em>Flow</em>';
        stopBtn.disabled = false;
        stopBtn.classList.remove('disabled');
    }
}

/**
 * Hide the Stop Execution button
 */
function hideStopButton() {
    const stopBtn = document.getElementById('stopExecutionBtn');
    if (stopBtn) {
        stopBtn.style.display = 'none';
        // Reset button state when hiding
        stopBtn.innerHTML = '<i class="bi bi-stop-circle"></i> Interrupt the <em>Flow</em>';
        stopBtn.disabled = false;
        stopBtn.classList.remove('disabled');
    }
}

/**
 * Hide the Close Monitor button during execution
 */
function hideCloseMonitorButton() {
    const closeBtn = document.getElementById('closeMonitorBtn');
    if (closeBtn) {
        closeBtn.style.display = 'none';
    }
}

/**
 * Show the Close Monitor button after execution
 */
function showCloseMonitorButton() {
    const closeBtn = document.getElementById('closeMonitorBtn');
    if (closeBtn) {
        closeBtn.style.display = 'inline-block';
    }
}

/**
 * Show execution mode selector modal
 * Allows user to choose between Full Speed and Step-by-Step execution
 */
function showExecutionModeSelector() {
    // Create modal if it doesn't exist
    let modal = document.getElementById('executionModeModal');
    if (!modal) {
        const modalHtml = `
            <div class="modal fade" id="executionModeModal" tabindex="-1" aria-labelledby="executionModeModalLabel" aria-hidden="true">
                <div class="modal-dialog modal-dialog-centered">
                    <div class="modal-content">
                        <div class="modal-header flex-column align-items-start">
                            <div class="d-flex w-100 align-items-center">
                                <h5 class="modal-title mb-0" id="executionModeModalLabel">
                                    <i class="bi bi-diagram-3 me-2"></i>
                                    Select Flow Dynamics
                                </h5>
                                <button type="button" class="btn-close ms-auto" data-bs-dismiss="modal" aria-label="Close"></button>
                            </div>
                            <div class="text-muted small mt-1">Control, calibrate, or automate — your choice.</div>
                        </div>
                        <div class="modal-body">
                            <div class="mb-3">
                                <div class="form-check mb-3 p-3 border rounded execution-mode-option" style="cursor: pointer;">
                                    <input class="form-check-input" type="radio" name="executionMode" id="modeFullSpeed" value="full-speed" checked>
                                    <label class="form-check-label w-100" for="modeFullSpeed" style="cursor: pointer;">
                                        <div class="d-flex align-items-start">
                                            <i class="bi bi-lightning-charge-fill fs-5 me-2" style="color: var(--text-primary);"></i>
                                            <div>
                                                <strong>Full Throttle</strong>
                                                <div class="small text-muted">Run all nodes continuously — pure Flow Motion.</div>
                                            </div>
                                        </div>
                                    </label>
                                </div>
                                <div class="form-check mb-3 p-3 border rounded execution-mode-option" style="cursor: pointer;">
                                    <input class="form-check-input" type="radio" name="executionMode" id="modeStepByStep" value="step-by-step">
                                    <label class="form-check-label w-100" for="modeStepByStep" style="cursor: pointer;">
                                        <div class="d-flex align-items-start">
                                            <i class="bi bi-bullseye fs-5 me-2" style="color: var(--text-primary);"></i>
                                            <div>
                                                <strong>Precision Mode</strong>
                                                <div class="small text-muted">Engage each node manually — ideal for calibration or debugging.</div>
                                            </div>
                                        </div>
                                    </label>
                                </div>
                                <div class="form-check p-3 border rounded execution-mode-option" style="cursor: pointer;">
                                    <input class="form-check-input" type="radio" name="executionMode" id="modeAutoStep" value="auto-step">
                                    <label class="form-check-label w-100" for="modeAutoStep" style="cursor: pointer;">
                                        <div class="d-flex align-items-start">
                                            <i class="bi bi-stopwatch fs-5 me-2" style="color: var(--text-primary);"></i>
                                            <div class="flex-grow-1">
                                                <strong>Automation with rhythm</strong>
                                                <div class="small text-muted">Auto-resume after configurable delay — hands-free debugging.</div>
                                                <div class="mt-2" id="delaySelector" style="display: none;">
                                                    <label class="form-label small mb-1">Delay between steps:</label>
                                                    <select class="form-select form-select-sm" id="autoStepDelaySelect" onclick="event.stopPropagation()">
                                                        <option value="1">1 second</option>
                                                        <option value="2">2 seconds</option>
                                                        <option value="3" selected>3 seconds</option>
                                                        <option value="5">5 seconds</option>
                                                        <option value="10">10 seconds</option>
                                                        <option value="30">30 seconds</option>
                                                    </select>
                                                </div>
                                            </div>
                                        </div>
                                    </label>
                                </div>
                            </div>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                            <button type="button" class="btn btn-success" onclick="startFlowWithSelectedMode()">
                                <i class="bi bi-play-fill"></i> Engage Flow
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        modal = document.getElementById('executionModeModal');

        // Add hover effect to options
        const options = modal.querySelectorAll('.execution-mode-option');
        options.forEach(option => {
            option.addEventListener('mouseenter', () => {
                option.style.backgroundColor = 'rgba(13, 110, 253, 0.05)';
            });
            option.addEventListener('mouseleave', () => {
                option.style.backgroundColor = '';
            });
            option.addEventListener('click', () => {
                option.querySelector('input[type="radio"]').checked = true;
                updateDelaySelectorVisibility();
            });
        });

        // Add change listeners to radio buttons for delay selector visibility
        document.querySelectorAll('input[name="executionMode"]').forEach(radio => {
            radio.addEventListener('change', updateDelaySelectorVisibility);
        });
    }

    // Helper function to show/hide delay selector
    function updateDelaySelectorVisibility() {
        const delaySelector = document.getElementById('delaySelector');
        const autoStepRadio = document.getElementById('modeAutoStep');
        if (delaySelector && autoStepRadio) {
            delaySelector.style.display = autoStepRadio.checked ? 'block' : 'none';
        }
    }

    // Load previously selected mode and delay from localStorage
    const savedMode = localStorage.getItem('flowsphere-execution-mode') || 'full-speed';
    const savedDelay = localStorage.getItem('flowsphere-auto-step-delay') || '3';

    const radioButton = document.getElementById(
        savedMode === 'step-by-step' ? 'modeStepByStep' :
        savedMode === 'auto-step' ? 'modeAutoStep' :
        'modeFullSpeed'
    );
    if (radioButton) {
        radioButton.checked = true;
    }

    // Set saved delay
    const delaySelect = document.getElementById('autoStepDelaySelect');
    if (delaySelect) {
        delaySelect.value = savedDelay;
    }

    // Show delay selector if Auto-Step is selected
    updateDelaySelectorVisibility();

    // Show modal with global configuration
    const bootstrapModal = window.configureModal(modal);
    if (bootstrapModal) {
        bootstrapModal.show();
    }
}

/**
 * Start flow with the selected execution mode from the modal
 */
function startFlowWithSelectedMode() {
    // Get selected mode
    const selectedMode = document.querySelector('input[name="executionMode"]:checked').value;
    executionMode = selectedMode;

    // Save mode to localStorage
    localStorage.setItem('flowsphere-execution-mode', selectedMode);

    // Get and save delay for Auto-Step mode
    if (executionMode === 'auto-step') {
        const delaySelect = document.getElementById('autoStepDelaySelect');
        if (delaySelect) {
            autoStepDelay = parseInt(delaySelect.value);
            localStorage.setItem('flowsphere-auto-step-delay', delaySelect.value);
        }
    }

    // Close modal
    const modal = document.getElementById('executionModeModal');
    const bootstrapModal = bootstrap.Modal.getInstance(modal);
    if (bootstrapModal) {
        bootstrapModal.hide();
    }

    // Start execution based on mode
    if (executionMode === 'step-by-step') {
        runSequenceStepByStep();
    } else if (executionMode === 'auto-step') {
        runSequenceAutoStep();
    } else {
        runSequenceFullSpeed();
    }
}

/**
 * Run the current sequence configuration with real-time streaming (Full Speed Mode)
 */
async function runSequenceFullSpeed() {
    // Declare executionLog at function scope so catch block can access it
    let executionLog = [];

    try {
        // Get current config from state
        const config = getCurrentConfig();

        if (!config || !config.nodes || config.nodes.length === 0) {
            showAlert('error', 'No nodes to execute. Please add at least one node to your configuration.');
            return;
        }

        // Validate config before execution
        try {
            const validationResponse = await fetch('/api/validate', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ config: config })
            });

            if (!validationResponse.ok) {
                throw new Error(`Validation request failed: ${validationResponse.statusText}`);
            }

            const validationResult = await validationResponse.json();

            // If validation failed, show errors and abort execution
            if (!validationResult.valid) {
                console.log('[Flow Runner] Validation failed, aborting execution');

                // Show validation modal with errors (non-silent mode)
                if (typeof showConfigValidationResults === 'function') {
                    showConfigValidationResults(validationResult);
                } else {
                    // Fallback: show basic alert
                    const errorCount = validationResult.errors.length;
                    showAlert('error', `Config validation failed with ${errorCount} error${errorCount > 1 ? 's' : ''}. Please fix the errors before running.`);
                }
                return; // Abort execution
            }

            console.log('[Flow Runner] Validation passed, proceeding with execution');
        } catch (validationError) {
            console.error('[Flow Runner] Validation error:', validationError);
            showAlert('error', `Failed to validate config: ${validationError.message}`);
            return; // Abort execution
        }

        // Reset state for new execution
        currentStepNumber = 0;
        totalStepsCount = config.nodes.length;
        stopRequested = false;
        currentReader = null;
        currentAbortController = new AbortController();
        currentExecutionId = null; // Will be set when we receive 'start' event
        pendingPlaceholderResolve = null;
        executionLog = []; // Reset for new execution

        // Hide post-execution buttons
        hidePostExecutionButtons();

        // Open modal immediately with loading state (this creates the modal)
        showLoadingModal(config.nodes.length);

        // Now update to running state (after modal exists)
        updateRunButton('running');

        // Show stop button and hide close button during execution
        showStopButton();
        hideCloseMonitorButton();

        // Use streaming API endpoint
        const response = await fetch('/api/execute-stream', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                config: config,
                options: {
                    startStep: 0,
                    enableDebug: false
                }
            }),
            signal: currentAbortController.signal
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        // Read the streaming response
        const reader = response.body.getReader();
        currentReader = reader; // Store for stop functionality
        const decoder = new TextDecoder();
        let buffer = '';

        let totalSteps = 0;
        let currentStep = 0;
        const steps = [];
        const pendingSteps = new Map(); // Track steps waiting for completion
        // executionLog already declared at function scope

        while (true) {
            // Check if stop was requested
            if (stopRequested) {
                console.log('[Flow Runner] Stop detected, breaking execution loop');
                // Save partial execution log
                lastExecutionLog = executionLog;
                lastExecutionResult = {
                    success: false,
                    interrupted: true,
                    lastCompletedStep: currentStepNumber,
                    totalSteps: totalStepsCount,
                    executionLog: executionLog
                };

                // Update UI to show interrupted state
                updateRunButton('stopped');
                updateProgressIndicator('stopped', currentStepNumber, totalStepsCount);
                const nextStep = currentStepNumber + 1;
                setModalTitle('<em>Flow</em> Interrupted', currentStepNumber > 0
                    ? `User had second thoughts just before node ${nextStep} could be part of the <em>Flow</em>`
                    : `User had second thoughts...`);
                hideStopButton();
                showCloseMonitorButton();
                showPostExecutionButtons(false);
                break;
            }

            const { done, value } = await reader.read();
            if (done) break;

            // Don't check stopRequested here - let events be processed first for graceful interruption
            // The check after processing 'step' events will handle graceful stop

            // Decode chunk and add to buffer
            buffer += decoder.decode(value, { stream: true });

            // Process complete events (separated by \n\n)
            const events = buffer.split('\n\n');
            buffer = events.pop() || ''; // Keep incomplete event in buffer

            for (const eventText of events) {
                if (!eventText.trim()) continue;

                const lines = eventText.split('\n');
                let eventType = '';
                let eventData = '';

                for (const line of lines) {
                    if (line.startsWith('event: ')) {
                        eventType = line.substring(7);
                    } else if (line.startsWith('data: ')) {
                        eventData = line.substring(6);
                    }
                }

                if (!eventType || !eventData) continue;

                const data = JSON.parse(eventData);

                // Capture execution ID from first event that has it
                if (data.executionId && !currentExecutionId) {
                    currentExecutionId = data.executionId;
                    console.log('[Flow Runner] Captured execution ID:', currentExecutionId);
                }

                // Ignore events from old/stopped executions
                if (stopRequested && data.executionId && data.executionId !== currentExecutionId) {
                    console.log('[Flow Runner] Ignoring event from old execution:', data.executionId);
                    continue;
                }

                // Handle different event types
                if (eventType === 'start') {
                    totalSteps = data.totalSteps;
                    totalStepsCount = data.totalSteps; // Update global state
                    updateModalWithFlowStarted(totalSteps);
                    updateProgressIndicator('running', 0, totalSteps);
                } else if (eventType === 'step_start') {
                    // Step execution started - set timeout to show placeholder after 0.8s
                    const timeoutId = setTimeout(() => {
                        currentStep++;
                        showStepPlaceholder(data, currentStep, totalSteps);
                        pendingSteps.set(data.step, { placeholderShown: true, stepNumber: currentStep });
                    }, 800);

                    // Store timeout so we can clear it if step completes quickly
                    pendingSteps.set(data.step, { timeoutId, placeholderShown: false });
                } else if (eventType === 'input_required') {
                    // Ignore input requests from stopped executions
                    if (stopRequested) {
                        console.log('[Flow Runner] Ignoring input_required from stopped execution');
                        continue;
                    }

                    // Show a clickable placeholder instead of immediately showing modal
                    // This allows user to complete previous step (e.g., OAuth flow in browser)

                    console.log('[Flow Runner] input_required event received:', data);

                    // Set paused state and modal title BEFORE showing placeholder
                    // Use data.step - 1 to show completed steps (this step is awaiting, not executed yet)
                    setModalTitle('<em>Flow</em> Paused', 'Awaiting User Calibration');
                    updateProgressIndicator('paused', data.step - 1, totalSteps);

                    // Loop until user provides input or execution is stopped
                    let userInput = null;
                    let firstAttempt = true;
                    while (!userInput && !stopRequested) {
                        console.log('[Flow Runner] Showing input placeholder for step:', data.step);

                        // Use data.step as the unique ID (not currentStep, to avoid double-counting)
                        if (firstAttempt) {
                            // First attempt: show placeholder and auto-open modal
                            showInputPendingPlaceholderNonBlocking(data, data.step, totalSteps);
                            console.log('[Flow Runner] Auto-opening input modal...');
                            firstAttempt = false;
                        } else {
                            // Subsequent attempts: wait for user to click placeholder
                            await showInputPendingPlaceholder(data, data.step, totalSteps);

                            // Check if stop was requested during wait
                            if (stopRequested) {
                                console.log('[Flow Runner] Stop requested while waiting for placeholder click');
                                break;
                            }

                            console.log('[Flow Runner] Placeholder clicked, opening modal...');
                        }

                        // Check if stop was requested before showing modal
                        if (stopRequested) {
                            break;
                        }

                        // Collect user input
                        userInput = await collectUserInputForStep(data);

                        console.log('[Flow Runner] User input received:', userInput ? 'yes' : 'no (modal closed)');

                        // Check if stop was requested during input collection
                        if (stopRequested) {
                            console.log('[Flow Runner] Stop requested, cancelling input collection');
                            break;
                        }

                        // If modal was closed without submitting (returns null), loop again
                        // Next iteration will wait for user to click placeholder
                    }

                    // If execution was stopped, don't send input to server
                    if (stopRequested) {
                        console.log('[Flow Runner] Execution stopped, not sending input to server');

                        // Update placeholder to show interrupted state
                        const placeholder = document.getElementById(`step-${data.step}`);
                        if (placeholder) {
                            placeholder.innerHTML = `
                                <div class="d-flex align-items-center gap-2 py-2 px-3 bg-secondary bg-opacity-10 border border-secondary rounded">
                                    <span class="badge bg-secondary bg-opacity-75 me-1">#${data.step}</span>
                                    <i class="bi bi-slash-circle text-muted"></i>
                                    <span class="flex-grow-1 small text-truncate">${escapeHtml(data.name)}</span>
                                    <span class="text-muted small fw-semibold">Not Run</span>
                                </div>
                            `;
                        }

                        continue;
                    }

                    console.log('[Flow Runner] Sending input to server:', userInput);

                    // Remove the placeholder
                    removeInputPendingPlaceholder(data.step);

                    // Send input back to server
                    try {
                        const inputResponse = await fetch('/api/provide-input', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                executionId: data.executionId,
                                stepIndex: data.stepIndex,
                                userInput: userInput
                            })
                        });

                        console.log('[Flow Runner] Input response status:', inputResponse.status);

                        const inputResult = await inputResponse.json();
                        console.log('[Flow Runner] Input response:', inputResult);

                        if (!inputResult.success) {
                            console.error('[Flow Runner] Failed to send input:', inputResult.error);
                        }

                        // Restore running state after user provides input
                        setModalTitle('<em>Flow</em> in Motion', 'Executing nodes sequentially');
                        updateProgressIndicator('running', currentStep, totalSteps);

                        console.log('[Flow Runner] Resumed execution after user input');

                    } catch (error) {
                        console.error('[Flow Runner] Error sending input to server:', error);
                        showAlert('error', 'Failed to send user input: ' + error.message);
                    }
                } else if (eventType === 'step') {
                    // Check if we have a pending step
                    const pending = pendingSteps.get(data.step);

                    if (pending) {
                        // Clear timeout if step completed quickly
                        if (pending.timeoutId) {
                            clearTimeout(pending.timeoutId);
                        }

                        if (pending.placeholderShown) {
                            // Replace placeholder with actual result
                            currentStepNumber = pending.stepNumber; // Update global step number
                            replaceStepPlaceholder(data, pending.stepNumber, totalSteps);
                        } else {
                            // No placeholder was shown - add step normally
                            currentStep++;
                            currentStepNumber = currentStep; // Update global step number
                            steps.push(data);
                            updateModalWithStep(data, currentStep, totalSteps);
                        }

                        pendingSteps.delete(data.step);
                    } else {
                        // No pending step (shouldn't happen, but handle gracefully)
                        currentStep++;
                        currentStepNumber = currentStep; // Update global step number
                        steps.push(data);
                        updateModalWithStep(data, currentStep, totalSteps);
                    }

                    // Add to execution log for partial saves
                    executionLog.push(data);

                    // Update progress indicator with current step
                    updateProgressIndicator('running', currentStepNumber, totalSteps);

                    // Handle browser launch if step succeeded
                    if (data.status === 'completed' && data.launchBrowser && data.response) {
                        handleBrowserLaunch(data);
                    }

                    // Check if stop was requested - if so, this was the last step to execute
                    // Show next step as "Not Run" then stop gracefully
                    if (stopRequested) {
                        console.log('[Flow Runner] Stop requested after step completed - showing next step as Not Run');

                        const nextStepNumber = currentStepNumber + 1;
                        if (nextStepNumber <= totalSteps) {
                            // Get next node data from config
                            const config = getCurrentConfig();
                            const nextNode = config.nodes[nextStepNumber - 1];

                            // Add "Not Run" placeholder for next step AFTER the current completed step
                            const container = document.getElementById('flowStepsContainer');
                            if (container && nextNode) {
                                const notRunHtml = `
                                    <div class="step-card-animated mb-2" id="step-${nextStepNumber}">
                                        <div class="d-flex align-items-center gap-2 py-2 px-3 bg-secondary bg-opacity-10 border border-secondary rounded">
                                            <span class="badge bg-secondary bg-opacity-75 me-1">#${nextStepNumber}</span>
                                            <i class="bi bi-slash-circle text-muted"></i>
                                            <span class="flex-grow-1 small text-truncate">${escapeHtml(nextNode.name || formatStepLabel(nextNode))}</span>
                                            <span class="text-muted small fw-semibold">Not Run</span>
                                        </div>
                                    </div>
                                `;

                                // Insert at the beginning of the container (on top)
                                container.insertAdjacentHTML('afterbegin', notRunHtml);
                                console.log('[Flow Runner] Added Not Run placeholder at top');

                                // Scroll it into view
                                const notRunElement = document.getElementById(`step-${nextStepNumber}`);
                                if (notRunElement) {
                                    notRunElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                                }
                            }
                        }

                        // Save partial execution log
                        lastExecutionLog = executionLog;
                        lastExecutionResult = {
                            success: false,
                            interrupted: true,
                            lastCompletedStep: currentStepNumber,
                            totalSteps: totalSteps,
                            executionLog: executionLog
                        };

                        // Update UI to interrupted state
                        updateRunButton('stopped');
                        updateProgressIndicator('stopped', currentStepNumber, totalSteps);
                        setModalTitle('<em>Flow</em> Interrupted',
                            `User had second thoughts just before node ${nextStepNumber} could be part of the <em>Flow</em>`);
                        hideStopButton();
                        showCloseMonitorButton();
                        showPostExecutionButtons(false);

                        // Break from event loop
                        break;
                    }
                } else if (eventType === 'end') {
                    // Flow completed
                    lastExecutionLog = data.executionLog || [];
                    lastExecutionResult = data; // Store full execution result with metadata
                    updateModalWithSummary(data);

                    // Update execution state based on success
                    const finalState = data.success ? 'completed' : 'failed';
                    updateRunButton(finalState);
                    updateProgressIndicator(finalState, currentStepNumber, totalStepsCount);
                    hideStopButton();
                    showCloseMonitorButton();
                    showPostExecutionButtons(data.success);
                } else if (eventType === 'interrupted') {
                    // Flow was interrupted by user
                    lastExecutionLog = data.executionLog || [];
                    lastExecutionResult = {
                        success: false,
                        interrupted: true,
                        lastCompletedStep: data.lastCompletedStep,
                        totalSteps: data.totalSteps,
                        executionLog: data.executionLog
                    };

                    // Update UI to show interrupted state
                    updateRunButton('stopped');
                    updateProgressIndicator('stopped', data.lastCompletedStep, data.totalSteps);
                    const nextStep = data.lastCompletedStep + 1;
                    setModalTitle('<em>Flow</em> Interrupted', data.lastCompletedStep > 0
                        ? `User had second thoughts just before node ${nextStep} could be part of the <em>Flow</em>`
                        : `User had second thoughts...`);
                    hideStopButton();
                    showCloseMonitorButton();
                    showPostExecutionButtons(false);
                } else if (eventType === 'error') {
                    showExecutionError(new Error(data.message));
                    updateRunButton('failed');
                    updateProgressIndicator('failed', currentStepNumber, totalStepsCount);
                    hideStopButton();
                    showCloseMonitorButton();
                    showPostExecutionButtons(false);
                }
            }

            // Check if we broke from event processing due to stop
            if (stopRequested) {
                console.log('[Flow Runner] Breaking from main loop after processing stop');
                break;
            }
        }

    } catch (error) {
        console.error('[Flow Runner] Execution error:', error);

        // Show error UI (interrupted state is handled in event loop now)
        updateRunButton('failed');
        updateProgressIndicator('failed', currentStepNumber, totalStepsCount);
        showExecutionError(error);
        showPostExecutionButtons(false);
        hideStopButton();
        showCloseMonitorButton();
    }
}

/**
 * Get current configuration from state
 */
function getCurrentConfig() {
    // Use the existing config object
    return config;
}

/**
 * Show/hide running state - with Flow branding
 * @deprecated Use updateRunButton() instead
 */
function showRunningState(isRunning) {
    // Backward compatibility wrapper
    updateRunButton(isRunning ? 'running' : 'idle');
}

/**
 * Show loading modal immediately - with Flow branding
 */
function showLoadingModal(totalSteps) {
    // Create modal if it doesn't exist
    let modal = document.getElementById('resultsModal');
    if (!modal) {
        createResultsModal();
        modal = document.getElementById('resultsModal');
    }

    // Update modal title with branded message
    // Stage 1: Auto-Execution Begins - "Flow in Motion — executing nodes sequentially..."
    setModalTitle('<em>Flow</em> in Motion', 'Executing nodes sequentially');

    // Initialize modal body with steps container
    const modalBody = document.getElementById('resultsModalBody');
    modalBody.innerHTML = `<div id="flowStepsContainer" class="execution-log"></div>`;

    // Show progress indicator with loading state
    updateProgressIndicator('loading', 0, totalSteps);

    // Show modal with global configuration
    const bootstrapModal = window.configureModal(modal);
    if (bootstrapModal) {
        bootstrapModal.show();
    }
}

/**
 * Update modal when flow starts
 */
function updateModalWithFlowStarted(totalSteps) {
    // Progress indicator handles this now - no need for separate loading state
    // Just update the modal title with branded message
    const modalTitle = document.getElementById('resultsModalLabel');
    if (modalTitle) {
        // Stage 1: Auto-Execution Begins - "Flow in Motion — executing nodes sequentially..."
        modalTitle.textContent = 'Flow in Motion';
    }
}

/**
 * Update modal with a new step result in real-time - CLI-like format
 */
function updateModalWithStep(stepData, currentStep, totalSteps) {
    const container = document.getElementById('flowStepsContainer');
    if (!container) return;

    const statusClass = stepData.status === 'completed' ? 'success' :
                      stepData.status === 'skipped' ? 'warning' : 'danger';
    const statusIcon = stepData.status === 'completed' ? '✅' :
                     stepData.status === 'skipped' ? '⊘' : '❌';

    // CLI-like compact format: Step 1: GET url ✅ Status 200 OK (0.123s)
    const statusText = stepData.response ?
        `Status ${stepData.response.status} ${stepData.response.statusText || ''}` :
        stepData.status.toUpperCase();

    // Display step label with substitution highlighting
    const stepLabel = formatStepLabel(stepData);
    const displayStepLabel = highlightSubstitutionsInText(stepLabel, stepData.substitutions);

    const responseHtml = stepData.response ? (
        (stepData.type === 'command' || (stepData.response.body && typeof stepData.response.body.exitCode !== 'undefined'))
            ? (typeof renderCommandResultPanels === 'function'
                ? renderCommandResultPanels(stepData.response.body)
                : `<pre class="json-preview-code m-0 p-2 small" style="max-height: 400px; overflow-y: auto;">${escapeHtml(JSON.stringify(stepData.response.body, null, 2))}</pre>`)
            : `<pre class="json-preview-code m-0 p-2 small" style="max-height: 400px; overflow-y: auto;">${escapeHtml(JSON.stringify(stepData.response.body, null, 2))}</pre>`
    ) : '';

    // Build validation lines (one per validation, like CLI)
    let validationLines = '';
    if (stepData.validations && stepData.validations.length > 0) {
        const validationParts = stepData.validations.map(v => {
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
                // Truncate very long values
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

        validationLines = validationParts.join('');
    }

    // Determine if step should be expandable
    const hasDetails = stepData.request || stepData.response || stepData.skipReason || stepData.error;

    const stepHtml = `
        <div class="step-card-animated mb-2" id="step-${currentStep}">
            <div class="d-flex align-items-center gap-2 py-2 px-3 bg-${statusClass} bg-opacity-10 border border-${statusClass} rounded cli-step-line ${hasDetails ? 'cli-step-clickable' : ''}"
                 ${hasDetails ? `
                    role="button"
                    data-bs-toggle="collapse"
                    data-bs-target="#details${currentStep}"
                    aria-expanded="false"
                    aria-controls="details${currentStep}"
                 ` : ''}>
                <span class="badge bg-secondary bg-opacity-75 me-1">#${currentStep}</span>
                <span>${statusIcon}</span>
                <span class="flex-grow-1 small text-truncate" title="${escapeHtml(stepLabel)}">${displayStepLabel}</span>
                <span class="text-${statusClass} small fw-semibold">${statusText}</span>
                <span class="text-muted small">(${stepData.duration ? stepData.duration + 's' : '-'})</span>
                ${hasDetails ? `
                    <i class="bi bi-chevron-down ms-2"></i>
                ` : ''}
            </div>
            ${validationLines}
            ${hasDetails ? `
                <div class="collapse" id="details${currentStep}">
                    <div class="card card-body mt-1 p-2">
                        ${stepData.name ? `<div class="fw-bold text-primary mb-2 pb-2 border-bottom"><i class="bi bi-tag me-1"></i>${escapeHtml(stepData.name)}</div>` : ''}
                        <div class="accordion accordion-flush" id="stepAccordion${currentStep}">
                            ${stepData.request ? `
                                <div class="accordion-item">
                                    <h2 class="accordion-header">
                                        <button class="accordion-button collapsed" type="button"
                                                data-bs-toggle="collapse" data-bs-target="#request${currentStep}">
                                            <i class="bi bi-box-arrow-up-right me-2"></i> Request
                                        </button>
                                    </h2>
                                    <div id="request${currentStep}" class="accordion-collapse collapse"
                                         data-bs-parent="#stepAccordion${currentStep}">
                                        <div class="accordion-body p-0">
                                            <pre class="json-preview-code m-0 p-2 small">${highlightSubstitutionsInJSON(stepData.request, stepData.substitutions)}</pre>
                                        </div>
                                    </div>
                                </div>
                            ` : ''}
                            ${stepData.response ? `
                                <div class="accordion-item">
                                    <h2 class="accordion-header">
                                        <button class="accordion-button collapsed" type="button"
                                                data-bs-toggle="collapse" data-bs-target="#response${currentStep}">
                                            <i class="bi bi-box-arrow-in-down-right me-2"></i> Response
                                        </button>
                                    </h2>
                                    <div id="response${currentStep}" class="accordion-collapse collapse"
                                         data-bs-parent="#stepAccordion${currentStep}">
                                        <div class="accordion-body p-0">
                                            ${responseHtml}
                                        </div>
                                    </div>
                                </div>
                            ` : ''}
                        </div>
                        ${stepData.skipReason ? `
                            <div class="alert alert-warning mt-2 mb-0 small">
                                <i class="bi bi-info-circle me-1"></i>
                                <strong>Skipped:</strong> ${escapeHtml(stepData.skipReason)}
                            </div>
                        ` : ''}
                        ${stepData.error && !stepData.error.includes('validation failed') ? `
                            <div class="alert alert-danger mt-2 mb-0 small">
                                <i class="bi bi-exclamation-triangle me-1"></i>
                                <strong>Error:</strong> ${escapeHtml(stepData.error)}
                            </div>
                        ` : ''}
                    </div>
                </div>
            ` : ''}
        </div>
    `;

    container.insertAdjacentHTML('afterbegin', stepHtml);

    // Scroll to the new step (at top)
    const newStep = document.getElementById(`step-${currentStep}`);
    if (newStep) {
        newStep.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

/**
 * Show a placeholder for a step that's taking time to execute
 */
function showStepPlaceholder(stepData, currentStep, totalSteps) {
    const container = document.getElementById('flowStepsContainer');
    if (!container) return;

    const stepLabel = formatStepLabel(stepData);

    const placeholderHtml = `
        <div class="step-card-animated mb-2" id="step-${currentStep}">
            <div class="d-flex align-items-center gap-2 py-2 px-3 bg-info bg-opacity-10 border border-info rounded">
                <span class="badge bg-secondary bg-opacity-75 me-1">#${currentStep}</span>
                <div class="spinner-border spinner-border-sm text-info" role="status">
                    <span class="visually-hidden">Executing...</span>
                </div>
                <span class="flex-grow-1 small text-truncate" title="${escapeHtml(stepLabel)}">${escapeHtml(stepLabel)}</span>
                <span class="text-info small fw-semibold">Executing...</span>
            </div>
        </div>
    `;

    container.insertAdjacentHTML('afterbegin', placeholderHtml);

    // Scroll to placeholder (at top)
    const placeholder = document.getElementById(`step-${currentStep}`);
    if (placeholder) {
        placeholder.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

/**
 * Replace placeholder with actual step result
 */
function replaceStepPlaceholder(stepData, stepNumber, totalSteps) {
    const placeholder = document.getElementById(`step-${stepNumber}`);
    if (!placeholder) {
        // Placeholder not found, just add normally
        const container = document.getElementById('flowStepsContainer');
        if (container) {
            updateModalWithStep(stepData, stepNumber, totalSteps);
        }
        return;
    }

    // Build the actual step HTML (same as updateModalWithStep)
    const statusClass = stepData.status === 'completed' ? 'success' :
                      stepData.status === 'skipped' ? 'warning' : 'danger';
    const statusIcon = stepData.status === 'completed' ? '✅' :
                     stepData.status === 'skipped' ? '⊘' : '❌';

    const statusText = stepData.response ?
        `Status ${stepData.response.status} ${stepData.response.statusText || ''}` :
        stepData.status.toUpperCase();

    // Display step label with substitution highlighting
    const stepLabel = formatStepLabel(stepData);
    const displayStepLabel = highlightSubstitutionsInText(stepLabel, stepData.substitutions);

    const responseHtml = stepData.response ? (
        (stepData.type === 'command' || (stepData.response.body && typeof stepData.response.body.exitCode !== 'undefined'))
            ? (typeof renderCommandResultPanels === 'function'
                ? renderCommandResultPanels(stepData.response.body)
                : `<pre class="json-preview-code m-0 p-2 small" style="max-height: 400px; overflow-y: auto;">${escapeHtml(JSON.stringify(stepData.response.body, null, 2))}</pre>`)
            : `<pre class="json-preview-code m-0 p-2 small" style="max-height: 400px; overflow-y: auto;">${escapeHtml(JSON.stringify(stepData.response.body, null, 2))}</pre>`
    ) : '';

    // Build validation lines
    let validationLines = '';
    if (stepData.validations && stepData.validations.length > 0) {
        const validationParts = stepData.validations.map(v => {
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

        validationLines = validationParts.join('');
    }

    const hasDetails = stepData.request || stepData.response || stepData.skipReason || stepData.error;

    const stepHtml = `
        <div class="d-flex align-items-center gap-2 py-2 px-3 bg-${statusClass} bg-opacity-10 border border-${statusClass} rounded cli-step-line ${hasDetails ? 'cli-step-clickable' : ''}"
             ${hasDetails ? `
                role="button"
                data-bs-toggle="collapse"
                data-bs-target="#details${stepNumber}"
                aria-expanded="false"
                aria-controls="details${stepNumber}"
             ` : ''}>
            <span class="badge bg-secondary bg-opacity-75 me-1">#${stepNumber}</span>
            <span>${statusIcon}</span>
            <span class="flex-grow-1 small text-truncate" title="${escapeHtml(stepLabel)}">${displayStepLabel}</span>
            <span class="text-${statusClass} small fw-semibold">${statusText}</span>
            <span class="text-muted small">(${stepData.duration ? stepData.duration + 's' : '-'})</span>
            ${hasDetails ? `
                <i class="bi bi-chevron-down ms-2"></i>
            ` : ''}
        </div>
        ${validationLines}
        ${hasDetails ? `
            <div class="collapse" id="details${stepNumber}">
                <div class="card card-body mt-1 p-2">
                    ${stepData.name ? `<div class="fw-bold text-primary mb-2 pb-2 border-bottom"><i class="bi bi-tag me-1"></i>${escapeHtml(stepData.name)}</div>` : ''}
                    <div class="accordion accordion-flush" id="stepAccordion${stepNumber}">
                        ${stepData.request ? `
                            <div class="accordion-item">
                                <h2 class="accordion-header">
                                    <button class="accordion-button collapsed" type="button"
                                            data-bs-toggle="collapse" data-bs-target="#request${stepNumber}">
                                        <i class="bi bi-box-arrow-up-right me-2"></i> Request
                                    </button>
                                </h2>
                                <div id="request${stepNumber}" class="accordion-collapse collapse"
                                     data-bs-parent="#stepAccordion${stepNumber}">
                                    <div class="accordion-body p-0">
                                        <pre class="json-preview-code m-0 p-2 small">${highlightSubstitutionsInJSON(stepData.request, stepData.substitutions)}</pre>
                                    </div>
                                </div>
                            </div>
                        ` : ''}
                        ${stepData.response ? `
                            <div class="accordion-item">
                                <h2 class="accordion-header">
                                    <button class="accordion-button collapsed" type="button"
                                            data-bs-toggle="collapse" data-bs-target="#response${stepNumber}">
                                        <i class="bi bi-box-arrow-in-down-right me-2"></i> Response
                                    </button>
                                </h2>
                                <div id="response${stepNumber}" class="accordion-collapse collapse"
                                     data-bs-parent="#stepAccordion${stepNumber}">
                                    <div class="accordion-body p-0">
                                        ${responseHtml}
                                    </div>
                                </div>
                            </div>
                        ` : ''}
                    </div>
                    ${stepData.skipReason ? `
                        <div class="alert alert-warning mt-2 mb-0 small">
                            <i class="bi bi-info-circle me-1"></i>
                            <strong>Skipped:</strong> ${escapeHtml(stepData.skipReason)}
                        </div>
                    ` : ''}
                    ${stepData.error && !stepData.error.includes('validation failed') ? `
                        <div class="alert alert-danger mt-2 mb-0 small">
                            <i class="bi bi-exclamation-triangle me-1"></i>
                            <strong>Error:</strong> ${escapeHtml(stepData.error)}
                        </div>
                    ` : ''}
                </div>
            </div>
        ` : ''}
    `;

    // Replace placeholder content
    placeholder.innerHTML = stepHtml;
}

/**
 * Show a placeholder for a step waiting for user input
 * User must click to proceed - useful when previous step opened browser for OAuth
 */
function showInputPendingPlaceholder(stepData, stepNumber, totalSteps) {
    return new Promise((resolve) => {
        // Store resolve function globally so stopExecution can unblock it
        pendingPlaceholderResolve = resolve;

        const container = document.getElementById('flowStepsContainer');
        if (!container) {
            pendingPlaceholderResolve = null;
            resolve();
            return;
        }

        // Check if placeholder already exists (from a previous loop iteration)
        let btn = document.getElementById(`inputPendingBtn-${stepNumber}`);

        if (!btn) {
            // Create placeholder if it doesn't exist
            const placeholderHtml = `
                <div class="step-card-animated mb-2" id="step-${stepNumber}">
                    <div class="d-flex align-items-center gap-2 py-3 px-3 bg-warning bg-opacity-10 border border-warning rounded cursor-pointer user-select-none"
                         role="button"
                         id="inputPendingBtn-${stepNumber}"
                         style="cursor: pointer; transition: all 0.2s;">
                        <i class="bi bi-hand-index-thumb text-warning fs-5"></i>
                        <div class="flex-grow-1">
                            <div class="fw-bold">
                                <i class="bi bi-pencil-square me-1"></i>
                                ${escapeHtml(stepData.name)}
                            </div>
                            <div class="small text-muted mt-1">
                                <i class="bi bi-info-circle me-1"></i>
                                User input required. Click here when ready to provide input.
                            </div>
                        </div>
                        <span class="badge bg-warning text-dark">Click to Continue</span>
                        <i class="bi bi-chevron-right ms-2"></i>
                    </div>
                </div>
            `;

            container.insertAdjacentHTML('afterbegin', placeholderHtml);

            // Scroll to placeholder (at top)
            const placeholder = document.getElementById(`step-${stepNumber}`);
            if (placeholder) {
                placeholder.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }

            btn = document.getElementById(`inputPendingBtn-${stepNumber}`);
        }

        if (btn) {
            // Re-enable button if it was disabled from a previous click
            btn.style.opacity = '1';
            btn.style.pointerEvents = 'auto';
            btn.style.transform = 'scale(1)';

            // Remove old event listeners by cloning the button
            const newBtn = btn.cloneNode(true);
            btn.parentNode.replaceChild(newBtn, btn);
            btn = newBtn;

            // Hover effect
            btn.addEventListener('mouseenter', () => {
                btn.style.transform = 'scale(1.02)';
                btn.style.boxShadow = '0 4px 8px rgba(0,0,0,0.1)';
            });
            btn.addEventListener('mouseleave', () => {
                btn.style.transform = 'scale(1)';
                btn.style.boxShadow = 'none';
            });

            // Click handler
            btn.addEventListener('click', () => {
                // Add visual feedback
                btn.style.opacity = '0.6';
                btn.style.pointerEvents = 'none';
                btn.style.transform = 'scale(1)';
                pendingPlaceholderResolve = null;
                resolve();
            });
        } else {
            pendingPlaceholderResolve = null;
            resolve();
        }
    });
}

/**
 * Show a placeholder for a step waiting for user input (non-blocking version)
 * Just shows the placeholder, doesn't wait for click
 */
function showInputPendingPlaceholderNonBlocking(stepData, stepNumber, totalSteps) {
    const container = document.getElementById('flowStepsContainer');
    if (!container) return;

    // Check if placeholder already exists
    let existingPlaceholder = document.getElementById(`step-${stepNumber}`);
    if (existingPlaceholder) {
        // Already shown, just make sure it's clickable
        const btn = document.getElementById(`inputPendingBtn-${stepNumber}`);
        if (btn) {
            btn.style.opacity = '1';
            btn.style.pointerEvents = 'auto';
        }
        return;
    }

    // Create placeholder
    const placeholderHtml = `
        <div class="step-card-animated mb-2" id="step-${stepNumber}">
            <div class="d-flex align-items-center gap-2 py-3 px-3 bg-warning bg-opacity-10 border border-warning rounded cursor-pointer user-select-none"
                 role="button"
                 id="inputPendingBtn-${stepNumber}"
                 style="cursor: pointer; transition: all 0.2s;">
                <i class="bi bi-hand-index-thumb text-warning fs-5"></i>
                <div class="flex-grow-1">
                    <div class="fw-bold">
                        <i class="bi bi-pencil-square me-1"></i>
                        ${escapeHtml(stepData.name)}
                    </div>
                    <div class="small text-muted mt-1">
                        <i class="bi bi-info-circle me-1"></i>
                        User input required
                    </div>
                </div>
                <span class="badge bg-warning text-dark">Awaiting Input</span>
            </div>
        </div>
    `;

    container.insertAdjacentHTML('afterbegin', placeholderHtml);

    // Scroll to placeholder
    const placeholder = document.getElementById(`step-${stepNumber}`);
    if (placeholder) {
        placeholder.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

/**
 * Remove the input pending placeholder
 */
function removeInputPendingPlaceholder(stepNumber) {
    const placeholder = document.getElementById(`step-${stepNumber}`);
    if (placeholder) {
        placeholder.remove();
    }
}

/**
 * Update modal with final summary - keeps steps visible
 */
function updateModalWithSummary(result) {
    // Progress indicator handles the completion status
    // Just update modal title with branded message
    if (result.success) {
        // Stage 4: Flow Success - "Flow complete — precision achieved."
        setModalTitle('<em>Flow</em> Complete', 'Precision Achieved');
    } else {
        // Stage 5: Flow Failure - "Flow interrupted — integrity check required."
        setModalTitle('<em>Flow</em> Interrupted', 'Integrity Check Required');
    }

    // flowStepsContainer already has all the steps visible
}

/**
 * Show execution error in modal - keeps steps visible
 */
function showExecutionError(error) {
    // Progress indicator handles the error status
    // Just update modal title with branded message
    // Stage 5: Flow Failure - "Flow interrupted — integrity check required."
    setModalTitle('<em>Flow</em> Interrupted', 'Integrity Check Required');

    // Error is already shown in the failed step card, no need for duplicate alert
}

/**
 * Display execution results in the modal
 */
function displayExecutionResults(result) {
    const modalBody = document.getElementById('resultsModalBody');

    // Summary
    const summaryClass = result.success ? 'alert-success' : 'alert-danger';
    const summaryIcon = result.success ? '✅' : '❌';
    let html = `
        <div class="alert ${summaryClass} d-flex align-items-center gap-2 mb-3">
            <span style="font-size: 1.5rem;">${summaryIcon}</span>
            <div>
                <strong>${result.success ? 'Sequence Completed Successfully' : 'Sequence Failed'}</strong>
                <div class="small">
                    ${result.stepsExecuted} executed, ${result.stepsSkipped} skipped${result.stepsFailed > 0 ? `, ${result.stepsFailed} failed` : ''}
                </div>
            </div>
        </div>
    `;

    // Execution log
    if (result.executionLog && result.executionLog.length > 0) {
        html += '<div class="execution-log">';

        result.executionLog.forEach((log, index) => {
            const statusClass = log.status === 'completed' ? 'success' :
                              log.status === 'skipped' ? 'warning' : 'danger';
            const statusIcon = log.status === 'completed' ? '✅' :
                             log.status === 'skipped' ? '⊘' : '❌';
            const stepLabel = formatStepLabel(log);
            const responseHtml = log.response ? (
                (log.type === 'command' || (log.response.body && typeof log.response.body.exitCode !== 'undefined'))
                    ? (typeof renderCommandResultPanels === 'function'
                        ? renderCommandResultPanels(log.response.body)
                        : `<pre class="json-preview-code m-0 p-3 small" style="max-height: 400px; overflow-y: auto;">${JSON.stringify(log.response.body, null, 2)}</pre>`)
                    : `<pre class="json-preview-code m-0 p-3 small" style="max-height: 400px; overflow-y: auto;">${JSON.stringify(log.response.body, null, 2)}</pre>`
            ) : '';

            html += `
                <div class="card mb-2">
                    <div class="card-header bg-${statusClass} bg-opacity-10 border-${statusClass}">
                        <div class="d-flex justify-content-between align-items-center">
                            <strong>${statusIcon} ${log.name ? escapeHtml(log.name) : escapeHtml(stepLabel)}</strong>
                            <small class="text-muted">${log.duration}s</small>
                        </div>
                        ${log.name ? `<div class="small text-muted mt-1">
                            ${escapeHtml(stepLabel)}
                        </div>` : ''}
                    </div>
                    <div class="card-body">
                        <div class="accordion" id="stepAccordion${index}">
            `;

            // Request details
            if (log.request) {
                html += `
                    <div class="accordion-item">
                        <h2 class="accordion-header">
                            <button class="accordion-button collapsed" type="button"
                                    data-bs-toggle="collapse" data-bs-target="#request${index}">
                                <i class="bi bi-box-arrow-up-right me-2"></i> Request
                            </button>
                        </h2>
                        <div id="request${index}" class="accordion-collapse collapse"
                             data-bs-parent="#stepAccordion${index}">
                            <div class="accordion-body p-0">
                                <pre class="json-preview-code m-0 p-3 small">${JSON.stringify(log.request, null, 2)}</pre>
                            </div>
                        </div>
                    </div>
                `;
            }

            // Response details
            if (log.response) {
                html += `
                    <div class="accordion-item">
                        <h2 class="accordion-header">
                            <button class="accordion-button" type="button"
                                    data-bs-toggle="collapse" data-bs-target="#response${index}">
                                <i class="bi bi-box-arrow-in-down-right me-2"></i> Response (Status: ${log.response.status})
                            </button>
                        </h2>
                        <div id="response${index}" class="accordion-collapse collapse show"
                             data-bs-parent="#stepAccordion${index}">
                            <div class="accordion-body p-0">
                                ${responseHtml}
                            </div>
                        </div>
                    </div>
                `;
            }

            // Skip reason
            if (log.skipReason) {
                html += `
                    <div class="alert alert-warning mt-2 mb-0 small">
                        <i class="bi bi-info-circle me-1"></i>
                        <strong>Skipped:</strong> ${escapeHtml(log.skipReason)}
                    </div>
                `;
            }

            // Error
            if (log.error) {
                html += `
                    <div class="alert alert-danger mt-2 mb-0 small">
                        <i class="bi bi-exclamation-triangle me-1"></i>
                        <strong>Error:</strong> ${escapeHtml(log.error)}
                    </div>
                `;
            }

            html += `
                        </div>
                    </div>
                </div>
            `;
        });

        html += '</div>';
    }

    modalBody.innerHTML = html;
}

/**
 * Create results modal
 */
function createResultsModal() {
    const modalHtml = `
        <div class="modal fade" id="resultsModal" tabindex="-1" aria-labelledby="resultsModalLabel" aria-hidden="true">
            <div class="modal-dialog modal-xl modal-dialog-scrollable">
                <div class="modal-content">
                    <div class="modal-header flex-column align-items-stretch">
                        <!-- Row 1: Progress bar (full width) -->
                        <div class="d-flex align-items-center gap-3 w-100" id="progressBarContainer" style="display: none;">
                            <div class="flex-grow-1">
                                <div class="progress" style="height: 8px;">
                                    <div id="progressBar" class="progress-bar progress-bar-striped progress-bar-animated" role="progressbar" style="width: 0%"></div>
                                </div>
                            </div>
                            <span id="progressSteps" class="text-muted small"></span>
                        </div>
                        <!-- Row 2: Icon + Title (full width) -->
                        <div class="d-flex align-items-center w-100 mt-2">
                            <span id="progressIcon"></span>
                            <h5 class="modal-title mb-0 ms-2" id="resultsModalLabel">Flow Monitor</h5>
                        </div>
                        <!-- Row 3: Subtitle (full width) -->
                        <div class="text-muted small mt-1" id="resultsModalSubtitle" style="display: none;"></div>
                    </div>
                    <div class="modal-body" id="resultsModalBody" style="height: 60vh; overflow-y: auto;">
                        <!-- Results will be inserted here -->
                    </div>
                    <div class="modal-footer">
                        <!-- Execution control buttons -->
                        <button type="button" class="btn btn-danger" id="stopExecutionBtn" style="display: none;" onclick="stopExecution()">
                            <i class="bi bi-stop-circle"></i> Interrupt the <em>Flow</em>
                        </button>
                        <!-- Post-execution buttons -->
                        <button type="button" class="btn btn-primary" id="saveLogsBtn" style="display: none;" onclick="saveLogs()">
                            <i class="bi bi-file-earmark-arrow-down"></i> <span id="saveLogsBtnText">Save Execution Logs</span>
                        </button>
                        <button type="button" class="btn btn-success" id="rerunBtn" style="display: none;" onclick="rerunSequence()">
                            <i class="bi bi-arrow-repeat" id="rerunBtnIcon"></i> <span id="rerunBtnText">Re-Engage Flow</span>
                        </button>
                        <button type="button" class="btn btn-secondary" id="closeMonitorBtn" data-bs-dismiss="modal">
                            <i class="bi bi-door-closed"></i> Close Monitor
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);
}

/**
 * Show alert message
 */
function showAlert(type, message) {
    // Create a simple alert (can be enhanced with Bootstrap toast)
    const alertClass = type === 'error' ? 'alert-danger' :
                      type === 'success' ? 'alert-success' :
                      type === 'warning' ? 'alert-warning' : 'alert-info';

    const alertId = `alert-${Date.now()}`;
    const alertHtml = `
        <div id="${alertId}" class="alert ${alertClass} alert-dismissible fade show position-fixed top-0 start-50 translate-middle-x mt-3"
             style="z-index: 9999; max-width: 500px;" role="alert">
            ${escapeHtml(message)}
            <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', alertHtml);

    // Auto-dismiss this specific alert after 3 seconds
    setTimeout(() => {
        const alert = document.getElementById(alertId);
        if (alert && alert.classList.contains('show')) {
            const bsAlert = bootstrap.Alert.getInstance(alert);
            if (bsAlert) {
                bsAlert.close();
            }
        }
    }, 3000);
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
    if (typeof text !== 'string') return text;
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Get CSS class and label for substitution type
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

    // First, escape the entire text
    let escapedText = escapeHtml(text);

    // Create a map of values to their substitution info
    const valueMap = new Map();
    substitutions.forEach(sub => {
        const key = String(sub.value);
        if (!valueMap.has(key)) {
            valueMap.set(key, []);
        }
        valueMap.get(key).push(sub);
    });

    // Build array of replacements with their positions
    const replacements = [];

    // Sort by value length (longest first) to avoid partial replacements
    const sortedValues = Array.from(valueMap.keys()).sort((a, b) => b.length - a.length);

    for (const value of sortedValues) {
        const subs = valueMap.get(value);
        const sub = subs[0]; // Use first substitution info
        const { typeClass, typeLabel } = getSubstitutionStyle(sub.type);

        // Escape value for searching in the already-escaped text
        const escapedValue = escapeHtml(String(value));

        // Find all occurrences
        let startIndex = 0;
        while (true) {
            const index = escapedText.indexOf(escapedValue, startIndex);
            if (index === -1) break;

            // Check if this position is already covered by a previous replacement
            const isCovered = replacements.some(r =>
                index >= r.start && index < r.end
            );

            if (!isCovered) {
                replacements.push({
                    start: index,
                    end: index + escapedValue.length,
                    value: escapedValue,
                    html: `<span class="json-substitution ${typeClass}" data-original="${escapeHtml(sub.original)}" data-type="${typeLabel}" title="${typeLabel}: ${escapeHtml(sub.original)}">${escapedValue}</span>`
                });
            }

            startIndex = index + escapedValue.length;
        }
    }

    // Sort replacements by start position (reverse order for easier replacement)
    replacements.sort((a, b) => b.start - a.start);

    // Apply replacements from end to start to preserve positions
    let result = escapedText;
    for (const replacement of replacements) {
        result = result.substring(0, replacement.start) +
                 replacement.html +
                 result.substring(replacement.end);
    }

    return result;
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
 * Show a clickable placeholder step card for a node that requires user input
 * (Used by Step-by-Step and Auto-Step modes before showing input modal)
 */
function showInputRequiredPlaceholder(stepResult, stepNumber, totalSteps) {
    const container = document.getElementById('flowStepsContainer');
    if (!container) return;

    // Check if step card already exists - if so, just make it clickable again
    let existingStep = document.getElementById(`step-${stepNumber}`);
    if (existingStep) {
        // Update to clickable state
        const btn = document.getElementById(`inputPendingBtn-${stepNumber}`);
        if (btn) {
            btn.style.cursor = 'pointer';
            btn.style.pointerEvents = 'auto';
        }
        return;
    }

    // Create clickable step card showing the node requesting input
    const placeholderHtml = `
        <div class="step-card-animated mb-2" id="step-${stepNumber}">
            <div class="d-flex align-items-center gap-2 py-3 px-3 bg-warning bg-opacity-10 border border-warning rounded cursor-pointer user-select-none"
                 role="button"
                 id="inputPendingBtn-${stepNumber}"
                 style="cursor: pointer; transition: all 0.2s;">
                <i class="bi bi-hand-index-thumb text-warning fs-5"></i>
                <div class="flex-grow-1">
                    <div class="fw-bold">
                        <i class="bi bi-pencil-square me-1"></i>
                        ${escapeHtml(stepResult.name || `Step ${stepNumber}`)}
                    </div>
                    <div class="small text-muted mt-1">
                        <i class="bi bi-info-circle me-1"></i>
                        User input required. Click here when ready to provide input.
                    </div>
                </div>
                <span class="badge bg-warning text-dark">Click to Continue</span>
                <i class="bi bi-chevron-right ms-2"></i>
            </div>
        </div>
    `;

    container.insertAdjacentHTML('afterbegin', placeholderHtml);

    // Scroll to placeholder
    const placeholder = document.getElementById(`step-${stepNumber}`);
    if (placeholder) {
        placeholder.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

/**
 * Wait for user to click the input placeholder (Step-by-Step and Auto-Step modes)
 */
function waitForPlaceholderClick() {
    return new Promise((resolve) => {
        // Store resolve function globally so stopExecution can unblock it
        pendingPlaceholderResolve = resolve;

        // Find all input pending buttons and add click handler
        const buttons = document.querySelectorAll('[id^="inputPendingBtn-"]');
        buttons.forEach(btn => {
            btn.onclick = () => {
                console.log('[Flow Runner] Input placeholder clicked');
                pendingPlaceholderResolve = null;
                resolve();
            };

            // Add hover effect
            btn.onmouseenter = () => {
                btn.style.backgroundColor = 'rgba(255, 193, 7, 0.2)';
            };
            btn.onmouseleave = () => {
                btn.style.backgroundColor = '';
            };
        });
    });
}

/**
 * Collect user input for a single step
 * Shows a modal with prompts for the specified step only
 * @param {Object} stepData - Step data including executionId, stepIndex, step, name, and prompts
 * @returns {Object|null} - Object with user input values, or null if cancelled
 */
async function collectUserInputForStep(stepData) {
    return new Promise((resolve) => {
        // Create modal HTML
        const modalId = 'userInputModal';
        let existingModal = document.getElementById(modalId);
        if (existingModal) {
            existingModal.remove();
        }

        let formHtml = '';
        Object.entries(stepData.prompts).forEach(([key, prompt]) => {
            const inputId = `input_${key}`;
            formHtml += `
                <div class="mb-3">
                    <label for="${inputId}" class="form-label">
                        ${escapeHtml(prompt)}
                    </label>
                    <input type="text" class="form-control" id="${inputId}"
                           data-prompt-key="${key}"
                           placeholder="Enter ${escapeHtml(key)}"
                           required>
                </div>
            `;
        });

        const modalHtml = `
            <div class="modal fade" id="${modalId}" tabindex="-1">
                <div class="modal-dialog modal-dialog-centered">
                    <div class="modal-content">
                        <div class="modal-header bg-primary bg-opacity-10">
                            <div>
                                <h5 class="modal-title mb-0">
                                    <i class="bi bi-sliders me-2"></i>
                                    Node Calibration Required
                                </h5>
                                <div class="text-muted small mt-1">Manual input needed to proceed with flow execution.</div>
                            </div>
                            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                        </div>
                        <div class="modal-body">
                            <form id="userInputForm">
                                ${formHtml}
                            </form>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">
                                <i class="bi bi-x-circle me-1"></i>
                                Cancel Calibration
                            </button>
                            <button type="button" class="btn btn-primary" id="submitUserInputBtn">
                                <i class="bi bi-check2-circle me-1"></i>
                                Apply &amp; Engage
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHtml);

        const modal = document.getElementById(modalId);
        const bootstrapModal = window.configureModal(modal);

        let submittedInput = null;

        // Function to collect and submit input
        const submitInput = () => {
            // Collect input values
            const userInput = {};
            const inputs = document.querySelectorAll('#userInputForm input');

            inputs.forEach(input => {
                const promptKey = input.dataset.promptKey;
                const value = input.value.trim();
                userInput[promptKey] = value;
            });

            submittedInput = userInput;
            bootstrapModal.hide();
        };

        // Handle form submit (Enter key in input)
        document.getElementById('userInputForm').addEventListener('submit', (e) => {
            e.preventDefault(); // CRITICAL: Prevent form submission/page reload
            submitInput();
        });

        // Handle button click
        document.getElementById('submitUserInputBtn').addEventListener('click', () => {
            submitInput();
        });

        // Handle modal being closed (via submit, X button, Esc, or clicking outside)
        modal.addEventListener('hidden.bs.modal', () => {
            modal.remove();
            // If submittedInput is set, user clicked Continue; otherwise they closed without submitting
            resolve(submittedInput);
        }, { once: true });

        // Show modal
        bootstrapModal.show();

        // Focus first input
        modal.addEventListener('shown.bs.modal', () => {
            const firstInput = modal.querySelector('input');
            if (firstInput) {
                firstInput.focus();
            }
        }, { once: true });

        // Handle Enter key to submit
        modal.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                document.getElementById('submitUserInputBtn').click();
            }
        });
    });
}

/**
 * Handle browser launch for a step
 * Opens URL in a modal with iframe
 * @param {Object} stepData - The step data containing response and launchBrowser config
 */
function handleBrowserLaunch(stepData) {
    try {
        console.log('Browser launch requested:', stepData.launchBrowser);
        console.log('Response body:', stepData.response.body);

        // Extract URL from response using launchBrowser path
        const url = extractValueFromPath(stepData.response.body, stepData.launchBrowser);

        console.log('Extracted URL:', url);

        if (!url) {
            showAlert('warning', `Browser launch failed: Could not extract URL from path "${stepData.launchBrowser}"`);
            return;
        }

        if (typeof url !== 'string') {
            showAlert('warning', `Browser launch failed: Extracted value is not a string (got ${typeof url})`);
            return;
        }

        // Validate URL format
        let fullUrl = url;
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            // Try adding https:// if missing
            fullUrl = 'https://' + url;
            console.log('Added https:// protocol, full URL:', fullUrl);
        }

        console.log('Opening URL in modal iframe:', fullUrl);

        // Create or get browser modal
        let modal = document.getElementById('browserLaunchModal');
        if (!modal) {
            const modalHtml = `
                <div class="modal fade" id="browserLaunchModal" tabindex="-1" aria-labelledby="browserLaunchModalLabel" aria-hidden="true">
                    <div class="modal-dialog modal-xl modal-fullscreen-lg-down">
                        <div class="modal-content">
                            <div class="modal-header">
                                <h5 class="modal-title" id="browserLaunchModalLabel">
                                    <i class="bi bi-window me-2"></i>
                                    <span id="browserLaunchModalTitle">Browser View</span>
                                </h5>
                                <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                            </div>
                            <div class="modal-body p-0" style="height: 80vh;">
                                <div id="browserIframeContainer" style="width: 100%; height: 100%; position: relative;">
                                    <div class="d-flex justify-content-center align-items-center" style="height: 100%;">
                                        <div class="spinner-border text-primary" role="status">
                                            <span class="visually-hidden">Loading...</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div class="modal-footer">
                                <a id="browserLaunchExternalLink" href="" target="_blank" class="btn btn-sm btn-outline-primary me-auto">
                                    <i class="bi bi-box-arrow-up-right me-1"></i>
                                    Open in New Tab
                                </a>
                                <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
                            </div>
                        </div>
                    </div>
                </div>
            `;
            document.body.insertAdjacentHTML('beforeend', modalHtml);
            modal = document.getElementById('browserLaunchModal');
        }

        // Update modal content
        const modalTitle = document.getElementById('browserLaunchModalTitle');
        const iframeContainer = document.getElementById('browserIframeContainer');
        const externalLink = document.getElementById('browserLaunchExternalLink');

        // Truncate URL for display
        const displayUrl = url.length > 60 ? url.substring(0, 57) + '...' : url;
        modalTitle.textContent = displayUrl;
        externalLink.href = fullUrl;

        // Create iframe with loading spinner
        iframeContainer.innerHTML = `
            <div class="position-absolute top-50 start-50 translate-middle text-center" id="iframeSpinner" style="max-width: 400px;">
                <div class="spinner-border text-primary mb-3" role="status">
                    <span class="visually-hidden">Loading...</span>
                </div>
                <div class="small text-muted">Loading page...</div>
                <div class="small text-muted mt-2">If page doesn't load, click "Open in New Tab" below</div>
            </div>
            <iframe
                id="browserIframe"
                src="${escapeHtml(fullUrl)}"
                style="width: 100%; height: 100%; border: none; display: none;"
                sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
                referrerpolicy="no-referrer"
            ></iframe>
        `;

        // Handle iframe load
        const iframe = document.getElementById('browserIframe');
        const spinner = document.getElementById('iframeSpinner');
        let loadTimeout;

        // Set timeout to detect if iframe doesn't load (X-Frame-Options, CSP, etc.)
        loadTimeout = setTimeout(() => {
            // If spinner still exists after 3 seconds, assume iframe is blocked
            if (spinner && spinner.parentNode) {
                spinner.innerHTML = `
                    <div class="alert alert-warning text-start">
                        <i class="bi bi-exclamation-triangle me-2"></i>
                        <strong>Cannot display page in iframe</strong><br>
                        <small class="d-block mt-2">
                            This website prevents embedding for security reasons (X-Frame-Options or CSP policy).
                        </small>
                        <button class="btn btn-primary btn-sm mt-3" onclick="document.getElementById('browserLaunchExternalLink').click()">
                            <i class="bi bi-box-arrow-up-right me-1"></i>
                            Open in New Tab
                        </button>
                    </div>
                `;
            }
        }, 3000);

        iframe.onload = () => {
            clearTimeout(loadTimeout);
            // Check if iframe loaded successfully by trying to access it
            try {
                // If we can access contentWindow, iframe loaded
                if (iframe.contentWindow) {
                    if (spinner) spinner.remove();
                    iframe.style.display = 'block';
                }
            } catch (e) {
                // Cross-origin iframe, but it loaded
                if (spinner) spinner.remove();
                iframe.style.display = 'block';
            }
        };

        // Handle iframe error
        iframe.onerror = () => {
            clearTimeout(loadTimeout);
            if (spinner) {
                spinner.innerHTML = `
                    <div class="alert alert-danger text-start">
                        <i class="bi bi-exclamation-triangle me-2"></i>
                        <strong>Failed to load page</strong><br>
                        <small class="d-block mt-2">
                            The page could not be loaded. This may be due to network issues or security restrictions.
                        </small>
                        <button class="btn btn-primary btn-sm mt-3" onclick="document.getElementById('browserLaunchExternalLink').click()">
                            <i class="bi bi-box-arrow-up-right me-1"></i>
                            Open in New Tab
                        </button>
                    </div>
                `;
            }
        };

        // Show modal
        const bootstrapModal = bootstrap.Modal.getOrCreateInstance(modal);
        bootstrapModal.show();

    } catch (error) {
        console.error('Browser launch error:', error);
        showAlert('error', `Failed to launch browser: ${error.message}`);
    }
}

/**
 * Extract value from object using JSON path notation
 * Supports: .field, .field.subfield, .array[0], .array[0].field
 * @param {Object} obj - The object to extract from
 * @param {string} path - The JSON path (e.g., ".token", ".user.id", ".items[0].name")
 * @returns {*} - The extracted value or null if not found
 */
function extractValueFromPath(obj, path) {
    if (!obj || !path) return null;

    // Remove leading dot if present
    let cleanPath = path.startsWith('.') ? path.substring(1) : path;

    // Split by dots, but handle array notation
    const parts = cleanPath.split(/\.(?![^\[]*\])/);

    let current = obj;
    for (const part of parts) {
        if (!current) return null;

        // Handle array notation: items[0]
        const arrayMatch = part.match(/^(\w+)\[(\d+)\]$/);
        if (arrayMatch) {
            const [, arrayName, index] = arrayMatch;
            current = current[arrayName];
            if (Array.isArray(current)) {
                current = current[parseInt(index)];
            } else {
                return null;
            }
        } else {
            current = current[part];
        }
    }

    return current;
}

/**
 * Show Save Logs and Re-run buttons after execution completes
 */
function showPostExecutionButtons(success = true) {
    const saveLogsBtn = document.getElementById('saveLogsBtn');
    const saveLogsBtnText = document.getElementById('saveLogsBtnText');
    const rerunBtn = document.getElementById('rerunBtn');
    const rerunBtnText = document.getElementById('rerunBtnText');
    const rerunBtnIcon = document.getElementById('rerunBtnIcon');

    // Update button text and icons based on success/failure
    if (success) {
        // Stage 4: Flow Success
        if (saveLogsBtnText) saveLogsBtnText.textContent = 'Save Execution Logs';
        if (rerunBtnText) rerunBtnText.innerHTML = '<em>Flow</em> once again';
        if (rerunBtnIcon) rerunBtnIcon.className = 'bi bi-arrow-repeat';
    } else {
        // Stage 5: Flow Failure
        if (saveLogsBtnText) saveLogsBtnText.textContent = 'Save Failure Logs';
        if (rerunBtnText) rerunBtnText.innerHTML = '<em>Flow</em> once again';
        if (rerunBtnIcon) rerunBtnIcon.className = 'bi bi-arrow-clockwise';
    }

    if (saveLogsBtn) saveLogsBtn.style.display = 'inline-block';
    if (rerunBtn) rerunBtn.style.display = 'inline-block';
}

/**
 * Hide post-execution buttons (when starting new run)
 */
function hidePostExecutionButtons() {
    const saveLogsBtn = document.getElementById('saveLogsBtn');
    const rerunBtn = document.getElementById('rerunBtn');

    if (saveLogsBtn) saveLogsBtn.style.display = 'none';
    if (rerunBtn) rerunBtn.style.display = 'none';
}

/**
 * Save execution logs using the API (uses existing logger module)
 * Also triggers browser download of the log file
 */
async function saveLogs() {
    if (!lastExecutionLog || lastExecutionLog.length === 0) {
        showAlert('warning', 'No execution logs available to save.');
        return;
    }

    try {
        // Save to server using API (with full execution result for metadata)
        const response = await fetch('/api/save-log', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                executionLog: lastExecutionLog,
                executionResult: lastExecutionResult || {}
            })
        });

        const result = await response.json();

        if (result.success) {
            // Download the formatted log (server returns the formatted content)
            if (result.logContent) {
                const blob = new Blob([result.logContent], { type: 'application/json' });
                const url = URL.createObjectURL(blob);

                // Create temporary anchor and click it
                const a = document.createElement('a');
                a.href = url;
                a.download = result.filename;
                document.body.appendChild(a);
                a.click();

                // Clean up
                document.body.removeChild(a);
                URL.revokeObjectURL(url);

                showAlert('success', `Logs downloaded as: ${result.filename}`);
            } else {
                showAlert('success', `Logs saved to server: ${result.filename}`);
            }
        } else {
            showAlert('error', `Failed to save logs: ${result.error}`);
        }
    } catch (error) {
        showAlert('error', `Failed to save logs: ${error.message}`);
    }
}

/**
 * Re-run the current sequence
 */
function rerunSequence() {
    // Close the modal
    const modal = document.getElementById('resultsModal');
    if (modal) {
        const bootstrapModal = bootstrap.Modal.getInstance(modal);
        if (bootstrapModal) {
            bootstrapModal.hide();
        }
    }

    // Small delay to let modal close, then run again with the same execution mode
    setTimeout(() => {
        // Reuse the last selected execution mode instead of showing selector
        if (executionMode === 'step-by-step') {
            runSequenceStepByStep();
        } else if (executionMode === 'auto-step') {
            runSequenceAutoStep();
        } else {
            runSequenceFullSpeed();
        }
    }, 300);
}

/**
 * Main entry point for running a sequence
 * Shows execution mode selector modal first
 */
function runSequence() {
    showExecutionModeSelector();
}

/**
 * Run sequence in Step-by-Step mode with manual continue between steps
 * Phase 2 implementation
 */
async function runSequenceStepByStep() {
    // Declare executionLog at function scope so catch block can access it
    let executionLog = [];

    try {
        // Get current config from state
        const config = getCurrentConfig();

        if (!config || !config.nodes || config.nodes.length === 0) {
            showAlert('error', 'No nodes to execute. Please add at least one node to your configuration.');
            return;
        }

        // Validate config before execution
        try {
            const validationResponse = await fetch('/api/validate', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ config: config })
            });

            if (!validationResponse.ok) {
                throw new Error(`Validation request failed: ${validationResponse.statusText}`);
            }

            const validationResult = await validationResponse.json();

            // If validation failed, show errors and abort execution
            if (!validationResult.valid) {
                console.log('[Flow Runner] Validation failed, aborting execution');

                // Show validation modal with errors (non-silent mode)
                if (typeof showConfigValidationResults === 'function') {
                    showConfigValidationResults(validationResult);
                } else {
                    // Fallback: show basic alert
                    const errorCount = validationResult.errors.length;
                    showAlert('error', `Config validation failed with ${errorCount} error${errorCount > 1 ? 's' : ''}. Please fix the errors before running.`);
                }
                return; // Abort execution
            }

            console.log('[Flow Runner] Validation passed, proceeding with step-by-step execution');
        } catch (validationError) {
            console.error('[Flow Runner] Validation error:', validationError);
            showAlert('error', `Failed to validate config: ${validationError.message}`);
            return; // Abort execution
        }

        // Reset state for new execution
        currentStepNumber = 0;
        totalStepsCount = config.nodes.length;
        stopRequested = false;
        continueRequested = false;
        pendingContinueResolve = null;
        executionLog = [];

        // Hide post-execution buttons
        hidePostExecutionButtons();

        // Open modal immediately with loading state
        showLoadingModal(config.nodes.length);

        // Update to running state
        updateRunButton('running');

        // Show stop button and hide close button during execution
        showStopButton();
        hideCloseMonitorButton();

        // Step-by-step execution: call server endpoint for each step
        const responses = [];
        let userInput = {}; // Persistent across steps

        for (let i = 0; i < config.nodes.length; i++) {
            // Check if stop was requested
            if (stopRequested) {
                console.log('[Flow Runner] Stop requested at step', i + 1);
                break;
            }

            const stepNumber = i + 1;
            currentStepNumber = stepNumber;

            // Call /api/execute-step endpoint for this single step
            try {
                const response = await fetch('/api/execute-step', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        config: config,
                        stepIndex: i,
                        responses: responses,
                        userInput: userInput
                    })
                });

                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }

                const stepResult = await response.json();

                // Handle input required
                if (stepResult.inputRequired) {
                    // Update UI to show awaiting input state
                    // Show completed steps count (this step is awaiting, not executed yet)
                    setModalTitle('<em>Flow</em> Paused', 'Awaiting User Calibration');
                    updateProgressIndicator('paused', i, totalStepsCount);

                    // Loop until user provides input or stops execution
                    let newInput = null;
                    let firstAttempt = true;
                    while (!newInput && !stopRequested) {
                        if (firstAttempt) {
                            // First attempt: show placeholder and auto-open modal
                            showInputRequiredPlaceholder(stepResult, stepNumber, totalStepsCount);
                            console.log('[Flow Runner] Auto-opening input modal...');
                            firstAttempt = false;
                        } else {
                            // Subsequent attempts: wait for user to click placeholder
                            await waitForPlaceholderClick();

                            // Check if stop was requested during wait
                            if (stopRequested) {
                                console.log('[Flow Runner] Stop requested while waiting for placeholder click');
                                break;
                            }

                            console.log('[Flow Runner] Placeholder clicked, opening modal...');
                        }

                        // Check if stop was requested before showing modal
                        if (stopRequested) {
                            break;
                        }

                        // Collect user input
                        newInput = await collectUserInputForStep({
                            executionId: `step-${i}`,
                            stepIndex: i,
                            step: stepNumber,
                            name: stepResult.name || config.nodes[i].name,
                            prompts: stepResult.prompts
                        });

                        // If modal was closed without submitting (returns null), loop again
                        if (!newInput && !stopRequested) {
                            console.log('[Flow Runner] Input modal closed without submitting, click placeholder when ready...');
                        }
                    }

                    if (stopRequested) {
                        console.log('[Flow Runner] Stop requested during input collection');
                        break;
                    }

                    // Restore executing state after input collected
                    setModalTitle('<em>Flow</em> in Motion', 'Executing nodes sequentially');
                    updateProgressIndicator('running', stepNumber, totalStepsCount);

                    // Merge user input
                    userInput = { ...userInput, ...newInput };

                    // Re-execute step with user input
                    const retryResponse = await fetch('/api/execute-step', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            config: config,
                            stepIndex: i,
                            responses: responses,
                            userInput: userInput
                        })
                    });

                    if (!retryResponse.ok) {
                        throw new Error(`HTTP error! status: ${retryResponse.status}`);
                    }

                    const retryResult = await retryResponse.json();
                    Object.assign(stepResult, retryResult);
                }

                // Store response
                if (stepResult.response) {
                    responses.push({
                        id: config.nodes[i].id,
                        status: stepResult.response.status,
                        body: stepResult.response.body
                    });
                }

                // Add to execution log
                executionLog.push(stepResult);

                // Display step result (replace placeholder if user input was collected)
                replaceStepPlaceholder(stepResult, stepNumber, totalStepsCount);
                updateProgressIndicator('running', stepNumber, totalStepsCount);

                // Handle browser launch
                if (stepResult.status === 'completed' && stepResult.launchBrowser && stepResult.response) {
                    handleBrowserLaunch(stepResult);
                }

                // Check if step failed
                if (stepResult.status === 'failed') {
                    // Show error and stop
                    lastExecutionLog = executionLog;
                    lastExecutionResult = {
                        success: false,
                        stepsExecuted: i + 1,
                        stepsSkipped: 0,
                        stepsFailed: 1,
                        executionLog: executionLog
                    };

                    updateRunButton('failed');
                    updateProgressIndicator('failed', stepNumber, totalStepsCount);
                    setModalTitle('<em>Flow</em> Interrupted', 'Integrity Check Required');
                    hideStopButton();
                    showCloseMonitorButton();
                    showPostExecutionButtons(false);
                    return;
                }

                // Pause and wait for user to click Continue (unless it's the last step)
                if (i < config.nodes.length - 1) {
                    // Show pause state
                    updateProgressIndicator('paused', stepNumber, totalStepsCount);
                    setModalTitle('<em>Flow</em> Paused — Awaiting Manual Continue', 'Precision in motion — your flow awaits command.');

                    // Show Continue button
                    showContinueButton(stepNumber, config.nodes[i + 1]);

                    // Wait for user to click Continue
                    await waitForContinue();

                    // Check if stop was requested during pause
                    if (stopRequested) {
                        console.log('[Flow Runner] Stop requested during pause');
                        break;
                    }

                    // Hide Continue button and restore running state
                    hideContinueButton();
                    setModalTitle('<em>Flow</em> in Motion', 'Executing nodes sequentially');
                    updateProgressIndicator('running', stepNumber, totalStepsCount);
                }

            } catch (error) {
                console.error('[Flow Runner] Step execution error:', error);

                // Save partial log
                lastExecutionLog = executionLog;
                lastExecutionResult = {
                    success: false,
                    stepsExecuted: i,
                    stepsSkipped: 0,
                    stepsFailed: 1,
                    executionLog: executionLog
                };

                updateRunButton('failed');
                updateProgressIndicator('failed', stepNumber, totalStepsCount);
                showExecutionError(error);
                hideStopButton();
                showCloseMonitorButton();
                showPostExecutionButtons(false);
                return;
            }
        }

        // Save final execution log
        lastExecutionLog = executionLog;
        lastExecutionResult = {
            success: !stopRequested,
            stepsExecuted: executionLog.length,
            stepsSkipped: 0,
            stepsFailed: 0,
            executionLog: executionLog
        };

        // Update final state
        if (stopRequested) {
            updateRunButton('stopped');
            updateProgressIndicator('stopped', currentStepNumber, totalStepsCount);
            const nextStep = currentStepNumber + 1;
            setModalTitle('<em>Flow</em> Interrupted', currentStepNumber > 0
                ? `User had second thoughts just before node ${nextStep} could be part of the <em>Flow</em>`
                : `User had second thoughts...`);
            showPostExecutionButtons(false);
        } else {
            updateRunButton('completed');
            updateProgressIndicator('completed', totalStepsCount, totalStepsCount);
            setModalTitle('<em>Flow</em> Complete', 'Precision Achieved');
            showPostExecutionButtons(true);
        }

        hideStopButton();
        showCloseMonitorButton();

    } catch (error) {
        console.error('[Flow Runner] Execution error:', error);
        updateRunButton('failed');
        updateProgressIndicator('failed', currentStepNumber, totalStepsCount);
        showExecutionError(error);
        showPostExecutionButtons(false);
        hideStopButton();
        showCloseMonitorButton();
    }
}

/**
 * Wait for user to click Continue button (Step-by-Step mode)
 */
function waitForContinue() {
    return new Promise((resolve) => {
        pendingContinueResolve = resolve;
    });
}

/**
 * Handle Continue button click (Step-by-Step mode)
 */
function continueToNextStep() {
    console.log('[Flow Runner] Continue requested');
    continueRequested = true;

    if (pendingContinueResolve) {
        pendingContinueResolve();
        pendingContinueResolve = null;
    }
}

/**
 * Show Continue to Next Step button in modal footer
 */
function showContinueButton(currentStep, nextNode) {
    const continueBtn = document.getElementById('continueStepBtn');
    const nextStepPreview = document.getElementById('nextStepPreview');

    // Create Continue button if it doesn't exist
    if (!continueBtn) {
        const modalFooter = document.querySelector('#resultsModal .modal-footer');
        if (modalFooter) {
            // Insert before Stop button
            const stopBtn = document.getElementById('stopExecutionBtn');
            const continueBtnHtml = `
                <div id="nextStepPreview" class="me-auto text-start small text-muted">
                    <i class="bi bi-arrow-right-circle me-1"></i>
                    <strong>Next:</strong> <span id="nextStepName"></span>
                </div>
                <button type="button" class="btn btn-primary" id="continueStepBtn" onclick="continueToNextStep()">
                    <i class="bi bi-play-circle"></i> Continue to Next Step
                </button>
            `;

            if (stopBtn) {
                stopBtn.insertAdjacentHTML('beforebegin', continueBtnHtml);
            } else {
                modalFooter.insertAdjacentHTML('afterbegin', continueBtnHtml);
            }
        }
    }

    // Update next step preview
    const nextStepNameEl = document.getElementById('nextStepName');
    if (nextStepNameEl && nextNode) {
        nextStepNameEl.textContent = nextNode.name || formatStepLabel(nextNode);
    }

    // Show Continue button and preview
    const btn = document.getElementById('continueStepBtn');
    const preview = document.getElementById('nextStepPreview');
    if (btn) btn.style.display = 'inline-block';
    if (preview) preview.style.display = 'block';
}

/**
 * Hide Continue to Next Step button
 */
function hideContinueButton() {
    const continueBtn = document.getElementById('continueStepBtn');
    const nextStepPreview = document.getElementById('nextStepPreview');

    // Remove elements completely so they get recreated fresh each time
    if (continueBtn) continueBtn.remove();
    if (nextStepPreview) nextStepPreview.remove();
}

/**
 * Run sequence in Auto-Step mode with automatic countdown between steps
 * Phase 3 implementation
 */
async function runSequenceAutoStep() {
    // Declare executionLog at function scope so catch block can access it
    let executionLog = [];

    try {
        // Get current config from state
        const config = getCurrentConfig();

        if (!config || !config.nodes || config.nodes.length === 0) {
            showAlert('error', 'No nodes to execute. Please add at least one node to your configuration.');
            return;
        }

        // Validate config before execution
        try {
            const validationResponse = await fetch('/api/validate', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ config: config })
            });

            if (!validationResponse.ok) {
                throw new Error(`Validation request failed: ${validationResponse.statusText}`);
            }

            const validationResult = await validationResponse.json();

            // If validation failed, show errors and abort execution
            if (!validationResult.valid) {
                console.log('[Flow Runner] Validation failed, aborting execution');

                // Show validation modal with errors (non-silent mode)
                if (typeof showConfigValidationResults === 'function') {
                    showConfigValidationResults(validationResult);
                } else {
                    // Fallback: show basic alert
                    const errorCount = validationResult.errors.length;
                    showAlert('error', `Config validation failed with ${errorCount} error${errorCount > 1 ? 's' : ''}. Please fix the errors before running.`);
                }
                return; // Abort execution
            }

            console.log('[Flow Runner] Validation passed, proceeding with auto-step execution');
        } catch (validationError) {
            console.error('[Flow Runner] Validation error:', validationError);
            showAlert('error', `Failed to validate config: ${validationError.message}`);
            return; // Abort execution
        }

        // Reset state for new execution
        currentStepNumber = 0;
        totalStepsCount = config.nodes.length;
        stopRequested = false;
        continueRequested = false;
        pendingContinueResolve = null;
        countdownIntervalId = null;
        executionLog = [];

        // Hide post-execution buttons
        hidePostExecutionButtons();

        // Open modal immediately with loading state
        showLoadingModal(config.nodes.length);

        // Update to running state
        updateRunButton('running');

        // Show stop button and hide close button during execution
        showStopButton();
        hideCloseMonitorButton();

        // Auto-step execution: call server endpoint for each step
        const responses = [];
        let userInput = {}; // Persistent across steps

        for (let i = 0; i < config.nodes.length; i++) {
            // Check if stop was requested
            if (stopRequested) {
                console.log('[Flow Runner] Stop requested at step', i + 1);
                break;
            }

            const stepNumber = i + 1;
            currentStepNumber = stepNumber;

            // Call /api/execute-step endpoint for this single step
            try {
                const response = await fetch('/api/execute-step', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        config: config,
                        stepIndex: i,
                        responses: responses,
                        userInput: userInput
                    })
                });

                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }

                const stepResult = await response.json();

                // Handle input required
                if (stepResult.inputRequired) {
                    // Update UI to show awaiting input state
                    // Show completed steps count (this step is awaiting, not executed yet)
                    setModalTitle('<em>Flow</em> Paused', 'Awaiting User Calibration');
                    updateProgressIndicator('paused', i, totalStepsCount);

                    // Loop until user provides input or stops execution
                    let newInput = null;
                    let firstAttempt = true;
                    while (!newInput && !stopRequested) {
                        if (firstAttempt) {
                            // First attempt: show placeholder and auto-open modal
                            showInputRequiredPlaceholder(stepResult, stepNumber, totalStepsCount);
                            console.log('[Flow Runner] Auto-opening input modal...');
                            firstAttempt = false;
                        } else {
                            // Subsequent attempts: wait for user to click placeholder
                            await waitForPlaceholderClick();

                            // Check if stop was requested during wait
                            if (stopRequested) {
                                console.log('[Flow Runner] Stop requested while waiting for placeholder click');
                                break;
                            }

                            console.log('[Flow Runner] Placeholder clicked, opening modal...');
                        }

                        // Check if stop was requested before showing modal
                        if (stopRequested) {
                            break;
                        }

                        // Collect user input
                        newInput = await collectUserInputForStep({
                            executionId: `step-${i}`,
                            stepIndex: i,
                            step: stepNumber,
                            name: stepResult.name || config.nodes[i].name,
                            prompts: stepResult.prompts
                        });

                        // If modal was closed without submitting (returns null), loop again
                        if (!newInput && !stopRequested) {
                            console.log('[Flow Runner] Input modal closed without submitting, click placeholder when ready...');
                        }
                    }

                    if (stopRequested) {
                        console.log('[Flow Runner] Stop requested during input collection');
                        break;
                    }

                    // Restore executing state after input collected
                    setModalTitle('<em>Flow</em> in Motion', 'Executing nodes sequentially');
                    updateProgressIndicator('running', stepNumber, totalStepsCount);

                    // Merge user input
                    userInput = { ...userInput, ...newInput };

                    // Re-execute step with user input
                    const retryResponse = await fetch('/api/execute-step', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            config: config,
                            stepIndex: i,
                            responses: responses,
                            userInput: userInput
                        })
                    });

                    if (!retryResponse.ok) {
                        throw new Error(`HTTP error! status: ${retryResponse.status}`);
                    }

                    const retryResult = await retryResponse.json();
                    Object.assign(stepResult, retryResult);
                }

                // Store response
                if (stepResult.response) {
                    responses.push({
                        id: config.nodes[i].id,
                        status: stepResult.response.status,
                        body: stepResult.response.body
                    });
                }

                // Add to execution log
                executionLog.push(stepResult);

                // Display step result (replace placeholder if user input was collected)
                replaceStepPlaceholder(stepResult, stepNumber, totalStepsCount);
                updateProgressIndicator('running', stepNumber, totalStepsCount);

                // Handle browser launch
                if (stepResult.status === 'completed' && stepResult.launchBrowser && stepResult.response) {
                    handleBrowserLaunch(stepResult);
                }

                // Check if step failed
                if (stepResult.status === 'failed') {
                    // Show error and stop
                    lastExecutionLog = executionLog;
                    lastExecutionResult = {
                        success: false,
                        stepsExecuted: i + 1,
                        stepsSkipped: 0,
                        stepsFailed: 1,
                        executionLog: executionLog
                    };

                    updateRunButton('failed');
                    updateProgressIndicator('failed', stepNumber, totalStepsCount);
                    setModalTitle('<em>Flow</em> Interrupted', 'Integrity Check Required');
                    hideStopButton();
                    showCloseMonitorButton();
                    showPostExecutionButtons(false);
                    return;
                }

                // Pause with countdown (unless it's the last step)
                if (i < config.nodes.length - 1) {
                    // Show pause state with countdown
                    updateProgressIndicator('paused', stepNumber, totalStepsCount);
                    setModalTitle(`<em>Flow</em> Paused — Auto-continuing in ${autoStepDelay}s`, 'Automation with rhythm — each step engineered for flow.');

                    // Show countdown button with next step preview
                    showCountdownButton(stepNumber, config.nodes[i + 1], autoStepDelay);

                    // Wait for countdown (or user clicking Continue Now)
                    const userSkipped = await countdownAndWait(autoStepDelay);

                    // Check if stop was requested during countdown
                    if (stopRequested) {
                        console.log('[Flow Runner] Stop requested during countdown');
                        break;
                    }

                    // Hide countdown button and restore running state
                    hideCountdownButton();
                    setModalTitle('<em>Flow</em> in Motion', 'Executing nodes sequentially');
                    updateProgressIndicator('running', stepNumber, totalStepsCount);
                }

            } catch (error) {
                console.error('[Flow Runner] Step execution error:', error);

                // Save partial log
                lastExecutionLog = executionLog;
                lastExecutionResult = {
                    success: false,
                    stepsExecuted: i,
                    stepsSkipped: 0,
                    stepsFailed: 1,
                    executionLog: executionLog
                };

                updateRunButton('failed');
                updateProgressIndicator('failed', stepNumber, totalStepsCount);
                showExecutionError(error);
                hideStopButton();
                showCloseMonitorButton();
                showPostExecutionButtons(false);
                return;
            }
        }

        // Save final execution log
        lastExecutionLog = executionLog;
        lastExecutionResult = {
            success: !stopRequested,
            stepsExecuted: executionLog.length,
            stepsSkipped: 0,
            stepsFailed: 0,
            executionLog: executionLog
        };

        // Update final state
        if (stopRequested) {
            updateRunButton('stopped');
            updateProgressIndicator('stopped', currentStepNumber, totalStepsCount);
            const nextStep = currentStepNumber + 1;
            setModalTitle('<em>Flow</em> Interrupted', currentStepNumber > 0
                ? `User had second thoughts just before node ${nextStep} could be part of the <em>Flow</em>`
                : `User had second thoughts...`);
            showPostExecutionButtons(false);
        } else {
            updateRunButton('completed');
            updateProgressIndicator('completed', totalStepsCount, totalStepsCount);
            setModalTitle('<em>Flow</em> Complete', 'Precision Achieved');
            showPostExecutionButtons(true);
        }

        hideStopButton();
        showCloseMonitorButton();

    } catch (error) {
        console.error('[Flow Runner] Execution error:', error);
        updateRunButton('failed');
        updateProgressIndicator('failed', currentStepNumber, totalStepsCount);
        showExecutionError(error);
        showPostExecutionButtons(false);
        hideStopButton();
        showCloseMonitorButton();
    }
}

/**
 * Countdown and wait with auto-resume (Auto-Step mode)
 * Returns true if user clicked "Continue Now", false if auto-resumed
 */
function countdownAndWait(seconds) {
    return new Promise((resolve) => {
        let remaining = seconds;

        // Update countdown display
        const updateCountdown = () => {
            const countdownEl = document.getElementById('countdownTimer');
            if (countdownEl) {
                countdownEl.textContent = remaining;
            }

            // Update modal title with countdown while keeping tagline in subtitle
            const modalTitle = document.getElementById('resultsModalLabel');
            if (modalTitle) {
                modalTitle.innerHTML = `<em>Flow</em> Paused — Auto-continuing in ${remaining}s`;
            }
        };

        // Initial update
        updateCountdown();

        // Store resolve function for "Continue Now" button
        pendingContinueResolve = () => {
            if (countdownIntervalId) {
                clearInterval(countdownIntervalId);
                countdownIntervalId = null;
            }
            pendingContinueResolve = null;
            resolve(true); // User skipped countdown
        };

        // Start countdown
        countdownIntervalId = setInterval(() => {
            remaining--;

            if (remaining <= 0) {
                clearInterval(countdownIntervalId);
                countdownIntervalId = null;
                pendingContinueResolve = null;
                resolve(false); // Auto-continued
            } else {
                updateCountdown();
            }
        }, 1000);
    });
}

/**
 * Show countdown button with "Continue Now" option
 */
function showCountdownButton(currentStep, nextNode, delay) {
    const continueBtn = document.getElementById('continueStepBtn');
    const nextStepPreview = document.getElementById('nextStepPreview');

    // Create button if it doesn't exist
    if (!continueBtn) {
        const modalFooter = document.querySelector('#resultsModal .modal-footer');
        if (modalFooter) {
            const stopBtn = document.getElementById('stopExecutionBtn');
            const continueBtnHtml = `
                <div id="nextStepPreview" class="me-auto text-start small text-muted">
                    <i class="bi bi-clock-history me-1"></i>
                    <strong>Auto-continuing in <span id="countdownTimer">${delay}</span>s</strong>
                    <div class="mt-1">
                        <i class="bi bi-diagram-3 me-1"></i>
                        Next: <span id="nextStepName"></span>
                    </div>
                </div>
                <button type="button" class="btn btn-primary" id="continueStepBtn" onclick="continueToNextStep()">
                    <i class="bi bi-play-fill"></i> Continue Now
                </button>
            `;

            if (stopBtn) {
                stopBtn.insertAdjacentHTML('beforebegin', continueBtnHtml);
            } else {
                modalFooter.insertAdjacentHTML('afterbegin', continueBtnHtml);
            }
        }
    }

    // Update next step preview and countdown
    const nextStepNameEl = document.getElementById('nextStepName');
    if (nextStepNameEl && nextNode) {
        nextStepNameEl.textContent = nextNode.name || formatStepLabel(nextNode);
    }

    const countdownEl = document.getElementById('countdownTimer');
    if (countdownEl) {
        countdownEl.textContent = delay;
    }

    // Show button and preview
    const btn = document.getElementById('continueStepBtn');
    const preview = document.getElementById('nextStepPreview');
    if (btn) btn.style.display = 'inline-block';
    if (preview) preview.style.display = 'block';
}

/**
 * Hide countdown button
 */
function hideCountdownButton() {
    // Clear countdown interval if active
    if (countdownIntervalId) {
        clearInterval(countdownIntervalId);
        countdownIntervalId = null;
    }

    // Hide button
    hideContinueButton();
}
