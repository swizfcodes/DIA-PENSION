const express = require('express');
const router = express.Router();
const verifyToken = require('../../middware/authentication');
const reconciliationController = require('../../controllers/Reports/reconciliationController');

// All routes require authentication
router.use(verifyToken);

// GET /api/reconciliation/summary - Overall summary
router.get('/summary', reconciliationController.getSummary.bind(reconciliationController));

// GET /api/reconciliation/employees - Employee-level details
router.get('/employees', reconciliationController.getEmployeeReconciliation.bind(reconciliationController));

// GET /api/reconciliation/report - Complete report
router.get('/report', reconciliationController.getReport.bind(reconciliationController));

// GET /api/reconciliation/payment-type-analysis - Payment type error analysis
router.get('/payment-type-analysis', reconciliationController.getPaymentTypeAnalysis.bind(reconciliationController));

// GET /api/reconciliation/export - Export as PDF
router.get('/export', reconciliationController.exportReconciliationPDF.bind(reconciliationController));

module.exports = router;


