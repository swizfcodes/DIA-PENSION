const express = require('express');
const router = express.Router();
const pool = require('../../config/db'); // mysql2 pool
const verifyToken = require('../../middware/authentication');

// ========================================================================
// HELPER: Get Payroll Class from Current Database
// ========================================================================
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


router.get('/total-personnels', verifyToken, async (req, res) => {
  try {
    // Get database from pool using user_id as session
    const currentDb = pool.getCurrentDatabase(req.user_id.toString());
    const payrollClass = await getPayrollClassFromDb(currentDb);

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