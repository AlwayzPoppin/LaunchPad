import * as vscode from 'vscode';
import { LaunchpadSidebarProvider } from './LaunchpadSidebarProvider';

export function activate(context: vscode.ExtensionContext) {
    const sidebarProvider = new LaunchpadSidebarProvider(context.extensionUri);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            "launchpad.controlPanel",
            sidebarProvider
        )
    );

    console.log('Launchpad is now active!');
}

export function deactivate() { }
