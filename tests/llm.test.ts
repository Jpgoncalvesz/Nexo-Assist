import { afterEach, describe, it, expect, vi } from 'vitest';
import { interpret, needsInterpretation } from '../src/agent/llm';
import { priorityFor } from '../src/agent/engine';
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe('guardas do LLM e política', () => {
  it('nunca usa LLM para confirmar rascunho', () => {
    vi.stubEnv('AGENT_MODE', 'ollama');
    expect(needsInterpretation('sim', { stage: 'confirm' })).toBe(false);
    expect(needsInterpretation('Confirmar', {})).toBe(false);
  });
  it('rejeita ID inventado', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          message: {
            content: JSON.stringify({
              intent: 'list',
              canonical: 'Consultar INC-999',
              confidence: 0.95,
              reason: 'consulta',
            }),
          },
        }),
      ),
    );
    await expect(interpret('Ver INC-100', {})).rejects.toThrow('Identificador');
  });
  it('rejeita confirmação inventada', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          message: {
            content: JSON.stringify({
              intent: 'answer',
              canonical: 'Confirmar',
              confidence: 0.95,
              reason: 'pedido',
            }),
          },
        }),
      ),
    );
    await expect(interpret('talvez', {})).rejects.toThrow('reservada');
  });
  it('alternativa impede elevar uma falha individual automaticamente', () => {
    expect(priorityFor('Notebook não funciona', 'Somente eu', 'Tenho alternativa', 'INC')).toBe(
      'Média',
    );
  });
  it('pedido sem urgência não vira alta por mencionar hoje', () => {
    expect(priorityFor('Hoje quero pedir teclado', 'Somente eu', 'Sem urgência', 'REQ')).toBe(
      'Baixa',
    );
  });
  it('equipe sem internet é crítica', () => {
    expect(priorityFor('Equipe sem internet', 'Minha equipe', 'Não consigo trabalhar', 'INC')).toBe(
      'Crítica',
    );
  });
});
