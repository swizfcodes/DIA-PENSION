const express = require('express');
const router = express.Router();
const pool = require('../../../config/db.js');
const verifyToken = require('../../../middware/authentication.js');

// ============================================
// POST /calculate - Calculate one-off payments
// ============================================
router.post('/calculate', verifyToken, async (req, res) => {
  try {
    const {
      payrollClass,
      allMembers = true,
      specificEmployees = []
    } = req.body;

    if (!payrollClass) {
      return res.status(400).json({
        success: false,
        message: 'Payroll class is required'
      });
    }

    const createdby = req.user_fullname || 'System';

    console.log('=== CALCULATION START ===');
    console.log('Payroll Class:', payrollClass);
    console.log('All Members:', allMembers);

    // Get all active employees FIRST (before clearing)
    let employeeQuery = `
      SELECT EMPL_ID, gradelevel 
      FROM hr_employees 
      WHERE payrollclass = ? 
        AND (dateleft IS NULL OR dateleft = '' OR dateleft = '0000-00-00')
    `;

    const employeeParams = [payrollClass];

    if (!allMembers && specificEmployees.length > 0) {
      employeeQuery += ' AND EMPL_ID IN (?)';
      employeeParams.push(specificEmployees);
    }

    employeeQuery += ' ORDER BY EMPL_ID';

    const [employees] = await pool.query(employeeQuery, employeeParams);
    console.log('Found employees:', employees.length);

    if (employees.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No active employees found'
      });
    }

    // Get all one-off payment types (excluding FP types)
    const [paymentTypes] = await pool.query(
      `SELECT * FROM py_oneofftype 
       WHERE LEFT(one_type, 2) != 'FP'
       ORDER BY one_type`
    );
    console.log('Found payment types:', paymentTypes.length);
    console.log('Payment types:', paymentTypes.map(pt => `${pt.one_type} (${pt.one_perc})`).join(', '));

    let processedCount = 0;
    let totalCalculations = 0;
    let skippedZero = 0;
    let skippedType = 0;
    const errors = [];
    const sampleResults = [];

    // Process first 3 employees for detailed logging
    const employeesToLog = employees.slice(0, 3);

    await pool.transaction(async (conn) => {
      // NOW clear py_calculation (after getting employees, like VB does)
      await conn.query('DELETE FROM py_calculation');
      console.log('Cleared py_calculation table');

      // Process each employee
      for (const employee of employees) {
        const empId = employee.EMPL_ID;
        const gradeLevel = employee.gradelevel || '0101';
        const gradePrefix = gradeLevel.substring(0, 2);

        const isLogged = employeesToLog.includes(employee);
        if (isLogged) {
          console.log(`\n--- Processing ${empId}, Grade: ${gradeLevel}, Prefix: ${gradePrefix} ---`);
        }

        // Process each payment type
        for (const payType of paymentTypes) {
          let amount = 0;

          try {
            // TYPE S: Standard amount for all
            if (payType.one_perc === 'S') {
              amount = parseFloat(payType.one_std) || 0;
              if (isLogged) console.log(`  ${payType.one_type} (S): Amount = ${amount}`);

            // TYPE R: Rank/Grade based
            } else if (payType.one_perc === 'R') {
              const [rankData] = await conn.query(
                'SELECT * FROM py_oneoffrank WHERE one_type = ?',
                [payType.one_type]
              );

              if (rankData.length === 0) {
                if (isLogged) console.log(`  ${payType.one_type} (R): NO RANK DATA`);
                errors.push({
                  employee: empId,
                  paymentType: payType.one_type,
                  error: 'Rank profile not found'
                });
                continue;
              }

              const columnName = `one_amount${gradePrefix}`;
              const rawAmount = rankData[0][columnName];
              amount = parseFloat(rawAmount) || 0;

              if (isLogged) {
                console.log(`  ${payType.one_type} (R): Column=${columnName}, Raw=${rawAmount}, Parsed=${amount}`);
              }

            // TYPE I: Individual input
            } else if (payType.one_perc === 'I') {
              const [individual] = await conn.query(
                'SELECT amtthismth FROM py_calculation WHERE his_empno = ? AND his_type = ?',
                [empId, payType.one_type]
              );

              if (individual.length > 0) {
                amount = parseFloat(individual[0].amtthismth) || 0;
                if (isLogged) console.log(`  ${payType.one_type} (I): Found manual entry = ${amount}`);
              } else {
                if (isLogged) console.log(`  ${payType.one_type} (I): No manual entry, SKIP`);
                skippedType++;
                continue;
              }

            // TYPE P: Percentage / TYPE D: Division
            } else if (payType.one_perc === 'P' || payType.one_perc === 'D') {
              if (!payType.one_depend) {
                errors.push({
                  employee: empId,
                  paymentType: payType.one_type,
                  error: 'Dependent payment type not specified'
                });
                continue;
              }

              // VB Logic: If one_bpay = "No" AND employee doesn't have dependent payment in py_masterpayded, skip
              // This means: "Required for All?" = No → Only calculate for those who have the dependent
              const [hasDependent] = await conn.query(
                'SELECT his_type FROM py_masterpayded WHERE his_empno = ? AND his_type = ?',
                [empId, payType.one_depend]
              );

              if (payType.one_bpay === 'No' && hasDependent.length === 0) {
                // Employee doesn't have dependent payment, skip this payment type
                if (isLogged) console.log(`  ${payType.one_type} (${payType.one_perc}): one_bpay='No', no dependent, SKIP`);
                continue;
              }

              // Get dependent payment amount
              const [dependent] = await conn.query(
                'SELECT amtthismth FROM py_masterpayded WHERE his_empno = ? AND his_type = ?',
                [empId, payType.one_depend]
              );

              if (dependent.length === 0) {
              // If one_bpay = "Yes" (Required for All), this is an error
              // If one_bpay = "No", we already skipped above
                if (isLogged) console.log(`  ${payType.one_type} (${payType.one_perc}): Dependent ${payType.one_depend} not found, SKIP`);
                continue;
              }

              const dependentAmount = parseFloat(dependent[0].amtthismth) || 0;

              if (payType.one_perc === 'P') {
                const percentage = parseFloat(payType.one_std) || 0;
                amount = (dependentAmount * percentage) / 100;

                // Apply grade restrictions (from VB)
                const gradePrefixNum = parseInt(gradePrefix);
                if (gradePrefixNum < 22 && percentage === 100) {
                  // Allow 100% for grades below 22
                } else if (gradeLevel === '2201' && percentage === 75) {
                  // Allow 75% for grade 2201
                } else if (percentage === 100 && gradePrefixNum >= 22) {
                  if (isLogged) console.log(`  ${payType.one_type} (P): Grade ${gradePrefix} not eligible for 100%, SKIP`);
                  continue;
                }

                if (payType.one_maxi && amount > parseFloat(payType.one_maxi)) {
                  amount = parseFloat(payType.one_maxi);
                }
              } else if (payType.one_perc === 'D') {
                const divisor = parseFloat(payType.one_bpay) || 1;
                if (divisor !== 0) {
                  amount = dependentAmount / divisor;
                }
              }

              if (isLogged) console.log(`  ${payType.one_type} (${payType.one_perc}): Dependent=${dependentAmount}, Amount=${amount}`);
            }

            // Make deductions negative
            if (payType.one_type.startsWith('PR') || payType.one_type.startsWith('PL')) {
              amount = -Math.abs(amount);
            }

            // Insert into py_calculation (only if amount != 0)
            if (amount !== 0) {
              await conn.query(
                `INSERT INTO py_calculation (his_empno, his_type, amtthismth, createdby, datecreated)
                 VALUES (?, ?, ?, ?, NOW())
                 ON DUPLICATE KEY UPDATE amtthismth = VALUES(amtthismth), datecreated = NOW()`,
                [empId, payType.one_type, amount, createdby]
              );
              totalCalculations++;

              if (isLogged) {
                console.log(`  ✓ INSERTED: ${payType.one_type} = ${amount}`);
              }

              if (sampleResults.length < 10) {
                sampleResults.push({ empId, paymentType: payType.one_type, amount });
              }
            } else {
              skippedZero++;
              if (isLogged) {
                console.log(`  ✗ SKIPPED (amount = 0): ${payType.one_type}`);
              }
            }

          } catch (error) {
            errors.push({
              employee: empId,
              paymentType: payType.one_type,
              error: error.message
            });
            if (isLogged) {
              console.log(`  ✗ ERROR: ${payType.one_type} - ${error.message}`);
            }
          }
        }

        processedCount++;
      }

      // Delete zero amounts (shouldn't be needed but just in case)
      await conn.query('DELETE FROM py_calculation WHERE amtthismth = 0');
    });

    console.log('\n=== CALCULATION COMPLETE ===');
    console.log('Employees Processed:', processedCount);
    console.log('Total Calculations:', totalCalculations);
    console.log('Skipped (Zero Amount):', skippedZero);
    console.log('Skipped (Type I):', skippedType);
    console.log('Errors:', errors.length);

    res.json({
      success: true,
      message: 'Calculation completed successfully',
      data: {
        employeesProcessed: processedCount,
        totalCalculations,
        skippedZero,
        skippedType,
        errorCount: errors.length,
        errors: errors.slice(0, 10),
        sampleResults
      }
    });

  } catch (err) {
    console.error('❌ Error calculating one-off payments:', err.message);
    console.error(err.stack);
    res.status(500).json({
      success: false,
      message: 'Calculation failed',
      error: err.message
    });
  }
});

// ============================================
// GET /calculation-results - Get calculation results with pagination
// ============================================
router.get('/calculation-results', verifyToken, async (req, res) => {
  try {
    const { page = 1, limit = 100, empno, one_type } = req.query;
    const offset = (page - 1) * limit;

    let query = `
      SELECT 
        c.*,
        e.surname,
        e.othername,
        e.gradelevel,
        et.elmDesc as one_desc
      FROM py_calculation c
      LEFT JOIN hr_employees e ON c.his_empno = e.EMPL_ID
      LEFT JOIN py_oneofftype ot ON c.his_type = ot.one_type
      LEFT JOIN py_elementtype et ON ot.one_type = et.PaymentType
      WHERE 1=1
    `;

    const params = [];

    if (empno) {
      query += ' AND c.his_empno = ?';
      params.push(empno);
    }

    if (one_type) {
      query += ' AND c.his_type = ?';
      params.push(one_type);
    }

    query += ' ORDER BY c.his_empno, c.his_type LIMIT ? OFFSET ?';
    params.push(parseInt(limit), offset);

    const [results] = await pool.query(query, params);

    let countQuery = 'SELECT COUNT(*) as total FROM py_calculation WHERE 1=1';
    const countParams = [];

    if (empno) {
      countQuery += ' AND his_empno = ?';
      countParams.push(empno);
    }

    if (one_type) {
      countQuery += ' AND his_type = ?';
      countParams.push(one_type);
    }

    const [[{ total }]] = await pool.query(countQuery, countParams);

    res.json({
      success: true,
      data: results,
      pagination: {
        currentPage: parseInt(page),
        totalRecords: total,
        totalPages: Math.ceil(total / limit),
        limit: parseInt(limit)
      }
    });

  } catch (err) {
    console.error('❌ Error fetching calculation results:', err.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch results',
      error: err.message
    });
  }
});

// ============================================
// DELETE /clear-calculation - Clear calculation results
// ============================================
router.delete('/clear-calculation', verifyToken, async (req, res) => {
  try {
    const [result] = await pool.query('DELETE FROM py_calculation');

    res.json({
      success: true,
      message: 'Calculation results cleared successfully',
      data: {
        deletedRecords: result.affectedRows
      }
    });

  } catch (err) {
    console.error('❌ Error clearing calculation:', err.message);
    res.status(500).json({
      success: false,
      message: 'Failed to clear calculation',
      error: err.message
    });
  }
});

module.exports = router;