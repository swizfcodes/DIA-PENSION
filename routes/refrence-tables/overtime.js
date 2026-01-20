const express = require('express');
const pool = require('../../config/db'); // mysql2 pool
const verifyToken = require('../../middware/authentication');
const router = express.Router();

/* ============================================
   OVERTIME (BT03)
   ============================================ */

// Create BT03 if not exists
router.post('/overtime', verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT COUNT(*) as count FROM py_stdrate WHERE type = 'BT03'");
    if (rows[0].count > 0) {
      return res.status(400).json({ error: "Overtime (BT03) already exists" });
    }

    const data = { ...req.body };
    data.type = "BT03";
    data.createdby = req.user_fullname || "Admin User";

    await pool.query("INSERT INTO py_stdrate SET ?", data);
    res.status(201).json({ message: "New Overtime record created successfully" });
  } catch (err) {
    console.error("Error creating overtime:", err);
    res.status(500).json({ error: "Database error" });
  }
});

// Get BT03
router.get('/overtime', verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM py_stdrate WHERE type = 'BT03' LIMIT 1");
    res.json(rows[0] || {});
  } catch (err) {
    console.error("Error fetching overtime:", err);
    res.status(500).json({ error: "Database error" });
  }
});

// Update BT03
router.put('/overtime', verifyToken, async (req, res) => {
  try {
    const data = req.body;
    const [rows] = await pool.query("SELECT type FROM py_stdrate WHERE type = 'BT03' LIMIT 1");

    if (rows.length === 0) {
      return res.status(404).json({ error: "No overtime (BT03) record exists" });
    }

    await pool.query("UPDATE py_stdrate SET ? WHERE type = 'BT03'", [data]);
    res.json({ message: "Overtime record updated successfully" });
  } catch (err) {
    console.error("Error updating overtime:", err);
    res.status(500).json({ error: "Database error" });
  }
});



/* ============================================
   OVERPAYMENT ALARM (BT04)
   ============================================ */

// Create BT04 if not exists
router.post('/overpayment', verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT COUNT(*) as count FROM py_stdrate WHERE type = 'BT04'");
    if (rows[0].count > 0) {
      return res.status(400).json({ error: "Overpayment already exists" });
    }

    const data = { ...req.body };
    data.type = "BT04"; // enforce type
    data.createdby = req.user_fullname || "Admin User";

    await pool.query("INSERT INTO py_stdrate SET ?", data);
    res.status(201).json({ message: "New Overpayment record created successfully" });
  } catch (err) {
    console.error("Error creating overpayment:", err);
    res.status(500).json({ error: "Database error" });
  }
});

// Get BT04
router.get('/overpayment', verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM py_stdrate WHERE type = 'BT04' LIMIT 1");
    res.json(rows[0] || {});
  } catch (err) {
    console.error("Error fetching overpayment:", err);
    res.status(500).json({ error: "Database error" });
  }
});

// Update BT04 (edit overpayment alarm percentages or basicpay link)
router.put('/overpayment', verifyToken, async (req, res) => {
  try {
    const data = req.body;
    const [rows] = await pool.query("SELECT type FROM py_stdrate WHERE type = 'BT04' LIMIT 1");

    if (rows.length === 0) {
      return res.status(404).json({ error: "No overpayment record exists" });
    }

    await pool.query("UPDATE py_stdrate SET ? WHERE type = 'BT04'", [data]);
    res.json({ message: "Overpayment record updated successfully" });
  } catch (err) {
    console.error("Error updating overpayment:", err);
    res.status(500).json({ error: "Database error" });
  }
});

router.delete('/overpayment', verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT type FROM py_stdrate WHERE type = 'BT04' LIMIT 1");

    if (rows.length === 0) {
      return res.status(404).json({ error: "No overpayment record exists to delete" });
    }

    await pool.query("DELETE FROM py_stdrate WHERE type = 'BT04'");
    res.json({ message: "Successfully deleted an Overpayment record" });
  } catch (err) {
    console.error("Error deleting overpayment:", err);
    res.status(500).json({ error: "Database error" });
  }
});


/* ============================================
   PAYROLL STATUS (BT05)
   ============================================ */

// Create BT05 if not exists
router.post('/status', verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT COUNT(*) as count FROM py_stdrate WHERE type = 'BT05'");
    if (rows[0].count > 0) {
      return res.status(400).json({ error: "Payroll status (BT05) already exists" });
    }

    const data = { ...req.body };
    data.type = "BT05";
    data.sun = 0; // start with Data Entry open
    data.createdby = req.user_fullname || "Admin User";

    await pool.query("INSERT INTO py_stdrate SET ?", data);
    res.status(201).json({ message: "Payroll status (BT05) created successfully" });
  } catch (err) {
    console.error("Error creating status:", err);
    res.status(500).json({ error: "Database error" });
  }
});

// Get BT05
router.get('/status-payroll', verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM py_stdrate WHERE type = 'BT05' LIMIT 1");
    res.json(rows[0] || {});
  } catch (err) {
    console.error("Error fetching status:", err);
    res.status(500).json({ error: "Database error" });
  }
});

// Advance BT05 to next stage
router.put('/status/next', verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM py_stdrate WHERE type = 'BT05' LIMIT 1");
    if (rows.length === 0) {
      return res.status(404).json({ error: "No payroll status (BT05) record exists" });
    }

    const statusRow = rows[0];
    let nextSun;

    switch (statusRow.sun) {
      case 0:   // Data entry open → close
        nextSun = 666; break;
      case 666: // Closed → First report
        nextSun = 775; break;
      case 775: // First report → Two reports
        nextSun = 777; break;
      case 777: // Two reports → Update completed
        nextSun = 888; break;
      case 888: // Update completed → Calculation completed
        nextSun = 999; break;
      case 999: // End of cycle → reset
        nextSun = 0; break;
      default:  // fallback
        nextSun = 0;
    }

    await pool.query("UPDATE py_stdrate SET sun = ?, createdby = ? WHERE type = 'BT05'", [
      nextSun,
      req.user_fullname || "System Auto"
    ]);

    res.json({
      message: `Payroll status moved to ${nextSun}`,
      oldStatus: statusRow.sun,
      newStatus: nextSun
    });
  } catch (err) {
    console.error("Error updating payroll status:", err);
    res.status(500).json({ error: "Database error" });
  }
});

// Recall BT05 → reset to Data Entry open
router.put('/status/recall', verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM py_stdrate WHERE type = 'BT05' LIMIT 1");
    if (rows.length === 0) {
      return res.status(404).json({ error: "No payroll status (BT05) record exists" });
    }

    await pool.query("UPDATE py_stdrate SET sun = 0, createdby = ? WHERE type = 'BT05'", [
      req.user_fullname || "System Recall"
    ]);

    res.json({ message: "Payroll status recalled to Data Entry (0)" });
  } catch (err) {
    console.error("Error recalling status:", err);
    res.status(500).json({ error: "Database error" });
  }
});

// Month End → advance period & reset to Data Entry
router.put('/status/monthend', verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM py_stdrate WHERE type = 'BT05' LIMIT 1");
    if (rows.length === 0) {
      return res.status(404).json({ error: "No payroll status (BT05) record exists" });
    }

    const current = rows[0];
    const newMth = (current.mth || 0) + 1;   // move to next month
    const newPmth = current.mth || 0;        // current becomes prev

    await pool.query(
      "UPDATE py_stdrate SET mth = ?, pmth = ?, sun = 0, createdby = ? WHERE type = 'BT05'",
      [newMth, newPmth, req.user_fullname || "System MonthEnd"]
    );

    res.json({
      message: "Month End processed → moved to new period & reset to Data Entry",
      oldMth: current.mth,
      newMth
    });
  } catch (err) {
    console.error("Error processing month end:", err);
    res.status(500).json({ error: "Database error" });
  }
});

// Get current payroll period
router.get('/payroll-period', verifyToken, async (req, res) => {
  try {
    const userId = req.user_id;
    const currentClass = req.current_class;
    
    if (!currentClass) {
      return res.status(400).json({ 
        success: false, 
        error: 'No active payroll class' 
      });
    }
    
    const [rows] = await pool.query(
      `SELECT ord AS year, mth AS month FROM ${currentClass}.py_stdrate WHERE type = 'BT05' LIMIT 1`
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: 'Payroll period not found' 
      });
    }
    
    res.json({
      success: true,
      year: rows[0].year,
      month: rows[0].month
    });
    
  } catch (error) {
    console.error('Error fetching payroll period:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch payroll period' 
    });
  }
});

module.exports = router;



