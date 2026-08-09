/**
 * Decodificação do CSV da ANP — a etapa que ficava fora de todo teste.
 *
 * ## O defeito que originou este arquivo (09/ago/2026)
 *
 * Um posto real aparecia no ranking de São Paulo como
 * **"SERVIÃOS AUTOMOTIVOS PEDRODAVI LTDA."**. Os code points do nome, lidos
 * direto da resposta da API em produção, eram `U+00C3` seguido de `U+0087` —
 * que são exatamente os dois bytes UTF-8 da letra **Ç** (`C3 87`) interpretados
 * como Latin-1, um byte por caractere.
 *
 * Ou seja: **o arquivo da ANP é UTF-8 e o código o decodificava como Latin-1.**
 * O `anpIngestor` fazia `buffer.toString("latin1")` e um comentário no
 * `httpClient` afirmava, com confiança, que "os CSVs da ANP são Latin-1 /
 * Windows-1252". A afirmação era falsa, e a prova estava dentro do próprio
 * repositório: `test/fixtures/anpSample.csv` — descrita nos testes como *a
 * fixture real* — é UTF-8 (`c3a3` para "ã", `c3ad` para "í", `c3ba` para "ú").
 *
 * ## Por que 296 testes passavam por cima disso
 *
 * Os dois testes que usam a fixture a carregam com
 * `readFileSync(..., "utf-8")`. Eles exercitam o **parser** com bytes já
 * decodificados corretamente — e a decodificação é justamente onde o defeito
 * morava. A única linha que difere entre o teste e a produção era a linha
 * errada, e nenhuma asserção passava perto dela.
 *
 * É a mesma forma de todas as falhas deste projeto: nada quebrava, nenhum log
 * reclamava, e o sintoma era um nome feio numa lista que ninguém conferia
 * caractere a caractere.
 *
 * ## Por que detectar em vez de trocar "latin1" por "utf8"
 *
 * Trocar a constante consertaria hoje e criaria a mesma dívida ao contrário: a
 * ANP já mudou formato de arquivo antes (ver os comentários do `anpDiscovery`),
 * e um arquivo antigo em Latin-1 baixado por `--url` para backfill passaria a
 * vir com `` no lugar dos acentos. Aqui a resposta vem do conteúdo, não de uma
 * suposição sobre o fornecedor.
 */

/**
 * Marca de ordem de bytes UTF-8. Quando presente, ela **é** a resposta sobre o
 * encoding — e precisa sair da string, senão vira um caractere invisível
 * grudado no primeiro nome de coluna do cabeçalho, quebrando o mapeamento.
 */
const BOM = "\uFEFF";

export type AnpEncoding = "utf-8" | "latin1";

export interface DecodedCsv {
  text: string;
  /** Qual decodificação venceu. Vai para o log da ingestão. */
  encoding: AnpEncoding;
}

/**
 * Decodifica o CSV da ANP escolhendo o encoding pelo conteúdo.
 *
 * A regra é simples e não depende de heurística estatística: **UTF-8 é um
 * formato verificável**. Uma sequência de bytes ou é UTF-8 válido ou não é, e o
 * `TextDecoder` com `fatal: true` responde isso sem chutar. Texto Latin-1 com
 * acentos quase sempre falha nessa verificação (um `0xE7` solto não abre
 * sequência válida), então a ordem "tenta UTF-8, cai para Latin-1" acerta os
 * dois casos.
 *
 * O caminho de falso positivo — Latin-1 que por acaso forma UTF-8 válido —
 * exige uma combinação improvável de bytes altos adjacentes (`Ã§`, `Ã£`) que só
 * aparece em texto já corrompido. Aceitamos esse risco conscientemente: ele é
 * muito menor que o de fixar uma constante errada, que é o defeito que estamos
 * consertando.
 */
export function decodeAnpCsv(buffer: Buffer): DecodedCsv {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    return { text: stripBom(text), encoding: "utf-8" };
  } catch {
    // Não é UTF-8 válido → é (ou é indistinguível de) Latin-1, o formato antigo.
    return { text: stripBom(buffer.toString("latin1")), encoding: "latin1" };
  }
}

function stripBom(text: string): string {
  return text.startsWith(BOM) ? text.slice(BOM.length) : text;
}

/**
 * O nome contém a assinatura de UTF-8 lido como Latin-1?
 *
 * Existe para o **teste de regressão** e para um aviso de operação: se um dia
 * a detecção falhar, é este padrão que vai reaparecer no banco, e é barato
 * procurá-lo. `Ã` seguido de qualquer caractere de controle C1 (U+0080–U+009F)
 * não acontece em texto português legítimo — aquele bloco não tem letra
 * nenhuma, só controles invisíveis.
 */
export function pareceUtf8LidoComoLatin1(texto: string): boolean {
  return /[\u00C3\u00C2][\u0080-\u009F]/.test(texto);
}
