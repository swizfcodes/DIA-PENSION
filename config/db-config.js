// config/db-config.js (REPLACES your existing db-config.js)
const path = require("path");
const dotenv = require("dotenv");

const envFile = process.env.NODE_ENV === "production" ? ".env.production" : ".env.local";
dotenv.config({ path: path.resolve(__dirname, envFile) });

// ==========================================
// AUTO-DETECT DATABASE TYPE
// ==========================================

async function detectAvailableDatabase() {
  const mysqlConfig = {
    host: process.env.MYSQL_HOST || 'localhost',
    port: parseInt(process.env.MYSQL_PORT) || 3306,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
  };

  const mssqlConfig = {
    host: process.env.MSSQL_HOST || 'localhost',
    port: parseInt(process.env.MSSQL_PORT) || 1433,
    user: process.env.MSSQL_USER,
    password: process.env.MSSQL_PASSWORD,
  };

  const available = {
    mysql: false,
    mssql: false
  };

  // Test MySQL
  if (mysqlConfig.user && mysqlConfig.password) {
    try {
      const mysql = require('mysql2/promise');
      const connection = await mysql.createConnection({
        host: mysqlConfig.host,
        port: mysqlConfig.port,
        user: mysqlConfig.user,
        password: mysqlConfig.password,
        connectTimeout: 10000
      });
      await connection.query('SELECT 1');
      await connection.end();
      available.mysql = true;
      console.log('✅ MySQL is available');
    } catch (error) {
      console.log('❌ MySQL not available:', error.message);
    }
  }

  // Test MSSQL
  if (mssqlConfig.user && mssqlConfig.password) {
    try {
      const mssql = require('mssql');
      const pool = await mssql.connect({
        server: mssqlConfig.host,
        port: mssqlConfig.port,
        user: mssqlConfig.user,
        password: mssqlConfig.password,
        options: {
          encrypt: true,
          trustServerCertificate: true,
          connectTimeout: 5000
        }
      });
      await pool.request().query('SELECT 1');
      await pool.close();
      available.mssql = true;
      console.log('✅ MSSQL is available');
    } catch (error) {
      console.log('❌ MSSQL not available:', error.message);
    }
  }

  return available;
}

// ==========================================
// DETERMINE WHICH DB TO USE
// ==========================================

async function selectDatabase() {
  // Manual override from environment
  const manualType = process.env.DB_TYPE?.toLowerCase();
  
  if (manualType === 'mysql' || manualType === 'mssql') {
    console.log(`🎯 Using manually specified database: ${manualType.toUpperCase()}`);
    return manualType;
  }

  // Auto-detect
  console.log('🔍 Auto-detecting available databases...');
  const available = await detectAvailableDatabase();

  // Prefer MySQL if both available (you can change this preference)
  if (available.mysql && available.mssql) {
    console.log('⚡ Both databases available, preferring MySQL');
    return 'mysql';
  }

  if (available.mysql) {
    console.log('📊 Using MySQL');
    return 'mysql';
  }

  if (available.mssql) {
    console.log('📊 Using MSSQL');
    return 'mssql';
  }

  throw new Error('❌ No database is available! Please check your configuration.');
}

// ==========================================
// BUILD CONFIG (Same format as your original!)
// ==========================================

async function buildConfig() {
  const dbType = await selectDatabase();

  if (dbType === 'mysql') {
    // Map MYSQL_* env vars to DB_* format
    process.env.DB_USER = process.env.MYSQL_USER;
    process.env.DB_PASSWORD = process.env.MYSQL_PASSWORD;
    process.env.DB_HOST = process.env.MYSQL_HOST;
    process.env.DB_PORT = process.env.MYSQL_PORT;
    process.env.DB_TYPE = 'mysql';
    
    // Map database names
    process.env.DB_OFFICERS = process.env.MYSQL_DB_OFFICERS;
    process.env.DB_WOFFICERS = process.env.MYSQL_DB_WOFFICERS;
    process.env.DB_RATINGS = process.env.MYSQL_DB_RATINGS;
    process.env.DB_RATINGS_A = process.env.MYSQL_DB_RATINGS_A;
    process.env.DB_RATINGS_B = process.env.MYSQL_DB_RATINGS_B;
    process.env.DB_JUNIOR_TRAINEE = process.env.MYSQL_DB_JUNIOR_TRAINEE;
    
  } else {
    // Map MSSQL_* env vars to DB_* format
    process.env.DB_USER = process.env.MSSQL_USER;
    process.env.DB_PASSWORD = process.env.MSSQL_PASSWORD;
    process.env.DB_HOST = process.env.MSSQL_HOST;
    process.env.DB_PORT = process.env.MSSQL_PORT;
    process.env.DB_TYPE = 'mssql';
    
    // Map database names
    process.env.DB_OFFICERS = process.env.MSSQL_DB_OFFICERS;
    process.env.DB_WOFFICERS = process.env.MSSQL_DB_WOFFICERS;
    process.env.DB_RATINGS = process.env.MSSQL_DB_RATINGS;
    process.env.DB_RATINGS_A = process.env.MSSQL_DB_RATINGS_A;
    process.env.DB_RATINGS_B = process.env.MSSQL_DB_RATINGS_B;
    process.env.DB_JUNIOR_TRAINEE = process.env.MSSQL_DB_JUNIOR_TRAINEE;
  }

  // Return config in YOUR EXACT format!
  return {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    host: process.env.DB_HOST || "localhost",
    port: process.env.DB_PORT ? parseInt(process.env.DB_PORT) : 3306,
    
    // Database type: 'mysql' or 'mssql'
    type: process.env.DB_TYPE || 'mysql',
    
    // Payroll class to database mapping (YOUR FORMAT!)
    databases: {
      Military: process.env.DB_OFFICERS,
      Civilian: process.env.DB_WOFFICERS, 
      Pension: process.env.DB_RATINGS,
      NYSC: process.env.DB_RATINGS_A,
      "Running Cost": process.env.DB_RATINGS_B,
      //juniorTrainee: process.env.DB_JUNIOR_TRAINEE,
    }
  };
}

// ==========================================
// INITIALIZE AND EXPORT
// ==========================================

let configPromise;
let cachedConfig;

function getConfig() {
  if (cachedConfig) {
    return Promise.resolve(cachedConfig);
  }
  
  if (!configPromise) {
    configPromise = buildConfig().then(config => {
      cachedConfig = config;
      return config;
    });
  }
  
  return configPromise;
}

// For synchronous access (after initialization)
function getConfigSync() {
  if (!cachedConfig) {
    throw new Error('Config not initialized! Call await getConfig() first.');
  }
  return cachedConfig;
}

module.exports = { getConfig, getConfigSync, detectAvailableDatabase };