const express = require('express');
const router = express.Router();
const pool = require('../../config/db'); // mysql2 pool
const verifyToken = require('../../middware/authentication');

// CREATE
router.get('/department/check/:field/:value', verifyToken, async (req, res) => {
  const { field, value } = req.params;
  const { exclude } = req.query;

  // Only allow specific fields to prevent SQL injection
  const allowedFields = ["factcode", "deptcode", "factname", "deptname", "coordcode", "acct"];
  if (!allowedFields.includes(field)) {
    return res.status(400).json({ error: "Invalid field" });
  }

  try {
    let query = `SELECT ${field} FROM py_department WHERE ${field} = ?`;
    let params = [value];

    // If exclude deptcode is provided, exclude that record from the check
    if (exclude) {
      query += ' AND deptcode != ?';  
      params.push(exclude);
    }

    const [existing] = await pool.query(query, params);
    res.json({ exists: existing.length > 0 });
  } catch (err) {
    console.error(`Error checking ${field}:`, err);
    res.status(500).json({ error: "Database error" });
  }
});

// Updated POST route with validation
router.post("/post-department", verifyToken, async (req, res) => {
  try {
    let {
      factcode, deptcode, factname, deptname,
      coordcode, manager, hod, acct,
      misc1, misc2, misc3, AddressCode
    } = req.body;

    if (!factcode || !deptcode || !factname || !deptname || !coordcode || !acct) {
      return res.status(400).json({ error: 'Required fields: factcode, deptcode, factname, deptname, coordcode, acct' });
    }

    // Apply proper casing/formatting
    factcode = factcode.trim().toUpperCase();
    deptcode = deptcode.trim().toUpperCase();
    factname = toTitleCase(factname.trim());
    deptname = toTitleCase(deptname.trim());
    coordcode = coordcode.trim().toUpperCase();
    acct = acct.trim();

    const createdby = req.user_fullname || "Admin User";

    await pool.query(
      `INSERT INTO py_department 
      (factcode, deptcode, factname, deptname, coordcode, manager, hod, acct,
       misc1, misc2, misc3, AddressCode, createdby, datecreated)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [factcode, deptcode, factname, deptname, coordcode, manager, hod, acct,
       misc1, misc2, misc3, AddressCode, createdby]
    );

    res.status(201).json({ message: "New Department created" });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      res.status(400).json({ error: "Duplicate entry detected" });
    } else {
      res.status(500).json({ error: err.message });
    }
  }
});

// Helper function for title case
function toTitleCase(str) {
  return str.toLowerCase().split(' ').map(word => {
    return word.charAt(0).toUpperCase() + word.slice(1);
  }).join(' ');
}

// READ ALL
router.get("/department", verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM py_department");
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// READ ONE
router.get("/:factcode/:deptcode", verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT * FROM py_department WHERE factcode = ? AND deptcode = ?",
      [req.params.factcode, req.params.deptcode]
    );
    if (rows.length === 0) return res.status(404).json({ message: "Department not found" });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// UPDATE
router.put("/:factcode/:deptcode", verifyToken, async (req, res) => {
  try {
    const { factname, deptname, coordcode, manager, hod, acct,
            misc1, misc2, misc3, AddressCode } = req.body;

    const [result] = await pool.query(
      `UPDATE py_department SET 
       factname=?, deptname=?, coordcode=?, manager=?, hod=?, acct=?, 
       misc1=?, misc2=?, misc3=?, AddressCode=?
       WHERE factcode=? AND deptcode=?`,
      [factname, deptname, coordcode, manager, hod, acct,
       misc1, misc2, misc3, AddressCode,
       req.params.factcode, req.params.deptcode]
    );

    if (result.affectedRows === 0) return res.status(404).json({ message: "Department not found" });
    res.json({ message: "Successfully updated a Department record" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE
router.delete("/:factcode/:deptcode", verifyToken, async (req, res) => {
  try {
    const [result] = await pool.query(
      "DELETE FROM py_department WHERE factcode = ? AND deptcode = ?",
      [req.params.factcode, req.params.deptcode]
    );
    if (result.affectedRows === 0) return res.status(404).json({ message: "Department not found" });
    res.json({ message: "Successfully deleted a Department record" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;



