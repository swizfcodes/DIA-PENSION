const pool = require('../../config/db');

class DuplicateAccountService {
  
  // ========================================================================
  // HELPER: Get Payroll Class from Current Database
  // ========================================================================
  /**
   * Maps database name to payroll class code from py_payrollclass
   * @param {string} dbName - Current database name
   * @returns {string} Payroll class code
   */
  async getPayrollClassFromDb(dbName) {
    const masterDb = pool.getMasterDb();
    const connection = await pool.getConnection();
    
    try {
      await connection.query(`USE \`${masterDb}\``);
      const [rows] = await connection.query(
        'SELECT classcode FROM py_payrollclass WHERE db_name = ?',
        [dbName]
      );
      
      const result = rows.length > 0 ? rows[0].classcode : null;
      console.log('🔍 Database:', dbName, '→ Payroll Class:', result);
      return result;
    } finally {
      connection.release();
    }
  }

  // ========================================================================
  // GET DUPLICATE ACCOUNT NUMBERS REPORT
  // ========================================================================
  async getDuplicateAccounts(filters = {}, currentDb) {
    const { bankCode, includeInactive } = filters;
    
    const payrollClass =  await this.getPayrollClassFromDb(currentDb);
    
    console.log('📊 Duplicate Account Numbers Request:');
    console.log('   └─ Database:', currentDb);
    console.log('   └─ Payroll Class:', payrollClass);
    console.log('   └─ Filters:', JSON.stringify(filters, null, 2));

    try {
      // Step 1: Find duplicate account numbers
      const duplicateQuery = `
        SELECT 
          BankACNumber as account_number,
          Bankcode as bank_code,
          COUNT(*) as duplicate_count
        FROM hr_employees
        WHERE payrollclass = ?
          AND BankACNumber IS NOT NULL 
          AND BankACNumber != ''
          AND TRIM(BankACNumber) != ''
          ${!includeInactive ? 'AND (DateLeft IS NULL OR DateLeft = "") AND (exittype IS NULL OR exittype = "")' : ''}
          ${bankCode ? 'AND Bankcode = ?' : ''}
        GROUP BY BankACNumber, Bankcode
        HAVING COUNT(*) > 1
        ORDER BY duplicate_count DESC, BankACNumber
      `;

      const duplicateParams = [payrollClass];
      if (bankCode) duplicateParams.push(bankCode);

      console.log('🔍 Searching for duplicate account numbers...');
      const [duplicates] = await pool.query(duplicateQuery, duplicateParams);

      if (duplicates.length === 0) {
        console.log('✅ NO DUPLICATE ACCOUNTS FOUND - All account numbers are unique!');
        return [];
      }

      console.log('⚠️  Found', duplicates.length, 'duplicate account numbers');

      // Step 2: Get employee details for each duplicate account
      const results = [];

      for (const duplicate of duplicates) {
        const employeesQuery = `
          SELECT 
            Empl_ID as employee_id,
            CONCAT(TRIM(Surname), ' ', TRIM(IFNULL(OtherName, ''))) as full_name,
            Surname,
            OtherName,
            Title as title_code,
            BankACNumber as account_number,
            Bankcode as bank_code,
            bankbranch as bank_branch,
            Location as location_code,
            gradelevel,
            gradetype,
            DateEmpl as date_employed,
            DateLeft as date_left,
            exittype,
            Status as status,
            CASE 
              WHEN DateLeft IS NOT NULL AND DateLeft != '' AND LENGTH(DateLeft) = 8
              THEN DATE_FORMAT(STR_TO_DATE(DateLeft, '%Y%m%d'), '%d-%b-%Y')
              ELSE 'Active'
            END as status_display
          FROM hr_employees
          WHERE payrollclass = ?
            AND BankACNumber = ?
            AND Bankcode = ?
            ${!includeInactive ? 'AND (DateLeft IS NULL OR DateLeft = "") AND (exittype IS NULL OR exittype = "")' : ''}
          ORDER BY 
            CASE WHEN DateLeft IS NULL OR DateLeft = '' THEN 0 ELSE 1 END,
            Surname, OtherName
        `;

        const employeesParams = [payrollClass, duplicate.account_number, duplicate.bank_code];
        const [employees] = await pool.query(employeesQuery, employeesParams);

        // Get bank name if available
        const bankNameQuery = `
          SELECT bankname as bank_name
          FROM py_bank
          WHERE bankcode = ?
          LIMIT 1
        `;
        const [bankInfo] = await pool.query(bankNameQuery, [duplicate.bank_code]);
        const bankName = bankInfo.length > 0 ? bankInfo[0].bank_name : duplicate.bank_code;

        results.push({
          account_number: duplicate.account_number,
          bank_code: duplicate.bank_code,
          bank_name: bankName,
          duplicate_count: duplicate.duplicate_count,
          employees: employees,
          active_count: employees.filter(e => !e.date_left || e.date_left === '').length,
          inactive_count: employees.filter(e => e.date_left && e.date_left !== '').length
        });
      }

      console.log('✅ Duplicate Account Analysis Complete:');
      console.log('   └─ Total Duplicate Account Numbers:', results.length);
      console.log('   └─ Total Affected Employees:', results.reduce((sum, r) => sum + r.duplicate_count, 0));

      return results;

    } catch (error) {
      console.error('❌ ERROR in getDuplicateAccounts:');
      console.error('   └─ Error Type:', error.constructor.name);
      console.error('   └─ Error Code:', error.code);
      console.error('   └─ Error Message:', error.message);
      console.error('   └─ SQL State:', error.sqlState);
      console.error('   └─ Full Error:', error);
      throw error;
    }
  }

  // ========================================================================
  // GET STATISTICS FOR DUPLICATE ACCOUNTS
  // ========================================================================
  async getDuplicateStatistics(duplicateData) {
    const stats = {
      total_duplicate_accounts: duplicateData.length,
      total_affected_employees: 0,
      total_active_affected: 0,
      total_inactive_affected: 0,
      highest_duplicate_count: 0,
      accounts_by_duplicate_count: {},
      banks_with_duplicates: {},
      severity_breakdown: {
        low: 0,      // 2 employees
        medium: 0,   // 3-4 employees
        high: 0,     // 5+ employees
      }
    };

    duplicateData.forEach(dup => {
      stats.total_affected_employees += dup.duplicate_count;
      stats.total_active_affected += dup.active_count;
      stats.total_inactive_affected += dup.inactive_count;

      if (dup.duplicate_count > stats.highest_duplicate_count) {
        stats.highest_duplicate_count = dup.duplicate_count;
      }

      // Count by duplicate count
      if (!stats.accounts_by_duplicate_count[dup.duplicate_count]) {
        stats.accounts_by_duplicate_count[dup.duplicate_count] = 0;
      }
      stats.accounts_by_duplicate_count[dup.duplicate_count]++;

      // Count by bank
      if (!stats.banks_with_duplicates[dup.bank_name]) {
        stats.banks_with_duplicates[dup.bank_name] = {
          count: 0,
          affected_employees: 0
        };
      }
      stats.banks_with_duplicates[dup.bank_name].count++;
      stats.banks_with_duplicates[dup.bank_name].affected_employees += dup.duplicate_count;

      // Severity breakdown
      if (dup.duplicate_count === 2) {
        stats.severity_breakdown.low++;
      } else if (dup.duplicate_count <= 4) {
        stats.severity_breakdown.medium++;
      } else {
        stats.severity_breakdown.high++;
      }
    });

    return stats;
  }

  // ========================================================================
  // GET AVAILABLE BANKS (for filter dropdown)
  // ========================================================================
  async getAvailableBanks(currentDb) {
    try {
      const payrollClass = await this.getPayrollClassFromDb(currentDb);

      const query = `
        SELECT DISTINCT 
          h.Bankcode as code,
          COALESCE(b.bankname, h.Bankcode) as description
        FROM hr_employees h
        LEFT JOIN py_bank b ON b.bankcode = h.Bankcode
        WHERE h.Bankcode IS NOT NULL 
          AND h.Bankcode != ''
          AND h.payrollclass = ?
          AND (h.DateLeft IS NULL OR h.DateLeft = '')
          AND (h.exittype IS NULL OR h.exittype = '')
        ORDER BY h.Bankcode
      `;

      const [rows] = await pool.query(query, [payrollClass]);
      return rows;

    } catch (error) {
      console.error('❌ ERROR in getAvailableBanks:', error);
      throw error;
    }
  }

  // ========================================================================
  // CHECK SPECIFIC ACCOUNT NUMBER
  // ========================================================================
  async checkAccountNumber(accountNumber, currentDb) {
    const payrollClass = await this.getPayrollClassFromDb(currentDb);

    console.log('🔍 Checking account number:', accountNumber);

    try {
      const query = `
        SELECT 
          Empl_ID as employee_id,
          CONCAT(TRIM(Surname), ' ', TRIM(IFNULL(OtherName, ''))) as full_name,
          Title as title_code,
          BankACNumber as account_number,
          Bankcode as bank_code,
          bankbranch as bank_branch,
          Location as location_code,
          DateLeft as date_left,
          Status as status
        FROM hr_employees
        WHERE payrollclass = ?
          AND BankACNumber = ?
          AND (DateLeft IS NULL OR DateLeft = '')
          AND (exittype IS NULL OR exittype = '')
        ORDER BY Empl_ID
      `;

      const [employees] = await pool.query(query, [payrollClass, accountNumber]);

      if (employees.length <= 1) {
        console.log('✅ Account number is unique (found', employees.length, 'record)');
        return {
          is_duplicate: false,
          count: employees.length,
          employees: employees
        };
      } else {
        console.log('⚠️  Account number is duplicated (found', employees.length, 'records)');
        return {
          is_duplicate: true,
          count: employees.length,
          employees: employees
        };
      }

    } catch (error) {
      console.error('❌ ERROR in checkAccountNumber:', error);
      throw error;
    }
  }
}

module.exports = new DuplicateAccountService();