const BaseReportController = require('../Reports/reportsFallbackController');
const taxReportService = require('../../services/Reports/taxReportServices');
const companySettings = require('../helpers/companySettings');
const ExcelJS = require('exceljs');
//const jsreport = require('jsreport-core')();
const fs = require('fs');
const path = require('path');

class TaxReportController extends BaseReportController {

  constructor() {
    super(); // Initialize base class
  }

  // ==========================================================================
  // TAX REPORT - MAIN ENDPOINT
  // ==========================================================================
  async generateTaxReport(req, res) {
    try {
      const { format, summaryOnly, tax_state, ...otherFilters } = req.query;
      
      // Map frontend parameter names to backend expected names
      const filters = {
        ...otherFilters,
        summaryOnly: summaryOnly === '1' || summaryOnly === 'true',
        taxState: tax_state
      };
      
      console.log('Tax Report Filters:', filters); // DEBUG
      
      // This will now throw an error if calculation is not complete
      const data = await taxReportService.getTaxReport(filters);
      
      console.log('Tax Report Data rows:', data.length); // DEBUG
      console.log('Tax Report Sample row:', data[0]); // DEBUG

      if (format === 'excel') {
        return this.generateTaxReportExcel(data, res, filters.summaryOnly);
      } else if (format === 'pdf') {
        return this.generateTaxReportPDF(data, req, res);
      }

      // Return JSON with summary statistics
      const summary = this.calculateSummary(data, filters.summaryOnly);

      res.json({ 
        success: true, 
        data,
        summary
      });
    } catch (error) {
      console.error('Error generating tax report:', error);
      
      // Check if it's a calculation incomplete error
      if (error.message && error.message.includes('Calculation not completed')) {
        return res.status(400).json({ 
          success: false, 
          error: error.message,
          errorType: 'CALCULATION_INCOMPLETE'
        });
      }
      
      // Check if it's a no data error
      if (error.message && error.message.includes('No payroll data found')) {
        return res.status(404).json({ 
          success: false, 
          error: error.message,
          errorType: 'NO_DATA'
        });
      }
      
      // Generic error
      res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  }

  // Calculate summary statistics
  calculateSummary(data, isSummary) {
    if (data.length === 0) {
      return {
        totalEmployees: 0,
        totalTaxCollected: 0,
        totalTaxableIncome: 0,
        totalNetPay: 0,
        employeesWithTax: 0,
        averageTaxRate: 0
      };
    }

    if (isSummary) {
      return {
        totalEmployees: data.reduce((sum, row) => sum + parseInt(row.employee_count || 0), 0),
        totalTaxCollected: data.reduce((sum, row) => sum + parseFloat(row.total_tax_deducted || 0), 0),
        totalTaxableIncome: data.reduce((sum, row) => sum + parseFloat(row.total_taxable_income || 0), 0),
        totalNetPay: data.reduce((sum, row) => sum + parseFloat(row.total_net_pay || 0), 0),
        employeesWithTax: data.reduce((sum, row) => sum + parseInt(row.employees_with_tax || 0), 0),
        stateCount: data.length
      };
    } else {
      const totalNet = data.reduce((sum, row) => sum + parseFloat(row.net_pay || 0), 0);
      const totalTax = data.reduce((sum, row) => sum + parseFloat(row.tax_deducted || 0), 0);
      
      return {
        totalEmployees: data.length,
        totalTaxCollected: totalTax,
        totalTaxableIncome: data.reduce((sum, row) => sum + parseFloat(row.taxable_income || 0), 0),
        totalNetPay: totalNet,
        employeesWithTax: data.filter(row => parseFloat(row.tax_deducted || 0) > 0).length,
        averageTaxRate: totalNet > 0 ? ((totalTax / totalNet) * 100).toFixed(2) : 0
      };
    }
  }

  // ==========================================================================
  // EXCEL GENERATION
  // ==========================================================================
  async generateTaxReportExcel(data, res, isSummary = false) {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Tax Report');

    // Title
    const titleColspan = isSummary ? 'A1:N1' : 'A1:Q1';
    worksheet.mergeCells(titleColspan);
    const titleCell = worksheet.getCell('A1');
    titleCell.value = 'TAX DEDUCTION REPORT';
    titleCell.font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    titleCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1F4E78' }
    };

    // Period info
    if (data.length > 0) {
      worksheet.mergeCells(titleColspan.replace('1', '2'));
      const periodCell = worksheet.getCell('A2');
      periodCell.value = `Period: ${this.getMonthName(data[0].month)} ${data[0].year}`;
      periodCell.font = { size: 12, bold: true };
      periodCell.alignment = { horizontal: 'center' };
      periodCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE7E6E6' }
      };
    }

    worksheet.addRow([]);

    if (isSummary) {
      // Summary columns
      worksheet.columns = [
        { header: 'Tax State', key: 'tax_state', width: 25 },
        { header: 'State Code', key: 'tax_state_code', width: 12 },
        { header: 'Employee Count', key: 'employee_count', width: 18 },
        { header: 'Total net Pay', key: 'total_net_pay', width: 20 },
        { header: 'Tax Free Pay', key: 'total_tax_free_pay', width: 20 },
        { header: 'Taxable Income', key: 'total_taxable_income', width: 20 },
        { header: 'Tax Deducted', key: 'total_tax_deducted', width: 20 },
        { header: 'Cumulative Tax', key: 'total_cumulative_tax', width: 20 },
        { header: 'Avg Tax', key: 'avg_tax_deducted', width: 18 },
        { header: 'Min Tax', key: 'min_tax_deducted', width: 18 },
        { header: 'Max Tax', key: 'max_tax_deducted', width: 18 },
        { header: 'Employees w/ Tax', key: 'employees_with_tax', width: 18 },
        { header: 'Avg Tax Rate %', key: 'avg_tax_rate', width: 15 }
      ];

      // Style header row (row 4)
      const headerRow = worksheet.getRow(4);
      headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      headerRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF0070C0' }
      };
      headerRow.height = 25;
      headerRow.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };

      // Add data with alternating row colors
      data.forEach((row, index) => {
        // Calculate average tax rate
        const avgRate = row.total_net_pay > 0 
          ? ((row.total_tax_deducted / row.total_net_pay) * 100).toFixed(2)
          : 0;
        
        const addedRow = worksheet.addRow({
          ...row,
          avg_tax_rate: avgRate
        });

        // Alternate row colors
        if (index % 2 === 0) {
          addedRow.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFF2F2F2' }
          };
        }

        // Highlight rows with high tax collection
        if (parseFloat(row.total_tax_deducted) > 1000000) {
          addedRow.getCell('G').font = { bold: true, color: { argb: 'FF006100' } };
        }
      });

      // Format currency columns
      ['D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'].forEach(col => {
        worksheet.getColumn(col).numFmt = '₦#,##0.00';
        worksheet.getColumn(col).alignment = { horizontal: 'right' };
      });

      // Format percentage column
      worksheet.getColumn('M').numFmt = '0.00"%"';
      worksheet.getColumn('M').alignment = { horizontal: 'right' };

      // Add grand totals
      const totalRow = worksheet.lastRow.number + 2;
      worksheet.getCell(`A${totalRow}`).value = 'GRAND TOTALS:';
      worksheet.getCell(`A${totalRow}`).font = { bold: true, size: 12 };
      worksheet.mergeCells(`A${totalRow}:B${totalRow}`);

      ['C', 'D', 'E', 'F', 'G', 'H', 'L'].forEach(col => {
        worksheet.getCell(`${col}${totalRow}`).value = {
          formula: `SUM(${col}5:${col}${totalRow - 2})`
        };
        worksheet.getCell(`${col}${totalRow}`).font = { bold: true };
        worksheet.getCell(`${col}${totalRow}`).fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFFE699' }
        };
      });

      // Calculate weighted average tax rate
      const avgRateCell = worksheet.getCell(`M${totalRow}`);
      avgRateCell.value = {
        formula: `(G${totalRow}/D${totalRow})*100`
      };
      avgRateCell.font = { bold: true };
      avgRateCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFFFE699' }
      };

    } else {
      // Detailed columns
      worksheet.columns = [
        { header: 'Employee ID', key: 'employee_id', width: 15 },
        { header: 'Full Name', key: 'full_name', width: 35 },
        { header: 'Grade', key: 'gradelevel', width: 12 },
        { header: 'Tax State', key: 'tax_state', width: 20 },
        { header: 'Location', key: 'location_name', width: 25 },
        { header: 'net Pay', key: 'net_pay', width: 18 },
        { header: 'Tax Free Pay', key: 'tax_free_pay', width: 18 },
        { header: 'Taxable Income', key: 'taxable_income', width: 18 },
        { header: 'Tax Deducted', key: 'tax_deducted', width: 18 },
        { header: 'Cumulative Tax', key: 'cumulative_tax', width: 18 },
        { header: 'Tax Rate %', key: 'effective_tax_rate', width: 12 },
        { header: 'Bank', key: 'Bankcode', width: 20 },
        { header: 'Account Number', key: 'BankACNumber', width: 20 }
      ];

      // Style header row (row 4)
      const headerRow = worksheet.getRow(4);
      headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      headerRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF0070C0' }
      };
      headerRow.height = 25;
      headerRow.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };

      // Group by tax state
      const stateGroups = {};
      data.forEach(row => {
        const state = row.tax_state || 'Unknown';
        if (!stateGroups[state]) stateGroups[state] = [];
        stateGroups[state].push(row);
      });

      // Add data with state separators
      Object.keys(stateGroups).sort().forEach((state, stateIndex) => {
        if (stateIndex > 0) worksheet.addRow([]);

        // State header
        const headerRow = worksheet.addRow([`Tax State: ${state}`]);
        headerRow.font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
        headerRow.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FF4472C4' }
        };
        worksheet.mergeCells(headerRow.number, 1, headerRow.number, 13);

        // Add state data with alternating colors
        stateGroups[state].forEach((row, index) => {
          const addedRow = worksheet.addRow(row);

          if (index % 2 === 0) {
            addedRow.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFF2F2F2' }
            };
          }

          // Highlight high tax deductions
          if (parseFloat(row.tax_deducted) > 50000) {
            addedRow.getCell('I').font = { bold: true, color: { argb: 'FF006100' } };
          }
        });

        // State subtotal
        const subtotalRow = worksheet.lastRow.number + 1;
        worksheet.getCell(`D${subtotalRow}`).value = `${state} Subtotal:`;
        worksheet.getCell(`D${subtotalRow}`).font = { bold: true };
        worksheet.mergeCells(`D${subtotalRow}:E${subtotalRow}`);

        ['F', 'G', 'H', 'I', 'J'].forEach(col => {
          worksheet.getCell(`${col}${subtotalRow}`).value = {
            formula: `SUBTOTAL(9,${col}${headerRow.number + 1}:${col}${subtotalRow - 1})`
          };
          worksheet.getCell(`${col}${subtotalRow}`).font = { bold: true };
          worksheet.getCell(`${col}${subtotalRow}`).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFD9E1F2' }
          };
        });
      });

      // Format currency columns
      ['F', 'G', 'H', 'I', 'J'].forEach(col => {
        worksheet.getColumn(col).numFmt = '₦#,##0.00';
        worksheet.getColumn(col).alignment = { horizontal: 'right' };
      });

      // Format percentage column
      worksheet.getColumn('K').numFmt = '0.00"%"';
      worksheet.getColumn('K').alignment = { horizontal: 'right' };
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=tax_report.xlsx');

    await workbook.xlsx.write(res);
    res.end();
  }

  // ==========================================================================
  // PDF GENERATION
  // ==========================================================================
  async generateTaxReportPDF(data, req, res) {
    try {
      if (!data || data.length === 0) {
        throw new Error('No data available for the selected filters');
      }

      if (data.totalTaxCollected === 0) {
        throw new Error('No tax collected this mth');
      }

      const isSummary = data.length > 0 && !data[0].hasOwnProperty('employee_id');
      
      console.log('Tax Report PDF - Is Summary:', isSummary);
      console.log('Tax Report PDF - Data rows:', data.length);

      // Calculate totals
      const summary = this.calculateSummary(data, isSummary);

      const totalTax = Number(summary?.totalTaxCollected ?? 0);

      if (totalTax === 0) {
        throw new Error('No tax collected this month');
      }

      const templatePath = path.join(__dirname, '../../templates/tax-report.html');
      const templateContent = fs.readFileSync(templatePath, 'utf8');

      //Load image
      const image = await companySettings.getSettingsFromFile('./public/photos/logo.png');
      
      const templateData = {
        data: data,
        summary: summary,
        reportDate: new Date(),
        period: data.length > 0 ? 
          `${this.getMonthName(data[0].month)} ${data[0].year}` : 
          'N/A',
        className: this.getDatabaseNameFromRequest(req),  
        isSummary: isSummary,
        ...image
      }

      const pdfBuffer = await this.generatePDFWithFallback(
        templatePath,
        templateData,
        {
          format: 'A4',
          landscape: true,
          marginTop: '5mm',
          marginBottom: '5mm',
          marginLeft: '5mm',
          marginRight: '5mm'
        }
      );

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 
        `attachment; filename=tax_report_${data[0]?.month || 'report'}_${data[0]?.year || 'report'}.pdf`
      );
      res.send(pdfBuffer);

    } catch (error) {
      console.error('Tax Report PDF generation error:', error);
      return res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  }


  // ==========================================================================
  // HELPER FUNCTIONS
  // ==========================================================================

  async getTaxFilterOptions(req, res) {
    try {
      const taxStates = await taxReportService.getAvailableTaxStates();
      const currentPeriod = await taxReportService.getCurrentPeriod();

      res.json({
        success: true,
        data: {
          taxStates,
          currentPeriod
        }
      });
    } catch (error) {
      console.error('Error getting tax filter options:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  getMonthName(month) {
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    return months[month - 1] || '';
  }

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

module.exports = new TaxReportController();


