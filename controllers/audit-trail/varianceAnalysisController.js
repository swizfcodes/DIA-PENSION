const varianceAnalysisService = require('../../services/audit-trail/varianceAnalysisService');
const BaseReportController = require('../Reports/reportsFallbackController');
const { GenericExcelExporter } = require('../helpers/excel');
const companySettings = require('../helpers/companySettings');
const ExcelJS = require('exceljs');
//const jsreport = require('jsreport-core')();
const fs = require('fs');
const path = require('path');

class VarianceAnalysisController extends BaseReportController {

  constructor() {
    super(); // Initialize base class
  }

  // ==========================================================================
  // SALARY VARIANCE ANALYSIS - MAIN ENDPOINT
  // ==========================================================================
  async generateSalaryVarianceReport(req, res) {
    try {
      const { format, period, payTypes } = req.query;
      
      const filters = { period, payTypes };
      
      console.log('Salary Variance Report Filters:', filters);
      
      const result = await varianceAnalysisService.getSalaryVarianceAnalysis(filters);
      
      if (!result.success) {
        return res.status(400).json(result);
      }
      
      console.log('Salary Variance Report Data rows:', result.data.length);

      if (format === 'excel') {
        return this.generateSalaryVarianceExcel(result, req, res);
      } else if (format === 'pdf') {
        return this.generateSalaryVariancePDF(result, req, res);
      }

      res.json(result);
    } catch (error) {
      console.error('Error generating Salary Variance report:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  // ==========================================================================
  // OVERPAYMENT ANALYSIS - MAIN ENDPOINT
  // ==========================================================================
  async generateOverpaymentReport(req, res) {
    try {
      const { format, period } = req.query;
      
      console.log('📥 Request query params:', { format, period });
      
      // Convert period to month number
      const month = parseInt(period);
      
      console.log('📊 Converted month:', month);
      
      const filters = { month };
      
      console.log('Overpayment Report Filters:', filters);
      
      const result = await varianceAnalysisService.getOverpaymentAnalysis(filters);
      
      console.log('📊 Service returned:', {
        success: result.success,
        message: result.message,
        dataLength: result.data?.length,
        month: result.month,
        monthName: result.monthName
      });
      
      if (!result.success) {
        return res.status(400).json(result);
      }
      
      console.log('Overpayment Report Data rows:', result.data.length);

      if (format === 'excel') {
        return this.generateOverpaymentExcel(result, req, res);
      } else if (format === 'pdf') {
        console.log('🔄 Starting PDF generation...');
        return this.generateOverpaymentPDF(result, req, res);
      }

      res.json(result);
    } catch (error) {
      console.error('❌ Error generating Overpayment report:', error);
      console.error('Error stack:', error.stack);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  // ==========================================================================
  // SALARY VARIANCE - EXCEL GENERATION
  // ==========================================================================
  async generateSalaryVarianceExcel(result, req, res) {
    try {
      if (!result.data || result.data.length === 0) {
        throw new Error('No data available for the selected filters');
      }
      
      const exporter = new GenericExcelExporter();
      const data = result.data;
      const className = this.getDatabaseNameFromRequest(req);
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'Payroll System';
      workbook.created = new Date();

      const sheetNameTracker = {};
      const subtitle = `${varianceAnalysisService.formatPeriod(result.period)} | ${result.comparisonInfo}`;

      const columns = [
        { header: 'S/N', key: 'sn', width: 8, align: 'center' },
        { header: 'Svc No.', key: 'employee_id', width: 15 },
        { header: 'Rank', key: 'Title', width: 10 },
        { header: 'Full Name', key: 'full_name', width: 30 },
        { header: 'Old Amount', key: 'old_amount', width: 16, align: 'right', numFmt: '₦#,##0.00' },
        { header: 'New Amount', key: 'new_amount', width: 16, align: 'right', numFmt: '₦#,##0.00' },
        { header: 'Variance', key: 'variance', width: 16, align: 'right', numFmt: '₦#,##0.00' }
      ];

      // Group data by pay_type and description
      const varianceGroups = {};
      data.forEach(row => {
        const groupKey = `${row.pay_type}_${row.pay_type_description}`;
        if (!varianceGroups[groupKey]) {
          varianceGroups[groupKey] = {
            pay_type: row.pay_type,
            pay_type_description: row.pay_type_description,
            variances: []
          };
        }
        varianceGroups[groupKey].variances.push(row);
      });

      let globalSN = 1;

      // Create a sheet for each pay type
      Object.values(varianceGroups).forEach(group => {
        const sheetName = this._getUniqueSheetName(`${group.pay_type}-${group.pay_type_description}`, sheetNameTracker);
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
        worksheet.getCell(row, 1).value = 'SALARY VARIANCE ANALYSIS';
        worksheet.getCell(row, 1).font = { size: 12, bold: true };
        worksheet.getCell(row, 1).alignment = { horizontal: 'center', vertical: 'middle' };
        row++;

        // Subtitle
        worksheet.mergeCells(row, 1, row, columns.length);
        worksheet.getCell(row, 1).value = `${subtitle} | Class: ${className}`;
        worksheet.getCell(row, 1).font = { size: 10, italic: true };
        worksheet.getCell(row, 1).alignment = { horizontal: 'center', vertical: 'middle' };
        row++;

        // Pay Type Header
        worksheet.mergeCells(row, 1, row, columns.length);
        const groupHeader = worksheet.getCell(row, 1);
        groupHeader.value = `Pay Type: ${group.pay_type} | Description: ${group.pay_type_description} | Employees: ${group.variances.length}`;
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

        // Variance data rows
        group.variances.forEach((variance, varIdx) => {
          const dataRow = worksheet.getRow(row);
          
          dataRow.getCell(1).value = globalSN++;
          dataRow.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
          dataRow.getCell(2).value = variance.employee_id;
          dataRow.getCell(3).value = variance.Title;
          dataRow.getCell(4).value = variance.full_name;
          dataRow.getCell(5).value = parseFloat(variance.old_amount || 0);
          dataRow.getCell(5).numFmt = '₦#,##0.00';
          dataRow.getCell(5).alignment = { horizontal: 'right', vertical: 'middle' };
          dataRow.getCell(6).value = parseFloat(variance.new_amount || 0);
          dataRow.getCell(6).numFmt = '₦#,##0.00';
          dataRow.getCell(6).alignment = { horizontal: 'right', vertical: 'middle' };
          dataRow.getCell(7).value = parseFloat(variance.variance || 0);
          dataRow.getCell(7).numFmt = '₦#,##0.00';
          dataRow.getCell(7).alignment = { horizontal: 'right', vertical: 'middle' };

          // Highlight negative variances in red
          if (parseFloat(variance.variance || 0) < 0) {
            dataRow.getCell(7).font = { color: { argb: 'FFFF0000' }, bold: true };
          }

          // Borders and alternating colors
          for (let i = 1; i <= columns.length; i++) {
            const cell = dataRow.getCell(i);
            cell.border = {
              top: { style: 'thin', color: { argb: 'E5E7EB' } },
              bottom: { style: 'thin', color: { argb: 'E5E7EB' } }
            };
            
            if (varIdx % 2 === 0) {
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
      res.setHeader('Content-Disposition', `attachment; filename=salary_variance_${result.period}.xlsx`);
      await workbook.xlsx.write(res);
      res.end();

    } catch (error) {
      console.error('Salary Variance Export error:', error);
      if (!res.headersSent) {
        res.status(500).json({ success: false, error: error.message });
      }
    }
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
  // OVERPAYMENT - EXCEL GENERATION
  // ==========================================================================
  async generateOverpaymentExcel(result, req, res) {
    try {
      if (!result.data || result.data.length === 0) {
        throw new Error('No overpayments exceeding 0.5% threshold found for the selected month.');
      }

      const exporter = new GenericExcelExporter();
      const data = result.data;

      const className = this.getDatabaseNameFromRequest(req);

      const columns = [
        { header: 'S/N', key: 'sn', width: 8, align: 'center' },
        { header: 'Svc No.', key: 'employee_id', width: 15 },
        { header: 'Rank', key: 'Title', width: 10 },
        { header: 'Full Name', key: 'full_name', width: 30 },
        //{ header: 'Pay Element', key: 'pay_element_description', width: 25 },
        { header: 'Previous Net', key: 'previous_net', width: 16, align: 'right', numFmt: '₦#,##0.00' },
        { header: 'Current Net', key: 'current_net', width: 16, align: 'right', numFmt: '₦#,##0.00' },
        { header: 'Variance Amount', key: 'variance_amount', width: 16, align: 'right', numFmt: '₦#,##0.00' },
        { header: 'Variance %', key: 'variance_percentage', width: 12, align: 'right', numFmt: '0.00"%"' }
      ];

      // Add S/N
      const dataWithSN = data.map((item, idx) => ({
        ...item,
        sn: idx + 1
      }));

      const subtitle = `Period: ${varianceAnalysisService.formatPeriod(result.monthName)} | Threshold: ${result.threshold_percentage}% | Pay Element: ${result.pay_element}`;

      const workbook = await exporter.createWorkbook({
        title: 'DIA PAYROLL - OVERPAYMENT ANALYSIS',
        subtitle: subtitle,
        className: className,
        columns: columns,
        data: dataWithSN,
        sheetName: 'Overpayment Analysis'
      });

      // Apply conditional formatting for high variance percentages
      const worksheet = workbook.worksheets[0];
      const dataStartRow = 5;
      
      // Change header color to red for overpayment alert
      const headerRow = worksheet.getRow(4);
      headerRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFDC143C' } // Red
      };

      // Highlight high variance rows
      dataWithSN.forEach((row, index) => {
        const rowNum = dataStartRow + index;
        const variancePercentCell = worksheet.getCell(`I${rowNum}`);
        
        if (parseFloat(row.variance_percentage) > result.threshold_percentage * 2) {
          variancePercentCell.font = { color: { argb: 'FFFF0000' }, bold: true };
        }

        // Light red background for all data rows
        if (index % 2 === 0) {
          worksheet.getRow(rowNum).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFFFF0F0' }
          };
        }
      });

      // Auto-shrink: Set print scaling to 70% for better fit (9 columns is very wide)
      worksheet.pageSetup = {
        ...worksheet.pageSetup,
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        scale: 70, // Shrink to 70% for 9+ column tables
        orientation: 'landscape',
        paperSize: 9 // A4
      };

      await exporter.exportToResponse(workbook, res, `overpayment_analysis_${result.period}.xlsx`);

    } catch (error) {
      console.error('Overpayment Export error:', error);
      if (!res.headersSent) {
        res.status(500).json({ success: false, error: error.message });
      }
    }
  }

  // ==========================================================================
  // SALARY VARIANCE - PDF GENERATION
  // ==========================================================================
  async generateSalaryVariancePDF(result, req, res) {
    try {
      if (!result.data || result.data.length === 0) {
        throw new Error('No data available for the selected filters');
      }

      const templatePath = path.join(__dirname, '../../templates/salary-variance.html');
      const templateContent = fs.readFileSync(templatePath, 'utf8');

      //Load image
      const image = await companySettings.getSettingsFromFile('./public/photos/logo.png');    

      const pdfBuffer = await this.generatePDFWithFallback(
        templatePath,
        {
          data: result.data,
          reportDate: new Date(),
          period: varianceAnalysisService.formatPeriod(result.period),
          comparisonInfo: result.comparisonInfo,
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
      res.setHeader('Content-Disposition', `attachment; filename=salary_variance_${result.period}.pdf`);
      res.send(pdfBuffer);

    } catch (error) {
      console.error('Salary Variance PDF generation error:', error);
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  // ==========================================================================
  // OVERPAYMENT - PDF GENERATION
  // ==========================================================================
  async generateOverpaymentPDF(result, req, res) {
    try {
      if (!result.data || result.data.length === 0) {
        throw new Error('No overpayments exceeding 0.5% threshold found for the selected period.');
      }

      const templatePath = path.join(__dirname, '../../templates/overpayment-analysis.html');
      const templateContent = fs.readFileSync(templatePath, 'utf8');

      //Load image
      const image = await companySettings.getSettingsFromFile('./public/photos/logo.png');    

      const pdfBuffer = await this.generatePDFWithFallback(
        templatePath,
        {
          data: result.data,
          reportDate: new Date(),
          period: result.monthName,
          threshold: result.threshold_percentage,
          payElement: result.pay_element,
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
      res.setHeader('Content-Disposition', `attachment; filename=overpayment_analysis_${result.period}.pdf`);
      res.send(pdfBuffer);

    } catch (error) {
      console.error('Overpayment PDF generation error:', error);
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  // ==========================================================================
  // GET FILTER OPTIONS
  // ==========================================================================
  async getFilterOptions(req, res) {
    try {
      const [currentPeriod, payTypes, periods] = await Promise.all([
        varianceAnalysisService.getCurrentPeriod(),
        varianceAnalysisService.getAvailablePayTypes(),
        varianceAnalysisService.getAvailablePeriods()
      ]);

      res.json({
        success: true,
        data: {
          periods: periods.data,
          payTypes: payTypes,
          currentPeriod: currentPeriod
        }
      });
    } catch (error) {
      console.error('Error getting filter options:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  // ==========================================================================
  // HELPER FUNCTION
  // ==========================================================================
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

module.exports = new VarianceAnalysisController();


