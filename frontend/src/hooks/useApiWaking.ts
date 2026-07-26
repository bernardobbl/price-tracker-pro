import { useEffect, useState } from "react";
import { onApiWaking } from "../api/client";

/**
 * `true` enquanto alguma requisição está demorando mais que o normal.
 *
 * No free tier o backend hiberna e a 1ª requisição leva de 30 a 60 s para
 * acordá-lo. Sem aviso, o visitante acha que o app quebrou — com aviso, ele
 * entende que é só a partida e espera. O sinal vem da camada de API
 * (`api/client.ts`), então qualquer chamada do app alimenta este estado.
 */
export function useApiWaking(): boolean {
  const [waking, setWaking] = useState(false);
  useEffect(() => onApiWaking(setWaking), []);
  return waking;
}
