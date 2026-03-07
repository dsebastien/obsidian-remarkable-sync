import { Modal } from 'obsidian'
import type { RemarkableSyncPlugin } from '../plugin'

export class AuthModal extends Modal {
    private readonly plugin: RemarkableSyncPlugin
    private readonly onSuccess?: () => void
    private deviceCode = ''
    private autoCloseTimeout: ReturnType<typeof setTimeout> | null = null

    constructor(plugin: RemarkableSyncPlugin, onSuccess?: () => void) {
        super(plugin.app)
        this.plugin = plugin
        this.onSuccess = onSuccess
    }

    override onOpen(): void {
        const { contentEl, titleEl } = this
        contentEl.empty()
        contentEl.addClass('remarkable-auth-modal')
        titleEl.setText('Connect to reMarkable')

        const instructions = contentEl.createDiv({ cls: 'remarkable-auth-instructions' })
        instructions.createEl('p', {
            text: 'Get a one-time code to link this device:',
            cls: 'remarkable-auth-subtitle'
        })

        const steps = instructions.createDiv({ cls: 'remarkable-auth-steps' })

        const step1 = steps.createDiv({ cls: 'remarkable-auth-step' })
        step1.createEl('span', { text: '1', cls: 'remarkable-auth-step-number' })
        const step1Text = step1.createEl('span')
        step1Text.createEl('span', { text: 'Visit ' })
        step1Text.createEl('a', {
            text: 'my.remarkable.com/device/desktop/connect',
            href: 'https://my.remarkable.com/device/desktop/connect',
            cls: 'remarkable-auth-link'
        })

        const step2 = steps.createDiv({ cls: 'remarkable-auth-step' })
        step2.createEl('span', { text: '2', cls: 'remarkable-auth-step-number' })
        step2.createEl('span', { text: 'Sign in with your reMarkable account' })

        const step3 = steps.createDiv({ cls: 'remarkable-auth-step' })
        step3.createEl('span', { text: '3', cls: 'remarkable-auth-step-number' })
        step3.createEl('span', { text: 'Enter the 8-character code below' })

        // Code input
        const inputContainer = contentEl.createDiv({ cls: 'remarkable-auth-input-container' })
        const codeInput = inputContainer.createEl('input', {
            type: 'text',
            placeholder: 'Enter code',
            cls: 'remarkable-auth-code-input'
        })
        codeInput.maxLength = 8
        codeInput.spellcheck = false
        codeInput.autocomplete = 'off'

        // Error message (hidden by default)
        const errorEl = contentEl.createDiv({ cls: 'remarkable-auth-error remarkable-auth-hidden' })

        // Button row
        const buttonRow = contentEl.createDiv({ cls: 'remarkable-auth-button-row' })
        const connectButton = buttonRow.createEl('button', {
            text: 'Connect',
            cls: 'mod-cta'
        })

        // Success view (hidden by default)
        const successEl = contentEl.createDiv({
            cls: 'remarkable-auth-success remarkable-auth-hidden'
        })

        // Events
        codeInput.addEventListener('input', () => {
            this.deviceCode = codeInput.value.trim()
            errorEl.addClass('remarkable-auth-hidden')
        })

        codeInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && this.deviceCode) {
                connectButton.click()
            }
        })

        const handleConnect = async (): Promise<void> => {
            if (!this.deviceCode) {
                errorEl.textContent = 'Please enter a device code'
                errorEl.removeClass('remarkable-auth-hidden')
                return
            }

            connectButton.disabled = true
            connectButton.textContent = 'Connecting...'
            codeInput.disabled = true
            errorEl.addClass('remarkable-auth-hidden')

            const success = await this.plugin.authService.registerDevice(this.deviceCode)

            if (success) {
                this.plugin.isConnected = true

                // Show success state
                instructions.addClass('remarkable-auth-hidden')
                inputContainer.addClass('remarkable-auth-hidden')
                buttonRow.addClass('remarkable-auth-hidden')
                titleEl.setText('Connected')

                successEl.removeClass('remarkable-auth-hidden')
                successEl.createDiv({ cls: 'remarkable-auth-success-icon', text: '\u2713' })
                successEl.createEl('p', {
                    text: 'Successfully connected to reMarkable cloud',
                    cls: 'remarkable-auth-success-text'
                })

                // Auto-close after delay
                this.autoCloseTimeout = setTimeout(() => {
                    this.onSuccess?.()
                    this.close()
                }, 1500)
            } else {
                errorEl.textContent = 'Connection failed. Please check the code and try again.'
                errorEl.removeClass('remarkable-auth-hidden')
                connectButton.disabled = false
                connectButton.textContent = 'Connect'
                codeInput.disabled = false
                codeInput.focus()
            }
        }

        connectButton.addEventListener('click', () => {
            void handleConnect()
        })

        // Auto-focus the input
        setTimeout(() => codeInput.focus(), 50)
    }

    override onClose(): void {
        if (this.autoCloseTimeout) {
            clearTimeout(this.autoCloseTimeout)
            this.autoCloseTimeout = null
        }
        this.contentEl.empty()
    }
}
