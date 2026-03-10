# jsfd

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
npm install -g jsfd
```

### Local installation

```bash
npm install jsfd
```

### Use via npx (no installation)

```bash
npx jsfd <command>
```

## Configuration

Before using jsfd, you need to configure your Feishu app credentials.

### Option 1: Environment variables

Set the following environment variables:

```bash
export FEISHU_APP_ID="your_app_id"
export FEISHU_APP_SECRET="your_app_secret"
```

### Option 2: Configuration file

Create a `jsfd.json` or `config.json` file in:
- Current working directory
- `~/.jsfd/config.json`

```json
{
  "app_id": "your_app_id",
  "app_secret": "your_app_secret"
}
```

### Option 3: .env file

Create a `.env` file in:
- Current working directory
- `~/.jsfd/.env`
- `~/.env`

```
FEISHU_APP_ID=your_app_id
FEISHU_APP_SECRET=your_app_secret
```

## CLI Usage

### Read a document

```bash
# Read a document (cached as markdown/csv with images)
jsfd read <token_or_url>
```

### Export a document

```bash
# Export to current directory
jsfd export <token_or_url>

# Export to specific directory
jsfd export <token_or_url> -o ./output
jsfd export <token_or_url> --output-dir ./output
```

### List Wiki children

```bash
jsfd list <wiki_token_or_url>
# or
jsfd list-children <wiki_token_or_url>
```

### Search Wiki

```bash
jsfd search "search query" <wiki_token_or_url>
```

### Resolve a token

```bash
jsfd resolve <token_or_url>
```

### Create a document

```bash
jsfd create "Document Title"
jsfd create "Document Title" --folder <folder_token>
```

### Write to a document

```bash
jsfd write <token_or_url> "Content to write"
```

### Append to a document

```bash
jsfd append <token_or_url> "Content to append"
```

### Help

```bash
jsfd --help
jsfd <command> --help
```

## Node.js API Usage

```javascript
const jsfd = require('jsfd');

// Read a document
const doc = await jsfd.readDoc('doc_token_or_url');
console.log(doc);

// Export a document
const result = await jsfd.exportDoc('doc_token_or_url', './output');

// List wiki children
const children = await jsfd.listChildren('wiki_token');

// Search wiki
const results = await jsfd.searchWiki('query', 'wiki_token');

// Create a document
const newDoc = await jsfd.createDoc('My Document');

// Write to a document
await jsfd.writeDoc('doc_token', '# Hello\n\nWorld');

// Append to a document
await jsfd.appendDoc('doc_token', 'More content');
```

## Cache

jsfd caches downloaded content and access tokens in:
- `~/.jsfd/cache/` - Cached documents and assets
- `~/.jsfd/cache/feishu_token.json` - Cached access token

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
