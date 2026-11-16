export interface Article {
  id: string;
  title: string;
  text: string;
  terms: string[];
}
export const articles: Article[] = [
  {
    id: 'KB-001',
    title: 'VPN com erro 809',
    text: 'No Windows 10, reinstale o cliente de VPN pelo portal de softwares e reinicie o computador. No Windows 11, abra um chamado. Não aplique a instrução de Windows 10 em outro sistema.',
    terms: ['vpn', '809'],
  },
  {
    id: 'KB-002',
    title: 'Horário do service desk',
    text: 'Atendemos de segunda a sexta, das 8h às 18h (horário de São Paulo). Chamados críticos contam com plantão 24 horas.',
    terms: ['horario', 'atendimento', 'service desk', 'plantao'],
  },
  {
    id: 'KB-003',
    title: 'Redefinir a senha corporativa',
    text: 'Use a opção Esqueci minha senha no portal corporativo. Nunca envie sua senha ou código de autenticação no chat. Se o acesso continuar bloqueado, abra um chamado.',
    terms: ['senha', 'redefinir', 'recuperar', 'esqueci'],
  },
  {
    id: 'KB-004',
    title: 'Instalar software homologado',
    text: 'Procure o aplicativo no portal de softwares. Aplicativos não listados precisam de aprovação da TI. Não baixe instaladores de fontes desconhecidas.',
    terms: ['instalar', 'software', 'programa'],
  },
  {
    id: 'KB-005',
    title: 'Solicitar equipamento',
    text: 'Informe o equipamento, a justificativa e quem será atendido. O service desk registrará a requisição e encaminhará a aprovação.',
    terms: ['solicitar', 'equipamento', 'monitor'],
  },
  {
    id: 'KB-006',
    title: 'E-mail suspeito',
    text: 'Não abra anexos nem links. Use Reportar phishing no cliente de e-mail e procure um analista se forneceu credenciais. Não cole dados sensíveis no chat.',
    terms: ['phishing', 'suspeito', 'email'],
  },
  {
    id: 'KB-007',
    title: 'Impressora indisponível',
    text: 'Confira a energia, o papel e a conexão da impressora à rede. Se houver mensagem de erro, informe o texto e o modelo ao service desk.',
    terms: ['impressora', 'imprimir'],
  },
  {
    id: 'KB-008',
    title: 'Acesso a pastas compartilhadas',
    text: 'Pedidos de acesso precisam do nome da pasta, da justificativa e de quem precisa do acesso. A concessão depende da aprovação do responsável.',
    terms: ['pasta', 'acesso', 'permissao'],
  },
];
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}
export function findArticle(text: string): Article | undefined {
  const n = normalize(text);
  if (/horario|plantao|que horas|quando.*atend/.test(n)) return articles[1];
  if (/vpn/.test(n) && /809/.test(n)) return articles[0];
  if (!/como|onde|duvida|orientacao|passo|esqueci/.test(n)) return undefined;
  return articles
    .slice(2)
    .map((a) => ({ a, score: a.terms.filter((t) => n.includes(t)).length }))
    .sort((a, b) => b.score - a.score)
    .find((x) => x.score > 0)?.a;
}
