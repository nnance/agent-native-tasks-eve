-- Phase 0 verification: the seeded-workspace state dump (US-A1.1-3, US-A1.5).
-- Run with: psql "$DATABASE_URL_UNPOOLED" -f docs/verification/phase-0/queries.sql
\pset pager off

\echo == projects ==
select id, name, created_at from projects order by created_at;

\echo == statuses (by project, then order) ==
select p.name as project, s.name, s.sort_order, s.is_completed, s.id
from statuses s
join projects p on p.id = s.project_id
order by p.created_at, s.sort_order;

\echo == priorities (by project, then order) ==
select p.name as project, r.name, r.sort_order, r.is_default, r.id
from priorities r
join projects p on p.id = r.project_id
order by p.created_at, r.sort_order;

\echo == row counts ==
select
  (select count(*) from projects)   as projects,
  (select count(*) from statuses)   as statuses,
  (select count(*) from priorities) as priorities,
  (select count(*) from tasks)      as tasks,
  (select count(*) from chat_state) as chat_state;
