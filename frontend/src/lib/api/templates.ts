import { parseErrorBody } from './common';
import type { SkillApplyTo } from './skills';

export interface TemplateSkillData {
  prompt: string;
  applyTo: SkillApplyTo;
  imageStylePrompt?: string;
  quizPrompt?: string;
  ttsProvider?: string;
  ttsVoice?: string;
}

export interface Template {
  id: string;
  name: string;
  description: string;
  category: string;
  skill_data: TemplateSkillData;
  is_public: boolean;
  author: string;
  created_at: string;
  apply_count: number;
}

export async function listTemplates(): Promise<Template[]> {
  const resp = await fetch('api/templates');
  if (!resp.ok) throw await parseErrorBody(resp);
  const data = (await resp.json()) as { templates: Template[] };
  return data.templates;
}

export async function createTemplate(input: {
  name: string;
  description?: string;
  category?: string;
  skill_data: TemplateSkillData;
  is_public?: boolean;
}): Promise<Template> {
  const resp = await fetch('api/templates', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!resp.ok) throw await parseErrorBody(resp);
  const data = (await resp.json()) as { template: Template };
  return data.template;
}

export async function deleteTemplate(templateId: string): Promise<void> {
  const resp = await fetch(`api/templates/${templateId}`, { method: 'DELETE' });
  if (!resp.ok) throw await parseErrorBody(resp);
}

// Fire-and-forget usage counter bump; failures are ignored so they never
// block the apply navigation.
export async function applyTemplate(templateId: string): Promise<void> {
  try {
    await fetch(`api/templates/${templateId}/apply`, { method: 'POST' });
  } catch {
    // ignore
  }
}
