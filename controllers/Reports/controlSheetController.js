const BaseReportController = require('../Reports/reportsFallbackController');
const controlSheetService = require('../../services/Reports/controlSheetService');
const companySettings = require('../helpers/companySettings');
const { GenericExcelExporter } = require('../helpers/excel');
//const ExcelJS = require('exceljs');
//const jsreport = require('jsreport-core')();
const fs = require('fs');
const path = require('path');

class ControlSheetController extends BaseReportController {

  constructor() {
    super(); // Initialize base class
  }


  // ==========================================================================
  // CONTROL SHEET REPORT - MAIN ENDPOINT
  // ==========================================================================
  async generateControlSheet(req, res) {
    try {
      const { format, payroll_class, ...otherFilters } = req.query;
      
      // Map frontend parameter names to backend expected names
      const filters = {
        ...otherFilters,
        payrollClass: payroll_class
      };
      
      console.log('Control Sheet Filters:', filters); // DEBUG
      
      const result = await controlSheetService.getControlSheet(filters);
      
      console.log('Control Sheet Data rows:', result.details.length); // DEBUG
      console.log('Control Sheet Totals:', result.totals); // DEBUG

      if (format === 'excel') {
        return this.generateControlSheetExcel(result, req, res);
      } else if (format === 'pdf') {
        return this.generateControlSheetPDF(result, req, res);
      }

      res.json({ 
        success: true, 
        data: result.details,
        totals: result.totals
      });
    } catch (error) {
      console.error('Error generating control sheet:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  // ==========================================================================
  // EXCEL GENERATION
  // ==========================================================================
  async generateControlSheetExcel(result, req, res) {
    try {
      if (!result.details || result.details.length === 0) {
        throw new Error('No data available for the selected filters');
      }
      
      const exporter = new GenericExcelExporter();
      const data = result.details;
      const className = this.getDatabaseNameFromRequest(req);

      const columns = [
        { header: 'S/N', key: 'sn', width: 8, align: 'center' },
        { header: 'Payment Type', key: 'payment_type', width: 15 },
        { header: 'Payment Description', key: 'payment_description', width: 35 },
        { header: 'DR', key: 'dr_amount', width: 18, align: 'right', numFmt: '₦#,##0.00' },
        { header: 'CR', key: 'cr_amount', width: 18, align: 'right', numFmt: '₦#,##0.00' },
        { header: 'Ledger Codes', key: 'ledger_code', width: 20 }
      ];

      // Add S/N and handle missing ledger codes
      const dataWithSN = data.map((item, idx) => ({
        ...item,
        sn: idx + 1,
        ledger_code: item.ledger_code && item.ledger_code.trim() !== '' 
          ? item.ledger_code 
          : 'No LegCode'
      }));

      // Build subtitle with period info
      let subtitle = 'Payroll Control Sheet';
      if (data.length > 0) {
        subtitle += ` - ${data[0].month_name}, ${data[0].year} | Records: ${data[0].recordcount}`;
      }

      const workbook = await exporter.createWorkbook({
        title: 'DIA PAYROLL - PAYROLL CONTROL SHEET',
        subtitle: subtitle,
        columns: columns,
        className: className,
        data: dataWithSN,
        totals: {
          label: 'GRAND TOTALS:',
          values: {
            4: result.totals.dr_total,
            5: result.totals.cr_total
          }
        },
        sheetName: 'Control Sheet'
      });

      // Add balance status note after totals
      const worksheet = workbook.worksheets[0];
      const lastRow = worksheet.lastRow.number + 1;
      
      worksheet.mergeCells(`A${lastRow}:F${lastRow}`);
      const statusCell = worksheet.getCell(`A${lastRow}`);
      statusCell.value = result.totals.balanced 
        ? '✓ CONTROL SHEET BALANCED' 
        : '✗ WARNING: CONTROL SHEET NOT BALANCED';
      statusCell.font = { 
        bold: true, 
        size: 12,
        color: { argb: result.totals.balanced ? 'FF006100' : 'FFFF0000' }
      };
      statusCell.alignment = { horizontal: 'center', vertical: 'middle' };
      worksheet.getRow(lastRow).height = 25;

      await exporter.exportToResponse(workbook, res, 'control_sheet.xlsx');

    } catch (error) {
      console.error('Control Sheet Export error:', error);
      if (!res.headersSent) {
        res.status(500).json({ success: false, error: error.message });
      }
    }
  }

  // ==========================================================================
  // PDF GENERATION
  // ==========================================================================
  async generateControlSheetPDF(result, req, res) {

    try {
      if (!result.details || result.details.length === 0) {
        throw new Error('No data available for the selected filters');
      }

      const data = result.details;

      console.log('Control Sheet PDF - Data rows:', data.length);
      console.log('Control Sheet PDF - Balanced:', result.totals.balanced);

      //Load image
      const image = await companySettings.getSettingsFromFile('./public/photos/logo.png');

      const templatePath = path.join(__dirname, '../../templates/control-sheet.html');
      const templateContent = fs.readFileSync(templatePath, 'utf8');

      const pdfBuffer = await this.generatePDFWithFallback(
        templatePath,
        {
          data: data,
          totals: result.totals,
          reportDate: new Date(),
          period: data.length > 0 ? 
            `${data[0].month_name}, ${data[0].year}` : 
            'N/A',
          className: this.getDatabaseNameFromRequest(req),
          ...image,
          recordcount: data.length > 0 ? data[0].recordcount : 0
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
        `attachment; filename=control_sheet_${data[0]?.month || 'report'}_${data[0]?.year || 'report'}.pdf`
      );
      res.send(pdfBuffer);

    } catch (error) {
      console.error('Control Sheet PDF generation error:', error);
      return res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  }

  // ==========================================================================
  // GET FILTER OPTIONS
  // ==========================================================================
  async getControlSheetFilterOptions(req, res) {
    try {
      const currentPeriod = await controlSheetService.getCurrentPeriod();

      res.json({
        success: true,
        data: {
          currentPeriod
        }
      });
    } catch (error) {
      console.error('Error getting control sheet filter options:', error);
      res.status(500).json({ success: false, error: error.message });
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

module.exports = new ControlSheetController();
