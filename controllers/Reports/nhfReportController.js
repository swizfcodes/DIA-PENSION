const BaseReportController = require('../Reports/reportsFallbackController');
const nhfReportService = require('../../services/Reports/nhfReportService');
const companySettings = require('../helpers/companySettings');
const { GenericExcelExporter } = require('../helpers/excel');
const pool = require('../../config/db');
//const ExcelJS = require('exceljs');
//const jsreport = require('jsreport-core')();
const fs = require('fs');
const path = require('path');


class NHFReportController extends BaseReportController {

  constructor() {
    super(); // Initialize base class
  }

  // ==========================================================================
  // NHF REPORT - MAIN ENDPOINT
  // ==========================================================================
  async generateNHFReport(req, res) {
    try {
      const { format, summaryOnly, ...otherFilters } = req.query;
      
      // Map frontend parameter names to backend expected names
      const filters = {
        ...otherFilters,
        summaryOnly: summaryOnly === '1' || summaryOnly === 'true',
      };
      
      console.log('NHF Report Filters:', filters); // DEBUG
      
      const data = await nhfReportService.getNHFReport(filters);
      
      console.log('NHF Report Data rows:', data.length); // DEBUG
      console.log('NHF Report Sample row:', data[0]); // DEBUG

      if (format === 'excel') {
        return this.generateNHFReportExcel(data, req, res, filters.summaryOnly);
      } else if (format === 'pdf') {
        return this.generateNHFReportPDF(data, req, res);
      }

      // Return JSON with summary statistics
      const summary = this.calculateSummary(data, filters.summaryOnly);

      res.json({ 
        success: true, 
        data,
        summary
      });
    } catch (error) {
      console.error('Error generating NHF report:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  // Calculate summary statistics
  calculateSummary(data, isSummary) {
    if (data.length === 0) {
      return {
        totalEmployees: 0,
        totalNHFThisMonth: 0,
        totalNHFToDate: 0,
        averageNHFThisMonth: 0,
        totalNetPay: 0
      };
    }

    if (isSummary) {
      return {
        totalEmployees: data[0]?.employee_count || 0,
        totalNHFThisMonth: data[0]?.total_nhf_this_month || 0,
        totalNHFToDate: data[0]?.total_nhf_to_date || 0,
        averageNHFThisMonth: data[0]?.avg_nhf_this_month || 0,
        totalNetPay: data[0]?.total_net_pay || 0
      };
    } else {
      const totalNHFMonth = data.reduce((sum, row) => sum + parseFloat(row.nhf_this_month || 0), 0);
      const totalNHFToDate = data.reduce((sum, row) => sum + parseFloat(row.nhf_to_date || 0), 0);
      const totalNet = data.reduce((sum, row) => sum + parseFloat(row.net_pay || 0), 0);
      
      return {
        totalEmployees: data.length,
        totalNHFThisMonth: totalNHFMonth,
        totalNHFToDate: totalNHFToDate,
        averageNHFThisMonth: totalNHFMonth / data.length,
        totalNetPay: totalNet
      };
    }
  }

  // ==========================================================================
  // EXCEL GENERATION
  // ==========================================================================
  async generateNHFReportExcel(data, req, res, isSummary = false) {
    try {
      const exporter = new GenericExcelExporter();

      if (!data || data.length === 0) {
        throw new Error('No NHF contribution this month');
      }

      // Extract period from data
      const period = data.length > 0 ? {
        year: data[0].year,
        month: data[0].month
      } : { year: new Date().getFullYear(), month: new Date().getMonth() + 1 };

      const className = await this.getDatabaseNameFromRequest(req);

      if (isSummary) {
        // ==========================================================================
        // SUMMARY REPORT
        // ==========================================================================
        const columns = [
          { header: 'Total Records', key: 'employee_count', width: 18, align: 'center' },
          { header: 'Total NHF This Month', key: 'total_nhf_this_month', width: 22, align: 'right', numFmt: '₦#,##0.00' },
          { header: 'Average NHF This Month', key: 'avg_nhf_this_month', width: 22, align: 'right', numFmt: '₦#,##0.00' },
          { header: 'Min NHF This Month', key: 'min_nhf_this_month', width: 20, align: 'right', numFmt: '₦#,##0.00' },
          { header: 'Max NHF This Month', key: 'max_nhf_this_month', width: 20, align: 'right', numFmt: '₦#,##0.00' },
          { header: 'Total NHF To Date', key: 'total_nhf_to_date', width: 22, align: 'right', numFmt: '₦#,##0.00' },
          { header: 'Average NHF To Date', key: 'avg_nhf_to_date', width: 22, align: 'right', numFmt: '₦#,##0.00' },
          //{ header: 'Total Net Pay', key: 'total_net_pay', width: 20, align: 'right', numFmt: '₦#,##0.00' }
        ];

        const workbook = await exporter.createWorkbook({
          title: 'NATIONAL HOUSING FUND REPORT - SUMMARY',
          subtitle: 'Aggregated NHF Statistics',
          period: period,
          className: className,
          columns: columns,
          data: data,
          sheetName: 'NHF Summary'
        });

        const filename = `nhf_summary_${period.year}_${period.month}.xlsx`;
        await exporter.exportToResponse(workbook, res, filename);

      } else {
        // ==========================================================================
        // DETAILED REPORT
        // ==========================================================================
        const columns = [
          { header: 'S/N', key: 'sn', width: 8, align: 'center' },
          { header: 'Svc No.', key: 'employee_id', width: 15 },
          { header: 'Rank', key: 'Title', width: 12 },
          { header: 'Full Name', key: 'full_name', width: 40 },
          { header: 'DateOf 1st APpointment', key: 'date_employed', width: 18, align: 'center' },
          { header: 'NSITF Code', key: 'nsitf_code', width: 19 },
          { header: 'Grade Type', key: 'grade_type', width: 12, align: 'center' },
          { header: 'Grade Level', key: 'grade_level', width: 12, align: 'center' },
          { header: 'YearsSince Promotion', key: 'years_in_level', width: 15, align: 'center' },
          { header: 'Location', key: 'location_name', width: 25 },
          { header: 'NHF This Month', key: 'nhf_contribution', width: 18, align: 'right', numFmt: '₦#,##0.00' },
          { header: 'NHF To Date', key: 'nhf_paid_todate', width: 18, align: 'right', numFmt: '₦#,##0.00' },
          //{ header: 'Net Pay', key: 'net_pay', width: 18, align: 'right', numFmt: '₦#,##0.00' },
          //{ header: 'Bank', key: 'Bankcode', width: 20 },
          //{ header: 'Account Number', key: 'BankACNumber', width: 20 }
        ];

        // Add serial numbers
        const dataWithSN = data.map((item, idx) => ({
          ...item,
          sn: idx + 1
        }));

        // Calculate totals
        const totalNHFThisMonth = data.reduce((sum, item) => sum + parseFloat(item.nhf_contribution || 0), 0);
        const totalNHFToDate = data.reduce((sum, item) => sum + parseFloat(item.nhf_paid_todate || 0), 0);
        const totalNetPay = data.reduce((sum, item) => sum + parseFloat(item.net_pay || 0), 0);
        const avgNHFThisMonth = totalNHFThisMonth / data.length;
        const maxNHFThisMonth = Math.max(...data.map(item => parseFloat(item.nhf_contribution || 0)));
        const minNHFThisMonth = Math.min(...data.map(item => parseFloat(item.nhf_contribution || 0)));

        const workbook = await exporter.createWorkbook({
          title: 'NATIONAL HOUSING FUND REPORT - DETAILED',
          period: period,
          className: className,
          columns: columns,
          data: dataWithSN,
          totals: {
            label: 'GRAND TOTALS:',
            values: {
              11: totalNHFThisMonth,   // Column 11: NHF This Month
              12: totalNHFToDate,       // Column 12: NHF To Date
              //13: totalNetPay           // Column 13: Net Pay
            }
          },
          summary: {
            //title: 'REPORT SUMMARY',
            /*items: [
              { label: 'Total Employees', value: data.length },
              { label: 'Total NHF This Month', value: totalNHFThisMonth, numFmt: '₦#,##0.00' },
              { label: 'Average NHF This Month', value: avgNHFThisMonth, numFmt: '₦#,##0.00' },
              { label: 'Maximum NHF This Month', value: maxNHFThisMonth, numFmt: '₦#,##0.00' },
              { label: 'Minimum NHF This Month', value: minNHFThisMonth, numFmt: '₦#,##0.00' },
              { label: 'Total NHF To Date', value: totalNHFToDate, numFmt: '₦#,##0.00' },
              { label: 'Total Net Pay', value: totalNetPay, numFmt: '₦#,##0.00' }
            ]*/
          },
          sheetName: 'NHF Detailed'
        });

        const filename = `nhf_detailed_${period.year}_${period.month}.xlsx`;
        await exporter.exportToResponse(workbook, res, filename);
      }

    } catch (error) {
      console.error('NHF Report Export error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  // ==========================================================================
  // PDF GENERATION
  // ==========================================================================
  async generateNHFReportPDF(data, req, res) {
    try {
      if (!data || data.length === 0) {
        throw new Error('No NHF contribution this month');
      }

      const isSummary = data.length > 0 && !data[0].hasOwnProperty('employee_id');
      
      console.log('NHF Report PDF - Is Summary:', isSummary);
      console.log('NHF Report PDF - Data rows:', data.length);

      // Calculate totals
      const summary = this.calculateSummary(data, isSummary);

      //Load image
      const image = await companySettings.getSettingsFromFile('./public/photos/logo.png');

      const templatePath = path.join(__dirname, '../../templates/nhf-report.html');
      const templateContent = fs.readFileSync(templatePath, 'utf8');

      console.log('🔍 Template contains {{{logoDataUrl}}}?', templateContent.includes('{{{logoDataUrl}}}'));

      const pdfBuffer = await this.generatePDFWithFallback(
        templatePath,
        {
          data: data,
          summary: summary,
          reportDate: new Date(),
          period: data.length > 0 ? 
            `${this.getMonthName(data[0].month)} ${data[0].year}` : 
            'N/A',
          isSummary: isSummary,
          className: await this.getDatabaseNameFromRequest(req),
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
        `attachment; filename=nhf_report_${data[0]?.month || 'report'}_${data[0]?.year || 'report'}.pdf`
      );
      res.send(pdfBuffer);

    } catch (error) {
      console.error('NHF Report PDF generation error:', error);
      return res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  }

  // ==========================================================================
  // GET FILTER OPTIONS
  // ==========================================================================
  async getNHFFilterOptions(req, res) {
    try {
      const currentPeriod = await nhfReportService.getCurrentPeriod();

      res.json({
        success: true,
        data: {
          currentPeriod
        }
      });
    } catch (error) {
      console.error('Error getting NHF filter options:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  // ==========================================================================
  // HELPER FUNCTIONS
  // ==========================================================================
  
  getMonthName(month) {
    const months = ['January', 'February', 'March', 'April', 'May', 'June',
                   'July', 'August', 'September', 'October', 'November', 'December'];
    return months[month - 1] || '';
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

module.exports = new NHFReportController();