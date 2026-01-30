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
    
    // Database to display name mapping
    const dbToClassMap = {
      [process.env.DB_OFFICERS]: 'OFFICERS',
      [process.env.DB_WOFFICERS]: 'W_OFFICERS', 
      [process.env.DB_RATINGS]: 'RATE A',
      [process.env.DB_RATINGS_A]: 'RATE B',
      [process.env.DB_RATINGS_B]: 'RATE C',
      [process.env.DB_JUNIOR_TRAINEE]: 'TRAINEE'
    };
    
    // Get all available databases
    const availableDatabases = pool.getAvailableDatabases();
    
    // Map to payroll classes with friendly names
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
        isMasterDb: isMasterDb,
        currentClass: pool.getPayrollClassFromDatabase(currentDb),
        currentDatabase: currentDb,
        classes: classes
      }
    });
    
  } catch (error) {
    console.error('Error fetching payroll classes:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;