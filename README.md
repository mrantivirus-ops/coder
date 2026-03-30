# CLS Key Stack Editor (VS Code Extension)

This extension gives you three things in VS Code:

1. **Stack API keys** (save multiple named keys securely).
2. **Chat in extension UI** using Puter AI with Claude model `claude-sonnet-4-6`.
3. **Apply file edits** from structured JSON.

## Commands

- `CLS: Add API Key` (`cls.addApiKey`)
- `CLS: Select Active API Key` (`cls.selectActiveApiKey`)
- `CLS: Remove API Key` (`cls.removeApiKey`)
- `CLS: List API Keys` (`cls.listApiKeys`)
- `CLS: Open Chat (Puter Claude)` (`cls.openChat`)
- `CLS: Apply File Edits` (`cls.applyEdits`)

## Entering API keys through chat

Open `CLS: Open Chat (Puter Claude)` and use these commands directly in chat input:

- `/setkey <name> <key>` — saves key and makes it active.
- `/usekey <name>` — switches active key.
- `/keys` — lists saved keys.

After that, normal prompts are sent to Puter chat.

## Puter Claude usage

The webview uses the same Puter JavaScript SDK pattern you shared:

```html
<script src="https://js.puter.com/v2/"></script>
<script>
  puter.ai.chat("Explain quantum computing in simple terms", { model: 'claude-sonnet-4-6' })
</script>
```

In this extension, the model call happens inside the VS Code webview. If an active key exists, it is also passed as `apiKey`.

## Apply file edits

Run `CLS: Apply File Edits` and pass JSON like:

```json
[
  {
    "path": "notes/todo.txt",
    "content": "hello from cls"
  },
  {
    "path": "src/config.json",
    "content": "{\n  \"enabled\": true\n}"
  }
]
```

The command creates parent folders if needed and writes file contents directly.

## Safety

By default, edits are constrained to the current workspace folder.
Set `cls.allowOutsideWorkspace` to `true` if you explicitly want to allow outside paths.

## How to make this an installable VS Code extension

1. Install packaging tool globally:
   - `npm i -g @vscode/vsce`
2. From this folder, build VSIX:
   - `vsce package`
3. In VS Code:
   - Open Extensions view
   - `...` menu → **Install from VSIX...**
   - Choose generated `.vsix` file

## Do we use an API?

Yes. Chat uses Puter AI (`puter.ai.chat`) in the extension webview, with model `claude-sonnet-4-6`. Your stacked key can be routed as `apiKey` when present.
