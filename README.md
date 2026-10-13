# clef-triage

Triage unread IMAP email with **Clef-flash**, Cloudflare's 9B *System One*
decision model, running locally on a 12 GB RTX 3060.

Companion code for the article
[Clef-flash: a model that decides, not writes](https://usarral.com/en/posts/clef-flash-email-triage/)
([Spanish version](https://usarral.com/es/posts/clef-flash-email-triage-es/)).

A System One model does not generate text. It receives the email as `state`
plus typed questions and returns probabilities for every option in **a single
forward pass**:

| Question          | Type     | Output                                                            |
|-------------------|----------|-------------------------------------------------------------------|
| `categoria`       | `choice` | facturacion · soporte · ventas · notificaciones · personal · otro |
| `prioridad`       | `score`  | Informativo · Normal · Alta · Crítica                             |
| `es_ruido`        | `noul`   | p(yes): bulk / promotional                                        |
| `sospechoso`      | `noul`   | p(yes): phishing / fraud                                          |
| `requiere_accion` | `noul`   | p(yes): recipient must act                                        |

Label values are in Spanish because they match the Spanish test corpus.

Each message gets IMAP keywords (`$Clef_soporte`, `$Clef_prio_alta`, ...) and,
depending on `--target`, Gmail labels (`Clef/Soporte`, `Clef/Prioridad/Alta`,
...) or a folder move. Uncertain decisions go to `Clef/Revisar`. Messages are
never marked as read, and `$ClefTriaged` makes reruns idempotent.

## Results (246 synthetic emails, question set v3)

| | Flash 9B (RTX 3060, q8) | Flash 9B (Workers AI) | Clef 27B (Workers AI) |
|---|---|---|---|
| Category | 89.4% | 87.8% | 87.8% |
| Priority | 77.2% | 75.2% | 78.0% |
| Noise | 94.3% | 94.3% | 95.1% |
| Suspicious | 89.4% | 89.0% | 88.2% |
| Requires action | 91.1% | 91.5% | 95.9% |
| Sent to review | 53 | 58 | 30 |
| Latency p50 | 1.34 s | 0.31 s | 0.31 s |

Every iteration of the questions and its errors is explained in the article.
Every run's console output and raw
probabilities are in [runs/](runs/). The synthetic test corpus with its gold
labels is in [corpus/](corpus/).

## Architecture

```
src/
  domain.ts                 Email, Classification, Category, Priority (no dependencies)
  ports.ts                  MailSource · EmailClassifier · MailLabeler
  triage/service.ts         TriageService: read → classify → label
  triage/questions.ts       the System One question set (the "prompt")
  triage/classifier.ts      SystemOneClassifier + DecisionPolicy (thresholds)
  triage/routing.ts         pure rules: classification → folder / keywords / labels
  system-one/               typed HTTP client for /v1/systemone
  mail/imap.ts              ImapSource, KeywordLabeler, GmailLabelLabeler, FolderLabeler (imapflow)
  mail/local.ts             EmlDirectorySource, NullLabeler (offline work)
  evaluation/evaluate.ts    metrics against gold labels
  run-log.ts                per-run .log + .jsonl under runs/
  cli.ts                    composition root
scripts/load-corpus.ts      loads corpus/eml into an IMAP mailbox as unread mail
corpus/                     246 synthetic emails + gold labels
runs/                       logs and raw probabilities of every run
```

Node 24 runs the TypeScript sources directly (type stripping), so there is no
build step. `npm run typecheck` runs `tsc` without emitting.

## Setup

Requirements: Node 24+ and a System One endpoint.

**Local, with Ollama (≥ 0.35.1):**

```bash
ollama pull clef-flash
ollama serve
```

**Or Cloudflare Workers AI:** set `SYSTEMONE_URL` to
`https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/ai/run/@cf/cloudflare/clef-flash`
(or `.../clef`), `SYSTEMONE_MODEL` to `clef-flash` (or `clef`) and
`SYSTEMONE_API_KEY` to a Workers AI token.

```bash
npm install
cp .env.example .env            # System One endpoint + IMAP settings
```

## Usage

```bash
npm run corpus:load -- --dry-run                # load the test corpus into the mailbox (drop --dry-run to do it)
npm run ping                                    # is the model server up?
npm run evaluate -- --tag my-run                # .eml corpus vs gold labels, mailbox untouched
npm run triage -- --dry-run --limit 10          # classify without touching the mailbox
npm run triage -- --target labels               # labels (Gmail) | folders | none
npm run cli -- score --run runs/<triage-run>.jsonl   # score a live run against gold
npm test
```

`evaluate` and `score` use `corpus/` by default (see [corpus/README.md](corpus/README.md)
for the format). Point them at your own data with `--eml-dir` and `--gold`.

Run logs from before the repository was reorganized still show the old
`../corpus/...` paths in their headers.

## License

MIT
