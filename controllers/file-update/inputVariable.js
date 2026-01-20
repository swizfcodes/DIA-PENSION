const pool = require('../../config/db');
const inputVariables = require('../../services/file-update/inputVariable');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');


// POST - Process input variables (first time only, updates stage 775 -> 777)
exports.inputVariables = async (req, res) => {
  try {
    // Get BT05 processing period
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
    
    // Validation: Ensure previous stage completed (personnel changes must be ready)
    if (sun < 775) {
      return res.status(400).json({ 
        status: 'FAILED',
        error: 'Personnel changes must be processed first.',
        currentStage: sun,
        requiredStage: 775
      });
    }
    
    // Validation: Prevent re-processing (already processed)
    if (sun > 775) {
      return res.status(400).json({ 
        status: 'FAILED',
        error: 'Input variable report already processed. Use /view endpoint to retrieve data.',
        currentStage: sun
      });
    }

    const user = req.user?.fullname || req.user_fullname || 'System Auto';
    
    // Call the service to retrieve input variables
    const result = await inputVariables.getInputVariables(year, month, user);

    // Update BT05 stage marker to 777 (input variables ready)
    await pool.query(
      "UPDATE py_stdrate SET sun = 777, createdby = ? WHERE type = 'BT05'", 
      [user]
    );

    res.json({
      status: 'SUCCESS',
      stage: 777,
      progress: 'Input variables processed',
      nextStage: 'Master File Update',
      processedAt: new Date().toISOString(),
      summary: result.summary,
      records: result.records
    });
  } catch (err) {
    console.error('Error in input variable processing:', err);
    res.status(500).json({ 
      status: 'FAILED', 
      message: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
};

// GET - View input variables (stage must be >= 777)
exports.getInputVariablesView = async (req, res) => {
  try {
    const [bt05Rows] = await pool.query(
      "SELECT ord AS year, mth AS month, sun FROM py_stdrate WHERE type='BT05' LIMIT 1"
    );

    if (!bt05Rows.length) {
      return res.status(404).json({ 
        status: 'FAILED', 
        error: 'BT05 not found' 
      });
    }

    const { year, month, sun } = bt05Rows[0];

    if (sun < 777) {
      return res.status(400).json({ 
        status: 'FAILED',
        error: 'Input variables are not ready for viewing (must be stage 777 or higher).',
        currentStage: sun,
        requiredStage: 777
      });
    }

    const user = req.user?.fullname || req.user_fullname || 'System Auto';
    const result = await inputVariables.getInputVariables(year, month, user);

    res.json({
      status: 'SUCCESS',
      stage: sun,
      progress: 'Input variables retrieved for viewing',
      processedAt: new Date().toISOString(),
      summary: result.summary,
      records: result.records
    });
  } catch (err) {
    console.error('Error fetching input variables for view:', err);
    res.status(500).json({ 
      status: 'FAILED', 
      message: err.message 
    });
  }
};

// GET - Loan records only
exports.getLoanRecords = async (req, res) => {
  try {
    const [bt05Rows] = await pool.query(
      "SELECT ord AS year, mth AS month, sun FROM py_stdrate WHERE type='BT05' LIMIT 1"
    );
    
    if (!bt05Rows.length) {
      return res.status(404).json({ 
        status: 'FAILED',
        error: 'BT05 not found' 
      });
    }

    const { year, month, sun } = bt05Rows[0];

    if (sun < 777) {
      return res.status(400).json({ 
        status: 'FAILED',
        error: 'Input variables must be processed first.',
        currentStage: sun,
        requiredStage: 777
      });
    }

    const user = req.user?.fullname || req.user_fullname || 'System Auto';
    
    const result = await inputVariables.getInputVariablesByIndicator('LOAN', year, month, user);

    res.json({
      status: 'SUCCESS',
      indicator: 'LOAN',
      totalRecords: result.totalRecords,
      records: result.records
    });
  } catch (err) {
    console.error('Error getting loan records:', err);
    res.status(500).json({ 
      status: 'FAILED', 
      message: err.message 
    });
  }
};

// Export handlers for Excel
exports.exportInputVariablesExcel = async (req, res) => {
  try {
    const [bt05Rows] = await pool.query(
      "SELECT ord AS year, mth AS month FROM py_stdrate WHERE type='BT05' LIMIT 1"
    );
    if (!bt05Rows.length) {
      return res.status(404).json({ error: 'BT05 not found' });
    }

    const { year, month } = bt05Rows[0];

    const [rows] = await pool.query(`
      SELECT * FROM vw_input_variables
      ORDER BY full_name, pay_type
    `);

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Input Variables');

    // Header section
    worksheet.mergeCells('A1:N1');
    const titleRow = worksheet.getRow(1);
    titleRow.getCell(1).value = 'INPUT VARIABLES REPORT';
    titleRow.getCell(1).font = { size: 16, bold: true, color: { argb: 'FF0070C0' } };
    titleRow.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
    titleRow.height = 30;

    worksheet.mergeCells('A2:N2');
    const periodRow = worksheet.getRow(2);
    periodRow.getCell(1).value = `Period: ${month}/${year}`;
    periodRow.getCell(1).font = { size: 12, bold: true };
    periodRow.getCell(1).alignment = { horizontal: 'center' };

    worksheet.mergeCells('A3:N3');
    const dateRow = worksheet.getRow(3);
    const generatedDate = new Date();
    dateRow.getCell(1).value = `Generated: ${generatedDate.toLocaleDateString('en-NG', { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })}`;
    dateRow.getCell(1).font = { size: 10, italic: true };
    dateRow.getCell(1).alignment = { horizontal: 'center' };

    worksheet.addRow([]);

    // Table Headers
    const headerRow = worksheet.addRow([
      'Employee ID',
      'Full Name',
      'Location',
      'Pay Type',
      'Pay Description',
      'Function Type',
      'Pay Indicator',
      'MAK1',
      'AMTP (₦)',
      'MAK2',
      'AMT (₦)',
      'AMTAD',
      'AMTTD (₦)',
      'NOMTH'
    ]);

    // Style header row
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF0070C0' }
    };
    headerRow.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    headerRow.height = 20;

    // Set column widths
    worksheet.columns = [
      { key: 'empl_id', width: 15 },
      { key: 'full_name', width: 39 },
      { key: 'location', width: 20 },
      { key: 'pay_type', width: 12 },
      { key: 'element', width: 41 },
      { key: 'function', width: 19 },
      { key: 'indicator', width: 18 },
      { key: 'mak1', width: 12 },
      { key: 'amtp', width: 14 },
      { key: 'mak2', width: 12 },
      { key: 'amt', width: 14 },
      { key: 'amtad', width: 12 },
      { key: 'amttd', width: 14 },
      { key: 'nomth', width: 10 }
    ];

    // Data rows
    let totalAmt = 0;
    let totalAmtp = 0;
    let totalAmttd = 0;

    rows.forEach((row, index) => {
      totalAmt += row.amt || 0;
      totalAmtp += row.amtp || 0;
      totalAmttd += row.amttd || 0;

      const dataRow = worksheet.addRow({
        empl_id: row.Empl_id,
        full_name: row.full_name,
        location: row.Location,
        pay_type: row.pay_type,
        element: row.element_name,
        function: row.function_type_desc,
        indicator: row.pay_indicator_desc,
        mak1: row.mak1,
        amtp: row.amtp || 0,
        mak2: row.mak2,
        amt: row.amt || 0,
        amtad: row.amtad,
        amttd: row.amttd || 0,
        nomth: row.nomth
      });

      // Format currency columns
      [10, 12, 13].forEach(colNum => {
        dataRow.getCell(colNum).numFmt = '₦#,##0.00';
      });

      // Alternate row colors
      const rowFill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: index % 2 === 0 ? 'FFF5F5F5' : 'FFFFFFFF' }
      };
      
      dataRow.eachCell({ includeEmpty: true }, (cell) => {
        cell.fill = rowFill;
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFD3D3D3' } },
          left: { style: 'thin', color: { argb: 'FFD3D3D3' } },
          bottom: { style: 'thin', color: { argb: 'FFD3D3D3' } },
          right: { style: 'thin', color: { argb: 'FFD3D3D3' } }
        };
        cell.alignment = { horizontal: 'left', vertical: 'middle' };
      });

      // Highlight deductions
      if (row.amtad === 'Deduct') {
        dataRow.getCell(13).font = { bold: true, color: { argb: 'FFFF0000' } };
      }
    });

    // Add borders to header
    headerRow.eachCell({ includeEmpty: true }, (cell) => {
      cell.border = {
        top: { style: 'medium', color: { argb: 'FF000000' } },
        left: { style: 'medium', color: { argb: 'FF000000' } },
        bottom: { style: 'medium', color: { argb: 'FF000000' } },
        right: { style: 'medium', color: { argb: 'FF000000' } }
      };
    });

    // Summary section
    const summaryStartRow = worksheet.lastRow.number + 3;
    
    worksheet.mergeCells(`A${summaryStartRow}:N${summaryStartRow}`);
    const summaryTitleRow = worksheet.getRow(summaryStartRow);
    summaryTitleRow.getCell(1).value = 'SUMMARY';
    summaryTitleRow.getCell(1).font = { size: 14, bold: true, color: { argb: 'FF0070C0' } };
    summaryTitleRow.getCell(1).alignment = { horizontal: 'center' };
    summaryTitleRow.height = 25;

    const summaryData = [
      ['Total Records:', rows.length]
    ];

    summaryData.forEach((data, index) => {
      const summaryRow = worksheet.getRow(summaryStartRow + 1 + index);
      summaryRow.getCell(1).value = data[0];
      summaryRow.getCell(1).font = { bold: true };
      summaryRow.getCell(2).value = data[1];
      
      if (index > 0) {
        summaryRow.getCell(2).numFmt = '₦#,##0.00';
      }
      
      if (index === summaryData.length - 1) {
        summaryRow.getCell(2).font = { bold: true, size: 12, color: { argb: 'FF0070C0' } };
      }
      
      summaryRow.getCell(1).border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      };
      summaryRow.getCell(2).border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      };
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=input_variables_${year}_${month}.xlsx`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('Excel export error:', err);
    res.status(500).json({ error: err.message });
  }
};

// Export handler for PDF
exports.exportInputVariablesPdf = async (req, res) => {
  try {
    const [bt05Rows] = await pool.query(
      "SELECT ord AS year, mth AS month FROM py_stdrate WHERE type='BT05' LIMIT 1"
    );
    if (!bt05Rows.length) {
      return res.status(404).json({ error: 'BT05 not found' });
    }

    const { year, month } = bt05Rows[0];

    const [rows] = await pool.query(`
      SELECT * FROM vw_input_variables
      ORDER BY full_name, pay_type
    `);

    const doc = new PDFDocument({ 
      margin: 20, 
      size: 'A3',
      layout: 'landscape'
    });
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=input_variables_${year}_${month}.pdf`);
    
    doc.pipe(res);

    // Helper function to format currency
    const formatCurrency = (amount) => {
      return `₦${(amount || 0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    };

    // Header
    doc.fontSize(14).font('Helvetica-Bold').fillColor('#0070C0').text('INPUT VARIABLES REPORT', { align: 'center' });
    doc.fillColor('black');
    doc.fontSize(10).font('Helvetica').text(`Period: ${month}/${year}`, { align: 'center' });
    
    const generatedDate = new Date();
    const formattedDate = generatedDate.toLocaleDateString('en-NG', { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
    doc.fontSize(8).font('Helvetica-Oblique').text(`Generated: ${formattedDate}`, { align: 'center' });
    doc.moveDown(1);

    // Table setup
    const tableTop = doc.y;
    const rowHeight = 20;
    const colWidths = [50, 120, 80, 50, 120, 80, 80, 90, 50, 60, 50, 60, 50, 60, 40];
    const colPositions = [];
    let xPos = 20;
    colWidths.forEach(width => {
      colPositions.push(xPos);
      xPos += width;
    });

    // Table headers
    const headers = [
      'Empl ID', 'Name', 'Location', 'Pay Type', 'Element', 'Function', 
      'Indicator', 'Category', 'MAK1', 'AMTP(₦)', 'MAK2', 'AMT(₦)', 
      'AMTAD', 'AMTTD(₦)', 'NOMTH'
    ];
    
    doc.fontSize(7).font('Helvetica-Bold').fillColor('white');
    doc.rect(20, tableTop, colPositions[colPositions.length - 1] + colWidths[colWidths.length - 1] - 20, 18)
       .fill('#0070C0');
    
    doc.fillColor('white');
    headers.forEach((header, i) => {
      doc.text(header, colPositions[i] + 2, tableTop + 4, {
        width: colWidths[i] - 4,
        align: 'center'
      });
    });

    let currentY = tableTop + 18;

    rows.forEach((row, index) => {
      if (currentY > 520) {
        doc.addPage();
        currentY = 30;
        
        // Redraw header on new page
        doc.fontSize(7).font('Helvetica-Bold').fillColor('white');
        doc.rect(20, currentY, colPositions[colPositions.length - 1] + colWidths[colWidths.length - 1] - 20, 18)
           .fill('#0070C0');
        
        doc.fillColor('white');
        headers.forEach((header, i) => {
          doc.text(header, colPositions[i] + 2, currentY + 4, {
            width: colWidths[i] - 4,
            align: 'center'
          });
        });
        currentY += 18;
      }

      // Alternate row background
      const bgColor = index % 2 === 0 ? '#F9F9F9' : '#FFFFFF';
      doc.rect(20, currentY, colPositions[colPositions.length - 1] + colWidths[colWidths.length - 1] - 20, rowHeight)
         .fill(bgColor);

      doc.fillColor('black').font('Helvetica').fontSize(6);

      const cellY = currentY + 6;
      
      // Data array
      const cellData = [
        { text: row.Empl_id || '', align: 'left' },
        { text: row.full_name || '', align: 'left' },
        { text: row.Location || '', align: 'left' },
        { text: row.pay_type || '', align: 'left' },
        { text: row.element_name || '', align: 'left' },
        { text: row.function_type_desc || '', align: 'left' },
        { text: row.pay_indicator_desc || '', align: 'left' },
        { text: row.element_category || '', align: 'left' },
        { text: row.mak1 || '', align: 'left' },
        { text: formatCurrency(row.amtp), align: 'right' },
        { text: row.mak2 || '', align: 'left' },
        { text: formatCurrency(row.amt), align: 'right' },
        { text: row.amtad || '', align: 'left' },
        { text: formatCurrency(row.amttd), align: 'right' },
        { text: row.nomth || '', align: 'left' }
      ];

      // Render each cell
      cellData.forEach((cell, i) => {
        // Highlight deductions
        if (i === 12 && row.amtad === 'Deduct') {
          doc.font('Helvetica-Bold').fillColor('red');
        } else {
          doc.font('Helvetica').fillColor('black');
        }

        doc.text(cell.text, colPositions[i] + 2, cellY, { 
          width: colWidths[i] - 4,
          align: cell.align,
          lineBreak: false
        });
      });

      // Draw cell borders
      doc.strokeColor('#CCCCCC').lineWidth(0.5);
      colPositions.forEach((pos, i) => {
        doc.rect(pos, currentY, colWidths[i], rowHeight).stroke();
      });

      currentY += rowHeight;
    });

    doc.end();
  } catch (err) {
    console.error('PDF export error:', err);
    res.status(500).json({ error: err.message });
  }
};


