const express = require('express');
const pool = require('../../config/db');
const router = express.Router();
const verifyToken = require('../../middware/authentication');


router.get('/:id', verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, module, action, status, message, username, created_at, completed_at FROM py_process_log WHERE id = ?',
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;


