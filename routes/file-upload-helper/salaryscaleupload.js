// Add this to your salary-scale routes file (after existing methods)
const express = require("express");
const router = express.Router();
const multer = require('multer');
const csv = require('csv-parser');
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
const pool = require('../../config/db'); // mysql2 pool
const verifyToken = require('../../middware/authentication');

// Configure multer for file uploads
const upload = multer({
    dest: 'uploads/',
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['text/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel'];
        if (allowedTypes.includes(file.mimetype) || 
            file.originalname.toLowerCase().endsWith('.csv') || 
            file.originalname.toLowerCase().endsWith('.xlsx') || 
            file.originalname.toLowerCase().endsWith('.xls')) {
            cb(null, true);
        } else {
            cb(new Error('Only CSV and Excel files are allowed'), false);
        }
    },
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB limit
    }
});

class BatchUploadController {
    
    // Batch upload salary scales
    static async batchUpload(req, res) {
        let filePath = null;
        
        try {
            if (!req.file) {
                return res.status(400).json({ error: 'No file uploaded' });
            }

            filePath = req.file.path;
            const fileExtension = path.extname(req.file.originalname).toLowerCase();
            let records = [];

            // Parse file based on extension
            if (fileExtension === '.csv') {
                records = await BatchUploadController.parseCSV(filePath);
            } else if (fileExtension === '.xlsx' || fileExtension === '.xls') {
                records = await BatchUploadController.parseExcel(filePath);
            } else {
                throw new Error('Unsupported file format');
            }

            // Validate and process records
            const results = await BatchUploadController.processRecords(records);

            // Clean up uploaded file
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }

            res.json({
                message: 'Salary scale batch upload completed',
                summary: {
                    totalRecords: records.length,
                    successful: results.successful.length,
                    failed: results.failed.length,
                    errors: results.failed
                },
                data: results.successful
            });

        } catch (error) {
            console.error('Salary scale batch upload error:', error);
            
            // Clean up uploaded file on error
            if (filePath && fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }

            res.status(500).json({
                error: 'Salary scale batch upload failed',
                message: error.message
            });
        }
    }

    // Parse CSV file
    static async parseCSV(filePath) {
        return new Promise((resolve, reject) => {
            const records = [];
            
            fs.createReadStream(filePath)
                .pipe(csv())
                .on('data', (row) => {
                    records.push(row);
                })
                .on('end', () => {
                    resolve(records);
                })
                .on('error', (error) => {
                    reject(error);
                });
        });
    }

    // Parse Excel file
    static async parseExcel(filePath) {
        try {
            const workbook = XLSX.readFile(filePath);
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            const records = XLSX.utils.sheet_to_json(worksheet);
            
            return records;
        } catch (error) {
            throw new Error(`Failed to parse Excel file: ${error.message}`);
        }
    }

    // Process and validate records
    static async processRecords(records) {
        const successful = [];
        const failed = [];

        for (let i = 0; i < records.length; i++) {
            const record = records[i];
            const rowNumber = i + 2; // +2 because CSV starts from row 2 (after header)

            try {
                // Validate required fields
                if (!record.salcode || !record.saltype || !record.grade) {
                    throw new Error('Missing required fields: salcode, saltype, grade');
                }

                // Validate step20 (max progression step)
                const maxStep = parseInt(record.step20);
                if (maxStep && (maxStep < 1 || maxStep > 19)) {
                    throw new Error('step20 (max progression) must be between 1 and 19');
                }

                // Clean and prepare data
                const scaleData = {
                    salcode: String(record.salcode).trim(),
                    saltype: String(record.saltype).trim(),
                    grade: String(record.grade).trim().padStart(2, '0'),
                    step1: BatchUploadController.parseDecimal(record.step1),
                    step2: BatchUploadController.parseDecimal(record.step2),
                    step3: BatchUploadController.parseDecimal(record.step3),
                    step4: BatchUploadController.parseDecimal(record.step4),
                    step5: BatchUploadController.parseDecimal(record.step5),
                    step6: BatchUploadController.parseDecimal(record.step6),
                    step7: BatchUploadController.parseDecimal(record.step7),
                    step8: BatchUploadController.parseDecimal(record.step8),
                    step9: BatchUploadController.parseDecimal(record.step9),
                    step10: BatchUploadController.parseDecimal(record.step10),
                    step11: BatchUploadController.parseDecimal(record.step11),
                    step12: BatchUploadController.parseDecimal(record.step12),
                    step13: BatchUploadController.parseDecimal(record.step13),
                    step14: BatchUploadController.parseDecimal(record.step14),
                    step15: BatchUploadController.parseDecimal(record.step15),
                    step16: BatchUploadController.parseDecimal(record.step16),
                    step17: BatchUploadController.parseDecimal(record.step17),
                    step18: BatchUploadController.parseDecimal(record.step18),
                    step19: BatchUploadController.parseDecimal(record.step19),
                    step20: BatchUploadController.parseDecimal(record.step20),
                    user: record.user || 'BATCH_UPLOAD'
                };

                // Try to insert into database
                const query = `
                    INSERT INTO py_salaryscale (
                        salcode, saltype, grade, step1, step2, step3, step4, step5,
                        step6, step7, step8, step9, step10, step11, step12, step13,
                        step14, step15, step16, step17, step18, step19, step20, user
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON DUPLICATE KEY UPDATE
                        step1 = VALUES(step1), step2 = VALUES(step2), step3 = VALUES(step3),
                        step4 = VALUES(step4), step5 = VALUES(step5), step6 = VALUES(step6),
                        step7 = VALUES(step7), step8 = VALUES(step8), step9 = VALUES(step9),
                        step10 = VALUES(step10), step11 = VALUES(step11), step12 = VALUES(step12),
                        step13 = VALUES(step13), step14 = VALUES(step14), step15 = VALUES(step15),
                        step16 = VALUES(step16), step17 = VALUES(step17), step18 = VALUES(step18),
                        step19 = VALUES(step19), step20 = VALUES(step20), user = VALUES(user)
                `;

                const values = [
                    scaleData.salcode, scaleData.saltype, scaleData.grade,
                    scaleData.step1, scaleData.step2, scaleData.step3, scaleData.step4, scaleData.step5,
                    scaleData.step6, scaleData.step7, scaleData.step8, scaleData.step9, scaleData.step10,
                    scaleData.step11, scaleData.step12, scaleData.step13, scaleData.step14, scaleData.step15,
                    scaleData.step16, scaleData.step17, scaleData.step18, scaleData.step19, scaleData.step20,
                    scaleData.user
                ];

                await pool.execute(query, values);

                successful.push({
                    row: rowNumber,
                    data: {
                        salcode: scaleData.salcode,
                        saltype: scaleData.saltype,
                        grade: scaleData.grade
                    }
                });

            } catch (error) {
                failed.push({
                    row: rowNumber,
                    data: record,
                    error: error.message
                });
            }
        }

        return { successful, failed };
    }

    // Helper function to parse decimal values
    static parseDecimal(value) {
        if (value === null || value === undefined || value === '') {
            return null;
        }
        
        const parsed = parseFloat(value);
        return isNaN(parsed) ? null : parsed;
    }

    // Download sample template
    static downloadSample(req, res) {
        const sampleData = [
            {
                salcode: 'NAVY01',
                saltype: 'BP303',
                grade: '01',
                step1: '50000',
                step2: '52000',
                step3: '54000',
                step4: '56000',
                step5: '58000',
                step6: '60000',
                step7: '62000',
                step8: '64000',
                step9: '66000',
                step10: '68000',
                step11: '70000',
                step12: '72000',
                step13: '74000',
                step14: '76000',
                step15: '78000',
                step16: '80000',
                step17: '82000',
                step18: '84000',
                step19: '86000',
                step20: '15', // Max progression step
                user: 'ADMIN'
            },
            {
                salcode: 'NAVY01',
                saltype: 'BP304',
                grade: '01',
                step1: '10000',
                step2: '11000',
                step3: '12000',
                step4: '13000',
                step5: '14000',
                step6: '15000',
                step7: '16000',
                step8: '17000',
                step9: '18000',
                step10: '19000',
                step11: '20000',
                step12: '21000',
                step13: '22000',
                step14: '23000',
                step15: '24000',
                step16: '25000',
                step17: '26000',
                step18: '27000',
                step19: '28000',
                step20: '10', // Max progression step
                user: 'ADMIN'
            }
        ];

        // Convert to CSV format
        const headers = Object.keys(sampleData[0]);
        const csvContent = [
            headers.join(','),
            ...sampleData.map(row => 
                headers.map(header => {
                    const value = row[header] || '';
                    return typeof value === 'string' && value.includes(',') ? `"${value}"` : value;
                }).join(',')
            )
        ].join('\n');

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="salary_scale_sample.csv"');
        res.send(csvContent);
    }
}

router.post('/salary-scales/batch-upload', verifyToken, upload.single('file'), BatchUploadController.batchUpload);

router.get('/salary-scales/sample-template', verifyToken, BatchUploadController.downloadSample);

module.exports = router;


