import { describe, it, expect } from 'vitest';
import { dueDate } from '../src/agent/sla';
describe('Prazos de São Paulo (UTC-03)', () => {
  it('crítico corre em fim de semana', () =>
    expect(dueDate('Crítica', new Date('2026-11-14T02:00:00Z')).toISOString()).toBe(
      '2026-11-14T03:00:00.000Z',
    ));
  it('alta atravessa fim de semana e retoma às 08h', () =>
    expect(dueDate('Alta', new Date('2026-11-13T20:00:00Z')).toISOString()).toBe(
      '2026-11-16T14:00:00.000Z',
    ));
  it('normaliza antes de abrir', () =>
    expect(dueDate('Alta', new Date('2026-11-16T09:00:00Z')).toISOString()).toBe(
      '2026-11-16T15:00:00.000Z',
    ));
  it('média equivale a 30 horas úteis', () =>
    expect(dueDate('Média', new Date('2026-11-16T11:00:00Z')).toISOString()).toBe(
      '2026-11-18T21:00:00.000Z',
    ));
  it('baixa equivale a 50 horas úteis', () =>
    expect(dueDate('Baixa', new Date('2026-11-16T11:00:00Z')).toISOString()).toBe(
      '2026-11-20T21:00:00.000Z',
    ));
  it('limite de fechamento não adiciona dia indevido', () =>
    expect(dueDate('Alta', new Date('2026-11-16T17:00:00Z')).toISOString()).toBe(
      '2026-11-16T21:00:00.000Z',
    ));
});
