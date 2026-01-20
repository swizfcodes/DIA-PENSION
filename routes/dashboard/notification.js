const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const verifyToken  = require('../../middware/authentication');
const { NOTIFICATIONS_DIR } = require('../../middware/notifications');

// Get notifications for current user
router.get('/', verifyToken, (req, res) => {
  const userId = req.user_id;
  const dbName = req.current_class;
  
  const notificationFile = path.join(NOTIFICATIONS_DIR, `${userId}_${dbName}.json`);
  
  if (!fs.existsSync(notificationFile)) {
    return res.json({
      success: true,
      notifications: []
    });
  }
  
  try {
    const fileContent = fs.readFileSync(notificationFile, 'utf8');
    const notifications = JSON.parse(fileContent);
    
    // Sort by timestamp (newest first)
    notifications.sort((a, b) => b.timestamp - a.timestamp);
    
    res.json({
      success: true,
      notifications: notifications.slice(0, 50)
    });
  } catch (error) {
    console.error('Failed to read notifications:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to load notifications'
    });
  }
});

// Clear notifications for current user
router.delete('/delete', verifyToken, (req, res) => {
  const userId = req.user_id;
  const dbName = req.current_class;
  
  const notificationFile = path.join(NOTIFICATIONS_DIR, `${userId}_${dbName}.json`);
  
  try {
    if (fs.existsSync(notificationFile)) {
      fs.unlinkSync(notificationFile);
    }
    res.json({ 
      success: true, 
      //message: 'All notifications cleared' 
    });
  } catch (error) {
    console.error('Failed to clear notifications:', error);
    res.status(500).json({ 
      success: false, 
      //error: 'Failed to clear notifications' 
    });
  }
});

// DELETE a single notification by its ID
router.delete('/delete/:notificationId', verifyToken, (req, res) => {
  const userId = req.user_id;
  const dbName = req.current_class;
  const notificationIdToDelete = req.params.notificationId; // Get the ID from the URL parameter

  // Construct the unique file path for the user's notifications
  const notificationFile = path.join(NOTIFICATIONS_DIR, `${userId}_${dbName}.json`);

  try {
    // Check if the file exists before attempting to read it
    if (!fs.existsSync(notificationFile)) {
      return res.status(404).json({
        success: false,
        error: 'No notifications file found for this user.'
      });
    }

    const data = fs.readFileSync(notificationFile, 'utf8');
    let notifications = JSON.parse(data);

    if (!Array.isArray(notifications)) {
        notifications = [];
    }


    const initialLength = notifications.length;
    const updatedNotifications = notifications.filter(
      (notification) => notification.id.toString() !== notificationIdToDelete.toString()
    );

    // Check if a notification was actually removed
    if (updatedNotifications.length === initialLength) {
      return res.status(404).json({
        success: false,
        error: `Notification with ID ${notificationIdToDelete} not found.`
      });
    }

    fs.writeFileSync(notificationFile, JSON.stringify(updatedNotifications, null, 2));

    res.json({
      success: true,
      //message: `Notification with ID ${notificationIdToDelete} deleted successfully.`,
      deletedCount: initialLength - updatedNotifications.length
    });
  } catch (error) {
    console.error('Failed to delete single notification:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete single notification due to a server error.'
    });
  }
});

module.exports = router;


