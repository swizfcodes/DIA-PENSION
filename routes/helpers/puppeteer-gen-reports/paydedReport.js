const express = require('express');
const router = express.Router();
const pool = require('../../../config/db'); // mysql2 pool
const verifyToken = require('../../../middware/authentication');
//const puppeteer = require('puppeteer'); 

// Utility to format currency (copied from your frontend)
const formatCurrency = (amount) => {
    if (!amount) return '-';
    // Use Intl.NumberFormat for currency formatting
    return new Intl.NumberFormat('en-NG', {
        style: 'currency',
        currency: 'NGN'
    }).format(amount);
};

// Utility to resolve indicator names (requires a backend source/map, assume it's available)
// NOTE: You must implement resolveName() based on your 'py_payind' data.
const resolveName = (indicator, type) => {
    // Placeholder logic for demonstration
    if (type === 'payindicator' && indicator === 'A') return 'Active';
    if (type === 'payindicator' && indicator === 'I') return 'Inactive';
    return indicator || '-';
};


// --------------------------------------------------------
// NEW: GET REPORT DATA AND STREAM AS PDF
// --------------------------------------------------------
router.get('/report/pdf', verifyToken, async (req, res) => {
    let browser;
    try {
        // 1. FETCH ALL REPORT DATA (No LIMIT/OFFSET)
        const dataQuery = `
          SELECT 
            p.Empl_id,
            p.type,
            p.amtp AS amount_payable,
            p.amttd AS amount_to_date,
            p.amt,
            p.payind AS indicator,
            pi.inddesc AS indicator_description,
            p.nomth AS months_remaining
          FROM py_payded p
          LEFT JOIN py_payind pi ON p.payind = pi.ind
          ORDER BY p.Empl_id, p.type
        `;
        const [data] = await pool.query(dataQuery);

        if (data.length === 0) {
            return res.status(404).send('No records found for the report.');
        }

        // 2. GENERATE FULL HTML CONTENT
        const now = new Date();
        const dateStr = `${String(now.getDate()).padStart(2, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${now.getFullYear()}`;
        const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        const fullName = req.user_fullname || "System User"; // Get name from token payload

        const htmlContent = `
        <!DOCTYPE html>
            <html>
            <head>
                <title>Payment/Deduction Report</title>
                <style>
                body { 
                    font-family: Arial, sans-serif;
                    margin: 20px;
                    color: #333;
                }
                .report-header {
                    text-align: center;
                    margin-bottom: 20px;
                    padding-bottom: 10px;
                    border-bottom: 2px solid #1a56db;
                }
                .report-title {
                    font-size: 24px;
                    color: #1a56db;
                    margin: 10px 0;
                }
                .date-time {
                    font-size: 14px;
                    color: #666;
                    margin: 10px 0;
                }
                .element-table {
                    width: 100%;
                    border-collapse: collapse;
                    margin-bottom: 15px;
                    font-size: 11px;
                }
                .element-table th {
                    background-color: #f3f4f6;
                    padding: 6px;
                    text-align: left;
                    border: 1px solid #e5e7eb;
                }
                .element-table td {
                    padding: 6px;
                    border: 1px solid #e5e7eb;
                }
                .amount {
                    text-align: right;
                }
                .report-footer {
                    margin-top: 20px;
                    text-align: center;
                    font-size: 12px;
                    color: #666;
                    border-top: 1px solid #e5e7eb;
                    padding-top: 15px;
                }
                .status-active {
                    color: green;
                    font-weight: bold;
                }
                .status-inactive {
                    color: red;
                    font-weight: bold;
                }
                @media print {
                    .element-table th {
                    background-color: #f3f4f6 !important;
                    -webkit-print-color-adjust: exact;
                    }
                    .sn-column {
                    width: 40px;
                    text-align: center;
                    font-weight: bold;
                    background-color: #f3f4f6;
                    vertical-align: middle;
                    border-right: 2px solid #1a56db;
                    }
                    .element-section {
                    margin-bottom: 30px;
                    padding-bottom: 10px;
                    border-bottom: 1px dashed #e5e7eb;
                    }
                    .combined-tables {
                    border: 1px solid #e5e7eb;
                    margin-bottom: 20px;
                    }
                    .element-table {
                    margin-bottom: 0;
                    border: none;
                    }
                    .element-table:first-child {
                    border-bottom: 2px solid #e5e7eb;
                    }
                </style>
            </head>
            <body>
                <div class="report-header">
                    <div class="report-title">Payment/Deduction Report</div>
                    <div class="date-time">Generated on: ${dateStr} at ${timeStr}</div>
                </div>

                ${data.map((item, index) => `
                    <div class="combined-tables">
                        <table class="element-table">
                            <thead>
                                <tr>
                                    <th class="sn-column">S/N</th>
                                    <th>Service No</th>
                                    <th>Type</th>
                                    <th class="amount">Amount Payable</th>
                                    <th class="amount">Amount To Date</th>
                                    <th class="amount">Amount</th>
                                    <th>Pay Indicator</th>
                                    <th>Months R</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr>
                                    <td class="sn-column">${index + 1}</td>
                                    <td>${item.Empl_id}</td>
                                    <td>${item.type}</td>
                                    <td class="amount">${formatCurrency(item.amount_payable)}</td>
                                    <td class="amount">${formatCurrency(item.amount_to_date)}</td>
                                    <td class="amount">${formatCurrency(item.amt)}</td>
                                    <td>${resolveName(item.indicator, 'payindicator')}</td>
                                    <td>${item.months_remaining || '-'}</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                `).join('')}

                <div class="report-footer">
                    <p>Total Records: ${data.length}</p>
                    <p>Generated by: ${fullName}</p>
                    <p>*** End of Report ***</p>
                </div>
            </body>
            </html>
        `;

        // 3. LAUNCH PUPPETEER AND GENERATE PDF
        browser = await puppeteer.launch({
            // 'new' is slightly faster, but 'headless: true' is the classic default
            headless: true, 
            // Required flags for running in common environments (e.g., Docker/Linux)
            args: ['--no-sandbox', '--disable-setuid-sandbox'] 
        });
        const page = await browser.newPage();
        
        // Set the content and wait for it to load
        await page.setContent(htmlContent, { waitUntil: 'networkidle0' });

        // Generate the PDF buffer
        const pdfBuffer = await page.pdf({
            format: 'A4',
            printBackground: true, // Crucial for including table background colors
            margin: { top: '0.5in', right: '0.5in', bottom: '0.5in', left: '0.5in' },
        });

        // 4. STREAM PDF TO CLIENT
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=payment_report_${dateStr}.pdf`);
        res.send(pdfBuffer);

    } catch (error) {
        console.error('Error generating PDF report:', error);
        res.status(500).json({ error: 'Failed to generate PDF report' });
    } finally {
        if (browser) {
            await browser.close(); // Ensure the browser instance is closed
        }
    }
});

module.exports = router;


