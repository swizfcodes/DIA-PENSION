const pool = require('../../config/db');
const savePayrollService = require('../../services/file-update/savePayroll');

exports.savePayrollFiles = async (req, res) => {
  try {
    // Get current payroll period from BT05
    const [bt05Rows] = await pool.query(
      "SELECT ord AS year, mth AS month FROM py_stdrate WHERE type='BT05' LIMIT 1"
    );
    if (bt05Rows.length === 0)
      return res.status(404).json({ error: 'BT05 not found' });

    const { year, month } = bt05Rows[0];
    const user = req.user_fullname || 'System Auto';

    // Call service
    const result = await savePayrollService.saveFiles(year, month, user);

    // Move BT05 to next stage (Data Entry Closed)
    await pool.query("UPDATE py_stdrate SET sun = 666, createdby = ? WHERE type = 'BT05'", [user]);

    res.json({
      status: 'SUCCESS',
      stage: 1,
      progress: 'Data Entry Closed',
      message: 'Payroll files saved successfully',
      logId: result.logId || result.insertId || null, 
      result
    });
  } catch (err) {
    console.error('Error saving payroll files:', err);
    res.status(500).json({ status: 'FAILED', message: err.message });
  }
};


