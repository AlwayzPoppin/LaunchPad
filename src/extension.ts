import * as vscode from 'vscode';
import { LaunchpadSidebarProvider } from './LaunchpadSidebarProvider';
import * as path from 'path';
import * as fs from 'fs';

export function activate(context: vscode.ExtensionContext) {
    const debugLogPath = path.join(context.extensionPath, 'launchpad_debug.log');
    const log = (msg: string, level: 'info' | 'warn' | 'error' | 'debug' = 'info', metadata: any = {}) => {
        try {
            const entry = {
                timestamp: new Date().toISOString(),
                level,
                message: msg,
                ...metadata
            };
            fs.appendFileSync(debugLogPath, JSON.stringify(entry) + '\n');
        } catch { }
    };

    log('Launchpad is now active!');
    const sidebarProvider = new LaunchpadSidebarProvider(context);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            "launchpad.controlPanel",
            sidebarProvider
        )
    );

    console.log('⚡ Launchpad is now active!');
}

export function deactivate() { }
