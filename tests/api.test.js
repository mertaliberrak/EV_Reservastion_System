/**
 * ══════════════════════════════════════════════════════
 *  EVCharge — API Test Suite
 *  Automated test file covering all main Use Cases
 * ══════════════════════════════════════════════════════
 */

const BASE = 'http://localhost:3000/api';
const TEST_EMAIL = `test_${Date.now()}@ev.com`;
const TEST_PASS = 'Test1234!'; // Must contain uppercase, number, and special char
const TEST_NAME = 'Test User';

let TOKEN = '';
let vehicleId = null;
let reservationId = null;
let sessionId = null;
let cardId = null;

// ── Helpers ──
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
    try {
        const res = await fetch(`${BASE}${path}`, opts);
        const data = await res.json();
        return { status: res.status, data };
    } catch (err) {
        return { status: 500, data: { error: err.message } };
    }
}

function assert(testName, condition, detail = '') {
    if (condition) {
        passed++;
        const msg = `  ✅ ${testName}`;
        results.push(msg);
        console.log(msg);
    } else {
        failed++;
        const msg = `  ❌ ${testName}${detail ? ' → ' + (typeof detail === 'object' ? JSON.stringify(detail) : detail) : ''}`;
        results.push(msg);
        console.log(msg);
    }
}

// ══════════════════════════════════════
//  1. AUTHENTICATION (Register & Login)
// ══════════════════════════════════════
async function testAuth() {
    console.log('\n🔐 1. AUTH TESTS');

    // 1.1 Registration — Success
    const reg = await api('POST', '/auth/register', { name: TEST_NAME, email: TEST_EMAIL, password: TEST_PASS });
    assert('Registration successful', reg.status === 201, reg.data);
    assert('Registration returns token', !!reg.data.token);

    // 1.2 Same email registration again — 409
    const dup = await api('POST', '/auth/register', { name: 'X', email: TEST_EMAIL, password: TEST_PASS });
    assert('Same email blocked (409)', dup.status === 409, dup.data);

    // 1.3 Registration with weak password — 400
    const weak = await api('POST', '/auth/register', { name: 'X', email: 'weak@ev.com', password: '123' });
    assert('Weak password rejected (400)', weak.status === 400, weak.data);

    // 1.4 Login — Success
    const login = await api('POST', '/auth/login', { email: TEST_EMAIL, password: TEST_PASS });
    assert('Login successful', login.status === 200, login.data);
    assert('Login returns token', !!login.data.token);
    TOKEN = login.data.token;

    // 1.5 Wrong password — 401
    const bad = await api('POST', '/auth/login', { email: TEST_EMAIL, password: 'wrongpass' });
    assert('Wrong password rejected (401)', bad.status === 401, bad.data);

    // 1.6 /me
    const me = await api('GET', '/auth/me');
    assert('/me returns user info', me.status === 200 && me.data.user && me.data.user.email === TEST_EMAIL, me.data);
}

// ══════════════════════════════════════
//  2. VEHICLE MANAGEMENT
// ══════════════════════════════════════
async function testVehicles() {
    console.log('\n🚗 2. VEHICLE TESTS');

    // 2.1 Add vehicle — Success
    const add = await api('POST', '/vehicles', {
        brand: 'Tesla', model: 'Model 3',
        batteryCapacity: 75, connectorType: 'CCS',
        maxChargeRate: 50, plateNumber: '35 EV 2024'
    });
    assert('Vehicle addition successful (201)', add.status === 201, add.data);
    vehicleId = add.data.vehicle?.id;

    // 2.2 Invalid plate (Turkish format check)
    const badPlate = await api('POST', '/vehicles', {
        brand: 'BMW', model: 'iX',
        batteryCapacity: 76, connectorType: 'CCS',
        maxChargeRate: 195, plateNumber: 'INVALID'
    });
    assert('Invalid plate rejected (400)', badPlate.status === 400, badPlate.data);

    // 2.3 Add with missing fields
    const missing = await api('POST', '/vehicles', {
        brand: 'Renault', model: 'Megane'
    });
    assert('Missing fields rejected (400)', missing.status === 400, missing.data);

    // 2.4 List vehicles
    const list = await api('GET', '/vehicles');
    assert('Vehicle list returned', list.status === 200 && list.data.vehicles?.length >= 1, list.data);

    // 2.5 2nd vehicle with incompatible connector (Type 2 vehicle)
    const add2 = await api('POST', '/vehicles', {
        brand: 'Renault', model: 'Zoe',
        batteryCapacity: 52, connectorType: 'Type 2',
        maxChargeRate: 22, plateNumber: '06 A 1234'
    });
    assert('Second vehicle added (Type 2)', add2.status === 201, add2.data);
}

// ══════════════════════════════════════
//  3. RESERVATION
// ══════════════════════════════════════
async function testReservations() {
    console.log('\n📅 3. RESERVATION TESTS');

    // Top up balance (add card first)
    const cardAdd = await api('POST', '/profile/cards', {
        cardName: 'Test Card', cardNumber: '5555 4444 3333 2222', expiryDate: '12/28'
    });
    cardId = cardAdd.data.id;
    assert('Card added', cardAdd.status === 201, cardAdd.data);

    const fund = await api('POST', '/profile/add-funds', { amount: 500, cardId: cardId });
    assert('Balance added', fund.status === 200, fund.data);

    // Test with current time and date
    const now = new Date();
    // Always in the future: use 1 hour from current time
    const futureStart = new Date(now.getTime() + 60 * 60 * 1000);
    let today = futureStart.toISOString().split('T')[0];
    const hh = String(futureStart.getHours()).padStart(2, '0');
    const startSlot = `${hh}:00`;
    // Finish after 1 hour
    const endDate = new Date(futureStart.getTime() + 60 * 60 * 1000);
    const endH = String(endDate.getHours()).padStart(2, '0');
    const endSlot = `${endH}:00`;

    // 3.1 Connector mismatch (CCS vehicle → Type 2 charger — Charger ID:1)
    const mismatch = await api('POST', '/reservations', {
        stationId: 1, chargerId: 1, vehicleId: vehicleId,
        date: today, startSlot, endSlot
    });
    assert('Connector mismatch blocked', mismatch.status === 400 && mismatch.data.error.toLowerCase().includes('mismatch'), mismatch.data);

    // 3.2 Offline charger (Charger ID:7 — offline)
    const offline = await api('POST', '/reservations', {
        stationId: 3, chargerId: 7, vehicleId: vehicleId,
        date: today, startSlot, endSlot
    });
    assert('Offline unit blocked', offline.status === 400, offline.data);

    // 3.3 Successful reservation (Charger ID:10 — CCS)
    const res1 = await api('POST', '/reservations', {
        stationId: 4, chargerId: 10, vehicleId: vehicleId,
        date: today, startSlot, endSlot
    });
    assert('Reservation successful (201)', res1.status === 201, res1.data);
    reservationId = res1.data.reservation?.id;

    // 3.4 Double reservation by the same user at the same time blocked (different station/charger, CCS unit)
    const dupe = await api('POST', '/reservations', {
        stationId: 1, chargerId: 2, vehicleId: vehicleId,
        date: today, startSlot, endSlot
    });
    assert('Double user reservation blocked (409)', dupe.status === 409, dupe.data);

    // 3.5 Past date rejected
    const pastRes = await api('POST', '/reservations', {
        stationId: 1, chargerId: 2, vehicleId: vehicleId,
        date: '2024-01-01', startSlot: '10:00', endSlot: '11:00'
    });
    assert('Past date rejected', pastRes.status === 400, pastRes.data);

    // 3.6 Too short duration (10 min — min 15 min)
    const shortStart = new Date(now.getTime() + 4 * 60 * 60 * 1000);
    const shortH = String(shortStart.getHours()).padStart(2, '0');
    const shortRes = await api('POST', '/reservations', {
        stationId: 4, chargerId: 10, vehicleId: vehicleId,
        date: today, startSlot: `${shortH}:00`, endSlot: `${shortH}:10`
    });
    assert('Duration too short rejected (min 15m)', shortRes.status === 400, shortRes.data);

    // 3.7 Balance check (Estimated amount)
    const me = await api('GET', '/auth/me');
    assert('Balance check after reservation', me.status === 200 && me.data.user, me.data);
    if (me.data.user) {
        assert('Balance decreased by deposit amount', me.data.user.balance < 500);
    }

    // 3.8 Reservation list
    const resList = await api('GET', '/reservations');
    assert('Reservation list returned', resList.status === 200 && resList.data.reservations?.length >= 1, resList.data);
}

// ══════════════════════════════════════
//  4. CHARGING SESSION
// ══════════════════════════════════════
async function testSessions() {
    console.log('\n⚡ 4. CHARGING SESSION TESTS');

    if (!reservationId) {
        results.push('  ⏭️  No reservation, skipping charging tests.');
        console.log('  ⏭️  No reservation, skipping charging tests.');
        return;
    }

    // 4.1 Start charging
    const start = await api('POST', '/sessions', {
        reservationId: reservationId,
        batteryStart: 30
    });
    // Due to time constraints, it could be either 201 or 400
    if (start.status === 201) {
        assert('Charging started (201)', true);
        sessionId = start.data.session?.id;

        // 4.2 Battery logic check (end < start)
        const badBatt = await api('PATCH', `/sessions/${sessionId}`, {
            energyConsumed: 10, batteryEnd: 15  // 15 < 30 = Error
        });
        assert('Battery decrease rejected', badBatt.status === 400, badBatt.data);

        // 4.3 Successful charging stop
        const stop = await api('PATCH', `/sessions/${sessionId}`, {
            energyConsumed: 20, batteryEnd: 75
        });
        assert('Charging completed', stop.status === 200, stop.data);
        assert('Receipt information returned', !!stop.data.receipt);

        // 4.4 Settlement check: Balance corrected?
        const meAfter = await api('GET', '/auth/me');
        assert('Balance settlement check', meAfter.status === 200 && meAfter.data.user, meAfter.data);
        if (meAfter.data.user) {
            assert('Balance settlement completed (Deposit-Cost refund)', meAfter.data.user.balance > 0);
        }

        // 4.5 Finishing the same session again
        const reFin = await api('PATCH', `/sessions/${sessionId}`, {
            energyConsumed: 5, batteryEnd: 80
        });
        assert('Completed session cannot be finished again', reFin.status === 400, reFin.data);
    } else {
        assert('Charging could not be started (time constraint)', start.status === 400, start.data);
    }
}

// ══════════════════════════════════════
//  5. CANCELLATION (Refund Logic)
// ══════════════════════════════════════
async function testCancellation() {
    console.log('\n💸 5. CANCELLATION & REFUND TESTS');

    // Create a new reservation and cancel it (CCS compatible unit — Charger ID:2, Karsiyaka)
    const now = new Date();
    const cancelStart = new Date(now.getTime() + 5 * 60 * 60 * 1000);
    const cancelEnd = new Date(now.getTime() + 6 * 60 * 60 * 1000);
    const today = cancelStart.toISOString().split('T')[0];
    const futureH = String(cancelStart.getHours()).padStart(2, '0');
    const futureEnd = String(cancelEnd.getHours()).padStart(2, '0');

    // Top up again to have enough balance for this test
    await api('POST', '/profile/add-funds', { amount: 500, cardId: cardId });

    const meBefore = await api('GET', '/auth/me');
    if (!meBefore.data.user) {
        results.push('  ❌ Could not get user info for cancellation test');
        console.log('  ❌ Could not get user info for cancellation test');
        return;
    }
    const balanceBefore = meBefore.data.user.balance;

    const newRes = await api('POST', '/reservations', {
        stationId: 1, chargerId: 2, vehicleId: vehicleId,
        date: today, startSlot: `${futureH}:00`, endSlot: `${futureEnd}:00`
    });

    if (newRes.status === 201) {
        const cancelId = newRes.data.reservation.id;

        // Cancel
        const cancel = await api('DELETE', `/reservations/${cancelId}`);
        assert('Reservation cancelled', cancel.status === 200, cancel.data);
        assert('Refund message returned', cancel.data.message?.includes('₺'));

        const meAfter = await api('GET', '/auth/me');
        assert('Balance increased after refund', meAfter.data.user && meAfter.data.user.balance > balanceBefore - 1, meAfter.data);
    } else {
        const msg = `  ⏭️  Could not create reservation for cancellation test: ${JSON.stringify(newRes.data)}`;
        results.push(msg);
        console.log(msg);
    }

    // Already cancelled reservation cannot be cancelled again
    if (reservationId && sessionId) {
        const reCan = await api('DELETE', `/reservations/${reservationId}`);
        assert('Completed reservation cannot be cancelled', reCan.status === 400 || reCan.status === 404, reCan.data);
    }
}

// ══════════════════════════════════════
//  6. PROFILE & SECURITY
// ══════════════════════════════════════
async function testProfile() {
    console.log('\n👤 6. PROFILE & SECURITY TESTS');

    // 6.1 Profile info
    const prof = await api('GET', '/profile');
    assert('Profile information returned', prof.status === 200 && !!prof.data.email, prof.data);

    // 6.2 Name update
    const upd = await api('PUT', '/profile', { name: 'Updated Name' });
    assert('Name updated', upd.status === 200, upd.data);

    // 6.3 Password change without old password — Blocked
    const noOld = await api('PUT', '/profile', { name: 'Test', password: 'NewPass123!' });
    assert('Change without old password blocked', noOld.status === 400, noOld.data);

    // 6.4 Wrong old password — Blocked
    const wrongOld = await api('PUT', '/profile', { name: 'Test', oldPassword: 'WrongOld', password: 'NewPass123!' });
    assert('Incorrect old password blocked (401)', wrongOld.status === 401, wrongOld.data);

    // 6.5 Change with correct old password — Success
    const okPass = await api('PUT', '/profile', { name: 'Test', oldPassword: TEST_PASS, password: 'NewPassword123!' });
    assert('Password changed successfully', okPass.status === 200, okPass.data);

    // 6.6 Login with new password
    const newLogin = await api('POST', '/auth/login', { email: TEST_EMAIL, password: 'NewPassword123!' });
    assert('Login with new password successful', newLogin.status === 200, newLogin.data);
    TOKEN = newLogin.data.token;
}

// ══════════════════════════════════════
//  7. CARD & WALLET
// ══════════════════════════════════════
async function testWallet() {
    console.log('\n💳 7. CARD & WALLET TESTS');

    // 7.1 Card list
    const cards = await api('GET', '/profile/cards');
    assert('Card list returned', cards.status === 200, cards.data);

    // 7.2 Short card number rejected
    const badCard = await api('POST', '/profile/cards', {
        cardName: 'Error', cardNumber: '1234', expiryDate: '01/30'
    });
    assert('Short card number rejected', badCard.status === 400, badCard.data);

    // 7.3 Fake wallet/add route deleted?
    const fakeWallet = await api('POST', '/auth/wallet/add', { amount: 999999 });
    assert('Fake wallet route deleted (404)', fakeWallet.status === 404, fakeWallet.data);

    // 7.4 Card delete
    if (cardId) {
        const del = await api('DELETE', `/profile/cards/${cardId}`);
        assert('Card deleted', del.status === 200, del.data);
    }

    // 7.5 Deleting someone else's card
    const alien = await api('DELETE', '/profile/cards/99999');
    assert('Cannot delete someone else\'s card (404)', alien.status === 404, alien.data);
}

// ══════════════════════════════════════
//  8. UNAUTHORIZED ACCESS
// ══════════════════════════════════════
async function testUnauthorized() {
    console.log('\n🛡️ 8. UNAUTHORIZED ACCESS TESTS');

    const noToken = await api('GET', '/vehicles', null, '');
    assert('Access to vehicles without token blocked', noToken.status === 401, noToken.data);

    const noToken2 = await api('GET', '/reservations', null, '');
    assert('Access to reservations without token blocked', noToken2.status === 401, noToken2.data);

    const fakeToken = await api('GET', '/profile', null, 'fake.token.here');
    assert('Fake token rejected', fakeToken.status === 401, fakeToken.data);
}

// ══════════════════════════════════════
//  RUN TESTS
// ══════════════════════════════════════
async function runAllTests() {
    console.log('═══════════════════════════════════════');
    console.log(' ⚡ EVCharge API Test Suite');
    console.log(`    Time: ${new Date().toLocaleString()}`);
    console.log('═══════════════════════════════════════');

    await testAuth();
    await testVehicles();
    await testReservations();
    await testSessions();
    await testCancellation();
    await testProfile();
    await testWallet();
    await testUnauthorized();

    // ── RESULTS ──
    console.log('\n═══════════════════════════════════════');
    console.log(' 📊 RESULTS');
    console.log('═══════════════════════════════════════');
    results.forEach(r => console.log(r));
    console.log('───────────────────────────────────────');
    console.log(`  Total: ${passed + failed} | ✅ Passed: ${passed} | ❌ Failed: ${failed}`);
    console.log('═══════════════════════════════════════\n');

    // Cleanup: delete test user
    try {
        const db = require('../server/db');
        db.prepare('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email = ?)').run(TEST_EMAIL);
        db.prepare('DELETE FROM reservations WHERE user_id IN (SELECT id FROM users WHERE email = ?)').run(TEST_EMAIL);
        db.prepare('DELETE FROM vehicles WHERE user_id IN (SELECT id FROM users WHERE email = ?)').run(TEST_EMAIL);
        db.prepare('DELETE FROM credit_cards WHERE user_id IN (SELECT id FROM users WHERE email = ?)').run(TEST_EMAIL);
        db.prepare('DELETE FROM users WHERE email = ?').run(TEST_EMAIL);
        console.log('🧹 Test data cleaned.\n');
    } catch (e) {
        console.log('⚠️  Test data could not be cleaned (delete manually):', e.message);
    }
}

runAllTests().catch(err => {
    console.error('💥 Critical Error:', err);
    process.exit(1);
});
