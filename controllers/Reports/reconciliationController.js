const BaseReportController = require('../Reports/reportsFallbackController');
const reconciliationService = require('../../services/Reports/reconciliationService');
const companySettings = require('../helpers/companySettings');
//const jsreport = require('jsreport-core')();
const fs = require('fs');
const path = require('path');

class ReconciliationController extends BaseReportController {

  constructor() {
    super(); // Initialize base class
  }

  
  /**
   * GET /api/reconciliation/summary
   * Get overall reconciliation summary
   */
  async getSummary(req, res) {
    try {
      const { year, month } = req.query;
      const database = req.current_class;
      
      const summary = await reconciliationService.getSalaryReconciliationSummary({
        year,
        month,
        database
      });
      
      res.json({
        success: true,
        data: summary
      });
    } catch (error) {
      console.error('Error getting reconciliation summary:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get reconciliation summary',
        details: error.message
      });
    }
  }

  /**
   * GET /api/reconciliation/employees
   * Get employee-level reconciliation details
   */
  async getEmployeeReconciliation(req, res) {
    try {
      const { year, month, showErrorsOnly } = req.query;
      const database = req.current_class;
      const filters = { year, month, database, showErrorsOnly: showErrorsOnly !== 'false' };
      
      const result = await reconciliationService.getEmployeeReconciliation(filters);
      
      res.json({
        success: true,
        count: result.length,
        data: result
      });

    } catch (error) {
      console.error('Error getting employee reconciliation:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get employee reconciliation',
        details: error.message
      });
    }
  }

  /**
   * GET /api/reconciliation/report
   * Get complete reconciliation report
   */
  async getReport(req, res) {
    try {
      const { year, month } = req.query;
      const database = req.current_class;
      
      const report = await reconciliationService.getReconciliationReport({
        year,
        month,
        database
      });
      
      res.json({
        success: true,
        data: report
      });
    } catch (error) {
      console.error('Error generating reconciliation report:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to generate reconciliation report',
        details: error.message
      });
    }
  }

  /**
   * GET /api/reconciliation/payment-type-analysis
   * Get analysis of which payment types are causing errors
   */
  async getPaymentTypeAnalysis(req, res) {
    try {
      const { year, month } = req.query;
      const database = req.current_class;
      
      const analysis = await reconciliationService.getPaymentTypeErrorAnalysis({
        year,
        month,
        database
      });
      
      res.json({
        success: true,
        data: analysis
      });
    } catch (error) {
      console.error('Error getting payment type analysis:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get payment type analysis',
        details: error.message
      });
    }
  }

  /**
   * NEW: Export reconciliation report as PDF
   * GET /api/reconciliation/export
   */
  async exportReconciliationPDF(req, res) {
    try {
      const { year, month, showErrorsOnly } = req.query;
      const database = req.current_class;

      if (!year || !month) {
        return res.status(400).json({
          success: false,
          error: 'Year and month are required'
        });
      }

      // Convert showErrorsOnly to boolean (defaults to true)
      const errorsOnly = showErrorsOnly === 'false' ? false : true;

      console.log(` Export request: year=${year}, month=${month}, errorsOnly=${errorsOnly}, database=${database}`);

      // Get reconciliation data
      const filters = {
        year,
        month,
        database,
        showErrorsOnly: false
      };

      const result = await reconciliationService.getReconciliationReport(filters);

      console.log(` Export data - Total: ${result.total_employees_checked}, Errors: ${result.employees_with_errors}`);

      // Generate PDF with filter applied
      await this.generateSalaryReconciliationPDF(req, res, result, {
        ...filters,
        showErrorsOnly: errorsOnly // Apply filter for PDF
      });

    } catch (error) {
      console.error('❌ Export error:', error);
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    }
  }

  /**
   * Helper to generate PDF from report data
   */
  async generateSalaryReconciliationPDF(req, res, result, filters) {
    try {
      if (!result || (!result.details && !result.all_details)) {
        throw new Error('Control Sheet balanced no variance this month');
      }
      
      // Ensure result has the expected structure
      if (!result.details && !result.all_details) {
        throw new Error('Invalid data structure returned from reconciliation service');
      }
      
      // Determine which data to use based on showErrorsOnly filter
      const showErrorsOnly = filters.showErrorsOnly !== false; // defaults to true
      const data = showErrorsOnly ? (result.details || []) : (result.all_details || []);
      
      console.log(` PDF Generation - Filter: ${showErrorsOnly ? 'Errors Only' : 'All Employees'}`);
      console.log(` PDF Generation - Data rows: ${data.length}`);

      // Calculate grand totals from the filtered data
      const grandTotals = {
        total_employees: data.length,
        employees_with_errors: data.filter(d => d.status === 'ERROR').length,
        employees_with_errors: result.employees_with_errors || data.filter(d => d.status === 'ERROR').length,
        total_error_amount: result.total_error_amount || data.reduce((sum, d) => sum + Math.abs(d.error_amount || 0), 0),
        
        // Sum up financial totals from filtered data
        total_earnings: data.reduce((sum, d) => sum + (d.total_earnings || 0), 0),
        total_allowances: data.reduce((sum, d) => sum + (d.total_allowances || 0), 0),
        total_deductions: data.reduce((sum, d) => sum + (d.total_deductions || 0), 0),
        total_gross_cum: data.reduce((sum, d) => sum + (d.gross_from_cum || 0), 0),
        total_net_cum: data.reduce((sum, d) => sum + (d.net_from_cum || 0), 0),
        total_tax_cum: data.reduce((sum, d) => sum + (d.tax_from_cum || 0), 0),
        total_roundup: data.reduce((sum, d) => sum + (d.roundup || 0), 0)
      };

      console.log(' PDF Generation - Grand Totals:', grandTotals);

      const templatePath = path.join(__dirname, '../../templates/salary-reconciliation.html');
      const templateContent = fs.readFileSync(templatePath, 'utf8');

      //Load image
      const image = await companySettings.getSettingsFromFile('./public/photos/logo.png');    

      // Format period for display
      const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                        'July', 'August', 'September', 'October', 'November', 'December'];
      
      let period = 'N/A';
      if (filters.month && filters.year) {
        const monthStr = filters.month.toString();
        // Extract month number (last 2 digits if YYYYMM format, otherwise the whole string)
        const monthNum = monthStr.length === 6 ? parseInt(monthStr.substring(4, 6)) : parseInt(monthStr);
        const monthName = monthNames[monthNum - 1] || filters.month;
        period = `${monthName}, ${filters.year}`;
      }

      const pdfBuffer = await this.generatePDFWithFallback(
        templatePath,
        {
          data: data,
          grandTotals: grandTotals,
          reportDate: new Date(),
          period: period,
          year: filters.year,
          month: filters.month,
          className: this.getDatabaseNameFromRequest(req),
          showErrorsOnly: showErrorsOnly,
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

      // Set response headers with appropriate filename
      const filterSuffix = showErrorsOnly ? 'errors_only' : 'all_employees';
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 
        `attachment; filename=salary_reconciliation_${filterSuffix}_${filters.month}_${filters.year}.pdf`
      );
      res.send(pdfBuffer);

      console.log('✅ PDF generated and sent successfully');

    } catch (error) {
      console.error('❌ Salary Reconciliation PDF generation error:', error);
      throw error;
    }
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

module.exports = new ReconciliationController();
