const express = require('express');
const pool = require('../../config/db'); // mysql2 pool
const verifyToken = require('../../middware/authentication');
const router = express.Router();

// CREATE - Add new salary scale
router.post('/salary-scales', verifyToken, async (req, res) => {
    try {
        const {
            salcode, saltype, grade, step1, step2, step3, step4, step5,
            step6, step7, step8, step9, step10, step11, step12, step13,
            step14, step15, step16, step17, step18, step19, step20
        } = req.body;

        const user =  req.user_fullname || "Admin User";

        // Validate required fields
        if (!salcode || !saltype || !grade) {
            return res.status(400).json({
                error: 'Missing required fields: salcode, saltype, grade'
            });
        }

        const query = `
            INSERT INTO py_salaryscale (
                salcode, saltype, grade, step1, step2, step3, step4, step5,
                step6, step7, step8, step9, step10, step11, step12, step13,
                step14, step15, step16, step17, step18, step19, step20, user
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        const values = [
            salcode, saltype, grade, step1, step2, step3, step4, step5,
            step6, step7, step8, step9, step10, step11, step12, step13,
            step14, step15, step16, step17, step18, step19, step20, user
        ];

        const [result] = await pool.query(query, values);

        res.status(201).json({
            message: 'New Salary scale record created successfully',
            data: { salcode, saltype, grade }
        });

    } catch (error) {
        console.error('Error creating salary scale:', error);
        if (error.code === 'ER_DUP_ENTRY') {
            res.status(409).json({ error: 'Salary scale already exists' });
        } else {
            res.status(500).json({ error: 'Internal server error' });
        }
    }
});

// READ - Get all salary scales
router.get('/salary-scales', verifyToken, async (req, res) => {
  try {
    const query = `
      SELECT * 
      FROM py_salaryscale 
      ORDER BY salcode, saltype, grade
    `;
    const [rows] = await pool.query(query);

    res.json({ data: rows });
  } catch (error) {
    console.error('Error fetching salary scales:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// READ - Get single salary scale by composite key
router.get('/salary-scales/:salcode/:saltype/:grade', verifyToken, async (req, res) => {
    try {
        const { salcode, saltype, grade } = req.params;

        if (!salcode || !saltype || !grade) {
            return res.status(400).json({
                error: 'Missing required parameters: salcode, saltype, grade'
            });
        }

        const query = 'SELECT * FROM py_salaryscale WHERE salcode = ? AND saltype = ? AND grade = ?';
        const [rows] = await pool.query(query, [salcode, saltype, grade]);

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Salary scale not found' });
        }

        res.json({ data: rows[0] });

    } catch (error) {
        console.error('Error fetching salary scale:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// READ - Search salary scales by filters
router.get('/salary-scales/search', verifyToken, async (req, res) => {
    try {
        const { salcode, saltype, grade, user } = req.query;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const offset = (page - 1) * limit;

        let whereClause = '';
        let params = [];

        const conditions = [];
        if (salcode) {
            conditions.push('salcode LIKE ?');
            params.push(`%${salcode}%`);
        }
        if (saltype) {
            conditions.push('saltype LIKE ?');
            params.push(`%${saltype}%`);
        }
        if (grade) {
            conditions.push('grade = ?');
            params.push(grade);
        }
        if (user) {
            conditions.push('user LIKE ?');
            params.push(`%${user}%`);
        }

        if (conditions.length > 0) {
            whereClause = 'WHERE ' + conditions.join(' AND ');
        }

        // Count total matching records
        const countQuery = `SELECT COUNT(*) as total FROM py_salaryscale ${whereClause}`;
        const [countResult] = await pool.query(countQuery, params);
        const total = countResult[0].total;

        // Get paginated search results
        const query = `
            SELECT * FROM py_salaryscale ${whereClause} 
            ORDER BY salcode, saltype, grade 
            LIMIT ? OFFSET ?
        `;
        params.push(limit, offset);

        const [rows] = await pool.query(query, params);

        res.json({
            data: rows,
            pagination: {
                currentPage: page,
                totalPages: Math.ceil(total / limit),
                totalRecords: total,
                recordsPerPage: limit
            }
        });

    } catch (error) {
        console.error('Error searching salary scales:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// UPDATE - Update existing salary scale
router.put('/salary-scales/:salcode/:saltype/:grade', verifyToken, async (req, res) => {
    try {
        const { salcode, saltype, grade } = req.params;
        const updateData = req.body;

        if (!salcode || !saltype || !grade) {
            return res.status(400).json({
                error: 'Missing required parameters: salcode, saltype, grade'
            });
        }

        // Remove composite key fields from update data to prevent modification
        delete updateData.salcode;
        delete updateData.saltype;
        delete updateData.grade;

        if (Object.keys(updateData).length === 0) {
            return res.status(400).json({ error: 'No fields to update' });
        }

        // Build dynamic update query
        const updateFields = Object.keys(updateData).map(field => `${field} = ?`).join(', ');
        const updateValues = Object.values(updateData);

        const query = `
            UPDATE py_salaryscale 
            SET ${updateFields} 
            WHERE salcode = ? AND saltype = ? AND grade = ?
        `;

        updateValues.push(salcode, saltype, grade);

        const [result] = await pool.query(query, updateValues);

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Salary scale not found' });
        }

        res.json({
            message: 'Successfully updated a Salary scale record',
            data: { salcode, saltype, grade }
        });

    } catch (error) {
        console.error('Error updating salary scale:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// DELETE - Delete salary scale
router.delete('/salary-scales/:salcode/:saltype/:grade', verifyToken, async (req, res) => {
    try {
        const { salcode, saltype, grade } = req.params;

        if (!salcode || !saltype || !grade) {
            return res.status(400).json({
                error: 'Missing required parameters: salcode, saltype, grade'
            });
        }

        const query = 'DELETE FROM py_salaryscale WHERE salcode = ? AND saltype = ? AND grade = ?';
        const [result] = await pool.query(query, [salcode, saltype, grade]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Salary scale not found' });
        }

        res.json({
            message: 'Successfully deleted a salary scale record',
            data: { salcode, saltype, grade }
        });

    } catch (error) {
        console.error('Error deleting salary scale:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// UTILITY - Get salary for specific step
router.get('/salary-scales/:salcode/:saltype/:grade/step/:step', verifyToken, async (req, res) => {
    try {
        const { salcode, saltype, grade, step } = req.params;

        if (!salcode || !saltype || !grade || !step) {
            return res.status(400).json({
                error: 'Missing required parameters: salcode, saltype, grade, step'
            });
        }

        const stepNum = parseInt(step);
        if (stepNum < 1 || stepNum > 19) {
            return res.status(400).json({ error: 'Step must be between 1 and 19' });
        }

        // Get the salary scale record including step20 (max progression limit)
        const query = `SELECT step${stepNum} as salary, step20 as max_step FROM py_salaryscale WHERE salcode = ? AND saltype = ? AND grade = ?`;
        const [rows] = await pool.query(query, [salcode, saltype, grade]);

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Salary scale not found' });
        }

        const maxStep = parseInt(rows[0].max_step);
        
        // Check if requested step exceeds maximum allowed progression
        if (stepNum > maxStep) {
            return res.status(400).json({
                error: `Step ${stepNum} exceeds maximum progression limit`,
                maxAllowedStep: maxStep
            });
        }

        res.json({
            data: {
                salcode,
                saltype,
                grade,
                step: stepNum,
                salary: rows[0].salary,
                maxProgressionStep: maxStep
            }
        });

    } catch (error) {
        console.error('Error fetching salary by step:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// UTILITY - Get available progression steps for a salary scale
router.get('/salary-scales/:salcode/:saltype/:grade/progression-steps', verifyToken, async (req, res) => {
    try {
        const { salcode, saltype, grade } = req.params;

        if (!salcode || !saltype || !grade) {
            return res.status(400).json({
                error: 'Missing required parameters: salcode, saltype, grade'
            });
        }

        const query = `SELECT step20 as max_step FROM py_salaryscale WHERE salcode = ? AND saltype = ? AND grade = ?`;
        const [rows] = await pool.query(query, [salcode, saltype, grade]);

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Salary scale not found' });
        }

        const maxStep = parseInt(rows[0].max_step);
        const availableSteps = [];
        
        for (let i = 1; i <= maxStep; i++) {
            availableSteps.push(i);
        }

        res.json({
            data: {
                salcode,
                saltype,
                grade,
                maxProgressionStep: maxStep,
                availableSteps: availableSteps
            }
        });

    } catch (error) {
        console.error('Error fetching progression steps:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// UTILITY - Validate employee progression
router.post('/salary-scales/validate-progression', verifyToken, async (req, res) => {
    try {
        const { salcode, saltype, grade, currentStep, newStep } = req.body;

        if (!salcode || !saltype || !grade || !currentStep || !newStep) {
            return res.status(400).json({
                error: 'Missing required fields: salcode, saltype, grade, currentStep, newStep'
            });
        }

        const query = `SELECT step20 as max_step FROM py_salaryscale WHERE salcode = ? AND saltype = ? AND grade = ?`;
        const [rows] = await pool.query(query, [salcode, saltype, grade]);

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Salary scale not found' });
        }

        const maxStep = parseInt(rows[0].max_step);
        const currentStepNum = parseInt(currentStep);
        const newStepNum = parseInt(newStep);

        const validation = {
            isValid: true,
            messages: [],
            maxProgressionStep: maxStep
        };

        if (newStepNum < 1 || newStepNum > 19) {
            validation.isValid = false;
            validation.messages.push('New step must be between 1 and 19');
        }

        if (newStepNum > maxStep) {
            validation.isValid = false;
            validation.messages.push(`New step ${newStepNum} exceeds maximum progression limit of ${maxStep}`);
        }

        if (newStepNum <= currentStepNum) {
            validation.isValid = false;
            validation.messages.push('New step must be higher than current step');
        }

        if (newStepNum > currentStepNum + 1) {
            validation.messages.push('Warning: Skipping steps in progression');
        }

        res.json({
            data: validation
        });

    } catch (error) {
        console.error('Error validating progression:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});


//---------------------------------- SALARY GROUP --------------------------------//

// CREATE - Add new salary group
router.post('/salary-groups', verifyToken, async (req, res) => {
    try {
        const { groupcode, effdate, lastdate, grpdesc } = req.body;

        // Validate required fields
        if (!groupcode) {
            return res.status(400).json({
                error: 'Missing required field: groupcode'
            });
        }

        // Validate date format if provided (assuming YYYY-MM-DD format)
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (effdate && !dateRegex.test(effdate)) {
            return res.status(400).json({
                error: 'Invalid effdate format. Use YYYY-MM-DD'
            });
        }
        if (lastdate && !dateRegex.test(lastdate)) {
            return res.status(400).json({
                error: 'Invalid lastdate format. Use YYYY-MM-DD'
            });
        }

        // Validate date logic
        if (effdate && lastdate && new Date(effdate) > new Date(lastdate)) {
            return res.status(400).json({
                error: 'Effective date cannot be greater than last date'
            });
        }

        const query = `
            INSERT INTO py_salarygroup (groupcode, effdate, lastdate, grpdesc)
            VALUES (?, ?, ?, ?)
        `;

        const values = [groupcode.trim().toUpperCase(), effdate, lastdate, grpdesc];

        const [result] = await pool.query(query, values);

        res.status(201).json({
            message: 'Successfully created a New Salary group',
            data: { groupcode, effdate, lastdate, grpdesc }
        });

    } catch (error) {
        console.error('Error creating salary group:', error);
        if (error.code === 'ER_DUP_ENTRY') {
            res.status(409).json({ error: 'Salary group with this groupcode already exists' });
        } else {
            res.status(500).json({ error: 'Internal server error' });
        }
    }
});

// READ - Get all salary groups
router.get('/salary-groups', verifyToken, async (req, res) => {
  try {
    const query = `
      SELECT groupcode, effdate, lastdate, grpdesc, created_at, updated_at
      FROM py_salarygroup 
      ORDER BY groupcode
    `;

    const [rows] = await pool.query(query);

    res.json({
      data: rows
    });
  } catch (error) {
    console.error('Error fetching salary groups:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// READ - Get single salary group by groupcode
router.get('/salary-groups/:groupcode', verifyToken, async (req, res) => {
    try {
        const { groupcode } = req.params;

        if (!groupcode) {
            return res.status(400).json({
                error: 'Missing required parameter: groupcode'
            });
        }

        const query = 'SELECT * FROM py_salarygroup WHERE groupcode = ?';
        const [rows] = await pool.query(query, [groupcode]);

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Salary group not found' });
        }

        res.json({ data: rows[0] });

    } catch (error) {
        console.error('Error fetching salary group:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// READ - Search salary groups by filters
router.get('/salary-groups/search', verifyToken, async (req, res) => {
    try {
        const { groupcode, grpdesc, effdate, lastdate } = req.query;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const offset = (page - 1) * limit;

        let whereClause = '';
        let params = [];

        const conditions = [];
        if (groupcode) {
            conditions.push('groupcode LIKE ?');
            params.push(`%${groupcode}%`);
        }
        if (grpdesc) {
            conditions.push('grpdesc LIKE ?');
            params.push(`%${grpdesc}%`);
        }
        if (effdate) {
            conditions.push('effdate = ?');
            params.push(effdate);
        }
        if (lastdate) {
            conditions.push('lastdate = ?');
            params.push(lastdate);
        }

        if (conditions.length > 0) {
            whereClause = 'WHERE ' + conditions.join(' AND ');
        }

        // Count total matching records
        const countQuery = `SELECT COUNT(*) as total FROM py_salarygroup ${whereClause}`;
        const [countResult] = await pool.query(countQuery, params);
        const total = countResult[0].total;

        // Get paginated search results
        const query = `
            SELECT * FROM py_salarygroup ${whereClause} 
            ORDER BY groupcode 
            LIMIT ? OFFSET ?
        `;
        params.push(limit, offset);

        const [rows] = await pool.query(query, params);

        res.json({
            data: rows,
            pagination: {
                currentPage: page,
                totalPages: Math.ceil(total / limit),
                totalRecords: total,
                recordsPerPage: limit
            }
        });

    } catch (error) {
        console.error('Error searching salary groups:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// UPDATE - Update existing salary group
router.put('/salary-groups/:groupcode', verifyToken, async (req, res) => {
    try {
        const { groupcode } = req.params;
        const updateData = req.body;

        if (!groupcode) {
            return res.status(400).json({
                error: 'Missing required parameter: groupcode'
            });
        }

        // Remove groupcode from update data to prevent modification of primary key
        delete updateData.groupcode;

        if (Object.keys(updateData).length === 0) {
            return res.status(400).json({ error: 'No fields to update' });
        }

        // Validate date format if provided
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (updateData.effdate && !dateRegex.test(updateData.effdate)) {
            return res.status(400).json({
                error: 'Invalid effdate format. Use YYYY-MM-DD'
            });
        }
        if (updateData.lastdate && !dateRegex.test(updateData.lastdate)) {
            return res.status(400).json({
                error: 'Invalid lastdate format. Use YYYY-MM-DD'
            });
        }

        // Get current record to validate date logic
        if (updateData.effdate || updateData.lastdate) {
            const [currentRecord] = await pool.query(
                'SELECT effdate, lastdate FROM py_salarygroup WHERE groupcode = ?',
                [groupcode]
            );

            if (currentRecord.length === 0) {
                return res.status(404).json({ error: 'Salary group not found' });
            }

            const currentEffDate = updateData.effdate || currentRecord[0].effdate;
            const currentLastDate = updateData.lastdate || currentRecord[0].lastdate;

            if (currentEffDate && currentLastDate && new Date(currentEffDate) > new Date(currentLastDate)) {
                return res.status(400).json({
                    error: 'Effective date cannot be greater than last date'
                });
            }
        }

        // Build dynamic update query
        const updateFields = Object.keys(updateData).map(field => `${field} = ?`).join(', ');
        const updateValues = Object.values(updateData);

        const query = `
            UPDATE py_salarygroup 
            SET ${updateFields} 
            WHERE groupcode = ?
        `;

        updateValues.push(groupcode);

        const [result] = await pool.query(query, updateValues);

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Salary group not found' });
        }

        res.json({
            message: 'Successfully updated a Salary group record',
            data: { groupcode }
        });

    } catch (error) {
        console.error('Error updating salary group:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// DELETE - Delete salary group
router.delete('/salary-groups/:groupcode', verifyToken, async (req, res) => {
    try {
        const { groupcode } = req.params;

        if (!groupcode) {
            return res.status(400).json({
                error: 'Missing required parameter: groupcode'
            });
        }

        const query = 'DELETE FROM py_salarygroup WHERE groupcode = ?';
        const [result] = await pool.query(query, [groupcode]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Salary group not found' });
        }

        res.json({
            message: 'Successfully deleted a Salary group record',
            data: { groupcode }
        });

    } catch (error) {
        console.error('Error deleting salary group:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// UTILITY - Get active salary groups (where current date is between effdate and lastdate)
router.get('/salary-groups/active/list', verifyToken, async (req, res) => {
    try {
        const currentDate = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format

        const query = `
            SELECT * FROM py_salarygroup 
            WHERE (effdate IS NULL OR effdate <= ?) 
            AND (lastdate IS NULL OR lastdate >= ?)
            ORDER BY groupcode
        `;

        const [rows] = await pool.query(query, [currentDate, currentDate]);

        res.json({
            data: rows,
            count: rows.length,
            currentDate: currentDate
        });

    } catch (error) {
        console.error('Error fetching active salary groups:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// UTILITY - Get salary groups by date range
router.get('/salary-groups/date-range/:startDate/:endDate', verifyToken, async (req, res) => {
    try {
        const { startDate, endDate } = req.params;

        // Validate date format
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
            return res.status(400).json({
                error: 'Invalid date format. Use YYYY-MM-DD'
            });
        }

        if (new Date(startDate) > new Date(endDate)) {
            return res.status(400).json({
                error: 'Start date cannot be greater than end date'
            });
        }

        const query = `
            SELECT * FROM py_salarygroup 
            WHERE (effdate IS NULL OR effdate <= ?) 
            AND (lastdate IS NULL OR lastdate >= ?)
            ORDER BY groupcode
        `;

        const [rows] = await pool.query(query, [endDate, startDate]);

        res.json({
            data: rows,
            count: rows.length,
            dateRange: { startDate, endDate }
        });

    } catch (error) {
        console.error('Error fetching salary groups by date range:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// UTILITY - Check if group is active on specific date
router.get('/salary-groups/:groupcode/active/:date', verifyToken, async (req, res) => {
    try {
        const { groupcode, date } = req.params;

        // Validate date format
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(date)) {
            return res.status(400).json({
                error: 'Invalid date format. Use YYYY-MM-DD'
            });
        }

        const query = `
            SELECT *, 
                   CASE 
                       WHEN (effdate IS NULL OR effdate <= ?) AND (lastdate IS NULL OR lastdate >= ?) 
                       THEN 1 ELSE 0 
                   END as is_active
            FROM py_salarygroup 
            WHERE groupcode = ?
        `;

        const [rows] = await pool.query(query, [date, date, groupcode]);

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Salary group not found' });
        }

        res.json({
            data: {
                ...rows[0],
                is_active: Boolean(rows[0].is_active),
                check_date: date
            }
        });

    } catch (error) {
        console.error('Error checking salary group status:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});


//---------------------- ELEMENT TPYE & GRADELEVEL DROPDOWN ------------------------//

// GET - Get all element types
router.get('/elementtypes', verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT PaymentType, elmDesc, Ledger, perc, std, maxi, bpay, yearend, 
             Status, dependence, payfreq, pmonth, freetax, createdby, datecreated, ipis
      FROM py_elementType 
      ORDER BY PaymentType
    `);
    
    res.json(rows);
  } catch (err) {
    console.error('Error fetching element types:', err);
    res.status(500).json({ error: 'Failed to fetch element types' });
  }
});

// GET - All Grade Levels
router.get('/gradelevels', verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT grade_no, grade_desc FROM py_gradelevel ORDER BY grade_no'
    );
    res.json(rows);
  } catch (err) {
    console.error('Error fetching grade levels:', err);
    res.status(500).json({ error: 'Failed to fetch grade levels' });
  }
});


module.exports = router;


