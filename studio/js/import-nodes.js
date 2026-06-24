/**
 * Import Nodes Modal Module
 *
 * Provides functionality to import node templates from categorized library
 * into the current flow configuration.
 *
 * Features:
 * - Fetch and display categorized node templates
 * - Auto-create missing variables with placeholders
 * - Auto-rename conflicting node IDs
 * - Visual highlighting of newly added nodes
 */

const ImportNodesModal = {
  templates: {},
  modal: null,

  /**
   * Initialize the Import Nodes modal
   */
  async init() {
    try {
      // Fetch templates from API
      await this.fetchTemplates();

      // Create modal structure
      this.createModal();

      console.log('[ImportNodes] Initialized with templates:', Object.keys(this.templates));
    } catch (error) {
      console.error('[ImportNodes] Initialization failed:', error);
    }
  },

  /**
   * Fetch all available node templates from API
   */
  async fetchTemplates() {
    try {
      const response = await fetch('/api/templates/nodes');
      if (!response.ok) {
        throw new Error(`Failed to fetch templates: ${response.statusText}`);
      }

      this.templates = await response.json();
      console.log('[ImportNodes] Fetched templates:', this.templates);
    } catch (error) {
      console.error('[ImportNodes] Failed to fetch templates:', error);
      this.templates = {};
    }
  },

  /**
   * Create the modal HTML structure
   */
  createModal() {
    const modalHtml = `
      <div class="modal fade" id="importNodesModal" tabindex="-1" aria-labelledby="importNodesModalLabel" aria-hidden="true">
        <div class="modal-dialog modal-lg">
          <div class="modal-content">
            <div class="modal-header">
              <h5 class="modal-title" id="importNodesModalLabel">
                <i class="bi bi-plus-circle"></i> Import Nodes
              </h5>
              <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
            </div>
            <div class="modal-body import-nodes-modal">
              <p class="text-muted mb-3">
                Select a node template to add to your flow. Nodes will be added to the end of your current sequence.
              </p>
              <div id="templatesContainer">
                ${this.renderCategories()}
              </div>
            </div>
            <div class="modal-footer">
              <small class="text-muted me-auto">
                <i class="bi bi-info-circle"></i> Nodes will be added to the end of your flow
              </small>
              <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
            </div>
          </div>
        </div>
      </div>
    `;

    // Remove existing modal if present
    const existingModal = document.getElementById('importNodesModal');
    if (existingModal) {
      existingModal.remove();
    }

    // Add modal to DOM
    document.body.insertAdjacentHTML('beforeend', modalHtml);

    // Get modal element with global configuration
    this.modal = window.configureModal('importNodesModal');
  },

  /**
   * Render all template categories
   */
  renderCategories() {
    const categoryIcons = {
      'auth': 'shield-lock',
      'user-input': 'person-circle',
      'validation': 'check-circle',
      'conditional': 'shuffle',
      'command': 'terminal'
    };

    const categoryNames = {
      'auth': 'Authentication',
      'user-input': 'User Interaction',
      'validation': 'Validation Examples',
      'conditional': 'Conditional Flow',
      'command': 'Command'
    };

    let html = '';

    for (const [category, templates] of Object.entries(this.templates)) {
      if (templates.length === 0) continue;

      const icon = categoryIcons[category] || 'folder';
      const name = categoryNames[category] || category;

      html += `
        <div class="category-section mb-4">
          <div class="category-header">
            <i class="bi bi-${icon}"></i>
            ${name}
          </div>
          <div class="templates-list">
            ${templates.map(template => this.renderTemplateCard(template, category)).join('')}
          </div>
        </div>
      `;
    }

    return html || '<p class="text-muted">No templates available</p>';
  },

  /**
   * Render a single template card
   */
  renderTemplateCard(template, category) {
    const nodeCount = template.nodes ? template.nodes.length : 0;
    const nodeCountText = nodeCount === 1 ? '1 node' : `${nodeCount} nodes`;

    return `
      <div class="template-card" onclick="ImportNodesModal.importTemplate('${category}', '${template.id}')">
        <div class="template-name">${template.templateName}</div>
        <div class="template-description">${template.description}</div>
        <div class="template-meta">
          <span class="badge bg-secondary">${nodeCountText}</span>
          ${template.requiredVariables && template.requiredVariables.length > 0
            ? `<span class="ms-2 text-muted small"><i class="bi bi-gear"></i> Requires variables</span>`
            : ''}
        </div>
      </div>
    `;
  },

  /**
   * Import a template into the current flow
   */
  async importTemplate(category, templateId) {
    try {
      console.log(`[ImportNodes] Importing template: ${category}/${templateId}`);

      // Fetch the specific template
      const response = await fetch(`/api/templates/nodes/${category}/${templateId}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch template: ${response.statusText}`);
      }

      const template = await response.json();
      console.log('[ImportNodes] Fetched template:', template);

      // Process the template (smart features)
      const processedNodes = this.processTemplate(template);

      // Add nodes to current config
      this.addNodesToConfig(processedNodes);

      // Close modal
      this.modal.hide();

      // Show success notification
      this.showNotification(`Added ${processedNodes.length} node(s) to your flow`, 'success');

    } catch (error) {
      console.error('[ImportNodes] Import failed:', error);
      this.showNotification(`Failed to import template: ${error.message}`, 'danger');
    }
  },

  /**
   * Process template with smart features
   * - Auto-create missing variables
   * - Auto-rename conflicting IDs
   */
  processTemplate(template) {
    const nodes = template.nodes || [];

    // 1. Detect and create missing variables
    const missingVars = this.detectMissingVariables(nodes);
    if (missingVars.length > 0) {
      this.createVariables(missingVars);
    }

    // 2. Rename conflicting IDs
    const renamedNodes = this.renameConflictingIds(nodes);

    return renamedNodes;
  },

  /**
   * Detect variables referenced in template that don't exist in config
   */
  detectMissingVariables(nodes) {
    const varPattern = /\{\{\s*\.vars\.(\w+)\s*\}\}/g;
    const requiredVars = new Set();

    // Scan all node fields for variable references
    const nodesJson = JSON.stringify(nodes);
    let match;
    while ((match = varPattern.exec(nodesJson)) !== null) {
      requiredVars.add(match[1]);
    }

    // Get current config variables (using global config from state.js)
    const currentVars = (typeof config !== 'undefined' && config) ? config.variables || {} : {};

    // Return variables that don't exist
    return Array.from(requiredVars).filter(varName => !(varName in currentVars));
  },

  /**
   * Create missing variables in config with placeholder values
   */
  createVariables(varNames) {
    // Use global config from state.js
    if (typeof config === 'undefined' || !config) {
      console.error('[ImportNodes] No config loaded');
      return;
    }

    if (!config.variables) {
      config.variables = {};
    }

    varNames.forEach(varName => {
      config.variables[varName] = `YOUR_${varName.toUpperCase()}_HERE`;
    });

    // Re-render variables section
    if (typeof renderGlobalVariables === 'function') {
      renderGlobalVariables();
    }

    // Show notification
    if (varNames.length > 0) {
      this.showNotification(
        `Added ${varNames.length} variable(s): ${varNames.join(', ')}. Please update values in Variables section.`,
        'info'
      );
    }
  },

  /**
   * Rename node IDs that conflict with existing nodes
   */
  renameConflictingIds(nodes) {
    // Use global config from state.js
    const currentNodes = (typeof config !== 'undefined' && config) ? config.nodes || [] : [];
    const existingIds = new Set(currentNodes.map(n => n.id));

    const renamedNodes = nodes.map(node => {
      let newId = node.id;
      let counter = 2;

      // Find unique ID by incrementing suffix
      while (existingIds.has(newId)) {
        newId = `${node.id}-${counter}`;
        counter++;
      }

      // If renamed, show notification and update node
      if (newId !== node.id) {
        this.showNotification(
          `Renamed node ID from "${node.id}" to "${newId}" to avoid conflict`,
          'info'
        );

        const renamedNode = { ...node, id: newId };
        existingIds.add(newId);
        return renamedNode;
      }

      existingIds.add(newId);
      return node;
    });

    return renamedNodes;
  },

  /**
   * Add processed nodes to the current config
   */
  addNodesToConfig(nodes) {
    // Use global config from state.js
    if (typeof config === 'undefined' || !config) {
      console.error('[ImportNodes] No config loaded');
      this.showNotification('Please create or load a config first', 'warning');
      return;
    }

    if (!config.nodes) {
      config.nodes = [];
    }

    const startIndex = config.nodes.length;

    // Add nodes to end of flow
    config.nodes.push(...nodes);

    // Re-render the entire UI using the main render functions
    if (typeof renderEditor === 'function') {
      renderEditor();
    }

    // Update JSON preview
    if (typeof updatePreview === 'function') {
      updatePreview();
    }

    // Save to localStorage
    if (typeof saveToLocalStorage === 'function') {
      saveToLocalStorage();
    }

    // Highlight newly added nodes after render completes
    setTimeout(() => {
      this.highlightNodes(startIndex, config.nodes.length - 1);
    }, 200);
  },

  /**
   * Highlight newly added nodes with visual feedback
   */
  highlightNodes(startIdx, endIdx, duration = 3000) {
    console.log(`[ImportNodes] Highlighting nodes ${startIdx} to ${endIdx}`);

    for (let i = startIdx; i <= endIdx; i++) {
      const nodeElement = document.querySelector(`[data-step-index="${i}"]`);
      console.log(`[ImportNodes] Node ${i}:`, nodeElement ? 'Found' : 'Not found');

      if (nodeElement) {
        console.log(`[ImportNodes] Adding highlight class to node ${i}`);
        nodeElement.classList.add('newly-added');

        // Force a reflow to ensure animation triggers
        nodeElement.offsetHeight;

        // Scroll to first new node
        if (i === startIdx) {
          nodeElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }

        // Remove highlight after duration
        setTimeout(() => {
          console.log(`[ImportNodes] Removing highlight from node ${i}`);
          nodeElement.classList.remove('newly-added');
        }, duration);
      }
    }
  },

  /**
   * Show notification to user
   */
  showNotification(message, type = 'info') {
    // Use Bootstrap toast or alert
    const alertClass = type === 'success' ? 'alert-success' :
                       type === 'danger' ? 'alert-danger' :
                       type === 'warning' ? 'alert-warning' : 'alert-info';

    const alertId = `alert-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Calculate offset based on existing alerts
    const existingAlerts = document.querySelectorAll('.alert.position-fixed');
    const offset = existingAlerts.length * 70; // Stack alerts vertically

    const alertHtml = `
      <div id="${alertId}" class="alert ${alertClass} alert-dismissible fade show position-fixed top-0 start-50 translate-middle-x"
           style="z-index: 9999; max-width: 500px; margin-top: ${offset + 16}px;" role="alert">
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', alertHtml);

    // Auto-dismiss after 4 seconds
    setTimeout(() => {
      const alert = document.getElementById(alertId);
      if (alert) {
        const bsAlert = bootstrap.Alert.getOrCreateInstance(alert);
        bsAlert.close();
      }
    }, 4000);
  },

  /**
   * Open the Import Nodes modal
   */
  open() {
    if (this.modal) {
      this.modal.show();
    } else {
      console.error('[ImportNodes] Modal not initialized');
    }
  }
};

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    ImportNodesModal.init();
  });
} else {
  ImportNodesModal.init();
}

// Export for global access
window.ImportNodesModal = ImportNodesModal;
