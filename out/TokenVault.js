"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TokenVault = void 0;
class TokenVault {
    secrets;
    static TOKEN_KEY = 'nexgen_launchpad_pat';
    constructor(secrets) {
        this.secrets = secrets;
    }
    async storeToken(token) {
        await this.secrets.store(TokenVault.TOKEN_KEY, token);
    }
    async getToken() {
        return await this.secrets.get(TokenVault.TOKEN_KEY);
    }
    async deleteToken() {
        await this.secrets.delete(TokenVault.TOKEN_KEY);
    }
    async hasToken() {
        const token = await this.getToken();
        return !!token;
    }
}
exports.TokenVault = TokenVault;
//# sourceMappingURL=TokenVault.js.map