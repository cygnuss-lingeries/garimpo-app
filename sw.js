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
