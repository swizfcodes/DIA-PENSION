const express = require('express');
const router = express.Router();
const verifyToken = require('../../middware/authentication');
const historicalReportMiddleware = require('../../middware/historicalReportsmiddleware');

const reportsController = require('../../controllers/Reports/reportsControllers');

// PAYSLIP REPORT - DATA GENERATION (Returns JSON data)
router.get('/generate', verifyToken, historicalReportMiddleware, reportsController.generatePayslips.bind(reportsController));

// PAYSLIP REPORT - PDF EXPORT (Receives data in body, returns PDF file)
router.post('/export/pdf', verifyToken, historicalReportMiddleware, reportsController.generatePayslipPDFEnhanced.bind(reportsController));

// PAYSLIP REPORT - EXCEL EXPORT (Receives data in body, returns Excel file)
router.post('/export/excel', verifyToken, historicalReportMiddleware, reportsController.generatePayslipExcel.bind(reportsController));

// PAYSLIP REPORT - FILTER OPTIONS (Returns JSON data for filters)
router.get('/filter-options', verifyToken, reportsController.getFilterOptions.bind(reportsController));

// GET current database name from JWT token
router.get('/database', verifyToken, (req, res) => {
  try {
    const currentClass = req.current_class;
    
    // Get friendly name for the database
    const dbToClassMap = {
      [process.env.DB_OFFICERS]: 'MILITARY STAFF',
      [process.env.DB_WOFFICERS]: 'CIVILIAN STAFF', 
      [process.env.DB_RATINGS]: 'PENSION STAFF',
      [process.env.DB_RATINGS_A]: 'NYSC ATTACHE',
      [process.env.DB_RATINGS_B]: 'RUNNING COST',
      // [process.env.DB_JUNIOR_TRAINEE]: 'TRAINEE'
    };

    const dbToNumberMap = {
      [process.env.DB_OFFICERS]: 1,
      [process.env.DB_WOFFICERS]: 2,
      [process.env.DB_RATINGS]: 3,
      [process.env.DB_RATINGS_A]: 4,
      [process.env.DB_RATINGS_B]: 5,
      [process.env.DB_JUNIOR_TRAINEE]: 6
    };

    const friendlyName = dbToClassMap[currentClass] || 'Unknown Class';
    const classNumber = dbToNumberMap[currentClass] || 0;

    // Use a NEW variable
    const classCode = classNumber;

    res.json({ 
      database: classCode,
      class_name: friendlyName,
      primary_class: req.primary_class,
      user_info: {
        user_id: req.user_id,
        full_name: req.user_fullname,
        role: req.user_role
      }
    });
  } catch (error) {
    console.error('Error getting database info:', error);
    res.json({ 
      database: 'Error',
      class_name: 'Error',
      error: error.message 
    });
  }
});


module.exports = router;


