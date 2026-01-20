// ============================================================================
// FILE: services/payslipGenerationService.js
// Payslip Generation matching legacy py_py24slip logic
// ============================================================================

const pool = require('../../config/db');

class PayslipGenerationService {

  // ==========================================================================
  // MAIN: Generate Payslips (matches py_py24slip stored procedure)
  // ==========================================================================
  async generatePayslips(params) {
    const {
      empno1,           // Start employee ID or single ID
      empno2,           // End employee ID
      branch,           // Payroll class (Officers/Ratings)
      optall,           // Option: All employees
      optrange,         // Option: Range of employees
      optbank,          // Option: By bank
      optloc,           // Option: By location
      optindividual,    // Option: Individual employee
      wxdate,           // Processing date
      station,           // Workstation/user ID (from req.user_fullname)
      year,
      month
    } = params;

    if (!station) {
      throw new Error('User fullname is required for station identification');
    }

    try {
      // Step 1: Clear previous temp data for this user
      await this.clearTempData(station);

      // Step 2: Get current period
      const period = await this.getCurrentPeriod(year, month);
      if (!period) {
        throw new Error('Current period not set (BT05) or invalid year/month provided');
      }

      // Step 3: Get employees based on options
      const employees = await this.getEmployees({
        empno1,
        empno2,
        branch,
        optall,
        optrange,
        optbank,
        optloc,
        optindividual
      });

      if (employees.length === 0) {
        return { success: false, message: 'No employees found', count: 0 };
      }

      // Step 4: Process each employee
      let processedCount = 0;
      for (const employee of employees) {
        const processed = await this.processEmployeePayslip(
          employee,
          period,
          station,
          wxdate,
          branch
        );
        if (processed) processedCount++;
      }

      // Step 5: Clean up zero records (matching legacy behavior)
      await this.cleanupZeroRecords(station);

      return {
        success: true,
        message: `Payslips generated successfully`,
        count: processedCount,
        total: employees.length
      };

    } catch (error) {
      console.error('Payslip generation error:', error);
      throw error;
    }
  }

  // ==========================================================================
  // Get employees based on filter options
  // ==========================================================================
  async getEmployees(options) {
    const { empno1, empno2, branch, optall, optrange, optbank, optloc, optindividual } = options;
    
    let query = `
      SELECT 
        empl_id,
        dateleft,
        factory,
        location,
        title,
        surname,
        othername,
        bankacnumber,
        bankcode,
        gradelevel,
        gradetype,
        nsitfcode,
        payrollclass
      FROM py_wkemployees
      WHERE 1=1
    `;
    
    const params = [];

    // Apply payroll class filter
    if (branch) {
      query += ` AND payrollclass = ?`;
      params.push(branch);
    }

    // Apply selection options (matching legacy logic)
    if (optall === '1') {
      // All employees - no additional filter
      query += ` ORDER BY factory, location, empl_id`;
    } else if (optrange === '1') {
      // Range of employees
      query += ` AND empl_id BETWEEN ? AND ? ORDER BY factory, location, empl_id`;
      params.push(empno1, empno2);
    } else if (optbank === '1') {
      // By bank
      query += ` AND bankcode = ? ORDER BY bankbranch, empl_id`;
      params.push(empno1);
    } else if (optloc === '1') {
      // By location
      query += ` AND location = ? ORDER BY factory, location, empl_id`;
      params.push(empno1);
    } else if (optindividual === '1') {
      // Individual employee
      query += ` AND empl_id = ? ORDER BY empl_id`;
      params.push(empno1);
    } else {
      // Default to all
      query += ` ORDER BY factory, location, empl_id`;
    }

    const [rows] = await pool.query(query, params);
    return rows;
  }

  // ==========================================================================
  // Process individual employee payslip
  // ==========================================================================
  async processEmployeePayslip(employee, period, station, wxdate, branch) {
    const empno = employee.empl_id;

    // Check if employee has left before processing date
    if (employee.dateleft && employee.dateleft !== '' && employee.dateleft <= wxdate) {
      return false; // Skip terminated employees
    }

    try {
      // Step 1: Get cumulative data for this employee
      const cumulative = await this.getEmployeeCumulative(empno, period.mth);
      
      if (!cumulative) {
        console.log(`No cumulative data for ${empno}`);
        return false;
      }

      // Step 2: Get payment details (excluding FP types - matching legacy)
      const payments = await this.getEmployeePayments(empno);
      
      if (payments.length === 0) {
        console.log(`No payment records for ${empno}`);
        return false;
      }

      // Step 3: Get metadata (factory, department, bank, etc.)
      const metadata = await this.getEmployeeMetadata(employee);

      // Step 4: Insert payslip records for each payment type
      for (const payment of payments) {
        await this.insertPayslipRecord({
          employee,
          payment,
          cumulative,
          metadata,
          period,
          station,
          branch
        });
      }

      return true;

    } catch (error) {
      console.error(`Error processing employee ${empno}:`, error);
      return false;
    }
  }

  // ==========================================================================
  // Get employee cumulative data
  // ==========================================================================
  async getEmployeeCumulative(empno, month) {
    const query = `
      SELECT 
        his_taxtodate as taxtodate,
        his_taxmth as taxmth,
        his_grosstodate as grstodate,
        his_taxfreepaytodate as freetodate,
        his_taxabletodate as taxable,
        his_netmth as netmth
      FROM py_mastercum
      WHERE his_empno = ?
        AND his_type = ?
      LIMIT 1
    `;

    const [rows] = await pool.query(query, [empno, month]);
    return rows[0] || null;
  }

  // ==========================================================================
  // Get employee payment details (matching legacy - excludes FP types)
  // ==========================================================================
  async getEmployeePayments(empno) {
    const query = `
      SELECT 
        his_type,
        amtthismth,
        initialloan,
        totamtpayable,
        nmth,
        payindic
      FROM py_masterpayded
      WHERE his_empno = ?
        AND amtthismth > 0
        AND LEFT(his_type, 2) != 'FP'
      ORDER BY his_type
    `;

    const [rows] = await pool.query(query, [empno]);
    return rows;
  }

  // ==========================================================================
  // Get employee metadata (factory, department, bank names)
  // ==========================================================================
  async getEmployeeMetadata(employee) {
    const metadata = {
      factory_desc: '',
      dept_desc: '',
      bank_name: '',
      title_desc: '',
      payclass_desc: '',
      pfa_desc: ''
    };

    try {
      // Get factory description
      if (employee.factory && employee.factory !== '0') {
        const [factoryRows] = await pool.query(
          `SELECT busdesc FROM ac_businessline WHERE busline = ? LIMIT 1`,
          [employee.factory]
        );
        metadata.factory_desc = factoryRows[0]?.busdesc?.substring(0, 70) || '';
      }

      // Get department/location description
      if (employee.location) {
        const [deptRows] = await pool.query(
          `SELECT unitdesc FROM ac_costcentre WHERE unitcode = ? LIMIT 1`,
          [employee.location]
        );
        metadata.dept_desc = deptRows[0]?.unitdesc?.substring(0, 70) || '';
      }

      // Get bank name
      if (employee.bankcode) {
        const [bankRows] = await pool.query(
          `SELECT bankname FROM py_bank WHERE bankcode = ? LIMIT 1`,
          [employee.bankcode]
        );
        metadata.bank_name = bankRows[0]?.bankname || '';
      }

      // Get PFA description
      if (employee.pfacode) {
        const [pfaRows] = await pool.query(
          `SELECT pfadesc FROM py_pfa WHERE pfacode = ? LIMIT 1`,
          [employee.pfacode]
        );
        metadata.pfa_desc = pfaRows[0]?.pfadesc || '';
      }

    } catch (error) {
      console.error('Error fetching metadata:', error);
    }

    // Get title description
    if (employee.title) {
      const [titleRows] = await pool.query(
        `SELECT Description FROM py_Title WHERE Titlecode = ? LIMIT 1`,
        [employee.title]
      );
      metadata.title_desc = titleRows[0]?.Description || '';
    }

    // Get payclass description
    /*if (employee.payrollclass) {
      const [payclassRows] = await pool.query(
        `SELECT classname FROM py_payrollclass WHERE classcode = ? LIMIT 1`,
        [employee.payrollclass]
      );
      metadata.payclass_desc = payclassRows[0]?.payclassdesc || '';
    }*/

    return metadata;
  }

  // ==========================================================================
  // Insert payslip record (matching legacy table structure)
  // ==========================================================================
  async insertPayslipRecord(data) {
    const { employee, payment, cumulative, metadata, period, station, branch } = data;

    // Categorize payment (matching legacy logic)
    let bpc = '';     // Category code
    let bpa = '';     // Category description
    let loan = 0;
    let ltenor = 0;   // Loan tenor
    let lbal = 0;     // Loan balance
    let lmth = 0;     // Loan months

    const paymentType = payment.his_type.substring(0, 2);

    if (paymentType === 'BP' || paymentType === 'BT') {
      bpc = 'BP';
      bpa = 'TAXABLE PAYMENT';
      lbal = 0; // No loan for basic pay
    } else if (paymentType === 'PT') {
      bpc = 'PT';
      bpa = 'NON-TAXABLE PAYMENT';
      lbal = 0;
    } else if (paymentType === 'PR' || paymentType === 'PL') {
      bpc = 'PR';
      bpa = 'DEDUCTION';
      
      // Handle loans (matching legacy logic)
      if (payment.payindic === 'L') {
        loan = payment.initialloan || 0;
        ltenor = payment.nmth || 0;
        lbal = payment.totamtpayable || 0;
        lmth = payment.nmth || 0;
      } else {
        lbal = 0;
      }
    }

    // Clean up small balances (matching legacy: If @totamtpayable<5.00)
    if (lbal < 5.00) {
      lbal = 0;
    }

    // Calculate previous tax to date
    const prvtaxtodate = (cumulative.taxtodate || 0) - (cumulative.taxmth || 0);

    // Get payment description
    const [descRows] = await pool.query(
      `SELECT elmDesc FROM py_elementType WHERE PaymentType = ? LIMIT 1`,
      [payment.his_type]
    );
    const wdesc = (descRows[0]?.elmDesc || '').substring(0, 30);

    // Get month description
    const [monthRows] = await pool.query(
      `SELECT mthdesc FROM ac_months WHERE cmonth = ? LIMIT 1`,
      [period.mth]
    );
    const mthdesc = monthRows[0]?.mthdesc || '';

    // Insert into temp table (matching legacy structure)
    const query = `
      INSERT INTO py_tempslipnlpc (
        work_station, NUMB, bpc, bpa, BP, BPM,
        loan, ltenor, lbal, lmth,
        ord, desc1, tpcoy, tpaddr,
        title, surname, othername, bankacnumber, bankname,
        gradelevel, gradetype, prvtaxtodate,
        taxtodate, grstodate, freetodate, txbltodate,
        currtax, netpay, groupcode, factory,
        location, nsitf, nsitfcode, email,
        status, payclass
      )
      VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?
      )
    `;

    const values = [
      station,                              // work_station
      employee.empl_id,                     // NUMB
      bpc,                                  // bpc (category code)
      bpa,                                  // bpa (category description)
      wdesc,                                // BP (payment description)
      payment.amtthismth,                   // BPM (amount this month)
      loan,                                 // loan (initial loan amount)
      ltenor,                               // ltenor (loan tenor)
      lbal,                                 // lbal (loan balance)
      lmth,                                 // lmth (loan months remaining)
      period.ord,                           // ord (year)
      mthdesc,                              // desc1 (month description)
      '',                                   // tpcoy (company - empty)
      '',                                   // tpaddr (address - empty)
      metadata.title_desc || employee.title,            // title
      employee.surname || '',               // surname
      employee.othername || '',             // othername
      employee.bankacnumber || '',          // bankacnumber
      metadata.bank_name || '',             // bankname
      employee.gradelevel || '',            // gradelevel
      employee.gradetype || '',             // gradetype
      prvtaxtodate,                         // prvtaxtodate
      cumulative.taxtodate || 0,            // taxtodate
      cumulative.grstodate || 0,            // grstodate
      cumulative.freetodate || 0,           // freetodate
      cumulative.taxable || 0,              // txbltodate
      cumulative.taxmth || 0,               // currtax
      cumulative.netmth || 0,               // netpay
      '00',                                 // groupcode
      metadata.factory_desc || '',          // factory
      metadata.dept_desc || '',             // location
      metadata.pfa_desc || '',              // nsitf (actually PFA)
      employee.nsitfcode || '',             // nsitfcode
      employee.email || '',                 // email
      0,                                    // status
      branch                                // payclass
    ];

    await pool.query(query, values);
  }

  // ==========================================================================
  // Get current period
  // ==========================================================================
  async getCurrentPeriod(manualYear = null, manualMonth = null) {
    // If manual year and month provided, use those instead of BT05
    if (manualYear && manualMonth) {
      console.log(`📅 Using manual period: Year=${manualYear}, Month=${manualMonth}`);
      
      // Validate that the manual period exists in py_stdrate
      const validateQuery = `
        SELECT ord, mth, pmth
        FROM py_stdrate
        WHERE type = 'BT05'
          AND ord = ?
          AND mth = ?
        LIMIT 1
      `;
      
      const [rows] = await pool.query(validateQuery, [manualYear, manualMonth]);
      
      if (rows.length > 0) {
        return rows[0];
      } else {
        // If not found in py_stdrate, create a period object anyway
        console.warn(`⚠️ Manual period ${manualYear}-${manualMonth} not found in py_stdrate, using provided values`);
        return {
          ord: manualYear,
          mth: manualMonth,
          pmth: null
        };
      }
    }
    
    // Default: Get current period from BT05
    const query = `
      SELECT ord, mth, pmth
      FROM py_stdrate
      WHERE type = 'BT05'
      LIMIT 1
    `;

    const [rows] = await pool.query(query);
    
    if (rows.length > 0) {
      console.log(`📅 Using BT05 period: Year=${rows[0].ord}, Month=${rows[0].mth}`);
    }
    
    return rows[0] || null;
  }

  // ==========================================================================
  // Clear temp data for user
  // ==========================================================================
  async clearTempData(station) {
    const query = `DELETE FROM py_tempslipnlpc WHERE work_station = ?`;
    await pool.query(query, [station]);
  }

  // ==========================================================================
  // Clean up zero records (matching legacy behavior)
  // ==========================================================================
  async cleanupZeroRecords(station) {
    const query = `
      DELETE FROM py_tempslipnlpc
      WHERE work_station = ?
        AND currtax = 0
        AND bpm = 0
    `;
    await pool.query(query, [station]);
  }

  // ==========================================================================
  // Retrieve generated payslips
  // ==========================================================================
  async getGeneratedPayslips(station) {
    const query = `
      SELECT *
      FROM py_tempslipnlpc
      WHERE work_station = ?
      ORDER BY NUMB, bpc, BP
    `;

    const [rows] = await pool.query(query, [station]);
    return rows;
  }

  // ==========================================================================
  // Get payslips grouped by employee
  // ==========================================================================
  async getPayslipsGroupedByEmployee(station){
    const query = `
      SELECT 
        p.NUMB as employee_id,
        p.title,
        p.surname,
        p.othername,
        p.bankacnumber,
        p.bankname,
        p.gradelevel,
        p.gradetype,
        p.ord as year,
        p.desc1 as month_desc,
        p.factory,
        p.location,
        p.nsitf,
        p.nsitfcode,
        p.email,
        p.payclass,
        pc.classname as payclass_name,
        MAX(p.prvtaxtodate) as prvtaxtodate,
        MAX(p.taxtodate) as taxtodate,
        MAX(p.grstodate) as grstodate,
        MAX(p.freetodate) as freetodate,
        MAX(p.txbltodate) as txbltodate,
        MAX(p.currtax) as currtax,
        MAX(p.netpay) as netpay
      FROM py_tempslipnlpc p
      LEFT JOIN py_payrollclass pc ON p.payclass = pc.classcode
      WHERE p.work_station = ?
      GROUP BY 
        p.NUMB, p.title, p.surname, p.othername, p.bankacnumber, p.bankname,
        p.gradelevel, p.gradetype, p.ord, p.desc1, p.factory, p.location,
        p.nsitf, p.nsitfcode, p.email, p.payclass, pc.classname
      ORDER BY p.NUMB
    `;

    const [rows] = await pool.query(query, [station]);
    
    // Get payments for each employee separately
    const result = [];
    
    for (const row of rows) {
      const paymentsQuery = `
        SELECT 
          bpc as category_code,
          bpa as category_desc,
          BP as payment_desc,
          BPM as amount,
          loan,
          ltenor as loan_tenor,
          lbal as loan_balance,
          lmth as loan_months
        FROM py_tempslipnlpc
        WHERE work_station = ?
          AND NUMB = ?
        ORDER BY bpc, BP
      `;
      
      const [payments] = await pool.query(paymentsQuery, [station, row.employee_id]);
      
      result.push({
        ...row,
        payments: payments || []
      });
    }
    
    return result;
  }
}

module.exports = new PayslipGenerationService();


