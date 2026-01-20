// ============================================
// This filters the sidebar based on user's role permissions
// ============================================

// Global variable to store user's accessible menus
let userAccessibleMenus = [];

// Fetch user's accessible menus on page load
async function loadUserMenuPermissions() {
  try {
    const token = localStorage.getItem('token');
    const res = await fetch('roles/my-menus', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (!res.ok) {
      console.error('Failed to fetch user menus');
      return;
    }
    
    userAccessibleMenus = await res.json();
    filterSidebarMenus();
    
  } catch (err) {
    console.error('Error loading menu permissions:', err);
  }
}

// Filter sidebar based on permissions
function filterSidebarMenus() {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;
  
  // Get all menu keys user has access to
  const accessibleKeys = new Set(userAccessibleMenus.map(m => m.menu_key));
  
  // Get all parent menu keys (if user has access to child, they need to see parent)
  const parentKeys = new Set();
  userAccessibleMenus.forEach(menu => {
    if (menu.parent_id) {
      const parent = userAccessibleMenus.find(m => m.menu_key === getParentKey(menu.menu_key));
      if (parent) {
        parentKeys.add(parent.menu_key);
      }
    }
  });
  
  // Combine both sets
  accessibleKeys.forEach(key => parentKeys.add(key));
  
  // Hide/show main menu items (li with data-menu attribute)
  const mainMenus = sidebar.querySelectorAll('li[data-menu]');
  mainMenus.forEach(menuLi => {
    const menuKey = menuLi.getAttribute('data-menu');
    
    if (accessibleKeys.has(menuKey) || parentKeys.has(menuKey)) {
      menuLi.style.display = '';
      
      // Filter submenu items
      const submenuItems = menuLi.querySelectorAll('a[data-section]');
      submenuItems.forEach(item => {
        const sectionKey = item.getAttribute('data-section');
        const parentLi = item.closest('li');
        
        if (accessibleKeys.has(sectionKey)) {
          if (parentLi) parentLi.style.display = '';
        } else {
          if (parentLi) parentLi.style.display = 'none';
        }
      });
      
      // Check if submenu has any visible items
      const submenu = menuLi.querySelector('.submenu');
      if (submenu) {
        const visibleItems = Array.from(submenu.querySelectorAll('li')).filter(
          li => li.style.display !== 'none'
        );
        
        // If no visible items in submenu, hide the entire menu
        if (visibleItems.length === 0) {
          menuLi.style.display = 'none';
        }
      }
    } else {
      menuLi.style.display = 'none';
    }
  });
  
  // Special handling for dashboard (always visible or based on permission)
  const dashboardLi = sidebar.querySelector('li:not([data-menu])');
  if (dashboardLi && !accessibleKeys.has('dashboard')) {
    // Uncomment the line below if you want to hide dashboard for users without permission
    // dashboardLi.style.display = 'none';
  }
}

// Helper function to determine parent key from menu structure
function getParentKey(childKey) {
  const menuHierarchy = {
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
  
  return menuHierarchy[childKey] || null;
}

// Call this function when page loads
document.addEventListener('DOMContentLoaded', () => {
  loadUserMenuPermissions();
});

// Also expose globally in case you need to refresh permissions
window.refreshMenuPermissions = loadUserMenuPermissions;


// ============================================
// BONUS: Function to check if user has access to a specific menu
// Use this before showing sections or performing actions
// ============================================
function userHasAccess(menuKey) {
  return userAccessibleMenus.some(menu => menu.menu_key === menuKey);
}

// Example usage:
// if (userHasAccess('role-management')) {
//   // Show role management section
// } else {
//   // Show access denied message
// }


