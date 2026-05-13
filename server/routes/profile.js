const express = require('express');
const router = express.Router();
const db = require('../db');
const bcrypt = require('bcryptjs');
const auth = require('../middleware/auth');
const { logAction } = require('../utils/auditLogger');
const { createNotification } = require('../utils/notificationHelper');

router.use(auth);

// GET /api/profile
// Kullanıcı bilgilerini (şifre hariç) getir
router.get('/', (req, res) => {
    try {
        const user = db.prepare('SELECT id, name, email, balance, created_at FROM users WHERE id = ?').get(req.user.id);
        if (!user) return res.status(404).json({ error: 'User not found.' });
        res.json(user);
    } catch (err) {
        res.status(500).json({ error: 'Server error.' });
    }
});

// PUT /api/profile
// Kullanıcı adı ve (opsiyonel) şifre güncelleme
router.put('/', async (req, res) => {
    try {
        const { name, password, oldPassword } = req.body;

        if (!name || name.trim() === '') {
            return res.status(400).json({ error: 'Name field cannot be empty.' });
        }

        if (password) {
            if (!oldPassword) {
                return res.status(400).json({ error: 'You cannot set a new password without entering your current password.' });
            }
            if (password.length < 6) {
                return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
            }

            const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
            const isMatch = await bcrypt.compare(oldPassword, user.password_hash);

            if (!isMatch) {
                return res.status(401).json({ error: 'Current password is incorrect.' });
            }

            const hashedPassword = await bcrypt.hash(password, 10);
            db.prepare('UPDATE users SET name = ?, password_hash = ? WHERE id = ?')
                .run(name.trim(), hashedPassword, req.user.id);
        } else {
            db.prepare('UPDATE users SET name = ? WHERE id = ?')
                .run(name.trim(), req.user.id);
        }

        res.json({ success: true, message: 'Profile updated successfully.' });
    } catch (err) {
        res.status(500).json({ error: 'Server error.' });
    }
});

// GET /api/profile/cards
// Kayıtlı kartları getir
router.get('/cards', (req, res) => {
    try {
        const cards = db.prepare('SELECT * FROM credit_cards WHERE user_id = ?').all(req.user.id);
        res.json(cards);
    } catch (err) {
        res.status(500).json({ error: 'Server error.' });
    }
});

// POST /api/profile/cards
// Yeni kart ekle
router.post('/cards', (req, res) => {
    try {
        const { cardName, cardNumber, expiryDate } = req.body;

        if (!cardName || !cardNumber || !expiryDate) {
            return res.status(400).json({ error: 'All card information is required.' });
        }

        // Kartın sadece son 4 hanesini kaydet (güvenlik için)
        // Kart numarası boşluksuz kabul edilip son 4 hanesi alınabilir
        const cleanNumber = cardNumber.replace(/\D/g, '');
        if (cleanNumber.length < 15) {
            return res.status(400).json({ error: 'Invalid card number.' });
        }

        // Son kullanma tarihi doğrulama (AA/YY ve ay <= 12)
        const expiryRegex = /^(0[1-9]|1[0-2])\/([0-9]{2})$/;
        const match = expiryDate.match(expiryRegex);
        if (!match) {
            return res.status(400).json({ error: 'Invalid expiry date. (Must be in MM/YY format and a valid month)' });
        }

        const expMonth = parseInt(match[1], 10);
        const expYear = parseInt(match[2], 10);
        const currentYear = parseInt(new Date().getFullYear().toString().slice(-2), 10);
        const currentMonth = new Date().getMonth() + 1;

        if (expYear < currentYear || (expYear === currentYear && expMonth < currentMonth)) {
            return res.status(400).json({ error: 'This card has expired.' });
        }

        const maskedNumber = '**** **** **** ' + cleanNumber.slice(-4);

        const info = db.prepare(`
            INSERT INTO credit_cards (user_id, card_name, card_number, expiry_date)
            VALUES (?, ?, ?, ?)
        `).run(req.user.id, cardName, maskedNumber, expiryDate);

        res.status(201).json({ success: true, id: info.lastInsertRowid });
    } catch (err) {
        res.status(500).json({ error: 'Server error.' });
    }
});

// DELETE /api/profile/cards/:id
// Kart sil
router.delete('/cards/:id', (req, res) => {
    try {
        const info = db.prepare('DELETE FROM credit_cards WHERE id = ? AND user_id = ?')
            .run(req.params.id, req.user.id);

        if (info.changes === 0) {
            return res.status(404).json({ error: 'Card not found.' });
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Server error.' });
    }
});

// POST /api/profile/add-funds
// Cüzdana bakiye yükle
router.post('/add-funds', (req, res) => {
    try {
        const { amount, cardId } = req.body;
        const numAmount = Number(amount);

        if (!numAmount || numAmount <= 0) {
            return res.status(400).json({ error: 'Please enter a valid amount.' });
        }

        // Kartın kullanıcıya ait olduğunu doğrula
        const card = db.prepare('SELECT id FROM credit_cards WHERE id = ? AND user_id = ?').get(cardId, req.user.id);
        if (!card) {
            return res.status(400).json({ error: 'Invalid card selection.' });
        }

        // Bakiyeyi güncelle
        db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(numAmount, req.user.id);

        // Audit Log
        logAction(req.user.id, 'PAYMENT', { amount: numAmount, method: 'CREDIT_CARD', cardId }, req.ip);

        // Bildirim oluştur
        createNotification(
            req.user.id,
            'wallet_topup',
            '💰 Balance Added',
            `Your wallet has been successfully topped up with ${numAmount.toFixed(2)} ₺.`
        );

        res.json({ success: true, message: `${numAmount} ₺ successfully added.` });
    } catch (err) {
        res.status(500).json({ error: 'Server error.' });
    }
});

// GET /api/profile/favorites
// Kullanıcının favori istasyonlarını getir
router.get('/favorites', (req, res) => {
    try {
        const favorites = db.prepare(`
            SELECT f.id as favorite_id, s.* 
            FROM favorites f
            JOIN stations s ON f.station_id = s.id
            WHERE f.user_id = ?
            ORDER BY f.created_at DESC
        `).all(req.user.id);

        // Şarj ünitelerini de ekle
        favorites.forEach(station => {
            station.chargers = db.prepare('SELECT * FROM chargers WHERE station_id = ?').all(station.id);
        });

        res.json(favorites);
    } catch (err) {
        res.status(500).json({ error: 'Server error.' });
    }
});

// POST /api/profile/favorites
// İstasyonu favorilere ekle veya çıkar (toggle)
router.post('/favorites', (req, res) => {
    try {
        const { stationId } = req.body;

        const existing = db.prepare('SELECT id FROM favorites WHERE user_id = ? AND station_id = ?')
            .get(req.user.id, stationId);

        if (existing) {
            db.prepare('DELETE FROM favorites WHERE id = ?').run(existing.id);
            return res.json({ success: true, isFavorite: false, message: 'Removed from favorites.' });
        } else {
            db.prepare('INSERT INTO favorites (user_id, station_id) VALUES (?, ?)')
                .run(req.user.id, stationId);
            return res.json({ success: true, isFavorite: true, message: 'Added to favorites.' });
        }
    } catch (err) {
        res.status(500).json({ error: 'Server error.' });
    }
});

// GET /api/profile/history
// User's past charging sessions and completed/cancelled reservations
router.get('/history', (req, res) => {
    try {
        // Completed and cancelled reservations + charging session info if available
        const history = db.prepare(`
            SELECT r.id as reservation_id,
                   r.date, r.start_slot, r.end_slot, r.status as reservation_status,
                   r.created_at as reserved_at,
                   s.name as station_name, s.address as station_address,
                   c.type as charger_type, c.power as charger_power,
                   c.connector_type, c.price_per_kwh,
                   v.brand as vehicle_brand, v.model as vehicle_model, v.plate_number,
                   ses.id as session_id,
                   ses.start_time, ses.end_time,
                   ses.energy_consumed, ses.cost as session_cost,
                   ses.battery_start, ses.battery_end,
                   ses.status as session_status
            FROM reservations r
            JOIN stations s ON r.station_id = s.id
            JOIN chargers c ON r.charger_id = c.id
            JOIN vehicles v ON r.vehicle_id = v.id
            LEFT JOIN sessions ses ON ses.reservation_id = r.id
            WHERE r.user_id = ? AND r.status IN ('completed', 'cancelled')
            ORDER BY r.created_at DESC
            LIMIT 50
        `).all(req.user.id);

        res.json({ history });
    } catch (err) {
        console.error('History Error:', err);
        res.status(500).json({ error: 'History could not be retrieved.' });
    }
});

module.exports = router;
