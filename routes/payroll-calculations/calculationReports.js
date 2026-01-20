const express = require('express');
const router = express.Router();
const verifyToken = require('../../middware/authentication');

const {
  getAllowancesSummary,
  getPayrollSummary, 
  getBankReport, 
  getDeductionsSummary, 
  getTaxReport, 
  getDepartmentSummary, 
  getGradeSummary, 
  getExceptionReport,
  getControlSheet, 
  exportReport
} = require('../../controllers/payroll-calculations/calculationReports');

// Data endpoints
router.get('/summary', verifyToken, getPayrollSummary);
router.get('/bank', verifyToken, getBankReport);
router.get('/deductions', verifyToken, getDeductionsSummary);
router.get('/tax', verifyToken, getTaxReport);
router.get('/department', verifyToken, getDepartmentSummary);
router.get('/grade', verifyToken, getGradeSummary);
router.get('/exceptions', verifyToken, getExceptionReport);
router.get('/allowances', verifyToken, getAllowancesSummary);
router.get('/controlsheet', verifyToken, getControlSheet);

// Single export route handles all report types and formats
router.get('/:reportType/export/:format', verifyToken, exportReport);

module.exports = router;


