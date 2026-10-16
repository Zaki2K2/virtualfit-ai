import config from './nova.json';

/** Public product identity; contains no credentials or private runtime settings. */
export const nova = config;
export const novaStylingSystem = `${nova.system} ${nova.stylingRules}`;

/** Routes product/capability questions without treating them as missing garments. */
export function novaIdentityQuestion(message: string): boolean {
  return Boolean(novaIdentityGuidance(message));
}

function identityTopic(message: string) {
  const text = message.toLowerCase();
  if (nova.capabilityQuestions.some((question) => question.toLowerCase().replace(/[?!.]+$/, '') === text.trim().replace(/[?!.]+$/, '')))
    return nova.identityTopics.find((topic) => topic.needles.includes('what can you do'));
  return nova.identityTopics.find((topic) => topic.needles.some((needle) => new RegExp(`\\b${needle}\\b`).test(text)));
}

export function novaIdentityGuidance(message: string): string | undefined {
  return identityTopic(message)?.answer;
}

export function novaIdentityResponseValid(message: string, answer: string): boolean {
  if (/\bnovacto\s+(?:created|authored|invented|built|trained)\s+(?:the\s+)?(?:underlying\s+)?(?:qwen|foundation model)\b/i.test(answer)) return false;
  const topic = identityTopic(message);
  if (!topic) return true;
  const text = answer.toLowerCase();
  if (/verified facts|current question|return empty itemids/.test(text)) return false;
  if (topic.answer.startsWith('No.')) return /^no\b/.test(text) && /qwen/.test(text) && /alibaba/.test(text);
  if (topic.needles.includes('are you qwen')) return /nova/.test(text) && /qwen/.test(text);
  if (topic.needles.includes('underlying')) return /qwen/.test(text) && /alibaba/.test(text);
  if (topic.needles.includes('who developed')) return /novacto/.test(text);
  if (topic.needles.includes('your name')) return /\bnova\b/.test(text);
  if (topic.needles.includes('running locally')) return /local/.test(text);
  return /cloth|outfit|fashion|wardrobe|colou?r|style|occasion/.test(text);
}
