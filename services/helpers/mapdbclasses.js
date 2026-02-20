// dbMapper.js
const pool = require('../../config/db'); // adjust path as needed

module.exports = async function getDatabaseForIndicator(indicator) {
  const masterDb = pool.getMasterDb();
  const connection = await pool.getConnection();
  
  try {
    await connection.query(`USE \`${masterDb}\``);
    const [rows] = await connection.query(
      'SELECT db_name FROM py_payrollclass WHERE classcode = ?',
      [String(indicator)]
    );

    if (rows.length === 0) {
      throw new Error(`Unknown payroll indicator: ${indicator}`);
    }

    return rows[0].db_name;
  } finally {
    connection.release();
  }
};