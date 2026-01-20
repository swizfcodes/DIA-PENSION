const pool = require('../../config/db');

exports.startLog = async (module, action, year, month, username) => {
  const [result] = await pool.query(
    'INSERT INTO py_process_log (module, action, process_year, process_month, username, status) VALUES (?,?,?,?,?,?)',
    [module, action, year, month, username, 'STARTED']
  );
  return result.insertId;
};

exports.updateLog = async (logId, status, message) => {
  await pool.query(
    'UPDATE py_process_log SET status=?, message=?, completed_at=NOW() WHERE id=?',
    [status, message, logId]
  );
};

//module.exports = { startLog, updateLog };


