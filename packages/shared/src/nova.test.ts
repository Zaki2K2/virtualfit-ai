import { describe, expect, it } from 'vitest';
import { nova, novaIdentityGuidance, novaIdentityQuestion, novaIdentityResponseValid, novaStylingSystem } from './nova';

describe('Nova identity configuration', () => {
  it('distinguishes the assistant developer from foundation authorship', () => {
    expect(nova.name).toBe('Nova');
    expect(nova.developer).toBe('NovaCTO');
    expect(nova.system).toContain('NOT the underlying foundation model');
    expect(nova.system).toContain('No Nova fine-tuning has completed');
    expect(novaStylingSystem).toContain('Use only the exact IDs provided');
  });
  it('rejects misleading provenance and instruction echoes', () => {
    expect(novaIdentityResponseValid('Did NovaCTO create your underlying foundation model?',
      'Yes, NovaCTO created Qwen.')).toBe(false);
    expect(novaIdentityResponseValid('Who created your underlying language model?',
      'NovaCTO created me.')).toBe(false);
    expect(novaIdentityResponseValid('Who developed you?', 'NovaCTO created Qwen.')).toBe(false);
    expect(novaIdentityResponseValid('Are you Qwen?', 'I am Nova, powered by Qwen.')).toBe(true);
  });
  it('routes identity questions without capturing ordinary clothing requests', () => {
    for (const question of ['What is your name?', 'Who developed you?', 'Are you Qwen?',
      'What company are you from?', 'Who created your underlying language model?',
      'What can you do?', 'Are you running locally?', 'Can you help me choose clothes?'])
      expect(novaIdentityQuestion(question)).toBe(true);
    expect(novaIdentityGuidance('Did NovaCTO create your underlying foundation model?')).toMatch(/^No\./);
    expect(novaIdentityQuestion('Choose a blue shirt for the office')).toBe(false);
    expect(novaIdentityQuestion('Can you help me choose clothes for the office: a blue shirt?')).toBe(false);
  });
});
