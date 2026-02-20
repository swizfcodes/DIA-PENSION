const payPeriodReportService = require('../../services/audit-trail/inputVariationServices');
const BaseReportController = require('../Reports/reportsFallbackController');
const companySettings = require('../helpers/companySettings');
const { GenericExcelExporter } = require('../helpers/excel');
const pool = require('../../config/db');
//const ExcelJS = require('exceljs');
//const jsreport = require('jsreport-core')();
const fs = require('fs');
const path = require('path');

class PayPeriodReportController extends BaseReportController {

  constructor() {
    super(); // Initialize base class
  }

  // ==========================================================================
  // PAY PERIOD REPORT - MAIN ENDPOINT
  // ==========================================================================
  async generatePayPeriodReport(req, res) {
    try {
      const { format, ...filterParams } = req.query;
      
      // Map frontend parameter names to backend expected names
      const filters = {
        fromPeriod: filterParams.fromPeriod || filterParams.from_period,
        toPeriod: filterParams.toPeriod || filterParams.to_period,
        emplId: filterParams.emplId || filterParams.empl_id || filterParams.employeeId,
        createdBy: filterParams.createdBy || filterParams.created_by || filterParams.operator,
        payType: filterParams.payType || filterParams.pay_type || filterParams.type
      };
      
      console.log('Pay Period Report Filters:', filters); // DEBUG
      
      const data = await payPeriodReportService.getPayPeriodReport(filters);
      const statistics = await payPeriodReportService.getPayPeriodStatistics(filters);
      
      console.log('Pay Period Report Data rows:', data.length); // DEBUG
      console.log('Pay Period Report Statistics:', statistics); // DEBUG

      if (format === 'excel') {
        return this.generatePayPeriodReportExcel(data, res, filters, statistics);
      } else if (format === 'pdf') {
        return this.generatePayPeriodReportPDF(data, req, res, filters, statistics);
      }

      // Return JSON with statistics
      res.json({ 
        success: true, 
        data,
        statistics,
        filters
      });
    } catch (error) {
      console.error('Error generating Pay Period report:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  // ==========================================================================
  // EXCEL GENERATION
  // ==========================================================================
  async generatePayPeriodReportExcel(data, res, filters, statistics) {
    try {
      if (!data || data.length === 0) {
        throw new Error('No data available for the selected filters');
      }

      const exporter = new GenericExcelExporter();

      const columns = [
        { header: 'S/N', key: 'sn', width: 8, align: 'center' },
        { header: 'Pay Period', key: 'pay_period', width: 12, align: 'center' },
        { header: 'Svc No.', key: 'employee_id', width: 15 },
        { header: 'Rank', key: 'title_code', width: 10 },
        { header: 'Full Name', key: 'full_name', width: 30 },
        { header: 'Pay Element', key: 'pay_element_type', width: 12 },
        { header: 'Description', key: 'pay_element_description', width: 35 },
        { header: 'MAK1', key: 'mak1', width: 10, align: 'center' },
        { header: 'Amount Payable', key: 'amount_primary', width: 16, align: 'right', numFmt: '₦#,##0.00' },
        { header: 'MAK2', key: 'mak2', width: 10, align: 'center' },
        //{ header: 'Amount Secondary', key: 'amount_secondary', width: 16, align: 'right', numFmt: '₦#,##0.00' },
        //{ header: 'Amount Additional', key: 'amount_additional', width: 16, align: 'right', numFmt: '₦#,##0.00' },
        { header: 'Amount To Date', key: 'amount_to_date', width: 16, align: 'right', numFmt: '₦#,##0.00' },
        { header: 'Pay Indicator', key: 'payment_indicator', width: 12, align: 'center' },
        { header: 'Tenor', key: 'number_of_months', width: 12, align: 'center' }
      ];

      // Add S/N
      const dataWithSN = data.map((item, idx) => ({
        ...item,
        sn: idx + 1
      }));

      // Build filter description for subtitle
      let filterText = [];
      if (filters.fromPeriod || filters.toPeriod) {
        filterText.push(`Period: ${filters.fromPeriod || 'All'} to ${filters.toPeriod || 'All'}`);
      }
      if (filters.emplId) filterText.push(`Employee: ${filters.emplId}`);
      if (filters.createdBy) filterText.push(`Operator: ${filters.createdBy}`);
      if (filters.payType) filterText.push(`Pay Type: ${filters.payType}`);
      
      const filterDescription = filterText.length > 0 ? filterText.join(' | ') : 'All Records';

      // Calculate totals
      const totalAmountPrimary = data.reduce((sum, item) => sum + parseFloat(item.amount_primary || 0), 0);
      const totalAmountSecondary = data.reduce((sum, item) => sum + parseFloat(item.amount_secondary || 0), 0);
      const totalAmountAdditional = data.reduce((sum, item) => sum + parseFloat(item.amount_additional || 0), 0);
      const totalAmountToDate = data.reduce((sum, item) => sum + parseFloat(item.amount_to_date || 0), 0);

      const workbook = await exporter.createWorkbook({
        title: 'NIGERIAN NAVY - INPUT VARIATION REPORT',
        subtitle: filterDescription,
        columns: columns,
        data: dataWithSN,
        totals: {
          label: 'GRAND TOTALS:',
          values: {
            9: totalAmountPrimary,
            11: totalAmountSecondary,
            12: totalAmountAdditional,
            13: totalAmountToDate
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

      // Auto-shrink: Set print scaling to 65% for better fit (15 columns is very wide)
      worksheet.pageSetup = {
        ...worksheet.pageSetup,
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        scale: 65, // Shrink to 65% for 15+ column tables
        orientation: 'landscape',
        paperSize: 9 // A4
      };

      await exporter.exportToResponse(workbook, res, `pay_period_report_${filters.fromPeriod || 'all'}_${filters.toPeriod || 'all'}.xlsx`);

    } catch (error) {
      console.error('Pay Period Report Export error:', error);
      if (!res.headersSent) {
        res.status(500).json({ success: false, error: error.message });
      }
    }
  }

  // ==========================================================================
  // PDF GENERATION
  // ==========================================================================
  async generatePayPeriodReportPDF(data, req, res, filters, statistics) {
    try {
      if (!data || data.length === 0) {
        throw new Error('No data available for the selected filters');
      }

      console.log('Pay Period Report PDF - Data rows:', data.length);

      const templatePath = path.join(__dirname, '../../templates/variation-input-listing.html');
      const templateContent = fs.readFileSync(templatePath, 'utf8');

      //Load image
      const image = await companySettings.getSettingsFromFile('./public/photos/logo.png');        

      // Format filter description
      let filterDescription = '';
      if (filters.fromPeriod || filters.toPeriod) {
        filterDescription += `Period: ${payPeriodReportService.formatPeriod(filters.fromPeriod) || 'All'} to ${payPeriodReportService.formatPeriod(filters.toPeriod) || 'All'}`;
      }
      if (filters.emplId) filterDescription += ` | Employee: ${filters.emplId}`;
      if (filters.createdBy) filterDescription += ` | Operator: ${filters.createdBy}`;
      if (filters.payType) filterDescription += ` | Pay Type: ${filters.payType}`;

      const pdfBuffer = await this.generatePDFWithFallback(
        templatePath,
        {
          data: data,
          statistics: statistics,
          reportDate: new Date(),
          filters: filterDescription,
          className: await this.getDatabaseNameFromRequest(req),
          fromPeriod: payPeriodReportService.formatPeriod(filters.fromPeriod),
          toPeriod: payPeriodReportService.formatPeriod(filters.toPeriod),
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
      res.setHeader('Content-Disposition', 
        `attachment; filename=pay_period_report_${filters.fromPeriod || 'all'}_${filters.toPeriod || 'all'}.pdf`
      );
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
  // GET FILTER OPTIONS
  // ==========================================================================
  async getPayPeriodFilterOptions(req, res) {
    try {
      const [payPeriods, payTypes, operators, employees, currentPeriod] = await Promise.all([
        payPeriodReportService.getAvailablePayPeriods(),
        payPeriodReportService.getAvailablePayTypes(),
        payPeriodReportService.getAvailableOperators(),
        payPeriodReportService.getAvailableEmployees(),
        payPeriodReportService.getCurrentPeriod()
      ]);

      res.json({
        success: true,
        data: {
          payPeriods,
          payTypes,
          operators,
          employees,
          currentPeriod
        }
      });
    } catch (error) {
      console.error('Error getting Pay Period filter options:', error);
      res.status(500).json({ success: false, error: error.message });
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

  async getDatabaseNameFromRequest(req) {
    const currentDb = req.current_class;
    if (!currentDb) return 'MILITARY';

    const [classInfo] = await pool.query(
      'SELECT classname FROM py_payrollclass WHERE db_name = ?',
      [currentDb]
    );

    return classInfo.length > 0 ? classInfo[0].classname : currentDb;
  }
}

module.exports = new PayPeriodReportController();