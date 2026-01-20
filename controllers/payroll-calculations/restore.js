const pool = require('../../config/db');
const restoreService = require('../../services/payroll-calculations/restore');

exports.restore = async (req, res) => {
  try {
    const [bt05Rows] = await pool.query("SELECT ord AS year, mth AS month, sun FROM py_stdrate WHERE type='BT05' LIMIT 1");
    if (!bt05Rows.length) return res.status(404).json({ error: 'BT05 not found' });
    const { year, month, sun } = bt05Rows[0];

    if (sun < 889) return res.status(400).json({ error: 'Backup must exist before restoring.' });

    const user = req.user_fullname || 'System Restore';
    const result = await restoreService.restoreBackup(year, month, user);

    await pool.query("UPDATE py_stdrate SET sun = 888, createdby = ? WHERE type = 'BT05'", [user]);

    res.json({ status: 'SUCCESS', stage: 'Restore', progress: 'Payroll restore completed', nextStage: 'Re-run backup/calculations', result });
  } catch (err) {
    console.error('Restore error:', err);
    res.status(500).json({ status: 'FAILED', message: err.message });
  }
};



