const pool = require('../../config/db');
const { startLog, updateLog } = require('../../routes/helpers/logService');

exports.runBackup = async (year, month, user) => {
  const logId = await startLog('PayrollCalc', 'Backup', year, month, user);
  try {
    const [rows] = await pool.query('CALL sp_calc_backup_optimized(?, ?, ?)', [year, month, user]);
    await updateLog(logId, 'SUCCESS', 'Payroll backup completed successfully.');
    return { message: 'Backup completed successfully', details: rows[0] };
  } catch (err) {
    await updateLog(logId, 'FAILED', err.message);
    throw err;
  }
};



