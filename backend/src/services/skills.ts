import fs from 'node:fs';
import path from 'node:path';
import { nanoid } from 'nanoid';
import { getAccountSettingsLocation } from './aiSettings';
import { currentAccountId } from './accountContext';

export type SkillApplyTo = 'script' | 'all';

export interface BuiltInSkill {
  id: string;
  name: string;
  nameZh: string;
  description: string;
  descriptionZh: string;
  prompt: string;
  applyTo: SkillApplyTo;
  isBuiltIn: true;
}

export interface UserSkill {
  id: string;
  name: string;
  prompt: string;
  applyTo: SkillApplyTo;
  enabled: boolean;
  createdAt: string;
  isBuiltIn: false;
}

export type Skill = (BuiltInSkill & { enabled: boolean }) | UserSkill;

export const BUILT_IN_SKILLS: BuiltInSkill[] = [
  {
    id: 'builtin-teaching',
    name: 'Teaching Style',
    nameZh: '教學風格',
    description: 'Use simple analogies and friendly tone suitable for general audiences',
    descriptionZh: '使用簡單比喻和親切語氣，適合一般聽眾',
    prompt:
      '請使用親切、口語化的語氣，以日常生活中的比喻來解釋複雜概念，讓一般聽眾也能輕鬆理解。避免過多術語，重點要說清楚。',
    applyTo: 'script',
    isBuiltIn: true,
  },
  {
    id: 'builtin-academic',
    name: 'Academic Tone',
    nameZh: '學術嚴謹',
    description: 'Use precise terminology, structured arguments, suitable for academic settings',
    descriptionZh: '使用精確術語、結構性論述，適合學術場合',
    prompt:
      '請使用嚴謹、正式的學術語氣，精確引用術語，以結構化方式呈現論點與佐證，適合學術簡報或研討會場合。',
    applyTo: 'script',
    isBuiltIn: true,
  },
  {
    id: 'builtin-storytelling',
    name: 'Storytelling',
    nameZh: '故事敘述',
    description: 'Frame content as a narrative with vivid examples and engaging flow',
    descriptionZh: '以故事敘述方式呈現，帶入生動例子，讓聽眾更投入',
    prompt:
      '請以說故事的方式呈現內容，帶入生動案例或情境，讓聽眾感受到具體場景，增加投入感與記憶點。',
    applyTo: 'script',
    isBuiltIn: true,
  },
  {
    id: 'builtin-concise',
    name: 'Concise Summary',
    nameZh: '精簡摘要',
    description: 'Focus on the most important points, cut non-essential details',
    descriptionZh: '只講最核心重點，省略非必要細節，精準扼要',
    prompt:
      '請只保留最核心的重點，省略技術細節和次要資訊，每頁用最精簡的語言說清楚最重要的一件事。',
    applyTo: 'script',
    isBuiltIn: true,
  },
];

interface SkillsFile {
  userSkills: UserSkill[];
  enabledBuiltIns: string[];
}

function skillsFilePath(accountId: string): string {
  const { accountDir } = getAccountSettingsLocation(accountId);
  return path.join(accountDir, 'skills.json');
}

function readSkillsFile(accountId: string): SkillsFile {
  const filePath = skillsFilePath(accountId);
  if (!fs.existsSync(filePath)) return { userSkills: [], enabledBuiltIns: [] };
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<SkillsFile>;
    return {
      userSkills: Array.isArray(parsed.userSkills) ? parsed.userSkills : [],
      enabledBuiltIns: Array.isArray(parsed.enabledBuiltIns) ? parsed.enabledBuiltIns : [],
    };
  } catch {
    return { userSkills: [], enabledBuiltIns: [] };
  }
}

async function writeSkillsFile(accountId: string, data: SkillsFile): Promise<void> {
  const { accountDir } = getAccountSettingsLocation(accountId);
  await fs.promises.mkdir(accountDir, { recursive: true, mode: 0o700 });
  await fs.promises.writeFile(
    skillsFilePath(accountId),
    JSON.stringify(data, null, 2),
    { encoding: 'utf8', mode: 0o600 },
  );
}

export function listSkills(accountId: string = currentAccountId()): Skill[] {
  const { userSkills, enabledBuiltIns } = readSkillsFile(accountId);
  const builtIns: Skill[] = BUILT_IN_SKILLS.map((s) => ({ ...s, enabled: enabledBuiltIns.includes(s.id) }));
  return [...builtIns, ...userSkills];
}

export function getEnabledSkillPrompts(accountId: string, applyTo: SkillApplyTo): string[] {
  const skills = listSkills(accountId);
  return skills
    .filter((s) => s.enabled && (s.applyTo === applyTo || s.applyTo === 'all'))
    .map((s) => s.prompt);
}

export async function createUserSkill(
  accountId: string,
  input: { name: string; prompt: string; applyTo: SkillApplyTo },
): Promise<UserSkill> {
  const data = readSkillsFile(accountId);
  const skill: UserSkill = {
    id: `skill-${nanoid(8)}`,
    name: input.name.trim(),
    prompt: input.prompt.trim(),
    applyTo: input.applyTo,
    enabled: true,
    createdAt: new Date().toISOString(),
    isBuiltIn: false,
  };
  data.userSkills = [...data.userSkills, skill];
  await writeSkillsFile(accountId, data);
  return skill;
}

export async function updateUserSkill(
  accountId: string,
  skillId: string,
  patch: Partial<Pick<UserSkill, 'name' | 'prompt' | 'applyTo' | 'enabled'>>,
): Promise<UserSkill | null> {
  const data = readSkillsFile(accountId);
  const idx = data.userSkills.findIndex((s) => s.id === skillId);
  if (idx < 0 || !data.userSkills[idx]) return null;
  const existing = data.userSkills[idx] as UserSkill;
  const updated: UserSkill = {
    id: existing.id,
    createdAt: existing.createdAt,
    isBuiltIn: false,
    name: patch.name !== undefined ? patch.name.trim() : existing.name,
    prompt: patch.prompt !== undefined ? patch.prompt.trim() : existing.prompt,
    applyTo: patch.applyTo !== undefined ? patch.applyTo : existing.applyTo,
    enabled: patch.enabled !== undefined ? patch.enabled : existing.enabled,
  };
  data.userSkills[idx] = updated;
  await writeSkillsFile(accountId, data);
  return updated;
}

export async function deleteUserSkill(accountId: string, skillId: string): Promise<boolean> {
  const data = readSkillsFile(accountId);
  const before = data.userSkills.length;
  data.userSkills = data.userSkills.filter((s) => s.id !== skillId);
  if (data.userSkills.length === before) return false;
  await writeSkillsFile(accountId, data);
  return true;
}

export async function toggleBuiltInSkill(accountId: string, skillId: string): Promise<boolean | null> {
  const builtin = BUILT_IN_SKILLS.find((s) => s.id === skillId);
  if (!builtin) return null;
  const data = readSkillsFile(accountId);
  const isEnabled = data.enabledBuiltIns.includes(skillId);
  data.enabledBuiltIns = isEnabled
    ? data.enabledBuiltIns.filter((id) => id !== skillId)
    : [...data.enabledBuiltIns, skillId];
  await writeSkillsFile(accountId, data);
  return !isEnabled;
}
