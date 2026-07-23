-- Migração 002 — Virada de domínio: livros (Books to Scrape) → combustível (ANP).
-- Fase 6.8 do plan.md.
--
-- Rode este arquivo UMA VEZ no SQL Editor do Supabase se o banco já tiver as tabelas
-- do domínio antigo (tracked_products / prices / alerts do formato livros).
-- Depois rode o schema.sql completo, que cria o novo modelo (fuel_prices,
-- tracked_series, alerts por-série, ingestion_runs).
--
-- ⚠️ Destrutivo: apaga os dados do domínio antigo (histórico de livros).
-- Isso é intencional — os preços de livros eram simulados (sandbox estático) e não
-- fazem sentido no domínio de combustível. Faça backup se quiser preservá-los.

-- alerts referenciava tracked_products via FK composta → dropa antes.
drop table if exists public.alerts cascade;
drop table if exists public.prices cascade;
drop table if exists public.tracked_products cascade;

-- Próximo passo: execute backend/supabase/schema.sql (idempotente) para criar o
-- novo modelo do domínio combustível.
