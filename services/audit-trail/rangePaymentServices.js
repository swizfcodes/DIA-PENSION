const pool = require('../../config/db');

class RangePaymentServices {
  async getPaymentsByBankInRange(filters = {}) {
    const { 
      year, 
      month, 
      bankName, 
      summaryOnly, 
      allClasses, 
      specificClass,
      minAmount,  // New filter for minimum amount
      maxAmount   // New filter for maximum amount
    } = filters;
    
    // Validate amount range parameters
    if (minAmount === undefined || maxAmount === undefined) {
      throw new Error('Both minAmount and maxAmount are required for in-range filtering');
    }
    
    const min = parseFloat(minAmount);
    const max = parseFloat(maxAmount);
    
    if (isNaN(min) || isNaN(max)) {
      throw new Error('minAmount and maxAmount must be valid numbers');
    }
    
    if (min > max) {
      throw new Error('minAmount cannot be greater than maxAmount');
    }
    
    // Determine which databases to query
    let databasesToQuery = [];
    const currentDb = pool.getCurrentDatabase();
    const masterDb = pool.getMasterDb();
    
    if (allClasses === 'true' || allClasses === true) {
      // Only allow all classes if current database is the master/officers database
      if (currentDb !== masterDb) {
        throw new Error('All classes report can only be generated from the Officers database');
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
        const dbToClassMap = {
          [process.env.DB_OFFICERS]: 'OFFICERS',
          [process.env.DB_WOFFICERS]: 'W_OFFICERS', 
          [process.env.DB_RATINGS]: 'RATE A',
          [process.env.DB_RATINGS_A]: 'RATE B',
          [process.env.DB_RATINGS_B]: 'RATE C',
          [process.env.DB_JUNIOR_TRAINEE]: 'TRAINEE'
        };

        // Get all available databases including the current one
        const dbConfig = require('../../config/db-config').getConfigSync();
        databasesToQuery = Object.entries(dbConfig.databases)
          .map(([className, dbName]) => ({ 
            name: dbToClassMap[dbName] || className,
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
          // Summary query - aggregated data with amount range filter
          const query = `
            SELECT 
              sr.ord as year,
              sr.mth as month,
              we.Bankcode,
              we.bankbranch,
              bnk.branchname as bank_branch_name,
              COUNT(DISTINCT we.empl_id) as employee_count,
              ROUND(SUM(mc.his_netmth), 2) as total_net,
              ROUND(MIN(mc.his_netmth), 2) as min_amount,
              ROUND(MAX(mc.his_netmth), 2) as max_amount,
              ROUND(AVG(mc.his_netmth), 2) as avg_amount
            FROM py_wkemployees we
            CROSS JOIN (SELECT ord, mth FROM py_stdrate WHERE type = 'BT05') sr
            INNER JOIN py_mastercum mc ON mc.his_empno = we.empl_id AND mc.his_type = sr.mth
            LEFT JOIN py_bank bnk ON bnk.bankcode = we.Bankcode AND bnk.branchcode = LPAD(we.bankbranch, 3, '0')
            WHERE mc.his_netmth BETWEEN ? AND ?
              ${year ? 'AND sr.ord = ?' : ''}
              ${month ? 'AND sr.mth = ?' : ''}
              ${bankName ? 'AND we.Bankcode = ?' : ''}
            GROUP BY sr.ord, sr.mth, we.Bankcode, we.bankbranch, bnk.branchname
            ORDER BY we.Bankcode, we.bankbranch
          `;
          
          const params = [min, max];
          if (year) params.push(year);
          if (month) params.push(month);
          if (bankName) params.push(bankName);
          
          const [rows] = await pool.query(query, params);
          
          // Add class identifier to each row
          allResults.push({
            payrollClass: name,
            database: db,
            amountRange: { min, max },
            data: rows
          });
          
        } else {
          // Detailed query - individual employee records with amount range filter
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
            LEFT JOIN py_bank bnk ON bnk.bankcode = we.Bankcode AND bnk.branchcode = LPAD(we.bankbranch, 3, '0')
            LEFT JOIN py_Title tt ON tt.Titlecode = we.Title
            WHERE mc.his_netmth BETWEEN ? AND ?
              ${year ? 'AND sr.ord = ?' : ''}
              ${month ? 'AND sr.mth = ?' : ''}
              ${bankName ? 'AND we.Bankcode = ?' : ''}
            ORDER BY we.Bankcode, we.bankbranch, we.empl_id
          `;
          
          const params = [min, max];
          if (year) params.push(year);
          if (month) params.push(month);
          if (bankName) params.push(bankName);
          
          const [rows] = await pool.query(query, params);
          
          // Add class identifier to each row
          allResults.push({
            payrollClass: name,
            database: db,
            amountRange: { min, max },
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
        amountRange: { min, max },
        summary: {
          total: databasesToQuery.length,
          successful: allResults.length,
          failed: failedClasses.length,
          totalRecords: allResults.reduce((sum, r) => sum + (r.data?.length || 0), 0)
        }
      };
      
      if (failedClasses.length > 0) {
        result.failedClasses = failedClasses;
        console.warn(`⚠️ ${failedClasses.length} class(es) failed:`, failedClasses);
      }
      
      return result;
    } else {
      return {
        amountRange: { min, max },
        data: allResults[0]?.data || []
      };
    }
  }

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
                            AND bnk.branchcode = LPAD(we.bankbranch, 3, '0')
      ORDER BY we.Bankcode, we.bankbranch
    `;
    const [rows] = await pool.query(query);
    return rows;
  }
}

module.exports = new RangePaymentServices();