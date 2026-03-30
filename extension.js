const vscode = require('vscode');
const fs = require('fs/promises');
const path = require('path');

const KEY_STACK_SECRET = 'cls.apiKeyStack';
const ACTIVE_KEY_SECRET = 'cls.activeApiKey';

async function getKeyStack(context) {
  const raw = await context.secrets.get(KEY_STACK_SECRET);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => item && typeof item.name === 'string' && typeof item.key === 'string');
  } catch {
    return [];
  }
}

async function saveKeyStack(context, stack) {
  await context.secrets.store(KEY_STACK_SECRET, JSON.stringify(stack));
}

async function getActiveKeyName(context) {
  return (await context.secrets.get(ACTIVE_KEY_SECRET)) || '';
}

async function setActiveKeyName(context, name) {
  if (!name) {
    await context.secrets.delete(ACTIVE_KEY_SECRET);
    return;
  }
  await context.secrets.store(ACTIVE_KEY_SECRET, name);
}

async function getActiveKeyValue(context) {
  const activeName = await getActiveKeyName(context);
  if (!activeName) return '';

  const stack = await getKeyStack(context);
  return stack.find((item) => item.name === activeName)?.key || '';
}

async function upsertApiKey(context, name, key, makeActive) {
  const stack = await getKeyStack(context);
  const existingIndex = stack.findIndex((item) => item.name === name);

  if (existingIndex >= 0) {
    stack[existingIndex] = { name, key };
  } else {
    stack.push({ name, key });
  }

  await saveKeyStack(context, stack);
  if (makeActive) {
    await setActiveKeyName(context, name);
  }
}

async function addApiKey(context) {
  const name = await vscode.window.showInputBox({
    prompt: 'Name this API key (example: claude-free)',
    ignoreFocusOut: true,
    validateInput: (value) => (value?.trim() ? null : 'Name is required')
  });
  if (!name) return;

  const key = await vscode.window.showInputBox({
    prompt: `Enter API key for '${name}'`,
    password: true,
    ignoreFocusOut: true,
    validateInput: (value) => (value?.trim() ? null : 'API key is required')
  });
  if (!key) return;

  const normalizedName = name.trim();
  await upsertApiKey(context, normalizedName, key.trim(), false);

  const makeActive = await vscode.window.showQuickPick(['Yes', 'No'], {
    title: `Set '${normalizedName}' as active key?`,
    placeHolder: 'Choose one'
  });

  if (makeActive === 'Yes') {
    await setActiveKeyName(context, normalizedName);
  }

  vscode.window.showInformationMessage(`CLS stored key '${normalizedName}'.`);
}

async function selectActiveApiKey(context) {
  const stack = await getKeyStack(context);
  if (stack.length === 0) {
    vscode.window.showWarningMessage('No API keys are stored yet. Run CLS: Add API Key first.');
    return;
  }

  const active = await getActiveKeyName(context);
  const selected = await vscode.window.showQuickPick(
    stack.map((item) => ({
      label: item.name,
      description: item.name === active ? 'active' : ''
    })),
    { title: 'Select active API key' }
  );

  if (!selected) return;
  await setActiveKeyName(context, selected.label);
  vscode.window.showInformationMessage(`Active API key set to '${selected.label}'.`);
}

async function removeApiKey(context) {
  const stack = await getKeyStack(context);
  if (stack.length === 0) {
    vscode.window.showWarningMessage('No API keys are stored.');
    return;
  }

  const selected = await vscode.window.showQuickPick(stack.map((item) => item.name), {
    title: 'Select API key to remove'
  });

  if (!selected) return;

  const filtered = stack.filter((item) => item.name !== selected);
  await saveKeyStack(context, filtered);

  const active = await getActiveKeyName(context);
  if (active === selected) {
    await setActiveKeyName(context, filtered[0]?.name || '');
  }

  vscode.window.showInformationMessage(`Removed key '${selected}'.`);
}

async function listApiKeys(context) {
  const stack = await getKeyStack(context);
  const active = await getActiveKeyName(context);

  if (stack.length === 0) {
    vscode.window.showInformationMessage('No API keys saved.');
    return;
  }

  const labels = stack.map((item) => (item.name === active ? `${item.name} (active)` : item.name));
  vscode.window.showInformationMessage(`CLS keys: ${labels.join(', ')}`);
}

function resolvePath(inputPath, workspaceFolder, allowOutsideWorkspace) {
  if (path.isAbsolute(inputPath)) {
    if (allowOutsideWorkspace) return inputPath;
    if (!workspaceFolder) {
      throw new Error('Absolute paths require an open workspace or enabling cls.allowOutsideWorkspace.');
    }

    const rel = path.relative(workspaceFolder.uri.fsPath, inputPath);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error('Path is outside workspace and cls.allowOutsideWorkspace is false.');
    }
    return inputPath;
  }

  if (!workspaceFolder) {
    if (!allowOutsideWorkspace) {
      throw new Error('Relative paths require a workspace folder unless cls.allowOutsideWorkspace is true.');
    }
    return path.resolve(process.cwd(), inputPath);
  }

  return path.resolve(workspaceFolder.uri.fsPath, inputPath);
}

async function applyEdits() {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  const allowOutsideWorkspace = vscode.workspace.getConfiguration('cls').get('allowOutsideWorkspace', false);

  const input = await vscode.window.showInputBox({
    title: 'CLS Apply File Edits',
    prompt: 'Paste JSON array: [{"path":"src/file.ts","content":"new content"}]',
    ignoreFocusOut: true,
    validateInput: (value) => {
      if (!value?.trim()) return 'Input is required';
      try {
        const parsed = JSON.parse(value);
        if (!Array.isArray(parsed)) return 'Input must be a JSON array';
        for (const item of parsed) {
          if (!item || typeof item.path !== 'string' || typeof item.content !== 'string') {
            return 'Each item must include string fields: path and content';
          }
        }
        return null;
      } catch {
        return 'Invalid JSON';
      }
    }
  });

  if (!input) return;

  const edits = JSON.parse(input);
  const failures = [];

  for (const edit of edits) {
    try {
      const filePath = resolvePath(edit.path, workspaceFolder, allowOutsideWorkspace);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, edit.content, 'utf8');
    } catch (error) {
      failures.push(`${edit.path}: ${error.message}`);
    }
  }

  if (failures.length > 0) {
    vscode.window.showErrorMessage(`Some edits failed: ${failures.join(' | ')}`);
    return;
  }

  vscode.window.showInformationMessage(`Applied ${edits.length} file edit(s).`);
}

function getChatHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline' https://js.puter.com; connect-src https:;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>CLS Chat</title>
  <style>
    body { font-family: sans-serif; margin: 16px; }
    .row { margin-bottom: 10px; }
    textarea { width: 100%; min-height: 120px; }
    input, select, button { width: 100%; padding: 8px; box-sizing: border-box; }
    button { cursor: pointer; }
    #output { white-space: pre-wrap; border: 1px solid #555; padding: 10px; min-height: 160px; }
    .small { opacity: 0.8; font-size: 12px; }
  </style>
</head>
<body>
  <h2>CLS Chat (Puter + Claude)</h2>
  <div class="row small">Tip: You can also enter keys inside chat using: <code>/setkey name your_api_key</code> then <code>/usekey name</code>.</div>
  <div class="row">
    <label>Model</label>
    <select id="model">
      <option value="claude-sonnet-4-6" selected>claude-sonnet-4-6</option>
    </select>
  </div>
  <div class="row">
    <label>Prompt</label>
    <textarea id="prompt" placeholder="Ask Claude something, or run /setkey name key"></textarea>
  </div>
  <div class="row"><button id="send">Send</button></div>
  <div class="row"><div id="output">Waiting for input...</div></div>

  <script src="https://js.puter.com/v2/"></script>
  <script>
    const vscode = acquireVsCodeApi();
    const promptEl = document.getElementById('prompt');
    const outputEl = document.getElementById('output');
    const modelEl = document.getElementById('model');

    let activeKeyValue = '';
    vscode.postMessage({ type: 'requestActiveKey' });

    function setOutput(value) {
      outputEl.textContent = value;
    }

    function parseCommand(text) {
      const trimmed = text.trim();
      if (!trimmed.startsWith('/')) return null;

      if (trimmed.startsWith('/setkey ')) {
        const parts = trimmed.split(' ');
        if (parts.length < 3) return { type: 'invalid', message: 'Usage: /setkey <name> <key>' };
        const name = parts[1];
        const key = parts.slice(2).join(' ');
        return { type: 'setkey', name, key };
      }

      if (trimmed.startsWith('/usekey ')) {
        const name = trimmed.replace('/usekey ', '').trim();
        if (!name) return { type: 'invalid', message: 'Usage: /usekey <name>' };
        return { type: 'usekey', name };
      }

      if (trimmed === '/keys') {
        return { type: 'keys' };
      }

      return { type: 'invalid', message: 'Unknown command. Try /setkey, /usekey, /keys.' };
    }

    async function sendPrompt() {
      const rawPrompt = promptEl.value.trim();
      if (!rawPrompt) return;

      const command = parseCommand(rawPrompt);
      if (command) {
        if (command.type === 'invalid') {
          setOutput(command.message);
          return;
        }
        vscode.postMessage({ type: 'command', command });
        setOutput('Running command...');
        return;
      }

      try {
        setOutput('Calling Puter AI...');
        const response = await puter.ai.chat(rawPrompt, {
          model: modelEl.value,
          apiKey: activeKeyValue || undefined
        });

        const text = response?.message?.content?.[0]?.text || JSON.stringify(response, null, 2);
        setOutput(text);
      } catch (error) {
        setOutput('Chat failed: ' + (error?.message || String(error)));
      }
    }

    document.getElementById('send').addEventListener('click', sendPrompt);

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type === 'activeKey') {
        activeKeyValue = msg.value || '';
      }

      if (msg.type === 'commandResult') {
        setOutput(msg.message);
        if (msg.activeKeyValue !== undefined) {
          activeKeyValue = msg.activeKeyValue || '';
        }
      }
    });
  </script>
</body>
</html>`;
}

function openChatPanel(context) {
  const panel = vscode.window.createWebviewPanel('clsChat', 'CLS Chat', vscode.ViewColumn.One, {
    enableScripts: true
  });

  panel.webview.html = getChatHtml();

  panel.webview.onDidReceiveMessage(async (message) => {
    if (message?.type === 'requestActiveKey') {
      const active = await getActiveKeyValue(context);
      panel.webview.postMessage({ type: 'activeKey', value: active });
      return;
    }

    if (message?.type !== 'command' || !message.command) return;

    const cmd = message.command;
    if (cmd.type === 'setkey') {
      await upsertApiKey(context, cmd.name, cmd.key, true);
      const activeKeyValue = await getActiveKeyValue(context);
      panel.webview.postMessage({
        type: 'commandResult',
        message: `Saved key '${cmd.name}' and made it active.`,
        activeKeyValue
      });
      return;
    }

    if (cmd.type === 'usekey') {
      const stack = await getKeyStack(context);
      const exists = stack.some((item) => item.name === cmd.name);
      if (!exists) {
        panel.webview.postMessage({
          type: 'commandResult',
          message: `No key named '${cmd.name}' found.`
        });
        return;
      }

      await setActiveKeyName(context, cmd.name);
      const activeKeyValue = await getActiveKeyValue(context);
      panel.webview.postMessage({
        type: 'commandResult',
        message: `Now using key '${cmd.name}'.`,
        activeKeyValue
      });
      return;
    }

    if (cmd.type === 'keys') {
      const stack = await getKeyStack(context);
      const active = await getActiveKeyName(context);
      if (stack.length === 0) {
        panel.webview.postMessage({ type: 'commandResult', message: 'No keys saved.' });
        return;
      }

      const summary = stack
        .map((item) => (item.name === active ? `${item.name} (active)` : item.name))
        .join(', ');
      panel.webview.postMessage({ type: 'commandResult', message: `Saved keys: ${summary}` });
    }
  });
}

function register(context, command, handler) {
  context.subscriptions.push(vscode.commands.registerCommand(command, handler));
}

function activate(context) {
  register(context, 'cls.addApiKey', () => addApiKey(context));
  register(context, 'cls.selectActiveApiKey', () => selectActiveApiKey(context));
  register(context, 'cls.removeApiKey', () => removeApiKey(context));
  register(context, 'cls.listApiKeys', () => listApiKeys(context));
  register(context, 'cls.applyEdits', applyEdits);
  register(context, 'cls.openChat', () => openChatPanel(context));
}

function deactivate() {}

module.exports = {
  activate,
  deactivate
};
