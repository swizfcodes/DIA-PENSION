const pool = require('../../config/db');

class NSITFReportService {
  
  // ========================================================================
  // NSITF REPORT - WITH PFA GROUPING
  // ========================================================================
  async getNSITFReport(filters = {}) {
    const { year, month, pfaCode, summaryOnly } = filters;
    
    // Convert summaryOnly to boolean if it's a string
    const isSummary = summaryOnly === true || summaryOnly === '1' || summaryOnly === 'true';
    
    if (isSummary) {
      // Summary query - aggregated by PFA
      const query = `
        SELECT 
          sr.ord as year,
          sr.mth as month,
          he.pfacode as pfa_code,
          COALESCE(pfa.pfadesc, '') as pfa_name,
          COUNT(DISTINCT mc.his_empno) as employee_count,
          ROUND(SUM(mc.his_netmth), 2) as total_net_pay,
          ROUND(AVG(mc.his_netmth), 2) as avg_net_pay,
          ROUND(MIN(mc.his_netmth), 2) as min_net_pay,
          ROUND(MAX(mc.his_netmth), 2) as max_net_pay
        FROM py_wkemployees we
        CROSS JOIN (SELECT ord, mth FROM py_stdrate WHERE type = 'BT05') sr
        INNER JOIN py_mastercum mc ON mc.his_empno = we.empl_id AND mc.his_type = sr.mth
        INNER JOIN hr_employees he ON he.Empl_ID = we.empl_id
        LEFT JOIN py_pfa pfa ON pfa.pfacode = he.pfacode
        WHERE he.pfacode IS NOT NULL
          ${year ? 'AND sr.ord = ?' : ''}
          ${month ? 'AND sr.mth = ?' : ''}
          ${pfaCode ? 'AND he.pfacode = ?' : ''}
        GROUP BY sr.ord, sr.mth, he.pfacode, pfa.pfadesc
        ORDER BY pfa.pfadesc, total_net_pay DESC
      `;
      
      const params = [];
      if (year) params.push(year);
      if (month) params.push(month);
      if (pfaCode) params.push(pfaCode);
      
      const [rows] = await pool.query(query, params);
      return rows;
      
    } else {
      // Detailed query - process in batches for better performance
      const BATCH_SIZE = 1000;
      
      // First, get the total count
      const countQuery = `
        SELECT COUNT(DISTINCT mc.his_empno) as total
        FROM py_wkemployees we
        CROSS JOIN (SELECT ord, mth FROM py_stdrate WHERE type = 'BT05') sr
        INNER JOIN py_mastercum mc ON mc.his_empno = we.empl_id AND mc.his_type = sr.mth
        INNER JOIN hr_employees he ON he.Empl_ID = we.empl_id
        WHERE he.pfacode IS NOT NULL
          ${year ? 'AND sr.ord = ?' : ''}
          ${month ? 'AND sr.mth = ?' : ''}
          ${pfaCode ? 'AND he.pfacode = ?' : ''}
      `;
      
      const countParams = [];
      if (year) countParams.push(year);
      if (month) countParams.push(month);
      if (pfaCode) countParams.push(pfaCode);
      
      const [[{ total }]] = await pool.query(countQuery, countParams);
      
      // If no records, return empty array
      if (total === 0) return [];
      
      // Fetch data in batches
      const allResults = [];
      const totalBatches = Math.ceil(total / BATCH_SIZE);
      
      for (let batch = 0; batch < totalBatches; batch++) {
        const offset = batch * BATCH_SIZE;
        
        const query = `
          SELECT 
            sr.ord as year,
            sr.mth as month,
            we.empl_id as employee_id,
            CONCAT(TRIM(we.Surname), ' ', TRIM(IFNULL(we.OtherName, ''))) as full_name,
            st.Statename as state,
            we.Sex,
            we.Title as Title,
            tt.Description as title,
            DATE_FORMAT(we.dateempl, '%Y-%m-%d') as date_employed,
            we.NSITFcode as nsitf_code,
            we.gradetype as grade_type,
            SUBSTRING(we.gradelevel, 1, 2) as grade_level,
            ROUND(TIMESTAMPDIFF(YEAR, we.datepmted, NOW()), 0) as years_in_level,
            he.pfacode as pfa_code,
            COALESCE(pfa.pfadesc, '') as pfa_name,
            ROUND(mc.his_netmth, 2) as net_pay
          FROM py_wkemployees we
          CROSS JOIN (SELECT ord, mth FROM py_stdrate WHERE type = 'BT05') sr
          INNER JOIN py_mastercum mc ON mc.his_empno = we.empl_id AND mc.his_type = sr.mth
          INNER JOIN hr_employees he ON he.Empl_ID = we.empl_id
          LEFT JOIN py_pfa pfa ON pfa.pfacode = he.pfacode
          LEFT JOIN py_tblstates st ON st.Statecode = we.StateofOrigin
          LEFT JOIN py_Title tt ON tt.Titlecode = we.Title
          WHERE he.pfacode IS NOT NULL
            ${year ? 'AND sr.ord = ?' : ''}
            ${month ? 'AND sr.mth = ?' : ''}
            ${pfaCode ? 'AND he.pfacode = ?' : ''}
          ORDER BY 
            ${pfaCode ? 'mc.his_netmth DESC' : 'pfa.pfadesc, mc.his_netmth DESC'}
          LIMIT ? OFFSET ?
        `;
        
        const params = [];
        if (year) params.push(year);
        if (month) params.push(month);
        if (pfaCode) params.push(pfaCode);
        params.push(BATCH_SIZE, offset);
        
        const [batchRows] = await pool.query(query, params);
        allResults.push(...batchRows);
      }
      
      return allResults;
    }
  }

  // ========================================================================
  // GET AVAILABLE PFAs
  // ========================================================================
  async getAvailablePFAs() {
    const query = `
      SELECT DISTINCT
        pfa.pfacode as pfa_code,
        COALESCE(pfa.pfadesc, '') as pfa_name
      FROM py_pfa pfa
      LEFT JOIN hr_employees he ON he.pfacode = pfa.pfacode
      WHERE pfa.pfacode IS NOT NULL
      ORDER BY pfa_code
    `;
    
    const [rows] = await pool.query(query);
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
}

module.exports = new NSITFReportService();


