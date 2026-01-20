const express = require('express');
const pool  = require('../../config/db'); // mysql2 pool
const router = express.Router();
const path = require('path');
const dotenv = require('dotenv');
const envFile = '.env.local';
dotenv.config({ path: path.resolve(__dirname, envFile) });
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET;
const verifyToken = require('../../middware/authentication');



// User login - searches across all databases
router.post("/login", async (req, res) => {
  const { user_id, password, payroll_class } = req.body;
  // payroll_class comes from frontend as: 'hicaddata', 'hicaddata1' (db_name)

  try {
    const userCandidates = []; // Store all found user instances

    // Get list of all available databases to search AND create a mapping of db_name <-> classname
    let databasesToSearch = [];
    let dbClassMapping = {}; // { 'hicaddata': 'OFFICERS', 'OFFICERS': 'hicaddata' }
    
    try {
      // Try to get all db_classes from officers database
      pool.useDatabase(process.env.DB_OFFICERS);
      const [dbClasses] = await pool.query("SELECT db_name, classname FROM py_payrollclass");
      
      // Build list: officers first, then all other databases
      const otherDatabases = dbClasses.map(row => row.db_name).filter(db => db !== process.env.DB_OFFICERS);
      databasesToSearch = [process.env.DB_OFFICERS, ...otherDatabases];
      
      // Create bidirectional mapping
      dbClasses.forEach(row => {
        dbClassMapping[row.db_name] = row.classname; // 'hicaddata' -> 'OFFICERS'
        dbClassMapping[row.classname] = row.db_name; // 'OFFICERS' -> 'hicaddata'
      });
      
      console.log("📋 Databases to search:", databasesToSearch);
      console.log("🔗 Class mapping created:", dbClassMapping);
    } catch (err) {
      // If db_classes table doesn't exist, fallback to searching common databases
      console.log("⚠️ Could not fetch db_classes, using fallback list");
      databasesToSearch = [
        process.env.DB_OFFICERS,
        process.env.DB_WOFFICERS,
        process.env.DB_RATINGS,
        process.env.DB_RATINGS_A,
        process.env.DB_RATINGS_B,
        process.env.DB_JUNIOR_TRAINEE
      ];
    }

    // Search for user in ALL databases and collect all instances
    for (const dbName of databasesToSearch) {
      if (!dbName) continue; // Skip null/undefined entries
      
      try {
        console.log(`🔍 Searching for user ${user_id} in database: ${dbName}`);
        pool.useDatabase(dbName);
        
        const [rows] = await pool.query(
          "SELECT * FROM users WHERE user_id = ?",
          [user_id]
        );
        
        if (rows.length > 0) {
          const foundUser = rows[0];
          userCandidates.push({
            user: foundUser,
            database: dbName
          });
          console.log(`✅ User found in database: ${dbName}`);
          console.log(`   👤 Name: ${foundUser.full_name}, Primary Class: ${foundUser.primary_class}`);
          console.log(`   🔐 Password: "${foundUser.password}" (type: ${typeof foundUser.password})`);
        }
      } catch (err) {
        // If database doesn't exist or has no users table, continue to next
        console.log(`❌ Error searching database ${dbName}:`, err.message);
        continue;
      }
    }

    // If user not found in ANY database
    if (userCandidates.length === 0) {
      console.log(`❌ User ${user_id} not found in any database`);
      return res.status(401).json({ error: "Invalid User ID or password" });
    }

    console.log(`\n📊 Found ${userCandidates.length} instance(s) of user ${user_id}`);

    // Now validate password and find matching user
    let authenticatedUser = null;
    let authenticatedDatabase = null;

    for (const candidate of userCandidates) {
      const { user, database } = candidate;
      
      console.log(`\n🔐 Checking credentials for user in ${database}:`);
      console.log(`   Stored password: "${user.password}" (${typeof user.password})`);
      console.log(`   Provided password: "${password}" (${typeof password})`);
      console.log(`   Match: ${user.password === password}`);
      console.log(`   Status: ${user.status}`);
      console.log(`   Expiry date: ${user.expiry_date}`);
      console.log(`   Primary class (stored): ${user.primary_class}`);
      console.log(`   Requested class (from login): ${payroll_class}`);

      // Check expiry date if set
      let isExpired = false;
      if (user.expiry_date) {
        const expiryDate = new Date(user.expiry_date);
        const today = new Date();
        today.setHours(0, 0, 0, 0); // Reset to start of day for fair comparison
        isExpired = expiryDate < today;
        console.log(`   Account expired: ${isExpired}`);
      }

      // Normalize the primary_class comparison
      // The user.primary_class might be classname(OFFICERS) or db_name (hicaddata)
      // The payroll_class from frontend is always db_name (hicaddata)
      
      let userPrimaryDbName = user.primary_class;
      
      // If primary_class looks like a classname(all caps, no numbers), convert it to db_name
      if (dbClassMapping[user.primary_class]) {
        userPrimaryDbName = dbClassMapping[user.primary_class];
        console.log(`   🔄 Converted classname "${user.primary_class}" to db_name "${userPrimaryDbName}"`);
      }
      
      const classMatches = userPrimaryDbName === payroll_class;
      console.log(`   Class match: ${classMatches} (user: ${userPrimaryDbName}, requested: ${payroll_class})`);

      // Check if password matches, status is active, not expired, and primary_class matches
      if (user.password === password && 
          user.status === "active" && 
          !isExpired &&
          classMatches) {
        authenticatedUser = user;
        authenticatedDatabase = database;
        console.log(`✅ Valid credentials found in ${database}!`);
        break; // Found valid match, stop searching
      } else {
        console.log(`❌ Invalid credentials in ${database}:`);
        if (user.password !== password) console.log(`   - Password mismatch`);
        if (user.status !== "active") console.log(`   - Account status: ${user.status}`);
        if (isExpired) console.log(`   - Account expired on ${user.expiry_date}`);
        if (!classMatches) console.log(`   - Class mismatch (has: ${userPrimaryDbName}, wants: ${payroll_class})`);
      }
    }

    // If no valid match found after checking all instances
    if (!authenticatedUser) {
      console.log(`\n❌ No valid credentials found for user ${user_id} across all databases`);
      
      // Provide specific error message
      const hasPasswordMatch = userCandidates.some(c => c.user.password === password);
      const hasInactiveAccount = userCandidates.some(c => c.user.status !== "active");
      const hasExpiredAccount = userCandidates.some(c => {
        if (!c.user.expiry_date) return false;
        const expiryDate = new Date(c.user.expiry_date);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return expiryDate < today;
      });
      const hasClassMismatch = userCandidates.some(c => {
        let userPrimaryDbName = c.user.primary_class;
        if (dbClassMapping[c.user.primary_class]) {
          userPrimaryDbName = dbClassMapping[c.user.primary_class];
        }
        return userPrimaryDbName !== payroll_class;
      });
      
      if (hasExpiredAccount && hasPasswordMatch) {
        return res.status(403).json({ error: "Account has expired. Please contact administrator." });
      } else if (hasInactiveAccount && hasPasswordMatch) {
        return res.status(403).json({ error: "Account is inactive or suspended" });
      } else if (hasClassMismatch && hasPasswordMatch) {
        return res.status(403).json({ 
          error: "Unauthorized payroll class selection. You can only login to your assigned class." 
        });
      } else {
        return res.status(401).json({ error: "Invalid User ID or password" });
      }
    }

    // Switch to user's assigned database (their primary_class)
    pool.useDatabase(payroll_class);

    // Generate JWT token
    const token = jwt.sign(
      {
        user_id: authenticatedUser.user_id,
        full_name: authenticatedUser.full_name,
        role: authenticatedUser.user_role,
        primary_class: authenticatedUser.primary_class,
        current_class: payroll_class,
        created_in: authenticatedDatabase
      },
      JWT_SECRET,
      { expiresIn: "8h" }
    );

    console.log(`\n✅ Login successful for user ${user_id} from ${authenticatedDatabase}`);

    res.json({
      message: "✅ Login successful",
      token,
      user: {
        user_id: authenticatedUser.user_id,
        full_name: authenticatedUser.full_name,
        email: authenticatedUser.email,
        role: authenticatedUser.user_role,
        status: authenticatedUser.status,
        primary_class: authenticatedUser.primary_class,
        current_class: payroll_class
      }
    });

  } catch (err) {
    console.error("❌ Login error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

//  Get all users
router.get('/', verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT * FROM users ORDER BY full_name ASC
    `);
    res.json(rows);
  } catch (err) {
    console.error('❌ Error fetching users:', err);
    res.status(500).json({ error: 'Database error' });
  }
});


// Get single user by ID
router.get('/:id', verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT * FROM users u
      WHERE u.user_id = ?
    `, [req.params.id]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error('❌ Error fetching user:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

//  Create user
router.post('/', verifyToken, async (req, res) => {
  const { user_id, fullName, payroll_class, email, role, status, phone, password, expiryDate } = req.body;

  try {
    // Required field validation
    if (!user_id || !fullName || !email || !role || !payroll_class) {
      return res.status(400).json({ error: 'User ID, Payroll Class, full name, email, and role are required' });
    }

    // Status validation
    const validStatuses = ['active', 'inactive', 'suspended'];
    const userStatus = status || 'active'; // Default to 'active' if not provided
    
    if (!validStatuses.includes(userStatus)) {
      return res.status(400).json({ 
        error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` 
      });
    }

    // Expiry date validation
    if (expiryDate) {
      const expiry = new Date(expiryDate);
      if (isNaN(expiry.getTime())) {
        return res.status(400).json({ error: 'Invalid expiry date format' });
      }
      
      // Optional: Check if expiry date is in the past
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (expiry < today) {
        return res.status(400).json({ 
          error: 'Expiry date cannot be in the past' 
        });
      }
    }

    const [] = await pool.query(
      `INSERT INTO users (user_id, full_name, primary_class, email, user_role, status, phone_number, password, expiry_date) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [user_id, fullName, payroll_class, email, role, userStatus, phone, password, expiryDate || null]
    );

    res.status(201).json({ message: '✅ User created', user_id });
  } catch (err) {
    console.error('❌ Error creating user:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Update user
router.put('/:user_id', verifyToken, async (req, res) => {
  const {payroll_class, full_name, email, user_role, status, phone_number, password, expiry_date } = req.body;

  try {
    // Status validation if provided
    if (typeof status !== 'undefined') {
      const validStatuses = ['active', 'inactive', 'suspended'];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ 
          error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` 
        });
      }
    }

    // Expiry date validation if provided
    if (typeof expiry_date !== 'undefined' && expiry_date !== null && expiry_date !== '') {
      const expiry = new Date(expiry_date);
      if (isNaN(expiry.getTime())) {
        return res.status(400).json({ error: 'Invalid expiry date format' });
      }
      
      // Optional: Check if expiry date is in the past
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (expiry < today) {
        return res.status(400).json({ 
          error: 'Expiry date cannot be in the past' 
        });
      }
    }

    const sets = [];
    const params = [];

    if (typeof full_name !== 'undefined') {
      sets.push('full_name = ?'); params.push(full_name);
    }
    if (typeof email !== 'undefined') {
      sets.push('email = ?'); params.push(email);
    }
    if (typeof user_role !== 'undefined') {
      sets.push('user_role = ?'); params.push(user_role);
    }
    if (typeof status !== 'undefined') {
      sets.push('status = ?'); params.push(status);
    }
    if (typeof phone_number !== 'undefined') {
      sets.push('phone_number = ?'); params.push(phone_number);
    }
    if (typeof expiry_date !== 'undefined') {
      // Allow setting to null to remove expiry date
      sets.push('expiry_date = ?'); 
      params.push(expiry_date === '' ? null : expiry_date);
    }
    if (typeof payroll_class !== 'undefined') {
      sets.push('primary_class = ?'); params.push(payroll_class);
    }

    // Only include password when a non-empty value is provided
    if (typeof password !== 'undefined' && password !== '') {
      sets.push('password = ?'); params.push(password);
    }

    if (sets.length === 0) {
      return res.status(400).json({ error: 'No updatable fields provided' });
    }

    const sql = `UPDATE users SET ${sets.join(', ')} WHERE user_id = ?`;
    params.push(req.params.user_id);

    const [result] = await pool.query(sql, params);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'User not found' });

    // return updated row for frontend to update UI and show success reliably
    const [rows] = await pool.query('SELECT * FROM users WHERE user_id = ?', [req.params.user_id]);
    res.json({ message: 'User updated', user: rows[0] });
  } catch (err) {
    console.error('❌ Error updating user:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

//  Delete user
router.delete('/:user_id', verifyToken, async (req, res) => {
  try {
    const [result] = await pool.query('DELETE FROM users WHERE user_id = ?', [req.params.user_id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ message: '✅ User deleted', user_id: req.params.user_id });
  } catch (err) {
    console.error('❌ Error deleting user:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// ============================================
// FORGOT PASSWORD ROUTESs
// ============================================

// Verify user identity for password reset
router.post("/verify-identity", async (req, res) => {
  const { user_id, full_name, email, primary_class } = req.body;
  
  try {
    // Validation
    if (!user_id || !full_name || !email) {
      return res.status(400).json({ 
        error: "User ID, Full Name, and Email are required for verification" 
      });
    }

    const userCandidates = [];
    let databasesToSearch = [];
    let dbClassMapping = {};
    
    // Get databases to search
    try {
      pool.useDatabase(process.env.DB_OFFICERS);
      const [dbClasses] = await pool.query("SELECT db_name, classname FROM py_payrollclass");
      
      const otherDatabases = dbClasses.map(row => row.db_name).filter(db => db !== process.env.DB_OFFICERS);
      databasesToSearch = [process.env.DB_OFFICERS, ...otherDatabases];
      
      // Create bidirectional mapping
      dbClasses.forEach(row => {
        dbClassMapping[row.db_name] = row.display_name;
        dbClassMapping[row.display_name] = row.db_name;
      });
      
    } catch (err) {
      console.log("⚠️ Could not fetch db_classes, using fallback list");
      databasesToSearch = [
        process.env.DB_OFFICERS,
        process.env.DB_WOFFICERS,
        process.env.DB_RATINGS,
        process.env.DB_RATINGS_A,
        process.env.DB_RATINGS_B,
        process.env.DB_JUNIOR_TRAINEE
      ];
    }

    // Search for user in ALL databases
    for (const dbName of databasesToSearch) {
      if (!dbName) continue;
      
      try {
        console.log(`🔍 Searching for user ${user_id} in database: ${dbName}`);
        pool.useDatabase(dbName);
        
        const [rows] = await pool.query(
          "SELECT * FROM users WHERE user_id = ?",
          [user_id]
        );
        
        if (rows.length > 0) {
          userCandidates.push({
            user: rows[0],
            database: dbName
          });
          console.log(`✅ User found in database: ${dbName}`);
        }
      } catch (err) {
        console.log(`❌ Error searching database ${dbName}:`, err.message);
        continue;
      }
    }

    if (userCandidates.length === 0) {
      console.log(`❌ User ${user_id} not found in any database`);
      return res.status(404).json({ error: "User not found. Please check your User ID." });
    }

    console.log(`\n📊 Found ${userCandidates.length} instance(s) of user ${user_id}`);

    // Now verify identity with ALL provided fields
    let verifiedUser = null;
    let verifiedDatabase = null;

    for (const candidate of userCandidates) {
      const { user, database } = candidate;
      
      console.log(`\n🔐 Verifying identity for user in ${database}:`);
      console.log(`   Provided - Name: ${full_name}, Email: ${email}, Class: ${primary_class || 'not provided'}`);
      console.log(`   Database - Name: ${user.full_name}, Email: ${user.email}, Class: ${user.primary_class}`);

      // Check all provided fields match
      const nameMatches = user.full_name?.toLowerCase().trim() === full_name.toLowerCase().trim();
      const emailMatches = user.email?.toLowerCase().trim() === email.toLowerCase().trim();
      
      // Handle primary_class matching (could be display_name or db_name)
      let classMatches = true; // Default true if not provided
      if (primary_class) {
        let userPrimaryDbName = user.primary_class;
        let providedDbName = primary_class;
        
        // Convert display_name to db_name if needed
        if (dbClassMapping[user.primary_class]) {
          userPrimaryDbName = dbClassMapping[user.primary_class];
        }
        if (dbClassMapping[primary_class]) {
          providedDbName = dbClassMapping[primary_class];
        }
        
        classMatches = userPrimaryDbName === providedDbName;
      }

      console.log(`   Match Results - Name: ${nameMatches}, Email: ${emailMatches}, Class: ${classMatches}`);

      // All provided fields must match
      if (nameMatches && emailMatches && classMatches) {
        verifiedUser = user;
        verifiedDatabase = database;
        console.log(`✅ Identity verified in ${database}!`);
        break;
      } else {
        console.log(`❌ Identity verification failed in ${database}:`);
        if (!nameMatches) console.log(`   - Full name mismatch`);
        if (!emailMatches) console.log(`   - Email mismatch`);
        if (!classMatches) console.log(`   - Payroll class mismatch`);
      }
    }

    if (!verifiedUser) {
      console.log(`\n❌ Identity verification failed for user ${user_id}`);
      
      // Provide specific error messages about which fields are incorrect
      const incorrectFields = [];
      
      for (const candidate of userCandidates) {
        const { user } = candidate;
        
        const nameMatches = user.full_name?.toLowerCase().trim() === full_name.toLowerCase().trim();
        const emailMatches = user.email?.toLowerCase().trim() === email.toLowerCase().trim();
        
        if (!nameMatches) incorrectFields.push('Full Name');
        if (!emailMatches) incorrectFields.push('Email');
        
        if (primary_class) {
          let userPrimaryDbName = user.primary_class;
          let providedDbName = primary_class;
          
          if (dbClassMapping[user.primary_class]) {
            userPrimaryDbName = dbClassMapping[user.primary_class];
          }
          if (dbClassMapping[primary_class]) {
            providedDbName = dbClassMapping[primary_class];
          }
          
          const classMatches = userPrimaryDbName === providedDbName;
          if (!classMatches) incorrectFields.push('Payroll Class');
        }
      }
      
      // Remove duplicates
      const uniqueIncorrectFields = [...new Set(incorrectFields)];
      
      let errorMessage = "Identity verification failed. ";
      if (uniqueIncorrectFields.length > 0) {
        errorMessage += `Incorrect: ${uniqueIncorrectFields.join(', ')}. Please check and try again.`;
      } else {
        errorMessage += "Please check your information and try again.";
      }
      
      return res.status(401).json({ error: errorMessage });
    }

    // Check if account is active
    if (verifiedUser.status !== "active") {
      return res.status(403).json({ 
        error: "Account is not active. Please contact administrator." 
      });
    }

    console.log(`\n✅ Identity verified for user ${user_id} in ${verifiedDatabase}`);

    // Return success with user info (but NO password!)
    res.json({
      message: "Identity verified successfully",
      user: {
        user_id: verifiedUser.user_id,
        full_name: verifiedUser.full_name,
        email: verifiedUser.email,
        primary_class: verifiedUser.primary_class,
        database: verifiedDatabase
      }
    });

  } catch (err) {
    console.error("❌ Identity verification error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// Reset password after identity verification
router.post("/reset-password", async (req, res) => {
  const { user_id, full_name, email, new_password, primary_class } = req.body;
  
  try {
    // Validation
    if (!user_id || !full_name || !email || !new_password) {
      return res.status(400).json({ 
        error: "All fields are required" 
      });
    }

    // Password validation
    if (new_password.length < 6) {
      return res.status(400).json({ 
        error: "Password must be at least 6 characters long" 
      });
    }

    const userCandidates = [];
    let databasesToSearch = [];
    let dbClassMapping = {};
    
    // Get databases to search
    try {
      pool.useDatabase(process.env.DB_OFFICERS);
      const [dbClasses] = await pool.query("SELECT db_name, classname FROM py_payrollclass");
      
      const otherDatabases = dbClasses.map(row => row.db_name).filter(db => db !== process.env.DB_OFFICERS);
      databasesToSearch = [process.env.DB_OFFICERS, ...otherDatabases];
      
      // Create bidirectional mapping
      dbClasses.forEach(row => {
        dbClassMapping[row.db_name] = row.display_name;
        dbClassMapping[row.display_name] = row.db_name;
      });
      
    } catch (err) {
      console.log("⚠️ Could not fetch db_classes, using fallback list");
      databasesToSearch = [
        process.env.DB_OFFICERS,
        process.env.DB_WOFFICERS,
        process.env.DB_RATINGS,
        process.env.DB_RATINGS_A,
        process.env.DB_RATINGS_B,
        process.env.DB_JUNIOR_TRAINEE
      ];
    }

    // Search for user in ALL databases
    for (const dbName of databasesToSearch) {
      if (!dbName) continue;
      
      try {
        pool.useDatabase(dbName);
        
        const [rows] = await pool.query(
          "SELECT * FROM users WHERE user_id = ?",
          [user_id]
        );
        
        if (rows.length > 0) {
          userCandidates.push({
            user: rows[0],
            database: dbName
          });
        }
      } catch (err) {
        continue;
      }
    }

    if (userCandidates.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    // Verify identity again before reset
    let verifiedUser = null;
    let verifiedDatabase = null;

    for (const candidate of userCandidates) {
      const { user, database } = candidate;
      
      const nameMatches = user.full_name?.toLowerCase().trim() === full_name.toLowerCase().trim();
      const emailMatches = user.email?.toLowerCase().trim() === email.toLowerCase().trim();
      
      let classMatches = true;
      if (primary_class) {
        let userPrimaryDbName = user.primary_class;
        let providedDbName = primary_class;
        
        if (dbClassMapping[user.primary_class]) {
          userPrimaryDbName = dbClassMapping[user.primary_class];
        }
        if (dbClassMapping[primary_class]) {
          providedDbName = dbClassMapping[primary_class];
        }
        
        classMatches = userPrimaryDbName === providedDbName;
      }

      if (nameMatches && emailMatches && classMatches) {
        verifiedUser = user;
        verifiedDatabase = database;
        break;
      }
    }

    if (!verifiedUser) {
      // Provide specific error messages about which fields are incorrect
      const incorrectFields = [];
      
      for (const candidate of userCandidates) {
        const { user } = candidate;
        
        const nameMatches = user.full_name?.toLowerCase().trim() === full_name.toLowerCase().trim();
        const emailMatches = user.email?.toLowerCase().trim() === email.toLowerCase().trim();
        
        if (!nameMatches) incorrectFields.push('Full Name');
        if (!emailMatches) incorrectFields.push('Email');
        
        if (primary_class) {
          let userPrimaryDbName = user.primary_class;
          let providedDbName = primary_class;
          
          if (dbClassMapping[user.primary_class]) {
            userPrimaryDbName = dbClassMapping[user.primary_class];
          }
          if (dbClassMapping[primary_class]) {
            providedDbName = dbClassMapping[primary_class];
          }
          
          const classMatches = userPrimaryDbName === providedDbName;
          if (!classMatches) incorrectFields.push('Payroll Class');
        }
      }
      
      // Remove duplicates
      const uniqueIncorrectFields = [...new Set(incorrectFields)];
      
      let errorMessage = "Identity verification failed. ";
      if (uniqueIncorrectFields.length > 0) {
        errorMessage += `Incorrect: ${uniqueIncorrectFields.join(', ')}. Please check and try again.`;
      } else {
        errorMessage += "Please check your information and try again.";
      }
      
      return res.status(401).json({ error: errorMessage });
    }

    // Update password in the correct database
    pool.useDatabase(verifiedDatabase);
    
    const [result] = await pool.query(
      "UPDATE users SET password = ? WHERE user_id = ?",
      [new_password, user_id]
    );

    if (result.affectedRows === 0) {
      return res.status(500).json({ error: "Failed to update password" });
    }

    console.log(`✅ Password reset successful for user ${user_id} in ${verifiedDatabase}`);

    res.json({
      message: "✅ Password reset successfully",
      user_id: user_id
    });

  } catch (err) {
    console.error("❌ Password reset error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;


