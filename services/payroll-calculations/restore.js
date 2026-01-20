const pool = require('../../config/db');
const { startLog, updateLog } = require('../../routes/helpers/logService');

exports.restoreBackup = async (year, month, user) => {
  const logId = await startLog('PayrollCalc', 'RestoreBackup', year, month, user);
  try {
    const [rows] = await pool.query('CALL sp_calc_restore_optimized(?, ?, ?)', [year, month, user]);
    await updateLog(logId, 'SUCCESS', 'Payroll restore completed successfully.');
    return { message: 'Restore completed successfully', details: rows[0] };
  } catch (err) {
    await updateLog(logId, 'FAILED', err.message);
    throw err;
  }
};



