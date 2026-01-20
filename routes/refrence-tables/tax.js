const express = require("express");
const router = express.Router();
const pool = require("../../config/db"); // mysql2 pool
const verifyToken = require("../../middware/authentication");

// ============================
// Helper: recalc lowbound & cumval for bands
// ============================
async function recalcBands() {
  // Select only tax bands, ignore INTER=999 (freepay row)
  const [rows] = await pool.query(
    "SELECT INTER, val FROM py_tax WHERE INTER <> 999 ORDER BY INTER ASC"
  );
  let mhold = 0;
  for (const row of rows) {
    const lowbound = mhold;
    const cumval = mhold + row.val;
    await pool.query(
      "UPDATE py_tax SET lowbound=?, cumval=? WHERE INTER=?",
      [lowbound, cumval, row.INTER]
    );
    mhold = cumval;
  }
}

// GET all bands (frontend sees only real bands)
router.get("/", verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT * FROM py_tax WHERE INTER <> 999 ORDER BY INTER ASC"
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET freepay (internal use only - not for frontend UI)
async function getFreePay() {
  const [rows] = await pool.query("SELECT val FROM py_tax WHERE INTER=999");
  if (rows.length === 0) return 0;
  return rows[0].val || 0;
}

// ============================
// GET single row by INTER (band or freepay row)
// ============================
router.get("/:INTER", verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT * FROM py_tax WHERE INTER = 999",
      [req.params.INTER]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Not found" });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================
// CREATE (band row or freepay row)
// ============================
router.post("/create", verifyToken, async (req, res) => {
  const { INTER, val, perc } = req.body;
  const createdby = req.user_fullname || "Admin User";

  try {
    await pool.query(
      "INSERT INTO py_tax (INTER, val, perc, createdby) VALUES (?, ?, ?, ?)",
      [INTER, val, perc || 0, createdby]
    );

    if (INTER != 999) {
      await recalcBands(); // only recalc bands
    }

    res.status(201).json({
      message:
        INTER == 999
          ? "Minimum free pay record created"
          : "Tax band created & recalculated",
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================
// UPDATE (band row or freepay row)
// ============================
router.put("/:INTER", verifyToken, async (req, res) => {
  const { val, perc } = req.body;

  try {
    const [result] = await pool.query(
      "UPDATE py_tax SET val=?, perc=? WHERE INTER=?",
      [val, perc || 0, req.params.INTER]
    );

    if (result.affectedRows === 0)
      return res.status(404).json({ error: "Not found" });

    if (req.params.INTER != 999) {
      await recalcBands(); // only recalc bands
    }

    res.json({
      message:
        req.params.INTER == 999
          ? "Minimum free pay updated"
          : "Tax band updated & recalculated",
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================
// DELETE (band row or freepay row)
// ============================
router.delete("/:INTER", verifyToken, async (req, res) => {
  try {
    const [result] = await pool.query("DELETE FROM py_tax WHERE INTER=?", [
      req.params.INTER,
    ]);

    if (result.affectedRows === 0)
      return res.status(404).json({ error: "Not found" });

    if (req.params.INTER != 999) {
      await recalcBands(); // only recalc bands
    }

    res.json({
      message:
        req.params.INTER == 999
          ? "Minimum free pay deleted"
          : "Tax band deleted & recalculated",
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function computeTax(grossPay) {
  // 1. Get minimum free pay
  const freepay = await getFreePay();

  // 2. Subtract relief
  let taxable = grossPay - freepay;
  if (taxable <= 0) return 0;

  // 3. Fetch bands in order
  const [bands] = await pool.query(
    "SELECT lowbound, cumval, perc FROM py_tax WHERE INTER <> 999 ORDER BY INTER ASC"
  );

  let totalTax = 0;

  // 4. Distribute taxable income into bands
  for (const band of bands) {
    if (taxable <= band.lowbound) break; // no income in this band

    const upper = Math.min(taxable, band.cumval);
    const portion = upper - band.lowbound;

    if (portion > 0) {
      totalTax += (portion * band.perc) / 100;
    }

    if (taxable <= band.cumval) break; // stop once salary is inside this band
  }

  return totalTax;
}

// Calculate tax for a given gross pay
router.post("/calculate", verifyToken, async (req, res) => {
  const { gross } = req.body;
  if (!gross || isNaN(gross)) {
    return res.status(400).json({ error: "Gross salary required" });
  }

  try {
    const tax = await computeTax(Number(gross));
    res.json({ gross, tax });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;



