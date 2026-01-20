const express = require('express');
const router = express.Router();
const taxReportController = require('../../controllers/Reports/taxReportControllers');
const verifyToken = require('../../middware/authentication');
//const historicalReportMiddleware = require('../../middware/historicalReportsmiddleware');


// TAX REPORT - DATA GENERATION (Returns JSON data)
router.get('/generate', verifyToken, taxReportController.generateTaxReport.bind(taxReportController));

// TAX - PDF EXPORT (Receives data in body, returns PDF file)
router.post('/export/pdf', verifyToken, taxReportController.generateTaxReportPDF.bind(taxReportController));

// TAX - EXCEL EXPORT (Receives data in body, returns Excel file)
router.post('/export/excel', verifyToken, taxReportController.generateTaxReportExcel.bind(taxReportController));

// FILTER OPTIONS - GET AVAILABLE STATES
router.get('/filter-options', verifyToken, taxReportController.getTaxFilterOptions.bind(taxReportController));

module.exports = router;


