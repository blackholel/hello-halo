# Contributing to Kite

Thanks for your interest in contributing to Kite! This guide will help you get started.

## Development Setup

```bash
# Clone the repository
git clone https://github.com/blackholel/buddykite.git
cd buddykite

# Install dependencies
npm install

# Start development server
npm run dev
```

## Project Structure

```
src/
├── main/           # Electron Main Process
│   ├── services/   # Business logic (agent, config, space, conversation...)
│   ├── ipc/        # IPC handlers
│   └── http/       # Remote Access server
├── preload/        # Preload scripts
└── renderer/       # React Frontend
    ├── components/ # UI components
    ├── stores/     # Zustand state management
    ├── api/        # API adapter (IPC/HTTP)
    └── pages/      # Page components
```

## Tech Stack

- **Framework**: Electron + electron-vite
- **Frontend**: React 18 + TypeScript
- **Styling**: Tailwind CSS (use CSS variables, no hardcoded colors)
- **State**: Zustand
- **Icons**: lucide-react

## Code Guidelines

### Styling

Use Tailwind CSS with theme variables:

```tsx
// Good
<div className="bg-background text-foreground border-border">

// Bad
<div className="bg-white text-black border-gray-200">
```

### Internationalization

All user-facing text must use `t()`:

```tsx
// Good
<Button>{t('Save')}</Button>

// Bad
<Button>Save</Button>
```

Run `npm run i18n` before committing to extract new strings.

### Adding IPC Channels

When adding a new IPC event, update these 3 files:

1. `src/preload/index.ts` - Expose to `window.kite`
2. `src/renderer/api/transport.ts` - Add to `methodMap`
3. `src/renderer/api/index.ts` - Export unified API

## Pull Request Process

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Run `npm run i18n` if you added any text
5. Test your changes (`npm run dev`)
6. Commit with clear message
7. Push and create a Pull Request

## Release Workflow

Kite releases follow SemVer (`major.minor.patch`) and are version-driven.

```bash
# 1) Bump version
npm version patch    # or minor / major

# 2) Update release notes
# edit .release-notes-current.md

# 3) Update dual-source update manifest (required)
# edit resources/update-manifest.json:
# - latestVersion must match package.json version
# - release entry for that version must exist
# - per-platform github + baidu links must be filled

# 4) Publish
npm run release      # or release:mac / release:win / release:linux
```

`release*` scripts automatically run `npm run check:update-manifest`.

## Areas We Need Help

- **Translations** - Add/improve translations in `src/renderer/i18n/`
- **Bug fixes** - Check GitHub Issues
- **Documentation** - Improve README, add guides
- **Features** - Discuss in GitHub Discussions first

## Questions?

- Open a [GitHub Discussion](https://github.com/blackholel/buddykite/discussions)
- Check existing [Issues](https://github.com/blackholel/buddykite/issues)

Thank you for contributing!
