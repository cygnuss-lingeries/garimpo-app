// Lê o arquivo oficial de dados do Instagram e do TikTok ("Baixar suas informações") no próprio aparelho
// e devolve só os links dos posts SALVOS (Instagram) e dos FAVORITOS (TikTok). Curtidas, histórico e o
// resto do arquivo ficam de fora. Nada do arquivo sai do aparelho: só a lista de links vai para a fila.
//
//   GarimpoImportar.ler(arquivos) → { itens: [{ url, salvo_em }], instagram, tiktok }
//
// Aceita o .zip inteiro (lido aos pedaços, sem carregar tudo na memória) ou o .json/.html solto.
window.GarimpoImportar = (function () {
  'use strict';

  const LIMITE = 100 * 1024 * 1024;
  const IG = /https?:\/\/(?:www\.)?instagram\.com\/(?:[A-Za-z0-9._]+\/)?(p|reels?|tv)\/([A-Za-z0-9_-]+)/gi;
  const TT = /https?:\/\/(?:www\.|m\.)?(?:tiktokv?\.com\/share\/video\/(\d+)|tiktok\.com\/@[A-Za-z0-9._-]*\/(?:video|photo)\/(\d+))/gi;

  // Quais arquivos do pacote interessam (pelo caminho dentro do .zip).
  function tipoDe(nome) {
    if (/saved|salv/i.test(nome)) return 'salvos';
    if (/favorit/i.test(nome)) return 'favoritos';
    if (/user_data|tiktok/i.test(nome) && /\.json$/i.test(nome)) return 'tiktok';
    return null;
  }

  // ───────── .zip aos pedaços ─────────

  async function pedaco(arquivo, inicio, fim) {
    return new Uint8Array(await arquivo.slice(inicio, fim).arrayBuffer());
  }

  const vista = (bytes) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const grande = (v, i) => Number(v.getBigUint64(i, true));

  async function entradas(arquivo) {
    const cauda = await pedaco(arquivo, Math.max(0, arquivo.size - 65557), arquivo.size);
    const v = vista(cauda);
    let fim = -1;
    for (let i = cauda.length - 22; i >= 0; i--) if (v.getUint32(i, true) === 0x06054b50) { fim = i; break; }
    if (fim < 0) throw new Error('Este arquivo não é um .zip que dê para ler.');
    let total = v.getUint16(fim + 10, true);
    let tamanho = v.getUint32(fim + 12, true);
    let inicio = v.getUint32(fim + 16, true);
    if (total === 0xffff || tamanho === 0xffffffff || inicio === 0xffffffff) {
      // .zip grande (ZIP64): os números verdadeiros ficam num registro à parte.
      if (fim < 20 || v.getUint32(fim - 20, true) !== 0x07064b50) throw new Error('Este .zip é grande demais para ler aqui.');
      const r = vista(await pedaco(arquivo, grande(v, fim - 12), grande(v, fim - 12) + 56));
      total = grande(r, 32);
      tamanho = grande(r, 40);
      inicio = grande(r, 48);
    }
    const dir = await pedaco(arquivo, inicio, inicio + tamanho);
    const d = vista(dir);
    const lista = [];
    let p = 0;
    for (let n = 0; n < total && p + 46 <= dir.length && d.getUint32(p, true) === 0x02014b50; n++) {
      const tamNome = d.getUint16(p + 28, true);
      const tamExtra = d.getUint16(p + 30, true);
      const tamNota = d.getUint16(p + 32, true);
      const e = {
        nome: new TextDecoder().decode(dir.subarray(p + 46, p + 46 + tamNome)),
        metodo: d.getUint16(p + 10, true),
        comprimido: d.getUint32(p + 20, true),
        normal: d.getUint32(p + 24, true),
        local: d.getUint32(p + 42, true),
      };
      // ZIP64: o que não coube em 32 bits vem no campo extra 0x0001, nesta ordem.
      for (let q = p + 46 + tamNome; q + 4 <= p + 46 + tamNome + tamExtra; q += 4 + d.getUint16(q + 2, true)) {
        if (d.getUint16(q, true) !== 1) continue;
        let r = q + 4;
        if (e.normal === 0xffffffff) { e.normal = grande(d, r); r += 8; }
        if (e.comprimido === 0xffffffff) { e.comprimido = grande(d, r); r += 8; }
        if (e.local === 0xffffffff) { e.local = grande(d, r); }
      }
      lista.push(e);
      p += 46 + tamNome + tamExtra + tamNota;
    }
    return lista;
  }

  async function texto(arquivo, e) {
    const c = vista(await pedaco(arquivo, e.local, e.local + 30));
    if (c.getUint32(0, true) !== 0x04034b50) return '';
    const inicio = e.local + 30 + c.getUint16(26, true) + c.getUint16(28, true);
    const dados = arquivo.slice(inicio, inicio + e.comprimido);
    if (e.metodo === 0) return dados.text();
    if (e.metodo !== 8 || typeof DecompressionStream === 'undefined') return '';
    return new Response(dados.stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
  }

  // ───────── links e datas ─────────

  // Data do salvamento, em segundos: "timestamp" do Instagram ou "Date" do TikTok.
  function dataDe(no) {
    if (typeof no.timestamp === 'number') return Math.round(no.timestamp > 1e12 ? no.timestamp / 1000 : no.timestamp);
    const d = typeof no.Date === 'string' ? no.Date : typeof no.date === 'string' ? no.date : null;
    const t = d ? Date.parse(d.replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(d) ? '' : 'Z')) : NaN;
    return Number.isFinite(t) ? Math.round(t / 1000) : null;
  }

  function linksDe(texto, quando, achados) {
    for (const m of texto.matchAll(IG)) guardar(achados, 'ig:' + m[2], 'instagram', m[0], quando);
    for (const m of texto.matchAll(TT)) guardar(achados, 'tt:' + (m[1] || m[2]), 'tiktok', m[0], quando);
  }

  function guardar(achados, chave, origem, url, quando) {
    const antes = achados.get(chave);
    if (!antes || (!antes.salvo_em && quando)) achados.set(chave, { url, origem, salvo_em: quando || null });
  }

  function percorrer(no, quando, achados) {
    if (typeof no === 'string') { linksDe(no, quando, achados); return; }
    if (!no || typeof no !== 'object') return;
    const aqui = Array.isArray(no) ? quando : dataDe(no) || quando;
    for (const valor of Object.values(no)) percorrer(valor, aqui, achados);
  }

  // No arquivo do TikTok vem tudo junto (curtidas, histórico...): só a parte dos favoritos interessa.
  function favoritos(no) {
    if (!no || typeof no !== 'object') return null;
    for (const [chave, valor] of Object.entries(no)) {
      if (/^favorite ?videos?$|^favoritevideolist$/i.test(chave)) return valor;
      const dentro = favoritos(valor);
      if (dentro) return dentro;
    }
    return null;
  }

  function examinar(tipo, conteudo, achados) {
    let json = null;
    try { json = JSON.parse(conteudo); } catch (erro) { json = null; }
    if (json && tipo === 'tiktok') { const parte = favoritos(json); if (parte) percorrer(parte, null, achados); return; }
    if (json) { percorrer(json, null, achados); return; }
    if (tipo !== 'tiktok') linksDe(conteudo, null, achados);
  }

  async function ler(arquivos) {
    const achados = new Map();
    for (const arquivo of arquivos) {
      if (/\.zip$/i.test(arquivo.name) || /zip/.test(arquivo.type)) {
        for (const e of await entradas(arquivo)) {
          const tipo = tipoDe(e.nome);
          if (tipo && /\.(json|html?|txt)$/i.test(e.nome) && e.normal <= LIMITE) examinar(tipo, await texto(arquivo, e), achados);
        }
      } else if (/\.(json|html?|txt)$/i.test(arquivo.name) && arquivo.size <= LIMITE) {
        // Arquivo escolhido solto: o dono já disse que é ele.
        examinar(tipoDe(arquivo.name) || 'escolhido', await arquivo.text(), achados);
      }
    }
    const itens = [...achados.values()];
    return {
      itens: itens.map((i) => ({ url: i.url, salvo_em: i.salvo_em })),
      instagram: itens.filter((i) => i.origem === 'instagram').length,
      tiktok: itens.filter((i) => i.origem === 'tiktok').length,
    };
  }

  return { ler };
})();
