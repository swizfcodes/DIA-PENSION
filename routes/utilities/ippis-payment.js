// ============================================
// FILE: routes/utilities/ippis-payroll-import.js
// ============================================
const express = require("express");
const multer = require('multer');
const csv = require('csv-parse');
const fs = require('fs').promises;
const pool = require('../../config/db');
const verifyToken = require('../../middware/authentication');
const router = express.Router();

/**
 * Maps database name to payroll class code from py_payrollclass
 * @param {string} dbName - Current database name
 * @returns {string} Payroll class code
 */
async function getPayrollClassFromDb(dbName) {
  const masterDb = pool.getMasterDb();
  const connection = await pool.getConnection();
  
  try {
    await connection.query(`USE \`${masterDb}\``);
    const [rows] = await connection.query(
      'SELECT classcode FROM py_payrollclass WHERE db_name = ?',
      [dbName]
    );
    
    const result = rows.length > 0 ? rows[0].classcode : null;
    console.log('🔍 Database:', dbName, '→ Payroll Class:', result);
    return result;
  } finally {
    connection.release();
  }
}

// Configure multer for file upload
const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed'));
    }
  }
});

// ============================================
// GET /months - Get list of available months
// ============================================
router.get('/months', verifyToken, async (req, res) => {
  try {
    const [months] = await pool.query(
      'SELECT cmonth, mthdesc FROM ac_months ORDER BY cmonth'
    );
    
    res.json({
      success: true,
      data: months
    });
    
  } catch (err) {
    console.error('❌ Failed to fetch months:', err.message);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch months',
      message: err.message
    });
  }
});

// ============================================
// GET /payment-types - Get list of payment types
// ============================================
router.get('/payment-types', verifyToken, async (req, res) => {
  try {
    const [types] = await pool.query(
      'SELECT PaymentType, elmDesc FROM py_elementType ORDER BY PaymentType'
    );
    
    res.json({
      success: true,
      data: types
    });
    
  } catch (err) {
    console.error('❌ Failed to fetch payment types:', err.message);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch payment types',
      message: err.message
    });
  }
});

// ============================================
// POST /validate - Validate CSV file before import
// ============================================
router.post('/validate', verifyToken, upload.single('file'), async (req, res) => {
  try {
    // Validate file upload first
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No file uploaded'
      });
    }

    // Get database and payroll class once at the start
    const currentDb = pool.getCurrentDatabase(req.user_id.toString());
    const payrollClass = await getPayrollClassFromDb(currentDb);
    const { year, month } = req.body;
    
    // Validate required inputs
    if (!year || !month || !payrollClass) {
      return res.status(400).json({
        success: false,
        error: 'Year, month, and payroll class are required'
      });
    }
    
    // Validate year range
    const yearNum = parseInt(year);
    if (isNaN(yearNum) || yearNum < 2024 || yearNum > 2050) {
      return res.status(400).json({
        success: false,
        error: 'Year must be between 2024 and 2050'
      });
    }
    
    // Get month number
    const [monthRows] = await pool.query(
      'SELECT cmonth FROM ac_months WHERE mthdesc = ?',
      [month]
    );
    
    if (monthRows.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid month description'
      });
    }
    
    const monthNumber = String(monthRows[0].cmonth).padStart(2, '0');
    const period = `${year}${monthNumber}`;
    
    // Parse CSV
    const fileContent = await fs.readFile(req.file.path, 'utf-8');
    const records = await new Promise((resolve, reject) => {
      csv.parse(fileContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        cast: true
      }, (err, records) => {
        if (err) reject(err);
        else resolve(records);
      });
    });
    
    if (records.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'CSV file is empty'
      });
    }
    
    // Get headers
    const headers = Object.keys(records[0]);
    
    // Identify employee ID column
    const employeeIdColumn = headers.find(h => 
      h.toLowerCase() === 'employee_id' || 
      h.toLowerCase() === 'service_number' ||
      h.toLowerCase() === 'numb'
    ) || headers[0];
    
    // Get payment type columns (exclude employee ID column)
    const paymentTypeHeaders = headers.filter(h => h !== employeeIdColumn);
    
    if (paymentTypeHeaders.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No payment type columns found in CSV'
      });
    }
    
    // Batch validate headers against payment types
    const headerValidationPromises = paymentTypeHeaders.map(async (header) => {
      const [descRows] = await pool.query(
        'SELECT elmDesc FROM py_elementType WHERE PaymentType = ?',
        [header]
      );
      
      return {
        header,
        isValid: descRows.length > 0,
        description: descRows.length > 0 ? descRows[0].elmDesc.substring(0, 40) : null
      };
    });
    
    const headerValidationResults = await Promise.all(headerValidationPromises);
    
    const validHeaders = headerValidationResults
      .filter(r => r.isValid)
      .map(r => ({
        code: r.header,
        description: r.description
      }));
    
    const invalidHeaders = headerValidationResults
      .filter(r => !r.isValid)
      .map(r => r.header);

    if (validHeaders.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No valid payment type columns found in CSV. All column headers must match payment types in the database.',
        details: {
          invalidHeaders: invalidHeaders,
          message: 'Please ensure your CSV columns use valid payment type codes (e.g., BP001, PR001, etc.)'
        }
      });
    }
    
    // Sample validation of first few records
    const sampleSize = Math.min(5, records.length);
    const sampleRecords = records.slice(0, sampleSize);
    
    // Batch validate employee existence
    const employeeIds = sampleRecords.map(record => record[employeeIdColumn]);
    
    const employeeValidationPromises = employeeIds.map(async (employeeId, index) => {
      const [empRows] = await pool.query(
        'SELECT surname FROM hr_employees WHERE Empl_ID = ? AND payrollclass = ?',
        [employeeId, payrollClass]
      );
      
      return {
        employeeId: employeeId,
        exists: empRows.length > 0,
        rowNumber: index + 2 // +2 because of header row and 0-index
      };
    });
    
    const sampleValidation = await Promise.all(employeeValidationPromises);
    
    res.json({
      success: true,
      data: {
        period: period,
        totalRecords: records.length,
        headers: {
          valid: validHeaders,
          invalid: invalidHeaders
        },
        sampleValidation: sampleValidation,
        warnings: invalidHeaders.length > 0 ? [
          `Found ${invalidHeaders.length} unknown payment types that will be skipped: ${invalidHeaders.join(', ')}`
        ] : []
      }
    });
    
  } catch (err) {
    console.error('❌ Error validating file:', err.message);
    
    res.status(500).json({
      success: false,
      error: 'Validation failed',
      message: err.message
    });
  } finally {
    // Always clean up uploaded file
    if (req.file?.path) {
      await fs.unlink(req.file.path).catch(() => {});
    }
  }
});

// ============================================
// POST /import - Import payroll data from CSV
// ============================================
router.post('/import', verifyToken, upload.single('file'), async (req, res) => {
  const connection = await pool.getConnection();
  
  try {
    const { year, month, payrollClass, deleteExisting = true } = req.body;
    
    // Validate inputs
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No file uploaded'
      });
    }
    
    if (!year || !month || !payrollClass) {
      return res.status(400).json({
        success: false,
        error: 'Year, month, and payroll class are required'
      });
    }
    
    // Validate year range
    const yearNum = parseInt(year);
    if (isNaN(yearNum) || yearNum < 2024 || yearNum > 2050) {
      await fs.unlink(req.file.path);
      return res.status(400).json({
        success: false,
        error: 'Year must be between 2024 and 2050'
      });
    }
    
    await connection.beginTransaction();
    
    // Get month number
    const [monthRows] = await connection.query(
      'SELECT cmonth FROM ac_months WHERE mthdesc = ?',
      [month]
    );
    
    if (monthRows.length === 0) {
      await connection.rollback();
      await fs.unlink(req.file.path);
      return res.status(400).json({
        success: false,
        error: 'Invalid month description'
      });
    }
    
    const monthNumber = String(monthRows[0].cmonth).padStart(2, '0');
    const period = `${year}${monthNumber}`;
    
    // Delete existing data for this period if requested
    if (deleteExisting === true || deleteExisting === 'true') {
      const [deleteResult] = await connection.query(
        'DELETE FROM py_ipis_payhistory WHERE period = ?',
        [period]
      );
      
      console.log(`✅ Deleted ${deleteResult.affectedRows} existing records for period ${period}`);
    }
    
    // Parse CSV
    const fileContent = await fs.readFile(req.file.path, 'utf-8');
    const records = await new Promise((resolve, reject) => {
      csv.parse(fileContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        cast: true
      }, (err, records) => {
        if (err) reject(err);
        else resolve(records);
      });
    });
    
    if (records.length === 0) {
      await connection.rollback();
      await fs.unlink(req.file.path);
      return res.status(400).json({
        success: false,
        error: 'CSV file is empty'
      });
    }
    
    // Get headers
    const headers = Object.keys(records[0]);
    const employeeIdColumn = headers[0]; // First column is employee ID
    
    // Build header mapping (column name -> payment type description)
    const headerMapping = {};
    const unmappedHeaders = [];
    
    for (const header of headers) {
      if (header === employeeIdColumn) continue;
      
      const [descRows] = await connection.query(
        'SELECT elmDesc FROM py_elementType WHERE PaymentType = ?',
        [header]
      );
      
      if (descRows.length > 0) {
        headerMapping[header] = descRows[0].elmDesc.substring(0, 40);
      } else {
        unmappedHeaders.push(header);
      }
    }
    
    // Process records
    let processedCount = 0;
    let skippedEmployees = 0;
    let insertedRecords = 0;
    let updatedRecords = 0;
    const errors = [];
    
    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      const employeeId = String(record[employeeIdColumn]).trim();
      
      if (!employeeId) {
        errors.push({
          row: i + 2,
          error: 'Missing employee ID'
        });
        continue;
      }
      
      // Check if employee exists
      const [empRows] = await connection.query(
        'SELECT surname FROM hr_employees WHERE Empl_ID = ? AND payrollclass = ?',
        [employeeId, payrollClass]
      );
      
      if (empRows.length === 0) {
        skippedEmployees++;
        continue;
      }
      
      // Process each payment field
      for (const [PaymentType, value] of Object.entries(record)) {
        // Skip employee ID column
        if (PaymentType === employeeIdColumn) continue;
        
        // Skip unmapped headers
        if (!headerMapping[PaymentType]) continue;
        
        // Skip empty or zero values
        if (!value || value === 0 || value === '0' || value === '') continue;
        
        const amount = parseFloat(value);
        
        if (isNaN(amount)) {
          errors.push({
            row: i + 2,
            employeeId: employeeId,
            PaymentType: PaymentType,
            error: `Invalid amount: ${value}`
          });
          continue;
        }
        
        // Get payment category
        const typePrefix = PaymentType.substring(0, 2).toUpperCase();
        let category = 'OTHER';
        
        if (typePrefix === 'BP') category = 'TAXABLE PAYMENT';
        else if (typePrefix === 'PT') category = 'NON-TAXABLE PAY';
        else if (typePrefix === 'PR') category = 'DEDUCTIONS';
        else if (typePrefix === 'PL') category = 'LOAN';
        
        // Check if record exists
        const [existing] = await connection.query(
          'SELECT id FROM py_ipis_payhistory WHERE numb = ? AND type = ? AND period = ?',
          [employeeId, PaymentType, period]
        );
        
        if (existing.length > 0) {
          // Update existing record
          await connection.query(
            `UPDATE py_ipis_payhistory 
             SET bpm = ?, bpc = ?, bp = ?, bpa = ?, updated_at = NOW()
             WHERE numb = ? AND type = ? AND period = ?`,
            [amount, typePrefix, headerMapping[PaymentType], category, employeeId, PaymentType, period]
          );
          updatedRecords++;
        } else {
          // Insert new record
          await connection.query(
            `INSERT INTO py_ipis_payhistory 
             (numb, period, type, bpm, bpc, bp, bpa, datecreated) 
             VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
            [employeeId, period, PaymentType, amount, typePrefix, headerMapping[PaymentType], category]
          );
          insertedRecords++;
        }
      }
      
      processedCount++;
    }
    
    // Commit transaction
    await connection.commit();
    
    // Clean up uploaded file
    await fs.unlink(req.file.path);
    
    res.json({
      success: true,
      data: {
        period: period,
        totalRecords: records.length,
        processedEmployees: processedCount,
        skippedEmployees: skippedEmployees,
        insertedRecords: insertedRecords,
        updatedRecords: updatedRecords,
        unmappedHeaders: unmappedHeaders,
        errors: errors.length > 0 ? errors.slice(0, 10) : [], // Return first 10 errors
        totalErrors: errors.length
      },
      message: `Successfully imported payroll data for period ${period}`
    });
    
  } catch (err) {
    console.error('❌ Error importing file:', err.message);
    
    // Rollback transaction on error
    await connection.rollback().catch(() => {});
    
    // Clean up uploaded file on error
    if (req.file) {
      await fs.unlink(req.file.path).catch(() => {});
    }
    
    res.status(500).json({
      success: false,
      error: 'Import failed',
      message: err.message
    });
  } finally {
    connection.release();
  }
});

// ============================================
// GET /history/:period - Get payroll history for a specific period
// ============================================
router.get('/history/:period', verifyToken, async (req, res) => {
  try {
    const { period } = req.params;
    const { page = 1, limit = 100, employeeId } = req.query;
    
    const offset = (parseInt(page) - 1) * parseInt(limit);
    
    let query = `
      SELECT 
          ph.*,
          e.Surname,
          e.OtherName
      FROM py_ipis_payhistory ph
      LEFT JOIN hr_employees e 
          ON ph.numb = e.Empl_ID
      WHERE ph.period = ?
    `;
    
    const params = [period];
    
    if (employeeId) {
      query += ' AND ph.numb = ?';
      params.push(employeeId);
    }
    
    query += ' ORDER BY ph.numb, ph.type LIMIT ? OFFSET ?';
    params.push(parseInt(limit), offset);
    
    const [records] = await pool.query(query, params);
    
    // Get total count
    let countQuery = 'SELECT COUNT(*) as total FROM py_ipis_payhistory WHERE period = ?';
    const countParams = [period];
    
    if (employeeId) {
      countQuery += ' AND numb = ?';
      countParams.push(employeeId);
    }
    
    const [countResult] = await pool.query(countQuery, countParams);
    const total = countResult[0].total;
    
    res.json({
      success: true,
      data: {
        records: records,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: total,
          pages: Math.ceil(total / parseInt(limit))
        }
      }
    });
    
  } catch (err) {
    console.error('❌ Failed to fetch history:', err.message);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch history',
      message: err.message
    });
  }
});

// ============================================
// GET /summary/:period - Get summary statistics for a period
// ============================================
router.get('/summary/:period', verifyToken, async (req, res) => {
  try {
    const { period } = req.params;
    
    // Get total employees
    const [employeeCount] = await pool.query(
      'SELECT COUNT(DISTINCT numb) as total FROM py_ipis_payhistory WHERE period = ?',
      [period]
    );
    
    // Get totals by category
    const [categoryTotals] = await pool.query(
      `SELECT 
        bpa as category,
        COUNT(*) as record_count,
        SUM(bpm) as total_amount
      FROM py_ipis_payhistory 
      WHERE period = ?
      GROUP BY bpa`,
      [period]
    );
    
    // Get top payment types
    const [topPayments] = await pool.query(
      `SELECT 
        type,
        bp as description,
        COUNT(*) as employee_count,
        SUM(bpm) as total_amount,
        AVG(bpm) as average_amount
      FROM py_ipis_payhistory 
      WHERE period = ?
      GROUP BY type, bp
      ORDER BY total_amount DESC
      LIMIT 10`,
      [period]
    );
    
    res.json({
      success: true,
      data: {
        period: period,
        totalEmployees: employeeCount[0].total,
        categoryTotals: categoryTotals,
        topPayments: topPayments
      }
    });
    
  } catch (err) {
    console.error('❌ Failed to fetch summary:', err.message);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch summary',
      message: err.message
    });
  }
});

// ============================================
// GET /employee/:employeeId - Get all payroll records for a specific employee
// ============================================
router.get('/employee/:employeeId', verifyToken, async (req, res) => {
  try {
    const { employeeId } = req.params;
    const { period } = req.query;
    
    let query = `
      SELECT 
        ph.*,
        e.Surname,
        e.OtherName,
        e.payrollclass
      FROM py_ipis_payhistory ph
      LEFT JOIN hr_employees e ON ph.numb = e.Empl_ID
      WHERE ph.numb = ?
    `;
    
    const params = [employeeId];
    
    if (period) {
      query += ' AND ph.period = ?';
      params.push(period);
    }
    
    query += ' ORDER BY ph.period DESC, ph.type';
    
    const [records] = await pool.query(query, params);
    
    // Get employee details
    const [employee] = await pool.query(
      'SELECT * FROM hr_employees WHERE Empl_ID = ?',
      [employeeId]
    );
    
    res.json({
      success: true,
      data: {
        employee: employee[0] || null,
        records: records
      }
    });
    
  } catch (err) {
    console.error('❌ Failed to fetch employee records:', err.message);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch employee records',
      message: err.message
    });
  }
});

// ============================================
// GET /periods - Get list of all available periods with record counts
// ============================================
router.get('/periods', verifyToken, async (req, res) => {
  try {
    const [periods] = await pool.query(
      `SELECT 
        period,
        COUNT(*) as record_count,
        COUNT(DISTINCT numb) as employee_count,
        SUM(bpm) as total_amount,
        MIN(datecreated) as import_date
      FROM py_ipis_payhistory
      GROUP BY period
      ORDER BY period DESC`
    );
    
    res.json({
      success: true,
      data: periods
    });
    
  } catch (err) {
    console.error('❌ Failed to fetch periods:', err.message);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch periods',
      message: err.message
    });
  }
});

// ============================================
// DELETE /period/:period - Delete all records for a specific period
// ============================================
router.delete('/period/:period', verifyToken, async (req, res) => {
  const connection = await pool.getConnection();
  
  try {
    const { period } = req.params;
    
    await connection.beginTransaction();
    
    const [result] = await connection.query(
      'DELETE FROM py_ipis_payhistory WHERE period = ?',
      [period]
    );
    
    await connection.commit();
    
    res.json({
      success: true,
      data: {
        deletedRecords: result.affectedRows
      },
      message: `Successfully deleted ${result.affectedRows} records for period ${period}`
    });
    
  } catch (err) {
    console.error('❌ Error deleting period:', err.message);
    await connection.rollback().catch(() => {});
    
    res.status(500).json({
      success: false,
      error: 'Failed to delete period',
      message: err.message
    });
  } finally {
    connection.release();
  }
});

// ============================================
// POST /export/:period - Export payroll data for a period to CSV
// ============================================
router.post('/export/:period', verifyToken, async (req, res) => {
  try {
    const { period } = req.params;
    const { format = 'csv' } = req.body;
    
    const [records] = await pool.query(
      `SELECT 
        ph.numb as employee_id,
        e.Surname,
        e.OtherName,
        ph.type as payment_type,
        ph.bp as payment_description,
        ph.bpa as category,
        ph.bpm as amount,
        ph.period
      FROM py_ipis_payhistory ph
      LEFT JOIN hr_employees e ON ph.numb = e.Empl_ID
      WHERE ph.period = ?
      ORDER BY ph.numb, ph.type`,
      [period]
    );
    
    if (records.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No records found for this period'
      });
    }
    
    if (format === 'csv') {
      // Generate CSV
      const headers = Object.keys(records[0]).join(',');
      const rows = records.map(record => 
        Object.values(record).map(val => 
          typeof val === 'string' && val.includes(',') ? `"${val}"` : val
        ).join(',')
      );
      
      const csv = [headers, ...rows].join('\n');
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="payroll_${period}.csv"`);
      res.send(csv);
    } else {
      // Return JSON
      res.json({
        success: true,
        data: records
      });
    }
    
  } catch (err) {
    console.error('❌ Error exporting data:', err.message);
    res.status(500).json({
      success: false,
      error: 'Failed to export data',
      message: err.message
    });
  }
});

// Error handling middleware for multer
router.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    return res.status(400).json({
      success: false,
      error: 'File upload error',
      message: error.message
    });
  }
  
  if (error) {
    return res.status(400).json({
      success: false,
      error: error.message
    });
  }
  
  next();
});

module.exports = router;