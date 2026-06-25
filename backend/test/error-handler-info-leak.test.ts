import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/server';

function withNodeEnv<T>(value: string | undefined, fn: () => Promise<T>): Promise<T> {
  const original = process.env.NODE_ENV;
  if (value === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = value;
  return fn().finally(() => {
    if (original === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = original;
  });
}

const SENSITIVE_MESSAGE = "ENOENT: no such file or directory, open '/home/cluster/devel/makeslide/data/storage/secret-pdf-id/pages/001.jpg'";

test('global error handler hides the raw error message for an unexpected 500 in production', async () => {
  await withNodeEnv('production', async () => {
    const app = await buildApp();
    app.get('/__test-throw', async () => {
      throw new Error(SENSITIVE_MESSAGE);
    });
    try {
      const res = await app.inject({ method: 'GET', url: '/__test-throw' });
      assert.equal(res.statusCode, 500);
      const body = res.json() as { error: { code: string; message: string } };
      assert.equal(body.error.code, 'INTERNAL_ERROR');
      assert.doesNotMatch(body.error.message, /ENOENT|storage|secret-pdf-id/);
      assert.equal(body.error.message, '系統發生未預期的錯誤，請稍後再試');
    } finally {
      await app.close();
    }
  });
});

test('global error handler keeps the raw error message outside production for debugging', async () => {
  await withNodeEnv('test', async () => {
    const app = await buildApp();
    app.get('/__test-throw', async () => {
      throw new Error(SENSITIVE_MESSAGE);
    });
    try {
      const res = await app.inject({ method: 'GET', url: '/__test-throw' });
      assert.equal(res.statusCode, 500);
      const body = res.json() as { error: { code: string; message: string } };
      assert.equal(body.error.code, 'INTERNAL_ERROR');
      assert.equal(body.error.message, SENSITIVE_MESSAGE);
    } finally {
      await app.close();
    }
  });
});

test('global error handler hides the raw message for any 5xx (e.g. 502) in production', async () => {
  await withNodeEnv('production', async () => {
    const app = await buildApp();
    app.get('/__test-throw-502', async () => {
      const err = new Error(SENSITIVE_MESSAGE) as Error & { statusCode: number };
      err.statusCode = 502;
      throw err;
    });
    try {
      const res = await app.inject({ method: 'GET', url: '/__test-throw-502' });
      assert.equal(res.statusCode, 502);
      const body = res.json() as { error: { code: string; message: string } };
      assert.equal(body.error.code, 'INTERNAL_ERROR');
      assert.doesNotMatch(body.error.message, /ENOENT|storage|secret-pdf-id/);
      assert.equal(body.error.message, '系統發生未預期的錯誤，請稍後再試');
    } finally {
      await app.close();
    }
  });
});

test('global error handler still returns a known error\'s own message for a non-500 status in production', async () => {
  await withNodeEnv('production', async () => {
    const app = await buildApp();
    app.get('/__test-throw-400', async () => {
      const err = new Error('Specific validation message') as Error & { statusCode: number };
      err.statusCode = 400;
      throw err;
    });
    try {
      const res = await app.inject({ method: 'GET', url: '/__test-throw-400' });
      assert.equal(res.statusCode, 400);
      const body = res.json() as { error: { code: string; message: string } };
      assert.equal(body.error.code, 'REQUEST_ERROR');
      assert.equal(body.error.message, 'Specific validation message');
    } finally {
      await app.close();
    }
  });
});
