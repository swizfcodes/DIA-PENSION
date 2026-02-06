const pool = require('../../config/db');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

// ============================================
// CONFIGURATION
// ============================================
const CONFIG = {
  company: {
    name: 'DEFENCE INTELLIGENCE AGENCY',
    address: 'ASOKORO - ABUJA - DEFENCE INTELIGENCE AGENCY',
    //phone: '+234 XXX XXX XXXX',
    //email: 'hr@company.com'
  },
  colors: {
    primary: '1F4E79',
    secondary: '2E75B6',
    header: 'D6DCE5',
    altRow: 'F2F2F2'
  }
};

// ============================================
// EXISTING HELPER FUNCTIONS
// ============================================
async function checkCalculationsComplete() {
  const [bt05] = await pool.query("SELECT sun FROM py_stdrate WHERE type='BT05' LIMIT 1");
  if (!bt05.length || bt05[0].sun < 999) {
    throw new Error('Payroll calculations must be completed first');
  }
  return bt05[0];
}

async function getCurrentPeriod() {
  const [period] = await pool.query("SELECT ord as year, mth as month FROM py_stdrate WHERE type='BT05' LIMIT 1");
  return period[0] || {};
}

function getMonthName(month) {
  const months = ['', 'January', 'February', 'March', 'April', 'May', 'June',
                  'July', 'August', 'September', 'October', 'November', 'December'];
  return months[month] || month;
}

function formatMoney(amount) {
  const num = parseFloat(amount);
  const parts = num.toFixed(2).split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return parts.join('.');
}

// ============================================
// UNIFIED EXPORT HANDLER
// ============================================
exports.exportReport = async (req, res) => {
  try {
    await checkCalculationsComplete();
    const { reportType, format } = req.params;
    const period = await getCurrentPeriod();

    if (format === 'excel') {
      return await generateExcelReport(req, res, reportType, period);
    } else if (format === 'pdf') {
      return await generatePDFReport(req, res, reportType, period);
    } else {
      throw new Error('Invalid format. Use "excel" or "pdf"');
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// ============================================
// EXCEL EXPORT
// ============================================
async function generateExcelReport(req, res, reportType, period) {
  try {

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Payroll System';
    workbook.created = new Date();

    switch (reportType) {
      case 'allowances':
        await createAllowancesExcel(workbook, period);
        break;
      case 'controlsheet':
        await createControlSheetExcel(workbook, period);
        break;
      case 'bank':
        await createBankExcel(workbook, period);
        break;
      case 'deductions':
        await createDeductionsExcel(workbook, period);
        break;
      case 'tax':
        await createTaxExcel(workbook, period);
        break;
      case 'department':
        await createDepartmentExcel(workbook, period);
        break;
      case 'grade':
        await createGradeExcel(workbook, period);
        break;
      case 'exceptions':
        await createExceptionsExcel(workbook, period);
        break;
      case 'summary':
        await createSummaryExcel(workbook, period);
        break;
      default:
        throw new Error('Invalid report type');
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=${reportType}_report_${period.year}_${period.month}.xlsx`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// ============================================
// EXCEL HELPER FUNCTIONS
// ============================================
function addExcelHeader(ws, title, period, columnCount) {
  ws.mergeCells(1, 1, 1, columnCount);
  ws.mergeCells(2, 1, 2, columnCount);
  ws.mergeCells(3, 1, 3, columnCount);

  const companyCell = ws.getCell('A1');
  companyCell.value = CONFIG.company.name;
  companyCell.font = { size: 16, bold: true, color: { argb: CONFIG.colors.primary } };
  companyCell.alignment = { horizontal: 'center' };

  const titleCell = ws.getCell('A2');
  titleCell.value = title;
  titleCell.font = { size: 12, bold: true };
  titleCell.alignment = { horizontal: 'center' };

  const periodCell = ws.getCell('A3');
  periodCell.value = `Period: ${getMonthName(period.month)} ${period.year}`;
  periodCell.font = { size: 10, italic: true };
  periodCell.alignment = { horizontal: 'center' };

  return 5; // Starting row for data
}

function styleHeaderRow(ws, row, columnCount) {
  for (let i = 1; i <= columnCount; i++) {
    const cell = ws.getRow(row).getCell(i);
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CONFIG.colors.primary } };
    cell.font = { bold: true, color: { argb: 'FFFFFF' }, size: 10 };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = {
      top: { style: 'thin' },
      left: { style: 'thin' },
      bottom: { style: 'thin' },
      right: { style: 'thin' }
    };
  }
  ws.getRow(row).height = 22;
}

function addDataRows(ws, data, columns, startRow) {
  data.forEach((item, idx) => {
    const row = ws.getRow(startRow + idx);
    columns.forEach((col, colIdx) => {
      const cell = row.getCell(colIdx + 1);
      cell.value = col.transform ? col.transform(item[col.key], item) : item[col.key];
      cell.alignment = { horizontal: col.align || 'left', vertical: 'middle' };
      if (col.numFmt) cell.numFmt = col.numFmt;
      cell.border = {
        top: { style: 'thin', color: { argb: 'DDDDDD' } },
        bottom: { style: 'thin', color: { argb: 'DDDDDD' } }
      };
    });
    // Alternate row colors
    if (idx % 2 === 0) {
      for (let i = 1; i <= columns.length; i++) {
        row.getCell(i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CONFIG.colors.altRow } };
      }
    }
  });
  return startRow + data.length;
}

function addTotalsRow(ws, row, totals, columnCount) {
  const totalRow = ws.getRow(row);
  totalRow.getCell(1).value = 'TOTALS:';
  totalRow.getCell(1).font = { bold: true };
  
  Object.entries(totals).forEach(([colIdx, value]) => {
    const cell = totalRow.getCell(parseInt(colIdx));
    cell.value = value;
    cell.font = { bold: true };
    cell.numFmt = '#,##0.00';
  });

  for (let i = 1; i <= columnCount; i++) {
    totalRow.getCell(i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CONFIG.colors.header } };
    totalRow.getCell(i).border = { top: { style: 'medium' }, bottom: { style: 'medium' } };
  }
}

// ============================================
// ALLOWANCES REPORT - EXCEL
// ============================================
async function createAllowancesExcel(workbook, period) {
  const [data] = await pool.query(`
    SELECT 
      mp.his_type,
      et.elmDesc as allowance_name,
      COUNT(DISTINCT mp.his_empno) as employee_count,
      ROUND(SUM(mp.amtthismth), 2) as total_amount,
      ROUND(AVG(mp.amtthismth), 2) as average_amount,
      ROUND(MIN(mp.amtthismth), 2) as min_amount,
      ROUND(MAX(mp.amtthismth), 2) as max_amount
    FROM py_masterpayded mp
    INNER JOIN py_elementType et ON et.PaymentType = mp.his_type
    WHERE LEFT(mp.his_type, 2) = 'PT' AND mp.amtthismth > 0
    GROUP BY mp.his_type, et.elmDesc
    ORDER BY total_amount DESC
  `);

  const ws = workbook.addWorksheet('Allowances Summary', {
    pageSetup: { paperSize: 9, orientation: 'landscape' }
  });

  const columns = [
    { header: 'S/N', key: 'sn', width: 6, align: 'center' },
    { header: 'Code', key: 'his_type', width: 10 },
    { header: 'Allowance Name', key: 'allowance_name', width: 30 },
    { header: 'Employees', key: 'employee_count', width: 12, align: 'center' },
    { header: 'Total (₦)', key: 'total_amount', width: 15, align: 'right', numFmt: '#,##0.00' },
    { header: 'Average (₦)', key: 'average_amount', width: 15, align: 'right', numFmt: '#,##0.00' },
    { header: 'Min (₦)', key: 'min_amount', width: 12, align: 'right', numFmt: '#,##0.00' },
    { header: 'Max (₦)', key: 'max_amount', width: 12, align: 'right', numFmt: '#,##0.00' }
  ];

  columns.forEach((col, idx) => { ws.getColumn(idx + 1).width = col.width; });

  const startRow = addExcelHeader(ws, 'ALLOWANCES SUMMARY REPORT', period, columns.length);

  const headerRow = ws.getRow(startRow);
  columns.forEach((col, idx) => { headerRow.getCell(idx + 1).value = col.header; });
  styleHeaderRow(ws, startRow, columns.length);

  const dataWithSN = data.map((item, idx) => ({ ...item, sn: idx + 1 }));
  const endRow = addDataRows(ws, dataWithSN, columns, startRow + 1);

  const totalAllowances = data.reduce((sum, d) => sum + parseFloat(d.total_amount || 0), 0);
  addTotalsRow(ws, endRow + 1, { 5: totalAllowances }, columns.length);
}

// ============================================
// BANK REPORT EXCEL
// ============================================
async function createBankExcel(workbook, period) {
  const [data] = await pool.query(`
    SELECT 
      mc.his_empno AS employee_id,
      CONCAT(we.Surname, ' ', IFNULL(we.OtherName, '')) AS full_name,
      we.bankcode,
      we.bankbranch,
      we.bankacnumber,
      ROUND(mc.his_netmth, 2) AS net_pay,
      ROUND(mc.his_grossmth, 2) AS gross_pay
    FROM py_mastercum mc
    INNER JOIN py_wkemployees we ON we.empl_id = mc.his_empno
    WHERE mc.his_type = ?
    ORDER BY we.bankcode, we.Surname
  `, [period.month]);

  const ws = workbook.addWorksheet('Bank Schedule', {
    pageSetup: { paperSize: 9, orientation: 'landscape' }
  });

  const columns = [
    { header: 'S/N', key: 'sn', width: 6, align: 'center' },
    { header: 'Svc No.', key: 'employee_id', width: 12 },
    { header: 'Full Name', key: 'full_name', width: 30 },
    { header: 'Bank Code', key: 'bankcode', width: 12 },
    { header: 'Branch', key: 'bankbranch', width: 15 },
    { header: 'Account Number', key: 'bankacnumber', width: 18 },
    { header: 'Net Pay (₦)', key: 'net_pay', width: 15, align: 'right', numFmt: '#,##0.00' }
  ];

  // Set column widths
  columns.forEach((col, idx) => { ws.getColumn(idx + 1).width = col.width; });

  const startRow = addExcelHeader(ws, 'BANK PAYMENT SCHEDULE', period, columns.length);

  // Add headers
  const headerRow = ws.getRow(startRow);
  columns.forEach((col, idx) => { headerRow.getCell(idx + 1).value = col.header; });
  styleHeaderRow(ws, startRow, columns.length);

  // Add serial numbers and data
  const dataWithSN = data.map((item, idx) => ({ ...item, sn: idx + 1 }));
  const endRow = addDataRows(ws, dataWithSN, columns, startRow + 1);

  // Totals
  const totalNet = data.reduce((sum, d) => sum + parseFloat(d.net_pay || 0), 0);
  addTotalsRow(ws, endRow + 1, { 7: totalNet }, columns.length);

  // Record count
  ws.getCell(`A${endRow + 3}`).value = `Total Records: ${data.length}`;
  ws.getCell(`A${endRow + 3}`).font = { italic: true };
}

// ============================================
// DEDUCTIONS REPORT EXCEL
// ============================================
async function createDeductionsExcel(workbook, period) {
  const [data] = await pool.query(`
    SELECT 
      mp.his_type,
      et.elmDesc as deduction_name,
      COUNT(DISTINCT mp.his_empno) as employee_count,
      ROUND(SUM(mp.amtthismth), 2) as total_amount,
      ROUND(AVG(mp.amtthismth), 2) as average_amount,
      ROUND(MIN(mp.amtthismth), 2) as min_amount,
      ROUND(MAX(mp.amtthismth), 2) as max_amount
    FROM py_masterpayded mp
    INNER JOIN py_elementType et ON et.PaymentType = mp.his_type
    WHERE LEFT(mp.his_type, 2) = 'PR' AND mp.amtthismth > 0
    GROUP BY mp.his_type, et.elmDesc
    ORDER BY total_amount DESC
  `);

  const ws = workbook.addWorksheet('Deductions Summary', {
    pageSetup: { paperSize: 9, orientation: 'landscape' }
  });

  const columns = [
    { header: 'S/N', key: 'sn', width: 6, align: 'center' },
    { header: 'Code', key: 'his_type', width: 10 },
    { header: 'Deduction Name', key: 'deduction_name', width: 30 },
    { header: 'Employees', key: 'employee_count', width: 12, align: 'center' },
    { header: 'Total (₦)', key: 'total_amount', width: 15, align: 'right', numFmt: '#,##0.00' },
    { header: 'Average (₦)', key: 'average_amount', width: 15, align: 'right', numFmt: '#,##0.00' },
    { header: 'Min (₦)', key: 'min_amount', width: 12, align: 'right', numFmt: '#,##0.00' },
    { header: 'Max (₦)', key: 'max_amount', width: 12, align: 'right', numFmt: '#,##0.00' }
  ];

  columns.forEach((col, idx) => { ws.getColumn(idx + 1).width = col.width; });

  const startRow = addExcelHeader(ws, 'DEDUCTIONS SUMMARY REPORT', period, columns.length);

  const headerRow = ws.getRow(startRow);
  columns.forEach((col, idx) => { headerRow.getCell(idx + 1).value = col.header; });
  styleHeaderRow(ws, startRow, columns.length);

  const dataWithSN = data.map((item, idx) => ({ ...item, sn: idx + 1 }));
  const endRow = addDataRows(ws, dataWithSN, columns, startRow + 1);

  const totalDeductions = data.reduce((sum, d) => sum + parseFloat(d.total_amount || 0), 0);
  addTotalsRow(ws, endRow + 1, { 5: totalDeductions }, columns.length);
}

// ============================================
// TAX REPORT EXCEL
// ============================================
async function createTaxExcel(workbook, period) {
  const [data] = await pool.query(`
    SELECT 
      mc.his_empno as employee_id,
      CONCAT(we.Surname, ' ', IFNULL(we.OtherName, '')) AS full_name,
      we.gradelevel,
      ROUND(mc.his_grossmth, 2) as gross_pay,
      ROUND(mc.his_taxfreepaytodate, 2) as tax_free_pay,
      ROUND(mc.his_taxabletodate, 2) as taxable_income,
      ROUND(mc.his_taxmth, 2) as tax_deducted,
      ROUND(mc.his_taxtodate, 2) as cumulative_tax
    FROM py_mastercum mc
    INNER JOIN py_wkemployees we ON we.empl_id = mc.his_empno
    WHERE mc.his_type = ?
    ORDER BY mc.his_taxmth DESC
  `, [period.month]);

  const ws = workbook.addWorksheet('PAYE Tax Report', {
    pageSetup: { paperSize: 9, orientation: 'landscape' }
  });

  const columns = [
    { header: 'S/N', key: 'sn', width: 6, align: 'center' },
    { header: 'Emp ID', key: 'employee_id', width: 10 },
    { header: 'Full Name', key: 'full_name', width: 28 },
    { header: 'Grade', key: 'gradelevel', width: 10, align: 'center' },
    { header: 'Gross Pay (₦)', key: 'gross_pay', width: 14, align: 'right', numFmt: '#,##0.00' },
    { header: 'Tax Free (₦)', key: 'tax_free_pay', width: 14, align: 'right', numFmt: '#,##0.00' },
    { header: 'Taxable (₦)', key: 'taxable_income', width: 14, align: 'right', numFmt: '#,##0.00' },
    { header: 'PAYE (₦)', key: 'tax_deducted', width: 12, align: 'right', numFmt: '#,##0.00' },
    { header: 'Cum. Tax (₦)', key: 'cumulative_tax', width: 14, align: 'right', numFmt: '#,##0.00' }
  ];

  columns.forEach((col, idx) => { ws.getColumn(idx + 1).width = col.width; });

  const startRow = addExcelHeader(ws, 'PAYE TAX SCHEDULE', period, columns.length);

  const headerRow = ws.getRow(startRow);
  columns.forEach((col, idx) => { headerRow.getCell(idx + 1).value = col.header; });
  styleHeaderRow(ws, startRow, columns.length);

  const dataWithSN = data.map((item, idx) => ({ ...item, sn: idx + 1 }));
  const endRow = addDataRows(ws, dataWithSN, columns, startRow + 1);

  const totals = {
    5: data.reduce((sum, d) => sum + parseFloat(d.gross_pay || 0), 0),
    7: data.reduce((sum, d) => sum + parseFloat(d.taxable_income || 0), 0),
    8: data.reduce((sum, d) => sum + parseFloat(d.tax_deducted || 0), 0)
  };
  addTotalsRow(ws, endRow + 1, totals, columns.length);
}

// ============================================
// DEPARTMENT REPORT EXCEL
// ============================================
async function createDepartmentExcel(workbook, period) {
  const [data] = await pool.query(`
    SELECT 
      we.Location as department,
      COUNT(DISTINCT mc.his_empno) as employee_count,
      ROUND(SUM(mc.his_grossmth), 2) as total_gross,
      ROUND(SUM(mc.his_taxmth), 2) as total_tax,
      ROUND(SUM(mc.his_netmth), 2) as total_net,
      ROUND(AVG(mc.his_netmth), 2) as average_net
    FROM py_mastercum mc
    INNER JOIN py_wkemployees we ON we.empl_id = mc.his_empno
    WHERE mc.his_type = ?
    GROUP BY we.Location
    ORDER BY total_net DESC
  `, [period.month]);

  const ws = workbook.addWorksheet('Department Summary', {
    pageSetup: { paperSize: 9, orientation: 'landscape' }
  });

  const totalNet = data.reduce((sum, d) => sum + parseFloat(d.total_net || 0), 0);

  const columns = [
    { header: 'S/N', key: 'sn', width: 6, align: 'center' },
    { header: 'Department/Location', key: 'department', width: 25 },
    { header: 'Employees', key: 'employee_count', width: 12, align: 'center' },
    { header: 'Gross Pay (₦)', key: 'total_gross', width: 16, align: 'right', numFmt: '#,##0.00' },
    { header: 'Tax (₦)', key: 'total_tax', width: 14, align: 'right', numFmt: '#,##0.00' },
    { header: 'Net Pay (₦)', key: 'total_net', width: 16, align: 'right', numFmt: '#,##0.00' },
    { header: 'Avg Net (₦)', key: 'average_net', width: 14, align: 'right', numFmt: '#,##0.00' },
    { header: '% of Total', key: 'percentage', width: 10, align: 'center',
      transform: (_, item) => ((parseFloat(item.total_net) / totalNet) * 100).toFixed(1) + '%' }
  ];

  columns.forEach((col, idx) => { ws.getColumn(idx + 1).width = col.width; });

  const startRow = addExcelHeader(ws, 'DEPARTMENTAL PAYROLL SUMMARY', period, columns.length);

  const headerRow = ws.getRow(startRow);
  columns.forEach((col, idx) => { headerRow.getCell(idx + 1).value = col.header; });
  styleHeaderRow(ws, startRow, columns.length);

  const dataWithSN = data.map((item, idx) => ({ ...item, sn: idx + 1 }));
  const endRow = addDataRows(ws, dataWithSN, columns, startRow + 1);

  const totals = {
    3: data.reduce((sum, d) => sum + parseInt(d.employee_count || 0), 0),
    4: data.reduce((sum, d) => sum + parseFloat(d.total_gross || 0), 0),
    5: data.reduce((sum, d) => sum + parseFloat(d.total_tax || 0), 0),
    6: totalNet
  };
  addTotalsRow(ws, endRow + 1, totals, columns.length);
}

// ============================================
// GRADE REPORT EXCEL
// ============================================
async function createGradeExcel(workbook, period) {
  const [data] = await pool.query(`
    SELECT 
      we.gradelevel as grade,
      we.gradetype,
      COUNT(DISTINCT mc.his_empno) as employee_count,
      ROUND(SUM(mc.his_grossmth), 2) as total_gross,
      ROUND(SUM(mc.his_taxmth), 2) as total_tax,
      ROUND(SUM(mc.his_netmth), 2) as total_net,
      ROUND(AVG(mc.his_netmth), 2) as average_net
    FROM py_mastercum mc
    INNER JOIN py_wkemployees we ON we.empl_id = mc.his_empno
    WHERE mc.his_type = ?
    GROUP BY we.gradelevel, we.gradetype
    ORDER BY we.gradelevel
  `, [period.month]);

  const ws = workbook.addWorksheet('Grade Summary', {
    pageSetup: { paperSize: 9, orientation: 'landscape' }
  });

  const columns = [
    { header: 'S/N', key: 'sn', width: 6, align: 'center' },
    { header: 'Grade Level', key: 'grade', width: 12 },
    { header: 'Grade Type', key: 'gradetype', width: 15 },
    { header: 'Employees', key: 'employee_count', width: 12, align: 'center' },
    { header: 'Gross Pay (₦)', key: 'total_gross', width: 16, align: 'right', numFmt: '#,##0.00' },
    { header: 'Tax (₦)', key: 'total_tax', width: 14, align: 'right', numFmt: '#,##0.00' },
    { header: 'Net Pay (₦)', key: 'total_net', width: 16, align: 'right', numFmt: '#,##0.00' },
    { header: 'Avg Net (₦)', key: 'average_net', width: 14, align: 'right', numFmt: '#,##0.00' }
  ];

  columns.forEach((col, idx) => { ws.getColumn(idx + 1).width = col.width; });

  const startRow = addExcelHeader(ws, 'GRADE-WISE PAYROLL SUMMARY', period, columns.length);

  const headerRow = ws.getRow(startRow);
  columns.forEach((col, idx) => { headerRow.getCell(idx + 1).value = col.header; });
  styleHeaderRow(ws, startRow, columns.length);

  const dataWithSN = data.map((item, idx) => ({ ...item, sn: idx + 1 }));
  const endRow = addDataRows(ws, dataWithSN, columns, startRow + 1);

  const totals = {
    4: data.reduce((sum, d) => sum + parseInt(d.employee_count || 0), 0),
    5: data.reduce((sum, d) => sum + parseFloat(d.total_gross || 0), 0),
    6: data.reduce((sum, d) => sum + parseFloat(d.total_tax || 0), 0),
    7: data.reduce((sum, d) => sum + parseFloat(d.total_net || 0), 0)
  };
  addTotalsRow(ws, endRow + 1, totals, columns.length);
}

// ============================================
// EXCEPTIONS REPORT EXCEL
// ============================================
async function createExceptionsExcel(workbook, period) {
  const [data] = await pool.query(`
    SELECT 
      mc.his_empno as employee_id,
      CONCAT(we.Surname, ' ', IFNULL(we.OtherName, '')) AS full_name,
      we.gradelevel,
      ROUND(mc.his_grossmth, 2) as gross_pay,
      ROUND(mc.his_netmth, 2) as net_pay,
      CASE
        WHEN mc.his_netmth <= 0 THEN 'Zero or Negative Pay'
        WHEN mc.his_grossmth <= 0 THEN 'Zero Gross Pay'
        WHEN mc.his_netmth < mc.his_grossmth THEN 'Gross Exceeds Net'
        WHEN mc.his_taxmth < 0 THEN 'Negative Tax'
        ELSE 'Other Exception'
      END as exception_type
    FROM py_mastercum mc
    INNER JOIN py_wkemployees we ON we.empl_id = mc.his_empno
    WHERE mc.his_type = ?
      AND (mc.his_netmth <= 0 OR mc.his_grossmth <= 0 OR mc.his_netmth < mc.his_grossmth OR mc.his_taxmth < 0)
    ORDER BY exception_type, full_name
  `, [period.month]);

  const ws = workbook.addWorksheet('Exceptions Report', {
    pageSetup: { paperSize: 9, orientation: 'landscape' }
  });

  const columns = [
    { header: 'S/N', key: 'sn', width: 12, align: 'center' },
    { header: 'Svc No.', key: 'employee_id', width: 12 },
    { header: 'Full Name', key: 'full_name', width: 28 },
    { header: 'Grade', key: 'gradelevel', width: 10, align: 'center' },
    { header: 'Gross Pay (₦)', key: 'gross_pay', width: 14, align: 'right', numFmt: '#,##0.00' },
    { header: 'Net Pay (₦)', key: 'net_pay', width: 14, align: 'right', numFmt: '#,##0.00' },
    { header: 'Exception Type', key: 'exception_type', width: 22 }
  ];

  columns.forEach((col, idx) => { ws.getColumn(idx + 1).width = col.width; });

  const startRow = addExcelHeader(ws, 'PAYROLL EXCEPTIONS REPORT', period, columns.length);

  const headerRow = ws.getRow(startRow);
  columns.forEach((col, idx) => { headerRow.getCell(idx + 1).value = col.header; });
  styleHeaderRow(ws, startRow, columns.length);

  const dataWithSN = data.map((item, idx) => ({ ...item, sn: idx + 1 }));
  addDataRows(ws, dataWithSN, columns, startRow + 1);

  // Summary by exception type
  const summaryRow = startRow + data.length + 3;
  ws.getCell(`A${summaryRow}`).value = 'Summary by Exception Type:';
  ws.getCell(`A${summaryRow}`).font = { bold: true };

  const exceptionCounts = data.reduce((acc, d) => {
    acc[d.exception_type] = (acc[d.exception_type] || 0) + 1;
    return acc;
  }, {});

  let row = summaryRow + 1;
  Object.entries(exceptionCounts).forEach(([type, count]) => {
    ws.getCell(`A${row}`).value = type;
    ws.getCell(`B${row}`).value = count;
    row++;
  });
}

// ============================================
// SUMMARY REPORT EXCEL
// ============================================
async function createSummaryExcel(workbook, period) {
  // Get summary data
  const [[summary]] = await pool.query(`
    SELECT 
      COUNT(DISTINCT his_empno) AS total_employees,
      ROUND(SUM(his_grossmth), 2) AS total_gross,
      ROUND(SUM(his_taxmth), 2) AS total_tax,
      ROUND(COALESCE(SUM(his_netmth), 0), 2) AS total_net,
      ROUND(AVG(his_netmth), 2) AS average_net_pay
    FROM py_mastercum WHERE his_type = ?
  `, [period.month]);

  const [[payded]] = await pool.query(`
    SELECT 
      ROUND(SUM(CASE WHEN LEFT(his_type, 2) = 'PR' THEN amtthismth ELSE 0 END), 2) AS total_deductions,
      ROUND(SUM(CASE WHEN LEFT(his_type, 2) = 'PT' THEN amtthismth ELSE 0 END), 2) AS total_allowances
    FROM py_masterpayded
  `);

  const ws = workbook.addWorksheet('Payroll Summary', {
    pageSetup: { paperSize: 9, orientation: 'portrait' }
  });

  addExcelHeader(ws, 'PAYROLL SUMMARY REPORT', period, 4);

  // Summary cards
  const summaryData = [
    ['Total Employees', summary.total_employees],
    ['Total Gross Pay', formatMoney(summary.total_gross)],
    ['Total Allowances', formatMoney(payded.total_allowances)],
    ['Total Deductions', formatMoney(payded.total_deductions)],
    ['Total Tax (PAYE)', formatMoney(summary.total_tax)],
    ['Total Net Pay', formatMoney(summary.total_net)],
    ['Average Net Pay', formatMoney(summary.average_net_pay)]
  ];

  let row = 6;
  summaryData.forEach(([label, value]) => {
    ws.getCell(`B${row}`).value = label;
    ws.getCell(`B${row}`).font = { bold: true };
    ws.getCell(`C${row}`).value = value;
    ws.getCell(`C${row}`).alignment = { horizontal: 'right' };
    ws.getCell(`C${row}`).border = { bottom: { style: 'thin', color: { argb: 'DDDDDD' } } };
    row++;
  });

  ws.getColumn(2).width = 25;
  ws.getColumn(3).width = 20;
}

// ============================================
// CONTROL SHEET EXCEL EXPORT
// ============================================
async function createControlSheetExcel(workbook, period) {
  const [data] = await pool.query(`
    SELECT 
      ts.cyear as year,
      ts.pmonth as month,
      ts.type1 as payment_type,
      COALESCE(et.elmDesc, ts.desc1) as payment_description,
      CASE 
        WHEN LEFT(ts.type1, 2) IN ('BP', 'BT', 'PT', 'FP') THEN 'DR'
        WHEN LEFT(ts.type1, 2) IN ('PR', 'PL', 'PY') THEN 'CR'
        ELSE 'DR'
      END as dr_cr_indicator,
      CASE 
        WHEN LEFT(ts.type1, 2) IN ('BP', 'BT', 'PT', 'FP') 
        THEN ROUND(SUM(ts.amt1), 2)
        ELSE 0.00
      END as dr_amount,
      CASE 
        WHEN ts.type1 = 'PY01' THEN ROUND(SUM(ts.net), 2)
        WHEN ts.type1 = 'PY02' THEN ROUND(SUM(ts.tax), 2)
        WHEN ts.type1 = 'PY03' THEN ROUND(SUM(ts.roundup), 2)
        WHEN LEFT(ts.type1, 2) IN ('PR', 'PL') THEN ROUND(SUM(ts.amt2), 2)
        ELSE 0.00
      END as cr_amount,
      COALESCE(ts.ledger1, '') as ledger_code,
      CASE 
        WHEN LEFT(ts.type1, 2) IN ('BP', 'BT') THEN 1
        WHEN LEFT(ts.type1, 2) = 'PT' THEN 2
        WHEN LEFT(ts.type1, 2) = 'FP' THEN 3
        WHEN LEFT(ts.type1, 2) = 'PR' THEN 4
        WHEN LEFT(ts.type1, 2) = 'PL' THEN 5
        WHEN LEFT(ts.type1, 2) = 'PY' THEN 6
        ELSE 7
      END as sort_order
    FROM py_tempsumm ts
    LEFT JOIN py_elementType et ON et.PaymentType = ts.type1
    WHERE (ts.amt1 != 0 OR ts.amt2 != 0 OR ts.tax != 0 OR ts.net != 0 OR ts.roundup != 0)
    GROUP BY ts.cyear, ts.pmonth, ts.type1, ts.desc1, et.elmDesc, ts.ledger1, dr_cr_indicator, sort_order
    ORDER BY sort_order, ts.type1
  `);

  const ws = workbook.addWorksheet('Control Sheet', {
    pageSetup: { paperSize: 9, orientation: 'landscape' }
  });

  const columns = [
    { header: 'S/N', key: 'sn', width: 12, align: 'center' },
    { header: 'Code', key: 'payment_type', width: 12 },
    { header: 'Description', key: 'payment_description', width: 35 },
    { header: 'Ledger Code', key: 'ledger_code', width: 15 },
    { header: 'DR/CR', key: 'dr_cr_indicator', width: 8, align: 'center' },
    { header: 'Debit (₦)', key: 'dr_amount', width: 15, align: 'right', numFmt: '#,##0.00' },
    { header: 'Credit (₦)', key: 'cr_amount', width: 15, align: 'right', numFmt: '#,##0.00' }
  ];

  columns.forEach((col, idx) => { ws.getColumn(idx + 1).width = col.width; });

  const startRow = addExcelHeader(ws, 'PAYROLL CONTROL SHEET', period, columns.length);

  const headerRow = ws.getRow(startRow);
  columns.forEach((col, idx) => { headerRow.getCell(idx + 1).value = col.header; });
  styleHeaderRow(ws, startRow, columns.length);

  const dataWithSN = data.map((item, idx) => ({ ...item, sn: idx + 1 }));
  const endRow = addDataRows(ws, dataWithSN, columns, startRow + 1);

  const totalDR = data.reduce((sum, d) => sum + parseFloat(d.dr_amount || 0), 0);
  const totalCR = data.reduce((sum, d) => sum + parseFloat(d.cr_amount || 0), 0);
  
  addTotalsRow(ws, endRow + 1, { 6: totalDR, 7: totalCR }, columns.length);

  // Variance check
  const variance = Math.abs(totalDR - totalCR);
  const varianceRow = ws.getRow(endRow + 3);
  varianceRow.getCell(1).value = 'VARIANCE:';
  varianceRow.getCell(1).font = { bold: true };
  varianceRow.getCell(2).value = variance < 0.01 ? 'BALANCED' : formatMoney(variance);
  varianceRow.getCell(2).font = { bold: true, color: { argb: variance < 0.01 ? '70AD47' : 'FF0000' } };
}



// Helper function to check if calculations are complete
async function checkCalculationsComplete() {
  const [bt05] = await pool.query("SELECT sun FROM py_stdrate WHERE type='BT05' LIMIT 1");
  if (!bt05.length || bt05[0].sun < 999) {
    throw new Error('Payroll calculations must be completed first');
  }
  return bt05[0];
}

// Get current period info
async function getCurrentPeriod() {
  const [period] = await pool.query("SELECT ord as year, mth as month FROM py_stdrate WHERE type='BT05' LIMIT 1");
  return period[0] || {};
}

// 3. Payroll Summary Report
exports.getPayrollSummary = async (req, res) => {
  try {
    await checkCalculationsComplete();
    const period = await getCurrentPeriod();

    const query = `
      SELECT 
          emp_totals.total_employees,
          mc_totals.total_gross,
          mc_totals.total_tax,
          mc_totals.total_net,
          mp_totals.total_deductions,
          mp_totals.total_allowances,
          mc_totals.average_net_pay
      FROM (
          SELECT 
              COUNT(DISTINCT Empl_ID) AS total_employees
          FROM py_wkemployees
      ) emp_totals
      CROSS JOIN (
          SELECT 
              ROUND(SUM(his_grossmth), 2) AS total_gross,
              ROUND(SUM(his_taxmth), 2) AS total_tax,
              ROUND(COALESCE(SUM(his_netmth), 0), 2) AS total_net,
              ROUND(AVG(his_netmth), 2) AS average_net_pay
          FROM py_mastercum
          WHERE his_type = ?
      ) mc_totals
      CROSS JOIN (
          SELECT 
              ROUND(SUM(CASE WHEN LEFT(his_type, 2) IN ('PR', 'PL') THEN amtthismth ELSE 0 END), 2) AS total_deductions,
              ROUND(SUM(CASE WHEN LEFT(his_type, 2) = 'PT' THEN amtthismth ELSE 0 END), 2) AS total_allowances
          FROM py_masterpayded
      ) mp_totals
    `;

    const [summary] = await pool.query(query, [period.month, period.month]);

    res.json({
      success: true,
      data: {
        period: { month: period.month },
        summary: summary[0]
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// 4. Payment by Bank Report
exports.getBankReport = async (req, res) => {
  try {
    await checkCalculationsComplete();
    const period = await getCurrentPeriod();

    const query = `
      SELECT 
          mc.his_empno AS employee_id,
          CONCAT(we.Surname, ' ', IFNULL(we.OtherName, '')) AS full_name,
          we.bankcode,
          we.bankbranch,
          we.bankacnumber,
          ROUND(mc.his_netmth, 2) AS net_pay,
          ROUND(mc.his_grossmth, 2) AS gross_pay
      FROM py_mastercum mc
      INNER JOIN py_wkemployees we 
          ON we.empl_id = mc.his_empno
      WHERE mc.his_type = ?
      ORDER BY we.bankcode, full_name;
    `;

    const [bankData] = await pool.query(query, [period.month]);

    // Group by bank
    const byBank = {};
    let grandTotal = 0;

    bankData.forEach(row => {
      const bank = row.bankcode || 'UNASSIGNED';
      if (!byBank[bank]) {
        byBank[bank] = { employees: [], total: 0, count: 0 };
      }
      byBank[bank].employees.push(row);
      byBank[bank].total += parseFloat(row.net_pay);
      byBank[bank].count++;
      grandTotal += parseFloat(row.net_pay);
    });

    res.json({
      success: true,
      data: {
        period: { year: period.year, month: period.month },
        byBank,
        grandTotal,
        totalEmployees: bankData.length
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// 5. Deductions Summary
exports.getDeductionsSummary = async (req, res) => {
  try {
    await checkCalculationsComplete();
    const period = await getCurrentPeriod();

    const query = `
      SELECT 
        mp.his_type,
        et.elmDesc as deduction_name,
        COUNT(DISTINCT mp.his_empno) as employee_count,
        ROUND(SUM(mp.amtthismth), 2) as total_amount,
        ROUND(AVG(mp.amtthismth), 2) as average_amount,
        ROUND(MIN(mp.amtthismth), 2) as min_amount,
        ROUND(MAX(mp.amtthismth), 2) as max_amount
      FROM py_masterpayded mp
      INNER JOIN py_elementType et ON et.PaymentType = mp.his_type
      WHERE LEFT(mp.his_type, 2) IN ('PR', 'PL')
        AND mp.amtthismth > 0
      GROUP BY mp.his_type, et.elmDesc
      ORDER BY total_amount DESC
    `;

    const [deductions] = await pool.query(query);

    const totalDeductions = deductions.reduce((sum, d) => sum + parseFloat(d.total_amount), 0);

    res.json({
      success: true,
      data: {
        period: { year: period.year, month: period.month },
        deductions,
        totalDeductions,
        deductionCount: deductions.length
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// 6. Tax Report (PAYE)
exports.getTaxReport = async (req, res) => {
  try {
    await checkCalculationsComplete();
    const period = await getCurrentPeriod();

    const query = `
      SELECT 
        mc.his_empno as employee_id,
        CONCAT(we.Surname, ' ', IFNULL(we.OtherName, '')) AS full_name,
        we.gradelevel,
        ROUND(mc.his_grossmth, 2) as gross_pay,
        ROUND(mc.his_taxfreepaytodate, 2) as tax_free_pay,
        ROUND(mc.his_taxabletodate, 2) as taxable_income,
        ROUND(mc.his_taxmth, 2) as tax_deducted,
        ROUND(mc.his_taxtodate, 2) as cumulative_tax
      FROM py_mastercum mc
      INNER JOIN py_wkemployees we ON we.empl_id = mc.his_empno
      WHERE mc.his_type = ?
      ORDER BY mc.his_taxmth DESC
    `;

    const [taxData] = await pool.query(query, [period.month]);

    const summary = {
      totalEmployees: taxData.length,
      totalTaxCollected: taxData.reduce((sum, t) => sum + parseFloat(t.tax_deducted), 0),
      totalTaxableIncome: taxData.reduce((sum, t) => sum + parseFloat(t.taxable_income), 0),
      totalGrossPay: taxData.reduce((sum, t) => sum + parseFloat(t.gross_pay), 0),
      employeesWithTax: taxData.filter(t => parseFloat(t.tax_deducted) > 0).length
    };

    res.json({
      success: true,
      data: {
        period: { year: period.year, month: period.month },
        taxData,
        summary
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// 7. Department-wise Summary
exports.getDepartmentSummary = async (req, res) => {
  try {
    await checkCalculationsComplete();
    const period = await getCurrentPeriod();

    const query = `
      SELECT 
        we.Location as department,
        COUNT(DISTINCT mc.his_empno) as employee_count,
        ROUND(SUM(mc.his_grossmth), 2) as total_gross,
        ROUND(SUM(mc.his_taxmth), 2) as total_tax,
        ROUND(SUM(mc.his_netmth), 2) as total_net,
        ROUND(AVG(mc.his_netmth), 2) as average_net
      FROM py_mastercum mc
      INNER JOIN py_wkemployees we ON we.empl_id = mc.his_empno
      WHERE mc.his_type = ?
      GROUP BY we.Location
      ORDER BY total_net DESC
    `;

    const [departments] = await pool.query(query, [period.month]);

    const grandTotal = departments.reduce((sum, d) => sum + parseFloat(d.total_net), 0);

    res.json({
      success: true,
      data: {
        period: { year: period.year, month: period.month },
        departments,
        grandTotal,
        departmentCount: departments.length
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// 8. Grade-wise Summary
exports.getGradeSummary = async (req, res) => {
  try {
    await checkCalculationsComplete();
    const period = await getCurrentPeriod();

    const query = `
      SELECT 
        we.gradelevel as grade,
        we.gradetype,
        COUNT(DISTINCT mc.his_empno) as employee_count,
        ROUND(SUM(mc.his_grossmth), 2) as total_gross,
        ROUND(SUM(mc.his_taxmth), 2) as total_tax,
        ROUND(SUM(mc.his_netmth), 2) as total_net,
        ROUND(AVG(mc.his_netmth), 2) as average_net
      FROM py_mastercum mc
      INNER JOIN py_wkemployees we ON we.empl_id = mc.his_empno
      WHERE mc.his_type = ?
      GROUP BY we.gradelevel, we.gradetype
      ORDER BY we.gradelevel
    `;

    const [grades] = await pool.query(query, [period.month]);

    const grandTotal = grades.reduce((sum, g) => sum + parseFloat(g.total_net), 0);

    res.json({
      success: true,
      data: {
        period: { year: period.year, month: period.month },
        grades,
        grandTotal,
        gradeCount: grades.length
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// 9. Exception Report
exports.getExceptionReport = async (req, res) => {
  try {
    await checkCalculationsComplete();
    const period = await getCurrentPeriod();

    const query = `
      SELECT 
        mc.his_empno as employee_id,
        CONCAT(we.Surname, ' ', IFNULL(we.OtherName, '')) AS full_name,
        we.gradelevel,
        ROUND(mc.his_grossmth, 2) as gross_pay,
        ROUND(mc.his_netmth, 2) as net_pay,
        CASE
          WHEN mc.his_netmth <= 0 THEN 'Zero or Negative Pay'
          WHEN mc.his_grossmth <= 0 THEN 'Zero Gross Pay'
          WHEN mc.his_netmth < mc.his_grossmth THEN 'Gross Exceeds Net'
          WHEN mc.his_taxmth < 0 THEN 'Negative Tax'
          ELSE 'Other Exception'
        END as exception_type
      FROM py_mastercum mc
      INNER JOIN py_wkemployees we ON we.empl_id = mc.his_empno
      WHERE mc.his_type = ?
        AND (
          mc.his_netmth <= 0 OR
          mc.his_grossmth <= 0 OR
          mc.his_netmth < mc.his_grossmth OR
          mc.his_taxmth < 0
        )
      ORDER BY exception_type, full_name
    `;

    const [exceptions] = await pool.query(query, [period.month]);

    const byType = {};
    exceptions.forEach(ex => {
      if (!byType[ex.exception_type]) {
        byType[ex.exception_type] = [];
      }
      byType[ex.exception_type].push(ex);
    });

    res.json({
      success: true,
      data: {
        period: { year: period.year, month: period.month },
        exceptions,
        byType,
        totalExceptions: exceptions.length
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

//10.  ALLOWANCES REPORT - DATA ENDPOINT
exports.getAllowancesSummary = async (req, res) => {
  try {
    await checkCalculationsComplete();
    const period = await getCurrentPeriod();

    const query = `
      SELECT 
        mp.his_type,
        et.elmDesc as allowance_name,
        COUNT(DISTINCT mp.his_empno) as employee_count,
        ROUND(SUM(mp.amtthismth), 2) as total_amount,
        ROUND(AVG(mp.amtthismth), 2) as average_amount,
        ROUND(MIN(mp.amtthismth), 2) as min_amount,
        ROUND(MAX(mp.amtthismth), 2) as max_amount
      FROM py_masterpayded mp
      INNER JOIN py_elementType et ON et.PaymentType = mp.his_type
      WHERE LEFT(mp.his_type, 2) = 'PT'
        AND mp.amtthismth > 0
      GROUP BY mp.his_type, et.elmDesc
      ORDER BY total_amount DESC
    `;

    const [allowances] = await pool.query(query);

    const totalAllowances = allowances.reduce((sum, a) => sum + parseFloat(a.total_amount), 0);

    res.json({
      success: true,
      data: {
        period: { year: period.year, month: period.month },
        allowances,
        totalAllowances,
        allowanceCount: allowances.length
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// 11. CONTROL SHEET REPORT - DATA ENDPOINT
exports.getControlSheet = async (req, res) => {
  try {
    await checkCalculationsComplete();
    const period = await getCurrentPeriod();

    const query = `
      SELECT 
        ts.cyear as year,
        ts.pmonth as month,
        CASE ts.pmonth
          WHEN 1 THEN 'January' WHEN 2 THEN 'February' WHEN 3 THEN 'March'
          WHEN 4 THEN 'April' WHEN 5 THEN 'May' WHEN 6 THEN 'June'
          WHEN 7 THEN 'July' WHEN 8 THEN 'August' WHEN 9 THEN 'September'
          WHEN 10 THEN 'October' WHEN 11 THEN 'November' WHEN 12 THEN 'December'
        END as month_name,
        COUNT(*) as recordcount,
        ts.type1 as payment_type,
        COALESCE(et.elmDesc, ts.desc1) as payment_description,
        CASE 
          WHEN LEFT(ts.type1, 2) IN ('BP', 'BT', 'PT', 'FP') THEN 'DR'
          WHEN LEFT(ts.type1, 2) IN ('PR', 'PL', 'PY') THEN 'CR'
          ELSE 'DR'
        END as dr_cr_indicator,
        CASE 
          WHEN LEFT(ts.type1, 2) IN ('BP', 'BT', 'PT', 'FP') 
          THEN ROUND(SUM(ts.amt1), 2)
          ELSE 0.00
        END as dr_amount,
        CASE 
          WHEN ts.type1 = 'PY01' THEN ROUND(SUM(ts.net), 2)
          WHEN ts.type1 = 'PY02' THEN ROUND(SUM(ts.tax), 2)
          WHEN ts.type1 = 'PY03' THEN ROUND(SUM(ts.roundup), 2)
          WHEN LEFT(ts.type1, 2) IN ('PR', 'PL') THEN ROUND(SUM(ts.amt2), 2)
          ELSE 0.00
        END as cr_amount,
        COALESCE(ts.ledger1, '') as ledger_code,
        CASE 
          WHEN LEFT(ts.type1, 2) IN ('BP', 'BT') THEN 1
          WHEN LEFT(ts.type1, 2) = 'PT' THEN 2
          WHEN LEFT(ts.type1, 2) = 'FP' THEN 3
          WHEN LEFT(ts.type1, 2) = 'PR' THEN 4
          WHEN LEFT(ts.type1, 2) = 'PL' THEN 5
          WHEN LEFT(ts.type1, 2) = 'PY' THEN 6
          ELSE 7
        END as sort_order
      FROM py_tempsumm ts
      LEFT JOIN py_elementType et ON et.PaymentType = ts.type1
      WHERE (ts.amt1 != 0 OR ts.amt2 != 0 OR ts.tax != 0 OR ts.net != 0 OR ts.roundup != 0)
      GROUP BY ts.cyear, ts.pmonth, ts.type1, ts.desc1, et.elmDesc, ts.ledger1, dr_cr_indicator, sort_order
      ORDER BY sort_order, ts.type1
    `;

    const [controlData] = await pool.query(query);

    // Calculate totals
    const totalDR = controlData.reduce((sum, row) => sum + parseFloat(row.dr_amount || 0), 0);
    const totalCR = controlData.reduce((sum, row) => sum + parseFloat(row.cr_amount || 0), 0);
    const variance = Math.abs(totalDR - totalCR);

    // Group by category
    const byCategory = {
      basic_salary: [],
      allowances: [],
      fringe_benefits: [],
      deductions: [],
      loans: [],
      payments: []
    };

    controlData.forEach(row => {
      const prefix = row.payment_type.substring(0, 2);
      if (prefix === 'BP' || prefix === 'BT') {
        byCategory.basic_salary.push(row);
      } else if (prefix === 'PT') {
        byCategory.allowances.push(row);
      } else if (prefix === 'FP') {
        byCategory.fringe_benefits.push(row);
      } else if (prefix === 'PR') {
        byCategory.deductions.push(row);
      } else if (prefix === 'PL') {
        byCategory.loans.push(row);
      } else if (prefix === 'PY') {
        byCategory.payments.push(row);
      }
    });

    res.json({
      success: true,
      data: {
        period: { year: period.year, month: period.month },
        controlData,
        byCategory,
        summary: {
          totalDR,
          totalCR,
          variance,
          isBalanced: variance < 0.01
        }
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Helper functions
function getColumnsForReport(reportType) {
  const columns = {
    bank: [
      { header: 'Svc No.', key: 'employee_id', width: 15 },
      { header: 'Full Name', key: 'full_name', width: 30 },
      { header: 'Bank Code', key: 'bankcode', width: 15 },
      { header: 'Account Number', key: 'bankacnumber', width: 20 },
      { header: 'Net Pay', key: 'net_pay', width: 15 }
    ],
    // ... other report columns
  };
  return columns[reportType] || [];
}


module.exports = exports;


