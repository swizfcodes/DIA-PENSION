const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { spawn } = require('child_process');
const express = require('express');
const cron = require('node-cron');
const mysql = require('mysql2/promise');
const verifyToken = require('../../middware/authentication');
const pool = require('../../config/db');

const router = express.Router();

// CONFIG: adjust if your config path differs
const dbConfig = require('../../config/db-config');

// ROOT dirs (always point to project root)
const ROOT_BACKUP_DIR = path.resolve(process.cwd(), 'backups');
const ROOT_CLOUD_BACKUP_DIR = path.resolve(process.cwd(), 'cloud_backups');

// ensure folders exist
if (!fs.existsSync(ROOT_BACKUP_DIR)) fs.mkdirSync(ROOT_BACKUP_DIR, { recursive: true });
if (!fs.existsSync(ROOT_CLOUD_BACKUP_DIR)) fs.mkdirSync(ROOT_CLOUD_BACKUP_DIR, { recursive: true });

console.log('Local backups dir:', ROOT_BACKUP_DIR);
console.log('Cloud backups dir:', ROOT_CLOUD_BACKUP_DIR);

const scheduledJobs = {}; // keep track of cron jobs

//Helper Functions
function listFilesInDir(dir, dbName = null) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => fs.statSync(path.join(dir, f)).isFile())
    .filter(f => dbName ? f.startsWith(`${dbName}_`) : true) // Filter by database name if provided
    .map((file) => {
      const stats = fs.statSync(path.join(dir, file));
      return {
        filename: file,
        size: stats.size,
        created: stats.birthtime,
        modified: stats.mtime
      };
    })
    .sort((a, b) => b.modified - a.modified); // newest first
}

function getLatestStats(dir, dbName = null) {
  const files = listFilesInDir(dir, dbName);
  if (files.length === 0) {
    return {
      successfulBackups: 0,
      totalStorage: 0,
      lastBackup: null,
      lastFile: null
    };
  }

  const latest = files[0];
  // totalStorage = size of latest (since you want latest stats), but we can keep aggregate if needed
  return {
    successfulBackups: 1,
    totalStorage: latest.size,
    lastBackup: latest.modified,
    lastFile: latest.filename
  };
}

/* Runs the actual mysqldump, returns a Promise that resolves with { path, filename } or rejects */
function runBackup({ dbName, friendlyName, backupType = 'full', compression = false, storage = 'local' }) {
  return new Promise((resolve, reject) => {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      let filename = `${friendlyName}_${backupType}_${timestamp}.sql`;
      if (compression) filename += '.gz';

      const backupDir = storage === 'cloud' ? ROOT_CLOUD_BACKUP_DIR : ROOT_BACKUP_DIR;
      if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

      const backupPath = path.join(backupDir, filename);

      // build args for mysqldump
      const args = [
        '-u', process.env.DB_USER || dbConfig.user,
        `-p${process.env.DB_PASSWORD || dbConfig.password}`,
        dbName
      ];

      if (backupType === 'structure') {
        args.push('--no-data');
      } else if (backupType === 'data') {
        args.push('--no-create-info');
      }
      // 'full' uses default mysqldump behavior (structure + data)

      const dump = spawn('mysqldump', args);

      const outStream = fs.createWriteStream(backupPath);
      const gzip = compression ? zlib.createGzip() : null;

      let childExitCode = null;
      let responded = false;

      dump.on('error', (err) => {
        if (!responded) {
          responded = true;
          reject(new Error('Backup process error: ' + err.message));
        }
      });

      dump.on('close', (code) => {
        childExitCode = code;
        // only decide after file stream finishes
        // if no compression, the outStream will end when dump stdout ends
      });

      outStream.on('error', (err) => {
        if (!responded) {
          responded = true;
          reject(new Error('File write error: ' + err.message));
        }
      });

      outStream.on('finish', () => {
        if (responded) return;
        if (childExitCode === 0 || childExitCode === null) {
          responded = true;
          resolve({ path: backupPath, filename });
        } else {
          responded = true;
          reject(new Error('mysqldump failed with exit code ' + childExitCode));
        }
      });

      // pipe streams
      if (compression) {
        dump.stdout.pipe(gzip).pipe(outStream);
      } else {
        dump.stdout.pipe(outStream);
      }

      // safety: if dump already closed and outStream already finished, ensure we resolve
      // (handled via 'finish' and childExitCode)
    } catch (err) {
      return reject(err);
    }
  });
}

//Helpers
async function getDbToClassMap() {
  const masterDb = pool.getMasterDb();
  pool.useDatabase(masterDb);
  const [dbClasses] = await pool.query('SELECT db_name, classname FROM py_payrollclass');
  
  const dbToClassMap = {};
  dbClasses.forEach(row => {
    dbToClassMap[row.db_name] = row.classname;
  });
  
  return dbToClassMap;
}

//Routes
// GET current database name from JWT token
router.get('/database', verifyToken, async (req, res) => {
  try {
    const currentClass = req.current_class;
    
    // Get friendly name for the database
    const dbToClassMap = await getDbToClassMap();

    const friendlyName = dbToClassMap[currentClass] || 'Unknown Class';

    res.json({ 
      database: currentClass,
      class_name: friendlyName,
      primary_class: req.primary_class,
      user_info: {
        user_id: req.user_id,
        full_name: req.user_fullname,
        role: req.user_role
      }
    });
  } catch (error) {
    console.error('Error getting database info:', error);
    res.json({ 
      database: 'Error',
      class_name: 'Error',
      error: error.message 
    });
  }
});

/*
  POST /backup/mysql
  Body: { backupType, compression (bool), storage: 'local'|'cloud' }
*/
router.post('/backup/mysql', verifyToken, async (req, res) => {
  try {
    const { backupType = 'full', compression = false, storage = 'local' } = req.body || {};
    const dbName = req.current_class;

    // Get friendly name for the database
    const dbToClassMap = await getDbToClassMap();

    const friendlyName = dbToClassMap[dbName] || dbName;

    const result = await runBackup({ 
      dbName, 
      friendlyName, 
      backupType, 
      compression, 
      storage 
    });
    
    return res.json({ 
      success: true,
      message: 'Backup completed successfully',
      filename: result.filename, 
      path: result.path,
      class_name: friendlyName
    });
  } catch (err) {
    console.error('Backup failed:', err);
    return res.status(500).json({ success: false, error: err.message || 'Backup process failed' });
  }
});

/*
  POST /backup/schedule
  Body: { schedule: 'hourly'|'daily'|'weekly', backupType, compression, storage }
*/
router.post('/backup/schedule', verifyToken, async (req, res) => {
  try {
    const { schedule, backupType = 'full', compression = false, storage = 'local' } = req.body || {};
    const dbName = req.current_class;

    // Get friendly name for the database
    const dbToClassMap = await getDbToClassMap();

    const friendlyName = dbToClassMap[dbName] || dbName;

    const scheduleMap = {
      hourly: '0 * * * *',
      daily: '0 0 * * *',
      weekly: '0 0 * * 0'
    };

    const cronExp = scheduleMap[schedule];
    if (!cronExp) return res.status(400).json({ success: false, error: 'Invalid schedule option' });

    // stop old job if exists
    if (scheduledJobs[schedule]) {
      try { scheduledJobs[schedule].stop(); } catch (e) { /* ignore */ }
    }

    const job = cron.schedule(cronExp, async () => {
      console.log(`Running scheduled backup for ${friendlyName} (${schedule})`);
      try {
        await runBackup({ dbName, friendlyName, backupType, compression, storage });
        console.log(`Scheduled backup finished for ${friendlyName}`);
      } catch (err) {
        console.error(`Scheduled backup failed for ${friendlyName}:`, err);
      }
    });

    scheduledJobs[schedule] = job;

    res.json({ 
      success: true, 
      message: `Backup scheduled (${schedule}) for ${friendlyName}`,
      class_name: friendlyName
    });
  } catch (err) {
    console.error('Schedule error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get list of backups for current database only
router.get('/backups', verifyToken, async (req, res) => {
  const dbName = req.current_class;
  
  // Get friendly name for the database
  const dbToClassMap = await getDbToClassMap();

  const friendlyName = dbToClassMap[dbName] || dbName;

  const dirs = [
    { type: 'local', dir: ROOT_BACKUP_DIR },
    { type: 'cloud', dir: ROOT_CLOUD_BACKUP_DIR }
  ];

  let backups = [];

  dirs.forEach(({ type, dir }) => {
    if (!fs.existsSync(dir)) return;

    const files = fs.readdirSync(dir);
    files.forEach(file => {
      // Filter files that belong to the current database (check both raw dbName and friendlyName)
      if (file.startsWith(`${dbName}_`) || file.startsWith(`${friendlyName}_`)) {
        const filePath = path.join(dir, file);
        const stats = fs.statSync(filePath);

        backups.push({
          filename: file,
          size: stats.size,
          created: stats.birthtime,
          modified: stats.mtime,
          source: type
        });
      }
    });
  });

  // sort newest → oldest
  backups.sort((a, b) => b.modified - a.modified);

  res.json({ 
    backups,
    database: dbName,
    class_name: friendlyName
  });
});


// Get backup statistics for current database only
router.get('/backup/stats', verifyToken, async (req, res) => {
  const dbName = req.current_class;
  
  // Get friendly name for the database
  const dbToClassMap = await getDbToClassMap();

  const friendlyName = dbToClassMap[dbName] || dbName;

  const dirs = [ROOT_BACKUP_DIR, ROOT_CLOUD_BACKUP_DIR];

  let totalStorage = 0;
  let lastBackup = null;
  let successfulBackups = 0;

  dirs.forEach(dir => {
    if (!fs.existsSync(dir)) return;

    const files = fs.readdirSync(dir);
    files.forEach(file => {
      // Filter files that belong to the current database (check both raw dbName and friendlyName)
      if (file.startsWith(`${dbName}_`) || file.startsWith(`${friendlyName}_`)) {
        const filePath = path.join(dir, file);
        const stats = fs.statSync(filePath);

        successfulBackups++;
        totalStorage += stats.size;

        if (!lastBackup || stats.mtime > lastBackup) {
          lastBackup = stats.mtime;
        }
      }
    });
  });

  res.json({
    successfulBackups,
    totalStorage,
    lastBackup,
    database: dbName,
    class_name: friendlyName
  });
});

/*
  Download and Delete routes (use ROOT dirs)
*/
router.get('/backup/download/:filename', verifyToken, (req, res) => {
  const { filename } = req.params;
  const localPath = path.join(ROOT_BACKUP_DIR, filename);
  const cloudPath = path.join(ROOT_CLOUD_BACKUP_DIR, filename);

  let filePath = null;
  if (fs.existsSync(localPath)) filePath = localPath;
  if (fs.existsSync(cloudPath)) filePath = cloudPath;

  if (!filePath) return res.status(404).json({ success: false, error: 'File not found' });

  res.download(filePath, filename, (err) => {
    if (err) {
      console.error('Download error:', err);
      res.status(500).json({ success: false, error: 'Download failed' });
    }
  });
});

router.delete('/backup/:filename', verifyToken, (req, res) => {
  const { filename } = req.params;
  const localPath = path.join(ROOT_BACKUP_DIR, filename);
  const cloudPath = path.join(ROOT_CLOUD_BACKUP_DIR, filename);

  let filePath = null;
  if (fs.existsSync(localPath)) filePath = localPath;
  if (fs.existsSync(cloudPath)) filePath = cloudPath;

  if (!filePath) return res.status(404).json({ success: false, error: 'File not found' });

  try {
    fs.unlinkSync(filePath);
    res.json({ success: true, message: 'Backup deleted successfully' });
  } catch (err) {
    console.error('Delete error:', err);
    res.status(500).json({ success: false, error: 'Delete failed' });
  }
});

/*
  Health check - verify DB connection
*/
router.get('/health', verifyToken, async (req, res) => {
  let connection;
  try {
    connection = await mysql.createConnection(dbConfig);
    await connection.ping();
    res.json({ status: 'connected', engine: 'mysql' });
  } catch (err) {
    console.error('DB connection failed:', err.message);
    res.json({ status: 'disconnected', engine: 'mysql', error: err.message });
  } finally {
    if (connection) await connection.end();
  }
});

module.exports = router;