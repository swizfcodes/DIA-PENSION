const express = require('express');
const router = express.Router();
const nsitfReportController = require('../../controllers/Reports/nsitfReportController');
const verifyToken = require('../../middware/authentication');
const historicalReportMiddleware = require('../../middware/historicalReportsmiddleware');


// NSITF REPORT - DATA GENERATION (Returns JSON data)
router.get('/generate', verifyToken, historicalReportMiddleware, nsitfReportController.generateNSITFReport.bind(nsitfReportController));

// NSITF - PDF EXPORT (Receives data in body, returns PDF file)
router.post('/export/pdf', verifyToken, historicalReportMiddleware, nsitfReportController.generateNSITFReportPDF.bind(nsitfReportController));

// NSITF - EXCEL EXPORT (Receives data in body, returns Excel file)
router.post('/export/excel', verifyToken, historicalReportMiddleware, nsitfReportController.generateNSITFReportExcel.bind(nsitfReportController));

// FILTER OPTIONS - GET AVAILABLE STATES
router.get('/filter-options', verifyToken, nsitfReportController.getNSITFFilterOptions.bind(nsitfReportController));

module.exports = router;


