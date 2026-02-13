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

// Field mapping from Excel/CSV headers to database columns
const FIELD_MAPPING = {
  'Service Number': 'Empl_ID',
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
  'Emolument Form': 'emolumentform',
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
function mapFields(row) {
  const mappedRow = {};
  
  Object.keys(row).forEach(key => {
    const trimmedKey = key.trim();
    const dbField = FIELD_MAPPING[trimmedKey];
    
    if (dbField) {
      let value = row[key];
      
      // Handle date formatting (convert to ddmmyyyy)
      if (['Birthdate', 'DateEmpl', 'dateconfirmed', 'DateLeft', 'datepmted'].includes(dbField)) {
        value = formatDate(value);
      }
      
      // Trim string values
      if (typeof value === 'string') {
        value = value.trim();
      }
      
      mappedRow[dbField] = value || null;
    }
  });
  
  return mappedRow;
}

// Helper function to format dates to ddmmyyyy
function formatDate(dateValue) {
  if (!dateValue) return null;
  
  let date;
  
  // Handle Excel serial date
  if (typeof dateValue === 'number') {
    date = XLSX.SSF.parse_date_code(dateValue);
    return `${String(date.d).padStart(2, '0')}${String(date.m).padStart(2, '0')}${date.y}`;
  }
  
  // Handle string dates
  if (typeof dateValue === 'string') {
    // Try parsing various formats
    const formats = [
      /^(\d{2})[-\/](\d{2})[-\/](\d{4})$/, // DD-MM-YYYY or DD/MM/YYYY
      /^(\d{4})[-\/](\d{2})[-\/](\d{2})$/, // YYYY-MM-DD or YYYY/MM/DD
      /^(\d{2})(\d{2})(\d{4})$/             // DDMMYYYY
    ];
    
    for (let format of formats) {
      const match = dateValue.match(format);
      if (match) {
        if (format === formats[0]) {
          return `${match[1]}${match[2]}${match[3]}`;
        } else if (format === formats[1]) {
          return `${match[3]}${match[2]}${match[1]}`;
        } else if (format === formats[2]) {
          return dateValue;
        }
      }
    }
  }
  
  return null;
}

// Validate required fields
function validateRow(row, rowIndex) {
  const errors = [];
  const requiredFields = ['Empl_ID', 'Surname', 'OtherName'];
  
  requiredFields.forEach(field => {
    if (!row[field] || row[field].toString().trim() === '') {
      errors.push(`Row ${rowIndex + 2}: Missing required field "${field}"`);
    }
  });
  
  // Validate Service Number uniqueness will be done at DB level
  
  return errors;
}

// Check for duplicate service numbers in DB
async function checkDuplicates(serviceNumbers) {
  const query = `
    SELECT Empl_ID 
    FROM hr_employees 
    WHERE Empl_ID IN (?)
  `;
  
  const [results] = await pool.query(query, [serviceNumbers]);
  return results.map(row => row.Empl_ID);
}

// Insert personnel record
async function insertPersonnel(data) {
  const query = `
    INSERT INTO hr_employees SET ?
  `;
  
  const [result] = await pool.query(query, data);
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
      const mapped = mapFields(row);
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

    // Check existing service numbers
    const serviceNumbers = mappedData.map(row => row.Empl_ID);
    const duplicates = await checkDuplicates(serviceNumbers);

    // Filter out duplicates so only new ones are inserted
    const uniqueData = mappedData.filter(row => !duplicates.includes(row.Empl_ID));

    const results = {
    totalRecords: mappedData.length,
    duplicates: duplicates,
    inserted: uniqueData.length,
    successful: 0,
    failed: 0,
    errors: []
    };

    // Insert only unique personnel
    for (let i = 0; i < uniqueData.length; i++) {
    try {
        await insertPersonnel(uniqueData[i]);
        results.successful++;
    } catch (error) {
        results.failed++;
        results.errors.push({
        row: i + 2,
        serviceNumber: uniqueData[i].Empl_ID,
        error: error.message
        });
    }
    }

    // Add duplicates to failed count after insertion loop
    results.failed += results.duplicates.length;

    // If any duplicates, push them as “soft errors” for frontend visibility
    if (results.duplicates.length > 0) {
    results.errors.push(
        ...results.duplicates.map(sn => ({
        row: null,
        serviceNumber: sn,
        error: 'Already exists in database (duplicate)'
        }))
    );
    }

    // Clean up file
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    return res.status(200).json({
    message: 'Personnel batch upload completed',
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