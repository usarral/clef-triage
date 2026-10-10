# Corpus

246 **synthetic** emails, mostly in Spanish, written for this experiment. Every
name, company, address and domain is fictitious (`.example` domains); none of
it comes from a real mailbox.

- `eml/<id>.eml`: the raw RFC 822 messages, as loaded into the test mailbox.
- `emails.jsonl`: one record per email with its gold labels.

```json
{
  "id": "fact-001",
  "message_id": "<fact-001@clef-triage.example>",
  "sender": "\"Logística Mediterráneo\" <no-reply@logistica-med.example>",
  "subject": "Su factura F-2026-4470 ya está disponible",
  "date": "2026-09-10T09:43:00+00:00",
  "tags": [],
  "gold": {
    "categoria": "facturacion",
    "prioridad": "Informativo",
    "es_ruido": false,
    "sospechoso": false,
    "requiere_accion": false
  }
}
```

`tags` marks the hard subsets: `ambiguo` (24), `en` (12, in English),
`inyeccion` (10, prompt injection attempts) and `largo` (6, long emails). The
corpus was generated from templates, so there are fewer truly distinct cases
than emails.

Load it into a mailbox as unread messages with:

```bash
npm run corpus:load -- --dry-run
npm run corpus:load
```
