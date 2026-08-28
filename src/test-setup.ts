/**
 * Test setup file that mocks the 'obsidian' module.
 * The obsidian package is types-only and has no runtime code,
 * so we need to provide mock implementations for tests.
 */
import { mock } from 'bun:test'

/**
 * `OffscreenCanvas` is a browser API and does not exist under `bun test`.
 * Page rendering is gated on it (`isPageRenderingSupported`), so without a stub
 * every spec that exercises the sync pipeline or .rmdoc import would take the
 * "device cannot render" path. Specs that care about the unsupported branch
 * delete this global themselves.
 */
if ('undefined' === typeof globalThis.OffscreenCanvas) {
    Object.defineProperty(globalThis, 'OffscreenCanvas', {
        value: class OffscreenCanvasStub {},
        configurable: true,
        writable: true
    })
}

/**
 * Minimal typing for the parts of `bun:test`'s `mock` we use.
 * In environments where the `bun:test` type declarations are not resolvable
 * (e.g. the community-plugin review tooling), `mock` becomes error-typed
 * (`any`); narrowing it to this interface keeps the call site type-safe.
 */
interface ModuleMocker {
    module(id: string, factory: () => Record<string, unknown>): void | Promise<void>
}

const moduleMocker: ModuleMocker = mock as ModuleMocker

// Mock the obsidian module (fire-and-forget, no need to await)
void moduleMocker.module('obsidian', () => ({
    Notice: class Notice {
        constructor(_message: string, _timeout?: number) {
            // No-op for tests
        }
    },
    App: class App {},
    TFile: class TFile {},
    Plugin: class Plugin {},
    PluginSettingTab: class PluginSettingTab {},
    // Used by the what's-new view to render the bundled changelog.
    MarkdownRenderer: { render: async () => {} },
    Setting: class Setting {
        setName() {
            return this
        }
        setDesc() {
            return this
        }
        setHeading() {
            return this
        }
        addButton() {
            return this
        }
        addText() {
            return this
        }
        addToggle() {
            return this
        }
        addDropdown() {
            return this
        }
        addSlider() {
            return this
        }
    },
    MarkdownView: class MarkdownView {},
    TAbstractFile: class TAbstractFile {},
    TFolder: class TFolder {},
    AbstractInputSuggest: class AbstractInputSuggest {},
    SearchComponent: class SearchComponent {},
    ItemView: class ItemView {
        contentEl = {
            empty: () => {},
            createDiv: () => ({
                createDiv: () => ({}),
                createEl: () => ({})
            }),
            createEl: () => ({})
        }
        getViewType() {
            return ''
        }
        getDisplayText() {
            return ''
        }
    },
    Modal: class Modal {
        contentEl = {
            empty: () => {},
            createEl: () => ({
                createEl: () => ({})
            }),
            createDiv: () => ({})
        }
        open() {}
        close() {}
    },
    FuzzySuggestModal: class FuzzySuggestModal {
        setPlaceholder() {}
        open() {}
        close() {}
    },
    FileSystemAdapter: class FileSystemAdapter {},
    // Tests run outside Obsidian; the desktop-only legacy token file path is
    // exercised through injected deps, never through the real Platform check.
    Platform: { isDesktopApp: false, isMobile: false, isMobileApp: false },
    requestUrl: async () => ({ status: 200, text: '', json: {}, arrayBuffer: new ArrayBuffer(0) }),
    debounce: (fn: (...args: unknown[]) => unknown) => fn,
    setIcon: () => {}
}))
