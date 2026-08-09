import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { decodeAnpCsv, pareceUtf8LidoComoLatin1 } from "../src/ingest/anpDecode";
import { parseAnpCsv } from "../src/ingest/anpParser";

/**
 * A etapa que faltava: **decodificar** os bytes antes de parsear.
 *
 * Achado navegando o produto em produção, não lendo código: o ranking "onde
 * está mais barato" de São Paulo listava **"SERVIÃ␇OS AUTOMOTIVOS PEDRODAVI
 * LTDA."**. Os code points vindos da API eram `U+00C3` + `U+0087` — os dois
 * bytes UTF-8 de **Ç** lidos como Latin-1.
 *
 * ## Por que a suíte inteira passava
 *
 * `anpParser.test.ts` e `anpNormalize.test.ts` carregam a fixture com
 * `readFileSync(..., "utf-8")` — ou seja, entregam ao parser bytes **já
 * decodificados corretamente**. A produção fazia `buffer.toString("latin1")`.
 * A única linha que diferia entre teste e produção era a linha errada, e
 * nenhuma asserção chegava perto dela.
 *
 * Este arquivo fecha exatamente esse vão: ele trabalha em cima de **Buffer**,
 * como a produção, e não de string pronta.
 */

const FIXTURE = path.join(__dirname, "fixtures/anpSample.csv");

describe("a fixture real é UTF-8 — e é a prova de que a suposição antiga era falsa", () => {
  it("contém sequências UTF-8 válidas de dois bytes", () => {
    const bytes = fs.readFileSync(FIXTURE);

    // "ã" em UTF-8 é C3 A3. Se o arquivo fosse Latin-1, seria o byte E3 sozinho.
    expect(
      bytes.includes(Buffer.from([0xc3, 0xa3])),
      "a fixture deixou de ser UTF-8 — se a ANP mudou de formato, este arquivo " +
        "precisa ganhar uma segunda fixture em Latin-1, não perder esta"
    ).toBe(true);
  });

  it("decodifica como utf-8 e devolve o texto legível", () => {
    const { text, encoding } = decodeAnpCsv(fs.readFileSync(FIXTURE));

    expect(encoding).toBe("utf-8");
    expect(text).toContain("Região");
    expect(text).toContain("Município");
  });
});

describe("o defeito de produção, reproduzido nos bytes exatos", () => {
  /** O nome do posto real que apareceu torto no ranking de São Paulo. */
  const nome = "SERVIÇOS AUTOMOTIVOS PEDRODAVI LTDA.";

  it("o caminho antigo (latin1 cru) produz exatamente o que estava no banco", () => {
    // Este teste NÃO exercita o nosso código — ele documenta a causa. Se algum
    // dia alguém "simplificar" o decode de volta para `toString("latin1")`,
    // este é o resultado que volta ao ranking.
    const corrompido = Buffer.from(nome, "utf8").toString("latin1");

    expect(corrompido).toBe("SERVIÃOS AUTOMOTIVOS PEDRODAVI LTDA.");
    expect(corrompido).toContain("SERVIÃOS");
    expect(pareceUtf8LidoComoLatin1(corrompido)).toBe(true);
  });

  it("o caminho novo devolve a cedilha intacta", () => {
    const { text, encoding } = decodeAnpCsv(Buffer.from(nome, "utf8"));

    expect(encoding).toBe("utf-8");
    expect(text).toBe(nome);
    expect(pareceUtf8LidoComoLatin1(text)).toBe(false);
  });
});

describe("Latin-1 de verdade continua funcionando", () => {
  // A detecção existe justamente para não trocar uma constante errada por
  // outra: um arquivo antigo, baixado por `--url` num backfill, tem de sair
  // legível também.
  it("cai para latin1 quando os bytes não formam UTF-8 válido", () => {
    const latin1 = Buffer.from([0x53, 0x45, 0x52, 0x56, 0x49, 0xc7, 0x4f, 0x53]); // SERVIÇOS

    const { text, encoding } = decodeAnpCsv(latin1);

    expect(encoding).toBe("latin1");
    expect(text).toBe("SERVIÇOS");
  });

  it("não confunde ASCII puro — sem acento, UTF-8 vence e dá no mesmo", () => {
    const { text, encoding } = decodeAnpCsv(Buffer.from("AUTO POSTO LIDER LTDA", "utf8"));

    expect(encoding).toBe("utf-8");
    expect(text).toBe("AUTO POSTO LIDER LTDA");
  });
});

describe("BOM", () => {
  it("é removido, para não grudar no primeiro nome de coluna", () => {
    // Com o BOM preso na string, o cabeçalho vira "<BOM>Região - Sigla" e o
    // mapeamento de colunas do parser não encontra a primeira coluna.
    const comBom = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from("Regiao - Sigla;Estado - Sigla", "utf8"),
    ]);

    const { text } = decodeAnpCsv(comBom);

    expect(text.startsWith("Regiao")).toBe(true);
    // `\uFEFF` e não o caractere literal: um BOM cru no meio do teste é
    // invisível no editor e o próprio `eslint` reprova (`no-irregular-whitespace`)
    // — o que é uma ironia útil, já que o defeito que este teste guarda é
    // exatamente um caractere invisível grudado onde não devia.
    expect(text).not.toContain("\uFEFF");
  });
});

describe("ponta a ponta: bytes → parser, como em produção", () => {
  it("o parser recebe acento correto quando parte do Buffer", () => {
    // O teste que existia parava um passo depois disto. Aqui a cadeia começa
    // onde ela começa de verdade: num Buffer vindo da rede.
    const { text } = decodeAnpCsv(fs.readFileSync(FIXTURE));
    const linhas = parseAnpCsv(text);

    expect(linhas.length).toBeGreaterThan(0);

    const tortos = linhas.filter((l) =>
      pareceUtf8LidoComoLatin1(`${l.reseller ?? ""} ${l.municipality ?? ""} ${l.street ?? ""}`)
    );
    expect(
      tortos,
      "alguma linha saiu com a assinatura de UTF-8 lido como Latin-1"
    ).toEqual([]);
  });
});
