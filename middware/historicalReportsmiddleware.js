// middleware/historicalReportMiddleware.js
const seamlessWrapper = require('../services/helpers/historicalReportWrapper');

/**
 * Middleware that automatically activates historical wrapper for all reports
 * Add this to your report routes
 */
async function historicalReportMiddleware(req, res, next) {
  const { year, month } = req.query;
  const requestPath = req.path;
  const requestMethod = req.method;

  console.log('\n' + '='.repeat(80));
  console.log('📊 [MIDDLEWARE] Historical Report Request');
  console.log('='.repeat(80));
  console.log(`   Route: ${requestMethod} ${requestPath}`);
  console.log(`   Query params:`, req.query);

  // If no year/month, skip
  if (!year || !month) {
    console.log('   ⏩ No year/month provided - skipping wrapper');
    console.log('='.repeat(80) + '\n');
    return next();
  }

  const startTime = Date.now();

  try {
    // Get current database from request (set by verifyToken middleware)
    const database = req.current_database || req.current_class;
    
    if (!database) {
      throw new Error('No database context available. Please ensure authentication middleware runs first.');
    }
    
    console.log(`   📊 Using database: ${database}`);
    
    // Activate wrapper with database context
    const activated = await seamlessWrapper.activate(
      parseInt(year), 
      parseInt(month),
      database  // ⬅️ Pass database here
    );
    
    console.log('='.repeat(80));
    
    // Store cleanup function with timing
    res.on('finish', () => {
      const duration = Date.now() - startTime;
      console.log('\n' + '='.repeat(80));
      console.log('✅ [MIDDLEWARE] Request Complete');
      console.log('='.repeat(80));
      console.log(`   Duration: ${duration}ms`);
      console.log(`   Status: ${res.statusCode}`);
      
      const status = seamlessWrapper.getStatus();
      console.log(`   Wrapper Stats:`);
      console.log(`     - Queries processed: ${status.queryCount}`);
      console.log(`     - Queries transformed: ${status.transformCount}`);
      console.log('='.repeat(80) + '\n');
      
      seamlessWrapper.deactivate();
    });

    res.on('close', () => {
      seamlessWrapper.deactivate();
    });

    // Add error tracking
    const originalJson = res.json.bind(res);
    res.json = function(data) {
      if (!res.headersSent) {
        if (data.success === false || data.error) {
          console.log('\n   ⚠️  Response contains error:');
          console.log(`   ${data.error || data.message}`);
        }
      }
      return originalJson(data);
    };

    next();
  } catch (error) {
    const duration = Date.now() - startTime;
    
    console.log('\n' + '='.repeat(80));
    console.log('❌ [MIDDLEWARE] Validation Error');
    console.log('='.repeat(80));
    console.log(`   Error: ${error.message}`);
    console.log(`   Duration: ${duration}ms`);
    console.log('='.repeat(80) + '\n');
    
    seamlessWrapper.deactivate();
    
    return res.status(400).json({
      success: false,
      error: error.message
    });
  }
}

module.exports = historicalReportMiddleware;


