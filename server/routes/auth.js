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
        { id: result.lastInsertRowid, email },
        process.env.JWT_SECRET,
        { expiresIn: TOKEN_EXPIRY }
    );

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
        { id: user.id, email: user.email },
        process.env.JWT_SECRET,
        { expiresIn: TOKEN_EXPIRY }
    );

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
router.get('/me', auth, (req, res) => {
    const user = db.prepare('SELECT id, name, email, balance, created_at FROM users WHERE id = ?').get(req.user.id);
    if (!user) {
        return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
    }
    res.json({ user });
});

module.exports = router;
