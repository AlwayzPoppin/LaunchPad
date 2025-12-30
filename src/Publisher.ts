import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class Publisher {
    public static async publish(type: 'patch' | 'minor' | 'major', cwd: string): Promise<string> {
        try {
            // In a real scenario, we'd use 'npx vsce publish <type>'
            // For now, let's mock the command to ensure UI feedback works
            const { stdout, stderr } = await execAsync(`npx vsce publish ${type} --no-dependencies`, { cwd });
            if (stderr && !stderr.includes('DONE')) {
                throw new Error(stderr);
            }
            return stdout;
        } catch (err: any) {
            throw new Error(`Publish failed: ${err.message}`);
        }
    }

    public static async getLogins(): Promise<string[]> {
        try {
            const { stdout } = await execAsync('npx vsce ls-publishers');
            return stdout.split('\n').filter(l => l.trim() !== '');
        } catch {
            return [];
        }
    }

    public static async runCompile(cwd: string): Promise<string> {
        try {
            const { stdout } = await execAsync('npm run compile', { cwd });
            return stdout;
        } catch (err: any) {
            throw new Error(`Compile failed: ${err.message}`);
        }
    }
}
