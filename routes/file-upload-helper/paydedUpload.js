// batchDeductionUploadRoutes.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const XLSX = require('xlsx');
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
  'Maker 1': 'mak1',
  'Amount Payable': 'amtp',
  'Maker 2': 'mak2',
  'Amount': 'amt',
  //'Amount Action': 'amtad',
  'Amount To Date': 'amttd',
  'Payment Indicator': 'payind',
  'Number of Months': 'nomth',
  //'Created By': 'createdby'
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
      if (['amtp', 'amt', 'amttd'].includes(dbField) && value) {
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
  if (!mappedRow.mak1) mappedRow.mak1 = 'No';
  if (!mappedRow.mak2) mappedRow.mak2 = 'No';
  if (!mappedRow.amt && mappedRow.amtp) mappedRow.amt = 0;
  //if (!mappedRow.amtad) mappedRow.amtad = 0;
  if (!mappedRow.amttd) mappedRow.amttd = 0;
  if (!mappedRow.nomth) mappedRow.nomth = 0;
  if (!mappedRow.createdby) mappedRow.createdby = defaultCreatedBy;
  
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
  
  // Validate mak1 and mak2 values
  if (row.mak1 && !['Yes', 'No'].includes(row.mak1)) {
    errors.push(`Row ${rowIndex + 2}: Invalid mak1 value (must be Yes or No)`);
  }
  
  if (row.mak2 && !['Yes', 'No'].includes(row.mak2)) {
    errors.push(`Row ${rowIndex + 2}: Invalid mak2 value (must be Yes or No)`);
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
    //data.amtad,
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

// GET: Download sample template
router.get('/batch-template', verifyToken, (req, res) => {
  const headers = Object.keys(FIELD_MAPPING);
  
  // Create sample data
  const sampleData = [{
    'Service Number': 'NN001',
    'Payment Type': 'PT330',
    'Maker 1': 'No',
    'Amount Payable': '5000.00',
    'Maker 2': 'No',
    'Amount': '5000.00',
    //'Amount Already Deducted': '0.00',
    'Amount To Date': '0.00',
    'Payment Indicator': 'T',
    'Number of Months': '12',
    'Created By': 'Admin'
  }];
  
  // Create workbook
  const worksheet = XLSX.utils.json_to_sheet(sampleData);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Payment-Deductions');
  
  // Generate buffer
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  
  // Send file
  res.setHeader('Content-Disposition', 'attachment; filename=payment-deductions_template.xlsx');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buffer);
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


