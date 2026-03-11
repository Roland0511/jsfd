# jafd

> Just Another Feishu Doc Converter

A CLI tool and Node.js library for fetching and converting Feishu (Lark) Wiki/Doc/Sheet/Bitable content to Markdown and CSV.

## Features

- **Read documents**: Fetch content from Docs, Sheets, Bitable, and Wiki with automatic image download
- **Export**: Convert documents to Markdown with images, or sheets to CSV
- **List children**: List child nodes of a Wiki space
- **Search**: Search Wiki nodes by keyword
- **Write/Append**: Write content to Feishu documents
- **Create**: Create new Feishu documents

## Installation

### Global installation (recommended for CLI use)

```bash
npm install -g @roland0511/jafd
```

### Local installation

```bash
npm install @roland0511/jafd
```

### Use via npx (no installation)

```bash
npx @roland0511/jafd <command>
```

## Configuration

Before using jafd, you need to configure your Feishu app credentials.

### Option 1: Environment variables

Set the following environment variables:

```bash
export FEISHU_APP_ID="your_app_id"
export FEISHU_APP_SECRET="your_app_secret"
```

### Option 2: Configuration file

Create a `jafd.json` or `config.json` file in:
- Current working directory
- `~/.jafd/config.json`

```json
{
  "app_id": "your_app_id",
  "app_secret": "your_app_secret"
}
```

### Option 3: .env file

Create a `.env` file in:
- Current working directory
- `~/.jafd/.env`
- `~/.env`

```
FEISHU_APP_ID=your_app_id
FEISHU_APP_SECRET=your_app_secret
```

## CLI Usage

### Read a document

```bash
# Read a document (cached as markdown/csv with images)
jafd read <token_or_url>
```

### Export a document

```bash
# Export to current directory
jafd export <token_or_url>

# Export to specific directory
jafd export <token_or_url> -o ./output
jafd export <token_or_url> --output-dir ./output
```

### List Wiki children

```bash
jafd list <wiki_token_or_url>
# or
jafd list-children <wiki_token_or_url>
```

### Search Wiki

```bash
jafd search "search query" <wiki_token_or_url>
```

### Resolve a token

```bash
jafd resolve <token_or_url>
```

### Create a document

```bash
jafd create "Document Title"
jafd create "Document Title" --folder <folder_token>
```

### Write to a document

```bash
jafd write <token_or_url> "Content to write"
```

### Append to a document

```bash
jafd append <token_or_url> "Content to append"
```

### Help

```bash
jafd --help
jafd <command> --help
```

## Node.js API Usage

```javascript
const jafd = require('@roland0511/jafd');

// Read a document
const doc = await jafd.readDoc('doc_token_or_url');
console.log(doc);

// Export a document
const result = await jafd.exportDoc('doc_token_or_url', './output');

// List wiki children
const children = await jafd.listChildren('wiki_token');

// Search wiki
const results = await jafd.searchWiki('query', 'wiki_token');

// Create a document
const newDoc = await jafd.createDoc('My Document');

// Write to a document
await jafd.writeDoc('doc_token', '# Hello\n\nWorld');

// Append to a document
await jafd.appendDoc('doc_token', 'More content');
```

## Cache

jafd caches downloaded content and access tokens in:
- `~/.jafd/cache/` - Cached documents and assets
- `~/.jafd/cache/feishu_token.json` - Cached access token

The cache is valid for 1 hour.

## Supported Document Types

- Wiki spaces
- Docx documents (new format)
- Doc documents (old format)
- Sheets
- Bitable

## How to get Feishu App ID and Secret

1. Go to [Feishu Open Platform](https://open.feishu.cn/)
2. Create a new app
3. Get your App ID and App Secret from the app settings
4. Enable the necessary APIs (Document, Sheet, Wiki, etc.)

## License

MIT
