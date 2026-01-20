const ExcelJS = require('exceljs');

// ============================================
// CONFIGURATION
// ============================================
const EXCEL_CONFIG = {
  company: {
    name: 'DEFENCE INTELLIGENCE AGENCY',
    address: 'ASOKORO - ABUJA - DEFENCE INTELIGENCE AGENCY'
  },
  colors: {
    primary: '1e40af',        // Blue for headers
    secondary: '2E75B6',
    headerBg: 'f9fafb',       // Light gray for header background
    altRow: 'F9FAFB',         // Alternate row color
    totalBg: 'E5E7EB'         // Total row background
  },
  fonts: {
    title: { size: 14, bold: true },
    subtitle: { size: 11, bold: false },
    header: { size: 10, bold: true },
    body: { size: 9 }
  }
};

// ============================================
// GENERIC EXCEL EXPORT CLASS
// ============================================
class GenericExcelExporter {
  constructor(config = {}) {
    this.config = { ...EXCEL_CONFIG, ...config };
  }

  /**
   * Create a new Excel workbook with data
   * @param {Object} options - Export configuration
   * @param {string} options.title - Report title
   * @param {string} options.subtitle - Report subtitle (optional)
   * @param {Object} options.period - Period info { year, month }
   * @param {Array} options.columns - Column definitions
   * @param {Array} options.data - Data rows
   * @param {Object} options.totals - Totals configuration (optional)
   * @param {Object} options.summary - Summary data (optional)
   * @param {string} options.sheetName - Worksheet name
   * @returns {ExcelJS.Workbook}
   */
  async createWorkbook(options) {
    const {
      title,
      subtitle,
      period,
      className,
      columns,
      data,
      totals,
      summary,
      sheetName = 'Report'
    } = options;

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Payroll System';
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet(sheetName, {
      pageSetup: { 
        paperSize: 9, 
        orientation: 'landscape',
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0
      },
      views: [{ state: 'frozen', ySplit: 0 }] // Will be updated after header
    });

    // Set column widths
    columns.forEach((col, idx) => {
      worksheet.getColumn(idx + 1).width = col.width || 15;
    });

    let currentRow = 1;

    // Add header section
    currentRow = this.addHeaderSection(worksheet, title, subtitle, period, className, columns.length);

    // Add column headers with freeze
    const headerRow = currentRow;
    this.addColumnHeaders(worksheet, columns, headerRow);

    // Freeze panes at header row
    worksheet.views = [{ 
      state: 'frozen', 
      ySplit: headerRow, 
      topLeftCell: `A${headerRow + 1}`,
      activeCell: `A${headerRow + 1}`
    }];

    currentRow++;

    // Add data rows
    currentRow = this.addDataRows(worksheet, data, columns, currentRow);

    // Add totals if provided
    if (totals) {
      currentRow = this.addTotalsRow(worksheet, totals, columns, currentRow);
      currentRow++;
    }

    // Add summary section if provided
    if (summary) {
      currentRow++;
      this.addSummarySection(worksheet, summary, currentRow);
    }

    return workbook;
  }

  /**
   * Add header section (company name, title, period)
   */
  addHeaderSection(worksheet, title, subtitle, period, className, columnCount) {
    let row = 1;

    // Company name
    worksheet.mergeCells(row, 1, row, columnCount);
    const companyCell = worksheet.getCell(row, 1);
    companyCell.value = this.config.company.name;
    companyCell.font = { size: 14, bold: true, color: { argb: this.config.colors.primary } };
    companyCell.alignment = { horizontal: 'center', vertical: 'middle' };
    row++;

    // Report title
    worksheet.mergeCells(row, 1, row, columnCount);
    const titleCell = worksheet.getCell(row, 1);
    titleCell.value = title;
    titleCell.font = { size: 12, bold: true };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    row++;

    // Subtitle (if provided)
    if (subtitle) {
      worksheet.mergeCells(row, 1, row, columnCount);
      const subtitleCell = worksheet.getCell(row, 1);
      subtitleCell.value = subtitle;
      subtitleCell.font = { size: 10, italic: true, color: { argb: '4a4a4a' } };
      subtitleCell.alignment = { horizontal: 'center', vertical: 'middle' };
      row++;
    }

    // Period information
    if (period) {
      worksheet.mergeCells(row, 1, row, columnCount);
      const periodCell = worksheet.getCell(row, 1);
      periodCell.value = `Period: ${this.getMonthName(period.month)} ${period.year}`;
      periodCell.font = { size: 10, italic: true };
      periodCell.alignment = { horizontal: 'center', vertical: 'middle' };
      row++;
    }

    if(className) {
      // Class/Database information
      worksheet.mergeCells(row, 1, row, columnCount);
      const classCell = worksheet.getCell(row, 1);
      classCell.value = `Class: ${className}`;
      classCell.font = { size: 10, italic: true };
      classCell.alignment = { horizontal: 'center', vertical: 'middle' };
      row++;
    }

    // Empty row for spacing
    row++;

    return row;
  }

  /**
   * Add column headers
   */
  addColumnHeaders(worksheet, columns, row) {
    const headerRow = worksheet.getRow(row);
    
    columns.forEach((col, idx) => {
      const cell = headerRow.getCell(idx + 1);
      cell.value = col.header;
      cell.fill = { 
        type: 'pattern', 
        pattern: 'solid', 
        fgColor: { argb: this.config.colors.headerBg } 
      };
      cell.font = { 
        bold: true, 
        color: { argb: this.config.colors.primary }, 
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
  }

  /**
   * Add data rows with optional alternating colors
   */
  addDataRows(worksheet, data, columns, startRow) {
    data.forEach((item, idx) => {
      const row = worksheet.getRow(startRow + idx);
      
      columns.forEach((col, colIdx) => {
        const cell = row.getCell(colIdx + 1);
        
        // Get value with optional transformation
        let value = item[col.key];
        if (col.transform) {
          value = col.transform(value, item);
        }
        
        cell.value = value;
        cell.alignment = { 
          horizontal: col.align || 'left', 
          vertical: 'middle' 
        };
        
        // Apply number format if specified
        if (col.numFmt) {
          cell.numFmt = col.numFmt;
        }
        
        // Borders
        cell.border = {
          top: { style: 'thin', color: { argb: 'E5E7EB' } },
          bottom: { style: 'thin', color: { argb: 'E5E7EB' } }
        };
        
        // Alternate row colors
        if (idx % 2 === 0) {
          cell.fill = { 
            type: 'pattern', 
            pattern: 'solid', 
            fgColor: { argb: this.config.colors.altRow } 
          };
        }
      });
      
      row.height = 18;
    });

    return startRow + data.length;
  }

  /**
   * Add totals row
   */
  addTotalsRow(worksheet, totals, columns, row) {
    const totalRow = worksheet.getRow(row);
    
    // First column label
    totalRow.getCell(1).value = totals.label || 'TOTALS:';
    totalRow.getCell(1).font = { bold: true, color: { argb: this.config.colors.primary } };
    
    // Add total values for specified columns
    Object.entries(totals.values || {}).forEach(([colIdx, value]) => {
      const cell = totalRow.getCell(parseInt(colIdx));
      cell.value = value;
      cell.font = { bold: true };
      
      // Find the column to get number format
      const colIndex = parseInt(colIdx) - 1;
      if (columns[colIndex] && columns[colIndex].numFmt) {
        cell.numFmt = columns[colIndex].numFmt;
      } else {
        cell.numFmt = '#,##0.00';
      }
    });

    // Style all cells in totals row
    for (let i = 1; i <= columns.length; i++) {
      const cell = totalRow.getCell(i);
      cell.fill = { 
        type: 'pattern', 
        pattern: 'solid', 
        fgColor: { argb: this.config.colors.totalBg } 
      };
      cell.border = { 
        top: { style: 'medium', color: { argb: this.config.colors.primary } }, 
        bottom: { style: 'medium', color: { argb: this.config.colors.primary } } 
      };
      if (!cell.font) {
        cell.font = { bold: true };
      }
    }

    totalRow.height = 22;
    return row + 1;
  }

  /**
   * Add optional summary section
   */
  addSummarySection(worksheet, summary, startRow) {
    let row = startRow;

    // Summary title
    const titleCell = worksheet.getCell(row, 1);
    titleCell.value = summary.title || 'SUMMARY';
    titleCell.font = { bold: true, size: 11, color: { argb: this.config.colors.primary } };
    row++;

    // Summary items
    if (summary.items) {
      summary.items.forEach(item => {
        const labelCell = worksheet.getCell(row, 1);
        labelCell.value = item.label;
        labelCell.font = { bold: true };
        
        const valueCell = worksheet.getCell(row, 2);
        valueCell.value = item.value;
        valueCell.alignment = { horizontal: 'right' };
        
        if (item.numFmt) {
          valueCell.numFmt = item.numFmt;
        }
        
        row++;
      });
    }

    return row;
  }

  /**
   * Helper: Get month name from number
   */
  getMonthName(month) {
    const months = ['', 'January', 'February', 'March', 'April', 'May', 'June',
                    'July', 'August', 'September', 'October', 'November', 'December'];
    return months[month] || month;
  }

  /**
   * Helper: Format money
   */
  formatMoney(amount) {
    const num = parseFloat(amount);
    const parts = num.toFixed(2).split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return '₦' + parts.join('.');
  }

  /**
   * Export workbook to response
   */
  async exportToResponse(workbook, res, filename) {
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
    await workbook.xlsx.write(res);
    res.end();
  }

    /**
   * Create workbook with grouped data (each group gets its own sheet with frozen headers)
   * @param {Object} options - Export configuration
   * @param {string} options.title - Report title
   * @param {string} options.subtitle - Report subtitle (optional)
   * @param {Object} options.period - Period info { year, month }
   * @param {string} options.groupBy - Field to group by
   * @param {Array} options.columns - Column definitions
   * @param {Array} options.data - Data rows
   * @param {Function} options.groupHeaderFormatter - Function to format group header (receives group info)
   * @param {string} options.summarySheetName - Name for summary sheet (optional)
   * @returns {ExcelJS.Workbook}
   */
  async createGroupedWorkbook(options) {
    const {
      title,
      subtitle,
      period,
      className,
      groupBy,
      columns,
      data,
      groupHeaderFormatter,
      summarySheetName = 'Summary'
    } = options;

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Payroll System';
    workbook.created = new Date();

    // Group the data
    const groups = {};
    data.forEach(row => {
      const groupKey = typeof groupBy === 'function' ? groupBy(row) : row[groupBy];
      if (!groups[groupKey]) {
        groups[groupKey] = [];
      }
      groups[groupKey].push(row);
    });

    const sheetNameTracker = {};
    
    // Create a sheet for each group
    Object.entries(groups).forEach(([groupKey, groupData], groupIdx) => {
      const sheetName = this._getUniqueSheetName(groupKey, sheetNameTracker);
      const worksheet = workbook.addWorksheet(sheetName);

      // Set column widths
      columns.forEach((col, idx) => {
        worksheet.getColumn(idx + 1).width = col.width || 15;
      });

      let row = 1;

      // Company name
      worksheet.mergeCells(row, 1, row, columns.length);
      const companyCell = worksheet.getCell(row, 1);
      companyCell.value = this.config.company.name;
      companyCell.font = { size: 14, bold: true, color: { argb: this.config.colors.primary } };
      companyCell.alignment = { horizontal: 'center', vertical: 'middle' };
      row++;

      // Report title
      worksheet.mergeCells(row, 1, row, columns.length);
      const titleCell = worksheet.getCell(row, 1);
      titleCell.value = title;
      titleCell.font = { size: 12, bold: true };
      titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
      row++;

      // Subtitle
      if (subtitle) {
        worksheet.mergeCells(row, 1, row, columns.length);
        const subtitleCell = worksheet.getCell(row, 1);
        subtitleCell.value = subtitle;
        subtitleCell.font = { size: 10, italic: true };
        subtitleCell.alignment = { horizontal: 'center', vertical: 'middle' };
        row++;
      }

      // Group header (custom formatted)
      if (groupHeaderFormatter) {
        worksheet.mergeCells(row, 1, row, columns.length);
        const groupHeaderCell = worksheet.getCell(row, 1);
        groupHeaderCell.value = groupHeaderFormatter(groupKey, groupData);
        groupHeaderCell.font = { bold: true, size: 11, color: { argb: this.config.colors.primary } };
        groupHeaderCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'E8E8E8' } };
        groupHeaderCell.alignment = { horizontal: 'left', vertical: 'middle' };
        row++;
      }

      row++; // Empty row

      // Column headers (frozen)
      const headerRowNum = row;
      this.addColumnHeaders(worksheet, columns, headerRowNum);
      row++;

      // Freeze panes at header
      worksheet.views = [{ 
        state: 'frozen', 
        ySplit: headerRowNum,
        topLeftCell: `A${headerRowNum + 1}`,
        activeCell: `A${headerRowNum + 1}`
      }];

      // Add data rows
      this.addDataRows(worksheet, groupData, columns, row);
    });

    return workbook;
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
      const suffix = ` (${counter})`;
      const maxBase = 31 - suffix.length;
      finalName = sanitized.substring(0, maxBase) + suffix;
      counter++;
    }
    
    tracker[finalName] = true;
    return finalName;
  }
}

// ============================================
// USAGE EXAMPLE
// ============================================

/**
 * Example: Export Employee Change History Report
 */
async function exportEmployeeChangeHistory(req, res, data, period) {
  try {
    const exporter = new GenericExcelExporter();

    // Prepare columns
    const columns = [
      { header: 'S/N', key: 'sn', width: 8, align: 'center' },
      { header: 'Employee ID', key: 'employee_id', width: 15 },
      { header: 'Full Name', key: 'full_name', width: 30 },
      { header: 'Title', key: 'title', width: 15 },
      { header: 'Location', key: 'location', width: 20 },
      { header: 'Changes Detected', key: 'total_changes', width: 15, align: 'center' },
      { header: 'History Date', key: 'history_date_formatted', width: 20 }
    ];

    // Add serial numbers
    const dataWithSN = data.map((item, idx) => ({
      ...item,
      sn: idx + 1
    }));

    // Calculate totals
    const totalChanges = data.reduce((sum, item) => sum + item.total_changes, 0);

    // Create workbook
    const workbook = await exporter.createWorkbook({
      title: 'EMPLOYEE CHANGE HISTORY REPORT',
      subtitle: 'Changes in Personnel Details',
      period: period,
      className: className,
      columns: columns,
      data: dataWithSN,
      totals: {
        label: 'TOTALS:',
        values: {
          6: totalChanges  // Column index for total_changes
        }
      },
      summary: {
        title: 'REPORT SUMMARY',
        items: [
          { label: 'Total Employees Processed', value: data.length },
          { label: 'Total Changes Detected', value: totalChanges },
          { label: 'Average Changes per Employee', value: (totalChanges / data.length).toFixed(2) }
        ]
      },
      sheetName: 'Change History'
    });

    // Export to response
    const filename = `employee_change_history_${period.year}_${period.month}.xlsx`;
    await exporter.exportToResponse(workbook, res, filename);

  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * Example: Simple export without totals/summary
 */
async function exportSimpleReport(req, res, data, period) {
  try {
    const exporter = new GenericExcelExporter();

    const columns = [
      { header: 'Emp ID', key: 'employee_id', width: 12 },
      { header: 'Name', key: 'full_name', width: 25 },
      { header: 'Department', key: 'department', width: 20 },
      { header: 'Gross Pay', key: 'gross_pay', width: 15, align: 'right', numFmt: '#,##0.00' },
      { header: 'Net Pay', key: 'net_pay', width: 15, align: 'right', numFmt: '#,##0.00' }
    ];

    const workbook = await exporter.createWorkbook({
      title: 'PAYROLL REPORT',
      period: period,
      className: className,
      columns: columns,
      data: data,
      sheetName: 'Payroll'
    });

    const filename = `payroll_${period.year}_${period.month}.xlsx`;
    await exporter.exportToResponse(workbook, res, filename);

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
}

// ============================================
// EXPORTS
// ============================================
module.exports = {
  GenericExcelExporter,
  exportEmployeeChangeHistory,
  exportSimpleReport
};


