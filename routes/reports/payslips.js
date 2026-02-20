const express = require('express');
const router = express.Router();
const pool = require('../../config/db');
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

router.get('/database', verifyToken, async (req, res) => {
  try {
    const currentClass = req.current_class;
    const masterDb = pool.getMasterDb();
    const connection = await pool.getConnection();

    try {
      await connection.query(`USE \`${masterDb}\``);
      const [rows] = await connection.query(
        'SELECT classcode, classname FROM py_payrollclass WHERE db_name = ?',
        [currentClass]
      );

      const row = rows[0];
      const friendlyName = row ? row.classname : 'Unknown Class';
      const classCode = row ? row.classcode : 0;

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
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('Error getting database info:', error);
    res.json({ database: 'Error', class_name: 'Error', error: error.message });
  }
});


module.exports = router;