const express = require('express');
const router = express.Router();
const pool = require('../../../config/db.js');
const verifyToken = require('../../../middware/authentication.js');
const ExcelJS = require('exceljs');

// Batch processing size
const BATCH_SIZE = 500;

// ============================================
// POST /generate-excel-report - Generate grouped Excel report
// ============================================
router.post('/generate-excel-report', verifyToken, async (req, res) => {
  try {
    const {
      payrollClass,
      reportType = 'bank',  // 'bank', 'analysis', 'remittance', 'summary'
      specificType = null,
      allClasses = false,
      ubaUpload = false,
      ippis = false
    } = req.body;

    if (!payrollClass && !allClasses) {
      return res.status(400).json({
        success: false,
        message: 'Payroll class is required'
      });
    }

    // Get payroll class description for display
    let classDescription = payrollClass;
    if (payrollClass) {
      const [classInfo] = await pool.query(
        'SELECT classname FROM py_payrollclass WHERE classcode = ?',
        [payrollClass]
      );
      if (classInfo.length > 0) {
        classDescription = classInfo[0].classname;
      }
    }

    const workStation = req.user_fullname || req.user_email || req.user_id;

    // Handle summary report differently
    if (reportType === 'summary') {
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'Nigerian Navy Central Pay Office';
      workbook.created = new Date();

      await generateSummaryExcel(workbook, payrollClass, classDescription);

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename=oneoff_summary_${Date.now()}.xlsx`);
      await workbook.xlsx.write(res);
      res.end();
      return;
    }

    // Get employees with calculations
    let employeeQuery = `
      SELECT DISTINCT
        e.EMPL_ID, e.surname, e.othername, e.Title,
        e.bankcode, e.bankbranch, e.BankACNumber, e.gsm_number, e.payrollclass
      FROM hr_employees e
      INNER JOIN py_calculation c ON e.EMPL_ID = c.his_empno
    `;

    const employeeParams = [];

    if (!allClasses) {
      employeeQuery += ' WHERE e.payrollclass = ?';
      employeeParams.push(payrollClass);
    }

    if (specificType) {
      employeeQuery += allClasses ? ' WHERE' : ' AND';
      employeeQuery += ' c.his_type = ?';
      employeeParams.push(specificType);
    }

    employeeQuery += ' ORDER BY e.bankcode, e.bankbranch, e.EMPL_ID';

    const [employees] = await pool.query(employeeQuery, employeeParams);

    // Build report data in memory (replaces py_tempbankoneoff)
    const reportData = [];

    for (let i = 0; i < employees.length; i += BATCH_SIZE) {
      const batch = employees.slice(i, i + BATCH_SIZE);

      for (const emp of batch) {
        const bankCode   = emp.bankcode   || 'miscode';
        const branchCode = emp.bankbranch || '000';

        const [bankInfo] = await pool.query(
          `SELECT bankname, branchname, cbn_code, cbn_branch 
           FROM py_bank 
           WHERE bankcode = ? AND branchcode = ?`,
          [bankCode, branchCode]
        );

        const bankName   = bankInfo[0]?.bankname   || 'Unknown Bank';
        const branchName = bankInfo[0]?.branchname || 'Unknown Branch';
        const cbnCode    = bankInfo[0]?.cbn_code   || '';
        const cbnBranch  = bankInfo[0]?.cbn_branch || '';

        // Get calculations with proper description from py_elementtype
        let calcQuery = `
          SELECT 
            c.his_type, 
            c.amtthismth, 
            COALESCE(et.elmdesc, ot.one_type, '') as one_desc
          FROM py_calculation c
          LEFT JOIN py_oneofftype ot ON c.his_type = ot.one_type
          LEFT JOIN py_elementtype et ON c.his_type = et.paymenttype
          WHERE c.his_empno = ?
        `;

        const calcParams = [emp.EMPL_ID];

        if (specificType) {
          calcQuery += ' AND c.his_type = ?';
          calcParams.push(specificType);
        }

        const [calculations] = await pool.query(calcQuery, calcParams);

        for (const calc of calculations) {
          reportData.push({
            work_station: workStation,
            empno:        emp.EMPL_ID,
            one_type:     calc.his_type,
            one_desc:     calc.one_desc,
            title:        emp.Title,
            surname:      emp.surname,
            othername:    emp.othername,
            bankname:     bankName,
            bankbranch:   branchName,
            acctno:       emp.BankACNumber,
            cbn_bank:     cbnCode,
            cbn_branch:   cbnBranch,
            net:          calc.amtthismth,
            rec_count:    0,
            payrollclass: emp.payrollclass,
            gsm_number:   emp.gsm_number
          });
        }
      }
    }

    // Generate Excel
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Nigerian Navy Central Pay Office';
    workbook.created = new Date();

    if (reportType === 'bank') {
      await generateBankGroupedExcel(workbook, reportData, classDescription, ippis);
    } else if (reportType === 'analysis') {
      await generateAnalysisGroupedExcel(workbook, reportData, classDescription);
    } else if (reportType === 'remittance') {
      await generateRemittanceExcel(workbook, reportData, classDescription);
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=oneoff_${reportType}_${Date.now()}.xlsx`);
    await workbook.xlsx.write(res);
    res.end();

  } catch (err) {
    console.error('❌ Error generating Excel report:', err.message);
    res.status(500).json({
      success: false,
      message: 'Failed to generate report',
      error: err.message
    });
  }
});

// ============================================
// POST /generate-pdf-report - Generate grouped PDF report using HTML
// ============================================
router.post('/generate-pdf-report', verifyToken, async (req, res) => {
  try {
    const workStation = req.user_fullname || req.user_email || req.user_id;
    const { reportType = 'bank', payrollClass } = req.body;

    // Get payroll class description
    let classDescription = 'OFFICERS';
    if (payrollClass) {
      const [classInfo] = await pool.query(
        'SELECT classname FROM py_payrollclass WHERE classcode = ?',
        [payrollClass]
      );
      if (classInfo.length > 0) {
        classDescription = classInfo[0].classname;
      }
    }

    // Handle summary report
    if (reportType === 'summary') {
      const html = await generateSummaryPDFHTML(payrollClass, classDescription);

      const puppeteer = require('puppeteer');
      const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });

      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });

      const pdfBuffer = await page.pdf({
        format: 'A4',
        landscape: true,
        printBackground: true,
        timeout: 60000,
        margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' }
      });

      await browser.close();

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=oneoff_summary_${Date.now()}.pdf`);
      res.send(pdfBuffer);
      return;
    }

    // Fetch report data directly from live tables
    const [reportData] = await pool.query(
      `SELECT
        e.EMPL_ID as empno, e.surname, e.othername, e.Title as title,
        e.BankACNumber as acctno,
        b.bankname, b.branchname as bankbranch,
        c.his_type as one_type,
        COALESCE(et.elmdesc, ot.one_type, '') as one_desc,
        c.amtthismth as net
       FROM py_calculation c
       INNER JOIN hr_employees e ON c.his_empno = e.EMPL_ID
       LEFT JOIN py_bank b ON e.bankcode = b.bankcode AND e.bankbranch = b.branchcode
       LEFT JOIN py_oneofftype ot ON c.his_type = ot.one_type
       LEFT JOIN py_elementtype et ON c.his_type = et.paymenttype
       WHERE e.payrollclass = ?
       ORDER BY b.bankname, b.branchname, e.EMPL_ID`,
      [payrollClass]
    );

    if (reportData.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No data found. Please generate report data first.'
      });
    }

    // Group data based on report type
    let groups = [];
    if (reportType === 'bank') {
      const groupMap = {};
      reportData.forEach(row => {
        const key = `${row.bankname.toUpperCase()}|${row.bankbranch.toUpperCase()}`;
        if (!groupMap[key]) {
          groupMap[key] = { bankname: row.bankname, bankbranch: row.bankbranch, records: [] };
        }
        groupMap[key].records.push(row);
      });

      groups = Object.values(groupMap).map(group => {
        const employeeMap = {};
        group.records.forEach(record => {
          if (!employeeMap[record.empno]) {
            employeeMap[record.empno] = {
              empno: record.empno, surname: record.surname, othername: record.othername,
              title: record.title, acctno: record.acctno, net: 0
            };
          }
          employeeMap[record.empno].net += parseFloat(record.net);
        });
        const aggregatedRecords = Object.values(employeeMap);
        return {
          type: 'bank',
          bankname:   group.bankname,
          bankbranch: group.bankbranch,
          records:    aggregatedRecords,
          total:      aggregatedRecords.reduce((sum, r) => sum + r.net, 0)
        };
      });

    } else if (reportType === 'analysis') {
      const groupMap = {};
      reportData.forEach(row => {
        if (!groupMap[row.one_type]) {
          groupMap[row.one_type] = { one_type: row.one_type, one_desc: row.one_desc, records: [] };
        }
        groupMap[row.one_type].records.push(row);
      });
      groups = Object.values(groupMap).map(group => ({
        type:     'analysis',
        one_type: group.one_type,
        one_desc: group.one_desc,
        records:  group.records,
        total:    group.records.reduce((sum, r) => sum + parseFloat(r.net), 0)
      }));

    } else if (reportType === 'remittance') {
      const employeeMap = {};
      reportData.forEach(record => {
        if (!employeeMap[record.empno]) {
          employeeMap[record.empno] = {
            empno: record.empno, surname: record.surname, othername: record.othername,
            title: record.title, acctno: record.acctno,
            bankname: record.bankname, bankbranch: record.bankbranch, net: 0
          };
        }
        employeeMap[record.empno].net += parseFloat(record.net);
      });
      const aggregatedData = Object.values(employeeMap);
      groups = [{
        type:       'remittance',
        bankname:   aggregatedData[0]?.bankname   || 'CASH',
        bankbranch: aggregatedData[0]?.bankbranch || '',
        records:    aggregatedData,
        total:      aggregatedData.reduce((sum, r) => sum + r.net, 0)
      }];
    }

    const html = generatePDFHTML(groups, reportType, classDescription);

    const puppeteer = require('puppeteer');
    const browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });

    const pdfBuffer = await page.pdf({
      format: 'A4',
      landscape: false,
      printBackground: true,
      timeout: 60000,
      margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' }
    });

    await browser.close();

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=oneoff_${reportType}_${Date.now()}.pdf`);
    res.send(pdfBuffer);

  } catch (err) {
    console.error('❌ Error generating PDF report:', err.message);
    res.status(500).json({
      success: false,
      message: 'Failed to generate PDF',
      error: err.message
    });
  }
});

// ============================================
// Helper: Generate Bank Grouped Excel (AGGREGATED PER EMPLOYEE)
// ============================================
async function generateBankGroupedExcel(workbook, data, classDescription, ippis = false) {
  const groups = {};

  data.forEach(row => {
    const key = `${row.bankname.toUpperCase()}|${row.bankbranch.toUpperCase()}`;
    if (!groups[key]) {
      groups[key] = {
        bankname:   row.bankname,
        bankbranch: row.bankbranch,
        cbn_bank:   row.cbn_bank,
        cbn_branch: row.cbn_branch,
        records:    []
      };
    }
    groups[key].records.push(row);
  });

  const sheetNames = new Map();

  Object.values(groups).forEach((group) => {
    const employeeMap = {};
    group.records.forEach(record => {
      if (!employeeMap[record.empno]) {
        employeeMap[record.empno] = {
          empno: record.empno, surname: record.surname, othername: record.othername,
          title: record.title, acctno: record.acctno, net: 0
        };
      }
      employeeMap[record.empno].net += parseFloat(record.net);
    });

    const aggregatedRecords = Object.values(employeeMap);

    const cleanBankName   = group.bankname.trim().toUpperCase();
    const cleanBranchName = group.bankbranch.trim().toUpperCase();

    let sheetName = `${cleanBankName}-${cleanBranchName}`
      .replace(/[\\\/\?\*\[\]]/g, '')
      .substring(0, 31);

    let finalSheetName = sheetName;
    let counter = 2;
    while (sheetNames.has(finalSheetName)) {
      const suffix = `-${counter}`;
      finalSheetName = sheetName.substring(0, 31 - suffix.length) + suffix;
      counter++;
    }
    sheetNames.set(finalSheetName, true);

    const worksheet = workbook.addWorksheet(finalSheetName);

    worksheet.mergeCells('A1:F1');
    worksheet.getCell('A1').value = 'DEFENCE INTELLIGENCE AGENCY';
    worksheet.getCell('A1').font = { bold: true, size: 14 };
    worksheet.getCell('A1').alignment = { horizontal: 'center' };

    worksheet.mergeCells('A2:F2');
    worksheet.getCell('A2').value = 'PAYMENTS BY BANK - DETAILED (ONE-OFF)';
    worksheet.getCell('A2').font = { bold: true, size: 12 };
    worksheet.getCell('A2').alignment = { horizontal: 'center' };

    const totalAmount   = aggregatedRecords.reduce((sum, r) => sum + r.net, 0);
    const employeeCount = aggregatedRecords.length;

    worksheet.mergeCells('A3:F3');
    worksheet.getCell('A3').value = `Bank: ${group.bankname} | Branch: ${group.bankbranch} | Employees: ${employeeCount} | Total: ₦${totalAmount.toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;
    worksheet.getCell('A3').font = { bold: true, size: 11 };
    worksheet.getCell('A3').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };

    const headerRow = worksheet.getRow(5);
    headerRow.values = ['S/N', 'Svc No.', 'Full Name', 'Rank', 'Net Payment', 'Account Number'];
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } };
    headerRow.alignment = { horizontal: 'center', vertical: 'middle' };
    headerRow.height = 20;

    worksheet.views = [{ state: 'frozen', xSplit: 0, ySplit: 5 }];
    worksheet.columns = [
      { key: 'sn',     width: 8  },
      { key: 'empno',  width: 15 },
      { key: 'name',   width: 35 },
      { key: 'rank',   width: 12 },
      { key: 'net',    width: 18 },
      { key: 'acctno', width: 18 }
    ];

    let sn = 1;
    aggregatedRecords.forEach(record => {
      const row = worksheet.addRow({
        sn:     sn++,
        empno:  record.empno,
        name:   `${record.surname} ${record.othername}`,
        rank:   record.title,
        net:    record.net,
        acctno: record.acctno
      });
      row.getCell(5).numFmt = '₦#,##0.00';
    });

    const totalRow = worksheet.addRow({ sn: '', empno: '', name: 'TOTAL', rank: '', net: totalAmount, acctno: '' });
    totalRow.font = { bold: true };
    totalRow.getCell(5).numFmt = '₦#,##0.00';
    totalRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFEB3B' } };
  });
}

// ============================================
// Helper: Generate Analysis Grouped Excel (by Payment Type)
// ============================================
async function generateAnalysisGroupedExcel(workbook, data, classDescription) {
  const groups = {};

  data.forEach(row => {
    if (!groups[row.one_type]) {
      groups[row.one_type] = { one_type: row.one_type, one_desc: row.one_desc, records: [] };
    }
    groups[row.one_type].records.push(row);
  });

  Object.values(groups).forEach((group) => {
    const sheetName  = `${group.one_type} - ${group.one_desc || ''}`.substring(0, 31);
    const worksheet  = workbook.addWorksheet(sheetName);
    const totalAmount = group.records.reduce((sum, r) => sum + parseFloat(r.net), 0);

    worksheet.mergeCells('A1:D1');
    worksheet.getCell('A1').value = 'DEFENCE INTELLIGENCE AGENCY';
    worksheet.getCell('A1').font = { bold: true, size: 14 };
    worksheet.getCell('A1').alignment = { horizontal: 'center' };

    worksheet.mergeCells('A2:D2');
    worksheet.getCell('A2').value = 'ANALYSIS OF EARNINGS & DEDUCTIONS (ONE-OFF)';
    worksheet.getCell('A2').font = { bold: true, size: 12 };
    worksheet.getCell('A2').alignment = { horizontal: 'center' };

    worksheet.mergeCells('A3:D3');
    worksheet.getCell('A3').value = `${group.one_type} - ${group.one_desc || 'N/A'} | ${group.records.length} Personnel | Total: ₦${totalAmount.toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;
    worksheet.getCell('A3').font = { bold: true, size: 11 };
    worksheet.getCell('A3').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };

    const headerRow = worksheet.getRow(5);
    headerRow.values = ['Service No.', 'Full Name', 'Rank', 'Amount'];
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } };
    headerRow.alignment = { horizontal: 'center', vertical: 'middle' };
    headerRow.height = 20;

    worksheet.views   = [{ state: 'frozen', xSplit: 0, ySplit: 5 }];
    worksheet.columns = [
      { key: 'empno',  width: 15 },
      { key: 'name',   width: 35 },
      { key: 'rank',   width: 12 },
      { key: 'amount', width: 18 }
    ];

    group.records.forEach(record => {
      const row = worksheet.addRow({
        empno:  record.empno,
        name:   `${record.surname} ${record.othername}`,
        rank:   record.title,
        amount: parseFloat(record.net)
      });
      row.getCell(4).numFmt = '₦#,##0.00';
    });

    const totalRow = worksheet.addRow({ empno: '', name: 'TOTAL', rank: '', amount: totalAmount });
    totalRow.font = { bold: true };
    totalRow.getCell(4).numFmt = '₦#,##0.00';
    totalRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFEB3B' } };
  });
}

// ============================================
// Helper: Generate Remittance Excel
// ============================================
async function generateRemittanceExcel(workbook, data, classDescription) {
  const employeeMap = {};

  data.forEach(record => {
    if (!employeeMap[record.empno]) {
      employeeMap[record.empno] = {
        empno: record.empno, surname: record.surname, othername: record.othername,
        title: record.title, acctno: record.acctno,
        bankname: record.bankname, bankbranch: record.bankbranch, net: 0
      };
    }
    employeeMap[record.empno].net += parseFloat(record.net);
  });

  const aggregatedData = Object.values(employeeMap);
  const worksheet      = workbook.addWorksheet('Remittance Advice');
  const totalAmount    = aggregatedData.reduce((sum, r) => sum + r.net, 0);

  worksheet.mergeCells('A1:E1');
  worksheet.getCell('A1').value = 'DEFENCE INTELLIGENCE AGENCY';
  worksheet.getCell('A1').font  = { bold: true, size: 14 };
  worksheet.getCell('A1').alignment = { horizontal: 'center' };

  worksheet.mergeCells('A2:E2');
  worksheet.getCell('A2').value = 'SALARY CREDIT VOUCHER LISTING (ONE-OFF)';
  worksheet.getCell('A2').font  = { bold: true, size: 12 };
  worksheet.getCell('A2').alignment = { horizontal: 'center' };

  worksheet.mergeCells('A3:E3');
  worksheet.getCell('A3').value = `${aggregatedData[0]?.bankname || 'CASH'} (${aggregatedData[0]?.bankbranch || ''}) - ${aggregatedData.length} Personnel | Total: ₦${totalAmount.toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;
  worksheet.getCell('A3').font  = { bold: true };
  worksheet.getCell('A3').fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };

  const headerRow = worksheet.getRow(5);
  headerRow.values = ['Svc No.', 'Full Name', 'Rank', 'Net Payment', 'Account Number'];
  headerRow.font   = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } };

  worksheet.views   = [{ state: 'frozen', xSplit: 0, ySplit: 5 }];
  worksheet.columns = [
    { key: 'empno',  width: 15 },
    { key: 'name',   width: 35 },
    { key: 'rank',   width: 12 },
    { key: 'net',    width: 18 },
    { key: 'acctno', width: 20 }
  ];

  aggregatedData.forEach(record => {
    const row = worksheet.addRow({
      empno:  record.empno,
      name:   `${record.surname} ${record.othername}`,
      rank:   record.title,
      net:    record.net,
      acctno: record.acctno
    });
    row.getCell(4).numFmt = '₦#,##0.00';
  });
}

// ============================================
// Helper: Generate Summary Excel
// ============================================
async function generateSummaryExcel(workbook, payrollClass, classDescription) {
  const [summaryData] = await pool.query(
    `SELECT 
      c.his_type as payment_type,
      COALESCE(et.elmdesc, ot.one_type, '') as description,
      COUNT(DISTINCT c.his_empno) as employee_count,
      SUM(c.amtthismth) as total_amount
    FROM py_calculation c
    LEFT JOIN py_oneofftype ot ON c.his_type = ot.one_type
    LEFT JOIN py_elementtype et ON c.his_type = et.paymenttype
    INNER JOIN hr_employees e ON c.his_empno = e.EMPL_ID
    WHERE e.payrollclass = ?
    GROUP BY c.his_type, et.elmdesc, ot.one_type
    ORDER BY c.his_type`,
    [payrollClass]
  );

  const worksheet = workbook.addWorksheet('Summary');

  worksheet.mergeCells('A1:D1');
  worksheet.getCell('A1').value = 'DEFENCE INTELLIGENCE AGENCY';
  worksheet.getCell('A1').font  = { bold: true, size: 14 };
  worksheet.getCell('A1').alignment = { horizontal: 'center' };

  worksheet.mergeCells('A2:D2');
  worksheet.getCell('A2').value = 'ONE-OFF PAYMENTS SUMMARY';
  worksheet.getCell('A2').font  = { bold: true, size: 12 };
  worksheet.getCell('A2').alignment = { horizontal: 'center' };

  worksheet.mergeCells('A3:D3');
  worksheet.getCell('A3').value = `Payroll Class: ${classDescription}`;
  worksheet.getCell('A3').font  = { bold: true, size: 11 };
  worksheet.getCell('A3').fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };

  const headerRow = worksheet.getRow(5);
  headerRow.values = ['Payment Type', 'Description', 'Employees', 'Total Amount'];
  headerRow.font   = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } };
  headerRow.alignment = { horizontal: 'center', vertical: 'middle' };
  headerRow.height = 20;

  worksheet.views   = [{ state: 'frozen', xSplit: 0, ySplit: 5 }];
  worksheet.columns = [
    { key: 'type',   width: 15 },
    { key: 'desc',   width: 40 },
    { key: 'count',  width: 15 },
    { key: 'amount', width: 20 }
  ];

  let grandTotal = 0;
  summaryData.forEach(record => {
    const row = worksheet.addRow({
      type:   record.payment_type,
      desc:   record.description,
      count:  record.employee_count,
      amount: parseFloat(record.total_amount)
    });
    row.getCell(4).numFmt = '₦#,##0.00';
    grandTotal += parseFloat(record.total_amount);
  });

  const totalRow = worksheet.addRow({ type: '', desc: 'GRAND TOTAL', count: '', amount: grandTotal });
  totalRow.font = { bold: true };
  totalRow.getCell(4).numFmt = '₦#,##0.00';
  totalRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFEB3B' } };
}

// ============================================
// Helper: Load logo as base64
// ============================================
function getLogoDataUrl() {
  try {
    const fs   = require('fs');
    const path = require('path');
    const logoPath = path.join(__dirname, '../../../public/photos/logo.png');

    if (fs.existsSync(logoPath)) {
      console.log('✅ Logo file found!');
      const logoBase64 = fs.readFileSync(logoPath).toString('base64');
      return `data:image/png;base64,${logoBase64}`;
    }
  } catch (err) {
    console.error('❌ Error loading logo:', err.message);
  }
  return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
}

// ============================================
// Helper: Generate PDF HTML Template
// ============================================
function generatePDFHTML(groups, reportType, classDescription) {
  const now = new Date();
  const formatDate = (date) => new Date(date).toLocaleDateString('en-GB',  { day: 'numeric', month: 'long', year: 'numeric' });
  const formatTime = (date) => new Date(date).toLocaleTimeString('en-GB',  { hour: '2-digit', minute: '2-digit' });

  const logoDataUrl = getLogoDataUrl();

  let contentHTML = '';

  groups.forEach((group, index) => {
    const pageBreakClass = index === 0 ? '' : 'page-break';

    if (reportType === 'bank') {
      contentHTML += `
        <div class="bank-group${pageBreakClass ? ' ' + pageBreakClass : ''}">
          <div class="bank-header">
            ${group.bankname} (${group.bankbranch}) - ${group.records.length} Personnel | Total: ₦${group.total.toLocaleString('en-NG', { minimumFractionDigits: 2 })}
          </div>
          <table class="details">
            <thead>
              <tr>
                <th style="width: 15%;">Svc. No.</th>
                <th style="width: 35%;">Full Name</th>
                <th style="width: 15%;">Rank</th>
                <th class="amount" style="width: 20%;">Net Payment</th>
                <th style="width: 20%;">Account Number</th>
              </tr>
            </thead>
            <tbody>
              ${group.records.map(record => `
                <tr>
                  <td class="emp-id">${record.empno}</td>
                  <td>${record.surname} ${record.othername}</td>
                  <td>${record.title}</td>
                  <td class="amount">₦${record.net.toLocaleString('en-NG', { minimumFractionDigits: 2 })}</td>
                  <td class="account-no">${record.acctno || ''}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    } else if (reportType === 'analysis') {
      contentHTML += `
        <div class="bank-group${pageBreakClass ? ' ' + pageBreakClass : ''}">
          <div class="bank-header">
            ${group.one_type} - ${group.one_desc || 'N/A'} | ${group.records.length} Personnel | Total: ₦${group.total.toLocaleString('en-NG', { minimumFractionDigits: 2 })}
          </div>
          <table class="details">
            <thead>
              <tr>
                <th style="width: 15%;">Service No.</th>
                <th style="width: 40%;">Full Name</th>
                <th style="width: 15%;">Rank</th>
                <th class="amount" style="width: 30%;">Amount</th>
              </tr>
            </thead>
            <tbody>
              ${group.records.map(record => `
                <tr>
                  <td class="emp-id">${record.empno}</td>
                  <td>${record.surname} ${record.othername}</td>
                  <td>${record.title}</td>
                  <td class="amount">₦${parseFloat(record.net).toLocaleString('en-NG', { minimumFractionDigits: 2 })}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    } else if (reportType === 'remittance') {
      contentHTML += `
        <div class="bank-group${pageBreakClass ? ' ' + pageBreakClass : ''}">
          <div class="bank-header">
            ${group.bankname} (${group.bankbranch}) - ${group.records.length} Personnel | Total: ₦${group.total.toLocaleString('en-NG', { minimumFractionDigits: 2 })}
          </div>
          <table class="details">
            <thead>
              <tr>
                <th style="width: 15%;">Svc. No.</th>
                <th style="width: 35%;">Full Name</th>
                <th style="width: 15%;">Rank</th>
                <th class="amount" style="width: 20%;">Net Payment</th>
                <th style="width: 15%;">Account Number</th>
              </tr>
            </thead>
            <tbody>
              ${group.records.map(record => `
                <tr>
                  <td class="emp-id">${record.empno}</td>
                  <td>${record.surname} ${record.othername}</td>
                  <td>${record.title}</td>
                  <td class="amount">₦${record.net.toLocaleString('en-NG', { minimumFractionDigits: 2 })}</td>
                  <td class="account-no">${record.acctno || ''}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    }
  });

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        @page { size: A4 portrait; margin: 10mm; background-color: #f8fbff; }
        body { font-family: Helvetica, Arial, sans-serif; font-size: 9pt; margin: 0; padding: 0; }

        body::before {
          content: "";
          position: fixed;
          top: 0; left: 0; width: 100%; height: 100%;
          background-image: url('${logoDataUrl}');
          background-size: auto 100%;
          background-repeat: no-repeat;
          background-position: center center;
          opacity: 0.02;
          z-index: -1;
          pointer-events: none;
        }

        .header-wrapper {
          display: flex; align-items: flex-start;
          margin-bottom: 5px; border-bottom: 2px solid #1a1a1a; padding-bottom: 3px;
        }
        .className { flex-shrink: 0; margin-right: 20px; align-self: center; font-size: 9pt; }
        .header { flex-grow: 1; text-align: center; }
        .header h1 {
          font-size: 13pt; font-weight: bold; margin: 0 0 2px 0;
          letter-spacing: 1.5px; color: #15803d;
          font-family: 'Libre Baskerville', Georgia, serif;
        }
        .header h2 {
          font-size: 10pt; font-weight: normal; margin: 2px 0 0 0;
          color: #4a4a4a; font-family: 'Libre Baskerville', Georgia, serif;
        }
        .header-info {
          display: flex; justify-content: space-between; align-items: center;
          margin: 5px 0 10px 0; font-size: 9pt;
        }
        .bank-group { margin-bottom: 15px; page-break-inside: auto; }
        .bank-group:first-of-type { page-break-before: avoid; }
        .bank-group.page-break { page-break-before: always; }
        .bank-header {
          padding: 10px; color: #15803d; font-weight: bold; font-size: 11pt;
          text-align: center; border-bottom: .5px solid #e0e0e0;
          page-break-after: avoid; page-break-before: avoid;
        }
        table.details { width: 100%; border-collapse: collapse; margin: 10px 0; page-break-before: avoid; }
        table.details th {
          padding: 7px; color: #15803d; text-align: left; font-size: 8.5pt;
          font-weight: 600; border-bottom: solid 1px #15803d;
          background-color: rgba(30, 64, 175, 0.05);
        }
        table.details td { padding: 5px 6px; border-bottom: 1px solid #e0e0e0; font-size: 8.5pt; }
        table.details tbody tr:hover { background-color: rgba(30, 64, 175, 0.02); }
        .emp-id     { font-family: 'Courier New', monospace; font-weight: 600; }
        .amount     { font-family: 'Courier New', monospace; font-weight: 600; text-align: right; }
        .account-no { font-family: 'Courier New', monospace; font-weight: 600; }
        .footer     { margin-top: 20px; padding-top: 5px; border-top: 0.5px solid #1a1a1a; text-align: center; font-size: 8pt; color: #64748b; }

        @media print {
          body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
          body::before {
            content: "";
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background-image: url('${logoDataUrl}');
            background-size: auto 100%; background-repeat: no-repeat;
            background-position: center center; opacity: 0.02;
            z-index: -1; pointer-events: none;
          }
        }
      </style>
    </head>
    <body>
      <div class="header-wrapper">
        <div class="className">${classDescription}</div>
        <div class="header">
          <h1>DEFENCE INTELLIGENCE AGENCY</h1>
          <h2>ASOKORO - ABUJA - DEFENCE INTELIGENCE</h2>
        </div>
      </div>

      <div class="header-info">
        <div class="left">
          ${reportType === 'bank' ? 'SALARY CREDIT VOUCHER LISTING (ONE-OFF)' : reportType === 'analysis' ? 'ANALYSIS OF EARNINGS & DEDUCTIONS (ONE-OFF)' : 'SALARY CREDIT VOUCHER LISTING (ONE-OFF)'}
        </div>
        <div class="center">
          <span>PRODUCED ON</span>
          <strong>${formatDate(now)}</strong>
          <span>AT</span>
          <strong>${formatTime(now)}</strong>
        </div>
        <div class="period-info">
          FOR PERIOD: ${now.toLocaleString('en-US', { month: 'long', year: 'numeric' })}
        </div>
      </div>

      ${contentHTML}

      <div class="footer">
        <p>All rights reserved &#xA9; Hicad Systems Limited.</p>
      </div>
    </body>
    </html>
  `;
}

// ============================================
// Helper: Generate Summary PDF HTML
// ============================================
async function generateSummaryPDFHTML(payrollClass, classDescription) {
  const [summaryData] = await pool.query(
    `SELECT 
      c.his_type as payment_type,
      COALESCE(et.elmdesc, ot.one_type, '') as description,
      COUNT(DISTINCT c.his_empno) as employee_count,
      SUM(c.amtthismth) as total_amount
    FROM py_calculation c
    LEFT JOIN py_oneofftype ot ON c.his_type = ot.one_type
    LEFT JOIN py_elementtype et ON c.his_type = et.paymenttype
    INNER JOIN hr_employees e ON c.his_empno = e.EMPL_ID
    WHERE e.payrollclass = ?
    GROUP BY c.his_type, et.elmdesc, ot.one_type
    ORDER BY c.his_type`,
    [payrollClass]
  );

  const grandTotal  = summaryData.reduce((sum, r) => sum + parseFloat(r.total_amount), 0);
  const now         = new Date();
  const logoDataUrl = getLogoDataUrl();

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        @page { size: A4 portrait; margin: 10mm; background-color: #f8fbff; }
        body { font-family: Helvetica, Arial, sans-serif; font-size: 9pt; margin: 0; padding: 0; }

        body::before {
          content: "";
          position: fixed; top: 0; left: 0; width: 100%; height: 100%;
          background-image: url('${logoDataUrl}');
          background-size: auto 100%; background-repeat: no-repeat;
          background-position: center center; opacity: 0.02;
          z-index: -1; pointer-events: none;
        }

        .header-wrapper {
          display: flex; align-items: flex-start;
          margin-bottom: 8px; border-bottom: 2px solid #1a1a1a; padding-bottom: 5px;
        }
        .className { flex-shrink: 0; margin-right: 20px; align-self: center; font-size: 9pt; }
        .header { flex-grow: 1; text-align: center; }
        .header h1 {
          font-size: 13pt; font-weight: bold; margin: 0 0 2px 0;
          letter-spacing: 1.5px; color: #15803d;
          font-family: 'Libre Baskerville', Georgia, serif;
        }
        .header h2 {
          font-size: 10pt; font-weight: normal; margin: 2px 0 0 0;
          color: #4a4a4a; font-family: 'Libre Baskerville', Georgia, serif;
        }
        .header-info {
          display: flex; justify-content: space-between; align-items: center;
          margin: 10px 0 20px 0; font-size: 9pt;
        }
        table.summary { width: 100%; border-collapse: collapse; margin: 20px 0; }
        table.summary th {
          padding: 10px; color: #15803d; text-align: left; font-size: 9pt;
          font-weight: 600; border-bottom: solid 2px #15803d;
          background-color: rgba(30, 64, 175, 0.05);
        }
        table.summary td { padding: 8px; border-bottom: 1px solid #e0e0e0; font-size: 9pt; }
        .amount    { font-family: 'Courier New', monospace; font-weight: 600; text-align: right; }
        .total-row { background-color: #ffffeb; font-weight: bold; }
        .footer    { margin-top: 20px; padding-top: 5px; border-top: 0.5px solid #1a1a1a; text-align: center; font-size: 8pt; color: #64748b; }
      </style>
    </head>
    <body>
      <div class="header-wrapper">
        <div class="className">${classDescription}</div>
        <div class="header">
          <h1>DEFENCE INTELLIGENCE AGENCY</h1>
          <h2>ASOKORO - ABUJA - DEFENCE INTELIGENCE</h2>
        </div>
      </div>

      <div class="header-info">
        <div class="left">ONE-OFF PAYMENTS SUMMARY</div>
        <div class="center">
          <span>PRODUCED ON</span>
          <strong>${now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</strong>
          <span>AT</span>
          <strong>${now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</strong>
        </div>
        <div class="period-info">
          FOR PERIOD: ${now.toLocaleString('en-US', { month: 'long', year: 'numeric' })}
        </div>
      </div>

      <table class="summary">
        <thead>
          <tr>
            <th>Payment Type</th>
            <th>Description</th>
            <th style="text-align: center;">Employees</th>
            <th class="amount">Total Amount</th>
          </tr>
        </thead>
        <tbody>
          ${summaryData.map(record => `
            <tr>
              <td>${record.payment_type}</td>
              <td>${record.description}</td>
              <td style="text-align: center;">${record.employee_count}</td>
              <td class="amount">₦${parseFloat(record.total_amount).toLocaleString('en-NG', { minimumFractionDigits: 2 })}</td>
            </tr>
          `).join('')}
          <tr class="total-row">
            <td colspan="2">GRAND TOTAL</td>
            <td></td>
            <td class="amount">₦${grandTotal.toLocaleString('en-NG', { minimumFractionDigits: 2 })}</td>
          </tr>
        </tbody>
      </table>

      <div class="footer">
        <p>All rights reserved &#xA9; Hicad Systems Limited.</p>
      </div>
    </body>
    </html>
  `;
}

module.exports = router;