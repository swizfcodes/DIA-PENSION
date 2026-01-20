const pool = require('../../config/db');
const { startLog, updateLog } = require('../helpers/logService');

exports.saveFiles = async (year, month, user) => {
  const logId = await startLog('FileUpdate', 'SavePayrollFiles', year, month, user);
  try {
    const [rows] = await pool.query('CALL py_save_payrollfiles_optimized(?, ?, ?)', [year, month, user]);
    await updateLog(logId, 'SUCCESS', 'Payroll files saved successfully');
    return {
      logId,
      status: 'OK',
      message: 'Payroll Saved successfully',
      rows: rows[0] || []
    };
  } catch (err) {
    await updateLog(logId, 'FAILED', err.message);
    throw err;
  }
};


