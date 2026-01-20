const express = require('express');
const router = express.Router();
const pool = require('../../config/db'); // mysql2 pool
const verifyToken = require('../../middware/authentication');


router.get('/:year/:month', verifyToken, async (req, res) => {
  try {
    const { year, month } = req.params;

    const [result] = await pool.query(
      'CALL sp_get_payroll_status(?, ?)',
      [year, month]
    );

    res.json({
      success: true,
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


