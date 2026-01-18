# NexGen-Meta: Launchpad 🚀

![Version](https://img.shields.io/visual-studio-marketplace/v/NexGenMeta.launchpad) ![Installs](https://img.shields.io/visual-studio-marketplace/i/NexGenMeta.launchpad) ![Rating](https://img.shields.io/visual-studio-marketplace/r/NexGenMeta.launchpad)


Launchpad is the "Control Center" for VS Code extension developers. It simplifies the final steps of extension delivery—validating your package, managing deployment tokens, and shipping with a single click.

## Features

### 🔬 Pre-flight Audit
Automatically scans your `package.json` and project structure for common publishing pitfalls:
- Missing icons (128x128px)
- Missing repository or source links
- **Publisher ID Case-Sensitivity**: Automatically warns if your publisher ID might be formatted incorrectly for the Marketplace.

### 🔑 Token Vault
Securely store and manage your Azure Personal Access Tokens (PATs) using VS Code's native `SecretStorage`. No more digging through the Azure DevOps portal every time you want to ship.

### ⛴️ One-Click Ship
Ship your extension updates without touching the terminal:
- **Ship Patch**: Automatically increments version and publishes.
- Integrated progress notifications and error reporting.

### 🛡️ Badge Generator
Automatically inserts professional Marketplace shields and badges (Version, Installs, Rating) into your `README.md` with a single click.

## Getting Started

1. Open an extension project in VS Code.
2. Click the **Launchpad** icon in the Activity Bar.
3. Run an **Audit** to check for potential issues.
4. Save your **Azure PAT** in the Secret Vault.
5. Hit **Ship Patch** to go live!

---

Part of the **NexGen-Meta** suite. Built for developers who ship.
