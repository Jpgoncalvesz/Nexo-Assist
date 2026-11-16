import { spawn } from 'node:child_process';
if (process.env.AGENT_MODE === 'ollama') {
  const base = new URL(process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434');
  if (!['localhost', '127.0.0.1', '[::1]'].includes(base.hostname))
    throw new Error('Configure Ollama local.');
  const healthy = async () => {
    try {
      return (await fetch(new URL('/api/tags', base), { signal: AbortSignal.timeout(1500) })).ok;
    } catch {
      return false;
    }
  };
  if (!(await healthy())) {
    const child = spawn('ollama', ['serve'], {
      detached: true,
      windowsHide: true,
      stdio: 'ignore',
    });
    child.on('error', () => console.error('Instale Ollama e execute ollama pull qwen2.5:3b.'));
    child.unref();
    for (let i = 0; i < 15 && !(await healthy()); i++)
      await new Promise((r) => setTimeout(r, 1000));
  }
  if (!(await healthy()))
    throw new Error('Ollama indisponível. Abra o aplicativo Ollama e tente novamente.');
  const data = (await (await fetch(new URL('/api/tags', base))).json()) as {
    models: { name: string }[];
  };
  if (!data.models.some((m) => m.name === (process.env.OLLAMA_MODEL ?? 'qwen2.5:3b')))
    throw new Error('Baixe o modelo com ollama pull ' + (process.env.OLLAMA_MODEL ?? 'qwen2.5:3b'));
  console.log('LLM local disponível.');
}
