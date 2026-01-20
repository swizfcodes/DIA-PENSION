const express = require('express');
const router = express.Router();
const pool = require('../../config/db'); // mysql2 pool
const verifyToken = require('../../middware/authentication');

// ============================================
// UTILITY: Get current processing period
// ============================================
const getCurrentPeriod = async () => {
    const [rows] = await pool.query(
        `SELECT mth, ord, pmth FROM py_stdrate WHERE type = 'BT05' LIMIT 1`
    );
    return rows[0] || { mth: new Date().getMonth() + 1, ord: new Date().getFullYear(), pmth: new Date().getMonth() };
};

// ============================================
// UTILITY: Log input changes
// ============================================
const logInputChange = async (emplId, paymentType, fieldName, oldValue, newValue, changedBy, processMonth, processYear) => {
    if (oldValue !== newValue) {
        await pool.query(
            `INSERT INTO py_input_variables_log 
            (empl_id, payment_type, changed_by, field_name, old_value, new_value, process_month, process_year)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [emplId, paymentType, changedBy, fieldName, oldValue, newValue, processMonth, processYear]
        );
    }
};

// ============================================
// CREATE: Add new payroll deduction/payment
// POST /api/payroll-files
// ============================================
router.post('/', verifyToken, async (req, res) => {
    const connection = await pool.getConnection();
    
    try {
        const {
            empl_id,
            type,
            amtp,           // Total amount payable
            amttd = 0,      // Amount to date (cumulative)
            amt = 0,        // Current month adjustment
            amtad = 'Add',  // Add/Deduct
            nomth = 0,      // Number of months
            payind = 'P',   // Payment indicator (P=Permanent, T=Temporary, L=Loan, X=Independent)
            mak1 = 'No',    // Active status (No=Active, Yes=Inactive)
            mak2 = 'No',    // Archive status
            remarks = ''
        } = req.body;

        // Validation
        if (!empl_id || !type) {
            return res.status(400).json({
                success: false,
                message: 'Employee ID and payment type are required'
            });
        }

        // Check if employee exists
        const [employee] = await connection.query(
            `SELECT empl_id, surname, othername FROM hr_employees WHERE empl_id = ?`,
            [empl_id]
        );

        if (employee.length === 0) {
            return res.status(404).json({
                success: false,
                message: `Employee ${empl_id} not found`
            });
        }

        // Check if payment type exists
        const [paymentType] = await connection.query(
            `SELECT paymenttype, elmdesc FROM py_elementtype WHERE paymenttype = ?`,
            [type]
        );

        if (paymentType.length === 0) {
            return res.status(404).json({
                success: false,
                message: `Payment type ${type} not found`
            });
        }

        // Check for duplicate
        const [existing] = await connection.query(
            `SELECT empl_id FROM py_payded WHERE empl_id = ? AND type = ?`,
            [empl_id, type]
        );

        if (existing.length > 0) {
            return res.status(409).json({
                success: false,
                message: `Payment/deduction ${type} already exists for employee ${empl_id}`
            });
        }

        await connection.beginTransaction();

        // Insert into py_payded
        const [result] = await connection.query(
            `INSERT INTO py_payded (
                empl_id, type, amtp, amttd, amt, amtad, nomth, payind, 
                mak1, mak2, remarks, createdby, datecreated
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
            [empl_id, type, amtp, amttd, amt, amtad, nomth, payind, mak1, mak2, remarks, req.user.username]
        );

        // Archive to py_inputhistory
        await connection.query(
            `INSERT INTO py_inputhistory (
                empl_id, type, amtp, amttd, amt, amtad, nomth, payind,
                createdby, datecreated
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
            [empl_id, type, amtp, amttd, amt, amtad, nomth, payind, req.user.username]
        );

        await connection.commit();

        res.status(201).json({
            success: true,
            message: 'Payroll entry created successfully',
            data: {
                empl_id,
                type,
                employee_name: `${employee[0].surname} ${employee[0].othername}`,
                payment_description: paymentType[0].elmdesc,
                amtp,
                nomth,
                payind,
                status: mak1 === 'No' ? 'Active' : 'Inactive'
            }
        });

    } catch (error) {
        await connection.rollback();
        console.error('Error creating payroll entry:', error);
        res.status(500).json({
            success: false,
            message: 'Error creating payroll entry',
            error: error.message
        });
    } finally {
        connection.release();
    }
});

// ============================================
// READ: Get single payroll entry
// GET /api/payroll-files/:empl_id/:type
// ============================================
router.get('/:empl_id/:type', verifyToken, async (req, res) => {
    try {
        const { empl_id, type } = req.params;

        const [rows] = await pool.query(
            `SELECT 
                pd.*,
                CONCAT(e.title, ' ', e.surname, ' ', e.othername) as employee_name,
                e.gradelevel,
                e.gradetype,
                e.location,
                et.elmdesc as payment_description,
                et.category,
                CASE 
                    WHEN pd.mak1 = 'No' THEN 'Active'
                    ELSE 'Inactive'
                END as status,
                CASE 
                    WHEN pd.nomth > 0 THEN ROUND(pd.amtp / pd.nomth, 2)
                    ELSE 0
                END as monthly_installment,
                pd.amtp - pd.amttd as balance_remaining
            FROM py_payded pd
            LEFT JOIN hr_employees e ON e.empl_id = pd.empl_id
            LEFT JOIN py_elementtype et ON et.paymenttype = pd.type
            WHERE pd.empl_id = ? AND pd.type = ?`,
            [empl_id, type]
        );

        if (rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Payroll entry not found'
            });
        }

        res.json({
            success: true,
            data: rows[0]
        });

    } catch (error) {
        console.error('Error fetching payroll entry:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching payroll entry',
            error: error.message
        });
    }
});

// ============================================
// READ: Get all payroll entries for employee
// GET /api/payroll-files/employee/:empl_id
// ============================================
router.get('/employee/:empl_id', verifyToken, async (req, res) => {
    try {
        const { empl_id } = req.params;
        const { status = 'all' } = req.query; // all, active, inactive

        let statusCondition = '';
        if (status === 'active') {
            statusCondition = `AND pd.mak1 = 'No'`;
        } else if (status === 'inactive') {
            statusCondition = `AND pd.mak1 = 'Yes'`;
        }

        const [rows] = await pool.query(
            `SELECT 
                pd.empl_id,
                pd.type,
                pd.amtp as total_payable,
                pd.amttd as paid_to_date,
                pd.amt as current_adjustment,
                pd.amtad as adjustment_type,
                pd.nomth as months_remaining,
                pd.payind as payment_indicator,
                pd.mak1,
                CASE 
                    WHEN pd.mak1 = 'No' THEN 'Active'
                    ELSE 'Inactive'
                END as status,
                pd.remarks,
                et.elmdesc as description,
                et.category,
                CASE 
                    WHEN pd.nomth > 0 THEN ROUND(pd.amtp / pd.nomth, 2)
                    ELSE 0
                END as monthly_installment,
                pd.amtp - pd.amttd as balance,
                pd.datecreated,
                pd.createdby
            FROM py_payded pd
            LEFT JOIN py_elementtype et ON et.paymenttype = pd.type
            WHERE pd.empl_id = ? ${statusCondition}
            ORDER BY et.category, pd.type`,
            [empl_id]
        );

        // Get employee info
        const [employee] = await pool.query(
            `SELECT empl_id, CONCAT(title, ' ', surname, ' ', othername) as full_name,
             gradelevel, gradetype, location
             FROM hr_employees WHERE empl_id = ?`,
            [empl_id]
        );

        // Summary statistics
        const [summary] = await pool.query(
            `SELECT 
                COUNT(*) as total_entries,
                SUM(CASE WHEN mak1 = 'No' THEN 1 ELSE 0 END) as active_entries,
                SUM(CASE WHEN mak1 = 'Yes' THEN 1 ELSE 0 END) as inactive_entries,
                SUM(CASE WHEN mak1 = 'No' THEN amtp ELSE 0 END) as total_payable,
                SUM(CASE WHEN mak1 = 'No' THEN amttd ELSE 0 END) as total_paid
            FROM py_payded
            WHERE empl_id = ?`,
            [empl_id]
        );

        res.json({
            success: true,
            data: {
                employee: employee[0] || null,
                entries: rows,
                summary: summary[0]
            }
        });

    } catch (error) {
        console.error('Error fetching employee payroll entries:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching payroll entries',
            error: error.message
        });
    }
});

// ============================================
// READ: Get all payroll entries (with filters)
// GET /api/payroll-files
// ============================================
router.get('/', verifyToken, async (req, res) => {
    try {
        const {
            payment_type,
            status = 'all',
            payroll_class,
            location,
            page = 1,
            limit = 50
        } = req.query;

        const offset = (page - 1) * limit;
        const conditions = [];
        const params = [];

        if (payment_type) {
            conditions.push('pd.type = ?');
            params.push(payment_type);
        }

        if (status === 'active') {
            conditions.push(`pd.mak1 = 'No'`);
        } else if (status === 'inactive') {
            conditions.push(`pd.mak1 = 'Yes'`);
        }

        if (payroll_class) {
            conditions.push('e.payrollclass = ?');
            params.push(payroll_class);
        }

        if (location) {
            conditions.push('e.location = ?');
            params.push(location);
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        // Get total count
        const [countResult] = await pool.query(
            `SELECT COUNT(*) as total
             FROM py_payded pd
             LEFT JOIN hr_employees e ON e.empl_id = pd.empl_id
             ${whereClause}`,
            params
        );

        // Get paginated data
        const [rows] = await pool.query(
            `SELECT 
                pd.empl_id,
                CONCAT(e.surname, ' ', e.othername) as employee_name,
                e.gradelevel,
                e.location,
                pd.type,
                et.elmdesc as description,
                pd.amtp as total_payable,
                pd.amttd as paid_to_date,
                pd.nomth as months_remaining,
                pd.payind,
                CASE WHEN pd.mak1 = 'No' THEN 'Active' ELSE 'Inactive' END as status,
                pd.datecreated
            FROM py_payded pd
            LEFT JOIN hr_employees e ON e.empl_id = pd.empl_id
            LEFT JOIN py_elementtype et ON et.paymenttype = pd.type
            ${whereClause}
            ORDER BY pd.datecreated DESC
            LIMIT ? OFFSET ?`,
            [...params, parseInt(limit), parseInt(offset)]
        );

        res.json({
            success: true,
            data: rows,
            pagination: {
                total: countResult[0].total,
                page: parseInt(page),
                limit: parseInt(limit),
                pages: Math.ceil(countResult[0].total / limit)
            }
        });

    } catch (error) {
        console.error('Error fetching payroll entries:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching payroll entries',
            error: error.message
        });
    }
});

// ============================================
// UPDATE: Modify payroll entry
// PUT /api/payroll-files/:empl_id/:type
// ============================================
router.put('/:empl_id/:type', verifyToken, async (req, res) => {
    const connection = await pool.getConnection();
    
    try {
        const { empl_id, type } = req.params;
        const {
            amtp,
            amttd,
            amt,
            amtad,
            nomth,
            payind,
            mak1,
            remarks
        } = req.body;

        // Get existing record
        const [existing] = await connection.query(
            `SELECT * FROM py_payded WHERE empl_id = ? AND type = ?`,
            [empl_id, type]
        );

        if (existing.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Payroll entry not found'
            });
        }

        const oldRecord = existing[0];
        const period = await getCurrentPeriod();

        await connection.beginTransaction();

        // Log changes
        if (amtp !== undefined && amtp !== oldRecord.amtp) {
            await logInputChange(empl_id, type, 'amtp', oldRecord.amtp, amtp, req.user.username, period.mth, period.ord);
        }
        if (amttd !== undefined && amttd !== oldRecord.amttd) {
            await logInputChange(empl_id, type, 'amttd', oldRecord.amttd, amttd, req.user.username, period.mth, period.ord);
        }
        if (nomth !== undefined && nomth !== oldRecord.nomth) {
            await logInputChange(empl_id, type, 'nomth', oldRecord.nomth, nomth, req.user.username, period.mth, period.ord);
        }

        // Update py_payded
        const updateFields = [];
        const updateValues = [];

        if (amtp !== undefined) { updateFields.push('amtp = ?'); updateValues.push(amtp); }
        if (amttd !== undefined) { updateFields.push('amttd = ?'); updateValues.push(amttd); }
        if (amt !== undefined) { updateFields.push('amt = ?'); updateValues.push(amt); }
        if (amtad !== undefined) { updateFields.push('amtad = ?'); updateValues.push(amtad); }
        if (nomth !== undefined) { updateFields.push('nomth = ?'); updateValues.push(nomth); }
        if (payind !== undefined) { updateFields.push('payind = ?'); updateValues.push(payind); }
        if (mak1 !== undefined) { updateFields.push('mak1 = ?'); updateValues.push(mak1); }
        if (remarks !== undefined) { updateFields.push('remarks = ?'); updateValues.push(remarks); }

        updateFields.push('datecreated = NOW()');
        updateFields.push('createdby = ?');
        updateValues.push(req.user.username);
        updateValues.push(empl_id, type);

        await connection.query(
            `UPDATE py_payded 
             SET ${updateFields.join(', ')}
             WHERE empl_id = ? AND type = ?`,
            updateValues
        );

        // Archive update to py_inputhistory
        await connection.query(
            `INSERT INTO py_inputhistory (
                empl_id, type, amtp, amttd, amt, amtad, nomth, payind,
                createdby, datecreated
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
            [
                empl_id, type,
                amtp !== undefined ? amtp : oldRecord.amtp,
                amttd !== undefined ? amttd : oldRecord.amttd,
                amt !== undefined ? amt : oldRecord.amt,
                amtad !== undefined ? amtad : oldRecord.amtad,
                nomth !== undefined ? nomth : oldRecord.nomth,
                payind !== undefined ? payind : oldRecord.payind,
                req.user.username
            ]
        );

        await connection.commit();

        // Get updated record
        const [updated] = await connection.query(
            `SELECT pd.*, et.elmdesc,
             CONCAT(e.surname, ' ', e.othername) as employee_name
             FROM py_payded pd
             LEFT JOIN py_elementtype et ON et.paymenttype = pd.type
             LEFT JOIN hr_employees e ON e.empl_id = pd.empl_id
             WHERE pd.empl_id = ? AND pd.type = ?`,
            [empl_id, type]
        );

        res.json({
            success: true,
            message: 'Payroll entry updated successfully',
            data: updated[0]
        });

    } catch (error) {
        await connection.rollback();
        console.error('Error updating payroll entry:', error);
        res.status(500).json({
            success: false,
            message: 'Error updating payroll entry',
            error: error.message
        });
    } finally {
        connection.release();
    }
});

// ============================================
// DELETE: Deactivate payroll entry (soft delete)
// DELETE /api/payroll-files/:empl_id/:type
// ============================================
router.delete('/:empl_id/:type', verifyToken, async (req, res) => {
    const connection = await pool.getConnection();
    
    try {
        const { empl_id, type } = req.params;

        // Check if entry exists
        const [existing] = await connection.query(
            `SELECT empl_id FROM py_payded WHERE empl_id = ? AND type = ?`,
            [empl_id, type]
        );

        if (existing.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Payroll entry not found'
            });
        }

        await connection.beginTransaction();

        // Soft delete (set mak1 = 'Yes')
        await connection.query(
            `UPDATE py_payded 
             SET mak1 = 'Yes', datecreated = NOW(), createdby = ?
             WHERE empl_id = ? AND type = ?`,
            [req.user.username, empl_id, type]
        );

        // Log the deactivation
        const period = await getCurrentPeriod();
        await connection.query(
            `INSERT INTO py_input_variables_log 
            (empl_id, payment_type, changed_by, field_name, old_text, new_text, 
             process_month, process_year, change_reason)
            VALUES (?, ?, ?, 'mak1', 'No', 'Yes', ?, ?, 'DEACTIVATED')`,
            [empl_id, type, req.user.username, period.mth, period.ord]
        );

        await connection.commit();

        res.json({
            success: true,
            message: 'Payroll entry deactivated successfully'
        });

    } catch (error) {
        await connection.rollback();
        console.error('Error deactivating payroll entry:', error);
        res.status(500).json({
            success: false,
            message: 'Error deactivating payroll entry',
            error: error.message
        });
    } finally {
        connection.release();
    }
});

// ============================================
// ACTIVATE: Reactivate payroll entry
// POST /api/payroll-files/:empl_id/:type/activate
// ============================================
router.post('/:empl_id/:type/activate', verifyToken, async (req, res) => {
    const connection = await pool.getConnection();
    
    try {
        const { empl_id, type } = req.params;

        // Check if entry exists
        const [existing] = await connection.query(
            `SELECT mak1 FROM py_payded WHERE empl_id = ? AND type = ?`,
            [empl_id, type]
        );

        if (existing.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Payroll entry not found'
            });
        }

        if (existing[0].mak1 === 'No') {
            return res.status(400).json({
                success: false,
                message: 'Payroll entry is already active'
            });
        }

        await connection.beginTransaction();

        // Activate (set mak1 = 'No')
        await connection.query(
            `UPDATE py_payded 
             SET mak1 = 'No', datecreated = NOW(), createdby = ?
             WHERE empl_id = ? AND type = ?`,
            [req.user.username, empl_id, type]
        );

        // Log the activation
        const period = await getCurrentPeriod();
        await connection.query(
            `INSERT INTO py_input_variables_log 
            (empl_id, payment_type, changed_by, field_name, old_text, new_text, 
             process_month, process_year, change_reason)
            VALUES (?, ?, ?, 'mak1', 'Yes', 'No', ?, ?, 'ACTIVATED')`,
            [empl_id, type, req.user.username, period.mth, period.ord]
        );

        await connection.commit();

        res.json({
            success: true,
            message: 'Payroll entry activated successfully'
        });

    } catch (error) {
        await connection.rollback();
        console.error('Error activating payroll entry:', error);
        res.status(500).json({
            success: false,
            message: 'Error activating payroll entry',
            error: error.message
        });
    } finally {
        connection.release();
    }
});

// ============================================
// BULK CREATE: Add multiple payroll entries
// POST /api/payroll-files/bulk
// ============================================
router.post('/bulk', verifyToken, async (req, res) => {
    const connection = await pool.getConnection();
    
    try {
        const { entries } = req.body; // Array of payroll entries

        if (!Array.isArray(entries) || entries.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Entries array is required'
            });
        }

        await connection.beginTransaction();

        const results = [];
        const errors = [];

        for (const entry of entries) {
            try {
                const {
                    empl_id, type, amtp, amttd = 0, amt = 0,
                    amtad = 'Add', nomth = 0, payind = 'P',
                    mak1 = 'No', remarks = ''
                } = entry;

                // Check for duplicate
                const [existing] = await connection.query(
                    `SELECT empl_id FROM py_payded WHERE empl_id = ? AND type = ?`,
                    [empl_id, type]
                );

                if (existing.length > 0) {
                    errors.push({ empl_id, type, error: 'Entry already exists' });
                    continue;
                }

                // Insert
                await connection.query(
                    `INSERT INTO py_payded (
                        empl_id, type, amtp, amttd, amt, amtad, nomth, payind,
                        mak1, mak2, remarks, createdby, datecreated
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'No', ?, ?, NOW())`,
                    [empl_id, type, amtp, amttd, amt, amtad, nomth, payind, mak1, remarks, req.user.username]
                );

                results.push({ empl_id, type, status: 'created' });

            } catch (error) {
                errors.push({ 
                    empl_id: entry.empl_id, 
                    type: entry.type, 
                    error: error.message 
                });
            }
        }

        await connection.commit();

        res.status(201).json({
            success: true,
            message: `Bulk creation completed: ${results.length} created, ${errors.length} failed`,
            data: {
                created: results,
                errors: errors
            }
        });

    } catch (error) {
        await connection.rollback();
        console.error('Error in bulk creation:', error);
        res.status(500).json({
            success: false,
            message: 'Error in bulk creation',
            error: error.message
        });
    } finally {
        connection.release();
    }
});

module.exports = router;


