import * as vscode from 'vscode';
import { Validator } from './Validator';
import { Publisher } from './Publisher';
import { TokenVault } from './TokenVault';

export class LaunchpadSidebarProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;
    private _tokenVault: TokenVault;

    constructor(private readonly _context: vscode.ExtensionContext) {
        this._tokenVault = new TokenVault(_context.secrets);
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._context.extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {
                case 'audit':
                    this.runAudit();
                    break;
                case 'publish':
                    this.runPublish(data.value);
                    break;
                case 'saveToken':
                    await this._tokenVault.storeToken(data.value);
                    vscode.window.showInformationMessage('PAT saved securely in Token Vault.');
                    this.updateTokenStatus();
                    break;
                case 'checkToken':
                    this.updateTokenStatus();
                    break;
            }
        });

        this.updateTokenStatus();
    }

    private async updateTokenStatus() {
        const hasToken = await this._tokenVault.hasToken();
        this._view?.webview.postMessage({ type: 'tokenStatus', hasToken });
    }

    private async runAudit() {
        if (!vscode.workspace.workspaceFolders) return;
        const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
        const results = await Validator.validatePackageJson(root);

        this._view?.webview.postMessage({ type: 'auditResults', results });
    }

    private async runPublish(type: 'patch' | 'minor' | 'major') {
        if (!vscode.workspace.workspaceFolders) return;
        const root = vscode.workspace.workspaceFolders[0].uri.fsPath;

        vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Publishing ${type} update...`,
            cancellable: false
        }, async (progress) => {
            try {
                await Publisher.publish(type, root);
                vscode.window.showInformationMessage(`Successfully published ${type} update!`);
            } catch (err: any) {
                vscode.window.showErrorMessage(err.message);
            }
        });
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <style>
                    body { font-family: sans-serif; padding: 10px; color: var(--vscode-foreground); }
                    .card { background: var(--vscode-sideBar-background); border: 1px solid var(--vscode-panel-border); border-radius: 6px; padding: 12px; margin-bottom: 12px; position: relative; overflow: hidden; }
                    .title { font-weight: bold; margin-bottom: 8px; color: #667eea; display: flex; align-items: center; gap: 8px; }
                    .btn { background: #667eea; color: white; border: none; padding: 8px 12px; border-radius: 4px; cursor: pointer; width: 100%; margin-top: 8px; font-weight: 600; font-size: 12px; transition: 0.2s; }
                    .btn:hover { background: #764ba2; }
                    .btn-secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
                    .status { font-size: 11px; margin-top: 4px; opacity: 0.8; }
                    .audit-item { font-size: 11px; padding: 4px 0; border-bottom: 1px solid rgba(255,255,255,0.05); }
                    .error { color: #f44336; }
                    .warning { color: #ff9800; }
                    .success { color: #4caf50; }
                    .badge { font-size: 9px; padding: 2px 4px; border-radius: 3px; background: rgba(102, 126, 234, 0.2); color: #667eea; }
                </style>
            </head>
            <body>
                <div class="card">
                    <div class="title">
                        <span>🚀 Launchpad Control</span>
                    </div>
                    <div id="audit-status" class="status">Click "Audit" to check extension health.</div>
                    <div id="audit-results" style="margin-top: 10px;"></div>
                    
                    <button class="btn btn-secondary" onclick="audit()">Audit Package</button>
                    
                    <div style="margin-top: 15px; border-top: 1px solid var(--vscode-panel-border); padding-top: 10px;">
                        <div style="font-size: 11px; font-weight: bold; margin-bottom: 5px; display: flex; justify-content: space-between;">
                            <span>SECRET VAULT</span>
                            <span id="token-badge" class="badge" style="background: #f44336; color: white;">MISSING PAT</span>
                        </div>
                        <div id="token-input-area">
                            <input type="password" id="pat-input" placeholder="Paste Azure PAT..." style="width: 100%; box-sizing: border-box; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); padding: 4px; border-radius: 2px;">
                            <button class="btn btn-secondary" style="margin-top: 4px;" onclick="saveToken()">Save Securely</button>
                        </div>
                    </div>

                    <div style="margin-top: 15px; border-top: 1px solid var(--vscode-panel-border); padding-top: 10px;">
                        <div style="font-size: 11px; font-weight: bold; margin-bottom: 5px;">SHIPPING</div>
                        <button class="btn" onclick="publish('patch')">Ship Patch (v+0.0.1)</button>
                    </div>
                </div>
                
                <script>
                    const vscode = acquireVsCodeApi();
                    
                    function audit() {
                        vscode.postMessage({ type: 'audit' });
                    }
                    
                    function publish(type) {
                        vscode.postMessage({ type: 'publish', value: type });
                    }

                    function saveToken() {
                        const input = document.getElementById('pat-input');
                        vscode.postMessage({ type: 'saveToken', value: input.value });
                        input.value = '';
                    }
                    
                    window.addEventListener('message', event => {
                        const message = event.data;
                        if (message.type === 'auditResults') {
                            const container = document.getElementById('audit-results');
                            const status = document.getElementById('audit-status');
                            container.innerHTML = '';
                            
                            if (message.results.length === 0) {
                                status.innerHTML = '<span class="success">All checks passed! Perfect for shipping.</span>';
                            } else {
                                status.innerText = 'Found ' + message.results.length + ' points of interest:';
                                message.results.forEach(res => {
                                    const div = document.createElement('div');
                                    div.className = 'audit-item ' + (res.severity === 0 ? 'error' : 'warning');
                                    div.innerText = (res.severity === 0 ? '❌ ' : '⚠️ ') + res.message;
                                    container.appendChild(div);
                                });
                            }
                        } else if (message.type === 'tokenStatus') {
                            const badge = document.getElementById('token-badge');
                            const inputArea = document.getElementById('token-input-area');
                            if (message.hasToken) {
                                badge.innerText = 'PAT LOADED';
                                badge.style.background = '#4caf50';
                                inputArea.style.display = 'none';
                            } else {
                                badge.innerText = 'MISSING PAT';
                                badge.style.background = '#f44336';
                                inputArea.style.display = 'block';
                            }
                        }
                    });
                    
                    // Initial check
                    vscode.postMessage({ type: 'checkToken' });
                </script>
            </body>
            </html>`;
    }
}
