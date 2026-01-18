import * as vscode from 'vscode';
import { Validator } from './Validator';
import { Publisher } from './Publisher';
import { TokenVault } from '@nexgen/shared-core';
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
                    this.runPublish(data.value, data.projectPath);
                    break;
                case 'package':
                    this.runPackage(data.projectPath);
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
                case 'deleteVsix':
                    this.deleteVsix(data.vsixPath);
                    break;

                // VFS RPC Bridge (AAA Security Requirement)
                case 'readFile': {
                    try {
                        const uri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, data.path);
                        const content = await vscode.workspace.fs.readFile(uri);
                        webviewView.webview.postMessage({ command: 'rpcResult', id: data.id, result: Buffer.from(content).toString('utf8') });
                    } catch (e: any) {
                        webviewView.webview.postMessage({ command: 'rpcResult', id: data.id, error: e.message });
                    }
                    break;
                }
                case 'writeFile': {
                    try {
                        const uri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, data.path);
                        const content = Buffer.from(data.content, 'utf8');
                        await vscode.workspace.fs.writeFile(uri, content);
                        webviewView.webview.postMessage({ command: 'rpcResult', id: data.id, result: 'success' });
                    } catch (e: any) {
                        webviewView.webview.postMessage({ command: 'rpcResult', id: data.id, error: e.message });
                    }
                    break;
                }
                case 'listFiles': {
                    try {
                        const root = vscode.workspace.workspaceFolders![0].uri;
                        const files = await this._recursiveList(root, '');
                        webviewView.webview.postMessage({ command: 'rpcResult', id: data.id, result: files });
                    } catch (e: any) {
                        webviewView.webview.postMessage({ command: 'rpcResult', id: data.id, error: e.message });
                    }
                    break;
                }
                case 'getSecret': {
                    try {
                        const secret = await this._context.secrets.get(data.key);
                        webviewView.webview.postMessage({ command: 'rpcResult', id: data.id, result: secret });
                    } catch (e: any) {
                        webviewView.webview.postMessage({ command: 'rpcResult', id: data.id, error: e.message });
                    }
                    break;
                }
                case 'setSecret': {
                    try {
                        await this._context.secrets.store(data.key, data.value);
                        webviewView.webview.postMessage({ command: 'rpcResult', id: data.id, result: 'success' });
                    } catch (e: any) {
                        webviewView.webview.postMessage({ command: 'rpcResult', id: data.id, error: e.message });
                    }
                    break;
                }
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

            try {
                const content = await vscode.workspace.fs.readFile(file);
                const pkg = JSON.parse(content.toString());
                if (!pkg.publisher) continue;

                const results = await Validator.validatePackageJson(projectDir);
                allResults.push({ project: projectName, version: pkg.version, results });
            } catch (e) {
                // Skip invalid JSON
            }
        }

        this._view?.webview.postMessage({ type: 'auditResults', allResults });
    }

    private async runPublish(type: 'patch' | 'minor' | 'major', projectPath?: string) {
        if (!projectPath || projectPath.trim() === '') {
            vscode.window.showWarningMessage('Please select a target project from the dropdown first.');
            return;
        }

        const packageJsonPath = path.join(projectPath, 'package.json');
        if (!fs.existsSync(packageJsonPath)) {
            vscode.window.showErrorMessage(`No package.json found at: ${projectPath}`);
            return;
        }

        vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Publishing ${path.basename(projectPath)} ${type} update...`,
            cancellable: false
        }, async (progress) => {
            try {
                await Publisher.publish(type, projectPath);
                vscode.window.showInformationMessage(`Successfully published ${path.basename(projectPath)} ${type} update!`);
                this.scanForSuite();
            } catch (err: any) {
                vscode.window.showErrorMessage(err.message);
            }
        });
    }

    private async runPackage(projectPath?: string) {
        if (!projectPath || projectPath.trim() === '') {
            vscode.window.showWarningMessage('Please select a target project from the dropdown first.');
            return;
        }

        vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Creating VSIX for ${path.basename(projectPath)}...`,
            cancellable: false
        }, async (progress) => {
            try {
                await Publisher.packageExtension(projectPath);
                vscode.window.showInformationMessage(`Successfully packaged ${path.basename(projectPath)}!`);
                this.scanForSuite();
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
                const contentRaw = await vscode.workspace.fs.readFile(file);
                const content = JSON.parse(contentRaw.toString());
                if (content.publisher) {
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
                const pkg = JSON.parse(fs.readFileSync(file.fsPath, 'utf8'));
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

        const packageJsons = await vscode.workspace.findFiles('**/package.json', '{**/node_modules/**,**/.vscode-test/**}');
        const suite = [];

        for (const file of packageJsons) {
            try {
                const contentRaw = await vscode.workspace.fs.readFile(file);
                const pkg = JSON.parse(contentRaw.toString());
                if (!pkg.publisher) continue;

                const projectPath = path.dirname(file.fsPath);
                const vsixName = `${pkg.name}-${pkg.version}.vsix`.toLowerCase();
                const vsixPath = path.join(projectPath, vsixName);
                const vsixUri = vscode.Uri.file(vsixPath);

                let isStale = false;
                let vsixModifiedTime = 'N/A';

                let vsixExists = false;
                try {
                    const stats = await vscode.workspace.fs.stat(vsixUri);
                    vsixExists = true;
                    vsixModifiedTime = this.formatTime(new Date(stats.mtime));

                    // Check staleness (simplified: check src folder)
                    const srcUri = vscode.Uri.file(path.join(projectPath, 'src'));
                    try {
                        const srcStats = await vscode.workspace.fs.stat(srcUri);
                        if (srcStats.mtime > stats.mtime) {
                            isStale = true;
                        }
                    } catch { }
                } catch {
                    isStale = true;
                }

                const installed = vscode.extensions.all.find(ext =>
                    ext.packageJSON.name === pkg.name && ext.packageJSON.publisher === pkg.publisher
                );

                let status: 'new' | 'update' | 'installed' | 'stale' = 'new';
                if (installed) {
                    const vComp = this.compareVersions(pkg.version, installed.packageJSON.version);
                    if (vComp > 0) {
                        status = 'update';
                    } else if (isStale) {
                        status = 'stale';
                    } else if (vsixExists) {
                        const stats = await vscode.workspace.fs.stat(vsixUri);
                        const installedPkg = path.join(installed.extensionPath, 'package.json');
                        try {
                            const instStats = await vscode.workspace.fs.stat(vscode.Uri.file(installedPkg));
                            if (stats.mtime > instStats.mtime + 5000) {
                                status = 'update';
                            } else {
                                status = 'installed';
                            }
                        } catch {
                            status = 'installed';
                        }
                    } else {
                        status = 'installed';
                    }
                } else if (vsixExists) {
                    status = 'new';
                } else {
                    status = 'stale';
                }

                suite.push({
                    name: pkg.displayName || pkg.name,
                    path: vsixPath,
                    version: pkg.version,
                    status: status,
                    installedVersion: installed?.packageJSON.version,
                    modifiedTime: vsixModifiedTime
                });
            } catch (e) { }
        }

        this._view?.webview.postMessage({ type: 'suiteStatus', suite });
    }

    private formatTime(mtime: Date): string {
        const now = new Date();
        const diffMs = now.getTime() - mtime.getTime();
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);

        if (diffMins < 1) return 'just now';
        if (diffMins < 60) return `${diffMins}m ago`;
        if (diffHours < 24) return `${diffHours}h ago`;
        return mtime.toLocaleDateString() + ' ' + mtime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    private compareVersions(v1: string, v2: string): number {
        if (!v1 || !v2 || v1 === 'unknown' || v2 === 'unknown') return 0;
        const p1 = v1.split('.').map(Number);
        const p2 = v2.split('.').map(Number);
        for (let i = 0; i < 3; i++) {
            if ((p1[i] || 0) > (p2[i] || 0)) return 1;
            if ((p1[i] || 0) < (p2[i] || 0)) return -1;
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

        const packageJsons = await vscode.workspace.findFiles(
            '**/package.json',
            '{**/node_modules/**,**/.vscode-test/**}'
        );

        const nexgenProjects: { path: string, name: string, version: string }[] = [];
        for (const file of packageJsons) {
            try {
                const contentRaw = await vscode.workspace.fs.readFile(file);
                const content = JSON.parse(contentRaw.toString());
                if (content.publisher && content.scripts?.compile) {
                    nexgenProjects.push({
                        path: path.dirname(file.fsPath),
                        name: content.name,
                        version: content.version
                    });
                }
            } catch (e) { }
        }

        if (nexgenProjects.length === 0) {
            vscode.window.showWarningMessage('No NexGenMeta extensions found to compile.');
            return;
        }

        vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Compiling NexGen-Meta Suite...",
            cancellable: false
        }, async (progress) => {
            let successCount = 0;
            let failedProjects: string[] = [];

            for (const project of nexgenProjects) {
                const projectName = path.basename(project.path);

                // Smart check: Only build if stale
                const vsixPath = path.join(project.path, `${project.name}-${project.version}.vsix`.toLowerCase());
                let needsBuild = true;
                try {
                    const stats = await vscode.workspace.fs.stat(vscode.Uri.file(vsixPath));
                    const srcPath = path.join(project.path, 'src');
                    try {
                        const srcStats = await vscode.workspace.fs.stat(vscode.Uri.file(srcPath));
                        if (srcStats.mtime < stats.mtime) {
                            needsBuild = false;
                        }
                    } catch { }
                } catch { }

                if (!needsBuild) {
                    successCount++;
                    continue;
                }

                progress.report({ message: `Building ${projectName}...` });

                try {
                    await Publisher.runCompile(project.path);
                    await Publisher.packageExtension(project.path);
                    successCount++;
                } catch (err: any) {
                    failedProjects.push(projectName);
                    console.error(`Build failed for ${projectName}:`, err.message);
                }
            }

            if (failedProjects.length > 0) {
                vscode.window.showWarningMessage(`Suite Build: ${successCount} succeeded, ${failedProjects.length} failed (${failedProjects.join(', ')})`);
            } else {
                vscode.window.showInformationMessage(`Suite Build Complete: ${successCount} NexGenMeta extensions processed.`);
            }
            this.scanForSuite();
        });
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        const nonce = getNonce();
        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src \${webview.cspSource} 'unsafe-inline'; script-src 'nonce-\${nonce}';">
                <style>
                    :root {
                        --accent: #667eea;
                        --accent-hover: #764ba2;
                        --success: #4caf50;
                        --warning: #ff9800;
                        --danger: #f44336;
                    }
                    body { 
                        font-family: var(--vscode-font-family); 
                        padding: 12px; 
                        color: var(--vscode-foreground); 
                        background: var(--vscode-sideBar-background);
                    }
                    
                    /* Header Card */
                    .header-card { 
                        background: linear-gradient(135deg, rgba(102, 126, 234, 0.15), rgba(118, 75, 162, 0.1)); 
                        border: 1px solid rgba(102, 126, 234, 0.3); 
                        border-radius: 10px; 
                        padding: 16px; 
                        margin-bottom: 16px; 
                        position: relative; 
                        overflow: hidden; 
                    }
                    .header-card::before { 
                        content: ''; 
                        position: absolute; 
                        top: -30%; right: -10%; 
                        width: 120px; height: 120px; 
                        background: radial-gradient(circle, rgba(102, 126, 234, 0.2) 0%, transparent 70%); 
                    }
                    .header-title { 
                        font-size: 20px; font-weight: 700; 
                        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
                        -webkit-background-clip: text; -webkit-text-fill-color: transparent; 
                        position: relative; z-index: 1;
                    }
                    .header-version { font-size: 10px; opacity: 0.5; font-family: monospace; margin-left: 8px; }
                    .header-status { 
                        display: flex; align-items: center; gap: 8px; 
                        margin-top: 8px; position: relative; z-index: 1; 
                    }
                    .status-pill { 
                        background: rgba(76, 175, 80, 0.2); color: var(--success); 
                        padding: 3px 10px; border-radius: 12px; 
                        font-size: 9px; font-weight: 700; letter-spacing: 0.5px; 
                    }
                    .status-dot { 
                        width: 6px; height: 6px; background: var(--success); 
                        border-radius: 50%; box-shadow: 0 0 8px var(--success); 
                        animation: pulse 2s infinite; 
                    }
                    @keyframes pulse { 
                        0%, 100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(76, 175, 80, 0.7); } 
                        70% { transform: scale(1); box-shadow: 0 0 0 6px rgba(76, 175, 80, 0); } 
                    }

                    /* Section Cards */
                    .section-card {
                        background: transparent;
                        border: 1px solid var(--vscode-panel-border);
                        border-radius: 8px;
                        padding: 14px;
                        margin-bottom: 12px;
                        border-left: 3px solid var(--accent);
                    }
                    .section-title {
                        font-size: 11px; font-weight: 700; 
                        color: var(--accent); 
                        margin-bottom: 10px;
                        display: flex; justify-content: space-between; align-items: center;
                    }
                    .section-label { font-size: 9px; opacity: 0.6; margin-bottom: 4px; }
                    
                    /* Buttons */
                    .btn-primary {
                        background: linear-gradient(135deg, var(--accent), var(--accent-hover));
                        color: white; border: none;
                        padding: 10px 16px; border-radius: 6px;
                        cursor: pointer; width: 100%;
                        font-weight: 600; font-size: 12px;
                        transition: all 0.2s;
                        box-shadow: 0 2px 8px rgba(102, 126, 234, 0.3);
                        display: flex; align-items: center; justify-content: center; gap: 6px;
                    }
                    .btn-primary:hover { 
                        transform: translateY(-1px); 
                        box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4); 
                    }
                    .btn-secondary {
                        background: transparent;
                        color: var(--vscode-foreground);
                        border: 1px solid var(--vscode-panel-border);
                        padding: 8px 12px; border-radius: 5px;
                        cursor: pointer; font-size: 11px;
                        transition: all 0.15s;
                    }
                    .btn-secondary:hover { 
                        background: var(--vscode-button-secondaryBackground); 
                        border-color: var(--accent);
                    }
                    .btn-group { display: flex; gap: 8px; margin-top: 10px; }
                    .btn-group .btn-secondary { flex: 1; }
                    
                    /* Inputs */
                    .input-field {
                        width: 100%; box-sizing: border-box;
                        background: var(--vscode-input-background);
                        color: var(--vscode-input-foreground);
                        border: 1px solid var(--vscode-input-border);
                        padding: 8px 10px; border-radius: 5px;
                        font-size: 11px;
                    }
                    .input-field:focus { border-color: var(--accent); outline: none; }
                    .select-field {
                        width: 100%; box-sizing: border-box;
                        background: var(--vscode-dropdown-background);
                        color: var(--vscode-dropdown-foreground);
                        border: 1px solid var(--vscode-dropdown-border);
                        padding: 8px 10px; border-radius: 5px;
                        font-size: 11px;
                    }
                    
                    /* Status and Badges */
                    .badge { 
                        font-size: 9px; padding: 3px 8px; border-radius: 10px; 
                        font-weight: 600; 
                    }
                    .badge-success { background: rgba(76, 175, 80, 0.15); color: var(--success); }
                    .badge-warning { background: rgba(255, 152, 0, 0.15); color: var(--warning); }
                    .badge-danger { background: rgba(244, 67, 54, 0.15); color: var(--danger); }
                    .badge-accent { background: rgba(102, 126, 234, 0.15); color: var(--accent); }
                    
                    /* Suite List */
                    .suite-item {
                        display: grid;
                        grid-template-columns: 20px 1fr auto auto;
                        align-items: center;
                        gap: 10px;
                        padding: 10px 8px;
                        border-radius: 6px;
                        transition: background 0.15s;
                        border-bottom: 1px solid rgba(255,255,255,0.03);
                    }
                    .suite-item:hover { background: rgba(102, 126, 234, 0.05); }
                    .suite-item:last-child { border-bottom: none; }
                    .suite-name { font-size: 11px; font-weight: 500; }
                    .suite-meta { font-size: 9px; opacity: 0.5; margin-top: 2px; }
                    .delete-btn { 
                        opacity: 0.4; cursor: pointer; 
                        padding: 4px; border-radius: 4px; 
                        transition: all 0.15s; 
                    }
                    .delete-btn:hover { opacity: 1; background: rgba(244, 67, 54, 0.15); color: var(--danger); }
                    
                    /* Audit Results */
                    .audit-item { font-size: 10px; padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.03); }
                    .audit-project { font-size: 9px; font-weight: 600; opacity: 0.7; margin-top: 8px; padding-bottom: 4px; border-bottom: 1px solid var(--vscode-panel-border); }
                </style>
            </head>
            <body>
                <!-- Header -->
                <div class="header-card">
                    <div style="display: flex; align-items: baseline;">
                        <span class="header-title">Launchpad</span>
                        <span class="header-version">v0.1.3</span>
                    </div>
                    <div class="header-status">
                        <span class="status-pill">SUITE READY</span>
                        <span class="status-dot"></span>
                    </div>
                </div>

                <!-- Tools Section -->
                <div class="section-card">
                    <div class="section-title">🔧 TOOLS</div>
                    <div id="audit-status" style="font-size: 10px; opacity: 0.7; margin-bottom: 8px;">Click to check extension health</div>
                    <div id="audit-results"></div>
                    <div class="btn-group">
                        <button class="btn-secondary" onclick="audit()">🔍 Audit</button>
                        <button class="btn-secondary" onclick="generateBadges()">🏷️ Badges</button>
                    </div>
                </div>

                <!-- Secret Vault Section -->
                <div class="section-card" style="border-left-color: var(--warning);">
                    <div class="section-title">
                        <span>🔐 SECRET VAULT</span>
                        <span id="token-badge" class="badge badge-danger">MISSING PAT</span>
                    </div>
                    <div id="token-input-area">
                        <input type="password" id="pat-input" placeholder="Paste Azure PAT..." class="input-field">
                        <button class="btn-secondary" style="width: 100%; margin-top: 8px;" onclick="saveToken()">💾 Save Securely</button>
                    </div>
                </div>

                <!-- Shipping Section -->
                <div class="section-card" style="border-left-color: var(--success);">
                    <div class="section-title">🚀 SHIPPING</div>
                    <div class="section-label">TARGET PROJECT</div>
                    <select id="project-selector" class="select-field">
                        <option value="">Detecting projects...</option>
                    </select>
                    <div class="btn-group">
                        <button class="btn-primary" onclick="publish('patch')">
                            <span>🚀</span> Ship Patch
                        </button>
                        <button class="btn-secondary" onclick="packageExt()">
                            <span>📦</span> Package
                        </button>
                    </div>
                    <button class="btn-secondary" style="width: 100%; margin-top: 8px;" onclick="compileSuite()">🔨 Build Entire Suite</button>
                </div>

                <!-- Suite Sync Section -->
                <div class="section-card">
                    <div class="section-title">
                        <span>📦 SUITE SYNC</span>
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <span id="suite-count" class="badge badge-accent">--</span>
                            <span onclick="refreshSuite()" style="cursor: pointer; opacity: 0.6; font-size: 12px;" title="Refresh">🔄</span>
                        </div>
                    </div>
                    <div id="suite-status" style="font-size: 10px; opacity: 0.6; margin-bottom: 8px;">Discovering components...</div>
                    <div id="suite-list" style="max-height: 180px; overflow-y: auto;"></div>
                    <button class="btn-secondary" style="width: 100%; margin-top: 10px;" onclick="syncSuite()">⬇️ Sync Selected</button>
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

                    function packageExt() {
                        const selector = document.getElementById('project-selector');
                        vscode.postMessage({ type: 'package', projectPath: selector.value });
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
                    
                    function refreshSuite() {
                        document.getElementById('suite-status').innerText = 'Refreshing...';
                        vscode.postMessage({ type: 'getSuiteStatus' });
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
                                    projectHeader.className = 'audit-project';
                                    projectHeader.innerText = item.project.toUpperCase() + ' (v' + item.version + ')';
                                    container.appendChild(projectHeader);
                                    
                                    item.results.forEach(res => {
                                        totalIssues++;
                                        const div = document.createElement('div');
                                        div.className = 'audit-item ' + (res.severity === 0 ? 'error' : 'warning');
                                        div.style.color = res.severity === 0 ? 'var(--danger)' : 'var(--warning)';
                                        div.innerText = (res.severity === 0 ? '❌ ' : '⚠️ ') + res.message;
                                        container.appendChild(div);
                                    });
                                }
                            });
                            
                            if (totalIssues === 0) {
                                status.innerHTML = '<span style="color: var(--success);">✅ All projects passed! Ready for shipment.</span>';
                            } else {
                                status.innerText = 'Health check complete. ' + totalIssues + ' points of interest found:';
                            }
                        } else if (message.type === 'tokenStatus') {
                            const badge = document.getElementById('token-badge');
                            const inputArea = document.getElementById('token-input-area');
                            if (message.hasToken) {
                                badge.innerText = 'PAT LOADED';
                                badge.className = 'badge badge-success';
                                inputArea.style.display = 'none';
                            } else {
                                badge.innerText = 'MISSING PAT';
                                badge.className = 'badge badge-danger';
                                inputArea.style.display = 'block';
                            }
                        } else if (message.type === 'suiteStatus') {
                            const count = document.getElementById('suite-count');
                            const status = document.getElementById('suite-status');
                            const list = document.getElementById('suite-list');
                            
                            count.innerText = message.suite.length + ' VSIX';
                            list.innerHTML = '';
                            
                            if (message.suite.length === 0) {
                                status.innerText = 'No VSIX files found in workspace.';
                            } else {
                                status.innerText = message.suite.length + ' extensions available:';
                                message.suite.forEach(s => {
                                    const div = document.createElement('div');
                                    div.className = 'suite-item';

                                    let statusBadge = '<span class="badge badge-accent">NEW</span>';
                                    if (s.status === 'update') statusBadge = '<span class="badge badge-warning">UPDATE</span>';
                                    else if (s.status === 'installed') statusBadge = '<span class="badge badge-success">INSTALLED</span>';
                                    else if (s.status === 'stale') statusBadge = '<span class="badge badge-danger">STALE</span>';

                                    div.innerHTML = '<input type="checkbox" class="suite-checkbox" ' + (s.status === 'installed' ? '' : 'checked') + ' data-path="' + s.path + '" style="margin: 0; cursor: pointer;">' +
                                        '<div>' +
                                            '<div class="suite-name">' + s.name + '</div>' +
                                            '<div class="suite-meta">v' + s.version + ' · ' + (s.modifiedTime || 'unknown') + '</div>' +
                                        '</div>' +
                                        statusBadge +
                                        '<span class="delete-btn" onclick="deleteVsix(\'' + s.path.replace(/\\/g, '\\\\') + '\')">🗑️</span>';
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

    private async _recursiveList(uri: vscode.Uri, relative: string): Promise<string[]> {
        const entries = await vscode.workspace.fs.readDirectory(uri);
        let results: string[] = [];
        for (const [name, type] of entries) {
            const relPath = relative ? path.join(relative, name) : name;
            if (type === vscode.FileType.Directory) {
                if (name === 'node_modules' || name === '.git' || name === '.conduit' || name === '.agent') continue;
                const subResults = await this._recursiveList(vscode.Uri.joinPath(uri, name), relPath);
                results = results.concat(subResults);
            } else {
                results.push(relPath);
            }
        }
        return results;
    }
}

function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
