const duplicateAccountService = require('../../services/audit-trail/duplicateAccnoService');
const BaseReportController = require('../Reports/reportsFallbackController');
const companySettings = require('../helpers/companySettings');
const ExcelJS = require('exceljs');
//const jsreport = require('jsreport-core')();
const fs = require('fs');
const path = require('path');
const pool = require('../../config/db');

class DuplicateAccountController extends BaseReportController {

  constructor() {
    super(); // Initialize base class
  }

  // ==========================================================================
  // DUPLICATE ACCOUNTS - MAIN ENDPOINT
  // ==========================================================================
  async generateDuplicateAccountReport(req, res) {
    try {
      const { format, ...filterParams } = req.query;
      
      // Get current database from pool using user_id
      const currentDb = pool.getCurrentDatabase(req.user_id.toString());
      console.log('🔍 Current database for duplicate account report:', currentDb);
      
      // Map frontend parameter names to backend expected names
      const filters = {
        bankCode: filterParams.bankCode || filterParams.bank_code,
        includeInactive: filterParams.includeInactive === 'true' || filterParams.include_inactive === 'true'
      };
      
      console.log('📋 Duplicate Account Filters:', filters);
      
      const data = await duplicateAccountService.getDuplicateAccounts(filters, currentDb);
      const statistics = await duplicateAccountService.getDuplicateStatistics(data);
      
      console.log('📊 Duplicate Account Results:');
      console.log('   └─ Duplicate accounts found:', data.length);
      console.log('   └─ Total affected employees:', statistics.total_affected_employees);

      // Check if no duplicates found
      if (!data || data.length === 0) {
        const message = filters.bankCode 
          ? `No duplicate account numbers found for bank: ${filters.bankCode}`
          : 'No duplicate account numbers found - All account numbers are unique!';

        console.log('✅ ' + message);

        // Return success with no duplicates message
        return res.json({ 
          success: true, 
          message: message,
          data: [],
          statistics: {
            total_duplicate_accounts: 0,
            total_affected_employees: 0,
            total_active_affected: 0,
            total_inactive_affected: 0
          },
          filters: filters
        });
      }

      if (format === 'excel') {
        return this.generateDuplicateAccountExcel(data, res, filters, statistics);
      } else if (format === 'pdf') {
        return this.generateDuplicateAccountPDF(data, req, res, filters, statistics);
      }

      // Return JSON with statistics
      res.json({ 
        success: true, 
        data,
        statistics,
        filters
      });
    } catch (error) {
      console.error('❌ ERROR generating Duplicate Account report:');
      console.error('   └─ Error Type:', error.constructor.name);
      console.error('   └─ Error Message:', error.message);
      console.error('   └─ Stack:', error.stack);
      res.status(500).json({ 
        success: false, 
        error: error.message || 'Failed to generate duplicate account report'
      });
    }
  }

  // ==========================================================================
  // EXCEL GENERATION
  // ==========================================================================
  async generateDuplicateAccountExcel(data, res, filters, statistics) {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Duplicate Accounts');

    // Title
    worksheet.mergeCells('A1:H1');
    const titleCell = worksheet.getCell('A1');
    titleCell.value = 'DIA PAYROLL - DUPLICATE ACCOUNT NUMBER REPORT';
    titleCell.font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    titleCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1F4E78' }
    };

    // Filter info
    worksheet.mergeCells('A2:H2');
    const filterCell = worksheet.getCell('A2');
    let filterText = filters.bankCode ? `Bank: ${filters.bankCode}` : 'All Banks';
    filterText += filters.includeInactive ? ' | Including Inactive Employees' : ' | Active Employees Only';
    filterCell.value = `Filters: ${filterText}`;
    filterCell.font = { size: 11, italic: true };
    filterCell.alignment = { horizontal: 'center' };
    filterCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE7E6E6' }
    };

    // Statistics row
    worksheet.mergeCells('A3:H3');
    const statsCell = worksheet.getCell('A3');
    statsCell.value = `Duplicate Accounts: ${statistics.total_duplicate_accounts} | Affected Employees: ${statistics.total_affected_employees} | Active: ${statistics.total_active_affected} | Inactive: ${statistics.total_inactive_affected}`;
    statsCell.font = { size: 10, bold: true };
    statsCell.alignment = { horizontal: 'center' };
    statsCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFFF6B6B' }
    };

    worksheet.addRow([]);

    // Process each duplicate account
    let currentRow = 5;
    
    data.forEach((duplicate, index) => {
      // Account header
      worksheet.mergeCells(`A${currentRow}:H${currentRow}`);
      const accountHeaderCell = worksheet.getCell(`A${currentRow}`);
      const severity = duplicate.duplicate_count === 2 ? 'LOW' : duplicate.duplicate_count <= 4 ? 'MEDIUM' : 'HIGH';
      accountHeaderCell.value = `Account: ${duplicate.account_number} | Bank: ${duplicate.bank_name} (${duplicate.bank_code}) | ${duplicate.duplicate_count} Employees | Severity: ${severity}`;
      accountHeaderCell.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
      accountHeaderCell.alignment = { horizontal: 'left', vertical: 'middle' };
      
      // Color by severity
      const severityColor = duplicate.duplicate_count === 2 ? 'FFFFA500' : duplicate.duplicate_count <= 4 ? 'FFFF6B6B' : 'FFDC143C';
      accountHeaderCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: severityColor }
      };
      currentRow++;

      // Column headers
      const headerRow = worksheet.getRow(currentRow);
      ['Svc No.', 'Full Name', 'Title', 'Grade Level', 'Location', 'Bank Branch', 'Date Employed', 'Status'].forEach((header, idx) => {
        const cell = headerRow.getCell(idx + 1);
        cell.value = header;
        cell.font = { bold: true, size: 10 };
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFD9E1F2' }
        };
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
      });
      currentRow++;

      // Employee details
      duplicate.employees.forEach((employee, empIndex) => {
        const empRow = worksheet.getRow(currentRow);
        empRow.getCell(1).value = employee.employee_id;
        empRow.getCell(2).value = employee.full_name;
        empRow.getCell(3).value = employee.title_code;
        empRow.getCell(4).value = employee.gradelevel;
        empRow.getCell(5).value = employee.location_code;
        empRow.getCell(6).value = employee.bank_branch;
        empRow.getCell(7).value = employee.date_employed;
        empRow.getCell(8).value = employee.status_display;

        // Highlight inactive employees
        if (employee.date_left && employee.date_left !== '') {
          for (let i = 1; i <= 8; i++) {
            empRow.getCell(i).fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFFFD700' }
            };
            empRow.getCell(i).font = { italic: true, color: { argb: 'FF666666' } };
          }
        } else if (empIndex % 2 === 0) {
          for (let i = 1; i <= 8; i++) {
            empRow.getCell(i).fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFF2F2F2' }
            };
          }
        }

        // Borders
        for (let i = 1; i <= 8; i++) {
          empRow.getCell(i).border = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' }
          };
        }

        currentRow++;
      });

      // Add spacing between accounts
      currentRow += 2;
    });

    // Set column widths
    worksheet.getColumn(1).width = 15;
    worksheet.getColumn(2).width = 30;
    worksheet.getColumn(3).width = 10;
    worksheet.getColumn(4).width = 12;
    worksheet.getColumn(5).width = 15;
    worksheet.getColumn(6).width = 25;
    worksheet.getColumn(7).width = 12;
    worksheet.getColumn(8).width = 15;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=duplicate_accounts_${new Date().toISOString().split('T')[0]}.xlsx`);

    await workbook.xlsx.write(res);
    res.end();
  }

  // ==========================================================================
  // PDF GENERATION
  // ==========================================================================
  async generateDuplicateAccountPDF(data, req, res, filters, statistics) {
    try {
      if (!data || data.length === 0) {
        console.error('❌ No duplicate accounts to generate PDF');
        throw new Error('No duplicate accounts found');
      }

      console.log('📄 Generating PDF with', data.length, 'duplicate accounts');

      const templatePath = path.join(__dirname, '../../templates/duplicate-accounts.html');
      //Load image
      const image = await companySettings.getSettingsFromFile('./public/photos/logo.png');   
      
      if (!fs.existsSync(templatePath)) {
        console.error('❌ Template file not found:', templatePath);
        throw new Error('PDF template file not found');
      }
      
      const templateContent = fs.readFileSync(templatePath, 'utf8');

      let filterDescription = filters.bankCode ? `Bank: ${filters.bankCode}` : 'All Banks';
      filterDescription += filters.includeInactive ? ' | Including Inactive' : ' | Active Only';

      const pdfBuffer = await this.generatePDFWithFallback(
        templatePath,
        {
          data: data,
          statistics: statistics,
          reportDate: new Date(),
          filters: filterDescription,
          className: this.getDatabaseNameFromRequest(req),
          ...image
        },
        {
          format: 'A4',
          landscape: true,
          marginTop: '5mm',
          marginBottom: '5mm',
          marginLeft: '5mm',
          marginRight: '5mm'
        }        
      );

      console.log('✅ PDF generated successfully');

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 
        `attachment; filename=duplicate_accounts_${new Date().toISOString().split('T')[0]}.pdf`
      );
      res.send(pdfBuffer);

    } catch (error) {
      console.error('❌ ERROR generating Duplicate Account PDF:');
      console.error('   └─ Error Type:', error.constructor.name);
      console.error('   └─ Error Message:', error.message);
      console.error('   └─ Stack:', error.stack);
      return res.status(500).json({ 
        success: false, 
        error: error.message || 'Failed to generate PDF report'
      });
    }
  }

  // ==========================================================================
  // GET FILTER OPTIONS
  // ==========================================================================
  async getDuplicateAccountFilterOptions(req, res) {
    try {
      // Get current database from pool using user_id
      const currentDb = pool.getCurrentDatabase(req.user_id.toString());
      console.log('🔍 Current database for filter options:', currentDb);
      
      const banks = await duplicateAccountService.getAvailableBanks(currentDb);

      console.log('✅ Filter options loaded:', {
        banks: banks.length
      });

      res.json({
        success: true,
        data: {
          banks,
          includeInactiveOptions: [
            { code: 'false', description: 'Active Employees Only' },
            { code: 'true', description: 'Include Inactive Employees' }
          ]
        }
      });
    } catch (error) {
      console.error('❌ ERROR getting Duplicate Account filter options:');
      console.error('   └─ Error Type:', error.constructor.name);
      console.error('   └─ Error Message:', error.message);
      console.error('   └─ Stack:', error.stack);
      res.status(500).json({ 
        success: false, 
        error: error.message || 'Failed to load filter options'
      });
    }
  }

  // ==========================================================================
  // CHECK SPECIFIC ACCOUNT NUMBER
  // ==========================================================================
  async checkAccountNumber(req, res) {
    try {
      const { accountNumber } = req.query;
      
      if (!accountNumber) {
        return res.status(400).json({
          success: false,
          error: 'Account number is required'
        });
      }

      const currentDb = pool.getCurrentDatabase(req.user_id.toString());
      console.log('🔍 Checking account number:', accountNumber);
      
      const result = await duplicateAccountService.checkAccountNumber(accountNumber, currentDb);
      
      res.json({ 
        success: true, 
        data: result
      });
    } catch (error) {
      console.error('❌ ERROR checking account number:');
      console.error('   └─ Error:', error.message);
      res.status(500).json({ 
        success: false, 
        error: error.message || 'Failed to check account number'
      });
    }
  }

  // ==========================================================================
  // HELPER FUNCTIONS
  // ==========================================================================
  
  getDatabaseNameFromRequest(req) {
    const dbToClassMap = {
      [process.env.DB_OFFICERS]: 'MILITARY STAFF',
      [process.env.DB_WOFFICERS]: 'CIVILIAN STAFF', 
      [process.env.DB_RATINGS]: 'PENSION STAFF',
      [process.env.DB_RATINGS_A]: 'NYSC ATTACHE',
      [process.env.DB_RATINGS_B]: 'RUNNING COST',
      // [process.env.DB_JUNIOR_TRAINEE]: 'TRAINEE'
    };

    const currentDb = req.current_class;
    return dbToClassMap[currentDb] || currentDb || 'MILITARY STAFF';
  }
}

module.exports = new DuplicateAccountController();


