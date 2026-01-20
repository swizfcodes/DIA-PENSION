const fs = require('fs');
const path = require('path');

// Define notifications directory
const NOTIFICATIONS_DIR = path.join(__dirname, '../notifications');

// Ensure notifications directory exists
if (!fs.existsSync(NOTIFICATIONS_DIR)) {
  fs.mkdirSync(NOTIFICATIONS_DIR, { recursive: true });
}

// Middleware to auto-capture notifications from responses
function notificationMiddleware(req, res, next) {
  // Store original json method
  const originalJson = res.json.bind(res);
  
  // Override res.json to intercept responses
  res.json = function(data) {
    // Only process POST, PUT, DELETE requests
    const method = req.method;
    if (['POST', 'PUT', 'DELETE'].includes(method)) {
      
      // Check if response has a 'message' field
      if (data && data.message && req.user_id && req.current_class) {
        const userId = req.user_id;
        const dbName = req.current_class;
        const message = data.message;
        const url = req.originalUrl || req.url;
        
        // Determine notification type based on status code
        let type = 'info';
        if (res.statusCode >= 200 && res.statusCode < 300) {
          type = 'success';
        } else if (res.statusCode >= 400 && res.statusCode < 500) {
          type = 'warning';
        } else if (res.statusCode >= 500) {
          type = 'error';
        }
        
        // Save notification asynchronously (don't block response)
        setImmediate(() => {
          saveNotificationToFile(userId, dbName, type, message, method, url);
        });
      }
    }
    
    // Call original json method
    return originalJson(data);
  };
  
  next();
}

// Helper function to save notification to file
function saveNotificationToFile(userId, dbName, type, message, method, url) {
  try {
    const notificationFile = path.join(NOTIFICATIONS_DIR, `${userId}_${dbName}.json`);
    
    const notification = {
      id: `notif-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type: type,
      message: message,
      method: method,
      url: url,
      timestamp: Date.now(),
      count: 1
    };
    
    let notifications = [];
    
    // Read existing notifications if file exists
    if (fs.existsSync(notificationFile)) {
      const fileContent = fs.readFileSync(notificationFile, 'utf8');
      notifications = JSON.parse(fileContent);
    }
    
    // Check for duplicate within last 60 seconds
    const existingIndex = notifications.findIndex(n => 
      n.message === message && 
      (Date.now() - n.timestamp) < 60000
    );
    
    if (existingIndex !== -1) {
      // Update count
      notifications[existingIndex].count = (notifications[existingIndex].count || 1) + 1;
      notifications[existingIndex].timestamp = Date.now();
    } else {
      // Add new notification
      notifications.unshift(notification);
    }
    
    // Keep only last 100 notifications
    if (notifications.length > 100) {
      notifications = notifications.slice(0, 100);
    }
    
    // Write back to file
    fs.writeFileSync(notificationFile, JSON.stringify(notifications, null, 2), 'utf8');
    
    console.log(`✅ Auto-saved notification for ${userId}: ${message}`);
  } catch (error) {
    console.error('Failed to save notification:', error);
  }
}

module.exports = { 
  notificationMiddleware,
  NOTIFICATIONS_DIR
};


