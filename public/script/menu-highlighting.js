// ==================== ACTIVE MENU HIGHLIGHTING SYSTEM ====================

class MenuHighlighter {
  constructor() {
    this.currentSection = null;
    this.sectionToMenuMap = this.buildSectionMap();
    this.init();
  }

  init() {
    // Set initial active state based on URL hash
    this.updateActiveMenu();
    
    // Watch for hash changes
    window.addEventListener('hashchange', () => {
      console.log('Hash changed, updating menu');
      this.updateActiveMenu();
    });
    
    // Watch for navigation events
    document.addEventListener('sectionLoaded', (e) => {
      console.log('Section loaded event:', e.detail);
      this.currentSection = e.detail.sectionId;
      this.updateActiveMenu();
    });
    
    // Watch for submenu clicks
    document.addEventListener('click', (e) => {
      const submenuLink = e.target.closest('.submenu a[data-section]');
      if (submenuLink) {
        const sectionId = submenuLink.getAttribute('data-section');
        console.log('Submenu clicked:', sectionId);
        // Update immediately on click
        setTimeout(() => this.updateActiveMenu(), 50);
      }
    });
  }

  buildSectionMap() {
    // Map sections to their parent menus
    return {
      // Administration menu items
      'role-management': 'administration',
      'create-user': 'administration',
      'control-user': 'administration',
      'payroll-class-setup': 'administration',
      'switch-payroll-class': 'administration',
      'change-payroll-class': 'administration',
      'change-registration-number': 'administration',
      'report-requirement-setup': 'administration',
      'one-off-fixed-amount': 'administration',
      'individual-payment-input': 'administration',
      'irregular-one-off-calculations': 'administration',
      'irregular-one-off-reports': 'administration',
      'company-profile': 'administration',
      'monthly-yearly-processing': 'administration',
      'yearly-processing': 'administration',
      
      // Personnel Profile menu items
      'add-personnel': 'personel-profile',
      'current-personnel': 'personel-profile',
      'old-personnel': 'personel-profile',
      'view-personnel' : 'personel-profile',
      
      // Data Input menu items
      'payments-deductions': 'data-entry',
      'payments-deductions-upload': 'data-entry',
      'variation-payments': 'data-entry',
      'cumulative-payroll': 'data-entry',
      'input-documentation': 'data-entry',
      'arrears-calculations': 'data-entry',
      
      // File Update menu items
      'save-payroll-files': 'file-update',
      'changes-personnel-data': 'file-update',
      'input-variable-report': 'file-update',
      'master-file-update': 'file-update',
      'recall-payment-files': 'file-update',
      
      // Payroll Calculations menu items
      'payroll-calculations': 'payroll-calculations',
      'calculation-reports': 'payroll-calculations',
      
      // Reference Tables menu items
      'overtime-information': 'reference-tables',
      'command': 'reference-tables',
      'cash-payment': 'reference-tables',
      'tax-table-information': 'reference-tables',
      'salary-scale-information': 'reference-tables',
      'pay-element-description': 'reference-tables',
      'fixed-amount-rank': 'reference-tables',
      'mutually-exclusive': 'reference-tables',
      'pension-fund-administrator': 'reference-tables',
      'bank-details': 'reference-tables',
      'department': 'reference-tables',
      'state-codes': 'reference-tables',
      'local-government': 'reference-tables',
      
      // Utilities menu items
      'emolument-form-processing': 'utilities',
      'ippis-payments': 'utilities',
      'consolidated-payslip': 'utilities',
      'database-backup': 'utilities',
      'database-restore': 'utilities',
      
      // Reports menu items
      'pay-slips': 'reports',
      'payments-by-bank': 'reports',
      'analysis-of-earnings': 'reports',
      'loan-analysis': 'reports',
      'analysis-of-payments': 'reports',
      'tax-payments-by-state': 'reports',
      //'overtime-analysis-by-dept': 'reports',
      'payroll-register': 'reports',
      //'listing-of-payroll-files': 'reports',
      'payment-staff-list': 'reports',
      'national-housing-funds': 'reports',
      'nsitf': 'reports',
      'salary-summary': 'reports',
      //'analysis-of-normal-hours': 'reports',
      'salary-reconciliation': 'reports',
      'salary-history': 'reports',
      'control-sheet': 'reports',
      'payment-statistics': 'reports',
      'personnel-reports': 'reports',

      
      // Audit Trail menu items
      'salary-variance-analysis': 'audit-trail',
      'changes-in-personal-details': 'audit-trail',
      'variation-input-listings': 'audit-trail',
      'overpayment': 'audit-trail',
      'duplicate-account-number': 'audit-trail',
      'outof-range-payments': 'audit-trail'
    };
  }

  updateActiveMenu() {
    // Get current section from hash
    const hash = window.location.hash.substring(1);
    const sectionId = hash || this.currentSection;
    
    console.log('Updating active menu for section:', sectionId);
    
    // Clear all active states
    this.clearAllActiveStates();
    
    if (!sectionId) {
      console.log('No section ID, skipping highlight');
      return;
    }
    
    // Find and highlight the active submenu item
    const submenuLink = document.querySelector(`.submenu a[data-section="${sectionId}"]`);
    if (submenuLink) {
      console.log('Found submenu link, adding active class');
      submenuLink.classList.add('active');
    } else {
      console.log('No submenu link found for:', sectionId);
    }
    
    // Find and highlight the parent menu
    const parentMenuId = this.sectionToMenuMap[sectionId];
    console.log('Parent menu ID:', parentMenuId);
    
    if (parentMenuId) {
      const parentMenuItem = document.querySelector(`li[data-menu="${parentMenuId}"] > .nav-item`);
      if (parentMenuItem) {
        console.log('Found parent menu item, adding parent-active class');
        parentMenuItem.classList.add('parent-active');
      } else {
        console.log('No parent menu item found for:', parentMenuId);
      }
    }
  }

  clearAllActiveStates() {
    // Remove all active classes
    document.querySelectorAll('.nav-item.active, .nav-item.parent-active').forEach(item => {
      item.classList.remove('active', 'parent-active');
    });
    
    document.querySelectorAll('.submenu a.active').forEach(item => {
      item.classList.remove('active');
    });
  }

  setActiveSection(sectionId) {
    this.currentSection = sectionId;
    this.updateActiveMenu();
  }
}

// Initialize the menu highlighter
let menuHighlighter;
document.addEventListener('DOMContentLoaded', () => {
  menuHighlighter = new MenuHighlighter();
  
  // Make it globally accessible
  window.menuHighlighter = menuHighlighter;
});

// ==================== SIDEBAR CLICK TO LOCK EXPANDED STATE ====================

class SidebarExpandLock {
  constructor() {
    this.isLocked = false;
    this.init();
  }

  init() {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;

    // Only apply on desktop
    if (window.innerWidth >= 1024) {
      // Click sidebar to lock expanded state
      sidebar.addEventListener('click', (e) => {
        // Don't lock if clicking on nav items or links
        if (e.target.closest('.nav-item') || e.target.closest('a')) {
          return;
        }

        if (sidebar.classList.contains('desktop-hidden')) {
          this.toggleLock();
        }
      });

      // Add visual indicator when locked
      sidebar.addEventListener('mouseenter', () => {
        if (sidebar.classList.contains('desktop-hidden') && !this.isLocked) {
          sidebar.style.cursor = 'pointer';
        }
      });

      sidebar.addEventListener('mouseleave', () => {
        if (!this.isLocked) {
          sidebar.style.cursor = '';
        }
      });
    }

    // Reset on window resize
    window.addEventListener('resize', () => {
      if (window.innerWidth < 1024) {
        this.isLocked = false;
      }
    });
  }

  toggleLock() {
    const sidebar = document.getElementById('sidebar');
    
    if (!this.isLocked) {
      // Lock expanded state
      this.isLocked = true;
      sidebar.classList.remove('desktop-hidden');
      document.body.classList.add('sidebar-open');
      document.body.classList.remove('sidebar-closed');
      sidebar.style.cursor = '';
      
      // Add lock indicator
      this.showLockIndicator(true);
    } else {
      // Unlock (return to collapsed)
      this.isLocked = false;
      sidebar.classList.add('desktop-hidden');
      document.body.classList.add('sidebar-closed');
      document.body.classList.remove('sidebar-open');
      
      // Remove lock indicator
      this.showLockIndicator(false);
    }
  }

  showLockIndicator(show) {
    // Optional: Add visual feedback that sidebar is locked
    const sidebar = document.getElementById('sidebar');
    if (show) {
      sidebar.style.boxShadow = '4px 0 12px rgba(251, 191, 36, 0.3)';
    } else {
      sidebar.style.boxShadow = '';
    }
  }
}

// Initialize sidebar expand lock
let sidebarExpandLock;
document.addEventListener('DOMContentLoaded', () => {
  sidebarExpandLock = new SidebarExpandLock();
  window.sidebarExpandLock = sidebarExpandLock;
});

// ==================== INTEGRATE WITH EXISTING NAVIGATION SYSTEM ====================

// Wait for NavigationSystem to be available and patch it
document.addEventListener('DOMContentLoaded', () => {
  // Poll for NavigationSystem availability
  const checkNavigationSystem = setInterval(() => {
    if (window.navigation && window.navigation.navigateToSection) {
      clearInterval(checkNavigationSystem);
      console.log('NavigationSystem found, patching...');
      
      // Store original method
      const originalNavigate = window.navigation.navigateToSection.bind(window.navigation);
      
      // Override with patched version
      window.navigation.navigateToSection = async function(sectionId, sectionName, state = {}) {
        console.log('navigateToSection called:', sectionId, sectionName);
        
        // Call original method
        const result = await originalNavigate(sectionId, sectionName, state);
        
        // Update menu highlighting immediately
        if (window.menuHighlighter) {
          window.menuHighlighter.setActiveSection(sectionId);
        }
        
        // Dispatch custom event
        const event = new CustomEvent('sectionLoaded', {
          detail: { sectionId, sectionName }
        });
        document.dispatchEvent(event);
        
        return result;
      };
      
      console.log('NavigationSystem patched successfully');
    }
  }, 100);
  
  // Stop checking after 5 seconds
  setTimeout(() => clearInterval(checkNavigationSystem), 5000);
});

// Also listen for submenu link clicks directly
document.addEventListener('click', (e) => {
  const link = e.target.closest('.submenu a[data-section]');
  if (link) {
    const sectionId = link.getAttribute('data-section');
    console.log('Direct submenu click detected:', sectionId);
    
    // Update highlighting after a short delay to allow navigation
    setTimeout(() => {
      if (window.menuHighlighter) {
        window.menuHighlighter.setActiveSection(sectionId);
      }
    }, 100);
  }
});

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { MenuHighlighter, SidebarExpandLock };
}


