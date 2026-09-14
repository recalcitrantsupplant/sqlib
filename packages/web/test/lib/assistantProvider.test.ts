import { describe, it, expect, beforeEach } from 'vitest';
import {
  useAssistantProvider,
  ASSISTANT_PROVIDER_STORAGE_KEY,
} from '@/composables/useAssistantProvider';

describe('assistant provider settings', () => {
  beforeEach(() => {
    localStorage.clear();
    useAssistantProvider().clear();
  });

  it('is not configured until it can actually be used', () => {
    const provider = useAssistantProvider();
    // A model with no key cannot call anything, so the composer stays shut
    // rather than failing for a reason the user cannot see from it.
    expect(provider.isConfigured.value).toBe(false);
    expect(provider.credentials.value).toBeNull();

    provider.settings.value.apiKey = 'sk-test';
    expect(provider.isConfigured.value).toBe(true);
  });

  it('asks a local endpoint for a URL rather than a key', () => {
    const provider = useAssistantProvider();
    provider.setProvider('openai-compatible');
    provider.settings.value.model = 'llama3';

    // No key needed — Ollama and friends do not have one.
    expect(provider.isConfigured.value).toBe(false);
    provider.settings.value.baseUrl = 'http://localhost:11434/v1';
    expect(provider.isConfigured.value).toBe(true);
    expect(provider.credentials.value).toMatchObject({
      provider: 'openai-compatible',
      model: 'llama3',
      baseUrl: 'http://localhost:11434/v1',
    });
  });

  it('brings the right default model when the provider changes', () => {
    const provider = useAssistantProvider();
    provider.setProvider('openai');
    // Carrying one provider's model name to another is never right.
    expect(provider.settings.value.model).toBe('gpt-5');
  });

  it('takes a key for Groq rather than a base URL', () => {
    const provider = useAssistantProvider();
    provider.setProvider('groq');
    // Groq is OpenAI-shaped on the wire, but the server has a dedicated entry
    // for it, so the panel must not start asking for an endpoint.
    expect(provider.settings.value.model).toBe('llama-3.1-8b-instant');
    expect(provider.isConfigured.value).toBe(false);
    provider.settings.value.apiKey = 'gsk_test';
    expect(provider.credentials.value).toMatchObject({ provider: 'groq', baseUrl: undefined });
  });

  it('survives storage that is not settings', () => {
    localStorage.setItem(ASSISTANT_PROVIDER_STORAGE_KEY, '{ not json');
    const provider = useAssistantProvider();
    provider.clear();
    expect(provider.settings.value.provider).toBe('anthropic');
  });

  it('trims before sending, so a pasted key with a newline still works', () => {
    const provider = useAssistantProvider();
    provider.settings.value.apiKey = '  sk-test\n';
    provider.settings.value.model = ' claude-opus-5 ';
    expect(provider.credentials.value).toMatchObject({ apiKey: 'sk-test', model: 'claude-opus-5' });
  });
});
