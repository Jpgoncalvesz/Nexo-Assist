# Validação — 16/11/2026

Ambiente: Windows, Node 24.22.0, PostgreSQL 18.6, Next.js 16.4.6, React 19.3.1, LangGraph 1.7.4 e Ollama 0.33.3 com Qwen2.5 3B local (1,9 GB). Computador com aproximadamente 16 GB RAM.

## Resultados observados

- TypeScript estrito e build de produção aprovados.
- Formatação padronizada pelo Prettier.
- 31 testes unitários: 19 agente, 6 SLA e 6 guardas/regressões de LLM/política.
- 16 verificações do serviço de chamados com PostgreSQL aprovadas.
- 4 cenários Playwright/Edge passaram com modo Ollama habilitado: privacidade/idempotência/posse de analista; limite 30; interface desktop/celular; criação confirmada e console.
- Inferência real testada em 5 mensagens: falha de rede, impacto individual, alternativa de trabalho, consulta de chamados e transferência humana. Interpretações corretas na execução registrada após ajuste do prompt; script inclui assertions de intenção, confiança e conteúdo.
- Persistência: comparação anterior ao reinício de desenvolvimento para produção preservou hash de 13 registros idênticos. O serviço Windows PostgreSQL não foi reiniciado.
- Capturas em docs/*.png; login, celular e console inspecionados. Viewport móvel 390px sem rolagem horizontal no teste.
- npm audit --omit=dev não reportou vulnerabilidades na execução anterior. Não representa garantia permanente.

## Correções e otimizações

Corrigidos login/origem, botão de assumir fora da fila, limite visual de mensagens, prioridade de falhas com alternativa e preservação do relato anterior ao atualizar duplicado. Chamado duplicado vencido é encaminhado ao analista. Confirmar/Editar/Cancelar não são inferidos pelo LLM.

Fontes locais, índices PostgreSQL, prévias de conversa, polling seletivo e sem sobreposição. Botões e artigos conhecidos não gastam inferência. A chamada LLM tem limite de contexto, saída e timeout. Saídas inválidas ou baixa confiança geram transferência.

## Limites transparentes

As primeiras avaliações detectaram um esquema incompatível com o runtime e classificações incorretas. O esquema enviado e o prompt foram ajustados; validação de saída estrita foi preservada. Tempos observados no conjunto real após ajuste: aproximadamente 3–16 segundos por inferência.

Cinco casos reais não demonstram compreensão geral ou ausência de alucinações. Deduplicação permanece heurística. Não houve teste de carga, auditoria externa ou comparação pixel a pixel. Autenticação é fictícia por requisito; SLA usa calendário útil sem feriados. Deploy online é opcional e não integra esta entrega de código no GitHub.

Testes E2E deixam conversas fictícias; o seed preserva dados existentes. Senhas e chave interna ficam apenas no .env local, ignorado pelo Git.
