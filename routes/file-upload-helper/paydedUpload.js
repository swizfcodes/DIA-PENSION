// batchDeductionUploadRoutes.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const XLSX = require('xlsx');
const ExcelJS = require('exceljs');
const csv = require('csv-parser');
const fs = require('fs');
const path = require('path');
const pool = require('../../config/db'); // mysql2 pool
const verifyToken = require('../../middware/authentication');

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'batch-deduction-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowedExtensions = ['.xlsx', '.xls', '.csv'];
    const ext = path.extname(file.originalname).toLowerCase();
    
    if (allowedExtensions.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only .xlsx, .xls, and .csv files are allowed'));
    }
  }
});

// Field mapping from Excel/CSV headers to database columns
const FIELD_MAPPING = {
  'Service Number': 'Empl_id',
  'Payment Type': 'type',
  'Amount Payable': 'amtp',
  'Payment Indicator': 'payind',
  'Ternor': 'nomth'
};

// Helper function to parse Excel file
function parseExcelFile(filePath) {
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(worksheet);
  return data;
}

// Helper function to parse CSV file
function parseCSVFile(filePath) {
  return new Promise((resolve, reject) => {
    const results = [];
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (data) => results.push(data))
      .on('end', () => resolve(results))
      .on('error', (error) => reject(error));
  });
}

// Helper function to map fields
function mapFields(row, defaultCreatedBy) {
  const mappedRow = {};
  
  Object.keys(row).forEach(key => {
    const trimmedKey = key.trim();
    const dbField = FIELD_MAPPING[trimmedKey];
    
    if (dbField) {
      let value = row[key];
      
      // Trim string values
      if (typeof value === 'string') {
        value = value.trim();
      }
      
      // Convert numeric strings to numbers for amount fields
      if (dbField === 'amtp' && value) {
        value = parseFloat(value) || 0;
      }
      
      // Convert numeric strings to integers for nomth
      if (dbField === 'nomth' && value) {
        value = parseInt(value) || 0;
      }
      
      mappedRow[dbField] = value || null;
    }
  });
  
  // Set defaults
  mappedRow.mak1 = '';
  mappedRow.mak2 = '';
  mappedRow.amt = 0;
  mappedRow.amttd = 0;
  if (!mappedRow.nomth) mappedRow.nomth = 0;
  mappedRow.createdby = defaultCreatedBy; // Always use the dynamic value from req.user_fullname
  
  return mappedRow;
}

// Validate required fields
function validateRow(row, rowIndex) {
  const errors = [];
  const requiredFields = ['Empl_id', 'type', 'amtp', 'payind'];
  
  requiredFields.forEach(field => {
    if (!row[field] || row[field].toString().trim() === '') {
      errors.push(`Row ${rowIndex + 2}: Missing required field "${field}"`);
    }
  });
  
  // Validate numeric fields
  if (row.amtp && (isNaN(row.amtp) || row.amtp < 0)) {
    errors.push(`Row ${rowIndex + 2}: Invalid amount payable (amtp)`);
  }
  
  // Validate nomth
  if (row.nomth && (isNaN(row.nomth) || row.nomth < 0)) {
    errors.push(`Row ${rowIndex + 2}: Invalid ternor value (nomth)`);
  }
  
  return errors;
}

// Check for duplicate deductions in DB
async function checkDuplicates(deductions) {
  if (deductions.length === 0) return [];
  
  const conditions = deductions.map(() => '(Empl_id = ? AND type = ?)').join(' OR ');
  const values = deductions.flatMap(d => [d.Empl_id, d.type]);
  
  const query = `
    SELECT Empl_id, type 
    FROM py_payded 
    WHERE ${conditions}
  `;
  
  const [results] = await pool.query(query, values);
  return results.map(row => `${row.Empl_id}-${row.type}`);
}

// Insert deduction record
async function insertDeduction(data) {
  const query = `
    INSERT INTO py_payded (
      Empl_id, type, mak1, amtp, mak2, amt, amttd, payind, nomth, createdby, datecreated
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
  `;
  
  const [result] = await pool.query(query, [
    data.Empl_id,
    data.type,
    data.mak1,
    data.amtp,
    data.mak2,
    data.amt,
    data.amttd,
    data.payind,
    data.nomth,
    data.createdby
  ]);
  
  return result;
}

// POST: Batch upload endpoint
router.post('/batch-upload', verifyToken, upload.single('file'), async (req, res) => {
  let filePath = null;

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    filePath = req.file.path;
    const fileExt = path.extname(req.file.originalname).toLowerCase();
    const createdBy = req.user_fullname || 'SYSTEM';

    console.log('📤 Uploaded by:', createdBy);

    // Parse file
    let rawData;
    if (fileExt === '.csv') {
      rawData = await parseCSVFile(filePath);
    } else {
      rawData = parseExcelFile(filePath);
    }

    if (!rawData || rawData.length === 0) {
      return res.status(400).json({ error: 'File is empty or invalid' });
    }

    // Validate rows
    const validationErrors = [];
    const mappedData = rawData.map((row, index) => {
      const mapped = mapFields(row, createdBy);
      const errors = validateRow(mapped, index);
      validationErrors.push(...errors);
      return mapped;
    });

    if (validationErrors.length > 0) {
      return res.status(400).json({
        error: 'Validation failed',
        details: validationErrors
      });
    }

    // Check for duplicates (Empl_id + type combination)
    const duplicateKeys = await checkDuplicates(mappedData);

    // Filter out duplicates
    const uniqueData = mappedData.filter(row => {
      const key = `${row.Empl_id}-${row.type}`;
      return !duplicateKeys.includes(key);
    });

    const results = {
      totalRecords: mappedData.length,
      duplicates: duplicateKeys,
      inserted: uniqueData.length,
      successful: 0,
      failed: 0,
      errors: []
    };

    // Insert only unique deductions
    for (let i = 0; i < uniqueData.length; i++) {
      try {
        await insertDeduction(uniqueData[i]);
        results.successful++;
      } catch (error) {
        results.failed++;
        results.errors.push({
          row: i + 2,
          serviceNumber: uniqueData[i].Empl_id,
          deductionType: uniqueData[i].type,
          error: error.message
        });
      }
    }

    // Add duplicates to failed count
    results.failed += results.duplicates.length;

    // Push duplicates as soft errors for frontend visibility
    if (results.duplicates.length > 0) {
      results.errors.push(
        ...results.duplicates.map(key => {
          const [emplId, type] = key.split('-');
          return {
            row: null,
            serviceNumber: emplId,
            deductionType: type,
            error: 'Already exists (duplicate)'
          };
        })
      );
    }

    // Clean up file
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    return res.status(200).json({
      message: 'Batch payment and deduction upload completed',
      summary: results
    });

  } catch (error) {
    console.error('Batch payment and deduction upload error:', error);
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);

    return res.status(500).json({
      error: 'Batch payment and deduction upload failed',
      details: error.message
    });
  }
});

// GET: Download sample template with ExcelJS
router.get('/batch-template', verifyToken, async (req, res) => {
  try {
    // Create workbook and worksheet
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Payment-Deductions', {
      views: [{ state: 'frozen', ySplit: 4 }] // Freeze first 4 rows
    });
    
    // Add main header - Row 1
    worksheet.mergeCells('A1:E1');
    const mainHeader = worksheet.getCell('A1');
    mainHeader.value = 'DEFENCE INTELLIGENCE AGENCY';
    mainHeader.font = { name: 'Arial', size: 13, bold: true, color: { argb: 'FFFFFFFF' } };
    mainHeader.alignment = { horizontal: 'center', vertical: 'middle' };
    mainHeader.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1F784E' } // Dark navy blue
    };
    mainHeader.border = {
      bottom: { style: 'thin', color: { argb: 'FF000000' } }
    };
    worksheet.getRow(1).height = 22;
    
    // Add sub header - Row 2
    worksheet.mergeCells('A2:E2');
    const subHeader = worksheet.getCell('A2');
    subHeader.value = 'ASOKORO - ABUJA - DEFENCE INTELIGENCE AGENCY';
    subHeader.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FF000000' } };
    subHeader.alignment = { horizontal: 'center', vertical: 'middle' };
    subHeader.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFD9D9D9' } // Medium gray
    };
    subHeader.border = {
      bottom: { style: 'thin', color: { argb: 'FF000000' } }
    };
    worksheet.getRow(2).height = 18;
    
    // Empty row 3
    worksheet.getRow(3).height = 5;
    
    // Column headers - Row 4
    const headers = [
      'Svc. No.',
      'Payment Type',
      'Amount Payable',
      'Payment Indicator',
      'Ternor'
    ];
    
    const headerRow = worksheet.getRow(4);
    headers.forEach((header, index) => {
      const cell = headerRow.getCell(index + 1);
      cell.value = header;
      cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF2E8A5C' } // Darker blue
      };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FF000000' } },
        left: { style: 'thin', color: { argb: 'FFFFFFFF' } },
        bottom: { style: 'thin', color: { argb: 'FF000000' } },
        right: { style: 'thin', color: { argb: 'FFFFFFFF' } }
      };
    });
    headerRow.height = 19.5;
    
    // Sample data - Row 5
    const sampleData = [
      '00NA/01/0001', // Service Number
      'PT330',        // Payment Type
      '5000.00',      // Amount Payable
      'T',            // Payment Indicator
      '12'            // Ternor
    ];
    
    const dataRow = worksheet.getRow(5);
    sampleData.forEach((value, index) => {
      const cell = dataRow.getCell(index + 1);
      cell.value = value;
      cell.font = { name: 'Arial', size: 10 };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFD3D3D3' } },
        left: { style: 'thin', color: { argb: 'FFD3D3D3' } },
        bottom: { style: 'thin', color: { argb: 'FFD3D3D3' } },
        right: { style: 'thin', color: { argb: 'FFD3D3D3' } }
      };
    });
    dataRow.height = 22;
    
    // Add a few more empty rows with borders
    for (let rowNum = 6; rowNum <= 10; rowNum++) {
      const emptyRow = worksheet.getRow(rowNum);
      headers.forEach((_, index) => {
        const cell = emptyRow.getCell(index + 1);
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFD3D3D3' } },
          left: { style: 'thin', color: { argb: 'FFD3D3D3' } },
          bottom: { style: 'thin', color: { argb: 'FFD3D3D3' } },
          right: { style: 'thin', color: { argb: 'FFD3D3D3' } }
        };
      });
      emptyRow.height = 22;
    }
    
    // Set column widths
    worksheet.columns = [
      { key: 'serviceNumber', width: 18 },
      { key: 'paymentType', width: 18 },
      { key: 'amountPayable', width: 18 },
      { key: 'paymentIndicator', width: 18 },
      { key: 'ternor', width: 15 }
    ];
    
    // Add data validation
    // Payment Indicator column (D)
    worksheet.getCell('D5').dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: ['"T,P"'],
      showErrorMessage: true,
      errorTitle: 'Invalid Payment Indicator',
      error: 'Please select T (Temporary) or P (Permanent)'
    };
    
    // Add instructions sheet
    const instructionsSheet = workbook.addWorksheet('Instructions');
    
    instructionsSheet.mergeCells('A1:D1');
    const instrHeader = instructionsSheet.getCell('A1');
    instrHeader.value = 'INSTRUCTIONS FOR FILLING THE PAYMENT & DEDUCTIONS TEMPLATE';
    instrHeader.font = { size: 13, bold: true, color: { argb: 'FFFFFFFF' } };
    instrHeader.alignment = { horizontal: 'center', vertical: 'middle' };
    instrHeader.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1F4E78' }
    };
    instructionsSheet.getRow(1).height = 25;
    instructionsSheet.getRow(2).height = 10;
    
    const instructions = [
      '1. Do not modify the header rows (rows 1-4)',
      '2. Fill data starting from row 5',
      '3. Service Number: Employee service number (e.g., 00NA/01/0001)',
      '4. Payment Type: Valid payment type code (e.g., PT330)',
      '5. Amount Payable: Numeric value (e.g., 5000.00)',
      '6. Payment Indicator: T (Temporary) or P (Permanent)',
      '7. Ternor: Number of months (e.g., 12)',
      '8. All fields are required',
    ];
    
    instructions.forEach((instruction, index) => {
      const cell = instructionsSheet.getCell(`A${index + 3}`);
      cell.value = instruction;
      cell.font = { name: 'Arial', size: 11 };
      cell.alignment = { horizontal: 'left', vertical: 'middle' };
    });
    
    instructionsSheet.getColumn('A').width = 70;
    
    // Generate Excel file
    const buffer = await workbook.xlsx.writeBuffer();
    
    // Send file
    res.setHeader('Content-Disposition', 'attachment; filename=payment-deductions_template.xlsx');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
    
  } catch (error) {
    console.error('Error generating template:', error);
    res.status(500).json({ success: false, error: 'Failed to generate template' });
  }
});

// GET: Batch upload history
router.get('/batch-history', verifyToken, async (req, res) => {
  try {
    const query = `
      SELECT 
        id,
        filename,
        total_records,
        successful_records,
        failed_records,
        uploaded_by,
        upload_date,
        status
      FROM tblBatchDeductionUploads
      ORDER BY upload_date DESC
      LIMIT 50
    `;
    
    const [results] = await pool.query(query);
    
    return res.status(200).json({
      success: true,
      data: results
    });
    
  } catch (error) {
    console.error('Failed to fetch batch history:', error);
    return res.status(500).json({ 
      error: 'Failed to fetch batch history',
      details: error.message 
    });
  }
});

// Error handling middleware
router.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File size exceeds 10MB limit' });
    }
    return res.status(400).json({ error: error.message });
  }
  
  if (error) {
    return res.status(400).json({ error: error.message });
  }
  
  next();
});

module.exports = router;