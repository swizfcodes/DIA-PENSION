const express = require('express');
const pool = require('../../config/db'); // mysql2 pool
const verifyToken = require('../../middware/authentication');
const router = express.Router();


// Get all exclusive types
router.get("/", verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM py_exclusiveType");
    res.json(rows);
  } catch (err) {
    console.error("Fetch failed:", err);
    res.status(500).json({ error: "Failed to fetch records" });
  }
});

// Get one exclusive type by typeH + typeL
router.get("/:typeH/:typeL", verifyToken, async (req, res) => {
  try {
    const { typeH, typeL } = req.params;
    const [rows] = await pool.query(
      "SELECT * FROM py_exclusiveType WHERE typeH = ? AND typeL = ?",
      [typeH, typeL]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Not found" });
    res.json(rows[0]);
  } catch (err) {
    console.error("Fetch one failed:", err);
    res.status(500).json({ error: "Failed to fetch record" });
  }
});

// Create new exclusive type
router.post("/post", verifyToken, async (req, res) => {
  try {
    const { typeH, typeL, typehdesc, typeldesc } = req.body;

    if (!typeH || !typeL) {
      return res.status(400).json({ error: "typeH and typeL are required" });
    }

    const sql = `
      INSERT INTO py_exclusiveType (typeH, typeL, typehdesc, typeldesc)
      VALUES (?, ?, ?, ?)
    `;

    await pool.query(sql, [
      typeH ? typeH.trim().toUpperCase() : null,
      typeL ? typeL.trim().toUpperCase() : null,
      typehdesc ? typehdesc.trim().toUpperCase() : null,
      typeldesc ? typeldesc.trim().toUpperCase() : null,
    ]);

    res.json({ message: "New Mutually Exclusive Record created successfully" });
  } catch (err) {
    console.error("Insert failed:", err);
    res.status(500).json({ error: "Insert failed" });
  }
});


// Update existing exclusive type
router.put("/:typeH/:typeL", verifyToken, async (req, res) => {
  try {
    // params (keys for the record)
    const { typeH, typeL } = req.params;
    // body (values to update)
    const { typehdesc, typeldesc } = req.body;

    const sql = `
      UPDATE py_exclusiveType
      SET typehdesc = ?, typeldesc = ?
      WHERE typeH = ? AND typeL = ?
    `;

    const [result] = await pool.query(sql, [
      typehdesc ? typehdesc.trim().toUpperCase() : null,
      typeldesc ? typeldesc.trim().toUpperCase() : null,
      typeH.trim().toUpperCase(),
      typeL.trim().toUpperCase(),
    ]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Record not found" });
    }

    res.json({ message: "Successfully updated a Mutually Exclusive record" });
  } catch (err) {
    console.error("Update failed:", err);
    res.status(500).json({ error: "Update failed" });
  }
});

// Delete exclusive type
router.delete("/:typeH/:typeL", verifyToken, async (req, res) => {
  try {
    const { typeH, typeL } = req.params;
    const [result] = await pool.query(
      "DELETE FROM py_exclusiveType WHERE typeH = ? AND typeL = ?",
      [typeH, typeL]
    );

    if (result.affectedRows === 0)
      return res.status(404).json({ error: "Record not found" });

    res.json({ message: "Successfully deleted a Mutually Exclusive record" });
  } catch (err) {
    console.error("Delete failed:", err);
    res.status(500).json({ error: "Delete failed" });
  }
});

module.exports = router;


