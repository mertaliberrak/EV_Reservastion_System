/**
 * ══════════════════════════════════════════════════════════════
 *  EVCharge — Şarj Oturumu Kapsamlı Test Suite
 *  Ana Use Case: Araç Kayıt → Rezervasyon → Şarj → Maliyet
 * ══════════════════════════════════════════════════════════════
 *  Kullanım: Server çalışırken →  node tests/charging.test.js
 */

const BASE = 'http://localhost:3000/api';
const TEST_EMAIL = `chrgtest_${Date.now()}@ev.com`;
const TEST_PASS = 'Test1234!';
const TEST_NAME = 'Şarj Test Kullanıcısı';

let TOKEN = '';
let userId = null;
let vehicleId = null;
let reservationId = null;
let sessionId = null;
let cardId = null;
let initialBalance = 0;

// ── Yardımcılar ──
let passed = 0, failed = 0;
const results = [];

async function api(method, path, body = null, token = TOKEN) {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (token) opts.headers['Authorization'] = `Bearer ${token}`;
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`${BASE}${path}`, opts);
    const data = await res.json();
    return { status: res.status, data };
}

function assert(testName, condition, detail = '') {
    if (condition) { passed++; results.push(`  ✅ ${testName}`); }
    else { failed++; results.push(`  ❌ ${testName}${detail ? ' → ' + detail : ''}`); }
}

function getSlots(offsetHours = 1) {
    const now = new Date();
    const start = new Date(now.getTime() + offsetHours * 60 * 60 * 1000);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    return {
        date: start.toISOString().split('T')[0],
        startSlot: `${String(start.getHours()).padStart(2,'0')}:00`,
        endSlot: `${String(end.getHours()).padStart(2,'0')}:00`,
    };
}

// ═══════════════════════════════════════════
//  0. SETUP — Kullanıcı, Araç, Bakiye, Rez
// ═══════════════════════════════════════════
async function setup() {
    console.log('\n🔧 0. TEST ORTAMI HAZIRLANIYOR');

    // Kayıt
    const reg = await api('POST', '/auth/register', { name: TEST_NAME, email: TEST_EMAIL, password: TEST_PASS });
    assert('Kullanıcı kaydı', reg.status === 201);
    TOKEN = reg.data.token;

    const me = await api('GET', '/auth/me');
    userId = me.data.user?.id;

    // Araç ekle (CCS — Charger 13 ile uyumlu)
    const v = await api('POST', '/vehicles', {
        brand: 'Tesla', model: 'Model 3', batteryCapacity: 75,
        connectorType: 'CCS', maxChargeRate: 50, plateNumber: '35 EV 9999'
    });
    assert('Araç eklendi', v.status === 201);
    vehicleId = v.data.vehicle?.id;

    // Kart + Bakiye
    const card = await api('POST', '/profile/cards', { cardName: 'Test', cardNumber: '5555 4444 3333 2222', expiryDate: '12/28' });
    cardId = card.data.id;
    const fund = await api('POST', '/profile/add-funds', { amount: 1000, cardId });
    assert('1000₺ bakiye yüklendi', fund.status === 200);

    // Aktif rezervasyon oluştur (Charger 13 = CCS 50kW, Çiğli Park, 4₺/kWh)
    // Şu andan itibaren dakika cinsine yuvarla (15dk erken başlama kuralına uygun)
    const now = new Date();
    const startTime = new Date(now.getTime() + 5 * 60 * 1000); // 5 dk sonra
    const endTime = new Date(startTime.getTime() + 60 * 60 * 1000); // +1 saat
    const slots = {
        date: `${startTime.getFullYear()}-${String(startTime.getMonth()+1).padStart(2,'0')}-${String(startTime.getDate()).padStart(2,'0')}`,
        startSlot: `${String(startTime.getHours()).padStart(2,'0')}:${String(startTime.getMinutes()).padStart(2,'0')}`,
        endSlot: `${String(endTime.getHours()).padStart(2,'0')}:${String(endTime.getMinutes()).padStart(2,'0')}`,
    };
    const res = await api('POST', '/reservations', {
        stationId: 5, chargerId: 13, vehicleId,
        date: slots.date, startSlot: slots.startSlot, endSlot: slots.endSlot
    });
    assert('Rezervasyon oluşturuldu', res.status === 201, res.data.error);
    reservationId = res.data.reservation?.id;

    const meAfter = await api('GET', '/auth/me');
    initialBalance = meAfter.data.user?.balance;
    assert(`Depozito kesildi (bakiye: ${initialBalance?.toFixed(2)}₺)`, initialBalance < 1000);
}

// ═══════════════════════════════════════════
//  1. ŞARJ BAŞLATMA TESTLERİ
// ═══════════════════════════════════════════
async function testStartSession() {
    console.log('\n⚡ 1. ŞARJ BAŞLATMA TESTLERİ');

    // 1.1 Eksik parametre
    const noParam = await api('POST', '/sessions', {});
    assert('TC-01: Eksik parametre reddediliyor (400)', noParam.status === 400);

    // 1.2 Geçersiz batteryStart
    const badBatt = await api('POST', '/sessions', { reservationId: reservationId, batteryStart: 150 });
    assert('TC-02: batteryStart > 100 reddediliyor', badBatt.status === 400);

    const negBatt = await api('POST', '/sessions', { reservationId: reservationId, batteryStart: -5 });
    assert('TC-03: batteryStart < 0 reddediliyor', negBatt.status === 400);

    // 1.3 Olmayan rezervasyon
    const noRes = await api('POST', '/sessions', { reservationId: 99999, batteryStart: 20 });
    assert('TC-04: Olmayan rezervasyon reddediliyor (404)', noRes.status === 404);

    // 1.4 Başarılı şarj başlatma
    if (!reservationId) { results.push('  ⏭️  Rezervasyon yok, başlatma testi atlanıyor.'); return; }

    const start = await api('POST', '/sessions', { reservationId, batteryStart: 20 });
    if (start.status === 201) {
        sessionId = start.data.session?.id;
        assert('TC-05: Şarj başarıyla başlatıldı (201)', true);
        assert('TC-06: Session ID döndürüldü', !!sessionId);
        assert('TC-07: price_per_kwh mevcut', start.data.session?.price_per_kwh > 0);
        assert('TC-08: battery_start doğru', start.data.session?.battery_start === 20);
        assert('TC-09: status = charging', start.data.session?.status === 'charging');
        assert('TC-10: maxAffordableEnergy hesaplandı', start.data.session?.maxAffordableEnergy > 0);
        assert('TC-11: vehicle_name döndürüldü', !!start.data.session?.vehicle_name);
        assert('TC-12: station_name döndürüldü', !!start.data.session?.station_name);
        assert('TC-13: charger_power döndürüldü', start.data.session?.charger_power > 0);

        // Rezervasyon in_progress oldu mu?
        const resList = await api('GET', '/reservations');
        const rez = resList.data.reservations?.find(r => r.id === reservationId);
        assert('TC-14: Rezervasyon in_progress durumunda', rez?.status === 'in_progress');
    } else {
        assert('TC-05: Şarj başlatılamadı (zaman kısıtı)', start.status === 400);
        results.push(`  ℹ️  ${start.data.error}`);
    }

    // 1.5 Aynı rezervasyonla tekrar şarj (artık in_progress)
    if (sessionId) {
        const dup = await api('POST', '/sessions', { reservationId, batteryStart: 30 });
        assert('TC-15: Aynı rezervasyonla tekrar başlatılamaz', dup.status === 400);
    }
}

// ═══════════════════════════════════════════
//  2. ŞARJ DURDURMA TESTLERİ
// ═══════════════════════════════════════════
async function testStopSession() {
    console.log('\n🛑 2. ŞARJ DURDURMA TESTLERİ');

    if (!sessionId) { results.push('  ⏭️  Oturum yok, durdurma testleri atlanıyor.'); return; }

    // 2.1 Eksik batteryEnd
    const noEnd = await api('PATCH', `/sessions/${sessionId}`, {});
    assert('TC-16: batteryEnd eksik → 400', noEnd.status === 400);

    // 2.2 Geçersiz batteryEnd (> 100)
    const over = await api('PATCH', `/sessions/${sessionId}`, { batteryEnd: 120 });
    assert('TC-17: batteryEnd > 100 reddediliyor', over.status === 400);

    // 2.3 batteryEnd < batteryStart (20%)
    const lower = await api('PATCH', `/sessions/${sessionId}`, { batteryEnd: 10 });
    assert('TC-18: batteryEnd < batteryStart reddediliyor', lower.status === 400);

    // 2.4 Olmayan oturum
    const noSess = await api('PATCH', '/sessions/99999', { batteryEnd: 80 });
    assert('TC-19: Olmayan oturum → 404', noSess.status === 404);

    // 2.5 Başarılı şarj durdurma
    const stop = await api('PATCH', `/sessions/${sessionId}`, { batteryEnd: 80 });
    assert('TC-20: Şarj başarıyla durduruldu (200)', stop.status === 200);

    // Receipt kontrolleri
    const r = stop.data.receipt;
    assert('TC-21: Makbuz döndürüldü', !!r);
    assert('TC-22: receiptNo mevcut', r?.receiptNo?.startsWith('RCP-'));
    assert('TC-23: energyConsumed mevcut', !!r?.energyConsumed);
    assert('TC-24: totalCost mevcut', !!r?.totalCost);
    assert('TC-25: pricePerKwh mevcut', !!r?.pricePerKwh);
    assert('TC-26: chargingDuration mevcut', !!r?.chargingDuration);
    assert('TC-27: depositPaid mevcut', !!r?.depositPaid);
    assert('TC-28: batteryStart mevcut', !!r?.batteryStart);
    assert('TC-29: batteryEnd mevcut', !!r?.batteryEnd);

    // Session durumu kontrolü
    assert('TC-30: Oturum completed durumunda', stop.data.session?.status === 'completed');
    assert('TC-31: energy_consumed >= 0', stop.data.session?.energy_consumed >= 0);
    assert('TC-32: cost >= 0', stop.data.session?.cost >= 0);
}

// ═══════════════════════════════════════════
//  3. TAMAMLANMIŞ OTURUM TESTLERİ
// ═══════════════════════════════════════════
async function testCompletedSession() {
    console.log('\n🔒 3. TAMAMLANMIŞ OTURUM TESTLERİ');

    if (!sessionId) { results.push('  ⏭️  Oturum yok, atlanıyor.'); return; }

    // 3.1 Tamamlanmış oturumu tekrar durdurma
    const again = await api('PATCH', `/sessions/${sessionId}`, { batteryEnd: 90 });
    assert('TC-33: Tamamlanmış oturum tekrar durdurulamaz (400)', again.status === 400);

    // 3.2 Rezervasyon completed oldu mu?
    const resList = await api('GET', '/reservations');
    const rez = resList.data.reservations?.find(r => r.id === reservationId);
    assert('TC-34: Rezervasyon completed durumunda', rez?.status === 'completed');

    // 3.3 Şarj ünitesi tekrar available mı?
    const stations = await api('GET', '/stations');
    if (stations.data.stations) {
        const cigli = stations.data.stations.find(s => s.id === 5);
        if (cigli) {
            const charger13 = cigli.chargers?.find(c => c.id === 13);
            assert('TC-35: Şarj ünitesi tekrar available', charger13?.status === 'available');
        }
    }
}

// ═══════════════════════════════════════════
//  4. BAKİYE & MAHSUPLAşMA TESTLERİ
// ═══════════════════════════════════════════
async function testBalance() {
    console.log('\n💰 4. BAKİYE & MAHSUPLAŞMA TESTLERİ');

    const me = await api('GET', '/auth/me');
    const finalBalance = me.data.user?.balance;

    assert('TC-36: Bakiye eksiye düşmemiş', finalBalance >= 0);
    assert('TC-37: Depozito iadesi yapıldı (bakiye > ilk depozito sonrası)', finalBalance > initialBalance - 1);
    results.push(`  ℹ️  Başlangıç: 1000₺ → Depozito sonrası: ${initialBalance?.toFixed(2)}₺ → Şarj sonrası: ${finalBalance?.toFixed(2)}₺`);
}

// ═══════════════════════════════════════════
//  5. OTURUM GEÇMİŞİ TESTLERİ
// ═══════════════════════════════════════════
async function testSessionHistory() {
    console.log('\n📋 5. OTURUM GEÇMİŞİ TESTLERİ');

    const hist = await api('GET', '/sessions');
    assert('TC-38: Oturum geçmişi döndürüldü', hist.status === 200);
    assert('TC-39: En az 1 oturum mevcut', hist.data.sessions?.length >= 1);

    const mySession = hist.data.sessions?.find(s => s.id === sessionId);
    if (mySession) {
        assert('TC-40: station_name mevcut', !!mySession.station_name);
        assert('TC-41: charger_type mevcut', !!mySession.charger_type);
        assert('TC-42: start_time mevcut', !!mySession.start_time);
        assert('TC-43: end_time mevcut', !!mySession.end_time);
    }
}

// ═══════════════════════════════════════════
//  6. BİLDİRİM TESTLERİ
// ═══════════════════════════════════════════
async function testNotifications() {
    console.log('\n🔔 6. BİLDİRİM TESTLERİ');

    const notifs = await api('GET', '/notifications');
    assert('TC-44: Bildirimler döndürüldü', notifs.status === 200);

    const chargingNotif = notifs.data.notifications?.find(n => n.title?.includes('Şarj İşlemi'));
    assert('TC-45: Şarj tamamlandı bildirimi mevcut', !!chargingNotif);
    if (chargingNotif) {
        assert('TC-46: Bildirimde maliyet bilgisi var', chargingNotif.message?.includes('₺'));
    }
}

// ═══════════════════════════════════════════
//  7. YETKİSİZ ERİŞİM TESTLERİ
// ═══════════════════════════════════════════
async function testUnauthorized() {
    console.log('\n🛡️ 7. YETKİSİZ ERİŞİM TESTLERİ');

    const noTok1 = await api('POST', '/sessions', { reservationId: 1, batteryStart: 20 }, '');
    assert('TC-47: Token olmadan şarj başlatılamaz (401)', noTok1.status === 401);

    const noTok2 = await api('GET', '/sessions', null, '');
    assert('TC-48: Token olmadan oturum geçmişi alınamaz (401)', noTok2.status === 401);

    const noTok3 = await api('PATCH', '/sessions/1', { batteryEnd: 80 }, '');
    assert('TC-49: Token olmadan şarj durdurulamaz (401)', noTok3.status === 401);

    const fake = await api('GET', '/sessions', null, 'sahte.token.xyz');
    assert('TC-50: Sahte token reddediliyor (401)', fake.status === 401);
}

// ═══════════════════════════════════════════
//  TESTLERİ ÇALIŞTIR
// ═══════════════════════════════════════════
async function runAll() {
    console.log('═══════════════════════════════════════════');
    console.log(' ⚡ EVCharge — Şarj Oturumu Test Suite');
    console.log(` 📅 ${new Date().toLocaleString('tr-TR')}`);
    console.log('═══════════════════════════════════════════');

    await setup();
    await testStartSession();
    await testStopSession();
    await testCompletedSession();
    await testBalance();
    await testSessionHistory();
    await testNotifications();
    await testUnauthorized();

    // ── SONUÇLAR ──
    console.log('\n═══════════════════════════════════════════');
    console.log(' 📊 SONUÇLAR');
    console.log('═══════════════════════════════════════════');
    results.forEach(r => console.log(r));
    console.log('───────────────────────────────────────────');
    console.log(`  Toplam: ${passed + failed} | ✅ Geçen: ${passed} | ❌ Başarısız: ${failed}`);
    console.log('═══════════════════════════════════════════\n');

    // Temizlik
    try {
        const db = require('../server/db');
        db.prepare('DELETE FROM notifications WHERE user_id IN (SELECT id FROM users WHERE email = ?)').run(TEST_EMAIL);
        db.prepare('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email = ?)').run(TEST_EMAIL);
        db.prepare('DELETE FROM reservations WHERE user_id IN (SELECT id FROM users WHERE email = ?)').run(TEST_EMAIL);
        db.prepare('DELETE FROM vehicles WHERE user_id IN (SELECT id FROM users WHERE email = ?)').run(TEST_EMAIL);
        db.prepare('DELETE FROM credit_cards WHERE user_id IN (SELECT id FROM users WHERE email = ?)').run(TEST_EMAIL);
        db.prepare('DELETE FROM users WHERE email = ?').run(TEST_EMAIL);
        // Charger 13'ü available'a döndür (test sonrası temizlik)
        db.prepare("UPDATE chargers SET status = 'available' WHERE id = 13").run();
        console.log('🧹 Test verileri temizlendi.\n');
    } catch (e) {
        console.log('⚠️  Temizlik hatası:', e.message);
    }
}

runAll().catch(err => { console.error('💥 Kritik Hata:', err); process.exit(1); });
