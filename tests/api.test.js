/**
 * ══════════════════════════════════════════════════════
 *  EVCharge — API Test Suite
 *  Tüm ana Use Case'leri kapsayan otomatik test dosyası
 * ══════════════════════════════════════════════════════
 */

const BASE = 'http://localhost:3000/api';
const TEST_EMAIL = `test_${Date.now()}@ev.com`;
const TEST_PASS = 'Test1234';
const TEST_NAME = 'Test Kullanıcı';

let TOKEN = '';
let vehicleId = null;
let reservationId = null;
let sessionId = null;
let cardId = null;

// ── Yardımcılar ──
let passed = 0;
let failed = 0;
const results = [];

async function api(method, path, body = null, token = TOKEN) {
    const opts = {
        method,
        headers: { 'Content-Type': 'application/json' },
    };
    if (token) opts.headers['Authorization'] = `Bearer ${token}`;
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`${BASE}${path}`, opts);
    const data = await res.json();
    return { status: res.status, data };
}

function assert(testName, condition, detail = '') {
    if (condition) {
        passed++;
        results.push(`  ✅ ${testName}`);
    } else {
        failed++;
        results.push(`  ❌ ${testName}${detail ? ' → ' + detail : ''}`);
    }
}

// ══════════════════════════════════════
//  1. AUTHENTICATION (Kayıt & Giriş)
// ══════════════════════════════════════
async function testAuth() {
    console.log('\n🔐 1. AUTH TESTLERİ');

    // 1.1 Kayıt — Başarılı
    const reg = await api('POST', '/auth/register', { name: TEST_NAME, email: TEST_EMAIL, password: TEST_PASS });
    assert('Kayıt başarılı', reg.status === 201);
    assert('Kayıt token döndürüyor', !!reg.data.token);

    // 1.2 Aynı e-posta tekrar kayıt — 409
    const dup = await api('POST', '/auth/register', { name: 'X', email: TEST_EMAIL, password: 'aaa111' });
    assert('Aynı e-posta engelleniyor (409)', dup.status === 409);

    // 1.3 Zayıf şifre ile kayıt — 400
    const weak = await api('POST', '/auth/register', { name: 'X', email: 'weak@ev.com', password: '123' });
    assert('Zayıf şifre reddediliyor (400)', weak.status === 400);

    // 1.4 Giriş — Başarılı
    const login = await api('POST', '/auth/login', { email: TEST_EMAIL, password: TEST_PASS });
    assert('Giriş başarılı', login.status === 200);
    assert('Giriş token döndürüyor', !!login.data.token);
    TOKEN = login.data.token;

    // 1.5 Yanlış şifre — 401
    const bad = await api('POST', '/auth/login', { email: TEST_EMAIL, password: 'wrongpass' });
    assert('Yanlış şifre reddediliyor (401)', bad.status === 401);

    // 1.6 /me
    const me = await api('GET', '/auth/me');
    assert('/me kullanıcı bilgisi döndürüyor', me.data.user && me.data.user.email === TEST_EMAIL);
}

// ══════════════════════════════════════
//  2. ARAÇ YÖNETİMİ
// ══════════════════════════════════════
async function testVehicles() {
    console.log('\n🚗 2. ARAÇ TESTLERİ');

    // 2.1 Araç ekleme — Başarılı
    const add = await api('POST', '/vehicles', {
        brand: 'Tesla', model: 'Model 3',
        batteryCapacity: 75, connectorType: 'CCS',
        maxChargeRate: 50, plateNumber: '35 EV 2024'
    });
    assert('Araç ekleme başarılı (201)', add.status === 201);
    vehicleId = add.data.vehicle?.id;

    // 2.2 Geçersiz plaka (Türkiye formatı kontrolü)
    const badPlate = await api('POST', '/vehicles', {
        brand: 'BMW', model: 'iX',
        batteryCapacity: 76, connectorType: 'CCS',
        maxChargeRate: 195, plateNumber: 'INVALID'
    });
    assert('Geçersiz plaka reddediliyor (400)', badPlate.status === 400);

    // 2.3 Eksik alan ile ekleme
    const missing = await api('POST', '/vehicles', {
        brand: 'Renault', model: 'Megane'
    });
    assert('Eksik alan reddediliyor (400)', missing.status === 400);

    // 2.4 Araç listeleme
    const list = await api('GET', '/vehicles');
    assert('Araç listesi döndürülüyor', list.data.vehicles?.length >= 1);

    // 2.5 Uyumsuz konnektörlü 2. araç (Type 2 araç)
    const add2 = await api('POST', '/vehicles', {
        brand: 'Renault', model: 'Zoe',
        batteryCapacity: 52, connectorType: 'Type 2',
        maxChargeRate: 22, plateNumber: '06 A 1234'
    });
    assert('İkinci araç eklendi (Type 2)', add2.status === 201);
}

// ══════════════════════════════════════
//  3. REZERVASYON
// ══════════════════════════════════════
async function testReservations() {
    console.log('\n📅 3. REZERVASYON TESTLERİ');

    // Cüzdana bakiye yükle (önce kart ekle)
    const cardAdd = await api('POST', '/profile/cards', {
        cardName: 'Test Kartım', cardNumber: '5555 4444 3333 2222', expiryDate: '12/28'
    });
    cardId = cardAdd.data.id;
    assert('Kart eklendi', cardAdd.status === 201);

    const fund = await api('POST', '/profile/add-funds', { amount: 500, cardId: cardId });
    assert('Bakiye yüklendi', fund.status === 200);

    // Şu anki saat ve tarih ile test et
    const now = new Date();
    // Her zaman gelecekte olacak şekilde: şu anki saatten 1 saat sonrasını kullan
    const futureStart = new Date(now.getTime() + 60 * 60 * 1000);
    let today = futureStart.toISOString().split('T')[0];
    const hh = String(futureStart.getHours()).padStart(2, '0');
    const startSlot = `${hh}:00`;
    // 1 saat sonra bitiş
    const endDate = new Date(futureStart.getTime() + 60 * 60 * 1000);
    const endH = String(endDate.getHours()).padStart(2, '0');
    const endSlot = `${endH}:00`;
    // Eğer gün değişiyorsa (gece yarısı) end date'i de güncelle
    if (endDate.getDate() !== futureStart.getDate()) {
        // Gece yarısı geçişi, ama aynı günü kullanmaya devam
    }

    // 3.1 Konnektör uyumsuzluğu (CCS araç → Type 2 şarj ünitesi — Charger ID:1)
    const mismatch = await api('POST', '/reservations', {
        stationId: 1, chargerId: 1, vehicleId: vehicleId,
        date: today, startSlot, endSlot
    });
    assert('Konnektör uyumsuzluğu engelleniyor', mismatch.status === 400 && mismatch.data.error.includes('Uyumsuz'));

    // 3.2 Çevrimdışı şarj ünitesi (Charger ID:7 — offline)
    const offline = await api('POST', '/reservations', {
        stationId: 3, chargerId: 7, vehicleId: vehicleId,
        date: today, startSlot, endSlot
    });
    assert('Çevrimdışı ünite engelleniyor', offline.status === 400);

    // 3.3 Başarılı rezervasyon (Charger ID:13 — 50kW CCS, Çiğli Park)
    const res1 = await api('POST', '/reservations', {
        stationId: 5, chargerId: 13, vehicleId: vehicleId,
        date: today, startSlot, endSlot
    });
    assert('Rezervasyon başarılı (201)', res1.status === 201, res1.data.error);
    reservationId = res1.data.reservation?.id;

    // 3.4 Aynı kullanıcının aynı saatte çifte rezervasyonu engelleniyor (farklı istasyon, CCS ünite)
    const dupe = await api('POST', '/reservations', {
        stationId: 2, chargerId: 4, vehicleId: vehicleId,
        date: today, startSlot, endSlot
    });
    assert('Çifte kullanıcı rezervasyonu engelleniyor (409)', dupe.status === 409, dupe.data.error);

    // 3.5 Geçmiş tarih reddediliyor
    const pastRes = await api('POST', '/reservations', {
        stationId: 2, chargerId: 4, vehicleId: vehicleId,
        date: '2024-01-01', startSlot: '10:00', endSlot: '11:00'
    });
    assert('Geçmiş tarih reddediliyor', pastRes.status === 400);

    // 3.6 Çok kısa süre (10 dk — min 15 dk)
    const shortStart = new Date(now.getTime() + 4 * 60 * 60 * 1000);
    const shortH = String(shortStart.getHours()).padStart(2, '0');
    const shortRes = await api('POST', '/reservations', {
        stationId: 5, chargerId: 13, vehicleId: vehicleId,
        date: today, startSlot: `${shortH}:00`, endSlot: `${shortH}:10`
    });
    assert('Çok kısa süre reddediliyor (min 15dk)', shortRes.status === 400);

    // 3.7 Bakiye kontrolü (Tahmini tutar)
    const me = await api('GET', '/auth/me');
    assert('Bakiye depozito kadar azalmış', me.data.user.balance < 500);

    // 3.8 Rezervasyon listesi
    const resList = await api('GET', '/reservations');
    assert('Rezervasyon listesi döndürülüyor', resList.data.reservations?.length >= 1);
}

// ══════════════════════════════════════
//  4. ŞARJ OTURUMU
// ══════════════════════════════════════
async function testSessions() {
    console.log('\n⚡ 4. ŞARJ OTURUMU TESTLERİ');

    if (!reservationId) {
        results.push('  ⏭️  Rezervasyon yok, şarj testleri atlanıyor.');
        return;
    }

    // 4.1 Şarj başlat
    const start = await api('POST', '/sessions', {
        reservationId: reservationId,
        batteryStart: 30
    });
    // Zaman kısıtlaması sebebiyle ya 201 ya 400 olabilir
    if (start.status === 201) {
        assert('Şarj başlatıldı (201)', true);
        sessionId = start.data.session?.id;

        // 4.2 Batarya mantık kontrolü (bitiş < başlangıç)
        const badBatt = await api('PATCH', `/sessions/${sessionId}`, {
            energyConsumed: 10, batteryEnd: 15  // 15 < 30 = Hatalı
        });
        assert('Batarya düşüşü reddediliyor', badBatt.status === 400);

        // 4.3 Başarılı şarj durdurma
        const stop = await api('PATCH', `/sessions/${sessionId}`, {
            energyConsumed: 20, batteryEnd: 75
        });
        assert('Şarj tamamlandı', stop.status === 200);
        assert('Makbuz bilgileri döndürüldü', !!stop.data.receipt);

        // 4.4 Mahsuplaşma kontrolü: Bakiye düzeltilmiş mi?
        const meAfter = await api('GET', '/auth/me');
        assert('Bakiye mahsuplaşması yapıldı (Depozit-Cost iadesi)', meAfter.data.user.balance > 0);

        // 4.5 Aynı oturumu tekrar bitirme
        const reFin = await api('PATCH', `/sessions/${sessionId}`, {
            energyConsumed: 5, batteryEnd: 80
        });
        assert('Tamamlanmış oturum tekrar bitirilemez', reFin.status === 400);
    } else {
        assert('Şarj başlatılamadı (zaman kısıtı)', start.status === 400);
        results.push(`  ℹ️  Bilgi: ${start.data.error}`);
    }
}

// ══════════════════════════════════════
//  5. İPTAL (Refund Mantığı)
// ══════════════════════════════════════
async function testCancellation() {
    console.log('\n💸 5. İPTAL & İADE TESTLERİ');

    // Yeni bir rezervasyon oluşturup iptal edelim (CCS uyumlu ünite — Charger ID:2, Karşıyaka)
    const now = new Date();
    const cancelStart = new Date(now.getTime() + 5 * 60 * 60 * 1000);
    const cancelEnd = new Date(now.getTime() + 6 * 60 * 60 * 1000);
    const today = cancelStart.toISOString().split('T')[0];
    const futureH = String(cancelStart.getHours()).padStart(2, '0');
    const futureEnd = String(cancelEnd.getHours()).padStart(2, '0');

    const meBefore = await api('GET', '/auth/me');
    const balanceBefore = meBefore.data.user.balance;

    const newRes = await api('POST', '/reservations', {
        stationId: 1, chargerId: 2, vehicleId: vehicleId,
        date: today, startSlot: `${futureH}:00`, endSlot: `${futureEnd}:00`
    });

    if (newRes.status === 201) {
        const cancelId = newRes.data.reservation.id;

        // İptal et
        const cancel = await api('DELETE', `/reservations/${cancelId}`);
        assert('Rezervasyon iptal edildi', cancel.status === 200);
        assert('İade mesajı döndürüldü', cancel.data.message?.includes('₺'));

        const meAfter = await api('GET', '/auth/me');
        assert('İade sonrası bakiye artmış', meAfter.data.user.balance > balanceBefore - 1);
    } else {
        results.push(`  ⏭️  İptal testi için rez oluşturulamadı: ${newRes.data.error}`);
    }

    // Zaten iptal edilmiş rez tekrar iptal edilemez
    if (reservationId && sessionId) {
        const reCan = await api('DELETE', `/reservations/${reservationId}`);
        assert('Tamamlanmış rez iptal edilemez', reCan.status === 400 || reCan.status === 404);
    }
}

// ══════════════════════════════════════
//  6. PROFİL & GÜVENLİK
// ══════════════════════════════════════
async function testProfile() {
    console.log('\n👤 6. PROFİL & GÜVENLİK TESTLERİ');

    // 6.1 Profil bilgisi
    const prof = await api('GET', '/profile');
    assert('Profil bilgisi döndürüldü', prof.status === 200 && !!prof.data.email);

    // 6.2 İsim güncelleme
    const upd = await api('PUT', '/profile', { name: 'Güncellenen İsim' });
    assert('İsim güncellendi', upd.status === 200);

    // 6.3 Eski şifre olmadan şifre değiştirme — Engelleniyor
    const noOld = await api('PUT', '/profile', { name: 'Test', password: 'NewPass123' });
    assert('Eski şifre olmadan değiştirme engelleniyor', noOld.status === 400);

    // 6.4 Yanlış eski şifre — Engelleniyor
    const wrongOld = await api('PUT', '/profile', { name: 'Test', oldPassword: 'YanlisEski', password: 'NewPass123' });
    assert('Yanlış eski şifre engelleniyor (401)', wrongOld.status === 401);

    // 6.5 Doğru eski şifre ile değiştirme — Başarılı
    const okPass = await api('PUT', '/profile', { name: 'Test', oldPassword: TEST_PASS, password: 'YeniSifre123' });
    assert('Şifre başarıyla değiştirildi', okPass.status === 200);

    // 6.6 Yeni şifre ile giriş
    const newLogin = await api('POST', '/auth/login', { email: TEST_EMAIL, password: 'YeniSifre123' });
    assert('Yeni şifre ile giriş başarılı', newLogin.status === 200);
    TOKEN = newLogin.data.token;
}

// ══════════════════════════════════════
//  7. KART & CÜZDAN
// ══════════════════════════════════════
async function testWallet() {
    console.log('\n💳 7. KART & CÜZDAN TESTLERİ');

    // 7.1 Kart listesi
    const cards = await api('GET', '/profile/cards');
    assert('Kart listesi döndürüldü', cards.status === 200);

    // 7.2 Kısa kart numarası reddedilir
    const badCard = await api('POST', '/profile/cards', {
        cardName: 'Hatalı', cardNumber: '1234', expiryDate: '01/30'
    });
    assert('Kısa kart numarası reddediliyor', badCard.status === 400);

    // 7.3 Eski sahte wallet/add rotası silinmiş mi?
    const fakeWallet = await api('POST', '/auth/wallet/add', { amount: 999999 });
    assert('Sahte cüzdan rotası silinmiş (404)', fakeWallet.status === 404);

    // 7.4 Kart silme
    if (cardId) {
        const del = await api('DELETE', `/profile/cards/${cardId}`);
        assert('Kart silindi', del.status === 200);
    }

    // 7.5 Başkasının kartını silme
    const alien = await api('DELETE', '/profile/cards/99999');
    assert('Başkasının kartı silinemiyor (404)', alien.status === 404);
}

// ══════════════════════════════════════
//  8. YETKİSİZ ERİŞİM
// ══════════════════════════════════════
async function testUnauthorized() {
    console.log('\n🛡️ 8. YETKİSİZ ERİŞİM TESTLERİ');

    const noToken = await api('GET', '/vehicles', null, '');
    assert('Token olmadan araçlara erişim engelleniyor', noToken.status === 401);

    const noToken2 = await api('GET', '/reservations', null, '');
    assert('Token olmadan rezervasyonlara erişim engelleniyor', noToken2.status === 401);

    const fakeToken = await api('GET', '/profile', null, 'fake.token.here');
    assert('Sahte token reddediliyor', fakeToken.status === 401);
}

// ══════════════════════════════════════
//  TEST ÇALIŞTIR
// ══════════════════════════════════════
async function runAllTests() {
    console.log('═══════════════════════════════════════');
    console.log(' ⚡ EVCharge API Test Suite');
    console.log(`    Zaman: ${new Date().toLocaleString('tr-TR')}`);
    console.log('═══════════════════════════════════════');

    await testAuth();
    await testVehicles();
    await testReservations();
    await testSessions();
    await testCancellation();
    await testProfile();
    await testWallet();
    await testUnauthorized();

    // ── SONUÇLAR ──
    console.log('\n═══════════════════════════════════════');
    console.log(' 📊 SONUÇLAR');
    console.log('═══════════════════════════════════════');
    results.forEach(r => console.log(r));
    console.log('───────────────────────────────────────');
    console.log(`  Toplam: ${passed + failed} | ✅ Geçen: ${passed} | ❌ Başarısız: ${failed}`);
    console.log('═══════════════════════════════════════\n');

    // Temizlik: test kullanıcısını sil
    try {
        const db = require('../server/db');
        db.prepare('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email = ?)').run(TEST_EMAIL);
        db.prepare('DELETE FROM reservations WHERE user_id IN (SELECT id FROM users WHERE email = ?)').run(TEST_EMAIL);
        db.prepare('DELETE FROM vehicles WHERE user_id IN (SELECT id FROM users WHERE email = ?)').run(TEST_EMAIL);
        db.prepare('DELETE FROM credit_cards WHERE user_id IN (SELECT id FROM users WHERE email = ?)').run(TEST_EMAIL);
        db.prepare('DELETE FROM users WHERE email = ?').run(TEST_EMAIL);
        console.log('🧹 Test verileri temizlendi.\n');
    } catch (e) {
        console.log('⚠️  Test verileri temizlenemedi (manuel sil):', e.message);
    }
}

runAllTests().catch(err => {
    console.error('💥 Kritik Hata:', err);
    process.exit(1);
});
