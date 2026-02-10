// ==================== QUICK ACCESS MANAGEMENT SYSTEM ==================== //

class QuickAccessManager {
  constructor() {
    this.userId = this.getUserId();
    this.userRole = this.getUserRole();
    this.quickAccessItems = [];
    this.draggedIndex = null;
    this.longPressTimer = null;
    this.isDraggingEnabled = false;
    this.isActuallyDragging = false;
    this.longPressActivated = false;
    this.touchStartPos = null;
    this.userAccessibleMenus = []; // NEW: Store user's accessible menus from backend
    
    // Define position-based colors (these stay fixed per position)
    this.positionColors = [
      'bg-[#8CB5F8]/20',  // Position 0 - Blue
      'bg-[#FBBF24]/20',  // Position 1 - Yellow
      'bg-[#FBBF24]/20',  // Position 2 - Yellow
      'bg-[#8CB5F8]/20',  // Position 3 - Blue
      'bg-[#8CB5F8]/20',  // Position 4 - Blue
      'bg-[#FBBF24]/20'   // Position 5 - Yellow
    ];
    
    // Define all available quick access options (maps to menu_key in database)
    this.availableOptions = {
      'database-backup': {
        id: 'database-backup',
        label: 'Payroll Class Backup',
        section: 'database-backup',
        title: 'Payroll Class Backup'
      },
      'save-payroll-files': {
        id: 'save-payroll-files',
        label: 'Save Payroll Files',
        section: 'save-payroll-files',
        title: 'Save Payroll Files'
      },
      'add-personnel': {
        id: 'add-personnel',
        label: 'Add New Personnel',
        section: 'add-personnel',
        title: 'Add New Personnel'
      },
      'monthly-yearly-processing': {
        id: 'monthly-yearly-processing',
        label: 'Process Month End',
        section: 'monthly-yearly-processing',
        title: 'Month End Processing'
      },
      'pay-slips': {
        id: 'pay-slips',
        label: 'Pay Slips',
        section: 'pay-slips',
        title: 'Pay Slips'
      },
      'payments-deductions': {
        id: 'payments-deductions',
        label: 'Payment/Deduction',
        section: 'payments-deductions',
        title: 'Payments/Deductions'
      },
      'payments-deductions-upload': {
        id: 'payments-deductions-upload',
        label: 'Payment/Deduction Upload',
        section: 'payments-deductions-upload',
        title: 'Payments/Deductions Upload'
      },
      'current-personnel': {
        id: 'current-personnel',
        label: 'Current Personnel',
        section: 'current-personnel',
        title: 'Current Personnel'
      },
      'payroll-calculations': {
        id: 'payroll-calculations',
        label: 'Payroll Calculations',
        section: 'payroll-calculations',
        title: 'Payroll Calculations'
      },
      'payments-by-bank': {
        id: 'payments-by-bank',
        label: 'Payments by Bank',
        section: 'payments-by-bank',
        title: 'Payments by Bank'
      },
      'master-file-update': {
        id: 'master-file-update',
        label: 'Master File Update',
        section: 'master-file-update',
        title: 'Master File Update'
      },
      'role-management': {
        id: 'role-management',
        label: 'Role Management',
        section: 'role-management',
        title: 'Role Management'
      },
      'create-user': {
        id: 'create-user',
        label: 'Create User',
        section: 'create-user',
        title: 'Create User'
      },
      'control-user': {
        id: 'control-user',
        label: 'Control User',
        section: 'control-user',
        title: 'Control User'
      },
      'old-personnel': {
        id: 'old-personnel',
        label: 'Old Personnel',
        section: 'old-personnel',
        title: 'Old Personnel'
      },
      'calculation-reports': {
        id: 'calculation-reports',
        label: 'Calculation Reports',
        section: 'calculation-reports',
        title: 'Calculation Reports'
      },
      'company-profile': {
        id: 'company-profile',
        label: 'Company Profile',
        section: 'company-profile',
        title: 'Company Profile'
      },
      /*'dashboard': {
        id: 'dashboard',
        label: 'Dashboard',
        section: 'dashboard',
        title: 'Dashboard'
      },*/
      'database-restore': {
        id: 'database-restore',
        label: 'Payroll Class Restore',
        section: 'database-restore',
        title: 'Payroll Class Restore'
      },
      'payroll-class-setup': {
        id: 'payroll-class-setup',
        label: 'Payroll Class Setup',
        section: 'payroll-class-setup',
        title: 'Payroll Class Setup'
      },
      'yearly-processing': {
        id: 'yearly-processing',
        label: 'Year End Processing',
        section: 'yearly-processing',
        title: 'Year End Processing'
      },
      'personnel-reports': {
        id: 'personnel-reports',
        label: 'Personnel Reports',
        section: 'personnel-reports',
        title: 'Personnel Reports'
      },
      'input-documentation': {
        id: 'input-documentation',
        label: 'Input Documentation',
        section: 'input-documentation',
        title: 'Input Documentation'
      }
    };
    
    // Define default quick access items (fallback if backend has no data)
    this.roleDefaults = {
      'HICAD': [
        'role-management',
        'create-user',
        'database-backup',
        'monthly-yearly-processing',
        'payroll-calculations',
        'pay-slips'
      ],
      'MANAGER': [
        'pay-slips',
        'monthly-yearly-processing',
        'payroll-calculations',
        'payments-by-bank',
        'current-personnel',
        'add-personnel'
      ],
      'PROCESSOR': [
        'payments-deductions',
        'pay-slips',
        'payments-by-bank',
        'payroll-calculations',
        'save-payroll-files',
        'monthly-yearly-processing'
      ],
      'OPERATOR': [
        'add-personnel',
        'current-personnel',
        'payments-deductions',
        'pay-slips',
        'master-file-update',
        'save-payroll-files'
      ],
      'DATA_ENTRY': [
        'payments-deductions-upload',
        'current-personnel',
        'personnel-reports',
        'input-documentation',
        'add-personnel',
        'database-backup',
        'payments-by-bank'
      ]
    };
    
    this.init();
  }
  
  getUserId() {
    return localStorage.getItem('user_id') || 'default';
  }

  getUserRole() {
    return localStorage.getItem('user_role') || 'DATA_ENTRY';
  }
  
  // NEW: Fetch user's accessible menus from backend
  async loadUserAccessibleMenus() {
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        console.warn('No token found, skipping menu permissions fetch');
        return;
      }
      
      const response = await fetch('/roles/my-menus', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (response.ok) {
        const menus = await response.json();
        this.userAccessibleMenus = menus.map(m => m.menu_key);
        console.log('📋 Loaded accessible menus from backend:', this.userAccessibleMenus);
      } else {
        console.error('Failed to load accessible menus');
        this.userAccessibleMenus = [];
      }
    } catch (error) {
      console.error('Error loading accessible menus:', error);
      this.userAccessibleMenus = [];
    }
  }
  
  // NEW: Get available options filtered by user's actual permissions
  getAvailableOptionsForRole() {
    // If no accessible menus loaded (error or no permissions), show nothing
    if (this.userAccessibleMenus.length === 0) {
      console.warn('No accessible menus loaded');
      return {};
    }
    
    // Filter options to only include menus user has access to
    const filtered = {};
    Object.entries(this.availableOptions).forEach(([id, option]) => {
      if (this.userAccessibleMenus.includes(id)) {
        filtered[id] = option;
      }
    });
    
    console.log('✅ Available quick access options for user:', Object.keys(filtered));
    return filtered;
  }
  
  async init() {
    // Load user's accessible menus first
    await this.loadUserAccessibleMenus();
    
    // Then load quick access preferences
    await this.loadQuickAccess();
    
    // Validate and fix quick access items
    this.validateQuickAccessItems();
    
    this.render();
    this.createModal();
  }
  
  // NEW: Validate that all quick access items are accessible to user
  validateQuickAccessItems() {
    const availableOptions = this.getAvailableOptionsForRole();
    const availableIds = Object.keys(availableOptions);
    
    // Filter out any items user doesn't have access to
    const validItems = this.quickAccessItems.filter(itemId => 
      availableIds.includes(itemId)
    );
    
    // If we lost items, fill with accessible defaults
    if (validItems.length < 6) {
      console.log(`⚠️ Some quick access items removed (no permission). Filling with defaults...`);
      
      // Get defaults for this role
      const defaults = this.roleDefaults[this.userRole] || [];
      const validDefaults = defaults.filter(id => availableIds.includes(id));
      
      // Add defaults that aren't already in validItems
      for (const defaultId of validDefaults) {
        if (!validItems.includes(defaultId) && validItems.length < 6) {
          validItems.push(defaultId);
        }
      }
      
      // If still not enough, add any available items
      for (const id of availableIds) {
        if (!validItems.includes(id) && validItems.length < 6) {
          validItems.push(id);
        }
      }
      
      // If still not 6 items (user has very limited access), pad with first available
      while (validItems.length < 6 && availableIds.length > 0) {
        const firstAvailable = availableIds[validItems.length % availableIds.length];
        if (!validItems.includes(firstAvailable)) {
          validItems.push(firstAvailable);
        } else {
          // Allow duplicates if user has less than 6 accessible items
          validItems.push(firstAvailable);
        }
      }
    }
    
    this.quickAccessItems = validItems;
    
    // Save the validated items
    if (validItems.length !== this.quickAccessItems.length) {
      this.saveQuickAccess();
    }
  }
  
  async loadQuickAccess() {
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        this.useRoleDefaults();
        return;
      }
      
      const response = await fetch('/preferences', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        
        if (data.success && data.quickAccess && Array.isArray(data.quickAccess) && data.quickAccess.length === 6) {
          this.quickAccessItems = data.quickAccess;
          console.log('📂 Loaded custom quick access from backend');
        } else {
          this.useRoleDefaults();
        }
      } else {
        this.useRoleDefaults();
      }
    } catch (error) {
      console.error('Failed to load quick access:', error);
      this.useRoleDefaults();
    }
  }
  
  useRoleDefaults() {
    const defaults = this.roleDefaults[this.userRole] || this.roleDefaults['DATA_ENTRY'];
    this.quickAccessItems = [...defaults];
    console.log(`🎯 Using default quick access for role: ${this.userRole}`);
  }
  
  async saveQuickAccess() {
    try {
      const token = localStorage.getItem('token');
      if (!token) return;
      
      const response = await fetch('/preferences/save', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          quickAccess: this.quickAccessItems
        })
      });
      
      if (response.ok) {
        console.log('💾 Saved quick access preferences to backend');
      }
    } catch (error) {
      console.error('Failed to save quick access:', error);
    }
  }
  
  createModal() {
    const modal = document.createElement('div');
    modal.id = 'quickAccessModal';
    modal.className = 'fixed inset-0 bg-black/50 backdrop-blur-sm hidden items-center justify-center z-50';
    modal.innerHTML = `
      <div class="bg-white rounded-xl shadow-2xl max-w-xl w-full mx-4">
        <div class="bg-navy p-4 text-white flex items-center justify-between rounded-t-xl">
          <h3 class="text-lg font-bold">Customize Quick Access</h3>
          <button 
            onclick="window.quickAccessManager.resetToDefaults()" 
            class="text-md font-bold text-yellow-300 hover:underline transition-colors">
            <i class="fa-solid fa-arrow-rotate-left mr-1"></i> Reset
          </button>
        </div>
        
        <div class="p-4">
          <div id="modalQuickAccessGrid" class="grid grid-cols-2 gap-3"></div>
        </div>
        
        <div class="bg-gray-50 p-3 flex justify-end gap-2 border-t rounded-b-xl">
          <button 
            onclick="window.quickAccessManager.closeModal()" 
            class="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg text-sm font-semibold transition-colors">
            Cancel
          </button>
          <button 
            onclick="window.quickAccessManager.saveAndClose()" 
            class="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-semibold transition-colors">
            Save
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    
    this.createAlertModal();
  }
  
  createAlertModal() {
    const alertModal = document.createElement('div');
    alertModal.id = 'quickAccessAlertModal';
    alertModal.className = 'fixed inset-0 bg-black/50 backdrop-blur-sm hidden items-center justify-center z-50';
    alertModal.innerHTML = `
      <div class="bg-white rounded-xl shadow-2xl max-w-md w-full mx-4">
        <div class="p-6">
          <div class="flex items-center gap-3 mb-4">
            <div class="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center">
              <i class="fa-solid fa-circle-info text-green-600 text-xl"></i>
            </div>
            <h3 class="text-lg font-bold text-navy" id="alertModalTitle">Confirm</h3>
          </div>
          <p class="text-gray-700 mb-6" id="alertModalMessage"></p>
          <div class="flex justify-end gap-2">
            <button 
              onclick="window.quickAccessManager.closeAlertModal(false)" 
              class="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg text-sm font-semibold transition-colors">
              Cancel
            </button>
            <button 
              onclick="window.quickAccessManager.closeAlertModal(true)" 
              class="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-semibold transition-colors">
              Confirm
            </button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(alertModal);
  }
  
  showAlert(message, title = 'Confirm') {
    return new Promise((resolve) => {
      this.alertResolve = resolve;
      const modal = document.getElementById('quickAccessAlertModal');
      const titleEl = document.getElementById('alertModalTitle');
      const messageEl = document.getElementById('alertModalMessage');
      
      if (modal && titleEl && messageEl) {
        titleEl.textContent = title;
        messageEl.textContent = message;
        modal.classList.remove('hidden');
        modal.classList.add('flex');
      }
    });
  }
  
  closeAlertModal(result) {
    const modal = document.getElementById('quickAccessAlertModal');
    if (modal) {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
    }
    if (this.alertResolve) {
      this.alertResolve(result);
      this.alertResolve = null;
    }
  }
  
  openModal() {
    const modal = document.getElementById('quickAccessModal');
    if (!modal) return;
    
    this.renderModalContent();
    modal.classList.remove('hidden');
    modal.classList.add('flex');
  }
  
  closeModal() {
    const modal = document.getElementById('quickAccessModal');
    if (!modal) return;
    
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    
    this.loadQuickAccess().then(() => {
      this.validateQuickAccessItems();
      this.render();
    });
  }
  
  async saveAndClose() {
    await this.saveQuickAccess();
    const modal = document.getElementById('quickAccessModal');
    if (modal) {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
    }
    this.render();
  }
  
  renderModalContent() {
    const grid = document.getElementById('modalQuickAccessGrid');
    if (!grid) return;
    
    grid.innerHTML = this.quickAccessItems.map((itemId, index) => {
      const option = this.availableOptions[itemId];
      if (!option) return '';
      
      return this.renderModalItem(option, index);
    }).join('');
  }
  
  renderModalItem(option, index) {
    const color = this.positionColors[index];
    const roleOptions = this.getAvailableOptionsForRole();
    
    // Only show options user has access to
    const availableForSwap = Object.entries(roleOptions)
      .filter(([id]) => !this.quickAccessItems.includes(id) || id === option.id)
      .map(([id, opt]) => `
        <option value="${id}" ${id === option.id ? 'selected' : ''}>
          ${opt.label}
        </option>
      `).join('');
    
    return `
      <div 
        class="relative ${color} p-3 rounded-lg shadow-sm border-2 border-transparent hover:border-green-400 cursor-move transition-all modal-drag-item"
        draggable="true"
        data-index="${index}"
        ondragstart="window.quickAccessManager.handleModalDragStart(event, ${index})"
        ondragover="window.quickAccessManager.handleModalDragOver(event)"
        ondrop="window.quickAccessManager.handleModalDrop(event, ${index})"
        ondragend="window.quickAccessManager.handleModalDragEnd(event)"
        ondragleave="window.quickAccessManager.handleModalDragLeave(event)">
        
        <div class="flex flex-col gap-2">
          <div class="text-center text-sm font-semibold text-gray-700">
            ${option.label}
          </div>
          
          <select 
            onchange="window.quickAccessManager.replaceItemInModal(${index}, this.value)"
            class="w-full px-2 py-1.5 text-xs border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-green-500 bg-white cursor-pointer"
            onclick="event.stopPropagation()">
            ${availableForSwap}
          </select>
        </div>
      </div>
    `;
  }
  
  // ========== DRAG HANDLERS ==========
  
  clearLongPressTimer() {
    if (this.longPressTimer) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
  }
  
  resetDragState() {
    this.clearLongPressTimer();
    this.isDraggingEnabled = false;
    this.isActuallyDragging = false;
    this.draggedIndex = null;
    
    document.querySelectorAll('.quick-access-btn').forEach(btn => {
      btn.setAttribute('draggable', 'false');
      btn.style.cursor = '';
      btn.style.opacity = '';
      btn.style.transform = '';
      btn.style.borderColor = '';
      btn.style.borderWidth = '';
      btn.style.borderStyle = '';
    });
  }
  
  handleMouseDown(index, event) {
    const button = event.currentTarget;
    this.clearLongPressTimer();
    
    this.longPressTimer = setTimeout(() => {
      this.isDraggingEnabled = true;
      this.draggedIndex = index;
      button.setAttribute('draggable', 'true');
      button.style.cursor = 'grabbing';
      button.style.opacity = '0.7';
      button.style.transform = 'scale(1.05)';
      
      if (navigator.vibrate) {
        navigator.vibrate(50);
      }
    }, 500);
  }
  
  handleMouseUp(event) {
    this.clearLongPressTimer();
    
    if (this.isDraggingEnabled && !this.isActuallyDragging) {
      event.preventDefault();
      event.stopPropagation();
    }
    
    setTimeout(() => {
      if (!this.isActuallyDragging) {
        this.resetDragState();
      }
    }, 150);
  }
  
  handleDashboardDragStart(index, event) {
    if (!this.isDraggingEnabled || this.draggedIndex !== index) {
      event.preventDefault();
      event.stopPropagation();
      return false;
    }
    
    this.isActuallyDragging = true;
    this.draggedIndex = index;
    event.dataTransfer.effectAllowed = 'move';
    event.currentTarget.style.opacity = '0.4';
  }
  
  handleDashboardDragOver(event) {
    if (!this.isActuallyDragging) return;
    
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    event.currentTarget.style.borderColor = '#3B82F6';
    event.currentTarget.style.borderWidth = '2px';
    event.currentTarget.style.borderStyle = 'dashed';
  }
  
  handleDashboardDragLeave(event) {
    event.currentTarget.style.borderColor = '';
    event.currentTarget.style.borderWidth = '';
    event.currentTarget.style.borderStyle = '';
  }
  
  handleDashboardDrop(targetIndex, event) {
    event.preventDefault();
    event.currentTarget.style.borderColor = '';
    event.currentTarget.style.borderWidth = '';
    event.currentTarget.style.borderStyle = '';
    
    if (this.draggedIndex === null || this.draggedIndex === targetIndex) {
      this.draggedIndex = null;
      return;
    }
    
    const items = [...this.quickAccessItems];
    const temp = items[this.draggedIndex];
    items[this.draggedIndex] = items[targetIndex];
    items[targetIndex] = temp;
    
    this.quickAccessItems = items;
    this.draggedIndex = null;
    
    this.saveQuickAccess();
    this.render();
  }
  
  handleDashboardDragEnd(event) {
    event.currentTarget.style.opacity = '1';
    
    document.querySelectorAll('.quick-access-btn').forEach(el => {
      el.style.borderColor = '';
      el.style.borderWidth = '';
      el.style.borderStyle = '';
      el.style.opacity = '';
    });
    
    setTimeout(() => {
      this.resetDragState();
    }, 100);
  }
  
  handleButtonClick(section, title, event) {
    if (this.isDraggingEnabled || this.isActuallyDragging) {
      event.preventDefault();
      event.stopPropagation();
      return false;
    }
    
    if (window.navigation && window.navigation.navigateToSection) {
      window.navigation.navigateToSection(section, title);
    }
    return true;
  }
  
  handleModalDragStart(event, index) {
    this.draggedIndex = index;
    event.dataTransfer.effectAllowed = 'move';
    event.currentTarget.style.opacity = '0.4';
  }
  
  handleModalDragOver(event) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    event.currentTarget.style.borderColor = '#3B82F6';
    event.currentTarget.style.borderWidth = '2px';
  }
  
  handleModalDragLeave(event) {
    event.currentTarget.style.borderColor = 'transparent';
  }
  
  handleModalDragEnd(event) {
    event.currentTarget.style.opacity = '1';
    document.querySelectorAll('.modal-drag-item').forEach(el => {
      el.style.borderColor = 'transparent';
    });
  }
  
  handleModalDrop(event, targetIndex) {
    event.preventDefault();
    event.currentTarget.style.borderColor = 'transparent';
    
    if (this.draggedIndex === null || this.draggedIndex === targetIndex) {
      this.draggedIndex = null;
      return;
    }
    
    const items = [...this.quickAccessItems];
    const temp = items[this.draggedIndex];
    items[this.draggedIndex] = items[targetIndex];
    items[targetIndex] = temp;
    
    this.quickAccessItems = items;
    this.draggedIndex = null;
    
    this.renderModalContent();
  }
  
  async replaceItemInModal(index, newItemId) {
    if (index < 0 || index >= 6) return;
    
    this.quickAccessItems[index] = newItemId;
    this.renderModalContent();
  }
  
  async resetToDefaults() {
    const confirmed = await this.showAlert(
      'Reset to default quick access items for your role?',
      'Reset Quick Access'
    );
    
    if (confirmed) {
      this.useRoleDefaults();
      this.validateQuickAccessItems(); // Ensure defaults are valid for user's permissions
      this.renderModalContent();
    }
  }
  
  render() {
    const container = document.querySelector('.frame-3');
    if (!container) return;
    
    const items = this.quickAccessItems.map((itemId, index) => {
      const option = this.availableOptions[itemId];
      if (!option) return '';
      
      const color = this.positionColors[index];
      
      return `
        <button 
          class="quick-access-btn ${color} py-3 rounded-lg shadow-custom font-semibold hover:shadow-lg transition-all select-none cursor-pointer"
          data-index="${index}"
          draggable="false"
          style="touch-action: none;">
          ${option.label}
        </button>
      `;
    }).join('');
    
    container.innerHTML = `
      <div class="flex items-center justify-center gap-3 mb-6">
        <h4 class="text-xl font-bold text-navy">Quick Access</h4>
        <button 
          onclick="window.quickAccessManager.openModal()" 
          class="text-navy hover:text-green-600 transition-colors text-sm font-semibold"
          title="Edit">
          <i class="fa-solid fa-pen-to-square"></i>
        </button>
      </div>
      <div class="grid grid-cols-2 gap-6">
        ${items}
      </div>
    `;
    
    this.attachEventListeners();
  }
  
  attachEventListeners() {
    const buttons = document.querySelectorAll('.quick-access-btn');
    
    buttons.forEach((button, index) => {
      const option = this.availableOptions[this.quickAccessItems[index]];
      if (!option) return;
      
      // Remove any existing listeners by cloning
      const newButton = button.cloneNode(true);
      button.parentNode.replaceChild(newButton, button);
      
      // Long press for enabling drag
      newButton.addEventListener('mousedown', (e) => this.handleMouseDown(index, e));
      newButton.addEventListener('mouseup', (e) => this.handleMouseUp(e));
      newButton.addEventListener('mouseleave', (e) => this.handleMouseUp(e));
      
      newButton.addEventListener('touchstart', (e) => this.handleMouseDown(index, e), { passive: true });
      newButton.addEventListener('touchend', (e) => this.handleMouseUp(e));
      newButton.addEventListener('touchcancel', (e) => this.handleMouseUp(e));
      
      // Standard drag events (work after long press enables draggable)
      newButton.addEventListener('dragstart', (e) => this.handleDashboardDragStart(index, e));
      newButton.addEventListener('dragover', (e) => this.handleDashboardDragOver(e));
      newButton.addEventListener('dragleave', (e) => this.handleDashboardDragLeave(e));
      newButton.addEventListener('drop', (e) => this.handleDashboardDrop(index, e));
      newButton.addEventListener('dragend', (e) => this.handleDashboardDragEnd(e));
      
      // Click for navigation
      newButton.addEventListener('click', (e) => this.handleButtonClick(option.section, option.title, e));
    });
  }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  window.quickAccessManager = new QuickAccessManager();
  console.log('✅ Quick Access Manager initialized');
});


