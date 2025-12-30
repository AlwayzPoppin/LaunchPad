import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export class BadgeGenerator {
    public static generateBadges(publisher: string, extensionName: string): string {
        const baseUrl = `https://img.shields.io/visual-studio-marketplace`;
        return [
            `![Version](${baseUrl}/v/${publisher}.${extensionName})`,
            `![Installs](${baseUrl}/i/${publisher}.${extensionName})`,
            `![Rating](${baseUrl}/r/${publisher}.${extensionName})`
        ].join(' ');
    }

    public static async insertIntoReadme(rootPath: string, badges: string): Promise<boolean> {
        const readmePath = path.join(rootPath, 'README.md');
        if (!fs.existsSync(readmePath)) return false;

        let content = fs.readFileSync(readmePath, 'utf8');
        // Simple heuristic: insert at the top after the title
        if (content.includes('![Version]')) return false; // Already there

        const lines = content.split('\n');
        if (lines[0].startsWith('#')) {
            lines.splice(1, 0, '\n' + badges + '\n');
        } else {
            lines.unshift(badges + '\n');
        }

        fs.writeFileSync(readmePath, lines.join('\n'));
        return true;
    }
}
