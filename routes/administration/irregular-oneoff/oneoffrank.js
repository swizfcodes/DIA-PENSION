const express = require('express');
const router = express.Router();
const pool = require('../../../config/db.js'); // mysql2 pool
const verifyToken = require('../../../middware/authentication.js');


//------------- ONE-OFF PAY PER RANK ------------------

//validations
router.get('/check/:field/:value', verifyToken, async (req, res) => {
  const { field, value } = req.params;
  const { exclude } = req.query;

  // Only allow specific fields to prevent SQL injection
  const allowedFields = ["one_type"];
  if (!allowedFields.includes(field)) {
    return res.status(400).json({ error: "Invalid field" });
  }

  try {
    let query = `SELECT ${field} FROM py_oneoffrank WHERE ${field} = ?`;
    let params = [value];

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

// Get all payperrank records
router.get("/", verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM py_oneoffrank");
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
});

//  Get one by type
router.get("/:one_type", verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT * FROM py_oneoffrank WHERE one_type = ?",
      [req.params.one_type]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Not found" });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
});

//  Create new record
router.post("/oneoffrank", verifyToken, async (req, res) => {
  try {
    const payload = { ...req.body };

    // Ensure one_type exists and format it properly
    if (!payload.one_type) {
      return res.status(400).json({ error: "one_type is required" });
    }
    payload.one_type = payload.one_type.trim().toUpperCase();

    payload.datecreated = new Date();
    payload.createdby = req.user_fullname || "Admin User";

    const fields = Object.keys(payload);
    const values = Object.values(payload);

    const sql = `INSERT INTO py_oneoffrank (${fields.join(",")}) VALUES (${fields.map(() => "?").join(",")})`;
    await pool.query(sql, values);

    res.json({ message: "One-off rank amounts created successfully" });
  } catch (err) {
    console.error("Insert failed:", err);
    res.status(500).json({ error: "Insert failed" });
  }
});

// Update record by one_type
router.put("/:one_type", verifyToken, async (req, res) => {
  try {
    const { one_type } = req.params;
    const payload = req.body;

    if (!Object.keys(payload).length) {
      return res.status(400).json({ error: "No fields to update" });
    }

    const setClause = Object.keys(payload)
      .map((f) => `${f}=?`)
      .join(",");
    const values = Object.values(payload);

    await pool.query(
      `UPDATE py_oneoffrank SET ${setClause} WHERE one_type=?`,
      [...values, one_type]
    );

    res.json({ message: "One-off rank amounts updated successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Update failed" });
  }
});

// Delete record by one_type
router.delete("/:one_type", verifyToken, async (req, res) => {
  try {
    await pool.query("DELETE FROM py_oneoffrrank WHERE one_type=?", [
      req.params.one_type,
    ]);
    res.json({ message: "One-off rank amounts deleted successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Delete failed" });
  }
});

module.exports = router;


