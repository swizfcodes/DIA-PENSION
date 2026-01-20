const express = require('express');
const router = express.Router();
const nhfReportController = require('../../controllers/Reports/nhfReportController');
const verifyToken = require('../../middware/authentication');
const historicalReportMiddleware = require('../../middware/historicalReportsmiddleware');
// Apply historical report middleware to all routes in this router
//router.use(historicalReportMiddleware);


// NHF REPORT - DATA GENERATION (Returns JSON data)
router.get('/generate', verifyToken, historicalReportMiddleware, nhfReportController.generateNHFReport.bind(nhfReportController));

// NHF - PDF EXPORT (Receives data in body, returns PDF file)
router.post('/export/pdf', verifyToken, nhfReportController.generateNHFReportPDF.bind(nhfReportController));

// NHF - EXCEL EXPORT (Receives data in body, returns Excel file)
router.post('/export/excel', verifyToken, nhfReportController.generateNHFReportExcel.bind(nhfReportController));

// FILTER OPTIONS - GET AVAILABLE STATES
router.get('/filter-options', verifyToken, nhfReportController.getNHFFilterOptions.bind(nhfReportController));

module.exports = router;


