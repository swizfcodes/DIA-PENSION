// Navigation handler for submenu items
class NavigationSystem {
  constructor() {
    this.currentSection = null;
    this.cache = new Map(); // Cache loaded content
    this.state = {}; // State for section navigation
    this.isNavigating = false; // Prevent race conditions
    this.navigationHistory = [];
    this.init();
  }

  init() {
    this.setupSubmenuNavigation();
    this.setupHistoryHandler();
    this.handleInitialLoad();
  }

  setupSubmenuNavigation() {
    document.querySelectorAll('.submenu ul li a[data-section]').forEach(link => {
      link.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        const sectionId = link.getAttribute('data-section');
        const sectionName = link.textContent.trim();
        
        if (sectionId) {
          // CHECK EDIT MODE BEFORE SHOWING LOADING STATE
          const isEditMode = localStorage.getItem('isEditMode') === 'true';
          const currentHash = window.location.hash.substring(1);
          
          // If clicking add-personnel while already in edit mode, keep edit mode
          if (sectionId === 'add-personnel' && isEditMode && currentHash === 'add-personnel') {
            // Already on add-personnel in edit mode, do nothing
            return;
          }
          
          if (isEditMode && currentHash === 'add-personnel' && sectionId !== 'add-personnel') {
            const confirmed = confirm(
              'You are currently editing a personnel record. ' +
              'Any unsaved changes will be lost. Do you want to continue?'
            );
            
            if (!confirmed) {
              console.log('Navigation cancelled by user');
              return;
            }
            
            // User confirmed, clean up edit state
            localStorage.removeItem('editing_employee_id');
            localStorage.removeItem('isEditMode');
            localStorage.removeItem('navigatedFromCurrentPersonnel');
            
            if (window.PersonnelAPI?.setCreateMode) {
              window.PersonnelAPI.setCreateMode();
            }
          }
          
          // Close all submenus
          if (typeof closeAll === 'function') {
            closeAll();
          }
          
          // Hide mobile menu
          this.hideMobileMenu();
          
          // Show loading state (use "Edit Personnel" if in edit mode and going to add-personnel)
          const displayName = (sectionId === 'add-personnel' && isEditMode) 
            ? 'Edit Personnel' 
            : sectionName;
          this.showLoadingState(displayName);
          
          // Navigate to section
          await this.navigateToSection(sectionId, displayName);
        }
      });
    });
  }

  async hideMobileMenu(link) {
    if (window.innerWidth <= 1023) {
      const sidebar = document.querySelector('#sidebar');

      if (link) {
        const sectionId = link.getAttribute('data-section');
        const sectionName = link.textContent.trim();

        if (sectionId) {
          // Close all submenus first
          if (typeof closeAll === 'function') {
            closeAll();
          }

          // Show loading state
          this.showLoadingState(sectionName);

          // Navigate to section
          await this.navigateToSection(sectionId, sectionName);
        }
      }

      // Finally hide sidebar
      if (sidebar) {
        closeSidebar();
        removeOverlay();
        removeSidebarOverlay();
      }

      if (sidebarOverlay) {
        removeOverlay();
        removeSidebarOverlay();
      }
    }
  }

  showLoadingState(sectionName) {
    const mainContent = document.querySelector('main');
    if (mainContent) {
      // Prevent flicker by checking if already showing loading
      const isAlreadyLoading = mainContent.querySelector('.animate-grow-up');
      if (isAlreadyLoading) return;
      
      // Hide immediately
      mainContent.style.opacity = '0';
      mainContent.style.transition = 'none';
      
      mainContent.innerHTML = `
        <div class="mt-6">
          <h2 class="text-2xl lg:text-3xl font-bold text-navy mb-4">${sectionName}</h2>
          <div class="bg-transparent rounded-xl shadow-sm border border-gray-100"> 
            <div class="flex items-center justify-center p-6"> 
              <div class="relative w-10 h-10 mr-3">
                <div class="absolute left-1 w-[6px] bg-green-600 rounded animate-grow-up"></div>

                <div class="absolute right-1 w-[6px] bg-green-600 rounded animate-grow-down [animation-delay:0.3s]"></div>

                <div class="absolute top-1/2 left-1 h-[6px] bg-green-600 rounded animate-expand [animation-delay:0.6s] -translate-y-1/2"></div>
              </div>
              <span class="text-gray-600">Loading...</span>
            </div>
          </div>
        </div>
      `;
            
      window.scrollTo({ top: 0, behavior: 'instant' });
      
      // Fade in the loading state
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          mainContent.style.transition = 'opacity 0.2s ease';
          mainContent.style.opacity = '1';
        });
      });
    }
  }

  async navigateToSection(sectionId, sectionName, state = {}) {
    // Prevent duplicate navigation
    if (this.isNavigating) {
      console.log('Navigation already in progress');
      return;
    }

    try {
      this.isNavigating = true;

      // Check if content exists on current page
      const existingElement = document.querySelector(`#${sectionId}`);
      if (existingElement) {
        existingElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }

      // Store current section in history before navigating
      if (this.currentSection && this.currentSection !== sectionId) {
        // Get the section name from history state or derive it
        const currentSectionName = this.getSectionNameFromId(this.currentSection);
        this.navigationHistory.push({
          sectionId: this.currentSection,
          sectionName: currentSectionName
        });
        console.log('Added to history:', this.currentSection);
      }

      // Store the navigation state
      this.state = state;

      // Load content from file
      const content = await this.loadSectionContent(sectionId, sectionName);
      this.renderSection(sectionName, content);
      this.updateHistory(sectionId, sectionName);
      this.currentSection = sectionId;

      // Initialize any dynamic behavior based on state
      if (sectionId === 'add-personnel' && state.isEditMode) {
        const batchButton = document.getElementById('tab-batch');
        if (batchButton) {
          batchButton.disabled = true;
          batchButton.classList.add('opacity-50', 'cursor-not-allowed');
          batchButton.classList.remove('hover:bg-green-600');
        }
      }

    } catch (error) {
      this.showErrorState(sectionName, error);
    } finally {
      this.isNavigating = false;
    }
  }

  async loadSectionContent(sectionId, sectionName) {
    // Check cache first
    if (this.cache.has(sectionId)) {
      return this.cache.get(sectionId);
    }

    // Try to load from multiple possible locations
    const possiblePaths = [
      `sections/${sectionId}.html`
    ];

    for (const path of possiblePaths) {
      try {
        const response = await fetch(path);
        if (response.ok) {
          const content = await response.text();
          // Cache the content
          this.cache.set(sectionId, content);
          return content;
        }
      } catch (error) {
        console.warn(`Failed to load from ${path}:`, error);
      }
    }

    // If no file found, return default content
    return this.getDefaultContent(sectionId, sectionName);
  }

  getDefaultContent(sectionId, sectionName) {
    return `
      <div class="text-center py-12">
        <div class="max-w-md mx-auto">
          <div class="mb-4">
            <svg class="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <h3 class="text-lg font-medium text-gray-900 mb-2">${sectionName}</h3>
          <p class="text-gray-600 mb-4">This section is under development.</p>
          <p class="text-sm text-gray-500">Section ID: ${sectionId}</p>
          <div class="mt-6">
            <p class="text-sm text-gray-600">Expected file locations:</p>
            <ul class="text-xs text-gray-500 mt-2 space-y-1">
              <li>sections/${sectionId}.html</li>
            </ul>
          </div>
        </div>
      </div>
    `;
  }

  renderSection(sectionName, content) {
    const mainContent = document.querySelector('main');
    if (mainContent) {
      // Show main if it was hidden
      mainContent.style.display = 'block';
      mainContent.style.opacity = '0';
      
      mainContent.innerHTML = `
        <div class="mt-6">
          <h2 class="text-2xl lg:text-3xl font-bold text-navy mb-4">${sectionName}</h2>
          <div class="bg-white/10 rounded-xl shadow-lg border border-gray-100"> 
            ${content}
          </div>

          <div class="my-6">
            <button 
              onclick="window.navigation.goBack()" 
              class="bg-yellow-500 hover:bg-red-500 text-white font-medium px-6 py-2 rounded-lg transition-colors duration-200 ease-in-out shadow-md hover:shadow-lg flex items-center gap-2"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
                  d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              Return
            </button>
          </div>
        </div>
      `;

      window.scrollTo({ top: 0, behavior: 'instant' });
      this.initializeLoadedScripts();

      // Smooth fade-in with animation
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          mainContent.style.transition = 'opacity 0.3s ease';
          mainContent.style.opacity = '1';

          // Apply the fade-up animation
          const container = mainContent.querySelector('.mt-6');
          if (container) {
            container.classList.add('animate-fade-up');

            // Remove fade-up transform after animation completes
            container.addEventListener('animationend', (e) => {
              if (e.animationName === 'fadeInUp' || e.animationName === 'fadeInUpInner') {
                container.classList.remove('animate-fade-up');
                container.style.transform = 'none'; // ensure no transform remains
              }
            }, { once: true });
          }
        });
      });
    }
  }

  // New method to go back to previous section
  goBack() {
    console.log('Going back, history length:', this.navigationHistory.length);
    
    if (this.navigationHistory.length > 0) {
      // Get the last section from history
      const previousSection = this.navigationHistory.pop();
      console.log('Returning to:', previousSection);
      
      // Navigate back to previous section (don't add to history again)
      this.navigateToSectionWithoutHistory(previousSection.sectionId, previousSection.sectionName);
    } else {
      // No history, return to dashboard
      console.log('No history, returning to dashboard');
      this.returnToDashboard();
    }
  }

  // Navigate without adding to history (for back navigation)
  async navigateToSectionWithoutHistory(sectionId, sectionName, state = {}) {
    if (this.isNavigating) {
      console.log('Navigation already in progress');
      return;
    }

    try {
      this.isNavigating = true;

      // Store the navigation state
      this.state = state;

      // Load content from file
      const content = await this.loadSectionContent(sectionId, sectionName);
      this.renderSection(sectionName, content);
      this.updateHistory(sectionId, sectionName);
      this.currentSection = sectionId;

      // UPDATE MENU HIGHLIGHTING
      if (window.menuHighlighter) {
        window.menuHighlighter.setActiveSection(sectionId);
      }

      // DISPATCH EVENT FOR MENU HIGHLIGHTER
      const event = new CustomEvent('sectionLoaded', {
        detail: { sectionId, sectionName }
      });
      document.dispatchEvent(event);

    } catch (error) {
      this.showErrorState(sectionName, error);
    } finally {
      this.isNavigating = false;
    }
  }


  initializeLoadedScripts() {
    // Execute any scripts in the newly loaded content
    const scripts = document.querySelectorAll('main script');
    scripts.forEach(script => {
      if (script.src) {
        // External script
        const newScript = document.createElement('script');
        newScript.src = script.src;
        newScript.onload = () => console.log(`Loaded script: ${script.src}`);
        document.head.appendChild(newScript);
      } else {
        // Inline script
        try {
          eval(script.textContent);
        } catch (error) {
          console.error('Error executing inline script:', error);
        }
      }
    });
  }

  showErrorState(sectionName, error) {
    const mainContent = document.querySelector('main');
    if (mainContent) {
      mainContent.innerHTML = `
        <div class="mt-6">
          <h2 class="text-2xl lg:text-3xl font-bold text-navy mb-4">${sectionName}</h2>
          <div class="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
            <div class="text-center py-12">
              <div class="text-red-500 mb-4">
                <svg class="mx-auto h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              </div>
              <h3 class="text-lg font-medium text-gray-900 mb-2">Failed to Load Content</h3>
              <p class="text-gray-600 mb-4">${error.message}</p>
              <button onclick="window.navigation.navigateToSection('${this.currentSection}', '${sectionName}')" 
              class="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700">
                Retry
              </button>
            </div>
          </div>

          <!-- Return to Dashboard Button -->
          <div class="mb-4">
            <button 
              onclick="window.navigation.goBack()" 
              class="bg-yellow-500 hover:bg-red-500 text-white font-medium px-6 py-2 rounded-lg transition-colors duration-200 ease-in-out shadow-md hover:shadow-lg flex items-center gap-2"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path>
              </svg>
              Return to Dashboard
            </button>
          </div>
        </div>
      `;
    }
  }

  // New method to handle return to dashboard
  returnToDashboard() {
    // Clear current section
    this.currentSection = null;
    
    // Clear navigation history
    this.navigationHistory = [];

    // CLEAR MENU HIGHLIGHTING
    if (window.menuHighlighter) {
      window.menuHighlighter.clearAllActiveStates();
    }
    
    // Update URL to remove hash
    window.history.pushState({}, '', window.location.pathname);
    
    // Clear main content or redirect to dashboard
    const mainContent = document.querySelector('main');
    if (mainContent) {
      mainContent.innerHTML = `
        <div class="mt-6">
          <div class="text-center py-12">
            <h2 class="text-2xl lg:text-3xl font-bold text-navy mb-4">Dashboard</h2>
            <p class="text-gray-600">Welcome back! Select a section from the sidebar to get started.</p>
          </div>
        </div>
      `;
     window.location.href = 'dashboard.html';
    }
    
    // Update page title
    document.title = 'DIA — Dashboard';
  }

  updateHistory(sectionId, sectionName) {
    document.title = `DIA — ${sectionName}`;
    // Store both sectionId and original sectionName in history state
    window.history.pushState(
      { 
        section: sectionName, 
        sectionId: sectionId 
      }, 
      '', 
      `#${sectionId}`
    );
  }

  setupHistoryHandler() {
    window.addEventListener('popstate', (event) => {
      if (event.state && event.state.section && event.state.sectionId) {
        // Use the original section name stored in history state
        this.navigateToSectionWithoutHistory(
          event.state.sectionId, 
          event.state.section  // Use original section name, not converted from ID
        );
      } else {
        // Handle back to dashboard
        this.returnToDashboard();
      }
    });
  }

  handleInitialLoad() {
    // Handle initial page load with hash
    const hash = window.location.hash;
    if (hash && hash.length > 1) {
      const sectionId = hash.substring(1);
      
      // Hide dashboard content IMMEDIATELY before any rendering
      const mainContent = document.querySelector('main');
      if (mainContent) {
        mainContent.style.opacity = '0';
        mainContent.style.display = 'none';
      }
      
      // Get section name
      let sectionName = null;
      if (window.history.state && window.history.state.section) {
        sectionName = window.history.state.section;
      } else {
        const linkElement = document.querySelector(`a[data-section="${sectionId}"]`);
        if (linkElement) {
          sectionName = linkElement.textContent.trim();
        } else {
          sectionName = this.getSectionNameFromId(sectionId);
        }
      }
      
      // Load section immediately
      this.navigateToSection(sectionId, sectionName);
    }
  }

  getSectionNameFromId(sectionId) {
    // Convert kebab-case to Title Case
    return sectionId
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  // Public method to clear cache
  clearCache() {
    this.cache.clear();
    console.log('Navigation cache cleared');
  }

  // Public method to preload sections
  async preloadSections(sectionIds) {
    const loadPromises = sectionIds.map(sectionId => 
      this.loadSectionContent(sectionId, this.getSectionNameFromId(sectionId))
    );
    
    try {
      await Promise.all(loadPromises);
      console.log('Sections preloaded:', sectionIds);
    } catch (error) {
      console.warn('Some sections failed to preload:', error);
    }
  }
}

// Initialize navigation system when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
  // Make navigation system globally accessible
  window.navigation = new NavigationSystem();
});

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
  module.exports = NavigationSystem;
}


