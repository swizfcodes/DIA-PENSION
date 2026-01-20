const express = require('express');
const router = express.Router();
const pool = require('../../../config/db'); // mysql2 pool
const verifyToken = require('../../../middware/authentication');

// POST - Create new element type
router.post('/oneofftypes', verifyToken, async (req, res) => {
  let {
    one_type,
    one_perc,
    one_std,
    one_maxi,
    one_bpay,
    one_depend,
  } = req.body;

  const createdby = req.user_fullname || "Admin User";
  const datecreated = new Date();

  try {
    // Validate required fields
    if (!one_type || !one_bpay || !one_maxi) {
      return res.status(400).json({ error: 'one off type, Required for all, and Maximum amount are required fields'});
    }

    one_type = one_type.trim().toUpperCase();

    // Check if one_type already exists
    const [existing] = await pool.query('SELECT one_type FROM py_oneofftype WHERE one_type = ?', [one_type]);
    if (existing.length > 0) {
      return res.status(409).json({ error: 'Payment type already exists' });
    }

    const [result] = await pool.query(
      `INSERT INTO py_oneofftype 
       (one_type, one_perc, one_std, one_maxi, one_bpay, one_depend)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [one_type, one_perc, one_std, one_maxi, one_bpay ,one_depend, createdby, datecreated]
    );

    res.status(201).json({
      message: 'oneoff type created successfully',
      one_type,
      one_perc,
    });

  } catch (err) {
    console.error('Error creating oneoff type:', err);
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'One-Off type already exists' });
    }
    res.status(500).json({ error: 'Database error' });
  }
});

//validation
router.get('/oneofftypes/check/:field/:value', verifyToken, async (req, res) => {
  const { field, value } = req.params;
  const { exclude } = req.query;

  // Only allow specific fields to prevent SQL injection
  const allowedFields = ["one_type"];
  if (!allowedFields.includes(field)) {
    return res.status(400).json({ error: "Invalid field" });
  }

  try {
    let query = `SELECT ${field} FROM py_oneofftype WHERE ${field} = ?`;
    let params = [value];

    // If exclude one_type is provided, exclude that record from the check
    if (exclude) {
      query += ' AND one_type != ?';
      params.push(exclude);
    }

    const [existing] = await pool.query(query, params);

    res.json({ exists: existing.length > 0 });
  } catch (err) {
    console.error(`Error checking ${field}:`, err);
    res.status(500).json({ error: "Database error" });
  }
});



// GET - Get all element types
router.get('/oneofftypes', verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT one_type, one_perc, one_std, one_maxi, one_bpay, one_depend
      FROM py_oneofftype 
      ORDER BY one_type
    `);
    
    res.json(rows);
  } catch (err) {
    console.error('Error fetching oneoff types:', err);
    res.status(500).json({ error: 'Failed to fetch oneoff types' });
  }
});

// GET - Get individual oneoff type by one_type
router.get('/oneofftypes/:one_type', verifyToken, async (req, res) => {
  try {
    const { one_type } = req.params;
    const [rows] = await pool.query('SELECT * FROM py_oneofftype WHERE one_type = ?', [one_type]);
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'oneoff type not found' });
    }
    
    res.json(rows[0]);
  } catch (err) {
    console.error('Error fetching oneoff type:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// PUT - Update oneoff type
router.put('/oneofftypes/:one_type', verifyToken, async (req, res) => {
  const { one_type } = req.params;
  const {
    one_perc,
    one_std,
    one_maxi,
    one_bpay,
    one_depend,
  } = req.body;

  try {
    // Check if element type exists
    const [existingRows] = await pool.query('SELECT one_type FROM py_oneofftype WHERE one_type = ?', [one_type]);
    if (existingRows.length === 0) {
      return res.status(404).json({ error: 'Element type not found' });
    }

    // Build dynamic update query
    const params = [];
    const sets = [];

    if (typeof one_type !== 'undefined' && one_type !== null) {
      sets.push('one_type = ?'); params.push(one_type);
    }
    if (typeof one_perc !== 'undefined' && one_perc !== null) {
      sets.push('one_perc = ?'); params.push(one_perc);
    }
    if (typeof one_std !== 'undefined' && one_std !== null) {
      sets.push('one_std = ?'); params.push(one_std);
    }
    if (typeof one_maxi !== 'undefined' && one_maxi !== null) {
      sets.push('one_maxi = ?'); params.push(one_maxi);
    }
    if (typeof one_bpay !== 'undefined' && one_bpay !== null) {
      sets.push('one_bpay = ?'); params.push(one_bpay);
    }
    if (typeof one_depend !== 'undefined' && one_depend !== null) {
      sets.push('one_depend = ?'); params.push(one_depend);
    }

    if (sets.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    // Add one_type for WHERE clause
    params.push(one_type);

    const sql = `UPDATE py_oneofftype SET ${sets.join(', ')} WHERE one_type = ?`;
    const [result] = await pool.query(sql, params);

    // Get updated record
    const [updatedRows] = await pool.query('SELECT * FROM py_oneofftype WHERE one_type = ?', [one_type]);
    
    res.json({
      message: 'oneoff type updated successfully',
      oneoffType: updatedRows[0]
    });

  } catch (err) {
    console.error('Error updating oneoff type:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// DELETE - Delete oneoff type
router.delete('/oneofftypes/:one_type', verifyToken, async (req, res) => {
  const { one_type } = req.params;
  
  try {
    const [result] = await pool.query('DELETE FROM py_oneofftype WHERE one_type = ?', [one_type]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'oneoff type not found' });
    }

    res.json({ 
      message: 'oneoff type deleted successfully',
      one_type: one_type 
    });
    
  } catch (err) {
    console.error('Error deleting oneoff type:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

module.exports = router;


