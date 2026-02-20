const express = require('express');
const router = express.Router();
const verifyToken = require('../../middware/authentication');
const historicalReportMiddleware = require('../../middware/historicalReportsmiddleware');
const pool = require('../../config/db')

const rangePaymentController = require('../../controllers/audit-trail/rangePaymentController');

// PAYMENTS-BANK REPORT - DATA GENERATION (Returns JSON data)
router.get('/generate', verifyToken, historicalReportMiddleware, rangePaymentController.generatePaymentsByBankInRange.bind(rangePaymentController));

// PAYMENTS-BANK - PDF EXPORT (Receives data in body, returns PDF file)
router.post('/export/pdf', verifyToken, historicalReportMiddleware, rangePaymentController.generatePaymentsByBankInRangePDF.bind(rangePaymentController));

// PAYMENTS-BANK - EXCEL EXPORT (Receives data in body, returns Excel file)
router.post('/export/excel', verifyToken, historicalReportMiddleware, rangePaymentController.generatePaymentsByBankInRangeExcel.bind(rangePaymentController));

// PAYMENTS-BANK - FETCH FILTER OPTIONS
router.get('/filter-options', verifyToken, rangePaymentController.getFilterOptions.bind(rangePaymentController));

router.get('/payroll-classes', verifyToken, async (req, res) => {
  try {
    const currentDb = pool.getCurrentDatabase();
    const masterDb = pool.getMasterDb();
    const isMasterDb = currentDb === masterDb;

    // Fetch class names from database instead of hardcoding
    pool.useDatabase(masterDb);
    const [dbClasses] = await pool.query('SELECT db_name, classname FROM py_payrollclass');
    
    const dbToClassMap = {};
    dbClasses.forEach(row => {
      dbToClassMap[row.db_name] = row.classname;
    });

    const availableDatabases = pool.getAvailableDatabases();

    const classes = availableDatabases.map(dbName => {
      const className = pool.getPayrollClassFromDatabase(dbName);
      const isCurrent = dbName === currentDb;

      return {
        name: className,
        database: dbName,
        displayName: dbToClassMap[dbName] || className || 'Unknown',
        isCurrent: isCurrent
      };
    });

    res.json({
      success: true,
      data: {
        isMasterDb,
        currentClass: pool.getPayrollClassFromDatabase(currentDb),
        currentDatabase: currentDb,
        classes
      }
    });

  } catch (error) {
    console.error('Error fetching payroll classes:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;