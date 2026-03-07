# Obsidian Plugin Template (Bun)

A modern Obsidian plugin template using **Bun** as the package manager and bundler, with TypeScript, Tailwind CSS v4, ESLint, Prettier, and automated release workflows.

## Features

- **Bun** for fast package management and bundling
- **TypeScript** with strict configuration
- **Tailwind CSS v4** for styling
- **ESLint + Prettier** for code quality
- **Husky + lint-staged** for pre-commit hooks
- **Commitizen + Conventional Commits** for standardized commit messages
- **GitHub Actions** for CI/CD and automated releases
- **Immer** for immutable state management
- **Zod** for runtime validation

## Getting Started

See [TEMPLATE_USAGE.md](./TEMPLATE_USAGE.md) for detailed instructions on how to use this template to create your own Obsidian plugin.

## Quick Start

1. Click "Use this template" on GitHub to create a new repository
2. Clone your new repository
3. Follow the setup instructions in [TEMPLATE_USAGE.md](./TEMPLATE_USAGE.md)
4. Run `bun install` to install dependencies
5. Run `bun run dev` to start development

## Development

See [DEVELOPMENT.md](./DEVELOPMENT.md) for detailed development instructions.

### Prerequisites

- [Bun](https://bun.sh/) (latest version)
- [Git](https://git-scm.com/)
- An Obsidian vault for testing

### Commands

| Command             | Description                       |
| ------------------- | --------------------------------- |
| `bun install`       | Install dependencies              |
| `bun run dev`       | Development build with watch mode |
| `bun run build`     | Production build                  |
| `bun run tsc:watch` | Type check in watch mode          |
| `bun run lint`      | Run ESLint                        |
| `bun run format`    | Format with Prettier              |
| `bun test`          | Run tests                         |

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for contribution guidelines.

## License

MIT License - see [LICENSE](./LICENSE) for details.

## News & Support

<!-- TODO: Update these links with your own -->

To stay up to date about this plugin, Obsidian in general, Personal Knowledge Management and note-taking, subscribe to [my newsletter](https://your-newsletter-url.com). Note that the best way to support my work is to become a paid subscriber ❤️.
