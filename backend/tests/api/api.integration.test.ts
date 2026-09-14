/**
 * Tests: API Integration (supertest)
 * ─────────────────────────────────────────────────────────────────────────
 * Tests the HTTP layer using supertest — no real Gmail or Google OAuth calls.
 * Auth is bypassed by mocking the JWT verifier.
 * ─────────────────────────────────────────────────────────────────────────
 */

import request from 'supertest';
import { createApp } from '../../src/app';
import { makeTransaction } from '../helpers/fixtures';

// ── Mock the auth service so we can test protected routes ─────────────────────
jest.mock('../../src/services/auth.service', () => ({
  ...jest.requireActual('../../src/services/auth.service'),
  verifySessionJwt: jest.fn().mockReturnValue({
    userId: 'test_user_google_123',
    email: 'test@example.com',
    name: 'Test User',
    picture: 'https://example.com/photo.jpg',
    encryptedAccessToken: 'mock_encrypted_token',
    encryptedRefreshToken: 'mock_encrypted_refresh',
    tokenExpiryMs: Date.now() + 3600 * 1000,
  }),
  generateAuthUrl: jest.fn().mockReturnValue('https://accounts.google.com/o/oauth2/auth?mock=true'),
  generateOAuthState: jest.fn().mockReturnValue({
    state: 'mock_state_12345',
    signature: 'mock_signature_abcde',
  }),
}));

const app = createApp();
const AUTH_HEADER = { Authorization: 'Bearer mock.jwt.token' };

// ── Health ────────────────────────────────────────────────────────────────────

describe('GET /health', () => {
  test('returns 200 with service info', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('cashflow-backend');
  });
});

// ── Auth endpoints ────────────────────────────────────────────────────────────

describe('POST /auth/google', () => {
  test('returns authUrl and state', async () => {
    const res = await request(app).post('/auth/google');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.authUrl).toBeDefined();
    expect(res.body.data.state).toBeDefined();
  });
});

describe('GET /auth/me', () => {
  test('returns 401 without token', async () => {
    const res = await request(app).get('/auth/me');
    expect(res.status).toBe(401);
  });

  test('returns user profile with valid token', async () => {
    const res = await request(app).get('/auth/me').set(AUTH_HEADER);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user.email).toBe('test@example.com');
    // No OAuth tokens in response
    expect(JSON.stringify(res.body)).not.toContain('access_token');
    expect(JSON.stringify(res.body)).not.toContain('encryptedAccessToken');
  });

  test('PUT /auth/me updates user profile details', async () => {
    const res = await request(app)
      .put('/auth/me')
      .set(AUTH_HEADER)
      .send({
        name: 'Updated Name',
        picture: 'data:image/jpeg;base64,testdata',
        workType: 'business',
      });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user.name).toBe('Updated Name');
    expect(res.body.data.user.picture).toBe('data:image/jpeg;base64,testdata');
    expect(res.body.data.user.workType).toBe('business');
  });
});

describe('POST /auth/refresh', () => {
  test('returns 422 without refreshToken', async () => {
    const res = await request(app).post('/auth/refresh').send({});
    expect(res.status).toBe(422);
  });

  test('returns 401 with invalid refreshToken', async () => {
    const res = await request(app)
      .post('/auth/refresh')
      .send({ refreshToken: 'invalid.token.here' });
    expect(res.status).toBe(401);
  });
});

// ── Transaction endpoints ─────────────────────────────────────────────────────

describe('GET /transactions/schema', () => {
  test('returns schema definition', async () => {
    const res = await request(app).get('/transactions/schema').set(AUTH_HEADER);
    expect(res.status).toBe(200);
    expect(res.body.data.schema.id).toBeDefined();
    expect(res.body.data.schema.amount).toContain('paise');
    expect(res.body.data.notes.atm).toContain('transfer');
  });
});

describe('GET /transactions/categories', () => {
  test('returns category list with Tamil labels', async () => {
    const res = await request(app).get('/transactions/categories').set(AUTH_HEADER);
    expect(res.status).toBe(200);
    const categories = res.body.data.categories;
    expect(Array.isArray(categories)).toBe(true);
    expect(categories.length).toBeGreaterThan(0);

    // ATM category must exist
    const atm = categories.find((c: { id: string }) => c.id === 'atm_withdrawal');
    expect(atm).toBeDefined();
    expect(atm.labelTa).toBeDefined();

    // All categories have Tamil labels
    const allHaveTamil = categories.every((c: { labelTa?: string }) => c.labelTa);
    expect(allHaveTamil).toBe(true);
  });
});

describe('GET /transactions/methods', () => {
  test('returns payment methods', async () => {
    const res = await request(app).get('/transactions/methods').set(AUTH_HEADER);
    expect(res.status).toBe(200);
    const methods = res.body.data.paymentMethods;
    const ids = methods.map((m: { id: string }) => m.id);
    expect(ids).toContain('upi');
    expect(ids).toContain('card');
    expect(ids).toContain('cash');
    expect(ids).toContain('atm');
    expect(ids).toContain('bank');
  });
});

describe('POST /transactions/validate', () => {
  test('returns 401 without auth', async () => {
    const res = await request(app)
      .post('/transactions/validate')
      .send({ transactions: [makeTransaction()] });
    expect(res.status).toBe(401);
  });

  test('validates a batch of valid transactions', async () => {
    const transactions = [makeTransaction(), makeTransaction({ amount: 100000 })];
    const res = await request(app)
      .post('/transactions/validate')
      .set(AUTH_HEADER)
      .send({ transactions });

    expect(res.status).toBe(200);
    expect(res.body.data.valid).toBe(2);
    expect(res.body.data.invalid).toBe(0);
  });

  test('identifies invalid transactions in batch', async () => {
    const transactions = [
      makeTransaction(),                            // valid
      { id: 'bad-id', amount: -1, type: 'invalid' }, // invalid
    ];
    const res = await request(app)
      .post('/transactions/validate')
      .set(AUTH_HEADER)
      .send({ transactions });

    expect(res.status).toBe(200);
    expect(res.body.data.valid).toBe(1);
    expect(res.body.data.invalid).toBe(1);
  });

  test('returns 422 when transactions array is missing', async () => {
    const res = await request(app)
      .post('/transactions/validate')
      .set(AUTH_HEADER)
      .send({});
    expect(res.status).toBe(422);
  });

  test('returns 422 for empty array', async () => {
    const res = await request(app)
      .post('/transactions/validate')
      .set(AUTH_HEADER)
      .send({ transactions: [] });
    expect(res.status).toBe(422);
  });
});

describe('POST /transactions/normalize', () => {
  test('normalizes and returns a valid transaction', async () => {
    const txn = makeTransaction({
      description: '  Payment  ',
      currency: 'inr' as unknown as 'INR',
    });
    const res = await request(app)
      .post('/transactions/normalize')
      .set(AUTH_HEADER)
      .send({ transaction: txn });

    expect(res.status).toBe(200);
    expect(res.body.data.transaction.description).toBe('Payment');
    expect(res.body.data.transaction.currency).toBe('INR');
  });

  test('returns 422 for invalid transaction', async () => {
    const res = await request(app)
      .post('/transactions/normalize')
      .set(AUTH_HEADER)
      .send({ transaction: { amount: 0 } });
    expect(res.status).toBe(422);
    expect(res.body.errors).toBeDefined();
  });

  test('returns 400 when transaction body is missing', async () => {
    const res = await request(app)
      .post('/transactions/normalize')
      .set(AUTH_HEADER)
      .send({});
    expect(res.status).toBe(400);
  });
});

describe('POST /transactions/deduplicate', () => {
  test('detects duplicate against existing', async () => {
    const txn = makeTransaction();
    const res = await request(app)
      .post('/transactions/deduplicate')
      .set(AUTH_HEADER)
      .send({ incoming: txn, existing: [txn] }); // same txn in both

    expect(res.status).toBe(200);
    expect(res.body.data.deduplication.isDuplicate).toBe(true);
    expect(res.body.data.deduplication.confidence).toBe(1.0);
  });

  test('returns not duplicate for different transaction', async () => {
    const incoming = makeTransaction({ amount: 500000 });
    const existing = makeTransaction({
      amount: 999900,
      metadata: { gmailMessageId: 'msg_other' },
    });

    const res = await request(app)
      .post('/transactions/deduplicate')
      .set(AUTH_HEADER)
      .send({ incoming, existing: [existing] });

    expect(res.status).toBe(200);
    expect(res.body.data.deduplication.isDuplicate).toBe(false);
  });

  test('returns 400 when incoming is missing', async () => {
    const res = await request(app)
      .post('/transactions/deduplicate')
      .set(AUTH_HEADER)
      .send({ existing: [] });
    expect(res.status).toBe(400);
  });
});

describe('POST /transactions/manual', () => {
  test('creates a valid manual transaction', async () => {
    const input = {
      date: '2024-08-17T10:00:00.000Z',
      amount: 30000,
      type: 'expense',
      category: 'food',
      paymentMethod: 'cash',
      description: 'Lunch at canteen',
    };

    const res = await request(app)
      .post('/transactions/manual')
      .set(AUTH_HEADER)
      .send(input);

    expect(res.status).toBe(201);
    expect(res.body.data.transaction.source).toBe('manual');
    expect(res.body.data.transaction.confidence).toBe(1.0);
    expect(res.body.data.transaction.id).toBeDefined();
  });

  test('rejects manual transaction with invalid paymentMethod', async () => {
    const input = {
      date: '2024-08-17T10:00:00.000Z',
      amount: 30000,
      type: 'expense',
      category: 'food',
      paymentMethod: 'bitcoin',  // invalid
      description: 'Test',
    };

    const res = await request(app)
      .post('/transactions/manual')
      .set(AUTH_HEADER)
      .send(input);

    expect(res.status).toBe(422);
  });

  test('rejects manual transaction with negative amount', async () => {
    const res = await request(app)
      .post('/transactions/manual')
      .set(AUTH_HEADER)
      .send({
        date: '2024-08-17',
        amount: -500,
        type: 'expense',
        category: 'food',
        paymentMethod: 'cash',
        description: 'Test',
      });
    expect(res.status).toBe(422);
  });
});

// ── Gmail sync endpoint ───────────────────────────────────────────────────────

describe('GET /gmail/sync/status', () => {
  test('returns sync status', async () => {
    const res = await request(app).get('/gmail/sync/status').set(AUTH_HEADER);
    expect(res.status).toBe(200);
    expect(res.body.data.available).toBe(true);
    expect(res.body.data.maxEmailsPerSync).toBeDefined();
  });
});

// ── 404 handler ───────────────────────────────────────────────────────────────

describe('404 handler', () => {
  test('returns 404 for unknown routes', async () => {
    const res = await request(app).get('/nonexistent/route');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('NOT_FOUND');
  });
});

// ── Security headers ──────────────────────────────────────────────────────────

describe('Security headers', () => {
  test('includes security headers on all responses', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBeDefined();
  });
});
