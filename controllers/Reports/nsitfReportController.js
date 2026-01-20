const nsitfReportService = require('../../services/Reports/nsitfReportService');
const ExcelJS = require('exceljs');
const companySettings = require('../helpers/companySettings');
const { GenericExcelExporter } = require('../helpers/excel');
const jsreport = require('jsreport-core')();
const fs = require('fs');
const { get } = require('http');
const path = require('path');

class NSITFReportController {

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
      console.log('✅ JSReport initialized for NSITF Reports');
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
          day: 'numeric',
          month: 'long',
          year: 'numeric'
        });
      }

      function formatTime(date) {
        return new Date(date).toLocaleTimeString('en-GB', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: true
        });
      }
      
      function subtract(a, b) {
        return (parseFloat(a) || 0) - (parseFloat(b) || 0);
      }
      
      function eq(a, b) {
        return a === b;
      }
      
      function gt(a, b) {
          return parseFloat(a) > parseFloat(b);
      }
      
      function sum(array, property) {
        if (!array || !Array.isArray(array)) return 0;
        return array.reduce((sum, item) => sum + (parseFloat(item[property]) || 0), 0);
      }
      
      function groupBy(array, property) {
        if (!array || !Array.isArray(array)) return [];
        
        const groups = {};
        array.forEach(item => {
          const key = item[property] || 'Unknown';
          if (!groups[key]) {
            groups[key] = [];
          }
          groups[key].push(item);
        });
        
        return Object.keys(groups).sort().map(key => ({
          key: key,
          values: groups[key]
        }));
      }
      
      function sumByType(earnings, type) {
        let total = 0;
        if (Array.isArray(earnings)) {
          earnings.forEach(item => {
            if (item.type === type) {
              total += parseFloat(item.amount) || 0;
            }
          });
        }
        return total;
      }
    `;
  }

  _getUniqueSheetName(baseName, tracker) {
    // Sanitize the name first
    let sanitized = baseName.replace(/[\*\?\:\\\/\[\]]/g, '-');
    sanitized = sanitized.substring(0, 31);
    sanitized = sanitized.replace(/[\s\-]+$/, '');
    
    // Check if name exists and add counter if needed
    let finalName = sanitized;
    let counter = 1;
    
    while (tracker[finalName]) {
      // Add counter and ensure still within 31 char limit
      const suffix = ` (${counter})`;
      const maxBase = 31 - suffix.length;
      finalName = sanitized.substring(0, maxBase) + suffix;
      counter++;
    }
    
    tracker[finalName] = true;
    return finalName;
  }

  // ==========================================================================
  // NSITF REPORT - MAIN ENDPOINT
  // ==========================================================================
  async generateNSITFReport(req, res) {
    try {
      const { format, summaryOnly, pfa_code, ...otherFilters } = req.query;
      
      // Map frontend parameter names to backend expected names
      const filters = {
        ...otherFilters,
        summaryOnly: summaryOnly === '1' || summaryOnly === 'true',
        pfaCode: pfa_code
      };
      
      console.log('NSITF Report Filters:', filters); // DEBUG
      
      const data = await nsitfReportService.getNSITFReport(filters);
      
      console.log('NSITF Report Data rows:', data.length); // DEBUG
      console.log('NSITF Report Sample row:', data[0]); // DEBUG

      if (format === 'excel') {
        return this.generateNSITFReportExcel(data, req, res, filters.summaryOnly);
      } else if (format === 'pdf') {
        return this.generateNSITFReportPDF(data, req, res);
      }

      // Return JSON with summary statistics
      const summary = this.calculateSummary(data, filters.summaryOnly);

      res.json({ 
        success: true, 
        data,
        summary
      });
    } catch (error) {
      console.error('Error generating NSITF report:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  // Calculate summary statistics
  calculateSummary(data, isSummary) {
    if (data.length === 0) {
      return {
        totalEmployees: 0,
        totalNetPay: 0,
        averageNetPay: 0,
        pfaCount: 0
      };
    }

    if (isSummary) {
      return {
        totalEmployees: data.reduce((sum, row) => sum + parseInt(row.employee_count || 0), 0),
        totalNetPay: data.reduce((sum, row) => sum + parseFloat(row.total_net_pay || 0), 0),
        averageNetPay: data.reduce((sum, row) => sum + parseFloat(row.avg_net_pay || 0), 0) / data.length,
        pfaCount: data.length
      };
    } else {
      const totalNet = data.reduce((sum, row) => sum + parseFloat(row.net_pay || 0), 0);
      
      return {
        totalEmployees: data.length,
        totalNetPay: totalNet,
        averageNetPay: totalNet / data.length,
        pfaCount: [...new Set(data.map(row => row.pfa_code))].length
      };
    }
  }

  // ==========================================================================
  // EXCEL GENERATION
  // ==========================================================================
  async generateNSITFReportExcel(data, req, res, isSummary = false) {
    try {
      const exporter = new GenericExcelExporter();
      const period = data.length > 0 ? { year: data[0].year, month: data[0].month } : 
                    { year: new Date().getFullYear(), month: new Date().getMonth() + 1 };

      const className = this.getDatabaseNameFromRequest(req);

      if (isSummary) {
        // SUMMARY REPORT - existing code unchanged
        const columns = [
          { header: 'S/N', key: 'sn', width: 8, align: 'center' },
          { header: 'PFA Code', key: 'pfa_code', width: 15 },
          { header: 'PFA Name', key: 'pfa_name', width: 35 },
          { header: 'Record', key: 'employee_count', width: 18, align: 'center' },
          { header: 'Total Net Pay', key: 'total_net_pay', width: 20, align: 'right', numFmt: '₦#,##0.00' },
          { header: 'Average Net Pay', key: 'avg_net_pay', width: 20, align: 'right', numFmt: '₦#,##0.00' },
          { header: 'Min Net Pay', key: 'min_net_pay', width: 18, align: 'right', numFmt: '₦#,##0.00' },
          { header: 'Max Net Pay', key: 'max_net_pay', width: 18, align: 'right', numFmt: '₦#,##0.00' }
        ];

        const dataWithSN = data.map((item, idx) => ({ ...item, sn: idx + 1 }));
        const totalEmployees = data.reduce((sum, item) => sum + parseInt(item.employee_count || 0), 0);
        const totalNetPay = data.reduce((sum, item) => sum + parseFloat(item.total_net_pay || 0), 0);

        let subtitle = 'NSITF Summary Report';
        if (data.length > 0) {
          subtitle += ` - ${this.getMonthName(data[0].month)} ${data[0].year}`;
        }

        const workbook = await exporter.createWorkbook({
          title: 'NIGERIAN NAVY - NSITF REPORT',
          subtitle: subtitle,
          className: className,
          columns: columns,
          data: dataWithSN,
          totals: {
            label: 'GRAND TOTALS:',
            values: {
              4: totalEmployees,
              5: totalNetPay
            }
          },
          sheetName: 'NSITF Summary'
        });

        await exporter.exportToResponse(workbook, res, 'nsitf_report_summary.xlsx');

      } else {
        // DETAILED REPORT - Group by PFA Code
        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'Payroll System';
        workbook.created = new Date();

        const sheetNameTracker = {};
        const periodStr = `${this.getMonthName(period.month)} ${period.year}`;

        const columns = [
          { header: 'S/N', key: 'sn', width: 8, align: 'center' },
          { header: 'Svc No.', key: 'employee_id', width: 15 },
          { header: 'Rank', key: 'Title', width: 12 },
          { header: 'Full Name', key: 'full_name', width: 35 },
          { header: 'Date Employed', key: 'date_employed', width: 15 },
          { header: 'NSITF Code', key: 'nsitf_code', width: 15 },
          { header: 'Grade Type', key: 'grade_type', width: 12 },
          { header: 'Grade Level', key: 'grade_level', width: 12 },
          { header: 'Years in Level', key: 'years_in_level', width: 15, align: 'center' }
        ];

        // Group data by PFA Code
        const pfaGroups = {};
        data.forEach(row => {
          const pfaKey = `${row.pfa_code || 'Unknown'}_${row.pfa_name || 'Unknown'}`;
          if (!pfaGroups[pfaKey]) {
            pfaGroups[pfaKey] = {
              pfa_code: row.pfa_code || 'Unknown',
              pfa_name: row.pfa_name || 'Unknown',
              employees: []
            };
          }
          pfaGroups[pfaKey].employees.push(row);
        });

        let globalSN = 1;

        // Create a sheet for each PFA
        Object.values(pfaGroups).forEach(pfaGroup => {
          const sheetName = this._getUniqueSheetName(`${pfaGroup.pfa_code}-${pfaGroup.pfa_name}`, sheetNameTracker);
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
          worksheet.getCell(row, 1).value = 'NIGERIAN NAVY - NSITF REPORT';
          worksheet.getCell(row, 1).font = { size: 12, bold: true };
          worksheet.getCell(row, 1).alignment = { horizontal: 'center', vertical: 'middle' };
          row++;

          // Class and Period
          worksheet.mergeCells(row, 1, row, columns.length);
          worksheet.getCell(row, 1).value = `Class: ${className} | Period: ${periodStr}`;
          worksheet.getCell(row, 1).font = { size: 10, italic: true };
          worksheet.getCell(row, 1).alignment = { horizontal: 'center', vertical: 'middle' };
          row++;

          // PFA Header
          worksheet.mergeCells(row, 1, row, columns.length);
          const groupHeader = worksheet.getCell(row, 1);
          groupHeader.value = `PFA Code: ${pfaGroup.pfa_code} | PFA Name: ${pfaGroup.pfa_name} | Employees: ${pfaGroup.employees.length}`;
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
          pfaGroup.employees.forEach((emp, empIdx) => {
            const dataRow = worksheet.getRow(row);
            
            dataRow.getCell(1).value = globalSN++;
            dataRow.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
            dataRow.getCell(2).value = emp.employee_id;
            dataRow.getCell(3).value = emp.Title;
            dataRow.getCell(4).value = emp.full_name;
            dataRow.getCell(5).value = emp.date_employed;
            dataRow.getCell(6).value = emp.nsitf_code;
            dataRow.getCell(7).value = emp.grade_type;
            dataRow.getCell(8).value = emp.grade_level;
            dataRow.getCell(9).value = emp.years_in_level;
            dataRow.getCell(9).alignment = { horizontal: 'center', vertical: 'middle' };

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

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=nsitf_report_detailed.xlsx');
        await workbook.xlsx.write(res);
        res.end();
      }

    } catch (error) {
      console.error('NSITF Report Export error:', error);
      if (!res.headersSent) {
        res.status(500).json({ success: false, error: error.message });
      }
    }
  }

  // ==========================================================================
  // PDF GENERATION
  // ==========================================================================
  async generateNSITFReportPDF(data, req, res) {
    if (!this.jsreportReady) {
      return res.status(500).json({
        success: false,
        error: "PDF generation service not ready."
      });
    }

    try {
      if (!data || data.length === 0) {
        throw new Error('No data available for the selected filters');
      }

      const isSummary = data.length > 0 && !data[0].hasOwnProperty('employee_id');
      
      console.log('NSITF Report PDF - Is Summary:', isSummary);
      console.log('NSITF Report PDF - Data rows:', data.length);

      // Calculate totals
      const summary = this.calculateSummary(data, isSummary);

      const templatePath = path.join(__dirname, '../../templates/nsitf-report.html');
      const templateContent = fs.readFileSync(templatePath, 'utf8');

      //Load image
      const image = await companySettings.getSettingsFromFile('./public/photos/logo.png');

      const result = await jsreport.render({
        template: {
          content: templateContent,
          engine: 'handlebars',
          recipe: 'chrome-pdf',
          chrome: {
            displayHeaderFooter: false,
            printBackground: true,
            format: 'A4',
            landscape: true,
            marginTop: '2mm',
            marginBottom: '2mm',
            marginLeft: '2mm',
            marginRight: '2mm'
          },
          helpers: this._getCommonHelpers()
        },
        data: {
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
      });

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 
        `attachment; filename=nsitf_report_${data[0]?.month || 'report'}_${data[0]?.year || 'report'}.pdf`
      );
      res.send(result.content);

    } catch (error) {
      console.error('NSITF Report PDF generation error:', error);
      return res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  }

  // ==========================================================================
  // GET FILTER OPTIONS
  // ==========================================================================
  async getNSITFFilterOptions(req, res) {
    try {
      const pfas = await nsitfReportService.getAvailablePFAs();
      const currentPeriod = await nsitfReportService.getCurrentPeriod();

      res.json({
        success: true,
        data: {
          pfas,
          currentPeriod
        }
      });
    } catch (error) {
      console.error('Error getting NSITF filter options:', error);
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

module.exports = new NSITFReportController();


