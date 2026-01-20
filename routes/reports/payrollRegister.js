const express = require('express');
const router = express.Router();
const verifyToken = require('../../middware/authentication');
const historicalReportMiddleware = require('../../middware/historicalReportsmiddleware');

const reportsController = require('../../controllers/Reports/reportsControllers');

// PAYROLL REGISTER REPORT - DATA GENERATION (Returns JSON data)
router.get('/generate', verifyToken, historicalReportMiddleware, reportsController.generatePayrollRegister.bind(reportsController));

// PAYROLL REGISTER - PDF EXPORT (Receives data in body, returns PDF file)
router.post('/export/pdf', verifyToken, historicalReportMiddleware, reportsController.generatePayrollRegisterPDF.bind(reportsController));

// PAYROLL REGISTER - EXCEL EXPORT (Receives data in body, returns Excel file)
router.post('/export/excel', verifyToken, historicalReportMiddleware, reportsController.generatePayrollRegisterExcel.bind(reportsController));

module.exports = router;


