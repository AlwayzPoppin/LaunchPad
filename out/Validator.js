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
exports.Validator = void 0;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
class Validator {
    static async validatePackageJson(rootPath) {
        const results = [];
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
                if (content.publisher === 'nexgen-synapse') {
                    results.push({
                        isValid: false,
                        message: "Publisher ID 'nexgen-synapse' should likely be 'NexGenSynapse' (Marketplace IDs are case-sensitive).",
                        severity: vscode.DiagnosticSeverity.Warning
                    });
                }
            }
            else {
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
                    message: "No icon defined. Extensions need a 128x128px png icon.",
                    severity: vscode.DiagnosticSeverity.Warning
                });
            }
            else {
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
        }
        catch (err) {
            results.push({
                isValid: false,
                message: "Error parsing package.json.",
                severity: vscode.DiagnosticSeverity.Error
            });
        }
        return results;
    }
}
exports.Validator = Validator;
//# sourceMappingURL=Validator.js.map