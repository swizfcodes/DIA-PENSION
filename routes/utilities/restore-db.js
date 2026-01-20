const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const { exec } = require("child_process");
const dbConfig = require("../../config/db-config");
const mysql = require('mysql2/promise');
const router = express.Router();
const verifyToken = require('../../middware/authentication'); 

const RESTORE_DIR = path.join(process.cwd(), 'restores');
const HISTORY_FILE = path.join(RESTORE_DIR, 'restore-history.json');

// Ensure restore directory exists
if (!fs.existsSync(RESTORE_DIR)) {
    fs.mkdirSync(RESTORE_DIR, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, RESTORE_DIR);
    },
    filename: (req, file, cb) => {
        // Keep original filename for easier management
        const timestamp = Date.now();
        const sanitizedName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
        cb(null, `${timestamp}_${sanitizedName}`);
    }
});

const upload = multer({ 
    storage: storage,
    limits: {
        fileSize: 100 * 1024 * 1024 // 100MB limit
    },
    fileFilter: (req, file, cb) => {
        // Allow common backup file extensions
        const allowedExtensions = ['.sql', '.dump', '.bak', '.gz', '.zip'];
        const ext = path.extname(file.originalname).toLowerCase();
        
        if (allowedExtensions.includes(ext) || ext === '') {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Please upload a valid backup file.'), false);
        }
    }
});

// Helper function to get friendly name
const getFriendlyName = (dbName) => {
    const dbToClassMap = {
      [process.env.DB_OFFICERS]: 'OFFICERS',
      [process.env.DB_WOFFICERS]: 'W_OFFICERS', 
      [process.env.DB_RATINGS]: 'RATE A',
      [process.env.DB_RATINGS_A]: 'RATE B',
      [process.env.DB_RATINGS_B]: 'RATE C',
      [process.env.DB_JUNIOR_TRAINEE]: 'TRAINEE'
    };
    
    return dbToClassMap[dbName] || dbName;
};

// Helper functions for managing restore history
const loadHistory = (dbName = null) => {
    try {
        if (!fs.existsSync(HISTORY_FILE)) {
            return [];
        }
        const data = fs.readFileSync(HISTORY_FILE, 'utf8');
        const allHistory = JSON.parse(data);
        
        // Add friendly names to existing entries that don't have them
        const historyWithNames = allHistory.map(entry => ({
            ...entry,
            class_name: entry.class_name || getFriendlyName(entry.database)
        }));
        
        // Filter by database if provided
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

const addToHistory = (entry) => {
    // Load all history (not filtered)
    const allHistory = loadHistory();
    
    // Add friendly name to new entry
    const newEntry = {
        ...entry,
        id: Date.now(),
        date: new Date().toISOString(),
        class_name: getFriendlyName(entry.database)
    };
    
    allHistory.push(newEntry);
    saveHistory(allHistory);
    return allHistory;
};

/**
 * Utility to run shell command with better error handling
 */
function runCommand(command, callback) {
    console.log('Executing command:', command);
    
    exec(command, { 
        shell: true,
        timeout: 300000, // 5 minute timeout
        maxBuffer: 1024 * 1024 * 10 // 10MB buffer
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

/**
 * Create a backup before overwrite restore
 */
async function createBackupBeforeRestore(database) {
    return new Promise((resolve, reject) => {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupDir = path.join(process.cwd(), 'backups', 'pre-restore');
        
        // Ensure backup directory exists
        if (!fs.existsSync(backupDir)) {
            fs.mkdirSync(backupDir, { recursive: true });
        }
        
        const backupFile = path.join(backupDir, `${database}_pre-restore_${timestamp}.sql`);
        
        const dbUser = process.env.DB_USER || dbConfig.user;
        const dbPassword = process.env.DB_PASSWORD || dbConfig.password;
        const dbHost = process.env.DB_HOST || dbConfig.host || 'localhost';
        const dbPort = process.env.DB_PORT || dbConfig.port || 3306;
        
        const backupCommand = `mysqldump -h ${dbHost} -P ${dbPort} -u ${dbUser} -p${dbPassword} ${database} > "${backupFile}"`;
        
        runCommand(backupCommand, (err, output) => {
            if (err) {
                console.warn('Failed to create pre-restore backup:', err.message);
                // Continue with restore even if backup fails
                resolve(null);
            } else {
                console.log('Pre-restore backup created:', backupFile);
                resolve(backupFile);
            }
        });
    });
}

// Connection status route
router.get("/status", verifyToken, async (req, res) => {
    let connection;
        try {
            connection = await mysql.createConnection(dbConfig);
            await connection.ping(); // Simple connectivity test
            res.json({ status: "connected", engine: "mysql" });
        } catch (err) {
        console.error("DB connection failed:", err.message);
        res.json({
            status: "disconnected",
            engine: "mysql",
            error: err.message,
        });
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
router.get('/database', verifyToken, (req, res) => {
  try {
    const currentClass = req.current_class;
    
    // Get friendly name for the database
    const dbToClassMap = {
      [process.env.DB_OFFICERS]: 'OFFICERS',
      [process.env.DB_WOFFICERS]: 'W_OFFICERS', 
      [process.env.DB_RATINGS]: 'RATE A',
      [process.env.DB_RATINGS_A]: 'RATE B',
      [process.env.DB_RATINGS_B]: 'RATE C',
      [process.env.DB_JUNIOR_TRAINEE]: 'TRAINEE'
    };

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

/**
 * POST /api/restore-db/restore
 * Upload and restore database
 */
router.post("/restore", verifyToken, async (req, res) => {
    upload.single("file")(req, res, async (uploadErr) => {
        if (uploadErr) {
            console.error("Upload error:", uploadErr.message);
            return res.status(400).json({ 
                success: false, 
                error: uploadErr.message 
            });
        }

        const { mode = "overwrite", engine = "mysql" } = req.body;
        const database = req.current_class; // Use database from JWT token
        const file = req.file;

        if (!file || !database) {
            return res.status(400).json({ 
                success: false, 
                error: "Missing file or database parameter" 
            });
        }

        const restoreFile = file.path;
        const originalFilename = file.originalname;
        let preRestoreBackup = null;

        try {
            // Create backup before restore if mode is overwrite
            if (mode === "overwrite") {
                preRestoreBackup = await createBackupBeforeRestore(database);
            }

            // Build command based on database engine and mode
            let command;
            const dbUser = process.env.DB_USER || dbConfig.user;
            const dbPassword = process.env.DB_PASSWORD || dbConfig.password;
            const dbHost = process.env.DB_HOST || dbConfig.host || 'localhost';
            const dbPort = process.env.DB_PORT || dbConfig.port || 3306;

            // Detect platform
            const os = require("os");
            const isWindows = os.platform().startsWith("win");

            switch (engine.toLowerCase()) {
                case "mysql":
                    let mysqlOptions = `-h ${dbHost} -P ${dbPort} -u ${dbUser} -p${dbPassword}`;
                    
                    if (mode === "merge") {
                        // For merge mode, add --force to continue on duplicate key errors
                        mysqlOptions += " --force";
                    }
                    
                    // Handle different file types
                    if (originalFilename.endsWith('.gz')) {
                        command = `gunzip < "${restoreFile}" | mysql ${mysqlOptions} ${database}`;
                    } else {
                        if (isWindows) {
                            // Windows: Use PowerShell to strip DEFINER and pipe to mysql
                            command = `powershell -Command "Get-Content '${restoreFile}' | ForEach-Object { $_ -replace 'DEFINER\\s*=\\s*\`[^\`]+\`@\`[^\`]+\`', '' } | mysql ${mysqlOptions} ${database}"`;
                        } else {
                            // Linux: Use sed to strip DEFINER
                            command = `sed 's/DEFINER\\s*=\\s*\`[^\`]*\`@\`[^\`]*\`//g' "${restoreFile}" | mysql ${mysqlOptions} ${database}`;
                        }
                    }
                    break;
                    
                case "postgres":
                    let pgOptions = `-h ${dbHost} -p ${dbPort} -U ${dbUser} -d ${database}`;
                    
                    if (mode === "merge") {
                        pgOptions += " --on-conflict-do-nothing";
                    }
                    
                    command = `psql ${pgOptions} -f "${restoreFile}"`;
                    break;
                    
                case "mongo":
                    let mongoOptions = `--host ${dbHost}:${dbPort} --db ${database}`;
                    
                    if (mode === "overwrite") {
                        mongoOptions += " --drop";
                    }
                    
                    command = `mongorestore ${mongoOptions} "${restoreFile}"`;
                    break;
                    
                default:
                    return res.status(400).json({ 
                        success: false, 
                        error: `Unsupported database engine: ${engine}` 
                    });
            }

            // Execute the restore command
            runCommand(command, (err, output) => {
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

                // Add to history
                addToHistory(historyEntry);

                // Clean up uploaded file after processing
                setTimeout(() => {
                    try {
                        if (fs.existsSync(restoreFile)) {
                            fs.unlinkSync(restoreFile);
                        }
                    } catch (cleanupErr) {
                        console.error("Cleanup error:", cleanupErr.message);
                    }
                }, 1000);

                if (err) {
                    return res.status(500).json({ 
                        success: false, 
                        error: "Database restore failed", 
                        details: err.message 
                    });
                }

                res.json({ 
                    success: true, 
                    message: `Database restore completed successfully (${mode} mode)`, 
                    entry: historyEntry 
                });
            });
            
        } catch (error) {
            console.error('Restore process error:', error);
            return res.status(500).json({ 
                success: false, 
                error: "Restore process failed", 
                details: error.message 
            });
        }
    });
});

//Get restore history for current database only
router.get("/history", verifyToken, (req, res) => {
    const database = req.current_class;

    // Get friendly name for the database
    const dbToClassMap = {
      [process.env.DB_OFFICERS]: 'OFFICERS',
      [process.env.DB_WOFFICERS]: 'W_OFFICERS', 
      [process.env.DB_RATINGS]: 'RATE A',
      [process.env.DB_RATINGS_A]: 'RATE B',
      [process.env.DB_RATINGS_B]: 'RATE C',
      [process.env.DB_JUNIOR_TRAINEE]: 'TRAINEE'
    };

    const friendlyName = dbToClassMap[database] || database;

    const history = loadHistory(database); // Filter by current database
    res.json({ 
      history,
      database: database,
      class_name: friendlyName
    });
});

/**
 * GET /api/restore-db/stats
 * Get restore stats for current database only
 */
router.get("/stats", verifyToken, (req, res) => {
    const database = req.current_class;
    const history = loadHistory(database); // Filter by current database
    
    const successful = history.filter(h => h.status === "Success").length;
    const failed = history.filter(h => h.status === "Failed").length;
    const lastRestore = history.length > 0 
        ? history[history.length - 1].date 
        : null;

    res.json({ successful, failed, lastRestore, database });
});

/**
 * DELETE /api/restore-db/restore/:filename
 * Delete a restore entry from history (only for current database)
 */
router.delete('/restore/:filename', verifyToken, (req, res) => {
    try {
        const filename = decodeURIComponent(req.params.filename);
        const database = req.current_class;
        
        // Load all history (not filtered)
        const allHistory = loadHistory();
        
        // Find the entry that matches both filename and current database
        const entryIndex = allHistory.findIndex(entry => 
            entry.filename === filename && entry.database === database
        );
        
        if (entryIndex === -1) {
            return res.status(404).json({ 
                success: false, 
                error: 'Restore entry not found for your database' 
            });
        }

        // Remove the entry from history
        const removedEntry = allHistory.splice(entryIndex, 1)[0];
        saveHistory(allHistory);

        // Try to delete the associated file if it still exists
        if (removedEntry.storedFilename) {
            const filePath = path.join(RESTORE_DIR, removedEntry.storedFilename);
            try {
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                }
            } catch (fileErr) {
                console.warn('Could not delete associated file:', fileErr.message);
            }
        }

        // Try to delete pre-restore backup if it exists
        if (removedEntry.preRestoreBackup) {
            const backupPath = path.join(process.cwd(), 'backups', 'pre-restore', removedEntry.preRestoreBackup);
            try {
                if (fs.existsSync(backupPath)) {
                    fs.unlinkSync(backupPath);
                }
            } catch (backupErr) {
                console.warn('Could not delete pre-restore backup:', backupErr.message);
            }
        }

        res.json({ 
            success: true, 
            message: 'Restore entry deleted successfully' 
        });
        
    } catch (err) {
        console.error('Delete restore entry error:', err);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to delete restore entry' 
        });
    }
});

// Error handling middleware for multer errors
router.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({
                success: false,
                error: 'File too large. Maximum size is 100MB.'
            });
        }
    }
    next(error);
});

module.exports = router;


