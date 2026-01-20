// adapters/mssql-adapter.js

class MSSQLAdapter {
  constructor(dbConfig, mssqlDriver) {
    this.dbConfig = dbConfig;
    this.mssql = mssqlDriver;
    this.pools = new Map(); // One pool per database
  }

  async initialize() {
    // Create a test connection to verify credentials
    const testConfig = {
      user: this.dbConfig.user,
      password: this.dbConfig.password,
      server: this.dbConfig.host,
      port: this.dbConfig.port || 1433,
      options: {
        encrypt: true,
        trustServerCertificate: true,
        enableArithAbort: true,
        connectTimeout: 60000,
        requestTimeout: 60000
      },
      pool: {
        max: 20,
        min: 0,
        idleTimeoutMillis: 900000
      }
    };

    try {
      const testPool = await new this.mssql.ConnectionPool(testConfig).connect();
      await testPool.request().query('SELECT 1');
      await testPool.close();
      console.log('✅ MSSQL connection verified');
    } catch (error) {
      throw new Error(`MSSQL initialization failed: ${error.message}`);
    }
  }

  async getPool(database) {
    if (!this.pools.has(database)) {
      const config = {
        user: this.dbConfig.user,
        password: this.dbConfig.password,
        server: this.dbConfig.host,
        port: this.dbConfig.port || 1433,
        database: database,
        options: {
          encrypt: true,
          trustServerCertificate: true,
          enableArithAbort: true,
          connectTimeout: 60000,
          requestTimeout: 60000
        },
        pool: {
          max: 20,
          min: 0,
          idleTimeoutMillis: 900000
        }
      };

      const pool = new this.mssql.ConnectionPool(config);
      await pool.connect();
      this.pools.set(database, pool);
      console.log(`📊 Created MSSQL pool for database: ${database}`);
    }
    return this.pools.get(database);
  }

  // Convert MySQL-style ? placeholders to MSSQL @p1, @p2, etc.
  convertPlaceholders(sql, params) {
    let paramIndex = 0;
    const convertedSql = sql.replace(/\?/g, () => {
      paramIndex++;
      return `@p${paramIndex}`;
    });
    return { sql: convertedSql, paramIndex };
  }

  // Convert MySQL syntax to MSSQL syntax
  convertMySQLToMSSQL(sql) {
    let converted = sql;

    console.log('🔍 Original SQL:', sql);

    // CRITICAL: SQL Server requires ORDER BY when using OFFSET...FETCH
    // Check if there's a LIMIT clause without an ORDER BY
    const hasOrderBy = /ORDER\s+BY/gi.test(converted);
    const hasLimit = /LIMIT\s+/gi.test(converted);
    
    console.log('📊 Has ORDER BY:', hasOrderBy, 'Has LIMIT:', hasLimit);

    // If there's a LIMIT but no ORDER BY, we need to add one
    if (hasLimit && !hasOrderBy) {
      // Find the best place to insert ORDER BY - it should come AFTER WHERE/GROUP BY/HAVING
      // but BEFORE LIMIT
      
      // Find LIMIT position
      const limitMatch = converted.match(/\s+LIMIT\s+/i);
      if (limitMatch) {
        const limitIndex = converted.search(/\s+LIMIT\s+/i);
        // Insert ORDER BY right before LIMIT
        converted = converted.slice(0, limitIndex) + 
                   ' ORDER BY (SELECT NULL) ' + 
                   converted.slice(limitIndex);
        console.log('✅ Added ORDER BY before LIMIT:', converted);
      }
    }

    // Convert LIMIT to OFFSET-FETCH
    // Handle all three MySQL LIMIT formats with numbers OR placeholders (?, @p1, etc)
    // 1. LIMIT offset, count (MySQL legacy syntax)
    // 2. LIMIT count OFFSET offset (SQL standard)
    // 3. LIMIT count (simple limit)
    
    // Match pattern for numbers or placeholders
    const numOrPlaceholder = '(\\d+|\\?|@p\\d+)';
    
    // Format 1: LIMIT offset, count
    const limitCommaRegex = new RegExp(`LIMIT\\s+${numOrPlaceholder}\\s*,\\s*${numOrPlaceholder}`, 'gi');
    if (limitCommaRegex.test(converted)) {
      converted = converted.replace(
        limitCommaRegex,
        'OFFSET $1 ROWS FETCH NEXT $2 ROWS ONLY'
      );
      console.log('✅ Converted LIMIT x,y format');
    }
    
    // Format 2: LIMIT count OFFSET offset
    // In: LIMIT 10 OFFSET 0
    // $1 = 10 (count), $2 = 0 (offset)
    // Out: OFFSET 0 ROWS FETCH NEXT 10 ROWS ONLY
    const limitOffsetRegex = new RegExp(`LIMIT\\s+${numOrPlaceholder}\\s+OFFSET\\s+${numOrPlaceholder}`, 'gi');
    if (limitOffsetRegex.test(converted)) {
      converted = converted.replace(
        limitOffsetRegex,
        'OFFSET $2 ROWS FETCH NEXT $1 ROWS ONLY'
      );
      console.log('✅ Converted LIMIT x OFFSET y format (count=$1, offset=$2)');
    }
    
    // Format 3: LIMIT count (must be last to avoid matching LIMIT x OFFSET)
    const simpleLimitRegex = new RegExp(`LIMIT\\s+${numOrPlaceholder}(?!\\s+OFFSET)`, 'gi');
    if (simpleLimitRegex.test(converted)) {
      converted = converted.replace(
        simpleLimitRegex,
        'OFFSET 0 ROWS FETCH NEXT $1 ROWS ONLY'
      );
      console.log('✅ Converted simple LIMIT format');
    }

    console.log('🎯 After LIMIT conversion:', converted);

    // Convert backticks to square brackets
    converted = converted.replace(/`([^`]+)`/g, '[$1]');

    // Convert IF NOT EXISTS for CREATE TABLE (MSSQL doesn't support it)
    converted = converted.replace(
      /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS/gi,
      'CREATE TABLE'
    );

    // Convert NOW() to GETDATE()
    converted = converted.replace(/\bNOW\(\)/gi, 'GETDATE()');

    // Convert IFNULL to ISNULL (SQL Server equivalent)
    // IFNULL(expr, alt) -> ISNULL(expr, alt)
    converted = converted.replace(/\bIFNULL\s*\(/gi, 'ISNULL(');

    // Convert LPAD to RIGHT + REPLICATE
    // LPAD(str, len, padstr) -> RIGHT(REPLICATE(padstr, len) + str, len)
    converted = converted.replace(
      /\bLPAD\s*\(\s*([^,]+)\s*,\s*([^,]+)\s*,\s*([^)]+)\s*\)/gi,
      (match, str, len, padstr) => {
        return `RIGHT(REPLICATE(${padstr.trim()}, ${len.trim()}) + CAST(${str.trim()} AS NVARCHAR(MAX)), ${len.trim()})`;
      }
    );

    // Convert RPAD to LEFT + REPLICATE
    // RPAD(str, len, padstr) -> LEFT(str + REPLICATE(padstr, len), len)
    converted = converted.replace(
      /\bRPAD\s*\(\s*([^,]+)\s*,\s*([^,]+)\s*,\s*([^)]+)\s*\)/gi,
      (match, str, len, padstr) => {
        return `LEFT(CAST(${str.trim()} AS NVARCHAR(MAX)) + REPLICATE(${padstr.trim()}, ${len.trim()}), ${len.trim()})`;
      }
    );

    // Convert TRIM - MySQL has different syntax than SQL Server
    // Be careful not to break TRIM when it appears as part of CONCAT or other functions
    // Only convert standalone TRIM() calls, not TRIM inside other function arguments
    // MySQL: TRIM(str)
    // SQL Server: LTRIM(RTRIM(str))
    // Note: Skip conversion if TRIM appears to be part of a larger expression being converted
    converted = converted.replace(/\bTRIM\s*\(\s*([^)]+)\s*\)/gi, (match, content) => {
      // Only do simple TRIM conversion - don't try to parse complex nested calls
      // The CONCAT handler will deal with TRIM inside CONCAT
      return `LTRIM(RTRIM(${content.trim()}))`;
    });

    // Convert TIMESTAMPDIFF to DATEDIFF
    // MySQL: TIMESTAMPDIFF(YEAR, start, end) 
    // MSSQL: DATEDIFF(YEAR, start, end)
    converted = converted.replace(
      /\bTIMESTAMPDIFF\s*\(\s*(\w+)\s*,\s*([^,]+)\s*,\s*([^)]+)\s*\)/gi,
      (match, unit, start, end) => {
        return `DATEDIFF(${unit.trim()}, ${start.trim()}, ${end.trim()})`;
      }
    );

    // Convert DATE_FORMAT to FORMAT or CONVERT
    // MySQL: DATE_FORMAT(date, '%Y-%m-%d')
    // MSSQL: FORMAT(date, 'yyyy-MM-dd') or CONVERT(VARCHAR, date, 23)
    converted = converted.replace(
      /\bDATE_FORMAT\s*\(\s*([^,]+)\s*,\s*'%Y-%m-%d'\s*\)/gi,
      (match, date) => {
        return `CONVERT(VARCHAR(10), ${date.trim()}, 23)`;
      }
    );
    converted = converted.replace(
      /\bDATE_FORMAT\s*\(\s*([^,]+)\s*,\s*'([^']+)'\s*\)/gi,
      (match, date, format) => {
        // General conversion - attempt to convert MySQL format to SQL Server
        let sqlFormat = format
          .replace(/%Y/g, 'yyyy')
          .replace(/%m/g, 'MM')
          .replace(/%d/g, 'dd')
          .replace(/%H/g, 'HH')
          .replace(/%i/g, 'mm')
          .replace(/%s/g, 'ss');
        return `FORMAT(${date.trim()}, '${sqlFormat}')`;
      }
    );

    // Convert SUBSTRING to work with both MySQL and MSSQL syntax
    // Both support SUBSTRING(str, start, length) so this is mostly compatible
    // But ensure we handle any edge cases

    // Convert CONCAT() with multiple args to + operator with proper casting
    converted = converted.replace(
      /CONCAT\s*\(([^)]+)\)/gi,
      (match, args) => {
        // Split by comma but respect nested parentheses and function calls
        const parts = [];
        let currentPart = '';
        let parenDepth = 0;
        
        for (let i = 0; i < args.length; i++) {
          const char = args[i];
          if (char === '(') parenDepth++;
          if (char === ')') parenDepth--;
          
          if (char === ',' && parenDepth === 0) {
            parts.push(currentPart.trim());
            currentPart = '';
          } else {
            currentPart += char;
          }
        }
        if (currentPart) parts.push(currentPart.trim());
        
        // Cast each part to NVARCHAR and join with +
        // But don't double-wrap things that are already function calls
        return parts.map(p => {
          // If it's already a function call or literal, just cast it
          if (p.match(/^\w+\s*\(/i) || p.match(/^'/)) {
            return `CAST(${p} AS NVARCHAR(MAX))`;
          }
          return `CAST(${p} AS NVARCHAR(MAX))`;
        }).join(' + ');
      }
    );

    console.log('🎯 Final SQL:', converted);

    // Fix GROUP BY aliases - SQL Server doesn't allow aliases in GROUP BY
    // We need to replace aliases with their actual expressions
    if (/GROUP\s+BY/gi.test(converted)) {
      // Extract column definitions to build alias map
      const aliasMap = new Map();
      const selectMatch = converted.match(/SELECT\s+(.*?)\s+FROM/is);
      if (selectMatch) {
        const selectClause = selectMatch[1];
        // Find all "expression AS alias" patterns
        const aliasPattern = /(.+?)\s+(?:AS\s+)?([a-zA-Z_][a-zA-Z0-9_]*)\s*(?:,|$)/gi;
        let match;
        while ((match = aliasPattern.exec(selectClause)) !== null) {
          const expression = match[1].trim();
          const alias = match[2].trim();
          // Only store if it's actually an alias (has AS or is CASE/function)
          if (match[0].includes(' AS ') || expression.match(/^CASE\s+/i) || expression.includes('(')) {
            aliasMap.set(alias.toLowerCase(), expression);
          }
        }
      }

      // Replace aliases in GROUP BY clause
      const groupByMatch = converted.match(/(GROUP\s+BY\s+)([^ORDER|HAVING|LIMIT|$]+)/is);
      if (groupByMatch && aliasMap.size > 0) {
        const groupByClause = groupByMatch[2];
        let newGroupBy = groupByClause;
        
        // Split by comma and replace each alias
        const groupByItems = groupByClause.split(',').map(item => item.trim());
        const replacedItems = groupByItems.map(item => {
          const itemLower = item.toLowerCase();
          if (aliasMap.has(itemLower)) {
            return aliasMap.get(itemLower);
          }
          return item;
        });
        
        newGroupBy = replacedItems.join(', ');
        converted = converted.replace(groupByMatch[0], groupByMatch[1] + newGroupBy);
      }
    }

    // Fix subquery aliases - SQL Server requires AS keyword
    // Pattern: (SELECT ...) identifier -> (SELECT ...) AS identifier
    converted = converted.replace(
      /\)\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+(INNER|LEFT|RIGHT|CROSS|WHERE|ORDER|GROUP|LIMIT|OFFSET)/gi,
      (match, alias, nextKeyword) => {
        return `) AS ${alias} ${nextKeyword}`;
      }
    );

    // Also handle end of query: ) alias; or ) alias\n
    converted = converted.replace(
      /\)\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*($|;|\n)/gm,
      (match, alias, ending) => {
        return `) AS ${alias}${ending}`;
      }
    );

    return converted;
  }

  async query(database, sql, params = []) {
    console.log('🔵 QUERY called with database:', database);
    console.log('🔵 Original SQL before conversion:', sql);
    console.log('🔵 Params:', params);

    const pool = await this.getPool(database);
    const request = pool.request();

    // CRITICAL: Check if we have LIMIT ? OFFSET ? pattern
    // If so, we need to reorder params because MSSQL needs them as OFFSET, FETCH
    // MySQL: LIMIT count OFFSET offset (params: [count, offset])
    // MSSQL: OFFSET offset FETCH NEXT count (needs: [offset, count])
    const limitOffsetPlaceholderPattern = /LIMIT\s+\?\s+OFFSET\s+\?/i;
    let reorderedParams = [...params];
    
    if (limitOffsetPlaceholderPattern.test(sql)) {
      // Find where the LIMIT params are in the params array
      // Count how many ? appear before LIMIT
      const beforeLimit = sql.substring(0, sql.search(limitOffsetPlaceholderPattern));
      const placeholdersBeforeLimit = (beforeLimit.match(/\?/g) || []).length;
      
      // The LIMIT ? is at index: placeholdersBeforeLimit
      // The OFFSET ? is at index: placeholdersBeforeLimit + 1
      const limitIndex = placeholdersBeforeLimit;
      const offsetIndex = placeholdersBeforeLimit + 1;
      
      if (offsetIndex < params.length) {
        // Swap them: LIMIT and OFFSET params need to be swapped for MSSQL
        console.log(`🔄 Swapping params: [${limitIndex}]=${params[limitIndex]} and [${offsetIndex}]=${params[offsetIndex]}`);
        const temp = reorderedParams[limitIndex];
        reorderedParams[limitIndex] = reorderedParams[offsetIndex];  // Put offset first
        reorderedParams[offsetIndex] = temp;  // Put limit second
        console.log('🔄 Reordered params:', reorderedParams);
      }
    }

    // Convert MySQL syntax to MSSQL
    let convertedSql = this.convertMySQLToMSSQL(sql);
    
    console.log('🔵 After convertMySQLToMSSQL:', convertedSql);
    
    // Convert placeholders and bind parameters
    const placeholderResult = this.convertPlaceholders(convertedSql, reorderedParams);
    convertedSql = placeholderResult.sql;
    
    console.log('🔵 After convertPlaceholders:', convertedSql);
    
    reorderedParams.forEach((param, index) => {
      request.input(`p${index + 1}`, param);
    });

    console.log('🔵 Final SQL being executed:', convertedSql);

    const result = await request.query(convertedSql);
    
    // Return in MySQL format: [rows, fields]
    const fields = result.recordset && result.recordset.columns 
      ? Object.keys(result.recordset.columns).map(name => ({ name }))
      : [];
    
    return [result.recordset || [], fields];
  }

  async execute(database, sql, params = []) {
    return await this.query(database, sql, params);
  }

  async getConnection(database) {
    const pool = await this.getPool(database);
    const transaction = new this.mssql.Transaction(pool);
    
    return {
      _pool: pool,
      _transaction: transaction,
      _isTransaction: false,
      database: database
    };
  }

  async queryWithConnection(connection, sql, params = []) {
    const request = connection._isTransaction 
      ? new this.mssql.Request(connection._transaction)
      : connection._pool.request();

    // Convert MySQL syntax to MSSQL
    let convertedSql = this.convertMySQLToMSSQL(sql);
    
    // Convert placeholders
    convertedSql = this.convertPlaceholders(convertedSql, params).sql;
    
    params.forEach((param, index) => {
      request.input(`p${index + 1}`, param);
    });

    const result = await request.query(convertedSql);
    
    const fields = result.recordset && result.recordset.columns 
      ? Object.keys(result.recordset.columns).map(name => ({ name }))
      : [];
    
    return [result.recordset || [], fields];
  }

  async executeWithConnection(connection, sql, params = []) {
    return await this.queryWithConnection(connection, sql, params);
  }

  async beginTransaction(connection) {
    await connection._transaction.begin();
    connection._isTransaction = true;
  }

  async commitTransaction(connection) {
    if (connection._isTransaction) {
      await connection._transaction.commit();
      connection._isTransaction = false;
    }
  }

  async rollbackTransaction(connection) {
    if (connection._isTransaction) {
      await connection._transaction.rollback();
      connection._isTransaction = false;
    }
  }

  releaseConnection(connection) {
    // MSSQL uses connection pooling automatically
    // No explicit release needed
    if (connection._isTransaction) {
      connection._transaction.rollback().catch(() => {});
      connection._isTransaction = false;
    }
  }

  async rawQuery(sql, params = []) {
    // Use the first available pool for raw queries
    const database = Object.values(this.dbConfig.databases)[0];
    return await this.query(database, sql, params);
  }

  async testDatabase(dbName) {
    const pool = await this.getPool(dbName);
    await pool.request().query('SELECT 1');
  }

  async healthCheck() {
    const database = Object.values(this.dbConfig.databases)[0];
    const pool = await this.getPool(database);
    await pool.request().query('SELECT 1 as health_check');
  }

  getStats() {
    let totalConnections = 0;
    let activeConnections = 0;

    this.pools.forEach(pool => {
      if (pool.connected) {
        totalConnections += pool.size;
        activeConnections += pool.size - pool.available;
      }
    });

    return {
      totalPools: this.pools.size,
      totalConnections,
      activeConnections,
      availableConnections: totalConnections - activeConnections
    };
  }

  async close() {
    for (const [database, pool] of this.pools.entries()) {
      try {
        await pool.close();
        console.log(`✅ Closed MSSQL pool for: ${database}`);
      } catch (error) {
        console.error(`❌ Error closing pool for ${database}:`, error.message);
      }
    }
    this.pools.clear();
  }
}

module.exports = MSSQLAdapter;


