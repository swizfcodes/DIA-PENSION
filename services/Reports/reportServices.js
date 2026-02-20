const pool = require('../../config/db');

class ReportService {
  
  // REPORT 1: PAY SLIPS (USES payslipGenerationService)

  // ========================================================================
  // REPORT 2: PAYMENTS BY BANK (BRANCH)
  // ========================================================================
  async getPaymentsByBank(filters = {}) {
    const { year, month, bankName, summaryOnly, allClasses, specificClass } = filters;
    
    // Determine which databases to query
    let databasesToQuery = [];
    const currentDb = pool.getCurrentDatabase();
    const masterDb = pool.getMasterDb();
    
    if (allClasses === 'true' || allClasses === true) {
      // Only allow all classes if current database is the master/MILITARY database
      if (currentDb !== masterDb) {
        throw new Error('All classes report can only be generated from the MILITARY database');
      }
      
      // If specific class is selected, use only that class
      if (specificClass) {
        const targetDb = pool.getDatabaseFromPayrollClass(specificClass);
        if (!targetDb) {
          throw new Error(`Invalid payroll class: ${specificClass}`);
        }
        databasesToQuery = [{ name: specificClass, db: targetDb }];
      } else {
        // Database to class name mapping
        const dbToClassMap = await this.getDbToClassMap();

        // Get all available databases including the current one
        const dbConfig = require('../../config/db-config').getConfigSync();
        databasesToQuery = Object.entries(dbConfig.databases)
          .map(([className, dbName]) => ({ 
            name: dbToClassMap[dbName] || className, // Use mapped name or fallback to original
            db: dbName 
          }));
      }
    } else {
      // Single database query - current session database
      databasesToQuery = [{ name: 'current', db: currentDb }];
    }
    
    const allResults = [];
    const failedClasses = [];
    
    for (const { name, db } of databasesToQuery) {
      // Temporarily switch to the target database
      const originalDb = pool.getCurrentDatabase();
      
      try {
        pool.useDatabase(db);
      } catch (dbError) {
        console.warn(`⚠️ Skipping ${name} (${db}): ${dbError.message}`);
        failedClasses.push({ class: name, database: db, error: dbError.message });
        continue;
      }
      
      try {
        if (summaryOnly === 'true' || summaryOnly === true) {
          // Summary query - aggregated data
          const query = `
            SELECT 
              sr.ord as year,
              sr.mth as month,
              we.Bankcode,
              we.bankbranch,
              bnk.branchname as bank_branch_name,
              COUNT(DISTINCT we.empl_id) as employee_count,
              ROUND(SUM(mc.his_netmth), 2) as total_net
            FROM py_wkemployees we
            CROSS JOIN (SELECT ord, mth FROM py_stdrate WHERE type = 'BT05') sr
            INNER JOIN py_mastercum mc ON mc.his_empno = we.empl_id AND mc.his_type = sr.mth
            LEFT JOIN py_bank bnk ON bnk.bankcode = we.Bankcode
              AND (
                  bnk.branchcode = we.bankbranch
                  OR bnk.branchcode = LPAD(we.bankbranch, 3, '0')
              )
            WHERE 1=1
              ${year ? 'AND sr.ord = ?' : ''}
              ${month ? 'AND sr.mth = ?' : ''}
              ${bankName ? 'AND we.Bankcode = ?' : ''}
            GROUP BY sr.ord, sr.mth, we.Bankcode, we.bankbranch, bnk.branchname
            ORDER BY we.Bankcode, we.bankbranch
          `;
          
          const params = [];
          if (year) params.push(year);
          if (month) params.push(month);
          if (bankName) params.push(bankName);
          
          const [rows] = await pool.query(query, params);
          
          // Add class identifier to each row
          allResults.push({
            payrollClass: name,
            database: db,
            data: rows
          });
          
        } else {
          // Detailed query - individual employee records
          const query = `
            SELECT 
                sr.ord as year,
                sr.mth as month,
                we.Bankcode,
                we.bankbranch,
                we.empl_id,
                we.Title as Title,
                CONCAT(we.Surname, ' ', we.OtherName) as fullname,
                tt.Description as title,
                we.BankACNumber,
                bnk.branchname as bank_branch_name,
                ROUND(mc.his_netmth, 2) as total_net
            FROM py_wkemployees we
            CROSS JOIN (SELECT ord, mth FROM py_stdrate WHERE type = 'BT05') sr
            INNER JOIN py_mastercum mc ON mc.his_empno = we.empl_id AND mc.his_type = sr.mth
            LEFT JOIN py_bank bnk ON bnk.bankcode = we.Bankcode
            AND (
                bnk.branchcode = we.bankbranch
                OR bnk.branchcode = LPAD(we.bankbranch, 3, '0')
            )
            LEFT JOIN py_Title tt ON tt.Titlecode = we.Title
            WHERE 1=1
              ${year ? 'AND sr.ord = ?' : ''}
              ${month ? 'AND sr.mth = ?' : ''}
              ${bankName ? 'AND we.Bankcode = ?' : ''}
            ORDER BY we.Bankcode, we.bankbranch, we.empl_id
          `;
          
          const params = [];
          if (year) params.push(year);
          if (month) params.push(month);
          if (bankName) params.push(bankName);
          
          const [rows] = await pool.query(query, params);
          
          // Add class identifier to each row
          allResults.push({
            payrollClass: name,
            database: db,
            data: rows
          });
        }
      } catch (queryError) {
        console.error(`❌ Query error for ${name} (${db}):`, queryError.message);
        failedClasses.push({ class: name, database: db, error: queryError.message });
      } finally {
        // Restore original database context
        try {
          pool.useDatabase(originalDb);
        } catch (restoreError) {
          console.warn(`⚠️ Could not restore database context: ${restoreError.message}`);
        }
      }
    }
    
    // Return results based on whether it's a multi-class query
    if (allClasses === 'true' || allClasses === true) {
      const result = { 
        data: allResults,
        summary: {
          total: databasesToQuery.length,
          successful: allResults.length,
          failed: failedClasses.length
        }
      };
      
      if (failedClasses.length > 0) {
        result.failedClasses = failedClasses;
        console.warn(`⚠️ ${failedClasses.length} class(es) failed:`, failedClasses);
      }
      
      return result;
    } else {
      return allResults[0]?.data || [];
    }
  }

  // ========================================================================
  // REPORT 3: ANALYSIS OF EARNINGS/DEDUCTIONS
  // ========================================================================
  async getEarningsDeductionsAnalysis(filters = {}) {
    const { year, month, paymentType, summaryOnly } = filters;
    
    // Convert summaryOnly to boolean if it's a string
    const isSummary = summaryOnly === true || summaryOnly === '1' || summaryOnly === 'true';
    
    const query = `
      SELECT 
        sr.ord as year,
        sr.mth as month,
        mp.his_type as payment_code,
        et.elmDesc as payment_description,
        CASE 
          WHEN LEFT(mp.his_type, 2) IN ('BP', 'BT') THEN 'Earnings'
          WHEN LEFT(mp.his_type, 2) = 'FP' THEN 'Tax-Free Allowance'
          WHEN LEFT(mp.his_type, 2) = 'PT' THEN 'Non-Taxable Allowance'
          WHEN LEFT(mp.his_type, 2) = 'PR' THEN 'Deductions'
          WHEN LEFT(mp.his_type, 2) = 'PL' THEN 'Loan'
          ELSE 'Other'
        END as category,
        ${!isSummary ? `mp.his_empno,
        CONCAT(TRIM(we.Surname), ' ', TRIM(we.OtherName)) as fullname,` : ''}
        ${isSummary ? 'COUNT(DISTINCT mp.his_empno) as employee_count,' : ''}
        ${!isSummary ? `we.Title as Title,` : ''}
        ${!isSummary ? `tt.Description as title,` : ''}
        ROUND(SUM(mp.amtthismth), 2) as total_amount
      FROM py_masterpayded mp
      CROSS JOIN (SELECT ord, mth FROM py_stdrate WHERE type = 'BT05') sr
      ${!isSummary ? 'LEFT JOIN py_wkemployees we ON we.empl_id = mp.his_empno' : ''}
      LEFT JOIN py_elementType et ON et.PaymentType = mp.his_type
      ${!isSummary ? 'LEFT JOIN py_Title tt ON tt.Titlecode = we.Title' : ''}
      WHERE mp.amtthismth != 0
        ${year ? 'AND sr.ord = ?' : ''}
        ${month ? 'AND sr.mth = ?' : ''}
        ${paymentType ? 'AND mp.his_type = ?' : ''}
      GROUP BY sr.ord, sr.mth, mp.his_type, et.elmDesc
        ${!isSummary ? ', mp.his_empno, we.Surname, we.OtherName, we.Title, tt.Description' : ''}
      ORDER BY category, mp.his_type${!isSummary ? ', mp.his_empno' : ''}
    `;
    
    const params = [];
    if (year) params.push(year);
    if (month) params.push(month);
    if (paymentType) params.push(paymentType);
    
    const [rows] = await pool.query(query, params);
    return rows;
  }

  // ========================================================================
  // REPORT 4: LOAN ANALYSIS
  // ========================================================================
  async getLoanAnalysis(filters = {}) {
    const { year, month} = filters;

    const query = `
      SELECT 
        mp.his_empno as employee_id,
        CONCAT(we.Surname, ' ', we.OtherName) as fullname,
        we.Location,
        we.Title as Title,
        tt.Description as title,
        mp.his_type as loan_type,
        et.elmDesc as loan_description,
        ROUND(mp.totamtpayable, 2) as original_loan,
        ROUND(mp.amtthismth, 2) as this_month_payment,
        mp.nmth as months_remaining
      FROM py_masterpayded mp
      CROSS JOIN (SELECT ord, mth FROM py_stdrate WHERE type = 'BT05') sr
      INNER JOIN py_wkemployees we ON we.empl_id = mp.his_empno
      LEFT JOIN py_elementType et ON et.PaymentType = mp.his_type
      LEFT JOIN py_Title tt ON tt.Titlecode = we.Title
      WHERE LEFT(mp.his_type, 2) = 'PL'
        AND (mp.amtthismth > 0)
        ${year ? `AND sr.ord = ?` : ''}
        ${month ? `AND sr.mth = ?` : ''}
      ORDER BY mp.his_type, et.elmDesc, mp.his_empno
    `;

    const params = [];
    if (year) params.push(year);
    if (month) params.push(month);
    
    const [rows] = await pool.query(query, params);
    
    // Group by loan_type and loan_description
    const grouped = {};
    
    rows.forEach(row => {
      const key = `${row.loan_type}|${row.loan_description}`;
      if (!grouped[key]) {
        grouped[key] = {
          loan_type: row.loan_type,
          loan_description: row.loan_description,
          loans: [],
          totals: {
            original_loan: 0,
            this_month_payment: 0,
            count: 0
          }
        };
      }
      
      grouped[key].loans.push(row);
      grouped[key].totals.original_loan += parseFloat(row.original_loan) || 0;
      grouped[key].totals.this_month_payment += parseFloat(row.this_month_payment) || 0;
      grouped[key].totals.count += 1;
    });
    
    return Object.values(grouped);
  }

  // ========================================================================
  // REPORT 5: ANALYSIS OF PAYMENTS/DEDUCTIONS BY BANK
  // ========================================================================
  async getPaymentsDeductionsByBank(filters = {}) {
    const { year, month, bankName, paymentType, summaryOnly } = filters;
    
    // Convert summaryOnly to boolean if it's a string
    const isSummary = summaryOnly === true || summaryOnly === '1' || summaryOnly === 'true';
    
    const query = `
      SELECT 
        sr.ord as year,
        sr.mth as month,
        we.Bankcode,
        we.bankbranch,
        bnk.branchname as bank_branch_name,
        mp.his_type as payment_code,
        et.elmDesc as payment_description,
        CASE 
          WHEN LEFT(mp.his_type, 2) IN ('BP', 'BT') THEN 'Earnings'
          WHEN LEFT(mp.his_type, 2) = 'FP' THEN 'Tax-Free Allowance'
          WHEN LEFT(mp.his_type, 2) = 'PT' THEN 'Non-Taxable Allowance'
          WHEN LEFT(mp.his_type, 2) = 'PR' THEN 'Deductions'
          WHEN LEFT(mp.his_type, 2) = 'PL' THEN 'Loan'
          ELSE 'Other'
        END as category,
        ${!isSummary ? `mp.his_empno,
        we.Surname,
        we.Title as Title,
        CONCAT(we.Surname, ' ', we.OtherName) as fullname,
        tt.Description as title,` : ''}
        ${isSummary ? 'COUNT(DISTINCT mp.his_empno) as employee_count,' : ''}
        ROUND(SUM(mp.amtthismth), 2) as total_amount
      FROM py_masterpayded mp
      CROSS JOIN (SELECT ord, mth FROM py_stdrate WHERE type = 'BT05') sr
      INNER JOIN py_wkemployees we ON we.empl_id = mp.his_empno
      LEFT JOIN py_elementType et ON et.PaymentType = mp.his_type
      LEFT JOIN py_bank bnk ON bnk.bankcode = we.Bankcode AND bnk.branchcode = LPAD(we.bankbranch, 3, '0')
      LEFT JOIN py_Title tt ON tt.Titlecode = we.Title
      WHERE mp.amtthismth != 0
        ${year ? 'AND sr.ord = ?' : ''}
        ${month ? 'AND sr.mth = ?' : ''}
        ${bankName ? 'AND we.Bankcode = ?' : ''}
        ${paymentType ? 'AND mp.his_type = ?' : ''}
      GROUP BY sr.ord, sr.mth, we.Bankcode, we.bankbranch, bnk.branchname, mp.his_type, et.elmDesc, mp.his_empno, we.Surname, we.OtherName, we.Title, tt.Description
        ${!isSummary ? ', mp.his_empno, we.Surname, we.Title, tt.Description' : ''}
      ORDER BY we.Bankcode, we.bankbranch, category, mp.his_type${!isSummary ? ', mp.his_empno' : ''}
    `;
    
    const params = [];
    if (year) params.push(year);
    if (month) params.push(month);
    if (bankName) params.push(bankName);
    if (paymentType) params.push(paymentType);
    
    const [rows] = await pool.query(query, params);
    return rows;
  }

  // ========================================================================
  // REPORT 6: PAYROLL REGISTER
  // ========================================================================
  async getPayrollRegister(filters = {}) {
    const { year, month, location, includeElements, summaryOnly } = filters;
    
    // Convert summaryOnly to boolean if it's a string
    const isSummary = summaryOnly === true || summaryOnly === '1' || summaryOnly === 'true';
    
    const query = `
      SELECT 
        sr.ord as year,
        sr.mth as month,
        ${!isSummary ? `we.empl_id,
        CONCAT(TRIM(we.Surname), ' ', TRIM(we.OtherName)) as fullname,` : ''}
        cc.unitdesc as location,
        ${!isSummary ? `we.gradelevel,
          we.Title as Title,
          tt.Description as title,` : ''}
        ${isSummary ? 'COUNT(DISTINCT we.empl_id) as employee_count,' : ''}
        ROUND(${isSummary ? 'SUM(mc.his_grossmth)' : 'mc.his_grossmth'}, 2) as gross_pay,
        ROUND(${isSummary ? 'SUM(' : ''}(
          SELECT COALESCE(SUM(mp.amtthismth), 0)
          FROM py_masterpayded mp
          WHERE mp.his_empno = we.empl_id
            AND LEFT(mp.his_type, 2) IN ('PT', 'BP', 'BT')
            AND mp.amtthismth != 0
        )${isSummary ? ')' : ''}, 2) as total_emoluments,
        ROUND(${isSummary ? 'SUM(' : ''}(
          SELECT COALESCE(SUM(mp.amtthismth), 0)
          FROM py_masterpayded mp
          WHERE mp.his_empno = we.empl_id
            AND LEFT(mp.his_type, 2) IN ('PL', 'PR')
            AND mp.amtthismth != 0
        )${isSummary ? ')' : ''}, 2) as total_deductions,
        ROUND(${isSummary ? 'SUM(mc.his_taxmth)' : 'mc.his_taxmth'}, 2) as tax,
        ROUND(${isSummary ? 'SUM(mc.his_netmth)' : 'mc.his_netmth'}, 2) as net_pay,
        ${includeElements && !isSummary ? `
          (
            SELECT JSON_ARRAYAGG(
              JSON_OBJECT(
                'code', mp2.his_type,
                'description', et.elmDesc,
                'amount', ROUND(mp2.amtthismth, 2),
                'category', LEFT(mp2.his_type, 2)
              )
            )
            FROM py_masterpayded mp2
            LEFT JOIN py_elementType et ON et.PaymentType = mp2.his_type
            WHERE mp2.his_empno = we.empl_id
              AND mp2.amtthismth != 0
          ) as payment_elements,
        ` : ''}
        ${!isSummary ? `we.Bankcode,
        we.BankACNumber,
        DATE_FORMAT(mc.datecreated, '%Y-%m-%d %H:%i:%s') as processed_date` : 'NULL as Bankcode, NULL as BankACNumber, NULL as processed_date'}
      FROM py_wkemployees we
      CROSS JOIN (SELECT ord, mth FROM py_stdrate WHERE type = 'BT05') sr
      INNER JOIN py_mastercum mc ON mc.his_empno = we.empl_id AND mc.his_type = sr.mth
      LEFT JOIN ac_costcentre cc ON cc.unitcode = we.Location
      ${!isSummary ? 'LEFT JOIN py_Title tt ON tt.Titlecode = we.Title' : ''}
      WHERE 1=1
        ${year ? 'AND sr.ord = ?' : ''}
        ${month ? 'AND sr.mth = ?' : ''}
        ${location ? 'AND we.Location = ?' : ''}
      GROUP BY sr.ord, sr.mth${!isSummary ? ', we.empl_id, we.Surname, we.OtherName, we.gradelevel, we.Bankcode, we.BankACNumber, we.Title, tt.Description, mc.datecreated' : ''}, cc.unitdesc
      ORDER BY cc.unitdesc${!isSummary ? ', we.empl_id' : ''}
    `;
    
    const params = [];
    if (year) params.push(year);
    if (month) params.push(month);
    if (location) params.push(location);
    
    const [rows] = await pool.query(query, params);
    return rows;
  }

  // ========================================================================
  // REPORT 8: PAYMENT STAFF LIST
  // ========================================================================
  async getPaymentStaffList(filters = {}) {
    const { year, month, location, bankName, summaryOnly } = filters;
    
    // Convert summaryOnly to boolean if it's a string
    const isSummary = summaryOnly === true || summaryOnly === '1' || summaryOnly === 'true';
    
    const query = `
      SELECT 
        ${!isSummary ? `we.empl_id as service_number,
        CONCAT(TRIM(we.Surname), ' ', TRIM(we.OtherName)) as fullname,
        tt.Description as title,` : ''}
        cc.unitdesc as location,
        we.Bankcode,
        we.bankbranch,
        ${!isSummary ? `we.BankACNumber,
        we.gradelevel,
        we.Title as Title,
        SUBSTRING(we.gradelevel, 1, 2) as gradelevel,
        ROUND(TIMESTAMPDIFF(YEAR, we.datepmted, NOW()), 0) AS level_years,` : ''}
        st.Statename as state_of_origin,
        ${isSummary ? 'COUNT(DISTINCT we.empl_id) as employee_count,' : ''}
        ROUND(${isSummary ? 'SUM(mc.his_netmth)' : 'mc.his_netmth'}, 2) as net_pay
      FROM py_wkemployees we
      CROSS JOIN (SELECT ord, mth FROM py_stdrate WHERE type = 'BT05') sr
      INNER JOIN py_mastercum mc ON mc.his_empno = we.empl_id AND mc.his_type = sr.mth
      LEFT JOIN py_tblstates st ON st.Statecode = we.StateofOrigin
      LEFT JOIN ac_costcentre cc ON cc.unitcode = we.Location
      ${!isSummary ? 'LEFT JOIN py_Title tt ON tt.Titlecode = we.Title' : ''}
      WHERE mc.his_netmth > 0
        ${year ? 'AND sr.ord = ?' : ''}
        ${month ? 'AND sr.mth = ?' : ''}
        ${location ? 'AND we.Location = ?' : ''}
        ${bankName ? 'AND we.Bankcode = ?' : ''}
      GROUP BY ${!isSummary ? 'we.empl_id, we.Surname, we.OtherName, tt.Description, we.Title, ' : ''}
        cc.unitdesc, we.Bankcode, we.bankbranch${!isSummary ? ', we.BankACNumber, we.gradelevel, we.datepmted' : ''}, st.Statename
        ${!isSummary ? ', mc.his_netmth' : ''}
      ORDER BY we.Bankcode, ${!isSummary ? 'we.empl_id' : 'cc.unitdesc'}
    `;
    
    const params = [];
    if (year) params.push(year);
    if (month) params.push(month);
    if (location) params.push(location);
    if (bankName) params.push(bankName);
    
    const [rows] = await pool.query(query, params);
    return rows;
  }

  // ========================================================================
  // HELPER: Get Current Period
  // ========================================================================
  async getCurrentPeriod() {
    const query = `
      SELECT ord as year, mth as month, pmth as prev_month
      FROM py_stdrate 
      WHERE type = 'BT05'
      LIMIT 1
    `;
    const [rows] = await pool.query(query);
    return rows[0];
  }

  // ========================================================================
  // HELPER: Get available Banks
  // ========================================================================
  async getAvailableBanks() {
    const query = `
      SELECT DISTINCT we.Bankcode, we.bankbranch, bnk.branchname
      FROM py_wkemployees we
      LEFT JOIN py_bank bnk ON bnk.bankcode = we.Bankcode
        AND (
            bnk.branchcode = we.bankbranch
            OR bnk.branchcode = LPAD(we.bankbranch, 3, '0')
        )
      ORDER BY we.Bankcode, we.bankbranch
    `;
    const [rows] = await pool.query(query);
    return rows;
  }

  async getDbToClassMap() {
    const masterDb = pool.getMasterDb();
    pool.useDatabase(masterDb);
    const [dbClasses] = await pool.query('SELECT db_name, classname FROM py_payrollclass');
    
    const dbToClassMap = {};
    dbClasses.forEach(row => {
      dbToClassMap[row.db_name] = row.classname;
    });
    
    return dbToClassMap;
  }
}

module.exports = new ReportService();