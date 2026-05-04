/**
 * EVCharge — Express Sunucu
 * Ana giriş noktası: middleware, route'lar ve static dosya sunumu.
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');

// Veritabanını başlat (tabloları oluşturur)
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Her başlatıldığında değişen benzersiz sunucu ID'si (Restart logout için)
const SERVER_SESSION_ID = Math.random().toString(36).substring(7);
app.set('serverSessionId', SERVER_SESSION_ID);

// ══════════════════════════════════════
//  MIDDLEWARE
// ══════════════════════════════════════

// Güvenlik header'ları
app.use(helmet({
    contentSecurityPolicy: false, // Frontend inline script'ler için
    crossOriginEmbedderPolicy: false,
}));

// CORS — Frontend erişimi
app.use(cors({
    origin: ['http://localhost:3000', 'http://127.0.0.1:3000'],
    credentials: true,
}));

// Body parser
app.use(express.json({ limit: '1mb' }));

// Genel rate limiter (1000 istek / 15 dakika - Geliştirme için artırıldı)
const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1000,
    message: { error: 'Çok fazla istek gönderildi. Lütfen 15 dakika sonra tekrar deneyin.' },
    standardHeaders: true,
    legacyHeaders: false,
});
app.use('/api/', generalLimiter);

// Login rate limiter (50 deneme / 15 dakika - Geliştirme için artırıldı)
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 50,
    message: { error: 'Çok fazla giriş denemesi. Lütfen 15 dakika sonra tekrar deneyin.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// ══════════════════════════════════════
//  API ROUTES
// ══════════════════════════════════════

const authRoutes = require('./routes/auth');
const vehicleRoutes = require('./routes/vehicles');
const stationRoutes = require('./routes/stations');
const reservationRoutes = require('./routes/reservations');
const sessionRoutes = require('./routes/sessions');
const profileRoutes = require('./routes/profile');
const adminRoutes = require('./routes/admin');

app.use('/api/auth', authRoutes);
app.use('/api/auth/login', loginLimiter); // Login'e özel rate limit
app.use('/api/vehicles', vehicleRoutes);
app.use('/api/stations', stationRoutes);
app.use('/api/reservations', reservationRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/admin', adminRoutes);

// Google Maps API key endpoint — key backend'de kalır
app.get('/api/config/maps-key', (req, res) => {
    res.json({ key: process.env.GOOGLE_MAPS_API_KEY || '' });
});

// ══════════════════════════════════════
//  STATIC FILES — Frontend'i sun
// ══════════════════════════════════════

// Frontend dosyalarını üst dizinden sun
app.use(express.static(path.join(__dirname, '..')));

// SPA fallback — bilinmeyen route'lar index.html'e
app.get('*', (req, res) => {
    if (!req.path.startsWith('/api/')) {
        res.sendFile(path.join(__dirname, '..', 'index.html'));
    }
});

// ══════════════════════════════════════
//  HATA YÖNETİMİ
// ══════════════════════════════════════

// 404 — API route bulunamadı
app.use('/api/*', (req, res) => {
    res.status(404).json({ error: 'Endpoint bulunamadı.' });
});

// Genel hata yakalayıcı
app.use((err, req, res, next) => {
    console.error('Sunucu hatası:', err.stack);
    res.status(500).json({ error: 'Sunucu hatası oluştu.' });
});

// ══════════════════════════════════════
//  SUNUCUYU BAŞLAT
// ══════════════════════════════════════

app.listen(PORT, () => {
    console.log(`\n⚡ EVCharge Backend çalışıyor: http://localhost:${PORT}`);
    console.log(`📁 Frontend sunuluyor: http://localhost:${PORT}/login.html`);
    console.log(`🔌 API: http://localhost:${PORT}/api\n`);
});
