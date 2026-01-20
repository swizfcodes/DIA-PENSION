const express = require('express');
const {autoAssignPayrollClass} = require('../routes/helpers/autoassignPayrollClass');
const router = express.Router();

async function attachPayrollClass(req, res, next) {
  try {
    const dbName = req.current_class || req.primary_class;

    if (!dbName) {
      console.log('⚠️ No current_class found in token, skipping auto-assign.');
      return next();
    }

    // Skip auto-assignment for OFFICERS database
    const officersDb = process.env.DB_OFFICERS || 'hicaddata';
    if (dbName === officersDb) {
      console.log(`⏭️ Skipping auto-assign for OFFICERS database: ${dbName}`);
      return next();
    }

    console.log(`🧩 Auto-assign middleware triggered for DB: ${dbName}`);

    const result = await autoAssignPayrollClass(dbName);

    if (result.total > 0) {
      console.log(`✅ Processed ${result.total} employee(s) in ${dbName}:`);
      if (result.updated > 0) {
        console.log(`   - Auto-assigned: ${result.updated}`);
      }
      if (result.corrected > 0) {
        console.log(`   - Corrected mismatches: ${result.corrected}`);
      }
      console.log(`   - Payroll Class: ${result.payrollClass} (${result.payrollClassName})`);
    } else {
      console.log(`✓ All employees properly assigned in ${dbName}.`);
    }

    // Attach result for later use if needed
    req.autoAssignResult = result;

    next();
  } catch (error) {
    console.error('❌ Auto-assign middleware error:', error.message);
    // Don't block the request — just log and continue
    next();
  }
}

module.exports = {attachPayrollClass};


