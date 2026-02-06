const BaseReportController = require('../Reports/reportsFallbackController');
const reportService = require('../../services/Reports/reportServices');
const payslipGenService = require('../../services/Reports/payslipGenerationService');
const { GenericExcelExporter } = require('../helpers/excel');
const companySettings = require('../helpers/companySettings');
const ExcelJS = require('exceljs');
//const PDFDocument = require('pdfkit');
//const jsreport = require('jsreport-core')();
const fs = require('fs');
const path = require('path');
//const { get } = require('http');

class ReportController extends BaseReportController {

  constructor() {
    super(); // Initialize base class
  }

  _getUniqueSheetName(baseName, tracker) {
    // Handle empty or null base names
    if (!baseName || baseName.trim() === '') {
      baseName = 'Unknown';
    }
    
    // Sanitize the name first
    let sanitized = baseName.replace(/[\*\?\:\\\/\[\]]/g, '-');
    sanitized = sanitized.substring(0, 31);
    sanitized = sanitized.replace(/[\s\-]+$/, '');
    
    // Check again after sanitization
    if (!sanitized || sanitized.trim() === '') {
      sanitized = 'Unknown';
    }
    
    // Check if name exists and add counter if needed
    let finalName = sanitized;
    let counter = 1;
    
    while (tracker[finalName]) {
      const suffix = ` (${counter})`;
      const maxBase = 31 - suffix.length;
      finalName = sanitized.substring(0, maxBase) + suffix;
      counter++;
    }
    
    tracker[finalName] = true;
    return finalName;
  }

  // ==========================================================================
  // IMPROVED DATA MAPPING FOR PAYSLIPS 
  // ==========================================================================
  _mapPayslipData(rawData) {
    return rawData.map(employee => {
      // Initialize totals
      let totalEarnings = 0;
      let totalDeductions = 0;

      // Separate payments by category
      const earnings = [];
      const deductions = [];

      if (Array.isArray(employee.payments)) {
        employee.payments.forEach(p => {
          const amount = parseFloat(p.amount) || 0;
          
          if (p.category_code === 'BP' || p.category_code === 'BT') {
            // Taxable payments (earnings)
            earnings.push({
              description: p.payment_desc,
              amount: amount,
              type: 'Taxable'
            });
            totalEarnings += amount;
          } else if (p.category_code === 'PT') {
            // Non-taxable payments (earnings)
            earnings.push({
              description: p.payment_desc,
              amount: amount,
              type: 'Non-Taxable'
            });
            totalEarnings += amount;
          } else if (p.category_code === 'PR' || p.category_code === 'PL') {
            // Deductions
            deductions.push({
              description: p.payment_desc,
              amount: amount,
              loan_balance: p.loan_balance || 0,
              is_loan: (p.loan_balance > 0 || p.loan > 0)
            });
            totalDeductions += amount;
          }
        });
      }

      const currentTax = parseFloat(employee.currtax) || 0;
      if (currentTax > 0) {
        deductions.push({
          description: 'PAYE Tax',
          amount: currentTax,
          loan_balance: 0,
          is_loan: false
        });
        totalDeductions += currentTax;
      }

      const netPay = totalEarnings - totalDeductions;

      return {
        // Employee Info
        employee_id: employee.employee_id,
        title: employee.title || '',
        surname: employee.surname || '',
        othername: employee.othername || '',
        empl_name: `${employee.surname || ''} ${employee.othername || ''}`.trim(),
        
        // Job Info
        gradelevel: employee.gradelevel || '',
        gradetype: employee.gradetype || '',
        department: employee.location || '',
        factory: employee.factory || '',
        
        // Bank Info
        bank_name: employee.bankname || '',
        bank_account_number: employee.bankacnumber || '',
        
        // Period Info
        payroll_year: employee.year,
        payroll_month: employee.month_desc,
        
        // Payment Details
        earnings: earnings,
        deductions: deductions,
        total_earnings: totalEarnings,
        total_deductions: totalDeductions,
        net_pay: netPay,
        
        // YTD Info
        ytd_gross: parseFloat(employee.grstodate) || 0,
        ytd_tax: parseFloat(employee.taxtodate) || 0,
        ytd_taxable: parseFloat(employee.txbltodate) || 0,
        
        // Additional Info
        nsitf: employee.nsitf || '',
        nsitfcode: employee.nsitfcode || '',
        email: employee.email || '',
        payclass: employee.payclass || '',
        payclass_name: employee.payclass_name || ''
      };
    });
  }

  // ==========================================================================
  // GENERATE PAYSLIPS (JSON RESPONSE)
  // ==========================================================================
  async generatePayslips(req, res) {
    const {
      empno1, empno2, branch, optall, optrange, optbank, optloc, optindividual, wxdate, year, month
    } = req.query;

    const station = req.user_fullname;

    if (!station) {
      return res.status(401).json({
        success: false,
        error: "User authentication required. Please log in again."
      });
    }

    const params = {
      empno1, empno2, branch, optall, optrange, optbank, optloc, optindividual, wxdate, station, year, month
    };

    try {
      // Generate temporary payslip records
      const generationResult = await payslipGenService.generatePayslips(params);

      if (!generationResult.success) {
        return res.status(400).json(generationResult);
      }

      // Retrieve and group generated payslip records
      const rawPayslips = await payslipGenService.getPayslipsGroupedByEmployee(station);
      
      // Map to clean format
      const data = this._mapPayslipData(rawPayslips);

      return res.json({
        success: true,
        message: generationResult.message,
        data: data
      });

    } catch (error) {
      console.error('Payslip generation API error:', error);
      return res.status(500).json({ 
        success: false, 
        error: error.message || "An unexpected error occurred during payslip generation." 
      });
    }
  }

  // ==========================================================================
  // GENERATE PAYSLIP PDF - JSREPORT VERSION
  // ==========================================================================
  async generatePayslipPDFEnhanced(req, res) {
    const mappedData = req.body.data || [];

    if (mappedData.length === 0) {
        throw new Error("No payslip data for selection(s).");
    }

    try {
      const templatePath = path.join(__dirname, '../../templates/payslip-template.html');
      const image = await companySettings.getSettingsFromFile('./public/photos/logo.png');

      console.log(`📄 Generating payslips for ${mappedData.length} employees`);

      const BATCH_SIZE = 500;
      
      const pdfBuffer = await this.generateBatchedPDF(
        templatePath,
        mappedData,
        BATCH_SIZE,
        {
          format: 'A5',
          landscape: false,
          timeout: 120000,
          options: {
            timeout: 120000,
            reportTimeout: 120000
          }
        },
        {
          payDate: new Date(),
          ...image
        }
      );

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename=payslips_enhanced.pdf');
      res.send(pdfBuffer);

    } catch (error) {
      console.error('Payslip PDF generation error:', error);
      return res.status(500).json({ 
        success: false, 
        error: error.message || "An error occurred during PDF generation." 
      });
    }
  }

  // ==========================================================================
  // GENERATE PAYSLIP EXCEL
  // ==========================================================================
  async generatePayslipExcel(req, res) {
    const mappedData = req.body.data || [];

    if (mappedData.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: "No payslip data provided for Excel generation." 
      });
    }

    try {
      const exporter = new GenericExcelExporter();
      const className = this.getDatabaseNameFromRequest(req);

      const columns = [
        { header: 'S/N', key: 'sn', width: 8, align: 'center' },
        { header: 'Svc No.', key: 'employee_id', width: 15 },
        { header: 'Rank', key: 'title', width: 10 },
        { header: 'Name', key: 'empl_name', width: 40 },
        { header: 'Grade Level', key: 'gradelevel', width: 12, align: 'center' },
        { header: 'Grade Type', key: 'gradetype', width: 12, align: 'center' },
        { header: 'Location', key: 'department', width: 52 },
        { header: 'RSA(Pension)', key: 'nsitfcode', width: 20 },
        { header: 'Total Emoluments', key: 'total_earnings', width: 18, align: 'right', numFmt: '₦#,##0.00' },
        { header: 'Total Deductions', key: 'total_deductions', width: 18, align: 'right', numFmt: '₦#,##0.00' },
        { header: 'Net Pay', key: 'net_pay', width: 18, align: 'right', numFmt: '₦#,##0.00' },
        { header: 'Bank', key: 'bank_name', width: 30 },
        { header: 'Account Number', key: 'bank_account_number', width: 20 }
      ];

      // Add serial numbers
      const dataWithSN = mappedData.map((item, idx) => ({
        ...item,
        sn: idx + 1
      }));

      // Calculate totals
      const totalEarnings = mappedData.reduce((sum, item) => sum + parseFloat(item.total_earnings || 0), 0);
      const totalDeductions = mappedData.reduce((sum, item) => sum + parseFloat(item.total_deductions || 0), 0);
      const totalNetPay = mappedData.reduce((sum, item) => sum + parseFloat(item.net_pay || 0), 0);

      const workbook = await exporter.createWorkbook({
        title: 'PAYSLIP REPORT',
        columns: columns,
        data: dataWithSN,
        className: className,
        totals: {
          label: 'TOTALS:',
          values: {
            8: totalEarnings,
            9: totalDeductions,
            10: totalNetPay
          }
        },
        sheetName: 'Payslips'
      });

      const filename = `payslips_${new Date().toISOString().split('T')[0]}.xlsx`;
      await exporter.exportToResponse(workbook, res, filename);

    } catch (error) {
      console.error('Payslip Export error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }


  // ==========================================================================
  // REPORT 2: PAYMENTS BY BANK
  // ==========================================================================
  async generatePaymentsByBank(req, res) {
    try {
      const { format, ...filters } = req.query;
      const result = await reportService.getPaymentsByBank(filters);

      // Check if it's a multi-class result
      const isMultiClass = filters.allClasses === 'true' || filters.allClasses === true;
      const data = isMultiClass ? result.data : result;
      const summary = isMultiClass ? result.summary : null;
      const failedClasses = isMultiClass ? result.failedClasses : null;

      if (format === 'excel') {
        return this.generatePaymentsByBankExcel(data, filters, summary, failedClasses, req, res);
      } else if (format === 'pdf') {
        return this.generatePaymentsByBankPDF(data, filters, summary, failedClasses, req, res);
      }

      res.json({ success: true, data, summary, failedClasses });
    } catch (error) {
      console.error('Error generating payments by bank:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  async generatePaymentsByBankExcel(data, filters, summary, failedClasses, req, res) {
    try {
      if (!data || data.length === 0) {
        throw new Error('No data available for the selected filters');
      }

      const exporter = new GenericExcelExporter();
      const isMultiClass = filters.allClasses === 'true' || filters.allClasses === true;
      const isSummary = filters.summaryOnly === 'true' || filters.summaryOnly === true;

      if (isMultiClass) {
        // MULTI-CLASS REPORT
        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'Payroll System';
        workbook.created = new Date();

        const sheetNameTracker = {}; // Track sheet names to avoid duplicates

        data.forEach(classData => {
          const period = classData.data.length > 0 ? 
            `${classData.data[0].month_name || filters.month}, ${classData.data[0].year || filters.year}` : 
            `${filters.month}, ${filters.year}`;

          if (isSummary) {
            // Summary for this class - use detailed summary structure
            const classSheetName = this._getUniqueSheetName(`${classData.payrollClass} Summary`, sheetNameTracker);
            const worksheet = workbook.addWorksheet(classSheetName);
            this._addBankSummaryToWorksheet(worksheet, exporter, classData.data, classData.payrollClass, period);
          } else {
            // Detailed for this class - separate sheet per bank group
            this._addDetailedSheetsToWorkbook(workbook, exporter, classData.data, classData.payrollClass, period, sheetNameTracker);
          }
        });

        // Add failed classes summary if any
        if (failedClasses && failedClasses.length > 0) {
          const failedSheet = workbook.addWorksheet('Failed Classes');
          failedSheet.getCell(1, 1).value = 'Failed Classes:';
          failedSheet.getCell(1, 1).font = { bold: true, size: 12 };
          let row = 2;
          failedClasses.forEach(fc => {
            failedSheet.getCell(row++, 1).value = fc;
          });
        }

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=payments_by_bank_multiclass.xlsx');
        await workbook.xlsx.write(res);
        res.end();

      } else {
        // SINGLE CLASS REPORT
        const period = data.length > 0 ? 
          `${data[0].month_name || filters.month}, ${data[0].year || filters.year}` : 
          `${filters.month}, ${filters.year}`;

        const className = this.getDatabaseNameFromRequest(req) || 'All Classes';

        if (isSummary) {
          // SUMMARY REPORT - use detailed summary structure
          const workbook = new ExcelJS.Workbook();
          workbook.creator = 'Payroll System';
          workbook.created = new Date();
          const worksheet = workbook.addWorksheet('Bank Summary');
          
          this._addBankSummaryToWorksheet(worksheet, exporter, data, className, period);

          res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
          res.setHeader('Content-Disposition', 'attachment; filename=payments_by_bank_summary.xlsx');
          await workbook.xlsx.write(res);
          res.end();

        } else {
          // DETAILED REPORT - Separate sheet for each bank group
          const workbook = new ExcelJS.Workbook();
          workbook.creator = 'Payroll System';
          workbook.created = new Date();

          const sheetNameTracker = {};
          this._addDetailedSheetsToWorkbook(workbook, exporter, data, className, period, sheetNameTracker);

          res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
          res.setHeader('Content-Disposition', 'attachment; filename=payments_by_bank_detailed.xlsx');
          await workbook.xlsx.write(res);
          res.end();
        }
      }

    } catch (error) {
      console.error('Payments By Bank Export error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  _addBankSummaryToWorksheet(worksheet, exporter, data, className, period) {
    // Group data by bank and branch if not already grouped
    let bankGroups;
    
    // Check if data is already in summary format (has employee_count field)
    if (data.length > 0 && data[0].employee_count !== undefined) {
      // Data is already summarized
      bankGroups = data.map(item => ({
        bankName: item.Bankcode,
        branch: item.bank_branch_name || item.bankbranch || '',
        employeeCount: parseInt(item.employee_count || 0),
        totalAmount: parseFloat(item.total_net || 0)
      }));
    } else {
      // Need to group the data
      const grouped = {};
      data.forEach(rowData => {
        const key = `${rowData.Bankcode}_${rowData.bank_branch_name || rowData.bankbranch || ''}`;
        
        if (!grouped[key]) {
          grouped[key] = {
            bankName: rowData.Bankcode,
            branch: rowData.bank_branch_name || rowData.bankbranch || '',
            employeeCount: 0,
            totalAmount: 0
          };
        }
        
        grouped[key].employeeCount++;
        grouped[key].totalAmount += parseFloat(rowData.total_net || 0);
      });
      
      bankGroups = Object.values(grouped);
    }

    worksheet.getColumn(1).width = 25;
    worksheet.getColumn(2).width = 30;
    worksheet.getColumn(3).width = 18;
    worksheet.getColumn(4).width = 20;

    let row = 1;

    // Header
    worksheet.mergeCells(row, 1, row, 4);
    worksheet.getCell(row, 1).value = exporter.config.company.name;
    worksheet.getCell(row, 1).font = { size: 14, bold: true, color: { argb: exporter.config.colors.primary } };
    worksheet.getCell(row, 1).alignment = { horizontal: 'center', vertical: 'middle' };
    row++;

    worksheet.mergeCells(row, 1, row, 4);
    worksheet.getCell(row, 1).value = 'PAYMENTS BY BANK - SUMMARY';
    worksheet.getCell(row, 1).font = { size: 12, bold: true };
    worksheet.getCell(row, 1).alignment = { horizontal: 'center', vertical: 'middle' };
    row++;

    worksheet.mergeCells(row, 1, row, 4);
    worksheet.getCell(row, 1).value = `Class: ${className} | Period: ${period}`;
    worksheet.getCell(row, 1).font = { size: 10, italic: true };
    worksheet.getCell(row, 1).alignment = { horizontal: 'center', vertical: 'middle' };
    row++;
    row++;

    // Column headers
    const headerRow = worksheet.getRow(row);
    ['Bank Code', 'Branch', 'Employees', 'Total Payment'].forEach((header, idx) => {
      const cell = headerRow.getCell(idx + 1);
      cell.value = header;
      cell.font = { bold: true, color: { argb: exporter.config.colors.primary } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: exporter.config.colors.headerBg } };
      cell.border = {
        top: { style: 'thin' },
        bottom: { style: 'thin' },
        left: { style: 'thin' },
        right: { style: 'thin' }
      };
    });
    row++;

    // Freeze at header
    worksheet.views = [{ 
      state: 'frozen', 
      ySplit: row - 1,
      topLeftCell: `A${row}`,
      activeCell: `A${row}`
    }];

    let grandTotal = 0;
    let grandEmployeeCount = 0;

    // Data rows
    bankGroups.forEach((group, idx) => {
      const dataRow = worksheet.getRow(row);
      dataRow.getCell(1).value = group.bankName;
      dataRow.getCell(2).value = group.branch;
      dataRow.getCell(3).value = group.employeeCount;
      dataRow.getCell(3).alignment = { horizontal: 'center' };
      dataRow.getCell(4).value = group.totalAmount;
      dataRow.getCell(4).numFmt = '₦#,##0.00';
      dataRow.getCell(4).alignment = { horizontal: 'right' };

      // Alternating row colors
      if (idx % 2 === 0) {
        for (let i = 1; i <= 4; i++) {
          dataRow.getCell(i).fill = { 
            type: 'pattern', 
            pattern: 'solid', 
            fgColor: { argb: exporter.config.colors.altRow } 
          };
        }
      }
      
      grandTotal += group.totalAmount;
      grandEmployeeCount += group.employeeCount;
      row++;
    });

    // Grand total
    row++;
    const totalRow = worksheet.getRow(row);
    totalRow.getCell(1).value = 'GRAND TOTAL:';
    totalRow.getCell(1).font = { bold: true, size: 11 };
    totalRow.getCell(3).value = grandEmployeeCount;
    totalRow.getCell(3).font = { bold: true };
    totalRow.getCell(3).alignment = { horizontal: 'center' };
    totalRow.getCell(4).value = grandTotal;
    totalRow.getCell(4).font = { bold: true, size: 11 };
    totalRow.getCell(4).numFmt = '₦#,##0.00';
    totalRow.getCell(4).alignment = { horizontal: 'right' };
    
    for (let i = 1; i <= 4; i++) {
      const cell = totalRow.getCell(i);
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: exporter.config.colors.totalBg } };
      cell.border = { 
        top: { style: 'medium', color: { argb: exporter.config.colors.primary } }, 
        bottom: { style: 'medium', color: { argb: exporter.config.colors.primary } } 
      };
    }
  }

  _addDetailedSheetsToWorkbook(workbook, exporter, data, className, period, sheetNameTracker = {}) {
    // Removed Bank Code and Branch columns since they're in the frozen header
    const columns = [
      { header: 'S/N', key: 'sn', width: 8, align: 'center' },
      { header: 'Svc No.', key: 'empl_id', width: 15 },
      { header: 'Full Name', key: 'fullname', width: 35 },
      { header: 'Rank', key: 'rank', width: 25 },
      { header: 'Net Payment', key: 'total_net', width: 18, align: 'right', numFmt: '₦#,##0.00' },
      { header: 'Account Number', key: 'BankACNumber', width: 22 }
    ];

    // Group data by bank and branch
    const bankGroups = {};
    
    data.forEach(rowData => {
      const key = `${rowData.Bankcode}_${rowData.bank_branch_name || rowData.bankbranch || ''}`;
      
      if (!bankGroups[key]) {
        bankGroups[key] = {
          bankName: rowData.Bankcode,
          branch: rowData.bank_branch_name || rowData.bankbranch || '',
          employees: [],
          totalAmount: 0,
          employeeCount: 0
        };
      }
      
      bankGroups[key].employees.push({
        empl_id: rowData.empl_id,
        fullname: rowData.fullname,
        rank: rowData.title || rowData.Title || '',
        total_net: parseFloat(rowData.total_net || 0),
        BankACNumber: rowData.BankACNumber
      });
      
      bankGroups[key].totalAmount += parseFloat(rowData.total_net || 0);
      bankGroups[key].employeeCount++;
    });

    let globalSN = 1;

    // Create a separate worksheet for each bank group
    Object.values(bankGroups).forEach((group, groupIdx) => {
      // Create unique sheet name
      const rawSheetName = `${group.bankName}-${group.branch}`;
      const sheetName = this._getUniqueSheetName(rawSheetName, sheetNameTracker);
      const worksheet = workbook.addWorksheet(sheetName);

      // Set column widths
      columns.forEach((col, idx) => {
        worksheet.getColumn(idx + 1).width = col.width || 15;
      });

      let row = 1;

      // Company Header
      worksheet.mergeCells(row, 1, row, columns.length);
      worksheet.getCell(row, 1).value = exporter.config.company.name;
      worksheet.getCell(row, 1).font = { size: 14, bold: true, color: { argb: exporter.config.colors.primary } };
      worksheet.getCell(row, 1).alignment = { horizontal: 'center', vertical: 'middle' };
      row++;

      // Report Title
      worksheet.mergeCells(row, 1, row, columns.length);
      worksheet.getCell(row, 1).value = 'PAYMENTS BY BANK - DETAILED';
      worksheet.getCell(row, 1).font = { size: 12, bold: true };
      worksheet.getCell(row, 1).alignment = { horizontal: 'center', vertical: 'middle' };
      row++;

      // Class and Period
      worksheet.mergeCells(row, 1, row, columns.length);
      worksheet.getCell(row, 1).value = `Class: ${className} | Period: ${period}`;
      worksheet.getCell(row, 1).font = { size: 10, italic: true };
      worksheet.getCell(row, 1).alignment = { horizontal: 'center', vertical: 'middle' };
      row++;

      // Bank/Branch Header
      worksheet.mergeCells(row, 1, row, columns.length);
      const groupHeader = worksheet.getCell(row, 1);
      groupHeader.value = `Bank: ${group.bankName} | Branch: ${group.branch} | Employees: ${group.employeeCount} | Total: ${exporter.formatMoney(group.totalAmount)}`;
      groupHeader.font = { bold: true, size: 11, color: { argb: exporter.config.colors.primary } };
      groupHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'E8E8E8' } };
      groupHeader.alignment = { horizontal: 'left', vertical: 'middle' };
      row++;

      row++; // Empty row

      // Column headers (this row will be frozen)
      const headerRowNum = row;
      const headerRow = worksheet.getRow(headerRowNum);
      columns.forEach((col, idx) => {
        const cell = headerRow.getCell(idx + 1);
        cell.value = col.header;
        cell.fill = { 
          type: 'pattern', 
          pattern: 'solid', 
          fgColor: { argb: exporter.config.colors.headerBg } 
        };
        cell.font = { 
          bold: true, 
          color: { argb: exporter.config.colors.primary }, 
          size: 10 
        };
        cell.alignment = { 
          horizontal: col.align || 'left', 
          vertical: 'middle' 
        };
        cell.border = {
          top: { style: 'thin', color: { argb: 'd1d5db' } },
          bottom: { style: 'thin', color: { argb: 'd1d5db' } },
          left: { style: 'thin', color: { argb: 'd1d5db' } },
          right: { style: 'thin', color: { argb: 'd1d5db' } }
        };
      });
      headerRow.height = 22;
      row++;

      // FREEZE PANES at the column header row
      worksheet.views = [{ 
        state: 'frozen', 
        ySplit: headerRowNum,
        topLeftCell: `A${headerRowNum + 1}`,
        activeCell: `A${headerRowNum + 1}`
      }];

      // Employee data rows
      group.employees.forEach((emp, empIdx) => {
        const dataRow = worksheet.getRow(row);
        
        dataRow.getCell(1).value = globalSN++;
        dataRow.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
        
        dataRow.getCell(2).value = emp.empl_id;
        dataRow.getCell(3).value = emp.fullname;
        dataRow.getCell(4).value = emp.rank;
        
        dataRow.getCell(5).value = emp.total_net;
        dataRow.getCell(5).numFmt = '₦#,##0.00';
        dataRow.getCell(5).alignment = { horizontal: 'right', vertical: 'middle' };
        
        dataRow.getCell(6).value = emp.BankACNumber;

        // Borders and alternating colors
        for (let i = 1; i <= columns.length; i++) {
          const cell = dataRow.getCell(i);
          cell.border = {
            top: { style: 'thin', color: { argb: 'E5E7EB' } },
            bottom: { style: 'thin', color: { argb: 'E5E7EB' } }
          };
          
          if (empIdx % 2 === 0) {
            cell.fill = { 
              type: 'pattern', 
              pattern: 'solid', 
              fgColor: { argb: exporter.config.colors.altRow } 
            };
          }
        }
        
        dataRow.height = 18;
        row++;
      });
    });

    // Create overall summary sheet with all bank totals
    const summarySheetName = this._getUniqueSheetName(`${className} Summary`, sheetNameTracker);
    const summarySheet = workbook.addWorksheet(summarySheetName);
    this._addBankSummaryToWorksheet(summarySheet, exporter, Object.values(bankGroups).map(g => ({
      Bankcode: g.bankName,
      bankbranch: g.branch,
      employee_count: g.employeeCount,
      total_net: g.totalAmount
    })), className, period);
  }

  async generatePaymentsByBankPDF(data, filters, summary, failedClasses, req, res) {
    try {
      if (!data || data.length === 0) {
        throw new Error('No data available for the selected filters');
      }

      const templatePath = path.join(__dirname, '../../templates/payments-by-bank.html');
      const image = await companySettings.getSettingsFromFile('./public/photos/logo.png');

      const isMultiClass = filters.allClasses === 'true' || filters.allClasses === true;
      const isSummary = filters.summaryOnly === 'true' || filters.summaryOnly === true;

      //const BATCH_SIZE = 500;

      let templateData = {
        reportDate: new Date(),
        year: filters.year,
        month: filters.month,
        isSummary: isSummary,
        isMultiClass: isMultiClass,
        reportTitle: isSummary ? 'Summary Report' : 'Detailed Report',
        className: this.getDatabaseNameFromRequest(req),
        ...image,
        summary: summary,
        failedClasses: failedClasses
      };

      if (isMultiClass) {
        templateData.classes = [];
        data.forEach(classData => {
          const classInfo = {
            payrollClass: classData.payrollClass,
            database: classData.database,
            period: classData.data.length > 0 ? 
              `${classData.data[0].month_name || filters.month}, ${classData.data[0].year || filters.year}` : 
              'N/A'
          };

          if (isSummary) {
            classInfo.data = classData.data;
          } else {
            const bankGroups = {};
            classData.data.forEach(row => {
              const key = `${row.Bankcode}_${row.bank_branch_name || row.bankbranch || ''}`;
              
              if (!bankGroups[key]) {
                bankGroups[key] = {
                  bankName: row.Bankcode,
                  branch: row.bank_branch_name || row.bankbranch || '',
                  employees: [],
                  totalAmount: 0,
                  employeeCount: 0
                };
              }
              
              bankGroups[key].employees.push({
                empl_id: row.empl_id,
                fullname: row.fullname,
                rank: row.title || row.Title || '',
                total_net: parseFloat(row.total_net || 0),
                BankACNumber: row.BankACNumber
              });
              
              bankGroups[key].totalAmount += parseFloat(row.total_net || 0);
              bankGroups[key].employeeCount++;
            });
            
            classInfo.bankGroups = Object.values(bankGroups);
          }

          templateData.classes.push(classInfo);
        });
      } else {
        const period = data.length > 0 ? 
          `${data[0].month_name || filters.month}, ${data[0].year || filters.year}` : 
          'N/A';
        
        templateData.period = period;

        if (isSummary) {
          templateData.data = data;
        } else {
          const bankGroups = {};
          data.forEach(row => {
            const key = `${row.Bankcode}_${row.bank_branch_name || row.bankbranch || ''}`;
            
            if (!bankGroups[key]) {
              bankGroups[key] = {
                bankName: row.Bankcode,
                branch: row.bank_branch_name || row.bankbranch || '',
                employees: [],
                totalAmount: 0,
                employeeCount: 0
              };
            }
            
            bankGroups[key].employees.push({
              empl_id: row.empl_id,
              fullname: row.fullname,
              rank: row.title || row.Title || '',
              total_net: parseFloat(row.total_net || 0),
              BankACNumber: row.BankACNumber
            });
            
            bankGroups[key].totalAmount += parseFloat(row.total_net || 0);
            bankGroups[key].employeeCount++;
          });
          
          templateData.bankGroups = Object.values(bankGroups);
        }
      }

      const pdfBuffer = await this.generatePDFWithFallback(
        templatePath,
        templateData,
        //BATCH_SIZE,
        {
          format: 'A4',
          landscape: true
        }
      );

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename=payments_by_bank.pdf');
      res.send(pdfBuffer);

    } catch (error) {
      console.error('PDF generation error:', error);
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  // ==========================================================================
  // REPORT 3: EARNINGS/DEDUCTIONS ANALYSIS
  // ==========================================================================
  async generateEarningsDeductionsAnalysis(req, res) {
    try {
      const { format, summary, payment_type, ...otherFilters } = req.query;
      
      // Map frontend parameter names to backend expected names
      const filters = {
        ...otherFilters,
        summaryOnly: summary === '1' || summary === 'true',
        paymentType: payment_type
      };
      
      console.log('Filters:', filters); // DEBUG
      
      const data = await reportService.getEarningsDeductionsAnalysis(filters);
      
      console.log('Data rows:', data.length); // DEBUG
      console.log('Sample row:', data[0]); // DEBUG

      if (format === 'excel') {
        return this.generateEarningsDeductionsAnalysisExcel(data, filters, req, res);
      } else if (format === 'pdf') {
        return this.generateEarningsDeductionsAnalysisPDF(data, req, res);
      }

      res.json({ success: true, data });
    } catch (error) {
      console.error('Error generating earnings analysis:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  async generateEarningsDeductionsAnalysisExcel(data, filters, req, res) {
    try {
      if (!data || data.length === 0) {
        throw new Error('No data available for the selected filters');
      }

      const exporter = new GenericExcelExporter();
      
      // Check if it's summary or detailed mode
      const isSummary = data.length > 0 && !data[0].hasOwnProperty('his_empno');

      if (isSummary) {
        // SUMMARY MODE - Single sheet with all payment types
        
        const columns = [
          { header: 'S/N', key: 'sn', width: 8, align: 'center' },
          { header: 'Payment Code', key: 'payment_code', width: 15 },
          { header: 'Description', key: 'payment_description', width: 35 },
          { header: 'Category', key: 'category', width: 20 },
          { header: 'Total Records', key: 'employee_count', width: 15, align: 'center' },
          { header: 'Total Amount', key: 'total_amount', width: 18, align: 'right', numFmt: '₦#,##0.00' }
        ];

        const dataWithSN = data.map((item, idx) => ({ ...item, sn: idx + 1 }));
        
        const totalRecords = data.reduce((sum, item) => sum + parseInt(item.employee_count || 0), 0);
        const totalAmount = data.reduce((sum, item) => sum + parseFloat(item.total_amount || 0), 0);

        // Calculate category summaries
        const categories = {};
        data.forEach(row => {
          const cat = row.category || 'Uncategorized';
          if (!categories[cat]) {
            categories[cat] = { count: 0, amount: 0 };
          }
          categories[cat].count += parseInt(row.employee_count || 0);
          categories[cat].amount += parseFloat(row.total_amount || 0);
        });

        const summaryItems = [
          { label: 'Total Payment Types', value: data.length },
          { label: 'Total Records', value: totalRecords },
          { label: 'Total Amount', value: totalAmount, numFmt: '₦#,##0.00' }
        ];

        // Add category breakdowns
        Object.entries(categories).forEach(([cat, vals]) => {
          summaryItems.push({ label: `${cat} Total`, value: vals.amount, numFmt: '₦#,##0.00' });
        });

        const workbook = await exporter.createWorkbook({
          title: 'EARNINGS & DEDUCTIONS ANALYSIS',
          subtitle: 'Payment Code Summary',
          columns: columns,
          data: dataWithSN,
          totals: {
            label: 'GRAND TOTALS:',
            values: {
              5: totalRecords,
              6: totalAmount
            }
          },
          summary: {
            title: 'ANALYSIS SUMMARY',
            items: summaryItems
          },
          sheetName: 'Earnings & Deductions'
        });

        await exporter.exportToResponse(workbook, res, 'earnings_deductions_analysis.xlsx');

      } else {
        // DETAILED MODE - Separate sheet per payment type with frozen headers
        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'Payroll System';
        workbook.created = new Date();

        const sheetNameTracker = {};
        const className = this.getDatabaseNameFromRequest(req);
        const period = `${filters.month}, ${filters.year}`;

        // Group data by category and payment type
        const categoriesMap = {};
        
        data.forEach(row => {
          const category = row.category || 'Other';
          const paymentCode = row.payment_code;
          
          if (!categoriesMap[category]) {
            categoriesMap[category] = {};
          }
          
          if (!categoriesMap[category][paymentCode]) {
            categoriesMap[category][paymentCode] = {
              payment_code: paymentCode,
              payment_description: row.payment_description || paymentCode,
              category: category,
              employees: [],
              subtotal: 0
            };
          }
          
          const amount = parseFloat(row.total_amount || 0);
          categoriesMap[category][paymentCode].employees.push({
            his_empno: row.his_empno,
            fullname: row.fullname || 'N/A',
            rank: row.Title || row.title || '',
            total_amount: amount
          });
          categoriesMap[category][paymentCode].subtotal += amount;
        });

        const columns = [
          { header: 'S/N', key: 'sn', width: 8, align: 'center' },
          { header: 'Svc No.', key: 'his_empno', width: 15 },
          { header: 'Full Name', key: 'fullname', width: 35 },
          { header: 'Rank', key: 'rank', width: 25 },
          { header: 'Amount', key: 'total_amount', width: 18, align: 'right', numFmt: '₦#,##0.00' }
        ];

        let globalSN = 1;
        const categoryTotals = {};

        // Create a sheet for each payment type
        Object.entries(categoriesMap).forEach(([category, paymentTypes]) => {
          categoryTotals[category] = 0;

          Object.values(paymentTypes).forEach(paymentType => {
            // Create unique sheet name
            const rawSheetName = `${paymentType.payment_code}-${paymentType.payment_description}`;
            const sheetName = this._getUniqueSheetName(rawSheetName, sheetNameTracker);
            const worksheet = workbook.addWorksheet(sheetName);

            // Set column widths
            columns.forEach((col, idx) => {
              worksheet.getColumn(idx + 1).width = col.width || 15;
            });

            let row = 1;

            // Company Header
            worksheet.mergeCells(row, 1, row, columns.length);
            worksheet.getCell(row, 1).value = exporter.config.company.name;
            worksheet.getCell(row, 1).font = { size: 14, bold: true, color: { argb: exporter.config.colors.primary } };
            worksheet.getCell(row, 1).alignment = { horizontal: 'center', vertical: 'middle' };
            row++;

            // Class and Period
            worksheet.mergeCells(row, 1, row, columns.length);
            worksheet.getCell(row, 1).value = `Class: ${className} | Period: ${period}`;
            worksheet.getCell(row, 1).font = { size: 10, italic: true };
            worksheet.getCell(row, 1).alignment = { horizontal: 'center', vertical: 'middle' };
            row++;            

            // Report Title
            worksheet.mergeCells(row, 1, row, columns.length);
            worksheet.getCell(row, 1).value = 'EARNINGS & DEDUCTIONS ANALYSIS - DETAILED';
            worksheet.getCell(row, 1).font = { size: 12, bold: true };
            worksheet.getCell(row, 1).alignment = { horizontal: 'center', vertical: 'middle' };
            row++;

            // Payment Type Header
            worksheet.mergeCells(row, 1, row, columns.length);
            const groupHeader = worksheet.getCell(row, 1);
            groupHeader.value = `Payment Code: ${paymentType.payment_code} | Description: ${paymentType.payment_description} | Category: ${category} | Employees: ${paymentType.employees.length} | Total: ${exporter.formatMoney(paymentType.subtotal)}`;
            groupHeader.font = { bold: true, size: 11, color: { argb: exporter.config.colors.primary } };
            groupHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'E8E8E8' } };
            groupHeader.alignment = { horizontal: 'left', vertical: 'middle' };
            row++;

            row++; // Empty row

            // Column headers (frozen)
            const headerRowNum = row;
            const headerRow = worksheet.getRow(headerRowNum);
            columns.forEach((col, idx) => {
              const cell = headerRow.getCell(idx + 1);
              cell.value = col.header;
              cell.fill = { 
                type: 'pattern', 
                pattern: 'solid', 
                fgColor: { argb: exporter.config.colors.headerBg } 
              };
              cell.font = { 
                bold: true, 
                color: { argb: exporter.config.colors.primary }, 
                size: 10 
              };
              cell.alignment = { 
                horizontal: col.align || 'left', 
                vertical: 'middle' 
              };
              cell.border = {
                top: { style: 'thin', color: { argb: 'd1d5db' } },
                bottom: { style: 'thin', color: { argb: 'd1d5db' } },
                left: { style: 'thin', color: { argb: 'd1d5db' } },
                right: { style: 'thin', color: { argb: 'd1d5db' } }
              };
            });
            headerRow.height = 22;
            row++;

            // FREEZE PANES at header
            worksheet.views = [{ 
              state: 'frozen', 
              ySplit: headerRowNum,
              topLeftCell: `A${headerRowNum + 1}`,
              activeCell: `A${headerRowNum + 1}`
            }];

            // Employee data rows
            paymentType.employees.forEach((emp, empIdx) => {
              const dataRow = worksheet.getRow(row);
              
              dataRow.getCell(1).value = globalSN++;
              dataRow.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
              
              dataRow.getCell(2).value = emp.his_empno;
              dataRow.getCell(3).value = emp.fullname;
              dataRow.getCell(4).value = emp.rank;
              
              dataRow.getCell(5).value = emp.total_amount;
              dataRow.getCell(5).numFmt = '₦#,##0.00';
              dataRow.getCell(5).alignment = { horizontal: 'right', vertical: 'middle' };

              // Borders and alternating colors
              for (let i = 1; i <= columns.length; i++) {
                const cell = dataRow.getCell(i);
                cell.border = {
                  top: { style: 'thin', color: { argb: 'E5E7EB' } },
                  bottom: { style: 'thin', color: { argb: 'E5E7EB' } }
                };
                
                if (empIdx % 2 === 0) {
                  cell.fill = { 
                    type: 'pattern', 
                    pattern: 'solid', 
                    fgColor: { argb: exporter.config.colors.altRow } 
                  };
                }
              }
              
              dataRow.height = 18;
              row++;
            });

            categoryTotals[category] += paymentType.subtotal;
          });
        });

        // Create overall summary sheet
        const summarySheet = workbook.addWorksheet('Overall Summary');
        this._addEarningsDeductionsSummary(summarySheet, exporter, categoriesMap, categoryTotals);

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=earnings_deductions_detailed.xlsx');
        await workbook.xlsx.write(res);
        res.end();
      }

    } catch (error) {
      console.error('Earnings Deductions Export error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  _addEarningsDeductionsSummary(worksheet, exporter, categoriesMap, categoryTotals) {
    worksheet.getColumn(1).width = 25;
    worksheet.getColumn(2).width = 35;
    worksheet.getColumn(3).width = 20;
    worksheet.getColumn(4).width = 18;
    worksheet.getColumn(5).width = 20;

    let row = 1;

    // Header
    worksheet.mergeCells(row, 1, row, 5);
    worksheet.getCell(row, 1).value = 'EARNINGS & DEDUCTIONS - OVERALL SUMMARY';
    worksheet.getCell(row, 1).font = { size: 14, bold: true, color: { argb: exporter.config.colors.primary } };
    worksheet.getCell(row, 1).alignment = { horizontal: 'center', vertical: 'middle' };
    row++;
    row++;

    // Summary by Category
    Object.entries(categoriesMap).forEach(([category, paymentTypes]) => {
      // Category header
      worksheet.mergeCells(row, 1, row, 5);
      worksheet.getCell(row, 1).value = `Category: ${category}`;
      worksheet.getCell(row, 1).font = { bold: true, size: 11, color: { argb: exporter.config.colors.primary } };
      worksheet.getCell(row, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'E8E8E8' } };
      row++;

      // Column headers
      const headerRow = worksheet.getRow(row);
      ['Payment Code', 'Description', 'Category', 'Employees', 'Total Amount'].forEach((header, idx) => {
        const cell = headerRow.getCell(idx + 1);
        cell.value = header;
        cell.font = { bold: true, color: { argb: exporter.config.colors.primary } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: exporter.config.colors.headerBg } };
        cell.border = {
          top: { style: 'thin' },
          bottom: { style: 'thin' },
          left: { style: 'thin' },
          right: { style: 'thin' }
        };
      });
      row++;

      // Payment types
      Object.values(paymentTypes).forEach(pt => {
        const dataRow = worksheet.getRow(row);
        dataRow.getCell(1).value = pt.payment_code;
        dataRow.getCell(2).value = pt.payment_description;
        dataRow.getCell(3).value = category;
        dataRow.getCell(4).value = pt.employees.length;
        dataRow.getCell(4).alignment = { horizontal: 'center' };
        dataRow.getCell(5).value = pt.subtotal;
        dataRow.getCell(5).numFmt = '₦#,##0.00';
        dataRow.getCell(5).alignment = { horizontal: 'right' };
        row++;
      });

      // Category subtotal
      const subtotalRow = worksheet.getRow(row);
      worksheet.mergeCells(row, 1, row, 4);
      subtotalRow.getCell(1).value = `${category} Total:`;
      subtotalRow.getCell(1).font = { bold: true };
      subtotalRow.getCell(1).alignment = { horizontal: 'right' };
      subtotalRow.getCell(5).value = categoryTotals[category];
      subtotalRow.getCell(5).numFmt = '₦#,##0.00';
      subtotalRow.getCell(5).alignment = { horizontal: 'right' };
      subtotalRow.getCell(5).font = { bold: true };
      subtotalRow.getCell(5).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFD966' } };
      row++;
      row++;
    });

    // Grand total
    row++;
    const grandTotal = Object.values(categoryTotals).reduce((sum, val) => sum + val, 0);
    const totalRow = worksheet.getRow(row);
    worksheet.mergeCells(row, 1, row, 4);
    totalRow.getCell(1).value = 'GRAND TOTAL:';
    totalRow.getCell(1).font = { bold: true, size: 12, color: { argb: exporter.config.colors.primary } };
    totalRow.getCell(1).alignment = { horizontal: 'right' };
    totalRow.getCell(5).value = grandTotal;
    totalRow.getCell(5).numFmt = '₦#,##0.00';
    totalRow.getCell(5).alignment = { horizontal: 'right' };
    totalRow.getCell(5).font = { bold: true, size: 12 };
    totalRow.getCell(5).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: exporter.config.colors.totalBg } };
  }

  async generateEarningsDeductionsAnalysisPDF(data, req, res) {
    try {
      if (!data || data.length === 0) {
        throw new Error('No data available for the selected filters');
      }

      const isSummary = data.length > 0 && !data[0].hasOwnProperty('his_empno');
      
      console.log('Is Summary:', isSummary);
      console.log('Data rows:', data.length);
      
      const categoriesMap = {};
      
      data.forEach(row => {
        const category = row.category || 'Other';
        const paymentCode = row.payment_code;
        
        if (!categoriesMap[category]) {
          categoriesMap[category] = {
            categoryName: category,
            paymentTypesMap: {},
            categoryTotal: 0
          };
        }
        
        if (!categoriesMap[category].paymentTypesMap[paymentCode]) {
          categoriesMap[category].paymentTypesMap[paymentCode] = {
            payment_code: paymentCode,
            payment_description: row.payment_description || paymentCode,
            employees: [],
            subtotal: 0,
            employee_count: 0
          };
        }
        
        if (isSummary) {
          const amount = parseFloat(row.total_amount || 0);
          categoriesMap[category].paymentTypesMap[paymentCode].employee_count = parseInt(row.employee_count || 0);
          categoriesMap[category].paymentTypesMap[paymentCode].subtotal = amount;
          categoriesMap[category].categoryTotal += amount;
        } else {
          const amount = parseFloat(row.total_amount || 0);
          categoriesMap[category].paymentTypesMap[paymentCode].employees.push({
            his_empno: row.his_empno,
            fullname: row.fullname || 'N/A',
            rank: row.Title || row.title || '',
            total_amount: amount
          });
          categoriesMap[category].paymentTypesMap[paymentCode].subtotal += amount;
          categoriesMap[category].paymentTypesMap[paymentCode].employee_count++;
          categoriesMap[category].categoryTotal += amount;
        }
      });
      
      const categories = Object.values(categoriesMap).map(cat => {
        if (isSummary) {
          return {
            categoryName: cat.categoryName,
            items: Object.values(cat.paymentTypesMap),
            categoryTotal: cat.categoryTotal
          };
        } else {
          return {
            categoryName: cat.categoryName,
            paymentTypes: Object.values(cat.paymentTypesMap),
            categoryTotal: cat.categoryTotal
          };
        }
      });

      const image = await companySettings.getSettingsFromFile('./public/photos/logo.png');
      const templatePath = path.join(__dirname, '../../templates/earnings-deductions.html');

      const pdfBuffer = await this.generatePDFWithFallback(
        templatePath,
        {
          categories: categories,
          reportDate: new Date(),
          month: data[0]?.month || 'N/A',
          year: data[0]?.year || 'N/A',
          className: this.getDatabaseNameFromRequest(req),
          isSummary: isSummary,
          ...image
        },
        {
          format: 'A4',
          landscape: !isSummary
        }
      );

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=earnings-deductions-${data[0]?.month}-${data[0]?.year}.pdf`);
      res.send(pdfBuffer);

    } catch (error) {
      console.error('PDF generation error:', error);
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  // ==========================================================================
  // REPORT 4: LOAN ANALYSIS (GROUPED BY LOAN TYPE)
  // ==========================================================================
  async generateLoanAnalysis(req, res) {
    try {
      const { format, ...filters } = req.query;
      const data = await reportService.getLoanAnalysis(filters);

      if (format === 'excel') {
        return this.generateLoanAnalysisExcel(data, filters, req, res);
      } else if (format === 'pdf') {
        return this.generateLoanAnalysisPDF(data, filters, req, res);
      }

      res.json({ success: true, data });
    } catch (error) {
      console.error('Error generating loan analysis:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  async generateLoanAnalysisExcel(data, filters, req, res) {
    try {
      if (!data || data.length === 0) {
        throw new Error('No outstanding loans this month');
      }

      const exporter = new GenericExcelExporter();
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'Payroll System';
      workbook.created = new Date();

      const sheetNameTracker = {};
      const className = this.getDatabaseNameFromRequest(req);
      const period = `${filters.month}, ${filters.year}`;

      const columns = [
        { header: 'S/N', key: 'sn', width: 8, align: 'center' },
        { header: 'Svc No.', key: 'employee_id', width: 15 },
        { header: 'Rank', key: 'Title', width: 10 },
        { header: 'Full Name', key: 'fullname', width: 35 },
        { header: 'Location', key: 'location', width: 25 },
        { header: 'Loan Amount', key: 'original_loan', width: 18, align: 'right', numFmt: '₦#,##0.00' },
        { header: 'This Month', key: 'this_month_payment', width: 18, align: 'right', numFmt: '₦#,##0.00' },
        { header: 'Tenor', key: 'months_remaining', width: 15, align: 'center' }
      ];

      let globalSN = 1;
      const loanTypeTotals = {};

      // Create a sheet for each loan type
      data.forEach(group => {
        // Create unique sheet name
        const rawSheetName = `${group.loan_type}-${group.loan_description}`;
        const sheetName = this._getUniqueSheetName(rawSheetName, sheetNameTracker);
        const worksheet = workbook.addWorksheet(sheetName);

        // Set column widths
        columns.forEach((col, idx) => {
          worksheet.getColumn(idx + 1).width = col.width || 15;
        });

        let row = 1;

        // Company Header
        worksheet.mergeCells(row, 1, row, columns.length);
        worksheet.getCell(row, 1).value = exporter.config.company.name;
        worksheet.getCell(row, 1).font = { size: 14, bold: true, color: { argb: exporter.config.colors.primary } };
        worksheet.getCell(row, 1).alignment = { horizontal: 'center', vertical: 'middle' };
        row++;

        // Report Title
        worksheet.mergeCells(row, 1, row, columns.length);
        worksheet.getCell(row, 1).value = 'LOAN ANALYSIS REPORT';
        worksheet.getCell(row, 1).font = { size: 12, bold: true };
        worksheet.getCell(row, 1).alignment = { horizontal: 'center', vertical: 'middle' };
        row++;

        // Class and Period
        worksheet.mergeCells(row, 1, row, columns.length);
        worksheet.getCell(row, 1).value = `Class: ${className} | Period: ${period}`;
        worksheet.getCell(row, 1).font = { size: 10, italic: true };
        worksheet.getCell(row, 1).alignment = { horizontal: 'center', vertical: 'middle' };
        row++;

        // Loan Type Header
        worksheet.mergeCells(row, 1, row, columns.length);
        const groupHeader = worksheet.getCell(row, 1);
        groupHeader.value = `Loan Type: ${group.loan_type} | Description: ${group.loan_description} | Employees: ${group.totals.count} | Total This Month: ${exporter.formatMoney(group.totals.this_month_payment)}`;
        groupHeader.font = { bold: true, size: 11, color: { argb: exporter.config.colors.primary } };
        groupHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'E8E8E8' } };
        groupHeader.alignment = { horizontal: 'left', vertical: 'middle' };
        row++;

        row++; // Empty row

        // Column headers (frozen)
        const headerRowNum = row;
        const headerRow = worksheet.getRow(headerRowNum);
        columns.forEach((col, idx) => {
          const cell = headerRow.getCell(idx + 1);
          cell.value = col.header;
          cell.fill = { 
            type: 'pattern', 
            pattern: 'solid', 
            fgColor: { argb: exporter.config.colors.headerBg } 
          };
          cell.font = { 
            bold: true, 
            color: { argb: exporter.config.colors.primary }, 
            size: 10 
          };
          cell.alignment = { 
            horizontal: col.align || 'left', 
            vertical: 'middle' 
          };
          cell.border = {
            top: { style: 'thin', color: { argb: 'd1d5db' } },
            bottom: { style: 'thin', color: { argb: 'd1d5db' } },
            left: { style: 'thin', color: { argb: 'd1d5db' } },
            right: { style: 'thin', color: { argb: 'd1d5db' } }
          };
        });
        headerRow.height = 22;
        row++;

        // FREEZE PANES at header
        worksheet.views = [{ 
          state: 'frozen', 
          ySplit: headerRowNum,
          topLeftCell: `A${headerRowNum + 1}`,
          activeCell: `A${headerRowNum + 1}`
        }];

        // Employee loan data rows
        group.loans.forEach((loan, loanIdx) => {
          const dataRow = worksheet.getRow(row);
          
          dataRow.getCell(1).value = globalSN++;
          dataRow.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
          
          dataRow.getCell(2).value = loan.employee_id;
          dataRow.getCell(3).value = loan.fullname;
          dataRow.getCell(4).value = loan.Location;
          
          dataRow.getCell(5).value = parseFloat(loan.original_loan || 0);
          dataRow.getCell(5).numFmt = '₦#,##0.00';
          dataRow.getCell(5).alignment = { horizontal: 'right', vertical: 'middle' };
          
          dataRow.getCell(6).value = parseFloat(loan.this_month_payment || 0);
          dataRow.getCell(6).numFmt = '₦#,##0.00';
          dataRow.getCell(6).alignment = { horizontal: 'right', vertical: 'middle' };
          
          dataRow.getCell(7).value = loan.months_remaining;
          dataRow.getCell(7).alignment = { horizontal: 'center', vertical: 'middle' };

          // Borders and alternating colors
          for (let i = 1; i <= columns.length; i++) {
            const cell = dataRow.getCell(i);
            cell.border = {
              top: { style: 'thin', color: { argb: 'E5E7EB' } },
              bottom: { style: 'thin', color: { argb: 'E5E7EB' } }
            };
            
            if (loanIdx % 2 === 0) {
              cell.fill = { 
                type: 'pattern', 
                pattern: 'solid', 
                fgColor: { argb: exporter.config.colors.altRow } 
              };
            }
          }
          
          dataRow.height = 18;
          row++;
        });

        // Store loan type totals
        loanTypeTotals[group.loan_description] = {
          count: group.totals.count,
          original_loan: group.totals.original_loan,
          this_month_payment: group.totals.this_month_payment
        };
      });

      // Create overall summary sheet
      const summarySheet = workbook.addWorksheet('Loan Summary');
      this._addLoanSummary(summarySheet, exporter, data, loanTypeTotals, className, period);

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename=loan_analysis.xlsx');
      await workbook.xlsx.write(res);
      res.end();

    } catch (error) {
      console.error('Loan Analysis Export error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  _addLoanSummary(worksheet, exporter, loanData, loanTypeTotals, className, period) {
    worksheet.getColumn(1).width = 30;
    worksheet.getColumn(2).width = 35;
    worksheet.getColumn(3).width = 18;
    worksheet.getColumn(4).width = 20;
    worksheet.getColumn(5).width = 20;

    let row = 1;

    // Header
    worksheet.mergeCells(row, 1, row, 5);
    worksheet.getCell(row, 1).value = exporter.config.company.name;
    worksheet.getCell(row, 1).font = { size: 14, bold: true, color: { argb: exporter.config.colors.primary } };
    worksheet.getCell(row, 1).alignment = { horizontal: 'center', vertical: 'middle' };
    row++;

    worksheet.mergeCells(row, 1, row, 5);
    worksheet.getCell(row, 1).value = 'LOAN ANALYSIS - SUMMARY';
    worksheet.getCell(row, 1).font = { size: 12, bold: true };
    worksheet.getCell(row, 1).alignment = { horizontal: 'center', vertical: 'middle' };
    row++;

    worksheet.mergeCells(row, 1, row, 5);
    worksheet.getCell(row, 1).value = `Class: ${className} | Period: ${period}`;
    worksheet.getCell(row, 1).font = { size: 10, italic: true };
    worksheet.getCell(row, 1).alignment = { horizontal: 'center', vertical: 'middle' };
    row++;
    row++;

    // Column headers
    const headerRow = worksheet.getRow(row);
    ['Loan Type', 'Description', 'Count', 'Total Loan Amount', 'This Month Payment'].forEach((header, idx) => {
      const cell = headerRow.getCell(idx + 1);
      cell.value = header;
      cell.font = { bold: true, color: { argb: exporter.config.colors.primary } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: exporter.config.colors.headerBg } };
      cell.border = {
        top: { style: 'thin' },
        bottom: { style: 'thin' },
        left: { style: 'thin' },
        right: { style: 'thin' }
      };
    });
    row++;

    // Freeze at header
    worksheet.views = [{ 
      state: 'frozen', 
      ySplit: row - 1,
      topLeftCell: `A${row}`,
      activeCell: `A${row}`
    }];

    let grandTotalCount = 0;
    let grandTotalOriginal = 0;
    let grandTotalPayment = 0;

    // Data rows
    loanData.forEach((group, idx) => {
      const dataRow = worksheet.getRow(row);
      dataRow.getCell(1).value = group.loan_type;
      dataRow.getCell(2).value = group.loan_description;
      dataRow.getCell(3).value = group.totals.count;
      dataRow.getCell(3).alignment = { horizontal: 'center' };
      dataRow.getCell(4).value = group.totals.original_loan;
      dataRow.getCell(4).numFmt = '₦#,##0.00';
      dataRow.getCell(4).alignment = { horizontal: 'right' };
      dataRow.getCell(5).value = group.totals.this_month_payment;
      dataRow.getCell(5).numFmt = '₦#,##0.00';
      dataRow.getCell(5).alignment = { horizontal: 'right' };

      // Alternating row colors
      if (idx % 2 === 0) {
        for (let i = 1; i <= 5; i++) {
          dataRow.getCell(i).fill = { 
            type: 'pattern', 
            pattern: 'solid', 
            fgColor: { argb: exporter.config.colors.altRow } 
          };
        }
      }

      grandTotalCount += group.totals.count;
      grandTotalOriginal += group.totals.original_loan;
      grandTotalPayment += group.totals.this_month_payment;
      row++;
    });

    // Grand total
    row++;
    const totalRow = worksheet.getRow(row);
    totalRow.getCell(1).value = 'GRAND TOTAL:';
    totalRow.getCell(1).font = { bold: true, size: 11 };
    totalRow.getCell(3).value = grandTotalCount;
    totalRow.getCell(3).font = { bold: true };
    totalRow.getCell(3).alignment = { horizontal: 'center' };
    totalRow.getCell(4).value = grandTotalOriginal;
    totalRow.getCell(4).font = { bold: true, size: 11 };
    totalRow.getCell(4).numFmt = '₦#,##0.00';
    totalRow.getCell(4).alignment = { horizontal: 'right' };
    totalRow.getCell(5).value = grandTotalPayment;
    totalRow.getCell(5).font = { bold: true, size: 11 };
    totalRow.getCell(5).numFmt = '₦#,##0.00';
    totalRow.getCell(5).alignment = { horizontal: 'right' };

    for (let i = 1; i <= 5; i++) {
      const cell = totalRow.getCell(i);
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: exporter.config.colors.totalBg } };
      cell.border = { 
        top: { style: 'medium', color: { argb: exporter.config.colors.primary } }, 
        bottom: { style: 'medium', color: { argb: exporter.config.colors.primary } } 
      };
    }
  }

  async generateLoanAnalysisPDF(data, filters, req, res) {
    try {
      if (!data || data.length === 0) {
        throw new Error('No outstanding loans this month');
      }

      const templatePath = path.join(__dirname, '../../templates/loan-analysis.html');
      const templateContent = fs.readFileSync(templatePath, 'utf8');

      //Load image
      const image = await companySettings.getSettingsFromFile('./public/photos/logo.png');

      // Calculate grand totals
      const grandTotals = {
        original_loan: data.reduce((sum, g) => sum + g.totals.original_loan, 0),
        this_month_payment: data.reduce((sum, g) => sum + g.totals.this_month_payment, 0),
        count: data.reduce((sum, g) => sum + g.totals.count, 0)
      };

      const templateData = {
        groups: data,
        grandTotals: grandTotals,
        className: this.getDatabaseNameFromRequest(req),
        reportDate: new Date(),
        month: filters.month || 'N/A',
        year: filters.year || 'N/A',
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
      res.setHeader('Content-Disposition', 'attachment; filename=loan_analysis.pdf');
      res.send(pdfBuffer);

    } catch (error) {
      console.error('PDF generation error:', error);
      return res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  }

  // ==========================================================================
  // REPORT 5: PAYMENTS/DEDUCTIONS BY BANK
  // ==========================================================================
  async generatePaymentsDeductionsByBank(req, res) {
    try {
      const { format, summary, payment_type, bank_name, ...otherFilters } = req.query;
      
      // Map frontend parameter names to backend expected names
      const filters = {
        ...otherFilters,
        summaryOnly: summary === '1' || summary === 'true',
        paymentType: payment_type,
        bankName: bank_name
      };
      
      console.log('Bank Report Filters:', filters); // DEBUG
      
      const data = await reportService.getPaymentsDeductionsByBank(filters);
      
      console.log('Bank Data rows:', data.length); // DEBUG
      console.log('Bank Sample row:', data[0]); // DEBUG

      if (format === 'excel') {
        return this.generatePaymentsDeductionsByBankExcel(data, res, filters.summaryOnly);
      } else if (format === 'pdf') {
        return this.generatePaymentsDeductionsByBankPDF(data, req, res);
      }

      res.json({ success: true, data });
    } catch (error) {
      console.error('Error generating payments by bank:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  async generatePaymentsDeductionsByBankExcel(data, res, isSummary = false) {
    try {
      if (!data || data.length === 0) {
        throw new Error('No data available for the selected filters');
      }

      const exporter = new GenericExcelExporter();

      if (isSummary) {
        // SUMMARY REPORT
        const columns = [
          { header: 'S/N', key: 'sn', width: 8, align: 'center' },
          { header: 'Bank', key: 'Bankcode', width: 25 },
          { header: 'Branch', key: 'bankbranch', width: 25 },
          { header: 'Payment Code', key: 'payment_code', width: 15 },
          { header: 'Description', key: 'payment_description', width: 35 },
          { header: 'Category', key: 'category', width: 20 },
          { header: 'Employee Count', key: 'employee_count', width: 15, align: 'center' },
          { header: 'Total Amount', key: 'total_amount', width: 18, align: 'right', numFmt: '₦#,##0.00' }
        ];

        const dataWithSN = data.map((item, idx) => ({ ...item, sn: idx + 1 }));
        const totalEmployees = data.reduce((sum, item) => sum + parseInt(item.employee_count || 0), 0);
        const totalAmount = data.reduce((sum, item) => sum + parseFloat(item.total_amount || 0), 0);

        const workbook = await exporter.createWorkbook({
          title: 'PAYMENTS/DEDUCTIONS BY BANK - SUMMARY',
          subtitle: 'Bank Payment Code Summary',
          columns: columns,
          data: dataWithSN,
          totals: {
            label: 'GRAND TOTALS:',
            values: {
              7: totalEmployees,
              8: totalAmount
            }
          },
          sheetName: 'Bank Payments Summary'
        });

        await exporter.exportToResponse(workbook, res, 'payments_deductions_by_bank_summary.xlsx');

      } else {
        // DETAILED REPORT
        const columns = [
          { header: 'S/N', key: 'sn', width: 8, align: 'center' },
          { header: 'Bank', key: 'Bankcode', width: 25 },
          { header: 'Branch', key: 'bankbranch', width: 25 },
          { header: 'Svc No.', key: 'his_empno', width: 15 },
          { header: 'Employee Name', key: 'Surname', width: 30 },
          { header: 'Payment Code', key: 'payment_code', width: 15 },
          { header: 'Description', key: 'payment_description', width: 35 },
          { header: 'Category', key: 'category', width: 20 },
          { header: 'Total Amount', key: 'total_amount', width: 18, align: 'right', numFmt: '₦#,##0.00' }
        ];

        const dataWithSN = data.map((item, idx) => ({ ...item, sn: idx + 1 }));
        const totalAmount = data.reduce((sum, item) => sum + parseFloat(item.total_amount || 0), 0);

        const workbook = await exporter.createWorkbook({
          title: 'PAYMENTS/DEDUCTIONS BY BANK - DETAILED',
          subtitle: 'Individual Employee Payment Details',
          columns: columns,
          data: dataWithSN,
          totals: {
            label: 'GRAND TOTALS:',
            values: {
              9: totalAmount
            }
          },
          summary: {
            title: 'SUMMARY',
            items: [
              { label: 'Total Employees', value: data.length },
              { label: 'Total Amount', value: totalAmount, numFmt: '₦#,##0.00' }
            ]
          },
          sheetName: 'Bank Payments Detailed'
        });

        await exporter.exportToResponse(workbook, res, 'payments_deductions_by_bank_detailed.xlsx');
      }

    } catch (error) {
      console.error('Payments Deductions By Bank Export error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  async generatePaymentsDeductionsByBankPDF(data, req, res) {

    try {
      if (!data || data.length === 0) {
        throw new Error('No data available for the selected filters');
      }

      const isSummary = data.length > 0 && !data[0].hasOwnProperty('his_empno');
      
      console.log('Bank PDF - Is Summary:', isSummary);
      console.log('Bank PDF - Data rows:', data.length);
      
      // Group data by bank, then category
      const banksMap = {};
      
      data.forEach(row => {
        const bankKey = `${row.Bankcode || 'Unknown'} - ${ row.bank_branch_name || row.bankbranch || 'Unknown'}`;
        const category = row.category || 'Other';
        const paymentCode = row.payment_code;
        
        // Initialize bank if it doesn't exist
        if (!banksMap[bankKey]) {
          banksMap[bankKey] = {
            bankName: row.Bankcode || 'Unknown',
            bankBranch: row.bankbranch || 'Unknown',
            branchName: row.bank_branch_name || row.bankbranch || 'Unknown',
            categoriesMap: {},
            bankTotal: 0
          };
        }
        
        // Initialize category if it doesn't exist
        if (!banksMap[bankKey].categoriesMap[category]) {
          banksMap[bankKey].categoriesMap[category] = {
            categoryName: category,
            paymentTypesMap: {},
            categoryTotal: 0
          };
        }
        
        // Initialize payment type if it doesn't exist
        if (!banksMap[bankKey].categoriesMap[category].paymentTypesMap[paymentCode]) {
          banksMap[bankKey].categoriesMap[category].paymentTypesMap[paymentCode] = {
            payment_code: paymentCode,
            payment_description: row.payment_description || paymentCode,
            employees: [],
            subtotal: 0,
            employee_count: 0
          };
        }
        
        // Determine if this is a deduction (to be subtracted)
        const isDeduction = category === 'Deduction' || category === 'Loan';
        const rawAmount = parseFloat(row.total_amount || 0);
        const amount = isDeduction ? -Math.abs(rawAmount) : rawAmount;
        
        if (isSummary) {
          // Summary mode
          banksMap[bankKey].categoriesMap[category].paymentTypesMap[paymentCode].employee_count = parseInt(row.employee_count || 0);
          banksMap[bankKey].categoriesMap[category].paymentTypesMap[paymentCode].subtotal = rawAmount; // Store positive for display
          banksMap[bankKey].categoriesMap[category].paymentTypesMap[paymentCode].isDeduction = isDeduction;
          banksMap[bankKey].categoriesMap[category].categoryTotal += amount; // Use signed amount for total
          banksMap[bankKey].bankTotal += amount;
        } else {
          // Detailed mode - add individual employee
          banksMap[bankKey].categoriesMap[category].paymentTypesMap[paymentCode].employees.push({
            his_empno: row.his_empno,
            fullname: row.fullname || 'N/A',
            rank: row.Title || row.title || '',
            total_amount: rawAmount // Store positive for display
          });
          banksMap[bankKey].categoriesMap[category].paymentTypesMap[paymentCode].subtotal += rawAmount; // Store positive for display
          banksMap[bankKey].categoriesMap[category].paymentTypesMap[paymentCode].employee_count++;
          banksMap[bankKey].categoriesMap[category].paymentTypesMap[paymentCode].isDeduction = isDeduction;
          banksMap[bankKey].categoriesMap[category].categoryTotal += amount; // Use signed amount for total
          banksMap[bankKey].bankTotal += amount;
        }
      });
      
      // Convert to array format for template
      const banks = Object.values(banksMap).map(bank => {
        const categories = Object.values(bank.categoriesMap).map(cat => {
          if (isSummary) {
            return {
              categoryName: cat.categoryName,
              items: Object.values(cat.paymentTypesMap),
              categoryTotal: cat.categoryTotal
            };
          } else {
            return {
              categoryName: cat.categoryName,
              paymentTypes: Object.values(cat.paymentTypesMap),
              categoryTotal: cat.categoryTotal
            };
          }
        });
        
        return {
          bankName: bank.bankName,
          branchName: bank.branchName,
          bankBranch: bank.bankBranch,
          categories: categories,
          bankTotal: bank.bankTotal
        };
      });
      
      console.log('Banks processed:', banks.length);
      console.log('First bank structure:', JSON.stringify(banks[0], null, 2));

      const templatePath = path.join(__dirname, '../../templates/payded-by-bank.html');
      const templateContent = fs.readFileSync(templatePath, 'utf8');

      //Load image
      const image = await companySettings.getSettingsFromFile('./public/photos/logo.png');

      const pdfBuffer = await this.generatePDFWithFallback(
        templatePath,
        {
          banks: banks,
          reportDate: new Date(),
          month: data[0]?.month || 'N/A',
          year: data[0]?.year || 'N/A',
          className: this.getDatabaseNameFromRequest(req),
          isSummary: isSummary,
          ...image
        },
        {
          format: 'A4',
          landscape: !isSummary
        }        
      );

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=payments-by-bank-${data[0]?.month}-${data[0]?.year}.pdf`);
      res.send(pdfBuffer);

    } catch (error) {
      console.error('Bank PDF generation error:', error);
      return res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  }

  // ==========================================================================
  // REPORT 6: PAYROLL REGISTER
  // ==========================================================================
  async generatePayrollRegister(req, res) {
    try {
      const { format, summary, include_elements, ...otherFilters } = req.query;
      
      // Map frontend parameter names to backend expected names
      const filters = {
        ...otherFilters,
        summaryOnly: summary === '1' || summary === 'true',
        includeElements: include_elements === '1' || include_elements === 'true'
      };
      
      console.log('Payroll Register Filters:', filters); // DEBUG
      
      const data = await reportService.getPayrollRegister(filters);
      
      console.log('Payroll Register Data rows:', data.length); // DEBUG
      console.log('Payroll Register Sample row:', data[0]); // DEBUG

      if (format === 'excel') {
        return this.generatePayrollRegisterExcel(data, req, res, filters.summaryOnly, filters.includeElements);
      } else if (format === 'pdf') {
        return this.generatePayrollRegisterPDF(data, req, res);
      }

      res.json({ success: true, data });
    } catch (error) {
      console.error('Error generating payroll register:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  async generatePayrollRegisterExcel(data, req, res, isSummary = false, includeElements = false) {
    try {
      if (!data || data.length === 0) {
        throw new Error('No data available for the selected filters');
      }

      const exporter = new GenericExcelExporter();
      const period = data.length > 0 ? {
        year: data[0].year,
        month: data[0].month
      } : { year: new Date().getFullYear(), month: new Date().getMonth() + 1 };

      const className = this.getDatabaseNameFromRequest(req);

      if (isSummary) {
        // SUMMARY REPORT - existing code unchanged
        const columns = [
          { header: 'S/N', key: 'sn', width: 8, align: 'center' },
          { header: 'Location', key: 'location', width: 30 },
          { header: 'Employee Count', key: 'employee_count', width: 18, align: 'center' },
          { header: 'Gross Pay', key: 'gross_pay', width: 18, align: 'right', numFmt: '₦#,##0.00' },
          { header: 'Total Emoluments', key: 'total_emoluments', width: 20, align: 'right', numFmt: '₦#,##0.00' },
          { header: 'Total Deductions', key: 'total_deductions', width: 20, align: 'right', numFmt: '₦#,##0.00' },
          { header: 'Tax', key: 'tax', width: 18, align: 'right', numFmt: '₦#,##0.00' },
          { header: 'Net Pay', key: 'net_pay', width: 18, align: 'right', numFmt: '₦#,##0.00' }
        ];

        const dataWithSN = data.map((item, idx) => ({ ...item, sn: idx + 1 }));

        const totalEmployees = data.reduce((sum, item) => sum + parseInt(item.employee_count || 0), 0);
        const totalGrossPay = data.reduce((sum, item) => sum + parseFloat(item.gross_pay || 0), 0);
        const totalEmoluments = data.reduce((sum, item) => sum + parseFloat(item.total_emoluments || 0), 0);
        const totalDeductions = data.reduce((sum, item) => sum + parseFloat(item.total_deductions || 0), 0);
        const totalTax = data.reduce((sum, item) => sum + parseFloat(item.tax || 0), 0);
        const totalNetPay = data.reduce((sum, item) => sum + parseFloat(item.net_pay || 0), 0);

        const workbook = await exporter.createWorkbook({
          title: 'PAYROLL REGISTER - SUMMARY',
          period: period,
          className: className,
          columns: columns,
          data: dataWithSN,
          totals: {
            label: 'GRAND TOTALS:',
            values: {
              3: totalEmployees,
              4: totalGrossPay,
              5: totalEmoluments,
              6: totalDeductions,
              7: totalTax,
              8: totalNetPay
            }
          },
          sheetName: 'Payroll Summary'
        });

        await exporter.exportToResponse(workbook, res, `payroll_register_summary_${period.year}_${period.month}.xlsx`);

      } else {
        // DETAILED REPORT - Group by Location
        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'Payroll System';
        workbook.created = new Date();

        const sheetNameTracker = {};
        const periodStr = `${this.getMonthName(period.month)} ${period.year}`;

        const columns = [
          { header: 'S/N', key: 'sn', width: 8, align: 'center' },
          { header: 'Service No', key: 'empl_id', width: 15 },
          { header: 'Rank', key: 'Title', width: 10 },
          { header: 'Name', key: 'fullname', width: 30 },
          { header: 'Grade', key: 'gradelevel', width: 10, align: 'center' }
        ];

        if (includeElements) {
          columns.push({ header: 'Payment Elements', key: 'payment_elements', width: 50 });
        }

        columns.push(
          { header: 'Gross Pay', key: 'gross_pay', width: 18, align: 'right', numFmt: '₦#,##0.00' },
          { header: 'Total Emoluments', key: 'total_emoluments', width: 20, align: 'right', numFmt: '₦#,##0.00' },
          { header: 'Total Deductions', key: 'total_deductions', width: 20, align: 'right', numFmt: '₦#,##0.00' },
          { header: 'Tax', key: 'tax', width: 18, align: 'right', numFmt: '₦#,##0.00' },
          { header: 'Net Pay', key: 'net_pay', width: 18, align: 'right', numFmt: '₦#,##0.00' },
          { header: 'Bank', key: 'Bankcode', width: 20 },
          { header: 'Account Number', key: 'BankACNumber', width: 20 }
        );

        // Group data by location
        const locationGroups = {};
        data.forEach(row => {
          const location = row.location || 'Unknown';
          if (!locationGroups[location]) {
            locationGroups[location] = [];
          }
          locationGroups[location].push(row);
        });

        let globalSN = 1;
        const locationTotals = {};

        // Create a sheet for each location
        Object.entries(locationGroups).forEach(([location, employees]) => {
          const sheetName = this._getUniqueSheetName(location, sheetNameTracker);
          const worksheet = workbook.addWorksheet(sheetName);

          // Set column widths
          columns.forEach((col, idx) => {
            worksheet.getColumn(idx + 1).width = col.width || 15;
          });

          let row = 1;

          // Company Header
          worksheet.mergeCells(row, 1, row, columns.length);
          worksheet.getCell(row, 1).value = exporter.config.company.name;
          worksheet.getCell(row, 1).font = { size: 14, bold: true, color: { argb: exporter.config.colors.primary } };
          worksheet.getCell(row, 1).alignment = { horizontal: 'center', vertical: 'middle' };
          row++;

          // Report Title
          worksheet.mergeCells(row, 1, row, columns.length);
          worksheet.getCell(row, 1).value = 'PAYROLL REGISTER - DETAILED';
          worksheet.getCell(row, 1).font = { size: 12, bold: true };
          worksheet.getCell(row, 1).alignment = { horizontal: 'center', vertical: 'middle' };
          row++;

          // Class and Period
          worksheet.mergeCells(row, 1, row, columns.length);
          worksheet.getCell(row, 1).value = `Class: ${className} | Period: ${periodStr}`;
          worksheet.getCell(row, 1).font = { size: 10, italic: true };
          worksheet.getCell(row, 1).alignment = { horizontal: 'center', vertical: 'middle' };
          row++;

          // Calculate location totals
          const locGrossPay = employees.reduce((sum, emp) => sum + parseFloat(emp.gross_pay || 0), 0);
          const locEmoluments = employees.reduce((sum, emp) => sum + parseFloat(emp.total_emoluments || 0), 0);
          const locDeductions = employees.reduce((sum, emp) => sum + parseFloat(emp.total_deductions || 0), 0);
          const locTax = employees.reduce((sum, emp) => sum + parseFloat(emp.tax || 0), 0);
          const locNetPay = employees.reduce((sum, emp) => sum + parseFloat(emp.net_pay || 0), 0);

          // Location Header
          worksheet.mergeCells(row, 1, row, columns.length);
          const groupHeader = worksheet.getCell(row, 1);
          groupHeader.value = `Location: ${location} | Employees: ${employees.length} | Net Pay: ${exporter.formatMoney(locNetPay)}`;
          groupHeader.font = { bold: true, size: 11, color: { argb: exporter.config.colors.primary } };
          groupHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'E8E8E8' } };
          groupHeader.alignment = { horizontal: 'left', vertical: 'middle' };
          row++;

          row++; // Empty row

          // Column headers (frozen)
          const headerRowNum = row;
          const headerRow = worksheet.getRow(headerRowNum);
          columns.forEach((col, idx) => {
            const cell = headerRow.getCell(idx + 1);
            cell.value = col.header;
            cell.fill = { 
              type: 'pattern', 
              pattern: 'solid', 
              fgColor: { argb: exporter.config.colors.headerBg } 
            };
            cell.font = { 
              bold: true, 
              color: { argb: exporter.config.colors.primary }, 
              size: 10 
            };
            cell.alignment = { 
              horizontal: col.align || 'left', 
              vertical: 'middle' 
            };
            cell.border = {
              top: { style: 'thin', color: { argb: 'd1d5db' } },
              bottom: { style: 'thin', color: { argb: 'd1d5db' } },
              left: { style: 'thin', color: { argb: 'd1d5db' } },
              right: { style: 'thin', color: { argb: 'd1d5db' } }
            };
          });
          headerRow.height = 22;
          row++;

          // FREEZE PANES at header
          worksheet.views = [{ 
            state: 'frozen', 
            ySplit: headerRowNum,
            topLeftCell: `A${headerRowNum + 1}`,
            activeCell: `A${headerRowNum + 1}`
          }];

          // Employee data rows
          employees.forEach((emp, empIdx) => {
            const dataRow = worksheet.getRow(row);
            
            dataRow.getCell(1).value = globalSN++;
            dataRow.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
            
            dataRow.getCell(2).value = emp.empl_id;
            dataRow.getCell(3).value = emp.Title;
            dataRow.getCell(4).value = emp.fullname;
            dataRow.getCell(5).value = emp.gradelevel;
            dataRow.getCell(5).alignment = { horizontal: 'center', vertical: 'middle' };

            let colIdx = 6;
            
            if (includeElements) {
              if (emp.payment_elements) {
                try {
                  const elements = JSON.parse(emp.payment_elements);
                  dataRow.getCell(colIdx).value = elements.map(el => 
                    `${el.code}: ₦${parseFloat(el.amount).toLocaleString('en-NG', {minimumFractionDigits: 2})}`
                  ).join('\n');
                } catch (e) {
                  dataRow.getCell(colIdx).value = '';
                }
              }
              colIdx++;
            }

            dataRow.getCell(colIdx++).value = parseFloat(emp.gross_pay || 0);
            dataRow.getCell(colIdx++).value = parseFloat(emp.total_emoluments || 0);
            dataRow.getCell(colIdx++).value = parseFloat(emp.total_deductions || 0);
            dataRow.getCell(colIdx++).value = parseFloat(emp.tax || 0);
            dataRow.getCell(colIdx++).value = parseFloat(emp.net_pay || 0);
            dataRow.getCell(colIdx++).value = emp.Bankcode;
            dataRow.getCell(colIdx).value = emp.BankACNumber;

            // Apply number formats
            const numCols = includeElements ? [6, 7, 8, 9, 10] : [5, 6, 7, 8, 9];
            numCols.forEach(nc => {
              dataRow.getCell(nc).numFmt = '₦#,##0.00';
              dataRow.getCell(nc).alignment = { horizontal: 'right', vertical: 'middle' };
            });

            // Borders and alternating colors
            for (let i = 1; i <= columns.length; i++) {
              const cell = dataRow.getCell(i);
              cell.border = {
                top: { style: 'thin', color: { argb: 'E5E7EB' } },
                bottom: { style: 'thin', color: { argb: 'E5E7EB' } }
              };
              
              if (empIdx % 2 === 0) {
                cell.fill = { 
                  type: 'pattern', 
                  pattern: 'solid', 
                  fgColor: { argb: exporter.config.colors.altRow } 
                };
              }
            }
            
            dataRow.height = 18;
            row++;
          });

          // Store location totals
          locationTotals[location] = {
            count: employees.length,
            gross_pay: locGrossPay,
            total_emoluments: locEmoluments,
            total_deductions: locDeductions,
            tax: locTax,
            net_pay: locNetPay
          };
        });

        // Create overall summary sheet
        const summarySheet = workbook.addWorksheet('Payroll Summary');
        this._addPayrollSummary(summarySheet, exporter, locationTotals, className, periodStr);

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=payroll_register_detailed_${period.year}_${period.month}.xlsx`);
        await workbook.xlsx.write(res);
        res.end();
      }

    } catch (error) {
      console.error('Payroll Register Export error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  _addPayrollSummary(worksheet, exporter, locationTotals, className, period) {
    worksheet.getColumn(1).width = 30;
    worksheet.getColumn(2).width = 18;
    worksheet.getColumn(3).width = 20;
    worksheet.getColumn(4).width = 20;
    worksheet.getColumn(5).width = 20;
    worksheet.getColumn(6).width = 18;
    worksheet.getColumn(7).width = 20;

    let row = 1;

    // Header
    worksheet.mergeCells(row, 1, row, 7);
    worksheet.getCell(row, 1).value = exporter.config.company.name;
    worksheet.getCell(row, 1).font = { size: 14, bold: true, color: { argb: exporter.config.colors.primary } };
    worksheet.getCell(row, 1).alignment = { horizontal: 'center', vertical: 'middle' };
    row++;

    worksheet.mergeCells(row, 1, row, 7);
    worksheet.getCell(row, 1).value = 'PAYROLL REGISTER - SUMMARY';
    worksheet.getCell(row, 1).font = { size: 12, bold: true };
    worksheet.getCell(row, 1).alignment = { horizontal: 'center', vertical: 'middle' };
    row++;

    worksheet.mergeCells(row, 1, row, 7);
    worksheet.getCell(row, 1).value = `Class: ${className} | Period: ${period}`;
    worksheet.getCell(row, 1).font = { size: 10, italic: true };
    worksheet.getCell(row, 1).alignment = { horizontal: 'center', vertical: 'middle' };
    row++;
    row++;

    // Column headers
    const headerRow = worksheet.getRow(row);
    ['Location', 'Count', 'Gross Pay', 'Total Emoluments', 'Total Deductions', 'Tax', 'Net Pay'].forEach((header, idx) => {
      const cell = headerRow.getCell(idx + 1);
      cell.value = header;
      cell.font = { bold: true, color: { argb: exporter.config.colors.primary } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: exporter.config.colors.headerBg } };
      cell.border = {
        top: { style: 'thin' },
        bottom: { style: 'thin' },
        left: { style: 'thin' },
        right: { style: 'thin' }
      };
    });
    row++;

    let grandTotalCount = 0;
    let grandTotalGross = 0;
    let grandTotalEmoluments = 0;
    let grandTotalDeductions = 0;
    let grandTotalTax = 0;
    let grandTotalNet = 0;

    // Data rows
    Object.entries(locationTotals).forEach(([location, totals], idx) => {
      const dataRow = worksheet.getRow(row);
      dataRow.getCell(1).value = location;
      dataRow.getCell(2).value = totals.count;
      dataRow.getCell(2).alignment = { horizontal: 'center' };
      dataRow.getCell(3).value = totals.gross_pay;
      dataRow.getCell(3).numFmt = '₦#,##0.00';
      dataRow.getCell(3).alignment = { horizontal: 'right' };
      dataRow.getCell(4).value = totals.total_emoluments;
      dataRow.getCell(4).numFmt = '₦#,##0.00';
      dataRow.getCell(4).alignment = { horizontal: 'right' };
      dataRow.getCell(5).value = totals.total_deductions;
      dataRow.getCell(5).numFmt = '₦#,##0.00';
      dataRow.getCell(5).alignment = { horizontal: 'right' };
      dataRow.getCell(6).value = totals.tax;
      dataRow.getCell(6).numFmt = '₦#,##0.00';
      dataRow.getCell(6).alignment = { horizontal: 'right' };
      dataRow.getCell(7).value = totals.net_pay;
      dataRow.getCell(7).numFmt = '₦#,##0.00';
      dataRow.getCell(7).alignment = { horizontal: 'right' };

      // Alternating row colors
      if (idx % 2 === 0) {
        for (let i = 1; i <= 7; i++) {
          dataRow.getCell(i).fill = { 
            type: 'pattern', 
            pattern: 'solid', 
            fgColor: { argb: exporter.config.colors.altRow } 
          };
        }
      }

      grandTotalCount += totals.count;
      grandTotalGross += totals.gross_pay;
      grandTotalEmoluments += totals.total_emoluments;
      grandTotalDeductions += totals.total_deductions;
      grandTotalTax += totals.tax;
      grandTotalNet += totals.net_pay;
      row++;
    });

    // Grand total
    row++;
    const totalRow = worksheet.getRow(row);
    totalRow.getCell(1).value = 'GRAND TOTAL:';
    totalRow.getCell(1).font = { bold: true, size: 11 };
    totalRow.getCell(2).value = grandTotalCount;
    totalRow.getCell(2).font = { bold: true };
    totalRow.getCell(2).alignment = { horizontal: 'center' };
    totalRow.getCell(3).value = grandTotalGross;
    totalRow.getCell(3).font = { bold: true };
    totalRow.getCell(3).numFmt = '₦#,##0.00';
    totalRow.getCell(3).alignment = { horizontal: 'right' };
    totalRow.getCell(4).value = grandTotalEmoluments;
    totalRow.getCell(4).font = { bold: true };
    totalRow.getCell(4).numFmt = '₦#,##0.00';
    totalRow.getCell(4).alignment = { horizontal: 'right' };
    totalRow.getCell(5).value = grandTotalDeductions;
    totalRow.getCell(5).font = { bold: true };
    totalRow.getCell(5).numFmt = '₦#,##0.00';
    totalRow.getCell(5).alignment = { horizontal: 'right' };
    totalRow.getCell(6).value = grandTotalTax;
    totalRow.getCell(6).font = { bold: true };
    totalRow.getCell(6).numFmt = '₦#,##0.00';
    totalRow.getCell(6).alignment = { horizontal: 'right' };
    totalRow.getCell(7).value = grandTotalNet;
    totalRow.getCell(7).font = { bold: true };
    totalRow.getCell(7).numFmt = '₦#,##0.00';
    totalRow.getCell(7).alignment = { horizontal: 'right' };

    for (let i = 1; i <= 7; i++) {
      const cell = totalRow.getCell(i);
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: exporter.config.colors.totalBg } };
      cell.border = { 
        top: { style: 'medium', color: { argb: exporter.config.colors.primary } }, 
        bottom: { style: 'medium', color: { argb: exporter.config.colors.primary } } 
      };
    }
  }

  async generatePayrollRegisterPDF(data, req, res) {

    try {
      if (!data || data.length === 0) {
        throw new Error('No data available for the selected filters');
      }

      const isSummary = data.length > 0 && !data[0].hasOwnProperty('empl_id');
      const includeElements = data.length > 0 && 
      data[0].hasOwnProperty('payment_elements') && 
      Array.isArray(data[0].payment_elements) && 
      data[0].payment_elements.length > 0;
      
      console.log('Payroll Register PDF - Is Summary:', isSummary);
      console.log('Payroll Register PDF - Include Elements:', includeElements);
      console.log('Payroll Register PDF - Data rows:', data.length);
      
      // Group data by location
      const locationsMap = {};
      
      data.forEach(row => {
        const location = row.location || 'Unknown';
        
        if (!locationsMap[location]) {
          locationsMap[location] = {
            locationName: location,
            employees: [],
            locationTotals: {
              gross_pay: 0,
              total_emoluments: 0,
              total_deductions: 0,
              tax: 0,
              net_pay: 0,
              employee_count: 0
            }
          };
        }
        
        if (isSummary) {
          const empCount = parseInt(row.employee_count || 0);
          locationsMap[location].employees.push({
            employee_count: empCount,
            gross_pay: parseFloat(row.gross_pay || 0),
            total_emoluments: parseFloat(row.total_emoluments || 0),
            total_deductions: parseFloat(row.total_deductions || 0),
            tax: parseFloat(row.tax || 0),
            net_pay: parseFloat(row.net_pay || 0)
          });
          
          locationsMap[location].locationTotals.employee_count += empCount;
          locationsMap[location].locationTotals.gross_pay += parseFloat(row.gross_pay || 0);
          locationsMap[location].locationTotals.total_emoluments += parseFloat(row.total_emoluments || 0);
          locationsMap[location].locationTotals.total_deductions += parseFloat(row.total_deductions || 0);
          locationsMap[location].locationTotals.tax += parseFloat(row.tax || 0);
          locationsMap[location].locationTotals.net_pay += parseFloat(row.net_pay || 0);
        } else {
          // Parse payment elements if present
          let parsedElements = [];
          if (includeElements && row.payment_elements) {
            // Check if it's already an array or if it's a JSON string
            if (Array.isArray(row.payment_elements)) {
              parsedElements = row.payment_elements;
            } else if (typeof row.payment_elements === 'string') {
              try {
                parsedElements = JSON.parse(row.payment_elements);
              } catch (e) {
                console.error('Failed to parse payment_elements:', e);
                parsedElements = [];
              }
            }
          }
          
          locationsMap[location].employees.push({
            empl_id: row.empl_id,
            fullname: row.fullname || 'N/A',
            gradelevel: row.gradelevel || 'N/A',
            rank: row.Title || row.title || '',
            gross_pay: parseFloat(row.gross_pay || 0),
            total_emoluments: parseFloat(row.total_emoluments || 0),
            total_deductions: parseFloat(row.total_deductions || 0),
            tax: parseFloat(row.tax || 0),
            net_pay: parseFloat(row.net_pay || 0),
            Bankcode: row.Bankcode || 'N/A',
            BankACNumber: row.BankACNumber || 'N/A',
            payment_elements: parsedElements
          });
          
          locationsMap[location].locationTotals.employee_count++;
          locationsMap[location].locationTotals.gross_pay += parseFloat(row.gross_pay || 0);
          locationsMap[location].locationTotals.total_emoluments += parseFloat(row.total_emoluments || 0);
          locationsMap[location].locationTotals.total_deductions += parseFloat(row.total_deductions || 0);
          locationsMap[location].locationTotals.tax += parseFloat(row.tax || 0);
          locationsMap[location].locationTotals.net_pay += parseFloat(row.net_pay || 0);
        }
      });
      
      // Convert to array format for template
      const locations = Object.values(locationsMap);
      
      // Calculate grand totals
      const grandTotals = {
        employee_count: 0,
        gross_pay: 0,
        total_emoluments: 0,
        total_deductions: 0,
        tax: 0,
        net_pay: 0
      };
      
      locations.forEach(loc => {
        grandTotals.employee_count += loc.locationTotals.employee_count;
        grandTotals.gross_pay += loc.locationTotals.gross_pay;
        grandTotals.total_emoluments += loc.locationTotals.total_emoluments;
        grandTotals.total_deductions += loc.locationTotals.total_deductions;
        grandTotals.tax += loc.locationTotals.tax;
        grandTotals.net_pay += loc.locationTotals.net_pay;
      });
      
      console.log('Locations processed:', locations.length);
      console.log('Grand Totals:', grandTotals);

      const period = data.length > 0 ? 
        `${this.getMonthName(data[0].month)} ${data[0].year}` : 
        'N/A';

      const templatePath = path.join(__dirname, '../../templates/payroll-register.html');
      const templateContent = fs.readFileSync(templatePath, 'utf8');

      //Load image
      const image = await companySettings.getSettingsFromFile('./public/photos/logo.png');

      const pdfBuffer = await this.generatePDFWithFallback(
        templatePath,
        {
          locations: locations,
          grandTotals: grandTotals,
          period: period,
          reportDate: new Date(),
          isSummary: isSummary,
          className: this.getDatabaseNameFromRequest(req),
          includeElements: includeElements,
          ...image
        },
        {
          format: 'A4',
          landscape: !isSummary
        }        
      );

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=payroll_register_${data[0]?.month}_${data[0]?.year}.pdf`);
      res.send(pdfBuffer);

    } catch (error) {
      console.error('Payroll Register PDF generation error:', error);
      return res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  }

  // ==========================================================================
  // HELPER: Get Filter Options
  // ==========================================================================
  async getFilterOptions(req, res) {
    try {
      const currentPeriod = await reportService.getCurrentPeriod();
      const bank = await reportService.getAvailableBanks(req);

      res.json({
        success: true,
        data: {
          bank,
          currentPeriod
        }
      });

    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  formatCurrency(amount) {
    const num = parseFloat(amount) || 0;
    return `₦${num.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  getMonthName(month) {
    const months = ['January', 'February', 'March', 'April', 'May', 'June',
                   'July', 'August', 'September', 'October', 'November', 'December'];
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

module.exports = new ReportController();


