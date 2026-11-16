import { test, expect, request as requestFactory, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import type { Conversation } from '../src/lib/types';
const url = 'http://127.0.0.1:3100';
async function login(email: string) {
  const api = await requestFactory.newContext({ baseURL: url });
  expect((await api.post('/api/login', { data: { email, password: 'demo' } })).ok()).toBeTruthy();
  return api;
}
async function conversation(api: APIRequestContext) {
  const r = await api.post('/api/conversations');
  expect(r.status()).toBe(201);
  return (await r.json()).conversation as Conversation;
}
async function send(api: APIRequestContext, id: string, text: string, requestId = randomUUID()) {
  const r = await api.post('/api/conversations/' + id + '/messages', { data: { text, requestId } });
  expect(r.ok(), await r.text()).toBeTruthy();
  return (await r.json()).conversation as Conversation;
}
test('sessão, privacidade, origem, idempotência, transferência e posse do analista', async () => {
  const ana = await login('ana.souza@nexo.com.br');
  const bruno = await login('bruno.lima@nexo.com.br');
  const analyst = await login('rafael.lima@nexo.com.br');
  const other = await login('marina.costa@nexo.com.br');
  const anonymous = await requestFactory.newContext({ baseURL: url });
  expect((await anonymous.get('/api/conversations')).status()).toBe(401);
  const c = await conversation(ana);
  expect((await bruno.get('/api/conversations/' + c.id)).status()).toBe(404);
  expect(
    (
      await bruno.post('/api/conversations/' + c.id + '/messages', {
        data: { text: 'oi', requestId: randomUUID() },
      })
    ).status(),
  ).toBe(404);
  expect(
    (
      await ana.post('/api/conversations', { headers: { origin: 'https://evil.invalid' } })
    ).status(),
  ).toBe(403);
  const foreign = await send(ana, c.id, 'Consultar chamado INC-20400');
  expect(JSON.stringify(foreign.messages.at(-1))).not.toContain('VPN não conecta');
  const id = randomUUID();
  const first = await send(ana, c.id, 'Qual o horário do service desk?', id);
  const repeat = await send(ana, c.id, 'Qual o horário do service desk?', id);
  expect(repeat.messages.length).toBe(first.messages.length);
  const handoff = await send(ana, c.id, 'Quero falar com um analista');
  expect(handoff.mode).toBe('waiting');
  expect(handoff.summary.length).toBeGreaterThan(5);
  const paused = await send(ana, c.id, 'Ainda preciso de ajuda.');
  expect(paused.messages.at(-1)?.role).toBe('user');
  expect(
    (
      await ana.post('/api/conversations/' + c.id + '/action', { data: { action: 'claim' } })
    ).status(),
  ).toBe(403);
  expect(
    (
      await analyst.post('/api/conversations/' + c.id + '/action', { data: { action: 'claim' } })
    ).ok(),
  ).toBeTruthy();
  expect(
    (
      await other.post('/api/conversations/' + c.id + '/action', { data: { action: 'claim' } })
    ).status(),
  ).toBe(409);
  expect(
    (
      await other.post('/api/conversations/' + c.id + '/messages', {
        data: { text: 'tentativa', requestId: randomUUID() },
      })
    ).status(),
  ).toBe(403);
  const human = await send(analyst, c.id, 'Olá, vou acompanhar seu caso.');
  expect(human.messages.at(-1)?.role).toBe('analyst');
  expect(
    (
      await analyst.post('/api/conversations/' + c.id + '/action', { data: { action: 'release' } })
    ).ok(),
  ).toBeTruthy();
  const resumed = await send(ana, c.id, 'Qual o horário do service desk?');
  expect(resumed.mode).toBe('agent');
  expect(resumed.messages.at(-1)?.role).toBe('assistant');
  await send(ana, c.id, 'Quero falar com um analista');
  await analyst.post('/api/conversations/' + c.id + '/action', { data: { action: 'claim' } });
  expect(
    (
      await analyst.post('/api/conversations/' + c.id + '/action', { data: { action: 'close' } })
    ).ok(),
  ).toBeTruthy();
  expect(
    (
      await ana.post('/api/conversations/' + c.id + '/messages', {
        data: { text: 'Olá', requestId: randomUUID() },
      })
    ).status(),
  ).toBe(409);
  for (const api of [ana, bruno, analyst, other, anonymous]) await api.dispose();
});
test('limite de 30 mensagens é persistente e aplicado no servidor', async () => {
  const ana = await login('ana.souza@nexo.com.br');
  const c = await conversation(ana);
  for (let i = 0; i < 30; i++) await send(ana, c.id, 'Qual o horário do service desk?');
  const response = await ana.post('/api/conversations/' + c.id + '/messages', {
    data: { text: 'Mais uma', requestId: randomUUID() },
  });
  expect(response.status()).toBe(409);
  const restored = (await (await ana.get('/api/conversations/' + c.id)).json())
    .conversation as Conversation;
  expect(restored.messageCount).toBe(30);
  await ana.dispose();
});
test('saúde dos dois serviços e login visual em desktop e celular', async ({ page }) => {
  expect((await page.request.get('/api/health')).status()).toBe(200);
  await page.goto('/');
  await expect(page.getByText('Nexo Assist').first()).toBeVisible();
  await expect(page.locator('input[type=email]')).toBeVisible();
  await page.screenshot({ path: 'docs/login-desktop.png', fullPage: true });
  const email = page.locator('input[type=email]');
  const password = page.locator('input[type=password]');
  await email.fill('ana.souza@nexo.com.br');
  await password.fill('demo');
  await page.getByRole('button', { name: /entrar/i }).click();
  await expect(page.getByText('Ana Souza').first()).toBeVisible();
  await page.getByRole('button', { name: 'Nova conversa' }).click();
  await expect(page.getByRole('button', { name: /Abrir chamado/ })).toBeVisible();
  await page.screenshot({ path: 'docs/chat-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'docs/chat-mobile.png', fullPage: true });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
});

test('abertura confirmada pela interface e console do analista', async ({ page }) => {
  await page.request.post('/api/login', {
    data: { email: 'carla.mendes@nexo.com.br', password: 'demo' },
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Nova conversa' }).click();
  const composer = page.getByRole('textbox', { name: 'Mensagem' });
  await composer.fill('Preciso de um teclado novo');
  await page.getByRole('button', { name: 'Enviar', exact: true }).click();
  await page.getByRole('button', { name: /Somente eu/ }).click();
  await page.getByRole('button', { name: /Sem urgência/ }).click();
  await expect(page.getByText('Aguardando confirmação').last()).toBeVisible();
  await page.screenshot({ path: 'docs/rascunho-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Confirmar', exact: true }).click();
  await expect(page.getByText(/Pronto! REQ-/).last()).toBeVisible();
  await page.request.post('/api/logout', { data: {} });
  await page.request.post('/api/login', {
    data: { email: 'rafael.lima@nexo.com.br', password: 'demo' },
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Conversas', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Para você', exact: true }).click();
  await page.locator('.conversation-item').first().click();
  await expect(page.getByRole('button', { name: 'Assumir atendimento' })).toBeVisible();
  await page.screenshot({ path: 'docs/console-desktop.png', fullPage: true });
});
