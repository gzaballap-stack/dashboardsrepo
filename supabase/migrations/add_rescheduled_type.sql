-- A reschedule is not a new booking (src/lib/reschedule.ts).
-- Lets `events.event_type` hold 'rescheduled': the same lead booking again,
-- kept on record but counted by nothing.
--
-- Additive only. The list of allowed types is NOT rewritten from this file —
-- it is read from the database as it stands and 'rescheduled' is added to it,
-- so a type this database allows and the repo has forgotten is never lost.
-- One statement: it either all happens or none of it does. Safe to re-run.

do $$
declare
  was  text;
  next text;
begin
  select pg_get_constraintdef(oid) into was
  from pg_constraint
  where conname = 'events_event_type_check' and conrelid = 'public.events'::regclass;

  if was is null then return; end if;                        -- no list on this database: nothing to allow
  if position('rescheduled' in was) > 0 then return; end if; -- already allowed

  -- CHECK ((event_type = ANY (ARRAY['dial'::text, … 'spam_appointment'::text])))
  next := regexp_replace(was, '\]\)', ', ''rescheduled''::text])');
  if next = was or position('rescheduled' in next) = 0 then
    raise exception 'events_event_type_check is not in the expected shape, left untouched: %', was;
  end if;

  execute 'alter table public.events drop constraint events_event_type_check';
  execute 'alter table public.events add constraint events_event_type_check ' || next;
end $$;
