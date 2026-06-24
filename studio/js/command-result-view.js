/**
 * Shared rendering helpers for command-node results.
 * Core module (loaded before optional features) so Flow Runner (core) and
 * Try-it-Out (feature) both reuse it. No external dependencies.
 */
(function () {
    'use strict';

    function escapeHtml(text) {
        if (text === null || text === undefined) return '';
        if (typeof text !== 'string') text = String(text);
        // Prefer DOM escaping in the browser; fall back to manual for Node tests.
        if (typeof document !== 'undefined' && document.createElement) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }
        return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function isCommandLike(x) {
        return !!x && (x.type === 'command' ||
            (x.request && x.request.type === 'command') ||
            (x.body && typeof x.body.exitCode !== 'undefined'));
    }

    /**
     * One-line label for a step / request-details object.
     */
    function formatStepLabel(stepLike) {
        if (!stepLike) return '';
        const isCommand = stepLike.type === 'command' || (stepLike.request && stepLike.request.type === 'command');
        if (isCommand) {
            const src = (stepLike.command !== undefined || stepLike.args !== undefined) ? stepLike : (stepLike.request || {});
            const args = Array.isArray(src.args) ? src.args.join(' ') : '';
            return `cmd: ${src.command || ''}${args ? ' ' + args : ''}`.trim();
        }
        return `${stepLike.method || ''} ${stepLike.url || ''}`.trim();
    }

    /**
     * Rich panels for a command response body { exitCode, stdout, stderr, json }.
     * Defends against missing/partial body.
     */
    function renderCommandResultPanels(body) {
        body = body || {};
        const exit = (typeof body.exitCode === 'number') ? body.exitCode : null;
        const exitBadge = `<span class="badge ${exit === 0 ? 'bg-success' : 'bg-danger'}">Exit ${exit === null ? '?' : exit}</span>`;
        const preStyle = "background: var(--bg-surface); color: var(--text-primary); border: 1px solid var(--border-color);";

        const stdout = body.stdout || '';
        const stderr = body.stderr || '';
        const hasJson = body.json !== null && body.json !== undefined;

        const stderrPanel = stderr.trim().length > 0 ? `
            <div class="mb-2">
                <label class="form-label small text-danger mb-1"><i class="bi bi-exclamation-triangle me-1"></i>stderr</label>
                <pre class="p-2 small mb-0" style="${preStyle} border-color: var(--text-danger, #dc3545);">${escapeHtml(stderr)}</pre>
            </div>` : '';

        const jsonPanel = hasJson ? `
            <div class="mb-2">
                <label class="form-label small mb-1">parsed json</label>
                <pre class="p-2 small mb-0" style="${preStyle}">${escapeHtml(JSON.stringify(body.json, null, 2))}</pre>
            </div>` : '';

        return `
            <div class="command-result">
                <div class="mb-2">${exitBadge}</div>
                <div class="mb-2">
                    <label class="form-label small mb-1">stdout</label>
                    <pre class="p-2 small mb-0" style="${preStyle}">${escapeHtml(stdout)}</pre>
                </div>
                ${stderrPanel}
                ${jsonPanel}
            </div>
        `;
    }

    const api = { formatStepLabel, renderCommandResultPanels, isCommandLike };
    if (typeof window !== 'undefined') {
        window.formatStepLabel = formatStepLabel;
        window.renderCommandResultPanels = renderCommandResultPanels;
        window.isCommandLike = isCommandLike;
    }
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
