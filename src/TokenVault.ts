import * as vscode from 'vscode';

export class TokenVault {
    private static readonly TOKEN_KEY = 'nexgen_launchpad_pat';

    constructor(private readonly secrets: vscode.SecretStorage) { }

    public async storeToken(token: string): Promise<void> {
        await this.secrets.store(TokenVault.TOKEN_KEY, token);
    }

    public async getToken(): Promise<string | undefined> {
        return await this.secrets.get(TokenVault.TOKEN_KEY);
    }

    public async deleteToken(): Promise<void> {
        await this.secrets.delete(TokenVault.TOKEN_KEY);
    }

    public async hasToken(): Promise<boolean> {
        const token = await this.getToken();
        return !!token;
    }
}
