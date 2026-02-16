// services/helpers/seamlessHistoricalWrapper.js
const pool = require('../../config/db');
const periodValidatorService = require('./periodValidatorService');

class SeamlessHistoricalWrapper {
  constructor() {
    this.isActive = false;
    this.originalQuery = null;
    this.currentMonth = null;
    this.currentYear = null;
    this.queryCount = 0;
    this.transformCount = 0;
  }

  /**
   * Initialize wrapper - Call this ONCE in your app startup
   */
  async initialize() {
    // Store original query method
    this.originalQuery = pool.query.bind(pool);
    
    // Replace with interceptor
    pool.query = async (sql, params, sessionId) => {
      return await this.interceptQuery(sql, params, sessionId);
    };
    
    console.log('✅ [WRAPPER] Seamless Historical Wrapper initialized');
  }

  /**
   * Main query interceptor
   */
  async interceptQuery(sql, params, sessionId) {
    this.queryCount++;

    // Skip if wrapper not active
    if (!this.isActive) {
      return await this.originalQuery(sql, params, sessionId);
    }

    console.log(`\n   🔍 [QUERY ${this.queryCount}] Intercepted`);
    console.log(`   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`   FULL SQL:\n${this.formatSQL(sql)}`);
    console.log(`   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`   Params:`, params);

    // Check if transformation needed FIRST
    const needsTransform = this.needsTransformation(sql);
    console.log(`   Contains py_masterpayded: ${/py_masterpayded/i.test(sql)}`);
    console.log(`   Contains py_mastercum: ${/py_mastercum/i.test(sql)}`);
    console.log(`   Contains py_wkemployees: ${/py_wkemployees/i.test(sql)}`);
    console.log(`   Contains BT05 subquery: ${/FROM\s+py_stdrate\s+WHERE\s+type\s*=\s*'BT05'/i.test(sql)}`);
    console.log(`   Needs Transform: ${needsTransform}`);

    // Skip system queries (only if it doesn't need transformation)
    if (this.isSystemQuery(sql)) {
      console.log(`   ⏩ System query detected - skipping transformation`);
      return await this.originalQuery(sql, params);
    }
    
    if (!needsTransform) {
      console.log(`   ⏩ No transformation needed - passing through`);
      return await this.originalQuery(sql, params);
    }

    // Transform query
    this.transformCount++;
    console.log(`\n   🔄 [QUERY ${this.queryCount}] TRANSFORMING...`);
    console.log(`   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`   ORIGINAL:\n${this.formatSQL(sql)}`);
    
    const transformedSql = this.transformQuery(sql);
    
    console.log(`\n   TRANSFORMED:\n${this.formatSQL(transformedSql)}`);
    console.log(`   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`   Params:`, params);
    
    return await this.originalQuery(transformedSql, params, sessionId);
  }

  /**
   * Check if query needs transformation
   */
  needsTransformation(sql) {
    const hasMasterPayded = /py_masterpayded/i.test(sql);
    const hasMasterCum = /py_mastercum/i.test(sql);
    const hasWkEmployees = /py_wkemployees/i.test(sql);
    const hasBT05 = /FROM\s+py_stdrate\s+WHERE\s+type\s*=\s*'BT05'/i.test(sql);
    const hasTempSumm = /py_tempsumm/i.test(sql);
    return hasMasterPayded || hasMasterCum || hasWkEmployees || hasBT05 || hasTempSumm;
  }

  /**
   * Check if this is a system query that shouldn't be transformed
   */
  isSystemQuery(sql) {
    // First check if it needs transformation - if yes, it's NOT a system query
    if (this.needsTransformation(sql)) {
      return false;
    }
    
    // Only check system patterns if it doesn't need transformation
    const systemPatterns = [
      /CREATE\s+VIEW/i,
      /DROP\s+VIEW/i,
      /py_stdrate/i,
      /py_elementType/i,
      /SHOW\s+/i,
      /DESCRIBE\s+/i,
      /information_schema/i
    ];
    
    return systemPatterns.some(pattern => pattern.test(sql));
  }

  /**
   * Transform query to use historical data
   */
  transformQuery(sql) {
    if (!this.currentMonth || !this.currentYear) {
      console.log('   ⚠️  No period set - returning original query');
      return sql;
    }

    let transformed = sql;
    let changesMade = [];

    // Replace BT05 subquery with literal values for historical queries
    if (/FROM\s+py_stdrate\s+WHERE\s+type\s*=\s*'BT05'/i.test(sql)) {
      transformed = this.replaceBT05Subquery(transformed);
      changesMade.push('BT05 subquery → literal period values');
    }

    // Replace py_wkemployees with hr_employees for historical data
    if (/py_wkemployees/i.test(sql)) {
      transformed = this.replaceWkEmployees(transformed);
      changesMade.push('py_wkemployees → hr_employees');
    }

    // Replace py_tempsumm with historical aggregation
    if (/py_tempsumm/i.test(sql)) {
      transformed = this.replaceTempSumm(transformed);
      changesMade.push('py_tempsumm → py_payhistory aggregation');
    }

    // Replace py_masterpayded
    if (/py_masterpayded/i.test(sql)) {
      transformed = this.replaceMasterPayded(transformed);
      changesMade.push('py_masterpayded → py_payhistory subquery');
    }

    // Replace py_mastercum
    if (/py_mastercum/i.test(sql)) {
      transformed = this.replaceMasterCum(transformed);
      changesMade.push('py_mastercum → aggregated py_payhistory subquery');
    }

    if (changesMade.length > 0) {
      console.log(`   Changes: ${changesMade.join(', ')}`);
    }

    return transformed;
  }

  /**
   * Replace py_tempsumm with historical aggregation from py_payhistory
   */
  replaceTempSumm(sql) {
    const month = this.currentMonth;
    const year = this.currentYear;

    console.log(`   🔧 Replacing py_tempsumm with py_payhistory aggregation (month=${month}, year=${year})`);

    const pattern = /(\w+\.)?py_tempsumm(?:\s+(?:AS\s+)?(?!GROUP|ORDER|WHERE|LIMIT|HAVING|UNION|LEFT|RIGHT|INNER|JOIN)(\w+))?/gi;
    
    return sql.replace(pattern, (match, dbPrefix, alias) => {
      const tableAlias = alias || 'ts';
      
      console.log(`      Table: py_tempsumm → py_payhistory (alias: ${tableAlias})`);
      
      // Include ALL amounts (positive, negative, and zero) to match py_tempsumm behavior
      return `(SELECT 
        ${year} as cyear,
        ${month} as pmonth,
        his_type as type1,
        his_type as desc1,
        CASE 
          WHEN LEFT(his_type, 2) IN ('BP', 'BT', 'PT', 'FP') THEN CAST(amtthismth${month} AS DECIMAL(15,2))
          ELSE 0.00
        END as amt1,
        CASE 
          WHEN LEFT(his_type, 2) IN ('PR', 'PL') THEN CAST(amtthismth${month} AS DECIMAL(15,2))
          ELSE 0.00
        END as amt2,
        CASE 
          WHEN his_type = 'PY02' THEN CAST(amtthismth${month} AS DECIMAL(15,2))
          ELSE 0.00
        END as tax,
        CASE 
          WHEN his_type = 'PY01' THEN CAST(amtthismth${month} AS DECIMAL(15,2))
          ELSE 0.00
        END as net,
        CASE 
          WHEN his_type = 'PY03' THEN CAST(amtthismth${month} AS DECIMAL(15,2))
          ELSE 0.00
        END as roundup,
        '' as ledger1
      FROM py_payhistory
      WHERE his_year = ${year}) ${tableAlias}`;
      // Removed: AND amtthismth${month} > 0
    });
  }

  /**
   * Replace BT05 subquery with literal period values for historical queries
   */
  replaceBT05Subquery(sql) {
    const month = this.currentMonth;
    const year = this.currentYear;

    console.log(`   🔧 Replacing BT05 subquery with literal values (year=${year}, month=${month})`);

    // Match the BT05 subquery pattern
    const pattern = /\(\s*SELECT\s+ord\s*,\s*mth\s+FROM\s+py_stdrate\s+WHERE\s+type\s*=\s*'BT05'\s*\)(\s+(?:AS\s+)?(\w+))?/gi;
    
    return sql.replace(pattern, (match, aliasMatch, alias) => {
      const tableAlias = alias || 'sr';
      
      console.log(`      BT05 subquery → (SELECT ${year} as ord, ${month} as mth) (alias: ${tableAlias})`);
      
      return `(SELECT ${year} as ord, ${month} as mth) ${tableAlias}`;
    });
  }

  /**
   * Replace py_wkemployees with hr_employees
   */
  replaceWkEmployees(sql) {
    console.log(`   🔧 Replacing py_wkemployees with hr_employees for historical data`);

    // Match py_wkemployees with optional database prefix and alias
    // Negative lookahead ensures we don't capture WHERE, GROUP, ORDER, etc. as aliases
    const pattern = /(\w+\.)?py_wkemployees(?:\s+(?:AS\s+)?(?!WHERE|GROUP|ORDER|LIMIT|HAVING|UNION|JOIN|LEFT|RIGHT|INNER|OUTER|ON|AND|OR|SET|VALUES)(\w+))?/gi;
    
    return sql.replace(pattern, (match, dbPrefix, alias) => {
      const tableAlias = alias || 'we';
      
      console.log(`      Table: py_wkemployees → hr_employees (alias: ${tableAlias})`);
      
      // Return hr_employees with the same alias
      return `hr_employees ${tableAlias}`;
    });
  }

  /**
   * Replace py_masterpayded with historical subquery
   */
  replaceMasterPayded(sql) {
    const month = this.currentMonth;
    const year = this.currentYear;

    console.log(`   🔧 Replacing py_masterpayded with history (month=${month}, year=${year})`);

    // Match py_masterpayded with optional alias, but exclude SQL keywords
    const pattern = /(\w+\.)?py_masterpayded(?:\s+(?:AS\s+)?(?!WHERE|GROUP|ORDER|LIMIT|HAVING|UNION|JOIN|LEFT|RIGHT|INNER|OUTER|ON|AND|OR|SET|VALUES)(\w+))?/gi;
    
    return sql.replace(pattern, (match, dbPrefix, alias) => {
      const tableAlias = alias || 'mpd_hist';
      
      console.log(`      Table: py_masterpayded → subquery (alias: ${tableAlias})`);
      
      return `(SELECT 
        his_empno,
        his_type,
        amtthismth${month} as amtthismth,
        totamtpayable${month} as totamtpayable,
        totpaidtodate${month} as totpaidtodate,
        Initialloan${month} as initialloan,
        payindic${month} as payindic,
        nmth${month} as nmth,
        loan${month} as loan,
        bankcode${month} as bankcode,
        bankbranch${month} as bankbranch,
        bankacnumber${month} as bankacnumber,
        createdby,
        datecreated,
        modifiedby,
        datemodified
      FROM py_payhistory
      WHERE his_year = ${year}
        AND amtthismth${month} > 0) ${tableAlias}`;
    });
  }


  /**
   * Replace py_mastercum with historical subquery
   */
  replaceMasterCum(sql) {
    const month = this.currentMonth;
    const year = this.currentYear;

    console.log(`   🔧 Replacing py_mastercum with aggregated history (month=${month}, year=${year})`);

    // Match py_mastercum with optional alias, but exclude SQL keywords
    // Negative lookahead ensures we don't capture WHERE, GROUP, ORDER, etc. as aliases
    const pattern = /(\w+\.)?py_mastercum(?:\s+(?:AS\s+)?(?!WHERE|GROUP|ORDER|LIMIT|HAVING|UNION|JOIN|LEFT|RIGHT|INNER|OUTER|ON|AND|OR|SET|VALUES)(\w+))?/gi;
    
    return sql.replace(pattern, (match, dbPrefix, alias) => {
      const tableAlias = alias || 'mc';
      
      console.log(`      Table: py_mastercum → aggregated subquery (alias: ${tableAlias})`);
      
      // Build column list for all months up to current month (for todate calculations)
      const monthColumns = [];
      for (let m = 1; m <= month; m++) {
        monthColumns.push(`amtthismth${m}`);
      }
      const sumColumns = monthColumns.join(' + ');
      
      return `(SELECT 
        his_empno,
        ${month} as his_type,
        -- This month values
        (SELECT COALESCE(SUM(amtthismth${month}), 0)
        FROM py_payhistory ph1
        WHERE ph1.his_empno = ph.his_empno
          AND ph1.his_year = ${year}
          AND LEFT(ph1.his_type, 2) IN ('BP', 'BT')
          AND ph1.amtthismth${month} > 0) as his_grossmth,
        (SELECT COALESCE(amtthismth${month}, 0)
        FROM py_payhistory ph2
        WHERE ph2.his_empno = ph.his_empno
          AND ph2.his_year = ${year}
          AND ph2.his_type = 'PY02'
        LIMIT 1) as his_taxmth,
        (SELECT COALESCE(amtthismth${month}, 0)
        FROM py_payhistory ph3
        WHERE ph3.his_empno = ph.his_empno
          AND ph3.his_year = ${year}
          AND ph3.his_type = 'PY01'
        LIMIT 1) as his_netmth,
        (SELECT COALESCE(amtthismth${month}, 0)
        FROM py_payhistory ph4
        WHERE ph4.his_empno = ph.his_empno
          AND ph4.his_year = ${year}
          AND ph4.his_type = 'PR309'
        LIMIT 1) as his_nhfmth,
        (SELECT COALESCE(SUM(amtthismth${month}), 0)
        FROM py_payhistory ph5
        WHERE ph5.his_empno = ph.his_empno
          AND ph5.his_year = ${year}
          AND ph5.his_type LIKE 'PR3%'
          AND ph5.his_type != 'PR309') as his_pensionmth,
        -- Year-to-date values (sum of all months 1 to current month)
        (SELECT COALESCE(SUM(${sumColumns}), 0)
        FROM py_payhistory ph6
        WHERE ph6.his_empno = ph.his_empno
          AND ph6.his_year = ${year}
          AND LEFT(ph6.his_type, 2) IN ('BP', 'BT')) as his_grosstodate,
        (SELECT COALESCE(SUM(${sumColumns}), 0)
        FROM py_payhistory ph7
        WHERE ph7.his_empno = ph.his_empno
          AND ph7.his_year = ${year}
          AND ph7.his_type = 'PY02') as his_taxtodate,
        (SELECT COALESCE(SUM(${sumColumns}), 0)
        FROM py_payhistory ph8
        WHERE ph8.his_empno = ph.his_empno
          AND ph8.his_year = ${year}
          AND ph8.his_type LIKE 'FP%') as his_taxfreepaytodate,
        (SELECT COALESCE(SUM(${sumColumns}), 0)
        FROM py_payhistory ph9
        WHERE ph9.his_empno = ph.his_empno
          AND ph9.his_year = ${year}
          AND ph9.his_type = 'PT05') as his_taxabletodate,
        MAX(ph.datecreated) as datecreated,
        MAX(ph.datemodified) as datemodified
      FROM py_payhistory ph
      WHERE ph.his_year = ${year}
        AND ph.amtthismth${month} > 0
      GROUP BY ph.his_empno) ${tableAlias}`;
    });
  }

  /**
   * Activate wrapper for a specific period
   */
  async activate(year, month, database = null) {
    console.log('\n🎯 [WRAPPER] Activating...');
    console.log(`   Period: ${month}/${year}`);
    
    const validation = await periodValidatorService.validateAndGetDataSource(
      year, 
      month,
      database
    );
    
    if (!validation.isValid) {
      console.log('   ❌ Validation failed');
      throw new Error(validation.errorMessage);
    }

    if (validation.dataSource === 'current') {
      // Current period - no transformation needed
      this.isActive = false;
      this.currentMonth = null;
      this.currentYear = null;
      console.log(`   📍 CURRENT period - wrapper NOT active`);
      console.log(`   Queries will use py_masterpayded/py_mastercum directly\n`);
      return false;
    }

    // Historical period - activate transformation
    this.currentMonth = month;
    this.currentYear = year;
    this.isActive = true;
    this.queryCount = 0;
    this.transformCount = 0;
    
    console.log(`   📜 HISTORICAL period - wrapper ACTIVE`);
    console.log(`   All queries will be transformed to use py_payhistory`);
    console.log(`   Columns: amtthismth${month}, etc.\n`);
    return true;
  }

  /**
   * Deactivate wrapper
   */
  deactivate() {
    if (this.isActive) {
      console.log('\n✅ [WRAPPER] Deactivating...');
      console.log(`   Stats: ${this.queryCount} queries processed, ${this.transformCount} transformed`);
    }
    
    this.isActive = false;
    this.currentMonth = null;
    this.currentYear = null;
    this.queryCount = 0;
    this.transformCount = 0;
  }

  /**
   * Format SQL for better readability in logs
   */
  formatSQL(sql) {
    return sql
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/SELECT/gi, '\n  SELECT')
      .replace(/FROM/gi, '\n  FROM')
      .replace(/WHERE/gi, '\n  WHERE')
      .replace(/JOIN/gi, '\n  JOIN')
      .replace(/LEFT JOIN/gi, '\n  LEFT JOIN')
      .replace(/GROUP BY/gi, '\n  GROUP BY')
      .replace(/ORDER BY/gi, '\n  ORDER BY')
      .replace(/LIMIT/gi, '\n  LIMIT');
  }

  /**
   * Truncate SQL for logging
   */
  truncateSQL(sql, maxLength = 150) {
    const cleaned = sql.replace(/\s+/g, ' ').trim();
    if (cleaned.length <= maxLength) return cleaned;
    return cleaned.substring(0, maxLength) + '...';
  }

  /**
   * Get wrapper status
   */
  getStatus() {
    return {
      isActive: this.isActive,
      currentMonth: this.currentMonth,
      currentYear: this.currentYear,
      queryCount: this.queryCount,
      transformCount: this.transformCount
    };
  }
}

module.exports = new SeamlessHistoricalWrapper();