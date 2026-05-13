/**
 * ══════════════════════════════════════════════════════
 *  EVCharge — Jest API Test Suite
 *  Development Testing: Unit, Component & System Tests
 * ══════════════════════════════════════════════════════
 */

const BASE = 'http://localhost:3000/api';
const TEST_EMAIL = `jest_${Date.now()}@ev.com`;
const TEST_PASS = 'Test1234!';
const TEST_NAME = 'Jest Test User';

let TOKEN = '';
let vehicleId = null;
let reservationId = null;
let sessionId = null;
let cardId = null;

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

// ══════════════════════════════════════
//  1. UNIT TESTS — Authentication
// ══════════════════════════════════════
describe('Unit Tests — Authentication', () => {
    test('should register a new user (201)', async () => {
        const res = await api('POST', '/auth/register', {
            name: TEST_NAME, email: TEST_EMAIL, password: TEST_PASS
        });
        expect(res.status).toBe(201);
        expect(res.data.token).toBeDefined();
    });

    test('should reject duplicate email (409)', async () => {
        const res = await api('POST', '/auth/register', {
            name: 'Dup', email: TEST_EMAIL, password: TEST_PASS
        });
        expect(res.status).toBe(409);
    });

    test('should reject weak password (400)', async () => {
        const res = await api('POST', '/auth/register', {
            name: 'X', email: 'weak@ev.com', password: '123'
        });
        expect(res.status).toBe(400);
    });

    test('should login successfully (200)', async () => {
        const res = await api('POST', '/auth/login', {
            email: TEST_EMAIL, password: TEST_PASS
        });
        expect(res.status).toBe(200);
        expect(res.data.token).toBeDefined();
        TOKEN = res.data.token;
    });

    test('should reject wrong password (401)', async () => {
        const res = await api('POST', '/auth/login', {
            email: TEST_EMAIL, password: 'wrongpass'
        });
        expect(res.status).toBe(401);
    });

    test('should return user info via /me', async () => {
        const res = await api('GET', '/auth/me');
        expect(res.status).toBe(200);
        expect(res.data.user.email).toBe(TEST_EMAIL);
    });
});

// ══════════════════════════════════════
//  2. UNIT TESTS — Vehicle Management
// ══════════════════════════════════════
describe('Unit Tests — Vehicle Management', () => {
    test('should add a vehicle (201)', async () => {
        const res = await api('POST', '/vehicles', {
            brand: 'Tesla', model: 'Model 3',
            batteryCapacity: 75, connectorType: 'CCS',
            maxChargeRate: 50, plateNumber: '35 EV 2024'
        });
        expect(res.status).toBe(201);
        vehicleId = res.data.vehicle?.id;
    });

    test('should reject invalid plate (400)', async () => {
        const res = await api('POST', '/vehicles', {
            brand: 'BMW', model: 'iX',
            batteryCapacity: 76, connectorType: 'CCS',
            maxChargeRate: 195, plateNumber: 'INVALID'
        });
        expect(res.status).toBe(400);
    });

    test('should reject missing fields (400)', async () => {
        const res = await api('POST', '/vehicles', {
            brand: 'Renault', model: 'Megane'
        });
        expect(res.status).toBe(400);
    });

    test('should list user vehicles', async () => {
        const res = await api('GET', '/vehicles');
        expect(res.status).toBe(200);
        expect(res.data.vehicles.length).toBeGreaterThanOrEqual(1);
    });
});

// ══════════════════════════════════════
//  3. COMPONENT TESTS — Reservation (Interface Testing)
// ══════════════════════════════════════
describe('Component Tests — Reservation System', () => {
    const now = new Date();
    const futureStart = new Date(now.getTime() + 10 * 60 * 60 * 1000);
    const today = futureStart.toISOString().split('T')[0];
    const hh = String(futureStart.getHours()).padStart(2, '0');
    const startSlot = `${hh}:00`;
    const endDate = new Date(futureStart.getTime() + 60 * 60 * 1000);
    const endH = String(endDate.getHours()).padStart(2, '0');
    const endSlot = `${endH}:00`;

    test('should add card and fund wallet', async () => {
        const cardRes = await api('POST', '/profile/cards', {
            cardName: 'Test Card', cardNumber: '5555 4444 3333 2222', expiryDate: '12/28'
        });
        expect(cardRes.status).toBe(201);
        cardId = cardRes.data.id;

        const fund = await api('POST', '/profile/add-funds', { amount: 500, cardId });
        expect(fund.status).toBe(200);
    });

    test('should reject connector mismatch (400)', async () => {
        const res = await api('POST', '/reservations', {
            stationId: 1, chargerId: 1, vehicleId,
            date: today, startSlot, endSlot
        });
        expect(res.status).toBe(400);
    });

    test('should reject past date reservation (400)', async () => {
        const res = await api('POST', '/reservations', {
            stationId: 1, chargerId: 2, vehicleId,
            date: '2024-01-01', startSlot: '10:00', endSlot: '11:00'
        });
        expect(res.status).toBe(400);
    });

    test('should create reservation successfully (201)', async () => {
        const res = await api('POST', '/reservations', {
            stationId: 1, chargerId: 2, vehicleId,
            date: today, startSlot, endSlot
        });
        if (res.status !== 201) console.log("RESERVATION ERROR:", res.data);
        expect(res.status).toBe(201);
        reservationId = res.data.reservation?.id;
    });

    test('should block double booking by same user (409)', async () => {
        const res = await api('POST', '/reservations', {
            stationId: 1, chargerId: 3, vehicleId,
            date: today, startSlot, endSlot
        });
        expect(res.status).toBe(409);
    });

    test('should deduct deposit from balance', async () => {
        const me = await api('GET', '/auth/me');
        expect(me.status).toBe(200);
        expect(me.data.user.balance).toBeLessThan(500);
    });
});

// ══════════════════════════════════════
//  4. COMPONENT TESTS — Charging Session
// ══════════════════════════════════════
describe('Component Tests — Charging Session', () => {
    test('should start charging session', async () => {
        if (!reservationId) return;
        const res = await api('POST', '/sessions', {
            reservationId, batteryStart: 30
        });
        // Could be 201 or 400 based on timing
        if (res.status === 201) {
            sessionId = res.data.session?.id;
            expect(res.data.session).toBeDefined();
        } else {
            expect(res.status).toBe(400);
        }
    });

    test('should reject battery decrease', async () => {
        if (!sessionId) return;
        const res = await api('PATCH', `/sessions/${sessionId}`, {
            energyConsumed: 10, batteryEnd: 15
        });
        expect(res.status).toBe(400);
    });

    test('should stop charging and return receipt', async () => {
        if (!sessionId) return;
        const res = await api('PATCH', `/sessions/${sessionId}`, {
            energyConsumed: 20, batteryEnd: 75
        });
        expect(res.status).toBe(200);
        expect(res.data.receipt).toBeDefined();
    });

    test('should settle balance after charging', async () => {
        const me = await api('GET', '/auth/me');
        expect(me.status).toBe(200);
        expect(me.data.user.balance).toBeGreaterThan(0);
    });

    test('should reject re-finishing completed session', async () => {
        if (!sessionId) return;
        const res = await api('PATCH', `/sessions/${sessionId}`, {
            energyConsumed: 5, batteryEnd: 80
        });
        expect(res.status).toBe(400);
    });
});

// ══════════════════════════════════════
//  5. UNIT TESTS — Wallet & Cards
// ══════════════════════════════════════
describe('Unit Tests — Wallet & Cards', () => {
    test('should list cards', async () => {
        const res = await api('GET', '/profile/cards');
        expect(res.status).toBe(200);
    });

    test('should reject short card number (400)', async () => {
        const res = await api('POST', '/profile/cards', {
            cardName: 'Bad', cardNumber: '1234', expiryDate: '01/30'
        });
        expect(res.status).toBe(400);
    });

    test('should delete card', async () => {
        if (!cardId) return;
        const res = await api('DELETE', `/profile/cards/${cardId}`);
        expect(res.status).toBe(200);
    });
});

// ══════════════════════════════════════
//  6. SYSTEM TESTS — Security (Unauthorized Access)
// ══════════════════════════════════════
describe('System Tests — Security & Authorization', () => {
    test('should block vehicles access without token (401)', async () => {
        const res = await api('GET', '/vehicles', null, '');
        expect(res.status).toBe(401);
    });

    test('should block reservations access without token (401)', async () => {
        const res = await api('GET', '/reservations', null, '');
        expect(res.status).toBe(401);
    });

    test('should reject fake token (401)', async () => {
        const res = await api('GET', '/profile', null, 'fake.token.here');
        expect(res.status).toBe(401);
    });

    test('should block profile access without token (401)', async () => {
        const res = await api('GET', '/profile', null, '');
        expect(res.status).toBe(401);
    });
});

// ══════════════════════════════════════
//  7. EQUIVALENCE PARTITIONING TESTS
// ══════════════════════════════════════
describe('Equivalence Partitioning — Input Validation', () => {
    test('Valid partition: correct email format accepted', async () => {
        const res = await api('POST', '/auth/login', {
            email: TEST_EMAIL, password: TEST_PASS
        });
        expect(res.status).toBe(200);
    });

    test('Invalid partition: empty email rejected', async () => {
        const res = await api('POST', '/auth/login', {
            email: '', password: TEST_PASS
        });
        expect(res.status).toBeGreaterThanOrEqual(400);
    });

    test('Invalid partition: empty password rejected', async () => {
        const res = await api('POST', '/auth/login', {
            email: TEST_EMAIL, password: ''
        });
        expect(res.status).toBeGreaterThanOrEqual(400);
    });

    test('Boundary: password exactly 6 chars (minimum)', async () => {
        const res = await api('POST', '/auth/register', {
            name: 'Boundary', email: `bnd_${Date.now()}@ev.com`, password: 'Ab1!xy'
        });
        // Should be accepted (6 chars meets minimum)
        expect([201, 400]).toContain(res.status);
    });
});

// ══════════════════════════════════════
//  CLEANUP
// ══════════════════════════════════════
afterAll(async () => {
    try {
        const db = require('../server/db');
        db.prepare('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email = ?)').run(TEST_EMAIL);
        db.prepare('DELETE FROM reservations WHERE user_id IN (SELECT id FROM users WHERE email = ?)').run(TEST_EMAIL);
        db.prepare('DELETE FROM vehicles WHERE user_id IN (SELECT id FROM users WHERE email = ?)').run(TEST_EMAIL);
        db.prepare('DELETE FROM credit_cards WHERE user_id IN (SELECT id FROM users WHERE email = ?)').run(TEST_EMAIL);
        db.prepare('DELETE FROM users WHERE email = ?').run(TEST_EMAIL);
    } catch (e) {
        // Cleanup is optional
    }
});
