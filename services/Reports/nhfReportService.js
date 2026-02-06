const pool = require('../../config/db');

class NHFReportService {
  
  // ========================================================================
  // NHF REPORT - NO GROUPING
  // ========================================================================
  async getNHFReport(filters = {}) {
    const { year, month, summaryOnly } = filters;
    
    // Convert summaryOnly to boolean if it's a string
    const isSummary = summaryOnly === true || summaryOnly === '1' || summaryOnly === 'true';
    
    if (isSummary) {
      // Summary query - overall aggregation
      const query = `
        SELECT 
          sr.ord as year,
          sr.mth as month,
          COUNT(DISTINCT mp.his_empno) as employee_count,
          ROUND(SUM(mc.his_netmth), 2) as total_net_pay,
          ROUND(AVG(mc.his_netmth), 2) as avg_net_pay,
          ROUND(SUM(mp.amtthismth), 2) as total_nhf_contribution,
          ROUND(AVG(mp.amtthismth), 2) as avg_nhf_contribution,
          ROUND(SUM(mp.totpaidtodate), 2) as total_nhf_paid_todate,
          ROUND(MIN(mp.amtthismth), 2) as min_nhf_contribution,
          ROUND(MAX(mp.amtthismth), 2) as max_nhf_contribution
        FROM py_wkemployees we
        CROSS JOIN (SELECT ord, mth FROM py_stdrate WHERE type = 'BT05') sr
        INNER JOIN py_mastercum mc ON mc.his_empno = we.empl_id AND mc.his_type = sr.mth
        INNER JOIN py_masterpayded mp ON mp.his_empno = we.empl_id 
          AND mp.his_type = 'PR306'
        WHERE mp.amtthismth > 0
          ${year ? 'AND sr.ord = ?' : ''}
          ${month ? 'AND sr.mth = ?' : ''}
        GROUP BY sr.ord, sr.mth
      `;
      
      const params = [];
      if (year) params.push(year);
      if (month) params.push(month);
      
      const [rows] = await pool.query(query, params);
      return rows;
      
    } else {
      // Detailed query - process in batches for better performance
      const BATCH_SIZE = 1000;
      
      // First, get the total count
      const countQuery = `
        SELECT COUNT(DISTINCT mp.his_empno) as total
        FROM py_wkemployees we
        CROSS JOIN (SELECT ord, mth FROM py_stdrate WHERE type = 'BT05') sr
        INNER JOIN py_mastercum mc ON mc.his_empno = we.empl_id AND mc.his_type = sr.mth
        INNER JOIN py_masterpayded mp ON mp.his_empno = we.empl_id 
          AND mp.his_type = 'PR306'
        WHERE mp.amtthismth > 0
          ${year ? 'AND sr.ord = ?' : ''}
          ${month ? 'AND sr.mth = ?' : ''}
      `;
      
      const countParams = [];
      if (year) countParams.push(year);
      if (month) countParams.push(month);
      
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
            tt.Description as title,
            we.Title as Title,
            DATE_FORMAT(we.dateempl, '%Y-%m-%d') as date_employed,
            we.NSITFcode as nsitf_code,
            we.gradetype as grade_type,
            SUBSTRING(we.gradelevel, 1, 2) as grade_level,
            ROUND(TIMESTAMPDIFF(YEAR, we.datepmted, NOW()), 0) as years_in_level,
            we.Location as location_code,
            COALESCE(cc.unitdesc, '') as location_name,
            ROUND(mc.his_netmth, 2) as net_pay,
            ROUND(mp.amtthismth, 2) as nhf_contribution,
            ROUND(mp.totpaidtodate, 2) as nhf_paid_todate,
            ROUND((mp.amtthismth / NULLIF(mc.his_netmth, 0)) * 100, 2) as nhf_percentage,
            we.Bankcode,
            we.BankACNumber
          FROM py_wkemployees we
          CROSS JOIN (SELECT ord, mth FROM py_stdrate WHERE type = 'BT05') sr
          INNER JOIN py_mastercum mc ON mc.his_empno = we.empl_id AND mc.his_type = sr.mth
          INNER JOIN py_masterpayded mp ON mp.his_empno = we.empl_id 
            AND mp.his_type = 'PR306'
          LEFT JOIN py_Title tt ON tt.Titlecode = we.Title
          LEFT JOIN ac_costcentre cc ON cc.unitcode = we.Location
          WHERE mp.amtthismth > 0
            ${year ? 'AND sr.ord = ?' : ''}
            ${month ? 'AND sr.mth = ?' : ''}
          ORDER BY mp.amtthismth DESC
          LIMIT ? OFFSET ?
        `;
        
        const params = [];
        if (year) params.push(year);
        if (month) params.push(month);
        params.push(BATCH_SIZE, offset);
        
        const [batchRows] = await pool.query(query, params);
        allResults.push(...batchRows);
      }
      
      return allResults;
    }
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

module.exports = new NHFReportService();


