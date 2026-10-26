// Google Apps Script — the app's bridge to Google Docs (replaces Make's Google
// Docs modules). Paste into a new project at script.google.com, set TOKEN to the
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
    return out({ ok: false, error: 'unknown action' });
  } catch (err) {
    return out({ ok: false, error: String(err) });
  }
}

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function out(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
