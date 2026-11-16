import type { Priority, Ticket } from '../lib/types';
const HOUR = 3_600_000;
// São Paulo has UTC-03 year-round since 2019. Calendar excludes weekends, not holidays.
// One business day is 10 working hours (08:00-18:00).
export function dueDate(priority: Priority, from: Date): Date {
  if (!Number.isFinite(from.getTime())) throw new Error('Data inválida');
  if (priority === 'Crítica') return new Date(from.getTime() + HOUR);
  let remaining = { Alta: 4, Média: 30, Baixa: 50 }[priority] * HOUR;
  const wall = new Date(from.getTime() - 3 * HOUR);
  while (remaining > 0) {
    if ([0, 6].includes(wall.getUTCDay())) {
      wall.setUTCDate(wall.getUTCDate() + 1);
      wall.setUTCHours(8, 0, 0, 0);
      continue;
    }
    if (wall.getUTCHours() < 8) wall.setUTCHours(8, 0, 0, 0);
    if (wall.getUTCHours() >= 18) {
      wall.setUTCDate(wall.getUTCDate() + 1);
      wall.setUTCHours(8, 0, 0, 0);
      continue;
    }
    const close = new Date(wall);
    close.setUTCHours(18, 0, 0, 0);
    const portion = Math.min(remaining, close.getTime() - wall.getTime());
    wall.setTime(wall.getTime() + portion);
    remaining -= portion;
  }
  return new Date(wall.getTime() + 3 * HOUR);
}
export function isResolved(ticket: Pick<Ticket, 'status' | 'resolvedAt'>): boolean {
  return Boolean(ticket.resolvedAt) || /resolvid|encerrad|cancelad/i.test(ticket.status);
}
export function isOverdue(ticket: Ticket, now = new Date()): boolean {
  return !isResolved(ticket) && now.getTime() > new Date(ticket.dueAt).getTime();
}
export const slaLabel: Record<Priority, string> = {
  Crítica: '1 hora corrida (plantão 24h)',
  Alta: '4 horas úteis',
  Média: '3 dias úteis',
  Baixa: '5 dias úteis',
};
