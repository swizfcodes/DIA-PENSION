const express = require('express');
const pool = require('../../config/db'); // mysql2 pool
const verifyToken = require('../../middware/authentication');
const router = express.Router();

// POST - Create new state
router.post('/states', verifyToken, async (req, res) => {
  // Accept both formats (camelCase from frontend, PascalCase from DB)
  let Statecode = req.body.Statecode || req.body.stateCode;
  let Statename = req.body.Statename || req.body.stateName;
  let Statecapital = req.body.Statecapital || req.body.stateCapital;
  let geoZone = req.body.GeoZone || req.body.geoZone;
  const createdby = req.user_fullname || "Admin User";
  const datecreated = new Date();

  try {
    if (!Statecode || !Statename || !Statecapital || !geoZone) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    
    // State codes should be uppercase (standard convention: CA, TX, NY, etc.)
    Statecode = Statecode.trim().toUpperCase();
    
    // State names should be in Title Case (proper nouns)
    Statename = toTitleCase(Statename.trim());
    
    // State capitals should be in Title Case (proper nouns)
    Statecapital = toTitleCase(Statecapital.trim());

    const [result] = await pool.query(
      `INSERT INTO py_tblstates 
       (Statecode, Statename, Statecapital, createdby, datecreated, geoZone) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [Statecode, Statename, Statecapital, createdby, datecreated, geoZone]
    );

    res.status(201).json({
      message: 'New State created successfully',
      id: result.insertId,
      Statecode,
      Statename,
      Statecapital,
      createdby,
      geoZone
    });

  } catch (err) {
    console.error('Error creating state:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Helper function for proper title casing
function toTitleCase(str) {
  return str.toLowerCase().split(' ').map(word => {
    // Handle common exceptions (articles, prepositions, conjunctions)
    const exceptions = ['of', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'with', 'by'];
    
    // Always capitalize first word, otherwise check exceptions
    if (word.length === 0) return word;
    
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  }).join(' ');
}

//validation
router.get('/states/check/:field/:value', verifyToken, async (req, res) => {
  const { field, value } = req.params;
  const { exclude } = req.query;

  // Only allow specific fields to prevent SQL injection
  const allowedFields = ["stateName", "stateCapital", "stateCode"];
  if (!allowedFields.includes(field)) {
    return res.status(400).json({ error: "Invalid field" });
  }

  try {
    let query = `SELECT ${field} FROM py_tblstates WHERE ${field} = ?`;
    let params = [value];

    // If exclude stateCode is provided, exclude that record from the check
    if (exclude) {
      query += ' AND stateCode != ?';
      params.push(exclude);
    }

    const [existing] = await pool.query(query, params);

    res.json({ exists: existing.length > 0 });
  } catch (err) {
    console.error(`Error checking ${field}:`, err);
    res.status(500).json({ error: "Database error" });
  }
});

// GET - Get all states
router.get("/states", verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM py_tblstates");
    res.json(rows);
  } catch (err) {
    console.error("Error fetching states:", err);
    res.status(500).json({ error: "Failed to fetch states" });
  }
});

// GET - Get all states for dropdowns
router.get("/dropdown-states", verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT Statecode, Statename FROM py_tblstates ORDER BY Statename ASC");
    res.json(rows);
  } catch (err) {
    console.error("Error fetching states:", err);
    res.status(500).json({ error: "Failed to fetch states" });
  }
});

// GET - Get individual state by Statecode
router.get('/states/:Statecode', verifyToken, async (req, res) => {
  try {
    const { Statecode } = req.params;
    const [rows] = await pool.query('SELECT * FROM py_tblstates WHERE Statecode = ?', [Statecode]);
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'State not found' });
    }
    
    res.json(rows[0]);
  } catch (err) {
    console.error('Error fetching state:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// PUT - Update state
router.put('/states/:Statecode', verifyToken, async (req, res) => {
  const { Statecode } = req.params;
  // Accept both formats from frontend
  let Statename = req.body.Statename || req.body.stateName;
  let Statecapital = req.body.Statecapital || req.body.stateCapital;
  //const createdby = req.user_fullname || "Admin User";
  let geoZone = req.body.GeoZone || req.body.geoZone;

  try {
    // Check if state exists first
    const [existingRows] = await pool.query('SELECT * FROM py_tblstates WHERE Statecode = ?', [Statecode]);
    if (existingRows.length === 0) {
      return res.status(404).json({ error: 'State not found' });
    }

    // Build dynamic update query
    const params = [];
    const sets = [];

    if (typeof Statename !== 'undefined' && Statename !== null) {
      sets.push('Statename = ?');
      params.push(Statename);
    }
    if (typeof Statecapital !== 'undefined' && Statecapital !== null) {
      sets.push('Statecapital = ?');
      params.push(Statecapital);
    }
    if (typeof createdby !== 'undefined' && createdby !== null) {
      sets.push('createdby = ?');
      params.push(createdby);
    }
   if (typeof geoZone !== 'undefined' && geoZone !== null) {
      sets.push('geoZone = ?');
      params.push(geoZone);
    }

    // If no fields to update
    if (sets.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    // Add Statecode for WHERE clause
    params.push(Statecode);

    const sql = `UPDATE py_tblstates SET ${sets.join(', ')} WHERE Statecode = ?`;
    const [result] = await pool.query(sql, params);

    // Get updated record
    const [updatedRows] = await pool.query('SELECT * FROM py_tblstates WHERE Statecode = ?', [Statecode]);
    
    res.json({
      message: 'Successfully updated a State record',
      state: updatedRows[0]
    });

  } catch (err) {
    console.error('Error updating state:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// DELETE - Delete state
router.delete('/states/:Statecode', verifyToken, async (req, res) => {
  const { Statecode } = req.params;
  
  try {
    const [result] = await pool.query('DELETE FROM py_tblstates WHERE Statecode = ?', [Statecode]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'State not found' });
    }

    res.json({ 
      message: 'Successfully deleted a State record',
      Statecode: Statecode 
    });
    
  } catch (err) {
    console.error('Error deleting state:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

module.exports = router;


