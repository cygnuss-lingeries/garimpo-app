// Camada de dados do app. A tela só conversa com este arquivo:
//   sessao() / entrar() / criarAcesso() / sair()   → quem está usando
//   listar()                                       → itens da caixa de entrada
//   decidir(id, decisao, comentario)               → grava Aprovar / Recusar / Dúvida
//   darNota(id, nota) / voltar(id)                 → nota do dono (1 a 5) e o Voltar (desfaz a decisão)
//   pedirPratica(id)                               → pede ao PC o exemplo "Na prática" daquele post
//   capturar(texto)                                → manda um link para a fila
//   sinal()                                        → situação do garimpeiro (texto curto)
//   aparelhos() / ligarAparelho() / desligarAparelho()
//   avisoChave() / ligarAviso() / desligarAviso() / testarAviso() / avisoLigado()   → aviso no celular (só nuvem)
//   importar(itens) / situacaoImportacao() / pararImportacao()                     → Salvos antigos (só nuvem)
// Dois modos: "nuvem" (Supabase, o de verdade) e "demo" (fichas de exemplo, decisões no navegador).
window.GarimpoDados = (function () {
  'use strict';

  const GAVETA = 'garimpo-demo-decisoes';
  const BALDE = 'midias';

  function ler() {
    try { return JSON.parse(localStorage.getItem(GAVETA) || '{}'); } catch (erro) { return {}; }
  }

  function gravar(valor) {
    try { localStorage.setItem(GAVETA, JSON.stringify(valor)); } catch (erro) { /* sem armazenamento: vale só nesta visita */ }
  }

  function origemDe(link) {
    if (/instagram\.com/i.test(link)) return 'instagram';
    if (/tiktok\.com/i.test(link)) return 'tiktok';
    return 'outro';
  }

  function haQuanto(data) {
    const minutos = Math.max(0, Math.round((Date.now() - new Date(data).getTime()) / 60000));
    if (minutos < 2) return 'agora';
    if (minutos < 60) return 'há ' + minutos + ' min';
    if (minutos < 60 * 48) return 'há ' + Math.round(minutos / 60) + ' h';
    return 'há ' + Math.round(minutos / 1440) + ' dias';
  }

  // ───────── demonstração ─────────

  function demo(base) {
    const novos = [];
    const memoria = ler();
    return {
      modo: 'demo',
      async sessao() { return { email: null }; },
      async sinal() { return { texto: 'Demonstração', vivo: false }; },

      async listar() {
        return novos.concat(base).map(function (item) {
          return Object.assign({}, item, memoria[item.id] || {});
        });
      },

      async decidir(id, decisao, comentario) {
        memoria[id] = Object.assign({}, memoria[id], { status: decisao, comentario: comentario || null, decidido_em: new Date().toISOString() });
        gravar(memoria);
      },

      async darNota(id, nota) {
        memoria[id] = Object.assign({}, memoria[id], { nota_dono: nota || null });
        gravar(memoria);
      },

      async voltar(id) {
        memoria[id] = Object.assign({}, memoria[id], { status: 'pronto', decidido_em: null });
        gravar(memoria);
      },

      async pedirPratica(id) {
        memoria[id] = Object.assign({}, memoria[id], { pratica: { estado: 'pedido', pedido_em: new Date().toISOString() } });
        gravar(memoria);
      },

      async capturar(texto) {
        const link = (String(texto).match(/https?:\/\/[^\s<>"']+/i) || [])[0];
        if (!link) throw new Error('Cole um link que comece com https://');
        const repetido = novos.concat(base).some(function (item) { return item.url === link; });
        if (repetido) return { repetido: true };
        novos.unshift({ id: 'novo-' + Date.now(), origem: origemDe(link), url: link, status: 'na_fila', criado_em: new Date().toISOString(), midias: { capa: null, slides: [] } });
        return { repetido: false };
      },
    };
  }

  // ───────── nuvem ─────────

  const ERROS = [
    [/invalid login credentials/i, 'E-mail ou senha não conferem.'],
    [/email not confirmed/i, 'Falta confirmar o e-mail. Abra a mensagem que chegou e tente de novo.'],
    [/cadastro fechado|database error saving new user/i, 'O cadastro está fechado. Peça um convite ao dono.'],
    [/already registered|already been registered/i, 'Esse e-mail já tem acesso. Use Entrar.'],
    [/password should be|weak password/i, 'A senha precisa ter pelo menos 8 caracteres.'],
    [/failed to fetch|networkerror|load failed/i, 'Sem conexão. Confira a internet e tente de novo.'],
    [/exceeded the maximum allowed size|too large/i, 'O arquivo é grande demais (o limite é 50 MB).'],
  ];

  function nomeSeguro(nome) {
    const limpo = String(nome || '').split(/[\\/]/).pop().replace(/[^A-Za-z0-9._-]/g, '_').slice(-80);
    return /^[A-Za-z0-9]/.test(limpo) ? limpo : 'arquivo';
  }

  function traduzir(erro) {
    const texto = String((erro && erro.message) || erro || '');
    const achado = ERROS.find(function (par) { return par[0].test(texto); });
    if (achado) return new Error(achado[1]);
    // As mensagens do próprio Garimpo já vêm em português; o resto (texto técnico em inglês) não vai para a tela.
    return new Error(/[áàâãéêíóôõúç]/i.test(texto) ? texto : 'Não deu certo. Tente de novo.');
  }

  function nuvem(config) {
    const banco = window.supabase.createClient(config.url, config.chave, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    });

    // A função "avisos" responde o erro em português no corpo; é ele que vai para a tela.
    async function chamarAvisos(corpo) {
      const r = await banco.functions.invoke('avisos', { body: corpo });
      if (!r.error) return r.data;
      let texto = '';
      try { texto = (await r.error.context.json()).erro || ''; } catch (erro) { texto = ''; }
      throw traduzir(new Error(texto || r.error.message));
    }

    return {
      modo: 'nuvem',

      async sessao() {
        const r = await banco.auth.getSession();
        return r.data.session ? { email: r.data.session.user.email } : null;
      },

      async entrar(email, senha) {
        const r = await banco.auth.signInWithPassword({ email: email, password: senha });
        if (r.error) throw traduzir(r.error);
      },

      async criarAcesso(email, senha) {
        const novo = await banco.auth.signUp({ email: email, password: senha });
        if (novo.error) throw traduzir(novo.error);
        if (novo.data.session) return;
        const r = await banco.auth.signInWithPassword({ email: email, password: senha });
        if (r.error) throw traduzir(r.error);
      },

      async sair() {
        await banco.auth.signOut();
      },

      async sinal() {
        const r = await banco.from('aparelhos').select('ultimo_sinal').eq('tipo', 'garimpeiro').is('revogado_em', null)
          .order('ultimo_sinal', { ascending: false, nullsFirst: false }).limit(1);
        const visto = r.data && r.data[0] && r.data[0].ultimo_sinal;
        if (!visto) return { texto: 'PC não ligado', vivo: false };
        return { texto: 'PC visto ' + haQuanto(visto), vivo: Date.now() - new Date(visto).getTime() < 20 * 60000 };
      },

      async listar() {
        const r = await banco.from('itens')
          .select('id, origem, url, status, criado_em, decidido_em, comentario, erro, analise, transcricao, midias, post, resposta, arquivado_em, instalacao, trabalho, nota_dono, pratica')
          .neq('status', 'duplicado')
          // Salvo antigo importado só aparece quando já tem ficha (ou decisão): a fila dele pode ter centenas.
          .or('importado.eq.false,status.in.(pronto,aprovado,recusado,duvida,instalando,instalado,erro_instalacao,desfeito)')
          .order('criado_em', { ascending: false }).limit(300);
        if (r.error) throw traduzir(r.error);

        // As mídias são privadas: o app pede um endereço temporário para cada uma.
        const caminhos = [];
        for (const item of r.data) {
          const m = item.midias || {};
          if (m.capa) caminhos.push(m.capa);
          for (const s of m.slides || []) if (s.caminho) caminhos.push(s.caminho);
          const p = item.pratica || {};
          if (p.capa) caminhos.push(p.capa);
          for (const s of p.slides || []) { if (s.caminho) caminhos.push(s.caminho); if (s.capa) caminhos.push(s.capa); }
        }
        const enderecos = {};
        if (caminhos.length > 0) {
          const assinados = await banco.storage.from(BALDE).createSignedUrls(caminhos, 6 * 3600);
          for (const a of assinados.data || []) if (a.signedUrl) enderecos[a.path] = a.signedUrl;
        }

        return r.data.map(function (item) {
          const m = item.midias || {};
          const capa = enderecos[m.capa] || null;
          const p = item.pratica;
          return Object.assign({}, item, {
            autor: (item.post && item.post.autor) || null,
            // Exemplo "Na prática": os endereços temporários entram no lugar dos caminhos.
            pratica: p && Object.assign({}, p, {
              capa: enderecos[p.capa] || null,
              slides: (p.slides || []).filter(function (s) { return enderecos[s.caminho]; })
                .map(function (s) { return { tipo: s.tipo, url: enderecos[s.caminho], capa: enderecos[s.capa] || null, legenda: s.legenda || '' }; }),
            }),
            midias: {
              capa: capa,
              slides: (m.slides || []).filter(function (s) { return enderecos[s.caminho]; })
                .map(function (s) { return { tipo: s.tipo, url: enderecos[s.caminho], capa: s.tipo === 'video' ? capa : null }; }),
            },
          });
        });
      },

      async decidir(id, decisao, comentario) {
        const r = await banco.rpc('decidir', { p_item: id, p_decisao: decisao, p_comentario: comentario || null });
        if (r.error) throw traduzir(r.error);
      },

      async darNota(id, nota) {
        const r = await banco.rpc('dar_nota', { p_item: id, p_nota: nota || null });
        if (r.error) throw traduzir(r.error);
      },

      async voltar(id) {
        const r = await banco.rpc('voltar_decisao', { p_item: id });
        if (r.error) throw traduzir(r.error);
      },

      async pedirPratica(id) {
        const r = await banco.rpc('pedir_pratica', { p_item: id });
        if (r.error) throw traduzir(r.error);
      },

      async capturar(texto) {
        const r = await banco.rpc('capturar', { p_texto: String(texto) });
        if (r.error) throw traduzir(r.error);
        return r.data;
      },

      /** Print ou gravação que o dono mandou: sobe para a pasta dele na nuvem e entra na fila. */
      async capturarArquivos(arquivos, texto) {
        const s = await banco.auth.getSession();
        const dono = s.data.session && s.data.session.user.id;
        if (!dono) throw new Error('Entre no app para mandar arquivos.');
        const lote = crypto.randomUUID();
        const caminhos = [];
        for (const arquivo of arquivos) {
          const caminho = dono + '/envios/' + lote + '/' + nomeSeguro(arquivo.nome);
          const envio = await banco.storage.from(BALDE).upload(caminho, arquivo.blob, { contentType: arquivo.tipo });
          if (envio.error) throw traduzir(envio.error);
          caminhos.push(caminho);
        }
        const r = await banco.rpc('capturar', { p_texto: texto || null, p_arquivos: caminhos });
        if (r.error) throw traduzir(r.error);
        return r.data;
      },

      async aparelhos() {
        const r = await banco.from('aparelhos').select('id, nome, tipo, ultimo_sinal').is('revogado_em', null).order('criado_em');
        if (r.error) throw traduzir(r.error);
        return r.data.map(function (a) {
          return Object.assign({}, a, { visto: a.ultimo_sinal ? 'visto ' + haQuanto(a.ultimo_sinal) : 'ainda não usado' });
        });
      },

      /** Devolve a chave do aparelho. Ela só aparece agora: no banco fica embaralhada. */
      async ligarAparelho(nome, tipo) {
        const r = await banco.rpc('criar_aparelho', { p_nome: nome, p_tipo: tipo });
        if (r.error) throw traduzir(r.error);
        return r.data;
      },

      async desligarAparelho(id) {
        const r = await banco.rpc('revogar_aparelho', { p_id: id });
        if (r.error) throw traduzir(r.error);
      },

      /** Chave pública do Garimpo, para o aparelho se inscrever no serviço de aviso do navegador. */
      async avisoChave() {
        return (await chamarAvisos({ acao: 'chave' })).publica;
      },

      async ligarAviso(endpoint, p256dh, auth) {
        const r = await banco.rpc('ligar_aviso', { p_endpoint: endpoint, p_p256dh: p256dh, p_auth: auth });
        if (r.error) throw traduzir(r.error);
      },

      async desligarAviso(endpoint) {
        const r = await banco.rpc('desligar_aviso', { p_endpoint: endpoint });
        if (r.error) throw traduzir(r.error);
      },

      async testarAviso(endpoint) {
        await chamarAvisos({ acao: 'testar', endpoint: endpoint });
      },

      /** Põe na fila os links achados no arquivo de dados. Vai em lotes de 1000. */
      async importar(itens) {
        const total = { novos: 0, repetidos: 0, ignorados: 0 };
        for (let i = 0; i < itens.length; i += 1000) {
          const r = await banco.rpc('importar', { p_itens: itens.slice(i, i + 1000) });
          if (r.error) throw traduzir(r.error);
          for (const chave of Object.keys(total)) total[chave] += r.data[chave] || 0;
        }
        return total;
      },

      async situacaoImportacao() {
        const r = await banco.rpc('situacao_importacao');
        if (r.error) throw traduzir(r.error);
        return r.data;
      },

      async pararImportacao() {
        const r = await banco.rpc('parar_importacao');
        if (r.error) throw traduzir(r.error);
        return r.data;
      },

      async avisoLigado(endpoint) {
        const r = await banco.from('avisos').select('id').eq('endpoint', endpoint).maybeSingle();
        if (r.error) throw traduzir(r.error);
        return Boolean(r.data);
      },
    };
  }

  return {
    criar: function (config) {
      if (config && config.modo === 'nuvem' && window.supabase) return nuvem(config);
      return demo(window.GARIMPO_DEMO || []);
    },
  };
})();
