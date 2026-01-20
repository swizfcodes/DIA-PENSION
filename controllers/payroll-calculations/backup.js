const pool = require('../../config/db');
const backupService = require('../../services/payroll-calculations/backup');

exports.backup = async (req, res) => {
  try {
    const [bt05Rows] = await pool.query("SELECT ord AS year, mth AS month, sun FROM py_stdrate WHERE type='BT05' LIMIT 1");
    if (!bt05Rows.length) return res.status(404).json({ error: 'BT05 not found' });
    const { year, month, sun } = bt05Rows[0];

    if (sun < 888) return res.status(400).json({ error: 'Master File Update must be completed first.' });
    if (sun >= 889) return res.status(400).json({ error: 'Backup already completed.' });

    const user = req.user_fullname || 'System Auto';
    const result = await backupService.runBackup(year, month, user);

    await pool.query("UPDATE py_stdrate SET sun = 889, createdby = ? WHERE type = 'BT05'", [user]);

    res.json({ status: 'SUCCESS', stage: 5, progress: 'Backup completed', nextStage: 'Payroll Calculations', result });
  } catch (err) {
    console.error('Backup error:', err);
    res.status(500).json({ status: 'FAILED', message: err.message });
  }
};



