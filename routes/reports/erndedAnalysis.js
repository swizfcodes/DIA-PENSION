const express = require('express');
const router = express.Router();
const verifyToken = require('../../middware/authentication');
const historicalReportMiddleware = require('../../middware/historicalReportsmiddleware');

const reportsController = require('../../controllers/Reports/reportsControllers');

// EARNINGS/DEDUCTIONS REPORT - DATA GENERATION (Returns JSON data)
router.get('/generate', verifyToken, historicalReportMiddleware, reportsController.generateEarningsDeductionsAnalysis.bind(reportsController));

// EARNINGS/DEDUCTIONS - PDF EXPORT (Receives data in body, returns PDF file)
router.post('/export/pdf', verifyToken, historicalReportMiddleware, reportsController.generateEarningsDeductionsAnalysisPDF.bind(reportsController));

// EARNINGS/DEDUCTIONS - EXCEL EXPORT (Receives data in body, returns Excel file)
router.post('/export/excel', verifyToken, historicalReportMiddleware, reportsController.generateEarningsDeductionsAnalysisExcel.bind(reportsController));

// EARNINGS/DEDUCTIONS - FETCH FILTER OPTIONS
router.get('/filter-options', verifyToken, historicalReportMiddleware, reportsController.getFilterOptions.bind(reportsController));

module.exports = router;


