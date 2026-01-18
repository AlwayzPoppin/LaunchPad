import * as vscode from 'vscode';
import { spawn } from 'child_process';

export class Publisher {
    private static async runCommand(command: string, args: string[], cwd?: string): Promise<string> {
        return new Promise((resolve, reject) => {
            // Security Fix: Disable shell to prevent massive injection risks.
            // On Windows, npm/npx are .cmd files, so we must append the extension manually.
            const isWindows = process.platform === 'win32';
            const actualCommand = isWindows && (command === 'npm' || command === 'npx') ? `${command}.cmd` : command;

            const process = spawn(actualCommand, args, { cwd, shell: false });
            let stdout = '';
            let stderr = '';

            process.stdout.on('data', (data) => stdout += data.toString());
            process.stderr.on('data', (data) => stderr += data.toString());

            process.on('close', (code) => {
                if (code === 0) {
                    resolve(stdout);
                } else {
                    reject(new Error(`Command failed with code ${code}: ${stderr || stdout}`));
                }
            });

            process.on('error', (err) => {
                reject(err);
            });
        });
    }

    public static async publish(type: 'patch' | 'minor' | 'major', cwd: string): Promise<string> {
        try {
            // Use array-based arguments to prevent injection
            return await this.runCommand('npx', ['vsce', 'publish', type, '--no-verify'], cwd);
        } catch (err: any) {
            throw new Error(`Publish failed: ${err.message}`);
        }
    }

    public static async packageExtension(cwd: string): Promise<string> {
        try {
            return await this.runCommand('npx', ['vsce', 'package'], cwd);
        } catch (err: any) {
            throw new Error(`Package failed: ${err.message}`);
        }
    }

    public static async getLogins(): Promise<string[]> {
        try {
            const stdout = await this.runCommand('npx', ['vsce', 'ls-publishers']);
            return stdout.split('\n').filter(l => l.trim() !== '');
        } catch {
            return [];
        }
    }

    public static async runCompile(cwd: string): Promise<string> {
        try {
            return await this.runCommand('npm', ['run', 'compile'], cwd);
        } catch (err: any) {
            throw new Error(`Compile failed: ${err.message}`);
        }
    }
}
