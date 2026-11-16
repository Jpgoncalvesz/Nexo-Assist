import { randomUUID } from 'node:crypto';
import { interpret, needsInterpretation } from './llm';
import { findDuplicate } from '../lib/duplicates';
import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import type {
  AgentResult,
  AgentState,
  Category,
  Decision,
  Draft,
  Priority,
  Ticket,
  TicketGateway,
} from '../lib/types';
import { articles, findArticle, normalize } from './knowledge';
import { isOverdue, isResolved, slaLabel } from './sla';

export function classify(text: string): {
  category: Category;
  type: 'INC' | 'REQ';
  known: boolean;
} {
  const n = normalize(text);
  const category: Category = /vpn|rede|internet|wi.?fi|conexao/.test(n)
    ? 'Rede e VPN'
    : /senha|acesso|permissao|sap|bloquead/.test(n)
      ? 'Acesso'
      : /email|e-mail|outlook|correio/.test(n)
        ? 'E-mail'
        : /notebook|monitor|computador|teclado|mouse|impressor|hardware|equipamento|tela/.test(n)
          ? 'Hardware'
          : /software|programa|aplicativo|instalar|windows|excel|sistema|teams/.test(n)
            ? 'Software'
            : 'Outros';
  const failure =
    /nao (funciona|conecta|abre|liga|sincroniza)|parou|falha|erro|lent|trav|quebrad|bloquead|indisponivel|sem (acesso|internet)|caiu/.test(
      n,
    );
  const request =
    /solicit|preciso|pedido|quero|libera|novo|nova|instala|requisicao|acesso|equipamento|monitor/.test(
      n,
    );
  return {
    category,
    type: failure ? 'INC' : request ? 'REQ' : 'INC',
    known: category !== 'Outros',
  };
}
export function priorityFor(
  description: string,
  affected: string,
  urgency: string,
  type: 'INC' | 'REQ',
): Priority {
  const n = normalize(description + ' ' + urgency);
  const many = /equipe|empresa|todos|setor|departamento|varias|pessoas/.test(normalize(affected));
  const hasAlternative =
    /tenho alternativa|ha alternativa|consigo continuar|posso continuar|outro computador/.test(
      normalize(urgency),
    );
  const deadlineToday =
    /compromisso hoje|entrega hoje|prazo hoje|reuniao hoje|mesmo dia|daqui a/.test(n) &&
    !/nao.*(compromisso|entrega|reuniao).*hoje/.test(n);
  const stopped =
    !hasAlternative &&
    /parad|parou|sem internet|nao (consigo|conseguimos|conseguem).*trabalhar|impede|sem alternativa|indisponivel|ninguem|nao funciona/.test(
      n,
    );
  if (many && stopped) return 'Crítica';
  if (stopped || deadlineToday) return 'Alta';
  if (hasAlternative) return 'Média';
  if (/alternativa|contornar|atrapalha|lent|intermitente/.test(n)) return 'Média';
  return type === 'REQ' ? 'Baixa' : 'Média';
}
function decision(
  intent: string,
  reason: string,
  actions: string[],
  rules: string[],
  confidence = 0.98,
): Decision {
  return { intent, reason, actions, rules, confidence, engine: 'deterministic' };
}
function result(
  state: AgentState,
  text: string,
  intent: string,
  reason: string,
  extra: Partial<AgentResult['message']> = {},
  rules = ['A: abertura'],
  actions = ['Aplicou regras do service desk'],
): AgentResult {
  return { state, message: { text, decision: decision(intent, reason, actions, rules), ...extra } };
}
function brief(state: AgentState, text: string): string {
  return [
    state.description || text,
    state.affected && 'Afetados: ' + state.affected,
    state.urgency && 'Urgência: ' + state.urgency,
    state.lastTicketId && 'Chamado: ' + state.lastTicketId,
  ]
    .filter(Boolean)
    .join('\n')
    .slice(0, 6000);
}
async function handoff(
  state: AgentState,
  text: string,
  reason: string,
  gateway: TicketGateway,
  ownerId: string,
  ticket?: Ticket,
): Promise<AgentResult> {
  let summary = brief(state, text) + '\nMotivo do encaminhamento: ' + reason;
  if (ticket) {
    try {
      await gateway.transfer(ownerId, ticket.id, summary);
    } catch {
      summary +=
        '\nServiço de chamados indisponível: encaminhamento do chamado pendente; conversa transferida.';
    }
  }
  return {
    state: { ...state, failures: 0 },
    mode: 'waiting',
    summary,
    message: {
      text:
        'Encaminhei sua conversa para um analista com o contexto do caso. ' +
        reason +
        ' O assistente fica pausado enquanto você aguarda atendimento.',
      ...(ticket ? { tickets: [ticket] } : {}),
      decision: decision(
        'transferir',
        reason,
        ['Preparou resumo', 'Transferiu para analista'],
        ['A: transferência'],
        reason.includes('segurança') ? 0.35 : 1,
      ),
    },
  };
}
async function draftReply(
  state: AgentState,
  ownerId: string,
  gateway: TicketGateway,
): Promise<AgentResult> {
  const description = state.description || '';
  const { type, category } = classify(description);
  const priority = priorityFor(description, state.affected || '', state.urgency || '', type);
  if (priority === 'Crítica')
    return handoff(
      state,
      description,
      'Uma equipe ou a empresa está parada; prioridade crítica, com plantão e prazo de 1 hora.',
      gateway,
      ownerId,
    );
  const draft: Draft = {
    operation: 'create',
    key: randomUUID(),
    title: description.split('\n')[0].slice(0, 120),
    description: description + '\nUrgência: ' + state.urgency,
    type,
    category,
    priority,
    affected: state.affected || 'Solicitante',
  };
  const tickets = await gateway.list(ownerId);
  const match = findDuplicate(tickets, draft);
  if (match) {
    draft.operation = isResolved(match) ? 'reopen' : 'update';
    draft.ticketId = match.id;
    draft.title = match.title;
    draft.description = match.description + '\nNovo relato: ' + draft.description;
    if (isOverdue(match))
      return handoff(
        { ...state, lastTicketId: match.id },
        description,
        'Já existe um chamado sobre o problema e seu prazo está vencido.',
        gateway,
        ownerId,
        match,
      );
  }
  const text = match
    ? 'Encontrei um chamado sobre o mesmo problema. Confira o rascunho para ' +
      (draft.operation === 'reopen' ? 'reabrir' : 'atualizar') +
      ' ' +
      match.id +
      '. Só alterarei depois da sua confirmação.'
    : 'Confira os dados antes de abrir o chamado. Prioridade ' +
      priority +
      '; prazo de ' +
      slaLabel[priority] +
      '. Só criarei depois da sua confirmação.';
  return result(
    { ...state, stage: 'confirm', draft },
    text,
    'rascunho',
    'Impacto e urgência informados; verificação de duplicidade limitada aos chamados do solicitante.',
    { draft, options: ['Confirmar', 'Editar', 'Cancelar'] },
    ['A: abertura', 'A: sem duplicidade', 'A: prioridade'],
    ['Consultou seus chamados', 'Classificou a prioridade', 'Preparou rascunho'],
  );
}
async function applyPolicy(
  text: string,
  state: AgentState,
  ownerId: string,
  gateway: TicketGateway,
): Promise<AgentResult> {
  const n = normalize(text.trim());
  if (
    !state.stage &&
    /equipe|empresa|todos|setor|departamento/.test(n) &&
    priorityFor(text, text, text, 'INC') === 'Crítica'
  )
    return handoff(
      { description: text, affected: 'Equipe ou empresa', urgency: 'Parada informada' },
      text,
      'Equipe ou empresa parada: atendimento crítico com prazo de uma hora.',
      gateway,
      ownerId,
    );
  if (/nao resolveu.*abrir chamado/.test(n) && state.description)
    return result(
      { description: state.description, stage: 'impact' },
      'Vamos registrar o problema. Quem é afetado?',
      'coletar_impacto',
      'A orientação anterior não resolveu; contexto preservado.',
      { options: ['Somente eu', 'Minha equipe', 'Toda a empresa'] },
    );
  if (
    /analista|atendente|humano|pessoa real/.test(n) &&
    !/nao (quero|preciso|desejo).*?(analista|atendente|humano)/.test(n)
  )
    return handoff(state, text, 'Transferência solicitada pelo funcionário.', gateway, ownerId);
  if (
    /(^|\b)(rh|ferias|salario|holerite|reembolso|vale refeicao|facilities|ar condicionado|limpeza)(\b|$)/.test(
      n,
    ) &&
    !classify(text).known
  )
    return result(
      {},
      'Esse assunto está fora do suporte de TI. Procure o RH para férias e benefícios, Financeiro para pagamentos ou Facilities para infraestrutura predial.',
      'fora_do_escopo',
      'Assunto não relacionado a TI.',
      {},
      ['A: escopo'],
    );
  if (/^cancelar|^cancela|^nao confirmo/.test(n))
    return result(
      {},
      'Rascunho cancelado. Nenhum chamado foi criado ou alterado. Como posso ajudar?',
      'cancelar',
      'O funcionário cancelou a proposta.',
    );
  if (/^editar$/.test(n) && state.draft)
    return result(
      { stage: undefined },
      'Descreva novamente o problema com os ajustes desejados. Vou preparar outro rascunho.',
      'editar',
      'O rascunho anterior foi descartado; será exigida nova confirmação.',
    );
  if (state.stage === 'confirm' && state.draft) {
    if (
      /^(confirmar|confirmo|sim|pode (abrir|criar|atualizar|reabrir)|confirmar chamado)[.!\s]*$/.test(
        n,
      )
    ) {
      const ticket = await gateway.commit(ownerId, state.draft);
      return result(
        { lastTicketId: ticket.id },
        'Pronto! ' +
          ticket.id +
          ' foi ' +
          (state.draft.operation === 'create'
            ? 'registrado'
            : state.draft.operation === 'reopen'
              ? 'reaberto'
              : 'atualizado') +
          '. Prazo: ' +
          slaLabel[ticket.priority] +
          '.',
        'confirmar',
        'Confirmação explícita recebida; gravação idempotente pelo serviço de chamados.',
        { tickets: [ticket] },
        ['A: abertura', 'A: sem duplicidade'],
        ['Recebeu confirmação', 'Salvou chamado'],
      );
    }
    return result(
      state,
      'Há um rascunho aguardando revisão. Use Confirmar, Editar ou Cancelar. Nenhuma alteração foi feita.',
      'aguardar_confirmacao',
      'A mensagem não corresponde a uma confirmação explícita.',
      { draft: state.draft, options: ['Confirmar', 'Editar', 'Cancelar'] },
    );
  }
  if (state.stage === 'os') {
    if (/windows\s*10|^10$/.test(n))
      return result(
        { description: state.description },
        articles[0].text + ' Fonte: KB-001 — VPN com erro 809.',
        'central_ajuda',
        'A orientação foi validada para Windows 10.',
        { options: ['Não resolveu; abrir chamado', 'Falar com analista'] },
        ['A: escopo'],
        ['Consultou a central de ajuda', 'Validou sistema operacional'],
      );
    if (/windows\s*11|^11$/.test(n))
      return result(
        {
          ...state,
          stage: 'impact',
          description: (state.description || 'VPN com erro 809') + ' — Windows 11',
        },
        'No Windows 11, a central orienta abrir um chamado. Quem é afetado pelo problema?',
        'coletar_impacto',
        'A solução de Windows 10 não se aplica a Windows 11.',
        { options: ['Somente eu', 'Minha equipe', 'Toda a empresa'] },
      );
    return result(
      state,
      'Qual é o sistema operacional? Se não souber, posso chamar um analista.',
      'perguntar_sistema',
      'Falta o sistema operacional para aplicar uma orientação segura.',
      { options: ['Windows 10', 'Windows 11', 'Falar com analista'] },
    );
  }
  if (state.stage === 'impact') {
    if (!/eu|equipe|empresa|setor|pessoa|todos|somente|departamento/.test(n))
      return result(
        state,
        'Preciso saber quem é afetado: só você, sua equipe ou toda a empresa?',
        'coletar_impacto',
        'A resposta não identifica o impacto.',
        { options: ['Somente eu', 'Minha equipe', 'Toda a empresa'] },
      );
    return result(
      { ...state, stage: 'urgency', affected: text },
      'Você consegue continuar trabalhando? Existe compromisso ou entrega em risco hoje?',
      'coletar_urgencia',
      'O impacto foi registrado; falta a urgência.',
      {
        options: [
          'Não consigo trabalhar',
          'Tenho compromisso hoje',
          'Tenho alternativa',
          'Sem urgência',
        ],
      },
    );
  }
  if (state.stage === 'urgency') {
    if (!/trabalh|hoje|urgenc|alternativa|parad|atrapalh|reuniao|prazo|continuar|entrega/.test(n))
      return result(
        state,
        'Informe se está impedido de trabalhar, tem compromisso hoje ou dispõe de uma alternativa.',
        'coletar_urgencia',
        'Faltam dados objetivos para definir a prioridade.',
        {
          options: [
            'Não consigo trabalhar',
            'Tenho compromisso hoje',
            'Tenho alternativa',
            'Sem urgência',
          ],
        },
      );
    return draftReply({ ...state, urgency: text }, ownerId, gateway);
  }
  const id = text.match(/\b(?:INC|REQ)-\d+\b/i)?.[0].toUpperCase();
  if (id) {
    const ticket = await gateway.get(ownerId, id);
    if (!ticket)
      return result(
        {},
        'Não encontrei esse chamado entre os seus registros. Confira o número ou consulte seus chamados.',
        'privacidade',
        'Nenhum registro autorizado corresponde ao identificador.',
        {},
        ['A: privacidade'],
        ['Consultou seus chamados'],
      );
    const next = { lastTicketId: ticket.id };
    if (/complement|atualiz|adicion|reabr/.test(n)) {
      if (
        isResolved(ticket) &&
        (!ticket.resolvedAt || Date.now() - Date.parse(ticket.resolvedAt) > 7 * 86400000)
      )
        return result(
          next,
          'Esse chamado foi resolvido há mais de 7 dias. Descreva o problema atual para preparar um novo chamado.',
          'reabertura_fora_prazo',
          'Reabertura limitada a 7 dias.',
          {},
          ['A: sem duplicidade'],
        );
      const detail = text
        .replace(/\b(?:INC|REQ)-\d+\b/i, '')
        .replace(/^(complementar|atualizar|adicionar|reabrir)\s*/i, '')
        .trim();
      if (detail.length < 8)
        return result(
          next,
          'Envie o número do chamado e as novas informações, por exemplo: “Complementar ' +
            id +
            ': o erro começou após reiniciar”.',
          'coletar_complemento',
          'Falta a informação a acrescentar.',
        );
      const draft: Draft = {
        operation: isResolved(ticket) ? 'reopen' : 'update',
        ticketId: id,
        key: randomUUID(),
        title: ticket.title,
        description: ticket.description + '\nComplemento: ' + detail,
        type: ticket.type,
        category: ticket.category,
        priority: ticket.priority,
        affected: ticket.affected,
      };
      return result(
        { ...next, stage: 'confirm', draft },
        'Confira o complemento de ' + id + '. Só atualizarei após sua confirmação.',
        'rascunho_atualizacao',
        'Registro pertence ao solicitante; alteração pendente de confirmação.',
        { draft, options: ['Confirmar', 'Editar', 'Cancelar'] },
        ['A: abertura', 'A: privacidade'],
      );
    }
    if (isOverdue(ticket))
      return handoff(
        { ...next, description: ticket.title },
        text,
        'O prazo de resposta ou atualização do chamado venceu.',
        gateway,
        ownerId,
        ticket,
      );
    return result(
      next,
      ticket.id +
        ': ' +
        ticket.status +
        '. Prioridade ' +
        ticket.priority +
        '. Prazo: ' +
        new Date(ticket.dueAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) +
        ' (São Paulo).',
      'consultar',
      'Consulta restrita ao solicitante, com avaliação do prazo.',
      { tickets: [ticket] },
      ['A: privacidade', 'A: prioridade'],
      ['Consultou seus chamados', 'Verificou prazo'],
    );
  }
  if (/meus chamados|consultar|acompanhar|status|andamento|como esta|chamados abertos/.test(n)) {
    const tickets = await gateway.list(ownerId);
    const open = tickets.filter((t) => !isResolved(t));
    return result(
      {},
      open.length
        ? 'Selecione o chamado que deseja consultar.'
        : 'Você não tem chamados abertos. Pode informar o número de um chamado resolvido ou descrever um novo problema.',
      'listar',
      'Exibindo somente chamados abertos do solicitante.',
      { tickets: open, options: open.slice(0, 6).map((t) => t.id) },
      ['A: privacidade'],
      ['Consultou seus chamados'],
    );
  }
  if (/^(oi|ola|bom dia|boa tarde|boa noite|obrigad[oa]|ajuda)[!.\s]*$/.test(n))
    return result(
      {},
      'Olá! Posso tirar dúvidas de TI, consultar chamados ou registrar um problema. Como posso ajudar?',
      'saudacao',
      'Mensagem de saudação.',
      { options: ['Consultar meus chamados', 'Meu notebook está lento', 'Falar com analista'] },
      ['A: escopo'],
    );
  const article = findArticle(text);
  if (article) {
    if (article.id === 'KB-001') {
      if (/windows\s*11/.test(n))
        return result(
          { stage: 'impact', description: text },
          'No Windows 11, a orientação é abrir um chamado. Quem é afetado?',
          'coletar_impacto',
          'Artigo KB-001 exige chamado para Windows 11.',
          { options: ['Somente eu', 'Minha equipe', 'Toda a empresa'] },
        );
      if (!/windows\s*10/.test(n))
        return result(
          { stage: 'os', description: text },
          'Encontrei um artigo para o erro 809, mas a orientação depende do sistema. Você usa Windows 10 ou Windows 11?',
          'perguntar_sistema',
          'Não aplicar instruções sem validar a condição do artigo.',
          { options: ['Windows 10', 'Windows 11', 'Falar com analista'] },
          ['A: escopo'],
          ['Consultou a central de ajuda'],
        );
    }
    return result(
      {},
      article.text + ' Fonte: ' + article.id + ' — ' + article.title + '.',
      'central_ajuda',
      'Artigo correspondente à dúvida e condições verificadas.',
      {},
      ['A: escopo'],
      ['Consultou a central de ajuda'],
    );
  }
  const classification = classify(text);
  if (classification.known || /abrir chamado|problema de ti/.test(n)) {
    if (text.length < 12 || /^abrir chamado$/.test(n))
      return result(
        {},
        'Descreva o problema ou o pedido de TI com mais detalhes.',
        'coletar_descricao',
        'Descrição insuficiente para um chamado completo.',
      );
    return result(
      { stage: 'impact', description: text },
      'Entendi. Quem é afetado: somente você, sua equipe ou toda a empresa?',
      'coletar_impacto',
      'Assunto de TI identificado; faltam impacto e urgência.',
      { options: ['Somente eu', 'Minha equipe', 'Toda a empresa'] },
    );
  }
  return handoff(
    state,
    text,
    'Não tenho segurança suficiente para interpretar a solicitação. Um analista poderá ajudar.',
    gateway,
    ownerId,
  );
}
const GraphState = Annotation.Root({
  text: Annotation<string>(),
  state: Annotation<AgentState>(),
  ownerId: Annotation<string>(),
  gateway: Annotation<TicketGateway>(),
  classification: Annotation<ReturnType<typeof classify>>(),
  result: Annotation<AgentResult>(),
  started: Annotation<number>(),
});
const graph = new StateGraph(GraphState)
  .addNode('classificar', (s) => ({ classification: classify(s.text), started: Date.now() }))
  .addNode('aplicar_regras', async (s) => ({
    result: await applyPolicy(s.text, s.state, s.ownerId, s.gateway),
  }))
  .addNode('responder', (s) => ({
    result: {
      ...s.result,
      message: {
        ...s.result.message,
        decision: { ...s.result.message.decision!, elapsedMs: Date.now() - s.started },
      },
    },
  }))
  .addEdge(START, 'classificar')
  .addEdge('classificar', 'aplicar_regras')
  .addEdge('aplicar_regras', 'responder')
  .addEdge('responder', END)
  .compile();
export async function runAgent(
  text: string,
  state: AgentState,
  ownerId: string,
  gateway: TicketGateway,
): Promise<AgentResult> {
  try {
    let understood: Awaited<ReturnType<typeof interpret>> | undefined;
    if (needsInterpretation(text, state)) {
      try {
        understood = await interpret(text, state);
      } catch {
        return handoff(
          state,
          text,
          'O modelo local não está disponível ou retornou dados inválidos. Não tenho segurança para decidir.',
          gateway,
          ownerId,
        );
      }
      if (understood.confidence < 0.75 || understood.intent === 'unknown')
        return handoff(
          state,
          text,
          'Não tenho segurança suficiente para interpretar esta mensagem.',
          gateway,
          ownerId,
        );
    }
    const effective =
      understood?.intent === 'human'
        ? 'Falar com analista'
        : understood?.intent === 'list' && !/\b(?:INC|REQ)-\d+/i.test(text)
          ? 'Consultar meus chamados'
          : understood?.intent === 'out_of_scope'
            ? 'Assunto de RH: férias'
            : (understood?.canonical ?? text);
    const response = (await graph.invoke({ text: effective, state, ownerId, gateway })).result;
    if (understood && response.message.decision) {
      response.message.decision.engine = 'ollama';
      response.message.decision.model = process.env.OLLAMA_MODEL ?? 'qwen2.5:3b';
      response.message.decision.interpretation = understood.canonical;
      response.message.decision.confidence = Math.min(
        response.message.decision.confidence,
        understood.confidence,
      );
      response.message.decision.reason =
        understood.reason + ' Política aplicada: ' + response.message.decision.reason;
      response.message.decision.actions.unshift('Interpretou a mensagem com LLM local');
      if (response.state.description && !state.description)
        response.state.description += '\nRelato original: ' + text;
    }
    return response;
  } catch {
    const failures = (state.failures || 0) + 1;
    if (failures >= 2)
      return handoff(
        { ...state, failures },
        text,
        'O serviço de chamados continua indisponível. Um analista dará continuidade sem duplicar sua solicitação.',
        gateway,
        ownerId,
      );
    return result(
      { ...state, failures },
      'O serviço de chamados está temporariamente indisponível. Seu contexto foi preservado; tente novamente. Se havia um rascunho, confirme novamente para retomar com segurança.',
      'servico_indisponivel',
      'Falha transitória; não confirmar sucesso sem resposta do serviço.',
      state.draft
        ? { draft: state.draft, options: ['Confirmar', 'Falar com analista'] }
        : { options: ['Consultar meus chamados', 'Falar com analista'] },
      ['A: sem duplicidade'],
      ['Detectou indisponibilidade'],
    );
  }
}
