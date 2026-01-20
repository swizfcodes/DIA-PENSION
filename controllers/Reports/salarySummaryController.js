const salarySummaryService = require('../../services/Reports/salarySummaryService');
const companySettings = require('../helpers/companySettings');
const ExcelJS = require('exceljs');
const jsreport = require('jsreport-core')();
const fs = require('fs');
const path = require('path');

class SalarySummaryController {

  constructor() {
    this.jsreportReady = false;
    this.initJSReport();
  }

  async initJSReport() {
    try {
      jsreport.use(require('jsreport-handlebars')());
      jsreport.use(require('jsreport-chrome-pdf')());
      
      await jsreport.init();
      this.jsreportReady = true;
      console.log('✅ JSReport initialized for Salary Summary Reports');
    } catch (error) {
      console.error('JSReport initialization failed:', error);
    }
  }

  // Helper method for common Handlebars helpers
  _getCommonHelpers() {
    return `
      function formatCurrency(value) {
        const num = parseFloat(value) || 0;
        return num.toLocaleString('en-NG', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        });
      }
      
      function formatDate(date) {
        const d = new Date(date || new Date());
        return d.toLocaleDateString('en-GB', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric'
        });
      }
      
      function formatTime(date) {
        const d = new Date(date || new Date());
        return d.toLocaleTimeString('en-GB', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: true
        });
      }
    `;
  }

  // ==========================================================================
  // GET FILTER OPTIONS
  // ==========================================================================
  async getFilterOptions(req, res) {
    try {
      const locations = await salarySummaryService.getAvailableLocations();
      const currentPeriod = await salarySummaryService.getCurrentPeriod();

      res.json({
        success: true,
        data: {
          locations,
          currentPeriod
        }
      });
    } catch (error) {
      console.error('Error fetching filter options:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch filter options'
      });
    }
  }

  // ==========================================================================
  // GENERATE SALARY SUMMARY REPORT
  // ==========================================================================
  async generateSalarySummary(req, res) {
    try {
      const { year, month, location, format = 'pdf' } = req.query;

      if (!year || !month) {
        return res.status(400).json({
          success: false,
          error: 'Year and month are required'
        });
      }

      const filters = {
        year: parseInt(year),
        month: parseInt(month),
        location: location || null
      };

      const result = await salarySummaryService.getSalarySummary(filters);

      if (!result.details || result.details.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'No data found for the selected period'
        });
      }

      if (format === 'pdf') {
        await this.generateSalarySummaryPDF(req, res, result, filters);
      } else if (format === 'excel') {
        await this.generateSalarySummaryExcel(res, result, filters);
      } else if (format === 'json') {
        return res.json({
          success: true,
          data: result.details,
          grandTotals: result.grandTotals
        });
      } else {
        return res.status(400).json({
          success: false,
          error: 'Invalid format. Use pdf, excel, or json'
        });
      }
    } catch (error) {
      console.error('Error generating salary summary:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to generate report'
      });
    }
  }

  // ==========================================================================
  // GENERATE PDF
  // ==========================================================================
  async generateSalarySummaryPDF(req, res, result, filters) {
    if (!this.jsreportReady) {
      return res.status(500).json({
        success: false,
        error: "PDF generation service not ready."
      });
    }

    try {
      const rawData = result.details;
      const grandTotals = result.grandTotals;

      // Filter out grand total rows from the data array
      const filteredData = rawData.filter(row => {
        // Exclude rows that are grand totals
        // Adjust these conditions based on how your grand totals are marked
        return row.location !== 'GRAND TOTALS' && 
              row.location !== 'GRAND TOTAL' &&
              !row.isGrandTotal &&
              row.location_description !== 'GRAND TOTALS';
      });

      console.log('Salary Summary PDF - Original data rows:', rawData.length);
      console.log('Salary Summary PDF - Filtered data rows:', filteredData.length);
      console.log('Salary Summary PDF - Grand Totals:', grandTotals);

      const templatePath = path.join(__dirname, '../../templates/salary-summary.html');
      const templateContent = fs.readFileSync(templatePath, 'utf8');

      //Load image
      const image = await companySettings.getSettingsFromFile('./public/photos/logo.png');

      const period = filteredData.length > 0 ? 
        `${filteredData[0].month_name}, ${filteredData[0].year}` : 
        'N/A';

      const pdfResult = await jsreport.render({
        template: {
          content: templateContent,
          engine: 'handlebars',
          recipe: 'chrome-pdf',
          chrome: {
            displayHeaderFooter: false,
            printBackground: true,
            format: 'A4',
            landscape: true,
            marginTop: '5mm',
            marginBottom: '5mm',
            marginLeft: '5mm',
            marginRight: '5mm'
          },
          helpers: this._getCommonHelpers()
        },
        data: {
          data: filteredData,  // Use filtered data instead of raw data
          grandTotals: grandTotals,
          reportDate: new Date(),
          period: period,
          year: filters.year,
          month: filters.month,
          className: this.getDatabaseNameFromRequest(req),
          ...image
        }
      });

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 
        `attachment; filename=salary_summary_${filters.month}_${filters.year}.pdf`
      );
      res.send(pdfResult.content);

    } catch (error) {
      console.error('Salary Summary PDF generation error:', error);
      return res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  }

  // ==========================================================================
  // GENERATE EXCEL
  // ==========================================================================
  async generateSalarySummaryExcel(res, result, filters) {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Salary Summary');
    const data = result.details;
    const grandTotals = result.grandTotals;

    // Title
    worksheet.mergeCells('A1:K1');
    const titleCell = worksheet.getCell('A1');
    titleCell.value = 'NIGERIAN NAVY - SALARY SUMMARY REPORT';
    titleCell.font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    titleCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1F4E78' }
    };

    // Period info
    if (data.length > 0) {
      worksheet.mergeCells('A2:K2');
      const periodCell = worksheet.getCell('A2');
      periodCell.value = `FOR PERIOD: ${data[0].month_name}, ${data[0].year}`;
      periodCell.font = { size: 12, bold: true };
      periodCell.alignment = { horizontal: 'center' };
      periodCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE7E6E6' }
      };
    }

    worksheet.addRow([]);

    // Column headers
    worksheet.columns = [
      { header: 'Location', key: 'location', width: 15 },
      { header: 'Location Description', key: 'location_description', width: 30 },
      { header: 'Employee Count', key: 'employee_count', width: 18 },
      { header: 'Basic Salary', key: 'total_basic_salary', width: 18 },
      { header: 'Allowances', key: 'total_allowances', width: 18 },
      { header: 'Gross Pay', key: 'total_gross', width: 18 },
      { header: 'Deductions', key: 'total_deductions', width: 18 },
      { header: 'Tax', key: 'total_tax', width: 18 },
      { header: 'Net Pay', key: 'total_net', width: 18 }
    ];

    // Style header row (row 4)
    const headerRow = worksheet.getRow(4);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1e40af' }
    };
    headerRow.height = 25;
    headerRow.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };

    // Add data
    data.forEach((row, index) => {
      const addedRow = worksheet.addRow(row);

      // Alternate row colors
      if (index % 2 === 0) {
        addedRow.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFF2F2F2' }
        };
      }
    });

    // Format currency columns
    ['D', 'E', 'F', 'G', 'H', 'I'].forEach(col => {
      worksheet.getColumn(col).numFmt = '₦#,##0.00';
      worksheet.getColumn(col).alignment = { horizontal: 'right' };
    });

    // Format employee count column
    worksheet.getColumn('C').alignment = { horizontal: 'center' };

    // Add grand totals
    const totalRow = worksheet.lastRow.number + 2;
    
    worksheet.getCell(`A${totalRow}`).value = 'GRAND TOTALS';
    worksheet.getCell(`A${totalRow}`).font = { bold: true, size: 12 };
    worksheet.mergeCells(`A${totalRow}:B${totalRow}`);
    
    const totalsData = [
      { col: 'C', value: grandTotals.total_employees },
      { col: 'D', value: grandTotals.total_basic_salary },
      { col: 'E', value: grandTotals.total_allowances },
      { col: 'F', value: grandTotals.total_gross },
      { col: 'G', value: grandTotals.total_deductions },
      { col: 'H', value: grandTotals.total_tax },
      { col: 'I', value: grandTotals.total_net }
    ];

    totalsData.forEach(({ col, value }) => {
      worksheet.getCell(`${col}${totalRow}`).value = value;
      worksheet.getCell(`${col}${totalRow}`).font = { bold: true };
      worksheet.getCell(`${col}${totalRow}`).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFFFE699' }
      };
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=salary_summary_${filters.month}_${filters.year}.xlsx`);

    await workbook.xlsx.write(res);
    res.end();
  }

  // ==========================================================================
  // HELPER: Format Currency
  // ==========================================================================
  formatCurrency(amount) {
    return new Intl.NumberFormat('en-NG', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount || 0);
  }

    getDatabaseNameFromRequest(req) {
    const dbToClassMap = {
      [process.env.DB_OFFICERS]: 'OFFICERS',
      [process.env.DB_WOFFICERS]: 'W_OFFICERS', 
      [process.env.DB_RATINGS]: 'RATE A',
      [process.env.DB_RATINGS_A]: 'RATE B',
      [process.env.DB_RATINGS_B]: 'RATE C',
      [process.env.DB_JUNIOR_TRAINEE]: 'TRAINEE'
    };

    // Get the current database from request
    const currentDb = req.current_class;
    
    // Return the mapped class name, or fallback to the current_class value, or default to 'OFFICERS'
    return dbToClassMap[currentDb] || currentDb || 'OFFICERS';
  }
}

module.exports = new SalarySummaryController();


