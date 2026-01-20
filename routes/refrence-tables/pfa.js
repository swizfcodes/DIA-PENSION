const express = require('express');
const pool = require('../../config/db'); // mysql2 pool
const verifyToken = require('../../middware/authentication');
const router = express.Router();

// GET all PFAs
router.get('/', verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM py_pfa ORDER BY pfacode');
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET single PFA by code
router.get('/:pfacode', verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM py_pfa WHERE pfacode = ?', [req.params.pfacode]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'PFA not found' });
    }
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

//validation
router.get('/check/:field/:value', verifyToken, async (req, res) => {
  const { field, value } = req.params;
  const { exclude } = req.query;

  // Only allow specific fields to prevent SQL injection
  const allowedFields = ["pfacode"];
  if (!allowedFields.includes(field)) {
    return res.status(400).json({ error: "Invalid field" });
  }

  try {
    let query = `SELECT ${field} FROM py_pfa WHERE ${field} = ?`;
    let params = [value];

    // If exclude pfacode is provided, exclude that record from the check
    if (exclude) {
      query += ' AND pfacode != ?';
      params.push(exclude);
    }

    const [existing] = await pool.query(query, params);

    res.json({ exists: existing.length > 0 });
  } catch (err) {
    console.error(`Error checking ${field}:`, err);
    res.status(500).json({ error: "Database error" });
  }
});

// CREATE new PFA
router.post('/post', verifyToken, async (req, res) => {
  try {
    const { pfacode, pfadesc, pfapfcname, pfapfc } = req.body;
    
    if (!pfacode) {
      return res.status(400).json({ error: 'pfacode is required' });
    }

    await pool.query(
      'INSERT INTO py_pfa (pfacode, pfadesc, pfapfcname, pfapfc) VALUES (?, ?, ?, ?)',
      [pfacode, pfadesc, pfapfcname, pfapfc]
    );
    
    res.status(201).json({ message: 'New PFA record created successfully', pfacode });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'PFA code already exists' });
    }
    res.status(500).json({ error: error.message });
  }
});

// UPDATE PFA
router.put('/:pfacode', verifyToken, async (req, res) => {
  try {
    const { pfadesc, pfapfcname, pfapfc } = req.body;
    
    const [result] = await pool.query(
      'UPDATE py_pfa SET pfadesc = ?, pfapfcname = ?, pfapfc = ? WHERE pfacode = ?',
      [pfadesc, pfapfcname, pfapfc, req.params.pfacode]
    );
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'PFA not found' });
    }
    
    res.json({ message: 'Successfully updated a PFA record' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE PFA
router.delete('/:pfacode', verifyToken, async (req, res) => {
  try {
    const [result] = await pool.query('DELETE FROM py_pfa WHERE pfacode = ?', [req.params.pfacode]);
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'PFA not found' });
    }
    
    res.json({ message: 'Successfully deleted a PFA record' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;


