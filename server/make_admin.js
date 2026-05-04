const db = require('./db');

const email = process.argv[2];

if (!email) {
    console.error('Lütfen admin yapmak istediğiniz kullanıcının e-posta adresini girin: node make_admin.js <email>');
    process.exit(1);
}

try {
    const info = db.prepare('UPDATE users SET is_admin = 1 WHERE email = ?').run(email);
    if (info.changes > 0) {
        console.log(`✅ ${email} adresli kullanıcı admin yapıldı.`);
    } else {
        console.log(`❌ ${email} adresli kullanıcı bulunamadı.`);
    }
} catch (err) {
    console.error('Hata:', err);
}
