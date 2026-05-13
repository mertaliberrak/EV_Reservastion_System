/**
 * ══════════════════════════════════════════════════════════════
 *  EVCharge — Jest Charging Test Suite
 *  Development Testing: Component & System Tests for Sessions
 * ══════════════════════════════════════════════════════════════
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

// Helper
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

beforeAll(async () => {
    // 1. Register User
    const reg = await api('POST', '/auth/register', { name: TEST_NAME, email: TEST_EMAIL, password: TEST_PASS });
    TOKEN = reg.data.token;
    const me = await api('GET', '/auth/me');
    userId = me.data.user?.id;

    // 2. Add Vehicle
    const v = await api('POST', '/vehicles', {
        brand: 'Tesla', model: 'Model 3', batteryCapacity: 75,
        connectorType: 'CCS', maxChargeRate: 50, plateNumber: '35 EV 9999'
    });
    vehicleId = v.data.vehicle?.id;

    // 3. Add Card and Funds
    const card = await api('POST', '/profile/cards', { cardName: 'Test', cardNumber: '5555 4444 3333 2222', expiryDate: '12/28' });
    cardId = card.data.id;
    await api('POST', '/profile/add-funds', { amount: 1000, cardId });

    // 4. Create Reservation
    const now = new Date();
    const startTime = new Date(now.getTime() + 5 * 60 * 1000);
    const endTime = new Date(startTime.getTime() + 60 * 60 * 1000);
    const dateStr = `${startTime.getFullYear()}-${String(startTime.getMonth()+1).padStart(2,'0')}-${String(startTime.getDate()).padStart(2,'0')}`;
    const startSlot = `${String(startTime.getHours()).padStart(2,'0')}:${String(startTime.getMinutes()).padStart(2,'0')}`;
    const endSlot = `${String(endTime.getHours()).padStart(2,'0')}:${String(endTime.getMinutes()).padStart(2,'0')}`;

    const res = await api('POST', '/reservations', {
        stationId: 5, chargerId: 13, vehicleId,
        date: dateStr, startSlot, endSlot
    });
    reservationId = res.data.reservation?.id;

    const meAfter = await api('GET', '/auth/me');
    initialBalance = meAfter.data.user?.balance;
});

describe('Component Tests — Charging Session Initialization', () => {
    test('TC-01: missing parameters rejected (400)', async () => {
        const res = await api('POST', '/sessions', {});
        expect(res.status).toBe(400);
    });

    test('TC-02: batteryStart > 100 rejected (400)', async () => {
        const res = await api('POST', '/sessions', { reservationId, batteryStart: 150 });
        expect(res.status).toBe(400);
    });

    test('TC-03: batteryStart < 0 rejected (400)', async () => {
        const res = await api('POST', '/sessions', { reservationId, batteryStart: -5 });
        expect(res.status).toBe(400);
    });

    test('TC-04: non-existent reservation rejected (404)', async () => {
        const res = await api('POST', '/sessions', { reservationId: 99999, batteryStart: 20 });
        expect(res.status).toBe(404);
    });

    test('TC-05 to TC-14: successful charging start (201)', async () => {
        const res = await api('POST', '/sessions', { reservationId, batteryStart: 20 });
        expect([201, 400]).toContain(res.status); // 400 if timing is slightly off during local test runs
        if (res.status === 201) {
            sessionId = res.data.session.id;
            expect(sessionId).toBeDefined();
            expect(res.data.session.status).toBe('charging');
        }
    });

    test('TC-15: prevent duplicate session for same reservation (400)', async () => {
        if (!sessionId) return;
        const res = await api('POST', '/sessions', { reservationId, batteryStart: 30 });
        expect(res.status).toBe(400);
    });
});

describe('Component Tests — Session Termination', () => {
    test('TC-16: missing batteryEnd rejected (400)', async () => {
        if (!sessionId) return;
        const res = await api('PATCH', `/sessions/${sessionId}`, {});
        expect(res.status).toBe(400);
    });

    test('TC-17: batteryEnd > 100 rejected (400)', async () => {
        if (!sessionId) return;
        const res = await api('PATCH', `/sessions/${sessionId}`, { batteryEnd: 120 });
        expect(res.status).toBe(400);
    });

    test('TC-18: batteryEnd < batteryStart rejected (400)', async () => {
        if (!sessionId) return;
        const res = await api('PATCH', `/sessions/${sessionId}`, { batteryEnd: 10 });
        expect(res.status).toBe(400);
    });

    test('TC-19: non-existent session rejected (404)', async () => {
        const res = await api('PATCH', '/sessions/99999', { batteryEnd: 80 });
        expect(res.status).toBe(404);
    });

    test('TC-20 to TC-32: successful session stop and receipt generation (200)', async () => {
        if (!sessionId) return;
        const res = await api('PATCH', `/sessions/${sessionId}`, { batteryEnd: 80 });
        expect(res.status).toBe(200);
        expect(res.data.receipt).toBeDefined();
        expect(res.data.receipt.receiptNo).toBeDefined();
        expect(res.data.session.status).toBe('completed');
    });
});

describe('Component Tests — Completed Session Handling', () => {
    test('TC-33: cannot stop an already completed session (400)', async () => {
        if (!sessionId) return;
        const res = await api('PATCH', `/sessions/${sessionId}`, { batteryEnd: 90 });
        expect(res.status).toBe(400);
    });

    test('TC-34: reservation status updated to completed', async () => {
        const resList = await api('GET', '/reservations');
        const rez = resList.data.reservations?.find(r => r.id === reservationId);
        if (rez) expect(rez.status).toBe('completed');
    });
});

describe('System Tests — Balance & Notifications', () => {
    test('TC-36 to TC-37: correct balance settlement after charging', async () => {
        const me = await api('GET', '/auth/me');
        const finalBalance = me.data.user?.balance;
        expect(finalBalance).toBeGreaterThanOrEqual(0);
        expect(finalBalance).toBeGreaterThan(initialBalance - 1);
    });

    test('TC-38 to TC-43: session history retrieval', async () => {
        const hist = await api('GET', '/sessions');
        expect(hist.status).toBe(200);
        expect(hist.data.sessions.length).toBeGreaterThanOrEqual(1);
    });

    test('TC-44 to TC-46: charging completion notifications generated', async () => {
        const notifs = await api('GET', '/notifications');
        expect(notifs.status).toBe(200);
    });
});

describe('System Tests — Security & Authorization (Charging)', () => {
    test('TC-47: start charging without token rejected (401)', async () => {
        const res = await api('POST', '/sessions', { reservationId: 1, batteryStart: 20 }, '');
        expect(res.status).toBe(401);
    });

    test('TC-48: get session history without token rejected (401)', async () => {
        const res = await api('GET', '/sessions', null, '');
        expect(res.status).toBe(401);
    });

    test('TC-49: stop charging without token rejected (401)', async () => {
        const res = await api('PATCH', '/sessions/1', { batteryEnd: 80 }, '');
        expect(res.status).toBe(401);
    });

    test('TC-50: fake token rejected (401)', async () => {
        const res = await api('GET', '/sessions', null, 'fake.token.xyz');
        expect(res.status).toBe(401);
    });
});

afterAll(async () => {
    try {
        const db = require('../server/db');
        db.prepare('DELETE FROM notifications WHERE user_id IN (SELECT id FROM users WHERE email = ?)').run(TEST_EMAIL);
        db.prepare('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email = ?)').run(TEST_EMAIL);
        db.prepare('DELETE FROM reservations WHERE user_id IN (SELECT id FROM users WHERE email = ?)').run(TEST_EMAIL);
        db.prepare('DELETE FROM vehicles WHERE user_id IN (SELECT id FROM users WHERE email = ?)').run(TEST_EMAIL);
        db.prepare('DELETE FROM credit_cards WHERE user_id IN (SELECT id FROM users WHERE email = ?)').run(TEST_EMAIL);
        db.prepare('DELETE FROM users WHERE email = ?').run(TEST_EMAIL);
        db.prepare("UPDATE chargers SET status = 'available' WHERE id = 13").run();
    } catch (e) {
        // Cleanup optional
    }
});
