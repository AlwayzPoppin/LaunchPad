import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export interface ValidationResult {
    isValid: boolean;
    message: string;
    severity: vscode.DiagnosticSeverity;
}

export class Validator {
    public static async validatePackageJson(rootPath: string): Promise<ValidationResult[]> {
        const results: ValidationResult[] = [];
        const packageJsonPath = path.join(rootPath, 'package.json');

        if (!fs.existsSync(packageJsonPath)) {
            results.push({
                isValid: false,
                message: "package.json not found in root.",
                severity: vscode.DiagnosticSeverity.Error
            });
            return results;
        }

        try {
            const content = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

            // 1. Publisher Case Sensitivity Check
            if (content.publisher) {
                // Heuristic: Check if publisher looks like it should be camelCase but isn't
                // In a real scenario, we'd compare against vsce's known logins
                if (content.publisher === 'nexgenmeta') {
                    results.push({
                        isValid: false,
                        message: "Publisher ID 'nexgenmeta' should likely be 'NexGenMeta' (Marketplace IDs are case-sensitive).",
                        severity: vscode.DiagnosticSeverity.Warning
                    });
                }
            } else {
                results.push({
                    isValid: false,
                    message: "Missing 'publisher' field in package.json.",
                    severity: vscode.DiagnosticSeverity.Error
                });
            }

            // 2. Icon Check
            if (!content.icon) {
                results.push({
                    isValid: false,
                    message: "No icon defined. Extensions need a 128x128px png icon (Recommendation).",
                    severity: vscode.DiagnosticSeverity.Warning
                });
            } else {
                const iconPath = path.join(rootPath, content.icon);
                if (!fs.existsSync(iconPath)) {
                    results.push({
                        isValid: false,
                        message: `Icon file not found at: ${content.icon}`,
                        severity: vscode.DiagnosticSeverity.Error
                    });
                }
            }

            // 3. Repository Check
            if (!content.repository) {
                results.push({
                    isValid: false,
                    message: "Missing 'repository' field. Users trust extensions more with source links.",
                    severity: vscode.DiagnosticSeverity.Warning
                });
            }

        } catch (err) {
            results.push({
                isValid: false,
                message: "Error parsing package.json.",
                severity: vscode.DiagnosticSeverity.Error
            });
        }

        return results;
    }
}
