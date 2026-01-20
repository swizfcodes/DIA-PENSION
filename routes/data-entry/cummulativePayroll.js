const express = require('express');
const router = express.Router();
const pool = require('../../config/db'); // mysql2 pool
const verifyToken = require('../../middware/authentication');



//------------ API LOGICS -----------------//
//GET
router.get('/', verifyToken, async(req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM py_cumulated");
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

//GET SINGLE CUMMULATIVE
router.get('/:EmpL_ID', verifyToken, async(req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM py_cumulated WHERE EmpL_ID = ?", [req.params.EmpL_ID]);
    if (rows.length === 0) 
        return 
        res.status(404).json({ 
            error: "Not found" 
        });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ 
        error: err.message 
    });
  }
});

//POST
router.post('/create', verifyToken, async(req, res) => {
  let {
    EmpL_ID,
    taxabletodate,
    taxtodate,
    nettodate,
    grosstodate,
  } = req.body;

  const now = new Date();

  const createdby = req.user_fullname || "Admin User";
  const datecreated = now;
  const procmth = now.getMonth() + 1;

  try{
    // Validate required fields
    if (!EmpL_ID) {
      return res.status(400).json({ error: 'Service No is required' });
    }

    const [result] = await pool.query(`
      INSERT INTO py_cumulated
        (EmpL_ID,
        procmth,
        taxabletodate,
        taxtodate,
        nettodate,
        grosstodate,
        createdby, 
        datecreated)
        VALUES
        (?, ?, ?, ?, ?, ?, ?, ?)`
        ,
      [EmpL_ID, procmth, taxabletodate, taxtodate, nettodate, grosstodate, createdby, datecreated]
    );

    res.status(201).json({
        message: 'New Cummulative record created successfully',
        EmpL_ID
    });
  } catch (err) {
    console.error('Error creating cummulative record:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

//UPDATE
router.put('/:EmpL_ID', verifyToken, async(req, res) => {
    const {EmpL_ID} = req.params;
    const {
    taxabletodate,
    taxtodate,
    nettodate,
    grosstodate,
  } = req.body;

  try{
    // Check if SErvice No. exists
    const [existingRows] = await pool.query('SELECT EmpL_ID FROM py_cumulated WHERE EmpL_ID = ?', [EmpL_ID]);
    if (existingRows.length === 0) {
      return res.status(404).json({ error: 'Service No. not found' });
    }
    
    // Build dynamic update query
    const params = [];
    const sets = [];

    if (typeof EmpL_ID !== 'undefined' && EmpL_ID !== null) {
      sets.push('EmpL_ID = ?'); params.push(EmpL_ID);
    }
    if (typeof taxabletodate !== 'undefined' && taxabletodate !== null) {
      sets.push('taxabletodate = ?'); params.push(taxabletodate);
    }
    if (typeof taxtodate !== 'undefined' && taxtodate !== null) {
      sets.push('taxtodate = ?'); params.push(taxtodate);
    }
    if (typeof nettodate !== 'undefined' && nettodate !== null) {
      sets.push('nettodate = ?'); params.push(nettodate);
    }
    if (typeof grosstodate !== 'undefined' && grosstodate !== null) {
      sets.push('grosstodate = ?'); params.push(grosstodate);
    }

    if (sets.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    // Add PaymentType for WHERE clause
    params.push(EmpL_ID);

    const sql = `UPDATE py_cumulated SET ${sets.join(', ')} WHERE EmpL_ID = ?`;
    const [result] = await pool.query(sql, params);

    // Get updated record
    const [updatedRows] = await pool.query('SELECT * FROM py_cumulated WHERE EmpL_ID = ?', [EmpL_ID]);
    res.json({
      message: 'Successfully updated a Cummulative record',
      cummulative: updatedRows[0]
    });

  } catch (err) {
    console.error('Error updating cummulative record:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

//DELETE
router.delete('/:EmpL_ID', verifyToken, async(req, res) => {
  const { EmpL_ID } = req.params;
  
  try {
    const [result] = await pool.query('DELETE FROM py_cumulated WHERE EmpL_ID = ?', [EmpL_ID]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'SErvice No. not found' });
    }

    res.json({ 
      message: 'Successfully deleted a Cummulative record',
      EmpL_ID: EmpL_ID 
    });
    
  } catch(err){
    console.error('Error deleting cummulative record:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

module.exports = router;


