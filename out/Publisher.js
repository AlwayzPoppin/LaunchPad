"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Publisher = void 0;
const child_process_1 = require("child_process");
const util_1 = require("util");
const execAsync = (0, util_1.promisify)(child_process_1.exec);
class Publisher {
    static async publish(type, cwd) {
        try {
            // In a real scenario, we'd use 'npx vsce publish <type>'
            // For now, let's mock the command to ensure UI feedback works
            const { stdout, stderr } = await execAsync(`npx vsce publish ${type} --dry-run`, { cwd });
            if (stderr && !stderr.includes('DONE')) {
                throw new Error(stderr);
            }
            return stdout;
        }
        catch (err) {
            throw new Error(`Publish failed: ${err.message}`);
        }
    }
    static async getLogins() {
        try {
            const { stdout } = await execAsync('npx vsce ls-publishers');
            return stdout.split('\n').filter(l => l.trim() !== '');
        }
        catch {
            return [];
        }
    }
}
exports.Publisher = Publisher;
//# sourceMappingURL=Publisher.js.map