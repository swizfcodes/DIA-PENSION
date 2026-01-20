// routes/preferences.js
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const verifyToken = require('../../middware/authentication');

// Define preferences directory
const PREFERENCES_DIR = path.join(__dirname, '../../preferences');

// Ensure preferences directory exists
if (!fs.existsSync(PREFERENCES_DIR)) {
  fs.mkdirSync(PREFERENCES_DIR, { recursive: true });
}

// Get user's quick access preferences
router.get('/', verifyToken, (req, res) => {
  const userId = req.user_id;
  
  const preferencesFile = path.join(PREFERENCES_DIR, `${userId}_preferences.json`);
  
  if (!fs.existsSync(preferencesFile)) {
    return res.json({
      success: true,
      quickAccess: null // Will trigger frontend to use role defaults
    });
  }
  
  try {
    const fileContent = fs.readFileSync(preferencesFile, 'utf8');
    const preferences = JSON.parse(fileContent);
    
    res.json({
      success: true,
      quickAccess: preferences.quickAccess || null
    });
  } catch (error) {
    console.error('Failed to read preferences:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to load preferences'
    });
  }
});

// Save user's quick access preferences
router.post('/save', verifyToken, (req, res) => {
  const userId = req.user_id;
  const { quickAccess } = req.body;
  
  // Validate input
  if (!Array.isArray(quickAccess) || quickAccess.length !== 6) {
    return res.status(400).json({
      success: false,
      error: 'Quick access must be an array of exactly 6 items'
    });
  }
  
  const preferencesFile = path.join(PREFERENCES_DIR, `${userId}_preferences.json`);
  
  try {
    let preferences = {};
    
    // Read existing preferences if file exists
    if (fs.existsSync(preferencesFile)) {
      const fileContent = fs.readFileSync(preferencesFile, 'utf8');
      preferences = JSON.parse(fileContent);
    }
    
    // Update quick access
    preferences.quickAccess = quickAccess;
    preferences.updatedAt = Date.now();
    
    // Write back to file
    fs.writeFileSync(preferencesFile, JSON.stringify(preferences, null, 2), 'utf8');
    
    console.log(`✅ Saved quick access preferences for user ${userId}`);
    
    res.json({
      success: true,
      //message: 'Quick access preferences saved'
    });
  } catch (error) {
    console.error('Failed to save preferences:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to save preferences'
    });
  }
});

// Reset user's quick access to defaults (optional - can delete from frontend)
router.delete('/delete', verifyToken, (req, res) => {
  const userId = req.user_id;
  
  const preferencesFile = path.join(PREFERENCES_DIR, `${userId}_preferences.json`);
  
  try {
    if (fs.existsSync(preferencesFile)) {
      const fileContent = fs.readFileSync(preferencesFile, 'utf8');
      const preferences = JSON.parse(fileContent);
      
      // Remove quick access but keep other preferences
      delete preferences.quickAccess;
      
      if (Object.keys(preferences).length > 0) {
        fs.writeFileSync(preferencesFile, JSON.stringify(preferences, null, 2), 'utf8');
      } else {
        // If no other preferences, delete the file
        fs.unlinkSync(preferencesFile);
      }
    }
    
    res.json({
      success: true,
      message: 'Quick access preferences reset'
    });
  } catch (error) {
    console.error('Failed to reset preferences:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to reset preferences'
    });
  }
});

// Get sidebar state
router.get('/sidebar', verifyToken, (req, res) => {
  const userId = req.user_id;
  const preferencesFile = path.join(PREFERENCES_DIR, `${userId}_preferences.json`);
  
  if (!fs.existsSync(preferencesFile)) {
    return res.json({
      success: true,
      sidebarCollapsed: false // Default: expanded
    });
  }
  
  try {
    const fileContent = fs.readFileSync(preferencesFile, 'utf8');
    const preferences = JSON.parse(fileContent);
    
    res.json({
      success: true,
      sidebarCollapsed: preferences.sidebarCollapsed || false
    });
  } catch (error) {
    console.error('Failed to read sidebar state:', error);
    res.status(500).json({ success: false, error: 'Failed to load sidebar state' });
  }
});

// Save sidebar state
router.post('/sidebar/save', verifyToken, (req, res) => {
  const userId = req.user_id;
  const { sidebarCollapsed } = req.body;
  const preferencesFile = path.join(PREFERENCES_DIR, `${userId}_preferences.json`);
  
  try {
    let preferences = {};
    
    if (fs.existsSync(preferencesFile)) {
      const fileContent = fs.readFileSync(preferencesFile, 'utf8');
      preferences = JSON.parse(fileContent);
    }
    
    preferences.sidebarCollapsed = sidebarCollapsed;
    preferences.updatedAt = Date.now();
    
    fs.writeFileSync(preferencesFile, JSON.stringify(preferences, null, 2), 'utf8');
    
    res.json({ success: true });
  } catch (error) {
    console.error('Failed to save sidebar state:', error);
    res.status(500).json({ success: false, error: 'Failed to save sidebar state' });
  }
});

module.exports = router;


