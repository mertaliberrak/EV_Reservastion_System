function isAdmin(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ error: 'Access denied. No token found.' });
    }

    if (req.user.is_admin !== 1) {
        return res.status(403).json({ error: 'Access denied. Admin permission required.' });
    }

    next();
}

module.exports = isAdmin;
