import { describe, it, expect, vi } from 'vitest';
import { runAgent, priorityFor, classify } from '../src/agent/engine';
import type { AgentState, Ticket, TicketGateway, Draft } from '../src/lib/types';
const ticket = (extra: Partial<Ticket> = {}): Ticket => ({
  id: 'INC-100',
  ownerId: 'ana',
  title: 'Notebook lento após atualização do Windows',
  description: 'Notebook lento após atualização do Windows',
  type: 'INC',
  category: 'Hardware',
  priority: 'Média',
  affected: 'Somente eu',
  status: 'Aberto',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  dueAt: new Date(Date.now() + 86400000).toISOString(),
  resolvedAt: null,
  history: [],
  ...extra,
});
function gateway(tickets: Ticket[] = []): TicketGateway {
  return {
    list: vi.fn(async (owner) => tickets.filter((t) => t.ownerId === owner)),
    get: vi.fn(
      async (owner, id) => tickets.find((t) => t.ownerId === owner && t.id === id) || null,
    ),
    commit: vi.fn(async (owner, draft: Draft) =>
      ticket({ ...draft, id: draft.ticketId || 'INC-999', ownerId: owner }),
    ),
    transfer: vi.fn(async (owner, id) => tickets.find((t) => t.ownerId === owner && t.id === id)!),
  };
}
async function draftFlow(
  g: TicketGateway,
  text = 'Meu notebook está lento após atualização do Windows',
) {
  let r = await runAgent(text, {}, 'ana', g);
  r = await runAgent('Somente eu', r.state, 'ana', g);
  return runAgent('Tenho alternativa', r.state, 'ana', g);
}
describe('regras do service desk', () => {
  it('coleta dados e exige confirmação antes de escrever', async () => {
    const g = gateway();
    const r = await draftFlow(g);
    expect(r.message.draft).toMatchObject({
      operation: 'create',
      type: 'INC',
      category: 'Hardware',
      priority: 'Média',
      affected: 'Somente eu',
    });
    expect(g.commit).not.toHaveBeenCalled();
    const saved = await runAgent('Confirmar', r.state, 'ana', g);
    expect(g.commit).toHaveBeenCalledTimes(1);
    expect(saved.message.tickets?.[0].id).toBe('INC-999');
  });
  it('cancelar não grava e elimina rascunho', async () => {
    const g = gateway();
    const r = await draftFlow(g);
    const c = await runAgent('Cancelar', r.state, 'ana', g);
    expect(c.state.draft).toBeUndefined();
    expect(g.commit).not.toHaveBeenCalled();
  });
  it('mensagem ambígua não confirma', async () => {
    const g = gateway();
    const r = await draftFlow(g);
    await runAgent('talvez', r.state, 'ana', g);
    expect(g.commit).not.toHaveBeenCalled();
  });
  it('duplicado aberto gera atualização com confirmação', async () => {
    const g = gateway([ticket()]);
    const r = await draftFlow(g);
    expect(r.message.draft).toMatchObject({ operation: 'update', ticketId: 'INC-100' });
    expect(g.commit).not.toHaveBeenCalled();
  });
  it('resolvido há 4 dias gera reabertura', async () => {
    const g = gateway([
      ticket({
        status: 'Resolvido',
        resolvedAt: new Date(Date.now() - 4 * 86400000).toISOString(),
      }),
    ]);
    expect((await draftFlow(g)).message.draft?.operation).toBe('reopen');
  });
  it('resolvido há 8 dias gera novo chamado', async () => {
    const g = gateway([
      ticket({
        status: 'Resolvido',
        resolvedAt: new Date(Date.now() - 8 * 86400000).toISOString(),
      }),
    ]);
    expect((await draftFlow(g)).message.draft?.operation).toBe('create');
  });
  it('consulta não expõe chamado de outra pessoa', async () => {
    const g = gateway([ticket({ ownerId: 'bruno', title: 'Segredo de Bruno' })]);
    const r = await runAgent('INC-100', {}, 'ana', g);
    expect(r.message.tickets).toBeUndefined();
    expect(r.message.text).not.toContain('Bruno');
  });
  it('vencido transfere com resumo e chamado', async () => {
    const g = gateway([ticket({ dueAt: new Date(Date.now() - 1).toISOString() })]);
    const r = await runAgent('INC-100', {}, 'ana', g);
    expect(r.mode).toBe('waiting');
    expect(r.summary).toContain('Notebook');
    expect(g.transfer).toHaveBeenCalled();
  });
  it('transferência a pedido preserva contexto', async () => {
    const r = await runAgent('Falar com analista', { description: 'VPN falha' }, 'ana', gateway());
    expect(r.mode).toBe('waiting');
    expect(r.summary).toContain('VPN falha');
  });
  it('equipe parada transfere sem criação não confirmada', async () => {
    const g = gateway();
    const r = await runAgent(
      'Não conseguimos trabalhar',
      { stage: 'urgency', description: 'VPN não funciona', affected: 'Minha equipe' },
      'ana',
      g,
    );
    expect(r.mode).toBe('waiting');
    expect(g.commit).not.toHaveBeenCalled();
  });
  it('assunto desconhecido transfere com baixa confiança', async () => {
    const r = await runAgent('Preciso de algo indefinido', {}, 'ana', gateway());
    expect(r.mode).toBe('waiting');
    expect(r.message.decision?.confidence).toBeLessThan(0.5);
  });
  it('RH é redirecionado', async () => {
    expect(
      (await runAgent('Quero solicitar férias', {}, 'ana', gateway())).message.decision?.intent,
    ).toBe('fora_do_escopo');
  });
  it('VPN 809 pergunta SO e não aplica solução Windows 10 ao 11', async () => {
    const g = gateway();
    const r = await runAgent('VPN erro 809', {}, 'ana', g);
    expect(r.state.stage).toBe('os');
    const w = await runAgent('Windows 11', r.state, 'ana', g);
    expect(w.state.stage).toBe('impact');
    expect(w.message.text).not.toContain('reinstale');
  });
  it('VPN Windows10 usa artigo e mantém contexto se não resolver', async () => {
    const g = gateway();
    const r = await runAgent('VPN erro 809', {}, 'ana', g);
    const w = await runAgent('Windows 10', r.state, 'ana', g);
    expect(w.message.text).toContain('reinstale');
    const again = await runAgent('Não resolveu; abrir chamado', w.state, 'ana', g);
    expect(again.state.description).toContain('809');
  });
  it('consulta de horários não abre chamado', async () => {
    const g = gateway();
    const r = await runAgent('Qual é o horário do service desk?', {}, 'ana', g);
    expect(r.message.text).toContain('8h às 18h');
    expect(g.commit).not.toHaveBeenCalled();
  });
  it('complemento exige confirmação', async () => {
    const g = gateway([ticket()]);
    const r = await runAgent('Complementar INC-100: o erro começou após reiniciar', {}, 'ana', g);
    expect(r.message.draft?.operation).toBe('update');
    expect(r.message.draft?.description).toContain('reiniciar');
    expect(g.commit).not.toHaveBeenCalled();
  });
  it('erro preserva rascunho e chave para tentativa idempotente', async () => {
    const g = gateway();
    const r = await draftFlow(g);
    g.commit = vi.fn(async () => {
      throw Error('offline');
    });
    const fail = await runAgent('Confirmar', r.state, 'ana', g);
    expect(fail.state.draft?.key).toBe(r.state.draft?.key);
    expect(fail.message.decision?.intent).toBe('servico_indisponivel');
  });
  it('segunda falha encaminha ao analista', async () => {
    const g = gateway();
    g.list = vi.fn(async () => {
      throw Error('offline');
    });
    const r = await runAgent('Consultar meus chamados', { failures: 1 }, 'ana', g);
    expect(r.mode).toBe('waiting');
  });
  it('tipos e matriz de prioridade', () => {
    expect(classify('Quero um segundo monitor').type).toBe('REQ');
    expect(classify('O monitor não liga').type).toBe('INC');
    expect(
      priorityFor('Internet indisponível', 'Toda a empresa', 'Não conseguimos trabalhar', 'INC'),
    ).toBe('Crítica');
    expect(priorityFor('VPN falha', 'Somente eu', 'Tenho compromisso hoje', 'INC')).toBe('Alta');
    expect(priorityFor('Notebook lento', 'Somente eu', 'Tenho alternativa', 'INC')).toBe('Média');
    expect(priorityFor('Segundo monitor', 'Somente eu', 'Sem urgência', 'REQ')).toBe('Baixa');
  });
});
