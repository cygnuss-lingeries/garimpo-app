// Tela do Garimpo: lista de cards, zoom de cada post e decisão dentro do zoom.
// Todo texto que vem de um post entra por textContent (nunca como HTML).
(function () {
  'use strict';

  const SVG = 'http://www.w3.org/2000/svg';
  const ref = (nome) => document.querySelector('[data-ref="' + nome + '"]');
  const largo = window.matchMedia('(min-width: 1000px)');

  const TIPOS = { skill: 'Skill', ferramenta: 'Ferramenta', prompt: 'Prompt', dica: 'Dica', inspiracao: 'Inspiração', propaganda: 'Propaganda', outro: 'Outro' };
  const VEREDITOS = { vale: 'Vale', talvez: 'Talvez', nao_vale: 'Não vale' };
  const ORIGENS = { instagram: 'Instagram', tiktok: 'TikTok', arquivo: 'Arquivo enviado', outro: 'Link' };
  const NOTAS = [['qualidade', 'Qualidade'], ['cobertura', 'Cobertura'], ['facilidade', 'Facilidade'], ['encaixe', 'Encaixe'], ['risco', 'Segurança']];
  const RISCOS = { baixo: 'baixo', medio: 'médio', alto: 'alto' };
  const ESTADOS = {
    na_fila: { rotulo: 'Na fila', icone: 'relogio', texto: 'O PC analisa quando estiver ligado.' },
    analisando: { rotulo: 'Analisando', icone: 'relogio', texto: 'O PC está assistindo e lendo este post.' },
    precisa_gravacao: { rotulo: 'Precisa de gravação', icone: 'camera', texto: 'Não deu para baixar. Compartilhe o print ou a gravação de tela.' },
    erro: { rotulo: 'Falhou', icone: 'alerta', texto: 'Não deu certo. Mande o link de novo.' },
  };
  const DECISOES = {
    duvida: { acao: 'Dúvida', feito: 'Em dúvida', icone: 'duvida' },
    recusado: { acao: 'Recusar', feito: 'Recusado', icone: 'x' },
    aprovado: { acao: 'Aprovar', feito: 'Aprovado', icone: 'check' },
  };
  const ABAS = [
    { id: 'pendentes', rotulo: 'Pendentes', tem: (s) => ['pronto', 'na_fila', 'analisando', 'precisa_gravacao', 'erro'].includes(s) },
    { id: 'duvida', rotulo: 'Dúvidas', tem: (s) => s === 'duvida' },
    { id: 'aprovado', rotulo: 'Aprovados', tem: (s) => ['aprovado', 'instalando', 'instalado', 'erro_instalacao'].includes(s) },
    { id: 'recusado', rotulo: 'Recusados', tem: (s) => ['recusado', 'desfeito'].includes(s) },
  ];

  const dados = window.GarimpoDados.criar(window.GARIMPO_CONFIG);
  const estado = { itens: [], aba: 'pendentes', sequencia: [], atual: null, carregando: true, falha: null, dentro: false };

  // ───────── peças ─────────

  function h(tag, props, ...filhos) {
    const el = document.createElement(tag);
    for (const [chave, valor] of Object.entries(props || {})) {
      if (valor == null || valor === false) continue;
      if (chave === 'class') el.className = valor;
      else if (chave === 'text') el.textContent = valor;
      else if (chave.startsWith('on')) el.addEventListener(chave.slice(2), valor);
      else el.setAttribute(chave, valor === true ? '' : valor);
    }
    for (const filho of filhos.flat()) if (filho != null && filho !== false) el.append(filho);
    return el;
  }

  function icone(nome, classe) {
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('class', 'icone' + (classe ? ' ' + classe : ''));
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS(SVG, 'use');
    use.setAttribute('href', '#i-' + nome);
    svg.append(use);
    return svg;
  }

  const numero = (n) => Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
  const seguro = (url) => (typeof url === 'string' && /^https:\/\//i.test(url) ? url : null);
  const itemDe = (id) => estado.itens.find((i) => i.id === id);
  const abaAtual = () => ABAS.find((a) => a.id === estado.aba);
  const zoomAberto = () => !ref('zoom').hidden;

  // Trabalho real (feito com uma skill) já pronto: no lugar do veredito vai a skill e a versão.
  const trabalhoPronto = (item) => (item.trabalho && !ESTADOS[item.status] ? item.trabalho : null);
  const tituloDe = (item) => item.analise?.titulo || item.trabalho?.titulo || 'Post do ' + (ORIGENS[item.origem] || 'link');

  function pilula(item) {
    const ficha = item.analise;
    const trab = trabalhoPronto(item);
    if (trab) return h('span', { class: 'pilula pilula--estado' }, icone('skill', 'icone--p'), trab.skill + ' ' + trab.versao);
    if (!ficha) return h('span', { class: 'pilula pilula--estado', text: (ESTADOS[item.status] || ESTADOS.erro).rotulo });
    if (ficha.tentativa_de_manipulacao) return h('span', { class: 'pilula pilula--alerta' }, icone('alerta', 'icone--p'), 'Tentou enganar');
    return h('span', { class: 'pilula pilula--' + ficha.veredito, text: VEREDITOS[ficha.veredito] || ficha.veredito });
  }

  function rotuloDeTipo(item) {
    const ficha = item.analise;
    if (item.trabalho) return h('span', { class: 'tipo' }, icone('trabalho', 'icone--p'), 'Trabalho real');
    if (!ficha) return h('span', { class: 'tipo' }, icone('elo', 'icone--p'), ORIGENS[item.origem] || 'Link');
    return h('span', { class: 'tipo' }, icone(TIPOS[ficha.tipo] ? ficha.tipo : 'outro', 'icone--p'), TIPOS[ficha.tipo] || 'Outro');
  }

  function assinatura(item) {
    const origem = ORIGENS[item.origem] || 'Link';
    return item.autor ? '@' + item.autor + ' · ' + origem : origem;
  }

  // ───────── lista ─────────

  function montarSequencia() {
    const aba = abaAtual();
    // Trabalho real (mandado por uma skill para avaliar) vem antes dos posts prontos.
    const peso = (i) => (i.status === 'pronto' ? (i.trabalho ? -1 : 0) : 1);
    estado.sequencia = estado.itens
      .filter((i) => aba.tem(i.status))
      .sort((a, b) => peso(a) - peso(b)
        || (estado.aba === 'pendentes' ? (b.analise?.nota ?? -1) - (a.analise?.nota ?? -1) : 0)
        || String(b.decidido_em || b.criado_em || '').localeCompare(String(a.decidido_em || a.criado_em || '')))
      .map((i) => i.id);
  }

  function renderAbas() {
    ref('abas').replaceChildren(...ABAS.map((aba) => {
      const n = estado.itens.filter((i) => aba.tem(i.status)).length;
      return h('button', {
        class: 'aba', type: 'button', 'aria-pressed': String(aba.id === estado.aba),
        onclick: () => trocarAba(aba.id),
      }, aba.rotulo, n > 0 && h('span', { class: 'aba__n', text: String(n) }));
    }));
  }

  function renderResumo() {
    const caixa = ref('resumo');
    const prontos = estado.itens.filter((i) => i.status === 'pronto' && i.analise);
    if (estado.aba !== 'pendentes' || prontos.length < 2) { caixa.hidden = true; return; }
    const partes = ['vale', 'talvez', 'nao_vale']
      .map((v) => ({ v, n: prontos.filter((i) => i.analise.veredito === v).length }))
      .filter((p) => p.n > 0);
    // Barra de partes do todo desenhada em SVG: a largura vai no atributo, sem estilo embutido.
    const barra = document.createElementNS(SVG, 'svg');
    barra.setAttribute('class', 'resumo__barra');
    barra.setAttribute('viewBox', '0 0 100 8');
    barra.setAttribute('preserveAspectRatio', 'none');
    barra.setAttribute('role', 'img');
    barra.setAttribute('aria-label', partes.map((p) => p.n + ' ' + VEREDITOS[p.v].toLowerCase()).join(', '));
    const vao = 0.6;
    const util = 100 - vao * (partes.length - 1);
    let x = 0;
    for (const p of partes) {
      const largura = (p.n / prontos.length) * util;
      const parte = document.createElementNS(SVG, 'rect');
      parte.setAttribute('class', 'resumo__parte resumo__parte--' + p.v);
      parte.setAttribute('x', x.toFixed(2));
      parte.setAttribute('width', largura.toFixed(2));
      parte.setAttribute('height', '8');
      barra.append(parte);
      x += largura + vao;
    }
    const legenda = h('p', { class: 'resumo__legenda' }, partes.map((p) => h('span', { class: 'resumo__item' },
      h('span', { class: 'resumo__cor resumo__cor--' + p.v }), p.n + ' ' + VEREDITOS[p.v].toLowerCase())));
    caixa.replaceChildren(barra, legenda);
    caixa.hidden = false;
  }

  function card(item) {
    const ficha = item.analise;
    const trab = trabalhoPronto(item);
    const feito = DECISOES[item.status];
    const capa = item.midias?.capa
      ? h('img', { class: 'card__capa', src: item.midias.capa, alt: '', loading: 'lazy' })
      : h('span', { class: 'card__capa' }, icone(trab ? 'trabalho' : (ESTADOS[item.status] || ESTADOS.erro).icone, 'icone--g'));
    return h('button', {
      class: ficha || trab ? 'card' : 'card card--sem-ficha', type: 'button', 'data-id': item.id,
      'aria-current': item.id === estado.atual && largo.matches ? 'true' : null,
      onclick: () => abrir(item.id),
    }, capa, h('span', { class: 'card__corpo' },
      h('span', { class: 'card__topo' }, pilula(item)),
      h('strong', { class: 'card__titulo', text: tituloDe(item) }),
      h('span', { class: 'card__porque', text: ficha ? ficha.porque : trab ? (trab.pedido || trab.texto || '') : item.trabalho && item.status === 'erro' ? 'Não subiu. Mande o trabalho de novo pelo comando.' : (ESTADOS[item.status] || ESTADOS.erro).texto }),
      h('span', { class: 'card__pe' },
        ficha && h('span', { class: 'nota' }, icone('gema', 'icone--p'), numero(ficha.nota)),
        trab && item.nota_dono && h('span', { class: 'nota' }, icone('gema', 'icone--p'), item.nota_dono + ' de 5'),
        feito
          ? h('span', { class: 'card__fim' + (item.status === 'aprovado' ? ' card__fim--aprovado' : '') }, icone(feito.icone, 'icone--p'), feito.feito)
          : h('span', { class: 'card__fim' }, icone('dir', 'icone--p')))));
  }

  function esqueleto() {
    return h('div', { class: 'card card--esqueleto', 'aria-hidden': 'true' },
      h('span', { class: 'card__capa' }),
      h('span', { class: 'card__corpo' }, h('span', { class: 'osso osso--curto' }), h('span', { class: 'osso' }), h('span', { class: 'osso osso--medio' })));
  }

  function vazio() {
    if (estado.falha) {
      return h('div', { class: 'vazio' }, h('span', { class: 'vazio__selo' }, icone('alerta', 'icone--g')),
        h('p', { class: 'vazio__titulo', text: 'Não deu para carregar' }),
        h('p', { class: 'vazio__texto', text: estado.falha }),
        h('button', { class: 'botao', type: 'button', onclick: carregar }, 'Tentar de novo'));
    }
    if (estado.aba === 'pendentes') {
      return h('div', { class: 'vazio' }, h('span', { class: 'vazio__selo' }, icone('gema', 'icone--g')),
        h('p', { class: 'vazio__titulo', text: 'Nada para decidir agora' }),
        h('p', { class: 'vazio__texto', text: 'No Instagram ou no TikTok, toque em Compartilhar e escolha Garimpo.' }),
        h('button', { class: 'botao botao--primario', type: 'button', onclick: abrirColar }, icone('mais'), 'Colar um link'));
    }
    return h('div', { class: 'vazio' }, h('span', { class: 'vazio__selo' }, icone('check', 'icone--g')),
      h('p', { class: 'vazio__titulo', text: 'Nenhum post aqui ainda' }),
      h('p', { class: 'vazio__texto', text: 'O que você decidir no zoom aparece nesta aba.' }),
      h('button', { class: 'botao', type: 'button', onclick: () => trocarAba('pendentes') }, 'Ver pendentes'));
  }

  function renderLista() {
    const lista = ref('lista');
    // Número par de esqueletos: nenhum fica deitado, e a grade não muda de forma quando os posts chegam.
    if (estado.carregando) { lista.replaceChildren(esqueleto(), esqueleto(), esqueleto(), esqueleto()); return; }
    if (estado.falha || estado.sequencia.length === 0) { lista.replaceChildren(vazio()); return; }
    lista.replaceChildren(...estado.sequencia.map((id) => card(itemDe(id))));
  }

  function trocarCard(item) {
    const antigo = ref('lista').querySelector('[data-id="' + CSS.escape(item.id) + '"]');
    if (antigo) antigo.replaceWith(card(item));
  }

  function renderTudo() {
    renderAbas();
    pintarBotaoAvaliar();
    renderResumo();
    if (largo.matches && !estado.sequencia.includes(estado.atual)) estado.atual = estado.sequencia[0] || null;
    renderLista();
    sincronizarZoom();
  }

  function trocarAba(id) {
    estado.aba = id;
    estado.atual = null;
    montarSequencia();
    renderTudo();
  }

  // ───────── zoom ─────────

  function midia(item) {
    let slides = item.midias?.slides || [];
    if (slides.length === 0 && item.midias?.capa) slides = [{ tipo: 'imagem', url: item.midias.capa }];
    if (slides.length === 0) return null;

    const trilho = h('div', { class: 'midia__trilho' }, slides.map((s, i) => h('div', { class: 'midia__slide' },
      s.tipo === 'video'
        ? h('video', { class: 'midia__peca', src: s.url, poster: s.capa, controls: true, playsinline: true, preload: 'metadata' })
        : h('img', { class: 'midia__peca', src: s.url, alt: 'Imagem ' + (i + 1) + ' do post', loading: i > 0 ? 'lazy' : null }))));
    const caixa = h('div', { class: 'midia' }, trilho);
    if (slides.length < 2) return caixa;

    const conta = h('span', { class: 'midia__conta' });
    const anterior = h('button', { class: 'seta midia__seta midia__seta--anterior', type: 'button', 'aria-label': 'Imagem anterior' }, icone('esq'));
    const proxima = h('button', { class: 'seta midia__seta midia__seta--proxima', type: 'button', 'aria-label': 'Próxima imagem' }, icone('dir'));
    const passo = (delta) => trilho.scrollBy({ left: delta * trilho.clientWidth, behavior: 'smooth' });
    const pintar = () => {
      const i = trilho.clientWidth ? Math.round(trilho.scrollLeft / trilho.clientWidth) : 0;
      conta.textContent = (i + 1) + ' de ' + slides.length;
      anterior.classList.toggle('seta--oculta', i <= 0);
      proxima.classList.toggle('seta--oculta', i >= slides.length - 1);
      trilho.querySelectorAll('video').forEach((v) => { if (!v.paused && trilho.children[i] !== v.parentElement) v.pause(); });
    };
    anterior.addEventListener('click', () => passo(-1));
    proxima.addEventListener('click', () => passo(1));
    trilho.addEventListener('scroll', pintar, { passive: true });
    anterior.classList.add('seta--oculta');
    conta.textContent = '1 de ' + slides.length;
    caixa.append(anterior, proxima, conta);
    return caixa;
  }

  function listaDe(itens, nomeIcone, classe) {
    return h('ul', { class: 'itens ' + classe }, itens.map((t) => h('li', { class: 'itens__item' }, icone(nomeIcone, 'icone--p'), h('span', { text: t }))));
  }

  function linha(nomeIcone, rotulo, ...conteudo) {
    return h('div', { class: 'linha' }, icone(nomeIcone), h('div', null, h('span', { class: 'linha__rotulo', text: rotulo }), conteudo));
  }

  function elo(url, texto) {
    return h('a', { class: 'linha__elo', href: url, target: '_blank', rel: 'noopener noreferrer', text: texto });
  }

  // O que aconteceu depois que o dono decidiu: a resposta à dúvida dele e onde o aprovado foi guardado.
  function depoisDaDecisao(item) {
    if (item.trabalho) {
      return DECISOES[item.status] ? h('div', { class: 'linhas', 'data-depois': true, role: 'status' },
        linha('check', 'Avaliação guardada', 'Conta como prova da ' + item.trabalho.skill + ' ' + item.trabalho.versao + '.')) : null;
    }
    const linhas = [];
    if (item.status === 'duvida' && item.comentario) {
      // A resposta chega em até 3 frases curtas, uma por linha: vira lista, não parágrafo.
      const frases = String(item.resposta || '').split('\n').map((t) => t.trim()).filter(Boolean).slice(0, 3);
      linhas.push(frases.length > 0
        ? linha('duvida', 'Resposta à sua dúvida', listaDe(frases, 'dir', 'itens--motivos'))
        : linha('relogio', 'Dúvida enviada', 'O PC responde quando estiver ligado.'));
    }
    if (item.status === 'aprovado') {
      const guardado = item.instalacao?.estado;
      if (!item.arquivado_em) linhas.push(linha('relogio', 'Aprovado', 'O PC guarda quando estiver ligado.'));
      else if (guardado === 'aguardando_instalacao') linhas.push(linha('check', 'Guardado no cofre', 'A skill ainda não foi instalada.'));
      else if (guardado === 'nota') linhas.push(linha('check', 'Guardado no cofre', 'Está na nota de achados aprovados.'));
      else linhas.push(linha('check', 'Aprovado', 'Fica guardado aqui no app.'));
    }
    return linhas.length > 0 ? h('div', { class: 'linhas', 'data-depois': true, role: 'status' }, linhas) : null;
  }

  // Troca só esse bloco quando a decisão muda, sem mexer no vídeo nem na rolagem.
  function pintarDepois(item) {
    const antigo = ref('corpo').querySelector('[data-depois]');
    const novo = depoisDaDecisao(item);
    if (antigo && novo) antigo.replaceWith(novo);
    else if (antigo) antigo.remove();
    else if (novo) ref('corpo').querySelector('.ficha__porque')?.after(novo);
  }

  function ficha(item) {
    const f = item.analise;
    const fonte = seguro(f.fonte?.url);
    const original = seguro(item.url);
    const c = f.comparacao || {};
    return h('article', { class: 'ficha' },
      h('div', { class: 'ficha__topo' }, rotuloDeTipo(item), pilula(item)),
      h('h2', { class: 'ficha__titulo', text: f.titulo }),
      f.tentativa_de_manipulacao && h('div', { class: 'linha linha--alerta' }, icone('alerta'),
        h('div', null, h('span', { class: 'linha__rotulo', text: 'Este post tentou dar ordens à IA' }), 'Nada foi obedecido. Trate como golpe.')),
      // O porquê vem logo abaixo do título: é o que decide, e precisa aparecer sem rolar.
      h('p', { class: 'ficha__porque', text: f.porque }),
      depoisDaDecisao(item),
      h('div', { class: 'placar' },
        h('div', { class: 'placar__nota' }, h('span', { class: 'placar__numero' }, icone('gema'), numero(f.nota)), 'de 10'),
        h('div', { class: 'barras' }, NOTAS.map(([chave, rotulo]) => h('div', { class: 'barra' },
          h('span', { text: rotulo }),
          h('progress', { class: 'barra__trilho', max: '10', value: String(f.notas?.[chave] ?? 0), 'aria-label': rotulo }),
          h('span', { class: 'barra__valor', text: numero(f.notas?.[chave] ?? 0) }))))),
      (f.faz?.length || f.nao_faz?.length) ? h('div', { class: 'duo' },
        f.faz?.length ? h('section', { class: 'bloco' }, h('span', { class: 'bloco__rotulo' }, icone('check', 'icone--p'), 'Faz'), listaDe(f.faz, 'check', 'itens--sim')) : null,
        f.nao_faz?.length ? h('section', { class: 'bloco' }, h('span', { class: 'bloco__rotulo' }, icone('x', 'icone--p'), 'Não faz'), listaDe(f.nao_faz, 'x', 'itens--nao')) : null) : null,
      (c.antes && c.depois) ? h('div', { class: 'troca' },
        h('section', { class: 'bloco' }, h('span', { class: 'bloco__rotulo', text: 'Hoje' }), h('p', { class: 'bloco__texto', text: c.antes })),
        h('span', { class: 'troca__seta' }, icone('seta')),
        h('section', { class: 'bloco' }, h('span', { class: 'bloco__rotulo', text: 'Com isso' }), h('p', { class: 'bloco__texto', text: c.depois }))) : null,
      h('div', { class: 'linhas' },
        c.ja_tenho && linha('skill', 'O que você já tem', c.ja_tenho),
        linha('elo', fonte ? (f.fonte.conferida ? 'Fonte conferida' : 'Fonte não conferida') : 'Fonte não aparece no post',
          fonte && elo(fonte, fonte.replace(/^https:\/\//i, '')), fonte && f.fonte.observacao ? ' · ' : '', f.fonte?.observacao),
        linha('escudo', RISCOS[f.risco?.nivel] ? 'Risco ' + RISCOS[f.risco.nivel] : 'Risco não informado',
          (f.risco?.motivos || []).length > 0 && listaDe(f.risco.motivos.slice(0, 3), 'dir', 'itens--motivos')),
        f.proximo_passo && linha('baixar', 'Se aprovar', f.proximo_passo),
        original && linha('fora', assinatura(item), elo(original, 'Abrir o post original'))),
      item.transcricao && h('details', { class: 'fala' },
        h('summary', { class: 'fala__abre' }, icone('fala'), 'O que foi falado', icone('dir', 'icone--p fala__gira')),
        h('p', { class: 'fala__texto', text: item.transcricao })));
  }

  function fichaDoTrabalho(item) {
    const t = item.trabalho;
    return h('article', { class: 'ficha' },
      h('div', { class: 'ficha__topo' }, rotuloDeTipo(item), pilula(item)),
      h('h2', { class: 'ficha__titulo', text: t.titulo }),
      h('p', { class: 'ficha__porque', text: t.pedido || 'Trabalho feito com ' + t.skill + '.' }),
      depoisDaDecisao(item),
      t.texto && h('section', { class: 'bloco' }, h('span', { class: 'bloco__rotulo', text: 'Resposta' }), h('p', { class: 'bloco__texto', text: t.texto })),
      h('div', { class: 'linhas' },
        linha('skill', 'Feito com', t.skill + ' ' + t.versao),
        item.nota_dono && linha('gema', 'Sua nota', item.nota_dono + ' de 5'),
        t.de && linha('fala', 'Mandado por', t.de)));
  }

  function semFicha(item) {
    const e = ESTADOS[item.status] || ESTADOS.erro;
    const original = seguro(item.url);
    return h('article', { class: 'ficha' }, h('div', { class: 'estado' },
      h('span', { class: 'pilula pilula--estado' }, icone(e.icone, 'icone--p'), e.rotulo),
      h('p', { class: 'estado__texto', text: item.status === 'erro' && item.erro ? item.erro : e.texto }),
      original && elo(original, 'Abrir o post original')));
  }

  function pintarDecisao(item) {
    for (const botao of ref('decisao').querySelectorAll('[data-decisao]')) {
      const d = botao.dataset.decisao;
      const escolhido = item.status === d;
      botao.classList.toggle('botao--escolhido', escolhido);
      botao.setAttribute('aria-pressed', String(escolhido));
      botao.querySelector('span').textContent = escolhido ? DECISOES[d].feito : DECISOES[d].acao;
    }
  }

  function ajustarCampo() {
    const campo = ref('comentario');
    campo.style.setProperty('height', 'auto');
    campo.style.setProperty('height', Math.min(campo.scrollHeight + 2, 120) + 'px');
  }

  function desenharZoom() {
    const item = itemDe(estado.atual);
    if (!item) return;
    const i = estado.sequencia.indexOf(item.id);
    ref('posicao').textContent = (i + 1) + ' de ' + estado.sequencia.length;
    ref('anterior').classList.toggle('seta--oculta', i <= 0);
    ref('proximo').classList.toggle('seta--oculta', i >= estado.sequencia.length - 1);

    const pecas = midia(item);
    const corpo = ref('corpo');
    corpo.classList.toggle('zoom__corpo--so-texto', !pecas);
    corpo.replaceChildren(...[pecas, item.analise ? ficha(item) : trabalhoPronto(item) ? fichaDoTrabalho(item) : semFicha(item)].filter(Boolean));
    corpo.scrollTop = 0;

    const decidivel = Boolean(item.analise || item.trabalho) && ['pronto', 'aprovado', 'recusado', 'duvida'].includes(item.status);
    ref('decisao').hidden = !decidivel;
    ref('erro-decisao').hidden = true;
    ref('comentario').value = item.comentario || '';
    pintarDecisao(item);
    if (decidivel) ajustarCampo();

    for (const c of ref('lista').querySelectorAll('.card')) {
      if (c.dataset.id === item.id && largo.matches) c.setAttribute('aria-current', 'true');
      else c.removeAttribute('aria-current');
    }
  }

  // No computador o painel da direita nunca fica em branco: sem post escolhido, ele diz o que fazer.
  function zoomSemPost() {
    ref('posicao').textContent = '';
    ref('anterior').classList.add('seta--oculta');
    ref('proximo').classList.add('seta--oculta');
    ref('decisao').hidden = true;
    const corpo = ref('corpo');
    corpo.classList.add('zoom__corpo--so-texto');
    if (estado.carregando) { corpo.replaceChildren(); return; }
    corpo.replaceChildren(h('div', { class: 'vazio' }, h('span', { class: 'vazio__selo' }, icone('gema', 'icone--g')),
      h('p', { class: 'vazio__titulo', text: 'Nenhum post escolhido' }),
      h('p', { class: 'vazio__texto', text: 'Clique num card da lista para ver o vídeo e a ficha.' })));
  }

  function sincronizarZoom() {
    const zoom = ref('zoom');
    const temPost = Boolean(estado.atual && itemDe(estado.atual));
    const mostrar = estado.dentro && (largo.matches || (temPost && location.hash === '#post'));
    zoom.hidden = !mostrar;
    // No celular o zoom cobre a tela: o que ficou atrás sai do alcance do teclado e do leitor de tela.
    for (const atras of document.querySelectorAll('.topo, .abas, .resumo, .lista')) atras.inert = mostrar && !largo.matches;
    if (!mostrar) ref('corpo').replaceChildren();
    else if (temPost) desenharZoom();
    else zoomSemPost();
  }

  function abrir(id) {
    estado.atual = id;
    if (largo.matches) { sincronizarZoom(); return; }
    if (location.hash !== '#post') { location.hash = 'post'; return; }
    sincronizarZoom();
    ref('voltar').focus({ preventScroll: true });
  }

  function fechar() {
    if (location.hash === '#post') history.back();
    else aoFechar();
  }

  function aoFechar() {
    const id = estado.atual;
    sincronizarZoom();
    if (largo.matches) return;
    montarSequencia();
    renderAbas();
    renderResumo();
    renderLista();
    const volta = id && ref('lista').querySelector('[data-id="' + CSS.escape(id) + '"]');
    if (volta) volta.focus();
  }

  function mover(delta) {
    const i = estado.sequencia.indexOf(estado.atual) + delta;
    if (i < 0 || i >= estado.sequencia.length) return;
    estado.atual = estado.sequencia[i];
    desenharZoom();
  }

  async function decidir(decisao, botao) {
    const item = itemDe(estado.atual);
    if (!item) return;
    const comentario = ref('comentario').value.trim();
    const botoes = [...ref('decisao').querySelectorAll('[data-decisao]')];
    const aviso = ref('erro-decisao');
    aviso.hidden = true;
    botoes.forEach((b) => { b.disabled = true; });
    botao.querySelector('span').textContent = 'Salvando...';
    try {
      await dados.decidir(item.id, decisao, comentario);
      // Pergunta nova: a resposta antiga deixa de valer (o banco faz o mesmo).
      if (decisao === 'duvida' && (comentario || null) !== (item.comentario || null)) item.resposta = null;
      Object.assign(item, { status: decisao, comentario: comentario || null, decidido_em: new Date().toISOString() });
    } catch (erro) {
      aviso.textContent = 'Não salvou. Confira a internet e toque de novo.';
      aviso.hidden = false;
    }
    botoes.forEach((b) => { b.disabled = false; });
    pintarDecisao(item);
    renderAbas();
    pintarBotaoAvaliar();
    trocarCard(item);
    pintarDepois(item);
  }

  async function salvarComentario() {
    const item = itemDe(estado.atual);
    if (!item || !DECISOES[item.status]) return;
    const comentario = ref('comentario').value.trim();
    if (comentario === (item.comentario || '')) return;
    try {
      await dados.decidir(item.id, item.status, comentario);
      if (item.status === 'duvida') item.resposta = null;
      item.comentario = comentario || null;
      pintarDepois(item);
    } catch (erro) {
      ref('erro-decisao').textContent = 'O comentário não salvou. Toque na decisão de novo.';
      ref('erro-decisao').hidden = false;
    }
  }

  // ───────── avaliar arrastando (opção C, escolhida pelo Guifa em 16/11/2026) ─────────
  // Um card por vez: direita aprova, esquerda descarta, com a lateral tingindo de verde ou vermelho.
  // Só decide depois de arrastar 35% da largura; abaixo disso o card volta. Os botões fazem o mesmo (#80).

  const LIMITE = 0.35;
  const SELOS = { sim: 'Aprovar', nao: 'Descartar', duvida: 'Dúvida' };
  const PARA_DECISAO = { sim: 'aprovado', nao: 'recusado', duvida: 'duvida' };
  const RECONHECER = window.SpeechRecognition || window.webkitSpeechRecognition;
  const avaliar = { fila: [], i: 0, historico: [], ocupado: false, aberto: false };
  const prontoParaAvaliar = (item) => item.status === 'pronto' && Boolean(item.analise || item.trabalho);
  let ouvindo = null;

  function pintarBotaoAvaliar() {
    const n = estado.itens.filter(prontoParaAvaliar).length;
    ref('abrir-avaliar').hidden = estado.carregando || estado.aba !== 'pendentes' || n === 0;
    ref('avaliar-texto').textContent = 'Avaliar arrastando · ' + n;
  }

  function tingir(p) {
    const caixa = ref('avaliar');
    caixa.style.setProperty('--sim', Math.max(0, Math.min(1, p)).toFixed(3));
    caixa.style.setProperty('--nao', Math.max(0, Math.min(1, -p)).toFixed(3));
  }

  function posicionar(el, dx, dy, girar) {
    el.style.setProperty('transform', 'translate(' + dx + 'px,' + dy + 'px) rotate(' + (girar ? dx / 22 : 0) + 'deg)');
  }

  function marcarSelo(el, p, lado) {
    const qual = lado || (p > 0 ? 'sim' : p < 0 ? 'nao' : '');
    el.dataset.lado = qual;
    el.style.setProperty('--forca', Math.min(1, Math.abs(p)).toFixed(3));
    el.querySelector('.av-selo__texto').textContent = SELOS[qual] || '';
  }

  function tocar(caixa, video, botao) {
    const img = caixa.querySelector('.av-card__img');
    const tela = h('video', { class: 'av-card__img', src: video.url, poster: video.capa, controls: true, autoplay: true, playsinline: true });
    if (img) img.replaceWith(tela); else caixa.prepend(tela);
    botao.remove();
  }

  async function marcarNota(item, nota, grupo) {
    const antes = item.nota_dono || null;
    const pintar = (n) => grupo.querySelectorAll('.av-gema').forEach((g, k) => {
      g.classList.toggle('av-gema--cheia', k < (n || 0));
      g.setAttribute('aria-checked', String(k + 1 === n));
    });
    item.nota_dono = nota;
    pintar(nota);
    try {
      await dados.darNota(item.id, nota);
    } catch (erro) {
      item.nota_dono = antes;
      pintar(antes);
      mostrarErroAvaliar('A nota não salvou. Toque de novo.');
    }
  }

  function ditar(campo, botao) {
    if (ouvindo) { ouvindo.stop(); return; }
    const r = new RECONHECER();
    r.lang = 'pt-BR';
    r.continuous = true;
    r.interimResults = true;
    const antes = campo.value ? campo.value.replace(/\s*$/, ' ') : '';
    let final = '';
    r.onresult = (e) => {
      let parcial = '';
      for (let k = e.resultIndex; k < e.results.length; k++) {
        if (e.results[k].isFinal) final += e.results[k][0].transcript;
        else parcial += e.results[k][0].transcript;
      }
      campo.value = antes + final + parcial;
    };
    r.onerror = () => mostrarErroAvaliar('O microfone não ouviu. Toque nele de novo ou escreva.');
    r.onend = () => { ouvindo = null; botao.classList.remove('av-fala__mic--ouvindo'); botao.setAttribute('aria-label', 'Falar o comentário'); };
    try { r.start(); } catch (erro) { return; }
    ouvindo = r;
    botao.classList.add('av-fala__mic--ouvindo');
    botao.setAttribute('aria-label', 'Parar de ouvir');
  }

  function extraAvaliar(item) {
    const gemas = h('div', { class: 'av-nota__gemas', role: 'radiogroup', 'aria-label': 'Sua nota' });
    gemas.append(...[1, 2, 3, 4, 5].map((n) => h('button', {
      class: 'av-gema' + (n <= (item.nota_dono || 0) ? ' av-gema--cheia' : ''), type: 'button', role: 'radio',
      'aria-checked': String(n === item.nota_dono), 'aria-label': 'Nota ' + n + ' de 5',
      onclick: () => marcarNota(item, n === item.nota_dono ? null : n, gemas),
    }, icone('gema'))));
    const campo = h('textarea', { class: 'campo__texto av-fala__texto', id: 'avaliar-comentario', rows: '1', maxlength: '500', placeholder: 'Comentário (opcional)', 'aria-label': 'Comentário' });
    campo.value = item.comentario || '';
    const fala = h('div', { class: 'av-fala' }, campo);
    if (RECONHECER) fala.append(h('button', { class: 'botao-icone av-fala__mic', type: 'button', 'aria-label': 'Falar o comentário', onclick: (e) => ditar(campo, e.currentTarget) }, icone('microfone')));
    else campo.placeholder = 'Comentário (opcional). Windows + H para falar';
    return h('div', { class: 'av-extra' }, h('div', { class: 'av-nota' }, h('span', { class: 'av-nota__rotulo', text: 'Sua nota' }), gemas), fala);
  }

  function cartaoAvaliar(item, frente) {
    const ficha = item.analise;
    const t = item.trabalho;
    const video = (item.midias?.slides || []).find((s) => s.tipo === 'video');
    const capa = item.midias?.capa;
    const midia = h('div', { class: 'av-card__midia' },
      capa ? h('img', { class: 'av-card__img' + (t ? ' av-card__img--topo' : ''), src: capa, alt: '', draggable: 'false' })
        : t?.texto ? h('p', { class: 'av-card__texto', text: t.texto }) : null);
    const selo = h('span', { class: 'pilula av-selo', 'aria-hidden': 'true' }, icone('check', 'av-selo__sim'), icone('x', 'av-selo__nao'), h('span', { class: 'av-selo__texto' }));
    const info = h('div', { class: 'av-card__info' },
      h('div', { class: 'av-card__topo' }, rotuloDeTipo(item), pilula(item)),
      h('h2', { class: 'av-card__titulo', text: tituloDe(item) }),
      (ficha || t?.pedido) && h('p', { class: 'av-card__porque', text: ficha ? ficha.porque : t.pedido }),
      h('div', { class: 'av-card__pe' },
        ficha && h('span', { class: 'nota' }, icone('gema', 'icone--p'), numero(ficha.nota)),
        (ficha || t?.de) && h('span', { text: ficha ? assinatura(item) : t.de }),
        // Na linha do autor, e não sobre a imagem: nada cobre o post (#296) nem o meio do card, onde o dedo arrasta.
        frente && video && h('button', { class: 'av-card__play', type: 'button', onclick: (e) => tocar(midia, video, e.currentTarget) }, icone('dir', 'icone--p'), 'Ver vídeo')));
    const el = h('article', { class: 'av-card' + (frente ? ' av-card--frente' : ' av-card--atras'), 'aria-label': tituloDe(item) }, midia, selo, info);
    if (frente) el.append(extraAvaliar(item));
    return el;
  }

  function vazioAvaliar() {
    const feitos = avaliar.historico.length;
    return h('div', { class: 'vazio av-vazio' }, h('span', { class: 'vazio__selo' }, icone('check', 'icone--g')),
      h('p', { class: 'vazio__titulo', text: 'Tudo avaliado' }),
      h('p', { class: 'vazio__texto', text: feitos === 1 ? '1 card avaliado agora.' : feitos + ' cards avaliados agora.' }),
      h('button', { class: 'botao', type: 'button', onclick: fecharAvaliar }, 'Ver a lista'));
  }

  function pintarAcoesAvaliar() {
    const tem = Boolean(avaliar.fila[avaliar.i]);
    for (const b of ref('avaliar').querySelectorAll('[data-avaliar]')) {
      b.disabled = b.dataset.avaliar === 'voltar' ? avaliar.historico.length === 0 : !tem;
    }
  }

  function mostrarErroAvaliar(texto) {
    ref('avaliar-erro').textContent = texto;
    ref('avaliar-erro').hidden = false;
  }

  function desenharAvaliar() {
    const palco = ref('avaliar-palco');
    const item = itemDe(avaliar.fila[avaliar.i]);
    ref('avaliar-conta').textContent = item ? (avaliar.i + 1) + ' de ' + avaliar.fila.length : '';
    tingir(0);
    if (!item) { palco.replaceChildren(vazioAvaliar()); pintarAcoesAvaliar(); return; }
    const proximo = itemDe(avaliar.fila[avaliar.i + 1]);
    const frente = cartaoAvaliar(item, true);
    palco.replaceChildren(...[proximo && cartaoAvaliar(proximo, false), frente].filter(Boolean));
    prenderArrasto(frente);
    pintarAcoesAvaliar();
  }

  // A largura vem do layout (offsetWidth): a do retângulo cresce com o card inclinado e pediria um arrasto maior.
  function prenderArrasto(el) {
    let x0 = null;
    let y0 = 0;
    let passou = false;
    el.addEventListener('pointerdown', (e) => {
      if (avaliar.ocupado || e.button > 0 || e.target.closest('button, textarea, input, video, a')) return;
      x0 = e.clientX;
      y0 = e.clientY;
      passou = false;
      el.setPointerCapture(e.pointerId);
      el.classList.add('av-card--arrastando');
    });
    el.addEventListener('pointermove', (e) => {
      if (x0 === null) return;
      const dx = e.clientX - x0;
      const p = dx / (LIMITE * el.offsetWidth);
      posicionar(el, dx, (e.clientY - y0) * 0.15, true);
      tingir(p);
      marcarSelo(el, p);
      // Toque curto no celular quando passa do limite: daqui para frente, soltar decide.
      if ((Math.abs(p) >= 1) !== passou) { passou = Math.abs(p) >= 1; if (passou && navigator.vibrate) navigator.vibrate(12); }
    });
    const soltar = (e) => {
      if (x0 === null) return;
      const p = (e.clientX - x0) / (LIMITE * el.offsetWidth);
      x0 = null;
      el.classList.remove('av-card--arrastando');
      if (Math.abs(p) >= 1) decidirAvaliar(p > 0 ? 'sim' : 'nao');
      else { posicionar(el, 0, 0, false); tingir(0); marcarSelo(el, 0); }
    };
    el.addEventListener('pointerup', soltar);
    el.addEventListener('pointercancel', soltar);
  }

  async function decidirAvaliar(lado) {
    const el = ref('avaliar-palco').querySelector('.av-card--frente');
    const item = itemDe(avaliar.fila[avaliar.i]);
    if (!el || !item || avaliar.ocupado) return;
    avaliar.ocupado = true;
    ref('avaliar-erro').hidden = true;
    if (ouvindo) ouvindo.stop();
    const comentario = (document.getElementById('avaliar-comentario')?.value || '').trim();
    const decisao = PARA_DECISAO[lado];
    marcarSelo(el, 1, lado);
    tingir(lado === 'sim' ? 1 : lado === 'nao' ? -1 : 0);
    el.classList.add('av-card--saindo');
    if (lado === 'duvida') posicionar(el, 0, -window.innerHeight, false);
    else posicionar(el, (lado === 'sim' ? 1 : -1) * window.innerWidth * 1.2, 40, true);
    const salvo = dados.decidir(item.id, decisao, comentario).then(() => true, () => false);
    await new Promise((r) => setTimeout(r, 260));
    const deuCerto = await salvo;
    if (deuCerto) {
      if (decisao === 'duvida' && (comentario || null) !== (item.comentario || null)) item.resposta = null;
      Object.assign(item, { status: decisao, comentario: comentario || null, decidido_em: new Date().toISOString() });
      avaliar.historico.push(item.id);
      avaliar.i += 1;
      ref('avaliar-status').textContent = SELOS[lado] + ': ' + tituloDe(item);
    }
    avaliar.ocupado = false;
    desenharAvaliar();
    if (!deuCerto) mostrarErroAvaliar('Não salvou. Confira a internet e tente de novo.');
  }

  async function voltarAvaliar() {
    const item = itemDe(avaliar.historico[avaliar.historico.length - 1]);
    if (!item || avaliar.ocupado) return;
    avaliar.ocupado = true;
    ref('avaliar-erro').hidden = true;
    try {
      await dados.voltar(item.id);
    } catch (erro) {
      avaliar.ocupado = false;
      mostrarErroAvaliar(erro.message);
      return;
    }
    avaliar.historico.pop();
    const de = item.status === 'aprovado' ? 1 : item.status === 'recusado' ? -1 : 0;
    Object.assign(item, { status: 'pronto', decidido_em: null });
    avaliar.i = Math.max(0, avaliar.fila.indexOf(item.id));
    avaliar.ocupado = false;
    desenharAvaliar();
    // Volta pelo mesmo lado por onde saiu.
    const el = ref('avaliar-palco').querySelector('.av-card--frente');
    el.classList.add('av-card--sem-transicao');
    posicionar(el, de * window.innerWidth, de ? 40 : -window.innerHeight, true);
    el.getBoundingClientRect();
    el.classList.remove('av-card--sem-transicao');
    posicionar(el, 0, 0, false);
    ref('avaliar-status').textContent = 'Voltou: ' + tituloDe(item);
  }

  function abrirAvaliar() {
    avaliar.fila = estado.sequencia.map(itemDe).filter((i) => i && prontoParaAvaliar(i)).map((i) => i.id);
    if (avaliar.fila.length === 0) return;
    avaliar.i = 0;
    avaliar.historico = [];
    avaliar.aberto = true;
    ref('avaliar-erro').hidden = true;
    ref('avaliar').hidden = false;
    document.querySelector('.app').inert = true;
    if (location.hash !== '#avaliar') location.hash = 'avaliar';
    desenharAvaliar();
    ref('avaliar-fechar').focus({ preventScroll: true });
  }

  function fecharAvaliar() {
    if (location.hash === '#avaliar') history.back();
    else aoFecharAvaliar();
  }

  function aoFecharAvaliar() {
    if (!avaliar.aberto) return;
    if (ouvindo) ouvindo.stop();
    avaliar.aberto = false;
    ref('avaliar').hidden = true;
    ref('avaliar-palco').replaceChildren();
    document.querySelector('.app').inert = false;
    montarSequencia();
    renderTudo();
    if (!ref('abrir-avaliar').hidden) ref('abrir-avaliar').focus({ preventScroll: true });
  }

  ref('abrir-avaliar').addEventListener('click', abrirAvaliar);
  ref('avaliar-fechar').addEventListener('click', fecharAvaliar);
  for (const b of ref('avaliar').querySelectorAll('[data-avaliar]')) {
    b.addEventListener('click', () => (b.dataset.avaliar === 'voltar' ? voltarAvaliar() : decidirAvaliar(b.dataset.avaliar)));
  }
  window.addEventListener('hashchange', () => { if (avaliar.aberto && location.hash !== '#avaliar') aoFecharAvaliar(); });
  document.addEventListener('keydown', (e) => {
    if (!avaliar.aberto || e.target.closest('textarea, input, .av-nota__gemas, video')) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); voltarAvaliar(); }
    else if (e.key === 'ArrowRight') decidirAvaliar('sim');
    else if (e.key === 'ArrowLeft') decidirAvaliar('nao');
    else if (e.key === 'Escape') fecharAvaliar();
  });

  // ───────── colar link ─────────

  function abrirColar() {
    ref('erro-colar').hidden = true;
    ref('link').value = '';
    ref('folha').showModal();
    ref('link').focus();
  }

  async function enviarLink(evento) {
    evento.preventDefault();
    const aviso = ref('erro-colar');
    try {
      const r = await dados.capturar(ref('link').value);
      if (r.repetido) { aviso.textContent = 'Esse post já está no Garimpo.'; aviso.hidden = false; return; }
      ref('folha').close();
      estado.aba = 'pendentes';
      await carregar();
    } catch (erro) {
      aviso.textContent = erro.message || 'Não deu para enviar. Tente de novo.';
      aviso.hidden = false;
    }
  }

  // ───────── partida ─────────

  async function carregar() {
    estado.carregando = true;
    estado.falha = null;
    renderLista();
    try {
      estado.itens = await dados.listar();
    } catch (erro) {
      estado.falha = 'Confira a internet e tente de novo.';
    }
    estado.carregando = false;
    montarSequencia();
    if (!largo.matches && location.hash === '#post' && !estado.atual) estado.atual = estado.sequencia[0] || null;
    renderTudo();
  }

  ref('voltar').addEventListener('click', fechar);
  ref('anterior').addEventListener('click', () => mover(-1));
  ref('proximo').addEventListener('click', () => mover(1));
  ref('abrir-colar').addEventListener('click', abrirColar);
  ref('fechar-colar').addEventListener('click', () => ref('folha').close());
  ref('forma-colar').addEventListener('submit', enviarLink);
  ref('comentario').addEventListener('input', ajustarCampo);
  ref('comentario').addEventListener('change', salvarComentario);
  ref('decisao').addEventListener('submit', (e) => e.preventDefault());
  for (const botao of ref('decisao').querySelectorAll('[data-decisao]')) {
    botao.addEventListener('click', () => decidir(botao.dataset.decisao, botao));
  }

  window.addEventListener('hashchange', () => {
    if (largo.matches) return;
    if (location.hash === '#post' && estado.atual) {
      sincronizarZoom();
      ref('voltar').focus({ preventScroll: true });
    } else aoFechar();
  });
  largo.addEventListener('change', renderTudo);
  document.addEventListener('keydown', (e) => {
    // Em campo, vídeo ou acordeão as setas já têm outro uso: não trocam de post.
    if (/^(INPUT|TEXTAREA|SELECT|VIDEO|SUMMARY)$/.test(e.target.tagName) || ref('folha').open || !zoomAberto() || !estado.atual) return;
    if (e.key === 'ArrowLeft') mover(-1);
    else if (e.key === 'ArrowRight') mover(1);
    else if (e.key === 'Escape' && !largo.matches) fechar();
  });

  // ───────── entrar ─────────

  let criando = false;

  function pintarEntrada() {
    ref('entrada-titulo').textContent = criando ? 'Criar meu acesso' : 'Entrar no Garimpo';
    ref('botao-entrar').textContent = criando ? 'Criar acesso' : 'Entrar';
    ref('trocar-entrada').textContent = criando ? 'Já tenho acesso' : 'Criar meu acesso';
    ref('senha').setAttribute('autocomplete', criando ? 'new-password' : 'current-password');
    ref('erro-entrar').hidden = true;
  }

  function mostrarEntrada(sim) {
    estado.dentro = !sim;
    ref('entrada').hidden = !sim;
    ref('abas').hidden = sim;
    ref('lista').hidden = sim;
    ref('abrir-colar').hidden = sim;
    ref('abrir-conta').hidden = sim || dados.modo !== 'nuvem';
    ref('sinal').hidden = dados.modo !== 'demo';
    if (!sim) return;
    ref('resumo').hidden = true;
    ref('zoom').hidden = true;
    pintarEntrada();
    ref('email').focus();
  }

  async function enviarEntrada(evento) {
    evento.preventDefault();
    const aviso = ref('erro-entrar');
    const botao = ref('botao-entrar');
    aviso.hidden = true;
    botao.disabled = true;
    try {
      await (criando ? dados.criarAcesso : dados.entrar)(ref('email').value.trim(), ref('senha').value);
      ref('senha').value = '';
      await iniciar();
    } catch (erro) {
      aviso.textContent = erro.message;
      aviso.hidden = false;
    }
    botao.disabled = false;
  }

  // ───────── conta e aparelhos ─────────

  async function pintarSinal() {
    const s = await dados.sinal();
    ref('sinal-texto').textContent = s.texto;
    ref('sinal').classList.toggle('sinal--vivo', Boolean(s.vivo));
    ref('abrir-conta').classList.toggle('conta--vivo', Boolean(s.vivo));
    // O ponto é só cor: o mesmo aviso vai escrito para leitor de tela.
    ref('abrir-conta').setAttribute('aria-label', 'Conta e aparelhos. ' + s.texto);
    return s;
  }

  // A janela guarda o que leu da nuvem e se redesenha sem buscar de novo a cada toque.
  const conta = { sessao: null, sinal: { texto: '' }, lista: [], salvos: null };
  let focoDepois = null;

  async function pintarConta() {
    const erro = ref('erro-conta');
    try {
      const [sessao, sinal, lista, situacao, salvos] = await Promise.all([dados.sessao(), pintarSinal(), dados.aparelhos(),
        situacaoDoAviso().catch(() => ({ pode: false, ligado: false, texto: 'Não deu para ver o aviso agora.' })),
        dados.situacaoImportacao ? dados.situacaoImportacao().catch(() => null) : null]);
      Object.assign(conta, { sessao, sinal, lista, salvos });
      avisoAqui = situacao;
      desenharConta();
    } catch (falha) {
      erro.textContent = falha.message;
      erro.hidden = false;
    }
  }

  function desenharConta() {
    ref('conta-linhas').replaceChildren(...[
      linha('conta', 'Você', conta.sessao?.email || ''),
      linha('relogio', 'Garimpeiro', conta.sinal.texto),
      ...conta.lista.map((a) => linha(a.tipo === 'garimpeiro' ? 'pc' : 'celular', a.nome, a.visto)),
      conta.lista.length === 0 && linha('pc', 'Nenhum aparelho ligado', 'Ligue o PC para ele começar a analisar.'),
      linhaDoAviso(),
      linhaDosSalvos(),
    ].filter(Boolean));
    // O botão tocado é trocado ao redesenhar: o foco volta para o novo.
    if (focoDepois) ref('conta-linhas').querySelector('[data-acao="' + focoDepois + '"]')?.focus();
    focoDepois = null;
  }

  // Botão de ação dentro de uma linha da janela (ligar aviso, importar salvos).
  function botaoDaConta(nome, nomeIcone, texto, aoTocar, primario, rotuloLongo) {
    return h('button', {
      class: 'botao botao--justo' + (primario ? ' botao--primario' : ''), type: 'button', 'data-acao': nome, 'aria-label': rotuloLongo || null,
      onclick: (e) => { focoDepois = nome; aoTocar(e.currentTarget); },
    }, icone(nomeIcone), h('span', { text: texto }));
  }

  const acoes = (...botoes) => h('div', { class: 'linha__acoes' }, botoes);

  function mostrarErroDaConta(falha, reserva) {
    const texto = String((falha && falha.message) || '');
    // Erro técnico do navegador vem em inglês: não vai para a tela.
    ref('erro-conta').textContent = /[áàâãéêíóôõúç]/i.test(texto) ? texto : reserva;
    ref('erro-conta').hidden = false;
  }

  async function abrirConta() {
    ref('erro-conta').hidden = true;
    importacao = null;
    ref('chave').hidden = true;
    ref('chave-texto').value = '';
    ref('copiar-chave').querySelector('span').textContent = 'Copiar chave';
    ref('conta').querySelector('[data-ligar="garimpeiro"] span').textContent = NESTE_PC ? 'Ligar este PC' : 'Ligar um PC';
    ref('conta').showModal();
    await pintarConta();
  }

  // Com o app aberto no próprio PC do garimpeiro, a chave vai direto para ele, sem aparecer na tela.
  const NESTE_PC = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);

  async function ligar(tipo, botao) {
    const aviso = ref('erro-conta');
    aviso.hidden = true;
    try {
      const chave = await dados.ligarAparelho(tipo === 'garimpeiro' ? 'PC' : 'iPhone', tipo);
      if (tipo === 'garimpeiro' && NESTE_PC) {
        const r = await fetch('/_ligar-pc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chave: chave }) });
        if (!r.ok) throw new Error('A chave foi criada, mas não consegui guardar neste PC.');
        botao.querySelector('span').textContent = 'PC ligado';
      } else {
        ref('chave-texto').value = chave;
        ref('copiar-chave').querySelector('span').textContent = 'Copiar chave';
        ref('chave').hidden = false;
      }
      await pintarConta();
    } catch (erro) {
      aviso.textContent = erro.message;
      aviso.hidden = false;
    }
  }

  async function copiarChave() {
    const campo = ref('chave-texto');
    const rotulo = ref('copiar-chave').querySelector('span');
    try {
      await navigator.clipboard.writeText(campo.value);
      rotulo.textContent = 'Chave copiada';
    } catch (erro) {
      campo.select();
      rotulo.textContent = 'Selecionada: copie';
    }
  }

  async function sair() {
    await dados.sair();
    ref('conta').close();
    estado.itens = [];
    estado.atual = null;
    await iniciar();
  }

  // Ao voltar para o app, busca o que o PC analisou nesse meio tempo (sem mexer num zoom aberto no celular).
  async function atualizarEmSilencio() {
    if (!estado.dentro || estado.carregando || document.hidden) return;
    try {
      estado.itens = await dados.listar();
    } catch (erro) {
      return;
    }
    pintarSinal().catch(() => {});
    if (!largo.matches && zoomAberto()) return;
    montarSequencia();
    renderTudo();
  }

  // ───────── aviso no celular ─────────
  // O aparelho se inscreve no serviço de aviso do próprio navegador (Google, Apple, Microsoft) com a
  // chave pública do Garimpo. Quando a ficha fica pronta, o servidor manda o aviso cifrado para ele.

  const IPHONE = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const MARCA_DO_AVISO = 'garimpo';
  const ITEM_VALIDO = /^[0-9a-f-]{36}$/;
  let avisoAqui = { pode: false, ligado: false, texto: '' };

  const avisoPossivel = () => dados.modo === 'nuvem' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

  function bytesDe(b64) {
    const base = b64.replace(/-/g, '+').replace(/_/g, '/');
    return Uint8Array.from(atob(base + '='.repeat((4 - (base.length % 4)) % 4)), (c) => c.charCodeAt(0));
  }

  const iguais = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

  // Se o sw.js não registrou (navegador sem suporte), não espera para sempre.
  function registro() {
    return Promise.race([navigator.serviceWorker.ready,
      new Promise((_, falhou) => setTimeout(() => falhou(new Error('O aviso não carregou. Abra o app de novo.')), 5000))]);
  }

  async function situacaoDoAviso() {
    if (!avisoPossivel()) {
      return { pode: false, ligado: false, texto: IPHONE ? 'No iPhone, instale o app na tela de início para ter aviso.' : 'Este navegador não manda aviso.' };
    }
    if (Notification.permission === 'denied') return { pode: false, ligado: false, texto: 'Bloqueado. Libere o aviso nas configurações do site.' };
    const inscricao = await (await registro()).pushManager.getSubscription();
    const ligado = Boolean(inscricao) && Notification.permission === 'granted' && await dados.avisoLigado(inscricao.endpoint);
    return { pode: true, ligado, texto: ligado ? 'Ligado. Avisa quando a ficha fica pronta.' : 'Desligado. Ligue para saber da ficha pronta.' };
  }

  function linhaDoAviso() {
    return linha('sino', 'Aviso neste aparelho', avisoAqui.texto,
      avisoAqui.pode && acoes(botaoDaConta('aviso', 'sino', avisoAqui.ligado ? 'Desligar aviso' : 'Ligar aviso', alternarAviso)));
  }

  async function alternarAviso(botao) {
    const ligar = !avisoAqui.ligado;
    ref('erro-conta').hidden = true;
    botao.disabled = true;
    botao.querySelector('span').textContent = ligar ? 'Ligando...' : 'Desligando...';
    try {
      // A permissão é pedida primeiro, ainda dentro do toque: o iPhone exige.
      if (ligar && (await Notification.requestPermission()) !== 'granted') {
        throw new Error('Sem permissão. Toque em Permitir quando o navegador perguntar.');
      }
      const reg = await registro();
      let inscricao = await reg.pushManager.getSubscription();
      if (!ligar) {
        if (inscricao) {
          await dados.desligarAviso(inscricao.endpoint);
          await inscricao.unsubscribe();
        }
      } else {
        const chave = bytesDe(await dados.avisoChave());
        const antiga = inscricao && inscricao.options.applicationServerKey;
        if (inscricao && (!antiga || !iguais(new Uint8Array(antiga), chave))) {
          await inscricao.unsubscribe();
          inscricao = null;
        }
        if (!inscricao) inscricao = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chave });
        const j = inscricao.toJSON();
        await dados.ligarAviso(j.endpoint, j.keys.p256dh, j.keys.auth);
        await dados.testarAviso(j.endpoint);
      }
    } catch (falha) {
      mostrarErroDaConta(falha, 'O aviso não ligou neste navegador. Tente de novo.');
    }
    await pintarConta();
  }

  // Abrir o app já conta como ter visto: os avisos que estavam na tela somem.
  function limparAvisos() {
    if (!avisoPossivel() || document.hidden) return;
    navigator.serviceWorker.getRegistration()
      .then((r) => (r ? r.getNotifications({ tag: MARCA_DO_AVISO }) : []))
      .then((lista) => lista.forEach((n) => n.close()))
      .catch(() => {});
  }

  // Tocar no aviso abre o post certo, na aba em que ele está.
  async function abrirDoAviso(id) {
    if (!ITEM_VALIDO.test(id)) return;
    if (!estado.itens.some((i) => i.id === id)) {
      try { estado.itens = await dados.listar(); } catch (erro) { return; }
    }
    const item = estado.itens.find((i) => i.id === id);
    const aba = item && ABAS.find((a) => a.tem(item.status));
    if (!aba) return;
    if (estado.aba !== aba.id) trocarAba(aba.id);
    else { montarSequencia(); renderTudo(); }
    abrir(id);
  }

  // ───────── salvos antigos ─────────
  // O dono pede o arquivo de dados ao Instagram ou ao TikTok e escolhe aqui. O app lê no próprio
  // aparelho (importar.js), mostra quantos achou e só põe na fila depois do "Colocar na fila".

  const AJUDA_INSTAGRAM = 'https://help.instagram.com/181231772500920';
  const AJUDA_TIKTOK = 'https://support.tiktok.com/pt_BR/account-and-privacy/personalized-ads-and-data/requesting-your-data';
  let importacao = null; // { fase: 'lendo' | 'achou' | 'colocando' | 'feito', achou, resultado }
  const conta1 = (n, um, varios) => n + ' ' + (n === 1 ? um : varios);

  function linhaDosSalvos() {
    if (!dados.importar) return null;
    const s = conta.salvos || { na_fila: 0, prontos: 0, perdidos: 0, por_dia: 20 };
    const fase = importacao && importacao.fase;
    if (fase === 'achou' || fase === 'colocando') {
      const a = importacao.achou;
      const partes = [a.instagram && a.instagram + ' do Instagram', a.tiktok && a.tiktok + ' do TikTok'].filter(Boolean).join(' e ');
      return linha('baixar', 'Achei ' + conta1(a.itens.length, 'post salvo', 'posts salvos'), partes + '. O PC analisa ' + s.por_dia + ' por dia.',
        acoes(botaoDaConta('cancelar-importar', 'x', 'Cancelar', cancelarImportar),
          botaoDaConta('colocar-na-fila', 'check', fase === 'colocando' ? 'Colocando...' : 'Colocar na fila', colocarNaFila, true)));
    }
    let texto;
    if (fase === 'feito') {
      const r = importacao.resultado;
      texto = [conta1(r.novos, 'novo na fila.', 'novos na fila.'), r.repetidos && conta1(r.repetidos, 'já estava no Garimpo.', 'já estavam no Garimpo.')].filter(Boolean).join(' ');
    } else if (s.na_fila > 0) texto = s.na_fila + ' na fila. O PC analisa ' + s.por_dia + ' por dia.';
    else if (s.prontos + s.perdidos > 0) texto = conta1(s.prontos, 'analisado', 'analisados') + (s.perdidos ? '; ' + s.perdidos + ' não deu para baixar.' : '.');
    const ajuda = (url, nome) => { const a = elo(url, nome); a.setAttribute('aria-label', 'Como pedir o arquivo ao ' + nome + ' (abre em nova aba)'); return a; };
    const ensina = !texto && ['Peça o arquivo ao ', ajuda(AJUDA_INSTAGRAM, 'Instagram'), ' ou ao ', ajuda(AJUDA_TIKTOK, 'TikTok'), ' e escolha aqui.'];
    return linha('baixar', 'Salvos antigos', ...(texto ? [texto] : ensina),
      acoes(botaoDaConta('importar', 'baixar', fase === 'lendo' ? 'Lendo arquivo...' : 'Importar salvos', escolherArquivo),
        s.na_fila > 0 && fase !== 'feito' && botaoDaConta('parar-importar', 'x', 'Parar fila', pararImportacao, false, 'Parar fila de importação dos salvos antigos')));
  }

  function escolherArquivo() {
    if (importacao && importacao.fase === 'lendo') return;
    ref('arquivo-salvos').click();
  }

  async function lerSalvos() {
    const campo = ref('arquivo-salvos');
    const arquivos = [...campo.files];
    campo.value = '';
    if (arquivos.length === 0) return;
    ref('erro-conta').hidden = true;
    importacao = { fase: 'lendo' };
    focoDepois = 'importar';
    desenharConta();
    try {
      const achou = await window.GarimpoImportar.ler(arquivos);
      if (achou.itens.length === 0) throw new Error('Não achei posts salvos neste arquivo. Escolha o .zip do Instagram ou do TikTok.');
      importacao = { fase: 'achou', achou };
      focoDepois = 'colocar-na-fila';
    } catch (falha) {
      importacao = null;
      focoDepois = 'importar';
      mostrarErroDaConta(falha, 'Não consegui ler este arquivo. Escolha o .zip que o Instagram ou o TikTok mandou.');
    }
    desenharConta();
  }

  function cancelarImportar() {
    importacao = null;
    focoDepois = 'importar';
    desenharConta();
  }

  async function colocarNaFila() {
    if (!importacao || importacao.fase !== 'achou') return;
    ref('erro-conta').hidden = true;
    importacao.fase = 'colocando';
    desenharConta();
    try {
      importacao = { fase: 'feito', resultado: await dados.importar(importacao.achou.itens) };
    } catch (falha) {
      importacao.fase = 'achou';
      mostrarErroDaConta(falha, 'Não deu para colocar na fila. Confira a internet e tente de novo.');
    }
    focoDepois = 'importar';
    await pintarConta();
  }

  async function pararImportacao(botao) {
    ref('erro-conta').hidden = true;
    botao.disabled = true;
    try {
      await dados.pararImportacao();
      importacao = null;
    } catch (falha) {
      mostrarErroDaConta(falha, 'Não deu para parar agora. Tente de novo.');
    }
    focoDepois = 'importar';
    await pintarConta();
  }

  // ───────── o que chegou pelo Compartilhar do celular ─────────
  // O sw.js guarda o link e as mídias no próprio aparelho; aqui, com o dono já dentro,
  // eles vão para a caixa de entrada. Sem login, ficam guardados até ele entrar.

  const GAVETA_RECEBIDO = 'garimpo-compartilhado-v1';

  async function receberCompartilhado() {
    if (dados.modo !== 'nuvem' || !('caches' in window)) return;
    const gaveta = await caches.open(GAVETA_RECEBIDO);
    const lotes = {};
    for (const pedido of await gaveta.keys()) {
      const partes = new URL(pedido.url).pathname.match(/\/_recebido\/(\d+)\/(texto|arquivo-\d+)$/);
      if (partes) (lotes[partes[1]] = lotes[partes[1]] || []).push({ parte: partes[2], pedido });
    }
    for (const lote of Object.keys(lotes).sort()) {
      let texto = '';
      const arquivos = [];
      for (const { parte, pedido } of lotes[lote]) {
        const guardado = await gaveta.match(pedido);
        if (parte === 'texto') texto = await guardado.text();
        else arquivos.push({ blob: await guardado.blob(), tipo: guardado.headers.get('content-type'), nome: decodeURIComponent(guardado.headers.get('x-nome') || parte) });
      }
      let falha = null;
      try {
        if (arquivos.length > 0) await dados.capturarArquivos(arquivos, texto);
        else await dados.capturar(texto);
      } catch (erro) {
        falha = erro;
      }
      // Sem internet, fica guardado para a próxima abertura; qualquer outro caso sai da gaveta.
      if (!falha || !/Sem conexão/.test(falha.message)) {
        for (const { pedido } of lotes[lote]) await gaveta.delete(pedido);
      }
      if (falha) {
        abrirColar();
        ref('link').value = (texto.match(/https?:\/\/\S+/) || [''])[0];
        ref('erro-colar').textContent = falha.message;
        ref('erro-colar').hidden = false;
        break;
      }
    }
    if (new URLSearchParams(location.search).has('recebido')) history.replaceState(null, '', location.pathname + location.hash);
  }

  async function iniciar() {
    // Recarregou com a pilha aberta: começa pela lista.
    if (location.hash === '#avaliar') history.replaceState(null, '', location.pathname + location.search);
    let sessao = null;
    try { sessao = await dados.sessao(); } catch (erro) { /* sem conexão: cai na entrada */ }
    if (dados.modo === 'nuvem' && !sessao) { mostrarEntrada(true); return; }
    mostrarEntrada(false);
    pintarSinal().catch(() => {});
    await receberCompartilhado().catch(() => {});
    await carregar();
    limparAvisos();
    const pedido = new URLSearchParams(location.search).get('abrir');
    if (pedido) {
      history.replaceState(null, '', location.pathname + location.hash);
      await abrirDoAviso(pedido);
    }
  }

  ref('forma-entrar').addEventListener('submit', enviarEntrada);
  ref('trocar-entrada').addEventListener('click', () => { criando = !criando; pintarEntrada(); });
  ref('abrir-conta').addEventListener('click', abrirConta);
  ref('fechar-conta').addEventListener('click', () => ref('conta').close());
  ref('sair').addEventListener('click', sair);
  ref('copiar-chave').addEventListener('click', copiarChave);
  for (const botao of ref('conta').querySelectorAll('[data-ligar]')) {
    botao.addEventListener('click', () => ligar(botao.dataset.ligar, botao));
  }
  ref('arquivo-salvos').addEventListener('change', lerSalvos);
  document.addEventListener('visibilitychange', atualizarEmSilencio);
  document.addEventListener('visibilitychange', limparAvisos);

  // O sw.js é quem atende o Compartilhar do Android; só existe no app de verdade.
  if (dados.modo === 'nuvem' && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
    // Recados do sw.js: chegou aviso (a lista se atualiza) ou tocaram no aviso (abre o post).
    navigator.serviceWorker.addEventListener('message', (evento) => {
      const recado = evento.data || {};
      if (recado.tipo === 'novidade') atualizarEmSilencio();
      if (recado.tipo === 'abrir') abrirDoAviso(String(recado.item || ''));
    });
  }

  iniciar();
})();
