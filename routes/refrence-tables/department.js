const express = require('express');
const router = express.Router();
const pool = require('../../config/db'); // mysql2 pool
const verifyToken = require('../../middware/authentication');


//--- LOCATION ---//

// Check for duplicate fields (used for validation)
router.get('/location/check/:field/:value', verifyToken, async (req, res) => {
  const { field, value } = req.params;
  const { exclude } = req.query;

  // Only allow specific fields to prevent SQL injection
  const allowedFields = ["unitcode"];
  if (!allowedFields.includes(field)) {
    return res.status(400).json({ error: "Invalid field" });
  }

  try {
    let query = `SELECT ${field} FROM ac_costcentre WHERE ${field} = ?`;
    let params = [value];

    // If exclude unitcode is provided, exclude that record from the check
    if (exclude) {
      query += ' AND unitcode != ?';
      params.push(exclude);
    }

    const [existing] = await pool.query(query, params);
    res.json({ exists: existing.length > 0 });
  } catch (err) {
    console.error(`Error checking ${field}:`, err);
    res.status(500).json({ error: "Database error" });
  }
});

// CREATE Location
router.post("/post-location", verifyToken, async (req, res) => {
  try {
    let { unitcode, unitdesc } = req.body;

    if (!unitcode || !unitdesc) {
      return res.status(400).json({ error: 'Required fields: unitcode, unitdesc' });
    }

    const createdby = req.user_fullname || "Admin User";

    await pool.query(
      `INSERT INTO ac_costcentre 
      (unitcode, unitdesc, createdby, datecreated)
      VALUES (?, ?, ?, NOW())`,
      [unitcode, unitdesc, createdby]
    );

    res.status(201).json({ message: "New location added" });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      res.status(400).json({ error: "Duplicate entry detected" });
    } else {
      res.status(500).json({ error: err.message });
    }
  }
});

// READ ALL Locations
router.get("/location", verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM ac_costcentre WHERE unitcode IS NOT NULL ORDER BY unitcode");
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// READ ONE Location
router.get("/location/:unitcode", verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT * FROM ac_costcentre WHERE unitcode = ?",
      [req.params.unitcode]
    );
    if (rows.length === 0) return res.status(404).json({ message: "Location not found" });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// UPDATE Location
router.put("/location/:unitcode", verifyToken, async (req, res) => {
  try {
    let { unitdesc } = req.body;
    
    if (!unitdesc) {
      return res.status(400).json({ error: 'Description is required' });
    }

    const [result] = await pool.query(
      `UPDATE ac_costcentre SET unitdesc = ? WHERE unitcode = ?`,
      [unitdesc, req.params.unitcode]
    );

    if (result.affectedRows === 0) return res.status(404).json({ message: "Location not found" });
    res.json({ message: "Successfully updated location record" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE Location
router.delete("/location/:unitcode", verifyToken, async (req, res) => {
  try {
    const [result] = await pool.query(
      "DELETE FROM ac_costcentre WHERE unitcode = ?",
      [req.params.unitcode]
    );
    if (result.affectedRows === 0) return res.status(404).json({ message: "Location not found" });
    res.json({ message: "Successfully deleted location record" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


//--- BRANCH ---//

// Check for duplicate fields (used for validation)
router.get('/branch/check/:field/:value', verifyToken, async (req, res) => {
  const { field, value } = req.params;
  const { exclude } = req.query;

  // Only allow specific fields to prevent SQL injection
  const allowedFields = ["busline"];
  if (!allowedFields.includes(field)) {
    return res.status(400).json({ error: "Invalid field" });
  }

  try {
    let query = `SELECT ${field} FROM ac_businessline WHERE ${field} = ?`;
    let params = [value];

    // If exclude busline is provided, exclude that record from the check
    if (exclude) {
      query += ' AND busline != ?';
      params.push(exclude);
    }

    const [existing] = await pool.query(query, params);
    res.json({ exists: existing.length > 0 });
  } catch (err) {
    console.error(`Error checking ${field}:`, err);
    res.status(500).json({ error: "Database error" });
  }
});

// CREATE Branch
router.post("/post-branch", verifyToken, async (req, res) => {
  try {
    let { busline, busdesc } = req.body;

    if (!busline || !busdesc) {
      return res.status(400).json({ error: 'Required fields: busline, busdesc' });
    }

    const createdby = req.user_fullname || "Admin User";

    await pool.query(
      `INSERT INTO ac_businessline 
      (busline, busdesc, createdby, datecreated)
      VALUES (?, ?, ?, NOW())`,
      [busline, busdesc, createdby]
    );

    res.status(201).json({ message: "New branch created" });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      res.status(400).json({ error: "Duplicate entry detected" });
    } else {
      res.status(500).json({ error: err.message });
    }
  }
});

// READ ALL Branches
router.get("/branch", verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM ac_businessline WHERE busline IS NOT NULL ORDER BY busline");
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// READ ONE Branch
router.get("/branch/:busline", verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT * FROM ac_businessline WHERE busline = ?",
      [req.params.busline]
    );
    if (rows.length === 0) return res.status(404).json({ message: "Branch not found" });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// UPDATE Branch
router.put("/branch/:busline", verifyToken, async (req, res) => {
  try {
    let { busdesc } = req.body;
    
    if (!busdesc) {
      return res.status(400).json({ error: 'Description is required' });
    }

    const [result] = await pool.query(
      `UPDATE ac_businessline SET busdesc = ? WHERE busline = ?`,
      [busdesc, req.params.busline]
    );

    if (result.affectedRows === 0) return res.status(404).json({ message: "Branch not found" });
    res.json({ message: "Successfully updated branch record" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE Branch
router.delete("/branch/:busline", verifyToken, async (req, res) => {
  try {
    const [result] = await pool.query(
      "DELETE FROM ac_businessline WHERE busline = ?",
      [req.params.busline]
    );
    if (result.affectedRows === 0) return res.status(404).json({ message: "Branch not found" });
    res.json({ message: "Successfully deleted branch record" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;