const express = require('express');
const router = express.Router();
const verifyToken = require('../../middware/authentication');

const reportsController = require('../../controllers/Reports/reportsControllers');

// STAFF LISTING REPORT - DATA GENERATION (Returns JSON data)
//router.get('/generate', verifyToken, reportsController.generatePaymentStaffList.bind(reportsController));

// STAFF LISTING - PDF EXPORT (Receives data in body, returns PDF file)
//router.post('/export/pdf', verifyToken, reportsController.generatePaymentStaffListPDF.bind(reportsController));

// STAFF LISTING - EXCEL EXPORT (Receives data in body, returns Excel file)
//router.post('/export/excel', verifyToken, reportsController.generatePaymentStaffListExcel.bind(reportsController));

module.exports = router;


