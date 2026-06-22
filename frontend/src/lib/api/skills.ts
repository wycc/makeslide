import { parseErrorBody } from './common';

export type SkillApplyTo = 'script' | 'all';

export interface Skill {
  id: string;
  name: string;
  nameZh?: string;
  description?: string;
  descriptionZh?: string;
  prompt: string;
  applyTo: SkillApplyTo;
  enabled: boolean;
  isBuiltIn: boolean;
  createdAt?: string;
  /** Teaching template fields (user skills only) */
  imageStylePrompt?: string;
  quizPrompt?: string;
  ttsProvider?: string;
  ttsVoice?: string;
}

export async function listSkills(): Promise<Skill[]> {
  const resp = await fetch('api/skills');
  if (!resp.ok) throw await parseErrorBody(resp);
  const data = (await resp.json()) as { skills: Skill[] };
  return data.skills;
}

export async function createSkill(input: {
  name: string;
  prompt: string;
  applyTo: SkillApplyTo;
}): Promise<Skill> {
  const resp = await fetch('api/skills', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!resp.ok) throw await parseErrorBody(resp);
  const data = (await resp.json()) as { skill: Skill };
  return data.skill;
}

export async function updateSkill(
  skillId: string,
  patch: Partial<Pick<Skill, 'name' | 'prompt' | 'applyTo' | 'enabled'>>,
): Promise<Skill> {
  const resp = await fetch(`api/skills/${skillId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!resp.ok) throw await parseErrorBody(resp);
  const data = (await resp.json()) as { skill: Skill };
  return data.skill;
}

export async function deleteSkill(skillId: string): Promise<void> {
  const resp = await fetch(`api/skills/${skillId}`, { method: 'DELETE' });
  if (!resp.ok) throw await parseErrorBody(resp);
}

export async function toggleBuiltInSkill(skillId: string): Promise<{ enabled: boolean }> {
  const resp = await fetch(`api/skills/${skillId}/toggle`, { method: 'POST' });
  if (!resp.ok) throw await parseErrorBody(resp);
  return (await resp.json()) as { enabled: boolean };
}
