import type { Draft, Ticket } from './types';
type Problem = Pick<Draft, 'title' | 'description' | 'type' | 'category'>;
const stop = new Set([
  'para',
  'como',
  'apos',
  'preciso',
  'quero',
  'esta',
  'comigo',
  'chamado',
  'problema',
  'minha',
  'meu',
  'nao',
  'uma',
  'com',
  'que',
  'ajuda',
  'atualizacao',
]);
export function normalize(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}
export function sameProblem(ticket: Ticket, draft: Problem): boolean {
  if (ticket.category !== draft.category || ticket.type !== draft.type) return false;
  const a = normalize(ticket.title);
  const b = normalize(draft.title);
  if (a === b) return true;
  // Equivalent common failures; keep different equipment/problems separate.
  const signature = (s: string): string | null => {
    if (/vpn/.test(s) && /conect|parou|funciona|erro 809|indisponivel/.test(s))
      return 'vpn-connection';
    if (/sap/.test(s) && /senha|bloque|acesso/.test(s)) return 'sap-access';
    if (/notebook|computador/.test(s) && /lent|trav/.test(s)) return 'computer-performance';
    return null;
  };
  const issue = signature(a);
  if (issue && issue === signature(b)) return true;
  const words = (v: string) => new Set(v.split(/\W+/).filter((w) => w.length >= 3 && !stop.has(w)));
  const aw = words(a);
  const bw = words(b);
  const overlap = [...aw].filter((w) => bw.has(w)).length;
  return overlap >= 2 && overlap / Math.max(aw.size, bw.size) >= 0.6;
}
export function recentlyResolved(ticket: Ticket, now = new Date()): boolean {
  if (!ticket.resolvedAt) return false;
  const age = now.getTime() - new Date(ticket.resolvedAt).getTime();
  return age >= 0 && age <= 7 * 24 * 60 * 60 * 1000;
}
export function findDuplicate(
  tickets: Ticket[],
  draft: Problem,
  now = new Date(),
): Ticket | undefined {
  const matching = tickets.filter((t) => sameProblem(t, draft));
  return matching.find((t) => !t.resolvedAt) ?? matching.find((t) => recentlyResolved(t, now));
}
