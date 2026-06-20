# substack-scraper

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts
```

## API

### `POST /v1/scrape/substack-post`

Scrapes a single Substack post and returns its content as structured JSON.

```bash
curl -X POST http://localhost:3000/v1/scrape/substack-post \
    -H "Content-Type: application/json" \
    -d '{"url":"https://kristybanks.substack.com/p/how-practicing-took-these-educators"}'
```

This project was created using `bun init` in bun v1.3.14. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
