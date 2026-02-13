const express = require('express');
const router = express.Router();
const pool = require('../../config/db'); // mysql2 pool
const verifyToken = require('../../middware/authentication');

// ========================================================================
// HELPER: Get Payroll Class from Current Database
// ========================================================================
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


router.get('/total-personnels', verifyToken, async (req, res) => {
  try {
    // Get database from pool using user_id as session
    const currentDb = pool.getCurrentDatabase(req.user_id.toString());
    const payrollClass = getPayrollClassFromDb(currentDb);

    const query = `
      SELECT COUNT(*) AS totalPersonnels FROM hr_employees
      WHERE (exittype IS NULL OR exittype = '')
        AND (
          DateLeft IS NULL
          OR DateLeft = ''
          OR STR_TO_DATE(DateLeft, '%Y%m%d') > CURDATE()
        )
        AND payrollclass = ?
    `;

    const [result] = await pool.execute(query, [payrollClass]);

    res.json({
      success: true,
      data: result[0]
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});


module.exports = router;