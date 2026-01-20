const express = require('express');
const router = express.Router();
const pool = require('../../config/db'); // mysql2 pool
const verifyToken = require('../../middware/authentication');



//------------ API LOGICS -----------------//
//GET
router.get('/', verifyToken, async(req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM py_documentation");
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET SINGLE DOCUMENTATION
router.get('/:doc_numb', verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT * FROM py_documentation WHERE doc_numb = ?",
      [req.params.doc_numb]
    );

    if (rows.length === 0)
      return res.status(404).json({ error: "Not found" }); 
    return res.json(rows[0]);
  } catch (err) {
    console.error("Error fetching documentation:", err);
    return res.status(500).json({ error: err.message });
  }
});

//POST
router.post('/create', verifyToken, async(req, res) => {
  let {
    doc_numb,
    doc_year,
    doc_month,
    doc_ref,
    doc_remark,
  } = req.body;

  const createdby = req.user_fullname || "Admin User";
  const datecreated = new Date();

  try{
    // Validate required fields
    if (!doc_numb) {
      return res.status(400).json({ error: 'Service No is required' });
    }

    const [result] = await pool.query(`
      INSERT INTO py_documentation
        (doc_numb,
        doc_year,
        doc_month,
        doc_ref,
        doc_remark,
        createdby, 
        datecreated)
        VALUES
        (?, ?, ?, ?, ?, ?, ?)`,
      [doc_numb, doc_year, doc_month, doc_ref, doc_remark, createdby, datecreated]
    );

    res.status(201).json({
        message: 'New Documentation record created successfully',
        doc_numb
    });
  } catch (err) {
    console.error('Error creating documentation:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

//UPDATE
router.put('/:doc_numb', verifyToken, async(req, res) => {
    const {doc_numb} = req.params;
    const {
    doc_year,
    doc_month,
    doc_ref,
    doc_remark,
  } = req.body;

  try{
    // Check if SErvice No. exists
    const [existingRows] = await pool.query('SELECT doc_numb FROM py_documentation WHERE doc_numb = ?', [doc_numb]);
    if (existingRows.length === 0) {
      return res.status(404).json({ error: 'Service No. not found' });
    }
    
    // Build dynamic update query
    const params = [];
    const sets = [];

    if (typeof doc_numb !== 'undefined' && doc_numb !== null) {
      sets.push('doc_numb = ?'); params.push(doc_numb);
    }
    if (typeof doc_year !== 'undefined' && doc_year !== null) {
      sets.push('doc_year = ?'); params.push(doc_year);
    }
    if (typeof doc_month !== 'undefined' && doc_month !== null) {
      sets.push('doc_month = ?'); params.push(doc_month);
    }
    if (typeof doc_ref !== 'undefined' && doc_ref !== null) {
      sets.push('doc_ref = ?'); params.push(doc_ref);
    }
    if (typeof doc_remark !== 'undefined' && doc_remark !== null) {
      sets.push('doc_remark = ?'); params.push(doc_remark);
    }

    if (sets.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    // Add PaymentType for WHERE clause
    params.push(doc_numb);

    const sql = `UPDATE py_documentation SET ${sets.join(', ')} WHERE doc_numb = ?`;
    const [result] = await pool.query(sql, params);

    // Get updated record
    const [updatedRows] = await pool.query('SELECT * FROM py_documentation WHERE doc_numb = ?', [doc_numb]);
    res.json({
      message: 'Successfully updated a Documentation record',
      documentation: updatedRows[0]
    });

  } catch (err) {
    console.error('Error updating documentation:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

//DELETE
router.delete('/:doc_numb', verifyToken, async(req, res) => {
  const { doc_numb } = req.params;
  
  try {
    const [result] = await pool.query('DELETE FROM py_documentation WHERE doc_numb = ?', [doc_numb]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'SErvice No. not found' });
    }

    res.json({ 
      message: 'Successfully deleted a Documentation record',
      doc_numb: doc_numb 
    });
    
  } catch(err){
    console.error('Error deleting documentation record:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

module.exports = router;


