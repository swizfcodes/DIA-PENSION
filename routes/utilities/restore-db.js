const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const { exec } = require("child_process");
const dbConfig = require("../../config/db-config");
const mysql = require('mysql2/promise');
const router = express.Router();
const verifyToken = require('../../middware/authentication');
const pool = require('../../config/db');

const RESTORE_DIR = path.join(process.cwd(), 'restores');
const HISTORY_FILE = path.join(RESTORE_DIR, 'restore-history.json');

// Ensure restore directory exists
if (!fs.existsSync(RESTORE_DIR)) {
    fs.mkdirSync(RESTORE_DIR, { recursive: true });
}

// SSE sessions for progress tracking
const activeSessions = new Map();

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, RESTORE_DIR);
    },
    filename: (req, file, cb) => {
        const timestamp = Date.now();
        const sanitizedName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
        cb(null, `${timestamp}_${sanitizedName}`);
    }
});

const upload = multer({ 
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024 * 1024 // 10GB limit
    },
    fileFilter: (req, file, cb) => {
        const allowedExtensions = ['.sql', '.dump', '.bak', '.gz', '.zip'];
        const ext = path.extname(file.originalname).toLowerCase();
        
        if (allowedExtensions.includes(ext) || ext === '') {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Please upload a valid backup file.'), false);
        }
    }
});

// Helper function to get mapping of db_name to classname
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


// Helper function to get friendly name
const getFriendlyName = async (dbName) => {
    const dbToClassMap = await getDbToClassMap();
    
    return dbToClassMap[dbName] || dbName;
};

// Helper functions for managing restore history
const loadHistory = async (dbName = null) => {
    try {
        if (!fs.existsSync(HISTORY_FILE)) {
            return [];
        }
        const data = fs.readFileSync(HISTORY_FILE, 'utf8');
        const allHistory = JSON.parse(data);

        const historyWithNames = await Promise.all(
            allHistory.map(async (entry) => ({
                ...entry,
                class_name: entry.class_name || await getFriendlyName(entry.database)
            }))
        );

        if (dbName) {
            return historyWithNames.filter(entry => entry.database === dbName);
        }

        return historyWithNames;
    } catch (err) {
        console.error('Error loading history:', err);
        return [];
    }
};

const saveHistory = (history) => {
    try {
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
    } catch (err) {
        console.error('Error saving history:', err);
    }
};

const addToHistory = async (entry) => {
    const allHistory = await loadHistory();
    
    const newEntry = {
        ...entry,
        id: Date.now(),
        date: new Date().toISOString(),
        class_name: await getFriendlyName(entry.database)
    };
    
    allHistory.push(newEntry);
    saveHistory(allHistory);
    return allHistory;
};

// Broadcast progress to SSE clients
function broadcastProgress(sessionId, progress) {
    const session = activeSessions.get(sessionId);
    if (!session) return;
    
    session.progress = progress;
    const data = `data: ${JSON.stringify(progress)}\n\n`;
    
    session.clients.forEach(client => {
        try {
            client.write(data);
        } catch (err) {
            console.error('Error writing to SSE client:', err.message);
        }
    });
}

function runCommand(command, callback) {
    console.log('Executing command:', command);
    
    exec(command, { 
        shell: true,
        timeout: 3600000, // 1 hour
        maxBuffer: 1024 * 1024 * 100 // 100MB buffer
    }, (err, stdout, stderr) => {
        if (err) {
            console.error("Command failed:", err.message);
            console.error("STDERR:", stderr);
            return callback(err, null);
        }
        
        console.log("Command output:", stdout);
        if (stderr) {
            console.warn("Command warnings:", stderr);
        }
        
        callback(null, stdout);
    });
}

async function createBackupBeforeRestore(database, config) {
    return new Promise((resolve) => {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupDir = path.join(process.cwd(), 'backups', 'pre-restore');
        
        if (!fs.existsSync(backupDir)) {
            fs.mkdirSync(backupDir, { recursive: true });
        }
        
        const backupFile = path.join(backupDir, `${database}_pre-restore_${timestamp}.sql`);
        const backupCommand = `mysqldump --skip-lock-tables -h ${config.host} -P ${config.port} -u ${config.user} -p${config.password} ${database} > "${backupFile}"`;
        
        runCommand(backupCommand, (err) => {
            if (err) {
                console.warn('Pre-restore backup failed (continuing):', err.message);
            } else {
                console.log('Pre-restore backup created:', backupFile);
            }
            resolve(backupFile);
        });
    });
}

// SSE Progress endpoint
router.get("/progress/:sessionId", async (req, res) => {
    const sessionId = req.params.sessionId;
    const token = req.query.token;
    
    if (!token) {
        return res.status(401).json({ error: 'No token provided' });
    }
    
    try {
        const jwt = require('jsonwebtoken');
        jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
        return res.status(403).json({ error: 'Invalid token' });
    }
    
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    if (!activeSessions.has(sessionId)) {
        activeSessions.set(sessionId, {
            clients: [],
            progress: { stage: 'waiting', percent: 0, message: 'Waiting...' }
        });
    }
    
    const session = activeSessions.get(sessionId);
    res.write(`data: ${JSON.stringify(session.progress)}\n\n`);
    session.clients.push(res);
    
    req.on('close', () => {
        const index = session.clients.indexOf(res);
        if (index !== -1) {
            session.clients.splice(index, 1);
        }
    });
});

// Connection status
router.get("/status", verifyToken, async (req, res) => {
    let connection;
    try {
        const config = await dbConfig.getConfig();
        connection = await mysql.createConnection({
            host: config.host,
            port: config.port,
            user: config.user,
            password: config.password
        });
        await connection.ping();
        res.json({ status: "connected", engine: config.type || "mysql" });
    } catch (err) {
        console.error("DB connection failed:", err.message);
        res.json({ status: "disconnected", error: err.message });
    } finally {
        if (connection) {
            try {
                await connection.end();
            } catch (closeErr) {
                console.error("Error closing connection:", closeErr.message);
            }
        }
    }
});

// Get database name
router.get('/database', verifyToken, async (req, res) => {
  const dbToClassMap = await getDbToClassMap();

  res.json({ 
    database: req.current_class,
    class_name: dbToClassMap[req.current_class] || 'Unknown',
    primary_class: req.primary_class,
    user_info: {
      user_id: req.user_id,
      full_name: req.user_fullname,
      role: req.user_role
    }
  });
});

// RESTORE endpoint
router.post("/restore", verifyToken, async (req, res) => {
    upload.single("file")(req, res, async (uploadErr) => {
        if (uploadErr) {
            return res.status(400).json({ success: false, error: uploadErr.message });
        }

        const { mode = "overwrite", engine = "mysql" } = req.body;
        const database = req.current_class;
        const file = req.file;

        if (!file || !database) {
            return res.status(400).json({ success: false, error: "Missing file or database" });
        }

        // Generate session ID and return immediately
        const sessionId = `restore_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        activeSessions.set(sessionId, {
            clients: [],
            progress: { stage: 'uploading', percent: 5, message: 'File uploaded...' }
        });
        
        res.json({ success: true, sessionId });

        // Continue in background
        const restoreFile = file.path;
        const originalFilename = file.originalname;

        try {
            broadcastProgress(sessionId, { stage: 'preparing', percent: 10, message: 'Preparing restore...' });
            
            const config = await dbConfig.getConfig();
            let preRestoreBackup = null;
            
            // Optional: create backup
            if (mode === "overwrite" && req.body.skipPreBackup !== 'true') {
                broadcastProgress(sessionId, { stage: 'backup', percent: 15, message: 'Creating pre-restore backup...' });
                preRestoreBackup = await createBackupBeforeRestore(database, config);
            }

            broadcastProgress(sessionId, { stage: 'preparing', percent: 20, message: 'Building restore command...' });

            // Build command based on platform and engine
            let command;
            const os = require("os");
            const isWindows = os.platform().startsWith("win");

            switch (engine.toLowerCase()) {
                case "mysql":
                    let mysqlOptions = `-h ${config.host} -P ${config.port} -u ${config.user} -p${config.password}`;
                    
                    if (mode === "merge") {
                        mysqlOptions += " --force";
                    }
                    
                    // Handle different file types
                    if (originalFilename.endsWith('.gz')) {
                        broadcastProgress(sessionId, { stage: 'decompressing', percent: 30, message: 'Decompressing gzipped file...' });
                        command = `gunzip < "${restoreFile}" | mysql ${mysqlOptions} ${database}`;
                    } else {
                        broadcastProgress(sessionId, { stage: 'processing', percent: 30, message: 'Processing SQL file...' });
                        if (isWindows) {
                            // Windows: Direct restore (PowerShell method causes memory issues with large files)
                            command = `mysql ${mysqlOptions} ${database} < "${restoreFile}"`;
                        } else {
                            // Linux: Use sed to strip DEFINER
                            command = `sed 's/DEFINER\\s*=\\s*\`[^\`]*\`@\`[^\`]*\`//g' "${restoreFile}" | mysql ${mysqlOptions} ${database}`;
                        }
                    }
                    break;
                    
                case "postgres":
                    let pgOptions = `-h ${config.host} -p ${config.port} -U ${config.user} -d ${database}`;
                    
                    if (mode === "merge") {
                        pgOptions += " --on-conflict-do-nothing";
                    }
                    
                    command = `psql ${pgOptions} -f "${restoreFile}"`;
                    break;
                    
                case "mongo":
                    let mongoOptions = `--host ${config.host}:${config.port} --db ${database}`;
                    
                    if (mode === "overwrite") {
                        mongoOptions += " --drop";
                    }
                    
                    command = `mongorestore ${mongoOptions} "${restoreFile}"`;
                    break;
                    
                default:
                    broadcastProgress(sessionId, { 
                        stage: 'failed', 
                        percent: 100, 
                        message: `Unsupported database engine: ${engine}` 
                    });
                    return;
            }

            broadcastProgress(sessionId, { stage: 'restoring', percent: 40, message: 'Importing data to database...' });
            
            // Simulate progress during restore (visual feedback)
            let progressPercent = 40;
            const progressInterval = setInterval(() => {
                if (progressPercent < 90) {
                    progressPercent += 5;
                    broadcastProgress(sessionId, { 
                        stage: 'restoring', 
                        percent: progressPercent, 
                        message: `Restoring database... ${progressPercent}%` 
                    });
                }
            }, 2000); // Update every 2 seconds

            // Execute restore
            runCommand(command, async (err, output) => {
                clearInterval(progressInterval); // Stop progress simulation
                
                const historyEntry = {
                    filename: originalFilename,
                    storedFilename: path.basename(restoreFile),
                    database,
                    engine,
                    mode,
                    status: err ? "Failed" : "Success",
                    error: err ? err.message : null,
                    output: output || null,
                    preRestoreBackup: preRestoreBackup ? path.basename(preRestoreBackup) : null,
                    userId: req.user_id,
                    userName: req.user_fullname
                };

                await addToHistory(historyEntry);

                // Cleanup file
                setTimeout(() => {
                    try {
                        if (fs.existsSync(restoreFile)) {
                            fs.unlinkSync(restoreFile);
                        }
                    } catch (cleanupErr) {
                        console.log("Cleanup error:", cleanupErr.message);
                    }
                }, 5000);

                if (err) {
                    broadcastProgress(sessionId, { 
                        stage: 'failed', 
                        percent: 100, 
                        message: 'Restore failed: ' + err.message 
                    });
                } else {
                    broadcastProgress(sessionId, { 
                        stage: 'complete', 
                        percent: 100, 
                        message: 'Restore completed successfully!' 
                    });
                }
            });
            
        } catch (error) {
            clearInterval(progressInterval); // Make sure to clear interval on error
            console.error('Restore error:', error);
            
            // Create history entry for catch block errors
            const errorHistoryEntry = {
                filename: originalFilename,
                storedFilename: path.basename(restoreFile),
                database,
                engine,
                mode,
                status: "Failed",
                error: error.message,
                output: null,
                preRestoreBackup: null,
                userId: req.user_id,
                userName: req.user_fullname
            };
            
             await addToHistory(errorHistoryEntry);
            
            broadcastProgress(sessionId, { 
                stage: 'failed', 
                percent: 100, 
                message: 'Error: ' + error.message 
            });
        }
    });
});

// Get history
router.get("/history", verifyToken, async (req, res) => {
    const database = req.current_class;
    const dbToClassMap = await getDbToClassMap();

    res.json({ 
      history: await loadHistory(database),
      database,
      class_name: dbToClassMap[database] || database
    });
});

// Get stats
router.get("/stats", verifyToken, async (req, res) => {
    const history = await loadHistory(req.current_class);
    res.json({ 
        successful: history.filter(h => h.status === "Success").length,
        failed: history.filter(h => h.status === "Failed").length,
        lastRestore: history.length > 0 ? history[history.length - 1].date : null,
        database: req.current_class
    });
});

// Delete history entry
router.delete('/restore/:filename', verifyToken, async (req, res) => {
    try {
        const filename = decodeURIComponent(req.params.filename);
        const allHistory = await loadHistory();
        const entryIndex = allHistory.findIndex(entry => 
            entry.filename === filename && entry.database === req.current_class
        );
        
        if (entryIndex === -1) {
            return res.status(404).json({ success: false, error: 'Entry not found' });
        }

        allHistory.splice(entryIndex, 1);
        saveHistory(allHistory);
        res.json({ success: true, message: 'Deleted successfully' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Error handler
router.use((error, req, res, next) => {
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ success: false, error: 'File too large. Max 10GB.' });
    }
    next(error);
});

module.exports = router;