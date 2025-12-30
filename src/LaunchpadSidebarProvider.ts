import * as vscode from 'vscode';

export class LaunchpadSidebarProvider implements vscode.WebviewViewProvider {
    constructor(private readonly _extensionUri: vscode.Uri) { }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <style>
                    body { font-family: sans-serif; padding: 10px; color: var(--vscode-foreground); }
                    .card { background: var(--vscode-sideBar-background); border: 1px solid var(--vscode-panel-border); border-radius: 6px; padding: 12px; margin-bottom: 12px; }
                    .title { font-weight: bold; margin-bottom: 8px; color: #667eea; }
                    .btn { background: #667eea; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; width: 100%; margin-top: 8px; }
                    .btn:hover { background: #764ba2; }
                    .status { font-size: 11px; margin-top: 4px; opacity: 0.8; }
                </style>
            </head>
            <body>
                <div class="card">
                    <div class="title">🚀 Launchpad Control</div>
                    <div class="status">Pre-flight checks passing...</div>
                    <button class="btn">Ship Patch</button>
                    <button class="btn" style="background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground);">Audit Package</button>
                </div>
                
                <div class="card" style="background: linear-gradient(135deg, rgba(102, 126, 234, 0.1), rgba(118, 75, 162, 0.1));">
                    <div style="font-size: 11px; font-weight: 600; color: var(--vscode-foreground); margin-bottom: 8px;">🧩 NexGen-Meta Ecosystem</div>
                    <div style="font-size: 11px; color: var(--vscode-descriptionForeground);">
                        Manage your extensions like a pro with Launchpad.
                    </div>
                </div>
            </body>
            </html>`;
    }
}
