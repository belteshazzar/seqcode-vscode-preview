// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = require('vscode');
const seqcode = require('seqcode');
const path = require('path');

function getNonce() {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {

  let disposed = false;
  let statusBarItem = null;
  let panel = null;
  let editorForDiagram = null;

  function getWebviewContent(scriptUri) {
    const nonce = getNonce();

    // https://code.visualstudio.com/api/extension-guides/webview#scripts-and-message-passing

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SeqCode Preview</title>
  <!--
    Use a content security policy to only allow loading styles from our extension directory,
    and only allow scripts that have a specific nonce.
    (See the 'webview-sample' extension sample for img-src content security policy examples)
  -->
  <meta
    http-equiv="Content-Security-Policy"
    content="default-src 'none'; img-src ${panel.webview.cspSource} https:; script-src 'unsafe-inline' ${panel.webview.cspSource}; style-src ${panel.webview.cspSource} 'unsafe-inline';"
  />
  <style>
    #preview {
      padding: 5px;
      width: 100%;
      justify-content: left;
      display: flex;
    }
  </style>
</head>
<body>
  <div id="preview"></div>

  <script type="module">
    import seqcode from '${scriptUri}';

    let src = '';
    const vscode = acquireVsCodeApi();
    const el = document.getElementById('preview');
    const linkHandler = {
      href: (link) => '#',
      target: (link) => '',
      onclick: (link) => \`clickLink(decodeURIComponent("\${encodeURIComponent(link)}"))\`
    };

    const lightTheme = {
      foreground: '#666',
      noteFontFamily: '"Patrick Hand", cursive',
      noteFontSize: 15,
      linkHandler,
    }

    const darkTheme = {
      background: '#1e1e1e',
      foreground: '#d4d4d4',
      noteLight: '#FFFDA1',
      noteDark: '#FFEB5B',
      noteStroke: '#ccc',
      noteFontFamily: '"Patrick Hand", cursive',
      noteFontSize: 15,
      noteForeground: '#0000CD',
      fillLight: '#333',
      fillDark: '#444',
      linkIconColor: "#999",
      linkHandler,
    }

    function render() {
      const isDark = document.body.classList.contains("vscode-dark")
      el.innerHTML = ''; // Clear previous content
      el.appendChild(seqcode(src, isDark ? darkTheme : lightTheme).svg.node);
    }

    window.addEventListener('message', event => {
        const message = event.data;
        if (message.type === 'render') {
          src = message.source;
          render();
        } else if (message.type === 'rerender') {
          render();
        }
    });

    window.clickLink = function(link) {
      vscode.postMessage({
        type: 'link',
        link
      })
    }

    render();
  </script>
</body>
</html>`;
  }

  function initPreview(viewColumn) {
    if (vscode.window.activeTextEditor.document.languageId.toLowerCase() != 'seqcode') return

    // Create and show a new webview
    panel = vscode.window.createWebviewPanel(
      'liveHTMLPreviewer',
      'SeqCode Preview',
      viewColumn,
      {
        // Enable scripts in the webview
        enableScripts: true,
        retainContextWhenHidden: true,
        // And restrict the webview to only loading content from our extension's `assets` directory.
        // localResourceRoots: [vscode.Uri.file(path.join(this.context.extensionPath, 'assets')), vscode.Uri.file(path.join(vscode.workspace.rootPath, 'content/media'))]
      }
    );

    panel.iconPath = iconPath()
    const scriptUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'node_modules', 'seqcode', 'dist', 'seqcode.js'));
    panel.webview.html = getWebviewContent(scriptUri);

    panel.webview.onDidReceiveMessage(
      message => {
        switch (message.type) {
          case 'link':
            const folder = vscode.workspace.getWorkspaceFolder(editorForDiagram.document.uri);
            const link = vscode.Uri.joinPath(folder.uri,message.link + '.seqcode');
            const column = editorForDiagram.viewColumn
            vscode.workspace.openTextDocument(link)
              .then(
                doc => vscode.window.showTextDocument(doc,column),
                err => vscode.window.showErrorMessage(`Error opening ink: ${link}`))
            return;
        }
      },
      undefined,
      context.subscriptions
    );

    handleTextDocumentChange()

    vscode.workspace.onDidChangeTextDocument(handleTextDocumentChange);
    vscode.workspace.onDidChangeConfiguration(handleTextDocumentChange);
    vscode.workspace.onDidSaveTextDocument(handleTextDocumentChange);
    vscode.window.onDidChangeActiveTextEditor(handleTextDocumentChange);

    panel.onDidDispose(() => {
      dispose();
    }, null, context.subscriptions);
  }

  function handleActiveEditorChanged() {
    const seqcodeConfig = vscode.workspace.getConfiguration('seqcode');
    let editor = vscode.window.activeTextEditor;
    if (!editor || !!seqcodeConfig.get('preview.showPreviewOptionInMenuBar')) {
        statusBarItem.hide();
        return;
    }

    // Update status if an seqcode file
    if (vscode.window.activeTextEditor.document.languageId.toLowerCase() == "seqcode") {
        statusBarItem.show();
    } else {
        statusBarItem.hide();
    }
  }

  function handleTextDocumentChange() {
    if (vscode.window.activeTextEditor 
      && vscode.window.activeTextEditor.document.languageId.toLowerCase() == 'seqcode' 
      && panel) {
      editorForDiagram = vscode.window.activeTextEditor
      postMessage({
        type: 'render',
        source: editorForDiagram.document.getText()
      });
    }
  }

  function iconPath() {
    const root = vscode.Uri.joinPath(vscode.Uri.file(context.extensionPath), 'assets','icons');
    return {
        light: vscode.Uri.file(vscode.Uri.joinPath(root, 'preview_right_light.svg')),
        dark: vscode.Uri.file(vscode.Uri.joinPath(root, 'preview_right_dark.svg'))
    };
  }

  function postMessage(msg) {
    if (!disposed && panel && panel.webview) {
      panel.webview.postMessage(msg);
    }
  }

  function handleThemeUpdated() {
    postMessage({
      type: 'rerender'
    });
  }

  function dispose() {
    if (disposed) {
      return;
    }
    panel.dispose();
    disposed = true;
  }

  //===================================================================

  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
  statusBarItem.command = "seqcode.sidePreview";
  statusBarItem.text = "Preview";
  statusBarItem.tooltip = "Open SeqCode Side Preview";
  handleActiveEditorChanged();

  let disposableSidePreview = vscode.commands.registerCommand('seqcode.sidePreview', () => {
    initPreview(vscode.ViewColumn.Two);
  });

  let disposableFullPreview = vscode.commands.registerCommand('seqcode.fullPreview', () => {
    initPreview(vscode.ViewColumn.One);
  });

  // Subscribe so that the statusBarItem gets updated
  let disposableStatusBar = vscode.window.onDidChangeActiveTextEditor(handleActiveEditorChanged, null, context.subscriptions);

  let disposableTheme = vscode.window.onDidChangeActiveColorTheme(handleThemeUpdated, null, context.subscriptions);

  // push to subscriptions list so that they are disposed automatically
  context.subscriptions.push(disposableSidePreview);
  context.subscriptions.push(disposableFullPreview);
  context.subscriptions.push(disposableStatusBar);
  context.subscriptions.push(disposableTheme);
}

// This method is called when your extension is deactivated
function deactivate() {}

module.exports = {
	activate,
	deactivate
}
