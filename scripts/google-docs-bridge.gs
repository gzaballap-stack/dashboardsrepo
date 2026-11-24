// Google Apps Script — the app's bridge to Google Docs and Google Calendar
// (replaces Make's Google Docs modules; adds follow-up calls to the calendar). Paste into a new project at script.google.com, set TOKEN to the
// DIRECT_WEBHOOK_TOKEN value, then Deploy → New deployment → Web app,
// Execute as: Me, Who has access: Anyone. Put the /exec URL in Railway as
// GOOGLE_DOCS_SCRIPT_URL. See src/lib/google-docs-bridge.ts.

const TOKEN = 'PASTE_DIRECT_WEBHOOK_TOKEN_HERE';

function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return out({ ok: false, error: 'bad json' }); }
  if (!req || req.token !== TOKEN) return out({ ok: false, error: 'unauthorized' });

  try {
    if (req.action === 'create_from_template') {
      const copy = DriveApp.getFileById(req.templateId).makeCopy(req.name || 'Untitled');
      const body = DocumentApp.openById(copy.getId()).getBody();
      Object.keys(req.values || {}).forEach(function (k) {
        body.replaceText(escapeRe('{{' + k + '}}'), String(req.values[k] == null ? '' : req.values[k]));
      });
      return out({ ok: true, id: copy.getId() });
    }
    if (req.action === 'replace_text') {
      const body = DocumentApp.openById(req.docId).getBody();
      (req.replacements || []).forEach(function (r) {
        if (r.find) body.replaceText(escapeRe(r.find), String(r.replace == null ? '' : r.replace));
      });
      return out({ ok: true, replaced: (req.replacements || []).length });
    }
    if (req.action === 'create_event') {
      // A follow-up call booked from the Task Board's Calls panel. Lands on the
      // calendar of the account this script runs as; a guest gets Google's invite.
      const opts = { description: req.description || '' };
      if (req.location) opts.location = req.location;
      if (req.guests) { opts.guests = req.guests; opts.sendInvites = true; }
      const ev = CalendarApp.getDefaultCalendar()
        .createEvent(req.title || 'Follow-up call', new Date(req.start), new Date(req.end), opts);
      return out({ ok: true, id: ev.getId() });
    }
    if (req.action === 'delete_event') {
      // Delete a call from the Task Board's Calls panel. A repeating event is
      // never deleted from here, so a whole series can't go by accident.
      const ev = CalendarApp.getDefaultCalendar().getEventById(req.id);
      if (!ev) return out({ ok: false, error: 'not found' });
      if (ev.isRecurringEvent()) return out({ ok: false, error: 'repeating event' });
      ev.deleteEvent();
      return out({ ok: true });
    }
    if (req.action === 'move_event') {
      // Change a call's time from the Calls panel, keeping its length.
      const ev = CalendarApp.getDefaultCalendar().getEventById(req.id);
      if (!ev) return out({ ok: false, error: 'not found' });
      if (ev.isRecurringEvent()) return out({ ok: false, error: 'repeating event' });
      const len = ev.getEndTime().getTime() - ev.getStartTime().getTime();
      const start = new Date(req.start);
      ev.setTime(start, new Date(start.getTime() + len));
      return out({ ok: true, start: start.toISOString(), end: new Date(start.getTime() + len).toISOString() });
    }
    if (req.action === 'list_event_colors') {
      // The colour each event has in Google Calendar — the private feed the
      // dashboard reads leaves colours out. Read-only.
      const cal = CalendarApp.getDefaultCalendar();
      const evs = cal.getEvents(new Date(req.start), new Date(req.end));
      return out({
        ok: true,
        calendar_color: cal.getColor(),
        events: evs.map(function (ev) {
          return { id: ev.getId(), start: ev.getStartTime().toISOString(), color: ev.getColor() };
        }),
      });
    }
    return out({ ok: false, error: 'unknown action' });
  } catch (err) {
    return out({ ok: false, error: String(err) });
  }
}

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function out(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

// Run once from the editor to grant the Calendar permission.
function authorize() { CalendarApp.getDefaultCalendar(); }
