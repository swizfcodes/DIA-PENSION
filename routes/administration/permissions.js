// ============================================
// FILE: routes/administration/role-menu-permissions.js
// ============================================
const express = require("express");
//const path = require('path');
const pool = require('../../config/db');
const verifyToken = require('../../middware/authentication');
const router = express.Router();

// Get all menu items
router.get("/menu-items", verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT id, menu_key, menu_name, parent_id, menu_order, menu_type 
      FROM menu_items 
      ORDER BY menu_order ASC, menu_name ASC
    `);
    res.json(rows);
  } catch (err) {
    console.error("❌ Failed to fetch menu items:", err.message);
    res.status(500).json({ error: "Failed to fetch menu items" });
  }
});

// Get permissions for a specific role
router.get("/role-permissions/:roleId", verifyToken, async (req, res) => {
  const { roleId } = req.params;
  
  try {
    const [rows] = await pool.query(`
      SELECT menu_item_id 
      FROM role_menu_permissions 
      WHERE role_id = ?
    `, [roleId]);
    
    res.json(rows.map(r => r.menu_item_id));
  } catch (err) {
    console.error("❌ Failed to fetch role permissions:", err.message);
    res.status(500).json({ error: "Failed to fetch role permissions" });
  }
});

// Get user's accessible menus (for frontend to filter sidebar)
router.get("/my-menus", verifyToken, async (req, res) => {
  const userId = req.user_id;
  
  try {
    // Get user's role name
    const [userRole] = await pool.query(`
      SELECT user_role FROM users WHERE user_id = ?
    `, [userId]);
    
    if (!userRole.length) {
      return res.status(404).json({ error: "User not found" });
    }
    
    const roleName = userRole[0].user_role;
    
    // Get role_id from roles table using role name
    const [role] = await pool.query(`
      SELECT id FROM roles WHERE name = ?
    `, [roleName]);
    
    if (!role.length) {
      return res.status(404).json({ error: "Role not found" });
    }
    
    const roleId = role[0].id;
    
    // Get accessible menu items for this role
    const [menus] = await pool.query(`
      SELECT DISTINCT m.menu_key, m.menu_name, m.menu_order, m.parent_id, m.menu_type
      FROM menu_items m
      INNER JOIN role_menu_permissions rmp ON m.id = rmp.menu_item_id
      WHERE rmp.role_id = ?
      ORDER BY m.menu_order ASC
    `, [roleId]);
    
    res.json(menus);
  } catch (err) {
    console.error("❌ Failed to fetch user menus:", err.message);
    res.status(500).json({ error: "Failed to fetch user menus" });
  }
});

// Save role permissions (bulk update)
router.post("/role-permissions/:roleId", verifyToken, async (req, res) => {
  const { roleId } = req.params;
  const { menuItemIds } = req.body; // Array of menu item IDs
  
  if (!Array.isArray(menuItemIds)) {
    return res.status(400).json({ error: "menuItemIds must be an array" });
  }
  
  const connection = await pool.getConnection();
  
  try {
    await connection.beginTransaction();
    
    // Delete existing permissions for this role
    await connection.query(`
      DELETE FROM role_menu_permissions WHERE role_id = ?
    `, [roleId]);
    
    // Insert new permissions
    if (menuItemIds.length > 0) {
      const values = menuItemIds.map(menuId => [roleId, menuId]);
      await connection.query(`
        INSERT INTO role_menu_permissions (role_id, menu_item_id) VALUES ?
      `, [values]);
    }
    
    await connection.commit();
    res.json({ message: "Permissions updated successfully" });
    
  } catch (err) {
    await connection.rollback();
    console.error("❌ Failed to save role permissions:", err.message);
    res.status(500).json({ error: "Failed to save role permissions" });
  } finally {
    connection.release();
  }
});

module.exports = router;


// ============================================
// SQL MIGRATION: Create necessary tables
// ============================================
/*
-- Table to store all menu items in the system
CREATE TABLE IF NOT EXISTS menu_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  menu_key VARCHAR(100) NOT NULL UNIQUE COMMENT 'Matches data-section or data-menu attribute',
  menu_name VARCHAR(200) NOT NULL,
  parent_id INT NULL COMMENT 'For nested menus',
  menu_order INT DEFAULT 0,
  menu_type ENUM('menu', 'item', 'submenu') DEFAULT 'item',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_parent (parent_id),
  INDEX idx_menu_key (menu_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Table to map roles to menu permissions
CREATE TABLE IF NOT EXISTS role_menu_permissions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  role_id INT NOT NULL,
  menu_item_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
  FOREIGN KEY (menu_item_id) REFERENCES menu_items(id) ON DELETE CASCADE,
  UNIQUE KEY unique_role_menu (role_id, menu_item_id),
  INDEX idx_role (role_id),
  INDEX idx_menu (menu_item_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Insert all menu items from your sidebar
INSERT INTO menu_items (menu_key, menu_name, parent_id, menu_order, menu_type) VALUES
-- Main menus
('dashboard', 'Dashboard', NULL, 1, 'menu'),
('administration', 'Administration', NULL, 2, 'menu'),
('personel-profile', 'Personnel Profile', NULL, 3, 'menu'),
('data-entry', 'Data Input', NULL, 4, 'menu'),
('file-update', 'File Update', NULL, 5, 'menu'),
('payroll-calculations', 'Payroll Calculations', NULL, 6, 'menu'),
('reference-tables', 'Reference Tables', NULL, 7, 'menu'),
('utilities', 'Utilities', NULL, 8, 'menu'),
('reports', 'Reports', NULL, 9, 'menu'),
('audit-trail', 'Audit Trail', NULL, 10, 'menu');

-- Get parent IDs for submenus
SET @admin_id = (SELECT id FROM menu_items WHERE menu_key = 'administration');
SET @personnel_id = (SELECT id FROM menu_items WHERE menu_key = 'personel-profile');
SET @data_entry_id = (SELECT id FROM menu_items WHERE menu_key = 'data-entry');
SET @file_update_id = (SELECT id FROM menu_items WHERE menu_key = 'file-update');
SET @payroll_calc_id = (SELECT id FROM menu_items WHERE menu_key = 'payroll-calculations');
SET @ref_tables_id = (SELECT id FROM menu_items WHERE menu_key = 'reference-tables');
SET @utilities_id = (SELECT id FROM menu_items WHERE menu_key = 'utilities');
SET @reports_id = (SELECT id FROM menu_items WHERE menu_key = 'reports');
SET @audit_id = (SELECT id FROM menu_items WHERE menu_key = 'audit-trail');

-- Administration submenu items
INSERT INTO menu_items (menu_key, menu_name, parent_id, menu_order, menu_type) VALUES
('role-management', 'Role Management', @admin_id, 1, 'item'),
('create-user', 'Create User', @admin_id, 2, 'item'),
('control-user', 'Control User', @admin_id, 3, 'item'),
('payroll-class-setup', 'Payroll Class Setup', @admin_id, 4, 'item'),
('switch-payroll-class', 'Switch Active Payroll Class', @admin_id, 5, 'item'),
('change-payroll-class', 'Change Personnel Payroll Class', @admin_id, 6, 'item'),
('change-registration-number', 'Change Registration Number', @admin_id, 7, 'item'),
('irregular-one-off-payments', 'Irregular One-Off Payments', @admin_id, 8, 'submenu'),
('company-profile', 'Company Profile', @admin_id, 9, 'item'),
('monthly-yearly-processing', 'Month End Processing', @admin_id, 10, 'item'),
('yearly-processing', 'Year End Processing', @admin_id, 11, 'item');

-- Irregular One-Off Payments sub-submenu
SET @irregular_id = (SELECT id FROM menu_items WHERE menu_key = 'irregular-one-off-payments');
INSERT INTO menu_items (menu_key, menu_name, parent_id, menu_order, menu_type) VALUES
('report-requirement-setup', 'One-Off Requirement Setup', @irregular_id, 1, 'item'),
('one-off-fixed-amount', 'One-Off Fixed Amount By Rank', @irregular_id, 2, 'item'),
('individual-payment-input', 'Individual One-Off Payment Input', @irregular_id, 3, 'item'),
('irregular-one-off-calculations', 'One-Off Calculations', @irregular_id, 4, 'item'),
('irregular-one-off-reports', 'One-Off Reports', @irregular_id, 5, 'item');

-- Personnel Profile submenu
INSERT INTO menu_items (menu_key, menu_name, parent_id, menu_order, menu_type) VALUES
('add-personnel', 'Add New Personnel', @personnel_id, 1, 'item'),
('current-personnel', 'Current Personnel', @personnel_id, 2, 'item'),
('old-personnel', 'Old Personnel', @personnel_id, 3, 'item');

-- Data Input submenu
INSERT INTO menu_items (menu_key, menu_name, parent_id, menu_order, menu_type) VALUES
('payments-deductions', 'Payments/Deductions', @data_entry_id, 1, 'item'),
('payments-deductions-upload', 'Payments/Deductions(Batch Upload)', @data_entry_id, 2, 'item'),
('variation-payments', 'Variation to Payments/Deductions', @data_entry_id, 3, 'item'),
('cumulative-payroll', 'Cumulative Payroll Transfer', @data_entry_id, 4, 'item'),
('input-documentation', 'Input Documentation', @data_entry_id, 5, 'item'),
('arrears-calculations', 'Arrears Calculations', @data_entry_id, 6, 'item');

-- File Update submenu
INSERT INTO menu_items (menu_key, menu_name, parent_id, menu_order, menu_type) VALUES
('save-payroll-files', 'Save Payroll Files', @file_update_id, 1, 'item'),
('changes-personnel-data', 'Changes in Personnel Data', @file_update_id, 2, 'item'),
('input-variable-report', 'Input Variable Report', @file_update_id, 3, 'item'),
('master-file-update', 'Master File Update', @file_update_id, 4, 'item'),
('recall-payment-files', 'Recall Payment Files', @file_update_id, 5, 'item');

-- Payroll Calculations submenu
INSERT INTO menu_items (menu_key, menu_name, parent_id, menu_order, menu_type) VALUES
('payroll-calculations', 'Payroll Calculations', @payroll_calc_id, 1, 'item'),
('calculation-reports', 'Calculation Reports', @payroll_calc_id, 2, 'item');

-- Reference Tables submenu
INSERT INTO menu_items (menu_key, menu_name, parent_id, menu_order, menu_type) VALUES
('overtime-information', 'Overtime Information', @ref_tables_id, 1, 'item'),
('command', 'Command', @ref_tables_id, 2, 'item'),
('cash-payment', 'Overpayment Percentage Alarm', @ref_tables_id, 3, 'item'),
('tax-table-information', 'Tax Table Information', @ref_tables_id, 4, 'item'),
('salary-scale-information', 'Salary Scale Information', @ref_tables_id, 5, 'item'),
('pay-element-description', 'Pay Element Description', @ref_tables_id, 6, 'item'),
('fixed-amount-rank', 'Fixed Amount per Rank', @ref_tables_id, 7, 'item'),
('mutually-exclusive', 'Mutually Exclusive Pay Elements', @ref_tables_id, 8, 'item'),
('pension-fund-administrator', 'Pension Fund Administrator', @ref_tables_id, 9, 'item'),
('bank-details', 'Bank Details', @ref_tables_id, 10, 'item'),
('department', 'Department', @ref_tables_id, 11, 'item'),
('state-codes', 'State Codes', @ref_tables_id, 12, 'item'),
('local-government', 'Local Government', @ref_tables_id, 13, 'item');

-- Utilities submenu
INSERT INTO menu_items (menu_key, menu_name, parent_id, menu_order, menu_type) VALUES
('emolument-form-processing', 'Emolument Form Processing', @utilities_id, 1, 'item'),
('ippis-payments', 'Pull IPPIS Payments', @utilities_id, 2, 'item'),
('database-backup', 'Database Backup', @utilities_id, 3, 'item'),
('database-restore', 'Database Restore', @utilities_id, 4, 'item');

-- Reports submenu
INSERT INTO menu_items (menu_key, menu_name, parent_id, menu_order, menu_type) VALUES
('pay-slips', 'Pay Slips', @reports_id, 1, 'item'),
('payments-by-bank', 'Payments by Bank(Branch)', @reports_id, 2, 'item'),
('analysis-of-earnings', 'Analysis of Earnings/Deductions', @reports_id, 3, 'item'),
('loan-analysis', 'Loan Analysis', @reports_id, 4, 'item'),
('analysis-of-payments', 'Analysis of Payments/Deductions by Bank', @reports_id, 5, 'item'),
('tax-payments-by-state', 'Tax Payments By State', @reports_id, 6, 'item'),
('payroll-register', 'Payroll Register', @reports_id, 7, 'item'),
('payment-staff-list', 'Payment Staff List', @reports_id, 8, 'item'),
('national-housing-funds', 'National Housing Funds', @reports_id, 9, 'item'),
('nsitf', 'Pension Fund Scheme', @reports_id, 10, 'item'),
('salary-summary', 'Salary Summary', @reports_id, 11, 'item'),
('control-sheet', 'Control Sheet/Journal', @reports_id, 12, 'item'),
('salary-reconciliation', 'Salary Reconciliation', @reports_id, 13, 'item'),
('salary-history', 'Salary History', @reports_id, 14, 'item'),
('personnel-reports', 'Personnel Reports', @reports_id, 15, 'item');

-- Audit Trail submenu
INSERT INTO menu_items (menu_key, menu_name, parent_id, menu_order, menu_type) VALUES
('salary-variance-analysis', 'Salary Variance Analysis', @audit_id, 1, 'item'),
('changes-in-personal-details', 'Changes in Personal Details Record', @audit_id, 2, 'item'),
('variation-input-listings', 'Variation Input Listings', @audit_id, 3, 'item'),
('overpayment', 'Overpayment', @audit_id, 4, 'item'),
('duplicate-account-number', 'Duplicate Account Number', @audit_id, 5, 'item'),
('outof-range-payments', 'OutOf Range Payments', @audit_id, 6, 'item');

-- Grant HICAD role full access to all menus
INSERT INTO role_menu_permissions (role_id, menu_item_id)
SELECT 5, id FROM menu_items WHERE id NOT IN (
  SELECT menu_item_id FROM role_menu_permissions WHERE role_id = 5
);
*/


