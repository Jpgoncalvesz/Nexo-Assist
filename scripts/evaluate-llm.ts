import assert from 'node:assert/strict';
import { interpret, type Interpretation } from '../src/agent/llm';
import type { AgentState } from '../src/lib/types';
const cases: {
  text: string;
  state: AgentState;
  intent: Interpretation['intent'];
  match: RegExp;
}[] = [
  {
    text: 'O túnel corporativo caiu e não consigo acessar a rede da firma',
    state: {},
    intent: 'issue',
    match: /rede|vpn|túnel/i,
  },
  {
    text: 'só comigo',
    state: { stage: 'impact', description: 'VPN não conecta' },
    intent: 'answer',
    match: /eu|pessoa/i,
  },
  {
    text: 'consigo continuar usando outro computador',
    state: { stage: 'urgency', description: 'Notebook lento' },
    intent: 'answer',
    match: /alternativa|outro computador/i,
  },
  {
    text: 'Quero saber do andamento dos meus pedidos',
    state: {},
    intent: 'list',
    match: /chamado|pedido/i,
  },
  {
    text: 'Pode me passar para alguém do suporte?',
    state: {},
    intent: 'human',
    match: /suporte|analista|humano|pessoa/i,
  },
];
let failed = 0;
for (const item of cases) {
  const started = Date.now();
  try {
    const output = await interpret(item.text, item.state);
    assert.equal(output.intent, item.intent);
    assert.ok(output.confidence >= 0.75);
    assert.match(output.canonical, item.match);
    console.log(
      JSON.stringify({
        input: item.text,
        ...output,
        elapsedMs: Date.now() - started,
        passed: true,
      }),
    );
  } catch (error) {
    failed++;
    console.error({ input: item.text, error: error instanceof Error ? error.message : 'erro' });
  }
}
console.log(cases.length - failed + '/' + cases.length + ' avaliações reais aprovadas.');
if (failed) process.exitCode = 1;
