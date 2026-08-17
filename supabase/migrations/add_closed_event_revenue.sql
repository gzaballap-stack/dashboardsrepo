-- Add revenue field to events and allow 'closed' event type

alter table events add column if not exists revenue numeric not null default 0;

alter table events drop constraint if exists events_event_type_check;

alter table events add constraint events_event_type_check check (
  event_type in ('dial', 'lead', 'appointment_booked', 'show', 'no_show', 'callback_booked', 'closed')
);
