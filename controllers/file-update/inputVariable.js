const pool = require('../../config/db');
const payPeriodReportService = require('../../services/file-update/inputVariable');
const BaseReportController = require('../Reports/reportsFallbackController');
const companySettings = require('../helpers/companySettings');
const { GenericExcelExporter } = require('../helpers/excel');
const fs = require('fs');
const path = require('path');

class PayPeriodReportController extends BaseReportController {

  constructor() {
    super(); // Initialize base class
  }

  // ==========================================================================
  // PAY PERIOD REPORT - MAIN ENDPOINT (WITH STDRATE CHECKER)
  // ==========================================================================
  async generatePayPeriodReport(req, res) {
    try {
      // ========== STDRATE STAGE CHECKER ==========
      const [bt05Rows] = await pool.query(
        "SELECT ord AS year, mth AS month, sun FROM py_stdrate WHERE type='BT05' LIMIT 1"
      );
      
      if (!bt05Rows.length) {
        return res.status(404).json({ 
          status: 'FAILED',
          error: 'BT05 not found - processing period not set' 
        });
      }

      const { year, month, sun } = bt05Rows[0];
      
      // Validation: Ensure previous stage completed (input variables must be ready)
      if (sun < 775) {
        return res.status(400).json({ 
          status: 'FAILED',
          error: 'Personnel data changes not yet printed.',
          currentStage: sun,
          requiredStage: 775
        });
      }
      
      // First print: update stage from 775 to 777
      // Subsequent reprints: sun >= 777, skip the update
      if (sun === 775) {
        const user = req.user?.fullname || req.user_fullname || 'System Auto';
        await pool.query(
          "UPDATE py_stdrate SET sun = 777, createdby = ? WHERE type = 'BT05'", 
          [user]
        );
        console.log('✅ BT05 stage updated: 775 → 777 (Pay Period first print)');
      }
      // ========== END STDRATE STAGE CHECKER ==========

      const { format } = req.query;
      
      console.log('Pay Period Report - Direct generation'); // DEBUG
      
      const data = await payPeriodReportService.getPayPeriodReport();
      const statistics = await payPeriodReportService.getPayPeriodStatistics();
      
      console.log('Pay Period Report Data rows:', data.length); // DEBUG
      console.log('Pay Period Report Statistics:', statistics); // DEBUG

      if (format === 'excel') {
        return this.generatePayPeriodReportExcel(data, res, statistics);
      } else if (format === 'pdf') {
        return this.generatePayPeriodReportPDF(data, req, res, statistics);
      }

      // Return JSON with statistics
      res.json({ 
        success: true, 
        data,
        statistics
      });
    } catch (error) {
      console.error('Error generating Pay Period report:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  // ==========================================================================
  // EXCEL GENERATION
  // ==========================================================================
  async generatePayPeriodReportExcel(data, res, statistics) {
    try {
      const exporter = new GenericExcelExporter();

      const columns = [
        { header: 'S/N', key: 'sn', width: 8, align: 'center' },
        { header: 'Pay Period', key: 'pay_period', width: 12, align: 'center' },
        { header: 'Svc No.', key: 'employee_id', width: 15 },
        { header: 'Rank', key: 'Title', width: 10 },
        { header: 'Full Name', key: 'full_name', width: 30 },
        { header: 'Pay Element', key: 'pay_element_type', width: 12 },
        { header: 'Description', key: 'pay_element_description', width: 35 },
        { header: 'MAK1', key: 'mak1', width: 10, align: 'center' },
        { header: 'Amount Payable', key: 'amount_primary', width: 16, align: 'right', numFmt: '₦#,##0.00' },
        { header: 'MAK2', key: 'mak2', width: 10, align: 'center' },
        { header: 'Amount To Date', key: 'amount_to_date', width: 16, align: 'right', numFmt: '₦#,##0.00' },
        { header: 'Pay Indicator', key: 'payment_indicator', width: 12, align: 'center' },
        { header: 'Tenor', key: 'number_of_months', width: 12, align: 'center' }
      ];

      // Add S/N
      const dataWithSN = data.map((item, idx) => ({
        ...item,
        sn: idx + 1
      }));

      // Calculate totals
      const totalAmountPrimary = data.reduce((sum, item) => sum + parseFloat(item.amount_primary || 0), 0);
      const totalAmountToDate = data.reduce((sum, item) => sum + parseFloat(item.amount_to_date || 0), 0);

      const workbook = await exporter.createWorkbook({
        title: 'DIA PAYROLL - INPUT VARIATION REPORT',
        subtitle: 'All Records',
        columns: columns,
        data: dataWithSN,
        totals: {
          label: 'GRAND TOTALS:',
          values: {
            9: totalAmountPrimary,
            11: totalAmountToDate
          }
        },
        sheetName: 'Pay Period Report'
      });

      // Apply conditional formatting
      const worksheet = workbook.worksheets[0];
      const dataStartRow = 5; // After title, subtitle, blank row, and header

      dataWithSN.forEach((row, index) => {
        const rowNum = dataStartRow + index;
        
        // Highlight high amounts (> 1,000,000)
        if (parseFloat(row.amount_primary) > 1000000) {
          const amountCell = worksheet.getCell(`I${rowNum}`);
          amountCell.font = { bold: true, color: { argb: 'FF006100' } };
        }
      });

      // Auto-shrink: Set print scaling to 65% for better fit
      worksheet.pageSetup = {
        ...worksheet.pageSetup,
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        scale: 65,
        orientation: 'landscape',
        paperSize: 9 // A4
      };

      await exporter.exportToResponse(workbook, res, `pay_period_report.xlsx`);

    } catch (error) {
      console.error('Pay Period Report Export error:', error);
      if (!res.headersSent) {
        res.status(500).json({ success: false, error: error.message });
      }
    }
  }

  // ==========================================================================
  // PDF GENERATION (USING TEMPLATE)
  // ==========================================================================
  async generatePayPeriodReportPDF(data, req, res, statistics) {
    try {
      if (!data || data.length === 0) {
        throw new Error('No data available for the selected filters');
      }

      console.log('Pay Period Report PDF - Data rows:', data.length);

      const templatePath = path.join(__dirname, '../../templates/input-variable.html');
      
      if (!fs.existsSync(templatePath)) {
        console.error('❌ Template file not found:', templatePath);
        throw new Error('PDF template file not found');
      }

      const templateContent = fs.readFileSync(templatePath, 'utf8');

      //Load image
      const image = await companySettings.getSettingsFromFile('./public/photos/logo.png');        

      const pdfBuffer = await this.generatePDFWithFallback(
        templatePath,
        {
          data: data,
          statistics: statistics,
          reportDate: new Date(),
          filters: 'All Records',
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

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=pay_period_report.pdf`);
      res.send(pdfBuffer);

    } catch (error) {
      console.error('Pay Period Report PDF generation error:', error);
      return res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  }


  // ==========================================================================
  // HELPER FUNCTIONS
  // ==========================================================================
  
  getMonthName(month) {
    const months = ['January', 'February', 'March', 'April', 'May', 'June',
                   'July', 'August', 'September', 'October', 'November', 'December'];
    return months[parseInt(month) - 1] || '';
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

module.exports = new PayPeriodReportController();