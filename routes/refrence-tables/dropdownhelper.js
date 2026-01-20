const express = require('express');
const router = express.Router();
const pool = require('../../config/db'); // mysql2 pool
const verifyToken = require('../../middware/authentication');

const tables = {
  salarygroup: "py_salarygroup",
  salarygrade: "py_gradelevel",   
  bankbranch: "py_bank",
  bankcode: "py_bank",
  command: "py_navalcommand",   
  sex: "py_sex",
  relationship: "py_relationship",
  status: "py_status",
  country: "py_Country",
  marital: "py_MaritalStatus",
  title: "py_Title",
  specialisation: "py_specialisationarea",
  state: "py_tblstates",
  lga: "py_tblLGA",
  pfa: "py_pfa",
  religion: "py_religion",
  exittype: "py_exittype",
  elementtype: "py_elementType",
  geozone: "geozone",
  payrollclass: "py_payrollclass",
  location: "ac_costcentre",
  branch: "ac_businessline",
  oneoff: "py_oneofftype",
  ledger: "accchart",
  functiontype: "py_FunctionType",
  payindicator: "py_payind",
  payfrequency: "py_paydesc",
  entrymode: "entrymode"
};

// Get LGAs by State Code
router.get("/lga/:statecode", verifyToken, async (req, res) => {
  const { statecode } = req.params;
  
  try {
    const [rows] = await pool.query(
      `SELECT * FROM py_tblLGA WHERE Statecode = ?`, 
      [statecode]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// Generic GET for dropdowns
router.get("/:table", verifyToken, async (req, res) => {
  const table = req.params.table.toLowerCase();
  if (!tables[table]) return res.status(400).json({ error: "Invalid table" });

  try {
    const [rows] = await pool.query(`SELECT * FROM ${tables[table]}`);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;



