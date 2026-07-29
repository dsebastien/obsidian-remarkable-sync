import { Setting } from 'obsidian'
import { BUY_ME_A_COFFEE_BADGE_DATA_URL } from '../../assets/buy-me-a-coffee'
import { BUY_ME_A_COFFEE_URL, renderSupportSection } from '../../ui/support-links'

export function renderAboutSection(containerEl: HTMLElement): void {
    new Setting(containerEl).setName('About').setHeading()

    new Setting(containerEl)
        .setName('Follow me on X')
        .setDesc('Sébastien Dubois (@dSebastien)')
        .addButton((button) => {
            button.setCta()
            button.setButtonText('Follow me on X').onClick(() => {
                window.open('https://x.com/dSebastien')
            })
        })

    renderSupportSection(containerEl, (el) => {
        const badgeContainer = el.createDiv()
        const linkEl = badgeContainer.createEl('a', {
            href: BUY_ME_A_COFFEE_URL
        })
        const imgEl = linkEl.createEl('img')
        imgEl.src = BUY_ME_A_COFFEE_BADGE_DATA_URL
        imgEl.alt = 'Buy me a coffee'
        imgEl.width = 175
    })
}
