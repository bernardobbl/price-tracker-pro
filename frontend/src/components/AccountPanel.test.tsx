import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { AccountPanel } from "./AccountPanel";
import { CONFIRMACAO_EXCLUSAO, type Entitlement } from "../types";

/**
 * A tela que cumpre a Política de Privacidade.
 *
 * O que se testa aqui não é layout: é **atrito na hora certa**. Excluir conta é
 * irreversível, pode estar jogando fora acesso já pago, e produz uma informação
 * (os códigos de cobrança) que some para sempre se a tela virar cedo demais.
 * Cada teste abaixo corresponde a um desses momentos.
 */

const api = vi.hoisted(() => ({
  downloadAccountData: vi.fn(),
  deleteAccount: vi.fn(),
}));

vi.mock("../api/client", async () => {
  const real = await vi.importActual<typeof import("../api/client")>("../api/client");
  return {
    ...real,
    downloadAccountData: api.downloadAccountData,
    deleteAccount: api.deleteAccount,
  };
});

const premium = (over: Partial<Entitlement> = {}): Entitlement => ({
  active: true,
  plan: "anual",
  expiresAt: "2027-08-04T10:00:00Z",
  daysLeft: 300,
  ...over,
});

const respostaExclusao = (over: Record<string, unknown> = {}) => ({
  assinaturasAnonimizadas: 1,
  cobrancasAnonimizadas: 1,
  tinhaAssinaturaAtiva: false,
  cobrancasParaReembolso: ["c0ffee00-1111-2222-3333-444444444444"],
  mensagem: "Conta excluída.",
  ...over,
});

function montar(props: Partial<React.ComponentProps<typeof AccountPanel>> = {}) {
  const onDeleted = vi.fn();
  const onClose = vi.fn();
  render(
    <AccountPanel
      email="alguem@exemplo.com"
      entitlement={null}
      onDeleted={onDeleted}
      onClose={onClose}
      {...props}
    />
  );
  return { onDeleted, onClose };
}

beforeEach(() => {
  api.downloadAccountData.mockReset();
  api.deleteAccount.mockReset();
  api.downloadAccountData.mockResolvedValue("meus-dados.json");
  api.deleteAccount.mockResolvedValue(respostaExclusao());
});

describe("exportar dados", () => {
  it("baixa o arquivo e confirma na tela", async () => {
    montar();
    fireEvent.click(screen.getByRole("button", { name: /baixar meus dados/i }));

    expect(api.downloadAccountData).toHaveBeenCalledOnce();
    expect(await screen.findByText(/meus-dados\.json baixado/i)).toBeInTheDocument();
  });

  it("falha de exportação não derruba a tela — a conta segue intacta", async () => {
    api.downloadAccountData.mockRejectedValue(new Error("servidor fora"));
    montar();

    fireEvent.click(screen.getByRole("button", { name: /baixar meus dados/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/servidor fora/i);
    expect(screen.getByRole("button", { name: /quero excluir/i })).toBeInTheDocument();
  });
});

describe("excluir conta — o atrito", () => {
  // Dois passos de propósito: o primeiro clique só revela o campo. Um botão
  // "Excluir" direto no repouso é acidente esperando data.
  it("não expõe o campo de confirmação antes de a pessoa pedir", () => {
    montar();
    expect(screen.queryByLabelText(/irreversível/i)).toBeNull();
  });

  it("exige a palavra exata antes de liberar o botão", async () => {
    montar();
    fireEvent.click(screen.getByRole("button", { name: /quero excluir/i }));

    const botao = screen.getByRole("button", { name: /excluir definitivamente/i });
    expect(botao).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/irreversível/i), { target: { value: "excluir" } });
    expect(botao).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/irreversível/i), { target: { value: CONFIRMACAO_EXCLUSAO } });
    expect(botao).toBeEnabled();
  });

  it("chama o backend com a palavra que o schema exige", async () => {
    montar();
    fireEvent.click(screen.getByRole("button", { name: /quero excluir/i }));
    fireEvent.change(screen.getByLabelText(/irreversível/i), { target: { value: CONFIRMACAO_EXCLUSAO } });
    fireEvent.click(screen.getByRole("button", { name: /excluir definitivamente/i }));

    await waitFor(() => expect(api.deleteAccount).toHaveBeenCalledWith(CONFIRMACAO_EXCLUSAO));
  });

  it("cancelar volta ao repouso sem chamar nada", async () => {
    montar();
    fireEvent.click(screen.getByRole("button", { name: /quero excluir/i }));
    fireEvent.click(screen.getByRole("button", { name: /cancelar/i }));

    expect(screen.queryByLabelText(/irreversível/i)).toBeNull();
    expect(api.deleteAccount).not.toHaveBeenCalled();
  });
});

describe("excluir conta — quem tem acesso pago", () => {
  // O aviso mais caro da tela. O backend devolve `tinhaAssinaturaAtiva`, mas
  // resposta chega DEPOIS de a conta sumir — tarde demais para desistir.
  it("avisa ANTES do clique que há Premium valendo, e mostra o caminho do reembolso", () => {
    montar({ entitlement: premium() });

    const aviso = screen.getByText(/você tem premium valendo/i).closest("div")!;
    expect(aviso).toHaveTextContent(/não devolve o dinheiro automaticamente/i);
    // `within` o aviso: o rodapé da tela também linka política (a de
    // privacidade), e a busca global casaria com as duas.
    expect(within(aviso).getByRole("link", { name: /política/i })).toHaveAttribute(
      "href",
      "/reembolso.html"
    );
  });

  it("não assusta quem está no plano gratuito", () => {
    montar({ entitlement: null });
    expect(screen.queryByText(/você tem premium valendo/i)).toBeNull();
  });
});

describe("depois da exclusão", () => {
  // Sem os códigos, a promessa de reembolso da própria resposta fica
  // inexequível: `user_id = null` torna a cobrança inalcançável por pessoa.
  it("mostra os códigos de cobrança — a única alça que sobra para pedir reembolso", async () => {
    montar();
    fireEvent.click(screen.getByRole("button", { name: /quero excluir/i }));
    fireEvent.change(screen.getByLabelText(/irreversível/i), { target: { value: CONFIRMACAO_EXCLUSAO } });
    fireEvent.click(screen.getByRole("button", { name: /excluir definitivamente/i }));

    expect(await screen.findByText("c0ffee00-1111-2222-3333-444444444444")).toBeInTheDocument();
    expect(screen.getByText(/guarde estes códigos/i)).toBeInTheDocument();
  });

  it("NÃO desloga sozinho — sair varreria os códigos da tela", async () => {
    const { onDeleted } = montar();
    fireEvent.click(screen.getByRole("button", { name: /quero excluir/i }));
    fireEvent.change(screen.getByLabelText(/irreversível/i), { target: { value: CONFIRMACAO_EXCLUSAO } });
    fireEvent.click(screen.getByRole("button", { name: /excluir definitivamente/i }));

    await screen.findByRole("heading", { name: /conta excluída/i });
    expect(onDeleted).not.toHaveBeenCalled();

    // Sair é ato da pessoa, depois de ler.
    fireEvent.click(screen.getByRole("button", { name: /entendi, sair/i }));
    expect(onDeleted).toHaveBeenCalledOnce();
  });

  it("sem cobranças, não inventa uma caixa de códigos vazia", async () => {
    api.deleteAccount.mockResolvedValue(respostaExclusao({ cobrancasParaReembolso: [] }));
    montar();

    fireEvent.click(screen.getByRole("button", { name: /quero excluir/i }));
    fireEvent.change(screen.getByLabelText(/irreversível/i), { target: { value: CONFIRMACAO_EXCLUSAO } });
    fireEvent.click(screen.getByRole("button", { name: /excluir definitivamente/i }));

    await screen.findByRole("heading", { name: /conta excluída/i });
    expect(screen.queryByText(/guarde estes códigos/i)).toBeNull();
  });
});

describe("quando a exclusão falha", () => {
  it("diz que a conta segue intacta e deixa tentar de novo", async () => {
    api.deleteAccount.mockRejectedValue(new Error("banco fora"));
    montar();

    fireEvent.click(screen.getByRole("button", { name: /quero excluir/i }));
    fireEvent.change(screen.getByLabelText(/irreversível/i), { target: { value: CONFIRMACAO_EXCLUSAO } });
    fireEvent.click(screen.getByRole("button", { name: /excluir definitivamente/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/banco fora/i);
    // O botão volta a funcionar: falha de servidor não pode prender a pessoa
    // numa tela onde ela já digitou a confirmação.
    expect(screen.getByRole("button", { name: /excluir definitivamente/i })).toBeEnabled();
  });
});
