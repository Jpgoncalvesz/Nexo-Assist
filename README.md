# Nexo Assist

Service desk implementado a partir do PRD v5 e do protótipo nexo.pen. Next.js, TypeScript estrito, LangGraph.js, **LLM local real via Ollama/Qwen2.5 3B** e PostgreSQL. Funcionários e chamados são fictícios; a inferência do modelo é real.

## Rodar localmente

Requisitos: Node.js 24, PostgreSQL e Ollama. A máquina de validação tem 16 GB de RAM. O modelo ocupa aproximadamente 1,9 GB em disco e pode usar CPU.

1. `npm ci`
2. `ollama pull qwen2.5:3b`
3. Copie `.env.example` para `.env`; configure a senha PostgreSQL e uma chave interna aleatória conforme instruções no arquivo.
4. `npm run db:setup`
5. `npm run dev`; acesse http://127.0.0.1:3100.

Produção local: `npm run build` e `npm start`. O script verifica/inicia Ollama automaticamente. Nesta máquina, dependências, modelo, banco e .env já estão preparados; `Iniciar Nexo.cmd` inicia a versão compilada. Ctrl+C encerra os dois processos da aplicação. Ollama pode continuar em segundo plano e descarrega o modelo após dez minutos de inatividade.

Banco exclusivo `nexo_assist_v5`. O seed é idempotente, não apaga conversas. Serviço independente em 127.0.0.1:4311. Nenhum serviço precisa ser exposto à internet.

| Perfil      | E-mail                   |
| ----------- | ------------------------ |
| Funcionária | ana.souza@nexo.com.br    |
| Funcionário | bruno.lima@nexo.com.br   |
| Funcionária | carla.mendes@nexo.com.br |
| Analista N1 | rafael.lima@nexo.com.br  |
| Analista N2 | marina.costa@nexo.com.br |

Qualquer senha não vazia é aceita **por exigência do desafio**, sem simular autenticação corporativa real. Use janelas separadas para funcionário e analista.

## Arquitetura e decisão

Interface → API autenticada → interpretação Ollama → workflow LangGraph → serviço HTTP de chamados → PostgreSQL.

- `src/agent/llm.ts`: adapta o provedor local, interpreta linguagem natural e valida JSON com Zod. Mantém identificadores originais, rejeita ações reservadas inventadas e tem timeout. Não recebe registros de outros funcionários, credenciais ou acesso direto ao banco.
- `src/agent/engine.ts`: workflow classificar/aplicar regras/responder, coleta informações, consulta central/chamados, produz rascunhos e encaminha para analista.
- `src/agent/sla.ts`: prioridade e cálculo de horas úteis.
- `services/tickets`: processo independente, validações próprias, transações, idempotência e escopo de proprietário.
- `src/app/api`: sessões, privacidade, limite de mensagens, persistência e disputa de atendimento.
- PostgreSQL: funcionários, sessões com hash do token, conversas com mensagens/estado/decisões JSONB, chamados e operações idempotentes.

O LLM interpreta mensagens livres. Botões, confirmações, consultas diretas por número e artigos reconhecidos seguem caminhos determinísticos, reduzindo latência e custo. **A confirmação nunca é inferida pelo LLM**: criar/atualizar/reabrir exige confirmação explícita de um rascunho completo. O serviço verifica novamente proprietário, duplicidade e prazo de reabertura. A explicação de cada resposta mostra ações, intenção, regras, confiança heurística e, quando usado, modelo/interpretação.

Escolhemos Ollama para executar sem chave paga e manter dados no computador. Qwen2.5 3B cabe no ambiente testado. Confiança é uma indicação heurística, não probabilidade calibrada. Interpretações abaixo de 0,75, inválidas ou indisponibilidade do modelo encaminham ao analista. `AGENT_MODE=deterministic` habilita somente regras para testes e comparação; **esse modo isolado não atende ao requisito de LLM**.

[Documentação oficial do Ollama: saídas estruturadas](https://docs.ollama.com/capabilities/structured-outputs). A API recebe esquema simples compatível com o runtime; validações adicionais são aplicadas no código.

## Regras do Anexo A

INC representa falha, REQ representa pedido. Categorias: Acesso, Rede e VPN, Hardware, Software, E-mail e Outros. Todo rascunho contém título, descrição, tipo, categoria, prioridade e afetados. Duplicados abertos são atualizados com preservação do relato anterior; resolvidos há até sete dias podem ser reabertos.

Prioridade crítica: equipe/empresa parada, uma hora corrida. Alta: pessoa impedida ou compromisso no mesmo dia, quatro horas úteis. Média: há alternativa, três dias úteis. Baixa: pedidos sem urgência, cinco dias úteis. Assumimos segunda a sexta, 08–18, America/Sao_Paulo, dez horas por dia útil, sem calendário de feriados. Transferência não renova artificialmente o SLA.

O agente pausa na fila e durante atendimento humano. Analistas podem assumir, responder, devolver ao agente e encerrar. O servidor valida a posse da conversa. São permitidas até 30 mensagens de funcionário por conversa, inclusive após reinício.

## Roteiro de demonstração

- “VPN com erro 809”: verifica Windows 10/11 antes de orientar.
- “Preciso de um teclado novo” → “Somente eu” → “Sem urgência” → conferir → Confirmar.
- “O túnel corporativo caiu e não consigo acessar a rede da firma”: interpretação por LLM.
- “Consultar meus chamados” → INC-20311: vencimento e transferência.
- “Complementar INC-20298: o erro continua após reiniciar”: rascunho de atualização.
- “Senha do SAP bloqueada”: demonstra reabertura recente.
- “Quero falar com um analista”: assumir com Rafael, responder, devolver ou encerrar.
- Bruno não acessa os chamados de Ana.
- `TICKET_FAILURE_EVERY=3` e reinício simulam indisponibilidade periódica do legado.

## Verificação

```text
npm run format:check
npm run typecheck
npm test
npm run test:service
npm run test:llm
npm run test:e2e
npm run build
```

Serviço e E2E precisam do banco e dos dois processos ativos. Testes LLM requerem Ollama/modelo. E2E usa Microsoft Edge instalado. Os testes de serviço limpam seus próprios registros; E2E deixa conversas fictícias para inspeção. Resultados efetivos em docs/VALIDACAO.md e matriz em docs/RASTREABILIDADE.md.

## Qualidade, eficiência e limites

Prettier, EditorConfig e Git attributes padronizam formatação. Fontes locais; pool limitado; índices por proprietário/data/e-mail; listas carregam somente prévia, histórico completo sob demanda; polling de 2,5 segundos apenas em console/atendimento humano, suspenso em aba oculta e sem sobreposição. Modelo usa contexto limitado, temperatura zero e orçamento de saída. Não há cobrança por token; há consumo de recursos locais.

Modelo pequeno pode interpretar incorretamente linguagem ambígua. A política valida dados e preserva confirmação/privacidade, mas os testes não demonstram correção para toda frase possível. No hardware testado, inferência variou entre aproximadamente 3 e 16 segundos; caminhos determinísticos são mais rápidos. Não foi feito teste de carga ou auditoria externa.

A interface segue composição, fontes, cores e estados do protótipo; não se afirma igualdade pixel a pixel. O perfil é demonstrativo, sem redefinição de senha real. A evolução para produção exigiria SSO, limite de requisições, retenção, paginação, calendário corporativo, observabilidade e um modelo maior avaliado. GitHub armazena o código; execução online com PostgreSQL e Ollama exige hospedagem de servidor, não GitHub Pages.

Credenciais ficam em .env ignorado. Nunca envie .env, node_modules, banco ou credenciais ao repositório. Apenas dados fictícios de demonstração e código devem ser versionados.
