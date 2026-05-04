function isOperatorOrAdmin(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ error: 'Erişim reddedildi. Token bulunamadı.' });
    }

    if (req.user.is_admin !== 1 && req.user.is_operator !== 1) {
        return res.status(403).json({ error: 'Erişim reddedildi. Operatör veya Yönetici yetkisi gereklidir.' });
    }

    next();
}

module.exports = isOperatorOrAdmin;
