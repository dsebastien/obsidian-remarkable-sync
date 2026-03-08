import { Setting } from 'obsidian'

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

    new Setting(containerEl).setName('Support').setHeading()

    const supportDesc = new DocumentFragment()
    supportDesc.createDiv({
        text: 'Buy me a coffee to support the development of this plugin'
    })

    new Setting(containerEl).setDesc(supportDesc)

    const badgeContainer = containerEl.createDiv()
    const linkEl = badgeContainer.createEl('a', {
        href: 'https://www.buymeacoffee.com/dsebastien'
    })
    const imgEl = linkEl.createEl('img')
    imgEl.src =
        'https://github.com/dsebastien/obsidian-plugin-template/blob/main/src/assets/buy-me-a-coffee.png?raw=true'
    imgEl.alt = 'Buy me a coffee'
    imgEl.width = 175

    const spacing = containerEl.createDiv()
    spacing.classList.add('support-header-margin')
}
