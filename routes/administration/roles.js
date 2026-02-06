// routes/roles.js
const express = require("express");
const path = require('path');
const pool = require('../../config/db');
const verifyToken = require('../../middware/authentication');
const dotenv = require('dotenv');
const envFile = 'production' ? '.env.production' : '.env.local';
dotenv.config({ path: path.resolve(__dirname, envFile) });
const router = express.Router();

// Get all roles
router.get("/roles", verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT id, name, description FROM roles ORDER BY name ASC");
    res.json(rows);
  } catch (err) {
    console.error("❌ Failed to fetch roles:", err.message);
    res.status(500).json({ error: "Failed to fetch roles" });
  }
});

//classes for user login
router.get("/classes", (req, res) => {
  const classes = [
    { id: process.env.DB_OFFICERS, name: "MILITARY STAFF" },
    { id: process.env.DB_WOFFICERS, name: "CIVILIAN STAFF" },
    { id: process.env.DB_RATINGS, name: "PENSION STAFF" },
    { id: process.env.DB_RATINGS_A, name: "NYSC ATTACHE" },
    { id: process.env.DB_RATINGS_B, name: "RUNNING COST" },
    // { id: process.env.DB_JUNIOR_TRAINEE, name: "TRAINEE" }
  ];
  res.json(classes);
});

// Get all dbs
router.get("/db_classes", verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT db_name, classname FROM py_payrollclass WHERE status = 'active' ORDER BY db_name ASC"
    );
    res.json(rows);
  } catch (err) {
    console.error("❌ Failed to fetch classname:", err.message);
    res.status(500).json({ error: "Failed to fetch db_classes" });
  }
});


// ============================
// CREATE ROLE
// ============================
router.post("/roles", verifyToken, async (req, res) => {
  const { name, description } = req.body;

  if (!name || !description)
    return res.status(400).json({ message: "Name and description required" });

  try {
    await pool.query(
      "INSERT INTO roles (name, description) VALUES (?, ?)",
      [name, description]
    );

    res.json({ message: "Role created" });
  } catch (err) {
    console.error("POST /roles error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// ============================
// UPDATE ROLE
// ============================
router.put("/roles/:id", verifyToken, async (req, res) => {
  const { id } = req.params;
  const { name, description } = req.body;

  if (!name || !description)
    return res.status(400).json({ message: "Name and description required" });

  try {
    await pool.query(
      "UPDATE roles SET name = ?, description = ? WHERE id = ?",
      [name, description, id]
    );

    res.json({ message: "Role updated" });
  } catch (err) {
    console.error("PUT /roles/:id error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// ============================
// DELETE ROLE
// ============================
router.delete("/roles/:id", verifyToken, async (req, res) => {
  const { id } = req.params;

  try {
    await pool.query("DELETE FROM roles WHERE id = ?", [id]);
    res.json({ message: "Role deleted" });
  } catch (err) {
    console.error("DELETE /roles/:id error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;


