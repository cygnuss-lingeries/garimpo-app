// Recebe o que o "Compartilhar" do Android manda para o Garimpo.
// O pedido chega como POST em ./compartilhar. Como o site é só arquivos, quem atende é este
// arquivo, dentro do próprio celular: ele guarda o link e as mídias e abre o app, que então
// manda tudo para a caixa de entrada com a sessão do dono. Nada do post vai no endereço da página.
// De propósito não guarda o app para uso sem internet: assim nunca fica versão velha presa.

const GAVETA = 'garimpo-compartilhado-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (evento) => evento.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (evento) => {
  const endereco = new URL(evento.request.url);
  if (evento.request.method !== 'POST' || !endereco.pathname.endsWith('/compartilhar')) return;

  evento.respondWith((async () => {
    try {
      const dados = await evento.request.formData();
      const texto = ['url', 'texto', 'titulo']
        .map((campo) => dados.get(campo))
        .filter((valor) => typeof valor === 'string' && valor.trim())
        .join(' ');
      const gaveta = await caches.open(GAVETA);
      const lote = Date.now();
      await gaveta.put(`./_recebido/${lote}/texto`, new Response(texto));
      let n = 0;
      for (const arquivo of dados.getAll('midia')) {
        if (!(arquivo instanceof File) || arquivo.size === 0) continue;
        n += 1;
        await gaveta.put(`./_recebido/${lote}/arquivo-${n}`, new Response(arquivo, {
          headers: {
            'content-type': arquivo.type || 'application/octet-stream',
            'x-nome': encodeURIComponent(arquivo.name || `arquivo-${n}`),
          },
        }));
      }
    } catch (erro) {
      // Mesmo se não der para guardar, o app abre; ele avisa que nada chegou.
    }
    return Response.redirect('./?recebido=1', 303);
  })());
});

// ───────── aviso no celular ─────────
// O servidor manda o texto cifrado (só este aparelho lê) e aqui ele vira notificação de texto simples.
// Vários avisos seguidos viram um só ("3 novidades no Garimpo"), sem tocar de novo a cada um.

const MARCA_DO_AVISO = 'garimpo';
const ITEM_VALIDO = /^[0-9a-f-]{36}$/;

self.addEventListener('push', (evento) => {
  evento.waitUntil((async () => {
    let mensagem = {};
    try { mensagem = evento.data ? evento.data.json() : {}; } catch (erro) { mensagem = {}; }
    const abertos = await self.registration.getNotifications({ tag: MARCA_DO_AVISO });
    const antes = abertos.reduce((total, aviso) => total + ((aviso.data && aviso.data.quantas) || 1), 0);
    const quantas = antes + 1;
    const item = typeof mensagem.item === 'string' && ITEM_VALIDO.test(mensagem.item) ? mensagem.item : null;
    await self.registration.showNotification(
      quantas > 1 ? quantas + ' novidades no Garimpo' : String(mensagem.titulo || 'Garimpo'),
      {
        body: quantas > 1 ? String(mensagem.titulo || '') : String(mensagem.texto || 'Tem novidade no Garimpo.'),
        tag: MARCA_DO_AVISO,
        icon: 'icones/icone-192.png',
        lang: 'pt-BR',
        data: { quantas, item: quantas > 1 ? null : item },
      },
    );
    // Com o app aberto, a lista se atualiza sozinha.
    const janelas = await self.clients.matchAll({ type: 'window' });
    for (const janela of janelas) janela.postMessage({ tipo: 'novidade' });
  })());
});

self.addEventListener('notificationclick', (evento) => {
  evento.notification.close();
  const item = evento.notification.data && evento.notification.data.item;
  evento.waitUntil((async () => {
    const janelas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const aberta = janelas.find((janela) => janela.url.startsWith(self.registration.scope));
    if (aberta) {
      await aberta.focus();
      if (item) aberta.postMessage({ tipo: 'abrir', item });
      return;
    }
    await self.clients.openWindow(new URL(item ? './?abrir=' + item : './', self.registration.scope).href);
  })());
});
