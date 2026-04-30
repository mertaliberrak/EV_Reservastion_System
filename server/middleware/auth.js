/**
 * EVCharge — JWT Doğrulama Middleware
 * Authorization: Bearer <token> header'ından token alır ve doğrular.
 */

const jwt = require('jsonwebtoken');

function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // "Bearer TOKEN"

    if (!token) {
        return res.status(401).json({ error: 'Erişim reddedildi. Token gerekli.' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        // Sunucu restart kontrolü
        if (decoded.sessionId !== req.app.get('serverSessionId')) {
            return res.status(401).json({ error: 'Oturum sunucu değişikliği nedeniyle sonlandırıldı. Lütfen tekrar giriş yapın.' });
        }

        req.user = decoded; // { id, email, sessionId, iat, exp }
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Geçersiz veya süresi dolmuş token.' });
    }
}

module.exports = authenticateToken;
