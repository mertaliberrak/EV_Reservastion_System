const db = require('../db');

/**
 * Log an action to the audit_logs table
 * @param {Number|null} userId - ID of the user performing the action
 * @param {String} action - The action performed (e.g. 'LOGIN', 'RESERVATION', 'PAYMENT')
 * @param {Object|String} details - Additional details about the action
 * @param {String} ipAddress - The IP address of the user
 */
function logAction(userId, action, details, ipAddress = null) {
    try {
        const stmt = db.prepare(`
            INSERT INTO audit_logs (user_id, action, details, ip_address)
            VALUES (?, ?, ?, ?)
        `);
        
        const detailsStr = typeof details === 'object' ? JSON.stringify(details) : details;
        stmt.run(userId, action, detailsStr, ipAddress);
    } catch (err) {
        console.error('Audit log error:', err);
    }
}

module.exports = { logAction };
