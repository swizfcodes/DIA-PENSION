const express = require('express');
const router = express.Router();
const pool = require('../../config/db'); // mysql2 pool
const verifyToken = require('../../middware/authentication');


// Backend: /routes/payroll.js
router.post('/', verifyToken, async (req, res) => {
  try {
    const { year, month } = req.body;
    const user = req.user_fullname;

    const [result] = await pool.query(
      'CALL sp_calc_restore_optimized(?, ?, ?)',
      [year, month, user]
    );

    res.json({
      success: true,
      message: 'Payroll restored from backup',
      data: result[0][0]
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

module.exports = router;


