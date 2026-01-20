const express = require('express');
const router = express.Router();
const pool = require('../../config/db'); // mysql2 pool
const verifyToken = require('../../middware/authentication');

// CREATE - Add new LGA
router.post("/postlga", verifyToken, async (req, res) => {
  try {
    const { Lgcode, Lgname, Lghqs, Statecode} = req.body;
    const createdby = req.user_fullname || "Admin User";
    const [result] = await pool.query(
      "INSERT INTO py_tblLGA (Lgcode, Lgname, Lghqs, Statecode, createdby, datecreated) VALUES (?, ?, ?, ?, ?, NOW())",
      [Lgcode, Lgname, Lghqs, Statecode, createdby]
    );
    res.status(201).json({ message: "New Local Government Area created", id: result.insertId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

//validation
router.get('/postlga/check/:field/:value', verifyToken, async (req, res) => {
  const { field, value } = req.params;
  const { exclude } = req.query;

  // Only allow specific fields to prevent SQL injection
  const allowedFields = ["Lgcode", "Lgname"];
  if (!allowedFields.includes(field)) {
    return res.status(400).json({ error: "Invalid field" });
  }

  try {
    let query = `SELECT ${field} FROM py_tblLGA WHERE ${field} = ?`;
    let params = [value];

    // If exclude Lgcode is provided, exclude that record from the check
    if (exclude) {
      query += ' AND Lgcode != ?';
      params.push(exclude);
    }

    const [existing] = await pool.query(query, params);

    res.json({ exists: existing.length > 0 });
  } catch (err) {
    console.error(`Error checking ${field}:`, err);
    res.status(500).json({ error: "Database error" });
  }
});

// READ - Get all LGAs
router.get("/lga", verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM py_tblLGA");
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// READ - Get one LGA by Lgcode
router.get("/:Lgcode", verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM py_tblLGA WHERE Lgcode = ?", [
      req.params.Lgcode,
    ]);
    if (rows.length === 0) return res.status(404).json({ message: "LGA not found" });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// UPDATE - Modify LGA
router.put("/:Lgcode", verifyToken, async (req, res) => {
  try {
    const { Lgname, Lghqs, Lgcode } = req.body;
    const [result] = await pool.query(
      "UPDATE py_tblLGA SET Lgname = ?, Lghqs = ?, Lgcode = ? WHERE Lgcode = ?",
      [Lgname, Lghqs, Lgcode, req.params.Lgcode]
    );
    if (result.affectedRows === 0) return res.status(404).json({ message: "LGA not found" });
    res.json({ message: "Successfully updated a Local Government Area record" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE - Remove LGA
router.delete("/:Lgcode", async (req, res) => {
  try {
    const [result] = await pool.query("DELETE FROM py_tblLGA WHERE Lgcode = ?", [
      req.params.Lgcode,
    ]);
    if (result.affectedRows === 0) return res.status(404).json({ message: "LGA not found" });
    res.json({ message: "Successfully deleted a Local Government Area record" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;


