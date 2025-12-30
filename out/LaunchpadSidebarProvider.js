"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.LaunchpadSidebarProvider = void 0;
const vscode = __importStar(require("vscode"));
const Validator_1 = require("./Validator");
const Publisher_1 = require("./Publisher");
const TokenVault_1 = require("./TokenVault");
class LaunchpadSidebarProvider {
    _context;
    _view;
    _tokenVault;
    constructor(_context) {
        this._context = _context;
        this._tokenVault = new TokenVault_1.TokenVault(_context.secrets);
    }
    resolveWebviewView(webviewView, context, _token) {
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
    async updateTokenStatus() {
        const hasToken = await this._tokenVault.hasToken();
        this._view?.webview.postMessage({ type: 'tokenStatus', hasToken });
    }
    async runAudit() {
        if (!vscode.workspace.workspaceFolders)
            return;
        const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
        const results = await Validator_1.Validator.validatePackageJson(root);
        this._view?.webview.postMessage({ type: 'auditResults', results });
    }
    async runPublish(type) {
        if (!vscode.workspace.workspaceFolders)
            return;
        const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
        vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Publishing ${type} update...`,
            cancellable: false
        }, async (progress) => {
            try {
                await Publisher_1.Publisher.publish(type, root);
                vscode.window.showInformationMessage(`Successfully published ${type} update!`);
            }
            catch (err) {
                vscode.window.showErrorMessage(err.message);
            }
        });
    }
    _getHtmlForWebview(webview) {
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
exports.LaunchpadSidebarProvider = LaunchpadSidebarProvider;
//# sourceMappingURL=LaunchpadSidebarProvider.js.map