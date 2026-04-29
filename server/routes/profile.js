const express = require('express');
const router = express.Router();
const db = require('../db');
const bcrypt = require('bcryptjs');
const auth = require('../middleware/auth');

router.use(auth);

// GET /api/profile
// Kullanıcı bilgilerini (şifre hariç) getir
router.get('/', (req, res) => {
    try {
        const user = db.prepare('SELECT id, name, email, balance, created_at FROM users WHERE id = ?').get(req.user.id);
        if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
        res.json(user);
    } catch (err) {
        res.status(500).json({ error: 'Sunucu hatası.' });
    }
});

// PUT /api/profile
// Kullanıcı adı ve (opsiyonel) şifre güncelleme
router.put('/', async (req, res) => {
    try {
        const { name, password, oldPassword } = req.body;
        
        if (!name || name.trim() === '') {
            return res.status(400).json({ error: 'İsim alanı boş bırakılamaz.' });
        }

        if (password) {
            if (!oldPassword) {
                return res.status(400).json({ error: 'Mevcut şifrenizi girmeden yeni şifre belirleyemezsiniz.' });
            }
            if (password.length < 6) {
                return res.status(400).json({ error: 'Şifre en az 6 karakter olmalıdır.' });
            }

            const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
            const isMatch = await bcrypt.compare(oldPassword, user.password_hash);
            
            if (!isMatch) {
                return res.status(401).json({ error: 'Mevcut şifreniz yanlış.' });
            }

            const hashedPassword = await bcrypt.hash(password, 10);
            db.prepare('UPDATE users SET name = ?, password_hash = ? WHERE id = ?')
              .run(name.trim(), hashedPassword, req.user.id);
        } else {
            db.prepare('UPDATE users SET name = ? WHERE id = ?')
              .run(name.trim(), req.user.id);
        }

        res.json({ success: true, message: 'Profil başarıyla güncellendi.' });
    } catch (err) {
        res.status(500).json({ error: 'Sunucu hatası.' });
    }
});

// GET /api/profile/cards
// Kayıtlı kartları getir
router.get('/cards', (req, res) => {
    try {
        const cards = db.prepare('SELECT * FROM credit_cards WHERE user_id = ?').all(req.user.id);
        res.json(cards);
    } catch (err) {
        res.status(500).json({ error: 'Sunucu hatası.' });
    }
});

// POST /api/profile/cards
// Yeni kart ekle
router.post('/cards', (req, res) => {
    try {
        const { cardName, cardNumber, expiryDate } = req.body;
        
        if (!cardName || !cardNumber || !expiryDate) {
            return res.status(400).json({ error: 'Tüm kart bilgileri gereklidir.' });
        }

        // Kartın sadece son 4 hanesini kaydet (güvenlik için)
        // Kart numarası boşluksuz kabul edilip son 4 hanesi alınabilir
        const cleanNumber = cardNumber.replace(/\D/g, '');
        if (cleanNumber.length < 15) {
            return res.status(400).json({ error: 'Geçersiz kart numarası.' });
        }
        
        const maskedNumber = '**** **** **** ' + cleanNumber.slice(-4);

        const info = db.prepare(`
            INSERT INTO credit_cards (user_id, card_name, card_number, expiry_date)
            VALUES (?, ?, ?, ?)
        `).run(req.user.id, cardName, maskedNumber, expiryDate);

        res.status(201).json({ success: true, id: info.lastInsertRowid });
    } catch (err) {
        res.status(500).json({ error: 'Sunucu hatası.' });
    }
});

// DELETE /api/profile/cards/:id
// Kart sil
router.delete('/cards/:id', (req, res) => {
    try {
        const info = db.prepare('DELETE FROM credit_cards WHERE id = ? AND user_id = ?')
                       .run(req.params.id, req.user.id);
        
        if (info.changes === 0) {
            return res.status(404).json({ error: 'Kart bulunamadı.' });
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Sunucu hatası.' });
    }
});

// POST /api/profile/add-funds
// Cüzdana bakiye yükle
router.post('/add-funds', (req, res) => {
    try {
        const { amount, cardId } = req.body;
        const numAmount = Number(amount);

        if (!numAmount || numAmount <= 0) {
            return res.status(400).json({ error: 'Geçerli bir tutar giriniz.' });
        }

        // Kartın kullanıcıya ait olduğunu doğrula
        const card = db.prepare('SELECT id FROM credit_cards WHERE id = ? AND user_id = ?').get(cardId, req.user.id);
        if (!card) {
            return res.status(400).json({ error: 'Geçersiz kart seçimi.' });
        }

        // Bakiyeyi güncelle
        db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(numAmount, req.user.id);

        res.json({ success: true, message: `${numAmount} ₺ başarıyla yüklendi.` });
    } catch (err) {
        res.status(500).json({ error: 'Sunucu hatası.' });
    }
});

module.exports = router;
