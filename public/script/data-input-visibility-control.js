// Data Input Menu Visibility Control
// This script manages the visibility of the Data Input menu based on payroll status (BT05)

(function() {
  let currentPayrollStage = 0;
  const DATA_INPUT_HIDDEN_STAGE = 666; // Stage when data input should be hidden

  // 1. Get references to BOTH menu elements
  const dataInputMenu = document.querySelector('li[data-menu="data-entry"]');
  // New: Get the Personnel Profile menu element
  const personnelProfileMenu = document.querySelector('li[data-menu="personel-profile"]');

  if (!dataInputMenu) {
    console.warn('Data Input menu (data-entry) not found.');
    return;
  }
  
  // Note: We don't exit if personnelProfileMenu isn't found, just warn.
  if (!personnelProfileMenu) {
    console.warn('Personnel Profile menu (personel-profile) not found. Only Data Input visibility will be managed.');
  }

  /**
   * Fetch current payroll status from server
   */
  async function loadPayrollStatus() {
    try {
      const token = localStorage.getItem('token') || 'demo-token';
      const res = await fetch("/status-payroll", { 
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}` 
        }
      });
      
      if (!res.ok) throw new Error("Unable to fetch payroll status");
      const data = await res.json();
      currentPayrollStage = data?.sun || 0;
      
      console.log('Payroll Status Loaded:', currentPayrollStage);
      updateMenuVisibility(); // Renamed function for clarity
      
    } catch (err) {
      console.error("Error fetching payroll status:", err.message);
    }
  }

  /**
   * 2. Update menu visibility for BOTH elements
   */
  function updateMenuVisibility() {
    const shouldHide = currentPayrollStage >= DATA_INPUT_HIDDEN_STAGE;
    const menuContainer = document.querySelector('ul.flex.flex-col');
    
    // Handle Data Input Menu
    dataInputMenu.classList[shouldHide ? 'add' : 'remove']('hidden');
    
    // Handle Personnel Profile Menu
    if (personnelProfileMenu) {
      personnelProfileMenu.classList[shouldHide ? 'add' : 'remove']('hidden');
    }
    
    // Adjust gap based on visibility
    if (menuContainer) {
      if (shouldHide) {
        // When items are hidden, use larger gap
        menuContainer.classList.remove('gap-[1.1rem]');
        menuContainer.classList.add('gap-8');
      } else {
        // When items are visible, use smaller gap
        menuContainer.classList.remove('gap-8');
        menuContainer.classList.add('gap-[1.1rem]');
      }
    }
    
    if (shouldHide) {
      console.log(`✓ Menus **hidden** - Payroll files saved (stage: ${currentPayrollStage})`);
    } else {
      console.log(`✓ Menus **visible** - Data entry reopened (stage: ${currentPayrollStage})`);
    }
  }

  /**
   * Listen for custom events from Save Payroll and Recall Payment pages
   */
  window.addEventListener('payrollStatusChanged', function(event) {
    console.log('Payroll status change detected:', event.detail);
    if (event.detail && typeof event.detail.stage === 'number') {
      currentPayrollStage = event.detail.stage;
      updateMenuVisibility();
    } else {
      // Reload status if no stage provided
      loadPayrollStatus();
    }
  });

  /**
   * Public method to manually refresh menu visibility
   */
  window.refreshMenuVisibility = function() {
    loadPayrollStatus();
  };

  /**
   * Public method to get current payroll stage
   */
  window.getCurrentPayrollStage = function() {
    return currentPayrollStage;
  };

  // Initialize on page load
  document.addEventListener('DOMContentLoaded', function() {
    loadPayrollStatus();
  });

  // Also load immediately if DOM is already ready
  if (document.readyState !== 'loading') {
    loadPayrollStatus();
  }

  // Periodic check every 30 seconds to ensure sync
  setInterval(loadPayrollStatus, 30000);
})();


