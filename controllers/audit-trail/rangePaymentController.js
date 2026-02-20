const rangePaymentServices = require('../../services/audit-trail/rangePaymentServices');
const BaseReportController = require('../Reports/reportsFallbackController')
const companySettings = require('../helpers/companySettings');
const { GenericExcelExporter } = require('../helpers/excel');
const ExcelJS = require('exceljs');
const pool = require('../../config/db');
//const jsreport = require('jsreport-core')();
const fs = require('fs');
const path = require('path');

class RangePaymentController extends BaseReportController {

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


  async generatePaymentsByBankInRange(req, res) {
    try {
      const { format, ...filters } = req.query;
      
      // Validate required parameters for in-range filtering
      if (!filters.minAmount || !filters.maxAmount) {
        return res.status(400).json({ 
          success: false, 
          error: 'Both minAmount and maxAmount are required for in-range reports' 
        });
      }
      
      const result = await rangePaymentServices.getPaymentsByBankInRange(filters);

      // Check if it's a multi-class result
      const isMultiClass = filters.allClasses === 'true' || filters.allClasses === true;
      const data = isMultiClass ? result.data : result.data;
      const amountRange = result.amountRange;
      const summary = isMultiClass ? result.summary : null;
      const failedClasses = isMultiClass ? result.failedClasses : null;

      if (format === 'excel') {
        return this.generatePaymentsByBankInRangeExcel(
          data, 
          filters, 
          amountRange, 
          summary, 
          failedClasses, 
          req, 
          res
        );
      } else if (format === 'pdf') {
        return this.generatePaymentsByBankInRangePDF(
          data, 
          filters, 
          amountRange, 
          summary, 
          failedClasses, 
          req, 
          res
        );
      }

      res.json({ 
        success: true, 
        data, 
        amountRange,
        summary, 
        failedClasses 
      });
    } catch (error) {
      console.error('Error generating in-range payments by bank:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  async generatePaymentsByBankInRangeExcel(data, filters, amountRange, summary, failedClasses, req, res) {
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

        const sheetNameTracker = {};

        data.forEach(classData => {
          const period = classData.data.length > 0 ? 
            `${classData.data[0].month_name || filters.month}, ${classData.data[0].year || filters.year}` : 
            `${filters.month}, ${filters.year}`;

          if (isSummary) {
            const classSheetName = this._getUniqueSheetName(`${classData.payrollClass} Summary`, sheetNameTracker);
            const worksheet = workbook.addWorksheet(classSheetName);
            // CHANGE: Pass amountRange to worksheet method
            this._addBankSummaryToWorksheetInRange(
              worksheet, 
              exporter, 
              classData.data, 
              classData.payrollClass, 
              period,
              amountRange  // NEW PARAMETER
            );
          } else {
            // CHANGE: Pass amountRange to detailed sheets method
            this._addDetailedSheetsToWorkbookInRange(
              workbook, 
              exporter, 
              classData.data, 
              classData.payrollClass, 
              period, 
              sheetNameTracker,
              amountRange  // NEW PARAMETER
            );
          }
        });

        // Add failed classes summary if any
        if (failedClasses && failedClasses.length > 0) {
          const failedSheet = workbook.addWorksheet('Failed Classes');
          failedSheet.getCell(1, 1).value = 'Failed Classes:';
          failedSheet.getCell(1, 1).font = { bold: true, size: 12 };
          let row = 2;
          failedClasses.forEach(fc => {
            failedSheet.getCell(row++, 1).value = JSON.stringify(fc);
          });
        }

        // CHANGE: Update filename to reflect in-range report
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=payments_by_bank_in_range_${amountRange.min}_to_${amountRange.max}.xlsx`);
        await workbook.xlsx.write(res);
        res.end();

      } else {
        // SINGLE CLASS REPORT
        const period = data.length > 0 ? 
          `${data[0].month_name || filters.month}, ${data[0].year || filters.year}` : 
          `${filters.month}, ${filters.year}`;

        const className = await this.getDatabaseNameFromRequest(req) || 'All Classes';

        if (isSummary) {
          const workbook = new ExcelJS.Workbook();
          workbook.creator = 'Payroll System';
          workbook.created = new Date();
          const worksheet = workbook.addWorksheet('Bank Summary');
          
          // CHANGE: Pass amountRange to worksheet method
          this._addBankSummaryToWorksheetInRange(
            worksheet, 
            exporter, 
            data, 
            className, 
            period,
            amountRange  // NEW PARAMETER
          );

          res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
          res.setHeader('Content-Disposition', `attachment; filename=payments_by_bank_summary_in_range_${amountRange.min}_to_${amountRange.max}.xlsx`);
          await workbook.xlsx.write(res);
          res.end();

        } else {
          const workbook = new ExcelJS.Workbook();
          workbook.creator = 'Payroll System';
          workbook.created = new Date();

          const sheetNameTracker = {};
          // CHANGE: Pass amountRange to detailed sheets method
          this._addDetailedSheetsToWorkbookInRange(
            workbook, 
            exporter, 
            data, 
            className, 
            period, 
            sheetNameTracker,
            amountRange  // NEW PARAMETER
          );

          res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
          res.setHeader('Content-Disposition', `attachment; filename=payments_by_bank_detailed_in_range_${amountRange.min}_to_${amountRange.max}.xlsx`);
          await workbook.xlsx.write(res);
          res.end();
        }
      }

    } catch (error) {
      console.error('Payments By Bank In-Range Export error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  _addBankSummaryToWorksheetInRange(worksheet, exporter, data, className, period, amountRange) {
    // Group data by bank and branch if not already grouped
    let bankGroups;
    
    if (data.length > 0 && data[0].employee_count !== undefined) {
      bankGroups = data.map(item => ({
        bankName: item.Bankcode,
        branch: item.bank_branch_name || item.bankbranch || '',
        employeeCount: parseInt(item.employee_count || 0),
        totalAmount: parseFloat(item.total_net || 0)
      }));
    } else {
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
    worksheet.getCell(row, 1).value = 'OUT OF RANGE PAYMENTS - SUMMARY';
    worksheet.getCell(row, 1).font = { size: 12, bold: true };
    worksheet.getCell(row, 1).alignment = { horizontal: 'center', vertical: 'middle' };
    row++;

    worksheet.mergeCells(row, 1, row, 4);
    worksheet.getCell(row, 1).value = `Class: ${className} | Period: ${period}`;
    worksheet.getCell(row, 1).font = { size: 10, italic: true };
    worksheet.getCell(row, 1).alignment = { horizontal: 'center', vertical: 'middle' };
    row++;

    // NEW: Add amount range information
    worksheet.mergeCells(row, 1, row, 4);
    worksheet.getCell(row, 1).value = `Amount Range: ₦${exporter.formatMoney(amountRange.min)} to ₦${exporter.formatMoney(amountRange.max)}`;
    worksheet.getCell(row, 1).font = { size: 10, bold: true, color: { argb: 'FF0066CC' } };
    worksheet.getCell(row, 1).alignment = { horizontal: 'center', vertical: 'middle' };
    worksheet.getCell(row, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE6F2FF' } };
    row++;
    
    row++; // Empty row

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

  _addDetailedSheetsToWorkbookInRange(workbook, exporter, data, className, period, sheetNameTracker = {}, amountRange) {
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
      const rawSheetName = `${group.bankName}-${group.branch}`;
      const sheetName = this._getUniqueSheetName(rawSheetName, sheetNameTracker);
      const worksheet = workbook.addWorksheet(sheetName);

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

      // Report Title - CHANGED
      worksheet.mergeCells(row, 1, row, columns.length);
      worksheet.getCell(row, 1).value = 'OUT OF RANGE PAYMENTS - DETAILED';
      worksheet.getCell(row, 1).font = { size: 12, bold: true };
      worksheet.getCell(row, 1).alignment = { horizontal: 'center', vertical: 'middle' };
      row++;

      // Class and Period
      worksheet.mergeCells(row, 1, row, columns.length);
      worksheet.getCell(row, 1).value = `Class: ${className} | Period: ${period}`;
      worksheet.getCell(row, 1).font = { size: 10, italic: true };
      worksheet.getCell(row, 1).alignment = { horizontal: 'center', vertical: 'middle' };
      row++;

      // NEW: Amount Range Info
      worksheet.mergeCells(row, 1, row, columns.length);
      worksheet.getCell(row, 1).value = `Amount Range: ₦${exporter.formatMoney(amountRange.min)} to ₦${exporter.formatMoney(amountRange.max)}`;
      worksheet.getCell(row, 1).font = { size: 10, bold: true, color: { argb: 'FF0066CC' } };
      worksheet.getCell(row, 1).alignment = { horizontal: 'center', vertical: 'middle' };
      worksheet.getCell(row, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE6F2FF' } };
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

    // Create overall summary sheet - CHANGED: Pass amountRange
    const summarySheetName = this._getUniqueSheetName(`${className} Summary`, sheetNameTracker);
    const summarySheet = workbook.addWorksheet(summarySheetName);
    this._addBankSummaryToWorksheetInRange(
      summarySheet, 
      exporter, 
      Object.values(bankGroups).map(g => ({
        Bankcode: g.bankName,
        bankbranch: g.branch,
        employee_count: g.employeeCount,
        total_net: g.totalAmount
      })), 
      className, 
      period,
      amountRange  // NEW PARAMETER
    );
  }

  async generatePaymentsByBankInRangePDF(data, filters, amountRange, summary, failedClasses, req, res) {
    try {
      if (!data || data.length === 0) {
        throw new Error('No data available for the selected filters');
      }
      
      const templatePath = path.join(__dirname, '../../templates/range-payments.html');
      const templateContent = fs.readFileSync(templatePath, 'utf8');

      const image = await companySettings.getSettingsFromFile('./public/photos/logo.png');

      const isMultiClass = filters.allClasses === 'true' || filters.allClasses === true;
      const isSummary = filters.summaryOnly === 'true' || filters.summaryOnly === true;

      // Prepare template data
      let templateData = {
        reportDate: new Date(),
        year: filters.year,
        month: filters.month,
        isSummary: isSummary,
        isMultiClass: isMultiClass,
        isInRange: true,
        reportTitle: isSummary ? 'Summary Report (In-Range)' : 'Detailed Report (In-Range)',
        className: await this.getDatabaseNameFromRequest(req),
        amountRange: amountRange,
        ...image,
        summary: summary,
        failedClasses: failedClasses
      };

      if (isMultiClass) {
        // Multi-class report structure
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
            // Summary data for this class
            classInfo.data = classData.data;
          } else {
            // Detailed data - group by bank and branch
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
        // Single class report (original logic)
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
      res.setHeader('Content-Disposition', `attachment; filename=payments_by_bank_in_range_${amountRange.min}_to_${amountRange.max}.pdf`);
      res.send(pdfBuffer);

    } catch (error) {
      console.error('PDF generation error:', error);
      return res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  }



  async getFilterOptions(req, res) {
    try {
      const currentPeriod = await rangePaymentServices.getCurrentPeriod();
      const bank = await rangePaymentServices.getAvailableBanks(req);

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

module.exports = new RangePaymentController();