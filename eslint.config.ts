import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'
import eslintConfigPrettier from 'eslint-config-prettier'
import globals from 'globals'
import obsidianmd from 'eslint-plugin-obsidianmd'

export default tseslint.config(
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    // eslint-plugin-obsidianmd 0.4.x ships complete config types, so the
    // `@ts-expect-error` this line used to carry is no longer needed.
    ...obsidianmd.configs['recommended'],
    eslintConfigPrettier,
    {
        ignores: [
            '**/dist/**',
            '**/node_modules/**',
            'scripts/**',
            '.cz-config.cjs',
            'prettier.config.cjs',
            'package.json'
        ]
    },
    {
        files: ['**/*.{js,mjs,cjs,ts}'],
        languageOptions: {
            globals: {
                ...globals.node,
                ...globals.browser,
                // Obsidian global functions
                createDiv: 'readonly',
                createEl: 'readonly',
                createSpan: 'readonly',
                createFragment: 'readonly',
                // Obsidian popout-aware globals
                activeDocument: 'readonly',
                activeWindow: 'readonly'
            },
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname
            }
        },
        rules: {
            '@typescript-eslint/no-require-imports': 'off',
            '@typescript-eslint/no-explicit-any': 'warn',
            '@typescript-eslint/no-unused-vars': [
                'error',
                { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
            ],
            '@typescript-eslint/ban-ts-comment': 'off',
            '@typescript-eslint/no-deprecated': 'off',
            // These are too strict for dynamic plugin APIs
            '@typescript-eslint/no-unsafe-call': 'off',
            '@typescript-eslint/no-unsafe-member-access': 'off',
            '@typescript-eslint/no-unsafe-assignment': 'off',
            // Obsidian methods are dynamically added to prototypes
            '@typescript-eslint/no-unsafe-enum-comparison': 'off',
            'no-prototype-builtins': 'off',
            // Allow confirm for delete confirmations
            'no-alert': 'off',
            // Sentence case is a community-review requirement, so the rule is an
            // ERROR here rather than off. The catalog reviewer runs its OWN
            // ruleset against the source archive, so switching it off locally
            // suppresses nothing on their side — it only hides the finding until
            // submission. It compares every UI string against a word list, so the
            // vocabulary this plugin's copy uses has to be declared or correct
            // text gets reported:
            //
            // - `brands` REPLACES the plugin's default list (`?? DEFAULT_BRANDS`),
            //   so this array must carry every brand this codebase names. A new
            //   brand in a UI string is reported until it is added here — loud,
            //   which is the point.
            // - `ignoreRegex` matches whole strings — anchor each entry to the
            //   exact literal it exempts, never a broad pattern.
            'obsidianmd/ui/sentence-case': [
                'error',
                {
                    enforceCamelCaseLower: true,
                    brands: [
                        // Defaults this codebase relies on
                        'Obsidian',
                        'Obsidian Sync',
                        'Obsidian Publish',
                        'iOS',
                        'macOS',
                        'Windows',
                        'Linux',
                        'Android',
                        'GitHub',
                        'GitHub Sponsors',
                        'Git',
                        'YouTube',
                        'Markdown',
                        'JavaScript',
                        'TypeScript',
                        'Node.js',
                        // The follow CTA links to x.com
                        'X',
                        // The device family this plugin syncs with, spelled the
                        // way reMarkable spells it (lowercase r, capital M).
                        // Deliberately NOT 'reMarkable Cloud': this plugin's
                        // copy consistently writes 'reMarkable cloud', and a
                        // brand enforces its casing both ways.
                        'reMarkable',
                        // Formats named in the settings copy
                        'PDF',
                        'EPUB',
                        'JPEG',
                        'PNG',
                        'WebP',
                        // Community this plugin's support CTAs link to
                        'Knowii'
                    ],
                    ignoreRegex: [
                        // Author credit — proper noun + handle
                        '^Sébastien Dubois \\(@dSebastien\\)$',
                        // Literal URLs shown as link text / examples
                        '^my\\.remarkable\\.com/device/desktop/connect$',
                        '^The base URL of your rmfakecloud server \\(e\\.g\\., https://cloud\\.example\\.com\\)$',
                        // Folder placeholder fragment
                        '^e\\.g\\., reMarkable$',
                        // "Save images" quotes the setting name rendered above
                        '^Write one PDF per notebook, beside the page images\\. Independent of "Save images": enable either, both or neither\\. WebP cannot be stored in a PDF, so pages are embedded as JPEG when that format is selected\\.$',
                        // Fleet-wide template copy, kept byte-identical
                        '^Obsidian, Personal Knowledge Management and note-taking, straight to your inbox and feed\\.$'
                    ]
                }
            ]
        }
    },
    {
        // Desktop-only legacy token import: node:fs/path/os are require()d
        // lazily behind a Platform.isDesktopApp guard and never reached on
        // mobile; a top-level import would be hoisted and break plugin load.
        // The recommended preset forbids inline disables of this rule, so the
        // exemption lives here instead.
        files: ['src/app/services/auth/token-store.ts'],
        rules: {
            'obsidianmd/no-nodejs-modules': 'off'
        }
    },
    {
        // crypto is identical across (popout) windows, and globalThis keeps
        // this utility runnable under the bun test runner where no window
        // exists. Inline disables of this rule are forbidden by the preset.
        files: ['src/utils/uuid.ts'],
        rules: {
            'obsidianmd/no-global-this': 'off'
        }
    },
    {
        // Specs and the test harness run under `bun test` and are never
        // bundled into main.js, so the mobile restriction on Node builtins
        // does not apply to them.
        files: ['**/*.spec.ts', 'src/test-setup.ts'],
        rules: {
            'import/no-nodejs-modules': 'off',
            'obsidianmd/no-nodejs-modules': 'off',
            'obsidianmd/no-global-this': 'off',
            'obsidianmd/prefer-window-timers': 'off',
            'obsidianmd/no-tfile-tfolder-cast': 'off',
            'obsidianmd/no-static-styles-assignment': 'off'
        }
    }
)
