// batchUploadRoutes.js
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
    cb(null, 'batch-' + uniqueSuffix + path.extname(file.originalname));
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

// =============================================================================
// HELPER FUNCTION: Get Payroll Class from Current Database
// =============================================================================
/**
 * Maps database name to payroll class number
 * @param {string} dbName - Current database name
 * @returns {string} Payroll class (1-6)
 */
function getPayrollClassFromDb(dbName) {
  const classMapping = {
    [process.env.DB_OFFICERS]: '1',
    [process.env.DB_WOFFICERS]: '2',
    [process.env.DB_RATINGS]: '3',
    [process.env.DB_RATINGS_A]: '4',
    [process.env.DB_RATINGS_B]: '5',
    [process.env.DB_JUNIOR_TRAINEE]: '6'
  };
  
  const result = classMapping[dbName] || '1';
  console.log('🔍 Database:', dbName, '→ Payroll Class:', result);
  return result;
}

// Field mapping from Excel/CSV headers to database columns
const FIELD_MAPPING = {
  'Svc. No.': 'Empl_ID',
  'Rank': 'Title',
  'Surname': 'Surname',
  'Other Name': 'OtherName',
  'Date of Birth': 'Birthdate',
  'State Of Origin': 'StateofOrigin',
  'Local Government': 'LocalGovt',
  'Town': 'town',
  'Residential Address': 'HOMEADDR',
  'Email Address': 'email',
  'GSM Number': 'gsm_number',
  'Sex': 'Sex',
  'Marital Status': 'MaritalStatus',
  'Religion': 'religion',
  'Date Joined': 'DateEmpl',
  'Date Commissioned': 'dateconfirmed',
  'Entry Mode': 'entry_mode',
  'Date Left': 'DateLeft',
  'Exit Mode': 'exittype',
  'Taxed': 'taxed',
  'TaxID No': 'TaxCode',
  'Tax State': 'state',
  'RSA Code': 'NSITFcode',
  'PFA Code': 'pfacode',
  'Payroll Class': 'payrollclass',
  'Salary Grade': 'gradelevel',
  'Salary Group': 'gradetype',
  'Bank Branch': 'bankbranch',
  'Account Number': 'BankACNumber',
  'Seniority Date': 'datepmted',
  'Location': 'Location',
  'Factory': 'Factory',
  'Command': 'command',
  'Specialisation': 'specialisation',
  'Job Title': 'Jobtitle',
  'Award': 'award',
  'Emolument Form': 'emolumentform',
  'NHF Code': 'NHFcode',
  'Bank Code': 'Bankcode',
  'IPPIS NO': 'InternalACNo',
  'Country': 'Country',
  'Accommodation Type': 'accomm_type',
  'Rent Subsidy': 'rent_subsidy',
  'Emol. Form': 'emolumentform',
};

// Helper: Convert Excel serial date to YYYYMMDD
function excelDateToYYYYMMDD(serial) {
  if (!serial || isNaN(serial)) return null;
  
  const excelEpoch = new Date(Date.UTC(1899, 11, 30));
  const date = new Date(excelEpoch.getTime() + serial * 86400000);
  
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  
  return `${year}${month}${day}`;
}

// Helper: Format date to YYYYMMDD
function formatDateToYYYYMMDD(dateValue) {
  if (!dateValue) return null;
  
  try {
    // Handle Excel serial number
    if (typeof dateValue === 'number') {
      return excelDateToYYYYMMDD(dateValue);
    }
    
    // Handle string dates
    if (typeof dateValue === 'string') {
      const trimmed = dateValue.trim();
      
      // Already in YYYYMMDD format
      if (/^\d{8}$/.test(trimmed)) {
        return trimmed;
      }
      
      // DD/MM/YYYY format
      const ddmmyyyy = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (ddmmyyyy) {
        const day = ddmmyyyy[1].padStart(2, '0');
        const month = ddmmyyyy[2].padStart(2, '0');
        const year = ddmmyyyy[3];
        return `${year}${month}${day}`;
      }
      
      // YYYY-MM-DD format
      const yyyymmdd = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
      if (yyyymmdd) {
        const year = yyyymmdd[1];
        const month = yyyymmdd[2].padStart(2, '0');
        const day = yyyymmdd[3].padStart(2, '0');
        return `${year}${month}${day}`;
      }
    }
    
    console.warn('⚠️ Could not parse date:', dateValue);
    return null;
    
  } catch (error) {
    console.error('❌ Date formatting error:', error);
    return null;
  }
}

// Parse Excel file
function parseExcelFile(filePath) {
  const workbook = XLSX.readFile(filePath, { cellDates: false });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  
  const allData = XLSX.utils.sheet_to_json(worksheet, { 
    header: 1,
    raw: true, // Keep numbers as numbers
    defval: ''
  });
  
  const headers = allData[3];
  
  if (!headers || headers.length === 0) {
    throw new Error('No headers found in row 4');
  }
  
  console.log('📋 Detected headers:', headers);
  
  const dataRows = allData.slice(4);
  
  const data = dataRows
    .filter(row => {
      if (!row || row.length === 0) return false;
      return row.some(cell => cell !== null && cell !== undefined && cell !== '');
    })
    .map((row) => {
      const obj = {};
      headers.forEach((header, colIndex) => {
        if (header && header.toString().trim() !== '') {
          const cellValue = row[colIndex];
          // Keep the raw value (number or string)
          obj[header.toString().trim()] = cellValue !== null && cellValue !== undefined 
            ? cellValue 
            : '';
        }
      });
      return obj;
    });
  
  console.log('✅ Parsed data rows:', data.length);
  return data;
}

// Parse CSV file
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

// Map fields
function mapFields(row, createdBy, payrollClass) {
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
      
      // Format dates
      if (['Birthdate', 'DateEmpl', 'datepmted'].includes(dbField)) {
        value = formatDateToYYYYMMDD(value);
      }
      
      mappedRow[dbField] = value || null;
    }
  });
  
  // Set system fields
  mappedRow.createdby = createdBy;
  mappedRow.payrollclass = payrollClass;
  mappedRow.datecreated = new Date().toISOString().slice(0, 19).replace('T', ' ');
  
  return mappedRow;
}

// Validate row
function validateRow(row, rowIndex) {
  const errors = [];
  const requiredFields = ['Empl_ID', 'Surname', 'OtherName'];
  
  requiredFields.forEach(field => {
    if (!row[field] || row[field].toString().trim() === '') {
      errors.push(`Row ${rowIndex + 5}: Missing required field "${field}"`);
    }
  });
  
  return errors;
}

// Check duplicates
async function checkDuplicates(personnelList) {
  if (personnelList.length === 0) return [];
  
  const emplIds = personnelList.map(p => p.Empl_ID);
  const placeholders = emplIds.map(() => '?').join(',');
  
  const query = `
    SELECT Empl_ID 
    FROM hr_employees 
    WHERE Empl_ID IN (${placeholders})
  `;
  
  const [results] = await pool.query(query, emplIds);
  return results.map(row => row.Empl_ID);
}

// Insert personnel
async function insertPersonnel(data) {
  const fields = Object.keys(data);
  const values = Object.values(data);
  const placeholders = fields.map(() => '?').join(', ');
  
  const query = `
    INSERT INTO hr_employees (${fields.join(', ')}) 
    VALUES (${placeholders})
  `;
  
  const [result] = await pool.query(query, values);
  return result;
}

// POST: Batch upload
router.post('/batch-upload', verifyToken, upload.single('file'), async (req, res) => {
  let filePath = null;

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    filePath = req.file.path;
    const fileExt = path.extname(req.file.originalname).toLowerCase();
    const createdBy = req.user_fullname || 'SYSTEM';
    const userId = req.user_id;

    // ✅ SET DATABASE ONCE at the beginning - it persists for the entire request
    const currentDb = pool.getCurrentDatabase(userId.toString());
    const payrollClass = getPayrollClassFromDb(currentDb);
    
    console.log('📊 Using database:', currentDb);
    console.log('📊 Payroll class:', payrollClass);

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

    console.log('📊 Total rows parsed:', rawData.length);

    // Map and validate
    const validationErrors = [];
    const mappedData = rawData.map((row, index) => {
      const mapped = mapFields(row, createdBy, payrollClass);
      
      if (index === 0) {
        console.log('🔍 First mapped row:', mapped);
      }
      
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

    // Check duplicates
    const duplicateKeys = await checkDuplicates(mappedData);

    // Filter out duplicates
    const uniqueData = mappedData.filter(row => !duplicateKeys.includes(row.Empl_ID));

    const results = {
      totalRecords: mappedData.length,
      duplicates: duplicateKeys,
      inserted: uniqueData.length,
      successful: 0,
      failed: 0,
      errors: [],
      payrollClass: payrollClass,
      database: currentDb
    };

    // Insert personnel
    for (let i = 0; i < uniqueData.length; i++) {
      try {
        await insertPersonnel(uniqueData[i]);
        results.successful++;
      } catch (error) {
        results.failed++;
        results.errors.push({
          row: i + 5,
          serviceNumber: uniqueData[i].Empl_ID,
          error: error.message
        });
        console.error(`❌ Failed to insert ${uniqueData[i].Empl_ID}:`, error.message);
      }
    }

    // Add duplicates to failed count
    results.failed += results.duplicates.length;

    if (results.duplicates.length > 0) {
      results.errors.push(
        ...results.duplicates.map(emplId => ({
          row: null,
          serviceNumber: emplId,
          error: 'Already exists (duplicate)'
        }))
      );
    }

    // Clean up
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    console.log('✅ Batch upload complete:', results);

    return res.status(200).json({
      message: 'Batch personnel upload completed',
      summary: results
    });

  } catch (error) {
    console.error('Personnel batch upload error:', error);
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);

    return res.status(500).json({
      error: 'Personnel batch upload failed',
      details: error.message
    });
  }
});

// GET: Download sample template
router.get('/batch-template', verifyToken, async (req, res) => {
  const ExcelJS = require('exceljs');
  
  try {
    // Create workbook and worksheet
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Personnel', {
      views: [{ state: 'frozen', ySplit: 4 }] // Freeze first 4 rows
    });
    
    // Add main header - Row 1 - Darker background
    worksheet.mergeCells('A1:N1');
    const mainHeader = worksheet.getCell('A1');
    mainHeader.value = 'DEFENCE INTELLIGENCE AGENCY';
    mainHeader.font = { name: 'Arial', size: 13, bold: true, color: { argb: 'FFFFFFFF' } }; // White text
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
    
    // Add sub header - Row 2 - Medium gray background
    worksheet.mergeCells('A2:N2');
    const subHeader = worksheet.getCell('A2');
    subHeader.value = 'ASOKORO - ABUJA - DEFENCE INTELIGENCE AGENCY';
    subHeader.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FF000000' } }; // Black text
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
    
    // Column headers - Row 4 with darker blue background
    const headers = [
      'Svc. No.',
      'Rank',
      'Surname',
      'Other Name',
      'Date of Birth',
      'Sex',
      'Bank Code',
      'Bank Branch',
      'Account Number',
      'Date Joined',
      'Seniority Date',
      'Salary Grade',
      'Salary Group',
      'Emol. Form'
    ];
    
    const headerRow = worksheet.getRow(4);
    headers.forEach((header, index) => {
      const cell = headerRow.getCell(index + 1);
      cell.value = header;
      cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } }; // White text
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF2E8A5C' } // Darker blue (similar to your image)
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
      '00NA/00/0001',    // Service Number
      'SSGT',            // Rank
      'Mr.',             // Surname
      'John',            // Other Name
      '15/06/1985',      // Date of Birth
      'M',               // Sex
      'BK001',           // Bank Code
      '001',             // Bank Branch
      '1234567890',      // Account Number
      '01/01/2010',      // Date Joined
      '01/01/2015',      // Seniority Date
      '0101',            // Salary Grade
      'MILITARY',        // Salary Group
      'yes'              // Emolument Form
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
    
    // Add a few more empty rows with borders for visual guidance
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
      { key: 'serviceNumber', width: 11.4 },
      { key: 'rank', width: 7 },
      { key: 'surname', width: 15 },
      { key: 'otherName', width: 15 },
      { key: 'dob', width: 12 },
      { key: 'sex', width: 6 },
      { key: 'bankCode', width: 12 },
      { key: 'bankBranch', width: 12 },
      { key: 'accountNumber', width: 15 },
      { key: 'dateJoined', width: 11.5 },
      { key: 'seniorityDate', width: 13 },
      { key: 'salaryGrade', width: 12 },
      { key: 'salaryGroup', width: 13 },
      { key: 'emolumentForm', width: 14 }
    ];
    
    // Add data validation for specific columns
    // Sex column (F)
    worksheet.getCell('F5').dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: ['"M,F"'],
      showErrorMessage: true,
      errorTitle: 'Invalid Sex',
      error: 'Please select M or F'
    };
    
    // Emolument Form column (N)
    worksheet.getCell('N5').dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: ['"yes,no"'],
      showErrorMessage: true,
      errorTitle: 'Invalid Value',
      error: 'Please select yes or no'
    };
    
    // Add instructions/notes in a separate sheet
    const instructionsSheet = workbook.addWorksheet('Instructions');
    
    // Instructions header
    instructionsSheet.mergeCells('A1:D1');
    const instrHeader = instructionsSheet.getCell('A1');
    instrHeader.value = 'INSTRUCTIONS FOR FILLING THE PERSONNEL TEMPLATE';
    instrHeader.font = { size: 13, bold: true, color: { argb: 'FFFFFFFF' } };
    instrHeader.alignment = { horizontal: 'center', vertical: 'middle' };
    instrHeader.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1F4E78' }
    };
    instructionsSheet.getRow(1).height = 25;
    
    instructionsSheet.getRow(2).height = 10;
    
    // Instructions content
    const instructions = [
      '1. Do not modify the header rows (rows 1-4)',
      '2. Fill data starting from row 5',
      '3. Date format should be DD/MM/YYYY (e.g., 15/06/1985)',
      '4. Sex should be either M or F',
      '5. Emolument Form should be either yes or no',
      //'6. Service Number format: NN followed by numbers (e.g., NN001)',
      '6. All fields are required unless specified as optional',
      '7. Bank Code must match valid bank codes in the system',
      '8. Account Number should be 10 digits'
    ];
    
    instructions.forEach((instruction, index) => {
      const cell = instructionsSheet.getCell(`A${index + 3}`);
      cell.value = instruction;
      cell.font = { name: 'Arial', size: 11 };
      cell.alignment = { horizontal: 'left', vertical: 'middle' };
    });
    
    instructionsSheet.getColumn('A').width = 60;
    
    // Generate Excel file
    const buffer = await workbook.xlsx.writeBuffer();
    
    // Send file
    res.setHeader('Content-Disposition', 'attachment; filename=personnel_template.xlsx');
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
      FROM tblBatchUploads
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