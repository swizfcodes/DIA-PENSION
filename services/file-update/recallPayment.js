// services/file-update/recallPayment.js
const pool = require('../../config/db');
const { startLog, updateLog } = require('../helpers/logService');

exports.recallFiles = async (year, month, user) => {
  const logId = await startLog('FileUpdate', 'RecallPayrollFiles', year, month, user);
  
  let connection;
  try {
    // Get a dedicated connection instead of using pool directly
    connection = await pool.getConnection();
    
    // Ensure no pending transaction
    await connection.query('COMMIT');
    
    const [rows] = await connection.query(
      'CALL py_recall_payrollfiles_optimized(?, ?, ?)', 
      [year, month, user]
    );
    
    await updateLog(logId, 'SUCCESS', 'Payroll files recalled successfully');
    
    return {
      logId,
      status: 'OK',
      message: 'Payroll Recalled successfully',
      rows: rows[0] || []
    };
  } catch (err) {
    await updateLog(logId, 'FAILED', err.message);
    throw err;
  } finally {
    if (connection) {
      // Ensure connection is clean before returning to pool
      await connection.query('COMMIT');
      connection.release();
    }
  }
};


