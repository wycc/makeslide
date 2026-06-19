import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../src/config';
import {
  BUILT_IN_SKILLS,
  createUserSkill,
  deleteUserSkill,
  getEnabledSkillPrompts,
  listSkills,
  toggleBuiltInSkill,
  updateUserSkill,
} from '../src/services/skills';

const ACCOUNT_ID = 'skills-service-test-20260619';
const ACCOUNT_DIR = path.join(config.repoRoot, 'accounts', ACCOUNT_ID);
const SKILLS_FILE = path.join(ACCOUNT_DIR, 'skills.json');

function cleanupAccountDir(): void {
  fs.rmSync(ACCOUNT_DIR, { recursive: true, force: true });
}

function readPersistedSkills(): {
  userSkills: unknown[];
  enabledBuiltIns: string[];
} {
  return JSON.parse(fs.readFileSync(SKILLS_FILE, 'utf8')) as {
    userSkills: unknown[];
    enabledBuiltIns: string[];
  };
}

test.beforeEach(() => {
  cleanupAccountDir();
});

test.afterEach(() => {
  cleanupAccountDir();
});

test('listSkills merges built-in and user skills with correct enabled state', async () => {
  const builtInId = BUILT_IN_SKILLS[0]?.id;
  assert.ok(builtInId);

  assert.equal(await toggleBuiltInSkill(ACCOUNT_ID, builtInId), true);
  const userSkill = await createUserSkill(ACCOUNT_ID, {
    name: '  Test Writer  ',
    prompt: '  Use test examples.  ',
    applyTo: 'all',
  });
  await updateUserSkill(ACCOUNT_ID, userSkill.id, { enabled: false });

  const skills = listSkills(ACCOUNT_ID);
  const builtIns = skills.filter((skill) => skill.isBuiltIn);
  const users = skills.filter((skill) => !skill.isBuiltIn);

  assert.equal(builtIns.length, BUILT_IN_SKILLS.length);
  assert.equal(users.length, 1);
  assert.equal(skills[0]?.id, BUILT_IN_SKILLS[0]?.id);
  assert.equal(skills.at(-1)?.id, userSkill.id);
  assert.equal(skills.find((skill) => skill.id === builtInId)?.enabled, true);
  assert.equal(skills.find((skill) => skill.id === BUILT_IN_SKILLS[1]?.id)?.enabled, false);
  assert.deepEqual(users[0], {
    ...userSkill,
    name: 'Test Writer',
    prompt: 'Use test examples.',
    enabled: false,
  });
});

test('createUserSkill, updateUserSkill, and deleteUserSkill persist CRUD changes', async () => {
  const created = await createUserSkill(ACCOUNT_ID, {
    name: '  Draft Skill  ',
    prompt: '  Draft prompt.  ',
    applyTo: 'script',
  });

  assert.match(created.id, /^skill-/);
  assert.equal(created.name, 'Draft Skill');
  assert.equal(created.prompt, 'Draft prompt.');
  assert.equal(created.applyTo, 'script');
  assert.equal(created.enabled, true);
  assert.equal(created.isBuiltIn, false);
  assert.ok(Date.parse(created.createdAt));
  assert.deepEqual(readPersistedSkills().userSkills, [created]);

  const updated = await updateUserSkill(ACCOUNT_ID, created.id, {
    name: '  Updated Skill  ',
    prompt: '  Updated prompt.  ',
    applyTo: 'all',
    enabled: false,
  });

  assert.ok(updated);
  assert.equal(updated.id, created.id);
  assert.equal(updated.createdAt, created.createdAt);
  assert.equal(updated.name, 'Updated Skill');
  assert.equal(updated.prompt, 'Updated prompt.');
  assert.equal(updated.applyTo, 'all');
  assert.equal(updated.enabled, false);
  assert.deepEqual(readPersistedSkills().userSkills, [updated]);

  assert.equal(await deleteUserSkill(ACCOUNT_ID, created.id), true);
  assert.deepEqual(readPersistedSkills().userSkills, []);
});

test('updateUserSkill returns null and deleteUserSkill returns false for missing ids', async () => {
  assert.equal(await updateUserSkill(ACCOUNT_ID, 'skill-missing', { name: 'Nope' }), null);
  assert.equal(await deleteUserSkill(ACCOUNT_ID, 'skill-missing'), false);
  assert.equal(fs.existsSync(SKILLS_FILE), false);
});

test('toggleBuiltInSkill flips built-in enabled state and returns null for missing ids', async () => {
  const builtInId = BUILT_IN_SKILLS[0]?.id;
  assert.ok(builtInId);

  assert.equal(listSkills(ACCOUNT_ID).find((skill) => skill.id === builtInId)?.enabled, false);
  assert.equal(await toggleBuiltInSkill(ACCOUNT_ID, builtInId), true);
  assert.equal(listSkills(ACCOUNT_ID).find((skill) => skill.id === builtInId)?.enabled, true);
  assert.deepEqual(readPersistedSkills().enabledBuiltIns, [builtInId]);

  assert.equal(await toggleBuiltInSkill(ACCOUNT_ID, builtInId), false);
  assert.equal(listSkills(ACCOUNT_ID).find((skill) => skill.id === builtInId)?.enabled, false);
  assert.deepEqual(readPersistedSkills().enabledBuiltIns, []);

  assert.equal(await toggleBuiltInSkill(ACCOUNT_ID, 'builtin-missing'), null);
});

test("getEnabledSkillPrompts filters by applyTo 'script' and 'all'", async () => {
  const scriptBuiltIn = BUILT_IN_SKILLS.find((skill) => skill.applyTo === 'script');
  assert.ok(scriptBuiltIn);

  assert.equal(await toggleBuiltInSkill(ACCOUNT_ID, scriptBuiltIn.id), true);
  const scriptUserSkill = await createUserSkill(ACCOUNT_ID, {
    name: 'Script Only',
    prompt: 'Script-only prompt',
    applyTo: 'script',
  });
  const allUserSkill = await createUserSkill(ACCOUNT_ID, {
    name: 'All Contexts',
    prompt: 'All-context prompt',
    applyTo: 'all',
  });
  const disabledAllUserSkill = await createUserSkill(ACCOUNT_ID, {
    name: 'Disabled All Contexts',
    prompt: 'Disabled all-context prompt',
    applyTo: 'all',
  });
  await updateUserSkill(ACCOUNT_ID, disabledAllUserSkill.id, { enabled: false });

  assert.deepEqual(getEnabledSkillPrompts(ACCOUNT_ID, 'script'), [
    scriptBuiltIn.prompt,
    scriptUserSkill.prompt,
    allUserSkill.prompt,
  ]);
  assert.deepEqual(getEnabledSkillPrompts(ACCOUNT_ID, 'all'), [allUserSkill.prompt]);
});
