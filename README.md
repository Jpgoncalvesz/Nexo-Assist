# Nexo Assist

Service desk local baseado no PRD v5 e no protótipo nexo.pen. Next.js, TypeScript estrito, PostgreSQL e workflow LangGraph.js. **As respostas são simuladas por regras, sem LLM, API paga ou chave de provedor.** Esta escolha foi solicitada; o requisito original de provedor LLM não está integralmente atendido.

## Executar no Windows

Requisitos: Node.js 24, npm e PostgreSQL local em execução.

1. Abra um terminal nesta pasta e execute `npm ci`.
2. Copie `.env.example` para `.env`, preencha sua senha do PostgreSQL e gere uma chave interna conforme o exemplo. Nesta máquina o arquivo local já foi configurado.
3. Execute `npm run db:setup`. Cria somente o banco exclusivo indicado, com prefixo nexo_assist_. Seed idempotente, sem apagar registros.
4. Execute `npm run dev` e abra http://127.0.0.1:3100.

Produção local: `npm run build` seguido de `npm start`. Encerre com Ctrl+C. Serviço independente em 127.0.0.1:4311; não exponha esse ambiente demonstrativo à internet.

Contas fictícias, aceitando qualquer senha não vazia:

| Perfil      | E-mail                   |
| ----------- | ------------------------ |
| Funcionária | ana.souza@nexo.com.br    |
| Funcionário | bruno.lima@nexo.com.br   |
| Funcionária | carla.mendes@nexo.com.br |
| Analista N1 | rafael.lima@nexo.com.br  |
| Analista N2 | marina.costa@nexo.com.br |

Use janelas separadas para funcionário e analista.

## Arquitetura e decisões

- `src/app`: interface e API autenticada; validações Zod, cookies HttpOnly/SameSite, origem permitida, limite de mensagens e autorização.
- `src/agent`: grafo LangGraph classificar → aplicar regras → responder, central de ajuda e SLA. Estado serializável persistido pela API; nenhuma memória volátil necessária para retomar.
- `services/tickets`: processo HTTP independente; consulta, criação, atualização, reabertura e transferência. Chave interna não chega ao navegador.
- `src/lib/ticket-client.ts`: timeouts e tentativas limitadas. Operações possuem chave idempotente.
- PostgreSQL: funcionários, sessões com hash do token, conversas, mensagens/decisões em JSONB, chamados e registro das operações. Transações e bloqueio de linha serializam mensagens e disputa de analistas; bloqueio por funcionário protege alterações concorrentes dos chamados.

Nenhuma mutação de conteúdo do chamado acontece antes da confirmação do rascunho. Transferir atendimento é uma transição operacional exigida pelo PRD. O servidor verifica novamente proprietário e duplicidade. Chamados resolvidos em até sete dias podem ser reabertos.

Prioridades: Crítica = equipe/empresa parada, uma hora corrida; Alta = pessoa impedida ou compromisso hoje, quatro horas úteis; Média = alternativa disponível, três dias úteis; Baixa = pedido sem urgência, cinco dias úteis. Assumimos jornada de segunda a sexta, 08–18, America/Sao_Paulo; dia útil equivale a dez horas. Não há calendário de feriados.

Decisões mostram intenção, ações, regras, justificativa e confiança **heurística**, não probabilidade calibrada. Solicitações desconhecidas vão ao analista. A pausa ocorre tanto na espera quanto no atendimento humano. Cada conversa aceita no máximo 30 mensagens do funcionário.

## Demonstração

- “VPN com erro 809”: deve perguntar Windows 10/11 antes de orientar.
- “Preciso de um teclado novo” → “Somente eu” → “Sem urgência” → revisar → Confirmar.
- “Consultar meus chamados” → INC-20311: vencimento e encaminhamento.
- “Complementar INC-20298: o acesso continua negado após reiniciar”: rascunho antes de atualizar.
- “Senha do SAP bloqueada”: exemplo de reabertura recente.
- “Quero falar com um analista”: Rafael assume, responde, devolve ao agente ou encerra.
- Entre como Bruno: registros de Ana não podem ser lidos.
- Configure TICKET_FAILURE_EVERY=3 e reinicie para simular indisponibilidade periódica.

## Qualidade e revisão

```text
npm run format:check
npm run typecheck
npm test
npm run test:service
npm run test:e2e
npm run build
```

Integração e E2E precisam dos dois servidores e banco ativos. E2E usa Microsoft Edge instalado. Os testes do serviço limpam apenas seus próprios registros; E2E deixa conversas fictícias para inspeção. Prettier e EditorConfig padronizam indentação, UTF-8 e fins de linha; `npm run format` aplica o padrão.

Otimizações: fontes locais; grafo compilado uma vez; pool de conexões limitado; listagem devolve só a última mensagem e carrega o histórico completo ao selecionar; polling apenas em atendimento humano/console, suspenso com aba oculta, sem requisições sobrepostas. Respostas usam regras sem custo de inferência. Não foi feito teste de carga de produção.

## Limitações e próximos passos

A autenticação aceita qualquer senha por exigência do desafio; não equivale a autenticação corporativa. Antes de produção: SSO, rate limiting, paginação da lista, retenção de mensagens e monitoramento. JSONB facilita o protótipo, mas mensagens em tabela própria seriam melhores para grandes volumes. O polling atualiza atendimento humano a cada 2,5 segundos; não é streaming de tokens. Reconhecimento e duplicidade são heurísticos, com cobertura limitada a linguagem conhecida; não representam compreensão geral. Integrar LLM real exige adaptador, avaliações adicionais e política de custo; nenhum provedor é fingido.

O visual reproduz cores, fontes, estrutura e estados principais do protótipo, sem afirmar equivalência pixel a pixel. O perfil mostra dados fictícios; não envia e-mail nem redefine senhas reais.

Nenhum projeto alheio foi modificado. Não há publicação ou remoto GitHub configurado. `.env` e arquivos de execução são ignorados pelo Git. O exemplo contém placeholders. Consulte docs/VALIDACAO.md para os resultados efetivamente observados.
