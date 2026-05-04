/**
 * EVCharge — SQLite Veritabanı Bağlantısı
 * better-sqlite3 ile senkron, hızlı SQLite erişimi.
 */

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'evcharge.db');

const db = new Database(DB_PATH);

// ── WAL mode (daha iyi performans) ──
db.pragma('journal_mode = WAL');
// ── Foreign key desteğini aktif et ──
db.pragma('foreign_keys = ON');

// ══════════════════════════════════════
//  TABLO OLUŞTURMA
// ══════════════════════════════════════

db.exec(`
    -- Kullanıcılar
    CREATE TABLE IF NOT EXISTS users (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT    NOT NULL,
        email       TEXT    UNIQUE NOT NULL,
        password_hash TEXT  NOT NULL,
        balance     REAL    DEFAULT 0.0,
        is_admin    INTEGER DEFAULT 0,
        is_operator INTEGER DEFAULT 0,
        created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Kredi Kartları / Cüzdan
    CREATE TABLE IF NOT EXISTS credit_cards (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        card_name   TEXT    NOT NULL,
        card_number TEXT    NOT NULL, -- Maskelenmiş saklanacak (**** **** **** 1234)
        expiry_date TEXT    NOT NULL,
        created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Araçlar
    CREATE TABLE IF NOT EXISTS vehicles (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        brand           TEXT    NOT NULL,
        model           TEXT    NOT NULL,
        battery_capacity REAL   NOT NULL,
        connector_type  TEXT    NOT NULL,
        max_charge_rate REAL    NOT NULL,
        plate_number    TEXT    NOT NULL
    );

    -- İstasyonlar
    CREATE TABLE IF NOT EXISTS stations (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        name            TEXT    NOT NULL,
        address         TEXT    NOT NULL,
        lat             REAL    NOT NULL,
        lng             REAL    NOT NULL,
        operating_hours TEXT    NOT NULL
    );

    -- Şarj üniteleri
    CREATE TABLE IF NOT EXISTS chargers (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        station_id      INTEGER NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
        type            TEXT    NOT NULL,
        power           REAL    NOT NULL,
        connector_type  TEXT    NOT NULL,
        price_per_kwh   REAL    NOT NULL,
        status          TEXT    DEFAULT 'available'
    );

    -- Rezervasyonlar
    CREATE TABLE IF NOT EXISTS reservations (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        station_id  INTEGER NOT NULL REFERENCES stations(id),
        charger_id  INTEGER NOT NULL REFERENCES chargers(id),
        vehicle_id  INTEGER NOT NULL REFERENCES vehicles(id),
        date        TEXT    NOT NULL,
        start_slot  TEXT    NOT NULL,
        end_slot    TEXT    NOT NULL,
        status      TEXT    DEFAULT 'active',
        created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Şarj oturumları
    CREATE TABLE IF NOT EXISTS sessions (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        reservation_id  INTEGER REFERENCES reservations(id),
        start_time      DATETIME,
        end_time        DATETIME,
        energy_consumed REAL    DEFAULT 0,
        cost            REAL    DEFAULT 0,
        price_per_kwh   REAL,
        battery_start   REAL,
        battery_end     REAL,
        status          TEXT    DEFAULT 'charging'
    );

    -- Audit Logs (Denetim Kayıtları)
    CREATE TABLE IF NOT EXISTS audit_logs (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
        action      TEXT    NOT NULL,
        details     TEXT,
        ip_address  TEXT,
        created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Şifre Sıfırlama Kodları (Demo Amaçlı)
    CREATE TABLE IF NOT EXISTS password_resets (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        email       TEXT    NOT NULL,
        code        TEXT    NOT NULL,
        expires_at  DATETIME NOT NULL,
        used        INTEGER DEFAULT 0,
        created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Favori İstasyonlar
    CREATE TABLE IF NOT EXISTS favorites (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        station_id  INTEGER NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
        created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, station_id)
    );

    -- İstasyon Sorun Bildirimleri
    CREATE TABLE IF NOT EXISTS station_reports (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        station_id  INTEGER NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
        category    TEXT    NOT NULL,
        description TEXT    NOT NULL,
        status      TEXT    DEFAULT 'open',
        admin_note  TEXT,
        created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );
`);

// is_admin sütunu daha önceden olmayan veritabanlarına eklemek için migration
try {
    const tableInfo = db.pragma('table_info(users)');
    
    // Admin column migration
    const hasAdminColumn = tableInfo.some(column => column.name === 'is_admin');
    if (!hasAdminColumn) {
        db.exec('ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0;');
    }

    // Operator column migration
    const hasOperatorColumn = tableInfo.some(column => column.name === 'is_operator');
    if (!hasOperatorColumn) {
        db.exec('ALTER TABLE users ADD COLUMN is_operator INTEGER DEFAULT 0;');
    }
} catch (err) {
    console.error('Migration error for users table:', err);
}

module.exports = db;
