import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/server';
import { config } from '../src/config';
import { setSystemAuthSettings } from '../src/services/aiSettings';
import crypto from 'node:crypto';

function cookie(sub: string, email: string): string {
  const payload = Buffer.from(JSON.stringify({ provider: 'google', sub, email }), 'utf8').toString('base64url');
  const signature = crypto.createHmac('sha256', config.authSessionSecret).update(payload).digest('base64url');
  return `makeslide_session=${encodeURIComponent(`${payload}.${signature}`)}`;
}

const A = { cookie: cookie('grp-user-a', 'a@example.com'), 'content-type': 'application/json' };
const B = { cookie: cookie('grp-user-b', 'b@example.com'), 'content-type': 'application/json' };

setSystemAuthSettings({ googleAuthEnabled: false });

test('create a group with seed members, then add and remove a member', async () => {
  const app = await buildApp();
  try {
    let resp = await app.inject({ method: 'POST', url: '/api/groups', headers: A, payload: { name: 'Class 1', emails: ['stu1@example.com', 'STU2@example.com'] } });
    assert.equal(resp.statusCode, 201);
    const created = resp.json() as { id: string; name: string; members: string[] };
    assert.equal(created.name, 'Class 1');
    assert.deepEqual(created.members.sort(), ['stu1@example.com', 'stu2@example.com']);
    const gid = created.id;

    // add a member
    resp = await app.inject({ method: 'PUT', url: `/api/groups/${gid}/members`, headers: A, payload: { email: 'stu3@example.com' } });
    assert.equal(resp.statusCode, 200);
    assert.equal((resp.json() as { members: string[] }).members.length, 3);

    // remove a member
    resp = await app.inject({ method: 'DELETE', url: `/api/groups/${gid}/members`, headers: A, payload: { email: 'stu1@example.com' } });
    assert.equal(resp.statusCode, 200);
    assert.ok(!(resp.json() as { members: string[] }).members.includes('stu1@example.com'));

    // list shows the group with member_count
    resp = await app.inject({ method: 'GET', url: '/api/groups', headers: A });
    const groups = (resp.json() as { groups: Array<{ id: string; member_count: number }> }).groups;
    const g = groups.find((x) => x.id === gid);
    assert.ok(g);
    assert.equal(g!.member_count, 2);
  } finally {
    await app.close();
  }
});

test('rename and delete a group', async () => {
  const app = await buildApp();
  try {
    const created = (await app.inject({ method: 'POST', url: '/api/groups', headers: A, payload: { name: 'Temp' } })).json() as { id: string };
    let resp = await app.inject({ method: 'PATCH', url: `/api/groups/${created.id}`, headers: A, payload: { name: 'Renamed' } });
    assert.equal(resp.statusCode, 200);
    assert.equal((resp.json() as { name: string }).name, 'Renamed');

    resp = await app.inject({ method: 'DELETE', url: `/api/groups/${created.id}`, headers: A });
    assert.equal(resp.statusCode, 200);
    resp = await app.inject({ method: 'GET', url: `/api/groups/${created.id}`, headers: A });
    assert.equal(resp.statusCode, 404);
  } finally {
    await app.close();
  }
});

test('a group is private to its owner', async () => {
  const app = await buildApp();
  try {
    const created = (await app.inject({ method: 'POST', url: '/api/groups', headers: A, payload: { name: 'Private' } })).json() as { id: string };
    // B cannot see or modify A's group
    let resp = await app.inject({ method: 'GET', url: `/api/groups/${created.id}`, headers: B });
    assert.equal(resp.statusCode, 404);
    resp = await app.inject({ method: 'PATCH', url: `/api/groups/${created.id}`, headers: B, payload: { name: 'Hijack' } });
    assert.equal(resp.statusCode, 404);
    // B's own list does not include it
    resp = await app.inject({ method: 'GET', url: '/api/groups', headers: B });
    const ids = (resp.json() as { groups: Array<{ id: string }> }).groups.map((g) => g.id);
    assert.ok(!ids.includes(created.id));
  } finally {
    await app.close();
  }
});

test('group endpoints require authentication', async () => {
  const app = await buildApp();
  try {
    const resp = await app.inject({ method: 'GET', url: '/api/groups' });
    assert.equal(resp.statusCode, 401);
  } finally {
    await app.close();
  }
});
