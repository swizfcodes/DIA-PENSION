
const pool = require('../../config/db');
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
      if (sun < 777) {
        return res.status(400).json({ 
          status: 'FAILED',
          error: 'Input variables must be processed first.',
          currentStage: sun,
          requiredStage: 777
        });
      }
      
      // First print: update stage from 777 to 778
      // Subsequent reprints: sun >= 778, skip the update
      if (sun === 777) {
        const user = req.user?.fullname || req.user_fullname || 'System Auto';
        await pool.query(
          "UPDATE py_stdrate SET sun = 778, createdby = ? WHERE type = 'BT05'", 
          [user]
        );
        console.log('✅ BT05 stage updated: 777 → 778 (Pay Period first print)');
      }
      // ========== END STDRATE STAGE CHECKER ==========

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
      
      // Fetch data from py_payded table
      const data = await this.getPayPeriodDataFromPayded(filters);
      const statistics = await this.getPayPeriodStatistics(data);
      
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
  // DATA FETCHING FROM py_payded TABLE
  // ==========================================================================
  async getPayPeriodDataFromPayded(filters) {
    let whereConditions = [];
    let params = [];

    if (filters.fromPeriod) {
      whereConditions.push('pay_period >= ?');
      params.push(filters.fromPeriod);
    }

    if (filters.toPeriod) {
      whereConditions.push('pay_period <= ?');
      params.push(filters.toPeriod);
    }

    if (filters.emplId) {
      whereConditions.push('employee_id = ?');
      params.push(filters.emplId);
    }

    if (filters.createdBy) {
      whereConditions.push('created_by = ?');
      params.push(filters.createdBy);
    }

    if (filters.payType) {
      whereConditions.push('pay_element_type = ?');
      params.push(filters.payType);
    }

    const whereClause = whereConditions.length > 0 
      ? 'WHERE ' + whereConditions.join(' AND ')
      : '';

    const query = `
      SELECT 
        pay_period,
        employee_id,
        Title,
        full_name,
        pay_element_type,
        pay_element_description,
        mak1,
        amount_primary,
        mak2,
        amount_secondary,
        amount_additional,
        amount_to_date,
        payment_indicator,
        number_of_months
      FROM py_payded
      ${whereClause}
      ORDER BY employee_id, pay_period
    `;

    const [rows] = await pool.query(query, params);
    return rows;
  }

  async getPayPeriodStatistics(data) {
    const totalAmountPrimary = data.reduce((sum, item) => sum + parseFloat(item.amount_primary || 0), 0);
    const totalAmountSecondary = data.reduce((sum, item) => sum + parseFloat(item.amount_secondary || 0), 0);
    const totalAmountAdditional = data.reduce((sum, item) => sum + parseFloat(item.amount_additional || 0), 0);
    const totalAmountToDate = data.reduce((sum, item) => sum + parseFloat(item.amount_to_date || 0), 0);

    return {
      totalRecords: data.length,
      totalAmountPrimary,
      totalAmountSecondary,
      totalAmountAdditional,
      totalAmountToDate
    };
  }

  // ==========================================================================
  // EXCEL GENERATION
  // ==========================================================================
  async generatePayPeriodReportExcel(data, res, filters, statistics) {
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
      const totalAmountToDate = data.reduce((sum, item) => sum + parseFloat(item.amount_to_date || 0), 0);

      const workbook = await exporter.createWorkbook({
        title: 'DIA PAYROLL - INPUT VARIATION REPORT',
        subtitle: filterDescription,
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

      await exporter.exportToResponse(workbook, res, `pay_period_report_${filters.fromPeriod || 'all'}_${filters.toPeriod || 'all'}.xlsx`);

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
  async generatePayPeriodReportPDF(data, req, res, filters, statistics) {
    try {
      if (!data || data.length === 0) {
        throw new Error('No data available for the selected filters');
      }

      console.log('Pay Period Report PDF - Data rows:', data.length);

      const templatePath = path.join(__dirname, '../../templates/variation-input-listing.html');
      
      if (!fs.existsSync(templatePath)) {
        console.error('❌ Template file not found:', templatePath);
        throw new Error('PDF template file not found');
      }

      const templateContent = fs.readFileSync(templatePath, 'utf8');

      //Load image
      const image = await companySettings.getSettingsFromFile('./public/photos/logo.png');        

      // Format filter description
      let filterDescription = '';
      if (filters.fromPeriod || filters.toPeriod) {
        filterDescription += `Period: ${this.formatPeriod(filters.fromPeriod) || 'All'} to ${this.formatPeriod(filters.toPeriod) || 'All'}`;
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
          className: this.getDatabaseNameFromRequest(req),
          fromPeriod: this.formatPeriod(filters.fromPeriod),
          toPeriod: this.formatPeriod(filters.toPeriod),
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
      // Get distinct values from py_payded table
      const [payPeriods] = await pool.query(`
        SELECT DISTINCT pay_period 
        FROM py_payded 
        ORDER BY pay_period DESC
      `);

      const [payTypes] = await pool.query(`
        SELECT DISTINCT pay_element_type 
        FROM py_payded 
        WHERE pay_element_type IS NOT NULL
        ORDER BY pay_element_type
      `);

      const [operators] = await pool.query(`
        SELECT DISTINCT created_by 
        FROM py_payded 
        WHERE created_by IS NOT NULL
        ORDER BY created_by
      `);

      const [employees] = await pool.query(`
        SELECT DISTINCT employee_id, full_name 
        FROM py_payded 
        ORDER BY employee_id
      `);

      // Get current period from BT05
      const [bt05Rows] = await pool.query(
        "SELECT ord AS year, mth AS month FROM py_stdrate WHERE type='BT05' LIMIT 1"
      );

      let currentPeriod = null;
      if (bt05Rows.length > 0) {
        const { year, month } = bt05Rows[0];
        currentPeriod = `${year}${month.toString().padStart(2, '0')}`;
      }

      res.json({
        success: true,
        data: {
          payPeriods: payPeriods.map(p => ({ 
            code: p.pay_period.toString(), 
            description: this.formatPeriod(p.pay_period) 
          })),
          payTypes: payTypes.map(t => ({ 
            code: t.pay_element_type, 
            description: t.pay_element_type 
          })),
          operators: operators.map(o => ({ 
            code: o.created_by, 
            description: o.created_by 
          })),
          employees: employees.map(e => ({ 
            Empl_ID: e.employee_id, 
            full_name: e.full_name 
          })),
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
  
  formatPeriod(period) {
    if (!period) return null;
    
    const periodStr = period.toString();
    if (periodStr.length < 6) return periodStr;
    
    const year = periodStr.substring(0, 4);
    const month = periodStr.substring(4, 6);
    
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                       'July', 'August', 'September', 'October', 'November', 'December'];
    
    const monthIndex = parseInt(month) - 1;
    const monthName = monthNames[monthIndex] || month;
    
    return `${monthName} ${year}`;
  }

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