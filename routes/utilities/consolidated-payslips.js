// ============================================
// CONSOLIDATED PAYSLIP ROUTES
// routes/utilities/consolidated-payslip-routes.js
// ============================================

const express = require('express');
const router = express.Router();
const verifyToken = require('../../middware/authentication');
const ConsolidatedPayslipController = require('../../controllers/utilities/consolidatedPayslip');

// Initialize controller (will get jsreport from app later)
const controller = new ConsolidatedPayslipController(null);


// ============================================
// POST /generate - Generate consolidated payslips
// ============================================
router.post('/generate', verifyToken, (req, res) => {
  controller.generateConsolidatedPayslips(req, res);
});

// ============================================
// POST /export/pdf - Generate PDF
// ============================================
router.post('/export/pdf', verifyToken, (req, res) => {
  controller.generateConsolidatedPayslipPDF(req, res);
});

// ============================================
// POST /export/excel - Generate Excel
// ============================================
router.post('/export/excel', verifyToken, (req, res) => {
  controller.generateConsolidatedPayslipExcel(req, res);
});

module.exports = router;