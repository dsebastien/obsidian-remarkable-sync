# Template Usage Guide

This guide explains how to use this template to create your own Obsidian plugin.

## Prerequisites

- [Bun](https://bun.sh/) installed (latest version)
- [Git](https://git-scm.com/) installed
- A GitHub account
- An Obsidian vault for testing

## Step 1: Create Your Repository

### Option A: Use GitHub Template (Recommended)

1. Click the "Use this template" button on the GitHub repository page
2. Choose a name for your repository (e.g., `obsidian-my-awesome-plugin`)
3. Clone your new repository:

```bash
git clone https://github.com/YOUR_USERNAME/obsidian-my-awesome-plugin.git
cd obsidian-my-awesome-plugin
```

### Option B: Manual Clone

1. Clone this repository:

```bash
git clone https://github.com/dsebastien/obsidian-plugin-template-bun.git obsidian-my-awesome-plugin
cd obsidian-my-awesome-plugin
```

2. Remove the existing git history and initialize a new repository:

```bash
rm -rf .git
git init
git add .
git commit -m "Initial commit from template"
```

3. Create a new repository on GitHub and push:

```bash
git remote add origin https://github.com/YOUR_USERNAME/obsidian-my-awesome-plugin.git
git branch -M main
git push -u origin main
```

## Step 2: Update Project Metadata

### 2.1 Update `package.json`

Update the following fields with your project information:

```json
{
    "name": "obsidian-my-awesome-plugin",
    "description": "Your plugin description here",
    "author": {
        "name": "Your Name",
        "email": "your-email@example.com",
        "url": "https://your-website.com"
    },
    "keywords": ["obsidian", "obsidian-plugin", "your-keywords"],
    "repository": {
        "type": "git",
        "url": "git+https://github.com/YOUR_USERNAME/obsidian-my-awesome-plugin.git"
    },
    "bugs": {
        "url": "https://github.com/YOUR_USERNAME/obsidian-my-awesome-plugin/issues"
    },
    "homepage": "https://github.com/YOUR_USERNAME/obsidian-my-awesome-plugin"
}
```

### 2.2 Update `manifest.json`

Update the plugin manifest with your plugin details:

```json
{
    "id": "my-awesome-plugin",
    "name": "My Awesome Plugin",
    "description": "Your plugin description here",
    "version": "1.0.0",
    "minAppVersion": "1.4.0",
    "isDesktopOnly": false,
    "author": "Your Name",
    "authorUrl": "https://your-website.com",
    "fundingUrl": "https://www.buymeacoffee.com/your-username"
}
```

**Important notes about `manifest.json`:**

- The `id` field must be unique and should match your plugin folder name
- Never change `id` after releasing your plugin
- Use semantic versioning (e.g., `1.0.0`, `1.1.0`, `2.0.0`)
- Update `minAppVersion` if you use newer Obsidian APIs

## Step 3: Rename Plugin Classes

Search for `TODO` comments in the source code and update the following:

### 3.1 Plugin Class (`src/app/plugin.ts`)

Rename `MyPlugin` to your plugin class name:

```typescript
// Before
export class MyPlugin extends Plugin {

// After
export class MyAwesomePlugin extends Plugin {
```

### 3.2 Settings Tab Class (`src/app/settings/settings-tab.ts`)

Rename `MyPluginSettingTab` to match your plugin name:

```typescript
// Before
export class MyPluginSettingTab extends PluginSettingTab {

// After
export class MyAwesomePluginSettingTab extends PluginSettingTab {
```

Also update the type imports:

```typescript
// Before
import type MyPlugin from '../../main'

// After
import type MyAwesomePlugin from '../../main'
```

### 3.3 Main Entry Point (`src/main.ts`)

Update the import and export:

```typescript
// Before
import { MyPlugin } from './app/plugin'
export default MyPlugin

// After
import { MyAwesomePlugin } from './app/plugin'
export default MyAwesomePlugin
```

### 3.4 Settings Tab Social Links (Optional)

The settings tab in `src/app/settings/settings-tab.ts` includes social media and support links for the template author. You can:

- **Keep them**: If you want to support the template author
- **Update them**: Replace with your own Twitter/X handle, Buy Me a Coffee URL, etc.
- **Remove them**: Delete the `renderFollowButton`, `renderSupportHeader`, and `renderBuyMeACoffeeBadge` methods and their calls in `display()`

### 3.5 GitHub Funding (Optional)

The `.github/FUNDING.yml` file contains funding links for the template author. You can:

- **Keep it**: If you want to support the template author
- **Update it**: Replace with your own funding information
- **Remove it**: Delete the file entirely if you don't want funding links

## Step 4: Update Documentation

### 4.1 Update `README.md`

Replace the template README with your plugin's documentation:

- Plugin name and description
- Features list
- Installation instructions
- Usage guide
- Configuration options
- Screenshots (if applicable)

### 4.2 Update `CONTRIBUTING.md`

Update repository URLs and any project-specific contribution guidelines.

### 4.3 Update `DEVELOPMENT.md`

Update repository URLs and the plugin folder name in the manual installation section.

### 4.4 Update or Remove `.github/FUNDING.yml`

See Step 3.5 above for guidance on the funding file.

## Step 5: Configure GitHub

### 5.1 Repository Settings

1. Go to your repository **Settings → Actions → General**
2. Under "Workflow permissions", enable **Read and write permissions**
3. Check "Allow GitHub Actions to create and approve pull requests"

### 5.2 Enable GitHub Pages (Optional)

If you want to host documentation:

1. Go to **Settings → Pages**
2. Set source to "GitHub Actions" or your preferred branch

## Step 6: Install Dependencies

```bash
bun install
```

## Step 7: Configure Development Environment

Set the `OBSIDIAN_VAULT_LOCATION` environment variable to your test vault path:

### Linux/macOS

```bash
export OBSIDIAN_VAULT_LOCATION="/path/to/your/vault"
```

Add to `~/.bashrc` or `~/.zshrc` to make it permanent.

### Windows (PowerShell)

```powershell
$env:OBSIDIAN_VAULT_LOCATION="C:\Users\YourName\Documents\ObsidianVault"
```

## Step 8: Start Development

1. Start TypeScript watch mode (recommended to run in a separate terminal):

```bash
bun run tsc:watch
```

2. Start the development build:

```bash
bun run dev
```

3. In Obsidian:
    - Go to **Settings → Community plugins**
    - Enable the plugin
    - Use **Ctrl/Cmd + R** to reload after changes

## Step 9: Clean Up Template Files

After completing the setup, remove this file:

```bash
rm TEMPLATE_USAGE.md
```

Also review and clean up:

- `documentation/` folder - update or remove template documentation
- `TODO.md` - if present, review and update for your project

## Creating Your First Release

For the first release, **do not** use automated version bumping. Instead:

1. Ensure your code is ready and all tests pass:

```bash
bun run tsc
bun run lint
bun test
bun run build
```

2. Create and push a tag:

```bash
git tag 1.0.0
git push origin 1.0.0
```

3. The GitHub Actions release workflow will automatically:
    - Build the plugin
    - Generate a changelog
    - Create a GitHub release with the necessary files

## Subsequent Releases

For subsequent releases, you can either:

### Manual Tag (Recommended for major releases)

```bash
git tag 1.1.0
git push origin 1.1.0
```

### Workflow Dispatch

1. Go to **Actions → Release** in your repository
2. Click "Run workflow"
3. Enter the version number (e.g., `1.1.0`)
4. Click "Run workflow"

## Publishing to Obsidian Community Plugins

When you're ready to publish:

1. Ensure your plugin follows [Obsidian's plugin guidelines](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines)
2. Review the [submission requirements](https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin)
3. Submit a PR to [obsidian-releases](https://github.com/obsidianmd/obsidian-releases)

## Template Features Overview

This template includes:

| Feature                    | Description                        |
| -------------------------- | ---------------------------------- |
| **Bun**                    | Fast package manager and bundler   |
| **TypeScript**             | Strict type checking enabled       |
| **Tailwind CSS v4**        | Utility-first CSS framework        |
| **ESLint**                 | Code linting with modern config    |
| **Prettier**               | Code formatting                    |
| **Husky**                  | Git hooks for pre-commit checks    |
| **lint-staged**            | Run linters on staged files        |
| **Commitizen**             | Interactive commit message helper  |
| **Conventional Commits**   | Standardized commit message format |
| **GitHub Actions CI**      | Automated testing on push/PR       |
| **GitHub Actions Release** | Automated release workflow         |
| **Immer**                  | Immutable state management         |
| **Zod**                    | Runtime type validation            |

## Troubleshooting

### Bun not found

Install Bun from [bun.sh](https://bun.sh/):

```bash
curl -fsSL https://bun.sh/install | bash
```

### Plugin not appearing in Obsidian

1. Verify `OBSIDIAN_VAULT_LOCATION` is correct
2. Check files exist in `<vault>/.obsidian/plugins/<plugin-id>/`
3. Restart Obsidian
4. Ensure Community plugins are enabled

### TypeScript errors

Run `bun run tsc:watch` to see detailed type errors and fix them before building.

### Build fails

1. Ensure all dependencies are installed: `bun install`
2. Check for TypeScript errors: `bun run tsc`
3. Check for lint errors: `bun run lint`

## Questions?

If you encounter issues with this template, please [open an issue](https://github.com/dsebastien/obsidian-plugin-template-bun/issues) on the template repository.
