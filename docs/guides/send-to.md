# Send to

Send a model's file from its page straight to your printer, a webhook or any address you like: OctoPrint, Klipper,
PrusaLink, Home Assistant, n8n, Node-RED, or a link or request of your own. Set them up under **Configuration → Send
to**, from the user menu. Each person has their own.

Each destination shows either as **its own button** under the model's Open button, or **in the menu** beside it, under
**Send to**. It sends the file picked in the model's **Files** box, and it's offered only for the file types you give
it: a printer starts with `gcode`, so it doesn't turn up on a 3MF.

## Printers and webhooks

| Preset         | What it needs                                                          | What it does                                                |
| -------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------- |
| OctoPrint      | The address, and an API key (OctoPrint → Settings → Application Keys)  | Uploads to OctoPrint, and starts printing if you ask it to  |
| Klipper        | Moonraker's address, usually port `7125`; an API key only if it asks   | Uploads to Mainsail's or Fluidd's printer, and can start it |
| PrusaLink      | The printer's address and its API key (on the printer, under Network)  | Puts the file on the printer's USB drive, and can start it  |
| Home Assistant | The webhook's address, `http://homeassistant.local:8123/api/webhook/…` | Triggers a webhook automation                               |
| n8n, Node-RED  | The webhook's address                                                  | Triggers a workflow, or an `http in` node                   |

**Test**, in a destination's settings, checks it answers without sending anything: a printer's version, or a test event
to a webhook (`{"event": "thingport.test", "test": true}`).

A webhook gets JSON with a link to the file, which works for an hour without signing in:

```json
{
  "event": "thingport.send",
  "file_url": "http://thingport.local/api/send-file/…/bracket.gcode",
  "filename": "bracket.gcode",
  "file_kind": "plate",
  "plate_id": "…",
  "model": { "id": "…", "name": "Corner bracket", "url": "http://thingport.local/models/…", "source_url": null },
  "sent_by": "Ann",
  "sent_at": "2026-11-16T14:20:00.000Z"
}
```

## Your own

A **custom link** is an address the browser opens, in a new tab, a named tab that's reused, or this tab. A page in a
named tab can also send Thingport's tab to another address, so pick a named tab only for an address you trust, and look
at the links in a file before you import it. An app's own address works too, such as `myslicer://open?file={file_url}`.
A **custom request** is made by Thingport's server: a `POST` or `PUT` with the file in a form, the file itself as the
body, or JSON as above, with headers of your own. Thingport sets `Host`, `Content-Type`, `Content-Length`, `Connection`
and `Transfer-Encoding` itself, and never sends a `Cookie`, so those can't be added. Mark a header **Secret** and its
value stays on the server, never shown again. **Then open** offers an address once it's sent, such as the printer's own
page. **Test** tries the settings as they are in the editor, before you save them.

These are filled in when you send, encoded for an address. They go in the path or the query, never in the host:

| Placeholder    | What it is                                                   |
| -------------- | ------------------------------------------------------------ |
| `{file_url}`   | A link to just this file, for an hour, that needs no sign-in |
| `{filename}`   | The file's name                                              |
| `{model_name}` | The model's name                                             |
| `{model_id}`   | The model's id, and `{model_url}` its page in Thingport      |
| `{plate_id}`   | The file's id, empty for a model's prepared print            |
| `{source_url}` | The page it was imported from, if it was                     |

A slicer running in a browser tab, such as a container's web desktop, can't be handed a file by link. Send the file to
something that drops it into a folder the container sees, an n8n workflow say, and set **Then open** to the slicer's
page.

## Sharing a setup

**Export**, in the panel's menu, saves your destinations as a file, without any API key or secret header. **Import**
adds the ones in such a file to yours; fill in their keys afterwards.

## What it can reach

Requests come from Thingport's server, so they reach printers and services on your local network, plain http
addresses included. They never go to a cloud metadata address and never follow a redirect, and `javascript:` and
`data:` addresses aren't allowed in a link.
