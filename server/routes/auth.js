/**
 * EVCharge — Auth Routes
 * POST /api/auth/register — Kayıt ol
 * POST /api/auth/login    — Giriş yap
 * GET  /api/auth/me       — Mevcut kullanıcı bilgisi
 */

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const db = require('../db');
const auth = require('../middleware/auth');
const { logAction } = require('../utils/auditLogger');

const SALT_ROUNDS = 10;
const TOKEN_EXPIRY = '24h';

// ══════════════════════════════════════
//  POST /api/auth/register
// ══════════════════════════════════════
router.post('/register', [
    body('name').trim().notEmpty().withMessage('İsim gereklidir.'),
    body('email').isEmail().normalizeEmail().withMessage('Geçerli bir e-posta adresi giriniz.'),
    body('password')
        .isLength({ min: 6 }).withMessage('Şifre en az 6 karakter olmalıdır.')
        .matches(/[A-Z]/).withMessage('Şifre en az bir büyük harf içermelidir.')
        .matches(/[^a-zA-Z0-9]/).withMessage('Şifre en az bir özel karakter içermelidir.'),
], (req, res) => {
    // Validasyon hataları
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
    }

    const { name, email, password } = req.body;

    // E-posta kontrolü
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) {
        return res.status(409).json({ error: 'Bu e-posta adresi zaten kayıtlı.' });
    }

    // Şifreyi hash'le
    const passwordHash = bcrypt.hashSync(password, SALT_ROUNDS);

    // Kullanıcıyı kaydet
    const result = db.prepare(
        'INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)'
    ).run(name, email, passwordHash);

    // JWT token oluştur
    const token = jwt.sign(
        { id: result.lastInsertRowid, email, is_admin: 0, sessionId: req.app.get('serverSessionId') },
        process.env.JWT_SECRET,
        { expiresIn: TOKEN_EXPIRY }
    );

    // Audit log
    logAction(result.lastInsertRowid, 'REGISTER', { email }, req.ip);

    res.status(201).json({
        message: 'Kayıt başarılı.',
        token,
        user: {
            id: result.lastInsertRowid,
            name,
            email,
        },
    });
});

// ══════════════════════════════════════
//  POST /api/auth/login
// ══════════════════════════════════════
router.post('/login', [
    body('email').isEmail().normalizeEmail().withMessage('Geçerli bir e-posta adresi giriniz.'),
    body('password').notEmpty().withMessage('Şifre gereklidir.'),
], (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
    }

    const { email, password } = req.body;

    // Kullanıcıyı bul
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user) {
        return res.status(401).json({ error: 'Bu e-posta ile kayıtlı kullanıcı bulunamadı.' });
    }

    // Şifre kontrolü
    const valid = bcrypt.compareSync(password, user.password_hash);
    if (!valid) {
        return res.status(401).json({ error: 'Şifre hatalı.' });
    }

    // JWT token oluştur
    const token = jwt.sign(
        { id: user.id, email: user.email, is_admin: user.is_admin, sessionId: req.app.get('serverSessionId') },
        process.env.JWT_SECRET,
        { expiresIn: TOKEN_EXPIRY }
    );

    // Audit log
    logAction(user.id, 'LOGIN', { email }, req.ip);

    res.json({
        message: 'Giriş başarılı.',
        token,
        user: {
            id: user.id,
            name: user.name,
            email: user.email,
        },
    });
});

// ══════════════════════════════════════
//  GET /api/auth/me
// ══════════════════════════════════════
// ══════════════════════════════════════
//  GET /api/auth/me
// ══════════════════════════════════════
router.get('/me', auth, (req, res) => {
    const user = db.prepare('SELECT id, name, email, balance, is_admin, created_at FROM users WHERE id = ?').get(req.user.id);
    if (!user) {
        return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
    }
    res.json({ user });
});

// ══════════════════════════════════════
//  POST /api/auth/forgot-password
// ══════════════════════════════════════
router.post('/forgot-password', [
    body('email').isEmail().normalizeEmail().withMessage('Geçerli bir e-posta adresi giriniz.')
], (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
    }

    const { email } = req.body;
    const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email);

    if (!user) {
        // Güvenlik gereği "kullanıcı bulunamadı" demek yerine aynı mesajı dönmek best-practice'tir
        // Ancak demo/test aşamasında olduğumuz için hata verebiliriz.
        return res.status(404).json({ error: 'Bu e-posta adresine ait bir hesap bulunamadı.' });
    }

    // 6 haneli rastgele kod oluştur
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Geçerlilik süresi (15 dakika)
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    db.prepare('INSERT INTO password_resets (email, code, expires_at) VALUES (?, ?, ?)')
      .run(email, code, expiresAt);

    logAction(user.id, 'PASSWORD_RESET_REQUESTED', { email }, req.ip);

    // DEMO AŞAMASINDA OLDUĞUMUZ İÇİN MAİL ATMIYORUZ, DOĞRUDAN CEVAP İÇİNDE KODU DÖNÜYORUZ
    res.json({ 
        message: 'Şifre sıfırlama kodu oluşturuldu.',
        demo_code: code // NOT: Gerçek projede bu frontend'e dönülmez, e-posta olarak atılır!
    });
});

// ══════════════════════════════════════
//  POST /api/auth/reset-password
// ══════════════════════════════════════
router.post('/reset-password', [
    body('email').isEmail().normalizeEmail().withMessage('Geçerli bir e-posta adresi giriniz.'),
    body('code').notEmpty().withMessage('Doğrulama kodu gereklidir.'),
    body('newPassword')
        .isLength({ min: 6 }).withMessage('Şifre en az 6 karakter olmalıdır.')
        .matches(/[A-Z]/).withMessage('Şifre en az bir büyük harf içermelidir.')
        .matches(/[^a-zA-Z0-9]/).withMessage('Şifre en az bir özel karakter içermelidir.')
], (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
    }

    const { email, code, newPassword } = req.body;

    const resetRecord = db.prepare(
        'SELECT * FROM password_resets WHERE email = ? AND code = ? AND used = 0 ORDER BY created_at DESC LIMIT 1'
    ).get(email, code);

    if (!resetRecord) {
        return res.status(400).json({ error: 'Geçersiz doğrulama kodu.' });
    }

    const now = new Date();
    const expiresAt = new Date(resetRecord.expires_at);

    if (now > expiresAt) {
        return res.status(400).json({ error: 'Bu doğrulama kodunun süresi dolmuş.' });
    }

    // Kod geçerli, şifreyi güncelle
    const passwordHash = bcrypt.hashSync(newPassword, SALT_ROUNDS);
    
    db.transaction(() => {
        // Şifreyi güncelle
        db.prepare('UPDATE users SET password_hash = ? WHERE email = ?').run(passwordHash, email);
        // Kodu kullanıldı olarak işaretle
        db.prepare('UPDATE password_resets SET used = 1 WHERE id = ?').run(resetRecord.id);
    })();

    const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (user) {
        logAction(user.id, 'PASSWORD_RESET_SUCCESSFUL', { email }, req.ip);
    }

    res.json({ message: 'Şifreniz başarıyla sıfırlandı. Yeni şifrenizle giriş yapabilirsiniz.' });
});

module.exports = router;
