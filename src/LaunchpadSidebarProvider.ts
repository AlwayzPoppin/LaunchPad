import * as vscode from 'vscode';
import { Validator } from './Validator';
import { Publisher } from './Publisher';
import { TokenVault } from './TokenVault';
import { BadgeGenerator } from './BadgeGenerator';
import * as path from 'path';
import * as fs from 'fs';

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
                case 'generateBadges':
                    this.runGenerateBadges();
                    break;
                case 'saveToken':
                    await this._tokenVault.storeToken(data.value);
                    vscode.window.showInformationMessage('PAT saved securely in Token Vault.');
                    this.updateTokenStatus();
                    break;
                case 'checkToken':
                    this.updateTokenStatus();
                    break;
                case 'getSuiteStatus':
                    this.scanForSuite();
                    this.scanForProjects();
                    break;
                case 'installSuite':
                    this.installSuite(data.vsixPaths);
                    break;
                case 'compileSuite':
                    this.runCompileAll();
                    break;
                case 'publish':
                    this.runPublish(data.value, data.projectPath);
                    break;
                case 'deleteVsix':
                    this.deleteVsix(data.vsixPath);
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

        const packageJsons = await vscode.workspace.findFiles('**/package.json', '**/node_modules/**');
        const allResults: { project: string, version: string, results: any[] }[] = [];

        for (const file of packageJsons) {
            const projectDir = path.dirname(file.fsPath);
            const projectName = path.basename(projectDir);

            // Only audit NexGenSynapse extensions (ignore system/node_modules/clutter)
            try {
                const pkg = JSON.parse(fs.readFileSync(file.fsPath, 'utf8'));
                if (pkg.publisher !== 'NexGenSynapse') continue;

                const results = await Validator.validatePackageJson(projectDir);
                allResults.push({ project: projectName, version: pkg.version, results });
            } catch (e) {
                // Skip invalid JSON
            }
        }

        this._view?.webview.postMessage({ type: 'auditResults', allResults });
    }

    private async runPublish(type: 'patch' | 'minor' | 'major', projectPath?: string) {
        if (!vscode.workspace.workspaceFolders) return;
        const targetPath = projectPath || vscode.workspace.workspaceFolders[0].uri.fsPath;

        vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Publishing ${path.basename(targetPath)} ${type} update...`,
            cancellable: false
        }, async (progress) => {
            try {
                await Publisher.publish(type, targetPath);
                vscode.window.showInformationMessage(`Successfully published ${path.basename(targetPath)} ${type} update!`);
            } catch (err: any) {
                vscode.window.showErrorMessage(err.message);
            }
        });
    }

    private async scanForProjects() {
        if (!vscode.workspace.workspaceFolders) return;
        const packageJsons = await vscode.workspace.findFiles('**/package.json', '**/node_modules/**');
        const projects: { name: string, path: string }[] = [];

        for (const file of packageJsons) {
            try {
                const content = JSON.parse(fs.readFileSync(file.fsPath, 'utf8'));
                if (content.publisher === 'NexGenSynapse') {
                    projects.push({
                        name: content.displayName || content.name,
                        path: path.dirname(file.fsPath)
                    });
                }
            } catch (e) { }
        }

        this._view?.webview.postMessage({ type: 'availableProjects', projects });
    }

    private async runGenerateBadges() {
        if (!vscode.workspace.workspaceFolders) return;

        const packageJsons = await vscode.workspace.findFiles('**/package.json', '**/node_modules/**');
        let successCount = 0;

        for (const file of packageJsons) {
            const projectDir = path.dirname(file.fsPath);
            const projectName = path.basename(projectDir);

            try {
                const pkg = JSON.parse(require('fs').readFileSync(file.fsPath, 'utf8'));
                const badges = BadgeGenerator.generateBadges(pkg.publisher, pkg.name);
                const success = await BadgeGenerator.insertIntoReadme(projectDir, badges);
                if (success) successCount++;
            } catch (err) {
                console.error(`Failed to generate badges for ${projectName}:`, err);
            }
        }

        if (successCount > 0) {
            vscode.window.showInformationMessage(`Marketplace badges inserted into ${successCount} projects.`);
        } else {
            vscode.window.showWarningMessage('No new badges were inserted (READMEs may be missing or badges already present).');
        }
    }

    private async scanForSuite() {
        if (!vscode.workspace.workspaceFolders) return;

        const vsixFiles = await vscode.workspace.findFiles('**/*.vsix', '**/node_modules/**');
        const suite = [];

        for (const file of vsixFiles) {
            const name = path.basename(file.fsPath);
            // Try to extract version from filename (e.g., ext-0.1.0.vsix)
            const versionMatch = name.match(/(\d+\.\d+\.\d+)/);
            const version = versionMatch ? versionMatch[0] : 'unknown';

            // Try to find if extension is already installed
            // This is a bit tricky as the name in vsix might not match id, but we'll try to match name.
            const baseName = name.split('-')[0].toLowerCase();
            const installed = vscode.extensions.all.find(ext =>
                ext.id.toLowerCase().includes(baseName) ||
                ext.packageJSON.name.toLowerCase() === baseName
            );

            let status: 'new' | 'update' | 'installed' = 'new';
            if (installed) {
                const installedVersion = installed.packageJSON.version;
                if (this.compareVersions(version, installedVersion) > 0) {
                    status = 'update';
                } else {
                    status = 'installed';
                }
            }

            suite.push({
                name: name,
                path: file.fsPath,
                version: version,
                status: status,
                installedVersion: installed?.packageJSON.version
            });
        }

        this._view?.webview.postMessage({ type: 'suiteStatus', suite });
    }

    private compareVersions(v1: string, v2: string): number {
        if (v1 === 'unknown' || v2 === 'unknown') return 0;
        const p1 = v1.split('.').map(Number);
        const p2 = v2.split('.').map(Number);
        for (let i = 0; i < 3; i++) {
            if (p1[i] > p2[i]) return 1;
            if (p1[i] < p2[i]) return -1;
        }
        return 0;
    }

    private async installSuite(vsixPaths: string[]) {
        vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Syncing NexGen-Meta Suite...",
            cancellable: false
        }, async (progress) => {
            let installedCount = 0;
            for (const vsixPath of vsixPaths) {
                try {
                    progress.report({ message: `Installing ${path.basename(vsixPath)}...` });
                    await vscode.commands.executeCommand('workbench.extensions.installExtension', vscode.Uri.file(vsixPath));
                    installedCount++;
                } catch (err: any) {
                    vscode.window.showErrorMessage(`Failed to install ${path.basename(vsixPath)}: ${err.message}`);
                }
            }
            vscode.window.showInformationMessage(`Suite Sync Complete: ${installedCount} extensions installed/updated.`);
            this.scanForSuite();
        });
    }

    private async deleteVsix(vsixPath: string) {
        const fileName = path.basename(vsixPath);
        const confirm = await vscode.window.showWarningMessage(
            `Are you sure you want to delete ${fileName}?`,
            { modal: true },
            'Delete',
            'Cancel'
        );

        if (confirm === 'Delete') {
            try {
                if (fs.existsSync(vsixPath)) {
                    fs.unlinkSync(vsixPath);
                    vscode.window.showInformationMessage(`Deleted ${fileName}`);
                    this.scanForSuite();
                }
            } catch (err: any) {
                vscode.window.showErrorMessage(`Failed to delete VSIX: ${err.message}`);
            }
        }
    }

    private async runCompileAll() {
        if (!vscode.workspace.workspaceFolders) return;
        const root = vscode.workspace.workspaceFolders[0].uri.fsPath;

        // Find all directories with package.json
        const packageJsons = await vscode.workspace.findFiles('**/package.json', '**/node_modules/**');
        const projects = packageJsons.map(p => path.dirname(p.fsPath));

        vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Compiling NexGen-Meta Suite...",
            cancellable: false
        }, async (progress) => {
            let successCount = 0;
            for (const project of projects) {
                const projectName = path.basename(project);
                progress.report({ message: `Building ${projectName}...` });

                try {
                    // Check if 'compile' script exists
                    const pkg = JSON.parse(require('fs').readFileSync(path.join(project, 'package.json'), 'utf8'));
                    if (pkg.scripts && pkg.scripts.compile) {
                        await Publisher.runCompile(project);
                        successCount++;
                    }
                } catch (err: any) {
                    vscode.window.showErrorMessage(`Build failed for ${projectName}: ${err.message}`);
                }
            }
            vscode.window.showInformationMessage(`Suite Build Complete: ${successCount} projects compiled.`);
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
                    .leadin-card { background: linear-gradient(135deg, rgba(102, 126, 234, 0.1), rgba(118, 75, 162, 0.1)); border: 1px solid var(--vscode-panel-border); border-radius: 8px; padding: 16px; margin-bottom: 20px; position: relative; overflow: hidden; }
                    .leadin-card::before { content: ''; position: absolute; top: -50%; right: -20%; width: 150px; height: 150px; background: radial-gradient(circle, rgba(102, 126, 234, 0.1) 0%, transparent 70%); z-index: 0; }
                    .leadin-header { position: relative; z-index: 1; display: flex; justify-content: space-between; align-items: center; }
                    .leadin-name { font-size: 18px; font-weight: 700; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
                    .leadin-version { font-size: 10px; opacity: 0.6; font-family: monospace; }
                    .leadin-status { position: relative; z-index: 1; margin-top: 8px; display: flex; align-items: center; gap: 6px; }
                    .status-pill { background: rgba(76, 175, 80, 0.2); color: #4caf50; padding: 2px 8px; border-radius: 10px; font-size: 9px; font-weight: 800; letter-spacing: 0.5px; }
                    .status-dot { width: 6px; height: 6px; background: #4caf50; border-radius: 50%; box-shadow: 0 0 8px #4caf50; animation: pulse 2s infinite; }
                    @keyframes pulse { 0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(76, 175, 80, 0.7); } 70% { transform: scale(1); box-shadow: 0 0 0 6px rgba(76, 175, 80, 0); } 100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(76, 175, 80, 0); } }

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
                    .delete-btn { color: #f44336; cursor: pointer; padding: 4px; border-radius: 4px; transition: 0.2s; font-weight: bold; }
                    .delete-btn:hover { background: rgba(244, 67, 54, 0.1); }
                </style>
            </head>
            <body>
                <div class="leadin-card">
                    <div class="leadin-header">
                        <span class="leadin-name">Launchpad</span>
                        <span class="leadin-version">v0.1.0</span>
                    </div>
                    <div class="leadin-status">
                        <span class="status-pill">SUITE READY</span>
                        <span class="status-dot"></span>
                    </div>
                </div>

                <div class="card">
                    <div class="title">
                        <span>🚀 Control Hub</span>
                    </div>
                    <div id="audit-status" class="status">Click "Audit" to check extension health.</div>
                    <div id="audit-results" style="margin-top: 10px;"></div>
                    
                    <button class="btn btn-secondary" onclick="audit()">Audit Package</button>
                    <button class="btn btn-secondary" style="margin-top: 4px;" onclick="generateBadges()">Generate Badges</button>
                    
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
                        <div style="margin-bottom: 8px;">
                            <div style="font-size: 9px; opacity: 0.7; margin-bottom: 2px;">TARGET PROJECT</div>
                            <select id="project-selector" style="width: 100%; background: var(--vscode-select-background); color: var(--vscode-select-foreground); border: 1px solid var(--vscode-select-border); padding: 4px; border-radius: 2px; font-size: 11px;">
                                <option value="">Detecting projects...</option>
                            </select>
                        </div>
                        <button class="btn" onclick="publish('patch')">Ship Patch (v+0.0.1)</button>
                        <button class="btn btn-secondary" style="margin-top: 4px;" onclick="compileSuite()">Build Entire Suite</button>
                    </div>

                    <div style="margin-top: 15px; border-top: 1px solid var(--vscode-panel-border); padding-top: 10px;">
                        <div style="font-size: 11px; font-weight: bold; margin-bottom: 5px; display: flex; justify-content: space-between;">
                            <span>SUITE SYNC</span>
                            <span id="suite-count" class="badge">--</span>
                        </div>
                        <div id="suite-status" class="status">Discovering suite components...</div>
                        <div id="suite-list" style="margin-top: 8px; max-height: 120px; overflow-y: auto;"></div>
                        <button class="btn btn-secondary" style="margin-top: 8px;" onclick="syncSuite()">Sync Selected</button>
                    </div>
                </div>
                
                <script>
                    const vscode = acquireVsCodeApi();
                    
                    function audit() {
                        vscode.postMessage({ type: 'audit' });
                    }
                    
                    function publish(type) {
                        const selector = document.getElementById('project-selector');
                        vscode.postMessage({ type: 'publish', value: type, projectPath: selector.value });
                    }

                    function generateBadges() {
                        vscode.postMessage({ type: 'generateBadges' });
                    }

                    function saveToken() {
                        const input = document.getElementById('pat-input');
                        vscode.postMessage({ type: 'saveToken', value: input.value });
                        input.value = '';
                    }

                    function syncSuite() {
                        const checkboxes = document.querySelectorAll('.suite-checkbox:checked');
                        const paths = Array.from(checkboxes).map(cb => cb.dataset.path);
                        if (paths.length === 0) return;
                        vscode.postMessage({ type: 'installSuite', vsixPaths: paths });
                    }

                    function compileSuite() {
                        vscode.postMessage({ type: 'compileSuite' });
                    }

                    function deleteVsix(path) {
                        vscode.postMessage({ type: 'deleteVsix', vsixPath: path });
                    }
                    
                    window.addEventListener('message', event => {
                        const message = event.data;
                        if (message.type === 'auditResults') {
                            const container = document.getElementById('audit-results');
                            const status = document.getElementById('audit-status');
                            container.innerHTML = '';
                            
                            let totalIssues = 0;
                            message.allResults.forEach(item => {
                                if (item.results.length > 0) {
                                    const projectHeader = document.createElement('div');
                                    projectHeader.style.fontSize = '10px';
                                    projectHeader.style.fontWeight = 'bold';
                                    projectHeader.style.marginTop = '8px';
                                    projectHeader.style.borderBottom = '1px solid var(--vscode-panel-border)';
                                    projectHeader.innerText = item.project.toUpperCase() + ' (v' + item.version + ')';
                                    container.appendChild(projectHeader);

                                    item.results.forEach(res => {
                                        totalIssues++;
                                        const div = document.createElement('div');
                                        div.className = 'audit-item ' + (res.severity === 0 ? 'error' : 'warning');
                                        div.innerText = (res.severity === 0 ? '❌ ' : '⚠️ ') + res.message;
                                        container.appendChild(div);
                                    });
                                }
                            });

                            if (totalIssues === 0) {
                                status.innerHTML = '<span class="success">All projects passed! Perfect for shipping.</span>';
                            } else {
                                status.innerText = 'Found ' + totalIssues + ' points of interest across the suite:';
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
                        } else if (message.type === 'suiteStatus') {
                            window.currentSuite = message.suite;
                            const count = document.getElementById('suite-count');
                            const status = document.getElementById('suite-status');
                            const list = document.getElementById('suite-list');
                            
                            count.innerText = message.suite.length + ' VSIX';
                            list.innerHTML = '';
                            
                            if (message.suite.length === 0) {
                                status.innerText = 'No suite VSIX files found.';
                            } else {
                                status.innerText = 'Select to sync:';
                                message.suite.forEach(s => {
                                    const div = document.createElement('div');
                                    div.className = 'audit-item';
                                    div.style.border = 'none';
                                    div.style.padding = '4px 0';
                                    div.style.display = 'flex';
                                    div.style.alignItems = 'center';
                                    div.style.gap = '8px';

                                    let statusBadge = '';
                                    if (s.status === 'update') statusBadge = '<span class="badge" style="background: #ff9800; color: white;">UPDATE AVAILABLE</span>';
                                    else if (s.status === 'installed') statusBadge = '<span class="badge" style="background: rgba(76, 175, 80, 0.2); color: #4caf50;">INSTALLED</span>';

                                    div.innerHTML = \`
                                        <input type="checkbox" class="suite-checkbox" \${s.status === 'installed' ? '' : 'checked'} data-path="\${s.path}" style="margin: 0;">
                                        <div style="flex: 1;">
                                            <div style="font-size: 11px;">\${s.name}</div>
                                            <div style="font-size: 9px; opacity: 0.7;">v\${s.version} \${statusBadge}</div>
                                        </div>
                                        <span class="delete-btn" onclick="deleteVsix('\${s.path.replace(/\\\\/g, '\\\\\\\\')}')" title="Delete VSIX">🗑️</span>
                                    \`;
                                    list.appendChild(div);
                                });
                            }
                        } else if (message.type === 'availableProjects') {
                            const selector = document.getElementById('project-selector');
                            selector.innerHTML = '';
                            message.projects.forEach(p => {
                                const opt = document.createElement('option');
                                opt.value = p.path;
                                opt.innerText = p.name;
                                selector.appendChild(opt);
                            });
                        }
                    });
                    
                    // Initial checks
                    vscode.postMessage({ type: 'checkToken' });
                    vscode.postMessage({ type: 'getSuiteStatus' });
                </script>
            </body>
            </html>`;
    }
}
