const pool = require('../../config/db');
const recallPayment = require('../../services/file-update/recallPayment');

exports.recallPayrollFiles = async (req, res) => {
  try {
    // Get current payroll period from BT05
    const [bt05Rows] = await pool.query(
      "SELECT ord AS year, mth AS month FROM py_stdrate WHERE type='BT05' LIMIT 1"
    );
    if (bt05Rows.length === 0)
      return res.status(404).json({ error: 'BT05 not found' });

    const { year, month } = bt05Rows[0];
    const user = req.user_fullname || 'System Recall';

    // Call service
    const result = await recallPayment.recallFiles(year, month, user);

    //Reset BT05 to 0
    await pool.query("UPDATE py_stdrate SET sun = 0, createdby = ? WHERE type = 'BT05'", [user]);

    res.json({
      status: 'SUCCESS',
      stage: 0,
      progress: 'Data Entry Reopened',
      message: 'Payroll files recalled successfully',
      logId: result.logId || result.insertId || null, 
      result
    });
  } catch (err) {
    res.status(500).json({ status: 'FAILED', message: err.message });
  }
};


