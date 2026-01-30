const employeeChangeHistoryService = require('../../services/audit-trail/changesPersonnelDetailsServices');
const BaseReportController = require('../Reports/reportsFallbackController');
const ExcelJS = require('exceljs');
const companySettings = require('../helpers/companySettings');
//const jsreport = require('jsreport-core')();
const fs = require('fs');
const path = require('path');
const pool = require('../../config/db');

class EmployeeChangeHistoryController extends BaseReportController {

  constructor() {
    super(); // Initialize base class
  }
  
  // ==========================================================================
  // EMPLOYEE CHANGE HISTORY - MAIN ENDPOINT
  // ==========================================================================
  async generateChangeHistoryReport(req, res) {
    try {
      const { format, ...filterParams } = req.query;
      
      // Get current database from pool using user_id
      const currentDb = pool.getCurrentDatabase(req.user_id.toString());
      console.log('🔍 Current database for change history report:', currentDb);
      
      // Get current date for default "to" period
      const now = new Date();
      const currentYear = now.getFullYear();
      const currentMonth = now.getMonth() + 1;

      // Map frontend parameter names to backend expected names
      const filters = {
        fromYear: parseInt(filterParams.fromYear),
        fromMonth: parseInt(filterParams.fromMonth),
        toYear: parseInt(filterParams.toYear) || currentYear,
        toMonth: parseInt(filterParams.toMonth) || currentMonth,
        emplId: filterParams.emplId || filterParams.employeeId
      };
      
      // Validation
      if (!filters.fromYear || !filters.fromMonth) {
        console.error('❌ Missing required period filters');
        return res.status(400).json({
          success: false,
          error: 'Period range (from year and month) is required'
        });
      }

      console.log('📋 Change History Filters:', filters);
      
      const data = await employeeChangeHistoryService.getEmployeeChangeHistory(filters, currentDb);
      const statistics = await employeeChangeHistoryService.getChangeStatistics(data);
      
      console.log('📊 Change History Results:');
      console.log('   └─ Employees with changes:', data.length);
      console.log('   └─ Total changes:', statistics.total_changes);

      // Check if no data found
      if (!data || data.length === 0) {
        const periodDesc = `${filters.fromYear}/${filters.fromMonth.toString().padStart(2, '0')} to ${filters.toYear}/${filters.toMonth.toString().padStart(2, '0')}`;
        const message = filters.emplId 
          ? `No changes found for employee ${filters.emplId} in period ${periodDesc}`
          : `No employee changes found in period ${periodDesc}`;

        console.log('⚠️  ' + message);

        return res.status(404).json({ 
          success: false, 
          error: message,
          filters: filters
        });
      }

      if (format === 'excel') {
        return this.generateChangeHistoryExcel(data, res, filters, statistics);
      } else if (format === 'pdf') {
        return this.generateChangeHistoryPDF(data, req, res, filters, statistics);
      }

      // Return JSON with statistics
      res.json({ 
        success: true, 
        data,
        statistics,
        filters
      });
    } catch (error) {
      console.error('❌ ERROR generating Change History report:');
      console.error('   └─ Error Type:', error.constructor.name);
      console.error('   └─ Error Message:', error.message);
      console.error('   └─ Stack:', error.stack);
      res.status(500).json({ 
        success: false, 
        error: error.message || 'Failed to generate change history report'
      });
    }
  }

  // ==========================================================================
  // EXCEL GENERATION
  // ==========================================================================
  async generateChangeHistoryExcel(data, res, filters, statistics) {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Employee Changes');

    // Title
    worksheet.mergeCells('A1:E1');
    const titleCell = worksheet.getCell('A1');
    titleCell.value = 'DIA - EMPLOYEE CHANGE HISTORY REPORT';
    titleCell.font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    titleCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1F4E78' }
    };

    // Period info
    worksheet.mergeCells('A2:E2');
    const periodCell = worksheet.getCell('A2');
    const periodDesc = `Period: ${filters.fromYear}/${filters.fromMonth.toString().padStart(2, '0')} to ${filters.toYear}/${filters.toMonth.toString().padStart(2, '0')}`;
    periodCell.value = filters.emplId ? `${periodDesc} | Employee: ${filters.emplId}` : periodDesc;
    periodCell.font = { size: 11, italic: true };
    periodCell.alignment = { horizontal: 'center' };
    periodCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE7E6E6' }
    };

    // Statistics row
    worksheet.mergeCells('A3:E3');
    const statsCell = worksheet.getCell('A3');
    statsCell.value = `Employees with Changes: ${data.length} | Total Changes: ${statistics.total_changes}`;
    statsCell.font = { size: 10, bold: true };
    statsCell.alignment = { horizontal: 'center' };
    statsCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFFFD966' }
    };

    worksheet.addRow([]);

    // Process each employee
    let currentRow = 5;
    
    data.forEach((employee, index) => {
      // Employee header
      worksheet.mergeCells(`A${currentRow}:E${currentRow}`);
      const empHeaderCell = worksheet.getCell(`A${currentRow}`);
      empHeaderCell.value = `${employee.employee_id} - ${employee.full_name} (${employee.total_changes} changes as of ${employee.history_date_formatted})`;
      empHeaderCell.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
      empHeaderCell.alignment = { horizontal: 'left', vertical: 'middle' };
      empHeaderCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF0070C0' }
      };
      currentRow++;

      // Column headers for changes
      const headerRow = worksheet.getRow(currentRow);
      headerRow.getCell(1).value = 'Field Name';
      headerRow.getCell(2).value = 'Old Value';
      headerRow.getCell(3).value = 'New Value';
      
      headerRow.font = { bold: true, size: 10 };
      headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
      headerRow.height = 20;
      
      ['A', 'B', 'C'].forEach(col => {
        headerRow.getCell(col).fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFD9E1F2' }
        };
        headerRow.getCell(col).border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
      });
      currentRow++;

      // Change details
      employee.changes.forEach((change, changeIndex) => {
        const changeRow = worksheet.getRow(currentRow);
        changeRow.getCell(1).value = change.field_name;
        changeRow.getCell(2).value = change.old_value;
        changeRow.getCell(3).value = change.new_value;

        // Alternating colors
        if (changeIndex % 2 === 0) {
          ['A', 'B', 'C'].forEach(col => {
            changeRow.getCell(col).fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFF2F2F2' }
            };
          });
        }

        // Borders
        ['A', 'B', 'C'].forEach(col => {
          changeRow.getCell(col).border = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' }
          };
        });

        currentRow++;
      });

      // Add spacing between employees
      currentRow += 2;
    });

    // Set column widths
    worksheet.getColumn(1).width = 25;
    worksheet.getColumn(2).width = 40;
    worksheet.getColumn(3).width = 40;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=employee_changes_${filters.fromYear}${filters.fromMonth}_${filters.toYear}${filters.toMonth}.xlsx`);

    await workbook.xlsx.write(res);
    res.end();
  }

  // ==========================================================================
  // PDF GENERATION
  // ==========================================================================
  async generateChangeHistoryPDF(data, req, res, filters, statistics) {
    try {
      if (!data || data.length === 0) {
        console.error('❌ No data available for PDF generation');
        throw new Error('No data available for the selected filters');
      }

      console.log('📄 Generating PDF with', data.length, 'employees');

      const templatePath = path.join(__dirname, '../../templates/changes-personnel-data.html');
      
      if (!fs.existsSync(templatePath)) {
        console.error('❌ Template file not found:', templatePath);
        throw new Error('PDF template file not found');
      }
      
      const templateContent = fs.readFileSync(templatePath, 'utf8');

      const periodDesc = `${filters.fromYear}/${filters.fromMonth.toString().padStart(2, '0')} to ${filters.toYear}/${filters.toMonth.toString().padStart(2, '0')}`;
      const filterDescription = filters.emplId ? `Period: ${periodDesc} | Employee: ${filters.emplId}` : `Period: ${periodDesc}`;

      //Load image
      const image = await companySettings.getSettingsFromFile('./public/photos/logo.png');  

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
        `attachment; filename=employee_changes_${filters.fromYear}${filters.fromMonth}_${filters.toYear}${filters.toMonth}.pdf`
      );
      res.send(pdfBuffer);

    } catch (error) {
      console.error('❌ ERROR generating Change History PDF:');
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
  async getChangeHistoryFilterOptions(req, res) {
    try {
      // Get current database from pool using user_id
      const currentDb = pool.getCurrentDatabase(req.user_id.toString());
      console.log('🔍 Current database for filter options:', currentDb);
      
      const employees = await employeeChangeHistoryService.getAvailableEmployees(currentDb);

      // Get current date for default values
      const now = new Date();
      const currentYear = now.getFullYear();
      const currentMonth = now.getMonth() + 1;

      console.log('✅ Filter options loaded:', {
        employees: employees.length,
        currentYear,
        currentMonth
      });

      res.json({
        success: true,
        data: {
          employees,
          currentYear,
          currentMonth,
          years: this.generateYearOptions(),
          months: this.generateMonthOptions()
        }
      });
    } catch (error) {
      console.error('❌ ERROR getting Change History filter options:');
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
  // HELPER FUNCTIONS
  // ==========================================================================
  
  generateYearOptions() {
    const currentYear = new Date().getFullYear();
    const years = [];
    for (let year = currentYear; year >= currentYear - 10; year--) {
      years.push({ code: year.toString(), description: year.toString() });
    }
    return years;
  }

  generateMonthOptions() {
    const months = [
      { code: '1', description: 'January' },
      { code: '2', description: 'February' },
      { code: '3', description: 'March' },
      { code: '4', description: 'April' },
      { code: '5', description: 'May' },
      { code: '6', description: 'June' },
      { code: '7', description: 'July' },
      { code: '8', description: 'August' },
      { code: '9', description: 'September' },
      { code: '10', description: 'October' },
      { code: '11', description: 'November' },
      { code: '12', description: 'December' }
    ];
    return months;
  }

  getDatabaseNameFromRequest(req) {
    const dbToClassMap = {
      [process.env.DB_OFFICERS]: 'MILITARY STAFFS',
      [process.env.DB_WOFFICERS]: 'CIVILIAN STAFFS', 
      [process.env.DB_RATINGS]: 'PENSION STAFFS',
      [process.env.DB_RATINGS_A]: 'NYSC ATTACHES',
      [process.env.DB_RATINGS_B]: 'RUNNING COST',
      // [process.env.DB_JUNIOR_TRAINEE]: 'TRAINEE'
    };

    const currentDb = req.current_class;
    return dbToClassMap[currentDb] || currentDb || 'MILITARY STAFFS';
  }
}

module.exports = new EmployeeChangeHistoryController();


