tailwind.config = {
  theme: {
    extend: {
      //darkMode: 'class',
      maxWidth: { 'layout': '1440px' },
      colors: {
      'navy': '#15803d',
      'warning': '#f6b409',
      'success': '#047014'
      },
      screens: {
      'xs': '640px',   // triggers at 640px
      'custom': '766px' // triggers at 766px
      },
      boxShadow: {
      'custom': '0 2px 5px 0 rgba(0,0,0,0.08)',
      },
      keyframes: {
        "grow-up": { "0%": { height: "0" }, "100%": { height: "100%" } },
        "grow-down": { "0%": { height: "0", bottom: "0" }, "100%": { height: "100%" } },
        "expand": { "0%": { width: "0" }, "100%": { width: "100%" } },
      },
      animation: {
        "grow-up": "grow-up 0.8s ease-out forwards",
        "grow-down": "grow-down 0.8s ease-out forwards",
        "expand": "expand 0.8s ease-out forwards",
      }
    }
  }
};

(function() {
  // Prevent any rendering until state is ready
  const width = window.innerWidth;
  
  window.addEventListener('DOMContentLoaded', function() {
    const body = document.body;
    const sidebar = document.getElementById('sidebar');
    
    // Set sidebar state immediately
    if (width <= 1200 && width >= 1024) {
      sidebar?.classList.add('desktop-hidden');
      body.classList.add('sidebar-closed');
    } else if (width > 1200) {
      body.classList.add('sidebar-open');
    }
    
    // Hide dashboard content if we have a hash (navigating to section)
    const hash = window.location.hash;
    if (hash && hash.length > 1) {
      const mainContent = document.querySelector('main');
      if (mainContent) {
        mainContent.style.display = 'none'; // Hide dashboard immediately
      }
    }
    
    // Make visible with single animation
    requestAnimationFrame(() => {
      document.documentElement.classList.add('ready');
      body.classList.add('initialized');
    });
  });
})();

// keep sidebar toggle for small screens (does not change layout structure on lg)
const btn = document.getElementById('menu-toggle');
const sidebarEl = document.getElementById('sidebar');
const mainContainer = document.querySelector('main'); // or your main content container

let sidebarOverlay = null;

function createSidebarOverlay() {
  if (sidebarOverlay) return sidebarOverlay;
  sidebarOverlay = document.createElement('div');
  sidebarOverlay.className = 'sidebar-overlay';
  sidebarOverlay.style.zIndex = '30'; // Lower than submenu overlay (40)
  sidebarOverlay.addEventListener('click', closeSidebar);
  return sidebarOverlay;
}

function removeSidebarOverlay() {
  if (sidebarOverlay) {
    sidebarOverlay.remove();
    sidebarOverlay = null;
  }
}

function closeSidebar() {
  if (window.innerWidth < 1024) {
    // Mobile behavior
    sidebarEl.classList.remove('sidebar-visible');
    removeSidebarOverlay();
    document.body.classList.remove('no-scroll');
  } else {
    // Desktop behavior - just hide sidebar and add centering class
    sidebarEl.classList.add('desktop-hidden');
    document.body.classList.add('sidebar-closed');
    document.body.classList.remove('sidebar-open');
  }
}

function openSidebar() {
  if (window.innerWidth < 1024) {
    // Mobile behavior
    sidebarEl.classList.add('sidebar-visible');
    document.body.appendChild(createSidebarOverlay());
    document.body.classList.add('no-scroll');
  } else {
    // Desktop behavior - show sidebar and remove centering
    sidebarEl.classList.remove('desktop-hidden');
    document.body.classList.add('sidebar-open');
    document.body.classList.remove('sidebar-closed');
  }
}

// Save sidebar state (lg screens only)
async function saveSidebarState() {
  if (window.innerWidth < 1200) return; // Only save on lg screens
  
  const isCollapsed = sidebarEl.classList.contains('desktop-hidden');
  
  try {
    const token = localStorage.getItem('token');
    await fetch('/preferences/sidebar/save', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ sidebarCollapsed: isCollapsed })
    });
  } catch (error) {
    console.error('Failed to save sidebar state:', error);
  }
}

// Load sidebar state on page load
async function loadSidebarState() {
  const width = window.innerWidth;
  
  // Only apply saved state on full desktop (>= 1200px)
  if (width < 1200) {
    console.log('Not full desktop - skipping saved state');
    
    if (width >= 1024) {
      // Icon mode: force collapsed
      sidebarEl.classList.add('desktop-hidden');
      document.body.classList.add('sidebar-closed');
      document.body.classList.remove('sidebar-open');
    }
    return;
  }
  
  try {
    const token = localStorage.getItem('token');
    const response = await fetch('/preferences/sidebar', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    
    const data = await response.json();
    console.log('Loaded sidebar state:', data);
    
    if (data.success) {
      if (data.sidebarCollapsed) {
        // User prefers collapsed
        sidebarEl.classList.add('desktop-hidden');
        document.body.classList.add('sidebar-closed');
        document.body.classList.remove('sidebar-open');
        console.log('✅ Applied collapsed state');
      } else {
        // User prefers expanded
        sidebarEl.classList.remove('desktop-hidden');
        document.body.classList.add('sidebar-open');
        document.body.classList.remove('sidebar-closed');
        console.log('✅ Applied expanded state');
      }
    } else {
      // No saved state: default to expanded on 1200+
      sidebarEl.classList.remove('desktop-hidden');
      document.body.classList.add('sidebar-open');
      document.body.classList.remove('sidebar-closed');
    }
  } catch (error) {
    console.error('Failed to load sidebar state:', error);
  }
}

// Modify toggleSidebar to save state:
function toggleSidebar() {
  const isOpen = window.innerWidth < 1024 
    ? sidebarEl.classList.contains('sidebar-visible')
    : !sidebarEl.classList.contains('desktop-hidden');
    
  if (isOpen) {
    closeSidebar();
  } else {
    openSidebar();
  }
  
  // Save state for lg screens only
  if (window.innerWidth >= 1200) {
    saveSidebarState();
  }
}

btn?.addEventListener('click', toggleSidebar);

// Handle window resize with debouncing
let resizeTimeout;
let previousWidth = window.innerWidth;

window.addEventListener('resize', () => {
  clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(async () => {
    const currentWidth = window.innerWidth;
    const wasLargeScreen = previousWidth >= 1200;
    const isLargeScreen = currentWidth >= 1200;  
    const wasIconMode = previousWidth >= 1024 && previousWidth < 1200;
    const isIconMode = currentWidth >= 1024 && currentWidth < 1200;
    
    removeSidebarOverlay();
    document.body.classList.remove('no-scroll');
    
    if (previousWidth < 1024 && currentWidth >= 1024) {
      // Moving FROM mobile TO desktop (1024+)
      console.log('Transitioning from mobile to desktop');
      sidebarEl.classList.remove('sidebar-visible');
      
      if (currentWidth < 1200) {
        // Entering icon mode (1024-1199)
        console.log('Entering icon mode (1024-1199)');
        sidebarEl.classList.add('desktop-hidden');
        document.body.classList.add('sidebar-closed');
        document.body.classList.remove('sidebar-open');
      } else {
        // Entering full desktop (1200+)
        await loadSidebarState();
      }
      
    } else if (previousWidth >= 1024 && currentWidth < 1024) {
      // Moving FROM desktop TO mobile
      console.log('Transitioning from desktop to mobile');
      
      // Reset desktop classes
      sidebarEl.classList.remove('desktop-hidden');
      document.body.classList.remove('sidebar-closed', 'sidebar-open');
      sidebarEl.classList.remove('sidebar-visible');
      
    } else if (!wasLargeScreen && isLargeScreen) {
      // Moving FROM icon mode (1024-1199) TO full desktop (1200+)
      console.log('Transitioning from icon mode to full desktop');
      await loadSidebarState();
      
    } else if (wasLargeScreen && !isLargeScreen && isIconMode) {
      // Moving FROM full desktop (1200+) TO icon mode (1024-1199)
      console.log('Transitioning from full desktop to icon mode');
      
      // Force icon mode
      sidebarEl.classList.add('desktop-hidden');
      document.body.classList.add('sidebar-closed');
      document.body.classList.remove('sidebar-open');
      
    } else if (isLargeScreen) {
      // Staying on full desktop (1200+) - maintain current state
      const isCollapsed = sidebarEl.classList.contains('desktop-hidden');
      
      if (isCollapsed) {
        document.body.classList.add('sidebar-closed');
        document.body.classList.remove('sidebar-open');
      } else {
        document.body.classList.add('sidebar-open');
        document.body.classList.remove('sidebar-closed');
      }
    } else if (isIconMode) {
      // Staying in icon mode (1024-1199) - always collapsed
      sidebarEl.classList.add('desktop-hidden');
      document.body.classList.add('sidebar-closed');
      document.body.classList.remove('sidebar-open');
    }
    
    previousWidth = currentWidth;
  }, 150);
});

// Initialize sidebar state on page load
document.addEventListener('DOMContentLoaded', async () => {
  const width = window.innerWidth;
  
  if (width >= 1200) {
    // Full desktop: load saved state
    await loadSidebarState();
  } else if (width >= 1024) {
    // Icon mode: force collapsed
    sidebarEl?.classList.add('desktop-hidden');
    document.body.classList.add('sidebar-closed');
    document.body.classList.remove('sidebar-open');
  } else {
    // Mobile/tablet: ensure sidebar is hidden
    sidebarEl?.classList.remove('sidebar-visible');
    document.body.classList.remove('sidebar-closed', 'sidebar-open');
  }
  
  // Store initial width
  previousWidth = width;
});

// Toggle submenu on click (touch support) and close when clicking outside.
const submenuButtons = document.querySelectorAll('.has-submenu');
const sidebar = document.getElementById('sidebar');

let overlay = null;
function createOverlay(){
  if (overlay && document.body.contains(overlay)) return overlay;
  overlay = document.createElement('div');
  overlay.id = 'submenu-overlay';
  Object.assign(overlay.style, {
    position: 'fixed',
    inset: '0',
    background: 'rgba(0,0,0,0.5)',
    zIndex: 40,
    cursor: 'pointer'
  });
  overlay.addEventListener('click', closeAll);
  return overlay;
}
function removeOverlay(){
  if (overlay) {
    overlay.remove();
  }
}

function calcBaseLeft(){
  if (sidebar) {
    const sRect = sidebar.getBoundingClientRect();
    return Math.round(sRect.right + 3);
  }
  return 8;
}

function positionSubmenu(btn, submenu){
  submenu.style.position = 'fixed';
  submenu.style.zIndex = 50;
  submenu.style.maxWidth = '320px';
  submenu.style.whiteSpace = 'nowrap';

  // Make sure submenu is attached to body for correct z-index
  if (submenu.parentNode !== document.body) {
    document.body.appendChild(submenu);
  }

  const rect = btn.getBoundingClientRect();
  
  if (window.innerWidth < 768) {
    // Mobile: scrollable submenu
    submenu.style.left = '80px';
    submenu.style.top = (rect.bottom - 5) + 'px';
    submenu.style.maxWidth = (window.innerWidth - 90) + 'px';
    submenu.style.maxHeight = '35vh';
    submenu.style.overflowY = 'auto';
    submenu.style.overflowX = 'hidden';
    submenu.style.whiteSpace = 'normal';
    submenu.style.background = 'white';
    return;
  }

  // Desktop/tablet: clean up mobile styles
  submenu.style.maxHeight = '';
  submenu.style.overflowY = '';
  submenu.style.overflowX = '';
  submenu.style.whiteSpace = 'nowrap';
  submenu.style.background = '';

  // Desktop/tablet positioning (to the side)
  let left = calcBaseLeft();
  let top = Math.max(8, Math.round(rect.top));

  // Pre-calculate height without making visible
  const tempDiv = submenu.cloneNode(true);
  tempDiv.style.position = 'absolute';
  tempDiv.style.left = '-9999px';
  tempDiv.style.top = '-9999px';
  tempDiv.style.visibility = 'hidden';
  tempDiv.classList.remove('opacity-0', 'invisible', 'hidden');
  tempDiv.classList.add('opacity-100', 'visible', 'block');
  document.body.appendChild(tempDiv);
  
  const submenuHeight = tempDiv.offsetHeight;
  document.body.removeChild(tempDiv);

  // Adjust position if it would go off screen
  if (top + submenuHeight > window.innerHeight - 8) {
    top = Math.max(8, window.innerHeight - submenuHeight - 8);
  }

  // Set final position
  submenu.style.left = left + 'px';
  submenu.style.top = top + 'px';
}

function showSubmenu(btn, submenu, openedBy='hover'){
  btn.dataset.openedBy = openedBy;
  positionSubmenu(btn, submenu);

  submenu.classList.remove('opacity-0','invisible','hidden');
  submenu.classList.add('opacity-100','visible','block');

  btn.setAttribute('aria-expanded','true');
  btn.querySelector('img')?.classList.add('rotate-180');

  if (openedBy === 'click') {
    const ov = createOverlay();
    document.body.appendChild(ov);
    document.body.classList.add('no-scroll'); // Lock scroll
  }
}

function hideSubmenu(btn, submenu){
  if (btn.dataset.openedBy === 'click') {
    removeOverlay();
    document.body.classList.remove('no-scroll'); // Unlock scroll
  }

  submenu.classList.add('opacity-0','invisible','hidden');
  submenu.classList.remove('opacity-100','visible','block');
  submenu.style.left = '';
  submenu.style.top  = '';
  submenu.style.zIndex = '';

  btn.setAttribute('aria-expanded','false');
  btn.querySelector('img')?.classList.remove('rotate-180');
  delete btn.dataset.openedBy;
}

function closeAll(){
  document.querySelectorAll('.has-submenu[aria-expanded="true"]').forEach(b=>{
    const s = document.body.querySelector('.submenu.opacity-100');
    if (s) {
      hideSubmenu(b, s);
    }
  });
}

submenuButtons.forEach(btn=>{
  const li = btn.closest('li');
  const submenu = li.querySelector('.submenu');
  if (!submenu) return;

  btn.classList.add('cursor-pointer');
  submenu.classList.add('cursor-pointer');

  submenu.addEventListener('click', e => e.stopPropagation());

  btn.addEventListener('click', e=>{
    e.preventDefault(); e.stopPropagation();
    const isOpen = btn.getAttribute('aria-expanded') === 'true';
    const openedBy = btn.dataset.openedBy;

    if (isOpen && openedBy === 'hover') {
      btn.dataset.openedBy = 'click';
      const ov = createOverlay();
      document.body.appendChild(ov);
      document.body.classList.add('no-scroll');
      return;
    }
    if (isOpen && openedBy === 'click') {
      hideSubmenu(btn, submenu);
      return;
    }
    closeAll();
    showSubmenu(btn, submenu, 'click');
  });

  // Hover open
  li.addEventListener('mouseenter', ()=>{
    if (window.matchMedia('(hover: hover)').matches) {
      if (btn.dataset.openedBy !== 'click') showSubmenu(btn, submenu, 'hover');
    }
  });

  // Hover leave
  const maybeCloseHover = ()=>{
    if (!window.matchMedia('(hover: hover)').matches) return;
    setTimeout(()=>{
      if (btn.dataset.openedBy === 'click') return;
      if (!li.matches(':hover') && !submenu.matches(':hover')) hideSubmenu(btn, submenu);
    }, 200); // Increased timeout for better user experience
  };
  li.addEventListener('mouseleave', maybeCloseHover);
  submenu.addEventListener('mouseleave', maybeCloseHover);
});

document.addEventListener('click', e=>{
  if (!e.target.closest('.submenu') && !e.target.closest('.has-submenu')) closeAll();
});
document.addEventListener('keydown', e=>{
  if (e.key === 'Escape') closeAll();
});

let t;
function repositionOpen(){
  document.querySelectorAll('.has-submenu[aria-expanded="true"]').forEach(b=>{
    const s = document.body.querySelector('.submenu.opacity-100');
    if (s) positionSubmenu(b, s);
  });
}
window.addEventListener('resize', ()=>{ 
  clearTimeout(t); 
  t = setTimeout(() => {
    repositionOpen();
    
    // Clean up mobile-specific submenu styles on larger screens
    if (window.innerWidth >= 768) {
      document.querySelectorAll('.submenu').forEach(submenu => {
        submenu.style.maxHeight = '';
        submenu.style.overflowY = '';
        submenu.style.overflowX = '';
        submenu.style.whiteSpace = '';
        submenu.style.background = '';
      });
    }
  }, 150); 
});
window.addEventListener('scroll', ()=> repositionOpen(), { passive: true });

// SIMPLE SUBSUBMENU FUNCTIONALITY - Direct approach
document.addEventListener('DOMContentLoaded', function() {
  console.log('DOM loaded, setting up subsubmenus...');
  
  // Wait a bit to ensure all other scripts have loaded
  setTimeout(function() {
    setupSubsubmenus();
  }, 100);
});

function setupSubsubmenus() {
  console.log('Setting up subsubmenus...');
  
  // Find all toggle buttons
  const toggleButtons = document.querySelectorAll('.toggle-subsubmenu');
  console.log('Found toggle buttons:', toggleButtons.length);
  
  toggleButtons.forEach((button, index) => {
    console.log(`Setting up button ${index + 1}`);
    
    // Remove any existing listeners
    const newButton = button.cloneNode(true);
    button.parentNode.replaceChild(newButton, button);
    
    // Add click listener to the new button
    newButton.addEventListener('click', function(e) {
      console.log('Subsubmenu button clicked!');
      e.preventDefault();
      e.stopPropagation();
      
      const li = this.closest('.has-subsubmenu');
      const subsubmenu = li.querySelector('.subsubmenu');
      
      if (subsubmenu) {
        const isHidden = subsubmenu.classList.contains('hidden');
        console.log('Current state - hidden:', isHidden);
        
        if (isHidden) {
          subsubmenu.classList.remove('hidden');
          this.textContent = '▾';
          console.log('Opened subsubmenu');
        } else {
          subsubmenu.classList.add('hidden');
          this.textContent = '▸';
          console.log('Closed subsubmenu');
        }
      } else {
        console.log('No subsubmenu found');
      }
    });
  });
  
  // Also handle clicking on the div container (not just the button)
  const containers = document.querySelectorAll('.has-subsubmenu > div');
  console.log('Found containers:', containers.length);
  
  containers.forEach((container, index) => {
    console.log(`Setting up container ${index + 1}`);
    
    container.addEventListener('click', function(e) {
      // Only handle if we didn't click the button directly
      if (!e.target.classList.contains('toggle-subsubmenu')) {
        console.log('Container clicked!');
        e.preventDefault();
        e.stopPropagation();
        
        const li = this.closest('.has-subsubmenu');
        const subsubmenu = li.querySelector('.subsubmenu');
        const button = li.querySelector('.toggle-subsubmenu');
        
        if (subsubmenu && button) {
          const isHidden = subsubmenu.classList.contains('hidden');
          console.log('Current state - hidden:', isHidden);
          
          if (isHidden) {
            subsubmenu.classList.remove('hidden');
            button.textContent = '▾';
            console.log('Opened subsubmenu via container');
          } else {
            subsubmenu.classList.add('hidden');
            button.textContent = '▸';
            console.log('Closed subsubmenu via container');
          }
        }
      }
    });
  });
  
  console.log('Subsubmenu setup complete');
}

// Figure out the current time of day
function getTimeOfDay() {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return 'Morning';
  if (hour >= 12 && hour < 16) return 'Afternoon';
  if (hour >= 16 && hour < 21) return 'Evening';
  return 'Night';
}

// Get logged-in user from JWT token
function getLoggedInUser() {
  try {
    const token = localStorage.getItem("token");
    if (!token) {
      // Fallback to localStorage for backward compatibility
      return {
        user_id: localStorage.getItem("user_id"),
        full_name: localStorage.getItem("full_name"),
        role: localStorage.getItem("role"),
        primary_class: localStorage.getItem("class"),
        current_class: localStorage.getItem("class")
      };
    }

    // ✅ Decode JWT token to get user info including current_class
    const payload = JSON.parse(atob(token.split('.')[1]));
    
    return {
      user_id: payload.user_id,
      full_name: payload.full_name,
      role: payload.role,
      primary_class: payload.primary_class,
      current_class: payload.current_class || payload.primary_class // ✅ Use current_class from token
    };
  } catch (error) {
    console.error('Error decoding token:', error);
    // Fallback to localStorage
    return {
      user_id: localStorage.getItem("user_id"),
      full_name: localStorage.getItem("full_name"),
      role: localStorage.getItem("role"),
      primary_class: localStorage.getItem("class"),
      current_class: localStorage.getItem("class")
    };
  }
}

// Cache for class mappings
let classMapping = {};

// Load class mappings from backend endpoint
async function loadClassMappings() {
  try {
    const token = localStorage.getItem('token');

    const response = await fetch('/dbclasses', {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
    }); 

    const data = await response.json();

    // ✅ Create mapping from db_name → display_name
    classMapping = {};
    data.classes.forEach(cls => {
      classMapping[cls.dbName] = cls.display;
    });

    console.log('✅ Class mappings loaded:', classMapping);

  } catch (error) {
    console.error('❌ Failed to load class mappings:', error);
  }
}

// Update greeting message
function updateGreeting() {
  const greetingElement = document.getElementById('dynamicGreeting');
  const workingClassElement = document.getElementById('payrollClassName');
  
  // Return only if BOTH elements are missing
  if (!greetingElement && !workingClassElement) return;

  const user = getLoggedInUser();
  const timeOfDay = getTimeOfDay();

  // Use current_class from JWT token (the database they switched to)
  const effectiveClass = user.current_class;
  
  // FIX: Wait for classMapping to be populated before using it
  const userClass = classMapping[effectiveClass] || effectiveClass || 'OFFICERS';

  // Default to "User" if no login info
  const userName = user?.full_name || user?.user_id || 'User';

  // Only update elements that exist (prevents null property error)
  if (greetingElement) {
    const greeting = `Good ${timeOfDay} ${userName}, welcome to ${userClass} payroll`;
    greetingElement.textContent = greeting;
  }
  
  if (workingClassElement) {
    workingClassElement.textContent = userClass;
  }

  console.log('📊 Dashboard greeting updated:', {
    user: userName,
    primaryClass: user.primary_class,
    currentClass: user.current_class,
    displayClass: userClass
  });
}

// Update current time display
function updateCurrentTime() {
  const timeElement = document.getElementById('currentTime');
  if (!timeElement) return;

  const now = new Date();
  const timeString = now.toLocaleString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  timeElement.textContent = timeString;
}

// Update function for when payroll class is switched
window.updateDashboardGreeting = function(newClassName) {
  console.log('🔄 Updating dashboard greeting for new class:', newClassName);
  
  // Reload user info from updated token
  const user = getLoggedInUser();
  if (user) {
    updateGreeting();
  }
};

// Listen for payroll class switch events
document.addEventListener('payrollClassFocused', (event) => {
  console.log('🎯 Payroll class focused event received:', event.detail);
  updateGreeting();
});

// Get current payroll period from database
async function getCurrentPayrollPeriod() {
  try {
    const token = localStorage.getItem('token');
    const user = getLoggedInUser();
    const dbName = user.current_class;
    
    const response = await fetch('/payroll-period', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    
    const data = await response.json();
    
    if (data.success) {
      // Update the payroll period display
      const periodElement = document.querySelector('#current-payroll-period');
      if (periodElement) {
        const monthNames = ['Jan', 'Feb', 'March', 'April', 'May', 'June',
                           'July', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];
        const monthName = monthNames[data.month - 1] || 'Unknown';
        periodElement.textContent = `${monthName} ${data.year}`;
      }
      
      return { month: data.month, year: data.year };
    }
  } catch (error) {
    console.error('Failed to load payroll period:', error);
  }
}

// FIX: Init with proper async/await to prevent race conditions
(async function initDashboard() {
  if (document.getElementById('dynamicGreeting') || document.getElementById('payrollClassName')) {
    // Wait for class mappings to load BEFORE updating greeting
    await loadClassMappings();
    
    // Now update greeting with populated classMapping
    updateGreeting();
    updateCurrentTime();

    setInterval(updateCurrentTime, 1000);  // Update time every second
    setInterval(updateGreeting, 60000);    // Refresh greeting every minute (to catch token updates)
    await getCurrentPayrollPeriod();  // Load current payroll period
  }
})();



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
      
      // Get the proper section name from the link element or derive it
      let sectionName = previousSection.sectionName;
      const linkElement = document.querySelector(`a[data-section="${previousSection.sectionId}"]`);
      if (linkElement) {
        sectionName = linkElement.textContent.trim();
      }
      
      // Navigate back to previous section (don't add to history again)
      this.navigateToSectionWithoutHistory(previousSection.sectionId, sectionName);
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
    document.title = 'HICAD — Dashboard';
  }

  updateHistory(sectionId, sectionName) {
    document.title = `HICAD — ${sectionName}`;
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

// Dashboard stats update - FIXED VERSION
async function updateDashboardStats() {
  try {
    // Check if the element exists before making the API call
    const personnelElement = document.getElementById('active-personnel');
    if (!personnelElement) {
      console.log('📊 Stats elements not found on this page, skipping update');
      return;
    }

    // Get total personnel and nominal processed for current payroll period
    const response = await fetch('/stats/total-personnels', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('token')}`
      }
    });

    const result = await response.json();
    
    if (result.success) {
      // Update stats cards (element already verified to exist)
      personnelElement.textContent = result.data.totalPersonnels || '0';
      
      console.log('Dashboard stats updated:', result.data.totalPersonnels);
    }
  } catch (error) {
    console.error('❌ Error updating dashboard stats:', error);
  }
}

// Call updateDashboardStats on page load
document.addEventListener('DOMContentLoaded', function() {
  updateDashboardStats();
});

function logout() {
  // Clear user session data
  sessionStorage.clear();
  localStorage.clear();

  // Redirect to login page
  window.location.href = 'personnel-login.html';
}

// Inactivity timeout handler
let inactivityTimer;
const INACTIVITY_TIME = 5 * 60 * 1000; // 5 minutes in milliseconds

function resetInactivityTimer() {
  // Clear the existing timer
  clearTimeout(inactivityTimer);
  
  // Set a new timer
  inactivityTimer = setTimeout(() => {
    logout();
  }, INACTIVITY_TIME);
}

// Events that indicate user activity
const activityEvents = [
  'mousedown',
  'mousemove',
  'keypress',
  'scroll',
  'touchstart',
  'click'
];

document.addEventListener('DOMContentLoaded', function() {
  // Make logout function globally accessible
  window.logout = logout;
  
  // Start the inactivity timer
  resetInactivityTimer();
  
  // Add event listeners for user activity
  activityEvents.forEach(event => {
    document.addEventListener(event, resetInactivityTimer, true);
  });
});