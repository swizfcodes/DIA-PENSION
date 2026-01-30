// ============================================
// CONSOLIDATED PAYSLIP CONTROLLER
// Generates IPPIS + NAVY combined payslips
// ============================================
const BaseReportController = require('../Reports/reportsFallbackController');
const pool = require('../../config/db');
//const PDFDocument = require('pdfkit');
const jsreport = require('jsreport-core')();
const fs = require('fs');
const path = require('path');

class ConsolidatedPayslipController extends BaseReportController {
  
  constructor() {
    super(); // Initialize base class
  }

  // ==========================================================================
  // GENERATE CONSOLIDATED PAYSLIPS
  // ==========================================================================
  async generateConsolidatedPayslips(req, res) {
    const {
      period,           // Required: YYYYMM format
      payrollClass,     // Required: e.g., 'FE'
      employeeFrom,     // Optional
      employeeTo,       // Optional
      printRange        // Optional: true/false
    } = req.body;

    const username = req.user_fullname || req.user_id;

    if (!username) {
      return res.status(401).json({
        success: false,
        error: "User authentication required. Please log in again."
      });
    }

    if (!period || !payrollClass) {
      return res.status(400).json({
        success: false,
        error: "Period and payroll class are required"
      });
    }

    try {
      // ✅ Add debug logging
      const paramEmployeeFrom = employeeFrom || 'A';
      const paramEmployeeTo = employeeTo || 'Z';
      const paramPrintRange = printRange ? '1' : '0';
      
      console.log('=== STORED PROCEDURE PARAMETERS ===');
      console.log('employeeFrom:', paramEmployeeFrom);
      console.log('employeeTo:', paramEmployeeTo);
      console.log('period:', period);
      console.log('payrollClass:', payrollClass);
      console.log('username:', username);
      console.log('printRange:', paramPrintRange);
      console.log('===================================');

      // Call stored procedure to generate payslips
      const [results] = await pool.query(
        'CALL py_generate_combined_payslip(?, ?, ?, ?, ?, ?)',
        [
          paramEmployeeFrom,
          paramEmployeeTo,
          period,
          payrollClass,
          username,
          paramPrintRange
        ]
      );

      const summary = results[0][0];

      console.log('Stored procedure summary:', summary);

      // Fetch generated payslips
      const year = period.substring(0, 4);
      const monthNum = parseInt(period.substring(4, 6));

      const [monthData] = await pool.query(
        'SELECT mthdesc FROM ac_months WHERE cmonth = ?',
        [monthNum]
      );

      const month = monthData[0].mthdesc;

      const [rawPayslips] = await pool.query(
        `SELECT * FROM py_webpayslip
        WHERE work_station = ?
          AND ord = ?
          AND desc1 = ?
        ORDER BY numb, source DESC, bpc, bp`,
        [username, year, month]
      );

      console.log('Total raw payslip records fetched:', rawPayslips.length);
      console.log('Unique employees:', [...new Set(rawPayslips.map(r => r.NUMB || r.numb))].length);

      // Transform data for template
      const mappedData = this._mapConsolidatedPayslipData(rawPayslips);

      console.log('Mapped data employees:', mappedData.length);

      return res.json({
        success: true,
        message: `Generated ${summary.total_employees} consolidated payslips`,
        data: mappedData,
        summary: {
          totalEmployees: summary.total_employees,
          totalRecords: summary.total_records,
          ippisRecords: summary.ippis_records,
          navyRecords: summary.navy_records
        }
      });

    } catch (error) {
      console.error('Consolidated payslip generation error:', error);
      return res.status(500).json({
        success: false,
        error: error.message || "An unexpected error occurred"
      });
    }
  }

  // ==========================================================================
  // GENERATE CONSOLIDATED PAYSLIP PDF
  // ==========================================================================
 async generateConsolidatedPayslipPDF(req, res) {
    const mappedData = req.body.data || [];

    if (mappedData.length === 0) {
      return res.status(404).json({
        success: false,
        error: "No payslip data provided for PDF generation."
      });
    }

    try {
      const templatePath = path.join(__dirname, '../../templates/consolidated-payslip.html');

      const logoPath = './public/photos/logo.png';
      let logoDataUrl = '';
      
      if (fs.existsSync(logoPath)) {
        const logoBuffer = fs.readFileSync(logoPath);
        const logoBase64 = logoBuffer.toString('base64');
        logoDataUrl = `data:image/png;base64,${logoBase64}`;
      }

      const className = this.getDatabaseNameFromRequest(req);
      
      console.log(`📄 Generating consolidated payslips for ${mappedData.length} employees`);

      const BATCH_SIZE = 500;
      
      const pdfBuffer = await this.generateBatchedPDF(
        templatePath,
        mappedData,
        BATCH_SIZE,
        {
          format: 'A5',
          landscape: false,
          timeout: 120000,
          helpers: this._getCommonHelpers() + this._getConsolidatedHelpers(),
          options: {
            timeout: 120000,
            reportTimeout: 120000
          }
        },
        {
          payDate: new Date(),
          logoDataUrl: logoDataUrl,
          className: className
        }
      );

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename=consolidated_payslips.pdf');
      res.send(pdfBuffer);

    } catch (error) {
      console.error('Consolidated PDF generation error:', error);
      return res.status(500).json({
        success: false,
        error: error.message || "An error occurred during PDF generation."
      });
    }
  }

  // ==========================================================================
  // GENERATE CONSOLIDATED PAYSLIP EXCEL
  // ==========================================================================
  async generateConsolidatedPayslipExcel(req, res) {
    const mappedData = req.body.data || [];

    if (mappedData.length === 0) {
      return res.status(404).json({
        success: false,
        error: "No payslip data provided for Excel generation."
      });
    }

    try {
      const ExcelJS = require('exceljs');
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Consolidated Payslips');

      // Define columns
      worksheet.columns = [
        { header: 'S/N', key: 'sn', width: 8 },
        { header: 'Service No', key: 'employee_id', width: 15 },
        { header: 'Rank', key: 'title', width: 10 },
        { header: 'Name', key: 'name', width: 40 },
        { header: 'Grade Level', key: 'gradelevel', width: 12 },
        { header: 'Department', key: 'department', width: 35 },
        { header: 'Branch', key: 'factory', width: 35 },
        { header: 'IPPIS Earnings', key: 'ippis_earnings', width: 18 },
        { header: 'IPPIS Deductions', key: 'ippis_deductions', width: 18 },
        { header: 'IPPIS Net', key: 'ippis_net', width: 18 },
        { header: 'NAVY Earnings', key: 'navy_earnings', width: 18 },
        { header: 'NAVY Deductions', key: 'navy_deductions', width: 18 },
        { header: 'NAVY Net', key: 'navy_net', width: 18 },
        { header: 'Total Net Pay', key: 'net_pay', width: 18 },
        { header: 'Bank', key: 'bank_name', width: 30 },
        { header: 'Account Number', key: 'bank_account_number', width: 20 }
      ];

      // Add header row styling
      worksheet.getRow(1).font = { bold: true };
      worksheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF1E40AF' }
      };
      worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

      // Add data with calculations
      let sn = 1;
      let totals = {
        ippis_earnings: 0,
        ippis_deductions: 0,
        ippis_net: 0,
        navy_earnings: 0,
        navy_deductions: 0,
        navy_net: 0,
        net_pay: 0
      };

      mappedData.forEach(emp => {
        const ippis_earnings = (emp.ippis?.taxable_total || 0) + (emp.ippis?.nontaxable_total || 0);
        const ippis_deductions = emp.ippis?.deductions_total || 0;
        const ippis_net = emp.ippis?.net || 0;
        
        const navy_earnings = (emp.navy?.taxable_total || 0) + (emp.navy?.nontaxable_total || 0);
        const navy_deductions = emp.navy?.deductions_total || 0;
        const navy_net = emp.navy?.net || 0;

        worksheet.addRow({
          sn: sn++,
          employee_id: emp.employee_id,
          title: emp.title,
          name: `${emp.surname} ${emp.othername}`,
          gradelevel: emp.gradelevel,
          department: emp.department,
          factory: emp.factory,
          ippis_earnings: ippis_earnings,
          ippis_deductions: ippis_deductions,
          ippis_net: ippis_net,
          navy_earnings: navy_earnings,
          navy_deductions: navy_deductions,
          navy_net: navy_net,
          net_pay: emp.net_pay,
          bank_name: emp.bank_name,
          bank_account_number: emp.bank_account_number
        });

        totals.ippis_earnings += ippis_earnings;
        totals.ippis_deductions += ippis_deductions;
        totals.ippis_net += ippis_net;
        totals.navy_earnings += navy_earnings;
        totals.navy_deductions += navy_deductions;
        totals.navy_net += navy_net;
        totals.net_pay += emp.net_pay;
      });

      // Add totals row
      const totalsRow = worksheet.addRow({
        sn: '',
        employee_id: '',
        title: '',
        name: 'TOTALS:',
        gradelevel: '',
        department: '',
        factory: '',
        ippis_earnings: totals.ippis_earnings,
        ippis_deductions: totals.ippis_deductions,
        ippis_net: totals.ippis_net,
        navy_earnings: totals.navy_earnings,
        navy_deductions: totals.navy_deductions,
        navy_net: totals.navy_net,
        net_pay: totals.net_pay,
        bank_name: '',
        bank_account_number: ''
      });

      totalsRow.font = { bold: true };
      totalsRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFFAFAFA' }
      };

      // Format currency columns
      const currencyCols = ['H', 'I', 'J', 'K', 'L', 'M', 'N'];
      currencyCols.forEach(col => {
        worksheet.getColumn(col).numFmt = '₦#,##0.00';
      });

      // Set response headers
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename=consolidated_payslips.xlsx');

      await workbook.xlsx.write(res);
      res.end();

    } catch (error) {
      console.error('Consolidated Excel export error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  // ==========================================================================
  // PRIVATE: MAP CONSOLIDATED PAYSLIP DATA
  // ==========================================================================
  _mapConsolidatedPayslipData(rawPayslips) {
    const employeeMap = {};

    // Group by employee
    rawPayslips.forEach(row => {
      const empId = row.NUMB || row.numb;  // Handle case sensitivity

      if (!employeeMap[empId]) {
        employeeMap[empId] = {
          employee_id: row.NUMB || row.numb,
          surname: row.surname,
          othername: row.othername,
          title: row.title,
          gradelevel: row.gradelevel,
          gradetype: row.gradetype,
          department: row.location || row.Location,
          factory: row.factory,
          bank_name: row.bankname,
          bank_account_number: row.bankacnumber,
          nsitfcode: row.nsitfcode,
          payclass: row.payclass,
          payclass_name: row.payclass,
          payroll_month: row.desc1,
          payroll_year: row.ord,
          ippis: {
            taxable: [],
            nontaxable: [],
            deductions: [],
            taxable_total: 0,
            nontaxable_total: 0,
            deductions_total: 0,
            net: 0
          },
          navy: {
            taxable: [],
            nontaxable: [],
            deductions: [],
            taxable_total: 0,
            nontaxable_total: 0,
            deductions_total: 0,
            net: 0
          },
          net_pay: 0
        };
      }

      const emp = employeeMap[empId];
      const source = row.source;
      const category = row.bpc;
      const amount = parseFloat(row.BPM || row.bpm) || 0;  // Handle case sensitivity

      const item = {
        description: row.BP || row.bp || 'Unknown',  // ✅ FIX: Use uppercase BP
        amount: amount,
        loan_balance: row.lbal ? parseFloat(row.lbal) : null
      };

      if (source === 'IPPIS') {
        if (category === 'BP' || category === 'BT') {  // ✅ Taxable: BP or BT
          emp.ippis.taxable.push(item);
          emp.ippis.taxable_total += amount;
        } else if (category === 'PT') {  // ✅ Non-taxable: PT
          emp.ippis.nontaxable.push(item);
          emp.ippis.nontaxable_total += amount;
        } else if (category === 'PR' || category === 'PL') {  // ✅ Deductions: PR or PL
          emp.ippis.deductions.push(item);
          emp.ippis.deductions_total += amount;
        }
      } else if (source === 'NAVY') {
        if (category === 'BP' || category === 'BT') {  // ✅ Taxable: BP or BT
          emp.navy.taxable.push(item);
          emp.navy.taxable_total += amount;
        } else if (category === 'PT') {  // ✅ Non-taxable: PT
          emp.navy.nontaxable.push(item);
          emp.navy.nontaxable_total += amount;
        } else if (category === 'PR' || category === 'PL') {  // ✅ Deductions: PR or PL
          emp.navy.deductions.push(item);
          emp.navy.deductions_total += amount;
        }
      }
    });

    // Calculate net amounts
    Object.values(employeeMap).forEach(emp => {
      emp.ippis.net = emp.ippis.taxable_total + emp.ippis.nontaxable_total - emp.ippis.deductions_total;
      emp.navy.net = emp.navy.taxable_total + emp.navy.nontaxable_total - emp.navy.deductions_total;
      emp.net_pay = emp.ippis.net + emp.navy.net;

      // Remove empty sections
      if (emp.ippis.taxable.length === 0 && emp.ippis.nontaxable.length === 0 && emp.ippis.deductions.length === 0) {
        emp.ippis = null;
      }
      if (emp.navy.taxable.length === 0 && emp.navy.nontaxable.length === 0 && emp.navy.deductions.length === 0) {
        emp.navy = null;
      }
    });

    return Object.values(employeeMap);
  }

  // ==========================================================================
  // PRIVATE: HANDLEBARS HELPERS
  // ==========================================================================
  _getConsolidatedHelpers() {
    return `
      function formatCurrency(value) {
        if (!value && value !== 0) return '0.00';
        return parseFloat(value).toFixed(2).replace(/\\d(?=(\\d{3})+\\.)/g, '$&,');
      }

      function formatDate(date) {
        const d = new Date(date);
        const months = ['January', 'February', 'March', 'April', 'May', 'June', 
                       'July', 'August', 'September', 'October', 'November', 'December'];
        return d.getDate() + ' ' + months[d.getMonth()] + ' ' + d.getFullYear();
      }

      function add(a, b) {
        return (parseFloat(a) || 0) + (parseFloat(b) || 0);
      }

      function eq(a, b) {
        return a === b;
      }
    `;
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

module.exports = ConsolidatedPayslipController;