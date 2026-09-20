-- Small Tasks became a standing list rather than a per-day queue, so the open
-- ones lose their date. Without this they would stay pinned to the day they
-- were written on and vanish from the list the next morning.
-- Touches only unfinished rows in the Small Tasks queue.

update tasks set task_date = null where scope = 'inbox' and done = false;
